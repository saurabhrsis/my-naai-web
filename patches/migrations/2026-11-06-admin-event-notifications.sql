-- Admin event notifications — schema migration (PostgreSQL).
-- ============================================================================
-- RUN THIS with the notification patch, before or after the deploy (it is
-- idempotent and additive).
--
-- The backend now writes an inbox row for the admin panel when one of the
-- owner's five events happens:
--
--   • a new shop order                     • a delivery-partner action
--   • a new salon registration             • a new booking request
--   • a subscription renewal
--
-- Those rows use the internal target type `ADMINS`. It is deliberately NOT
-- `ALL` / `ALL_SALONS` / `ALL_USERS`, because the salon and customer
-- notification lists include the ALL* rows on purpose — an internal event must
-- never appear in a partner's or a customer's notifications. Without this
-- value the insert fails with
--
--   invalid input value for enum enum_admin_notification_target_type: "ADMINS"
--
-- and the event notification is dropped (the business action itself still
-- succeeds: `eventNotification.service.js` swallows notification errors).
-- ============================================================================

-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on older
-- servers, so this file deliberately has no BEGIN/COMMIT.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_admin_notification_target_type') THEN
        ALTER TYPE enum_admin_notification_target_type ADD VALUE IF NOT EXISTS 'ADMINS';
    END IF;
END $$;

-- Sequelize names the enum after <table>_<column>; a database created by an
-- older sync may carry the alternative spelling. Cover both.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_admin_notifications_target_type') THEN
        ALTER TYPE enum_admin_notifications_target_type ADD VALUE IF NOT EXISTS 'ADMINS';
    END IF;
END $$;

-- The panel's list query asks for `created_by = <admin>` OR `target_type =
-- 'ADMINS'`; this index keeps that cheap once event rows accumulate.
CREATE INDEX IF NOT EXISTS idx_admin_notification_target_created
    ON admin_notification (target_type, created_at DESC);
