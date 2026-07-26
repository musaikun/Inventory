-- Google Play account deletion lifecycle.
-- deletion_pending_at blocks normal access before external DO cleanup begins.
-- deletion_request_id binds a retry to the request that acquired the deletion marker.
ALTER TABLE stores ADD COLUMN deletion_pending_at TEXT;
ALTER TABLE stores ADD COLUMN deletion_request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_stores_deletion_pending
  ON stores(deletion_pending_at);
CREATE INDEX IF NOT EXISTS idx_stores_deleted_at
  ON stores(deleted_at);

-- Idempotency receipt. It intentionally contains no shop/account identifier.
CREATE TABLE IF NOT EXISTS account_deletion_receipts (
  request_id   TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_receipts_expires
  ON account_deletion_receipts(expires_at);

-- A request authenticated immediately before deletion could otherwise recreate
-- child rows after the deletion marker or tombstone is written. Every account-
-- keyed INSERT must still have an active parent store at statement execution time.
CREATE TRIGGER IF NOT EXISTS trg_store_configs_active_insert
BEFORE INSERT ON store_configs
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_inventory_active_insert
BEFORE INSERT ON store_inventory
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_history_active_insert
BEFORE INSERT ON store_history
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_auth_tokens_active_insert
BEFORE INSERT ON auth_tokens
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_login_attempts_active_insert
BEFORE INSERT ON login_attempts
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_sessions_active_insert
BEFORE INSERT ON sessions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_lines_active_insert
BEFORE INSERT ON inventory_lines
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_item_par_levels_active_insert
BEFORE INSERT ON item_par_levels
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_push_subscriptions_active_insert
BEFORE INSERT ON push_subscriptions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_active_insert
BEFORE INSERT ON orders
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_order_lines_active_insert
BEFORE INSERT ON order_lines
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_movements_active_insert
BEFORE INSERT ON movements
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;

CREATE TRIGGER IF NOT EXISTS trg_movement_lines_active_insert
BEFORE INSERT ON movement_lines
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM stores
  WHERE shop_code = NEW.shop_code
    AND deleted_at IS NULL
    AND deletion_pending_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'account_inactive');
END;
