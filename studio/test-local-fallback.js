/* T3 验证脚本，非运行时依赖 —— 任何页面均不引用本文件，仅手动执行用于回归自检
   用法：node test-local-fallback.js
   内容：node 模拟浏览器环境，驱动 biz-sdk.js 本地回退全链路
   覆盖：登录 → subscribe 本地首帧 → 自提单全流程（含错码拦截）→ 快递单回归 → 守卫语义 */
'use strict';
var fs = require('fs');
var path = require('path');

var root = __dirname;
var storeKey = 'sod.v1';
var memStorage = {};

/* ---- 模拟浏览器环境 ---- */
function makeEnv() {
  var storageHandlers = [];
  var env = {
    console: console,
    localStorage: {
      getItem: function (k) { return (k in memStorage) ? memStorage[k] : null; },
      setItem: function (k, v) { memStorage[k] = String(v); },
      removeItem: function (k) { delete memStorage[k]; }
    },
    window: null,
    document: { addEventListener: function () {}, getElementById: function () { return null; }, body: null },
    location: { search: '', href: '', replace: function () {} },
    navigator: {},
    URLSearchParams: function () { this.get = function () { return null; }; },
    addEventListener: function (type, fn) { if (type === 'storage') storageHandlers.push(fn); },
    dispatchStorage: function (key) { storageHandlers.forEach(function (h) { h({ key: key }); }); }
  };
  env.window = env;
  global.window = env.window;
  global.localStorage = env.localStorage;
  global.document = env.document;
  global.location = env.location;
  return env;
}

/* ---- 载入 biz-sdk（可重复重载，重置模块级缓存） ---- */
var sdkCode = fs.readFileSync(path.join(root, 'biz-sdk.js'), 'utf8');
var win, Biz, BizUtil;
function reloadSdk() {
  win = makeEnv().window;
  var fn = new Function('window', 'localStorage', 'document', 'location', 'navigator',
    'URLSearchParams', 'console', sdkCode);
  fn(win, win.localStorage, win.document, win.location, win.navigator,
    win.URLSearchParams, console);
  Biz = win.Biz; BizUtil = win.BizUtil;
}

var pass = 0, fail = 0;
function T(name, cond) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---- 准备用户端本地数据（模拟 T2 checkout 本地下单） ---- */
function seedUserStore(pickup) {
  memStorage = {};
  var order = {
    id: 'SO20261012001',
    createdAt: Date.now() - 3600e3,
    status: 'paid',
    paidAt: Date.now() - 3000e3,
    items: [{ name: '毛孩子贴纸', thumb: '', copies: 2 }],
    n: 2,
    amount: 19.8, subtotal: 19.8, shipping: 0,
    couponType: null, couponDiscount: 0,
    address: pickup
      ? { name: '林小鹿', phone: '13800008888', region: '', detail: '' }
      : { name: '林小鹿', phone: '13800008888', region: '上海市 徐汇区', detail: '漕溪北路 100 号' },
    deliveryMethod: pickup ? 'pickup' : 'express',
    pickupCode: pickup ? '5883' : undefined,
    readyAt: pickup ? Date.now() + 7200e3 : undefined,
    logistics: null
  };
  memStorage[storeKey] = JSON.stringify({
    user: { nickname: '林小鹿', phone: '13800008888' },
    addresses: [], works: [], bag: [], coupons: [], orders: [order], seq: 1
  });
}

