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
