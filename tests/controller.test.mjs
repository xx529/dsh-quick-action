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
