-- 042: announcements v2 (extends the v1 table), deliveries/read receipts, templates, calendar feed tokens. Idempotent.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent';
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audience jsonb NOT NULL DEFAULT '{"type":"all"}'::jsonb;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS channels jsonb NOT NULL DEFAULT '{"inApp":true,"push":false,"email":false}'::jsonb;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS send_at timestamptz;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS template_id uuid;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS v2 boolean NOT NULL DEFAULT false;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS announcements_due_idx ON announcements (send_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS announcements_tenant_idx ON announcements (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_deliveries (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  push_status text,
  email_status text,
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS announcement_deliveries_user_idx ON announcement_deliveries (user_id, delivered_at DESC);

CREATE TABLE IF NOT EXISTS announcement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS announcement_templates_name_uq ON announcement_templates (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS calendar_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_tokens_active_uq ON calendar_tokens (user_id) WHERE revoked_at IS NULL;
