const express = require('express');
const { authenticateSalon } = require('../utils/middleware/authSalon.middleware');
const addProduct = require('../controller/product/createProduct');
const updateProduct = require('../controller/product/updateProduct');
const productList = require('../controller/product/getProductList');
const deleteProduct = require('../controller/product/deleteProduct');
const getAllSalonsProducts = require('../controller/product/allSalonsProductsList');
const authenticateUser = require('../utils/middleware/authUser.middleware');
const checkPlanActive = require('../utils/middleware/checkPlanActive');


const productRouter = express.Router();

//user authenticate
productRouter.post('/get-all-salons-products-list', authenticateUser, getAllSalonsProducts);

// All routes require salon authentication
productRouter.use(authenticateSalon);

productRouter.post('/create', addProduct);
productRouter.post('/update', updateProduct);
productRouter.post('/list', checkPlanActive , productList);
productRouter.post('/delete',  deleteProduct);






module.exports = productRouter;