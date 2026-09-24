-- =============================================================================
-- KashRoot Module 5: Admin + Analytics + Reviews + Disputes
-- Migration: reviews, disputes, dispute_evidence, chat_threads, chat_messages,
--            privacy_requests, service_accounts
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. REVIEWS (two-way: buyer→farmer AND farmer→buyer, tied to a completed order)
-- ---------------------------------------------------------------------------
CREATE TABLE reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id            UUID        NOT NULL REFERENCES orders(id)    ON DELETE RESTRICT,
  reviewer_profile_id UUID        NOT NULL,   -- farmer_profile.id OR buyer_profile.id
  reviewee_profile_id UUID        NOT NULL,   -- farmer_profile.id OR buyer_profile.id
  reviewer_role       TEXT        NOT NULL,   -- 'FARMER' | 'BUYER'

  rating              SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body                TEXT,
  is_visible          BOOLEAN     NOT NULL DEFAULT TRUE,
  hidden_reason       TEXT,                   -- set by SUPPORT_MODERATOR when is_visible=false

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One review per direction per order
  CONSTRAINT reviews_unique_direction UNIQUE (order_id, reviewer_profile_id, reviewer_role)
);

COMMENT ON TABLE reviews IS
  'Two-way post-order reviews. reviewer_role=BUYER means buyer reviewing farmer, '
  'reviewer_role=FARMER means farmer reviewing buyer. '
  'Only creatable when order.status IN (DELIVERED, COMPLETED). '
  'Ownership resolves through farmer_profiles.user_id / buyer_profiles.user_id.';

CREATE INDEX idx_reviews_order_id     ON reviews(order_id);
CREATE INDEX idx_reviews_reviewee_id  ON reviews(reviewee_profile_id);

-- ---------------------------------------------------------------------------
-- 2. DISPUTES
-- ---------------------------------------------------------------------------
CREATE TABLE disputes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id                UUID        NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,

  -- Operational region = order's origin region (farmer's region = primary resolver)
  -- Populated from orders.origin_region_id at dispute creation time (snapshot)
  operational_region_id   TEXT        NOT NULL,

  -- If the order is cross-border, destination region admin gets read + recommend access only
  destination_region_id   TEXT,       -- NULL for domestic orders
  is_cross_border         BOOLEAN     NOT NULL DEFAULT FALSE,

  initiated_by_user_id    UUID        NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
  assigned_to_user_id     UUID        REFERENCES users(id)           ON DELETE SET NULL,

  status                  TEXT        NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN','UNDER_REVIEW','RECOMMENDED','RESOLVED','CLOSED','ESCALATED')),

  type                    TEXT        NOT NULL
                          CHECK (type IN ('PAYMENT','DELIVERY','QUALITY','FRAUD','OTHER')),

  title                   TEXT        NOT NULL,
  description             TEXT        NOT NULL,

  -- Reference to chat thread for context (never creates a new open-ended DM)
  related_chat_thread_id  UUID,       -- FK added below after chat_threads is created

  resolution_summary      TEXT,       -- populated on RESOLVED
  resolved_by_user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  resolved_at             TIMESTAMPTZ,

  -- If resolution triggers a refund, it goes through the refunds table (Module 4)
  related_refund_id       UUID        REFERENCES refunds(id) ON DELETE SET NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE disputes IS
  'Operational region = order origin region (farmer side = primary resolver). '
  'Cross-border: destination region admin gets read + dispute:recommend only. '
  'Only operational-region admin (dispute:resolve:regional) or PLATFORM_ADMIN '
  '(dispute:resolve:global) can execute resolution. '
  'Refunds go through Module 4 refunds table, not ad hoc.';

CREATE INDEX idx_disputes_order_id             ON disputes(order_id);
CREATE INDEX idx_disputes_operational_region   ON disputes(operational_region_id);
CREATE INDEX idx_disputes_status               ON disputes(status);

-- ---------------------------------------------------------------------------
-- 3. DISPUTE_EVIDENCE
--    Same signed-URL / object-storage pattern as KYC docs and listing photos
-- ---------------------------------------------------------------------------
CREATE TABLE dispute_evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  dispute_id      UUID        NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  uploaded_by     UUID        NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,

  -- Stored as an S3 object key; signed URL generated at serve time (never stored)
  s3_key          TEXT        NOT NULL,
  file_url        TEXT,       -- optional public URL for non-sensitive files
  mime_type       TEXT        NOT NULL,
  size_bytes      BIGINT,
  description     TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dispute_evidence IS
  'Object-storage pattern: s3_key is the storage key; signed URL generated on demand. '
  'Same pattern as KYC docs and listing photos.';

CREATE INDEX idx_dispute_evidence_dispute_id ON dispute_evidence(dispute_id);

