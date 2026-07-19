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
};

// 底层驱动因子标签库（可自由扩展）
const FACTORS = [
  'AI算力', 'AI电力', 'AI应用', '机器人', '半导体',
  '创新药', '银行', '黄金', '能源', '消费',
  '新能源车', '军工', '地产', '其它'
];

// 趋势状态
const TRENDS = ['加速下跌', '下跌', '震荡', '向上', '加速上涨'];

const FACTOR_COLORS = [
  '#0a84ff', '#34c759', '#ff9f0a', '#ff375f', '#af52de',
  '#5ac8fa', '#ff9500', '#30d158', '#bf5af2', '#64d2ff',
  '#ffd60a', '#a2845e', '#66d4cf', '#8e8e93'
];

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
  return {
    settings: Object.assign({}, DEFAULT_SETTINGS),
    positions,
    assets,
    portfolio: { totalAssets: Math.round(SEED_TOTAL), asOfDate: SEED_DATE, fxRate: FX_DEFAULT },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
      s.positions = s.positions || [];
      s.assets = s.assets || [];
      s.portfolio = Object.assign({ totalAssets: Math.round(SEED_TOTAL) }, s.portfolio || {});
      return s;
    }
  } catch (e) { console.warn('状态读取失败', e); }
  return buildSeedState();   // 首次使用：自动载入 7/19 初始数据
}

let STATE = loadState();

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); }
  catch (e) { console.warn('状态保存失败', e); }
}

function uid() {
  return 'p' + Math.random().toString(36).slice(2, 9);
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

  // 凯利公式 f = (b×p − q) / b
  kelly(p, b) {
    if (!isFinite(b) || b <= 0) return 0;
    const q = 1 - p;
    return (b * p - q) / b;
  },

  // 有效持仓数：按因子分组后 1 / Σ(因子权重²)（逆 HHI）
  // 反映实际押了几个"独立赌注"
  effectiveBets(positions) {
    const total = positions.reduce((s, p) => s + (Number(p.weight) || 0), 0);
    if (total <= 0) return { effN: 0, factorWeights: {}, total: 0 };
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
let currentView = 'portfolio';

function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  (VIEWS[currentView] || VIEWS.dashboard)(app);
}

function switchView(v) {
  currentView = v;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === v));
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
  const totalWeight = positions.reduce((a, p) => a + num(p.weight), 0);
  const cash = Math.max(0, 100 - totalWeight);
  const { effN, factorWeights } = Calc.effectiveBets(positions);

  // 回撤预算使用
  const usedDrawdown = positions.reduce((a, p) =>
    a + Calc.drawdownContribution(num(p.weight), num(p.maxDrop)), 0);

  // 因子最大集中度
  let maxFactor = null, maxFactorW = 0;
  Object.keys(factorWeights).forEach(f => {
    if (factorWeights[f] > maxFactorW) { maxFactorW = factorWeights[f]; maxFactor = f; }
  });

  app.appendChild(el(`
    <div class="view-head">
      <h2>股票组合体检</h2>
      <p>对已录入的股票持仓做四层纪律快照；整体资产配置见「投资组合」。绿色达标，红色需处理。</p>
    </div>
  `));

  // 顶部四个统计
  const ddOk = usedDrawdown <= s.maxDrawdown;
  const concentrationOk = maxFactorW <= 0.6;
  app.appendChild(el(`
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat">
        <div class="label">${icon('coins')} 股票仓位</div>
        <div class="value">${fmtPct(totalWeight,1)}</div>
        <div class="sub">占总资产 · ${positions.length} 只</div>
      </div>
      <div class="stat">
        <div class="label">${icon('target')} 有效持仓数</div>
        <div class="value" style="color:${effN>=3?'var(--green-ink)':(effN>=2?'var(--amber-ink)':'var(--red-ink)')}">${effN?effN.toFixed(1):'—'}</div>
        <div class="sub">实际独立赌注数</div>
      </div>
      <div class="stat">
        <div class="label">${icon('pie')} 最大因子占比</div>
        <div class="value" style="color:${concentrationOk?'var(--green-ink)':'var(--red-ink)'}">${maxFactorW?fmtPct(maxFactorW*100,0):'—'}</div>
        <div class="sub">${maxFactor?maxFactor:'—'} · 上限 60%</div>
      </div>
      <div class="stat">
        <div class="label">${icon('gauge')} 回撤预算已用</div>
        <div class="value" style="color:${ddOk?'var(--green-ink)':'var(--red-ink)'}">${fmtPct(usedDrawdown,1)}</div>
        <div class="sub">阈值 ${s.maxDrawdown}% ${ddOk?'达标':'超支'}</div>
      </div>
    </div>
  `));

  // 健康度检查清单
  const checks = [];
  if (!ddOk) checks.push(['red', `回撤预算超支：股票预估最大回撤 ${fmtPct(usedDrawdown,1)} > 阈值 ${s.maxDrawdown}%`]);
  if (!concentrationOk && maxFactor) checks.push(['red', `因子「${maxFactor}」占 ${fmtPct(maxFactorW*100,0)} > 60%，过度集中于单一 beta`]);
  positions.forEach(p => {
    if (num(p.weight) > s.singleCap) checks.push(['amber', `${p.name||'未命名'} 占 ${fmtPct(num(p.weight),1)} 超单股上限 ${s.singleCap}%`]);
  });
  if (effN > 0 && effN < 2 && positions.length >= 3) checks.push(['amber', `持有 ${positions.length} 只，但有效持仓数仅 ${effN.toFixed(1)}——假分散`]);
  if (checks.length === 0 && positions.length > 0) checks.push(['green', '当前组合通过全部纪律检查']);

  const checklist = el('<div class="card"><h3>纪律体检</h3></div>');
  if (positions.length === 0) {
    checklist.appendChild(el(`<div class="empty"><div class="big">${icon('clipboard')}</div><p>还没有持仓。先到「持仓」页录入，或直接使用各计算器。</p></div>`));
  } else {
    checks.forEach(([type, msg]) => {
      checklist.appendChild(el(`<div class="alert ${type}"><span class="icon">${type==='red'?icon('danger'):type==='amber'?icon('warn'):icon('check')}</span><div>${msg}</div></div>`));
    });
  }
  app.appendChild(checklist);

  // 因子暴露饼图
  if (positions.length > 0) {
    const pieCard = el('<div class="card" style="margin-top:16px"><h3>因子暴露分布</h3><p class="hint">一眼看出组合真正押注的方向与集中度</p></div>');
    pieCard.appendChild(buildPie(factorWeights));
    app.appendChild(pieCard);
  }
};

