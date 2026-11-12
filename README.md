# dsh-quick-action

DeepSeek Harness 的快捷操作插件。第一个功能：顶部**会话标签条**（复刻并改进 `dsh-session-tabs`）。

- 双行 chip 标签：工作区名 9px 在上、标题 13px 在下，左对齐；状态字形 14px（未读点 7px）；标签高 46、顶部圆角 23、活动标签带与分线同色的 1px 外框，弹性宽度 132–260px。
- 状态只体现在 **session 标题**上（workspace 行保持原色、待处理 chip 不加底色）：运行中/连接中=标题彩色**扫光（走马灯）**；待审批/待回答/待评审=标题彩色**呼吸灯**；完成未读=标题加粗 + 胶囊右侧一个 6px 绿点（与 workspace 行垂直居中）；空闲无装饰。
- 关闭按钮仅悬浮/活动时出现；chip 最小宽度 124px（原 132px）。
- 相邻 chip 之间有一条 1px 的淡分隔线（类 Chrome），当前/悬浮标签两侧的分隔线自动隐藏，避免视觉噪音。
- 标签支持**按住鼠标左右拖动排序**（移动超过 6px 才进入拖动，普通点击仍是切换会话）：拖动时 chip 跟着鼠标走、其它 chip 平滑让位（transform 过渡，不做硬切位）；拖到边缘自动横向滚动，`Esc` 取消；顺序写入 localStorage，重启后保留。
- 左侧栏打开**全局视图或配置**（插件、插件市场、自动化任务、上下文洞察、能力面板等，主面板带 `[data-global-panel]`）时，标签条不再把任何会话标成「当前」——此时语义是全局页面，点标签即可回到对应会话。
- `⌘⇧[` / `⌘⇧]` 切换上一个/下一个会话；标签栏内 `←` `→` 也可切换。这两个也已经注册进宿主快捷键表（Web 端默认 `⌥⌘⇧[` / `⌥⌘⇧]`），可在设置里改键。
- 向上翻阅对话（距底部 >88px、输入框为空且未聚焦）时，输入框**淡出隐藏**；滚回底部 / 聚焦输入框 / `⌘I` 时淡入。
  只做 `opacity`，不移动元素；**默认开启**（只有用 `⌘⇧H` 显式关闭才会记住 `off`）。崩溃自保护只压制「当次运行」，异常退出按「上次启动后 2 分钟内就结束」判定；**连续两次短命会话**才触发（正常关闭、长会话、偶发一次异常都不会关闭默认）；触发时在标签条下方提示原因并保持 10 秒，下一次正常启动即恢复。
  底部出现**审批卡片 / 回答卡片 / 计划待审卡片**时永不隐藏（这些卡片由宿主插件注入到输入框区域内，整块淡出会连卡片一起藏掉且点不到），状态恢复后自动回到正常逻辑。
- 左下角侧栏底部（设置图标右侧）新增**保持唤醒**按钮（太阳图标）：点击或 `⌘⇧K`（Web `⌥⌘⇧K`）切换；用浏览器 Screen Wake Lock 阻止锁屏/显示器休眠，**不修改系统设置**，DSH 关闭或页面隐藏时自动释放、恢复系统原状态；已注册进宿主快捷键表可改键。
- `⌘⇧B` / `⌥⌘⇧B`（Web）隐藏 / 显示**会话头部**（标题行 + 视图标签行，类似 Chrome 隐藏书签栏）；状态存 localStorage，重启保持；隐藏后仍可从标签条空白处拖动窗口；切换会话不会再闪出头部，操作提示会在约 2.6 秒后自动消失。已注册进宿主快捷键表，可改键。
- `⌘1`–`⌘9` 跳到从左到右第 N 个会话标签（跟随拖动后的顺序；Web 端默认 `⌥⌘1`–`⌥⌘9`，避免和浏览器切标签冲突），已注册进宿主快捷键表可改键。
- `⌘I` 把焦点放到对话输入框（光标落在末尾），可以直接开始输入。已通过宿主 `ctx.shortcuts` 注册（设置 → 快捷键里可见、可改键）；焦点已经在输入框内时命令返回 `pass`，不拦截编辑器自己的 `⌘I`。
- `⌘J` 跳到下一个「需要你」的会话：按 审批 > 计划评审 > 回答 > 未读 的优先级轮转，连按可逐个遍历。快捷键以**设置里的当前绑定为准**：改键后旧键立刻失效（例如改成 `⌘⇧G` 后按 `⌘J` 什么都不做），插件自带的 DOM 兜底也按同一绑定匹配，不会出现「设置一个键、兜底另一个键」。
- 「关闭当前会话标签」默认**不占键**（`page.close` 占着 ⌘W 的默认位，注册自定义默认键会冲突）；需要 ⌘W 关闭标签的话，请在 设置 → 快捷键 里给它绑定 ⌘W。
- `⌘W` 关闭当前会话标签（等同点标签上的 ×；不停止会话）。`⌘J` 已通过宿主 `ctx.shortcuts` 注册，可在「设置 → 快捷键」里改键；`⌘W` 当前版本的 `page.close` 默认键仍是 ⌘W（但未实际绑定），插件把「关闭当前会话标签」也注册进了设置（显示为「暂无快捷键」），运行时由插件的 window 监听兜底；可在设置里给它绑定 ⌘W。**注意**：DSH 桌面端默认把 `⌘W` 分给「关闭页面/窗口」，如果按下后关掉的是窗口而不是标签，请在 设置 → 快捷键 里把「关闭页面」改到别的键，`⌘W` 才会落到插件。
- 修复「新会话空标签」：新会话作为**影子标签**存在，转成真实会话后原地晋升，切走即收起，不写进持久化列表。
- 左栏页脚有开关可切回原生视图（不删除任何数据）。
- 标签条 tooltip 里的快捷键也是**实时读配置**生成的：改键后立刻变化，未绑定的命令不会出现在提示里。
- **快捷键作用域**：`⌘W`、`⌘J`、`⌘⇧[`/`⌘⇧]`、`⌘1–⌘9` 这些「会话级」快捷键只在**会话区**（对话内容或标签条）生效；焦点/最近一次点击在**左侧栏、右侧栏、全局视图/配置页、模态框**里时不响应，避免误关当前会话。`⌘I`（聚焦输入框）与 `⌘⇧H`（阅读收起）保持全局可用。
- 关闭标签 ≠ 停止会话；会话仍由宿主管理。

