/**
 * ui.js — 通用 UI 工具：格式化 / DOM 组件 / 表格 / 状态位 / ECharts 主题
 *
 * 设计原则：
 * - 页面只关心「数据 → 结构」，样式类统一在这里产出；
 * - 所有数字使用等宽字体 + tabular-nums（CSS 控制）；
 * - 红涨绿跌：chg>0 → up（红），chg<0 → down（绿）；
 * - 图表统一使用 `qu-dark` 主题，容器尺寸变化自动 resize。
 */

/* ================================================================== */
/* 数值格式化                                                          */
/* ================================================================== */

/** 空值占位符 */
export const EMPTY = '—';

export function isNum(v) {
  return v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
}

/** 元 → 亿/万（带单位，用于摘要卡） */
export function fmtAmount(v) {
  if (!isNum(v)) return EMPTY;
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return n.toFixed(0);
}

/** 元 → 亿（纯数字，列头标注单位时使用） */
export function fmtYi(v, digits = 2) {
  if (!isNum(v)) return EMPTY;
  return (Number(v) / 1e8).toFixed(digits);
}

/** 手 → 万手（纯数字） */
export function fmtWanShou(v, digits = 2) {
  if (!isNum(v)) return EMPTY;
  return (Number(v) / 1e4).toFixed(digits);
}

/** 手 → 亿手/万手（带单位） */
export function fmtVol(v) {
  if (!isNum(v)) return EMPTY;
  const n = Number(v);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿手`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万手`;
  return `${n.toFixed(0)}手`;
}

/** 价格：两位小数 */
export function fmtPrice(v) {
  if (!isNum(v)) return EMPTY;
  return Number(v).toFixed(2);
}

/** 普通数字（可指定小数位） */
export function fmtNum(v, digits = 2) {
  if (!isNum(v)) return EMPTY;
  return Number(v).toFixed(digits);
}

/** 整数 + 千分位 */
export function fmtInt(v) {
  if (!isNum(v)) return EMPTY;
  return Math.round(Number(v)).toLocaleString('en-US');
}

/** 百分比：+2.81% / -1.20% / 0.00% */
export function fmtPct(v, digits = 2) {
  if (!isNum(v)) return EMPTY;
  const n = Number(v);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

/** 涨跌 class：up(红) / down(绿) / flat */
export function chgClass(v) {
  if (!isNum(v)) return 'flat';
  const n = Number(v);
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

/** 涨跌幅文本节点（自动着色） */
export function pctSpan(v, digits = 2) {
  return el('span', { class: chgClass(v), text: fmtPct(v, digits) });
}

/** 带颜色的数字节点 */
export function coloredSpan(v, text, digits = 2) {
  return el('span', { class: chgClass(v), text: text !== undefined ? text : fmtNum(v, digits) });
}

/* ================================================================== */
/* 时间 / 随机                                                         */
/* ================================================================== */

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Date → YYYY-MM-DD（本地时区） */
export function fmtDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 解析 YYYY-MM-DD 为本地 Date */
export function parseDate(value) {
  const parts = String(value).split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
}

/**
 * 最近 n 个交易日（跳过周六周日），升序返回 YYYY-MM-DD。
 * @param {number} n
 * @param {string} [end] 结束日期（含），默认今天
 */
export function recentTradeDates(n, end) {
  const dates = [];
  const base = end ? parseDate(end) : new Date();
  const cursor = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  let guard = 0;
  while (dates.length < n && guard < n * 3 + 30) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) dates.push(fmtDate(cursor));
    cursor.setDate(cursor.getDate() - 1);
    guard += 1;
  }
  return dates.reverse();
}

/** 可复现的伪随机数（mulberry32），示例数据保持稳定 */
export function seededRandom(seed = 1) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** 防抖 */
export function debounce(fn, wait = 120) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* ================================================================== */
/* DOM 构造                                                            */
/* ================================================================== */

/**
 * 轻量 DOM 构造器：el('div', {class:'x', text:'hi', onclick:fn}, child...)
 */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (typeof value === 'function' && key.startsWith('on')) {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value);
    }
  }
  append(node, children);
  return node;
}

