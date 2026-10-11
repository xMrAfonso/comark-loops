import test from 'node:test'
import assert from 'node:assert/strict'
import { expandLoops } from '../dist/core.js'

const doc = (...nodes) => ({ nodes, frontmatter: {}, meta: {} })
const loop = (each, ...nodes) => ['for', { ':each': each }, ...nodes]
const binding = path => ['binding', { ':value': path }]

test('deep ordinary trees respect node limits without overflowing the stack', () => {
  let tree = 'leaf'
  for (let depth = 0; depth < 5000; depth++) tree = ['div', {}, tree]
  const result = expandLoops(doc(tree), { maxNodes: 5001 }).nodes[0]
  let cursor = result
  for (let depth = 0; depth < 5000; depth++) cursor = cursor[2]
  assert.equal(cursor, 'leaf')
  assert.throws(() => expandLoops(doc(tree), { maxNodes: 4000 }), /maxNodes/)
})

test('root props supply loop collections and bindings without leaking into component scopes', () => {
  const input = doc(binding('props.title'), loop('props.rows', binding('loop.item')),
    ['card', { title: 'Component title' }, binding('props.title')], binding('props.title'))
  const output = expandLoops(input, { props: { rows: ['Ada'], title: 'Root title' } }).nodes
  assert.equal(output[0][1].value, 'Root title')
  assert.equal(output[1][1].value, 'Ada')
  assert.equal(output[2][2][1][':value'], 'props.title')
  assert.equal(output[3][1].value, 'Root title')
})

test('preserves document extensions and deeply frozen input', () => {
  const input = { ...doc(loop('data.rows', binding('loop.item'))), extra: { preserved: true } }
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze)
      Object.freeze(value)
    }
    return value
  }
  freeze(input)
  const output = expandLoops(input, freeze({ data: { rows: ['Ada'] } }))
  assert.notEqual(output, input)
  assert.equal(output.extra, input.extra)
  assert.equal(output.nodes[0][1].value, 'Ada')
  assert.equal(input.nodes[0][0], 'for')
})

for (const [name, each, data] of [
  ['direct arrays', [false, 0, null, 'text'], {}],
  ['JSON arrays', '[false,0,null,"text"]', {}],
  ['trimmed dot paths', '  data.rows  ', { rows: [false, 0, null, 'text'] }],
]) {
  test(`supports ${name} and preserves typed item/index values`, () => {
    const input = doc(['for', { each, index: 'i' }, binding('loop.item'), binding('loop.i')])
    const output = expandLoops(input, { data }).nodes.map(node => node[1].value)
    assert.deepEqual(output, [false, 0, 0, 1, null, 2, 'text', 3])
  })
}

for (const each of ['data', 'rows', 'data..rows', 'data.rows map(x)', '[invalid']) {
  test(`rejects invalid collection expression ${each}`, () => {
    assert.throws(() => expandLoops(doc(loop(each, 'body'))), /Invalid ::for each path/)
  })
}

test('rejects non-array collections instead of silently dropping content', () => {
  for (const rows of [false, 0, 'text', {}, new Set([1])]) {
    assert.throws(() => expandLoops(doc(loop('data.rows', 'body')), { data: { rows } }), /each must resolve to an array/)
  }
})

test('supports meta collections, root props collections, and explicit :each precedence', () => {
  const input = { ...doc(
    loop('meta.rows', binding('loop.item')),
    loop('props.rows', binding('loop.item')),
    ['for', { each: ['Wrong'], ':each': 'data.rows' }, binding('loop.item')],
  ), meta: { rows: ['Meta'] } }
  assert.deepEqual(expandLoops(input, { data: { rows: ['Data'] }, props: { rows: ['Props'] } }).nodes.map(n => n[1].value),
    ['Meta', 'Props', 'Data'])
})

test('default/empty slots support each Comark slot spelling', () => {
  for (const attrs of [{ name: 'default' }, { '#default': '' }, { 'v-slot:default': '' }]) {
    const input = doc(loop('data.rows', 'Ordinary', ['template', attrs, 'Default'], ['template', { name: 'empty' }, 'Empty']))
    assert.deepEqual(expandLoops(input, { data: { rows: [1] } }).nodes, ['Default'])
    for (const rows of [[], null, undefined]) {
      assert.deepEqual(expandLoops(input, { data: { rows } }).nodes, ['Empty'])
    }
  }
})

test('ordinary templates are preserved when they are not loop control slots', () => {
  const template = ['template', {}, 'Ordinary template']
  const [result] = expandLoops(doc(loop('[1]', template))).nodes
  assert.equal(result[0], 'template')
  assert.deepEqual(result.slice(2), ['Ordinary template'])
  assert.deepEqual(Object.keys(result[1]), [])
})

