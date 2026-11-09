#!/usr/bin/env node
// Generate a DSH custom-plugin-market index from a *real* public Git commit.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const opts = Object.create(null)
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!/^--[a-z-]+$/.test(key) || !argv[i+1] || argv[i+1].startsWith('--')) {
      throw Error('Usage: --repo https://github.com/owner/repo --commit <40 lowercase hex> --author <public display name> [--dsh-range 2.0.21-next]')
    }
    opts[key.slice(2)] = argv[i+1]
  }
  return opts
}
const opts = parseArgs(process.argv.slice(2))
const repo = String(opts.repo || '')
const commit = String(opts.commit || '')
const author = String(opts.author || '').trim()
const dshRange = String(opts['dsh-range'] || '2.0.21-next')
if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.endsWith('.git') || /YOUR_|EXAMPLE|PLACEHOLDER/i.test(repo)) {
  throw Error('Provide a canonical public GitHub HTTPS repository URL without trailing slash or .git')
}
if (!/^[a-f0-9]{40}$/.test(commit) || /^([0-9a-f])\1{39}$/.test(commit)) {
  throw Error('Provide the actual 40-character lowercase Git commit SHA; placeholders are not allowed')
}
if (!author || /YOUR_|EXAMPLE|PLACEHOLDER/i.test(author)) {
  throw Error('Provide the public display name of the maintainer with --author')
}
if (!dshRange.trim() || dshRange.trim() === '*') {
  throw Error('Specify a verified DSH compatibility range; wildcard * is not accepted by this release helper')
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
if (manifest.name !== 'dsh-optimizer' || manifest.version !== '0.3.6') throw Error('Unexpected package name/version: review script for new releases')
const payload = {
  format: 1,
  title: { en: 'DSH Optimizer community index', zh: '智能优化管家社区插件索引' },
  description: { en: 'Unofficial DeepSeek Harness plugins', zh: '非官方 DeepSeek Harness 插件' },
  plugins: [{
    name: manifest.name,
    title: { en: 'DSH Optimizer', zh: '智能优化管家' },
    description: { en: 'Local usage estimates, turn-based context packing and editable task guidance', zh: '本地用量估算、按轮次裁剪上下文与可编辑任务指令' },
    author,
    homepage: `${repo}#readme`,
    repository: { url: repo },
    icon: 'icons/dsh-optimizer.svg',
    versions: [{
      version: manifest.version,
      publishTimestamp: Math.floor(Date.now() / 1000),
      source: { type: 'git', url: repo, commit },
      engines: { dsh: dshRange }
    }]
  }]
}
const out = resolve(root, 'site')
mkdirSync(resolve(out,'icons'), {recursive: true})
writeFileSync(resolve(out,'index.json'), JSON.stringify(payload,null,2)+'\n')
copyFileSync(resolve(root,'icon.svg'), resolve(out,'icons/dsh-optimizer.svg'))
process.stdout.write(`Wrote ${resolve(out,'index.json')} (commit ${commit}). Verify against actual GitHub release before serving.\n`)
