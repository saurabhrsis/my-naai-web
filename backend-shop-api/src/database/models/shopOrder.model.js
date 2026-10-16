const { DataTypes } = require('sequelize');

/**
 * Naai Shop order (B2B — a salon buying stock for its shop).
 *
 * The web portal's shop currently keeps its cart and orders in localStorage
 * and pays order-less through Razorpay Checkout. This model is the durable
 * record: the client snapshots the exact same shape it stores locally
 * (`src/lib/shopOrders.js` on the frontend) and the backend recomputes the
 * bill server-side so the amounts can never be faked from the client.
 *
 * `payment` is a snapshot object, not a table:
 *   { method: 'ONLINE' | 'COD', status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUND_REQUESTED' | 'REFUNDED', paymentId, amount }
 * `amounts` mirrors the client's bill:
 *   { itemCount, itemTotal, savings, deliveryFee, total, freeDeliveryAbove }
 */
module.exports = (sequelize) => {
    const ShopOrder = sequelize.define('ShopOrder', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },

        // Human-facing order id, same format the frontend generates:
        // 'MN' + base36 timestamp + 4 unambiguous random chars.
        orderId: {
            type: DataTypes.STRING(32),
            allowNull: false,
            unique: true,
            field: 'order_id'
        },

        // The buying salon (salon token in the JWT). Sellers are per-line in
        // `items[].productId` / `items[].salonName`.
        salonId: {
            type: DataTypes.UUID,
            allowNull: false,
            field: 'salon_id'
        },

        // Snapshot of the cart lines at placement time:
        // [{ productId, name, price, mrp, image, category, gender, salonName, qty }]
        items: {
            type: DataTypes.JSONB,
            allowNull: false,
            field: 'items'
        },

        // Delivery address snapshot:
        // { name, phone, line1, city, state, pincode }
        address: {
            type: DataTypes.JSONB,
            allowNull: false,
            field: 'address'
        },

        payment: {
            type: DataTypes.JSONB,
            allowNull: false,
            field: 'payment'
        },

        amounts: {
            type: DataTypes.JSONB,
            allowNull: false,
            field: 'amounts'
        },

        // PENDING (placed, COD or online-unconfirmed) -> CONFIRMED (payment
        // captured / order accepted) -> PROCESSING -> SHIPPED -> DELIVERED.
        // CANCELLED is terminal (buyer self-service or admin).
        status: {
            type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'),
            allowNull: false,
            defaultValue: 'PENDING',
            field: 'status'
        },

        cancelledAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'cancelled_at'
        },

        cancelReason: {
            type: DataTypes.STRING(500),
            allowNull: true,
            field: 'cancel_reason'
        },

        // Free-form admin notes (status updates, support remarks).
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            field: 'notes'
        }
    }, {
        tableName: 'shop_orders',
        timestamps: true
    });

    ShopOrder.associate = (models) => {
        ShopOrder.belongsTo(models.Salon, {
            foreignKey: 'salonId',
            as: 'salon'
        });
    };

    return ShopOrder;
};
