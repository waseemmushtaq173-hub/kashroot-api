-- ============================================================
-- KashRoot Module 4: Orders + Payments + Customs
-- Migration: 20260914_orders
--
-- Tables in creation order (FK dependencies respected):
--   1. region_pair_enablement   (trade-route gate, seeded)
--   2. fee_config_versions      (versioned fee config, immutable once superseded)
--   3. orders                   (no fixed trade_direction column)
--   4. order_pricing_snapshot   (immutable snapshot per order)
--   5. payments                 (unique idempotency_key)
--   6. refunds                  (own approval trail)
--   7. ledger_entries           (append-only)
--   8. customs_documents        (cross-border only)
-- ============================================================

-- ============================================================
-- 1. REGION PAIR ENABLEMENT
--    Hard gate: order creation rejected unless enabled=true.
--    Default: disabled. Only Kashmir-domestic routes seeded enabled.
-- ============================================================
CREATE TABLE IF NOT EXISTS region_pair_enablement (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_region_id            UUID NOT NULL REFERENCES regions(id),
  destination_region_id       UUID NOT NULL REFERENCES regions(id),
  payment_provider_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  customs_compliance_verified BOOLEAN NOT NULL DEFAULT FALSE,
  shipping_partner_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  enabled                     BOOLEAN NOT NULL DEFAULT FALSE,   -- must be explicitly set TRUE
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (origin_region_id, destination_region_id)
);

-- Seed: Kashmir-domestic routes ONLY (same-region self-trade + intra-Kashmir districts)
-- All other pairs start disabled (the table default).
-- Replace the UUIDs below with the actual region IDs from your seed data.
-- These are symbolic — your seed.ts should insert using region code lookups.
DO $$
DECLARE
  r_kashmir UUID;
BEGIN
  -- Resolve the Kashmir region by code; skip if not found (CI/CD safe)
  SELECT id INTO r_kashmir FROM regions WHERE code = 'IN-JK' LIMIT 1;
  IF r_kashmir IS NOT NULL THEN
    INSERT INTO region_pair_enablement (
      origin_region_id,
      destination_region_id,
      payment_provider_verified,
      customs_compliance_verified,
      shipping_partner_verified,
      enabled,
      notes
    ) VALUES (
      r_kashmir,
      r_kashmir,
      TRUE,
      TRUE,
      TRUE,
      TRUE,   -- Kashmir → Kashmir domestic: ENABLED
      'Kashmir domestic route — enabled at platform launch'
    )
    ON CONFLICT (origin_region_id, destination_region_id)
    DO UPDATE SET
      enabled   = TRUE,
      notes     = EXCLUDED.notes,
      updated_at = NOW();
  END IF;
END $$;
-- Cross-border and all other region pairs: NOT inserted here.
-- Absence from the table = disabled (enforced in RegionPairEnablementService).

-- ============================================================
-- 2. FEE CONFIG VERSIONS
--    Immutable once superseded (effective_to set, is_current = false).
--    Service layer never updates amount columns on existing rows.
-- ============================================================
CREATE TABLE IF NOT EXISTS fee_config_versions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_label           TEXT NOT NULL,
  effective_from          TIMESTAMPTZ NOT NULL,
  effective_to            TIMESTAMPTZ,                    -- NULL = currently active
  is_current              BOOLEAN NOT NULL DEFAULT TRUE,
  service_fee_rate        NUMERIC(6,4) NOT NULL,          -- e.g. 0.0250 = 2.50%
  shipping_base_amount    NUMERIC(14,4) NOT NULL DEFAULT 0,
  customs_duty_rate       NUMERIC(6,4) NOT NULL DEFAULT 0,-- used only for cross-border
  currency                VARCHAR(3)  NOT NULL DEFAULT 'INR',
  region_id               UUID REFERENCES regions(id),   -- NULL = global
  created_by              UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NO updated_at: rows are append-only. Supersession = new row + old effective_to = NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS fee_config_versions_current_global_uq
  ON fee_config_versions (region_id, is_current)
  WHERE is_current = TRUE;

