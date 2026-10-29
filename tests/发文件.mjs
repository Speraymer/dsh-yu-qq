// 「发文件 / 发图」自测 —— 假 ctx / 假后端，把「DSH → QQ 送东西」这条路跑一遍。
// 验的是：
//   1) 正文语法：`[文件:名字](路径)` 抠出来，`[文件](路径)` 也能认，网络地址不吞
//   2) 文件白名单：工作区里的 .docx 发得出去；.env 这类配置不发；工作区外的路径不发
//   3) 大小：超过上限不发
//   4) 走的是 upload_private_file / upload_group_file（不是消息段），file 是绝对路径
//   5) 后端不收本地路径时，≤5MB 的文件退回 base64
//   6) 图片白名单已放开到工作区 —— 但**不是真图片**（改后缀的假图）发不出去
//   7) 一轮里：文字先、文件后
// 跑法： node tests/发文件.mjs

import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'qq-bridge-sendfile-'))
process.env.DSH_HOME = 家

const 工作区 = join(家, 'ws')
const 外面 = join(家, '外面')
mkdirSync(工作区, { recursive: true })
mkdirSync(外面, { recursive: true })

// 真 PNG（够过文件头检查就行）
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])
writeFileSync(join(工作区, '报告.docx'), Buffer.from('PK\u0003\u0004假的 docx 内容'))
writeFileSync(join(工作区, '真图.png'), PNG)
writeFileSync(join(工作区, '假图.png'), Buffer.from('这其实是文本，只是后缀叫 png'))
writeFileSync(join(工作区, '.env'), Buffer.from('DEEPSEEK_KEY=sk-xxx'))
writeFileSync(join(外面, '别人的.txt'), Buffer.from('不在工作区里'))
writeFileSync(join(工作区, '大.pdf'), Buffer.alloc(21 * 1024 * 1024, 0x20))

writeFileSync(
  join(家, 'qq-bridge-config.json'),
  JSON.stringify({
    总开关: true, 试运行: false, 目标会话: 'session-X', 私聊会话: 'session-P', 私聊QQ: '123',
    群号: '100000001', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
    发文件: true, 发文件最多: 3, 发文件上限MB: 20,
  }, null, 2),
  'utf8',
)

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

// 假 fetch：记下每次 POST。`拒绝本地路径` 打开时，upload_* 收到绝对路径先失败一次，逼它走 base64。
const 发了 = []
let 拒绝本地路径 = false
globalThis.fetch = async (url, 选项) => {
  const u = String(url)
  const 体 = JSON.parse((选项 && 选项.body) || '{}')
  if (u.includes('get_login_info')) {
    return { json: async () => ({ status: 'ok', retcode: 0, data: { user_id: 10001, nickname: '测试号' } }) }
  }
  if (u.includes('msg_history')) {
    return { json: async () => ({ status: 'ok', retcode: 0, data: { messages: [] } }) }
  }
  发了.push({ url: u, 体 })
  if (拒绝本地路径 && /upload_(private|group)_file/.test(u) && !String(体.file || '').startsWith('base64://')) {
    return { json: async () => ({ status: 'failed', retcode: 1200, message: '本地路径读不到' }) }
  }
  return { json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } }) }
}

const 模 = await import(new URL('../lib/host.js', import.meta.url).href + '?v=' + Date.now())

// ---------- 纯函数 ----------
报('抠正文文件：带名字', (() => {
  const r = 模.抠正文文件('给你\n[文件:报价单.xlsx](works/报价单.xlsx)\n收好')
  return r.净文字 === '给你\n\n收好' && r.文件.length === 1 && r.文件[0].name === '报价单.xlsx' && r.文件[0].path === 'works/报价单.xlsx'
})(), JSON.stringify(模.抠正文文件('给你\n[文件:报价单.xlsx](works/报价单.xlsx)\n收好')))

报('抠正文文件：不写名字也认', (() => {
  const r = 模.抠正文文件('[文件](a.pdf)')
  return r.文件.length === 1 && r.文件[0].name === '' && r.文件[0].path === 'a.pdf'
})())

报('抠正文文件：网络地址原样留着（不去下载、也不吞掉）', (() => {
  const r = 模.抠正文文件('看这个 [文件](https://x.com/a.zip)')
  return r.净文字 === '看这个 [文件](https://x.com/a.zip)' && r.文件.length === 0
})(), JSON.stringify(模.抠正文文件('看这个 [文件](https://x.com/a.zip)')))

报('抠正文文件：多个文件都抠出来', 模.抠正文文件('[文件:a.pdf](a.pdf) 和 [文件:b.xlsx](b.xlsx)').文件.length === 2)

