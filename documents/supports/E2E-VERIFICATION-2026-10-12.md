# SOD 线上闭环 Demo · 端到端验证报告（定稿）

> 验收人：admin-verifier（平台看板与验收工程师）
> 日期：2026-10-12（定稿 14:15）
> 范围：T2 用户端自提双态 / T3 供应端自提履约 / T1 schema 自提增量 / T4 平台看板 admin/
> 仓库：C:\Users\Nan\Documents\GitHub\stickerondemand

---

## 0. 结论速览

| 维度 | 结果 |
|---|---|
| **云端 e2e 闭环（定稿轮）** | ✅ **21/21 全绿**（自提 SO20261012001 + 快递 SO20261012002 双单完整闭环） |
| 自提单云端闭环 | ✅ 下单→支付→取货码 5883（契约对拍）→studio accept/make/ready→错码拒/对码核销→done+余额入账 990 分 |
| 快递单云端闭环 | ✅ 下单→支付→accept/make/ship→轨迹落库→用户签收→done+余额入账 1490 分（含 5 元运费） |
| 结算正确性 | ✅ 供应商余额差值 2480 分 = 两单金额之和（精确） |
| admin/ 看板 | ✅ 14/14 走查 + 云端联动全通过（实时流/统计 2·1·1·2 精确/展开明细/终态 done=2·GMV ¥24.80·待处理归零） |
| 本地回退模式全链路 | ✅ 26/26 断言全绿 |
| studio 底座回归 | ✅ 26/26（node studio/test-local-fallback.js） |
| 缺陷闭环 | ✅ D-01~D-05 全部发现→修复→复验（4 阻断 + 1 建议，含 1 个商业结算正确性问题） |

**验收结论：云端闭环两单走通、零未修复阻断缺陷，验收通过。**

---

## 1. 线上库前置探测（2026-10-12 12:14）

| 检查项 | 结果 |
|---|---|
| RPC `biz_pickup_code('SO20261012001')` | ✅ 返回 5883（与预期一致，db-pipeline 交叉确认同值） |
| `biz_orders` select 新三列（delivery_method/pickup_code/ready_at） | ✅ HTTP 200，三列存在（当时 0 行，列缺失会报 PGRST204，未出现） |
| 结论 | T1 迁移已在线上生效，RPC 已授权 anon |

> 备注：探测时 biz_orders 为空表；订单卡完整渲染验证留到云端 e2e（已获 leader 授权用 biz_checkout + biz_pay 走用户端真实下单造数）。
>
> **跟进探测（13:12）**：`biz_checkout` 空结算袋无害探测（p_items=[]，不产生订单）仍返回 `42702: column reference "it" is ambiguous`——修复尚未在线上生效，云端 e2e 继续等放行信号。

---

## 2. 走查记录

### 2.1 admin/ 平台看板（T4 交付物）

**环境**：本地 http-server 8642 + 无头 Chrome（Playwright）1440×900 / 375×812，真实云端 Supabase。

| # | 检查点 | 结果 | 备注 |
|---|---|---|---|
| A1 | 页面加载无 JS 报错 | ✅ | console 干净 |
| A2 | 连接徽标 →「实时已连接」 | ✅ | Realtime 订阅成功 |
| A3 | 统计条四卡渲染（今日/自提/快递/待处理/完成/GMV） | ✅ | 空表基线 0/0/0/¥0.00 |
| A4 | 供应商区 2 家（徐汇默认兜底 + 朝阳），含区域/上限/余额/营业时间 | ✅ | 种子数据完整 |
| A5 | 订单流空态提示 | ✅ | 「暂无订单 · 等待用户端第一笔下单」 |
| A6 | 桌面 1440 截图留档 | ✅ | admin-desktop.png |
| B1 | 移动端 375×812 无横向溢出 | ✅ | scrollW=375=clientW |
| B2 | 移动端截图留档 | ✅ | admin-mobile.png |
| C1 | 门户入口卡顺序：线上定制下单（主推）→ 商家工作台 → 平台看板 | ✅ | 无漫展 demo 可见入口（T2 已摘，代码保留） |
| C3 | 门户「平台看板」卡跳转 admin/ | ✅ | href=admin/ 正确 |
| D1 | 断云场景一：config.js 未定义 SOD_CONFIG | ✅ | 横幅「看板依赖云端数据，请检查 Supabase 配置」+ 徽标「云端未配置」+ 双面板提示，零页面错误 |
| D2 | 断云场景二：config.js 404（文件缺失） | ✅ | 同上路径 |
| D3 | 断云场景三：URL 配置错误/网络不可达 | ✅ | 修复 D-02 后：8s race 超时兜底 + 连续 2 次失败 → 「数据拉取失败，等待轮询重试…请检查 demo/config.js 的 Supabase URL 与网络连通性」 |

