const express = require('express');
const { authenticateSalon } = require('../utils/middleware/authSalon.middleware');
const { authenticateAdmin } = require('../utils/middleware/auth.middleware');
const { authenticateDistributorOrAdmin } = require('../utils/middleware/authDistributorOrAdmin.middleware');
const createShopOrder = require('../controller/shopOrder/createShopOrder');
const listShopOrders = require('../controller/shopOrder/listShopOrders');
const getShopOrderById = require('../controller/shopOrder/getShopOrderById');
const cancelShopOrder = require('../controller/shopOrder/cancelShopOrder');
const adminListShopOrders = require('../controller/shopOrder/adminListShopOrders');
const adminGetShopOrderById = require('../controller/shopOrder/adminGetShopOrderById');
const adminUpdateShopOrderStatus = require('../controller/shopOrder/adminUpdateShopOrderStatus');
const adminAssignDistributor = require('../controller/shopOrder/adminAssignDistributor');
const distributorAcceptOrder = require('../controller/shopOrder/distributorAcceptOrder');
const distributorRejectOrder = require('../controller/shopOrder/distributorRejectOrder');
const distributorListOrders = require('../controller/shopOrder/distributorListOrders');
const distributorUpdateOrderStatus = require('../controller/shopOrder/distributorUpdateOrderStatus');

const shopOrderRouter = express.Router();

// Buying salon — its own orders (the SALON status track is what it sees).
shopOrderRouter.post('/create', authenticateSalon, createShopOrder);
shopOrderRouter.post('/list', authenticateSalon, listShopOrders);
shopOrderRouter.post('/get-by-id', authenticateSalon, getShopOrderById);
shopOrderRouter.post('/cancel', authenticateSalon, cancelShopOrder);

// Company admin — every salon's orders, both status tracks, distributor
// assignment. The admin/distributor view filters by distributorId.
shopOrderRouter.post('/admin-list', authenticateAdmin, adminListShopOrders);
shopOrderRouter.post('/admin-get-by-id', authenticateAdmin, adminGetShopOrderById);
shopOrderRouter.post('/admin-update-status', authenticateAdmin, adminUpdateShopOrderStatus);
shopOrderRouter.post('/admin-assign-distributor', authenticateAdmin, adminAssignDistributor);

// Distributor portal (distributor token) — the admin token is accepted too,
// so the admin can record a distributor's accept/reject on their behalf.
shopOrderRouter.post('/distributor-orders', authenticateDistributorOrAdmin, distributorListOrders);
shopOrderRouter.post('/distributor-accept', authenticateDistributorOrAdmin, distributorAcceptOrder);
shopOrderRouter.post('/distributor-reject', authenticateDistributorOrAdmin, distributorRejectOrder);
// After accepting, the distributor carries the parcel: ASSIGNED -> PICKED ->
// SHIPPED -> DELIVERED (next step only). Admin token accepted on their behalf.
shopOrderRouter.post('/distributor-update-status', authenticateDistributorOrAdmin, distributorUpdateOrderStatus);

module.exports = shopOrderRouter;
