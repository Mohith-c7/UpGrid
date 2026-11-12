-- 002: interview/assessment schedules, schedule reminders, bulk import index, audit log, support tickets, consent.
-- Idempotent: safe to re-run (the migrator also tracks it in schema_migrations).

-- ---------------------------------------------------------------- schedules
CREATE TABLE IF NOT EXISTS application_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('assessment','interview')),
  scheduled_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('online','in_person')),
  venue_or_link text NOT NULL,
  instructions text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE INDEX IF NOT EXISTS application_schedules_app_idx ON application_schedules (application_id, created_at DESC);
-- at most one live (latest) schedule per application
CREATE UNIQUE INDEX IF NOT EXISTS application_schedules_live_uq ON application_schedules (application_id) WHERE superseded_at IS NULL;

-- schedule reminders reuse scheduled_reminders (same worker, same SKIP LOCKED claiming)
ALTER TABLE scheduled_reminders ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE scheduled_reminders ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES application_schedules(id) ON DELETE CASCADE;
ALTER TABLE scheduled_reminders DROP CONSTRAINT IF EXISTS scheduled_reminders_kind_check;
ALTER TABLE scheduled_reminders ADD CONSTRAINT scheduled_reminders_kind_check CHECK (kind IN ('t60','t30','t15','sched60'));

-- ---------------------------------------------------------------- student import lookups
CREATE INDEX IF NOT EXISTS profiles_regno_idx ON profiles (tenant_id, (data->'identity'->>'registrationNumber'));

-- ---------------------------------------------------------------- audit log
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON audit_events (tenant_id, created_at DESC);

-- ---------------------------------------------------------------- support tickets
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('profile','eligibility','application','document','other')),
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS tickets_tenant_status_idx ON tickets (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS tickets_user_idx ON tickets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx ON ticket_messages (ticket_id, seq);

-- ---------------------------------------------------------------- consent
CREATE TABLE IF NOT EXISTS user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_consents_user_idx ON user_consents (user_id);
