-- 004: file metadata for Cloudflare R2 uploads (objects live in the bucket; only metadata here) + file-backed resumes.
-- Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('resume','photo','company_logo','document')),
  key text NOT NULL UNIQUE,
  file_name text,
  content_type text NOT NULL,
  size bigint NOT NULL CHECK (size > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE INDEX IF NOT EXISTS files_owner_idx ON files (owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS files_tenant_idx ON files (tenant_id, purpose);

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_id uuid REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE resumes ALTER COLUMN url DROP NOT NULL;
CREATE INDEX IF NOT EXISTS resumes_file_idx ON resumes (file_id) WHERE file_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resumes_file_uq ON resumes (user_id, file_id) WHERE file_id IS NOT NULL;
