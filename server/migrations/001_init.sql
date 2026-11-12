CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tenants (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'Demo University')
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) DEFAULT '00000000-0000-4000-8000-000000000001',
  role text NOT NULL CHECK (role IN ('student','officer')),
  name text NOT NULL,
  email text NOT NULL,
  email_key text NOT NULL,
  phone char(10) NOT NULL,
  password_hash text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key_uq ON users (tenant_id, email_key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uq ON users (tenant_id, phone) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  url text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resumes_user_idx ON resumes (user_id);

CREATE TABLE IF NOT EXISTS drives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  company jsonb NOT NULL DEFAULT '{}'::jsonb,
  role text NOT NULL DEFAULT '',
  work_mode text,
  locations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ctc jsonb NOT NULL DEFAULT '{}'::jsonb,
  deadline timestamptz,
  jd text NOT NULL DEFAULT '',
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  rounds jsonb NOT NULL DEFAULT '[]'::jsonb,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_note text NOT NULL DEFAULT '',
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at timestamptz,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drives_tenant_status_idx ON drives (tenant_id, status, deadline);

CREATE TABLE IF NOT EXISTS saved_drives (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, drive_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'submitted',
  idempotency_key uuid NOT NULL,
  resume_id uuid REFERENCES resumes(id) ON DELETE SET NULL,
  resume_snapshot jsonb,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
-- one ACTIVE application per (drive, user); a withdrawn one frees the slot
CREATE UNIQUE INDEX IF NOT EXISTS applications_active_uq ON applications (drive_id, user_id) WHERE status <> 'withdrawn';
CREATE INDEX IF NOT EXISTS applications_user_idx ON applications (user_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS application_events (
  id bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  actor_id uuid,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_events_app_idx ON application_events (application_id, id);

CREATE OR REPLACE FUNCTION application_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'application_events is append-only';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS application_events_no_update ON application_events;
CREATE TRIGGER application_events_no_update BEFORE UPDATE ON application_events
  FOR EACH ROW EXECUTE FUNCTION application_events_append_only();

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reminder_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  settings jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices (user_id);

CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('t60','t30','t15')),
  fire_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled','skipped')),
  processed_at timestamptz,
  UNIQUE (drive_id, user_id, kind)
);
CREATE INDEX IF NOT EXISTS scheduled_reminders_due_idx ON scheduled_reminders (fire_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  author_id uuid NOT NULL REFERENCES users(id),
  drive_id uuid REFERENCES drives(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  recipients int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
