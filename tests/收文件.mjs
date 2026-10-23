// 「收文件」自测 —— 假 ctx / 假后端把「QQ 里发来的文档」这条路跑一遍。
// 验的是：
//   1) 安全文件名：路径分隔符 / 控制字符被换掉，中文照留，超长掐断但保住扩展名
//   2) 大小话：KB / MB 说人话
//   3) 群文件（主人发的）→ 落到本地、路径进 群文件附注、并贴在素材块**外面**
//   4) 群文件（别人发的）→ 不下载、只留名字，块里没有路径
//   5) 私聊文件 → 下载、路径写进转进去的文字
//   6) 文件太大 → 不下、只在文字里说一句
//   7) 下载链接挂了 → 退回 get_file 拿后端已落地的本地文件
//   8) 同一个 file_id 不重复下
// 跑法： node tests/收文件.mjs

import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'qq-bridge-file-'))
process.env.DSH_HOME = 家

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

const 主人号 = 123
const 路人号 = 777
const 群号 = 1131553414
const PDF = Buffer.from('%PDF-1.7\n测试合集\n')

let 群消息们 = []
let 私聊消息们 = []
let 下载次数 = 0
let 直链坏了 = false
let 后端临时文件 = ''

globalThis.fetch = async (url, 选项) => {
  const u = String(url)
  const 方法 = (选项 && 选项.method) || 'GET'
  const 体 = 方法 === 'POST' ? JSON.parse((选项 && 选项.body) || '{}') : {}

  if (方法 === 'GET') {
    // 下载文件
    if (u.startsWith('https://file.example/') || u.includes('ftn.qq.com')) {
      下载次数++
      if (直链坏了) return { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) }
      if (体.big) return { ok: true, status: 200, arrayBuffer: async () => PDF.buffer.slice(PDF.byteOffset, PDF.byteOffset + PDF.byteLength) }
      return { ok: true, status: 200, arrayBuffer: async () => PDF.buffer.slice(PDF.byteOffset, PDF.byteOffset + PDF.byteLength) }
    }
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
  }

  if (u.includes('get_login_info')) return { json: async () => ({ status: 'ok', data: { user_id: 10001, nickname: '测试号' } }) }
  if (u.includes('get_friend_msg_history')) return { json: async () => ({ status: 'ok', data: { messages: 私聊消息们 } }) }
  if (u.includes('get_group_msg_history')) return { json: async () => ({ status: 'ok', data: { messages: 群消息们 } }) }
  if (u.includes('get_group_file_url') || u.includes('get_private_file_url')) {
    return { json: async () => ({ status: 'ok', data: { url: 'https://file.example/again' } }) }
  }
  if (u.includes('get_file')) return { json: async () => ({ status: 'ok', data: { file: 后端临时文件 } }) }
  return { json: async () => ({ status: 'ok', data: {} }) }
}

const 模 = await import(new URL('../lib/host.js', import.meta.url).href + '?v=' + Date.now())

// ---------- 纯函数 ----------
报('安全文件名：去掉路径分隔符和控制字符', 模.安全文件名('../../etc/密件: 一.docx') === '.._.._etc_密件_ 一.docx', 模.安全文件名('../../etc/密件: 一.docx'))
报('安全文件名：空的用兜底', 模.安全文件名('') === 'file' && 模.安全文件名('   ') === 'file')
报('安全文件名：超长掐断但保住扩展名', (() => {
  const n = 模.安全文件名('长'.repeat(200) + '.pdf')
  return n.length === 80 && n.endsWith('.pdf')
})(), String(模.安全文件名('长'.repeat(200) + '.pdf').length))
报('大小话：KB / MB', 模.大小话(395174) === '386KB' && 模.大小话(3 * 1048576) === '3.0MB', 模.大小话(395174) + ' / ' + 模.大小话(3 * 1048576))

// ---------- 假 ctx ----------
const 路由 = new Map()
const 转进的 = []
let 轮询回调 = null
const 假agent = { followup: (m) => 转进的.push(m), session: { id: 'session-X' } }
const ctx = {
  on: () => () => {},
  effect: (fn) => { const 摘 = fn(); return () => { try { 摘 && 摘() } catch {} } },
  webServer: { register: (o) => 路由.set(o.path, o.handler) },
  logger: { info: () => {} },
  agents: { get: (id) => (['session-P', 'session-G'].includes(String(id)) ? 假agent : undefined) },
  sessions: { flush: async () => {} },
  interval: (fn) => { 轮询回调 = fn; return () => {} },
  get: () => undefined,
}
const 写配置 = (改 = {}) => writeFileSync(
  join(家, 'qq-bridge-config.json'),
  JSON.stringify({
    总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: String(主人号), 群号: String(群号),
    指令QQ: String(主人号), 转私聊: true, 转群: true, NapCat: 'http://127.0.0.1:3000',
    群会话: 'session-G', 私聊会话: 'session-P', 收图: true, 收文件: true,
    群接话: 'always', // 测试里要确定性：每批都开，不掷骰
    ...改,
  }, null, 2),
  'utf8',
)
写配置()
模.apply(ctx)
报('轮询挂上了', typeof 轮询回调 === 'function')

// 每条消息的时间都往未来推，保证被当成「新的」
let 时间 = Math.floor(Date.now() / 1000) + 1000
const 群条 = (user, 段们, 名 = '谁') => ({
  message_id: Math.floor(Math.random() * 1e9), user_id: user, time: 时间++, group_id: 群号,
  sender: { user_id: user, nickname: 名, card: '' }, message_type: 'group', message: 段们,
})
const 文件段 = (名, id, 大小, url = 'https://file.example/x') => ({
  type: 'file', data: { file: 名, file_id: id, file_size: String(大小), url },
})
const 收一轮 = async () => { await 轮询回调(); await new Promise((r) => setTimeout(r, 30)) }
const 最后正文 = () => (转进的.length ? String(转进的.at(-1).content[0].text) : '')

