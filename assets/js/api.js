/**
 * api.js — 后端接口封装（原生 fetch，无第三方依赖）
 *
 * 核心能力：
 * 1. 相对基址 `/api`，GET/POST 统一封装，默认 15s 超时（AbortController）；
 * 2. 统一错误类型 ApiError（含 HTTP 状态、后端 detail、请求地址）；
 * 3. 接口失败自动降级：各页面模块通过 `registerMock()` 注册「内置示例数据」，
 *    请求 4xx/5xx/超时/网络错误时自动回退到示例数据，并向页面广播 `qu:degraded`；
 * 4. 强制示例模式：URL `?mock=1` 或 localStorage `qu-web:mock=1`（便于后端未完工时预览）；
 * 5. 页头「示例数据」徽章所需的降级明细由 `degradedDetails()` 提供。
 *
 * 约定：`/api` 契约见 ARCH.md §4；示例数据的字段结构必须与契约一致。
 */

import { MODE, PATH_API_BASE } from './config.js';
import { initOffline, offlineManifest, offlineRequest } from './offline.js';

const DEFAULT_API_BASE = '/api';
const API_BASE_STORAGE_KEY = 'qu-web:api-base';
const DEFAULT_TIMEOUT = 15000;

/**
 * 解析后端 API 基址（前后端分离部署用），优先级：
 *   1. URL 查询参数 `?api=http://host:8791/api`（会写入 localStorage，便于刷新/切页保持）
 *   2. `window.__QU_API_BASE__`（宿主页面/容器注入）
 *   3. `<meta name="qu-api-base" content="...">`
 *   4. localStorage `qu-web:api-base`
 *   5. 默认同源 `/api`
 */
function resolveApiBase() {
  const normalize = (value) => String(value || '').trim().replace(/\/+$/, '');
  const pick = (value) => {
    const text = normalize(value);
    return text || '';
  };
  let fromQuery = '';
  try {
    fromQuery = pick(new URLSearchParams(window.location.search || '').get('api'));
  } catch (_err) {
    fromQuery = '';
  }
  if (fromQuery) {
    try {
      window.localStorage.setItem(API_BASE_STORAGE_KEY, fromQuery);
    } catch (_err) { /* 隐私模式忽略 */ }
    return fromQuery;
  }
  // 路径式 /api 模式：使用 config.js 中写死的后端地址
  if (MODE === 'api' && PATH_API_BASE) return PATH_API_BASE;
  const fromWindow = pick(window.__QU_API_BASE__);
  if (fromWindow) return fromWindow;
  const meta = document.querySelector('meta[name="qu-api-base"]');
  const fromMeta = pick(meta && meta.content);
  if (fromMeta) return fromMeta;
  try {
    const stored = pick(window.localStorage.getItem(API_BASE_STORAGE_KEY));
    if (stored) return stored;
  } catch (_err) { /* 忽略 */ }
  return DEFAULT_API_BASE;
}

const API_BASE = resolveApiBase();
const MOCK_STORAGE_KEY = 'qu-web:mock';

/** GET 请求的示例数据路由（页面模块注册） */
const mockRoutes = [];
/** 已降级的接口：url -> 错误信息（去重，供徽章 tooltip 展示） */
const degradedMap = new Map();

let forcedMock = false;
let bootstrapped = false;
let offlineMode = false;

/** 是否处于「离线快照」模式（数据来自 offline-data 静态导出包，非 mock）。 */
export function isOfflineMode() {
  return offlineMode;
}

export function offlineInfo() {
  const manifest = offlineManifest();
  return manifest
    ? { trade_date: manifest.trade_date, generated_at: manifest.generated_at,
        bytes: manifest.bytes, counts: manifest.counts }
    : null;
}

/** 初始化离线模式：`?data=offline` 强制；或 API 不可用但存在离线包时自动切换。 */
async function initOfflineMode() {
  const params = new URLSearchParams(window.location.search || '');
  const want = MODE === 'offline' || params.get('data') === 'offline';
  if (want) {
    const manifest = await initOffline();
    offlineMode = Boolean(manifest);
    if (!offlineMode) {
      throw new ApiError('未找到离线数据包（offline-data/manifest.json）', {
        status: 0, url: 'offline-data/manifest.json', kind: 'offline',
      });
    }
    window.dispatchEvent(new CustomEvent('qu:offline', { detail: offlineInfo() }));
    return;
  }
  if (forcedMock || MODE === 'api') return;
  // 自动探测：同源 API 不可用 + 存在离线包 → 使用离线快照
  try {
    const resp = await fetch(buildUrl('/api/meta'), { cache: 'no-store' });
    if (resp.ok) return;
  } catch (_err) { /* 继续尝试离线包 */ }
  const manifest = await initOffline();
  if (manifest) {
    offlineMode = true;
    window.dispatchEvent(new CustomEvent('qu:offline', { detail: offlineInfo() }));
  }
}

