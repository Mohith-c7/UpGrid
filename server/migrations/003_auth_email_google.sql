-- 003: email verification, Google sign-in (passwordless / phoneless users), OTP codes.
-- Idempotent: safe to re-run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'password' CHECK (auth_provider IN ('password','google'));
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_uq ON users (tenant_id, google_sub) WHERE google_sub IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  email_key text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  code_hash text NOT NULL,
  salt text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  ip text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_lookup_idx ON otp_codes (tenant_id, email_key, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_codes_ip_idx ON otp_codes (ip, created_at DESC);
