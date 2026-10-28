// Additive and repeatable. Database-managed epochs cover every native mutation
// path, including invitations, account recovery and direct membership updates.
export const nativeWorkflowSchema = `
ALTER TABLE members ADD COLUMN IF NOT EXISTS authority_generation uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid();
ALTER TABLE identities ADD COLUMN IF NOT EXISTS authority_generation uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid();
DO $migration$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION %I.autonote_identity_generation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        NEW.authority_generation := pg_catalog.gen_random_uuid();
      ELSIF ROW(NEW.kind, NEW.value, NEW.user_id, NEW.verified_at) IS DISTINCT FROM ROW(OLD.kind, OLD.value, OLD.user_id, OLD.verified_at) THEN
        NEW.authority_generation := pg_catalog.gen_random_uuid();
      ELSE
        NEW.authority_generation := OLD.authority_generation;
      END IF;
      RETURN NEW;
    END;
    $body$;
  $definition$, target_schema);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'identities'::regclass AND tgname = 'autonote_identity_generation' AND NOT tgisinternal) THEN
    EXECUTE format('CREATE TRIGGER autonote_identity_generation BEFORE INSERT OR UPDATE ON %I.identities FOR EACH ROW EXECUTE FUNCTION %I.autonote_identity_generation()', target_schema, target_schema);
  END IF;
  EXECUTE format($definition$
    CREATE OR REPLACE FUNCTION %I.autonote_membership_generation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        NEW.authority_generation := pg_catalog.gen_random_uuid();
      ELSIF ROW(NEW.workspace_id, NEW.user_id, NEW.role) IS DISTINCT FROM ROW(OLD.workspace_id, OLD.user_id, OLD.role) THEN
        NEW.authority_generation := pg_catalog.gen_random_uuid();
      ELSE
        NEW.authority_generation := OLD.authority_generation;
      END IF;
      RETURN NEW;
    END;
    $body$;
  $definition$, target_schema);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'members'::regclass AND tgname = 'autonote_membership_generation' AND NOT tgisinternal) THEN
    EXECUTE format('CREATE TRIGGER autonote_membership_generation BEFORE INSERT OR UPDATE ON %I.members FOR EACH ROW EXECUTE FUNCTION %I.autonote_membership_generation()', target_schema, target_schema);
  END IF;
END;
$migration$;
`;
