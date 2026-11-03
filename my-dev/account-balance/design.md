# Reasonix 会话费用与余额机制

- **调查时间**：2026-10-01 12:57 +08:00
- **调查对象**：Reasonix v1.39.5（stable）
- **构建信息**（`%LOCALAPPDATA%\Programs\Reasonix\versions\v1.39.5\app\resources\build.json`）：
  `commit e6b520c39b677fc636b1bd08d6d348ddef39ad4c`、`buildTime 2026-09-29T03:05:01Z`、`electron 44.2.0`、`platform windows/amd64`
- **数据根**：
  - `%APPDATA%\Reasonix` —— 配置（`config.toml`）、原始账本（`stats/`）
  - `%LOCALAPPDATA%\reasonix` —— 聚合索引（`usage-catalog/v1.sqlite`）
  - `%LOCALAPPDATA%\Programs\Reasonix` —— 程序本体（`versions/<ver>/app/resources/app/assets/` 为前端 bundle）

## 0. 结论速览

费用和余额是**两条互不依赖的链路**：

| | 会话费用 | 账户余额 |
|---|---|---|
| 数据来源 | **本地计算**：token 数 × 价目表 | **服务端接口**：provider 的 `balance_url` |
| 是否联网 | 否（计费在本地完成） | 是（每次查询发一次 HTTP 请求） |
| 准确性 | 估算值（`cost_estimated: true`） | 账户实际数据 |
| 落盘 | `stats/<日期>.jsonl` → `usage-catalog/v1.sqlite` | 不落盘，仅内存中按 tab 保存 |
| 刷新时机 | 每次模型请求完成时追加 | tab 切换 / 模型切换 / 回合结束（`turn_done`） |

## 1. 会话费用：本地按 token × 价目表估算

### 1.1 计量

每次模型请求完成后，由执行器产生一条用量记录，标记 `usage_source: "executor"`。token 分类字段：

| 字段 | 含义 |
|---|---|
| `prompt` | 输入总 token（= `cache_hit` + `cache_miss`） |
| `completion` | 输出 token（含 `reasoning`） |
| `reasoning` | 思考 token，是 `completion` 的子集 |
| `cache_hit` | 命中前缀缓存的输入 token |
| `cache_miss` | 未命中缓存的输入 token |
| `total` | `prompt + completion` |
| `requests` | 本次聚合包含的请求数 |

### 1.2 计价

单价来自 `config.toml`，两级结构，后者按模型名覆盖前者：

- `[providers.price]` —— provider 默认价目
- `[providers.prices.<模型名>]` —— 单模型价目

三个字段均为 **元 / 百万 token**：`input`（cache_miss 单价）、`cache_hit`、`output`，另带 `currency = "¥"`。

本机当前生效价目：

| 模型 | input | cache_hit | output |
|---|---|---|---|
| `deepseek-v4-flash` | 3 | 0.1 | 9 |
| `deepseek-v4-pro` | 9 | 0.3 | 27 |
| `deepseek-flash` | 2.0 | 0.04 | 8.0 |

### 1.3 计费公式

```
cost = (cache_hit  × P_cache_hit
      + cache_miss × P_input
      + completion × P_output) / 1_000_000     # 单位：元
```

**实测验证**（本机 `stats/2026-08-16.jsonl` 一条记录，价目取 `[providers.price]` 的
`cache_hit 0.02 / input 1 / output 2`）：

```
cache_hit  289024 × 0.02/1e6 = 0.005780
cache_miss    628 × 1/1e6    = 0.000628
completion    859 × 2/1e6    = 0.001718
                               ─────────
                               0.008126   ← 账本记录 0.00812648，吻合
```

**分时档位**：每条记录带 `rate_band`，取值 `peak` / `off_peak` / `mixed`，UI 说明为"按请求完成时刻估算"，高峰时段为北京时间 09:00–12:00、14:00–18:00。不同档位单价不同。本机 2026-10-01 的记录均为 `off_peak`，按同一公式反解出该档单价为 `cache_hit 0.02 / input 1 / output 4`（**反解结果，未从程序代码确认**）：

```
cache_hit 75648 × 0.02/1e6 = 0.00151296
cache_miss  311 × 1/1e6    = 0.000311
completion  652 × 4/1e6    = 0.002608
                             ──────────
                             0.00443196  ← 账本记录 0.00443196，吻合
```

`pricing_fingerprint` 标识所用价目表版本，8 月为 `071dfe070e1e4070`，10 月为 `ba96037de26c3f79`。

