/**
 * pages/market.js — 主看板（#/market）
 *
 * 区块：
 * ① 指数 K 线卡片：7 个指数切换 × 日K/周K/月K × 30/60/90/120/250（及自定义 1~250）
 *    - 后端只提供日线（GET /api/market/index?alias=&days=N），周K/月K 在前端聚合；
 *    - 摘要卡展示所选指数最后一根（日/周/月）K 线的 OHLC/chg/amount/vol；
 * ② 市场概览（上证收盘 / 涨跌家数 / 涨停跌停 / 全市场成交额）
 * ③ 近 30 日红绿家数（红柱正向、绿柱负向的发散柱状图）
 * ④ 成交额 TOP10 表格
 *
 * 每张卡片独立 loading / error / empty；接口失败自动降级到内置示例数据（api.js）。
 * 切指数 / 周期 / 根数只刷新指数卡片，其余卡片保持不动。
 */

import * as api from '../api.js';
import { buildStockKlineOption } from '../kline.js';
import * as ui from '../ui.js';

const MOCK_END = '2026-10-30';
const { CHART_COLORS } = ui;

/* ================================================================== */
/* 内置示例数据（后端 /api/market/* 未就绪时使用）                     */
/* ================================================================== */

/** 指数元数据：与 baostock default_index_list 对齐的 7 个指数（顺序即展示顺序） */
const MOCK_INDEX_CATALOG = [
  { alias: '1A0001', name: '上证指数', symbol: '000001', base: 3900, volBase: 4.0e8, amountBase: 8.0e11 },
  { alias: '399001', name: '深证成指', symbol: '399001', base: 12800, volBase: 5.0e8, amountBase: 1.1e12 },
  { alias: '000300', name: '沪深300', symbol: '000300', base: 4600, volBase: 3.5e8, amountBase: 9.0e11 },
  { alias: '399006', name: '创业板指', symbol: '399006', base: 2600, volBase: 2.5e8, amountBase: 6.0e11 },
  { alias: '000016', name: '上证50', symbol: '000016', base: 3150, volBase: 1.8e8, amountBase: 4.5e11 },
  { alias: '000905', name: '中证500', symbol: '000905', base: 5900, volBase: 2.2e8, amountBase: 5.0e11 },
  { alias: '399106', name: '深证综指', symbol: '399106', base: 2150, volBase: 3.0e8, amountBase: 6.5e11 },
];

/** 每个指数的模拟日线缓存：1600 根随机游走（支撑 250 周K / 月K 等根数演示） */
const mockDailyCache = new Map();

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < String(value).length; i += 1) {
    hash = (hash * 31 + String(value).charCodeAt(i)) >>> 0;
  }
  return hash || 1;
}

function mockDailyBars(alias) {
  if (mockDailyCache.has(alias)) return mockDailyCache.get(alias);
  const meta = MOCK_INDEX_CATALOG.find((item) => item.alias === alias) || MOCK_INDEX_CATALOG[0];
  const dates = ui.recentTradeDates(1600, MOCK_END);
  const rand = ui.seededRandom(hashString(meta.alias));
  let close = meta.base;
  const bars = dates.map((date) => {
    const open = close;
    const drift = (rand() - 0.495) * meta.base * 0.012;
    const next = Math.max(meta.base * 0.3, open + drift);
    const high = Math.max(open, next) + rand() * meta.base * 0.004;
    const low = Math.min(open, next) - rand() * meta.base * 0.004;
    const vol = Math.round(meta.volBase * (0.6 + rand() * 0.9));
    const amount = Math.round(meta.amountBase * (0.6 + rand() * 0.9));
    const chg = Number((((next - open) / open) * 100).toFixed(2));
    close = Number(next.toFixed(2));
    return {
      date,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      chg,
      vol,
      amount,
    };
  });
  mockDailyCache.set(alias, bars);
  return bars;
}

const MOCK_TOP_STOCKS = [
  ['300502', '新易盛', 196.0, -14.19, 21607604874.04, 1060301],
  ['002594', '比亚迪', 320.5, 2.31, 19230480000.0, 596000],
  ['300750', '宁德时代', 268.4, 1.12, 17420100000.0, 648900],
  ['601138', '工业富联', 72.3, 5.62, 15870200000.0, 2189000],
  ['000063', '中兴通讯', 41.2, -2.14, 14210000000.0, 3456000],
  ['688981', '中芯国际', 118.7, 3.05, 13760000000.0, 1163000],
  ['300308', '中际旭创', 178.9, -5.42, 12430000000.0, 698000],
  ['002050', '三花智控', 32.6, 4.18, 11890000000.0, 3621000],
  ['600519', '贵州茅台', 1520.0, -0.85, 11020000000.0, 72300],
  ['601899', '紫金矿业', 19.8, 1.65, 10560000000.0, 5312000],
];

function mockOverview() {
  const bars = mockDailyBars('1A0001').slice(-60);
  const last = bars[bars.length - 1];
  const rand = ui.seededRandom(777);
  const total = 5451;
  const breadth30 = bars.slice(-30).map((bar) => {
    const flat = Math.round(40 + rand() * 70);
    let red;
    if (bar.chg >= 0) red = Math.round(1900 + rand() * 2100);
    else red = Math.round(500 + rand() * 1100);
    const green = Math.max(0, total - red - flat);
    return {
      date: bar.date,
      red,
      green,
      flat,
      total: red + green + flat,
      limit_up: Math.round(18 + rand() * 60),
      limit_down: Math.round(10 + rand() * 55),
    };
  });
  const today = breadth30[breadth30.length - 1];
  return {
    meta: { date: last.date, generated_at: '2026-10-31T16:10:00+08:00', source: 'db', cached: true },
    trade_date: last.date,
    index: {
      alias: '1A0001',
      symbol: '000001',
      name: '上证指数',
      date: last.date,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      chg: last.chg,
      vol: last.vol,
      amount: last.amount,
      source: 'index-cache',
    },
    breadth: {
      red: today.red,
      green: today.green,
      flat: today.flat,
      total: today.total,
      limit_up: today.limit_up,
      limit_down: today.limit_down,
    },
    breadth_30d: breadth30,
    top_amount: MOCK_TOP_STOCKS.map(([symbol, name, close, chg, amount, vol], i) => ({
      rank: i + 1,
      symbol,
      name,
      open: Number((close * 0.985).toFixed(2)),
      high: Number((close * 1.02).toFixed(2)),
      low: Number((close * 0.975).toFixed(2)),
      close,
      chg,
      amount,
      vol,
    })),
    market_amount: 1580000000000.0,
  };
}

