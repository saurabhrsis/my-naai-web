const express = require('express');
const { authenticateAdmin } = require('../utils/middleware/auth.middleware');
const authenticateUserOrSalon = require('../utils/middleware/authUserOrSalon.middleware');
const listShopProducts = require('../controller/shopProduct/listShopProducts');
const adminListShopProducts = require('../controller/shopProduct/adminListShopProducts');
const adminCreateShopProduct = require('../controller/shopProduct/adminCreateShopProduct');
const adminUpdateShopProduct = require('../controller/shopProduct/adminUpdateShopProduct');
const adminDeleteShopProduct = require('../controller/shopProduct/adminDeleteShopProduct');

const shopProductRouter = express.Router();

// Buying-side catalog: mobile app (user token) and web shop (salon token).
// These are the COMPANY's shop products — a separate table from the
// salons' customer-facing products (/api/products/*).
shopProductRouter.post('/list', authenticateUserOrSalon, listShopProducts);

// Company admin manages the catalog.
shopProductRouter.post('/admin-list', authenticateAdmin, adminListShopProducts);
shopProductRouter.post('/admin-create', authenticateAdmin, adminCreateShopProduct);
shopProductRouter.post('/admin-update', authenticateAdmin, adminUpdateShopProduct);
shopProductRouter.post('/admin-delete', authenticateAdmin, adminDeleteShopProduct);

module.exports = shopProductRouter;
