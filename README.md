# comark-loops

Standalone `::for` loops for [Comark](https://comark.dev), without Knap or a fork of the Comark renderer.

**Status:** early preview (`0.1.0`). Compatible with Comark `0.7.x`. This package is **not** the cancelled upstream [PR #415](https://github.com/comarkdown/comark/pull/415): it offers a deliberately different, parse-time AST expansion strategy to avoid depending on private renderer hooks.

## Syntax

```md
::for{:each="data.characters" item="character" index="i" key="id"}
:::if{:value="props.character.visible"}
### {{ props.character.name }}
Health: {{ props.character.health }} (index {{ props.i }})
:::
#empty
No characters available.
::
```

- `:each` is a path rooted at `data`, `frontmatter`, `meta`, or `props`, or a literal array.
- `item` defaults to `"item"`; `index` is an optional zero-based alias.
- `key` is an optional item property path; unique string/number values are validated.
- `#empty` renders when the collection is empty or absent.
- Nested `::for`, `::if` (when separately registered in the chosen renderer), component attribute bindings (`:value="props.item.foo"`), and inline `{{ props.item.foo }}` work. Import and register Comark's `binding()` plugin and matching `Binding` renderer for inline interpolation.
- Supports regular Markdown and components in loop bodies.

## Install

Install from this repository or (once published to npm) use:

```sh
bun add comark-loops
```

### Parser + HTML renderer

```ts
import { parseMarkdown } from 'comark'
import binding from 'comark/plugins/binding'
import { renderHtml } from '@comark/html'
import { Binding } from '@comark/html/plugins/binding'
import { loops } from 'comark-loops'

const data = {
  characters: [{ id: '1', name: 'Ada', health: 80, visible: true }],
}
const source = `::for{:each="data.characters" item="character" key="id"}
## {{ props.character.name }}
::`

const document = await parseMarkdown(source, {
  plugins: [binding(), loops({ data })],
})
const html = await renderHtml(document, {
  components: { Binding },
  data,
})
```

`loops()` modifies the **parsed AST only**. It does not rewrite your saved Markdown. Pass the same snapshot to both parser and renderer.

### Vue / Nuxt

```vue
<script setup lang="ts">
import { LoopsMarkdown } from 'comark-loops/vue'
const data = ref({ characters: [{ id: '1', name: 'Ada' }] })
const source = '::for{:each="data.characters" item="character"}\n{{ props.character.name }}\n::'
</script>

<template>
  <Suspense>
    <LoopsMarkdown :value="source" :data="data" />
  </Suspense>
</template>
```

`LoopsMarkdown` automatically registers Comark's `binding` and `Binding` (the published `@comark/vue@0.7.0` does not export `If`; provide a compatible `If` via `components` if needed); pass additional parser `plugins` and renderer `components` as needed. It reparses on changes to source or data (including deep changes), supports server-side rendering via async setup, and avoids patching any internal Comark renderer API.

## API and limits

```ts
loops({
  data: { rows: [...] },
  maxIterations: 1000, // total, not per loop
  maxDepth: 12,        // nested loops
  maxNodes: 20000,     // expanded AST nodes
})
```

You may call `expandLoops(parsedDocument, { data })` directly. The transformer returns a new document, without changing the original. Data is resolved by own-property dot paths; it does not execute JavaScript expressions or getters. Duplicate or invalid keys, excessive expansion, and invalid non-array collections throw. Unsafe URL schemes in loop-bound attributes are suppressed.

## Trade-offs versus the upstream PR

The original PR implemented **render-time structural hooks** across multiple Comark renderers. For that to ship as an independent package, Comark itself would need to expose and maintain those hooks. Without upstream changes, a tiny `For` Vue component cannot override already-resolved Comark child bindings.

This project instead expands the AST in Comark's public `post()` plugin hook. That means:

- ✅ No Knap and no custom fork/patch of Comark
- ✅ Works across existing Comark renderers when expanded before rendering
- ✅ Preserves source Markdown and supports SSR and nested bindings
- ⚠️ Vue data changes require reparsing; use `LoopsMarkdown` to automate this
- ⚠️ Expanded list items are not keyed Vue fragments, so **child component state is not preserved across data updates**, even when `key` is supplied (keys are validated for correctness only)
- ⚠️ Treat this as a **render-oriented** plugin: don't include `loops()` in the editor's source-preservation parsing pipeline if that pipeline serializes the expanded AST back to Markdown
- ⚠️ Parsing costs scale with expanded output; use the built-in bounds for user-generated wiki pages
- ⚠️ Comark's source highlighter / editor completions need separate `::for` registration, just like other custom components

If a future Comark release exposes a public structural render hook, it would be preferable to migrate the Vue implementation to that approach.

## Development

```sh
bun install
bun run check
```

All source uses TypeScript and Comark's public plugin API. CI runs type-checking, build, and both unit and Comark integration tests.

## License

MIT. Inspired by [Comark PR #415](https://github.com/comarkdown/comark/pull/415) and its documented behavior, but implemented independently.
