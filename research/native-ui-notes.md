# DSH Web 客户端原生能力调研：会话标签（dsh-quick-action）

> 只读调研。未修改 profile、未安装插件、未动 Figma、未改宿主文件。
> 本文所有结论都带证据；证据形式为 `绝对路径:行号`、`inspect` 调用结果，或明确标注的「未找到 / 未验证」。

## 0. 调研基线与方法（先读这一节再看结论）

**被测版本**

- 桌面端运行时：`@deepseek-ai/dsh-desktop-runtime@0.2.2-rc.1`
  证据：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/package.json:2-4`
- Profile：`/Users/lzx/.dsh/profiles/desktop`，其中安装旧实现 `dsh-session-tabs@0.1.6`
  证据：`/Users/lzx/.dsh/profiles/desktop/node_modules/dsh-session-tabs/package.json:2-3`
- 宿主代码全部在 `app.asar` 内。`shell`/`cat`/`rg` 无法读取 asar 内文件；本调研用两种手段取证据：
  1. `read` 工具可直接按 `…/app.asar/dsh/…` 路径读取（行号与解包副本一致，已抽查比对）；
  2. 写 Python 脚本解析 asar 头（`uint32`×4 + JSON 目录表 + 数据区）把目标包解包到 `/tmp` 后全文检索（脚本见附录 A）。
- **客户端 inspect 不可用**：`cordis_inspect_query(platform=client)` 的 `Service.listService` / `Slots.listSubTree` / `Theme.listTokens` 连试 4 次（含单发重试）均返回
  `Client inspect query … timed out after 10000ms. Open or reconnect the Harness page`。
  因此第 1/4/6 节的实时部分改用**同一份数据源的随包发布副本**：客户端 inspect provider 读取的正是
  `@deepseek-ai/dsh-cordis-client-runner` 里的 `SERVICE_API` / `EVENT_API` / `TYPE_API` / `CLIENT_SLOT_API` 四张表
  （`…/dsh-cordis-client-runner/lib/client.js:1281` / `:1847` / `:1891` / `:2606`，provider 装配见 `:7705` 的 `SLOT_CATALOG`）。
  这些表就是 Client Inspect 的原始数据，可信度等同 inspect 输出，只是没有「live occupants」时序。
- Host 侧 inspect 正常（`Service.listService` 返回完整目录），用于确认 `uiWorkspace.startSession` 等契约。

---

## 结论摘要

1. `ctx.uiSession.sessionStatus` 是 `Map<SessionId, {running, pendingInteraction, completionUnread}>`；`pendingInteraction.kind` 只有 `"approval" | "question" | "plan-review"` 三值，足以区分「等审批」和「等回答」；`completionUnread` 只在**后台**会话跑完时置位，会话成为 mainView（被打开）即清除。
2. `ctx.sessions.list` 快照是 `{ids, byId, phase, projectionsBySession}`；行对象**没有**服务端 `displayTitle`，标题由 UI 派生：`blank → i18n「新会话」`，`title 空 →「未命名」`。工作区名应取 `ctx.workspaces.list.items[].title`（Host 持久化、可重命名），目录名 basename 只是兜底。
3. 「新会话」空标签根因：`startSession()` 会通过 Host **真正创建一个持久化 blank Session（有真实 id）**，旧插件把「当前 mainView 会话」无条件写进 `state.ids` 并持久化到 localStorage，而 blank 会话长期留在 `byId` 里，于是永不清理、越攒越多。原生 sidebar 的正确规则是「blank 只显示当前那一个」。修复方案 A（blank 暂不入 tabs，转正后再入）与方案 B（sync 时剔除非当前 blank + 一次性迁移清理）见第 3 节，推荐 A（可叠加 B 做脏数据自愈）。
4. **没有官方「会话标签条」插槽**（109 个 slot 里没有任何 tab-strip）。与顶栏/会话头相关的可加插槽是 `conversation.session.header.{actions,utilities,corner,lineage}`、`conversation.header.leading`、`shell.overlay`；与「每会话状态」最契合的是 `sidebar.session.row.leading/trailing/hover`（ownerProps 只给 `sessionId`，组件内用 `useSessionStatus` 读实时状态）。没有顶栏插槽时只能 DOM 注入到 `[data-slot="root"]` 祖先下（旧插件做法），风险见第 4.3。
5. 客户端**有**统一快捷键注册机制 `ctx.shortcuts.register({...})`（可配置、可改键、自动冲突检测、桌面端会被 Electron 原生拦截）。已占用：`Cmd+W`=`page.close`、`Cmd+B`=左栏、`Cmd+Alt+B`=右栏、`Cmd+T`=**右栏浏览器面板**新建标签（desktop，不是会话标签）。`Cmd+Shift+[` / `Cmd+Shift+T` **无人占用**，也不在 Electron 菜单里，但 `isWebBindingAllowed` 要求 2 修饰键必须是 `primary+alt|shift`，且 Web 运行时建议用 `primary+alt` 规避浏览器自身手势。
6. 状态色 token 是 `--dsw-alias-state-{business,success,warn,error,done,idle}-*`。**注意：没有 `--dsw-alias-state-warning-*`，也没有 `danger` 状态色**（危险= `state-error-primary`）；旧插件 `client.js:47` 写的 `--dsw-alias-state-warning-primary` 是不存在的 token（靠 fallback 才没出错）。
7. 原生**已有**会话状态徽标：`StateDot` 渲染 `<span data-state="ongoing|warning|done|idle">`（ongoing 是 `<svg data-state="ongoing">`）。但侧栏行**没有** `data-session-id` 之类的行 id 属性，所以「靠 DOM 反查某行状态」不可靠；正确扩展点是 slot 组件 + `useSessionStatus`/`useSessions`。

---

## 1. `ctx.uiSession.sessionStatus` 快照字段与语义

### 1.1 结论

- 服务由 `UiSession` 提供，`super(ctx, "uiSession")`。
- `sessionStatus` 是一个**只读快照源**：`{ getSnapshot(): Map<SessionId, SessionStatus>, subscribe(listener) }`。
- `SessionStatus` 三个字段：
  - `running: boolean | undefined` —— 真实运行态。注意**可能 undefined**（某 id 只在 pending/unread 集合里时）；读取请用 `=== true` 判断。
  - `pendingInteraction: SessionPendingInteraction | undefined` —— 该会话当前「等待用户」的交互对象；同一会话多个域同时 pending 时取**优先级最大**的一个。
  - `completionUnread: boolean` —— 「跑完了但用户还没看」。
- `pendingInteraction` **有 kind 字段**，三种取值：
  - `"approval"`：等待确认审批，附 `toolName / callId / reason / displayReason`；
  - `"question"`：等待回答提问；
  - `"plan-review"`：计划待审（提问的一种，优先级最高）。
- `completionUnread` 清除时机：
  1. 会话**再次开始 running**（`running` 变 true）→ 清；
  2. 会话**成为 mainView**（也就是被打开/显示在中央面板）→ 清；
  3. 会话**从 list 消失**（phase==='ready' 后）→ 清。
  也就是说：**打开会话即读**，语义是「on main view」而不是「点击事件」。

### 1.2 证据

服务与快照源定义：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js:798`（`super(ctx, "uiSession")`）、`:782-789`（`sessionStatus = { getSnapshot, subscribe }`）。

快照值是新建 Map，字段逐条：
```
dsh-client-ui-session/lib/client.js:992-1004  publishStatus()
  ids = byId ∪ running.keys() ∪ pendingSnapshot.keys() ∪ completionUnread
  next.set(id, { running: this.running.get(id),
                 pendingInteraction: this.pendingSnapshot.get(id),
                 completionUnread: this.completionUnread.has(id) })
```
（路径同上，行号 992-1004）

- running 的两条来源：
  - Remote 事件：`client.js:814` `ctx.remote.$on("api-session/status", (sessionId, running) => this.observeRunning(...))`；
  - list 行对账：`client.js:972-980` `reconcileStatus()` 用 `row.running` 初始化/纠正。
- `completionUnread` 置位/清除：`client.js:964-971`
  ```
  observeRunning(sessionId, running):
    if (running) completionUnread.delete(sessionId)
    else if ((previous === true || (previous === undefined && list.phase === "pending")) && !this.isMain(sessionId))
        completionUnread.add(sessionId)
  ```
  → 只有「原本在跑、现在停了、且当前不是 mainView」才置未读。
- mainView 清理与离场清理：`client.js:981`（`for (const id of present) if (this.isMain(id)) this.completionUnread.delete(id)`）、`:982-986`（离场删 running 与 unread）。
- `isMain` 判定：`client.js:989-991` `return (byId[sessionId]?.retainedBy.mainView ?? 0) > 0`。
- pending 的 kind 与字段：
  - 审批：`…/dsh-client-ui-approval/lib/client.js:197-227`（`kind` 声明在 `:200`，赋值在 `:225` `this.kind = "approval"`，同段 `:202-216` 列 `key/toolName/callId/reason/displayReason`）。
  - 提问：`…/dsh-client-ui-user-questions/lib/client.js:135-186`（`kind` 声明 `:137`，赋值 `:185` `this.kind = planReviewOf(questions) === undefined ? "question" : "plan-review"`，同段 `:143` `questions`、`:145` `callId`、`:152` `review`）。
- 多域优先级（谁赢）：
  - 审批域注册优先级 `() => 0`：`dsh-client-ui-approval/lib/client.js:458`；
  - 提问域注册 `pending => pending.kind === "plan-review" ? 2 : 1`：`dsh-client-ui-user-questions/lib/client.js:2249`；
  - 合并规则「大者胜」：`dsh-client-ui-session/lib/client.js:949-962`（`if (previous === undefined || precedence >= previous.precedence) next.set(...)`）。
- 原生正是用 `kind` 区分三种等待态（「等待审批 / 计划待审 / 等待回答」）：
  `…/dsh-client-ui-workspace/lib/client.js:1048-1055`（`visiblePendingKind` 只承认这三个值）、`:2328-2375`（`sessionStatuses` 给三种 kind 分别出文案）。
- 原生 workspace README 的语义说明（可直接引用给设计）：
  `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/README.md:74`
  「approvals report Waiting for approval, plan reviews report Plan awaiting review, and ordinary questions report Waiting for answer… a finished-but-unviewed Session uses done…」

### 1.3 对旧实现的判定

旧插件把三态压成四态标签 `idle/running/pending/done`，且 `pending` 不区分 kind：
`/Users/lzx/.dsh/profiles/desktop/node_modules/dsh-session-tabs/lib/client.js:88-94`。
它在「等审批」和「等回答」上显示同一个 `!` 标记（`WORDS.zh.pending = '等待确认'`，`:8`；图标映射 `:318`）——这是新插件可以直接改进的点：用 `kind` 分别给「审批/计划/回答」不同图标与文案。

补充：`cleanup` 语义上，`completionUnread` 与 `pendingInteraction` 可以**同时**为真（后台会话在跑完前有过 pending），原生 `sessionStatuses` 里 pending 优先于 completed，可照抄该优先级。

---

## 2. `ctx.sessions.list` / `ctx.workspaces.list` 快照字段

### 2.1 结论

- `ctx.sessions.list` 类型为 `ObservableSnapshot<SessionListState>`：
  ```ts
  interface SessionListState {
    ids: SessionId[]
    byId: Record<SessionId, SessionSummary>
    phase: 'pending' | 'ready'
    projectionsBySession: Readonly<Record<SessionId, SessionProjectionSnapshot>>
  }
  ```
- `SessionSummary`（行）实际字段（客户端可见）：`sessionId`、`blank`、`running`、`updatedAt`、`cwd`、`origin`、`parentSessionId`、`agentAvailable`、`formatStatus`、`title`（来自 projection，可能缺省）、`projectionValues`、`retainedBy`。
- **没有 `displayTitle`**。原生会话行的显示标题是 UI 派生：
  `blank → 本地化「新会话」`；否则 `title || 「未命名」`。
- 工作区侧：`ctx.workspaces.list` = `{ items, archivedSessionIds, pinnedSessionIds, state, phase, error }`，`items[]` 元素是 `WorkspaceView`：`{workspaceId, path, title, sessionIds, createdAt, updatedAt}`。
- 「工作区文件夹名称」的正确来源：
  - **首选 `items[].title`**（Host 持久化，用户可 `workspaces.rename` 改），原生 sidebar 的**分组标题**就用它；
  - **兜底 `basename(items[].path)`**（= `basename(summary.cwd)`），原生只在「无工作区标题」的 surface（如搜索结果行）用；
  - **不要**直接用 cwd basename 当主标签——用户重命名后就会不一致。

### 2.2 证据

类型声明（客户端公共类型目录，等同 `cordis_inspect_query` client `TYPE_API` 内容）：
`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js:2338`（`SessionListState` 声明全文）、`:2334`（`SessionListPhase`，取值 `'pending' | 'ready'`）。

行字段的权威来源（快照构造 + lineage 投影）：
- `/Applications/…/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js:3601-3630` `buildListSnapshot()`：
  ```
  blank: this.effectiveBlank(summary) && metadata?.blank !== false
  updatedAt: Math.max(summary.updatedAt, metadata?.lastPromptAt ?? 0)
  title: 来自 projectionStore.get("title")，非空字符串才覆盖
  projectionValues
  ```
- 同文件 `:1406-1436` `flattenLineage()`：行上带 `sessionId / origin / parentSessionId / agentAvailable / formatStatus / depth`，并把 `agentAvailable` 从渲染行里剔除（`:1424`）、加 `depth`（`:1436`）。
- `retainedBy` 由保留计数驱动：同文件 `:4080-4095`、`:4110-4117`（`retainedBy` 按 source 计数，`list.set` 时写回行）。

工作区快照：
- `/Applications/…/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-workspace-controller/lib/client.js:257-268` `buildSnapshot()` → `{items, archivedSessionIds, pinnedSessionIds, state, phase, error}`。
- `WorkspaceView` 声明：`…/dsh-cordis-client-runner/lib/client.js:2514`（声明串见 `TYPE_API` 的 `WorkspaceView`，字段 `workspaceId / path / title / sessionIds / createdAt / updatedAt`）。

原生 sidebar 的分组与标签逻辑：
- 分组：`/Applications/…/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1018-1042` `groupByWorkspace()`（定义 `:1027`）；
  分组标题直接取 `workspace.title`：同文件 `:1028`（`buildGroup(...)` 调用处，`buildGroup` 定义在 `:1002`）（`buildGroup(workspace.workspaceId, …, workspace.path, …, workspace.title, members)`）。
- 目录名兜底：同文件 `:886-890` `workspaceLabel(cwd)` = `workspaceTitleOf(cwd) || cwd`，而 `:863-867` 的 `workspaceTitleOf` 就是「去掉尾部分隔符后取最后一段」= basename。
- 搜索/跨工作区行的标签回退链：同文件 `:1180` `const labelOf = (summary) => workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)`。
- 会话行显示标题：同文件 `:2027-2029`
  ```
  function displayTitle(node, t) { return node.blank ? t("session.new") : node.title || t("session.untitled") }
  ```
- 会话行渲染数据来源：同文件 `:1059-1075` `sessionNode()`（`id / title / blank / running / runningSubagentCount / completed / pinned / archived / updatedAt / cwd / pendingInteraction`）。

### 2.3 对旧实现的判定

旧插件标签文案链 `blank ? '新会话' : displayTitle || title || id`：
`/Users/lzx/.dsh/profiles/desktop/node_modules/dsh-session-tabs/lib/client.js:130`。
其中 `displayTitle` 在 `SessionSummary` 上不存在（见 2.2），所以实际是 `title || id`；且**空标题时会显示 UUID 而不是「未命名」**——与原生不一致（原生 `:2028` 用 `session.untitled`）。新插件应改为
`blank ? t('session.new') : (title?.trim() || t('session.untitled'))`。

---

## 3. 「新会话」空标签根因与修复方案

### 3.1 结论（根因，逐条）

1. `ctx.uiWorkspace.startSession()` **会创建（或复用）一个真实、持久化、有 id 的 blank Session**，不是「无 id 的草稿态」。
2. 该会话的 id 通过 `ctx.sessions.list` 的 `byId` 行异步可见（`sessions.create` 成功后立刻写入 `{blank:true}` 的 placeholder 行），**不是**由 `startSession()` 返回值给出（其返回 `void`）。
3. 发首条消息**不会换 id**：同一个 Session 从 `blank` 翻成 `blank=false`（发生在「prompt 被接受」那一刻），标题稍后由 title 投影落地。唯一的例外是「请求的 named blank 被 Host 拒绝」——那时 Host 会另建新 id，并已在响应里返回实际使用的 id。
4. 旧插件 `state.ids` 残留的机制：
   - `sync()` 把「当前 mainView 会话」**无条件** push 进 `state.ids`，包含 blank；
   - 清理只有一个条件：不在 `list.byId` 里或已归档 —— 而 blank 会话是**持久化**的，一直在 `byId` 里，所以**永不清除**；
   - `state.ids` 持久化到 localStorage（`dsh-session-tabs.v1`），重载后又被恢复渲染 → 「残留」跨重启；
   - 每点一次「新会话」，若该工作区没有可复用的 blank，Host 就**新建**一个持久 blank → 空标签越点越多。
5. 原生 sidebar 的正确规则可直接照抄：`session.blank && session.id !== current → 不显示`，即**只显示当前那一个空会话**。

### 3.2 证据

**契约（Host inspect 输出，`cordis_inspect_query(platform=host, provider=Service)` 的 `uiWorkspace` 条目）**

- `startSession(workspaceId?, options?): void`：
  「Open the Workspace blank `connectWorkspace` resolves, so New Session returns to that blank's unsent draft. A creation the Host refuses is shown through the Workspace notice and leaves the selection as it was.」
- `connectWorkspace(workspaceId, options?): Promise<SessionId>`：
  「Resolve the Session for a new conversation in a Workspace: navigation names the first reusable blank member — listed in the Workspace, not archived, and listing no preset or the requested one — and the Host reuses it under the requested preset or its default, creating another Session when it reuses none. … returns a Session already addressable through the Session Controller.」

**实现（客户端）**

- `startSession` 走异步创建：`/Applications/…/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1502-1533`（`startSession` → `this.openWorkspace(target, …)`）。
- `openWorkspaceSession` 先拿 id 再导航：同文件 `:1479-1493`（`sessionId = await this.connectBlank(...)`，然后 `this.replaceMain(sessionId, …)`）。
- 复用选择：同文件 `:1405-1421` `connectBlank`（同 workspace+preset 的并发请求共享一次 attempt）。
- 真正挑 blank 的判定：同文件 `:1420-1431` `createInWorkspace`：
  ```
  sessions.ids.find(id => summary.blank && summary.cwd === workspace.path
        && workspace.sessionIds.includes(id) && !archived.includes(id)
        && (options.agentPreset === undefined || …))
  ```
  → 找到就 `createNamed({workspaceId, sessionId: blank})`，Host 会**复用该 id**。
- id 从 Host 回来：同文件 `:1439-1449` `createNamed` → `this.sessions.create(request)`；`:1440-1443` 处理「named blank 被拒 → 返回不同 id」的情形（`refreshProjections(named)`）。
- `sessions.create` 立刻写 placeholder 行（有 id，`blank:true`）：
  `/Applications/…/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js:3336-3373`
  （`:3348` 调 `remote.session.create`；`:3349-3359` `recordMutation({kind:"placeholder", summary:{sessionId: result.value.sessionId, blank: true, …}})`）。

**语义（Host 侧 README，权威）** `/Applications/…/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/README.md`

- `:48`：「`session.create` returns a Session for a new conversation, and its response names the Session actually used. A named `sessionId` is reused while it is blank (no turn has started)… A named Session that has started, fails the Workspace placement, or is written by another owner stays unchanged, and a new Session is created instead. … `session.list` includes persisted blanks using cached metadata, without opening cold log bodies.」
  → blank 会话**是持久化的**、**有 id**、**会被 list 返回**。
- `:60`：「The blank-to-engaging transition happens at the same acceptance.」（=首条 prompt 被接受时翻态，**同一个 Session**）
- `:46`：「Client list rows … reject stale blank-session hints… An opened conversation is therefore not reused by New Session even when an older list response still marks it blank.」→ 提示：不要用「blank 缓存」推断可复用性。

**原生 sidebar 的可见性规则** `/Applications/…/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:964-966`
```js
function sessionVisible(session, current, archived, archivedFilter) {
  if (session.origin === "subagent") return false;
  if (session.blank && session.id !== current) return false;   // ← 只显示当前空会话
  …
```
同文件 `:877-879` `mainSessionId(list)`：`retainedBy.mainView > 0` 的那一个。

**旧插件为什么残留** `/Users/lzx/.dsh/profiles/desktop/node_modules/dsh-session-tabs/lib/client.js`

- `:6` `KEY='dsh-session-tabs.v1'`，`:74` `serial()`，`:85-86` `saveNow/persist()`，`:79` `savedActive`（持久化+恢复）。
- `:112-126` `sync()`：
  - `:115` 取 list；
  - `:117` 唯一的清理：`state.ids.filter(s => !!list.byId[s] && !archived(s))`；
  - `:118-119` `if (id && id !== suppressed) { if (!state.ids.includes(id)) { state.ids.push(id); persist(); } … }` ← blank 也照收；
  - `:123` 启动时按 `savedActive` 恢复导航。
- `:88-94` `status()` 与 `:130` 行文案（`blank ? 新会话 : displayTitle||title||id`）。
- `:136` `close()` 里 `ctx.uiWorkspace.startSession()`；`:142` `newSession()` 同。
  → 每次点 ➕ 都可能触发 Host 新建持久 blank，而 `sync()` 立刻把它收进 tabs。

### 3.3 修复方案（2 个可落地 + 1 个补强）

**方案 A（推荐）：blank 不落 tabs，作为「影子标签」内存态**

- 做法：`sync()` 里当 `row.blank === true` 时**不写 `state.ids`**；另用一个**不持久化**的 `state.draftId` 记住它，用于渲染唯一一个「新会话」占位标签；当该 id 的 `blank` 变 false（或 `title` 落地）时，再把它晋升进 `state.ids` 并清 `draftId`。
- 好处：与原生语义完全一致（blank 只显示当前一个）；localStorage 不再积累空 id；历史脏数据在下次 sync 自然消失；改动面小（`sync()` + `snapshot().rows` + 渲染层）。
- 代价/坑：
  - 切走再切回一个「还没发消息」的 blank 会话时，占位标签会消失（原生 sidebar 也一样，因为它 `blank && id !== current` 就隐藏）；
  - 需要处理 `active` 高亮：占位标签 active 时不应污染 `state.active` 的持久值；
  - `close()` 关掉占位标签后应回到「新建一个」还是「上一个」需要产品决定。

**方案 B（低成本兜底）：sync 时剔除「非当前 blank」+ 一次性迁移清理**

- 做法：在 `:117` 的 filter 里加条件 `!(row.blank && s !== currentMainId)`；并在首次 `phase==='ready'` 时对已加载的 `state.ids` 跑一次同样的清理（自愈 localStorage 里的历史脏 id）。
- 好处：改动 ≈ 2 行，能立刻消掉绝大多数「一堆空标签」现象，并能自愈已有用户数据。
- 代价/坑：
  - 只是**收窄**而非消除：当前 blank 仍会以标签形式存在，且若用户刻意保留一个空会话做草稿，被切走后标签会消失；
  - 每次 sync 多一次条件判断；「标签闪现再消失」的观感仍可能出现；
  - 与方案 A 叠加时，B 只用于迁移清理。

**方案 C（补强，建议与 A 一起用）：显式拿 id，别依赖 mainView 时序**

- 用 `await ctx.uiWorkspace.connectWorkspace(workspaceId)`（Host inspect 已确认返回 `Promise<SessionId>`）在「新建」时直接得到 id，再 `ctx.uiWorkspace.openSession(id)`；
- 或者 `await ctx.sessions.create({workspaceId})` 自己创建（与 `createInWorkspace` 同语义，但会绕过「复用现有 blank」策略，需权衡）。
- 好处：彻底消除「点 ➕ 后有一瞬间 tabs 不知道该加谁」的时序问题，也避免 `suppressed` 那套补丁。
- 代价：等于重新实现 `startSession` 的 draft 复用/清理语义（`StartSessionOptions.whenDraftExists`、`agentPreset`），要小心功能回归；而且 `connectWorkspace` 并不处理「草稿初始化」，draft 相关仍需 `startSession`。

**建议组合**：A 为主 + B 的迁移清理一次 + 保留 `startSession()`（不要自己造 C），C 仅在「新增标签必须立刻出现」是硬需求时采用。

---

## 4. Client Slots 清单与 `[data-slot="main"]` DOM 挂载

### 4.1 结论

- 全部 slot 共 **109 个**（`CLIENT_SLOT_API`），**没有任何「会话标签条 / tab strip」slot**。
- 与「顶部条 / 会话头部」相关：`conversation.header`、`conversation.header.leading`、`conversation.session.header`、`.actions`、`.utilities`、`.corner`、`.lineage`、`.views.actions`、`shell.leading`、`shell.overlay`、`shell.bottom`。
- 与「每会话状态/徽标」相关：`sidebar.session.row.leading`、`.trailing`、`.hover`（ownerProps 只有 `sessionId`，组件内用 `useSessionStatus`）。
- **没有顶栏插槽能撑起一条「保留布局高度」的横向标签条**：`shell.overlay` 是不占位的浮动层（click-through），`shell.leading` 是左上角座位（已被原生占用），`conversation.header*` 都在会话头内部。
- 官方 slot 组件由 `@deepseek-ai/dsh-client-ui-renderer` 统一包一层，DOM 上带 `data-slot="<key>"` —— 这是唯一「官方稳定」的 DOM 锚点。

### 4.2 证据（slot 目录条目行号 + 关键属性）

目录位置：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js:2606`（`const CLIENT_SLOT_API = [`，共 109 条）。

| slot key | kind | scope | 行号 | 说明 / occupants | 替换风险 |
|---|---|---|---|---|---|
| `conversation.header` | single | session-maybe | `:3364` | 常驻导航容器（含未选会话时），occupant: `ConversationHeader` | shadows-shipped-ui |
| `conversation.header.leading` | single | root | `:3401` | 会话标题前的全局导航位（当前无 occupant） | none |
| `conversation.session.header` | single | session | `:4191` | 每会话严格标题+操作+View 导航，`ConversationSessionHeader` | shadows-shipped-ui |
| `conversation.session.header.actions` | list | session | `:4230` | 标题旁操作；occupants: `agent-preset` / `job-list` / `subagent-catalog` / `agent-team` | none |
| `conversation.session.header.corner` | single | session | `:4293` | 头部最右角一个控件，occupant: 右栏 `ExpandButton` | shadows-shipped-ui |
| `conversation.session.header.lineage` | single | session | `:4332` | 面包屑标题替换位（`SubagentHeaderLineage`） | shadows-shipped-ui |
| `conversation.session.header.utilities` | list | session | `:4371` | 右对齐工具区（open-in-app / schedule / forge / liveshare / log-export） | none |
| `conversation.session.header.views.actions` | list | root | `:4435` | **View 标签行的 More 菜单**（不是会话标签） | none |
| `conversation.view` | list | session | `:4580` | 每会话 View（chat / trajectory / stats），一次只渲染一个 | none |
| `main` | keyed | root | `:4758` | 中央面板，key `conversation` 是会话 | shadows-shipped-ui |
| `shell.leading` | single | root | `:5918` | 窗口左上角 chrome 座位（macOS 红绿灯右侧），已占 | shadows-shipped-ui |
| `shell.bottom` | single | root | `:5888` | 三栏之下通栏，**会占高度** | shadows-shipped-ui |
| `shell.overlay` | list | root | `:5948` | 框架级浮动层，**click-through、不占高度**，「badge / toast / status pill 都属于这里」 | none |
| `sidebar.session.row.leading` | list | root | `:6997` | 行首 16px 座位，**仅当该行主状态为 idle 才渲染** | none |
| `sidebar.session.row.trailing` | list | root | `:7046` | 行尾非交互图标（时间之后、pin 之前，hover 时隐藏） | none |
| `sidebar.session.row.hover` | list | root | `:6948` | 行 hover 卡片中的一段 | none |
| `sidebar.footer.action` | list | root | `:6179` | 侧栏页脚（Settings 旁），旧插件用它放「模式切换」 | none |

**注册参数**（同一目录条目里的 `registerOptions`，与 `SlotCore.register` 声明一致）：

- `list` 型：`id`（required，自有 id 会**新增**一格；复用已占用 id 会**替换**那一格，owner 可按 id 过滤）、`order?`（number，升序，默认 0）、`label?`（`string | (() => string)`，投影时重读，用于本地化）。
- `keyed` 型：`key`（required，owner 按 exact key 派发；占用同 key = 替换）。
- `chain` 型：`select`（required，纯函数，按 owner currency 选择接管；配合 `priority`）。
- `single` 型：**无注册参数**，注册即成为该位唯一 occupant（= 替换原生 UI，`replaceRisk: shadows-shipped-ui`）。
- 通用：`ctx.slots.register(options, component)` 返回 disposer，随 `ctx.effect` 卸载；`ctx.slots.inject(key, () => disposer)` 用于等待 slot 声明出现（声明生命周期内安装，塌缩则清理）。
- 组件可用标准 props（同目录条目 `standardProps`）：`useSessions`、`useSessionStatus`、`useSessionRetainInfo`、`useWorkspaces`、`usePanelInfo`、`useSession(Selector)`、`useProjection`、`useWorkspaces`、`useSessionAccess`、`useContextMenu` 等。
  `sidebar.session.row.*` 的 ownerProps 明确只有 `{ readonly sessionId: SessionId }`（见 `:7046` 条目的 `ownerProps`），文档还要求「occupant 自己按 sessionId 取数，**不得 bind/retain 该 Session**」。

**用 `ctx.slots` 的示例**（目录条目自带的 `example`，语义可靠）：

```js
return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register(
      { name: 'shell.overlay', id: 'quick-action.tabs', order: 100 },
      () => React.createElement('div', null, '…'),
    ))
  },
}
```

### 4.3 `[data-slot="main"]` DOM 挂载的做法与风险

**做法（旧插件的实现，可复用的经验）** `/Users/lzx/.dsh/profiles/desktop/node_modules/dsh-session-tabs/lib/client.js`

- `:250` `var slot = document.querySelector('#root [data-slot="main"]');`
- `:251-252` **向上走到最外层带 `data-slot` 的祖先**作为插入容器：
  `var column = slot.parentElement; while (column.hasAttribute('data-slot') && column.parentElement) column = column.parentElement;`
- `:253` `center.insertBefore(host, center.firstChild)` —— 把标签条插成该容器的第一个子节点。
- `:256-260` 给容器加 `data-dsh-session-tabs-column`（`min-height:0`，CSS `:12`）、给主内容区加 `data-dsh-session-tabs-main`（`flex:1 1 0; min-height:0; height:auto`，CSS `:13`），否则标签条会把 composer 挤出屏幕。
- `:345-370` MutationObserver 兜底：React 换树后 `mainBody` 会脱离、样式标记会丢，于是同步重挂（`:351`）、并过滤掉自己造成的 mutation 防止自激（`:356-366`）。
- `:14` `-webkit-app-region:no-drag` + `padding-inline-start: var(--dsh-frame-leading-clearance, 0px)`：避开 macOS 红绿灯与原生左上控件；条高用 `47px`（darwin 48px，CSS `:16-17`）对齐 `--dsh-frame-top-clearance`（=48px，见第 6 节）。

**风险（按严重度）**

1. **React 拥有该容器的 children**：`insertBefore` 的节点不在 React 树里，父组件任何一次 reconcile 都可能把它挤掉/挪走 → 必须像旧插件那样用 MutationObserver 幂等重挂，并避免自激循环。这是「能跑但永远需要补丁」的结构性风险。
2. **布局标记易失**：`flex` 覆盖写在兄弟节点上，React 换 body 后失效（旧插件 `:346-350` 的注释就是在记录这个坑）。
3. **`data-slot` 是渲染器内部约定**：虽由渲染器统一产出（`…/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1124` `"data-slot": slotKey`），但属于实现细节，无兼容承诺；宿主升级可能改层级。
4. **选择器易腐**：旧插件依赖的 `[data-dsh-bottom-toggle]`（`:265`）在 0.2.2-rc.1 的 85 个 client bundle 中**已不存在**（全量 grep 无命中），说明这类锚点会静默失效。新实现若必须 DOM 注入，只应依赖：`#root`、`[data-slot="…"]`、`[data-conversation-session]`、`[data-conversation-scroll]`、`[data-conversation-region]`、`[data-composer-seat]`（后四者见 `…/dsh-client-ui-conversation/lib/client.js:20595-20608`）、`[data-sidebar-right-*]`（`…/dsh-client-ui-sidebar-right/lib/client.js:725,1743-1744`）。
5. **拖拽/滚动/焦点劫持**：标签条在标题栏区域，必须 `no-drag`，且不得抢走 composer 的键盘焦点（旧插件 `:325` 的 focus 恢复就是补丁）。

