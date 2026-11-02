/**
 * offline.js — 离线快照数据源（读取静态 `offline-data/` 目录下的真实数据导出包）
 *
 * 由服务端「导出离线数据」按钮（POST /api/export/offline）或 CLI
 * `python -m qu_web.cli export-offline` 生成；离线页面用 `?data=offline` 打开，
 * 数据全部来自导出时的真实行情，而非内置示例（mock）。
 *
 * 适配原则：把前端的「参数化请求」映射到静态包（按参数切片/筛选）：
 * - 指数 K 线：包内是 N 根日线 → 按 days 切片（周/月K 由前端自行聚合）
 * - 红绿家数 / 概念榜 / 成交额榜：按 days / limit / date 切片
 * - 概念详情：按 days 切片历史、按 date 截断（成分股仅为导出日快照）
 * - 回测：返回导出时的默认参数结果（离线不支持改参数重跑）
 */

import { OFFLINE_BASE } from './config.js';

const BASE = String(OFFLINE_BASE || 'offline-data/').replace(/\/+$/, '');

let manifest = null;
const cache = new Map();

async function loadJson(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const resp = await fetch(`${BASE}/${rel}`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`离线数据缺失：${rel}（HTTP ${resp.status}）`);
  const data = await resp.json();
  cache.set(rel, data);
  return data;
}

/** 加载 manifest；失败返回 null（说明没有导出包）。 */
export async function initOffline() {
  try {
    const data = await loadJson('manifest.json');
    if (!data || !data.version) return null;
    manifest = data;
    return data;
  } catch (_err) {
    return null;
  }
}

export function offlineManifest() {
  return manifest;
}

function norm(path) {
  const clean = String(path || '').split('?')[0];
  return clean.startsWith('/api') ? clean.slice(4) || '/' : clean;
}

function withOfflineMeta(payload, extra = {}) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    payload.__offline = true;
    payload.meta = {
      ...(payload.meta || {}),
      source: 'offline',
      generated_at: manifest && manifest.generated_at,
      trade_date: manifest && manifest.trade_date,
      ...extra,
    };
  }
  return payload;
}

function offlineError(message) {
  const err = new Error(message);
  err.offline = true;
  return err;
}

function nearestDate(dates, date) {
  if (!dates || !dates.length) return null;
  if (!date) return dates[dates.length - 1];
  if (dates.includes(date)) return date;
  const before = dates.filter((d) => d < date);
  return before.length ? before[before.length - 1] : dates[0];
}