/* SVG 饼图 + 图例 */
function buildPie(factorWeights) {
  const entries = Object.entries(factorWeights).sort((a, b) => b[1] - a[1]);
  const wrap = el('<div class="pie-wrap"></div>');
  const size = 180, r = 80, cx = 90, cy = 90;
  let acc = 0;
  const arcs = entries.map(([f, w], i) => {
    const start = acc * 2 * Math.PI;
    acc += w;
    const end = acc * 2 * Math.PI;
    const large = (end - start) > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.sin(start), y1 = cy - r * Math.cos(start);
    const x2 = cx + r * Math.sin(end), y2 = cy - r * Math.cos(end);
    const color = FACTOR_COLORS[i % FACTOR_COLORS.length];
    if (w >= 0.9999) { // 单一因子占满
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
    }
    return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${color}"/>`;
  }).join('');
  wrap.appendChild(el(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}<circle cx="${cx}" cy="${cy}" r="42" fill="var(--panel)"/></svg>`));

  const legend = el('<div class="legend"></div>');
  entries.forEach(([f, w], i) => {
    const color = FACTOR_COLORS[i % FACTOR_COLORS.length];
    const over = w > 0.6;
    legend.appendChild(el(`<div class="legend-item">
      <span class="legend-dot" style="background:${color}"></span>
      <span>${escapeHtml(f)}</span>
      <span style="color:${over?'var(--red)':'var(--muted)'};font-weight:600">${fmtPct(w*100,0)}${over?' '+icon('warn'):''}</span>
    </div>`));
  });
  wrap.appendChild(legend);
  return wrap;
}

/* -------------------------------------------------------------------------
   行情获取：股票代码 → 市场前缀 / 名称 + 最新价
   浏览器同源请求 /api/quote（由服务器 Nginx 代理新浪财经，规避 CORS 与 Referer）
   ------------------------------------------------------------------------- */
function detectMarket(code) {
  code = String(code || '').trim();
  if (/^6/.test(code)) return 'sh';                       // 沪市（600/601/603/605/688…）
  if (/^(4|8)/.test(code) || /^920/.test(code)) return 'bj'; // 北交所
  return 'sz';                                            // 深市（000/002/003/300…）
}

async function getQuoteText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('接口返回 ' + res.status);
  const buf = await res.arrayBuffer();
  try { return new TextDecoder('gbk').decode(buf); }   // 行情源为 GBK 编码
  catch (e) { return new TextDecoder('utf-8').decode(buf); }
}

// 腾讯：v_sz002518="51~科士达~002518~现价~昨收~今开~…";
function parseTencent(text) {
  const m = text.match(/"([^"]*)"/);
  if (!m || !m[1]) throw new Error('无数据');
  const p = m[1].split('~');
  const name = p[1];
  let price = parseFloat(p[3]);
  if (!(price > 0)) price = parseFloat(p[4]);         // 休市回退昨收
  if (!name || !isFinite(price)) throw new Error('解析失败');
  return { name, price };
}

// 新浪：var hq_str_sz002518="科士达,今开,昨收,现价,…";
function parseSina(text) {
  const m = text.match(/"([^"]*)"/);
  if (!m || !m[1]) throw new Error('无数据');
  const p = m[1].split(',');
  const name = p[0];
  let price = parseFloat(p[3]);
  if (!(price > 0)) price = parseFloat(p[2]);
  if (!name || !isFinite(price)) throw new Error('解析失败');
  return { name, price };
}

async function fetchQuote(rawCode) {
  const code = String(rawCode || '').trim();
  if (!/^\d{5,6}$/.test(code)) throw new Error('请输入 5–6 位数字代码');
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

/* =========================================================================
   视图：持仓管理 Positions
   ========================================================================= */
VIEWS.positions = function (app) {
  const totalAssets = num(STATE.portfolio.totalAssets, 0);
  app.appendChild(el(`
    <div class="view-head">
      <h2>持仓管理</h2>
      <p>录入的持仓将驱动「组合分散」「回撤控制」「铁律校验」等模块。数据仅存本地。</p>
    </div>
  `));

  // 添加表单
  const form = el(`<div class="card"><h3>添加 / 编辑持仓</h3></div>`);
  form.appendChild(el(`
    <p class="hint">输入股票代码可自动获取名称与最新价；填「持股数量」后，占比按
      <code class="formula">持股市值 ÷ 总资产</code> 自动计算，浮盈亏按成本价与现价自动算。
      当前总资产 <strong>${fmtMoney(totalAssets)}</strong>（在「设置」修改）。</p>
    <div class="grid grid-3">
      <div class="field"><label>股票代码（A股）</label>
        <div class="row" style="gap:6px">
          <input id="np-code" placeholder="如 002518" style="flex:1"/>
          <button class="btn secondary" id="np-fetch" style="flex:0 0 auto">获取</button>
        </div>
        <p class="inline-note" id="np-code-note">自动识别沪/深/京</p>
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
    <button class="btn" id="np-add">＋ 添加持仓</button>
    <input type="hidden" id="np-edit-id"/>
    <input type="hidden" id="np-pnl"/>
  `));
  app.appendChild(form);

  const $ = sel => form.querySelector(sel);

  // 实时计算：市值 / 占比 / 浮盈亏
  function recalc() {
    const shares = num($('#np-shares').value);
    const price = num($('#np-price').value);
    const cost = num($('#np-cost').value);
    const value = (shares > 0 && price > 0) ? shares * price : 0;
    let weight = null, pnl = null;
    if (value > 0 && totalAssets > 0) {
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
  ['#np-shares', '#np-price', '#np-cost', '#np-weight'].forEach(s => $(s).addEventListener('input', recalc));

  // 「获取」：按代码拉取名称与最新价
  $('#np-fetch').onclick = async () => {
    const note = $('#np-code-note');
    const code = $('#np-code').value.trim();
    note.textContent = '获取中…'; note.style.color = 'var(--muted)';
    try {
      const q = await fetchQuote(code);
      if (!$('#np-name').value.trim()) $('#np-name').value = q.name;
      $('#np-price').value = q.price;
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
    const shares = num($('#np-shares').value);
    const price = num($('#np-price').value);
    const cost = num($('#np-cost').value);
    // 优先按 数量×现价÷总资产 算占比；无数量时用手填占比
    let weight = (shares > 0 && price > 0 && totalAssets > 0)
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
          <th>趋势</th><th class="num">最大跌幅</th><th class="num">回撤贡献</th><th></th>
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
    listCard.appendChild(el(`<p class="inline-note">现金池：${fmtPct(Math.max(0,100-totalWeight),1)}</p>`));

    scroll.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      STATE.positions = STATE.positions.filter(p => p.id !== b.dataset.del);
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
      recalc();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  app.appendChild(listCard);
};

/* =========================================================================
   模块 1 — 凯利公式计算器（单标的下注）
   ========================================================================= */
VIEWS.kelly = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>① 凯利定注 · 单标的下注</h2>
      <p>回答"这一只该下多少注"。EV 为负直接淘汰，默认执行值为四分之一凯利。</p>
    </div>
  `));

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
    const f = Calc.kelly(p, b);
    const s = STATE.settings;

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

    const tiers = [
      { label: '满凯利', val: f, rec: false },
      { label: '半凯利', val: f * 0.5, rec: false },
      { label: '¼ 凯利', val: f * 0.25, rec: true },
    ];

    resBox.appendChild(el(`
      <div class="result-box">
        <div class="metric-row"><span class="k">期望值 EV = p×涨幅 − q×跌幅</span><span class="v" style="color:var(--green)">+${ev.toFixed(2)}%</span></div>
        <div class="metric-row"><span class="k">净赔率 b = 涨幅 ÷ 跌幅</span><span class="v">${b.toFixed(2)}</span></div>
        <div class="metric-row"><span class="k">败率 q</span><span class="v">${((1-p)*100).toFixed(0)}%</span></div>
        <div class="metric-row"><span class="k">满凯利 f = (b×p − q)/b</span><span class="v">${(f*100).toFixed(1)}%</span></div>
      </div>
    `));

    if (f <= 0) {
      resBox.appendChild(el(`<div class="alert red"><span class="icon">${icon('danger')}</span><div>满凯利 f ≤ 0：期望值虽非负，但赔率不足以支撑下注，建议不参与或减仓。</div></div>`));
      return;
    }

    const tierEl = el('<div class="kelly-tiers"></div>');
    tiers.forEach(t => {
      tierEl.appendChild(el(`
        <div class="tier ${t.rec?'recommended':''}">
          <div class="label">${t.label}</div>
          <div class="val">${(t.val*100).toFixed(1)}%</div>
          ${t.rec ? ('<div class="tag">' + icon('star') + ' 默认执行值</div>') : ''}
        </div>`));
    });
    resBox.appendChild(tierEl);

    // 高胜率警告
    if (pPct > 60) {
      resBox.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>
        你填入胜率 ${pPct}% > 60%。散户最常见错误是高估胜率——请回看你的 ${bears.length} 条看空理由，确认这个概率经得起推敲。
      </div></div>`));
    }

    // 与单股上限对照
    const quarterPct = f * 0.25 * 100;
    if (quarterPct > s.singleCap) {
      resBox.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>
        ¼ 凯利目标 ${quarterPct.toFixed(1)}% 已超过你的单股上限 ${s.singleCap}%。即便凯利允许，也建议以单股上限为准（分散优先）。
      </div></div>`));
    } else {
      resBox.appendChild(el(`<div class="alert green"><span class="icon">${icon('check')}</span><div>
        推荐执行 <strong>¼ 凯利 = ${quarterPct.toFixed(1)}%</strong>，在单股上限 ${s.singleCap}% 之内。1/4 凯利用于降低参数误差，实战更稳。
      </div></div>`));
    }
  };
};

