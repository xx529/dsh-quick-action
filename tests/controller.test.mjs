import assert from 'node:assert/strict'

globalThis.window = {
  __ModuleLoader__: {
    load(def) { globalThis.__def = def },
  },
}
await import('../lib/client.js')
const def = globalThis.__def
const mod = def.factory(() => ({
  createElement: () => null,
  useState: () => [0, () => {}],
  useEffect: () => {},
}))

function makeCtx(state = {}) {
  const list = state.list || { ids: [], byId: {}, phase: 'ready' }
  const status = state.status || new Map()
  const workspaces = state.workspaces || { items: [], archivedSessionIds: [] }
  const opened = []
  const ctx = {
    sessions: { list: { getSnapshot: () => list, subscribe: () => () => {} } },
    uiSession: { sessionStatus: { getSnapshot: () => status, subscribe: () => () => {} } },
    workspaces: { list: { getSnapshot: () => workspaces, subscribe: () => () => {} } },
    uiWorkspace: {
      openSession: (id) => {
        opened.push(id)
        Object.keys(list.byId).forEach((key) => { list.byId[key].retainedBy = {} })
        if (list.byId[id]) list.byId[id].retainedBy = { mainView: 1 }
      },
      startSession: () => { opened.push('__new__') },
    },
  }
  return { ctx, opened, list, status, workspaces }
}

const storage = {
  values: {},
  get value() { return this.values['dsh-quick-action.tabs.v1'] ?? null },
  set value(v) { this.values = { 'dsh-quick-action.tabs.v1': v } },
  getItem(k) { return this.values[k] ?? null },
  setItem(k, v) { this.values[k] = v },
}

// 1. parse / serialize round trip
const parsed = mod.parse(JSON.stringify({ version: 1, enabled: false, ids: ['a', 'a', 'b'], active: 'b' }))
assert.deepEqual(parsed.ids, ['a', 'b'])
assert.equal(parsed.enabled, false)
assert.equal(parsed.active, 'b')
assert.deepEqual(mod.parse(JSON.stringify({ version: 1, enabled: true, ids: [], active: null, read: ['x', 'x'] })).read, ['x'], 'read 状态去重持久化')
assert.equal(mod.parse('broken').ids.length, 0)

// 2. status mapping: pending kinds win, then running, then unread
function statusFor(kind) {
  const status = new Map([['s1', { pendingInteraction: { kind } }], ['s2', { running: true }], ['s3', { completionUnread: true }], ['s4', {}]])
  const { ctx } = makeCtx({
    list: { phase: 'ready', ids: ['s1', 's2', 's3', 's4'], byId: { s1: { sessionId: 's1' }, s2: { sessionId: 's2' }, s3: { sessionId: 's3' }, s4: { sessionId: 's4' } } },
    status,
  })
  const ctrl = mod.createController(ctx, { storage })
  return {
    approval: ctrl.status('s1'),
    running: ctrl.status('s2'),
    unread: ctrl.status('s3'),
    idle: ctrl.status('s4'),
    missing: ctrl.status('nope'),
  }
}
assert.equal(statusFor('approval').approval, 'approval')
assert.equal(statusFor('question').approval, 'answer')
assert.equal(statusFor('plan-review').approval, 'plan')
const st = statusFor('approval')
assert.equal(st.running, 'running')
assert.equal(st.unread, 'unread')
assert.equal(st.idle, 'idle')
assert.equal(st.missing, 'loading')

// 2b. markAllRead: 只把完成未读的标签变成本地已读；审批/回答/运行中不受影响
{
  storage.value = JSON.stringify({ version: 1, enabled: true, ids: ['u', 'p', 'r'], active: 'u', read: [] })
  const list = { phase: 'ready', ids: ['u', 'p', 'r'], byId: { u: { sessionId: 'u', title: 'U' }, p: { sessionId: 'p', title: 'P' }, r: { sessionId: 'r', title: 'R' } } }
  const status = new Map([
    ['u', { completionUnread: true }],
    ['p', { completionUnread: true, pendingInteraction: { kind: 'question' } }],
    ['r', { running: true }],
  ])
  const { ctx } = makeCtx({ list, status })
  const ctrl = mod.createController(ctx, { storage, lang: () => 'en' })
  assert.equal(ctrl.status('u'), 'unread')
  assert.equal(ctrl.status('p'), 'answer')
  assert.equal(ctrl.status('r'), 'running')
  assert.equal(ctrl.markAllRead(), 1, '只标记 1 个完成未读')
  assert.equal(ctrl.status('u'), 'idle', '完成未读变成本地已读')
  assert.equal(ctrl.status('p'), 'answer', '待回答不受影响')
  assert.equal(ctrl.status('r'), 'running', '运行中不受影响')
  assert.deepEqual(mod.parse(ctrl.snapshot().storage).read, ['u'])
  status.set('u', { running: true })
  ctrl.sync()
  status.set('u', { completionUnread: true })
  ctrl.sync()
  assert.equal(ctrl.status('u'), 'unread', '新一轮完成未读会重新出现')
}

