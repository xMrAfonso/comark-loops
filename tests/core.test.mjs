import test from 'node:test'
import assert from 'node:assert/strict'
import { expandLoops } from '../dist/core.js'

const binding = (path, extra = {}) => ['binding', { ':value': path, ...extra }]
const loop = (path, children, attrs = {}) => ['for', { ':each': path, ...attrs }, ...children]
const doc = (...nodes) => ({ nodes, frontmatter: {}, meta: {} })
const get = (document, options = {}) => expandLoops(document, options).nodes

test('expands loops without mutating the authored document', () => {
  const input = doc(loop('data.rows', [['p', {}, binding('loop.row.name')]], { item: 'row' }))
  const output = get(input, { data: { rows: [{ name: 'A' }, { name: 'B' }] } })
  assert.deepEqual(output.map(n => n[2][1].value), ['A', 'B'])
  assert.equal(input.nodes[0][0], 'for')
  assert.equal(input.nodes[0][2][2][1][':value'], 'loop.row.name')
})
test('uses empty slot on an empty or missing array', () => {
  const input = doc(loop('data.items', [
    ['p', {}, 'Regular'],
    ['template', { '#empty': '' }, ['p', {}, 'Nothing']],
  ]))
  assert.equal(get(input, { data: { items: [] } })[0][2], 'Nothing')
  assert.equal(get(input, { data: {} })[0][2], 'Nothing')
})
test('expands nested loops with lexical aliases and shadowing', () => {
  const input = doc(loop('data.groups', [
    loop('loop.group.members', [['p', {}, binding('loop.member'), binding('loop.i'), binding('loop.group.name')]],
      { item: 'member', index: 'i' }),
  ], { item: 'group' }))
  const output = get(input, { data: { groups: [
    { name: 'X', members: ['a', 'b'] }, { name: 'Y', members: ['c'] },
  ] } })
  assert.deepEqual(output.map(p => p.slice(2).map(n => n[1].value)), [
    ['a', 0, 'X'], ['b', 1, 'X'], ['c', 0, 'Y'],
  ])
})
test('substitutes scope-dependent component props and leaves other bindings alone', () => {
  const source = doc(loop('data.rows', [
    ['if', { ':value': 'loop.row.published', ':eq': 'data.allowed' },
      ['p', {}, binding('data.global'), binding('loop.row.name')]],
  ], { item: 'row' }))
  const [result] = get(source, { data: { rows: [{ name: 'A', published: true }] } })
  assert.equal(result[1].value, true)
  assert.equal(result[1][':eq'], 'data.allowed')
  assert.equal(result[2][2][1][':value'], 'data.global')
  assert.equal(result[2][3][1].value, 'A')
})
test('restricts injected URLs and unsafe DOM props', () => {
  const input = doc(loop('data.urls', [
    ['a', { ':href': 'loop.url', ':innerHTML': 'loop.url' }, 'go'],
  ], { item: 'url' }))
  const output = get(input, { data: { urls: ['javascript:alert(1)', 'https://example.com', 'java\nscript:evil'] } })
  assert.equal(output[0][1].href, undefined)
  assert.equal(output[1][1].href, 'https://example.com')
  assert.equal(output[2][1].href, undefined)
  assert.equal(output[0][1].innerHTML, undefined)
})
test('rejects duplicate or invalid keys and validates aliases', () => {
  const source = doc(loop('data.rows', ['hi'], { key: 'id' }))
  assert.throws(() => get(source, { data: { rows: [{ id: 1 }, { id: 1 }] } }), /Duplicate/)
  assert.throws(() => get(source, { data: { rows: [{}] } }), /Missing/)
  assert.throws(() => get(doc(loop('data.rows', ['x'], { item: '__proto__' })),
    { data: { rows: ['a'] } }), /Invalid/)
})
test('enforces maximum depth, iterations, and expanded nodes', () => {
  const nested = doc(loop('data.rows', [loop('loop.x', ['x'])], { item: 'x' }))
  assert.throws(() => get(nested, { data: { rows: [[1]] }, maxDepth: 1 }), /maxDepth/)
  assert.throws(() => get(doc(loop('data.rows', ['x'])), { data: { rows: [1, 2] }, maxIterations: 1 }), /maxIterations/)
  assert.throws(() => get(doc(loop('data.rows', [['p', {}, 'x']])),
    { data: { rows: [1, 2] }, maxNodes: 3 }), /maxNodes/)
})
test('does not execute property getters or traverse prototypes', () => {
  const row = Object.defineProperty({}, 'secret', { get() { throw Error('executed getter') } })
  const result = get(doc(loop('data.rows', [binding('loop.r.secret')], { item: 'r' })),
    { data: { rows: [row] } })
  assert.equal(result[0][1].value, undefined)
  assert.deepEqual(get(doc(loop('data.rows.__proto__', ['x'])), { data: { rows: [1] } }), [])
})
test('keeps raw HTML for elements untouched, does not expand them', () => {
  const raw = doc(['for', { $: { html: 1 }, ':each': 'data.rows' }, ['p', {}, 'literal']])
  assert.equal(get(raw, { data: { rows: ['x'] } })[0][0], 'for')
})
test('allows frontmatter/meta collections', () => {
  const d = doc(loop('frontmatter.rows', [binding('loop.x')], { item: 'x' }))
  d.frontmatter = { rows: ['hello'] }
  assert.equal(get(d)[0][1].value, 'hello')
})

