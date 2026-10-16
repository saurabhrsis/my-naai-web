const { updateProductSchema } = require("../../validations/product.validation");
const productService = require("../../services/product.service");

const updateProduct = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({
                status: 'FAILED',
                message: 'Salon Id not found in token'
            });
        }

        const { productId, productImage, productName, price, rating, isAvailable, mrp, category, gender, description } = request.body || {};

        const validationResult = updateProductSchema.validate(
            { productId, productImage, productName, price, rating, isAvailable, mrp, category, gender, description },
            { abortEarly: true }
        );

        if (validationResult.error) {
            return response.status(400).json({
                status: 'FAILED',
                message: validationResult.error.details[0].message
            });
        }

        const dataToUpdate = {
            productImage,
            productName,
            price,
            rating
        };

        // Shop fields — only touch what the client actually sent, so a
        // partial update (e.g. price only) never clears them.
        if (mrp !== undefined) dataToUpdate.mrp = mrp ?? null;
        if (category !== undefined) dataToUpdate.category = category || '';
        if (gender !== undefined) dataToUpdate.gender = gender || null;
        if (description !== undefined) dataToUpdate.description = description || null;

        if (typeof isAvailable === 'boolean') {
            dataToUpdate.isAvailable = isAvailable;
            dataToUpdate.stockStatus = isAvailable ? 'available' : 'out_of_stock';
        }

        const result = await productService.updateProduct(
            productId,
            salonId,
            dataToUpdate
        );

        if (!result) {
            return response.status(404).json({
                status: 'FAILED',
                message: 'Product not found'
            });
        }

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Product updated successfully',
                data: {
                productId: result.productId,
                productName: result.productName,
                price: result.price,
                mrp: result.mrp,
                category: result.category,
                gender: result.gender,
                description: result.description,
                rating: result.rating,
                isAvailable: result.isAvailable,
                stockStatus: result.stockStatus,
                productImage: result.productImage
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

module.exports = updateProduct;
