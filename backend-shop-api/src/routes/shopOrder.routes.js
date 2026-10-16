const express = require('express');
const { authenticateSalon } = require('../utils/middleware/authSalon.middleware');
const { authenticateAdmin } = require('../utils/middleware/auth.middleware');
const createShopOrder = require('../controller/shopOrder/createShopOrder');
const listShopOrders = require('../controller/shopOrder/listShopOrders');
const getShopOrderById = require('../controller/shopOrder/getShopOrderById');
const cancelShopOrder = require('../controller/shopOrder/cancelShopOrder');
const adminListShopOrders = require('../controller/shopOrder/adminListShopOrders');
const adminGetShopOrderById = require('../controller/shopOrder/adminGetShopOrderById');
const adminUpdateShopOrderStatus = require('../controller/shopOrder/adminUpdateShopOrderStatus');

const shopOrderRouter = express.Router();

// Buying salon — its own orders
shopOrderRouter.post('/create', authenticateSalon, createShopOrder);
shopOrderRouter.post('/list', authenticateSalon, listShopOrders);
shopOrderRouter.post('/get-by-id', authenticateSalon, getShopOrderById);
shopOrderRouter.post('/cancel', authenticateSalon, cancelShopOrder);

// Company admin — every salon's orders
shopOrderRouter.post('/admin-list', authenticateAdmin, adminListShopOrders);
shopOrderRouter.post('/admin-get-by-id', authenticateAdmin, adminGetShopOrderById);
shopOrderRouter.post('/admin-update-status', authenticateAdmin, adminUpdateShopOrderStatus);

module.exports = shopOrderRouter;
