/**
 * pages/concept.js — 概念看板（#/concept）
 *
 * 区块：
 * ① 概念涨幅榜 / 概念跌幅榜（条数 10 / 20 / 全部；日期可由日历选择，最多回溯一年）
 * ② 概念详情：N 日概念涨幅折线（10/20/30/60/90/120/250/自定义）+ 成分股表格
 * ③ 个股 K 线：点击「成分股」中的个股，在页面底部展示其 K 线（根数 = 详情天数）
 *
 * 口径（ARCH.md §4.3 / §5.3）：概念涨幅 = 成分股当日 chg 均值；概念集为全量 191 个。
 */

import * as api from '../api.js';
import { buildStockKlineOption } from '../kline.js';
import * as ui from '../ui.js';

const MOCK_END = '2026-10-30';
const { CHART_COLORS } = ui;

/* ================================================================== */
/* 内置示例数据                                                        */
/* ================================================================== */

const MOCK_CONCEPTS = [
  ['GT-CP', '固态-产品'], ['CPO', 'CPO 概念'], ['GMK', '光模块'], ['LQ', '液冷服务器'],
  ['SL', '算力租赁'], ['ROB', '人形机器人'], ['CX', '创新药'], ['BC', '存储芯片'],
  ['GD', '光刻机'], ['HD', '核聚变'], ['DZ', '低空经济'], ['SJ', '数据要素'],
  ['JG', '军工信息化'], ['GF', '光伏设备'], ['CN', '储能'], ['BJ', '白酒'],
  ['YH', '银行'], ['ZQ', '证券'], ['BS', '半导体设备'], ['XNY', '新能源车'],
  ['AI', 'AI 应用'], ['HW', '华为产业链'], ['PP', '苹果产业链'], ['DL', '电力'],
  ['MT', '煤炭'],
];

const MOCK_STOCKS = [
  ['300750', '宁德时代'], ['002594', '比亚迪'], ['300502', '新易盛'], ['000063', '中兴通讯'],
  ['688981', '中芯国际'], ['300308', '中际旭创'], ['002050', '三花智控'], ['601899', '紫金矿业'],
  ['600519', '贵州茅台'], ['000001', '平安银行'], ['002415', '海康威视'], ['600030', '中信证券'],
  ['601012', '隆基绿能'], ['300059', '东方财富'], ['002475', '立讯精密'], ['688111', '金山办公'],
  ['300124', '汇川技术'], ['002230', '科大讯飞'],
];

const MOCK_CONCEPT_TOTAL = 191;

let statsCache = null;

/** 生成稳定的概念统计（涨幅均值 / 成分数 / 红绿数）；示例数据补足 191 个概念 */
function conceptStats() {
  if (statsCache) return statsCache;
  const rand = ui.seededRandom(20261030);
  const catalog = [...MOCK_CONCEPTS];
  while (catalog.length < MOCK_CONCEPT_TOTAL) {
    const i = catalog.length + 1;
    catalog.push([`GEN${String(i).padStart(3, '0')}`, `模拟概念${i}`]);
  }
  statsCache = catalog.map(([code, name]) => {
    const sign = rand() < 0.5 ? -1 : 1;
    const chg = Number((sign * (0.3 + Math.pow(rand(), 0.6) * 7.5)).toFixed(2));
    const count = 3 + Math.floor(rand() * 12);
    const redRatio = Math.min(1, Math.max(0, 0.5 + chg / 9));
    const red = Math.min(count, Math.round(count * redRatio));
    return { code, name, chg_avg: chg, count, red, green: count - red };
  });
  return statsCache;
}

function mockRank(params = {}) {
  const raw = Number(params.limit);
  const all = !raw || raw <= 0;
  const sorted = [...conceptStats()].sort((a, b) => b.chg_avg - a.chg_avg);
  const limit = all ? sorted.length : Math.min(raw, sorted.length);
  const date = String(params.date || MOCK_END);
  const pick = (item) => ({
    code: item.code,
    name: item.name,
    chg_avg: item.chg_avg,
    count: item.count,
    red: item.red,
    green: item.green,
  });
  return {
    meta: { date, generated_at: '2026-11-01T20:10:00+08:00', source: 'db', cached: true },
    date,
    requested_date: date,
    limit: all ? 'all' : limit,
    concept_count: sorted.length,
    top: sorted.slice(0, limit).map(pick),
    bottom: (all ? [...sorted].reverse() : sorted.slice(-limit).reverse()).map(pick),
  };
}