-- ---------------------------------------------------------------------------
-- 4. CHAT_THREADS
--    Scoped strictly to a single order_id OR appointment_id (never an open DM)
-- ---------------------------------------------------------------------------
CREATE TABLE chat_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exactly one of order_id or appointment_id must be set (enforced by CHECK)
  order_id          UUID        REFERENCES orders(id)       ON DELETE CASCADE,
  appointment_id    UUID        REFERENCES appointments(id) ON DELETE CASCADE,

  subject           TEXT,
  is_archived       BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exactly one scope at a time
  CONSTRAINT chat_threads_exactly_one_scope CHECK (
    (order_id IS NOT NULL AND appointment_id IS NULL)
    OR
    (order_id IS NULL AND appointment_id IS NOT NULL)
  ),

  -- One thread per order, one thread per appointment
  CONSTRAINT chat_threads_unique_order       UNIQUE (order_id),
  CONSTRAINT chat_threads_unique_appointment UNIQUE (appointment_id)
);

COMMENT ON TABLE chat_threads IS
  'Scoped to exactly one order OR one appointment. Never an open DM. '
  'A dispute can reference related_chat_thread_id for context.';

CREATE INDEX idx_chat_threads_order_id       ON chat_threads(order_id);
CREATE INDEX idx_chat_threads_appointment_id ON chat_threads(appointment_id);

-- Now add the deferred FK from disputes to chat_threads
ALTER TABLE disputes
  ADD CONSTRAINT fk_disputes_chat_thread
  FOREIGN KEY (related_chat_thread_id) REFERENCES chat_threads(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5. CHAT_MESSAGES
-- ---------------------------------------------------------------------------
CREATE TABLE chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  thread_id       UUID        NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_user_id  UUID        NOT NULL REFERENCES users(id)        ON DELETE RESTRICT,

  body            TEXT        NOT NULL,
  s3_key          TEXT,       -- optional attachment (signed URL on serve)
  mime_type       TEXT,
  is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE,  -- soft delete only
  deleted_at      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE chat_messages IS 'Messages within a chat_thread. Soft delete only.';

CREATE INDEX idx_chat_messages_thread_id ON chat_messages(thread_id);
CREATE INDEX idx_chat_messages_sender    ON chat_messages(sender_user_id);

-- ---------------------------------------------------------------------------
-- 6. PRIVACY_REQUESTS
--    Deletion = anonymize PII, NOT delete financial records
-- ---------------------------------------------------------------------------
CREATE TABLE privacy_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type                TEXT        NOT NULL CHECK (type IN ('EXPORT', 'DELETION')),
  status              TEXT        NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','PROCESSING','FULFILLED','REJECTED','FAILED')),

  -- DELETION: PII fields nulled/redacted on users, farmer_profiles, buyer_profiles.
  -- completed orders, payments, ledger_entries are PRESERVED with IDs intact.
  -- retained_data_note explains what was kept and why (per retention policy).
  retained_data_note  TEXT,

  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at        TIMESTAMPTZ,

  -- For EXPORT: reference to the exported file (signed URL on serve)
  export_s3_key       TEXT,

  -- Handled by which admin user
  handled_by_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason    TEXT
);

COMMENT ON TABLE privacy_requests IS
  'DELETION: anonymizes PII fields on user/profile rows. '
  'Does NOT delete completed orders/payments/ledger_entries (financial retention policy). '
  'retained_data_note explains what was kept and why. '
  'EXPORT: generates a data export archive stored in S3.';

CREATE INDEX idx_privacy_requests_user_id ON privacy_requests(user_id);
CREATE INDEX idx_privacy_requests_status  ON privacy_requests(status);

-- ---------------------------------------------------------------------------
-- 7. SERVICE_ACCOUNTS (machine identities — separate from users)
--    Used for service-to-service calls (cron jobs, internal tools, etc.)
--    NOT used for the Razorpay webhook (that uses HMAC signature verification).
-- ---------------------------------------------------------------------------
CREATE TABLE service_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name          TEXT        NOT NULL UNIQUE,  -- e.g. 'reservation-expiry-cron', 'admin-importer'
  scope         TEXT[]      NOT NULL DEFAULT '{}',  -- array of permission scopes
  api_key_hash  TEXT        NOT NULL UNIQUE,  -- bcrypt hash of the raw API key (never store raw)

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,                  -- NULL = active; set = revoked

  created_by_user_id UUID   REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE service_accounts IS
  'Machine identities for service-to-service authentication. '
  'Separate from human user accounts. api_key_hash = bcrypt hash (never store raw key). '
  'Razorpay webhook uses HMAC signature verification, not this table — '
  'ServiceAccountGuard is for internal service-to-service calls only.';

CREATE INDEX idx_service_accounts_name ON service_accounts(name);
