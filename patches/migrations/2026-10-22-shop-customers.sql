-- Naai Shop for customers — schema migration (PostgreSQL).
-- ============================================================================
-- RUN THIS. The code patch alone is not enough: Sequelize's `allowNull: true`
-- is a MODEL declaration, it does not alter a column that already exists. A
-- deployment that applied the code but not this file fails the first customer
-- order in Postgres with
--
--   null value in column "salon_id" of relation "shop_orders"
--   violates not-null constraint
--
-- The two statements that unblock it are
--   ALTER TABLE shop_orders ALTER COLUMN salon_id DROP NOT NULL;
--   ALTER TABLE shop_carts  ALTER COLUMN salon_id DROP NOT NULL;
-- and this file runs them (plus the enum columns, FK and index) idempotently.
-- ============================================================================
--
-- Additive and backward compatible: every existing row keeps meaning "a salon
-- ordered / added this" (`buyer_type` defaults to 'SALON'), and the old code
-- keeps working until the new build is live.
--
-- The API also creates these columns on boot via `GET /test-db`
-- (`model.sync({ alter: true })`). Run this file instead where that route is
-- not visited — it is idempotent, so running it after a sync is harmless.

BEGIN;

-- ── Enum types (Sequelize's own names, so a later sync does not fight them) ──
DO $$ BEGIN
    CREATE TYPE enum_shop_orders_buyer_type AS ENUM ('SALON', 'CUSTOMER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE enum_shop_carts_buyer_type AS ENUM ('SALON', 'CUSTOMER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Orders ──────────────────────────────────────────────────────────────────
ALTER TABLE shop_orders
    ADD COLUMN IF NOT EXISTS buyer_type enum_shop_orders_buyer_type NOT NULL DEFAULT 'SALON',
    ADD COLUMN IF NOT EXISTS customer_id UUID;

-- A customer order has no salon, so the column must accept NULL.
ALTER TABLE shop_orders ALTER COLUMN salon_id DROP NOT NULL;

DO $$ BEGIN
    ALTER TABLE shop_orders
        ADD CONSTRAINT fk_shop_orders_customer
        FOREIGN KEY (customer_id) REFERENCES users (user_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS shop_orders_customer_id ON shop_orders (customer_id, created_at);

-- ── Cart ────────────────────────────────────────────────────────────────────
ALTER TABLE shop_carts
    ADD COLUMN IF NOT EXISTS buyer_type enum_shop_carts_buyer_type NOT NULL DEFAULT 'SALON',
    ADD COLUMN IF NOT EXISTS customer_id UUID;

ALTER TABLE shop_carts ALTER COLUMN salon_id DROP NOT NULL;

DO $$ BEGIN
    ALTER TABLE shop_carts
        ADD CONSTRAINT fk_shop_carts_customer
        FOREIGN KEY (customer_id) REFERENCES users (user_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS shop_carts_customer_id ON shop_carts (customer_id);

-- The cart's uniqueness moves from "one row per salon + product" to "one row
-- per buyer + product". Postgres treats NULLs as distinct, so a salon row
-- (customer_id NULL) and a customer row (salon_id NULL) can both hold the same
-- product — which is exactly what the two carts need.
--
-- Drop the old unique index by whatever name Sequelize actually created it:
DO $$
DECLARE idx RECORD;
BEGIN
    FOR idx IN
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'shop_carts'
          AND indexdef ILIKE '%UNIQUE%'
          AND indexdef ILIKE '%salon_id%'
          AND indexdef ILIKE '%product_id%'
          AND indexdef NOT ILIKE '%buyer_type%'
    LOOP
        EXECUTE format('DROP INDEX IF EXISTS %I', idx.indexname);
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS shop_carts_buyer_product_key
    ON shop_carts (buyer_type, salon_id, customer_id, product_id);

COMMIT;

-- ── Notes ───────────────────────────────────────────────────────────────────
-- * No backfill is needed: buyer_type defaults to 'SALON' and every existing
--   row already has salon_id set with customer_id NULL.
-- * Rollback: drop both new columns and indexes, then
--   `ALTER TABLE shop_orders ALTER COLUMN salon_id SET NOT NULL;` after
--   deleting any customer rows.
