# 蓝鲸桌宠（项目代号「小蓝鲸」）— 设计交接

给 DeepSeek Harness 配一只二次元蓝鲸：**桌面宠物 + agent 人格皮肤**，能实时反映 agent 状态（干活中 / 等你回话 / 干完了 / 空闲）。

设计已确认，本文是唯一权威来源。实现前先读它，不要重新推导。

> 命名：项目目录 `whale-pet`，包名 `@local/dsh-whale-pet`，用户可见名「小蓝鲸」。
> **不得**在项目名中使用 "DeepSeek Harness" 全称，**不得**用官方品牌物料暗示官方背书（`BRAND_GUIDELINES.md:9-10`）。

---

## 1. 结论先行：现成物料够什么、不够什么

| | 够不够 | 说明 |
|---|---|---|
| 桌宠引擎/壳 | **够，且有现成 Electron 壳** | AIRI（MIT，Electron+TS，透明、置顶、点击穿透、Live2D/VRM）；Open-LLM-VTuber（MIT）；pixi-live2d-display（MIT）；Inochi2D（BSD-2） |
| 状态挂载点 | **够，是官方的** | Cordis 插件事件（`docs/architecture.md:74` "Events are the extension points"） |
| 人格规范 | **够** | Character Card V3，`assets` 字段原生支持打包 Live2D/VRM 与表情 |
| **二次元蓝鲸立绘** | **不够** | 不存在"免费+可商用+动漫风+鲸鱼角色"。详见 §6 |
| 本机已有品牌物 | **有** | `%LOCALAPPDATA%\DeepSeekHarness\dsh-whale.ico` 内含 7 帧，已提取 256×256 至 `research/assets/whale-icon-256x256.png` |

### 两条必须记住的排除项

- **不用 zhizhiji-shimeji 的帧生成**。逐行读其 `gen_frames.py`：所谓"帧"只有 `place_on_canvas` 的像素位移（`bob=[0,-4,-1,-4]`）与整体 `rotate()`，纯刚体变换，无肢体形变/尾巴/眼睑；且该仓库 `license` 为 `null`，**无许可证，只能参考思路不能复制代码**。
- **单张合图不能进骨骼动画**。Spine / DragonBones / Live2D / Inochi2D 全部要求分层部件输入。前置 = 拆件 + 抠图 + **补画被遮挡区**（摆尾时露出的尾巴合图上没画过），零基础 55–140h。DragonBones 编辑器仓库已 404。

---

## 2. 目标 profile 与插件机制

- 目标 profile：**`web`**（与 account-balance 一致），启动 `pnpm run dev:web`（源 checkout 根目录）。
- 插件 = npm 包，`apply(ctx)` 或 `Service` 子类 + `inject`；经 `profiles/<p>/package.json` 的 `dsh.profile.bundles` 分层装载；`cordis.patch.yml` 做 `{id,name,config}` 覆盖。
- 区分两层：**包内文件**（`my-dev/whale-pet/` 下的 `package.json`、`cordis.patch.yml`、`index.js`…）由作者写，这是本文档描述的工作；**profile 层文件**（`$DSH_HOME/profiles/<p>/` 下的 `package.json`、`cordis.patch.yml`）**不要手写**，交给 `plugin_manager` 的 `install_bundle`（`target` = 包的绝对目录）。同理不要在 profile 目录跑 pnpm。
- 每个 `plugin_manager` 动作都需要批准；只在结果决定下一步时才调用。
- **`cordis.patch.yml` 是升级后仍保留的配置层**，可调值放插件 `Config`。

模板与参考（源 checkout 内，**只读、不原地改**，先复制进 workspace 再改）：
- `packages/preset/agent-preset/skills/cordis-plugin-development/` — `SKILL.md`、`references/{host-plugin,ui-plugin,practices,user-actions,verification}.md`、`templates/decoration/*`
- ⚠️ 本会话技能目录里**没有** `cordis-plugin-development`（它由创造模式预设挂载）。实现时若需创造模式工具，先确认；**判据是工具返回结果，不是先验**。

