begin;

-- Grants can be recorded before an Auth account exists. Only a verified email
-- can claim them; browser roles cannot read or write pending grants directly.
create table public.trt_email_memberships (
 id uuid primary key default gen_random_uuid(),
 library_id uuid not null references public.trt_libraries(id),
 email text not null check (email=lower(btrim(email)) and length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
 team_id text, role text not null check (role in ('player','stats','leadership'))
);
create unique index trt_email_membership_scope on public.trt_email_memberships (library_id,email,coalesce(team_id,''));
alter table public.trt_email_memberships enable row level security;
revoke all on public.trt_email_memberships from public,anon,authenticated;
grant all on public.trt_email_memberships to service_role;

create function public.trt_set_email_membership(p_actor uuid,p_library uuid,p_email text,p_team text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare target_user uuid; verified boolean; normalized_email text=lower(btrim(p_email));
begin
 if not exists(select 1 from public.trt_admins where user_id=p_actor) then raise exception 'Admin required' using errcode='42501'; end if;
 if normalized_email is null or length(normalized_email)>254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then raise exception 'Enter a valid email address' using errcode='22023'; end if;
 if p_team is not null and not exists(select 1 from public.trt_entities where library_id=p_library and kind='team' and id=p_team and not deleted) then raise exception 'Team unavailable' using errcode='22023'; end if;
 if p_role is not null and p_role not in ('player','stats','leadership') then raise exception 'Invalid role' using errcode='22023'; end if;
 -- Serialize granting and claiming the same email so a concurrent first sign-in
 -- cannot miss a grant made while its Auth account is being created.
 perform pg_advisory_xact_lock(hashtextextended(normalized_email,0));
 select id,email_confirmed_at is not null into target_user,verified from auth.users where lower(btrim(email))=normalized_email;
 delete from public.trt_email_memberships where library_id=p_library and email=normalized_email and team_id is not distinct from p_team;
 if verified then
  perform public.trt_set_membership(p_actor,p_library,target_user,p_team,p_role);
 else
  -- Replace any legacy grant attached to an unverified account with a pending
  -- email grant, including when removing access through the new email form.
  delete from public.trt_memberships where library_id=p_library and user_id=target_user and team_id is not distinct from p_team;
  if p_role is not null then insert into public.trt_email_memberships(library_id,email,team_id,role) values(p_library,normalized_email,p_team,p_role); end if;
  update public.trt_libraries set revision=revision+1,updated_at=now() where id=p_library;
  insert into public.trt_audit(library_id,user_id,changes) values(p_library,p_actor,jsonb_build_array(jsonb_build_object('action','membership','email',normalized_email,'teamId',p_team,'role',p_role)));
 end if;
end;
$$;
revoke all on function public.trt_set_email_membership(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.trt_set_email_membership(uuid,uuid,text,text,text) to service_role;

create function public.trt_claim_email_memberships() returns trigger
language plpgsql security definer set search_path='' as $$
declare grant_row public.trt_email_memberships; normalized_email text=lower(btrim(new.email));
begin
 if new.email_confirmed_at is null or normalized_email is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(normalized_email,0));
 for grant_row in delete from public.trt_email_memberships where email=normalized_email returning * loop
  insert into public.trt_memberships(library_id,user_id,team_id,role) values(grant_row.library_id,new.id,grant_row.team_id,grant_row.role)
   on conflict(library_id,user_id,(coalesce(team_id,''))) do update set role=excluded.role;
  update public.trt_libraries set revision=revision+1,updated_at=now() where id=grant_row.library_id;
  insert into public.trt_audit(library_id,user_id,changes) values(grant_row.library_id,new.id,jsonb_build_array(jsonb_build_object('action','claim_membership','email',normalized_email,'teamId',grant_row.team_id,'role',grant_row.role)));
 end loop;
 return new;
end;
$$;
revoke all on function public.trt_claim_email_memberships() from public,anon,authenticated;
create trigger trt_email_memberships after insert or update of email,email_confirmed_at on auth.users
for each row execute function public.trt_claim_email_memberships();

commit;
