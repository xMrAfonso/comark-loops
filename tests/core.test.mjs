import test from 'node:test'
import assert from 'node:assert/strict'
import { expandLoops } from '../dist/core.js'

const binding = (path, extra = {}) => ['binding', { ':value': path, ...extra }]
const loop = (path, children, attrs = {}) => ['for', { ':each': path, ...attrs }, ...children]
const doc = (...nodes) => ({ nodes, frontmatter: {}, meta: {} })
const get = (document, options = {}) => expandLoops(document, options).nodes

test('expands loops without mutating the authored document', () => {
  const input = doc(loop('data.rows', [['p', {}, binding('props.row.name')]], { item: 'row' }))
  const output = get(input, { data: { rows: [{ name: 'A' }, { name: 'B' }] } })
  assert.deepEqual(output.map(n => n[2][1].value), ['A', 'B'])
  assert.equal(input.nodes[0][0], 'for')
  assert.equal(input.nodes[0][2][2][1][':value'], 'props.row.name')
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
    loop('props.group.members', [['p', {}, binding('props.member'), binding('props.i'), binding('props.group.name')]],
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
    ['if', { ':value': 'props.row.published', ':eq': 'data.allowed' },
      ['p', {}, binding('data.global'), binding('props.row.name')]],
  ], { item: 'row' }))
  const [result] = get(source, { data: { rows: [{ name: 'A', published: true }] } })
  assert.equal(result[1].value, true)
  assert.equal(result[1][':eq'], 'data.allowed')
  assert.equal(result[2][2][1][':value'], 'data.global')
  assert.equal(result[2][3][1].value, 'A')
})
test('restricts injected URLs and unsafe DOM props', () => {
  const input = doc(loop('data.urls', [
    ['a', { ':href': 'props.url', ':innerHTML': 'props.url' }, 'go'],
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
  const nested = doc(loop('data.rows', [loop('props.x', ['x'])], { item: 'x' }))
  assert.throws(() => get(nested, { data: { rows: [[1]] }, maxDepth: 1 }), /maxDepth/)
  assert.throws(() => get(doc(loop('data.rows', ['x'])), { data: { rows: [1, 2] }, maxIterations: 1 }), /maxIterations/)
  assert.throws(() => get(doc(loop('data.rows', [['p', {}, 'x']])),
    { data: { rows: [1, 2] }, maxNodes: 3 }), /maxNodes/)
})
test('does not execute property getters or traverse prototypes', () => {
  const row = Object.defineProperty({}, 'secret', { get() { throw Error('executed getter') } })
  const result = get(doc(loop('data.rows', [binding('props.r.secret')], { item: 'r' })),
    { data: { rows: [row] } })
  assert.equal(result[0][1].value, undefined)
  assert.deepEqual(get(doc(loop('data.rows.__proto__', ['x'])), { data: { rows: [1] } }), [])
})
test('keeps raw HTML for elements untouched, does not expand them', () => {
  const raw = doc(['for', { $: { html: 1 }, ':each': 'data.rows' }, ['p', {}, 'literal']])
  assert.equal(get(raw, { data: { rows: ['x'] } })[0][0], 'for')
})
test('allows frontmatter/meta collections', () => {
  const d = doc(loop('frontmatter.rows', [binding('props.x')], { item: 'x' }))
  d.frontmatter = { rows: ['hello'] }
  assert.equal(get(d)[0][1].value, 'hello')
})
