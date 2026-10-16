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
