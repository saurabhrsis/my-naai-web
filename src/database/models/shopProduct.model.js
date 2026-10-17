const { DataTypes } = require('sequelize');

/**
 * Shop product — the company catalog that SALONS buy from (B2B shop).
 *
 * This is deliberately a SEPARATE table from `products`: that table holds
 * each salon's own customer-facing products (the legacy salon shelf), and
 * the two catalogs must never be mixed. Shop products belong to the company,
 * not to a salon, so there is no salonId here.
 */
module.exports = (sequelize) => {
    const ShopProduct = sequelize.define('ShopProduct', {
        productId: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            field: 'product_id'
        },

        productName: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'product_name'
        },

        // Same file-path pattern as every other image in the app; multiple
        // uploads are joined with commas, first image is the cover.
        productImage: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'product_image'
        },

        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },

        // MRP drives the "% off" badge in the shop UI (null/0 = no discount).
        mrp: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
        },

        // Shop filter chips (hair-care, beard-grooming, ...). '' = let the
        // client infer from the name.
        category: {
            type: DataTypes.STRING(60),
            allowNull: true,
            defaultValue: ''
        },

        // NULL (not 'UNISEX') when no explicit gender is set — same rule as
        // the legacy products: an explicit value wins, otherwise the client
        // falls back to inference.
        gender: {
            type: DataTypes.ENUM('MALE', 'FEMALE', 'UNISEX'),
            allowNull: true
        },

        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },

        rating: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0
        },

        isAvailable: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },

        stockStatus: {
            type: DataTypes.ENUM('available', 'out_of_stock'),
            allowNull: false,
            defaultValue: 'available'
        },

        deletedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'deleted_at'
        }
    }, {
        tableName: 'shop_products',
        timestamps: true
    });

    return ShopProduct;
};
