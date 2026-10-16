const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Product = sequelize.define('Product', {
        productId: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },

        salonId: {
            type: DataTypes.UUID,
            allowNull: false
        },

        productName: {
            type: DataTypes.STRING,
            allowNull: false
        },

        productImage: {
            type: DataTypes.STRING, // image URL / path
            allowNull: true
        },

        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },

        // Shop flow (web catalog editor): MRP drives the "% off" badge.
        mrp: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
        },

        // Shop flow: category + gender skip the frontend's name-based
        // inference when set (see my-naai-web/src/lib/shopCatalog.js).
        category: {
            type: DataTypes.STRING(60),
            allowNull: true,
            defaultValue: ''
        },

        // NULL (not 'UNISEX') for products without an explicit gender: the
        // shop UI falls back to the SELLING salon's genderType for legacy
        // salon products. A default would make every pre-shop row read as
        // explicitly unisex and skip that fallback.
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
    },
        {
            tableName: 'products',
            timestamps: true
        }
    );

    Product.associate = (models) => {
        Product.belongsTo(models.Salon, {
            foreignKey: 'salonId',
            as: 'salon'
        });
    };

    return Product;
};
