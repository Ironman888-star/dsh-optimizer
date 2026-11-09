/**
 * Metadata regression net.
 *
 * The 2026-11-06 failure was a UTF-8 BOM (EF BB BF) in `locale/en.json`:
 * `JSON.parse` rejects it with "Unexpected token '\uFEFF'", which DSH surfaces as
 * `locale/en.json SyntaxError: is not valid JSON`. Editors on Windows add the BOM
 * silently, so it is checked byte-wise here rather than only via `JSON.parse`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const localeDir = path.join(root, 'locale')

const hasBom = (buffer) => buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf

function readJson(file) {
  const buffer = fs.readFileSync(file)
  assert.equal(hasBom(buffer), false, `${path.relative(root, file)} must not start with a UTF-8 BOM`)
  const text = buffer.toString('utf8')
  return JSON.parse(text)
}

function keyTree(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.keys(value).flatMap((key) => keyTree(value[key], prefix ? `${prefix}.${key}` : key))
}

test('locale: every locale file is BOM-free and parses as JSON', () => {
  const files = fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))
  assert.ok(files.length >= 2, 'expected en/zh locale files')
  for (const name of files) readJson(path.join(localeDir, name))
})

test('locale: meta.title and meta.description are present and non-empty', () => {
  for (const name of fs.readdirSync(localeDir).filter((entry) => entry.endsWith('.json'))) {
    const data = readJson(path.join(localeDir, name))
    assert.equal(typeof data.meta?.title, 'string', `${name}: meta.title`)
    assert.ok(data.meta.title.trim().length > 0, `${name}: meta.title must not be empty`)
    assert.equal(typeof data.meta?.description, 'string', `${name}: meta.description`)
    assert.ok(data.meta.description.trim().length > 0, `${name}: meta.description must not be empty`)
  }
})

test('locale: en and zh expose identical key trees', () => {
  const en = keyTree(readJson(path.join(localeDir, 'en.json'))).sort()
  const zh = keyTree(readJson(path.join(localeDir, 'zh.json'))).sort()
  assert.deepEqual(zh, en)
})

test('metadata: package.json points at real files and declares the web client', () => {
  const pkg = readJson(path.join(root, 'package.json'))
  assert.equal(pkg.name, 'dsh-optimizer')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh?.manifestVersion, 1)
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.exports?.['.'], './' + pkg.main)
  assert.ok(pkg.exports?.['./client'], 'exports ./client')
  assert.ok(pkg.exports?.['./locale/*.json'], 'exports ./locale/*.json')

  // Every entry the manifest advertises must exist on disk.
  for (const key of ['.', './client', './cordis.patch.yml', './icon.svg']) {
    const target = pkg.exports[key]
    assert.ok(target, `exports ${key}`)
    assert.ok(fs.existsSync(path.join(root, target)), `${key} -> ${target} exists`)
  }
  for (const name of fs.readdirSync(localeDir)) {
    const target = pkg.exports['./locale/*.json'].replace('*', path.basename(name, '.json'))
    if (name.endsWith('.json')) assert.ok(fs.existsSync(path.join(root, target)), `locale export ${name}`)
  }

  // Files list must ship the runtime bits (locale regression would otherwise slip).
  for (const entry of ['index.js', 'client.js', 'lib', 'locale', 'cordis.patch.yml', 'icon.svg']) {
    assert.ok(pkg.files.includes(entry), `files[] must include ${entry}`)
  }
})

test('metadata: bundle patch inserts this plugin exactly once', () => {
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /^- insert:/m)
  // Count the YAML row itself, not the prose in the header comment.
  const rows = patch.split('\n').filter((line) => /^\s+-\s+id:\s*dsh-optimizer\s*$/.test(line))
  assert.equal(rows.length, 1, 'exactly one inserted row')
  assert.match(patch, /^\s+name:\s*['"]?dsh-optimizer['"]?\s*$/m)
})

test('metadata: host entry exports a cordis plugin shape', async () => {
  const mod = await import(new URL('../index.js', import.meta.url))
  assert.equal(mod.name, 'dsh-optimizer')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.default?.name, 'dsh-optimizer')
  assert.equal(typeof mod.default?.apply, 'function')
})
