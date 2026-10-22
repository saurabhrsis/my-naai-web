/**
 * A small fixed-window rate limiter for the shop's open (no-token) reads.
 *
 * `/api/shop-public/*` is reachable by anyone on the internet, so it must not
 * become a free way to hammer the database. It does NOT replace a deployment
 * level limiter (nginx / the platform's gateway) — it is the guard that is
 * always there, even on a box where nobody configured one.
 *
 * Deliberately dependency-free and in-memory: a single process counts its own
 * hits, which is exactly the shape of a small Node deployment. Behind several
 * replicas the effective limit multiplies, which is still far better than no
 * limit at all; swap the store for Redis if the fleet grows.
 */

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 120;            // per IP per window — a shopper never gets close
const MAX_TRACKED_CLIENTS = 5000;    // keeps a flood from growing the map forever

const hits = new Map(); // ip -> { count, resetAt }

const clientOf = (request) => (
    request.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || request.socket?.remoteAddress
    || 'unknown'
);

const publicReadLimiter = (request, response, next) => {
    // Tests and health checks must never be throttled by their own budget.
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_PUBLIC_SHOP_LIMIT === 'true') return next();

    const now = Date.now();
    const key = clientOf(request);
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
        // Opportunistic cleanup: one expired entry per request, so the map
        // shrinks as traffic moves on without a timer keeping the process alive.
        if (hits.size > MAX_TRACKED_CLIENTS) hits.delete(hits.keys().next().value);
        hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
        return next();
    }

    current.count += 1;
    if (current.count > MAX_REQUESTS) {
        const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        response.set('Retry-After', String(retryAfter));
        return response.status(429).json({
            status: 'FAILED',
            message: 'Too many requests just now. Please try again in a minute.'
        });
    }

    return next();
};

module.exports = publicReadLimiter;
