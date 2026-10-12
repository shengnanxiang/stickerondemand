/* ============================================================
   供应端 SDK —— Supabase 云端读写 + Realtime 订阅 + RPC 封装
   依赖：../demo/vendor/supabase.min.js + ../demo/config.js
   模式复刻 demo/demo.js：Realtime channel + 5s 轮询兜底 + 250ms 防抖
   ============================================================ */
(function (global) {
  'use strict';

  var db = null, channel = null, listeners = [], fetchTimer = null, pollTimer = null, fetching = false;
  var state = { orders: [], items: [], tracks: [], aftersales: [], suppliers: [], withdrawals: [] };
  var session = null; // {id, name}
  var SESSION_KEY = 'sod.biz.session';

  /* ---------- 初始化 ---------- */
  function cfgProblem() {
    var c = global.SOD_CONFIG;
    if (!c || !c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) return 'demo/config.js 未配置 Supabase';
    return null;
  }
  function init() {
    if (db) return true;
    if (cfgProblem() || !global.supabase) return false;
    db = global.supabase.createClient(global.SOD_CONFIG.SUPABASE_URL, global.SOD_CONFIG.SUPABASE_ANON_KEY);
    return true;
  }

  /* ---------- 映射（snake_case → camelCase） ---------- */
  function ts(v) { return v ? +new Date(v) : null; }
  function mapOrder(r) {
    return r && {
      id: r.id, userId: r.user_id, supplierId: r.supplier_id, status: r.status,
      n: r.n, subtotal: r.subtotal, shipping: r.shipping, discount: r.discount, amount: r.amount,
      couponType: r.coupon_type, address: r.address || {}, note: r.note,
      shipCompany: r.ship_company, shipNo: r.ship_no,
      /* 2026-10-12 自提增量：delivery_method（express/pickup，旧单兜底 express）/
         pickup_code（4 位取货码，自提单）/ ready_at（预计可取时刻） */
      deliveryMethod: r.delivery_method || 'express',
      pickupCode: r.pickup_code,
      readyAt: ts(r.ready_at),
      createdAt: ts(r.created_at), paidAt: ts(r.paid_at), acceptedAt: ts(r.accepted_at),
      madeAt: ts(r.made_at), shippedAt: ts(r.shipped_at), doneAt: ts(r.done_at), closedAt: ts(r.closed_at)
    };
  }
  function mapItem(r) {
    return r && { id: r.id, orderId: r.order_id, name: r.name, thumb: r.thumb, copies: r.copies };
  }
  function mapTrack(r) {
    return r && { id: r.id, orderId: r.order_id, d: r.d, createdAt: ts(r.created_at) };
  }
  function mapAftersale(r) {
    return r && {
      id: r.id, orderId: r.order_id, supplierId: r.supplier_id, kind: r.kind,
      reason: r.reason, status: r.status, result: r.result,
      createdAt: ts(r.created_at), doneAt: ts(r.done_at)
    };
  }
  function mapSupplier(r) {
    return r && {
      id: r.id, name: r.name, regionCodes: r.region_codes || [], address: r.address,
      openHours: r.open_hours, dailyCap: r.daily_cap,
      stockMica: r.stock_mica, stockSilver: r.stock_silver,
      isDefault: r.is_default, balance: r.balance
    };
  }
  function mapWithdrawal(r) {
    return r && { id: r.id, supplierId: r.supplier_id, amount: r.amount, createdAt: ts(r.created_at) };
  }

  /* ---------- RPC ---------- */
  function rpc(name, args) {
    if (!init()) return Promise.reject(new Error(cfgProblem() || 'supabase-js 未加载'));
    return db.rpc(name, args || {}).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  /* ---------- 全量拉取（订阅回调的数据源） ---------- */
  function fetchState() {
    if (fetching || !db) return;
    fetching = true;
    Promise.all([
      db.from('biz_orders').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('biz_order_items').select('*').limit(600),
      db.from('biz_logistics_tracks').select('*').order('created_at', { ascending: true }).limit(1000),
      db.from('biz_aftersales').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('biz_suppliers').select('*').order('id'),
      db.from('biz_withdrawals').select('*').order('created_at', { ascending: false }).limit(200)
    ]).then(function (rs) {
      rs.forEach(function (r) { if (r.error) throw r.error; });
      state = {
        orders: (rs[0].data || []).map(mapOrder),
        items: (rs[1].data || []).map(mapItem),
        tracks: (rs[2].data || []).map(mapTrack),
        aftersales: (rs[3].data || []).map(mapAftersale),
        suppliers: (rs[4].data || []).map(mapSupplier),
        withdrawals: (rs[5].data || []).map(mapWithdrawal)
      };
      listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
    }).catch(function (e) {
      console.error('biz fetchState', e);
    }).finally(function () { fetching = false; });
  }
  function refetch() { clearTimeout(fetchTimer); fetchTimer = setTimeout(fetchState, 250); }

  /* ---------- 本地回退引擎（云端未配置时的离线演示，2026-10-12 自提增量） ----------
     数据源：用户端 sod.v1 本地订单（Store 双轨）+ sod.biz.local 店铺配置/提现记录；
     状态变更写回 sod.v1 订单字段，跨页签经 storage 事件联动；
     状态机守卫与云端 biz_supplier_action 逐条对齐（ready=making+pickup 等） */
  var LOCAL_KEY = 'sod.biz.local';
  var localData = null, localBound = false;

  /* 取货码：与 SQL 算法完全一致（订单号数字段哈希取 4 位，djb2 变体） */
  function localPickupCode(orderId) {
    var s = (orderId || '').replace(/\D/g, '');
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000000007;
    return ('0000' + (h % 10000)).slice(-4);
  }

  /* 本地种子店铺（与 biz-schema.sql 种子同口径） */
  var LOCAL_SEED_SUPPLIERS = [
    { id: 'SUP-SH01', name: '上海徐汇工作室', password: '123456', region_codes: ['上海市'],
      address: '上海市徐汇区漕溪北路 100 号 1 层', open_hours: '09:00 - 20:00',
      daily_cap: 50, stock_mica: 120, stock_silver: 80, is_default: true, balance: 0 },
    { id: 'SUP-BJ01', name: '北京朝阳工作室', password: '123456', region_codes: ['北京市'],
      address: '北京市朝阳区三里屯路 11 号 2 层', open_hours: '10:00 - 19:00',
      daily_cap: 40, stock_mica: 90, stock_silver: 60, is_default: false, balance: 0 }
  ];

  function localLoad() {
    if (!localData) {
      try { localData = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch (e) { localData = null; }
      if (!localData || !localData.suppliers || !localData.suppliers.length) {
        localData = { suppliers: JSON.parse(JSON.stringify(LOCAL_SEED_SUPPLIERS)), withdrawals: [] };
      }
    }
    return localData;
  }
  function localPersist() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(localData)); } catch (e) {}
  }
  function userStoreRead() {
    try { return JSON.parse(localStorage.getItem('sod.v1') || 'null'); } catch (e) { return null; }
  }
  function userStoreWrite(us) {
    try { localStorage.setItem('sod.v1', JSON.stringify(us)); } catch (e) {}
  }
  function ms(v) { return typeof v === 'number' ? v : (v ? +new Date(v) : null); }

  /* 与 biz_match_supplier 同口径：region 首段匹配 → 默认店铺 → 第一家 */
  function localMatchSupplier(region) {
    var sups = localLoad().suppliers;
    var first = ((region || '').split(' ')[0]) || '';
    for (var i = 0; i < sups.length; i++)
      if (first && (sups[i].region_codes || []).indexOf(first) >= 0) return sups[i].id;
    for (var j = 0; j < sups.length; j++) if (sups[j].is_default) return sups[j].id;
    return (sups[0] || {}).id || null;
  }

  /* 用户端本地订单（元）→ biz 订单形状（分）；pickupCode 缺失时按同算法补算，保证两端一致 */
  function mapLocalOrder(o, userId) {
    var dm = o.deliveryMethod || o.delivery_method || 'express';
    return {
      id: o.id, userId: userId || '', supplierId: localMatchSupplier(o.address && o.address.region),
      status: o.status, n: o.n || 0,
      subtotal: Math.round((o.subtotal || 0) * 100), shipping: Math.round((o.shipping || 0) * 100),
      discount: Math.round((o.couponDiscount || 0) * 100), amount: Math.round((o.amount || 0) * 100),
      couponType: o.couponType || null, address: o.address || {}, note: o.note || '',
      shipCompany: (o.logistics && o.logistics.company) || '', shipNo: (o.logistics && o.logistics.no) || '',
      deliveryMethod: dm,
      pickupCode: o.pickupCode || o.pickup_code || (dm === 'pickup' ? localPickupCode(o.id) : null),
      readyAt: ms(o.readyAt || o.ready_at),
      createdAt: ms(o.createdAt), paidAt: ms(o.paidAt), acceptedAt: ms(o.acceptedAt),
      madeAt: ms(o.madeAt), shippedAt: ms(o.shippedAt), doneAt: ms(o.doneAt), closedAt: ms(o.closedAt)
    };
  }

  function localState() {
    var us = userStoreRead();
    var userId = (us && us.user) ? (us.user.nickname || us.user.phone || '') : '';
    var rawOrders = (us && us.orders) || [];
    var items = [];
    rawOrders.forEach(function (o) {
      (o.items || []).forEach(function (it) {
        items.push({ orderId: o.id, name: it.name, thumb: it.thumb, copies: it.copies });
      });
    });
    return {
      orders: rawOrders.map(function (o) { return mapLocalOrder(o, userId); }),
      items: items, tracks: [], aftersales: [],
      suppliers: localLoad().suppliers.map(mapSupplier),
      withdrawals: (localLoad().withdrawals || []).map(function (w) {
        return { id: w.id, supplierId: w.supplierId, amount: w.amount, createdAt: ms(w.createdAt) };
      })
    };
  }
  function localNotify() {
    state = localState();
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
  }

  /* 完成类动作结算货款给供应商（与云端 complete/handover 同口径） */
  function localSettle(mo) {
    var d = localLoad();
    for (var i = 0; i < d.suppliers.length; i++)
      if (d.suppliers[i].id === mo.supplierId) { d.suppliers[i].balance += mo.amount; break; }
    localPersist();
  }

  /* 本地状态机：守卫与云端 biz_supplier_action 逐条对齐 */
  function localAction(id, action, payload) {
    var us = userStoreRead();
    var o = null, i;
    if (us && us.orders)
      for (i = 0; i < us.orders.length; i++) if (us.orders[i].id === id) { o = us.orders[i]; break; }
    if (!o) return { ok: false, msg: '订单不存在或当前状态不允许该操作' };
    var dm = o.deliveryMethod || o.delivery_method || 'express';
    var now = Date.now();
    var fail = function (msg) { return { ok: false, msg: msg, status: o.status }; };

    if (action === 'accept') {
      if (o.status !== 'paid') return fail('订单不存在或当前状态不允许该操作');
      o.status = 'accepted'; o.acceptedAt = now;
    } else if (action === 'make') {
      if (o.status !== 'accepted') return fail('订单不存在或当前状态不允许该操作');
      o.status = 'making'; o.madeAt = now;
    } else if (action === 'ship') {
      /* 快递单专用：自提单误调被拒（与云端 ship 守卫一致） */
      if (o.status !== 'making' || dm === 'pickup') return fail('订单不存在或当前状态不允许该操作');
      var c = (((payload || {}).company) || '').trim() || '中通快递';
      var no = (((payload || {}).no) || '').trim() || ('ZT' + String(now).slice(-8));
      o.status = 'shipped'; o.shippedAt = now;
      o.logistics = { company: c, no: no, tracks: [{ t: now, d: '【' + c + '】商家已发货，等待揽收' }] };
    } else if (action === 'complete') {
      if (o.status !== 'shipped') return fail('订单不存在或当前状态不允许该操作');
      o.status = 'done'; o.doneAt = now;
      localSettle(mapLocalOrder(o));
    } else if (action === 'ready') {
      /* 自提单专用：making → shipped（pickup 语义 = 制作完成待自提） */
      if (o.status !== 'making' || dm !== 'pickup') return fail('订单不存在或当前状态不允许该操作');
      o.status = 'shipped'; o.shippedAt = now;
    } else if (action === 'handover') {
      /* 自提单核码交付：shipped → done，4 位码全匹配才通过 */
      if (o.status !== 'shipped' || dm !== 'pickup') return fail('订单不在可取状态');
      var expect = o.pickupCode || o.pickup_code || localPickupCode(o.id);
      if (String(((payload || {}).code) || '').trim() !== String(expect)) return fail('取货码不正确');
      o.status = 'done'; o.doneAt = now;
      localSettle(mapLocalOrder(o));
    } else {
      return { ok: false, msg: '未知操作' };
    }
    userStoreWrite(us);
    localNotify();
    return { ok: true, status: o.status };
  }

  /* biz_supplier_action 单入口封装：云端 RPC / 本地状态机自动分岔 */
  function supplierAction(id, action, payload) {
    if (!init()) return Promise.resolve(localAction(id, action, payload));
    return rpc('biz_supplier_action', { p_order_id: id, p_action: action, p_payload: payload || {} }).then(done);
  }

  /* ---------- 会话（模拟登录） ---------- */
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveSession(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  session = loadSession();

  function requireSession() {
    if (!session) { location.replace('login.html'); return null; }
    return session;
  }

  /* ---------- 导出 ---------- */
  global.Biz = {
    get session() { return session; },

    /* 订阅云端变更（Realtime + 轮询兜底）；云端未配置时走本地回退 */
    subscribe: function (fn) {
      listeners.push(fn);
      if (!init()) {
        /* 本地模式：storage 事件跨页签联动 + 立即出首帧 */
        if (!localBound) {
          localBound = true;
          window.addEventListener('storage', function (e) {
            if (e.key === 'sod.v1' || e.key === LOCAL_KEY) localNotify();
          });
        }
        state = localState();
        fn(state);
        return { unsubscribe: function () { listeners = listeners.filter(function (f) { return f !== fn; }); } };
      }
      if (!channel) {
        channel = db.channel('sod-biz')
          .on('postgres_changes', { event: '*', schema: 'public' }, refetch)
          .subscribe(function (st) { if (st === 'SUBSCRIBED') refetch(); });
      }
      if (!pollTimer) pollTimer = setInterval(fetchState, 5000);
      fetchState();
      return { unsubscribe: function () { listeners = listeners.filter(function (f) { return f !== fn; }); } };
    },

    requireSession: requireSession,

    logout: function () { clearSession(); session = null; location.href = 'login.html'; },

    /* 登录：选店铺 + 密码校验（云端 RPC / 本地演示店铺） */
    login: function (supplierId, password) {
      if (!init()) {
        var d = localLoad();
        for (var i = 0; i < d.suppliers.length; i++) {
          var s = d.suppliers[i];
          if (s.id === supplierId) {
            if (s.password !== (password || '')) return Promise.resolve({ ok: false, msg: '密码不正确（演示密码 123456）' });
            session = { id: s.id, name: s.name };
            saveSession(session);
            return Promise.resolve({ ok: true, id: s.id, name: s.name });
          }
        }
        return Promise.resolve({ ok: false, msg: '店铺不存在' });
      }
      return rpc('biz_login', { p_supplier_id: supplierId, p_password: password }).then(function (r) {
        if (r && r.ok) {
          session = { id: r.id, name: r.name };
          saveSession(session);
        }
        return r;
      });
    },

    /* 供应商列表（登录页下拉；云端 / 本地种子） */
    listSuppliers: function () {
      if (!init()) return Promise.resolve(localLoad().suppliers.map(function (s) {
        return { id: s.id, name: s.name, address: s.address, open_hours: s.open_hours };
      }));
      return db.from('biz_suppliers').select('id,name,address,open_hours').order('id')
        .then(function (r) { return r.data || []; });
    },

    /* 本店订单（含 items / tracks 组装） */
    myOrders: function (supplierId, statuses) {
      var list = state.orders.filter(function (o) { return o.supplierId === supplierId; });
      if (statuses && statuses.length) list = list.filter(function (o) { return statuses.indexOf(o.status) >= 0; });
      return list.map(function (o) {
        o.items = state.items.filter(function (it) { return it.orderId === o.id; });
        o.tracks = state.tracks.filter(function (t) { return t.orderId === o.id; });
        return o;
      });
    },

    /* 单个订单（详情页用，含组装） */
    getOrder: function (orderId) {
      var o = null;
      for (var i = 0; i < state.orders.length; i++) if (state.orders[i].id === orderId) { o = state.orders[i]; break; }
      if (!o) return null;
      o.items = state.items.filter(function (it) { return it.orderId === o.id; });
      o.tracks = state.tracks.filter(function (t) { return t.orderId === o.id; });
      return o;
    },

    /* 本店售后工单 */
    myAftersales: function (supplierId) {
      return state.aftersales.filter(function (a) { return a.supplierId === supplierId; })
        .map(function (a) {
          a.order = null;
          for (var i = 0; i < state.orders.length; i++) if (state.orders[i].id === a.orderId) { a.order = state.orders[i]; break; }
          return a;
        });
    },

    /* 本店供应商配置 */
    getSupplier: function (supplierId) {
      for (var i = 0; i < state.suppliers.length; i++)
        if (state.suppliers[i].id === supplierId) return state.suppliers[i];
      return null;
    },

    /* 本店提现记录 */
    myWithdrawals: function (supplierId) {
      return state.withdrawals.filter(function (w) { return w.supplierId === supplierId; });
    },

    /* ---- RPC 动作（云端 RPC / 本地状态机自动分岔） ---- */
    acceptOrder: function (id) { return supplierAction(id, 'accept'); },
    makeOrder:   function (id) { return supplierAction(id, 'make'); },
    shipOrder:   function (id, company, no) {
      return supplierAction(id, 'ship', { company: company || '', no: no || '' });
    },
    completeOrder: function (id) { return supplierAction(id, 'complete'); },
    /* 2026-10-12 自提增量：制作完成可取（自提单 making → 可取） */
    readyOrder: function (id) { return supplierAction(id, 'ready'); },
    /* 2026-10-12 自提增量：核码交付（自提单可取 → 完成，服务端验 4 位取货码） */
    handoverOrder: function (id, code) { return supplierAction(id, 'handover', { code: code || '' }); },
    saveSettings: function (supplierId, s) {
      if (!init()) {
        var d = localLoad();
        for (var i = 0; i < d.suppliers.length; i++) {
          var sp = d.suppliers[i];
          if (sp.id === supplierId) {
            if (s && s.address != null && s.address !== '') sp.address = s.address;
            if (s && s.open_hours != null && s.open_hours !== '') sp.open_hours = s.open_hours;
            if (s && s.daily_cap) sp.daily_cap = Math.max(1, parseInt(s.daily_cap, 10) || 1);
            if (s && s.stock_mica != null) sp.stock_mica = Math.max(0, parseInt(s.stock_mica, 10) || 0);
            if (s && s.stock_silver != null) sp.stock_silver = Math.max(0, parseInt(s.stock_silver, 10) || 0);
            localPersist();
            localNotify();
            return Promise.resolve({ ok: true });
          }
        }
        return Promise.resolve({ ok: false, msg: '店铺不存在' });
      }
      return rpc('biz_save_settings', { p_supplier_id: supplierId, p_settings: s }).then(done);
    },
    withdraw: function (supplierId, amountFen) {
      if (!init()) {
        var d = localLoad();
        for (var i = 0; i < d.suppliers.length; i++) {
          var sp = d.suppliers[i];
          if (sp.id === supplierId) {
            var v = Math.min(amountFen == null ? sp.balance : amountFen, sp.balance);
            if (v <= 0) return Promise.resolve({ ok: false, msg: '没有可提现的余额' });
            sp.balance -= v;
            d.withdrawals.unshift({ id: 'WD' + Date.now(), supplierId: supplierId, amount: v, createdAt: Date.now() });
            localPersist();
            localNotify();
            return Promise.resolve({ ok: true, amount: v });
          }
        }
        return Promise.resolve({ ok: false, msg: '店铺不存在' });
      }
      return rpc('biz_withdraw', { p_supplier_id: supplierId, p_amount: amountFen }).then(done);
    },
    aftersaleAction: function (id, result) {
      return rpc('biz_aftersale_action', { p_aftersale_id: id, p_result: result || '' }).then(done);
    },
    reset: function () {
      if (!init()) {
        /* 本地重置：只清本店业务痕迹（sod.v1 订单状态），店铺配置保留 */
        var us = userStoreRead();
        if (us && us.orders) {
          us.orders = us.orders.filter(function (o) {
            var dm = o.deliveryMethod || o.delivery_method || 'express';
            return o.status === 'pending' && dm !== 'pickup';
          });
          userStoreWrite(us);
        }
        var d = localLoad();
        d.withdrawals = [];
        d.suppliers.forEach(function (s) { s.balance = 0; });
        localPersist();
        localNotify();
        return Promise.resolve();
      }
      return rpc('biz_reset').then(function () { refetch(); });
    }
  };

  function done(r) { refetch(); return r; }

  /* ---------- 工具（页面共用） ---------- */
  global.BizUtil = {
    fmtFen: function (fen) { return (fen / 100).toFixed(2); },
    yuan: function (fen) { return '¥' + (fen / 100).toFixed(2); },
    pad: function (n) { return n < 10 ? '0' + n : '' + n; },
    fmtTime: function (tsVal) {
      if (!tsVal) return '';
      var d = new Date(tsVal);
      return d.getFullYear() + '-' + BizUtil.pad(d.getMonth() + 1) + '-' + BizUtil.pad(d.getDate()) +
        ' ' + BizUtil.pad(d.getHours()) + ':' + BizUtil.pad(d.getMinutes());
    },
    ago: function (tsVal) {
      if (!tsVal) return '';
      var diff = Date.now() - tsVal;
      var m = Math.floor(diff / 60000);
      if (m < 1) return '刚刚';
      if (m < 60) return m + ' 分钟前';
      var h = Math.floor(m / 60); if (h < 24) return h + ' 小时前';
      var d = Math.floor(h / 24); if (d < 30) return d + ' 天前';
      return BizUtil.fmtTime(tsVal).slice(0, 10);
    },
    escapeHtml: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    qs: function (sel, root) { return (root || document).querySelector(sel); },
    qsa: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    param: function (name) { return new URLSearchParams(location.search).get(name); },
    toast: function (msg, type) {
      var wrap = document.querySelector('.toast-wrap');
      if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
      var t = document.createElement('div');
      t.className = 'toast ' + (type || '');
      t.innerHTML = '<span>' + BizUtil.escapeHtml(msg) + '</span>';
      wrap.appendChild(t);
      setTimeout(function () {
        t.style.transition = 'opacity .24s, transform .24s';
        t.style.opacity = '0'; t.style.transform = 'translateY(8px)';
        setTimeout(function () { t.remove(); }, 260);
      }, 2200);
    },

    /* 状态文案 / 徽章（供应端视角）；2026-10-12 自提增量：shipped+pickup 显示「待自提」 */
    STATUS_TEXT: {
      pending: '待支付', paid: '待接单', accepted: '已接单', making: '制作中',
      shipped: '已发货', done: '已完成', closed: '已关闭', aftersale: '售后中'
    },
    STATUS_PILL: {
      pending: 'pill-sun', paid: 'pill-danger', accepted: 'pill-grape', making: 'pill-brand',
      shipped: 'pill-sky', done: 'pill-mint', closed: 'pill-gray', aftersale: 'pill-danger'
    },
    AFTERSALE_KIND: { redo: '重做', reship: '补寄', refund: '退款' },
    statusPill: function (s, deliveryMethod) {
      if (s === 'shipped' && deliveryMethod === 'pickup')
        return '<span class="pill pill-brand">待自提</span>';
      return '<span class="pill ' + (this.STATUS_PILL[s] || 'pill-gray') + '">' +
        (this.STATUS_TEXT[s] || s) + '</span>';
    },
    /* 2026-10-12 自提增量：配送方式小 pill（队列 / 详情用） */
    DELIVERY_TEXT: { pickup: '自提', express: '快递' },
    DELIVERY_PILL: { pickup: 'pill-brand', express: 'pill-sky' },
    deliveryPill: function (dm) {
      var d = dm || 'express';
      return '<span class="pill ' + (this.DELIVERY_PILL[d] || 'pill-gray') + '">' +
        (this.DELIVERY_TEXT[d] || d) + '</span>';
    }
  };
})(window);
