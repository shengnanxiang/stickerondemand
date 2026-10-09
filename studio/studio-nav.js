/* ============================================================
   供应端公共导航（工作台左侧栏，各页共用）
   ============================================================ */
(function (global) {
  'use strict';

  var NAV = [
    { key: 'home',       label: '工作台',   href: 'index.html',    icon: 'grid' },
    { key: 'income',     label: '收入统计', href: 'income.html',   icon: 'ruler' },
    { key: 'settings',   label: '店铺设置', href: 'settings.html', icon: 'flower' },
    { key: 'aftersales', label: '售后处理', href: 'aftersales.html', icon: 'shield' }
  ];

  var ICONS = {
    grid:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    ruler:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="8" width="20" height="8" rx="1.5" transform="rotate(-45 12 12)"/><path d="M8 8l2 2M11 5l2 2M14 2l2 2"/></svg>',
    flower:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="5.5" r="2.6"/><circle cx="12" cy="18.5" r="2.6"/><circle cx="5.5" cy="12" r="2.6"/><circle cx="18.5" cy="12" r="2.6"/></svg>',
    shield:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
    logout:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    logo:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6"/><path d="M15 22l6-6-6-6"/><circle cx="21" cy="16" r="3"/></svg>'
  };

  function mount(active, aftersaleOpen) {
    var app = document.querySelector('.biz-app');
    if (!app) return;

    var session = global.Biz && global.Biz.session;
    var links = NAV.map(function (it) {
      var badge = (it.key === 'aftersales' && aftersaleOpen > 0) ?
        '<span class="biz-nav-badge">' + aftersaleOpen + '</span>' : '';
      return '<a href="' + it.href + '" class="biz-nav-item' + (active === it.key ? ' is-active' : '') + '">' +
        '<span class="ico">' + (ICONS[it.icon] || '') + '</span><span>' + it.label + '</span>' + badge + '</a>';
    }).join('');

    app.innerHTML =
      '<aside class="biz-side">' +
        '<a class="biz-brand" href="index.html"><span class="logo">' + ICONS.logo + '</span>' +
          '<span class="col"><span>SOD 供应端</span><span class="t-tiny muted">商家工作台</span></span></a>' +
        '<div class="biz-shop-card">' +
          '<div class="shop-name">' + BizUtil.escapeHtml((session && session.name) || '未登录') + '</div>' +
          '<div class="shop-id">' + BizUtil.escapeHtml((session && session.id) || '') + '</div>' +
        '</div>' +
        '<nav class="biz-nav">' + links + '</nav>' +
        '<div class="biz-side-foot">' +
          '<button class="btn btn-ghost btn-sm btn-block" id="biz-logout">' + ICONS.logout + ' 退出登录</button>' +
          '<a class="link-home center" href="../index.html">← 返回门户</a>' +
        '</div>' +
      '</aside>' +
      '<main class="biz-main"></main>';

    var lo = document.getElementById('biz-logout');
    lo && lo.addEventListener('click', function () { global.Biz.logout(); });
  }

  global.StudioNav = { mount: mount, ICONS: ICONS };
})(window);
