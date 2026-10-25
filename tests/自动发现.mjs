// 自动发现（新群 / 新私聊）+ 断点水位 + 开机补课
// 场景一：只手填了一个群、一个私聊，剩下的靠 NapCat 自己报上来
// 场景二：重启后从落盘水位接着收，不重复转
// 场景三：停机一小时，私聊上线即补回，群补课仍静音
// 场景四：首投失败不丢消息、不重复建会话，下一轮自动重试
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------- 假 NapCat ----------
const 造后端 = () => {
  const 状态 = {
    群列表: [{ group_id: 20001, group_name: '一群' }, { group_id: 20002, group_name: '二群' }],
    最近: [{ chatType: 1, peerUin: '10001' }, { chatType: 1, peerUin: '10002' }],
    私聊历史: {},
    群历史: {},
    发出: [],
    失败动作: new Set(),
    失败私聊号: new Set(),
    失败私聊次数: new Map(),
    消息详情: {},
    请求: [],
  }
  globalThis.fetch = async (url, options) => {
    状态.请求.push(String(url))
    const action = new URL(url).pathname.slice(1)
    const body = JSON.parse((options && options.body) || '{}')
    if (状态.失败动作.has(action)) throw new Error('模拟 NapCat 尚未上线：' + action)
    if (action === 'get_friend_msg_history' && 状态.失败私聊号.has(String(body.user_id))) throw new Error('模拟单个私聊历史失败')
    if (action === 'get_friend_msg_history' && (状态.失败私聊次数.get(String(body.user_id)) || 0) > 0) {
      状态.失败私聊次数.set(String(body.user_id), 状态.失败私聊次数.get(String(body.user_id)) - 1)
      throw new Error('模拟私聊历史瞬时失败')
    }
    let data = {}
    if (action.startsWith('send_')) {
      状态.发出.push({ action, ...body })
      return { json: async () => ({ status: 'ok', retcode: 0, data: {} }) }
    }
    if (action === 'get_login_info') data = { user_id: 30001 }
    else if (action === 'get_group_list') data = 状态.群列表
    else if (action === 'get_recent_contact') data = 状态.最近
    else if (action === 'get_group_msg_history') data = { messages: 状态.群历史[String(body.group_id)] || [] }
    else if (action === 'get_friend_msg_history') data = { messages: 状态.私聊历史[String(body.user_id)] || [] }
    else if (action === 'get_msg') data = 状态.消息详情[String(body.message_id)] || null
    return { json: async () => ({ status: 'ok', retcode: 0, data }) }
  }
  return 状态
}

const 造宿主 = async (home, 收到, { 失败一次 = false, 不自动挂 = false } = {}) => {
  const agents = new Map()
  let 还失败 = 失败一次
  const 加 = (id) => agents.set(id, { session: { id }, followup: async (m) => {
    if (还失败) { 还失败 = false; throw new Error('模拟会话尚未就绪') }
    收到.push({ id, m })
  } })
  let poll = null
  let event = null
  let created = 0
  let 最后会话 = ''
  const 已建 = []
  const 标题 = []
  const 模 = await import('../lib/host.js?v=' + Date.now() + Math.random())
  const api = 模.apply({
    agents: { get: (id) => agents.get(id) },
    sessions: { flush: async () => {} },
    get: (key) => key === 'sessionController'
      ? {
          create: async () => { const sessionId = 'auto-' + (++created); 已建.push(sessionId); 最后会话 = sessionId; if (!不自动挂) 加(sessionId); return { sessionId } },
          rename: async (x) => 标题.push(x),
        }
      : key === 'sessions' ? { list: () => 已建.map((id) => ({ id })) }
      : key === 'sessionTitle' ? { get: () => ({ title: '' }) }
      : undefined,
    webServer: { register: () => {} },
    on: (name, fn) => { if (name === 'session/event') event = fn; return () => {} },
    effect: (fn) => fn(),
    interval: (fn) => { poll = fn; return () => {} },
    logger: { info() {} },
  })
  return { api, poll: () => poll(), emit: (sid, e) => event({ id: sid }, e), 挂上最后会话: () => 加(最后会话), 会话数: () => created, 标题 }
}