// ① 群文件：主人发的 → 落到本地，路径贴在素材块外面
群消息们 = [群条(主人号, [文件段('测试合集-2026-10-23.pdf', '/id-1', PDF.length)], 'Speraymer')]
转进的.length = 0
await 收一轮()          // 攒进 群待转
await 收一轮()          // 掷骰 / 开轮
const 文1 = 最后正文()
报('群文件：主人发的 → 转进了一条', 转进的.length === 1, JSON.stringify(转进的.length))
报('群文件：真的有落盘', /qq-bridge-inbox[\\/]文件[\\/]/.test(文1) && 文1.includes('.pdf'), 文1.slice(0, 400))
const 落的 = 文1.match(/→\s*([^\s；]+\.pdf)/)
报('群文件：本地文件确实存在', 落的 && existsSync(落的[1]), 落的 && 落的[1])
报('群文件：内容对得上', 落的 && readFileSync(落的[1]).equals(PDF))
报('群文件：路径在 <QQ_GROUP_CONTENT> 外面', (() => {
  const 闭 = 文1.indexOf('</QQ_GROUP_CONTENT>')
  const 路径 = 文1.indexOf('→ ')
  return 闭 > 0 && 路径 > 闭
})(), 文1.slice(Math.max(0, 文1.indexOf('</QQ_GROUP_CONTENT>')), 文1.indexOf('</QQ_GROUP_CONTENT>') + 120))
报('群文件：块里只有「发了文件」这句话、没有路径', /发了文件：测试合集-2026-10-23\.pdf，\d+KB/.test(文1))
报('群文件：块外那句写了「可以读」', 文1.includes('可以读'))

// ② 同一个 file_id 又发一次 → 不重下，但路径还得给
const 之前下载 = 下载次数
群消息们 = [群条(主人号, [文件段('测试合集-2026-10-23.pdf', '/id-1', PDF.length)], 'Speraymer')]
转进的.length = 0
await 收一轮(); await 收一轮()
报('同一个 file_id 不重复下', 下载次数 === 之前下载, String(下载次数))
报('同一个 file_id 重发 → 路径还在（不让人白等一句「刚收过」）', 最后正文().includes('→ ') && 最后正文().includes('.pdf'), 最后正文().slice(-200))

// ③ 群里路人发的文件 → 不下、只留名字
const 之前下载2 = 下载次数
群消息们 = [群条(路人号, [文件段('秘密.pdf', '/id-2', 100)], '路人')]
转进的.length = 0
await 收一轮(); await 收一轮()
const 文3 = 最后正文()
报('路人文件：不下载', 下载次数 === 之前下载2, String(下载次数))
报('路人文件：只留名字', 文3.includes('秘密.pdf') && 文3.includes('不是主人发的没下'), 文3.slice(0, 200))

// ④ 私聊文件 → 路径写进正文
转进的.length = 0
私聊消息们 = [{
  message_id: 7001, user_id: 主人号, time: 时间++, message_type: 'private',
  sender: { user_id: 主人号, nickname: '主人' },
  message: [文件段('周报.docx', '/id-3', PDF.length)],
}]
await 收一轮()
const 文4 = 最后正文()
报('私聊文件：转进去了', 转进的.length === 1, JSON.stringify(文4.slice(0, 200)))
报('私聊文件：带本地路径', /发来文件：周报\.docx/.test(文4) && /文件[\\/]7001-周报\.docx/.test(文4), 文4.slice(0, 300))

// ⑤ 太大 → 不下
转进的.length = 0
私聊消息们 = [{
  message_id: 7002, user_id: 主人号, time: 时间++, message_type: 'private',
  sender: { user_id: 主人号, nickname: '主人' },
  message: [文件段('超大的.zip', '/id-4', 30 * 1024 * 1024)],
}]
await 收一轮()
报('太大：不下、只在文字里说一句', /太大/.test(最后正文()) && !/文件[\\/]7002/.test(最后正文()), 最后正文().slice(0, 200))

// ⑥ 直链坏了 → 退回 get_file 的本地临时文件
const 临时 = join(家, 'napcat-temp', '兜底.pdf')
mkdirSync(join(家, 'napcat-temp'), { recursive: true })
writeFileSync(临时, PDF)
直链坏了 = true
后端临时文件 = 临时
转进的.length = 0
私聊消息们 = [{
  message_id: 7003, user_id: 主人号, time: 时间++, message_type: 'private',
  sender: { user_id: 主人号, nickname: '主人' },
  message: [文件段('兜底.pdf', '/id-5', PDF.length)],
}]
await 收一轮()
报('直链挂了 → 退回 get_file 的本地文件', /发来文件：兜底\.pdf/.test(最后正文()) && /文件[\\/]7003-兜底\.pdf/.test(最后正文()), 最后正文().slice(0, 300))
直链坏了 = false

// ⑦ 一条就来一个文件、没有文字：也不该被当空消息丢掉
转进的.length = 0
私聊消息们 = [{
  message_id: 7004, user_id: 主人号, time: 时间++, message_type: 'private',
  sender: { user_id: 主人号, nickname: '主人' },
  message: [文件段('只发文件.txt', '/id-6', PDF.length)],
}]
await 收一轮()
报('只有文件、没有文字：照样转', 转进的.length === 1 && 最后正文().includes('只发文件.txt'), 最后正文().slice(0, 200))

// 保留临时测试目录，便于回滚和排查。
console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
