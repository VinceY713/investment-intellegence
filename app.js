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
  '半导体': '科技成长', '机器人': '科技成长', '新能源车': '科技成长',
  '创新药': '医药消费', '消费': '医药消费',
  '银行': '价值周期', '地产': '价值周期', '能源': '价值周期',
  '军工': '主题', '其它': '其它', '黄金': '避险',
};
const GROUP_CORR = 0.72;   // 同一大组（如均属科技成长）默认相关
const CROSS_CORR = 0.32;   // 跨组默认相关（A股系统性 beta 不低，同涨同跌常见）
function factorCorr(a, b) {
  if (a === b) return 1;
  const ga = FACTOR_GROUPS[a] || '其它', gb = FACTOR_GROUPS[b] || '其它';
  if (ga === '避险' || gb === '避险') return (ga === '避险' && gb === '避险') ? 1 : -0.05; // 黄金 vs 权益
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
//  · us   → 腾讯美股前复权日K（usfqkline，经 /api/uskline）
//  · fund → 场外公募基金历史净值（东财 lsjz，经 /api/fundhist）—— 联接/QDII 无盘中日K，用确认净值序列算相关
//  · a    → A股/港股通/场内ETF 前复权日K（fqkline，经 /api/kline）
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
  // 美股走腾讯 usfqkline（与 A股 fqkline 不同路径），否则回不来数据
  const ep = isUsCode(code) ? '/api/uskline' : '/api/kline';
  const res = await fetch(ep + '?param=' + encodeURIComponent(sym + ',day,,,' + count + ',qfq'), { cache: 'no-store' });
  if (!res.ok) throw new Error('接口返回 ' + res.status);
  const j = await res.json();
  const node = j && j.data && j.data[sym];
  const arr = node && (node.qfqday || node.day || node.week || node.qfqweek);
  if (!Array.isArray(arr) || !arr.length) throw new Error('无K线数据');
  return arr.map(r => ({ date: r[0], close: parseFloat(r[2]) })).filter(x => isFinite(x.close) && x.close > 0);
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
  return { pool, ratio, ccy };
}

