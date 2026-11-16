# AGENTS.md — dsh-quick-action 项目手册

> 给后续 AI 代理的入口文档。改代码前先读完本文件；需要宿主 API 依据时读
> `research/native-ui-notes.md`（每条结论都带 `app.asar` 内路径 + 行号证据）。

## 1. 项目定位

DSH（DeepSeek Harness）的 Web 客户端插件，包名/插件 id 均为 `dsh-quick-action`。
当前功能：**会话页顶部**的会话标签条（复刻并改进旧插件 `dsh-session-tabs`）：双行 chip
（工作区名 9px + 标题 13px）、状态字形、⌘⇧[ / ] 与 ⌘I 快捷键、修复"新会话空标签"；
以及 v0.3.0 新增的居中**对话快速切换器**（⌘J）：已打开 / 最近使用分组、标题模糊搜索、
↑↓/↵/esc 键盘操作。定位是"快捷操作"合集，后续继续加功能；新增功能沿用同一 host/client 两半身结构。

## 2. 目录与职责

| 路径 | 职责 |
|---|---|
| `package.json` | 包声明。`exports["./client"]` 必须指向 `lib/client.js`，否则浏览器半身不会被发布；`dsh.bundle.patch` 指向 `cordis.patch.yml`。 |
| `cordis.patch.yml` | Bundle patch：`insert` 一行 Loader 条目 `id: quick-action`，使包成为 enabled Loader 条目（这是 client-modules scanner 发布浏览器模块的前提）；同时禁用 `dsh-session-tabs`（两条标签条会重叠）。行 id 保持稳定。 |
| `index.mjs` | Host 半身，**刻意 inert**：只有 `name`/`inject`/`apply`，`apply` 仅打日志。全部行为在浏览器半身。 |
| `lib/client.js` | 浏览器半身，真正实现（~1900 行）：`window.__ModuleLoader__.load({id, factory})` → `WORDS` 双语、`CSS` 字符串、`parse/serialize`、`fuzzyMatch/filterSwitcher`（纯匹配）、`createController`（纯逻辑，可单测）、`install`（DOM 挂载：标签条 + ⌘J 切换器）、`apply`。 |
| `locale/{zh,en}.json` | 插件管理器里显示的标题/描述。 |
| `icon.svg` | 插件图标。 |
| `tests/controller.test.mjs` | 无依赖单测（node:assert + 假 window 与假 ctx），覆盖存储解析、状态映射、影子标签晋升、脏数据自愈、循环切换、关闭导航。 |
| `research/native-ui-notes.md` | 原生能力调研（sessionStatus/sessions.list 语义、空白标签根因、slot 清单、快捷键占用、主题 token），含证据；引用结论时优先信它。 |
| `docs/prototype/` | Figma 原型截图（14 张，01–08 标签条；09–14 切换器）。 |
| `docs/verify/` | 实机验证截图（20 张，含标签条迭代与 chrome-tabs 对比）。 |
| `docs/figma/` | 原型归档：标签条 7 张画板的矢量 PDF（`pdf/`）；切换器 6 张画板的规格 + PNG（`README.md` 新增章节）。 |

## 3. 开发与验证命令

```sh
node --check lib/client.js          # 语法检查（无依赖）
node tests/controller.test.mjs      # controller 单测，末尾打印 "controller tests: ok"
```

安装（当前方式，v0.2.6 起已转为正式 bundle 安装）：
- 走 `plugin_manager install_bundle`，目标 `github:xx529/dsh-quick-action#vX.Y.Z`。
  它会写入 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 与 `dsh.profile.bundles`，
  包内 `cordis.patch.yml` 自带 `quick-action` 的 insert 段。
- **不要再在 profile 的 `cordis.patch.yml` 里手工 `insert: quick-action`**：`insert` 不校验重复 id，
  会变成两条同 id 行（可能双标签条）；bundle 段已覆盖该行。