**结论**：如果设计上「标签条必须占据独立高度、横跨中栏顶部」，官方 slot 做不到，只能 DOM 注入；若可以接受「浮在头部之上 / 侧栏行内 / 帧级角标」，请用 slot（见第 7 节）。

---

## 5. 快捷键：已有机制、冲突与推荐写法

### 5.1 结论

- 客户端**有**统一注册机制：`ctx.shortcuts.register(command)`（可改键应用命令）与 `ctx.shortcuts.registerFixed(action)`（只读输入动作）；服务实现于 `@deepseek-ai/dsh-client-shortcuts`（`super(ctx, "shortcuts")`）。官方插件通过 `ctx.inject(['shortcuts'], …)` 使用。
- 命令定义包含：`id`、`label`、`aliases`、`defaults`（按 `"runtime:platform"` 给物理键位）、`regions`（`page/editable/terminal`）、`modals`（允许生效的 modal id）、`resolve(context)` 返回 `{status:'handled'|'blocked'|'pass', run?, reason?}`。
- 冲突不是靠自觉：
  - 注册时对 `desktop/web × macos/windows/linux` 全组合做**默认键位冲突检测**，冲突直接 throw；
  - `bindingIssue()` 有一张**保留键表**：`Escape/Tab/Space/Backspace/Delete/Arrow*`、`Enter`（无 alt）、`primary+C/V/X/Z/Y/Q/H`、`primary+A`（无 shift）、非 macOS 的 `meta`、macOS 的 `ctrl+meta`、macOS 的「alt 但无 primary」。
