---
name: 内部战略叙事文稿 BRIEF.md + C-internal 幻灯片
overview: 按用户五章逻辑（市场→用户→定义卖点→终局阶段→Phase 0 详规）+ 两章补充（UE 经济框架、「为什么不」清单）撰写要点式内部战略文稿 documents/BRIEF.md，用户核对后制作深色幻灯片式 HTML（pitch/C-internal/，复用现有 deck 引擎）用于内部沟通；同步 PLATFORM.md 双入口对照口径。
design:
  architecture:
    framework: html
    component: mui
  styleKeywords:
    - 深色演示风格
    - 极简专业
    - 大字号要点
    - 每页一论点
    - 数据表格化
    - 高对比强调色
  fontSystem:
    fontFamily: Roboto, sans-serif
    heading:
      size: 44px
      weight: 600
    subheading:
      size: 24px
      weight: 500
    body:
      size: 18px
      weight: 400
  colorSystem:
    primary:
      - "#5B8DEF"
      - "#7CE0C0"
    background:
      - "#0E1116"
      - "#161B22"
      - "#1B212B"
    text:
      - "#D8DDE8"
      - "#F1F4FA"
    functional:
      - "#E0B34A"
      - "#E06C75"
todos:
  - id: write-brief-doc
    content: 撰写 documents/BRIEF.md 七章文稿：市场破绽、双入口用户、定义卖点、终局三阶段、Phase 0 十二周详规、UE 框架、为什么不清单
    status: completed
  - id: brief-checkpoint
    content: 提交文稿供用户核对，按反馈迭代定稿（HTML 制作的前置关卡）
    status: completed
    dependencies:
      - write-brief-doc
  - id: build-internal-deck
    content: 制作 pitch/C-internal/ 深色幻灯片：复制 deck 引擎、约 22 页内容映射、微调主题色
    status: completed
    dependencies:
      - brief-checkpoint
  - id: sync-platform-doc
    content: 同步 PLATFORM.md 双入口口径：§7 注记、§8.1 双线冷启动、Gate 0 双入口对照报告
    status: completed
    dependencies:
      - brief-checkpoint
  - id: provide-commit-info
    content: 校验三文档口径一致后，提供中文 git commit Summary 与 Description
    status: completed
    dependencies:
      - build-internal-deck
      - sync-platform-doc
---

## 产品概述

一份面向内部沟通的战略叙事文档 `documents/BRIEF.md`，按「市场 → 用户 → 定义与卖点 → 终局与阶段 → Phase 0 详规」五章逻辑讲透 SOD 战略，另补两章：UE 单均经济框架、「为什么不」负面清单。行文只讲要点、不啰嗦，要点表格化，每章以「机会结论」收口。

文稿核对通过后，制作深色幻灯片分页式 HTML（键盘←→翻页、投屏演示、每页一论点、大字号要点），替代 PPT 用于内部沟通。

## 核心内容

- **市场章（聚焦国内）**：市场规模 → 格局四类玩家（一体机硬件 / 柔造映糖若映等平台型 / 淘宝闲鱼代做小作坊 / 线下投放点）→ 逐家破绽（生产排队 / 按批不按张 / 无亲手 / 隐私 / 1500 元门槛）→ 竞争机会：「快 + 亲手 + 按张」三角真空
- **用户章（双入口对照）**：双 ICP 并行不预设主次——亲子+毛孩子家长线（商场快闪 + 宝妈社群）vs 谷圈线（小红书 + 漫展），Phase 0 分渠道 CAC 数据定主次；隐私痛点在亲子宠物线最锐利（照片即隐私）
- **定义与卖点章**：一句话定义（在线创作—下单—当日到手）+ 卖点 = 竞争破绽 × 用户痛点交集，当期主叙事「快、亲手、按张」
- **终局与阶段章**：消费端创作平台 + 分布式微产能履约网络；三阶段（Phase 0 单城自营验证 / Phase 1 供给扩张 / Phase 2 平台飞轮）各一句话目标 + Gate
- **Phase 0 详规（最大篇幅）**：战略目标、当期卖点定义、12 周战术（备战 / 双线冷启动 / 提频对照 / Gate 评审）、工作拆解、Gate 0 九项指标 + 双入口对比、数据采集计划
- **UE 框架章**：单均成本结构（耗材/配送/履约人力/通道费）、毛利模型、敏感变量；具体数字待实测，框架先行
- **「为什么不」章**：不打价格战 / 不先做小程序 / 不买现成后台 / MVP 不做 AI 生图 / 不补贴 / Phase 0 不上常驻 kiosk——内部质疑预答复
- **工作流**：文稿先行 → 用户核对 checkpoint → HTML 制作 → PLATFORM.md 双入口口径同步 → 提供 git commit 信息（中文 Summary + Description）

