/* ============================================================
   公共 UI：导航 · 登录守卫 · Toast · 图标 · DOM 小工具
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- DOM ---------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function param(name) { return new URLSearchParams(location.search).get(name); }

  /* ---------- 图标（内联 SVG，24×24，stroke 风格统一） ---------- */
  var ICONS = {
    logo:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6"/><path d="M15 22l6-6-6-6"/><circle cx="21" cy="16" r="3"/></svg>',
    plus:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    minus:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    trash:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    edit:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    upload:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>',
    undo:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.5-6.4L3 9"/></svg>',
    redo:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M20.5 13a9 9 0 1 1-2.5-6.4L21 9"/></svg>',
    check:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    close:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    chevronR:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    chevronL:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    bag:       '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>',
    works:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>',
    order:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13Z"/><path d="M8 8h7M8 12h7"/></svg>',
    truck:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h13v13H1z"/><path d="M14 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/></svg>',
    alert:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
    info:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
    shield:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
    wechat:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9.2 3C5 3 1.6 5.9 1.6 9.5c0 2 1.1 3.8 2.9 5L3.8 17l2.7-1.4c.8.2 1.7.4 2.7.4h.7a5.4 5.4 0 0 1-.2-1.4C9.7 11.3 13 8.4 17.2 8.4c.4 0 .8 0 1.2.1C17.5 5.3 13.7 3 9.2 3Zm-2.6 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm5.2 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/><path d="M22.4 14.2c0-2.9-2.8-5.2-6.2-5.2s-6.2 2.3-6.2 5.2 2.8 5.2 6.2 5.2c.8 0 1.5-.1 2.2-.3l2.2 1.2-.6-2c1.5-.9 2.4-2.3 2.4-4.1Zm-8-1a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm4.3 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z"/></svg>',
    phone:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
    sparkles:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/></svg>',
    text:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M12 4v16M9 20h6"/></svg>',
    grid:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    flower:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="5.5" r="2.6"/><circle cx="12" cy="18.5" r="2.6"/><circle cx="5.5" cy="12" r="2.6"/><circle cx="18.5" cy="12" r="2.6"/></svg>',
    image:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>',
    ruler:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="1.5" transform="rotate(-45 12 12)"/><path d="M8 8l2 2M11 5l2 2M14 2l2 2"/></svg>',
    save:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
    logout:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    copy:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    layers:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5Z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/></svg>',
    lock:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    search:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    qr:        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3M14 21h7M21 14v7M18 14v3"/></svg>'
  };
  function icon(name, cls) {
    return '<span class="ico ' + (cls || '') + '" style="display:inline-flex">' + (ICONS[name] || '') + '</span>';
  }

  /* ---------- Toast ---------- */
  function toast(msg, type, ms) {
    var wrap = qs('.toast-wrap');
    if (!wrap) { wrap = el('div', 'toast-wrap'); document.body.appendChild(wrap); }
    var t = el('div', 'toast ' + (type || ''), icon(type === 'err' ? 'alert' : 'check') + '<span>' + escapeHtml(msg) + '</span>');
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .24s, transform .24s';
      t.style.opacity = '0'; t.style.transform = 'translateY(8px)';
      setTimeout(function () { t.remove(); }, 260);
    }, ms || 2200);
    return t;
  }

  /* ---------- 导航 ---------- */
  var NAV_ITEMS = [
    { key: 'home',   label: '创作',   href: 'home.html',  icon: 'sparkles' },
    { key: 'works',  label: '我的作品', href: 'works.html', icon: 'works' },
    { key: 'bag',    label: '结算袋',  href: 'bag.html',   icon: 'bag' },
    { key: 'orders', label: '我的订单', href: 'orders.html', icon: 'order' }
  ];

  function mountNav(active) {
    var root = qs('#nav-root');
    if (!root) return;
    var user = Store.auth.user() || { nickname: '未登录', avatarText: 'S' };
    var n = Store.bag.count();

    var links = NAV_ITEMS.map(function (it) {
      var isBag = it.key === 'bag';
      return '<a href="' + it.href + '" class="nav-link' + (active === it.key ? ' is-active' : '') + (isBag ? ' bag-btn' : '') + '">' +
        icon(it.icon) + '<span>' + it.label + '</span>' +
        (isBag ? '<span class="badge-count"' + (n > 0 ? '' : ' hidden') + '>' + n + '</span>' : '') +
        '</a>';
    }).join('');

    root.innerHTML =
      '<header class="nav"><div class="container nav-inner">' +
        '<a class="nav-brand" href="home.html"><span class="logo">' + icon('logo') + '</span><span>SOD</span></a>' +
        '<nav class="nav-links">' + links + '</nav>' +
        '<div class="nav-user" id="nav-user">' +
          '<button class="avatar-btn" id="avatar-btn" aria-haspopup="true" aria-expanded="false">' +
            '<span class="avatar">' + escapeHtml(user.avatarText || user.nickname.slice(0, 1)) + '</span>' +
            '<span class="t-sm strong">' + escapeHtml(user.nickname || '') + '</span>' +
            '<span class="muted" style="display:inline-flex;transform:rotate(90deg)">' + icon('chevronR') + '</span>' +
          '</button>' +
          '<div class="dropdown" id="user-menu" hidden>' +
            '<a class="dropdown-item" href="address.html">' + icon('truck') + '地址管理</a>' +
            '<button class="dropdown-item danger" id="btn-logout">' + icon('logout') + '退出登录</button>' +
          '</div>' +
        '</div>' +
      '</div></header>';

    var btn = qs('#avatar-btn'), menu = qs('#user-menu');
    btn && btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !menu.hidden; menu.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', function () { if (menu) menu.hidden = true; });
    var lo = qs('#btn-logout');
    lo && lo.addEventListener('click', function () {
      Store.auth.logout();
      location.href = 'index.html';
    });
  }

  /** 更新左上角之外无法感知的结算袋角标（编辑器加入结算袋后调用） */
  function refreshBagBadge() {
    var b = qs('.badge-count');
    var n = Store.bag.count();
    if (!b) return;
    b.textContent = n; b.hidden = (n === 0);
  }

  /* ---------- 登录守卫 ---------- */
  function guard() {
    if (!Store.auth.isLogin()) {
      var back = location.pathname.split('/').pop() + location.search;
      location.replace('index.html?redirect=' + encodeURIComponent(back));
      return false;
    }
    return true;
  }

  /* ---------- 状态标签 ---------- */
  function statusPill(status) {
    return '<span class="pill ' + Store.STATUS_PILL[status] + '">' + Store.STATUS_TEXT[status] + '</span>';
  }

  /* ---------- 空态 ---------- */
  function empty(iconName, title, desc, ctaHtml) {
    return '<div class="empty">' +
      '<div class="empty-illu" style="color:var(--ink-4)">' + icon(iconName, '') + '</div>' +
      '<div class="empty-title">' + escapeHtml(title) + '</div>' +
      '<div class="empty-desc">' + (desc || '') + '</div>' +
      (ctaHtml ? '<div style="margin-top:14px">' + ctaHtml + '</div>' : '') +
      '</div>';
  }

  /* ---------- 金额 ---------- */
  function yuan(v) {
    var s = (Math.round(v * 100) / 100).toFixed(2);
    return '<span class="money"><span style="font-size:.78em;margin-right:1px">¥</span>' + s + '</span>';
  }

  global.UI = {
    qs: qs, qsa: qsa, el: el, icon: icon, escapeHtml: escapeHtml, param: param,
    toast: toast, mountNav: mountNav, guard: guard, refreshBagBadge: refreshBagBadge,
    statusPill: statusPill, empty: empty, yuan: yuan,
    ICONS: ICONS
  };
})(window);
