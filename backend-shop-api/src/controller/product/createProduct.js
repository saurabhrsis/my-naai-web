const { addProductSchema } = require("../../validations/product.validation");
const productService = require("../../services/product.service");

const addProduct = async (request, response) => {
    try {
        const salonId = request.salon.salonId; //the salonId is comes from token
        if (!salonId) {
            return response.status(400).json({
                status: 'FAILED',
                message: 'Salon Id not found in token'
            });
        }
        const { productImage, productName, price, rating, isAvailable, mrp, category, gender, description } = request.body || {};

        //validate input
        const validationResult = addProductSchema.validate({ productImage, productName, price, rating, isAvailable, mrp, category, gender, description }, { abortEarly: true });

        if (validationResult.error) {
            return response.status(400).json({
                status: 'FAILED',
                message: validationResult.error.details[0].message
            });
        }
        //prepare data to insert — shop fields are optional; blank/absent values
        //fall back to the defaults so the pre-shop payload shape still works.
        const dataToInsert = {
            salonId: salonId,
            productName,
            price,
            rating,
            isAvailable,
            productImage,
            mrp: mrp ?? null,
            category: category || '',
            // NULL keeps the shop's seller-salon gender fallback alive for
            // products created without an explicit gender (legacy flow).
            gender: gender || null,
            description: description || null
        };

        const result = await productService.createProduct(dataToInsert);

        if (result) {
            return response.status(200).json({
                status: 'SUCCESS',
                message: 'Product added successfully',
                data: {
                    productId: result?.productId,
                    productName: result?.productName,
                    price: result?.price,
                    mrp: result?.mrp,
                    category: result?.category,
                    gender: result?.gender,
                    description: result?.description,
                    rating: result?.rating,
                    isAvailable: result?.isAvailable,
                    stockStatus: result?.stockStatus,
                    productImage: result?.productImage
                }
            });
        } else {
            return response.status(400).json({
                status: 'FAILED',
                message: 'Failed to add product, please try again!'
            });
        }
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({
            status: 'FAILED',
            message: error.message
        });
    }
};
module.exports = addProduct;