const 写配置 = (home, 改 = {}) => writeFileSync(join(home, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 收群: true, 收私聊: true,
  目标会话: '', 私聊QQ: '10001', 群号: '20001', 私聊会话: '', 群会话: '',
  群接话: 'always', QQ会话目录: join(home, 'sessions'),
  ...改,
}), 'utf8')

const 群条 = (id, who, text, time) => ({
  message_id: id, user_id: who, time, message_type: 'group',
  sender: { user_id: who, nickname: '谁' + who, card: '' },
  message: [{ type: 'text', data: { text } }],
})
const 私聊条 = (id, who, text, time) => ({
  message_id: id, user_id: who, time, message_type: 'private',
  sender: { user_id: who, nickname: '谁' + who, card: '' },
  message: [{ type: 'text', data: { text } }],
})

// ================= 场景一：自动发现 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-auto-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  后端.私聊历史['10001'] = [私聊条(1, 10001, '主人说话', 现在 + 10)]
  后端.私聊历史['10002'] = [
    私聊条(2, 10002, '陌生人说话第一句', 现在 + 11),
    私聊条(6, 10002, '陌生人说话第二句', 现在 + 12),
  ]
  后端.群历史['20001'] = [群条(3, 40001, '一群的活', 现在 + 12)]
  后端.群历史['20002'] = [群条(4, 40002, '二群的活', 现在 + 13)]
  写配置(home)

  const 宿主 = await 造宿主(home, 收到)
  await 宿主.poll()
  await new Promise((r) => setTimeout(r, 60))

  const 正文 = 收到.map((x) => String(x.m.content[0].text))
  assert.equal(收到.length, 5, '主人私信 + 新私聊两条 + 两个群，全部转入：' + JSON.stringify(正文.map((t) => t.slice(0, 20))))
  assert.ok(正文.some((t) => t.includes('陌生人说话第一句')), '没手填的私聊也要自动收')
  assert.ok(正文.some((t) => t.includes('陌生人说话第二句')), '同批私信不能被水位吞掉')
  assert.ok(正文.filter((t) => t.includes('陌生人说话')).every((t) => t.includes('不是主人')), '新联系人要带主人边界')
  assert.ok(正文.some((t) => t.includes('二群的活')), '没手填的群也要自动收')
  assert.equal(宿主.会话数(), 4, '四间会话全是自动建的')
  assert.equal(new Set(收到.map((x) => x.id)).size, 4, '每间会话互不相同')
  assert.equal(宿主.标题.length, 4, '新会话都要设置可识别标题')
  assert.ok(宿主.标题.some((x) => /QQ 私聊 10002/.test(x.title)), '新联系人会话标题可识别')
  assert.ok(宿主.标题.some((x) => /QQ 群 20002/.test(x.title)), '新群会话标题可识别')

  // 水位落盘
  const 状态路径 = join(home, 'qq-bridge-state.json')
  assert.ok(existsSync(状态路径), '水位文件要落盘')
  const 水位 = JSON.parse(readFileSync(状态路径, 'utf8')).水位
  for (const 键 of ['friend:10001', 'friend:10002', 'group:20001', 'group:20002']) {
    assert.ok(水位[键] > 0, '要有 ' + 键 + ' 的水位')
  }

  // ================= 场景二：重启接着收，不重复 =================
  收到.length = 0
  const 宿主2 = await 造宿主(home, 收到)
  await 宿主2.poll()
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(收到.length, 0, '重启后同一条消息不能再转一遍')

  // 新消息还是能收
  后端.群历史['20002'].push(群条(5, 40002, '重启之后的新话', 现在 + 100))
  await 宿主2.poll()
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(收到.length, 1, '新消息照收')
  assert.match(String(收到[0].m.content[0].text), /重启之后的新话/)

  // 同一间会话接着用，不重建
  const 表 = JSON.parse(readFileSync(join(home, 'qq-bridge-config.json'), 'utf8'))
  assert.ok(表.群会话表['20002'] || 表.群会话表['20001'], '会话映射要写回配置')
}

