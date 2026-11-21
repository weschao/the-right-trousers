begin;

-- seconds each signed-in user has spent on the site (total) and with a playing
-- enhanced pitch tracker open (viewing); written only through the API
create table public.trt_usage (
 library_id uuid not null references public.trt_libraries(id),
 user_id uuid not null,
 total_seconds bigint not null default 0 check (total_seconds>=0),
 viewing_seconds bigint not null default 0 check (viewing_seconds>=0),
 primary key (library_id,user_id)
);
alter table public.trt_usage enable row level security;
revoke all on public.trt_usage from public,anon,authenticated;
grant all on public.trt_usage to service_role;

create function public.trt_add_usage(p_user uuid,p_library uuid,p_total integer,p_viewing integer) returns void
language sql security definer set search_path='' as $$
 insert into public.trt_usage(library_id,user_id,total_seconds,viewing_seconds) values(p_library,p_user,greatest(p_total,0),greatest(least(p_viewing,p_total),0))
 on conflict(library_id,user_id) do update set total_seconds=public.trt_usage.total_seconds+excluded.total_seconds,viewing_seconds=public.trt_usage.viewing_seconds+excluded.viewing_seconds;
$$;
revoke all on function public.trt_add_usage(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.trt_add_usage(uuid,uuid,integer,integer) to service_role;

notify pgrst, 'reload schema';

commit;
