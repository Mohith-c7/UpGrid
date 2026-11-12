-- 021: per-drive ordered rounds, per-candidate round status, append-only round events, attendance tokens.
CREATE TABLE IF NOT EXISTS drive_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  seq int NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('aptitude','assessment','coding','technical','hr','gd','custom')),
  assessment_id uuid,
  description text,
  mode text CHECK (mode IN ('online','in_person')),
  venue_or_link text,
  scheduled_at timestamptz,
  results_published_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drive_rounds_seq_uq UNIQUE (drive_id, seq) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS drive_rounds_drive_idx ON drive_rounds (drive_id, seq);

CREATE TABLE IF NOT EXISTS round_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES drive_rounds(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invited','attended','absent','passed','failed','on_hold')),
  waitlisted boolean NOT NULL DEFAULT false,
  waitlist_rank int,
  remark text,
  score numeric(5,2),
  advanced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, application_id)
);
CREATE INDEX IF NOT EXISTS round_candidates_app_idx ON round_candidates (application_id);
CREATE INDEX IF NOT EXISTS round_candidates_round_idx ON round_candidates (round_id, status);

CREATE TABLE IF NOT EXISTS round_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  round_id uuid NOT NULL REFERENCES drive_rounds(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  actor_id uuid,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS round_events_app_idx ON round_events (application_id, id);
CREATE OR REPLACE FUNCTION round_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'round_events is append-only'; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS round_events_no_update ON round_events;
CREATE TRIGGER round_events_no_update BEFORE UPDATE ON round_events FOR EACH ROW EXECUTE FUNCTION round_events_append_only();

CREATE TABLE IF NOT EXISTS attendance_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  round_id uuid NOT NULL REFERENCES drive_rounds(id) ON DELETE CASCADE,
  session text NOT NULL DEFAULT 'default',
  token_hash text NOT NULL UNIQUE,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_tokens_active_uq ON attendance_tokens (round_id, session) WHERE revoked_at IS NULL;
