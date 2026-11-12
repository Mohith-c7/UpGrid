-- 033: recruiter/officer drafts. Everything starts as a draft and needs a human decision.
CREATE TABLE IF NOT EXISTS ai_question_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  drive_id uuid REFERENCES drives(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_type text NOT NULL,
  difficulty text NOT NULL,
  focus jsonb NOT NULL DEFAULT '[]'::jsonb,
  grounded_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  questions jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','discarded')),
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  scorecard_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_question_sets_app_idx ON ai_question_sets (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_question_sets_creator_idx ON ai_question_sets (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_question_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  stem text NOT NULL,
  options jsonb NOT NULL,
  correct_index int NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  explanation text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','imported','discarded')),
  imported_question_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_question_drafts_idx ON ai_question_drafts (tenant_id, created_by, status, created_at DESC);
