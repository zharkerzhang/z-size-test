/**
 * pages/policy.js — 策略看板（#/policy）
 *
 * 2026-11-01 需求调整：
 * - 策略数量/顺序完全由 GET /api/policies 的 items 决定（当前 5 个，前端不硬编码）；
 * - 卡片展开区只放「规则摘要 + 目标股列表」（目标股 = 最近交易日 14:57~15:00 target() 实时选股）；
 * - 独立的整行宽「BT 回测」面板位于卡片网格下方，标题 BT 回测 · {当前策略名}，
 *   副标题展示 区间 st ~ et 并注明 et = 最近交易日的前一交易日（回测必须有卖出日数据）；
 * - BT 面板内容：20/40/60 日窗口切换 + 指标卡（含信号日数）+ 净值曲线 + 逐笔收益柱图 + 逐笔明细；
 * - 指标口径：equity / cum_per 按「买入日等权组合复利」；metrics.sum_per 为 BT 引擎自身口径，作次要展示；
 * - BT 不可用（missing_data / unsupported）时展示中性的「暂无回测」样式 + 后端 error/status_text。
 *
 * 接口：GET /api/policies、GET /api/policies/{id}/backtest?days=N、
 *       POST /api/policies/{id}/refresh?days=N（契约见 ARCH.md §4.4）。
 */

import * as api from '../api.js';
import { buildStockKlineOption } from '../kline.js';
import * as ui from '../ui.js';

const STOCK_DAY_PRESETS = [30, 60, 90, 120, 250];
const MAX_STOCK_DAYS = 250;

const MOCK_END = '2026-10-30';
const BT_DAYS = [20, 40, 60];
const { CHART_COLORS } = ui;

/* ================================================================== */
/* 内置示例数据（接口未就绪 / ?mock=1 时展示）                        */
/* ================================================================== */

const MOCK_TRADE_STOCKS = [
  ['300502', '新易盛'], ['002594', '比亚迪'], ['300750', '宁德时代'], ['601138', '工业富联'],
  ['000063', '中兴通讯'], ['688981', '中芯国际'], ['300308', '中际旭创'], ['002050', '三花智控'],
  ['601899', '紫金矿业'], ['600519', '贵州茅台'], ['300059', '东方财富'], ['002415', '海康威视'],
];

function target(symbol, name, close, chg, amount, vol) {
  return {
    symbol,
    name,
    open: Number((close * 0.985).toFixed(2)),
    high: Number((close * 1.021).toFixed(2)),
    low: Number((close * 0.973).toFixed(2)),
    close,
    chg,
    amount,
    vol,
  };
}

// 与后端当前口径一致：5 个策略（max-amount 已从 qu-policy 移除）
const MOCK_POLICIES = [
  {
    id: 'full-copy-buttom',
    title: '全复制底部',
    desc: '一涨停 二放量 三回调 四缩量',
    status: 'ok',
    status_text: '回补计算成功：信号日 2026-10-30，4 只目标股',
    rules: ['① 涨停日 T', '② T+1 放量', '③ T+2 回调', '④ T+3 缩量 <= 0.75 × vol(T)', '⑤ 低价过滤'],
    signal_date: '2026-10-30',
    target_date: '2026-10-30',
    targets: [
      target('000001', '平安银行', 11.64, 0.87, 2152393886.36, 1864245),
      target('002475', '立讯精密', 42.18, 2.31, 3145000000.0, 748200),
      target('300124', '汇川技术', 61.35, 1.02, 2876000000.0, 469300),
      target('600519', '贵州茅台', 1520.0, -0.85, 11020000000.0, 72300),
    ],
    meta: { elapsed_s: 12.3, mode: 'backfill', error: '' },
  },
  {
    id: 'im-catch-full',
    title: '倒锤子抓涨停',
    desc: '倒锤子形态 + 涨停缓存共振',
    status: 'ok',
    status_text: '回补计算成功：信号日 2026-10-30，3 只目标股',
    rules: ['① 倒锤子形态（上影长、实体小）', '② 前一日涨停缓存命中', '③ 当日非涨停'],
    signal_date: '2026-10-30',
    target_date: '2026-10-30',
    targets: [
      target('300502', '新易盛', 196.0, -14.19, 21607604874.04, 1060301),
      target('002050', '三花智控', 32.6, 4.18, 11890000000.0, 3621000),
      target('000063', '中兴通讯', 41.2, -2.14, 14210000000.0, 3456000),
    ],
    meta: { elapsed_s: 8.6, mode: 'backfill', error: '' },
  },
  {
    id: 'rsi-hot-check',
    title: 'RSI 热门',
    desc: 'RSI 超买 + 量能 + 趋势 5 条判据',
    status: 'stale',
    status_text: '回补计算成功：信号日 2026-10-28，2 只目标股；信号日早于最新交易日 2026-10-30',
    rules: ['① RSI(6) > 80', '② 换手率放大', '③ 收盘价创 20 日新高', '④ 均线多头', '⑤ 非 ST'],
    signal_date: '2026-10-28',
    target_date: '2026-10-30',
    targets: [
      target('688981', '中芯国际', 118.7, 3.05, 13760000000.0, 1163000),
      target('601899', '紫金矿业', 19.8, 1.65, 10560000000.0, 5312000),
    ],
    meta: { elapsed_s: 19.1, mode: 'backfill', error: '' },
  },
  {
    id: 'cc-low-symbol-up',
    title: '概念低吸',
    desc: '全 cc 均值 < -1% 时选底部概念上行股',
    status: 'stale',
    status_text: '回补计算成功：信号日 2026-10-27，1 只目标股；信号日早于最新交易日 2026-10-30',
    rules: ['① 全概念 chg 均值 < -1%', '② 底部概念（排名后 20%）', '③ 个股当日 chg > 0', '④ 非涨停'],
    signal_date: '2026-10-27',
    target_date: '2026-10-30',
    targets: [target('600030', '中信证券', 28.91, 1.24, 6300000000.0, 2186000)],
    meta: { elapsed_s: 0, mode: 'snapshot', error: '' },
  },
  {
    id: 'green-dde',
    title: '绿盘 DDE',
    desc: 'DDE 资金流 + 30 日新高过滤',
    status: 'missing_data',
    status_text: '数据源缺失（无 DDE）：stock2 无 DDE 资金流字段/表（BigOrder/DDX/DDY 均无）',
    rules: ['① DDE 大单净额 > 0', '② 绿盘（close < open）', '③ 30 日新高过滤', '④ 非一字板'],
    signal_date: '2026-10-30',
    target_date: '2026-10-30',
    targets: [],
    meta: { elapsed_s: 0, mode: 'unsupported', error: '' },
  },
];

function mockPolicies() {
  return {
    meta: {
      date: MOCK_END,
      source: 'backfill',
      generated_at: '2026-10-31T16:20:00+08:00',
      cached: true,
    },
    items: MOCK_POLICIES,
  };
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < String(value).length; i += 1) {
    hash = (hash * 31 + String(value).charCodeAt(i)) >>> 0;
  }
  return hash || 1;
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

/**
 * 示例 BT 回测：按「买入日等权组合复利」生成 equity / cum_per，
 * 与后端 2026-11-01 新口径一致；sum_per 为引擎自身口径（次要指标）。
 */
