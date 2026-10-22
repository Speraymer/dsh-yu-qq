// 群聊节流：点名立刻接 / 掷骰 / 概率递增 / 引用与表情标记
import assert from 'node:assert/strict'
import { 群轮次判定, 群聊素材, 拆引用, 拆表情, 挑表情, 表情清单 } from '../lib/host.js'

let 过 = 0
const 测 = (名, fn) => {
  try { fn(); 过 += 1; console.log('PASS ' + 名) } catch (e) { console.error('FAIL ' + 名 + '\n  ' + e.message); process.exitCode = 1 }
}

const 配置 = { 群接话: 'auto', 群掷骰秒: 60, 群搭话概率: 40, 群概率步进: 20 }
const 现在 = 1_000_000

测('有人 @ → 立刻开，不看时间和概率', () => {
  const r = 群轮次判定({ 现在, 上次掷骰: 现在 - 1000, 概率: 40, 配置, 有人叫我: true })
  assert.equal(r.开, true)
  assert.equal(r.因, '点名')
})

测('正文提到「大肥鱼」→ 也算点名', () => {
  const r = 群轮次判定({ 现在, 上次掷骰: 现在 - 1000, 概率: 40, 配置, 提到我: true })
  assert.equal(r.开, true)
  assert.equal(r.因, '点名')
})

测('没到 60 秒 → 不掷，只是等', () => {
  const r = 群轮次判定({ 现在, 上次掷骰: 现在 - 30_000, 概率: 40, 配置 })
  assert.equal(r.开, false)
  assert.equal(r.掷了, false)
  assert.equal(r.因, '没到时间')
})

测('到点了，随机值在 40% 内 → 开，概率重置成初始值', () => {
  const r = 群轮次判定({ 现在, 上次掷骰: 现在 - 61_000, 概率: 40, 配置, 随机值: 0.39 })
  assert.equal(r.开, true)
  assert.equal(r.掷了, true)
  assert.equal(r.概率, 40)
})

测('到点了，没中 → 不开，概率 +20', () => {
  const r = 群轮次判定({ 现在, 上次掷骰: 现在 - 61_000, 概率: 40, 配置, 随机值: 0.41 })
  assert.equal(r.开, false)
  assert.equal(r.因, '没掷中')
  assert.equal(r.概率, 60)
})

测('概率加到 100 就必然开口', () => {
  const r = 群轮次判定({ 现在, 上次掷骰: 现在 - 61_000, 概率: 100, 配置, 随机值: 0.999 })
  assert.equal(r.开, true)
  assert.equal(r.概率, 40)
})

测('at 模式：没人点名就永远不开，也不掷', () => {
  const r = 群轮次判定({ 现在, 上次掷骰: 0, 概率: 40, 配置: { ...配置, 群接话: 'at' } })
  assert.equal(r.开, false)
  assert.equal(r.掷了, false)
  assert.equal(r.因, '只接点名')
})

测('always 模式：不用掷，直接开', () => {
  const r = 群轮次判定({ 现在, 上次掷骰: 现在 - 1000, 概率: 40, 配置: { ...配置, 群接话: 'always' } })
  assert.equal(r.开, true)
  assert.equal(r.因, '每批都开')
})

测('群聊素材带「不是每句都要接」的纪律', () => {
  assert.match(群聊素材(['小明：在吗']), /SHUTUP/)
  assert.match(群聊素材(['小明：在吗']), /不是每句都要接/)
})

测('接话门槛 = always 时，不再劝她闭嘴', () => {
  assert.doesNotMatch(群聊素材(['小明：在吗'], 'always'), /不是每句都要接/)
})

测('引用标记能拆出来，正文不留 [引用:…]', () => {
  const r = 拆引用('[引用:123456] 这句是回你上一条 😄')
  assert.equal(r.引用, '123456')
  assert.equal(r.文字, '这句是回你上一条 😄')
})

测('没有引用标记 → 引用为空，正文原样', () => {
  const r = 拆引用('随便说一句')
  assert.equal(r.引用, '')
  assert.equal(r.文字, '随便说一句')
})

测('大表情标记拆得出名字，正文干净', () => {
  const r = 拆表情('笑死 [表情:捂脸] 真的')
  assert.deepEqual(r.表情名们, ['捂脸'])
  assert.equal(r.文字, '笑死 真的')
})

测('QQ 原生小表情按编号拆', () => {
  const r = 拆表情('好耶[face:14]')
  assert.deepEqual(r.小表情号们, [14])
  assert.equal(r.文字, '好耶')
})

测('unicode 表情不动它（本来就只是文字）', () => {
  const r = 拆表情('这个确实 😂')
  assert.deepEqual(r.表情名们, [])
  assert.deepEqual(r.小表情号们, [])
  assert.equal(r.文字, '这个确实 😂')
})

const 库 = {
  474: { id: '474', 名: '/给你一拳', 次数: 3, 最近: 2 },
  343: { id: '343', 名: '/我方了', 次数: 1, 最近: 1 },
}

测('按名字挑表情（去掉斜杠也认得）', () => {
  assert.equal(挑表情('给你一拳', 库).id, '474')
})

测('按编号挑表情', () => {
  assert.equal(挑表情('343', 库).id, '343')
})

测('库里没有 → null（回头去找图片）', () => {
  assert.equal(挑表情('不存在', 库), null)
})

测('给提示用的清单：按用得多的排，名字去掉斜杠', () => {
  assert.equal(表情清单(库), '给你一拳(474)、我方了(343)')
})

console.log(过 + ' 项通过' + (process.exitCode ? '（有失败）' : ' ✅'))

测('被点名时明确要求「这条要接」，不许 SHUTUP', () => {
  const 文 = 群聊素材(['[m:1] 主人：@大肥鱼 在吗'], 'auto', null, true)
  assert.match(文, /这条要接/)
  assert.match(文, /别 SHUTUP/)
})
