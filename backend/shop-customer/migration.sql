-- Naai Shop for customers — schema migration.
--
-- Additive and backward compatible: every existing row keeps meaning "a salon
-- ordered this", and the old code keeps working until the new build is live.
-- Run inside a transaction; check the constraint/index names against
-- `SHOW CREATE TABLE shop_carts;` before applying (see the note at the end).

START TRANSACTION;

-- ── Orders ────────────────────────────────────────────────────────────────
ALTER TABLE shop_orders
  ADD COLUMN buyerType ENUM('SALON', 'CUSTOMER') NOT NULL DEFAULT 'SALON' AFTER orderId,
  ADD COLUMN customerId CHAR(36) NULL AFTER salonId,
  MODIFY COLUMN salonId CHAR(36) NULL;

ALTER TABLE shop_orders
  ADD CONSTRAINT fk_shop_orders_customer
    FOREIGN KEY (customerId) REFERENCES users (userId) ON DELETE SET NULL;

CREATE INDEX idx_shop_orders_customer ON shop_orders (customerId, createdAt);

-- ── Cart ──────────────────────────────────────────────────────────────────
ALTER TABLE shop_carts
  ADD COLUMN buyerType ENUM('SALON', 'CUSTOMER') NOT NULL DEFAULT 'SALON' AFTER cartId,
  ADD COLUMN customerId CHAR(36) NULL AFTER salonId,
  MODIFY COLUMN salonId CHAR(36) NULL;

ALTER TABLE shop_carts
  ADD CONSTRAINT fk_shop_carts_customer
    FOREIGN KEY (customerId) REFERENCES users (userId) ON DELETE CASCADE;

CREATE INDEX idx_shop_carts_customer ON shop_carts (customerId);

COMMIT;

-- ── The cart's uniqueness moves from "one row per salon + product" to "one row
-- per buyer + product". Find the existing key first:
--
--   SHOW INDEX FROM shop_carts;
--
-- then drop it by its real name and add the buyer-aware one:
--
--   ALTER TABLE shop_carts DROP INDEX <existing_unique_key_name>;
--   ALTER TABLE shop_carts
--     ADD UNIQUE KEY uq_shop_carts_buyer_product (buyerType, salonId, customerId, productId);
--
-- MySQL treats NULLs as distinct in a unique key, so the salon rows and the
-- customer rows cannot collide: (SALON, salon-1, NULL, p1) and
-- (CUSTOMER, NULL, user-9, p1) are two different rows, which is exactly what
-- the two carts need.

-- ── Notes ─────────────────────────────────────────────────────────────────
-- * `userId` above is the users table's primary key in this schema; if it is an
--   INT/BIGINT, change both CHAR(36) columns (and the Sequelize attribute) to
--   match — a mismatched FK type is the one thing that will fail here.
-- * No backfill is needed: buyerType defaults to 'SALON' and every existing row
--   already has a salonId with customerId NULL.
-- * Rollback: drop the two foreign keys and indexes, then the four columns, and
--   restore salonId to NOT NULL after deleting any customer rows.
