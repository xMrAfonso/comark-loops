import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown } from 'comark'
import binding from 'comark/plugins/binding'
import { renderHtml } from '@comark/html'
import { Binding, If } from '@comark/html/plugins/binding'
import { loops } from '../dist/index.js'

test('Comark parses and renders loops, variables, conditions, and empty slots', async () => {
  const markdown = `::for{:each="data.rows" item="row" key="id"}
:::if{:value="props.row.visible"}
### {{ props.row.title }}
:::
#empty
Nothing here.
::`
  const data = { rows: [
    { id: 'a', visible: true, title: 'Alpha' },
    { id: 'b', visible: false, title: 'Hidden' },
  ] }
  const tree = await parseMarkdown(markdown, { plugins: [binding(), loops({ data })] })
  assert.equal(JSON.stringify(tree.nodes).includes('"for"'), false)
  const html = await renderHtml(tree, { components: { Binding, If }, data })
  assert.match(html, /Alpha/)
  assert.doesNotMatch(html, /Hidden/)
  const emptyTree = await parseMarkdown(markdown, { plugins: [binding(), loops({ data: { rows: [] } })] })
  const emptyHtml = await renderHtml(emptyTree, { components: { Binding, If }, data: { rows: [] } })
  assert.match(emptyHtml, /Nothing here/)
})
