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
// The web portal (src/lib/deviceToken.js) posts a confirmed live token here
// when a signed-in account has no login baseline (or has just enabled alerts).
// If Firebase rotates a token that was stored at login, the portal's recovery UI
// asks for a fresh OTP login so the next authoritative request carries it.
// Until this route exists the portal gets a 404, remembers it for the session,
// and keeps working as before.
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

function normalizeDeviceToken(value) {
  if (typeof value !== 'string') return '';
  const token = value.trim();
  // FCM registration tokens are opaque, but never contain whitespace/control
  // characters. Rejecting those here prevents a copied placeholder or a token
  // accidentally concatenated with a second value from becoming an owner row.
  if (!token || /[\u0000-\u0020\u007f]/.test(token)) return '';
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return '';
  return token;
}

function resolveIdentity(req) {
  // The auth middleware decorates req differently for the two account types in
  // this codebase; read whichever it set. Never trust the body to choose an
  // account that the bearer token did not authenticate.
  const salonId = req.salon?.salonId || req.salon?.id || req.auth?.salonId || req.user?.salonId || req.salonId || null;
  const userId = req.user?.userId || req.user?.id || req.auth?.userId || req.userId || null;
  const claimedType = String(req.body?.userType || '').trim().toUpperCase();
  const authenticatedType = String(req.user?.role || req.user?.userType || req.auth?.role || req.auth?.userType || '').trim().toUpperCase();
  if (claimedType && !['SALON', 'USER'].includes(claimedType)) return null;
  if (claimedType === 'SALON' && salonId) return { type: 'SALON', id: salonId };
  // Some auth middleware exposes a salon account as req.user.userId plus a role
  // instead of attaching req.salon. Honour that authenticated role, never the
  // request body alone, so the web portal's `userId` field still works.
  if (claimedType === 'SALON' && authenticatedType === 'SALON' && userId) return { type: 'SALON', id: userId };
  if (claimedType === 'USER' && userId) return { type: 'USER', id: userId };
  if (salonId) return { type: 'SALON', id: salonId };
  if (userId) return { type: authenticatedType === 'SALON' ? 'SALON' : 'USER', id: userId };
  return null;
}

function transactionOptions(transaction) {
  return transaction ? { transaction } : {};
}

async function inTransaction(work) {
  if (typeof db.sequelize?.transaction !== 'function') return work(null);
  const transaction = await db.sequelize.transaction();
  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try { await transaction.rollback(); } catch { /* preserve the original error */ }
    throw error;
  }
}

async function findTokenRows(Model, token, transaction) {
  const options = { where: { token }, ...transactionOptions(transaction) };
  if (typeof Model.findAll === 'function') {
    // The lock is important for two tabs that finish token registration at the
    // same time. A unique index remains the final safety net for a concurrent
    // insert that starts before either transaction can acquire this lock.
    if (transaction?.LOCK?.UPDATE) options.lock = transaction.LOCK.UPDATE;
    const rows = await Model.findAll(options);
    return Array.isArray(rows) ? rows : [];
  }
  if (typeof Model.findOne === 'function') {
    const row = await Model.findOne(options);
    return row ? [row] : [];
  }
  return [];
}

async function deactivateDuplicate(row, transaction) {
  if (!row) return;
  if (typeof row.destroy === 'function') {
    await row.destroy(transactionOptions(transaction));
    return;
  }
  // Do not leave a second active owner if the model does not expose destroy.
  if (typeof row.update === 'function') {
    await row.update({ active: false }, transactionOptions(transaction));
  }
}