报('真是图片：PNG / JPEG / GIF / WEBP / BMP 认，文本不认', (() => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
  const gif = Buffer.from('GIF89a......')
  const webp = Buffer.from('RIFF....WEBP')
  const bmp = Buffer.from('BM..........')
  return 模.真是图片(PNG) && 模.真是图片(jpeg) && 模.真是图片(gif) && 模.真是图片(webp) && 模.真是图片(bmp)
    && !模.真是图片(Buffer.from('这其实是文本，只是后缀叫 png')) && !模.真是图片(null)
})(), '')

// ---------- 假 ctx ----------
const 监听 = []
const 假agent = { followup: () => {}, session: { id: 'session-X' } }
const ctx = {
  on: (名字, cb) => { if (名字 === 'session/event') 监听.push(cb); return () => {} },
  effect: (fn) => { const 摘 = fn(); return () => { try { 摘 && 摘() } catch {} } },
  webServer: { register: () => {} },
  logger: { info: () => {} },
  agents: { get: (id) => (['session-X', 'session-P'].includes(String(id)) ? 假agent : undefined) },
  sessions: { flush: async () => {} },
  interval: () => () => {},
  get: () => undefined,
  // ⭐ 工作区就是它们的「地盘」：白名单按这儿认
  workspaceRegistry: { list: () => [{ path: 工作区, sessionIds: ['session-X'] }] },
}

const 插件 = 模.apply(ctx)
const 会话 = { id: 'session-X' }
const 助手消息 = (turn, blocks) => ({ type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', content: blocks } } })
const 转完 = (turn) => ({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
const 睡 = (ms) => new Promise((r) => setTimeout(r, ms))
const 一轮 = async (turn, 文字) => {
  监听[0](会话, 助手消息(turn, [{ type: 'text', text: 文字 }]))
  监听[0](会话, 转完(turn))
  await 睡(120)
}

// ① 工作区里的 docx → upload_private_file
await 一轮(21, '做好了，文件在这\n\n[文件:报告.docx](报告.docx)')
const 上传 = 发了.filter((x) => x.url.endsWith('/upload_private_file'))
报('工作区里的 .docx → upload_private_file', 上传.length === 1, JSON.stringify(发了.map((x) => x.url)))
报('上传体：file 是绝对路径、name 用括号里写的名字', (() => {
  const b = 上传[0] && 上传[0].体
  return b && b.user_id === 123 && b.name === '报告.docx' && b.file === join(工作区, '报告.docx')
})(), JSON.stringify(上传[0] && 上传[0].体))
报('先发文字、后发文件', (() => {
  const i文 = 发了.findIndex((x) => x.url.endsWith('/send_private_msg'))
  const i文末 = 发了.map((x) => x.url).lastIndexOf('/send_private_msg')
  const i件 = 发了.findIndex((x) => x.url.endsWith('/upload_private_file'))
  return i文 >= 0 && i件 > i文末
})(), JSON.stringify(发了.map((x) => x.url)))
报('markdown 标记不会露在正文里', (() => {
  const 文 = 发了.filter((x) => x.url.endsWith('/send_private_msg')).map((x) => x.体.message[0].data.text).join(' | ')
  return !文.includes('[文件') && 文.includes('做好了')
})(), 发了.filter((x) => x.url.endsWith('/send_private_msg')).map((x) => x.体.message[0].data.text).join(' | '))

// ② .env 这类配置不发
发了.length = 0
await 一轮(22, '配置给你\n[文件:.env](.env)')
报('.env 不发（扩展名不在白名单）', 发了.filter((x) => x.url.includes('upload_')).length === 0, JSON.stringify(发了.map((x) => x.url)))

// ③ 工作区外的路径不发
发了.length = 0
await 一轮(23, '[文件:别人的.txt](' + join(外面, '别人的.txt') + ')')
报('工作区外的文件不发', 发了.filter((x) => x.url.includes('upload_')).length === 0, JSON.stringify(发了.map((x) => x.url)))

// ④ 太大不发
发了.length = 0
await 一轮(24, '[文件:大.pdf](大.pdf)')
报('超过上限（21MB > 20MB）不发', 发了.filter((x) => x.url.includes('upload_')).length === 0, JSON.stringify(发了.map((x) => x.url)))

// ⑤ 工作区里的真图能发（白名单已放开）
发了.length = 0
await 一轮(25, '画好了 ![鲸鱼娘](真图.png)')
const 图消息 = 发了.filter((x) => x.url.endsWith('/send_private_msg') && JSON.stringify(x.体).includes('"type":"image"'))
报('工作区里的真图 → image 段', 图消息.length === 1, JSON.stringify(发了.map((x) => x.url + ' ' + JSON.stringify(x.体).slice(0, 60))))

// ⑥ 改后缀的假图不发
发了.length = 0
await 一轮(26, '看这个 ![假的](假图.png)')
报('改后缀的假图不发（文件头不对）', 发了.filter((x) => JSON.stringify(x.体).includes('"type":"image"')).length === 0, JSON.stringify(发了.map((x) => JSON.stringify(x.体).slice(0, 60))))

// ⑥b 工作区外的真图也不发（白名单不是「只查文件头」）
writeFileSync(join(外面, '外面真图.png'), PNG)
发了.length = 0
await 一轮(26, '看这个 ![外面](' + join(外面, '外面真图.png') + ')')
报('工作区外的真图不发', 发了.filter((x) => JSON.stringify(x.体).includes('"type":"image"')).length === 0, JSON.stringify(发了.map((x) => x.url)))

// ⑦ 后端不收本地路径 → 退回 base64
发了.length = 0
拒绝本地路径 = true
await 一轮(27, '[文件:报告.docx](报告.docx)')
拒绝本地路径 = false
const 传们 = 发了.filter((x) => x.url.endsWith('/upload_private_file'))
报('本地路径失败 → 退回 base64', 传们.length === 2 && String(传们[1].体.file).startsWith('base64://'), JSON.stringify(传们.map((x) => String(x.体.file).slice(0, 24))))

// ⑧ 群里走 upload_group_file（要先打开「群发文件」）
发了.length = 0
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 群会话: 'session-G', 私聊QQ: '123',
  群号: '100000001', 转私聊: false, 转群: true, NapCat: 'http://127.0.0.1:3000',
  发文件: true, 发文件最多: 3, 发文件上限MB: 20, 群发文件: true,
}, null, 2), 'utf8')
const 群agent = { followup: () => {}, session: { id: 'session-G' } }
ctx.agents.get = (id) => ({ 'session-X': 假agent, 'session-G': 群agent }[String(id)])
// 群那间要「自己的出口」：让事件从 session-G 进来
const 群会话 = { id: 'session-G' }
监听[0](群会话, 助手消息(31, [{ type: 'text', text: '[文件:报告.docx](报告.docx)' }]))
监听[0](群会话, 转完(31))
await 睡(200)
const 群传 = 发了.filter((x) => x.url.endsWith('/upload_group_file'))
报('群里 → upload_group_file（带 group_id / folder / upload_file）', 群传.length === 1 && 群传[0].体.group_id === 100000001 && 群传[0].体.folder === '' && 群传[0].体.upload_file === true, JSON.stringify(群传[0] && 群传[0].体))

// ⑧b 群发文件默认关着 → 不进群
发了.length = 0
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 群会话: 'session-G', 私聊QQ: '123',
  群号: '100000001', 转私聊: false, 转群: true, NapCat: 'http://127.0.0.1:3000',
  发文件: true,
}, null, 2), 'utf8')
监听[0](群会话, 助手消息(32, [{ type: 'text', text: '做好了\n[文件:报告.docx](报告.docx)' }]))
监听[0](群会话, 转完(32))
await 睡(200)
报('群发文件默认关 → 文件不进群（文字照发）', 发了.filter((x) => x.url.includes('upload_')).length === 0 && 发了.some((x) => x.url.endsWith('/send_group_msg')), JSON.stringify(发了.map((x) => x.url)))

