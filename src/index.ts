import type { ComarkPlugin } from 'comark'
import { expandLoops } from './core.js'
import type { LoopsOptions } from './core.js'

export { expandLoops } from './core.js'
export type { LoopsOptions, LoopDocument, LoopNode } from './core.js'

/**
 * Comark parse-time plugin. Add `binding()` separately when using `{{ }}`.
 * For reactive Vue rendering use `LoopsMarkdown` from `comark-loops/vue`.
 */
export function loops(options: LoopsOptions = {}): ComarkPlugin {
  return {
    name: 'loops',
    post(state) {
      state.tree.nodes = expandLoops(state.tree, options).nodes as typeof state.tree.nodes
    },
  }
}
export default loops
