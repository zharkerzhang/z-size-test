/**
 * app.js — 应用入口：hash 路由 + 顶栏（交易日/下一交易日/刷新/示例数据徽章）
 *
 * - 3 个页签：#/market #/concept #/policy（刷新页面保持当前页签）
 * - 切换页签只替换主区域内容，不整页刷新；离开时销毁 ECharts 实例
 * - 全局刷新：重新拉取 /api/meta + 重新挂载当前页
 * - 接口失败自动降级到内置示例数据，并显示「示例数据」徽章（可点击切换实时/示例）
 */

import * as api from './api.js';
import { SITE_BASE } from './config.js';
import * as ui from './ui.js';
import marketPage from './pages/market.js';
import conceptPage from './pages/concept.js';
import policyPage from './pages/policy.js';

const PAGES = {
  market: marketPage,
  concept: conceptPage,
  policy: policyPage,
};
const DEFAULT_ROUTE = 'market';
const ROUTE_LIST = ['market', 'concept', 'policy'];

/* ------------------------------------------------------------------ */
/* DOM 引用                                                            */
/* ------------------------------------------------------------------ */

const view = document.getElementById('view');
const tabs = Array.from(document.querySelectorAll('.tab'));
const tradeDateEl = document.getElementById('trade-date');
const nextDateEl = document.getElementById('next-date');
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');
const mockBadge = document.getElementById('mock-badge');
const refreshBtn = document.getElementById('refresh-btn');
const offlineBadge = document.getElementById('offline-badge');
const exportOfflineBtn = document.getElementById('export-offline-btn');
const degradeHint = document.getElementById('degrade-hint');
const footerMode = document.getElementById('footer-mode');

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

let meta = null;
let metaLoading = false;
let currentRoute = null;
let currentCleanup = null;
const state = window.__quWebState || (window.__quWebState = {});
let refreshing = false;
let renderSeq = 0;

/* ------------------------------------------------------------------ */
/* 交易日兜底（后端 /api/meta 未就绪时）                               */
/* ------------------------------------------------------------------ */

function mockMeta() {
  const dates = ui.recentTradeDates(2, '2026-10-30');
  const tradeDate = dates[dates.length - 1] || '2026-10-30';
  return {
    trade_date: tradeDate,
    next_trade_date: '2026-11-02',
    is_trade_day: true,
    data_ready: true,
    now: '2026-10-31T16:12:00+08:00',
    generated_at: '2026-10-31T16:12:00+08:00',
    version: '0.1.0',
    warnings: [],
  };
}

// 页面模块在 mount 时才注册各自接口的 mock；/api/meta 在入口处注册
api.registerMock('/api/meta', mockMeta, '交易日信息');

/* ------------------------------------------------------------------ */
/* 顶栏渲染                                                            */
/* ------------------------------------------------------------------ */

function updateClockText() {
  const now = new Date();
  const time = `${ui.pad2(now.getHours())}:${ui.pad2(now.getMinutes())}:${ui.pad2(now.getSeconds())}`;
  if (footerMode) {
    if (api.isOfflineMode()) {
      const info = api.offlineInfo() || {};
      footerMode.textContent = `模式：离线快照 · ${info.trade_date || ''} 数据 · ${time}`;
    } else {
      const mode = api.isForcedMock() ? '强制示例' : api.isMockActive() ? '部分示例' : '实时';
      footerMode.textContent = `模式：${mode} · 更新于 ${time}`;
    }
  }
}

