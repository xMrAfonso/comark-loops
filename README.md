# comark-loops

A [Comark](https://comark.dev) plugin for repeating Markdown and components with `::for`.

```md
::for{:each="data.people" item="person"}
## {{ loop.person.name }}

#empty
No people yet.
::
```

Loops expand into standard Comark AST nodes before rendering. Use your existing renderer for Vue, React, Svelte, Angular, HTML, or Nuxt; no loop component is required.

## Install

```sh
pnpm add comark-loops
```

Requires Comark `0.7.x` as a peer dependency and Node.js 20.19 or later. This package is an early preview (`0.1.0`) and exports ES modules.

## Usage

```ts
import { parseMarkdown } from 'comark'
import binding from 'comark/plugins/binding'
import loops from 'comark-loops'

const data = {
  people: [
    { name: 'Ada' },
    { name: 'Grace' },
  ],
}

const source = `::for{:each="data.people" item="person"}
## {{ loop.person.name }}
::`

const document = await parseMarkdown(source, {
  plugins: [binding(), loops({ data })],
})
```

Pass `document` to your Comark document renderer. Register the renderer's `Binding` component for `{{ }}` expressions, and pass the same `data` object for any remaining runtime bindings.

For example, to render HTML directly:

```ts
import { renderHtml } from '@comark/html'
import { Binding } from '@comark/html/plugins/binding'

const html = await renderHtml(source, {
  plugins: [binding(), loops({ data })],
  components: { Binding },
  data,
})
```

`renderHtml()` accepts the original Markdown string and parses it itself.

`loops()` belongs in `plugins`: it expands the loop directives before rendering. `Binding` and your custom components belong in `components`: their nodes are handled by the renderer.

## Syntax

| Attribute | Default | Description |
| --- | --- | --- |
| `:each` | Missing collection | A collection path or literal JSON array. |
| `item` | `item` | Current item alias, available as `loop.<alias>`. |
| `index` | None | Optional zero-based index alias, also under `loop`. |
| `key` | None | Optional item ID validation. See [Optional key validation](#optional-key-validation). |

```md
::for{:each="data.people" item="person" index="i"}
- {{ loop.i }}: {{ loop.person.name }}
::
```

Collection paths can use `data`, `frontmatter`, `meta`, `props`, and `loop`:

| Root | Reads from |
| --- | --- |
| `data` | The plugin's `data` option. |
| `frontmatter` | The parsed document's frontmatter. |
| `meta` | The parsed document's metadata. |
| `props` | Enclosing components' authored props or the plugin's root `props` option. |
| `loop` | Current and outer loop item/index aliases. |

Dot paths support array indexes and hyphenated property names, such as `data.groups.0.members` and `loop.person.display-name`. Compute filtered or derived collections in your application; expressions, function calls, and bracket notation are not supported.

### Migrating loop aliases from `props`

**Breaking change:** loop aliases are now available only under `loop.*`. Change `{{ props.person.name }}` to `{{ loop.person.name }}`, and loop-dependent attributes such as `:person="props.person"` to `:person="loop.person"`. Nested collection paths follow the same rule: `props.team.members` becomes `loop.team.members` when `team` is a loop alias.

Keep actual component and root prop references under `props.*`. The plugin no longer lets loop aliases shadow those props. Missing or out-of-scope `loop.*` values resolve to `undefined` during expansion.

### Empty collections

An empty array, `null`, or `undefined` renders `#empty`. Without an empty slot, the loop renders nothing. Any other collection type throws.

```md
::for{:each="data.people" item="person"}
- {{ loop.person.name }}

#empty
Add your first member.
::
```

### Nested loops

Add colons for nested Comark blocks. Outer aliases remain available inside inner loops; reusing an alias shadows it within the inner loop.

```md
::for{:each="data.teams" item="team"}
## {{ loop.team.name }}

:::for{:each="loop.team.members" item="member" index="i"}
- {{ loop.member.name }} / {{ loop.team.name }} / {{ loop.i }}

#empty
This team has no members.
:::
::
```

### Frontmatter and literal arrays

```md
---
tags:
  - comark
  - markdown
---

::for{:each="frontmatter.tags" item="tag"}
- {{ loop.tag }}
::
```

Without an explicit item alias, use `loop.item`:

```md
::for{:each='["One", "Two", "Three"]'}
- {{ loop.item }}
::
```

## Components and slots

Custom components can appear inside loops, receive item bindings, and render default and named slots:

```md
::for{:each="data.people" item="person"}
:::person-card{:person="loop.person" :active="loop.person.active"}
**{{ loop.person.name }}**

#footer
{{ data.organization }} · {{ frontmatter.title }}
:::
::
```

Register a component for `person-card`, along with `Binding`, through your renderer's `components` map. Objects, booleans, and numbers passed through loop bindings retain their types.

Aliases stay available through `loop.*` throughout the loop body, including component slots. Existing `data`, `frontmatter`, `meta`, and component-prop bindings keep their normal Comark behavior. For example, `loop.person` is the iteration's item, while `props.person` is the enclosing component's prop, even when both are named `person`.

A nested loop can read an enclosing component's authored props. For example, a component with `:members="data.people"` can contain a loop over `props.members`. Values produced by a component at runtime, component defaults, and scoped-slot values are unavailable during expansion.

Conditional components such as `::if` work inside loops when registered with your renderer; this plugin does not provide them.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `Record<string, unknown>` | `{}` | Data used for collections and loop bindings. |
| `props` | `Record<string, unknown>` | `{}` | Root props used for collections and bindings. |
| `maxIterations` | `number` | `1000` | Total iterations across all loops in the document. |
| `maxDepth` | `number` | `12` | Maximum nested loop depth. |
| `maxNodes` | `number` | `20000` | Maximum output AST node count, including text nodes. |

```ts
loops({
  data: { people: [{ name: 'Ada' }] },
  props: { title: 'Roster' },
  maxIterations: 1000,
  maxDepth: 12,
  maxNodes: 20000,
})
```

### Default limits

Each document expansion starts with these budgets:

- **`maxIterations: 1000`** — total iterations across all loops, including nested loops. Two loops with 600 items each exceed the default; the budget is not per loop.
- **`maxDepth: 12`** — up to 12 nested `::for` levels. Ordinary Markdown and component nesting do not consume this depth limit.
- **`maxNodes: 20000`** — up to 20,000 output AST nodes, including text, ordinary content outside loops, comments, and raw HTML descendants.

Override any limit through `loops({ ... })` or `expandLoops(document, { ... })`. Limits must be positive safe integers; `0` does not disable them. Invalid collections, aliases, keys, or limits, and expansion beyond a limit, throw rather than truncate the output.

Item and index aliases must match `[A-Za-z_$][A-Za-z0-9_$]*` and must differ. Path lookup reads own data properties without executing getters or traversing prototypes; `__proto__`, `prototype`, and `constructor` are not accessible through paths or valid as aliases.

## How it works

`loops()` uses Comark's public `post` hook, after the AST is built. It repeats the loop body, resolves bindings that depend on loop aliases or supplied root props, and replaces the `for` nodes with their expanded children. It leaves the original Markdown string unchanged.

`loop.*` bindings are resolved during expansion, so renderers do not need support for a new namespace.

Inline expressions still use Comark's `binding()` plugin and the renderer's `Binding` component. Non-loop bindings remain available for the renderer to resolve.

Plugins that supply collections or metadata should run **before** `loops()`. Plugins that inspect or sanitize expanded output should run **after** it:

```ts
import security from 'comark/plugins/security'

const plugins = [binding(), loops({ data }), security()]
```

### Reactivity

Expansion happens when you parse; the plugin does not subscribe to data changes. When loop inputs change, update the expanded document and pass it to your renderer. Your framework's watcher, effect, store, or signal can automate that step.

You can reparse with `parseMarkdown()`, or keep an **unexpanded** document and rerun `expandLoops()` without parsing unchanged Markdown:

```ts
import { expandLoops } from 'comark-loops/core'

// Retain the ::for nodes; do not register loops() for this parse.
const template = await parseMarkdown(source, {
  plugins: [binding()],
})

let document = expandLoops(template, { data })

data.people.push({ name: 'Lin' })
document = expandLoops(template, { data })
// Pass the new document to your renderer.
```

Always expand from the unexpanded template. Reparse it when the Markdown changes, including edits to frontmatter. Plugins that need to process expanded output must also run again after each expansion.

`expandLoops(document, options?)` returns a new document without mutating the input AST. It preserves additional document fields and shares data objects and metadata rather than deep-cloning them. It is exported from both `comark-loops` and `comark-loops/core`; `loops` is available as a default or named export.

Ordinary runtime bindings can still update according to your renderer's behavior. They do not require another loop expansion unless the loop's collection or materialized values also change.

## Optional key validation

**You do not need `key` to render a loop.** Add it when you want expansion to fail if records have missing or duplicate IDs. For example, a roster imported from an API might be expected to contain each person once; `key` can catch an accidentally duplicated record before rendering it.

Given this data:

```ts
const data = {
  people: [
    { id: 'ada', name: 'Ada' },
    { id: 'grace', name: 'Grace' },
  ],
}
```

```md
::for{:each="data.people" item="person" key="id"}
{{ loop.person.name }}
::
```

`key="id"` tells the plugin which field to check: it reads `person.id` for each item. During expansion, the plugin:

1. Reads the specified property path from each item.
2. Checks that its value is a string or finite number.
3. Throws if that value has already appeared in the same loop invocation.

Here, the checked values are `"ada"` and `"grace"`. Changing Grace's ID to `"ada"` throws `Duplicate ::for key: ada`. Removing an ID throws `Missing or invalid ::for key: id`. Nested paths such as `key="profile.id"` work too, and uniqueness is checked separately for each loop invocation.

**This is data validation only.** It does not generate IDs, remove duplicates, sort items, or change the displayed content. The plugin emits a flat AST and does not pass keyed iteration groups to the renderer, so it does not preserve child component state when items reorder. Component identity remains controlled by the renderer.

Without `key`, the loop expands every item without checking its ID. Omit it unless this validation is useful for your data.

## Caveats

- Keep the original Markdown or unexpanded AST for editing. Serializing expanded output back to Markdown loses the authored loop directives.
- Raw HTML is preserved literally; loop syntax inside fenced code blocks is not expanded.
- Unsafe URL schemes in attributes resolved from loop aliases or root props are suppressed. Apply your renderer's content policy for general Markdown and HTML sanitization.
- Editor completions and syntax highlighting for `::for` need separate registration.

## Development

```sh
pnpm install
pnpm run check
pnpm run test:coverage
pnpm run build
```

Tests cover scoped bindings, nested loops, components and slots, limits, immutable expansion, repeated expansion, HTML rendering, and package exports. The plugin has no framework runtime dependencies.

## License

[MIT](./LICENSE).