console.log('mark read tests: ok')

// 3. blank main session is a shadow tab, never persisted; promotion keeps the same id
{
  const blankRow = { sessionId: 'b1', blank: true, cwd: '/tmp/ws/dsh-quick-action', retainedBy: { mainView: 1 } }
  const list = { phase: 'ready', ids: ['b1'], byId: { b1: blankRow } }
  const workspaces = { items: [{ workspaceId: 'w1', path: '/tmp/ws/dsh-quick-action', title: 'dsh-quick-action', sessionIds: ['b1'] }], archivedSessionIds: [] }
  const { ctx } = makeCtx({ list, workspaces })
  const ctrl = mod.createController(ctx, { storage, lang: () => 'zh' })
  let snap = ctrl.snapshot()
  assert.equal(snap.rows.length, 1, 'blank session still renders one tab')
  assert.equal(snap.rows[0].draft, true)
  assert.equal(snap.rows[0].title, '新会话')
  assert.equal(snap.rows[0].workspace, 'dsh-quick-action')
  assert.equal(snap.ids.length, 0, 'blank id is not persisted')

  // engaged: same id, blank false
  blankRow.blank = false
  blankRow.title = '实现会话标签'
  ctrl.sync()
  snap = ctrl.snapshot()
  assert.equal(snap.rows.length, 1)
  assert.equal(snap.rows[0].draft, false)
  assert.equal(snap.rows[0].title, '实现会话标签')
  assert.deepEqual(snap.ids, ['b1'])
  assert.equal(snap.draftId, null)
}

// 4. stale blank ids in storage are healed on ready
{
  storage.value = JSON.stringify({ version: 1, enabled: true, ids: ['old-blank', 'real'], active: 'real' })
  const rows = {
    'old-blank': { sessionId: 'old-blank', blank: true, cwd: '/tmp/x' },
    real: { sessionId: 'real', title: '真会话', cwd: '/tmp/x', retainedBy: { mainView: 1 } },
  }
  const { ctx } = makeCtx({ list: { phase: 'ready', ids: Object.keys(rows), byId: rows }, workspaces: { items: [], archivedSessionIds: [] } })
  const ctrl = mod.createController(ctx, { storage })
  const snap = ctrl.snapshot()
  assert.deepEqual(snap.ids, ['real'])
}

// 5. switch wraps around in render order and ignores single-tab strips
{
  storage.value = JSON.stringify({ version: 1, enabled: true, ids: ['a', 'b', 'c'], active: 'a' })
  const rows = {
    a: { sessionId: 'a', title: 'A', retainedBy: { mainView: 1 } },
    b: { sessionId: 'b', title: 'B' },
    c: { sessionId: 'c', title: 'C' },
  }
  const { ctx, opened } = makeCtx({ list: { phase: 'ready', ids: ['a', 'b', 'c'], byId: rows } })
  const ctrl = mod.createController(ctx, { storage })
  ctrl.switchBy(1)
  ctrl.sync()
  assert.deepEqual(opened, ['b'])
  ctrl.switchBy(-1)
  ctrl.sync()
  assert.deepEqual(opened, ['b', 'a'])
  ctrl.switchBy(-1)
  ctrl.sync()
  assert.deepEqual(opened, ['b', 'a', 'c'])
}

// 6. closing the active tab navigates to a neighbour; closing the last tab starts a draft
{
  storage.value = JSON.stringify({ version: 1, enabled: true, ids: ['a', 'b'], active: 'a' })
  const rows = {
    a: { sessionId: 'a', title: 'A', retainedBy: { mainView: 1 } },
    b: { sessionId: 'b', title: 'B' },
  }
  const { ctx, opened } = makeCtx({ list: { phase: 'ready', ids: ['a', 'b'], byId: rows } })
  const ctrl = mod.createController(ctx, { storage })
  ctrl.close('a')
  assert.deepEqual(opened, ['b'], 'close active -> open neighbour')
  assert.deepEqual(ctrl.snapshot().ids, ['b'])
}

console.log('controller tests: ok')

// 7. Cmd+J cycles attention sessions by urgency: approval > plan > answer > unread
{
  storage.value = null
  const rows = {
    a: { sessionId: 'a', title: 'A' },
    b: { sessionId: 'b', title: 'B' },
    c: { sessionId: 'c', title: 'C' },
    d: { sessionId: 'd', title: 'D', retainedBy: { mainView: 1 } },
  }
  const status = new Map([
    ['a', { pendingInteraction: { kind: 'approval' } }],
    ['b', { completionUnread: true }],
    ['c', { pendingInteraction: { kind: 'question' } }],
  ])
  const { ctx, opened } = makeCtx({ list: { phase: 'ready', ids: ['a', 'b', 'c', 'd'], byId: rows }, status })
  const ctrl = mod.createController(ctx, { storage, lang: () => 'en' })
  ctrl.focusAttention()
  ctrl.focusAttention()
  ctrl.focusAttention()
  ctrl.focusAttention()
  assert.deepEqual(opened.slice(0, 4), ['a', 'c', 'b', 'a'], 'approval -> answer -> unread -> wrap')
}