// ⑧c 别人的私信：文件也不发（只回主人本人）
发了.length = 0
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123',
  群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000', 发文件: true,
}, null, 2), 'utf8')
await 插件.落地一发({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123',
  转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
  发文件: true, 发文件最多: 3, 发文件上限MB: 20,
}, '[文件:报告.docx](报告.docx)', [], { private: '999' })
报('别人的私信里不把文件发出去（只回主人本人）', 发了.filter((x) => x.url.includes('upload_')).length === 0, JSON.stringify(发了.map((x) => x.url)))

// ⑨ 开关关掉就不发
发了.length = 0
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊会话: 'session-P', 私聊QQ: '123',
  群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
  发文件: false,
}, null, 2), 'utf8')
await 一轮(41, '[文件:报告.docx](报告.docx)')
报('发文件开关关掉 → 不发文件，标记也不露出来', (() => {
  const 文 = 发了.filter((x) => x.url.endsWith('/send_private_msg')).map((x) => x.体.message[0].data.text).join(' | ')
  return 发了.filter((x) => x.url.includes('upload_')).length === 0 && !文.includes('[文件')
})(), 发了.filter((x) => x.url.endsWith('/send_private_msg')).map((x) => x.体.message[0].data.text).join(' | '))

console.log(挂了 ? `\n${挂了} 条没过` : '\n全都过了')
process.exit(挂了 ? 1 : 0)