function updateHeaderStatus() {
  const details = api.degradedDetails();
  const forced = api.isForcedMock();
  const mockActive = api.isMockActive();

  // 连接状态点
  if (forced) {
    connDot.className = 'conn-dot is-warn';
    connText.textContent = '示例模式';
  } else if (details.length) {
    connDot.className = 'conn-dot is-warn';
    connText.textContent = '示例数据';
  } else if (meta) {
    connDot.className = 'conn-dot is-ok';
    connText.textContent = '实时数据';
  } else {
    connDot.className = 'conn-dot is-err';
    connText.textContent = '未连接';
  }

  // 示例数据徽章
  mockBadge.classList.toggle('is-hidden', !mockActive);
  mockBadge.textContent = forced ? '示例数据（强制）' : '示例数据';
  if (mockActive) {
    const lines = [];
    if (forced) lines.push('当前为强制示例模式：不请求后端接口（URL ?mock=1 / localStorage qu-web:mock）。');
    if (details.length) {
      const preview = details.slice(0, 6).map((d) => `${d.url}  ⟶  ${d.message}`);
      lines.push(`以下接口已自动降级为内置示例数据：\n${preview.join('\n')}`);
      if (details.length > 6) lines.push(`… 另有 ${details.length - 6} 个接口`);
    }
    lines.push('点击切换 实时 / 示例 模式。');
    mockBadge.title = lines.join('\n');
  } else {
    mockBadge.title = '';
  }

  // 降级说明条
  if (forced) {
    degradeHint.classList.remove('is-hidden');
    degradeHint.textContent =
      '当前为强制示例模式（?mock=1 或 localStorage qu-web:mock=1）：展示内置示例数据，后端接口不会被调用。点击顶栏「示例数据（强制）」徽章可切回实时。';
  } else if (details.length) {
    degradeHint.classList.remove('is-hidden');
    const preview = details.slice(0, 3).map((d) => `${d.url}（${d.message}）`).join('；');
    degradeHint.textContent =
      `⚠ 后端接口暂未就绪，已自动降级为内置示例数据：${preview}` +
      (details.length > 3 ? `；另有 ${details.length - 3} 个接口` : '') +
      '。后端开发完成后刷新即可切换为实时数据。';
  } else {
    degradeHint.classList.add('is-hidden');
    degradeHint.textContent = '';
  }

  updateClockText();
}

function renderMeta() {
  const tradeDate = meta && meta.trade_date ? meta.trade_date : '—';
  const nextDate = meta && meta.next_trade_date ? meta.next_trade_date : '—';
  tradeDateEl.textContent = tradeDate;
  nextDateEl.textContent = nextDate;
  tradeDateEl.title = meta && meta.now ? `数据时间：${meta.now}` : '';
  nextDateEl.title = '下一交易日（用于策略目标日参考）';
  if (meta && Array.isArray(meta.warnings) && meta.warnings.length) {
    const hint = `后端告警：${meta.warnings.slice(0, 2).join('；')}`;
    tradeDateEl.title = hint;
  }
  updateHeaderStatus();
}

