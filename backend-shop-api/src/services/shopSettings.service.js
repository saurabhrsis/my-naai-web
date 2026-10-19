const db = require('../database/models');

/* ------------------------------------------------------------------ *\\\
 * Shop settings — single row (id = 1) the admin panel edits.
 *
 * Defaults mirror the constants the shop shipped with (and the frontend's
 * fallbacks in my-naai-web/src/lib/shopSettings.js), so an untouched
 * deployment behaves exactly as before.
 * ------------------------------------------------------------------ */
const DEFAULTS = {
    freeDeliveryAbove: 499,
    deliveryFee: 49,
    discountPercent: 0,
    codThreshold: 0,
    codCharges: 0
};

const FIELDS = Object.keys(DEFAULTS);

// Read a DB value as a non-negative number; anything unusable falls back.
const readNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const shape = (row) => ({
    freeDeliveryAbove: readNumber(row?.freeDeliveryAbove, DEFAULTS.freeDeliveryAbove),
    deliveryFee: readNumber(row?.deliveryFee, DEFAULTS.deliveryFee),
    discountPercent: readNumber(row?.discountPercent, DEFAULTS.discountPercent),
    codThreshold: readNumber(row?.codThreshold, DEFAULTS.codThreshold),
    codCharges: readNumber(row?.codCharges, DEFAULTS.codCharges)
});

// Fetch the settings row, seeding it with the defaults on first read.
const getSettings = async () => {
    let row = await db.ShopSettings.findByPk(1);
    if (!row) {
        row = await db.ShopSettings.create({ id: 1, ...DEFAULTS });
    }
    return shape(row);
};

// Admin update — every field is optional (only the ones sent change), every
// value is validated before it touches the row.
const updateSettings = async (payload = {}) => {
    const current = await getSettings();
    const errors = [];
    const next = {};

    for (const field of FIELDS) {
        if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
            next[field] = current[field];
            continue;
        }
        const n = Number(payload[field]);
        if (!Number.isFinite(n) || n < 0) {
            errors.push(`${field} must be a number of 0 or more`);
            next[field] = current[field];
            continue;
        }
        if (field === 'discountPercent' && n > 100) {
            errors.push('discountPercent cannot be more than 100');
            next[field] = current[field];
            continue;
        }
        next[field] = n;
    }

    if (errors.length) throw new Error(errors.join('; '));

    const [row] = await db.ShopSettings.upsert({ id: 1, ...next });
    return shape(row);
};

module.exports = {
    DEFAULTS,
    getSettings,
    updateSettings
};