// ================= 场景三：开机补课 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-makeup-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  const 断档前 = 现在 - 3600
  后端.群历史['20001'] = [
    群条(11, 40001, '你不在的时候第一句', 断档前 + 600),
    群条(12, 40001, '你不在的时候第二句', 断档前 + 900),
  ]
  后端.私聊历史['10001'] = [私聊条(13, 10001, '私聊这边也攒了一句', 断档前 + 1200)]
  写配置(home, { 群号: '20001', 私聊QQ: '10001' })
  writeFileSync(join(home, 'qq-bridge-state.json'), JSON.stringify({
    水位: { 'friend:10001': 断档前 - 100, 'group:20001': 断档前 - 100 },
    上次存活: 断档前,
  }), 'utf8')

  const 宿主 = await 造宿主(home, 收到)
  await new Promise((r) => setTimeout(r, 3600))   // 补课在 3 秒后自己跑
  await new Promise((r) => setTimeout(r, 200))

  const 群补 = 收到.filter((x) => /你不在的时候/.test(String(x.m.content[0].text)))
  const 私补 = 收到.filter((x) => /私聊这边也攒了一句/.test(String(x.m.content[0].text)))
  assert.equal(群补.length, 1, '群那批合并成一条')
  assert.equal(私补.length, 1, '私聊那边也补一条')
  assert.match(String(群补[0].m.content[0].text), /离线补课/)
  assert.match(String(群补[0].m.content[0].text), /第一句[\s\S]*第二句/, '两条都要在，别只补最后一条')
  assert.match(String(群补[0].m.content[0].text), /不用逐条回复/)
  assert.match(String(私补[0].m.content[0].text), /上线后发现的未读私信/)
  assert.match(String(私补[0].m.content[0].text), /现在直接回复/)
  assert.doesNotMatch(String(私补[0].m.content[0].text), /别主动发/)
  assert.equal(后端.发出.length, 0, '测试桩不产生 assistant 回话，不能凭空发 QQ')

  // 补完水位推到最新，恢复正常轮询不会重复补
  收到.length = 0
  await 宿主.poll()
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(收到.length, 0, '补过的消息不能再转一遍')
}

