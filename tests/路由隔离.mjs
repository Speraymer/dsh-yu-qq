import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'qq-routing-'))
process.env.DSH_HOME = home
const path = join(home, 'qq-bridge-config.json')
const base = { 总开关: true, 试运行: false, 目标会话: 'D', 私聊会话: 'P', 群会话: 'G', 私聊QQ: '10001', 群号: '20001', 转私聊: true, 转群: false, 收私聊: true, 收群: true, QQ会话目录: join(home, 'sessions'), 群接话: 'at' }
let config
const save = (patch = {}) => { config = { ...base, ...patch }; writeFileSync(path, JSON.stringify(config)) }
const sent = [], received = [], calls = []
let privateMessages = [], groupMessages = [], failPrivate = false
globalThis.fetch = async (url, options) => {
  const action = new URL(url).pathname.slice(1)
  calls.push(action)
  const body = JSON.parse(options.body)
  let data = {}
  if (action.startsWith('send_')) sent.push({ action, ...body })
  else if (action === 'get_login_info') data = { user_id: 30001 }
  else if (action === 'get_friend_msg_history') {
    if (failPrivate) throw Error('mock private unavailable')
    data = { messages: privateMessages }
  } else if (action === 'get_group_msg_history') data = { messages: groupMessages }
  else throw Error('unexpected mock action: ' + action)
  return { json: async () => ({ status: 'ok', retcode: 0, data }) }
}
const { apply } = await import('../lib/host.js')
const agents = new Map()
const add = (id) => agents.set(id, { session: { id }, followup: async (m) => received.push({ id, m }) })
for (const id of ['D', 'P', 'G']) add(id)
let poll, event, created = 0
const routes = new Map()
save()
const api = apply({
  agents: { get: (id) => agents.get(id) }, sessions: { flush: async () => {} },
  get: (key) => key === 'sessionController' ? { create: async () => { const sessionId = 'new-' + ++created; add(sessionId); return { sessionId } } } : undefined,
  webServer: { register: ({ path, handler }) => routes.set(path, handler) },
  on: (name, cb) => { event = cb; return () => {} },
  effect: (fn) => fn(), interval: (fn) => { poll = fn; return () => {} }, logger: { info() {} },
})
const message = (id, text, at = false) => ({ message_id: id, user_id: 10001, time: 9999999999, message: [...(at ? [{ type: 'at', data: { qq: '30001' } }] : []), { type: 'text', data: { text } }] })
const assistant = (sid, turn, text, interrupted = false) => event({ id: sid }, { type: 'assistant/message', data: { turn, interrupted, message: { content: [{ type: 'text', text }] } } })
const end = (sid, turn, kind = 'completed') => event({ id: sid }, { type: 'turn/end', data: { turn, reason: { kind } } })
const settle = () => new Promise((r) => setTimeout(r, 30))
const reply = async (sid, turn, text) => { sent.length = 0; assistant(sid, turn, text); end(sid, turn); await settle(); return sent.map((s) => s.action) }
const post = async (body) => {
  const req = [JSON.stringify(body)]; req.method = 'POST'
  let result
  await routes.get('/dsh-qq-bridge/save')(req, { setHeader() {}, end: (s) => { result = JSON.parse(s) } })
  return result
}

