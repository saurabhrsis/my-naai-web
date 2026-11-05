-- 2026-11-05-partner-plans.sql
--
-- The partner price list became DATA. Until now the plan prices and the free
-- trial length were constants in the backend (`src/utils/plan.util.js`), in the
-- website bundle (`PARTNER_PLANS`) and in the mobile app, so changing a price
-- meant a release of three repositories — and the trial was a hard-coded
-- `+ 20 days` in `salonLogin.js` while the portal advertised 20 days and the
-- pricing screen said 60.
--
-- One table now holds all of it. Idempotent: every statement is IF NOT EXISTS /
-- ON CONFLICT, so running it twice is harmless, and running it on a database
-- that already has the table never resets a price an admin has changed.
--
-- The free trial the client asked for is 90 days: it is the `Free` row below,
-- and its `days` value is what a brand-new salon's window is computed from.

BEGIN;

CREATE TABLE IF NOT EXISTS partner_plans (
    id             VARCHAR(40) PRIMARY KEY,       -- stored on salons.planType: NEVER re-slugged
    label          VARCHAR(120) NOT NULL,         -- what the card says
    price          DECIMAL(10, 2) NOT NULL DEFAULT 0, -- rupees
    days           INTEGER NOT NULL DEFAULT 30,   -- the length granted, source of truth
    note           VARCHAR(200),
    badge          VARCHAR(24),                   -- "BEST VALUE" / "DEFAULT" ribbon
    is_recommended BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE, -- false = off sale, still valid for holders
    is_free        BOOLEAN NOT NULL DEFAULT FALSE, -- exactly one row: the trial
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- What the three repositories sold before this release, at the same ids (every
-- `salons.planType` and every subscription row stores one of them), with the
-- free trial lengthened from 20 to 90 days.
INSERT INTO partner_plans (id, label, price, days, note, badge, is_recommended, sort_order, is_active, is_free) VALUES
    ('Free',           'Free trial',      0,   90, 'Start your salon journey at no cost', 'DEFAULT',    TRUE,  -1, TRUE, TRUE),
    ('monthly',        'Monthly Plan',    199, 30, 'Flexible month-to-month growth',      NULL,         FALSE,  0, TRUE, FALSE),
    ('trial_2_months', 'Introductory',    299, 60, 'A gentle start for new partners',     NULL,         FALSE,  1, TRUE, FALSE),
    ('quarterly',      'Quarterly Plan',  499, 90, 'Best value for busy salons',          'BEST VALUE', TRUE,   2, TRUE, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_partner_plans_order ON partner_plans (is_active, sort_order);

-- ── Salons on a plan that this table does not hold ──────────────────────────
-- A legacy id (`yearly`, or the `FREE` uppercase some older rows carry) has no
-- row to renew against. This returns them so the admin panel can show the gap
-- ("these 3 salons are on a plan that no longer exists") instead of the renewal
-- screen silently charging the 30-day default. Nothing is rewritten here: an id
-- is never changed behind a partner's back — `yearly` keeps working through the
-- legacy map in `plan.util.js` and `partnerPlan.service.js`.
--
--   SELECT planType, COUNT(*) FROM salons
--    WHERE planType IS NOT NULL
--      AND planType NOT IN (SELECT id FROM partner_plans)
--    GROUP BY planType ORDER BY 2 DESC;
--
-- ── The trial backfill (REVIEW BEFORE RUNNING) ──────────────────────────────
-- New salons get 90 days from now on. Salons created under the old 20-day rule
-- were given a window that the portal advertised inconsistently; the client asked
-- for a 90-day default, so the ones whose trial is still running are extended to
-- match. This touches ONLY the free plan, only salons whose plan type is the free
-- one, and only while they are still inside their original window — a salon that
-- has already paid for a plan is never touched, and an expired trial is not
-- resurrected.
--
-- Preview it first:
--
--   SELECT salon_id, plan_type, plan_start_date, plan_end_date
--     FROM salons
--    WHERE plan_type IN ('FREE', 'Free')
--      AND plan_end_date < plan_start_date + INTERVAL '90 days'
--      AND plan_end_date > NOW();
--
UPDATE salons
   SET plan_end_date = plan_start_date + INTERVAL '90 days',
       updated_at = NOW()
 WHERE plan_type IN ('FREE', 'Free')
   AND plan_start_date IS NOT NULL
   AND plan_end_date IS NOT NULL
   AND plan_end_date < plan_start_date + INTERVAL '90 days'
   AND plan_end_date > NOW();

COMMIT;