---

## 3. 架构

```
DSH 宿主
  └─ 插件 host 半边（Cordis 插件）
       订阅 agent/status · turn/* · approval/* · user-questions/* · subagent/*
       ↓ 聚合成「蓝鲸状态」
       暴露 /api/whale-state（围栏内轮询，或自绑固定端口）
              │  127.0.0.1
              ↓
Electron 透明窗口（独立进程）
  吃状态 → 驱动 SVG 蓝鲸动画 + 气泡
  拖动 / 点击 / 点击穿透走自己的交互
```

**为什么不让桌宠去逆向 DSH 的窗口或扒内部状态**：那是会随版本失效的路子。插件是官方扩展点，且长期最稳。

**A 与 B 共用一个状态源**：插件里那套状态聚合逻辑，同时供 ① 桌宠（Electron）与 ② 聊天界面内的形象皮肤（纯 Client 半边，不需要 Electron）。不是做完一个再做另一个。

---

## 4. 状态机（DSH 侧真值）

| 蓝鲸状态 | 依据事件 | 出处 |
|---|---|---|
| `busy` 干活中 | `agent/status` running、`turn/start`、`step/start`、`tools/execute` | `packages/core/agent/src/runtime-types.ts:280` |
| `waiting` 等你回话 | **durable** `approval/asked`（无配对 `approval/decided`）、`approval/request` waterfall、`user-questions` | `docs/persistence-schema.json:3213,3298,3398`；`packages/interaction/user-approval/src/types.ts:87` |
| `done` 干完了 | `turn/end`、`agent/status` idle、`agent/turn-stopping` | `runtime-types.ts:381` |
| `idle` 空闲 | 无 open turn | — |
| 派生：派了小助手 | `subagent/start` / `subagent/end` | `packages/subagent/subagent/src/index.ts:164,172` |

**关键修正**：调研报告称"等用户批准在落盘里没有字段"——那指的是投影**缓存**。durable 事件 `approval/asked` / `approval/decided` 在**会话日志**里，所以保底路径也能拿到这一态。

**实现期必须用 `cordis_inspect_query`（`Event` / `Service`）复核事件名与派发模式**，以运行中的 Harness 为准，不以本文为准。非拥有决策的水位线监听器必须返回 `next()`。

**性能（`references/practices.md:26-28`）**：每会话派生状态放 `ctx.sessionProjections` 单元（`apply(state,event)` 纯同步，忽略的事件返回同引用）；状态保持 plain JSON，字段变化时 bump `stateVersion`。**不要轮询 `agent/status`**，等 durable 事件。Client 需要的派生值用 Host 投影上的 `wire.view` 下发，Client 不自己折叠会话事件。

---

## 5. 状态传输与端口

§3 架构图里的 `/api/whale-state` 是**目标形态**，本节说清它怎么落地：

- 首选：插件在 `/api/` 围栏内暴露路由（`account-balance/index.js:22` 的既有做法），Electron 轮询它。
- **待验证 A**：Host 半边是否有受支持的"HTTP 响应升级为 SSE/WebSocket"路径；有则改推模式，延迟最低。
- 若无（或围栏路由拿不到实时通道），退化为下面两条并行：
  - **主路径**：插件自绑一个**固定端口**（127.0.0.1，如 `8788`）的本地 HTTP 服务，直接给 Electron 推状态。
  - **保底路径**：Electron 轮询 `$DSH_HOME/storages/session_projcache/sessions/<id>.json`（零认证、tmp+rename 原子写、`version:7`）。信号：`sessionStats.openStep`/`pendingCalls` → busy；`userQuestions.questions.active` → waiting；`turnBoundary.openTurnStartSeq == null && lastStepBoundary.kind == 'end'` → idle。**实测节流 200 事件/5000ms，滞后 3–10s**，故仅作保底。