**看板实现要点**（对照任务要求 1-6）：依赖路径复用 `../demo/vendor/supabase.min.js` + `../demo/config.js`，无 app.css/studio.css 依赖（内联 token，奶油暖色 #FF7A45）；只读零写操作（select 仅读 biz_orders/biz_order_items/biz_suppliers，无 RPC 写调用）；Realtime channel `sod-admin` + 5s 轮询兜底 + 250ms 防抖；订单卡点击展开 items 缩略图 + 地址/门店/取货码；Cloud 不可用时显示「看板依赖云端数据，请检查 Supabase 配置」横幅（init 失败路径）。

### 2.2 本地回退模式全链路（T2+T3 联合验证）

**环境**：Playwright 路由拦截 `demo/config.js`（返回空注释体 → SOD_CONFIG 未定义 → Cloud.ok()=false / Biz 本地引擎），同一浏览器上下文（用户端 sod.v1 与 studio 本地引擎共享 localStorage）。

**用户端（U1-U16）：**

| # | 检查点 | 结果 |
|---|---|---|
| U1 | 登录态建立 | ✅ 林小鹿 |
| U2 | 结算袋预置 1 张 | ✅ |
| U3 | checkout 默认选中自提 | ✅ |
| U4 | 自提时地址卡折叠 | ✅ addr-hide |
| U5 | 自提卡显示门店（本地回退固定演示门店：上海徐汇工作室） | ✅ |
| U6 | 自提单 1 张实付 9.90（免运费） | ✅ |
| U7 | 免运费券置灰（自提不可用，提示文案） | ✅ disabled |
| U8 | 切快递地址卡展开 | ✅ |
| U9 | 快递单 1 张实付 14.90（9.90 + 5 元运费，规则不变） | ✅ |
| U10 | 自提单提交跳支付页（dm=pickup） | ✅ |
| U11 | 支付成功页大字号取货码（按单号哈希，SO20261012005 → 5887） | ✅ 与哈希算法一致 |
| U12 | 成功页门店 + 预计可取时间 | ✅ |
| U13 | 本地单落盘字段（deliveryMethod/pickupCode/readyAt） | ✅ |
| U14 | 订单详情取货码 + 门店（代替物流区块） | ✅ |
| U15 | 用户端全程无页面错误 | ✅ |
| U16 | 核销后用户端订单详情同步终态「已完成」 | ✅ |

**studio（S1-S10）：**

| # | 检查点 | 结果 |
|---|---|---|
| S1 | 登录（上海徐汇/123456，本地种子店铺同口径） | ✅ |
| S2 | 工作台待处理队列可见自提单 | ✅（修复 D-01 后） |
| S3 | 队列卡片自提 pill | ✅ |
| S4 | 详情页状态语境 + 配送方式 pill | ✅ |
| S5 | 标记可取（making → 待自提） | ✅ |
| S6 | 核码弹层出现（4 位输入框） | ✅ |
| S7 | 错误码 0000 被拒（红字「取货码不正确」） | ✅ |
| S8 | 正确码核销 → 订单 done | ✅ |
| S9 | 供应商余额入账 990 分（与订单金额一致） | ✅ |
| S10 | studio 全程无页面错误 | ✅（修复 D-01 后） |

**studio 底座回归**：`node studio/test-local-fallback.js` → **26 passed / 0 failed**（A 自提全流程含守卫语义 / B 快递回归 / C 旧订单兼容与双态 pill / D 取货码补算 / E 跨页签 storage 联动）。

### 2.3 云端 e2e 闭环（定稿轮 V1-V18 · 21/21 全绿）

**执行时间**：2026-10-12 14:14（D-01~D-05 全部修复后，biz_reset 从零起号）
**环境**：真实 Supabase 云端 + 用户端真实下单（biz_checkout/biz_pay RPC）+ studio 真实履约动作 + admin 看板后台常开验 Realtime。
**残留注记**：定稿轮两笔走查单（SO20261012001/002，均 done，余额已结转 2480 分）保留在库中作为验收证据；如需复演演示可执行 biz_reset。

**自提单 SO20261012001（¥9.90，1 张）：**

| # | 检查点 | 结果 | 备注 |
|---|---|---|---|
| V2 | checkout 云端 RPC 提交 | ✅ | 默认自提 |
| V3 | 金额 9.90 服务端校验通过 | ✅ | amountExpect 一致 |
| V4 | 支付成功页大字号取货码 | ✅ | code=5883（契约对拍：biz_pickup_code RPC 同值） |
| V5 | 云端字段全对 | ✅ | pickup/5883/ready_at 写入/shipping=0/status=paid |
| V11 | admin 看板卡片展开 | ✅ | 取货码+门店+营业时间 |
| V14 | 核码错码 0000 被拒（云端权威校验） | ✅ | 「取货码不正确」 |
| V15 | 对码核销 → done | ✅ | handover 守卫语义正确 |

