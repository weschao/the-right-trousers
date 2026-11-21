begin;

create or replace function public.trt_apply_changes(p_user uuid,p_library uuid,p_changes jsonb)
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
 -- who changed which records and when; the payloads already live in trt_entities, and copying them here
 -- doubled the WAL of every save
 insert into public.trt_audit(library_id,user_id,changes) values(p_library,p_user,(select coalesce(jsonb_agg(change-'payload' order by position),'[]'::jsonb) from jsonb_array_elements(p_changes) with ordinality as item(change,position)));
 return result;
end;
$$;
revoke all on function public.trt_apply_changes(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.trt_apply_changes(uuid,uuid,jsonb) to service_role;

commit;