## 视觉效果

深色演示风格幻灯片（约 20-24 页），每页一个论点、大字号要点、表格与卡片化信息层级，复用现有路演 deck 的成熟观感，浏览器直接打开、键盘翻页投屏演示。

## 技术栈

- 文稿：Markdown（`documents/BRIEF.md`），行文风格对齐 PLATFORM.md v2.1（要点表格化、可回溯标注调研章节号）
- 幻灯片：纯静态 HTML + CSS + 原生 JS，零依赖、浏览器直接打开；复用 `pitch/A-investor/` 的成熟 deck 架构（`main.js` 引擎自述 "shared deck engine (A & B versions identical)"）

## 实现方案

### 文稿 `documents/BRIEF.md`（7 章，先行交付）

1. **市场**：谷子经济规模 → 四类玩家表 → 破绽逐家点列（柔造生产排队共性痛点、若映 ¥0.99 特价锚点、代做无参与感/隐私风险、一体机 1500 元门槛）→ 结论：「快 + 亲手 + 按张」三角真空无人占住
2. **用户**：双 ICP 对照表前置（不预设主次）→ 两线场景细分（亲子成长记录 / 宠物贴纸贴猫爬架手机壳 / 无料痛包 / 手帐装饰）→ 痛点四条 → 结论：亲子宠物线竞争真空 + 谷圈线供给缺口，双线并行数据定主次
3. **定义与核心卖点**：一句话定义（对齐 SOD.md v2.1「在线创作—下单—当日到手」）+ 卖点交集逻辑 + 当期主叙事
4. **终局与阶段**：终局一句话 + 三阶段各一句话目标 + Gate + 时间轴
5. **Phase 0 详规**：战略目标三条（付费意愿验证 / 当日达履约 / 双入口定主次）→ 当期卖点一句话 → 12 周战术 → 工作拆解清单 → Gate 0 九项指标（口径与 PLATFORM.md §8.1 完全一致）+ 双入口分渠道对比 → 数据采集计划（飞书表格字段 / 分渠道追踪 / UE 账本）
6. **UE 单均经济框架**：成本结构 / 收入侧 / 毛利模型 / 敏感变量（自提占比省配送、复购摊获客）；标注「待 Phase 0 实测」
7. **「为什么不」负面清单**：六条预答复，每条一句话立场 + 一句话理由

内容纪律：不新增未经三份调研支持的断言；引用可回溯（标注调研章节号）；CAC 参照锚沿用 SOD.md 测算（期望 1.60 元/人）。

### 幻灯片 `pitch/C-internal/`（文稿核对通过后）

- 结构同 A-investor：`index.html`（`.slide` section + `data-chapter`）+ `css/style.css`（复制后微调 accent 色区分用途）+ `js/main.js`（引擎原样复制：键盘 / 触摸 / 章节导航 / 进度条 / hash 定位）
- 约 20-24 页：封面 1 + 市场 3 + 用户 3 + 定义卖点 2 + 终局阶段 2 + Phase 0 约 6 + UE 2 + 为什么不 2 + 收尾 1
- `pitch/shared/scenes/` 的 parenting / pet SVG 用于双入口页
- 组件复用：`.grid2/3/4`、`.data` 表格、`.do-yes/.do-no`（为什么不章天然适配）、`.formula`（UE 章）、`.pain/.need`

