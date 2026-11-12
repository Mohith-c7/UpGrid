-- 024: offers (approval workflow, expiry, history) and tenant policy settings.
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS policy jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  drive_id uuid NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending_approval','rejected','issued','accepted','declined','expired','revoked','joined')),
  kind text NOT NULL DEFAULT 'annual' CHECK (kind IN ('annual','stipend_monthly')),
  ctc jsonb NOT NULL,
  total_lpa numeric(12,2) NOT NULL,
  tier text NOT NULL DEFAULT 'regular' CHECK (tier IN ('regular','dream','super_dream')),
  joining_date date NOT NULL,
  location text NOT NULL,
  expires_at timestamptz NOT NULL,
  letter_file_id uuid,
  letter_url text,
  notes text,
  policy_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  override_reason text,
  proposed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  proposed_by_role text,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  rejected_reason text,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  responded_at timestamptz,
  joined_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS offers_open_uq ON offers (application_id) WHERE status IN ('pending_approval','issued','accepted','joined');
CREATE INDEX IF NOT EXISTS offers_drive_idx ON offers (drive_id, status);
CREATE INDEX IF NOT EXISTS offers_user_idx ON offers (user_id, status);
CREATE INDEX IF NOT EXISTS offers_expiry_idx ON offers (expires_at) WHERE status = 'issued';

CREATE TABLE IF NOT EXISTS offer_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  type text NOT NULL,
  from_status text,
  to_status text,
  note text,
  actor_id uuid,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offer_events_offer_idx ON offer_events (offer_id, id);
CREATE OR REPLACE FUNCTION offer_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'offer_events is append-only'; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS offer_events_no_update ON offer_events;
CREATE TRIGGER offer_events_no_update BEFORE UPDATE ON offer_events FOR EACH ROW EXECUTE FUNCTION offer_events_append_only();

-- keep the offer record in step when the application status moves through the existing status machine
-- (student respond, officer status endpoint). Pipeline flows set the offer status first, so they are not touched.
CREATE OR REPLACE FUNCTION pipeline_sync_offer_status() RETURNS trigger AS $$
DECLARE o record;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('offer_accepted','offer_declined','joined') THEN
    FOR o IN SELECT id, status FROM offers WHERE application_id = NEW.id AND status IN ('issued','accepted') LOOP
      IF NEW.status = 'offer_accepted' AND o.status = 'issued' THEN
        UPDATE offers SET status='accepted', responded_at=now(), updated_at=now() WHERE id=o.id;
        INSERT INTO offer_events (tenant_id, offer_id, type, from_status, to_status) SELECT tenant_id, o.id, 'accepted', 'issued', 'accepted' FROM offers WHERE id=o.id;
      ELSIF NEW.status = 'offer_declined' AND o.status = 'issued' THEN
        UPDATE offers SET status='declined', responded_at=now(), updated_at=now() WHERE id=o.id;
        INSERT INTO offer_events (tenant_id, offer_id, type, from_status, to_status) SELECT tenant_id, o.id, 'declined', 'issued', 'declined' FROM offers WHERE id=o.id;
      ELSIF NEW.status = 'joined' AND o.status = 'accepted' THEN
        UPDATE offers SET status='joined', joined_at=now(), updated_at=now() WHERE id=o.id;
        INSERT INTO offer_events (tenant_id, offer_id, type, from_status, to_status) SELECT tenant_id, o.id, 'joined', 'accepted', 'joined' FROM offers WHERE id=o.id;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS applications_sync_offer ON applications;
CREATE TRIGGER applications_sync_offer AFTER UPDATE OF status ON applications
  FOR EACH ROW EXECUTE FUNCTION pipeline_sync_offer_status();
