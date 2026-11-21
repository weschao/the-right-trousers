begin;

-- remove the payload copies that audit rows held before 202611200002. Every record's current payload stays in
-- trt_entities (a deleted record keeps its last payload on its tombstone); only older versions are lost.
-- The freed space returns to the disk only after running `vacuum full public.trt_audit;` by hand, since vacuum
-- cannot run inside a migration's transaction.
update public.trt_audit set changes=(select jsonb_agg(change-'payload' order by position) from jsonb_array_elements(changes) with ordinality as item(change,position))
 where jsonb_typeof(changes)='array' and jsonb_path_exists(changes,'$[*].payload');

commit;