- **桌面端（Electron）由原生先拦截**：已注册命令的键位在 `before-input-event` 阶段就被 `preventDefault()` 并转成 IPC 命令；**未注册的键位照常到达页面 DOM**。所以插件自定义键位在桌面端能被 keydown 收到（前提是别和已注册命令撞）。
- 占位情况（0.2.2-rc.1）：
  - `Cmd+W` → `page.close`（desktop，`primary+KeyW`）；**已被占用**。
  - `Cmd+B` → `sidebar.left.toggle`（desktop）；`Cmd+Alt+B` → `sidebar.right.toggle`（desktop）。
  - `Cmd+T` → `browser.new`（desktop，浏览器面板新建标签）。
  - `Mod+/` → 快捷键参考面板。
  - `Cmd+Shift+[` / `Cmd+Shift+]` / `Cmd+Shift+T` → **无任何命令占用**（全量 grep `BracketLeft`/`BracketRight` 只命中按键名映射表，无绑定）。
- Electron 菜单：macOS 上是 `应用菜单 + 自定义 File(仅 page.close) + editMenu + windowMenu`，**没有 `Cmd+Shift+[`**。`page.close` 的 accelerator 是**动态**取自客户端命令表。
- 推荐写法（优先级降序）：
  1. 能 `inject: ['shortcuts']` 就注册命令（用户可改键、有冲突检测、会自动进桌面菜单/设置页）；
  2. 否则自己挂 `window` 的 keydown（**bubble 阶段**），按官方 `installKeyboard` 的守卫清单实现；
  3. 绝不硬编码 `Cmd+W`/`Cmd+B`/`Cmd+Alt+B`/`Cmd+T`/`Cmd+Q` 等已占用键；
  4. Web 运行时的默认键位按宿主约定用 `primary+alt`，desktop 用 `primary(+shift)`。