api.registerMock('/api/market/overview', mockOverview, '主看板概览');
// 注意：/api/market/indices 必须先于 /api/market/index 注册，且 index 用正则精确匹配，
// 否则 indices 会被 index 前缀匹配走。
api.registerMock('/api/market/indices', () => ({
  meta: { date: MOCK_END, generated_at: '2026-10-31T16:10:00+08:00', source: 'index-cache', cached: true },
  items: MOCK_INDEX_CATALOG.map((item) => ({
    alias: item.alias,
    name: item.name,
    symbol: item.symbol,
    bars: mockDailyBars(item.alias).length,
    last_date: MOCK_END,
    source: 'index-cache',
    hint: '',
  })),
}), '指数列表');
api.registerMock(/^\/api\/market\/index(?:\?|$)/, (ctx) => {
  const params = ctx.params || {};
  const alias = params.alias || '1A0001';
  const meta = MOCK_INDEX_CATALOG.find((item) => item.alias === alias) || MOCK_INDEX_CATALOG[0];
  const requested = Number(params.days);
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(6000, requested) : 60;
  const allBars = mockDailyBars(meta.alias);
  const bars = allBars.slice(Math.max(0, allBars.length - days));
  return {
    meta: { date: bars.length ? bars[bars.length - 1].date : MOCK_END, source: 'index-cache', cached: true },
    alias: meta.alias,
    index_code: meta.symbol,
    name: meta.name,
    source: 'index-cache',
    hint: '',
    bars,
  };
}, '指数日线');
api.registerMock(/^\/api\/market\/day(?:\?|$)/, (ctx) => {
  const params = ctx.params || {};
  const date = String(params.date || MOCK_END);
  const seed = [...date].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const total = 5300 + (seed % 130);
  const red = Math.round(total * (0.22 + (seed % 41) / 100));
  const green = total - red - (seed % 70);
  const flat = total - red - green;
  return {
    meta: { date, generated_at: `${date}T15:00:00`, source: 'mock', cached: false },
    date,
    exists: true,
    breadth: { red, green, flat, total,
               limit_up: 20 + (seed % 45), limit_down: 4 + (seed % 22) },
    market_amount: 1.05e12 + (seed % 500) * 1e9,
  };
}, '单交易日市场数据');
api.registerMock('/api/market/breadth', () => {
  const overview = mockOverview();
  return {
    meta: { date: overview.trade_date, source: 'db', cached: true },
    items: overview.breadth_30d,
  };
}, '红绿家数');
api.registerMock('/api/market/top-amount', () => {
  const overview = mockOverview();
  return {
    meta: { date: overview.trade_date, source: 'db', cached: true },
    date: overview.trade_date,
    items: overview.top_amount,
  };
}, '成交额 TOP10');

/* ================================================================== */
/* 小组件                                                              */
/* ================================================================== */

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kv(label, value, tone = '') {
  return ui.el(
    'div',
    { class: 'kv' },
    ui.el('div', { class: 'kv-label', text: label }),
    ui.el('div', { class: `kv-value ${tone}`.trim(), text: value }),
  );
}

/** 指数摘要成交额：>= 1 万亿时用「万亿」，避免周K/月K聚合大额被省略号截断 */
function fmtIndexAmount(value) {
  if (!ui.isNum(value)) return ui.EMPTY;
  const num = Number(value);
  if (Math.abs(num) >= 1e12) return `${(num / 1e12).toFixed(2)}万亿`;
  return ui.fmtAmount(num);
}

/** 指数摘要骨架（7 个 kv 占位） */
function summarySkeletonItems() {
  return Array.from({ length: 7 }, () =>
    ui.el(
      'div',
      { class: 'kv' },
      ui.el('div', { class: 'skeleton', style: { width: '42px', height: '10px' } }),
      ui.el('div', {
        class: 'skeleton',
        style: { width: '72px', height: '17px', marginTop: '5px' },
      }),
    ),
  );
}

function statSkeleton() {
  return ui.el(
    'div',
    { class: 'stat-card' },
    ui.el('div', { class: 'skeleton', style: { width: '52px', height: '10px' } }),
    ui.el('div', { class: 'skeleton', style: { width: '76%', height: '22px', marginTop: '7px' } }),
    ui.el('div', { class: 'skeleton', style: { width: '46%', height: '9px', marginTop: '6px' } }),
  );
}

/* ================================================================== */
/* 周期聚合 / 根数换算                                                 */
/* ================================================================== */

const PERIOD_LABEL = { day: '日K', week: '周K', month: '月K' };
const QUICK_COUNTS = [30, 60, 90, 120, 250];
const MAX_COUNT = 250;

/** ISO 周键：YYYY-Www（周一为周首，跨年按 ISO 周所属年份） */
function isoWeekKey(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7; // 1=周一 … 7=周日
  date.setUTCDate(date.getUTCDate() + 4 - weekday); // 移到本周周四
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** 周期分组键：周=ISO 周，月=自然月（YYYY-MM） */
function periodKey(dateStr, period) {
  return period === 'week' ? isoWeekKey(dateStr) : String(dateStr).slice(0, 7);
}

/**
 * 日线 → 周期 K 线聚合（后端只提供日线，周K/月K 在前端聚合）。
 *
 * 口径：
 * - 周K 按 ISO 周（周一~周日）分组；月K 按 YYYY-MM 分组；
 * - open = 组内第一根 open，high = 组内 max，low = 组内 min，close = 组内最后一根 close；
 * - vol / amount = 组内求和；
 * - chg = (close / 上一根周期收盘 - 1) * 100；首根用 (close - open) / open * 100；
 * - 周期 K 的 date 取组内最后一个交易日（用于 x 轴与摘要展示）。
 *
 * @param {Array} dailyBars 已按日期升序的日线
 * @param {'day'|'week'|'month'} period
 */
function aggregateBars(dailyBars, period) {
  if (period === 'day') return dailyBars.map((bar) => ({ ...bar }));

  const groups = new Map(); // key -> { bars, date }
  dailyBars.forEach((bar) => {
    const key = periodKey(bar.date, period);
    if (!groups.has(key)) groups.set(key, { bars: [], date: bar.date });
    const group = groups.get(key);
    group.bars.push(bar);
    group.date = bar.date; // 升序遍历，最后一次即组内最后交易日
  });

  const result = [];
  let prevClose = null;
  groups.forEach((group) => {
    const { bars } = group;
    const open = Number(bars[0].open);
    const close = Number(bars[bars.length - 1].close);
    let high = -Infinity;
    let low = Infinity;
    let vol = 0;
    let amount = 0;
    bars.forEach((bar) => {
      high = Math.max(high, Number(bar.high));
      low = Math.min(low, Number(bar.low));
      vol += Number(bar.vol) || 0;
      amount += Number(bar.amount) || 0;
    });
    const chg = prevClose
      ? Number(((close / prevClose - 1) * 100).toFixed(2))
      : Number((((close - open) / (open || 1)) * 100).toFixed(2));
    result.push({
      date: group.date,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      chg,
      vol,
      amount,
      days: bars.length,
    });
    prevClose = close;
  });
  return result;
}

/** 周期 → 需要请求的日线根数：日K=N；周K≈N*5+10；月K≈N*21+25（上限 6000） */
function fetchDaysFor(period, count) {
  if (period === 'week') return Math.min(6000, count * 5 + 10);
  if (period === 'month') return Math.min(6000, count * 21 + 25);
  return count;
}

/** 根数夹取到 1~250；返回 {value, clamped}，value=null 表示非法输入 */
function clampCount(raw) {
  if (raw === null || raw === undefined) return { value: null, clamped: false };
  const text = String(raw).trim();
  if (text === '') return { value: null, clamped: false };
  const num = Math.round(Number(text));
  if (!Number.isFinite(num)) return { value: null, clamped: false };
  const value = Math.min(MAX_COUNT, Math.max(1, num));
  return { value, clamped: value !== num };
}

/* ================================================================== */
/* 图表 option                                                         */
/* ================================================================== */

function buildKlineOption(bars, periodLabel = '日K', period = 'day') {
  const dates = bars.map((bar) => bar.date);
  const ohlc = bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]);
  const volumes = bars.map((bar) => ({
    value: bar.vol,
    itemStyle: { color: bar.chg >= 0 ? CHART_COLORS.up : CHART_COLORS.down, opacity: 0.62 },
  }));

  return {
    animationDuration: 420,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter(params) {
        if (!params || !params.length) return '';
        const index = params[0].dataIndex;
        const bar = bars[index];
        if (!bar) return '';
        const tone = bar.chg >= 0 ? CHART_COLORS.up : CHART_COLORS.down;
        return [
          `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(bar.date)}<span style="color:#6b7280;font-weight:400;margin-left:6px">${periodLabel}</span></div>`,
          bar.days && periodLabel !== '日K'
            ? `<div style="color:#9ca3af">周期内 ${bar.days} 个交易日</div>`
            : '',
          `<div>开盘 <b>${ui.fmtPrice(bar.open)}</b>　收盘 <b>${ui.fmtPrice(bar.close)}</b></div>`,
          `<div>最高 <b>${ui.fmtPrice(bar.high)}</b>　最低 <b>${ui.fmtPrice(bar.low)}</b></div>`,
          `<div>涨跌幅 <b style="color:${tone}">${ui.fmtPct(bar.chg)}</b></div>`,
          `<div>成交额 <b>${ui.fmtAmount(bar.amount)}</b></div>`,
          `<div>成交量 <b>${ui.fmtVol(bar.vol)}</b></div>`,
        ].join('');
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    legend: { show: false },
    grid: [
      { left: 50, right: 16, top: 16, height: '60%' },
      { left: 50, right: 16, top: '76%', height: '15%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: dates,
        boundaryGap: true,
        axisLabel: {
          // 周期不同，x 轴简写不同：日K=MM-DD；周K=YY-MM-DD；月K=YY-MM
          formatter: (value) => {
            const text = String(value);
            if (period === 'month') return text.slice(2, 7);
            if (period === 'week') return text.slice(2);
            return text.slice(5);
          },
        },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: dates,
        boundaryGap: true,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { show: false },
      },
    ],
    yAxis: [
      {
        scale: true,
        splitNumber: 4,
        axisLabel: { formatter: (value) => Number(value).toFixed(0) },
      },
      {
        gridIndex: 1,
        scale: true,
        splitNumber: 2,
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: ohlc,
        barMaxWidth: 11,
        itemStyle: {
          color: CHART_COLORS.up,
          color0: CHART_COLORS.down,
          borderColor: CHART_COLORS.up,
          borderColor0: CHART_COLORS.down,
        },
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes,
        barMaxWidth: 8,
        itemStyle: { borderRadius: [2, 2, 0, 0] },
      },
    ],
  };
}