/* =========================================================================
   模块 2 — 相关性 / 有效持仓数（组合分散）
   ========================================================================= */
VIEWS.diversify = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>② 组合分散 · 有效持仓数</h2>
      <p>戳破"假分散"——持有多只股票，但实际只押了少数几个独立赌注。</p>
    </div>
  `));

  if (STATE.positions.length === 0) {
    app.appendChild(el(`<div class="card"><div class="empty"><div class="big">${icon('pie')}</div>
      <p>此模块基于你的持仓计算。请先到「持仓」页录入标的与因子标签。</p>
      <button class="btn" id="goto-pos" style="margin-top:12px">前往录入持仓</button>
    </div></div>`));
    app.querySelector('#goto-pos').onclick = () => switchView('positions');
    return;
  }

  const { effN, factorWeights, factorSum } = Calc.effectiveBets(STATE.positions);
  const nHoldings = STATE.positions.length;

  const card = el('<div class="card"></div>');
  card.appendChild(el(`
    <div class="stat-grid" style="grid-template-columns:1fr 1fr">
      <div class="stat">
        <div class="label">名义持仓数</div>
        <div class="value">${nHoldings}</div>
        <div class="sub">你以为分散到几只</div>
      </div>
      <div class="stat">
        <div class="label">有效持仓数 (独立赌注)</div>
        <div class="value" style="color:${effN>=3?'var(--green)':(effN>=2?'var(--amber)':'var(--red)')}">${effN.toFixed(1)}</div>
        <div class="sub">实际押了几个独立方向</div>
      </div>
    </div>
  `));

  // 核心提示语
  if (effN < nHoldings * 0.7) {
    card.appendChild(el(`<div class="alert red" style="margin-top:16px"><span class="icon">${icon('target')}</span><div>
      你持有 <strong>${nHoldings}</strong> 只标的，但有效持仓数仅 <strong>${effN.toFixed(1)}</strong>——你实际只押了约 ${Math.round(effN)} 个独立方向。这是典型的假分散。
    </div></div>`));
  } else {
    card.appendChild(el(`<div class="alert green" style="margin-top:16px"><span class="icon">${icon('check')}</span><div>
      有效持仓数 ${effN.toFixed(1)} 接近名义持仓数 ${nHoldings}，分散度较真实。
    </div></div>`));
  }
  app.appendChild(card);

  // 因子暴露
  const pieCard = el('<div class="card" style="margin-top:16px"><h3>因子暴露饼图</h3><p class="hint">各底层因子占组合的比例</p></div>');
  pieCard.appendChild(buildPie(factorWeights));

  // 60% 集中度红色警告
  const overFactors = Object.entries(factorWeights).filter(([f, w]) => w > 0.6);
  overFactors.forEach(([f, w]) => {
    pieCard.appendChild(el(`<div class="alert red" style="margin-top:14px"><span class="icon">${icon('danger')}</span><div>
      因子「${escapeHtml(f)}」占组合 ${fmtPct(w*100,0)} > 60%——过度集中于单一 beta，系统性回调时将同步下跌。
    </div></div>`));
  });
  app.appendChild(pieCard);

  // 因子合并明细
  const detail = el('<div class="card" style="margin-top:16px"><h3>因子分组明细</h3><p class="hint">同因子仓位合并 → 得出实际独立赌注</p></div>');
  const total = STATE.positions.reduce((a, p) => a + num(p.weight), 0);
  const scroll = el('<div class="table-scroll"></div>');
  const factorGroups = {};
  STATE.positions.forEach(p => {
    const f = p.factor || '其它';
    (factorGroups[f] = factorGroups[f] || []).push(p);
  });
  const rows = Object.entries(factorGroups)
    .sort((a, b) => (factorSum[b[0]] || 0) - (factorSum[a[0]] || 0))
    .map(([f, ps]) => {
      const sum = ps.reduce((a, p) => a + num(p.weight), 0);
      const share = total > 0 ? sum / total : 0;
      return `<tr>
        <td><span class="tag-chip">${escapeHtml(f)}</span></td>
        <td>${ps.map(p => escapeHtml(p.name)).join('、')}</td>
        <td class="num">${fmtPct(sum,1)}</td>
        <td class="num" style="color:${share>0.6?'var(--red)':'inherit'}">${fmtPct(share*100,0)}</td>
      </tr>`;
    }).join('');
  scroll.appendChild(el(`<table><thead><tr>
    <th>因子</th><th>合并标的</th><th class="num">合计占比</th><th class="num">占组合</th>
  </tr></thead><tbody>${rows}</tbody></table>`));
  detail.appendChild(scroll);
  app.appendChild(detail);
};

/* =========================================================================
   模块 3 — 最大回撤约束（总风险控制）
   ========================================================================= */
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
  const remaining = threshold - used;

  const budgetCard = el('<div class="card" style="margin-top:16px"><h3>组合风险预算</h3></div>');
  const pct = Math.min(100, (used / threshold) * 100);
  budgetCard.appendChild(el(`
    <div class="metric-row"><span class="k">回撤阈值（预算总额）</span><span class="v">${fmtPct(threshold,1)}</span></div>
    <div class="metric-row"><span class="k">已用（Σ 各股回撤贡献）</span><span class="v" style="color:${used>threshold?'var(--red)':'var(--green)'}">${fmtPct(used,2)}</span></div>
    <div class="metric-row"><span class="k">剩余</span><span class="v" style="color:${remaining<0?'var(--red)':'inherit'}">${fmtPct(remaining,2)}</span></div>
    <div class="progress" style="margin-top:12px"><div class="fill" style="width:${pct}%;background:${used>threshold?'var(--red)':(pct>80?'var(--amber)':'var(--green)')}"></div></div>
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
  const rows = positions.map(p => {
    const w = num(p.weight), md = num(p.maxDrop);
    const contrib = Calc.drawdownContribution(w, md);
    const cap = md > 0 ? (threshold / md) * 100 : Infinity; // 单股独占预算时的上限占比
    const over = w > cap;
    return `<tr>
      <td>${escapeHtml(p.name)}</td>
      <td class="num">${fmtPct(w,1)}</td>
      <td class="num">${fmtPct(md,0)}</td>
      <td class="num">${fmtPct(contrib,2)}</td>
      <td class="num">${isFinite(cap)?fmtPct(cap,1):'—'}</td>
      <td>${over
        ? `<span class="pill red">超预算</span>`
        : `<span class="pill green">预算内</span>`}</td>
    </tr>`;
  }).join('');
  scroll.appendChild(el(`<table><thead><tr>
    <th>名称</th><th class="num">当前占比</th><th class="num">最大跌幅</th>
    <th class="num">回撤贡献</th><th class="num">理论上限*</th><th>判定</th>
  </tr></thead><tbody>${rows}</tbody></table>`));
  detail.appendChild(scroll);
  detail.appendChild(el(`<p class="inline-note">*理论上限 = 回撤阈值 ÷ 该股最大跌幅（即该股独占全部回撤预算时的占比）。多股共享预算时应更保守。</p>`));

  // 示例句式输出
  const worst = positions.slice().sort((a,b)=>Calc.drawdownContribution(num(b.weight),num(b.maxDrop))-Calc.drawdownContribution(num(a.weight),num(a.maxDrop)))[0];
  if (worst) {
    const w = num(worst.weight), md = num(worst.maxDrop);
    const contrib = Calc.drawdownContribution(w, md);
    const cap = md > 0 ? (threshold / md) * 100 : Infinity;
    const over = w > cap;
    detail.appendChild(el(`<div class="alert ${over?'red':'green'}" style="margin-top:12px"><span class="icon">${over?icon('xmark'):icon('check')}</span><div>
      ${escapeHtml(worst.name)}当前占 ${fmtPct(w,1)}，最大跌幅 ${fmtPct(md,0)}，对组合的回撤贡献 ${fmtPct(contrib,2)}，
      ${over?`超出预算，建议降至 ${fmtPct(cap,1)} 以内。`:`在预算内。`}
    </div></div>`));
  }
  app.appendChild(detail);
};