/** append 支持数组 / 字符串 / Node / null */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.append(child);
    else parent.append(document.createTextNode(String(child)));
  }
  return parent;
}

/** 清空子节点 */
export function clear(node) {
  if (node) node.replaceChildren();
  return node;
}

/** 把多个节点打包成 DocumentFragment（用于 card.setExtra 放置多个徽章） */
export function inlineGroup(...children) {
  const frag = document.createDocumentFragment();
  append(frag, children);
  return frag;
}

/** 节标题（用于页面内分区，如 BT 回测 / 目标股） */
export function sectionHead({ index, title, desc, extra }) {
  return el(
    'div',
    { class: 'section-head' },
    index ? el('span', { class: 'section-index', text: index }) : null,
    el('h2', { text: title || '' }),
    desc ? el('span', { class: 'page-sub', text: desc }) : null,
    extra || null,
  );
}

/* ================================================================== */
/* 徽章 / 按钮                                                         */
/* ================================================================== */

const STATUS_MAP = {
  ok: ['ok', '正常'],
  stale: ['stale', '数据过期'],
  missing_data: ['missing', '数据缺失'],
  error: ['error', '计算错误'],
  empty: ['empty', '暂无信号'],
  running: ['primary', '计算中'],
};

/** 通用徽章 */
export function badge(text, type = 'primary', { dot = false, title = '' } = {}) {
  return el(
    'span',
    { class: `badge badge-${type}`, title: title || null },
    dot ? el('i', { class: 'badge-dot' }) : null,
    el('span', { text: text }),
  );
}

/** 策略 / 猜想状态徽章：ok=绿 stale=黄 missing_data=灰 error=红 empty=灰 */
export function statusBadge(status, text) {
  const key = STATUS_MAP[status] ? status : 'empty';
  const [type, label] = STATUS_MAP[key];
  return badge(text || label, type, { dot: true, title: `status=${status || 'empty'}` });
}

/** 分段切换控件（5/10/15 等） */
export function segControl(items, activeValue, onChange) {
  const root = el('div', { class: 'seg', role: 'group' });
  const buttons = new Map();
  items.forEach((item) => {
    const btn = el('button', {
      type: 'button',
      class: `seg-btn${item.value === activeValue ? ' is-active' : ''}`,
      text: item.label,
      onclick: () => {
        if (btn.classList.contains('is-active')) return;
        buttons.forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        onChange && onChange(item.value);
      },
    });
    buttons.set(item.value, btn);
    root.append(btn);
  });
  return {
    root,
    setActive(value) {
      buttons.forEach((btn, key) => btn.classList.toggle('is-active', key === value));
    },
  };
}

/* ================================================================== */
/* 卡片 / 统计砖块                                                     */
/* ================================================================== */

/**
 * 卡片工厂：返回 {root, head, body, extraEl, setTitle, setSub, setExtra}
 */
export function card({ title = '', sub = '', extra = null, bodyClass = '', className = '' } = {}) {
  const titleText = el('span', { class: 'card-title-text', text: title });
  const titleEl = el('h3', { class: 'card-title' }, el('span', { class: 'dot-accent' }), titleText);
  const subEl = el('div', { class: `card-sub${sub ? '' : ' is-hidden'}`, text: sub });
  const titleWrap = el('div', { class: 'card-title-wrap' }, titleEl, subEl);
  const extraEl = el('div', { class: 'card-extra' });
  const head = el('div', { class: 'card-hd' }, titleWrap, extraEl);
  const body = el('div', { class: `card-bd ${bodyClass}`.trim() });
  const root = el('section', { class: `card ${className}`.trim() }, head, body);

  const api = {
    root,
    head,
    body,
    extraEl,
    titleEl,
    subEl,
    setTitle(text) {
      titleText.textContent = text || '';
    },
    setSub(text) {
      subEl.textContent = text || '';
      subEl.classList.toggle('is-hidden', !text);
    },
    setExtra(node) {
      extraEl.replaceChildren();
      if (node === null || node === undefined) return;
      if (node instanceof Node) extraEl.append(node);
      else extraEl.textContent = String(node);
    },
  };
  if (extra) api.setExtra(extra);
  return api;
}

