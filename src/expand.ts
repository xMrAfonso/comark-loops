import type { LoopDocument, LoopNode, LoopsOptions } from './core.js'

type Dict = Record<string, unknown>
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])
const IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
// Comark bindings use dot-separated property names, including array indexes.
const PATH = /^(data|frontmatter|meta|props|loop)(?:\.[^\s.]+)+$/
const URL_KEYS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])
const DANGEROUS_PROPS = new Set(['innerhtml', 'dangerouslysetinnerhtml', 'textcontent'])

type Context = {
  root: Record<'data'|'frontmatter'|'meta'|'props', Dict>
  suppliedProps?: Dict
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
function isRawHtml(attrs: Dict): boolean {
  return isRecord(attrs.$) && attrs.$.html === 1
}
function readOwn(value: unknown, key: string): unknown {
  if (FORBIDDEN.has(key) || (typeof value !== 'object' || value === null)) return undefined
  // Validate own data properties before reading, excluding getters/prototypes.
  // Read through the object so nested reactive values retain their proxies.
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? Reflect.get(value, key) : undefined
}
function resolvePath(path: string, ctx: Context): { matched: boolean; value: unknown } {
  if (!PATH.test(path)) return { matched: false, value: undefined }
  const [namespace, first, ...rest] = path.split('.')
  // Resolve lexical aliases separately from the renderer's component props.
  // Missing aliases also become undefined, so loop paths never reach a renderer.
  if (namespace === 'loop') {
    let value: unknown = readOwn(ctx.aliases, first)
    for (const part of rest) value = readOwn(value, part)
    return { matched: true, value }
  }
  let value: unknown = ctx.root[namespace as keyof Context['root']]
  for (const part of [first, ...rest]) value = readOwn(value, part)
  // Renderers have no root props input. Materialize explicitly supplied props,
  // while keeping enclosing component bindings under the renderer's control.
  return { matched: namespace === 'props' && ctx.root.props === ctx.suppliedProps, value }
}
function collection(value: unknown, ctx: Context): unknown {
  if (typeof value !== 'string') return value
  const source = value.trim()
  if (source.startsWith('[')) {
    try { return JSON.parse(source) } catch { /* invalid collection handled below */ }
  }
  if (!PATH.test(source)) throw new Error(`Invalid ::for each path: ${source}`)
  return resolvePath(source, ctx).value
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
    if (Array.isArray(child) && child[0] === 'template' && !isRawHtml(child[1])) {
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
function trackPreserved(nodes: LoopNode[], ctx: Context): void {
  const pending = [nodes]
  while (pending.length > 0) {
    for (const node of pending.pop()!) {
      track(ctx)
      if (Array.isArray(node)) pending.push(node.slice(2) as LoopNode[])
    }
  }
}
function appendNodes(output: { push(node: LoopNode): unknown }, nodes: LoopNode[]): void {
  // Spreading an expanded list into push() hits JS argument limits when users
  // raise maxNodes, even though the expansion is within the configured bound.
  for (const node of nodes) output.push(node)
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
function childProps(attrs: Dict, ctx: Context): Dict | undefined {
  const props: Dict = Object.create(null) as Dict
  for (const [key, value] of Object.entries(attrs)) {
    if (key === '$') continue
    const name = key.startsWith(':') ? key.slice(1) : key
    let resolved = value
    if (key.startsWith(':') && typeof value === 'string') {
      // Mirror Comark's JSON literals and dot paths for collection lookup only.
      // Keep the authored attributes intact for the actual renderer, and use
      // own-property reads so deriving a scope never invokes getters.
      try { resolved = JSON.parse(value) }
      catch { resolved = resolvePath(value, ctx).value }
    }
    props[name === 'className' ? 'class' : name] = resolved
  }
  return Object.keys(props).length > 0 ? props : undefined
}
function keyParts(path: unknown): string[] | undefined {
  if (path === undefined) return undefined
  if (typeof path !== 'string') throw new Error('::for key must be a path string')
  const parts = path.split('.')
  if (parts.some(part => !part || /\s/.test(part) || FORBIDDEN.has(part))) {
    throw new Error(`Invalid ::for key path: ${path}`)
  }
  return parts
}
function getKey(item: unknown, parts: string[]): string | number {
  let value: unknown = item
  for (const part of parts) value = readOwn(value, part)
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`Missing or invalid ::for key: ${parts.join('.')}`)
}
function expandNodes(nodes: LoopNode[], ctx: Context, depth: number, parentTag?: string | null): LoopNode[] {
  const output: LoopNode[] = []
  type Scope = { aliases: Dict; props: Dict; depth: number; parentTag?: string | null }
  type Sequence = Scope & {
    kind: 'nodes'; nodes: LoopNode[]; output: LoopNode[]; index: number; finish?: () => void
  }
  type Iterations = Scope & {
    kind: 'iterations'; items: unknown[]; children: LoopNode[]; output: LoopNode[]; index: number
    itemName: string; indexName?: string; keyPath?: string[]; keys: Set<string | number>
  }
  const pending: (Sequence | Iterations)[] = [{
    kind: 'nodes', nodes, output, index: 0, aliases: ctx.aliases, props: ctx.root.props, depth, parentTag,
  }]
  // Explicit frames keep ordinary AST depth independent of the JS call stack.
  // Each frame owns its lexical scope, so siblings cannot inherit child props.
  while (pending.length > 0) {
    const frame = pending[pending.length - 1]
    ctx.aliases = frame.aliases
    ctx.root.props = frame.props
    if (frame.kind === 'iterations') {
      if (frame.index === frame.items.length) {
        pending.pop()
        continue
      }
      const index = frame.index++
      const item = readOwn(frame.items, String(index))
      if (frame.keyPath) {
        const key = getKey(item, frame.keyPath)
        if (frame.keys.has(key)) throw new Error(`Duplicate ::for key: ${String(key)}`)
        frame.keys.add(key)
      }
      pending.push({
        kind: 'nodes', nodes: frame.children, output: frame.output, index: 0,
        aliases: { ...frame.aliases, [frame.itemName]: item, ...(frame.indexName ? { [frame.indexName]: index } : {}) },
        props: frame.props, depth: frame.depth, parentTag: frame.parentTag,
      })
      continue
    }
    if (frame.index === frame.nodes.length) {
      frame.finish?.()
      pending.pop()
      continue
    }
    const node = frame.nodes[frame.index++]
    const output = frame.output
    if (typeof node === 'string') { track(ctx); output.push(node); continue }
    const [tag, attrs, ...children] = node
    if (tag === 'for' && !isRawHtml(attrs)) {
      if (frame.depth >= ctx.limits.maxDepth) throw new Error(`::for nesting exceeded maxDepth (${ctx.limits.maxDepth})`)
      const itemName = alias(attrs.item, 'item', 'item')!
      const indexName = alias(attrs.index, 'index')
      if (indexName === itemName) throw new Error('::for item and index aliases must differ')
      const keyPath = keyParts(attrs.key)
      const raw = Object.hasOwn(attrs, ':each') ? attrs[':each'] : attrs.each
      const items = collection(raw, ctx)
      const selected = branches(children)
      if (items == null || (Array.isArray(items) && items.length === 0)) {
        pending.push({
          ...frame, nodes: selected.empty, index: 0, depth: frame.depth + 1,
          finish: undefined,
        })
        continue
      }
      if (!Array.isArray(items)) throw new TypeError('::for each must resolve to an array, null, or undefined')
      if (ctx.usedIterations + items.length > ctx.limits.maxIterations)
        throw new Error(`::for expansion exceeded maxIterations (${ctx.limits.maxIterations})`)
      ctx.usedIterations += items.length
      pending.push({
        kind: 'iterations', items, children: selected.main, output, index: 0,
        aliases: frame.aliases, props: frame.props, depth: frame.depth + 1, parentTag: frame.parentTag,
        itemName, indexName, keyPath, keys: new Set(),
      })
      continue
    }
    track(ctx)
    // Preserve comment content and authored raw HTML; don't interpret their subtree as directives.
    if (tag === null || isRawHtml(attrs)) {
      trackPreserved(children, ctx)
      output.push([tag, { ...attrs }, ...children])
      continue
    }
    const nextAttrs = rewriteAttrs(attrs, ctx)
    // Renderers consume named templates as slots, without introducing a props
    // scope for the template itself. Loop removal keeps that same parent.
    const isSlot = tag === 'template' && frame.parentTag !== undefined && slotName(nextAttrs) !== undefined
    const nextProps = isSlot ? frame.props : childProps(nextAttrs, ctx) ?? frame.props
    const element: Exclude<LoopNode, string> = [tag, nextAttrs]
    output.push(element)
    const expanded: LoopNode[] = []
    pending.push({
      kind: 'nodes', nodes: children, output: expanded, index: 0,
      aliases: frame.aliases, props: nextProps, depth: frame.depth, parentTag: tag,
      finish: () => { appendNodes(element, expanded) },
    })
  }
  return output
}
/** Expand `::for` nodes from an already parsed Comark document without mutating it. */
export function expandDocument<T extends LoopDocument>(document: T, options: LoopsOptions = {}): T {
  const limits = {
    maxIterations: checkLimit(options.maxIterations, 1000, 'maxIterations'),
    maxDepth: checkLimit(options.maxDepth, 12, 'maxDepth'),
    maxNodes: checkLimit(options.maxNodes, 20000, 'maxNodes'),
  }
  const ctx: Context = {
    suppliedProps: options.props,
    root: {
      data: options.data ?? {}, frontmatter: document.frontmatter ?? {},
      meta: document.meta ?? {}, props: options.props ?? {},
    },
    aliases: Object.create(null) as Dict, usedIterations: 0, usedNodes: 0, limits,
  }
  return { ...document, nodes: expandNodes(document.nodes, ctx, 0) }
}
