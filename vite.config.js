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

// ── Salon supply shop fixture ───────────────────────────────────────────────
// The partner Shop tab talks to four endpoints the live API does not have yet
// (/api/shop/product-list, /api/orders/create|list|cancel — see
// backend/shopOrders.js for the contract the backend implements). Without a
// fixture the tab is an empty shelf in every preview and the flow cannot be
// reviewed at all. This mirrors the sample catalog in src/lib/shop.js and keeps
// the orders in memory for the life of the dev server.
const SHOP_PRODUCTS = [
  { productId: 'shop-01', productName: 'Professional Hair Cutting Scissors 6.5"', brand: 'Naai Pro', category: 'Tools', price: 1150, mrp: 1499, stock: 24, unit: '1 piece', productImage: '', description: 'Japanese stainless steel barber scissors with an adjustable tension screw.' },
  { productId: 'shop-02', productName: 'Texturising Thinning Scissors', brand: 'Naai Pro', category: 'Tools', price: 890, mrp: 1100, stock: 18, unit: '1 piece', productImage: '', description: '28-tooth thinning shear for de-bulking and blending.' },
  { productId: 'shop-03', productName: 'Hair Colour Tube — Natural Brown 60ml', brand: 'Keune', category: 'Hair colour', price: 520, mrp: 590, stock: 60, unit: '1 tube', productImage: '', description: 'Permanent professional hair colour with 100% grey coverage.' },
  { productId: 'shop-04', productName: 'Hair Colour — Burgundy 60ml', brand: 'Keune', category: 'Hair colour', price: 520, mrp: 590, stock: 44, unit: '1 tube', productImage: '', description: 'Vibrant Burgundy permanent colour with a conditioning base.' },
  { productId: 'shop-05', productName: 'Ammonia-Free Hair Colour Kit (Pack of 3)', brand: 'Gentle Look', category: 'Hair colour', price: 1250, mrp: 1499, stock: 15, unit: 'pack of 3', productImage: '', description: 'Ammonia-free three-tube kit for sensitive scalps.' },
  { productId: 'shop-06', productName: 'Scalp Scrub — Charcoal Detox 200ml', brand: 'Pure Roots', category: 'Hair care', price: 480, mrp: 549, stock: 33, unit: '200 ml', productImage: '', description: 'Charcoal and salicylic acid scrub that lifts build-up and excess oil.' },
  { productId: 'shop-07', productName: 'Keratin Repair Shampoo 500ml', brand: 'Silk Route', category: 'Hair care', price: 690, mrp: 799, stock: 50, unit: '500 ml', productImage: '', description: 'Sulphate-free keratin shampoo for chemically treated hair.' },
  { productId: 'shop-08', productName: 'Argan Oil Hair Serum 100ml', brand: 'Silk Route', category: 'Hair care', price: 560, mrp: 650, stock: 38, unit: '100 ml', productImage: '', description: 'Lightweight argan serum for shine and heat protection.' },
  { productId: 'shop-09', productName: 'Disposable Salon Towels (Pack of 100)', brand: 'Clean Cut', category: 'Consumables', price: 399, mrp: 499, stock: 90, unit: 'pack of 100', productImage: '', description: 'Absorbent, lint-free disposable towels, one per client.' },
  { productId: 'shop-10', productName: 'Hair Colour Brush & Bowl Set', brand: 'Naai Pro', category: 'Consumables', price: 220, mrp: 280, stock: 65, unit: '1 set', productImage: '', description: 'Non-slip mixing bowl with a colour brush and tint comb.' },
  { productId: 'shop-11', productName: 'Shaving Razor + 10 Blades', brand: 'Sharp Edge', category: 'Consumables', price: 340, mrp: 399, stock: 47, unit: '1 razor + 10 blades', productImage: '', description: 'Classic barber razor with ten stainless blades.' },
  { productId: 'shop-12', productName: 'Barber Cape — Waterproof', brand: 'Clean Cut', category: 'Consumables', price: 450, mrp: 549, stock: 0, unit: '1 piece', productImage: '', description: 'Anti-static waterproof cape with an adjustable snap closure.' },
];

const SHOP_ORDERS = [];
let shopOrderSeq = 2407;

// A signed-in partner session. The sandbox (and an offline laptop) cannot reach
// backend.mynaai.in, so without this the login form is a dead end and the
// partner screens — including the new Shop tab — cannot be opened in a preview
// at all. Any 10-digit number signs in; the OTP is 123456.
const DEV_SALON = {
  ...SALON_FIXTURES[0],
  token: 'dev-salon-token',
  userId: SALON_FIXTURES[0].salonId,
  profileCompleted: true,
  isNewSalon: false,
  subscriptionExpired: false,
};

