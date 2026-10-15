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

// The Naai Shop catalog under the same env flag: the products endpoint the
// shop screen reads, with the category/gender facets the shop filters use.
const SHOP_PRODUCT_FIXTURES = [
  { productId: 'shop-1', productName: 'Keratin Repair Shampoo 200ml', price: 499, mrp: 649, rating: 4.8, isAvailable: true, productImage: '', category: 'hair-care', gender: 'UNISEX', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-2', productName: 'Matte Clay Pomade 90g', price: 599, mrp: 749, rating: 4.6, isAvailable: true, productImage: '', category: 'hair-care', gender: 'MALE', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-3', productName: 'Beard Oil 30ml', price: 299, mrp: 399, rating: 4.7, isAvailable: true, productImage: '', category: 'beard-grooming', gender: 'MALE', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-4', productName: 'Beard Trimmer Pro', price: 1899, mrp: 2499, rating: 4.4, isAvailable: true, productImage: '', category: 'tools-equipment', gender: 'MALE', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-5', productName: 'Hair Clipper 2200', price: 2499, mrp: 2999, rating: 4.5, isAvailable: true, productImage: '', category: 'tools-equipment', gender: 'UNISEX', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-6', productName: 'Argan Hair Serum 100ml', price: 449, mrp: 599, rating: 4.3, isAvailable: true, productImage: '', category: 'hair-care', gender: 'FEMALE', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-7', productName: 'Henna Hair Colour Pack', price: 349, mrp: 449, rating: 4.2, isAvailable: true, productImage: '', category: 'hair-colour', gender: 'FEMALE', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-8', productName: 'Sandalwood Perfume 50ml', price: 799, mrp: 999, rating: 4.6, isAvailable: true, productImage: '', category: 'fragrance', gender: 'UNISEX', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-9', productName: 'Face Cleanser for Oily Skin 150ml', price: 399, mrp: 499, rating: 4.1, isAvailable: true, productImage: '', category: 'skin-face', gender: 'UNISEX', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-10', productName: 'Hair Spa Ritual Kit', price: 1299, mrp: 1599, rating: 4.9, isAvailable: true, productImage: '', category: 'kits-sets', gender: 'UNISEX', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-11', productName: 'Salon Cape & Apron Set', price: 899, mrp: 1199, rating: 4.0, isAvailable: true, productImage: '', category: 'tools-equipment', gender: 'UNISEX', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
  { productId: 'shop-12', productName: 'Castor Hair Oil 200ml', price: 249, mrp: 329, rating: 4.4, isAvailable: false, productImage: '', category: 'hair-care', gender: 'UNISEX', salon: { salonName: 'My Naai Supplies', genderType: 'UNISEX' } },
];

// A complete demo salon so a partner can sign in OFFLINE (any number, any
// OTP) and walk the whole portal — queue, shop, checkout, orders — without
// the real backend. Active plan on purpose: an expired plan would paywall the
// shell before the shop is ever reachable.
const DEV_SALON = {
  salonId: 'dev-salon-1',
  salonName: 'Golden Scissors',
  genderType: 'UNISEX',
  ownerName: 'Ramesh Kumar',
  phoneNumber: '9876543210',
  addressLine1: '10 Dharampeth Main Road',
  address: 'Dharampeth, Nagpur',
  city: 'Nagpur',
  state: 'Maharashtra',
  pincode: '440010',
  latitude: 21.1458,
  longitude: 79.0882,
  isOpen: true,
  imageUrl: '',
  imagesArray: [],
  profileCompleted: true,
  planType: 'quarterly',
  planStartDate: '2026-10-01',
  planEndDate: '2027-01-01',
  isPlanActive: true,
  businessHours: [{ openingTime: '09:00:00', closingTime: '21:00:00', holidayDays: ['1'] }],
  services: SERVICES,
  barbers: [
    { barberId: 'dev-barber-1', fullName: 'Amit Jichkar', isAvailable: true, ratingAverage: 4.8 },
    { barberId: 'dev-barber-2', fullName: 'Rahul Wankhede', isAvailable: true, ratingAverage: 4.5 },
  ],
};

// Everything the signed-in shell reads on boot, answered from the fixtures so
// no request leaks to the (unreachable-in-sandbox) production API. The real
// endpoints are untouched in production builds — `apply: 'serve'` plus the
// env flag keep this strictly a local-preview aid.
const DEV_MOCK_ENDPOINTS = {
  '/api/salons/send-otp': { status: 'SUCCESS', message: 'OTP sent (dev fixture)' },
  '/api/salons/login': {
    status: 'SUCCESS',
    data: { token: 'dev-salon-token', userId: 'dev-salon-1', profileCompleted: true, salon: DEV_SALON },
  },
  '/api/salons/get-salon': { status: 'SUCCESS', data: DEV_SALON },
  '/api/salons/open-close': { status: 'SUCCESS' },
  '/api/users/send-otp': { status: 'SUCCESS', message: 'OTP sent (dev fixture)' },
  '/api/users/verify-otp': body => ({
    status: 'SUCCESS',
    isUserExist: true,
    data: { token: 'dev-user-token', userId: 'dev-user-1', fullName: 'Demo Customer', phoneNumber: body?.phoneNumber || '9876500000' },
  }),
  '/api/users/profile': { status: 'SUCCESS', data: { userId: 'dev-user-1', fullName: 'Demo Customer', phoneNumber: '9876500000' } },
  '/api/users/update': { status: 'SUCCESS' },
  '/api/booking/get-booking-list': { status: 'SUCCESS', data: { bookings: [] } },
  '/api/booking/get-list': { status: 'SUCCESS', data: { bookings: [] } },
  '/api/booking/get-completed-bookings': { status: 'SUCCESS', data: { bookings: [] } },
  '/api/products/list': { status: 'SUCCESS', data: { products: SHOP_PRODUCT_FIXTURES.slice(0, 4) } },
  '/api/notifications/register-device': { status: 'SUCCESS' },
  '/api/notifications/test-push': { status: 'SUCCESS' },
  '/api/notifications/get-salon-notification-list': { status: 'SUCCESS', data: { notifications: [] } },
  '/api/notifications/get-user-notification-list': { status: 'SUCCESS', data: { notifications: [] } },
  '/api/notifications/get-salon-notification-count': { status: 'SUCCESS', data: { count: 0 } },
  '/api/notifications/get-user-notification-count': { status: 'SUCCESS', data: { count: 0 } },
  '/api/advertisement/get-advertisement': { status: 'SUCCESS', data: { advertisements: [] } },
};

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
        const isShopProducts = path === '/api/products/get-all-salons-products-list';
        if (isShopProducts) return sendJson(res, { status: 'SUCCESS', data: { products: SHOP_PRODUCT_FIXTURES } });
        const mock = DEV_MOCK_ENDPOINTS[path];
        if (mock) {
          const body = req.method === 'POST' ? await readBody(req) : {};
          return sendJson(res, typeof mock === 'function' ? mock(body) : mock);
        }
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
