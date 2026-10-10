/**
 * Framework-independent expansion of Comark's parsed AST.
 *
 * Unlike render-time structural hooks, this operates at parse time. It deliberately
 * does not impersonate Comark's Vue / React renderer internals.
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
  /** Additional props available outside any loop. */
  props?: Record<string, unknown>
  /** Maximum total loop iterations per document (default: 1000). */
  maxIterations?: number
  /** Maximum nested loop depth (default: 12). */
  maxDepth?: number
  /** Maximum expanded AST nodes (default: 20000). */
  maxNodes?: number
}
type Dict = Record<string, unknown>
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])
const IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
const ROOTS = new Set(['data', 'frontmatter', 'meta', 'props'])
const PATH = /^(data|frontmatter|meta|props)(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/
const URL_KEYS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])
const DANGEROUS_PROPS = new Set(['innerhtml', 'dangerouslysetinnerhtml', 'textcontent'])

type Context = {
  root: Record<'data'|'frontmatter'|'meta'|'props', Dict>
  aliases: Dict
  usedIterations: number
  usedNodes: number
  limits: { maxIterations: number; maxDepth: number; maxNodes: number }
}
function checkLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
  return value
}
function isRecord(value: unknown): value is Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function readOwn(value: unknown, key: string): unknown {
  if (FORBIDDEN.has(key) || (typeof value !== 'object' || value === null)) return undefined
  // Own data properties only. Do not execute user-controlled getters.
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}
function resolvePath(path: string, ctx: Context): { matched: boolean; value: unknown } {
  if (!PATH.test(path)) return { matched: false, value: undefined }
  const [namespace, first, ...rest] = path.split('.')
  if (FORBIDDEN.has(first)) return { matched: false, value: undefined }
  // Loop aliases take precedence over enclosing component props (as in PR #415).
  if (namespace === 'props' && Object.hasOwn(ctx.aliases, first)) {
    let value: unknown = readOwn(ctx.aliases, first)
    for (const part of rest) value = readOwn(value, part)
    return { matched: true, value }
  }
  if (!ROOTS.has(namespace)) return { matched: false, value: undefined }
  let value: unknown = ctx.root[namespace as keyof Context['root']]
  for (const part of [first, ...rest]) value = readOwn(value, part)
  return { matched: false, value } // only inline aliases should be rewritten
}
function collection(value: unknown, ctx: Context): unknown {
  if (typeof value !== 'string') return value
  const source = value.trim()
  if (source.startsWith('[')) {
    try { return JSON.parse(source) } catch { /* invalid collection handled below */ }
  }
  if (!PATH.test(source)) throw new Error(`Invalid ::for each path: ${source}`)
  const [namespace, first, ...rest] = source.split('.')
  let output: unknown
  if (namespace === 'props' && Object.hasOwn(ctx.aliases, first)) {
    output = readOwn(ctx.aliases, first)
  } else {
    output = readOwn(ctx.root[namespace as keyof Context['root']], first)
  }
  for (const part of rest) output = readOwn(output, part)
  return output
}
function alias(value: unknown, name: string, fallback?: string): string | undefined {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || FORBIDDEN.has(value))
    throw new Error(`Invalid ::for ${name} alias: ${String(value)}`)
  return value
}
function slotName(attrs: Dict): string | undefined {
  if (typeof attrs.name === 'string') return attrs.name
  for (const key of Object.keys(attrs)) {
    if (key.startsWith('#')) return key.slice(1)
    if (key.startsWith('v-slot:')) return key.slice(7)
  }
  return undefined
}
function branches(children: LoopNode[]): { main: LoopNode[]; empty: LoopNode[] } {
  const ordinary: LoopNode[] = []
  let defaultSlot: LoopNode[] | undefined
  let emptySlot: LoopNode[] | undefined
  for (const child of children) {
    if (Array.isArray(child) && child[0] === 'template') {
      const name = slotName(child[1])
      if (name === 'default') { defaultSlot = child.slice(2) as LoopNode[]; continue }
      if (name === 'empty') { emptySlot = child.slice(2) as LoopNode[]; continue }
    }
    ordinary.push(child)
  }
  return { main: defaultSlot ?? ordinary, empty: emptySlot ?? [] }
}
function track(ctx: Context): void {
  if (++ctx.usedNodes > ctx.limits.maxNodes) {
    throw new Error(`::for expansion exceeded maxNodes (${ctx.limits.maxNodes})`)
  }
}
function safeUrl(value: string): boolean {
  // Browsers ignore ASCII controls inside URL schemes; normalize before checking.
  const normalized = value.replace(/[\u0000-\u0020\u007f]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1]?.toLowerCase()
  return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme)
}
function rewriteAttrs(attrs: Dict, ctx: Context): Dict {
  const out: Dict = Object.create(null) as Dict
  for (const [key, value] of Object.entries(attrs)) {
    if (key === '$') { out[key] = value; continue }
    const cleanKey = key.startsWith(':') ? key.slice(1) : key
    if (DANGEROUS_PROPS.has(cleanKey.toLowerCase())) continue
    if (key.startsWith(':') && typeof value === 'string') {
      const resolved = resolvePath(value.trim(), ctx)
      if (resolved.matched) {
        if (URL_KEYS.has(cleanKey.toLowerCase()) && (typeof resolved.value !== 'string' || !safeUrl(resolved.value))) continue
        out[cleanKey] = resolved.value
        continue
      }
    }
    out[key] = value
  }
  return out
}
function getKey(item: unknown, path: string): string | number {
  if (!path || path.split('.').some(part => !IDENTIFIER.test(part) || FORBIDDEN.has(part))) {
    throw new Error(`Invalid ::for key path: ${path}`)
  }
  let value: unknown = item
  for (const part of path.split('.')) value = readOwn(value, part)
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`Missing or invalid ::for key: ${path}`)
}
function expandNodes(nodes: LoopNode[], ctx: Context, depth: number): LoopNode[] {
  const output: LoopNode[] = []
  for (const node of nodes) {
    if (typeof node === 'string') { track(ctx); output.push(node); continue }
    const [tag, attrs, ...children] = node
    if (tag === 'for' && !(isRecord(attrs.$) && attrs.$.html === 1)) {
      if (depth >= ctx.limits.maxDepth) throw new Error(`::for nesting exceeded maxDepth (${ctx.limits.maxDepth})`)
      const raw = Object.hasOwn(attrs, ':each') ? attrs[':each'] : attrs.each
      const items = collection(raw, ctx)
      const selected = branches(children)
      if (items == null || (Array.isArray(items) && items.length === 0)) {
        output.push(...expandNodes(selected.empty, ctx, depth + 1))
        continue
      }
      if (!Array.isArray(items)) throw new TypeError('::for each must resolve to an array, null, or undefined')
      if (ctx.usedIterations + items.length > ctx.limits.maxIterations)
        throw new Error(`::for expansion exceeded maxIterations (${ctx.limits.maxIterations})`)
      ctx.usedIterations += items.length
      const itemName = alias(attrs.item, 'item', 'item')!
      const indexName = alias(attrs.index, 'index')
      if (indexName === itemName) throw new Error('::for item and index aliases must differ')
      const keyPath = attrs.key
      if (keyPath !== undefined && typeof keyPath !== 'string') throw new Error('::for key must be a path string')
      const keys = new Set<string | number>()
      for (let index = 0; index < items.length; index++) {
        if (typeof keyPath === 'string') {
          const key = getKey(items[index], keyPath)
          if (keys.has(key)) throw new Error(`Duplicate ::for key: ${String(key)}`)
          keys.add(key)
        }
        const previous = ctx.aliases
        ctx.aliases = { ...previous, [itemName]: items[index], ...(indexName ? { [indexName]: index } : {}) }
        try { output.push(...expandNodes(selected.main, ctx, depth + 1)) }
        finally { ctx.aliases = previous }
      }
      continue
    }
    track(ctx)
    // Preserve comment content and authored raw HTML; don't interpret their subtree as directives.
    const nextAttrs = rewriteAttrs(attrs, ctx)
    output.push([tag, nextAttrs, ...(tag === null || (isRecord(attrs.$) && attrs.$.html === 1)
      ? children
      : expandNodes(children, ctx, depth))])
  }
  return output
}
/** Expand `::for` nodes from an already parsed Comark document without mutating it. */
export function expandLoops<T extends LoopDocument>(document: T, options: LoopsOptions = {}): T {
  const limits = {
    maxIterations: checkLimit(options.maxIterations, 1000, 'maxIterations'),
    maxDepth: checkLimit(options.maxDepth, 12, 'maxDepth'),
    maxNodes: checkLimit(options.maxNodes, 20000, 'maxNodes'),
  }
  const ctx: Context = {
    root: {
      data: options.data ?? {}, frontmatter: document.frontmatter ?? {},
      meta: document.meta ?? {}, props: options.props ?? {},
    },
    aliases: Object.create(null) as Dict, usedIterations: 0, usedNodes: 0, limits,
  }
  return { ...document, nodes: expandNodes(document.nodes, ctx, 0) }
}
