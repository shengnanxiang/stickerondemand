-- ============================================================
-- SOD 供应端（商家工作台）· biz_ 前缀业务 schema
-- 依赖：demo/schema.sql 的同一 Supabase 项目（demo_ 表保持不动）
-- 执行：Supabase Dashboard → SQL Editor → 整段执行（幂等，可重复跑）
--
-- 状态机：pending → paid → accepted → making → shipped → done
--         （+ closed 超时关闭 / aftersale 售后中）
-- 金额：一律以「分」为整数存储，展示层再格式化
-- 安全：anon 只读（Realtime 需要），写操作全部走 SECURITY DEFINER RPC
-- ============================================================

-- ---------- 表 ----------
create table if not exists biz_suppliers (
  id text primary key,                      -- 供应商代码，如 SUP-SH01
  name text not null,
  password text not null default '123456',  -- 模拟登录密码（演示）
  region_codes text[] not null default '{}',-- 服务地区编码列表（如 {"上海市"}）
  address text,                             -- 自提地址
  open_hours text default '09:00 - 20:00',
  daily_cap int not null default 50,        -- 接单上限
  stock_mica int not null default 100,      -- 云母纸余量（张）
  stock_silver int not null default 100,    -- 亚银纸余量（张）
  is_default boolean not null default false,-- 未匹配地区时的兜底供应商
  balance int not null default 0,           -- 可提现余额（分）
  created_at timestamptz default now()
);