- **不要**把桌面窗与插件之间的联通建立在"DSH 主服务的端口"上：主服务端口每次启动随机（`--port 0`）。
- Electron 侧只允许 `127.0.0.1`，不监听外部网卡。

### 5.1 实际实现（v0.1，已落地）

上文是备选方案，实际只用了最简单的一条：**围栏路由 + 客户端轮询**，没有 SSE、没有自绑端口。

| 环节 | 实际做法 | 依据 |
|---|---|---|
| 路由注册 | `ctx.connection.fetch.register({ path, methods: ['GET'], requestBody: 'buffered', fetch })`，handler 收 `Request` 返 `Response` | `my-dev/account-balance/index.js:285-294` |
| 服务可用性 | 靠 `inject: ['connection']` 保证，**不需要** presence 守卫 | 同上，`account-balance` 无守卫 |
| 状态来源 | 只读投影缓存；按"最近活跃会话"选赢家 | `verify-host.mjs` |
| 传输 | Client 半边 `fetch('api/whale-pet/state')` 每 2s 轮询 | `client.js` |

**踩过的两个坑（务必记住）**：

1. `connection.route()` **不存在**。我最初凭 `account-balance/index.js` 的注释臆断了这个 API，实际是 `ctx.connection.fetch.register`。
2. Client 半边的 `require` **只认平台 seed 词（React）和已物化模块**。`require` 本包自己的 `art` 子路径会抛 `missed the module table`，而组件加载时抛错会**整块槽位空掉**。所以 Client 里必须自包含，两边一致性由 `verify-parity.mjs` 锁。


---

## 6. 形象与动画管线（分三步，不合并）

### 第 1 步（本次范围）：程序化 SVG 萌系蓝鲸

**不画美术，用矢量几何跑通全链路。** 依据：本机 `dsh-whale.ico` 的鲸鱼是纯几何填色、无描边——尾巴、鳍、眼睑、呼吸缩放全都能用代码驱动，改颜色/表情/动作是改参数而非重画。零授权风险（自绘矢量）。

- **外形不照抄 DSH 标志**：① `BRAND_GUIDELINES.md:9-10` 禁止暗示官方背书；② 那只鲸鱼像 logo，不像"二次元角色"。保留鲸鱼母题（蓝白配色、尾鳍、喷气孔），重做成萌系比例（大头身、圆眼、拟人化）。
- **必须有参数映射层**：六种状态 → 一组动画参数（摆尾频率、眼睑开合、气泡文案、游动速度）。**以后换渲染器，状态机不动。**
- 六态动画：待机呼吸 / 干活中（加速游动+尾摆）/ 等你回话（冒头+气泡+"！"）/ 完成（小跳跃+提示）/ 被拖拽（惯性倾斜）/ 空闲游动。

### 第 2 步（不在本次范围，本次只保证接口可替换）

二选一：打磨矢量（14–26h，零授权风险）或 AI 草稿+人工重绘 + Inochi2D/Live2D。渲染器通过参数映射层接入，状态机与传输层不改。

### 第 3 步（不在本次范围）

Character Card V3 写人设。注意：**CCv3 的 `assets` 字段可把模型与表情打包进角色卡**，第 2 步选型时预留。

### 授权红线

- 不要用 Live2D 官方 sample model（协作角色禁商用；原创角色对年营收 ≥1000 万日元者仅限内部/监修，禁再分发、禁改设计）。
- 不要用 CC-BY-SA 的素材（如 OpenGameArt `Blue Whale`）——许可传染。
- 若上 AI 立绘：SDXL 的 use-based restrictions 需向下游传递。
- 隐藏坑（需人工确认）：Live2D 可能把"允许用户换模型的 AI/chatbot 应用"判为 Expandable Application，发布前需审核批准。不想碰 Cubism 授权就优先 Inochi2D(BSD-2) 或 mesh 方案。

---

## 7. 交付物与目录