-- Seed: global baseline fee version
INSERT INTO fee_config_versions (
  version_label,
  effective_from,
  is_current,
  service_fee_rate,
  shipping_base_amount,
  customs_duty_rate,
  currency
) VALUES (
  'v1.0 — launch baseline',
  NOW(),
  TRUE,
  0.0250,  -- 2.5% service fee
  0,
  0,
  'INR'
) ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. ORDERS
--    - No fixed trade_direction column (derived in service).
--    - Snapshot columns: origin_region_id, destination_region_id,
--      is_cross_border (derived from country codes at creation).
--    - Ownership via farmer_profile_id / buyer_profile_id.
--    - Idempotency: payment_idempotency_key unique.
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership (resolved via user_id on profile tables, not raw user_id FK)
  farmer_profile_id         UUID NOT NULL REFERENCES farmer_profiles(id),
  buyer_profile_id          UUID NOT NULL REFERENCES buyer_profiles(id),

  -- Listing & reservation snapshot
  listing_id                UUID NOT NULL REFERENCES listings(id),
  inventory_reservation_id  UUID         REFERENCES inventory_reservations(id),  -- committed on order
  quantity                  NUMERIC(14,4) NOT NULL,
  unit_price                NUMERIC(14,4) NOT NULL,  -- snapshot at order time
  currency                  VARCHAR(3)   NOT NULL DEFAULT 'INR',

  -- Trade-route snapshots (immutable after creation)
  origin_region_id          UUID NOT NULL REFERENCES regions(id),
  destination_region_id     UUID NOT NULL REFERENCES regions(id),
  is_cross_border           BOOLEAN NOT NULL DEFAULT FALSE,  -- derived from country codes
  -- NOTE: NO trade_direction column. Use OrdersService.getTradeDirection(order, perspectiveRegionId).

  -- Payment idempotency
  payment_idempotency_key   VARCHAR(128) UNIQUE,

  -- Appointment trust-gate reference
  qualifying_appointment_id UUID REFERENCES appointments(id),  -- the COMPLETED appt that unlocked this order

  -- Status lifecycle:
  -- placed → confirmed → packed → shipped
  --   → customs_clearance (cross-border only) → out_for_delivery → delivered → completed
  --   → cancelled | disputed
  status                    VARCHAR(32)  NOT NULL DEFAULT 'PLACED'
                            CHECK (status IN (
                              'PLACED','CONFIRMED','PACKED','SHIPPED',
                              'CUSTOMS_CLEARANCE','OUT_FOR_DELIVERY',
                              'DELIVERED','COMPLETED','CANCELLED','DISPUTED'
                            )),

  -- Fee version used for this order's pricing snapshot
  fee_config_version_id     UUID         REFERENCES fee_config_versions(id),

  cancelled_at              TIMESTAMPTZ,
  cancellation_reason       TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_farmer_profile_idx ON orders(farmer_profile_id);
CREATE INDEX IF NOT EXISTS orders_buyer_profile_idx  ON orders(buyer_profile_id);
CREATE INDEX IF NOT EXISTS orders_status_idx         ON orders(status);
CREATE INDEX IF NOT EXISTS orders_listing_idx        ON orders(listing_id);

-- ============================================================
-- 4. ORDER PRICING SNAPSHOT
--    Immutable: never update amount columns here after creation.
--    Historical orders must always reflect the pricing at order time.
-- ============================================================
CREATE TABLE IF NOT EXISTS order_pricing_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  fee_config_version_id UUID NOT NULL REFERENCES fee_config_versions(id),

  -- Pricing breakdown (all amounts in the order's currency)
  unit_price            NUMERIC(14,4) NOT NULL,
  quantity              NUMERIC(14,4) NOT NULL,
  subtotal              NUMERIC(14,4) NOT NULL,  -- unit_price * quantity
  service_fee_rate      NUMERIC(6,4)  NOT NULL,
  service_fee_amount    NUMERIC(14,4) NOT NULL,
  shipping_estimate     NUMERIC(14,4) NOT NULL DEFAULT 0,
  customs_duty_rate     NUMERIC(6,4)  NOT NULL DEFAULT 0,
  customs_duty_estimate NUMERIC(14,4) NOT NULL DEFAULT 0,
  total                 NUMERIC(14,4) NOT NULL,
  currency              VARCHAR(3)    NOT NULL DEFAULT 'INR',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NO updated_at: this record is write-once.
);

