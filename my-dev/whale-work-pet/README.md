# 鲸鱼娘工作台（whale-work-pet）

一只**独立的桌面置顶窗**里的鲸鱼娘，用她的动作和一张状态卡回答「DSH 现在在干什么」。
窗口不在 DSH 界面里，不随页面刷新，也不占用 Web 界面的任何位置。

## 它做什么

- **窗口**：无边框、透明、始终置顶、不占任务栏；空白处鼠标穿透，只有她、胶囊和卡片接住点击。
- **相态动画**：空闲 / 工作中（三段轮播）/ 等你确认（45s 后炸毛）/ 干完了 / 宿主无响应。
- **状态卡**：单击她或胶囊展开——当前步骤、累计步数、本步已跑时长、进行中的调用、
  待你回答的问题、最近工具、上下文占用、明细新鲜度。再单击收起。
- **双击**：打开 DeepSeek Harness 桌面应用（复用宿主进程的 `process.execPath`；源码启动时
  指向的是 node，窗口会忽略而不是乱开进程）。
- **拖动**：按住她拖走；位置在窗口存活期间保持。
- **右键**：在她、胶囊或卡片上右键 → 显示 / 隐藏 / 打开 DeepSeek Harness / 退出。
- **托盘**：常驻通知区，右键可显示或隐藏窗口，左键一键切换；窗口藏起来后总有地方叫回来。

## 怎么跑起来

插件激活时由 Host 半边 `spawn` 一个 Electron 进程，插件停用或被卸载时杀掉它。窗口进程还会
每 5 秒确认宿主仍在，宿主崩溃留下的孤儿窗口会自己退出。

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
