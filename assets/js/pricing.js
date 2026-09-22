/* ============================================================
   计价引擎 —— 唯一真源
   规则直引 SOD.md §计价规则 / §优惠券 / §凑单与防流失
   累进阶梯：第 1–2 张 9.9 ｜ 第 3–4 张 7.9 ｜ 第 5 张起 5.9
   运费：N = 1 收 5 元；N ≥ 2 包邮
   ============================================================ */
(function (global) {
  'use strict';

  // ---- 阶梯定义（每张只作用于该张，不退前面差价）----
  var TIERS = [
    { from: 1, to: 2,       price: 9.9 },
    { from: 3, to: 4,       price: 7.9 },
    { from: 5, to: Infinity, price: 5.9 }
  ];

  var SHIPPING_FEE = 5;   // N = 1 运费
  var FREE_FROM    = 2;   // N ≥ 2 包邮

  var COUPON_FREESHIP = 'freeship'; // 免运费券：面额 5，仅 N = 1
  var COUPON_GENERAL  = 'general';  // 通用券：面额 5，任意订单，单笔限 1 张
  var COUPON_AMOUNT   = 5;

  function priceOfNth(n) {
    for (var i = 0; i < TIERS.length; i++) {
      if (n >= TIERS[i].from && n <= TIERS[i].to) return TIERS[i].price;
    }
    return TIERS[TIERS.length - 1].price;
  }

  function shippingOf(n) {
    return n >= FREE_FROM ? 0 : SHIPPING_FEE;
  }

  /** 商品小计（不含运费） */
  function subtotal(n) {
    var sum = 0;
    for (var i = 1; i <= n; i++) sum += priceOfNth(i);
    return round2(sum);
  }

  /**
   * 完整计价明细
   * @param {number} n 本次结算总张数
   * @param {null|Object} coupon {type:'freeship'|'general'}
   */
  function quote(n, coupon) {
    n = Math.max(0, n | 0);
    var items = [];
    for (var i = 1; i <= n; i++) items.push({ nth: i, price: priceOfNth(i) });

    var sub = round2(subtotal(n));
    var ship = shippingOf(n);
    var lines = [];
    var discount = 0;

    if (coupon && isValid(coupon, n)) {
      if (coupon.type === COUPON_FREESHIP) {
        discount += ship;
        ship = 0;
        lines.push({ key: '免运费券', value: -round2(shippingOf(n)) });
      } else {
        discount += COUPON_AMOUNT;
        lines.push({ key: '通用券（邀请奖励）', value: -COUPON_AMOUNT });
      }
    }

    var total = round2(sub + ship - discount);
    if (total < 0) total = 0;

    return {
      n: n,
      items: items,
      subtotal: sub,
      shipping: ship,
      shippingOriginal: shippingOf(n),
      discount: round2(discount),
      lines: lines,
      total: total,
      perAvg: n > 0 ? round2(total / n) : 0,
      marginalNext: priceOfNth(n + 1),
      totalNext: round2(subtotal(n + 1) + shippingOf(n + 1))
    };
  }

  /** 券是否可作用于该订单 */
  function isValid(coupon, n) {
    if (!coupon) return false;
    if (coupon.type === COUPON_FREESHIP) return n === 1;
    if (coupon.type === COUPON_GENERAL) return n >= 1;
    return false;
  }

  /** 券不可用时给一句人话原因（用于券卡置灰提示） */
  function invalidReason(coupon, n) {
    if (!coupon) return '';
    if (coupon.type === COUPON_FREESHIP && n !== 1) {
      return '仅「单张订单」可用 —— 满 2 张已包邮';
    }
    return '';
  }

  /**
   * 凑单话术。返回 { text, delta, targetN, strength }
   * 按 SOD.md §凑单：最强 1→2（第二张 4.9），次强 4→5（第 5 张 5.9）
   */
  function hook(n) {
    if (n <= 0) return null;
    var delta = round2(quote(n + 1).total - quote(n).total);
    if (n === 1) {
      // 14.9 → 19.8：第 2 张起免运费，第二张实付只要 4.9
      return { targetN: 2, delta: delta, strength: 'strong',
               text: '第二张只要 4.9 元', sub: '再加一张就包邮了' };
    }
    if (n === 4) {
      // 35.6 → 41.5
      return { targetN: 5, delta: delta, strength: 'mid',
               text: '第 5 张只要 5.9 元', sub: '到底价档了' };
    }
    return { targetN: n + 1, delta: delta, strength: 'weak',
             text: '再加 1 张，只需多付 ' + fmt(delta) + ' 元', sub: '' };
  }

  function round2(v) { return Math.round(v * 100) / 100; }
  function fmt(v) { return (Math.round(v * 100) / 100).toFixed(2); }
  function fmtYuan(v) { return '¥' + (Math.round(v * 100) / 100).toFixed(2); }
  /** 负值显示为 -¥5.00（用于优惠行） */
  function fmtSigned(v) {
    var n = Math.round(Math.abs(v) * 100) / 100;
    return (v < 0 ? '-¥' : '¥') + n.toFixed(2);
  }

  global.Pricing = {
    TIERS: TIERS,
    SHIPPING_FEE: SHIPPING_FEE,
    FREE_FROM: FREE_FROM,
    COUPON_AMOUNT: COUPON_AMOUNT,
    COUPON_FREESHIP: COUPON_FREESHIP,
    COUPON_GENERAL: COUPON_GENERAL,
    priceOfNth: priceOfNth,
    shippingOf: shippingOf,
    subtotal: subtotal,
    quote: quote,
    isValid: isValid,
    invalidReason: invalidReason,
    hook: hook,
    fmt: fmt,
    fmtYuan: fmtYuan,
    fmtSigned: fmtSigned
  };
})(window);