async function main() {
  /* ================= 场景 A：自提单全流程 ================= */
  section('A. pickup order full flow (local fallback)');
  seedUserStore(true);
  reloadSdk();

  var frame = null;
  Biz.subscribe(function (s) { frame = s; });
  T('A1 subscribe local first frame: order visible',
    frame && frame.orders.length === 1 && frame.orders[0].id === 'SO20261012001');

  var o = Biz.getOrder('SO20261012001');
  T('A2 mapOrder new fields: deliveryMethod/pickupCode/readyAt',
    o.deliveryMethod === 'pickup' && o.pickupCode === '5883' && !!o.readyAt);
  T('A3 yuan-to-fen mapping (amount=1980)', o.amount === 1980 && o.subtotal === 1980);

  var r = await Biz.login('SUP-SH01', '123456');
  T('A4 local login correct password', r && r.ok === true && r.name === '上海徐汇工作室');
  r = await Biz.login('SUP-SH01', 'wrong');
  T('A5 local login wrong password rejected', r && r.ok === false);

  r = await Biz.acceptOrder('SO20261012001');
  T('A6 accept: paid -> accepted', r && r.ok && r.status === 'accepted');

  r = await Biz.readyOrder('SO20261012001');
  T('A7 ready guard: rejected at accepted', r && r.ok === false);

  r = await Biz.shipOrder('SO20261012001', '中通快递', '');
  T('A8 ship guard: pickup order ship rejected', r && r.ok === false);

  r = await Biz.makeOrder('SO20261012001');
  T('A9 make: accepted -> making', r && r.ok && r.status === 'making');

  r = await Biz.handoverOrder('SO20261012001', '5883');
  T('A10 handover guard: rejected at making', r && r.ok === false && /可取/.test(r.msg || ''));

  r = await Biz.readyOrder('SO20261012001');
  T('A11 ready: making -> shipped (ready for pickup)', r && r.ok && r.status === 'shipped');

  r = await Biz.handoverOrder('SO20261012001', '9999');
  T('A12 handover wrong code rejected', r && r.ok === false && r.msg === '取货码不正确');

  var balBefore = Biz.getSupplier('SUP-SH01').balance;
  r = await Biz.handoverOrder('SO20261012001', '5883');
  var balAfter = Biz.getSupplier('SUP-SH01').balance;
  T('A13 handover correct code: shipped -> done + balance settled',
    r && r.ok && r.status === 'done' && (balAfter - balBefore) === 1980);

  T('A14 pickup-code algo matches SQL (SO20261012001 -> 5883)', (function () {
    var s = '20261012001', h = 5381;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000000007;
    return ('0000' + (h % 10000)).slice(-4) === '5883';
  })());

  /* ================= 场景 B：快递单回归 ================= */
  section('B. express order regression (local fallback)');
  seedUserStore(false);
  reloadSdk();
  await Biz.login('SUP-SH01', '123456');
  Biz.subscribe(function () {});

  o = Biz.getOrder('SO20261012001');
  T('B1 express deliveryMethod fallback', (o.deliveryMethod || 'express') === 'express');

  r = await Biz.acceptOrder('SO20261012001');
  var r2 = await Biz.makeOrder('SO20261012001');
  T('B2 accept -> make ok', r && r.ok && r2 && r2.ok);

  r = await Biz.shipOrder('SO20261012001', '顺丰速运', 'SF12345678');
  var us = JSON.parse(memStorage[storeKey]);
  T('B3 ship: making -> shipped + logistics written',
    r && r.ok && r.status === 'shipped' && us.orders[0].logistics &&
    us.orders[0].logistics.company === '顺丰速运' &&
    us.orders[0].logistics.no === 'SF12345678' &&
    /商家已发货/.test(us.orders[0].logistics.tracks[0].d));

  r = await Biz.readyOrder('SO20261012001');
  T('B4 express order ready rejected (pickup only)', r && r.ok === false);

  r = await Biz.handoverOrder('SO20261012001', '1234');
  T('B5 express order handover rejected (pickup only)', r && r.ok === false);

  balBefore = Biz.getSupplier('SUP-SH01').balance;
  r = await Biz.completeOrder('SO20261012001');
  balAfter = Biz.getSupplier('SUP-SH01').balance;
  T('B6 complete: shipped -> done + balance settled',
    r && r.ok && r.status === 'done' && (balAfter - balBefore) === 1980);

  /* ================= 场景 C：旧订单兼容 + 双态 pill ================= */
  section('C. legacy order compat / dual-state pills');
  seedUserStore(true);
  reloadSdk();
  await Biz.login('SUP-SH01', '123456');

  us = JSON.parse(memStorage[storeKey]);
  delete us.orders[0].deliveryMethod;
  delete us.orders[0].pickupCode;
  delete us.orders[0].readyAt;
  memStorage[storeKey] = JSON.stringify(us);

  frame = null;
  Biz.subscribe(function (s) { frame = s; });
  T('C1 legacy order (no deliveryMethod): fallback express',
    frame.orders[0].deliveryMethod === 'express');

  T('C2 statusPill dual-state: shipped+pickup shows dai-zi-ti, express shows fa-huo',
    BizUtil.statusPill('shipped', 'pickup').indexOf('待自提') >= 0 &&
    BizUtil.statusPill('shipped', 'express').indexOf('已发货') >= 0);

  T('C3 deliveryPill: pickup/express/fallback',
    BizUtil.deliveryPill('pickup').indexOf('自提') >= 0 &&
    BizUtil.deliveryPill('express').indexOf('快递') >= 0 &&
    BizUtil.deliveryPill(undefined).indexOf('快递') >= 0);

  T('C4 local seed suppliers match SQL seed',
    frame.suppliers.length === 2 && frame.suppliers[0].id === 'SUP-SH01' &&
    frame.suppliers[0].isDefault === true);

  /* ================= 场景 D：取货码缺失补算 ================= */
  section('D. pickup-code backfill when missing');
  seedUserStore(true);
  us = JSON.parse(memStorage[storeKey]);
  delete us.orders[0].pickupCode;
  memStorage[storeKey] = JSON.stringify(us);
  reloadSdk();
  await Biz.login('SUP-SH01', '123456');
  Biz.subscribe(function () {});

  o = Biz.getOrder('SO20261012001');
  T('D1 pickupCode backfilled by order-id hash (=5883)', o.pickupCode === '5883');

  /* ================= 场景 E：跨页签 storage 联动 ================= */
  section('E. storage event cross-tab sync');
  seedUserStore(true);
  reloadSdk();
  await Biz.login('SUP-SH01', '123456');
  var notified = 0;
  Biz.subscribe(function () { notified++; });
  var base = notified;

  /* 模拟另一页签写 sod.v1 后触发的 storage 事件 */
  us = JSON.parse(memStorage[storeKey]);
  us.orders[0].status = 'accepted';
  memStorage[storeKey] = JSON.stringify(us);
  win.dispatchStorage(storeKey);

  T('E1 storage event triggers localNotify', notified > base);

  console.log('\nRESULT: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
