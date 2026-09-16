import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Development-only salon fixtures.
//
// The public salon list is served by backend.mynaai.in, which a sandbox or an
// offline laptop cannot reach — the home page then correctly shows its "could
// not reach the salon network" state, which makes the discovery list,
// the salon cards and the paging footer impossible to review in a preview.
//
// Start the dev server with MYNAAI_DEV_MOCK_API=1 to serve a pageable 57-salon
// fixture for the three salon endpoints instead. It is `apply: 'serve'` plus an
// env flag, so it never runs in a build, never runs by default, and is not part
// of the deployable app.
const AREAS = ['Dharampeth', 'Sitabuldi', 'Sadar', 'Ramdaspeth', 'Manish Nagar', 'Wardha Road', 'Hingna Road', 'Civil Lines', 'Pratap Nagar', 'Gokulpeth', 'Bajaj Nagar', 'Dhantoli'];
const NAMES = ['Golden Scissors', 'Urban Cut Studio', 'The Grooming Room', 'Blush Beauty Lounge', 'Trim & Co.', 'Style Republic', 'The Barber Shop', 'Glow Unisex Salon', 'Shear Genius', 'Mirror Mirror Salon', 'Velvet Touch', 'Sharp Cuts Family Salon'];
const SERVICES = [
  { serviceId: 's1', serviceName: 'Haircut', price: 150, durationMinutes: 30 },
  { serviceId: 's2', serviceName: 'Beard Trim', price: 80, durationMinutes: 15 },
  { serviceId: 's3', serviceName: 'Hair Spa', price: 499, durationMinutes: 45 },
  { serviceId: 's4', serviceName: 'Head Massage', price: 249, durationMinutes: 20 },
];

function salonFixture(index) {
  const name = `${NAMES[index % NAMES.length]}${index >= NAMES.length ? ` ${Math.floor(index / NAMES.length) + 1}` : ''}`;
  const area = AREAS[index % AREAS.length];
  const genderType = ['UNISEX', 'MALE', 'FEMALE'][index % 3];
  return {
    salonId: `mock-salon-${index}`,
    salonName: name,
    genderType,
    address: `${area}, Nagpur`,
    addressLine1: `${10 + index} ${area} Main Road`,
    city: 'Nagpur',
    state: 'Maharashtra',
    pincode: '440010',
    phoneNumber: `98765${String(10000 + index).slice(-5)}`,
    ownerName: 'Ramesh Kumar',
    latitude: 21.1458 + index * 0.004,
    longitude: 79.0882 + index * 0.003,
    distance: Number((0.4 + index * 0.35).toFixed(2)),
    isOpen: index % 5 !== 3,
    waitTime: index % 5 === 3 ? 'Come back later' : ['5–10 min', '10–15 min', '20–30 min'][index % 3],
    imageUrl: '',
    imagesArray: [],
    businessHours: [{ openingTime: '09:00:00', closingTime: '21:00:00', holidayDays: ['1'] }],
    services: SERVICES,
    barbers: [
      { barberId: `b-${index}-1`, fullName: 'Amit Jichkar', isAvailable: true, ratingAverage: 4.8 },
      { barberId: `b-${index}-2`, fullName: 'Rahul Wankhede', isAvailable: index % 4 !== 0, ratingAverage: 4.5 },
    ],
  };
}

const SALON_FIXTURES = Array.from({ length: 57 }, (item, index) => salonFixture(index));

const readBody = req => new Promise(resolve => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
  });
  req.on('error', () => resolve({}));
});

const sendJson = (res, payload) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

function devSalonFixturePlugin() {
  return {
    name: 'mynaai-dev-salon-fixture',
    apply: 'serve',
    configureServer(server) {
      if (process.env.MYNAAI_DEV_MOCK_API !== '1') return;
      server.middlewares.use(async (req, res, next) => {
        const path = String(req.url || '').split('?')[0];
        const isList = path === '/api/salons/salon-list' || path === '/api/salons/salon-list-public';
        const isDetail = path === '/api/salons/get-salon-by-id';
        if (!isList && !isDetail) return next();
        const body = req.method === 'POST' ? await readBody(req) : {};
        if (isDetail) {
          const salon = SALON_FIXTURES.find(item => item.salonId === body.salonId);
          return sendJson(res, salon ? { status: 'SUCCESS', data: salon } : { status: 'FAILED', message: 'Salon not found' });
        }
        const query = String(body.searchString || '').trim().toLowerCase();
        const gender = String(body.genderType || '').toUpperCase();
        const matching = SALON_FIXTURES.filter(salon => (
          (!query || `${salon.salonName} ${salon.address}`.toLowerCase().includes(query))
          && (!gender || salon.genderType === gender || salon.genderType === 'UNISEX')
        ));
        const page = Math.max(1, Number(body.page) || 1);
        const pageSize = 20;
        const start = (page - 1) * pageSize;
        const salons = matching.slice(start, start + pageSize);
        console.log(`[dev salon fixture] ${path} page ${page} → ${salons.length}/${matching.length}`);
        return sendJson(res, {
          status: 'SUCCESS',
          data: { salons, totalCount: matching.length, hasMore: start + salons.length < matching.length, page },
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devSalonFixturePlugin()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': { target: 'https://backend.mynaai.in', changeOrigin: true, secure: false },
      '/getfiles': { target: 'https://backend.mynaai.in', changeOrigin: true, secure: false },
      '/getFiles': { target: 'https://backend.mynaai.in', changeOrigin: true, secure: false },
      '/socket.io': { target: 'https://backend.mynaai.in', changeOrigin: true, secure: false, ws: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
