-- 030: AI core — consent, usage accounting (no raw prompts), idempotent-output cache.
CREATE TABLE IF NOT EXISTS ai_consents (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  granted boolean NOT NULL DEFAULT false,
  version text NOT NULL DEFAULT 'v1',
  granted_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- one row per model call; stores only a hash of the prompt, never the text
CREATE TABLE IF NOT EXISTS ai_usage (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  model text NOT NULL,
  prompt_hash text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  latency_ms int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','error','bad_output','blocked','aborted')),
  cached boolean NOT NULL DEFAULT false,
  counted boolean NOT NULL DEFAULT false,
  error_code text,
  flags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_user_day_idx ON ai_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_tenant_idx ON ai_usage (tenant_id, created_at DESC);

-- validated outputs of idempotent prompts; user-scoped entries are deleted on consent revoke
CREATE TABLE IF NOT EXISTS ai_cache (
  key text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  value jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_cache_user_idx ON ai_cache (user_id);
CREATE INDEX IF NOT EXISTS ai_cache_expiry_idx ON ai_cache (expires_at);