// 8. no attention sessions: no navigation, notice shown
{
  storage.value = null
  const rows = { a: { sessionId: 'a', title: 'A', retainedBy: { mainView: 1 } } }
  const { ctx, opened } = makeCtx({ list: { phase: 'ready', ids: ['a'], byId: rows } })
  const ctrl = mod.createController(ctx, { storage, lang: () => 'en' })
  assert.equal(ctrl.focusAttention(), false)
  assert.deepEqual(opened, [])
  assert.equal(ctrl.snapshot().notice, 'Nothing needs you right now')
}

console.log('attention tests: ok')

// 9. activePending: 仅当当前会话在等用户处理（审批/回答/计划）时为 true（输入框淡出的守卫）
{
  storage.value = JSON.stringify({ version: 1, enabled: true, ids: ['a', 'b'], active: 'a' })
  const rows = {
    a: { sessionId: 'a', title: 'A', retainedBy: { mainView: 1 } },
    b: { sessionId: 'b', title: 'B' },
  }
  const status = new Map([['a', { pendingInteraction: { kind: 'question' } }], ['b', { running: true }]])
  const { ctx } = makeCtx({ list: { phase: 'ready', ids: ['a', 'b'], byId: rows }, status })
  const ctrl = mod.createController(ctx, { storage, lang: () => 'en' })
  assert.equal(ctrl.activePending(), true, 'active session waiting for answer must block composer hide')
  status.delete('a')
  assert.equal(ctrl.activePending(), false, 'running/reading session does not block hide')
}

console.log('activePending tests: ok')

// 10. hasPendingCard: 识别宿主注入到 composer seat 里的审批/回答/计划待审卡片
{
  const fakeSeat = (attrs) => ({
    querySelector: (sel) => (attrs.some((a) => sel.includes('[' + a + ']')) ? { attr: attrs[0] } : null),
  })
  assert.equal(mod.hasPendingCard(fakeSeat(['data-approval-key'])), true)
  assert.equal(mod.hasPendingCard(fakeSeat(['data-question-key'])), true)
  assert.equal(mod.hasPendingCard(fakeSeat(['data-plan-review-key'])), true)
  assert.equal(mod.hasPendingCard(fakeSeat([])), false)
  assert.equal(mod.hasPendingCard(null), false)
  assert.equal(mod.hasPendingCard({}), false, '没有 querySelector 的节点不能抛错')
  assert.match(mod.pendingCardSelector, /data-approval-key/)
}

console.log('pending card tests: ok')

// 11. readModeFrom: 阅读收起默认开启，只有显式 'off' 才关闭；崩溃保护只压制当次运行
{
  assert.equal(mod.readModeFrom(null, false), true, '未存过 → 默认开启')
  assert.equal(mod.readModeFrom(undefined, false), true)
  assert.equal(mod.readModeFrom('on', false), true)
  assert.equal(mod.readModeFrom('off', false), false, '用户显式关闭才关闭')
  assert.equal(mod.readModeFrom('on', true), false, '崩溃后本次压制')
  assert.equal(mod.readModeFrom('off', true), false, '显式关闭 + 压制仍关闭')
}

console.log('read mode default tests: ok')

// 12. crashState: 只有「短命会话」（<2 分钟）连续两次才压制；长会话/正常退出清零
{
  assert.deepEqual(mod.crashState('token', null, 5000), { streak: 1, suppress: false }, '一次 5 秒退出不压制')
  assert.deepEqual(mod.crashState('token', '1', 5000), { streak: 2, suppress: true }, '连续两次短命 → 压制本次')
  assert.deepEqual(mod.crashState('token', '19', 3 * 3600 * 1000), { streak: 0, suppress: false }, '上次跑了 3 小时（token 残留）→ 视为正常，清零')
  assert.deepEqual(mod.crashState(null, '19', -1), { streak: 0, suppress: false }, '没有 token（正常退出）→ 清零')
  assert.deepEqual(mod.crashState('token', '1', -1), { streak: 0, suppress: false }, 'token 无法解析时间 → 按正常处理')
}

// 12b. tokenAge: 从 qa-<毫秒>-<随机> 解析上次启动时间
{
  assert.equal(mod.tokenAge('qa-1000-abc', 3000), 2000)
  assert.equal(mod.tokenAge('qa-1000-abc'), Date.now() - 1000 > 0 ? mod.tokenAge('qa-1000-abc') : -1)
  assert.equal(mod.tokenAge('bogus', 3000), -1)
  assert.equal(mod.tokenAge(null, 3000), -1)
}

