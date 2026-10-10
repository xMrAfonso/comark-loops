import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown } from 'comark'
import binding from 'comark/plugins/binding'
import { renderHtml } from '@comark/html'
import { Binding } from '@comark/html/plugins/binding'
import { loops } from '../dist/index.js'

test('Comark parses and renders loops, variables, and empty slots', async () => {
  const markdown = `::for{:each="data.rows" item="row" key="id"}
### {{ props.row.title }}
#empty
Nothing here.
::`
  const data = { rows: [
    { id: 'a', visible: true, title: 'Alpha' },
    { id: 'b', visible: true, title: 'Beta' },
  ] }
  const tree = await parseMarkdown(markdown, { plugins: [binding(), loops({ data })] })
  assert.equal(JSON.stringify(tree.nodes).includes('"for"'), false)
  const html = await renderHtml(markdown, { plugins: [binding(), loops({ data })], components: { Binding }, data })
  assert.match(html, /Alpha/)
  assert.match(html, /Beta/)
  const emptyTree = await parseMarkdown(markdown, { plugins: [binding(), loops({ data: { rows: [] } })] })
  const emptyHtml = await renderHtml(markdown, { plugins: [binding(), loops({ data: { rows: [] } })], components: { Binding }, data: { rows: [] } })
  assert.match(emptyHtml, /Nothing here/)
})
