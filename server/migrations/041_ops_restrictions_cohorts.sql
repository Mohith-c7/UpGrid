-- 041: restrictions (scoped, approved, appealable) and cohorts. Idempotent.
CREATE TABLE IF NOT EXISTS restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('student','company','drive','department','batch','tenant')),
  scope_value text,
  student_id uuid REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  student_message text NOT NULL,
  evidence_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','active','rejected','lifted')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  lifted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  lifted_at timestamptz,
  lift_reason text,
  exempt_student_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS restrictions_tenant_status_idx ON restrictions (tenant_id, status, starts_at);
CREATE INDEX IF NOT EXISTS restrictions_student_idx ON restrictions (student_id) WHERE student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS restriction_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  restriction_id uuid NOT NULL REFERENCES restrictions(id) ON DELETE CASCADE,
  type text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restriction_events_idx ON restriction_events (restriction_id, id);

CREATE TABLE IF NOT EXISTS restriction_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  restriction_id uuid NOT NULL REFERENCES restrictions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','upheld','overturned')),
  decision_note text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restriction_appeals_idx ON restriction_appeals (tenant_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS restriction_appeals_pending_uq ON restriction_appeals (restriction_id, student_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('dynamic','fixed')),
  filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cohorts_name_uq ON cohorts (tenant_id, lower(name));
CREATE TABLE IF NOT EXISTS cohort_members (
  cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, user_id)
);
