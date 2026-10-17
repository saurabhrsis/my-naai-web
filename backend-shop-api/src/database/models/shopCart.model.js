const { DataTypes } = require('sequelize');

/**
 * Server-side shop cart, keyed by the BUYING SALON.
 *
 * The web portal kept its cart in localStorage, so an item added on the web
 * was invisible to the same salon signed in on the mobile app. This table is
 * the durable cart: every add/update/remove goes through the API, and the
 * cart renders identically on web and app because both read the same rows.
 *
 * Lines reference `shop_products.product_id`; price/name/image are read from
 * the product at render time (an admin price change updates the bill), so
 * only the quantity is stored here.
 */
module.exports = (sequelize) => {
    const ShopCart = sequelize.define('ShopCart', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },

        // The buying salon (salon token in the JWT).
        salonId: {
            type: DataTypes.UUID,
            allowNull: false,
            field: 'salon_id'
        },

        // Shop product in the line (shop_products.product_id).
        productId: {
            type: DataTypes.UUID,
            allowNull: false,
            field: 'product_id'
        },

        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
            validate: { min: 1, max: 99 }
        }
    }, {
        tableName: 'shop_carts',
        timestamps: true,
        indexes: [
            { unique: true, fields: ['salon_id', 'product_id'] },
            { fields: ['salon_id'] }
        ]
    });

    ShopCart.associate = (models) => {
        ShopCart.belongsTo(models.ShopProduct, {
            foreignKey: 'productId',
            as: 'product'
        });
    };

    return ShopCart;
};
