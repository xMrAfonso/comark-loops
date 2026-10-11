import test from 'node:test'
import assert from 'node:assert/strict'
import { expandLoops } from '../dist/core.js'

const doc = (...nodes) => ({ nodes, frontmatter: {}, meta: {} })
const binding = path => ['binding', { ':value': path }]
const loop = (each, children, attrs = {}) => ['for', { ':each': each, ...attrs }, ...children]

test('loop aliases do not shadow component props with the same item or index names', () => {
  const person = { name: 'Iteration' }
  const input = doc(['card', { ':person': '{"name":"Component"}', ':i': '99' },
    loop('data.people', [
      binding('loop.person.name'), binding('props.person.name'), binding('loop.i'), binding('props.i'),
      ['panel', { ':record': 'loop.person', ':position': 'loop.i', ':label': 'props.person.name' }],
    ], { item: 'person', index: 'i' }),
  ])
  const [card] = expandLoops(input, { data: { people: [person] } }).nodes
  assert.equal(card[2][1].value, 'Iteration')
  assert.equal(card[3][1][':value'], 'props.person.name')
  assert.equal(card[4][1].value, 0)
  assert.equal(card[5][1][':value'], 'props.i')
  assert.equal(card[6][1].record, person)
  assert.equal(card[6][1].position, 0)
  assert.equal(card[6][1][':label'], 'props.person.name')
})

test('root props remain independent from identically named loop aliases', () => {
  const input = doc(loop('data.people', [
    binding('loop.person.name'), binding('props.person.name'), binding('loop.i'), binding('props.i'),
    loop('props.person.members', [binding('loop.member')], { item: 'member' }),
  ], { item: 'person', index: 'i' }))
  const result = expandLoops(input, {
    data: { people: [{ name: 'Iteration', members: ['Wrong scope'] }] },
    props: { person: { name: 'Root', members: ['Root member'] }, i: 42 },
  })
  assert.deepEqual(result.nodes.map(node => node[1].value), ['Iteration', 'Root', 0, 42, 'Root member'])
})

test('props collection paths resolve component props instead of a same-named loop alias', () => {
  const input = doc(['card', { ':person': '{"members":["Component member"]}' },
    loop('data.people', [
      loop('props.person.members', [binding('loop.member')], { item: 'member' }),
      loop('loop.person.members', [binding('loop.member')], { item: 'member' }),
    ], { item: 'person' }),
  ])
  const [card] = expandLoops(input, { data: { people: [{ members: ['Loop member'] }] } }).nodes
  assert.deepEqual(card.slice(2).map(node => node[1].value), ['Component member', 'Loop member'])
})

test('item and index aliases stay available through named component slots', () => {
  const input = doc(loop('data.people', [
    ['card', { ':person': 'loop.person' },
      ['template', { name: 'footer' }, binding('loop.person.name'), binding('loop.i'), binding('props.person.name')]],
  ], { item: 'person', index: 'i' }))
  const [card] = expandLoops(input, { data: { people: [{ name: 'Ada' }] } }).nodes
  const footer = card[2]
  assert.equal(footer[2][1].value, 'Ada')
  assert.equal(footer[3][1].value, 0)
  assert.equal(footer[4][1][':value'], 'props.person.name')
})

test('loop aliases are restored after nested shadowing and removed after their scope', () => {
  const input = doc(loop('data.people', [
    binding('loop.person.name'), binding('loop.i'),
    loop('loop.person.members', [binding('loop.person.name'), binding('loop.i')], { item: 'person', index: 'i' }),
    binding('loop.person.name'), binding('loop.i'),
  ], { item: 'person', index: 'i' }), binding('loop.person.name'), binding('loop.i'))
  const result = expandLoops(input, { data: { people: [{ name: 'Outer', members: [{ name: 'Inner' }] }] } })
  assert.deepEqual(result.nodes.map(node => node[1].value), ['Outer', 0, 'Inner', 0, 'Outer', 0, undefined, undefined])
  assert.ok(result.nodes.every(node => !Object.hasOwn(node[1], ':value')))
})

test('an empty branch retains outer aliases without creating the missing item/index', () => {
  const input = doc(loop('data.people', [
    loop('loop.person.members', [
      ['template', { name: 'empty' }, binding('loop.person.name'), binding('loop.i'), binding('loop.member'), binding('loop.j')],
    ], { item: 'member', index: 'j' }),
  ], { item: 'person', index: 'i' }))
  const result = expandLoops(input, { data: { people: [{ name: 'Outer', members: [] }] } })
  assert.deepEqual(result.nodes.map(node => node[1].value), ['Outer', 0, undefined, undefined])
})

test('legacy props aliases are not resolved from a loop item', () => {
  const input = doc(loop('data.people', [binding('props.person.name'), binding('loop.person.name')], { item: 'person' }))
  const result = expandLoops(input, { data: { people: [{ name: 'Ada' }] } })
  assert.equal(result.nodes[0][1][':value'], 'props.person.name')
  assert.equal(result.nodes[1][1].value, 'Ada')
})

test('missing loop collections use the empty branch even when props have a matching name', () => {
  const input = doc(loop('loop.person.members', [binding('loop.item'),
    ['template', { name: 'empty' }, 'Missing alias'],
  ]))
  assert.deepEqual(expandLoops(input, { props: { person: { members: ['Root member'] } } }).nodes, ['Missing alias'])
})

test('loop alias names can match namespaces without replacing those namespaces', () => {
  const input = doc(loop('data.people', [binding('loop.data'), binding('loop.props'), binding('data.label'), binding('props.label')],
    { item: 'data', index: 'props' }))
  const result = expandLoops(input, { data: { people: ['Item'], label: 'Data' }, props: { label: 'Root' } })
  assert.equal(result.nodes[0][1].value, 'Item')
  assert.equal(result.nodes[1][1].value, 0)
  assert.equal(result.nodes[2][1][':value'], 'data.label')
  assert.equal(result.nodes[3][1].value, 'Root')
})

test('loop lookup does not read inherited properties, getters, or forbidden paths', () => {
  const person = Object.assign(Object.create({ inherited: 'Hidden' }), { name: 'Ada' })
  Object.defineProperty(person, 'secret', { get() { throw Error('getter executed') } })
  const input = doc(loop('data.people', [
    binding('loop.person.name'), binding('loop.person.inherited'), binding('loop.person.secret'), binding('loop.person.constructor'),
  ], { item: 'person' }))
  const result = expandLoops(input, { data: { people: [person] } })
  assert.deepEqual(result.nodes.map(node => node[1].value), ['Ada', undefined, undefined, undefined])
})
