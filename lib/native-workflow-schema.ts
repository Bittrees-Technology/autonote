import type { Client } from "pg";
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

// Compare persisted trigger bodies to the exact reviewed migration, not just
// column names. This is a read-only check under the existing application role.
const expectedBodies = new Map(
  [
    ...nativeWorkflowSchema.matchAll(
      /CREATE OR REPLACE FUNCTION %I\.(autonote_(?:identity|membership)_generation)\(\)[\s\S]*?AS \$body\$([\s\S]*?)\$body\$/g,
    ),
  ].map((match) => [match[1], match[2]]),
);
export async function nativeWorkflowSchemaReady(db: Pick<Client, "query">) {
  const columns = await db.query(
    "SELECT c.relname,a.attnotnull,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=current_schema() AND c.relname IN ('members','identities') AND c.relkind='r' AND a.attname='authority_generation' AND NOT a.attisdropped",
  );
  const triggers = await db.query(
    "SELECT c.relname,t.tgname,t.tgenabled,t.tgtype,t.tgnargs,t.tgattr::text AS attributes,t.tgqual IS NULL AS unconditional,p.proname,p.prosrc,p.prosecdef,p.proconfig,l.lanname,np.nspname=n.nspname AS same_schema FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace np ON np.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND c.relname IN ('members','identities') AND t.tgname IN ('autonote_membership_generation','autonote_identity_generation') AND NOT t.tgisinternal",
  );
  return (
    expectedBodies.size === 2 &&
    columns.rows.length === 2 &&
    new Set(columns.rows.map((c) => c.relname)).size === 2 &&
    columns.rows.every(
      (c) =>
        c.attnotnull &&
        c.type === "uuid" &&
        /^(pg_catalog\.)?gen_random_uuid\(\)$/.test(c.default_expr || ""),
    ) &&
    triggers.rows.length === 2 &&
    new Set(triggers.rows.map((t) => t.tgname)).size === 2 &&
    triggers.rows.every(
      (t) =>
        t.tgname ===
          (t.relname === "members"
            ? "autonote_membership_generation"
            : "autonote_identity_generation") &&
        t.tgname === t.proname &&
        t.tgenabled === "O" &&
        t.tgtype === 23 &&
        t.tgnargs === 0 &&
        t.attributes === "" &&
        t.unconditional &&
        t.same_schema &&
        t.lanname === "plpgsql" &&
        !t.prosecdef &&
        JSON.stringify(t.proconfig) ===
          JSON.stringify(["search_path=pg_catalog"]) &&
        t.prosrc === expectedBodies.get(t.proname),
    )
  );
}