/** 离线请求：按接口路径从静态导出包取数（返回与在线 API 一致的字段结构）。 */
export async function offlineRequest(path, params = {}) {
  const p = norm(path);
  const q = params || {};

  if (p === '/meta') return withOfflineMeta(await loadJson('meta.json'));
  if (p === '/market/overview') return withOfflineMeta(await loadJson('market/overview.json'));
  if (p === '/market/indices') return withOfflineMeta(await loadJson('market/indices.json'));

  if (p === '/market/index') {
    const alias = q.alias || '1A0001';
    const payload = await loadJson(`market/index/${alias}.json`);
    const days = Math.max(1, Number(q.days) || payload.bars.length);
    return withOfflineMeta({ ...payload, bars: (payload.bars || []).slice(-days) });
  }

  if (p === '/market/breadth') {
    const payload = await loadJson('market/breadth.json');
    const days = Math.max(1, Number(q.days) || 30);
    return withOfflineMeta({ ...payload, items: (payload.items || []).slice(-days) });
  }

  if (p === '/market/day') {
    const date = q.date;
    try {
      return withOfflineMeta(await loadJson(`market/day/${date}.json`));
    } catch (_err) {
      return withOfflineMeta({ date: date || null, exists: false, breadth: {},
        market_amount: null, index: {} },
      { offline_missing: '该日期未包含在离线导出包中' });
    }
  }

  if (p === '/market/top-amount') {
    const payload = await loadJson('market/top-amount.json');
    const date = q.date;
    const byDate = payload.byDate || {};
    const dates = Object.keys(byDate).sort();
    const useDate = nearestDate(dates, date);
    const items = (byDate[useDate] || payload.latest?.items || [])
      .slice(0, Number(q.limit) || 10);
    return withOfflineMeta({ date: useDate, items });
  }

  if (p === '/market/stock') {
    const payload = await loadJson('stocks.json');
    const bars = payload[q.symbol];
    if (!bars) {
      throw offlineError(`离线包未包含个股 ${q.symbol} 的 K 线（导出时仅包含目标股/逐笔/成分股涉及的标的）`);
    }
    let list = Array.isArray(bars.bars) ? bars.bars : [];
    if (q.start && q.end) {
      const end = String(q.end);
      let et = end;
      if (Number(q.extend) > 0) et = null;      // 区间模式：离线包末尾即导出日，直接取到末尾
      list = list.filter((b) => b.date >= String(q.start) && (!et || b.date <= et));
      if (!et) list = list.slice(-(list.length));
    } else {
      list = list.slice(-(Math.max(1, Number(q.days) || 120)));
    }
    return withOfflineMeta({ ...bars, bars: list });
  }

  if (p === '/concepts/rank') {
    const payload = await loadJson('concepts/rank.json');
    const dates = Object.keys(payload.dates || {}).sort();
    const date = nearestDate(dates, q.date);
    const all = payload.dates?.[date] || [];
    const rawLimit = Number(q.limit);
    const allMode = !rawLimit || rawLimit <= 0;
    const limit = allMode ? all.length : Math.min(rawLimit, all.length);
    const top = all.slice(0, limit);
    const bottom = allMode
      ? [...all].reverse()
      : [...all].reverse().filter((row) => !top.some((t) => t.code === row.code)).slice(0, limit);
    return withOfflineMeta({
      date,
      requested_date: q.date || date,
      limit: allMode ? 'all' : limit,
      concept_count: all.length,
      top,
      bottom,
    });
  }

  if (p === '/policies' || p === '/policies/') {
    return withOfflineMeta(await loadJson('policies/list.json'));
  }

  if (p === '/policies/export-status') {
    throw offlineError('离线模式无导出接口');
  }

  const policyMatch = p.match(/^\/policies\/([^/]+)(\/.*)?$/);
  if (policyMatch) {
    const id = decodeURIComponent(policyMatch[1]);
    const rest = policyMatch[2] || '';
    if (rest === '/backtest/options') {
      const options = await loadJson('policies/options.json');
      if (!options[id]) throw offlineError(`离线包未包含策略 ${id} 的回测参数`);
      return withOfflineMeta(options[id]);
    }
    if (rest === '/backtest' || rest === '/test') {
      const backtests = await loadJson('policies/backtest.json');
      if (!backtests[id]) throw offlineError(`离线包未包含策略 ${id} 的回测结果`);
      return withOfflineMeta(backtests[id], { offline_note: '离线快照：默认参数回测结果' });
    }
    if (rest === '/refresh') {
      throw offlineError('离线模式不支持重算目标股（请在有后端的环境操作）');
    }
    if (!rest) {
      const details = await loadJson('policies/detail.json');
      if (!details[id]) throw offlineError(`离线包未包含策略 ${id}`);
      return withOfflineMeta(details[id]);
    }
  }

  // 概念详情：/concepts/{code}
  const conceptMatch = p.match(/^\/concepts\/([^/]+)$/);
  if (conceptMatch) {
    const code = decodeURIComponent(conceptMatch[1]);
    const details = await loadJson('concepts/detail.json');
    const item = details[code];
    if (!item) throw offlineError(`离线包未包含概念 ${code} 的详情`);
    const days = Math.max(1, Number(q.days) || 20);
    let history = (item.history || []).slice(-days);
    if (q.date && q.date !== item.date) {
      history = (item.history || []).filter((h) => h.date <= q.date).slice(-days);
    }
    return withOfflineMeta({ ...item, days, history,
      requested_date: q.date || item.date });
  }

  throw offlineError(`离线快照未覆盖接口：${p}`);
}
