-- 043: company CRM. Idempotent.
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_key text NOT NULL,
  website text,
  website_host text,
  industry text NOT NULL DEFAULT '',
  hq text NOT NULL DEFAULT '',
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  verified boolean NOT NULL DEFAULT false,
  logo_file_id uuid,
  stage text NOT NULL DEFAULT 'prospect' CHECK (stage IN ('prospect','contacted','interested','mou','hiring')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companies_tenant_name_idx ON companies (tenant_id, name_key);
CREATE INDEX IF NOT EXISTS companies_tenant_stage_idx ON companies (tenant_id, stage);
CREATE TABLE IF NOT EXISTS company_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('call','meeting','email','other')),
  occurred_at timestamptz NOT NULL,
  summary text NOT NULL,
  follow_up_at timestamptz,
  follow_up_done boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_interactions_idx ON company_interactions (company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS company_interactions_followup_idx ON company_interactions (tenant_id, follow_up_at) WHERE follow_up_at IS NOT NULL AND follow_up_done = false;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS drives_company_idx ON drives (company_id) WHERE company_id IS NOT NULL;
