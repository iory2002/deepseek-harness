# account-balance bundle — 开发交接

给 DSH Web 界面「输入框下方统计行」的右侧加一个账户条：`¥花费 · 余额 ¥N`。

设计已全部确认，本文是唯一权威来源。实现前先读它，不要重新推导。

---

## 1. 目标 profile 是 `web`，不是 `desktop`

装进 `web` profile。启动方式：在 `D:\deepseek-harness` 下跑 `pnpm run dev:web`（= `tsx scripts/dev-web.ts`，构建后启动 `dsh web`），它会拉起一个 **web profile** 的宿主——`dsh web` 等价于 `dsh --profile web`（`apps/cli/src/args.ts:92`）。

**本会话应当已经运行在创造模式（preset id `cordis`）上。** 开工前**直接调用一次 `cordis_inspect_list`**：它能返回结果就说明工具在，可以立刻继续。

> ⚠️ 实测教训：曾有一次 agent 在工具齐全的情况下声称「本会话没有 `plugin_manager` / `cordis_inspect_*`」。那是错的。**判据是工具的返回结果，不是你的先验。** 会话日志里的 `agent-preset/selected` 事件记录了真实 preset；不要凭 BRIEF 里这句话就断定自己缺工具。

创造模式一次带来三样东西（`packages/bundle/web-app/presets/cordis.patch.yml`）：

- 第 141-142 行：`tool-cordis` → `cordis_inspect_list` / `cordis_inspect_query`
- 第 143-147 行：`skill-filesystem` 的 `customSkillDirs` 指向 `@deepseek-ai/dsh-agent-preset` 的 `skills` 目录 → 挂上 `cordis-plugin-development` 技能
- 第 152-154 行：`tool-plugin-manager` 启用（`disabled: !!js "!ctx.get('profileContext')"`）

web profile 与 desktop 用同样的两个 bundle（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`），所以 preset 一样有。web profile 还有个 `"patchReload": "live"`，profile patch 改动会热重载。

**开始实现前先读 `cordis-plugin-development` 技能及其 `references/ui-plugin.md`、`references/practices.md`。**

---

## 2. 两个 profile 的配置差别（这决定了余额走哪条链路）

| | desktop | **web（目标）** |
|---|---|---|
| `llm-deepseek`（API-key 适配器） | 显式 `disabled: true` | 启用（bundle 默认） |
| `agent-default-model.provider` | `deepseek-account` | **`deepseek-official`** |
| 模型调用计费走 | Platform 账户（OAuth 授权） | **API key** |

- `deepseek-official` 是 API-key 适配器注册的 provider：`packages/llm/llm-deepseek-api-key/src/index.ts:15`
- `deepseek-account` 是 Platform 账户适配器：`packages/llm/llm-deepseek-account/src/index.ts:15`
- web profile 的 `cordis.patch.yml` 几乎为空（只有 `welcomeNoticeVersion`），所以**全部走 bundle 默认**；base 的默认见 `packages/bundle/base/cordis.patch.yml:82-86`

**结论：web 里计费走 API key，所以余额也走 API key 的 `/user/balance`。** 不要去复用 Platform 的 OAuth 余额（`remote.account`）——那是另一条登录链路，可能对应另一个账号。

---

## 3. 必须先验证的一件事

用 `cordis_inspect_query` 的 `Service` 方法查，不要猜：

> **`conversation.composer.dock` 插槽的注入面里，`useProjection('tokenUsage')` 是否可用。**

原设计的另一个验证项（客户端能否 inject `remote.account`）**已经不需要了**——余额改由宿主半边自己取，客户端只 `fetch` 我们自己的 `/api` 路由。

### 如果 `useProjection('tokenUsage')` 不可用

它不可用时，会话 token 累计拿不到，花费数字就没了。退路依次是：

1. 查 `useChat` / `useSession` 等其它注入座位能否间接拿到同一个投影。
2. 让宿主半边通过 `wire.view` 把 token 总量算好下发（`references/practices.md:38` 给的就是这个方向：「When the Client needs a value derived from a session, declare `wire.view` on the Host projection」）。宿主半边本来就有，加这个成本可控。
3. 最差情况：这一版只做余额，花费留到下一版。**不要**为了凑数字改成读 DOM 或自己订阅会话事件。

---

## 4. 已确认的设计（不要再改）

| # | 决策 |
|---|---|
| 1 | 位置：`conversation.composer.dock`（输入框下方那条统计行） |
| 2 | 视觉顺序 `[统计][上下文环][账户]`；靠**自建 CSS `order: 1`** 排到硬编码的 ContextMeter 之后 |
| 3 | 纯追加：不改任何现有文件；空会话与其它条目一样隐藏 |
| 4 | 一个 chip，带短标签：`¥1.23 · 余额 ¥98.50` |
| 5 | **余额来源：宿主半边用 API key 调 `GET /user/balance`**，与 pricing 经同一个 `/api` 路由下发 |
| 6 | 花费：**会话累计**（不是单回合） |
| 7 | 计价：**增量计价**——每次刷新取 token 增量，按那一刻的档位计价累加；页面加载时把已有总量按当前档位播种 |
| 8 | 分档：DSH 的 token 投影**没有时间戳**，只能用「刷新时刻」定档。这是本设计的已知精度上限 |
| 9 | cacheWrite：默认跟随同档位 `cacheMiss` 价 |
| 10 | 刷新时机：进界面 / `turn/end` / 模型切换。**无定时轮询** |
| 11 | 取数失败：保留上次成功的值 + 过期标记（数字降不透明度 + tooltip 一句「上次刷新失败」） |
| 12 | **两种告警并存**：低于可配阈值（默认 10 元，人民币）是软提醒；接口返回 `is_available: false` 是硬告警。二者语义不同，不重复 |
| 13 | 展开交互：悬停预览 + 点击固定；**控件必须手抄**（见 §7） |
| 14 | 拆分展示：悬停里显示 `topped_up_balance` / `granted_balance` |
| 15 | 全部可见文案走 `ctx.locale` 的 locale 字典 |

---

## 5. 文件布局

```
D:\deepseek-harness\my-dev\account-balance\
  package.json        待写
  cordis.patch.yml    待写
  index.js            待写（宿主半边）
  client.js           待写（浏览器半边）
  design.md           已就位（Reasonix 参考设计）
  BRIEF.md            本文件

