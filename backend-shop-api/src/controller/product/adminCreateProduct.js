const { adminCreateProductSchema } = require('../../validations/product.validation');
const productService = require('../../services/product.service');
const db = require('../../database/models');

// Company admin: create a product in any salon's catalog (the salon-scoped
// /create can only write the token's own salon).
const adminCreateProduct = async (request, response) => {
    try {
        const { salonId, productImage, productName, price, rating, isAvailable, mrp, category, gender, description } = request.body || {};

        const validationResult = adminCreateProductSchema.validate(
            { salonId, productImage, productName, price, rating, isAvailable, mrp, category, gender, description },
            { abortEarly: true }
        );

        if (validationResult.error) {
            return response.status(400).json({
                status: 'FAILED',
                message: validationResult.error.details[0].message
            });
        }

        const value = validationResult.value;

        // The product must belong to a real salon — the salon relation is
        // what the catalog UI renders next to every product.
        const salon = await db.Salon.findOne({ where: { salonId: value.salonId } });
        if (!salon) {
            return response.status(400).json({
                status: 'FAILED',
                message: 'Salon not found'
            });
        }

        const dataToInsert = {
            salonId: value.salonId,
            productName: value.productName,
            price: value.price,
            rating: value.rating,
            isAvailable: value.isAvailable,
            productImage: value.productImage || null,
            mrp: value.mrp ?? null,
            category: value.category || '',
            // NULL keeps the shop's seller-salon gender fallback alive for
            // products created without an explicit gender (legacy flow).
            gender: value.gender || null,
            description: value.description || null
        };

        const result = await productService.createProduct(dataToInsert);

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
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({
            status: 'FAILED',
            message: error.message
        });
    }
};

module.exports = adminCreateProduct;