/** 统计砖块：返回 {root, set({label,value,sub,tone})} */
export function statCard({ label = '', value = EMPTY, sub = '', tone = '' } = {}) {
  const labelEl = el('div', { class: 'stat-label', text: label });
  const valueEl = el('div', { class: `stat-value ${tone}`.trim(), text: value });
  const subEl = el('div', { class: 'stat-sub', text: sub });
  const root = el('div', { class: 'stat-card' }, labelEl, valueEl, subEl);
  return {
    root,
    set({ label: nextLabel, value: nextValue, sub: nextSub, tone: nextTone } = {}) {
      if (nextLabel !== undefined) labelEl.textContent = nextLabel;
      if (nextValue !== undefined) valueEl.textContent = nextValue;
      if (nextSub !== undefined) subEl.textContent = nextSub;
      if (nextTone !== undefined) {
        valueEl.className = `stat-value ${nextTone}`.trim();
      }
    },
  };
}

/* ================================================================== */
/* 状态占位：骨架屏 / 空 / 错误                                        */
/* ================================================================== */

export function skeletonLine(widthClass = '') {
  return el('div', { class: `skeleton skeleton-line ${widthClass}`.trim() });
}

export function skeletonBlock(height = '160px') {
  return el('div', { class: 'skeleton skeleton-block', style: { height } });
}

export function skeletonLines(count = 4) {
  const widths = ['w-80', 'w-60', 'w-80', 'w-40'];
  return el(
    'div',
    { class: 'card-loading' },
    Array.from({ length: count }, (_v, i) => skeletonLine(widths[i % widths.length])),
  );
}

/** 空态 */
export function emptyState(text = '暂无数据', hint = '') {
  return el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-icon', text: '∅' }),
    el('div', { text }),
    hint ? el('div', { class: 'dim', text: hint }) : null,
  );
}

/** 错误态（展示 detail + 重试） */
export function errorState(err, onRetry) {
  const message = (err && (err.detail || err.message)) || String(err || '未知错误');
  return el(
    'div',
    { class: 'error-state' },
    el('div', { class: 'error-icon', text: '⚠' }),
    el('div', { text: '数据加载失败' }),
    el('div', { class: 'error-detail', text: message }),
    onRetry
      ? el(
          'div',
          { class: 'state-actions' },
          el('button', { type: 'button', class: 'btn btn-sm', text: '重试', onclick: onRetry }),
        )
      : null,
  );
}

/** 加载态（骨架 + 文案） */
export function loadingState(text = '加载中…') {
  return el('div', { class: 'card-loading', 'aria-busy': 'true' }, skeletonLines(3), el('div', { class: 'dim', text }));
}

/* ================================================================== */
/* 表格                                                                */
/* ================================================================== */

/**
 * 数据表格组件。
 * @param {object} opts
 * @param {Array<{key,title,align,className,render,width}>} opts.columns
 * @param {string} [opts.emptyText]
 * @param {function} [opts.rowKey]
 * @param {function} [opts.rowClass]
 * @param {function} [opts.onRowClick]
 * @param {string} [opts.wrapClass] 额外滚动高度类：is-tall / is-short
 * @returns {{root, setRows, setLoading, setError, setEmpty, setActiveKey, getRows}}
 */