### 关键决策

- **复用而非新建**：A-investor deck 已在真机验证过（投屏 / 触摸 / hash），复制架构零风险、风格延续品牌一致性；不引入构建工具、不引入框架——内部沟通工具，KISS
- **BRIEF.md 独立成文**而非改写 PLATFORM.md：受众与用途不同（内部沟通叙事 vs 战略宪法），但所有口径以 PLATFORM.md v2.1 为唯一事实源，Gate 0 指标数字不偏离
- **双入口对照是战略级决策**：文稿反映后需小幅同步 PLATFORM.md（非纯叙事），防止两文档口径漂移

## 执行注意

- 文稿先行是用户明示的 checkpoint——HTML 制作不得在核对通过前启动
- UE 章只锁框架与量级纪律，具体数字一律标「待 Phase 0 实测」，避免编造数字进内部材料
- Gate 0 指标（周订单 ≥100 / 转化 ≥8% / 复购 ≥15% / UE 边际 ≥0 / SOP 文档化 / 当日达兑现率 ≥80% / 自提占比 ≥40% / 私域沉淀率 ≥25% / 双入口对照报告）从 PLATFORM.md §8.1 原样引用，不二次转译产生偏差
- HTML 深色主题沿用现有 CSS 变量体系，只改色值不改结构，保证 A/B/C 三 deck 可维护性
- 完成后提供中文 git commit Summary + Description（用户固定偏好）

## 目录结构

```
stickerondemand/
├── documents/
│   ├── BRIEF.md              # [NEW] 内部战略叙事文稿（7 章，要点式）
│   └── PLATFORM.md           # [MODIFY] 双入口口径同步：§7 双 ICP 注记、§8.1 W3-6 双线冷启动、Gate 0 线下对照升级为双入口对照报告
└── pitch/
    └── C-internal/
        ├── index.html        # [NEW] 约 20-24 页幻灯片主体（.slide + data-chapter 结构）
        ├── css/
        │   └── style.css     # [NEW] 复制 A-investor 主题，微调 accent 色区分用途
        └── js/
            └── main.js       # [NEW] deck 引擎原样复制（键盘/触摸/章节导航/进度条/hash）
```

## 设计方案

深色演示风格幻灯片，延续 SOD 现有路演 deck 的视觉语言（品牌一致性），微调 accent 色区分「内部沟通」用途。每页一个论点、大字号要点、eyebrow-kicker-lead 三级排版层级；数据用表格、结论用高亮块、Phase 0 用时间轴式布局。双入口页用 parenting/pet SVG 场景插画区分两条人群线。

### 页面规划（约 22 页）

- 封面 + 议程导航（1-2 页）
- **第一章 市场**（3 页）：规模与格局 / 四类玩家与破绽表 / 竞争机会结论（三角真空大字页）
- **第二章 用户**（3 页）：双 ICP 对照表（不预设主次）/ 两线场景细分（插画）/ 痛点与用户机会
- **第三章 定义与卖点**（2 页）：一句话定义大字页 / 卖点交集逻辑
- **第四章 终局与阶段**（2 页）：终局一句话 + 三阶段时间轴
- **第五章 Phase 0**（6 页）：战略目标 / 当期卖点定义 / 12 周战术 / 工作拆解 / Gate 0 指标表 + 双入口对比 / 数据采集计划
- **第六章 UE 框架**（2 页）：成本结构与毛利模型（公式块）/ 敏感变量
- **第七章 为什么不**（2 页）：做与不做对照块 ×2
- 收尾（1 页）：一句话总结 + 下一步行动

### 交互

键盘 ←→ / 空格 / PageUp/Down 翻页、触摸滑动、右侧章节导航、底部进度条、hash 定位（#s{n}）直达任意页——全部复用现有 deck 引擎。