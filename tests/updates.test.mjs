import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown } from 'comark'
import binding from 'comark/plugins/binding'
import { expandLoops, loops } from '../dist/index.js'

const source = `::for{:each="data.people" item="person" key="id"}
{{ loop.person.name }} / {{ data.label }}

#empty
Nobody here.
::`

test('a parsed template supports edits, insertion, reordering, and emptying without reparsing', async () => {
  const template = await parseMarkdown(source, { plugins: [binding()] })
  const original = JSON.stringify(template)
  const data = { people: [{ id: 'ada', name: 'Ada' }], label: 'Team' }
  const first = expandLoops(template, { data })
  data.people[0].name = 'Grace'
  data.people.unshift({ id: 'lin', name: 'Lin' })
  const updated = expandLoops(template, { data })
  assert.equal(first.nodes[0][2][1].value, 'Ada')
  assert.deepEqual(updated.nodes.map(node => node[2][1].value), ['Lin', 'Grace'])
  assert.equal(updated.nodes[0][4][1][':value'], 'data.label')
  assert.ok(updated.nodes.every(node => node[0] === 'p'), 'expansion emits regular nodes without iteration wrappers')
  data.people.reverse()
  assert.deepEqual(expandLoops(template, { data }).nodes.map(node => node[2][1].value), ['Grace', 'Lin'])
  data.people.length = 0
  assert.match(JSON.stringify(expandLoops(template, { data }).nodes), /Nobody here/)
  assert.equal(JSON.stringify(template), original)
})

test('repeated expansion reads updated frontmatter, metadata, and root props', async () => {
  const template = await parseMarkdown(`---
names: [Ada]
---
::for{:each="frontmatter.names"}
{{ loop.item }}
::

::for{:each="meta.names"}
{{ loop.item }}
::

::for{:each="props.names"}
{{ loop.item }} / {{ props.title }}
::`, { plugins: [binding()] })
  template.meta.names = ['Meta']
  const props = { names: ['Props'], title: 'First' }
  const first = expandLoops(template, { props })
  template.frontmatter.names = ['Grace']
  template.meta.names = ['Changed meta']
  props.names = ['Changed props']
  props.title = 'Second'
  const updated = expandLoops(template, { props })
  const values = document => document.nodes.filter(node => Array.isArray(node) && node[0] === 'binding')
    .map(node => node[1].value)
  assert.deepEqual(values(first), ['Ada', 'Meta', 'Props', 'First'])
  assert.deepEqual(values(updated), ['Grace', 'Changed meta', 'Changed props', 'Second'])
})

test('the parser plugin can be reused with current data and preserves renderer metadata bindings', async () => {
  const data = { people: [{ id: 'ada', name: 'Ada' }] }
  const plugins = [binding(), loops({ data })]
  const first = await parseMarkdown(source, { plugins })
  data.people = [{ id: 'grace', name: 'Grace' }]
  const updated = await parseMarkdown(source, { plugins })
  assert.equal(first.nodes[0][2][1].value, 'Ada')
  assert.equal(updated.nodes[0][2][1].value, 'Grace')

  const metadata = await parseMarkdown('{{ meta.key }}', { plugins })
  assert.equal(metadata.nodes[0][2][1][':value'], 'meta.key')
})