-- ============================================================
-- 5. PAYMENTS
--    unique idempotency_key: one intent per order attempt.
--    provider_ref: used for webhook deduplication.
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL REFERENCES orders(id),
  provider             VARCHAR(32)  NOT NULL CHECK (provider IN ('razorpay','stripe')),
  provider_ref         VARCHAR(255),           -- provider's payment ID (for webhook dedup)
  idempotency_key      VARCHAR(128) NOT NULL UNIQUE,
  amount               NUMERIC(14,4) NOT NULL,
  currency             VARCHAR(3)   NOT NULL DEFAULT 'INR',
  status               VARCHAR(32)  NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','CAPTURED','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
  gateway_response     JSONB,                  -- raw provider response (immutable after capture)
  webhook_received_at  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_uq
  ON payments (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);

-- ============================================================
-- 6. REFUNDS
--    Separate from payments.status — a refund is its own event
--    with its own approval trail.
-- ============================================================
CREATE TABLE IF NOT EXISTS refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id),
  payment_id      UUID NOT NULL REFERENCES payments(id),
  amount          NUMERIC(14,4) NOT NULL,
  currency        VARCHAR(3)   NOT NULL DEFAULT 'INR',
  reason          TEXT,
  status          VARCHAR(32)  NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','APPROVED','PROCESSED','REJECTED','FAILED')),
  initiated_by    UUID NOT NULL REFERENCES users(id),  -- user who requested refund
  approved_by     UUID         REFERENCES users(id),   -- SUPPORT_MODERATOR / REGIONAL_ADMIN
  provider_ref    VARCHAR(255),                        -- provider refund ID after processing
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS refunds_order_idx   ON refunds(order_id);
CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds(payment_id);

-- ============================================================
-- 7. LEDGER ENTRIES  (append-only)
--    Corrections = new offsetting entries, never edits/deletes.
--    Enforced at service layer: no update/delete methods exposed.
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_profile_id UUID REFERENCES farmer_profiles(id),
  buyer_profile_id  UUID REFERENCES buyer_profiles(id),
  entry_type        VARCHAR(6) NOT NULL CHECK (entry_type IN ('CREDIT','DEBIT')),
  amount            NUMERIC(14,4) NOT NULL CHECK (amount > 0),
  currency          VARCHAR(3)  NOT NULL DEFAULT 'INR',
  related_order_id  UUID REFERENCES orders(id),
  related_refund_id UUID REFERENCES refunds(id),
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NO updated_at, NO deleted_at — append-only by design.
);

-- Prevent accidental future ALTER TABLE ADD COLUMN DEFAULT NULL (guard only; real guard is service layer)
COMMENT ON TABLE ledger_entries IS
  'Append-only. Never UPDATE or DELETE rows. Corrections = new offsetting CREDIT/DEBIT entries.';

CREATE INDEX IF NOT EXISTS ledger_farmer_idx  ON ledger_entries(farmer_profile_id);
CREATE INDEX IF NOT EXISTS ledger_buyer_idx   ON ledger_entries(buyer_profile_id);
CREATE INDEX IF NOT EXISTS ledger_order_idx   ON ledger_entries(related_order_id);

-- ============================================================
-- 8. CUSTOMS DOCUMENTS
--    Only created when orders.is_cross_border = TRUE.
-- ============================================================
CREATE TABLE IF NOT EXISTS customs_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  doc_type    VARCHAR(64)  NOT NULL,   -- e.g. 'PHYTOSANITARY','INVOICE','PACKING_LIST','HS_CODE_DECLARATION'
  hs_code     VARCHAR(16),             -- Harmonized System commodity code
  file_url    TEXT,                    -- S3 URL or similar
  status      VARCHAR(32)  NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING','SUBMITTED','APPROVED','REJECTED','EXPIRED')),
  uploaded_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customs_docs_order_idx ON customs_documents(order_id);

-- ============================================================
-- SEEDED REGION PAIR ENABLEMENT SUMMARY
-- ============================================================
-- Kashmir → Kashmir (IN-JK → IN-JK): ENABLED  ✓
-- All other region pairs:             NOT INSERTED = DISABLED ✓
-- Service rejects order creation if no enabled row found for (origin, destination).
-- ============================================================
