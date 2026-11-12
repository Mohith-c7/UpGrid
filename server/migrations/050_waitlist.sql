-- 050: public pre-launch waitlist (marketing website form). Idempotent.
CREATE TABLE IF NOT EXISTS waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) DEFAULT '00000000-0000-4000-8000-000000000001',
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('student','placement_officer','recruiter','other')),
  college text,
  email text NOT NULL,
  email_key text NOT NULL,
  phone text,
  consent_at timestamptz NOT NULL DEFAULT now(),
  terms_version text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_signups_email_uq UNIQUE (tenant_id, email_key)
);
CREATE INDEX IF NOT EXISTS waitlist_signups_created_idx ON waitlist_signups (tenant_id, created_at DESC);
