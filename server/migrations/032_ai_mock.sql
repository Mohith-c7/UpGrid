-- 032: mock interviews (student practice; scores are advisory and never shared).
CREATE TABLE IF NOT EXISTS ai_mock_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_id uuid REFERENCES drives(id) ON DELETE SET NULL,
  role text NOT NULL,
  type text NOT NULL CHECK (type IN ('hr','technical','behavioural','coding_concepts')),
  difficulty text NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  num_questions int NOT NULL CHECK (num_questions BETWEEN 3 AND 10),
  personalised boolean NOT NULL DEFAULT false,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,     -- skills / project lines the student allowed us to use
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','finished')),
  report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_mock_user_idx ON ai_mock_interviews (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_mock_turns (
  interview_id uuid NOT NULL REFERENCES ai_mock_interviews(id) ON DELETE CASCADE,
  idx int NOT NULL,
  question text NOT NULL,
  answer text,
  answer_hash text,
  feedback jsonb,
  score int CHECK (score BETWEEN 0 AND 10),
  asked_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  PRIMARY KEY (interview_id, idx)
);
