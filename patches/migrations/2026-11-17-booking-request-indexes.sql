-- The indexes the two Booking requests tabs order and filter by.
--
-- The API creates these at boot too (`ensureBookingRequestIndexes`, idempotent
-- and CONCURRENTLY). This file is the statement of record for deployments that
-- prefer to run their own migrations — it is the same three statements.
--
-- Run each statement on its own (no BEGIN/COMMIT): `CREATE INDEX CONCURRENTLY`
-- cannot run inside a transaction block. That is deliberate — a plain
-- CREATE INDEX takes a SHARE lock and blocks writes to booking_requests for the
-- length of the build, which on a live platform is exactly the outage an index
-- meant to speed things up should not cause.

-- The salon tab: "this salon, newest first".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_requests_salon_created
    ON booking_requests (salon_id, created_at DESC);

-- The customer tab: "my requests, newest first".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_requests_customer_created
    ON booking_requests (customer_id, created_at DESC);

-- The admin report's median reply time: created_at over the ANSWERED rows only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_requests_answered_created
    ON booking_requests (created_at)
    WHERE responded_at IS NOT NULL;

-- Verify:
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'booking_requests'
--      AND indexname IN ('idx_booking_requests_salon_created',
--                        'idx_booking_requests_customer_created',
--                        'idx_booking_requests_answered_created');
