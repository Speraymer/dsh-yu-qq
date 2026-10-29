// DSH「QQ大肥鱼」· 网页半边
//
// 只干一件事：在 **DSH 设置** 左侧栏加一项「QQ大肥鱼」，
// 摆出：总开关 / 试运行 / 目标会话（下拉选，不手填）/ 私聊QQ / 群号 / 转私聊 / 转群，
// 加「测试一句」「保存设置」和一份最近记录。
//
// ⚠ 这里不碰会话、不发消息，只是往宿主那几条 /dsh-qq-bridge/* 路由上读写。

window.__ModuleLoader__.load({
  id: 'dsh-yu-qq',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']

    const B = '/dsh-qq-bridge'
    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (p, body) =>
      fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then((r) => r.json())
        .catch(() => null)

    const h = React.createElement

    const S = {
      wrap: {
        padding: '12px 14px 24px',
        fontSize: 13,
        lineHeight: 1.7,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
        borderRadius: 12,
      },
      h: { fontSize: 14, fontWeight: 600, margin: '16px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      row: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' },
      lab: { minWidth: 190, paddingTop: 3, fontSize: 12.5 },
      ctl: { flex: '1 1 260px', minWidth: 220 },
      hint: { opacity: 0.6, fontSize: 11.5, marginTop: 2 },
      input: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: '100%',
        boxSizing: 'border-box',
      },
      small: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: 140,
        boxSizing: 'border-box',
      },
      ok: { color: 'var(--dsw-alias-state-business-primary)', fontSize: 12 },
      已同步: { margin: '6px 0 10px', fontSize: 12, color: 'var(--dsw-alias-state-business-primary)' },
      未保存: { margin: '6px 0 10px', fontSize: 12, color: '#c0392b', fontWeight: 600 },
      悬浮保存条: {
        position: 'sticky',
        bottom: 0,
        marginTop: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.95))',
        boxShadow: '0 -6px 18px rgba(0,0,0,.18)',
        zIndex: 5,
      },
      btn: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 12px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      },
      btnOn: {
        border: '1px solid var(--dsw-alias-state-business-primary)',
        borderRadius: 6,
        padding: '4px 12px',
        background: 'var(--dsw-alias-state-business-primary)',
        color: '#fff',
        fontSize: 12,
        cursor: 'pointer',
      },
      日志行: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5, whiteSpace: 'pre-wrap' },
    }

    const 提示 = (文本) => h('div', { style: S.hint }, 文本)
    const 行 = (标签, 控件, 说明) =>
      h('div', { style: S.row }, h('div', { style: S.lab }, 标签), h('div', { style: S.ctl }, 控件, 说明 ? 提示(说明) : null))
    const 按钮 = (文字, onClick, 亮, 关) =>
      h('button', { type: 'button', style: 亮 ? S.btnOn : S.btn, onClick, disabled: !!关, title: 文字 }, 文字)
    const 勾 = (值, onChange) => h('input', { type: 'checkbox', checked: !!值, onChange: (e) => onChange(e.target.checked) })
    const 短id = (id) => {
      const s = String(id)
      return s.length <= 8 ? s : s.slice(-8)
    }

    function Section() {
      const [态, 设态] = React.useState(null)
      const [脏, 设脏] = React.useState(false)
      const [忙, 设忙] = React.useState(false)
      const [说, 设说] = React.useState('')
      const [更新, 设更新] = React.useState(null)
      const [更新忙, 设更新忙] = React.useState(false)

      React.useEffect(() => {
        拉()
        get('/update').then((r) => r && 设更新(r)).catch(() => {})
      }, [])

      const 拉 = async () => {
        const s = await get('/state')
        if (s) 设态(s)
      }
      const 改 = (k, v) => {
        设态((旧) => (旧 ? { ...旧, 配置: { ...(旧.配置 || {}), [k]: v } } : 旧))
        设脏(true)
      }
      const 存 = async () => {
        设忙(true)
        const s = await post('/save', (态 && 态.配置) || {})
        设忙(false)
        if (s && s.ok) {
          设态(s)
          设脏(false)
          设说(s.说 || '保存好了')
        } else {
          设说((s && s.说) || '保存失败')
        }
      }
      const 查更新 = async () => {
        设更新忙(true)
        const r = await get('/update?refresh=1')
        if (r) 设更新(r)
        设更新忙(false)
        设说(!r ? '查不到（网络）' : r.hasUpdate ? '有新版本 v' + r.latest : r.ok ? '已经是最新版' : '查不到：' + (r.error || '网络'))
      }

      const 试一句 = async () => {
        设忙(true)
        const s = await post('/test-send', {})
        设忙(false)
        设说((s && s.说) || '没反应')
        await 拉()
      }

      if (!态) return h('div', { style: S.wrap }, h('div', { style: S.h }, 'QQ大肥鱼'), h('div', { style: S.dim }, '读取中…'))

      const 配置 = 态.配置 || {}
      const 目标们 = Array.isArray(态.活着的会话) ? 态.活着的会话 : []
      const NapCat = 态.NapCat状态 || null
      const 日志 = Array.isArray(态.日志) ? 态.日志 : []

      return h(
        'div',
        { style: S.wrap },

        h('div', { style: S.h }, 'QQ大肥鱼'),
        h('div', { style: S.dim },
          '它在 DSH 里说完一整轮，就把那句原文发到 QQ（两个方向都做了，你在 QQ 里说的话也会转进来）。' +
            '版本 ' + String(态.版本 || '?') + '｜配置文件：' + String(态.配置文件 || ''),
        ),
        NapCat && !NapCat.错
          ? h('div', { style: S.已同步 }, '✓ 连着的 QQ：' + NapCat.昵称 + '（' + NapCat.用户 + '）')
          : h('div', { style: S.未保存 }, '⚠ 连不上 NapCat' + (NapCat && NapCat.错 ? '：' + NapCat.错 : '')),
        // —— 检查更新 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '检查更新'),
          h('div', { style: S.dim },
            !更新 ? '正在看有没有新版…'
              : 更新.hasUpdate ? '仓库里已经有 v' + 更新.latest + ' 了'
                : 更新.ok ? '已经是最新版' : '暂时查不到（' + (更新.error || '网络') + '）—— 这不代表没有问题'),
          h('div', { style: { marginTop: 6 } }, 按钮(更新忙 ? '查…' : '检查更新', 查更新, false, 更新忙)),
          更新 && 更新.hasUpdate
            ? h('div', { style: { marginTop: 8 } },
              h('div', { style: S.dim }, '更新方法：先卸旧版再装新版（直接装可能拿到缓存里的旧副本）。'),
              h('div', { style: S.日志行 }, 'dsh plugin --profile desktop add github:Speraymer/dsh-yu-qq'),
              按钮('复制命令', () => navigator.clipboard.writeText('dsh plugin --profile desktop add github:Speraymer/dsh-yu-qq').then(() => 设说('命令已复制')).catch(() => 设说('复制不了，手动选中吧')), false, false))
            : null,
        ),
        h('div', { style: 脏 ? S.未保存 : S.已同步 },
          脏 ? '⚠ 上面有改动还没保存 —— 改完点「保存设置」（有改动时底下还会浮一条出来）' : '设置已同步 ✓',
        ),

        // —— 开关 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '开关'),
          行('总开关', 勾(配置.总开关, (v) => 改('总开关', v)), '关着 = 一句都不发（安全默认）。'),
          行('试运行', 勾(配置.试运行, (v) => 改('试运行', v)), '开着只记账、不真发到 QQ。想先看记录就开着它。'),
        ),

        // —— 目标会话（下拉选，不手填）——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '目标会话（盯哪一间屋）'),
          h('select', {
            style: S.input,
            value: 配置.目标会话 || '',
            onChange: (e) => 改('目标会话', e.target.value),
          },
            h('option', { value: '' }, '（还没选）'),
            ...目标们.map((s) =>
              h('option', { value: s.id }, (s.标题 || '…' + 短id(s.id)) + ' · ' + 短id(s.id)),
            ),
          ),
          h('div', { style: { marginTop: 4 } }, 按钮('刷新清单', 拉, false, 忙)),
          h('div', { style: S.dim }, '普通桌面对话只按主动镜像开关发送；QQ 来信使用下面两个独立会话。'),
          ...['私聊会话', '群会话'].map((字段) => 行(字段, h('select', {
            style: S.input, value: 配置[字段] || '', onChange: (e) => 改(字段, e.target.value),
          }, h('option', { value: '' }, '（收到消息时自动创建独立会话）'),
          ...目标们.map((s) => h('option', { value: s.id }, (s.标题 || '…' + 短id(s.id)) + ' · ' + 短id(s.id)))),
          '三个会话不能重复；旧冲突绑定会备份后自动拆分。')),
        ),

        // —— 称呼 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '怎么称呼你'),
          行('称呼', h('input', { type: 'text', style: S.small, value: String(配置.称呼 || '对方'), onChange: (e) => 改('称呼', e.target.value) }), '转给它的话里会用它。比如填「小明」，它收到的就是「小明发来了图片」。'),
        ),

        // —— 群里怎么接话 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '群里怎么接话'),
          行('接话方式', h('select', {
            style: S.input,
            value: String(配置.群接话 || 'auto'),
            onChange: (e) => 改('群接话', e.target.value),
          },
            h('option', { value: 'auto' }, '点名立刻接 + 其余掷骰（推荐）'),
            h('option', { value: 'always' }, '每批都接'),
            h('option', { value: 'at' }, '只接被点名的'),
          ), 'auto = 有人 @ 她、或正文里提到下面那些词，就立刻接；没点名就按概率掷骰子决定看不看。'),
          行('多久掷一次骰（秒）', h('input', { type: 'number', min: 10, max: 600, style: S.small, value: String(配置.群掷骰秒 ?? 60), onChange: (e) => 改('群掷骰秒', Number(e.target.value)) }), '没被点名时，多久看一眼群、掷一次骰。10–600 秒。'),
          行('搭话概率（%）', h('input', { type: 'number', min: 5, max: 100, style: S.small, value: String(配置.群搭话概率 ?? 40), onChange: (e) => 改('群搭话概率', Number(e.target.value)) }), '第一次掷骰的中签率。'),
          行('没中加多少（%）', h('input', { type: 'number', min: 0, max: 50, style: S.small, value: String(配置.群概率步进 ?? 20), onChange: (e) => 改('群概率步进', Number(e.target.value)) }), '每没中一次就往上加，加到 100 必然开口；开口后回到上面的初始值。'),
          行('算「点名」的词', h('input', { type: 'text', style: S.small, value: String(配置.群提名词 || ''), onChange: (e) => 改('群提名词', e.target.value) }), '逗号分隔，比如：大肥鱼,鲸鱼娘,肥鱼。正文里出现这些词也算在叫她。'),
        ),

        // —— 引用与表情 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '引用与表情'),
          h('div', { style: S.dim }, '它回话时可以引用某条消息：写 [引用:消息id]（id 就是转给它那条前面的 [m:…]）。表情三种：unicode 😄 直接写；[表情:名字] 发自己存的大表情；[face:编号] 发 QQ 原生小表情。'),
          行('表情目录', h('input', { type: 'text', style: S.small, value: String(配置.表情目录 || ''), onChange: (e) => 改('表情目录', e.target.value) }), '大表情图放这儿，文件名就是 [表情:名字] 里的名字（扩展名可省）。留空 = <DSH_HOME>/qq-bridge-stickers。'),
        ),

        // —— 发到哪 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '发到哪'),
          行('接收并回应私聊', 勾(配置.收私聊 ?? true, (v) => 改('收私聊', v)), '使用独立私聊会话，回复只回私聊。'),
          行('接收并回应群消息', 勾(配置.收群 ?? true, (v) => 改('收群', v)), '使用独立群会话；关闭主动群镜像仍可回应群内 @。'),
          行('把普通 DSH 对话镜像到私聊', 勾(配置.转私聊, (v) => 改('转私聊', v)), '往下面这个 QQ 号私聊发。'),
          行('私聊 QQ 号', h('input', { type: 'text', style: S.small, value: String(配置.私聊QQ || ''), onChange: (e) => 改('私聊QQ', e.target.value) }), '就是你自己的 QQ 号。'),
          行('把普通 DSH 对话镜像到群', 勾(配置.转群, (v) => 改('转群', v)), '往下面这个群发。'),
          行('群号', h('input', { type: 'text', style: S.small, value: String(配置.群号 || ''), onChange: (e) => 改('群号', e.target.value) }), '可空。多个群用逗号分隔，每个群各自一间会话。'),
          行('群指令豁免 QQ', h('input', { type: 'text', style: S.small, value: String(配置.指令QQ || ''), onChange: (e) => 改('指令QQ', e.target.value) }), '只有这个真实 QQ 号发送“/dsh 指令”时会进入目标会话；昵称、群名片和其他人复制前缀都无效。'),
        ),

        // —— 自动发现 + 开机补课 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '自动发现与补课'),
          行('自动收所有群', 勾(配置.自动收群 ?? true, (v) => 改('自动收群', v)), '除了上面手填的群号，NapCat 里所有群都自动听；新建的群不用回来改设置，第一次来消息就自己开一间会话。'),
          行('自动收所有私聊', 勾(配置.自动收私聊 ?? true, (v) => 改('自动收私聊', v)), '除了「私聊 QQ」，好友发来的私信也收，每人一间独立会话，回复只回给本人。'),
          行('开机补课', 勾(配置.补课 ?? true, (v) => 改('补课', v)), 'DSH 关着的那段时间里攒下的消息，开机后合并成一条补进来；这一轮不往 QQ 回话。'),
          行('每个群/人最多补几条', h('input', { type: 'number', min: 1, max: 200, style: S.small, value: String(配置.补课最多条 ?? 30), onChange: (e) => 改('补课最多条', Number(e.target.value)) }), '1–200。补课文案里只放最近这么多条，太多也看不过来。'),
          行('超过多久不补（小时）', h('input', { type: 'number', min: 1, max: 336, style: S.small, value: String(配置.补课最多小时 ?? 48), onChange: (e) => 改('补课最多小时', Number(e.target.value)) }), '1–336。停机太久就只补最近这一段，免得一开机灌进几百条。'),
        ),

        // —— 图片 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '图片'),
          行('收图（QQ → 它）', 勾(配置.收图, (v) => 改('收图', v)), '你在 QQ 里发的图也转给它看。模型看得见图就直接看；纯文本模型只知道「有几张图、存在哪」。'),
          行('发图（它 → QQ）', 勾(配置.发图, (v) => 改('发图', v)), '它这一轮里发的图也发到 QQ。'),
          行('一条最多收几张', h('input', { type: 'number', min: 1, max: 10, style: S.small, value: String(配置.收图最多 ?? 4), onChange: (e) => 改('收图最多', Number(e.target.value)) }), '多出来的不转。一条最多 10 张。'),
          行('单张最大（MB）', h('input', { type: 'number', min: 1, max: 30, style: S.small, value: String(配置.图上限MB ?? 5), onChange: (e) => 改('图上限MB', Number(e.target.value)) }), '超过就跳过（两个方向都按这个）。'),
          行('图片根目录', h('input', { type: 'text', style: S.input, placeholder: '（留空就行：自动用目标会话所在的工作区）', value: String(配置.图片根目录 || ''), onChange: (e) => 改('图片根目录', e.target.value) }), '一般不用填。它正文里写 ![名字](相对路径) 时，先按这个目录找；留空就用目标会话所在的工作区。'),
          h('div', { style: S.dim }, '收进来的图会存一份到 %USERPROFILE%\\.dsh\\qq-bridge-inbox\\，文字里会带上路径。发图只认三处：目标会话的工作区（它生成的图就落在这儿）、qq-bridge-inbox、DSH 的 attachments / cache / img —— 而且必须是真图片（看文件头，改后缀没用）。'),
        ),

        // —— 文件 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '文件（文档）'),
          行('收文件（QQ → 它）', 勾(配置.收文件, (v) => 改('收文件', v)), '你在 QQ 里发的 PDF / docx / zip 这类文件，会存到本地，再把路径递给它。'),
          行('一条最多收几个', h('input', { type: 'number', min: 1, max: 10, style: S.small, value: String(配置.收文件最多 ?? 3), onChange: (e) => 改('收文件最多', Number(e.target.value)) }), '多出来的只留文件名。'),
          行('单个最大（MB）', h('input', { type: 'number', min: 1, max: 100, style: S.small, value: String(配置.文件上限MB ?? 20), onChange: (e) => 改('文件上限MB', Number(e.target.value)) }), '超过就不下，1–100。'),
          行('发文件（它 → QQ）', 勾(配置.发文件 !== false, (v) => 改('发文件', v)), '它正文里写 [文件:文件名](路径) 就当文件发到 QQ（走 NapCat 的上传接口，不是消息段）。'),
          行('一轮最多发几个', h('input', { type: 'number', min: 1, max: 10, style: S.small, value: String(配置.发文件最多 ?? 3), onChange: (e) => 改('发文件最多', Number(e.target.value)) }), '1–10，多出来的不发。'),
          行('发出去的最大（MB）', h('input', { type: 'number', min: 1, max: 100, style: S.small, value: String(配置.发文件上限MB ?? 20), onChange: (e) => 改('发文件上限MB', Number(e.target.value)) }), '1–100。'),
          行('群发文件（默认关）', 勾(配置.群发文件 === true, (v) => 改('群发文件', v)), '打开才会把文件发进群。默认关：群消息是不可信素材，文件发进群就撤不回来了。'),
          h('div', { style: S.dim }, '只收你自己号（上面的私聊 QQ / 群指令豁免 QQ）发的文件；群里别人发的只把名字记一句，不落盘。存到 %USERPROFILE%\\.dsh\\qq-bridge-inbox\\文件\\。'),
          h('div', { style: S.dim }, '发出去的方向只认工作区（或图片根目录）里的文件，扩展名也有白名单：文档 / 表格 / 图片 / 音视频 / 压缩包。.json、.yaml、.env、.pem、.key、数据库这类配置和密钥，一律发不出去。'),
          h('div', { style: S.dim }, '文件只回给你本人（上面的「私聊 QQ」）：别人私信进来时不会把本机文件发给他。群里要发得先打开上面的「群发文件」。'),
        ),

        // —— 动作 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '自己动手'),
          h('div', null,
            按钮('保存设置', 存, true, 忙),
            h('span', { style: S.dim }, '　'),
            按钮('测试一句', 试一句, false, 忙),
            h('span', { style: S.dim }, '　'),
            按钮('刷新', 拉, false, 忙),
          ),
          h('div', { style: { ...S.dim, marginTop: 4 } }, '「测试一句」会真的发一句去 QQ（绕过试运行），用来确认整条路通没通。'),
          说 ? h('div', { style: { ...S.ok, marginTop: 6 } }, 说) : null,
        ),

        // —— 记录 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '最近 ' + 日志.length + ' 条记录（新的在最下面）'),
          h('div', { style: { marginTop: 6, maxHeight: 220, overflowY: 'auto' } },
            日志.length === 0
              ? h('div', { style: S.dim }, '还没有记录。')
              : 日志.map((条, i) => h('div', { key: i, style: S.日志行 }, 条.时间 + '　' + 条.文本)),
          ),
        ),

        // —— 悬浮保存条 ——
        脏
          ? h('div', { style: S.悬浮保存条 },
              h('span', { style: { fontWeight: 600, color: '#c0392b' } }, '⚠ 有改动还没保存'),
              h('span', { style: S.dim }, '改完点这里就行'),
              按钮('保存设置', 存, true, 忙),
            )
          : null,
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'qq-bridge', order: 54, label: () => 'QQ大肥鱼' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

