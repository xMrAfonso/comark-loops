import { expandDocument } from './expand.js'

/**
 * Framework-independent expansion of Comark's parsed AST.
 * Operates at parse time and produces standard renderer nodes.
 */
export type LoopNode = string | [string | null, Record<string, unknown>, ...LoopNode[]]
export interface LoopDocument {
  nodes: LoopNode[]
  frontmatter: Record<string, unknown>
  meta: Record<string, unknown>
}
export interface LoopsOptions {
  /** Renderer data. Pass the same object to the renderer. */
  data?: Record<string, unknown>
  /** Root props available for collections and bindings. */
  props?: Record<string, unknown>
  /** Maximum total loop iterations per document (default: 1000). */
  maxIterations?: number
  /** Maximum nested loop depth (default: 12). */
  maxDepth?: number
  /** Maximum expanded AST nodes (default: 20000). */
  maxNodes?: number
}
/** Expand `::for` nodes from an already parsed Comark document without mutating it. */
export function expandLoops<T extends LoopDocument>(document: T, options: LoopsOptions = {}): T {
  return expandDocument(document, options)
}