export function dataTable({
  columns = [],
  emptyText = '暂无数据',
  rowKey = null,
  rowClass = null,
  onRowClick = null,
  wrapClass = '',
  tableClass = '',
} = {}) {
  const thead = el('thead');
  const headRow = el('tr');
  columns.forEach((column) => {
    headRow.append(
      el('th', {
        class: [column.align === 'right' ? 'num' : '', column.className || ''].filter(Boolean).join(' '),
        text: column.title || '',
        style: column.width ? { width: typeof column.width === 'number' ? `${column.width}px` : column.width } : null,
      }),
    );
  });
  thead.append(headRow);

  const tbody = el('tbody');
  const table = el('table', { class: `data-table ${tableClass}`.trim() }, thead, tbody);
  const wrap = el('div', { class: `table-wrap ${wrapClass}`.trim() }, table);

  let rows = [];
  let activeKey = null;

  function cellNode(column, row, index) {
    const td = el('td', {
      class: [column.align === 'right' ? 'num' : '', column.className || ''].filter(Boolean).join(' '),
    });
    let content;
    if (typeof column.render === 'function') content = column.render(row, index);
    else content = row ? row[column.key] : null;

    if (content instanceof Node) td.append(content);
    else if (content === null || content === undefined || content === '') {
      td.append(el('span', { class: 'muted', text: EMPTY }));
    } else td.textContent = String(content);
    return td;
  }

  function renderRows() {
    tbody.replaceChildren();
    if (!rows.length) {
      showState(emptyState(emptyText));
      return;
    }
    const frag = document.createDocumentFragment();
    rows.forEach((row, index) => {
      const key = rowKey ? rowKey(row) : String(index);
      const tr = el('tr', {
        dataset: { key: String(key), index: String(index) },
        class: [
          onRowClick ? 'is-clickable' : '',
          rowClass ? rowClass(row, index) || '' : '',
          activeKey !== null && String(key) === String(activeKey) ? 'is-active' : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
      columns.forEach((column) => tr.append(cellNode(column, row, index)));
      if (onRowClick) {
        tr.addEventListener('click', () => {
          activeKey = String(key);
          Array.from(tbody.children).forEach((child) => child.classList.remove('is-active'));
          tr.classList.add('is-active');
          onRowClick(row, tr, index);
        });
      }
      frag.append(tr);
    });
    tbody.append(frag);
  }

  function showState(node) {
    tbody.replaceChildren();
    const td = el('td', { colspan: Math.max(columns.length, 1) });
    td.append(node);
    const tr = el('tr', { class: 'table-state-row' }, td);
    tbody.append(tr);
  }

  // 初始为空态
  showState(emptyState(emptyText));

  return {
    root: wrap,
    table,
    setRows(nextRows) {
      rows = Array.isArray(nextRows) ? nextRows : [];
      renderRows();
    },
    setLoading() {
      showState(loadingState('加载中…'));
    },
    setError(err, onRetry) {
      showState(errorState(err, onRetry));
    },
    setEmpty(text) {
      emptyText = text || emptyText;
      showState(emptyState(emptyText));
    },
    setActiveKey(key) {
      activeKey = key === null || key === undefined ? null : String(key);
      Array.from(tbody.children).forEach((child) => {
        if (!child.dataset) return;
        child.classList.toggle('is-active', activeKey !== null && child.dataset.key === activeKey);
      });
    },
    getRows() {
      return rows;
    },
  };
}

/* ================================================================== */
/* ECharts 主题 / 图表封装                                             */
/* ================================================================== */

export const CHART_COLORS = {
  up: '#ef4444',
  down: '#22c55e',
  flat: '#9ca3af',
  primary: '#38bdf8',
  warn: '#f59e0b',
  purple: '#a78bfa',
  teal: '#14b8a6',
  text: '#9ca3af',
  grid: 'rgba(36, 48, 68, 0.55)',
  axis: '#243044',
};

const ECHARTS_THEME = {
  color: [CHART_COLORS.primary, CHART_COLORS.warn, CHART_COLORS.purple, CHART_COLORS.down,
    CHART_COLORS.up, CHART_COLORS.teal],
  backgroundColor: 'transparent',
  textStyle: {
    color: CHART_COLORS.text,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 11,
  },
  title: {
    textStyle: { color: '#e5e7eb', fontSize: 12, fontWeight: 600 },
    subtextStyle: { color: '#6b7280', fontSize: 11 },
  },
  legend: {
    textStyle: { color: CHART_COLORS.text, fontSize: 11 },
    itemWidth: 10,
    itemHeight: 8,
    icon: 'roundRect',
    inactiveColor: '#4b5563',
  },
  tooltip: {
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderColor: '#243044',
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: '#e5e7eb', fontSize: 12 },
    extraCssText: 'box-shadow: 0 10px 30px rgba(0,0,0,.45); border-radius: 8px;',
    axisPointer: {
      lineStyle: { color: 'rgba(56, 189, 248, 0.45)' },
      crossStyle: { color: 'rgba(56, 189, 248, 0.45)' },
      label: { backgroundColor: '#1e293b', borderColor: '#334155' },
    },
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: CHART_COLORS.axis } },
    axisTick: { show: false },
    axisLabel: { color: '#6b7280', fontSize: 10.5, hideOverlap: true },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#6b7280', fontSize: 10.5 },
    splitLine: { lineStyle: { color: CHART_COLORS.grid } },
  },
  timeAxis: {
    axisLine: { lineStyle: { color: CHART_COLORS.axis } },
    axisLabel: { color: '#6b7280' },
    splitLine: { show: false },
  },
};

