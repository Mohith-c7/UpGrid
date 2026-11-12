-- 010: assessments module - question bank.
CREATE TABLE IF NOT EXISTS aq_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL CHECK (type IN ('mcq_single','mcq_multi','numeric','short_text','coding')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  difficulty text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  marks numeric(7,2) NOT NULL CHECK (marks > 0),
  negative_marks numeric(7,2) NOT NULL DEFAULT 0 CHECK (negative_marks >= 0),
  explanation text NOT NULL DEFAULT '',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer jsonb NOT NULL DEFAULT '{}'::jsonb,
  coding jsonb,
  practice boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aq_questions_tenant_idx ON aq_questions (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS aq_questions_tags_idx ON aq_questions USING gin (tags);
CREATE INDEX IF NOT EXISTS aq_questions_practice_idx ON aq_questions (tenant_id) WHERE practice AND status = 'active';
