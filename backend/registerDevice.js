// POST /api/notifications/register-device — keep a signed-in account's FCM
// token current.
//
// Why this exists: today the API learns a device token in exactly ONE place,
// the `deviceToken` field of OTP login / onboarding. On a phone that is fine
// — the token exists before anyone signs in. In a browser it is the reason
// for "permission is granted but no notification arrives":
//
//   · the salon signs in first and allows notifications afterwards → the
//     server has NO token;
//   · the token rotates (Firebase does this; a re-installed PWA does too) →
//     the server keeps sending to a token that no longer exists;
//   · the salon signs in on a second browser → the older rows go stale until
//     the 10-device cap evicts them.
//
// The web portal (src/lib/deviceToken.js) posts a confirmed live token here
// whenever the signed-in account's token differs from what login carried.
// The push pipeline (addBooking, customerDelayAction, …) reads the
// `device_tokens` table — this is the only way a rotated token reaches it
// without a fresh OTP login. Until this route exists the portal gets a 404,
// remembers it for the session, and falls back to the profile-update
// endpoints.
//
// Wiring (this repo's layout):
//   src/controller/notification/registerDevice.js   ← this file
//   src/routes/notification.routes.js:
//     const authenticateUserOrSalon = require('../utils/middleware/authUserOrSalon.middleware');
//     const registerDevice = require('../controller/notification/registerDevice');
//     notificationRouter.post('/register-device', authenticateUserOrSalon, registerDevice);
//
// `authenticateUserOrSalon` decorates `req.salon` (a salon row, `.salonId`)
// or `req.user` (`{ id, phoneNumber }`) depending on the bearer token — the
// identity always comes from the token, never from the body.
//
// Body:
//   { "deviceToken": "<fcm token>", "platform": "web" | "android" | "ios",
//     "userType": "SALON" | "USER", "userId": "<optional, must match the token>" }
//
// Response: { status: 'SUCCESS', data: { platform, updated: true, multiDevice } }
//
// ── The two storage shapes this handler supports ───────────────────────────
// (A) The `device_tokens` table (DeviceToken model: deviceId, salonId,
//     deviceToken, isActive) — what this codebase has. SALON accounts only:
//     the token is upserted, all active devices are kept (same 10-device cap
//     as login), and a token re-registered under another salon MOVES.
// (B) A single `deviceToken` column on the account (users have one, salons
//     do not in this codebase). USER accounts always land here; the column
//     is overwritten and a copy of the same token on any other account row
//     is cleared, because one token identifies one installation.
// If a future deployment adds a deviceToken column to salons, (A) mirrors it
// automatically (hasDeviceTokenAttribute check below).

// (Two levels up: this file lives in src/controller/notification/.)
const db = require('../../database/models');

// Web FCM tokens are longer than Android ones (often 150–200 chars); make
// sure device_tokens.device_token is at least VARCHAR(255) (it is, per the
// DeviceToken model) before enabling this for web.
const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 4096;
const PLATFORMS = ['web', 'android', 'ios'];
// Same cap the login flow enforces (salonLogin.js: delete the oldest at >= 10).
const MAX_SALON_DEVICES = 10;

function normalizeDeviceToken(value) {
  if (typeof value !== 'string') return '';
  const token = value.trim();
  // FCM registration tokens are opaque, but never contain whitespace/control
  // characters. Rejecting those here prevents a copied placeholder or a token
  // accidentally concatenated with a second value from becoming a device row.
  if (!token || /[\u0000-\u0020\u007f]/.test(token)) return '';
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return '';
  return token;
}

// Identity comes from the authenticated request only (the auth middleware
// decorates it from the bearer token). The body may claim a type/id, but the
// handler verifies the claim below — it never chooses an account from it.
function resolveIdentity(req) {
  const salonId = req.salon?.salonId ?? req.salon?.id ?? null;
  const userId = req.user?.id ?? req.user?.userId ?? null;
  if (salonId) return { type: 'SALON', id: String(salonId) };
  if (userId) return { type: 'USER', id: String(userId) };
  return null;
}

function hasDeviceTokenAttribute(Model) {
  return Boolean(Model && (!Model.rawAttributes || Object.prototype.hasOwnProperty.call(Model.rawAttributes, 'deviceToken')));
}