function isUniqueConstraintError(error) {
  const code = String(error?.name || error?.original?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return /unique|duplicate|constraint/.test(`${code} ${message}`);
}

async function updateExistingTokenRows(Model, identity, token, values, transaction) {
  const rows = await findTokenRows(Model, token, transaction);
  if (!rows.length) return null;
  // A token identifies one browser/app installation. If old deployments
  // already contain duplicate rows, keep one current owner and remove or
  // deactivate every duplicate before returning. This also moves a token
  // cleanly when Firebase reuses it after an account switch.
  const [keeper, ...duplicates] = rows;
  const previousOwner = keeper.ownerId ?? keeper.userId ?? keeper.salonId;
  const rotated = previousOwner !== undefined && previousOwner !== null && String(previousOwner) !== String(identity.id);
  await keeper.update(values, transactionOptions(transaction));
  for (const duplicate of duplicates) await deactivateDuplicate(duplicate, transaction);
  return { rotated };
}

async function upsertDeviceToken(identity, token, platform) {
  const Model = db.DeviceToken;
  const values = {
    ownerType: identity.type,
    ownerId: identity.id,
    token,
    platform,
    lastSeenAt: new Date(),
    active: true,
  };

  try {
    return await inTransaction(async transaction => {
      const existing = await updateExistingTokenRows(Model, identity, token, values, transaction);
      if (existing) return existing;
      await Model.create(values, transactionOptions(transaction));
      return { rotated: false };
    });
  } catch (error) {
    // A concurrent insert can win the unique-token race. That transaction is
    // already rolled back by inTransaction (important for PostgreSQL), so
    // retry the lookup in a fresh transaction rather than querying an aborted
    // transaction or creating a second owner.
    if (!isUniqueConstraintError(error)) throw error;
    return inTransaction(async transaction => {
      const existing = await updateExistingTokenRows(Model, identity, token, values, transaction);
      if (existing) return existing;
      throw error;
    });
  }
}

function hasDeviceTokenAttribute(Model) {
  return Boolean(Model && (!Model.rawAttributes || Object.prototype.hasOwnProperty.call(Model.rawAttributes, 'deviceToken')));
}

async function clearLegacyCopies(token, transaction) {
  // The single-column fallback cannot fan out, so keep the token owned by only
  // one account. This prevents a token left on an old Salon/User row from
  // receiving a duplicate notification after the current account registers it.
  for (const Model of [db.Salon, db.User]) {
    if (!hasDeviceTokenAttribute(Model) || typeof Model.update !== 'function') continue;
    await Model.update(
      { deviceToken: null },
      { where: { deviceToken: token }, ...transactionOptions(transaction) },
    );
  }
}

async function writeLegacyAccount(identity, token, transaction) {
  const Model = identity.type === 'SALON' ? db.Salon : db.User;
  if (!Model || !hasDeviceTokenAttribute(Model) || typeof Model.update !== 'function') return true;
  const whereKeys = identity.type === 'SALON' ? ['salonId', 'id'] : ['userId', 'id'];
  let updated = 0;
  for (const key of whereKeys) {
    const result = await Model.update(
      { deviceToken: token },
      { where: { [key]: identity.id }, ...transactionOptions(transaction) },
    );
    updated = Number(Array.isArray(result) ? result[0] : result) || 0;
    if (updated > 0) break;
  }
  return updated > 0;
}

async function updateLegacyAccount(identity, token) {
  const Model = identity.type === 'SALON' ? db.Salon : db.User;
  if (!Model || !hasDeviceTokenAttribute(Model) || typeof Model.update !== 'function') throw new Error('Account model is unavailable');
  return inTransaction(async transaction => {
    await clearLegacyCopies(token, transaction);
    return writeLegacyAccount(identity, token, transaction);
  });
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
    // Accept the existing client field (`userId`) for salon sessions too, but
    // reject any second account claim rather than silently choosing one.
    for (const claimedId of [req.body?.userId, req.body?.salonId].filter(value => value !== undefined && value !== null && value !== '')) {
      if (String(claimedId) !== String(identity.id)) {
        return res.status(403).json({ status: 'FAILED', message: 'Unauthorized' });
      }
    }
    const claimedType = String(req.body?.userType || '').trim().toUpperCase();
    if (claimedType && claimedType !== identity.type) {
      return res.status(403).json({ status: 'FAILED', message: 'Unauthorized' });
    }

    let rotated = false;
    if (db.DeviceToken && (typeof db.DeviceToken.findAll === 'function' || typeof db.DeviceToken.findOne === 'function')) {
      ({ rotated } = await upsertDeviceToken(identity, deviceToken, rawPlatform));
      // Keep old senders that still read User/Salon.deviceToken correct while
      // removing the same token from any stale account row. The DeviceToken
      // table remains authoritative for multi-device fan-out.
      await inTransaction(async transaction => {
        await clearLegacyCopies(deviceToken, transaction);
        await writeLegacyAccount(identity, deviceToken, transaction);
      });
    } else {
      const updated = await updateLegacyAccount(identity, deviceToken);
      if (!updated) {
        return res.status(404).json({ status: 'FAILED', message: 'Account not found.' });
      }
    }

    return res.json({
      status: 'SUCCESS',
      data: { platform: rawPlatform, updated: true, rotated, multiDevice: Boolean(db.DeviceToken) },
    });
  } catch (error) {
    console.error('register-device failed:', error?.message || error);
    return res.status(500).json({ status: 'FAILED', message: 'Could not register this device for notifications.' });
  }
};

// Exporting the pure normalizer makes it easy for a backend test to pin the
// contract without importing the application's database connection.
module.exports.normalizeDeviceToken = normalizeDeviceToken;