### 5.2 证据

**服务与注册**
- `super(ctx, "shortcuts")`：`/Applications/…/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-shortcuts/lib/client.js:2483`。
- 注册 API 实现：同文件 `:1210-1236`（`register(command)`：全平台默认键位校验 → `normalizeBinding` → Web 可用性 → 保留键 → 与既有命令重叠即 throw）、`:1176-1190`（`registerFixed`）、`:1282-1330`（`dispatch`：区域、modal、冲突、`resolve` 的派发规则）。
- 命令字段与用法（官方示例）：
  - `…/dsh-client-ui-layout/lib/client.js:736-762`（`sidebar.left.toggle`：desktop `primary+KeyB`、web `primary+alt+KeyB`，`regions:["page","editable"]`，`modals:["sidebar"]`，`resolve` 返回 handled/run）。
  - `…/dsh-client-ui-sidebar-right/lib/client.js:196-228`（`sidebar.right.toggle`）、`:295-320`（`page.close` / `page.refresh`：`desktop = {code:'KeyW', modifiers:['primary']}`、`web = {...desktop, modifiers:['primary','alt']}`）。
  - `…/dsh-client-ui-sidebar-browser/lib/client.js:1716-1748`（`browser.new`：desktop `primary+KeyT`）。
  - `…/dsh-client-ui-approval/lib/client.js:434-458`（`registerFixed` 两个只读动作在 `:438`/`:448` `approval.allow`=Enter、`approval.reject`=Esc）。
  - 插件侧写法：`ctx.inject(["shortcuts"], (scope) => { scope.effect(() => scope.shortcuts.register({...}), '…') })`（同文件 `:447`、layout `:734`）。