安装后本插件会禁用旧的 `dsh-session-tabs`（两者都会插入顶部标签条，同时开启会重叠）。在插件管理器里重新启用旧插件即可回退；本插件的开关在左栏页脚。

## 状态来源

- `ctx.uiSession.sessionStatus`：`running` / `pendingInteraction.kind`（`approval` / `question` / `plan-review`）/ `completionUnread`
- `ctx.sessions.list`：`blank`、`title`、`cwd`、`retainedBy.mainView`
- `ctx.workspaces.list`：`items[].title`、`archivedSessionIds`

## 开发

```sh
# 语法检查 + controller 单元测试（不需要安装依赖）
node --check lib/client.js
node tests/controller.test.mjs
```

原型：Figma 文件 `action` 的页面「Session Tabs 交互原型」，截图在 `docs/prototype/`。
调研依据：`research/native-ui-notes.md`，实机截图在 `docs/verify/`。

## 当前安装状态（本机）

desktop profile 已改为**正式 bundle 安装**（v0.2.6 起）：

- `plugin_manager install_bundle` 目标 `github:xx529/dsh-quick-action#v0.2.8`；
- `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 里是 `github:xx529/dsh-quick-action#v0.2.6`，并已加入 `dsh.profile.bundles`；
- 包本体在 `~/.dsh/profiles/desktop/node_modules/dsh-quick-action`（0.2.8），`pnpm-lock.yaml` 指向 v0.2.8 的 tarball；行插入由包内 `cordis.patch.yml` 提供；
- 旧的 vendor 克隆、`node_modules` 软链、profile `cordis.patch.yml` 里的手工 insert 段都已清理。

升级：

```sh
# 在本机用插件管理器（或面板）执行
plugin_manager install_bundle github:xx529/dsh-quick-action#vX.Y.Z
```

**不要**在 profile 的 `cordis.patch.yml` 里再手工 `insert: quick-action`：`insert` 不校验重复 id，会留下两条同 id 行。改完需要重启 DSH 才生效。

> 历史：早期 `plugin_manager install_bundle` 因 DSH 进程环境里的代理 `127.0.0.1:7897` 对 GitHub 报 `SSL_ERROR_SYSCALL` 而失败，当时改用「GitHub 克隆 + 软链 + 手工 insert」的等效安装；v0.2.6 推送后该问题消失，已恢复正式安装。
>
> **代理异常时的安装备注**：本机 DSH 进程曾出现 `install_bundle` 报 `connection to github.com timed out after 5000ms`（进程里的代理 `127.0.0.1:7897` 对 GitHub 不通，而 shell 去掉代理直连正常）。v0.2.7、v0.2.8 期间先用 `npm pack` 覆盖同步、再用内置 pnpm 直连（去掉代理环境变量后 `pnpm add github:xx529/dsh-quick-action#v0.2.8`）完成安装，`dependencies`、`pnpm-lock.yaml`、`node_modules` 三者已一致。

## 已知问题 / 待验证

- 「阅读收起」（输入框随滚动淡出）v0.2.5 重新启用，改用纯 `opacity`；v0.2.6 起在底部是审批/回答/计划待审卡片时禁用隐藏；v0.2.7 起**默认开启**；v0.2.20 起崩溃保护改为按「上次会话时长」判定（<2 分钟且连续两次才压制），并修复了误判把 streak 累加导致一直不开启的问题。若再出现渲染器黑屏，把 `localStorage["dsh-quick-action.readmode"]` 设为 `off`（或按 `⌘⇧H`），并回退该功能。
- 待处理卡片不隐藏的判定：DOM 标记 `[data-approval-key]` / `[data-question-key]` / `[data-plan-review-key]`（宿主插件稳定属性）+ 会话状态 `pendingInteraction` 双重兜底，两者任一命中即不隐藏。
- 左栏页脚的「切回原生视图」开关已按要求删除。



- 左栏页脚的「切回原生视图」开关注册在 `sidebar.footer.action`，在当前侧栏布局里没有渲染出来；暂时用上面的回退方式停用。
- 「需要你（回答/审批/计划评审）」与「完成未读」的角标已实现并有 controller 单测覆盖，但本次没有真实待审批/待回答会话可实测；等待中的视觉只做了代码层检查。
- agent-desktop 只能做 AXPress 语义点击，标签内的 × 关闭按钮未能在实机点击验证（快捷键切换、草稿生命周期已实机验证）。

