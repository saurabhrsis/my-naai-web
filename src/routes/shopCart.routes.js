const express = require('express');
const { authenticateSalon } = require('../utils/middleware/authSalon.middleware');
const getShopCart = require('../controller/shopCart/getShopCart');
const addToShopCart = require('../controller/shopCart/addToShopCart');
const setShopCartLineQty = require('../controller/shopCart/setShopCartLineQty');
const removeFromShopCart = require('../controller/shopCart/removeFromShopCart');
const clearShopCart = require('../controller/shopCart/clearShopCart');

// The cart belongs to the BUYING SALON's account — the same identity that
// owns the shop orders — so web and mobile app share it.
const shopCartRouter = express.Router();
shopCartRouter.use(authenticateSalon);

shopCartRouter.post('/get', getShopCart);
shopCartRouter.post('/add', addToShopCart);
shopCartRouter.post('/set-qty', setShopCartLineQty);
shopCartRouter.post('/remove', removeFromShopCart);
shopCartRouter.post('/clear', clearShopCart);

module.exports = shopCartRouter;
