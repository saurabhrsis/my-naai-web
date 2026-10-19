const { DataTypes } = require('sequelize');

/**
 * Shop settings — the admin-managed shop commerce rules.
 *
 * The table holds exactly ONE row (id = 1). It is seeded on first read
 * (see shopSettings.service.getSettings) with the same defaults the shop
 * shipped with, so a deployment that never touches the admin panel keeps
 * the historical behaviour (₹49 delivery, free above ₹499, no discount,
 * no COD limits).
 *
 *   freeDeliveryAbove  minimum item total (after discount) for free delivery
 *   deliveryFee        flat delivery fee when the order is below the threshold
 *   discountPercent    percentage off the whole item total (0–100)
 *   codThreshold       max item total that may still be paid Cash on Delivery
 *                      (0 = no limit)
 *   codCharges         extra fee charged when the customer chooses COD
 */
module.exports = (sequelize) => {
    const ShopSettings = sequelize.define('ShopSettings', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false,
            autoIncrement: false
        },

        freeDeliveryAbove: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 499,
            field: 'free_delivery_above'
        },

        deliveryFee: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 49,
            field: 'delivery_fee'
        },

        discountPercent: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            defaultValue: 0,
            field: 'discount_percent'
        },

        codThreshold: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
            field: 'cod_threshold'
        },

        codCharges: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
            field: 'cod_charges'
        }
    }, {
        tableName: 'shop_settings',
        timestamps: true,
        updatedAt: false
    });

    return ShopSettings;
};
