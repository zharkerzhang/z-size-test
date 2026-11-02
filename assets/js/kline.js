/**
 * kline.js — 共享个股 K 线图表（蜡烛 + 6 条 SMA 均线 + 成交量 + 中文 tooltip）
 *
 * 概念看板底部「个股 K 线」与策略看板底部「个股 K 线」共用。
 */

import * as ui from './ui.js';

const { CHART_COLORS } = ui;

/** 简单移动平均（SMA）：不足 N 根时为 null，便于 ECharts 断线 */
function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += Number(values[i]) || 0;
    if (i >= period) sum -= Number(values[i - period]) || 0;
    if (i >= period - 1) out[i] = Number((sum / period).toFixed(2));
  }
  return out;
}

/** 均线定义：名称 + 周期 + 颜色 */
const MA_DEFS = [
  { name: 'MA5', period: 5, color: '#f59e0b' },
  { name: 'MA10', period: 10, color: '#38bdf8' },
  { name: 'MA20', period: 20, color: '#a78bfa' },
  { name: 'MA30', period: 30, color: '#14b8a6' },
  { name: 'MA60', period: 60, color: '#f472b6' },
  { name: 'MA120', period: 120, color: '#9ca3af' },
];

/** 个股 K 线（蜡烛 + 6 条 SMA 均线 + 成交量；tooltip 全中文、单块展示） */
function buildStockKlineOption(bars) {
  const dates = bars.map((bar) => bar.date);
  const candle = bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]);
  const closes = bars.map((bar) => Number(bar.close) || 0);
  const volumes = bars.map((bar) => ({
    value: bar.vol,
    itemStyle: { color: bar.close >= bar.open ? CHART_COLORS.up : CHART_COLORS.down },
  }));
  const maValues = MA_DEFS.map((def) => smaSeries(closes, def.period));
  const axisLabel = {
    color: CHART_COLORS.text, fontSize: 10.5, formatter: (value) => String(value).slice(5),
  };

  /** 工具提示：日期 + 涨跌幅 + OHLC + 成交量/成交额 + 各条均线，全部中文、单块 */
  function tooltipFormatter(params) {
    const list = Array.isArray(params) ? params : [params];
    const first = list.find((item) => item && item.dataIndex !== undefined);
    if (!first) return '';
    const index = first.dataIndex;
    const bar = bars[index];
    if (!bar) return '';
    const num = Number(bar.chg);
    const tone = num > 0 ? CHART_COLORS.up : num < 0 ? CHART_COLORS.down : CHART_COLORS.flat;
    const row = (label, value, color) => `<div style="line-height:1.6">${label} `
      + `<b${color ? ` style="color:${color}"` : ''}>${value}</b></div>`;
    const maRows = MA_DEFS.map((def, i) => {
      const value = maValues[i][index];
      return value === null ? '' : row(def.name, ui.fmtPrice(value), def.color);
    }).join('');
    return [
      `<div style="font-weight:600;margin-bottom:2px">${bar.date}`
      + `　<span style="color:${tone}">${ui.fmtPct(bar.chg)}</span></div>`,
      row('开盘', ui.fmtPrice(bar.open)),
      row('收盘', ui.fmtPrice(bar.close), tone),
      row('最高', ui.fmtPrice(bar.high)),
      row('最低', ui.fmtPrice(bar.low)),
      row('成交量', ui.fmtWanShou(bar.vol)),
      row('成交额', ui.fmtYi(bar.amount)),
      maRows,
    ].join('');
  }

  return {
    animation: false,
    legend: {
      top: 2,
      right: 8,
      itemWidth: 14,
      itemHeight: 2,
      itemGap: 10,
      textStyle: { color: CHART_COLORS.text, fontSize: 10.5 },
      data: MA_DEFS.map((def) => def.name),
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(15, 23, 42, 0.94)',
      borderColor: '#243044',
      textStyle: { color: '#e5e7eb', fontSize: 11 },
      formatter: tooltipFormatter,
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 56, right: 16, top: 30, height: '58%' },
      { left: 56, right: 16, top: '80%', height: '12%' },
    ],
    xAxis: [
      { type: 'category', data: dates, gridIndex: 0, boundaryGap: true,
        axisLine: { lineStyle: { color: CHART_COLORS.axis } },
        axisLabel: { ...axisLabel, show: false }, axisTick: { show: false } },
      { type: 'category', data: dates, gridIndex: 1, boundaryGap: true,
        axisLine: { lineStyle: { color: CHART_COLORS.axis } },
        axisLabel, axisTick: { show: false } },
    ],
    yAxis: [
      { scale: true, gridIndex: 0, splitNumber: 4,
        splitLine: { lineStyle: { color: CHART_COLORS.grid } },
        axisLabel: { color: CHART_COLORS.text, fontSize: 10.5 } },
      { scale: true, gridIndex: 1, splitNumber: 2,
        splitLine: { show: false },
        axisLabel: { color: CHART_COLORS.text, fontSize: 10.5,
                     formatter: (value) => `${Math.round(value / 1e4)}万` } },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
    ],
    series: [
      { name: 'K线', type: 'candlestick', data: candle, barMaxWidth: 14,
        itemStyle: { color: CHART_COLORS.up, color0: CHART_COLORS.down,
                     borderColor: CHART_COLORS.up, borderColor0: CHART_COLORS.down },
        z: 3 },
      ...MA_DEFS.map((def, i) => ({
        name: def.name,
        type: 'line',
        data: maValues[i],
        smooth: false,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.2, color: def.color },
        itemStyle: { color: def.color },
        z: 4,
      })),
      { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes,
        barMaxWidth: 14,
        itemStyle: { color: CHART_COLORS.up } },
    ],
  };
}

export { MA_DEFS, smaSeries, buildStockKlineOption };
