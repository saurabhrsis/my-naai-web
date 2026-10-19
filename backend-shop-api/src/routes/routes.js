const express = require('express');
const adminRouter = require('./admin.routes');
const salonRouter = require('./salon.routes');
const userRouter = require('./user.routes');
const barberRouter = require('./barber.route');
const bookingRouter = require('./booking.routes');
const salonRequestRouter = require('./salonrequest.routes');
const ImageRoutes = require('./upload.routes');
const advertisementRouter = require('./advertisement.routes');
const productRouter = require('./product.routes');
const shopProductRouter = require('./shopProduct.routes');
const shopCartRouter = require('./shopCart.routes');
const distributorRouter = require('./distributor.routes');
const shopOrderRouter = require('./shopOrder.routes');
const shopSettingsRouter = require('./shopSettings.routes');
const razorpayWebhook = require('../controller/razorpay/razorpayWebhook');
const notificationRouter = require('./notification.routes');
const bookingRequestRouter = require('./bookingRequest.routes');
const adminNotificationRouter = require('./adminNotification.routes');


const routes = express.Router();

// Import module routes


// Mount routes
routes.use('/admin', adminRouter);
routes.use('/salons', salonRouter);
routes.use('/users', userRouter)
routes.use('/barbers', barberRouter)
routes.use('/booking', bookingRouter);
routes.use('/salonrequest', salonRequestRouter);
routes.use('/advertisement', advertisementRouter);
routes.use('/products', productRouter);
// The shop (salons buying company stock) lives on its OWN tables:
// /shop-products (the company catalog), /shop-cart (per-salon server cart),
// /distributors (delivery partners) and /shop-orders (two status tracks).
routes.use('/shop-products', shopProductRouter);
routes.use('/shop-cart', shopCartRouter);
routes.use('/distributors', distributorRouter);
routes.use('/shop-orders', shopOrderRouter);
routes.use('/shop-settings', shopSettingsRouter);

// Razorpay webhook — public, but signature-verified (raw body HMAC-SHA256).
routes.post('/razorpay/webhook', razorpayWebhook);
routes.use('/notifications',notificationRouter);
routes.use('/bookingRequest',bookingRequestRouter);
routes.use('/adminNotification',adminNotificationRouter);



routes.use('/upload', ImageRoutes);


module.exports = routes;