-- ============================================================
-- Module 6: Notifications + Realtime
-- Migration: notification_preferences, notification_queue
-- ============================================================

-- notification categories (matches enqueue call-sites)
CREATE TYPE notification_category AS ENUM (
  'APPOINTMENT_REQUESTED',
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_REMINDER',
  'APPOINTMENT_NO_SHOW',
  'ORDER_STATUS_CHANGED',
  'ORDER_PLACED',
  'ORDER_COMPLETED',
  'RESERVATION_EXPIRED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'DISPUTE_RECOMMENDED',
  'REVIEW_RECEIVED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'PRIVACY_REQUEST_FULFILLED'
);

-- notification channels
CREATE TYPE notification_channel AS ENUM ('EMAIL', 'SMS', 'PUSH');

-- notification queue status
CREATE TYPE notification_status AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- -----------------------------------------------------------
-- notification_preferences
-- Per-user, per-category, per-channel opt-in/out.
-- Default: all enabled (preference row absent = enabled).
-- Unique: one row per (user_id, category, channel).
-- -----------------------------------------------------------
CREATE TABLE notification_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    notification_category NOT NULL,
  channel     notification_channel  NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_notif_pref UNIQUE (user_id, category, channel)
);

CREATE INDEX idx_notif_pref_user ON notification_preferences(user_id);

-- -----------------------------------------------------------
-- notification_queue
-- All notifications flow through this table.
-- BullMQ processor reads from the queue and dispatches.
-- Append-only for audit: status transitions are updates,
-- rows are never deleted.
-- -----------------------------------------------------------
CREATE TABLE notification_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category        notification_category NOT NULL,
  channel         notification_channel  NOT NULL,
  status          notification_status   NOT NULL DEFAULT 'QUEUED',

  -- Structured payload for the renderer/sender
  -- Shape is category-specific; validated in notifications.service.ts
  payload         JSONB NOT NULL DEFAULT '{}',

  -- Retry tracking
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_for   TIMESTAMPTZ,          -- NULL = send immediately
  sent_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,

  -- Idempotency: prevent duplicate sends for the same event
  -- Format: '<category>:<entity_id>' e.g. 'ORDER_STATUS_CHANGED:uuid'
  idempotency_key TEXT,

  CONSTRAINT uq_notif_idempotency UNIQUE (user_id, idempotency_key)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_notif_queue_user    ON notification_queue(user_id);
CREATE INDEX idx_notif_queue_status  ON notification_queue(status);
CREATE INDEX idx_notif_queue_created ON notification_queue(created_at);

-- COMMENT: idempotency_key is nullable so that non-deduped notifications
-- (e.g. generic alerts) can coexist without violating the UNIQUE constraint.
-- The DEFERRABLE clause allows bulk inserts to be checked at commit time.