// 当日开盘持股：① 当日编辑时快照的 sodShares；② 否则取「今天之前最近一份快照」里同标的股数
// （= 今日开盘持仓，能对已发生的改动追溯生效）；③ 再否则用当前股数。
function sodSharesOf(a) {
  const today = todayStr();
  if (a.sodDate === today && a.sodShares != null) return num(a.sodShares);
  const snaps = (STATE.snapshots || []).filter(s => s && s.date && s.date < today).sort((x, y) => (x.date < y.date ? 1 : -1));
  for (const s of snaps) {
    const sa = (s.assets || []).find(x => (a.code && x.code === a.code) || (a.id && x.id === a.id));
    if (sa && num(sa.shares) > 0) return num(sa.shares);
  }
  return num(a.shares);
}
// 当日盈亏金额（人民币，带正负）——按「当日开盘持股」算，而非当前持股。
// 今天增/减持后，当日盈亏只算你当日开盘时就持有的那部分，和实际一致。
function todayTradesOf(a) {
  return (a && a.tradesDate === todayStr() && Array.isArray(a.todayTrades)) ? a.todayTrades : [];
}
function dayPnlCny(a, fx) {
  fx = fx || currentFx();
  const dp = num(a.dayPct), px = num(a.lastPx);
  if (!isFinite(dp) || dp === 0 || !(px > 0)) return 0;
  const prev = px / (1 + dp / 100);                       // 昨收
  const cf = a.currency === 'USD' ? fx : 1;
  const trades = todayTradesOf(a);
  const hasPos = num(a.shares) > 0 || (a.sodDate === todayStr() && a.sodShares != null) || trades.length;
  if (hasPos) {
    const sod = sodSharesOf(a);
    // 精确分解：开盘持股 = 全天持有 + 当日卖出；再加当日买入(买入价→收盘)
    let totalSell = 0; trades.forEach(t => { if (t.type === 'sell') totalSell += num(t.shares); });
    const heldThrough = Math.max(0, sod - totalSell);      // 从开盘持有到收盘
    let pnl = heldThrough * (px - prev);
    trades.forEach(t => {
      if (t.type === 'sell') pnl += num(t.shares) * (num(t.price) - prev);   // 昨收→卖出价
      else if (t.type === 'buy') pnl += num(t.shares) * (px - num(t.price)); // 买入价→收盘
    });
    if (sod === 0 && a.sodDate === todayStr() && !trades.length) return 0;   // 当日纯新建仓、无交易记录
    return pnl * cf;
  }
  // 无持股数（手填金额资产）→ 回退按当前市值估算
  return assetCny(a, fx) * dp / (100 + dp);
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
    settleToPool(sh * pr, a.currency === 'USD' ? 'USD' : 'CNY', '卖出' + a.name);
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
  if (!t) return;
  const fx = currentFx();
  a.shares = num(t.prevShares);
  if (t.prevPnl !== undefined) a.pnl = t.prevPnl;
  settleToPool(t.type === 'buy' ? (t.shares * t.price) : -(t.shares * t.price),
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

function uid() {
  return 'p' + Math.random().toString(36).slice(2, 9);
}

/* -------------------------------------------------------------------------
   每日资产快照（以 7/19 为起点）→ 支撑「资产趋势」按月/季/年查看
   ------------------------------------------------------------------------- */
function todayStr() {
  const d = new Date();
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
  saveState();
  return true;
}

// 每次进入应用记录「今日」快照：同日则覆盖为最新值，跨日则新增一条。
function recordDailySnapshot() {
  if (!STATE.assets || !STATE.assets.length) return;
  STATE.snapshots = STATE.snapshots || [];
  const t = todayStr();
  const snap = makeSnapshot(t);
  const idx = STATE.snapshots.findIndex(s => s.date === t);
  if (idx >= 0) STATE.snapshots[idx] = snap;
  else STATE.snapshots.push(snap);
  STATE.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  saveState();
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
  const vals = points.map(p => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min = min * 0.98; max = max * 1.02 || 1; }
  const pad = (max - min) * 0.12; min -= pad; max += pad;
  const n = points.length;
  const X = i => padL + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const Y = v => padT + ih * (1 - (v - min) / (max - min));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
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
    ${dots}${xlab}
  </svg>`);
  return svg;
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
  if (!name || !isFinite(price)) throw new Error('解析失败');
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
  if (!name || !isFinite(price)) throw new Error('解析失败');
  return { name, price, changePct: isFinite(changePct) ? changePct : null, prevClose: prevClose > 0 ? prevClose : null };
}

async function fetchQuote(rawCode) {
  const code = String(rawCode || '').trim();

  // 美股（含字母代码，如 TCOM / AAPL）：腾讯 us 前缀；新浪 gb_ 前缀兜底
  if (isUsCode(code)) {
    const sym = code.toUpperCase().replace(/\s+/g, '');
    try {
      return parseTencent(await getQuoteText('/api/quote?code=' + encodeURIComponent('us' + sym)), { us: true });
    } catch (e1) {
      try {
        return parseSina(await getQuoteText('/api/quote_sina?code=' + encodeURIComponent('gb_' + sym.toLowerCase())), { us: true });
      } catch (e2) {
        throw new Error('美股行情获取失败（代码可能有误或已休市），可手动填名称与现价');
      }
    }
  }

  // A股 / ETF / 基金 / 可转债：5–6 位数字
  if (!/^\d{5,6}$/.test(code)) throw new Error('请输入 5–6 位数字代码（A股/ETF），或美股字母代码（如 TCOM）');
  const full = detectMarket(code) + code;
  const q = encodeURIComponent(full);
  // 先腾讯，失败再退回新浪
  try {
    return parseTencent(await getQuoteText('/api/quote?code=' + q));
  } catch (e1) {
    try {
      return parseSina(await getQuoteText('/api/quote_sina?code=' + q));
    } catch (e2) {
      throw new Error('腾讯/新浪均失败（代码可能有误或已休市）');
    }
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
  let px = null, dayPct = null;
  if (a.category === '黄金') {
    const g = await fetchGold(fx); px = g.px; dayPct = g.dayPct;   // 金价（元/克）+ 当日涨跌
  } else if (a.category === '基金') {
    const f = await fetchFund(a.code); px = f.nav; dayPct = f.dayPct;
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
    a.lastPx = px; if (dayOk != null) a.dayPct = dayOk; a.pxDate = todayStr();
    return false;
  }
  const deltaCny = (newVal - oldVal) * (a.currency === 'USD' ? fx : 1);
  a.amount = Math.round(newVal * 100) / 100;
  a.cny = Math.round(assetCny(a, fx));
  if (a.pnl != null) a.pnl = Math.round((num(a.pnl) + deltaCny) * 100) / 100;
  a.lastPx = px;
  if (dayOk != null) a.dayPct = dayOk;
  a.pxDate = todayStr();
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
    const a = (STATE.assets || []).find(x => x.code === p.code);
    if (!a) return;
    const vCny = assetCny(a, fx);
    if (total > 0) p.weight = +(vCny / total * 100).toFixed(4);
    if (a.pnl != null && a.amount != null) {
      const pnlOrig = a.currency === 'USD' ? num(a.pnl) / fx : num(a.pnl);
      const cost = num(a.amount) - pnlOrig;
      if (cost > 0) p.pnl = +(pnlOrig / cost * 100).toFixed(2);   // 持仓 pnl 存的是浮盈亏%
    }
    if (num(a.lastPx) > 0) p.price = a.lastPx;
    if (a.dayPct != null) p.dayPct = a.dayPct;
    if (num(a.shares) > 0) p.shares = a.shares;
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
      (STATE.assets || []).forEach(a => todayTradesOf(a).forEach((t, i) => {
        rows.push(`<tr><td>${escapeHtml(a.name)}</td><td>${t.type === 'buy' ? '<span style="color:var(--red-ink)">买入</span>' : '<span style="color:var(--green-ink)">卖出</span>'}</td>
          <td class="num">${Math.round(num(t.shares)).toLocaleString()}</td><td class="num">${num(t.price)}</td>
          <td class="num"><button class="btn danger small" data-undo="${a.id}:${i}">撤销</button></td></tr>`);
      }));
      box.innerHTML = rows.length
        ? `<div class="mini-label" style="margin-top:8px">今日交易记录</div><div class="table-scroll"><table><thead><tr><th>标的</th><th>方向</th><th class="num">股数</th><th class="num">成交价</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
        : '<p class="inline-note">今天还没有交易记录。</p>';
      box.querySelectorAll('[data-undo]').forEach(btn => btn.onclick = () => {
        const [id, i] = btn.dataset.undo.split(':');
        const a = (STATE.assets || []).find(x => x.id === id);
        if (a && confirm('撤销这笔当日交易？将还原股数、现金池与浮盈亏。')) { undoDayTrade(a, +i); saveState(); render(); }
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
        if (recordDayTrade(a, type, shares, price)) { saveState(); render(); }
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
      const settlePx = price > 0 ? price : (oldPos && num(oldPos.price) > 0 ? num(oldPos.price) : 0);
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
      // 有股数的持仓：删除可视为「全部卖出」并把所得计入现金池（有联动资产的不重复结算，资产仍在投资组合里）
      if (p) {
        const hasAsset = p.code && (STATE.assets || []).some(x => x.code === p.code);
        const prev = hasAsset ? null : previewSharesSettlement(num(p.shares), 0, num(p.price), p.code);
        if (prev && confirm(`删除「${p.name}」视为全部卖出：${p.shares} 股 ≈ ${fmtOrig(-prev.deltaOrig, prev.ccy)}，盈余计入「${poolName(prev.ccy)}」？\n「确定」=卖出并入账，「取消」=仅删除记录、不动现金池。`)) {
          settleToPool(-prev.deltaOrig, prev.ccy, '卖出' + p.name + '（删除持仓）');
        }
      }
      STATE.positions = STATE.positions.filter(x => x.id !== b.dataset.del);
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
const KELLY_EVAL_CACHE = {};

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
      // 会话内缓存：键随「真正影响评估的输入」变化（代码+日期+因子+趋势），
      // 不含 maxDrop/浮盈亏/仓位——这些不该影响标的自身的下注质量评分，避免“回填回撤数据后评分突变”。
      const cacheKey = ((p.code || p.name || '').toLowerCase()) + '|' + todayStr() + '|' + (p.factor || '') + '|' + (p.trend || '');
      let cached = KELLY_EVAL_CACHE[cacheKey], win, up, down, bulls, bears, note, fromCache = false;
      if (cached) {
        ({ win, up, down, bulls, bears, note } = cached); fromCache = true;
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
        KELLY_EVAL_CACHE[cacheKey] = { win, up, down, bulls, bears, note };
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
      if (rtype === 'stock') {
        // 个股/集中头寸：凯利适用
        const target = Math.max(0, f * frac * 100);
        const capped = Math.min(target, s.singleCap);
        const diff = capped - cur;
        const diffMoney = total > 0 ? Math.abs(diff) / 100 * total : 0;
        sizing = `<div class="result-box"><div class="metric-row"><span class="k">${fracTxt} 凯利目标仓位（≤单股上限 ${s.singleCap}%）</span><span class="v" style="color:var(--accent-ink)">${capped.toFixed(1)}%${total > 0 ? '（约 ' + fmtMoney(capped / 100 * total) + '）' : ''}</span></div></div>`;
        if (ev < 0) advice = `<div class="alert red"><span class="icon">${icon('danger')}</span><div><strong>EV 为负（${ev.toFixed(1)}%）· 数学上不值得下注</strong><br>纪律做法：不加仓，考虑减仓或离场；当前占 ${cur.toFixed(1)}%。</div></div>`;
        else if (f <= 0) advice = `<div class="alert amber"><span class="icon">${icon('warn')}</span><div><strong>期望值恰为零（EV=0）</strong>：凯利仓位为 0，数学上不值得下注，建议观望。</div></div>`;
        else if (diff > 0.5) advice = `<div class="alert green"><span class="icon">${icon('check')}</span><div><strong>目标 ${capped.toFixed(1)}% vs 当前 ${cur.toFixed(1)}% → 有 ${diff.toFixed(1)} 个百分点空间（约 ${fmtMoney(diffMoney)}）</strong><br>加仓前必须过「⑤ 铁律校验」。</div></div>`;
        else if (diff < -0.5) advice = `<div class="alert amber"><span class="icon">${icon('warn')}</span><div><strong>目标 ${capped.toFixed(1)}% vs 当前 ${cur.toFixed(1)}% → 超配 ${(-diff).toFixed(1)} 个百分点（约 ${fmtMoney(diffMoney)}）</strong><br>按凯利纪律应逐步减到目标附近，别一次性调仓。</div></div>`;
        else advice = `<div class="alert green"><span class="icon">${icon('check')}</span><div><strong>当前 ${cur.toFixed(1)}% ≈ 目标 ${capped.toFixed(1)}%，仓位基本合理</strong>，保持并按纪律跟踪即可。</div></div>`;
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
        <p class="inline-note">${fromCache ? '本次会话已评估过该标的，复用一致结果（<a href="#" id="ka-recompute" style="color:var(--accent-ink)">重新评估</a>）。' : ''}参数已回填到下方计算器，可自行微调后重算。AI 生成内容仅供参考，不构成投资建议。</p>`;

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
      if (recompute) recompute.onclick = (e) => { e.preventDefault(); delete KELLY_EVAL_CACHE[((p.code || p.name || '').toLowerCase()) + '|' + todayStr() + '|' + (p.factor || '') + '|' + (p.trend || '')]; evaluateCandidate(p); };

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
        if (t) t.weight += add; else posCopy.push({ factor, weight: cur + add });
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
      costSum += tradeCost(pyCode, shares * price, 'buy');
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
        const r = applySellToPool(p.id, amt);
        recordDailySnapshot();            // 资产结构变了 → 覆盖今日快照
        alert(`已记账：${fmtMoney(amt)} 计入「${poolName(r.ccy)}」（当前余额 ${fmtOrig(r.pool, r.ccy)}）。`);
        render();
      };
    };
  } // end renderReduce
};

/* =========================================================================
   视图：复盘校准 —— 记录每次判断的胜率/空间，事后回填结果，
   用 Brier 分数 + 校准曲线校准你（与 AI）的判断力。这是「长出投资大脑」的核心闭环。
   ========================================================================= */
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
        STATE.settings = Object.assign({}, DEFAULT_SETTINGS, imported.settings || {});
        STATE.positions = imported.positions || [];
        STATE.assets = imported.assets || [];
        STATE.portfolio = Object.assign({ totalAssets: Math.round(SEED_TOTAL) }, imported.portfolio || {});
        STATE.snapshots = imported.snapshots || STATE.snapshots || [];
        saveState(); alert('导入成功'); render();
      } catch (err) { alert('导入失败：文件格式不正确'); }
    };
    reader.readAsText(file);
  };
  dataCard.querySelector('#dm-clear').onclick = () => {
    if (!confirm('确定清空全部持仓、资产与设置？此操作不可撤销。')) return;
    STATE = buildEmptyState();
    saveState();
    render();
  };
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

// 通用：调 DeepSeek 并要求返回 JSON（容忍 ```json 包裹等杂质，取第一个 {...} 解析）
async function aiChatJSON(sys, user, opts) {
  opts = opts || {};
  const body = {
    model: AI_MODEL, stream: false,
    temperature: opts.temperature != null ? opts.temperature : 0.15,
    max_tokens: 900,
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
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('AI 返回为空');
  const m = String(content).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 未返回有效 JSON');
  return JSON.parse(m[0]);
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
    <div id="trend-chart" style="margin-top:14px"></div>
    <p class="inline-note" style="margin-top:10px">切换「维度」可分别看总资产或某个大类/类别（如权益、基金、黄金）随时间的走势。</p>
  </div>`);
  app.appendChild(chartCard);

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
    const pts = aggregate(gran, dim);
    const box = chartCard.querySelector('#trend-chart');
    box.innerHTML = '';
    box.appendChild(buildLineChart(pts.map(p => ({ label: p.label, value: p.value }))));
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
        const d = r.last - r.first, p = r.first ? d / r.first * 100 : 0;
        const col = d >= 0 ? 'var(--green-ink)' : 'var(--red-ink)';
        return `<tr><td>${r.label}</td><td class="num">${fmtMoney(r.first)}</td><td class="num">${fmtMoney(r.last)}</td>
          <td class="num" style="color:${col}">${d>=0?'+':''}${fmtMoney(d)}</td>
          <td class="num" style="color:${col}">${d>=0?'+':''}${fmtPct(p,2)}</td></tr>`;
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
        <div class="value" style="font-size:22px">${snaps.length}</div><div class="sub">天</div></div>`;
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
  let interestTotal = 0, pnlTotal = 0;
  assets.forEach(a => {
    const inc = assetIncome(a, fx);
    if (inc.kind === 'interest') interestTotal += inc.value;
    else if (inc.value != null) pnlTotal += inc.value;
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
        <div class="sub">有盈亏记录部分合计</div></div>
    </div>
  `));

  // 大类饼图
  const allocCard = el(`<div class="card"><h3>${icon('pie')} 大类配置</h3></div>`);
  allocCard.appendChild(buildPie(normalize(byBig), { total }));
  app.appendChild(allocCard);

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
    <p class="hint">组合会随时间变化——可随时在下方「管理资产」增删改。按大类排序：股票 → 基金 → 理财 → 黄金 → 现金。
      ${fetchableCount ? `<br>其中 <strong>${fetchableCount}</strong> 只基金/股票可自动更新（打开页面自动刷新，最近 <span id="pf-lastref">${lastRefStr}</span>）。理财为银行自有产品无公开接口，请手动维护。` : ''}</p></div>`);
  const sorted = assets.slice().sort((a, b) => classRank(a.category) - classRank(b.category) || cnyOf(b) - cnyOf(a));
  const hrows = sorted.map(a => {
    const v = cnyOf(a);
    const inc = assetIncome(a, fx);
    let incCell;
    if (inc.kind === 'interest') {
      incCell = `<span style="color:var(--green-ink)" title="年化利息 ${(inc.rate*100).toFixed(2)}%${a.currency==='USD'?'（美元按中间价折算）':''}">+${fmtMoney(inc.value)}<span class="inline-note"> /年</span></span>`;
    } else if (inc.value != null) {
      incCell = `<span style="color:${inc.value>=0?'var(--green-ink)':'var(--red-ink)'}">${inc.value>=0?'+':''}${fmtMoney(inc.value)}</span>`;
    } else { incCell = '—'; }
    let dayCell = '—';
    if (a.dayPct != null && isFinite(a.dayPct)) {
      const up = a.dayPct >= 0;
      // 当日涨跌金额（人民币）——按「当日开盘持股」算，改过股数(增/减持)也与实际一致
      const dayAmt = dayPnlCny(a, fx);
      dayCell = `<span class="pill ${up?'green':'red'}">${up?'+':''}${fmtPct(a.dayPct,2)}</span>`
        + `<br><span class="inline-note" style="color:${up?'var(--green-ink)':'var(--red-ink)'}">${dayAmt>=0?'+':'−'}${fmtMoney(Math.abs(dayAmt))}</span>`;
    } else if (assetFetchable(a) && !(num(a.lastPx) > 0)) {
      dayCell = '<span class="inline-note">待刷新</span>';   // 仅「从未取过价」时提示，取过价则显示 —
    }
    return `<tr>
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
    <button class="btn" id="af-add">${icon('plus')} 添加资产</button>
    <input type="hidden" id="af-edit"/>
    <p class="inline-note" style="margin-top:10px">提示：股票的<strong>买卖请在「持仓」页改持股数</strong>——释放/占用的资金会自动结算到对应现金池（A股 → 股票现金池，美股 → 美股现金池），并同步回写这里的资产金额。</p>
  `));
  app.appendChild(mgmt);
  const $a = sel => mgmt.querySelector(sel);

  $a('#af-add').onclick = () => {
    const name = $a('#af-name').value.trim();
    if (!name) { alert('请填写名称'); return; }
    const cur = $a('#af-cur').value;
    const amount = num($a('#af-amount').value);
    const cat = $a('#af-cat').value;
    const rateStr = $a('#af-rate').value.trim();
    const pnlStr = $a('#af-pnl').value.trim();
    const editId = $a('#af-edit').value;
    const asset = {
      id: editId || uid(), name, code: $a('#af-code').value.trim(),
      platform: $a('#af-platform').value.trim(), category: cat, currency: cur,
      amount, cny: cur === 'CNY' ? amount : amount * currentFx(),
      note: $a('#af-note').value.trim(),
    };
    if (rateStr !== '') asset.annualRate = num(rateStr) / 100;
    if (pnlStr !== '') asset.pnl = num(pnlStr);
    if (editId) {
      const i = STATE.assets.findIndex(x => x.id === editId);
      // 合并保存（不整体替换）：表单只覆盖它能编辑的字段，保留 shares / lastPx /
      // dayPct / pxDate / sodShares / sodDate / todayTrades 等运行期字段。
      // 否则改「金额」或「浮盈亏」时会把持股数、当日盈亏、当日交易记录一并清空——
      // 下次刷新又用 金额÷现价 反推出非整数股数，当日盈亏就和真实持股对不上了。
      if (i >= 0) Object.assign(STATE.assets[i], asset);
    } else { STATE.assets.push(asset); }
    saveState(); render();
  };
  holdScroll.querySelectorAll('[data-adel]').forEach(b => b.onclick = () => {
    if (!confirm('删除这笔资产？')) return;
    STATE.assets = STATE.assets.filter(x => x.id !== b.dataset.adel);
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
   宏观自动拉取（试验）：免 key、境内可达的数据源。市场行情/DXY/VIX/美债走新浪(复用
   /api/quote_sina)；中国 CPI/PMI/LPR 走东财数据中心(/api/emmacro)。部分符号需真机验证，
   拉不到就保留手填、绝不覆盖为空。US CPI/失业/联邦利率暂无可靠免 key 源，保持手填。
   ------------------------------------------------------------------------- */
// 每个指标配多个候选源，逐个尝试直到取到有效值（新浪被封→自动切腾讯/东财/金十）。
// 源类型：sina(新浪 list=,逗号) / thf(腾讯 hf_外盘或us美股) / em(东财中国宏观) / emus(东财美国) / jin10(金十)
// range=[min,max] 合理区间：取到但超区间→判为无效(避免"假成功"，如美元指数取到 3554)，
// 并在诊断里附上原始返回，便于校准取值位置。
const MACRO_AUTO = [
  { key: 'dxy',    label: '美元指数',   range: [70, 130], sources: [ { kind: 'thf', sym: 'hf_ZSD', field: 0 }, { kind: 'thf', sym: 'hf_USDX', field: 0 }, { kind: 'sina', sym: 'DINIW', field: 1 } ] },
  { key: 'vix',    label: 'VIX',        range: [5, 95],   sources: [ { kind: 'thf', sym: 'usVIX', field: 3 }, { kind: 'sina', sym: 'gb_$vix', field: 1 } ] },
  { key: 'ust10',  label: '美债10Y',    range: [0, 12],   sources: [ { kind: 'thf', sym: 'usTNX', field: 3 }, { kind: 'thf', sym: 'hf_TNX' }, { kind: 'sina', sym: 'gb_$tnx', field: 1, div: 10 } ] },
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
    if (v != null && isFinite(v)) { m.ind[a.key] = { value: +v.toFixed(2), date: todayStr() }; ok++; detail.push(a.label + '✓'); diag.push({ label: a.label, ok: true, raw: String(+v.toFixed(2)) }); }
    else { fail++; detail.push(a.label + '✗'); diag.push({ label: a.label, ok: false, raw: attempts.join('  ‖  ') }); }
  }
  m.updatedAt = todayStr(); m.lastPull = { date: todayStr(), diag }; saveState();
  return { ok, fail, detail, diag };
}

// 确定性 regime 信号：读已填指标，输出对「你这种组合」的含义。无 AI、可复现、不臆造。
function macroSignals() {
  const g = (k) => { const v = STATE.macro && STATE.macro.ind && STATE.macro.ind[k]; const n = v ? num(v.value, NaN) : NaN; return isFinite(n) ? n : null; };
  const out = [];
  const y10 = g('ust10'), y2 = g('ust2');
  if (y10 != null && y2 != null) {
    const sp = y10 - y2;
    if (sp < 0) out.push(['red', `美债收益率曲线倒挂（10Y ${y10}% < 2Y ${y2}%，利差 ${sp.toFixed(2)}%）：历史上领先经济衰退 6–18 个月，风险资产中期需谨慎，优先保本与分散、备足现金。`]);
    else if (sp < 0.3) out.push(['amber', `美债利差偏平（10Y−2Y ${sp.toFixed(2)}%）：曲线接近倒挂，留意衰退前兆。`]);
  }
  const fed = g('fedUpper');
  if (fed != null) {
    if (fed >= 4.5) out.push(['amber', `美联储高利率（${fed}%）：无息黄金与高估值成长股承压、美元偏强；你的美元存款/短债有票息优势，但人民币计价的海外收益会被汇率侵蚀。`]);
    else if (fed <= 2) out.push(['blue', `低利率环境（${fed}%）：整体利好风险资产与黄金。`]);
  }
  const dxy = g('dxy');
  if (dxy != null) {
    if (dxy >= 105) out.push(['amber', `强美元（DXY ${dxy}）：压制黄金/新兴市场/大宗；你的美元资产受益，但人民币口径的海外收益被汇率吃掉——注意你的美元敞口。`]);
    else if (dxy <= 98) out.push(['blue', `弱美元（DXY ${dxy}）：利好黄金、新兴市场与非美资产。`]);
  }
  const vix = g('vix');
  if (vix != null) {
    if (vix >= 25) out.push(['red', `市场恐慌（VIX ${vix}）：波动放大，最容易情绪化操作——正是「铁律校验/止损防御」该发挥作用的时候，别追跌杀跌。`]);
    else if (vix <= 13) out.push(['amber', `波动极低（VIX ${vix}）：市场自满，警惕尾部风险与拥挤交易，别在低波中过度加杠杆/加仓。`]);
  }
  const cpiCN = g('cnCPI');
  if (cpiCN != null && cpiCN < 0.5) out.push(['amber', `中国 CPI 偏低（${cpiCN}%）：通缩压力、实际利率偏高，压制顺周期、利好债与红利；也倒逼政策进一步宽松。`]);
  const cpiUS = g('usCPI');
  if (cpiUS != null && cpiUS >= 3) out.push(['amber', `美国通胀仍偏高（CPI ${cpiUS}%）：美联储降息受限，短期压制估值与黄金。`]);
  const pmiCN = g('cnPMI');
  if (pmiCN != null) { if (pmiCN < 50) out.push(['amber', `中国制造业PMI ${pmiCN}<50（收缩）：顺周期/工业链需求偏弱。`]); else if (pmiCN >= 50.5) out.push(['blue', `中国制造业PMI ${pmiCN}>50（扩张）：利好周期与顺周期 A股。`]); }
  if (!out.length) out.push(['blue', '已填写的指标未触发明显信号；补全更多指标（尤其美债10Y/2Y、美联储利率、DXY、VIX）可得到更完整的组合含义解读。']);
  return out;
}

VIEWS.macro = function (app) {
  if (!STATE.macro || !STATE.macro.market) STATE.macro = { market: {}, ind: {}, updatedAt: null };
  const m = STATE.macro;
  app.appendChild(el(`
    <div class="view-head">
      <h2>市场指标 · 影响组合的关键变量</h2>
      <p>把影响你组合的宏观变量集中放这里随时参考。<strong>市场温度</strong>自动刷新；<strong>利率/通胀/债市</strong>按官方发布节奏你手动更新一次即可长期留存。下方<strong>信号解读</strong>是对「你这种人民币本位、A股+美股+黄金+美元资产」组合的确定性提示（不预测、不调用 AI）。</p>
    </div>
  `));

  // —— 信号解读（放最上面，一眼看规则）——
  const sigCard = el('<div class="card"><h3>' + icon('gauge') + ' 当前 regime 信号解读</h3></div>');
  macroSignals().forEach(([type, msg]) => sigCard.appendChild(el(`<div class="alert ${type}"><span class="icon">${type === 'red' ? icon('danger') : type === 'amber' ? icon('warn') : icon('info')}</span><div>${msg}</div></div>`)));
  sigCard.appendChild(el(`<p class="inline-note">信号由你填入的指标按固定规则触发，透明、可复现；填得越全越准。</p>`));
  app.appendChild(sigCard);

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
    m.updatedAt = todayStr(); saveState(); renderMarket();
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

  // —— 手动关键指标 ——
  MACRO_GROUPS.forEach(grp => {
    const card = el(`<div class="card" style="margin-top:16px"><h3>${escapeHtml(grp.title)}</h3></div>`);
    const scroll = el('<div class="table-scroll"></div>');
    const rows = grp.items.map(it => {
      const cur = (m.ind[it.key] || {});
      return `<tr>
        <td style="white-space:nowrap"><strong>${escapeHtml(it.name)}</strong>${it.unit ? ' <span style="color:var(--muted)">(' + it.unit + ')</span>' : ''}</td>
        <td class="num"><input data-mk="${it.key}" value="${cur.value != null ? escapeHtml(String(cur.value)) : ''}" placeholder="填入最新值" style="max-width:120px"/></td>
        <td class="num" style="color:var(--muted);font-size:12px">${cur.date ? escapeHtml(cur.date) : '—'}</td>
        <td style="font-size:12px;line-height:1.5"><strong>含义</strong>：${escapeHtml(it.meaning)}<br><strong style="color:var(--accent-ink)">对你组合</strong>：${escapeHtml(it.impact)}<br><strong style="color:var(--amber-ink)">关注</strong>：${escapeHtml(it.watch)} · <a href="${it.src}" target="_blank" rel="noopener" style="color:var(--accent-ink)">官方来源↗</a></td>
      </tr>`;
    }).join('');
    scroll.appendChild(el(`<table class="stack-mobile"><thead><tr><th>指标</th><th class="num">当前值</th><th class="num">更新日期</th><th>说明 / 对你的影响 / 关注信号</th></tr></thead><tbody>${rows}</tbody></table>`));
    card.appendChild(scroll);
    app.appendChild(card);
    scroll.querySelectorAll('[data-mk]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.mk, v = inp.value.trim();
      if (v === '') delete m.ind[k]; else m.ind[k] = { value: v, date: todayStr() };
      saveState(); render();   // 重绘以刷新信号解读
    });
  });

  app.appendChild(el(`<div class="card" style="margin-top:16px"><div class="alert blue"><span class="icon">${icon('info')}</span><div>
    <strong>数据从哪来？</strong>市场行情/美元指数/VIX/美债走<strong>新浪</strong>，中国 CPI/PMI/LPR 走<strong>东方财富</strong>，美国 CPI 走东财、美国失业率/联邦利率/核心PCE/PMI 走<strong>金十数据</strong>（均免 key、境内可达，akshare 同款）——点「自动拉取宏观」一键填入。<br><strong>为什么不让 AI 自动"分析"宏观？</strong>因为模型没有实时数据、有训练截止，直接问它"当前美联储/CPI"会自信地编造过时或错误数字——对认真投资是负资产。所以这里是<strong>拉真实数据 → 工具按固定规则解读</strong>，透明可复现。<br><span style="color:var(--muted)">注：自动拉取的部分符号需真机核对，失败项会显示明细并保留手填；把失败项发我，我按你 ECS 的实际返回校准。</span></div></div></div>`));
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

  G('globe', '数据 · 实时行情 · 云端存储', [
    ['自动更新涨跌', '<p>打开页面会自动刷新一次(15 分钟节流),也可在「投资组合」点<strong>一键刷新估值</strong>。覆盖:公募<strong>基金</strong>(天天基金实时估值)、<strong>A股/ETF/美股</strong>(腾讯/新浪行情)、<strong>黄金</strong>(国际现货金折人民币/克)。持仓表「今日」列显示当日涨跌。理财为银行自有产品无公开接口,保持手动维护 + 年化利息估算。</p>'],
    ['持仓联动', '<p>刷新后,各分析模块(凯利/分散/回撤/止损/铁律)都会用<strong>最新占比与浮盈亏</strong>联动计算,无需手动同步。份额模型:首次用「金额÷现价」反推份额,之后市值=份额×最新价,单次异常波动>40% 自动跳过以防坏行情污染。</p>'],
    ['云端存储与恢复', '<p>全部数据存到<strong>你自己的服务器</strong>(访问密码保护),换设备/清缓存自动恢复,本机浏览器仅作离线缓存。每天(含服务器定时 22:00/23:00/23:30)记录一份快照,「资产趋势」看走势;数据记错可在<strong>设置→数据管理→恢复到某一天</strong>一键回退。</p>'],
  ]);

  G('wallet', '投资组合 · 总览与 AI 诊断', [
    ['怎么用', '<p>已导入你 7/19 的资产汇总表。查看大类配置、按类别明细、币种敞口与全部持仓；点「生成 AI 组合诊断」由 DeepSeek 给出健康度评分与下一步建议。</p>'],
    ['计算逻辑', '<p>把每笔资产按汇率折算人民币后，归并为大类（权益/固收理财/现金/黄金），并按类别、币种分别汇总占比；美元敞口 = 所有 USD 计价资产折人民币之和。AI 诊断把这些占比 + 股票子组合的有效持仓数/因子集中度打包发给模型。</p>'],
    ['理论', '<p>基于<strong>资产配置理论</strong>：长期收益的绝大部分由大类配置（而非选股择时）决定；跨大类、跨币种分散能在不显著牺牲收益的前提下降低组合波动。</p>'],
    ['遵循的收益', '<p>一个均衡、不过度集中于单一大类或单一 beta 的组合，能在系统性回调中少受伤、在长期获得更稳的复利，避免“牛市财富逆向转移”。</p>'],
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