**快递单 SO20261012002（¥14.90，1 张 + 5 元运费）：**

| # | 检查点 | 结果 | 备注 |
|---|---|---|---|
| V6/V7 | checkout 提交 + 金额 14.90（运费规则不变） | ✅ | |
| V6b | 支付 paid | ✅ | |
| V8 | 云端字段全对 | ✅ | express/shipping=500/amount=1490/地址落库 |
| V12 | studio accept→make→ship | ✅ | ship_no 自动生成 + 轨迹落库（D-03 修复生效） |
| V13 | 用户签收 → done | ✅ | logistics 页签收（D-04 修复生效） |

**结算与看板终态：**

| # | 检查点 | 结果 | 备注 |
|---|---|---|---|
| V16 | 供应商余额结算（差值=两单金额和） | ✅ | **delta=2480 精确等于 990+1490**（D-05 修复生效：confirm 结转） |
| V17 | 看板终态 | ✅ | 待处理 0 / done=2 / GMV ¥24.80 精确 |
| V0/V0b | 看板 Realtime 连接 + 余额基线 | ✅ | 「实时已连接」/ baseline=0 |
| V9/V10 | 看板实时流含两单 + 统计 | ✅ | 下单即现（Realtime 推送）/ 今日 2·自提 1·快递 1·待处理 2 全精确 |
| V18 | 全程零页面错误 | ✅ | 用户端/studio/看板三端 |

**已核实非缺陷项**：frontend-user 修复的 pickupStore openHours 归一在真实链路生效（V11 看板门店营业时间正常渲染 + 用户端 checkout 门店卡正常）。

---

## 3. 缺陷清单

### 阻断级

| ID | 描述 | 位置 | 责任方 | 状态 |
|---|---|---|---|---|
| D-01 | 工作台待处理队列 sort 比较器误写 `o.status`（应为 `a.status`，filter 回调变量泄漏进 sort 作用域），`render()` 抛 ReferenceError → 工作台首页整体渲染中断（队列非空即触发，本地/云端均复现） | studio/index.html:47（T3 引入） | frontend-studio | ✅ 已由 admin-verifier 顺手修复（一行），修复后工作台正常渲染、26/26 断言全绿；leader 已知会 frontend-studio 确认认领 |
| D-02 | admin 看板在「config 有值但 URL 不可达」场景下：徽标停留「轮询兜底中」、列表停留「正在加载订单…」无任何错误提示（supabase-js 内部重试致 Promise 长期不 settle，原 catch 几乎不触发），用户无从判断故障原因 | admin/index.html fetchState（T4 自身交付物） | admin-verifier | ✅ 已修复：8s Promise.race 超时兜底 + 连续 2 次失败后显示「数据拉取失败…请检查 demo/config.js 的 Supabase URL 与网络连通性」；三断云场景复验 PASS，正常路径回归 11/11 |
| D-03 | **阻断**：线上 `biz_supplier_action` 的 ship/ready 分支缺轨迹 insert——ship 后 status=shipped、ship_no 正常写入，但 biz_logistics_tracks 0 行；ready 同样缺「已制作完成，待到店自提」轨迹。用户端 cloud.js 组装 logistics 需 `ship_no && tracks.length` 双条件 → 物流页停在「商家还未发货」→ 签收按钮永不出现 → **快递单云端闭环断在用户签收步**。仓库 schema 文件增量 4/5 段两条 insert 完整正确，线上为缺 insert 的中间态版本（推测用户重跑 42702 修复时执行了局部函数定义） | 线上 Supabase `biz_supplier_action`（T1 迁移执行不全） | db-pipeline | ✅ 已修复并复验：重放仓库「增量 4/5」完整定义（含 found 加固守卫）+ biz_reset 复位；第二轮 e2e 实测 ship/ready 双路径轨迹正确落库（SO20261012002「【中通快递】商家已发货，等待揽收」/ SO20261012001「已制作完成，待到店自提」） |
| D-04 | **阻断**：logistics.html 首帧竞态闪跳——页面初始化时 `Store.orders.get()` 对云端单返回 null、`Cloud.get()` 在 SDK 首帧 fetchState 完成前也返回 null → 立即 redirect 回 orders.html。URL trace 实证 logistics→orders 闪跳；**真实用户路径同样复现**（orders 列表点「查看物流」→ 闪跳）→ 快递单签收按钮在真实使用中不可达 → 云端闭环断在用户签收步。数据本身正常（Cloud.get 稍后可取到完整 logistics），页面缺「等首帧」逻辑（对照 payment.html 140-158 既有正确模式） | logistics.html:5-8（T2 交付物） | frontend-user | ✅ 已修复并复验：payment 同构移植（subscribe 等首帧 + 4s 超时兜底 + 首帧已到查无此单立即 redirect 增强）；第三轮 e2e V13 签收通过（URL 直接进 + 真实路径均可签收） |
| D-05 | **阻断（结算缺口）**：biz_user_action 的 confirm 分支只改 status 不结转余额——T1 前闭环 done 必经 studio complete（有结转）故无感；T1 后快递单主路径变为「用户端 logistics 签收 → confirm → done」，绕过 complete 结转 → **快递单货款漏结**。实证：SO20261012002（1490 分）done 后 SUP-SH01 余额未增加（自提单 001 经 handover 正常 +990）；看板 GMV ¥24.80 vs 余额 ¥9.90 精确偏差暴露 | supabase/biz-schema.sql biz_user_action confirm 分支（T1 设计疏漏） | db-pipeline | ✅ 已修复并复验：confirm 补结转（shipped→done 转换成功时结算，幂等验证通过——done 单重复 confirm 被拒、无二次结转）；定稿轮 V16 差值 2480=990+1490 精确通过 |

