# dsh-quick-action

DeepSeek Harness 的快捷操作插件。第一个功能：顶部**会话标签条**（复刻并改进 `dsh-session-tabs`）。

- 双行 chip 标签：工作区名 9px 在上、标题 13px 在下，左对齐；状态字形 14px（未读点 7px）；标签高 46、顶部圆角 23、活动标签带与分线同色的 1px 外框，弹性宽度 132–260px。
- 状态字形在标签左侧行内（14px 槽位，垂直居中）：运行中=旋转弧、完成未读=实心点、需要你=气泡?/盾牌!/清单（回答/审批/计划评审）。
- 完成已读与空闲不显示角标；关闭按钮仅悬浮/活动时出现。
- `⌘⇧[` / `⌘⇧]` 切换上一个/下一个会话；标签栏内 `←` `→` 也可切换。
- `⌘I` 把焦点放到对话输入框（光标落在末尾），可以直接开始输入。
- 修复「新会话空标签」：新会话作为**影子标签**存在，转成真实会话后原地晋升，切走即收起，不写进持久化列表。
- 左栏页脚有开关可切回原生视图（不删除任何数据）。
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

`plugin_manager install_bundle` 因 profile 里其他 GitHub 依赖拉取失败（ECONNRESET，codeload.github.com 不可达）而无法完成 pnpm 安装，因此改为手动链接：

1. `~/.dsh/profiles/desktop/node_modules/dsh-quick-action` → 本仓库的软链；
2. `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加了启用段（并禁用 `session-tabs`）。

回退：

- 删除 `cordis.patch.yml` 末尾的 `# dsh-quick-action（本地开发链接）` 注释块；
- 删除上面的软链；
- 刷新页面即可回到原生视图（旧 `dsh-session-tabs` 同时恢复）。

网络可用时，推荐改用 `plugin_manager install_bundle` 或 `dsh plugin add` 正式安装，届时可删除上述 patch 段，改由 bundle 自带 patch 生效。

## 已知问题 / 待验证

- 输入框随滚动自动隐藏的实验版本曾触发渲染器异常（对话区黑屏），已回退；重启应用后恢复。

- 左栏页脚的「切回原生视图」开关注册在 `sidebar.footer.action`，在当前侧栏布局里没有渲染出来；暂时用上面的回退方式停用。
- 「需要你（回答/审批/计划评审）」与「完成未读」的角标已实现并有 controller 单测覆盖，但本次没有真实待审批/待回答会话可实测；等待中的视觉只做了代码层检查。
- agent-desktop 只能做 AXPress 语义点击，标签内的 × 关闭按钮未能在实机点击验证（快捷键切换、草稿生命周期已实机验证）。