console.log('crash state tests: ok')

// 13. stripActive: 主面板在全局视图/配置时，没有「当前会话」，标签不选中
{
  assert.equal(mod.stripActive('s1', false), 's1', '会话视图下正常高亮当前会话')
  assert.equal(mod.stripActive('s1', true), null, '全局视图/配置下不高亮任何 chip')
  assert.equal(mod.stripActive(null, true), null)
}

console.log('strip active tests: ok')

// 14. reorder: 拖动排序写回 state.ids 并持久化；非法/未变化输入被拒绝
{
  storage.value = JSON.stringify({ version: 1, enabled: true, ids: ['a', 'b', 'c'], active: 'b' })
  const rows = {
    a: { sessionId: 'a', title: 'A', retainedBy: { mainView: 1 } },
    b: { sessionId: 'b', title: 'B' },
    c: { sessionId: 'c', title: 'C' },
  }
  const { ctx } = makeCtx({ list: { phase: 'ready', ids: ['a', 'b', 'c'], byId: rows } })
  const ctrl = mod.createController(ctx, { storage, lang: () => 'en' })
  assert.equal(ctrl.reorder(['c', 'a', 'b']), true, '合法重排返回 true')
  assert.deepEqual(ctrl.snapshot().ids, ['c', 'a', 'b'])
  assert.equal(ctrl.snapshot().active, 'a', '重排不改当前会话')
  assert.equal(ctrl.reorder(['c', 'a', 'b']), false, '顺序未变化返回 false')
  assert.equal(ctrl.reorder(['c', 'a']), false, '缺项拒绝')
  assert.equal(ctrl.reorder(['c', 'a', 'a']), false, '重复项拒绝')
  assert.equal(ctrl.reorder(['c', 'a', 'zzz']), false, '未知 id 拒绝')
  assert.deepEqual(ctrl.snapshot().ids, ['c', 'a', 'b'], '被拒绝的输入不改状态')
}

console.log('reorder tests: ok')

// 15. jumpTo: ⌘1–⌘9 按标签从左到右跳转（1 起算，越界/非整数返回 false）
{
  storage.value = JSON.stringify({ version: 1, enabled: true, ids: ['a', 'b', 'c'], active: 'a' })
  const rows = {
    a: { sessionId: 'a', title: 'A', retainedBy: { mainView: 1 } },
    b: { sessionId: 'b', title: 'B' },
    c: { sessionId: 'c', title: 'C' },
  }
  const { ctx, opened } = makeCtx({ list: { phase: 'ready', ids: ['a', 'b', 'c'], byId: rows } })
  const ctrl = mod.createController(ctx, { storage, lang: () => 'en' })
  assert.equal(ctrl.jumpTo(2), true)
  assert.deepEqual(opened, ['b'], '第 2 个标签打开 b')
  assert.equal(ctrl.jumpTo(9), false, '越界返回 false')
  assert.equal(ctrl.jumpTo(0), false, '0 无效')
  assert.equal(ctrl.jumpTo(1.5), false, '非整数无效')
  assert.deepEqual(opened, ['b'], '无效调用不导航')
  ctrl.reorder(['c', 'a', 'b'])
  opened.length = 0
  assert.equal(ctrl.jumpTo(1), true)
  assert.deepEqual(opened, ['c'], '重排后 ⌘1 跟随新顺序')
}

console.log('jumpTo tests: ok')

// 16. 兜底按键跟随宿主配置（catalog 优先；没有该命令才退回声明默认键）
{
  const row = (binding) => ({ id: 'x', binding })
  assert.deepEqual(mod.fallbackBindingFor(row({ code: 'KeyG', modifiers: ['primary', 'shift'] }), { code: 'KeyJ' }), { code: 'KeyG', modifiers: ['primary', 'shift'] }, '宿主改键后兜底用新键，不用旧键')
  assert.equal(mod.fallbackBindingFor(row(null), { code: 'KeyJ' }), null, '用户解绑 → 无兜底键（旧键失效）')
  assert.deepEqual(mod.fallbackBindingFor(null, { code: 'KeyJ', modifiers: ['primary'] }), { code: 'KeyJ', modifiers: ['primary'] }, '命令未注册时才用声明默认键')
  assert.equal(mod.fallbackBindingFor(null, null), null)
}