### 1.4 落账：`%APPDATA%\Reasonix\stats\<日期>.jsonl`

每次请求追加一行。字段（按语义分组）：

**用量**

`ts`、`model`（形如 `deepseek/deepseek-v4-flash`）、`source`（`desktop` 等）、`prompt`、`completion`、`reasoning`、`cache_hit`、`cache_miss`、`total`、`requests`、`usage_source`

**费用**

| 字段 | 含义 |
|---|---|
| `cost_amount` / `cost_currency` | 本次成本及其币种（`CNY`） |
| `selected_amount` / `selected_currency` | 选定币种的金额（与 `cost_amount` 一致） |
| `valuation_cny` / `valuation_usd` | 折算为人民币 / 美元的估值 |
| `cost_estimated` | 恒为 `true` —— 本地估算而非官方账单 |
| `billing_mode` | 计费模式（`payg` = 按量付费） |
| `aggregate_mode` | 聚合模式（`single_currency` = 单币种） |
| `cost_complete` / `display_complete` / `display_status` | 成本完整性与展示状态（`matched`） |
| `pricing_fingerprint` | 所用价目表的指纹 |
| `rate_band` / `rated_at` | 分时档位与评定时刻 |
| `turn` | 值为 `true` 的行是**回合边界标记**，不是费用记录 |

### 1.5 聚合索引：`%LOCALAPPDATA%\reasonix\usage-catalog\v1.sqlite`

对 `stats/*.jsonl` 做增量索引，供历史用量查询，避免每次重扫原始账本。

| 表 | 作用 | 关键列 |
|---|---|---|
| `usage_files` | 已索引的账本文件状态 | `path`、`day`、`size`、`mtime_ns`、`indexed_offset`、`state`、`corrupt_lines` |
| `usage_records` | 逐条明细 | `file_path`、`byte_offset`、`byte_length`、`line_hash`、`day`、`source`、`model_ref`、`provider`、各 token 列、`turns` |
| `usage_rollups` | 按维度汇总 | `day`、`source`、`model_ref`、`provider` + 各 token 列 |
| `usage_state` | 索引状态 | `revision` |
| `schema_migrations` | 结构版本 | `version`、`applied_at` |

`byte_offset` + `line_hash` 表明索引是**增量**的：只读取文件末尾未索引部分，并按行哈希去重。

## 2. 账户余额：调 provider 的 `balance_url`

### 2.1 来源与配置

余额不是本地推算的，而是查询 provider 配置中的 `balance_url`：

```toml
[[providers]]
  name = "deepseek"
  api_key_env = "REASONIX_CONNECTION_<ID>_KEY"
  base_url = "https://api.deepseek.com"
  balance_url = "https://api.deepseek.com/user/balance"
  billing_currency = "CNY"
```

- 本机三个 provider 的 `balance_url` 均指向 DeepSeek 官方余额接口 `https://api.deepseek.com/user/balance`。
- **未配置 `balance_url` 的 provider 不查询余额**，状态栏相应项为空。设置界面提示原文："可选。填了就会查询并在状态栏显示钱包余额。"
- 其他厂商走各自接口，例如内置的 Kimi 模板用 `https://api.moonshot.cn/v1/users/me/balance`。
- `billing_currency` 决定余额的展示币种。

### 2.2 认证

使用该 provider 的 `api_key_env` 所指环境变量中的密钥（本机为 `DEEPSEEK_API_KEY` 与
`REASONIX_CONNECTION_<ID>_KEY`）。凭据解析优先级：**启动环境变量 > 凭据存储 > 项目 `.env` > harness home `.env`**。

### 2.3 刷新时机

从打包前端 bundle（`app/assets/index-DUM9tNGw.js`）确认，共三处触发，**没有定时轮询**：

1. **切换会话 tab**：先把该 tab 的余额清空为 `{available: false, display: ""}`，再发起查询，同时递增该 tab 的请求序号。
2. **切换模型**：模型切换控制器会清除并刷新余额。
3. **回合结束**（`turn_done` 事件）：`B("BalanceForTab", [tab])` 后刷新。

并发安全：每次请求携带自增序号，响应返回时若序号已被更新则丢弃，避免旧响应覆盖新结果。
失败处理：`try/catch` 静默忽略（空 catch），状态栏保留上一次的值。

### 2.4 返回结构

前端接收 `{ available: boolean, display: string, err?: string }`：

- `available` —— 该 provider 是否配置了 `balance_url` 且查询成功
- `display` —— **已格式化的字符串**（如 `¥128.50`），前端不再做货币格式化
- `err` —— 非空时不更新 UI

