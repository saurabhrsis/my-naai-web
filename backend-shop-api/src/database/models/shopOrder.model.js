const { DataTypes } = require('sequelize');

/**
 * Naai Shop order (B2B — a salon buying stock for its shop).
 *
 * The client (web portal and mobile app) snapshots the same shape it stores
 * locally (`my-naai-web/src/lib/shopOrders.js`) and the backend recomputes
 * the bill server-side so the amounts can never be faked from the client.
 *
 * TWO STATUS TRACKS — the same order, two audiences:
 *   `status`         INTERNAL track — what the company ADMIN and the
 *                    distributor see: who picks the parcel up and how far
 *                    it has physically come.
 *                        PENDING_ASSIGNMENT -> ASSIGNED -> PICKED ->
 *                        SHIPPED -> DELIVERED   (CANCELLED is terminal)
 *   `customerStatus` SALON track — what the buying salon (customer) sees:
 *                        PENDING -> CONFIRMED -> PROCESSING -> SHIPPED ->
 *                        DELIVERED   (CANCELLED is terminal)
 * The admin moves the internal track; the customer track is derived from it
 * (see shopOrder.service.INTERNAL_TO_CUSTOMER_STATUS) so the salon never
 * sees warehouse internals.
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

        // Human-facing order id. The client may send its own id (the web
        // shop generates one before paying so its local record and this
        // record match); otherwise the backend generates the same format.
        orderId: {
            type: DataTypes.STRING(32),
            allowNull: false,
            unique: true,
            field: 'order_id'
        },

        // The buying salon (salon token in the JWT). Sellers are the
        // company's own stock (shop_products) — no selling salon per line.
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

        // INTERNAL track (admin + distributor): has the order been handed
        // to a delivery partner and where is the parcel now?
        status: {
            type: DataTypes.ENUM('PENDING_ASSIGNMENT', 'ASSIGNED', 'PICKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'),
            allowNull: false,
            defaultValue: 'PENDING_ASSIGNMENT',
            field: 'status'
        },

        // SALON track (customer view), derived from the internal track.
        customerStatus: {
            type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'),
            allowNull: false,
            defaultValue: 'PENDING',
            field: 'customer_status'
        },

        // The delivery partner the admin assigned (distributors table).
        distributorId: {
            type: DataTypes.UUID,
            allowNull: true,
            field: 'distributor_id'
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
        ShopOrder.belongsTo(models.Distributor, {
            foreignKey: 'distributorId',
            as: 'distributor'
        });
    };

    return ShopOrder;
};
