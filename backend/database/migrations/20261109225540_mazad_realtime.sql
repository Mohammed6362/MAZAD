BEGIN;

-- قناة خاصة للخادم. الرسالة إشارة فقط، وقراءة البيانات تتم عبر صلاحيات API الحالية.
CREATE OR REPLACE FUNCTION fn_broadcast_market_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send('{}'::jsonb, 'refresh', 'mazad:market', true);
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  app_schema text := current_schema();
  table_name text;
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    FOREACH table_name IN ARRAY ARRAY['cars', 'auctions'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS trg_market_realtime ON %I.%I', app_schema, table_name);
      EXECUTE format(
        'CREATE TRIGGER trg_market_realtime AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION %I.fn_broadcast_market_update()',
        app_schema, table_name, app_schema
      );
    END LOOP;
  END IF;
END;
$$;

DO $$
DECLARE
  object record;
BEGIN
  IF current_schema() = 'mazad' THEN
    FOR object IN SELECT tablename FROM pg_tables WHERE schemaname='mazad' LOOP
      EXECUTE format('ALTER TABLE mazad.%I ENABLE ROW LEVEL SECURITY', object.tablename);
    END LOOP;
    FOR object IN
      SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='mazad' AND p.proname<>'fn_broadcast_market_update'
    LOOP
      EXECUTE format('ALTER FUNCTION mazad.%I(%s) SET search_path=mazad,pg_catalog',object.proname,object.args);
    END LOOP;
    REVOKE ALL ON SCHEMA mazad FROM PUBLIC,anon,authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA mazad FROM PUBLIC,anon,authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA mazad FROM PUBLIC,anon,authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mazad FROM PUBLIC,anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA mazad REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mazad_server') THEN
      GRANT USAGE ON SCHEMA mazad TO mazad_server;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA mazad TO mazad_server;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA mazad TO mazad_server;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mazad TO mazad_server;
      FOR object IN SELECT tablename FROM pg_tables WHERE schemaname='mazad' LOOP
        EXECUTE format('DROP POLICY IF EXISTS mazad_server_access ON mazad.%I',object.tablename);
        EXECUTE format('CREATE POLICY mazad_server_access ON mazad.%I TO mazad_server USING (true) WITH CHECK (true)',object.tablename);
      END LOOP;
      GRANT USAGE ON SCHEMA realtime TO mazad_server;
      GRANT EXECUTE ON FUNCTION realtime.send(jsonb,text,text,boolean) TO mazad_server;
      GRANT INSERT ON realtime.messages TO mazad_server;
      DROP POLICY IF EXISTS mazad_server_broadcast ON realtime.messages;
      CREATE POLICY mazad_server_broadcast ON realtime.messages FOR INSERT TO mazad_server
        WITH CHECK (topic='mazad:market' AND extension='broadcast' AND private=true);
    END IF;
  END IF;
END;
$$;

COMMIT;
