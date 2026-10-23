// 多群：两个群同时盯，各自一间会话、各自回各自的群。
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'qq-multigroup-'))
process.env.DSH_HOME = home
const path = join(home, 'qq-bridge-config.json')

const save = (patch = {}) => writeFileSync(path, JSON.stringify({
  总开关: true, 试运行: false, 收群: true, 收私聊: false, 转群: false,
  目标会话: '', 私聊会话: '', 群会话: '', 群号: '20001,20002',
  群接话: 'always', 群会话表: {}, QQ会话目录: join(home, 'sessions'),
  ...patch,
}))

const sent = [], received = []
let groupMsgs = { 20001: [], 20002: [] }
const fetchMock = async (url, options) => {
  const action = new URL(url).pathname.slice(1)
  const body = JSON.parse(options.body)
  let data = {}
  if (action.startsWith('send_')) sent.push({ action, ...body })
  else if (action === 'get_login_info') data = { user_id: 30001 }
  else if (action === 'get_group_msg_history') data = { messages: groupMsgs[String(body.group_id)] || [] }
  else if (action === 'get_friend_msg_history') data = { messages: [] }
  else throw Error('unexpected ' + action)
  return { json: async () => ({ status: 'ok', retcode: 0, data }) }
}
globalThis.fetch = fetchMock

const { apply, 群号们 } = await import('../lib/host.js')
assert.deepEqual(群号们({ 群号: '20001, 20002 20001' }), ['20001', '20002'], '群号去重解析')

const agents = new Map()
const add = (id) => agents.set(id, { session: { id }, followup: async (m) => received.push({ id, m }) })
let created = 0
let poll, event
const routes = new Map()
save()
const api = apply({
  agents: { get: (id) => agents.get(id) },
  sessions: { flush: async () => {} },
  get: (key) => key === 'sessionController'
    ? { create: async () => { const sessionId = 'mg-' + (++created); add(sessionId); return { sessionId } } }
    : undefined,
  webServer: { register: ({ path, handler }) => routes.set(path, handler) },
  on: (name, cb) => { event = cb; return () => {} },
  effect: (fn) => fn(),
  interval: (fn) => { poll = fn; return () => {} },
  logger: { info() {} },
})

const msg = (id, text) => ({ message_id: id, user_id: 10001, time: 9999999999, message: [{ type: 'text', data: { text } }] })
groupMsgs = { 20001: [msg(11, '群一的活')], 20002: [msg(12, '群二的活')] }

await poll()
await new Promise((r) => setTimeout(r, 50))

assert.equal(received.length, 2, '两个群各开一轮')
const 群一会话 = received[0].id
const 群二会话 = received[1].id
assert.notEqual(群一会话, 群二会话, '两个群各自一间会话')
assert.match(received[0].m.content[0].text, /群一的活/)
assert.match(received[1].m.content[0].text, /群二的活/)

const 回一轮 = async (sid, turn, text) => {
  sent.length = 0
  event({ id: sid }, { type: 'assistant/message', data: { turn, interrupted: false, message: { content: [{ type: 'text', text }] } } })
  event({ id: sid }, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  await new Promise((r) => setTimeout(r, 40))
  return sent.map((s) => [s.action, String(s.group_id || '')])
}
assert.deepEqual(await 回一轮(群一会话, 1, '回群一'), [['send_group_msg', '20001']])
assert.deepEqual(await 回一轮(群二会话, 2, '回群二'), [['send_group_msg', '20002']])

const 状态 = await api.概况()
assert.deepEqual(状态.配置.群号.split(','), ['20001', '20002'])
console.log('PASS 多群：解析、各自会话、各自回群')



