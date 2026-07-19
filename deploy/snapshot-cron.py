#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
理性仓位管理工具 —— 服务器端每日资产快照定时任务。

为什么需要它：前端是纯静态页面，只有「浏览器打开时」才会记录快照。
本脚本在服务器上按计划（北京时间 22:00 / 23:00 / 23:30）直接读写云端数据文件，
即使你当天没打开网页，也能抓到当日（尤其是傍晚才公布的基金净值）快照。

做的事：
  1) 读取整份数据文件 STATE_FILE（与前端 /api/state 同一个文件）。
  2) 对可刷新的基金/股票拉取最新价（份额模型，与前端一致），更新金额/浮盈亏。
  3) 重算「今日」快照并 upsert 进 snapshots。
  4) 盖 savedAt 时间戳并原子写回；随后 chown 回 www-data 供 Nginx PUT 继续可写。

设计原则：任何一步失败都不致命——单只资产拉取失败就跳过（保留旧值），
仍会用现有值记录当日快照；一天多次运行相互覆盖当日、互为冗余。
"""

import json
import os
import re
import sys
import time
import urllib.request

STATE_FILE = '/var/lib/investment-intelligence/store/api/state'
FX_DEFAULT = 6.78
UA = 'Mozilla/5.0'
TIMEOUT = 8


def today_str():
    # 服务器时区应为 Asia/Shanghai（cron 用 CRON_TZ 保证触发时刻；日期用本地时间）
    return time.strftime('%Y-%m-%d', time.localtime())


def http_get(url, encoding, referer=None):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    if referer:
        req.add_header('Referer', referer)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode(encoding, 'ignore')


# ---------- 与前端一致的财务口径 ----------
def num(v, d=0.0):
    try:
        if v is None or v == '':
            return d
        return float(v)
    except (TypeError, ValueError):
        return d


def current_fx(state):
    return num((state.get('portfolio') or {}).get('fxRate'), FX_DEFAULT) or FX_DEFAULT


def asset_cny(a, fx):
    if a.get('currency') == 'USD':
        return num(a.get('amount')) * fx
    return num(a.get('amount') if a.get('amount') is not None else a.get('cny'))


def annual_rate_of(a):
    if a.get('annualRate') is not None:
        return num(a.get('annualRate'))
    cat = a.get('category')
    cur = a.get('currency')
    text = (a.get('name') or '') + (a.get('note') or '')
    m = re.search(r'([\d.]+)\s*%', text)
    pct = float(m.group(1)) / 100 if m else None
    if cat == '理财(QDII)':
        return 0.03 if cur == 'USD' else (pct if pct is not None else 0.03)
    if cat == '定期存款' or '定期' in text:
        if cur == 'USD':
            return 0.03
        return pct if pct is not None else 0.014
    if re.search(r'货币基金|朝朝宝', a.get('name') or ''):
        return 0.015
    if cur == 'USD' and '理财' in text:
        return 0.03
    return 0.0


def asset_income(a, fx):
    rate = annual_rate_of(a)
    if rate > 0:
        cny = num(a.get('amount')) * rate * (fx if a.get('currency') == 'USD' else 1)
        return ('interest', cny)
    return ('pnl', num(a.get('pnl')) if a.get('pnl') is not None else None)


def big_class_of(cat):
    if cat in ('A股股票', '美股股票', '基金'):
        return '权益'
    if cat in ('理财(QDII)', '定期存款'):
        return '固收/理财'
    if cat in ('人民币现金', '香港账户现金'):
        return '现金'
    if cat == '黄金':
        return '黄金'
    return '其它'


def portfolio_total(state):
    assets = state.get('assets') or []
    fx = current_fx(state)
    if assets:
        s = sum(asset_cny(a, fx) for a in assets)
        if s > 0:
            return round(s)
    return round(num((state.get('portfolio') or {}).get('totalAssets')))


# ---------- 行情：基金 / A股 / 美股（份额模型与前端一致）----------
def detect_market(code):
    if re.match(r'^6', code):
        return 'sh'
    if re.match(r'^(5|11|13)', code):
        return 'sh'
    if re.match(r'^(4|8)', code) or re.match(r'^920', code):
        return 'bj'
    return 'sz'


def is_us_code(code):
    return bool(re.search(r'[A-Za-z]', code or ''))


def fetch_fund(code):
    txt = http_get('https://fundgz.1234567.com.cn/js/%s.js' % code, 'utf-8',
                   referer='https://fund.eastmoney.com/')
    m = re.search(r'jsonpgz\(\s*(\{.*?\})\s*\)', txt)
    if not m:
        raise ValueError('no jsonpgz')
    o = json.loads(m.group(1))
    nav = num(o.get('gsz') or o.get('dwjz'))
    prev = num(o.get('dwjz'))
    day = num(o.get('gszzl'))
    if nav <= 0:
        raise ValueError('nav<=0')
    return nav, (prev if prev > 0 else None), day


def fetch_quote(code):
    if is_us_code(code):
        sym = re.sub(r'\s+', '', code.upper())
        txt = http_get('https://qt.gtimg.cn/q=us%s' % sym, 'gbk')
        m = re.search(r'"([^"]*)"', txt)
        p = m.group(1).split('~') if m else []
        price = num(p[3]) if len(p) > 3 else 0
        day = num(p[5]) if len(p) > 5 else None
        prev = price / (1 + day / 100) if (day is not None and (1 + day / 100) != 0) else None
        if price <= 0:
            raise ValueError('price<=0')
        return price, prev, day
    full = detect_market(code) + code
    txt = http_get('https://qt.gtimg.cn/q=%s' % full, 'gbk')
    m = re.search(r'"([^"]*)"', txt)
    p = m.group(1).split('~') if m else []
    price = num(p[3]) if len(p) > 3 else 0
    prev = num(p[4]) if len(p) > 4 else 0
    if price <= 0:
        price = prev
    day = ((price - prev) / prev * 100) if prev > 0 else None
    if price <= 0:
        raise ValueError('price<=0')
    return price, (prev if prev > 0 else None), day


def asset_fetchable(a):
    code = a.get('code') or ''
    if not code:
        return False
    if a.get('category') == '基金':
        return bool(re.match(r'^\d{6}$', code))
    if a.get('category') in ('A股股票', '美股股票'):
        return is_us_code(code) or bool(re.match(r'^\d{5,6}$', code))
    return False


def refresh_asset(a, fx):
    if a.get('category') == '基金':
        px, prev, day = fetch_fund(a['code'])
    else:
        px, prev, day = fetch_quote(a['code'])
    if px <= 0:
        raise ValueError('bad price')
    if not num(a.get('shares')) > 0:
        base = prev if (prev and prev > 0) else px
        a['shares'] = num(a.get('amount')) / base
    old = num(a.get('amount'))
    new = num(a['shares']) * px
    delta_cny = (new - old) * (fx if a.get('currency') == 'USD' else 1)
    a['amount'] = round(new, 2)
    a['cny'] = round(asset_cny(a, fx))
    if a.get('pnl') is not None:
        a['pnl'] = round(num(a.get('pnl')) + delta_cny, 2)
    a['lastPx'] = px
    if day is not None:
        a['dayPct'] = day
    a['pxDate'] = today_str()


def make_snapshot(state, date):
    assets = state.get('assets') or []
    fx = current_fx(state)
    by_big = {}
    interest = 0.0
    pnl = 0.0
    for a in assets:
        v = asset_cny(a, fx)
        k = big_class_of(a.get('category'))
        by_big[k] = by_big.get(k, 0) + v
        kind, val = asset_income(a, fx)
        if kind == 'interest':
            interest += val
        elif val is not None:
            pnl += val
    return {
        'date': date,
        'total': portfolio_total(state),
        'byBig': {k: round(v) for k, v in by_big.items()},
        'interest': round(interest),
        'pnl': round(pnl),
        'fx': round(fx, 4),
    }


def main():
    if not os.path.exists(STATE_FILE):
        print('[%s] state file not found, skip' % time.strftime('%F %T'))
        return 0
    try:
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            state = json.load(f)
    except Exception as e:
        print('[%s] read/parse failed: %s' % (time.strftime('%F %T'), e))
        return 1

    assets = state.get('assets') or []
    if not assets:
        print('[%s] no assets, skip' % time.strftime('%F %T'))
        return 0

    fx = current_fx(state)
    ok = 0
    fail = 0
    for a in assets:
        if not asset_fetchable(a):
            continue
        try:
            refresh_asset(a, fx)
            ok += 1
        except Exception as e:
            fail += 1
            print('  refresh %s(%s) failed: %s' % (a.get('name'), a.get('code'), e))

    # upsert 今日快照
    date = today_str()
    snap = make_snapshot(state, date)
    snaps = state.get('snapshots') or []
    snaps = [s for s in snaps if s.get('date') != date]
    snaps.append(snap)
    snaps.sort(key=lambda s: s.get('date', ''))
    state['snapshots'] = snaps
    state['savedAt'] = int(time.time() * 1000)

    # 原子写回 + 权限交还 www-data（供 Nginx WebDAV PUT 继续可写）
    tmp = STATE_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)
    try:
        import pwd
        import grp
        os.chown(STATE_FILE, pwd.getpwnam('www-data').pw_uid, grp.getgrnam('www-data').gr_gid)
    except Exception:
        pass

    print('[%s] snapshot %s ok, refreshed %d, failed %d, total %s'
          % (time.strftime('%F %T'), date, ok, fail, snap['total']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
