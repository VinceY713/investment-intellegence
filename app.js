/* =========================================================================
   理性仓位管理工具 — 前端逻辑（纯原生 JS，无依赖，数据仅存本地）
   四层决策架构：单标的下注 / 组合分散 / 总风险控制 / 本金防御
   ========================================================================= */

'use strict';

/* -------------------------------------------------------------------------
   0. 常量 & 存储
   ------------------------------------------------------------------------- */
const STORAGE_KEY = 'rpm.state.v1';

const DEFAULT_SETTINGS = {
  kellyFraction: 0.25,   // 凯利系数（默认 1/4）
  singleCap: 10,         // 单股上限 %
  cashFloor: 10,         // 现金池下限 %
  perTradeRisk: 2,       // 单笔风险 %
  profitLockThreshold: 30, // 利润隔离阈值 %
  maxDrawdown: 15,       // 组合最大回撤阈值 %
  equityTargetPct: 20,   // 弹性仓（股票）目标占总资产 %——博收益弹性的引擎
  equityRiskLevel: '进取', // 弹性仓风险档：稳健/均衡/进取（决定弹性仓内部集中度容忍）
  deepLossAdd: 20,       // 深套阈值 %（亏损加仓/减仓判定用）
  // 个人目标语境（AI 组合点评据此给"目标相对"的建议，而非泛泛而谈）
  profileHorizon: '',    // 投资期限：'<1y' | '1-3y' | '3-5y' | '5y+'
  profileRisk: '',       // 风险承受：'保守' | '均衡' | '进取'
  profileLiquidity: '',  // 近1年是否需动用：'no' | 'part' | 'yes'
  profileGoal: '',       // 一句话目标（自由文本）
};
// 弹性仓风险档 → 弹性仓内部集中度上限（占弹性仓 %，非占总资产）
const EQUITY_RISK_LEVELS = {
  '稳健': { single: 22, factor: 50, label: '稳健' },
  '均衡': { single: 30, factor: 60, label: '均衡' },
  '进取': { single: 40, factor: 75, label: '进取' },
};

// 底层驱动因子标签库（可自由扩展）
const FACTORS = [
  'AI算力', 'AI电力', 'AI应用', '科技互联网', '传媒游戏',
  '半导体', '机器人', '创新药', '医疗器械', '银行',
  '证券保险', '黄金', '有色金属', '能源', '公用事业',
  '化工', '消费', '食品饮料', '新能源车', '光伏风电',
  '军工', '地产', '农业', '其它'
];

// 按名称粗分类底层因子（中英双语，兼容美股/ETF 英文名），避免用户手选默认而错标。
// 规则按“先具体后宽泛”顺序，命中即返回，否则「其它」。
function guessFactor(name) {
  const s = String(name || '');
  const rules = [
    [/银行|Bank|JPMorgan|Goldman|Morgan\s*Stanley|Citi|Wells\s*Fargo|Berkshire/i, '银行'],
    [/证券|券商|保险|Securit|Insuranc|Broker|Visa|Mastercard|PayPal/i, '证券保险'],
    [/黄金|金矿|金业|山东黄金|中金黄金|招金|赤峰|白银|Gold|Silver|Barrick|Newmont/i, '黄金'],
    [/半导体|芯片|集成电路|中芯|华虹|北方华创|光刻|存储|封测|Semiconduct|Chip|台积电|TSM|Intel|英特尔|Micron|美光|Broadcom|博通|Qualcomm|高通|\bAMD\b|\bARM\b/i, '半导体'],
    [/机器人|Robot/i, '机器人'],
    [/光伏|风电|太阳能|Solar|Wind|First\s*Solar/i, '光伏风电'],
    [/新能源|锂电|锂矿|电池|宁德|比亚迪|整车|汽车|Auto|Battery|Lithium|\bEV\b|Tesla|特斯拉|蔚来|\bNIO\b|小鹏|Xpeng|理想|Li\s*Auto|Rivian|Lucid/i, '新能源车'],
    [/医疗器械|器械|Medical\s*Device/i, '医疗器械'],
    [/医药|生物|制药|医疗|药业|创新药|疫苗|药明|恒瑞|百济|CXO|Biotech|Pharma|Bio\b|Health|Medical|Pfizer|Merck|Lilly|Moderna|Amgen/i, '创新药'],
    [/白酒|茅台|五粮液|泸州|食品|饮料|乳业|伊利|蒙牛|Food|Beverage|Staples|Coca|Pepsi|McDonald|Nike|Starbucks|星巴克/i, '食品饮料'],
    [/家电|美的|格力|海尔|零售|免税|消费|Consumer|Retail|Discretionary|Walmart|Costco|Home\s*Depot/i, '消费'],
    [/军工|航空|航天|兵器|船舶|国防|导弹|Defense|Aerospace|Lockheed|Boeing|Raytheon/i, '军工'],
    [/地产|置业|万科|保利|招商蛇口|华润置地|Real\s*Estate|REIT|Property/i, '地产'],
    [/化工|Chemical|Dow\b|DuPont/i, '化工'],
    [/有色|铜|铝|钢|稀土|锌|铅|镍|Metal|Copper|Steel|Alumin|Freeport/i, '有色金属'],
    [/煤|石油|石化|油气|燃气|能源|矿业|Energy|\bOil\b|\bGas\b|Coal|Mining|Exxon|Chevron|埃克森|雪佛龙|Mobil|Occidental|Conoco/i, '能源'],
    [/电网|水电|核电|公用|Utilit/i, '公用事业'],
    [/农业|养殖|种业|饲料|Agri|Farm/i, '农业'],
    [/传媒|游戏|影视|Media|Game|Entertain|Netflix|奈飞|Disney|迪士尼|Spotify/i, '传媒游戏'],
    [/算力|光模块|服务器|数据中心|CPO|GPU|人工智能|英伟达|NVIDIA|NVDA|Palantir|\bAI\b/i, 'AI算力'],
    [/电力|Power/i, 'AI电力'],
    [/软件|云计算|互联网|SaaS|平台|科技|Tech|Internet|Software|Cloud|Nasdaq|QQQ|Apple|苹果|Microsoft|微软|Google|Alphabet|谷歌|Amazon|亚马逊|Meta|Facebook|Oracle|甲骨文|Adobe|Salesforce|Alibaba|阿里|BABA|拼多多|\bPDD\b|京东|\bJD\b|携程|Trip|Uber|Airbnb|Coinbase|百度|Baidu/i, '科技互联网'],
  ];
  for (const [re, f] of rules) if (re.test(s)) return f;
  return '其它';
}

// 趋势状态
const TRENDS = ['加速下跌', '下跌', '震荡', '向上', '加速上涨'];

const FACTOR_COLORS = [
  '#0a84ff', '#34c759', '#ff9f0a', '#ff375f', '#af52de',
  '#5ac8fa', '#ff9500', '#30d158', '#bf5af2', '#64d2ff',
  '#ffd60a', '#a2845e', '#66d4cf', '#8e8e93'
];

/* -------------------------------------------------------------------------
   市场识别 & 交易制度参数（A股涨跌停 / T+1 / 手数 vs 美股）
   —— 让止损、分批、股数取整按标的所属市场走不同规则
   ------------------------------------------------------------------------- */
function marketOf(code) {
  const c = String(code || '').trim();
  if (!c) return 'unknown';
  if (/[A-Za-z]/.test(c)) return 'US';               // 含字母 → 美股
  if (/^688/.test(c)) return 'A-STAR';               // 科创板 ±20%
  if (/^(300|301)/.test(c)) return 'A-CHINEXT';      // 创业板 ±20%
  if (/^(8|4)/.test(c) || /^920/.test(c)) return 'A-BJ'; // 北交所 ±30%
  if (/^(5|1)/.test(c)) return 'A-ETF';              // 沪深 ETF/LOF/基金 ±10%
  if (/^\d{6}$/.test(c)) return 'A-MAIN';            // 沪深主板 ±10%
  return 'unknown';
}
const MARKET_LABEL = {
  'A-MAIN': '沪深主板', 'A-STAR': '科创板', 'A-CHINEXT': '创业板',
  'A-BJ': '北交所', 'A-ETF': '场内基金/ETF', 'US': '美股', 'unknown': '未识别',
};
// 单日涨跌停幅度（%）；美股/未知返回 null（无涨跌停，但有熔断/跳空）
function dailyLimitPct(code) {
  switch (marketOf(code)) {
    case 'A-STAR': case 'A-CHINEXT': return 20;
    case 'A-BJ': return 30;
    case 'A-MAIN': case 'A-ETF': return 10;
    default: return null;
  }
}
function isAShare(code) { return String(marketOf(code)).startsWith('A'); }
function isTPlus1(code) { return isAShare(code); }              // A股 T+1，当日买入不可卖
function lotSizeOf(code) { return isAShare(code) ? 100 : 1; }  // A股 100 股/手，美股可 1 股
function roundLot(shares, code) {                               // 向下取整到可下单手数
  const lot = lotSizeOf(code);
  return Math.max(0, Math.floor(num(shares) / lot) * lot);
}
// 人民币金额 → 标的计价货币金额（美股 ÷汇率），用于由 CNY 仓位金额算股数（美股股价是美元）
function nativeAmt(valueCny, code) {
  return isUsCode(code) ? num(valueCny) / currentFx() : num(valueCny);
}
// 由 CNY 仓位金额 + 单价（标的计价货币）算可下单股数：先折算币种，再除单价，再取整到手
function sharesFromCny(valueCny, price, code) {
  return price > 0 ? roundLot(nativeAmt(valueCny, code) / price, code) : 0;
}

/* -------------------------------------------------------------------------
   交易成本估算（粗略）：A股佣金 0.025%(最低5元) 双边 + 卖出印花税 0.05% + 过户费；
   美股按券商近零处理。用于分批/减仓给出净额提示，避免小额多批被手续费吃掉。
   ------------------------------------------------------------------------- */
function tradeCost(code, amountCny, side /* 'buy'|'sell' */) {
  const amt = Math.abs(num(amountCny));
  if (amt <= 0) return 0;
  const m = marketOf(code);
  if (m === 'US') return amt * 0.0003;                          // 多数美股券商零佣，给极小值兜底
  if (String(m).startsWith('A')) {
    const commission = Math.max(5, amt * 0.00025);              // 佣金 万2.5，最低 5 元
    const stamp = side === 'sell' ? amt * 0.0005 : 0;           // 印花税仅卖出 0.05%
    const transfer = amt * 0.00001;                             // 过户费 0.001%
    return commission + stamp + transfer;
  }
  return 0;
}

/* -------------------------------------------------------------------------
   类现金资产口径（现金蓄水池铁律用）：只算「回调时能立刻动用」的弹药——
   现金 + 货币基金 + 可随时赎回的活钱理财；锁定的定存/封闭理财(如 2027 才可赎的 QDII)
   不算，否则会高估可用现金、让现金铁律该拦时不拦。
   ------------------------------------------------------------------------- */
function isCashLikeAsset(a) {
  if (!a) return false;
  if (a.category === '人民币现金' || a.category === '香港账户现金') return true;
  // 货币基金/余额宝类（名字匹配）—— 随时可赎
  if (a.category === '基金' && /货币|现金|余额|活期|宝$/.test(a.name || '')) return true;
  // 定存/理财：仅当明确「每日/随时可赎」才算弹药；带锁定期(如“370天/2027-可赎/封闭/持有期”)的不算。
  // 注意不能只匹配「可赎」——锁定产品也写“2027-xx-xx可赎”。要求出现每日/天天/随时/活期/T+0 等日频词。
  if (a.category === '定期存款' || a.category === '理财(QDII)') {
    const txt = (a.name || '') + '｜' + (a.note || '');
    const daily = /每日|天天|随时|活期|T\+0/i.test(txt);
    const locked = /\d{2,4}\s*天|封闭|持有期|定开|\d{4}[-\/]\d{1,2}/.test(txt);   // 含期限/未来日期 → 锁定
    return daily && !locked;
  }
  return false;
}

/* -------------------------------------------------------------------------
   因子相关性先验矩阵（同涨同跌程度）—— 让「有效持仓数 / 回撤」看真实相关，
   而非只看因子标签+权重（能戳破「多只不同标签、实则同一方向」的假分散）。
   注：暂用领域先验（非历史回归）；数据层仅有实时价、无历史序列，后续可接入
   日K历史升级为真实相关矩阵。黄金对权益取负（避险）。
   ------------------------------------------------------------------------- */
const FACTOR_GROUPS = {
  'AI算力': '科技成长', 'AI电力': '科技成长', 'AI应用': '科技成长',
  '科技互联网': '科技成长', '传媒游戏': '科技成长', '光伏风电': '科技成长',
  '半导体': '科技成长', '机器人': '科技成长', '新能源车': '科技成长',
  '创新药': '医药消费', '医疗器械': '医药消费', '消费': '医药消费', '食品饮料': '医药消费',
  '银行': '价值周期', '证券保险': '价值周期', '地产': '价值周期', '能源': '价值周期',
  '有色金属': '价值周期', '化工': '价值周期', '公用事业': '价值周期', '农业': '价值周期',
  '军工': '主题', '其它': '其它', '黄金': '避险',
};
const GROUP_CORR = 0.72;   // 同一大组（如均属科技成长）默认相关
const CROSS_CORR = 0.32;   // 跨组默认相关（A股系统性 beta 不低，同涨同跌常见）
function factorCorr(a, b) {
  if (a === b) return 1;
  const ga = FACTOR_GROUPS[a] || '其它', gb = FACTOR_GROUPS[b] || '其它';
  if (ga === '避险' || gb === '避险') return (ga === '避险' && gb === '避险') ? 1 : -0.05; // 黄金 vs 权益
  if (ga === '其它' || gb === '其它') return CROSS_CORR;   // 未分组因子之间不按同组高估（彼此未必同向）
  return ga === gb ? GROUP_CORR : CROSS_CORR;
}

/* -------------------------------------------------------------------------
   真实相关性引擎（历史日K）—— 拉每只持仓约 160 个交易日收盘价，算真实两两相关、
   年化波动、历史最大回撤，替代因子先验。数据源：腾讯前复权日K（经 /api/kline 代理）。
   失败自动回退到因子先验，绝不阻断其它功能。
   ------------------------------------------------------------------------- */
// 代码 → 腾讯 K 线符号：A股 sh/sz/bj+代码，美股 us+SYM；OTC 场外基金无日K → null（回退先验）
function klineSymbol(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  if (isUsCode(c)) return 'us' + c.toUpperCase().replace(/\s+/g, '');
  if (/^\d{6}$/.test(c)) return detectMarket(c) + c;
  return null;
}
// 一个持仓/资产用哪种历史序列源：
//  · us   → 东财美股前复权日K（push2his，经 /api/uskline；原腾讯 usfqkline 已失效）
//  · fund → 场外公募基金历史净值（东财 lsjz，经 /api/fundhist）—— 联接/QDII 无盘中日K，用确认净值序列算相关
//  · a    → A股/港股通/场内ETF 前复权日K（腾讯 fqkline，经 /api/kline）
// category 传入时，'基金' 且为 6 位代码 → 走净值；否则按代码形态判断。无法取历史 → null（回退因子先验）。
function seriesSourceOf(h) {
  const code = String((h && h.code) || '').trim();
  if (!code) return null;
  if (isUsCode(code)) return { kind: 'us', sym: 'us' + code.toUpperCase().replace(/\s+/g, '') };
  if (h && h.category === '基金' && /^\d{6}$/.test(code)) return { kind: 'fund', sym: code };
  if (/^\d{6}$/.test(code)) return { kind: 'a', sym: detectMarket(code) + code };
  return null;
}
async function fetchKlines(code, count = 160) {
  const sym = klineSymbol(code);
  if (!sym) throw new Error('该代码无日K（场外基金/无代码）');
  // 美股：腾讯 usfqkline 已于 2026-07 失效（只回 1~2 行），改走东财 push2his
  if (isUsCode(code)) return await fetchUsKlinesEM(code, count);
  const res = await fetch('/api/kline?param=' + encodeURIComponent(sym + ',day,,,' + count + ',qfq'), { cache: 'no-store' });
  if (!res.ok) throw new Error('接口返回 ' + res.status);
  const j = await res.json();
  const node = j && j.data && j.data[sym];
  const arr = node && (node.qfqday || node.day || node.week || node.qfqweek);
  if (!Array.isArray(arr) || !arr.length) throw new Error('无K线数据');
  return arr.map(r => ({ date: r[0], close: parseFloat(r[2]) })).filter(x => isFinite(x.close) && x.close > 0);
}
/* 美股日K主源：腾讯 newfqkline，但**必须带交易所后缀**（真机实测）：
     usNVDA      → 只回 3 行（首日 + 今日，稀疏无用）
     usNVDA.OQ   → 回 61 行完整日K  ✅
   后缀不用猜：腾讯实时报价的第 3 个字段就是带后缀的完整代码
   （v_usNVDA="200~英伟达~NVDA.OQ~206.84~…"），先取它再拉 K 线。
   东财 push2his 已从本服务器不可达（被封），故降为最后备选。 */
async function usFullSymbol(sym) {
  const t = await getQuoteText('/api/quote?code=' + encodeURIComponent('us' + sym));
  const m = t.match(/"([^"]*)"/);
  const p = m ? m[1].split('~') : [];
  const full = String(p[2] || '').trim().toUpperCase();
  return /^[A-Z.\-]+\.[A-Z]{1,3}$/.test(full) ? full : null;
}
async function fetchUsKlinesTx(code, count = 250) {
  const sym = String(code).toUpperCase().replace(/\s+/g, '');
  const tries = [];
  let full = null;
  try { full = await usFullSymbol(sym); } catch (e) { /* 报价拿不到也不影响下面按常见后缀试 */ }
  if (full) tries.push('us' + full);
  // .OQ 纳斯达克 / .N 纽交所 / .P NYSE Arca（SPY 等 ETF）/ .A 美交所
  ['.OQ', '.N', '.P', '.A'].forEach(sfx => { if (!full || full !== sym + sfx) tries.push('us' + sym + sfx); });
  for (const s of tries) {
    try {
      const r = await fetchRaw('/api/usidxkline?param=' + encodeURIComponent(s + ',day,,,' + count + ',qfq'));
      const node = JSON.parse(r.text).data[s];
      const arr = node && (node.qfqday || node.day);
      // 稀疏返回（首日+今日）只有 2–3 行，必须拒绝，否则技术指标全是垃圾
      if (Array.isArray(arr) && arr.length >= 20) {
        const out = arr.map(x => ({ date: x[0], close: parseFloat(x[2]), vol: parseFloat(x[5]) }))
          .filter(x => x.date && isFinite(x.close) && x.close > 0);
        if (out.length >= 20) return out;
      }
    } catch (e) { /* 试下一个后缀 */ }
  }
  throw new Error('美股日K获取失败（腾讯 newfqkline 各后缀均无完整数据）');
}

// 美股日K（东财 push2his，经 /api/uskline 代理，query 整段透传）。
// secid 市场前缀：105 纳斯达克 / 106 纽交所 / 107 美交所（SPY 等 NYSE Arca ETF 在 107），逐个试到有数据。
// fields2=f51,f53 → 每行 "日期,收盘"；fqt=1 前复权，klt=101 日K。
async function fetchUsKlinesEM(code, count = 160) {
  // 先走腾讯带后缀（push2his 已被封，但保留其逻辑以备恢复）
  try { return await fetchUsKlinesTx(code, count); } catch (e) { /* 落到东财 */ }
  const sym = String(code).toUpperCase().replace(/\s+/g, '');
  const endD = new Date();
  const begD = new Date(endD.getTime() - Math.ceil(count * 2.2) * 864e5);
  const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  const q = 'fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&klt=101&fqt=1&beg=' + ymd(begD) + '&end=' + ymd(endD);
  for (const mkt of [105, 106, 107]) {
    try {
      const res = await fetch('/api/uskline?secid=' + mkt + '.' + encodeURIComponent(sym) + '&' + q, { cache: 'no-store' });
      if (!res.ok) continue;
      const j = await res.json();
      const list = j && j.data && j.data.klines;
      if (!Array.isArray(list) || !list.length) continue;
      const out = list.map(line => { const p = String(line).split(','); return { date: p[0], close: parseFloat(p[1]) }; })
        .filter(x => x.date && isFinite(x.close) && x.close > 0);
      if (out.length) return out;
    } catch (e) { /* 试下一个市场 */ }
  }
  throw new Error('美股日K获取失败（东财 105/106/107 均无该代码）');
}
/* -------------------------------------------------------------------------
   技术面客观读数：K线（含成交量）→ 均线/MACD/RSI/支撑阻力 → 0-10 技术面评分。
   刻意用【确定性公式】而非 LLM 打分：同样的行情永远得同样的分，可复现、可核对。
   （让模型"看图给分"会出现同输入两次不同分——凯利模块已验证过这个坑。）
   ------------------------------------------------------------------------- */
async function fetchTechKlines(code, count = 250) {
  if (isUsCode(code)) {
    // 腾讯带后缀为主源（含成交量），东财 push2his 已被封、仅作兜底
    try { return await fetchUsKlinesTx(code, count); } catch (e) { /* 落到东财 */ }
    const sym = String(code).toUpperCase().replace(/\s+/g, '');
    const end = todayStr().replace(/-/g, '');
    const d0 = new Date(todayStr() + 'T00:00:00'); d0.setDate(d0.getDate() - Math.ceil(count * 2.2));
    const beg = `${d0.getFullYear()}${String(d0.getMonth() + 1).padStart(2, '0')}${String(d0.getDate()).padStart(2, '0')}`;
    for (const mkt of [105, 106, 107]) {
      try {
        const res = await fetch('/api/uskline?secid=' + mkt + '.' + encodeURIComponent(sym) + '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53,f56&klt=101&fqt=1&beg=' + beg + '&end=' + end, { cache: 'no-store' });
        if (!res.ok) continue;
        const j = await res.json();
        const list = j && j.data && j.data.klines;
        if (!Array.isArray(list) || !list.length) continue;
        const out = list.map(x => { const p = String(x).split(','); return { date: p[0], close: parseFloat(p[1]), vol: parseFloat(p[2]) }; })
          .filter(x => x.date && isFinite(x.close) && x.close > 0);
        if (out.length) return out;
      } catch (e) { /* 试下一个市场 */ }
    }
    throw new Error('美股日K获取失败');
  }
  const sym = klineSymbol(code);
  if (!sym) throw new Error('该代码无日K（场外基金/无代码）');
  const res = await fetch('/api/kline?param=' + encodeURIComponent(sym + ',day,,,' + count + ',qfq'), { cache: 'no-store' });
  if (!res.ok) throw new Error('接口返回 ' + res.status);
  const node = (await res.json()).data[sym];
  const arr = node && (node.qfqday || node.day);
  if (!Array.isArray(arr) || !arr.length) throw new Error('无K线数据');
  // 腾讯 qfqday 行：[日期, 开, 收, 高, 低, 量]
  return arr.map(r => ({ date: r[0], close: parseFloat(r[2]), vol: parseFloat(r[5]) }))
    .filter(x => isFinite(x.close) && x.close > 0);
}
function smaAt(arr, n, i) {
  if (i + 1 < n) return null;
  let s = 0; for (let k = i - n + 1; k <= i; k++) s += arr[k];
  return s / n;
}
function emaSeries(arr, n) {
  const k = 2 / (n + 1), out = [];
  let prev = arr[0];
  arr.forEach((v, i) => { prev = i === 0 ? v : v * k + prev * (1 - k); out.push(prev); });
  return out;
}
function macdOf(closes) {
  if (closes.length < 35) return null;
  const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
  const dif = closes.map((_, i) => e12[i] - e26[i]);
  const dea = emaSeries(dif, 9);
  const i = closes.length - 1;
  return { dif: dif[i], dea: dea[i], hist: (dif[i] - dea[i]) * 2, difPrev: dif[i - 1], deaPrev: dea[i - 1] };
}
function rsiOf(closes, n) {
  n = n || 14;
  if (closes.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / n, al = l / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (n - 1) + Math.max(0, d)) / n;
    al = (al * (n - 1) + Math.max(0, -d)) / n;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}
// 0-10 技术面评分 + 全部中间读数（每一分都能追到出处）
function techScore(rows) {
  const closes = rows.map(r => r.close);
  const n = closes.length;
  if (n < 60) return { ok: false, err: '样本不足 60 个交易日（' + n + '）' };
  const i = n - 1, px = closes[i];
  const ma = {};
  [5, 10, 20, 60].forEach(p => { ma[p] = smaAt(closes, p, i); });
  if (n >= 120) ma[120] = smaAt(closes, 120, i);
  const md = macdOf(closes), rsi = rsiOf(closes, 14);
  const parts = [];
  let score = 0;
  // ① 均线排列 0-3
  const arr = [ma[5], ma[10], ma[20], ma[60]];
  let up = 0, dn = 0;
  for (let k = 0; k < arr.length - 1; k++) { if (arr[k] > arr[k + 1]) up++; else dn++; }
  const maPt = up === 3 ? 3 : up === 2 ? 2 : up === 1 ? 1 : 0;
  score += maPt;
  parts.push({ k: '均线排列', v: up === 3 ? '完全多头排列(MA5>10>20>60)' : dn === 3 ? '完全空头排列' : `部分交织(${up}/3 顺序向上)`, p: maPt, max: 3 });
  // ② 价格站位 0-2
  const above = [ma[20], ma[60]].filter(v => v != null && px > v).length;
  score += above;
  parts.push({ k: '价格站位', v: above === 2 ? '同时站上 MA20/MA60' : above === 1 ? '仅站上其一' : '跌破 MA20 与 MA60', p: above, max: 2 });
  // ③ MACD 0-2.5
  let mPt = 0, mTxt = '数据不足';
  if (md) {
    const cross = md.dif > md.dea;
    mPt = cross && md.dif > 0 ? 2.5 : cross ? 1.5 : md.dif > 0 ? 1 : 0;
    mTxt = `DIF ${md.dif.toFixed(3)} / DEA ${md.dea.toFixed(3)}（${cross ? '金叉状态' : '死叉状态'}，${md.dif > 0 ? '零轴上' : '零轴下'}）`;
  }
  score += mPt;
  parts.push({ k: 'MACD', v: mTxt, p: mPt, max: 2.5 });
  // ④ RSI 0-1.5
  let rPt = 0, rTxt = '数据不足';
  if (rsi != null) {
    rPt = rsi >= 50 && rsi <= 70 ? 1.5 : (rsi > 70 && rsi <= 80) ? 1 : rsi > 80 ? 0.3 : (rsi >= 40 ? 1 : rsi >= 30 ? 0.5 : 0.8);
    rTxt = rsi.toFixed(1) + (rsi > 80 ? '（超买）' : rsi < 30 ? '（超卖）' : rsi >= 50 ? '（强势区）' : '（弱势区）');
  }
  score += rPt;
  parts.push({ k: 'RSI(14)', v: rTxt, p: rPt, max: 1.5 });
  // ⑤ 中期动量 0-1（60日涨跌）
  const ret60 = closes[i - 59] > 0 ? (px / closes[i - 59] - 1) * 100 : null;
  const dPt = ret60 == null ? 0 : ret60 > 10 ? 1 : ret60 > 0 ? 0.7 : ret60 > -10 ? 0.3 : 0;
  score += dPt;
  parts.push({ k: '60日动量', v: ret60 == null ? '—' : (ret60 >= 0 ? '+' : '') + ret60.toFixed(1) + '%', p: dPt, max: 1 });
  // 量价（有量才算，作为提示不计分——美股源成交量口径不一，不进分数保证可比）
  let volNote = '';
  const vols = rows.map(r => r.vol).filter(v => isFinite(v) && v > 0);
  if (vols.length >= 60) {
    const v5 = vols.slice(-5).reduce((a, b) => a + b, 0) / 5, v60 = vols.slice(-60).reduce((a, b) => a + b, 0) / 60;
    const ratio = v60 > 0 ? v5 / v60 : null;
    if (ratio != null) volNote = `近5日均量 / 60日均量 = ${ratio.toFixed(2)}` + (ratio > 1.5 ? '（放量）' : ratio < 0.7 ? '（缩量）' : '（平稳）')
      + (ret60 != null && ((ret60 > 0 && ratio < 0.7) || (ret60 < 0 && ratio > 1.5)) ? ' ⚠ 量价背离' : '');
  }
  // 支撑/阻力：近 60 日低/高点（给止损价参考）
  const win = closes.slice(-60);
  const low60 = Math.min.apply(null, win), high60 = Math.max.apply(null, win);
  return {
    ok: true, score: Math.round(score * 10) / 10, parts, px, ma, rsi, macd: md,
    low60, high60, volNote, date: rows[i].date, bars: n,
    stopHint: Math.round(low60 * 0.97 * 100) / 100,   // 支撑下方 3% 作技术止损参考
  };
}

/* -------------------------------------------------------------------------
   基本面 / 资金面 / 消息面自动化。
   界线不是「公式 vs AI」，而是【有没有可核对的真实数据作输入】：
     · 基本面：东财 push2 报价接口本身带 ROE/PE/PB/毛利率/负债率/增速 → 取真实数字，
       再按方法论的锚点表【机械打分】（锚点表本身就是规则，不需要模型）
     · 资金面：个股主力净流入（真实）+ 已有的行业板块资金流 → 机械打分
     · 消息面：拉【真实公告标题+日期】，AI 只对检索到的标题做分类（利好/利空/影响程度），
       绝不让它凭记忆生成事件——那才是幻觉的来源
   全部带诊断（原始返回 + 区间护栏），取不到就留空不猜。
   ------------------------------------------------------------------------- */
function emSecidOf(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  if (isUsCode(c)) return null;                       // 美股需扫 105/106/107，另行处理
  if (/^6/.test(c) || /^(5|11|13)/.test(c)) return '1.' + c;   // 沪市
  return '0.' + c;                                     // 深市/创业板
}
// push2 字段多为「值×100」（隐含两位小数）：给合理区间，自动在 raw / raw÷100 中挑对的那个
function pickScaled(v, lo, hi) {
  if (v == null || !isFinite(v)) return null;
  for (const x of [v, v / 100, v / 10000]) if (x >= lo && x <= hi) return +x.toFixed(3);
  return null;
}
const FUND_FIELDS = 'f43,f57,f58,f59,f105,f116,f162,f167,f173,f183,f184,f185,f186,f187,f188';
async function fetchFundamentals(code) {
  const diag = [];
  const s = emSecidOf(code);
  // ① 主源：东财数据中心（估值分析 + F10 财务主指标）。
  //    push2.eastmoney.com 已从本服务器完全不可达（直连 curl 亦 000，非 nginx 问题、非 HTTP/2 问题），
  //    故数据中心升为主源；push2 保留为次源，日后恢复可自动用上。
  if (s) {
    const c = String(code).trim();
    const secucode = c + (s[0] === '1' ? '.SH' : '.SZ');
    const pv = v => (v == null || !isFinite(parseFloat(v))) ? null : parseFloat(v);
    try {
      const r1 = await fetchRaw('/api/emmacro?reportName=RPT_VALUEANALYSIS_DET&columns=ALL&filter=' + encodeURIComponent('(SECURITY_CODE="' + c + '")') + '&pageSize=1&source=WEB&client=WEB');
      const r2 = await fetchRaw('/api/emmacro?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=' + encodeURIComponent('(SECUCODE="' + secucode + '")') + '&pageSize=1&sortColumns=REPORT_DATE&sortTypes=-1&source=HSF10&client=PC');
      let v = null, f10 = null;
      try { v = (JSON.parse(r1.text).result.data || [])[0] || null; } catch (e) {}
      try { f10 = (JSON.parse(r2.text).result.data || [])[0] || null; } catch (e) {}
      // ROEJQ 是【报告期累计】加权ROE（一季报 2.83% 并非年化 2.83%）：直接拿去对"ROE>15%优秀"的锚点比
      // 会把所有股票系统性判成"偏弱"。按报告期月份年化：Q1×4 / 中报×2 / Q3×4/3 / 年报×1。
      let roe = f10 ? pv(f10.ROEJQ) : null, roeNote = '';
      if (roe != null && f10 && f10.REPORT_DATE) {
        const mm = String(f10.REPORT_DATE).slice(5, 7);
        const mul = mm === '03' ? 4 : mm === '06' ? 2 : mm === '09' ? 4 / 3 : 1;
        if (mul !== 1) { roeNote = `（${String(f10.REPORT_DATE).slice(0, 7)} 累计 ${roe}% 年化×${mul === 4 / 3 ? '1.33' : mul}）`; roe = +(roe * mul).toFixed(2); }
        else roeNote = '（年报口径）';
      }
      diag.push('dc/估值 HTTP' + r1.status + ' + F10 HTTP' + r2.status
        + (f10 ? ' 报告期=' + String(f10.REPORT_DATE || '').slice(0, 10) + ' ROEJQ=' + f10.ROEJQ + '→年化' + roe : '') + ' ' + macroClip(r2.text));
      const out = {
        secid: secucode, name: (v && v.SECURITY_NAME_ABBR) || (f10 && f10.SECURITY_NAME_ABBR) || '',
        board: (v && v.BOARD_NAME) || '',        // 所属细分行业（如「其他电源设备Ⅱ」）——AI 起草时的行业锚点
        pe: v ? pv(v.PE_TTM) : null,
        pb: v ? pv(v.PB_MRQ) : null,
        roe, roeNote,
        reportDate: f10 ? String(f10.REPORT_DATE || '').slice(0, 10) : '',
        gross: f10 ? pv(f10.XSMLL) : null,
        netMargin: (f10 && num(f10.TOTALOPERATEREVE) > 0) ? +(num(f10.PARENTNETPROFIT) / num(f10.TOTALOPERATEREVE) * 100).toFixed(2) : null,
        debt: f10 ? pv(f10.ZCFZL) : null,
        revYoy: f10 ? pv(f10.TOTALOPERATEREVETZ) : null,
        profitYoy: f10 ? pv(f10.PARENTNETPROFITTZ) : null,
        src: '东财数据中心', diag,
      };
      const got = ['pe', 'pb', 'roe', 'gross', 'debt', 'revYoy'].filter(k => out[k] != null).length;
      if (got >= 2) { out.ok = true; return out; }
    } catch (e) { diag.push('dc 异常:' + macroClip(e.message)); }
  }
  // ② 次源：push2 报价字段（目前本服务器不可达，保留以备恢复；美股只能走这条）
  const secids = [];
  if (s) secids.push(s); else [105, 106, 107].forEach(m => secids.push(m + '.' + String(code).toUpperCase()));
  for (const secid of secids) {
    const r = await fetchRaw('/api/emquote?secid=' + encodeURIComponent(secid) + '&fields=' + FUND_FIELDS);
    let d = null;
    try { d = JSON.parse(r.text).data; } catch (e) {}
    diag.push('emq/' + secid + ' HTTP' + r.status + ' ' + macroClip(r.text));
    if (!d) continue;
    const out = {
      secid, name: d.f58 || '',
      pe: pickScaled(d.f162, -1000, 1000),          // 市盈率(动)
      pb: pickScaled(d.f167, 0.01, 100),            // 市净率
      roe: pickScaled(d.f173, -100, 100),           // 净资产收益率 %
      gross: pickScaled(d.f186, -100, 100),         // 毛利率 %
      netMargin: pickScaled(d.f187, -200, 200),     // 净利率 %
      debt: pickScaled(d.f188, 0, 100),             // 资产负债率 %
      revYoy: pickScaled(d.f184, -100, 500),        // 营收同比 %
      profitYoy: pickScaled(d.f185, -500, 2000),    // 净利润同比 %
      src: '东财报价', diag,
    };
    const got = ['pe', 'pb', 'roe', 'gross', 'debt', 'revYoy'].filter(k => out[k] != null).length;
    if (got >= 2) { out.ok = true; return out; }     // 至少两项有效才算取到
  }
  return { ok: false, diag };
}
// 基本面 0-10：按方法论锚点表机械打分。取不到的项不计分也不摊分，并如实标注覆盖度。
function fundScore(f) {
  if (!f || !f.ok) return { ok: false };
  const parts = [];
  let got = 0, max = 0, score = 0;
  const add = (k, v, pts, maxPts, txt) => {
    max += maxPts;
    if (v == null) { parts.push({ k, v: '数据不可得', p: null, max: maxPts }); return; }
    got += maxPts; score += pts; parts.push({ k, v: txt, p: pts, max: maxPts });
  };
  add('ROE(年化)', f.roe, f.roe == null ? 0 : (f.roe > 20 ? 3 : f.roe >= 15 ? 2.5 : f.roe >= 8 ? 1.8 : f.roe >= 3 ? 0.8 : 0), 3,
    f.roe == null ? '' : f.roe.toFixed(2) + '%' + (f.roe > 15 ? '（优秀）' : f.roe >= 8 ? '（中等）' : '（偏弱）') + (f.roeNote || ''));
  add('营收同比', f.revYoy, f.revYoy == null ? 0 : (f.revYoy > 20 ? 2.5 : f.revYoy >= 10 ? 2 : f.revYoy >= 0 ? 1.2 : f.revYoy >= -10 ? 0.5 : 0), 2.5,
    f.revYoy == null ? '' : (f.revYoy >= 0 ? '+' : '') + f.revYoy.toFixed(1) + '%');
  add('净利同比', f.profitYoy, f.profitYoy == null ? 0 : (f.profitYoy > 20 ? 2 : f.profitYoy >= 0 ? 1.2 : f.profitYoy >= -20 ? 0.5 : 0), 2,
    f.profitYoy == null ? '' : (f.profitYoy >= 0 ? '+' : '') + f.profitYoy.toFixed(1) + '%');
  add('资产负债率', f.debt, f.debt == null ? 0 : (f.debt < 40 ? 1.5 : f.debt < 60 ? 1 : f.debt < 75 ? 0.4 : 0), 1.5,
    f.debt == null ? '' : f.debt.toFixed(1) + '%' + (f.debt < 40 ? '（健康）' : f.debt < 60 ? '（正常）' : '（偏高）'));
  // 估值：PE 缺失（如亏损公司常无 PE_TTM）时用 PB 兜底，否则整项被跳过、PB 白取了
  const valHas = (f.pe != null || f.pb != null) ? 1 : null;
  const valPts = f.pe != null
    ? (f.pe > 0 && f.pe < 15 ? 1 : f.pe > 0 && f.pe < 30 ? 0.7 : f.pe > 0 && f.pe < 60 ? 0.35 : 0)
    : (f.pb != null ? (f.pb < 1.5 ? 1 : f.pb < 3 ? 0.7 : f.pb < 6 ? 0.35 : 0) : 0);
  add('估值 PE/PB', valHas, valPts, 1,
    [f.pe != null ? 'PE ' + f.pe.toFixed(1) : '', f.pb != null ? 'PB ' + f.pb.toFixed(2) : ''].filter(Boolean).join(' / ')
    + '（仅绝对值，无历史分位/行业对比，权重最低）');
  if (!got) return { ok: false };
  // 按实际取到的项归一到 10 分制，避免"缺数据 = 低分"的系统性偏差
  const norm = Math.round(score / got * 10 * 10) / 10;
  return { ok: true, score: norm, raw: score, gotMax: got, fullMax: max, parts,
    coverage: Math.round(got / max * 100), src: f.src || '', reportDate: f.reportDate || '' };
}
// 个股主力资金（真实）：f62 今日主力净额、f267/f164 多日；口径不明的一律不用
async function fetchStockFlow(code) {
  const diag = [];
  const secids = [];
  const s = emSecidOf(code);
  if (s) secids.push(s); else [105, 106, 107].forEach(m => secids.push(m + '.' + String(code).toUpperCase()));
  for (const secid of secids) {
    const r = await fetchRaw('/api/emquote?secid=' + encodeURIComponent(secid) + '&fields=f62,f184,f66,f69,f72,f75,f78');
    let d = null;
    try { d = JSON.parse(r.text).data; } catch (e) {}
    diag.push('emq-flow/' + secid + ' HTTP' + r.status + ' ' + macroClip(r.text));
    if (d && typeof d.f62 === 'number' && isFinite(d.f62)) {
      return { ok: true, secid, todayYi: d.f62 / 1e8, ratio: (typeof d.f184 === 'number' && isFinite(d.f184)) ? d.f184 : null, diag };
    }
  }
  // 东财 push2 被封/失败时的兜底：新浪资金流（vip.stock.finance.sina.com.cn，与 hq.sinajs.cn 不同主机、未被封，仅 A股）。
  // 主力净额 = 特大单(r0_net) + 大单(r1_net)；净占比 = 主力净额 ÷ 分层成交额合计；近 5 日逐日可合计。
  const c = String(code || '').trim();
  if (/^\d{6}$/.test(c)) {
    const sym = detectMarket(c) + c;
    const r = await fetchRaw('/api/sinaflow?page=1&num=5&sort=opendate&asc=0&daima=' + sym);
    diag.push('sinaflow/' + sym + ' HTTP' + r.status + ' ' + macroClip(r.text));
    try {
      const arr = JSON.parse(r.text);
      if (Array.isArray(arr) && arr.length) {
        const mainOf = row => num(row.r0_net) + num(row.r1_net);
        const latest = arr[0];
        const tot = num(latest.r0) + num(latest.r1) + num(latest.r2) + num(latest.r3);
        const todayYi = mainOf(latest) / 1e8;
        const ratio = tot > 0 ? +(mainOf(latest) / tot * 100).toFixed(2) : null;
        const d5Yi = arr.reduce((sum, row) => sum + mainOf(row), 0) / 1e8;
        return { ok: true, secid: sym, todayYi: +todayYi.toFixed(4), ratio, d5Yi: +d5Yi.toFixed(4), diag };
      }
    } catch (e) {}
  }
  return { ok: false, diag };
}
// 资金面 0-10：个股主力净额 + 净占比 + 所属板块资金流（板块数据来自「市场指标→资金流向」）
function flowScore(sf, sectorHit) {
  const parts = [];
  let got = 0, score = 0;
  if (sf && sf.ok) {
    const y = sf.todayYi;
    const p = y > 1 ? 3 : y > 0.2 ? 2.4 : y > -0.2 ? 1.5 : y > -1 ? 0.6 : 0;
    score += p; got += 3;
    parts.push({ k: '个股主力净额', v: (y >= 0 ? '+' : '') + y.toFixed(2) + ' 亿', p, max: 3 });
    if (sf.ratio != null) {
      const rp = sf.ratio > 5 ? 2 : sf.ratio > 0 ? 1.4 : sf.ratio > -5 ? 0.7 : 0;
      score += rp; got += 2;
      parts.push({ k: '主力净占比', v: (sf.ratio >= 0 ? '+' : '') + sf.ratio.toFixed(2) + '%', p: rp, max: 2 });
    }
    if (sf.d5Yi != null) {
      // 近 5 日主力净额合计（新浪兜底源提供）：看持续性，单日噪音大
      const dp = sf.d5Yi > 2 ? 1 : sf.d5Yi > 0 ? 0.7 : sf.d5Yi > -2 ? 0.3 : 0;
      score += dp; got += 1;
      parts.push({ k: '近5日主力净额', v: (sf.d5Yi >= 0 ? '+' : '') + sf.d5Yi.toFixed(2) + ' 亿', p: dp, max: 1 });
    }
  }
  if (sectorHit) {
    const y = sectorHit.today;
    const p = y > 5 ? 2 : y > 0 ? 1.4 : y > -5 ? 0.7 : 0;
    score += p; got += 2;
    parts.push({ k: '所属板块「' + sectorHit.name + '」', v: (y >= 0 ? '+' : '') + y.toFixed(1) + ' 亿（5日 ' + (sectorHit.d5 >= 0 ? '+' : '') + sectorHit.d5.toFixed(1) + '）', p, max: 2 });
  }
  if (!got) return { ok: false };
  return { ok: true, score: Math.round(score / got * 10 * 10) / 10, parts, coverage: got };
}
// 真实公告（近 N 条）：只取标题+日期，绝不生成
async function fetchAnnouncements(code, n) {
  n = n || 25;
  const c = String(code || '').trim();
  const q = 'cb=&sr=-1&page_size=' + n + '&page_index=1&ann_type=A&client_source=web&f_node=0&stock_list=' + encodeURIComponent(c);
  const r = await fetchRaw('/api/emann?' + q);
  let list = [];
  try {
    const j = JSON.parse(r.text.replace(/^[^{]*/, ''));
    const d = j && j.data && j.data.list;
    if (Array.isArray(d)) list = d.map(x => ({ title: String(x.title || '').trim(), date: String(x.notice_date || '').slice(0, 10) })).filter(x => x.title);
  } catch (e) {}
  return { ok: list.length > 0, list, diag: ['emann HTTP' + r.status + ' ' + list.length + '条 ' + macroClip(r.text)] };
}

/* -------------------------------------------------------------------------
   相对强弱（行业/大盘维度）——补上「只看个股财务与资金、看不见它在赛道里的位置」的空缺。
   口径：个股相对基准的超额收益（RS = 个股涨幅 − 基准涨幅），A股比沪深300、美股比标普500。
   为什么用它代表「行业趋势/板块潜力」：板块景气最终会体现在【相对大盘的持续超额】上；
   而个股主力资金/板块资金流的数据源已从本服务器不可达（push2 被封），RS 是纯 K 线可算、
   可复现、不依赖任何被封接口的替代口径。
   同时给出「RS 动能」：近 20 日 RS 是在改善还是恶化——景气拐点往往先反映在这里。
   局限（如实标注）：这是【相对强弱】不是【行业基本面景气度】。它能告诉你市场当前怎么定价这条赛道，
   不能告诉你赛道本身的产能/需求/政策周期——后者仍需你在看多逻辑里自己论证。
   ------------------------------------------------------------------------- */
async function fetchRsBenchmark(isUs) {
  // A股→沪深300（腾讯 fqkline，已验证可用）；美股→标普500（腾讯 newfqkline usINX）
  if (isUs) {
    const r = await fetchRaw('/api/usidxkline?param=' + encodeURIComponent('usINX,day,,,250,qfq'));
    const node = JSON.parse(r.text).data.usINX;
    const arr = node && (node.qfqday || node.day);
    return { name: '标普500', series: (arr || []).map(x => ({ date: x[0], close: parseFloat(x[2]) })).filter(x => x.date && x.close > 0) };
  }
  const r = await fetchRaw('/api/kline?param=' + encodeURIComponent('sh000300,day,,,250,qfq'));
  const node = JSON.parse(r.text).data['sh000300'];
  const arr = node && (node.qfqday || node.day);
  return { name: '沪深300', series: (arr || []).map(x => ({ date: x[0], close: parseFloat(x[2]) })).filter(x => x.date && x.close > 0) };
}
// 按日期对齐两条序列 → 取共同交易日的收盘
function alignPair(a, b) {
  const mb = new Map(b.map(x => [x.date, x.close]));
  const out = [];
  a.forEach(x => { const y = mb.get(x.date); if (y > 0 && x.close > 0) out.push({ date: x.date, s: x.close, b: y }); });
  return out;
}
function retPct(arr, key, back) {
  const i = arr.length - 1, j = i - back;
  if (j < 0 || !(arr[j][key] > 0)) return null;
  return (arr[i][key] / arr[j][key] - 1) * 100;
}
// 0-10 相对强弱评分 + 明细
function rsScore(stockSeries, benchSeries, benchName) {
  const p = alignPair(stockSeries, benchSeries);
  if (p.length < 65) return { ok: false, err: '与基准的共同交易日不足 65 天（' + p.length + '）' };
  const parts = []; let score = 0;
  const mk = (back, label, maxPts) => {
    const rs = retPct(p, 's', back), rb = retPct(p, 'b', back);
    if (rs == null || rb == null) return null;
    const d = rs - rb;
    const pts = d > 15 ? maxPts : d > 5 ? maxPts * 0.75 : d > -5 ? maxPts * 0.5 : d > -15 ? maxPts * 0.2 : 0;
    parts.push({ k: label, v: `个股 ${rs >= 0 ? '+' : ''}${rs.toFixed(1)}% vs ${benchName} ${rb >= 0 ? '+' : ''}${rb.toFixed(1)}% → 超额 ${d >= 0 ? '+' : ''}${d.toFixed(1)}%`
      + (d > 15 ? '（大幅领先）' : d > 5 ? '（领先）' : d > -5 ? '（同步）' : d > -15 ? '（落后）' : '（严重落后）'), p: +pts.toFixed(2), max: maxPts });
    score += pts;
    return d;
  };
  const d60 = mk(60, '60日相对强弱', 4);
  const d120 = p.length > 121 ? mk(120, '120日相对强弱', 3) : null;
  // RS 动能：当前 60 日超额 vs 20 日前的 60 日超额——景气拐点常先反映在这里
  let maxMom = 3, momPts = 0, momTxt = '样本不足';
  if (p.length > 81) {
    const cur = (retPct(p, 's', 60) - retPct(p, 'b', 60));
    const prevArr = p.slice(0, p.length - 20);
    const prev = (retPct(prevArr, 's', 60) - retPct(prevArr, 'b', 60));
    if (isFinite(cur) && isFinite(prev)) {
      const dm = cur - prev;
      momPts = dm > 8 ? 3 : dm > 2 ? 2.2 : dm > -2 ? 1.5 : dm > -8 ? 0.6 : 0;
      momTxt = `超额较 20 日前 ${dm >= 0 ? '+' : ''}${dm.toFixed(1)}pp` + (dm > 2 ? '（相对走强中）' : dm < -2 ? '（相对走弱中）' : '（持平）');
    }
  }
  score += momPts;
  parts.push({ k: 'RS 动能(20日变化)', v: momTxt, p: +momPts.toFixed(2), max: maxMom });
  const gotMax = 4 + (d120 != null ? 3 : 0) + maxMom;
  return { ok: true, score: Math.round(score / gotMax * 10 * 10) / 10, parts, benchName, days: p.length, d60, d120 };
}

/* 基准指数库：每个基准配多个候选源（腾讯 fqkline / 东财 push2his），逐个尝试直到取到足够长的序列。
   指数用 fqt=0（不复权；指数本无复权，个别源对 fqt=1 会返回空——原标普500 拉不到的已知成因之一）。
   取不到时把每个候选源的原始返回收进 diag，供页面「基准诊断」展示并据此校准 secid。 */
const BENCHMARKS = [
  { key: 'hs300',  label: '沪深300',   color: '#e5484d', sources: [{ kind: 'tx', sym: 'sh000300' }, { kind: 'em', secid: '1.000300' }] },
  { key: 'sh',     label: '上证指数',   color: '#d97706', sources: [{ kind: 'tx', sym: 'sh000001' }, { kind: 'em', secid: '1.000001' }] },
  { key: 'csi500', label: '中证500',   color: '#0891b2', sources: [{ kind: 'tx', sym: 'sh000905' }, { kind: 'em', secid: '1.000905' }] },
  { key: 'cyb',    label: '创业板指',   color: '#7c3aed', sources: [{ kind: 'tx', sym: 'sz399006' }, { kind: 'em', secid: '0.399006' }] },
  // 国际指数（100.* 前缀）在东财 kline 路径上取不到（真机确认失败）；改用跟踪同一指数的 ETF，
  // 走 105/106/107 前缀——这正是相关性热力图已验证可用的路径。ETF 含分红再投（全收益口径），
  // 与你自己的 TWR（含分红利息）比更公平：纯价格指数会系统性低估基准约 1.3%/年。
  // 首选 txus（腾讯 newfqkline 国际指数，usINX/usNDX 实测有完整日K）：东财 push2his 近期对
  // 服务器出口 IP 封锁且整体不稳定（000 空响应），usx 的 105/106/107 路径同样走东财会连带失败。
  { key: 'hsi',    label: '恒生指数',   color: '#059669', sources: [{ kind: 'em', secid: '100.HSI' }, { kind: 'tx', sym: 'hkHSI' }, { kind: 'tx', sym: 'sz159920', via: '恒生ETF' }] },
  { key: 'spx',    label: '标普500',   color: '#2563eb', sources: [{ kind: 'txus', sym: 'usINX' }, { kind: 'em', secid: '100.SPX' }, { kind: 'em', secid: '100.SPX', fqt: 1 }, { kind: 'usx', sym: 'SPY', via: 'SPY' }, { kind: 'usx', sym: 'IVV', via: 'IVV' }] },
  { key: 'ndx',    label: '纳斯达克100', color: '#db2777', sources: [{ kind: 'txus', sym: 'usNDX' }, { kind: 'em', secid: '100.NDX' }, { kind: 'usx', sym: 'QQQ', via: 'QQQ' }, { kind: 'usx', sym: 'QQQM', via: 'QQQM' }] },
  { key: 'gold',   label: '黄金(ETF)',  color: '#ca8a04', sources: [{ kind: 'tx', sym: 'sh518880' }, { kind: 'em', secid: '1.518880' }] },
];
const BENCH_BY_KEY = {};
BENCHMARKS.forEach(b => { BENCH_BY_KEY[b.key] = b; });

async function fetchBenchSource(src, count) {
  if (src.kind === 'tx') {
    const r = await fetchRaw('/api/kline?param=' + encodeURIComponent(src.sym + ',day,,,' + count + ',qfq'));
    let out = [];
    try {
      const node = JSON.parse(r.text).data[src.sym];
      const arr = node && (node.qfqday || node.day);
      if (Array.isArray(arr)) out = arr.map(x => ({ date: x[0], close: parseFloat(x[2]) })).filter(x => x.date && isFinite(x.close) && x.close > 0);
    } catch (e) {}
    return { series: out, raw: 'tx/' + src.sym + ' HTTP' + r.status + ' ' + out.length + '行 ' + macroClip(r.text) };
  }
  if (src.kind === 'em') {
    // 日期用东八区口径拼（原 toISOString 走 UTC，跨时区会差一天）
    const end = todayStr().replace(/-/g, '');
    const d0 = new Date(todayStr() + 'T00:00:00'); d0.setDate(d0.getDate() - Math.ceil(count * 2.2));
    const beg = `${d0.getFullYear()}${String(d0.getMonth() + 1).padStart(2, '0')}${String(d0.getDate()).padStart(2, '0')}`;
    const r = await fetchRaw('/api/uskline?secid=' + encodeURIComponent(src.secid) + '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&klt=101&fqt=' + (src.fqt != null ? src.fqt : 0) + '&beg=' + beg + '&end=' + end);
    let out = [];
    try {
      const list = JSON.parse(r.text).data.klines;
      if (Array.isArray(list)) out = list.map(x => { const p = String(x).split(','); return { date: p[0], close: parseFloat(p[1]) }; })
        .filter(x => x.date && isFinite(x.close) && x.close > 0);
    } catch (e) {}
    return { series: out, raw: 'em/' + src.secid + '(fqt=' + (src.fqt != null ? src.fqt : 0) + ') HTTP' + r.status + ' ' + out.length + '行 ' + macroClip(r.text) };
  }
  if (src.kind === 'txus') {
    // 腾讯 newfqkline 美股**指数**日K（usINX 标普500 / usNDX 纳指100，经 /api/usidxkline）。
    // 注意：此接口对美股个股返回稀疏数据，只适用于指数；东财 push2his 被封/不稳定时的主力源。
    const r = await fetchRaw('/api/usidxkline?param=' + encodeURIComponent(src.sym + ',day,,,' + count + ',qfq'));
    let out = [];
    try {
      const node = JSON.parse(r.text).data[src.sym];
      const arr = node && (node.qfqday || node.day);
      if (Array.isArray(arr)) out = arr.map(x => ({ date: x[0], close: parseFloat(x[2]) })).filter(x => x.date && isFinite(x.close) && x.close > 0);
    } catch (e) {}
    return { series: out, raw: 'txus/' + src.sym + ' HTTP' + r.status + ' ' + out.length + '行 ' + macroClip(r.text) };
  }
  if (src.kind === 'usx') {
    // 美股 ETF：优先腾讯带后缀（SPY→SPY.P / QQQ→QQQ.OQ），东财 push2his 已封仅作兜底
    try {
      const out = await fetchUsKlinesEM(src.sym, count);
      return { series: out, raw: 'usx/' + src.sym + ' ' + out.length + '行' };
    } catch (e) {
      return { series: [], raw: 'usx/' + src.sym + ' 失败:' + macroClip(e.message) };
    }
  }
  return { series: [], raw: '未知源' };
}
// 返回 {series, diag:[原始返回], via}；series 为空表示全部候选源都失败。
// via 非空表示用的是替代标的（如 SPY 代表标普500），会在图例上如实标注，不冒充原指数。
async function fetchBenchmarkSeries(key, count) {
  count = count || 400;
  const b = BENCH_BY_KEY[key];
  if (!b) return { series: [], diag: ['未知基准 ' + key], via: '' };
  const diag = [];
  for (const src of b.sources) {
    let res;
    try { res = await fetchBenchSource(src, count); }
    catch (e) { diag.push((src.sym || src.secid) + ' 异常:' + macroClip(e.message)); continue; }
    diag.push(res.raw);
    if (res.series.length >= 5) return { series: res.series, diag, via: src.via || '' };   // 至少5个交易日才算有效
  }
  return { series: [], diag, via: '' };
}
// 组合自身的 TWR 净值指数（首个快照 = 100）：剔除出入金，与基准对比才公平
function twrIndexSeries(snaps) {
  let acc = 100;
  const out = [{ date: snaps[0].date, value: 100 }];
  for (let i = 1; i < snaps.length; i++) {
    const prev = num(snaps[i - 1].total), cur = num(snaps[i].total);
    if (prev > 0) acc *= 1 + (cur - cashflowBetween(snaps[i - 1].date, snaps[i].date) - prev) / prev;
    out.push({ date: snaps[i].date, value: acc });
  }
  return out;
}
// 权益子仓位的 TWR 净值指数（首个含明细快照 = 100）：只用「连续持有、有价」的权益标的(A股/美股/基金)
// 逐日价格贡献 ÷ 该标的前一日市值算出当日收益率——分子分母都只取「两天都在持有」的仓位。
// 卖出/买入/换仓天然被排除在外（不在分子也不在分母），所以减仓不会把这条线拉成"亏损"，
// 它回答的是「留着没动的权益仓位，本身赚不赚钱」，与总资产/大类净值线（会被内部划转污染）是两回事。
function equityTwrIndexSeries(detailedSnaps) {
  let acc = 100;
  const out = [{ date: detailedSnaps[0].date, value: 100 }];
  for (let i = 1; i < detailedSnaps.length; i++) {
    const prev = detailedSnaps[i - 1], cur = detailedSnaps[i];
    const fx = num(cur.fx) > 0 ? num(cur.fx) : currentFx();
    const fxPrev = num(prev.fx) > 0 ? num(prev.fx) : fx;
    const prevMap = new Map((prev.assets || []).map(a => [(a.code || a.id), a]));
    let numer = 0, denom = 0;
    (cur.assets || []).forEach(a => {
      if (bigClassOf(a.category) !== '权益') return;
      const pa = prevMap.get(a.code || a.id);
      if (!pa || bigClassOf(pa.category) !== '权益') return;                 // 新买入/新调入 → 跳过，不进分子分母
      if (!(num(pa.shares) > 0 && num(pa.shares) === num(a.shares) && num(pa.lastPx) > 0 && num(a.lastPx) > 0)) return; // 有换仓/无价 → 跳过
      const cfCur = a.currency === 'USD' ? fx : 1, cfPrev = a.currency === 'USD' ? fxPrev : 1;
      numer += num(pa.shares) * (num(a.lastPx) * cfCur - num(pa.lastPx) * cfPrev);
      denom += num(pa.shares) * num(pa.lastPx) * cfPrev;
    });
    if (denom > 0) acc *= 1 + numer / denom;
    out.push({ date: cur.date, value: acc });
  }
  return out;
}
// 基准序列按快照日期对齐（非交易日用此前最近收盘价填充），并以首个有数据的快照日 = 100 归一
function alignBenchmark(snaps, series) {
  const dates = series.map(x => x.date);                 // 已升序
  const close = new Map(series.map(x => [x.date, x.close]));
  let lastV = null, base = null;
  return snaps.map(s => {
    for (let i = dates.length - 1; i >= 0; i--) { if (dates[i] <= s.date) { lastV = close.get(dates[i]); break; } }
    if (lastV != null && base == null) base = lastV;
    return { label: s.date.slice(5), date: s.date, value: base ? lastV / base * 100 : 100 };
  });
}
// 场外基金历史净值序列（东财 lsjz，返回按日期倒序）；转成「与日K同形」的 {date,close} 升序序列
// 用整段 query 透传（与 /api/emmacro 同款、最稳），fundCode/pageIndex/pageSize 都由前端拼好
async function fetchFundSeries(code, count = 200) {
  const res = await fetch('/api/fundhist?fundCode=' + encodeURIComponent(code) + '&pageIndex=1&pageSize=' + count, { cache: 'no-store' });
  if (!res.ok) throw new Error('净值接口 ' + res.status);
  const txt = await res.text();
  let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('净值解析失败'); }
  const list = j && j.Data && j.Data.LSJZList;
  if (!Array.isArray(list) || !list.length) throw new Error('无净值历史');
  return list.map(r => ({ date: r.FSRQ, close: parseFloat(r.DWJZ) }))
    .filter(x => x.date && isFinite(x.close) && x.close > 0)
    .reverse();                                     // 东财倒序 → 升序，和日K对齐
}
// 统一取历史序列：按 seriesSourceOf 分派到日K或净值
async function fetchSeries(h) {
  const src = seriesSourceOf(h);
  if (!src) throw new Error('无历史序列（场外/无代码）');
  if (src.kind === 'fund') return await fetchFundSeries(h.code);
  return await fetchKlines(h.code);
}
// 日收益率序列 / 皮尔逊相关 / 年化波动 / 历史最大回撤
function retsOf(closes) { const r = []; for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) r.push(closes[i] / closes[i - 1] - 1); return r; }
function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 10) return null;                         // 样本过少不给相关，回退先验
  let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  if (vx <= 0 || vy <= 0) return null;
  return Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy)));
}
function annVolPct(rets) { if (rets.length < 2) return null; const m = rets.reduce((a, b) => a + b, 0) / rets.length; let v = 0; for (const r of rets) v += (r - m) * (r - m); v /= (rets.length - 1); return Math.sqrt(v * 252) * 100; }
function histMaxDrawdownPct(closes) { let peak = 0, mdd = 0; for (const c of closes) { if (c > peak) peak = c; if (peak > 0) { const dd = (peak - c) / peak; if (dd > mdd) mdd = dd; } } return mdd * 100; }

// 拉全部持仓历史序列（股票日K + 基金净值）→ 真实相关矩阵 + 每标的统计；缓存到 STATE.corrCache
// holdings：{code,name,weight,role,category}，role='stock'(弹性仓) 或 'fund'(压舱基金)
// 限并发执行（保序）：一次最多 limit 个，避免同时打 16 个请求被行情源限流
async function mapLimit(arr, limit, fn) {
  const ret = new Array(arr.length);
  let i = 0;
  const worker = async () => { while (i < arr.length) { const idx = i++; ret[idx] = await fn(arr[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
  return ret;
}
const corrSleep = ms => new Promise(r => setTimeout(r, ms));

async function buildRealCorr(holdings) {
  const targets = holdings.filter(p => seriesSourceOf(p));
  if (!targets.length) throw new Error('没有可取历史的标的（需 A股/美股代码或场外基金代码）');
  // 限并发 3 + 失败重试 1 次：东财/腾讯对同 IP 高并发敏感，一次性并发拉会被限流导致基金/美股拿不回来
  const fetchOne = async (p) => {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const k = await fetchSeries(p); return { p, map: new Map(k.map(x => [x.date, x.close])), closes: k.map(x => x.close), dates: k.map(x => x.date) }; }
      catch (e) { lastErr = e; await corrSleep(350); }
    }
    return { p, err: lastErr ? lastErr.message : '未知' };
  };
  const fetched = await mapLimit(targets, 3, fetchOne);
  // 全部标的都纳入矩阵：有效历史序列(≥30点)用实测相关；取不到序列(美股/基金接口失败或样本不足)
  // 的仍显示，用「因子先验」相关代替——保证美股/基金一定出现在热力图，绝不消失。
  fetched.forEach(f => { f.hasReal = !!(f.map && f.map.size >= 15); });   // 门槛 30→15：短序列(如新基金/美股返回条数少)也用实测
  const failed = fetched.filter(f => !f.hasReal).map(f => ({ name: f.p.name, code: f.p.code, err: f.err || '样本不足(<30日)' }));
  const codes = fetched.map(f => f.p.code), index = {}; codes.forEach((c, i) => index[c] = i);
  const n = fetched.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = fetched[i], b = fetched[j];
    let rho;
    if (a.hasReal && b.hasReal) {
      const common = a.dates.filter(d => b.map.has(d));     // 交集日期对齐（A股/美股/基金披露日各不同）
      rho = common.length < 12 ? null : pearson(retsOf(common.map(d => a.map.get(d))), retsOf(common.map(d => b.map.get(d))));
    }
    if (rho == null) rho = factorCorr(a.p.factor || '其它', b.p.factor || '其它');   // 至少给因子先验
    matrix[i][j] = matrix[j][i] = rho;
  }
  const stats = fetched.map(f => ({
    code: f.p.code, name: f.p.name, role: f.p.role || 'stock',
    days: f.hasReal ? f.closes.length : 0,
    vol: f.hasReal ? annVolPct(retsOf(f.closes)) : null,
    mdd: f.hasReal ? histMaxDrawdownPct(f.closes) : null,
    prior: !f.hasReal,
  }));
  return { date: todayStr(), codes, index, names: fetched.map(f => f.p.name), roles: fetched.map(f => f.p.role || 'stock'), matrix, stats, failed };
}
// 参与相关性分析的全部标的：
//  · 弹性仓个股（STATE.positions，含 A股/港股通/美股）
//  · 美股（STATE.assets 中 category='美股股票'，若未在弹性仓里）—— 用户可能只在「投资组合」持有、没进弹性仓
//  · 压舱基金（STATE.assets 中 category='基金'）
// weight 统一为「占总资产%」，便于比较核心(基金)/卫星(个股)在组合里的真实份量。
function corrHoldings() {
  const positions = (STATE.positions || []).filter(p => p.code).map(p => ({ code: p.code, name: p.name, weight: num(p.weight), role: 'stock', factor: p.factor || guessFactor(p.name) }));
  const seen = new Set(positions.map(p => p.code));
  const fx = currentFx(), total = portfolioTotal();
  const wPct = a => total > 0 ? +(assetCny(a, fx) / total * 100).toFixed(4) : 0;
  const extra = [];
  (STATE.assets || []).forEach(a => {
    const code = String(a.code || '').trim();
    if (!code || seen.has(code)) return;
    // 美股（含字母代码）作为个股弹性；场外基金作为压舱基金
    if (a.category === '美股股票' && isUsCode(code)) { extra.push({ code, name: a.name, category: '美股股票', role: 'stock', weight: wPct(a), factor: guessFactor(a.name) }); seen.add(code); }
    else if (a.category === '基金' && /^\d{6}$/.test(code) && !isCashLikeAsset(a)) { extra.push({ code, name: a.name, category: '基金', role: 'fund', weight: wPct(a), factor: guessFactor(a.name) }); seen.add(code); }
  });
  return positions.concat(extra);
}
// 相关性解析器：有缓存则用实测相关，缺失的（场外基金）回退因子先验
function corrResolver(cache) {
  if (!cache || !cache.matrix || !cache.index) return null;
  return (a, b) => {
    const ia = cache.index[a.c], ib = cache.index[b.c];
    if (ia == null || ib == null) return factorCorr(a.f, b.f);
    const v = cache.matrix[ia] && cache.matrix[ia][ib];
    return (v == null || !isFinite(v)) ? factorCorr(a.f, b.f) : v;
  };
}

/* -------------------------------------------------------------------------
   AI 组合诊断（DeepSeek，经服务器 /api/ai-review 代理，密钥不出前端）
   ------------------------------------------------------------------------- */
const AI_ENDPOINT = '/api/ai-review';
const AI_MODEL = 'deepseek-v4-pro';   // DeepSeek 模型串；如账号支持的名称不同，改这里即可

/* -------------------------------------------------------------------------
   SF 风格图标（内联 SVG，无 emoji）
   ------------------------------------------------------------------------- */
const ICONS = {
  shield: '<path d="M12 3l7 3v5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  danger: '<path d="M7.9 2.5h8.2L21.5 7.9v8.2L16.1 21.5H7.9L2.5 16.1V7.9z"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.4" r="0.7" fill="currentColor" stroke="none"/>',
  check: '<circle cx="12" cy="12" r="9.2"/><path d="M7.8 12.3l2.6 2.6L16.4 9.4"/>',
  warn: '<path d="M12 3.4 2.7 19.3a1 1 0 0 0 .87 1.5h16.86a1 1 0 0 0 .87-1.5z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/>',
  xmark: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9.2"/><line x1="12" y1="11" x2="12" y2="16.4"/><circle cx="12" cy="7.7" r="0.8" fill="currentColor" stroke="none"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><line x1="8" y1="7" x2="16" y2="7"/><circle cx="9" cy="12" r="0.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="0.7" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="0.7" fill="currentColor" stroke="none"/><circle cx="9" cy="16" r="0.7" fill="currentColor" stroke="none"/><circle cx="12" cy="16" r="0.7" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="0.7" fill="currentColor" stroke="none"/>',
  inbox: '<path d="M4 13l2.5-8h11L20 13"/><path d="M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5h-5a3 3 0 0 1-6 0z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><rect x="9" y="2.6" width="6" height="3.2" rx="1"/><line x1="8.5" y1="11" x2="15.5" y2="11"/><line x1="8.5" y1="15" x2="13" y2="15"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>',
  trenddown: '<path d="M4 7l5.5 5.5 3-3L20 17"/><path d="M20 11.5V17h-5.5"/>',
  pin: '<path d="M12 21s6.5-6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.3" y1="15.3" x2="20" y2="20"/>',
  ruler: '<rect x="3" y="8" width="18" height="8" rx="1.6"/><line x1="7.5" y1="8" x2="7.5" y2="11.5"/><line x1="12" y1="8" x2="12" y2="11.5"/><line x1="16.5" y1="8" x2="16.5" y2="11.5"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.9-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.8l5.8-.9z"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M14 3.2A9 9 0 0 1 20.8 10H14z"/>',
  list: '<line x1="8.5" y1="7" x2="20" y2="7"/><line x1="8.5" y1="12" x2="20" y2="12"/><line x1="8.5" y1="17" x2="20" y2="17"/><circle cx="4.4" cy="7" r="0.9" fill="currentColor" stroke="none"/><circle cx="4.4" cy="12" r="0.9" fill="currentColor" stroke="none"/><circle cx="4.4" cy="17" r="0.9" fill="currentColor" stroke="none"/>',
  gauge: '<path d="M4 16a8 8 0 0 1 16 0"/><line x1="12" y1="16" x2="15.5" y2="11"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>',
  scissors: '<circle cx="6.5" cy="7" r="2.2"/><circle cx="6.5" cy="17" r="2.2"/><line x1="8.4" y1="8.4" x2="20" y2="16"/><line x1="8.4" y1="15.6" x2="20" y2="8"/>',
  plus: '<line x1="12" y1="5.5" x2="12" y2="18.5"/><line x1="5.5" y1="12" x2="18.5" y2="12"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><line x1="14" y1="6" x2="18" y2="10"/>',
  trash: '<path d="M5 7h14"/><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"/><path d="M6.6 7l1 12.4A1.5 1.5 0 0 0 9.1 21h5.8a1.5 1.5 0 0 0 1.5-1.6L17.4 7"/>',
  download: '<path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  upload: '<path d="M12 20V10"/><path d="M8 13l4-4 4 4"/><path d="M5 6h14"/>',
  refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9"/><path d="M20 4.5V9h-4.5"/><path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 15"/><path d="M4 19.5V15h4.5"/>',
  sparkles: '<path d="M12 3l1.7 4.5L18 9l-4.3 1.5L12 15l-1.7-4.5L6 9l4.3-1.5z"/><path d="M18 13.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16H6.5A1.5 1.5 0 0 0 5 20.5z"/><line x1="9" y1="7.5" x2="15" y2="7.5"/><line x1="9" y1="11" x2="15" y2="11"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2.6"/><path d="M3.5 9.5h17"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor" stroke="none"/>',
  coins: '<ellipse cx="12" cy="6.5" rx="6.8" ry="2.8"/><path d="M5.2 6.5v5c0 1.6 3 2.9 6.8 2.9s6.8-1.3 6.8-2.9v-5"/><path d="M5.2 11.5v5c0 1.6 3 2.9 6.8 2.9s6.8-1.3 6.8-2.9v-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="4.2" y1="4.2" x2="6" y2="6"/><line x1="18" y1="18" x2="19.8" y2="19.8"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="4.2" y1="19.8" x2="6" y2="18"/><line x1="18" y1="6" x2="19.8" y2="4.2"/>',
  trend: '<path d="M3 17l5-5 3.5 3.5L20 7"/><path d="M20 11.5V7h-4.5"/>',
  chart: '<line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3" height="6" rx="0.8"/><rect x="11" y="7" width="3" height="10" rx="0.8"/><rect x="16" y="13" width="3" height="4" rx="0.8"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2.4"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="8.5" y1="3.2" x2="8.5" y2="7"/><line x1="15.5" y1="3.2" x2="15.5" y2="7"/>',
};
function icon(name, cls) {
  const p = ICONS[name] || ICONS.info;
  return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

/* -------------------------------------------------------------------------
   截止 2026-07-19 的初始资产（由个人资产配置汇总表导入）
   ------------------------------------------------------------------------- */
const SEED_DATE = '2026-07-19';
const SEED_ASSETS = [
  { platform: '长江证券 **7461', category: 'A股股票', name: '五洲新春', code: '603667', currency: 'CNY', amount: 64884, fx: 1, cny: 64884, pnl: -20455.35, pnlPct: -23.97 },
  { platform: '长江证券 **7461', category: 'A股股票', name: '金山办公', code: '688111', currency: 'CNY', amount: 134100, fx: 1, cny: 134100, pnl: -9887.61, pnlPct: -6.87 },
  { platform: '长江证券 **7461', category: 'A股股票', name: '科士达', code: '002518', currency: 'CNY', amount: 184415, fx: 1, cny: 184415, pnl: -67629.65, pnlPct: -26.83 },
  { platform: '长江证券 **7461', category: 'A股股票', name: '创新药HK(港股通)', code: '159570', currency: 'CNY', amount: 96110, fx: 1, cny: 96110, pnl: 6071.36, pnlPct: 6.74 },
  { platform: '长江证券 **7461', category: 'A股股票', name: '恒生科技ETF汇添富', code: '513260', currency: 'CNY', amount: 101430, fx: 1, cny: 101430, pnl: -17166.64, pnlPct: -14.47 },
  { platform: '永隆银行一卡通', category: '香港账户现金', name: '活期-美元', code: '', currency: 'USD', amount: 12359.09, fx: 6.78, cny: 83794.63, note: '' },
  { platform: '永隆银行一卡通', category: '定期存款', name: '美元6个月定期', code: '', currency: 'USD', amount: 30000, fx: 6.78, cny: 203400, note: '预计利息+479.27, 到期2026-08-24' },
  { platform: '招商银行 理财', category: '理财(QDII)', name: '工银天天鑫全球添益固收类QDII美元', code: 'GYD3203A', currency: 'USD', amount: 64264.55, fx: 6.78, cny: 435713.65, pnl: 1047.88, note: '每日可申赎' },
  { platform: '招商银行 理财', category: '理财(QDII)', name: '招银美元增利海外优选370天1号', code: '108996A', currency: 'USD', amount: 40539.13, fx: 6.78, cny: 274855.30, pnl: 144.13, note: '2027-06-03可赎' },
  { platform: '招商银行 黄金', category: '黄金', name: '招行黄金账户', code: '', currency: 'CNY', amount: 211720.68, fx: 1, cny: 211720.68, pnl: -44636.44 },
  { platform: '招商银行 存款', category: '定期存款', name: '定期存款(年利率1.4%)', code: '', currency: 'CNY', amount: 135000, fx: 1, cny: 135000, annualRate: 0.014, note: '定期' },
  { platform: '招商银行 活钱', category: '人民币现金', name: '活期存款', code: '', currency: 'CNY', amount: 89667.9, fx: 1, cny: 89667.9 },
  { platform: '招商银行 活钱', category: '人民币现金', name: '朝朝宝(货币基金)', code: '', currency: 'CNY', amount: 93849.54, fx: 1, cny: 93849.54 },
  { platform: '招商银行 基金', category: '基金', name: '易方达中证红利低波ETF联接A', code: '020602', currency: 'CNY', amount: 231127.28, fx: 1, cny: 231127.28, pnl: -986.90 },
  { platform: '招商银行 基金', category: '基金', name: '华夏沪深300ETF联接A', code: '000051', currency: 'CNY', amount: 196118.35, fx: 1, cny: 196118.35, pnl: 4780.17 },
  { platform: '招商银行 基金', category: '基金', name: '易方达瑞锦混合发起C', code: '009690', currency: 'CNY', amount: 166484.08, fx: 1, cny: 166484.08, pnl: 6484.08 },
  { platform: '招商银行 基金', category: '基金', name: '招商恒生港股通高股息低波ETF联接A', code: '024029', currency: 'CNY', amount: 103836.74, fx: 1, cny: 103836.74, pnl: -6663.26 },
  { platform: '招商银行 基金', category: '基金', name: '易方达上证科创50ETF联接A', code: '011608', currency: 'CNY', amount: 75074.83, fx: 1, cny: 75074.83, pnl: -5675.17 },
  { platform: '招商银行 基金', category: '基金', name: '泰康中证A500ETF联接A', code: '022426', currency: 'CNY', amount: 54427.43, fx: 1, cny: 54427.43, pnl: -5572.57 },
  { platform: '招商银行 基金', category: '基金', name: '摩根标普500指数QDII C', code: '017641', currency: 'CNY', amount: 934.65, fx: 1, cny: 934.65, pnl: -5.35 },
  { platform: '招商银行 基金', category: '基金', name: '大成标普500等权QDII A', code: '096001', currency: 'CNY', amount: 395.8, fx: 1, cny: 395.8 },
  { platform: '香港券商', category: '美股股票', name: 'TRIP.COM GROUP', code: 'TCOM', currency: 'USD', amount: 27592.5, fx: 6.78, cny: 187077.15, pnl: -19738.6, pnlPct: -9.54, note: '650股 现价42.45/成本46.929' },
  { platform: '香港券商', category: '香港账户现金', name: '购买力(可用资金)', code: '', currency: 'USD', amount: 25007.94, fx: 6.78, cny: 169553.83 },
];
const SEED_TOTAL = SEED_ASSETS.reduce((s, a) => s + a.cny, 0);

// 直接持有的股票 → 同时灌入「持仓」，驱动凯利/分散/回撤/铁律等模块
const SEED_POSITIONS = [
  { name: '五洲新春', code: '603667', factor: '机器人', pnl: -23.97, maxDrop: 45 },
  { name: '金山办公', code: '688111', factor: 'AI应用', pnl: -6.87, maxDrop: 40 },
  { name: '科士达', code: '002518', factor: 'AI电力', pnl: -26.83, maxDrop: 45 },
  { name: '创新药HK', code: '159570', factor: '创新药', pnl: 6.74, maxDrop: 35 },
  { name: '恒生科技ETF', code: '513260', factor: 'AI应用', pnl: -14.47, maxDrop: 40 },
  { name: 'TRIP.COM', code: 'TCOM', factor: '消费', pnl: -9.54, maxDrop: 40, cost: 46.929, price: 42.45, shares: 650 },
];

// 资产大类归并（用于总览饼图与诊断）
function bigClassOf(cat) {
  if (cat === 'A股股票' || cat === '美股股票' || cat === '基金') return '权益';
  if (cat === '理财(QDII)' || cat === '定期存款') return '固收/理财';
  if (cat === '人民币现金' || cat === '香港账户现金') return '现金';
  if (cat === '黄金') return '黄金';
  return '其它';
}

/* -------------------------------------------------------------------------
   汇率（美元/人民币，每日按中间价更新）+ 理财/存款年化利息
   ------------------------------------------------------------------------- */
const FX_DEFAULT = 6.78;
function currentFx() { return num(STATE.portfolio && STATE.portfolio.fxRate, FX_DEFAULT) || FX_DEFAULT; }

// 资产按当日汇率折算人民币（美元资产用当前中间价，人民币资产按原币金额）
function assetCny(a, fx) {
  fx = fx || currentFx();
  if (a.currency === 'USD') return num(a.amount) * fx;
  return num(a.amount != null ? a.amount : a.cny);
}

// 总资产：有投资组合明细时，实时按各资产（美元折中间价）求和；否则用手填值兜底。
// 资产会随时变化，所以总资产以「投资组合」明细为准，自动汇总，不再依赖静态存值。
function portfolioTotal() {
  const assets = (STATE && STATE.assets) || [];
  if (assets.length) {
    const fx = currentFx();
    const sum = assets.reduce((s, a) => s + assetCny(a, fx), 0);
    if (sum > 0) return Math.round(sum);
  }
  return num(STATE.portfolio && STATE.portfolio.totalAssets, 0);
}

/* -------------------------------------------------------------------------
   股票现金池：卖出股票释放的现金自动归集为一笔「人民币现金」资产，
   出现在投资组合的现金分类中，总资产守恒（股票↓ = 现金↑）。
   ------------------------------------------------------------------------- */
const STOCK_CASH_POOL_NAME = '股票现金池';
const STOCK_CASH_POOL_NAME_USD = '美股现金池';
// 按币种找现金池（A股→人民币池，美股→美元池；兼容旧版 autoPool='stockCash'）
// 也认领用户在「投资组合」手建的现金池：按名称+币种识别并打上 autoPool 标记，
// 以后加减仓一致地从这一笔联动，避免又新建一个重复的池子。
function findStockCashPool(ccy = 'CNY') {
  const keys = ccy === 'USD' ? ['stockCashUSD'] : ['stockCashCNY', 'stockCash'];
  const assets = STATE.assets || [];
  let p = assets.find(a => keys.includes(a.autoPool));
  if (p) return p;
  const nameRe = ccy === 'USD' ? /美股现金|美元现金/ : /A股现金|股票现金/;
  p = assets.find(a => nameRe.test(a.name || '') && a.currency === ccy);
  if (p) p.autoPool = (ccy === 'USD') ? 'stockCashUSD' : 'stockCashCNY';   // 认领
  return p || null;
}
function stockCashPoolBalance(ccy = 'CNY') {
  const p = findStockCashPool(ccy);
  return p ? num(p.amount) : 0;
}
function poolName(ccy = 'CNY') { return ccy === 'USD' ? STOCK_CASH_POOL_NAME_USD : STOCK_CASH_POOL_NAME; }
// 原币金额显示（美元加 $，人民币加 ¥）
function fmtOrig(v, ccy = 'CNY') {
  return (ccy === 'USD' ? '$' : '¥') + Math.abs(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}
// 现金池结算：deltaOrig > 0 入池（卖出盈余），< 0 出池（买入动用）。允许为负——负数代表动用了池外资金
function settleToPool(deltaOrig, ccy = 'CNY', note = '') {
  if (Math.abs(deltaOrig) < 1e-9) return stockCashPoolBalance(ccy);
  const isUsd = ccy === 'USD';
  let p = findStockCashPool(ccy);
  if (!p) {
    p = { id: uid(), autoPool: isUsd ? 'stockCashUSD' : 'stockCashCNY',
          name: poolName(ccy), category: isUsd ? '香港账户现金' : '人民币现金',
          currency: ccy, amount: 0, cny: 0,
          platform: isUsd ? '美股券商' : '股票账户', note: '' };
    STATE.assets = STATE.assets || [];
    STATE.assets.push(p);
  }
  p.amount = Math.round((num(p.amount) + deltaOrig) * 100) / 100;
  p.cny = Math.round(assetCny(p, currentFx()));
  if (note) p.note = note;
  return num(p.amount);
}
// 该币种下可以当「钱」接收赎回款的账户（活期/存款/理财/货基）。基金赎回回到的是银行活期，
// 不是股票现金池——把选择权交给用户，只把上次选的记下来做默认值。
function cashDestChoices(ccy) {
  return (STATE.assets || []).filter(a => (a.currency || 'CNY') === (ccy || 'CNY')
    && !a.autoPool
    && (/现金|理财|存款/.test(a.category || '') || /现金|活期|余额|零钱|货基|存款/.test(a.name || '')));
}
// 资金去向选择弹窗。resolve：{mode:'asset',id} / {mode:'pool'} / {mode:'none'}（不入账）/ null（关闭）
function pickCashDestination(o) {
  return new Promise(resolve => {
    const ccy = o.ccy || 'CNY';
    const choices = cashDestChoices(ccy);
    const remembered = ((STATE.redeemDest || {})[ccy]) || '';
    const has = id => choices.some(a => a.id === id) || id === '__pool__';
    const def = has(remembered) ? remembered : (choices[0] ? choices[0].id : '__pool__');
    const opts = choices.map(a => `<option value="${escapeHtml(a.id)}"${a.id === def ? ' selected' : ''}>${escapeHtml(a.name)}（当前 ${fmtOrig(num(a.amount), ccy)}）</option>`).join('')
      + `<option value="__pool__"${def === '__pool__' ? ' selected' : ''}>${escapeHtml(poolName(ccy))}（自动现金池，没有则新建）</option>`;
    const ov = el(`<div data-modal style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px">
      <div class="card" style="max-width:520px;width:100%;max-height:84vh;overflow:auto;margin:0">
        <div class="card-head-row"><h3 style="margin:0">${o.title || '这笔钱去哪了？'}</h3></div>
        <p class="hint" style="margin-top:4px">${o.subtitle || ''}</p>
        <div class="field"><label>转入账户</label><select id="dst-sel">${opts}</select></div>
        ${o.footnote ? `<p class="inline-note" style="margin-top:6px">${o.footnote}</p>` : ''}
        <div class="row" style="margin-top:12px;flex-wrap:wrap">
          <button class="btn" id="dst-ok" style="flex:0 0 auto">确认转入</button>
          <button class="btn secondary" id="dst-none" style="flex:0 0 auto">钱已转出组合，不入账</button>
          <button class="btn secondary" id="dst-cancel" style="flex:0 0 auto">取消</button>
        </div>
        <p class="inline-note" style="margin-top:8px">选「不入账」= 总资产会减少这一笔。若钱确实转出了组合，请再到「资产趋势 → 出入金登记」记一笔出金，否则收益率会把它当亏损。</p>
      </div></div>`);
    const done = v => { ov.remove(); resolve(v); };
    ov.querySelector('#dst-ok').onclick = () => {
      const v = ov.querySelector('#dst-sel').value;
      STATE.redeemDest = Object.assign({}, STATE.redeemDest, { [ccy]: v });   // 记住选择，下次默认
      done(v === '__pool__' ? { mode: 'pool' } : { mode: 'asset', id: v });
    };
    ov.querySelector('#dst-none').onclick = () => done({ mode: 'none' });
    ov.querySelector('#dst-cancel').onclick = () => done(null);
    ov.addEventListener('click', e => { if (e.target === ov) done(null); });
    document.body.appendChild(ov);
  });
}
// 把一笔现金按选择结果落账（原币）。返回落账去向名，未落账返回 null
function creditCash(dest, amtOrig, ccy, note) {
  if (!dest || dest.mode === 'none') return null;
  if (dest.mode === 'pool') { settleToPool(amtOrig, ccy, note); return poolName(ccy); }
  const a = (STATE.assets || []).find(x => x.id === dest.id);
  if (!a) { settleToPool(amtOrig, ccy, note); return poolName(ccy); }
  a.amount = Math.round((num(a.amount) + amtOrig) * 100) / 100;
  a.cny = Math.round(assetCny(a, currentFx()));
  return a.name;
}
// 持股数变动 → 现金结算预览（不落账）。规则：Δ股数×现价 < 0 = 卖出盈余计入现金池；
// > 0 = 买入动用现金。按标的所属市场分币种：A股结人民币池，美股结美元池。
function previewSharesSettlement(oldShares, newShares, price, code) {
  const dS = num(newShares) - num(oldShares);
  if (!(price > 0) || Math.abs(dS) < 1e-9) return null;
  const ccy = (code && isUsCode(code)) ? 'USD' : 'CNY';
  return { dS, ccy, deltaOrig: dS * price, poolBal: stockCashPoolBalance(ccy) };
}
// 现金类资产合计（铁律「现金蓄水池」的真实口径，含股票现金池）
function cashAssetsCny() {
  const fx = currentFx();
  return (STATE.assets || []).reduce((s, a) => s + (isCashLikeAsset(a) ? assetCny(a, fx) : 0), 0);
}
// 美元敞口（人民币口径）：以美元计价的风险资产合计，含汇率风险。用于提示 FX 敞口。
function usdExposureCny() {
  const fx = currentFx();
  return (STATE.assets || []).reduce((s, a) => s + (a.currency === 'USD' ? assetCny(a, fx) : 0), 0);
}
// 减仓记账：卖出金额写回数据——联动资产/股数自动减少，所得自动进股票现金池
function applySellToPool(posId, amtCny) {
  const fx = currentFx();
  const total = portfolioTotal();
  const p = (STATE.positions || []).find(x => x.id === posId);
  const a = p && p.code ? (STATE.assets || []).find(x => x.code === p.code) : null;
  let ratio = 0;
  if (a) {
    const vCny = assetCny(a, fx);
    ratio = vCny > 0 ? Math.min(1, amtCny / vCny) : 0;
    const amtOrig = a.currency === 'USD' ? amtCny / fx : amtCny;
    a.amount = Math.max(0, Math.round((num(a.amount) - amtOrig) * 100) / 100);
    if (num(a.shares) > 0) { captureSod(a); a.shares = Math.max(0, Math.round(a.shares * (1 - ratio) * 100) / 100); }
    if (a.pnl != null) a.pnl = Math.round(a.pnl * (1 - ratio) * 100) / 100;   // 卖出部分的浮盈亏按比例结转
    a.cny = Math.round(assetCny(a, fx));
  }
  if (p) {
    // 持仓股数始终按比例同步减少（即便资产侧没登记股数，持仓页的股数也要跟得上）
    const posV = total > 0 ? num(p.weight) / 100 * total : 0;
    const pr = a ? ratio : (posV > 0 ? Math.min(1, amtCny / posV) : 0);
    if (num(p.shares) > 0 && pr > 0) p.shares = Math.max(0, Math.round(p.shares * (1 - pr) * 100) / 100);
    if (!a && total > 0) p.weight = Math.max(0, +(num(p.weight) - amtCny / total * 100).toFixed(4));
  }
  // 卖出所得按币种计入对应现金池（A股→人民币池，美股→美元池）
  const ccy = a ? (a.currency === 'USD' ? 'USD' : 'CNY')
              : (p && p.code && isUsCode(p.code) ? 'USD' : 'CNY');
  const pool = settleToPool(ccy === 'USD' ? amtCny / fx : amtCny, ccy, '卖出' + (p ? p.name : '股票') + '回笼');
  saveState();
  return { pool, ratio, ccy, unbooked: !a };   // unbooked：无对应资产，入池金额此前未入账，总资产会增加
}

// 当日开盘持股：① 当日编辑时快照的 sodShares；② 否则取「今天之前最近一份快照」里同标的股数
// （= 今日开盘持仓，能对已发生的改动追溯生效）；③ 再否则用当前股数。
// 已有历史快照、但任何一份里都没有该标的 → 今天才建仓，开盘持股为 0：
// 当天收益按「现价−成本」口径（见 dayPnlCny），不会错按全天涨幅记。
function sodSharesOf(a) {
  const today = todayStr();
  if (a.sodDate === today && a.sodShares != null) return num(a.sodShares);
  const snaps = (STATE.snapshots || []).filter(s => s && s.date && s.date < today).sort((x, y) => (x.date < y.date ? 1 : -1));
  for (const s of snaps) {
    const sa = (s.assets || []).find(x => (a.code && x.code === a.code) || (a.id && x.id === a.id));
    if (sa) return num(sa.shares);          // 最近一份快照里有它 → 以快照股数为准（含 0）
  }
  if (snaps.length) return 0;               // 有快照史但查无此标的 → 今日新建仓
  return num(a.shares);
}
// 今日之前是否已持有该标的（按历史快照判断）。无快照数据时视为「一直持有」(true)，保持旧口径。
function heldBeforeToday(a) {
  const today = todayStr();
  const snaps = (STATE.snapshots || []).filter(s => s && s.date && s.date < today);
  if (!snaps.length) return true;
  return snaps.some(s => (s.assets || []).some(x => (a.code && x.code === a.code) || (a.id && x.id === a.id)));
}
// 当日盈亏金额（人民币，带正负）——按「当日开盘持股」算，而非当前持股。
// 今天增/减持后，当日盈亏只算你当日开盘时就持有的那部分，和实际一致。
function todayTradesOf(a) {
  return (a && a.tradesDate === todayStr() && Array.isArray(a.todayTrades)) ? a.todayTrades : [];
}
function dayPnlCny(a, fx) {
  fx = fx || currentFx();
  const dp = num(a.dayPct), px = num(a.lastPx);
  if (!isFinite(dp) || !(px > 0)) return 0;
  const trades0 = todayTradesOf(a);
  if (dp === 0 && !trades0.length) return 0;           // 涨跌为0且无当日交易才早退（有交易时买卖价差仍产生盈亏）
  if (a.pxDate && a.pxDate !== todayStr()) return 0;   // 价格不是今天刷的：旧涨跌不能算当日盈亏
  const prev = px / (1 + dp / 100);                       // 昨收
  const cf = a.currency === 'USD' ? fx : 1;
  const trades = trades0;
  let totalSell = 0, totalBuy = 0, totalBuyCost = 0;
  trades.forEach(t => { if (t.type === 'sell') totalSell += num(t.shares); else if (t.type === 'buy') { totalBuy += num(t.shares); totalBuyCost += num(t.shares) * num(t.price); } });
  const hasPos = num(a.shares) > 0 || (a.sodDate === todayStr() && a.sodShares != null) || trades.length;
  if (hasPos) {
    // 开盘持股：有当日交易记录时用「现持股 + 当日卖出 − 当日买入」反推——
    // 与实际成交自洽，不受 captureSod 快照/手动纠错/隔日污染影响；
    // 无交易记录时才回退到快照/当前持股。
    const sod = trades.length ? Math.max(0, num(a.shares) + totalSell - totalBuy) : sodSharesOf(a);
    // 精确分解：开盘持股 = 全天持有 + 当日卖出（最多 sod 股按昨收计价；
    // 超出开盘持股的卖出＝卖的是当日买入的股，按当日买入均价计价，防 T+0 回转虚高）
    const heldThrough = Math.max(0, sod - totalSell);      // 从开盘持有到收盘
    const avgBuy = totalBuy > 0 ? totalBuyCost / totalBuy : prev;
    let pnl = heldThrough * (px - prev);
    let sellFromSodLeft = Math.min(totalSell, sod);        // 卖出中来自开盘持仓的部分（按昨收基）
    trades.forEach(t => {
      if (t.type === 'sell') {
        const sh = num(t.shares);
        const fromSod = Math.min(sh, sellFromSodLeft); sellFromSodLeft -= fromSod;
        const fromBuys = sh - fromSod;
        pnl += fromSod * (num(t.price) - prev)             // 昨收→卖出价
             + fromBuys * (num(t.price) - avgBuy);         // 买入均价→卖出价（当日买又卖）
      } else if (t.type === 'buy') pnl += num(t.shares) * (px - num(t.price)); // 买入价→收盘
    });
    // 当日买入且当日卖掉的部分不再持有到收盘：把上面 buy 腿多算的 (收盘−买入价) 扣回
    const soldFromBuys = Math.max(0, totalSell - Math.min(totalSell, sod));
    if (soldFromBuys > 0) pnl -= soldFromBuys * (px - avgBuy);
    if (sod === 0 && !trades.length) {
      // 开盘持股为 0 且无当日交易。要区分两种情形：
      //  · 真·当日新建仓（sodShares 明确记 0，或历史快照查无此标的）→ 今日盈亏 = 总浮盈亏（现价−成本）
      //  · 老资产今天才首次校准份额（历史快照里有它、只是当时没记 shares）→ 浮盈亏是长期累计的，
      //    绝不能全计为当日 → 按市值×全天涨幅估算
      const newToday = (a.sodDate === todayStr() && a.sodShares != null) ? num(a.sodShares) === 0 : !heldBeforeToday(a);
      if (!newToday) return assetCny(a, fx) * dp / (100 + dp);
      return a.pnl != null ? num(a.pnl) : 0;
    }
    return pnl * cf;
  }
  // 无持股数（手填金额资产）：今日新建仓（历史快照里没有）且填了成本 → 当日盈亏 = 全部浮盈亏；
  // 否则回退按当前市值估算全天涨幅
  if (!heldBeforeToday(a) && a.pnl != null) return num(a.pnl);
  return assetCny(a, fx) * dp / (100 + dp);
}
// 个人当日收益率% —— 当日盈亏 ÷ 当日成本基础（开盘持仓×昨收 ＋ 当日买入×买入价）。
// 中途建仓/加仓的日子，标的全天涨幅(dayPct)≠你的实际收益率，本函数算的是后者；
// 手填金额资产等算不出成本基础的，回退标的天涨幅。返回 null 表示「今日」列不可用。
function dayPnlPct(a, fx) {
  fx = fx || currentFx();
  const dp = num(a.dayPct), px = num(a.lastPx);
  if (!isFinite(dp) || !(px > 0)) return null;
  if (dp === 0 && !todayTradesOf(a).length) return null;  // 涨跌为0且无当日交易才不可用
  if (a.pxDate && a.pxDate !== todayStr()) return null;
  const prev = px / (1 + dp / 100);
  const cf = a.currency === 'USD' ? fx : 1;
  const trades = todayTradesOf(a);
  let totalSell = 0, totalBuy = 0;
  trades.forEach(t => { if (t.type === 'sell') totalSell += num(t.shares); else if (t.type === 'buy') totalBuy += num(t.shares); });
  const hasPos = num(a.shares) > 0 || (a.sodDate === todayStr() && a.sodShares != null) || trades.length;
  if (!hasPos) {
    // 手填金额资产：今日新建仓（历史快照里没有）且填了成本 → 按成本口径，不吃全天涨幅
    if (!heldBeforeToday(a) && a.pnl != null) {
      const cost0 = num(a.amount) * cf - num(a.pnl);
      return cost0 > 0 ? num(a.pnl) / cost0 * 100 : dp;
    }
    return dp;                                // 否则无份额口径，用标的天涨幅
  }
  const sod = trades.length ? Math.max(0, num(a.shares) + totalSell - totalBuy) : sodSharesOf(a);
  if (sod === 0 && !trades.length) {
    // 与 dayPnlCny 同口径：老资产今天才首次校准份额 → 累计浮盈亏不是当日的，按全天涨幅
    const newToday = (a.sodDate === todayStr() && a.sodShares != null) ? num(a.sodShares) === 0 : !heldBeforeToday(a);
    if (!newToday) return dp;
    // 真·当日新建仓：收益率 = 总浮盈亏 ÷ 成本（成本 = 市值 − 浮盈亏）
    if (a.pnl == null) return dp;
    const costCny = num(a.amount) * cf - num(a.pnl);
    return costCny > 0 ? num(a.pnl) / costCny * 100 : dp;
  }
  // 成本基础 = 开盘持仓全部×昨收 + 当日买入×买入价（分子含卖出部分的已实现盈亏，
  // 分母也必须含其成本——原实现只算 heldThrough 导致当日有卖出时收益率系统性虚高）
  let base = sod * prev;
  trades.forEach(t => { if (t.type === 'buy') base += num(t.shares) * num(t.price); });
  if (!(base > 0)) return dp;
  return dayPnlCny(a, fx) / (base * cf) * 100;
}
// 每天第一次改动某资产股数「之前」，快照当日开盘持股数；同日多次改动只记第一次。
function captureSod(a) {
  if (a && a.sodDate !== todayStr()) { a.sodShares = num(a.shares); a.sodDate = todayStr(); }
}
// 记录一笔当日交易（买/卖，带成交价）：更新股数、按成交价结算现金池、维护浮盈亏与当日交易明细。
// 每笔记录 prevShares/prevPnl 以便「撤销」。返回是否成功。
function recordDayTrade(a, type, shares, price) {
  const sh = num(shares), pr = num(price);
  if (!a || !(sh > 0) || !(pr > 0)) return false;
  const fx = currentFx(), cf = a.currency === 'USD' ? fx : 1;
  const px = num(a.lastPx) > 0 ? num(a.lastPx) : pr;
  captureSod(a);                                            // 先记开盘持股
  if (a.tradesDate !== todayStr()) { a.todayTrades = []; a.tradesDate = todayStr(); }
  const oldShares = num(a.shares), oldPnl = a.pnl;
  if (type === 'buy') {
    a.shares = oldShares + sh;
    if (a.pnl != null) a.pnl = Math.round((num(a.pnl) + sh * (px - pr) * cf) * 100) / 100;
    settleToPool(-(sh * pr), a.currency === 'USD' ? 'USD' : 'CNY', '买入' + a.name);
  } else {
    a.shares = Math.max(0, oldShares - sh);
    const ratio = oldShares > 0 ? a.shares / oldShares : 0;
    if (a.pnl != null) a.pnl = Math.round(num(a.pnl) * ratio * 100) / 100;
    // 现金池按【实际减少的股数】结转：超卖被钳到 0 时，多报的部分不入池（账实一致）
    const effSold = oldShares - num(a.shares);
    settleToPool(effSold * pr, a.currency === 'USD' ? 'USD' : 'CNY', '卖出' + a.name);
  }
  a.amount = Math.round(num(a.shares) * px * 100) / 100;
  a.cny = Math.round(assetCny(a, fx));
  a.todayTrades.push({ type, shares: sh, price: pr, prevShares: oldShares, prevPnl: oldPnl });
  const p = (STATE.positions || []).find(x => x.code === a.code);
  if (p) p.shares = num(a.shares);                          // 同步持仓股数
  return true;
}
// 撤销某资产的第 idx 笔当日交易：还原股数/浮盈亏，并反向结算现金池。
function undoDayTrade(a, idx) {
  const trades = todayTradesOf(a);
  const t = trades[idx];
  // 只允许撤销最后一笔：每笔只记录自身前态，撤销中间笔会把后续交易的股数/现金池链打乱
  if (!t || idx !== trades.length - 1) return;
  const fx = currentFx();
  // 卖出的现金池反向额按【实际成交】算（与记录时的 effSold 对称）：超卖钳到0的部分没入过池，撤销也不出池
  const effSh = t.type === 'sell' ? Math.max(0, num(t.prevShares) - num(a.shares)) : num(t.shares);
  a.shares = num(t.prevShares);
  if (t.prevPnl !== undefined) a.pnl = t.prevPnl;
  settleToPool(t.type === 'buy' ? (t.shares * t.price) : -(effSh * t.price),
    a.currency === 'USD' ? 'USD' : 'CNY', '撤销' + a.name);   // 反向
  const px = num(a.lastPx) > 0 ? num(a.lastPx) : num(t.price);
  a.amount = Math.round(num(a.shares) * px * 100) / 100;
  a.cny = Math.round(assetCny(a, fx));
  a.todayTrades.splice(idx, 1);
  const p = (STATE.positions || []).find(x => x.code === a.code);
  if (p) p.shares = num(a.shares);
}

// 年化利率：理财/存款 —— 美元 3%，人民币按实际（从名称/备注的“x%”解析，默认按类别兜底）
function annualRateOf(a) {
  if (a.annualRate != null) return num(a.annualRate);
  const cat = a.category, cur = a.currency, text = (a.name || '') + (a.note || '');
  const pctM = text.match(/([\d.]+)\s*%/);
  if (cat === '理财(QDII)') return cur === 'USD' ? 0.03 : (pctM ? parseFloat(pctM[1]) / 100 : 0.03);
  if (cat === '定期存款' || /定期/.test(text)) {
    if (cur === 'USD') return 0.03;
    return pctM ? parseFloat(pctM[1]) / 100 : 0.014;
  }
  if (/货币基金|朝朝宝/.test(a.name || '')) return 0.015;   // 货基年化约 1.5%
  if (cur === 'USD' && /理财/.test(text)) return 0.03;
  return 0;
}

// 大类排序：股票 → 基金 → 理财 → 黄金 → 现金
function classRank(cat) {
  if (cat === 'A股股票' || cat === '美股股票') return 1;
  if (cat === '基金') return 2;
  if (cat === '理财(QDII)' || cat === '定期存款') return 3;
  if (cat === '黄金') return 4;
  return 5;
}
const ASSET_CATEGORIES = ['A股股票', '美股股票', '基金', '理财(QDII)', '定期存款', '黄金', '人民币现金', '香港账户现金', '外汇'];

// 收益：理财/存款 → 年化利息（美元按当日中间价折人民币）；其它 → 浮盈亏
function assetIncome(a, fx) {
  fx = fx || currentFx();
  const rate = annualRateOf(a);
  if (rate > 0) {
    const cny = num(a.amount) * rate * (a.currency === 'USD' ? fx : 1);
    return { value: cny, kind: 'interest', rate };
  }
  return { value: a.pnl != null ? num(a.pnl) : null, kind: 'pnl' };
}

// 尝试从中国货币网获取美元/人民币中间价（经服务器 /api/fxrate 代理）；失败则用手动/默认值
async function fetchCentralParity() {
  const res = await fetch('/api/fxrate', { cache: 'no-store' });
  if (!res.ok) throw new Error('接口返回 ' + res.status);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = null; }
  // 尽力从返回结构里找出“美元/人民币”的中间价
  let rate = null, date = '';
  const scan = (obj) => {
    if (!obj || rate) return;
    if (Array.isArray(obj)) { obj.forEach(scan); return; }
    if (typeof obj === 'object') {
      const name = JSON.stringify(obj.vrtEername || obj.ccprName || obj.foreignCName || obj.currency || '');
      if (/美元|USD/i.test(name)) {
        const p = parseFloat(obj.price || obj.ccpr || obj.value);
        if (p > 5 && p < 9) { rate = p; date = obj.date || obj.lastDate || ''; }
      }
      Object.values(obj).forEach(scan);
    }
  };
  if (data) scan(data);
  if (!rate) { // 兜底：整段文本里找 USD/CNY 附近 6~8 之间的数
    const m = text.match(/美元[^0-9]{0,20}([67]\.\d{3,4})/) || text.match(/USD[^0-9]{0,20}([67]\.\d{3,4})/);
    if (m) rate = parseFloat(m[1]);
  }
  if (!rate) throw new Error('未解析到美元中间价');
  return { rate, date };
}

// 构建“7/19 初始数据”状态（导入资产 + 灌入股票持仓 + 设定总资产）
function buildSeedState() {
  const assets = SEED_ASSETS.map(a => Object.assign({ id: uid() }, a));
  const positions = SEED_POSITIONS.map(sp => {
    const asset = SEED_ASSETS.find(a => a.code === sp.code);
    const cny = asset ? asset.cny : 0;
    return {
      id: uid(), name: sp.name, code: sp.code, factor: sp.factor,
      weight: +(cny / SEED_TOTAL * 100).toFixed(4),
      pnl: sp.pnl, trend: '震荡', maxDrop: sp.maxDrop,
      cost: sp.cost || 0, price: sp.price || 0, shares: sp.shares || 0,
    };
  });
  // 大类/类别拆分（用于 7/19 起点快照）
  const byBig = {}, byCat = {};
  assets.forEach(a => {
    byBig[bigClassOf(a.category)] = (byBig[bigClassOf(a.category)] || 0) + a.cny;
    byCat[a.category] = (byCat[a.category] || 0) + a.cny;
  });
  const seedSnap = {
    date: SEED_DATE,
    total: Math.round(SEED_TOTAL),
    byBig: Object.fromEntries(Object.entries(byBig).map(([k, v]) => [k, Math.round(v)])),
    byCat: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, Math.round(v)])),
    interest: 0, pnl: 0, fx: FX_DEFAULT,
    // 起点快照也带明细副本 → 任何时候都能「恢复到 7/19」
    assets: JSON.parse(JSON.stringify(assets)),
    positions: JSON.parse(JSON.stringify(positions)),
  };
  // 走 applyStateDefaults 补齐所有新字段（forecasts / corrCache / macro …），
  // 否则首次使用(种子态)缺字段会让新视图崩（如「市场指标」读 STATE.macro）。
  return applyStateDefaults({
    settings: Object.assign({}, DEFAULT_SETTINGS),
    positions,
    assets,
    portfolio: { totalAssets: Math.round(SEED_TOTAL), asOfDate: SEED_DATE, fxRate: FX_DEFAULT },
    snapshots: [seedSnap],
  });
}

// 真正的空状态（「清空全部数据」用；不能走 loadState 兜底，否则会重新载入种子数据）
function buildEmptyState() {
  return {
    settings: Object.assign({}, DEFAULT_SETTINGS),
    positions: [],
    assets: [],
    portfolio: { totalAssets: 0, asOfDate: '', fxRate: FX_DEFAULT },
    snapshots: [],
    forecasts: [],
    corrCache: null,
    macro: { market: {}, ind: {}, updatedAt: null },
  };
}

// 补齐字段默认值（本地/云端读入的状态都走这里）
function applyStateDefaults(s) {
  s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
  s.positions = s.positions || [];
  s.assets = s.assets || [];
  s.portfolio = Object.assign({ totalAssets: Math.round(SEED_TOTAL) }, s.portfolio || {});
  s.snapshots = s.snapshots || [];
  s.forecasts = s.forecasts || [];
  s.corrCache = s.corrCache || null;
  s.cashflows = s.cashflows || [];              // 出入金登记 [{id,date,amount,note}]，正=入金 负=出金（人民币）
  s.targetAlloc = s.targetAlloc || null;        // 再平衡目标配置 {buckets:{...}, threshold}，null=未设置
  s.layerOverrides = s.layerOverrides || {};    // 再平衡分层手动改层 {code||name: layerKey}，覆盖自动识别
  s.thesisFlags = s.thesisFlags || {};          // 「逻辑已破」标记 {code||name: true}，卖出排序最高优先
  s.theses = s.theses || {};                    // 个股决策卡 {code||name: {bull,bear,falsify[],entry,target,stop,months,scores,conf,date}}
  s.kellyEvals = s.kellyEvals || {};            // 凯利AI评估持久缓存 {codeKey: {win,up,down,date,factor,trend,...}}——刷新不丢，同参数同结果
  s.settings.benchKeys = Array.isArray(s.settings.benchKeys) ? s.settings.benchKeys : [];   // 资产趋势选中的对比基准（多选）
  s.macro = Object.assign({ market: {}, ind: {}, updatedAt: null }, s.macro || {});
  s.macro.market = s.macro.market || {}; s.macro.ind = s.macro.ind || {};
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return applyStateDefaults(JSON.parse(raw));
  } catch (e) { console.warn('状态读取失败', e); }
  return buildSeedState();   // 首次使用：自动载入 7/19 初始数据
}

let STATE = loadState();

function saveState() {
  STATE.savedAt = Date.now();                       // 记录保存时刻，供多设备取较新者
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); }
  catch (e) { console.warn('状态保存失败', e); }
  scheduleCloudPush();                              // 同时（防抖）回传云端
}

/* -------------------------------------------------------------------------
   修改日志（操作还原）：每个关键操作【执行前】把 资产/持仓/出入金 完整副本
   记入独立日志（本设备 localStorage，最多 30 条）。误删/录错 → 设置页一键
   还原到该操作前。行情刷新等高频写入不记录，日志不被噪声淹没。
   ------------------------------------------------------------------------- */
const OPLOG_KEY = STORAGE_KEY + '.oplog';
function loadOplog() { try { return JSON.parse(localStorage.getItem(OPLOG_KEY)) || []; } catch (e) { return []; } }
function logOp(label) {
  try {
    const log = loadOplog();
    log.unshift({
      ts: Date.now(), label,
      assets: JSON.parse(JSON.stringify(STATE.assets || [])),
      positions: JSON.parse(JSON.stringify(STATE.positions || [])),
      cashflows: JSON.parse(JSON.stringify(STATE.cashflows || [])),
    });
    while (log.length > 30) log.pop();
    localStorage.setItem(OPLOG_KEY, JSON.stringify(log));
  } catch (e) { console.warn('修改日志写入失败（不影响操作）', e); }
}
function restoreOp(entry) {
  if (!entry) return false;
  STATE.assets = JSON.parse(JSON.stringify(entry.assets || []));
  STATE.positions = JSON.parse(JSON.stringify(entry.positions || []));
  STATE.cashflows = JSON.parse(JSON.stringify(entry.cashflows || []));
  saveState();
  return true;
}

function uid() {
  return 'p' + Math.random().toString(36).slice(2, 9);
}

/* -------------------------------------------------------------------------
   每日资产快照（以 7/19 为起点）→ 支撑「资产趋势」按月/季/年查看
   ------------------------------------------------------------------------- */
function todayStr() {
  // 统一按东八区取日期（服务端快照 cron 也是东八区）：人在海外/跨时区打开页面时，
  // 快照日期、当日交易、pxDate 等口径与云端一致，不再产生错位或重复快照
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  } catch (e) {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
}
// 最近一个交易日（东八区口径，仅剔除周六日）：周末刷新行情时给 pxDate 用，
// 避免周六把周五的涨跌盖成「今日盈亏」
function lastTradingDayStr() {
  const t = todayStr();
  const d = new Date(t + 'T00:00:00');
  const back = d.getDay() === 6 ? 1 : d.getDay() === 0 ? 2 : 0;
  if (!back) return t;
  d.setDate(d.getDate() - back);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 生成当前组合快照对象（总资产 + 大类拆分 + 利息/浮盈亏 + 当日资产/持仓明细副本）
// 明细副本用于「设置 → 恢复到某一天」按日期整体还原。
function makeSnapshot(dateStr) {
  const assets = STATE.assets || [];
  const fx = currentFx();
  const byBig = {}, byCat = {};
  let interest = 0, pnl = 0;
  assets.forEach(a => {
    const v = assetCny(a, fx);
    byBig[bigClassOf(a.category)] = (byBig[bigClassOf(a.category)] || 0) + v;
    byCat[a.category] = (byCat[a.category] || 0) + v;
    const inc = assetIncome(a, fx);
    if (inc.kind === 'interest') interest += inc.value;
    else if (inc.value != null) pnl += inc.value;
  });
  return {
    date: dateStr,
    total: Math.round(portfolioTotal()),
    byBig: Object.fromEntries(Object.entries(byBig).map(([k, v]) => [k, Math.round(v)])),
    byCat: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, Math.round(v)])),
    interest: Math.round(interest),
    pnl: Math.round(pnl),
    fx: +fx.toFixed(4),
    // 当日明细副本（深拷贝），供「恢复到某一天」使用
    assets: JSON.parse(JSON.stringify(assets)),
    positions: JSON.parse(JSON.stringify(STATE.positions || [])),
  };
}

// 用某个快照的明细副本整体还原资产/持仓（快照历史本身保持不动）
function restoreFromSnapshot(snap) {
  if (!snap || !snap.assets || !snap.assets.length) return false;
  STATE.assets = JSON.parse(JSON.stringify(snap.assets));
  STATE.positions = JSON.parse(JSON.stringify(snap.positions || STATE.positions || []));
  if (snap.fx > 0) STATE.portfolio.fxRate = snap.fx;
  STATE.portfolio.asOfDate = snap.date;
  STATE.lastQuoteRefresh = 0;          // 还原后允许重新拉行情
  recordDailySnapshot();               // 重记今日快照：否则次日开盘持股按还原前的旧股数算，当日盈亏错一天
  saveState();
  return true;
}

// 每次进入应用记录「今日」快照：同日则覆盖为最新值，跨日则新增一条。
function recordDailySnapshot() {
  if (!STATE.assets || !STATE.assets.length) return;
  STATE.snapshots = STATE.snapshots || [];
  const t = todayStr();
  const snap = makeSnapshot(t);
  snap.ts = Date.now();                 // 记录采集时刻：云端写前对账用它判断同日快照谁更新
  const idx = STATE.snapshots.findIndex(s => s.date === t);
  if (idx >= 0) STATE.snapshots[idx] = snap;
  else STATE.snapshots.push(snap);
  STATE.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  saveState();
}

// 某天的出入金合计（人民币，正=入金 负=出金）
function cashflowOn(dateStr) {
  return (STATE.cashflows || []).filter(c => c.date === dateStr).reduce((s, c) => s + num(c.amount), 0);
}
// 区间出入金合计：fromExcl < 流水日期 ≤ toIncl。快照非连续（周末/漏记）时，
// 落在快照间隙里的流水也要计入，否则 TWR/归因把转入当收益（只看"恰好有快照那天"会漏）
function cashflowBetween(fromExcl, toIncl) {
  return (STATE.cashflows || []).filter(c => c.date > fromExcl && c.date <= toIncl).reduce((s, c) => s + num(c.amount), 0);
}
// 时间加权收益率(TWR)：相邻快照逐日收益率连乘，剔除出入金——
// r_i = (T_i − CF_i − T_{i-1}) / T_{i-1}（当日流水按开盘前到账近似）。
// 解决「净值变化 ≠ 真实收益率」：加仓后多赚的钱不是收益。仅总资产口径。
function twrOverall(snaps) {
  let acc = 1, days = 0, flows = 0;
  for (let i = 1; i < snaps.length; i++) {
    const prev = num(snaps[i - 1].total), cur = num(snaps[i].total);
    if (!(prev > 0)) continue;
    const cf = cashflowBetween(snaps[i - 1].date, snaps[i].date);   // 区间口径：间隙里的流水也剔除
    flows += cf;
    acc *= 1 + (cur - cf - prev) / prev;
    days++;
  }
  return { twr: (acc - 1) * 100, days, flows };
}

/* -------------------------------------------------------------------------
   全量云端同步（服务器 Nginx WebDAV：GET 读取 / PUT 写入 单文件 JSON）
   整份数据（持仓 / 资产 / 设置 / 快照）都存到你自己的服务器，换设备/清缓存自动恢复；
   本机浏览器仅作离线缓存。端点在全站访问密码之后，浏览器自动带同源凭证。
   多设备同时修改时，以最后保存（savedAt 较新）者为准。
   ------------------------------------------------------------------------- */
const CLOUD_STATE_URL = '/api/state';
// unknown | syncing | synced | local-only（云端不可用，先存本机，恢复后自动补传）
let cloudStatus = 'unknown';
let cloudAt = null;
let cloudPushTimer = null;
let cloudReady = false;      // 首次与云端对账完成前，不触发自动回传，避免空态覆盖云端

async function cloudGetState() {
  const res = await fetch(CLOUD_STATE_URL, { cache: 'no-store' });
  if (res.status === 404) return null;               // 云端尚未创建
  if (!res.ok) throw new Error('云端读取 ' + res.status);
  const text = (await res.text()).trim();
  if (!text) return null;
  return JSON.parse(text);
}

async function cloudPutState(state) {
  const res = await fetch(CLOUD_STATE_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error('云端保存 ' + res.status);
}

function scheduleCloudPush() {
  if (!cloudReady) return;                           // 尚未与云端对账完成，先不推
  if (cloudPushTimer) clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(pushCloudNow, 800);    // 防抖合并连续保存
}

async function pushCloudNow() {
  cloudPushTimer = null;
  cloudStatus = 'syncing'; updateCloudBadges();
  try {
    // 写前对账：云端可能已被其它写入方推进（每晚 cron 快照 / 另一台设备 / 另一标签页）。
    // 若云端 savedAt 比我们上次已知的（cloudAt）新：①云端独有日期的快照并入本地；
    // ②同日冲突时，本地快照采集时刻(ts)早于云端写入时刻的，采用云端版（cron 晚间抓的
    // 基金确认净值比早晨的快照准）。否则整文件 PUT 会把 cron 的晚间快照静默覆盖。
    try {
      const cloud = await cloudGetState();
      if (cloud && cloud.savedAt && cloudAt && cloud.savedAt > cloudAt && Array.isArray(cloud.snapshots)) {
        STATE.snapshots = STATE.snapshots || [];
        const byDate = new Map(STATE.snapshots.map((s, i) => [s.date, i]));
        let changed = 0;
        cloud.snapshots.forEach(sn => {
          if (!sn || !sn.date) return;
          const i = byDate.get(sn.date);
          if (i == null) { STATE.snapshots.push(sn); changed++; }
          else if (num(STATE.snapshots[i].ts) < cloud.savedAt && (sn.assets || []).length) { STATE.snapshots[i] = sn; changed++; }
        });
        if (changed) {
          STATE.snapshots.sort((a, b) => a.date.localeCompare(b.date));
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); } catch (e2) {}
        }
      }
    } catch (e) { /* 对账失败不阻断保存 */ }
    await cloudPutState(STATE);
    cloudStatus = 'synced'; cloudAt = STATE.savedAt || Date.now();
  } catch (e) {
    cloudStatus = 'local-only';
  }
  updateCloudBadges();
}

// 启动对账：拉云端 → 与本地取较新者 → 缺失方补齐。失败则退回仅本机。
async function initCloudSync() {
  cloudStatus = 'syncing'; updateCloudBadges();
  let cloud = null;
  try {
    cloud = await cloudGetState();
  } catch (e) {
    cloudStatus = 'local-only'; cloudReady = true; updateCloudBadges();
    return { changed: false };
  }
  let changed = false;
  if (cloud && (cloud.savedAt || 0) > (STATE.savedAt || 0)) {
    // 云端更新 → 采用云端并写入本机缓存
    STATE = applyStateDefaults(cloud);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); } catch (e) {}
    cloudStatus = 'synced'; cloudAt = STATE.savedAt; cloudReady = true; changed = true;
  } else {
    // 本地较新或云端为空 → 把本地推上去
    cloudReady = true;
    try { await cloudPutState(STATE); cloudStatus = 'synced'; cloudAt = STATE.savedAt || Date.now(); }
    catch (e) { cloudStatus = 'local-only'; }
  }
  updateCloudBadges();
  return { changed };
}

function cloudStatusText() {
  switch (cloudStatus) {
    case 'syncing': return '云端同步中…';
    case 'synced': return '已同步到云端（你的服务器）';
    case 'local-only': return '云端暂不可用，已存本机，恢复后自动补传';
    default: return '未同步';
  }
}
function cloudDotColor() {
  return cloudStatus === 'synced' ? 'var(--green)' : (cloudStatus === 'syncing' ? 'var(--amber)' : (cloudStatus === 'local-only' ? 'var(--red)' : 'var(--muted-2)'));
}
// 更新页面上任意云端状态指示（顶栏徽章 + 趋势页状态）
function updateCloudBadges() {
  const badge = document.getElementById('storage-badge-text');
  if (badge) badge.textContent = cloudStatus === 'local-only' ? '本地（待同步）' : (cloudStatus === 'syncing' ? '同步中…' : '云端同步');
  const t = document.getElementById('cloud-status-text');
  if (t) t.textContent = cloudStatusText();
  const dot = document.querySelector('.cloud-dot');
  if (dot) dot.style.background = cloudDotColor();
}

/* -------------------------------------------------------------------------
   白天 / 黑夜主题（记忆到本地；默认跟随系统）
   ------------------------------------------------------------------------- */
const THEME_KEY = 'rpm.theme';
function currentTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = themeToggleInner(next);
  // 主题变化后重绘（饼图/图表中心色需跟随主题）
  render();
}
function themeToggleInner(theme) {
  return theme === 'dark'
    ? icon('sun') + '<span>白天</span>'
    : icon('moon') + '<span>黑夜</span>';
}

/* -------------------------------------------------------------------------
   1. 计算库（模型速查表全部实现）
   ------------------------------------------------------------------------- */
const Calc = {
  // 期望值 EV = p×上涨幅度 − q×下跌幅度   （幅度用正数百分比）
  ev(p, upPct, downPct) {
    const q = 1 - p;
    return p * upPct - q * downPct;
  },

  // 净赔率 b = 上涨幅度 ÷ 下跌幅度
  odds(upPct, downPct) {
    if (downPct <= 0) return Infinity;
    return upPct / downPct;
  },

  // 凯利公式（二元赌注版）f = (b×p − q) / b —— 仅保留兼容，股票请用 kellyStock
  kelly(p, b) {
    if (!isFinite(b) || b <= 0) return 0;
    const q = 1 - p;
    return (b * p - q) / b;
  },

  // 凯利公式（股票/部分损失版）：上涨 u% / 下跌 d%（正百分数），输时只亏 d% 而非全损。
  // f* = (p·u − q·d)/(u·d)，返回小数（占总资金比例）。可 >1，故必须配分数凯利 + 单股上限。
  // 说明：原二元公式 (bp−q)/b 把「下跌」当成本金全损，对股票会系统性算错仓位——这里修正。
  kellyStock(p, upPct, downPct) {
    const u = upPct / 100, d = downPct / 100, q = 1 - p;
    if (!(u > 0) || !(d > 0)) return 0;
    return (p * u - q * d) / (u * d);
  },

  // 凯利稳健度：胜率 ±5 个点内正负号是否翻转。凯利在 EV≈0 附近是误差放大器
  // （AI 估计固有 ±5pp 噪声 → 仓位可摆动几十个点甚至翻号），翻号的结论一律不可用。
  // pos=悲观(−5pp)仍为正 → 可执行；neg=乐观(+5pp)仍≤0 → 稳健不值得下注；unstable=翻号 → 按0处理/观望
  kellyRobust(winPct, upPct, downPct) {
    const f = this.kellyStock(winPct / 100, upPct, downPct);
    const fPess = this.kellyStock(Math.max(0, winPct - 5) / 100, upPct, downPct);
    const fOpt = this.kellyStock(Math.min(100, winPct + 5) / 100, upPct, downPct);
    const verdict = fPess > 0 ? 'pos' : (fOpt <= 0 ? 'neg' : 'unstable');
    return { f, fPess, fOpt, verdict };
  },

  // 有效持仓数：按因子分组后 1 / Σ(因子权重²)（逆 HHI）
  // 反映实际押了几个"独立赌注"
  effectiveBets(positions) {
    const total = positions.reduce((s, p) => s + (Number(p.weight) || 0), 0);
    if (total <= 0) return { effN: 0, factorWeights: {}, total: 0, factorSum: {} };
    const factorSum = {};
    positions.forEach(p => {
      const f = p.factor || '其它';
      factorSum[f] = (factorSum[f] || 0) + (Number(p.weight) || 0);
    });
    let hhi = 0;
    const factorWeights = {};
    Object.keys(factorSum).forEach(f => {
      const w = factorSum[f] / total; // 归一化占比
      factorWeights[f] = w;
      hhi += w * w;
    });
    return { effN: hhi > 0 ? 1 / hhi : 0, factorWeights, total, factorSum };
  },

  // 相关性调整后的有效持仓数：effN_ρ = 1 / (wᵀ ρ w)，w 归一化权重，ρ 因子相关矩阵。
  // ρ=单位阵(彼此独立)时退化为 1/HHI；ρ 越接近全相关，effN 越小。
  // 与「按标签的有效持仓数」的差距 = 隐藏集中度（多只不同标签、实则同涨同跌）。
  corrEffectiveBets(positions, corrFn) {
    const items = positions.map(p => ({ f: p.factor || '其它', c: p.code || '', w: Number(p.weight) || 0 })).filter(x => x.w > 0);
    const tot = items.reduce((s, x) => s + x.w, 0);
    if (tot <= 0) return 0;
    const rho = corrFn || ((a, b) => factorCorr(a.f, b.f));
    const w = items.map(x => x.w / tot);
    let q = 0;
    for (let i = 0; i < items.length; i++)
      for (let j = 0; j < items.length; j++)
        q += w[i] * w[j] * (i === j ? 1 : rho(items[i], items[j]));
    // q = wᵀρw（组合方差样式量）。q≤0 说明相关矩阵退化/非半正定（实测两两估计可能如此）——
    // 此时绝不能报“满分散”，保守返回 1（视为完全集中）；正常时夹在 [1, n]。
    if (!(q > 0)) return 1;
    return Math.max(1, Math.min(items.length, 1 / q));
  },

  // 分散调整后的组合回撤估计：sqrt(ΣΣ wᵢwⱼ ρᵢⱼ ddᵢ ddⱼ)，dd=占比%×最大跌幅%。
  // ρ=1(全相关，危机情形)时退化为线性求和 Σ dd（即最坏情形）；这里给出「现实」下沿。
  corrDrawdown(positions, corrFn) {
    const items = positions.map(p => ({ f: p.factor || '其它', c: p.code || '', dd: (Number(p.weight) || 0) / 100 * (Number(p.maxDrop) || 0) })).filter(x => x.dd > 0);
    const rho = corrFn || ((a, b) => factorCorr(a.f, b.f));
    let q = 0;
    for (let i = 0; i < items.length; i++)
      for (let j = 0; j < items.length; j++)
        q += items[i].dd * items[j].dd * (i === j ? 1 : Math.max(0, rho(items[i], items[j]))); // 回撤同向，负相关按0(保守)
    return Math.sqrt(Math.max(0, q));
  },

  // 最大回撤贡献 = 持仓占比 × 该股最大跌幅
  drawdownContribution(weightPct, maxDropPct) {
    return (weightPct / 100) * maxDropPct;
  },

  // 固定分数止损最大仓位金额
  // 仓位金额 = (总资产 × 单笔风险%) ÷ 止损幅度%
  fixedFractionalSize(totalAssets, riskPct, buyPrice, stopPrice) {
    if (buyPrice <= 0 || stopPrice <= 0 || stopPrice >= buyPrice) return null;
    const stopPct = (buyPrice - stopPrice) / buyPrice; // 小数
    const riskAmount = totalAssets * (riskPct / 100);
    const positionValue = riskAmount / stopPct;
    return { stopPct: stopPct * 100, riskAmount, positionValue, shares: positionValue / buyPrice };
  },
};

/* -------------------------------------------------------------------------
   2. 工具函数
   ------------------------------------------------------------------------- */
function fmtPct(x, d = 1) {
  if (!isFinite(x)) return '—';
  return (x).toFixed(d) + '%';
}
function fmtMoney(x) {
  if (!isFinite(x)) return '—';
  return '¥' + Math.round(x).toLocaleString('zh-CN');
}
function num(v, def = 0) {
  const n = parseFloat(v);
  return isFinite(n) ? n : def;
}
// 凯利系数显示：0.25→¼，0.5→½，其它原样
function fracLabel(x) {
  if (Math.abs(x - 0.25) < 1e-9) return '¼';
  if (Math.abs(x - 0.5) < 1e-9) return '½';
  return String(+x.toFixed(2));
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  // Single root → return that element (so callers can style/query it directly).
  // Multiple roots → wrap in a transparent div so ALL nodes are preserved.
  if (t.content.children.length === 1) return t.content.firstElementChild;
  const wrap = document.createElement('div');
  wrap.appendChild(t.content);
  return wrap;
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* -------------------------------------------------------------------------
   3. 阻塞式确认弹窗（铁律拦截用，须二次确认）
   ------------------------------------------------------------------------- */
function showBlockingModal({ title, lines, confirmText = '我已知晓风险，仍要继续', cancelText = '取消操作' }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal');
    modal.innerHTML = `
      <div class="modal-head">
        <span class="mh-ic">${icon('danger')}</span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="modal-body">
        <p>该操作触发了以下铁律，请务必确认：</p>
        <ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>
        <p style="color:var(--muted);font-size:12px;margin-top:14px">
          纪律提示：多数散户的巨亏，正是在这类时刻放弃了纪律。
        </p>
      </div>
      <div class="modal-foot">
        <button class="btn secondary" id="modal-cancel">${escapeHtml(cancelText)}</button>
        <button class="btn danger" id="modal-confirm">${escapeHtml(confirmText)}</button>
      </div>`;
    overlay.classList.remove('hidden');
    modal.querySelector('#modal-cancel').onclick = () => { overlay.classList.add('hidden'); resolve(false); };
    modal.querySelector('#modal-confirm').onclick = () => { overlay.classList.add('hidden'); resolve(true); };
  });
}

/* -------------------------------------------------------------------------
   4. 视图路由
   ------------------------------------------------------------------------- */
const VIEWS = {};
// 支持 ?view=xxx 直达某个模块（分享链接/书签/移动端测试都可用）
let currentView = (() => {
  try {
    const v = new URLSearchParams(location.search).get('view');
    return v && typeof v === 'string' ? v : 'portfolio';
  } catch (_) { return 'portfolio'; }
})();

function render() {
  syncPositionsFromAssets();        // 渲染前先把持仓与最新资产对齐，各模块联动实时数据
  const app = document.getElementById('app');
  app.innerHTML = '';
  (VIEWS[currentView] || VIEWS.dashboard)(app);
}

// 移动端：把激活标签滚动进视野（11 个标签在手机上默认只露前几个）。
// 注意：网页字体加载完成后标签宽度会变，过早居中会"差一截"，
// 因此启动时除了立即居中，还要在 fonts.ready / load 后再补一次（见启动段）。
function centerActiveTab(behavior = 'auto') {
  const act = document.querySelector('.tab.active');
  if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'center', behavior });
}

function switchView(v) {
  currentView = v;
  try { history.replaceState(null, '', '?view=' + v); } catch (_) {}
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === v));
  centerActiveTab('smooth');
  render();
}

document.getElementById('tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (btn) switchView(btn.dataset.view);
});

/* =========================================================================
   视图：概览 Dashboard
   ========================================================================= */
VIEWS.dashboard = function (app) {
  const s = STATE.settings;
  const positions = STATE.positions;
  const equityPct = positions.reduce((a, p) => a + num(p.weight), 0);   // 弹性仓占总资产 %
  const target = num(s.equityTargetPct, 20);
  const level = EQUITY_RISK_LEVELS[s.equityRiskLevel] || EQUITY_RISK_LEVELS['进取'];
  const { effN, factorWeights } = Calc.effectiveBets(positions);
  const corrCache = STATE.corrCache;
  const corrFn = corrResolver(corrCache);               // 有历史K线缓存则用实测相关，否则 null→因子先验
  const corrSrc = corrFn ? '实测' : '先验';
  const corrEffN = Calc.corrEffectiveBets(positions, corrFn);   // 相关性调整后的有效持仓数（更真实）
  const nHoldings = positions.length;

  // 弹性仓对全组合的预估最大回撤贡献：
  //  · equityDD = Σ 占比×最大跌幅 = 全相关(危机)最坏情形（保守，用于守门）
  //  · equityDDReal = 分散调整后的现实下沿（sqrt 二次型，因子相关）
  const equityDD = positions.reduce((a, p) => a + Calc.drawdownContribution(num(p.weight), num(p.maxDrop)), 0);
  const equityDDReal = Calc.corrDrawdown(positions, corrFn);
  const ddOk = equityDD <= s.maxDrawdown;
  const usdExp = usdExposureCny();                        // 美元敞口（含汇率风险）
  const totForFx = portfolioTotal();

  // 因子最大集中度（factorWeights 已是"占弹性仓"的比例）
  let maxFactor = null, maxFactorW = 0;
  Object.keys(factorWeights).forEach(f => { if (factorWeights[f] > maxFactorW) { maxFactorW = factorWeights[f]; maxFactor = f; } });
  const factorCap = level.factor / 100;
  const concentrationOk = maxFactorW <= factorCap;

  // 单股占弹性仓 % 上限（配置角色，可比整体上限宽）
  const overSingle = positions.filter(p => equityPct > 0 && (num(p.weight) / equityPct * 100) > level.single + 1e-9);

  // 深套需复核逻辑的股（不是自动卖）
  const deep = positions.filter(p => num(p.pnl) <= -num(s.deepLossAdd, 20));

  app.appendChild(el(`
    <div class="view-head">
      <h2>股票体检 · 弹性引擎</h2>
      <p>你的股票是<strong>博收益弹性</strong>的引擎（由基金/理财/黄金/现金压舱），所以这里体检的是——<strong>这台引擎的总风险是否可控、是否真分散、有没有该复核的深套</strong>，而不是每只是否"保守"。目标弹性仓占比、风险档可在「设置」调。</p>
    </div>
  `));

  // 弹性引擎健康分（0–100，纯客观，不依赖 AI 猜胜率）
  let score = 100;
  if (!ddOk) score -= Math.min(35, (equityDD - s.maxDrawdown) / Math.max(1, s.maxDrawdown) * 45);
  if (!concentrationOk) score -= Math.min(25, (maxFactorW - factorCap) * 100);
  if (nHoldings >= 3 && effN > 0 && effN < 2.5) score -= Math.min(20, (2.5 - effN) * 10);
  if (equityPct > target * 1.5) score -= Math.min(15, (equityPct - target * 1.5) * 1.2);  // 弹性仓过大→整体风险抬升
  score = Math.max(5, Math.round(score));
  const scoreColor = score >= 70 ? 'var(--green-ink)' : (score >= 50 ? 'var(--amber-ink)' : 'var(--red-ink)');

  const sizeState = equityPct < target * 0.7 ? ['var(--amber-ink)', '偏低(弹性不足)'] : (equityPct > target * 1.5 ? ['var(--red-ink)', '偏高'] : ['var(--green-ink)', '合理']);

  app.appendChild(el(`
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat"><div class="label">${icon('gauge')} 弹性引擎健康分</div>
        <div class="value" style="color:${scoreColor}">${score}<span style="font-size:14px;color:var(--muted)"> /100</span></div>
        <div class="sub">纯客观，不依赖胜率预测</div></div>
      <div class="stat"><div class="label">${icon('coins')} 弹性仓占比</div>
        <div class="value" style="color:${sizeState[0]}">${fmtPct(equityPct,1)}</div>
        <div class="sub">目标 ${target}% · ${sizeState[1]}</div></div>
      <div class="stat"><div class="label">${icon('target')} 有效持仓数(${corrSrc}相关)</div>
        <div class="value" style="color:${corrEffN>=3?'var(--green-ink)':(corrEffN>=2?'var(--amber-ink)':'var(--red-ink)')}">${corrEffN?corrEffN.toFixed(1):'—'}</div>
        <div class="sub">名义 ${nHoldings} 只 · 标签口径 ${effN?effN.toFixed(1):'—'}</div></div>
      <div class="stat"><div class="label">${icon('trenddown')} 弹性仓回撤(最坏/现实)</div>
        <div class="value" style="color:${ddOk?'var(--green-ink)':'var(--red-ink)'}">${fmtPct(equityDD,1)}</div>
        <div class="sub">现实约 ${fmtPct(equityDDReal,1)} · 承受 ${s.maxDrawdown}%</div></div>
    </div>
  `));
  if (usdExp > 0 && totForFx > 0) app.appendChild(el(`<div class="card"><div class="alert blue"><span class="icon">${icon('globe')}</span><div>
    <strong>美元敞口 ${fmtPct(usdExp/totForFx*100,1)}（约 ${fmtMoney(usdExp)}）</strong>：这部分资产在人民币口径下同时承担<strong>标的波动 + 美元/人民币汇率</strong>双重风险。美股涨、美元跌时人民币收益会被汇率吃掉；汇率是独立风险因子，不应只看标的涨跌。当前中间价 ${currentFx()}。</div></div></div>`));

  // 核心解读：把"弹性仓风险"放到全组合语境
  app.appendChild(el(`<div class="card"><div class="alert ${ddOk?'blue':'red'}"><span class="icon">${ddOk?icon('info'):icon('danger')}</span><div>
    ${ddOk
      ? `<strong>关键结论：你的股票即便按各自最大跌幅同时回撤，对全组合的冲击约 ${fmtPct(equityDD,1)}，在你能承受的 ${s.maxDrawdown}% 之内。</strong>这正是"用小仓位博弹性、其余压舱"策略成立的依据——所以股票<strong>不必因为“单看每只都不够保守”就减</strong>，只要总风险可控、够分散即可。`
      : `<strong>注意：股票按各自最大跌幅同时回撤，对全组合冲击约 ${fmtPct(equityDD,1)}，已超你设的 ${s.maxDrawdown}% 承受线。</strong>这才是真正需要处理的信号——优先降波动最大/占比最高的那几只，而不是无差别清仓。`}
  </div></div></div>`));

  // 纪律体检清单（合并原「组合分散」）
  const checks = [];
  if (!ddOk) checks.push(['red', `弹性仓回撤贡献 ${fmtPct(equityDD,1)} > 全组合承受 ${s.maxDrawdown}%——见「③ 回撤控制」降高波动持仓`]);
  if (!concentrationOk && maxFactor) checks.push(['red', `因子「${maxFactor}」占弹性仓 ${fmtPct(maxFactorW*100,0)} > ${level.label}档上限 ${level.factor}%——过度押单一 beta`]);
  overSingle.forEach(p => checks.push(['amber', `${escapeHtml(p.name||'未命名')} 占弹性仓 ${fmtPct(num(p.weight)/equityPct*100,0)} > ${level.label}档单股上限 ${level.single}%`]));
  if (nHoldings >= 3 && corrEffN > 0 && corrEffN < nHoldings * 0.6) checks.push(['amber', `持 ${nHoldings} 只但相关性调整后有效持仓数仅 ${corrEffN.toFixed(1)}——假分散(多只押同一方向)`]);
  // 隐藏集中度：标签口径显示分散、但按真实相关性缩水 —— 这才是 README 承诺的「戳破假分散」
  if (nHoldings >= 3 && effN > 0 && corrEffN > 0 && (effN - corrEffN) >= 0.8)
    checks.push(['amber', `隐藏集中度：按因子标签看有效持仓数 ${effN.toFixed(1)}，但按真实相关性只剩 ${corrEffN.toFixed(1)}——多只标签不同、实则同涨同跌，别被“看着分散”骗了`]);
  deep.forEach(p => checks.push(['amber', `${escapeHtml(p.name||'未命名')} 深套 ${fmtPct(num(p.pnl),1)}——请复核买入逻辑是否仍成立(见「⑤ 加减仓 → 减仓/退出」)，不是自动卖`]));
  if (equityPct < target * 0.7) checks.push(['blue', `弹性仓仅 ${fmtPct(equityPct,1)} < 目标 ${target}%——若想要更高收益弹性，可在纪律内逐步补到目标附近`]);
  if (checks.length === 0 && nHoldings > 0) checks.push(['green', '弹性引擎风险可控、分散达标，无需处理']);

  const checklist = el('<div class="card" style="margin-top:16px"><h3>纪律体检 + 分散</h3></div>');
  if (nHoldings === 0) {
    checklist.appendChild(el(`<div class="empty"><div class="big">${icon('clipboard')}</div><p>还没有股票持仓。先到「持仓」页录入。</p></div>`));
  } else {
    checks.forEach(([type, msg]) => checklist.appendChild(el(`<div class="alert ${type}"><span class="icon">${type==='red'?icon('danger'):type==='amber'?icon('warn'):type==='blue'?icon('info'):icon('check')}</span><div>${msg}</div></div>`)));
  }
  app.appendChild(checklist);

  // 因子暴露饼图（原「组合分散」核心图，合并到此）
  if (nHoldings > 0) {
    const pieCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('pie')} 因子暴露（真实分散度）</h3>
      <p class="hint">一眼看清弹性仓真正押注的方向与集中度。有效持仓数 ${effN.toFixed(1)}／名义 ${nHoldings}——差距越大，说明"看着分散、实则押一个方向"。</p></div>`);
    pieCard.appendChild(buildPie(factorWeights));
    app.appendChild(pieCard);

    // 真实相关性（历史K线）：拉日K算实测相关矩阵、波动、历史最大回撤
    renderRealCorrCard(app, positions);
  }
};

/* 真实相关性卡片：拉历史日K → 实测相关矩阵 + 每股波动/历史最大回撤 + 一键回填 maxDrop */
// 相关性热力图的确定性解读（无 AI、可复现）：找高相关对、冗余股、最佳分散器、隐藏集中度、行动建议
function analyzeCorrelation(c, holdings) {
  const out = [];
  if (!c || !c.matrix || !c.codes || c.codes.length < 2) return out;
  const n = c.codes.length, names = c.names || c.codes;
  const roles = c.roles || c.codes.map(() => 'stock');
  const isFund = i => roles[i] === 'fund';
  const tag = i => isFund(i) ? '（基金·压舱）' : '（个股·弹性）';
  const wOf = code => { const p = (holdings || []).find(x => x.code === code); return p ? num(p.weight) : 0; };
  const stockIdx = [], fundIdx = [];
  for (let i = 0; i < n; i++) (isFund(i) ? fundIdx : stockIdx).push(i);
  // 1 两两相关对排序（跨核心/卫星都看）
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const r = c.matrix[i][j]; if (r != null && isFinite(r)) pairs.push({ i, j, r }); }
  pairs.sort((a, b) => b.r - a.r);
  const hi = pairs.filter(p => p.r >= 0.7), mid = pairs.filter(p => p.r >= 0.5 && p.r < 0.7);
  if (hi.length) {
    out.push(['red', `发现 ${hi.length} 对<strong>高度同涨同跌（ρ≥0.7）</strong>——这些就是"假分散"的元凶，实际近似<strong>一注</strong>：`]);
    hi.slice(0, 6).forEach(p => out.push(['pair', `${escapeHtml(names[p.i])}${tag(p.i)} ↔ ${escapeHtml(names[p.j])}${tag(p.j)}　ρ=${p.r.toFixed(2)}（占比 ${wOf(c.codes[p.i]).toFixed(1)}% / ${wOf(c.codes[p.j]).toFixed(1)}%）`]));
  } else if (mid.length) {
    out.push(['amber', `无 ρ≥0.7 的对，但有 ${mid.length} 对中度相关（0.5–0.7）：`]);
    mid.slice(0, 5).forEach(p => out.push(['pair', `${escapeHtml(names[p.i])}${tag(p.i)} ↔ ${escapeHtml(names[p.j])}${tag(p.j)}　ρ=${p.r.toFixed(2)}`]));
  } else {
    out.push(['green', '未发现 ρ≥0.5 的高相关对，整体分散良好。']);
  }
  // 2 核心/卫星：每只压舱基金对「个股弹性仓」的平均相关 = 压舱质量（越低越能对冲个股回撤）
  if (fundIdx.length && stockIdx.length) {
    const fundAvg = fundIdx.map(fi => {
      let s = 0, cnt = 0;
      stockIdx.forEach(si => { const r = c.matrix[fi][si]; if (r != null && isFinite(r)) { s += r; cnt++; } });
      return { fi, a: cnt ? s / cnt : null };
    }).filter(x => x.a != null).sort((a, b) => a.a - b.a);
    if (fundAvg.length) {
      out.push(['info', `<strong>核心/卫星（基金压舱 vs 个股弹性）</strong>：每只基金与你个股仓的平均相关——越低越能在个股回撤时稳住组合。`]);
      fundAvg.forEach(x => {
        const q = x.a < 0.3 ? '压舱强' : x.a < 0.55 ? '压舱中' : '与个股同向、压舱弱';
        out.push(['pair', `${escapeHtml(names[x.fi])}　平均相关 ${x.a.toFixed(2)}　→ ${q}`]);
      });
      const best = fundAvg[0], worst = fundAvg[fundAvg.length - 1];
      if (best.a < 0.3) out.push(['green', `<strong>${escapeHtml(names[best.fi])}</strong> 与个股几乎不同向（${best.a.toFixed(2)}）——真正的压舱石，红利低波/高股息该有的样子，值得作为底仓。`]);
      if (worst.a >= 0.6) out.push(['amber', `<strong>${escapeHtml(names[worst.fi])}</strong> 与个股高度同向（${worst.a.toFixed(2)}）——多半是宽基/科技类，和你的弹性仓吃同一波市场beta，别把它当"分散"，它更像加杠杆的个股。`]);
    }
  }
  // 3 冗余度（对其余的平均相关）：最高=最冗余，最低/负=最佳分散器
  const avg = [];
  for (let i = 0; i < n; i++) { let s = 0, cnt = 0; for (let j = 0; j < n; j++) if (i !== j && c.matrix[i][j] != null) { s += c.matrix[i][j]; cnt++; } avg.push({ i, a: cnt ? s / cnt : 0 }); }
  avg.sort((x, y) => y.a - x.a);
  if (avg.length >= 2) {
    const worst = avg[0], best = avg[avg.length - 1];
    out.push(['info', `最"冗余"的一只：<strong>${escapeHtml(names[worst.i])}</strong>${tag(worst.i)}（与其余平均相关 ${worst.a.toFixed(2)}）——对分散贡献最小，要精简优先考虑它。`]);
    if (best.a < 0.35) out.push(['green', `最好的分散器：<strong>${escapeHtml(names[best.i])}</strong>${tag(best.i)}（平均相关 ${best.a.toFixed(2)}）——在压低组合共振，值得保留。`]);
  }
  // 4 隐藏集中度：只对「个股弹性仓」算（基金无因子标签），标签 effN vs 相关性 effN
  const stockPositions = (STATE.positions || []).filter(p => p.code);
  const labelEff = Calc.effectiveBets(stockPositions).effN;
  const corrEff = Calc.corrEffectiveBets(stockPositions, corrResolver(c));
  if (labelEff && corrEff) out.push([(labelEff - corrEff) >= 0.8 ? 'amber' : 'info', `个股弹性仓：按因子标签有效持仓数 ${labelEff.toFixed(1)}，按真实相关只剩 <strong>${corrEff.toFixed(1)}</strong>${(labelEff - corrEff) >= 0.8 ? '——差距=被标签掩盖的隐藏集中度' : ''}。`]);
  // 5 行动建议
  if (hi.length) {
    const p = hi[0], wi = wOf(c.codes[p.i]), wj = wOf(c.codes[p.j]);
    const trim = wi >= wj ? names[p.i] : names[p.j];
    out.push(['action', `<strong>怎么办</strong>：${escapeHtml(names[p.i])} 与 ${escapeHtml(names[p.j])} 高度重叠，二选一即可；若都想留，把两者合计仓位当"一注"控上限。要精简，先减仓位更大的 <strong>${escapeHtml(trim)}</strong>，或换成与组合低相关的标的，把有效持仓数提上去。`]);
  }
  return out;
}

function renderRealCorrCard(app, positions) {
  const card = el(`<div class="card" style="margin-top:16px"><h3>${icon('globe')} 真实相关性（历史序列）</h3>
    <p class="hint">把<strong>个股弹性仓 + 压舱基金 + 美股</strong>放一起：个股/ETF/美股取约 160 个交易日前复权收盘价，场外基金取历史净值序列，算<strong>实测</strong>两两相关（替代因子先验），并给出各标的年化波动与<strong>历史最大回撤</strong>，可一键回填个股「最大跌幅」。<strong>核心/卫星</strong>视角看基金能否真正对冲个股回撤。取不到序列的标的自动回退因子先验。</p></div>`);
  const bar = el(`<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" id="rc-go" style="flex:0 0 auto">${icon('refresh')} 拉取历史序列·计算真实相关性</button><button class="btn secondary" id="rc-diag" style="flex:0 0 auto">${icon('search')} 接口自检</button><span id="rc-note" class="inline-note" style="align-self:center"></span></div>`);
  card.appendChild(bar);
  const out = el('<div id="rc-out"></div>');
  const diag = el('<div id="rc-diag-out"></div>');
  card.appendChild(diag);
  card.appendChild(out);
  app.appendChild(card);

  // 接口自检：显示「本地状态识别出的标的」+「新接口原始返回」，一眼看清是没识别到还是接口没通
  bar.querySelector('#rc-diag').onclick = async () => {
    const btn = bar.querySelector('#rc-diag');
    btn.disabled = true; diag.innerHTML = `<p class="inline-note">${icon('refresh','spin')} 自检中…</p>`;
    const lines = [];
    const hs = corrHoldings();
    const funds = hs.filter(h => h.role === 'fund'), stocks = hs.filter(h => h.role === 'stock');
    const usH = hs.filter(h => isUsCode(h.code));
    lines.push(`<strong>状态识别</strong>：共 ${hs.length} 个标的 → 个股/美股 ${stocks.length}、基金 ${funds.length}；其中美股 ${usH.length} 只（${usH.map(h=>escapeHtml(h.code)).join('、')||'无'}）`);
    lines.push(`基金清单：${funds.length? funds.map(f=>escapeHtml(f.code+' '+f.name)).join('；') : '<span style="color:var(--red-ink)">0 只——说明「投资组合」里没有 category=基金 且代码为6位的资产，或都被当成现金类排除了</span>'}`);
    const probe = async (label, url) => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        const t = await r.text();
        lines.push(`<strong>${label}</strong> [HTTP ${r.status}] 前240字：<code style="font-size:11px;word-break:break-all">${escapeHtml(t.slice(0,240))||'(空)'}</code>`);
      } catch (e) { lines.push(`<strong>${label}</strong> 请求异常：${escapeHtml(e.message)}`); }
    };
    const oneFund = funds[0] ? funds[0].code : '020602';
    const oneUs = usH[0] ? ('us' + usH[0].code.toUpperCase()) : 'usTCOM';
    await probe(`基金净值接口 /api/fundhist（${oneFund}）`, '/api/fundhist?fundCode=' + encodeURIComponent(oneFund) + '&pageIndex=1&pageSize=20');
    await probe(`美股K线接口 /api/uskline（${oneUs}）`, '/api/uskline?param=' + encodeURIComponent(oneUs + ',day,,,20,qfq'));
    diag.innerHTML = `<div class="alert blue" style="margin-top:10px"><span class="icon">${icon('info')}</span><div style="line-height:1.7">${lines.join('<br>')}</div></div>`;
    btn.disabled = false;
  };

  const cache = STATE.corrCache;
  const heat = (v) => {
    if (v == null || !isFinite(v)) return 'var(--surface-soft)';
    const t = Math.max(0, Math.min(1, (v + 0.2) / 1.2)); // −0.2→0, 1.0→1
    const r = Math.round(52 + t * (255 - 52)), g = Math.round(199 - t * (199 - 55)), b = Math.round(89 - t * (89 - 95));
    return `rgba(${r},${g},${b},0.85)`;
  };
  const renderCache = (c) => {
    if (!c || !c.codes || !c.codes.length) { out.innerHTML = ''; return; }
    const n = c.codes.length;
    // 缓存比当前可纳入的标的少（多半是旧版本算的、没含基金/美股）→ 提示重算，避免"看着还是6只"的误会
    const avail = corrHoldings().length;
    const staleHint = (avail > n) ? `<div class="alert amber" style="margin-top:10px"><span class="icon">${icon('warn')}</span><div>下面是<strong>上次缓存</strong>的结果（${n} 个标的）。当前可纳入 <strong>${avail}</strong> 个（含基金/美股），点上方蓝色<strong>「拉取历史序列」</strong>重算即可纳入。</div></div>` : '';
    const roles = c.roles || c.codes.map(() => 'stock');
    const dot = i => roles[i] === 'fund' ? '<span title="压舱基金" style="color:var(--accent)">◆</span>' : '<span title="个股/美股弹性" style="color:var(--muted)">●</span>';
    const shortN = c.names.map(nm => (nm || '').slice(0, 4));
    const head = '<th></th>' + shortN.map((nm, i) => `<th class="num" style="font-size:11px">${dot(i)}${escapeHtml(nm)}</th>`).join('');
    const body = c.matrix.map((row, i) => `<tr><td style="font-size:11px;white-space:nowrap">${dot(i)}${escapeHtml(shortN[i])}</td>` +
      row.map((v, j) => `<td class="num" style="background:${i===j?'var(--surface-soft)':heat(v)};color:${i===j?'var(--muted)':'#fff'};font-size:11px">${i===j?'1.00':(v==null?'—':v.toFixed(2))}</td>`).join('') + '</tr>').join('');
    const statRows = c.stats.map(st => `<tr><td>${st.role==='fund'?'<span style="color:var(--accent)">◆</span>':'<span style="color:var(--muted)">●</span>'}${escapeHtml(st.name)}${st.prior?'<span class="inline-note"> · 因子先验</span>':''}</td>
      <td class="num" style="font-size:11px;color:var(--muted)">${st.role==='fund'?'基金':'个股/美股'}</td><td class="num">${st.days||'—'}</td>
      <td class="num">${st.vol!=null?fmtPct(st.vol,0):'—'}</td>
      <td class="num" style="color:var(--red-ink)">${st.mdd!=null?fmtPct(st.mdd,0):'—'}</td></tr>`).join('');
    // 失败诊断：带出每只的错误原因，方便定位是接口没通还是代码不支持
    const failNote = (c.failed && c.failed.length) ? `<div class="alert amber" style="margin-top:10px"><span class="icon">${icon('warn')}</span><div><strong>${c.failed.length} 只未取到历史序列</strong>（这些仍用因子先验，不影响其它）：<br>${c.failed.map(f=>`· ${escapeHtml(f.name)}（${escapeHtml(f.code||'无代码')}）：${escapeHtml(f.err||'未知')}`).join('<br>')}</div></div>` : '';
    // 智能解读（自动、确定性）
    const analysis = analyzeCorrelation(c, corrHoldings());
    const anaAlert = (t, m) => {
      if (t === 'pair') return `<div style="font-size:12px;margin:2px 0 2px 32px;font-family:monospace;color:var(--muted)">· ${m}</div>`;
      const cls = t === 'red' ? 'red' : t === 'amber' ? 'amber' : t === 'green' ? 'green' : 'blue';
      const ic = t === 'red' ? icon('danger') : t === 'amber' ? icon('warn') : t === 'green' ? icon('check') : t === 'action' ? icon('target') : icon('info');
      return `<div class="alert ${cls}" style="margin-top:8px"><span class="icon">${ic}</span><div>${m}</div></div>`;
    };
    const anaHtml = analysis.length ? `<h4 style="margin:18px 0 6px">${icon('sparkles')} 智能解读（自动）</h4>` + analysis.map(x => anaAlert(x[0], x[1])).join('') : '';
    out.innerHTML = `
      <p class="inline-note" style="margin-top:6px">数据日期 ${escapeHtml(c.date)} · 颜色越红＝相关性越高（同涨同跌）、越绿＝越低/负相关。</p>
      ${staleHint}
      ${failNote}
      <div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      ${anaHtml}
      <div class="table-scroll" style="margin-top:14px"><table>
        <thead><tr><th>标的</th><th class="num">类型</th><th class="num">样本天数</th><th class="num">年化波动</th><th class="num">历史最大回撤</th></tr></thead>
        <tbody>${statRows}</tbody></table></div>
      <div class="row" style="gap:8px;margin-top:10px"><button class="btn secondary" id="rc-fill" style="flex:0 0 auto">${icon('download')} 用历史最大回撤回填各股「最大跌幅」</button></div>
      <p class="inline-note">回填后「③ 回撤控制」「股票体检」的回撤口径将基于真实历史，而非手填估计。回填只覆盖能取到序列的<strong>个股</strong>（基金不进弹性仓回撤口径）。</p>`;
    const fill = out.querySelector('#rc-fill');
    if (fill) fill.onclick = () => {
      logOp('回填历史最大回撤到「最大跌幅」');
      let cnt = 0;
      c.stats.forEach(st => {
        const p = (STATE.positions || []).find(x => x.code === st.code);
        if (p && st.mdd > 0) { p.maxDrop = Math.round(st.mdd); cnt++; }
      });
      saveState(); alert(`已用历史最大回撤回填 ${cnt} 只持仓的「最大跌幅」。`); render();
    };
  };
  renderCache(cache);

  bar.querySelector('#rc-go').onclick = async () => {
    const btn = bar.querySelector('#rc-go'), note = bar.querySelector('#rc-note');
    btn.disabled = true; note.innerHTML = icon('refresh', 'spin') + ' 拉取历史序列中（个股日K + 基金净值），约 5–25 秒…';
    try {
      const c = await buildRealCorr(corrHoldings());
      STATE.corrCache = c; saveState();
      const nf = (c.roles || []).filter(r => r === 'fund').length, ns = (c.codes.length - nf);
      note.innerHTML = `${icon('check')} 已更新（个股/美股 ${ns} + 基金 ${nf}，数据日期 ${c.date}）`;
      renderCache(c);
    } catch (e) {
      note.innerHTML = `${icon('warn')} 获取失败：${escapeHtml(e.message)}——已保留因子先验，不影响其它功能`;
    } finally { btn.disabled = false; }
  };
}

/* SVG 饼图 + 图例 */
function buildPie(factorWeights, opts) {
  opts = opts || {};
  const entries = Object.entries(factorWeights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  const wrap = el('<div class="pie-wrap"></div>');
  if (entries.length === 0) {
    wrap.appendChild(el('<p class="inline-note">暂无可视化数据（各持仓占比为 0 或未录入）。</p>'));
    return wrap;
  }
  const size = 184, R = 84, rIn = 50, cx = 92, cy = 92;
  const total = opts.total;
  // 用「圆环 + stroke 分隔」画甜甜圈：每段是一条描边圆弧，段间留细缝，中心镂空干净。
  const circ = 2 * Math.PI * ((R + rIn) / 2);
  const stroke = R - rIn;
  const rMid = (R + rIn) / 2;
  let acc = 0;
  const arcs = entries.map(([f, w], i) => {
    const color = FACTOR_COLORS[i % FACTOR_COLORS.length];
    const frac = Math.min(w, 1);
    const gap = entries.length > 1 ? 0.006 : 0;            // 段间细缝
    const len = Math.max(circ * (frac - gap), 0.5);
    const dash = `${len} ${circ - len}`;
    const offset = -circ * acc;
    acc += frac;
    // 圆弧从 12 点方向顺时针：旋转 -90°
    return `<circle cx="${cx}" cy="${cy}" r="${rMid}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${dash}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
  }).join('');
  const centerLabel = total != null
    ? `<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="pie-center-v">${fmtMoney(total)}</text>
       <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="pie-center-k">总资产</text>`
    : '';
  wrap.appendChild(el(`<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}${centerLabel}</svg>`));

  const legend = el('<div class="legend"></div>');
  entries.forEach(([f, w], i) => {
    const color = FACTOR_COLORS[i % FACTOR_COLORS.length];
    const over = w > 0.6;
    legend.appendChild(el(`<div class="legend-item">
      <span class="legend-dot" style="background:${color}"></span>
      <span class="legend-name">${escapeHtml(f)}</span>
      <span class="legend-val" style="color:${over?'var(--red)':'var(--ink-2)'}">${fmtPct(w*100,0)}${over?' '+icon('warn'):''}</span>
    </div>`));
  });
  wrap.appendChild(legend);
  return wrap;
}

/* 折线/面积图：资产趋势用。points = [{label, value}]，返回 SVG。 */
function buildLineChart(points, opts) {
  opts = opts || {};
  const w = opts.width || 640, h = opts.height || 220;
  const padL = 8, padR = 12, padT = 16, padB = 26;
  const iw = w - padL - padR, ih = h - padT - padB;
  if (!points.length) return el('<div class="empty">暂无数据</div>');
  // opts.extra：叠加的对比序列（如基准指数），与主序列等长、共享 X 轴
  const extras = (opts.extra || []).filter(e => e && Array.isArray(e.points) && e.points.length === points.length);
  const vals = points.map(p => p.value);
  extras.forEach(e => e.points.forEach(p => { if (isFinite(p.value)) vals.push(p.value); }));
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { const d0 = Math.abs(min) * 0.02 || 1; min -= d0; max += d0; }   // 用绝对偏移撑开区间：负值序列不会 min/max 翻转
  const pad = (max - min) * 0.12; min -= pad; max += pad;
  const n = points.length;
  const X = i => padL + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const Y = v => padT + ih * (1 - (v - min) / (max - min));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const extraLines = extras.map(e => {
    const d = e.points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${e.color || 'var(--muted)'}" stroke-width="1.8"${e.dash ? ` stroke-dasharray="${e.dash}"` : ''} stroke-linejoin="round"/>`;
  }).join('');
  const area = `${line} L${X(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${X(0).toFixed(1)},${(padT + ih).toFixed(1)} Z`;
  // 网格线（4 条）
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const gy = padT + ih * g / 4;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${w - padR}" y2="${gy.toFixed(1)}" class="chart-grid"/>`;
  }
  // 端点/首点标注
  const dots = points.map((p, i) =>
    (n <= 12 || i === 0 || i === n - 1)
      ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="3" class="chart-dot"/>` : '').join('');
  // X 轴标签（最多约 6 个）
  const step = Math.max(1, Math.ceil(n / 6));
  let xlab = '';
  points.forEach((p, i) => {
    if (i % step === 0 || i === n - 1) {
      xlab += `<text x="${X(i).toFixed(1)}" y="${h - 8}" text-anchor="middle" class="chart-xlab">${escapeHtml(p.label)}</text>`;
    }
  });
  const svg = el(`<svg class="linechart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}">
    <defs><linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#lc-fill)"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${extraLines}
    ${dots}${xlab}
  </svg>`);
  if (typeof opts.tooltip !== 'function') return svg;
  // 悬停交互：鼠标移动 → 吸附最近数据点，显示引导线 + 高亮点 + 提示框（内容由调用方格式化）
  const NS = 'http://www.w3.org/2000/svg';
  const guide = document.createElementNS(NS, 'line');
  guide.setAttribute('class', 'chart-guide');
  guide.setAttribute('y1', padT); guide.setAttribute('y2', padT + ih);
  guide.style.display = 'none';
  const marker = document.createElementNS(NS, 'circle');
  marker.setAttribute('class', 'chart-dot-hover');
  marker.setAttribute('r', 4.5);
  marker.style.display = 'none';
  svg.appendChild(guide); svg.appendChild(marker);
  // 叠加序列各自的高亮点：多条基准同时对比时，悬停能看清每条线在该日的位置
  const exMarkers = extras.map(e => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', 3.5);
    c.setAttribute('fill', e.color || 'var(--muted)');
    c.style.display = 'none';
    svg.appendChild(c);
    return c;
  });
  const wrap = el('<div style="position:relative"></div>');
  wrap.appendChild(svg);
  const tip = el('<div class="chart-tip"></div>');
  wrap.appendChild(tip);
  svg.style.cursor = 'crosshair';
  svg.addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const vx = (e.clientX - r.left) / r.width * w;          // 像素 → viewBox 坐标
    let i = n === 1 ? 0 : Math.round((vx - padL) / iw * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    guide.setAttribute('x1', X(i)); guide.setAttribute('x2', X(i));
    guide.style.display = '';
    marker.setAttribute('cx', X(i)); marker.setAttribute('cy', Y(points[i].value));
    marker.style.display = '';
    exMarkers.forEach((c, k) => {
      const p = extras[k].points[i];
      if (p && isFinite(p.value)) { c.setAttribute('cx', X(i)); c.setAttribute('cy', Y(p.value)); c.style.display = ''; }
      else c.style.display = 'none';
    });
    tip.innerHTML = opts.tooltip(i, points);
    tip.style.display = 'block';
    const pxX = X(i) / w * r.width;
    const left = Math.max(0, Math.min(pxX - tip.offsetWidth / 2, r.width - tip.offsetWidth));
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, Y(points[i].value) / h * r.height - tip.offsetHeight - 10) + 'px';
  });
  svg.addEventListener('mouseleave', () => {
    guide.style.display = 'none'; marker.style.display = 'none'; tip.style.display = 'none';
    exMarkers.forEach(c => { c.style.display = 'none'; });
  });
  return wrap;
}

/* -------------------------------------------------------------------------
   行情获取：股票代码 → 市场前缀 / 名称 + 最新价
   浏览器同源请求 /api/quote（由服务器 Nginx 代理新浪财经，规避 CORS 与 Referer）
   ------------------------------------------------------------------------- */
function detectMarket(code) {
  code = String(code || '').trim();
  if (/^6/.test(code)) return 'sh';                       // 沪市股票（600/601/603/605/688…）
  if (/^(5|11|13)/.test(code)) return 'sh';               // 沪市 ETF/LOF/基金/可转债（50/51/52/56/58/511/113…）
  if (/^(4|8)/.test(code) || /^920/.test(code)) return 'bj'; // 北交所
  return 'sz';                                            // 深市（000/002/003/300/15x/16x…）
}

// 判断是否美股代码（含字母，如 TCOM、AAPL、BABA、BRK.B）
function isUsCode(code) {
  return /[A-Za-z]/.test(String(code || '').trim());
}

async function getQuoteText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('接口返回 ' + res.status);
  const buf = await res.arrayBuffer();
  try { return new TextDecoder('gbk').decode(buf); }   // 行情源为 GBK 编码
  catch (e) { return new TextDecoder('utf-8').decode(buf); }
}

// 腾讯：A股 v_sz002518="51~科士达~002518~现价(p3)~昨收(p4)~今开(p5)~…";
//       美股 v_usTCOM="200~200~TCOM.OQ~现价(p3)~昨收(p4)~今开(p5)~…~USD~…~公司名~…";
// 关键：美股与 A股「现价/昨收」同为 p[3]/p[4]；美股 p[1] 是数字非名称、p[5] 是今开非涨跌幅。
function parseTencent(text, opts) {
  opts = opts || {};
  const m = text.match(/"([^"]*)"/);
  if (!m || !m[1]) throw new Error('无数据');
  const p = m[1].split('~');
  let price = parseFloat(p[3]);
  if (!(price > 0)) price = parseFloat(p[4]);         // 休市回退昨收
  const prevClose = parseFloat(p[4]);                 // 昨收（美股/A股同为 p[4]）
  const changePct = (prevClose > 0 && price > 0) ? (price - prevClose) / prevClose * 100 : null;
  let name = p[1];
  if (opts.us) {                                       // 美股名称取靠后「含空格的字母」字段（如 "Trip Com Group Ltd"）
    name = (p.find(f => /[A-Za-z]/.test(f) && /\s/.test(f) && f.trim().length > 3) || p[2] || '').trim();
  }
  if (!name || !(price > 0)) throw new Error('解析失败');   // 现价/昨收都为 0（停牌坏数据）视为失败，不能返回 price=0
  return { name, price, changePct: isFinite(changePct) ? changePct : null, prevClose: prevClose > 0 ? prevClose : null };
}

// 新浪：var hq_str_sz002518="科士达,今开,昨收,现价,…"；美股 gb_：var hq_str_gb_tcom="名称,现价,涨跌幅,…"
function parseSina(text, opts) {
  opts = opts || {};
  const m = text.match(/"([^"]*)"/);
  if (!m || !m[1]) throw new Error('无数据');
  const p = m[1].split(',');
  const name = p[0];
  let price, changePct = null, prevClose = null;
  if (opts.us) {
    price = parseFloat(p[1]);                         // 美股：p[1]=现价, p[2]=涨跌幅%
    changePct = parseFloat(p[2]);
    if (isFinite(changePct)) prevClose = price / (1 + changePct / 100);
  } else {
    price = parseFloat(p[3]);
    prevClose = parseFloat(p[2]);                     // 昨收
    if (!(price > 0)) price = prevClose;
    if (prevClose > 0) changePct = (price - prevClose) / prevClose * 100;
  }
  if (!name || !(price > 0)) throw new Error('解析失败');   // 同 parseTencent：坏数据不能返回 price=0
  return { name, price, changePct: isFinite(changePct) ? changePct : null, prevClose: prevClose > 0 ? prevClose : null };
}

// 东财实时报价（经 /api/emquote 代理）：secid 形如 105.AAPL（105纳斯达克/106纽交所/107美交所）、
// 1.600000（沪）/0.000001（深）。f43 现价、f60 昨收（都要 ÷10^f59）、f58 名称。无数据返回 null。
async function emQuote(secid) {
  try {
    const res = await fetch('/api/emquote?secid=' + encodeURIComponent(secid) + '&fields=f43,f58,f59,f60', { cache: 'no-store' });
    if (!res.ok) return null;
    const d = (await res.json()).data;
    if (!d || !isFinite(d.f43)) return null;
    const scale = Math.pow(10, d.f59 || 0);
    const price = d.f43 / scale, prevClose = d.f60 / scale;
    if (!(price > 0)) return null;
    return { name: d.f58 || '', price, changePct: prevClose > 0 ? (price - prevClose) / prevClose * 100 : null, prevClose: prevClose > 0 ? prevClose : null };
  } catch (e) { return null; }
}

async function fetchQuote(rawCode) {
  const code = String(rawCode || '').trim();

  // 美股（含字母代码，如 TCOM / AAPL）：腾讯 us 前缀主源；新浪已封服务器 IP，备用改东财（三个市场逐个试）
  if (isUsCode(code)) {
    const sym = code.toUpperCase().replace(/\s+/g, '');
    try {
      return parseTencent(await getQuoteText('/api/quote?code=' + encodeURIComponent('us' + sym)), { us: true });
    } catch (e1) {
      for (const mkt of [105, 106, 107]) {
        const q2 = await emQuote(mkt + '.' + sym);
        if (q2) return q2;
      }
      throw new Error('美股行情获取失败（代码可能有误或已休市），可手动填名称与现价');
    }
  }

  // A股 / ETF / 基金 / 可转债：5–6 位数字
  if (!/^\d{5,6}$/.test(code)) throw new Error('请输入 5–6 位数字代码（A股/ETF），或美股字母代码（如 TCOM）');
  const full = detectMarket(code) + code;
  const q = encodeURIComponent(full);
  // 先腾讯，失败再退回东财（新浪已封服务器 IP，不再作备用）
  try {
    return parseTencent(await getQuoteText('/api/quote?code=' + q));
  } catch (e1) {
    const q2 = await emQuote((detectMarket(code) === 'sh' ? '1.' : '0.') + code);
    if (q2) return q2;
    throw new Error('腾讯/东财均失败（代码可能有误或已休市）');
  }
}

/* -------------------------------------------------------------------------
   公募基金净值：天天基金实时估值（服务器 /api/fund 代理 fundgz.1234567.com.cn）
   返回 jsonpgz({fundcode,name,dwjz昨日净值,gsz估算净值,gszzl估算涨跌%,gztime})
   ------------------------------------------------------------------------- */
// 确认净值（东方财富历史净值 lsjz）——与基金官方/同花顺完全一致（DWJZ 净值、JZZZL 涨跌%）。
// 相比天天基金「估值(gsz)」是盘中近似、收盘后与官方有误差，确认净值才是最终真实值。
async function fetchFundConfirmed(code) {
  const res = await fetch('/api/fund_nav?code=' + encodeURIComponent(code), { cache: 'no-store' });
  if (!res.ok) throw new Error('净值接口 ' + res.status);
  const j = JSON.parse(await res.text());
  const list = j && j.Data && j.Data.LSJZList;
  if (!list || !list.length) throw new Error('无确认净值');
  const nav = parseFloat(list[0].DWJZ);
  const day = parseFloat(list[0].JZZZL);
  const prev = list[1] ? parseFloat(list[1].DWJZ) : NaN;
  if (!(nav > 0)) throw new Error('净值缺失');
  return { nav, dayPct: isFinite(day) ? day : null, prevNav: prev > 0 ? prev : null, navDate: list[0].FSRQ || '' };
}

async function fetchFund(code) {
  // 优先「确认净值」（准，和同花顺一致）；失败（盘中当日未公布 / 接口异常）回退天天基金估值
  try { return await fetchFundConfirmed(code); } catch (e) { /* 回退估值 */ }
  const res = await fetch('/api/fund?code=' + encodeURIComponent(code), { cache: 'no-store' });
  if (!res.ok) throw new Error('基金接口 ' + res.status);
  const text = await res.text();
  const m = text.match(/jsonpgz\(\s*(\{[\s\S]*?\})\s*\)/);
  if (!m) throw new Error('无估值数据');
  const o = JSON.parse(m[1]);
  const nav = parseFloat(o.gsz || o.dwjz);            // 估算净值优先，无则确认净值
  const prevNav = parseFloat(o.dwjz);                 // 昨日确认净值（作份额校准基准）
  const dayPct = parseFloat(o.gszzl);
  if (!(nav > 0)) throw new Error('净值缺失');
  return { name: o.name, nav, prevNav: prevNav > 0 ? prevNav : null, dayPct: isFinite(dayPct) ? dayPct : null, navDate: o.gztime || o.jzrq || '' };
}

/* -------------------------------------------------------------------------
   黄金价格：人民币/克（纸黄金跟随国际金价）。
   经 /api/gold 代理腾讯伦敦金 hf_XAU（美元/盎司，与股票同源、HTTP/1.1 稳）→ ×汇率 ÷ 31.1035 折人民币/克。
   （东方财富 push2 只认 HTTP/2，服务器/nginx 均为 HTTP/1.1 无法取数，故改腾讯源。）
   格式：v_hf_XAU="现价(p0),涨跌幅(p1),...,昨收(p7),...";  做 300–2500 元/克 护栏。
   ------------------------------------------------------------------------- */
const OZ_TO_GRAM = 31.1034768;
async function fetchGold(fx) {
  const text = await getQuoteText('/api/gold');
  const m = text.match(/"([^"]*)"/);
  if (!m || !m[1]) throw new Error('无黄金数据');
  const p = m[1].split(',');
  const usdOz = parseFloat(p[0]);         // 伦敦金 美元/盎司
  const prevOz = parseFloat(p[7]);        // 昨收
  if (!(usdOz > 0)) throw new Error('金价无效');
  const cnyGram = usdOz * (fx || currentFx()) / OZ_TO_GRAM;
  if (!(cnyGram >= 300 && cnyGram <= 2500)) throw new Error('金价超出合理区间(' + cnyGram.toFixed(1) + ')，不采用');
  // 当日涨跌：优先 (现价−昨收)/昨收；昨收异常再退用接口涨跌幅 p[1]；异常由调用方 |≤30%| 过滤
  let dayPct = (prevOz > 0) ? (usdOz - prevOz) / prevOz * 100 : null;
  if (dayPct == null || !isFinite(dayPct)) { const d = parseFloat(p[1]); dayPct = isFinite(d) ? d : null; }
  return { px: cnyGram, dayPct };
}

/* -------------------------------------------------------------------------
   一键刷新组合估值：公募基金走天天基金，股票/ETF/美股走行情源。
   份额模型：首次刷新用「金额 ÷ 现价/净值」反推份额并存下；之后价值 = 份额 × 最新价，
   浮盈亏随价值等额变动（Δ浮盈亏 = Δ市值），避免多天重复计算。
   ------------------------------------------------------------------------- */
function assetFetchable(a) {
  if (!a) return false;
  if (a.category === '黄金') return true;               // 纸黄金按国际金价折人民币/克
  if (!a.code) return false;
  if (a.category === '基金') return /^\d{6}$/.test(a.code);
  if (a.category === 'A股股票' || a.category === '美股股票') return isUsCode(a.code) || /^\d{5,6}$/.test(a.code);
  return false;
}

async function refreshOneAsset(a, fx) {
  // 默认盖「最近交易日」而非今天：周末刷新拿到的是周五收盘/涨跌，
  // pxDate 记周五 → dayPnl 判定「非今日价格」不计当日盈亏（基金分支会再覆盖为净值日）
  let px = null, dayPct = null, pxDateVal = lastTradingDayStr();
  if (a.category === '黄金') {
    const g = await fetchGold(fx); px = g.px; dayPct = g.dayPct;   // 金价（元/克）+ 当日涨跌
  } else if (a.category === '基金') {
    const f = await fetchFund(a.code); px = f.nav; dayPct = f.dayPct;
    // 基金取到的多是 T-1 确认净值（QDII 更滞后）：pxDate 用净值日期而非今天，
    // 否则昨日净值涨跌会冒充「今日盈亏」
    const nd = String(f.navDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(nd)) pxDateVal = nd;
  } else {
    const q = await fetchQuote(a.code); px = q.price; dayPct = q.changePct;
  }
  if (!(px > 0)) throw new Error('价格无效');
  // 首次校准份额：一律用「现价」反推（份额 = 金额 ÷ 现价），首次刷新金额不跳变、
  // 不依赖易错的昨收字段，从根本上避免坏行情把持仓算错（当日涨跌只作展示，见 dayPct）。
  const firstCalib = !(a.shares > 0);
  if (firstCalib) a.shares = a.amount / px;
  const oldVal = num(a.amount);
  const newVal = a.shares * px;
  // 展示用当日涨跌：过滤明显异常值（|涨跌| > 30% 视为字段解析异常，不展示）
  const dayOk = dayPct != null && isFinite(dayPct) && Math.abs(dayPct) <= 30 ? dayPct : null;
  // 安全阀：已建仓持仓若单次估值变动 > 40%，判为行情异常，只更新展示涨跌、不改金额/盈亏。
  if (!firstCalib && oldVal > 0 && Math.abs(newVal - oldVal) / oldVal > 0.4) {
    a.lastPx = px; if (dayOk != null) a.dayPct = dayOk; a.pxDate = pxDateVal;
    return false;
  }
  const deltaCny = (newVal - oldVal) * (a.currency === 'USD' ? fx : 1);
  a.amount = Math.round(newVal * 100) / 100;
  a.cny = Math.round(assetCny(a, fx));
  if (a.pnl != null) a.pnl = Math.round((num(a.pnl) + deltaCny) * 100) / 100;
  a.lastPx = px;
  if (dayOk != null) a.dayPct = dayOk;
  a.pxDate = pxDateVal;
  return true;
}

async function refreshAllQuotes() {
  const fx = currentFx();
  const targets = (STATE.assets || []).filter(assetFetchable);
  let updated = 0, failed = 0, skipped = 0;
  for (const a of targets) {
    try { const ok = await refreshOneAsset(a, fx); if (ok) updated++; else skipped++; }
    catch (e) { failed++; }
  }
  syncPositionsFromAssets();
  STATE.lastQuoteRefresh = Date.now();
  saveState();
  return { updated, failed, skipped, total: targets.length };
}

// 用「投资组合」里同代码资产的最新数据回填持仓的占比/浮盈亏%/现价/当日涨跌，
// 让 ②分散 ③回撤 ④止损 ⑤铁律 ①凯利 各模块都联动最新持仓。只更新有代码的持仓，
// 不动 factor / maxDrop / trend 等人工字段。
function syncPositionsFromAssets() {
  const fx = currentFx();
  const total = portfolioTotal();
  (STATE.positions || []).forEach(p => {
    if (!p.code) return;
    // 同代码可能分散在多个账户（两个券商各持一笔）：全部聚合，只取第一笔会把占比/浮盈亏系统性算小
    const list = (STATE.assets || []).filter(x => x.code === p.code);
    if (!list.length) return;
    const a = list[0];                                    // 单价/涨跌等取第一笔（同标的行情相同）
    const vCny = list.reduce((s, x) => s + assetCny(x, fx), 0);
    if (total > 0) p.weight = +(vCny / total * 100).toFixed(4);
    const amountSum = list.reduce((s, x) => s + num(x.amount), 0);
    const pnlSumRaw = list.some(x => x.pnl != null) ? list.reduce((s, x) => s + num(x.pnl), 0) : null;
    if (pnlSumRaw != null && amountSum > 0) {
      const pnlOrig = a.currency === 'USD' ? pnlSumRaw / fx : pnlSumRaw;
      const cost = amountSum - pnlOrig;
      if (cost > 0) p.pnl = +(pnlOrig / cost * 100).toFixed(2);   // 持仓 pnl 存的是浮盈亏%
    }
    if (num(a.lastPx) > 0) p.price = a.lastPx;
    if (a.dayPct != null) p.dayPct = a.dayPct;
    const sharesSum = list.reduce((s, x) => s + num(x.shares), 0);
    if (list.some(x => x.shares != null)) p.shares = sharesSum;   // 含归零：资产股数清空后持仓也要同步
  });
}

// 打开页面自动刷新：有可刷新资产且距上次 > 15 分钟才请求，避免频繁打扰
async function autoRefreshQuotes() {
  if (!(STATE.assets || []).some(assetFetchable)) return false;
  const last = STATE.lastQuoteRefresh || 0;
  if (Date.now() - last < 15 * 60 * 1000) return false;
  try { await refreshAllQuotes(); return true; } catch (e) { return false; }
}

/* =========================================================================
   视图：持仓管理 Positions
   ========================================================================= */
VIEWS.positions = function (app) {
  const totalAssets = portfolioTotal();
  app.appendChild(el(`
    <div class="view-head">
      <h2>持仓管理</h2>
      <p>录入的持仓将驱动「股票体检」「回撤控制」「铁律校验」「加减仓计划」等模块。<strong>改持股数会自动结算现金</strong>：减股=卖出，释放的资金自动计入现金池；增股=买入，自动从池中动用（A股→股票现金池·人民币，美股→美股现金池·美元）。与「投资组合」同代码的标的双向联动：改股数同步更新资产金额，改资产也会回填这里。</p>
    </div>
  `));

  // 添加表单
  const form = el(`<div class="card"><h3>添加 / 编辑持仓</h3></div>`);
  form.appendChild(el(`
    <p class="hint">输入股票代码可自动获取名称与最新价；填「持股数量」后，占比按
      <code class="formula">持股市值 ÷ 总资产</code> 自动计算，浮盈亏按成本价与现价自动算。
      当前总资产 <strong>${fmtMoney(totalAssets)}</strong>（由「投资组合」明细自动汇总，随资产变动实时更新）。</p>
    <div class="grid grid-3">
      <div class="field"><label>代码（A股 / ETF / 美股）</label>
        <div class="row" style="gap:6px">
          <input id="np-code" placeholder="如 002518 / 513260 / TCOM" style="flex:1"/>
          <button class="btn secondary" id="np-fetch" style="flex:0 0 auto">获取</button>
        </div>
        <p class="inline-note" id="np-code-note">数字＝A股/ETF（自动识别沪/深/京）；字母＝美股（如 TCOM）</p>
      </div>
      <div class="field"><label>名称</label><input id="np-name" placeholder="如 科士达"/></div>
      <div class="field"><label>底层因子标签</label>
        <select id="np-factor">${FACTORS.map(f=>`<option>${f}</option>`).join('')}</select>
      </div>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>持股数量（股）</label><input id="np-shares" type="number" step="100" placeholder="1000"/></div>
      <div class="field"><label>成本价</label><input id="np-cost" type="number" step="0.01" placeholder="20.0"/></div>
      <div class="field"><label>当前价</label><input id="np-price" type="number" step="0.01" placeholder="22.4"/></div>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>预估最大跌幅 %</label><input id="np-maxdrop" type="number" step="1" placeholder="40"/></div>
      <div class="field"><label>趋势状态</label>
        <select id="np-trend">${TRENDS.map((t,i)=>`<option ${i===2?'selected':''}>${t}</option>`).join('')}</select>
      </div>
      <div class="field"><label>占比 %（自动，可手填覆盖）</label><input id="np-weight" type="number" step="0.1" placeholder="留空则按数量自动算"/></div>
    </div>
    <div class="alert blue" id="np-calc"><span class="icon">${icon('calc')}</span><div id="np-calc-text">填入持股数量与现价后，这里自动显示市值 / 占比 / 浮盈亏。</div></div>
    <button class="btn" id="np-add" style="margin-top:14px">＋ 添加持仓</button>
    <input type="hidden" id="np-edit-id"/>
    <input type="hidden" id="np-pnl"/>
  `));
  app.appendChild(form);

  // —— 当日交易录入（精确当日盈亏）——
  {
    const tradeCard = el('<div class="card" style="margin-top:16px"><h3>' + icon('coins') + ' 当日交易 · 精确当日盈亏</h3></div>');
    const tradables = (STATE.assets || []).filter(a => a.code && ['A股股票', '美股股票', '基金'].includes(a.category));
    if (!tradables.length) {
      tradeCard.appendChild(el('<p class="hint">在「投资组合」里有股票/ETF/基金后，这里可录入当日买入/卖出（带成交价）：按成交价精确算当日盈亏，并自动更新股数与现金池，比"直接改数量"更准。</p>'));
    } else {
      tradeCard.appendChild(el(`
        <p class="hint">当日盈亏 = 开盘持股×(现价−昨收) ＋ 当日买入×(现价−买入价) ＋ 当日卖出×(卖出价−昨收)；记录后自动更新股数、现金池与浮盈亏。当天调仓请在这里录，别直接改数量。</p>
        <div class="grid grid-3">
          <div class="field"><label>标的</label><select id="dt-asset">${tradables.map(a => `<option value="${a.id}">${escapeHtml(a.name)}（${escapeHtml(a.code)}·${Math.round(num(a.shares)).toLocaleString()}股）</option>`).join('')}</select></div>
          <div class="field"><label>方向</label><select id="dt-type"><option value="buy">买入</option><option value="sell">卖出</option></select></div>
          <div class="field"><label>股数</label><input id="dt-shares" type="number" step="100" placeholder="如 1400"/></div>
        </div>
        <div class="grid grid-3">
          <div class="field"><label>成交价（原币）</label><input id="dt-price" type="number" step="0.001" placeholder="实际成交价"/></div>
          <div class="field" style="display:flex;align-items:flex-end"><button class="btn" id="dt-record" style="width:100%">${icon('plus')} 记录当日交易</button></div>
          <div></div>
        </div>
        <div id="dt-list" style="margin-top:6px"></div>
      `));
    }
    app.appendChild(tradeCard);
    const dtAsset = tradeCard.querySelector('#dt-asset');
    if (dtAsset) {
      const prefill = () => { const a = tradables.find(x => x.id === dtAsset.value); if (a && num(a.lastPx) > 0) tradeCard.querySelector('#dt-price').value = num(a.lastPx); };
      prefill(); dtAsset.onchange = prefill;
      const box = tradeCard.querySelector('#dt-list');
      const rows = [];
      (STATE.assets || []).forEach(a => {
        const trs = todayTradesOf(a);
        trs.forEach((t, i) => {
          // 仅最后一笔可撤销：撤销中间笔会把后续交易的股数链打乱（undoDayTrade 也只认最后一笔）
          const undoCell = i === trs.length - 1
            ? `<button class="btn danger small" data-undo="${a.id}:${i}">撤销</button>`
            : '<span class="inline-note">—</span>';
          rows.push(`<tr><td>${escapeHtml(a.name)}</td><td>${t.type === 'buy' ? '<span style="color:var(--red-ink)">买入</span>' : '<span style="color:var(--green-ink)">卖出</span>'}</td>
            <td class="num">${Math.round(num(t.shares)).toLocaleString()}</td><td class="num">${num(t.price)}</td>
            <td class="num">${undoCell}</td></tr>`);
        });
      });
      box.innerHTML = rows.length
        ? `<div class="mini-label" style="margin-top:8px">今日交易记录</div><div class="table-scroll"><table><thead><tr><th>标的</th><th>方向</th><th class="num">股数</th><th class="num">成交价</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
        : '<p class="inline-note">今天还没有交易记录。</p>';
      box.querySelectorAll('[data-undo]').forEach(btn => btn.onclick = () => {
        const [id, i] = btn.dataset.undo.split(':');
        const a = (STATE.assets || []).find(x => x.id === id);
        if (a && confirm('撤销这笔当日交易？将还原股数、现金池与浮盈亏。')) { undoDayTrade(a, +i); recordDailySnapshot(); saveState(); render(); }
      });
      tradeCard.querySelector('#dt-record').onclick = () => {
        const a = tradables.find(x => x.id === dtAsset.value);
        const type = tradeCard.querySelector('#dt-type').value;
        const shares = num(tradeCard.querySelector('#dt-shares').value);
        const price = num(tradeCard.querySelector('#dt-price').value);
        if (!a) { alert('请选择标的'); return; }
        if (!(shares > 0)) { alert('请填写股数'); return; }
        if (!(price > 0)) { alert('请填写成交价'); return; }
        if (type === 'sell' && shares > num(a.shares) && !confirm(`卖出 ${shares} 股超过当前持股 ${Math.round(num(a.shares))} 股，仍继续？`)) return;
        if (recordDayTrade(a, type, shares, price)) { recordDailySnapshot(); saveState(); render(); }   // 更新当日快照，次日开盘持股才对
      };
    }
  }

  const $ = sel => form.querySelector(sel);

  // 占比手填覆盖标记：用户手动改过占比后，不再被「数量×现价」自动回填冲掉；
  // 一旦数量/成本价/现价变动，则回到自动模式
  let weightDirty = false;

  // 实时计算：市值 / 占比 / 浮盈亏
  function recalc() {
    const shares = num($('#np-shares').value);
    const price = num($('#np-price').value);
    const cost = num($('#np-cost').value);
    const value = (shares > 0 && price > 0) ? shares * price : 0;
    let weight = null, pnl = null;
    if (value > 0 && totalAssets > 0 && !weightDirty) {
      weight = value / totalAssets * 100;
      $('#np-weight').value = weight.toFixed(2);   // 自动回填占比
    }
    if (cost > 0 && price > 0) pnl = (price - cost) / cost * 100;
    $('#np-pnl').value = (pnl != null) ? pnl.toFixed(2) : '';

    const wShown = (weight != null) ? weight : num($('#np-weight').value);
    const parts = [];
    parts.push(value > 0 ? `市值 <strong>${fmtMoney(value)}</strong>` : '市值 —');
    parts.push(`占比 <strong>${wShown ? wShown.toFixed(2) + '%' : '—'}</strong>`);
    parts.push(pnl != null
      ? `浮盈亏 <strong style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}${pnl.toFixed(2)}%</strong>`
      : '浮盈亏 —');
    if (totalAssets <= 0) parts.push('<span style="color:var(--amber)">（未设总资产，去「设置」填写后才能自动算占比）</span>');
    $('#np-calc-text').innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }
  ['#np-shares', '#np-price', '#np-cost'].forEach(s => $(s).addEventListener('input', () => { weightDirty = false; recalc(); }));
  $('#np-weight').addEventListener('input', () => { weightDirty = true; recalc(); });

  // 因子：按名称自动识别，避免默认「AI算力」错标；用户手动改过则不再自动覆盖
  let factorDirty = false;
  const autoFactor = () => {
    if (factorDirty) return;
    const g = guessFactor($('#np-name').value);
    if (g !== '其它') $('#np-factor').value = g;
  };
  $('#np-factor').addEventListener('change', () => { factorDirty = true; });
  $('#np-name').addEventListener('input', autoFactor);

  // 「获取」：按代码拉取名称与最新价
  $('#np-fetch').onclick = async () => {
    const note = $('#np-code-note');
    const code = $('#np-code').value.trim();
    note.textContent = '获取中…'; note.style.color = 'var(--muted)';
    try {
      const q = await fetchQuote(code);
      if (!$('#np-name').value.trim()) $('#np-name').value = q.name;
      $('#np-price').value = q.price;
      autoFactor();                        // 拉到名称后自动识别因子
      note.textContent = `✓ ${q.name}  现价 ${q.price}`; note.style.color = 'var(--green)';
      recalc();
    } catch (e) {
      note.innerHTML = `${icon('warn')} 自动获取失败（${escapeHtml(e.message)}）——请手动填写名称与现价`;
      note.style.color = 'var(--amber)';
    }
  };

  $('#np-add').onclick = () => {
    const name = $('#np-name').value.trim();
    if (!name) { alert('请填写名称'); return; }
    const editId = $('#np-edit-id').value;
    const oldPos = editId ? STATE.positions.find(x => x.id === editId) : null;
    const oldShares = oldPos ? num(oldPos.shares) : 0;
    const shares = num($('#np-shares').value);
    const price = num($('#np-price').value);
    const cost = num($('#np-cost').value);
    // 优先按 数量×现价÷总资产 算占比；用户手填覆盖过占比则尊重手填
    let weight = (shares > 0 && price > 0 && totalAssets > 0 && !weightDirty)
      ? shares * price / totalAssets * 100
      : num($('#np-weight').value);
    const pnl = (cost > 0 && price > 0) ? (price - cost) / cost * 100 : num($('#np-pnl').value);
    const pos = {
      id: editId || uid(),
      name,
      code: $('#np-code').value.trim(),
      factor: $('#np-factor').value,
      shares,
      weight: +weight.toFixed(4),
      pnl: +Number(pnl || 0).toFixed(4),
      trend: $('#np-trend').value,
      maxDrop: num($('#np-maxdrop').value),
      cost,
      price,
    };
    logOp((editId ? '编辑持仓：' : '新增持仓：') + (pos.name || pos.code || '未命名'));
    if (editId) {
      const i = STATE.positions.findIndex(p => p.id === editId);
      if (i >= 0) STATE.positions[i] = Object.assign(STATE.positions[i], pos);
    } else {
      STATE.positions.push(pos);
    }
    // 持仓与「投资组合」同代码资产双向一致：
    //  · 已存在该资产 → 同步更新（否则渲染时会被资产回填覆盖，编辑不生效）
    //  · 新持仓且投资组合里没有 → 自动创建对应股票资产，出现在首页「投资组合」
    if (pos.code) {
      const fx = currentFx();
      const a = (STATE.assets || []).find(x => x.code === pos.code);
      const px = price > 0 ? price : (a ? num(a.lastPx) : 0);
      if (a && shares > 0 && px > 0) {
        captureSod(a);                          // 改股数前记录当日开盘持股，供「当日盈亏」正确计算
        a.shares = shares;
        a.amount = Math.round(shares * px * 100) / 100;
        a.lastPx = px;
        if (cost > 0) a.pnl = Math.round(shares * (px - cost) * (a.currency === 'USD' ? fx : 1) * 100) / 100;
        a.cny = Math.round(assetCny(a, fx));
      } else if (!a && !editId && shares > 0 && px > 0) {
        const isUs = isUsCode(pos.code);
        const na = {
          id: uid(),
          platform: isUs ? '美股券商' : '股票账户',
          category: isUs ? '美股股票' : 'A股股票',
          name: pos.name,
          code: pos.code,
          currency: isUs ? 'USD' : 'CNY',
          shares,
          lastPx: px,
          amount: Math.round(shares * px * 100) / 100,
          pnl: cost > 0 ? Math.round(shares * (px - cost) * (isUs ? fx : 1) * 100) / 100 : 0,
          sodShares: 0, sodDate: todayStr(),      // 当日新建仓：当日开盘持股为 0 → 当日盈亏计 0
          note: '由「持仓」录入自动创建，如为基金/其它可在此改类别',
        };
        na.cny = Math.round(assetCny(na, fx));
        (STATE.assets = STATE.assets || []).push(na);
      }
    }
    // 持股数变动 → 现金自动结算：差额为正（净卖出）= 盈余计入现金池；
    // 差额为负（净买入）= 动用现金。A股动人民币现金池，美股动美元现金池。
    {
      // 与上方资产记账同价：现价为空时优先用同代码资产的 lastPx（资产就按它记的账），
      // 再退回旧持仓价——保证「资产金额变动」和「现金池结算」两口径一致
      const la = pos.code ? (STATE.assets || []).find(x => x.code === pos.code) : null;
      const settlePx = price > 0 ? price
        : (la && num(la.lastPx) > 0 ? num(la.lastPx)
        : (oldPos && num(oldPos.price) > 0 ? num(oldPos.price) : 0));
      const prev = previewSharesSettlement(oldShares, shares, settlePx, pos.code);
      if (prev) {
        const after = prev.poolBal - prev.deltaOrig;
        const ok = confirm(
          `持股变动结算：${pos.name} ${oldShares} → ${shares} 股，按现价 ${settlePx} 估算，差额 ${fmtOrig(prev.deltaOrig, prev.ccy)}${prev.ccy === 'USD' ? '（美元）' : ''}。\n` +
          (prev.deltaOrig < 0
            ? `净卖出 → 盈余计入「${poolName(prev.ccy)}」`
            : `净买入 → 动用「${poolName(prev.ccy)}」${after < 0 ? '（结算后余额为负，代表动用了池外资金）' : ''}`) +
          `，结算后余额 ${fmtOrig(after, prev.ccy)}。\n确认入账？（点「取消」则只改股数、不动现金池）`);
        if (ok) settleToPool(-prev.deltaOrig, prev.ccy, (prev.dS < 0 ? '卖出' : '买入') + pos.name);
      }
    }
    recordDailySnapshot();      // 股数/资产结构变了 → 覆盖今日快照，次日开盘持股口径正确
    saveState();
    render();
  };

  // 列表
  const listCard = el('<div class="card" style="margin-top:16px"><h3>当前持仓</h3></div>');
  if (STATE.positions.length === 0) {
    listCard.appendChild(el(`<div class="empty"><div class="big">${icon('inbox')}</div><p>暂无持仓</p></div>`));
  } else {
    const totalWeight = STATE.positions.reduce((a, p) => a + num(p.weight), 0);
    const scroll = el('<div class="table-scroll"></div>');
    const totalValue = totalAssets > 0 ? totalWeight / 100 * totalAssets : 0;
    const rows = STATE.positions.map(p => {
      const ddc = Calc.drawdownContribution(num(p.weight), num(p.maxDrop));
      const pnlColor = num(p.pnl) >= 0 ? 'var(--green)' : 'var(--red)';
      const value = totalAssets > 0 ? num(p.weight) / 100 * totalAssets : 0;
      return `<tr>
        <td>${escapeHtml(p.name)}${p.code?`<br><span class="inline-note">${escapeHtml(p.code)}</span>`:''}</td>
        <td><span class="tag-chip">${escapeHtml(p.factor)}</span></td>
        <td class="num">${fmtPct(num(p.weight),1)}</td>
        <td class="num">${value>0?fmtMoney(value):'—'}</td>
        <td class="num">${num(p.shares)>0?Math.round(num(p.shares)).toLocaleString():'—'}</td>
        <td class="num" style="color:${pnlColor}">${num(p.pnl)>=0?'+':''}${fmtPct(num(p.pnl),1)}</td>
        <td>${escapeHtml(p.trend||'—')}</td>
        <td class="num">${fmtPct(num(p.maxDrop),0)}</td>
        <td class="num">${fmtPct(ddc,2)}</td>
        <td class="num">
          <button class="btn secondary small" data-edit="${p.id}">编辑</button>
          <button class="btn danger small" data-del="${p.id}">删</button>
        </td>
      </tr>`;
    }).join('');
    scroll.appendChild(el(`
      <table>
        <thead><tr>
          <th>名称</th><th>因子</th><th class="num">占比</th><th class="num">金额</th><th class="num">持股数</th><th class="num">浮盈亏</th>
          <th>趋势</th><th class="num">最大跌幅</th><th class="num" title="潜在下行风险 = 占比 × 最大跌幅，与当前盈亏无关，恒为正">回撤贡献(潜在)</th><th></th>
        </tr></thead>
        <tbody>${rows}
          <tr class="total-row">
            <td>合计</td><td></td><td class="num">${fmtPct(totalWeight,1)}</td>
            <td class="num">${totalValue>0?fmtMoney(totalValue):'—'}</td>
            <td></td><td></td><td></td><td></td>
            <td class="num">${fmtPct(STATE.positions.reduce((a,p)=>a+Calc.drawdownContribution(num(p.weight),num(p.maxDrop)),0),2)}</td><td></td>
          </tr>
        </tbody>
      </table>
    `));
    listCard.appendChild(scroll);
    listCard.appendChild(el(`<p class="inline-note">现金池（持股数变动自动结算）：股票现金池 <strong>${fmtOrig(stockCashPoolBalance('CNY'), 'CNY')}</strong> · 美股现金池 <strong>${fmtOrig(stockCashPoolBalance('USD'), 'USD')}</strong>——减股释放的资金自动入池，增股自动从池中动用（A股动人民币池、美股动美元池，见「投资组合 → 现金」分类）。按仓位推算的现金余量 ${fmtPct(Math.max(0,100-totalWeight),1)}。<strong>回撤贡献(潜在)</strong> = 占比 × 最大跌幅 = 该股若跌到最坏情形对组合的拖累，是<strong>向前看的风险</strong>，恒为正，与"浮盈亏"(当前盈亏)无关——盈利的股也仍有下行风险。</p>`));

    scroll.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const p = STATE.positions.find(x => x.id === b.dataset.del);
      if (!p) { STATE.positions = STATE.positions.filter(x => x.id !== b.dataset.del); saveState(); render(); return; }
      // 两表联动：同一只股票（同 code）在「全部持仓/资产」里也有时，一起删——
      // 否则删了持仓、资产还躺着，再当日交易买入就会叠加翻倍。
      const linkedAsset = p.code ? (STATE.assets || []).find(x => x.code === p.code) : null;
      if (linkedAsset) {
        if (!confirm(`「${p.name}」在「当前持仓」和「全部持仓/资产」里都有。\n「确定」= 两处一起删除（不动现金池，用于清理/纠错）；「取消」= 不删。`)) return;
        logOp('删除持仓+资产：' + p.name);
        STATE.positions = STATE.positions.filter(x => x.id !== p.id);
        STATE.assets = (STATE.assets || []).filter(x => x.id !== linkedAsset.id);
        saveState(); render();
        return;
      }
      // 无联动资产：删除可视为「全部卖出」并把所得计入现金池
      const prev = previewSharesSettlement(num(p.shares), 0, num(p.price), p.code);
      logOp('删除持仓：' + p.name);
      if (prev && confirm(`删除「${p.name}」视为全部卖出：${p.shares} 股 ≈ ${fmtOrig(-prev.deltaOrig, prev.ccy)}，盈余计入「${poolName(prev.ccy)}」？\n「确定」=卖出并入账，「取消」=仅删除记录、不动现金池。`)) {
        settleToPool(-prev.deltaOrig, prev.ccy, '卖出' + p.name + '（删除持仓）');
      }
      STATE.positions = STATE.positions.filter(x => x.id !== p.id);
      saveState(); render();
    });
    scroll.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      const p = STATE.positions.find(x => x.id === b.dataset.edit);
      if (!p) return;
      form.querySelector('#np-code').value = p.code || '';
      form.querySelector('#np-name').value = p.name;
      form.querySelector('#np-factor').value = p.factor;
      form.querySelector('#np-shares').value = p.shares != null ? p.shares : '';
      form.querySelector('#np-weight').value = p.weight;
      form.querySelector('#np-pnl').value = p.pnl;
      form.querySelector('#np-trend').value = p.trend;
      form.querySelector('#np-maxdrop').value = p.maxDrop;
      form.querySelector('#np-cost').value = p.cost;
      form.querySelector('#np-price').value = p.price;
      form.querySelector('#np-edit-id').value = p.id;
      form.querySelector('#np-add').textContent = '✓ 保存修改';
      weightDirty = false;   // 载入已有持仓时回到自动模式
      recalc();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  app.appendChild(listCard);
};

/* =========================================================================
   模块 1 — 凯利公式计算器（单标的下注）
   ========================================================================= */
// 凯利 AI 评估的会话内缓存：{ "code|日期": {win,up,down,bulls,bears,note} }
// 同一标的当日重复评估复用同一结果，保证一致（刷新页面或次日自动失效重评）

VIEWS.kelly = function (app) {
  const s = STATE.settings;
  const frac = Math.min(1, Math.max(0.05, num(s.kellyFraction, 0.25)));
  const fracTxt = fracLabel(frac);
  app.appendChild(el(`
    <div class="view-head">
      <h2>① 凯利定注 · 单标的下注</h2>
      <p>回答"这一只该下多少注"。EV 为负直接淘汰，默认执行值为 ${fracTxt} 凯利（系数可在「设置」调整）。</p>
    </div>
  `));

  /* --- 傻瓜模式：选持仓/基金 → AI 给胜率/空间/理由 → 自动算凯利并回填计算器 --- */
  const kaPositions = kellyCandidates();
  const aiCard = el(`<div class="card" style="margin-bottom:16px">
    <h3>${icon('sparkles')} 傻瓜模式 · 选持仓，AI 帮你估参数</h3>
    <p class="hint">选一只持仓/基金，AI（DeepSeek）给出<strong>保守估计</strong>的胜率、上涨/下跌空间与多空理由，并给<strong>综合评分</strong>。注意区分：<strong>个股</strong>用凯利定目标仓位；<strong>宽基/低波/红利/债等配置型基金</strong>凯利会系统性低估，改用「资产角色 + 策略权重区间」来定（详见结果里的说明）。参数会回填下方计算器供微调。<strong>AI 估计仅供参考，非投资建议。</strong></p>
    ${kaPositions.length ? `
    <div class="mini-label">A · 选已有持仓/基金</div>
    <div class="row" style="gap:8px;max-width:560px">
      <select id="ka-pos">${kaPositions.map(p => `<option value="${p.id}">${p.kind === '基金' ? '[基金] ' : ''}${escapeHtml(p.name)}${p.code ? '（' + escapeHtml(p.code) + '）' : ''} · 当前 ${(+num(p.weight)).toFixed(1)}%</option>`).join('')}</select>
      <button class="btn ka-eval-btn" id="ka-go" style="flex:0 0 auto">${icon('sparkles')} 让 AI 评估</button>
    </div>
    <div class="section-divider"></div>` : ''}
    <div class="mini-label">${kaPositions.length ? 'B · ' : ''}或输入任意股票/基金评估（不必是你的持仓）</div>
    <div class="row" style="gap:8px;max-width:560px">
      <input id="ka-adhoc" placeholder="代码或名称，如 600519 / 贵州茅台 / TCOM / 513260"/>
      <button class="btn secondary ka-eval-btn" id="ka-adhoc-go" style="flex:0 0 auto">${icon('sparkles')} 评估此标的</button>
    </div>
    <p class="inline-note">输入代码会尝试联网带出名称/价格；也可直接输名称。评估不改动你的持仓，仅供参考。</p>
    <div id="ka-out"></div>
  </div>`);
  app.appendChild(aiCard);

  const card = el('<div class="card"></div>');
  card.appendChild(el(`
    <div class="grid grid-2">
      <div class="field"><label>赢的情形·上涨空间 <span class="req">*</span></label>
        <div class="suffix-input"><input id="k-up" type="number" step="1" placeholder="60"/><span>%</span></div></div>
      <div class="field"><label>输的情形·下跌空间 <span class="req">*</span></label>
        <div class="suffix-input"><input id="k-down" type="number" step="1" placeholder="20"/><span>%</span></div></div>
    </div>
    <div class="field"><label>胜率 p <span class="req">*</span>（0–100）</label>
      <div class="suffix-input"><input id="k-p" type="number" step="1" min="0" max="100" placeholder="55"/><span>%</span></div>
      <p class="inline-note">败率 q = 1 − p 自动计算。散户最常见的错误是高估胜率。</p>
    </div>

    <div class="section-divider"></div>
    <div class="mini-label">强制前置 · 提交前须各填至少 2 条客观理由</div>
    <div class="grid grid-2">
      <div>
        <label style="color:var(--green);font-size:12px;margin-bottom:6px;display:block">看多客观理由 <span class="req">*</span></label>
        <div class="reason-list" id="k-bull"></div>
        <button class="btn secondary small" id="k-bull-add" style="margin-top:8px">＋ 添加看多理由</button>
      </div>
      <div>
        <label style="color:var(--red);font-size:12px;margin-bottom:6px;display:block">看空客观理由 <span class="req">*</span></label>
        <div class="reason-list" id="k-bear"></div>
        <button class="btn secondary small" id="k-bear-add" style="margin-top:8px">＋ 添加看空理由</button>
      </div>
    </div>

    <div style="margin-top:18px"><button class="btn" id="k-calc">计算目标仓位</button></div>
    <div id="k-result"></div>
  `));
  app.appendChild(card);

  const bullBox = card.querySelector('#k-bull');
  const bearBox = card.querySelector('#k-bear');
  function addReason(box) {
    const row = el(`<div class="reason-row"><input placeholder="写一条客观依据…"/><button class="btn danger small">×</button></div>`);
    row.querySelector('button').onclick = () => row.remove();
    box.appendChild(row);
  }
  card.querySelector('#k-bull-add').onclick = () => addReason(bullBox);
  card.querySelector('#k-bear-add').onclick = () => addReason(bearBox);
  addReason(bullBox); addReason(bullBox);
  addReason(bearBox); addReason(bearBox);

  // 傻瓜模式：AI 评估 → 算凯利 → 与当前占比对比 → 回填计算器（持仓与自由输入共用）
  async function evaluateCandidate(p) {
    if (!p) return;
    const out = aiCard.querySelector('#ka-out');
    const evalBtns = [...aiCard.querySelectorAll('.ka-eval-btn')];
    evalBtns.forEach(b => b.disabled = true);
    out.innerHTML = '<div class="inline-note" style="margin-top:10px">' + icon('refresh', 'spin') + ' 正在请求 DeepSeek 评估「' + escapeHtml(p.name) + '」，约 10–30 秒…</div>';
    try {
      // 持久缓存（STATE.kellyEvals，随云端同步）：7 天内且 因子/趋势 未变 → 直接复用，
      // 刷新页面/换设备也返回同一结果——修"两次相同测试结果差异大"。
      // 键不含 maxDrop/浮盈亏/仓位——这些不该影响标的自身的下注质量评分。
      const cacheKey = (p.code || p.name || '').toLowerCase();
      const stored = STATE.kellyEvals[cacheKey];
      const freshDays = stored ? Math.floor((Date.now() - new Date(stored.date).getTime()) / 864e5) : 999;
      const cached = (stored && freshDays <= 7 && stored.factor === (p.factor || '') && stored.trend === (p.trend || '')) ? stored : null;
      let win, up, down, bulls, bears, note, fromCache = false, evalDate = todayStr();
      if (cached) {
        win = cached.win; up = cached.up; down = cached.down;
        bulls = cached.bulls || []; bears = cached.bears || []; note = cached.note || '';
        fromCache = true; evalDate = cached.date;
      } else {
        const sys = '你是一位严谨、保守的投资分析师，评估对象可能是股票或基金。基于你对该标的（公司/行业/指数/主题）的认知，给出未来 6–12 个月的保守评估。'
          + '一致性要求：请给出你最有把握的【单一保守中枢估计】，不要给区间、不要发散；相同输入应得到相同结论。'
          + '硬性要求：宁可低估胜率、高估风险；胜率必须在 30–65 之间；空间用价格涨跌幅的正百分数，下跌空间不小于上涨空间的一半。'
          + '基金按其跟踪的指数/主题整体评估，波动通常小于个股，空间相应收敛。'
          + '关键：胜率(winRate)按 5 的整数倍给（如 40/45/50/55/60）；上涨/下跌空间(upside/downside)也按 5 的整数倍给，这样多次评估结果稳定一致。'
          + '只输出一个 JSON 对象，不要任何多余文字、解释或代码块标记。格式：'
          + '{"winRate":50,"upside":35,"downside":25,"bulls":["客观看多理由1","理由2"],"bears":["客观看空理由1","理由2"],"note":"一句话结论"}';
        const user = `标的：${p.name}（代码 ${p.code || '无'}）\n`
          + `底层驱动因子：${p.factor}；当前趋势：${p.trend || '未知'}。\n`
          + `请仅基于该标的自身的基本面/行业/估值/趋势评估未来 6–12 个月，`
          + `不要参考任何持仓成本、浮盈亏、仓位或用户填写的最大跌幅（这些与标的胜率无关）。`
          + `给出胜率(winRate)、上涨空间(upside)、下跌空间(downside)与各 2-4 条客观多空理由。`;
        // 温度 0 + 5 分桶：把 AI 细小波动吸收掉，稳定评分与凯利结果
        const j = await aiChatJSON(sys, user, { temperature: 0 });
        const round5 = x => Math.round(num(x) / 5) * 5;
        win = Math.min(65, Math.max(30, round5(j.winRate)));
        up = Math.max(5, round5(j.upside));
        down = Math.max(5, Math.max(round5(j.downside), up * 0.5));
        bulls = (j.bulls || []).map(x => String(x).trim()).filter(Boolean).slice(0, 4);
        bears = (j.bears || []).map(x => String(x).trim()).filter(Boolean).slice(0, 4);
        note = String(j.note || '').trim();
        STATE.kellyEvals[cacheKey] = { win, up, down, bulls, bears, note, date: todayStr(), factor: p.factor || '', trend: p.trend || '' };
        saveState();
      }

      const prob = win / 100;
      const ev = Calc.ev(prob, up, down);
      const b = Calc.odds(up, down);
      const f = Calc.kellyStock(prob, up, down);            // 股票版凯利（部分损失，非全损）
      const fLow = Calc.kellyStock(Math.max(0, prob - 0.1), up, down); // 胜率−10% 的敏感性
      const cur = num(p.weight);
      const total = portfolioTotal();
      const rtype = holdingRiskType(p);
      const score = betScore(ev, b, win);
      const scoreColor = score >= 65 ? 'var(--green-ink)' : (score >= 45 ? 'var(--amber-ink)' : 'var(--red-ink)');

      let sizing = '', advice = '', caveat = '';
      const robust = Calc.kellyRobust(win, up, down);       // 胜率±5pp 稳健度：翻号的结论不可用
      if (rtype === 'stock') {
        // 个股/集中头寸：凯利适用——但只在「稳健」时给具体目标，不稳健一律按 0 处理
        const target = Math.max(0, f * frac * 100);
        const capped = Math.min(target, s.singleCap);
        const diff = capped - cur;
        const diffMoney = total > 0 ? Math.abs(diff) / 100 * total : 0;
        if (robust.verdict === 'unstable') {
          sizing = `<div class="result-box"><div class="metric-row"><span class="k">${fracTxt} 凯利目标仓位</span><span class="v" style="color:var(--amber-ink)">不稳健 → 按 0 处理</span></div>
            <div class="metric-row"><span class="k">胜率±5个点的满凯利区间</span><span class="v" style="color:var(--muted)">${(robust.fPess*100).toFixed(0)}% ~ ${(robust.fOpt*100).toFixed(0)}%（翻号）</span></div></div>`;
          advice = `<div class="alert amber"><span class="icon">${icon('warn')}</span><div><strong>结论不稳健：胜率仅 ±5 个点，凯利仓位就正负翻转</strong>——AI 估计的固有噪声就有这么大，此时任何具体百分数都是假精确。<br>纪律做法：<strong>当 0 处理、观望</strong>；已持有的维持不动或按其它纪律（止损/铁律）处理，不要按凯利加减仓。</div></div>`;
        } else {
        sizing = `<div class="result-box"><div class="metric-row"><span class="k">${fracTxt} 凯利目标仓位（≤单股上限 ${s.singleCap}%）</span><span class="v" style="color:var(--accent-ink)">${capped.toFixed(1)}%${total > 0 ? '（约 ' + fmtMoney(capped / 100 * total) + '）' : ''} <span class="pill ${robust.verdict==='pos'?'green':'red'}" style="font-size:11px">稳健${robust.verdict==='pos'?'为正':'为负'}·胜率±5不翻号</span></span></div></div>`;
        if (ev < 0) advice = `<div class="alert red"><span class="icon">${icon('danger')}</span><div><strong>EV 为负（${ev.toFixed(1)}%）且稳健（胜率+5个点仍不为正）· 数学上不值得下注</strong><br>纪律做法：不加仓，考虑减仓或离场；当前占 ${cur.toFixed(1)}%。此结论会同步给「再平衡」卖出排序。</div></div>`;
        else if (f <= 0) advice = `<div class="alert amber"><span class="icon">${icon('warn')}</span><div><strong>期望值恰为零（EV=0）</strong>：凯利仓位为 0，数学上不值得下注，建议观望。</div></div>`;
        else if (diff > 0.5) advice = `<div class="alert green"><span class="icon">${icon('check')}</span><div><strong>目标 ${capped.toFixed(1)}% vs 当前 ${cur.toFixed(1)}% → 有 ${diff.toFixed(1)} 个百分点空间（约 ${fmtMoney(diffMoney)}）</strong><br>加仓前必须过「⑤ 铁律校验」。</div></div>`;
        else if (diff < -0.5) advice = `<div class="alert amber"><span class="icon">${icon('warn')}</span><div><strong>目标 ${capped.toFixed(1)}% vs 当前 ${cur.toFixed(1)}% → 超配 ${(-diff).toFixed(1)} 个百分点（约 ${fmtMoney(diffMoney)}）</strong><br>按凯利纪律应逐步减到目标附近，别一次性调仓。</div></div>`;
        else advice = `<div class="alert green"><span class="icon">${icon('check')}</span><div><strong>当前 ${cur.toFixed(1)}% ≈ 目标 ${capped.toFixed(1)}%，仓位基本合理</strong>，保持并按纪律跟踪即可。</div></div>`;
        }
      } else {
        // 配置型基金：凯利会系统性低估，改用「资产角色 + 策略权重区间」
        const band = ROLE_BAND[rtype];
        const roleName = rtype === 'core' ? '宽基/低波/红利/债 —— 配置型核心' : '行业/主题基金 —— 卫星仓';
        sizing = `<div class="result-box">
          <div class="metric-row"><span class="k">资产角色</span><span class="v">${roleName}</span></div>
          <div class="metric-row"><span class="k">建议策略权重区间</span><span class="v" style="color:var(--accent-ink)">${band[0]}–${band[1]}%${total > 0 ? '（约 ' + fmtMoney(band[0] / 100 * total) + '–' + fmtMoney(band[1] / 100 * total) + '）' : ''}</span></div>
          <div class="metric-row"><span class="k">当前占比</span><span class="v">${cur.toFixed(1)}%</span></div>
          <div class="metric-row"><span class="k">¼ 凯利测算（仅参考，会低估配置型）</span><span class="v" style="color:var(--muted)">${Math.max(0, f * frac * 100).toFixed(1)}%</span></div>
        </div>`;
        if (ev < 0) advice = `<div class="alert amber"><span class="icon">${icon('warn')}</span><div><strong>AI 保守看，短期期望值偏弱（EV ${ev.toFixed(1)}%）</strong><br>作为配置型资产不必据此清仓，但可暂缓加仓、等性价比更好时再补到区间内。</div></div>`;
        else if (cur < band[0]) advice = `<div class="alert green"><span class="icon">${icon('check')}</span><div><strong>当前 ${cur.toFixed(1)}% 低于建议下沿 ${band[0]}%</strong><br>作为${rtype === 'core' ? '核心配置' : '卫星仓'}可考虑逐步补到区间内，分批而非一次到位。</div></div>`;
        else if (cur > band[1]) advice = `<div class="alert amber"><span class="icon">${icon('warn')}</span><div><strong>当前 ${cur.toFixed(1)}% 高于建议上沿 ${band[1]}%</strong><br>可适度再平衡到 ${band[1]}% 以内（尤其若与其它持仓高度相关）。</div></div>`;
        else advice = `<div class="alert green"><span class="icon">${icon('check')}</span><div><strong>当前 ${cur.toFixed(1)}% 在建议区间 ${band[0]}–${band[1]}% 内</strong>，属合理配置，保持并定期再平衡即可。</div></div>`;
        caveat = `<div class="alert blue" style="margin-top:10px"><span class="icon">${icon('info')}</span><div>
          <strong>为什么这里不用凯利定仓？</strong>凯利公式是给「单一、独立、可重复的方向性下注」算最优比例的；对宽基/低波/红利/债这类<strong>分散型配置资产</strong>会系统性<strong>低估</strong>——它们的价值在于分散与稳定（低相关），而非单标的的方向性赔率。所以这类资产按<strong>资产配置策略的目标权重</strong>来定，凯利只作参考。凯利更适合有明确催化剂的个股/集中头寸。</div></div>`;
      }

      out.innerHTML = `
        <div class="result-box">
          <div class="metric-row"><span class="k">综合评分（越高越值得按纪律持有/下注）</span><span class="v" style="color:${scoreColor};font-size:20px">${score}<span style="font-size:13px;color:var(--muted)"> / 100</span></span></div>
          <div class="metric-row"><span class="k">AI 主观胜率 p<span style="color:var(--muted);font-size:11px"> · 估计值非事实</span></span><span class="v">${win}%</span></div>
          <div class="metric-row"><span class="k">上涨空间 / 下跌空间</span><span class="v">+${up.toFixed(0)}% / −${down.toFixed(0)}%</span></div>
          <div class="metric-row"><span class="k">期望值 EV</span><span class="v" style="color:${ev >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">${ev >= 0 ? '+' : ''}${ev.toFixed(2)}%</span></div>
          <div class="metric-row"><span class="k">净赔率 b · 满凯利 f（股票版）</span><span class="v">${b.toFixed(2)} · ${(f * 100).toFixed(1)}%</span></div>
          <div class="metric-row"><span class="k">敏感性：胜率−10%(=${Math.max(0,win-10)}%) 时的满凯利</span><span class="v" style="color:var(--muted)">${(fLow * 100).toFixed(1)}%</span></div>
        </div>
        ${sizing}
        ${advice}
        ${caveat}
        <div class="alert blue" style="margin-top:10px"><span class="icon">${icon('info')}</span><div><strong>凯利对胜率极敏感</strong>：胜率仅差 10 个点，满凯利从 ${(f*100).toFixed(0)}% 变成 ${(fLow*100).toFixed(0)}%。这就是为什么用<strong>${fracTxt}凯利 + 单股上限</strong>兜底——参数一定有误差，宁可小注。股票版凯利已修正原「二元赌注」把下跌当全损的错误。</div></div>
        <div class="alert amber" style="margin-top:10px"><span class="icon">${icon('warn')}</span><div><strong>评分来自 AI 对胜率/空间的主观估计，不是事实</strong>：同一标的换一天或换趋势标注可能给出不同数值，评分随之波动——这是 AI 估计的固有不确定性，请把它当“参考锚”而非“精确分”。评分<strong>只由标的自身评估决定，已与你的最大跌幅/浮盈亏/仓位解耦</strong>（回填历史回撤不会再改变它）。想知道你的胜率判断到底准不准，用「记录此判断」+「复盘校准」长期检验。</div></div>
        <div class="grid grid-2" style="margin-top:12px">
          <div><div class="mini-label" style="color:var(--green-ink)">AI 看多理由</div>${bulls.map(t => `<p style="margin:4px 0;font-size:13px">· ${escapeHtml(t)}</p>`).join('') || '<p class="inline-note">无</p>'}</div>
          <div><div class="mini-label" style="color:var(--red-ink)">AI 看空理由</div>${bears.map(t => `<p style="margin:4px 0;font-size:13px">· ${escapeHtml(t)}</p>`).join('') || '<p class="inline-note">无</p>'}</div>
        </div>
        ${note ? `<p class="inline-note" style="margin-top:8px">${icon('sparkles')} AI 结论：${escapeHtml(note)}</p>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn secondary small" id="ka-record" style="flex:0 0 auto">${icon('clipboard')} 记录此判断到「复盘校准」</button></div>
        <p class="inline-note">${fromCache ? `已复用 <strong>${escapeHtml(evalDate)}</strong> 的评估（7天内同参数固定同结果，刷新/换设备不变——<a href="#" id="ka-recompute" style="color:var(--accent-ink)">重新评估</a>）。` : `评估于 ${escapeHtml(evalDate)}，已固定保存：7 天内重复评估返回同一结果。`}参数已回填到下方计算器，可自行微调后重算。AI 生成内容仅供参考，不构成投资建议。</p>`;

      // 记录预测：把「当下判断的胜率/空间」存进复盘校准，日后回填结果校准你的判断力
      const recBtn = out.querySelector('#ka-record');
      if (recBtn) recBtn.onclick = () => {
        STATE.forecasts = STATE.forecasts || [];
        STATE.forecasts.push({
          id: uid(), date: todayStr(), name: p.name || '', code: p.code || '',
          p: win, up, down, ev: +ev.toFixed(2), f: +(f * 100).toFixed(1),
          source: 'AI', outcome: '', realizedPct: null,
        });
        saveState();
        recBtn.outerHTML = `<span class="pill green">已记录 · 到「复盘校准」页回填结果</span>`;
      };

      // “重新评估”：清掉该标的缓存后重跑（键须与上方 cacheKey 一致：代码|日期|因子|趋势）
      const recompute = out.querySelector('#ka-recompute');
      if (recompute) recompute.onclick = (e) => { e.preventDefault(); delete STATE.kellyEvals[(p.code || p.name || '').toLowerCase()]; saveState(); evaluateCandidate(p); };

      // 回填手动计算器（含理由），方便微调
      card.querySelector('#k-up').value = up.toFixed(0);
      card.querySelector('#k-down').value = down.toFixed(0);
      card.querySelector('#k-p').value = win;
      bullBox.innerHTML = ''; bearBox.innerHTML = '';
      const fill = (box, list) => {
        const items = list.length >= 2 ? list : list.concat(['', '']).slice(0, 2);
        items.forEach(t => { addReason(box); const inputs = box.querySelectorAll('input'); inputs[inputs.length - 1].value = t; });
      };
      fill(bullBox, bulls); fill(bearBox, bears);
    } catch (err) {
      out.innerHTML = `<div class="alert amber"><span class="icon">${icon('warn')}</span><div>
        <strong>AI 评估暂不可用</strong>：${escapeHtml(err.message)}<br>
        可先用下方计算器手动填参数；或稍后重试。</div></div>`;
    } finally {
      evalBtns.forEach(b => b.disabled = false);
    }
  }

  // A：评估已有持仓
  const kaGo = aiCard.querySelector('#ka-go');
  if (kaGo) kaGo.onclick = () => {
    const p = kaPositions.find(x => x.id === aiCard.querySelector('#ka-pos').value);
    evaluateCandidate(p);
  };
  // B：评估自由输入的任意标的（不必是持仓，不改动持仓）
  const kaAdhocGo = aiCard.querySelector('#ka-adhoc-go');
  if (kaAdhocGo) kaAdhocGo.onclick = async () => {
    const raw = (aiCard.querySelector('#ka-adhoc').value || '').trim();
    if (!raw) { alert('请输入股票 / 基金的代码或名称'); return; }
    let name = raw, code = '';
    // 形似代码：A股/ETF 5–6 位数字，或美股 1–6 位字母 → 尝试联网带出名称
    if (/^\d{5,6}$/.test(raw) || /^[A-Za-z]{1,6}$/.test(raw)) {
      code = raw.toUpperCase();
      const out = aiCard.querySelector('#ka-out');
      out.innerHTML = '<div class="inline-note" style="margin-top:10px">' + icon('refresh', 'spin') + ' 正在识别代码 ' + escapeHtml(code) + '…</div>';
      try {
        if (/^\d{6}$/.test(code)) { const f = await fetchFund(code); if (f && f.name) name = f.name; }
        else { const q = await fetchQuote(code); if (q && q.name) name = q.name; }
      } catch (e) { /* 取名失败不阻断，用原始输入当名称 */ }
    }
    const factor = FACTORS.includes('其它') ? '其它' : (FACTORS[FACTORS.length - 1] || '其它');
    evaluateCandidate({ id: 'adhoc', name, code, factor, trend: '未知', pnl: 0, maxDrop: 0, weight: 0, kind: '股票' });
  };

  card.querySelector('#k-calc').onclick = () => {
    const resBox = card.querySelector('#k-result');
    resBox.innerHTML = '';
    const up = num(card.querySelector('#k-up').value);
    const down = num(card.querySelector('#k-down').value);
    const pPct = num(card.querySelector('#k-p').value);

    const bulls = [...bullBox.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    const bears = [...bearBox.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);

    // 强制诚实输入校验
    const errs = [];
    if (up <= 0) errs.push('上涨空间需为正数');
    if (down <= 0) errs.push('下跌空间需为正数');
    if (down > 0 && up > 0 && up / down > 15) errs.push('赔率 b = 上涨÷下跌 > 15，下跌空间相对过小、参数很可能失真（会把凯利算到几百上千%），请复核上涨/下跌空间');
    if (pPct <= 0 || pPct >= 100) errs.push('胜率需在 0–100 之间');
    if (bulls.length < 2) errs.push('看多理由至少 2 条');
    if (bears.length < 2) errs.push('看空理由至少 2 条');
    if (errs.length) {
      resBox.appendChild(el(`<div class="alert red"><span class="icon">${icon('danger')}</span><div>请先补全：<br>${errs.map(e=>'· '+e).join('<br>')}</div></div>`));
      return;
    }

    const p = pPct / 100;
    const ev = Calc.ev(p, up, down);           // EV 前置闸门
    const b = Calc.odds(up, down);
    const f = Calc.kellyStock(p, up, down);    // 股票版凯利（部分损失，修正原二元全损假设）
    const fLow = Calc.kellyStock(Math.max(0, p - 0.1), up, down); // 胜率−10% 敏感性

    // EV 前置闸门：EV 为负直接淘汰，不进入凯利
    if (ev < 0) {
      resBox.appendChild(el(`
        <div class="result-box">
          <div class="metric-row"><span class="k">期望值 EV</span><span class="v" style="color:var(--red)">${ev.toFixed(2)}%</span></div>
          <div class="metric-row"><span class="k">净赔率 b</span><span class="v">${b.toFixed(2)}</span></div>
        </div>
        <div class="alert red"><span class="icon">${icon('danger')}</span><div>
          <strong>EV 前置闸门 · 淘汰</strong><br>
          期望值为负（${ev.toFixed(2)}%），该交易在数学上不具下注价值，直接淘汰、不进入凯利计算。建议不参与或减仓。
        </div></div>`));
      return;
    }

    // 推荐档 = 分数凯利，但显示时封顶到单股上限（原来会把 125% 净值标成“默认执行值”）
    const capFrac = s.singleCap / 100;
    const recRaw = f * frac;
    const recVal = Math.min(recRaw, capFrac);
    const tiers = [
      { label: '满凯利', val: f, rec: false },
      { label: '半凯利', val: f * 0.5, rec: false },
      { label: fracTxt + ' 凯利', val: recVal, rec: true, capped: recRaw > capFrac + 1e-9 },
    ];

    resBox.appendChild(el(`
      <div class="result-box">
        <div class="metric-row"><span class="k">期望值 EV = p×涨幅 − q×跌幅</span><span class="v" style="color:var(--green)">+${ev.toFixed(2)}%</span></div>
        <div class="metric-row"><span class="k">净赔率 b = 涨幅 ÷ 跌幅</span><span class="v">${b.toFixed(2)}</span></div>
        <div class="metric-row"><span class="k">败率 q</span><span class="v">${((1-p)*100).toFixed(0)}%</span></div>
        <div class="metric-row"><span class="k">满凯利 f = (p·u − q·d)/(u·d) · 股票版</span><span class="v">${(f*100).toFixed(1)}%</span></div>
        <div class="metric-row"><span class="k">敏感性：胜率−10%(=${Math.max(0,pPct-10).toFixed(0)}%) 时满凯利</span><span class="v" style="color:var(--muted)">${(fLow*100).toFixed(1)}%</span></div>
      </div>
      <p class="inline-note">股票版凯利：把「下跌空间」当作只亏 d%（而非本金全损），修正了原二元赌注公式对股票的系统性错算。满凯利常 >100%，务必用分数凯利 + 单股上限兜底。</p>
    `));

    if (f <= 0) {
      resBox.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>期望值恰为零（EV=0），凯利仓位为 0——数学上不值得下注，建议观望。</div></div>`));
      return;
    }

    const tierEl = el('<div class="kelly-tiers"></div>');
    tiers.forEach(t => {
      const theoretical = t.val > 1;   // 满/半凯利可能 >100% 净身家：显示为理论值、不可照做
      tierEl.appendChild(el(`
        <div class="tier ${t.rec?'recommended':''}">
          <div class="label">${t.label}</div>
          <div class="val">${theoretical ? (t.val*100).toFixed(0) + '%' : (t.val*100).toFixed(1) + '%'}</div>
          ${t.rec
            ? ('<div class="tag">' + icon('star') + (t.capped ? ' 封顶执行值(≤单股上限)' : ' 默认执行值') + '</div>')
            : (theoretical ? '<div class="tag" style="color:var(--muted)">理论值·不可照做</div>' : '')}
        </div>`));
    });
    resBox.appendChild(tierEl);

    // 高胜率警告
    if (pPct > 60) {
      resBox.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>
        你填入胜率 ${pPct}% > 60%。散户最常见错误是高估胜率——请回看你的 ${bears.length} 条看空理由，确认这个概率经得起推敲。
      </div></div>`));
    }

    // 与单股上限对照（加 epsilon 容差：避免浮点误差把"恰好等于上限"误判为"超过"）
    const fracPct = f * frac * 100;
    if (fracPct > s.singleCap + 1e-9) {
      resBox.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>
        ${fracTxt} 凯利目标 ${fracPct.toFixed(1)}% 已超过你的单股上限 ${s.singleCap}%。即便凯利允许，也建议以单股上限为准（分散优先）。
      </div></div>`));
    } else {
      resBox.appendChild(el(`<div class="alert green"><span class="icon">${icon('check')}</span><div>
        推荐执行 <strong>${fracTxt} 凯利 = ${fracPct.toFixed(1)}%</strong>，在单股上限 ${s.singleCap}% 之内。分数凯利用于降低参数误差，实战更稳。
      </div></div>`));
    }
  };
};


/* =========================================================================
   模块 3 — 最大回撤约束（总风险控制）
   ========================================================================= */
// 当前浮盈亏对整个组合的贡献（占总资产%，带正负）
//   市值 = 占比×总资产；成本 = 市值/(1+浮盈亏%)；盈亏 = 市值−成本
//   贡献% = 盈亏/总资产×100 = 占比 × 浮盈亏 /(100+浮盈亏)
function pnlContribOf(weightPct, pnlPct) {
  const denom = 100 + pnlPct;
  if (denom <= 0) return weightPct * pnlPct / 100;   // 极端兜底（浮亏≈−100%）
  return weightPct * pnlPct / denom;
}

VIEWS.drawdown = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>③ 回撤控制 · 最大回撤约束</h2>
      <p>用组合可承受的回撤反推每个高波动持仓的理论仓位上限。</p>
    </div>
  `));

  const s = STATE.settings;
  const settingCard = el('<div class="card"></div>');
  settingCard.appendChild(el(`
    <div class="field"><label>组合可承受最大回撤阈值</label>
      <div class="suffix-input"><input id="dd-threshold" type="number" step="1" value="${s.maxDrawdown}"/><span>%</span></div>
      <p class="inline-note">默认 15%。修改后可点下方按钮同步为全局设置。</p>
    </div>
    <button class="btn secondary small" id="dd-save">保存为全局阈值</button>
  `));
  app.appendChild(settingCard);
  settingCard.querySelector('#dd-save').onclick = () => {
    STATE.settings.maxDrawdown = num(settingCard.querySelector('#dd-threshold').value, 15);
    saveState(); render();
  };

  if (STATE.positions.length === 0) {
    app.appendChild(el(`<div class="card" style="margin-top:16px"><div class="empty"><div class="big">${icon('trenddown')}</div>
      <p>请先到「持仓」页录入标的及"预估最大跌幅"。</p></div></div>`));
    return;
  }

  const threshold = num(settingCard.querySelector('#dd-threshold').value, 15);
  const positions = STATE.positions;
  const used = positions.reduce((a, p) => a + Calc.drawdownContribution(num(p.weight), num(p.maxDrop)), 0);
  const usedReal = Calc.corrDrawdown(positions, corrResolver(STATE.corrCache));   // 与首页一致：有实测相关则用实测
  const remaining = threshold - used;

  const budgetCard = el('<div class="card" style="margin-top:16px"><h3>组合风险预算</h3></div>');
  const pct = Math.min(100, (used / threshold) * 100);
  budgetCard.appendChild(el(`
    <div class="metric-row"><span class="k">回撤阈值（预算总额）</span><span class="v">${fmtPct(threshold,1)}</span></div>
    <div class="metric-row"><span class="k">已用 · 最坏情形（全相关，Σ 各股回撤贡献）</span><span class="v" style="color:${used>threshold?'var(--red)':'var(--green)'}">${fmtPct(used,2)}</span></div>
    <div class="metric-row"><span class="k">已用 · 现实下沿（分散调整，因子相关）</span><span class="v" style="color:var(--muted)">${fmtPct(usedReal,2)}</span></div>
    <div class="metric-row"><span class="k">剩余（按最坏情形守门）</span><span class="v" style="color:${remaining<0?'var(--red)':'inherit'}">${fmtPct(remaining,2)}</span></div>
    <div class="progress" style="margin-top:12px"><div class="fill" style="width:${pct}%;background:${used>threshold?'var(--red)':(pct>80?'var(--amber)':'var(--green)')}"></div></div>
    <p class="inline-note">两个口径：<strong>最坏情形</strong>假设所有持仓同时见底（危机里相关性→1，用于守门，偏保守）；<strong>现实下沿</strong>按因子相关性做二次型收敛（正常市况更接近真实）。守门用最坏情形，判断“是否真的危险”看两者区间。</p>
  `));
  if (used > threshold) {
    budgetCard.appendChild(el(`<div class="alert red" style="margin-top:12px"><span class="icon">${icon('danger')}</span><div>
      组合预估最大回撤 ${fmtPct(used,2)} 已超阈值 ${fmtPct(threshold,1)}，需降低高波动持仓。参见下表建议上限。
    </div></div>`));
  } else {
    budgetCard.appendChild(el(`<div class="alert green" style="margin-top:12px"><span class="icon">${icon('check')}</span><div>
      组合回撤在预算内，剩余 ${fmtPct(remaining,2)} 可分配。
    </div></div>`));
  }
  app.appendChild(budgetCard);

  // 逐股明细 + 理论仓位上限
  // 理论上限：把整块回撤预算分配给该股时的最大占比 = threshold / maxDrop
  const detail = el('<div class="card" style="margin-top:16px"><h3>逐股回撤贡献与理论上限</h3><p class="hint">该股占比 × 该股最大跌幅 ≤ 分配到的回撤预算</p></div>');
  const scroll = el('<div class="table-scroll"></div>');
  const rows = positions.map((p, i) => {
    const w = num(p.weight), md = num(p.maxDrop);
    const contrib = Calc.drawdownContribution(w, md);
    const cap = md > 0 ? (threshold / md) * 100 : Infinity; // 单股独占预算时的上限占比
    const over = w > cap;
    const pnl = num(p.pnl);
    // 当前盈亏对组合的贡献（占总资产%，带正负）= 占比 × 浮盈亏% ÷ (100+浮盈亏%)
    const pnlContrib = pnlContribOf(w, pnl);
    const day = (p.dayPct != null && isFinite(p.dayPct)) ? `<span class="pill ${p.dayPct>=0?'green':'red'}">${p.dayPct>=0?'+':''}${fmtPct(p.dayPct,2)}</span>` : '—';
    return `<tr data-ddrow="${i}" style="cursor:pointer">
      <td>${escapeHtml(p.name)}</td>
      <td class="num">${fmtPct(w,1)}</td>
      <td class="num" style="color:${pnl>=0?'var(--green-ink)':'var(--red-ink)'}">${pnl>=0?'+':''}${fmtPct(pnl,1)}</td>
      <td class="num">${day}</td>
      <td class="num">${fmtPct(md,0)}</td>
      <td class="num" style="color:var(--red-ink)">${fmtPct(contrib,2)}</td>
      <td class="num" style="color:${pnlContrib>=0?'var(--green-ink)':'var(--red-ink)'}">${pnlContrib>=0?'+':'−'}${fmtPct(Math.abs(pnlContrib),2)}</td>
      <td class="num">${isFinite(cap)?fmtPct(cap,1):'—'}</td>
      <td>${over
        ? `<span class="pill red">超预算</span>`
        : `<span class="pill green">预算内</span>`}</td>
    </tr>`;
  }).join('');
  const pnlContribTotal = positions.reduce((a, p) => a + pnlContribOf(num(p.weight), num(p.pnl)), 0);
  scroll.appendChild(el(`<table><thead><tr>
    <th>名称</th><th class="num">当前占比</th><th class="num">浮盈亏</th><th class="num">今日</th><th class="num">最大跌幅</th>
    <th class="num" title="潜在下行：占比×最大跌幅，恒为正，与盈亏无关">回撤贡献(潜在)</th>
    <th class="num" title="当前浮盈亏对整个组合的贡献，带正负">盈亏贡献(当前)</th>
    <th class="num">理论上限*</th><th>判定</th>
  </tr></thead><tbody>${rows}
    <tr class="total-row"><td>合计</td><td class="num">${fmtPct(positions.reduce((a,p)=>a+num(p.weight),0),1)}</td><td></td><td></td><td></td>
      <td class="num" style="color:var(--red-ink)">${fmtPct(used,2)}</td>
      <td class="num" style="color:${pnlContribTotal>=0?'var(--green-ink)':'var(--red-ink)'}">${pnlContribTotal>=0?'+':'−'}${fmtPct(Math.abs(pnlContribTotal),2)}</td>
      <td></td><td></td></tr>
  </tbody></table>`));
  detail.appendChild(scroll);
  detail.appendChild(el(`<p class="inline-note">*理论上限 = 回撤阈值 ÷ 该股最大跌幅（即该股独占全部回撤预算时的占比）。多股共享预算时应更保守。<br>
    <strong>回撤贡献(潜在)</strong> = 占比 × 最大跌幅，恒为正，衡量「未来若跌到最坏，拖累组合多少」；
    <strong>盈亏贡献(当前)</strong> = 占比 × 浮盈亏 ÷(100+浮盈亏)，带正负，衡量「现在这只赚/亏，对组合贡献多少」。两者一个看未来风险、一个看当前损益。<strong>点任意一行查看该股解读。</strong></p>`));

  // 点哪只显示哪只（默认回撤贡献最大的一只）
  const summaryBox = el('<div id="dd-summary" style="margin-top:12px"></div>');
  detail.appendChild(summaryBox);
  const setDdSummary = (p) => {
    const w = num(p.weight), md = num(p.maxDrop);
    const contrib = Calc.drawdownContribution(w, md);
    const cap = md > 0 ? (threshold / md) * 100 : Infinity;
    const over = w > cap;
    summaryBox.innerHTML = `<div class="alert ${over?'red':'green'}"><span class="icon">${over?icon('xmark'):icon('check')}</span><div>
      <strong>${escapeHtml(p.name)}</strong>当前占 ${fmtPct(w,1)}，最大跌幅 ${fmtPct(md,0)}，对组合的回撤贡献 ${fmtPct(contrib,2)}，
      ${over?`超出预算，建议降至 ${fmtPct(cap,1)} 以内。`:`在预算内。`}</div></div>`;
  };
  if (positions.length) {
    const worstIdx = positions
      .map((p, i) => [i, Calc.drawdownContribution(num(p.weight), num(p.maxDrop))])
      .sort((a, b) => b[1] - a[1])[0][0];
    const highlight = (tr) => { scroll.querySelectorAll('[data-ddrow]').forEach(x => x.style.background = ''); if (tr) tr.style.background = 'rgba(10,132,255,0.08)'; };
    setDdSummary(positions[worstIdx]);
    scroll.querySelectorAll('[data-ddrow]').forEach(tr => tr.onclick = () => {
      highlight(tr); setDdSummary(positions[+tr.dataset.ddrow]);
    });
    highlight(scroll.querySelector(`[data-ddrow="${worstIdx}"]`));
  }
  app.appendChild(detail);
};

/* =========================================================================
   模块 4 — 固定分数止损（本金防御）
   ========================================================================= */
// 凯利傻瓜模式候选：股票持仓 + 基金资产（基金不在 positions 里，这里合成）
function kellyCandidates() {
  const fx = currentFx();
  const total = portfolioTotal();
  const list = [];
  const seen = new Set();
  (STATE.positions || []).forEach(p => {
    if (!p.name) return;
    list.push({ id: p.id, name: p.name, code: p.code || '', factor: p.factor || '其它', trend: p.trend || '未知', pnl: num(p.pnl), weight: num(p.weight), maxDrop: num(p.maxDrop) || 40, kind: '持仓' });
    if (p.code) seen.add(p.code);
  });
  (STATE.assets || []).forEach(a => {
    if (a.category !== '基金') return;
    if (a.code && seen.has(a.code)) return;
    const vCny = assetCny(a, fx);
    let pnlPct = 0;
    if (a.pnl != null && a.amount != null) {
      const pnlOrig = a.currency === 'USD' ? num(a.pnl) / fx : num(a.pnl);
      const cost = num(a.amount) - pnlOrig;
      if (cost > 0) pnlPct = +(pnlOrig / cost * 100).toFixed(2);
    }
    list.push({ id: 'ast:' + a.id, name: a.name, code: a.code || '', factor: '基金', trend: '未知', pnl: pnlPct, weight: total > 0 ? +(vCny / total * 100).toFixed(2) : 0, maxDrop: 30, kind: '基金' });
  });
  return list;
}

// 判定持仓的风险角色：个股(凯利适用) / 配置型核心(宽基·低波·红利·债·货币) / 主题卫星
function holdingRiskType(cand) {
  if (!cand || cand.kind !== '基金') return 'stock';
  const n = cand.name || '';
  if (/红利|低波|沪深\s*300|中证\s*(500|800|1000|A?500|100)|上证\s*50|A50|标普|纳斯达克|道琼斯|宽基|指数|债券?|货币|余额|MSCI|全球|恒生(?!科技)/.test(n)) return 'core';
  return 'theme';
}
// 配置型资产的建议策略权重区间（%），凯利不适用它们
const ROLE_BAND = { core: [8, 30], theme: [3, 12] };

/* -------------------------------------------------------------------------
   战略再平衡：按「期限 × 最大回撤」预设匹配科学目标盘
   科学口径：给每层设"压力情景回撤假设"（危机时风险资产同向下跌，故按加权线性求和 =
   组合压力回撤上界）；各预设的目标权重都满足"压力回撤 ≤ 该档预算"。用户三层策略
   （股票博弹性/基金压舱/理财兜底）被拆成 8 个可对照的层，美元敞口单列。
   ------------------------------------------------------------------------- */
// 层顺序与显示名（兜底→机动现金→海外固收→压舱→宽基→单股→美股→黄金）
const LAYER_ORDER = ['safe', 'cash', 'oseas', 'ballast', 'broad', 'single', 'us', 'gold'];
const LAYER_NAME = {
  safe: '兜底·在岸保本', cash: '机动现金', oseas: '海外固收(美元)', ballast: '压舱·低波基金',
  broad: '弹性·宽基', single: '弹性·单股', us: '美股', gold: '黄金',
};
// 压力情景（危机）下各层的假设回撤%——用于"这套配置最多能亏多少"的估算，透明可调
const LAYER_DD = { safe: 0, cash: 0, oseas: 8, ballast: 15, broad: 32, single: 45, us: 35, gold: 5 };
const USD_LAYERS = { oseas: 1, us: 1 };   // 计入美元敞口的层（美元现金另按币种实算）
// 预设：每档目标权重求和=100，压力回撤≤该档 maxDD；期限只影响兜底/现金厚度（流动性），回撤预算决定风险档
const REBAL_PRESETS = [
  { id: '3y15', years: 3, maxDD: 15, label: '3年·回撤≤15%', tone: '保守', t: { safe: 18, cash: 18, oseas: 12, ballast: 15, broad: 8, single: 12, us: 7, gold: 10 } },
  { id: '3y20', years: 3, maxDD: 20, label: '3年·回撤≤20%', tone: '稳健', t: { safe: 15, cash: 12, oseas: 12, ballast: 15, broad: 10, single: 18, us: 8, gold: 10 } },
  { id: '5y20', years: 5, maxDD: 20, label: '5年·回撤≤20%', tone: '均衡', t: { safe: 10, cash: 11, oseas: 12, ballast: 15, broad: 12, single: 18, us: 10, gold: 12 } },
  { id: '5y25', years: 5, maxDD: 25, label: '5年·回撤≤25%', tone: '进取', t: { safe: 8, cash: 8, oseas: 12, ballast: 13, broad: 13, single: 24, us: 12, gold: 10 } },
];
// 资产 → 战略层；手动改层（STATE.layerOverrides）优先于名称/类别自动识别
function layerKeyOfAsset(a) { return String(a.code || a.name || '').trim(); }

/* =========================================================================
   个股决策卡（Thesis Card）——买入前把「为什么买」和「什么情况证明我错了」写下来。
   设计取舍：只做【结构化记录 + 客观触发判定】，不做 AI 加权裁决、不产出买卖评级
   （多空辩论式的 0-10 加权打分是假精确，同输入两次结果就能不一样——凯利已验证过）。
   三处接线：① 证伪条件勾中 → 再平衡卖出排序判「逻辑已破」（最高优先）
            ② 逻辑窗口到期 → 时间止损，进卖出排序加权
            ③ 触及目标价/止损价/到期 → 一键记入「复盘校准」，回填后校准你的胜率
   ========================================================================= */
function thesisKeyOf(x) { return String((x && (x.code || x.name)) || '').trim(); }
/* 成本价（每股/每份，原币）——决策卡的「入场价」应取这个，不是现价。
   与「④止损防御」同口径，优先级：
     ① 持仓页手填的 cost   ② 现价 ÷ (1+持仓浮盈亏%)   ③ (资产市值 − 浮盈亏) ÷ 份额
   取不到返回 {price:null}，由调用方决定是否回退现价并标注。 */
function costPriceOf(a) {
  if (!a) return { price: null, src: '' };
  const fx = currentFx();
  const p = a.code ? (STATE.positions || []).find(x => x.code === a.code) : null;
  if (p && num(p.cost) > 0) return { price: num(p.cost), src: '持仓成本价' };
  const shares = num(a.shares);
  const cur = num(a.lastPx) > 0 ? num(a.lastPx) : (shares > 0 ? num(a.amount) / shares : null);
  if (p && cur != null && p.pnl != null && num(p.pnl) !== 0) {
    const c = cur / (1 + num(p.pnl) / 100);
    if (c > 0) return { price: +c.toFixed(4), src: '按持仓浮盈亏反推' };
  }
  if (shares > 0 && a.amount != null) {
    const pnlOrig = a.pnl != null ? (a.currency === 'USD' ? num(a.pnl) / fx : num(a.pnl)) : 0;
    const costTotal = num(a.amount) - pnlOrig;         // 原币成本总额 = 市值 − 浮盈亏
    if (costTotal > 0 && isFinite(costTotal / shares)) return { price: +(costTotal / shares).toFixed(4), src: '按市值−浮盈亏反推' };
  }
  return { price: null, src: '' };
}
function thesisOf(x) { const k = thesisKeyOf(x); return k ? (STATE.theses || {})[k] : null; }
// 证伪条件是否已触发（任一勾中）
function thesisFalsified(t) { return !!(t && Array.isArray(t.falsify) && t.falsify.some(f => f && f.hit)); }
// 逻辑兑现窗口是否已过期（时间止损）：建卡日 + months 个月 < 今天
function thesisExpired(t) {
  const due = thesisDueDate(t);
  return !!due && todayStr() > due;
}
// 加月份（月末对齐）：JS 的 setMonth 会溢出——1/31 加 1 个月得 3/3。
// 这里超出目标月天数时夹到该月最后一天，1/31+1月 = 2/28（或闰年 2/29）。
function addMonthsClamped(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  const tm = m + Math.round(months);
  const ty = y + Math.floor(tm / 12), tmm = ((tm % 12) + 12) % 12;
  const last = new Date(ty, tmm + 1, 0).getDate();
  const td = Math.min(day, last);
  return `${ty}-${String(tmm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}
function thesisDueDate(t) {
  if (!t || !(num(t.months) > 0) || !t.date) return '';
  return addMonthsClamped(t.date, num(t.months));
}
// 价格触发：目标价/止损价是否已触及（用资产最新价，无价则不判）
function thesisPriceHit(t, px) {
  const out = { target: false, stop: false };
  if (!t || !(px > 0)) return out;
  if (num(t.target) > 0 && px >= num(t.target)) out.target = true;
  if (num(t.stop) > 0 && px <= num(t.stop)) out.stop = true;
  return out;
}
// 决策卡综合状态（供各处统一取用）
function thesisStatus(x, px) {
  const t = thesisOf(x);
  if (!t) return { has: false, broken: false, expired: false, target: false, stop: false, t: null };
  const hit = thesisPriceHit(t, px != null ? px : num(x && x.lastPx));
  return { has: true, t, broken: thesisFalsified(t), expired: thesisExpired(t), target: hit.target, stop: hit.stop };
}
/* 加仓三道闸：风险预算 / 分层剩余 / 单标的集中度，取最小值。
   风险预算法（Van Tharp 2% 规则）的正确形式极简：仓位% = 单笔风险% ÷ 止损幅度%
   （常见资料把公式写错成再除以入场价，量纲就不对——这里按正确式实现）。
   注意：跳空/跌停时止损不在设定价成交，"最多亏 X%" 不是保证，故只作上限之一。 */
function sizingGates(entry, stop, total, layerRoomCny) {
  const s = STATE.settings || {};
  const riskPct = num(s.perTradeRisk, 2) || 2;
  const cap = num(s.singleCap, 10) || 10;
  const out = { riskPct, stopPct: null, byRisk: null, byLayer: layerRoomCny != null ? Math.max(0, layerRoomCny) : null, byCap: total > 0 ? total * cap / 100 : null, cap };
  if (entry > 0 && stop > 0 && stop < entry) {
    out.stopPct = (entry - stop) / entry * 100;
    if (total > 0) out.byRisk = total * (riskPct / 100) / (out.stopPct / 100);   // = 总资产 × 风险% ÷ 止损幅度%
  }
  const cands = [out.byRisk, out.byLayer, out.byCap].filter(v => v != null && isFinite(v));
  out.final = cands.length ? Math.min.apply(null, cands) : null;
  out.binding = out.final == null ? null
    : (out.final === out.byRisk ? 'risk' : out.final === out.byLayer ? 'layer' : 'cap');
  return out;
}
function layerOf(a) {
  const ov = STATE && STATE.layerOverrides && STATE.layerOverrides[layerKeyOfAsset(a)];
  if (ov && LAYER_NAME[ov]) return ov;
  const cat = a.category, name = a.name || '', usd = a.currency === 'USD';
  if (cat === '黄金') return 'gold';
  if (cat === '美股股票') return 'us';
  if (cat === '理财(QDII)') return 'oseas';
  if (cat === '定期存款') return usd ? 'oseas' : 'safe';   // 美元定存有汇率→海外固收；人民币定存→兜底
  if (cat === '人民币现金') return 'cash';
  if (cat === '香港账户现金') return 'cash';               // 美元现金：机动（币种敞口另算）
  if (cat === '基金') {
    if (/标普|纳斯达克|纳指|美国|海外|全球|S&P|QDII/i.test(name)) return 'us';   // 美元海外基金
    if (/红利|低波|高股息|价值|债|货币/i.test(name)) return 'ballast';
    return 'broad';                                        // 宽基/指数
  }
  if (cat === 'A股股票') return 'single';                  // 个股 + 行业主题ETF = 卫星弹性
  return 'cash';
}
// 锁定资产（不能自由调仓，只能用活钱/新钱平衡）：定存 + 未到期赎回期的QDII
// 注意："2027-06-03可赎"这种是【锁定】——只有明确"每日/随时/活期/T+0"才算可自由赎回
function isLockedAsset(a) {
  if (a.category === '定期存款') return true;
  if (a.category === '理财(QDII)') return !/每日|随时|活期|T\+0/.test(a.note || '');
  return false;
}
// 压力回撤估算%：各层占比(0..1) × 层回撤假设，线性求和（危机相关性→1 的保守上界）
function estStressDD(fracByLayer) {
  let dd = 0; for (const k in LAYER_DD) dd += (fracByLayer[k] || 0) * LAYER_DD[k];
  return dd;
}
// 当前持仓的层级权重(%)、锁定金额、美元敞口
function currentLayerState() {
  const fx = currentFx();
  const assets = STATE.assets || [];
  const total = assets.reduce((s, a) => s + assetCny(a, fx), 0);
  const byLayer = {}, lockedByLayer = {};
  let usdCny = 0;
  assets.forEach(a => {
    const v = assetCny(a, fx), L = layerOf(a);
    byLayer[L] = (byLayer[L] || 0) + v;
    if (isLockedAsset(a)) lockedByLayer[L] = (lockedByLayer[L] || 0) + v;
    if (a.currency === 'USD') usdCny += v;
  });
  const pct = {}, frac = {};
  LAYER_ORDER.forEach(k => { pct[k] = total > 0 ? (byLayer[k] || 0) / total * 100 : 0; frac[k] = total > 0 ? (byLayer[k] || 0) / total : 0; });
  return { total, pct, frac, cny: byLayer, locked: lockedByLayer, usdPct: total > 0 ? usdCny / total * 100 : 0 };
}
function getRebalPreset(id) { return REBAL_PRESETS.find(p => p.id === id) || REBAL_PRESETS[0]; }

// 下注/配置质量评分（0–100）：综合期望值、赔率、胜率，惩罚过度自信
// 下注/配置质量评分（0–100）：连续、单调、在 EV=0 处不断裂，且用有界压缩避免高分段饱和。
// 说明：原实现在 EV=0 处从 ~38 跳到 ~60（12–28 分断崖），且 ev×8 让好票几乎都顶到 95、
// 高分段无分辨率——AI 的 5 档估计一旦在 EV=0 两侧摆动，评分就会剧烈跳变。这里改用 tanh 压缩。
// 组合健康分（确定性、可复现）：由代码按明确规则算出，AI 只负责解释——
// 取代原来"让 LLM 每次凭空发明一个不稳定的分数"。0–100，越高越健康。
// 分级评分：每个维度按"离理想有多远"给 0..满分的连续分（不是"没突破阈值就满分"）。
// 这样结构不错但不完美的组合落在 75–90，而不是动辄 100——100 分几乎不该出现。
function computePortfolioHealth(m) {
  const liqFloor = num(m.cashFloor, 10);
  const c01 = x => Math.max(0, Math.min(1, x));
  const rows = [];
  let total = 0;
  const add = (label, max, frac, detail) => {
    const earned = Math.max(0, Math.min(max, max * frac));
    total += earned;
    const st = frac >= 0.85 ? 'ok' : frac >= 0.6 ? 'warn' : 'bad';
    rows.push([st, label, `${detail}　—　得分 ${earned.toFixed(0)}/${max}`]);
  };

  // 1 流动性(15)：低于下限重扣；下限~40% 满分；>40% 现金拖累轻扣
  let liqFrac;
  if (m.liqPct < liqFloor) liqFrac = c01(m.liqPct / liqFloor) * 0.7;
  else if (m.liqPct <= 40) liqFrac = 1;
  else liqFrac = Math.max(0.6, 1 - (m.liqPct - 40) / 100);
  add('流动性', 15, liqFrac, `可用现金 ${m.liqPct.toFixed(1)}%（下限 ${liqFloor}%，理想 ${liqFloor}–40%${m.liqPct>40?'；偏高有现金拖累':''}）`);

  // 2 大类均衡(20)：最大大类 ≤40% 满分，越集中越低，85% 归零
  add('大类均衡', 20, c01(1 - Math.max(0, m.maxBigPct - 40) / 45), `最大单一大类占 ${m.maxBigPct.toFixed(0)}%（理想 ≤40%）`);

  // 3 股票分散(15)：相关性有效持仓数 / 目标 min(名义数,4)
  if (m.nStocks > 0) {
    const target = Math.min(Math.max(m.nStocks, 1), 4);
    add('股票分散', 15, c01(m.corrEffN / target), `相关性有效持仓数 ${m.corrEffN?m.corrEffN.toFixed(1):'—'}（${m.corrSrc}，目标 ≥${target}）`);
  } else { total += 15; rows.push(['ok', '股票分散', '无个股，不适用　—　得分 15/15']); }

  // 4 回撤敞口(20)：预算用量 ≤50% 满分，用满(100%)→0.3，≥120% 归零
  const usage = m.maxDD > 0 ? m.equityDD / m.maxDD : 0;
  add('回撤敞口', 20, c01(1 - Math.max(0, usage - 0.5) / 0.7), `弹性仓回撤贡献 ${m.equityDD.toFixed(1)}% / 承受 ${m.maxDD}%（用了 ${(usage*100).toFixed(0)}% 预算，理想 ≤50%）`);

  // 5 因子集中(15)：最大因子 ≤25% 满分，65% 归零
  if (m.nStocks > 0) {
    add('因子集中', 15, c01(1 - Math.max(0, m.maxFactorW*100 - 25) / 40), `最大因子占弹性仓 ${(m.maxFactorW*100).toFixed(0)}%（理想 ≤25%）`);
  } else { total += 15; rows.push(['ok', '因子集中', '无个股，不适用　—　得分 15/15']); }

  // 6 币种敞口(15)：适度美元=分散(10–45% 满分)；过高 FX 集中；过低缺跨币种分散
  let curFrac;
  if (m.usdPct >= 10 && m.usdPct <= 45) curFrac = 1;
  else if (m.usdPct > 45) curFrac = c01(1 - (m.usdPct - 45) / 45);
  else curFrac = c01(0.7 + m.usdPct / 10 * 0.3);
  add('币种敞口', 15, curFrac, `美元敞口 ${m.usdPct.toFixed(0)}%（理想 10–45%${m.usdPct>45?'；偏高汇率集中':m.usdPct<10?'；跨币种分散不足':''}）`);

  // 上限 98：满分几乎不存在，避免"100 分"这种不可信的极端
  return { score: Math.max(5, Math.min(98, Math.round(total))), rows };
}

function betScore(ev, b, win) {
  if (!isFinite(ev)) return 50;
  const bb = isFinite(b) ? Math.min(b, 5) : 1.5;               // 赔率封顶，避免极端 b 拉爆分数
  const evTerm = 30 * Math.tanh(ev / 6);                       // EV：±∞→±30，EV=0→0（连续，无断裂）
  const bTerm = 8 * Math.tanh((bb - 1.5) / 1.5);              // 赔率：中性 1.5
  const winTerm = (Math.max(30, Math.min(70, win)) - 50) * 0.4;
  let s = 50 + evTerm + bTerm + winTerm;
  if (win > 60) s -= (win - 60) * 1.2;                         // 过度乐观降分
  return Math.max(5, Math.min(95, Math.round(s)));
}

// 汇总可选持仓（股票/基金）及其成本价、现价，供止损模块联动带出
function stopLossHoldings() {
  const fx = currentFx();
  const list = [];
  const seen = new Set();
  (STATE.positions || []).forEach(p => {
    if (!p.name) return;
    let buy = num(p.cost) > 0 ? num(p.cost) : null;
    let cur = num(p.price) > 0 ? num(p.price) : null;
    // 用同代码的资产（投资组合）补齐现价（刷新后有 lastPx）
    const a = p.code ? (STATE.assets || []).find(x => x.code === p.code) : null;
    if (cur == null && a) {
      const sh = num(a.shares);
      cur = num(a.lastPx) > 0 ? num(a.lastPx) : (sh > 0 ? num(a.amount) / sh : null);
    }
    // 有现价 + 持仓浮盈亏% → 反推成本价（成本 = 现价 ÷ (1 + 盈亏%/100)）
    if (buy == null && cur != null && p.pnl != null && num(p.pnl) !== 0) {
      const c = cur / (1 + num(p.pnl) / 100);
      if (c > 0) buy = c;
    }
    list.push({ key: 'pos:' + p.id, name: p.name, code: p.code || '', buy, cur, kind: '持仓' });
    if (p.code) seen.add(p.code);
  });
  (STATE.assets || []).forEach(a => {
    if (!['基金', 'A股股票', '美股股票'].includes(a.category)) return;
    if (a.code && seen.has(a.code)) return;            // 已在持仓里出现，避免重复
    const shares = num(a.shares);
    const cur = num(a.lastPx) > 0 ? num(a.lastPx) : (shares > 0 ? num(a.amount) / shares : null);
    let buy = null;
    if (shares > 0 && a.amount != null) {
      const pnlOrig = a.pnl != null ? (a.currency === 'USD' ? num(a.pnl) / fx : num(a.pnl)) : 0;
      const costTotal = num(a.amount) - pnlOrig;       // 原币成本总额 = 市值 − 浮盈亏
      if (costTotal > 0) buy = costTotal / shares;
    }
    list.push({ key: 'ast:' + a.id, name: a.name, code: a.code || '', buy, cur, kind: a.category === '基金' ? '基金' : '持仓' });
  });
  return list;
}

VIEWS.stoploss = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>④ 止损防御 · 固定分数止损</h2>
      <p>由"单笔最多亏多少本金"反推最大可买仓位。先定止损，再定仓位。</p>
    </div>
  `));

  const s = STATE.settings;
  const holdings = stopLossHoldings();
  const fmtPx = v => (v != null && isFinite(v)) ? (+v).toFixed(v >= 100 ? 2 : 3) : '—';
  const card = el('<div class="card"></div>');
  card.appendChild(el(`
    ${holdings.length ? `<div class="field"><label>从持仓/基金选择（自动带出成本价，可手动修正）</label>
      <select id="sl-pick">
        <option value="">— 手动输入 —</option>
        ${holdings.map(h => `<option value="${h.key}">${escapeHtml(h.name)}${h.code ? '（' + escapeHtml(h.code) + '）' : ''} · 成本 ${fmtPx(h.buy)} · 现价 ${fmtPx(h.cur)}</option>`).join('')}
      </select>
      <p class="inline-note" id="sl-pick-note">选一只，会把成本价填进「买入价」；现价仅供你参考着定止损。都可手改。</p></div>` : ''}
    <div class="grid grid-2">
      <div class="field"><label>总资产（自动汇总）</label>
        <input id="sl-total" type="number" step="1000" value="${portfolioTotal()>0?portfolioTotal():''}" placeholder="如 1000000"/></div>
      <div class="field"><label>单笔可接受最大亏损（占总资产）</label>
        <div class="suffix-input"><input id="sl-risk" type="number" step="0.5" value="${s.perTradeRisk}"/><span>%</span></div></div>
    </div>
    <div class="grid grid-2">
      <div class="field"><label>买入价（成本价）</label><input id="sl-buy" type="number" step="0.01" placeholder="20.00"/></div>
      <div class="field"><label>计划止损价</label><input id="sl-stop" type="number" step="0.01" placeholder="18.00"/></div>
    </div>
    <button class="btn" id="sl-calc">计算最大可买仓位</button>
    <div id="sl-result"></div>
  `));
  app.appendChild(card);

  const pick = card.querySelector('#sl-pick');
  if (pick) pick.onchange = () => {
    const h = holdings.find(x => x.key === pick.value);
    const note = card.querySelector('#sl-pick-note');
    if (!h) { if (note) note.textContent = '选一只，会把成本价填进「买入价」；现价仅供你参考着定止损。都可手改。'; return; }
    const base = h.buy != null ? h.buy : h.cur;         // 优先成本价，无则用现价
    if (base != null) card.querySelector('#sl-buy').value = +base.toFixed(base >= 100 ? 2 : 3);
    // 按默认止损幅度给个建议止损价（买入价 × (1 − 默认止损%)），用户可改
    const stopHint = base != null ? base * (1 - Math.max(0.02, num(s.perTradeRisk) / 100 * 4)) : null;
    if (note) note.innerHTML = `已带出${h.buy != null ? '成本价' : '现价'} <strong>${fmtPx(base)}</strong>`
      + (h.cur != null ? `，当前价 <strong>${fmtPx(h.cur)}</strong>` : '')
      + `。可手动修正；止损价请自行设定${stopHint != null ? '（参考：' + stopHint.toFixed(stopHint >= 100 ? 2 : 3) + '）' : ''}。`;
  };

  card.querySelector('#sl-calc').onclick = () => {
    const box = card.querySelector('#sl-result');
    box.innerHTML = '';
    const total = num(card.querySelector('#sl-total').value);
    const risk = num(card.querySelector('#sl-risk').value);
    const buy = num(card.querySelector('#sl-buy').value);
    const stop = num(card.querySelector('#sl-stop').value);

    if (total <= 0 || risk <= 0) { box.appendChild(el(`<div class="alert red"><span class="icon">${icon('danger')}</span><div>请填写有效的总资产与单笔风险。</div></div>`)); return; }
    if (stop >= buy || buy <= 0 || stop <= 0) {
      box.appendChild(el(`<div class="alert red"><span class="icon">${icon('danger')}</span><div>止损价须为正且低于买入价（否则不构成止损）。</div></div>`));
      return;
    }
    // 标的所属市场（从选中的持仓带出代码）→ 决定涨跌停/T+1/手数
    const picked = pick ? holdings.find(x => x.key === pick.value) : null;
    const code = picked ? (picked.code || '') : '';
    const mkt = marketOf(code);
    const limit = dailyLimitPct(code);      // A股单日涨跌停幅度；美股为 null
    const lot = lotSizeOf(code);

    const r = Calc.fixedFractionalSize(total, risk, buy, stop);
    const capValue = total * (s.singleCap / 100);
    const overCap = r.positionValue > capValue;
    const lotShares = sharesFromCny(r.positionValue, buy, code);   // 仓位金额(¥)先折币种再÷单价（美股修正）
    box.appendChild(el(`
      <div class="result-box">
        <div class="metric-row"><span class="k">止损幅度 = (买入−止损)/买入</span><span class="v">${fmtPct(r.stopPct,2)}</span></div>
        <div class="metric-row"><span class="k">单笔风险金额 = 总资产×${risk}%</span><span class="v">${fmtMoney(r.riskAmount)}</span></div>
        <div class="metric-row"><span class="k">最大可买仓位金额</span><span class="v" style="color:var(--accent)">${fmtMoney(r.positionValue)}</span></div>
        <div class="metric-row"><span class="k">对应股数（${lot > 1 ? '整手 ' + lot + ' 股/手' : '可买 1 股'}）</span><span class="v">${lotShares.toLocaleString()}${lot > 1 ? '（' + (lotShares / lot) + ' 手）' : ''}</span></div>
        <div class="metric-row"><span class="k">占总资产</span><span class="v">${fmtPct(r.positionValue/total*100,1)}</span></div>
      </div>
      <div class="alert blue"><span class="icon">${icon('pin')}</span><div>
        若买入 ${fmtMoney(r.positionValue)} 并在 ${buy} <strong>能够按 ${stop} 成交</strong>离场，亏损约为总资产的 ${risk}%（${fmtMoney(r.riskAmount)}）。
      </div></div>
    `));

    // A股：止损可能因涨跌停/T+1/一字板无法成交 —— 用「跳空最坏情形」再给一个更保守的仓位上限
    if (limit != null) {
      const stopPct = r.stopPct;                        // 名义止损幅度%
      // 若名义止损 < 单日跌停幅度，跌停当天根本到不了止损价；一字跌停还卖不出，可能连续多日
      const gapUnexecutable = stopPct < limit;
      const worstDropPct = Math.max(stopPct, limit);    // 最坏至少吃一个跌停
      const gapPos = Calc.fixedFractionalSize(total, risk, 100, 100 * (1 - worstDropPct / 100));
      box.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>
        <strong>${MARKET_LABEL[mkt]}·涨跌停 ±${limit}%·T+1</strong>：${gapUnexecutable
          ? `你的止损幅度 ${fmtPct(stopPct,1)} <strong>小于单日跌停 ${limit}%</strong>——跌停当天价格<strong>到不了</strong>止损价，只能靠隔日跳空砸下去；若<strong>一字跌停</strong>更是<strong>卖不出</strong>，可能连续多日。`
          : `即使止损幅度 ${fmtPct(stopPct,1)} ≥ 单日跌停，一字板仍可能<strong>无法成交</strong>。`}
        当日买入受 <strong>T+1</strong> 限制当天不可卖。<br>
        <strong>按「至少吃一个跌停(−${limit}%)」的最坏情形反推，同样 ${risk}% 风险预算下仓位应压到约 ${fmtMoney(gapPos.positionValue)}（占 ${fmtPct(gapPos.positionValue/total*100,1)}）。</strong>该止损为参考，不保证成交。</div></div>`));
    } else if (mkt === 'US') {
      box.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>
        <strong>美股·无涨跌停</strong>：止损通常能成交，但<strong>隔夜跳空 / 熔断（−7/−13/−20%）</strong>会击穿止损、以更差价格成交（滑价）。财报/突发事件前后尤甚，实际亏损可能大于 ${risk}%。</div></div>`));
    }

    if (overCap) {
      box.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>
        该仓位金额 ${fmtMoney(r.positionValue)} 占 ${fmtPct(r.positionValue/total*100,1)}，超过单股上限 ${s.singleCap}%（${fmtMoney(capValue)}）。建议以单股上限为准，或收紧止损。
      </div></div>`));
    }
  };
};

/* =========================================================================
   模块 5 — 铁律校验引擎（操作拦截）灵魂功能
   ========================================================================= */
VIEWS.rules = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>② 铁律校验 · 操作拦截引擎</h2>
      <p>任何"加仓"操作前跑一遍校验。触发任一条即弹出必须二次确认才能越过的红色拦截。</p>
    </div>
  `));

  const s = STATE.settings;
  const positions = STATE.positions;
  const totalWeight = positions.reduce((a, p) => a + num(p.weight), 0);
  const options = positions.map(p => `<option value="${p.id}">${escapeHtml(p.name)}（${escapeHtml(p.factor)}，占 ${fmtPct(num(p.weight),1)}）</option>`).join('');

  const card = el('<div class="card"><h3>拟加仓操作</h3></div>');
  card.appendChild(el(`
    <div class="grid grid-2">
      <div class="field"><label>选择标的（已有持仓）</label>
        <select id="r-pos">
          <option value="">— 手动输入（不在持仓列表）—</option>
          ${options}
        </select>
      </div>
      <div class="field"><label>或手动输入标的名称 / 代码</label>
        <input id="r-name" placeholder="如 贵州茅台 / 600519 / TCOM"/>
        <p class="inline-note">不在持仓里的标的可直接手填；下面的浮盈亏 / 占比 / 趋势 / 因子也都可手动填写。</p>
      </div>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>当前浮盈亏 %</label><input id="r-pnl" type="number" step="0.1" placeholder="-8"/></div>
      <div class="field"><label>当前趋势</label>
        <select id="r-trend">${TRENDS.map((t,i)=>`<option ${i===2?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>当前占比 %</label><input id="r-cur" type="number" step="0.1" placeholder="8"/></div>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>本次加仓金额（元）<span class="req">*</span></label><input id="r-addamt" type="number" step="1000" placeholder="如 50000"/></div>
      <div class="field"><label>本次加仓占比 %（自动）</label><input id="r-add" type="number" step="0.1" placeholder="按金额÷总资产自动算，也可手填"/></div>
      <div class="field"><label>上次加仓金额（可选）</label><input id="r-lastamt" type="number" step="1000" placeholder="正金字塔校验用"/></div>
    </div>
    <p class="inline-note">加仓以<strong>金额</strong>为准：占比 = 加仓金额 ÷ 总资产（当前 ${fmtMoney(portfolioTotal())}）自动计算。</p>
    <label class="check-row"><input type="checkbox" id="r-planned"/> <span>这是<strong>计划内的分批建仓 / 定投</strong>（正金字塔，预设了价位区间）——不是套牢后临时摊平</span></label>
    <div class="field"><label>该标的因子（用于集中度校验）</label>
      <select id="r-factor">${FACTORS.map(f=>`<option>${f}</option>`).join('')}</select></div>
    <button class="btn danger" id="r-check">${icon('search')} 运行铁律校验</button>
    <div id="r-result"></div>
  `));
  app.appendChild(card);

  // 选中已有持仓时自动填充（含名称）；选「手动输入」则清空名称让用户自填
  card.querySelector('#r-pos').onchange = (e) => {
    const p = positions.find(x => x.id === e.target.value);
    if (!p) { card.querySelector('#r-name').value = ''; return; }
    card.querySelector('#r-name').value = p.name + (p.code ? '（' + p.code + '）' : '');
    card.querySelector('#r-pnl').value = p.pnl;
    card.querySelector('#r-trend').value = p.trend;
    card.querySelector('#r-cur').value = p.weight;
    // 因子：尊重已标注的非默认因子；若是默认「AI算力」（很可能是没改的默认值）则按名称智能识别
    card.querySelector('#r-factor').value = (p.factor && p.factor !== 'AI算力') ? p.factor : guessFactor(p.name);
  };
  // 手动输入名称/代码时，按名称自动识别因子（减少手选错标）
  card.querySelector('#r-name').addEventListener('input', (e) => {
    const g = guessFactor(e.target.value);
    if (g !== '其它') card.querySelector('#r-factor').value = g;
  });

  // 加仓金额 → 自动算占比（金额优先，符合操作习惯）
  card.querySelector('#r-addamt').addEventListener('input', (e) => {
    const amt = num(e.target.value);
    const tot = portfolioTotal();
    const addField = card.querySelector('#r-add');
    if (amt > 0 && tot > 0) addField.value = (amt / tot * 100).toFixed(2);
    else if (!amt) addField.value = '';
  });

  // 铁律表
  const rulesRef = el(`<div class="card" style="margin-top:16px"><h3>七条铁律</h3>
    <div class="table-scroll"><table><thead><tr><th>铁律</th><th>触发条件</th></tr></thead>
    <tbody>
      <tr><td>亏损加仓（分级）</td><td>深套(≥20%)硬拦；浅亏非计划内→提醒；浅亏+计划内分批+非下跌→放行</td></tr>
      <tr><td>禁止下跌趋势加仓</td><td>趋势=下跌/加速下跌 + 加仓（接刀）</td></tr>
      <tr><td>单股仓位上限</td><td>加仓后 > 上限（默认 ${s.singleCap}%）</td></tr>
      <tr><td>正金字塔校验</td><td>高位加仓金额 ≥ 上次</td></tr>
      <tr><td>因子集中度</td><td>加仓后某因子 > 风险档上限（稳健50/均衡60/进取75，占弹性仓）</td></tr>
      <tr><td>现金蓄水池</td><td>加仓后真实现金（现金类资产−加仓金额）< ${s.cashFloor}% 总资产</td></tr>
      <tr><td>胜率诚实度</td><td>胜率 > 60% 无充分理由（在「① 凯利定注」中强制校验）</td></tr>
    </tbody></table></div></div>`);
  app.appendChild(rulesRef);

  card.querySelector('#r-check').onclick = async () => {
    const box = card.querySelector('#r-result');
    box.innerHTML = '';
    const pnl = num(card.querySelector('#r-pnl').value);
    const trend = card.querySelector('#r-trend').value;
    const cur = num(card.querySelector('#r-cur').value);
    const addAmt = num(card.querySelector('#r-addamt').value);
    const lastAmt = num(card.querySelector('#r-lastamt').value);
    const factor = card.querySelector('#r-factor').value;
    const selId = card.querySelector('#r-pos').value;
    const name = card.querySelector('#r-name').value.trim();
    const tot = portfolioTotal();

    // 金额优先：有加仓金额则由金额÷总资产算占比；否则回退到手填占比
    let add = num(card.querySelector('#r-add').value);
    if (addAmt > 0 && tot > 0) add = addAmt / tot * 100;

    if (add <= 0) {
      box.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>请填写本次加仓金额（元），或直接手填加仓占比 %。</div></div>`));
      return;
    }

    if (name) box.appendChild(el(`<div class="mini-label" style="margin-bottom:8px">校验标的：<strong>${escapeHtml(name)}</strong></div>`));

    // 回显：金额 → 自动占比（让用户确认按金额算出的比例）
    if (addAmt > 0 && tot > 0) {
      box.appendChild(el(`<div class="alert" style="margin-bottom:10px"><span class="icon">${icon('info')}</span><div>
        本次加仓 <strong>${fmtMoney(addAmt)}</strong> ÷ 总资产 ${fmtMoney(tot)} = 加仓占比 <strong>${fmtPct(add,2)}</strong>（加仓后该股 ${fmtPct(cur+add,2)}）。
      </div></div>`));
    }

    const planned = card.querySelector('#r-planned').checked;
    const DEEP_LOSS = num(s.deepLossAdd, 20);   // 深套阈值 %（设置里可调）
    const violations = [], softWarnings = [];

    // 铁律1 亏损加仓（分级，而非一刀切）：
    //  · 深套(浮亏≥阈值) → 硬拦：套牢摊平的典型死亡螺旋，需复核原逻辑后二次确认
    //  · 浅亏 + 下跌趋势 → 由铁律2 接管（接刀）
    //  · 浅亏 + 非计划内 → 软提醒：区分“计划内分批”还是“套牢摊平”
    //  · 浅亏 + 计划内分批 + 非下跌 → 放行（视为纪律内）
    const downtrend = (trend === '下跌' || trend === '加速下跌');
    if (pnl < 0) {
      if (pnl <= -DEEP_LOSS) {
        // 价值型分批的例外：预先声明的计划内分批 + 非下跌趋势 → 降级为强提醒而非硬拦
        // （价值投资里，逻辑未破时更低价是更好的价格；但必须是预设的、带总仓位上限与证伪止损的计划，
        //   而不是套牢后临时“摊平回本”。下跌趋势仍由铁律2硬拦。）
        if (planned && !downtrend) {
          softWarnings.push('深套 ' + fmtPct(pnl,1) + ' 但你声明这是<strong>计划内价值分批</strong>：仅在满足 ① 买入逻辑经复核仍成立（非“跌了更便宜”）② 这是预设的最后几批、有总仓位上限 ③ 设了硬性证伪止损 时才继续。若其一不满足，请当作套牢摊平处理、不要加。');
        } else {
          violations.push('深套加仓（浮亏 ' + fmtPct(pnl,1) + '，已超 ' + DEEP_LOSS + '%）：这是“套牢摊平”死亡螺旋的典型入口。除非同时满足 ① 原始买入逻辑经复核仍成立（不是“跌了更便宜”）② 这是计划内的最后一批 ③ 加仓后总仓位仍在回撤预算与单股上限内，否则不应加仓。（如确为预先声明的价值分批，请勾选“计划内分批”并确保趋势非下跌。）');
        }
      } else if (!downtrend && !planned) {
        softWarnings.push('浮亏 ' + fmtPct(pnl,1) + ' 补仓：请先确认这是“计划内分批 / 企稳补仓”，而非“套牢摊平”。若无预设计划，倾向于等企稳或按计划再买。');
      }
      // 浅亏 + 计划内 + 非下跌 → 视为纪律内正金字塔，放行（不拦不提醒）
    }
    // 铁律2 禁止下跌趋势加仓（接刀；真正的反转应标为企稳/震荡/向上）
    if (downtrend) violations.push('禁止下跌趋势加仓：趋势为「' + trend + '」，加仓＝接刀，等企稳/反转确认。');
    // 铁律3 单股仓位上限（epsilon 容差，避免浮点误判"恰好等于上限"）
    const after = cur + add;
    if (after > s.singleCap + 1e-9) violations.push('单股仓位上限：加仓后占比 ' + fmtPct(after,1) + ' > 上限 ' + s.singleCap + '%，违反分散原则。');
    // 铁律4 正金字塔校验（用等效加仓金额：没填金额、只填占比时，按占比×总资产折算，避免被绕过）
    const effAddMoney = addAmt > 0 ? addAmt : (tot > 0 ? add / 100 * tot : 0);
    if (effAddMoney > 0 && lastAmt > 0 && effAddMoney >= lastAmt) violations.push('正金字塔校验：本次加仓 ' + fmtMoney(effAddMoney) + ' ≥ 上次 ' + fmtMoney(lastAmt) + '，高位应递减加仓，你正头重脚轻。');
    // 铁律5 因子集中度（加仓后）
    {
      // 计算加仓后该因子占比
      const posCopy = positions.map(p => ({ factor: p.factor, weight: num(p.weight), id: p.id }));
      if (selId) {
        const t = posCopy.find(p => p.id === selId);
        // 用下拉选定的因子归因（用户手动改了下拉时，加仓权重也归到该因子，校验口径才一致）
        if (t) { t.factor = factor; t.weight += add; } else posCopy.push({ factor, weight: cur + add });
      } else {
        posCopy.push({ factor, weight: cur + add });
      }
      const { factorWeights } = Calc.effectiveBets(posCopy);
      const fw = factorWeights[factor] || 0;
      const lvl = EQUITY_RISK_LEVELS[s.equityRiskLevel] || EQUITY_RISK_LEVELS['进取'];
      const factorCapPct = lvl.factor;   // 与「股票体检」一致的、随风险档变化的因子上限（稳健50/均衡60/进取75）
      if (fw * 100 > factorCapPct + 1e-9) violations.push('因子集中度：加仓后因子「' + factor + '」占 ' + fmtPct(fw*100,0) + ' > ' + lvl.label + '档上限 ' + factorCapPct + '%，该操作加重单一 beta 集中度。');
    }
    // 铁律6 现金蓄水池——真实口径：现金类资产（含股票现金池）÷ 总资产，
    // 加仓后现金 = 当前现金 − 本次加仓金额。无资产明细时回退到「100−股票总仓位」推算口径。
    {
      const addMoney = addAmt > 0 ? addAmt : (tot > 0 ? add / 100 * tot : 0);
      if ((STATE.assets || []).length && tot > 0) {
        const cashNow = cashAssetsCny();
        const afterCashPct = (cashNow - addMoney) / tot * 100;
        if (afterCashPct < s.cashFloor - 1e-9) violations.push('现金蓄水池：当前现金 ' + fmtMoney(cashNow) + '（' + fmtPct(cashNow / tot * 100,1) + '），加仓 ' + fmtMoney(addMoney) + ' 后现金占比降至 ' + fmtPct(afterCashPct,1) + ' < ' + s.cashFloor + '%，丧失回调加仓能力。');
      } else {
        // 选中已有持仓：cur 已计入 totalWeight，只加 add；手动输入需加 cur + add。
        const afterTotal = totalWeight + (selId ? add : cur + add);
        if (afterTotal > (100 - s.cashFloor)) violations.push('现金蓄水池：加仓后总仓位 ' + fmtPct(afterTotal,1) + ' 使现金 < ' + s.cashFloor + '%，丧失回调加仓能力。');
      }
    }

    // 软提醒（黄色，不拦截，但要看到）
    const showSoft = () => { if (softWarnings.length) box.appendChild(el(`<div class="alert amber" style="margin-top:10px"><span class="icon">${icon('warn')}</span><div>
      <strong>提醒（不拦截，请自行判断）：</strong><br>${softWarnings.map(v=>'· '+v).join('<br>')}</div></div>`)); };

    if (violations.length === 0) {
      box.appendChild(el(`<div class="alert green" style="margin-top:14px"><span class="icon">${icon('check')}</span><div>
        <strong>${softWarnings.length ? '未触发硬性拦截' : '通过全部铁律校验'}</strong>，本次加仓未被硬拦。仍请对照客观依据后再操作。
      </div></div>`));
      showSoft();
      return;
    }

    // 有硬违规：先展示违规 + 软提醒，再弹阻塞式二次确认
    box.appendChild(el(`<div class="alert red" style="margin-top:14px"><span class="icon">${icon('danger')}</span><div>
      <strong>触发 ${violations.length} 条铁律，操作被拦截：</strong><br>${violations.map(v=>'· '+v).join('<br>')}
    </div></div>`));
    showSoft();

    const proceed = await showBlockingModal({
      title: '铁律拦截 · 需二次确认',
      lines: violations,
    });
    if (proceed) {
      box.appendChild(el(`<div class="alert amber" style="margin-top:10px"><span class="icon">${icon('warn')}</span><div>
        你已二次确认越过 ${violations.length} 条铁律。请记住：越过拦截的责任在你，工具已尽到守门员职责。
      </div></div>`));
    } else {
      box.appendChild(el(`<div class="alert green" style="margin-top:10px"><span class="icon">${icon('shield')}</span><div>
        已取消该加仓操作。守住纪律，就是守住本金。
      </div></div>`));
    }
  };
};

/* =========================================================================
   模块 6 — 加仓计划器 + 利润隔离（执行辅助）
   ========================================================================= */
VIEWS.planner = function (app) {
  const s = STATE.settings;
  app.appendChild(el(`
    <div class="view-head">
      <h2>⑤ 加减仓计划</h2>
      <p>加仓：正金字塔分批（越低买越多）＋橄榄型模板＋浮盈隔离。减仓/退出：基于事实、剔除成本干扰的科学退出算法。</p>
    </div>
  `));

  const segCard = el(`<div class="card" style="padding:12px 16px;margin-bottom:16px"><div class="seg" id="pl-seg">
    <button class="seg-btn active" data-t="add">加仓计划</button>
    <button class="seg-btn" data-t="reduce">减仓 / 退出</button>
  </div></div>`);
  app.appendChild(segCard);
  const body = el('<div id="pl-body"></div>');
  app.appendChild(body);
  const show = (t) => {
    segCard.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.t === t));
    body.innerHTML = '';
    (t === 'reduce' ? renderReduce : renderAdd)(body);
  };
  segCard.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => show(b.dataset.t));
  show('add');

  function renderAdd(app) {
  /* --- 橄榄型仓位模板 --- */
  app.appendChild(el(`<div class="card"><h3>橄榄型仓位模板</h3>
    <p class="hint">试水 → 趋势明确 → 泡沫期收缩，全程留现金池</p>
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat"><div class="label">试水期</div><div class="value" style="font-size:22px">10–15%</div><div class="sub">小仓验证逻辑</div></div>
      <div class="stat"><div class="label">趋势明确</div><div class="value" style="font-size:22px">50–60%</div><div class="sub">加至主力仓</div></div>
      <div class="stat"><div class="label">泡沫期</div><div class="value" style="font-size:22px">&lt;10%</div><div class="sub">收缩 + 留现金</div></div>
    </div></div>`));

  /* --- 正金字塔加仓 --- */
  const pyramid = el(`<div class="card" style="margin-top:16px"><h3>正金字塔分批加仓</h3>
    <p class="hint">输入价位区间与总投入，系统生成"越低买越多、越高买越少"的分批金额（最大一笔永远在区间最低价）</p></div>`);
  pyramid.appendChild(el(`
    <div class="field"><label>分批模式</label>
      <div class="seg" id="py-seg">
        <button class="seg-btn active" data-mode="dip" type="button">回调分批 · 等跌（区间在现价下方）</button>
        <button class="seg-btn" data-mode="trend" type="button">顺势分批 · 现价起步（区间在现价上方）</button>
      </div>
      <p class="inline-note" id="py-mode-note">回调分批：赌它跌下来摊低成本，最大一笔在低位——<strong>若个股一路上涨、不回调，低位批次成交不了</strong>。判断会回调时用。</p>
    </div>
    <div class="field"><label>标的代码（A股/ETF 数字，美股字母；可留空手填）</label>
      <div class="row" style="gap:6px;max-width:420px">
        <input id="py-code" placeholder="如 002518 / 513260 / TCOM" style="flex:1"/>
        <button class="btn secondary" id="py-fetch" style="flex:0 0 auto">获取现价</button>
      </div>
      <p class="inline-note" id="py-code-note">获取现价后，按所选模式自动填入价位区间（可改）。</p>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>最低价（买最多）</label><input id="py-low" type="number" step="0.01" placeholder="18"/></div>
      <div class="field"><label>最高价（买最少）</label><input id="py-high" type="number" step="0.01" placeholder="24"/></div>
      <div class="field"><label>分几批（2–12）</label><input id="py-n" type="number" step="1" min="2" max="12" value="4"/></div>
    </div>
    <div class="field"><label>本轮计划总投入金额</label><input id="py-total" type="number" step="1000" placeholder="100000"/></div>
    <button class="btn" id="py-calc">生成分批计划</button>
    <div id="py-result"></div>
  `));
  app.appendChild(pyramid);

  let pyMode = 'dip', pyCur = 0;   // 分批模式 + 最近获取的现价（切模式时按现价重填区间）
  const fillRange = (cur) => {
    if (!(cur > 0)) return;
    const dp = cur >= 100 ? 2 : 3;
    if (pyMode === 'dip') {        // 等跌：现价为顶，−15% 为底
      pyramid.querySelector('#py-high').value = +cur.toFixed(dp);
      pyramid.querySelector('#py-low').value = +(cur * 0.85).toFixed(dp);
    } else {                       // 顺势：现价为底（最大一笔立即成交），+15% 为顶
      pyramid.querySelector('#py-low').value = +cur.toFixed(dp);
      pyramid.querySelector('#py-high').value = +(cur * 1.15).toFixed(dp);
    }
  };
  const modeNote = pyramid.querySelector('#py-mode-note');
  pyramid.querySelectorAll('#py-seg .seg-btn').forEach(btn => {
    btn.onclick = () => {
      pyramid.querySelectorAll('#py-seg .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pyMode = btn.dataset.mode;
      modeNote.innerHTML = pyMode === 'dip'
        ? '回调分批：赌它跌下来摊低成本，最大一笔在低位——<strong>若个股一路上涨、不回调，低位批次成交不了</strong>。判断会回调时用。'
        : '顺势分批：<strong>最大一笔就在现价、立即建仓</strong>，之后越涨买越少（不追高大单）。适合上涨趋势想建/加仓、又怕踏空时用。';
      fillRange(pyCur);            // 已获取过现价则按新模式重填区间
    };
  });

  pyramid.querySelector('#py-fetch').onclick = async () => {
    const note = pyramid.querySelector('#py-code-note');
    const code = pyramid.querySelector('#py-code').value.trim();
    if (!code) { note.textContent = '请先填标的代码（数字 A股/ETF，字母美股）。'; return; }
    note.textContent = '获取中…'; note.style.color = 'var(--muted)';
    try {
      const q = await fetchQuote(code);
      pyCur = num(q.price);
      fillRange(pyCur);
      note.innerHTML = `${icon('check')} ${escapeHtml(q.name)}  现价 ${pyCur}，已按「${pyMode === 'dip' ? '回调·等跌' : '顺势·现价起步'}」填入价位区间（可改）`; note.style.color = 'var(--green)';
    } catch (e) {
      note.innerHTML = `${icon('warn')} 获取失败（${escapeHtml(e.message)}）——请手动填价位`; note.style.color = 'var(--amber)';
    }
  };

  pyramid.querySelector('#py-calc').onclick = () => {
    const box = pyramid.querySelector('#py-result');
    box.innerHTML = '';
    const low = num(pyramid.querySelector('#py-low').value);
    const high = num(pyramid.querySelector('#py-high').value);
    const n = Math.min(12, Math.max(2, Math.floor(num(pyramid.querySelector('#py-n').value, 4)))); // 批次 2–12，防误输超大值
    const total = num(pyramid.querySelector('#py-total').value);
    if (low <= 0 || high <= low || total <= 0) {
      box.appendChild(el(`<div class="alert red"><span class="icon">${icon('danger')}</span><div>请确保最高价 > 最低价，且金额为正。</div></div>`));
      return;
    }
    const pyCode = pyramid.querySelector('#py-code').value.trim();
    const pyLot = lotSizeOf(pyCode);
    // 权重：越低价权重越大。用线性递减权重 n, n-1, ..., 1 分配到从低到高的价位
    const prices = [];
    for (let i = 0; i < n; i++) prices.push(low + (high - low) * i / (n - 1));
    const weights = prices.map((_, i) => n - i); // i=0(最低价)权重最大
    const wsum = weights.reduce((a, b) => a + b, 0);
    let costSum = 0;
    const rows = prices.map((price, i) => {
      const amt = total * weights[i] / wsum;
      const shares = sharesFromCny(amt, price, pyCode);  // 金额(¥)先折币种再÷单价；A股取整到手
      costSum += tradeCost(pyCode, shares * price * (isUsCode(pyCode) ? currentFx() : 1), 'buy');   // 美股股数×美元价 → 先折人民币再估费
      return `<tr>
        <td>第 ${i+1} 批</td>
        <td class="num">${price.toFixed(2)}</td>
        <td class="num">${fmtMoney(amt)}</td>
        <td class="num">${fmtPct(weights[i]/wsum*100,0)}</td>
        <td class="num">${shares.toLocaleString()}${pyLot > 1 ? '（' + (shares / pyLot) + '手）' : ''}</td>
      </tr>`;
    }).join('');
    box.appendChild(el(`<div class="table-scroll" style="margin-top:14px"><table>
      <thead><tr><th>批次</th><th class="num">价位</th><th class="num">买入金额</th><th class="num">占比</th><th class="num">股数${pyLot > 1 ? '(整手)' : ''}</th></tr></thead>
      <tbody>${rows}<tr class="total-row"><td>合计</td><td></td><td class="num">${fmtMoney(total)}</td><td class="num">100%</td><td></td></tr></tbody>
    </table></div>`));
    box.appendChild(el(`<p class="inline-note">${pyLot > 1 ? 'A股按 100 股/手取整，' : ''}预估交易成本约 <strong>${fmtMoney(costSum)}</strong>（${marketOf(pyCode) === 'US' ? '美股近零佣' : 'A股佣金+印花税'}，仅供参考）。</p>`));
    box.appendChild(el(`<div class="alert blue" style="margin-top:12px"><span class="icon">${icon('ruler')}</span><div>
      正金字塔：最大一笔永远在区间最低价，越高买越少，避免高位头重脚轻。${pyMode === 'dip'
        ? '当前为<strong>回调·等跌</strong>模式：低位批次要等股价跌到该价位才成交；若判断这是上涨趋势股，改用「顺势·现价起步」。'
        : '当前为<strong>顺势·现价起步</strong>模式：第 1 批就在现价立即建仓，随后逐级加码但金额递减（不追高大单）。'}
    </div></div>`));
  };

  /* --- 利润隔离 --- */
  const lock = el(`<div class="card" style="margin-top:16px"><h3>利润隔离（部分止盈）</h3>
    <p class="hint">浮盈超阈值（默认 +${s.profitLockThreshold}%）时，提醒<strong>部分</strong>止盈锁进安全资产——不是清仓。让剩余仓位配<strong>移动止损</strong>继续奔跑，兼顾“落袋”与“不错杀牛股”。</p></div>`);
  app.appendChild(lock);

  const gainers = STATE.positions.filter(p => num(p.pnl) >= s.profitLockThreshold);
  if (STATE.positions.length === 0) {
    lock.appendChild(el(`<div class="empty"><p>先录入持仓后，这里会自动列出达到隔离阈值的标的。</p></div>`));
  } else if (gainers.length === 0) {
    lock.appendChild(el(`<div class="alert blue"><span class="icon">${icon('moon')}</span><div>当前没有浮盈达到 +${s.profitLockThreshold}% 的标的，无需隔离。</div></div>`));
  } else {
    const totalAssets = portfolioTotal();   // 为 0 时金额列显示 ¥0，请到「设置/投资组合」补齐总资产
    const scroll = el('<div class="table-scroll"></div>');
    const rows = gainers.map(p => {
      const w = num(p.weight);
      const posValue = totalAssets * w / 100;
      const gainValue = posValue * num(p.pnl) / 100 / (1 + num(p.pnl) / 100); // 浮盈金额估算
      const suggest = gainValue * 0.5; // 建议隔离一半浮盈
      const locked = num(p.lockedProfit);
      return `<tr>
        <td>${escapeHtml(p.name)}</td>
        <td class="num" style="color:var(--green)">+${fmtPct(num(p.pnl),1)}</td>
        <td class="num">${fmtMoney(posValue)}</td>
        <td class="num">${fmtMoney(gainValue)}</td>
        <td class="num" style="color:var(--accent)">${fmtMoney(suggest)}</td>
        <td class="num">${fmtMoney(locked)}</td>
        <td class="num"><button class="btn secondary small" data-lock="${p.id}" data-amt="${Math.round(suggest)}">记录隔离</button></td>
      </tr>`;
    }).join('');
    scroll.appendChild(el(`<table><thead><tr>
      <th>标的</th><th class="num">浮盈</th><th class="num">持仓市值</th>
      <th class="num">浮盈金额*</th><th class="num">建议隔离</th><th class="num">已隔离</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>`));
    lock.appendChild(scroll);
    lock.appendChild(el(`<p class="inline-note">*浮盈金额为按当前占比与浮盈率的估算，仅作参考。“建议隔离”默认取浮盈一半——这是<strong>部分止盈</strong>而非清仓：锁一半落袋、剩余仓位挂移动止损让利润奔跑。机械式全部止盈会砍掉真正的复利大牛股，故只锁一部分。</p>`));
    scroll.querySelectorAll('[data-lock]').forEach(b => b.onclick = () => {
      const p = STATE.positions.find(x => x.id === b.dataset.lock);
      if (!p) return;
      const amt = prompt('记录本次隔离到安全资产的金额：', b.dataset.amt);
      if (amt == null) return;
      p.lockedProfit = num(p.lockedProfit) + num(amt);
      saveState(); render();
    });
  }
  } // end renderAdd

  /* --- 减仓 / 退出计划（科学退出算法，剔除成本干扰）--- */
  function renderReduce(app) {
    const positions = STATE.positions || [];
    const total = portfolioTotal();
    app.appendChild(el(`<div class="card"><div class="alert blue"><span class="icon">${icon('info')}</span><div>
      卖出比买入更难,人性会被<strong>处置效应</strong>和<strong>沉没成本</strong>绑架。这套算法只看<strong>向前看的事实</strong>:逻辑是否破坏、是否跌破止损、是否超风险预算、"<strong>今天空仓还会不会买</strong>"——你的<strong>成本价不参与任何决策</strong>。它既防深套死扛,也防在低点恐慌割肉。</div></div></div>`));

    if (!positions.length) {
      app.appendChild(el(`<div class="card" style="margin-top:16px"><div class="empty"><div class="big">${icon('scissors')}</div><p>还没有股票持仓。先到「持仓」页录入。</p></div></div>`));
      return;
    }

    const card = el('<div class="card" style="margin-top:16px"><h3>该不该减 · 怎么减</h3></div>');
    card.appendChild(el(`
      <div class="field"><label>选择持仓</label>
        <select id="rd-pos">${positions.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.code?'（'+escapeHtml(p.code)+'）':''} · 占 ${fmtPct(num(p.weight),1)} · 浮${num(p.pnl)>=0?'盈':'亏'} ${fmtPct(num(p.pnl),1)}</option>`).join('')}</select></div>
      <div class="grid grid-3">
        <div class="field"><label>当前价</label><input id="rd-price" type="number" step="0.01" placeholder="现价"/></div>
        <div class="field"><label>计划止损价（可选）</label><input id="rd-stop" type="number" step="0.01" placeholder="跌破即减"/></div>
        <div class="field"><label>成本价（仅展示，不参与决策）</label><input id="rd-cost" type="number" step="0.01" readonly style="background:var(--surface-soft);color:var(--muted)"/></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>① 当初买入的核心逻辑,现在还成立吗?</label>
          <select id="rd-thesis"><option value="yes">仍成立(基本面/催化剂未变)</option><option value="unsure">不确定</option><option value="no">已破坏(基本面变差/逻辑证伪)</option></select></div>
        <div class="field"><label>② 假设你空仓、手里是现金,今天会按现价买它吗?</label>
          <select id="rd-buy"><option value="yes">会</option><option value="no">不会</option></select></div>
      </div>
      <button class="btn danger" id="rd-run">${icon('search')} 生成减仓/退出决策</button>
      <div id="rd-result"></div>
    `));
    app.appendChild(card);

    const fillFrom = (p) => {
      if (!p) return;
      if (num(p.price) > 0) card.querySelector('#rd-price').value = p.price;
      // 成本价：优先 position.cost，否则由现价与浮盈亏% 反推
      let cost = num(p.cost) > 0 ? num(p.cost) : null;
      if (cost == null && num(p.price) > 0 && num(p.pnl) !== 0) cost = num(p.price) / (1 + num(p.pnl) / 100);
      card.querySelector('#rd-cost').value = cost ? (+cost).toFixed(cost >= 100 ? 2 : 3) : '';
    };
    fillFrom(positions[0]);
    card.querySelector('#rd-pos').onchange = (e) => fillFrom(positions.find(x => x.id === e.target.value));

    card.querySelector('#rd-run').onclick = () => {
      const box = card.querySelector('#rd-result'); box.innerHTML = '';
      const p = positions.find(x => x.id === card.querySelector('#rd-pos').value);
      if (!p) return;
      const price = num(card.querySelector('#rd-price').value) || num(p.price);
      const stop = num(card.querySelector('#rd-stop').value);
      const thesis = card.querySelector('#rd-thesis').value;   // yes / unsure / no
      const buyToday = card.querySelector('#rd-buy').value;      // yes / no
      const w = num(p.weight);                                  // 占总资产 %
      const pnl = num(p.pnl);
      const md = num(p.maxDrop) || 40;
      const equityPct = positions.reduce((a, x) => a + num(x.weight), 0);
      const level = EQUITY_RISK_LEVELS[s.equityRiskLevel] || EQUITY_RISK_LEVELS['进取'];
      const sleeveW = equityPct > 0 ? w / equityPct * 100 : 0;   // 占弹性仓 %
      const posValue = total > 0 ? w / 100 * total : 0;

      // 客观触发
      const stopBroken = stop > 0 && price > 0 && price < stop;
      const overCap = sleeveW > level.single + 1e-9;             // 超弹性仓单股上限
      const deep = pnl <= -num(s.deepLossAdd, 20);

      // 决策
      let decision, targetW, reason, tone, mode;
      if (thesis === 'no' || stopBroken) {
        decision = '计划性退出'; targetW = 0; tone = 'red'; mode = 'exit';
        reason = stopBroken ? `已跌破你的计划止损价 ${stop}(现价 ${price})——纪律止损,不找理由拖延。` : '你判断买入逻辑已破坏。逻辑没了就没有持有理由,认赔=买回选择权,不是"亏钱"。';
      } else if (overCap) {
        decision = '减到合规'; targetW = w * (level.single / sleeveW); tone = 'amber'; mode = 'trim';
        reason = `逻辑仍成立,但它占弹性仓 ${fmtPct(sleeveW,0)} 超「${level.label}」档单股上限 ${level.single}%——只减超出部分,留下核心。`;
      } else if (buyToday === 'no') {
        decision = '减仓(处置效应警示)'; targetW = w * 0.6; tone = 'amber'; mode = 'trim';
        reason = '逻辑没超预算,但你"今天不会按现价买它"——说明你持有的理由已偏向"不甘心/等回本"(处置效应)。至少减到你真正舒服的仓位。';
      } else {
        decision = '持有'; targetW = w; tone = 'green'; mode = 'hold';
        if (deep) reason = `深套 ${fmtPct(pnl,1)},但你判断逻辑仍成立、今天还会买——这是波动而非逻辑破坏。<strong>别在情绪最低点割肉</strong>;若想补,走「加仓计划 / 铁律校验」按计划分批。`;
        else reason = '逻辑成立、未超预算、你今天还会买——继续持有,按纪律跟踪即可。';
      }
      if (thesis === 'unsure' && mode === 'hold') { tone = 'amber'; reason += ' 你对逻辑"不确定"——给自己一个复核期限,到期仍不确定,按"不会买就减"处理。'; }

      const reduceW = Math.max(0, w - targetW);
      const reduceValue = total > 0 ? reduceW / 100 * total : 0;
      const rdLot = lotSizeOf(p.code);
      const reduceShares = sharesFromCny(reduceValue, price, p.code);   // 美股先 ÷汇率 再 ÷美元单价

      box.appendChild(el(`<div class="alert ${tone}" style="margin-top:14px"><span class="icon">${tone==='red'?icon('danger'):tone==='amber'?icon('warn'):icon('check')}</span><div>
        <strong>结论:${decision}</strong><br>${reason}</div></div>`));

      box.appendChild(el(`<div class="result-box">
        <div class="metric-row"><span class="k">当前占比 / 目标占比</span><span class="v">${fmtPct(w,1)} → ${fmtPct(targetW,1)}</span></div>
        <div class="metric-row"><span class="k">建议减仓金额（约）</span><span class="v" style="color:var(--red-ink)">${mode==='hold'?'—':fmtMoney(reduceValue)}</span></div>
        <div class="metric-row"><span class="k">对应股数（${rdLot>1?'整手':'约'}）</span><span class="v">${mode==='hold'||!(reduceShares>0)?'—':reduceShares.toLocaleString()}</span></div>
        <div class="metric-row"><span class="k">成本价（沉没成本,不参与决策）</span><span class="v" style="color:var(--muted)">${card.querySelector('#rd-cost').value||'—'}</span></div>
      </div>`));

      if (mode === 'hold') return;

      if (isTPlus1(p.code)) box.appendChild(el(`<div class="alert amber" style="margin-top:10px"><span class="icon">${icon('warn')}</span><div>
        <strong>${MARKET_LABEL[marketOf(p.code)]}·T+1</strong>：当日买入的份额当天不可卖；若为逻辑破坏/破止损的紧急退出，一字跌停可能<strong>挂单也卖不出</strong>，可用<strong>隔夜委托(夜市)</strong>抢次日排队优先。减仓预估成本约 ${fmtMoney(tradeCost(p.code, reduceValue, 'sell'))}（含印花税）。</div></div>`));
      else if (marketOf(p.code) === 'US') box.appendChild(el(`<div class="alert blue" style="margin-top:10px"><span class="icon">${icon('info')}</span><div>美股可 T+0 卖出，但停牌/熔断时挂单不成交，按重开价成交。减仓预估成本约 ${fmtMoney(tradeCost(p.code, reduceValue, 'sell'))}。</div></div>`));

      // 分批减仓计划
      if (mode === 'exit') {
        // 逻辑破/破止损：分 3 批短窗口出，降低卖在最低点的择时风险，但不拖延
        const parts = [0.4, 0.3, 0.3];
        const rows = parts.map((f, i) => `<tr><td>第 ${i+1} 批（${i===0?'立即':'1–'+(i*2)+' 个交易日内'}）</td>
          <td class="num">${fmtMoney(reduceValue*f)}</td><td class="num">${price>0?sharesFromCny(reduceValue*f, price, p.code).toLocaleString():'—'}</td><td class="num">${fmtPct(f*100,0)}</td></tr>`).join('');
        box.appendChild(el(`<div class="table-scroll" style="margin-top:12px"><table>
          <thead><tr><th>批次</th><th class="num">减仓金额</th><th class="num">股数</th><th class="num">占比</th></tr></thead>
          <tbody>${rows}<tr class="total-row"><td>合计</td><td class="num">${fmtMoney(reduceValue)}</td><td></td><td class="num">100%</td></tr></tbody></table></div>`));
        box.appendChild(el(`<div class="alert blue" style="margin-top:10px"><span class="icon">${icon('info')}</span><div>退出用 3 批短窗口出,既不拖泥带水(逻辑已破),也避免一把砸在瞬时低点。别因"想等回本"停下。</div></div>`));
      } else {
        // 减到合规/减仓：逢反弹分批减（反金字塔，越涨卖越多），减少割在低点
        const n = 3;
        const levels = [0, 0.03, 0.06];                          // 现价、+3%、+6%
        const wts = [2, 3, 4]; const wsum = wts.reduce((a, b) => a + b, 0);
        const rows = levels.map((lv, i) => {
          const px = price * (1 + lv), amt = reduceValue * wts[i] / wsum;
          return `<tr><td>第 ${i+1} 批</td><td class="num">${px>0?px.toFixed(px>=100?2:3):'—'}</td><td class="num">${fmtMoney(amt)}</td><td class="num">${px>0?sharesFromCny(amt, px, p.code).toLocaleString():'—'}</td><td class="num">${fmtPct(wts[i]/wsum*100,0)}</td></tr>`;
        }).join('');
        box.appendChild(el(`<div class="table-scroll" style="margin-top:12px"><table>
          <thead><tr><th>批次</th><th class="num">价位</th><th class="num">减仓金额</th><th class="num">股数</th><th class="num">占比</th></tr></thead>
          <tbody>${rows}<tr class="total-row"><td>合计</td><td></td><td class="num">${fmtMoney(reduceValue)}</td><td></td><td class="num">100%</td></tr></tbody></table></div>`));
        box.appendChild(el(`<div class="alert blue" style="margin-top:10px"><span class="icon">${icon('ruler')}</span><div><strong>反金字塔减仓：逢反弹越涨卖越多</strong>(现价/+3%/+6%),把"减仓"尽量卖在相对高点,而不是恐慌市价砸出。逻辑没破的持仓不必一次清空。</div></div>`));
      }

      // —— 执行记账：一键把减仓写回数据（联动资产/股数自动减少，卖出所得按币种进对应现金池）——
      const execCcy = (p.code && isUsCode(p.code)) ? 'USD' : 'CNY';
      const poolNow = stockCashPoolBalance(execCcy);
      box.appendChild(el(`<div class="result-box" style="margin-top:14px">
        <div class="metric-row"><span class="k">执行记账 · 卖出所得自动归集</span>
          <span class="v">当前「${poolName(execCcy)}」余额 <strong>${fmtOrig(poolNow, execCcy)}</strong></span></div>
        <div class="row" style="gap:8px;margin-top:10px;align-items:center">
          <input id="rd-exec-amt" type="number" step="1000" value="${Math.max(0, Math.round(reduceValue))}" style="max-width:180px"/>
          <button class="btn" id="rd-exec" style="flex:0 0 auto">${icon('check')} 记账：卖出 → ${poolName(execCcy)}</button>
        </div>
        <p class="inline-note" style="margin-top:8px">金额可改（默认=上方建议减仓金额，人民币计）。记账后：「投资组合」中该标的金额与股数自动减少，所得计入 <strong>${poolName(execCcy)}</strong>（投资组合 → 现金分类，${execCcy === 'USD' ? '按汇率折算为美元入账' : '人民币入账'}），总资产守恒（股票↓＝现金↑）。</p>
      </div>`));
      box.querySelector('#rd-exec').onclick = () => {
        const amt = num(box.querySelector('#rd-exec-amt').value);
        if (!(amt > 0)) { alert('请输入有效的卖出金额'); return; }
        const posV = total > 0 ? w / 100 * total : 0;
        if (posV > 0 && amt > posV * 1.02 && !confirm('卖出金额超过该持仓当前市值，确定继续？（超出部分也会计入现金池）')) return;
        const hasAsset = p.code && (STATE.assets || []).some(x => x.code === p.code);
        if (!hasAsset && !confirm(`「${p.name}」未在「投资组合」登记对应资产，卖出回款 ${fmtMoney(amt)} 计入现金池后，总资产会相应增加（因为该股票市值此前未入账）。\n建议先到「投资组合」补录该资产再记账，账才能守恒。仍要继续吗？`)) return;
        if (!confirm(`确认记账：卖出「${p.name}」${fmtMoney(amt)}？\n资产/股数自动减少，所得进入股票现金池。`)) return;
        logOp('减仓记账：' + p.name);
        const r = applySellToPool(p.id, amt);
        recordDailySnapshot();            // 资产结构变了 → 覆盖今日快照
        alert(`已记账：${fmtMoney(amt)} 计入「${poolName(r.ccy)}」（当前余额 ${fmtOrig(r.pool, r.ccy)}）。`
          + (r.unbooked ? '\n注意：该标的未在「投资组合」登记资产，卖出款入池会使总资产增加（市值此前未入账），建议补录该资产。' : ''));
        render();
      };
    };
  } // end renderReduce
};

/* =========================================================================
   视图：复盘校准 —— 记录每次判断的胜率/空间，事后回填结果，
   用 Brier 分数 + 校准曲线校准你（与 AI）的判断力。这是「长出投资大脑」的核心闭环。
   ========================================================================= */
/* =========================================================================
   视图：个股决策卡 —— 买入前写下「为什么买 / 什么情况证明我错了」
   ========================================================================= */
const SCORE_ANCHORS = {
  tech: ['技术面', '8-10 多头排列+站上均线+量价配合｜5-7 均线纠缠/指标中性｜0-4 空头排列+破位+量价背离'],
  fund: ['基本面', '8-10 ROE(年化)>15%+增速>20%+低负债｜5-7 ROE 8-15%+增速个位数｜0-4 ROE<8%+负增长+高负债。注：估值只用绝对 PE/PB（无历史分位/行业对比的数据源），故权重仅 1/10'],
  news: ['消息面', '8-10 重大利好催化+政策支持+无负面｜5-7 消息平淡无重大事件｜0-4 重大利空/政策打压/负面舆情'],
  senti: ['资金面', '8-10 主力持续净流入+机构上调评级｜5-7 资金流向不明+评级稳定｜0-4 主力持续流出+机构下调'],
  rs: ['行业/相对强弱', '相对基准(A股比沪深300/美股比标普500)的超额收益：8-10 60日与120日均大幅领先且仍在走强｜5-7 与大盘同步｜0-4 持续跑输且相对走弱。注：这是市场对赛道的定价，不等于行业基本面景气度'],
};
VIEWS.thesis = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>决策卡 · 为什么买 / 何时认错</h2>
      <p>买入前把 <strong>看多逻辑</strong>、<strong>最强反方论证</strong>、<strong>证伪条件</strong> 写下来——这是整个工具里唯一能防止「事后编理由」的东西。证伪条件勾中会自动把该标的提到<strong>再平衡卖出队首</strong>；逻辑窗口到期触发<strong>时间止损</strong>；触及目标价/止损价可一键记入<strong>复盘校准</strong>，回填后校准你的真实胜率。</p>
    </div>
  `));

  const fx = currentFx();
  const total = portfolioTotal();
  const theses = STATE.theses = STATE.theses || {};
  // 候选标的 = 持仓里的股票类资产 ＋ 只在观察名单里（尚未买入）的决策卡标的。
  // 观察标的没有对应资产，用「类资产对象」参与后续所有计算（分层、状态、相对强弱…），
  // 现价取上次拉 K 线时缓存的 watchPx，不污染 STATE.assets（不会计入总资产/再平衡）。
  const heldCands = (STATE.assets || []).filter(a => a.category === 'A股股票' || a.category === '美股股票' || (a.category === '基金' && /主题|行业|科技|医药|军工|消费|芯片|新能源/.test(a.name || '')));
  const watchOnly = Object.keys(theses)
    .filter(k => theses[k].watch && !heldCands.some(a => thesisKeyOf(a) === k))
    .map(k => {
      const t = theses[k];
      return { id: 'watch:' + k, name: t.name || k, code: t.code || '', watch: true,
        category: isUsCode(t.code || '') ? '美股股票' : 'A股股票',
        currency: isUsCode(t.code || '') ? 'USD' : 'CNY',
        lastPx: num(t.watchPx) > 0 ? num(t.watchPx) : 0 };
    });
  const cands = heldCands.concat(watchOnly);
  const isWatchKey = (k) => !!(theses[k] && theses[k].watch) && !heldCands.some(a => thesisKeyOf(a) === k);

  // —— 待办：需要你处理的卡片（证伪触发 / 到期 / 触价）——
  const alerts = [];
  cands.forEach(a => {
    const px = num(a.lastPx);
    const st = thesisStatus(a, px);
    if (!st.has) return;
    const watch = !!a.watch;
    // 证伪与到期对「观察中」同样成立——买之前逻辑就被证伪，是最省钱的一种发现
    if (st.broken) alerts.push(['red', a, '证伪条件已触发',
      watch ? '还没买就已经触发了你写下的证伪条件——这张卡的价值已经兑现了：省下一次错误的买入。'
            : '你当初写下的"什么情况证明我错了"已经发生——按纪律这应该是卖出队首，不是重新找理由。']);
    else if (st.expired) alerts.push(['amber', a, '逻辑窗口已过期',
      watch ? `观察窗口（${st.t.date} + ${num(st.t.months)} 个月，至 ${thesisDueDate(st.t)}）已过仍未进场——要么现在给出新的进场理由，要么把它从观察名单里删掉。`
            : `建卡 ${st.t.date} + ${num(st.t.months)} 个月的兑现窗口已过（${thesisDueDate(st.t)}），逻辑未兑现＝资金在付机会成本，考虑时间止损。`]);
    if (watch) {
      // 观察标的没有持仓，目标价/止损价无意义；真正该提醒的是「跌到你计划的买入位了」
      if (num(st.t.entry) > 0 && px > 0 && px <= num(st.t.entry)) {
        alerts.push(['green', a, '已到计划买入价',
          `现价 ${px} ≤ 计划买入价 ${num(st.t.entry)}。进场前最后过一遍：证伪条件还成立吗？三道闸算出的可买金额是多少？`]);
      }
      return;
    }
    if (st.target) alerts.push(['green', a, '已触及目标价', `现价 ${px} ≥ 目标价 ${num(st.t.target)}——记一笔「兑现」到复盘校准，并决定是止盈还是上调目标（上调需要新证据）。`]);
    if (st.stop) alerts.push(['red', a, '已触及止损价', `现价 ${px} ≤ 止损价 ${num(st.t.stop)}——止损是买入时就定好的，执行它。`]);
  });
  if (alerts.length) {
    const aCard = el(`<div class="card"><h3>${icon('warn')} 需要处理（${alerts.length}）</h3></div>`);
    alerts.forEach(([t, a, title, msg]) => {
      const row = el(`<div class="alert ${t}"><span class="icon">${t === 'red' ? icon('danger') : t === 'green' ? icon('check') : icon('warn')}</span>
        <div><strong>${escapeHtml(a.name)} · ${title}</strong><br>${escapeHtml(msg)}
        <div class="row" style="gap:6px;margin-top:6px"><button class="btn secondary small" data-rec="${escapeHtml(thesisKeyOf(a))}" style="flex:0 0 auto">${icon('clipboard')} 记入复盘校准</button></div></div></div>`);
      aCard.appendChild(row);
    });
    aCard.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => {
      const k = b.dataset.rec, t = theses[k];
      if (!t) return;
      const a = cands.find(x => thesisKeyOf(x) === k);
      const px = num(a && a.lastPx), entry = num(t.entry);
      const realized = entry > 0 && px > 0 ? (px - entry) / entry * 100 : null;
      // 预测胜率取信心水平的中值映射；上下空间取目标/止损相对入场的幅度
      const pMap = { '高': 70, '中': 55, '低': 45 };
      STATE.forecasts = STATE.forecasts || [];
      STATE.forecasts.push({
        id: uid(), date: todayStr(), name: t.name || k, code: t.code || '',
        p: pMap[t.conf] || 55,
        up: entry > 0 && num(t.target) > 0 ? +((num(t.target) - entry) / entry * 100).toFixed(1) : 0,
        down: entry > 0 && num(t.stop) > 0 ? +((entry - num(t.stop)) / entry * 100).toFixed(1) : 0,
        ev: 0, f: 0, source: '决策卡',
        outcome: '', realizedPct: realized != null ? +realized.toFixed(1) : null,
      });
      logOp('决策卡记入复盘校准：' + (t.name || k));
      saveState();
      alert('已记入「复盘校准」。到那一页把结果标为「兑现/落空」，样本攒够就能看到你的真实胜率 vs 自以为的胜率。');
      render();
    });
    app.appendChild(aCard);
  }

  // —— 新建 / 编辑决策卡 ——
  const formCard = el(`<div class="card" style="margin-top:16px">
    <h3>${icon('clipboard')} 新建 / 编辑决策卡</h3>
    <p class="hint">空头论证是<strong>必填</strong>——写不出反方理由，说明你还没想清楚就要下注。证伪条件请写<strong>可观测的客观事件</strong>（如"Q3 毛利率跌破 30%""金价跌破 3000 且持续一个月"），而不是"跌了很多"。</p>
    <div class="grid grid-2">
      <div class="field"><label>标的</label><select id="th-pick">
        <option value="">— 选择持仓 / 观察标的 —</option>
        ${cands.map(a => `<option value="${escapeHtml(thesisKeyOf(a))}">${a.watch ? '👁 ' : ''}${escapeHtml(a.name)}${a.code ? '（' + escapeHtml(a.code) + '）' : ''}${a.watch ? '·观察' : ''}${theses[thesisKeyOf(a)] ? ' ✓已有卡' : ''}</option>`).join('')}
      </select>
      <div class="row" style="gap:6px;margin-top:6px">
        <input id="th-watch-code" placeholder="加观察标的：A股代码如 601899 / 美股如 NVDA" style="flex:1"/>
        <button class="btn secondary small" id="th-watch-add" style="flex:0 0 auto">${icon('plus')} 校验并加入</button>
      </div>
      <p class="inline-note" id="th-watch-note">还没买入、只在观察的股票也能建卡——这正是决策卡的用法：<strong>先写下逻辑与证伪条件，再决定买不买</strong>。观察标的不计入总资产与再平衡。</p></div>
      <div class="field"><label>信心水平</label><select id="th-conf"><option>中</option><option>高</option><option>低</option></select></div>
    </div>
    <div class="field"><label>看多逻辑（一句话说清你为什么买）<span class="req">*</span></label><input id="th-bull" placeholder="如：金铜双引擎+锂2026放量，矿业股利润对金价有杠杆"/></div>
    <div class="field"><label>最强反方论证（必填，你自己写或用下方 AI 生成后修改）<span class="req">*</span></label><input id="th-bear" placeholder="如：利润高度依赖金铜锂价格，商品同步下跌时营收利润显著缩水"/></div>
    <div class="field"><label>证伪条件（每行一条，2–3 条；发生任一条即认错）<span class="req">*</span></label>
      <textarea id="th-fals" rows="3" placeholder="金价跌破 3000 美元且持续 1 个月&#10;巨龙铜矿二期投产进度延后 2 个季度以上&#10;单季扣非净利同比转负"></textarea></div>
    <div class="grid grid-3">
      <div class="field"><label>入场价（你的成本价）</label><input id="th-entry" type="number" step="0.01"/>
        <p class="inline-note" id="th-entry-note"></p></div>
      <div class="field"><label>目标价</label><input id="th-target" type="number" step="0.01"/></div>
      <div class="field"><label>止损价</label><input id="th-stop" type="number" step="0.01"/></div>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>逻辑兑现窗口（月）</label><input id="th-months" type="number" step="1" value="12"/></div>
      <div class="field"><label>建卡日期</label><input id="th-date" type="date" value="${todayStr()}"/></div>
      <div class="field"></div>
    </div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin:4px 0 8px">
      <button class="btn secondary small" id="th-tech" style="flex:0 0 auto">${icon('calc')} 自动评四维（真实数据）</button>
      <span class="inline-note" style="align-self:center">技术/基本/资金面按真实数据机械打分；消息面拉真实公告后由 AI 只做分类——见下方说明</span>
    </div>
    <div id="th-tech-out"></div>
    <div class="grid grid-2" id="th-scores"></div>
    <div id="th-gates"></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn" id="th-save" style="flex:0 0 auto">${icon('check')} 保存决策卡</button>
      <button class="btn secondary" id="th-ai" style="flex:0 0 auto">${icon('sparkles')} AI 帮我写反方论证</button>
      <button class="btn danger" id="th-del" style="flex:0 0 auto;display:none">${icon('trash')} 删除此卡</button>
    </div>
    <div id="th-ai-out"></div>
  </div>`);
  app.appendChild(formCard);

  // 四维评分（只记录，不做加权裁决——加权打分是假精确）
  const scoreBox = formCard.querySelector('#th-scores');
  const SCORE_HOW = { tech: '自动算', fund: '自动算', news: '拉真实公告后 AI 分类', senti: '自动算', rs: '自动算' };
  scoreBox.innerHTML = Object.keys(SCORE_ANCHORS).map(k => {
    const [label, anchor] = SCORE_ANCHORS[k];
    return `<div class="field"><label>${label}评分 0–10 <span class="inline-note" title="${escapeHtml(anchor)}">（锚点↗悬停 · ${SCORE_HOW[k]}）</span></label>
      <input data-sc="${k}" type="number" min="0" max="10" step="0.1" placeholder="未评"/></div>`;
  }).join('');
  formCard.querySelector('#th-gates').insertAdjacentHTML('beforebegin',
    `<details style="margin:6px 0"><summary style="cursor:pointer;font-size:12px;color:var(--muted);list-style:revert">为什么不用 AI 自动打这四个分？— 点击展开</summary>
      <div style="font-size:12.5px;line-height:1.6;margin-top:6px">
      <p style="margin:0 0 6px">分界不在「公式 vs AI」，而在<strong>有没有可核对的真实数据作输入</strong>。AI 对<strong>检索到的真实数据</strong>做判断是可靠的；AI 凭<strong>记忆回忆</strong>数据才是幻觉的来源。四维都走前者：</p>
      <p style="margin:0 0 6px"><strong>技术面 → 纯公式。</strong>均线排列/MACD/RSI/动量都有确定算法，连模型都不需要。同样的行情永远得同样的分，每一分都列出出处可逐项核对。</p>
      <p style="margin:0 0 6px"><strong>基本面 → 真实数据 + 机械打分。</strong>ROE、毛利率、负债率、营收/净利同比、PE/PB 全部取自东财行情接口的真实字段，再按方法论的锚点表打分——<strong>锚点表本身就是规则，不需要模型</strong>。缺项不摊分（按实际取到的项归一），取不到就留空不猜。局限：<strong>估值只有绝对 PE/PB，没有历史分位</strong>（需长序列财报库），故权重最低。</p>
      <p style="margin:0 0 6px"><strong>资金面 → 真实数据 + 机械打分。</strong>个股主力净额与净占比来自行情接口；所属板块资金流来自「市场指标 → 资金流向」已拉的真实数据。个股龙虎榜/北向持股暂无可靠免key源，未纳入。</p>
      <p style="margin:0 0 6px"><strong>消息面 → 检索真实公告 + AI 只做分类。</strong>先从东财拉近期<strong>真实公告标题与日期</strong>（原文可展开自行核对），再让 AI <strong>仅对这些已检索到的标题</strong>判定利好/利空与影响程度；<strong>加总成分数的规则是固定公式</strong>，所以同一批公告永远得同一分。AI 拿不到标题以外的任何信息，无法虚构事件。</p>
      <p style="margin:6px 0 0;color:var(--muted)">与那套 12-agent 方法论的差别不在"智能程度"，而在职责划分：<strong>能算的用公式（比 agent 稳定），能查的先查再判（agent 只做它擅长的分类），查不到的留空</strong>。多派几个 agent 不会凭空产生数据——没有数据的 agent 不产生信息，只产生自信。此外这四个分<strong>只做记录、不参与任何自动裁决</strong>（驱动卖出排序的是证伪条件、凯利稳健性、时间窗口、实测相关性），所以空几项也不影响决策卡的核心功能。</p>
      </div></details>`);

  const $f = sel => formCard.querySelector(sel);
  // 「自动评四维」拉到的真实数据暂存于此，供 AI 起草时作为唯一事实来源（不给它别的信息）
  let lastData = { tech: null, fund: null, ann: null, rs: null, code: '', name: '' };
  // 三道闸预览：入场/止损变动时实时算
  // 第三道闸：该标的所属层级在当前再平衡预设下还剩多少空间（超配则为 0，不该再加）
  function layerRoomOf(a) {
    if (!a) return null;
    try {
      const st = currentLayerState();
      const preset = getRebalPreset((STATE.settings || {}).rebalPreset || '3y15');
      const L = layerOf(a);
      const tgt = preset.t[L];
      if (tgt == null || !(st.total > 0)) return null;
      return { room: Math.max(0, (tgt - (st.pct[L] || 0)) / 100 * st.total), layer: LAYER_NAME[L] || L, tgt, cur: st.pct[L] || 0, preset: preset.label };
    } catch (e) { return null; }
  }
  function drawGates() {
    const entry = num($f('#th-entry').value), stop = num($f('#th-stop').value);
    const a0 = cands.find(x => thesisKeyOf(x) === $f('#th-pick').value);
    const lr = layerRoomOf(a0);
    const g = sizingGates(entry, stop, total, lr ? lr.room : null);
    const box = $f('#th-gates');
    if (!(g.byRisk > 0)) {
      box.innerHTML = `<p class="inline-note">${!(total > 0) ? '总资产为 0，无法反推仓位（先到「投资组合」录入资产）。'
        : '填入<strong>入场价</strong>与<strong>止损价</strong>（止损&lt;入场）即可算出「这笔最多能买多少」——点上方「自动算技术面评分」会顺带给出技术止损参考位。'}</p>`;
      return;
    }
    const bindName = { risk: '风险预算', layer: '分层剩余', cap: '单标的上限' }[g.binding] || '';
    box.innerHTML = `<div class="alert blue" style="margin-top:6px"><span class="icon">${icon('calc')}</span><div>
      <strong>加仓三道闸</strong>：止损幅度 ${g.stopPct.toFixed(1)}%，按单笔风险 ${g.riskPct}% 反推
      → ① 风险预算上限 <strong>${fmtMoney(g.byRisk)}</strong>（占总资产 ${(g.byRisk / total * 100).toFixed(1)}%）；
      ② 单标的集中度上限 ${g.cap}% = ${fmtMoney(g.byCap)}；
      ③ ${lr ? `分层剩余（${escapeHtml(lr.layer)} 目标 ${lr.tgt}% / 当前 ${lr.cur.toFixed(1)}%，按「${escapeHtml(lr.preset)}」）= <strong>${fmtMoney(lr.room)}</strong>${lr.room <= 0 ? '（该层已超配，按纪律不该再加）' : ''}` : '分层剩余（取不到分层数据，本次未参与取小）'}。
      <br><strong>三者取小：${fmtMoney(g.final)}</strong>（受「${bindName}」约束）。
      <br><span style="color:var(--amber-ink)">注意：A股跌停/美股跳空时止损不在设定价成交，"最多亏 ${g.riskPct}%" 不是保证——这是上限不是承诺。</span></div></div>`;
  }
  ['#th-entry', '#th-stop'].forEach(s => { $f(s).oninput = drawGates; });
  drawGates();

  // 自动技术面评分：拉真实K线 → 确定性公式 → 列出每一分的出处，并给技术止损参考位
  $f('#th-tech').onclick = async () => {
    const k = $f('#th-pick').value;
    if (!k) { alert('请先选择标的'); return; }
    const a = cands.find(x => thesisKeyOf(x) === k);
    const code = (a && a.code) || '';
    const out = $f('#th-tech-out'), btn = $f('#th-tech');
    if (!code) { out.innerHTML = '<p class="inline-note">该标的无代码，无法取K线。</p>'; return; }
    btn.disabled = true; const ob = btn.innerHTML; btn.innerHTML = icon('refresh', 'spin') + ' 计算中…';
    out.innerHTML = '<div class="inline-note">正在拉取日K并计算…</div>';
    let diagsRs = '';
    try {
      const rows = await fetchTechKlines(code);
      const t = techScore(rows);
      // 技术面不可算不能中断后三维：抛出交给 catch，流程继续
      if (!t.ok) throw new Error(t.err);
      lastData.tech = t; lastData.code = code; lastData.name = (a && a.name) || '';
      // 观察标的没有资产可刷价：把刚拉到的最新收盘缓存进卡，卡片与状态判定才有现价可用
      if (a && a.watch && theses[k] && num(t.px) > 0) {
        theses[k].watchPx = t.px; theses[k].watchPxDate = t.date || todayStr(); saveState();
      }
      const sc = scoreBox.querySelector('[data-sc="tech"]');
      if (sc) sc.value = t.score;
      // 入场价空着 → 优先补【成本价】；实在没有成本数据才用最新收盘价占位并明确标注
      let entryNote = '';
      if (!(num($f('#th-entry').value) > 0)) {
        const cp = costPriceOf(a);
        if (cp.price != null) { $f('#th-entry').value = cp.price; entryNote = `（入场价空着，已带出成本价 ${cp.price}，${cp.src}）`; }
        else { $f('#th-entry').value = t.px; entryNote = `（无成本数据，暂用最新收盘价 ${t.px} 占位——<strong>请改成你的实际买入价</strong>，否则浮动盈亏与止损幅度都不对）`; }
      }
      const rows2 = t.parts.map(p => `<tr><td>${escapeHtml(p.k)}</td><td>${escapeHtml(p.v)}</td><td class="num">${p.p} / ${p.max}</td></tr>`).join('');
      out.innerHTML = `<div class="alert blue" style="margin:8px 0"><span class="icon">${icon('calc')}</span><div>
        <strong>技术面评分 ${t.score} / 10</strong>（${escapeHtml(t.date)} 收盘，${t.bars} 根日K，现价 ${t.px}）——已填入下方。${entryNote}每一分的出处：
        <div class="table-scroll" style="margin-top:6px"><table><thead><tr><th>项</th><th>读数</th><th class="num">得分</th></tr></thead><tbody>${rows2}</tbody></table></div>
        <div class="inline-note" style="margin-top:6px">均线：${[5, 10, 20, 60, 120].filter(p => t.ma[p] != null).map(p => 'MA' + p + ' ' + t.ma[p].toFixed(2)).join(' · ')}
        ${t.volNote ? '<br>量能：' + escapeHtml(t.volNote) : ''}
        <br>近60日区间：低 ${t.low60.toFixed(2)} / 高 ${t.high60.toFixed(2)}</div>
        <div class="row" style="gap:6px;margin-top:8px"><button class="btn secondary small" id="th-usestop" style="flex:0 0 auto">用技术支撑填止损价（${t.stopHint}）</button></div>
        <span class="inline-note">口径固定：同样的行情永远得同样的分，可复现、可核对——这是公式不是模型判断。技术面只说明「现在的位置」，不预测涨跌。</span></div></div>`;
      const us = out.querySelector('#th-usestop');
      if (us) us.onclick = () => { $f('#th-stop').value = t.stopHint; drawGates(); };
      // —— 行业/相对强弱：个股 vs 基准的超额收益（纯 K 线，不依赖任何被封接口）——
      try {
        const bm = await fetchRsBenchmark(isUsCode(code));
        const rs = rsScore(rows, bm.series, bm.name);
        lastData.rs = rs.ok ? rs : null;
        if (rs.ok) {
          const scR = scoreBox.querySelector('[data-sc="rs"]'); if (scR) scR.value = rs.score;
          out.insertAdjacentHTML('beforeend', `<div class="alert blue" style="margin:8px 0"><span class="icon">${icon('trend')}</span><div>
            <strong>行业/相对强弱 ${rs.score} / 10</strong>（对比 ${escapeHtml(rs.benchName)}，共同交易日 ${rs.days} 天）——已填入下方。
            <div class="table-scroll" style="margin-top:6px"><table><thead><tr><th>项</th><th>读数</th><th class="num">得分</th></tr></thead><tbody>
            ${rs.parts.map(p => `<tr><td>${escapeHtml(p.k)}</td><td>${escapeHtml(p.v)}</td><td class="num">${p.p} / ${p.max}</td></tr>`).join('')}</tbody></table></div>
            <span class="inline-note">这一维回答「它在赛道里跑得怎么样」：板块景气最终体现为<strong>相对大盘的持续超额</strong>。
            但它是<strong>市场对赛道的定价，不等于行业基本面景气度</strong>——产能/需求/政策周期仍需你在看多逻辑里自己论证。</span></div></div>`);
        } else {
          out.insertAdjacentHTML('beforeend', `<div class="alert amber" style="margin:8px 0"><span class="icon">${icon('warn')}</span><div>相对强弱未算出：${escapeHtml(rs.err)}</div></div>`);
        }
      } catch (e2) { diagsRs = '相对强弱基准拉取失败：' + e2.message; }
    } catch (e) {
      out.innerHTML = `<div class="alert amber" style="margin:8px 0"><span class="icon">${icon('warn')}</span><div>技术面未算出：${escapeHtml(e.message)}——其余三维继续。</div></div>`;
    }
    // —— 基本面 / 资金面：真实数据 → 机械打分（锚点表本身就是规则，不需要模型）——
    const sec = document.createElement('div');
    out.appendChild(sec);
    const diags = [];
    if (diagsRs) diags.push(['相对强弱', diagsRs]);
    const tbl = (parts) => `<div class="table-scroll" style="margin-top:6px"><table><thead><tr><th>项</th><th>读数</th><th class="num">得分</th></tr></thead><tbody>${
      parts.map(p => `<tr><td>${escapeHtml(p.k)}</td><td${p.p == null ? ' style="color:var(--muted)"' : ''}>${escapeHtml(p.v)}</td><td class="num">${p.p == null ? '—' : p.p + ' / ' + p.max}</td></tr>`).join('')}</tbody></table></div>`;
    try {
      const fdRaw = await fetchFundamentals(code);
      diags.push(...(fdRaw.diag || []).map(x => ['基本面', x]));
      if (fdRaw.ok) lastData.fund = fdRaw;
      const fs = fundScore(fdRaw);
      if (fs.ok) {
        const sc2 = scoreBox.querySelector('[data-sc="fund"]'); if (sc2) sc2.value = fs.score;
        sec.insertAdjacentHTML('beforeend', `<div class="alert blue" style="margin:8px 0"><span class="icon">${icon('calc')}</span><div>
          <strong>基本面评分 ${fs.score} / 10</strong>（按锚点表机械打分，数据覆盖 ${fs.coverage}%${fs.src ? '，源：' + escapeHtml(fs.src) : ''}${fs.reportDate ? '，报告期 ' + escapeHtml(fs.reportDate) : ''}）——已填入下方。${tbl(fs.parts)}
          <span class="inline-note">缺数据的项不摊分：按实际取到的项归一，避免"取不到 = 低分"的系统性偏差。<strong>估值只用绝对 PE/PB 粗判</strong>——历史分位需要长序列财报库，本工具没有，这一项权重最低(1分)，别当结论。</span></div></div>`);
      } else {
        sec.insertAdjacentHTML('beforeend', `<div class="alert amber" style="margin:8px 0"><span class="icon">${icon('warn')}</span><div>基本面数据未取到（该标的可能非A股或接口字段不同），已留空不猜。展开下方诊断可看原始返回。</div></div>`);
      }
    } catch (e) { diags.push(['基本面', '异常:' + e.message]); }
    try {
      const sf = await fetchStockFlow(code);
      diags.push(...(sf.diag || []).map(x => ['资金面', x]));
      // 所属板块资金流：用已拉过的「市场指标→资金流向」数据，按因子关键词匹配
      let sectorHit = null;
      const secs = (STATE.macro && STATE.macro.flow && STATE.macro.flow.sectors) || [];
      const p0 = (STATE.positions || []).find(p => p.code === code);
      if (p0 && secs.length) {
        const hints = FACTOR_SECTOR_HINTS[p0.factor] || [];
        sectorHit = secs.find(x => hints.some(h => x.name.indexOf(h) >= 0)) || null;
      }
      const zs = flowScore(sf, sectorHit);
      if (zs.ok) {
        const sc3 = scoreBox.querySelector('[data-sc="senti"]'); if (sc3) sc3.value = zs.score;
        sec.insertAdjacentHTML('beforeend', `<div class="alert blue" style="margin:8px 0"><span class="icon">${icon('coins')}</span><div>
          <strong>资金面评分 ${zs.score} / 10</strong>——已填入下方。${tbl(zs.parts)}
          <span class="inline-note">${sectorHit ? '' : '未计入板块资金流：先到「市场指标 → 资金流向」拉一次，并确保该标的在「持仓」里设了因子。'}个股龙虎榜/北向持股暂无可靠免key源，未纳入。</span></div></div>`);
      } else {
        sec.insertAdjacentHTML('beforeend', `<div class="alert amber" style="margin:8px 0"><span class="icon">${icon('warn')}</span><div>资金面数据未取到，已留空不猜（诊断见下）。</div></div>`);
      }
    } catch (e) { diags.push(['资金面', '异常:' + e.message]); }
    // —— 消息面：拉真实公告 → AI 只对已检索到的标题做分类 ——
    try {
      const ann = await fetchAnnouncements(code, 25);
      diags.push(...(ann.diag || []).map(x => ['消息面', x]));
      if (ann.ok) lastData.ann = ann.list;
      if (!ann.ok) {
        sec.insertAdjacentHTML('beforeend', `<div class="alert amber" style="margin:8px 0"><span class="icon">${icon('warn')}</span><div>未取到公告列表，消息面留空（诊断见下）。<strong>不会让模型凭记忆编事件。</strong></div></div>`);
      } else {
        const box = el(`<div class="alert blue" style="margin:8px 0"><span class="icon">${icon('book')}</span><div id="th-news-in">
          已取到 <strong>${ann.list.length}</strong> 条真实公告（最新 ${escapeHtml(ann.list[0].date)}）。点下方按钮让 AI <strong>只对这些已检索到的标题</strong>做利好/利空分类并汇总成分数——它拿不到标题以外的任何信息，无法虚构事件。
          <div class="row" style="gap:6px;margin-top:8px"><button class="btn secondary small" id="th-news-go" style="flex:0 0 auto">${icon('sparkles')} 对这 ${ann.list.length} 条公告分类</button></div>
          <details style="margin-top:6px"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">查看原文标题（可自行核对）</summary>
            <div style="font-size:12px;line-height:1.7;margin-top:4px">${ann.list.map(x => '· ' + escapeHtml(x.date) + ' ' + escapeHtml(x.title)).join('<br>')}</div></details>
        </div></div>`);
        sec.appendChild(box);
        box.querySelector('#th-news-go').onclick = async (ev) => {
          const nb = ev.target.closest('button'); nb.disabled = true; const nob = nb.innerHTML;
          nb.innerHTML = icon('refresh', 'spin') + ' 分类中…';
          try {
            const sys = '你是公告分类器。用户给你一批【已检索到的真实公告标题】，只需逐条判断其对股价的性质与影响程度。'
              + '硬性要求：(1) 只能依据给出的标题判断，禁止补充任何标题之外的信息或事件；(2) 不预测涨跌、不给买卖评级、不给目标价；'
              + '(3) <重要>只返回明确利好(good)或利空(bad)的条目，中性/例行公告一律【不要输出】（未列出即视为中性），这样输出更短；'
              + '(4) 只输出 JSON 本身，不要任何解释文字或代码围栏。'
              + '严格返回：{"items":[{"i":序号,"s":"good|bad","w":1到3的影响程度}],"summary":"一句话概括这批公告的性质"}';
            const user = ann.list.map((x, i) => `${i}. [${x.date}] ${x.title}`).join('\n');
            // 给足起始预算（旧的 900 会被推理过程吃光或把数组截断，正是"要试很多次"的原因）；
            // aiChatJSON 内部还会在不足时自动加倍重试
            const r = await aiChatJSON(sys, user, { temperature: 0.1, seed: 11, maxTokens: 2000 });
            const items = Array.isArray(r.items) ? r.items : [];
            let g = 0, bd = 0;
            items.forEach(it => { const w = Math.max(1, Math.min(3, num(it.w, 1))); if (it.s === 'good') g += w; else if (it.s === 'bad') bd += w; });
            // 机械汇总：净分 → 0-10（分类是AI的，加总规则是固定的）
            const net = g - bd, tot = g + bd;
            const score = tot === 0 ? 5 : Math.max(0, Math.min(10, Math.round((5 + net / Math.max(tot, 3) * 5) * 10) / 10));
            const sc4 = scoreBox.querySelector('[data-sc="news"]'); if (sc4) sc4.value = score;
            const good = items.filter(x => x.s === 'good').map(x => ann.list[x.i]).filter(Boolean);
            const bad = items.filter(x => x.s === 'bad').map(x => ann.list[x.i]).filter(Boolean);
            box.querySelector('#th-news-in').innerHTML = `<strong>消息面评分 ${score} / 10</strong>（利好权重 ${g} / 利空权重 ${bd}，基于 ${ann.list.length} 条真实公告）——已填入下方。
              <br>${escapeHtml(String(r.summary || ''))}
              ${good.length ? '<br><strong style="color:var(--green-ink)">利好</strong>：<br>· ' + good.slice(0, 6).map(x => escapeHtml(x.date + ' ' + x.title)).join('<br>· ') : ''}
              ${bad.length ? '<br><strong style="color:var(--red-ink)">利空</strong>：<br>· ' + bad.slice(0, 6).map(x => escapeHtml(x.date + ' ' + x.title)).join('<br>· ') : ''}
              <br><span class="inline-note">分类由 AI 做、<strong>加总规则是固定公式</strong>（净权重归一到0-10），所以同一批公告永远得同一分。AI 只看到上面这些标题，没有其它信息来源。</span>`;
          } catch (e2) {
            box.querySelector('#th-news-in').insertAdjacentHTML('beforeend', `<br><span style="color:var(--red-ink)">分类失败：${escapeHtml(e2.message)}</span>`);
          } finally { nb.disabled = false; nb.innerHTML = nob; }
        };
      }
    } catch (e) { diags.push(['消息面', '异常:' + e.message]); }
    if (diags.length) {
      sec.insertAdjacentHTML('beforeend', `<details style="margin:6px 0"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">数据源诊断（${diags.length} 条原始返回）— 点击展开</summary>
        <div class="table-scroll"><table class="stack-mobile"><thead><tr><th>维度</th><th>原始返回</th></tr></thead><tbody>
        ${diags.map(([k, v]) => `<tr><td style="white-space:nowrap">${escapeHtml(k)}</td><td style="font-size:11px;font-family:monospace;word-break:break-all">${escapeHtml(v)}</td></tr>`).join('')}
        </tbody></table></div></details>`);
    }
    btn.disabled = false; btn.innerHTML = ob;
  };

  // 选标的 → 回填已有卡
  function loadThesis(k) {
    const t = theses[k];
    $f('#th-del').style.display = t ? '' : 'none';
    const a = cands.find(x => thesisKeyOf(x) === k);
    if (!t) {
      $f('#th-tech-out').innerHTML = '';
    ['#th-bull', '#th-bear', '#th-fals', '#th-target', '#th-stop'].forEach(s => { $f(s).value = ''; });
      // 已持仓 → 入场价取【成本价】（现价会让浮动盈亏恒为 0、止损幅度也算错）；
      // 观察标的（未买入）→ 没有成本，入场价即【计划买入价】，用现价起步再手改
      const en = $f('#th-entry-note');
      if (a && a.watch) {
        $f('#th-entry').value = num(a.lastPx) > 0 ? num(a.lastPx) : '';
        if (en) en.innerHTML = num(a.lastPx) > 0
          ? `观察标的尚未买入，此处是<strong>计划买入价</strong>（已用现价 ${num(a.lastPx)} 起步，请改成你打算的进场位）`
          : '观察标的：请填你计划的买入价';
      } else {
        const cp = costPriceOf(a);
        $f('#th-entry').value = cp.price != null ? cp.price : '';
        if (en) en.innerHTML = cp.price != null
          ? `已带出成本价 <strong>${cp.price}</strong>（${escapeHtml(cp.src)}），可手改为你的实际买入价`
          : (a && num(a.lastPx) > 0 ? `<span style="color:var(--amber-ink)">该标的没有成本数据（份额/浮盈亏为空），请手填你的实际买入价；现价 ${num(a.lastPx)} 仅供参考</span>` : '');
      }
      $f('#th-months').value = 12; $f('#th-date').value = todayStr(); $f('#th-conf').value = '中';
      scoreBox.querySelectorAll('[data-sc]').forEach(i => { i.value = ''; });
      drawGates(); return;
    }
    // 已有卡也要标明这一栏的语义（观察=计划买入价 / 持仓=成本价）
    const en2 = $f('#th-entry-note');
    if (en2) en2.innerHTML = (a && a.watch)
      ? `观察标的尚未买入，此处是<strong>计划买入价</strong>${num(a.lastPx) > 0 ? '（现价 ' + num(a.lastPx) + '）' : ''}`
      : '此处应为你的<strong>成本价</strong>（不是现价）';
    $f('#th-bull').value = t.bull || ''; $f('#th-bear').value = t.bear || '';
    $f('#th-fals').value = (t.falsify || []).map(f => f.t).join('\n');
    $f('#th-entry').value = t.entry != null ? t.entry : ''; $f('#th-target').value = t.target != null ? t.target : '';
    $f('#th-stop').value = t.stop != null ? t.stop : ''; $f('#th-months').value = t.months != null ? t.months : 12;
    $f('#th-date').value = t.date || todayStr(); $f('#th-conf').value = t.conf || '中';
    scoreBox.querySelectorAll('[data-sc]').forEach(i => { i.value = (t.scores || {})[i.dataset.sc] != null ? t.scores[i.dataset.sc] : ''; });
    drawGates();
  }
  $f('#th-pick').onchange = e => loadThesis(e.target.value);

  // 加观察标的：用真实行情校验代码（A股 5–6 位数字 / 美股字母代码），拿回名称与现价
  $f('#th-watch-add').onclick = async () => {
    const raw = $f('#th-watch-code').value.trim();
    const note = $f('#th-watch-note'), btn = $f('#th-watch-add');
    if (!raw) { note.innerHTML = '<span style="color:var(--amber-ink)">请先填代码</span>'; return; }
    const code = isUsCode(raw) ? raw.toUpperCase() : raw;
    if (theses[code]) { note.innerHTML = `<span style="color:var(--amber-ink)">「${escapeHtml(code)}」已有决策卡，直接在上面的下拉里选它即可</span>`; return; }
    if (heldCands.some(a => thesisKeyOf(a) === code)) { note.innerHTML = `<span style="color:var(--amber-ink)">「${escapeHtml(code)}」已在你的持仓里，请直接在下拉里选</span>`; return; }
    btn.disabled = true; const ob = btn.innerHTML; btn.innerHTML = icon('refresh', 'spin') + ' 校验中…';
    note.textContent = '正在用真实行情校验代码…';
    try {
      const q = await fetchQuote(code);
      if (!q || !(num(q.price) > 0)) throw new Error('未取到有效行情');
      // 只写进决策卡（watch 标记），不进 STATE.assets：不计入总资产、不参与再平衡
      logOp('新增观察标的：' + (q.name || code));
      theses[code] = {
        key: code, name: q.name || code, code, watch: true,
        watchPx: +num(q.price).toFixed(4), watchPxDate: todayStr(),
        bull: '', bear: '', falsify: [],
        // 计划买入价先按现价起步（观察标的没有成本，这一栏的语义是「你打算在哪进场」）
        entry: +num(q.price).toFixed(4), target: null, stop: null,
        months: 12, scores: {}, conf: '中', date: todayStr(),
      };
      saveState(); render();
    } catch (e) {
      note.innerHTML = `<span style="color:var(--red-ink)">校验失败：${escapeHtml(e.message)}</span>`;
      btn.disabled = false; btn.innerHTML = ob;
    }
  };

  $f('#th-save').onclick = () => {
    const k = $f('#th-pick').value;
    if (!k) { alert('请先选择标的'); return; }
    const bull = $f('#th-bull').value.trim(), bear = $f('#th-bear').value.trim();
    const falsLines = $f('#th-fals').value.split('\n').map(x => x.trim()).filter(Boolean);
    if (!bull) { alert('请填写看多逻辑'); return; }
    if (!bear) { alert('空头论证是必填项——写不出反方理由，说明还没想清楚就要下注。可以点「AI 帮我写反方论证」再自行修改。'); return; }
    if (!falsLines.length) { alert('请至少写 1 条证伪条件（可观测的客观事件）'); return; }
    const a = cands.find(x => thesisKeyOf(x) === k);
    const old = theses[k];
    // 保留已勾中的证伪状态（按文本匹配），编辑不清空历史触发
    const oldHit = {};
    (old && old.falsify || []).forEach(f => { if (f && f.hit) oldHit[f.t] = true; });
    const scores = {};
    scoreBox.querySelectorAll('[data-sc]').forEach(i => { const v = i.value.trim(); if (v !== '') scores[i.dataset.sc] = Math.max(0, Math.min(10, num(v))); });
    logOp((old ? '编辑' : '新建') + '决策卡：' + ((a && a.name) || k));
    theses[k] = {
      key: k, name: (a && a.name) || (old && old.name) || k, code: (a && a.code) || '',
      bull, bear,
      falsify: falsLines.map(t => ({ t, hit: !!oldHit[t] })),
      entry: num($f('#th-entry').value) || null, target: num($f('#th-target').value) || null,
      stop: num($f('#th-stop').value) || null, months: num($f('#th-months').value) || null,
      scores, conf: $f('#th-conf').value, date: $f('#th-date').value || todayStr(),
      aiBear: old && old.aiBear || null,
      // 观察标记与缓存现价随卡保留：编辑后不会变回「已持仓」口径
      watch: !!(a && a.watch) || !!(old && old.watch && !heldCands.some(x => thesisKeyOf(x) === k)),
      watchPx: (old && old.watchPx) || (a && a.watch ? num(a.lastPx) || null : null),
      watchPxDate: (old && old.watchPxDate) || (a && a.watch ? todayStr() : null),
    };
    saveState(); render();
  };
  $f('#th-del').onclick = () => {
    const k = $f('#th-pick').value;
    if (!k || !theses[k]) return;
    if (!confirm('删除这张决策卡？（证伪条件的触发状态也会一并清除；可在「修改日志」还原）')) return;
    logOp('删除决策卡：' + (theses[k].name || k));
    delete theses[k]; saveState(); render();
  };

  // AI 起草正反方 + 证伪条件：把「自动评四维」刚拉到的真实数据作为唯一事实来源喂进去。
  // 有你自己的看多逻辑时它做针对性反驳；没有时它也起草一版正方——但那只是「按数据能讲出的故事」，
  // 不等于你的判断，必须改写后再存。
  $f('#th-ai').onclick = async () => {
    const k = $f('#th-pick').value, bull = $f('#th-bull').value.trim();
    if (!k) { alert('请先选择标的'); return; }
    const a = cands.find(x => thesisKeyOf(x) === k);
    const code = (a && a.code) || '';
    const btn = $f('#th-ai'), out = $f('#th-ai-out');
    btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = icon('refresh', 'spin') + ' 生成中…';
    out.innerHTML = '<div class="inline-note">正在起草（约 10–30 秒）…</div>';
    try {
      // 还没点过「自动评四维」就先补拉一次，保证 AI 拿到的是真实数据而不是空手推理
      if (lastData.code !== code) lastData = { tech: null, fund: null, ann: null, rs: null, code, name: (a && a.name) || '' };
      if (!lastData.fund && code) { try { const f0 = await fetchFundamentals(code); if (f0.ok) lastData.fund = f0; } catch (e) {} }
      if (!lastData.ann && code) { try { const a0 = await fetchAnnouncements(code, 20); if (a0.ok) lastData.ann = a0.list; } catch (e) {} }
      let rows0 = null;
      if (!lastData.tech && code) { try { rows0 = await fetchTechKlines(code); const t0 = techScore(rows0); if (t0.ok) lastData.tech = t0; } catch (e) {} }
      if (!lastData.rs && code) {
        try {
          if (!rows0) rows0 = await fetchTechKlines(code);
          const bm = await fetchRsBenchmark(isUsCode(code));
          const r0 = rsScore(rows0, bm.series, bm.name);
          if (r0.ok) lastData.rs = r0;
        } catch (e) {}
      }
      const F = lastData.fund, T = lastData.tech, A = lastData.ann;
      const facts = [];
      // 行业锚点：细分行业（东财 BOARD_NAME）+ 你在「持仓」里给它标的因子——
      // 没有这个，模型只能对着财务数字复述，写不出「需求从哪来 → 公司卡在哪 → 怎么兑现」的链条
      const pos0 = code ? (STATE.positions || []).find(x => x.code === code) : null;
      const industry = [(F && F.board) ? '细分行业：' + F.board : '', pos0 && pos0.factor ? '你标注的因子：' + pos0.factor : ''].filter(Boolean).join('；');
      if (industry) facts.push('【行业定位】' + industry);
      if (F) facts.push('【基本面·真实数据】' + [
        F.pe != null ? 'PE(TTM) ' + F.pe.toFixed(2) : '', F.pb != null ? 'PB ' + F.pb.toFixed(2) : '',
        F.roe != null ? 'ROE(年化) ' + F.roe + '%' : '', F.gross != null ? '毛利率 ' + F.gross.toFixed(2) + '%' : '',
        F.netMargin != null ? '净利率 ' + F.netMargin + '%' : '', F.debt != null ? '资产负债率 ' + F.debt.toFixed(2) + '%' : '',
        F.revYoy != null ? '营收同比 ' + F.revYoy.toFixed(2) + '%' : '', F.profitYoy != null ? '净利同比 ' + F.profitYoy.toFixed(2) + '%' : '',
        F.reportDate ? '报告期 ' + F.reportDate : '',
      ].filter(Boolean).join('，'));
      if (T) facts.push('【技术面·真实读数】' + T.date + ' 收盘 ' + T.px + '，评分 ' + T.score + '/10；'
        + T.parts.map(p => p.k + '：' + p.v).join('；') + '；近60日区间 ' + T.low60.toFixed(2) + '–' + T.high60.toFixed(2));
      const R = lastData.rs;
      if (R && R.ok) facts.push('【行业/相对强弱·真实读数】对比 ' + R.benchName + '，评分 ' + R.score + '/10；' + R.parts.map(p => p.k + '：' + p.v).join('；'));
      if (A && A.length) facts.push('【近期公告·真实标题】\n' + A.slice(0, 15).map(x => '· ' + x.date + ' ' + x.title).join('\n'));
      if (!facts.length) facts.push('（未取到任何真实数据，请在结论中明确说明"数据不足"，不要编造数字）');

      const sys = '你是一位严谨的证券研究员，同时扮演多头与空头两个角色。用户给你【已检索到的真实数据】与【行业定位】，请据此起草多空论证与证伪条件。\n'
        + '写作要求（最重要）：\n'
        + '· 多空论证必须是【业务因果链】，不是财务数字的复述。合格的多头长这样：'
        + '"需求端X在扩张 → 公司在Y环节卡位 → 通过Z兑现为收入/利润"，然后才用给定数字佐证。'
        + '不合格的多头长这样："净利同比增444%、ROE 62.8%，基本面强势"——那只是念数据，用户自己看得到。\n'
        + '· 空头要攻击这条链条最脆弱的一环（需求证伪？卡位不牢？兑现不了？），而不是只说"估值高、动量弱"。\n'
        + '真实性边界（务必分清）：\n'
        + '· 允许：使用你对该行业的【一般性常识】做推理，例如这个细分行业的下游需求来自哪里、'
        + '典型商业模式、竞争格局的一般特征、产业链上下游关系——这些是可被读者独立核实的公共认知；\n'
        + '· 禁止：编造【具体事实】——具体订单、客户名、产能数字、市占率、未给出的财务数据、'
        + '具体政策文件、未来事件时间表。凡涉及具体数字，只能用上面给定数据里出现过的；不确定就写"需核实"。\n'
        + '其它硬性要求：\n'
        + '(1) 绝对不给买入/卖出/持有评级，不给目标价，不预测涨跌——那不是你的任务；\n'
        + '(2) 证伪条件必须【客观可验证且带阈值】（如"单季毛利率跌破25%"、"营收同比连续两季转负"），'
        + '禁止"股价下跌""市场情绪转弱"这类同义反复；优先使用上面给定数据里已有的指标，便于日后逐条核对；\n'
        + '(3) 多头/空头各一到两句，直接、具体、可反驳；\n'
        + '(4) 用中文。严格返回 JSON：'
        + '{"bull":"看多逻辑（业务因果链+数据佐证）","bear":"最强空头论证（攻击链条最弱环节）","risks":["下行风险1","下行风险2","下行风险3"],"falsify":["证伪条件1","证伪条件2","证伪条件3"]}';
      const user = '标的：' + ((a && a.name) || k) + (code ? '（' + code + '）' : '') + '\n\n'
        + facts.join('\n\n')
        + (bull ? '\n\n【用户已写的看多逻辑】' + bull + '\n请以用户这条为准写 bull（可据数据润色，但不得改变其核心主张），并针对它写最强反驳。'
                : '\n\n用户尚未写看多逻辑，请据上述真实数据起草一版。');
      const r = await aiChatJSON(sys, user, { temperature: 0.2, seed: 7, maxTokens: 1600 });
      const dBull = String(r.bull || '').trim();
      const bear = String(r.bear || '').trim();
      const fals = Array.isArray(r.falsify) ? r.falsify.map(x => String(x).trim()).filter(Boolean) : [];
      const risks = Array.isArray(r.risks) ? r.risks.map(x => String(x).trim()).filter(Boolean) : [];
      const used = [F ? '基本面' : '', T ? '技术面' : '', (R && R.ok) ? '相对强弱' : '', (A && A.length) ? '公告 ' + A.length + ' 条' : ''].filter(Boolean).join(' + ') || '无真实数据';
      out.innerHTML = '<div class="alert amber" style="margin-top:10px"><span class="icon">' + icon('warn') + '</span><div>'
        + '<span class="inline-note">事实来源：' + escapeHtml(used) + '（AI 只看得到这些，没有其它信息渠道）</span>'
        + (dBull ? '<br><strong style="color:var(--green-ink)">多</strong>：' + escapeHtml(dBull) : '')
        + (bear ? '<br><strong style="color:var(--red-ink)">空</strong>：' + escapeHtml(bear) : '')
        + (risks.length ? '<br><strong>下行风险</strong>：<br>· ' + risks.map(escapeHtml).join('<br>· ') : '')
        + (fals.length ? '<br><strong>建议的证伪条件</strong>：<br>· ' + fals.map(escapeHtml).join('<br>· ') : '')
        + '<div class="row" style="gap:6px;margin-top:8px">'
        + '<button class="btn secondary small" id="th-ai-apply" style="flex:0 0 auto">填入表单（只填空白项）</button>'
        + '<button class="btn secondary small" id="th-ai-apply-all" style="flex:0 0 auto">覆盖填入全部</button></div>'
        + '<span class="inline-note"><strong>这是草稿不是结论</strong>：看多逻辑最好是<u>你自己</u>的判断——AI 只是按数据讲了一个能自圆其说的故事，'
        + '照抄等于把判断外包，这张卡也就失去了意义。证伪条件尽量保留阈值形式，日后才好逐条核对。</span></div></div>';
      const fill = (force) => {
        if (dBull && (force || !$f('#th-bull').value.trim())) $f('#th-bull').value = dBull;
        if (bear && (force || !$f('#th-bear').value.trim())) $f('#th-bear').value = bear;
        if (fals.length && (force || !$f('#th-fals').value.trim())) $f('#th-fals').value = fals.join('\n');
      };
      const ap = out.querySelector('#th-ai-apply'); if (ap) ap.onclick = () => fill(false);
      const ap2 = out.querySelector('#th-ai-apply-all'); if (ap2) ap2.onclick = () => fill(true);
    } catch (e) {
      out.innerHTML = '<div class="alert red" style="margin-top:10px"><span class="icon">' + icon('warn') + '</span><div>生成失败：' + escapeHtml(e.message) + '</div></div>';
    } finally { btn.disabled = false; btn.innerHTML = old; }
  };

  // —— 已有决策卡：卡片式列表，点开看详情 / 就地修改 / AI 更正 / 删除 ——
  const keys = Object.keys(theses);
  const listCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('list')} 我的决策卡（${keys.length}）</h3>
    <p class="hint">每张卡一个标的，<strong>点卡片展开详情</strong>：可改内容、勾证伪、让 AI 按最新数据复核、或删除。勾中任一证伪条件 = 你亲自确认逻辑已破，该标的会自动排到再平衡卖出队首——这是给未来的你留的证据，别事后改条件。</p></div>`);

  // 单张卡的状态摘要（列表与详情共用）
  const cardState = (k) => {
    const t = theses[k];
    const a = cands.find(x => thesisKeyOf(x) === k);
    const watch = isWatchKey(k);
    const px = num(a && a.lastPx) || num(t.watchPx);
    const st = thesisStatus(a || { code: t.code, name: t.name }, px);
    const hits = (t.falsify || []).filter(f => f && f.hit).length;
    const badges = [];
    if (watch) badges.push('<span class="pill">👁 观察中·未买入</span>');
    if (st.broken) badges.push('<span class="pill red">证伪已触发</span>');
    if (st.expired) badges.push('<span class="pill amber">窗口过期</span>');
    if (st.target) badges.push('<span class="pill green">达目标价</span>');
    if (st.stop) badges.push('<span class="pill red">破止损价</span>');
    // 已持仓：浮动盈亏（现价 vs 成本）；观察中：现价距计划买入价还有多远（负=已跌破计划价，更划算）
    let pnlPct = null;
    if (num(t.entry) > 0 && px > 0) pnlPct = (px - num(t.entry)) / num(t.entry) * 100;
    return { t, a, px, st, hits, badges, pnlPct, watch,
      pnlLabel: watch ? '距计划买入价' : '浮动',
      tone: st.broken || st.stop ? 'broken' : (st.expired ? 'warn' : '') };
  };

  function drawThesisCards() {
    listCard.querySelectorAll('[data-tk],.empty').forEach(n => n.remove());
    if (!keys.length) {
      listCard.appendChild(el(`<div class="empty"><div class="big">${icon('clipboard')}</div><p>还没有决策卡。选一个持仓，先给最看重的 2–3 只建卡。</p></div>`));
      return;
    }
    keys.forEach(k => {
      const c = cardState(k), t = c.t;
      const sc = t.scores || {};
      const scChips = Object.keys(SCORE_ANCHORS).filter(x => sc[x] != null)
        .map(x => `<span class="pill gray">${SCORE_ANCHORS[x][0]} ${sc[x]}</span>`).join(' ');
      // 观察中的卡：绿=已跌破计划买入价(更划算)，红=已涨过计划价(追高)，与持仓的盈亏色义相反，故加标签
      const pnlTxt = c.pnlPct == null ? '' :
        `<span title="${c.pnlLabel}" style="color:${(c.watch ? -c.pnlPct : c.pnlPct) >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'};font-weight:600">${c.watch ? c.pnlLabel + ' ' : ''}${c.pnlPct >= 0 ? '+' : ''}${c.pnlPct.toFixed(1)}%</span>`;
      listCard.appendChild(el(`<div class="thesis-card ${c.tone}" data-tk="${escapeHtml(k)}">
        <div class="row" style="gap:8px;align-items:baseline;flex-wrap:wrap">
          <strong style="font-size:15px">${escapeHtml(t.name || k)}</strong>
          ${t.code ? `<span class="inline-note">${escapeHtml(t.code)}</span>` : ''}
          ${pnlTxt}
          <span style="flex:1"></span>
          <span class="pill">信心 ${escapeHtml(t.conf || '中')}</span>${c.badges.join(' ')}
        </div>
        <div class="clamp1" style="font-size:13px;margin-top:5px"><strong style="color:var(--green-ink)">多</strong> ${escapeHtml(t.bull || '')}</div>
        <div class="clamp1" style="font-size:13px"><strong style="color:var(--red-ink)">空</strong> ${escapeHtml(t.bear || '')}</div>
        <div class="inline-note" style="margin-top:6px">
          ${c.watch ? '计划入场' : '入场'} ${t.entry != null ? t.entry : '—'} · 目标 ${t.target != null ? t.target : '—'} · 止损 ${t.stop != null ? t.stop : '—'}${c.px > 0 ? ' · 现价 ' + c.px : ''}
          · 窗口至 ${thesisDueDate(t) || '—'}
          · 证伪 <strong style="color:${c.hits ? 'var(--red-ink)' : 'inherit'}">${c.hits}/${(t.falsify || []).length}</strong>
          ${scChips ? '<br>' + scChips : ''}
        </div>
        <div class="inline-note" style="margin-top:4px;color:var(--accent-ink)">点击展开详情 / 修改 / 删除 →</div>
      </div>`));
    });
    listCard.querySelectorAll('[data-tk]').forEach(n => n.onclick = () => showThesisModal(n.dataset.tk));
  }

  // 详情弹窗：查看 + 就地修改 + 勾证伪 + AI 按最新数据复核 + 删除
  function showThesisModal(k) {
    const c = cardState(k), t = c.t;
    const sc = t.scores || {};
    const scRows = Object.keys(SCORE_ANCHORS).map(x =>
      `<tr><td>${SCORE_ANCHORS[x][0]}</td><td class="num">${sc[x] != null ? sc[x] + ' / 10' : '<span style="color:var(--muted)">未评</span>'}</td></tr>`).join('');
    const body = `
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <span class="pill">信心 ${escapeHtml(t.conf || '中')}</span>${c.badges.join(' ')}
        ${c.pnlPct != null ? `<span class="pill ${(c.watch ? -c.pnlPct : c.pnlPct) >= 0 ? 'green' : 'red'}">${c.pnlLabel} ${c.pnlPct >= 0 ? '+' : ''}${c.pnlPct.toFixed(1)}%</span>` : ''}
      </div>
      <div class="field"><label>看多逻辑</label><textarea id="tm-bull" rows="2">${escapeHtml(t.bull || '')}</textarea></div>
      <div class="field"><label>最强反方论证</label><textarea id="tm-bear" rows="2">${escapeHtml(t.bear || '')}</textarea></div>
      <div class="field"><label>证伪条件（勾选 = 已发生；改文字会重置该条的勾选状态）</label>
        <div id="tm-fals">${(t.falsify || []).map((f, i) => `<label style="display:flex;gap:7px;align-items:flex-start;font-size:13px;padding:3px 0">
          <input type="checkbox" data-fi="${i}" ${f.hit ? 'checked' : ''} style="width:auto;margin-top:3px"/>
          <span style="${f.hit ? 'color:var(--red-ink);font-weight:600' : ''}">${escapeHtml(f.t)}</span></label>`).join('') || '<span class="inline-note">（无）</span>'}</div>
        <textarea id="tm-falstxt" rows="3" placeholder="每行一条">${escapeHtml((t.falsify || []).map(f => f.t).join('\n'))}</textarea></div>
      <div class="grid grid-3">
        <div class="field"><label>入场价</label><input id="tm-entry" type="number" step="0.01" value="${t.entry != null ? t.entry : ''}"/></div>
        <div class="field"><label>目标价</label><input id="tm-target" type="number" step="0.01" value="${t.target != null ? t.target : ''}"/></div>
        <div class="field"><label>止损价</label><input id="tm-stop" type="number" step="0.01" value="${t.stop != null ? t.stop : ''}"/></div>
      </div>
      <div class="grid grid-3">
        <div class="field"><label>窗口（月）</label><input id="tm-months" type="number" step="1" value="${t.months != null ? t.months : ''}"/></div>
        <div class="field"><label>建卡日期</label><input id="tm-date" type="date" value="${escapeHtml(t.date || '')}"/></div>
        <div class="field"><label>信心</label><select id="tm-conf">${['高', '中', '低'].map(x => `<option${x === (t.conf || '中') ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
      </div>
      <details style="margin:6px 0"><summary style="cursor:pointer;font-size:12px;color:var(--muted);list-style:revert">四维评分（只做记录，不参与自动裁决）</summary>
        <div class="table-scroll"><table><tbody>${scRows}</tbody></table></div></details>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn" id="tm-save" style="flex:0 0 auto">${icon('check')} 保存修改</button>
        <button class="btn secondary" id="tm-ai" style="flex:0 0 auto">${icon('sparkles')} AI 按最新数据复核</button>
        <button class="btn danger" id="tm-del" style="flex:0 0 auto">${icon('trash')} 删除此卡</button>
      </div>
      <div id="tm-ai-out"></div>
      <p class="inline-note" style="margin-top:8px">现价 ${c.px > 0 ? c.px : '—'}${t.entry != null && c.px > 0 ? `，相对入场 ${c.pnlPct >= 0 ? '+' : ''}${c.pnlPct.toFixed(1)}%` : ''}。修改会先留底到「修改日志」，可还原。</p>`;
    showModal(escapeHtml(t.name || k) + (t.code ? ' <span class="inline-note">' + escapeHtml(t.code) + '</span>' : ''), body);
    const ov = document.querySelector('[data-modal]');
    if (!ov) return;
    const $m = s => ov.querySelector(s);
    // 勾选证伪：立即生效（与列表口径一致），并二次确认
    ov.querySelectorAll('#tm-fals [data-fi]').forEach(cb => cb.onchange = () => {
      const i = +cb.dataset.fi;
      if (!t.falsify || !t.falsify[i]) return;
      if (cb.checked && !confirm(`确认「${t.falsify[i].t}」已经发生？\n\n勾中 = 你亲自判定逻辑已破，该标的会被提到再平衡卖出队首。`)) { cb.checked = false; return; }
      logOp('决策卡证伪条件' + (cb.checked ? '勾中' : '取消') + '：' + (t.name || k));
      t.falsify[i].hit = cb.checked;
      saveState(); ov.remove(); render();
    });
    $m('#tm-save').onclick = () => {
      const bull = $m('#tm-bull').value.trim(), bear = $m('#tm-bear').value.trim();
      const lines = $m('#tm-falstxt').value.split('\n').map(x => x.trim()).filter(Boolean);
      if (!bull) { alert('看多逻辑不能为空'); return; }
      if (!bear) { alert('反方论证不能为空——这是这张卡的关键部分'); return; }
      if (!lines.length) { alert('至少保留 1 条证伪条件'); return; }
      const oldHit = {};
      (t.falsify || []).forEach(f => { if (f && f.hit) oldHit[f.t] = true; });   // 文字没改的条目保留勾选
      logOp('编辑决策卡：' + (t.name || k));
      t.bull = bull; t.bear = bear;
      t.falsify = lines.map(x => ({ t: x, hit: !!oldHit[x] }));
      t.entry = num($m('#tm-entry').value) || null;
      t.target = num($m('#tm-target').value) || null;
      t.stop = num($m('#tm-stop').value) || null;
      t.months = num($m('#tm-months').value) || null;
      t.date = $m('#tm-date').value || t.date;
      t.conf = $m('#tm-conf').value;
      saveState(); ov.remove(); render();
    };
    $m('#tm-del').onclick = () => {
      if (!confirm(`删除「${t.name || k}」这张决策卡？\n证伪条件的触发状态也会一并清除；可在「设置 → 修改日志」还原。`)) return;
      logOp('删除决策卡：' + (t.name || k));
      delete theses[k]; saveState(); ov.remove(); render();
    };
    // AI 复核：按最新真实数据重出反方与证伪建议（不碰你的看多逻辑，除非你自己填回去）
    $m('#tm-ai').onclick = async (ev) => {
      const btn = ev.target.closest('button'); btn.disabled = true;
      const ob = btn.innerHTML; btn.innerHTML = icon('refresh', 'spin') + ' 复核中…';
      const out = $m('#tm-ai-out');
      out.innerHTML = '<div class="inline-note">正在按最新数据复核（约 10–30 秒）…</div>';
      try {
        const code = t.code || '';
        let F = null, T = null, A = null;
        if (code) {
          try { const f0 = await fetchFundamentals(code); if (f0.ok) F = f0; } catch (e) {}
          try { const t0 = techScore(await fetchTechKlines(code)); if (t0.ok) T = t0; } catch (e) {}
          try { const a0 = await fetchAnnouncements(code, 20); if (a0.ok) A = a0.list; } catch (e) {}
        }
        const facts = [];
        const pm = t.code ? (STATE.positions || []).find(x => x.code === t.code) : null;
        const ind = [(F && F.board) ? '细分行业：' + F.board : '', pm && pm.factor ? '你标注的因子：' + pm.factor : ''].filter(Boolean).join('；');
        if (ind) facts.push('【行业定位】' + ind);
        if (F) facts.push('【基本面·最新真实数据】' + [
          F.pe != null ? 'PE(TTM) ' + F.pe.toFixed(2) : '', F.pb != null ? 'PB ' + F.pb.toFixed(2) : '',
          F.roe != null ? 'ROE(年化) ' + F.roe + '%' : '', F.gross != null ? '毛利率 ' + F.gross.toFixed(2) + '%' : '',
          F.debt != null ? '资产负债率 ' + F.debt.toFixed(2) + '%' : '',
          F.revYoy != null ? '营收同比 ' + F.revYoy.toFixed(2) + '%' : '', F.profitYoy != null ? '净利同比 ' + F.profitYoy.toFixed(2) + '%' : '',
          F.reportDate ? '报告期 ' + F.reportDate : '',
        ].filter(Boolean).join('，'));
        if (T) facts.push('【技术面·最新读数】' + T.date + ' 收盘 ' + T.px + '，评分 ' + T.score + '/10；' + T.parts.map(p => p.k + '：' + p.v).join('；'));
        try {
          const bm = await fetchRsBenchmark(isUsCode(t.code || ''));
          const rows2 = await fetchTechKlines(t.code);
          const R2 = rsScore(rows2, bm.series, bm.name);
          if (R2.ok) facts.push('【行业/相对强弱】对比 ' + R2.benchName + '，评分 ' + R2.score + '/10；' + R2.parts.map(p => p.k + '：' + p.v).join('；'));
        } catch (e) {}
        if (A && A.length) facts.push('【近期公告】\n' + A.slice(0, 12).map(x => '· ' + x.date + ' ' + x.title).join('\n'));
        const sys = '你是空头研究员，负责复核一张已存在的投资决策卡是否还站得住。'
          + '硬性要求：(1) 不给买入/卖出/持有评级、不给目标价、不预测涨跌；'
          + '(2) 只能引用给定数据里的数字，禁止编造，不确定写"需核实"；'
          + '(3) 逐条判断【原有证伪条件】是否已经被最新数据触发（hit=true/false），并说明依据；'
          + '(4) 如原条件写得不可验证或阈值失效，在 newFalsify 里给出改进版（带阈值、可核对）；'
          + '(5) 用中文。严格返回 JSON：'
          + '{"bear":"一句话最新反方论证","checks":[{"i":序号,"hit":true或false,"why":"依据"}],"newFalsify":["改进后的证伪条件"],"verdict":"逻辑仍成立|需警惕|已动摇"}';
        const user = '标的：' + (t.name || k) + (code ? '（' + code + '）' : '')
          + '\n\n【原看多逻辑】' + (t.bull || '')
          + '\n【原反方论证】' + (t.bear || '')
          + '\n【原证伪条件】\n' + (t.falsify || []).map((f, i) => i + '. ' + f.t + (f.hit ? '（已人工勾中）' : '')).join('\n')
          + '\n\n' + (facts.length ? facts.join('\n\n') : '（未取到真实数据，请说明数据不足，不要编造）');
        const r = await aiChatJSON(sys, user, { temperature: 0.2, seed: 9, maxTokens: 1600 });
        const checks = Array.isArray(r.checks) ? r.checks : [];
        const nf = Array.isArray(r.newFalsify) ? r.newFalsify.map(x => String(x).trim()).filter(Boolean) : [];
        const used = [F ? '基本面' : '', T ? '技术面' : '', (A && A.length) ? '公告 ' + A.length + ' 条' : ''].filter(Boolean).join(' + ') || '无真实数据';
        out.innerHTML = `<div class="alert amber" style="margin-top:10px"><span class="icon">${icon('warn')}</span><div>
          <strong>复核结论：${escapeHtml(String(r.verdict || '—'))}</strong>
          <span class="inline-note">（事实来源：${escapeHtml(used)}）</span>
          ${r.bear ? '<br><strong style="color:var(--red-ink)">最新反方</strong>：' + escapeHtml(String(r.bear)) : ''}
          ${checks.length ? '<br><strong>原证伪条件逐条核对</strong>：<br>' + checks.map(x => {
            const orig = (t.falsify || [])[x.i];
            return `${x.hit ? '⛔ <strong>已触发</strong>' : '○ 未触发'} ${escapeHtml(orig ? orig.t : '#' + x.i)}<br><span class="inline-note" style="margin-left:14px">${escapeHtml(String(x.why || ''))}</span>`;
          }).join('<br>') : ''}
          ${nf.length ? '<br><strong>建议改进的证伪条件</strong>：<br>· ' + nf.map(escapeHtml).join('<br>· ') : ''}
          ${nf.length ? `<div class="row" style="gap:6px;margin-top:8px"><button class="btn secondary small" id="tm-ai-use" style="flex:0 0 auto">用改进版替换上方证伪条件（还需点保存）</button></div>` : ''}
          <span class="inline-note"><strong>AI 的判定不会自动勾选</strong>——是否认定逻辑已破由你亲自勾，这是纪律的一部分。若你认同它的核对结果，请自己勾上面的框。</span></div></div>`;
        const useBtn = out.querySelector('#tm-ai-use');
        if (useBtn) useBtn.onclick = () => { $m('#tm-falstxt').value = nf.join('\n'); };
        if (r.bear) $m('#tm-bear').value = String(r.bear);
      } catch (e) {
        out.innerHTML = `<div class="alert red" style="margin-top:10px"><span class="icon">${icon('warn')}</span><div>复核失败：${escapeHtml(e.message)}</div></div>`;
      } finally { btn.disabled = false; btn.innerHTML = ob; }
    };
  }
  drawThesisCards();
  app.appendChild(listCard);
};

VIEWS.calibration = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>复盘校准 · 判断力体检</h2>
      <p>凯利/减仓时点「记录此判断」会存到这里。事后回填结果，工具算出你的<strong>实际胜率 vs 你以为的胜率</strong>与 <strong>Brier 分数</strong>——多数人会发现自己填的“70%”只兑现约 50%。这是唯一能真正校准判断力的功能。</p>
    </div>
  `));

  const fc = STATE.forecasts || [];
  const closed = fc.filter(f => f.outcome === 'win' || f.outcome === 'loss');

  // 汇总：平均预测胜率、实际胜率、Brier 分数（越低越准，0=完美）
  if (closed.length) {
    const avgP = closed.reduce((a, f) => a + num(f.p), 0) / closed.length;
    const realWin = closed.filter(f => f.outcome === 'win').length / closed.length * 100;
    const brier = closed.reduce((a, f) => { const o = f.outcome === 'win' ? 1 : 0; const pr = num(f.p) / 100; return a + (pr - o) * (pr - o); }, 0) / closed.length;
    // 校准分桶（<40 / 40–55 / 55–70 / >70）
    const buckets = [[0, 40, '保守(<40%)'], [40, 55, '偏低(40–55%)'], [55, 70, '中高(55–70%)'], [70, 101, '高(>70%)']];
    const bucketRows = buckets.map(([lo, hi, lbl]) => {
      const grp = closed.filter(f => num(f.p) >= lo && num(f.p) < hi);
      if (!grp.length) return `<tr><td>${lbl}</td><td class="num">0</td><td class="num">—</td><td class="num">—</td></tr>`;
      const predAvg = grp.reduce((a, f) => a + num(f.p), 0) / grp.length;
      const realAvg = grp.filter(f => f.outcome === 'win').length / grp.length * 100;
      const gap = realAvg - predAvg;
      return `<tr><td>${lbl}</td><td class="num">${grp.length}</td><td class="num">${predAvg.toFixed(0)}%</td>
        <td class="num" style="color:${gap<-8?'var(--red-ink)':(gap>8?'var(--green-ink)':'inherit')}">${realAvg.toFixed(0)}%</td></tr>`;
    }).join('');

    const over = avgP - realWin;
    app.appendChild(el(`<div class="card">
      <div class="stat-grid" style="margin-bottom:8px">
        <div class="stat"><div class="label">已结算判断</div><div class="value">${closed.length}</div><div class="sub">共记录 ${fc.length} 条</div></div>
        <div class="stat"><div class="label">你以为的平均胜率</div><div class="value">${avgP.toFixed(0)}%</div><div class="sub">主观预测</div></div>
        <div class="stat"><div class="label">实际胜率</div><div class="value" style="color:${realWin>=avgP-8?'var(--green-ink)':'var(--red-ink)'}">${realWin.toFixed(0)}%</div><div class="sub">${over>8?'高估 '+over.toFixed(0)+'个点':(over<-8?'低估':'较准')}</div></div>
        <div class="stat"><div class="label">Brier 分数</div><div class="value" style="color:${brier<=0.2?'var(--green-ink)':(brier<=0.28?'var(--amber-ink)':'var(--red-ink)')}">${brier.toFixed(3)}</div><div class="sub">越低越准 · 0.25=瞎猜</div></div>
      </div>
      <div class="table-scroll"><table><thead><tr><th>你填的胜率区间</th><th class="num">样本</th><th class="num">平均预测</th><th class="num">实际兑现</th></tr></thead>
      <tbody>${bucketRows}</tbody></table></div>
      <p class="inline-note">若“高(>70%)”一栏实际兑现明显低于预测，说明你在高把握时最容易过度自信——正是散户最常亏钱的地方。样本越多越可信（建议 ≥15 条）。</p>
    </div>`));
  } else {
    app.appendChild(el(`<div class="card"><div class="alert blue"><span class="icon">${icon('info')}</span><div>还没有已结算的判断。到「① 凯利定注」评估标的后点「记录此判断」，一段时间后回来回填结果，就能看到你的校准曲线。</div></div></div>`));
  }

  // 记录列表 + 回填结果
  const listCard = el('<div class="card" style="margin-top:16px"><h3>判断记录</h3></div>');
  if (!fc.length) {
    listCard.appendChild(el(`<div class="empty"><div class="big">${icon('clipboard')}</div><p>暂无记录。</p></div>`));
  } else {
    const scroll = el('<div class="table-scroll"></div>');
    const rows = fc.slice().reverse().map(f => {
      const oc = f.outcome === 'win' ? '<span class="pill green">兑现</span>' : (f.outcome === 'loss' ? '<span class="pill red">落空</span>' : '<span class="pill">待结算</span>');
      return `<tr>
        <td>${escapeHtml(f.date)}</td>
        <td>${escapeHtml(f.name)}${f.code ? '（' + escapeHtml(f.code) + '）' : ''}</td>
        <td class="num">${num(f.p)}%</td>
        <td class="num">+${num(f.up)}/−${num(f.down)}</td>
        <td class="num" style="color:${num(f.ev)>=0?'var(--green-ink)':'var(--red-ink)'}">${num(f.ev)>=0?'+':''}${num(f.ev)}%</td>
        <td>${oc}</td>
        <td class="num">
          ${f.outcome ? `<button class="btn secondary small" data-clear="${f.id}">重置</button>`
            : `<button class="btn secondary small" data-win="${f.id}">兑现</button> <button class="btn danger small" data-loss="${f.id}">落空</button>`}
          <button class="btn danger small" data-del="${f.id}">删</button>
        </td>
      </tr>`;
    }).join('');
    scroll.appendChild(el(`<table><thead><tr><th>日期</th><th>标的</th><th class="num">预测胜率</th><th class="num">空间(+/−)</th><th class="num">EV</th><th>结果</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`));
    listCard.appendChild(scroll);
    listCard.appendChild(el(`<p class="inline-note">「兑现/落空」以你事后的客观判断为准（如：达到上涨目标算兑现、触及下跌空间/逻辑破坏算落空）。诚实回填，工具才有校准价值。</p>`));
    const setOutcome = (id, oc) => { const f = fc.find(x => x.id === id); if (f) { f.outcome = oc; saveState(); render(); } };
    scroll.querySelectorAll('[data-win]').forEach(b => b.onclick = () => setOutcome(b.dataset.win, 'win'));
    scroll.querySelectorAll('[data-loss]').forEach(b => b.onclick = () => setOutcome(b.dataset.loss, 'loss'));
    scroll.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => setOutcome(b.dataset.clear, ''));
    scroll.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (!confirm('删除这条判断记录？')) return;
      STATE.forecasts = fc.filter(x => x.id !== b.dataset.del); saveState(); render();
    });
  }
  app.appendChild(listCard);
};

/* =========================================================================
   视图：设置 Settings
   ========================================================================= */
VIEWS.settings = function (app) {
  const s = STATE.settings;
  app.appendChild(el(`
    <div class="view-head">
      <h2>全局设置</h2>
      <p>所有默认值取保守档。参数越保守，越能对抗情绪。</p>
    </div>
  `));

  const card = el('<div class="card"></div>');
  card.appendChild(el(`
    <div class="grid grid-2">
      <div class="field"><label>凯利系数（默认 0.25）</label>
        <input id="st-kelly" type="number" step="0.05" min="0" max="1" value="${s.kellyFraction}"/></div>
      <div class="field"><label>单股上限 %（默认 10）</label>
        <input id="st-cap" type="number" step="1" value="${s.singleCap}"/></div>
      <div class="field"><label>现金池下限 %（默认 10）</label>
        <input id="st-cash" type="number" step="1" value="${s.cashFloor}"/></div>
      <div class="field"><label>单笔风险 %（默认 2）</label>
        <input id="st-risk" type="number" step="0.5" value="${s.perTradeRisk}"/></div>
      <div class="field"><label>利润隔离阈值 %（默认 30）</label>
        <input id="st-lock" type="number" step="5" value="${s.profitLockThreshold}"/></div>
      <div class="field"><label>最大回撤阈值 %（默认 15）</label>
        <input id="st-dd" type="number" step="1" value="${s.maxDrawdown}"/></div>
      <div class="field"><label>弹性仓(股票)目标占比 %<span class="inline-note" style="display:inline"> 博弹性的引擎</span></label>
        <input id="st-eqtarget" type="number" step="1" value="${num(s.equityTargetPct,20)}"/></div>
      <div class="field"><label>弹性仓风险档</label>
        <select id="st-eqlevel">${Object.keys(EQUITY_RISK_LEVELS).map(k=>`<option ${s.equityRiskLevel===k?'selected':''}>${k}</option>`).join('')}</select>
        <p class="inline-note">决定弹性仓内部集中度容忍：进取=单股≤40%/因子≤75%(占弹性仓)；均衡 30/60；稳健 22/50。</p></div>
      <div class="field"><label>深套阈值 %（默认 20）</label>
        <input id="st-deep" type="number" step="1" value="${num(s.deepLossAdd,20)}"/>
        <p class="inline-note">浮亏超此值：亏损加仓硬拦、体检提示复核逻辑、减仓计划触发。</p></div>
      <div class="field"><label>总资产${(STATE.assets||[]).length ? '（由投资组合自动汇总）' : ''}</label>
        <input id="st-total" type="number" step="1000" value="${portfolioTotal()>0?portfolioTotal():''}" placeholder="如 1000000" ${(STATE.assets||[]).length ? 'readonly style="background:rgba(120,120,128,0.08);color:var(--muted)"' : ''}/>
        ${(STATE.assets||[]).length ? '<p class="inline-note">总资产 = 「投资组合」各资产按当日中间价折算后自动求和，随你在投资组合里增删/修改资产实时变化，无需手填。</p>' : ''}</div>
      <div class="field"><label>美元/人民币中间价</label>
        <input id="st-fx" type="number" step="0.0001" value="${currentFx()}"/>
        <p class="inline-note">美元资产与美元利息按此汇率折人民币；「投资组合」页可一键按中间价自动更新。</p></div>
    </div>
    <div class="row" style="margin-top:6px">
      <button class="btn" id="st-save" style="flex:0 0 auto">保存设置</button>
      <button class="btn secondary" id="st-reset" style="flex:0 0 auto">恢复保守默认值</button>
    </div>
  `));
  app.appendChild(card);

  card.querySelector('#st-save').onclick = () => {
    s.kellyFraction = num(card.querySelector('#st-kelly').value, 0.25);
    s.singleCap = num(card.querySelector('#st-cap').value, 10);
    s.cashFloor = num(card.querySelector('#st-cash').value, 10);
    s.perTradeRisk = num(card.querySelector('#st-risk').value, 2);
    s.profitLockThreshold = num(card.querySelector('#st-lock').value, 30);
    s.maxDrawdown = num(card.querySelector('#st-dd').value, 15);
    s.equityTargetPct = num(card.querySelector('#st-eqtarget').value, 20);
    s.equityRiskLevel = card.querySelector('#st-eqlevel').value || '进取';
    s.deepLossAdd = num(card.querySelector('#st-deep').value, 20);
    // 有投资组合明细时总资产自动汇总，不用手填值覆盖；无明细时才用手填兜底
    if (!(STATE.assets || []).length) STATE.portfolio.totalAssets = num(card.querySelector('#st-total').value, 0);
    STATE.portfolio.fxRate = num(card.querySelector('#st-fx').value, FX_DEFAULT) || FX_DEFAULT;
    saveState();
    alert('设置已保存');
    render();
  };
  card.querySelector('#st-reset').onclick = () => {
    if (!confirm('恢复为保守默认值？')) return;
    STATE.settings = Object.assign({}, DEFAULT_SETTINGS);
    saveState(); render();
  };

  /* 数据管理 */
  const dataCard = el('<div class="card" style="margin-top:16px"><h3>数据管理</h3><p class="hint">全部数据（持仓、资产、设置、快照）都<strong>保存在你自己的服务器</strong>，多设备自动同步、清缓存后自动恢复；本机浏览器保留一份离线缓存，断网时先存本机、恢复后自动补传。数据仅你本人（访问密码后）可读写。</p></div>');
  // 可按日期恢复的快照（带明细副本的才能整体还原），新日期在前
  const restorable = (STATE.snapshots || []).filter(sn => sn.assets && sn.assets.length)
    .slice().sort((a, b) => b.date.localeCompare(a.date));
  dataCard.appendChild(el(`
    <div class="field" style="max-width:460px">
      <label>恢复到某一天（用该日快照的资产明细整体还原）</label>
      <div class="row" style="gap:8px">
        <select id="dm-restore-date" ${restorable.length ? '' : 'disabled'}>
          ${restorable.length
            ? restorable.map(sn => `<option value="${sn.date}">${sn.date} · ${fmtMoney(sn.total)}</option>`).join('')
            : '<option>暂无带明细的快照</option>'}
        </select>
        <button class="btn" id="dm-restore" style="flex:0 0 auto" ${restorable.length ? '' : 'disabled'}>${icon('refresh')} 恢复到该日</button>
      </div>
      <p class="inline-note">恢复只替换当前资产/持仓，趋势快照历史保持不动。数据算错时选一个正确的日期即可回退。</p>
    </div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn secondary" id="dm-export" style="flex:0 0 auto">${icon('download')} 导出数据</button>
      <button class="btn secondary" id="dm-import" style="flex:0 0 auto">${icon('upload')} 导入数据</button>
      <button class="btn secondary" id="dm-seed" style="flex:0 0 auto">${icon('refresh')} 载入 7/19 初始数据</button>
      <button class="btn danger" id="dm-clear" style="flex:0 0 auto">${icon('trash')} 清空全部数据</button>
    </div>
    <input type="file" id="dm-file" accept="application/json" style="display:none"/>
  `));
  app.appendChild(dataCard);
  dataCard.querySelector('#dm-restore').onclick = async () => {
    const d = dataCard.querySelector('#dm-restore-date').value;
    const snap = (STATE.snapshots || []).find(sn => sn.date === d);
    if (!snap) return;
    if (!confirm(`用 ${d} 的快照明细覆盖当前资产与持仓？（快照历史不受影响）`)) return;
    logOp('恢复到快照 ' + d + '（覆盖前）');
    if (restoreFromSnapshot(snap)) {
      await pushCloudNow();
      alert(`已恢复到 ${d}`);
      render();
    } else {
      alert('该快照没有明细副本，无法整体恢复');
    }
  };
  dataCard.querySelector('#dm-seed').onclick = () => {
    if (!confirm('用 7/19 资产汇总表覆盖当前全部数据？')) return;
    logOp('载入 7/19 初始数据（覆盖前）');
    STATE = buildSeedState(); saveState(); render();
  };

  dataCard.querySelector('#dm-export').onclick = () => {
    const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'position-manager-data.json';
    a.click();
  };
  dataCard.querySelector('#dm-import').onclick = () => dataCard.querySelector('#dm-file').click();
  dataCard.querySelector('#dm-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        logOp('导入数据（覆盖前）');
        // 全量恢复（与导出真正对称）：整份对象读入——原白名单会静默丢
        // cashflows/targetAlloc/layerOverrides/thesisFlags/kellyEvals 等键；缺失字段走默认值
        STATE = applyStateDefaults(Object.assign({}, imported));
        saveState(); alert('导入成功'); render();
      } catch (err) { alert('导入失败：文件格式不正确'); }
    };
    reader.readAsText(file);
  };
  dataCard.querySelector('#dm-clear').onclick = () => {
    if (!confirm('确定清空全部持仓、资产与设置？（清空前会记入「修改日志」，可从那里还原资产/持仓）')) return;
    logOp('清空全部数据（覆盖前）');
    STATE = buildEmptyState();
    saveState();
    render();
  };

  // —— 修改日志 · 一键还原（误删/录错的后悔药）——
  // 两类还原点合并按时间排：①操作级（日志上线后每个关键操作前留底）；
  // ②每日快照（含明细的历史快照，覆盖日志上线【之前】的历史——一天一个还原点）
  const oplog = loadOplog();
  const fmtTs = ts => { const d = new Date(ts); return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
  const opPoints = oplog.map((e, i) => ({ kind: 'op', ts: e.ts, label: e.label || '数据修改', nA: (e.assets || []).length, nP: (e.positions || []).length, ref: i }));
  const snapPoints = (STATE.snapshots || []).filter(sn => sn.assets && sn.assets.length)
    .map(sn => ({ kind: 'snap', ts: new Date(sn.date + 'T23:59:59').getTime(), label: '每日快照 ' + sn.date, nA: sn.assets.length, nP: (sn.positions || []).length, ref: sn.date }))
    .sort((a, b) => b.ts - a.ts).slice(0, 21);            // 最近3周的快照点，更早的用「数据管理→恢复到该日」
  const points = opPoints.concat(snapPoints).sort((a, b) => b.ts - a.ts);
  const logCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('book')} 修改日志 · 一键还原</h3>
    <p class="hint">每次<strong>增删改资产/持仓、赎回记账、出入金、导入/清空</strong>前，系统自动留存当时的资产+持仓+出入金副本（本设备保存最近 30 条）。更早的历史（日志功能上线前）以<strong>每日快照</strong>形式提供——一天一个还原点。误删或录错 → 点「还原」。还原只覆盖资产/持仓${''}（操作级还原另含出入金），不动设置、快照历史与评估缓存；还原本身也会先留底，可再次反悔。</p>
    ${points.length ? `<div class="table-scroll"><table class="stack-mobile">
      <thead><tr><th>时间</th><th>还原点</th><th class="num">当时资产/持仓数</th><th></th></tr></thead>
      <tbody>${points.map((p, i) => `<tr>
        <td style="white-space:nowrap">${p.kind === 'snap' ? escapeHtml(String(p.ref)) : fmtTs(p.ts)}</td>
        <td>${p.kind === 'snap' ? '<span class="pill gray">快照</span> ' : '<span class="pill green">操作</span> '}${escapeHtml(p.label)}</td>
        <td class="num">${p.nA} / ${p.nP}</td>
        <td class="num"><button class="btn secondary small" data-oprestore="${i}">还原到此${p.kind === 'snap' ? '日' : '前'}</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : '<p class="inline-note">暂无还原点。之后每次增删改资产/持仓都会自动留底；每天也会自动记快照。</p>'}</div>`);
  logCard.querySelectorAll('[data-oprestore]').forEach(b => b.onclick = () => {
    const p = points[+b.dataset.oprestore];
    if (!p) return;
    if (p.kind === 'op') {
      const e = oplog[p.ref];
      if (!e) return;
      if (!confirm(`还原到「${e.label}」执行之前（${fmtTs(e.ts)}）？\n将用当时的副本覆盖当前 资产(${(e.assets||[]).length}) / 持仓(${(e.positions||[]).length}) / 出入金(${(e.cashflows||[]).length}) ——此时间点之后的相关修改都会被撤销。\n（还原本身也会先留底，可再次反悔。）`)) return;
      logOp('还原前留底（还原到 ' + fmtTs(e.ts) + '「' + (e.label || '') + '」之前）');
      if (restoreOp(e)) { alert('已还原。'); render(); }
    } else {
      const snap = (STATE.snapshots || []).find(sn => sn.date === p.ref);
      if (!snap) return;
      if (!confirm(`用 ${p.ref} 的每日快照覆盖当前资产与持仓？（出入金与快照历史不受影响；还原前会先留底，可反悔。）`)) return;
      logOp('还原前留底（还原到每日快照 ' + p.ref + '）');
      if (restoreFromSnapshot(snap)) { alert('已还原到 ' + p.ref + '。'); render(); }
      else alert('该快照没有明细副本，无法恢复');
    }
  });
  app.appendChild(logCard);
};

/* =========================================================================
   视图：投资组合总览 + AI 深度点评（DeepSeek）
   ========================================================================= */
function sumBy(assets, keyFn) {
  const m = {};
  assets.forEach(a => { const k = keyFn(a); m[k] = (m[k] || 0) + a.cny; });
  return m;
}
function normalize(map) {
  const t = Object.values(map).reduce((s, v) => s + v, 0) || 1;
  const o = {}; Object.keys(map).forEach(k => o[k] = map[k] / t); return o;
}

// 轻量 Markdown → HTML（用于渲染 AI 返回）
function mdLite(t) {
  const esc = escapeHtml(t);
  return esc
    .replace(/^###?\s*(.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-•]\s*(.+)$/gm, '· $1')
    .replace(/\n/g, '<br>');
}

/* 宽容 JSON 解析：模型输出可能被 max_tokens 截断在数组中间（典型报错
   "Expected ',' or ']' after array element"），或裹着 ```json 围栏、带前后说明文字。
   策略：剥围栏 → 直接解析 → 取到最后一个 '}' 再解析 → 逐步回退到最后一个完整元素并按括号栈补齐。
   截断修复只丢弃尾部不完整的那一条，前面已解析出的条目照常可用。 */
function parseLooseJSON(text) {
  let s = String(text == null ? '' : text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const i = s.indexOf('{');
  if (i < 0) throw new Error('AI 未返回 JSON');
  s = s.slice(i);
  try { return JSON.parse(s); } catch (e) {}
  const j = s.lastIndexOf('}');
  if (j > 0) { try { return JSON.parse(s.slice(0, j + 1)); } catch (e) {} }
  // 截断修复：两轮。第一轮只在【已闭合的结构】边界('}' / ']')处切，保证丢掉的是整条不完整元素、
  // 不会留下 {"i":2} 这种半截对象；第一轮无解才放宽到字符串/数字结尾。
  const tryCut = (endsOk) => {
    for (let end = s.length; end > 1; end--) {
      if (!endsOk(s[end - 1])) continue;
      const cand = s.slice(0, end);
      let inStr = false, esc = false; const st = [];
      for (let k = 0; k < cand.length; k++) {
        const ch = cand[k];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { if (inStr) esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{' || ch === '[') st.push(ch);
        else if (ch === '}' || ch === ']') st.pop();
      }
      if (inStr || !st.length) continue;
      let fix = cand;
      for (let k = st.length - 1; k >= 0; k--) fix += (st[k] === '{' ? '}' : ']');
      try { return JSON.parse(fix); } catch (e) {}
    }
    return null;
  };
  const a1 = tryCut(c => c === '}' || c === ']');
  if (a1) return a1;
  const a2 = tryCut(c => c === '"' || (c >= '0' && c <= '9'));
  if (a2) return a2;
  throw new Error('AI 返回的 JSON 不完整且无法修复');
}
// 通用：调 DeepSeek 并要求返回 JSON（容忍 ```json 包裹、前后说明、以及被截断的输出）
async function aiChatJSON(sys, user, opts) {
  opts = opts || {};
  // DeepSeek 这类推理模型会先输出思考过程再给正文：max_tokens 给少了，
  // 预算被思考吃光 → message.content 为空（界面上就是"AI 返回为空"）；
  // 给得不够多则正文写到一半被砍 → JSON 截断在数组中间。
  // 故：内部自动重试，逐次加倍预算；正文为空时兜底读 reasoning_content（模型常把 JSON 先写在那里）。
  let mt = opts.maxTokens || 1200;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const body = {
      model: AI_MODEL, stream: false,
      temperature: opts.temperature != null ? opts.temperature : 0.15,
      max_tokens: mt,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    };
    if (opts.seed != null) body.seed = opts.seed;   // 固定种子 → 同输入尽量同输出（降低波动）
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const t = await res.text(); throw new Error('接口返回 ' + res.status + '：' + t.slice(0, 160)); }
    const data = await res.json();
    const c0 = data && data.choices && data.choices[0];
    const msg = c0 && c0.message;
    let content = (msg && msg.content) || '';
    if (!String(content).trim() && msg && msg.reasoning_content) content = msg.reasoning_content;
    if (String(content).trim()) {
      try { return parseLooseJSON(content); }
      catch (e) { lastErr = new Error(e.message + (c0 && c0.finish_reason ? '（finish_reason=' + c0.finish_reason + '）' : '')); }
    } else {
      lastErr = new Error('AI 返回为空' + (c0 && c0.finish_reason ? '（finish_reason=' + c0.finish_reason + '，多为 max_tokens 被思考过程耗尽）' : ''));
    }
    if (mt >= 4000) break;
    mt = Math.min(mt * 2, 4000);                    // 多半是预算不够：加倍再试
  }
  throw lastErr || new Error('AI 调用失败');
}

const AI_REVIEW_CACHE = {};   // 会话内缓存：同一摘要复用，保证同日同组合点评一致（可复现）
async function aiReview(summaryText, computedScore, box, btn) {
  const sys = '你是一位严谨、以风险控制为先、擅长资产配置的个人投资组合顾问。'
    + '下面给你【工具已算好的客观事实与健康分】和【用户目标语境】。请用中文给出：'
    + '（1）用 1–2 句解释这个健康分为什么是 ' + computedScore + '（引用给定的扣分/达标项，不要另造分数、不要自己重新打分）；'
    + '（2）结合用户的期限/风险承受/流动性需求，给出 3–4 条最关键的结构性风险（大类失衡、单一因子/beta 集中、币种/汇率敞口、回撤敞口、流动性等），并说明为什么对"这个用户"重要；'
    + '（3）3–5 条具体、可执行的调整建议，尽量落到大类或标的层面，并与用户目标挂钩。'
    + '硬性要求：只依据给定数据推理，不得编造任何数字或事实，缺少的信息就直说"数据不足"；不预测涨跌、不荐股、不承诺收益；用简洁小标题分段。';
  // 会话缓存键：摘要+分数（同输入→同输出，消除"每次点评都不一样"）
  const cacheKey = computedScore + '|' + summaryText;
  btn.disabled = true;
  const oldHtml = btn.innerHTML;
  btn.innerHTML = icon('refresh', 'spin') + ' 正在分析…';
  box.innerHTML = '<div class="inline-note">正在请求 DeepSeek 分析你的组合，请稍候（约 10–30 秒）…</div>';
  try {
    let content = AI_REVIEW_CACHE[cacheKey];
    if (!content) {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: AI_MODEL,
          stream: false,
          temperature: 0.2,       // 低温 → 稳定可复现
          max_tokens: 1800,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: summaryText },
          ],
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error('接口返回 ' + res.status + '：' + t.slice(0, 200));
      }
      const data = await res.json();
      content = data && data.choices && data.choices[0] &&
        data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('返回内容为空');
      AI_REVIEW_CACHE[cacheKey] = content;
    }
    box.innerHTML = `<div class="alert blue"><span class="icon">${icon('sparkles')}</span>
      <div><strong>DeepSeek 组合点评</strong>（解读上方客观健康分 ${computedScore}/100 · AI 生成仅供参考、非投资建议）</div></div>
      <div class="ai-output">${mdLite(content)}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="alert amber"><span class="icon">${icon('warn')}</span><div>
      <strong>AI 点评暂不可用</strong>：${escapeHtml(e.message)}<br>
      请检查：① 已在 GitHub 配置 <code class="formula">DEEPSEEK_API</code> 并重新部署；
      ② 服务器能访问 api.deepseek.com；③ 模型串 <code class="formula">${AI_MODEL}</code> 正确。
      下方本地量化诊断不受影响。</div></div>`;
  } finally {
    btn.disabled = false; btn.innerHTML = oldHtml;
  }
}

/* =========================================================================
   视图：资产趋势（以 7/19 为起点的每日快照 → 按月/季/年看整体走势）
   ========================================================================= */
function periodKey(dateStr, gran) {
  const [y, m] = dateStr.split('-').map(Number);
  if (gran === 'year') return { key: String(y), label: y + '年' };
  if (gran === 'quarter') { const q = Math.floor((m - 1) / 3) + 1; return { key: y + '-Q' + q, label: y + ' Q' + q }; }
  return { key: y + '-' + String(m).padStart(2, '0'), label: y + '/' + String(m).padStart(2, '0') };
}

VIEWS.trends = function (app) {
  const snaps = (STATE.snapshots || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  app.appendChild(el(`
    <div class="view-head">
      <h2>资产趋势</h2>
      <p>自 ${SEED_DATE} 起，每次打开应用记录一份当日快照并同步云端。可按月 / 季度 / 自然年查看整体资产走势与阶段变化。</p>
    </div>
  `));

  if (snaps.length < 1) {
    app.appendChild(el(`<div class="card"><div class="empty"><div class="big">${icon('chart')}</div>
      <p>还没有快照数据。载入初始数据或添加资产后，打开应用即会自动记录。</p></div></div>`));
    return;
  }

  const first = snaps[0], last = snaps[snaps.length - 1];

  // 分析维度：总资产 / 各大类 / 各类别（快照里已存 byBig、byCat）
  const bigKeys = [], catKeys = [], seenB = new Set(), seenC = new Set();
  snaps.forEach(s => {
    Object.keys(s.byBig || {}).forEach(k => { if (!seenB.has(k)) { seenB.add(k); bigKeys.push(k); } });
    Object.keys(s.byCat || {}).forEach(k => { if (!seenC.has(k)) { seenC.add(k); catKeys.push(k); } });
  });
  const dims = [{ key: 'total', label: '总资产（汇总）', short: '总资产' }]
    .concat(bigKeys.map(k => ({ key: 'big:' + k, label: '大类 · ' + k, short: k })))
    .concat(catKeys.map(k => ({ key: 'cat:' + k, label: '类别 · ' + k, short: k })));
  const dimValue = (s, dim) => dim === 'total' ? num(s.total)
    : dim.slice(0, 4) === 'big:' ? num((s.byBig || {})[dim.slice(4)])
    : num((s.byCat || {})[dim.slice(4)]);
  const dimShort = (dim) => (dims.find(d => d.key === dim) || dims[0]).short;
  let curDim = 'total', curGran = 'day';
  // 基准对比：可多选叠加。benchLoaded[key] = {label,color,series}；benchDiag[key] = 候选源原始返回
  const benchLoaded = {}, benchDiag = {};
  let benchKeys = ((STATE.settings || {}).benchKeys || []).filter(k => BENCH_BY_KEY[k]);

  const overviewBox = el('<div class="stat-grid" style="margin-bottom:16px"></div>');
  app.appendChild(overviewBox);

  // 趋势图卡（维度 + 粒度切换）
  const chartCard = el(`<div class="card">
    <div class="card-head-row">
      <h3 style="margin:0">${icon('chart')} <span id="chart-title">总资产</span>走势</h3>
      <div class="row" style="gap:8px;flex:0 0 auto;align-items:center;flex-wrap:wrap">
        <select id="dim-sel" style="width:auto;min-width:120px">${dims.map(d => `<option value="${d.key}">${escapeHtml(d.label)}</option>`).join('')}</select>
        <div class="seg" id="gran-seg">
          <button class="seg-btn active" data-g="day">日</button>
          <button class="seg-btn" data-g="month">月</button>
          <button class="seg-btn" data-g="quarter">季度</button>
          <button class="seg-btn" data-g="year">自然年</button>
        </div>
      </div>
    </div>
    <div class="row" id="bench-chips" style="gap:6px;flex-wrap:wrap;margin-top:10px"></div>
    <div id="trend-chart" style="margin-top:14px"></div>
    <div id="bench-legend" class="inline-note" style="margin-top:8px"></div>
    <div id="bench-diag"></div>
    <p class="inline-note" style="margin-top:10px">切换「维度」可分别看总资产或某个大类/类别（如权益、基金、黄金）随时间的走势。<strong>鼠标移到折线上</strong>可查看任一日期的数值，及较昨日 / 较上月 / 较期初累计的变化——<strong>多选基准时提示框会逐条列出每个基准</strong>。基准对比在「日」粒度 +「总资产」维度下生效：组合按 TWR 指数化（剔除出入金），与各基准同起点归一（起点=100）。<br>
      <strong>注意：这条是「总资产净值线」，不是收益线。</strong>入金会把它抬上去、出金会把它压下去——那是本金搬家，不是赚赔。有流水的那天，提示框会单列「其中入金/出金」与「剔除后净投资变化」；想看纯投资表现，勾一条基准切到 <strong>TWR 指数</strong>，或看上方的收益率(TWR)。</p>
  </div>`);
  app.appendChild(chartCard);

  // —— 基准多选（点亮即叠加；结果与选择都持久化）——
  const chipsBox = chartCard.querySelector('#bench-chips');
  function drawBenchChips(busyKey) {
    chipsBox.innerHTML = `<span class="inline-note" style="align-self:center">对比基准（可多选）</span>` + BENCHMARKS.map(b => {
      const on = benchKeys.indexOf(b.key) >= 0;
      const failed = on && benchLoaded[b.key] === null;
      const busy = b.key === busyKey;
      const style = on && !failed
        ? `background:${b.color}22;color:${b.color};border:1px solid ${b.color}`
        : failed ? 'background:rgba(255,59,48,.10);color:var(--red-ink);border:1px solid rgba(255,59,48,.4)'
        : 'background:rgba(120,120,128,.10);color:var(--muted);border:1px solid rgba(120,120,128,.25)';
      return `<button data-bk="${b.key}" style="${style};font:inherit;font-size:12.5px;font-weight:600;padding:4px 10px;border-radius:999px;cursor:pointer">${busy ? '…' : (on && !failed ? '━ ' : '')}${escapeHtml(b.label)}${failed ? ' ✕' : ''}</button>`;
    }).join('');
    chipsBox.querySelectorAll('[data-bk]').forEach(btn => btn.onclick = () => toggleBench(btn.dataset.bk));
  }
  async function toggleBench(key) {
    const i = benchKeys.indexOf(key);
    if (i >= 0) { benchKeys.splice(i, 1); delete benchLoaded[key]; delete benchDiag[key]; }
    else {
      benchKeys.push(key);
      if (!benchLoaded[key]) {
        drawBenchChips(key);
        const b = BENCH_BY_KEY[key];
        try {
          const r = await fetchBenchmarkSeries(key);
          benchDiag[key] = r.diag;
          benchLoaded[key] = r.series.length ? { label: b.label + (r.via ? '(' + r.via + ')' : ''), color: b.color, series: r.series, via: r.via } : null;
        } catch (e) { benchDiag[key] = ['异常:' + e.message]; benchLoaded[key] = null; }
      }
    }
    STATE.settings.benchKeys = benchKeys.slice(); saveState();
    drawBenchChips(); redraw();
  }
  drawBenchChips();
  // 复选状态持久化后重进页面：自动把已选基准重新加载
  benchKeys.slice().forEach(async k => {
    const b = BENCH_BY_KEY[k];
    try {
      const r = await fetchBenchmarkSeries(k);
      benchDiag[k] = r.diag;
      benchLoaded[k] = r.series.length ? { label: b.label + (r.via ? '(' + r.via + ')' : ''), color: b.color, series: r.series, via: r.via } : null;
    } catch (e) { benchDiag[k] = ['异常:' + e.message]; benchLoaded[k] = null; }
    drawBenchChips(); redraw();
  });

  // 出入金登记：修正「净值变化 ≠ 真实收益率」——转入转出会让趋势/归因失真，登记后 TWR 自动剔除
  const cfCard = el(`<div class="card" style="margin-top:16px">
    <h3>${icon('wallet')} 出入金登记</h3>
    <p class="hint">转入/转出资金会让「净值变化」失真（多出来的钱可能只是你新加的仓，不是赚的）。在这里登记后，上方「收益率(TWR)」会自动剔除这些流水，反映真实投资表现。<strong>正数 = 入金，负数 = 出金</strong>（人民币）。</p>
    <div class="grid grid-3">
      <div class="field"><label>日期</label><input id="cf-date" type="date" value="${todayStr()}"/></div>
      <div class="field"><label>金额（+入金 / −出金）</label><input id="cf-amount" type="number" step="100" placeholder="如 50000 或 -20000"/></div>
      <div class="field"><label>备注（可选）</label><input id="cf-note" placeholder="如 工资加仓"/></div>
    </div>
    <div class="field" style="margin-bottom:8px">
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer">
        <input type="checkbox" id="cf-sync" style="width:auto"/>
        <span>同时把这笔钱计入下面这个资产（钱真的进/出了账户就勾上）</span>
      </label>
      <select id="cf-sync-to" style="margin-top:7px;display:none"></select>
      <p class="inline-note" id="cf-sync-note" style="margin-top:6px">出入金登记只修正<strong>收益率口径</strong>（TWR / 基准对比 / 收益归因），<strong>不会改总资产</strong>。
        钱实际到账了就勾上同步，否则总资产会少算这笔——两边都记，账才是对的。</p></div>
    <div class="row"><button class="btn" id="cf-add" style="flex:0 0 auto">${icon('plus')} 登记</button></div>
    <div class="table-scroll" style="margin-top:12px"><table id="cf-table"></table></div>
  </div>`);
  app.appendChild(cfCard);
  function drawCfTable() {
    const list = (STATE.cashflows || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    const t = cfCard.querySelector('#cf-table');
    t.innerHTML = list.length
      ? `<thead><tr><th>日期</th><th class="num">金额</th><th>是否动总资产</th><th>备注</th><th class="num"></th></tr></thead><tbody>${list.map(c => `<tr>
          <td>${escapeHtml(c.date)}</td>
          <td class="num" style="color:${num(c.amount)>=0?'var(--green-ink)':'var(--red-ink)'}">${num(c.amount)>=0?'+':''}${fmtMoney(c.amount)}</td>
          <td>${c.synced
              ? `<span class="tag-chip">已同步 ${escapeHtml(c.syncTo || '资产')}</span>`
              : '<span class="inline-note">仅算收益率</span>'}</td>
          <td>${escapeHtml(c.note || '')}</td>
          <td class="num"><button class="btn danger small" data-cfdel="${c.id}">${icon('trash')}</button></td>
        </tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="inline-note" style="padding:10px">暂无登记。发生过转入/转出就记一笔，TWR 才是你的真实收益率。</td></tr></tbody>';
    t.querySelectorAll('[data-cfdel]').forEach(b => b.onclick = async () => {
      if (!confirm('删除这条出入金记录？（只影响收益率口径，不动资产）')) return;
      logOp('删除出入金记录');
      STATE.cashflows = (STATE.cashflows || []).filter(c => c.id !== b.dataset.cfdel);
      saveState(); await pushCloudNow(); render();
    });
  }
  // 同步目标：人民币现金/理财类资产（出入金登记的金额口径是人民币，故只列 CNY 资产）
  // ＋一个「新建/并入股票现金池」兜底选项，避免一个可用目标都没有。
  const syncTargets = (STATE.assets || []).filter(a => a.currency !== 'USD'
    && (/现金|理财|存款/.test(a.category || '') || /现金|活期|余额|零钱|货基/.test(a.name || '')));
  const syncSel = cfCard.querySelector('#cf-sync-to');
  syncSel.innerHTML = syncTargets.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}（当前 ${fmtMoney(num(a.amount))}）</option>`).join('')
    + `<option value="__pool__">${escapeHtml(poolName('CNY'))}（自动现金池，没有则新建）</option>`;
  const syncCb = cfCard.querySelector('#cf-sync');
  syncCb.onchange = () => {
    syncSel.style.display = syncCb.checked ? '' : 'none';
    cfCard.querySelector('#cf-sync-note').innerHTML = syncCb.checked
      ? '勾选后：登记的同时把金额加/减到上面这个资产，总资产与收益率口径一次对齐。'
      : '出入金登记只修正<strong>收益率口径</strong>（TWR / 基准对比 / 收益归因），<strong>不会改总资产</strong>。钱实际到账了就勾上同步，否则总资产会少算这笔。';
  };

  cfCard.querySelector('#cf-add').onclick = async () => {
    const date = cfCard.querySelector('#cf-date').value;
    const amount = num(cfCard.querySelector('#cf-amount').value);
    const note = cfCard.querySelector('#cf-note').value.trim();
    if (!date) { alert('请选择日期'); return; }
    if (!(isFinite(amount) && amount !== 0)) { alert('请填写非零金额（正=入金，负=出金）'); return; }
    const doSync = syncCb.checked;
    const target = syncSel.value;
    const tgtAsset = target === '__pool__' ? null : (STATE.assets || []).find(a => a.id === target);
    const tgtName = target === '__pool__' ? poolName('CNY') : (tgtAsset || {}).name || '所选资产';
    if (doSync) {
      // 出金必须扣得动：余额不足时宁可拒绝，也不能截断到 0——那会让「流水记了 3424、总资产只少 1000」，
      // 差额凭空消失，之后 TWR 会把这块当成亏损。
      const avail = target === '__pool__' ? stockCashPoolBalance('CNY') : num((tgtAsset || {}).amount);
      if (amount < 0 && -amount > avail + 0.005) {
        alert(`「${tgtName}」当前只有 ${fmtMoney(avail)}，扣不出 ${fmtMoney(-amount)}。\n\n`
          + `请改选余额足够的账户，或先在「投资组合」把钱归到正确的账户再登记；\n`
          + `若这笔钱本就是从别处转出的，就选那个账户。（强行扣会让总资产少算 ${fmtMoney(-amount - avail)}）`);
        return;
      }
      if (!confirm(`登记出入金 ${fmtMoney(amount)}，并${amount >= 0 ? '增加' : '减少'}资产「${tgtName}」${fmtMoney(Math.abs(amount))}。\n\n`
        + `若这笔钱你已经在「投资组合」里改过金额了，请点取消——否则会重复计算。\n确认同步？`)) return;
    }
    logOp('登记出入金：' + date + ' ' + fmtMoney(amount) + (doSync ? '（同步资产）' : ''));
    // synced/syncTo 只作留痕：流水表里标出来，一眼看得出这笔钱动没动总资产（不勾就只改收益率口径）
    (STATE.cashflows = STATE.cashflows || []).push({ id: uid(), date, amount, note,
      synced: !!doSync, syncTo: doSync ? tgtName : '' });
    if (doSync) {
      if (target === '__pool__') {
        settleToPool(amount, 'CNY', (amount >= 0 ? '入金' : '出金') + (note ? '·' + note : ''));
      } else if (tgtAsset) {
        tgtAsset.amount = Math.max(0, Math.round((num(tgtAsset.amount) + amount) * 100) / 100);
        tgtAsset.cny = Math.round(assetCny(tgtAsset, currentFx()));
        if (!(num(tgtAsset.amount) > 0)) tgtAsset.shares = 0;   // 清零时同步清份额（与资产表单同口径）
      }
      recordDailySnapshot();       // 总资产变了 → 覆盖今日快照，趋势/TWR 才用到新值
    }
    saveState(); await pushCloudNow(); render();
  };
  drawCfTable();

  // 阶段变化表
  const tableCard = el(`<div class="card" style="margin-top:16px">
    <h3>${icon('calendar')} 阶段变化</h3>
    <div class="table-scroll"><table id="period-table"></table></div>
    <p class="inline-note">阶段变化% = 期末 ÷ 期初 − 1（按上方所选维度取值）。因未单独区分资金转入/转出，此处为「净值」变化，非纯投资收益率，仅作趋势参考。</p>
  </div>`);
  app.appendChild(tableCard);

  // 快照管理
  const mgmt = el(`<div class="card" style="margin-top:16px">
    <h3>${icon('globe')} 快照数据（云端同步）</h3>
    <p class="hint">全部数据（含快照）都同步到你自己的服务器（与全站同一访问密码保护），换设备或清缓存后自动恢复；若今日资产已更新，可手动记录一份覆盖当日。</p>
    <div class="cloud-status" id="cloud-status">
      <span class="cloud-dot" style="background:${cloudDotColor()}"></span>
      <span id="cloud-status-text">${escapeHtml(cloudStatusText())}</span>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="snap-now" style="flex:0 0 auto">${icon('plus')} 记录今日并同步</button>
      <button class="btn secondary" id="snap-sync" style="flex:0 0 auto">${icon('refresh')} 从云端同步</button>
      <button class="btn secondary" id="snap-export" style="flex:0 0 auto">${icon('download')} 导出(JSON)</button>
    </div>
    <div class="section-divider"></div>
    <div class="mini-label">快照修正（某天数值不对可直接改总资产，或删掉整条）</div>
    <div class="table-scroll"><table id="snap-list">
      <thead><tr><th>日期</th><th class="num">总资产</th><th class="num">含明细</th><th class="num">操作</th></tr></thead>
      <tbody>${snaps.slice().reverse().map(s => `<tr>
        <td>${s.date}</td>
        <td class="num">${fmtMoney(s.total)}</td>
        <td class="num">${s.assets && s.assets.length ? '<span class="pill green">可恢复</span>' : '<span class="pill gray">仅数值</span>'}</td>
        <td class="num">
          <button class="btn secondary small" data-snapfix="${s.date}">${icon('pencil')} 修正</button>
          <button class="btn danger small" data-snapdel="${s.date}">${icon('trash')}</button>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="inline-note">「修正」只改这一天记录的总资产数值（用于趋势图/阶段表）；「含明细＝可恢复」表示该快照存有当天的资产明细，可在「设置 → 数据管理」按日期整体恢复。</p>
  </div>`);
  app.appendChild(mgmt);

  // 快照修正 / 删除
  mgmt.querySelectorAll('[data-snapfix]').forEach(b => b.onclick = async () => {
    const d = b.dataset.snapfix;
    const snap = (STATE.snapshots || []).find(s => s.date === d);
    if (!snap) return;
    const input = prompt(`修正 ${d} 的总资产（元）：`, snap.total);
    if (input == null) return;
    const v = num(input);
    if (!(v > 0)) { alert('请输入大于 0 的数字'); return; }
    snap.total = Math.round(v);
    snap.corrected = true;                     // 标记人工修正过
    saveState();
    await pushCloudNow();
    render();
  });
  mgmt.querySelectorAll('[data-snapdel]').forEach(b => b.onclick = async () => {
    const d = b.dataset.snapdel;
    if (!confirm(`删除 ${d} 的快照？（不影响当前资产，只删这天的历史记录）`)) return;
    STATE.snapshots = (STATE.snapshots || []).filter(s => s.date !== d);
    saveState();
    await pushCloudNow();
    render();
  });

  function aggregate(gran, dim) {
    if (gran === 'day') return snaps.map(s => ({ label: s.date.slice(5), value: dimValue(s, dim), date: s.date }));
    const groups = new Map();
    snaps.forEach(s => {
      const { key, label } = periodKey(s.date, gran);
      const v = dimValue(s, dim);
      groups.set(key, { label, last: v, first: groups.has(key) ? groups.get(key).first : v, date: s.date });
    });
    return [...groups.values()].map(g => ({ label: g.label, value: g.last, first: g.first, date: g.date }));
  }

  function drawChart(gran, dim) {
    const legend = chartCard.querySelector('#bench-legend');
    const diagBox = chartCard.querySelector('#bench-diag');
    const box = chartCard.querySelector('#trend-chart');
    box.innerHTML = '';
    // 失败基准的诊断（原始返回）——供校准 secid，成功的不占地方
    const failed = benchKeys.filter(k => benchLoaded[k] === null);
    diagBox.innerHTML = failed.length
      ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px;color:var(--red-ink)">${failed.length} 个基准拉取失败（${failed.map(k => escapeHtml(BENCH_BY_KEY[k].label)).join('、')}）— 点击看原始返回</summary>
          <div class="table-scroll"><table class="stack-mobile"><thead><tr><th>基准</th><th>各候选源返回</th></tr></thead><tbody>
          ${failed.map(k => `<tr><td style="white-space:nowrap">${escapeHtml(BENCH_BY_KEY[k].label)}</td><td style="font-size:11px;font-family:monospace;word-break:break-all">${escapeHtml((benchDiag[k] || []).join('  ‖  '))}</td></tr>`).join('')}
          </tbody></table></div></details>`
      : '';
    const active = benchKeys.map(k => benchLoaded[k]).filter(Boolean);
    // 基准对比模式：日粒度 + 总资产 + 至少一个基准已加载 → 组合(TWR 指数化) vs 各基准，同起点=100
    if (active.length && gran === 'day' && dim === 'total') {
      const mine = twrIndexSeries(snaps).map(p => ({ label: p.date.slice(5), date: p.date, value: p.value }));
      const refs = active.map(b => ({ name: b.label, color: b.color, points: alignBenchmark(snaps, b.series) }));
      const mRet = mine[mine.length - 1].value - 100;
      legend.innerHTML = `<span style="color:var(--accent)">━</span> <strong>组合(TWR) ${mRet >= 0 ? '+' : ''}${fmtPct(mRet, 2)}</strong>　` +
        refs.map(r => {
          const bRet = r.points[r.points.length - 1].value - 100, ex = mRet - bRet;
          return `<span style="color:${r.color}">━</span> ${escapeHtml(r.name)} ${bRet >= 0 ? '+' : ''}${fmtPct(bRet, 2)}` +
            `<span style="color:${ex >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">（超额 ${ex >= 0 ? '+' : ''}${fmtPct(ex, 2)}）</span>`;
        }).join('　') + '　<span style="color:var(--muted)">起点=100</span>'
        + (refs.some(r => /\(/.test(r.name)) ? '<br><span style="color:var(--muted);font-size:11px">带括号的基准用跟踪 ETF 代表该指数（含分红再投的全收益口径，与你含分红利息的 TWR 比更公平；纯价格指数会低估基准约 1.3%/年）。</span>' : '');
      box.appendChild(buildLineChart(mine, { extra: refs, tooltip: (i) => trendTip(i, mine, gran, true, refs) }));
      return;
    }
    legend.textContent = benchKeys.length ? '基准对比仅在「日」粒度 +「总资产」维度下显示。' : '';
    const pts = aggregate(gran, dim);
    box.appendChild(buildLineChart(pts, { tooltip: (i) => trendTip(i, pts, gran, false, null, dim) }));
  }

  // 悬停提示：当日数值 ＋ 较昨日（日粒度）/较上一期 ＋ 较上月（日粒度，30 天前最近点）＋ 较期初累计
  // refs：叠加的基准序列，每条按同一口径逐条列出（当日点位 / 较前一日 / 累计），便于横向对比
  function trendTip(i, pts, gran, indexMode, refs, dimKey) {
    // 某序列在第 i 点的三项对比（返回 HTML 行数组）
    const cmpRows = (series, mode, prefix) => {
      const p = series[i];
      if (!p || !isFinite(p.value)) return [];
      const rows = [];
      const cmp = (label, ref) => {
        if (!(ref > 0)) return;
        const d = p.value - ref, pc = d / ref * 100;
        const col = d >= 0 ? 'var(--green-ink)' : 'var(--red-ink)';
        rows.push(`<div style="color:${col}">${prefix}${label} ${d >= 0 ? '+' : ''}${mode ? (+d).toFixed(2) + ' 点' : fmtMoney(d)}（${d >= 0 ? '+' : ''}${fmtPct(pc, 2)}）</div>`);
      };
      if (i > 0) cmp(gran === 'day' ? '较昨日' : '较上一期', series[i - 1].value);
      if (gran === 'day' && p.date && i > 0) {
        // 本地时区做日期减法（原 toISOString 走 UTC，跨时区会偏一天）
        const d0 = new Date(p.date + 'T00:00:00'); d0.setDate(d0.getDate() - 30);
        const cutoff = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
        for (let j = i - 1; j >= 0; j--) {
          if ((series[j].date || '') <= cutoff) { cmp('较上月', series[j].value); break; }
        }
      }
      if (i > 0) cmp('较期初累计', series[0].value);
      return rows;
    };
    const p = pts[i];
    // indexMode：TWR 指数序列（起点=100），显示"点数"而非人民币金额
    const fmtV = v => indexMode ? (+v).toFixed(2) + ' 点' : fmtMoney(v);
    let html = `<div style="font-weight:600">${escapeHtml(p.date || p.label)}</div>`;
    const list = (refs && refs.length) ? refs : [];
    // 主序列（组合）
    html += `<div style="margin:2px 0 3px"><span style="color:var(--accent)">━</span> <strong>${list.length ? '组合(TWR) ' : ''}${fmtV(p.value)}</strong>${indexMode && !list.length ? '<span style="color:var(--muted);font-size:11px">（TWR指数·起点100）</span>' : ''}</div>`;
    const mineRows = cmpRows(pts, indexMode, '');
    html += mineRows.join('') || (list.length ? '' : '<div style="color:var(--muted)">首个数据点</div>');
    // 出入金拆分：总资产线本来就该随入金上抬，但那不是「赚的」。把当区间的流水单列出来，
    // 并给出剔除后的净投资变化，省得看到线往上翘就以为是收益。仅日粒度+总资产口径（流水按人民币总额登记）。
    if (!indexMode && gran === 'day' && dimKey === 'total' && i > 0 && pts[i].date && pts[i - 1].date) {
      const cf = cashflowBetween(pts[i - 1].date, pts[i].date);
      if (Math.abs(cf) > 0.5) {
        const net = (pts[i].value - pts[i - 1].value) - cf;
        html += `<div style="margin-top:4px;border-top:1px dashed rgba(127,127,127,.35);padding-top:4px;font-size:12px">
          <div style="color:var(--muted)">其中${cf >= 0 ? '入金' : '出金'} ${cf >= 0 ? '+' : ''}${fmtMoney(cf)}（本金搬家，不是收益）</div>
          <div style="color:${net >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">剔除后净投资变化 ${net >= 0 ? '+' : ''}${fmtMoney(net)}</div>
        </div>`;
      }
    }
    // 各基准逐条
    list.forEach(r => {
      const rp = r.points[i];
      if (!rp || !isFinite(rp.value)) return;
      html += `<div style="margin:5px 0 2px;border-top:1px solid rgba(127,127,127,.25);padding-top:4px"><span style="color:${r.color}">━</span> <strong>${escapeHtml(r.name)} ${(+rp.value).toFixed(2)} 点</strong></div>`;
      html += cmpRows(r.points, true, '').join('');
    });
    if (list.length) html += `<div style="color:var(--muted);font-size:11px;margin-top:4px">全部按起点=100 归一</div>`;
    return html;
  }

  function drawTable(gran, dim) {
    // 阶段变化：按所选粒度分组，展示各期期初/期末/变化（按所选维度取值）
    const g = gran === 'day' ? 'month' : gran;   // 「日」视图下阶段表用「月」汇总更有意义
    const groups = new Map();
    snaps.forEach(s => {
      const { key, label } = periodKey(s.date, g);
      const v = dimValue(s, dim);
      if (!groups.has(key)) groups.set(key, { label, first: v, last: v });
      groups.get(key).last = v;
    });
    const rows = [...groups.values()];
    const table = tableCard.querySelector('#period-table');
    table.innerHTML = `<thead><tr><th>阶段</th><th class="num">期初</th><th class="num">期末</th><th class="num">变化</th><th class="num">变化%</th></tr></thead><tbody>${
      rows.map(r => {
        const d = r.last - r.first, p = r.first ? d / r.first * 100 : null;   // 期初为 0 → 无收益率口径，显示「新增」
        const col = d >= 0 ? 'var(--green-ink)' : 'var(--red-ink)';
        return `<tr><td>${r.label}</td><td class="num">${fmtMoney(r.first)}</td><td class="num">${fmtMoney(r.last)}</td>
          <td class="num" style="color:${col}">${d>=0?'+':''}${fmtMoney(d)}</td>
          <td class="num" style="color:${col}">${p == null ? '新增' : (d>=0?'+':'') + fmtPct(p,2)}</td></tr>`;
      }).join('')
    }</tbody>`;
  }

  function redraw() {
    const f = dimValue(first, curDim), l = dimValue(last, curDim);
    const c = l - f, cp = f ? c / f * 100 : 0;
    const sh = dimShort(curDim);
    chartCard.querySelector('#chart-title').textContent = sh;
    overviewBox.innerHTML = `
      <div class="stat"><div class="label">${icon('wallet')} 当前${escapeHtml(sh)}</div>
        <div class="value" style="font-size:22px">${fmtMoney(l)}</div><div class="sub">截至 ${last.date}</div></div>
      <div class="stat"><div class="label">${icon('calendar')} 起点(${first.date})</div>
        <div class="value" style="font-size:22px">${fmtMoney(f)}</div><div class="sub">首个快照</div></div>
      <div class="stat"><div class="label">${icon('trend')} 累计变化</div>
        <div class="value" style="font-size:22px;color:${c>=0?'var(--green-ink)':'var(--red-ink)'}">${c>=0?'+':''}${fmtMoney(c)}</div>
        <div class="sub" style="color:${c>=0?'var(--green-ink)':'var(--red-ink)'}">${c>=0?'+':''}${fmtPct(cp,2)}</div></div>
      <div class="stat"><div class="label">${icon('list')} 快照数</div>
        <div class="value" style="font-size:22px">${snaps.length}</div><div class="sub">天</div></div>
      ${(() => {
        const t = curDim === 'total' && snaps.length > 1 ? twrOverall(snaps) : null;
        if (!t) return '';
        const tCol = t.twr >= 0 ? 'var(--green-ink)' : 'var(--red-ink)';
        const sub = Math.abs(t.flows) > 0
          ? `已剔除出入金 ${t.flows >= 0 ? '+' : ''}${fmtMoney(t.flows)}`
          : '未登记出入金（有转入转出请在下方补录）';
        return `<div class="stat"><div class="label">${icon('trend')} 收益率(TWR)</div>
          <div class="value" style="font-size:22px;color:${tCol}">${t.twr >= 0 ? '+' : ''}${fmtPct(t.twr, 2)}</div>
          <div class="sub">${sub}</div></div>`;
      })()}`;
    drawChart(curGran, curDim); drawTable(curGran, curDim);
  }

  redraw();
  chartCard.querySelector('#dim-sel').onchange = (e) => { curDim = e.target.value; redraw(); };
  chartCard.querySelectorAll('.seg-btn').forEach(b => {
    b.onclick = () => {
      chartCard.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b));
      curGran = b.dataset.g; redraw();
    };
  });
  mgmt.querySelector('#snap-now').onclick = async () => {
    recordDailySnapshot();          // 写入今日快照并本地保存
    await pushCloudNow();           // 立即回传云端
    render();
  };
  mgmt.querySelector('#snap-sync').onclick = async () => {
    const { changed } = await initCloudSync();   // 从云端拉取整份数据并对账
    render();
    if (!changed) updateCloudBadges();
  };
  mgmt.querySelector('#snap-export').onclick = () => {
    const blob = new Blob([JSON.stringify(STATE.snapshots || [], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'asset-snapshots.json'; a.click();
    URL.revokeObjectURL(url);
  };
};

/* =========================================================================
   视图：再平衡 —— 期限×回撤预设 → 科学目标盘（8层）→ 偏离对照 + 具体调仓执行清单
   ========================================================================= */
VIEWS.rebalance = function (app) {
  const s = STATE.settings;
  const st = currentLayerState();
  const total = st.total;
  const activeId = s.rebalPreset || '3y15';
  const preset = getRebalPreset(activeId);

  app.appendChild(el(`
    <div class="view-head">
      <h2>再平衡</h2>
      <p>选一档你能接受的「投资期限 × 最大回撤」，系统按<strong>压力情景回撤预算</strong>反推科学目标盘（8层），算出当前离目标差多少钱，并生成<strong>具体调仓清单</strong>（卖哪只、几股；补哪层）。再平衡的本质是被动的高卖低买，让风险结构回到你设定的样子。</p>
    </div>`));
  if (!(total > 0)) { app.appendChild(el('<div class="card"><div class="empty"><p>暂无持仓数据。</p></div></div>')); return; }

  const card = el(`<div class="card"><h3>${icon('target')} 战略目标盘（按 期限×回撤 科学校准）</h3>
    <p class="hint">你的三层策略（股票博弹性 / 基金压舱 / 理财兜底）在这里被拆成 8 层对照，美元敞口单列。</p></div>`);

  // 预设选择
  const segRow = el('<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:4px"></div>');
  REBAL_PRESETS.forEach(p => {
    const on = p.id === activeId;
    const btn = el(`<button class="btn ${on ? '' : 'secondary'}" style="flex:0 0 auto">${escapeHtml(p.label)}<br><span style="font-size:11px;opacity:.8">${p.tone}</span></button>`);
    btn.onclick = () => { s.rebalPreset = p.id; s.maxDrawdown = p.maxDD; saveState(); render(); };
    segRow.appendChild(btn);
  });
  card.appendChild(segRow);
  card.appendChild(el(`<p class="inline-note">选中后会同步把「③回撤控制」的可承受回撤设为 <strong>${preset.maxDD}%</strong>，各模块口径一致。期限主要决定兜底/现金厚度（流动性），回撤预算决定风险档。</p>`));

  // 压力回撤对照：当前 vs 目标 vs 预算
  const curDD = estStressDD(st.frac);
  const tgtFrac = {}; LAYER_ORDER.forEach(k => tgtFrac[k] = (preset.t[k] || 0) / 100);
  const tgtDD = estStressDD(tgtFrac);
  const over = curDD > preset.maxDD;
  card.appendChild(el(`<div class="stat-grid" style="margin:12px 0">
    <div class="stat"><div class="label">当前组合·压力回撤估算</div><div class="value" style="font-size:22px;color:${over ? 'var(--red-ink)' : 'var(--green-ink)'}">${curDD.toFixed(1)}%</div><div class="sub">${over ? '超出预算 ' + (curDD - preset.maxDD).toFixed(1) + '%，需减风险' : '在预算内'}</div></div>
    <div class="stat"><div class="label">你的回撤预算</div><div class="value" style="font-size:22px">${preset.maxDD}%</div><div class="sub">${escapeHtml(preset.label)}</div></div>
    <div class="stat"><div class="label">目标盘·压力回撤估算</div><div class="value" style="font-size:22px;color:var(--green-ink)">${tgtDD.toFixed(1)}%</div><div class="sub">已按预算校准</div></div>
    <div class="stat"><div class="label">美元敞口</div><div class="value" style="font-size:22px;color:${st.usdPct > (preset.t.oseas + preset.t.us + 6) ? 'var(--amber-ink)' : 'inherit'}">${st.usdPct.toFixed(0)}%</div><div class="sub">目标约 ${preset.t.oseas + preset.t.us}%（海外固收+美股）</div></div>
  </div>`));
  if (over) card.appendChild(el(`<div class="alert red"><span class="icon">${icon('danger')}</span><div><strong>当前配置的压力回撤 ${curDD.toFixed(1)}% 已超过你 ${preset.maxDD}% 的预算</strong>——按下表减权益、去集中、补兜底，把它压回预算内。</div></div>`));

  // 目标 vs 当前 逐层对照表
  const rows = LAYER_ORDER.map(k => {
    const cur = st.pct[k] || 0, tgt = preset.t[k] || 0, dev = cur - tgt;
    const diffMoney = total > 0 ? dev / 100 * total : 0;
    const locked = st.locked[k] || 0;
    const need = Math.abs(dev) >= 5;                       // 漂移带 ±5%
    const action = dev > 0.5 ? `减 ${fmtMoney(Math.abs(diffMoney))}` : dev < -0.5 ? `补 ${fmtMoney(Math.abs(diffMoney))}` : '基本到位';
    const actColor = dev > 0.5 ? 'var(--amber-ink)' : dev < -0.5 ? 'var(--green-ink)' : 'var(--muted)';
    const badge = need ? `<span class="pill ${dev > 0 ? 'amber' : 'green'}">需调整</span>` : `<span class="pill green">✓</span>`;
    const lockNote = locked > 0 ? `<br><span class="inline-note" style="color:var(--muted)">其中锁定 ${fmtMoney(locked)}</span>` : '';
    return `<tr>
      <td style="white-space:nowrap"><strong>${LAYER_NAME[k]}</strong>${lockNote}</td>
      <td class="num">${tgt}%</td>
      <td class="num">${cur.toFixed(1)}%</td>
      <td class="num" style="color:${dev > 0 ? 'var(--amber-ink)' : dev < 0 ? 'var(--green-ink)' : 'var(--muted)'}">${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%</td>
      <td class="num" style="color:${actColor};white-space:nowrap">${action}</td>
      <td class="num">${badge}</td>
    </tr>`;
  }).join('');
  card.appendChild(el(`<div class="table-scroll"><table>
    <thead><tr><th>层</th><th class="num">目标</th><th class="num">当前</th><th class="num">偏离</th><th class="num">该调金额</th><th class="num">漂移带±5%</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`));

  // 锁定资产提示
  const lockedTotal = Object.values(st.locked).reduce((a, b) => a + b, 0);
  if (lockedTotal > 0) card.appendChild(el(`<div class="alert blue" style="margin-top:10px"><span class="icon">${icon('lock')}</span><div><strong>锁定资产约 ${fmtMoney(lockedTotal)}（${(lockedTotal / total * 100).toFixed(0)}%）</strong>：定存/未到期QDII 不能自由调仓。补兜底、减美元优先用<strong>活钱 + 新增资金 + 每日可赎的QDII</strong>，锁定部分到期再归位，别提前赎回吃罚息。</div></div>`));

  // 科学口径脚注
  card.appendChild(el(`<div class="alert amber" style="margin-top:10px"><span class="icon">${icon('info')}</span><div style="font-size:12px;line-height:1.7">
    <strong>「压力回撤」怎么算的？</strong>给每层设危机情景回撤假设：兜底/现金 0%、海外固收 8%、压舱低波 15%、宽基 32%、单股 45%、美股 35%、黄金 5%（危机中风险资产同向下跌，故按占比加权<strong>线性求和</strong>作保守上界）。各预设的目标权重都已校准到"压力回撤 ≤ 该档预算"。假设偏保守（把黄金/债的对冲作用打折），实际回撤通常小于此值——宁可高估风险。</div></div>`));

  app.appendChild(card);

  // —— 执行清单（层级到具体标的：超配层卖哪只/几股，低配层补哪层）——
  const fx = currentFx();
  const DRIFT = 5;                                          // 漂移带 ±5pp：超过才生成动作
  const layerAssets = {};                                  // 层 → 该层资产（按市值降序）
  LAYER_ORDER.forEach(k => layerAssets[k] = []);
  (STATE.assets || []).forEach(a => { const v = assetCny(a, fx); if (v > 0) layerAssets[layerOf(a)].push({ a, v }); });
  LAYER_ORDER.forEach(k => layerAssets[k].sort((x, y) => y.v - x.v));

  const gaps = LAYER_ORDER.map(k => {
    const cur = st.pct[k] || 0, tgt = preset.t[k] || 0, devPct = cur - tgt;
    return { k, devPct, devCny: devPct / 100 * total };
  });
  const overL = gaps.filter(g => g.devPct > DRIFT);         // 超配→减
  const underL = gaps.filter(g => g.devPct < -DRIFT);       // 低配→补

  // —— 卖出候选打分（科学排序：逻辑已破 > 冗余度(实测ρ̄) > 回撤贡献 > 市值）——
  const cc = STATE.corrCache;
  const avgRhoOf = (code) => {                              // 与组合其余标的的平均实测相关；不在矩阵→null
    if (!cc || !cc.matrix || !cc.index || cc.index[code] == null) return null;
    const i = cc.index[code]; let sum = 0, n = 0;
    (cc.matrix[i] || []).forEach((v, j) => { if (j !== i && v != null && isFinite(v)) { sum += v; n++; } });
    return n ? sum / n : null;
  };
  const posOf = (code) => (STATE.positions || []).find(p => p.code === code);
  // 凯利稳健判定（读①的持久评估，30天内有效）：稳健为负→提前卖；稳健为正→层内保护后卖；不稳健→忽略
  const kellyVerdictOf = (a) => {
    const ev = STATE.kellyEvals[(a.code || a.name || '').toLowerCase()];
    if (!ev || !ev.date) return null;
    const days = Math.floor((Date.now() - new Date(ev.date).getTime()) / 864e5);
    if (days > 30) return null;
    const r = Calc.kellyRobust(ev.win, ev.up, ev.down);
    return { verdict: r.verdict, evPct: Calc.ev(ev.win / 100, ev.up, ev.down), date: ev.date };
  };
  const scoreSell = (x) => {                                // 返回 {score, chips[]} 分数越大越先卖
    const key = layerKeyOfAsset(x.a);
    // 「逻辑已破」= 手工标记 或 决策卡的证伪条件被勾中（后者有据可查，优于凭记忆）
    const ts = thesisStatus(x.a, num(x.a.lastPx));
    const broken = !!STATE.thesisFlags[key] || ts.broken;
    const rho = x.a.code ? avgRhoOf(x.a.code) : null;
    const p = x.a.code ? posOf(x.a.code) : null;
    const w = total > 0 ? x.v / total * 100 : 0;
    const ddC = p ? w * num(p.maxDrop) / 100 : w * (LAYER_DD[layerOf(x.a)] || 0) / 100;  // 回撤贡献pp
    const kv = kellyVerdictOf(x.a);
    const chips = [];
    if (broken) chips.push(ts.broken
      ? `<span class="pill red">证伪条件已触发·优先卖</span>`
      : '<span class="pill red">逻辑已破·优先卖</span>');
    if (ts.expired && !broken) chips.push(`<span class="pill amber">逻辑窗口已过期(${escapeHtml(thesisDueDate(ts.t))})·时间止损</span>`);
    if (ts.has && ts.target && !broken) chips.push('<span class="pill green">已达目标价·可兑现</span>');
    if (kv) {
      if (kv.verdict === 'neg') chips.push(`<span class="pill red">凯利稳健为负 EV${kv.evPct.toFixed(1)}%·提前卖</span>`);
      else if (kv.verdict === 'pos') chips.push(`<span class="pill green">凯利稳健为正·层内后卖</span>`);
      else chips.push('<span class="pill gray">凯利不稳健·不参与排序</span>');
    }
    if (rho != null) chips.push(`<span class="pill ${rho >= 0.5 ? 'amber' : 'gray'}">ρ̄ ${rho.toFixed(2)}${rho >= 0.5 ? '·冗余' : ''}</span>`);
    if (ddC > 0) chips.push(`<span class="pill gray">回撤贡献 ${ddC.toFixed(1)}pp</span>`);
    if (p && p.trend === '上涨') chips.push('<span class="pill green">⚠ 趋势上涨·卖前想想动量</span>');
    if (p && num(p.pnl) <= -20) chips.push(`<span class="pill amber">深套 ${num(p.pnl).toFixed(0)}%·先过⑤退出检查</span>`);
    // 打分层级：人的判断(破)1e9 ≫ 凯利稳健为负+3000 > 冗余 0..1000 > 回撤贡献×10 > 市值兜底；
    // 凯利稳健为正 −600（有优势的注不该被机械再平衡先砍）；不稳健 0（噪声不进排序）
    const kAdj = kv ? (kv.verdict === 'neg' ? 3000 : kv.verdict === 'pos' ? -600 : 0) : 0;
    // 时间止损 +2000：排在凯利稳健为负之下、冗余度之上——逻辑没兑现的钱在占着弹性仓的机会成本
    const tAdj = (ts.expired && !broken ? 2000 : 0) + (ts.target && !broken ? 500 : 0);
    const score = (broken ? 1e9 : 0) + kAdj + tAdj + (rho != null ? rho * 1000 : 0) + ddC * 10 + x.v / 1e7;
    return { score, chips, broken, rho, ddC };
  };

  const execCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('list')} 调仓执行清单（漂移带 ±${DRIFT}pp）</h3>
    <p class="hint">卖出排序：<strong>逻辑已破/证伪触发（你的判断或决策卡）&gt; 凯利稳健为负（①的评估，胜率±5不翻号才算数）&gt; 逻辑窗口过期（时间止损）&gt; 冗余度（实测ρ̄）&gt; 回撤贡献 &gt; 市值</strong>——每卖1元让组合改善最多；凯利稳健为<strong>正</strong>的层内后卖（有优势的注不先砍），凯利<strong>不稳健</strong>的一律忽略不进排序。${cc && cc.date ? `冗余数据取自 ${escapeHtml(cc.date)} 拉的真实相关性${cc.date !== todayStr() ? '（较旧，建议到「股票体检」重拉一次）' : ''}` : '<span style="color:var(--amber-ink)">尚未拉过真实相关性——先到「股票体检」拉一次，冗余排序才生效</span>'}。点标的旁「标记逻辑已破」可把它提到卖出队首。</p></div>`);
  if (!overL.length && !underL.length) {
    execCard.appendChild(el(`<div class="alert green"><span class="icon">${icon('check')}</span><div>各层偏离都在 ±${DRIFT}pp 内，<strong>无需调仓</strong>。再平衡不是频繁操作——偏离超线再动，每季度看一次即可。</div></div>`));
  } else {
    let html = '<ol style="margin:4px 0 0 18px;line-height:2.05">';
    // 先卖（超配层）：候选按科学分排序后贪心分配；锁定资产不卖、单独标注
    overL.forEach(g => {
      const sellTotal = g.devCny;
      const layerVal = st.cny[g.k] || 0;
      const sellable = layerAssets[g.k].filter(x => !isLockedAsset(x.a));
      const sellableVal = sellable.reduce((s, x) => s + x.v, 0);
      const lockedVal = layerVal - sellableVal;
      if (sellableVal <= 0) {
        html += `<li><strong>${LAYER_NAME[g.k]}</strong> 超配 ${g.devPct.toFixed(1)}pp（约 ${fmtMoney(sellTotal)}），但该层<strong>全是锁定资产</strong>（定存/未到期QDII）——到期再减，或用其它层腾挪。</li>`;
        return;
      }
      const ranked = sellable.map(x => Object.assign({ sc: scoreSell(x) }, x)).sort((a, b) => b.sc.score - a.sc.score);
      let remain = Math.min(sellTotal, sellableVal);
      ranked.forEach(x => {
        if (remain <= 0.5) return;
        const amt = Math.min(remain, x.v);                  // 贪心：排前面的先卖满，冗余最大者可全卖
        let txt = `卖出 <strong>${escapeHtml(x.a.name)}</strong> 约 <strong>${fmtMoney(amt)}</strong>`;
        const px = num(x.a.lastPx);
        if (px > 0 && num(x.a.shares) > 0) {
          const lot = x.a.currency === 'USD' ? 1 : 100;
          const sh = Math.floor(amt / (px * (x.a.currency === 'USD' ? fx : 1)) / lot) * lot;
          if (sh > 0) txt += `（≈ ${sh.toLocaleString()} 股）`;
        }
        const key = layerKeyOfAsset(x.a);
        const flagBtn = `<a href="javascript:;" data-thesis="${escapeHtml(key)}" style="font-size:11px;color:${x.sc.broken ? 'var(--red-ink)' : 'var(--muted)'}">${x.sc.broken ? '✓已标记逻辑已破(点击取消)' : '标记逻辑已破'}</a>`;
        html += `<li>${txt} <span class="inline-note">[${LAYER_NAME[g.k]} 超配 ${g.devPct.toFixed(1)}pp]</span><br>${x.sc.chips.join(' ')} ${flagBtn}</li>`;
        remain -= amt;
      });
      if (lockedVal > 0) html += `<li><span class="inline-note">（${LAYER_NAME[g.k]} 另有锁定 ${fmtMoney(lockedVal)} 不动，到期再算）</span></li>`;
    });
    // 后买（低配层）：给层级金额 + 建议标的方向
    const HINT = { safe: '在岸定存/国债/在岸货基', cash: '活期/货基', oseas: '每日可赎的美元固收QDII', ballast: '红利低波/高股息低波基金', broad: '沪深300/A500 宽基', single: '低相关的新主题个股（避开已重仓的AI链）', us: '优质美股/标普500', gold: '积存金/黄金ETF' };
    underL.forEach(g => {
      html += `<li>补入 <strong>${LAYER_NAME[g.k]}</strong> 约 <strong>${fmtMoney(-g.devCny)}</strong> <span class="inline-note">[低配 ${(-g.devPct).toFixed(1)}pp；建议方向：${HINT[g.k] || '该层现有品种'}]</span></li>`;
    });
    html += '</ol>';
    execCard.appendChild(el(`<div>${html}</div>`));
    execCard.appendChild(el(`<p class="inline-note" style="margin-top:10px">先卖后买、金额≈值，分 2–3 批执行别一次到位。「⚠趋势上涨」只是提醒（动量效应），不改变风险排序；「深套」先过「⑤ 加减仓 → 减仓/退出」确认逻辑是否真破。基金持有<strong>不足 7 天赎回费 1.5%</strong>，短期刚买的別动。A股按 100 股整手取整。<strong>锁定资产（定存/未到期QDII）不参与卖出</strong>。</p>`));
    // 「逻辑已破」标记切换
    execCard.querySelectorAll('[data-thesis]').forEach(btn => btn.onclick = () => {
      const k = btn.dataset.thesis;
      if (STATE.thesisFlags[k]) delete STATE.thesisFlags[k]; else STATE.thesisFlags[k] = true;
      saveState(); render();
    });
  }
  app.appendChild(execCard);

  // —— 分层核对（可改层；垃圾进垃圾出的保险丝）——
  const chkCard = el(`<div class="card" style="margin-top:16px;padding:10px 16px"><details>
    <summary style="cursor:pointer;font-weight:600;list-style:revert">${icon('search')} 分层核对（自动识别不准可手动改层）<span style="color:var(--muted);font-weight:400;font-size:12px"> — 点击展开</span></summary>
    <p class="hint" style="margin-top:8px">分层靠类别+名称关键词自动识别，像「混合型基金」这类名字看不出属性的可能归错层——归错会让目标盘和清单失真。改过的选择永久保存。</p>
    <div class="table-scroll"><table class="stack-mobile"><thead><tr><th>资产</th><th class="num">市值</th><th>当前层</th><th>改层</th></tr></thead><tbody>
    ${(STATE.assets || []).filter(a => assetCny(a, fx) > 0).sort((a, b) => assetCny(b, fx) - assetCny(a, fx)).map(a => {
      const key = layerKeyOfAsset(a), cur = layerOf(a), isOv = !!STATE.layerOverrides[key];
      return `<tr><td>${escapeHtml(a.name)}<br><span class="inline-note">${escapeHtml(a.category)}${a.code ? ' · ' + escapeHtml(a.code) : ''}</span></td>
        <td class="num">${fmtMoney(assetCny(a, fx))}</td>
        <td>${LAYER_NAME[cur]}${isOv ? ' <span class="pill green">已手改</span>' : ''}</td>
        <td><select data-lyov="${escapeHtml(key)}" style="max-width:150px"><option value="">自动（${LAYER_NAME[cur]}）</option>${LAYER_ORDER.map(k => `<option value="${k}" ${isOv && STATE.layerOverrides[key] === k ? 'selected' : ''}>${LAYER_NAME[k]}</option>`).join('')}</select></td></tr>`;
    }).join('')}
    </tbody></table></div></details></div>`);
  chkCard.querySelectorAll('[data-lyov]').forEach(sel => sel.onchange = () => {
    const k = sel.dataset.lyov, v = sel.value;
    if (v) STATE.layerOverrides[k] = v; else delete STATE.layerOverrides[k];
    saveState(); render();
  });
  app.appendChild(chkCard);
};
/* =========================================================================
   视图：收益归因 —— 收益从哪来：大类分解 + 个股按因子分解（基于快照明细）
   ========================================================================= */
VIEWS.attribution = function (app) {
  const snaps = (STATE.snapshots || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  app.appendChild(el(`
    <div class="view-head">
      <h2>收益归因</h2>
      <p>拆开看：这段区间的收益里，各大类（权益/固收/黄金/现金）各贡献多少，个股再按因子拆。不知道钱从哪赚的，就可能从同一条路亏回去。</p>
    </div>`));

  const detailed = snaps.filter(s => s.assets && s.assets.length);
  if (detailed.length < 2) {
    app.appendChild(el(`<div class="card"><div class="empty"><div class="big">${icon('chart')}</div>
      <p>归因需要至少 2 份<strong>含资产明细</strong>的快照（当前 ${detailed.length} 份）。每天打开应用会自动记录，攒几天后再来。</p></div></div>`));
    return;
  }

  const periods = [
    { key: '7', label: '近 7 天' }, { key: '30', label: '近 30 天' },
    { key: 'month', label: '本月' }, { key: 'all', label: '全部' },
  ];
  const headCard = el(`<div class="card"><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
      <strong>区间</strong><div class="seg" id="attr-seg">${periods.map((p, i) => `<button class="seg-btn${i === 3 ? ' active' : ''}" data-p="${p.key}">${p.label}</button>`).join('')}</div>
    </div>
    <div id="attr-body" style="margin-top:14px"></div></div>
    <p class="inline-note">口径：逐日累加「前一日持股 × 当日价格变动」，已剔除出入金（在「资产趋势 → 出入金登记」补录后更准）。
    利息、手动改金额、当日调仓的标的价格变动计入「残差」——残差大说明该区间的手动操作多，归因仅供参考。</p>`);
  app.appendChild(headCard);

  // 权益仓位收益曲线 vs 基准指数：与「资产趋势」同一套基准，但这条线不是总资产/大类净值，
  // 而是只用「连续持有」的权益仓位算出的 TWR 指数——减仓/换仓不会把它拉成"亏损"，
  // 回答的正是"留着没动的仓位到底跑赢跑输了大盘多少"。
  const eqChartCard = el(`<div class="card" style="margin-top:16px">
    <h3 style="margin:0">${icon('chart')} 权益仓位 vs 基准</h3>
    <div class="row" id="eq-bench-chips" style="gap:6px;flex-wrap:wrap;margin-top:10px"></div>
    <div id="eq-chart" style="margin-top:14px"></div>
    <div id="eq-bench-legend" class="inline-note" style="margin-top:8px"></div>
    <p class="inline-note" style="margin-top:10px">与上方「按大类」不同：这条线只用<strong>两天都在持有、有报价</strong>的权益标的（A股/美股/基金）算收益率，
      卖出/买入/换仓当天不计入分子分母，因此不会像总资产/大类走势那样因为减仓而显示"亏损"。区间跟随上面的「区间」选择联动。</p>
  </div>`);
  app.appendChild(eqChartCard);
  const eqBenchLoaded = {}, eqBenchDiag = {};
  let eqBenchKeys = ((STATE.settings || {}).attrBenchKeys || []).filter(k => BENCH_BY_KEY[k]);
  let eqCurList = detailed;
  function drawEqChips(busyKey) {
    const box = eqChartCard.querySelector('#eq-bench-chips');
    box.innerHTML = `<span class="inline-note" style="align-self:center">对比基准（可多选）</span>` + BENCHMARKS.map(b => {
      const on = eqBenchKeys.indexOf(b.key) >= 0;
      const failed = on && eqBenchLoaded[b.key] === null;
      const busy = b.key === busyKey;
      const style = on && !failed
        ? `background:${b.color}22;color:${b.color};border:1px solid ${b.color}`
        : failed ? 'background:rgba(255,59,48,.10);color:var(--red-ink);border:1px solid rgba(255,59,48,.4)'
        : 'background:rgba(120,120,128,.10);color:var(--muted);border:1px solid rgba(120,120,128,.25)';
      return `<button data-ebk="${b.key}" style="${style};font:inherit;font-size:12.5px;font-weight:600;padding:4px 10px;border-radius:999px;cursor:pointer">${busy ? '…' : (on && !failed ? '━ ' : '')}${escapeHtml(b.label)}${failed ? ' ✕' : ''}</button>`;
    }).join('');
    box.querySelectorAll('[data-ebk]').forEach(btn => btn.onclick = () => toggleEqBench(btn.dataset.ebk));
  }
  async function toggleEqBench(key) {
    const i = eqBenchKeys.indexOf(key);
    if (i >= 0) { eqBenchKeys.splice(i, 1); delete eqBenchLoaded[key]; delete eqBenchDiag[key]; }
    else {
      eqBenchKeys.push(key);
      if (!eqBenchLoaded[key]) {
        drawEqChips(key);
        const b = BENCH_BY_KEY[key];
        try {
          const r = await fetchBenchmarkSeries(key);
          eqBenchDiag[key] = r.diag;
          eqBenchLoaded[key] = r.series.length ? { label: b.label + (r.via ? '(' + r.via + ')' : ''), color: b.color, series: r.series, via: r.via } : null;
        } catch (e) { eqBenchDiag[key] = ['异常:' + e.message]; eqBenchLoaded[key] = null; }
      }
    }
    STATE.settings.attrBenchKeys = eqBenchKeys.slice(); saveState();
    drawEqChips(); drawEqChart(eqCurList);
  }
  drawEqChips();
  eqBenchKeys.slice().forEach(async k => {
    const b = BENCH_BY_KEY[k];
    try {
      const r = await fetchBenchmarkSeries(k);
      eqBenchDiag[k] = r.diag;
      eqBenchLoaded[k] = r.series.length ? { label: b.label + (r.via ? '(' + r.via + ')' : ''), color: b.color, series: r.series, via: r.via } : null;
    } catch (e) { eqBenchDiag[k] = ['异常:' + e.message]; eqBenchLoaded[k] = null; }
    drawEqChips(); drawEqChart(eqCurList);
  });
  function eqTip(i, mine, refs) {
    const p = mine[i];
    let html = `<div style="font-weight:600">${escapeHtml(p.date.slice(5))}</div>
      <div style="margin:2px 0 3px"><span style="color:var(--accent)">━</span> <strong>权益仓位 ${(+p.value).toFixed(2)} 点</strong><span style="color:var(--muted);font-size:11px">（指数·起点100）</span></div>`;
    if (i > 0) {
      const d = p.value - mine[i - 1].value;
      html += `<div style="color:${d >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">较上一点 ${d >= 0 ? '+' : ''}${d.toFixed(2)} 点</div>`;
    }
    refs.forEach(r => {
      const rp = r.points[i]; if (!rp) return;
      html += `<div style="margin:5px 0 2px;border-top:1px solid rgba(127,127,127,.25);padding-top:4px"><span style="color:${r.color}">━</span> <strong>${escapeHtml(r.name)} ${(+rp.value).toFixed(2)} 点</strong></div>`;
      if (i > 0 && r.points[i - 1]) {
        const d2 = rp.value - r.points[i - 1].value;
        html += `<div style="color:${d2 >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">较上一点 ${d2 >= 0 ? '+' : ''}${d2.toFixed(2)} 点</div>`;
      }
    });
    return html;
  }
  function drawEqChart(list) {
    eqCurList = list;
    const box = eqChartCard.querySelector('#eq-chart');
    const legend = eqChartCard.querySelector('#eq-bench-legend');
    if (list.length < 2) { box.innerHTML = '<div class="empty">该区间明细快照不足 2 份。</div>'; legend.textContent = ''; return; }
    const mine = equityTwrIndexSeries(list);
    const active = eqBenchKeys.map(k => eqBenchLoaded[k]).filter(Boolean);
    const refs = active.map(b => ({ name: b.label, color: b.color, points: alignBenchmark(list, b.series) }));
    const mRet = mine[mine.length - 1].value - 100;
    legend.innerHTML = `<span style="color:var(--accent)">━</span> <strong>权益仓位 ${mRet >= 0 ? '+' : ''}${fmtPct(mRet, 2)}</strong>　` +
      refs.map(r => {
        const bRet = r.points[r.points.length - 1].value - 100, ex = mRet - bRet;
        return `<span style="color:${r.color}">━</span> ${escapeHtml(r.name)} ${bRet >= 0 ? '+' : ''}${fmtPct(bRet, 2)}` +
          `<span style="color:${ex >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">（超额 ${ex >= 0 ? '+' : ''}${fmtPct(ex, 2)}）</span>`;
      }).join('　') + '　<span style="color:var(--muted)">起点=100</span>';
    box.innerHTML = '';
    box.appendChild(buildLineChart(mine.map(p => ({ label: p.date.slice(5), date: p.date, value: p.value })),
      { extra: refs, tooltip: (i) => eqTip(i, mine, refs) }));
  }

  const factorOf = (code, name) => {
    const p = (STATE.positions || []).find(x => x.code && x.code === code);
    return (p && p.factor) || guessFactor(name) || '其它';
  };

  function compute(list) {
    const byAsset = new Map();   // key → {name, cat, factor, contrib}
    let residual = 0, explained = 0, flows = 0;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], cur = list[i];
      const fx = num(cur.fx) > 0 ? num(cur.fx) : currentFx();
      const fxPrev = num(prev.fx) > 0 ? num(prev.fx) : fx;
      const cfDay = cashflowBetween(prev.date, cur.date);   // 区间口径：无快照日补录的流水也计入
      flows += cfDay;
      const prevMap = new Map((prev.assets || []).map(a => [(a.code || a.id), a]));
      let dayExplained = 0;
      (cur.assets || []).forEach(a => {
        const key = a.code || a.id;
        const pa = prevMap.get(key);
        if (!pa) return;                                  // 当日新增（买入/新建）→ 价格变动当日不计，进残差
        const sameShares = num(pa.shares) > 0 && num(pa.shares) === num(a.shares);
        if (!(sameShares && num(pa.lastPx) > 0 && num(a.lastPx) > 0)) return;   // 调仓/无价 → 残差
        // 人民币口径全贡献 = 现值(现汇率) − 前值(前汇率)：美元资产的汇率损益计入该资产贡献，
        // 而不是掉进「残差」被误读为"手动操作多"
        const cfCur = a.currency === 'USD' ? fx : 1, cfPrev = a.currency === 'USD' ? fxPrev : 1;
        const c = num(pa.shares) * (num(a.lastPx) * cfCur - num(pa.lastPx) * cfPrev);
        dayExplained += c;
        const rec = byAsset.get(key) || {
          name: a.name, cat: bigClassOf(a.category), rawCat: a.category,
          factor: factorOf(a.code, a.name), contrib: 0,
        };
        rec.contrib += c;
        byAsset.set(key, rec);
      });
      const dayChange = num(cur.total) - num(prev.total) - cfDay;
      explained += dayExplained;
      residual += dayChange - dayExplained;
    }
    return { byAsset, residual, explained, flows, first: list[0], last: list[list.length - 1] };
  }

  function bar(label, v, maxAbs, note) {
    const pct = maxAbs > 0 ? Math.min(100, Math.abs(v) / maxAbs * 100) : 0;
    const col = v >= 0 ? 'var(--green-ink)' : 'var(--red-ink)';
    return `<div style="display:grid;grid-template-columns:110px 1fr 110px;gap:8px;align-items:center;margin:5px 0">
      <div style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
      <div style="height:12px;background:rgba(120,120,128,0.12);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:${col};border-radius:6px"></div></div>
      <div class="num" style="font-size:12.5px;color:${col}">${v >= 0 ? '+' : ''}${fmtMoney(v)}${note || ''}</div>
    </div>`;
  }

  function renderPeriod(key) {
    let list = detailed;
    if (key !== 'all') {
      const cutoff = key === 'month'
        ? todayStr().slice(0, 7) + '-01'
        : new Date(Date.now() - parseInt(key, 10) * 864e5).toISOString().slice(0, 10);
      list = detailed.filter(s => s.date >= cutoff);
      if (list.length < 2) list = detailed.slice(-2);     // 区间内不足两天 → 用最近两天兜底
    }
    drawEqChart(list);
    const { byAsset, residual, explained, flows, first, last } = compute(list);
    const totalChange = num(last.total) - num(first.total) - flows;
    const chgCol = totalChange >= 0 ? 'var(--green-ink)' : 'var(--red-ink)';

    // 汇总：大类 / 个股因子（仅 A股/美股股票）
    const byBig = new Map(), byFactor = new Map();
    byAsset.forEach(r => {
      byBig.set(r.cat, (byBig.get(r.cat) || 0) + r.contrib);
      if (r.rawCat === 'A股股票' || r.rawCat === '美股股票') byFactor.set(r.factor, (byFactor.get(r.factor) || 0) + r.contrib);
    });
    const bigRows = [...byBig.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (Math.abs(residual) > 0.5) bigRows.push(['残差（利息/手动调整/调仓）', residual]);
    const facRows = [...byFactor.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const maxAbs = Math.max(1, ...bigRows.map(r => Math.abs(r[1])));
    const maxFac = Math.max(1, ...facRows.map(r => Math.abs(r[1])));
    // 个股明细（贡献绝对值前 8）
    const topAssets = [...byAsset.values()].sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 8);

    headCard.querySelector('#attr-body').innerHTML = `
      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat"><div class="label">${icon('calendar')} 区间</div>
          <div class="value" style="font-size:20px">${first.date.slice(5)} → ${last.date.slice(5)}</div>
          <div class="sub">${list.length} 份明细快照</div></div>
        <div class="stat"><div class="label">${icon('trend')} 区间收益（已剔出入金）</div>
          <div class="value" style="font-size:20px;color:${chgCol}">${totalChange >= 0 ? '+' : ''}${fmtMoney(totalChange)}</div>
          <div class="sub">出入金 ${flows >= 0 ? '+' : ''}${fmtMoney(flows)}</div></div>
        <div class="stat"><div class="label">${icon('chart')} 价格变动可解释</div>
          <div class="value" style="font-size:20px">${fmtMoney(explained)}</div>
          <div class="sub">残差 ${fmtMoney(residual)}</div></div>
      </div>
      <h4 style="margin:14px 0 6px">按大类</h4>
      ${bigRows.map(([k, v]) => bar(k, v, maxAbs)).join('') || '<p class="inline-note">无数据</p>'}
      <h4 style="margin:18px 0 6px">个股按因子</h4>
      ${facRows.length ? facRows.map(([k, v]) => bar(k, v, maxFac)).join('') : '<p class="inline-note">区间内个股无价格贡献（或全部调入/调出）。</p>'}
      <h4 style="margin:18px 0 6px">贡献最大的标的（前 8）</h4>
      <div class="table-scroll"><table>
        <thead><tr><th>标的</th><th>大类</th><th class="num">贡献（¥）</th></tr></thead>
        <tbody>${topAssets.map(r => `<tr><td>${escapeHtml(r.name)}</td><td><span class="tag-chip">${escapeHtml(r.cat)}</span></td>
          <td class="num" style="color:${r.contrib >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">${r.contrib >= 0 ? '+' : ''}${fmtMoney(r.contrib)}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  headCard.querySelectorAll('#attr-seg .seg-btn').forEach(b => b.onclick = () => {
    headCard.querySelectorAll('#attr-seg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
    renderPeriod(b.dataset.p);
  });
  renderPeriod('all');
};

/* =========================================================================
   视图：压力测试 —— 极端情景下组合会亏多少（相对最大回撤承受线）
   ========================================================================= */
// 科技成长因子组（预设情景用）
const STRESS_TECH = ['AI算力', 'AI电力', 'AI应用', '科技互联网', '传媒游戏', '半导体', '机器人', '新能源车', '光伏风电'];
// 当前组合的风险桶：每资产归入 cn(个股A股)/us(个股美股)/fund(基金)/gold(黄金)/safe(固收理财现金)
function stressBuckets() {
  const fx = currentFx();
  const rows = [];
  (STATE.assets || []).forEach(a => {
    const v = assetCny(a, fx);
    if (!(v > 0)) return;
    let bucket = 'safe', factor = null;
    if (a.category === 'A股股票' || a.category === '美股股票') {
      const p = (STATE.positions || []).find(x => x.code && x.code === a.code);
      factor = (p && p.factor) || guessFactor(a.name) || '其它';
      bucket = a.category === '美股股票' ? 'us' : 'cn';
    } else if (a.category === '基金') bucket = 'fund';
    else if (bigClassOf(a.category) === '黄金') bucket = 'gold';
    rows.push({ name: a.name, code: a.code, cat: a.category, bucket, factor, usd: a.currency === 'USD', v });
  });
  return rows;
}
// 一条冲击规则命中哪些资产；scope: factor:X / factorGroup:tech / cn / cnOther / us / fund / gold / usd-fx
function shockOf(row, rules) {
  let s = 0;
  rules.forEach(r => {
    const idx = r.scope.indexOf(':');
    const kind = idx >= 0 ? r.scope.slice(0, idx) : r.scope;
    const arg = idx >= 0 ? r.scope.slice(idx + 1) : '';
    if (kind === 'factor' && row.factor === arg) s += r.shock;
    else if (kind === 'factorGroup' && arg === 'tech' && row.factor && STRESS_TECH.indexOf(row.factor) >= 0) s += r.shock;
    else if (kind === 'cn' && row.bucket === 'cn') s += r.shock;
    else if (kind === 'cnOther' && row.bucket === 'cn' && !(row.factor && STRESS_TECH.indexOf(row.factor) >= 0)) s += r.shock;
    else if (kind === 'us' && row.bucket === 'us') s += r.shock;
    else if (kind === 'fund' && row.bucket === 'fund') s += r.shock;
    else if (kind === 'gold' && row.bucket === 'gold') s += r.shock;
    else if (kind === 'usd-fx' && row.usd) s += r.shock;   // 汇率冲击：美元资产的人民币折算损失
  });
  return s;
}
const STRESS_PRESETS = [
  { name: '中国科技成长 −30%', rules: [{ scope: 'factorGroup:tech', shock: -30 }, { scope: 'cnOther', shock: -10 }, { scope: 'fund', shock: -12 }] },
  { name: 'A股系统性 −15%', rules: [{ scope: 'cn', shock: -15 }, { scope: 'fund', shock: -12 }] },
  { name: '美股 −20%', rules: [{ scope: 'us', shock: -20 }] },
  { name: '黄金 −15%', rules: [{ scope: 'gold', shock: -15 }] },
  { name: '美元贬值 5%', rules: [{ scope: 'usd-fx', shock: -5 }] },
  { name: '全面危机：权益−35% 黄金+5%', rules: [{ scope: 'cn', shock: -35 }, { scope: 'us', shock: -35 }, { scope: 'fund', shock: -30 }, { scope: 'gold', shock: 5 }] },
];
// 自定义情景可选的冲击对象
const STRESS_SCOPES = [
  ['cn', '全部 A股个股'], ['us', '全部 美股个股'], ['fund', '全部 基金'], ['gold', '黄金'], ['usd-fx', '美元资产（汇率）'],
].concat(FACTORS.map(f => ['factor:' + f, '因子 · ' + f]));

VIEWS.stress = function (app) {
  const s = STATE.settings || {};
  const maxDD = num(s.maxDrawdown, 15);
  const rows = stressBuckets();
  const total = rows.reduce((sum, r) => sum + r.v, 0);
  app.appendChild(el(`
    <div class="view-head">
      <h2>压力测试</h2>
      <p>把极端行情直接施加到你<strong>当前的实际持仓</strong>上：每个情景亏多少、是否跌破你设的「组合最大回撤阈值 ${maxDD}%」（设置里可调）。冲击按桶施加（个股按因子、基金/黄金按类、美元资产受汇率冲击），是保守估计——没算对冲与相关性抵消。</p>
    </div>`));
  if (!rows.length) {
    app.appendChild(el('<div class="card"><div class="empty"><p>暂无持仓数据。</p></div></div>'));
    return;
  }

  let customRules = [];
  const card = el(`<div class="card">
    <h3>${icon('warn')} 情景</h3>
    <div class="row" style="gap:8px;flex-wrap:wrap" id="preset-row">
      ${STRESS_PRESETS.map((p, i) => `<button class="btn secondary small" data-preset="${i}">${escapeHtml(p.name)}</button>`).join('')}
    </div>
    <div class="section-divider"></div>
    <div class="mini-label">自定义情景（选对象 + 冲击幅度，可叠加多条）</div>
    <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="min-width:180px"><label>冲击对象</label><select id="st-scope">${STRESS_SCOPES.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('')}</select></div>
      <div class="field" style="width:130px"><label>冲击 %</label><input id="st-shock" type="number" step="1" value="-20"/></div>
      <button class="btn small" id="st-add" style="flex:0 0 auto">${icon('plus')} 加入情景</button>
    </div>
    <div id="custom-rules" class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px"></div>
  </div>`);
  app.appendChild(card);

  const resultCard = el(`<div class="card" style="margin-top:16px">
    <h3>${icon('chart')} 结果</h3>
    <div id="stress-out"></div>
  </div>`);
  app.appendChild(resultCard);

  function evalRules(rules) {
    let delta = 0;
    const per = rows.map(r => {
      const sh = shockOf(r, rules);
      const d = r.v * sh / 100;
      delta += d;
      return { r, sh, d };
    });
    const pct = total > 0 ? delta / total * 100 : 0;
    return { delta, pct, per: per.filter(x => x.d !== 0).sort((a, b) => a.d - b.d) };
  }
  function verdict(pct) {
    if (pct >= 0) return '<span class="pill green">正收益情景</span>';   // 上涨情景不该被 |pct| 误判「跌破」
    return Math.abs(pct) <= maxDD
      ? '<span class="pill green">承受线内</span>'
      : '<span class="pill red">跌破阈值</span>';
  }
  function rulesLabel(rules) {
    return rules.map(r => {
      const sc = STRESS_SCOPES.find(x => x[0] === r.scope);
      return (sc ? sc[1] : r.scope) + ' ' + r.shock + '%';
    }).join(' ＋ ');
  }
  function drawRules() {
    const box = card.querySelector('#custom-rules');
    box.innerHTML = customRules.length
      ? customRules.map((r, i) => `<span class="tag-chip">${escapeHtml(rulesLabel([r]))}
          <a href="javascript:;" data-rrm="${i}" style="margin-left:4px;color:var(--red-ink)">✕</a></span>`).join('')
      : '<span class="inline-note">（未添加时显示预设情景结果）</span>';
    box.querySelectorAll('[data-rrm]').forEach(a => a.onclick = () => { customRules.splice(+a.dataset.rrm, 1); drawRules(); drawOut(); });
  }
  function drawOut(focusRules) {
    const out = resultCard.querySelector('#stress-out');
    // 预设总览表
    const rowsHtml = STRESS_PRESETS.map(p => {
      const r = evalRules(p.rules);
      const col = r.delta >= 0 ? 'var(--green-ink)' : 'var(--red-ink)';
      return `<tr><td>${escapeHtml(p.name)}</td>
        <td class="num" style="color:${col}">${r.delta >= 0 ? '+' : ''}${fmtMoney(r.delta)}</td>
        <td class="num" style="color:${col}">${r.delta >= 0 ? '+' : ''}${fmtPct(r.pct, 2)}</td>
        <td class="num">${verdict(r.pct)}</td></tr>`;
    }).join('');
    let html = `<div class="table-scroll"><table>
      <thead><tr><th>预设情景</th><th class="num">组合影响</th><th class="num">幅度</th><th class="num">判定（阈值 ${maxDD}%）</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table></div>`;
    // 自定义情景明细
    if (focusRules && focusRules.length) {
      const r = evalRules(focusRules);
      const col = r.delta >= 0 ? 'var(--green-ink)' : 'var(--red-ink)';
      const maxAbs = Math.max(1, ...r.per.map(x => Math.abs(x.d)));
      html += `<div class="section-divider"></div>
        <h4 style="margin:6px 0">自定义情景：${escapeHtml(rulesLabel(focusRules))}</h4>
        <p>组合影响 <strong style="color:${col}">${r.delta >= 0 ? '+' : ''}${fmtMoney(r.delta)}（${r.delta >= 0 ? '+' : ''}${fmtPct(r.pct, 2)}）</strong> ${verdict(r.pct)}</p>
        ${r.per.map(x => `
          <div style="display:grid;grid-template-columns:150px 1fr 110px;gap:8px;align-items:center;margin:5px 0">
            <div style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(x.r.name)}">${escapeHtml(x.r.name)}</div>
            <div style="height:12px;background:rgba(120,120,128,0.12);border-radius:6px;overflow:hidden">
              <div style="height:100%;width:${(Math.abs(x.d) / maxAbs * 100).toFixed(1)}%;background:${x.d >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'};border-radius:6px"></div></div>
            <div class="num" style="font-size:12.5px;color:${x.d >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">${x.sh >= 0 ? '+' : ''}${x.sh}% → ${x.d >= 0 ? '+' : ''}${fmtMoney(x.d)}</div>
          </div>`).join('') || '<p class="inline-note">该情景不命中任何持仓。</p>'}`;
    }
    out.innerHTML = html;
  }
  card.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    customRules = STRESS_PRESETS[+b.dataset.preset].rules.slice();
    drawRules(); drawOut(customRules);
  });
  card.querySelector('#st-add').onclick = () => {
    const scope = card.querySelector('#st-scope').value;
    const shock = num(card.querySelector('#st-shock').value);
    if (!(isFinite(shock) && shock !== 0)) { alert('请填写非零冲击幅度（%）'); return; }
    if (shock < -95 || shock > 200) { alert('冲击幅度请在 −95% ~ +200% 之间（资产最多跌 100%）'); return; }
    customRules.push({ scope, shock });
    drawRules(); drawOut(customRules);
  };
  drawRules(); drawOut();
};


VIEWS.portfolio = function (app) {
  const assets = STATE.assets || [];
  app.appendChild(el(`
    <div class="view-head">
      <h2>投资组合</h2>
      <p>你的整体资产配置总览与 AI 健康度诊断。${STATE.portfolio.asOfDate ? '数据截止 ' + STATE.portfolio.asOfDate : ''}</p>
    </div>
  `));

  if (assets.length === 0) {
    app.appendChild(el(`<div class="card"><div class="empty"><div class="big">${icon('wallet')}</div>
      <p>还没有资产数据。可到「设置 → 数据管理」载入 7/19 初始数据。</p>
      <button class="btn" id="pf-seed" style="margin-top:12px">${icon('refresh')} 载入 7/19 初始数据</button>
    </div></div>`));
    app.querySelector('#pf-seed').onclick = () => { STATE = buildSeedState(); saveState(); render(); };
    return;
  }

  const fx = currentFx();
  const cnyOf = a => assetCny(a, fx);
  const total = assets.reduce((s, a) => s + cnyOf(a), 0);
  const byBig = {}, byCat = {}, byCur = {};
  assets.forEach(a => {
    const v = cnyOf(a);
    byBig[bigClassOf(a.category)] = (byBig[bigClassOf(a.category)] || 0) + v;
    byCat[a.category] = (byCat[a.category] || 0) + v;
    byCur[a.currency] = (byCur[a.currency] || 0) + v;
  });
  const usdCny = byCur['USD'] || 0;
  const pct = v => (v / total * 100);
  let interestTotal = 0, pnlTotal = 0, realizedTotal = 0;
  assets.forEach(a => {
    const inc = assetIncome(a, fx);
    if (inc.kind === 'interest') interestTotal += inc.value;
    else if (inc.value != null) pnlTotal += inc.value;
    if (a.realizedPnl != null) realizedTotal += num(a.realizedPnl);
  });

  // 汇率控制条（美元/人民币中间价，每日更新）
  const fxBar = el(`<div class="card" style="padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <span>${icon('globe')} 美元/人民币中间价：<strong id="fx-val">${fx.toFixed(4)}</strong>
      <span class="inline-note" id="fx-note">${STATE.portfolio.fxAsOf ? '中间价 ' + STATE.portfolio.fxAsOf : '（手动/默认，可更新或在设置修改）'}</span></span>
    <button class="btn secondary small" id="fx-upd" style="margin-left:auto">${icon('refresh')} 更新中间价</button>
  </div>`);
  app.appendChild(fxBar);
  fxBar.querySelector('#fx-upd').onclick = async (e) => {
    const b = e.currentTarget; const old = b.innerHTML; b.disabled = true; b.innerHTML = icon('refresh', 'spin') + ' 获取中…';
    try {
      const { rate, date } = await fetchCentralParity();
      STATE.portfolio.fxRate = rate;
      STATE.portfolio.fxAsOf = date || new Date().toISOString().slice(0, 10);
      saveState(); render();
    } catch (err) {
      b.disabled = false; b.innerHTML = old;
      fxBar.querySelector('#fx-note').textContent = '自动获取失败（' + err.message + '），可在「设置」手动填当日中间价';
    }
  };

  // 顶部统计
  app.appendChild(el(`
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat"><div class="label">${icon('wallet')} 总资产</div>
        <div class="value" style="font-size:22px">${fmtMoney(total)}</div><div class="sub">折合人民币（当日汇率）</div></div>
      <div class="stat"><div class="label">${icon('globe')} 美元敞口</div>
        <div class="value">${fmtPct(pct(usdCny),0)}</div><div class="sub">${fmtMoney(usdCny)}</div></div>
      <div class="stat"><div class="label">${icon('coins')} 年化利息(估)</div>
        <div class="value" style="color:var(--green-ink);font-size:22px">+${fmtMoney(interestTotal)}</div>
        <div class="sub">美元 3% · 人民币实际</div></div>
      <div class="stat"><div class="label">股票/基金/黄金浮盈亏</div>
        <div class="value" style="color:${pnlTotal>=0?'var(--green-ink)':'var(--red-ink)'};font-size:22px">${pnlTotal>=0?'+':''}${fmtMoney(pnlTotal)}</div>
        <div class="sub">有盈亏记录部分合计${realizedTotal !== 0 ? ` · 另累计已实现 ${realizedTotal>=0?'+':''}${fmtMoney(realizedTotal)}` : ''}</div></div>
    </div>
  `));

  // 大类饼图
  const allocCard = el(`<div class="card"><h3>${icon('pie')} 大类配置</h3></div>`);
  allocCard.appendChild(buildPie(normalize(byBig), { total }));
  app.appendChild(allocCard);
  app.appendChild(el(`<p class="inline-note" style="margin-top:-6px">想按「期限×回撤」科学配置并生成调仓清单？见导航栏「<strong>再平衡</strong>」页。</p>`));

  // 明细表：按类别（按大类排序：股票→基金→理财→黄金→现金）
  const catCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('list')} 按类别明细</h3></div>`);
  const catRows = Object.entries(byCat)
    .sort((a, b) => classRank(a[0]) - classRank(b[0]) || b[1] - a[1])
    .map(([c, v]) => `<tr><td>${escapeHtml(c)}</td><td class="num">${fmtMoney(v)}</td><td class="num">${fmtPct(pct(v),1)}</td></tr>`).join('');
  catCard.appendChild(el(`<div class="table-scroll"><table>
    <thead><tr><th>类别</th><th class="num">金额</th><th class="num">占比</th></tr></thead>
    <tbody>${catRows}
      <tr class="total-row"><td><span class="nowrap">人民币计价</span> · <span class="nowrap">美元计价合计</span></td>
      <td class="num"><span class="nowrap">${fmtMoney(byCur['CNY']||0)}</span> · <span class="nowrap">${fmtMoney(usdCny)}</span></td>
      <td class="num"><span class="nowrap">${fmtPct(pct(byCur['CNY']||0),0)}</span> · <span class="nowrap">${fmtPct(pct(usdCny),0)}</span></td></tr>
    </tbody></table></div>`));
  app.appendChild(catCard);

  // 持仓明细（按大类排序；收益列：理财/存款年化利息，其它浮盈亏；可增删改）
  const fetchableCount = assets.filter(assetFetchable).length;
  const lastRef = STATE.lastQuoteRefresh ? new Date(STATE.lastQuoteRefresh) : null;
  const lastRefStr = lastRef ? `${String(lastRef.getMonth()+1).padStart(2,'0')}-${String(lastRef.getDate()).padStart(2,'0')} ${String(lastRef.getHours()).padStart(2,'0')}:${String(lastRef.getMinutes()).padStart(2,'0')}` : '尚未刷新';
  const holdCard = el(`<div class="card" style="margin-top:16px">
    <div class="card-head-row">
      <h3 style="margin:0">${icon('coins')} 全部持仓（${assets.length}）</h3>
      ${fetchableCount ? `<button class="btn secondary small" id="pf-refresh" style="flex:0 0 auto">${icon('refresh')} 一键刷新估值</button>` : ''}
    </div>
    <p class="hint">组合会随时间变化——可随时在下方「管理资产」增删改。<strong>按住行可拖拽排序</strong>（顺序自动保存）；未拖拽时默认按大类排序：股票 → 基金 → 理财 → 黄金 → 现金。
      ${fetchableCount ? `<br>其中 <strong>${fetchableCount}</strong> 只基金/股票可自动更新（打开页面自动刷新，最近 <span id="pf-lastref">${lastRefStr}</span>）。理财为银行自有产品无公开接口，请手动维护。` : ''}</p></div>`);
  const orderMap = new Map((STATE.assetOrder || []).map((id, i) => [id, i]));
  // 拖拽过之后新增的资产：插到自定义顺序里「同大类最后一个」之后（而不是一律沉底），
  // 同大类还没有已排序资产时才按大类排在末尾
  const lastOfClass = {};
  assets.forEach(x => {
    if (!orderMap.has(x.id)) return;
    const r = classRank(x.category);
    lastOfClass[r] = Math.max(lastOfClass[r] != null ? lastOfClass[r] : -1, orderMap.get(x.id));
  });
  const orderKeyOf = a => {
    if (orderMap.has(a.id)) return orderMap.get(a.id);
    const r = classRank(a.category);
    return lastOfClass[r] != null ? lastOfClass[r] + 0.5 : 1e9 + r;
  };
  const sorted = assets.slice().sort((a, b) => {
    const ia = orderKeyOf(a), ib = orderKeyOf(b);
    if (ia !== ib) return ia - ib;                 // 用户拖拽过的自定义顺序优先，新资产插同类之后
    return classRank(a.category) - classRank(b.category) || cnyOf(b) - cnyOf(a);
  });
  const hrows = sorted.map(a => {
    const v = cnyOf(a);
    const inc = assetIncome(a, fx);
    let incCell;
    if (inc.kind === 'interest') {
      incCell = `<span style="color:var(--green-ink)" title="年化利息 ${(inc.rate*100).toFixed(2)}%${a.currency==='USD'?'（美元按中间价折算）':''}">+${fmtMoney(inc.value)}<span class="inline-note"> /年</span></span>`;
    } else if (inc.value != null) {
      incCell = `<span style="color:${inc.value>=0?'var(--green-ink)':'var(--red-ink)'}">${inc.value>=0?'+':''}${fmtMoney(inc.value)}</span>`;
    } else { incCell = '—'; }
    // 累计已实现收益（赎回/卖出落袋的历史战果）：独立于上面的"未来估计/浮盈"，有则显示
    if (a.realizedPnl != null && num(a.realizedPnl) !== 0) {
      const rp = num(a.realizedPnl);
      incCell += `<br><span class="inline-note" style="color:${rp>=0?'var(--green-ink)':'var(--red-ink)'}" title="历史赎回/卖出已落袋的累计收益，与当前持仓的估算无关">已实现 ${rp>=0?'+':''}${fmtMoney(rp)}</span>`;
    }
    let dayCell = '—';
    const pxStale = a.pxDate && a.pxDate !== todayStr();   // 价格不是今天刷的：旧涨跌不冒充「今日」
    if (a.dayPct != null && isFinite(a.dayPct) && !pxStale) {
      // 个人当日收益率：中途建仓/加仓的日子按你的成本基础算，区别于标的全天涨幅
      const effPct = dayPnlPct(a, fx);
      const showPct = effPct != null ? effPct : a.dayPct;
      const up = showPct >= 0;
      // 当日涨跌金额（人民币）——按「当日开盘持股」算，改过股数(增/减持)也与实际一致
      const dayAmt = dayPnlCny(a, fx);
      const diffTip = effPct != null && Math.abs(effPct - a.dayPct) > 0.05
        ? ` title="你的当日收益率（按持仓成本基础）；标的全天涨幅 ${a.dayPct >= 0 ? '+' : ''}${fmtPct(a.dayPct, 2)}"` : '';
      dayCell = `<span class="pill ${up?'green':'red'}"${diffTip}>${up?'+':''}${fmtPct(showPct,2)}</span>`
        + `<br><span class="inline-note" style="color:${up?'var(--green-ink)':'var(--red-ink)'}">${dayAmt>=0?'+':'−'}${fmtMoney(Math.abs(dayAmt))}</span>`;
    } else if (a.dayPct != null && isFinite(a.dayPct) && pxStale) {
      dayCell = `<span class="inline-note">上次(${escapeHtml(String(a.pxDate).slice(5))}) ${a.dayPct>=0?'+':''}${fmtPct(a.dayPct,2)}<br>今日待刷新</span>`;
    } else if (assetFetchable(a) && !(num(a.lastPx) > 0)) {
      dayCell = '<span class="inline-note">待刷新</span>';   // 仅「从未取过价」时提示，取过价则显示 —
    }
    return `<tr draggable="true" data-aid="${a.id}" class="asset-row">
      <td>${escapeHtml(a.name)}${a.code?`<br><span class="inline-note">${escapeHtml(a.code)}</span>`:''}</td>
      <td><span class="tag-chip">${escapeHtml(a.category)}</span></td>
      <td>${a.currency}</td>
      <td class="num">${fmtMoney(v)}</td>
      <td class="num">${fmtPct(pct(v),1)}</td>
      <td class="num">${dayCell}</td>
      <td class="num">${incCell}</td>
      <td class="num"><button class="btn secondary small" data-aedit="${a.id}">${icon('pencil')}</button>
        <button class="btn danger small" data-adel="${a.id}">${icon('trash')}</button></td>
    </tr>`;
  }).join('');
  const holdScroll = el(`<div class="table-scroll"><table>
    <thead><tr><th>名称</th><th>类别</th><th>币种</th><th class="num">折合人民币</th><th class="num">占比</th><th class="num">今日</th><th class="num">收益/利息</th><th></th></tr></thead>
    <tbody>${hrows}</tbody></table></div>`);
  holdCard.appendChild(holdScroll);
  // 行拖拽排序：拖动「全部持仓」行自定义顺序，存入 STATE.assetOrder 并同步云端
  {
    const tbody = holdScroll.querySelector('tbody');
    let dragId = null;
    tbody.querySelectorAll('tr.asset-row').forEach(tr => {
      tr.addEventListener('dragstart', () => { dragId = tr.dataset.aid; tr.classList.add('dragging'); });
      tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
      tr.addEventListener('dragover', e => { e.preventDefault(); tr.classList.add('drag-over'); });
      tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
      tr.addEventListener('drop', e => {
        e.preventDefault();
        tr.classList.remove('drag-over');
        const targetId = tr.dataset.aid;
        if (!dragId || dragId === targetId) return;
        const order = sorted.map(x => x.id);
        const from = order.indexOf(dragId), to = order.indexOf(targetId);
        if (from < 0 || to < 0) return;
        order.splice(to, 0, order.splice(from, 1)[0]);
        STATE.assetOrder = order;
        saveState();                             // saveState 自动回传云端
        render();
      });
    });
  }
  holdCard.appendChild(el(`<p class="inline-note">「今日」为基金估算涨跌 / 股票当日涨跌；收益列：理财/存款显示<strong>年化利息</strong>（美元按 3%、人民币按实际利率，美元金额按当日中间价 ${fx.toFixed(4)} 折人民币），股票/基金/黄金显示<strong>浮盈亏</strong>。</p>`));
  app.appendChild(holdCard);
  const refBtn = holdCard.querySelector('#pf-refresh');
  if (refBtn) refBtn.onclick = async () => {
    const old = refBtn.innerHTML; refBtn.disabled = true; refBtn.innerHTML = icon('refresh', 'spin') + ' 刷新中…';
    const r = await refreshAllQuotes();
    recordDailySnapshot();            // 值变了 → 记录今日快照（saveState 自动回传云端）
    render();
    // render 会重建视图；给个短暂提示
    const note = holdCard.querySelector('#pf-lastref');
    if (note) note.textContent = `刚刚（更新 ${r.updated}/${r.total}${r.failed?`，${r.failed} 失败`:''}）`;
  };

  // 管理资产：新增 / 编辑
  const mgmt = el(`<div class="card" style="margin-top:16px"><h3>${icon('pencil')} 管理资产（可随时增删改）</h3></div>`);
  mgmt.appendChild(el(`
    <div class="grid grid-3">
      <div class="field"><label>名称 <span class="req">*</span></label><input id="af-name" placeholder="如 招行黄金账户"/></div>
      <div class="field"><label>类别</label><select id="af-cat">${ASSET_CATEGORIES.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label>币种</label><select id="af-cur"><option>CNY</option><option>USD</option></select></div>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>金额（原币） <span class="req">*</span></label><input id="af-amount" type="number" step="0.01" placeholder="按币种填原币金额"/></div>
      <div class="field"><label>年利率 %（理财/存款，留空自动）</label><input id="af-rate" type="number" step="0.01" placeholder="美元自动3%/人民币按实际"/></div>
      <div class="field"><label>浮盈亏 ¥（股票/基金/黄金，可选）</label><input id="af-pnl" type="number" step="1" placeholder="如 -44636"/></div>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>代码（可选）</label><input id="af-code" placeholder="如 002518"/></div>
      <div class="field"><label>平台/账户（可选）</label><input id="af-platform" placeholder="如 招商银行 基金"/></div>
      <div class="field"><label>备注（可选）</label><input id="af-note"/></div>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>累计已实现收益 ¥（赎回/卖出落袋，可选）</label><input id="af-rpnl" type="number" step="1" placeholder="如 326——历史赎回赚到手的部分"/></div>
    </div>
    <div class="row" style="flex-wrap:wrap"><button class="btn" id="af-add" style="flex:0 0 auto">${icon('plus')} 添加资产</button>
      <button class="btn secondary" id="af-fx" style="flex:0 0 auto">${icon('refresh')} 换汇（美元 ↔ 人民币）</button></div>
    <input type="hidden" id="af-edit"/>
    <p class="inline-note" style="margin-top:10px">提示：股票的<strong>买卖请在「持仓」页改持股数</strong>——释放/占用的资金会自动结算到对应现金池（A股 → 股票现金池，美股 → 美股现金池），并同步回写这里的资产金额。<br>
      <strong>基金/理财/存款/黄金的赎回</strong>：直接在这里把「金额」改小（清仓改成 0），保存时会问你钱转入哪个账户，选实际到账的活期/存款即可，总资产自动守恒。<br>
      <strong>美元与人民币互换</strong>：点上面的「换汇」——那是账户之间搬钱，<em>不要</em>去出入金登记记一笔。</p>
  `));
  app.appendChild(mgmt);
  const $a = sel => mgmt.querySelector(sel);
  $a('#af-fx').onclick = () => showFxExchangeModal();

  $a('#af-add').onclick = async () => {
    const name = $a('#af-name').value.trim();
    if (!name) { alert('请填写名称'); return; }
    const cur = $a('#af-cur').value;
    const amount = num($a('#af-amount').value);
    const cat = $a('#af-cat').value;
    const rateStr = $a('#af-rate').value.trim();
    const pnlStr = $a('#af-pnl').value.trim();
    const rpnlStr = $a('#af-rpnl').value.trim();
    const editId = $a('#af-edit').value;
    // 赎回检测：编辑理财/存款且金额减少 → 保存后提示把这笔钱结转进现金池，防"钱凭空消失"
    const oldAsset = editId ? STATE.assets.find(x => x.id === editId) : null;
    const oldAmount = oldAsset ? num(oldAsset.amount) : 0;
    const asset = {
      id: editId || uid(), name, code: $a('#af-code').value.trim(),
      platform: $a('#af-platform').value.trim(), category: cat, currency: cur,
      amount, cny: cur === 'CNY' ? amount : amount * currentFx(),
      note: $a('#af-note').value.trim(),
    };
    if (rateStr !== '') asset.annualRate = num(rateStr) / 100;
    if (pnlStr !== '') asset.pnl = num(pnlStr);
    if (rpnlStr !== '') asset.realizedPnl = num(rpnlStr);
    logOp((editId ? '编辑资产：' : '新增资产：') + name);
    if (editId) {
      const i = STATE.assets.findIndex(x => x.id === editId);
      // 合并保存（不整体替换）：表单只覆盖它能编辑的字段，保留 shares / lastPx /
      // dayPct / pxDate / sodShares / sodDate / todayTrades 等运行期字段。
      // 否则改「金额」或「浮盈亏」时会把持股数、当日盈亏、当日交易记录一并清空——
      // 下次刷新又用 金额÷现价 反推出非整数股数，当日盈亏就和真实持股对不上了。
      if (i >= 0) {
        Object.assign(STATE.assets[i], asset);
        // 可刷新资产（基金/股票/黄金）直接改金额＝按现价补/减仓：同步校准份额，
        // 否则下次刷新会用「旧份额×最新价」把刚改的金额弹回、浮盈亏按差额跳变
        const oa = STATE.assets[i];
        if (assetFetchable(oa) && num(oa.lastPx) > 0 && num(oa.amount) > 0) {
          const implied = num(oa.shares) * num(oa.lastPx);
          if (!(implied > 0) || Math.abs(num(oa.amount) - implied) / implied > 0.001) {
            oa.shares = num(oa.amount) / num(oa.lastPx);
          }
        } else if (num(oa.amount) <= 0 && num(oa.shares) > 0) {
          // 金额清零=全部卖出/赎回：份额必须同步清零，否则下次刷新用旧份额×现价把金额"复活"
          oa.shares = 0;
        }
      }
    } else { STATE.assets.push(asset); }
    // 赎回/卖出结转：金额减少的差额提示一键入现金池（总资产守恒：某类资产↓＝现金↑）。
    // 覆盖「靠改金额来卖」的品类——场外基金、黄金、理财、定存（股票走「当日交易/减仓记账」，已自带入池）。
    // 关键提醒：场外基金 T+1~T+3 才到账，但赎回确认当日资金就已锁定为你的现金（不再随净值波动），
    // 所以【确认当天就该入池】，等实际到账无需再操作；否则这几天总资产凭空少一块、趋势里像是亏了。
    const SELL_BY_AMOUNT = ['理财(QDII)', '定期存款', '基金', '黄金'];
    if (editId && SELL_BY_AMOUNT.indexOf(cat) >= 0 && oldAmount - amount > 1) {
      const redeemed = oldAmount - amount;                  // 原币
      const inTransit = (cat === '基金')
        ? '<br><strong>场外基金 T+1~T+3 到账</strong>：赎回确认当日金额就已锁定（不再随净值波动），<strong>现在就该入账</strong>；钱真正到卡时无需再操作。'
        : '';
      const dest = await pickCashDestination({
        ccy: cur,
        title: '赎回款转入哪个账户？',
        subtitle: `「${escapeHtml(name)}」金额减少了 <strong>${fmtOrig(redeemed, cur)}</strong>（赎回/卖出）。这笔钱要记到下面这个账户，总资产才守恒。`,
        footnote: `基金/理财赎回一般回到<strong>银行活期或存款</strong>，不是股票现金池——按实际到账账户选。${inTransit}`,
      });
      creditCash(dest, redeemed, cur, name + (cat === '基金' ? ' 赎回(在途)' : ' 赎回'));
      if (dest && dest.mode === 'none') recordDailySnapshot();   // 选了不入账＝总资产真减少，覆盖今日快照
    }
    saveState(); render();
  };
  holdScroll.querySelectorAll('[data-adel]').forEach(b => b.onclick = () => {
    const a = STATE.assets.find(x => x.id === b.dataset.adel);
    // 两表联动：同一只股票（同 code）在「当前持仓」里也有时，一起删，避免残留、重复计数。
    const linkedPos = a && a.code ? (STATE.positions || []).find(x => x.code === a.code) : null;
    const msg = linkedPos
      ? `「${a.name}」在「全部持仓/资产」和「当前持仓」里都有。\n「确定」= 两处一起删除；「取消」= 不删。`
      : '删除这笔资产？';
    if (!confirm(msg)) return;
    logOp('删除资产：' + ((a && a.name) || '未知'));
    STATE.assets = STATE.assets.filter(x => x.id !== b.dataset.adel);
    if (linkedPos) STATE.positions = (STATE.positions || []).filter(x => x.id !== linkedPos.id);
    saveState(); render();
  });
  holdScroll.querySelectorAll('[data-aedit]').forEach(b => b.onclick = () => {
    const a = STATE.assets.find(x => x.id === b.dataset.aedit); if (!a) return;
    $a('#af-name').value = a.name || '';
    $a('#af-cat').value = a.category || 'A股股票';
    $a('#af-cur').value = a.currency || 'CNY';
    $a('#af-amount').value = a.amount != null ? a.amount : '';
    $a('#af-rate').value = a.annualRate != null ? (a.annualRate * 100) : '';
    $a('#af-pnl').value = a.pnl != null ? a.pnl : '';
    $a('#af-rpnl').value = a.realizedPnl != null ? a.realizedPnl : '';
    $a('#af-code').value = a.code || '';
    $a('#af-platform').value = a.platform || '';
    $a('#af-note').value = a.note || '';
    $a('#af-edit').value = a.id;
    $a('#af-add').innerHTML = icon('check') + ' 保存修改';
    mgmt.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // —— 客观量化指标（工具已算好，喂给点评并用于确定性健康分）——
  const s = STATE.settings;
  const positions = STATE.positions || [];
  const eff = Calc.effectiveBets(positions);
  const corrFn = corrResolver(STATE.corrCache);
  const corrEffN = Calc.corrEffectiveBets(positions, corrFn);
  const corrSrc = corrFn ? '实测' : '先验';
  const equityDD = positions.reduce((a, p) => a + Calc.drawdownContribution(num(p.weight), num(p.maxDrop)), 0);
  const level = EQUITY_RISK_LEVELS[s.equityRiskLevel] || EQUITY_RISK_LEVELS['进取'];
  let maxFactor = null, maxFactorW = 0;
  Object.entries(eff.factorWeights || {}).forEach(([f, w]) => { if (w > maxFactorW) { maxFactorW = w; maxFactor = f; } });
  const cashLiquid = cashAssetsCny();
  const liqPct = total > 0 ? cashLiquid / total * 100 : 0;
  const maxBigPct = Object.values(byBig).length ? Math.max.apply(null, Object.values(byBig)) / total * 100 : 0;
  const usdPct = pct(usdCny);
  const nStocks = positions.length;
  const health = computePortfolioHealth({ cashFloor: s.cashFloor, liqPct, maxBigPct, corrEffN, corrSrc, nStocks, equityDD, maxDD: num(s.maxDrawdown, 15), maxFactorW, factorCap: level.factor, usdPct });

  // —— 确定性健康分卡片（规则算出、可复现，不依赖 AI）——
  const healthCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('gauge')} 组合健康分（客观规则算出 · 非 AI 猜测 · 可复现）</h3>
    <p class="hint">每个维度按"离理想有多远"打分（不是"没超阈值就满分"）。<strong>满分近乎不存在，80+ 已属结构良好</strong>；黄色=良好但有优化空间、红色=需处理。</p></div>`);
  healthCard.appendChild(el(`<div class="metric-row"><span class="k">健康分（越高越健康）</span><span class="v" style="font-size:22px;color:${health.score>=70?'var(--green-ink)':health.score>=50?'var(--amber-ink)':'var(--red-ink)'}">${health.score}<span style="font-size:13px;color:var(--muted)"> /100</span></span></div>`));
  health.rows.forEach(([st, label, detail]) => healthCard.appendChild(el(`<div class="alert ${st==='bad'?'red':st==='warn'?'amber':'green'}" style="margin-top:8px"><span class="icon">${st==='bad'?icon('danger'):st==='warn'?icon('warn'):icon('check')}</span><div><strong>${label}</strong>：${escapeHtml(detail)}</div></div>`)));
  app.appendChild(healthCard);

  // —— AI 深度点评（解读健康分 + 目标相对建议）——
  const HZ = [['','未填'],['<1y','1年内'],['1-3y','1–3年'],['3-5y','3–5年'],['5y+','5年以上']];
  const RK = [['','未填'],['保守','保守'],['均衡','均衡'],['进取','进取']];
  const LQ = [['','未填'],['no','近1年不需动用'],['part','可能部分动用'],['yes','近1年需要动用']];
  const opt = (arr, cur) => arr.map(([v, t]) => `<option value="${v}" ${cur===v?'selected':''}>${t}</option>`).join('');
  const aiCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('sparkles')} AI 深度点评（解读健康分 + 目标相对建议）</h3>
    <p class="hint">先填你的目标语境，AI 才能给"目标相对"的建议而非泛泛而谈。健康分由上方规则算出，<strong>AI 只解释、不另造数字</strong>；数据经服务器代理，密钥不出前端。</p></div>`);
  aiCard.appendChild(el(`<div class="grid grid-2">
    <div class="field"><label>投资期限</label><select id="pf-h">${opt(HZ, s.profileHorizon)}</select></div>
    <div class="field"><label>风险承受</label><select id="pf-r">${opt(RK, s.profileRisk)}</select></div>
    <div class="field"><label>这笔钱近 1 年是否需要动用</label><select id="pf-l">${opt(LQ, s.profileLiquidity)}</select></div>
    <div class="field"><label>一句话目标（可选）</label><input id="pf-g" value="${escapeHtml(s.profileGoal||'')}" placeholder="如：5年内稳健增值、不大亏"/></div>
  </div>`));
  aiCard.appendChild(el(`<button class="btn" id="pf-ai">${icon('sparkles')} 生成 AI 组合诊断</button><div id="pf-ai-out" style="margin-top:12px"></div>`));
  app.appendChild(aiCard);
  const saveProfile = () => {
    s.profileHorizon = aiCard.querySelector('#pf-h').value;
    s.profileRisk = aiCard.querySelector('#pf-r').value;
    s.profileLiquidity = aiCard.querySelector('#pf-l').value;
    s.profileGoal = aiCard.querySelector('#pf-g').value.trim();
    saveState();
  };
  ['#pf-h', '#pf-r', '#pf-l'].forEach(sel => aiCard.querySelector(sel).onchange = saveProfile);
  aiCard.querySelector('#pf-g').onchange = saveProfile;

  // 组装摘要：喂"工具已算好的客观事实 + 健康分 + 目标语境"（不再喂缩水指标/编造假设）
  const bigLines = Object.entries(byBig).sort((a,b)=>b[1]-a[1]).map(([k, v]) => `${k} ${fmtPct(pct(v),1)}`).join('；');
  const topHold = assets.slice().sort((a,b)=>cnyOf(b)-cnyOf(a)).slice(0, 10)
    .map(a => `${a.name}(${a.category},${fmtPct(pct(cnyOf(a)),1)})`).join('；');
  const lqTxt = s.profileLiquidity === 'yes' ? '近1年需要动用' : s.profileLiquidity === 'part' ? '可能部分动用' : s.profileLiquidity === 'no' ? '近1年不需动用' : '未填';
  const buildSummary = () =>
`【个人投资组合，截止${STATE.portfolio.asOfDate||'今日'}，美元/人民币中间价 ${fx.toFixed(4)}】
总资产：${fmtMoney(total)}（折合人民币）。大类配置：${bigLines}。
可用现金(已排除锁定理财/定存)：${liqPct.toFixed(1)}%（现金下限 ${s.cashFloor}%）。美元敞口：${usdPct.toFixed(0)}%（人民币口径含汇率风险）。
股票子组合：名义 ${nStocks} 只，相关性有效持仓数 ${corrEffN?corrEffN.toFixed(1):'—'}（${corrSrc}口径），最大因子「${maxFactor||'无'}」占弹性仓 ${(maxFactorW*100).toFixed(0)}%（该风险档上限 ${level.factor}%）；弹性仓回撤贡献 ${equityDD.toFixed(1)}%（承受线 ${s.maxDrawdown}%）。
理财/存款利息约 ${fmtMoney(interestTotal)}（注：美元固收按 3% 假设估算、非实际数）；权益/黄金浮盈亏约 ${fmtMoney(pnlTotal)}（人民币口径）。主要持仓：${topHold}。
【工具已算出的客观健康分】${health.score}/100，逐项：${health.rows.map(r=>r[1]+(r[0]==='bad'?'⚠':r[0]==='warn'?'△':'✓')).join('、')}。
【用户目标语境】期限：${s.profileHorizon||'未填'}；风险承受：${s.profileRisk||'未填'}；流动性：${lqTxt}；目标：${s.profileGoal||'未填'}。`;

  aiCard.querySelector('#pf-ai').onclick = (e) => { saveProfile(); aiReview(buildSummary(), health.score, aiCard.querySelector('#pf-ai-out'), e.currentTarget.closest('button')); };
};

/* =========================================================================
   视图：市场指标看板 —— 集中放影响组合的关键宏观变量，随时参考
   原则：能自动拉的(A股/美股指数、汇率)自动拉；利率/通胀/债市等用结构化指标卡
   (当前值+含义+对你组合的影响+关注信号+官方来源)，你按发布节奏更新；再叠一层
   确定性的 regime 信号解读(不调用 AI、可复现、不臆造)。
   ========================================================================= */
// 自动刷新的"市场温度"标的（用现有行情代理；指数用显式腾讯符号）
// fmt：'cn'=A股/港股指数走腾讯(~分隔,价 p[3])；'us'=腾讯美股/指数(~分隔,价 p[3])；
//      'gb'/'int'=新浪(可能被源封IP，作备用)
const MACRO_MARKET = [
  { key: 'sh',    name: '上证指数', sym: 'sh000001', fmt: 'cn' },
  { key: 'hs300', name: '沪深300',  sym: 'sh000300', fmt: 'cn' },
  { key: 'cyb',   name: '创业板指', sym: 'sz399006', fmt: 'cn' },
  { key: 'kc50',  name: '科创50',   sym: 'sh000688', fmt: 'cn' },
  { key: 'ndx',   name: '纳斯达克', sym: 'usIXIC', fmt: 'us' },   // 腾讯美股指数(新浪封IP，改腾讯)
  { key: 'spx',   name: '标普500',  sym: 'usINX',  fmt: 'us' },
  { key: 'dji',   name: '道琼斯',   sym: 'usDJI',  fmt: 'us' },
  { key: 'hsi',   name: '恒生指数', sym: 'hkHSI',  fmt: 'cn' },   // 腾讯港股指数
];
// 手动维护的关键宏观指标（分组）——每项：含义 / 对你组合(人民币本位·A股+美股+黄金+美元资产)的影响 / 关注信号 / 来源
const MACRO_GROUPS = [
  { title: '利率 · 央行', items: [
    { key: 'fedUpper', name: '美联储基金利率(上限)', unit: '%', meaning: '美国政策利率，全球资产定价之锚。', impact: '越高→无息黄金与高估值成长股承压、美元走强；你的美元存款/短债票息更高。', watch: '看点阵图与降息节奏；转向降息利好风险资产与黄金。', src: 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm' },
    { key: 'fomcBias', name: '下次FOMC倾向', unit: '', meaning: '市场预期加息/降息/按兵不动（可填“降息25bp概率X%”）。', impact: '预期转鸽→提前利好成长与黄金。', watch: 'CME FedWatch 概率。', src: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html' },
    { key: 'cnLPR1', name: '中国 LPR 1年', unit: '%', meaning: '中国实体经济短端贷款基准。', impact: '下调→流动性宽松，利好 A股尤其成长/地产链。', watch: '每月20日公布。', src: 'http://www.pbc.gov.cn/' },
    { key: 'cnLPR5', name: '中国 LPR 5年', unit: '%', meaning: '房贷等长端基准。', impact: '下调→利好地产、银行让利、A股风险偏好。', watch: '每月20日。', src: 'http://www.pbc.gov.cn/' },
  ]},
  { title: '通胀 · 增长', items: [
    { key: 'usCPI', name: '美国 CPI 同比', unit: '%', meaning: '美国通胀，决定美联储松紧。', impact: '高→降息受限，压制估值与黄金短期；低→打开宽松空间。', watch: '每月中旬。', src: 'https://www.bls.gov/cpi/' },
    { key: 'usPCE', name: '美国 核心PCE', unit: '%', meaning: '美联储最看重的通胀口径。', impact: '同 CPI，更权威。', watch: '月末。', src: 'https://www.bea.gov/' },
    { key: 'usUnemp', name: '美国 失业率', unit: '%', meaning: '就业强弱，衰退与降息的关键。', impact: '走高→衰退担忧升温、避险(黄金/美债)受益、成长承压。', watch: '每月初非农。', src: 'https://www.bls.gov/' },
    { key: 'usPMI', name: '美国 ISM制造业PMI', unit: '', meaning: '荣枯线50。', impact: '<50 收缩→顺周期/大宗承压。', watch: '月初。', src: 'https://www.ismworld.org/' },
    { key: 'cnCPI', name: '中国 CPI 同比', unit: '%', meaning: '中国通胀/通缩温度。', impact: '偏低/为负→通缩压力，压制顺周期、利好债；也倒逼政策宽松。', watch: '每月上旬。', src: 'https://www.stats.gov.cn/' },
    { key: 'cnPMI', name: '中国 制造业PMI', unit: '', meaning: '荣枯线50。', impact: '>50 扩张→利好周期/顺周期 A股。', watch: '月末。', src: 'https://www.stats.gov.cn/' },
    { key: 'cnTSF', name: '中国 社融同比', unit: '%', meaning: '宽信用力度、A股流动性先行指标。', impact: '回升→A股流动性改善的领先信号。', watch: '每月中。', src: 'http://www.pbc.gov.cn/' },
  ]},
  { title: '债市 · 避险 · 汇率', items: [
    { key: 'ust10', name: '美债 10年收益率', unit: '%', meaning: '全球无风险利率之锚。', impact: '上行→压制黄金与成长股估值；你的美元债/存款再投资收益更高。', watch: '看与 2年的利差。', src: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' },
    { key: 'ust2', name: '美债 2年收益率', unit: '%', meaning: '最贴近美联储政策预期。', impact: '与10年比较判断曲线形态。', watch: '10Y−2Y 倒挂=衰退预警。', src: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' },
    { key: 'cn10', name: '中国 10年国债', unit: '%', meaning: '中国无风险利率。', impact: '下行→反映经济偏弱/宽松预期，利好债与红利。', watch: '与美债利差影响汇率。', src: 'https://www.chinabond.com.cn/' },
    { key: 'dxy', name: '美元指数 DXY', unit: '', meaning: '美元强弱。', impact: '强美元→压制黄金/新兴市场；你美元资产受益，但人民币计价的海外收益被汇率吃掉。', watch: '>105 偏强 / <98 偏弱。', src: 'https://www.marketwatch.com/investing/index/dxy' },
    { key: 'vix', name: 'VIX 恐慌指数', unit: '', meaning: '美股隐含波动率、市场情绪。', impact: '飙升→避险、波动放大，最易情绪化操作——铁律该发挥作用。', watch: '>25 恐慌 / <13 自满。', src: 'https://www.cboe.com/tradable_products/vix/' },
  ]},
];
const MACRO_ITEM_BY_KEY = {};
MACRO_GROUPS.forEach(g => g.items.forEach(it => { MACRO_ITEM_BY_KEY[it.key] = it; }));

// 方法论文案：点「详解」/商品瓦片弹窗展示——怎么读、看什么、对组合意味着什么动作
const MACRO_METHOD = {
  vix: 'VIX 由标普500期权价格反推的未来30天预期波动率（年化）。它强烈均值回归：飙到25以上的恐慌通常数周内回落，长期停在高位很罕见——所以高 VIX 更多是「别割肉、分批捡」的窗口而非卖出信号；低于13的自满期才是控杠杆、检查止损的时候。除水平外看变化速度：两天从15跳到25，比稳定在22危险得多。',
  dxy: '美元对六种主要货币的加权汇率指数（欧元占近六成）。对你有三层传导：①强美元压金价（计价效应）②压新兴市场与A股外资流入 ③抬高你美元资产的人民币价值——所以 DXY 上行对你不全是坏事，先看自己的美元敞口再定情绪。用 98/105 分界看「区间」，不预测点位。',
  fedUpper: '联邦基金目标利率上限，全球资产定价的分母。方向比水平重要：开始降息前后6个月通常是黄金与成长股最好的窗口；「higher for longer」则持续压估值。配合 CME FedWatch 的下次会议概率一起看，单次数据不构成方向。',
  fomcBias: '把 CME FedWatch 的下次会议概率抄进来即可（如「降息25bp概率70%」）。市场交易的是预期差：概率>80%的动作落地时几乎没有行情，「意外」才有行情。',
  ust10: '全球长期无风险利率，一切估值模型的锚。10Y 上行对高估值成长股伤害最大；黄金无息、与实际利率（10Y−通胀）负相关。重点不是水平而是：与2Y的利差（曲线形态）和变化速度——一个月内快速上行50bp以上才是需要防御的信号。',
  ust2: '对美联储未来1-2年政策路径最敏感的期限。10Y−2Y 利差是最著名的衰退领先指标：倒挂（为负）后6-18个月衰退概率大增；但注意「解除倒挂」（重新转正）往往才是衰退临近的信号。',
  cn10: '中国无风险利率与经济温度计。持续下行=资金避险+宽松预期，利好你的债基/理财底仓与红利股；快速上行=经济修复或资金面收紧。与美债10Y的利差决定人民币汇率压力方向。',
  usCPI: '看三个层次：同比水平（离2%目标多远）、环比动量（近3个月折年更灵敏）、核心分项（服务通胀最顽固）。数据公布前后美股波动放大——发布日别做大额操作。',
  usPCE: '美联储官方盯的通胀口径，权重比 CPI 更贴近实际消费结构，通常比 CPI 低0.3-0.5个百分点。规则同 CPI：水平看距离2%目标，动量看近3个月。',
  usUnemp: '失业率是滞后指标，但一旦趋势性上行就很难停：较过去12个月低点上行0.5个百分点（Sahm 规则）历史上几乎总对应衰退开始。它决定美联储从「抗通胀」切到「保就业」的时点——切换期黄金与债券通常最受益。',
  usPMI: '采购经理调查，50为荣枯线，比 GDP 早1-2个月反映拐点。连续3个月同向才算趋势；新订单分项比总指数更领先。扩张利好顺周期（铜/能源/周期股），收缩期成长与债占优。',
  cnPMI: '中国制造业景气调查，50为荣枯线。连续3个月同向才算趋势；新订单与生产分项背离时以新订单为准。持续>50 利好顺周期A股与铜，持续<50 时政策宽松预期反而会托底成长。',
  cnCPI: '低于0.5%即有通缩压力：名义增长受压、企业利润难扩张，压制顺周期，但利好债与高股息；同时是政策加码的催化剂——「差数据=宽松预期」在A股常表现为跌后反弹。',
  cnTSF: '社会融资规模同比，A股流动性最领先的指标之一：社融拐点历史上领先A股盈利拐点约2-3个季度。回升初期先利好券商/成长，随后传导到顺周期。',
  cnLPR1: 'LPR 是贷款定价基准（1年期影响企业短贷）。下调≥10bp 才算实质宽松信号；对你主要是「确认政策方向」，单次调整的边际影响已不大。',
  cnLPR5: '5年期 LPR 影响房贷与长期投资。下调=稳地产意图明确，利好地产链与银行让利逻辑的再平衡；连续按兵不动=政策定力，别把预期抢跑当事实。',
  c_gold: '你的双重敞口：实物金/黄金基金直接跟价格；紫金矿业的金板块利润≈(金价−完全成本)×产量——金价涨10%，矿企利润弹性常放大到20-30%。核心驱动：实际利率（负相关）、美元（负相关）、央行购金（近年最大边际买家）。纪律：金价单日−2%以上时先看 DXY 与美债实际利率有没有同步异动，没有则多为情绪波动、不动仓。',
  c_copper: '全球增长温度计，紫金第二引擎。供给端矿山品位下降+新矿建设周期7-10年；需求端电网/新能源车/AI数据中心都是铜密集——长期供需偏紧是紫金的核心逻辑。短期看 LME 库存与中国 PMI：库存快速下降+PMI>50 = 需求真实。',
  c_silver: '一半贵金属（跟金）、一半工业品（光伏用银占需求近三成）。金银比（金÷银）>85 说明银相对低估、<60 说明银已透支；银的波动约是金的1.5-2倍，不适合做底仓。',
  c_oil: '全球通胀的自变量：油价快速上行→通胀预期抬头→压制降息预期→间接压估值。对你组合是间接变量，主要通过美联储路径起作用；80美元以上开始成为风险资产逆风。',
  c_lith: '紫金第三引擎（2026-2028放量）。碳酸锂自2022年高点回落后长期磨底：价格在多数矿山成本线（6-8万/吨）附近徘徊越久，供给出清越充分、后续弹性越大。对紫金这是「看涨期权」性质的板块——别当确定性收益，锂价决定增量兑现度。',
  c_cuau: '同一家公司（紫金）的两台发动机对冲：经济向好→铜强金稳（比值升）；避险→金涨铜跌（比值降）。比值绝对水平没有好坏，方向变化才是信号：连续上行=顺周期资产可更积极；连续下行=仓位重心移向防御。这也是华尔街用 copper/gold ratio 判断美债利率方向的逻辑（比值与长端利率同向）。',
};
// 通用弹窗（点遮罩或「关闭」退出）
function showModal(titleHtml, bodyHtml) {
  const ov = el(`<div data-modal style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px">
    <div class="card" style="max-width:560px;width:100%;max-height:84vh;overflow:auto;margin:0">
      <div class="card-head-row"><h3 style="margin:0">${titleHtml}</h3><button class="btn secondary small" data-close style="flex:0 0 auto">关闭 ✕</button></div>
      <div>${bodyHtml}</div></div></div>`);
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) ov.remove(); });
  document.body.appendChild(ov);
}
// 换汇：美元现金 ↔ 人民币现金。本质是「一个账户减、另一个账户加」，与基金赎回同构，
// 区别在于要按成交汇率折算，且成交价与系统估值汇率的差额是真实的汇兑损益（会体现在总资产上）。
function showFxExchangeModal() {
  const fx = currentFx();
  const optsOf = ccy => cashDestChoices(ccy).map(a =>
    `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}（${fmtOrig(num(a.amount), ccy)}）</option>`).join('')
    + `<option value="__pool__">${escapeHtml(poolName(ccy))}（自动现金池）</option>`;
  const body = `
    <div class="field"><label>方向</label><select id="fx-dir">
      <option value="u2c">美元 → 人民币（结汇）</option>
      <option value="c2u">人民币 → 美元（购汇）</option></select></div>
    <div class="grid grid-2">
      <div class="field"><label>从（转出账户）</label><select id="fx-src"></select></div>
      <div class="field"><label>到（转入账户）</label><select id="fx-dst"></select></div>
    </div>
    <div class="grid grid-2">
      <div class="field"><label>转出金额（<span id="fx-srcccy">USD</span>）</label><input id="fx-amt" type="number" step="0.01" placeholder="如 5000"/></div>
      <div class="field"><label>成交汇率（1 USD = ? CNY）</label><input id="fx-rate" type="number" step="0.0001" value="${(+fx).toFixed(4)}"/></div>
    </div>
    <div id="fx-preview" class="alert" style="margin-top:10px"></div>
    <div class="row" style="margin-top:12px;flex-wrap:wrap">
      <button class="btn" id="fx-go" style="flex:0 0 auto">确认换汇</button>
      <button class="btn secondary" data-close style="flex:0 0 auto">取消</button></div>
    <p class="inline-note" style="margin-top:8px">换汇<strong>不是出入金</strong>（钱没离开组合），所以不要去「出入金登记」记一笔——那会把收益率算错。
      成交汇率与系统估值汇率（当前 ${(+fx).toFixed(4)}）不同时，差额是真实的<strong>汇兑损益</strong>，总资产会相应变动。</p>`;
  showModal('换汇（美元 ↔ 人民币）', body);
  const ov = [...document.querySelectorAll('[data-modal]')].pop();
  const $ = s => ov.querySelector(s);
  const dirCcy = () => $('#fx-dir').value === 'u2c' ? ['USD', 'CNY'] : ['CNY', 'USD'];
  const fillSel = () => {
    const [s, d] = dirCcy();
    $('#fx-src').innerHTML = optsOf(s); $('#fx-dst').innerHTML = optsOf(d);
    $('#fx-srcccy').textContent = s;
  };
  const calc = () => {
    const [s] = dirCcy();
    const amt = num($('#fx-amt').value), rate = num($('#fx-rate').value);
    if (!(amt > 0) || !(rate > 0)) return null;
    const recv = s === 'USD' ? amt * rate : amt / rate;          // 到账原币
    const outCny = s === 'USD' ? amt * fx : amt;                 // 转出侧折人民币（系统估值口径）
    const inCny = s === 'USD' ? recv : recv * fx;                // 到账侧折人民币
    return { amt, rate, recv, diff: inCny - outCny, srcCcy: s, dstCcy: s === 'USD' ? 'CNY' : 'USD' };
  };
  const preview = () => {
    const c = calc();
    if (!c) { $('#fx-preview').innerHTML = '<span class="inline-note">填入金额与成交汇率后显示折算结果。</span>'; return; }
    const srcAsset = (STATE.assets || []).find(a => a.id === $('#fx-src').value);
    const bal = $('#fx-src').value === '__pool__' ? stockCashPoolBalance(c.srcCcy) : num((srcAsset || {}).amount);
    const short = c.amt > bal + 0.005;
    $('#fx-preview').innerHTML = `<div>转出 <strong>${fmtOrig(c.amt, c.srcCcy)}</strong> → 到账 <strong>${fmtOrig(c.recv, c.dstCcy)}</strong></div>
      <div style="margin-top:4px;color:${Math.abs(c.diff) < 1 ? 'var(--muted)' : (c.diff >= 0 ? 'var(--green-ink)' : 'var(--red-ink)')}">
        汇兑损益 ${c.diff >= 0 ? '+' : ''}${fmtMoney(c.diff)}（成交价 ${(+c.rate).toFixed(4)} vs 系统估值 ${(+fx).toFixed(4)}）</div>
      ${short ? `<div style="margin-top:4px;color:var(--red-ink)">转出账户只有 ${fmtOrig(bal, c.srcCcy)}，不够扣。</div>` : ''}`;
  };
  $('#fx-dir').onchange = () => { fillSel(); preview(); };
  ['#fx-amt', '#fx-rate', '#fx-src', '#fx-dst'].forEach(s => { $(s).oninput = preview; $(s).onchange = preview; });
  fillSel(); preview();
  $('#fx-go').onclick = () => {
    const c = calc();
    if (!c) { alert('请填写转出金额与成交汇率'); return; }
    const srcId = $('#fx-src').value, dstId = $('#fx-dst').value;
    const srcAsset = (STATE.assets || []).find(a => a.id === srcId);
    const bal = srcId === '__pool__' ? stockCashPoolBalance(c.srcCcy) : num((srcAsset || {}).amount);
    if (c.amt > bal + 0.005) { alert(`转出账户只有 ${fmtOrig(bal, c.srcCcy)}，扣不出 ${fmtOrig(c.amt, c.srcCcy)}。`); return; }
    if (srcId === dstId) { alert('转出与转入不能是同一个账户。'); return; }
    if (!confirm(`确认换汇：\n转出 ${fmtOrig(c.amt, c.srcCcy)} → 到账 ${fmtOrig(c.recv, c.dstCcy)}\n汇兑损益 ${c.diff >= 0 ? '+' : ''}${fmtMoney(c.diff)}\n\n（钱没离开组合，不要再去出入金登记记一笔）`)) return;
    logOp(`换汇 ${fmtOrig(c.amt, c.srcCcy)} → ${fmtOrig(c.recv, c.dstCcy)} @${(+c.rate).toFixed(4)}`);
    if (srcId === '__pool__') settleToPool(-c.amt, c.srcCcy, '换汇转出');
    else if (srcAsset) {
      srcAsset.amount = Math.max(0, Math.round((num(srcAsset.amount) - c.amt) * 100) / 100);
      srcAsset.cny = Math.round(assetCny(srcAsset, currentFx()));
    }
    creditCash(dstId === '__pool__' ? { mode: 'pool' } : { mode: 'asset', id: dstId },
      c.recv, c.dstCcy, `换汇转入 @${(+c.rate).toFixed(4)}`);
    recordDailySnapshot();          // 汇兑损益会改总资产 → 覆盖今日快照
    saveState(); ov.remove(); render();
  };
}
// 指标详解弹窗：当前值 + 大刻度条 + 走势 + 分区依据 + 方法论 + 对组合的含义
function showIndicatorModal(key) {
  const it = MACRO_ITEM_BY_KEY[key];
  if (!it) return;
  const m = STATE.macro || {};
  const cur = (m.ind && m.ind[key]) || {};
  const val = cur.value != null ? num(cur.value, NaN) : NaN;
  const z = MACRO_ZONES[key];
  let html = `<div class="stat" style="margin-bottom:8px"><div class="label">当前值${it.unit ? '（' + it.unit + '）' : ''}</div>
    <div class="value" style="font-size:24px">${isFinite(val) ? val : (cur.value != null ? escapeHtml(String(cur.value)) : '未填写')}</div>
    <div class="sub">${cur.date ? '更新于 ' + escapeHtml(cur.date) : '在市场指标页填入或自动拉取'}</div></div>`;
  if (isFinite(val) && z) html += `<div style="margin:10px 0">${scaleBarHtml(val, z, true)}</div>`;
  const spark = sparklineHtml(key, 260, 48);
  if (spark) html += `<div style="margin:10px 0">${spark} ${histDeltaHtml(key)}</div>`;
  html += `<h4 style="margin:12px 0 6px">这是什么</h4><p style="font-size:13px;line-height:1.6;margin:0">${escapeHtml(it.meaning)}</p>`;
  if (z) html += `<h4 style="margin:12px 0 6px">分区怎么划的</h4>${zoneLegendHtml(z)}`;
  if (MACRO_METHOD[key]) html += `<h4 style="margin:12px 0 6px">方法论 · 怎么用</h4><p style="font-size:13px;line-height:1.6;margin:0">${MACRO_METHOD[key]}</p>`;
  html += `<h4 style="margin:12px 0 6px">对你的组合</h4><p style="font-size:13px;line-height:1.6;margin:0">${escapeHtml(it.impact)}</p>`;
  html += `<p style="font-size:12px;color:var(--muted);margin-top:10px"><strong>关注节奏</strong>：${escapeHtml(it.watch)} · <a href="${it.src}" target="_blank" rel="noopener" style="color:var(--accent-ink)">官方来源↗</a></p>`;
  showModal(escapeHtml(it.name), html);
}
// 商品详解弹窗：价格 + 走势 + 你的敞口 + 方法论
function showCmdtyModal(key) {
  const cd = CMDTY_LIST.find(x => x.key === key) || (key === 'cuau' ? { key: 'cuau', name: '铜金比（增长/避险温度计）', unit: '' } : null);
  if (!cd) return;
  const it = (STATE.macro && STATE.macro.cmdty && STATE.macro.cmdty.items && STATE.macro.cmdty.items[key]) || null;
  let html = '';
  if (it) html += `<div class="stat" style="margin-bottom:8px"><div class="label">当前价${cd.unit ? '（' + cd.unit + '）' : ''}</div>
    <div class="value" style="font-size:24px;color:${it.chg == null ? 'inherit' : (it.chg >= 0 ? 'var(--green-ink)' : 'var(--red-ink)')}">${(+it.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
    <div class="sub">${it.chg != null ? (it.chg >= 0 ? '+' : '') + it.chg.toFixed(2) + '% · ' : ''}${escapeHtml(it.date || '')}</div></div>`;
  else html += `<p class="inline-note">尚未拉取，点「拉取商品价格」。</p>`;
  const spark = sparklineHtml('c_' + key, 260, 48);
  if (spark) html += `<div style="margin:10px 0">${spark} ${histDeltaHtml('c_' + key)}</div>`;
  if (key === 'gold' || key === 'copper' || key === 'lith' || key === 'cuau') {
    const exp = goldCopperExposure();
    if (exp.gold + exp.zijin > 0) html += `<div class="alert blue" style="margin:10px 0"><span class="icon">${icon('info')}</span><div>你的相关敞口：实物金/黄金基金 ${fmtMoney(exp.gold)}${exp.zijin > 0 ? ' + 紫金矿业 ' + fmtMoney(exp.zijin) : ''}。</div></div>`;
  }
  if (MACRO_METHOD['c_' + key]) html += `<h4 style="margin:12px 0 6px">方法论 · 怎么用</h4><p style="font-size:13px;line-height:1.6;margin:0">${MACRO_METHOD['c_' + key]}</p>`;
  showModal(escapeHtml(cd.name), html);
}

// 取新浪 hq.sinajs.cn 一行报价，逗号切分为字段数组
async function sinaFields(sym) {
  const t = await getQuoteText('/api/quote_sina?code=' + encodeURIComponent(sym));
  const m = t.match(/"([^"]*)"/);
  if (!m || !m[1]) throw new Error('无数据');
  return m[1].split(',');
}
async function fetchIndexQuote(item) {
  if (item.fmt === 'cn') return parseTencent(await getQuoteText('/api/quote?code=' + encodeURIComponent(item.sym)), { us: false });
  if (item.fmt === 'us') return parseTencent(await getQuoteText('/api/quote?code=' + encodeURIComponent(item.sym)), { us: true });
  const f = await sinaFields(item.sym);   // 新浪备用
  const price = parseFloat(f[1]);
  const changePct = item.fmt === 'int' ? parseFloat(f[3]) : parseFloat(f[2]);
  if (!isFinite(price)) throw new Error('解析失败');
  return { name: f[0], price, changePct: isFinite(changePct) ? changePct : null };
}

/* -------------------------------------------------------------------------
   宏观自动拉取（试验）：免 key、境内可达的数据源。VIX/美股指数走腾讯(/api/quote)；
   美元指数走东财(/api/emquote)；中国 CPI/PMI/LPR 走东财数据中心(/api/emmacro)；
   美国 CPI/失业/联邦利率/核心PCE/PMI 走金十(/api/jin10)。拉不到就保留手填、绝不覆盖为空。
   美债10Y 暂无可靠免 key 源（腾讯 usTNX/hf_TNX 均下架、新浪封 IP），保持手填。
   ------------------------------------------------------------------------- */
// 每个指标配多个候选源，逐个尝试直到取到有效值（新浪已封服务器 IP，不再作候选源）。
// 源类型：thf(腾讯 hf_外盘或us美股) / emq(东财实时报价) / em(东财中国宏观) / emus(东财美国) / jin10(金十)
// range=[min,max] 合理区间：取到但超区间→判为无效(避免"假成功"，如美元指数取到 3554)，
// 并在诊断里附上原始返回，便于校准取值位置。
const MACRO_AUTO = [
  { key: 'dxy',    label: '美元指数',   range: [70, 130], sources: [ { kind: 'emq', secid: '100.UDI' } ] },
  { key: 'vix',    label: 'VIX',        range: [5, 95],   sources: [ { kind: 'thf', sym: 'usVIX', field: 3 } ] },
  { key: 'cnCPI',  label: '中国CPI',    range: [-6, 20],  sources: [ { kind: 'em', report: 'RPT_ECONOMY_CPI', sort: 'REPORT_DATE', pick: ['NATIONAL_SAME'] } ] },
  { key: 'cnPMI',  label: '中国PMI',    range: [20, 80],  sources: [ { kind: 'em', report: 'RPT_ECONOMY_PMI', sort: 'REPORT_DATE', pick: ['MAKE_INDEX'] } ] },
  { key: 'cnLPR1', label: 'LPR 1年',    range: [0, 15],   sources: [ { kind: 'em', report: 'RPTA_WEB_RATE', sort: 'TRADE_DATE', pick: ['LPR1Y', 'LPR_1Y', 'LPR1', 'LPR_1'] } ] },
  { key: 'cnLPR5', label: 'LPR 5年',    range: [0, 15],   sources: [ { kind: 'em', report: 'RPTA_WEB_RATE', sort: 'TRADE_DATE', pick: ['LPR5Y', 'LPR_5Y', 'LPR5', 'LPR_5'] } ] },
  { key: 'usCPI',   label: '美国CPI',   range: [-6, 20],  sources: [ { kind: 'emus', ind: 'EMG00000733' } ] },
  { key: 'fedUpper',label: '美联储利率',range: [0, 15],   sources: [ { kind: 'jin10', attr: 24 } ] },
  { key: 'usUnemp', label: '美国失业率',range: [0, 30],   sources: [ { kind: 'jin10', attr: 47 } ] },
  { key: 'usPCE',   label: '美国核心PCE',range:[-6, 20],  sources:[ { kind: 'jin10', attr: 80 } ] },
  { key: 'usPMI',   label: '美国PMI',   range: [20, 80], sources: [ { kind: 'jin10', attr: 28 } ] },
];
// 通用取原始文本（诊断用）
async function fetchRaw(url) {
  const res = await fetch(url, { cache: 'no-store' });
  let text = ''; try { text = await res.text(); } catch (e) { text = '(读取失败)'; }
  return { ok: res.ok, status: res.status, text };
}
const macroClip = s => String(s == null ? '' : s).replace(/\s+/g, ' ').slice(0, 380);
// 单个源取值 → { value, raw }（value 为 null 表示该源没取到，继续下一个源）
async function fetchMacroSource(src) {
  try {
    if (src.kind === 'sina') {
      const r = await fetchRaw('/api/quote_sina?code=' + encodeURIComponent(src.sym));
      const mm = r.text.match(/"([^"]*)"/); const f = mm ? mm[1].split(',') : [];
      let v = parseFloat(f[src.field]); if (src.div && isFinite(v)) v = v / src.div;
      return { value: isFinite(v) ? v : null, raw: 'sina/' + src.sym + ' HTTP' + r.status + ' ' + macroClip(r.text) };
    }
    if (src.kind === 'thf') {
      const r = await fetchRaw('/api/quote?code=' + encodeURIComponent(src.sym));
      const mm = r.text.match(/"([^"]*)"/); const delim = /^hf_/.test(src.sym) ? ',' : '~';
      const p = mm ? mm[1].split(delim) : [];
      let v = parseFloat(p[src.field]); if (src.div && isFinite(v)) v = v / src.div;
      return { value: isFinite(v) ? v : null, raw: 'tx/' + src.sym + ' HTTP' + r.status + ' ' + macroClip(r.text) };
    }
    if (src.kind === 'emq') {
      // 东财实时报价（/api/emquote）：f43 现价需 ÷10^f59，如美元指数 100.UDI
      const r = await fetchRaw('/api/emquote?secid=' + encodeURIComponent(src.secid) + '&fields=f43,f59');
      let v = null; try { const d = JSON.parse(r.text).data; if (d && isFinite(d.f43)) v = d.f43 / Math.pow(10, d.f59 || 0); } catch (e) {}
      return { value: v, raw: 'emq/' + src.secid + ' HTTP' + r.status + ' ' + macroClip(r.text) };
    }
    if (src.kind === 'em') {
      const r = await fetchRaw('/api/emmacro?reportName=' + src.report + '&columns=ALL&pageSize=1&sortColumns=' + src.sort + '&sortTypes=-1&source=WEB&client=WEB');
      let v = null; try { const row = JSON.parse(r.text).result.data[0]; for (const k of src.pick) { const x = parseFloat(row[k]); if (isFinite(x)) { v = x; break; } } } catch (e) {}
      return { value: v, raw: 'em/' + src.report + ' HTTP' + r.status + ' ' + macroClip(r.text) };
    }
    if (src.kind === 'emus') {
      // 多取几行：最新月常「已统计未发布」(VALUE=null)，取最近一个有值的 VALUE；都无则用最新行的前值 PRE_VALUE
      const r = await fetchRaw('/api/emmacro?reportName=RPT_ECONOMICVALUE_USA&columns=ALL&pageSize=8&filter=' + encodeURIComponent('(INDICATOR_ID="' + src.ind + '")') + '&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB');
      let v = null; try {
        const rows = JSON.parse(r.text).result.data;
        for (const row of rows) { const x = parseFloat(row.VALUE); if (isFinite(x)) { v = x; break; } }
        if (v == null && rows[0]) { const pv = parseFloat(rows[0].PRE_VALUE); if (isFinite(pv)) v = pv; }
      } catch (e) {}
      return { value: v, raw: 'emus/' + src.ind + ' HTTP' + r.status + ' ' + macroClip(r.text) };
    }
    if (src.kind === 'jin10') {
      const r = await fetchRaw('/api/jin10?category=ec&attr_id=' + src.attr + '&max_date=&_=' + Date.now());
      let v = null; try {
        const jd = JSON.parse(r.text).data;
        let vi = 1; if (Array.isArray(jd.keys)) { const ki = jd.keys.findIndex(x => /今值|现值/.test(x && x.name)); if (ki >= 0) vi = ki; }
        for (const row of (jd.values || [])) { const x = parseFloat(row[vi]); if (isFinite(x)) { v = x; break; } }
      } catch (e) {}
      return { value: v, raw: 'jin10/' + src.attr + ' HTTP' + r.status + ' ' + macroClip(r.text) };
    }
  } catch (e) { return { value: null, raw: (src.kind || '?') + ' 异常:' + macroClip(e.message) }; }
  return { value: null, raw: '未知源' };
}
async function autoPullMacro() {
  const m = STATE.macro; m.market = m.market || {}; m.ind = m.ind || {};
  const detail = []; const diag = []; let ok = 0, fail = 0;
  await Promise.all(MACRO_MARKET.map(async it => {
    try { const q = await fetchIndexQuote(it); if (isFinite(q.price)) { m.market[it.key] = { price: q.price, changePct: q.changePct, date: todayStr() }; } } catch (e) { /* 保留旧值 */ }
  }));
  for (const a of MACRO_AUTO) {
    let v = null; const attempts = [];
    for (const src of a.sources) {                 // 逐个候选源尝试，取到且在合理区间就停
      const res = await fetchMacroSource(src);
      let note = res.raw;
      if (res.value != null && isFinite(res.value)) {
        if (!a.range || (res.value >= a.range[0] && res.value <= a.range[1])) { attempts.push(note); v = res.value; break; }
        note += ' ⚠取到 ' + res.value + ' 超出合理区间[' + a.range + ']，判无效';   // 假成功→暴露原始返回
      }
      attempts.push(note);
    }
    if (v != null && isFinite(v)) { m.ind[a.key] = { value: +v.toFixed(2), date: todayStr() }; pushMacroHist(a.key, +v.toFixed(2)); ok++; detail.push(a.label + '✓'); diag.push({ label: a.label, ok: true, raw: String(+v.toFixed(2)) }); }
    else { fail++; detail.push(a.label + '✗'); diag.push({ label: a.label, ok: false, raw: attempts.join('  ‖  ') }); }
  }
  if (ok > 0) m.updatedAt = todayStr();               // 全失败不盖今天的章，避免掩盖失败
  m.lastPull = { date: todayStr(), diag }; saveState();
  return { ok, fail, detail, diag };
}

/* ---- 指标历史（每次拉取/手填都记一个点，用于迷你走势线与「较上次」）---- */
function macroHistOf(key) {
  const h = STATE.macro && STATE.macro.hist;
  return (h && Array.isArray(h[key])) ? h[key] : [];
}
function pushMacroHist(key, v) {
  if (v == null || !isFinite(v)) return;
  const m = STATE.macro; m.hist = m.hist || {};
  const arr = m.hist[key] = m.hist[key] || [];
  const t = todayStr();
  if (arr.length && arr[arr.length - 1].d === t) arr[arr.length - 1].v = v;   // 同日覆盖
  else arr.push({ d: t, v });
  if (arr.length > 180) arr.splice(0, arr.length - 180);
}
// 迷你走势线（最近30个点，无坐标轴，仅示形态）
function sparklineHtml(key, w, h) {
  w = w || 88; h = h || 22;
  const pts = macroHistOf(key).slice(-30);
  if (pts.length < 2) return '';
  const vs = pts.map(p => p.v);
  let mn = Math.min(...vs), mx = Math.max(...vs);
  if (mn === mx) { const d = Math.abs(mn) * 0.02 || 1; mn -= d; mx += d; }
  const poly = pts.map((p, i) => `${(i / (pts.length - 1) * (w - 2) + 1).toFixed(1)},${(1 + (h - 2) * (1 - (p.v - mn) / (mx - mn))).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle;flex:0 0 auto"><polyline points="${poly}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
// 「较上次」变化（与上一个记录点比；方向好坏因指标而异，用中性色+箭头）
function histDeltaHtml(key, digits) {
  const pts = macroHistOf(key);
  if (pts.length < 2) return '';
  const cur = pts[pts.length - 1], prev = pts[pts.length - 2];
  const d = cur.v - prev.v;
  if (!isFinite(d)) return '';
  if (d === 0) return `<span class="inline-note">持平</span>`;
  const dg = digits != null ? digits : (Math.abs(d) >= 10 ? 0 : 2);
  return `<span class="inline-note" title="上次 ${escapeHtml(prev.d)}：${prev.v}" style="color:var(--ink-2)">${d > 0 ? '▲' : '▼'}${Math.abs(d).toFixed(dg)}</span>`;
}

/* ---- 刻度条：把「数字」变成「位置」。分区色带 + 当前值标记，不用记阈值 ---- */
const ZONE_FILL = { green: 'rgba(52,199,89,.16)', amber: 'rgba(255,159,10,.20)', red: 'rgba(255,59,48,.16)', blue: 'rgba(10,132,255,.14)' };
// zones: [到哪为止, 标签, 色]，最后一段用 Infinity；min/max 是画布范围
const MACRO_ZONES = {
  vix:      { min: 8, max: 40, zones: [[13, '自满', 'amber'], [20, '正常', 'green'], [25, '警惕', 'amber'], [Infinity, '恐慌', 'red']] },
  dxy:      { min: 88, max: 118, zones: [[98, '弱美元', 'blue'], [105, '中性', 'green'], [Infinity, '强美元', 'amber']] },
  fedUpper: { min: 0, max: 7, zones: [[2, '宽松', 'blue'], [4.5, '中性', 'green'], [Infinity, '限制性', 'amber']] },
  ust10:    { min: 0, max: 7, zones: [[3, '温和', 'green'], [4.5, '偏高', 'amber'], [Infinity, '高压', 'red']] },
  ust2:     { min: 0, max: 7, zones: [[3, '温和', 'green'], [4.5, '偏高', 'amber'], [Infinity, '高压', 'red']] },
  cn10:     { min: 0.5, max: 4.5, zones: [[2, '低利率', 'blue'], [Infinity, '正常', 'green']] },
  usCPI:    { min: -1, max: 9, zones: [[2, '低', 'green'], [3, '目标附近', 'green'], [Infinity, '偏高', 'amber']] },
  usPCE:    { min: -1, max: 9, zones: [[2, '低', 'green'], [3, '目标附近', 'green'], [Infinity, '偏高', 'amber']] },
  cnCPI:    { min: -2, max: 6, zones: [[0.5, '通缩压力', 'amber'], [3, '温和', 'green'], [Infinity, '偏热', 'amber']] },
  cnPMI:    { min: 44, max: 56, zones: [[50, '收缩', 'amber'], [Infinity, '扩张', 'green']] },
  usPMI:    { min: 44, max: 56, zones: [[50, '收缩', 'amber'], [Infinity, '扩张', 'green']] },
  usUnemp:  { min: 2, max: 9, zones: [[4.5, '强劲', 'green'], [5.5, '正常', 'green'], [Infinity, '走弱', 'amber']] },
};
function scaleBarHtml(value, z, wide) {
  if (value == null || !isFinite(value) || !z) return '';
  const span = z.max - z.min;
  let prev = z.min, segs = '';
  z.zones.forEach(([to, label, color]) => {
    const end = Math.min(to === Infinity ? z.max : to, z.max);
    const w = Math.max(0, (end - prev) / span * 100);
    // 窄分区（<14%）不放文字（会被裁切、看着像挤进邻区），悬停/长按看提示
    if (w > 0) segs += `<div title="${escapeHtml(label)}" style="width:${w.toFixed(1)}%;background:${ZONE_FILL[color]};display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted);overflow:hidden;white-space:nowrap">${w >= 14 ? escapeHtml(label) : ''}</div>`;
    prev = Math.max(prev, end);
  });
  const pos = Math.max(1, Math.min(99, (value - z.min) / span * 100));
  return `<div style="position:relative;height:18px;border-radius:4px;overflow:hidden;display:flex;min-width:130px;${wide ? '' : 'max-width:230px'}">${segs}
    <div style="position:absolute;left:${pos.toFixed(1)}%;top:0;bottom:0;width:2px;background:var(--ink);transform:translateX(-1px)"></div></div>`;
}
// 分区划分依据（弹窗里展示：每一段的区间与含义）
function zoneLegendHtml(z) {
  if (!z) return '';
  let prev = z.min;
  const rows = z.zones.map(([to, label, color]) => {
    const range = to === Infinity ? '≥ ' + prev : prev + ' ~ ' + to;
    const r = `<tr><td class="num" style="white-space:nowrap">${range}</td><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${ZONE_FILL[color]};border:1px solid rgba(127,127,127,.35);vertical-align:middle"></span> ${escapeHtml(label)}</td></tr>`;
    if (to !== Infinity) prev = to;
    return r;
  }).join('');
  return `<div class="table-scroll"><table><thead><tr><th class="num">区间</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// 确定性 regime 信号：读已填指标，输出对「你这种组合」的含义。无 AI、可复现、不臆造。
// 返回 {t: red/amber/blue, tag: 徽章短语, msg: 展开详情}
function macroSignals() {
  const g = (k) => { const v = STATE.macro && STATE.macro.ind && STATE.macro.ind[k]; const n = v ? num(v.value, NaN) : NaN; return isFinite(n) ? n : null; };
  const out = [];
  const y10 = g('ust10'), y2 = g('ust2');
  if (y10 != null && y2 != null) {
    const sp = y10 - y2;
    if (sp < 0) out.push({ t: 'red', tag: '曲线倒挂', msg: `美债收益率曲线倒挂（10Y ${y10}% < 2Y ${y2}%，利差 ${sp.toFixed(2)}%）：历史上领先经济衰退 6–18 个月，风险资产中期需谨慎，优先保本与分散、备足现金。` });
    else if (sp < 0.3) out.push({ t: 'amber', tag: '利差偏平', msg: `美债利差偏平（10Y−2Y ${sp.toFixed(2)}%）：曲线接近倒挂，留意衰退前兆。` });
  }
  const fed = g('fedUpper');
  if (fed != null) {
    if (fed >= 4.5) out.push({ t: 'amber', tag: '高利率', msg: `美联储高利率（${fed}%）：无息黄金与高估值成长股承压、美元偏强；你的美元存款/短债有票息优势，但人民币计价的海外收益会被汇率侵蚀。` });
    else if (fed <= 2) out.push({ t: 'blue', tag: '低利率', msg: `低利率环境（${fed}%）：整体利好风险资产与黄金。` });
  }
  const dxy = g('dxy');
  if (dxy != null) {
    if (dxy >= 105) out.push({ t: 'amber', tag: '强美元', msg: `强美元（DXY ${dxy}）：压制黄金/新兴市场/大宗；你的美元资产受益，但人民币口径的海外收益被汇率吃掉——注意你的美元敞口。` });
    else if (dxy <= 98) out.push({ t: 'blue', tag: '弱美元', msg: `弱美元（DXY ${dxy}）：利好黄金、新兴市场与非美资产。` });
  }
  const vix = g('vix');
  if (vix != null) {
    if (vix >= 25) out.push({ t: 'red', tag: 'VIX恐慌', msg: `市场恐慌（VIX ${vix}）：波动放大，最容易情绪化操作——正是「铁律校验/止损防御」该发挥作用的时候，别追跌杀跌。` });
    else if (vix <= 13) out.push({ t: 'amber', tag: '低波自满', msg: `波动极低（VIX ${vix}）：市场自满，警惕尾部风险与拥挤交易，别在低波中过度加杠杆/加仓。` });
  }
  const cpiCN = g('cnCPI');
  if (cpiCN != null && cpiCN < 0.5) out.push({ t: 'amber', tag: '中国通缩压力', msg: `中国 CPI 偏低（${cpiCN}%）：通缩压力、实际利率偏高，压制顺周期、利好债与红利；也倒逼政策进一步宽松。` });
  const cpiUS = g('usCPI');
  if (cpiUS != null && cpiUS >= 3) out.push({ t: 'amber', tag: '美通胀偏高', msg: `美国通胀仍偏高（CPI ${cpiUS}%）：美联储降息受限，短期压制估值与黄金。` });
  const pmiCN = g('cnPMI');
  if (pmiCN != null) {
    if (pmiCN < 50) out.push({ t: 'amber', tag: '中国PMI收缩', msg: `中国制造业PMI ${pmiCN}<50（收缩）：顺周期/工业链需求偏弱。` });
    else if (pmiCN >= 50.5) out.push({ t: 'blue', tag: '中国PMI扩张', msg: `中国制造业PMI ${pmiCN}>50（扩张）：利好周期与顺周期 A股。` });
  }
  return out;
}

/* -------------------------------------------------------------------------
   大宗商品（金/银/铜/油/锂）：腾讯外盘 hf_ 系列为主、东财期货报价备用。
   对你组合：黄金资产+紫金矿业(金铜锂三重敞口) → 商品价格是直接的利润驱动。
   铜金比 = LME铜($/吨) ÷ COMEX金($/盎司)：上行=增长预期(利铜)，下行=避险(利金)。
   ------------------------------------------------------------------------- */
const CMDTY_LIST = [
  { key: 'gold',   name: '黄金 COMEX',  unit: '美元/盎司', digits: 1, range: [1000, 10000],  sources: [{ kind: 'thf', sym: 'hf_GC' }, { kind: 'emq', secid: '101.GC00Y' }] },
  { key: 'copper', name: '铜 LME',      unit: '美元/吨',   digits: 0, range: [3000, 20000],  sources: [{ kind: 'thf', sym: 'hf_CAD' }, { kind: 'emq', secid: '120.CAD' }] },
  { key: 'silver', name: '白银 COMEX',  unit: '美元/盎司', digits: 2, range: [5, 200],       sources: [{ kind: 'thf', sym: 'hf_SI' }, { kind: 'emq', secid: '101.SI00Y' }] },
  { key: 'oil',    name: '原油 WTI',    unit: '美元/桶',   digits: 1, range: [10, 300],      sources: [{ kind: 'thf', sym: 'hf_CL' }, { kind: 'emq', secid: '102.CL00Y' }] },
  // 东财 push2 stock/get 对广期所 secid 返回 502（真机确认），首选改走已验证可达的 push2 clist（/api/emflow 同通道）
  { key: 'lith',   name: '碳酸锂 GFEX', unit: '元/吨',     digits: 0, range: [20000, 500000], sources: [{ kind: 'gfex' }, { kind: 'clist', fs: 'm:225', re: /^lcm$|碳酸锂主/ }, { kind: 'emq', secid: '225.lcm' }] },
];
async function fetchCmdtySource(src) {
  try {
    if (src.kind === 'thf') {
      // 腾讯外盘 hf_：逗号分隔，f[0]=现价；昨结通常在 f[7]（真机字段可能有别，诊断可校准）
      const r = await fetchRaw('/api/quote?code=' + encodeURIComponent(src.sym));
      const mm = r.text.match(/"([^"]*)"/);
      const f = mm ? mm[1].split(',') : [];
      const price = parseFloat(f[0]);
      const prev = parseFloat(f[7]);
      let chg = null;
      if (price > 0 && prev > 0 && Math.abs(price - prev) / prev < 0.15) chg = (price - prev) / prev * 100;
      return { price: price > 0 ? price : null, chg, raw: 'tx/' + src.sym + ' HTTP' + r.status + ' ' + macroClip(r.text) };
    }
    if (src.kind === 'emq') {
      const r = await fetchRaw('/api/emquote?secid=' + encodeURIComponent(src.secid) + '&fields=f43,f59,f60');
      let price = null, chg = null;
      try {
        const d = JSON.parse(r.text).data;
        if (d && isFinite(d.f43)) {
          const dv = Math.pow(10, d.f59 || 0);
          price = d.f43 / dv;
          if (isFinite(d.f60) && d.f60 > 0) { const p0 = d.f60 / dv; if (Math.abs(price - p0) / p0 < 0.15) chg = (price - p0) / p0 * 100; }
        }
      } catch (e) {}
      return { price, chg, raw: 'emq/' + src.secid + ' HTTP' + r.status + ' ' + macroClip(r.text) };
    }
    if (src.kind === 'gfex') {
      // 广期所官方日行情（POST 表单，经 /api/gfex 代理）：碳酸锂取 varietyOrder==='lc' 行。
      // 涨跌% = (收盘 − 昨结) ÷ 昨结。周末/节假日无数据：先对齐到最近工作日（周末回周五），
      // 最多再往前 4 天——避免无效日期连发请求触发上游 WAF。
      const d0 = new Date(todayStr() + 'T00:00:00');
      const dow = d0.getDay();
      if (dow === 6) d0.setDate(d0.getDate() - 1);
      else if (dow === 0) d0.setDate(d0.getDate() - 2);
      for (let back = 0; back < 4; back++) {
        const d = new Date(d0.getTime() - back * 864e5);
        const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const r = await fetchRaw('/api/gfex?trade_date=' + ymd);
        try {
          const rows = JSON.parse(r.text).data;
          const hit = Array.isArray(rows) && rows.find(x => x.varietyOrder === 'lc' || /碳酸锂/.test(x.variety || ''));
          if (hit && isFinite(num(hit.close)) && num(hit.close) > 0) {
            const price = num(hit.close);
            const chg = num(hit.lastClear) > 0 ? +(((price - num(hit.lastClear)) / num(hit.lastClear)) * 100).toFixed(2) : null;
            return { price, chg, raw: 'gfex/' + ymd + ' HTTP' + r.status + ' ' + macroClip(r.text) };
          }
        } catch (e) {}
      }
      return { price: null, chg: null, raw: 'gfex 近 4 个交易日无数据' };
    }
    if (src.kind === 'clist') {
      // push2 clist（与资金流同通道）：fs 指定市场（m:225=广期所），按 f12 代码/f14 名称匹配主力合约
      const r = await fetchRaw('/api/emflow?fid=f12&po=0&pz=80&pn=1&np=1&fltt=2&invt=2&fs=' + encodeURIComponent(src.fs) + '&fields=' + encodeURIComponent('f2,f3,f12,f14'));
      let price = null, chg = null, hit = '';
      try {
        const arr = JSON.parse(r.text).data.diff;
        const list = Array.isArray(arr) ? arr : Object.values(arr || {});
        const row = list.find(x => x && (src.re.test(String(x.f12 || '')) || src.re.test(String(x.f14 || ''))));
        if (row && typeof row.f2 === 'number' && isFinite(row.f2)) {
          price = row.f2;
          if (typeof row.f3 === 'number' && isFinite(row.f3) && Math.abs(row.f3) < 15) chg = row.f3;
          hit = String(row.f12 || '') + '/' + String(row.f14 || '');
        }
      } catch (e) {}
      return { price, chg, raw: 'clist/' + src.fs + (hit ? ' 命中' + hit : '') + ' HTTP' + r.status + ' ' + macroClip(r.text) };
    }
  } catch (e) { return { price: null, chg: null, raw: (src.kind || '?') + ' 异常:' + macroClip(e.message) }; }
  return { price: null, chg: null, raw: '未知源' };
}
async function autoPullCmdty() {
  const m = STATE.macro; const diag = [];
  const items = (m.cmdty && m.cmdty.items) || {};
  for (const c of CMDTY_LIST) {
    let got = null; const attempts = [];
    for (const src of c.sources) {
      const res = await fetchCmdtySource(src);
      let note = res.raw;
      if (res.price != null && res.price >= c.range[0] && res.price <= c.range[1]) { attempts.push(note); got = res; break; }
      if (res.price != null) note += ' ⚠取到 ' + res.price + ' 超区间[' + c.range + ']判无效';
      attempts.push(note);
    }
    if (got) {
      items[c.key] = { price: +got.price.toFixed(c.digits + 1), chg: got.chg != null ? +got.chg.toFixed(2) : null, date: todayStr() };
      pushMacroHist('c_' + c.key, items[c.key].price);
      diag.push({ label: c.name, ok: true, raw: items[c.key].price + ' ' + c.unit + (got.chg != null ? ' (' + (got.chg >= 0 ? '+' : '') + got.chg.toFixed(2) + '%)' : '') });
    } else diag.push({ label: c.name, ok: false, raw: attempts.join('  ‖  ') });
  }
  if (items.copper && items.gold && items.gold.price > 0) {
    items.cuau = { price: +(items.copper.price / items.gold.price).toFixed(2), chg: null, date: todayStr() };
    pushMacroHist('c_cuau', items.cuau.price);
  }
  m.cmdty = { date: todayStr(), items, diag };
  saveState();
  return m.cmdty;
}
// 黄金/紫金相关敞口（商品价格 → 你的钱）
function goldCopperExposure() {
  const fx = currentFx();
  let gold = 0, zijin = 0;
  (STATE.assets || []).forEach(a => {
    const n = String(a.name || ''), code = String(a.code || '');
    if (/紫金/.test(n) || /^(sh)?601899$/i.test(code) || /^(hk)?0?2899$/i.test(code)) { zijin += assetCny(a, fx); return; }
    if (a.category === '黄金' || /黄金|gold/i.test(n)) gold += assetCny(a, fx);
  });
  return { gold, zijin };
}
function cmdtySignals() {
  const out = [];
  const c = STATE.macro && STATE.macro.cmdty;
  if (!c || !c.items) return out;
  const it = c.items, exp = goldCopperExposure();
  const g = it.gold;
  if (g && g.chg != null && Math.abs(g.chg) >= 1.5 && exp.gold + exp.zijin > 0) {
    out.push({
      t: g.chg > 0 ? 'blue' : 'amber', tag: '金价' + (g.chg > 0 ? '大涨' : '大跌'),
      msg: `金价当日 ${g.chg > 0 ? '+' : ''}${g.chg.toFixed(1)}%（${g.price} 美元/盎司）：你的黄金相关敞口约 ${fmtMoney(exp.gold + exp.zijin)}（实物金/黄金基金 ${fmtMoney(exp.gold)}${exp.zijin > 0 ? ' + 紫金矿业 ' + fmtMoney(exp.zijin) : ''}）。矿业股利润对金价是放大器——紫金的波动通常大于金价本身。`,
    });
  }
  const hist = macroHistOf('c_cuau');
  if (hist.length >= 5) {
    const bi = Math.max(0, hist.length - 21);
    const cur = hist[hist.length - 1].v, base = hist[bi].v;
    if (base > 0) {
      const d = (cur - base) / base * 100;
      if (d >= 5) out.push({ t: 'blue', tag: '铜金比↑', msg: `铜金比 ${cur.toFixed(2)}（较 ${hist[bi].d} +${d.toFixed(0)}%）：铜强于金 = 增长预期占上风，利好紫金的铜业务与顺周期资产。` });
      else if (d <= -5) out.push({ t: 'amber', tag: '铜金比↓', msg: `铜金比 ${cur.toFixed(2)}（较 ${hist[bi].d} ${d.toFixed(0)}%）：避险主导、需求走弱——金价撑利润、铜业务承压，顺周期仓位谨慎。` });
    }
  }
  if (it.lith && it.lith.chg != null && Math.abs(it.lith.chg) >= 3 && exp.zijin > 0) {
    out.push({ t: it.lith.chg > 0 ? 'blue' : 'amber', tag: '碳酸锂异动', msg: `碳酸锂当日 ${it.lith.chg > 0 ? '+' : ''}${it.lith.chg.toFixed(1)}%（${it.lith.price} 元/吨）：紫金锂板块 2026–2028 放量，锂价决定这部分增量的兑现度。` });
  }
  return out;
}

/* -------------------------------------------------------------------------
   资金流向（聪明钱·A股/港股通）：行业主力资金(东财push2) + 南向(东财datacenter)
   + 两融余额(东财datacenter)。全部免key境内源；行业主力=大单净流入口径（零售可得
   的"聪明钱"代理，非严格机构口径）。用法定位：拥挤度/佐证层，不是买卖信号。
   ------------------------------------------------------------------------- */
// 因子 → 行业板块名关键词（联动解读：你的持仓相关板块在流入/流出榜上吗）
// 键与 FACTORS 一一对应（原版 '有色资源'/'高股息' 不在 FACTORS 中→联动静默失效，已修正补全）
const FACTOR_SECTOR_HINTS = {
  'AI算力': ['通信设备', '计算机设备', '半导体', '元件'], 'AI电力': ['电力', '电源', '电网'],
  'AI应用': ['软件', '互联网', '计算机', '传媒'], '科技互联网': ['互联网', '软件', '传媒'],
  '传媒游戏': ['传媒', '游戏', '影视'], '半导体': ['半导体', '元件'],
  '机器人': ['通用设备', '专用设备', '仪器'], '创新药': ['生物制品', '化学制药', '医药', '医疗'],
  '医疗器械': ['医疗器械', '医疗服务', '医疗'], '银行': ['银行'],
  '证券保险': ['证券', '保险', '多元金融'], '黄金': ['贵金属', '黄金'],
  '有色金属': ['有色', '贵金属', '小金属', '能源金属'], '能源': ['煤炭', '石油', '燃气', '采掘'],
  '公用事业': ['电力', '燃气', '水务', '环保'], '化工': ['化学', '化工', '化纤', '化肥'],
  '消费': ['旅游', '酒店', '零售', '食品', '饮料', '白酒', '家电', '商业'],
  '食品饮料': ['食品', '饮料', '白酒', '啤酒', '乳'], '新能源车': ['汽车', '电池', '整车'],
  '光伏风电': ['光伏', '风电', '电池', '电网'], '军工': ['军工', '航天', '航空', '船舶'],
  '地产': ['房地产', '工程建设', '装修'], '农业': ['农牧', '农业', '种植', '养殖', '饲料'],
};
async function autoPullFlow() {
  const diag = [];
  const flow = { date: todayStr(), sectors: null, south: null, margin: null, diag };
  // 1 行业板块主力资金（push2 clist，fid=f62 今日主力净额降序；带5日/10日字段）
  try {
    const q = 'fid=f62&po=1&pz=100&pn=1&np=1&fltt=2&invt=2&fs=' + encodeURIComponent('m:90+t:2')
      + '&fields=' + encodeURIComponent('f12,f14,f62,f164,f174,f184');
    const r = await fetch('/api/emflow?' + q, { cache: 'no-store' });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    const arr = j && j.data && j.data.diff;
    if (Array.isArray(arr) && arr.length > 10) {
      // 缺数据行 f62 为 '-'（字符串）：必须剔除，否则 num('-')→0 混进榜单当 0.0 亿
      flow.sectors = arr.filter(x => typeof x.f62 === 'number' && isFinite(x.f62))
        .map(x => ({ name: String(x.f14 || ''), today: x.f62 / 1e8, d5: (typeof x.f164 === 'number' ? x.f164 : 0) / 1e8, d10: (typeof x.f174 === 'number' ? x.f174 : 0) / 1e8 }))
        .filter(x => x.name);
      diag.push({ label: '行业主力资金(push2)', ok: true, raw: arr.length + ' 个板块，Top1 ' + flow.sectors[0].name + ' ' + flow.sectors[0].today.toFixed(1) + '亿' });
    } else diag.push({ label: '行业主力资金(push2)', ok: false, raw: 'HTTP ' + r.status + ' ' + txt.slice(0, 160) });
  } catch (e) { diag.push({ label: '行业主力资金(push2)', ok: false, raw: e.message }); }
  // 2 南向资金（datacenter 沪深港通历史：003=港股通沪 004=港股通深，取最新交易日净买额，亿元）
  try {
    const get = async (t) => {
      const u = '/api/emmacro?reportName=RPT_MUTUAL_DEAL_HISTORY&columns=ALL&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=1&pageNumber=1&filter=' + encodeURIComponent(`(MUTUAL_TYPE="${t}")`);
      const r = await fetch(u, { cache: 'no-store' });
      const j = JSON.parse(await r.text());
      const row = j && j.result && j.result.data && j.result.data[0];
      return row ? { date: String(row.TRADE_DATE || '').slice(0, 10), net: num(row.NET_DEAL_AMT) } : null;
    };
    const [sh, sz] = await Promise.all([get('003'), get('004')]);
    if (sh || sz) {
      const net = (sh ? sh.net : 0) + (sz ? sz.net : 0);
      if (Math.abs(net) < 2000) {                            // 亿元级别理性范围
        flow.south = { date: (sh || sz).date, net };
        diag.push({ label: '南向资金(datacenter)', ok: true, raw: flow.south.date + ' 净买 ' + net.toFixed(1) + '亿' });
      } else diag.push({ label: '南向资金(datacenter)', ok: false, raw: '数值越界疑似单位不符: ' + net });
    } else diag.push({ label: '南向资金(datacenter)', ok: false, raw: '无数据行' });
  } catch (e) { diag.push({ label: '南向资金(datacenter)', ok: false, raw: e.message }); }
  // 3 两融余额（datacenter 融资融券历史汇总，元 → 万亿；带较上日变化）
  try {
    const u = '/api/emmacro?reportName=RPTA_RZRQ_LSHJ&columns=ALL&sortColumns=DIM_DATE&sortTypes=-1&pageSize=2&pageNumber=1';
    const r = await fetch(u, { cache: 'no-store' });
    const txt = await r.text();
    const j = JSON.parse(txt);
    const rows = j && j.result && j.result.data;
    if (rows && rows.length) {
      const bal = num(rows[0].RZRQYE), prev = rows[1] ? num(rows[1].RZRQYE) : NaN;
      if (bal > 5e11 && bal < 5e12) {                        // 0.5万亿~5万亿 理性区间
        flow.margin = { date: String(rows[0].DIM_DATE || '').slice(0, 10), balWy: bal / 1e12, deltaYi: isFinite(prev) ? (bal - prev) / 1e8 : null };
        diag.push({ label: '两融余额(datacenter)', ok: true, raw: flow.margin.date + ' ' + flow.margin.balWy.toFixed(3) + '万亿' });
      } else diag.push({ label: '两融余额(datacenter)', ok: false, raw: '数值越界: ' + bal + ' · ' + txt.slice(0, 120) });
    } else diag.push({ label: '两融余额(datacenter)', ok: false, raw: 'HTTP ' + r.status + ' ' + txt.slice(0, 160) });
  } catch (e) { diag.push({ label: '两融余额(datacenter)', ok: false, raw: e.message }); }
  return flow;
}
// 资金流的确定性解读：持仓相关板块的流入/流出 + 拥挤提示 + 杠杆/南向水位
function flowSignals(flow) {
  const out = [];
  if (!flow) return out;
  const s = flow.sectors || [];
  if (s.length) {
    // 持仓联动：因子 → 相关板块在榜单上的位置
    const seen = new Set();
    (STATE.positions || []).forEach(p => {
      const hints = FACTOR_SECTOR_HINTS[p.factor] || [];
      s.forEach(sec => {
        if (seen.has(sec.name) || !hints.some(h => sec.name.indexOf(h) >= 0)) return;
        seen.add(sec.name);
        if (sec.today <= -5) out.push(['amber', `你的「${escapeHtml(p.factor)}」相关板块「${escapeHtml(sec.name)}」今日主力净流出 ${Math.abs(sec.today).toFixed(1)} 亿（5日 ${sec.d5 >= 0 ? '+' : ''}${sec.d5.toFixed(1)} 亿）——资金撤离中，与再平衡卖出排序相互印证。`]);
        else if (sec.today >= 5) out.push(['blue', `你的「${escapeHtml(p.factor)}」相关板块「${escapeHtml(sec.name)}」今日主力净流入 +${sec.today.toFixed(1)} 亿（5日 ${sec.d5 >= 0 ? '+' : ''}${sec.d5.toFixed(1)} 亿）——有资金承接。`]);
      });
    });
    // 拥挤度：今日榜首且5日也大幅为正 → 提示别追高
    const top = s[0];
    if (top && top.today > 20 && top.d5 > 40) out.push(['amber', `「${escapeHtml(top.name)}」今日+5日都在大幅吸金（今日 +${top.today.toFixed(0)} 亿 / 5日 +${top.d5.toFixed(0)} 亿）——<strong>历史级流入常伴随拥挤</strong>，若计划新进该方向请分批、别追。`]);
  }
  if (flow.south && isFinite(flow.south.net)) {
    const n = flow.south.net;
    if (n >= 50) out.push(['blue', `南向资金 ${escapeHtml(flow.south.date)} 净买入 +${n.toFixed(0)} 亿——港股通标的（恒生科技/创新药HK/港股高股息）有水位支撑。`]);
    else if (n <= -50) out.push(['amber', `南向资金 ${escapeHtml(flow.south.date)} 净卖出 ${n.toFixed(0)} 亿——港股通持仓短期承压，非基本面信号、勿情绪化操作。`]);
  }
  if (flow.margin && flow.margin.deltaYi != null) {
    const d = flow.margin.deltaYi;
    if (d >= 100) out.push(['amber', `两融余额单日 +${d.toFixed(0)} 亿（${flow.margin.balWy.toFixed(2)}万亿）——杠杆资金升温，涨势中助涨、跌时踩踏，弹性仓遵守止损纪律。`]);
    else if (d <= -100) out.push(['blue', `两融余额单日 ${d.toFixed(0)} 亿（${flow.margin.balWy.toFixed(2)}万亿）——杠杆退潮，抛压释放中。`]);
  }
  return out;
}

VIEWS.macro = function (app) {
  if (!STATE.macro || !STATE.macro.market) STATE.macro = { market: {}, ind: {}, updatedAt: null };
  const m = STATE.macro;
  app.appendChild(el(`
    <div class="view-head">
      <h2>市场指标 · 影响组合的关键变量</h2>
      <p>顶部<strong>信号徽章</strong> 5 秒扫完当前状态，点开看详情；<strong>大宗商品</strong>（金/铜/锂）直接联动你的黄金+紫金持仓；指标值都画在<strong>分区刻度条</strong>上——看位置不用记阈值，走势线显示最近变化。利率/通胀等按官方发布节奏手动更新一次即可长期留存（说明文字已折叠，点「说明」展开）。</p>
    </div>
  `));

  // —— 信号一览（徽章一排 = 5 秒扫完；点开才看详情）——
  const sigCard = el('<div class="card"><h3>' + icon('gauge') + ' 信号一览</h3></div>');
  const sigs = macroSignals().concat(cmdtySignals());
  const chipStyle = {
    red:   'background:rgba(255,59,48,.12);color:var(--red-ink);border:1px solid rgba(255,59,48,.35)',
    amber: 'background:rgba(255,159,10,.14);color:var(--amber-ink);border:1px solid rgba(255,159,10,.35)',
    blue:  'background:rgba(10,132,255,.10);color:var(--accent-ink);border:1px solid rgba(10,132,255,.30)',
    green: 'background:rgba(52,199,89,.12);color:var(--green-ink);border:1px solid rgba(52,199,89,.35)',
  };
  const chipBase = 'font:inherit;font-size:12.5px;font-weight:600;padding:4px 10px;border-radius:999px;cursor:pointer';
  if (sigs.length) {
    const chipsRow = el('<div class="row" style="gap:6px;flex-wrap:wrap"></div>');
    const detailBox = el('<div></div>');
    sigs.forEach((s, i) => {
      const mark = s.t === 'red' ? '⛔' : s.t === 'amber' ? '⚠' : 'ℹ';
      const chip = el(`<button data-sig="${i}" style="${chipStyle[s.t]};${chipBase}">${mark} ${escapeHtml(s.tag)}</button>`);
      chipsRow.appendChild(chip);
      const d = el(`<div class="alert ${s.t}" style="display:none;margin-top:8px"><span class="icon">${s.t === 'red' ? icon('danger') : s.t === 'amber' ? icon('warn') : icon('info')}</span><div>${s.msg}</div></div>`);
      detailBox.appendChild(d);
      chip.onclick = () => { d.style.display = d.style.display === 'none' ? '' : 'none'; };
    });
    sigCard.appendChild(chipsRow);
    sigCard.appendChild(detailBox);
    sigCard.appendChild(el(`<p class="inline-note" style="margin-top:8px">点徽章看详情。信号按固定规则从真实数据触发，透明、可复现；指标填得越全越准。</p>`));
  } else {
    sigCard.appendChild(el(`<div class="row" style="gap:6px"><span style="${chipStyle.green};${chipBase};cursor:default">✓ 无预警</span></div>
      <p class="inline-note" style="margin-top:8px">当前已填指标均未触发预警信号。补全美债10Y/2Y、美联储利率、DXY、VIX 等可获得更完整的判断。</p>`));
  }
  app.appendChild(sigCard);

  // —— 大宗商品（金·铜·锂 — 紫金/黄金持仓联动）——
  const cmCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('coins')} 大宗商品（金 · 铜 · 锂）</h3>
    <p class="hint">你持有黄金资产 + 紫金矿业（金+铜+锂三重敞口），商品价格就是这部分持仓的利润驱动。<strong>铜金比</strong>（LME铜÷COMEX金）：上行=增长预期占上风(利铜/顺周期)，下行=避险主导(利金)。碳酸锂为试验源，以下方诊断为准。</p></div>`);
  const cmBar = el(`<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" id="cm-go" style="flex:0 0 auto">${icon('refresh')} 拉取商品价格</button><span id="cm-note" class="inline-note" style="align-self:center">${m.cmdty && m.cmdty.date ? '上次更新 ' + escapeHtml(m.cmdty.date) : '点击拉取 金/银/铜/油/锂'}</span></div>`);
  cmCard.appendChild(cmBar);
  const cmOut = el('<div></div>');
  cmCard.appendChild(cmOut);
  app.appendChild(cmCard);
  // 点瓦片弹详解（事件委托：renderCmdty 重设 innerHTML 也不失效）
  cmOut.addEventListener('click', e => {
    const t = e.target.closest('[data-cmi]');
    if (t) showCmdtyModal(t.dataset.cmi);
  });
  const renderCmdty = (c) => {
    if (!c || !c.items || !Object.keys(c.items).length) { cmOut.innerHTML = ''; return; }
    const tiles = [];
    CMDTY_LIST.forEach(cd => {
      const d = c.items[cd.key];
      if (!d) return;
      const chg = d.chg != null && isFinite(d.chg) ? d.chg : null;
      tiles.push(`<div class="stat" data-cmi="${cd.key}" style="cursor:pointer"><div class="label">${escapeHtml(cd.name)} <span style="color:var(--accent-ink);font-size:10px">详解</span></div>
        <div class="value" style="font-size:20px;color:${chg == null ? 'inherit' : (chg >= 0 ? 'var(--green-ink)' : 'var(--red-ink)')}">${(+d.price).toLocaleString(undefined, { maximumFractionDigits: cd.digits })}</div>
        <div class="sub">${chg != null ? (chg >= 0 ? '+' : '') + chg.toFixed(2) + '% · ' : ''}${escapeHtml(cd.unit)}</div>
        <div>${sparklineHtml('c_' + cd.key)} ${histDeltaHtml('c_' + cd.key)}</div></div>`);
    });
    if (c.items.cuau) {
      tiles.push(`<div class="stat" data-cmi="cuau" style="cursor:pointer"><div class="label">铜金比（增长/避险温度计） <span style="color:var(--accent-ink);font-size:10px">详解</span></div>
        <div class="value" style="font-size:20px">${(+c.items.cuau.price).toFixed(2)}</div>
        <div class="sub">↑增长预期(利铜) · ↓避险(利金)</div>
        <div>${sparklineHtml('c_cuau')} ${histDeltaHtml('c_cuau')}</div></div>`);
    }
    let html = tiles.length ? `<div class="stat-grid" style="margin-top:12px">${tiles.join('')}</div>` : '';
    if (c.diag && c.diag.length) {
      const okN = c.diag.filter(d => d.ok).length;
      html += `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">拉取诊断（成功 ${okN} / 失败 ${c.diag.length - okN}）— 点击展开</summary>
        <div class="table-scroll"><table class="stack-mobile"><thead><tr><th>品种</th><th>结果</th><th>原始返回 / 值</th></tr></thead><tbody>
        ${c.diag.map(d => `<tr><td style="white-space:nowrap">${escapeHtml(d.label)}</td><td>${d.ok ? '<span class="pill green">成功</span>' : '<span class="pill red">失败</span>'}</td><td style="font-size:11px;font-family:monospace;word-break:break-all">${escapeHtml(d.raw)}</td></tr>`).join('')}
        </tbody></table></div></details>`;
    }
    cmOut.innerHTML = html;
  };
  renderCmdty(m.cmdty);
  cmBar.querySelector('#cm-go').onclick = async () => {
    const btn = cmBar.querySelector('#cm-go'), note = cmBar.querySelector('#cm-note');
    btn.disabled = true; note.innerHTML = icon('refresh', 'spin') + ' 拉取中（约 3–10 秒）…';
    try {
      const c = await autoPullCmdty();
      const okN = c.diag.filter(d => d.ok).length;
      note.innerHTML = `${icon(okN ? 'check' : 'warn')} 拉取：成功 ${okN} / 失败 ${c.diag.length - okN} 项 · ${escapeHtml(c.date)}${okN < c.diag.length ? '（失败项见诊断，可截图发我校准）' : ''}`;
      render();   // 重绘：商品瓦片 + 信号徽章（金价异动/铜金比）
    } catch (e) {
      note.innerHTML = `${icon('warn')} 拉取失败：${escapeHtml(e.message)}`;
    } finally { btn.disabled = false; }
  };

  // —— 市场温度（自动）——
  const mkCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('chart')} 市场温度（可自动刷新）</h3></div>`);
  const mkBar = el(`<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" id="mk-go" style="flex:0 0 auto">${icon('refresh')} 刷新指数行情</button><button class="btn secondary" id="mk-auto" style="flex:0 0 auto">${icon('sparkles')} 自动拉取宏观（试验）</button><span id="mk-note" class="inline-note" style="align-self:center">${m.updatedAt ? '上次更新 ' + escapeHtml(m.updatedAt) : '点刷新拉取最新指数点位'}</span></div>`);
  mkCard.appendChild(mkBar);
  const mkGrid = el('<div class="stat-grid" style="margin-top:12px"></div>');
  const renderMarket = () => {
    mkGrid.innerHTML = '';
    MACRO_MARKET.forEach(it => {
      const d = m.market[it.key];
      const val = d && isFinite(d.price) ? (+d.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
      const chg = d && d.changePct != null && isFinite(d.changePct) ? d.changePct : null;
      const usdcny = it.key === 'sh' ? '' : '';
      mkGrid.appendChild(el(`<div class="stat"><div class="label">${it.name}</div>
        <div class="value" style="font-size:20px;color:${chg == null ? 'inherit' : (chg >= 0 ? 'var(--green-ink)' : 'var(--red-ink)')}">${val}</div>
        <div class="sub">${chg == null ? (d ? '' : '未刷新') : (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'}</div></div>`));
    });
    // 附带 USD/CNY 中间价
    mkGrid.appendChild(el(`<div class="stat"><div class="label">美元/人民币中间价</div><div class="value" style="font-size:20px">${currentFx().toFixed(4)}</div><div class="sub">「设置」可一键更新</div></div>`));
  };
  mkCard.appendChild(mkGrid);
  renderMarket();
  app.appendChild(mkCard);

  mkBar.querySelector('#mk-go').onclick = async () => {
    const btn = mkBar.querySelector('#mk-go'), note = mkBar.querySelector('#mk-note');
    btn.disabled = true; note.innerHTML = icon('refresh', 'spin') + ' 拉取中…';
    let ok = 0, fail = 0;
    await Promise.all(MACRO_MARKET.map(async it => {
      try { const q = await fetchIndexQuote(it); if (isFinite(q.price)) { m.market[it.key] = { price: q.price, changePct: q.changePct, date: todayStr() }; ok++; } else fail++; }
      catch (e) { fail++; }
    }));
    if (ok > 0) m.updatedAt = todayStr();             // 全失败不盖章
    saveState(); renderMarket();
    note.innerHTML = `${icon('check')} 已更新 ${ok} 项${fail ? '（' + fail + ' 项失败，多为境外指数被源限制，可手动参考）' : ''} · ${todayStr()}`;
    btn.disabled = false;
  };

  // 自动拉取宏观（试验）：DXY/VIX/美债走新浪、中国CPI/PMI/LPR走东财；拉到的写入指标卡并触发信号
  mkBar.querySelector('#mk-auto').onclick = async () => {
    const btn = mkBar.querySelector('#mk-auto'), note = mkBar.querySelector('#mk-note');
    btn.disabled = true; note.innerHTML = icon('refresh', 'spin') + ' 自动拉取中（约 5–15 秒）…';
    try {
      const r = await autoPullMacro();
      note.innerHTML = `${icon(r.ok ? 'check' : 'warn')} 自动拉取：成功 ${r.ok} / 失败 ${r.fail} 项 · 明细：${escapeHtml(r.detail.join(' '))}${r.fail ? '（失败项多为符号需真机核对，已保留手填，可把失败项发我修）' : ''}`;
      render();   // 重绘：填入的指标 + 触发信号解读
    } catch (e) {
      note.innerHTML = `${icon('warn')} 自动拉取失败：${escapeHtml(e.message)}——可继续手填`;
    } finally { btn.disabled = false; }
  };

  // —— 资金流向（聪明钱·A股/港股通）——
  const flowCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('coins')} 资金流向（聪明钱 · A股/港股通）</h3>
    <p class="hint">行业<strong>主力资金</strong>（大单净流入，零售可得的"聪明钱"代理）+ <strong>南向资金</strong> + <strong>两融余额</strong>，全部免key境内源。<strong>用法：拥挤度/佐证层，不是买卖信号</strong>——历史级流入常出现在情绪高点附近，进方向前先看挤不挤；持仓相关板块被撤离时与再平衡排序互相印证。</p></div>`);
  const flowBar = el(`<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" id="flow-go" style="flex:0 0 auto">${icon('refresh')} 拉取资金流向</button><span id="flow-note" class="inline-note" style="align-self:center">${m.flow && m.flow.date ? '上次更新 ' + escapeHtml(m.flow.date) : '点击拉取行业主力/南向/两融'}</span></div>`);
  flowCard.appendChild(flowBar);
  const flowOut = el('<div id="flow-out"></div>');
  flowCard.appendChild(flowOut);
  app.appendChild(flowCard);
  const renderFlow = (f) => {
    if (!f) { flowOut.innerHTML = ''; return; }
    let html = '';
    if (f.sectors && f.sectors.length) {
      // 榜单只收真流入/真流出：普涨日榜尾可能仍是正流入，不能冒充「流出 Top5」
      const topIn = f.sectors.filter(x => x.today > 0).slice(0, 5);
      const topOut = f.sectors.filter(x => x.today < 0).slice(-5).reverse();
      const row = x => `<tr><td>${escapeHtml(x.name)}</td><td class="num" style="color:${x.today >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">${x.today >= 0 ? '+' : ''}${x.today.toFixed(1)}</td><td class="num" style="color:${x.d5 >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">${x.d5 >= 0 ? '+' : ''}${x.d5.toFixed(1)}</td></tr>`;
      html += `<div class="grid grid-2" style="gap:12px;margin-top:8px">
        <div><h4 style="margin:4px 0 6px">主力净流入 Top5（亿元）</h4><div class="table-scroll"><table><thead><tr><th>板块</th><th class="num">今日</th><th class="num">5日</th></tr></thead><tbody>${topIn.map(row).join('')}</tbody></table></div></div>
        <div><h4 style="margin:4px 0 6px">主力净流出 Top5（亿元）</h4><div class="table-scroll"><table><thead><tr><th>板块</th><th class="num">今日</th><th class="num">5日</th></tr></thead><tbody>${topOut.map(row).join('')}</tbody></table></div></div>
      </div>`;
    }
    const bits = [];
    if (f.south) bits.push(`<div class="stat"><div class="label">南向资金（${escapeHtml(f.south.date)}）</div><div class="value" style="font-size:20px;color:${f.south.net >= 0 ? 'var(--green-ink)' : 'var(--red-ink)'}">${f.south.net >= 0 ? '+' : ''}${f.south.net.toFixed(1)} 亿</div><div class="sub">港股通(沪+深)净买额</div></div>`);
    if (f.margin) bits.push(`<div class="stat"><div class="label">两融余额（${escapeHtml(f.margin.date)}）</div><div class="value" style="font-size:20px">${f.margin.balWy.toFixed(3)} 万亿</div><div class="sub">${f.margin.deltaYi != null ? '较上日 ' + (f.margin.deltaYi >= 0 ? '+' : '') + f.margin.deltaYi.toFixed(0) + ' 亿' : ''}</div></div>`);
    if (bits.length) html += `<div class="stat-grid" style="margin-top:12px">${bits.join('')}</div>`;
    // 确定性解读（联动你的持仓）
    const sig = flowSignals(f);
    if (sig.length) html += sig.map(([t, msg]) => `<div class="alert ${t}" style="margin-top:8px"><span class="icon">${t === 'amber' ? icon('warn') : icon('info')}</span><div>${msg}</div></div>`).join('');
    // 诊断（折叠）
    if (f.diag && f.diag.length) {
      const okN = f.diag.filter(d => d.ok).length;
      html += `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">拉取诊断（成功 ${okN} / 失败 ${f.diag.length - okN}）— 点击展开</summary>
        <div class="table-scroll"><table class="stack-mobile"><thead><tr><th>项</th><th>结果</th><th>原始返回 / 值</th></tr></thead><tbody>
        ${f.diag.map(d => `<tr><td style="white-space:nowrap">${escapeHtml(d.label)}</td><td>${d.ok ? '<span class="pill green">成功</span>' : '<span class="pill red">失败</span>'}</td><td style="font-size:11px;font-family:monospace;word-break:break-all">${escapeHtml(d.raw)}</td></tr>`).join('')}
        </tbody></table></div></details>`;
    }
    flowOut.innerHTML = html || '<p class="inline-note">暂无数据，点上方按钮拉取。</p>';
  };
  renderFlow(m.flow);
  flowBar.querySelector('#flow-go').onclick = async () => {
    const btn = flowBar.querySelector('#flow-go'), note = flowBar.querySelector('#flow-note');
    btn.disabled = true; note.innerHTML = icon('refresh', 'spin') + ' 拉取中（约 3–10 秒）…';
    try {
      const f = await autoPullFlow();
      m.flow = f; saveState();
      const okN = f.diag.filter(d => d.ok).length;
      note.innerHTML = `${icon(okN ? 'check' : 'warn')} 拉取：成功 ${okN} / 失败 ${f.diag.length - okN} 项 · ${escapeHtml(f.date)}${okN < f.diag.length ? '（失败项见下方诊断，可截图发我校准）' : ''}`;
      renderFlow(f);
    } catch (e) {
      note.innerHTML = `${icon('warn')} 拉取失败：${escapeHtml(e.message)}`;
    } finally { btn.disabled = false; }
  };

  // —— 自动拉取诊断（默认折叠，省地方；失败项的原始返回便于校准）——
  if (m.lastPull && Array.isArray(m.lastPull.diag) && m.lastPull.diag.length) {
    // 合并：我的默认折叠(<details>) + 第三方的手机端 stack-mobile（窄屏逐行卡片）
    const okN = m.lastPull.diag.filter(d => d.ok).length, failN = m.lastPull.diag.length - okN;
    const rows = m.lastPull.diag.map(d => `<tr><td style="white-space:nowrap">${escapeHtml(d.label)}</td><td>${d.ok ? '<span class="pill green">成功</span>' : '<span class="pill red">失败</span>'}</td><td style="font-size:11px;font-family:monospace;word-break:break-all">${escapeHtml(d.raw)}</td></tr>`).join('');
    const dcard = el(`<div class="card" style="margin-top:12px;padding:10px 16px">
      <details>
        <summary style="cursor:pointer;font-weight:600;list-style:revert">${icon('search')} 自动拉取诊断（${escapeHtml(m.lastPull.date)} · 成功 ${okN} / 失败 ${failN}）<span style="color:var(--muted);font-weight:400;font-size:12px"> — 点击展开</span></summary>
        <p class="hint" style="margin-top:8px">失败项的<strong>原始返回</strong>在这里；把它截图发我可精确校准符号/参数。</p>
        <div class="table-scroll"><table class="stack-mobile"><thead><tr><th>指标</th><th>结果</th><th>原始返回 / 值</th></tr></thead><tbody>${rows}</tbody></table></div>
      </details></div>`);
    app.appendChild(dcard);
  }

  // —— 手动关键指标（看板化：值 → 刻度条上的位置 + 走势，长说明折叠进「说明」）——
  MACRO_GROUPS.forEach(grp => {
    const card = el(`<div class="card" style="margin-top:16px"><h3>${escapeHtml(grp.title)}</h3></div>`);
    const scroll = el('<div class="table-scroll"></div>');
    const rows = grp.items.map(it => {
      const cur = (m.ind[it.key] || {});
      const val = cur.value != null ? num(cur.value, NaN) : NaN;
      const zone = MACRO_ZONES[it.key];
      const bar = isFinite(val) && zone ? scaleBarHtml(val, zone) : '<span class="inline-note">—</span>';
      const spark = sparklineHtml(it.key);
      const trend = spark ? spark + ' ' + histDeltaHtml(it.key) : '<span class="inline-note">—</span>';
      return `<tr>
        <td><strong>${escapeHtml(it.name)}</strong>${it.unit ? ' <span style="color:var(--muted)">(' + it.unit + ')</span>' : ''}
          <a data-mki="${it.key}" style="cursor:pointer;font-size:11px;color:var(--accent-ink);margin-left:4px">详解</a></td>
        <td class="num"><input data-mk="${it.key}" value="${cur.value != null ? escapeHtml(String(cur.value)) : ''}" placeholder="填入最新值" style="max-width:110px"/></td>
        <td>${bar}</td>
        <td style="white-space:nowrap">${trend}</td>
        <td class="num" style="color:var(--muted);font-size:12px">${cur.date ? escapeHtml(cur.date) : '—'}</td>
      </tr>`;
    }).join('');
    scroll.appendChild(el(`<table class="stack-mobile"><thead><tr><th>指标</th><th class="num">当前值</th><th>位置（分区刻度）</th><th>走势 / 较上次</th><th class="num">更新</th></tr></thead><tbody>${rows}</tbody></table>`));
    card.appendChild(scroll);
    app.appendChild(card);
    scroll.querySelectorAll('[data-mk]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.mk, v = inp.value.trim();
      if (v === '') delete m.ind[k];
      else { m.ind[k] = { value: v, date: todayStr() }; const nv = num(v, NaN); if (isFinite(nv)) pushMacroHist(k, nv); }
      saveState(); render();   // 重绘以刷新信号徽章/刻度条/走势
    });
    scroll.querySelectorAll('[data-mki]').forEach(a => a.onclick = () => showIndicatorModal(a.dataset.mki));
  });

  app.appendChild(el(`<div class="card" style="margin-top:16px"><div class="alert blue"><span class="icon">${icon('info')}</span><div>
    <strong>数据从哪来？</strong>指数行情/VIX/外盘商品(金银铜油)走<strong>腾讯</strong>，美元指数走<strong>东财报价</strong>，碳酸锂走<strong>广期所官方</strong>，中国 CPI/PMI/LPR 走<strong>东财数据中心</strong>，美国失业率/联邦利率/核心PCE/PMI 走<strong>金十数据</strong>（均免 key、境内可达）——点「自动拉取宏观」「拉取商品价格」一键填入。<br><strong>为什么不让 AI 自动"分析"宏观？</strong>因为模型没有实时数据、有训练截止，直接问它"当前美联储/CPI"会自信地编造过时或错误数字——对认真投资是负资产。所以这里是<strong>拉真实数据 → 工具按固定规则解读</strong>，透明可复现。<br><span style="color:var(--muted)">注：自动拉取的部分符号需真机核对，失败项会显示明细并保留手填；把失败项发我，我按你 ECS 的实际返回校准。</span></div></div></div>`));
};

/* =========================================================================
   视图：使用说明（每个模块怎么用 / 计算逻辑 / 理论 / 遵循后的收益）
   ========================================================================= */
VIEWS.help = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>使用说明</h2>
      <p>每个模块：怎么用 · 背后的计算逻辑 · 依据的理论 · 遵循它能带来什么。</p>
    </div>
  `));

  const G = (ic, title, blocks) => {
    const card = el(`<div class="card guide-section"><h3>${icon(ic)} ${title}</h3></div>`);
    blocks.forEach(([label, html]) => {
      card.appendChild(el(`<div class="guide-block"><div class="gl">${label}</div>${html}</div>`));
    });
    app.appendChild(card);
  };

  app.appendChild(el(`<div class="card"><div class="alert blue"><span class="icon">${icon('info')}</span><div>
    <strong>核心理念</strong>：投资比拼的是概率认知、仓位管理与人性约束。本工具不预测涨跌、不荐股，只做量化计算与纪律校验——把“人性约束”固化成代码，在情绪化时刻把你拉回理性。所有模型都依赖你的诚实输入。</div></div></div>`));

  G('list', '使用顺序 · 每天 / 每周 / 每月怎么用', [
    ['每天（约 5 分钟）', '<p>① 打开页面（自动刷新估值 + 自动记快照）→ ②「投资组合」扫一眼今日涨跌与浮盈亏 → ③ 有买卖就到「持仓 → 当日交易」<strong>按成交价录入</strong>（别直接改股数，否则当日盈亏失真）→ ④ 有转入/转出资金，到「资产趋势 → 出入金登记」记一笔。就这四步，数据地基就稳了。</p>'],
    ['每周（约 15 分钟）', '<p>①「股票体检」看弹性仓占比、因子集中度、深套复核 → ② 想加仓先过「② 铁律校验」，想减仓先过「⑤ 加减仓计划」的退出决策树 → ③「收益归因 · 近 7 天」看这钱是从哪赚的。</p>'],
    ['每月 / 每季（约 30 分钟）', '<p>①「资产趋势」开基准对比：TWR 有没有跑赢沪深300/标普500 → ②「压力测试」过一遍极端情景，跌破阈值就降风险 → ③「再平衡」看大类偏离，超阈值按清单调 → ④「复盘校准」登记几笔判断，验证自己的胜率 → ⑤「市场指标」补更新手填项，校准宏观假设。</p>'],
    ['价值闭环', '<p><strong>记录</strong>（快照/出入金/当日交易）→ <strong>诊断</strong>（体检/归因/压力测试）→ <strong>决策</strong>（铁律/退出/再平衡）→ <strong>验证</strong>（TWR vs 基准、复盘校准）。四步循环缺一不可：只诊断不执行 = 纸上谈兵，只执行不验证 = 盲目自信。</p>'],
  ]);

  G('globe', '数据基石 · 行情 / 快照 / 出入金', [
    ['自动更新涨跌', '<p>打开页面会自动刷新一次(15 分钟节流),也可在「投资组合」点<strong>一键刷新估值</strong>。覆盖:公募<strong>基金</strong>(天天基金实时估值)、<strong>A股/ETF/美股</strong>(腾讯行情,东财备份)、<strong>黄金</strong>(国际现货金折人民币/克)。理财为银行自有产品无公开接口,保持手动维护 + 年化利息估算。</p>'],
    ['持仓联动与「今日」口径', '<p>刷新后,各分析模块(凯利/体检/回撤/止损/铁律)都会用<strong>最新占比与浮盈亏</strong>联动计算。持仓表「今日」列显示的是<strong>你的个人当日收益率</strong>(当日盈亏 ÷ 当日成本基础)——中途建仓/加仓的日子按买入价算,而非标的全天涨幅;金额同理按开盘持股+当日成交价精确分解。</p>'],
    ['快照与云端', '<p>全部数据存到<strong>你自己的服务器</strong>(访问密码保护),换设备/清缓存自动恢复。每天(含服务器定时 22:00/23:00/23:30)记录一份快照,是趋势、归因、基准对比的数据源;数据记错可在<strong>设置→数据管理→恢复到某一天</strong>一键回退。</p>'],
    ['出入金登记（收益率真实性的关键）', '<p>转入/转出资金会让「净值变化」严重失真——加了 10 万工资,净值 +10% 也不是你赚的。在「资产趋势 → 出入金登记」记一笔(正=入金 负=出金),TWR 收益率、收益归因、基准对比全部自动剔除这些流水。<strong>不登记,所有收益率口径都只是"账户余额变化"。</strong></p>'],
  ]);

  G('wallet', '投资组合 · 总览与 AI 诊断', [
    ['怎么用', '<p>查看大类配置、按类别明细、币种敞口与全部持仓（<strong>按住行可拖拽排序</strong>，顺序自动保存到云端）；点「生成 AI 组合诊断」由 DeepSeek 给出健康度评分与下一步建议。</p>'],
    ['计算逻辑', '<p>把每笔资产按汇率折算人民币后，归并为大类（权益/固收理财/现金/黄金），并按类别、币种分别汇总占比；美元敞口 = 所有 USD 计价资产折人民币之和。AI 诊断把这些占比 + 股票子组合的有效持仓数/因子集中度打包发给模型。</p>'],
    ['理论', '<p>基于<strong>资产配置理论</strong>：长期收益的绝大部分由大类配置（而非选股择时）决定；跨大类、跨币种分散能在不显著牺牲收益的前提下降低组合波动。</p>'],
    ['遵循的收益', '<p>一个均衡、不过度集中于单一大类或单一 beta 的组合，能在系统性回调中少受伤、在长期获得更稳的复利，避免“牛市财富逆向转移”。</p>'],
  ]);

  G('chart', '资产趋势 · 净值曲线 / TWR / 基准对比', [
    ['怎么用', '<p>每天自动记录的快照形成净值曲线。<strong>鼠标悬停</strong>看任一日期的数值及较昨日/较上月/较期初变化；可切换总资产/大类/类别维度；顶部选「对比 沪深300 / 标普500」，组合按 TWR 指数化与基准同起点（=100）对比，并给出超额收益；下方是「出入金登记」。</p>'],
    ['计算逻辑', '<p><strong>TWR（时间加权收益率）</strong>：r<sub>日</sub> = (当日资产 − 当日出入金 − 昨日资产) ÷ 昨日资产，逐日连乘。它剔除加钱/取钱的影响，回答「我的投资操作本身赚没赚」；净值简单变化只回答「账户里钱多了没」。基准对比时双方都归一到 100 起算，公平可比。</p>'],
    ['理论', '<p><strong>诚实的计量是一切的起点</strong>：基金业衡量基金经理用的就是 TWR（剔除申赎影响）。<strong>不跑赢基准的主动管理是在付费上班</strong>——基准对比就是这把尺子，连续跑输就该把更多仓位交给宽基指数。</p>'],
  ]);

  G('pie', '收益归因 · 钱是从哪赚的', [
    ['怎么用', '<p>选区间（近 7 天/30 天/本月/全部），看收益按<strong>大类 → 因子 → 标的</strong>三层的贡献分解。「残差」= 利息、手动改金额、当日调仓的变动——残差大说明该区间手动操作多，归因仅供方向参考。</p>'],
    ['计算逻辑', '<p>逐日累加「前一日持股 × 当日价格变动」得每标的贡献，再按大类/因子汇总，全程剔除出入金。需要至少 2 份含明细的快照（每天打开应用自动攒）。</p>'],
    ['怎么用出价值', '<p>如果你以为自己在赚「选股」的钱，归因却发现大部分贡献来自某一个因子（比如 AI），那你实际在做的是<strong>因子押注</strong>——就该用压力测试去管理它，而不是骗自己说分散了。它与体检互相印证：<strong>体检看「现在多集中」，归因看「历史靠什么赚」</strong>。</p>'],
  ]);

  G('warn', '压力测试 · 极端行情亏多少', [
    ['怎么用', '<p>点预设情景（科技成长 −30%、A股系统性 −15%、美股 −20%、黄金 −15%、美元贬值 5%、全面危机），或自定义「对象 + 幅度」叠加多条，直接施加在<strong>当前实际持仓</strong>上，看组合影响金额、幅度，及是否跌破你设的最大回撤阈值（默认 15%，设置可调）。</p>'],
    ['计算逻辑', '<p>冲击按桶施加：个股按因子（科技因子组可整组冲击）、基金/黄金按类别、美元资产额外受汇率冲击；同标的多条命中则叠加（美股 −20% ＋ 美元 −5% ≈ −25%）。不做相关性抵消，是偏保守的估计。</p>'],
    ['理论', '<p><strong>尾部风险管理</strong>：均值-方差告诉你"平时的波动"，压力测试告诉你"出事的时候"——2008、2015、2020 都证明真实尾部远比正态分布厚。对「集中」有金额上的体感（"这一下就是 −30 万"），比任何百分比都更能管住手。</p>'],
  ]);

  G('scissors', '再平衡 · 从"偏了"到"调回来"', [
    ['怎么用', '<p>设定各大类目标占比（合计须 100%）与偏离阈值（默认 5 个百分点）。偏离超线 → 自动生成执行清单：超配类按桶内占比分摊<strong>卖出</strong>（股票换算股数，A股按 100 股整手取整），低配类给出<strong>补入金额</strong>。执行前建议先过「⑤ 加减仓计划」的退出/铁律检查——逻辑已破的票优先减。</p>'],
    ['计算逻辑', '<p>偏离 = 实际% − 目标%；卖出金额 = 偏离 × 总资产，桶内按资产占比分摊；买入按桶给金额，具体标的由你定（优先补该桶内现有品种）。</p>'],
    ['理论', '<p><strong>再平衡红利</strong>：本质是制度化的高卖低买——把涨多的减下来、跌多的补回去，让风险结构不随行情漂移。纪律化再平衡长期可增厚收益并显著降低回撤。但它不是频繁操作：<strong>偏离超线或每季度看一次即可</strong>，过度再平衡只会贡献手续费。</p>'],
  ]);

  G('gauge', '股票体检 · 弹性引擎（已合并「组合分散」）', [
    ['定位', '<p>你的股票是<strong>博收益弹性</strong>的引擎,由基金/理财/黄金/现金压舱。所以体检的问题不是"每只是否够保守",而是"<strong>这台引擎的总风险是否可控、是否真分散、有没有该复核的深套</strong>"。目标弹性仓占比与风险档在「设置」里定。</p>'],
    ['关键指标', '<p><strong>弹性仓回撤贡献</strong> = Σ(各股占总资产% × 各股最大跌幅),对比你能承受的最大回撤——只要在承受线内,说明"小仓博弹性"成立,股票不必因单看不够保守就减。另含<strong>有效持仓数</strong>(逆 HHI = 1/Σ因子权重²,戳破假分散)、因子集中度、弹性仓占比 vs 目标、深套复核提示,汇成一个<strong>纯客观健康分</strong>(不依赖 AI 猜胜率)。</p>'],
    ['理论', '<p><strong>核心-卫星 + 风险预算</strong>:用稳定的核心(基金/理财/黄金/现金)托底,让小比例的卫星(股票)去博弹性;因为卫星只占一小块,即便它大幅回撤,对全组合冲击也有限——这正是敢在股票上进取的底气。分散的收益来自<strong>低相关</strong>而非数量。</p>'],
    ['遵循的收益', '<p>把注意力从"每只涨不涨"移到"整台引擎的风险与分散",既不会因短期全红而错杀弹性,也不会让某一条 beta 或某只深套悄悄把风险堆到承受线之外。</p>'],
  ]);

  G('pie', '① 凯利定注 · 单标的下注', [
    ['傻瓜模式(推荐)', '<p>顶部选一只<strong>持仓或基金</strong>→点「让 AI 评估」,DeepSeek 按对该标的的认知给出<strong>保守估计</strong>的胜率、上涨/下跌空间和多空理由,自动算出 ¼ 凯利目标仓位,并与你当前占比对比给出加/减仓空间(含金额)。参数会回填到下方计算器供微调。<strong>AI 估计每次可能略有出入,只作起点参考,非投资建议。</strong></p>'],
    ['怎么用', '<p>或手动填赢/输情形的涨跌幅、胜率，并各写≥2 条看多/看空的客观理由；先过 EV 闸门，再看满/半/¼ 凯利三档，默认执行 ¼ 凯利。</p>'],
    ['计算逻辑', '<p>期望值 <code class="formula">EV = p×涨幅 − q×跌幅</code>，EV&lt;0 直接淘汰；净赔率 <code class="formula">b = 涨幅 ÷ 跌幅</code>；凯利 <code class="formula">f = (b×p − q) / b</code>；实战取 <code class="formula">f×0.25</code> 以降低参数误差。</p>'],
    ['理论', '<p><strong>凯利公式（Kelly Criterion）</strong>：在已知赔率与胜率下，使资金<strong>长期复利增长率最大</strong>的下注比例。半/四分之一凯利用来对冲主观胜率高估的风险。</p>'],
    ['适用边界(重要)', '<p>凯利是给<strong>单一、独立、可重复的方向性下注</strong>算最优比例的,适合<strong>有明确催化剂的个股/集中头寸</strong>。对<strong>宽基/低波/红利/债/货币等分散型配置资产</strong>会系统性<strong>低估</strong>——因为它们的价值在于分散与稳定(低相关),而非单标的的方向性赔率,且凯利在“边际很薄”时会把仓位压到近乎 0。所以本工具对配置型基金<strong>不用凯利定仓</strong>,改按<strong>资产角色 + 策略权重区间</strong>(核心 8–30%、主题卫星 3–12%),凯利仅作参考。</p>'],
    ['遵循的收益', '<p>个股按（分数）凯利下注,长期比“凭感觉重仓/轻仓”获得更高复利、更低爆仓概率;配置资产按角色权重定,则保住分散与稳定的基本盘,两者各司其职。</p>'],
  ]);

  G('shield', '② 铁律校验 · 操作拦截引擎', [
    ['怎么用', '<p>放在凯利定注之后:任何“加仓”前跑一遍校验。选已有持仓会带出<strong>最新占比/浮盈亏</strong>;加仓以<strong>金额优先</strong>;触发硬性铁律弹出必须二次确认的红色拦截,较轻的情况给黄色<strong>软提醒</strong>(不拦截)。</p>'],
    ['亏损加仓为何“分级”而非一刀切', '<p>真正致命的不是“浮亏就加”,而是两种具体行为:<strong>接下跌的刀</strong>(还在跌就加)和<strong>深套摊平</strong>(超深套阈值还往里加、拒绝承认逻辑破坏)。而<strong>计划内分批/定投</strong>和<strong>企稳/反转后的底部补仓</strong>是合理的。所以:深套硬拦(需复核原逻辑);下跌趋势硬拦(接刀);浅亏且非计划内→软提醒;浅亏+勾选“计划内分批”+非下跌→放行。勾选框强制你分清“计划”还是“摊平”。</p>'],
    ['计算逻辑', '<p>规则:亏损加仓(分级)、下跌趋势加仓、超单股上限、正金字塔(高位加仓额≥上次)、因子集中度&gt;60%、现金池&lt;下限、胜率&gt;60% 无充分理由。</p>'],
    ['理论', '<p><strong>行为金融学 + 交易纪律</strong>：把处置效应、损失厌恶、沉没成本、追高等人性弱点,用规则在情绪化时刻拦下——但不误伤“有纪律的计划内分批”。</p>'],
  ]);

  G('gauge', '③ 回撤控制 · 最大回撤约束', [
    ['怎么用', '<p>设定组合可承受的最大回撤阈值（默认 15%），本页按<strong>最新持仓占比</strong>显示回撤预算“已用/剩余”(表格含浮盈亏/今日涨跌)，并给出每只高波动持仓的理论仓位上限。点表格任意行看该股解读。</p>'],
    ['计算逻辑', '<p>单股回撤贡献 <code class="formula">= 持仓占比 × 该股最大跌幅</code>；组合预估回撤 = 各股贡献之和；单股理论上限 <code class="formula">= 回撤阈值 ÷ 该股最大跌幅</code>。</p>'],
    ['理论', '<p><strong>风险预算（Risk Budgeting）</strong>：把“可承受回撤”当成一笔总预算，分配给各持仓，而不是只盯仓位百分比。</p>'],
    ['遵循的收益', '<p>组合整体回撤被钉在你能承受的范围内，避免深套后被迫在底部割肉——控制回撤本身就是提高长期复利的关键（跌 50% 需涨 100% 才回本）。</p>'],
  ]);

  G('scissors', '④ 止损防御 · 固定分数止损', [
    ['怎么用', '<p>顶部可<strong>从持仓/基金选择</strong>,自动带出成本价填入「买入价」(可手改);再填单笔可接受最大亏损(默认 2%)与计划止损价,反推“最多能买多少”。总资产自动汇总。</p>'],
    ['计算逻辑', '<p><code class="formula">最大可买仓位 = (总资产 × 单笔风险%) ÷ 止损幅度%</code>，其中止损幅度 = (买入价−止损价)/买入价。</p>'],
    ['理论', '<p><strong>固定分数法（Fixed-Fractional）</strong>：先定“这一笔最多亏本金的多少”，再由止损距离倒推仓位——把亏损前置锁死。</p>'],
    ['遵循的收益', '<p>单笔亏损被限制在总资产的固定小比例（如 2%），连续犯错也难伤筋动骨，保证你“留在牌桌上”等到属于自己的大机会。</p>'],
  ]);

  G('ruler', '⑤ 加减仓计划（加仓 / 减仓·退出 两个标签）', [
    ['加仓计划', '<p>输入标的代码点「获取现价」,自动填价位区间;生成“越低买越多”的<strong>正金字塔</strong>分批。橄榄型模板规划试水→主力→收缩;浮盈超阈值(默认 +30%)提醒隔离部分利润(落袋为安)。</p>'],
    ['减仓/退出(科学退出算法)', '<p>卖出被<strong>处置效应</strong>与<strong>沉没成本</strong>绑架,所以只看向前看的事实、<strong>成本价不参与决策</strong>。两个开关:①原逻辑是否仍成立 ②今天空仓会不会按现价买。决策树:<br>· 逻辑已破 / 跌破止损 → <strong>计划性退出</strong>(目标 0,3 批短窗口出);<br>· 逻辑成立但超弹性仓单股上限 → <strong>减到合规</strong>(只减超出部分,逢反弹分批);<br>· 逻辑成立、没超预算,但“今天不会买” → <strong>减仓</strong>(处置效应警示);<br>· 逻辑成立、今天还会买 → <strong>持有</strong>(深套也别在低点割)。</p>'],
    ['股票现金池(持股变动自动结算)', '<p>在「持仓」页<strong>改持股数即自动结算</strong>:Δ股数×现价,差额为正(净卖出)=资金盈余,自动<strong>计入现金池</strong>;差额为负(净买入)=动用现金,自动<strong>从池中扣减</strong>。按市场分币种:<strong>A股动人民币「股票现金池」,美股动美元「美股现金池」</strong>(都在投资组合 → 现金分类)。两池余额在持仓页底部实时可见;余额为负代表动用了池外资金。⑤减仓决策里的「一键记账」走同一套结算引擎。总资产始终守恒(股票↓＝现金↑),现金蓄水池铁律按真实现金计算。</p>'],
    ['理论', '<p><strong>“今天还会买吗”测试</strong>是破解深套死扛的关键:它把问题从"我亏了多少舍不舍得割"(向后看、被成本绑架)翻成"它未来还值不值得占这笔钱"。<strong>成本是沉没成本,市场不知道也不在乎你买在多少。</strong>研究亦表明投资者卖出决策质量普遍差,故用规则化退出。</p>'],
    ['遵循的收益', '<p>深套逻辑破了能果断认赔(=买回选择权),逻辑没破又能避免恐慌割在低点;加仓摊薄成本、减仓卖在相对高点,一进一出都有纪律。</p>'],
  ]);

  G('globe', '市场指标 · 宏观变量看板', [
    ['怎么用', '<p>集中跟踪影响组合的宏观变量：利率 / 通胀 / 汇率 / 恐慌指数。大部分<strong>自动拉取</strong>（美元指数、VIX、中国 CPI/PMI/LPR、美国 CPI/失业率/核心PCE/PMI、美联储利率）；拉不到的（FOMC 倾向、社融、美债/中债收益率）每项旁边有来源链接，<strong>每月手动更新一次</strong>即可。</p>'],
    ['怎么用出价值', '<p>别把看板当新闻看。每项都写了「对你组合的影响」——比如美元资产占你组合约 1/4，美元指数走弱 5%，人民币计价账面就少吃约 5%。看指标时问一句：<strong>我哪个持仓对它最敏感？</strong>答不上来的指标，对你就是噪音。</p>'],
  ]);

  G('clipboard', '决策卡 · 为什么买 / 何时认错', [
    ['怎么用', '<p>买入前（或现在补上）给最看重的 2–3 只个股建卡：<strong>一句话看多逻辑</strong> + <strong>最强反方论证（必填）</strong> + <strong>2–3 条证伪条件</strong>（可观测的客观事件，如"单季扣非同比转负"，不能写"跌了很多"），再填入场/目标/止损价与<strong>逻辑兑现窗口</strong>。日后条件发生就勾中——那一刻不是重新找理由的时候。</p>'],
    ['三处自动接线', '<p>① 勾中任一证伪条件 → 该标的在<strong>再平衡</strong>里自动排到卖出队首（权重最高）；② 逻辑窗口到期未兑现 → 触发<strong>时间止损</strong>，在卖出排序里加权（排在凯利稳健为负之下、冗余度之上）；③ 触及目标价/止损价/到期 → 一键记入<strong>复盘校准</strong>，回填结果后计入你的真实胜率。</p>'],
    ['加仓三道闸', '<p>填了入场价与止损价就会算出这笔<strong>最多能买多少</strong>：<code class="formula">仓位% = 单笔风险% ÷ 止损幅度%</code>（Van Tharp 风险预算法），再与<strong>单标的集中度上限</strong>、<strong>该层剩余空间</strong>取最小值。注意止损很紧时这个公式会授权很大的仓位——所以它是三道闸之一，不是仓位决定器。A股跌停/美股跳空时止损不在设定价成交，"最多亏 2%" 是上限不是保证。</p>'],
    ['为什么不做 AI 多空辩论打分', '<p>让模型给自己的论证打 0–10 分再加权，看着量化实则不稳定——同一输入两次结果就能不同（凯利模块已验证过这个问题）。所以这里只用 AI 干它真正擅长且低风险的事：<strong>帮你想反面</strong>（生成反方论证与证伪条件建议），<strong>明确不输出买卖评级、不给目标价</strong>。生成结果请按自己的理解改写后再存——照抄等于把判断外包。</p>'],
    ['理论', '<p><strong>事前承诺（Pre-commitment）+ 可证伪性（Popper）</strong>：投资中最贵的错误不是买错，而是买错之后不断为它编新理由。把证伪条件写在买入之前、由当时清醒的你定义，等于给未来情绪化的你留下一份约束——这是本工具「把人性约束固化成代码」的核心一例。</p>'],
  ]);

  G('check', '复盘校准 · 判断力体检', [
    ['怎么用', '<p>把你的预测（"AI 板块 Q3 走强"）和当时的置信度记下来，到期对照实际打分。长期记录能回答：我的判断胜率多少？我哪类判断系统性不靠谱？</p>'],
    ['理论', '<p><strong>校准（Calibration）</strong>：专业预测者与普通人的区别不在于更准，而在于<strong>知道自己有多准</strong>。连续记录会暴露系统性过度自信——它管的是"你"这个组合里最大的风险源。</p>'],
  ]);

  app.appendChild(el(`<div class="card"><div class="alert amber"><span class="icon">${icon('warn')}</span><div>
    <strong>免责声明</strong>：本工具仅做量化计算与纪律校验，不构成投资建议；AI 点评为模型生成，仅供参考。所有模型都依赖你的主观输入，输入不实则结论不实。最终决策与结果由你自己负责。</div></div></div>`));
};

// 历史数据补建：把「持仓」里有代码、有股数与现价、但「投资组合」里没有的标的，
// 一次性补建成对应股票资产。幂等（已存在同代码资产则跳过），返回补建数量。
function backfillPositionAssets() {
  const fx = currentFx();
  let created = 0;
  (STATE.positions || []).forEach(p => {
    const code = (p.code || '').trim();
    if (!code) return;
    if ((STATE.assets || []).some(a => a.code === code)) return;   // 组合里已有
    const shares = num(p.shares), px = num(p.price), cost = num(p.cost);
    if (!(shares > 0 && px > 0)) return;                            // 缺股数/现价无法估值
    const isUs = isUsCode(code);
    const na = {
      id: uid(),
      platform: isUs ? '美股券商' : '股票账户',
      category: isUs ? '美股股票' : 'A股股票',
      name: p.name, code,
      currency: isUs ? 'USD' : 'CNY',
      shares, lastPx: px,
      amount: Math.round(shares * px * 100) / 100,
      pnl: cost > 0 ? Math.round(shares * (px - cost) * (isUs ? fx : 1) * 100) / 100 : 0,
      note: '由「持仓」历史数据自动补建，如为基金/其它可改类别',
    };
    na.cny = Math.round(assetCny(na, fx));
    (STATE.assets = STATE.assets || []).push(na);
    created++;
  });
  return created;
}

/* -------------------------------------------------------------------------
   启动
   ------------------------------------------------------------------------- */
applyTheme(currentTheme());
// ?theme=dark|light 可强制指定主题（测试/分享链接用，不写入偏好）
{
  const qt = (() => { try { return new URLSearchParams(location.search).get('theme'); } catch (_) { return null; } })();
  if (qt === 'dark' || qt === 'light') applyTheme(qt);
}
const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) {
  themeBtn.innerHTML = themeToggleInner(currentTheme());
  themeBtn.onclick = toggleTheme;
}
render();                        // 先用本机缓存渲染（离线也能用）
updateCloudBadges();
// 初始化标签高亮（配合 ?view= 直达参数），并把激活标签滚动进视野
document.querySelectorAll('.tab').forEach(t =>
  t.classList.toggle('active', t.dataset.view === currentView));
centerActiveTab();
// 字体/资源加载后标签宽度会变，需补居中，否则激活标签仍可能露不出来
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => centerActiveTab());
window.addEventListener('load', () => centerActiveTab());

// 版本自检：服务器部署了新代码、而本页还是旧代码时（SPA 长期不关页/浏览器恢复标签页
// 都不会自动拿新文件），弹「点此更新」。构建号在部署时写进 index.html 的 meta[name=build]。
const BUILD_ID = (document.querySelector('meta[name="build"]') || {}).content || '__BUILD__';
let updateToastShown = false;
async function checkForUpdate() {
  if (!BUILD_ID || BUILD_ID === '__BUILD__') return;   // 本地开发无构建号，跳过
  try {
    const r = await fetch('version.json?_=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.build && j.build !== BUILD_ID && !updateToastShown) {
      updateToastShown = true;
      const t = document.createElement('div');
      t.id = 'update-toast';
      t.textContent = '已有新版本，点此更新';
      t.title = '服务器上的代码比当前页面新，点击刷新以加载最新版';
      t.onclick = () => location.reload();
      document.body.appendChild(t);
    }
  // 离线或无 version.json（本地开发）时静默跳过
  } catch (_) {}
}
checkForUpdate();
setInterval(checkForUpdate, 10 * 60 * 1000);                       // 每 10 分钟自检
document.addEventListener('visibilitychange', () => {              // 切回标签页时自检
  if (!document.hidden) checkForUpdate();
});

// 启动后台任务：先与云端对账（取较新者）→ 刷新基金/股票估值 → 记录今日快照
(async () => {
  const { changed } = await initCloudSync();       // 拉云端整份数据并对账
  if (changed) render();                           // 云端更新 → 重绘
  const backfilled = backfillPositionAssets();     // 历史持仓补建为投资组合资产（幂等）
  if (backfilled > 0) saveState();                 // 有补建 → 保存并回传云端
  const refreshed = await autoRefreshQuotes();     // 打开页面自动更新涨跌（15 分钟节流）
  recordDailySnapshot();                           // 记录/更新今日快照（saveState 会自动回传云端）
  if (refreshed || changed || backfilled > 0) render();
})();
