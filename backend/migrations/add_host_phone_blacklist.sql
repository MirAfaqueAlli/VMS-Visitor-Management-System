-- Migration: host_phone_blacklist
-- Run on EACH unit database (e.g. vms_unit_ho, vms_unit_xyz, ...)
-- This table lets a host block a visitor by phone number.
-- Future visit requests from that phone to that host are automatically rejected.

CREATE TABLE IF NOT EXISTS host_phone_blacklist (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  host_user_id   INT UNSIGNED NOT NULL,           -- the host who is blocking
  visitor_phone  VARCHAR(20)  NOT NULL,           -- the blocked visitor's phone
  visitor_name   VARCHAR(120) NULL,               -- denormalised name for display
  reason         TEXT         NOT NULL,           -- reason required
  blocked_by     INT UNSIGNED NOT NULL,           -- user who created the block (host or admin)
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_host_phone (host_user_id, visitor_phone),
  INDEX idx_phone      (visitor_phone)

  -- Note: no FK to visitors.id because visitors may not have a record until check-in.
  -- The block is purely phone-based.
);
