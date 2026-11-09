#!/usr/bin/env node
// Public-source hygiene guard. Not a substitute for human review.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ignoredDirs = new Set(['.git', 'node_modules', 'site', 'coverage', 'dist'])
const findings = []
function visit(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) { if (!ignoredDirs.has(ent.name)) visit(resolve(dir, ent.name)); continue }
    if (!ent.isFile() || ent.name === 'release-audit.mjs') continue
    const path = resolve(dir,ent.name)
    const rel = relative(root,path).replaceAll('\\','/')
    if (!/\.(?:js|mjs|json|md|yml|yaml|txt|svg)$/.test(ent.name) && ent.name !== 'LICENSE') continue
    const txt = readFileSync(path,'utf8')
    // Environment-specific paths and the private development/acceptance roots.
    if (/E:\\我的小鲸鱼|E:\\DSH自制插件|Users\\许永强|E:\\AI-Projects|baseline-20261106|session-70022e78|session-467a0f2f/i.test(txt)) findings.push(`${rel}: private path/session reference`)
    if (/-----BEGIN (?:OPENSSH|RSA|EC|DSA|(?:[A-Z ]+ )?PRIVATE) KEY-----/.test(txt)) findings.push(`${rel}: private key block`)
    if (/ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}|sk-[A-Za-z0-9]{35,}/.test(txt)) findings.push(`${rel}: token-like literal`)
    if (/\.dsh[/\\]sessions[/\\].*\.jsonl\.zstd/.test(txt)) findings.push(`${rel}: private session path`)
  }
}
visit(root)
if (findings.length) {
  console.error('Public release audit FAILED:\n' + findings.join('\n'))
  process.exitCode = 1
} else {
  console.log('Public release audit PASSED. Manual privacy/license review is still required.')
}
