-- 023: interview panels and slot booking. Double booking is prevented by exclusion constraints
-- (panelists and candidates) plus a row lock on the slot for capacity.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS interview_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES drive_rounds(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('online','in_person')),
  venue_or_link text NOT NULL,
  instructions text,
  capacity int NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 50),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('proposed','open','cancelled','declined')),
  proposed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS interview_slots_drive_idx ON interview_slots (drive_id, round_id, starts_at);

CREATE TABLE IF NOT EXISTS slot_panelists (
  slot_id uuid NOT NULL REFERENCES interview_slots(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT false,
  reminded_at timestamptz,
  PRIMARY KEY (slot_id, user_id),
  CONSTRAINT slot_panelists_no_overlap EXCLUDE USING gist (user_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (active)
);

CREATE TABLE IF NOT EXISTS slot_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  slot_id uuid NOT NULL REFERENCES interview_slots(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES drive_rounds(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
  cancel_reason text,
  cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  booked_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT slot_bookings_candidate_no_overlap EXCLUDE USING gist (user_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'booked')
);
CREATE UNIQUE INDEX IF NOT EXISTS slot_bookings_app_round_uq ON slot_bookings (application_id, round_id) WHERE status = 'booked';
CREATE UNIQUE INDEX IF NOT EXISTS slot_bookings_slot_app_uq ON slot_bookings (slot_id, application_id) WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS slot_bookings_slot_idx ON slot_bookings (slot_id) WHERE status = 'booked';

-- link the live schedule created by a booking so cancel/reschedule can supersede exactly that row
ALTER TABLE application_schedules ADD COLUMN IF NOT EXISTS slot_booking_id uuid REFERENCES slot_bookings(id) ON DELETE SET NULL;