// 17. bindingMatches: 按 code + 精确修饰键匹配，mac 的 primary=meta、其它平台=ctrl
{
  const ev = (code, mods) => ({
    code,
    shiftKey: mods.indexOf('shift') >= 0,
    altKey: mods.indexOf('alt') >= 0,
    metaKey: mods.indexOf('meta') >= 0,
    ctrlKey: mods.indexOf('ctrl') >= 0,
  })
  const target = { code: 'KeyG', modifiers: ['primary', 'shift'] }
  assert.equal(mod.bindingMatches(ev('KeyG', ['meta', 'shift']), target, true), true, '⌘⇧G 命中')
  assert.equal(mod.bindingMatches(ev('KeyJ', ['meta']), target, true), false, '旧键 ⌘J 不再命中')
  assert.equal(mod.bindingMatches(ev('KeyG', ['meta']), target, true), false, '缺 shift 不命中')
  assert.equal(mod.bindingMatches(ev('KeyJ', ['ctrl']), { code: 'KeyJ', modifiers: ['primary'] }, false), true, '非 mac primary=ctrl')
  assert.equal(mod.bindingMatches(ev('KeyJ', ['meta']), { code: 'KeyJ', modifiers: ['primary'] }, false), false, '非 mac meta 不当作 primary')
  assert.equal(mod.bindingMatches(ev('Digit4', ['meta']), { code: 'Digit4', modifiers: ['primary'] }, true), true, '⌘4 命中')
}

console.log('fallback binding tests: ok')

// 18. sessionRegionFor: 只有主面板会话区（或标签条）允许 session 级快捷键
{
  assert.equal(mod.sessionRegionFor({}), true, '没有主面板 → 不限制')
  assert.equal(mod.sessionRegionFor({ hasMain: true, inMain: true, globalPanel: false }), true, '主面板 conversation → 生效')
  assert.equal(mod.sessionRegionFor({ hasMain: true, inMain: true, globalPanel: true }), false, '全局视图/配置不算会话区')
  assert.equal(mod.sessionRegionFor({ hasMain: true, inMain: false }), false, '左侧栏/右侧栏不算会话区')
  assert.equal(mod.sessionRegionFor({ hasMain: true, inMain: false, host: true }), true, '标签条本身算会话区')
  assert.equal(mod.sessionRegionFor({ modal: true, hasMain: true, inMain: true }), false, '模态框内不算')
  assert.equal(mod.sessionRegionFor({ modal: true, host: true }), false, '模态框优先级最高')
}

console.log('session region tests: ok')

// 19. keyLabel: tooltip 里的键名由 binding 生成（不再写死键名）
{
  assert.equal(mod.keyLabel({ code: 'KeyG', modifiers: ['primary', 'shift'] }, true), '⌘⇧G', 'mac primary+shift')
  assert.equal(mod.keyLabel({ code: 'KeyG', modifiers: ['primary', 'shift'] }, false), 'Ctrl+Shift+G', '非 mac')
  assert.equal(mod.keyLabel({ code: 'KeyJ', modifiers: ['primary'] }, true), '⌘J')
  assert.equal(mod.keyLabel({ code: 'Digit5', modifiers: ['primary', 'alt'] }, true), '⌘⌥5')
  assert.equal(mod.keyLabel({ code: 'BracketLeft', modifiers: ['primary', 'shift'] }, true), '⌘⇧[', '括号显示为符号')
  assert.equal(mod.keyLabel({ code: 'BracketRight', modifiers: ['primary', 'shift'] }, true), '⌘⇧]')
  assert.equal(mod.keyLabel(null, true), null, '无绑定返回 null（提示里不显示）')
}

console.log('key label tests: ok')

// 20. fuzzyMatch: 标题子串优先；不连续时退回字符子序列；返回高亮区间
{
  const hit = mod.fuzzyMatch('复刻 dsh 会话标签插件', '标签')
  assert.deepEqual(hit.positions, [9, 10], '连续子串返回命中位置')
  assert.ok(hit.score > 900, '子串得分高于子序列')
  const seq = mod.fuzzyMatch('复刻 dsh 会话标签插件', '复插')
  assert.deepEqual(seq.positions, [0, 11], '不连续时按字符子序列命中')
  assert.ok(seq.score < hit.score, '子序列得分更低')
  assert.equal(mod.fuzzyMatch('会话标签', 'zzz'), null, '完全不匹配返回 null')
  assert.deepEqual(mod.fuzzyMatch('abc', '  ').positions, [], '空查询不过滤')
  assert.deepEqual(mod.fuzzyMatch('ABC', 'bc').positions, [1, 2], '大小写不敏感')
  assert.deepEqual(mod.filterSwitcher([{ title: '会话标签' }, { title: '其他' }], '标签').map((x) => x.row.title), ['会话标签'])
  const wsHit = mod.filterSwitcher([{ title: '会话 A', workspace: 'htdot-project' }, { title: '会话 B', workspace: 'other' }], 'htdot')
  assert.equal(wsHit.length, 1, '工作区名也参与匹配')
  assert.deepEqual(wsHit[0].positions, [], '仅工作区命中时标题没有高亮')
  assert.deepEqual(wsHit[0].wsPositions, [0, 1, 2, 3, 4], '返回工作区高亮位置')
  const bothHit = mod.filterSwitcher([{ title: 'htdot 标题', workspace: 'htdot-project' }], 'htdot')[0]
  assert.deepEqual(bothHit.positions, [0, 1, 2, 3, 4], '标题命中高亮标题')
  assert.deepEqual(bothHit.wsPositions, [0, 1, 2, 3, 4], '工作区同时命中时也高亮')
}

