# SOD Phase 0 演示 · 云端版

活动场景（0a）全流程可交互演示：**观众手机扫码 → 模拟微信授权获客 → 选预设设计 → 下单支付 → 排队/打印仿真 → 推送提醒 → 凭码取件**，摊位屏、运营控制台、手机页三方实时联动。

**架构**：GitHub Pages（静态托管，观众用流量即可访问，无需同一 Wi-Fi）+ Supabase 免费档（Postgres + Realtime 实时同步 + SECURITY DEFINER RPC 业务函数）。打印仿真由浏览器端泵循环驱动（`demo_pump()`，幂等，多端同时开着也安全）。

## 上线三步（约 10 分钟）

### 1. Supabase 建库

1. 到 [supabase.com](https://supabase.com) 注册并**新建项目**（免费档够用，区域选离你近的，如 Tokyo/Singapore）
2. 项目打开后进入 **SQL Editor**，把 [`demo/schema.sql`](schema.sql) 整段粘贴执行
3. 进入 **Project Settings → API**，记下两个值：
   - `Project URL`（形如 `https://xxxx.supabase.co`）
   - `anon public` key

### 2. 填配置

把上述两个值填进 `demo/config.js`（该文件**随仓库部署**——anon key 配合 RLS 只读策略可安全公开，GitHub Pages 需要它在线上存在）：

```js
window.SOD_CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...'   // anon key 配合 RLS 只读策略可安全公开
};
```

### 3. 推送 GitHub

```bash
git add . && git commit -m "demo: 云端化改造" && git push
```

GitHub Pages 已启用（`https://shengnanxiang.github.io/stickerondemand/demo/`），push 后等 1-2 分钟生效。

## 演示角色分工

| 页面 | 角色 | 打开方式 |
|---|---|---|
| `/demo/index.html` | 开场 | 你，电脑浏览器 |
| `/demo/booth.html` | **摊位屏** | 投影给观众，二维码自动指向线上地址 |
| `/demo/console.html` | **运营控制台** | 你操作：接单 → 选设备 → 核码取件 |
| `/demo/m.html?ch=…` | **观众手机** | 扫摊位屏二维码（手机流量即可） |

> 摊位屏或控制台**任一页面开着**，打印仿真就会自动推进（浏览器泵每 2.5 秒调一次 `demo_pump()`）。演示时别把两个页面全关了，否则订单会停在「制作中」。

## 本地预览（可选）

```bash
npx serve demo
# 或任何静态服务器，如 python -m http.server -d demo 8080
```

> 本地预览时二维码会指向 `localhost`，手机扫不了——正式演示请用 GitHub Pages 线上地址。

## 与正式设计的对应

| 演示行为 | 正式设计 |
|---|---|
| 摊位屏二维码 → 手机 H5 | `FULFILLMENT-PRD.md` 渠道链接 |
| 模拟微信授权获客 | 服务号/开放平台网页授权 |
| 排队号（服务端发号） | 排队/打印调度服务 |
| 打印仿真（8–14 秒/份） | 打印队列 + Liene S1 真机任务 |
| 取件码核验（错误码拦截） | 取件核验流程 |
| 模拟服务号推送 | 服务号模板消息/短信 |

## 常见问题

- **页面底部弹出配置提示**：`config.js` 没填或没加载（检查是否被 `.gitignore` 忽略后忘记本地填写）
- **实时状态不更新**：Supabase 项目可能暂停（免费档一周不活动会 pause），到 Dashboard 点 Restore
- **想要全新数据**：控制台右上角「重置演示」按钮（调 `demo_reset()`）
