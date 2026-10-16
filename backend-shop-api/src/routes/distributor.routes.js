const express = require('express');
const { authenticateAdmin } = require('../utils/middleware/auth.middleware');
const listDistributors = require('../controller/distributor/listDistributors');
const createDistributor = require('../controller/distributor/createDistributor');
const updateDistributor = require('../controller/distributor/updateDistributor');

// Delivery partners (company admin). Orders get a distributorId via
// /api/shop-orders/admin-assign-distributor.
const distributorRouter = express.Router();
distributorRouter.post('/list', authenticateAdmin, listDistributors);
distributorRouter.post('/create', authenticateAdmin, createDistributor);
distributorRouter.post('/update', authenticateAdmin, updateDistributor);

module.exports = distributorRouter;
