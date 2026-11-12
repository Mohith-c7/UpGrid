-- 020: recruiter role, per-drive recruiter membership + invites, shared-field consent snapshot, pipeline settings.
-- Idempotent.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student','officer','recruiter'));

CREATE TABLE IF NOT EXISTS recruiter_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_key text NOT NULL,
  name text,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recruiter_invites_pending_uq ON recruiter_invites (drive_id, email_key) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS recruiter_invites_email_idx ON recruiter_invites (tenant_id, email_key);

CREATE TABLE IF NOT EXISTS company_recruiters (
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason text,
  PRIMARY KEY (drive_id, user_id)
);
CREATE INDEX IF NOT EXISTS company_recruiters_user_idx ON company_recruiters (user_id) WHERE revoked_at IS NULL;

-- What the student consented to share with the company when applying (frozen at apply time).
CREATE TABLE IF NOT EXISTS application_shared_fields (
  application_id uuid PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  field_keys text[] NOT NULL DEFAULT '{}',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_shared_fields_drive_idx ON application_shared_fields (drive_id);

CREATE OR REPLACE FUNCTION pipeline_shared_data(snap jsonb) RETURNS jsonb AS $$
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
    FROM jsonb_each(COALESCE(snap->'student', '{}'::jsonb)) AS t(k, v)
   WHERE k IN ('name','email','phone','registrationNumber','department','program','batchYear','cgpa','cgpaScale',
               'tenthPercent','twelfthPercent','activeBacklogs','gapYears','linkedin');
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION pipeline_record_shared_fields() RETURNS trigger AS $$
DECLARE d jsonb;
BEGIN
  d := pipeline_shared_data(NEW.snapshot);
  INSERT INTO application_shared_fields (application_id, tenant_id, drive_id, field_keys, data, verification)
  VALUES (NEW.id, NEW.tenant_id, NEW.drive_id, ARRAY(SELECT jsonb_object_keys(d) ORDER BY 1), d, COALESCE(NEW.snapshot->'student'->'verification', '{}'::jsonb))
  ON CONFLICT (application_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS applications_record_shared_fields ON applications;
CREATE TRIGGER applications_record_shared_fields AFTER INSERT ON applications
  FOR EACH ROW EXECUTE FUNCTION pipeline_record_shared_fields();

INSERT INTO application_shared_fields (application_id, tenant_id, drive_id, field_keys, data, verification)
SELECT a.id, a.tenant_id, a.drive_id, ARRAY(SELECT jsonb_object_keys(pipeline_shared_data(a.snapshot)) ORDER BY 1),
       pipeline_shared_data(a.snapshot), COALESCE(a.snapshot->'student'->'verification', '{}'::jsonb)
  FROM applications a
ON CONFLICT (application_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS drive_pipeline_settings (
  drive_id uuid PRIMARY KEY REFERENCES drives(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- idempotency records for confirm-style pipeline operations (bulk advance, ...)
CREATE TABLE IF NOT EXISTS pipeline_operations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope text NOT NULL,
  key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, key)
);
