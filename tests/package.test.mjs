import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('packed exports and declarations work without framework runtimes or adapter files', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'comark-loops-package-'))
  try {
    // Disable lifecycle scripts so this packaging assertion cannot recurse into
    // prepack's full test suite. The test command has already built dist.
    const archive = join(fixture, 'packed.tgz')
    execFileSync('pnpm', ['--config.ignore-scripts=true', 'pack', '--out', archive],
      { cwd: root, encoding: 'utf8' })
    const paths = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
      .filter(path => !path.endsWith('/')).map(path => path.replace(/^package\//, '')))
    assert.ok(paths.has('README.md'))
    assert.ok(paths.has('LICENSE'))
    assert.ok([...paths].every(path => path.startsWith('dist/') || ['README.md', 'LICENSE', 'package.json'].includes(path)))
    execFileSync('tar', ['-xzf', archive, '-C', fixture])
    const directory = join(fixture, 'package')
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './core'])
    assert.deepEqual(manifest.peerDependencies, { comark: '^0.7.0' })
    assert.deepEqual(manifest.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/' })
    assert.equal(manifest.engines.node, '>=20.19.0')
    assert.equal(manifest.peerDependenciesMeta, undefined)
    assert.ok([...paths].every(path => !/vue|adapter|groups/i.test(path)), 'adapter artifacts must not be published')
    for (const entry of Object.values(manifest.exports)) {
      assert.ok(paths.has(entry.import.slice(2)), `missing runtime export ${entry.import}`)
      assert.ok(paths.has(entry.types.slice(2)), `missing type export ${entry.types}`)
    }
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import loops, { expandLoops } from 'comark-loops';
      import { expandLoops as core } from 'comark-loops/core';
      assert.equal(core, expandLoops);
      const state = { tree: { nodes: [['for', { each: ['Packed'] }, ['binding', { ':value': 'loop.item' }]]], frontmatter: {}, meta: {} } };
      loops().post(state);
      assert.equal(state.tree.nodes[0][1].value, 'Packed');
      await assert.rejects(import('comark-loops/vue'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    `], { cwd: directory, encoding: 'utf8' })
    // Add installed dependencies only for the public type declaration check.
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
    const types = join(directory, 'consumer.mts')
    writeFileSync(types, `
      import loops, { expandLoops, type LoopDocument, type LoopsOptions } from 'comark-loops';
      import { expandLoops as core } from 'comark-loops/core';
      import { createMarkdownParser, type MarkdownDocument } from 'comark';
      const input: LoopDocument & { id: 'preserved' } = { nodes: [], frontmatter: {}, meta: {}, id: 'preserved' };
      const options: LoopsOptions = { data: { rows: [] }, props: { rows: [] }, maxNodes: 20 };
      const id: 'preserved' = expandLoops(input, options).id;
      core(input, options);
      loops(options);
      createMarkdownParser({ plugins: [loops(options)] });
      declare const parsed: MarkdownDocument;
      const expanded: MarkdownDocument = expandLoops(parsed, options);
    `)
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck',
      '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', types],
    { cwd: directory, encoding: 'utf8' })
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
