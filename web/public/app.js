const BANK_COLOR = {
  sber: '#22c55e',
  vtb: '#3b82f6',
  alfa: '#e10f04',
  otp: '#fe9e0a',
  tbank: '#facc15',
  other: '#a8a29e',
};

const WINDOW_LOOKBACK = { '1W': 6, '1M': 29, '3M': 89, '1Y': 364 };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const NARROW = '\u202F';

const state = {
  data: null,
  range: '1M',
  tab: 'overview',
  archiveCardId: null,
  hoverCapital: null,
  hoverPnl: null,
  hoverCum: null,
};

const charts = {
  capitalAnim: 0,
  pnlAnim: 0,
  cumAnim: 0,
  capitalLayout: null,
  pnlLayout: null,
  cumLayout: null,
};

const $ = (id) => document.getElementById(id);

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

function isDown(formatted) {
  return formatted.includes('−') || formatted.startsWith('-');
}

function pillClass(formatted, light) {
  const down = isDown(formatted);
  return `pill${light ? ' light' : ''}${down ? ' down' : ''}`;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function moneyToKopecks(amountStr) {
  const text = String(amountStr ?? '0');
  const neg = text.startsWith('-');
  const raw = neg ? text.slice(1) : text;
  const [intPart = '0', frac = '00'] = raw.split('.');
  const k = BigInt(intPart || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  return neg ? -k : k;
}

function kopecksToDelta(k) {
  const neg = k < 0n;
  const abs = neg ? -k : k;
  const intPart = abs / 100n;
  const frac = abs % 100n;
  const grouped = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, NARROW);
  const body = frac === 0n ? `${grouped} ₽` : `${grouped},${frac.toString().padStart(2, '0')} ₽`;
  if (k === 0n) return `+${body}`;
  return `${neg ? '−' : '+'}${body}`;
}

function fmtAxisMoney(value, step) {
  const n = Math.round(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (step >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}${NARROW}млн`;
  }
  if (step >= 1000) {
    return `${sign}${Math.round(abs / 1000)}${NARROW}тыс`;
  }
  return `${sign}${abs.toLocaleString('ru-RU')}`;
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function rangeFrom(today, range) {
  if (range === 'All') return null;
  return addDaysIso(today, -WINDOW_LOOKBACK[range]);
}

function utcStamp(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetweenIso(from, to) {
  return Math.round((utcStamp(to) - utcStamp(from)) / 86400000);
}

/** Календарное окно кнопок 1W…All, даже если записей меньше. */
function viewRange(today, range, series) {
  const to = today;
  if (range === 'All') {
    const first = series && series.length > 0 ? series[0].date : today;
    return { from: first, to };
  }
  return { from: rangeFrom(today, range), to };
}

function xAtDate(date, from, to, plot) {
  const span = Math.max(1, daysBetweenIso(from, to));
  const t = Math.min(1, Math.max(0, daysBetweenIso(from, date) / span));
  return plot.x0 + t * plot.innerW;
}

function timeAxisLabels(from, to, plot) {
  const span = Math.max(0, daysBetweenIso(from, to));
  const count = span < 3 ? 2 : 4;
  const labels = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    const date = addDaysIso(from, Math.round((i / Math.max(1, count - 1)) * span));
    if (seen.has(date)) continue;
    seen.add(date);
    labels.push({ x: xAtDate(date, from, to, plot), text: fmtDateShort(date) });
  }
  return labels;
}

function filterByDate(series, range, today, dateKey = 'date') {
  if (!series || series.length === 0) return [];
  if (range === 'All') return series.slice();
  const from = rangeFrom(today, range);
  return series.filter((point) => point[dateKey] >= from && point[dateKey] <= today);
}

function filterMonths(series, range, today) {
  if (!series || series.length === 0) return [];
  if (range === 'All') return series.slice();
  const from = rangeFrom(today, range);
  const fromKey = from.slice(0, 7);
  const toKey = today.slice(0, 7);
  return series.filter((point) => {
    const key = `${point.year}-${String(point.month).padStart(2, '0')}`;
    return key >= fromKey && key <= toKey;
  });
}

function downsample(points, max) {
  if (points.length <= max) return points;
  const out = [];
  const last = points.length - 1;
  for (let i = 0; i < max; i += 1) {
    const idx = Math.round((i / (max - 1)) * last);
    if (out.length === 0 || out[out.length - 1] !== points[idx]) {
      out.push(points[idx]);
    }
  }
  return out;
}

async function api(path, options) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options && options.headers) },
    ...options,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Ошибка запроса');
  }
  return body;
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === tab);
  });
  $('panel-overview').classList.toggle('hidden', tab !== 'overview');
  $('panel-ops').classList.toggle('hidden', tab !== 'ops');
  $('panel-materials').classList.toggle('hidden', tab !== 'materials');
  if (tab === 'overview' && state.data) {
    requestAnimationFrame(() => renderOverview({ animate: true }));
  }
}

function renderTicks(share) {
  const root = $('work-ticks');
  root.innerHTML = '';
  const value = share.defined ? num(share.value) : 0;
  for (let i = 0; i < 16; i += 1) {
    const mark = document.createElement('i');
    if (i < Math.round((value / 100) * 16)) mark.className = 'on';
    root.append(mark);
  }
}

function renderMinis(materials) {
  const root = $('asset-minis');
  root.innerHTML = '';
  materials.slice(0, 4).forEach((item, index) => {
    const el = document.createElement('div');
    el.className = 'mini';
    el.style.borderLeftColor = BANK_COLOR[item.bank] || BANK_COLOR.other;
    el.style.animationDelay = `${0.04 * index}s`;
    el.innerHTML = `<div class="name">${escapeHtml(item.name)}</div><div class="val">${escapeHtml(item.balance.formatted)}</div>`;
    root.append(el);
  });
}

function renderWatch(materials) {
  const root = $('watchlist');
  root.innerHTML = '';
  if (materials.length === 0) {
    root.innerHTML = '<p class="muted">Пока нет материалов</p>';
    return;
  }
  materials.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'watch';
    const down = isDown(item.change.formatted);
    el.innerHTML = `
      <div class="sym">${escapeHtml(item.name)}</div>
      <div>${escapeHtml(item.balance.formatted)}</div>
      <div class="chg ${down ? 'down' : 'up'}">${escapeHtml(item.change.formatted)}</div>`;
    root.append(el);
  });
}

function renderAllocation(materials) {
  const root = $('allocation');
  root.innerHTML = '';
  materials.forEach((item) => {
    const pct = item.share.defined ? num(item.share.value) : 0;
    const row = document.createElement('div');
    row.className = 'alloc-row';
    const width = `${Math.min(100, Math.max(0, pct))}%`;
    row.innerHTML = `
      <span>${escapeHtml(item.name)}</span>
      <div class="bar"><span style="width:0;background:${BANK_COLOR[item.bank] || BANK_COLOR.other}"></span></div>
      <span>${escapeHtml(item.share.formatted)}</span>`;
    root.append(row);
    requestAnimationFrame(() => {
      const bar = row.querySelector('.bar > span');
      if (bar) bar.style.width = width;
    });
  });
}

function renderFlows(flows) {
  const root = $('flows');
  root.innerHTML = '';
  const rows = flows.slice(0, 8);
  if (rows.length === 0) {
    root.innerHTML = '<li class="muted">Движений пока нет</li>';
    return;
  }
  rows.forEach((row) => {
    const li = document.createElement('li');
    const out = row.kind === 'WITHDRAWAL';
    li.innerHTML = `<span>${escapeHtml(fmtDate(row.date))} · ${escapeHtml(row.cardName)} · ${escapeHtml(row.kindLabel)}</span><strong class="${out ? 'down' : 'up'}">${escapeHtml(row.amount.formatted)}</strong>`;
    root.append(li);
  });
}

function fillCardSelects() {
  const materials = state.data.materials || [];
  const html = materials.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  $('op-card').innerHTML = html;
  $('archive-target').innerHTML = html;
}

function renderJournal() {
  const body = $('journal');
  body.innerHTML = '';
  (state.data.journal || []).forEach((row) => {
    const tr = document.createElement('tr');
    const flow =
      num(row.capitalIn.amount) > 0
        ? `+ ${row.capitalIn.formatted}`
        : num(row.capitalOut.amount) > 0
          ? `− ${row.capitalOut.formatted}`
          : '—';
    tr.innerHTML = `
      <td>${escapeHtml(fmtDate(row.date))}</td>
      <td>${escapeHtml(row.cardName)}</td>
      <td>${escapeHtml(row.sourceLabel)}</td>
      <td>${escapeHtml(row.amount.formatted)}</td>
      <td>${escapeHtml(flow)}</td>
      <td><button type="button" class="linkish" data-fix="${row.cardId}">Исправить</button></td>`;
    body.append(tr);
  });
}

function renderMaterials() {
  const wrap = $('material-table');
  const rows = (state.data.materials || [])
    .map((item) => {
      const frozen = item.status === 'frozen';
      return `<tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${frozen ? 'Заморожен' : 'В работе'}</td>
        <td>${escapeHtml(item.balance.formatted)}</td>
        <td>${escapeHtml(item.change.formatted)}</td>
        <td>
          ${frozen ? `<button type="button" class="linkish" data-unfreeze="${item.id}">Вернуть</button>` : `<button type="button" class="linkish" data-freeze="${item.id}">Заморозить</button>`}
          <button type="button" class="linkish" data-archive="${item.id}">Удалить</button>
        </td>
      </tr>`;
    })
    .join('');
  wrap.innerHTML = `<table><thead><tr><th>Материал</th><th>Статус</th><th>Баланс</th><th>Изменение</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">Пусто</td></tr>'}</tbody></table>`;

  const arch = $('archive-list');
  arch.innerHTML = '';
  const archived = state.data.archived || [];
  if (archived.length === 0) {
    arch.innerHTML = '<li class="muted">Архив пуст</li>';
    return;
  }
  archived.forEach((row) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(row.name)} · ${escapeHtml(fmtDate(row.archivedOn))}</span><span>${escapeHtml(row.reason)}</span>`;
    arch.append(li);
  });
}

function sizeCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth || 640));
  const height = Math.max(1, Math.round(canvas.clientHeight || 200));
  const bitmapW = Math.round(width * dpr);
  const bitmapH = Math.round(height * dpr);
  if (canvas.width !== bitmapW) canvas.width = bitmapW;
  if (canvas.height !== bitmapH) canvas.height = bitmapH;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function niceTicks(min, max, count) {
  if (min === max) {
    const pad = Math.max(100, Math.abs(min) * 0.04);
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step / 2; v += step) {
    ticks.push(v);
  }
  return { min: start, max: ticks[ticks.length - 1] ?? max, ticks, step };
}

function layoutPlot(width, height, pad) {
  return {
    x0: pad.left,
    y0: pad.top,
    x1: width - pad.right,
    y1: height - pad.bottom,
    innerW: width - pad.left - pad.right,
    innerH: height - pad.top - pad.bottom,
  };
}

function drawGrid(ctx, plot, ticks, xLabels, ink, grid, step) {
  ctx.save();
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = ink;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ticks.forEach((tick) => {
    const y = plot.y0 + ((plot.max - tick) / (plot.max - plot.min)) * plot.innerH;
    ctx.beginPath();
    ctx.moveTo(plot.x0, y);
    ctx.lineTo(plot.x1, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtAxisMoney(tick, step), plot.x0 - 8, y);
  });
  xLabels.forEach((label) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label.text, label.x, plot.y1 + 8);
  });
  ctx.restore();
}

function xLabelsFor(points, plot, labelFn) {
  if (points.length === 0) return [];
  const count = Math.min(4, points.length);
  const labels = [];
  for (let i = 0; i < count; i += 1) {
    const idx = count === 1 ? 0 : Math.round((i / (count - 1)) * (points.length - 1));
    const x = plot.x0 + (points.length === 1 ? plot.innerW / 2 : (idx / (points.length - 1)) * plot.innerW);
    labels.push({ x, text: labelFn(points[idx], idx) });
  }
  return labels;
}

function capitalPoints() {
  const d = state.data;
  const raw = filterByDate(d.capitalSeries || [], state.range, d.today);
  return downsample(raw, 240);
}

function currentWindow() {
  const d = state.data;
  const win = d.windows && d.windows[state.range];
  if (win) return win;
  return {
    from: d.today,
    to: d.today,
    amount: d.monthly && d.monthly.amount,
    percent: d.monthly && d.monthly.percent,
    closing: d.totalCapital,
  };
}

function fillRoundRect(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rad);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();
}

function applyCapitalHeader() {
  const win = currentWindow();
  const hover = state.hoverCapital;
  const view = viewRange(state.data.today, state.range, state.data.capitalSeries);
  $('total-capital').textContent = hover ? hover.formatted : win.closing.formatted;
  const pct = win.percent ? win.percent.formatted : '—';
  $('window-pct').textContent = `${win.amount.delta} (${pct})`;
  $('window-pct').className = pillClass(pct, true);
  $('chart-hint').textContent = hover
    ? `${fmtDate(hover.date)} · ${hover.formatted}`
    : `${fmtDate(view.from)} — ${fmtDate(view.to)}`;
}

function drawCapitalFrame(progress) {
  const canvas = $('capital-chart');
  const { ctx, width, height } = sizeCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const points = capitalPoints();
  const view = viewRange(state.data.today, state.range, state.data.capitalSeries);
  const plotBase = layoutPlot(width, height, { top: 14, right: 12, bottom: 28, left: 52 });
  if (points.length === 0) {
    charts.capitalLayout = null;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Пока нет точек капитала', plotBase.x0, plotBase.y0 + 24);
    return;
  }
  const values = points.map((p) => num(p.capital));
  const scale = niceTicks(Math.min(...values), Math.max(...values), 3);
  const plot = { ...plotBase, min: scale.min, max: scale.max };
  const xAt = (i) => xAtDate(points[i].date, view.from, view.to, plot);
  const yAt = (v) => plot.y0 + ((plot.max - v) / (plot.max - plot.min)) * plot.innerH;
  charts.capitalLayout = { points, plot, xAt, yAt, width, height };

  drawGrid(
    ctx,
    plot,
    scale.ticks,
    timeAxisLabels(view.from, view.to, plot),
    'rgba(255,255,255,0.72)',
    'rgba(255,255,255,0.14)',
    scale.step,
  );

  const shown = Math.max(2, Math.round((points.length - 1) * progress) + 1);
  const visible = points.slice(0, shown);
  ctx.beginPath();
  visible.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(values[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineTo(xAt(visible.length - 1), plot.y1);
  ctx.lineTo(xAt(0), plot.y1);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, plot.y0, 0, plot.y1);
  fill.addColorStop(0, 'rgba(255,255,255,0.32)');
  fill.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.fillStyle = fill;
  ctx.fill();

  const hover = state.hoverCapital;
  if (!hover) return;
  const idx = points.findIndex((p) => p.date === hover.date);
  if (idx < 0) return;
  const hx = xAt(idx);
  const hy = yAt(values[idx]);
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.setLineDash([4, 4]);
  ctx.moveTo(hx, plot.y0);
  ctx.lineTo(hx, plot.y1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.fillStyle = '#fff';
  ctx.arc(hx, hy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = '#e85d04';
  ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function animateCapital() {
  cancelAnimationFrame(charts.capitalAnim);
  if (reducedMotion()) {
    drawCapitalFrame(1);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / 520);
    const eased = 1 - (1 - t) ** 3;
    drawCapitalFrame(eased);
    if (t < 1) charts.capitalAnim = requestAnimationFrame(tick);
  };
  charts.capitalAnim = requestAnimationFrame(tick);
}

function cumulativePoints() {
  const d = state.data;
  const series = d.cumulativePnlSeries || [];
  const raw = filterByDate(series, state.range, d.today);
  if (raw.length === 0) return [];
  const from = rangeFrom(d.today, state.range);
  let baseline = 0n;
  if (from) {
    const prev = series.find((point) => point.date === addDaysIso(from, -1));
    if (prev) baseline = moneyToKopecks(prev.amount);
  }
  return downsample(
    raw.map((point) => {
      const k = moneyToKopecks(point.amount) - baseline;
      return {
        date: point.date,
        amount: k,
        value: Number(k) / 100,
        formatted: kopecksToDelta(k),
      };
    }),
    240,
  );
}

function applyCumHeader() {
  const win = currentWindow();
  const hover = state.hoverCum;
  const view = viewRange(state.data.today, state.range, state.data.capitalSeries);
  $('cum-kpi').textContent = hover ? hover.formatted : win.amount.delta;
  const pct = win.percent ? win.percent.formatted : '—';
  $('cum-pct').textContent = pct;
  $('cum-pct').className = pillClass(pct, false);
  $('cum-hint').textContent = hover
    ? `${fmtDate(hover.date)} · сколько заработано с начала выбранного периода`
    : `${fmtDate(view.from)} — ${fmtDate(view.to)} · без пополнений и выводов`;
}

function drawCumFrame(progress) {
  const canvas = $('cum-chart');
  const { ctx, width, height } = sizeCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const points = cumulativePoints();
  const view = viewRange(state.data.today, state.range, state.data.capitalSeries);
  const plotBase = layoutPlot(width, height, { top: 14, right: 12, bottom: 28, left: 52 });
  if (points.length === 0) {
    charts.cumLayout = null;
    ctx.fillStyle = '#8a8680';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Пока нет накопленной прибыли', plotBase.x0, plotBase.y0 + 24);
    return;
  }
  const values = points.map((p) => p.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const scale = niceTicks(lo, hi, 3);
  const plot = { ...plotBase, min: scale.min, max: scale.max };
  const xAt = (i) => xAtDate(points[i].date, view.from, view.to, plot);
  const yAt = (v) => plot.y0 + ((plot.max - v) / (plot.max - plot.min)) * plot.innerH;
  charts.cumLayout = { points, plot, xAt, yAt, width, height };

  drawGrid(
    ctx,
    plot,
    scale.ticks,
    timeAxisLabels(view.from, view.to, plot),
    '#8a8680',
    'rgba(255,255,255,0.06)',
    scale.step,
  );

  const zeroY = yAt(0);
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(246,244,243,0.28)';
  ctx.moveTo(plot.x0, zeroY);
  ctx.lineTo(plot.x1, zeroY);
  ctx.stroke();

  const shown = Math.max(2, Math.round((points.length - 1) * progress) + 1);
  const visible = points.slice(0, shown);
  const lastVal = values[visible.length - 1];
  const up = lastVal >= 0;
  const stroke = up ? '#4ade80' : '#f87171';

  ctx.beginPath();
  visible.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(values[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineTo(xAt(visible.length - 1), zeroY);
  ctx.lineTo(xAt(0), zeroY);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, plot.y0, 0, plot.y1);
  if (up) {
    fill.addColorStop(0, 'rgba(74, 222, 128, 0.28)');
    fill.addColorStop(1, 'rgba(74, 222, 128, 0.02)');
  } else {
    fill.addColorStop(0, 'rgba(248, 113, 113, 0.08)');
    fill.addColorStop(1, 'rgba(248, 113, 113, 0.28)');
  }
  ctx.fillStyle = fill;
  ctx.fill();

  const hover = state.hoverCum;
  if (!hover) return;
  const idx = points.findIndex((p) => p.date === hover.date);
  if (idx < 0) return;
  const hx = xAt(idx);
  const hy = yAt(values[idx]);
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.setLineDash([4, 4]);
  ctx.moveTo(hx, plot.y0);
  ctx.lineTo(hx, plot.y1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.fillStyle = '#fff';
  ctx.arc(hx, hy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = values[idx] < 0 ? '#e10f04' : '#1a9365';
  ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function animateCum() {
  cancelAnimationFrame(charts.cumAnim);
  if (reducedMotion()) {
    drawCumFrame(1);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / 520);
    const eased = 1 - (1 - t) ** 3;
    drawCumFrame(eased);
    if (t < 1) charts.cumAnim = requestAnimationFrame(tick);
  };
  charts.cumAnim = requestAnimationFrame(tick);
}

function pnlSeries() {
  const d = state.data;
  const useMonths = state.range === '3M' || state.range === '1Y' || state.range === 'All';
  if (useMonths) {
    return filterMonths(d.monthlySeries || [], state.range, d.today).map((point) => ({
      date: `${point.year}-${String(point.month).padStart(2, '0')}-01`,
      label: `${MONTHS[point.month - 1]} ${String(point.year).slice(2)}`,
      amount: point.amount,
      formatted: point.formatted,
      percent: point.percent,
    }));
  }
  return filterByDate(d.dailyPnlSeries || [], state.range, d.today).map((point) => ({
    date: point.date,
    label: fmtDateShort(point.date),
    amount: point.amount,
    formatted: point.formatted,
    percent: point.percent,
  }));
}

function drawPnlFrame() {
  const canvas = $('pnl-chart');
  const { ctx, width, height } = sizeCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const points = pnlSeries();
  const plotBase = layoutPlot(width, height, { top: 16, right: 12, bottom: 28, left: 52 });
  if (points.length === 0) {
    charts.pnlLayout = null;
    ctx.fillStyle = '#8a8680';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('В этом окне нет наблюдений прибыли', plotBase.x0, plotBase.y0 + 28);
    return;
  }
  const values = points.map((p) => num(p.amount));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const scale = niceTicks(lo, hi, 3);
  const plot = { ...plotBase, min: scale.min, max: scale.max };
  const zeroY = plot.y0 + ((plot.max - 0) / (plot.max - plot.min)) * plot.innerH;
  const gap = 4;
  const barW = Math.max(4, Math.min(36, (plot.innerW / points.length) - gap));
  const xAt = (i) => {
    const slot = plot.innerW / points.length;
    return plot.x0 + slot * i + slot / 2;
  };
  charts.pnlLayout = { points, plot, xAt, barW, width, height };

  drawGrid(
    ctx,
    plot,
    scale.ticks,
    xLabelsFor(points, plot, (p) => p.label),
    '#8a8680',
    'rgba(255,255,255,0.06)',
    scale.step,
  );
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(246,244,243,0.28)';
  ctx.moveTo(plot.x0, zeroY);
  ctx.lineTo(plot.x1, zeroY);
  ctx.stroke();

  points.forEach((p, i) => {
    const x = xAt(i);
    const y = plot.y0 + ((plot.max - values[i]) / (plot.max - plot.min)) * plot.innerH;
    const top = Math.min(y, zeroY);
    const h = Math.max(2, Math.abs(zeroY - y));
    const active = state.hoverPnl && state.hoverPnl.date === p.date;
    ctx.fillStyle = values[i] < 0 ? (active ? '#f87171' : '#e10f04') : active ? '#4ade80' : '#1a9365';
    fillRoundRect(ctx, x - barW / 2, top, barW, h, 4);
  });
}

function drawGauge(canvas, share) {
  const { ctx, width, height } = sizeCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height - 18;
  const r = Math.min(88, width / 2 - 16);
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.strokeStyle = '#2a2724';
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.stroke();
  const pct = share.defined ? Math.min(100, Math.max(0, num(share.value))) / 100 : 0;
  ctx.beginPath();
  ctx.strokeStyle = '#22c55e';
  ctx.arc(cx, cy, r, Math.PI, Math.PI + Math.PI * pct);
  ctx.stroke();
}

function placeTooltip(el, canvas, clientX, clientY, html) {
  const wrap = canvas.parentElement;
  const box = wrap.getBoundingClientRect();
  el.innerHTML = html;
  el.classList.remove('hidden');
  const x = Math.min(box.width - 16, Math.max(16, clientX - box.left));
  const y = Math.min(box.height - 8, Math.max(8, clientY - box.top));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function hideTooltip(el) {
  el.classList.add('hidden');
}

function nearestByX(layout, clientX, canvas) {
  if (!layout || layout.points.length === 0) return -1;
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * layout.width;
  let best = 0;
  let bestDist = Infinity;
  layout.points.forEach((p, i) => {
    const dist = Math.abs(layout.xAt(i) - x);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  });
  return best;
}

function renderOverview(options = {}) {
  const d = state.data;
  const animate = Boolean(options.animate);
  $('today-label').textContent = fmtDate(d.today);
  $('updated-label').textContent = d.lastUpdateDate ? `обновлено ${fmtDate(d.lastUpdateDate)}` : '';
  $('all-time-amount').textContent = d.allTime.amount ? d.allTime.amount.delta : '—';
  $('all-time-pct').textContent = d.allTime.percent ? d.allTime.percent.formatted : '—';
  $('all-time-pct').className = pillClass(d.allTime.percent ? d.allTime.percent.formatted : '', false);
  $('daily-kpi').textContent = d.daily.formatted || '—';
  $('month-kpi').textContent = d.monthly.amount ? `${d.monthly.amount.delta} (${d.monthly.percent.formatted})` : '—';
  $('work-share').textContent = d.workingShare.formatted;
  $('work-amount').textContent = d.workingCapital.formatted;
  $('frozen-line').textContent = d.frozenCapital.amount === '0.00' ? '' : `Заморожено ${d.frozenCapital.formatted}`;
  renderTicks(d.workingShare);
  renderMinis(d.materials);
  renderWatch(d.materials);
  renderAllocation(d.materials);
  renderFlows(d.flows);
  applyCapitalHeader();
  applyCumHeader();
  const win = currentWindow();
  $('pnl-total').textContent = `${win.amount.delta} · ${win.percent.formatted}`;
  $('pnl-total').className = pillClass(win.percent.formatted, false);
  $('pnl-caption').textContent =
    state.range === '3M' || state.range === '1Y' || state.range === 'All'
      ? 'По месяцам'
      : 'По дням, когда обновляли баланс';
  if (animate) {
    animateCapital();
    animateCum();
  } else {
    drawCapitalFrame(1);
    drawCumFrame(1);
  }
  drawPnlFrame();
  drawGauge($('gauge'), d.workingShare);
}

function renderAll() {
  renderOverview({ animate: true });
  fillCardSelects();
  renderJournal();
  renderMaterials();
}

async function reload() {
  state.data = await api('/api/overview');
  renderAll();
}

const OP_STEPS = {
  create: {
    title: 'Добавить материал',
    hint: 'Название и текущий баланс. Эта сумма — точка отсчёта, прибылью не считается.',
    amount: 'Текущий баланс',
  },
  update: {
    title: 'Зафиксировать прибыль',
    hint: 'Введите новый баланс. Разница с предыдущим — прибыль или убыток.',
    amount: 'Новый баланс',
  },
  topup: {
    title: 'Пополнить материал',
    hint: 'Введите новый баланс после пополнения, не величину добавки. Прибыль не изменится.',
    amount: 'Новый баланс',
  },
  spend: {
    title: 'Снять деньги с материала',
    hint: 'Введите новый баланс после снятия, не сколько вывели. Прибыль не изменится.',
    amount: 'Новый баланс',
  },
};

function showOpMenu() {
  $('op-kind').value = '';
  $('op-menu').classList.remove('hidden');
  $('op-form').classList.add('hidden');
  showError('op-error', '');
  $('op-amount').value = '';
  $('op-name').value = '';
}

function openOp(kind, cardId) {
  const step = OP_STEPS[kind];
  if (!step) return;
  $('op-kind').value = kind;
  $('op-title').textContent = step.title;
  $('op-hint').textContent = step.hint;
  $('op-amount-label').textContent = step.amount;
  $('name-field').classList.toggle('hidden', kind !== 'create');
  $('card-field').classList.toggle('hidden', kind === 'create');
  $('op-name').required = kind === 'create';
  $('op-menu').classList.add('hidden');
  $('op-form').classList.remove('hidden');
  showError('op-error', '');
  if (kind !== 'create' && cardId) {
    $('op-card').value = String(cardId);
  }
  const focusId = kind === 'create' ? 'op-name' : 'op-amount';
  requestAnimationFrame(() => $(focusId).focus());
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

function bindCharts() {
  const capital = $('capital-chart');
  const pnl = $('pnl-chart');
  const cum = $('cum-chart');
  const capTip = $('capital-tooltip');
  const pnlTip = $('pnl-tooltip');
  const cumTip = $('cum-tooltip');

  capital.addEventListener('mousemove', (event) => {
    const idx = nearestByX(charts.capitalLayout, event.clientX, capital);
    if (idx < 0) return;
    const point = charts.capitalLayout.points[idx];
    state.hoverCapital = point;
    applyCapitalHeader();
    drawCapitalFrame(1);
    placeTooltip(
      capTip,
      capital,
      event.clientX,
      event.clientY,
      `<strong>${escapeHtml(point.formatted)}</strong><span>${escapeHtml(fmtDate(point.date))}</span>`,
    );
  });
  capital.addEventListener('mouseleave', () => {
    state.hoverCapital = null;
    hideTooltip(capTip);
    applyCapitalHeader();
    drawCapitalFrame(1);
  });

  cum.addEventListener('mousemove', (event) => {
    const idx = nearestByX(charts.cumLayout, event.clientX, cum);
    if (idx < 0) return;
    const point = charts.cumLayout.points[idx];
    state.hoverCum = point;
    applyCumHeader();
    drawCumFrame(1);
    placeTooltip(
      cumTip,
      cum,
      event.clientX,
      event.clientY,
      `<strong>${escapeHtml(point.formatted)}</strong><span>${escapeHtml(fmtDate(point.date))}</span>`,
    );
  });
  cum.addEventListener('mouseleave', () => {
    state.hoverCum = null;
    hideTooltip(cumTip);
    applyCumHeader();
    drawCumFrame(1);
  });

  pnl.addEventListener('mousemove', (event) => {
    const idx = nearestByX(charts.pnlLayout, event.clientX, pnl);
    if (idx < 0) return;
    const point = charts.pnlLayout.points[idx];
    state.hoverPnl = point;
    drawPnlFrame();
    const pct = point.percent && point.percent.formatted ? point.percent.formatted : '—';
    placeTooltip(
      pnlTip,
      pnl,
      event.clientX,
      event.clientY,
      `<strong>${escapeHtml(point.formatted)}</strong><span>${escapeHtml(point.label)} · ${escapeHtml(pct)}</span>`,
    );
  });
  pnl.addEventListener('mouseleave', () => {
    state.hoverPnl = null;
    hideTooltip(pnlTip);
    drawPnlFrame();
  });
}

$('op-menu').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-kind]');
  if (!btn) return;
  openOp(btn.dataset.kind);
});

$('op-back').addEventListener('click', () => showOpMenu());

$('op-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('op-error', '');
  const kind = $('op-kind').value;
  const amount = $('op-amount').value;
  try {
    if (kind === 'create') {
      await api('/api/cards', {
        method: 'POST',
        body: JSON.stringify({ name: $('op-name').value, amount }),
      });
    } else {
      const cardId = Number($('op-card').value);
      if (kind === 'update') {
        await api('/api/balances', { method: 'POST', body: JSON.stringify({ cardId, amount }) });
      } else if (kind === 'topup') {
        await api('/api/topup', { method: 'POST', body: JSON.stringify({ cardId, newAmount: amount }) });
      } else {
        await api('/api/spend', { method: 'POST', body: JSON.stringify({ cardId, newAmount: amount }) });
      }
    }
    $('op-amount').value = '';
    $('op-name').value = '';
    showOpMenu();
    await reload();
  } catch (error) {
    showError('op-error', error.message);
  }
});

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('ranges').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-range]');
  if (!btn) return;
  event.preventDefault();
  state.range = btn.dataset.range;
  state.hoverCapital = null;
  state.hoverPnl = null;
  state.hoverCum = null;
  hideTooltip($('capital-tooltip'));
  hideTooltip($('pnl-tooltip'));
  hideTooltip($('cum-tooltip'));
  document.querySelectorAll('#ranges button').forEach((el) => el.classList.toggle('is-active', el === btn));
  applyCapitalHeader();
  applyCumHeader();
  requestAnimationFrame(() => renderOverview({ animate: true }));
});

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = '/login';
});

$('journal').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-fix]');
  if (!btn) return;
  $('op-kind').value = 'update';
  openOp('update', btn.dataset.fix);
  switchTab('ops');
});

$('material-table').addEventListener('click', async (event) => {
  const freeze = event.target.closest('[data-freeze]');
  const unfreeze = event.target.closest('[data-unfreeze]');
  const archive = event.target.closest('[data-archive]');
  try {
    if (freeze) {
      await api('/api/freeze', { method: 'POST', body: JSON.stringify({ cardId: Number(freeze.dataset.freeze) }) });
      await reload();
    } else if (unfreeze) {
      await api('/api/unfreeze', { method: 'POST', body: JSON.stringify({ cardId: Number(unfreeze.dataset.unfreeze) }) });
      await reload();
    } else if (archive) {
      openArchive(Number(archive.dataset.archive));
    }
  } catch (error) {
    alert(error.message);
  }
});

function openArchive(cardId) {
  const item = (state.data.materials || []).find((row) => row.id === cardId);
  if (!item) return;
  state.archiveCardId = cardId;
  $('archive-text').textContent = `«${item.name}» · ${item.balance.formatted}. История сохранится.`;
  const zero = item.balance.amount === '0.00';
  $('archive-reason-wrap').classList.toggle('hidden', zero);
  $('archive-target-wrap').classList.add('hidden');
  $('archive-reason').value = 'WITHDRAWN';
  showError('archive-error', '');
  $('archive-target').querySelectorAll('option').forEach((opt) => {
    opt.hidden = Number(opt.value) === cardId;
  });
  $('archive-dialog').showModal();
}

$('archive-reason').addEventListener('change', () => {
  $('archive-target-wrap').classList.toggle('hidden', $('archive-reason').value !== 'TRANSFERRED');
});

$('archive-cancel').addEventListener('click', () => $('archive-dialog').close());

$('archive-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const item = (state.data.materials || []).find((row) => row.id === state.archiveCardId);
  if (!item) return;
  const zero = item.balance.amount === '0.00';
  const payload = {
    cardId: state.archiveCardId,
    reason: zero ? 'WITHDRAWN' : $('archive-reason').value,
  };
  if (payload.reason === 'TRANSFERRED') {
    payload.targetCardId = Number($('archive-target').value);
  }
  try {
    await api('/api/archive', { method: 'POST', body: JSON.stringify(payload) });
    $('archive-dialog').close();
    await reload();
  } catch (error) {
    showError('archive-error', error.message);
  }
});

(async function boot() {
  try {
    await api('/api/me');
    showOpMenu();
    bindCharts();
    await reload();
    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      if (!state.data) return;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => renderOverview({ animate: false }));
    });
  } catch {
    location.href = '/login';
  }
})();