function mockBacktest(path, params = {}) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean);
  const id = decodeURIComponent(parts[parts.length - 2] || '');
  const days = BT_DAYS.includes(Number(params.days)) ? Number(params.days) : 20;
  const policy = MOCK_POLICIES.find((item) => item.id === id) || MOCK_POLICIES[0];
  const allDates = ui.recentTradeDates(days + 6, MOCK_END);
  const et = allDates[allDates.length - 1];
  const st = allDates[0];

  const base = {
    meta: { date: et, source: 'cache', generated_at: '2026-10-31T16:20:00+08:00', cached: true },
    id: policy.id,
    days,
    range: { st, et },
    metrics: {
      trades: 0,
      win_rate: 0,
      cum_per: 0,
      avg_per: 0,
      best_per: 0,
      worst_per: 0,
      max_drawdown: 0,
      sum_per: 0,
      groups: 0,
      signal_days: 0,
    },
    equity: [],
    trades: [],
    error: '',
  };

  // BT 不可用：展示中性的「暂无回测」样式（不是加载失败）
  if (policy.status === 'missing_data' || policy.status === 'unsupported') {
    return {
      ...base,
      error: policy.status_text || '数据源缺失，暂时无法计算该策略的 BT 回测。',
    };
  }

  const rand = ui.seededRandom(hashString(`${policy.id}#${days}`));
  const dates = allDates.slice(1, allDates.length - 1);
  const count = Math.max(3, Math.min(26, Math.round(days / 4 + rand() * 7)));
  const trades = [];
  const used = new Set();
  for (let i = 0; i < count; i += 1) {
    let index = 1 + Math.floor(rand() * (dates.length - 2));
    if (used.has(index)) index = (index + 2) % (dates.length - 2) + 1;
    used.add(index);
    const [symbol, name] = MOCK_TRADE_STOCKS[(i + Math.floor(rand() * 3)) % MOCK_TRADE_STOCKS.length];
    const buyPrice = round2(8 + rand() * 220);
    const win = rand() < 0.58;
    const per = round2(win ? 0.8 + rand() * 7.5 : -(0.6 + rand() * 4.2));
    trades.push({
      symbol,
      name,
      buy_date: dates[index],
      sell_date: dates[Math.min(dates.length - 1, index + 1)],
      buy_price: buyPrice,
      sell_price: round2(buyPrice * (1 + per / 100)),
      per,
    });
  }
  trades.sort(
    (a, b) =>
      String(a.buy_date).localeCompare(String(b.buy_date)) ||
      String(a.sell_date).localeCompare(String(b.sell_date)),
  );

  // 买入日等权组合复利：同一买入日的多笔交易等权平均，再按买入日复利
  const byBuyDate = new Map();
  trades.forEach((trade) => {
    if (!byBuyDate.has(trade.buy_date)) byBuyDate.set(trade.buy_date, []);
    byBuyDate.get(trade.buy_date).push(trade.per);
  });
  const buyDates = Array.from(byBuyDate.keys()).sort();
  let value = 1;
  let peak = 1;
  let maxDrawdown = 0;
  const equity = buyDates.map((date) => {
    const pers = byBuyDate.get(date);
    const groupPer = pers.reduce((sum, cur) => sum + cur, 0) / pers.length;
    value *= 1 + groupPer / 100;
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, (value / peak - 1) * 100);
    return { date, cum_per: round2((value - 1) * 100) };
  });

  const wins = trades.filter((trade) => trade.per > 0).length;
  const pers = trades.map((trade) => trade.per);
  return {
    ...base,
    metrics: {
      trades: trades.length,
      win_rate: round2((wins / trades.length) * 100),
      cum_per: round2((value - 1) * 100),
      avg_per: round2(pers.reduce((sum, cur) => sum + cur, 0) / pers.length),
      best_per: round2(Math.max(...pers)),
      worst_per: round2(Math.min(...pers)),
      max_drawdown: round2(maxDrawdown),
      sum_per: round2(pers.reduce((sum, cur) => sum + cur, 0)),
      groups: buyDates.length,
      signal_days: buyDates.length,
    },
    equity,
    trades,
  };
}

// ---- BT 参数面板示例数据（日期区间 / 卖盘策略 / 引擎 / 策略参数） ----
const MOCK_SELL_LABELS = {
  sell_on_close: '收盘卖出',
  sell_by_one_per: '次日冲高卖出（+1%）',
  sell_by_open: '次日开盘阶梯卖出',
  sell_by_open2: '次日开盘阶梯卖出 v2',
  catch_full_touch_high: '触板卖出（catch_full 默认）',
};

const MOCK_BT_OPTIONS = {
  'full-copy-buttom': {
    sells: ['sell_by_one_per', 'sell_on_close', 'sell_by_open', 'sell_by_open2'],
    params: [
      { key: 'is_sell_next_date', label: 'T+1 卖出', type: 'bool', default: true },
      { key: 'keep_day_count', label: '持股天数', type: 'int', default: 1, min: 1, max: 20 },
    ],
  },
  'im-catch-full': {
    sells: ['catch_full_touch_high', 'sell_on_close', 'sell_by_one_per'],
    params: [
      { key: 'case', label: '策略场景', type: 'enum', default: 'case2',
        options: [['case2', '倒垂线后炸板（默认）'], ['case1', '涨停追击']] },
      { key: 'min_price', label: '最低价', type: 'float', default: 6, min: 0.5, max: 200, step: 0.5 },
      { key: 'line_size', label: '均线周期', type: 'int', default: 5, min: 3, max: 30 },
      { key: 'cond1_enable', label: '条件1 价格', type: 'bool', default: true },
      { key: 'cond2_enable', label: '条件2 均线', type: 'bool', default: true },
      { key: 'cond3_enable', label: '条件3 低开', type: 'bool', default: false },
    ],
  },
  'rsi-hot-check': {
    sells: ['sell_on_close', 'sell_by_one_per', 'sell_by_open', 'sell_by_open2'],
    params: [
      { key: 'count', label: '概念榜前 N', type: 'int', default: 3, min: 1, max: 10 },
      { key: 'tag', label: '概念标签', type: 'enum', default: 'self',
        options: [['self', 'self 概念'], ['all', '全部概念']] },
      { key: 'with_normal', label: 'normal 因子', type: 'bool', default: true },
      { key: 'with_low', label: 'low 因子', type: 'bool', default: false },
    ],
  },
  'cc-low-symbol-up': {
    sells: ['sell_on_close', 'sell_by_one_per', 'sell_by_open', 'sell_by_open2'],
    params: [
      { key: 'low_cc_count', label: '低概念数', type: 'int', default: 3, min: 1, max: 10 },
      { key: 'low_cc_per', label: '全概念均值阈值(%)', type: 'float', default: -1, min: -10, max: 0, step: 0.1 },
      { key: 'min_price', label: '最低价', type: 'float', default: 6, min: 0.5, max: 200, step: 0.5 },
      { key: 'wait_date_count', label: '等待交易日', type: 'int', default: 5, min: 1, max: 20 },
    ],
  },
  'green-dde': { sells: [], params: [] },
};

function mockBtOptions(path) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean);
  const id = decodeURIComponent(parts[parts.length - 3] || '');
  const preset = MOCK_BT_OPTIONS[id] || MOCK_BT_OPTIONS['cc-low-symbol-up'];
  const dates = ui.recentTradeDates(40, MOCK_END);
  const et = dates[dates.length - 2];
  const st = dates[Math.max(0, dates.length - 32)];
  const params = {};
  preset.params.forEach((spec) => { params[spec.key] = spec.default; });
  return {
    meta: { date: MOCK_END, source: 'cache', generated_at: '2026-11-02T09:10:00+08:00' },
    id,
    title: (MOCK_POLICIES.find((item) => item.id === id) || {}).title || id,
    defaults: { st, et, sell: preset.sells[0] || '', engine: 'bt' },
    limits: { max_trade_days: 250, default_start_days: 30 },
    sells: preset.sells.map((key) => ({ key, label: MOCK_SELL_LABELS[key] || key, default: key === preset.sells[0] })),
    engines: [
      { key: 'bt', label: 'bt 引擎（内置）', available: true },
      { key: 'vbt', label: 'vbt 引擎（vectorbt）', available: false },
    ],
    params: preset.params,
    supported: id !== 'green-dde',
    unsupported_reason: id === 'green-dde' ? 'green-dde 缺 DDE 资金流数据源，无法回测。' : '',
    vbt_available: false,
    default_params: params,
  };
}

api.registerMock(
  /^\/api\/policies\/[^/?]+\/backtest\/options$/,
  (ctx) => mockBtOptions(ctx.path),
  'BT 参数元数据',
);

// 注意注册顺序：更具体的路由必须先注册（matchMock 先匹配先返回）
api.registerMock(
  /^\/api\/policies\/[^/?]+\/backtest/,
  (ctx) => mockBacktest(ctx.path, ctx.params || {}),
  'BT 回测',
);
api.registerMock(/^\/api\/policies\/[^/?]+$/, (ctx) => {
  const id = decodeURIComponent(String(ctx.path).split('?')[0].split('/').pop() || '');
  return mockPolicies().items.find((item) => item.id === id) || mockPolicies().items[0];
}, '策略详情');
api.registerMock('/api/policies', () => mockPolicies(), '策略看板');

/* ================================================================== */
/* 常量 / 图表 option                                                  */
/* ================================================================== */

const SOURCE_TEXT = {
  snapshot: '真实快照（14:58 target 落盘）',
  backfill: '策略逻辑回算（select 口径）',
  mixed: '快照 + 回补混合',
  none: '无数据',
};