**保留键与可用性**
- 保留表：`…/dsh-client-shortcuts/lib/client.js:836-865`（`bindingIssue`）。
- Web 允许的组合：同文件 `:109-132`（`isWebBindingAllowed`，`:109`：3+ 修饰键放行；2 个修饰键必须含 `primary` 且含 `alt|shift`；外加 `/`、`shift+,`、`shift+.` 特例）。
- `primary` 语义：同文件 `:51`（`binding.modifiers.map(v => v === 'primary' ? platform==='macos' ? 'meta' : 'control' : v)`）。
- 无 `BracketLeft`/`BracketRight` 绑定：`grep -o 'BracketLeft|BracketRight'` 在 85 个 client bundle 中仅命中 `dsh-client-shortcuts/lib/client.js:18-19` 的 `keyNames` 与 `app.asar/lib/main.js:18795-18796` 的键名表。

**桌面端原生拦截**
- 菜单与动态 accelerator：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/lib/main.js:20933-20937`（`platformMenus = () => darwin ? [fileMenu, {role:'editMenu'}, {role:'windowMenu'}] : [{role:'editMenu'}]`）、`:19607-19613`（`fileMenu` 的 `accelerator = closeAccelerator()`，`closeAccelerator` 定义在 `:19350`，`click: sendMenuClose`）。
- accelerator 来自客户端命令表：同文件 `:19363-19369`（`effectiveShortcuts(definitions, document, "desktop", platform)` → `rows.find(row => row.id === "page.close")` → `updateMenu()`）。
- 只拦截「已配置键位」：同文件 `:19366`（`keys = new Set(...bindingKey(row.binding))`）、`:19527`（`if (!priority && (main || !match)) return;`，`priority = keys.has(key)` 在其上方），随后才 `event.preventDefault()`）。
- 因此：未注册的 `Cmd+Shift+[` / `Cmd+Shift+T` 在桌面端会正常到达页面 keydown。

**官方 keydown 守卫清单（推荐照抄）** `…/dsh-client-shortcuts/lib/client.js:1358-1463`（`installKeyboard`）
- 组合输入：`observeComposition(document)`，`guarded = composition.guards(event) || deadKey || event.getModifierState("AltGraph")`（`:1411`）；
- 焦点区域：`region = 目标在 .xterm → "terminal"；在 input/textarea/select/[contenteditable] → "editable"；否则 "page"`（`:1402`）；
- modal：取 `modalSelector` 命中的最后一个，`context.modal = dataset.shortcutModal ?? "other"`（`:1406-1409`）；
- 只按 **`event.code`** 匹配（布局无关），并读 `repeat`、`defaultPrevented`；
- 监听位置：**capture 阶段只做「序列重置」**，真正派发在 **bubble 阶段**（`:1446-1447`），这样输入框/局部控件先有机会处理；
- 命中后统一 `consume() = event.preventDefault()`（`:1425-1428`）；
- 卸载时移除全部监听（`:1447-1462`）。

**旧插件的现状** `/Users/lzx/.dsh/profiles/desktop/node_modules/dsh-session-tabs/lib/client.js:338`
只在标签条内部（`host.addEventListener('keydown')`）处理 ⌘/Ctrl+Shift+T，带 `isComposing || keyCode===229` 守卫；`Cmd+Shift+[ / ]` 完全没做（方向键才是切标签）。这解释了「为什么用户会觉得没有快捷键」——它其实是**条内焦点**才生效，且无全局机制。

### 5.3 未验证项

- **动态（第三方）插件的 client half 能否 `inject: ['shortcuts']`**：`CLIENT_SERVICE_API` 只列 8 个服务（`layout / locale / sessions / slots / theme / timer / uiWorkspace / workspaces`，见 `dsh-cordis-client-runner/lib/client.js:1281` 起的 `SERVICE_API`），`shortcuts`、`uiSession` **都不在目录里**；但旧插件实测 `inject` 里带 `uiSession` 可以正常工作（`dsh-session-tabs/lib/client.js:382`）。→ 目录是「文档/发现用」而非白名单的概率很高，但**未做 live 验证**。落地方案：先写 1 行 `inject: ['shortcuts']` 探针，跑通再依赖；否则回退自挂 keydown。

---

## 6. 主题 token（设计直接用）

### 6.1 结论

- 状态色（light / dark 同一组名，值随 `body[data-ds-dark-theme]` 切换）：
  | 语义 | token | light | dark |
  |---|---|---|---|
  | 运行中/主品牌 | `--dsw-alias-state-business-primary` | `--dsw-static-deepseek-500` | `--dsw-static-deepseek-400` |
  | 运行中淡底 | `--dsw-alias-state-business-tertiary` | `--dsw-static-deepseek-100` | `--dsw-static-deepseek-800` |
  | 成功/已完成 | `--dsw-alias-state-success-primary` | `--dsw-static-green-500` | `--dsw-static-green-500` |
  | 成功淡底 | `--dsw-alias-state-success-tertiary` | `--dsw-static-green-100` | `--dsw-static-green-900` |
  | **警告/待处理** | `--dsw-alias-state-warn-primary` | `--dsw-static-amber-500` | `--dsw-static-amber-500` |
  | 警告文字 | `--dsw-alias-state-warn-label` | `--dsw-static-amber-600` | `--dsw-static-amber-600` |
  | 警告淡底 | `--dsw-alias-state-warn-tertiary` | `--dsw-static-amber-100` | `--dsw-static-amber-900` |
  | 错误/危险 | `--dsw-alias-state-error-primary` | `--dsw-static-red-600` | `--dsw-static-red-400` |
  | 已完成未读（done） | `--dsw-alias-state-done-primary` | `--dsw-static-violet-600` | `--dsw-static-violet-400` |
  | 空闲 | `--dsw-alias-state-idle-primary` | `--dsw-static-neutral-300` | `--dsw-static-neutral-600` |
- **没有 `--dsw-alias-state-warning-*`**（只有 `warn`）；**没有 `--dsw-alias-state-danger-*`**（危险用 `error`；背景悬停用 `--dsw-alias-interactive-bg-hover-danger`）。
- 基础面：`--dsw-alias-bg-base` / `-layer-1..3` / `-overlay`；边框 `--dsw-alias-border-l1..l4`；文字 `--dsw-alias-label-primary/secondary/tertiary/caption`；交互 `--dsw-alias-interactive-bg-hover`。
- 圆角/阴影/浮层：`--dsw-radius-xs/sm/md/lg/xl/panel`、`--dsw-shadow-lv1..3`、`--dsw-elevation-stroke(-color)`、`--dsw-elevation-panel/prominent/soft`。
- 框架级尺寸变量（标签条定位必用）：`--dsh-frame-top-clearance`（macOS 48px）、`--dsh-frame-leading-clearance`（左上控件横向让位）、`--dsh-frame-overlay-top`（= clearance + 20px）、`--dsh-frame-chrome-top`（Windows 标题栏高）。
- 主题深色开关：`body[data-ds-dark-theme]`；平台：`html[data-platform=darwin|windows]`；Windows 自绘标题栏：`html[data-windows-titlebar]`。

### 6.2 证据

- token 全部内联在 `@deepseek-ai/dsh-client-ui-theme` 的 `design-platform.css` 里，随包编译进 JS：
  `/Applications/…/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1470`（单行 20KB，含 `body{--dsw-static-*…--dsw-alias-*}` 与 `body[data-ds-dark-theme]{…}` 两套）。
  该行内的具体映射（light）：`--dsw-alias-state-business-primary:var(--dsw-static-deepseek-500)`、`--dsw-alias-state-warn-primary:var(--dsw-static-amber-500)`、`--dsw-alias-state-error-primary:var(--dsw-static-red-600)`、`--dsw-alias-state-done-primary:var(--dsw-static-violet-600)`、`--dsw-alias-state-idle-primary:var(--dsw-static-neutral-300)`、`--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00)`、`--dsw-alias-border-l1:#0000000a`、`--dsw-alias-label-primary:var(--dsw-static-neutral-bluish-1000)`。
  （dark）：`--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-950)`、`--dsw-alias-border-l1:#ffffff0f`、`--dsw-alias-state-business-primary:var(--dsw-static-deepseek-400)`、`--dsw-alias-state-done-primary:var(--dsw-static-violet-400)`、`--dsw-alias-state-error-primary:var(--dsw-static-red-400)`。
