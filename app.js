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
  '#4f8cff', '#3fb950', '#d29922', '#f85149', '#a371f7',
  '#39c5cf', '#ff7b72', '#7ee787', '#f0d17a', '#79c0ff',
  '#ffa657', '#d2a8ff', '#56d364', '#8b98a8'
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
      s.positions = s.positions || [];
      s.portfolio = Object.assign({ totalAssets: 1000000 }, s.portfolio || {});
      return s;
    }
  } catch (e) { console.warn('状态读取失败', e); }
  return {
    settings: Object.assign({}, DEFAULT_SETTINGS),
    positions: [],
    portfolio: { totalAssets: 1000000 },
  };
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
        <span style="font-size:20px">⛔</span>
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
let currentView = 'dashboard';

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
      <h2>组合概览</h2>
      <p>四层决策架构的整体健康度快照。绿色达标，红色需处理。</p>
    </div>
  `));

  // 顶部四个统计
  const cashOk = cash >= s.cashFloor;
  const ddOk = usedDrawdown <= s.maxDrawdown;
  const concentrationOk = maxFactorW <= 0.6;
  app.appendChild(el(`
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat">
        <div class="label">持仓总占比</div>
        <div class="value">${fmtPct(totalWeight,0)}</div>
        <div class="sub">${positions.length} 只标的</div>
      </div>
      <div class="stat">
        <div class="label">现金池</div>
        <div class="value" style="color:${cashOk?'var(--green)':'var(--red)'}">${fmtPct(cash,0)}</div>
        <div class="sub">下限 ${s.cashFloor}% ${cashOk?'✅':'❌ 过低'}</div>
      </div>
      <div class="stat">
        <div class="label">有效持仓数</div>
        <div class="value" style="color:${effN>=3?'var(--green)':(effN>=2?'var(--amber)':'var(--red)')}">${effN?effN.toFixed(1):'—'}</div>
        <div class="sub">实际独立赌注数</div>
      </div>
      <div class="stat">
        <div class="label">回撤预算已用</div>
        <div class="value" style="color:${ddOk?'var(--green)':'var(--red)'}">${fmtPct(usedDrawdown,1)}</div>
        <div class="sub">阈值 ${s.maxDrawdown}% ${ddOk?'✅':'❌ 超支'}</div>
      </div>
    </div>
  `));

  // 健康度检查清单
  const checks = [];
  if (!cashOk) checks.push(['red', `现金池 ${fmtPct(cash,0)} 低于下限 ${s.cashFloor}%，丧失回调加仓能力`]);
  if (!ddOk) checks.push(['red', `回撤预算超支：预估最大回撤 ${fmtPct(usedDrawdown,1)} > 阈值 ${s.maxDrawdown}%`]);
  if (!concentrationOk && maxFactor) checks.push(['red', `因子「${maxFactor}」占 ${fmtPct(maxFactorW*100,0)} > 60%，过度集中于单一 beta`]);
  positions.forEach(p => {
    if (num(p.weight) > s.singleCap) checks.push(['amber', `${p.name||'未命名'} 占 ${fmtPct(num(p.weight),1)} 超单股上限 ${s.singleCap}%`]);
  });
  if (effN > 0 && effN < 2 && positions.length >= 3) checks.push(['amber', `持有 ${positions.length} 只，但有效持仓数仅 ${effN.toFixed(1)}——假分散`]);
  if (checks.length === 0 && positions.length > 0) checks.push(['green', '当前组合通过全部纪律检查 ✅']);

  const checklist = el('<div class="card"><h3>纪律体检</h3></div>');
  if (positions.length === 0) {
    checklist.appendChild(el(`<div class="empty"><div class="big">📋</div><p>还没有持仓。先到「持仓」页录入，或直接使用各计算器。</p></div>`));
  } else {
    checks.forEach(([type, msg]) => {
      checklist.appendChild(el(`<div class="alert ${type}"><span class="icon">${type==='red'?'⛔':type==='amber'?'⚠️':'✅'}</span><div>${msg}</div></div>`));
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
      <span style="color:${over?'var(--red)':'var(--muted)'};font-weight:600">${fmtPct(w*100,0)}${over?' ⚠️':''}</span>
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

async function fetchQuote(rawCode) {
  const code = String(rawCode || '').trim();
  if (!/^\d{5,6}$/.test(code)) throw new Error('请输入 5–6 位数字代码');
  const full = detectMarket(code) + code;
  const res = await fetch('/api/quote?code=' + encodeURIComponent(full), { cache: 'no-store' });
  if (!res.ok) throw new Error('接口返回 ' + res.status);
  const buf = await res.arrayBuffer();
  let text;
  try { text = new TextDecoder('gbk').decode(buf); }
  catch (e) { text = new TextDecoder('utf-8').decode(buf); }
  const m = text.match(/"([^"]*)"/);
  if (!m || !m[1]) throw new Error('无数据（代码可能有误或已休市）');
  const parts = m[1].split(',');            // 新浪：0名称 1今开 2昨收 3当前价
  const name = parts[0];
  let price = parseFloat(parts[3]);
  if (!(price > 0)) price = parseFloat(parts[2]); // 休市/未开盘时退回昨收
  if (!name || !isFinite(price)) throw new Error('解析失败');
  return { name, price };
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
    <div class="alert blue" id="np-calc"><span class="icon">🧮</span><div id="np-calc-text">填入持股数量与现价后，这里自动显示市值 / 占比 / 浮盈亏。</div></div>
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
      note.innerHTML = `⚠️ 自动获取失败（${escapeHtml(e.message)}）——请手动填写名称与现价`;
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
    listCard.appendChild(el(`<div class="empty"><div class="big">📭</div><p>暂无持仓</p></div>`));
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
          <th>名称</th><th>因子</th><th class="num">占比</th><th class="num">金额</th><th class="num">浮盈亏</th>
          <th>趋势</th><th class="num">最大跌幅</th><th class="num">回撤贡献</th><th></th>
        </tr></thead>
        <tbody>${rows}
          <tr class="total-row">
            <td>合计</td><td></td><td class="num">${fmtPct(totalWeight,1)}</td>
            <td class="num">${totalValue>0?fmtMoney(totalValue):'—'}</td>
            <td></td><td></td><td></td>
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
      resBox.appendChild(el(`<div class="alert red"><span class="icon">⛔</span><div>请先补全：<br>${errs.map(e=>'· '+e).join('<br>')}</div></div>`));
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
        <div class="alert red"><span class="icon">⛔</span><div>
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
      resBox.appendChild(el(`<div class="alert red"><span class="icon">⛔</span><div>满凯利 f ≤ 0：期望值虽非负，但赔率不足以支撑下注，建议不参与或减仓。</div></div>`));
      return;
    }

    const tierEl = el('<div class="kelly-tiers"></div>');
    tiers.forEach(t => {
      tierEl.appendChild(el(`
        <div class="tier ${t.rec?'recommended':''}">
          <div class="label">${t.label}</div>
          <div class="val">${(t.val*100).toFixed(1)}%</div>
          ${t.rec?'<div class="tag">★ 默认执行值</div>':''}
        </div>`));
    });
    resBox.appendChild(tierEl);

    // 高胜率警告
    if (pPct > 60) {
      resBox.appendChild(el(`<div class="alert amber"><span class="icon">⚠️</span><div>
        你填入胜率 ${pPct}% > 60%。散户最常见错误是高估胜率——请回看你的 ${bears.length} 条看空理由，确认这个概率经得起推敲。
      </div></div>`));
    }

    // 与单股上限对照
    const quarterPct = f * 0.25 * 100;
    if (quarterPct > s.singleCap) {
      resBox.appendChild(el(`<div class="alert amber"><span class="icon">⚠️</span><div>
        ¼ 凯利目标 ${quarterPct.toFixed(1)}% 已超过你的单股上限 ${s.singleCap}%。即便凯利允许，也建议以单股上限为准（分散优先）。
      </div></div>`));
    } else {
      resBox.appendChild(el(`<div class="alert green"><span class="icon">✅</span><div>
        推荐执行 <strong>¼ 凯利 = ${quarterPct.toFixed(1)}%</strong>，在单股上限 ${s.singleCap}% 之内。1/4 凯利用于降低参数误差，实战更稳。
      </div></div>`));
    }
  };
};

/* =========================================================================
   模块 2 — 相关性 / 有效持仓数（组合分散）⭐
   ========================================================================= */
VIEWS.diversify = function (app) {
  app.appendChild(el(`
    <div class="view-head">
      <h2>② 组合分散 · 有效持仓数</h2>
      <p>戳破"假分散"——持有多只股票，但实际只押了少数几个独立赌注。</p>
    </div>
  `));

  if (STATE.positions.length === 0) {
    app.appendChild(el(`<div class="card"><div class="empty"><div class="big">🧩</div>
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
    card.appendChild(el(`<div class="alert red" style="margin-top:16px"><span class="icon">🎯</span><div>
      你持有 <strong>${nHoldings}</strong> 只标的，但有效持仓数仅 <strong>${effN.toFixed(1)}</strong>——你实际只押了约 ${Math.round(effN)} 个独立方向。这是典型的假分散。
    </div></div>`));
  } else {
    card.appendChild(el(`<div class="alert green" style="margin-top:16px"><span class="icon">✅</span><div>
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
    pieCard.appendChild(el(`<div class="alert red" style="margin-top:14px"><span class="icon">⛔</span><div>
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
    app.appendChild(el(`<div class="card" style="margin-top:16px"><div class="empty"><div class="big">📉</div>
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
    budgetCard.appendChild(el(`<div class="alert red" style="margin-top:12px"><span class="icon">⛔</span><div>
      组合预估最大回撤 ${fmtPct(used,2)} 已超阈值 ${fmtPct(threshold,1)}，需降低高波动持仓。参见下表建议上限。
    </div></div>`));
  } else {
    budgetCard.appendChild(el(`<div class="alert green" style="margin-top:12px"><span class="icon">✅</span><div>
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
        ? `<span class="pill red">❌ 超预算</span>`
        : `<span class="pill green">✅ 预算内</span>`}</td>
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
    detail.appendChild(el(`<div class="alert ${over?'red':'green'}" style="margin-top:12px"><span class="icon">${over?'❌':'✅'}</span><div>
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

    if (total <= 0 || risk <= 0) { box.appendChild(el(`<div class="alert red"><span class="icon">⛔</span><div>请填写有效的总资产与单笔风险。</div></div>`)); return; }
    if (stop >= buy || buy <= 0 || stop <= 0) {
      box.appendChild(el(`<div class="alert red"><span class="icon">⛔</span><div>止损价须为正且低于买入价（否则不构成止损）。</div></div>`));
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
      <div class="alert blue"><span class="icon">📌</span><div>
        若买入 ${fmtMoney(r.positionValue)} 并在 ${buy} 触及止损价 ${stop} 时离场，亏损恰为总资产的 ${risk}%（${fmtMoney(r.riskAmount)}）。
      </div></div>
    `));
    if (overCap) {
      box.appendChild(el(`<div class="alert amber"><span class="icon">⚠️</span><div>
        该仓位金额 ${fmtMoney(r.positionValue)} 占 ${fmtPct(r.positionValue/total*100,1)}，超过单股上限 ${s.singleCap}%（${fmtMoney(capValue)}）。建议以单股上限为准，或收紧止损。
      </div></div>`));
    }
  };
};

/* =========================================================================
   模块 5 — 铁律校验引擎（操作拦截）⭐灵魂功能
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
    <button class="btn danger" id="r-check">🔍 运行铁律校验</button>
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
      box.appendChild(el(`<div class="alert amber"><span class="icon">⚠️</span><div>请填写本次加仓占比（> 0）。</div></div>`));
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
      box.appendChild(el(`<div class="alert green" style="margin-top:14px"><span class="icon">✅</span><div>
        <strong>通过全部铁律校验</strong>，本次加仓未触发拦截。仍请对照客观依据后再操作。
      </div></div>`));
      return;
    }

    // 有违规：先展示，再弹阻塞式二次确认
    box.appendChild(el(`<div class="alert red" style="margin-top:14px"><span class="icon">⛔</span><div>
      <strong>触发 ${violations.length} 条铁律，操作被拦截：</strong><br>${violations.map(v=>'· '+v).join('<br>')}
    </div></div>`));

    const proceed = await showBlockingModal({
      title: '铁律拦截 · 需二次确认',
      lines: violations,
    });
    if (proceed) {
      box.appendChild(el(`<div class="alert amber" style="margin-top:10px"><span class="icon">⚠️</span><div>
        你已二次确认越过 ${violations.length} 条铁律。请记住：越过拦截的责任在你，工具已尽到守门员职责。
      </div></div>`));
    } else {
      box.appendChild(el(`<div class="alert green" style="margin-top:10px"><span class="icon">🛡️</span><div>
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
      box.appendChild(el(`<div class="alert red"><span class="icon">⛔</span><div>请确保最高价 > 最低价，且金额为正。</div></div>`));
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
    box.appendChild(el(`<div class="alert blue" style="margin-top:12px"><span class="icon">📐</span><div>
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
    lock.appendChild(el(`<div class="alert blue"><span class="icon">💤</span><div>当前没有浮盈达到 +${s.profitLockThreshold}% 的标的，无需隔离。</div></div>`));
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
    <div class="row">
      <button class="btn secondary" id="dm-export" style="flex:0 0 auto">导出数据（JSON）</button>
      <button class="btn secondary" id="dm-import" style="flex:0 0 auto">导入数据</button>
      <button class="btn danger" id="dm-clear" style="flex:0 0 auto">清空全部数据</button>
    </div>
    <input type="file" id="dm-file" accept="application/json" style="display:none"/>
  `));
  app.appendChild(dataCard);

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
        STATE.portfolio = Object.assign({ totalAssets: 1000000 }, imported.portfolio || {});
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

/* -------------------------------------------------------------------------
   启动
   ------------------------------------------------------------------------- */
render();
