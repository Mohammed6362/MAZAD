-- فصل إشعارات الإدارة عن الحسابات، بما فيها الإشعارات المحفوظة سابقًا.
BEGIN;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'user'
  CHECK (audience IN ('user','admin'));
UPDATE notifications SET audience='admin' WHERE link ~ '^/admin([/?#]|$)';
CREATE INDEX IF NOT EXISTS ix_notifications_audience_user_time
  ON notifications(user_id,audience,created_at DESC,id DESC);

-- يشمل منتجي الإشعارات الحاليين في دوال القاعدة وأي إدخالات لاحقة.
CREATE OR REPLACE FUNCTION fn_notification_audience() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.link ~ '^/admin([/?#]|$)' THEN
    NEW.audience := 'admin';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notification_audience ON notifications;
CREATE TRIGGER trg_notification_audience BEFORE INSERT OR UPDATE OF link,audience ON notifications
  FOR EACH ROW EXECUTE FUNCTION fn_notification_audience();
COMMIT;