async function registerSalonDeviceToken(salonId, token) {
  const Model = db.DeviceToken;
  const existing = await Model.findOne({ where: { deviceToken: token } });
  if (existing) {
    // A token belongs to one installation. If it is registered under another
    // salon (account switch on this browser, or Firebase reusing the token),
    // move it; otherwise just re-affirm it as active.
    await existing.update(
      String(existing.salonId) === String(salonId)
        ? { isActive: true }
        : { salonId, isActive: true }
    );
    return;
  }
  // New device: keep the same cap login uses — at the limit, drop the oldest.
  const deviceCount = await Model.count({ where: { salonId } });
  if (deviceCount >= MAX_SALON_DEVICES) {
    const oldest = await Model.findOne({ where: { salonId }, order: [['createdAt', 'ASC']] });
    if (oldest) await oldest.destroy();
  }
  await Model.create({ salonId, deviceToken: token });
}

async function registerLegacyColumn(identity, token) {
  const Model = identity.type === 'SALON' ? db.Salon : db.User;
  if (!Model || !hasDeviceTokenAttribute(Model) || typeof Model.update !== 'function') {
    return 0;
  }
  // One token identifies one installation: clear any stale copy on other
  // accounts first (the WHERE keeps the update atomic with the write below).
  for (const other of [db.Salon, db.User]) {
    if (!other || other === Model || !hasDeviceTokenAttribute(other) || typeof other.update !== 'function') continue;
    await other.update({ deviceToken: null }, { where: { deviceToken: token } });
  }
  const whereKeys = identity.type === 'SALON' ? ['salonId', 'id'] : ['userId', 'id'];
  for (const key of whereKeys) {
    const result = await Model.update({ deviceToken: token }, { where: { [key]: identity.id } });
    const updated = Number(Array.isArray(result) ? result[0] : result) || 0;
    if (updated > 0) return updated;
  }
  return 0;
}

module.exports = async function registerDevice(req, res) {
  try {
    const identity = resolveIdentity(req);
    if (!identity) {
      return res.status(401).json({ status: 'FAILED', message: 'Sign in again to register this device.' });
    }

    const rawToken = req.body?.deviceToken;
    const deviceToken = normalizeDeviceToken(rawToken);
    if (!deviceToken) {
      return res.status(400).json({ status: 'FAILED', message: 'deviceToken must be a current FCM registration token.' });
    }

    const rawPlatform = String(req.body?.platform || 'web').trim().toLowerCase();
    if (!PLATFORMS.includes(rawPlatform)) {
      return res.status(400).json({ status: 'FAILED', message: 'platform must be web, android or ios.' });
    }

    // A client may only register a token for the account it is signed in as.
    const claimedId = [req.body?.userId, req.body?.salonId].find(value => value !== undefined && value !== null && value !== '');
    if (claimedId !== undefined && String(claimedId) !== identity.id) {
      return res.status(403).json({ status: 'FAILED', message: 'Unauthorized' });
    }
    const claimedType = String(req.body?.userType || '').trim().toUpperCase();
    if (claimedType && claimedType !== identity.type) {
      return res.status(403).json({ status: 'FAILED', message: 'Unauthorized' });
    }

    const salonTableExists = Boolean(db.DeviceToken && typeof db.DeviceToken.findOne === 'function');
    if (identity.type === 'SALON' && salonTableExists) {
      await registerSalonDeviceToken(identity.id, deviceToken);
      // Keep any sender that still reads the account column correct (the
      // salons table has no such column in this codebase, so this is a no-op
      // until a deployment adds one).
      await registerLegacyColumn(identity, deviceToken);
    } else {
      // USER accounts (and a salon deployment without the table) fall back to
      // the single column; users.deviceToken exists in this codebase.
      const updated = await registerLegacyColumn(identity, deviceToken);
      if (!updated) {
        return res.status(404).json({ status: 'FAILED', message: 'Account not found.' });
      }
    }

    return res.json({
      status: 'SUCCESS',
      data: { platform: rawPlatform, updated: true, multiDevice: identity.type === 'SALON' && salonTableExists },
    });
  } catch (error) {
    console.error('register-device failed:', error?.message || error);
    return res.status(500).json({ status: 'FAILED', message: 'Could not register this device for notifications.' });
  }
};

// Exporting the pure normalizer keeps the contract testable without importing
// the application's database connection.
module.exports.normalizeDeviceToken = normalizeDeviceToken;