- 旧的 vendor 克隆 + `node_modules` 软链方案已清理（v0.2.6 起不再需要）。
- 升级：`plugin_manager install_bundle` 换 tag 即可；改完 `lib/client.js` 需重启 Harness 才生效。
- 若 `install_bundle` 报 `connection to github.com timed out after 5000ms`（DSH 进程里的代理对 GitHub 不通，但 shell 去代理直连正常）：用 DSH 自带 pnpm 直连安装，等效且三者一致——
  `cd ~/.dsh/profiles/desktop && env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY node "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/dist/pnpm.mjs" add "github:xx529/dsh-quick-action#vX.Y.Z"`。
  （只在 CI/网络异常时应急；正常仍走 `install_bundle`。）

## 4. 关键约束与坑（改了会坏）

1. **模块注册**：必须走 `window.__ModuleLoader__.load({id: 'dsh-quick-action', factory})`，`id` 严格等于包名；
   `factory` 内 `require('react')`，但组件树全用原生 DOM 手写，React 只作为加载器依赖存在。
2. **inject 的服务**：`['slots','sessions','uiWorkspace','uiSession','workspaces']`；状态只从
   `ctx.uiSession.sessionStatus`（`running` / `completionUnread` / `pendingInteraction.kind` =
   `approval` / `question` / `plan-review`）与 `ctx.sessions.list`、`ctx.workspaces.list` 读快照，
   用 `subscribe()` 订阅，不要自己轮询。
3. **blank 会话是影子标签**：`startSession()` 会创建**真实持久化 id** 的 blank 会话。blank 绝不写进
   持久化 `ids`，只用内存 `draftId` 渲染一个占位标签；转正（`blank=false`/有标题）时**原地晋升**为正式标签；
   切走即收起。`sync()` 在 `phase==='ready'` 时还会剔除历史脏 blank/归档 id（自愈 localStorage）。
4. **没有官方 tab 插槽**：标签条只能 DOM 注入，但**必须挂在会话页内部**，不要挂到 `#root [data-slot="main"]` 的祖先 column（那个位置全局面板也会显示，正是 v0.3.x 之前的问题）。做法：`#root [data-slot="main"]` 内找 `[data-conversation-region="chat"]`，用 `closest('[data-phase]')` 拿会话页根节点（`kiGsTW_root`），把 host 作为**页面第一个子元素**（标题行 `header[data-window-drag]` 之上）。`markPage(page)` 打 `[data-qa-page]`，并按 phase 设置 `[data-qa-hero]`：`active` 时移除，`hero`/`settling` 时设置（CSS 收起空 header）；同时给页头打 `[data-qa-header-surface]`，让页头背景 = `--qa-surface`，活动标签使用同一变量，形成“标签与标题行连成一体、底部无缝”的视觉。`[data-global-panel]` 或找不到会话页时 `host.hidden = true`，标签条随会话页一起消失。`slot.firstElementChild`（跳过 `display:contents`）仍打 `data-qa-main` 撑高。**React 拥有 children**，会被 reconcile 移除，所以必须 `MutationObserver(document.body, {childList,subtree,attributes,attributeFilter:['hidden','aria-hidden','data-global-panel']})` + 幂等重挂（`host.isConnected` 检查；回调里先判 `!host`，否则初始安装早于 `chrome()` 时会抛 `isConnected of undefined`），不要只 `append` 一次。**状态表达（标题扫光、待处理呼吸灯、未读绿点、workspace/title 颜色）是硬约束，改外观时只动外壳，不要动这些规则。**
5. **快捷键**：用 `window.addEventListener('keydown', ..., false)`（bubble），先判
   `event.defaultPrevented || event.isComposing || keyCode===229`（中文组字不拦截）；⌘⇧[ / ] 切换、
   ⌘I 聚焦输入框（光标落末尾）、⌘⇧J 跳到待处理（⌘J 已让给对话列表）（审批>计划>回答>未读 轮转，候选来自全部会话而非仅标签）、⌘W 关闭当前标签（等同点 ×）、⌘M 切换 dsh-remote 的 IDE/普通模式。**快捷键机制**：⌘I、⌘⇧J、⌘⇧[ / ]、「关闭当前会话标签」与「切换 IDE 模式」通过 `ctx.inject(['shortcuts'])` + `scope.shortcuts.register(...)` 注册（⌘I/⌘⇧J 有默认键、设置面板可见可改键；⌘I 在输入框已聚焦时 resolve 返回 `pass` 放行）；`page.close` 的默认键仍占着 ⌘W，所以 closeTab 注册时不要设默认键（`defaults: {}`），否则注册抛 `Conflicting shortcut defaults`；⌘W 的实际触发靠 window keydown 兜底（page.close 当前未绑定，键能到 DOM），用户也可在设置里给 closeTab 绑 ⌘W。标签栏内 ←/→ 也切换。桌面端未注册键才会到达 DOM，避免硬编码
   ⌘W/⌘B/⌘⌥B/⌘T 等已占用键；宿主有 `ctx.shortcuts.register`，所有命令都走它注册。
   **⌘M 例外**：`quick-action.toggleIde` 桌面默认 `⌘M`——宿主主进程在 `before-input-event` 里对已注册命令 `preventDefault()` + `setIgnoreMenuShortcuts(true)`（防 macOS 菜单「最小化」抢键）再派发 IPC，所以能收到；实现只点 dsh-remote 的稳定标记（开着点 `[data-rw-ide-exit]`，否则点 `[data-rw-ide-toggle]:not([disabled])`），**不按会话区门控**（IDE 模式下焦点常在文件树/编辑器，不在会话区）。Web 浏览器抢不到 ⌘M，默认 `⌥⌘M`。
