/* ============================================================
   数据层 —— localStorage 持久化 + Mock 种子数据
   Supabase 预留位：把 load/save 换成远程读写即可，对外 API 不变
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'sod.v1';

  /* ---------- 画布常量 ----------
     一张 = 一张 7 寸相纸（7:5）。安全区规则待 S1 PRD，MVP 取经验值占位 */
  var CANVAS = { w: 1400, h: 1000 };
  var SAFE_MARGIN = 48; // 待 S1 精确边距

  /* ---------- 通用素材库（无 IP，内联 SVG） ---------- */
  var F = '__C__'; // 颜色占位
  function svg(inner) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + inner + '</svg>';
  }
  function uri(s) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); }

  var SHAPES = [
    { id: 'heart',   name: '爱心',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M50 88C50 88 12 63 12 38 12 24 22 15 34 15c8 0 13 5 16 10 3-5 8-10 16-10 12 0 22 9 22 24 0 25-38 49-38 49Z"/>') },
    { id: 'star',    name: '星星',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M50 8l12 30 32 2-25 20 8 31-27-17-27 17 8-31-25-20 32-2Z"/>') },
    { id: 'sparkle', name: '闪光',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M50 6l7 33 37 11-37 11-7 33-7-33-37-11 37-11Z"/>') },
    { id: 'cloud',   name: '云朵',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M28 76c-11 0-19-8-19-18s8-18 18-18c2-12 12-20 24-20 11 0 20 7 23 17 1 0 2 0 3 0 10 0 18 7 18 17s-9 22-19 22H28Z"/>') },
    { id: 'bubble',  name: '气泡',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M50 14c22 0 40 14 40 31S72 76 50 76c-4 0-8 0-12-2l-16 10 4-15C18 62 10 53 10 45s18-31 40-31Z"/><circle cx="34" cy="45" r="5" fill="#fff"/><circle cx="50" cy="45" r="5" fill="#fff"/><circle cx="66" cy="45" r="5" fill="#fff"/>') },
    { id: 'paw',     name: '猫爪',   cat: '装饰', svg: svg('<g fill="' + F + '"><ellipse cx="50" cy="66" rx="22" ry="19"/><circle cx="26" cy="40" r="10"/><circle cx="41" cy="30" r="10"/><circle cx="59" cy="30" r="10"/><circle cx="74" cy="40" r="10"/></g>') },
    { id: 'crown',   name: '皇冠',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M14 76 8 26l20 15L50 14l22 27 20-15-6 50Z"/>') },
    { id: 'note',    name: '音符',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M42 74V26l38-8v48a15 15 0 1 1-8-13V32l-22 5v37a15 15 0 1 1-8-13Z"/>') },
    { id: 'flower',  name: '小花',   cat: '装饰', svg: svg('<g fill="' + F + '"><circle cx="50" cy="24" r="15"/><circle cx="50" cy="60" r="15"/><circle cx="32" cy="42" r="15"/><circle cx="68" cy="42" r="15"/></g><circle cx="50" cy="42" r="11" fill="#fff"/>') },
    { id: 'leaf',    name: '叶子',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M84 16C48 12 20 30 20 56c0 12 6 22 15 28C35 50 56 32 84 28c-14 12-27 28-34 46 20 2 40-16 44-40 3-6 0-12-10-18Z"/>') },
    { id: 'rainbow', name: '彩虹',   cat: '装饰', svg: svg('<g fill="none" stroke="' + F + '" stroke-width="8" stroke-linecap="round"><path d="M14 82a36 36 0 0 1 72 0"/><path d="M26 82a24 24 0 0 1 48 0"/></g>') },
    { id: 'bolt',    name: '闪电',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M58 6 20 56h22l-8 38 40-54H50Z"/>') },
    { id: 'drop',    name: '水滴',   cat: '装饰', svg: svg('<path fill="' + F + '" d="M50 10c14 20 24 32 24 44a24 24 0 0 1-48 0c0-12 10-24 24-44Z"/>') },
    { id: 'cake',    name: '蛋糕',   cat: '节庆', svg: svg('<g fill="' + F + '"><rect x="18" y="52" width="64" height="32" rx="8"/><rect x="24" y="40" width="52" height="14" rx="7"/><rect x="42" y="22" width="16" height="20" rx="4"/></g>') },
    { id: 'gift',    name: '礼物',   cat: '节庆', svg: svg('<g fill="' + F + '"><rect x="16" y="46" width="68" height="40" rx="6"/><rect x="12" y="34" width="76" height="14" rx="7"/><rect x="44" y="34" width="12" height="52"/></g>') },
    { id: 'confetti',name: '礼花',   cat: '节庆', svg: svg('<g fill="' + F + '"><circle cx="20" cy="24" r="6"/><circle cx="46" cy="14" r="5"/><circle cx="72" cy="26" r="7"/><rect x="16" y="52" width="14" height="8" rx="4" transform="rotate(-24 23 56)"/><rect x="52" y="44" width="28" height="8" rx="4" transform="rotate(18 66 48)"/><path d="M22 70l4 16 6-14Z"/><path d="M62 68l4 18 6-16Z"/></g>') },
    { id: 'rrect',   name: '圆角框', cat: '基础', svg: svg('<rect x="8" y="24" width="84" height="52" rx="14" fill="none" stroke="' + F + '" stroke-width="10"/>') },
    { id: 'circle',  name: '圆形',   cat: '基础', svg: svg('<circle cx="50" cy="50" r="40" fill="' + F + '"/>') },
    { id: 'square',  name: '方形',   cat: '基础', svg: svg('<rect x="12" y="12" width="76" height="76" rx="6" fill="' + F + '"/>') },
    { id: 'hexagon', name: '六边形', cat: '基础', svg: svg('<path fill="' + F + '" d="M50 6l38 22v44L50 94 12 72V28Z"/>') },
    { id: 'ticket',  name: '票根',   cat: '基础', svg: svg('<rect x="8" y="30" width="84" height="40" rx="10" fill="' + F + '"/><circle cx="8" cy="50" r="8" fill="#fff"/><circle cx="92" cy="50" r="8" fill="#fff"/>') },
    { id: 'tape',    name: '胶带',   cat: '基础', svg: svg('<path fill="' + F + '" d="M6 34l70-16 12 32-70 16Z"/>') },
    { id: 'tag',     name: '标签',   cat: '基础', svg: svg('<path fill="' + F + '" d="M18 14h44l22 22-44 44L18 58Z"/><circle cx="62" cy="30" r="7" fill="#fff"/>') },
    { id: 'arrow',   name: '箭头',   cat: '基础', svg: svg('<path fill="' + F + '" d="M22 36h34V18l32 32-32 32V64H22Z"/>') }
  ];

  /* ---------- 起点模板：空白布局框架 ---------- */
  var TEMPLATES = [
    { id: 't-single', name: '单图大图', desc: '一个主图位', frames: [{ x: 0.5, y: 0.5, w: 0.66, h: 0.7 }] },
    { id: 't-grid9',  name: '九宫格',   desc: '3 × 3 均分',  grid: { cols: 3, rows: 3, pad: 0.08, gap: 0.03 } },
    { id: 't-mix',    name: '混排',     desc: '一大四小',    frames: [
        { x: 0.36, y: 0.5, w: 0.42, h: 0.66 }, { x: 0.74, y: 0.22, w: 0.24, h: 0.28 },
        { x: 0.74, y: 0.5, w: 0.24, h: 0.28 }, { x: 0.74, y: 0.78, w: 0.24, h: 0.28 }
      ] },
    { id: 't-strip',  name: '四连排',   desc: '一行四个',    grid: { cols: 4, rows: 1, pad: 0.08, gap: 0.03 } }
  ];

  /* ---------- 存储读写（file:// 降级到内存） ---------- */
  var memoryStore = null;
  function rawGet() {
    try {
      var v = localStorage.getItem(KEY);
      return v ? JSON.parse(v) : null;
    } catch (e) { return memoryStore; }
  }
  function rawSet(obj) {
    var str;
    try { str = JSON.stringify(obj); } catch (e) { return false; }
    try { localStorage.setItem(KEY, str); return true; }
    catch (e) {
      // 配额溢出：裁掉草稿/历史里最旧的缩略图后重试
      try {
        trimThumbs(obj);
        localStorage.setItem(KEY, JSON.stringify(obj));
        return true;
      } catch (e2) { memoryStore = obj; return false; }
    }
  }
  function trimThumbs(obj) {
    var all = (obj.works || []).slice().sort(function (a, b) { return a.updatedAt - b.updatedAt; });
    for (var i = 0; i < all.length && i < 6; i++) all[i].thumb = '';
  }

  /* ---------- 工具 ---------- */
  var seq = 0;
  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6); }
  function dayOffset(days, h, m) {
    var d = new Date(); d.setDate(d.getDate() + days);
    d.setHours(h || 10, m || 0, 0, 0); return d.getTime();
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ago(ts) {
    var diff = Date.now() - ts;
    var m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60); if (h < 24) return h + ' 小时前';
    var d = Math.floor(h / 24); if (d < 30) return d + ' 天前';
    return fmtTime(ts).slice(0, 10);
  }

  /* ---------- Mock 场景（用于「我的作品」示例） ---------- */
  function obj(o) {
    return Object.assign({
      id: uid('o'), type: 'shape', x: CANVAS.w / 2, y: CANVAS.h / 2,
      w: 300, h: 300, sx: 1, sy: 1, rot: 0,
      border: { on: true, w: 14, color: '#FFFFFF' },
      flipX: false, flipY: false, opacity: 1
    }, o);
  }
  function shape(id, color, x, y, size, rot) {
    return obj({ type: 'shape', shapeId: id, color: color, src: uri(shapeById(id).svg.replace(F, color)), x: x, y: y, w: size, h: size, rot: rot || 0 });
  }
  function shapeById(id) {
    for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].id === id) return SHAPES[i];
    return SHAPES[0];
  }

  function sceneA() { // 宠物系
    return [
      shape('circle', '#FFCFA8', 400, 380, 300),
      shape('paw', '#FF7A45', 700, 420, 320, -0.14),
      shape('heart', '#F5A3A3', 1050, 300, 190, 0.24),
      shape('sparkle', '#EFB33F', 980, 640, 220, 0.1),
      obj({ type: 'text', text: '毛孩子', x: 700, y: 800, color: '#7A4A2B', size: 96, weight: 800, family: 'sans', align: 'center' })
    ];
  }
  function sceneB() { // 谷子 / 痛包系
    return [
      shape('rrect', '#FFD9E8', 700, 480, 820),
      shape('star', '#9C7CE0', 420, 340, 240, -0.2),
      shape('crown', '#EFB33F', 700, 300, 230, 0.08),
      shape('sparkle', '#FF7A45', 1010, 620, 240, -0.12),
      shape('note', '#5B9FD6', 380, 700, 200, 0.16),
      obj({ type: 'text', text: '推し活', x: 700, y: 800, color: '#6D49BE', size: 96, weight: 800, family: 'sans', align: 'center' })
    ];
  }
  function sceneC() { // 草稿（未完成）
    return [
      shape('cloud', '#CFE6F5', 520, 420, 340),
      shape('heart', '#FF9D9D', 880, 520, 280, 0.18)
    ];
  }

  function mockThumb(colors, glyph) {
    return uri(svg(
      '<rect width="100" height="100" rx="10" fill="' + colors[0] + '"/>' +
      '<circle cx="34" cy="40" r="20" fill="' + colors[1] + '"/>' +
      '<circle cx="66" cy="58" r="24" fill="' + colors[2] + '"/>' +
      '<text x="50" y="88" text-anchor="middle" font-size="20" font-weight="800" fill="' + colors[3] + '" font-family="sans-serif">' + glyph + '</text>'
    ));
  }

  /* ---------- 种子数据 ---------- */
  function seed() {
    var addr = {
      id: uid('addr'), name: '林小鹿', phone: '13800008888',
      region: '上海市 徐汇区', detail: '漕溪北路 100 号 3 单元 501', isDefault: true
    };
    return {
      user: null,
      addresses: [addr],
      works: [
        { id: uid('w'), name: '毛孩子贴纸', kind: 'history', thumb: mockThumb(['#FFEBD8', '#FFB98A', '#FF7A45', '#7A4A2B'], '1'), objects: sceneA(), updatedAt: dayOffset(-3, 20, 12) },
        { id: uid('w'), name: '痛包小卡', kind: 'history', thumb: mockThumb(['#F6E9FA', '#C9A9F0', '#9C7CE0', '#5B3AA0'], '2'), objects: sceneB(), updatedAt: dayOffset(-9, 15, 40) },
        { id: uid('w'), name: '未命名草稿', kind: 'draft', thumb: mockThumb(['#E4F0F8', '#A9CDE8', '#5B9FD6', '#2F6E9F'], '3'), objects: sceneC(), updatedAt: dayOffset(-1, 22, 8) }
      ],
      bag: [],
      coupons: [
        { id: uid('cp'), type: 'general',  amount: 5, source: '邀请 3 位好友', gotAt: dayOffset(-6), expireAt: dayOffset(24), used: false },
        { id: uid('cp'), type: 'general',  amount: 5, source: '邀请 3 位好友', gotAt: dayOffset(-2), expireAt: dayOffset(28), used: false },
        { id: uid('cp'), type: 'freeship', amount: 5, source: '新用户注册礼', gotAt: dayOffset(-12), expireAt: dayOffset(18), used: false }
      ],
      orders: [
        { id: 'SO20260915001', createdAt: dayOffset(-2, 11, 20), status: 'making',
          items: [{ name: '毛孩子贴纸', thumb: mockThumb(['#FFEBD8', '#FFB98A', '#FF7A45', '#7A4A2B'], '1'), copies: 2 }],
          n: 2, amount: 19.80, couponType: null, address: clone(addr),
          logistics: null },
        { id: 'SO20260910002', createdAt: dayOffset(-6, 9, 5), status: 'shipped',
          items: [{ name: '痛包小卡', thumb: mockThumb(['#F6E9FA', '#C9A9F0', '#9C7CE0', '#5B3AA0'], '2'), copies: 3 }],
          n: 3, amount: 27.70, couponType: 'general', couponDiscount: 5, address: clone(addr),
          logistics: { company: '中通快递', no: 'ZT7720091834561', tracks: [
            { t: dayOffset(-1, 15, 22), d: '【上海市】快件已到达 徐汇分部，正在派送' },
            { t: dayOffset(-2, 6, 40), d: '【上海市】快件已从 上海转运中心 发出' },
            { t: dayOffset(-2, 2, 15), d: '【上海】商家已发货，等待揽收' }
          ] } },
        { id: 'SO20260918003', createdAt: dayOffset(0, -3, 0), status: 'pending',
          items: [{ name: '未命名草稿', thumb: mockThumb(['#E4F0F8', '#A9CDE8', '#5B9FD6', '#2F6E9F'], '3'), copies: 1 }],
          n: 1, amount: 14.90, couponType: null, address: clone(addr), logistics: null },
        { id: 'SO20260825004', createdAt: dayOffset(-22, 14, 30), status: 'closed',
          items: [{ name: '旅行纪念贴', thumb: mockThumb(['#E6F4EE', '#8FD3BC', '#45B492', '#2F7E65'], '4'), copies: 1 }],
          n: 1, amount: 14.90, couponType: null, address: clone(addr), logistics: null }
      ],
      seq: 1
    };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- State ---------- */
  var state = rawGet() || seed();
  function save() { rawSet(state); }
  function resetAll() { state = seed(); save(); }

  /* ---------- Auth ---------- */
  var auth = {
    login: function (nickname, phone) {
      state.user = { nickname: nickname, phone: phone, avatarText: (nickname || 'S').slice(0, 1) };
      // 首次注册发免运费券
      if (!state.user._regCouponGiven) {
        state.coupons.unshift({
          id: uid('cp'), type: 'freeship', amount: 5,
          source: '新用户注册礼', gotAt: Date.now(), expireAt: Date.now() + 30 * 864e5, used: false
        });
        state.user._regCouponGiven = true;
      }
      save();
      return state.user;
    },
    logout: function () { state.user = null; save(); },
    user: function () { return state.user; },
    isLogin: function () { return !!state.user; }
  };

  /* ---------- 地址 ---------- */
  var addresses = {
    all: function () { return state.addresses; },
    get: function (id) { for (var i = 0; i < state.addresses.length; i++) if (state.addresses[i].id === id) return state.addresses[i]; return null; },
    defaultAddr: function () {
      var list = state.addresses;
      for (var i = 0; i < list.length; i++) if (list[i].isDefault) return list[i];
      return list[0] || null;
    },
    upsert: function (a) {
      if (a.id && this.get(a.id)) {
        var old = this.get(a.id); Object.assign(old, a);
      } else {
        a.id = a.id || uid('addr'); state.addresses.push(a);
      }
      if (a.isDefault) {
        state.addresses.forEach(function (x) { if (x.id !== a.id) x.isDefault = false; });
      }
      if (state.addresses.length && !state.addresses.some(function (x) { return x.isDefault; })) {
        state.addresses[0].isDefault = true;
      }
      save(); return a;
    },
    remove: function (id) {
      state.addresses = state.addresses.filter(function (x) { return x.id !== id; });
      if (state.addresses.length && !state.addresses.some(function (x) { return x.isDefault; })) state.addresses[0].isDefault = true;
      save();
    }
  };

  /* ---------- 作品（草稿 / 历史） ---------- */
  var works = {
    drafts: function () { return state.works.filter(function (w) { return w.kind === 'draft'; }); },
    history: function () { return state.works.filter(function (w) { return w.kind === 'history'; }); },
    get: function (id) { for (var i = 0; i < state.works.length; i++) if (state.works[i].id === id) return state.works[i]; return null; },
    upsert: function (w) {
      var old = this.get(w.id);
      if (old) Object.assign(old, w);
      else state.works.unshift(w);
      old = old || state.works[0];
      old.updatedAt = Date.now();
      save();
      return old;
    },
    remove: function (id) {
      state.works = state.works.filter(function (w) { return w.id !== id; });
      bag.remove(id);
      save();
    }
  };

  /* ---------- 结算袋 ---------- */
  var bag = {
    all: function () { return state.bag; },
    count: function () { return state.bag.reduce(function (s, b) { return s + b.copies; }, 0); },
    kinds: function () { return state.bag.length; },
    has: function (workId) { return state.bag.some(function (b) { return b.workId === workId; }); },
    add: function (workId, copies) {
      var found = null;
      for (var i = 0; i < state.bag.length; i++) if (state.bag[i].workId === workId) found = state.bag[i];
      if (found) found.copies += (copies || 1);
      else {
        var w = works.get(workId);
        state.bag.push({
          workId: workId, name: (w && w.name) || '未命名', thumb: (w && w.thumb) || '',
          copies: copies || 1, objects: w ? clone(w.objects) : []
        });
      }
      save();
    },
    setCopies: function (workId, n) {
      var item = null;
      for (var i = 0; i < state.bag.length; i++) if (state.bag[i].workId === workId) item = state.bag[i];
      if (item) { item.copies = Math.max(1, n); save(); }
    },
    remove: function (workId) {
      state.bag = state.bag.filter(function (b) { return b.workId !== workId; }); save();
    },
    clear: function () { state.bag = []; save(); }
  };

  /* ---------- 券 ---------- */
  var coupons = {
    available: function () {
      var now = Date.now();
      return state.coupons.filter(function (c) { return !c.used && c.expireAt > now; });
    },
    hasType: function (t) { return this.available().some(function (c) { return c.type === t; }); },
    consume: function (id) {
      for (var i = 0; i < state.coupons.length; i++) if (state.coupons[i].id === id) state.coupons[i].used = true;
      save();
    }
  };

  /* ---------- 订单 ---------- */
  function nextOrderNo() {
    var d = new Date(), s = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    var n = (state.orders.length + 1 + '').padStart(3, '0');
    return 'SO' + s + n;
  }
  var STATUS_TEXT = { pending: '待支付', making: '制作中', shipped: '已发货', done: '已完成', closed: '已关闭' };
  var STATUS_PILL = { pending: 'pill-sun', making: 'pill-brand', shipped: 'pill-sky', done: 'pill-mint', closed: 'pill-gray' };

  var orders = {
    all: function () { return state.orders.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }); },
    get: function (id) { for (var i = 0; i < state.orders.length; i++) if (state.orders[i].id === id) return state.orders[i]; return null; },
    create: function (payload) {
      var o = Object.assign({
        id: nextOrderNo(), createdAt: Date.now(), status: 'pending', logistics: null
      }, payload);
      state.orders.unshift(o);
      save();
      return o;
    },
    setStatus: function (id, s) {
      var o = this.get(id); if (o) { o.status = s; save(); }
    },
    pay: function (id) {
      var o = this.get(id); if (o && o.status === 'pending') { o.status = 'making'; o.paidAt = Date.now(); save(); }
      return o;
    }
  };

  /* ---------- 导出 ---------- */
  global.Store = {
    CANVAS: CANVAS, SAFE_MARGIN: SAFE_MARGIN,
    SHAPES: SHAPES, TEMPLATES: TEMPLATES,
    STATUS_TEXT: STATUS_TEXT, STATUS_PILL: STATUS_PILL,
    _state: function () { return state; },
    save: save, reset: resetAll,
    auth: auth, addresses: addresses, works: works, bag: bag,
    coupons: coupons, orders: orders,
    assets: {
      shapeById: shapeById,
      /** 生成指定颜色的素材 dataURL */
      shapeURI: function (id, color) { return uri(shapeById(id).svg.replace(F, color || '#FF7A45')); },
      svgURI: uri
    },
    util: { uid: uid, fmtTime: fmtTime, ago: ago, clone: clone, dayOffset: dayOffset }
  };
})(window);
