-- My Naai — booking requests (leads), product categories and bulk upload.
--
-- Additive and idempotent. Nothing here changes an existing column's meaning:
-- a booking REQUEST stays a request and a BOOKING stays a booking (separate
-- tables, `booking_request` vs `booking`), which is exactly why the salon's new
-- "Booking requests" tab and the admin's new tab read only `booking_requests`
-- and never the bookings table.
--
-- Run after the shop patches:
--   patches/migrations/2026-10-22-shop-customers.sql
--   then this file.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Product categories — ONE list, owned by the admin panel
-- ════════════════════════════════════════════════════════════════════════════
-- The website and the app read this table (through /api/shop-categories/list and
-- the public twin) so the filter a customer sees is the list the admin manages.
-- `id` is a slug, because products store it: keep it stable when a label is
-- renamed, or every product filed under it loses its shelf.
CREATE TABLE IF NOT EXISTS shop_categories (
    id            VARCHAR(64) PRIMARY KEY,
    label         VARCHAR(120) NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO shop_categories (id, label, sort_order) VALUES
    ('hair-care',        'Hair care',         0),
    ('beard-grooming',   'Beard & grooming',  1),
    ('skin-face',        'Skin & face',       2),
    ('fragrance',        'Fragrance',         3),
    ('hair-colour',      'Hair colour',       4),
    ('tools-equipment',  'Tools & equipment', 5),
    ('kits-sets',        'Kits & sets',       6)
ON CONFLICT (id) DO NOTHING;

-- shop_products.category already exists (TEXT/VARCHAR). Constrain the values
-- that are actually written from now on through the API, not with a hard FK:
-- old rows carry free text ("Hair Colour and Chemical Products") that the web
-- client still maps through its inference rules. This index makes the facet
-- filter cheap.
CREATE INDEX IF NOT EXISTS idx_shop_products_category ON shop_products (category);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Booking requests — the salon's leads
-- ════════════════════════════════════════════════════════════════════════════
-- Existing table: booking_requests (created by create-booking-request). The
-- columns below are what the leads tab and the admin tab need to answer
-- "how many requests came in, and what became of them" without reading the
-- bookings table.
--
--   status        PENDING | ACCEPTED | REJECTED | DELAYED | AUTO_CANCELLED |
--                 CANCELLED_BY_CUSTOMER
--   auto-cancel   a request still PENDING one minute after it was created is
--                 AUTO_CANCELLED by the sweeper (see §4). That is NOT a
--                 rejection: the salon never answered, which is a different
--                 number and a different conversation.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS responded_at  TIMESTAMPTZ;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS routed_barber_id VARCHAR(64);

-- The window. Written on insert by the API, so a client cannot extend it.
UPDATE booking_requests
   SET expires_at = COALESCE(created_at, NOW()) + INTERVAL '60 seconds'
 WHERE expires_at IS NULL;

-- "still waiting" and "what happened today" are the two queries the tabs run.
CREATE INDEX IF NOT EXISTS idx_booking_requests_salon_status
    ON booking_requests (salon_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_requests_pending_expiry
    ON booking_requests (expires_at)
    WHERE status = 'PENDING';

-- Accepting a request produces a booking. Keep the link so a salon can see that
-- the lead became a booking, without the two ever being the same row.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS booking_id VARCHAR(64);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Reporting views (read-only, used by the summary endpoints)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW salon_lead_counts AS
SELECT
    salon_id,
    COUNT(*)                                                          AS received,
    COUNT(*) FILTER (WHERE status = 'PENDING')                        AS awaiting,
    COUNT(*) FILTER (WHERE status = 'ACCEPTED')                       AS accepted,
    COUNT(*) FILTER (WHERE status = 'REJECTED')                       AS rejected,
    COUNT(*) FILTER (WHERE status = 'AUTO_CANCELLED')                 AS auto_cancelled,
    COUNT(*) FILTER (WHERE status = 'CANCELLED_BY_CUSTOMER')          AS cancelled_by_customer,
    COUNT(*) FILTER (WHERE status = 'DELAYED')                        AS delayed,
    COUNT(*) FILTER (WHERE status IN ('ACCEPTED', 'REJECTED'))        AS answered,
    MAX(created_at)                                                   AS last_received_at
FROM booking_requests
GROUP BY salon_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Auto-cancel sweeper (run every 15–30 seconds from cron or a setInterval)
-- ════════════════════════════════════════════════════════════════════════════
-- UPDATE booking_requests
--    SET status = 'AUTO_CANCELLED', responded_at = NOW()
--  WHERE status = 'PENDING' AND expires_at < NOW()
-- RETURNING booking_request_id, salon_id;
--
-- Notify the customer for each returned row (the same notification type the
-- reject path sends) so they know the slot was released.
