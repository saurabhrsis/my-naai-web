const express = require('express');
const { authenticateAdmin } = require('../utils/middleware/auth.middleware');
const getShopSettings = require('../controller/shopSettings/getShopSettings');
const adminUpdateShopSettings = require('../controller/shopSettings/adminUpdateShopSettings');

const shopSettingsRouter = express.Router();

// Public read — the web shop needs these to show honest delivery/COD copy.
shopSettingsRouter.post('/get', getShopSettings);

// Company admin — the only writer.
shopSettingsRouter.post('/admin-update', authenticateAdmin, adminUpdateShopSettings);

module.exports = shopSettingsRouter;
