const { adminUpdateProductSchema } = require('../../validations/product.validation');
const productService = require('../../services/product.service');

// Company admin: partially update ANY salon's product (the salon-scoped
// /update can only touch the token's own salon). Unsent fields are left as-is.
const adminUpdateProduct = async (request, response) => {
    try {
        const { productId, productImage, productName, price, rating, isAvailable, mrp, category, gender, description } = request.body || {};

        const validationResult = adminUpdateProductSchema.validate(
            { productId, productImage, productName, price, rating, isAvailable, mrp, category, gender, description },
            { abortEarly: true }
        );

        if (validationResult.error) {
            return response.status(400).json({
                status: 'FAILED',
                message: validationResult.error.details[0].message
            });
        }

        const dataToUpdate = {};
        if (productImage !== undefined) dataToUpdate.productImage = productImage || null;
        if (productName !== undefined) dataToUpdate.productName = productName;
        if (price !== undefined) dataToUpdate.price = price;
        if (rating !== undefined) dataToUpdate.rating = rating;
        if (mrp !== undefined) dataToUpdate.mrp = mrp ?? null;
        if (category !== undefined) dataToUpdate.category = category || '';
        if (gender !== undefined) dataToUpdate.gender = gender || null;
        if (description !== undefined) dataToUpdate.description = description || null;

        if (typeof isAvailable === 'boolean') {
            dataToUpdate.isAvailable = isAvailable;
            dataToUpdate.stockStatus = isAvailable ? 'available' : 'out_of_stock';
        }

        if (Object.keys(dataToUpdate).length === 0) {
            return response.status(400).json({
                status: 'FAILED',
                message: 'No fields to update'
            });
        }

        const result = await productService.updateProductAny(productId, dataToUpdate);
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

module.exports = adminUpdateProduct;