6. **主题 token**：只用 `--dsw-alias-state-{business,success,warn,error,done,idle}-*` 与
   `--dsw-alias-{bg,border,label,interactive}-*`；**没有 `warning`、没有 `danger`**（旧插件写
   `state-warning-primary` 实际一直走 fallback）。顶栏定位用 `--dsh-frame-leading-clearance` 等框架变量。
7. **关闭标签 ≠ 停止会话**；关掉最后一个标签会 `startSession()` 开新草稿。

## 5. 已知问题（别再踩）

- 滚动淡出输入框（阅读收起）：只对 `[data-composer-seat]` 做 `opacity`（**绝不加 transform / will-change**），滚动停下后淡入；**默认开启**（`readModeFrom(stored, suppressed)`：只有 `stored === 'off'` 才算用户显式关闭），`⌘⇧H` 手动开关，开关状态在 `localStorage["dsh-quick-action.readmode"]`。崩溃自保护用 `crashState(hadToken, streak, ageMs)` 计算：只有上次会话 token 的年龄 `<120000ms`（启动后 2 分钟内就结束，`tokenAge()` 解析 `qa-<毫秒>-<随机>`）**且连续两次**（`dsh-quick-action.crash-streak >= 2`）才把 `crashSuppressed` 置为本次运行有效；正常关闭/长会话（token 残留但跑了很久）一律把 streak 清零。**绝不要 `setReadMode(false)`**。历史教训：早期只看 token 是否存在，DSH 退出时 pagehide 不一定触发，streak 被累加到 19，导致阅读收起永远被压制、看起来“默认没开”。压制提示存到 `startupNotice` 并保留 10 秒（render 用 `snap.notice || startupNotice`，否则会被下一次 render 立刻藏掉）。若再出现黑屏，立刻设为 off 并回退。
  **不要再用 `transform`/`opacity` 动 `[data-composer-seat]`**。
- **全局面板不再显示标签条（v0.4.0，取代 v0.2.9 的“取消选中”）**：`ui-layout` 的 `renderSlot("main", {}, { entryKey: panelId ?? "conversation" })` 决定主面板内容；`panelId !== null` 时主面板 `<div class="…mainPanel" data-global-panel>` 带 `[data-global-panel]`，conversation 面板没有。侧栏的插件/插件市场/自动化任务/上下文洞察/能力面板都走这条。因为标签条现在挂在会话页根节点（`[data-phase]`）内部，全局页面没有会话页，标签条随 `conversationPage()` 返回 null 一起隐藏；`render()` 仍用 `stripActive(snap.active, globalPanelOpen())` 兜底（全局页面 active 置 null）。`MutationObserver` 的 `attributeFilter` 含 `data-global-panel`，切换即时隐藏/重挂。**不要改回“只在全局页面取消选中、标签条继续显示”**——验收要求全局面板无标签。
- **待处理卡片与阅读收起的冲突（v0.2.6 已修）**：宿主的审批卡片（`ui-approval`）、回答卡片与计划待审卡片（`ui-user-questions`）都通过 `conversation.composer` 槽注入，DOM 上位于 `[data-composer-seat]` **内部**；整块 seat 淡出会连卡片一起隐藏且 `pointer-events:none` 点不到。隐藏前必须双重判定：`hasPendingCard(seat)`（稳定属性 `[data-approval-key]` / `[data-question-key]` / `[data-plan-review-key]`）或 controller 的 `activePending()`（`uiSession.sessionStatus.get(active).pendingInteraction`）任一为真就 `showComposer()` 并跳过隐藏；`render()` 里也要补一次还原，避免卡片在已隐藏状态下出现。
- 左栏页脚"切回原生视图"开关已按要求删除；`sidebar.footer.action` 在当前侧栏布局下本来也渲染不出来。
- 未实测项：待审批/待回答的角标只有代码与单测覆盖；agent-desktop 只能 AXPress，标签内 × 未实机点验。
- 状态优先级：`approval > plan > answer > running > unread > loading > idle`；`question` 映射为
  `answer`，未知 pending kind 也归 `answer`。

