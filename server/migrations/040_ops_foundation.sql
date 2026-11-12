-- 040: placement operations foundation: audit columns, tenant settings, policy engine, evaluation log, analytics indexes. Idempotent.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entity_id text;
CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events (tenant_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events (tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events (tenant_id, actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  policy jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS policy jsonb;
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS placement_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS placement_policies_name_uq ON placement_policies (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES placement_policies(id) ON DELETE CASCADE,
  version int NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','scheduled','active','superseded')),
  policy jsonb NOT NULL,
  effective_from timestamptz,
  note text NOT NULL DEFAULT '',
  rollback_of uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  activated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);
CREATE INDEX IF NOT EXISTS policy_versions_tenant_status_idx ON policy_versions (tenant_id, status, effective_from);
CREATE UNIQUE INDEX IF NOT EXISTS policy_versions_one_active_uq ON policy_versions (tenant_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS eligibility_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  policy_version_id uuid,
  status text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  context text NOT NULL DEFAULT 'apply',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eligibility_evaluations_idx ON eligibility_evaluations (tenant_id, drive_id, user_id, created_at DESC);

-- analytics indexes
CREATE INDEX IF NOT EXISTS profiles_dept_idx ON profiles (tenant_id, lower(data->'academics'->>'department'));
CREATE INDEX IF NOT EXISTS profiles_batch_idx ON profiles (tenant_id, (data->'academics'->>'batchYear'));
CREATE INDEX IF NOT EXISTS applications_tenant_submitted_idx ON applications (tenant_id, submitted_at);
CREATE INDEX IF NOT EXISTS applications_tenant_drive_idx ON applications (tenant_id, drive_id, status);
CREATE INDEX IF NOT EXISTS application_events_status_idx ON application_events (status, application_id);
CREATE INDEX IF NOT EXISTS application_events_actor_idx ON application_events (actor_id, created_at);
