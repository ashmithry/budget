-- Budget app cloud storage (Supabase "planner" project). Applied as migrations budget_sync_v1 + budget_split_tokens_v2.
-- The server never sees your budget: budget_vault.cipher is AES-GCM encrypted on the device.
-- Two tokens, both derived on the device from the sync key:
--   sync token (budget_vault.id = its hash): download, upload, delete. Never leaves the app.
--   link token (budget_vault.link_id = its hash): goes in Shortcut/widget links. Can only log spending and read the widget numbers.
-- It only sees a hash of your token, the encrypted blob, the small widget snapshot, and inbox items
-- (spending posted by an iOS Shortcut / Android automation, waiting for the app to pick them up).

create table if not exists public.budget_vault (
  id text primary key,              -- sha256 of the device token
  cipher text,
  rev bigint not null default 0,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.budget_vault enable row level security; -- no policies: only the functions below touch it

create table if not exists public.budget_inbox (
  seq bigserial primary key,
  vault_id text not null references public.budget_vault(id) on delete cascade,
  item jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists budget_inbox_vault_idx on public.budget_inbox (vault_id, seq);
alter table public.budget_inbox enable row level security;

create or replace function public.budget_vid(p_token text)
returns text language plpgsql immutable set search_path to 'public' as $$
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32,64}$' then raise exception 'bad token'; end if;
  return encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
end;
$$;
revoke all on function public.budget_vid(text) from public, anon, authenticated;

-- Download: the encrypted copy (only when it changed) plus anything waiting in the inbox.
create or replace function public.budget_pull(p_token text, p_have_rev bigint default -1)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v text := public.budget_vid(p_token);
  r bigint;
  c text;
begin
  select rev, cipher into r, c from public.budget_vault where id = v;
  return jsonb_build_object(
    'rev', coalesce(r, 0),
    'cipher', case when r is not null and r <> p_have_rev then c end,
    'inbox', coalesce((select jsonb_agg(jsonb_build_object('seq', seq, 'item', item, 'at', (extract(epoch from created_at) * 1000)::bigint) order by seq)
                       from public.budget_inbox where vault_id = v), '[]'::jsonb));
end;
$$;

alter table public.budget_vault add column if not exists link_id text;
create unique index if not exists budget_vault_link_idx on public.budget_vault (link_id);

-- Upload: refused if another device saved since this one last synced (the app merges and retries).
-- Also clears inbox items the app has now imported (up to p_ack_seq), in the same step.
create or replace function public.budget_push(p_token text, p_link_token text, p_cipher text, p_base_rev bigint, p_snapshot jsonb default null, p_ack_seq bigint default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v text := public.budget_vid(p_token);
  l text := public.budget_vid(p_link_token);
  r bigint;
  nr bigint;
begin
  if v = l then raise exception 'tokens must differ'; end if;
  if p_cipher is null or p_cipher !~ '^v1[jz]:' then raise exception 'bad data'; end if;
  if octet_length(p_cipher) > 4000000 then raise exception 'too big'; end if;
  if p_snapshot is not null and octet_length(p_snapshot::text) > 20000 then raise exception 'snapshot too big'; end if;
  select rev into r from public.budget_vault where id = v for update;
  if r is null then
    insert into public.budget_vault (id, link_id, cipher, rev, snapshot) values (v, l, p_cipher, 1, p_snapshot);
    nr := 1;
  elsif r <> p_base_rev then
    return jsonb_build_object('ok', false, 'conflict', true, 'rev', r);
  else
    nr := r + 1;
    update public.budget_vault set cipher = p_cipher, rev = nr, link_id = coalesce(link_id, l), snapshot = coalesce(p_snapshot, snapshot), updated_at = now() where id = v;
  end if;
  if p_ack_seq > 0 then delete from public.budget_inbox where vault_id = v and seq <= p_ack_seq; end if;
  return jsonb_build_object('ok', true, 'rev', nr);
end;
$$;

-- Log spending from a Shortcut, Apple Pay automation or widget (link token). Needs an existing cloud copy,
-- so after "delete cloud copy" links stop working. The app imports items next time it opens.
create or replace function public.budget_log(p_token text, p_item jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v text;
  amt numeric;
  n int;
  s bigint;
begin
  select id into v from public.budget_vault where link_id = public.budget_vid(p_token);
  if v is null then raise exception 'no budget for this link: turn on sync in the app and copy the link again'; end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object' or octet_length(p_item::text) > 2000 then raise exception 'bad item'; end if;
  begin
    amt := (p_item->>'amount')::numeric;
  exception when others then raise exception 'bad amount';
  end;
  if amt is null or amt = 0 or abs(amt) > 100000 then raise exception 'bad amount'; end if;
  select count(*) into n from public.budget_inbox where vault_id = v;
  if n >= 500 then raise exception 'inbox full: open the app to import'; end if;
  insert into public.budget_inbox (vault_id, item) values (v, p_item) returning seq into s;
  return jsonb_build_object('ok', true, 'seq', s);
end;
$$;

-- Widget data (link token): the last snapshot from the app plus inbox items logged since.
create or replace function public.budget_widget(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v text;
begin
  select id into v from public.budget_vault where link_id = public.budget_vid(p_token);
  return jsonb_build_object(
    'snapshot', (select snapshot from public.budget_vault where id = v),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('amount', item->'amount', 'kind', item->'kind', 'refund', item->'refund', 'at', coalesce((item->>'at')::bigint, (extract(epoch from created_at) * 1000)::bigint)) order by seq)
                         from public.budget_inbox where vault_id = v), '[]'::jsonb));
end;
$$;

-- "Delete my cloud copy" in Settings.
create or replace function public.budget_forget(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  delete from public.budget_vault where id = public.budget_vid(p_token);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.budget_pull(text, bigint) from public;
revoke all on function public.budget_push(text, text, text, bigint, jsonb, bigint) from public;
revoke all on function public.budget_log(text, jsonb) from public;
revoke all on function public.budget_widget(text) from public;
revoke all on function public.budget_forget(text) from public;
grant execute on function public.budget_pull(text, bigint) to anon;
grant execute on function public.budget_push(text, text, text, bigint, jsonb, bigint) to anon;
grant execute on function public.budget_log(text, jsonb) to anon;
grant execute on function public.budget_widget(text) to anon;
grant execute on function public.budget_forget(text) to anon;
