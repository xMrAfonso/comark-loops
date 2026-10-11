import test from 'node:test'
import assert from 'node:assert/strict'
import { expandLoops } from '../dist/core.js'

const doc = (...nodes) => ({ nodes, frontmatter: {}, meta: {} })

test('the default iteration limit is 1000 total, including separate and nested loops', () => {
  const loop = count => ['for', { each: Array(count).fill(null) }, 'item']
  assert.equal(expandLoops(doc(loop(1000))).nodes.length, 1000)
  assert.throws(() => expandLoops(doc(loop(1001))), /maxIterations \(1000\)/)
  assert.throws(() => expandLoops(doc(loop(600), loop(600))), /maxIterations \(1000\)/)
  assert.throws(() => expandLoops(doc(['for', { each: [1] }, loop(1000)])), /maxIterations \(1000\)/)
  assert.equal(expandLoops(doc(loop(1001)), { maxIterations: 1001 }).nodes.length, 1001)
})

test('the default nesting limit is 12 loop levels', () => {
  const nested = levels => {
    let node = 'item'
    for (let level = 0; level < levels; level++) node = ['for', { each: [1] }, node]
    return doc(node)
  }
  assert.deepEqual(expandLoops(nested(12)).nodes, ['item'])
  assert.throws(() => expandLoops(nested(13)), /maxDepth \(12\)/)
  assert.deepEqual(expandLoops(nested(13), { maxDepth: 13 }).nodes, ['item'])
})

test('the default node limit is 20000, including ordinary document text', () => {
  const document = count => doc(...Array(count).fill('text'))
  assert.equal(expandLoops(document(20000)).nodes.length, 20000)
  assert.throws(() => expandLoops(document(20001)), /maxNodes \(20000\)/)
  assert.equal(expandLoops(document(20001), { maxNodes: 20001 }).nodes.length, 20001)
})
