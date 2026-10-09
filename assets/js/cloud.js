/* ============================================================
   用户端云端 SDK —— biz_ 表直读 + Realtime 订阅 + RPC 封装
   依赖：demo/vendor/supabase.min.js + demo/config.js（可缺省，缺省时降级本地）
   映射：biz_orders(分) → 用户页既有形状(元)，旧页面改动最小
   ============================================================ */
(function (global) {
  'use strict';

  var db = null, channel = null, listeners = [], fetchTimer = null, pollTimer = null, fetching = false;
  var state = { orders: [], items: [], tracks: [], aftersales: [] };
  var available = false;

  function cfgOk() {
    var c = global.SOD_CONFIG;
    return !!(c && c.SUPABASE_URL && c.SUPABASE_ANON_KEY && global.supabase);
  }
  function init() {
    if (db) return true;
    if (!cfgOk()) return false;
    db = global.supabase.createClient(global.SOD_CONFIG.SUPABASE_URL, global.SOD_CONFIG.SUPABASE_ANON_KEY);
    return true;
  }

  function fen2yuan(v) { return (v || 0) / 100; }

  /* snake_case 行 → 用户页形状（含 items / logistics 组装） */
  function mapOrder(r) {
    var items = state.items.filter(function (it) { return it.order_id === r.id; });
    var tracks = state.tracks.filter(function (t) { return t.order_id === r.id; })
      .sort(function (a, b) { return +new Date(a.created_at) - +new Date(b.created_at); });
    return {
      id: r.id,
      userId: r.user_id,
      createdAt: +new Date(r.created_at),
      status: r.status,
      items: items.map(function (it) {
        return { name: it.name, thumb: it.thumb, copies: it.copies };
      }),
      n: r.n,
      amount: fen2yuan(r.amount),
      subtotal: fen2yuan(r.subtotal),
      shipping: fen2yuan(r.shipping),
      couponType: r.coupon_type,
      couponDiscount: fen2yuan(r.discount),
      address: r.address || {},
      note: r.note,
      paidAt: r.paid_at ? +new Date(r.paid_at) : null,
      acceptedAt: r.accepted_at ? +new Date(r.accepted_at) : null,
      madeAt: r.made_at ? +new Date(r.made_at) : null,
      shippedAt: r.shipped_at ? +new Date(r.shipped_at) : null,
      doneAt: r.done_at ? +new Date(r.done_at) : null,
      closedAt: r.closed_at ? +new Date(r.closed_at) : null,
      logistics: (r.ship_no && tracks.length) ? {
        company: r.ship_company, no: r.ship_no,
        tracks: tracks.map(function (t) {
          return { t: +new Date(t.created_at), d: t.d };
        })
      } : null,
      isCloud: true
    };
  }

  function rpc(name, args) {
    if (!init()) return Promise.reject(new Error('云端未配置'));
    return db.rpc(name, args || {}).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function fetchState() {
    if (fetching || !db) return;
    fetching = true;
    Promise.all([
      db.from('biz_orders').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('biz_order_items').select('*').limit(600),
      db.from('biz_logistics_tracks').select('*').order('created_at', { ascending: true }).limit(1000)
    ]).then(function (rs) {
      rs.forEach(function (r) { if (r.error) throw r.error; });
      state = { orders: rs[0].data || [], items: rs[1].data || [], tracks: rs[2].data || [] };
      available = true;
      listeners.forEach(function (fn) { try { fn(Cloud.list()); } catch (e) { console.error(e); } });
    }).catch(function (e) {
      console.error('cloud fetchState', e);
    }).finally(function () { fetching = false; });
  }
  function refetch() { clearTimeout(fetchTimer); fetchTimer = setTimeout(fetchState, 250); }

  var Cloud = {
    /** 云端是否可用（未配置/未加载时页面走本地降级） */
    ok: function () { return init(); },

    /** 订阅云端订单变更（Realtime + 5s 轮询兜底），回调收到映射后的订单数组 */
    subscribe: function (fn) {
      if (!init()) return { unsubscribe: function () {} };
      listeners.push(fn);
      if (!channel) {
        channel = db.channel('sod-user-biz')
          .on('postgres_changes', { event: '*', schema: 'public' }, refetch)
          .subscribe(function (st) { if (st === 'SUBSCRIBED') refetch(); });
      }
      if (!pollTimer) pollTimer = setInterval(fetchState, 5000);
      fetchState();
      return { unsubscribe: function () { listeners = listeners.filter(function (f) { return f !== fn; }); } };
    },

    /** 全部云端订单（已映射，新→旧） */
    list: function () {
      return state.orders.map(mapOrder).sort(function (a, b) { return b.createdAt - a.createdAt; });
    },

    /** 当前用户的云端订单 */
    mine: function (userId) {
      if (!userId) return [];
      return this.list().filter(function (o) { return o.userId === userId; });
    },

    /** 单个订单（映射后含 items / logistics） */
    get: function (id) {
      var r = null;
      for (var i = 0; i < state.orders.length; i++) if (state.orders[i].id === id) { r = state.orders[i]; break; }
      return r ? mapOrder(r) : null;
    },

    /** 结算下单（服务端权威计价 + 发号 + 按地址派单） */
    checkout: function (o) {
      return rpc('biz_checkout', {
        p_user_id: o.userId || '',
        p_items: o.items.map(function (it) {
          return { name: it.name, thumb: it.thumb || '', copies: it.copies };
        }),
        p_address: { name: o.address.name, phone: o.address.phone, region: o.address.region, detail: o.address.detail },
        p_coupon_type: o.couponType || null,
        p_note: o.note || '',
        p_amount_expect: Math.round((o.amountExpect || 0) * 100)
      }).then(function (r) {
        refetch();
        return r; /* {ok, id, amount} */
      });
    },

    /** 支付（pending → paid） */
    pay: function (id) {
      return rpc('biz_pay', { p_id: id }).then(function (r) { refetch(); return r; });
    },

    /** 用户动作：cancel 取消 / confirm 签收 */
    userAction: function (id, action) {
      return rpc('biz_user_action', { p_id: id, p_action: action }).then(function (r) { refetch(); return r; });
    },

    /** 提交售后（redo / reship / refund） */
    openAftersale: function (orderId, kind, reason) {
      return rpc('biz_open_aftersale', { p_order_id: orderId, p_kind: kind, p_reason: reason })
        .then(function (r) { refetch(); return r; });
    },

    /** 手动拉一次（进入页面时调用） */
    refresh: fetchState,

    _state: function () { return state; }
  };

  global.Cloud = Cloud;
})(window);