- 全量 token 名共 **414** 个 `--dsw-*`（对 `:1470` 去重统计），其中 `--dsw-alias-*` 每套 108 个。
- 语义说明（官方文档）：
  - `…/dsh-client-ui-theme/README.md:68`：「Status marks use their own semantic state tokens; `--dsw-alias-state-done-primary` marks finished work… with violet-600 in the light palette and violet-400 in the dark palette.」
  - 同文件 `:138`：「The token sheets are the sole color authority — values absent from the design system are deliberately not appended; the nearest semantic token wins.」
- 框架变量定义：`…/dsh-client-ui-layout/lib/client.js:74` 的 frame CSS 段
  `html[data-platform=darwin]{--dsh-frame-top-clearance:48px}`、
  `html[data-windows-titlebar]{--dsh-frame-top-clearance:var(--dsh-windows-titlebar-height);--dsh-frame-chrome-top:…}`、
  `…{--dsh-frame-overlay-top:calc(var(--dsh-frame-top-clearance) + 20px)}`、全屏时 `--dsh-frame-overlay-top:20px;--dsh-frame-chrome-top:0px`。
- 主题服务（设计联动用）：Host/client inspect `theme` 服务提供 `getTheme(): ThemeSnapshot`、`setTheme(id)`、`overrideTokens(source, tokens)`（可给插件自己叠一层 token 覆盖，见第 0 节的 `SERVICE_API` 输出）。
- 旧实现的反例（务必别抄）：`/Users/lzx/.dsh/profiles/desktop/node_modules/dsh-session-tabs/lib/client.js:47`
  `var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-business-primary))` —— 第一个变量不存在，实际永远走 fallback（老插件里「等待确认」显示的是品牌蓝而不是橙）。