function fixtureOrder(body) {
  shopOrderSeq += 1;
  const catalogue = new Map(SHOP_PRODUCTS.map(item => [item.productId, item]));
  const items = (body.items || []).map(line => {
    const product = catalogue.get(line.productId) || {};
    return {
      productId: line.productId,
      productName: product.productName || line.name || 'Product',
      unit: product.unit || '',
      productImage: product.productImage || '',
      quantity: Number(line.quantity) || 1,
      price: Number(line.price) || product.price || 0,
    };
  }).map(line => ({ ...line, lineTotal: line.price * line.quantity }));
  const subtotal = items.reduce((sum, line) => sum + line.lineTotal, 0);
  return {
    orderId: `order-${shopOrderSeq}`,
    orderNumber: `MN${shopOrderSeq}`,
    status: 'PLACED',
    createdAt: Date.now(),
    items,
    // No delivery charges: the total is what the items cost.
    subtotal,
    totalAmount: Number(body.totalAmount || subtotal),
    paymentMethod: body.paymentMethod || 'COD',
    note: body.note || '',
    address: body.address || {},
    timeline: [{ status: 'PLACED', at: Date.now() }],
  };
}

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
        const isShop = path.startsWith('/api/shop/') || path.startsWith('/api/orders/');
        // Signed-in partner fixtures: without these a preview cannot get past
        // the OTP form, because backend.mynaai.in is unreachable from a sandbox.
        const isSalonAuth = path === '/api/salons/send-otp' || path === '/api/salons/login' || path === '/api/salons/get-salon';
        const isBookingList = path === '/api/booking/get-booking-list';
        if (!isList && !isDetail && !isShop && !isSalonAuth && !isBookingList) return next();
        const body = req.method === 'POST' ? await readBody(req) : {};
        if (path === '/api/salons/send-otp') {
          console.log('[dev salon fixture] OTP requested — use 123456');
          return sendJson(res, { status: 'SUCCESS', message: 'OTP sent (dev fixture: 123456)' });
        }
        if (path === '/api/salons/login') {
          if (String(body.otp || '') !== '123456') return sendJson(res, { status: 'FAILED', message: 'Invalid OTP (dev fixture expects 123456)' });
          console.log('[dev salon fixture] signed in as', DEV_SALON.salonId);
          return sendJson(res, { status: 'SUCCESS', data: DEV_SALON, isNewSalon: false, profileCompleted: true });
        }
        if (path === '/api/salons/get-salon') {
          return sendJson(res, { status: 'SUCCESS', data: { salon: DEV_SALON } });
        }
        if (path === '/api/booking/get-booking-list') {
          return sendJson(res, { status: 'SUCCESS', data: { bookings: [] } });
        }
        if (path === '/api/shop/product-list') {
          const query = String(body.search || '').trim().toLowerCase();
          const category = String(body.category || '').trim().toLowerCase();
          const products = SHOP_PRODUCTS.filter(product => (
            (!category || category === 'all' || String(product.category).toLowerCase() === category)
            && (!query || `${product.productName} ${product.brand} ${product.category}`.toLowerCase().includes(query))
          ));
          console.log(`[dev shop fixture] product-list → ${products.length}/${SHOP_PRODUCTS.length}`);
          return sendJson(res, { status: 'SUCCESS', data: { products } });
        }
        if (path === '/api/orders/create') {
          const order = fixtureOrder(body);
          SHOP_ORDERS.unshift(order);
          console.log(`[dev shop fixture] order ${order.orderNumber} placed (${order.items.length} lines, Rs ${order.totalAmount})`);
          return sendJson(res, { status: 'SUCCESS', data: { order } });
        }
        if (path === '/api/orders/list') {
          return sendJson(res, { status: 'SUCCESS', data: { orders: SHOP_ORDERS } });
        }
        if (path === '/api/orders/cancel') {
          const order = SHOP_ORDERS.find(item => item.orderId === body.orderId);
          if (!order) return sendJson(res, { status: 'FAILED', message: 'Order not found' });
          // A delivered parcel cannot be called back — the same rule the app applies.
          if (order.status === 'DELIVERED') return sendJson(res, { status: 'FAILED', message: 'This order has already been delivered.' });
          order.status = 'CANCELLED';
          order.timeline = [...(order.timeline || []), { status: 'CANCELLED', at: Date.now() }];
          console.log(`[dev shop fixture] order ${order.orderNumber} cancelled`);
          return sendJson(res, { status: 'SUCCESS', data: { order } });
        }
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