/** 接口错误：区分超时 / 网络 / HTTP / 非 JSON */
export class ApiError extends Error {
  constructor(message, { status = 0, detail = '', url = '', kind = 'http' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail || message;
    this.url = url;
    this.kind = kind; // http | timeout | network | parse | mock
  }
}

/* ------------------------------------------------------------------ */
/* 示例数据注册                                                        */
/* ------------------------------------------------------------------ */

/**
 * 注册某个接口的示例数据。
 * @param {string|RegExp} matcher 接口路径前缀（字符串）或正则（匹配含 query 的完整 url）
 * @param {object|function} provider 示例数据对象，或返回示例数据的函数（入参 {path, params}）
 * @param {string} label 中文说明，用于提示
 */
export function registerMock(matcher, provider, label = '') {
  mockRoutes.push({ matcher, provider, label });
}

function matchMock(url) {
  const pathOnly = String(url).replace(/^https?:\/\/[^/]+/, '');
  for (const route of mockRoutes) {
    const m = route.matcher;
    if (m instanceof RegExp) {
      if (m.test(url) || m.test(pathOnly)) return route;
    } else if (url.startsWith(m) || url === m || url.split('?')[0] === m
      || pathOnly.startsWith(m)) {
      return route;
    }
  }
  return null;
}

function clone(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_err) {
      /* fallthrough */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function makeMockPayload(route, url, params) {
  let data;
  try {
    data = typeof route.provider === 'function'
      ? route.provider({ path: url, params })
      : route.provider;
  } catch (err) {
    throw new ApiError(`示例数据构造失败：${err && err.message ? err.message : err}`, {
      status: 0,
      url,
      kind: 'mock',
    });
  }
  if (data === null || data === undefined) {
    throw new ApiError(`示例数据缺失：${route.label || url}`, { status: 0, url, kind: 'mock' });
  }
  const payload = clone(data);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    payload.__mock = true;
    if (payload.meta && typeof payload.meta === 'object') {
      payload.meta = { ...payload.meta, source: 'mock', cached: false };
    }
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* 模式管理（实时 / 示例）                                             */
/* ------------------------------------------------------------------ */

function emit(name, detail) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch (_err) {
    /* 非浏览器环境（如语法检查）忽略 */
  }
}

/** 启动引导：解析示例模式 + 离线快照模式（app.js 启动时调用一次，返回 Promise） */
export async function bootstrap() {
  bootstrapMockMode();
  try {
    await initOfflineMode();
  } catch (err) {
    if (err && err.kind === 'offline') {
      // 显式要求离线但缺少数据包：降级到示例数据并提示
      forcedMock = true;
      emit('qu:modechange', { forcedMock: true, mockActive: true });
      window.dispatchEvent(new CustomEvent('qu:offline-missing', { detail: err.message }));
    }
  }
  return { mock: forcedMock, offline: offlineMode };
}

/** 读取 URL / localStorage 中的示例模式开关（app.js 启动时调用一次） */
export function bootstrapMockMode() {
  if (bootstrapped) return forcedMock;
  bootstrapped = true;
  let next = false;
  try {
    const search = new URLSearchParams(window.location.search || '');
    const urlMock = search.get('mock');
    if (urlMock === '1' || urlMock === 'true') {
      next = true;
      window.localStorage.setItem(MOCK_STORAGE_KEY, '1');
    } else if (urlMock === '0' || urlMock === 'false') {
      next = false;
      window.localStorage.removeItem(MOCK_STORAGE_KEY);
    } else if (window.localStorage.getItem(MOCK_STORAGE_KEY) === '1') {
      next = true;
    }
  } catch (_err) {
    next = false;
  }
  forcedMock = next;
  if (forcedMock) emit('qu:modechange', { forcedMock: true, mockActive: true });
  return forcedMock;
}

export function isForcedMock() {
  return forcedMock;
}

/** 切换强制示例模式（徽章点击）；会写入 localStorage */
export function setForcedMock(flag, { persist = true } = {}) {
  forcedMock = Boolean(flag);
  if (persist) {
    try {
      if (forcedMock) window.localStorage.setItem(MOCK_STORAGE_KEY, '1');
      else window.localStorage.removeItem(MOCK_STORAGE_KEY);
    } catch (_err) {
      /* ignore */
    }
  }
  emit('qu:modechange', { forcedMock, mockActive: isMockActive() });
  return forcedMock;
}

/** 是否正在使用示例数据（强制模式或已有接口降级） */
export function isMockActive() {
  return forcedMock || degradedMap.size > 0;
}

/** 已降级接口明细，供页头徽章 tooltip 使用 */
export function degradedDetails() {
  return Array.from(degradedMap.entries()).map(([url, message]) => ({ url, message }));
}

/** 清空降级记录（全局刷新时重新判定） */
export function resetDegraded() {
  degradedMap.clear();
}

function markDegraded(url, error) {
  const message = error && error.message ? error.message : String(error);
  const existed = degradedMap.has(url);
  degradedMap.set(url, message);
  if (!existed) emit('qu:degraded', { url, message, count: degradedMap.size });
}

function clearDegraded(url) {
  if (degradedMap.delete(url)) emit('qu:modechange', { forcedMock, mockActive: isMockActive() });
}

/* ------------------------------------------------------------------ */
/* 基础请求                                                            */
/* ------------------------------------------------------------------ */

function buildUrl(path, params) {
  // 统一以 API_BASE 为前缀；调用方既可以传 '/api/xxx'，也可以传 '/xxx'
  const raw = String(path || '');
  const rest = raw.startsWith('/api')
    ? raw.slice(4)
    : (raw.startsWith('/') ? raw : `/${raw}`);
  const base = `${API_BASE}${rest}`;
  if (!params) return base;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.append(key, String(value));
  });
  const qs = search.toString();
  if (!qs) return base;
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
}

