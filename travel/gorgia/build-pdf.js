const {chromium}=require('playwright');
const fs=require('fs'), path=require('path');
const SRC='file:///home/user/investment-intellegence/travel/gorgia/index.html';
const SCR='/tmp/claude-0/-home-user-investment-intellegence/aaf44f77-0f2d-56f8-bbc4-9314db8be71d/scratchpad';
const OUT='/home/user/investment-intellegence/travel/gorgia/格鲁吉亚旅居手册.pdf';

const TYPE_CN={move:'转场',play:'出游',work:'半天班',soft:'朋友安排'};
const TYPE_COLOR={move:'#7A2233',play:'#175A72',work:'#A97C22',soft:'#8A9995'};

(async()=>{
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage();
await p.goto(SRC);
const data=await p.evaluate(()=>{
  const refs=[...document.querySelectorAll('details.acc')].map(d=>({
    t:d.querySelector('summary').textContent.trim(),
    h:d.querySelector('.body').innerHTML
  }));
  return {DAYS, refs,
    title:document.querySelector('.hero h1').textContent.trim(),
    sub:document.querySelector('.hero .sub').textContent.trim(),
    foot:[...document.querySelectorAll('footer p')].map(x=>x.innerHTML)};
});
await p.close();

const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const fontCss=fs.readFileSync(path.join(SCR,'fonts.css'),'utf8');

// —— 每天正文 ——
function day(d,i){
  const c=TYPE_COLOR[d.type];
  let h=`<section class="day"><div class="dhead" style="border-color:${c}">
    <div class="dmeta"><span class="dnum" style="background:${c}">${d.d}</span>
      <span>${d.dow}</span><span>${d.city}</span><span class="dtype">${TYPE_CN[d.type]}</span>
      <span class="dix">第 ${i+1} / 17 天</span></div>
    <h2>${d.title}</h2><p class="dsum">${d.sum}</p></div>`;
  if(d.move&&d.move.length){h+='<h3>交通</h3>';
    d.move.forEach(m=>{h+=`<div class="row"><b>${m.ic} ${m.t}</b><span>${m.s}</span>${m.m?`<span class="meta">${m.m}</span>`:''}</div>`});}
  if(d.stay){h+='<h3>当晚住</h3><div class="row"><b>🛏 '+d.stay.t+(d.stay.tag?` <em class="tag">${d.stay.tag}</em>`:'')+'</b>'+(d.stay.s?`<span>${d.stay.s}</span>`:'')+'</div>';}
  if(d.tl&&d.tl.length){h+='<h3>这一天</h3><table class="tl">';
    d.tl.forEach(t=>{h+=`<tr class="${t.key?'key':''}"><td class="tm">${t.t}</td><td class="tx">${t.x}</td></tr>`});
    h+='</table>';}
  if(d.food&&d.food.length){h+='<h3>吃什么</h3><ul class="food">';
    d.food.forEach(f=>{h+=`<li><b>${f.n}</b>　${f.d}${f.p?` <i>· ${f.p}</i>`:''}</li>`});h+='</ul>';}
  if(d.tips&&d.tips.length){h+='<h3>提醒</h3>';
    d.tips.forEach(t=>{h+=`<div class="tip${t.w?' warn':''}">${t.x}</div>`});}
  if(d.pics&&d.pics.length){h+='<h3 class="seeh">看什么</h3><ul class="pics">';
    d.pics.forEach(x=>{h+=`<li>${x.c}</li>`});h+='</ul>';}
  return h+'</section>';
}

const overview=`<table class="ov"><thead><tr><th>日期</th><th>城市</th><th>类型</th><th>这一天</th></tr></thead><tbody>`
 + data.DAYS.map(d=>`<tr><td class="ovd"><b>${d.d}</b><i>${d.dow}</i></td><td>${d.city}</td>`
   +`<td><span class="pill" style="background:${TYPE_COLOR[d.type]}">${TYPE_CN[d.type]}</span></td>`
   +`<td>${d.title}</td></tr>`).join('')+'</tbody></table>';

const refHtml=data.refs.map(r=>`<section class="ref"><h2>${esc(r.t)}</h2>${r.h}</section>`).join('');

const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>格鲁吉亚旅居手册</title><style>
${fontCss}
@page{size:A4;margin:15mm 14mm 16mm}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"Noto Sans SC",sans-serif;font-size:10pt;line-height:1.66;color:#16211F}
h1,h2,h3,h4,.dnum,.cover .t{font-family:"Noto Serif SC",serif}
a{color:#175A72;text-decoration:none}

/* 封面 */
.cover{height:262mm;display:flex;flex-direction:column;justify-content:center;text-align:center;page-break-after:always}
.cover .t{font-size:30pt;font-weight:700;letter-spacing:.06em;margin:0 0 10mm;color:#0E3A4B}
.cover .s{font-size:11pt;color:#5A6866;line-height:2.1}
.cover .rule{width:44mm;height:2px;background:#A97C22;margin:9mm auto}
.cover .n{margin-top:14mm;font-size:9pt;color:#8E9A97}

.pg{page-break-before:always}
h2.sec{font-size:15pt;color:#0E3A4B;margin:0 0 5mm;padding-bottom:2.5mm;border-bottom:2px solid #0E3A4B}

/* 速查 */
.quick{display:grid;grid-template-columns:1fr 1fr;gap:5mm}
.qbox{border:1px solid #E3E6E0;border-radius:3px;padding:3.5mm 4mm;break-inside:avoid}
.qbox h4{margin:0 0 2.5mm;font-size:10.5pt;color:#7A2233}
.qbox p{margin:0 0 1.6mm;font-size:9pt;line-height:1.6}
.qbox .big{font-size:11pt;font-weight:700;letter-spacing:.02em}
.qbox.wide{grid-column:1/-1}

/* 总览表 */
table.ov{width:100%;border-collapse:collapse;font-size:9pt}
table.ov th{background:#0E3A4B;color:#fff;padding:2.2mm 2.5mm;text-align:left;font-weight:500;font-size:8.5pt}
table.ov td{padding:2.2mm 2.5mm;border-bottom:1px solid #EFF1EC;vertical-align:top}
table.ov tr:nth-child(even) td{background:#FAFBF9}
.ovd b{display:block}.ovd i{font-style:normal;color:#8E9A97;font-size:8pt}
.pill{color:#fff;padding:.6mm 2mm;border-radius:2px;font-size:7.5pt;white-space:nowrap}

/* 每日 */
.day{page-break-before:always}
.dhead{border-left:3.5mm solid;padding:0 0 3mm 4mm;margin-bottom:4mm;border-bottom:1px solid #E3E6E0}
.dmeta{font-size:8.5pt;color:#5A6866;margin-bottom:1.5mm}
.dmeta span{margin-right:3mm}
.dnum{color:#fff;padding:.7mm 2.2mm;border-radius:2px;font-weight:700;font-size:10pt}
.dtype{border:1px solid #D6DBD6;padding:.3mm 1.6mm;border-radius:2px;font-size:7.5pt}
.dix{float:right;color:#A6B0AD;margin-right:0}
.day h2{font-size:14pt;margin:0 0 1.5mm;color:#0E3A4B}
.dsum{margin:0;color:#5A6866;font-size:9.5pt}
.day h3{font-size:10pt;color:#A97C22;margin:5mm 0 2mm;padding-bottom:1mm;border-bottom:1px solid #EFF1EC;letter-spacing:.08em}
.row{margin-bottom:2.5mm;break-inside:avoid}
.row b{display:block;font-size:10pt}
.row span{display:block;font-size:9pt;color:#5A6866}
.row .meta{color:#8E9A97;font-size:8.5pt}
.tag{font-style:normal;background:#F8F2E4;color:#A97C22;padding:.3mm 1.6mm;border-radius:2px;font-size:7.5pt}

table.tl{width:100%;border-collapse:collapse}
table.tl td{padding:1.8mm 0;vertical-align:top;border-bottom:1px solid #F3F5F1}
table.tl .tm{width:19mm;font-weight:700;font-size:9pt;color:#0E3A4B;white-space:nowrap;padding-right:3mm}
table.tl .tx{font-size:9.5pt}
table.tl tr.key .tm{color:#7A2233}
table.tl tr.key .tx{background:#FBFAF5;padding-left:2.5mm;border-left:2px solid #A97C22}

ul.food,ul.pics{margin:0;padding-left:5mm;font-size:9.5pt}
ul.food li{margin-bottom:1.8mm}
ul.food i{font-style:normal;color:#7A2233}
ul.pics li{color:#5A6866;font-size:9pt}
.seeh+ul.pics{margin-top:1mm}

.tip{background:#F7F8F5;border-left:2.5px solid #A9B6B3;padding:2.5mm 3mm;margin-bottom:2.5mm;font-size:9pt;break-inside:avoid}
.tip.warn{background:#FBF1F2;border-left-color:#7A2233}
mark{background:#F8EFD6;padding:0 .8mm}

/* 参考 */
.ref{page-break-before:always}
.ref h2{font-size:14pt;color:#0E3A4B;margin:0 0 4mm;padding-bottom:2mm;border-bottom:2px solid #0E3A4B}
.ref h4{font-size:10pt;color:#A97C22;margin:5mm 0 2mm}
.ref p,.ref li{font-size:9.5pt}
.ref ul{padding-left:5mm}
.ref li{margin-bottom:1.4mm}
dl.kv{display:grid;grid-template-columns:24mm 1fr;gap:1.6mm 3mm;margin:0;font-size:9pt}
dl.kv dt{font-weight:700;color:#0E3A4B}
dl.kv dd{margin:0}
table.tbl{width:100%;border-collapse:collapse;font-size:9pt;margin:2mm 0}
table.tbl th{background:#EFF1EC;padding:1.8mm 2.5mm;text-align:left}
table.tbl td{padding:1.8mm 2.5mm;border-bottom:1px solid #EFF1EC;vertical-align:top}
a.lnk{display:block;margin-bottom:2mm;font-size:9pt;break-inside:avoid}
a.lnk b{display:block;color:#0E3A4B}
a.lnk span{display:block;color:#5A6866;font-size:8.5pt}
a.lnk::after{content:attr(href);display:block;color:#8E9A97;font-size:7.5pt;word-break:break-all}
.foot{margin-top:8mm;padding-top:3mm;border-top:1px solid #E3E6E0;font-size:8pt;color:#8E9A97}
</style></head><body>

<div class="cover">
  <div class="t">格鲁吉亚旅居手册</div>
  <div class="rule"></div>
  <div class="s">2026 年 9 月 18 日 — 10 月 4 日<br>第比利斯 · 巴统 · 埃里温 · 撒马尔罕 · 塔什干<br>17 天 · 3 个国家 · 2 人</div>
  <div class="n">离线版 · 生成于 2026 年 9 月 18 日<br>在线版 http://101.34.215.45/personal/travel/gorgia/</div>
</div>

<div class="pg">
<h2 class="sec">一页速查</h2>
<div class="quick">
  <div class="qbox"><h4>航班</h4>
    <p class="big">MU285　9.18　12:50 → 19:00</p><p>上海浦东 T1 → 第比利斯 TBS</p>
    <p class="big">C6222　10.1　15:30 → 19:50</p><p>第比利斯 TBS → 塔什干 T2</p>
    <p class="big">10.3 晚 20:00 → 10.4 05:50</p><p>塔什干 → 上海浦东</p></div>
  <div class="qbox"><h4>司机</h4>
    <p class="big">Nodar　+995 574 893 319</p><p>9.25 09:00 · Toyota Highlander · DD-971-PD</p>
    <p class="big">Vladimer　+995 595 117 180</p><p>9.26 08:45 · Honda Accord · VL-102-AD · $179 整车</p>
    <p>两趟都付现金。改期只在 GoTrip 站内聊天里谈。</p></div>
  <div class="qbox"><h4>住哪儿</h4>
    <p><b>9.23–9.24</b> 巴统希尔顿　40 Rustaveli Ave　确认号 3522841428</p>
    <p><b>9.24–9.26</b> 巴统民宿　42 Rustaveli Ave（希尔顿隔壁）</p>
    <p><b>9.26–9.27</b> Monograph Freedom Square　5/7 Aleksandr Pushkin St　订单号 1128150691023697</p>
    <p><b>9.27–9.30</b> 埃里温 · 朋友安排</p>
    <p><b>9.18–9.23</b> 第比利斯 Avlabari 一带　<b>9.30–10.1</b> 第比利斯　<b>10.1–10.3</b> 塔什干　<i>（三段待订）</i></p></div>
  <div class="qbox"><h4>紧急电话</h4>
    <p class="big">格鲁吉亚 112</p><p>警察消防急救合一</p>
    <p class="big">亚美尼亚 911</p>
    <p class="big">乌兹别克斯坦 101 / 102 / 103</p><p>火警 / 警察 / 急救</p>
    <p>中国使馆：第比利斯 · 埃里温 · 塔什干</p></div>
  <div class="qbox wide"><h4>钱与时差</h4>
    <p>格鲁吉亚 <b>拉里 GEL</b>　亚美尼亚 <b>德拉姆 AMD</b>　乌兹别克斯坦 <b>苏姆 UZS</b>（面额很大，1 美元一万多）</p>
    <p>格鲁吉亚 UTC+4，比北京晚 4 小时　·　塔什干 UTC+5，比北京晚 3 小时</p>
    <p><b>必须现金</b>：两趟包车、卡赫季和阿扎拉的家庭酒庄、山区小摊、巴扎、硫磺浴搓背、乌兹别克路边摊</p>
    <p>ATM 取钱问 with / without conversion，<b>一律选 without</b>，按当地货币出账</p></div>
  <div class="qbox wide"><h4>三件最容易忘的事</h4>
    <p><b>1. 护照原件</b>　9.22 进特鲁索峡谷有边防检查站，没带原件这一段进不去。</p>
    <p><b>2. 保险覆盖三国</b>　2026 年起入境格鲁吉亚强制，保额不低于 30,000 拉里，必须含亚美尼亚和乌兹别克斯坦，日期覆盖到 10 月 4 日。</p>
    <p><b>3. 拉里在离境前花掉</b>　出了格鲁吉亚基本没地方换。</p></div>
</div>
</div>

<div class="pg"><h2 class="sec">十七天总览</h2>${overview}</div>

${data.DAYS.map(day).join('')}

${refHtml}

<div class="foot">${data.foot.join('<br>')}</div>
</body></html>`;

fs.writeFileSync(path.join(SCR,'print.html'),html);
const p2=await b.newPage();
await p2.goto('http://127.0.0.1:8899/print.html',{waitUntil:'networkidle'});
await p2.evaluate(()=>document.fonts.ready);
await p2.waitForTimeout(1200);
await p2.pdf({path:OUT,format:'A4',printBackground:true,
  margin:{top:'15mm',bottom:'16mm',left:'14mm',right:'14mm'},
  displayHeaderFooter:true,
  headerTemplate:'<div></div>',
  footerTemplate:'<div style="width:100%;font-size:7pt;color:#9AA5A2;font-family:sans-serif;padding:0 14mm;display:flex;justify-content:space-between"><span>格鲁吉亚旅居手册 · 2026.9.18–10.4</span><span class="pageNumber"></span></div>'});
await b.close();
console.log('PDF ->',OUT, (fs.statSync(OUT).size/1048576).toFixed(2)+' MB');
})();
