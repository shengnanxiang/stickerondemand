/* ============================================================
   SOD Phase 0 演示 · 共享脚本（云端版）
   GitHub Pages 静态托管 + Supabase（Postgres + Realtime）
   - subscribeEvents(fn)：订阅云端变更，回调收到与旧服务器一致的 state
   - SOD.*：业务动作（全部走 SECURITY DEFINER RPC）
   - SOD.startPump()：浏览器端设备仿真泵（摊位屏/控制台调用，幂等）
   ============================================================ */
'use strict';

const SOD = (() => {
  let db = null, channel = null, listeners = [], fetchTimer = null, pumpTimer = null, pollTimer = null, fetching = false;
  let state = null;

  function cfgProblem() {
    const c = window.SOD_CONFIG;
    if (!c || !c.SUPABASE_URL || !c.SUPABASE_ANON_KEY ||
        String(c.SUPABASE_URL).includes('YOUR_') || String(c.SUPABASE_ANON_KEY).includes('YOUR_')) {
      return 'demo/config.js 未配置 Supabase';
    }
    return null;
  }
  function init() {
    if (db) return true;
    if (cfgProblem() || !window.supabase) return false;
    db = window.supabase.createClient(window.SOD_CONFIG.SUPABASE_URL, window.SOD_CONFIG.SUPABASE_ANON_KEY);
    return true;
  }
  function cfgBanner() {
    if (document.getElementById('sod-setup')) return;
    document.body.insertAdjacentHTML('afterbegin', `
      <div id="sod-setup" style="position:fixed;inset:auto 12px 12px 12px;z-index:999;background:#fff;
        border:2px solid #FF7A45;border-radius:14px;padding:16px 18px;font-size:13px;line-height:1.8;
        box-shadow:0 10px 40px rgba(0,0,0,.18);color:#302A24;font-family:system-ui,sans-serif">
        <b>⚙️ 还差一步：连接云端</b><br>
        1. 到 <b>supabase.com</b> 建免费项目<br>
        2. SQL Editor 执行 <b>demo/schema.sql</b><br>
        3. Project Settings → API，把 URL 和 anon key 填进 <b>demo/config.js</b><br>
        4. 提交推送 GitHub（anon key 配合 RLS 可安全公开）<br>
        详见 demo/README.md
      </div>`);
  }

  /* snake_case → camelCase */
  const mapOrder = r => r && {
    id: r.id, queueNo: r.queue_no, code: r.code, designId: r.design_id,
    designName: r.design_name, thumb: r.thumb, copies: r.copies,
    nickname: r.nickname, ch: r.ch, status: r.status, device: r.device,
    createdAt: +new Date(r.created_at), acceptedAt: r.accepted_at ? +new Date(r.accepted_at) : null,
    printingAt: r.printing_at ? +new Date(r.printing_at) : null,
    readyAt: r.ready_at ? +new Date(r.ready_at) : null,
    pickedAt: r.picked_at ? +new Date(r.picked_at) : null
  };
  const mapSession = r => r && { mode: 'booth', name: r.name, ch: r.ch, startedAt: +new Date(r.started_at) };

  async function rpc(name, args) {
    if (!init()) throw new Error(cfgProblem() || 'supabase-js 未加载');
    const { data, error } = await db.rpc(name, args || {});
    if (error) throw error;
    return data;
  }

  async function fetchState() {
    if (fetching || !db) return;
    fetching = true;
    try {
      const [sess, cust, orders, devices] = await Promise.all([
        db.from('demo_sessions').select('*').eq('id', 'current').maybeSingle(),
        db.from('demo_customers').select('id', { count: 'exact', head: true }),
        db.from('demo_orders').select('*').order('created_at', { ascending: false }).limit(200),
        db.from('demo_devices').select('*').order('id')
      ]);
      const os = (orders.data || []).map(mapOrder);
      state = {
        session: mapSession(sess.data),
        stats: {
          customers: cust.count || 0,
          orders: os.length,
          ready: os.filter(o => o.status === 'ready').length,
          picked: os.filter(o => o.status === 'picked').length,
          printing: os.filter(o => o.status === 'accepted' || o.status === 'printing').length
        },
        orders: os,
        devices: (devices.data || []).map(d => {
          const mine = os.filter(o => o.device === d.id && o.status === 'printing')
                         .sort((a, b) => a.readyAt - b.readyAt);
          return { id: d.id, name: d.name, done: d.done, busy: mine.length > 0, load: mine.length,
                   current: mine[0] ? mine[0].queueNo : null };
        })
      };
      listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
    } catch (e) { console.error('fetchState', e); }
    finally { fetching = false; }
  }
  function refetch() { clearTimeout(fetchTimer); fetchTimer = setTimeout(fetchState, 250); }

  return {
    subscribe(fn) {
      if (!init()) { cfgBanner(); fn({ session: null, stats: { customers: 0, orders: 0, ready: 0, picked: 0, printing: 0 }, orders: [], devices: [] }); return null; }
      listeners.push(fn);
      if (!channel) {
        channel = db.channel('sod-demo')
          .on('postgres_changes', { event: '*', schema: 'public' }, refetch)
          .subscribe(st => { if (st === 'SUBSCRIBED') refetch(); });
      }
      if (!pollTimer) pollTimer = setInterval(fetchState, 5000); /* Realtime 断线兜底：定时全量拉 */
      fetchState();
      return { unsubscribe() { listeners = listeners.filter(f => f !== fn); } };
    },
    startSession(name) { return rpc('demo_start_session', { p_name: name }).then(s => { refetch(); return mapSession(s); }); },
    acquireCustomer(nickname, ch) { return rpc('demo_acquire_customer', { p_nickname: nickname, p_ch: ch }); },
    createOrder(o) {
      return rpc('demo_create_order', {
        p_design_id: o.designId, p_design_name: o.designName, p_thumb: o.thumb,
        p_copies: o.copies, p_nickname: o.nickname, p_ch: o.ch
      }).then(r => { refetch(); return mapOrder(r); });
    },
    acceptOrder(id) { return rpc('demo_accept_order', { p_id: id }).then(r => { refetch(); return mapOrder(r); }); },
    assignOrder(id, device) { return rpc('demo_assign_order', { p_id: id, p_device: device }).then(r => { refetch(); return mapOrder(r); }); },
    async pickup(id, code) {
      const r = await rpc('demo_pickup_order', { p_id: id, p_code: code });
      refetch();
      return r === 'ok' ? { ok: true } : { err: r };
    },
    reset() { return rpc('demo_reset').then(() => refetch()); },
    /* 设备仿真泵：任何开着的摊位屏/控制台浏览器驱动，幂等可多端 */
    startPump() {
      if (pumpTimer) return;
      pumpTimer = setInterval(() => { rpc('demo_pump').catch(() => {}); }, 2500);
    }
  };
})();

