import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHost } from '../lib/host.js'
import { foldSurface } from '../vendor/dsh-delete-turn/src/logic.js'
import { makeCtx, tempHome } from './helpers.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const original = fs.readFileSync(path.join(root, 'vendor/dsh-delete-turn/src/client.js'), 'utf8')
const assembled = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

function event(seq, type, data, surfaceOp) {
  return { seq, type, data, ...(surfaceOp ? { surfaceOp } : {}) }
}

test('vendor merge: original user-facing controls are embedded once, not reimplemented', () => {
  assert.ok(original.includes('function SelectionBar('))
  assert.ok(assembled.includes('function SelectionBar('))
  assert.ok(assembled.includes('function OverlayEntry('))
  assert.ok(assembled.includes('function AssistantAction('))
  assert.equal((assembled.match(/function makeVendoredDeleteClient\(/g) ?? []).length, 1)
  assert.equal((assembled.match(/window\.__ModuleLoader__\.load\(/g) ?? []).length, 1)
  assert.ok(!fs.existsSync(path.join(root, 'lib/turn-delete.js')))
  assert.doesNotMatch(assembled, /dsh-optimizer-turn-delete-changed|\/turns\/delete\.json/)
})

test('vendor merge: routes mount under the optimizer bundle and fully dispose', async () => {
  const id = 'session-11111111-1111-1111-1111-111111111111'
  const events = [
    event(0,'turn/start',{turn:1}),
    event(1,'step/start',{turn:1,step:1}),
    event(2,'system/message',{turn:1,step:1,message:{id:'sys-1',role:'system',content:[{type:'text',text:'system'}],source:{kind:'plugin',plugin:'test'}}},'append'),
    event(3,'user/message',{id:'user-1',role:'user',content:[{type:'text',text:'test deletion'}],source:{kind:'user'}},'append'),
    event(4,'turn/end',{turn:1}),
  ]
  const appends = []
  const session = {
    surface:{nodes:foldSurface(events).nodes},
    append(type,data,options){
      const saved=event(events.length,type,data,options.surfaceOp)
      saved.sourceEventSeqs=options.sourceEventSeqs
      appends.push(saved)
      events.push(saved)
      session.surface.nodes = foldSurface(events).nodes
      return saved
    },
  }
  const ctx=makeCtx({services:{
    sessions:{get:name=>name===id?session:undefined, flush:async()=>true},
    sessionQuery:{readSession:async()=>({events})},
  }})
  const host=createHost({root:ctx,home:tempHome()})
  host.start()
  const routes = ['/dsh-delete-turn/state','/dsh-delete-turn/delete','/dsh-delete-turn/queue-remove']
  for(const route of routes) assert.ok(ctx.routes.has(route),`missing route ${route}`)
  assert.equal(ctx.routes.has('/dsh-optimizer/turns/delete.json'),false)
  assert.equal(host.status().modules.find(x=>x.id==='messageDelete')?.state,'mounted')
  assert.equal('turnDelete' in host.status(),false)
  // Exercise the original upstream route directly through the optimizer host.
  const route=ctx.routes.get('/dsh-delete-turn/delete')
  const originalOrigin='http://127.0.0.1:60110'
  const req = new (await import('node:events')).EventEmitter()
  req.url='/dsh-delete-turn/delete';req.method='POST';
  req.socket={remoteAddress:'127.0.0.1'}
  req.headers={host:'127.0.0.1:60110',origin:originalOrigin}
  const body={sessionId:id,mode:'message',seq:3}
  const res={statusCode:0,body:'',writeHead(status){this.statusCode=status},end(data){this.body=data}}
  process.nextTick(()=>{req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end')})
  await route.handler(req,res)
  assert.equal(res.statusCode,200,res.body)
  assert.equal(JSON.parse(res.body).ok,true)
  assert.equal(appends.length,1)
  assert.match(appends[0].data.id,/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
  assert.equal(appends[0].data.role,'user')
  assert.equal(appends[0].data.source.kind,'plugin:dsh-delete-turn')
  assert.deepEqual(appends[0].sourceEventSeqs,[3])
  host.dispose()
  for(const route of routes) assert.equal(ctx.routes.has(route),false,`route persisted: ${route}`)
})