privateMessages = [message(1, 'private fixture')]
groupMessages = [message(1, 'group fixture', true)]
await poll()
assert.deepEqual(received.map((x) => x.id), ['P', 'G'], 'both inputs separated, including equal message IDs')
assert.match(received[1].m.content[0].text, /这条要接/)
assert.match(received[1].m.content[0].text, /不可信素材/)
assert.deepEqual(await reply('G', 1, 'group response'), ['send_group_msg'])
assert.deepEqual(await reply('P', 1, 'private response'), ['send_private_msg'])
assert.deepEqual(await reply('D', 1, 'desktop response'), ['send_private_msg'])
save({ 转群: true })
assert.deepEqual(await reply('D', 2, 'mirror response'), ['send_private_msg', 'send_group_msg'])
assert.deepEqual(await reply('P', 2, 'private response'), ['send_private_msg'])
assert.deepEqual(await reply('G', 2, 'group response'), ['send_group_msg'])
sent.length = 0
assistant('P', 10, 'private interleaved'); assistant('G', 10, 'group interleaved')
end('P', 10); end('G', 10); await settle()
assert.deepEqual(sent.map((s) => [s.action, s.message[0].data.text]), [['send_private_msg', 'private interleaved'], ['send_group_msg', 'group interleaved']])
end('P', 10); end('G', 10); await settle(); assert.equal(sent.length, 2)
assert.deepEqual(await reply('G', 11, '[引用:123456] group [face:14]'), ['send_group_msg', 'send_group_msg'])
assert.equal(sent[0].message[0].type, 'reply')
assert.deepEqual(await reply('P', 11, '[引用:123456] private [face:14]'), ['send_private_msg', 'send_private_msg'])
assert.ok(sent.every((s) => s.message.every((m) => m.type !== 'reply')))
for (const [direction, action] of [['private', 'send_private_msg'], ['group', 'send_group_msg']]) {
  sent.length = 0
  await api.发到QQ((await api.概况()).配置, '![fixture](https://example.invalid/mock.png)', [], direction)
  assert.deepEqual(sent.map((s) => s.action), [action])
  assert.equal(sent[0].message[0].type, 'image')
}
sent.length = 0
assistant('P', 12, 'discard'); assistant('G', 12, 'keep'); assistant('P', 12, '', true)
end('P', 12); end('G', 12); await settle(); assert.equal(sent.length, 1); assert.equal(sent[0].action, 'send_group_msg')
sent.length = 0
assistant('P', 13, 'keep'); assistant('G', 13, 'discard'); end('G', 13, 'failed'); end('P', 13)
await settle(); assert.equal(sent.length, 1); assert.equal(sent[0].action, 'send_private_msg')

for (const patch of [{ 群会话: 'P' }, { 私聊会话: 'D' }, { 群会话: 'session-P' }]) {
  const before = readFileSync(path, 'utf8')
  assert.equal((await post(patch)).ok, false)
  assert.equal(readFileSync(path, 'utf8'), before)
}
save({ 目标会话: '', 私聊会话: '', 群会话: '' })
privateMessages = [message(2, 'create private')]; groupMessages = [message(2, 'create group', true)]
// 等待现有群聊三秒节流窗口；不接触真实计时器或 NapCat。
await new Promise((r) => setTimeout(r, 3050))
await poll()
let stored = JSON.parse(readFileSync(path, 'utf8'))
assert.ok(stored.私聊会话 && stored.群会话)
assert.notEqual(stored.私聊会话, stored.群会话)
assert.equal(created, 2)
assert.deepEqual(received.slice(-2).map((x) => x.id), [stored.私聊会话, stored.群会话])
save({ 私聊会话: 'D', 群会话: 'D' })
assert.deepEqual(await reply('D', 20, 'blocked conflict'), [])
privateMessages = [message(3, 'split private')]; groupMessages = [message(3, 'split group', true)]
await new Promise((r) => setTimeout(r, 3050)); await poll()
stored = JSON.parse(readFileSync(path, 'utf8'))
assert.equal(new Set([stored.目标会话, stored.私聊会话, stored.群会话]).size, 3)
assert.ok(readdirSync(home).filter((x) => x.startsWith('qq-bridge-config.before-routing-')).some((x) => JSON.parse(readFileSync(join(home, x))).私聊会话 === 'D'))
assert.ok(agents.has('D'), 'old session retained')
save(); delete config.收群; delete config.收私聊; writeFileSync(path, JSON.stringify(config))
const state = await api.概况(); assert.equal(state.配置.收群, true); assert.equal(state.配置.收私聊, true)
failPrivate = true; groupMessages = [message(4, 'group independent', true)]
await new Promise((r) => setTimeout(r, 3050)); await poll()
assert.equal(received.at(-1).id, 'G')
save({ 转私聊: false, 转群: false })
failPrivate = false
privateMessages = [message(5, 'private without mirror')]
await poll()
assert.equal(received.at(-1).id, 'P')
assert.deepEqual(await reply('P', 30, '[face:14]'), ['send_private_msg'])
assert.deepEqual(await reply('D', 30, 'no mirrors'), [])
save({ 收私聊: false, 收群: false }); calls.length = 0; await poll(); assert.equal(calls.length, 0)
console.log('PASS 路由隔离：接收、镜像、并发、去重、表情引用、创建、冲突迁移、默认兼容、通道故障隔离')
// 保留临时目录，不永久删除测试文件。
