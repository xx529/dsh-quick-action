// dsh-quick-action — host half.
//
// Intentionally inert. Every behaviour of this plugin lives in the browser
// half, lib/client.js, because the DSH client-modules scanner only publishes a
// browser bundle for packages that are enabled Loader entries.
//
// State lives in the browser's localStorage, the same approach the native
// session/tab state uses.

const name = 'quick-action'
const inject = []

/**
 * Report that the host half is composed; the browser half does the work.
 * @param ctx Host plugin context.
 */
function apply(ctx) {
  ctx.logger.info('dsh-quick-action: host half is inert; lib/client.js provides the UI')
}

export { apply, inject, name }