| 路径 | 内容 |
|---|---|
| `D:\deepseek-harness\my-dev\whale-pet\` | 插件包（`package.json`、`cordis.patch.yml`、`index.js` host 半边、`client.js` 形象皮肤、`icon.svg`、`locale/`） |
| `<workspace>\desktop\` | Electron 透明窗桌宠（渲染器 + 参数映射层 + 状态消费） |
| `<workspace>\docs\` | 本 BRIEF 的实施记录、验证证据 |

宿主半边只 import `node:*` builtin。profile 安装的 bundle 其 `node_modules` 里没有 Harness 包，**bare `@deepseek-ai/...` 说明符在激活时会解析失败**，也因此该插件不能声明 `Config`（schemastery 无法 import）——可调值从 row 的 `config` 对象读（`account-balance/index.js:11-15` 的既有做法）。

Client 半边：`dsh.client` 段（`platform`/`immediately`/`inject`）+ `./client` 导出。注册进 slot 用 `ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`；优先 `conversation.composer.dock` 这类**已分配空间**的 slot，只有确实需要覆盖层才用 `shell.overlay`。**不要**把 HTML 页面从 Host 服务出来塞进 iframe（拿不到主题 token / 明暗切换 / `ctx.locale`）；**不要** `require` 任何 `@deepseek-ai/dsh-client-*` 包，自己写控件、抄宿主样式（类名加插件前缀，只保留 `--dsw-alias-*` token 引用）。样式和监听器在 `apply` 里用 `ctx.effect`/`ctx.on` 注册并返回清理函数。

---

## 8. 工作拆解与验收

1. **打通状态源**：插件 host 半边订阅事件、聚合 `whale-state`、暴露通道。验收：起 `dev:web`，用 `curl` 拿到状态 JSON；手工触发 agent 干活/等待，JSON 随之变化。
2. **Electron 透明窗**：透明、无边框、置顶、可拖动、任务栏不显形。验收：屏幕上出现一个能拖动的窗口。
3. **SVG 蓝鲸 + 参数映射层**：六态动画跑通。验收：改 JSON 里的状态字段，动画随之切换。
4. **编排与保底**：插件不在时自动退化为 projcache 轮询；两路状态合并（实时优先）。验收：停掉插件，桌宠仍能在 10s 内反映大致状态。
5. **形象皮肤（B）**：Client 半边在 Web GUI 内渲染同一状态源的迷你蓝鲸 + 状态文案。验收：Web GUI 里可见且与桌宠一致。

每步的验证证据（命令输出、截图、`cordis_inspect_query` 结果）落到 `<workspace>\docs\`。

---

## 9. 风险与未决

| 风险 | 影响 | 对策 |
|---|---|---|
| 事件名/派发模式与源码文档不一致 | 状态机接不上 | 实现期以 `cordis_inspect_query` 为准；水位线监听器一律 `next()` |
| Host 半边无 SSE/WS 升级路径 | 桌宠延迟高 | 自绑固定端口（§5 主路径） |
| 轮询保底滞后 3–10s | 状态不跟手 | 仅作保底，实时靠插件 |
| 插件安装需批准 | 流程中断 | 装包前先说明再调 `plugin_manager` |
| Electron 不在本机 | 桌宠壳起不来 | 仓库内无 electron；需 `pnpm add -D electron` |
| 本会话无创造模式技能 | 缺 `cordis_inspect_*` | 以工具返回结果为判据，不用先验 |

**未决（实现第 1 步前必须回答）**：
1. Host 半边能否在 `/api/` 路由上做 SSE/WebSocket 升级？→ `cordis_inspect_query` 查 `connection` 的 Service 方法。
2. 固定端口取哪个数值、是否需要可配置？→ 放进 row 的 `config`。
3. `conversation.composer.dock` 的注入面里能否拿到会话状态选择器？→ 查 `Slots.listSubTree` 与选中 slot 的 props。
