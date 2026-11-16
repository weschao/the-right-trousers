begin;

create table public.trt_libraries (
 id uuid primary key default gen_random_uuid(), name text not null,
 revision bigint not null default 0, updated_at timestamptz not null default now()
);
create table public.trt_admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.trt_memberships (
 id uuid primary key default gen_random_uuid(), library_id uuid not null references public.trt_libraries(id),
 user_id uuid not null references auth.users(id) on delete cascade, team_id text,
 role text not null check (role in ('player','stats','leadership'))
);
create unique index trt_membership_scope on public.trt_memberships (library_id,user_id,coalesce(team_id,''));
create table public.trt_entities (
 library_id uuid not null references public.trt_libraries(id), kind text not null check (kind in ('team','game','source','settings')),
 id text not null, team_id text, payload jsonb not null, revision bigint not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id), deleted boolean not null default false,
 primary key (library_id,kind,id), check (length(id) between 1 and 200)
);
create index trt_entities_team on public.trt_entities(library_id,team_id);
create table public.trt_audit (
 id bigint generated always as identity primary key, library_id uuid not null references public.trt_libraries(id),
 user_id uuid not null references auth.users(id), happened_at timestamptz not null default now(), changes jsonb not null
);
-- All data is accessed through the authenticated Edge Function. A public key alone grants nothing.
alter table public.trt_libraries enable row level security;
alter table public.trt_admins enable row level security;
alter table public.trt_memberships enable row level security;
alter table public.trt_entities enable row level security;
alter table public.trt_audit enable row level security;
revoke all on public.trt_libraries,public.trt_admins,public.trt_memberships,public.trt_entities,public.trt_audit from public,anon,authenticated;
grant all on public.trt_libraries,public.trt_admins,public.trt_memberships,public.trt_entities,public.trt_audit to service_role;
grant usage,select on sequence public.trt_audit_id_seq to service_role;

create function public.trt_permits(p_user uuid,p_library uuid,p_permission text,p_team text default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.trt_admins where user_id=p_user)
 or exists(select 1 from public.trt_memberships m where m.user_id=p_user and m.library_id=p_library
 and (m.team_id is null or m.team_id=p_team) and (
   (m.role in ('player','stats','leadership') and p_permission='players.read') or
   (m.role in ('stats','leadership') and p_permission in ('games.read','games.create','games.update')) or
   (m.role='leadership' and p_permission in ('games.delete','teams.update','library.read','library.export','settings.update'))
 ));
$$;
revoke all on function public.trt_permits(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.trt_permits(uuid,uuid,text,text) to service_role;

create function public.trt_snapshot(p_library uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',l.revision,'entities',coalesce((select jsonb_agg(to_jsonb(e) order by e.kind,e.id) from public.trt_entities e where e.library_id=l.id),'[]'::jsonb))
 from public.trt_libraries l where l.id=p_library;
$$;
revoke all on function public.trt_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.trt_snapshot(uuid) to service_role;

-- Version checks and all changes in one transaction. Tombstones prevent stale devices recreating deletions.
create function public.trt_apply_changes(p_user uuid,p_library uuid,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; old public.trt_entities; new_team text; permission text; result jsonb='[]'::jsonb; next_revision bigint;
begin
 if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>2000 then raise exception 'Invalid changes'; end if;
 -- Serialize only the save transaction; per-entity revisions still allow independent games to be edited.
 perform 1 from public.trt_libraries where id=p_library for update;
 if not found then raise exception 'Library unavailable' using errcode='42501'; end if;
 for c in select value from jsonb_array_elements(p_changes) loop
  if c->>'kind' not in ('team','game','source','settings') or nullif(c->>'id','') is null then raise exception 'Invalid entity'; end if;
  select * into old from public.trt_entities where library_id=p_library and kind=c->>'kind' and id=c->>'id';
  if coalesce(old.revision,0)<>coalesce((c->>'revision')::bigint,-1) then raise exception 'Another user changed this record. Reload before saving.' using errcode='40001'; end if;
  new_team=case when c->>'kind'='team' then c->>'id' when c->>'kind'='game' then c->'payload'->>'teamId' else null end;
  if old.id is not null and c->>'kind'='game' and new_team is distinct from old.team_id and not coalesce((c->>'deleted')::boolean,false) then raise exception 'Cannot move a game between teams' using errcode='42501'; end if;
  if coalesce((c->>'deleted')::boolean,false) then new_team=old.team_id; end if;
  permission=case when c->>'kind'='game' then case when coalesce((c->>'deleted')::boolean,false) then 'games.delete' when old.id is null then 'games.create' else 'games.update' end when c->>'kind'='team' then 'teams.update' when c->>'kind'='settings' then 'settings.update' else 'library.read' end;
  if not (public.trt_permits(p_user,p_library,permission,new_team) or (c->>'kind'='game' and old.id is not null and public.trt_permits(p_user,p_library,permission,old.payload->>'opponentTeamId'))) then raise exception 'Permission denied' using errcode='42501'; end if;
  if coalesce((c->>'deleted')::boolean,false) and old.id is null then raise exception 'Missing record'; end if;
  if not coalesce((c->>'deleted')::boolean,false) and (jsonb_typeof(c->'payload')<>'object' or (c->>'kind'<>'settings' and c->'payload'->>'id' is distinct from c->>'id')) then raise exception 'Invalid payload'; end if;
  next_revision=coalesce(old.revision,0)+1;
  insert into public.trt_entities(library_id,kind,id,team_id,payload,revision,updated_by,deleted)
   values(p_library,c->>'kind',c->>'id',new_team,coalesce(c->'payload',old.payload),next_revision,p_user,coalesce((c->>'deleted')::boolean,false))
   on conflict(library_id,kind,id) do update set team_id=excluded.team_id,payload=excluded.payload,revision=excluded.revision,updated_at=now(),updated_by=p_user,deleted=excluded.deleted;
  result=result||jsonb_build_array(jsonb_build_object('kind',c->>'kind','id',c->>'id','revision',next_revision));
 end loop;
 update public.trt_libraries set revision=revision+1,updated_at=now() where id=p_library;
 insert into public.trt_audit(library_id,user_id,changes) values(p_library,p_user,p_changes);
 return result;
end;
$$;
revoke all on function public.trt_apply_changes(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trt_apply_changes(uuid,uuid,jsonb) to service_role;

create function public.trt_set_membership(p_actor uuid,p_library uuid,p_user uuid,p_team text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.trt_admins where user_id=p_actor) then raise exception 'Admin required' using errcode='42501'; end if;
 if p_team is not null and not exists(select 1 from public.trt_entities where library_id=p_library and kind='team' and id=p_team and not deleted) then raise exception 'Team unavailable'; end if;
 if p_role is not null and p_role not in ('player','stats','leadership') then raise exception 'Invalid role'; end if;
 delete from public.trt_memberships where library_id=p_library and user_id=p_user and team_id is not distinct from p_team;
 if p_role is not null then insert into public.trt_memberships(library_id,user_id,team_id,role) values(p_library,p_user,p_team,p_role); end if;
 update public.trt_libraries set revision=revision+1,updated_at=now() where id=p_library;
 insert into public.trt_audit(library_id,user_id,changes) values(p_library,p_actor,jsonb_build_array(jsonb_build_object('action','membership','userId',p_user,'teamId',p_team,'role',p_role)));
end;
$$;
revoke all on function public.trt_set_membership(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.trt_set_membership(uuid,uuid,uuid,text,text) to service_role;

insert into public.trt_libraries(name) values('The Right Trousers');
commit;
