#!/usr/bin/env node
// Ensure the bundled client factory matches the upstream source, with the
// separate dsh-delete-turn plugin settings-slot removed intentionally.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const upstream=readFileSync(join(root,'vendor/dsh-delete-turn/src/client.js'),'utf8')
const bundle=readFileSync(join(root,'client.js'),'utf8')
const begin='  factory: (require) => {'
const start=upstream.indexOf(begin)+begin.length
const end=upstream.lastIndexOf('\n  },\n})')
assert.ok(start>begin.length && end>start,'Upstream wrapper changed')
let body=upstream.slice(start,end)
const marker=/\n      \/\/ 同一张卡也挂在包自己的页面上[\s\S]*?\n      ctx\.slots\.inject\('plugins\.bundle\.config', \(\) =>[\s\S]*?\n      \)\n/
assert.ok(marker.test(body),'Upstream config slot structure changed')
body=body.replace(marker,'\n      // Bundled into dsh-optimizer: settings rendered in SectionPage below.\n')
const signature='\n    function makeVendoredDeleteClient(require) {\n'+body+'\n    }\n'
assert.ok(bundle.includes(signature),'Bundled deletion client has drifted from attributed source')
assert.equal((bundle.match(/window\.__ModuleLoader__\.load\(/g)??[]).length,1,'Only one DSH client bundle is permitted')
console.log('Vendor client integration verified against source.')