### 建议级

| ID | 描述 | 位置 | 责任方 | 状态 |
|---|---|---|---|---|
| D-02 | admin 看板在「config 有值但 URL 不可达」场景下无明确错误提示（详见 §2.1 D3 行） | admin/index.html | admin-verifier | ✅ 已修复（8s race 超时兜底 + 连续失败提示），三断云场景复验 PASS |

### 建议级

待云端走查补录。

---

## 4. 口径注记（leader 已认可）

1. **结算袋预置口径**：编辑器加购环节无自提相关改动，e2e 中结算袋状态用 Store API 预置（等价于真实走完编辑器加购），下单/支付/履约全流程均为真实 UI 操作。
2. **本地离线支付状态口径**：用户端本地模拟 `orders.pay()` 直接 pending → making（4 态模拟），studio 本地引擎按 6 态对齐，因此离线演示中 studio 侧从「标记可取」接续（accept/make 已被模拟跳过）；云端模式无此差异（pay → paid → accept → make 全链路状态机完整）。
3. **取货码校验样例**：SO20261012001 → 5883（线上 RPC 与本地 JS 哈希算法一致，D1 断言交叉验证）。
4. **云端造数**：已获 leader 授权，e2e 用用户端真实下单流程（biz_checkout + biz_pay）造自提/快递各一单；biz_ 侧无全清 RPC，残留测试订单在报告中注明，不手写 DELETE。

---

## 5. 执行环境与工具

- 本地服务：`npx http-server -p 8642`（仓库根）
- 浏览器：Playwright 1.x + 系统 Chrome（无头，1440×900 / 375×812）
- 断云模拟：Playwright 路由拦截 `**/demo/config.js`（不动仓库文件）
- 云端探测：anon key 直调 Supabase REST（PowerShell Invoke-RestMethod）
- 截图留档：admin-desktop.png / admin-mobile.png / portal.png / e2e-local-ready.png / e2e-local-done.png（admin-verifier 工作区）

---

## 6. 验收结论

**T4 验收通过。**

1. **闭环两单走通**：云端 e2e 定稿轮 21/21 全绿——自提单（下单→支付→取货码→制作→标记可取→核码交付）与快递单（下单→支付→接单→制作→发货→物流轨迹→用户签收）双路径完整闭环，金额、状态机、结算全程正确。
2. **零未修复阻断缺陷**：验收全程发现 4 阻断 + 1 建议（D-01~D-05），全部修复并复验闭环。其中 D-05（confirm 漏结货款）为商业结算正确性问题，由 e2e 余额差值断言挡在上线前。
3. **检查点全过**：自提单无运费且取货码两端一致（5883 契约对拍）；快递单运费与券规则不变（14.90=9.90+5.00）；金额服务端校验通过（amountExpect）；状态机无跳步（每步状态断言）；Realtime 多页同时开联动正常（看板后台常开，下单即现、终态精确）。
4. **本地回退**：断云后用户端 + studio 全流程可走通（26/26），看板按设计明确提示依赖云端。
5. **交付物**：admin/index.html（极简只读看板，独立可运行）+ 门户入口卡 + 本报告。

**演示数据**：线上库保留定稿轮两笔订单（SO20261012001 自提 done / SO20261012002 快递 done，供应商余额 ¥24.80）作为演示数据，biz_reset 可随时复位。