注意：`app/assets/bridge-Cu0HtqCb.js` 中存在硬编码 `display: "¥128.50"` 的实现，那是**测试/mock 作用域**的桩，不是真实数据来源。

## 3. 显示

### 3.1 状态栏项

由 `config.toml` 的 `[desktop] status_bar_items` 决定显示哪些项及顺序。本机当前 13 项：

```toml
status_bar_items = ["model", "workspace", "git_branch", "cache", "cache_avg",
                    "session_tokens", "turn_tokens", "turn_cost", "session_turns",
                    "context", "compact", "cost", "balance"]
```

与费用/用量相关的项：

| 项 | 含义 |
|---|---|
| `turn_cost` | 当前回合的费用 |
| `cost` | 当前会话累计费用 |
| `balance` | 账户余额 |
| `session_tokens` / `turn_tokens` | 会话 / 回合 token 数 |
| `context` / `compact` | 上下文占用与压缩状态 |
| `cache` / `cache_avg` | 缓存命中率（当前 / 平均） |
| `session_turns` | 会话回合数 |

### 3.2 样式与设置入口

- `[desktop] status_bar_style`：`"text"`（文字版）或 `"icon"`（图标版）
- 设置 → **信息栏显示项**：勾选、拖拽排序、全部显示 / 恢复默认
- 设置 → **底部信息栏样式**：在文字版与图标版之间切换
- `[ui] show_turn_usage = true`：每个回合额外显示一次用量

### 3.3 分时标签

`billing.rateBand.peak` = 高峰、`billing.rateBand.offPeak` = 低峰、`billing.rateBand.mixed` = 峰谷混合；
tooltip 说明"按请求完成时刻估算。北京时间高峰为 09:00–12:00、14:00–18:00"。

## 4. 配置参考

```toml
[billing]                          # 额外计费覆盖；本机为空
credentials_store = "auto"         # 凭据存储策略
default_model = "deepseek/deepseek-v4-flash"

[desktop]
status_bar_items = [...]           # 状态栏显示项
status_bar_style = "text"

[[providers]]
  balance_url = "..."              # 余额接口；留空则不查询
  billing_currency = "CNY"         # 余额展示币种
  [providers.price]                # 默认价目（元/百万 token）
    input = 1
    cache_hit = 0.02
    output = 2
  [providers.prices.<模型名>]       # 单模型价目，覆盖默认价目
```

## 5. 边界与注意事项

1. **费用是估算**：`cost_estimated: true` 表明本地按 token × 价目表推算，与账户实际扣费可能存在差异（价目表版本、折扣、赠送额度均可能不同）。核对真实扣费以 platform.deepseek.com 的账单为准。
2. **余额是权威值**：直接来自服务端接口，但只在上述三个时机刷新，**不是实时值**——长时间停留在一个 tab 且不发消息时不会更新。
3. **未配置 `balance_url` 即无余额**：状态栏的 `balance` 项会显示为空，而不是报错。
4. **凭据优先级**：环境变量优先级最高，会覆盖凭据存储中的值；由环境变量提供的凭据在设置界面中不可编辑。
5. **原始账本只追加**：`stats/*.jsonl` 按天分文件，`usage-catalog` 只读地增量索引它们。
6. **版本相关**：价目表指纹会随版本或档位变化；本文档基于 v1.39.5。

## 6. 证据来源

| 结论 | 证据 |
|---|---|
| 费用字段与公式 | `%APPDATA%\Reasonix\stats\2026-08-16.jsonl`、`2026-10-01.jsonl` 与 `config.toml` 价目逐条对账 |
| 聚合表结构 | `sqlite3` 读取 `%LOCALAPPDATA%\reasonix\usage-catalog\v1.sqlite` 的 `sqlite_master` 与 `pragma table_info` |
| 余额来源与提示语 | `app/assets/bridge-Cu0HtqCb.js`（`balanceUrl`）、`app/assets/zh-BTeL9pZH.js`（`settings.balanceUrlHint`） |
| 刷新时机 | `app/assets/index-DUM9tNGw.js` 中 `turn_done` 分支、`clearBalanceForTab` / `refreshBalanceForTab` 定义 |
| 分时标签与时段 | `app/assets/zh-BTeL9pZH.js` 的 `billing.rateBand.*` 文案 |
| 状态栏项与样式 | `config.toml` 的 `[desktop] status_bar_items`、`status_bar_style`；`zh-BTeL9pZH.js` 的 `settings.statusBar*` 文案 |
