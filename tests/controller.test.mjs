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
  value: null,
  getItem() { return this.value },
  setItem(_k, v) { this.value = v },
}

// 1. parse / serialize round trip
const parsed = mod.parse(JSON.stringify({ version: 1, enabled: false, ids: ['a', 'a', 'b'], active: 'b' }))
assert.deepEqual(parsed.ids, ['a', 'b'])
assert.equal(parsed.enabled, false)
assert.equal(parsed.active, 'b')
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

// 12. crashState: 只有连续两次未正常退出才压制本次运行，正常退出会清零
{
  const first = mod.crashState('token', null)
  assert.deepEqual(first, { streak: 1, suppress: false }, '一次异常退出不关闭默认开启')
  const second = mod.crashState('token', '1')
  assert.deepEqual(second, { streak: 2, suppress: true }, '连续两次异常退出才压制本次运行')
  const clean = mod.crashState(null, '5')
  assert.deepEqual(clean, { streak: 0, suppress: false }, '正常退出清零，下次不再压制')
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
