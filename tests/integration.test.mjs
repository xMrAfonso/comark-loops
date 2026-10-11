import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown } from 'comark'
import binding from 'comark/plugins/binding'
import { renderHtml } from '@comark/html'
import { Binding } from '@comark/html/plugins/binding'
import { loops } from '../dist/index.js'

test('Comark parses and renders loops, variables, and empty slots', async () => {
  const markdown = `::for{:each="data.rows" item="row" key="id"}
### {{ loop.row.title }}
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
  const emptyHtml = await renderHtml(markdown, { plugins: [binding(), loops({ data: { rows: [] } })], components: { Binding }, data: { rows: [] } })
  assert.match(emptyHtml, /Nothing here/)
})

test('HTML rendering keeps component prop bindings and nested loop scopes compatible', async () => {
  const data = { rows: [{ name: 'Ada', members: ['Lin', 'Grace'] }] }
  const markdown = `::card{:rows="data.rows"}
:::for{:each="props.rows" item="row"}
::::panel{:entry="loop.row"}
{{ props.entry.name }}

:::::for{:each="props.entry.members" item="member"}
{{ loop.member }} / {{ loop.row.name }}
:::::
::::
:::
::`
  const html = await renderHtml(markdown, { plugins: [binding(), loops({ data })], components: { Binding }, data })
  assert.match(html, /<card /)
  assert.match(html, /<panel /)
  assert.match(html, /Lin \/ Ada/)
  assert.match(html, /Grace \/ Ada/)
  assert.doesNotMatch(html, /<for[ >]|props\./)
})

test('HTML bindings escape loop values and keep code fences literal', async () => {
  const markdown = '::for{:each="data.rows"}\n{{ loop.item }}\n::\n\n```md\n::for{:each="data.rows"}\n{{ loop.item }}\n::\n```'
  const data = { rows: ['<script>alert(1)</script> & "quoted"'] }
  const html = await renderHtml(markdown, { plugins: [binding(), loops({ data })], components: { Binding }, data })
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /{{ loop\.item }}/)
  assert.match(html, /::for/)
})

test('HTML renders colliding component props, loop aliases, indexes, and missing-value fallbacks separately', async () => {
  const markdown = `::for{:each="data.people" item="person" index="i"}
:::card{:person="data.componentPerson" :i="data.componentIndex"}
{{ loop.person.name }} / {{ props.person.name }} / {{ loop.i }} / {{ props.i }}

#footer
{{ loop.person.missing || Fallback }} / {{ props.person.name }}
:::
::

{{ loop.person.name || Outside }}`
  const data = { people: [{ name: 'Ada' }, { name: 'Grace' }], componentPerson: { name: 'Component' }, componentIndex: 99 }
  const Card = async ([, , ...children], { render, renderData }) => {
    assert.equal(renderData.props.person, data.componentPerson)
    assert.equal(renderData.props.i, 99)
    let html = ''
    for (const child of children) {
      // Render a named slot's content in the component's scope.
      html += await render(Array.isArray(child) && child[0] === 'template' ? child.slice(2) : [child])
    }
    return `<article>${html}</article>`
  }
  const html = await renderHtml(markdown, { plugins: [binding(), loops({ data })], components: { Binding, Card }, data })
  assert.match(html, /Ada \/ Component \/ 0 \/ 99/)
  assert.match(html, /Grace \/ Component \/ 1 \/ 99/)
  assert.match(html, /Fallback \/ Component/)
  assert.match(html, /Outside/)
  assert.doesNotMatch(html, /loop\.|props\./)
})
