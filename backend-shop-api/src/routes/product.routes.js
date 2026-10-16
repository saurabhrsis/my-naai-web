const express = require('express');
const { authenticateSalon } = require('../utils/middleware/authSalon.middleware');
const { authenticateAdmin } = require('../utils/middleware/auth.middleware');
const authenticateUserOrSalon = require('../utils/middleware/authUserOrSalon.middleware');
const addProduct = require('../controller/product/createProduct');
const updateProduct = require('../controller/product/updateProduct');
const productList = require('../controller/product/getProductList');
const deleteProduct = require('../controller/product/deleteProduct');
const getAllSalonsProducts = require('../controller/product/allSalonsProductsList');
const adminListProducts = require('../controller/product/adminListProducts');
const adminCreateProduct = require('../controller/product/adminCreateProduct');
const adminUpdateProduct = require('../controller/product/adminUpdateProduct');
const adminDeleteProduct = require('../controller/product/adminDeleteProduct');
const checkPlanActive = require('../utils/middleware/checkPlanActive');


const productRouter = express.Router();

// Marketplace catalog — mobile app browses as a USER, the web shop as a
// SALON; authenticateUserOrSalon accepts either token.
productRouter.post('/get-all-salons-products-list', authenticateUserOrSalon, getAllSalonsProducts);

// Admin product management (company backend) — any salon's catalog.
productRouter.post('/admin-list', authenticateAdmin, adminListProducts);
productRouter.post('/admin-create', authenticateAdmin, adminCreateProduct);
productRouter.post('/admin-update', authenticateAdmin, adminUpdateProduct);
productRouter.post('/admin-delete', authenticateAdmin, adminDeleteProduct);

// All routes require salon authentication
productRouter.use(authenticateSalon);

productRouter.post('/create', addProduct);
productRouter.post('/update', updateProduct);
productRouter.post('/list', checkPlanActive , productList);
productRouter.post('/delete',  deleteProduct);




module.exports = productRouter;