C:\Users\iory2\.dsh\account-pricing.json                      已就位（数据文件）
C:\Users\iory2\.agents\skills\update-account-pricing\SKILL.md  已就位（更新技能）
```

`my-dev/` 已加入 `.gitignore`（第 49 行），不会污染仓库 git status。

---

## 6. 宿主半边要做的三件事

### 6.1 读价目数据

`$DSH_HOME/account-pricing.json`（本机 `C:\Users\iory2\.dsh\account-pricing.json`）。**每次请求都重新读**，这样技能改完即生效——不需要重装、不需要重启。

路径要作为 `Config` 字段（仓库规则：可变选择不能硬编码），默认 `$DSH_HOME/account-pricing.json`。取 `$DSH_HOME` 优先用 `process.env.DSH_HOME`，回退 `~/.dsh`；也可以用 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome`（peer 会从安装副本解析）。

```jsonc
{
  "version": 1,
  "updatedAt": "2026-10-01T13:20:41+08:00",
  "source": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
  "currency": "CNY",
  "unit": "per-million-tokens",
  "bandRule": {
    "timezone": "Asia/Shanghai",
    "peakWeekdays": [1,2,3,4,5],
    "peakWindows": [{ "from":"09:00","to":"12:00" }, { "from":"14:00","to":"18:00" }]
  },
  "holidays": [],                     // YYYY-MM-DD 数组；这些日期全天按空闲计价
  "models": {
    "deepseek-flash":  { "peak": {cacheHit,cacheMiss,cacheWrite,output}, "offPeak": {...} },
    "deepseek-v4-pro": { "peak": {...}, "offPeak": {...} }
  },
  "aliases": {
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-v4-flash-vision-exp": "deepseek-flash"
  }
}
```

- 单价单位：**元 / 百万 token**，`peak` 与 `offPeak` 显式各存一套。
- **档位语义**：高峰 = 工作日且不在 `holidays` 中，且时刻落在某个 `peakWindows` 内；**其余一切情况都是空闲**（含周末、法定节假日全天）。空闲价 = 高峰价的一半。
- **`holidays` 为空时退化成「工作日 + 时段」**：工作日恰逢法定假日会按高峰价算，偏高最多一倍。周末任何时候都判对。
- **模型查不到就隐藏花费**，不要回退到某个模型的价——那会给出一个看似合理的错数字。`aliases` 覆盖两个已下线的旧模型名。

### 6.2 取余额

`GET https://api.deepseek.com/user/balance`，请求头带 API key。

**认证与地址：**

- key 的值：`ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))` → `{ value, source }`。先例：`packages/llm/llm-deepseek-api-key/src/index.ts:20-35`、`packages/web/web-search-deepseek/src/index.ts:115-121`。
- key 的**引用名**默认 `DEEPSEEK_API_KEY`（`packages/llm/llm-deepseek-api-key/src/config.ts:16`），可以从 `ctx.settings.describe()` 里 ns 为 `llm-deepseek` 的条目读到 `apiKeyEnv`。
- ⚠️ **地址陷阱**：`llm-deepseek` 的 `baseURL` 默认是 `https://api.deepseek.com/anthropic`（`packages/llm/llm-deepseek/src/config.ts:106`），而余额接口在**裸根** `https://api.deepseek.com`。**不能直接复用那个 baseURL**。从 settings 读到 `baseURL` 时要去掉 `/anthropic` 后缀；读不到就用常量。把它做成 `Config` 字段以便覆盖。

**响应形状：**