console.log('fuzzy match tests: ok')

// 21. switcherRows: 已打开按标签顺序；最近按 updatedAt 倒序；排除 blank/subagent/归档/重复
{
  storage.value = JSON.stringify({ version: 1, enabled: true, ids: ['a', 'b'], active: 'a' })
  const rows = {
    a: { sessionId: 'a', title: '会话标签插件', cwd: '/tmp/htdot-project', retainedBy: { mainView: 1 }, updatedAt: 50 },
    b: { sessionId: 'b', title: '工具图标', cwd: '/tmp/open-design', updatedAt: 60 },
    c: { sessionId: 'c', title: '最近标签', cwd: '/tmp/htdot-project', updatedAt: 300 },
    d: { sessionId: 'd', title: '旧会话', cwd: '/tmp/other', updatedAt: 100 },
    e: { sessionId: 'e', title: '空标签', blank: true, updatedAt: 999 },
    f: { sessionId: 'f', title: '子智能体', origin: 'subagent', updatedAt: 999 },
    g: { sessionId: 'g', title: '归档会话', updatedAt: 999 },
  }
  const { ctx } = makeCtx({
    list: { phase: 'ready', ids: Object.keys(rows), byId: rows },
    status: new Map([['a', { running: true }], ['b', { pendingInteraction: { kind: 'approval' } }], ['c', { completionUnread: true }]]),
    workspaces: { items: [
      { workspaceId: 'w1', path: '/tmp/htdot-project', title: 'htdot-project', sessionIds: ['a', 'c'] },
      { workspaceId: 'w2', path: '/tmp/open-design', title: 'open-design', sessionIds: ['b'] },
      { workspaceId: 'w3', path: '/tmp/other', title: 'other', sessionIds: ['d'] },
    ], archivedSessionIds: ['g'] },
  })
  const ctrl = mod.createController(ctx, { storage, lang: () => 'zh' })
  const all = ctrl.switcherRows('')
  assert.deepEqual(all.running.map((r) => r.id), ['b', 'a', 'c'], '运行中组：审批 > 执行中 > 未读')
  assert.deepEqual(all.opened.map((r) => r.id), [], '运行中的会话从已打开组去重')
  assert.equal(all.running.find((r) => r.id === 'a').current, true, '当前会话标记')
  assert.deepEqual(all.recent.map((r) => r.id), ['d'], '运行中的未读会话也被移出最近使用')
  assert.equal(all.total, 4)
  assert.ok(!all.recent.some((r) => ['e', 'f', 'g'].includes(r.id)), 'blank/subagent/归档不进最近使用')

  const byTitle = ctrl.switcherRows('标签')
  assert.deepEqual(byTitle.running.map((r) => r.id), ['a', 'c'], '运行中组也参与标题过滤（含未读）')
  assert.deepEqual(byTitle.opened.map((r) => r.id), [], '已打开组已去重')
  assert.deepEqual(byTitle.recent.map((r) => r.id), [])
  assert.deepEqual(byTitle.running[0].positions, [2, 3], '返回标题高亮位置')
  assert.equal(byTitle.total, 2)

  const byWorkspace = ctrl.switcherRows('htdot')
  assert.deepEqual(byWorkspace.running.map((r) => r.id), ['a', 'c'], '工作区命中也进入运行中结果（含未读）')
  assert.deepEqual(byWorkspace.recent.map((r) => r.id), [])
  assert.deepEqual(byWorkspace.running[0].positions, [], '仅工作区命中时标题不高亮')
  assert.deepEqual(byWorkspace.running[0].wsPositions, [0, 1, 2, 3, 4], '工作区名返回高亮位置')
  assert.equal(byWorkspace.total, 2)

  const byOpenWorkspace = ctrl.switcherRows('open')
  assert.deepEqual(byOpenWorkspace.running.map((r) => r.id), ['b'], '工作区 open-design 命中运行中组')
  assert.equal(byOpenWorkspace.total, 1)

  const none = ctrl.switcherRows('不存在的标题')
  assert.equal(none.total, 0, '无匹配返回空结果')
}

console.log('switcher rows tests: ok')

