# Agent Note: 可配置的框架排列

Status: implemented

[English](2026-09-29-frame-arrangement.md) | 中文

## Problem

框架的两个弹性座位此前是固定位置：ui-conversation 声明 `main` 的 `conversation` key，ui-sidebar-right 声明 `rightbar`，而列宽几何、贴边面板、缩放手柄位置、收起控件与平台 chrome 全都针对这两个位置编写。想要换一种排列——工作区界面占据弹性中栏、会话界面留在恒定保留的右栏——只能靠同时改框架和两个功能包实现，而且没有任何扩展点能表达这个选择。第三方插件无法渲染 `root`、无法把别的插件的注册在座位之间搬移、也无法声明别人已声明的 slot，因此插件侧没有可行的绕法。

## Decision

`@deepseek-ai/dsh-client-ui-layout` 拥有持久的 `arrangement` 设置：`ui-layout` 设置命名空间中的唯一 `.volatile()` `Config` 字段，默认 `conversation-center`，由 `settings.general.item` 的一行（「界面布局」）呈现，并可由任意 profile patch 在本插件条目上设置。框架把同样两个已声明的座位渲染到随排列变化的位置，`rightbar` 的 owner share 携带到达占用方的 `role`：

| 排列 | 弹性中栏 | 右栏 |
|---|---|---|
| `conversation-center` | `main`（选中的全局面板，否则 `conversation`） | `rightbar`，`role: 'edge'` |
| `workspace-center` | `rightbar`，`role: 'plain'`（选中的全局面板占据中栏） | `main` 的 `conversation` key |

由于只有位置改变，没有任何功能包注册两次，也没有任何子 slot 被声明两次：ui-conversation 保留 `main.conversation` 子树，ui-sidebar-right 保留 `rightbar.session` 子树，而全局面板占据中栏时 `main` 可以在两个渲染点出现。

`computeColumns` 接受同一个角色。`edge` 下的求解保持不变：右栏先让到 300px，再交出轨道，然后中栏才降到 `CENTER_MIN` 以下。`plain` 下恒定保留的列保持其钳制后的偏好（300px～70%），中栏吸收剩余空间直至为零；框架为此在该排列下不再给网格模板施加中栏的最小值。

ui-sidebar-right 从 owner share 读取 `role`。`plain` 下它以普通流渲染内容树，不滑出、不隐藏，会把此前收起的界面强制打开，不绘制面板控件，不上报呈现或自动全屏事实，并对收起与全屏命令回答 `command.plainColumn`；停靠工具、分栏与浮动面板仍然可用。不上报是有意的：框架按排列而非按占用方上报给普通列定尺寸，因此并不存在可让步的上报。

实时值属于布局存储，`bindLayoutArrangement` 让它与 Host 设置段保持同步：采纳被接受的值、镜像本地选择，并在 Host 尚未接受某个段、或该段拒绝写入时不写任何内容。`ctx.layout.arrangement` 是占用方与命令读取的实时视图，因此切换无需重挂载插件即可生效。

## Alternatives considered

**只发布互换后的布局。** 硬编码排列满足了一种偏好却去掉了出厂偏好；两种排列都合理，而且按「部署相关选择必须是经过校验的 `Config` 字段」这一规则，选择属于配置。

**让插件重排各列。** 框架、网格模板、贴边面板、手柄位置以及 Windows 与 macOS chrome 都属于 ui-layout，slot 所有权也禁止声明别的插件的子 slot。靠 CSS 重排的插件会把滑出、全屏覆盖、缩放手柄与平台内边距留在错误的边缘上——看起来换了位置，行为却是错的。

**把每个界面注册到两个候选父级下。** 同一批子 slot 会被声明两次，加载时即失败，而且两个座位会同时挂载。

**通过新的框架级标准 hook 读取排列。** `provideRoot({ hooks })` 加一个 `GlobalStandardProps` 成员可行，但会为一个包的事实扩大可合并扩展的框架接口；框架已经订阅的存储本身就能承载它，无需新的框架面。

**按会话或按窗口的排列。** 框架的列模型、其保存的宽度与平台 chrome 都是框架级事实，同一 profile 的多个窗口共享设置文档；按会话的排列需要第二个几何权威，还会让同一 profile 的窗口互相不一致。

## Consequences

排列是 profile 级、持久的单一选择；同一 profile 的窗口保持一致，切换会重新渲染两列而不重挂载任何一个插件。切换会保留已记录的面板宽度、打开贴边角色此前收起的界面，并让到达的界面通过自己的座位打开。`RightbarOwnerProps` 增加了 `role`，每个 `rightbar` 占用方与每个 `rightbar.session` 注册方都会组合它；框架的 `role="edge"` 路径保留出厂行为。按角色呈现不同的占用方读取 `ctx.layout.arrangement`；出厂组合不注册第二个占用方。单测覆盖位于 ui-layout 的 columns、store、service、apply、排列绑定、设置行与框架 spec，以及 ui-sidebar-right 的座位与命令 spec；组装后的 Shortcut owners 用例覆盖了无关存储提交绝不写入设置段这一点。贴边界面复用之处见[右侧栏停靠基础设施](../feature/2026-09-04-right-sidebar-docking-infrastructure.zh.md)，排列如今选定的中栏默认项见[全局主面板](2026-09-08-global-main-panels.zh.md)。
