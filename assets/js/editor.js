/* ============================================================
   编辑器引擎
   - 渲染：纸底色 / 标尺 / 安全区 / 对象 / 贴纸白边 / 模切轮廓 / 选中框
   - 交互：选中、移动、缩放、旋转、画布缩放与平移、删除、撤销重做
   - 抠图：三入口对话框（AI / 调整 / 直接应用）+ 双栏对比 + 涂抹修补
   ============================================================ */
(function () {
  'use strict';

  var $ = UI.qs, $$ = UI.qsa;
  var CV = Store.CANVAS;          // { w:1400, h:1000 }
  var MARGIN = Store.SAFE_MARGIN; // 待 S1 精确边距
  var dpr = window.devicePixelRatio || 1;

  var canvas = $('#ed-canvas');
  var ctx = canvas.getContext('2d');
  var wrap = $('#canvas-wrap');

  var PALETTE = ['#FF7A45', '#FF9DB0', '#FFC94A', '#8FD3A8', '#6FB7E8',
                 '#B79BE8', '#FFFFFF', '#302A24', '#F26D6D', '#4FBFA0'];
  var PAPER_WHITE = '#FFFFFF', PAPER_GRAY = '#EDEAE4';

  /* ================= 状态 ================= */
  var S = {
    work: null, objects: [], sel: null,
    zoom: 1, panX: 0, panY: 0,
    show: { ruler: false, safe: true, cut: false },
    bg: 'white',
    dirty: false,
    history: [], hIdx: -1,
    bmpCache: {}
  };

  var imgCache = {};
  function getImg(src, cb) {
    var im = imgCache[src];
    if (im) { im.complete && im.naturalWidth ? cb(im) : im.addEventListener('load', function () { cb(im); }); return; }
    var img = new Image();
    img.onload = function () { cb(img); };
    img.onerror = function () { UI.toast('这张图片没能读出来', 'err'); };
    img.src = src;
    imgCache[src] = img;
  }

  function uid(p) { return Store.util.uid(p); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ================= 初始化 ================= */
  if (!UI.guard()) return;

  function init() {
    var workId = UI.param('work');
    if (workId && Store.works.get(workId)) {
      var w0 = Store.works.get(workId);
      if (w0.kind === 'history') {
        // 历史作品不允许原地改，复制一份新草稿，历史记录保持原样
        S.work = {
          id: uid('w'), name: w0.name + ' 副本', kind: 'draft',
          thumb: w0.thumb, objects: clone(w0.objects || []), updatedAt: Date.now()
        };
      } else {
        S.work = w0;
      }
      S.objects = clone(S.work.objects || []);
    } else {
      S.work = {
        id: uid('w'), name: '未命名草稿', kind: 'draft',
        thumb: '', objects: [], updatedAt: Date.now()
      };
      S.objects = [];
    }
    $('#ed-title').value = S.work.name;

    // 预加载所有图片资源
    S.objects.forEach(function (o) { if (o.type !== 'text' && o.src) getImg(o.src, function () {}); });

    pushHistory(true);
    fitToScreen();
    renderPanels();
    requestRender();
  }

  /* ================= 渲染 ================= */
  var pending = false;
  function requestRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; render(); });
  }

  function pad(o) { return (o.border && o.border.on) ? (o.border.w || 0) : 0; }

  /** 对象外接尺寸（含白边），已计入 sx/sy */
  function metrics(o) {
    if (o.type === 'text') {
      var m = measureText(o);
      return { w: (m.w + pad(o) * 2) * o.sx, h: (m.h + pad(o) * 2) * o.sy };
    }
    return { w: (o.w + pad(o) * 2) * o.sx, h: (o.h + pad(o) * 2) * o.sy };
  }

  function measureText(o) {
    var lines = String(o.text || '').split('\n');
    thunkFont(o);
    var maxW = 0;
    for (var i = 0; i < lines.length; i++) {
      var w = ctx.measureText(lines[i]).width;
      if (w > maxW) maxW = w;
    }
    var lh = (o.size || 64) * 1.28;
    return { w: maxW, h: lh * lines.length };
  }
  function thunkFont(o) {
    ctx.font = (o.weight || 700) + ' ' + (o.size || 64) + 'px ' + (o.family || DEFAULT_FONT);
  }
  var DEFAULT_FONT = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif';

  /**
   * 绘制整个场景
   * @param {CanvasRenderingContext2D} g
   * @param {number} zoom
   * @param {Object} opts {paper:bool, selection:bool, transparent:bool}
   */
  function drawScene(g, zoom, opts) {
    opts = opts || {};
    g.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
    g.clearRect(0, 0, CV.w, CV.h);

    // 纸底色
    if (opts.paper !== false) {
      g.fillStyle = opts.transparent ? 'transparent' : (S.bg === 'gray' ? PAPER_GRAY : PAPER_WHITE);
      g.fillRect(0, 0, CV.w, CV.h);
    }

    // 标尺
    if (S.show.ruler && opts.selection !== false && opts.ruler !== false) drawRuler(g, zoom);

    // 对象
    for (var i = 0; i < S.objects.length; i++) drawObj(g, S.objects[i], zoom);

    // 越界 / 安全区提示
    if (S.show.safe && opts.selection !== false) drawSafeZone(g, zoom);

    // 选中框
    if (opts.selection !== false && S.sel) drawSelection(g, S.sel, zoom);
  }

  function drawSafeZone(g, zoom) {
    // 安全区虚线
    g.save();
    g.strokeStyle = 'rgba(90,140,120,.55)';
    g.lineWidth = 1.4 / zoom;
    g.setLineDash([12 / zoom, 9 / zoom]);
    g.strokeRect(MARGIN, MARGIN, CV.w - 2 * MARGIN, CV.h - 2 * MARGIN);
    g.restore();

    // 越界对象描红
    for (var i = 0; i < S.objects.length; i++) {
      var o = S.objects[i];
      if (!isOutOfSafe(o)) continue;
      var m = metrics(o);
      g.save();
      g.translate(o.x, o.y); g.rotate(o.rot);
      g.strokeStyle = '#E0614B'; g.lineWidth = 2.4 / zoom;
      g.setLineDash([9 / zoom, 6 / zoom]);
      g.strokeRect(-m.w / 2, -m.h / 2, m.w, m.h);
      g.restore();
    }
  }

  function isOutOfSafe(o) {
    var m = metrics(o);
    var hw = m.w / 2, hh = m.h / 2;
    // 用旋转后的轴对齐包围盒近似判断
    var c = Math.abs(Math.cos(o.rot)), s = Math.abs(Math.sin(o.rot));
    var bw = hw * c + hh * s, bh = hw * s + hh * c;
    return (o.x - bw < MARGIN) || (o.x + bw > CV.w - MARGIN) ||
           (o.y - bh < MARGIN) || (o.y + bh > CV.h - MARGIN);
  }

  function drawRuler(g, zoom) {
    var step = 100, big = 500;
    g.save();
    g.font = (11 / zoom) + 'px ' + DEFAULT_FONT;
    g.textBaseline = 'top';

    // 顶部
    g.fillStyle = 'rgba(255,255,255,.86)';
    g.fillRect(0, 0, CV.w, 22 / zoom);
    g.fillStyle = 'rgba(60,50,40,.55)';
    for (var x = 0; x <= CV.w; x += step) {
      var isBig = (x % big === 0);
      g.fillRect(x, 0, 1.2 / zoom, (isBig ? 14 : 8) / zoom);
      if (isBig) g.fillText(String(x), x + 5 / zoom, 3 / zoom);
    }
    // 左侧
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255,255,255,.86)';
    g.fillRect(0, 0, 22 / zoom, CV.h);
    g.fillStyle = 'rgba(60,50,40,.55)';
    for (var y = 0; y <= CV.h; y += step) {
      var b2 = (y % big === 0);
      g.fillRect(0, y, (b2 ? 14 : 8) / zoom, 1.2 / zoom);
      if (b2 && y > 0) g.fillText(String(y), 4 / zoom, y - 4 / zoom);
    }
    g.restore();
  }

  function drawObj(g, o, zoom) {
    g.save();
    g.translate(o.x, o.y);
    g.rotate(o.rot);
    g.scale(o.sx * (o.flipX ? -1 : 1), o.sy * (o.flipY ? -1 : 1));
    g.globalAlpha = o.opacity == null ? 1 : o.opacity;

    if (o.type === 'text') {
      drawText(g, o);
    } else {
      var bmp = getBmp(o);
      if (bmp) {
        var pw = bmp.cv.width, ph = bmp.cv.height;
        g.drawImage(bmp.cv, -(o.w / 2 + bmp.pad), -(o.h / 2 + bmp.pad), pw, ph);
      }
      // 模切轮廓
      if (S.show.cut && o.border && o.border.on) drawCutOutline(g, o, bmp);
    }
    g.restore();
  }

  function drawText(g, o) {
    var lines = String(o.text || '').split('\n');
    thunkFont(o);
    g.textAlign = o.align === 'left' ? 'left' : (o.align === 'right' ? 'right' : 'center');
    g.textBaseline = 'middle';
    var lh = (o.size || 64) * 1.28;
    var y0 = -(lines.length - 1) * lh / 2;
    if (o.border && o.border.on) {
      g.lineJoin = 'round';
      g.lineWidth = (o.border.w || 0) * 2;
      g.strokeStyle = o.border.color;
      for (var i = 0; i < lines.length; i++) g.strokeText(lines[i], 0, y0 + i * lh);
    }
    g.fillStyle = o.color || '#302A24';
    for (var j = 0; j < lines.length; j++) g.fillText(lines[j], 0, y0 + j * lh);
  }

  /** 模切轮廓：白边外沿的一圈淡线（示意，精确轮廓依赖后续版本） */
  function drawCutOutline(g, o, bmp) {
    if (!bmp) return;
    var p = bmp.pad, gap = Math.max(2, o.border.w * 0.22);
    g.save();
    g.strokeStyle = 'rgba(90,90,90,.42)';
    g.lineWidth = 1.4 / (S.zoom * (o.sx || 1));
    g.setLineDash([8 / (S.zoom * (o.sx || 1)), 6 / (S.zoom * (o.sy || 1))]);
    g.strokeRect(-(o.w / 2 + p - gap), -(o.h / 2 + p - gap),
                 o.w + (p - gap) * 2, o.h + (p - gap) * 2);
    g.restore();
  }

  /* ---------- 对象位图缓存（含白边） ---------- */
  function bmpKey(o) {
    var srcKey = o.src ? (o.src.length + '_' + o.src.slice(-28)) : (o.shapeId + o.color);
    return [o.id, srcKey, Math.round(o.w), Math.round(o.h),
            o.border.on, o.border.w, o.border.color].join('|');
  }
  function getBmp(o) {
    var key = bmpKey(o);
    if (S.bmpCache[key]) return S.bmpCache[key];
    if (!o.src) return null;
    getImg(o.src, function (img) {
      if (!img.naturalWidth) return;
      S.bmpCache[key] = buildBmp(img, o);
      requestRender();
    });
    return null;
  }
  function buildBmp(img, o) {
    var w = Math.round(o.w), h = Math.round(o.h);
    var p = pad(o);
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, w + p * 2);
    cv.height = Math.max(1, h + p * 2);
    var c = cv.getContext('2d');

    if (p > 0) {
      // 1) 生成同形状的单色剪影
      var sil = document.createElement('canvas');
      sil.width = w; sil.height = h;
      var sc = sil.getContext('2d');
      sc.drawImage(img, 0, 0, w, h);
      sc.globalCompositeOperation = 'source-in';
      sc.fillStyle = o.border.color || '#FFFFFF';
      sc.fillRect(0, 0, w, h);

      // 2) 环形盖章 → 得到均匀外扩的白边
      var steps = Math.max(10, Math.ceil(p * 1.1));
      for (var i = 0; i < steps; i++) {
        var a = i / steps * Math.PI * 2;
        c.drawImage(sil, p + Math.cos(a) * p, p + Math.sin(a) * p, w, h);
      }
    }
    c.drawImage(img, p, p, w, h);
    return { cv: cv, pad: p };
  }

  /* ---------- 选中框 ---------- */
  function drawSelection(g, o, zoom) {
    var m = metrics(o);
    var W = m.w / o.sx, H = m.h / o.sy; // 局部坐标下的尺寸（未含 sx）
    g.save();
    g.translate(o.x, o.y);
    g.rotate(o.rot);
    g.scale(o.sx, o.sy);
    g.strokeStyle = '#FF7A45';
    g.lineWidth = 2 / zoom / o.sx;
    g.strokeRect(-W / 2, -H / 2, W, H);

    var hs = 9 / zoom / o.sx;
    var corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]];
    for (var i = 0; i < corners.length; i++) {
      g.fillStyle = '#fff';
      g.beginPath();
      g.rect(corners[i][0] - hs / 2, corners[i][1] - hs / 2, hs, hs);
      g.fill(); g.stroke();
    }
    // 旋转柄
    var handleY = -H / 2 - 26 / zoom / o.sy;
    g.beginPath(); g.moveTo(0, -H / 2); g.lineTo(0, handleY); g.stroke();
    g.beginPath(); g.arc(0, handleY, 6 / zoom / o.sx, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.fill(); g.stroke();
    g.restore();
  }

  /* ================= 主渲染入口 ================= */
  function render() {
    var cw = CV.w * S.zoom, ch = CV.h * S.zoom;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.transform = 'translate(calc(-50% + ' + S.panX + 'px), calc(-50% + ' + S.panY + 'px))';
    drawScene(ctx, S.zoom, {});
    positionFloat();
    updateZoomLabel();
    syncPropValues();
  }

  /** 只同步属性面板里的数值，不重建 DOM —— 避免打断用户输入 */
  function syncPropValues() {
    var o = S.sel;
    if (!o) return;
    function safe(sel, val) {
      var el = $(sel);
      if (el && document.activeElement !== el) el.value = val;
    }
    safe('#p-scale', Math.round(o.sx * 100));
    safe('#p-rot', Math.round(o.rot * 180 / Math.PI));
    safe('#p-x', Math.round(o.x));
    safe('#p-y', Math.round(o.y));
    var bwv = $('#p-border-val');
    if (bwv) bwv.textContent = (o.border && o.border.w) || 0;
  }

  function updateZoomLabel() { $('#zoom-val').textContent = Math.round(S.zoom * 100) + '%'; }

  function fitToScreen() {
    var pad = 56;
    var availW = wrap.clientWidth - pad, availH = wrap.clientHeight - pad;
    S.zoom = Math.min(availW / CV.w, availH / CV.h);
    S.zoom = Math.max(0.1, Math.min(2, S.zoom));
    S.panX = 0; S.panY = 0;
  }

  /* ================= 坐标换算 ================= */
  function ptFromEvent(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
  }
  function toLocal(o, p) {
    var dx = p.x - o.x, dy = p.y - o.y;
    var c = Math.cos(-o.rot), s = Math.sin(-o.rot);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  function hitTest(p) {
    for (var i = S.objects.length - 1; i >= 0; i--) {
      var o = S.objects[i];
      var m = metrics(o);
      var l = toLocal(o, p);
      if (Math.abs(l.x) <= m.w / 2 && Math.abs(l.y) <= m.h / 2) return o;
    }
    return null;
  }
  /** 返回手柄名：'rot' | 'nw'|'ne'|'se'|'sw' | null */
  function handleAt(o, p) {
    var m = metrics(o);
    var l = toLocal(o, p);
    var tol = 12 / S.zoom;
    // 旋转柄
    var hy = -m.h / 2 - 26 / S.zoom;
    if (Math.abs(l.y - hy) < tol + 4 / S.zoom && Math.abs(l.x) < tol + 4 / S.zoom) return 'rot';
    var corners = [['nw', -m.w / 2, -m.h / 2], ['ne', m.w / 2, -m.h / 2],
                   ['se', m.w / 2, m.h / 2], ['sw', -m.w / 2, m.h / 2]];
    for (var i = 0; i < corners.length; i++) {
      if (Math.abs(l.x - corners[i][1]) < tol && Math.abs(l.y - corners[i][2]) < tol) return corners[i][0];
    }
    return null;
  }

  /* ================= 交互 ================= */
  var drag = null;

  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    var p = ptFromEvent(e);

    if (S.sel) {
      var h = handleAt(S.sel, p);
      if (h) {
        drag = {
          mode: h === 'rot' ? 'rot' : 'scale',
          handle: h, obj: S.sel, start: p,
          orig: clone(S.sel),
          ang0: Math.atan2(p.y - S.sel.y, p.x - S.sel.x)
        };
        return;
      }
    }
    var o = hitTest(p);
    select(o);
    if (o) {
      drag = { mode: 'move', obj: o, start: p, orig: clone(o) };
    } else {
      drag = { mode: 'pan', startClient: { x: e.clientX, y: e.clientY }, pan0: { x: S.panX, y: S.panY } };
      canvas.classList.add('is-panning');
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!drag) {
      var hovered = hitTest(ptFromEvent(e));
      canvas.style.cursor = hovered ? 'move' : 'default';
      return;
    }
    var p = ptFromEvent(e);

    if (drag.mode === 'pan') {
      S.panX = drag.pan0.x + (e.clientX - drag.startClient.x);
      S.panY = drag.pan0.y + (e.clientY - drag.startClient.y);
      render();
      return;
    }
    var o = drag.obj;
    if (drag.mode === 'move') {
      o.x = drag.orig.x + (p.x - drag.start.x);
      o.y = drag.orig.y + (p.y - drag.start.y);
    } else     if (drag.mode === 'scale') {
      var l = toLocal(o, p);
      o.sx = Math.max(0.05, Math.abs(l.x) / (o.w / 2));
      o.sy = Math.max(0.05, Math.abs(l.y) / (o.h / 2));
      if (e.shiftKey) {
        var k = Math.max(o.sx, o.sy);
        o.sx = o.sy = k;
      }
    } else if (drag.mode === 'rot') {
      var ang = Math.atan2(p.y - o.y, p.x - o.x);
      var d = ang - drag.ang0;
      var rot = drag.orig.rot + d;
      if (e.shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
      o.rot = rot;
    }
    requestRender();
  });

  function endDrag(e) {
    if (!drag) return;
    canvas.classList.remove('is-panning');
    if (drag.mode !== 'pan') pushHistory();
    drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // 滚轮缩放
  wrap.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
      e.preventDefault();
      var k = e.deltaY > 0 ? 0.92 : 1.08;
      setZoom(S.zoom * k);
    }
  }, { passive: false });

  function setZoom(z) {
    S.zoom = Math.max(0.1, Math.min(3, z));
    render();
  }

  // 键盘
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) {
      e.preventDefault();
      removeSelected();
    }
    if (e.key === 'Escape') { if (S.sel) select(null); }
  });

  /* ================= 选择 ================= */
  function select(o) {
    S.sel = o || null;
    $('#ed-right').hidden = !o;
    renderProps();
    positionFloat();
    requestRender();
  }

  function positionFloat() {
    var f = $('#ed-float');
    if (!S.sel || !S.objects.length) { f.hidden = true; return; }
    var idx = S.objects.indexOf(S.sel);
    if (idx < 0) { f.hidden = true; return; }
    var m = metrics(S.sel);
    var r = canvas.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    var cx = r.left - wr.left + (S.sel.x + Math.sin(S.sel.rot) * (m.h / 2 + 26 / S.zoom)) * S.zoom;
    var cy = r.top - wr.top + (S.sel.y - Math.cos(S.sel.rot) * (m.h / 2 + 26 / S.zoom)) * S.zoom;
    f.hidden = false;
    f.style.left = Math.max(8, Math.min(wr.width - f.offsetWidth - 8, cx - f.offsetWidth / 2)) + 'px';
    f.style.top = Math.max(8, cy - f.offsetHeight - 10) + 'px';
  }

  /* ================= 增删编辑 ================= */
  function addObject(o) {
    S.objects.push(o);
    select(o);
    pushHistory();
    markDirty();
    requestRender();
  }

  function removeSelected() {
    if (!S.sel) return;
    var i = S.objects.indexOf(S.sel);
    if (i >= 0) S.objects.splice(i, 1);
    select(null);
    pushHistory();
    markDirty();
    requestRender();
  }

  function layerMove(dir) {
    if (!S.sel) return;
    var i = S.objects.indexOf(S.sel);
    var j = dir === 'up' ? i + 1 : (dir === 'down' ? i - 1 : -1);
    if (dir === 'top') j = S.objects.length - 1;
    if (dir === 'bottom') j = 0;
    if (j < 0 || j >= S.objects.length || j === i) return;
    var it = S.objects.splice(i, 1)[0];
    S.objects.splice(j, 0, it);
    pushHistory(); markDirty(); requestRender();
  }

  function duplicateSelected() {
    if (!S.sel) return;
    var c = clone(S.sel);
    c.id = uid('o'); c.x += 40; c.y += 40;
    S.objects.push(c);
    select(c);
    pushHistory(); markDirty(); requestRender();
  }

  /* ================= 历史栈 ================= */
  function pushHistory(silent) {
    var snap = JSON.stringify(S.objects);
    if (!silent && S.history[S.hIdx] === snap) return;
    S.history = S.history.slice(0, S.hIdx + 1);
    S.history.push(snap);
    if (S.history.length > 40) S.history.shift();
    S.hIdx = S.history.length - 1;
    updateUndo();
    if (!silent) markDirty();
  }
  function undo() {
    if (S.hIdx <= 0) return;
    S.hIdx--;
    S.objects = JSON.parse(S.history[S.hIdx]);
    select(null); pushHistory(); requestRender();
  }
  function redo() {
    if (S.hIdx >= S.history.length - 1) return;
    S.hIdx++;
    S.objects = JSON.parse(S.history[S.hIdx]);
    select(null); requestRender();
  }
  function updateUndo() {
    $('#btn-undo').disabled = S.hIdx <= 0;
    $('#btn-redo').disabled = S.hIdx >= S.history.length - 1;
  }

  /* ================= 自动保存 ================= */
  var saveTimer = null;
  function markDirty() {
    S.dirty = true;
    $('#ed-status').classList.add('is-saving');
    $('#ed-status-text').textContent = '未保存';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 2400);
  }
  function doSave() {
    if (!S.work) return;
    S.work.name = $('#ed-title').value.trim() || '未命名草稿';
    S.work.objects = clone(S.objects);
    S.work.kind = 'draft';
    S.work.thumb = makeThumb();
    S.work.updatedAt = Date.now();
    Store.works.upsert(S.work);
    S.dirty = false;
    $('#ed-status').classList.remove('is-saving');
    $('#ed-status-text').textContent = '已保存';
  }
  setInterval(function () { if (S.dirty) doSave(); }, 15000);

  function makeThumb() {
    try {
      var tw = 350, th = Math.round(tw * CV.h / CV.w);
      var cv = document.createElement('canvas');
      cv.width = tw; cv.height = th;
      var g = cv.getContext('2d');
      g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, tw, th);
      var savedSel = S.sel, savedZoom = S.zoom, savedDpr = dpr;
      S.sel = null; S.zoom = tw / CV.w; dpr = 1;
      drawScene(g, S.zoom, { selection: false, ruler: false });
      S.sel = savedSel; S.zoom = savedZoom; dpr = savedDpr;
      return cv.toDataURL('image/jpeg', 0.72);
    } catch (e) { return ''; }
  }

  /* ================= 左面板 ================= */
  function renderPanels() {
    // Tab 切换
    $$('.ed-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.ed-tab').forEach(function (x) { x.classList.remove('is-active'); });
        t.classList.add('is-active');
        $$('.ed-panel').forEach(function (p) { p.hidden = true; });
        $('#p-' + t.dataset.p).hidden = false;
      });
    });

    // 图标
    setIcon('.ed-tab[data-p="upload"] .ico', 'upload');
    setIcon('.ed-tab[data-p="asset"] .ico', 'flower');
    setIcon('.ed-tab[data-p="text"] .ico', 'text');
    setIcon('.ed-tab[data-p="tpl"] .ico', 'grid');
    setIcon('#i-back', 'chevronL'); setIcon('#i-undo', 'undo'); setIcon('#i-redo', 'redo');
    setIcon('#i-save', 'save'); setIcon('#i-upload', 'image', '');
    setIcon('#i-np', 'shield'); setIcon('#i-zo', 'minus'); setIcon('#i-zi', 'plus');
    setIcon('#i-fit', 'grid'); setIcon('#i-ruler', 'ruler'); setIcon('#i-safe', 'layers');
    setIcon('#i-cut', 'sparkles'); setIcon('#i-bg', 'flower'); setIcon('#i-close', 'close');
    setIcon('#i-mclose', 'close');
    setIcon('#fb-up', 'chevronR'); setIcon('#fb-down', 'chevronL');
    setIcon('#fb-copy', 'copy'); setIcon('#fb-del', 'trash');

    // 色板
    $('#swatches').innerHTML = PALETTE.map(function (c, i) {
      return '<button class="ed-swatch' + (i === 0 ? ' is-active' : '') + '" data-c="' + c + '" ' +
        'style="background:' + c + (c === '#FFFFFF' ? ';box-shadow:0 0 0 1px var(--line-strong)' : '') + '"></button>';
    }).join('');
    $$('#swatches .ed-swatch').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#swatches .ed-swatch').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        $('.ed-asset-grid').dataset.color = b.dataset.c;
        renderAssetGrid(b.dataset.c);
      });
    });

    renderAssetGrid(PALETTE[0]);
    renderTextPresets();
    renderTemplates();
  }

  function renderAssetGrid(color) {
    color = color || PALETTE[0];
    $('#asset-grid').innerHTML = Store.SHAPES.map(function (s) {
      return '<div class="ed-asset-cell">' +
        '<button class="ed-asset" data-shape="' + s.id + '" title="' + s.name + '">' +
          '<img src="' + Store.assets.shapeURI(s.id, color) + '" alt="' + s.name + '"></button>' +
        '</div>';
    }).join('');
    $$('#asset-grid .ed-asset').forEach(function (b) {
      b.addEventListener('click', function () { addShape(b.dataset.shape, color); });
    });
  }

  function renderTextPresets() {
    var presets = [
      { label: '大标题', o: { text: '我的标题', size: 120, weight: 800, color: '#302A24' } },
      { label: '副标题', o: { text: '写点什么', size: 76, weight: 700, color: '#5E554C' } },
      { label: '小字',   o: { text: '2026 · 记念', size: 48, weight: 600, color: '#8D8277' } }
    ];
    $('#text-presets').innerHTML = presets.map(function (p) {
      return '<button class="ed-tpl" data-preset="' + encodeURIComponent(JSON.stringify(p.o)) + '">' +
        '<span style="font-size:' + Math.min(26, p.o.size / 4.4) + 'px;font-weight:' + p.o.weight +
        ';color:' + p.o.color + ';line-height:1.1">' + p.o.text + '</span>' +
        '<span class="grow"></span><span class="t-tiny muted">' + p.label + '</span></button>';
    }).join('');
    $$('#text-presets .ed-tpl').forEach(function (b) {
      b.addEventListener('click', function () { addText(JSON.parse(decodeURIComponent(b.dataset.preset))); });
    });
  }

  function renderTemplates() {
    $('#tpl-list').innerHTML = Store.TEMPLATES.map(function (t) {
      return '<button class="ed-tpl" data-tpl="' + t.id + '">' +
        '<span class="ed-tpl-mini"><img src="' + tplMini(t) + '" alt=""></span>' +
        '<span class="col gap-4"><span class="t-sm strong">' + t.name + '</span>' +
        '<span class="t-tiny muted">' + t.desc + '</span></span></button>';
    }).join('');
    $$('#tpl-list .ed-tpl').forEach(function (b) {
      b.addEventListener('click', function () {
        if (S.objects.length) {
          confirmDo('套用布局框架？', '会在当前画布上新增几个位置框，已有内容不会删除。',
            '套用', function () { applyTemplate(b.dataset.tpl); });
        } else applyTemplate(b.dataset.tpl);
      });
    });
  }

  function tplMini(t) {
    var rects = '';
    function box(x, y, w, h) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="#DCCDBA"/>';
    }
    if (t.grid) {
      var g = t.grid, P = 8, gap = 3;
      var cw = (100 - P * 2 - gap * (g.cols - 1)) / g.cols;
      var ch = (71 - P * 2 - gap * (g.rows - 1)) / g.rows;
      for (var r = 0; r < g.rows; r++) {
        for (var c = 0; c < g.cols; c++) {
          rects += box(P + c * (cw + gap), P + r * (ch + gap), cw, ch);
        }
      }
    } else {
      rects = t.frames.map(function (f) {
        return box((f.x - f.w / 2) * 100, (f.y - f.h / 2) * 71, f.w * 100, f.h * 71);
      }).join('');
    }
    return Store.assets.svgURI('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 71">' +
      '<rect width="100" height="71" rx="6" fill="#FDF7EE"/>' + rects + '</svg>');
  }

  function applyTemplate(id) {
    var t = null;
    for (var i = 0; i < Store.TEMPLATES.length; i++) if (Store.TEMPLATES[i].id === id) t = Store.TEMPLATES[i];
    if (!t) return;
    var boxes = [];
    if (t.grid) {
      var g = t.grid;
      var padX = CV.w * g.pad, padY = CV.h * g.pad;
      var gw = (CV.w - 2 * padX - (g.cols - 1) * CV.w * g.gap) / g.cols;
      var gh = (CV.h - 2 * padY - (g.rows - 1) * CV.h * g.gap) / g.rows;
      for (var r = 0; r < g.rows; r++) {
        for (var c = 0; c < g.cols; c++) {
          boxes.push({
            x: padX + c * (gw + CV.w * g.gap) + gw / 2,
            y: padY + r * (gh + CV.h * g.gap) + gh / 2,
            w: gw, h: gh
          });
        }
      }
    } else {
      boxes = t.frames.map(function (f) {
        return { x: CV.w * f.x, y: CV.h * f.y, w: CV.w * f.w, h: CV.h * f.h };
      });
    }
    boxes.forEach(function (b) {
      addObject({
        id: uid('o'), type: 'shape', shapeId: 'rrect', color: '#DCCDBA',
        src: Store.assets.shapeURI('rrect', '#DCCDBA'),
        x: b.x, y: b.y, w: b.w, h: b.h, sx: 1, sy: 1, rot: 0,
        border: { on: false, w: 0, color: '#FFFFFF' }, flipX: false, flipY: false, opacity: 1
      });
    });
    select(null);
    UI.toast('已套用「' + t.name + '」，把框删掉就能用', 'ok');
  }

  /* ================= 添加对象 ================= */
  function addShape(shapeId, color) {
    var w = Math.min(CV.w, CV.h) * 0.36;
    addObject({
      id: uid('o'), type: 'shape', shapeId: shapeId, color: color,
      src: Store.assets.shapeURI(shapeId, color),
      x: CV.w / 2, y: CV.h / 2, w: w, h: w, sx: 1, sy: 1, rot: 0,
      border: { on: true, w: 14, color: '#FFFFFF' }, flipX: false, flipY: false, opacity: 1
    });
  }

  function addText(opts) {
    addObject(Object.assign({
      id: uid('o'), type: 'text',
      x: CV.w / 2, y: CV.h / 2, w: 400, h: 120, sx: 1, sy: 1, rot: 0,
      border: { on: true, w: 10, color: '#FFFFFF' },
      flipX: false, flipY: false, opacity: 1
    }, opts || { text: '双击修改文字', size: 96, weight: 800, color: '#302A24', align: 'center', family: DEFAULT_FONT }));
  }

  function addImage(src) {
    getImg(src, function (img) {
      var max = Math.min(CV.w, CV.h) * 0.62;
      var r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      addObject({
        id: uid('o'), type: 'image', src: src,
        x: CV.w / 2, y: CV.h / 2,
        w: Math.round(img.naturalWidth * r), h: Math.round(img.naturalHeight * r),
        sx: 1, sy: 1, rot: 0,
        border: { on: true, w: 14, color: '#FFFFFF' },
        flipX: false, flipY: false, opacity: 1
      });
    });
  }

  /* ================= 右属性面板 ================= */
  function renderProps() {
    var o = S.sel;
    var box = $('#prop-body');
    if (!o) { $('#ed-right').hidden = true; return; }
    $('#ed-right').hidden = false;
    $('#prop-title').textContent = o.type === 'text' ? '文字' : (o.type === 'shape' ? '素材' : '图片');

    var m = metrics(o);
    var html = '';

    // 文字内容
    if (o.type === 'text') {
      html += '<div class="ed-prop-group"><div class="ed-prop-label">文字内容</div>' +
        '<textarea class="textarea" id="prop-text" rows="3">' + UI.escapeHtml(o.text || '') + '</textarea></div>';
    }

    // 变换
    html += '<div class="ed-prop-group">' +
      '<div class="ed-prop-label">变换</div>' +
      '<div class="ed-num-row">' +
        '<div class="field"><span class="hint">缩放 %</span>' +
          '<input class="ed-mini-input" id="p-scale" type="number" min="5" max="500" value="' + Math.round(o.sx * 100) + '"></div>' +
        '<div class="field"><span class="hint">旋转 °</span>' +
          '<input class="ed-mini-input" id="p-rot" type="number" value="' + Math.round(o.rot * 180 / Math.PI) + '"></div>' +
      '</div>' +
      '<div class="ed-num-row">' +
        '<div class="field"><span class="hint">X</span>' +
          '<input class="ed-mini-input" id="p-x" type="number" value="' + Math.round(o.x) + '"></div>' +
        '<div class="field"><span class="hint">Y</span>' +
          '<input class="ed-mini-input" id="p-y" type="number" value="' + Math.round(o.y) + '"></div>' +
      '</div>' +
      '<div class="row gap-8">' +
        '<button class="btn btn-outline btn-xs" id="p-center">居中</button>' +
        '<button class="btn btn-outline btn-xs" id="p-reset-size">还原大小</button>' +
      '</div>' +
    '</div>';

    // 素材颜色
    if (o.type === 'shape') {
      html += '<div class="ed-prop-group"><div class="ed-prop-label">颜色</div><div class="ed-swatch-row">' +
        PALETTE.map(function (c) {
          return '<button class="ed-swatch' + (o.color === c ? ' is-active' : '') + '" data-pc="' + c + '" style="background:' + c + '"></button>';
        }).join('') + '</div></div>';
    }

    // 文字属性
    if (o.type === 'text') {
      html += '<div class="ed-prop-group">' +
        '<div class="ed-prop-label"><span>字号</span><span class="hint" id="p-size-val">' + (o.size || 64) + ' px</span></div>' +
        '<input class="ed-slider" id="p-size" type="range" min="20" max="260" value="' + (o.size || 64) + '">' +
        '<div class="ed-prop-label"><span>字色</span></div>' +
        '<div class="ed-swatch-row">' + PALETTE.map(function (c) {
          return '<button class="ed-swatch' + (o.color === c ? ' is-active' : '') + '" data-tc="' + c + '" style="background:' + c + '"></button>';
        }).join('') + '</div>' +
        '<div class="ed-prop-label">对齐</div>' +
        '<div class="ed-seg" id="p-align">' +
          ['left', 'center', 'right'].map(function (a) {
            return '<button data-a="' + a + '" class="' + ((o.align || 'center') === a ? 'is-active' : '') + '">' +
              ({ left: '左', center: '中', right: '右' })[a] + '</button>';
          }).join('') + '</div>' +
      '</div>';
    }

    // 贴纸白边 / 描边
    var bd = o.border || { on: false, w: 0, color: '#FFFFFF' };
    html += '<div class="ed-prop-group">' +
      '<div class="ed-prop-label"><span>贴纸白边</span>' +
        '<label class="checkbox"><input type="checkbox" id="p-border-on"' + (bd.on ? ' checked' : '') + '><span>开启</span></label></div>' +
      '<div class="ed-prop-label"><span>粗细</span><span class="hint" id="p-border-val">' + (bd.w || 0) + '</span></div>' +
      '<input class="ed-slider" id="p-border-w" type="range" min="0" max="60" value="' + (bd.w || 0) + '">' +
      '<div class="ed-prop-label">颜色</div>' +
      '<div class="ed-swatch-row">' + PALETTE.map(function (c) {
        return '<button class="ed-swatch' + (bd.color === c ? ' is-active' : '') + '" data-bc="' + c + '" style="background:' + c + '"></button>';
      }).join('') + '</div>' +
      '<p class="hint" style="margin-top:-2px">白边就是贴纸模切时预留的那圈边。</p>' +
    '</div>';

    // 翻转 / 图层 / 删除
    html += '<div class="ed-prop-group">' +
      '<div class="ed-prop-label">翻转</div>' +
      '<div class="ed-seg">' +
        '<button id="p-flipx">水平翻转</button><button id="p-flipy">垂直翻转</button>' +
      '</div>' +
      '<div class="ed-prop-label">图层</div>' +
      '<div class="ed-seg">' +
        '<button id="p-top">置顶</button><button id="p-up">上移</button>' +
        '<button id="p-down">下移</button><button id="p-bottom">置底</button>' +
      '</div>' +
      '<button class="btn btn-danger btn-sm btn-block mt-8" id="p-del">删除这个图素</button>' +
    '</div>';

    box.innerHTML = html;
    bindProps(o);
  }

  function bindProps(o) {
    function upd() { pushHistory(); markDirty(); renderProps(); requestRender(); }

    var tx = $('#prop-text');
    if (tx) tx.addEventListener('input', function () { o.text = tx.value; markDirty(); requestRender(); });

    bindNum($('#p-scale'), function (v) {
      v = Math.max(5, Math.min(500, v)) / 100;
      o.sx = v; o.sy = v; upd();
    });
    bindNum($('#p-rot'), function (v) { o.rot = v * Math.PI / 180; upd(); });
    bindNum($('#p-x'), function (v) { o.x = v; upd(); });
    bindNum($('#p-y'), function (v) { o.y = v; upd(); });

    on($('#p-center'), function () { o.x = CV.w / 2; o.y = CV.h / 2; upd(); });
    on($('#p-reset-size'), function () { o.sx = 1; o.sy = 1; o.rot = 0; upd(); });

    $$('[data-pc]').forEach(function (b) {
      b.addEventListener('click', function () {
        o.color = b.dataset.pc;
        o.src = Store.assets.shapeURI(o.shapeId, o.color);
        upd();
      });
    });

    var sz = $('#p-size');
    if (sz) sz.addEventListener('input', function () {
      o.size = parseInt(sz.value, 10);
      var hv = $('#p-size-val'); if (hv) hv.textContent = o.size + ' px';
      markDirty(); requestRender();
    });
    $$('[data-tc]').forEach(function (b) {
      b.addEventListener('click', function () { o.color = b.dataset.tc; upd(); });
    });
    $$('#p-align button').forEach(function (b) {
      b.addEventListener('click', function () { o.align = b.dataset.a; upd(); });
    });

    var bon = $('#p-border-on');
    bon.addEventListener('change', function () {
      o.border.on = bon.checked;
      if (bon.checked && !o.border.w) o.border.w = 14;
      upd();
    });
    var bw = $('#p-border-w');
    bw.addEventListener('input', function () {
      o.border.w = parseInt(bw.value, 10);
      $('#p-border-val').textContent = o.border.w;
      o.border.on = o.border.w > 0;
      bon.checked = o.border.on;
      markDirty(); requestRender();
    });
    $$('[data-bc]').forEach(function (b) {
      b.addEventListener('click', function () { o.border.color = b.dataset.bc; o.border.on = true; bon.checked = true; upd(); });
    });

    on($('#p-flipx'), function () { o.flipX = !o.flipX; upd(); });
    on($('#p-flipy'), function () { o.flipY = !o.flipY; upd(); });
    on($('#p-top'), function () { layerMove('top'); });
    on($('#p-up'), function () { layerMove('up'); });
    on($('#p-down'), function () { layerMove('down'); });
    on($('#p-bottom'), function () { layerMove('bottom'); });
    on($('#p-del'), removeSelected);
  }

  function bindNum(input, fn) {
    if (!input) return;
    input.addEventListener('change', function () {
      var v = parseFloat(input.value);
      if (isNaN(v)) return;
      fn(v);
    });
  }
  function on(el, fn) { if (el) el.addEventListener('click', fn); }
  function setIcon(sel, name) { var e = $(sel); if (e) e.innerHTML = UI.icon(name); }

  /* ================= 通用弹层 ================= */
  function confirmDo(title, desc, okText, fn) {
    showModal('<div style="padding:22px">' +
      '<div class="t-h3">' + UI.escapeHtml(title) + '</div>' +
      '<p class="muted t-sm mt-8" style="line-height:1.65">' + desc + '</p>' +
      '<div class="row gap-8 mt-16" style="justify-content:flex-end">' +
      '<button class="btn btn-ghost btn-sm" data-x>取消</button>' +
      '<button class="btn btn-primary btn-sm" data-ok>' + UI.escapeHtml(okText) + '</button>' +
      '</div></div>');
    $$('#modal [data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    $$('#modal [data-ok]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(); fn(); });
    });
  }
  function showModal(html) {
    $('#modal-content').innerHTML = html;
    $('#modal').hidden = false;
  }
  function closeModal() { $('#modal').hidden = true; }
  on($('#modal'), function (e) { if (e.target === $('#modal')) closeModal(); });

  /* ================= 上传与抠图对话框 ================= */
  var dropZone = $('#drop-zone'), fileInput = $('#file-input');
  dropZone.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call(fileInput.files || []);
    handleFiles(files);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.add('is-drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.remove('is-drag'); });
  });
  dropZone.addEventListener('drop', function (e) {
    var files = Array.prototype.slice.call(e.dataTransfer.files || []);
    var imgs = files.filter(function (f) { return /image\//.test(f.type); });
    if (!imgs.length) { UI.toast('请拖入图片文件', 'warn'); return; }
    handleFiles(imgs);
  });

  function handleFiles(files) {
    var queue = files.slice(0, 6);
    function next() {
      if (!queue.length) return;
      var f = queue.shift();
      readFile(f).then(function (url) {
        openMatte(url, function () { next(); });
      }).catch(function () { UI.toast('读取失败：' + f.name, 'err'); next(); });
    }
    next();
  }
  function readFile(f) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(new Error('read error')); };
      r.readAsDataURL(f);
    });
  }

  /* ---------- 抠图对话框状态机 ---------- */
  var M = {
    src: '', img: null, result: null, base: null, working: null,
    tol: Matting.DEFAULT_TOLERANCE,
    step: 'choose', brush: { mode: 'erase', size: 34 },
    showMask: false, doneCb: null
  };

  function openMatte(src, cb) {
    M.src = src; M.step = 'choose'; M.result = null; M.working = null; M.doneCb = cb || null;
    $('#matte').hidden = false;
    Matting.loadImage(src).then(function (img) {
      M.img = img;
      renderMatte();
    }).catch(function () {
      M.step = 'failed'; renderMatte();
    });
  }
  function closeMatte() {
    $('#matte').hidden = true;
    M.working = null; M.result = null;
    if (M.doneCb) { var cb = M.doneCb; M.doneCb = null; cb(); }
  }
  on($('#matte-close'), closeMatte);

  function renderMatte() {
    var body = $('#matte-body');
    if (M.step === 'choose') {
      $('#matte-sub').textContent = '先看看这张图，选一种处理方式';
      body.innerHTML =
        '<div class="ed-origin-preview"><img src="' + M.src + '" alt=""></div>' +
        '<div class="ed-three-opts">' +
          '<button class="ed-opt is-primary" data-act="ai">' +
            '<span class="ed-opt-title" data-i-ai></span>' +
            '<span class="ed-opt-desc">自动去掉背景。原图会临时上传到云端处理，处理完即删除。</span></button>' +
          '<button class="ed-opt" data-act="adjust"><span class="ed-opt-title" data-i-ad></span>' +
            '<span class="ed-opt-desc">不动背景，自己修需要的地方。</span></button>' +
          '<button class="ed-opt" data-act="raw"><span class="ed-opt-title" data-i-raw></span>' +
            '<span class="ed-opt-desc">已经是透明 PNG、或者就想保留整张图。</span></button>' +
        '</div>' +
        '<div class="row gap-8 mt-16"><button class="btn btn-ghost btn-sm" data-act="change">换一张图片</button>' +
        '<span class="t-tiny muted grow">处理方式在点「放进画布」之后才生效</span></div>';
      setIcon('[data-i-ai]', 'sparkles'); body.querySelector('[data-i-ai]').insertAdjacentHTML('beforeend', 'AI 抠图');
      setIcon('[data-i-ad]', 'edit'); body.querySelector('[data-i-ad]').insertAdjacentHTML('beforeend', '调整');
      setIcon('[data-i-raw]', 'image'); body.querySelector('[data-i-raw]').insertAdjacentHTML('beforeend', '直接应用');

      $$('#matte-body [data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.act;
          if (a === 'ai') runAI();
          else if (a === 'adjust') enterAdjustFromRaw();
          else if (a === 'raw') { addImage(M.src); closeMatte(); }
          else if (a === 'change') { closeMatte(); fileInput.click(); }
        });
      });

    } else if (M.step === 'loading') {
      $('#matte-sub').textContent = '正在抠图';
      body.innerHTML = '<div class="ed-load-wrap">' +
        '<div class="ed-spinner"></div>' +
        '<div class="t-sm strong">正在自动去除背景…</div>' +
        '<div class="t-tiny muted center">通常几秒钟<br>原图仅用于处理，处理完即删除</div></div>';

    } else if (M.step === 'compare' || M.step === 'adjust') {
      $('#matte-sub').textContent = M.step === 'compare' ? '看看边缘处理得怎么样' : '哪里不对，涂一涂就好';
      body.innerHTML =
        (M.step === 'adjust' ? brushTools() : '') +
        '<div class="ed-compare">' +
          '<div class="ed-compare-pane"><div class="ed-compare-head"><span>抠图结果</span>' +
            '<label class="ed-mask-toggle"><input type="checkbox" id="mk-mask"' + (M.showMask ? ' checked' : '') + '>叠加蒙版</label></div>' +
            '<div class="ed-compare-stage"><canvas id="cv-left"></canvas></div></div>' +
          '<div class="ed-compare-pane"><div class="ed-compare-head"><span>原图对照</span>' +
            '<span class="t-tiny">被去掉的地方标了色</span></div>' +
            '<div class="ed-compare-stage"><canvas id="cv-right"></canvas></div></div>' +
        '</div>' +
        (M.step === 'adjust' ? '' :
          '<div class="ed-prop-group mt-16">' +
            '<div class="ed-prop-label"><span>背景识别强度</span><span class="hint" id="tol-val">' + M.tol + '</span></div>' +
            '<input class="ed-slider" id="cv-tol" type="range" min="10" max="160" value="' + M.tol + '">' +
            '<p class="hint">边缘去不干净就把数值调大一点；主体被误伤就调小。</p>' +
          '</div>') +
        '<div class="notice notice-mint mt-16" style="display:flex;gap:10px">' +
          '<span class="notice-icon" data-i-n></span>' +
          '<span>左边是直接结果，右边是原图对照。左右两栏都能直接用鼠标涂抹修补。</span></div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-ghost" data-act="cancel">不要这张</button>' +
          '<button class="btn btn-outline" data-act="adjust-step">还得调整</button>' +
          '<button class="btn btn-primary" data-act="apply">放进画布</button>' +
        '</div>';

      setIcon('[data-i-n]', 'info');
      if (M.step === 'adjust') bindBrushUI();
      setupCompareCanvases();

      var tolInput = $('#cv-tol');
      if (tolInput) tolInput.addEventListener('change', function () {
        M.tol = parseInt(tolInput.value, 10);
        $('#tol-val').textContent = M.tol;
        runAI(true);
      });

      var mk = $('#mk-mask');
      if (mk) mk.addEventListener('change', function () { M.showMask = mk.checked; drawCompare(); });

      $$('#matte-body [data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.act;
          if (a === 'cancel') closeMatte();
          else if (a === 'apply') { addImage(Matting.toURL(M.working)); closeMatte(); }
          else if (a === 'adjust-step') { M.step = 'adjust'; renderMatte(); }
        });
      });

    } else if (M.step === 'failed') {
      $('#matte-sub').textContent = '自动抠图没能完成';
      body.innerHTML =
        '<div class="notice notice-danger" style="display:flex;gap:10px"><span class="notice-icon" data-i-f></span>' +
        '<span><b>自动抠图失败</b>，可以自己手动调整，或者直接把原图放进画布。</span></div>' +
        '<div class="ed-origin-preview mt-16"><img src="' + M.src + '" alt=""></div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-ghost" data-act="cancel">不要这张</button>' +
          '<button class="btn btn-outline" data-act="adjust-step">手动调整</button>' +
          '<button class="btn btn-primary" data-act="raw">直接应用原图</button>' +
        '</div>';
      setIcon('[data-i-f]', 'alert');
      $$('#matte-body [data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.act;
          if (a === 'cancel') closeMatte();
          else if (a === 'raw') { addImage(M.src); closeMatte(); }
          else if (a === 'adjust-step') enterAdjustFromRaw();
        });
      });
    }
  }

  function brushTools() {
    return '<div class="ed-brush-tools">' +
      '<button class="ed-brush-chip' + (M.brush.mode === 'erase' ? ' is-active' : '') + '" data-brush="erase">' +
        '<span data-i-e></span>擦掉多余</button>' +
      '<button class="ed-brush-chip' + (M.brush.mode === 'restore' ? ' is-active' : '') + '" data-brush="restore">' +
        '<span data-i-r></span>补回漏掉</button>' +
      '<span class="grow"></span>' +
      '<span class="t-tiny muted">笔刷 <b>' + M.brush.size + '</b></span>' +
      '<input class="ed-slider" id="brush-size" type="range" min="6" max="120" value="' + M.brush.size + '" style="width:120px">' +
      '<button class="btn btn-outline btn-sm" data-act="reset">重置</button>' +
      '</div><div class="divider"></div>';
  }

  function bindBrushUI() {
    setIcon('[data-i-e]', 'edit'); setIcon('[data-i-r]', 'undo');
    $$('#matte-body [data-brush]').forEach(function (b) {
      b.addEventListener('click', function () { M.brush.mode = b.dataset.brush; renderMatte(); });
    });
    var bs = $('#brush-size');
    if (bs) bs.addEventListener('input', function () {
      M.brush.size = parseInt(bs.value, 10);
      $('.ed-brush-tools .t-tiny b').textContent = M.brush.size;
    });
    $$('#matte-body [data-act="reset"]').forEach(function (b) {
      b.addEventListener('click', function () {
        M.working = Matting.cloneImageData(M.base);
        drawCompare();
        UI.toast('已回到自动抠图的结果', 'ok');
      });
    });
  }

  function setupCompareCanvases() {
    var lv = $('#cv-left'), rv = $('#cv-right');
    if (!lv || !rv || !M.working) return;
    lv.width = M.working.width; lv.height = M.working.height;
    rv.width = M.working.width; rv.height = M.working.height;
    drawCompare();
    [lv, rv].forEach(function (cv) {
      var painting = false;
      function paint(e) {
        var r = cv.getBoundingClientRect();
        var sx = cv.width / r.width, sy = cv.height / r.height;
        Matting.stroke(M.working, (e.clientX - r.left) * sx, (e.clientY - r.top) * sy,
                       Math.max(2, M.brush.size * sx), M.brush.mode);
        drawCompare();
      }
      cv.addEventListener('pointerdown', function (e) { painting = true; cv.setPointerCapture(e.pointerId); paint(e); });
      cv.addEventListener('pointermove', function (e) { if (painting) paint(e); });
      cv.addEventListener('pointerup', function () { painting = false; });
      cv.addEventListener('pointercancel', function () { painting = false; });
    });
  }

  function drawCompare() {
    var lv = $('#cv-left'), rv = $('#cv-right');
    if (!lv || !rv || !M.working) return;

    // 左：结果（可叠加透明格）
    var lg = lv.getContext('2d');
    lg.clearRect(0, 0, lv.width, lv.height);
    if (M.showMask) drawChecker(lg, lv.width, lv.height);
    lg.putImageData(M.working, 0, 0);

    // 右：原图 + 被去除区域的高亮
    var rg = rv.getContext('2d');
    rg.clearRect(0, 0, rv.width, rv.height);
    if (M.img) rg.drawImage(M.img, 0, 0, rv.width, rv.height);
    // 用 mask 做柔和覆盖
    var overlay = document.createElement('canvas');
    overlay.width = lv.width; overlay.height = lv.height;
    var og = overlay.getContext('2d');
    var d = M.working.data;
    var od = og.createImageData(lv.width, lv.height);
    for (var i = 0; i < d.length; i += 4) {
      var inv = 255 - d[i + 3];
      od.data[i] = 255; od.data[i + 1] = 122; od.data[i + 2] = 69;
      od.data[i + 3] = inv > 12 ? Math.min(190, inv * 0.75) : 0;
    }
    og.putImageData(od, 0, 0);
    rg.drawImage(overlay, 0, 0);
  }

  function drawChecker(g, w, h) {
    var s = 16;
    for (var y = 0; y < h; y += s) {
      for (var x = 0; x < w; x += s) {
        g.fillStyle = ((x / s + y / s) % 2 === 0) ? '#F1E5D6' : '#FFFFFF';
        g.fillRect(x, y, s, s);
      }
    }
  }

  function runAI(silent) {
    M.step = 'loading';
    renderMatte();
    Matting.removeBackground(M.src, M.tol).then(function (res) {
      M.result = res;
      M.base = Matting.cloneImageData(res.imageData);
      M.working = res.imageData;
      M.step = 'compare';
      renderMatte();
      if (!silent) UI.toast('抠图完成', 'ok');
    }).catch(function (err) {
      M.step = 'failed';
      renderMatte();
    });
  }

  /** 跳过 AI，直接以原图进入手动修补 */
  function enterAdjustFromRaw() {
    Matting.loadImage(M.src).then(function (img) {
      var maxSide = 1100;
      var r = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * r));
      cv.height = Math.max(1, Math.round(img.naturalHeight * r));
      var c = cv.getContext('2d');
      c.drawImage(img, 0, 0, cv.width, cv.height);
      var data = c.getImageData(0, 0, cv.width, cv.height);
      M.base = Matting.cloneImageData(data);
      M.working = data;
      M.step = 'adjust';
      renderMatte();
    }).catch(function () { M.step = 'failed'; renderMatte(); });
  }

  /* ================= 顶部 / 底部按钮 ================= */
  on($('#btn-undo'), undo);
  on($('#btn-redo'), redo);
  on($('#btn-add-text'), function () { addText(); });
  on($('#btn-add-bag'), function () {
    if (!S.objects.length) { UI.toast('画布还是空的，先加点东西吧', 'warn'); return; }
    doSave();
    Store.bag.add(S.work.id, 1);
    UI.refreshBagBadge && UI.refreshBagBadge();
    showAddedModal();
  });
  on($('#btn-save'), function () { doSave(); UI.toast('已保存为草稿', 'ok'); });
  on($('#btn-back'), function () {
    if (S.dirty) doSave();
    location.href = 'home.html';
  });
  on($('#btn-props-close'), function () { select(null); });

  function showAddedModal() {
    var n = Store.bag.count();
    var q = Pricing.quote(n, null);
    showModal('<div class="ed-added-art" style="margin-top:22px">' +
      '<img src="' + Store.assets.svgURI('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="46" fill="#FFEDE3"/><circle cx="50" cy="50" r="30" fill="#FF7A45"/>' +
        '<path d="M34 51l12 12 21-24" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>') + '" alt=""></div>' +
      '<div class="center" style="padding:0 24px">' +
        '<div class="t-h2">已加入结算袋</div>' +
        '<p class="muted t-sm mt-8">结算袋里现在共 <b class="brand-text">' + n + ' 张</b>，' +
        '当前应付 <b class="brand-text">' + Pricing.fmtYuan(q.total) + '</b>' +
        (Pricing.hook(n) ? '<br><span class="t-tiny">' + Pricing.hook(n).text + '</span>' : '') + '</p></div>' +
      '<div class="row gap-8 mt-16" style="padding:0 22px 22px">' +
        '<button class="btn btn-ghost" style="flex:1" data-x>继续创作</button>' +
        '<button class="btn btn-primary" style="flex:1" data-bag>去结算</button>' +
      '</div>');
    $$('#modal [data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    $$('#modal [data-bag]').forEach(function (b) {
      b.addEventListener('click', function () { location.href = 'bag.html'; });
    });
  }

  on($('#btn-zoom-in'), function () { setZoom(S.zoom * 1.15); });
  on($('#btn-zoom-out'), function () { setZoom(S.zoom / 1.15); });
  on($('#btn-fit'), function () { fitToScreen(); render(); });
  on($('#btn-ruler'), function () { S.show.ruler = !S.show.ruler; $('#btn-ruler').classList.toggle('is-on', S.show.ruler); render(); });
  on($('#btn-safe'), function () { S.show.safe = !S.show.safe; $('#btn-safe').classList.toggle('is-on', S.show.safe); render(); });
  on($('#btn-cut'), function () { S.show.cut = !S.show.cut; $('#btn-cut').classList.toggle('is-on', S.show.cut); render(); });
  on($('#btn-bg'), function () {
    S.bg = S.bg === 'white' ? 'gray' : 'white';
    $('#btn-bg').classList.toggle('is-on', S.bg === 'gray');
    render();
  });
  on($('#fb-del'), removeSelected);
  on($('#fb-copy'), duplicateSelected);
  on($('#fb-up'), function () { layerMove('up'); });
  on($('#fb-down'), function () { layerMove('down'); });

  $('#ed-title').addEventListener('input', function () { markDirty(); });

  window.addEventListener('resize', function () { requestRender(); });
  window.addEventListener('beforeunload', function () { if (S.dirty) doSave(); });

  /* ================= Go ================= */
  init();
})();
