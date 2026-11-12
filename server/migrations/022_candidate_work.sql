-- 022: rubrics, scorecards, recruiter decisions, notes, outcome proposals, drive message thread.
CREATE TABLE IF NOT EXISTS drive_rubrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  round_id uuid REFERENCES drive_rounds(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  items jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS drive_rubrics_drive_uq ON drive_rubrics (drive_id) WHERE round_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS drive_rubrics_round_uq ON drive_rubrics (drive_id, round_id) WHERE round_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES drive_rounds(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ratings jsonb NOT NULL,
  overall numeric(4,2) NOT NULL,
  comments text,
  recommendation text NOT NULL CHECK (recommendation IN ('strong_hire','hire','no_hire','strong_no_hire')),
  rubric_version int NOT NULL DEFAULT 1,
  revision int NOT NULL DEFAULT 1,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, application_id, recruiter_id)
);
CREATE INDEX IF NOT EXISTS scorecards_app_idx ON scorecards (application_id);

CREATE TABLE IF NOT EXISTS candidate_decisions (
  application_id uuid PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('shortlisted','rejected','on_hold')),
  reason text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_decisions_drive_idx ON candidate_decisions (drive_id, decision);

CREATE TABLE IF NOT EXISTS candidate_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','private')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_notes_app_idx ON candidate_notes (application_id, created_at);

CREATE TABLE IF NOT EXISTS outcome_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('select','reject')),
  reason text,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  proposed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS outcome_pending_uq ON outcome_proposals (application_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS outcome_drive_idx ON outcome_proposals (drive_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS drive_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  client_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS drive_messages_drive_idx ON drive_messages (drive_id, seq DESC);
CREATE UNIQUE INDEX IF NOT EXISTS drive_messages_client_uq ON drive_messages (drive_id, author_id, client_id) WHERE client_id IS NOT NULL;