### 6.3 设计建议（基于 token 语义）

- 运行中：`business-primary`（原生 sidebar 的 ongoing 也用这个）。
- 待审批 / 待回答问题：`warn-primary`（原生三种 pending 全用 `warning` 状态点）；若要对「审批 vs 回答」做区分，用 **图标**区分而不是换色（保持和原生一致）。
- 完成未读：`done-primary`（紫），**不要**用绿色（绿色是 success，语义是「成功/合并」）。
- 失败/拒绝：`error-primary`。
- 空闲：`idle-primary`，且原生行内**不显示** idle 点（`…/dsh-client-ui-workspace/lib/client.js:2373-2376`），设计上建议沿用「无点」而不是画灰点。

---

## 7. 是否有比 DOM 注入更合适的扩展点？原生状态徽标在哪？

### 7.1 结论

- **有**，但分场景：
  1. 「每会话状态 / 徽标 / 行内小控件」→ 用 `sidebar.session.row.leading | trailing | hover`（ownerProps `{sessionId}`，`useSessionStatus` 读实时态，官方明确说这几位是**增量**位、不替换原生 UI）。
  2. 「帧级浮层 / 角标 / toast / status pill」→ `shell.overlay`（官方文档原话点名 badge/toast/status pill；click-through，条目自己 `pointer-events:auto`）。
  3. 「会话头部的按钮」→ `conversation.session.header.actions`（增量）或 `.utilities`（增量）；`.corner`（单个、替换）。
  4. 「真正带原生语义的『标签页』」→ 只有 `conversation.view` 的 View 标签行（那是 chat/trajectory/stats 的视图切换，**不是会话切换**），不要挪用。
- **会话标签条没有官方位**：109 个 slot 里没有任何跨会话的 tab strip；`shell.overlay` 不占高度、`shell.bottom` 在底部、`shell.leading` 已被原生占。所以「顶部横贯标签条」要么 DOM 注入（第 4.3 的风险），要么接受形态改变（放侧栏行内/浮层）。
- **原生已有会话状态徽标**：`StateDot` 组件 → `<span data-state="ongoing|warning|done|idle">`（ongoing 是 `<svg data-state="ongoing">` 旋转 spinner）。这是**唯一**官方的状态 DOM 契约。
- 但**行级 id 缺失**：侧栏行没有 `data-session-id`/`data-session` 之类属性，只有 slot 锚点 `data-slot="sidebar.session.row.*"`；所以「靠 DOM 把行 ⇄ 状态对应起来」不可靠，**应当用 slot + hooks**。

### 7.2 证据

**官方推荐的增量位（目录条目原文）**
- `sidebar.session.row.leading`（`…/dsh-cordis-client-runner/lib/client.js:6997`）：「Leading decoration of one Session row, in the 16px cell before the title that the row's own state dot otherwise occupies. A higher-priority state (a pending interaction, a new message, live activity) replaces the seat with that dot for the same row, so an occupant here never renders beside a status dot and is mounted only by a row whose primary state is idle. An archived row keeps that cell blank…」
- `sidebar.session.row.trailing`（`:7046`）：「Non-interactive icons after the row's time label, before its pin marker… Blank Sessions omit the slot. Occupants address their own data by Session id; **they must not bind or retain the Session**.」
- `sidebar.session.row.hover`（`:7162` 附近）：「Section of the Session row's hover card between its relative time and its trailing status line.」
- `shell.overlay`（`:5948`）：「Frame-wide floating layer, above every column and outside their scroll containers. Deliberately generic and unowned by any feature: **a badge, a toast stack or a status pill all belong here**… The layer itself is click-through — entries opt back into pointer events…」
- `shell.leading`（`:5918`）：「Window-chrome seat at the frame's top-left… While the seat is mounted the frame publishes `--dsh-frame-leading-clearance`…」（**已被原生 sidebar 的 HeaderLeadingControls 占用**）
- `conversation.header.leading`（`:3401`）：「Global navigation before the Session title, available without a Session.」（当前 0 occupants，root scope，可用于放「全局」控件，但只有单个位）