// 群批次同样要在 followup 成功后才算处理完。
{
  const home = mkdtempSync(join(tmpdir(), 'qq-group-retry-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  后端.群列表 = [{ group_id: 20001, group_name: '一群' }]
  后端.群历史['20001'] = [群条(31, 40001, '群首投失败也别丢', 现在 + 10)]
  写配置(home, { 收私聊: false, 私聊QQ: '', 自动收私聊: false, 补课: false })

  const 宿主 = await 造宿主(home, 收到, { 失败一次: true })
  await 宿主.poll()
  assert.equal(收到.length, 0, '群第一次模拟投递失败')
  await 宿主.poll()
  assert.equal(收到.length, 1, '群批次下一轮必须自动重试')
  assert.equal(宿主.会话数(), 1, '群重试沿用原会话')
  assert.match(String(收到[0].m.content[0].text), /群首投失败也别丢/)
}

// @ 别人的话只留作上下文，不能单独触发 DSH；随后 @ DSH 时再连同上下文一起交给它。
{
  const home = mkdtempSync(join(tmpdir(), 'qq-addressee-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  写配置(home, { 收私聊: false, 私聊QQ: '', 自动收私聊: false, 补课: false })
  const 对别人 = 群条(41, 40001, '你看看这个', 现在 + 10)
  对别人.message.unshift({ type: 'at', data: { qq: '40002' } })
  后端.群历史['20001'] = [对别人]

  const 宿主 = await 造宿主(home, 收到)
  await 宿主.poll()
  assert.equal(收到.length, 0, '@ 别人的话不能误触发 DSH')

  const 对DSH = 群条(42, 40001, '你怎么看', 现在 + 11)
  对DSH.message.unshift({ type: 'at', data: { qq: '30001' } })
  后端.群历史['20001'].push(对DSH)
  await 宿主.poll()
  assert.equal(收到.length, 1, '@ DSH 后才开一轮')
  const 文 = String(收到[0].m.content[0].text)
  assert.match(文, /\[对象:别人\][\s\S]*\[对象:你\]/)
}

// ================= 场景四：失败后重试 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-retry-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  后端.最近 = [{ chatType: 1, peerUin: '10001' }]
  后端.群列表 = []
  后端.私聊历史['10001'] = [私聊条(21, 10001, '首投失败也别丢', 现在 + 10)]
  写配置(home, { 收群: false, 自动收群: false, 自动收私聊: false, 补课: false })

  const 宿主 = await 造宿主(home, 收到, { 失败一次: true })
  await 宿主.poll()
  assert.equal(收到.length, 0, '第一次模拟投递失败')
  await 宿主.poll()
  assert.equal(收到.length, 1, '下一轮必须自动重试')
  assert.equal(宿主.会话数(), 1, '重试沿用原会话，不能再开一间')
  assert.match(String(收到[0].m.content[0].text), /首投失败也别丢/)
}

// ================= 场景五：按语义回发学到的大表情 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-sticker-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  后端.群列表 = []
  后端.最近 = [{ chatType: 1, peerUin: '10001' }]
  后端.私聊历史['10001'] = [私聊条(51, 10001, '发个得意表情', 现在 + 10)]
  写配置(home, { 收群: false, 自动收群: false, 自动收私聊: false, 补课: false })
  writeFileSync(join(home, 'qq-bridge-stickers.json'), JSON.stringify({
    x: { id: 'mface-x', 名: '得意', 类型: 'mface', url: 'https://gchat.qpic.cn/sticker.gif', 次数: 2 },
  }), 'utf8')

  const 宿主 = await 造宿主(home, 收到)
  await 宿主.poll()
  const sid = 收到[0].id
  assert.match(String(收到[0].m.content[0].text), /得意/)
  宿主.emit(sid, { type: 'assistant/message', data: { turn: 1, interrupted: false, message: { content: [{ type: 'text', text: '[表情:得意]' }] } } })
  宿主.emit(sid, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await new Promise((r) => setTimeout(r, 50))
  const 发 = 后端.发出.find((x) => x.action === 'send_private_msg')
  assert.equal(发.message[0].type, 'image')
  assert.equal(发.message[0].data.url, 'https://gchat.qpic.cn/sticker.gif')
}

// ================= 场景六：NapCat 晚上线仍补回陌生人私信 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-late-napcat-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  const 断档前 = 现在 - 3600
  后端.最近 = [{ chatType: 1, peerUin: '10002' }]
  后端.群列表 = []
  后端.私聊历史['10001'] = []
  后端.私聊历史['10002'] = [私聊条(61, 10002, '你离线时我来过', 现在 - 600)]
  后端.失败动作.add('get_recent_contact')
  写配置(home, { 收群: false, 自动收群: false, 补课: true })
  writeFileSync(join(home, 'qq-bridge-state.json'), JSON.stringify({ 水位: {}, 上次存活: 断档前 }), 'utf8')

  const 宿主 = await 造宿主(home, 收到)
  await new Promise((r) => setTimeout(r, 3300))
  assert.equal(收到.length, 0, 'NapCat 未上线时不能把失败结算成无消息')
  后端.失败动作.clear()
  await 宿主.poll()
  assert.equal(收到.length, 1, 'NapCat 恢复后立刻补回陌生人私信')
  assert.match(String(收到[0].m.content[0].text), /你离线时我来过/)
  assert.match(String(收到[0].m.content[0].text), /上线后发现的未读私信/)
  await 宿主.poll()
  assert.equal(收到.length, 1, '补过的离线私信不能重复')
}

// ================= 场景七：agent 延迟挂载不重复开窗口 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-late-agent-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  后端.群列表 = []
  后端.最近 = [{ chatType: 1, peerUin: '10001' }]
  后端.私聊历史['10001'] = [私聊条(71, 10001, '等窗口准备好再收我', 现在 + 10)]
  写配置(home, { 收群: false, 自动收群: false, 自动收私聊: false, 补课: false })

  const 宿主 = await 造宿主(home, 收到, { 不自动挂: true })
  await 宿主.poll()
  assert.equal(宿主.会话数(), 1, '只创建一次会话')
  await 宿主.poll()
  assert.equal(宿主.会话数(), 1, 'agent 未就绪时不能再建空会话')
  宿主.挂上最后会话()
  await 宿主.poll()
  assert.equal(宿主.会话数(), 1)
  assert.equal(收到.length, 1, 'agent 就绪后首条消息仍会投递')
}

// ================= 场景八：恶意 mface 地址不下载 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-mface-safe-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  const 条 = 私聊条(81, 10001, '', 现在 + 10)
  条.message = [{ type: 'mface', data: { summary: '坏表情', url: 'http://169.254.169.254/latest/meta-data' } }]
  后端.群列表 = []
  后端.最近 = [{ chatType: 1, peerUin: '10001' }]
  后端.私聊历史['10001'] = [条]
  写配置(home, { 收群: false, 自动收群: false, 自动收私聊: false, 补课: false })

  const 宿主 = await 造宿主(home, 收到)
  await 宿主.poll()
  assert.equal(后端.请求.some((u) => u.includes('169.254.169.254')), false)
  assert.equal(收到.length, 0, '不安全大表情既不下载也不交给模型')
}

