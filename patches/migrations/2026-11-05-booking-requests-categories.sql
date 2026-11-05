-- My Naai — booking requests (leads), the ONE category list, and bulk upload.
--
-- THIS FILE IS THE COPY OF WHAT SHIPS IN THE BACKEND REPO. The patch
-- `patches/backend-1-shop-categories.patch` adds it as
-- `migrations/2026-11-05-shop-categories-leads-bulk.sql`; apply it from there.
-- It is kept here, byte for byte, so the SQL that a deploy runs can be read
-- without opening the other repository.
--
-- Additive and idempotent: every statement is IF NOT EXISTS / ON CONFLICT, so
-- running it twice is harmless and running it on a fresh database gives the same
-- result as running it on production.
--
-- A booking REQUEST stays a request and a BOOKING stays a booking: separate
-- tables, never merged. That is why the salon's and the admin's new
-- "Booking requests" tabs read only `booking_requests`.
--
-- Run after the shop patches:
--   patches/migrations/2026-10-22-shop-customers.sql
--   then this file.

BEGIN;

-- =====================================================================
-- 1. Product categories — one list for the panel, the website and the app
-- =====================================================================
CREATE TABLE IF NOT EXISTS shop_categories (
    id          VARCHAR(64) PRIMARY KEY,          -- slug, stored on the product
    label       VARCHAR(120) NOT NULL,            -- what customers read
    sort_order  INTEGER NOT NULL DEFAULT 0,       -- the filter's order
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,    -- false = hidden, not deleted
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The seven the shop has always shown. The ids are hand-named (not the slug of
-- the label) and must match DEFAULT_SHOP_CATEGORIES in
-- my-naai-web/src/lib/shopCategories.js — that is the website's fallback list,
-- so a backend without this table still shows the same seven chips.
INSERT INTO shop_categories (id, label, sort_order) VALUES
    ('hair-care',      'Hair care',         0),
    ('beard-grooming', 'Beard & grooming',  1),
    ('skin-face',      'Skin & face',       2),
    ('fragrance',      'Fragrance',         3),
    ('hair-colour',    'Hair colour',       4),
    ('tools-equipment','Tools & equipment', 5),
    ('kits-sets',      'Kits & sets',       6)
ON CONFLICT (id) DO NOTHING;

-- The admin panel used to offer eight long free-text labels in its product
-- editor. Products filed under those labels are moved onto a real category id so
-- the storefront's filter has seven chips, not fifteen. Review the mapping
-- before running this section in production:
--
--   SELECT category, COUNT(*) FROM shop_products
--    WHERE deleted_at IS NULL GROUP BY category ORDER BY 2 DESC;
--
-- Anything this mapping does not recognise is left exactly as it is: the website
-- still shows an extra chip for it (a retired or unknown shelf stays reachable),
-- and the admin can re-file those products from the panel. No row is deleted and
-- no product is hidden.
UPDATE shop_products SET category = 'hair-care'
 WHERE deleted_at IS NULL AND lower(trim(category)) IN ('hair care products', 'hair styling products');
UPDATE shop_products SET category = 'hair-colour'
 WHERE deleted_at IS NULL AND lower(trim(category)) = 'hair colour and chemical products';
UPDATE shop_products SET category = 'beard-grooming'
 WHERE deleted_at IS NULL AND lower(trim(category)) = 'shaving and beard products';
UPDATE shop_products SET category = 'skin-face'
 WHERE deleted_at IS NULL AND lower(trim(category)) IN ('facial and skin care products', 'waxing products');
UPDATE shop_products SET category = 'tools-equipment'
 WHERE deleted_at IS NULL AND lower(trim(category)) IN ('salon tools and accessories', 'salon hygiene and disposable items');

CREATE INDEX IF NOT EXISTS idx_shop_products_category ON shop_products (lower(category));

-- =====================================================================
-- 2. Booking REQUESTS (leads) — the answer window and the outcome
-- =====================================================================
-- Requests are NOT bookings. `booking_requests` is the lead a customer sent;
-- `booking` / `booking_list` holds the chair that exists after an accept. These
-- columns describe the lead only.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS responded_at  TIMESTAMPTZ;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS booking_id     UUID;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS routed_barber_id UUID;

-- Existing rows: the window started when the request was created and lasted 60
-- seconds. Backfilling `expires_at` lets the sweeper and the leads list classify
-- old rows instead of treating every one of them as still answerable.
UPDATE booking_requests
   SET expires_at = created_at + INTERVAL '60 seconds'
 WHERE expires_at IS NULL;

-- A request that is still PENDING long after its window is, factually, an
-- auto-cancel that the sweeper has not written yet. Do not touch PENDING rows
-- the sweeper could still legitimately reach (a fresh one); the WHERE clause is
-- the same one the sweeper uses, so the two cannot disagree.
UPDATE booking_requests
   SET status = 'AUTO_CANCELLED', responded_at = COALESCE(responded_at, expires_at)
 WHERE status = 'PENDING' AND expires_at < NOW();

CREATE INDEX IF NOT EXISTS idx_booking_requests_salon_status
    ON booking_requests (salon_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_requests_pending_expiry
    ON booking_requests (expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_booking_requests_customer
    ON booking_requests (customer_id, created_at DESC);

-- The salon's counters in one row, for anything that reads them outside the API
-- (a report, a spreadsheet, a support call). The API computes the same numbers
-- with one GROUP BY so it works even where this view was never created.
CREATE OR REPLACE VIEW salon_lead_counts AS
SELECT salon_id,
       COUNT(*)                                                 AS received,
       COUNT(*) FILTER (WHERE status = 'PENDING')               AS awaiting,
       COUNT(*) FILTER (WHERE status = 'ACCEPTED')              AS accepted,
       COUNT(*) FILTER (WHERE status = 'REJECTED')              AS rejected,
       COUNT(*) FILTER (WHERE status = 'AUTO_CANCELLED')        AS auto_cancelled,
       COUNT(*) FILTER (WHERE status = 'CANCELLED')             AS cancelled_by_customer,
       COUNT(*) FILTER (WHERE status IN ('ACCEPTED', 'REJECTED')) AS answered,
       MAX(created_at)                                          AS last_received_at
  FROM booking_requests
 GROUP BY salon_id;

-- =====================================================================
-- 3. Bulk product upload — the audit trail and the undo handle
-- =====================================================================
CREATE TABLE IF NOT EXISTS shop_product_imports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id      VARCHAR(64) NOT NULL,
    file_name     VARCHAR(255) NOT NULL,
    mode          VARCHAR(16) NOT NULL DEFAULT 'CREATE_ONLY',
    rows_total    INTEGER NOT NULL DEFAULT 0,
    rows_created  INTEGER NOT NULL DEFAULT 0,
    rows_updated  INTEGER NOT NULL DEFAULT 0,
    rows_failed   INTEGER NOT NULL DEFAULT 0,
    report        JSONB NOT NULL DEFAULT '{}'::jsonb,
    undone_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS bulk_import_id UUID;
CREATE INDEX IF NOT EXISTS idx_shop_products_bulk_import ON shop_products (bulk_import_id);

-- The sheet's optional columns need somewhere to land: stock on hand, the
-- barcode, the HSN code and the GST rate. All nullable, so nothing that exists
-- today changes, and the single-product form keeps writing only what it knows.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS stock_count INTEGER;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS bar_code    VARCHAR(64);
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS hsn_code    VARCHAR(16);
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS gst_percent DECIMAL(5, 2);

COMMIT;