function buildBreadthOption(items) {
  const dates = items.map((item) => String(item.date).slice(5));
  const red = items.map((item) => item.red);
  const green = items.map((item) => -item.green);
  return {
    animationDuration: 420,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter(params) {
        if (!params || !params.length) return '';
        const item = items[params[0].dataIndex];
        if (!item) return '';
        return [
          `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(item.date)}</div>`,
          `<div>红盘 <b style="color:${CHART_COLORS.up}">${item.red}</b>　绿盘 <b style="color:${CHART_COLORS.down}">${item.green}</b></div>`,
          `<div>平盘 <b>${item.flat}</b>　合计 <b>${item.total}</b></div>`,
          item.limit_up !== undefined
            ? `<div>涨停 <b style="color:${CHART_COLORS.up}">${item.limit_up}</b>　跌停 <b style="color:${CHART_COLORS.down}">${item.limit_down}</b></div>`
            : '',
        ].join('');
      },
    },
    legend: {
      top: 0,
      right: 0,
      data: ['红盘家数', '绿盘家数'],
      itemGap: 12,
    },
    grid: { left: 46, right: 12, top: 30, bottom: 24 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { interval: Math.max(0, Math.floor(dates.length / 10) - 1) },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value) => Math.abs(Number(value)) },
    },
    series: [
      {
        name: '红盘家数',
        type: 'bar',
        data: red,
        barMaxWidth: 12,
        itemStyle: { color: CHART_COLORS.up, borderRadius: [2, 2, 0, 0], opacity: 0.9 },
        z: 3,
      },
      {
        name: '绿盘家数',
        type: 'bar',
        data: green,
        barMaxWidth: 12,
        itemStyle: { color: CHART_COLORS.down, borderRadius: [0, 0, 2, 2], opacity: 0.9 },
        z: 3,
      },
    ],
  };
}

/* ================================================================== */
/* 页面                                                                */
/* ================================================================== */