const STATUS_LABEL = {
  ok: '正常',
  stale: '过期',
  missing_data: '缺数据',
  unsupported: '不支持',
  error: '错误',
  empty: '无信号',
  running: '计算中',
};

const STATUS_TYPE = {
  ok: 'ok',
  stale: 'stale',
  missing_data: 'missing',
  unsupported: 'missing',
  error: 'error',
  empty: 'empty',
  running: 'primary',
};

const BT_UNAVAILABLE_STATUS = new Set(['missing_data', 'unsupported']);

function btKey(id, days) {
  return `${id}:${days}`;
}

function buildEquityOption(equity) {
  const dates = equity.map((item) => String(item.date).slice(5));
  const values = equity.map((item) => item.cum_per);
  return {
    animationDuration: 360,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter(params) {
        if (!params || !params.length) return '';
        const item = equity[params[0].dataIndex];
        if (!item) return '';
        return [
          `<div style="font-weight:600;margin-bottom:4px">${item.date}</div>`,
          `<div>累计收益（按买入日等权复利） <b style="color:${item.cum_per >= 0 ? CHART_COLORS.up : CHART_COLORS.down}">${ui.fmtPct(item.cum_per)}</b></div>`,
        ].join('');
      },
    },
    grid: { left: 48, right: 16, top: 18, bottom: 24 },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { interval: Math.max(0, Math.floor(dates.length / 6) - 1) },
    },
    yAxis: { type: 'value', axisLabel: { formatter: (value) => `${Number(value).toFixed(1)}%` } },
    series: [
      {
        name: '累计收益',
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: CHART_COLORS.primary },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(56, 189, 248, 0.26)' },
              { offset: 1, color: 'rgba(56, 189, 248, 0)' },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: 'rgba(156, 163, 175, 0.35)', type: 'dashed', width: 1 },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
}

function buildTradeBarOption(trades) {
  const labels = trades.map((trade) => String(trade.buy_date || trade.sell_date || '').slice(5));
  const data = trades.map((trade) => ({
    value: trade.per,
    itemStyle: {
      color: trade.per >= 0 ? CHART_COLORS.up : CHART_COLORS.down,
      borderRadius: trade.per >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2],
    },
  }));
  return {
    animationDuration: 360,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter(params) {
        if (!params || !params.length) return '';
        const trade = trades[params[0].dataIndex];
        if (!trade) return '';
        return [
          `<div style="font-weight:600;margin-bottom:4px">${trade.name || ''} ${trade.symbol || ''}</div>`,
          `<div>买入 ${trade.buy_date || '—'} @ ${ui.fmtPrice(trade.buy_price)}</div>`,
          `<div>卖出 ${trade.sell_date || '—'} @ ${ui.fmtPrice(trade.sell_price)}</div>`,
          `<div>单笔收益 <b style="color:${trade.per >= 0 ? CHART_COLORS.up : CHART_COLORS.down}">${ui.fmtPct(trade.per)}</b></div>`,
        ].join('');
      },
    },
    grid: { left: 44, right: 12, top: 16, bottom: 34 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { fontSize: 9, interval: Math.max(0, Math.floor(trades.length / 8) - 1) },
    },
    yAxis: { type: 'value', axisLabel: { formatter: (value) => `${Number(value).toFixed(0)}%` } },
    series: [{ name: '单笔收益', type: 'bar', data, barMaxWidth: 12 }],
  };
}

/* ================================================================== */
/* 页面                                                                */
/* ================================================================== */