// 22. dsh-remote IDE 切换按钮选择：IDE 开启时优先点「返回普通模式」，否则点会话头部的切换按钮
{
  const exit = { click() {} }
  const toggle = { click() {} }
  assert.equal(mod.ideToggleTarget({ querySelector: (sel) => sel === '[data-rw-ide-exit]' ? exit : toggle }), exit, 'IDE 开启时点退出按钮')
  assert.equal(mod.ideToggleTarget({ querySelector: (sel) => sel === '[data-rw-ide-exit]' ? null : toggle }), toggle, 'IDE 关闭时点切换按钮')
  assert.equal(mod.ideToggleTarget({ querySelector: () => null }), null, '没有按钮时返回 null')
  assert.equal(mod.ideToggleTarget(null), null, '没有 root 时返回 null')
}
console.log('ide toggle target tests: ok')

// 23. 权限模式循环：目录顺序、未知当前值回落到第一档、auto/custom 不参与
{
  const presets = ['read-only', 'workspace-write', 'danger-full-access']
  assert.equal(mod.nextPermissionPreset(presets, 'read-only'), 'workspace-write', '只读 -> 工作区')
  assert.equal(mod.nextPermissionPreset(presets, 'workspace-write'), 'danger-full-access', '工作区 -> 完全权限')
  assert.equal(mod.nextPermissionPreset(presets, 'danger-full-access'), 'read-only', '完全权限 -> 只读（循环）')
  assert.equal(mod.nextPermissionPreset(presets, 'custom'), 'read-only', 'custom 从第一档重新开始')
  assert.equal(mod.nextPermissionPreset(presets, null), 'read-only', '没有当前值时切到第一档')
  assert.equal(mod.nextPermissionPreset([], 'read-only'), null, '空目录不切换')
  assert.equal(mod.nextPermissionPreset(['auto', 'custom', 'read-only', 'read-only'], null), 'read-only', '过滤 auto/custom 并去重')

  const catalog = { options: [
    { value: 'read-only' }, { value: 'workspace-write' }, { value: 'auto' }, { value: 'danger-full-access' },
  ] }
  assert.deepEqual(mod.permissionPresetValues(catalog), ['read-only', 'workspace-write', 'danger-full-access'], '目录值过滤 auto')

  const local = { code: 'Tab', modifiers: ['shift'] }
  assert.equal(mod.permissionBindingFor(null, local), local, '目录不可用时使用插件默认 ⇧Tab')
  assert.equal(mod.permissionBindingFor({ binding: null, modified: false }, local), local, '用户未改键时使用插件默认 ⇧Tab')
  assert.equal(mod.permissionBindingFor({ binding: null, modified: true }, local), null, '用户显式解绑后不再用默认键')
  const assigned = { code: 'KeyP', modifiers: ['primary'] }
  assert.equal(mod.permissionBindingFor({ binding: assigned, modified: true }, local), assigned, '用户改键后以宿主绑定为准')
  assert.equal(mod.bindingMatches({ code: 'Tab', shiftKey: true, altKey: false, metaKey: false, ctrlKey: false }, local, true), true, '⇧Tab 命中')
  assert.equal(mod.bindingMatches({ code: 'Tab', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false }, local, true), false, '单按 Tab 不命中')
}
console.log('permission cycle tests: ok')

// 24. 关闭墓碑与跨实例合并：旧快照不能复活已关闭标签
{
  const legacy = mod.parse(JSON.stringify({ version: 1, ids: ['a', 'b'], active: 'a', read: ['b'] }))
  assert.deepEqual(legacy.ids, ['a', 'b'], '旧格式（无 at/closed）仍可读')
  assert.deepEqual(legacy.at, {})
  assert.deepEqual(legacy.closed, {})

  const closed = mod.parse(JSON.stringify({ version: 1, ids: ['a', 'b'], closed: { b: 100 } }))
  assert.deepEqual(closed.ids, ['a'], '有墓碑的 id 读取时剔除')

  // stale 是关闭发生前的快照：b 的加入时间 2 < 关闭时间 3，不能复活
  const stale = mod.parse(JSON.stringify({ version: 1, ids: ['a', 'b'], at: { a: 1, b: 2 } }))
  const afterClose = mod.parse(JSON.stringify({ version: 1, ids: ['a'], at: { a: 1 }, closed: { b: 3 } }))
  assert.deepEqual(mod.mergeStates(stale, afterClose).ids, ['a'])
  assert.deepEqual(mod.mergeStates(afterClose, stale).ids, ['a'], '合并顺序无关')

  // 用户重新打开：加入时间 4 > 关闭时间 3，恢复
  const reopened = mod.parse(JSON.stringify({ version: 1, ids: ['a', 'b'], at: { a: 1, b: 4 }, closed: {} }))
  assert.deepEqual(mod.mergeStates(afterClose, reopened).ids, ['a', 'b'])

  // 两个实例各开一个标签：并集；read 也合并
  const left = mod.parse(JSON.stringify({ version: 1, ids: ['x'], at: { x: 5 }, read: ['r1'] }))
  const right = mod.parse(JSON.stringify({ version: 1, ids: ['y'], at: { y: 6 }, read: ['r2'] }))
  assert.deepEqual(mod.mergeStates(left, right).ids, ['x', 'y'])
  assert.deepEqual(mod.mergeStates(left, right).read, ['r1', 'r2'])

  // 墓碑比加入时间更旧时，id 应保留
  const recovered = mod.parse(JSON.stringify({ version: 1, ids: ['z'], at: { z: 10 }, closed: { z: 9 } }))
  assert.deepEqual(recovered.ids, ['z'])
}
console.log('storage merge tests: ok')