## 6. 代码风格与数据

- vanilla DOM + CSS 字符串（`var CSS = \`...\``），**无运行时依赖**；逻辑集中在 `createController`，
  DOM 只在 `install` 里，保证可单测。
- 文案一律走 `WORDS.zh/en`，语言由 `document.documentElement.lang` 判断，别硬编码字符串。
- 持久化：`localStorage['dsh-quick-action.tabs.v1']`，格式 `{version:1, enabled, ids, active}`；
  `ids` 去重、上限 50，`validId` 拒绝空/超长/控制字符。设备切换/调试用 `window.__dshQuickAction`
  （`dispose` / `snapshot`）。
- tab 拖动排序（v0.2.11 起；v0.2.12 改为跟随鼠标）：拖动中**不移动 DOM**，只写 inline `transform`：被拖 chip 跟随指针 `translateX(dx + Δscroll)`，其它 chip 按「移除原位置左移 / 目标位置右移」叠加 `translateX(±(宽度+间距))`，靠 `.qa-tab{transition:transform .18s}` 平滑让位；落点用 `pointer contentX` 与各 chip **拖动开始时测得的中心**比较得出 target，松手才把 target 顺序交给 `ctrl.reorder(ids)` 并 `render()` 重排 DOM。回落瞬间先给所有 chip `transition:none`、清 transform，再在下一帧恢复过渡，避免回弹动画。
- 拖动中的 chip **必须不透明**，且 hover/pending 的背景规则必须排除拖动态：`.qa-tab[data-active=false]:not([data-dragging=true]):hover` 与 `.qa-tab[data-pending=true][data-active=false]:not([data-dragging=true])` —— 否则非当前标签拖动时被 `:hover`（6% 透明）覆盖，又出现文字穿透；当前标签不中这条所以看起来是好的（v0.2.19 修）。`background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--qa-page))`（`--qa-page` 是不透明底色）；v0.2.12 曾用 9% 叠在 `transparent` 上，会透出下面 chip 的文字（用户报过）。另加 `0 0 0 1px var(--qa-line)` 描边以在重叠时区分边缘。
- 旧实现备忘（v0.2.11，已废弃）：`pointerdown` 落在 `.qa-tab`（`.qa-close` 与 `data-draft=true` 的影子标签除外），位移 >6px 且竖向 <10px 才进入拖动；拖动中用 `setPointerCapture` + `pointermove` 按各 tab 中点实时 `insertBefore`；松手收集 DOM 顺序交给 controller `reorder(ids)`（必须恰好覆盖全部持久化 id，否则返回 false）再 `render()`。`Esc` 取消（清 DOM 变更用 `lastSignature=''` 强制重排），取消/完成后 `suppressClickUntil` 350ms 拦截紧随的 click，避免拖动误导航。边缘 44px 内 rAF 自动 `scrollLeft`。**不要给 `.qa-tab` 加 transform 来做跟手动画**，只需 `data-dragging` 样式（z-index/背景/阴影）。
- 头部通知区已删除（v0.2.38）：标签条下方不再有 `.qa-notice`，`flashNotice`/`startupNotice`/`noticeEl` 全部移除；隐藏头部、阅读收起、保持唤醒、⌘⇧J 无可跳转等一律不显示文案，只用按钮/图标状态表达。新增功能不要再加提示行。
- 提示文案不许写死键名（v0.2.18）：标签条 `listEl.title` 由 `hintText(words)` 用当前配置生成（`keyLabel(binding, mac)` 格式化；未绑定的命令整段省略；`⌘1–⌘9` 仅在 tab1/tab9 都存在且修饰键相同才折叠成范围），并订阅 `shortcuts.catalog.subscribe(refreshHint)`，在设置里改键后立即刷新。新增命令时提示片段加到 `hintText` 与 WORDS 的 `hint*` 字段，不要在 `WORDS.hint` 里写键名。
- 工作区标题注意力入口（v0.2.45）：在 `[data-slot="sidebar.workspaces"]` 里找 `[class*="sectionHeader"]`，把铃铛按钮**绝对定位**挂到 sectionHeader 上、放在 `[class*="searchSlot"]` 左侧（`left = search.left - header.left - 30`，垂直居中）；**不要插进 headerActions**（它的 `max-width:60px` + overflow 会让第三个图标把原有 icon 挤重叠）。sectionHeader 若为 static 则补 `position:relative`；窗口 resize 时 `schedule()` 重新定位；**铃铛常显**（宽侧栏时一直显示，不因 0 待处理而消失）；按钮尺寸 28x28、与 host `.iconButton` 对齐（top 按 `(header.height-28)/2` 计算，垂直中心与搜索图标一致）；有需要处理时右上角显示 6px 红点（`.qa-attn-dot`，`--dsw-alias-state-error-primary`，带 1.5px 深色描边压边；定位 `top:2px; right:0`，是铃铛图形的右上角，不是按钮正上方——`top:4/right:4` 会看起来压在铃铛顶正中）；铃铛位置在搜索图标左侧、不占 headerActions 布局宽度（v0.2.48）；**注入到侧栏的组件不能使用 `.qa-host` 作用域的 `--qa-*` 变量**（不在该子树里，var() 会失效成透明/继承），hover 背景与颜色必须直接用宿主 token：`var(--dsw-alias-interactive-bg-hover)`、`var(--dsw-alias-label-tertiary)`→hover `label-primary`（v0.2.51）。**铃铛直接复用宿主图标按钮的 class**（`className = sampleButton.className + ' qa-attn'`，**每次 refresh 都补一次**：header 图标可能比插件晚挂载，首次创建时 sample 为空，之后必须再对齐，否则颜色停在继承的 tertiary、hover 时像多一层高亮 v0.2.54），只保留绝对定位与红点，颜色/hover/focus 全部由宿主样式决定——自己写 hover 会多出「图标变亮」的高亮（v0.2.53 定稿）。**不要自己加 `:focus-visible` 描边**：点击后按钮残留焦点会多出一圈高亮；鼠标点击后在 handler 里 `blur()`（`event.detail > 0`），保留键盘焦点态（v0.2.52）；**统计范围是全部会话（list.byId），不是仅标签条里的 rows**（避免只在侧栏存在的会话被漏算）；红点固定红色，分类明细放 title tooltip；宽模式（存在 `[class*="sectionLabel"]`）且 total>0 才显示，否则移除；点击 `ctrl.focusAttention()` 跳下一个。标题同时给出分类明细。
- 保持唤醒（v0.2.35；v0.2.36 改位置）：**DOM 注入**太阳按钮到 `[data-slot="settings.launcher"]`（头像/设置按钮）之后、同一行内（与 `dsh-mobile-plugin` 相同做法，另加 `outlet.closest('[data-slot="sidebar.settings"]')` 校验；行宽 <120 时退回 `sidebar.footer.action` 行）；`ensureAwakeButton()` 在每次 `refresh()` 调用，React 移除后会被 MutationObserver 补回；按钮点击 `wakeToggle`，状态由 `wakeNotify` 同步 `data-on/title/aria-pressed`。快捷键，快捷键 `quick-action.keepAwake`（桌面 ⌘⇧K / Web ⌥⌘⇧K），实现用 **`navigator.wakeLock.request('screen')`**（不写系统配置；DSH 退出/页面隐藏自动释放）。状态：`wake.on`（已拿到 sentinel）/`wake.wanted`（用户希望开）——系统收回时 on=false 但 wanted 保持，`visibilitychange` 回到 visible 时自动重新申请；`pagehide`/dispose 调 `wakeDisable()`；`prefers-reduced-motion` 无关。调试入口 `window.__dshQuickAction.wake()`。**不要再往 flashNotice/其它函数里塞清理代码**（v0.2.35 期间误把 dispose 清理插进了 `flashNotice`/`toggleReadMode`，导致每次提示都把唤醒释放掉；已修）。
- 标签过多提示（v0.2.42）：`.qa-list` 横向溢出时，`.qa-strip` 上挂 `data-more=right`，显示右侧 76px 渐隐层 `.qa-fade-right`（`linear-gradient(to right, transparent, var(--qa-strip) 72%)`，opacity 过渡），表示右边还有标签；`updateOverflowHint()` 在 render / listEl scroll / ResizeObserver 里更新；v0.2.43 起左右对称：`scrollLeft>1` 显示左渐隐、未到最右显示右渐隐，属性值 `left|right|both`，到两端时对应侧消失。渐隐层 pointer-events:none，不影响标签点击与 spacer 拖拽；**分割线必须画在渐隐层之上**（`.qa-strip::before{z-index:3}`，fade 是 2），否则右侧渐隐会把底部分割线一起吃掉（v0.2.44 修）。
- 标签外观（v0.4.1 定稿，取代 v0.2.40 的 23px/尾巴/外框）：`.qa-tab` 高 36、`border-radius:10px`（四角都圆）；活动标签背景 `var(--qa-surface)`，页头通过 `[data-qa-header-surface]` 使用同一变量，底部两个圆角贴着标题行、不画线、无外框；非当前标签透明，hover 背景画在 `::before` 上（`left:0;right:0;top:4px;bottom:4px;border-radius:9px`）。`.qa-tail` 和 `.qa-tab::after` 已隐藏，不要恢复。
- 会话头部隐藏（v0.2.33；v0.2.39 动画）：切换时 240ms 过渡 `height/padding-top/padding-bottom/border-bottom-width/opacity`。要点：① header 是 border-box，只把 height 设 0 会被 padding 夹住（残留 17px），必须同时收 padding 与 border；② 起始态先 `transition:none` 写好并 `void offsetHeight` 强制 reflow，再挂 easing + rAF 改目标值，否则从 display:none 恢复时会跳变；③ minHeight 动画期间置 0；④ 动画结束收起用 `setHeaderInstant(true)`（元素 attr + html 标记，防切会话闪），展开则清空内联样式回到 CSS。
- 会话头部隐藏（v0.2.33；v0.2.34 防闪+提示自动消失）：切换类提示统一走 `flashNotice(text, 2600ms)`，不要直接写 `noticeEl`（否则会一直挂着）。防闪双保险：① 隐藏状态同步到 `<html data-qa-hide-header>`，CSS 用 `html[data-qa-hide-header] [data-slot=main] div:has(> header[data-window-drag]):has([data-conversation-region=chat]) > header[data-window-drag]{display:none!important}` —— 新挂载的 header 在样式计算时就隐藏，不等 16ms 的 refresh；② MutationObserver 回调里同步 `applyHeaderVisibility()` 再 `schedule()`。历史上仅靠元素属性 + 延迟 refresh，切 session 会闪一下。
- 会话头部隐藏（v0.2.33 原始实现）：`⌘⇧B`（web `⌥⌘⇧B`）切换 `dsh-quick-action.hideheader`；`conversationHeader()` 用 `[data-conversation-region="chat"]` 的父级找 `header[data-window-drag]`，打 `data-qa-header-hidden`，CSS `header[data-qa-header-hidden]{display:none!important}`；`refresh()` 每次重挂（React 可能重建 header）。`.qa-spacer` 设 `-webkit-app-region:drag`，隐藏 header 后仍可从标签条空白区拖动窗口。注意：会连同会话标题行与视图标签行一起隐藏；若只想藏第二行需另做。
- 快捷键作用域（v0.2.17）：session 级命令（close/next/prevSession/nextSession/tab1..9）只在会话区生效。`sessionRegionFor({modal,host,hasMain,inMain,globalPanel})` 判定：模态框 → false；标签条（host）→ true；无主面板 → true；否则必须在 `#root [data-slot=main]` 子树内且不是全局视图。状态由 `pointerdown`/`focusin`（capture）维护 `sessionFocus`（最近一次交互是否在会话区）；DOM 兜底在 `runSlot` 里门控，宿主派发的命令在 `run(context)` 里用 `sessionNow(context.target)` 门控（注册时 `resolve` 默认把 context 传给 run）。`⌘I`/`⌘⇧H` 不门控。
- 快捷键兜底必须跟随配置（v0.2.16，取代 v0.2.15 的「注册成功就禁用兜底」）：`globalKeydown` 不再硬编码按键，而是遍历槽位，取 `fallbackBindingFor(catalogRow, declared)` —— catalog 有该命令就用它**当前绑定**（`binding=null` 表示用户解绑，旧键失效），catalog 没有（服务不可用/注册失败）才退回插件声明的默认键；再用 `bindingMatches(event, binding, mac)` 做 `code + 精确修饰键` 匹配（mac primary=meta，其它平台=ctrl）后执行。绑定状态从注入 scope 的 `shortcuts.catalog.getSnapshot()`（行字段 `binding`）读；`ctx.shortcuts` 直接访问不到，必须 `shortcutScope = scope` 保存。新增快捷键 = 注册 + 在 `runSlot`/`fallbackSlots` 里加动作，不要另写 keydown 分支。`closeTab` 默认无绑定（page.close 占默认键会冲突），因此默认没有 ⌘W，需要用户在设置里绑。
- ⌘1–⌘9 跳转（v0.2.14）：controller `jumpTo(index)`（1 起算，走 `rows()` 顺序，因此跟随拖动后的排序；越界/非整数返回 false）；在 `ctx.inject(['shortcuts'])` 里循环注册 `quick-action.tab1..9`（桌面 `primary+DigitN`，Web `primary+alt+DigitN`），并在 `globalKeydown` 里保留同一映射的 DOM 兜底（`event.code === 'DigitN'`，`primary` 且无 shift/alt）。宿主已装的其它插件没有占用 Digit 键，注册应成功。
- 标签条分割线（v0.4.1）：标签条与页头之间**不画任何横线**（不要给 `.qa-strip` 加 `border-bottom` 或 `::before` 横线）；活动标签与页头同表面色、无缝衔接，非活动标签直接落在页面底色上。chip 之间也不画竖线（`.qa-tab::after` 隐藏）；左右渐隐层铺满标签条高度即可。
- 状态表达（v0.2.30 定稿）：**workspace 行永远原色；任何状态都不加 chip 底色**。标题：`running/loading` 用 `qa-sweep` 扫光（状态色 + label 色高光，2.4s）；`approval/answer/plan` 用 `qa-breathe` 呼吸（opacity .58↔1，2.8s，标题用 `--qa-text` 72% 状态色柔化）；`unread` 特殊：标题用主色 + 600 字重，6px 绿点 `.qa-unread-dot` **绝对定位在标签右上角**（36px 标签下 `top:7px; right:8px`；`active`/hover/focus 时关闭按钮出现，圆点让到 `right:26px` 避免重叠），仅 `[data-state=unread]` 显示；`idle` 原样。`prefers-reduced-motion` 下全部静态。历史：v0.2.21 横条→22 顶部线→23 整圈描边→24 文本下灯条→25 额外状态词→26 ws+title 扫光→27 仅 title 扫光→29 待处理呼吸、去底色→v0.2.30 未读改右上角绿点。

