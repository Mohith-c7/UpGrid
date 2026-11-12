-- 011: assessments, sections, snapshotted questions, materialised audience, start reminders.
CREATE TABLE IF NOT EXISTS assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  title text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  drive_id uuid REFERENCES drives(id) ON DELETE SET NULL,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  opens_at timestamptz,
  closes_at timestamptz,
  duration_minutes int CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 600),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_practice boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  total_marks numeric(9,2) NOT NULL DEFAULT 0,
  question_count int NOT NULL DEFAULT 0,
  results_published_at timestamptz,
  published_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessments_tenant_idx ON assessments (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS assessments_drive_idx ON assessments (drive_id);

CREATE TABLE IF NOT EXISTS assessment_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  title text NOT NULL,
  ord int NOT NULL,
  time_limit_minutes int CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 600),
  cutoff_marks numeric(9,2)
);
CREATE INDEX IF NOT EXISTS assessment_sections_a_idx ON assessment_sections (assessment_id, ord);

CREATE TABLE IF NOT EXISTS assessment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES assessment_sections(id) ON DELETE CASCADE,
  question_id uuid REFERENCES aq_questions(id) ON DELETE SET NULL,
  ord int NOT NULL,
  marks numeric(7,2) NOT NULL CHECK (marks > 0),
  negative_marks numeric(7,2) NOT NULL DEFAULT 0 CHECK (negative_marks >= 0),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS assessment_questions_a_idx ON assessment_questions (assessment_id, section_id, ord);
CREATE INDEX IF NOT EXISTS assessment_questions_q_idx ON assessment_questions (question_id);

CREATE TABLE IF NOT EXISTS assessment_audience (
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, user_id)
);
CREATE INDEX IF NOT EXISTS assessment_audience_user_idx ON assessment_audience (user_id);

CREATE TABLE IF NOT EXISTS assessment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('t60','t15')),
  fire_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled','skipped')),
  processed_at timestamptz,
  UNIQUE (assessment_id, user_id, kind)
);
CREATE INDEX IF NOT EXISTS assessment_reminders_due_idx ON assessment_reminders (fire_at) WHERE status = 'pending';
