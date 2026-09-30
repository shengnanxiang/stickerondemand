-- SOD Phase 0 演示 schema：Supabase Dashboard → SQL Editor → 整段执行
-- anon 只读（Realtime 需要），写操作全部走 SECURITY DEFINER RPC（发号/核验规则不可绕过）

create table if not exists demo_sessions (
  id text primary key, name text not null, ch text not null, started_at timestamptz default now()
);

create table if not exists demo_counters (
  k text primary key, v int not null default 0
);

create table if not exists demo_customers (
  id bigint generated always as identity primary key,
  nickname text, ch text, created_at timestamptz default now()
);

create table if not exists demo_devices (
  id text primary key, name text not null, done int not null default 0
);
insert into demo_devices (id, name) values
  ('S1-01', 'Liene S1 · 01 号机'), ('S1-02', 'Liene S1 · 02 号机'), ('S1-03', 'Liene S1 · 03 号机')
on conflict (id) do nothing;

create table if not exists demo_orders (
  id text primary key,
  queue_no text not null,
  code text not null,
  design_id text, design_name text, thumb text,
  copies int not null default 1,
  nickname text, ch text,
  status text not null default 'pending',  -- pending/accepted/printing/ready/picked
  device text,
  created_at timestamptz default now(),
  accepted_at timestamptz, printing_at timestamptz, ready_at timestamptz, picked_at timestamptz
);
create index if not exists idx_orders_created on demo_orders (created_at desc);

-- ---------- Realtime ----------
alter publication supabase_realtime add table demo_sessions, demo_counters, demo_customers, demo_orders, demo_devices;

-- ---------- RLS ----------
alter table demo_sessions  enable row level security;
alter table demo_counters  enable row level security;
alter table demo_customers enable row level security;
alter table demo_devices   enable row level security;
alter table demo_orders    enable row level security;

create policy "read" on demo_sessions  for select using (true);
create policy "read" on demo_counters  for select using (true);
create policy "read" on demo_customers for select using (true);
create policy "read" on demo_devices   for select using (true);
create policy "read" on demo_orders    for select using (true);

-- ---------- 业务 RPC ----------
create or replace function demo_start_session(p_name text)
returns demo_sessions language plpgsql security definer as $$
declare s demo_sessions;
begin
  delete from demo_orders; delete from demo_customers;
  update demo_devices set done = 0;
  update demo_counters set v = 0 where k in ('queue', 'order');
  delete from demo_sessions;
  insert into demo_sessions (id, name, ch)
  values ('current', coalesce(nullif(trim(p_name), ''), '漫展快闪 · 首场实测'),
          'booth-' || to_char(now(), 'YYYYMMDD') || '-' || substr(md5(random()::text), 1, 4))
  returning * into s;
  return s;
end $$;

create or replace function demo_acquire_customer(p_nickname text, p_ch text)
returns int language plpgsql security definer as $$
declare n int;
begin
  insert into demo_customers (nickname, ch) values (p_nickname, p_ch);
  select count(*) into n from demo_customers;
  return n;
end $$;

create or replace function demo_create_order(p_design_id text, p_design_name text, p_thumb text,
                                             p_copies int, p_nickname text, p_ch text)
returns demo_orders language plpgsql security definer as $$
declare o demo_orders; q int; seq int;
begin
  insert into demo_counters (k, v) values ('queue', 0) on conflict (k) do nothing;
  insert into demo_counters (k, v) values ('order', 0) on conflict (k) do nothing;
  update demo_counters set v = v + 1 where k = 'queue'   returning v into q;
  update demo_counters set v = v + 1 where k = 'order'   returning v into seq;
  insert into demo_orders (id, queue_no, code, design_id, design_name, thumb, copies, nickname, ch)
  values ('SO' || to_char(now(), 'YYMMDDHH24MS') || lpad(seq::text, 3, '0'),
          'Q' || lpad(q::text, 2, '0'),
          lpad((floor(random() * 10000))::int::text, 4, '0'),
          p_design_id, p_design_name, p_thumb,
          greatest(1, least(9, coalesce(p_copies, 1))),
          coalesce(nullif(trim(p_nickname), ''), '微信用户'), coalesce(p_ch, ''))
  returning * into o;
  return o;
end $$;

create or replace function demo_accept_order(p_id text)
returns demo_orders language plpgsql security definer as $$
declare o demo_orders;
begin
  update demo_orders set status = 'accepted', accepted_at = now()
  where id = p_id and status = 'pending' returning * into o;
  if o is null then select * into o from demo_orders where id = p_id; end if;
  return o;
end $$;

-- 派单 + 设备仿真：为打印推进预留时长（每份 8-14 秒随机），到期幂等推进
create or replace function demo_assign_order(p_id text, p_device text)
returns demo_orders language plpgsql security definer as $$
declare o demo_orders; eta timestamptz; dur int;
begin
  update demo_orders set status = 'printing', device = p_device, printing_at = now()
  where id = p_id and status = 'accepted' returning * into o;
  if o is null then select * into o from demo_orders where id = p_id; return o; end if;
  dur := (8 + floor(random() * 7))::int * greatest(1, o.copies);      -- 秒
  eta := now() + (dur || ' seconds')::interval;
  update demo_orders set ready_at = eta where id = p_id;
  o.ready_at := eta;
  return o;
end $$;

-- 浏览器泵循环调用：到期单转 ready（幂等，多端同调安全）
create or replace function demo_pump()
returns int language plpgsql security definer as $$
declare n int;
begin
  update demo_orders o set status = 'ready'
  where o.status = 'printing' and o.ready_at is not null and o.ready_at <= now()
    and not exists (select 1 from demo_orders x where x.device = o.device and x.status = 'printing'
                    and x.ready_at is not null and x.ready_at < o.ready_at);
  get diagnostics n = row_count;
  update demo_devices d set done = c.n from (
    select device, count(*) n from demo_orders
    where status in ('ready', 'picked') group by device
  ) c where d.id = c.device and d.done < c.n;
  return n;
end $$;

create or replace function demo_pickup_order(p_id text, p_code text)
returns text language plpgsql security definer as $$
declare o demo_orders;
begin
  select * into o from demo_orders where id = p_id for update;
  if o is null then return '订单不存在'; end if;
  if o.status <> 'ready' then return '订单不在可取货状态'; end if;
  if o.code <> coalesce(p_code, o.code) then return '取件码不正确'; end if;
  update demo_orders set status = 'picked', picked_at = now() where id = p_id;
  return 'ok';
end $$;

create or replace function demo_reset()
returns void language plpgsql security definer as $$
begin
  delete from demo_orders; delete from demo_customers;
  update demo_devices set done = 0;
  update demo_counters set v = 0 where k in ('queue', 'order');
  delete from demo_sessions;
end $$;

grant execute on function demo_start_session(text), demo_acquire_customer(text, text),
  demo_create_order(text, text, text, int, text, text), demo_accept_order(text),
  demo_assign_order(text, text), demo_pump(), demo_pickup_order(text, text),
  demo_reset() to anon, authenticated;
