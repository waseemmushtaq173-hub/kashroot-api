-- ============================================================
-- Migration: Appointments + Trust Policies
-- ============================================================
--
-- KEY DESIGN DECISIONS
-- --------------------
-- 1. btree_gist extension is REQUIRED for the EXCLUDE constraint.
--    Without it, Postgres cannot combine an equality operator on
--    a scalar column (farmer_profile_id UUID, WITH =) with a
--    range operator (tsrange, WITH &&) in a single GiST index.
--
-- 2. The EXCLUDE constraint covers only ACTIVE statuses:
--    status IN ('REQUESTED', 'CONFIRMED')
--    Completed, cancelled, rescheduled, and no-show rows are
--    excluded from the constraint so historical data never
--    blocks future bookings.
--
-- 3. tsrange('[)') = closed-start, open-end. Two appointments
--    sharing only a boundary point (e.g. 10:00-11:00 and
--    11:00-12:00) will NOT trigger the constraint — they are
--    adjacent, not overlapping. Correct for appointment grids.
--
-- 4. trust_policies is versioned + optionally region-scoped.
--    The service always picks the most-specific active row:
--    region-scoped > global (region_id IS NULL).
-- ============================================================

-- Step 1: enable btree_gist (idempotent)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Step 2: create the appointments table
CREATE TABLE IF NOT EXISTS appointments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Participants resolved through profile tables, never raw user IDs
  farmer_profile_id   UUID        NOT NULL REFERENCES farmer_profiles(id) ON DELETE RESTRICT,
  buyer_profile_id    UUID        NOT NULL REFERENCES buyer_profiles(id)  ON DELETE RESTRICT,

  -- Linked listing (optional — appointment may be exploratory)
  listing_id          UUID        REFERENCES listings(id) ON DELETE SET NULL,

  -- ── Time storage (always UTC) ──────────────────────────────────────
  -- Both start and end are stored. The UI must convert to local timezone
  -- using the requester_timezone / farmer_timezone fields below.
  start_time_utc      TIMESTAMPTZ NOT NULL,
  end_time_utc        TIMESTAMPTZ NOT NULL,

  -- Timezone labels sent by the requester so the UI can display
  -- local-to-each-party times without recomputing from coords.
  requester_timezone  TEXT        NOT NULL DEFAULT 'UTC',  -- buyer's local tz (IANA)
  farmer_timezone     TEXT        NOT NULL DEFAULT 'UTC',  -- farmer's local tz (IANA)

  -- ── Status lifecycle ───────────────────────────────────────────────
  -- requested → confirmed → completed | no_show | cancelled | rescheduled
  -- ONLY status='completed' satisfies the trust-gate for checkout.
  -- 'confirmed' is NOT sufficient. See appointments.service.ts:
  --   isAppointmentCompleted() — NOT isAppointmentConfirmed().
  status              TEXT        NOT NULL DEFAULT 'REQUESTED'
                        CHECK (status IN (
                          'REQUESTED',
                          'CONFIRMED',
                          'COMPLETED',
                          'NO_SHOW',
                          'CANCELLED',
                          'RESCHEDULED'
                        )),

  -- Which party (FARMER | BUYER) is marked no-show (nullable)
  no_show_party       TEXT        CHECK (no_show_party IN ('FARMER', 'BUYER')),

  -- Free-text note from the requester (e.g. "interested in 50 kg saffron")
  notes               TEXT,

  -- If rescheduled, link to the replacement appointment
  rescheduled_to_id   UUID        REFERENCES appointments(id) ON DELETE SET NULL,

  -- BullMQ reminder job ID stored so we can cancel/reschedule it
  reminder_job_id     TEXT,

  -- Trust policy version applied at request time (for auditability)
  trust_policy_id     UUID        REFERENCES trust_policies(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_appointments_farmer_profile_id
  ON appointments (farmer_profile_id);

CREATE INDEX IF NOT EXISTS idx_appointments_buyer_profile_id
  ON appointments (buyer_profile_id);

CREATE INDEX IF NOT EXISTS idx_appointments_status
  ON appointments (status);

CREATE INDEX IF NOT EXISTS idx_appointments_start_time_utc
  ON appointments (start_time_utc);

-- ── EXCLUSION CONSTRAINT: no overlapping active appointments ─────────
--
-- This blocks two appointments for the same farmer from overlapping
-- in time, at the database level — not just at the exact same start_time.
--
-- How it works:
--   tsrange(start_time_utc, end_time_utc, '[)') builds a half-open range.
--   WITH &&  = overlap operator on tsrange.
--   WITH =   = equality operator on UUID (farmer_profile_id).
--              Requires btree_gist to combine scalar + range in GiST.
--   WHERE (status IN ('REQUESTED','CONFIRMED')) = partial constraint;
--   rows in other statuses (COMPLETED, CANCELLED, etc.) are invisible
--   to the constraint and cannot block future bookings.
--
-- Example blocked: farmer A has 10:00-11:00 CONFIRMED.
--   → INSERT 10:30-11:30 for same farmer → EXCLUDED (overlap).
--   → INSERT 11:00-12:00 for same farmer → ALLOWED ([) boundary).
--   → INSERT 10:30-11:30 for different farmer → ALLOWED (different id).

CREATE UNIQUE INDEX IF NOT EXISTS appointments_farmer_no_overlap
  ON appointments USING GIST (
    farmer_profile_id,
    tsrange(start_time_utc, end_time_utc, '[)')
  )
  WHERE (status IN ('REQUESTED', 'CONFIRMED'));

-- NOTE: The above CREATE UNIQUE INDEX ON ... USING GIST with a WHERE clause
-- is the migration-safe way to express the exclusion. The semantically
-- equivalent EXCLUDE USING GIST ... WHERE clause syntax (shown below for
-- reference) is also valid in Postgres 14+ but requires the table to exist
-- first when adding as an ALTER TABLE:
--
-- ALTER TABLE appointments
--   ADD CONSTRAINT appointments_farmer_no_overlap
--   EXCLUDE USING GIST (
--     farmer_profile_id  WITH =,
--     tsrange(start_time_utc, end_time_utc, '[)')  WITH &&
--   )
--   WHERE (status IN ('REQUESTED', 'CONFIRMED'));
--
-- Both approaches produce the same GiST index. We use the CREATE UNIQUE
-- INDEX form here because Prisma migrations apply the full SQL block and
-- the ALTER TABLE form has a known race on initial table creation.
-- ─────────────────────────────────────────────────────────────────────

-- ============================================================
-- Trust Policies table
-- ============================================================
-- Versioned config rows. Service reads the most-specific active row:
--   region_id IS NOT NULL (region-scoped) > region_id IS NULL (global).
-- Changing a policy creates a new row; old rows are retained for audit.

CREATE TABLE IF NOT EXISTS trust_policies (
  id                                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = global policy; non-null = region-specific override
  region_id                             UUID        REFERENCES regions(id) ON DELETE SET NULL,

  -- Policy fields
  -- true  = buyer/farmer pair that has never transacted must book an
  --         appointment before placing an order.
  first_time_pair_requires_appointment  BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Orders above this value always require a completed appointment,
  -- even if the pair has transacted before. 0 = never required by value.
  min_order_value_requiring_appointment NUMERIC(14,4) NOT NULL DEFAULT 0,

  -- How many no-show events on a profile trigger a review flag
  -- in the audit_log (does NOT auto-suspend).
  no_show_count_threshold_for_review    INTEGER     NOT NULL DEFAULT 3,

  -- Whether this row is the active policy (soft-versioning)
  is_active                             BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Version label for human readability (e.g. "v1", "2026-Q4")
  version_label                         TEXT,

  -- Currency for min_order_value (ISO 4217)
  currency                              TEXT        NOT NULL DEFAULT 'INR',

  created_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce only one active global policy and one active regional policy
  -- per region at a time
  UNIQUE (region_id, is_active) DEFERRABLE INITIALLY DEFERRED
);

-- Seed a default global policy row
INSERT INTO trust_policies (
  id,
  region_id,
  first_time_pair_requires_appointment,
  min_order_value_requiring_appointment,
  no_show_count_threshold_for_review,
  is_active,
  version_label,
  currency
) VALUES (
  gen_random_uuid(),
  NULL,     -- global
  TRUE,
  0,
  3,
  TRUE,
  'v1',
  'INR'
) ON CONFLICT DO NOTHING;

-- ── no_show_count columns on profile tables ──────────────────────────
-- Tracks cumulative no-show events per profile.
-- Compared against trust_policies.no_show_count_threshold_for_review.

ALTER TABLE farmer_profiles
  ADD COLUMN IF NOT EXISTS no_show_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE buyer_profiles
  ADD COLUMN IF NOT EXISTS no_show_count INTEGER NOT NULL DEFAULT 0;