// 25. close 立即落盘 + 墓碑；旧实例保存/收到 storage 事件都不会写回已关闭标签
{
  const raw = JSON.stringify({ version: 1, enabled: true, ids: ['s1', 's2'], active: 's1', read: [] })
  storage.value = raw
  const list = { phase: 'ready', ids: ['s1', 's2'], byId: { s1: { sessionId: 's1' }, s2: { sessionId: 's2' } } }
  const a = mod.createController(makeCtx({ list }).ctx, { storage })
  const b = mod.createController(makeCtx({ list }).ctx, { storage })
  assert.equal(a.close('s2'), true)
  const afterClose = JSON.parse(storage.value)
  assert.deepEqual(afterClose.ids, ['s1'], 'close 立即落盘（不等 60ms 防抖）')
  assert.ok(afterClose.closed.s2 > 0, 'close 写入关闭墓碑')
  assert.deepEqual(a.snapshot().ids, ['s1'])

  b.flush()
  assert.deepEqual(JSON.parse(storage.value).ids, ['s1'], '旧实例保存时会合并墓碑，不写回已关闭标签')
  assert.deepEqual(b.snapshot().ids, ['s1'], '合并结果同步到旧实例内存')

  const c = mod.createController(makeCtx({ list }).ctx, { storage })
  assert.deepEqual(c.snapshot().ids, ['s1'], '重启后加载也不会恢复已关闭标签')
  assert.ok(JSON.parse(storage.getItem('dsh-quick-action.closed.v1')).s2 > 0, '关闭墓碑另存独立键')
  storage.setItem('dsh-quick-action.tabs.v1', JSON.stringify({ version: 1, ids: ['s1', 's2'], active: 's1' }))
  c.mergeStorage(storage.getItem('dsh-quick-action.tabs.v1'))
  assert.deepEqual(c.snapshot().ids, ['s1'], '老版本整表写回触发的 storage 事件也不会复活')
  // 老版本只会覆盖主键、不会碰独立墓碑键：即使重启前主键被写回旧表，也能拦住
  storage.setItem('dsh-quick-action.tabs.v1', JSON.stringify({ version: 1, ids: ['s1', 's2'], active: 's1' }))
  const d = mod.createController(makeCtx({ list }).ctx, { storage })
  assert.deepEqual(d.snapshot().ids, ['s1'], '主键被旧版本覆盖后，独立墓碑键仍能拦住已关闭标签')

  assert.equal(a.open('s2'), true)
  a.flush()
  const reopened = JSON.parse(storage.value)
  assert.ok(reopened.ids.includes('s2'), '用户重新打开后可以恢复标签')
  assert.ok(!reopened.closed.s2 || reopened.closed.s2 < reopened.at.s2, '重新打开的时间严格晚于墓碑')
}
console.log('close persistence tests: ok')

// 26. 归档/离场标签被 ready 快照剔除时同样写墓碑，防止旧快照带回
{
  storage.value = JSON.stringify({ version: 1, ids: ['live', 'gone'], active: 'live' })
  const list = { phase: 'ready', ids: ['live'], byId: { live: { sessionId: 'live' } } }
  const workspaces = { items: [], archivedSessionIds: ['gone'] }
  const ctrl = mod.createController(makeCtx({ list, workspaces }).ctx, { storage })
  ctrl.flush()
  const saved = JSON.parse(storage.value)
  assert.deepEqual(saved.ids, ['live'])
  assert.ok(saved.closed.gone > 0, '被剔除的归档 id 写入墓碑')
}
console.log('archive tombstone tests: ok')

// 27. 活动标签滚动增量：左右越界/已可见/留边距
{
  const box = { left: 100, right: 400 }
  assert.equal(mod.scrollAdjust({ left: 50, right: 150 }, box, 0), -50, '左侧越界向左滚')
  assert.equal(mod.scrollAdjust({ left: 350, right: 450 }, box, 0), 50, '右侧越界向右滚')
  assert.equal(mod.scrollAdjust({ left: 200, right: 300 }, box, 0), 0, '已可见不滚')
  assert.equal(mod.scrollAdjust({ left: 104, right: 200 }, box, 8), -4, '保留 8px 边距')
  assert.equal(mod.scrollAdjust(null, box, 8), 0, '缺少 rect 时不动')
}
console.log('reveal scroll tests: ok')
