-- 033_lock_down_record_demo_view.sql
--
-- record_demo_view was created without touching its grants, and Postgres
-- grants EXECUTE on new functions to PUBLIC by default -- so anyone holding
-- the anon key (that is, every visitor's browser) could call it through
-- PostgREST with any viewer key they liked and inflate view counts. The
-- function only has one legitimate caller, the server action running as
-- service role.
--
-- Idempotent.

begin;

revoke execute on function public.record_demo_view(uuid, text) from public;
revoke execute on function public.record_demo_view(uuid, text) from anon;
revoke execute on function public.record_demo_view(uuid, text) from authenticated;
grant execute on function public.record_demo_view(uuid, text) to service_role;

commit;
