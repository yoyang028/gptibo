CREATE TABLE member_notification_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled_since INTEGER NOT NULL
);
INSERT INTO member_notification_settings VALUES (1,CAST(strftime('%s','now') AS INTEGER)*1000);
CREATE TABLE member_notifications (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  member_id TEXT REFERENCES member_profiles(id),
  mail_body TEXT NOT NULL CHECK(json_valid(mail_body)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','retry','sent','failed','unknown','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX member_notification_due ON member_notifications(status,next_attempt_at,lease_until);
CREATE INDEX member_notification_feed ON member_notifications(member_id,created_at);
CREATE TRIGGER member_notification_payload_immutable BEFORE UPDATE ON member_notifications
WHEN NEW.id<>OLD.id OR NEW.event_key<>OLD.event_key OR NEW.kind<>OLD.kind OR NEW.target_id<>OLD.target_id OR NEW.member_id IS NOT OLD.member_id OR NEW.mail_body<>OLD.mail_body OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'Notification payload is immutable'); END;