// ================= 场景九：一个联系人失败不能卡死其他 QQ =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-partial-catchup-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  const 断档前 = 现在 - 3600
  后端.群列表 = []
  后端.最近 = [{ chatType: 1, peerUin: '10001' }, { chatType: 1, peerUin: '10002' }]
  后端.私聊历史['10001'] = [私聊条(91, 10001, '正常联系人先补回来', 现在 - 600)]
  后端.私聊历史['10002'] = [私聊条(92, 10002, '坏通道恢复后再补', 现在 - 500)]
  后端.失败私聊号.add('10002')
  写配置(home, { 收群: false, 自动收群: false, 自动收私聊: true, 补课: true })
  writeFileSync(join(home, 'qq-bridge-state.json'), JSON.stringify({ 水位: {}, 上次存活: 断档前 }), 'utf8')

  const 宿主 = await 造宿主(home, 收到)
  await new Promise((r) => setTimeout(r, 3300))
  assert.equal(收到.filter((x) => String(x.m.content[0].text).includes('正常联系人先补回来')).length, 1)
  后端.私聊历史['10001'].push(私聊条(93, 10001, '失败通道还坏着我也能继续收', 现在 - 100))
  await 宿主.poll()
  assert.equal(收到.filter((x) => String(x.m.content[0].text).includes('失败通道还坏着我也能继续收')).length, 1, '一个失败联系人不能阻塞其他联系人')

  后端.失败私聊号.clear()
  await 宿主.poll()
  assert.equal(收到.filter((x) => String(x.m.content[0].text).includes('坏通道恢复后再补')).length, 1)
  assert.equal(收到.filter((x) => String(x.m.content[0].text).includes('正常联系人先补回来')).length, 1, '成功通道的进度要落盘，不能重复补')
}

// ================= 场景十：损坏主配置从备份恢复，不重复开窗口 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-config-recovery-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  后端.群列表 = []
  后端.最近 = [{ chatType: 1, peerUin: '10001' }]
  后端.私聊历史['10001'] = [私聊条(101, 10001, '配置恢复后仍能进正确窗口', 现在 + 10)]
  写配置(home, { 收群: false, 自动收群: false, 自动收私聊: false, 补课: false })
  const 配置路径 = join(home, 'qq-bridge-config.json')
  writeFileSync(配置路径 + '.bak', readFileSync(配置路径, 'utf8'), 'utf8')
  writeFileSync(配置路径, '{broken', 'utf8')

  const 宿主 = await 造宿主(home, 收到)
  await 宿主.poll()
  assert.equal(收到.length, 1)
  assert.doesNotThrow(() => JSON.parse(readFileSync(配置路径, 'utf8')), '有效备份应恢复为正式配置')
  await 宿主.poll()
  assert.equal(宿主.会话数(), 1, '配置恢复后必须复用同一个窗口')
}