```ts
{ is_available: boolean,
  balance_infos: [ { currency: 'CNY'|'USD',
                     total_balance:     string,   // 充值 + 赠送
                     granted_balance:   string,   // 未过期的赠送
                     topped_up_balance: string } ] }
```

- 金额是**十进制字符串**，格式化不要直接 `toFixed`。仓库里已有处理同样问题的参考：`packages/client/ui-settings-account/src/client/formatBalance.ts`（用 big.js）。
- `total_balance` 是现成的总额，**不需要**自己相加。`balance_infos` 可能有多条币种。
- 余额是**权威值**（来自服务端），但只在刷新时机才更新，不是实时值。
- 来源：<https://api-docs.deepseek.com/api/get-user-balance/>

### 6.3 注册已认证路由

`ctx.connection.fetch.register({ path: '/api/<name>', methods, requestBody, fetch(request): Promise<Response> })`。它跑在 `/api` 的鉴权围栏内（信任围栏 + 浏览器 cookie 认证）。

参考实现：`packages/client/ui-deliverables/src/present-open.ts:21-53`（宿主侧）+ `packages/client/ui-deliverables/src/client/present-open.ts:103-140`（浏览器侧，用**相对路径** `api/<name>` 取）。

把 `{ pricing, balance }` 一次下发，或者分两个路由，都行——但**一次下发更好**：客户端一次 round trip，而且两者刷新时机本来就一致。

---

## 7. 关键约束与已知事实

**动态插件禁止 `require` 任何 Harness 客户端包**（`references/practices.md:35`）——包括 `@deepseek-ai/dsh-client-ui-primitives`。所以悬停/点击固定的控件要**手抄**：从 `packages/client/ui-primitives/src/` 复制标记、CSS 与行为到本插件，改掉类名前缀，只保留 `--dsw-alias-*` 主题 token 引用。一个抛异常的组件会把整个插槽条目打空（控制台：`slot entry crashed in '<slot>'`）。

**插槽事实**（`conversation.composer.dock`）：

- 声明：`packages/client/ui-conversation/src/client/contract/slots.ts:199`，`kind: 'list'`、`scope: 'session'`、**无 owner props**
- 渲染：`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:499-504`，在输入卡片**之后**
- **只在 `variant === 'composer' && input && sessionId` 时渲染**——空会话与冷启动都不渲染，这是既定取舍
- 现有占用者：ui-chat 的 StatsPills（`id: 'stats'`, `order: 0`）；ContextMeter 是插槽之后硬编码的兄弟节点
- 排序：插槽内部按 `priority` 再按 `order` 升序；**要排到 ContextMeter 之后只能靠自建 CSS `order`**
- 插槽条目**没有 DOM 包装层**，组件根元素就是 `.dock` 的直接 flex 子元素（`scoped-slots.tsx:637`）——所以 CSS `order` 有效

**`/plugins/` 路由只服务 `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`**（`packages/client/modules/src/index.ts:192,1093`），其余 404。这是为什么价目和余额要经宿主半边的 `/api` 路由下发，而不是放在插件目录里让浏览器直接取。

**模板**：`packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/` 四文件。照抄结构，只换内容。

**Token 投影**（`packages/llm/token-meter/src/projection.ts:13-18`）：

```ts
TokenUsageProjection { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }  // 四桶互斥，会话级累计
```

对应关系：`cacheReadTokens → cacheHit`、`uncachedInputTokens → cacheMiss`、`outputTokens → output`、`cacheWriteTokens → cacheWrite`。

**注意**：该类型的注释明确写着这些数字「is a user-facing reference, **not a billing or gating input**」。所以显示出来的 ¥ 是估算，tooltip 里应当体现这一点。

**deepseek-flash 的图片模态**：web profile 用 bundle 默认的多模态配置；`deepseek-flash` 支持图片，`deepseek-v4-pro` 不支持。

---

## 8. 安装与验证

```
plugin_manager { action: 'install_bundle', target: 'D:\\deepseek-harness\\my-dev\\account-balance' }
```

它会自己做：装进 profile 的 `node_modules`、把包追加进 profile 的 `dsh.profile.bundles`。**不要手写 profile 的 `package.json` 或 `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm。**

安装后：读 `application` 与 `warnings` 判断是否生效（不是看日志或页面 boot payload）；用 `cordis_inspect_query` 确认新行；然后在界面上实际验证。

**验证清单**：

- [ ] 账户条在统计行右侧，且排在 ContextMeter **之后**
- [ ] 有会话时显示 `¥花费 · 余额 ¥N`；空会话不显示（预期行为）
- [ ] 悬停出 `topped_up_balance` / `granted_balance` 拆分，点击能固定，Esc / 点外面能关
- [ ] 跑一轮对话后花费增长；跨过 12:00 后新量按新档计价（历史量保留旧档）
- [ ] 刷新页面后余额仍在，花费与播种逻辑一致
- [ ] 断网后数字保留、出现过期标记
- [ ] 明暗两套主题下都可读
- [ ] 控制台没有 `slot entry crashed`