create table if not exists biz_orders (
  id text primary key,                      -- SO + yyyymmdd + 3位序号
  user_id text,                             -- 用户标识（昵称，演示无账号体系）
  supplier_id text references biz_suppliers(id),
  status text not null default 'pending',
  n int not null,                           -- 总张数
  subtotal int not null,                    -- 商品小计（分）
  shipping int not null default 0,          -- 运费（分，优惠前）
  discount int not null default 0,          -- 券折扣（分）
  amount int not null,                      -- 实付（分）
  coupon_type text,                         -- freeship / general / null
  address jsonb not null,                   -- {name,phone,region,detail}
  note text,
  ship_company text,
  ship_no text,
  paid_at timestamptz, accepted_at timestamptz, made_at timestamptz,
  shipped_at timestamptz, done_at timestamptz, closed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_biz_orders_supplier_status on biz_orders (supplier_id, status);
create index if not exists idx_biz_orders_created on biz_orders (created_at desc);

create table if not exists biz_order_items (
  id bigint generated always as identity primary key,
  order_id text not null references biz_orders(id) on delete cascade,
  name text not null,
  thumb text,                               -- dataURL 快照
  copies int not null default 1
);
create index if not exists idx_biz_items_order on biz_order_items (order_id);

create table if not exists biz_logistics_tracks (
  id bigint generated always as identity primary key,
  order_id text not null references biz_orders(id) on delete cascade,
  d text not null,                          -- 轨迹描述
  created_at timestamptz default now()
);
create index if not exists idx_biz_tracks_order on biz_logistics_tracks (order_id);

create table if not exists biz_aftersales (
  id bigint generated always as identity primary key,
  order_id text not null references biz_orders(id) on delete cascade,
  supplier_id text,
  kind text not null,                       -- redo 重做 / reship 补寄 / refund 退款
  reason text,
  status text not null default 'open',      -- open / done
  result text,                              -- 处理结果说明
  created_at timestamptz default now(),
  done_at timestamptz
);
create index if not exists idx_biz_aftersales_supplier on biz_aftersales (supplier_id, status);

create table if not exists biz_withdrawals (
  id bigint generated always as identity primary key,
  supplier_id text not null,
  amount int not null,                      -- 分
  created_at timestamptz default now()
);
create index if not exists idx_biz_wd_supplier on biz_withdrawals (supplier_id);

create table if not exists biz_counters (
  k text primary key, v int not null default 0
);

-- ---------- 种子：两家演示供应商 ----------
insert into biz_suppliers (id, name, password, region_codes, address, open_hours,
                           daily_cap, stock_mica, stock_silver, is_default, balance)
values
  ('SUP-SH01', '上海徐汇工作室', '123456', '{上海市}', '上海市徐汇区漕溪北路 100 号 1 层', '09:00 - 20:00', 50, 120, 80, true, 0),
  ('SUP-BJ01', '北京朝阳工作室', '123456', '{北京市}', '北京市朝阳区三里屯路 11 号 2 层', '10:00 - 19:00', 40, 90, 60, false, 0)
on conflict (id) do update set
  name = excluded.name, region_codes = excluded.region_codes, address = excluded.address,
  open_hours = excluded.open_hours, daily_cap = excluded.daily_cap,
  is_default = excluded.is_default;
insert into biz_counters (k, v) values ('order', 0) on conflict (k) do nothing;

-- ---------- Realtime（幂等） ----------
do $$
declare t text;
begin
  foreach t in array array['biz_suppliers','biz_orders','biz_order_items',
                           'biz_logistics_tracks','biz_aftersales','biz_withdrawals']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ---------- RLS：anon 只读 ----------
alter table biz_suppliers        enable row level security;
alter table biz_orders           enable row level security;
alter table biz_order_items      enable row level security;
alter table biz_logistics_tracks enable row level security;
alter table biz_aftersales       enable row level security;
alter table biz_withdrawals      enable row level security;
alter table biz_counters         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['biz_suppliers','biz_orders','biz_order_items',
                           'biz_logistics_tracks','biz_aftersales','biz_withdrawals','biz_counters']
  loop
    execute format('drop policy if exists "read" on %I', t);
    execute format('create policy "read" on %I for select using (true)', t);
  end loop;
end $$;

-- ---------- 服务端计价（复刻 pricing.js，返回分） ----------
create or replace function biz_price_total(p_n int, p_coupon_type text)
returns int language sql immutable as $$
  select greatest(0,
    ( -- 商品小计：1-2 张 990 / 3-4 张 790 / 5+ 张 590（分/张）
      greatest(0, least(p_n, 2)) * 990
      + greatest(0, least(p_n - 2, 2)) * 790
      + greatest(0, p_n - 4) * 590
      -- 运费：1 张 500，2 张+ 0
      + case when p_n = 1 then 500 else 0 end
      -- 券：freeship 仅 1 张时抵 500；general 减 500
      - case
          when p_coupon_type = 'freeship' and p_n = 1 then 500
          when p_coupon_type = 'general' then 500
          else 0
        end
    )
  );
$$;

-- 发号器：SO + yyyymmdd + 3 位序号（行锁防并发撞号）
create or replace function biz_next_order_no()
returns text language plpgsql security definer as $$
declare seq int; no text;
begin
  insert into biz_counters (k, v) values ('order', 0) on conflict (k) do nothing;
  update biz_counters set v = v + 1
    where k = 'order' returning v into seq;
  no := 'SO' || to_char(now(), 'YYYYMMDD') || lpad(seq::text, 3, '0');
  return no;
end $$;

-- 地址派单：按 region 匹配供应商，未命中走默认供应商
create or replace function biz_match_supplier(p_region text)
returns text language sql stable as $$
  select coalesce(
    (select s.id from biz_suppliers s
      where s.region_codes @> array[coalesce(nullif(split_part(p_region, ' ', 1), ''), p_region)]
      order by s.is_default desc, s.id limit 1),
    (select s.id from biz_suppliers s where s.is_default order by s.id limit 1),
    (select s.id from biz_suppliers s order by s.id limit 1)
  );
$$;

-- ---------- 用户端：结算（建单 + 服务端计价校验） ----------
create or replace function biz_checkout(p_user_id text,
                                        p_items jsonb,          -- [{name,thumb,copies}]
                                        p_address jsonb,        -- {name,phone,region,detail}
                                        p_coupon_type text,
                                        p_note text,
                                        p_amount_expect int)    -- 前端算好的实付（分），用于校验
returns jsonb language plpgsql security definer as $$
declare
  v_n int; v_amount int; v_sub int; v_ship int; v_disc int;
  v_id text; v_supplier text; v_region text;
  it jsonb;
begin
  -- 汇总张数
  select coalesce(sum((it->>'copies')::int), 0) into v_n
    from jsonb_array_elements(p_items) it;
  if v_n is null or v_n <= 0 then
    return jsonb_build_object('ok', false, 'msg', '结算袋为空');
  end if;

  -- 服务端权威计价
  v_amount := biz_price_total(v_n, p_coupon_type);
  if p_amount_expect is not null and p_amount_expect <> v_amount then
    return jsonb_build_object('ok', false, 'msg',
      '金额校验不一致（前端 ' || p_amount_expect || ' / 服务端 ' || v_amount || '）');
  end if;

  -- 明细分解（用于订单表）
  v_sub := greatest(0, least(v_n, 2)) * 990 + greatest(0, least(v_n - 2, 2)) * 790 + greatest(0, v_n - 4) * 590;
  v_ship := case when v_n = 1 then 500 else 0 end;
  v_disc := case
              when p_coupon_type = 'freeship' and v_n = 1 then 500
              when p_coupon_type = 'general' then 500
              else 0
            end;

  -- 发号 + 派单
  v_id := biz_next_order_no();
  v_region := coalesce(p_address->>'region', '');
  v_supplier := biz_match_supplier(v_region);

  insert into biz_orders (id, user_id, supplier_id, status, n,
                          subtotal, shipping, discount, amount, coupon_type,
                          address, note)
  values (v_id, p_user_id, v_supplier, 'pending', v_n,
          v_sub, v_ship, v_disc, v_amount, p_coupon_type,
          p_address, nullif(trim(coalesce(p_note, '')), ''));

  for it in select * from jsonb_array_elements(p_items) loop
    insert into biz_order_items (order_id, name, thumb, copies)
    values (v_id, coalesce(it->>'name', '贴纸'), it->>'thumb',
            greatest(1, coalesce((it->>'copies')::int, 1)));
  end loop;

  return jsonb_build_object('ok', true, 'id', v_id, 'amount', v_amount);
end $$;

-- ---------- 用户端：支付（pending → paid） ----------
create or replace function biz_pay(p_id text)
returns jsonb language plpgsql security definer as $$
declare o biz_orders;
begin
  update biz_orders set status = 'paid', paid_at = now()
    where id = p_id and status = 'pending'
    returning * into o;
  if o is null then
    select * into o from biz_orders where id = p_id;
    return jsonb_build_object('ok', false, 'msg', '订单不存在或状态已变更', 'status', o.status);
  end if;
  return jsonb_build_object('ok', true, 'status', o.status);
end $$;

-- ---------- 用户端：取消 / 签收 ----------
create or replace function biz_user_action(p_id text, p_action text)
returns jsonb language plpgsql security definer as $$
declare o biz_orders;
begin
  if p_action = 'cancel' then
    update biz_orders set status = 'closed', closed_at = now()
      where id = p_id and status = 'pending' returning * into o;
  elsif p_action = 'confirm' then
    update biz_orders set status = 'done', done_at = now()
      where id = p_id and status = 'shipped' returning * into o;
  else
    return jsonb_build_object('ok', false, 'msg', '未知操作');
  end if;
  if o is null then
    select * into o from biz_orders where id = p_id;
    return jsonb_build_object('ok', false, 'msg', '订单不存在或状态不允许该操作', 'status', o.status);
  end if;
  return jsonb_build_object('ok', true, 'status', o.status);
end $$;

-- ---------- 商家端：状态流转单入口 ----------
create or replace function biz_supplier_action(p_order_id text, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer as $$
declare o biz_orders;
begin
  if p_action = 'accept' then
    -- paid → accepted（接单）
    update biz_orders set status = 'accepted', accepted_at = now()
      where id = p_order_id and status = 'paid' returning * into o;
  elsif p_action = 'make' then
    -- accepted → making（开始制作）
    update biz_orders set status = 'making', made_at = now()
      where id = p_order_id and status = 'accepted' returning * into o;
  elsif p_action = 'ship' then
    -- making → shipped（发货，写物流并生成首条轨迹）
    update biz_orders
      set status = 'shipped', shipped_at = now(),
          ship_company = coalesce(nullif(trim(coalesce(p_payload->>'company', '')), ''), '中通快递'),
          ship_no = coalesce(nullif(trim(coalesce(p_payload->>'no', '')), ''),
                             'ZT' || to_char(now(), 'MMDDHH24MS') || lpad((random()*999)::int::text, 3, '0'))
      where id = p_order_id and status = 'making' returning * into o;
    if o is not null then
      insert into biz_logistics_tracks (order_id, d)
      values (o.id, '【' || coalesce(o.ship_company, '中通快递') || '】商家已发货，等待揽收');
    end if;
  elsif p_action = 'complete' then
    -- shipped → done（完成，同时结算货款给供应商）
    update biz_orders set status = 'done', done_at = now()
      where id = p_order_id and status = 'shipped' returning * into o;
    if o is not null and o.supplier_id is not null then
      update biz_suppliers set balance = balance + o.amount where id = o.supplier_id;
    end if;
  else
    return jsonb_build_object('ok', false, 'msg', '未知操作');
  end if;

  if o is null then
    select * into o from biz_orders where id = p_order_id;
    return jsonb_build_object('ok', false, 'msg', '订单不存在或当前状态不允许该操作', 'status', o.status);
  end if;
  return jsonb_build_object('ok', true, 'status', o.status);
end $$;

-- ---------- 商家端：登录（模拟密码校验） ----------
create or replace function biz_login(p_supplier_id text, p_password text)
returns jsonb language plpgsql security definer as $$
declare s biz_suppliers;
begin
  select * into s from biz_suppliers where id = p_supplier_id;
  if s is null then
    return jsonb_build_object('ok', false, 'msg', '店铺不存在');
  end if;
  if s.password <> coalesce(p_password, '') then
    return jsonb_build_object('ok', false, 'msg', '密码不正确（演示密码 123456）');
  end if;
  return jsonb_build_object('ok', true, 'id', s.id, 'name', s.name);
end $$;

-- ---------- 商家端：店铺设置 ----------
create or replace function biz_save_settings(p_supplier_id text, p_settings jsonb)
returns jsonb language plpgsql security definer as $$
declare s biz_suppliers;
begin
  update biz_suppliers set
    address = coalesce(nullif(trim(coalesce(p_settings->>'address', '')), ''), address),
    open_hours = coalesce(nullif(trim(coalesce(p_settings->>'open_hours', '')), ''), open_hours),
    daily_cap = greatest(1, coalesce((p_settings->>'daily_cap')::int, daily_cap)),
    stock_mica = greatest(0, coalesce((p_settings->>'stock_mica')::int, stock_mica)),
    stock_silver = greatest(0, coalesce((p_settings->>'stock_silver')::int, stock_silver))
  where id = p_supplier_id
  returning * into s;
  if s is null then
    return jsonb_build_object('ok', false, 'msg', '店铺不存在');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 商家端：提现（全额模拟） ----------
create or replace function biz_withdraw(p_supplier_id text, p_amount int)
returns jsonb language plpgsql security definer as $$
declare s biz_suppliers; v_amount int;
begin
  select * into s from biz_suppliers where id = p_supplier_id for update;
  if s is null then
    return jsonb_build_object('ok', false, 'msg', '店铺不存在');
  end if;
  -- p_amount 为空或超过余额时提全部
  v_amount := least(coalesce(p_amount, s.balance), s.balance);
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'msg', '没有可提现的余额');
  end if;
  update biz_suppliers set balance = balance - v_amount where id = p_supplier_id;
  insert into biz_withdrawals (supplier_id, amount) values (p_supplier_id, v_amount);
  return jsonb_build_object('ok', true, 'amount', v_amount);
end $$;

-- ---------- 用户端：提交售后 ----------
create or replace function biz_open_aftersale(p_order_id text, p_kind text, p_reason text)
returns jsonb language plpgsql security definer as $$
declare o biz_orders; a_id bigint;
begin
  if p_kind not in ('redo', 'reship', 'refund') then
    return jsonb_build_object('ok', false, 'msg', '售后类型不合法');
  end if;
  select * into o from biz_orders where id = p_order_id;
  if o is null then
    return jsonb_build_object('ok', false, 'msg', '订单不存在');
  end if;
  if o.status not in ('shipped', 'done') then
    return jsonb_build_object('ok', false, 'msg', '当前状态不支持售后');
  end if;
  insert into biz_aftersales (order_id, supplier_id, kind, reason)
  values (p_order_id, o.supplier_id, p_kind, nullif(trim(coalesce(p_reason, '')), ''))
  returning id into a_id;
  update biz_orders set status = 'aftersale' where id = p_order_id;
  return jsonb_build_object('ok', true, 'id', a_id);
end $$;

-- ---------- 商家端：处理售后 ----------
create or replace function biz_aftersale_action(p_aftersale_id bigint, p_result text)
returns jsonb language plpgsql security definer as $$
declare a biz_aftersales; o biz_orders;
begin
  update biz_aftersales set status = 'done', done_at = now(), result = nullif(trim(coalesce(p_result, '')), '')
    where id = p_aftersale_id and status = 'open'
    returning * into a;
  if a is null then
    return jsonb_build_object('ok', false, 'msg', '工单不存在或已处理');
  end if;
  select * into o from biz_orders where id = a.order_id;
  if o is null then
    return jsonb_build_object('ok', true, 'warn', '关联订单不存在');
  end if;
  -- 退款：从供应商余额扣回（可为负，演示语义）
  if a.kind = 'refund' then
    update biz_suppliers set balance = balance - o.amount where id = o.supplier_id;
    update biz_orders set status = 'closed', closed_at = now() where id = o.id;
  else
    -- 重做 / 补寄：订单回到制作流程
    update biz_orders set status = 'making', made_at = now() where id = o.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 演示重置（biz_ 表清空，供应商配置保留） ----------
create or replace function biz_reset()
returns void language plpgsql security definer as $$
begin
  delete from biz_aftersales where true;
  delete from biz_logistics_tracks where true;
  delete from biz_order_items where true;
  delete from biz_orders where true;
  delete from biz_withdrawals where true;
  update biz_suppliers set balance = 0 where true;
  update biz_counters set v = 0 where k = 'order';
end $$;

-- ---------- 授权 ----------
grant execute on function biz_price_total(int, text),
  biz_next_order_no(), biz_match_supplier(text),
  biz_checkout(text, jsonb, jsonb, text, text, int),
  biz_pay(text), biz_user_action(text, text),
  biz_supplier_action(text, text, jsonb),
  biz_login(text, text), biz_save_settings(text, jsonb),
  biz_withdraw(text, int),
  biz_open_aftersale(text, text, text), biz_aftersale_action(bigint, text),
  biz_reset()
to anon, authenticated;
