# 鲸鱼娘工作台（whale-work-pet）

一只**独立的桌面置顶窗**里的鲸鱼娘，用她的动作和一张状态卡回答「DSH 现在在干什么」。
窗口不在 DSH 界面里，不随页面刷新，也不占用 Web 界面的任何位置。

## 它做什么

- **窗口**：无边框、透明、始终置顶、不占任务栏；空白处鼠标穿透，只有她和胶囊接住点击。
- **相态动画**：
  | 相态 | 片段 |
  |---|---|
  | 空闲 | 待机呼吸；空闲超过 3 分钟改成三段睡觉 |
  | 工作中 | 认真工作 / 工作摸鱼 / 工作思考 轮播；单轮超过 10 分钟会偶尔看表叹气 |
  | 派了小助手 | 工作思考（订阅 `subagent/start`、`subagent/end`） |
  | 等你确认 | 看表叹气，45 秒后升级成炸毛（`approval/request`、`user-questions/request`） |
  | 出错了 | 打喷嚏，保持 6 秒（`agent/error`） |
  | 干完了 | 收工庆祝，90 秒后回到空闲 |
  | 宿主无响应 | 趴着睡 |
- **单击**：她按 害羞惊讶 → 傲娇生气 → 开心跃动 → 被吓一跳 的顺序轮流回应，2 秒多后回到当前相态。
- **她自己找事做**：空闲超过 30 秒后，每 1–2.5 分钟随机来一段——东张西望、哼歌、打游戏、玩魔方、
  喝奶茶、偷吃被抓、女仆扫除。
- **右键菜单里的动作**：喂小鱼干（吃小鱼干）、摸摸头（开心跃动）、让她打扫（女仆扫除）。
- **状态胶囊**：她头顶一枚胶囊写着当前相态。没有展开的统计卡——要数字就看 Web 界面。
- **双击**：把 DeepSeek Harness 的窗口调到前台，按代价从低到高三级回退：
  1. **文件通道（约 200ms）**：写 `whale-work-pet.open.json`，桌面应用每 150ms 看一眼并回写
     `whale-work-pet.open-ack.json`，收到 ack 就 `focusPrimaryWindow()`。窗口关到托盘时这是唯一
     不重启就能叫回来的路。
  2. **提窗（约 300ms）**：拿不到 ack 时，沿进程祖先链找到持有可见窗口的进程，用
     `AttachThreadInput` + `SetForegroundWindow` 提窗（`AppActivate` 和裸的 `SetForegroundWindow`
     在后台进程里都会被前台锁吞掉，只是返回 True）。
  3. **重启应用（约 2s）**：没有可见窗口也没有 ack 时，用宿主应用自己的命令行再启动一次——
     单实例锁会把这次启动转给运行中的实例，由它 `show()` 出窗口。启动前会摘掉
     `--inspect` / `--remote-debugging-port`，并清掉 `ELECTRON_RUN_AS_NODE`。
- **拖动**：按住她拖走；位置在窗口存活期间保持。
- **右键**：在她或胶囊上右键 → 显示/隐藏小宠物（**互斥，只出现当下适用的那一条**）/
  打开 DeepSeek Harness / 退出。
- **DSH 托盘**：桌面应用的托盘菜单里有「显示小宠物 / 隐藏小宠物」，通过 `$DSH_HOME` 下的
  两个文件与本窗口通信（见下文）。小宠物自己不占托盘。
- **热键**：`Ctrl+Alt+P` 切换显示，藏起来之后不依赖托盘也能叫回来。

## 怎么跑起来

插件激活时由 Host 半边 `spawn` 一个 Electron 进程，插件停用或被卸载时杀掉它。窗口进程还会
每 5 秒确认宿主仍在，宿主崩溃留下的孤儿窗口会自己退出。

## 与 DSH 托盘的通信

托盘属于桌面应用，插件进不去，所以两边用 `$DSH_HOME` 下的两个文件对齐：

| 文件 | 写入方 | 内容 |
|---|---|---|
| `whale-work-pet.visible.json` | 小宠物（2s 心跳 + 每次显示/隐藏） | `{ visible, updatedAt }` |
| `whale-work-pet.command.json` | 桌面应用托盘菜单 | `{ at, action: "show" \| "hide" \| "toggle" }` |