test('resolves loops from enclosing component props and restores sibling scope', () => {
  const input = doc(
    ['card', { ':rows': 'data.rows' }, loop('props.rows', [binding('loop.row.name')], { item: 'row' })],
    loop('props.rows', ['should not render']),
  )
  const output = get(input, { data: { rows: [{ name: 'Ada' }] } })
  assert.equal(output[0][2][1].value, 'Ada')
  assert.equal(output.length, 1)
  assert.equal(output[0][1][':rows'], 'data.rows')
})

test('passes loop-bound component props to nested loops without hiding outer aliases', () => {
  const input = doc(loop('data.rows', [
    ['card', { ':entry': 'loop.row' },
      loop('props.entry.members', [binding('loop.member'), binding('loop.row.name')], { item: 'member' })],
  ], { item: 'row' }))
  const [card] = get(input, { data: { rows: [{ name: 'Ada', members: ['Lin'] }] } })
  assert.deepEqual(card.slice(2).map(node => node[1].value), ['Lin', 'Ada'])
})

test('supports numeric and non-identifier dot-path segments like Comark bindings', () => {
  const input = doc(loop('data.groups.0.members', [
    binding('loop.row.tags.0'), binding('loop.row.display-name'),
  ], { item: 'row' }))
  const output = get(input, { data: { groups: [{ members: [{ tags: ['first'], 'display-name': 'Ada' }] }] } })
  assert.deepEqual(output.map(node => node[1].value), ['first', 'Ada'])
})

test('derives component collection scopes without executing getters', () => {
  const data = Object.defineProperty({}, 'rows', { get() { throw Error('executed getter') } })
  const input = doc(['card', { ':rows': 'data.rows' }, loop('props.rows', ['unexpected'])])
  assert.equal(get(input, { data })[0].length, 2)
})

test('does not execute array element getters or read inherited elements', () => {
  const rows = [null]
  Object.defineProperty(rows, '0', { get() { throw Error('executed element getter') } })
  const input = doc(loop('data.rows', [binding('loop.item')]))
  assert.equal(get(input, { data: { rows } })[0][1].value, undefined)
  const inherited = new Array(1)
  Object.setPrototypeOf(inherited, { 0: 'inherited element' })
  assert.equal(get(input, { data: { rows: inherited } })[0][1].value, undefined)
})

test('enclosing JSON collection props work alongside loop aliases', () => {
  const input = doc(['card', { ':rows': '["A","B"]', item: 'component item' },
    loop('props.rows', [binding('loop.item')]),
  ])
  assert.deepEqual(get(input)[0].slice(2).map(node => node[1].value), ['A', 'B'])
})

test('named component slots retain enclosing props for nested collections', () => {
  const input = doc(['card', { ':rows': 'data.rows' },
    ['template', { name: 'footer' }, loop('props.rows', [binding('loop.row.name')], { item: 'row' })],
  ])
  assert.equal(get(input, { data: { rows: [{ name: 'Ada' }] } })[0][2][2][1].value, 'Ada')
})

test('counts preserved raw HTML and comment descendants in maxNodes', () => {
  for (const literal of [
    ['div', { $: { html: 1 } }, ['span', {}, 'raw']],
    [null, {}, 'comment'],
  ]) {
    assert.throws(() => get(doc(loop('data.rows', [literal])), {
      data: { rows: [1, 2] }, maxNodes: 2,
    }), /maxNodes/)
  }
})

test('raw HTML templates are not interpreted as loop empty slots', () => {
  const literal = ['template', { $: { html: 1 }, name: 'empty' }, 'literal']
  assert.deepEqual(get(doc(loop('data.rows', [literal])), { data: { rows: [1] } })[0], literal)
  assert.deepEqual(get(doc(loop('data.rows', [literal])), { data: { rows: [] } }), [])
})

test('key paths support array indexes and non-identifier property names', () => {
  const input = doc(loop('data.rows', ['row'], { key: 'ids.0.row-id' }))
  assert.deepEqual(get(input, { data: { rows: [{ ids: [{ 'row-id': 'a' }] }] } }), ['row'])
})

test('invalid loop declarations fail even for an empty collection', () => {
  for (const attrs of [{ item: '__proto__' }, { item: 'row', index: 'row' }, { key: '' }, { key: 'constructor' }]) {
    assert.throws(() => get(doc(loop('data.rows', ['row'], attrs)), { data: { rows: [] } }), /Invalid|must differ/)
  }
})

test('large outputs within custom bounds do not hit function argument limits', () => {
  const body = Array.from({ length: 150000 }, () => 'row')
  assert.equal(get(doc(loop('data.rows', body)), { data: { rows: [1] }, maxNodes: body.length }).length, body.length)
})