let themeRegistered = false;
const chartEntries = new Set();

function ensureEcharts() {
  const echarts = window.echarts;
  if (!echarts) throw new Error('ECharts 未加载：请检查 /vendor/echarts.min.js');
  if (!themeRegistered) {
    echarts.registerTheme('qu-dark', ECHARTS_THEME);
    themeRegistered = true;
  }
  return echarts;
}

function disposeEntry(entry) {
  try {
    if (entry.ro) entry.ro.disconnect();
    entry.chart.dispose();
  } catch (_err) {
    /* ignore */
  }
  chartEntries.delete(entry);
}

/**
 * 在容器内初始化图表（自动 resize、自动登记以便切页时销毁）。
 * @returns {{el, chart, setOption, resize, dispose, on}}
 */
export function createChart(container, option, { onEvents } = {}) {
  const echarts = ensureEcharts();
  const chart = echarts.init(container, 'qu-dark', { renderer: 'canvas' });
  const entry = { chart, el: container, ro: null };

  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(
      debounce(() => {
        try {
          chart.resize();
        } catch (_err) {
          /* ignore */
        }
      }, 80),
    );
    ro.observe(container);
    entry.ro = ro;
  }
  chartEntries.add(entry);

  if (option) chart.setOption(option, true);
  if (onEvents) {
    Object.entries(onEvents).forEach(([name, handler]) => chart.on(name, handler));
  }

  return {
    el: container,
    chart,
    setOption(nextOption, opts = {}) {
      chart.setOption(nextOption, opts);
    },
    resize() {
      try {
        chart.resize();
      } catch (_err) {
        /* ignore */
      }
    },
    on(name, handler) {
      chart.on(name, handler);
    },
    dispose() {
      disposeEntry(entry);
    },
  };
}

/** 销毁 scope 内（或全部）图表；切页时调用，避免 ECharts 实例泄漏 */
export function disposeCharts(scope) {
  Array.from(chartEntries).forEach((entry) => {
    if (!scope || scope === entry.el || scope.contains(entry.el)) disposeEntry(entry);
  });
}

export function disposeAllCharts() {
  Array.from(chartEntries).forEach(disposeEntry);
}

// 窗口尺寸变化兜底（无 ResizeObserver 时仍能自适应）
if (typeof window !== 'undefined') {
  window.addEventListener(
    'resize',
    debounce(() => {
      chartEntries.forEach((entry) => {
        try {
          entry.chart.resize();
        } catch (_err) {
          /* ignore */
        }
      });
    }, 150),
  );
}

/** 金额轴格式化（亿） */
export function axisAmountYi(v) {
  if (!isNum(v)) return '';
  return `${(Number(v) / 1e8).toFixed(0)}亿`;
}

/** 百分比轴格式化 */
export function axisPct(v) {
  if (!isNum(v)) return '';
  return `${Number(v).toFixed(1)}%`;
}

/* ================================================================== */
/* Toast 轻提示                                                        */
/* ================================================================== */

const TOAST_ICONS = { ok: '✓', warn: '!', err: '✕', info: 'i' };

/**
 * 右下角轻提示。
 * @param {string} message
 * @param {'ok'|'warn'|'err'|'info'|'success'|'error'} type
 */
export function toast(message, type = 'info', { duration = 3400 } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const kind = type === 'success' ? 'ok' : type === 'error' ? 'err' : type;
  const node = el(
    'div',
    { class: `toast ${kind}` },
    el('span', { class: 'toast-icon', text: TOAST_ICONS[kind] || 'i' }),
    el('div', { class: 'toast-msg', text: String(message || '') }),
  );
  root.append(node);
  const remove = () => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 220);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}