function mount(root) {
  const state = {
    items: [],
    meta: null,
    selectedId: null, // 左侧列表当前选中策略
    refreshingId: null,
    sidebarCollapsed: false, // 左侧策略列表是否收起（类似 DSH 收起侧边栏）
    optionsById: new Map(), // id -> /backtest/options
    optionsLoading: new Set(),
    configs: new Map(), // id -> {st, et, sell, engine, params}
    btCache: new Map(), // configKey -> /test 响应
    bt: null, // 当前策略的回测结果
    btLoading: false,
    btError: null,
    btSeq: 0,
    prepSeq: 0,
    stockSeq: 0,
    stock: null, // {mode:'bt'|'target', symbol, name, st, et, days}
    stockData: null,
    stockLoading: false,
    stockError: null,
    stockDays: 30,
    targetsCollapsed: false, // 目标股列表是否折叠（点击逐笔明细时自动折叠）
    targetsDate: '', // 目标股列表日期（'' = 最新交易日，无信号时后端自动回退）
    targetsDates: [], // 日期选择器可选日期（升序）
    targetsLoading: false,
    targetsSeq: 0, // 目标股请求序号（切日期/切策略时丢弃过期响应）
    targetsPendingDate: '',
  };

  let layoutEl = null;
  let sidebarEl = null;
  let sidebarListEl = null;
  let mainHdEl = null;
  let detailEl = null;
  let collapseBtn = null;
  let expandBtn = null;
  let currentText = null;
  let btCharts = [];
  let btChartTargets = []; // [{el, option}]：DOM 插入后再初始化 ECharts
  let stockChart = null; // 底部个股 K 线（独立实例，选择个股时只更新它，不重绘 BT 图表）
  let stockCardEl = null; // 个股 K 线卡片节点（原地替换）
  let targetsCardEl = null; // 目标股列表卡片节点（原地替换）

  /* ================================================================== */
  /* 页头 / 工具栏                                                       */
  /* ================================================================== */
  const sourceBadge = ui.badge('加载中…', 'primary');
  const hd = ui.el(
    'div',
    { class: 'page-hd' },
    ui.el(
      'div',
      {},
      ui.el('h1', { class: 'page-title', text: '策略看板' }),
      ui.el('div', {
        class: 'page-sub',
        text: '左侧选择策略 · 右侧依次展示「摘要 → BT 回测（日期区间/卖盘策略/引擎/策略参数）→ 目标股列表」',
      }),
    ),
    ui.el('div', { class: 'page-hd-right' }, sourceBadge, ui.badge('BT: T+1 卖出', 'missing')),
  );
  root.append(hd);

  const sourceText = ui.el('span', { class: 'dim', text: '数据来源：加载中…' });
  currentText = ui.el('span', { class: 'auth-note', text: '' });
  const refreshBtn = ui.el('button', {
    type: 'button',
    class: 'btn btn-primary btn-sm',
    title: 'POST /api/policies/{id}/refresh（重算目标股）',
  }, ui.el('span', { text: '重新计算' }));
  refreshBtn.disabled = true;
  refreshBtn.addEventListener('click', () => handleRefresh());

  const toolbar = ui.el(
    'div',
    { class: 'toolbar' },
    ui.el('div', { class: 'toolbar-left' }, sourceText, currentText),
    ui.el(
      'div',
      { class: 'toolbar-right' },
      ui.el('span', { class: 'auth-note', text: '同步重算，冷启动约 1~40s' }),
      refreshBtn,
    ),
  );
  root.append(toolbar);

  /* ================================================================== */
  /* 左右布局：左侧策略列表（30%）+ 右侧详情（70%）                       */
  /* ================================================================== */
  function setSidebarCollapsed(collapsed) {
    state.sidebarCollapsed = Boolean(collapsed);
    if (layoutEl) layoutEl.classList.toggle('is-collapsed', state.sidebarCollapsed);
    if (collapseBtn) {
      collapseBtn.title = state.sidebarCollapsed ? '展开策略列表' : '收起侧边栏';
      collapseBtn.textContent = state.sidebarCollapsed ? '▶' : '◀';
    }
  }

  collapseBtn = ui.el('button', {
    type: 'button',
    class: 'policy-collapse-btn',
    text: '◀',
    title: '收起侧边栏',
    onclick: () => setSidebarCollapsed(!state.sidebarCollapsed),
  });
  expandBtn = ui.el('button', {
    type: 'button',
    class: 'policy-collapse-btn',
    text: '▶ 展开策略列表',
    title: '展开策略列表',
    onclick: () => setSidebarCollapsed(false),
  });

  sidebarListEl = ui.el('div', { class: 'policy-sidebar-list' });
  sidebarEl = ui.el(
    'aside',
    { class: 'policy-sidebar' },
    ui.el(
      'div',
      { class: 'policy-sidebar-hd' },
      ui.el('span', { class: 'policy-sidebar-title', text: '策略列表' }),
      collapseBtn,
    ),
    sidebarListEl,
  );

  detailEl = ui.el('div', { class: 'policy-detail-col' });
  mainHdEl = ui.el('div', { class: 'policy-main-hd' }, expandBtn,
    ui.el('span', { class: 'dim', text: '选择左侧策略查看详情' }));
  layoutEl = ui.el(
    'div',
    { class: 'policy-layout' },
    sidebarEl,
    ui.el('div', { class: 'policy-main' }, mainHdEl, detailEl),
  );
  root.append(layoutEl);

  /* ================================================================== */
  /* 基础工具                                                            */
  /* ================================================================== */
  function selectedPolicy() {
    return state.items.find((item) => item.id === state.selectedId) || state.items[0] || null;
  }

  function configKey(id, config) {
    return [
      id, config.st, config.et, config.sell, config.engine,
      JSON.stringify(config.params || {}),
    ].join('|');
  }

  function disposeBtCharts() {
    btCharts.forEach((chart) => chart.dispose());
    btCharts = [];
  }

  function updateToolbar() {
    const meta = state.meta || {};
    sourceText.textContent = `数据来源：${SOURCE_TEXT[meta.source] || meta.source || '—'}`;
    sourceText.title = meta.generated_at ? `生成时间：${meta.generated_at}` : '';
    sourceBadge.textContent = meta.date || '—';
    const policy = selectedPolicy();
    currentText.textContent = policy ? `当前策略：${policy.title}（${policy.id}）` : '';
    refreshBtn.disabled = !policy || Boolean(state.refreshingId);
    const btnLabel = refreshBtn.querySelector('span');
    if (btnLabel) btnLabel.textContent = state.refreshingId ? '计算中…' : '重新计算';
    refreshBtn.title = policy
      ? `重新计算「${policy.title}」目标股：POST /api/policies/${policy.id}/refresh`
      : '暂无可重算策略';
    if (mainHdEl) {
      const label = mainHdEl.querySelector('.dim');
      if (label) label.textContent = policy ? `${policy.title} · ${policy.id}` : '选择左侧策略查看详情';
    }
  }

  /* ================================================================== */
  /* 左侧策略列表                                                        */
  /* ================================================================== */
  function renderSidebar() {
    if (!state.items.length) {
      sidebarListEl.replaceChildren(ui.emptyState('暂无策略'));
      return;
    }
    sidebarListEl.replaceChildren(...state.items.map((policy) => {
      const active = policy.id === state.selectedId;
      const statusLabel = STATUS_LABEL[policy.status] || '未知';
      const targets = Array.isArray(policy.targets) ? policy.targets : [];
      return ui.el(
        'button',
        {
          type: 'button',
          class: `policy-nav-item${active ? ' is-active' : ''}`,
          dataset: { id: policy.id },
          title: policy.status_text || `${policy.title}（${policy.id}）`,
          onclick: () => selectPolicy(policy.id),
        },
        ui.el(
          'div',
          { class: 'policy-nav-top' },
          ui.el('span', { class: 'policy-nav-name', text: policy.title || policy.id }),
          // 2026-11-02：左侧列表不再展示「正常 / 过期」状态，仅保留异常状态（如 green-dde 的「缺数据」）
          ['ok', 'stale'].includes(policy.status)
            ? null
            : ui.badge(statusLabel, STATUS_TYPE[policy.status] || 'empty', { dot: true }),
        ),
        ui.el('div', { class: 'policy-nav-desc', text: policy.desc || '' }),
        ui.el('div', {
          class: 'policy-nav-meta',
          text: `${policy.id} · 目标 ${targets.length} 只 · ${policy.signal_date || policy.target_date || '—'}`,
        }),
      );
    }));
  }

  /* ================================================================== */
  /* 右侧 1.1 摘要                                                       */
  /* ================================================================== */
  function renderSummaryCard(policy) {
    const targets = Array.isArray(policy.targets) ? policy.targets : [];
    const refreshing = state.refreshingId === policy.id;
    const statusLabel = STATUS_LABEL[policy.status] || '未知';
    const refreshBtn2 = ui.el('button', {
      type: 'button',
      class: 'btn btn-sm',
      text: refreshing ? '计算中…' : '重算目标股',
      title: `POST /api/policies/${policy.id}/refresh`,
      onclick: () => handleRefresh(policy.id),
    });
    if (refreshing) refreshBtn2.disabled = true;

    const rules = Array.isArray(policy.rules) && policy.rules.length
      ? ui.el('ul', { class: 'policy-rules' }, policy.rules.map((rule) => ui.el('li', { text: rule })))
      : ui.el('div', { class: 'dim', text: '（该策略暂无规则摘要）' });

    const card = ui.card({
      title: '策略摘要',
      sub: '策略更新信息 + 规则摘要',
      extra: ui.inlineGroup(
        ui.badge(statusLabel, STATUS_TYPE[policy.status] || 'empty',
          { dot: true, title: policy.status_text || statusLabel }),
        refreshBtn2,
      ),
    });
    card.body.append(
      ui.el(
        'div',
        { class: 'policy-summary-hd' },
        ui.el(
          'div',
          {},
          ui.el('h3', { class: 'policy-title' },
            ui.el('span', { text: policy.title || policy.id }),
            ui.el('span', { class: 'policy-id', text: policy.id })),
          ui.el('div', { class: 'policy-desc', text: policy.desc || '' }),
        ),
      ),
      ui.el(
        'div',
        { class: 'policy-meta' },
        ui.el('span', {}, '信号日 ', ui.el('b', { text: policy.signal_date || policy.target_date || '—' })),
        ui.el('span', {}, '目标交易日 ', ui.el('b', { text: policy.target_date || '—' })),
        ui.el('span', {}, '目标股 ', ui.el('b', { text: String(targets.length) })),
        policy.meta && ui.isNum(policy.meta.elapsed_s) && policy.meta.elapsed_s > 0
          ? ui.el('span', {}, '耗时 ', ui.el('b', { text: `${ui.fmtNum(policy.meta.elapsed_s, 1)}s` }))
          : null,
        ui.el('span', {}, '更新 ', ui.el('b', { text: (policy.meta && (policy.meta.generated_at || policy.meta.date)) || '—' })),
      ),
      ui.el(
        'div',
        { class: 'policy-hd-foot' },
        ui.el('span', {
          class: 'policy-foot-text',
          title: policy.status_text || '',
          text: [
            policy.meta && policy.meta.mode ? `mode=${policy.meta.mode}` : '',
            policy.status_text || '',
            (policy.meta && policy.meta.error) || '',
          ].filter(Boolean).join(' · '),
        }),
      ),
      ui.el('div', { class: 'detail-section-sub', text: '规则摘要' }),
      rules,
    );
    return card.root;
  }

  /* ================================================================== */
  /* 右侧 1.3 目标股列表                                                 */
  /* ================================================================== */
  function renderTargetsCard(policy) {
    const targets = Array.isArray(policy.targets) ? policy.targets : [];
    const signalDate = policy.signal_date || policy.target_date || '—';
    const collapsed = state.targetsCollapsed;
    const toggleBtn = ui.el('button', {
      type: 'button',
      class: 'btn btn-sm',
      text: collapsed ? '展开列表 ▼' : '收起列表 ▲',
      title: collapsed ? '展开目标股列表' : '折叠目标股列表',
      onclick: () => {
        state.targetsCollapsed = !state.targetsCollapsed;
        refreshTargetsCard();
      },
    });
    const dates = (state.targetsDates && state.targetsDates.length)
      ? state.targetsDates
      : ui.recentTradeDates(60, (state.meta && state.meta.date) || undefined);
    const dateInput = ui.el('input', {
      type: 'date',
      class: 'date-input',
      title: '选择日期查看该交易日的目标股（默认最新交易日）',
      value: state.targetsDate || (dates.length ? dates[dates.length - 1] : ''),
      min: dates.length ? dates[0] : null,
      max: dates.length ? dates[dates.length - 1] : null,
      onchange: (event) => {
        state.targetsDate = event.target.value || '';
        loadTargetsByDate(policy.id, state.targetsDate);
      },
    });
    const resetDateBtn = ui.el('button', {
      type: 'button',
      class: 'btn btn-sm',
      text: '最新',
      title: '回到默认（最新交易日；该日无数据则显示「没有数据」）',
      onclick: () => {
        state.targetsDate = '';
        loadTargetsByDate(policy.id, '');
      },
    });
    const card = ui.card({
      title: '目标股列表',
      sub: collapsed
        ? `已折叠（目标 ${targets.length} 只，信号日 ${signalDate}）`
        : [
          state.targetsDate
            ? (policy.targets_snapped
              ? `所选 ${policy.targets_requested || state.targetsDate}（非交易日）→ 交易日 ${policy.targets_date || signalDate}`
              : `所选日期 ${state.targetsDate}`)
            : '最新交易日',
          `信号日 ${signalDate}`,
          `目标交易日 ${policy.target_date || '—'}`,
        ].join(' · '),
      bodyClass: 'is-tight',
      extra: ui.el('div', { class: 'card-extra-row' },
        ui.badge(`目标 ${targets.length} 只`, targets.length ? 'primary' : 'empty'),
        dateInput,
        resetDateBtn,
        toggleBtn,
      ),
    });
    if (collapsed) {
      card.body.append(ui.el('div', {
        class: 'detail-section-empty',
        style: { padding: '10px 14px' },
        text: '目标股列表已折叠（点击「展开列表」查看）',
      }));
      return card.root;
    }
    if (state.targetsLoading) {
      // 加载态：清空列表 + 转圈 + 禁用日期控件，避免误以为「选择没生效」
      const pending = state.targetsPendingDate || state.targetsDate || '最新交易日';
      card.setSub(`正在计算 ${pending} 的目标股…（后端需按日回补选股，通常 5~60s）`);
      card.setExtra(ui.el('div', { class: 'card-extra-row' },
        ui.inlineGroup(
          ui.el('span', { class: 'spinner' }),
          ui.badge('计算中…', 'primary'),
        ),
        dateInput,
        resetDateBtn,
        toggleBtn,
      ));
      dateInput.disabled = true;
      resetDateBtn.disabled = true;
      dateInput.title = '正在计算，请稍候…';
      card.body.append(ui.el('div', { class: 'targets-loading' },
        ui.el('span', { class: 'spinner' }),
        ui.el('div', {},
          ui.el('div', { class: 'targets-loading-text' },
            '加载中… ', ui.el('b', { text: pending })),
          ui.el('div', { class: 'targets-loading-hint',
            text: '正在向后端请求该交易日的目标股列表，完成后自动刷新' }),
        ),
      ));
      return card.root;
    }
    if (!targets.length) {
      const missing = policy.status === 'missing_data' || policy.status === 'unsupported';
      card.body.append(ui.emptyState(
        missing ? '暂无目标股（数据源缺失）' : '没有数据',
        policy.status_text || '',
      ));
      return card.root;
    }
    const table = ui.dataTable({
      wrapClass: 'is-short',
      emptyText: '没有数据',
      rowKey: (row) => row.symbol,
      onRowClick: (row) => selectStockTarget(row.symbol, row.name),
      columns: [
        { key: 'symbol', title: '代码', className: 'sym', width: 84 },
        { key: 'name', title: '名称', className: 'name', width: 100 },
        { key: 'close', title: '收盘', align: 'right', render: (row) => ui.fmtPrice(row.close) },
        { key: 'chg', title: '涨跌幅', align: 'right', render: (row) => ui.pctSpan(row.chg) },
        { key: 'amount', title: '成交额(亿)', align: 'right', render: (row) => ui.fmtYi(row.amount) },
        { key: 'vol', title: '成交量(万手)', align: 'right', render: (row) => ui.fmtWanShou(row.vol) },
      ],
    });
    table.setRows(targets);
    card.body.append(table.root);
    return card.root;
  }

  /* ================================================================== */
  /* BT 指标卡                                                           */
  /* ================================================================== */
  function metricTile({ label, value, sub = '', tone = '', valueNode = null, title = '' }) {
    const valueEl = valueNode || ui.el('div', { class: `stat-value ${tone}`.trim(), text: value });
    return ui.el(
      'div',
      { class: 'stat-card', title: title || null },
      ui.el('div', { class: 'stat-label', text: label }),
      valueEl,
      sub ? ui.el('div', { class: 'stat-sub', text: sub }) : null,
    );
  }

  function renderBtMetrics(metrics, trades, days) {
    const wins = trades.filter((trade) => Number(trade.per) > 0).length;
    const best = ui.isNum(metrics.best_per) ? metrics.best_per : 0;
    const worst = ui.isNum(metrics.worst_per) ? metrics.worst_per : 0;
    const sumPer = ui.isNum(metrics.sum_per) ? ui.fmtPct(metrics.sum_per) : '—';
    const signalDays = ui.isNum(metrics.signal_days)
      ? metrics.signal_days
      : ui.isNum(metrics.groups) ? metrics.groups : 0;
    return ui.el(
      'div',
      { class: 'bt-metrics' },
      metricTile({
        label: '交易数',
        value: ui.fmtInt(metrics.trades || trades.length),
        sub: `${ui.fmtInt(metrics.groups || 0)} 个持仓组`,
      }),
      metricTile({
        label: '胜率',
        value: `${ui.fmtNum(metrics.win_rate, 1)}%`,
        sub: `${wins} 胜 / ${trades.length - wins} 负`,
        tone: Number(metrics.win_rate) >= 50 ? 'up' : 'down',
      }),
      metricTile({
        label: '累计收益',
        value: ui.fmtPct(metrics.cum_per),
        sub: '按买入日等权复利',
        tone: ui.chgClass(metrics.cum_per),
        title: `按买入日等权组合复利；BT 引擎自身口径 sum_per = ${sumPer}（次要指标）`,
      }),
      metricTile({
        label: '平均单笔',
        value: ui.fmtPct(metrics.avg_per),
        sub: '每笔平均收益率',
        tone: ui.chgClass(metrics.avg_per),
      }),
      metricTile({
        label: '最大回撤',
        value: ui.fmtPct(metrics.max_drawdown),
        sub: '净值自峰值回撤',
        tone: ui.chgClass(metrics.max_drawdown),
      }),
      metricTile({
        label: '最佳 / 最差单笔',
        sub: '单笔收益极值',
        valueNode: ui.el(
          'div',
          { class: 'stat-value is-pair' },
          ui.el('span', { class: 'up', text: ui.fmtPct(best) }),
          ui.el('span', { class: 'bt-sep', text: ' / ' }),
          ui.el('span', { class: 'down', text: ui.fmtPct(worst) }),
        ),
      }),
      metricTile({
        label: '信号日数',
        value: ui.fmtInt(signalDays),
        sub: `共 ${days} 个交易日`,
        title: 'BT 区间内出现买入信号的交易日数量',
      }),
    );
  }

  function renderTradesTable(trades) {
    const table = ui.dataTable({
      wrapClass: 'is-short',
      emptyText: '区间内无信号',
      onRowClick: (row) => selectStockBt(row.symbol, row.name),
      rowKey: (row) => `${row.buy_date}-${row.symbol}-${row.per}`,
      columns: [
        { key: 'buy_date', title: '买入日', render: (row) => ui.el('span', { class: 'dim', text: row.buy_date || ui.EMPTY }) },
        { key: 'sell_date', title: '卖出日', render: (row) => ui.el('span', { class: 'dim', text: row.sell_date || ui.EMPTY }) },
        { key: 'symbol', title: '代码', className: 'sym', width: 84 },
        { key: 'name', title: '名称', className: 'name', width: 96 },
        { key: 'buy_price', title: '买入价', align: 'right', render: (row) => ui.fmtPrice(row.buy_price) },
        { key: 'sell_price', title: '卖出价', align: 'right', render: (row) => ui.fmtPrice(row.sell_price) },
        { key: 'per', title: '收益率', align: 'right', render: (row) => ui.pctSpan(row.per) },
      ],
    });
    table.setRows(trades);
    if (!trades.length) table.setEmpty('区间内无信号');
    return table.root;
  }

  function btUnavailableNode(policy, text) {
    const desc = text || policy.status_text || '该策略暂不支持 BT 回测。';
    return ui.el(
      'div',
      { class: 'bt-unavailable' },
      ui.el('div', { class: 'bt-unavailable-icon', text: '⊘' }),
      ui.el(
        'div',
        { class: 'bt-unavailable-body' },
        ui.el('div', { class: 'bt-unavailable-title' },
          ui.el('span', { text: '暂无回测' }),
          ui.badge(STATUS_LABEL[policy.status] || policy.status || '不可用', 'missing')),
        ui.el('div', { class: 'bt-unavailable-text', text: desc }),
        ui.el('div', {
          class: 'bt-unavailable-hint',
          text: '该策略没有可用的 BT 回测数据（非计算失败）；目标股列表仍按上方展示。',
        }),
      ),
    );
  }

  /* ================================================================== */
  /* 右侧 1.2 BT 回测（控件 + 结果）                                     */
  /* ================================================================== */
  function field(label, control, hint = '') {
    return ui.el(
      'label',
      { class: 'bt-field', title: hint || null },
      ui.el('span', { class: 'bt-field-label', text: label }),
      control,
    );
  }

  function buildBtControls(policy, options, config) {
    const wrap = ui.el('div', { class: 'bt-controls' });

    const stInput = ui.el('input', {
      type: 'date', class: 'date-input', value: config.st,
      min: '2015-01-01', max: options.defaults.et,
      onchange: (event) => { config.st = event.target.value; },
    });
    const etInput = ui.el('input', {
      type: 'date', class: 'date-input', value: config.et,
      min: '2015-01-01', max: options.defaults.et,
      onchange: (event) => { config.et = event.target.value; },
    });
    wrap.append(field('开始日期', stInput), field('结束日期', etInput));

    const sells = options.sells || [];
    const sellSelect = ui.el('select', {
      class: 'bt-select',
      onchange: (event) => { config.sell = event.target.value; },
    }, ...sells.map((item) => ui.el('option', {
      value: item.key,
      text: item.label,
      selected: item.key === config.sell ? true : null,
    })));
    wrap.append(field('卖盘策略', sellSelect,
      sells.find((item) => item.key === config.sell)?.label || ''));

    const engines = (options.engines || []);
    const engineSelect = ui.el('select', {
      class: 'bt-select',
      onchange: (event) => { config.engine = event.target.value; },
    }, ...engines.map((item) => ui.el('option', {
      value: item.key,
      text: item.available ? item.label : `${item.label}（不可用）`,
      disabled: item.available ? null : true,
      selected: item.key === config.engine ? true : null,
    })));
    wrap.append(field('回测引擎', engineSelect));

    // 策略参数
    (options.params || []).forEach((spec) => {
      const value = config.params[spec.key];
      let control;
      if (spec.type === 'bool') {
        control = ui.el('input', {
          type: 'checkbox', class: 'bt-check',
          checked: value ? true : null,
          onchange: (event) => { config.params[spec.key] = event.target.checked; },
        });
      } else if (spec.type === 'enum') {
        control = ui.el('select', {
          class: 'bt-select',
          onchange: (event) => { config.params[spec.key] = event.target.value; },
        }, ...(spec.options || []).map(([key, label]) => ui.el('option', {
          value: key, text: label, selected: key === value ? true : null,
        })));
      } else {
        control = ui.el('input', {
          type: 'number', class: 'bt-number',
          value: String(value ?? ''),
          min: spec.min !== undefined ? String(spec.min) : null,
          max: spec.max !== undefined ? String(spec.max) : null,
          step: spec.step !== undefined ? String(spec.step) : (spec.type === 'int' ? '1' : '0.1'),
          onchange: (event) => { config.params[spec.key] = event.target.value; },
        });
      }
      wrap.append(field(spec.label, control, spec.help || ''));
    });

    const runBtn = ui.el('button', {
      type: 'button', class: 'btn btn-primary btn-sm', text: state.btLoading ? '回测中…' : '测试',
      title: '按当前参数执行 select + backtest',
      onclick: () => runBacktest(policy, { force: true }),
    });
    if (state.btLoading) runBtn.disabled = true;

    const resetBtn = ui.el('button', {
      type: 'button', class: 'btn btn-sm', text: '重置默认',
      onclick: () => {
        state.configs.set(policy.id, defaultConfig(options));
        renderDetail();
      },
    });
    wrap.append(ui.el('div', { class: 'bt-actions' }, runBtn, resetBtn));
    return wrap;
  }

  function defaultConfig(options) {
    const params = {};
    (options.params || []).forEach((spec) => { params[spec.key] = spec.default; });
    return {
      st: options.defaults.st,
      et: options.defaults.et,
      sell: options.defaults.sell,
      engine: options.defaults.engine,
      params,
    };
  }

  function renderBtResult(container, policy, bt, config) {
    const trades = Array.isArray(bt.trades) ? bt.trades : [];
    const equity = Array.isArray(bt.equity) ? bt.equity : [];
    const cfg = bt.config || {};
    const tradeDays = cfg.trade_days
      || (config ? Math.max(1, (bt.range && bt.range.st && bt.range.et) ? 1 : 1) : 0);

    container.append(ui.el('div', { class: 'bt-config-line' },
      ui.badge(`区间 ${cfg.st || '—'} ~ ${cfg.et || '—'}`, 'primary'),
      ui.badge(`${tradeDays || '—'} 个交易日`, 'missing'),
      ui.badge(`卖盘 ${cfg.sell_label || cfg.sell || '—'}`, 'missing'),
      ui.badge(`引擎 ${cfg.engine_label || cfg.engine || 'bt'}`, 'missing'),
    ));

    const status = bt.status || 'ok';
    if (status === 'error') {
      container.append(ui.el('div', { class: 'bt-error' },
        ui.el('div', { class: 'bt-unavailable-title' }, ui.el('span', { text: '回测失败' })),
        ui.el('div', { class: 'bt-unavailable-text', text: bt.error || '未知错误' })));
      return;
    }
    if (BT_UNAVAILABLE_STATUS.has(status) || (status === 'empty' && !trades.length)) {
      container.append(btUnavailableNode(policy, bt.error || '所选区间内无选股信号'));
      return;
    }

    container.append(renderBtMetrics(bt.metrics || {}, trades, tradeDays));

    const chartsWrap = ui.el('div', { class: 'bt-charts' });
    const equityEl = ui.el('div', { class: 'chart chart-sm' });
    const tradesEl = ui.el('div', { class: 'chart chart-sm' });
    chartsWrap.append(
      ui.el('div', { class: 'bt-chart-box' },
        ui.el('div', { class: 'detail-section-sub', text: '净值曲线（按买入日等权复利）' }), equityEl),
      ui.el('div', { class: 'bt-chart-box' },
        ui.el('div', { class: 'detail-section-sub', text: '逐笔收益' }), tradesEl),
    );
    container.append(chartsWrap);
    btChartTargets.push({ el: equityEl, option: buildEquityOption(equity) });
    btChartTargets.push({ el: tradesEl, option: buildTradeBarOption(trades) });

    container.append(ui.el('div', { class: 'detail-section-sub', text: `逐笔明细（${trades.length} 笔）` }));
    container.append(renderTradesTable(trades));
  }

  function renderBtCard(policy) {
    const options = state.optionsById.get(policy.id) || null;
    const config = state.configs.get(policy.id) || null;
    const card = ui.card({
      title: 'BT 回测',
      sub: '日期区间 / 卖盘策略 / 回测引擎 / 策略参数 → 点击「测试」重跑 select + backtest',
      className: 'bt-panel',
      extra: ui.badge('加载中…', 'primary'),
    });

    if (!options || !config) {
      card.body.append(ui.loadingState('回测参数加载中…'));
      return card.root;
    }
    if (!options.supported) {
      card.setExtra(ui.badge('不可回测', 'missing'));
      card.body.append(btUnavailableNode(policy, options.unsupported_reason));
      return card.root;
    }

    card.setExtra(ui.inlineGroup(
      ui.badge(state.btLoading ? '回测中…' : (state.bt ? `状态 ${state.bt.status || 'ok'}` : '待测试'),
        state.btLoading ? 'primary' : (state.bt && state.bt.status === 'error' ? 'error' : 'missing')),
      ui.badge(options.vbt_available ? 'vbt 可用' : 'vbt 不可用', options.vbt_available ? 'missing' : 'warn'),
    ));
    card.body.append(buildBtControls(policy, options, config));

    const resultBox = ui.el('div', { class: 'bt-result' });
    if (state.btLoading) {
      resultBox.append(ui.loadingState('回测计算中…（冷启动可能 20~90s）'));
    } else if (state.btError) {
      resultBox.append(ui.errorState(state.btError, () => runBacktest(policy, { force: true })));
    } else if (!state.bt) {
      resultBox.append(ui.emptyState('尚未回测', '调整参数后点击「测试」'));
    } else {
      renderBtResult(resultBox, policy, state.bt, config);
    }
    card.body.append(resultBox);
    return card.root;
  }

  /* ================================================================== */
  /* 右侧 1.4 个股 K 线（底部）：BT 逐笔区间 / 目标股近 N 日             */
  /* ================================================================== */
  function applyStockDays(raw) {
    const num = Math.round(Number(raw));
    if (!Number.isFinite(num) || num <= 0) {
      ui.toast('请输入 1~250 的天数', 'warn');
      return;
    }
    const value = Math.max(1, Math.min(MAX_STOCK_DAYS, num));
    if (value !== num) ui.toast(`天数已调整为 ${value}（允许范围 1~250）`, 'warn');
    state.stockDays = value;
    if (state.stock && state.stock.mode === 'target') {
      state.stock.days = value;
      loadStock();
    } else {
      renderDetail();
    }
  }

  function stockDaysControls() {
    const seg = ui.segControl(
      STOCK_DAY_PRESETS.map((value) => ({ value, label: String(value) })),
      state.stockDays,
      (value) => {
        state.stockDays = Number(value);
        if (state.stock && state.stock.mode === 'target') {
          state.stock.days = state.stockDays;
          loadStock();
        }
      },
    );
    const input = ui.el('input', {
      type: 'number', min: '1', max: String(MAX_STOCK_DAYS), step: '1',
      class: 'bt-number', style: { width: '78px' }, value: String(state.stockDays),
      title: '自定义天数（1~250，回车生效）',
      onkeydown: (event) => { if (event.key === 'Enter') applyStockDays(input.value); },
    });
    const applyBtn = ui.el('button', {
      type: 'button', class: 'btn btn-sm', text: '应用',
      onclick: () => applyStockDays(input.value),
    });
    return ui.el('div', { class: 'card-extra-row' }, seg.root, input, applyBtn);
  }

  function renderStockCard() {
    const stock = state.stock;
    const hasStock = Boolean(stock && stock.symbol);
    const displayName = hasStock ? `${stock.name || ''} ${stock.symbol}`.trim() : '';
    const card = ui.card({
      title: hasStock ? `个股 K 线 · ${displayName}` : '个股 K 线',
      sub: '点击「逐笔明细」或「目标股列表」中的个股查看 K 线（含 MA5/10/20/30/60/120）',
      extra: ui.badge('未选择', 'missing'),
    });
    if (!hasStock) {
      card.body.append(ui.emptyState('点击「逐笔明细」或「目标股列表」中的个股查看 K 线',
        '逐笔 = 回测区间（含结束日后一交易日）；目标股 = 近 30/60/90/120/250/自定义 日'));
      return card.root;
    }
    let subText = '';
    if (stock.mode === 'bt') {
      subText = `回测区间 ${stock.st} ~ 结束日的后一交易日 · 可直接对照买入/卖出日`;
      card.setSub(subText);
      card.setExtra(ui.inlineGroup(
        ui.badge('BT 逐笔区间', 'primary'),
        ui.badge(`${stock.symbol}`, 'missing'),
      ));
    } else {
      subText = `目标股日线 · 近 ${stock.days} 个交易日（可切换 30/60/90/120/250/自定义）`;
      card.setSub(subText);
      card.setExtra(ui.inlineGroup(
        ui.badge('目标股', 'primary'),
        stockDaysControls(),
      ));
    }
    if (state.stockLoading) {
      card.body.append(ui.loadingState('K 线加载中…'));
      return card.root;
    }
    if (state.stockError) {
      card.body.append(ui.errorState(state.stockError, () => loadStock()));
      return card.root;
    }
    const bars = (state.stockData && state.stockData.bars) || [];
    if (!bars.length) {
      card.body.append(ui.emptyState('暂无 K 线数据'));
      return card.root;
    }
    card.setSub(`${subText} · ${bars[0].date} ~ ${bars[bars.length - 1].date}（${bars.length} 根）`);
    card.body.append(ui.el('div', { class: 'chart chart-lg' }));
    return card.root;
  }

  /** 按日期加载某策略的目标股（原地刷新目标股卡片，不动 BT 图表） */
  async function loadTargetsByDate(policyId, date) {
    const policy = state.items.find((item) => item.id === policyId);
    if (!policy) return;
    // 允许加载中再次选择日期：递增序号，旧的响应到达后直接丢弃
    const seq = ++state.targetsSeq;
    state.targetsLoading = true;
    state.targetsPendingDate = date || '';
    state.targetsCollapsed = false;
    refreshTargetsCard();
    try {
      const params = {};
      if (date) params.date = date;
      const data = await api.get(
        `/api/policies/${encodeURIComponent(policyId)}/targets`, { params, timeout: 180000 });
      if (!root.isConnected || seq !== state.targetsSeq) return;
      state.targetsDates = Array.isArray(data.available_dates) ? data.available_dates : state.targetsDates;
      policy.targets = Array.isArray(data.targets) ? data.targets : [];
      policy.signal_date = data.signal_date;
      policy.target_date = data.target_date;
      policy.next_trade_date = data.next_trade_date;
      policy.status_text = data.status_text;
      policy.targets_date = data.date;
      policy.targets_requested = data.requested_date;
      policy.targets_snapped = Boolean(data.snapped);
    } catch (err) {
      if (seq !== state.targetsSeq) return;
      ui.toast(`目标股加载失败：${err.detail || err.message}`, 'err', { duration: 5200 });
    } finally {
      if (seq === state.targetsSeq) {
        state.targetsLoading = false;
        state.targetsPendingDate = '';
        if (root.isConnected) refreshTargetsCard();
      }
    }
  }

  /** 只重绘目标股卡片（不触碰 BT 卡片 / 图表） */
  function refreshTargetsCard() {
    const policy = selectedPolicy();
    if (!policy || !targetsCardEl || !targetsCardEl.isConnected) return;
    const node = renderTargetsCard(policy);
    targetsCardEl.replaceWith(node);
    targetsCardEl = node;
  }

  /** 只重绘个股 K 线卡片并重建该图（不触碰上方 BT 图表，避免无谓重绘） */
  function refreshStockCard() {
    if (!stockCardEl || !stockCardEl.isConnected) return;
    if (stockChart) {
      stockChart.dispose();
      stockChart = null;
    }
    const node = renderStockCard();
    stockCardEl.replaceWith(node);
    stockCardEl = node;
    const chartEl = node.querySelector('.chart');
    const bars = (state.stockData && state.stockData.bars) || [];
    if (chartEl && bars.length) {
      stockChart = ui.createChart(chartEl, buildStockKlineOption(bars));
    }
  }

  function selectStockBt(symbol, name) {
    const cfg = state.bt && state.bt.config;
    if (!cfg || !cfg.st) {
      ui.toast('请先完成一次 BT 回测后再点击逐笔', 'warn');
      return;
    }
    state.stock = { mode: 'bt', symbol, name, st: cfg.st, et: cfg.et };
    state.stockData = null;
    state.stockError = null;
    // 点击逐笔明细 → 自动折叠目标股列表，方便对照下方 K 线
    if (!state.targetsCollapsed) {
      state.targetsCollapsed = true;
      refreshTargetsCard();
    }
    refreshStockCard();
    loadStock();
  }

  function selectStockTarget(symbol, name) {
    state.stock = { mode: 'target', symbol, name, days: state.stockDays };
    state.stockData = null;
    state.stockError = null;
    refreshStockCard();
    loadStock();
  }

  async function loadStock() {
    const stock = state.stock;
    if (!stock || !stock.symbol) return;
    const seq = ++state.stockSeq;
    state.stockLoading = true;
    state.stockError = null;
    refreshStockCard();
    try {
      const params = { symbol: stock.symbol };
      if (stock.mode === 'bt') {
        params.start = stock.st;
        params.end = stock.et;
        params.extend = 1;                 // 含回测结束日的后一交易日（= 卖出日）
      } else {
        params.days = stock.days;
      }
      const data = await api.get('/api/market/stock', { params, timeout: 30000 });
      if (!root.isConnected || seq !== state.stockSeq) return;
      state.stockData = data;
    } catch (err) {
      if (seq !== state.stockSeq) return;
      state.stockError = err;
    } finally {
      if (seq === state.stockSeq) {
        state.stockLoading = false;
        if (root.isConnected) refreshStockCard();
      }
    }
  }

  /* ================================================================== */
  /* 右侧详情渲染                                                        */
  /* ================================================================== */
  function renderDetail() {
    disposeBtCharts();
    btChartTargets = [];
    const policy = selectedPolicy();
    if (!policy) {
      detailEl.replaceChildren(ui.el('div', { class: 'card', style: { padding: '28px' } },
        ui.loadingState('策略加载中…')));
      return;
    }
    if (stockChart) {
      stockChart.dispose();
      stockChart = null;
    }
    targetsCardEl = renderTargetsCard(policy);
    stockCardEl = renderStockCard();
    detailEl.replaceChildren(
      renderSummaryCard(policy),
      renderBtCard(policy),
      targetsCardEl,
      stockCardEl,
    );
    const stockChartEl = stockCardEl.querySelector('.chart');
    const stockBars = (state.stockData && state.stockData.bars) || [];
    if (stockChartEl && stockBars.length) {
      stockChart = ui.createChart(stockChartEl, buildStockKlineOption(stockBars));
    }
    // DOM 插入后再初始化图表（ECharts 需要已挂载的容器）
    btChartTargets.forEach(({ el, option }) => {
      if (el && el.isConnected) btCharts.push(ui.createChart(el, option));
    });
    btChartTargets = [];
  }

  function renderAll() {
    renderSidebar();
    renderDetail();
    updateToolbar();
  }

  /* ================================================================== */
  /* 数据加载                                                            */
  /* ================================================================== */
  async function ensureOptions(id, { force = false } = {}) {
    if (!force && state.optionsById.has(id)) return state.optionsById.get(id);
    if (state.optionsLoading.has(id)) return null;
    state.optionsLoading.add(id);
    try {
      const data = await api.get(`/api/policies/${encodeURIComponent(id)}/backtest/options`, {
        timeout: 30000,
      });
      state.optionsById.set(id, data);
      if (!state.configs.has(id)) state.configs.set(id, defaultConfig(data));
      return data;
    } catch (err) {
      ui.toast(`回测参数加载失败：${err.detail || err.message}`, 'err', { duration: 5200 });
      return null;
    } finally {
      state.optionsLoading.delete(id);
    }
  }

  async function runBacktest(policy, { force = false } = {}) {
    const options = state.optionsById.get(policy.id);
    const config = state.configs.get(policy.id);
    if (!options || !config) return;
    if (!options.supported) { renderDetail(); return; }
    const key = configKey(policy.id, config);
    if (!force && state.btCache.has(key)) {
      state.bt = state.btCache.get(key);
      state.btError = null;
      renderDetail();
      return;
    }
    const seq = ++state.btSeq;
    state.btLoading = true;
    state.btError = null;
    state.bt = null;
    renderDetail();
    try {
      let data;
      if (api.isForcedMock()) {
        // 示例模式：本地生成（与后端字段结构一致）
        const tradeDays = 20;
        data = mockBacktest(`/api/policies/${policy.id}/backtest`, { days: tradeDays });
        data = { ...data, config: { st: config.st, et: config.et, trade_days: tradeDays,
          sell: config.sell, sell_label: config.sell, engine: config.engine, engine_label: config.engine } };
      } else {
        data = await api.post(`/api/policies/${encodeURIComponent(policy.id)}/test`, {
          body: {
            start: config.st,
            end: config.et,
            sell: config.sell,
            engine: config.engine,
            params: config.params,
          },
          timeout: 240000,
        });
      }
      if (!root.isConnected || seq !== state.btSeq) return;
      state.btCache.set(key, data);
      state.bt = data;
    } catch (err) {
      if (!root.isConnected || seq !== state.btSeq) return;
      state.btError = err;
    } finally {
      if (seq === state.btSeq) {
        state.btLoading = false;
        if (root.isConnected) renderDetail();
      }
    }
  }

  async function ensureBacktestFor(id, { force = false } = {}) {
    const policy = state.items.find((item) => item.id === id);
    if (!policy) return;
    const seq = ++state.prepSeq;
    state.bt = null;
    state.btError = null;
    state.btLoading = false;
    renderAll();
    // 目标股列表：默认取「最新交易日」（该日无数据即显示「没有数据」，不回退），
    // 与 /api/policies 的「最近信号日」口径区分开，因此单独拉一次。
    loadTargetsByDate(id, '').catch(() => {});
    const options = await ensureOptions(id, { force });
    if (!root.isConnected || seq !== state.prepSeq) return;
    renderAll();
    if (!options || !options.supported) return;
    const config = state.configs.get(id);
    const cached = state.btCache.get(configKey(id, config));
    if (cached) {
      state.bt = cached;
      renderDetail();
      return;
    }
    await runBacktest(policy);
  }

  function selectPolicy(id) {
    if (!id || id === state.selectedId) return;
    state.selectedId = id;
    state.targetsDate = '';
    state.targetsDates = [];
    state.targetsSeq += 1;          // 丢弃上一个策略的在途请求
    state.targetsLoading = false;
    state.targetsPendingDate = '';
    const policy = state.items.find((item) => item.id === id);
    if (policy) {
      policy.targets_date = null;
      policy.targets_requested = null;
      policy.targets_snapped = false;
    }
    renderAll();
    ensureBacktestFor(id);
  }

  async function loadPolicies({ silent = false } = {}) {
    if (!silent) {
      detailEl.replaceChildren(ui.el('div', { class: 'card', style: { padding: '28px' } },
        ui.loadingState('策略加载中…')));
    }
    try {
      const data = await api.get('/api/policies', { params: { date: 'latest' }, timeout: 180000 });
      if (!root.isConnected) return;
      state.meta = data.meta || null;
      state.items = Array.isArray(data.items) ? data.items : [];
      if (!state.items.length) {
        detailEl.replaceChildren(ui.emptyState('暂无策略数据', '后端 /api/policies 返回空列表'));
        sidebarListEl.replaceChildren(ui.emptyState('暂无策略'));
        sourceBadge.textContent = (state.meta && state.meta.date) || '—';
        updateToolbar();
        return;
      }
      if (!state.items.some((item) => item.id === state.selectedId)) {
        state.selectedId = state.items[0].id;
      }
      renderAll();
      ensureBacktestFor(state.selectedId);
    } catch (err) {
      if (!root.isConnected) return;
      if (silent && state.items.length) {
        ui.toast(`策略列表刷新失败：${err.detail || err.message}`, 'warn');
        return;
      }
      detailEl.replaceChildren(ui.errorState(err, () => loadPolicies()));
      sourceBadge.textContent = '加载失败';
      sourceBadge.className = 'badge badge-error';
      sourceText.textContent = `数据来源：加载失败（${err.detail || err.message}）`;
      refreshBtn.disabled = true;
    }
  }

  /* ================================================================== */
  /* 重新计算（POST /api/policies/{id}/refresh）                          */
  /* ================================================================== */
  async function handleRefresh(policyId) {
    const policy = policyId
      ? state.items.find((item) => item.id === policyId)
      : selectedPolicy();
    if (!policy || state.refreshingId) return;
    if (api.isForcedMock()) {
      ui.toast('当前为「示例数据」模式，无法触发后端重算；请先切回实时模式', 'warn', { duration: 4200 });
      return;
    }
    state.refreshingId = policy.id;
    state.selectedId = policy.id;
    renderAll();
    try {
      const data = await api.post(`/api/policies/${encodeURIComponent(policy.id)}/refresh`, {
        params: { days: 20 },
        timeout: 240000,
      });
      if (!root.isConnected) return;
      const item = data && data.item ? data.item : data && data.id ? data : null;
      if (item) {
        state.items = state.items.map((old) => (old.id === item.id ? { ...old, ...item } : old));
      }
      state.btCache.clear();
      ui.toast(`「${policy.title}」重算完成（目标股）`, 'ok', { duration: 4200 });
      await loadPolicies({ silent: true });
    } catch (err) {
      const extra = err && err.kind === 'timeout' ? '（后端冷启动可能 1~40s，请稍后重试）' : '';
      ui.toast(`「${policy.title}」重算失败：${err.detail || err.message}${extra}`, 'err', { duration: 6500 });
    } finally {
      state.refreshingId = null;
      if (root.isConnected) renderAll();
    }
  }

  /* ---------- 清理 ---------- */
  function cleanup() {
    disposeBtCharts();
    if (stockChart) {
      stockChart.dispose();
      stockChart = null;
    }
  }

  setSidebarCollapsed(false);
  renderAll();
  loadPolicies();
  return cleanup;
}

export default { id: 'policy', title: '策略看板', mount };
