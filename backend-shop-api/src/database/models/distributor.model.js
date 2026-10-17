const { DataTypes } = require('sequelize');

/**
 * Distributor — a delivery partner the company admin assigns a shop order
 * to. Orders carry `distributorId`; the admin (and later, distributor
 * accounts) see the internal status track per distributor.
 */
module.exports = (sequelize) => {
    const Distributor = sequelize.define('Distributor', {
        distributorId: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            field: 'distributor_id'
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false
        },

        phone: {
            type: DataTypes.STRING,
            allowNull: true
        },

        email: {
            type: DataTypes.STRING,
            allowNull: true
        },

        // Pickup / delivery area (free text, e.g. "Nagpur — west city").
        area: {
            type: DataTypes.STRING(200),
            allowNull: true
        },

        // Delivery capability, free text (e.g. "2 bikes + 1 van, 50 orders
        // a day") — shown to the admin when choosing a distributor.
        deliveryCapability: {
            type: DataTypes.STRING(200),
            allowNull: true,
            field: 'delivery_capability'
        },

        // bcrypt hash. NULL means the distributor has no portal login yet
        // (the admin sets a password when creating/updating them).
        password: {
            type: DataTypes.STRING(255),
            allowNull: true
        },

        address: {
            type: DataTypes.TEXT,
            allowNull: true
        },

        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            field: 'is_active'
        }
    }, {
        tableName: 'distributors',
        timestamps: true
    });

    return Distributor;
};