## 7. Figma 与设计

- 原型在 Figma 文件 `action` 的页面**「Session Tabs 交互原型」**；切换器原型在本地 Figma 文档 `Untitled` 的页面 **「Quick Switcher · 对话切换器」**（fileKey `local:996b5455-bec4-4f33-87a4-dd91aa93cf84`，画板 `01`–`06`，node id 见 `docs/figma/README.md`）；截图在 `docs/prototype/`。
- 归档（标签条 7 张矢量 PDF + 切换器画板尺寸/关键规格/恢复方式）在 `docs/figma/README.md`；改视觉前先对照 `docs/prototype` 与
  `docs/verify`，不要凭空重设计。
- 涉及 Figma 编辑时必须先读 `figma-workbench` skill，并确认目标文档；本仓库任务默认**不动 Figma**。

## 8. 修改后检查清单

1. `node --check lib/client.js` + `node tests/controller.test.mjs` 全绿；新逻辑补 controller 单测。
2. 刷新 GUI 实测：标签条渲染、切换/关闭/新建、⌘⇧[ ]、⌘I 聚焦、⌘J 打开切换器并搜索/↑↓/↵/esc；截图存 `docs/verify/`。
3. 视觉改动必须真机截图验证（先 `agent-desktop skills get desktop` 再操作；它只支持 AXPress 语义点击）。
4. 确认没有改 profile、没有删除用户数据（关闭/禁用都要可回退）。