/* =========================================================================
   模块 4 — 固定分数止损（本金防御）
   ========================================================================= */
VIEWS.stoploss = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>④ 止损防御 · 固定分数止损</h2>
      <p>由"单笔最多亏多少本金"反推最大可买仓位。先定止损，再定仓位。</p>
    </div>
  `));

  const s = STATE.settings;
  const card = el('<div class="card"></div>');
  card.appendChild(el(`
    <div class="grid grid-2">
      <div class="field"><label>总资产</label>
        <input id="sl-total" type="number" step="1000" value="${STATE.portfolio.totalAssets||1000000}"/></div>
      <div class="field"><label>单笔可接受最大亏损（占总资产）</label>
        <div class="suffix-input"><input id="sl-risk" type="number" step="0.5" value="${s.perTradeRisk}"/><span>%</span></div></div>
    </div>
    <div class="grid grid-2">
      <div class="field"><label>买入价</label><input id="sl-buy" type="number" step="0.01" placeholder="20.00"/></div>
      <div class="field"><label>计划止损价</label><input id="sl-stop" type="number" step="0.01" placeholder="18.00"/></div>
    </div>
    <button class="btn" id="sl-calc">计算最大可买仓位</button>
    <div id="sl-result"></div>
  `));
  app.appendChild(card);

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
    const r = Calc.fixedFractionalSize(total, risk, buy, stop);
    const capValue = total * (s.singleCap / 100);
    const overCap = r.positionValue > capValue;
    box.appendChild(el(`
      <div class="result-box">
        <div class="metric-row"><span class="k">止损幅度 = (买入−止损)/买入</span><span class="v">${fmtPct(r.stopPct,2)}</span></div>
        <div class="metric-row"><span class="k">单笔风险金额 = 总资产×${risk}%</span><span class="v">${fmtMoney(r.riskAmount)}</span></div>
        <div class="metric-row"><span class="k">最大可买仓位金额</span><span class="v" style="color:var(--accent)">${fmtMoney(r.positionValue)}</span></div>
        <div class="metric-row"><span class="k">对应股数（约）</span><span class="v">${Math.floor(r.shares).toLocaleString()}</span></div>
        <div class="metric-row"><span class="k">占总资产</span><span class="v">${fmtPct(r.positionValue/total*100,1)}</span></div>
      </div>
      <div class="alert blue"><span class="icon">${icon('pin')}</span><div>
        若买入 ${fmtMoney(r.positionValue)} 并在 ${buy} 触及止损价 ${stop} 时离场，亏损恰为总资产的 ${risk}%（${fmtMoney(r.riskAmount)}）。
      </div></div>
    `));
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
      <h2>⑤ 铁律校验 · 操作拦截引擎</h2>
      <p>任何"加仓"操作前跑一遍校验。触发任一条即弹出必须二次确认才能越过的红色拦截。</p>
    </div>
  `));

  const s = STATE.settings;
  const positions = STATE.positions;
  const totalWeight = positions.reduce((a, p) => a + num(p.weight), 0);
  const options = positions.map(p => `<option value="${p.id}">${escapeHtml(p.name)}（${escapeHtml(p.factor)}，占 ${fmtPct(num(p.weight),1)}）</option>`).join('');

  const card = el('<div class="card"><h3>拟加仓操作</h3></div>');
  card.appendChild(el(`
    <div class="field"><label>选择标的</label>
      <select id="r-pos">
        <option value="">— 未在持仓列表？可手动输入 —</option>
        ${options}
      </select>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>当前浮盈亏 %</label><input id="r-pnl" type="number" step="0.1" placeholder="-8"/></div>
      <div class="field"><label>当前趋势</label>
        <select id="r-trend">${TRENDS.map((t,i)=>`<option ${i===2?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>当前占比 %</label><input id="r-cur" type="number" step="0.1" placeholder="8"/></div>
    </div>
    <div class="grid grid-3">
      <div class="field"><label>本次加仓占比 %</label><input id="r-add" type="number" step="0.1" placeholder="3"/></div>
      <div class="field"><label>本次加仓金额（可选）</label><input id="r-addamt" type="number" step="100" placeholder="用于正金字塔校验"/></div>
      <div class="field"><label>上次加仓金额（可选）</label><input id="r-lastamt" type="number" step="100" placeholder="上一批买入额"/></div>
    </div>
    <div class="field"><label>该标的因子（用于集中度校验）</label>
      <select id="r-factor">${FACTORS.map(f=>`<option>${f}</option>`).join('')}</select></div>
    <button class="btn danger" id="r-check">${icon('search')} 运行铁律校验</button>
    <div id="r-result"></div>
  `));
  app.appendChild(card);

  // 选中已有持仓时自动填充
  card.querySelector('#r-pos').onchange = (e) => {
    const p = positions.find(x => x.id === e.target.value);
    if (!p) return;
    card.querySelector('#r-pnl').value = p.pnl;
    card.querySelector('#r-trend').value = p.trend;
    card.querySelector('#r-cur').value = p.weight;
    card.querySelector('#r-factor').value = p.factor;
  };

  // 铁律表
  const rulesRef = el(`<div class="card" style="margin-top:16px"><h3>七条铁律</h3>
    <div class="table-scroll"><table><thead><tr><th>铁律</th><th>触发条件</th></tr></thead>
    <tbody>
      <tr><td>禁止亏损加仓</td><td>浮亏 + 加仓</td></tr>
      <tr><td>禁止下跌趋势加仓</td><td>趋势=下跌/加速下跌 + 加仓</td></tr>
      <tr><td>单股仓位上限</td><td>加仓后 > 上限（默认 ${s.singleCap}%）</td></tr>
      <tr><td>正金字塔校验</td><td>高位加仓金额 ≥ 上次</td></tr>
      <tr><td>因子集中度</td><td>加仓后某因子 > 60%</td></tr>
      <tr><td>现金蓄水池</td><td>总仓位 > ${100 - s.cashFloor}%（现金 < ${s.cashFloor}%）</td></tr>
      <tr><td>胜率诚实度</td><td>胜率 > 60% 无充分理由</td></tr>
    </tbody></table></div></div>`);
  app.appendChild(rulesRef);

  card.querySelector('#r-check').onclick = async () => {
    const box = card.querySelector('#r-result');
    box.innerHTML = '';
    const pnl = num(card.querySelector('#r-pnl').value);
    const trend = card.querySelector('#r-trend').value;
    const cur = num(card.querySelector('#r-cur').value);
    const add = num(card.querySelector('#r-add').value);
    const addAmt = num(card.querySelector('#r-addamt').value);
    const lastAmt = num(card.querySelector('#r-lastamt').value);
    const factor = card.querySelector('#r-factor').value;
    const selId = card.querySelector('#r-pos').value;

    if (add <= 0) {
      box.appendChild(el(`<div class="alert amber"><span class="icon">${icon('warn')}</span><div>请填写本次加仓占比（> 0）。</div></div>`));
      return;
    }

    const violations = [];

    // 铁律1 禁止亏损加仓
    if (pnl < 0) violations.push('禁止亏损加仓：当前浮亏 ' + fmtPct(pnl,1) + ' 仍加仓，是倒金字塔陷阱起点，禁止。');
    // 铁律2 禁止下跌趋势加仓
    if (trend === '下跌' || trend === '加速下跌') violations.push('禁止下跌趋势加仓：趋势为「' + trend + '」，加仓＝接刀，等企稳。');
    // 铁律3 单股仓位上限
    const after = cur + add;
    if (after > s.singleCap) violations.push('单股仓位上限：加仓后占比 ' + fmtPct(after,1) + ' > 上限 ' + s.singleCap + '%，违反分散原则。');
    // 铁律4 正金字塔校验
    if (addAmt > 0 && lastAmt > 0 && addAmt >= lastAmt) violations.push('正金字塔校验：本次加仓金额 ' + fmtMoney(addAmt) + ' ≥ 上次 ' + fmtMoney(lastAmt) + '，高位应递减加仓，你正头重脚轻。');
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
      if (fw > 0.6) violations.push('因子集中度：加仓后因子「' + factor + '」占 ' + fmtPct(fw*100,0) + ' > 60%，该操作加重单一 beta 集中度。');
    }
    // 铁律6 现金蓄水池
    {
      // 加仓后总仓位 = 现有总仓位 + 本次加仓（若选中已有持仓，cur 已计入 totalWeight，故只加 add）
      const afterTotal = totalWeight + add;
      if (afterTotal > (100 - s.cashFloor)) violations.push('现金蓄水池：加仓后总仓位 ' + fmtPct(afterTotal,1) + ' 使现金 < ' + s.cashFloor + '%，丧失回调加仓能力。');
    }

    if (violations.length === 0) {
      box.appendChild(el(`<div class="alert green" style="margin-top:14px"><span class="icon">${icon('check')}</span><div>
        <strong>通过全部铁律校验</strong>，本次加仓未触发拦截。仍请对照客观依据后再操作。
      </div></div>`));
      return;
    }

    // 有违规：先展示，再弹阻塞式二次确认
    box.appendChild(el(`<div class="alert red" style="margin-top:14px"><span class="icon">${icon('danger')}</span><div>
      <strong>触发 ${violations.length} 条铁律，操作被拦截：</strong><br>${violations.map(v=>'· '+v).join('<br>')}
    </div></div>`));

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
  app.appendChild(el(`
    <div class="view-head">
      <h2>⑥ 加仓计划器 + 利润隔离</h2>
      <p>正金字塔分批买入（越低买越多）＋ 橄榄型仓位模板 ＋ 浮盈隔离提醒。</p>
    </div>
  `));

  const s = STATE.settings;

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
    <p class="hint">输入价位区间与总投入，系统生成"越低买越多、越高买越少"的分批金额</p></div>`);
  pyramid.appendChild(el(`
    <div class="grid grid-3">
      <div class="field"><label>最低价（买最多）</label><input id="py-low" type="number" step="0.01" placeholder="18"/></div>
      <div class="field"><label>最高价（买最少）</label><input id="py-high" type="number" step="0.01" placeholder="24"/></div>
      <div class="field"><label>分几批</label><input id="py-n" type="number" step="1" value="4"/></div>
    </div>
    <div class="field"><label>本轮计划总投入金额</label><input id="py-total" type="number" step="1000" placeholder="100000"/></div>
    <button class="btn" id="py-calc">生成分批计划</button>
    <div id="py-result"></div>
  `));
  app.appendChild(pyramid);

  pyramid.querySelector('#py-calc').onclick = () => {
    const box = pyramid.querySelector('#py-result');
    box.innerHTML = '';
    const low = num(pyramid.querySelector('#py-low').value);
    const high = num(pyramid.querySelector('#py-high').value);
    const n = Math.max(2, Math.floor(num(pyramid.querySelector('#py-n').value, 4)));
    const total = num(pyramid.querySelector('#py-total').value);
    if (low <= 0 || high <= low || total <= 0) {
      box.appendChild(el(`<div class="alert red"><span class="icon">${icon('danger')}</span><div>请确保最高价 > 最低价，且金额为正。</div></div>`));
      return;
    }
    // 权重：越低价权重越大。用线性递减权重 n, n-1, ..., 1 分配到从低到高的价位
    const prices = [];
    for (let i = 0; i < n; i++) prices.push(low + (high - low) * i / (n - 1));
    const weights = prices.map((_, i) => n - i); // i=0(最低价)权重最大
    const wsum = weights.reduce((a, b) => a + b, 0);
    const rows = prices.map((price, i) => {
      const amt = total * weights[i] / wsum;
      const shares = amt / price;
      return `<tr>
        <td>第 ${i+1} 批</td>
        <td class="num">${price.toFixed(2)}</td>
        <td class="num">${fmtMoney(amt)}</td>
        <td class="num">${fmtPct(weights[i]/wsum*100,0)}</td>
        <td class="num">${Math.floor(shares).toLocaleString()}</td>
      </tr>`;
    }).join('');
    box.appendChild(el(`<div class="table-scroll" style="margin-top:14px"><table>
      <thead><tr><th>批次</th><th class="num">价位</th><th class="num">买入金额</th><th class="num">占比</th><th class="num">股数</th></tr></thead>
      <tbody>${rows}<tr class="total-row"><td>合计</td><td></td><td class="num">${fmtMoney(total)}</td><td class="num">100%</td><td></td></tr></tbody>
    </table></div>`));
    box.appendChild(el(`<div class="alert blue" style="margin-top:12px"><span class="icon">${icon('ruler')}</span><div>
      正金字塔：越跌越买、越涨越少，摊薄成本且避免高位头重脚轻。切勿反向操作（追高加仓）。
    </div></div>`));
  };

  /* --- 利润隔离 --- */
  const lock = el(`<div class="card" style="margin-top:16px"><h3>利润隔离</h3>
    <p class="hint">浮盈超阈值（默认 +${s.profitLockThreshold}%）时，提醒转出部分浮盈至安全资产</p></div>`);
  app.appendChild(lock);

  const gainers = STATE.positions.filter(p => num(p.pnl) >= s.profitLockThreshold);
  if (STATE.positions.length === 0) {
    lock.appendChild(el(`<div class="empty"><p>先录入持仓后，这里会自动列出达到隔离阈值的标的。</p></div>`));
  } else if (gainers.length === 0) {
    lock.appendChild(el(`<div class="alert blue"><span class="icon">${icon('moon')}</span><div>当前没有浮盈达到 +${s.profitLockThreshold}% 的标的，无需隔离。</div></div>`));
  } else {
    const totalAssets = STATE.portfolio.totalAssets || 1000000;
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
    lock.appendChild(el(`<p class="inline-note">*浮盈金额为按当前占比与浮盈率的估算，用于给出隔离参考。建议将浮盈的一半转入货基/债/黄金等安全资产。</p>`));
    scroll.querySelectorAll('[data-lock]').forEach(b => b.onclick = () => {
      const p = STATE.positions.find(x => x.id === b.dataset.lock);
      if (!p) return;
      const amt = prompt('记录本次隔离到安全资产的金额：', b.dataset.amt);
      if (amt == null) return;
      p.lockedProfit = num(p.lockedProfit) + num(amt);
      saveState(); render();
    });
  }
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
      <div class="field"><label>总资产</label>
        <input id="st-total" type="number" step="1000" value="${STATE.portfolio.totalAssets||1000000}"/></div>
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
    STATE.portfolio.totalAssets = num(card.querySelector('#st-total').value, 1000000);
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
  const dataCard = el('<div class="card" style="margin-top:16px"><h3>数据管理</h3><p class="hint">数据仅保存在本机浏览器（localStorage），不上传</p></div>');
  dataCard.appendChild(el(`
    <div class="row" style="flex-wrap:wrap">
      <button class="btn secondary" id="dm-export" style="flex:0 0 auto">${icon('download')} 导出数据</button>
      <button class="btn secondary" id="dm-import" style="flex:0 0 auto">${icon('upload')} 导入数据</button>
      <button class="btn secondary" id="dm-seed" style="flex:0 0 auto">${icon('refresh')} 载入 7/19 初始数据</button>
      <button class="btn danger" id="dm-clear" style="flex:0 0 auto">${icon('trash')} 清空全部数据</button>
    </div>
    <input type="file" id="dm-file" accept="application/json" style="display:none"/>
  `));
  app.appendChild(dataCard);
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
        saveState(); alert('导入成功'); render();
      } catch (err) { alert('导入失败：文件格式不正确'); }
    };
    reader.readAsText(file);
  };
  dataCard.querySelector('#dm-clear').onclick = () => {
    if (!confirm('确定清空全部持仓与设置？此操作不可撤销。')) return;
    localStorage.removeItem(STORAGE_KEY);
    STATE = loadState();
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

async function aiReview(summaryText, box, btn) {
  const sys = '你是一位严谨、以风险控制为先的个人投资组合顾问。基于用户的真实资产配置数据，用中文给出：'
    + '（1）组合健康度评分（0–100）与一句话总体结论；'
    + '（2）三到四条结构性风险（如大类失衡、单一因子/beta集中、币种敞口、回撤敞口、现金是否充足等）；'
    + '（3）下一步 3–5 条具体、可执行的调整建议，尽量落到大类或标的层面。'
    + '严格要求：不预测涨跌、不荐股、不承诺收益，只聚焦仓位结构与风险纪律。用简洁的小标题分段，语言精炼。';
  btn.disabled = true;
  const oldHtml = btn.innerHTML;
  btn.innerHTML = icon('refresh', 'spin') + ' 正在分析…';
  box.innerHTML = '<div class="inline-note">正在请求 DeepSeek 分析你的组合，请稍候（约 10–30 秒）…</div>';
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        stream: false,
        temperature: 0.5,
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
    const content = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('返回内容为空');
    box.innerHTML = `<div class="alert green"><span class="icon">${icon('sparkles')}</span>
      <div><strong>DeepSeek 组合点评</strong>（AI 生成，仅供参考，非投资建议）</div></div>
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
  allocCard.appendChild(buildPie(normalize(byBig)));
  app.appendChild(allocCard);

  // 明细表：按类别（按大类排序：股票→基金→理财→黄金→现金）
  const catCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('list')} 按类别明细</h3></div>`);
  const catRows = Object.entries(byCat)
    .sort((a, b) => classRank(a[0]) - classRank(b[0]) || b[1] - a[1])
    .map(([c, v]) => `<tr><td>${escapeHtml(c)}</td><td class="num">${fmtMoney(v)}</td><td class="num">${fmtPct(pct(v),1)}</td></tr>`).join('');
  catCard.appendChild(el(`<div class="table-scroll"><table>
    <thead><tr><th>类别</th><th class="num">金额</th><th class="num">占比</th></tr></thead>
    <tbody>${catRows}
      <tr class="total-row"><td>人民币 · 美元敞口</td><td class="num">${fmtMoney(byCur['CNY']||0)} · ${fmtMoney(usdCny)}</td>
      <td class="num">${fmtPct(pct(byCur['CNY']||0),0)} · ${fmtPct(pct(usdCny),0)}</td></tr>
    </tbody></table></div>`));
  app.appendChild(catCard);

  // 持仓明细（按大类排序；收益列：理财/存款年化利息，其它浮盈亏；可增删改）
  const holdCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('coins')} 全部持仓（${assets.length}）</h3>
    <p class="hint">组合会随时间变化——可随时在下方「管理资产」增删改。按大类排序：股票 → 基金 → 理财 → 黄金 → 现金。</p></div>`);
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
    return `<tr>
      <td>${escapeHtml(a.name)}${a.code?`<br><span class="inline-note">${escapeHtml(a.code)}</span>`:''}</td>
      <td><span class="tag-chip">${escapeHtml(a.category)}</span></td>
      <td>${a.currency}</td>
      <td class="num">${fmtMoney(v)}</td>
      <td class="num">${fmtPct(pct(v),1)}</td>
      <td class="num">${incCell}</td>
      <td class="num"><button class="btn secondary small" data-aedit="${a.id}">${icon('pencil')}</button>
        <button class="btn danger small" data-adel="${a.id}">${icon('trash')}</button></td>
    </tr>`;
  }).join('');
  const holdScroll = el(`<div class="table-scroll"><table>
    <thead><tr><th>名称</th><th>类别</th><th>币种</th><th class="num">折合人民币</th><th class="num">占比</th><th class="num">收益/利息</th><th></th></tr></thead>
    <tbody>${hrows}</tbody></table></div>`);
  holdCard.appendChild(holdScroll);
  holdCard.appendChild(el(`<p class="inline-note">收益列：理财/存款显示<strong>年化利息</strong>（美元按 3%、人民币按实际利率，美元金额按当日中间价 ${fx.toFixed(4)} 折人民币）；股票/基金/黄金显示<strong>浮盈亏</strong>。</p>`));
  app.appendChild(holdCard);

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
      if (i >= 0) STATE.assets[i] = asset;
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

  // AI 深度点评
  const aiCard = el(`<div class="card" style="margin-top:16px"><h3>${icon('sparkles')} AI 深度点评</h3>
    <p class="hint">由 DeepSeek 依据你的真实配置给出健康度评分与下一步建议。数据经服务器代理调用，密钥不出前端。</p></div>`);
  aiCard.appendChild(el(`<button class="btn" id="pf-ai">${icon('sparkles')} 生成 AI 组合诊断</button><div id="pf-ai-out" style="margin-top:12px"></div>`));
  app.appendChild(aiCard);

  // 组装给 AI 的组合摘要（含工具算出的量化指标）
  const eff = Calc.effectiveBets(STATE.positions || []);
  const bigLines = Object.entries(byBig).map(([k, v]) => `${k} ${fmtPct(pct(v),1)}（${fmtMoney(v)}）`).join('；');
  const catLines = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k, v]) => `${k} ${fmtPct(pct(v),1)}`).join('、');
  const topHold = assets.slice().sort((a,b)=>cnyOf(b)-cnyOf(a)).slice(0, 10)
    .map(a => `${a.name}(${a.category},${fmtPct(pct(cnyOf(a)),1)}${a.pnl!=null?','+(num(a.pnl)>=0?'盈':'亏')+Math.abs(Math.round(num(a.pnl))):''})`).join('；');
  const factorTop = Object.entries(eff.factorWeights || {}).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([f,w]) => `${f} ${fmtPct(w*100,0)}`).join('、');
  const summary =
`【个人投资组合，截止${STATE.portfolio.asOfDate||'今日'}，美元/人民币中间价 ${fx.toFixed(4)}】
总资产：${fmtMoney(total)}（折合人民币）。
大类配置：${bigLines}。
按类别：${catLines}。
币种敞口：人民币 ${fmtPct(pct(byCur['CNY']||0),0)}，美元 ${fmtPct(pct(usdCny),0)}。
理财/存款年化利息合计约 ${fmtMoney(interestTotal)}（美元按 3%、人民币按实际利率，美元已折人民币）；股票/基金/黄金浮盈亏合计 ${pnlTotal>=0?'+':''}${fmtMoney(pnlTotal)}。
主要持仓（占比/盈亏，占比为占总资产）：${topHold}。
股票子组合的“有效独立赌注数”约 ${eff.effN?eff.effN.toFixed(1):'-'}（名义 ${(STATE.positions||[]).length} 只），因子集中度前三：${factorTop||'无'}。
请据此诊断健康度并给出下一步建议。`;

  aiCard.querySelector('#pf-ai').onclick = (e) => aiReview(summary, aiCard.querySelector('#pf-ai-out'), e.currentTarget.closest('button'));
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

  G('wallet', '投资组合 · 总览与 AI 诊断', [
    ['怎么用', '<p>已导入你 7/19 的资产汇总表。查看大类配置、按类别明细、币种敞口与全部持仓；点「生成 AI 组合诊断」由 DeepSeek 给出健康度评分与下一步建议。</p>'],
    ['计算逻辑', '<p>把每笔资产按汇率折算人民币后，归并为大类（权益/固收理财/现金/黄金），并按类别、币种分别汇总占比；美元敞口 = 所有 USD 计价资产折人民币之和。AI 诊断把这些占比 + 股票子组合的有效持仓数/因子集中度打包发给模型。</p>'],
    ['理论', '<p>基于<strong>资产配置理论</strong>：长期收益的绝大部分由大类配置（而非选股择时）决定；跨大类、跨币种分散能在不显著牺牲收益的前提下降低组合波动。</p>'],
    ['遵循的收益', '<p>一个均衡、不过度集中于单一大类或单一 beta 的组合，能在系统性回调中少受伤、在长期获得更稳的复利，避免“牛市财富逆向转移”。</p>'],
  ]);

  G('pie', '① 凯利定注 · 单标的下注', [
    ['怎么用', '<p>填赢/输情形的涨跌幅、胜率，并各写≥2 条看多/看空的客观理由；先过 EV 闸门，再看满/半/¼ 凯利三档，默认执行 ¼ 凯利。</p>'],
    ['计算逻辑', '<p>期望值 <code class="formula">EV = p×涨幅 − q×跌幅</code>，EV&lt;0 直接淘汰；净赔率 <code class="formula">b = 涨幅 ÷ 跌幅</code>；凯利 <code class="formula">f = (b×p − q) / b</code>；实战取 <code class="formula">f×0.25</code> 以降低参数误差。</p>'],
    ['理论', '<p><strong>凯利公式（Kelly Criterion）</strong>：在已知赔率与胜率下，使资金<strong>长期复利增长率最大</strong>的下注比例。半/四分之一凯利用来对冲主观胜率高估的风险。</p>'],
    ['遵循的收益', '<p>长期看，按（分数）凯利下注比“凭感觉重仓/轻仓”获得更高的复利增长率，同时把爆仓概率压到极低——既不错失机会，也不被单笔击穿。</p>'],
  ]);

  G('target', '② 组合分散 · 有效持仓数', [
    ['怎么用', '<p>在「持仓」为每只标的打上底层因子标签，本页给出“有效持仓数”，戳破“假分散”，并用饼图显示因子暴露；任一因子&gt;60% 会红色告警。</p>'],
    ['计算逻辑', '<p>按因子分组合并权重后，用逆 HHI：<code class="formula">有效持仓数 = 1 / Σ(因子权重²)</code>。持有 7 只但都在同一 beta 上，有效持仓数可能只有 2–3。</p>'],
    ['理论', '<p><strong>相关性与真实分散</strong>：分散的收益来自<strong>低相关</strong>，而非标的数量。同涨同跌的多只标的，本质是一个赌注。</p>'],
    ['遵循的收益', '<p>把有效持仓数提上去（押注真正独立的方向），能显著降低系统性回调时的整体回撤，让组合更抗单一 beta 崩塌。</p>'],
  ]);

  G('gauge', '③ 回撤控制 · 最大回撤约束', [
    ['怎么用', '<p>设定组合可承受的最大回撤阈值（默认 15%），本页显示回撤预算“已用/剩余”，并给出每只高波动持仓的理论仓位上限。</p>'],
    ['计算逻辑', '<p>单股回撤贡献 <code class="formula">= 持仓占比 × 该股最大跌幅</code>；组合预估回撤 = 各股贡献之和；单股理论上限 <code class="formula">= 回撤阈值 ÷ 该股最大跌幅</code>。</p>'],
    ['理论', '<p><strong>风险预算（Risk Budgeting）</strong>：把“可承受回撤”当成一笔总预算，分配给各持仓，而不是只盯仓位百分比。</p>'],
    ['遵循的收益', '<p>组合整体回撤被钉在你能承受的范围内，避免深套后被迫在底部割肉——控制回撤本身就是提高长期复利的关键（跌 50% 需涨 100% 才回本）。</p>'],
  ]);

  G('scissors', '④ 止损防御 · 固定分数止损', [
    ['怎么用', '<p>填总资产、单笔可接受最大亏损（默认 2%）、买入价与计划止损价，反推“最多能买多少”。</p>'],
    ['计算逻辑', '<p><code class="formula">最大可买仓位 = (总资产 × 单笔风险%) ÷ 止损幅度%</code>，其中止损幅度 = (买入价−止损价)/买入价。</p>'],
    ['理论', '<p><strong>固定分数法（Fixed-Fractional）</strong>：先定“这一笔最多亏本金的多少”，再由止损距离倒推仓位——把亏损前置锁死。</p>'],
    ['遵循的收益', '<p>单笔亏损被限制在总资产的固定小比例（如 2%），连续犯错也难伤筋动骨，保证你“留在牌桌上”等到属于自己的大机会。</p>'],
  ]);

  G('shield', '⑤ 铁律校验 · 操作拦截引擎', [
    ['怎么用', '<p>任何“加仓”前跑一遍校验：填浮盈亏、趋势、当前/加仓占比等，触发任一铁律即弹出必须二次确认的红色拦截。</p>'],
    ['计算逻辑', '<p>七条硬规则：亏损加仓、下跌趋势加仓、超单股上限、正金字塔（高位加仓额≥上次）、因子集中度&gt;60%、现金池&lt;下限、胜率&gt;60% 无充分理由。</p>'],
    ['理论', '<p><strong>行为金融学 + 交易纪律</strong>：把处置效应、损失厌恶、追高等人性弱点，用规则在情绪化时刻强制拦下。</p>'],
    ['遵循的收益', '<p>躲开散户最典型的四类致命操作（亏损加仓、接下跌的刀、追高头重脚轻、满仓无现金），这些正是账户从回撤走向巨亏的分水岭。</p>'],
  ]);

  G('ruler', '⑥ 加仓计划器 + 利润隔离', [
    ['怎么用', '<p>用橄榄型模板规划试水→主力→收缩；输入价位区间与总投入，生成“越低买越多”的正金字塔分批；浮盈超阈值（默认 +30%）提醒隔离部分利润。</p>'],
    ['计算逻辑', '<p>正金字塔按“越低价权重越大”线性分配买入额；利润隔离建议把浮盈的一半转入货基/债/黄金等安全资产并记录。</p>'],
    ['理论', '<p><strong>正金字塔加仓 + 落袋为安</strong>：摊薄成本、避免高位头重脚轻；把账面利润变成已实现的安全垫。</p>'],
    ['遵循的收益', '<p>降低平均持仓成本、抬高盈亏平衡点的安全边际，并在泡沫期锁住部分胜利果实，避免坐了一轮过山车回到原点。</p>'],
  ]);

  app.appendChild(el(`<div class="card"><div class="alert amber"><span class="icon">${icon('warn')}</span><div>
    <strong>免责声明</strong>：本工具仅做量化计算与纪律校验，不构成投资建议；AI 点评为模型生成，仅供参考。所有模型都依赖你的主观输入，输入不实则结论不实。最终决策与结果由你自己负责。</div></div></div>`));
};

/* -------------------------------------------------------------------------
   启动
   ------------------------------------------------------------------------- */
render();
