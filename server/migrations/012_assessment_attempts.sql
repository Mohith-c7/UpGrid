-- 012: attempts, answers (autosave), proctor events.
CREATE TABLE IF NOT EXISTS assessment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_no int NOT NULL DEFAULT 1,
  seed bigint NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted')),
  submit_reason text CHECK (submit_reason IS NULL OR submit_reason IN ('student','deadline','proctor','closed','admin')),
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  submitted_at timestamptz,
  is_practice boolean NOT NULL DEFAULT false,
  warnings int NOT NULL DEFAULT 0,
  section_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluation text NOT NULL DEFAULT 'pending' CHECK (evaluation IN ('pending','complete')),
  score numeric(9,2),
  max_score numeric(9,2),
  section_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  passed boolean,
  graded_at timestamptz,
  score_override numeric(9,2),
  override_reason text,
  override_by uuid REFERENCES users(id) ON DELETE SET NULL,
  override_at timestamptz,
  UNIQUE (assessment_id, user_id, attempt_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_attempts_active_uq ON assessment_attempts (assessment_id, user_id) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS assessment_attempts_due_idx ON assessment_attempts (deadline_at) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS assessment_attempts_user_idx ON assessment_attempts (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS assessment_answers (
  attempt_id uuid NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  aq_id uuid NOT NULL REFERENCES assessment_questions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  answer jsonb,
  answer_ts bigint NOT NULL DEFAULT 0,
  flagged boolean NOT NULL DEFAULT false,
  flag_ts bigint NOT NULL DEFAULT 0,
  time_spent_ms int NOT NULL DEFAULT 0,
  score numeric(9,2),
  correct text CHECK (correct IS NULL OR correct IN ('correct','partial','wrong','unanswered')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, aq_id)
);

CREATE TABLE IF NOT EXISTS assessment_proctor_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attempt_id uuid NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('focus_lost','focus_regained','app_background','network_offline')),
  client_ts bigint,
  event_key text,
  counted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_proctor_events_a_idx ON assessment_proctor_events (attempt_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_proctor_events_key_uq ON assessment_proctor_events (attempt_id, event_key) WHERE event_key IS NOT NULL;
