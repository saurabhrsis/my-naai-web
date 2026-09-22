// POST /api/notifications/register-device — keep a signed-in account's FCM
// token current.
//
// Why this exists: today the API learns a device token in exactly ONE place,
// the `deviceToken` field of OTP login / onboarding. On a phone that is fine —
// the token exists before anyone signs in. In a browser it is the reason for
// "permission is granted but no notification arrives":
//
//   · the salon signs in first and allows notifications afterwards (from the
//     Account card, or the browser's own prompt) → the server has NO token;
//   · the token rotates (Firebase does this; a re-installed PWA does too) →
//     the server keeps sending to a token that no longer exists;
//   · the salon signs in on the laptop → the server's one token is the
//     laptop's, and the phone in the shop hears nothing.
//
// The web portal (src/lib/deviceToken.js) posts the live token here whenever it
// changes for the signed-in account. Until this route exists the portal gets a
// 404, remembers it for the session, and keeps working as before.
//
// Drop this file in next to the other notification controllers and wire it
// behind the SAME auth middleware the notification list uses (it must serve
// both salon and user tokens):
//
//   const registerDevice = require('./controllers/notifications/registerDevice');
//   router.post('/register-device', auth, registerDevice);
//
// Body:
//   { "deviceToken": "<fcm token>", "platform": "web" | "android" | "ios",
//     "userType": "SALON" | "USER", "userId": "<optional, must match the token>" }
//
// Response: { status: 'SUCCESS', data: { platform, updated: true } }
//
// ── Two schemas this handler supports ────────────────────────────────────────
// (A) One `deviceToken` column on Salon / User (what the app has today). The
//     column is overwritten. A web login therefore REPLACES a phone token — the
//     same thing a phone login already does — so a salon that works from both
//     should prefer (B).
// (B) A DeviceToken table ({ ownerType, ownerId, token, platform, lastSeenAt,
//     active }) if `db.DeviceToken` exists. The token is upserted, every active
//     token for the account is kept, and the send helper should fan out to all
//     of them (and deactivate tokens FCM reports as unregistered).
//
// The handler detects (B) at runtime and otherwise falls back to (A), so it can
// be dropped in before or after that table exists.

const db = require('../database/models');

// Web FCM tokens are longer than Android ones (often 150–200 chars); make sure
// the column is at least VARCHAR(255) or TEXT before enabling this for web.
const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 4096;
const PLATFORMS = ['web', 'android', 'ios'];

function resolveIdentity(req) {
  // The auth middleware decorates req differently for the two account types in
  // this codebase; read whichever it set.
  const salonId = req.salon?.salonId || req.salon?.id || req.user?.salonId || req.salonId || null;
  const userId = req.user?.userId || req.user?.id || req.userId || null;
  const claimedType = String(req.body?.userType || '').toUpperCase();
  if (claimedType === 'SALON' && salonId) return { type: 'SALON', id: salonId };
  if (claimedType === 'USER' && userId) return { type: 'USER', id: userId };
  if (salonId) return { type: 'SALON', id: salonId };
  if (userId) return { type: 'USER', id: userId };
  return null;
}

module.exports = async function registerDevice(req, res) {
  try {
    const identity = resolveIdentity(req);
    if (!identity) {
      return res.status(401).json({ status: 'FAILED', message: 'Sign in again to register this device.' });
    }
    const deviceToken = String(req.body?.deviceToken || '').trim();
    if (deviceToken.length < MIN_TOKEN_LENGTH || deviceToken.length > MAX_TOKEN_LENGTH) {
      return res.status(400).json({ status: 'FAILED', message: 'deviceToken is required' });
    }
    const platform = PLATFORMS.includes(String(req.body?.platform || '').toLowerCase()) ? String(req.body.platform).toLowerCase() : 'web';
    // A client may only register a token for the account it is signed in as.
    if (req.body?.userId && String(req.body.userId) !== String(identity.id)) {
      return res.status(403).json({ status: 'FAILED', message: 'Unauthorized' });
    }

    // (B) Multi-device table, when the project has one.
    if (db.DeviceToken) {
      const where = { token: deviceToken };
      const values = { ownerType: identity.type, ownerId: identity.id, token: deviceToken, platform, lastSeenAt: new Date(), active: true };
      const existing = await db.DeviceToken.findOne({ where });
      if (existing) await existing.update(values); else await db.DeviceToken.create(values);
      return res.json({ status: 'SUCCESS', data: { platform, updated: true, multiDevice: true } });
    }

    // (A) Single column on the account row.
    const Model = identity.type === 'SALON' ? db.Salon : db.User;
    const pk = identity.type === 'SALON' ? 'salonId' : 'userId';
    const [updated] = await Model.update({ deviceToken }, { where: { [pk]: identity.id } });
    if (!updated) {
      // Older schemas use `id` as the primary key.
      await Model.update({ deviceToken }, { where: { id: identity.id } });
    }
    return res.json({ status: 'SUCCESS', data: { platform, updated: true, multiDevice: false } });
  } catch (error) {
    console.error('register-device failed:', error?.message || error);
    return res.status(500).json({ status: 'FAILED', message: 'Could not register this device for notifications.' });
  }
};