/* 页面兼容入口（旧版签名一致） */
function subscribeEvents(onState) { return SOD.subscribe(onState); }

/* ---------- 预设贴纸设计（无 IP，内联 SVG，模拟「已上传并设计好的图片」 ---------- */
const DESIGN_LIB = [
  {
    id: 'd1', name: '毛孩子 · 猫爪贴纸',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500">
      <rect width="700" height="500" rx="0" fill="#FFEBD8"/>
      <circle cx="350" cy="235" r="150" fill="#FFCFA8"/>
      <ellipse cx="350" cy="300" rx="118" ry="98" fill="#FF7A45"/>
      <circle cx="255" cy="170" r="52" fill="#FF7A45"/><circle cx="315" cy="132" r="52" fill="#FF7A45"/>
      <circle cx="385" cy="132" r="52" fill="#FF7A45"/><circle cx="445" cy="170" r="52" fill="#FF7A45"/>
      <path d="M330 278a14 14 0 0 1 40 0" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round"/>
      <circle cx="316" cy="258" r="9" fill="#fff"/><circle cx="384" cy="258" r="9" fill="#fff"/>
      <text x="350" y="435" text-anchor="middle" font-size="46" font-weight="800" fill="#7A4A2B" font-family="sans-serif">毛孩子贴纸</text>
    </svg>`
  },
  {
    id: 'd2', name: '推し活 · 应援徽章',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500">
      <rect width="700" height="500" fill="#F6E9FA"/>
      <rect x="90" y="80" width="520" height="340" rx="36" fill="#C9A9F0" opacity=".35"/>
      <path d="M350 96l40 96 106 14-78 74 20 104-88-48-88 48 20-104-78-74 106-14Z" fill="#9C7CE0"/>
      <path d="M182 122l18 44 46 6-34 32 9 47-39-21-39 21 9-47-34-32 46-6Z" fill="#EFB33F"/>
      <text x="350" y="470" text-anchor="middle" font-size="42" font-weight="800" fill="#6D49BE" font-family="sans-serif">推し活徽章</text>
    </svg>`
  },
  {
    id: 'd3', name: '旅行 · 行李牌',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500">
      <rect width="700" height="500" fill="#E4F0F8"/>
      <path d="M148 118h404l-56 264H204Z" fill="#5B9FD6"/>
      <circle cx="350" cy="118" r="34" fill="none" stroke="#2F6E9F" stroke-width="14"/>
      <rect x="236" y="196" width="228" height="18" rx="9" fill="#E7F1FA" opacity=".9"/>
      <rect x="252" y="240" width="196" height="14" rx="7" fill="#E7F1FA" opacity=".7"/>
      <rect x="252" y="272" width="150" height="14" rx="7" fill="#E7F1FA" opacity=".55"/>
      <text x="350" y="452" text-anchor="middle" font-size="42" font-weight="800" fill="#2F6E9F" font-family="sans-serif">旅行行李牌</text>
    </svg>`
  },
  {
    id: 'd4', name: '咖啡 · 杯贴',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500">
      <rect width="700" height="500" fill="#F4EBE0"/>
      <circle cx="350" cy="228" r="132" fill="#FFF" stroke="#6F4E37" stroke-width="10"/>
      <path d="M310 228c0-30 18-48 40-48s40 18 40 48-18 62-40 62-40-32-40-62Z" fill="#6F4E37"/>
      <path d="M282 168c-18-14-18-38 0-52M418 168c18-14 18-38 0-52" stroke="#C89F7B" stroke-width="12" fill="none" stroke-linecap="round"/>
      <text x="350" y="446" text-anchor="middle" font-size="42" font-weight="800" fill="#6F4E37" font-family="sans-serif">今日份咖啡</text>
    </svg>`
  },
  {
    id: 'd5', name: '生日 · 蛋糕贴',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500">
      <rect width="700" height="500" fill="#FCEDEE"/>
      <rect x="170" y="238" width="360" height="150" rx="22" fill="#F5A3A3"/>
      <rect x="196" y="196" width="308" height="52" rx="18" fill="#FFD9E8"/>
      <rect x="270" y="108" width="26" height="76" rx="10" fill="#9C7CE0"/>
      <rect x="337" y="88" width="26" height="96" rx="10" fill="#EFB33F"/>
      <rect x="404" y="108" width="26" height="76" rx="10" fill="#5B9FD6"/>
      <ellipse cx="350" cy="410" rx="150" ry="16" fill="#F5A3A3" opacity=".4"/>
      <text x="350" y="470" text-anchor="middle" font-size="42" font-weight="800" fill="#D96C7B" font-family="sans-serif">生日快乐贴</text>
    </svg>`
  }
];
function designById(id) { return DESIGN_LIB.find(d => d.id === id) || DESIGN_LIB[0]; }
function designThumbURI(d) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(d.svg); }

/* ---------- 状态文案 ---------- */
const ORDER_STATUS = {
  pending: { text: '待接单', cls: 'pill-gray' },
  accepted: { text: '已接单', cls: 'pill-sky' },
  printing: { text: '制作中', cls: 'pill-brand' },
  ready:    { text: '可取货', cls: 'pill-sun' },
  picked:   { text: '已自提', cls: 'pill-mint' }
};
const STATUS_ORDER = ['pending', 'accepted', 'printing', 'ready', 'picked'];

/* ---------- 工具 ---------- */
function fmtClock(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => (n < 10 ? '0' + n : '' + n);
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2200);
  setTimeout(() => t.remove(), 2600);
}

/* 简易路由参数 */
function qs(name) {
  return new URLSearchParams(location.search).get(name);
}
