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
  function cfgBanner() {
    if (document.getElementById('biz-setup')) return;
    document.body.insertAdjacentHTML('afterbegin',
      '<div id="biz-setup" style="position:fixed;inset:auto 12px 12px 12px;z-index:999;background:#fff;' +
      'border:2px solid #FF7A45;border-radius:14px;padding:16px 18px;font-size:13px;line-height:1.8;' +
      'box-shadow:0 10px 40px rgba(0,0,0,.18);color:#302A24;font-family:system-ui,sans-serif">' +
      '<b>⚙️ 还差一步：连接云端</b><br>1. Supabase SQL Editor 执行 <b>supabase/biz-schema.sql</b><br>' +
      '2. 确认 <b>demo/config.js</b> 已填 URL / anon key</div>');
  }

  /* ---------- 映射（snake_case → camelCase） ---------- */
  function ts(v) { return v ? +new Date(v) : null; }
  function mapOrder(r) {
    return r && {
      id: r.id, userId: r.user_id, supplierId: r.supplier_id, status: r.status,
      n: r.n, subtotal: r.subtotal, shipping: r.shipping, discount: r.discount, amount: r.amount,
      couponType: r.coupon_type, address: r.address || {}, note: r.note,
      shipCompany: r.ship_company, shipNo: r.ship_no,
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

    /* 订阅云端变更（Realtime + 轮询兜底） */
    subscribe: function (fn) {
      if (!init()) { cfgBanner(); fn(state); return { unsubscribe: function () {} }; }
      listeners.push(fn);
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

    /* 登录：选店铺 + 密码校验 */
    login: function (supplierId, password) {
      return rpc('biz_login', { p_supplier_id: supplierId, p_password: password }).then(function (r) {
        if (r && r.ok) {
          session = { id: r.id, name: r.name };
          saveSession(session);
        }
        return r;
      });
    },

    /* 供应商列表（登录页下拉） */
    listSuppliers: function () {
      if (!init()) return Promise.resolve([]);
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

    /* ---- RPC 动作 ---- */
    acceptOrder: function (id) { return rpc('biz_supplier_action', { p_order_id: id, p_action: 'accept', p_payload: {} }).then(done); },
    makeOrder:   function (id) { return rpc('biz_supplier_action', { p_order_id: id, p_action: 'make',   p_payload: {} }).then(done); },
    shipOrder:   function (id, company, no) {
      return rpc('biz_supplier_action', { p_order_id: id, p_action: 'ship',
        p_payload: { company: company || '', no: no || '' } }).then(done);
    },
    completeOrder: function (id) { return rpc('biz_supplier_action', { p_order_id: id, p_action: 'complete', p_payload: {} }).then(done); },
    saveSettings: function (supplierId, s) {
      return rpc('biz_save_settings', { p_supplier_id: supplierId, p_settings: s }).then(done);
    },
    withdraw: function (supplierId, amountFen) {
      return rpc('biz_withdraw', { p_supplier_id: supplierId, p_amount: amountFen }).then(done);
    },
    aftersaleAction: function (id, result) {
      return rpc('biz_aftersale_action', { p_aftersale_id: id, p_result: result || '' }).then(done);
    },
    reset: function () { return rpc('biz_reset').then(function () { refetch(); }); }
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

    /* 状态文案 / 徽章（供应端视角） */
    STATUS_TEXT: {
      pending: '待支付', paid: '待接单', accepted: '已接单', making: '制作中',
      shipped: '已发货', done: '已完成', closed: '已关闭', aftersale: '售后中'
    },
    STATUS_PILL: {
      pending: 'pill-sun', paid: 'pill-danger', accepted: 'pill-grape', making: 'pill-brand',
      shipped: 'pill-sky', done: 'pill-mint', closed: 'pill-gray', aftersale: 'pill-danger'
    },
    AFTERSALE_KIND: { redo: '重做', reship: '补寄', refund: '退款' },
    statusPill: function (s) {
      return '<span class="pill ' + (this.STATUS_PILL[s] || 'pill-gray') + '">' +
        (this.STATUS_TEXT[s] || s) + '</span>';
    }
  };
})(window);