function parseCodeFromPath(path) {
  const clean = String(path || '').split('?')[0];
  return decodeURIComponent(clean.split('/').filter(Boolean).pop() || '');
}

function mockDetail(path, params = {}) {
  const code = parseCodeFromPath(path);
  const stat = conceptStats().find((item) => item.code === code) || conceptStats()[0];
  const rand = ui.seededRandom(`${code}#detail`.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 7));
  const days = Math.max(1, Math.min(250, Number(params.days) || 20));
  const end = String(params.date || MOCK_END);
  const dates = ui.recentTradeDates(days, end);

  // 从当前涨幅向前回溯，得到 N 日概念涨幅曲线（末值 = chg_avg）
  const historyValues = new Array(dates.length).fill(0);
  historyValues[historyValues.length - 1] = stat.chg_avg;
  for (let i = dates.length - 2; i >= 0; i -= 1) {
    const prev = historyValues[i + 1] + (rand() - 0.5) * 3.4 - historyValues[i + 1] * 0.12;
    historyValues[i] = Number(prev.toFixed(2));
  }
  const history = dates.map((date, i) => ({
    date,
    chg_avg: historyValues[i],
    count: Math.max(2, stat.count + Math.round((rand() - 0.5) * 2)),
  }));

  const count = Math.min(stat.count, MOCK_STOCKS.length);
  const shuffled = [...MOCK_STOCKS].sort(() => rand() - 0.5).slice(0, count);
  const symbols = shuffled
    .map(([symbol, name], i) => {
      const chg = Number((stat.chg_avg + (rand() - 0.48) * 7 + (i < 2 ? 1.6 : 0)).toFixed(2));
      const basePrice = 12 + rand() * 240;
      return {
        symbol,
        name,
        open: Number((basePrice * (1 - chg / 400)).toFixed(2)),
        high: Number((basePrice * (1 + Math.abs(chg) / 160 + 0.01)).toFixed(2)),
        low: Number((basePrice * (1 - Math.abs(chg) / 140 - 0.012)).toFixed(2)),
        close: Number(basePrice.toFixed(2)),
        chg,
        amount: Math.round((1.2 + rand() * 18) * 1e9),
        vol: Math.round((0.6 + rand() * 8) * 1e5),
      };
    })
    .sort((a, b) => b.chg - a.chg);

  return {
    meta: { date: end, generated_at: '2026-11-01T20:10:00+08:00', source: 'db', cached: true },
    code: stat.code,
    name: stat.name,
    date: end,
    requested_date: end,
    days,
    range: { st: dates[0], et: dates[dates.length - 1] },
    chg_avg: stat.chg_avg,
    count: stat.count,
    red: stat.red,
    green: stat.green,
    history,
    symbols,
  };
}

api.registerMock('/api/concepts/rank', (ctx) => mockRank(ctx.params || {}), '概念涨幅榜');
api.registerMock(/^\/api\/concepts\/[^/?]+/,
  (ctx) => mockDetail(ctx.path, ctx.params || {}), '概念详情');

/** 个股日线示例数据（概念看板底部 K 线） */
function mockStockBars(symbol, days, end) {
  const rand = ui.seededRandom(`${symbol}#kline`);
  const dates = ui.recentTradeDates(days, end);
  let price = 8 + rand() * 90;
  const bars = dates.map((date) => {
    const chg = Number(((rand() - 0.48) * 6.4).toFixed(2));
    const open = Number((price * (1 - chg / 500)).toFixed(2));
    const close = Number((open * (1 + chg / 100)).toFixed(2));
    const high = Number((Math.max(open, close) * (1 + rand() * 0.02)).toFixed(2));
    const low = Number((Math.min(open, close) * (1 - rand() * 0.02)).toFixed(2));
    price = close;
    return { date, open, high, low, close, chg,
             vol: Math.round((0.8 + rand() * 9) * 1e5),
             amount: Math.round((1 + rand() * 20) * 1e9) };
  });
  return bars;
}

