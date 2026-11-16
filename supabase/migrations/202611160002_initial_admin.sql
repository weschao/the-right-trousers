begin;
-- Designate this verified email as the initial global administrator. This does not
-- create an Auth account or send email; the owner signs in through the app.
create table public.trt_admin_designations (email text primary key);
alter table public.trt_admin_designations enable row level security;
revoke all on public.trt_admin_designations from public,anon,authenticated;
grant all on public.trt_admin_designations to service_role;
insert into public.trt_admin_designations(email) values('weschao@gmail.com');
create function public.trt_claim_designated_admin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null and exists(select 1 from public.trt_admin_designations where email=lower(new.email)) then
  insert into public.trt_admins(user_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end;
$$;
revoke all on function public.trt_claim_designated_admin() from public,anon,authenticated;
create trigger trt_initial_admin after insert or update of email_confirmed_at on auth.users
for each row execute function public.trt_claim_designated_admin();
insert into public.trt_admins(user_id) select id from auth.users where email_confirmed_at is not null and lower(email)='weschao@gmail.com' on conflict do nothing;
commit;