## 9. 会话快速切换器（v0.3.2）

- 设计：Figma 页面「Quick Switcher · 对话切换器」，6 张画板（打开 / 搜索 / 无结果 / 选择后 / 快捷键配置 / 动效分镜）；规格见 `docs/figma/README.md`。实现前先看 09–14 的 PNG，不要凭空改视觉。
- 入口：`quick-action.openSwitcher`，默认 desktop `⌘J`、web `⌥⌘J`；面板用 flex 垂直居中，`padding:2vh 2vw`、`max-height:72vh`，位置全部按视口比例计算，不写死 top/px；原 `⌘J` 的「跳到待处理」迁移到 `⌘⇧J`；通过 `ctx.inject(['shortcuts'])` 注册，可改键。`fallbackSlots` 第一项是 `switcher`，`globalKeydown` 面板打开时只响应 Esc 与同一个开关键（其它会话快捷键不执行）。
- 数据：`controller.switcherRows(query)`；`已打开` = `rows()`（标签顺序，含 draft 影子标签），`最近使用` = `list.byId` 其余会话按 `updatedAt` 倒序，排除 blank / `origin==='subagent'` / `archived` / 已在已打开组的 id。搜索用 `fuzzyMatch` 同时匹配**标题与工作区名**：连续子串优先，其次字符子序列；`positions` / `wsPositions` 分别用于标题与工作区名的 `<mark>` 高亮；过滤不重排。
- DOM：`install` 内懒创建 `.qa-switcher`，`position:fixed` 挂 `document.body`（不在 React 树内，无需 MutationObserver 重挂）；**不能用 `.qa-host` 作用域的 `--qa-*` 变量**，面板样式直接使用 `--dsw-alias-*` token + `color-mix`；`html[data-qa-switcher]` 只负责打开时锁滚动。
- 交互：打开时记录 `document.activeElement` 并在关闭（esc / 遮罩 / esc 键帽）后恢复；点行/↵ 时 `closeSwitcher(false)` 不恢复焦点，直接 `ctrl.open(id)` 并 `refresh()`。输入框 keydown 自己处理 ↑↓/↵/esc/Tab，并判 `isComposing || keyCode===229`；`Tab` 阻止焦点离开面板。
- 状态点：`idle` 用 `visibility:hidden` 保留 6px 占位，只有 `running/loading/approval/answer/plan/unread` 显示彩色点；**不要用 `display:none`**（标题会左右跳动）。
- 结构：`role=dialog` + `aria-modal`，输入框 `role=combobox` + `aria-activedescendant`，列表 `role=listbox`，行 `role=option` + `aria-selected`；空态不是列表项。打开动效：遮罩 120ms、面板 200ms `cubic-bezier(.2,.8,.2,1)`（y+8px、scale .98→1）；关闭 140ms；`prefers-reduced-motion` 只保留 120ms 透明度。
- 坑：面板的 `.qa-switcher-name` 用 `textContent`/`createTextNode` 构建，**不要用 innerHTML 拼标题**；Emoji/代理对的高亮索引按 UTF-16 与 `indexOf` 一致，若以后改 `Array.from` 要同步调整位置。
- 测试：`fuzzyMatch` / `filterSwitcher` / `switcherRows` 在 `tests/controller.test.mjs` 第 20–21 组。