**原生状态徽标实现**
- 组件选择：`…/dsh-client-ui-workspace/lib/client.js:2379-2386` `SessionStatusDots` → `StateDot({state: statuses[0].state})` + `visuallyHidden` 的读屏文案。
- 状态映射（可直接抄给设计）：同文件 `:2328-2375` `sessionStatuses()`
  - `pending.kind === "approval"` → `{state:'warning', label:'status.waitingApproval'}`
  - `"plan-review"` → `{state:'warning', label:'status.planReview'}`
  - `"question"` → `{state:'warning', label:'status.waitingAnswer'}`
  - `running` → `{state:'ongoing', label:'status.running'}`
  - 有子代理运行 → 额外 `{state:'ongoing', label:'status.subagentsRunning.*'}`
  - `completionUnread` → `{state:'done', label:'status.completed'}`
  - 否则 `{state:'idle', label:'status.idle'}`（行内 idle 不渲染点）
- `StateDot` 的 DOM 契约（渲染结果）：`<span class="<css-module dot>" data-state="idle|warning|done" style="width/height" aria-hidden="true">`；`ongoing` 分支是 `<svg data-state="ongoing">` + `spinner/spinnerTrack/spinnerArc` 类（CSS module 类名是 hash，不可依赖）。
  证据：`/Applications/…/app.asar/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BgUyXZcc.js` 中 `function Cu({state:e,size:t,…})` 的定义段（该 chunk 是 Web 外壳，primitives 被内联在此；`StateDot: Cu` 的导出映射在同一文件）。
- slot 锚点：`…/dsh-client-ui-renderer/lib/client.js:1124`（`"data-slot": slotKey`）。

**DOM 侧还能依赖什么（已核实存在）**
- `[data-conversation-session]`、`[data-conversation-scroll]`、`[data-conversation-region="chat"|"composer"]`、`[data-composer-seat]`：`…/dsh-client-ui-conversation/lib/client.js:20595-20608`
- `[data-sidebar-right-expand]`、`[data-sidebar-right-panel]`、`[data-sidebar-right-session]`、`[data-sidebar-right-open]`：`…/dsh-client-ui-sidebar-right/lib/client.js:725`、`:1743-1744`
- **已失效**：`[data-dsh-bottom-toggle]`（旧插件 `:265`）在 0.2.2-rc.1 的 85 个 client bundle 中全程无命中。

### 7.3 给 dsh-quick-action 的扩展点选型建议

| 需求 | 推荐扩展点 | 理由 |
|---|---|---|
| 每个会话的「等待/运行/未读」标记 | `sidebar.session.row.trailing`（或 `.leading`）slot 组件 | 官方增量位、有 `sessionId` ownerProp、`useSessionStatus` 直接读，无需绑定/保留 |
| 全局常驻状态胶囊 / 悬浮标签条 | `shell.overlay`（list，click-through） | 官方点名 badge/pill 归此；不替换任何原生 UI |
| 顶部横贯的**布局占用型**标签条 | 只能 DOM 注入（`#root` 下、`[data-slot="root"]` 外层容器首子节点） | 无 slot；风险见 4.3，需 MutationObserver 幂等重挂 + 布局标记重打 |
| 会话头部按钮（如「关闭标签」「固定」） | `conversation.session.header.actions`（增量，`id` 必填） | 增量、`replaceRisk: none` |
| 完全自定义会话头部外观 | `conversation.session.header`（single，替换） | `shadows-shipped-ui`：会**吞掉**原生标题/操作/View 导航，需自己重建，不推荐 |
| 快捷键 | `ctx.shortcuts.register`（若注入可用），否则 window keydown | 见第 5 节 |

---

## 附录 A：证据复现方法（asar 内文件怎么读）

`app.asar` 是「4×uint32 头 + JSON 目录表 + 拼接数据区」。脚本（只读，不改宿主）：

```python
# /tmp/asar_get.py 用法: python3 asar_get.py "dsh/node_modules/@deepseek-ai/<pkg>" /tmp/out
import json, struct, sys, os
P = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
with open(P,'rb') as f:
    _, hdr_pickle, _, json_len = struct.unpack('<4I', f.read(16))
    hdr = f.read(json_len)
base = 8 + hdr_pickle                      # 数据区起点
tree = json.loads(hdr.decode('utf-8'))     # 目录表
target = sys.argv[1].strip('/'); dest = sys.argv[2]
node = tree
for part in target.split('/'): node = node['files'][part]
out = []
def walk(prefix, nd):
    if 'files' in nd:
        for n, v in nd['files'].items(): walk(prefix + '/' + n, v)
    else:
        out.append((prefix, int(nd.get('size', 0)), int(nd.get('offset') or 0)))
walk(target, node)
with open(P,'rb') as f:
    for p, size, off in out:
        rel = p[len(target):].lstrip('/') or os.path.basename(p)
        d = os.path.join(dest, rel); os.makedirs(os.path.dirname(d) or '.', exist_ok=True)
        f.seek(base + off); open(d,'wb').write(f.read(size))
```

要点：
- 解包副本与 asar 内文件**逐字节相同**，因此行号可直接用于引用（已用 `read` 工具抽查 `dsh-client-ui-session/lib/client.js:960-1004`，行号一致）。
- 客户端 inspect 的四张表（`SERVICE_API` / `EVENT_API` / `TYPE_API` / `CLIENT_SLOT_API`）也可以直接从 `dsh-cordis-client-runner/lib/client.js` 里按 `const <NAME> = [` 括号配平切出来 `eval`，得到与 inspect 完全一致的 JSON（本调研即如此取数）。

## 附录 B：未找到 / 未验证清单（不要当成结论用）

1. **客户端 inspect 实时数据**（live occupants、当前 Theme tokens、当前 Slot 树）：4 次调用均 10s 超时，未获取。已用随包目录替代（见第 0 节）。
2. **`WorkspaceView.title` 的 Host 端默认值生成规则**（是否等于目录 basename、在哪生成）：未找到实现（Host 侧 registry 在 `dsh-workspace-registry`，本调研未展开）。设计上请按「title 可能为空 → 回退 basename(path)」处理。
3. **动态插件 `inject: ['shortcuts']` 是否被允许**：目录未列该服务，但同目录也未列 `uiSession` 而旧插件实际可用 → 倾向「允许」，**未 live 验证**。
4. **`Cmd+Shift+[` 在 Web 运行时是否被浏览器/Chromium 抢走**：DSH 内无注册、无菜单占用；浏览器层的「上一个标签页」行为未实测。
5. **`StateDot` 的精确 CSS module 类名**：是构建 hash，随时会变，**不要写进选择器**；只依赖 `data-state`。
6. **`data-dsh-bottom-toggle`**：0.2.2-rc.1 中不存在（旧插件残留选择器）。
7. **`SessionPendingInteraction` 的 `.d.ts` 原文**：客户端 bundle 只保留运行时；类型串仅出现在 `conversation.composer` 的 ownerProps 引用里（`dsh-cordis-client-runner/lib/client.js:3227-3230`），完整 interface 未随包发布。字段集由实现反推（见 1.2）。