async function loadMeta({ force = false } = {}) {
  if (meta && !force) {
    renderMeta();
    return meta;
  }
  if (metaLoading) return meta;
  metaLoading = true;
  try {
    meta = await api.get('/api/meta', { timeout: 8000 });
  } catch (err) {
    // 极端情况：连示例兜底都失败（例如 mock 被清空）——仍渲染离线状态
    meta = null;
    updateHeaderStatus();
    ui.toast(`交易日信息获取失败：${err.detail || err.message}`, 'warn');
  } finally {
    metaLoading = false;
  }
  renderMeta();
  return meta;
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

function parseRoute() {
  const raw = String(window.location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  return PAGES[raw] ? raw : DEFAULT_ROUTE;
}

function setActiveTab(route) {
  tabs.forEach((tab) => {
    const active = tab.dataset.route === route;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

/** 释放上一页资源（ECharts 实例 / 页面级 cleanup） */
function teardownPage() {
  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch (_err) {
      /* ignore */
    }
  }
  currentCleanup = null;
  ui.disposeAllCharts();
}

async function renderRoute(route, { forceMeta = false } = {}) {
  const target = PAGES[route] ? route : DEFAULT_ROUTE;
  const seq = ++renderSeq;

  teardownPage();
  currentRoute = target;
  setActiveTab(target);
  document.title = `${PAGES[target].title || target} · QU·WEB`;
  view.replaceChildren();

  // 离线快照模式：策略看板禁止查看（实时模式不受影响）
  if (api.isOfflineMode() && OFFLINE_BLOCKED_ROUTES.has(target)) {
    const root = document.createElement('section');
    root.className = 'page';
    root.append(offlineBlockedNode(target));
    view.append(root);
    return;
  }

  const root = document.createElement('section');
  root.className = 'page';
  view.append(root);

  if (forceMeta || !meta) {
    await loadMeta({ force: forceMeta });
  } else {
    renderMeta();
  }
  if (seq !== renderSeq) return;

  try {
    const cleanup = await PAGES[target].mount(root, { route: target });
    if (seq !== renderSeq) {
      // 页面切换很快：立即清掉旧页图表
      ui.disposeAllCharts();
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    // 页面 mount 本身异常兜底，避免白屏
    root.replaceChildren(
      ui.errorState(err, () => renderRoute(target, { forceMeta: true })),
    );
    ui.toast(`页面渲染失败：${err && (err.detail || err.message)}`, 'err');
  }
}

function navigate(route) {
  const next = PAGES[route] ? route : DEFAULT_ROUTE;
  const hash = `#/${next}`;
  if (window.location.hash === hash) {
    renderRoute(next);
    return;
  }
  window.location.hash = hash; // 触发 hashchange → renderRoute
}

/* ------------------------------------------------------------------ */
/* 全局刷新 / 模式切换                                                 */
/* ------------------------------------------------------------------ */

async function handleRefresh() {
  if (refreshing) return;
  refreshing = true;
  refreshBtn.classList.add('is-loading');
  refreshBtn.disabled = true;
  try {
    api.resetDegraded();
    await renderRoute(currentRoute || parseRoute(), { forceMeta: true });
    ui.toast(api.isMockActive() ? '已刷新（接口未就绪，仍为示例数据）' : '数据已刷新', api.isMockActive() ? 'warn' : 'ok');
  } finally {
    refreshing = false;
    refreshBtn.classList.remove('is-loading');
    refreshBtn.disabled = false;
  }
}

async function handleToggleMock() {
  const next = !api.isForcedMock();
  api.setForcedMock(next);
  api.resetDegraded();
  await renderRoute(currentRoute || parseRoute(), { forceMeta: true });
  ui.toast(
    next ? '已切换到强制示例模式（不请求后端）' : '已切回实时模式（接口失败仍会自动降级）',
    next ? 'warn' : 'ok',
  );
}

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

tabs.forEach((tab) => {
  tab.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(tab.dataset.route);
  });
});

refreshBtn.addEventListener('click', handleRefresh);
mockBadge.addEventListener('click', handleToggleMock);
if (exportOfflineBtn) exportOfflineBtn.addEventListener('click', handleExportOffline);

window.addEventListener('hashchange', () => {
  const next = parseRoute();
  if (next === currentRoute) return;
  renderRoute(next);
});

// 接口降级 / 模式变化 → 顶栏徽章即时更新
window.addEventListener('qu:degraded', () => updateHeaderStatus());
window.addEventListener('qu:modechange', () => updateHeaderStatus());

// 键盘快捷切换：1/2/3/4（输入框内不触发）
document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const tag = (event.target && event.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const index = Number(event.key) - 1;
  if (index >= 0 && index < ROUTE_LIST.length) {
    event.preventDefault();
    navigate(ROUTE_LIST[index]);
  }
});

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

/* ---------------- 离线快照模式 / 离线数据导出 ---------------- */
const OFFLINE_BLOCKED_ROUTES = new Set(['policy']);

function offlineBlockedNode(route) {
  const label = (PAGES[route] && PAGES[route].title) || route;
  const card = ui.card({
    title: label,
    sub: '离线快照模式',
    extra: ui.badge('无权限', 'missing'),
  });
  card.body.append(ui.el('div', { class: 'detail-section-empty', style: { padding: '36px 20px' } },
    ui.el('div', { style: { fontSize: '15px', fontWeight: '600', marginBottom: '8px' }, text: '离线模式没有权限查看' }),
    ui.el('div', { class: 'dim', text: '策略看板需要连接后端实时计算（选股 / 回测），离线快照不包含该功能。' }),
    ui.el('div', { class: 'dim', style: { marginTop: '8px' },
      text: '如需查看策略看板，请访问实时模式：' }),
    ui.el('a', {
      href: `${SITE_BASE}api/#/policy`,
      style: { color: 'var(--primary, #38bdf8)' },
      text: '/api#/policy（连接后端 127.0.0.1:8791）',
    }),
  ));
  return card.root;
}

function applyOfflineMode(info) {
  if (!info) return;
  // 离线快照优先：清除遗留的「示例数据」开关，避免徽章/数据来源混淆
  try { api.setForcedMock(false); } catch (_err) { /* ignore */ }
  if (mockBadge) mockBadge.classList.add('is-hidden');
  // 离线模式屏蔽「策略看板」：隐藏页签 + 当前若在策略页则跳回主看板
  const policyTab = document.querySelector('.tab[data-route="policy"]');
  if (policyTab) {
    policyTab.classList.add('is-hidden');
    policyTab.setAttribute('aria-hidden', 'true');
    policyTab.setAttribute('title', '离线模式没有权限查看策略看板');
  }
  state.offline = true;
  if (currentRoute === 'policy') {
    window.location.hash = '#/market';
  }
  if (offlineBadge) {
    offlineBadge.classList.remove('is-hidden');
    offlineBadge.textContent = `离线快照 ${info.trade_date || ''}`.trim();
    offlineBadge.title = `数据来自 offline-data 静态导出包（导出于 ${info.generated_at || '—'}，`
      + `${Math.round((info.bytes || 0) / 1024 / 1024 * 10) / 10} MB）`;
  }
  if (exportOfflineBtn) {
    exportOfflineBtn.disabled = true;
    exportOfflineBtn.title = '离线模式下无法导出（请在连接后端的页面操作）';
  }
  ui.toast('离线快照模式：数据来自离线导出包，非示例数据', 'ok', { duration: 4200 });
  if (footerMode) {
    footerMode.textContent = `离线快照 · ${info.trade_date || ''} 数据`;
  }
}

function bindOfflineEvents() {
  window.addEventListener('qu:offline', (event) => applyOfflineMode(event.detail));
  if (api.isOfflineMode()) applyOfflineMode(api.offlineInfo());
}

async function handleExportOffline() {
  if (api.isOfflineMode()) {
    ui.toast('当前离线页面无后端接口，请在 8791 实时页面导出', 'warn', { duration: 4200 });
    return;
  }
  if (!exportOfflineBtn || exportOfflineBtn.disabled) return;
  exportOfflineBtn.disabled = true;
  exportOfflineBtn.textContent = '导出中…';
  try {
    await api.post('/api/export/offline', { params: { with_backtest: 1 }, timeout: 30000 });
    let status = null;
    const started = Date.now();
    while (Date.now() - started < 420000) {
      status = await api.get('/api/export/offline/status', { timeout: 15000 });
      if (status && status.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    if (status && status.status === 'done') {
      const manifest = (status.result && status.result.manifest) || {};
      const mb = Math.round((manifest.bytes || 0) / 1024 / 1024 * 10) / 10;
      ui.toast(`离线数据导出完成：${manifest.trade_date || ''} · ${mb} MB · ${status.dir}`,
        'ok', { duration: 8000 });
      window.dispatchEvent(new CustomEvent('qu:offline-exported', { detail: manifest }));
    } else {
      ui.toast(`离线数据导出失败：${(status && status.error) || '未知错误'}`, 'err', { duration: 7000 });
    }
  } catch (err) {
    ui.toast(`离线数据导出失败：${err.detail || err.message}`, 'err', { duration: 7000 });
  } finally {
    exportOfflineBtn.disabled = false;
    exportOfflineBtn.textContent = '导出离线数据';
  }
}

async function bootstrap() {
  await api.bootstrap();
  bindOfflineEvents();
  updateHeaderStatus();
  if (!window.location.hash) {
    window.history.replaceState(null, '', `#/${DEFAULT_ROUTE}`);
  }
  const route = parseRoute();
  await loadMeta({ force: true });
  renderRoute(route);
  updateClockText();
  setInterval(updateClockText, 15000);
}

bootstrap();