api.registerMock(/^\/api\/market\/stock(?:\?|$)/, (ctx) => {
  const params = ctx.params || {};
  const symbol = String(params.symbol || '300750');
  const days = Math.max(1, Math.min(250, Number(params.days) || 120));
  const end = String(params.end || MOCK_END);
  const bars = mockStockBars(symbol, days, end);
  const known = MOCK_STOCKS.find((item) => item[0] === symbol);
  return {
    meta: { date: end, generated_at: '2026-11-01T20:10:00+08:00', source: 'db', cached: true },
    symbol,
    name: known ? known[1] : symbol,
    days,
    date: bars[bars.length - 1].date,
    bars,
  };
}, '个股日线');

/* ================================================================== */
/* 图表 option                                                         */
/* ================================================================== */

function buildHistoryOption(history) {
  const dates = history.map((item) => String(item.date).slice(5));
  const values = history.map((item) => item.chg_avg);
  const last = history[history.length - 1];
  const lastColor = last && last.chg_avg >= 0 ? CHART_COLORS.up : CHART_COLORS.down;

  return {
    animationDuration: 380,
    tooltip: {
      trigger: 'axis',
      formatter(params) {
        if (!params || !params.length) return '';
        const item = history[params[0].dataIndex];
        if (!item) return '';
        return [
          `<div style="font-weight:600;margin-bottom:4px">${item.date}</div>`,
          `<div>概念涨幅 <b style="color:${item.chg_avg >= 0 ? CHART_COLORS.up : CHART_COLORS.down}">${ui.fmtPct(item.chg_avg)}</b></div>`,
          `<div>成分股 <b>${item.count}</b> 只</div>`,
        ].join('');
      },
    },
    grid: { left: 48, right: 18, top: 22, bottom: 26 },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { interval: Math.max(0, Math.floor(dates.length / 7) - 1) },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value) => `${Number(value).toFixed(1)}%` },
    },
    series: [
      {
        name: '概念涨幅',
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2, color: CHART_COLORS.primary },
        itemStyle: { color: CHART_COLORS.primary, borderColor: '#0b0f17', borderWidth: 1 },
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
        markPoint: last
          ? {
              symbol: 'circle',
              symbolSize: 9,
              label: { show: false },
              itemStyle: { color: lastColor, borderColor: '#0b0f17', borderWidth: 2 },
              data: [{ coord: [dates.length - 1, last.chg_avg] }],
            }
          : undefined,
      },
    ],
  };
}

/** 个股 K 线（蜡烛 + 成交量） */
/* ================================================================== */
/* 页面                                                                */
/* ================================================================== */

