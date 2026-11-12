-- 044: student document verification queue. Idempotent. (file_id is a soft reference: the files module may not be installed.)
CREATE TABLE IF NOT EXISTS student_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('marksheet','id_proof','resume','certificate','offer_letter','other')),
  label text NOT NULL,
  file_id uuid,
  url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  reject_reason text,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((file_id IS NOT NULL) <> (url IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS student_documents_queue_idx ON student_documents (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS student_documents_user_idx ON student_documents (user_id, created_at DESC);