托盘每次右键都重新读一次可见性，所以菜单里只会出现当下适用的那一条；小宠物每 400ms 轮询命令
文件，`at` 比上次新才执行，重启前后的旧命令不会被补执行。

## 怎样把延迟压到 200ms

窗口不轮询磁盘投影，而是读 Host 写的一份**实时快照**：

```
Cordis 事件（agent/status · tools/execute · approval/request · user-questions/request）
        ↓ 内存里更新即时相态
        ↓ 30ms 去抖合并后原子写（tmp + rename）
$DSH_HOME/whale-work-pet.live.json
        ↓ 窗口每 200ms 读一次，超过 2.5s 未更新视为过期
渲染层（相态 ≤200ms 翻转）
```

实测：事件到快照落盘 **34ms**，加上窗口 200ms 的轮询，端到端最坏约 **234ms**（之前要等投影缓存
落盘，3–10s）。

两路数据分得很清楚：

- **相态（她演什么）**：事件驱动，即时。`agent/status` 给 running/idle，`tools/execute` 说明正在干活，
  `approval/request` 与 `user-questions/request` 用 `await next()` 夹住「问出去到回答落地」的全过程，
  所以「等你确认」既准时开始也准时结束。
- **明细（卡片上的数字）**：仍来自投影缓存，2s 刷新一次，天然落后几秒——卡片上那行「明细新鲜度」
  报的就是它的真实年龄，不冒充实时。

Host 不在或快照过期（>2.5s）时，窗口退回自己折叠磁盘投影，行为与之前一致，只是慢。

## 配置（写在 row 的 `config` 里）

| 键 | 默认 | 作用 |
|---|---|---|
| `launch` | `true` | 插件激活时是否拉起窗口 |
| `size` | `220` | 角色显示边长（px），窗口宽度 = size + 60 |
| `margin` | `24` | 距屏幕右下角的边距（px） |
| `alwaysOnTop` | `true` | 是否置顶 |
| `electronPath` | 自动探测 | Electron 可执行文件路径 |
| `debug` | `false` | 把每个事件与每次发布追加到 `$DSH_HOME/whale-work-pet.events.log` |
| `dshHome` | `$DSH_HOME` → `~/.dsh` | 投影缓存所在的 Harness home |

`electronPath` 缺省时依次尝试 `$DSH_ELECTRON_PATH`、本 checkout 的
`node_modules/.pnpm/electron@*/node_modules/electron/dist/`（要求同目录存在 `icudtl.dat`，
半装的 store 条目会被跳过）。

## 还留着的 HTTP 端点

给别的消费者（脚本、OBS、第二块屏）用，桌面窗口本身不需要它们：

| 路由 | 用途 |
|---|---|
| `GET /api/whale-work/state` | 状态快照（`no-store`） |
| `GET /pet-assets/<clip>.webm` | 动画片段，路径做目录穿越校验 |

两条都走 `connection.requestRejection`，只允许 `GET`/`HEAD`。

## 素材来源

10 段 WebM 来自 MIT 许可的 `dsh-whale-girl-pet`，改名后 vendor 进本包，出处见 `NOTICE.md`；
该包已从本机 profile 卸载。状态折叠、窗口、组件都是本包自己的实现。

## 调试

单独跑窗口并抓一张图（不等 DSH）：

```sh
# 先清掉 ELECTRON_RUN_AS_NODE，否则 Electron 会退化成 Node 进程而不开窗
$env:WHALE_PET_SNAPSHOT = 'D:\tmp\shot.png'
$env:WHALE_PET_SNAPSHOT_OPEN = '1'      # 让卡片一开始就是展开的
electron.exe app/main.cjs
```

## 实现备忘（踩过的坑）

1. `kind: 'prefix'` 的路由 path 不能带尾斜杠，否则 `/pet-assets/x.webm` 永远 404。
2. 从外部拉起 Electron 前要清 `ELECTRON_RUN_AS_NODE` / `ELECTRON_NO_ATTACH_CONSOLE`：
   继承进来时 `require('electron')` 只返回一个路径字符串，窗口进程会静默变成普通 Node 进程。
3. pnpm store 里可能有半装的 `electron@*`（有 `electron.exe` 却没有 `icudtl.dat`），启动即
   报 `Invalid file descriptor to ICU data received`；探测时必须校验 `icudtl.dat`。