async function request(method, path, { params, body, timeout = DEFAULT_TIMEOUT } = {}) {
  const url = buildUrl(path, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  let text = '';
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    text = await response.text();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new ApiError(`请求超时（>${Math.round(timeout / 1000)}s）`, { status: 0, url, kind: 'timeout' });
    }
    throw new ApiError(`网络请求失败：${err && err.message ? err.message : err}`, {
      status: 0,
      url,
      kind: 'network',
    });
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_err) {
      throw new ApiError(`响应不是合法 JSON（HTTP ${response.status}）`, {
        status: response.status,
        url,
        kind: 'parse',
      });
    }
  }

  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && payload.detail ? String(payload.detail) : '';
    throw new ApiError(detail || `HTTP ${response.status} ${response.statusText || ''}`.trim(), {
      status: response.status,
      detail,
      url,
      kind: 'http',
    });
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* 对外接口                                                            */
/* ------------------------------------------------------------------ */

/**
 * GET 请求（接口失败自动回退到示例数据）。
 * @returns {Promise<object>} 响应 JSON；示例数据带 `__mock: true`
 */
export async function get(path, { params, timeout = DEFAULT_TIMEOUT, fallback = true } = {}) {
  const url = buildUrl(path, params);

  if (offlineMode) {
    return offlineRequest(path, params);
  }

  if (forcedMock) {
    const route = matchMock(url);
    if (route) return makeMockPayload(route, url, params);
    throw new ApiError(`示例模式：该接口暂无内置示例数据（${path}）`, {
      status: 0,
      url,
      detail: '示例模式',
      kind: 'mock',
    });
  }

  try {
    const data = await request('GET', path, { params, timeout });
    clearDegraded(url);
    return data;
  } catch (err) {
    if (fallback) {
      const route = matchMock(url);
      if (route) {
        markDegraded(url, err);
        return makeMockPayload(route, url, params);
      }
    }
    throw err;
  }
}

/**
 * POST 请求（不降级）。示例模式下调后端会明确报错，由页面提示。
 */
export async function post(path, { params, body, timeout = 30000 } = {}) {
  if (offlineMode) {
    return offlineRequest(path, { ...(params || {}), ...(body || {}) });
  }
  if (forcedMock) {
    throw new ApiError('当前为「示例数据」模式，无法触发后端重算', {
      status: 0,
      url: buildUrl(path, params),
      detail: '示例数据模式',
      kind: 'mock',
    });
  }
  return request('POST', path, { params, body, timeout });
}

/**
 * 可选 GET：失败返回 null，不触发降级（用于「有则更好」的增强数据，例如个股日线）。
 */
export async function optionalGet(path, { params, timeout = 8000 } = {}) {
  if (forcedMock) return null;
  try {
    return await request('GET', path, { params, timeout });
  } catch (_err) {
    return null;
  }
}

export default {
  get,
  post,
  optionalGet,
  registerMock,
  isForcedMock,
  setForcedMock,
  isMockActive,
  degradedDetails,
  resetDegraded,
  bootstrapMockMode,
  bootstrap,
  isOfflineMode,
  offlineInfo,
  ApiError,
};
