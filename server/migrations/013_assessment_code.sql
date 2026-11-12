-- 013: code submissions (attempt runs/submissions and practice-problem submissions).
CREATE TABLE IF NOT EXISTS assessment_code_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  aq_id uuid REFERENCES assessment_questions(id) ON DELETE CASCADE,
  question_id uuid REFERENCES aq_questions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('run','submit')),
  source text NOT NULL DEFAULT 'student' CHECK (source IN ('student','final','practice')),
  language text NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','pending_judge','judged','error')),
  verdict text,
  passed int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  score numeric(9,2) NOT NULL DEFAULT 0,
  max_score numeric(9,2) NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  compile_output text,
  norm_hash text,
  tries int NOT NULL DEFAULT 0,
  next_try_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  judged_at timestamptz
);
CREATE INDEX IF NOT EXISTS acs_attempt_idx ON assessment_code_submissions (attempt_id, aq_id, kind, created_at);
CREATE INDEX IF NOT EXISTS acs_pending_idx ON assessment_code_submissions (next_try_at) WHERE status = 'pending_judge';
CREATE INDEX IF NOT EXISTS acs_practice_idx ON assessment_code_submissions (user_id, question_id) WHERE question_id IS NOT NULL;
