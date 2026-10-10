import test from 'node:test'
import assert from 'node:assert/strict'
import { h, createSSRApp, Suspense } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { LoopsMarkdown } from '../dist/vue.js'

test('Vue SSR renders scoped loop bindings without HTML wrappers', async () => {
  const source = `::for{:each="data.names" item="person"}
## {{ props.person.name }}
::`
  const app = createSSRApp({
    render() {
      return h(Suspense, null, {
        default: () => h(LoopsMarkdown, { value: source, data: { names: [{ name: 'Ada' }, { name: 'Lin' }] } }),
      })
    },
  })
  const html = await renderToString(app)
  assert.match(html, /Ada/)
  assert.match(html, /Lin/)
  assert.doesNotMatch(html, /<for[ >]/)
})