test('restores shadowed aliases and retains outer aliases in an inner empty branch', () => {
  const input = doc(loop('data.rows', binding('loop.item.name'),
    loop('loop.item.members', binding('loop.item')),
    binding('loop.item.name'),
    loop('loop.item.empty', ['template', { name: 'empty' }, binding('loop.item.name')]),
  ))
  const output = expandLoops(input, { data: { rows: [{ name: 'Outer', members: ['Inner'], empty: [] }] } }).nodes
  assert.deepEqual(output.map(n => n[1].value), ['Outer', 'Inner', 'Outer', 'Outer'])
})

test('key values require own string or finite number properties', () => {
  for (const id of [true, false, null, undefined, NaN, Infinity, -Infinity, {}, []]) {
    assert.throws(() => expandLoops(doc(['for', { ':each': 'data.rows', key: 'id' }, 'body']),
      { data: { rows: [{ id }] } }), /Missing or invalid ::for key/)
  }
  for (const row of [Object.create({ id: 'inherited' }), Object.defineProperty({}, 'id', { get() { throw Error('getter') } })]) {
    assert.throws(() => expandLoops(doc(['for', { ':each': 'data.rows', key: 'id' }, 'body']),
      { data: { rows: [row] } }), /Missing or invalid ::for key/)
  }
  assert.deepEqual(expandLoops(doc(['for', { ':each': 'data.rows', key: 'id' }, 'body']),
    { data: { rows: [{ id: 0 }, { id: '' }, { id: -1.5 }] } }).nodes, ['body', 'body', 'body'])
})

test('key uniqueness is scoped to each invocation and preserves ID types', () => {
  const row = id => ({ id })
  const input = doc(['for', { ':each': 'data.groups', item: 'group', key: 'id' },
    ['for', { ':each': 'loop.group.members', key: 'id' }, binding('loop.item.id')],
  ])
  const data = { groups: [
    { id: 'a', members: [row(1), row('1')] },
    { id: 'b', members: [row(1), row('1')] },
  ] }
  assert.deepEqual(expandLoops(input, { data }).nodes.map(node => node[1].value), [1, '1', 1, '1'])
  data.groups[1].members.push(row(1))
  assert.throws(() => expandLoops(input, { data }), /Duplicate ::for key: 1/)
})

test('rejects invalid aliases, key types, and limits with clear errors', () => {
  for (const attrs of [{ item: 'bad-name' }, { index: 'bad.name' }, { item: 1 }, { key: 1 }, { key: 'id..name' }]) {
    assert.throws(() => expandLoops(doc(['for', { each: [], ...attrs }, 'body'])), /Invalid|must be a path string/)
  }
  for (const name of ['maxNodes', 'maxIterations', 'maxDepth']) {
    for (const value of [0, -1, 1.5, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => expandLoops(doc(), { [name]: value }), new RegExp(`${name} must be a positive safe integer`))
    }
  }
})

test('shares iteration/node budgets across nested loops and independent siblings', () => {
  const siblings = doc(loop('[1,2]', 'a'), loop('[3,4]', 'b'))
  assert.equal(expandLoops(siblings, { maxIterations: 4, maxNodes: 4 }).nodes.length, 4)
  assert.throws(() => expandLoops(siblings, { maxIterations: 3 }), /maxIterations/)
  const nested = doc(loop('data.rows', loop('loop.item', 'body')))
  assert.throws(() => expandLoops(nested, { data: { rows: [[1, 2], [3, 4]] }, maxIterations: 5 }), /maxIterations/)
  assert.throws(() => expandLoops(doc(['p', {}, 'ordinary']), { maxNodes: 1 }), /maxNodes/)
})

test('suppresses injected dangerous sinks and URL schemes while preserving safe schemes', () => {
  const attrs = { ':href': 'loop.item', ':SRC': 'loop.item', ':innerHTML': 'loop.item', textContent: 'unsafe',
    ':dangerouslySetInnerHTML': 'loop.item', title: 'kept', $: { custom: true } }
  const values = ['javascript:evil', 'java\tscript:evil', 'data:text/html,evil', 'vbscript:evil', false, {},
    '/relative', '#anchor', '//example.com', 'HTTP://example.com', 'https://example.com', 'mailto:a@b.test', 'tel:123']
  const result = expandLoops(doc(loop('data.rows', ['a', attrs, 'link'])), { data: { rows: values } }).nodes
  for (const [index, node] of result.entries()) {
    assert.equal(node[1].href, index < 6 ? undefined : values[index])
    assert.equal(node[1].SRC, index < 6 ? undefined : values[index])
    assert.equal(node[1].innerHTML, undefined)
    assert.equal(node[1].textContent, undefined)
    assert.equal(node[1].dangerouslySetInnerHTML, undefined)
    assert.equal(node[1].title, 'kept')
    assert.deepEqual(node[1].$, { custom: true })
  }
})