function mount(root) {
  const page = {
    cleanup() {},
  };

  /* ---------- 指数卡片状态（切指数 / 周期 / 根数只刷新该卡片） ---------- */
  const indexState = {
    list: [],
    alias: '1A0001',
    period: 'day',
    count: 60,
    seq: 0,
    bars: [], // 当前渲染的 K 线（日K/周K/月K 聚合后），供悬停取 OHLC
  };

  /* ---------- 市场概览卡状态（悬停日K → 该交易日全市场数据） ---------- */
  const marketState = {
    latest: null, // 最新交易日全市场数据（来自 /api/market/overview）
    latestError: null,
    hoverIndex: null, // 悬停的 K 线 dataIndex（仅日K）
    hoverDate: null,
    hoverDay: null, // /api/market/day 返回
    hoverLoading: false,
    hoverError: null,
    latestBar: null, // 当前所选指数/周期的最后一根 K 线（未悬停时展示）
    pinDate: null, // 点击 K 线锁定的交易日（null = 未锁定）
    dayLoadingDate: null, // 正在加载全市场数据的日期
    dayErrorDate: null, // 加载失败的日期
    dayError: null,
    breadthDays: 0, // 红绿家数天数（跟随日K 根数）
    topTimer: null, // TOP10 刷新去抖
    dayCache: new Map(), // date -> day data（LRU）
    daySeq: 0,
  };
  const DAY_CACHE_LIMIT = 200;
  const TOP_CACHE_LIMIT = 80;
  const topCache = new Map(); // date|'latest' -> /api/market/top-amount 响应
  let indexSelectEl = null;
  let periodSeg = null;
  let countSeg = null;
  let customBtn = null;
  let customWrap = null;
  let customInput = null;

  /* ---------- 页头 ---------- */
  const indexCountBadge = ui.badge('指数 · 日/周/月K', 'primary');
  const hd = ui.el(
    'div',
    { class: 'page-hd' },
    ui.el(
      'div',
      {},
      ui.el('h1', { class: 'page-title', text: '主看板' }),
      ui.el('div', {
        class: 'page-sub',
        text: '7 个指数 · 日/周/月K · 30~250 根（周K/月K 由日线前端聚合） · 市场宽度 · 成交额 TOP10',
      }),
    ),
    ui.el('div', { class: 'page-hd-right' }, indexCountBadge),
  );
  root.append(hd);

  /* ---------- 行 1：指数 K 线 + 市场概览 ---------- */
  const row1 = ui.el('div', { class: 'grid grid-2-1' });

  const indexCard = ui.card({
    title: '指数 K 线',
    sub: '加载中…',
    bodyClass: 'is-flush',
  });
  const indexToolbar = ui.el(
    'div',
    {
      class: 'index-toolbar',
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 16px',
        padding: '0 4px 10px',
      },
    },
    ui.el('span', { class: 'dim', style: { fontSize: '12px' }, text: '指数列表加载中…' }),
  );
  const indexSummary = ui.el('div', { class: 'index-summary' }, ...summarySkeletonItems());
  const indexChartWrap = ui.el('div', { class: 'chart-pad' }, ui.skeletonBlock('382px'));
  const indexChartNote = ui.el('div', { class: 'chart-note' });
  indexCard.body.append(indexToolbar, indexSummary, indexChartWrap, indexChartNote);

  const overviewCard = ui.card({
    title: '市场概览',
    sub: '最新交易日红绿家数 / 涨跌停 / 全市场成交额',
    extra: ui.badge('加载中…', 'primary'),
  });
  const statGrid = ui.el('div', { class: 'stat-grid is-2col' });
  statGrid.append(...Array.from({ length: 6 }, () => statSkeleton()));
  overviewCard.body.append(statGrid);

  row1.append(indexCard.root, overviewCard.root);
  root.append(row1);

  /* ---------- 行 2：近 30 日红绿家数 ---------- */
  const breadthCard = ui.card({
    title: '红绿家数',
    sub: '红柱向上 = 上涨家数，绿柱向下 = 下跌家数（天数跟随日K 根数）',
    extra: ui.badge('加载中…', 'primary'),
  });
  breadthCard.body.append(ui.skeletonBlock('380px'));
  breadthCard.root.append(
    ui.el('div', {
      class: 'card-foot',
      text: '口径：daily_sample 按交易日聚合，红=chg>0、绿=chg<0、平=chg=0；涨停/跌停复用板块涨停判定。',
    }),
  );


  /* ---------- 行 3：成交额 TOP10 ---------- */
  const topCard = ui.card({
    title: '成交额 TOP10',
    sub: '成交额最大的 10 只个股（跟随悬停/锁定日期）',
    bodyClass: 'is-tight',
    extra: ui.badge('加载中…', 'primary'),
  });
  const topTable = ui.dataTable({
    // 与左侧红绿家数并排后卡片更高，10 行可完整展示（不再用 is-short 限制高度滚动）
    wrapClass: 'is-short-rows',
    emptyText: '暂无成交额数据',
    onRowClick: (row) => selectTopStock(row.symbol, row.name),
    columns: [
      { key: 'rank', title: '#', className: 'rank', width: 44 },
      { key: 'symbol', title: '代码', className: 'sym', width: 82 },
      { key: 'name', title: '名称', className: 'name', width: 100 },
      { key: 'close', title: '收盘', align: 'right', render: (row) => ui.fmtPrice(row.close) },
      { key: 'chg', title: '涨跌幅', align: 'right', render: (row) => ui.pctSpan(row.chg, 2) },
      { key: 'amount', title: '成交额(亿)', align: 'right', render: (row) => ui.fmtYi(row.amount) },
      { key: 'vol', title: '成交量(万手)', align: 'right', render: (row) => ui.fmtWanShou(row.vol) },
      {
        key: 'amplitude',
        title: '振幅',
        align: 'right',
        render: (row) => {
          if (!ui.isNum(row.high) || !ui.isNum(row.low) || !row.close) return ui.EMPTY;
          const amp = ((row.high - row.low) / row.close) * 100;
          return ui.el('span', { class: 'dim', text: `${amp.toFixed(2)}%` });
        },
      },
    ],
  });
  topCard.body.append(topTable.root);

  /* ---------- 下半部分：红绿家数 / 成交额 TOP10 左右布局（宽度不足时横向滚动） ---------- */
  const bottomRow = ui.el(
    'div',
    {
      class: 'bottom-row',
      // 内联兜底：避免旧 CSS 缓存导致「红绿家数 / 成交额 TOP10」退化为上下堆叠
      style: {
        display: 'grid',
        gridTemplateColumns: 'minmax(460px, 1.1fr) minmax(460px, 1fr)',
        gap: '16px',
        alignItems: 'stretch',
        overflowX: 'auto',
        overflowY: 'hidden',
        paddingBottom: '6px',
      },
    },
    breadthCard.root,
    topCard.root,
  );
  root.append(bottomRow);

  /* ---------- 行 4：个股日线 K 线（点击成交额 TOP10 个股；根数跟随「指数列表」选择） ---------- */
  const stockCard = ui.card({
    title: '个股日线 K 线',
    sub: '点击「成交额 TOP10」中的个股查看日线（根数跟随上方「指数列表」选择的天数）',
    extra: ui.badge('未选择', 'missing'),
  });
  const stockBody = ui.el('div', { class: 'chart-host' });
  stockBody.append(ui.emptyState('点击「成交额 TOP10」中的个股查看其日线 K 线',
    'K 线根数与「红绿家数」一致，跟随指数列表选择的天数'));
  stockCard.body.append(stockBody);
  root.append(stockCard.root);

  let stockChart = null;
  const stockState = { symbol: null, name: '', loading: false, error: null, seq: 0, data: null };

  function renderStockCard() {
    const hasStock = Boolean(stockState.symbol);
    stockCard.setTitle(hasStock
      ? `个股日线 K 线 · ${stockState.name || ''} ${stockState.symbol}`.replace(/\s+/g, ' ').trim()
      : '个股日线 K 线');
    if (!hasStock) {
      stockCard.setSub('点击「成交额 TOP10」中的个股查看日线（根数跟随上方「指数列表」选择的天数）');
      stockCard.setExtra(ui.badge('未选择', 'missing'));
      stockBody.replaceChildren(ui.emptyState('点击「成交额 TOP10」中的个股查看其日线 K 线',
        'K 线根数与「红绿家数」一致，跟随指数列表选择的天数'));
      if (stockChart) {
        stockChart.dispose();
        stockChart = null;
      }
      return;
    }
    stockCard.setExtra(ui.inlineGroup(
      ui.badge(`${indexState.count} 根`, 'primary'),
      ui.badge(`${stockState.symbol}`, 'missing'),
    ));
    if (stockState.loading) {
      stockCard.setSub(`加载中…（${indexState.count} 根，跟随指数列表天数）`);
      stockBody.replaceChildren(ui.loadingState('个股 K 线加载中…'));
      if (stockChart) {
        stockChart.dispose();
        stockChart = null;
      }
      return;
    }
    if (stockState.error) {
      stockCard.setSub('加载失败');
      stockBody.replaceChildren(ui.errorState(stockState.error,
        () => loadStockChart(stockState.symbol, stockState.name)));
      if (stockChart) {
        stockChart.dispose();
        stockChart = null;
      }
      return;
    }
    const bars = (stockState.data && stockState.data.bars) || [];
    if (!bars.length) {
      stockBody.replaceChildren(ui.emptyState('暂无该股 K 线数据'));
      return;
    }
    stockCard.setSub(`${bars[0].date} ~ ${bars[bars.length - 1].date} · ${bars.length} 根（跟随「指数列表」天数）`);
    const chartEl = ui.el('div', { class: 'chart chart-lg' });
    stockBody.replaceChildren(chartEl);
    if (stockChart) stockChart.dispose();
    stockChart = ui.createChart(chartEl, buildStockKlineOption(bars));
  }

  function selectTopStock(symbol, name) {
    if (!symbol) return;
    stockState.symbol = symbol;
    stockState.name = name || '';
    loadStockChart(symbol, name);
  }

  async function loadStockChart(symbol, name) {
    if (!symbol) return;
    const seq = ++stockState.seq;
    stockState.loading = true;
    stockState.error = null;
    stockState.data = null;
    renderStockCard();
    try {
      const data = await api.get('/api/market/stock', {
        params: { symbol, days: indexState.count },
        timeout: 30000,
      });
      if (!root.isConnected || seq !== stockState.seq) return;
      stockState.data = data;
      stockState.name = (data && data.name) || name || symbol;
    } catch (err) {
      if (seq !== stockState.seq) return;
      stockState.error = err;
    } finally {
      if (seq === stockState.seq) {
        stockState.loading = false;
        if (root.isConnected) renderStockCard();
      }
    }
  }

  topTable.setLoading();

  /* ---------- 市场概览卡：最新交易日 / 日K 悬停预览 / 点击锁定 ---------- */
  const clearPinBtn = ui.el('button', {
    type: 'button',
    class: 'btn btn-sm',
    text: '回到最新',
    title: '清除锁定，回到最新交易日',
    onclick: () => setPin(null),
  });

  async function loadOverview() {
    statGrid.replaceChildren(...Array.from({ length: 8 }, () => statSkeleton()));
    overviewCard.setExtra(ui.badge('加载中…', 'primary'));
    try {
      const overview = await api.get('/api/market/overview', { timeout: 12000 });
      if (!root.isConnected) return;
      marketState.latest = {
        trade_date: overview.trade_date || '',
        breadth: overview.breadth || {},
        market_amount: overview.market_amount,
        mock: Boolean(overview.__mock),
        fallbackIndex: overview.index || {},
      };
      marketState.latestError = null;
      renderOverview();
    } catch (err) {
      if (!root.isConnected) return;
      marketState.latestError = err;
      statGrid.replaceChildren(ui.errorState(err, loadOverview));
      overviewCard.setExtra(ui.badge('加载失败', 'error'));
    }
  }

  /** 当前查看日期：锁定日期 > 日K 悬停日期 > null（= 最新交易日） */
  function viewDate() {
    if (marketState.pinDate) return marketState.pinDate;
    if (indexState.period === 'day' && marketState.hoverDate) return marketState.hoverDate;
    return null;
  }

  /** 当前查看状态：锁定 / 悬停 / 最新 */
  function viewDateLabel() {
    if (marketState.pinDate) return '锁定';
    if (indexState.period === 'day' && marketState.hoverDate) return '悬停';
    return '最新';
  }

  /** 按日期取 K 线（找不到则回退最后一根） */
  function barForDate(date) {
    if (!date) return marketState.latestBar;
    const found = (indexState.bars || []).find((bar) => bar.date === date);
    return found || marketState.latestBar;
  }

  /** 某交易日的全市场数据视图 */
  function dayForDate(date) {
    if (!date) return { data: marketState.latest, loading: false, error: null };
    return {
      data: marketState.dayCache.get(date) || null,
      loading: marketState.dayLoadingDate === date,
      error: marketState.dayErrorDate === date ? marketState.dayError : null,
    };
  }

  async function loadDayFor(date) {
    if (!date || marketState.dayCache.has(date)) return;
    if (marketState.dayLoadingDate === date) return;
    marketState.dayLoadingDate = date;
    marketState.dayError = null;
    marketState.dayErrorDate = null;
    renderOverview();
    const seq = ++marketState.daySeq;
    try {
      const data = await api.get('/api/market/day', { params: { date }, timeout: 10000 });
      if (!root.isConnected || seq !== marketState.daySeq) return;
      marketState.dayCache.set(date, data);
      if (marketState.dayCache.size > DAY_CACHE_LIMIT) {
        const firstKey = marketState.dayCache.keys().next().value;
        marketState.dayCache.delete(firstKey);
      }
      marketState.dayLoadingDate = null;
      renderOverview();
    } catch (err) {
      if (seq !== marketState.daySeq) return;
      marketState.dayLoadingDate = null;
      marketState.dayError = err;
      marketState.dayErrorDate = date;
      renderOverview();
    }
  }

  /**
   * 渲染「市场概览」卡：
   * - 日K 悬停（未锁定）→ 预览该交易日；点击 K 线锁定后固定展示该交易日；
   * - 无悬停 / 无锁定 → 最新交易日（指数块取当前所选指数最后一根）。
   */
  function renderOverview() {
    const period = indexState.period;
    const label = PERIOD_LABEL[period];
    const meta = currentIndexMeta();
    const date = viewDate();
    const bar = barForDate(date);
    const view = dayForDate(date);
    const day = view.data;
    const loading = view.loading;
    const failed = view.error;
    const breadth = (day && day.breadth) || {};
    const total = breadth.total
      || (breadth.red || 0) + (breadth.green || 0) + (breadth.flat || 0);
    const pctOf = (value) => (total ? `占比 ${((value / total) * 100).toFixed(1)}%` : '');
    const dateText = date
      || (marketState.latest && marketState.latest.trade_date)
      || (bar && bar.date) || '';
    const noData = !loading && !failed && day && day.exists === false;
    const amp = bar && ui.isNum(bar.high) && ui.isNum(bar.low) && bar.close
      ? `${(((bar.high - bar.low) / bar.close) * 100).toFixed(2)}%`
      : '—';
    const dash = (value) => (loading ? '…' : value);
    const marketSub = loading
      ? '加载中…'
      : (failed ? '全市场数据获取失败' : (noData ? '该日无行情' : ''));

    statGrid.replaceChildren(
      ui.statCard({
        label: `${meta.name} 收盘`,
        value: ui.fmtPrice(bar && bar.close),
        sub: bar ? `涨跌 ${ui.fmtPct(bar.chg)} · ${bar.date}` : '—',
        tone: ui.chgClass(bar && bar.chg),
      }).root,
      ui.statCard({
        label: `${label}开盘 / 最高`,
        value: ui.fmtPrice(bar && bar.open),
        sub: `最高 ${ui.fmtPrice(bar && bar.high)}`,
      }).root,
      ui.statCard({
        label: `${label}最低 / 振幅`,
        value: ui.fmtPrice(bar && bar.low),
        sub: `振幅 ${amp}`,
      }).root,
      ui.statCard({
        label: '指数成交额',
        value: bar ? fmtIndexAmount(bar.amount) : '—',
        sub: `成交量 ${bar ? ui.fmtVol(bar.vol) : '—'}`,
      }).root,
      ui.statCard({
        label: '上涨家数',
        value: dash(ui.fmtInt(breadth.red)),
        sub: loading ? '' : pctOf(breadth.red || 0),
        tone: 'up',
      }).root,
      ui.statCard({
        label: '下跌家数',
        value: dash(ui.fmtInt(breadth.green)),
        sub: loading ? '' : pctOf(breadth.green || 0),
        tone: 'down',
      }).root,
      // 涨停 / 跌停：同一行、同字号、红绿分色（用户 2026-11-01 明确要求）
      ui.el(
        'div',
        { class: 'stat-card' },
        ui.el('div', { class: 'stat-label', text: '涨停 / 跌停' }),
        ui.el(
          'div',
          {
            class: 'stat-value is-pair',
            style: { display: 'inline-flex', alignItems: 'baseline', gap: '2px' },
          },
          ui.el('span', { class: 'up', text: dash(ui.fmtInt(breadth.limit_up)) }),
          ui.el('span', { class: 'stat-sep', text: '/' }),
          ui.el('span', { class: 'down', text: dash(ui.fmtInt(breadth.limit_down)) }),
        ),
        ui.el('div', { class: 'stat-sub', text: loading ? '' : '红=涨停 绿=跌停' }),
      ),
      ui.statCard({
        label: '全市场成交额',
        value: loading ? '…' : (day ? ui.fmtAmount(day.market_amount) : '—'),
        sub: [dateText, marketSub].filter(Boolean).join(' · ') || '—',
      }).root,
    );

    overviewCard.setSub(
      date
        ? `${viewDateLabel()} ${date} · 该交易日数据（${meta.name}）`
        : `最新交易日 ${dateText || '—'} · ${meta.name}（${label}${
          period === 'day' ? '，悬停日K预览 / 点击锁定' : '，逐日选择仅日K可用'
        }）`,
    );
    overviewCard.setExtra(ui.inlineGroup(
      ui.badge(`${dateText || '—'} ${viewDateLabel()}`,
        marketState.pinDate ? 'warn' : (date ? 'primary' : 'stale')),
      marketState.pinDate ? clearPinBtn : null,
      marketState.latest && marketState.latest.mock ? ui.badge('示例', 'warn') : null,
    ));
  }

  /** 清空悬停状态并取消在途请求（不触发渲染） */
  function resetHoverState() {
    marketState.hoverIndex = null;
    marketState.hoverDate = null;
    marketState.dayLoadingDate = null;
    marketState.dayError = null;
    marketState.dayErrorDate = null;
    marketState.daySeq += 1;
  }

  /** 切指数 / 周期 / 根数：清空悬停与锁定 */
  function resetSelection() {
    resetHoverState();
    marketState.pinDate = null;
  }

  /** 鼠标离开图表 → 回到「最新交易日」视图（已锁定时不生效） */
  function leaveHover() {
    if (marketState.pinDate) return;
    if (marketState.hoverIndex === null) return;
    resetHoverState();
    renderOverview();
    refreshTopAmount(null);
  }

  /** 锁定 / 解锁某交易日（点击 K 线触发；再次点击同一天解锁） */
  function setPin(date) {
    marketState.pinDate = date || null;
    resetHoverState();
    if (marketState.pinDate) loadDayFor(marketState.pinDate);
    renderOverview();
    refreshTopAmount(marketState.pinDate);
  }

  /** 悬停某根日K：概览即时预览，TOP10 联动（已锁定时不跟随） */
  function handleKlineHover(idx) {
    if (marketState.pinDate) return;
    if (marketState.hoverIndex === idx) return;
    const bar = indexState.bars[idx];
    if (!bar || !bar.date) return;
    marketState.hoverIndex = idx;
    marketState.hoverDate = bar.date;
    renderOverview();
    loadDayFor(bar.date);
    refreshTopAmount(bar.date);
  }

  /** ZRender 像素坐标 → 类目索引（悬停与点击共用） */
  function pickKlineIndex(chart, offsetX, offsetY) {
    if (!chart) return null;
    const point = [offsetX, offsetY];
    let inside = false;
    try {
      inside = chart.containPixel({ gridIndex: 0 }, point)
        || chart.containPixel({ gridIndex: 1 }, point);
    } catch (_err) {
      inside = true;
    }
    if (!inside) return null;
    try {
      const raw = chart.convertFromPixel({ xAxisIndex: 0 }, point[0]);
      const idx = Math.round(Number(raw));
      if (!Number.isFinite(idx) || idx < 0 || idx >= indexState.bars.length) return null;
      return idx;
    } catch (_err) {
      return null;
    }
  }

  /** 给 K 线图绑定悬停预览 + 点击锁定（ZRender 事件，点/移到任意位置都能定位到类目） */
  function bindKlineInteractions(chartHandle) {
    const chart = chartHandle && chartHandle.chart ? chartHandle.chart : chartHandle;
    const zr = chart && chart.getZr && chart.getZr();
    if (!zr) return;
    zr.on('mousemove', (event) => {
      if (indexState.period !== 'day') return; // 周K / 月K 不逐日选择
      const idx = pickKlineIndex(chart, event.offsetX, event.offsetY);
      if (idx === null) return;
      handleKlineHover(idx);
    });
    zr.on('globalout', () => leaveHover());
    zr.on('click', (event) => {
      if (indexState.period !== 'day') {
        ui.toast('逐日选择仅日K可用', 'warn');
        return;
      }
      const idx = pickKlineIndex(chart, event.offsetX, event.offsetY);
      if (idx === null) return;
      const bar = indexState.bars[idx];
      if (!bar || !bar.date) return;
      // 点击同一天 = 解除锁定；点其它 K 线 = 改锁到新日期
      setPin(marketState.pinDate === bar.date ? null : bar.date);
    });
  }

  /** 成交额 TOP10 联动（悬停/锁定日期变化时刷新，120ms 去抖） */
  function refreshTopAmount(date) {
    if (marketState.topTimer) {
      clearTimeout(marketState.topTimer);
      marketState.topTimer = null;
    }
    marketState.topTimer = setTimeout(() => {
      marketState.topTimer = null;
      loadTopAmount(date || null);
    }, 120);
  }

  /* ================================================================== */
  /* 指数 K 线：指数列表 / 周期 / 根数 控件 + 数据加载                   */
  /* ================================================================== */

  let klineChart = null;

  function currentIndexMeta() {
    return (
      indexState.list.find((item) => item.alias === indexState.alias) || {
        alias: indexState.alias,
        name: indexState.alias === '1A0001' ? '上证指数' : indexState.alias,
        symbol: '',
        source: '',
      }
    );
  }

  function toolbarGroup(labelText, ...nodes) {
    return ui.el(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
      ui.el('span', { style: { fontSize: '11px', color: 'var(--text-mute)' }, text: labelText }),
      ...nodes,
    );
  }

  /** 应用根数（1~250 夹取，越界/非法 toast 提示） */
  function applyCount(raw, { fromCustom = false, silent = false } = {}) {
    const { value, clamped } = clampCount(raw);
    if (value === null) {
      if (!silent) ui.toast('请输入 1~250 的整数根数', 'warn');
      return false;
    }
    if (clamped && !silent) ui.toast(`根数已调整为 ${value}（允许范围 1~250）`, 'warn');
    indexState.count = value;
    if (countSeg) countSeg.setActive(QUICK_COUNTS.includes(value) ? value : '__custom__');
    if (customBtn) customBtn.classList.toggle('is-active', !QUICK_COUNTS.includes(value));
    if (customInput) customInput.value = String(value);
    if (fromCustom && customWrap) customWrap.classList.add('is-hidden');
    return true;
  }

  /** 根数自定义输入框（默认隐藏，点「自定义」展开） */
  function buildCustomCountWrap() {
    customInput = ui.el('input', {
      type: 'number',
      min: '1',
      max: '250',
      step: '1',
      value: String(indexState.count),
      class: 'index-count-input',
      title: '自定义根数（1~250，回车生效）',
      style: {
        width: '74px',
        height: '26px',
        background: '#0f1522',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: '7px',
        padding: '0 7px',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
      },
      onkeydown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyCustomCount();
        } else if (event.key === 'Escape') {
          customWrap.classList.add('is-hidden');
        }
      },
    });
    const confirmBtn = ui.el('button', {
      type: 'button',
      class: 'btn btn-sm',
      text: '应用',
      onclick: () => applyCustomCount(),
    });
    customWrap = ui.el(
      'span',
      {
        class: 'index-count-custom is-hidden',
        style: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
      },
      customInput,
      confirmBtn,
    );
    return customWrap;
  }

  function applyCustomCount() {
    if (!applyCount(customInput ? customInput.value : indexState.count, { fromCustom: true })) return;
    loadIndexSeries();
  }

  function renderIndexToolbar() {
    indexSelectEl = ui.el('select', {
      class: 'index-select',
      title: '选择指数（7 个）',
      style: {
        height: '28px',
        minWidth: '172px',
        background: '#151d2e',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '0 8px',
        fontSize: '12.5px',
        cursor: 'pointer',
      },
      onchange: (event) => {
        indexState.alias = event.target.value;
        loadIndexSeries();
      },
    });
    indexState.list.forEach((item) => {
      indexSelectEl.append(
        ui.el('option', {
          value: item.alias,
          text: `${item.name}（${item.alias}）`,
          selected: item.alias === indexState.alias,
        }),
      );
    });

    periodSeg = ui.segControl(
      [
        { value: 'day', label: '日K' },
        { value: 'week', label: '周K' },
        { value: 'month', label: '月K' },
      ],
      indexState.period,
      (value) => {
        indexState.period = value;
        loadIndexSeries();
      },
    );

    countSeg = ui.segControl(
      QUICK_COUNTS.map((value) => ({ value, label: String(value) })),
      QUICK_COUNTS.includes(indexState.count) ? indexState.count : null,
      (value) => {
        if (applyCount(Number(value), { silent: true })) loadIndexSeries();
      },
    );

    customBtn = ui.el('button', {
      type: 'button',
      class: `btn btn-sm${QUICK_COUNTS.includes(indexState.count) ? '' : ' is-active'}`,
      text: '自定义',
      title: '自定义根数（1~250）',
      onclick: () => {
        const willShow = customWrap.classList.contains('is-hidden');
        customWrap.classList.toggle('is-hidden', !willShow);
        if (willShow) {
          customInput.value = String(indexState.count);
          customInput.focus();
          customInput.select && customInput.select();
        }
      },
    });

    const customWrapEl = buildCustomCountWrap();

    indexToolbar.replaceChildren(
      toolbarGroup('指数', indexSelectEl),
      toolbarGroup('周期', periodSeg.root),
      toolbarGroup('根数', countSeg.root, customBtn, customWrapEl),
    );
  }

  /** 指数列表：GET /api/market/indices（顺序即展示顺序） */
  async function loadIndexList() {
    indexToolbar.replaceChildren(
      ui.el('span', { class: 'dim', style: { fontSize: '12px' }, text: '指数列表加载中…' }),
    );
    try {
      const data = await api.get('/api/market/indices', { timeout: 15000 });
      if (!root.isConnected) return;
      const items = Array.isArray(data.items) ? data.items.filter((item) => item && item.alias) : [];
      if (!items.length) throw new Error('指数列表为空（/api/market/indices 返回 0 条）');
      indexState.list = items;
      if (!items.some((item) => item.alias === indexState.alias)) {
        indexState.alias = items[0].alias;
      }
      indexCountBadge.textContent = `${items.length} 个指数 · 日/周/月K`;
      renderIndexToolbar();
      loadIndexSeries();
    } catch (err) {
      if (!root.isConnected) return;
      indexToolbar.replaceChildren(
        ui.el('span', {
          class: 'dim',
          style: { fontSize: '12px' },
          text: `指数列表加载失败：${err.detail || err.message}`,
        }),
        ui.el('button', { type: 'button', class: 'btn btn-sm', text: '重试', onclick: () => loadIndexList() }),
      );
      indexSummary.replaceChildren(...summarySkeletonItems());
      indexChartWrap.replaceChildren(ui.errorState(err, loadIndexList));
      indexCard.setTitle('指数 K 线');
      indexCard.setSub('指数列表获取失败');
      indexCard.setExtra(ui.badge('加载失败', 'error'));
    }
  }

  /** 渲染指数摘要（所选指数「最后一根」K 线，周/月为聚合值） */
  function renderIndexSummary(bar, meta, period) {
    const label = PERIOD_LABEL[period];
    indexSummary.replaceChildren(
      kv(`${label}开盘`, ui.fmtPrice(bar.open)),
      kv(`${label}最高`, ui.fmtPrice(bar.high)),
      kv(`${label}最低`, ui.fmtPrice(bar.low)),
      kv(`${label}收盘`, ui.fmtPrice(bar.close), ui.chgClass(bar.chg)),
      kv('涨跌幅', ui.fmtPct(bar.chg), ui.chgClass(bar.chg)),
      kv('成交额', fmtIndexAmount(bar.amount)),
      kv('成交量', ui.fmtVol(bar.vol)),
    );
  }

  /** 更新标题 / 副标题 / 徽章 / 聚合口径说明 */
  function updateIndexHeader(meta, period, count, bars, source, hint, isMock, freshness = null) {
    const last = bars[bars.length - 1];
    const actual = bars.length;
    const label = PERIOD_LABEL[period];
    indexCard.setTitle(`${meta.name} ${meta.alias} · ${label} ${count} 根`);

    const parts = [`数据日期 ${last.date}`, `来源 ${source || '—'}`];
    if (period !== 'day') {
      parts.push(`${label}由日线聚合`);
    }
    if (actual < count) {
      parts.push(`仅 ${actual} 根（缓存上限）`);
    }
    if (hint) parts.push(hint);
    if (freshness && freshness.stale) {
      parts.push(`指数缓存 ${freshness.cached_date || '—'}，未更新至 ${freshness.expected_date || '—'}`);
    }
    indexCard.setSub(parts.join(' · '));

    const extras = [
      ui.badge(`${meta.name} ${meta.alias}`, 'primary'),
      ui.badge(label, 'primary'),
      ui.badge(`${actual}/${count} 根`, actual < count ? 'stale' : 'missing'),
    ];
    if (isMock) extras.push(ui.badge('示例', 'warn'));
    if (source === 'missing' || source === 'stale') {
      extras.push(ui.badge(`来源 ${source}`, 'stale'));
    }
    if (freshness && freshness.stale) {
      extras.push(ui.badge('指数缓存落后', 'warn', {
        title: freshness.last_error
          ? `自动补拉失败：${freshness.last_error}`
          : '后台正在自动增量补拉（baostock）',
      }));
    }
    indexCard.setExtra(ui.inlineGroup(...extras));

    indexChartNote.textContent =
      period === 'day'
        ? '数据口径：日K 直接来自指数日线缓存；成交量单位「手」，成交额单位「元」。'
        : `${label}聚合口径：${
            period === 'week' ? '按 ISO 周（周一~周日）' : '按自然月（YYYY-MM）'
          }分组；开=组内首根开、高/低=区间极值、收=组内末根收、量/额=求和，涨跌幅相对上一根${label}收盘。`;
  }

  /** 按当前指数/周期/根数加载日线并在前端聚合 */
  async function loadIndexSeries() {
    const meta = currentIndexMeta();
    const period = indexState.period;
    const count = indexState.count;
    const seq = ++indexState.seq;
    const fetchDays = fetchDaysFor(period, count);

    indexCard.setTitle(`${meta.name} ${meta.alias} · ${PERIOD_LABEL[period]} ${count} 根`);
    indexCard.setSub('加载中…');
    indexSummary.replaceChildren(...summarySkeletonItems());
    indexChartWrap.replaceChildren(ui.skeletonBlock('382px'));
    indexChartNote.textContent = '';

    try {
      const data = await api.get('/api/market/index', {
        params: { alias: indexState.alias, days: fetchDays, refresh: 0 },
        timeout: 30000,
      });
      if (!root.isConnected || seq !== indexState.seq) return;

      const dailyBars = Array.isArray(data.bars)
        ? [...data.bars].sort((a, b) => String(a.date).localeCompare(String(b.date)))
        : [];
      const source = data.source || meta.source || 'unknown';
      const hint = data.hint || '';

      if (!dailyBars.length) {
        const emptyHint = hint || '运行 `python -m qu_web.cli fetch-index` 拉取指数日线缓存';
        indexSummary.replaceChildren(ui.emptyState('指数缓存缺失', emptyHint));
        indexChartWrap.replaceChildren(ui.emptyState('暂无指数 K 线数据', emptyHint));
        indexCard.setSub(`来源 ${source}${hint ? ` · ${hint}` : ''}`);
        indexCard.setExtra(
          ui.inlineGroup(
            ui.badge(`${meta.name} ${meta.alias}`, 'primary'),
            ui.badge(PERIOD_LABEL[period], 'primary'),
            ui.badge(source === 'missing' ? '缓存缺失' : source, 'stale'),
          ),
        );
        return;
      }

      const aggregated = aggregateBars(dailyBars, period);
      const bars = aggregated.slice(-count);
      if (!bars.length) {
        indexSummary.replaceChildren(ui.emptyState('暂无可用 K 线'));
        indexChartWrap.replaceChildren(ui.emptyState('暂无可用 K 线', '聚合结果为空'));
        return;
      }

      updateIndexHeader(meta, period, count, bars, source, hint,
        Boolean(data.__mock), data.freshness || null);
      renderIndexSummary(bars[bars.length - 1], meta, period);

      const chartEl = ui.el('div', { class: 'chart chart-lg index-kline-chart' });
      indexChartWrap.replaceChildren(chartEl);
      if (klineChart) klineChart.dispose();
      klineChart = ui.createChart(chartEl, buildKlineOption(bars, PERIOD_LABEL[period], period));
      // 供「市场概览」悬停取 OHLC：记录当前 bars 与最后一根（切指数/周期/根数时重置悬停）
      indexState.bars = bars;
      marketState.latestBar = bars[bars.length - 1];
      resetSelection(); // 切指数/周期/根数：清空悬停与锁定
      // 红绿家数天数跟随日K 根数（30/60/90/120/250/自定义）；周K/月K 保持上次天数
      if (period === 'day' && marketState.breadthDays !== count) {
        loadBreadth(count);
      }
      bindKlineInteractions(klineChart);
      renderOverview();
      refreshTopAmount(viewDate());
      // 个股 K 线根数跟随「指数列表」选择的天数：已选中个股则按新根数重载
      if (stockState.symbol) loadStockChart(stockState.symbol, stockState.name);
    } catch (err) {
      if (!root.isConnected || seq !== indexState.seq) return;
      indexSummary.replaceChildren(ui.emptyState('指数数据加载失败', err.detail || err.message));
      indexChartWrap.replaceChildren(ui.errorState(err, loadIndexSeries));
      indexChartNote.textContent = '';
      indexCard.setSub('加载失败');
      indexCard.setExtra(ui.badge('加载失败', 'error'));
    }
  }

  /* ---------- 数据加载：红绿家数 ---------- */
  let breadthChartInstance = null;
  /* ---------- 数据加载：红绿家数（天数跟随日K 根数） ---------- */
  async function loadBreadth(days) {
    const requested = Number(days);
    const useDays = Math.max(1, Math.min(250,
      Number.isFinite(requested) && requested > 0 ? Math.round(requested)
        : (marketState.breadthDays || indexState.count || 30)));
    marketState.breadthDays = useDays;
    breadthCard.setTitle(`近 ${useDays} 日红绿家数`);
    breadthCard.setSub(`红柱向上 = 上涨家数，绿柱向下 = 下跌家数（跟随日K 根数 ${useDays}）`);
    breadthCard.body.replaceChildren(ui.skeletonBlock('380px'));
    breadthCard.setExtra(ui.badge('加载中…', 'primary'));
    try {
      const data = await api.get('/api/market/breadth', { params: { days: useDays }, timeout: 15000 });
      if (!root.isConnected) return;
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        breadthCard.body.replaceChildren(ui.emptyState('暂无红绿家数数据'));
        breadthCard.setExtra(ui.badge('暂无数据', 'empty'));
        return;
      }
      const today = items[items.length - 1];
      breadthCard.setExtra(
        ui.inlineGroup(
          ui.badge(`红 ${ui.fmtInt(today.red)}`, 'up'),
          ui.badge(`绿 ${ui.fmtInt(today.green)}`, 'down'),
          ui.badge(`涨停 ${ui.fmtInt(today.limit_up)} / 跌停 ${ui.fmtInt(today.limit_down)}`, 'missing'),
          ui.badge(`${items.length} 日`, 'primary'),
          ui.badge(today.date || '—', 'primary'),
        ),
      );
      const chartEl = ui.el('div', { class: 'chart chart-lg' });
      breadthCard.body.replaceChildren(chartEl);
      if (breadthChartInstance) breadthChartInstance.dispose();
      breadthChartInstance = ui.createChart(chartEl, buildBreadthOption(items));
    } catch (err) {
      if (!root.isConnected) return;
      breadthCard.body.replaceChildren(ui.errorState(err, () => loadBreadth(useDays)));
      breadthCard.setExtra(ui.badge('加载失败', 'error'));
    }
  }

  /* ---------- 数据加载：成交额 TOP10（跟随悬停/锁定日期） ---------- */
  async function loadTopAmount(date) {
    const target = date || null;
    const cacheKey = target || 'latest';
    topTable.setLoading();
    topCard.setExtra(ui.badge('加载中…', 'primary'));
    topCard.setSub(target
      ? `${target} 成交额最大的 10 只个股`
      : '最新交易日成交额最大的 10 只个股');
    try {
      let data = topCache.get(cacheKey);
      if (!data) {
        data = await api.get('/api/market/top-amount', {
          params: target ? { date: target, limit: 10 } : { limit: 10 },
          timeout: 12000,
        });
        if (!root.isConnected) return;
        topCache.set(cacheKey, data);
        if (topCache.size > TOP_CACHE_LIMIT) {
          topCache.delete(topCache.keys().next().value);
        }
      }
      if (!root.isConnected) return;
      const items = Array.isArray(data.items) ? data.items : [];
      const mark = target ? (marketState.pinDate ? '锁定' : '悬停') : '最新';
      topTable.setRows(items);
      topCard.setSub(`${data.date || '—'}（${mark}）成交额最大的 ${items.length} 只个股`);
      topCard.setExtra(
        ui.inlineGroup(
          ui.badge(`${data.date || '—'} ${mark}`,
            marketState.pinDate ? 'warn' : (target ? 'primary' : 'stale')),
          ui.badge(`${items.length} 只`, 'missing'),
        ),
      );
    } catch (err) {
      if (!root.isConnected) return;
      topTable.setError(err, () => loadTopAmount(target));
      topCard.setExtra(ui.badge('加载失败', 'error'));
    }
  }

  page.cleanup = () => {
    if (stockChart) {
      stockChart.dispose();
      stockChart = null;
    }
    if (klineChart) {
      klineChart.dispose();
      klineChart = null;
    }
    if (breadthChartInstance) {
      breadthChartInstance.dispose();
      breadthChartInstance = null;
    }
  };

  // 并发加载，各卡片互不阻塞；指数卡片先取列表再取日线
  loadOverview();
  loadIndexList();
  loadBreadth(indexState.count); // 初始按日K 根数（默认 60）
  loadTopAmount();

  return page.cleanup;
}

export default { id: 'market', title: '主看板', mount };
