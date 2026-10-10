import type { ParserOptions, MarkdownDocument as ComarkDocument } from 'comark'
import { parseMarkdown } from 'comark'
import { MarkdownDocument } from '@comark/vue'
import binding, { Binding } from '@comark/vue/plugins/binding'
import { defineComponent, h, shallowRef, watch, type PropType } from 'vue'
import { loops } from './index.js'
import type { LoopsOptions } from './core.js'

/**
 * Vue/Nuxt adapter that reparses the source on data changes, enabling SSR and
 * data-driven updates without patching Comark's private renderer internals.
 * This does not preserve interactive child component identity between changes.
 */
export const LoopsMarkdown = defineComponent({
  name: 'LoopsMarkdown',
  props: {
    value: { type: String, required: true },
    data: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
    options: { type: Object as PropType<Omit<ParserOptions, 'plugins'>>, default: () => ({}) },
    plugins: { type: Array as PropType<ParserOptions['plugins']>, default: () => [] },
    components: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
    componentsManifest: { type: Function as PropType<(name: string) => unknown>, default: undefined },
    limits: { type: Object as PropType<Omit<LoopsOptions, 'data'>>, default: () => ({}) },
    documentKey: { type: String, default: undefined },
  },
  async setup(props) {
    const document = shallowRef<ComarkDocument>({ nodes: [], frontmatter: {}, meta: {} })
    let sequence = 0
    async function reparse() {
      const current = ++sequence
      const parsed = await parseMarkdown(props.value, {
        ...props.options,
        plugins: [binding(), ...(props.plugins ?? []), loops({ ...props.limits, data: props.data })],
      })
      if (current === sequence) document.value = parsed
    }
    await reparse()
    watch(
      () => [props.value, props.data, props.options, props.plugins, props.limits],
      () => { void reparse() },
      { deep: true },
    )
    return () => h(MarkdownDocument, {
      value: document.value,
      data: props.data,
      components: { Binding, ...props.components },
      componentsManifest: props.componentsManifest,
      documentKey: props.documentKey,
    })
  },
})
