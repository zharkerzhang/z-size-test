/**
 * config.js — 前端运行配置（静态部署用，写死即可按需修改）
 *
 * 页面模式由 URL 路径决定（不再使用 `?data=` / `?api=` 查询参数）：
 *   - `/offline#/market` → 离线快照：数据来自 `offline-data/` 静态导出包
 *   - `/api#/market`     → 实时：跨域请求下面 API_BASE_URL 指向的后端
 *   - `/`（根路径，如 8791 本体） → 同源实时（后端同时托管前端与 API）
 *
 * 旧写法 `?data=offline` / `?api=...` 仍兼容（仅作过渡）。
 */

/** 后端服务地址（前后端分离部署时改这里即可；末尾不带 `/api`） */
export const API_BASE_URL = 'http://127.0.0.1:8791';

/** 离线数据包目录（相对前端静态站点根） */
export const OFFLINE_DATA_DIR = 'offline-data';

const MODE_PATTERN = /\/(offline|api)(?:\/|$)/;

function detectMode() {
  const path = String(window.location.pathname || '/');
  const match = path.match(MODE_PATTERN);
  if (match) return match[1];
  try {
    const query = new URLSearchParams(window.location.search || '');
    if (query.get('data') === 'offline') return 'offline';
    if (query.get('api')) return 'api';
  } catch (_err) {
    /* 非浏览器环境忽略 */
  }
  return 'same-origin';
}

/** 当前页面模式：offline / api / same-origin */
export const MODE = detectMode();

/** 站点基路径（支持 GitHub Pages 项目页等子路径部署） */
function detectSiteBase() {
  const path = String(window.location.pathname || '/');
  const match = path.match(MODE_PATTERN);
  if (match) return path.slice(0, match.index + 1);
  const cut = path.lastIndexOf('/');
  return cut >= 0 ? path.slice(0, cut + 1) : '/';
}

export const SITE_BASE = detectSiteBase();

/** 离线数据包根（绝对路径，子路径部署同样可用） */
export const OFFLINE_BASE = `${SITE_BASE}${OFFLINE_DATA_DIR}/`;

/** 路径式 `/api` 模式下使用的 API 基址（含 /api 后缀） */
export const PATH_API_BASE = MODE === 'api'
  ? `${String(API_BASE_URL || '').replace(/\/+$/, '')}/api`
  : '';
