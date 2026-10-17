const { DataTypes } = require('sequelize');

/**
 * Shop order event — the audit record behind the admin order dashboard.
 *
 * Every state change on a shop order is appended here (never edited, never
 * deleted with the order except by cascade): who did it (admin, distributor,
 * salon or the system), what it was (assigned / accepted / rejected / status
 * change / cancellation), the before/after INTERNAL status, and a note —
 * which is where a distributor's REJECTION REASON lives.
 *
 * `actorId` is deliberately a string: admin ids are integers, distributor and
 * salon ids are UUIDs. `actorLabel` is a display snapshot (names change, the
 * record should not).
 */
module.exports = (sequelize) => {
    const ShopOrderEvent = sequelize.define('ShopOrderEvent', {
        // BIGSERIAL on purpose: it is the tie-breaker for display order
        // (events logged in the same millisecond must still read top to
        // bottom in insertion order). Nothing external references this id.
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true
        },

        orderId: {
            type: DataTypes.UUID,
            allowNull: false,
            field: 'order_id'
        },

        actorType: {
            type: DataTypes.ENUM('ADMIN', 'DISTRIBUTOR', 'SALON', 'SYSTEM'),
            allowNull: false,
            field: 'actor_type'
        },

        actorId: {
            type: DataTypes.STRING(64),
            allowNull: true,
            field: 'actor_id'
        },

        actorLabel: {
            type: DataTypes.STRING(150),
            allowNull: true,
            field: 'actor_label'
        },

        action: {
            // ORDER_PLACED, PAYMENT_CONFIRMED, ASSIGNED, ACCEPTED, REJECTED,
            // STATUS_CHANGED, CANCELLED
            type: DataTypes.STRING(40),
            allowNull: false
        },

        fromStatus: {
            type: DataTypes.STRING(40),
            allowNull: true,
            field: 'from_status'
        },

        toStatus: {
            type: DataTypes.STRING(40),
            allowNull: true,
            field: 'to_status'
        },

        note: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'shop_order_events',
        timestamps: true
    });

    ShopOrderEvent.associate = (models) => {
        ShopOrderEvent.belongsTo(models.ShopOrder, {
            foreignKey: 'orderId',
            as: 'order'
        });
    };

    return ShopOrderEvent;
};