// ================= 场景十一：回复窗口外的旧 DSH 消息也能识别对象 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-old-reply-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  后端.群列表 = [{ group_id: 20001, group_name: '一群' }]
  后端.消息详情['110'] = { message_id: 110, user_id: 30001, sender: { user_id: 30001 } }
  const 回复 = 群条(111, 40001, '接着回答这个', 现在 + 10)
  回复.message.unshift({ type: 'reply', data: { id: '110' } })
  后端.群历史['20001'] = [回复]
  写配置(home, { 收私聊: false, 私聊QQ: '', 自动收私聊: false, 自动收群: false, 补课: false, 群接话: 'at' })

  const 宿主 = await 造宿主(home, 收到)
  await 宿主.poll()
  assert.equal(收到.length, 1, '回复旧 DSH 消息应视为在叫 DSH')
  assert.match(String(收到[0].m.content[0].text), /\[对象:你\]/)
  assert.ok(后端.请求.some((u) => u.endsWith('/get_msg')), '历史窗口没有原消息时应查询回复目标')
}

// ================= 场景十二：离线补课投递失败也不能结算掉 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-catchup-delivery-retry-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  const 断档前 = 现在 - 3600
  后端.群列表 = []
  后端.最近 = [{ chatType: 1, peerUin: '10001' }]
  后端.私聊历史['10001'] = [私聊条(121, 10001, '首投失败后还要补回来', 现在 - 300)]
  写配置(home, { 收群: false, 自动收群: false, 自动收私聊: false, 补课: true })
  writeFileSync(join(home, 'qq-bridge-state.json'), JSON.stringify({ 水位: {}, 上次存活: 断档前 }), 'utf8')

  const 宿主 = await 造宿主(home, 收到, { 失败一次: true })
  await new Promise((r) => setTimeout(r, 3300))
  assert.equal(收到.length, 0, '第一次模拟转入失败')
  await 宿主.poll()
  assert.equal(收到.length, 1, '离线消息必须在下一轮重新投递')
  assert.match(String(收到[0].m.content[0].text), /首投失败后还要补回来/)
}

// ================= 场景十三：补课瞬时失败不能被普通 10 条窗口跨过去 =================
{
  const home = mkdtempSync(join(tmpdir(), 'qq-catchup-window-'))
  process.env.DSH_HOME = home
  const 后端 = 造后端()
  const 收到 = []
  const 现在 = Math.floor(Date.now() / 1000)
  const 断档前 = 现在 - 3600
  后端.群列表 = []
  后端.最近 = [{ chatType: 1, peerUin: '10001' }]
  后端.私聊历史['10001'] = Array.from({ length: 25 }, (_, i) => 私聊条(130 + i, 10001, `积压第${i + 1}条`, 断档前 + 100 + i))
  后端.失败私聊次数.set('10001', 2)
  写配置(home, { 收群: false, 自动收群: false, 自动收私聊: false, 补课: true, 补课最多条: 30 })
  writeFileSync(join(home, 'qq-bridge-state.json'), JSON.stringify({ 水位: {}, 上次存活: 断档前 }), 'utf8')

  const 宿主 = await 造宿主(home, 收到)
  await new Promise((r) => setTimeout(r, 3300))
  await 宿主.poll()
  assert.equal(收到.length, 0, '第二次补课仍失败时，普通 10 条轮询必须避开该通道')
  await 宿主.poll()
  assert.equal(收到.length, 1)
  const 文 = String(收到[0].m.content[0].text)
  assert.match(文, /积压第1条[\s\S]*积压第25条/, '恢复后要由 50 条补课窗口完整接住积压')
}

console.log('PASS 自动发现 + 水位 + 补课')