function mount(root) {
  const state = {
    limit: 10, // 10 / 20 / 0（全部）
    date: null, // 概念数据日期（日历选择）
    detailDays: 20, // 概念详情展示天数（10~250）
    selectedCode: null,
    stockSymbol: null, // 底部个股 K 线当前标的
    rankData: null,
    detail: null,
    rankSeq: 0,
    detailSeq: 0,
    stockSeq: 0,
    filters: { top: '', bottom: '' }, // 涨幅榜 / 跌幅榜 关键词过滤（名称或代码模糊匹配）
  };

  const DETAIL_DAYS_PRESETS = [10, 20, 30, 60, 90, 120, 250];
  const MAX_DETAIL_DAYS = 250;

  let historyChart = null;
  let stockChart = null;

  /* ---------- 页头 ---------- */
  const dateBadge = ui.badge('加载中…', 'primary');
  const limitSeg = ui.segControl(
    [
      { value: 10, label: '10' },
      { value: 20, label: '20' },
      { value: 0, label: '全部' },
    ],
    state.limit,
    (value) => {
      state.limit = Number(value);
      loadRank();
    },
  );

  /** 日期选择器：原生日历（最多回溯一年；上限 = 最近交易日） */
  const dateInput = ui.el('input', {
    type: 'date',
    class: 'date-input',
    title: '选择概念数据日期（最多回溯一年）',
    value: MOCK_END,
    max: MOCK_END,
    onchange: (event) => {
      const value = event.target.value;
      if (!value) return;
      if (state.date === value) return;
      state.date = value;
      loadRank();
    },
  });

  const hd = ui.el(
    'div',
    { class: 'page-hd' },
    ui.el(
      'div',
      {},
      ui.el('h1', { class: 'page-title', text: '概念看板' }),
      ui.el('div', {
        class: 'page-sub',
        text: '概念涨幅 = 成分股当日 chg 均值 · 日期可选（最多回溯一年）· 点击概念查看曲线与成分股，点击成分股看个股 K 线',
      }),
    ),
    ui.el(
      'div',
      { class: 'page-hd-right' },
      ui.el('span', { class: 'dim', style: { fontSize: '12px' }, text: '榜单条数' }),
      limitSeg.root,
      ui.el('span', { class: 'dim', style: { fontSize: '12px' }, text: '日期' }),
      dateInput,
      dateBadge,
    ),
  );
  root.append(hd);

  /* ---------- 行 1：涨幅榜 / 跌幅榜 ---------- */
  const rankGrid = ui.el('div', { class: 'grid grid-2' });

  /** 徽章内文字更新（badge 结构：span.badge > [i.badge-dot,] span.text） */
  function setBadgeText(node, text) {
    const target = node && node.lastElementChild;
    if (target) target.textContent = text;
  }

  /** 关键词过滤：概念名或代码模糊匹配（大小写不敏感） */
  function filterConcepts(items, keyword) {
    const kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return items;
    return items.filter((item) => String(item.name || '').toLowerCase().includes(kw)
      || String(item.code || '').toLowerCase().includes(kw));
  }

  function makeFilterInput(key) {
    return ui.el('input', {
      type: 'search',
      class: 'filter-input',
      placeholder: '筛选名称/代码',
      title: '输入概念名称或代码，模糊过滤榜单',
      oninput: (event) => {
        state.filters[key] = event.target.value;
        renderRankLists();
      },
    });
  }

  const topBadge = ui.badge('加载中…', 'primary');
  const topFilter = makeFilterInput('top');
  const topCard = ui.card({
    title: '概念涨幅榜',
    sub: '按成分股 chg 均值降序',
    bodyClass: 'is-flush',
    extra: ui.el('div', { class: 'card-extra-row' }, topBadge, topFilter),
  });
  const topList = ui.el('div', { class: 'rank-list' });
  topCard.body.append(topList);

  const bottomBadge = ui.badge('加载中…', 'primary');
  const bottomFilter = makeFilterInput('bottom');
  const bottomCard = ui.card({
    title: '概念跌幅榜',
    sub: '按成分股 chg 均值升序',
    bodyClass: 'is-flush',
    extra: ui.el('div', { class: 'card-extra-row' }, bottomBadge, bottomFilter),
  });
  const bottomList = ui.el('div', { class: 'rank-list' });
  bottomCard.body.append(bottomList);

  rankGrid.append(topCard.root, bottomCard.root);
  root.append(rankGrid);

  /* ---------- 行 2：详情（折线 + 成分股） ---------- */
  const detailGrid = ui.el('div', { class: 'grid detail-grid' });

  const historyCard = ui.card({
    title: '概念详情 · 20 日涨幅',
    sub: '点击上方概念切换',
    extra: ui.badge('加载中…', 'primary'),
  });
  const historyBody = ui.el('div', { class: 'chart-host' });

  /* 展示天数：10/20/30/60/90/120/250 + 自定义（≤250） */
  const daysSeg = ui.segControl(
    DETAIL_DAYS_PRESETS.map((value) => ({ value, label: String(value) })),
    state.detailDays,
    (value) => {
      state.detailDays = Number(value);
      if (state.selectedCode) loadDetail(state.selectedCode);
    },
  );
  const daysInput = ui.el('input', {
    type: 'number',
    min: '1',
    max: String(MAX_DETAIL_DAYS),
    step: '1',
    class: 'index-count-input',
    value: String(state.detailDays),
    title: '自定义天数（1~250，回车生效）',
    onkeydown: (event) => {
      if (event.key === 'Enter') applyDetailDays(daysInput.value);
    },
  });
  const daysApplyBtn = ui.el('button', {
    type: 'button',
    class: 'btn btn-sm',
    text: '应用',
    onclick: () => applyDetailDays(daysInput.value),
  });
  const historyToolbar = ui.el(
    'div',
    { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
    ui.el('span', { class: 'dim', style: { fontSize: '12px' }, text: '展示天数' }),
    daysSeg.root,
    daysInput,
    daysApplyBtn,
  );
  historyCard.body.append(historyToolbar, historyBody);

  /** 应用自定义天数（1~250 夹取 + toast） */
  function applyDetailDays(raw) {
    const num = Math.round(Number(raw));
    if (!Number.isFinite(num) || num <= 0) {
      ui.toast('请输入 1~250 的天数', 'warn');
      return;
    }
    const value = Math.max(1, Math.min(MAX_DETAIL_DAYS, num));
    if (value !== num) ui.toast(`天数已调整为 ${value}（允许范围 1~250）`, 'warn');
    state.detailDays = value;
    daysSeg.setActive(DETAIL_DAYS_PRESETS.includes(value) ? value : '__custom__');
    daysInput.value = String(value);
    if (state.selectedCode) loadDetail(state.selectedCode);
  }

  const symbolsCard = ui.card({
    title: '成分股',
    sub: '按涨跌幅降序',
    bodyClass: 'is-tight',
    extra: ui.badge('加载中…', 'primary'),
  });
  const symbolsTable = ui.dataTable({
    wrapClass: 'is-tall',
    emptyText: '暂无成分股数据',
    rowKey: (row) => row.symbol,
    onRowClick: (row) => loadStockChart(row.symbol),
    columns: [
      { key: 'symbol', title: '代码', className: 'sym', width: 84 },
      { key: 'name', title: '名称', className: 'name', width: 96 },
      { key: 'close', title: '收盘', align: 'right', render: (row) => ui.fmtPrice(row.close) },
      { key: 'chg', title: '涨跌幅', align: 'right', render: (row) => ui.pctSpan(row.chg) },
      { key: 'amount', title: '成交额(亿)', align: 'right', render: (row) => ui.fmtYi(row.amount) },
      { key: 'vol', title: '成交量(万手)', align: 'right', render: (row) => ui.fmtWanShou(row.vol) },
    ],
  });
  symbolsCard.body.append(symbolsTable.root);

  detailGrid.append(historyCard.root, symbolsCard.root);
  root.append(detailGrid);

  /* ---------- 行 3：个股 K 线（点击成分股后展示；根数 = 详情天数） ---------- */
  const stockCard = ui.card({
    title: '个股 K 线',
    sub: '点击上方「成分股」中的个股查看 K 线（根数与「概念详情」天数一致）',
    extra: ui.badge('未选择', 'missing'),
  });
  const stockBody = ui.el('div', { class: 'chart-host' });
  stockBody.append(ui.emptyState('点击「成分股」中的个股查看其 K 线',
    'K 线根数跟随「概念详情」的展示天数'));
  stockCard.body.append(stockBody);
  root.append(stockCard.root);

  symbolsTable.setLoading();

  /* ---------- 榜单渲染 ---------- */
  function makeRankItem(item, index, tone) {
    const node = ui.el(
      'div',
      {
        class: 'rank-item',
        dataset: { code: item.code },
        title: `${item.name}（${item.code}）· 成分 ${item.count} 只`,
        onclick: () => selectConcept(item.code),
      },
      ui.el(
        'div',
        { class: 'rank-main' },
        ui.el('span', { class: 'rank-index', text: String(index + 1) }),
        ui.el(
          'div',
          { style: { minWidth: '0' } },
          ui.el(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: '7px' } },
            ui.el('span', { class: 'rank-name', text: item.name }),
            ui.el('span', { class: 'rank-code', text: item.code }),
          ),
          ui.el('div', {
            class: 'rank-meta',
            text: `成分 ${item.count} 只 · 红 ${item.red} / 绿 ${item.green}`,
          }),
        ),
      ),
      ui.el('div', { class: `rank-chg ${ui.chgClass(item.chg_avg)}`, text: ui.fmtPct(item.chg_avg) }),
    );
    if (state.selectedCode && item.code === state.selectedCode) node.classList.add('is-active');
    return node;
  }

  function highlightSelected() {
    [topList, bottomList].forEach((list) => {
      Array.from(list.querySelectorAll('.rank-item')).forEach((node) => {
        node.classList.toggle('is-active', node.dataset.code === state.selectedCode);
      });
    });
  }

  function renderRankLists() {
    const data = state.rankData;
    if (!data) return;
    const topAll = Array.isArray(data.top) ? data.top : [];
    const bottomAll = Array.isArray(data.bottom) ? data.bottom : [];
    const top = filterConcepts(topAll, state.filters.top);
    const bottom = filterConcepts(bottomAll, state.filters.bottom);

    const renderList = (list, items, keyword, tone) => {
      if (!items.length) {
        list.replaceChildren(keyword
          ? ui.emptyState('无匹配概念', '换个关键词试试，如「固态」「GT-CP」')
          : ui.emptyState('暂无概念数据'));
        return;
      }
      list.replaceChildren(...items.map((item, i) => makeRankItem(item, i, tone)));
    };
    renderList(topList, top, state.filters.top, 'top');
    renderList(bottomList, bottom, state.filters.bottom, 'bottom');

    const allMode = data.limit === 'all';
    setBadgeText(topBadge, state.filters.top
      ? `TOP ${top.length}/${topAll.length}`
      : (allMode ? `全部 ${topAll.length}` : `TOP ${top.length}`));
    setBadgeText(bottomBadge, state.filters.bottom
      ? `BOTTOM ${bottom.length}/${bottomAll.length}`
      : (allMode ? `全部 ${bottomAll.length}` : `BOTTOM ${bottom.length}`));

    const snapped = data.requested_date && data.requested_date !== data.date;
    dateBadge.textContent = data.date || '—';
    if (snapped) {
      dateBadge.title = `${data.requested_date} 非交易日，已取最近交易日 ${data.date}`;
    } else {
      dateBadge.removeAttribute('title');
    }
    highlightSelected();
  }

  /* ---------- 数据加载：榜单 ---------- */
  async function loadRank() {
    const seq = ++state.rankSeq;
    topList.replaceChildren(ui.loadingState('加载中…'));
    bottomList.replaceChildren(ui.loadingState('加载中…'));
    setBadgeText(topBadge, '加载中…');
    setBadgeText(bottomBadge, '加载中…');
    try {
      const params = { limit: state.limit };
      if (state.date) params.date = state.date;
      const data = await api.get('/api/concepts/rank', {
        params,
        timeout: 20000,
      });
      if (!root.isConnected || seq !== state.rankSeq) return;
      state.rankData = data;
      renderRankLists();

      const codes = new Set([
        ...(data.top || []).map((item) => item.code),
        ...(data.bottom || []).map((item) => item.code),
      ]);
      const fallbackCode = (data.top && data.top[0] && data.top[0].code) || (data.bottom && data.bottom[0] && data.bottom[0].code) || null;
      const nextCode = state.selectedCode && codes.has(state.selectedCode) ? state.selectedCode : fallbackCode;
      if (nextCode) selectConcept(nextCode, { force: true });
    } catch (err) {
      if (!root.isConnected || seq !== state.rankSeq) return;
      topList.replaceChildren(ui.errorState(err, loadRank));
      bottomList.replaceChildren(ui.errorState(err, loadRank));
      setBadgeText(topBadge, '加载失败');
      setBadgeText(bottomBadge, '加载失败');
    }
  }

  /* ---------- 数据加载：概念详情 ---------- */
  async function loadDetail(code) {
    const seq = ++state.detailSeq;
    const conceptChanged = state.selectedCode !== code;
    state.selectedCode = code;
    highlightSelected();
    if (conceptChanged) resetStockChart();

    historyCard.setTitle(`概念详情 · ${state.detailDays} 日涨幅`);
    historyCard.setSub(`${code} · 加载中…`);
    historyCard.setExtra(ui.badge('加载中…', 'primary'));
    historyBody.replaceChildren(ui.skeletonBlock('190px'));

    symbolsCard.setTitle('成分股');
    symbolsCard.setExtra(ui.badge('加载中…', 'primary'));
    symbolsTable.setLoading();

    try {
      const params = { days: state.detailDays };
      if (state.date) params.date = state.date;
      const data = await api.get(`/api/concepts/${encodeURIComponent(code)}`, {
        params,
        timeout: 20000,
      });
      if (!root.isConnected || seq !== state.detailSeq) return;
      state.detail = data;

      const historyDays = data.days || state.detailDays;
      historyCard.setTitle(`概念详情 · ${data.name || code}`);
      historyCard.setSub(
        `${data.code || code} · ${data.date || '—'} · ${historyDays} 日概念涨幅曲线`,
      );
      const chgTone = ui.chgClass(data.chg_avg);
      historyCard.setExtra(
        ui.inlineGroup(
          ui.badge(`涨幅 ${ui.fmtPct(data.chg_avg)}`,
            chgTone === 'up' ? 'up' : chgTone === 'down' ? 'down' : 'missing'),
          ui.badge(`成分 ${data.count} 只`, 'missing'),
          ui.badge(`${historyDays} 日`, 'primary'),
          data.__mock ? ui.badge('示例', 'warn') : null,
        ),
      );

      const history = Array.isArray(data.history) ? data.history : [];
      if (!history.length) {
        historyBody.replaceChildren(ui.emptyState(`暂无 ${historyDays} 日涨幅数据`));
        if (historyChart) {
          historyChart.dispose();
          historyChart = null;
        }
      } else {
        const chartEl = ui.el('div', { class: 'chart chart-sm' });
        historyBody.replaceChildren(chartEl);
        if (historyChart) historyChart.dispose();
        historyChart = ui.createChart(chartEl, buildHistoryOption(history));
      }

      const symbols = Array.isArray(data.symbols) ? [...data.symbols] : [];
      symbols.sort((a, b) => (Number(b.chg) || 0) - (Number(a.chg) || 0));
      symbolsCard.setTitle(`成分股 · ${data.name || code}`);
      symbolsCard.setSub(`按涨跌幅降序 · 成分 ${symbols.length} 只 · ${data.date || '—'}`);
      symbolsCard.setExtra(
        ui.inlineGroup(
          ui.badge(`红 ${data.red || 0}`, 'up'),
          ui.badge(`绿 ${data.green || 0}`, 'down'),
        ),
      );
      symbolsTable.setRows(symbols);
      if (!symbols.length) symbolsTable.setEmpty('暂无成分股数据');
      // 天数/日期变化时同步刷新底部个股 K 线（根数与详情天数一致）
      if (state.stockSymbol) loadStockChart(state.stockSymbol);
    } catch (err) {
      if (!root.isConnected || seq !== state.detailSeq) return;
      historyBody.replaceChildren(ui.errorState(err, () => loadDetail(code)));
      historyCard.setExtra(ui.badge('加载失败', 'error'));
      symbolsTable.setError(err, () => loadDetail(code));
      symbolsCard.setExtra(ui.badge('加载失败', 'error'));
    }
  }

  /** 底部个股 K 线：根数 = 概念详情天数，截止日 = 所选日期 */
  async function loadStockChart(symbol) {
    if (!symbol) return;
    state.stockSymbol = symbol;
    const seq = ++state.stockSeq;
    const known = ((state.detail && state.detail.symbols) || []).find(
      (item) => item.symbol === symbol);
    const displayName = (known && known.name) || symbol;
    stockCard.setTitle(`个股 K 线 · ${displayName} ${symbol}`);
    stockCard.setSub('加载中…');
    stockCard.setExtra(ui.badge('加载中…', 'primary'));
    stockBody.replaceChildren(ui.skeletonBlock('300px'));
    try {
      const params = { symbol, days: state.detailDays };
      if (state.date) params.end = state.date;
      const data = await api.get('/api/market/stock', { params, timeout: 15000 });
      if (!root.isConnected || seq !== state.stockSeq) return;
      const bars = Array.isArray(data.bars) ? data.bars : [];
      if (!bars.length) {
        stockBody.replaceChildren(ui.emptyState('暂无该股 K 线数据'));
        stockCard.setExtra(ui.badge('无数据', 'empty'));
        return;
      }
      const first = bars[0];
      const last = bars[bars.length - 1];
      const tone = ui.chgClass(last.chg);
      const toneClass = tone === 'up' ? 'up' : tone === 'down' ? 'down' : 'missing';
      stockCard.setTitle(`个股 K 线 · ${data.name || displayName} ${symbol} · ${bars.length} 根`);
      stockCard.setSub(`${first.date} ~ ${last.date} · 根数与「概念详情」展示天数一致`);
      stockCard.setExtra(
        ui.inlineGroup(
          ui.badge(`收盘 ${ui.fmtPrice(last.close)}`, toneClass),
          ui.badge(`涨跌 ${ui.fmtPct(last.chg)}`, toneClass),
          ui.badge(`${bars.length} 根`, 'primary'),
          data.__mock ? ui.badge('示例', 'warn') : null,
        ),
      );
      const chartEl = ui.el('div', { class: 'chart chart-lg' });
      stockBody.replaceChildren(chartEl);
      if (stockChart) stockChart.dispose();
      stockChart = ui.createChart(chartEl, buildStockKlineOption(bars));
    } catch (err) {
      if (!root.isConnected || seq !== state.stockSeq) return;
      stockBody.replaceChildren(ui.errorState(err, () => loadStockChart(symbol)));
      stockCard.setExtra(ui.badge('加载失败', 'error'));
    }
  }

  function resetStockChart() {
    state.stockSymbol = null;
    state.stockSeq += 1;
    if (stockChart) {
      stockChart.dispose();
      stockChart = null;
    }
    stockCard.setTitle('个股 K 线');
    stockCard.setSub('点击上方「成分股」中的个股查看 K 线（根数与「概念详情」天数一致）');
    stockCard.setExtra(ui.badge('未选择', 'missing'));
    stockBody.replaceChildren(ui.emptyState('点击「成分股」中的个股查看其 K 线',
      'K 线根数跟随「概念详情」的展示天数'));
  }

  /** 日期初始化：上限 = 最近交易日，可回溯一年 */
  function shiftDate(dateStr, deltaDays) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + deltaDays);
    return date.toISOString().slice(0, 10);
  }

  async function initDateRange() {
    let latest = MOCK_END;
    try {
      const meta = await api.get('/api/meta', { timeout: 8000 });
      if (meta && meta.trade_date) latest = String(meta.trade_date);
    } catch (_err) {
      /* mock 降级：使用 MOCK_END */
    }
    state.date = state.date || latest;
    dateInput.max = latest;
    dateInput.min = shiftDate(latest, -365);
    dateInput.value = state.date;
  }

  function selectConcept(code, { force = false } = {}) {
    if (!code) return;
    if (!force && state.selectedCode === code) return;
    loadDetail(code);
  }

  /* ---------- 清理 ---------- */
  function cleanup() {
    if (historyChart) {
      historyChart.dispose();
      historyChart = null;
    }
    if (stockChart) {
      stockChart.dispose();
      stockChart = null;
    }
  }

  initDateRange().finally(() => loadRank());
  return cleanup;
}

export default { id: 'concept', title: '概念看板', mount };
