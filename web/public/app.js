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
const QUOTE_MS = 15_000;
const CROWDED_WATCH = 10;

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

function fmtDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const day = date.toLocaleDateString('ru-RU');
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
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

/** Календарное окно кнопки периода: чем режем историю, не ось. */
function viewRange(today, range, series) {
  const to = today;
  if (range === 'All') {
    const first = series && series.length > 0 ? series[0].date : today;
    return { from: first, to };
  }
  return { from: rangeFrom(today, range), to };
}

/**
 * Ось всегда по видимым точкам слева направо.
 * 1W…1Y только ограничивают, сколько истории взять: пустые месяцы слева не рисуем,
 * иначе неделя на «1Y» сжимается в полоску у правого края.
 */
function plotView(today, range, series) {
  const view = viewRange(today, range, series);
  const visible = filterByDate(series, range, today);
  if (visible.length === 0) return view;
  return { from: visible[0].date, to: view.to };
}

function xAtDate(date, from, to, plot) {
  const span = Math.max(1, daysBetweenIso(from, to));
  const t = Math.min(1, Math.max(0, daysBetweenIso(from, date) / span));
  return plot.x0 + t * plot.innerW;
}

function fmtAxisDate(iso, spanDays) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (spanDays >= 90) {
    return `${MONTHS[Number(m) - 1]} ${String(y).slice(2)}`;
  }
  return `${d}.${m}`;
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
    labels.push({ x: xAtDate(date, from, to, plot), text: fmtAxisDate(date, span) });
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

function formatRate(value) {
  if (value == null || value === '') return '—';
  const [intPart = '0', frac = '00'] = String(value).split('.');
  return `${intPart},${(frac + '00').slice(0, 2)}`;
}

function paintQuote(data) {
  const buy = $('usdt-buy');
  const sell = $('usdt-sell');
  const link = $('usdt-rate');
  if (!buy || !sell) return;
  const ok = data && data.ask != null && data.bid != null;
  buy.textContent = ok ? formatRate(data.ask) : '—';
  sell.textContent = ok ? formatRate(data.bid) : '—';
  if (link && data && data.href) {
    link.href = data.href;
  }
  if (link) {
    link.title = ok
      ? `USDT/RUB на Rapira: покупка ${formatRate(data.ask)}, продажа ${formatRate(data.bid)}`
      : 'Курс USDT/RUB на Rapira';
  }
}

async function refreshQuote() {
  if (refreshQuote.busy) return;
  refreshQuote.busy = true;
  try {
    const res = await fetch('/api/quote/usdt-rub', { credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    paintQuote(res.ok ? body : null);
  } catch {
    paintQuote(null);
  } finally {
    refreshQuote.busy = false;
  }
}

function startQuotePolling() {
  void refreshQuote();
  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    void refreshQuote();
  }, QUOTE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshQuote();
  });
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === tab);
  });
  $('panel-overview').classList.toggle('hidden', tab !== 'overview');
  $('panel-ops').classList.toggle('hidden', tab !== 'ops');
  if (tab === 'overview' && state.data) {
    requestAnimationFrame(() => renderOverview({ animate: true }));
  }
}

function isFrozenMaterial(item) {
  return item.status === 'frozen';
}

function frostTag() {
  return '<span class="frost-tag">заморожен</span>';
}

function iconSnow() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18M5 7l14 10M5 17l14-10"/></svg>';
}

function iconUndo() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v5h5"/></svg>';
}

function iconTrash() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 7l.8 12h6.4L16 7"/></svg>';
}

function closeWatchActions() {
  document.querySelectorAll('.watch.is-open').forEach((el) => el.classList.remove('is-open'));
}

function renderWatch(materials) {
  const root = $('watchlist');
  const count = $('watch-count');
  root.innerHTML = '';
  root.classList.toggle('is-crowded', materials.length > CROWDED_WATCH);
  if (count) {
    count.textContent = materials.length === 0 ? '' : `${materials.length}`;
  }
  if (materials.length === 0) {
    root.innerHTML = '<p class="muted">Пока нет материалов</p>';
    return;
  }
  materials.forEach((item) => {
    const frozen = isFrozenMaterial(item);
    const el = document.createElement('div');
    el.className = frozen ? 'watch is-frozen' : 'watch';
    el.dataset.cardId = String(item.id);
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const down = isDown(item.change.formatted);
    const bank = BANK_COLOR[item.bank] || BANK_COLOR.other;
    if (!frozen) el.style.setProperty('--bank', bank);
    el.title = frozen ? `${item.name} · заморожен` : item.name;
    const primary = frozen
      ? `<button type="button" class="watch-act restore" data-unfreeze="${item.id}" aria-label="Вернуть в оборот">${iconUndo()}<span>Вернуть</span></button>`
      : `<button type="button" class="watch-act frost" data-freeze="${item.id}" aria-label="Заморозить">${iconSnow()}<span>Заморозить</span></button>`;
    el.innerHTML = `
      <div class="watch-veil" aria-hidden="true"></div>
      <div class="watch-body">
        <div class="sym">${escapeHtml(item.name)}${frozen ? frostTag() : ''}</div>
        <div class="bal">${escapeHtml(item.balance.formatted)}</div>
        <div class="chg ${down ? 'down' : 'up'}">${escapeHtml(item.change.formatted)}</div>
      </div>
      <div class="watch-actions">
        ${primary}
        <button type="button" class="watch-act remove" data-archive="${item.id}" aria-label="Удалить">${iconTrash()}<span>Удалить</span></button>
      </div>`;
    root.append(el);
  });
}

function renderAllocation(materials) {
  const root = $('allocation');
  root.innerHTML = '';
  root.classList.toggle('is-crowded', materials.length > CROWDED_WATCH);
  materials.forEach((item) => {
    const frozen = isFrozenMaterial(item);
    const pct = item.share.defined ? num(item.share.value) : 0;
    const row = document.createElement('div');
    row.className = frozen ? 'alloc-row is-frozen' : 'alloc-row';
    const width = `${Math.min(100, Math.max(0, pct))}%`;
    const barColor = frozen ? '#38bdf8' : BANK_COLOR[item.bank] || BANK_COLOR.other;
    row.innerHTML = `
      <span>${escapeHtml(item.name)}</span>
      <div class="bar"><span style="width:0;background:${barColor}"></span></div>
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

function liveMaterials() {
  const archivedIds = new Set((state.data.archived || []).map((row) => row.id));
  return (state.data.materials || []).filter((item) => !archivedIds.has(item.id));
}

function fillCardSelects() {
  const materials = liveMaterials();
  const prev = $('op-card').value;
  const html = materials.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  $('op-card').innerHTML = html;
  $('archive-target').innerHTML = html;
  if (prev && materials.some((item) => String(item.id) === prev)) {
    $('op-card').value = prev;
  }
  syncCurrentBalance();
}

function selectedMaterial() {
  const id = Number($('op-card').value);
  return liveMaterials().find((item) => item.id === id) ?? null;
}

function usesBalanceShift(kind) {
  return kind === 'update' || kind === 'topup' || kind === 'spend';
}

function syncCurrentBalance() {
  const item = selectedMaterial();
  $('op-current').textContent = item ? item.balance.formatted : '—';
}

function toggleBalanceShift(kind) {
  const show = usesBalanceShift(kind);
  $('current-balance-block').classList.toggle('hidden', !show);
  $('balance-arrow').classList.toggle('hidden', !show);
  if (show) syncCurrentBalance();
}

function renderJournal() {
  const body = $('journal');
  body.innerHTML = '';
  const activeIds = new Set(liveMaterials().map((item) => item.id));
  const rows = state.data.journal || [];
  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="muted">Пока нет действий</td></tr>';
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const kindClass =
      row.kind === 'FREEZE'
        ? 'journal-row is-freeze'
        : row.kind === 'UNFREEZE'
          ? 'journal-row is-unfreeze'
          : row.kind === 'ARCHIVE'
            ? 'journal-row is-archive'
            : 'journal-row';
    tr.className = kindClass;
    const inAmt = row.capitalIn && num(row.capitalIn.amount) > 0 ? `+ ${row.capitalIn.formatted}` : '';
    const outAmt = row.capitalOut && num(row.capitalOut.amount) > 0 ? `− ${row.capitalOut.formatted}` : '';
    const flow = inAmt || outAmt || '—';
    const amount = row.amount ? row.amount.formatted : '—';
    const canFix = Boolean(row.canFix) && activeIds.has(row.cardId);
    tr.innerHTML = `
      <td>${escapeHtml(fmtDateTime(row.at))}</td>
      <td>${escapeHtml(row.cardName)}</td>
      <td>${escapeHtml(row.sourceLabel)}</td>
      <td>${escapeHtml(amount)}</td>
      <td>${escapeHtml(flow)}</td>
      <td>${canFix ? `<button type="button" class="linkish" data-fix="${row.cardId}">Исправить</button>` : ''}</td>`;
    body.append(tr);
  });
}

function renderArchive() {
  const arch = $('archive-list');
  arch.innerHTML = '';
  const archived = state.data.archived || [];
  if (archived.length === 0) {
    arch.innerHTML = '<li class="muted">Архив пуст</li>';
    return;
  }
  archived.forEach((row) => {
    const li = document.createElement('li');
    const reason = row.reasonLabel || row.reason;
    li.innerHTML = `<span>${escapeHtml(row.name)} · ${escapeHtml(fmtDate(row.archivedOn))}</span><span>${escapeHtml(reason)}</span>`;
    arch.append(li);
  });
}

function sizeCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  // CSS must pin layout size. Otherwise width/height attributes (= bitmap × dpr)
  // stretch the canvas on each redraw and the page grows without bound.
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
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min > max) {
    const swap = min;
    min = max;
    max = swap;
  }
  if (min === max) {
    const pad = Math.max(100, Math.abs(min) * 0.04);
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  let end = Math.ceil(max / step) * step;
  if (end < max) {
    end += step;
  }
  const ticks = [];
  const steps = Math.max(1, Math.round((end - start) / step));
  for (let i = 0; i <= steps; i += 1) {
    ticks.push(start + i * step);
  }
  return { min: start, max: ticks[ticks.length - 1] ?? end, ticks, step };
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

function drawAnchor(ctx, x, y, color) {
  ctx.beginPath();
  ctx.fillStyle = '#fff';
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function applyCapitalHeader() {
  const win = currentWindow();
  const hover = state.hoverCapital;
  const view = plotView(state.data.today, state.range, state.data.capitalSeries);
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
  const plotBase = layoutPlot(width, height, { top: 14, right: 20, bottom: 28, left: 52 });
  if (points.length === 0) {
    charts.capitalLayout = null;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Пока нет точек баланса', plotBase.x0, plotBase.y0 + 24);
    return;
  }
  const values = points.map((p) => num(p.capital));
  const scale = niceTicks(Math.min(...values), Math.max(...values), 3);
  const plot = { ...plotBase, min: scale.min, max: scale.max };
  const view = plotView(state.data.today, state.range, state.data.capitalSeries);
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

  const last = visible.length - 1;
  drawAnchor(ctx, xAt(last), yAt(values[last]), '#e85d04');

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
  tick(start);
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
  tick(start);
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
  const view = plotView(state.data.today, state.range, state.data.capitalSeries);
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
  const view = plotView(state.data.today, state.range, state.data.capitalSeries);
  const plotBase = layoutPlot(width, height, { top: 14, right: 20, bottom: 28, left: 52 });
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

  const last = visible.length - 1;
  drawAnchor(ctx, xAt(last), yAt(values[last]), values[last] < 0 ? '#e10f04' : '#1a9365');

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
  const plotBase = layoutPlot(width, height, { top: 16, right: 20, bottom: 28, left: 52 });
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

function renderInOut(io) {
  const deposits = io?.deposits;
  const withdrawals = io?.withdrawals;
  const inShare = io?.depositShare || { defined: false, formatted: '—' };
  const outShare = io?.withdrawalShare || { defined: false, formatted: '—' };
  $('in-pct').textContent = inShare.formatted;
  $('out-pct').textContent = outShare.formatted;
  $('in-amount').textContent = deposits ? deposits.formatted : '—';
  $('out-amount').textContent = withdrawals ? withdrawals.formatted : '—';
  const inPct = inShare.defined ? Math.min(100, Math.max(0, num(inShare.value))) : 0;
  const outPct = outShare.defined ? Math.min(100, Math.max(0, num(outShare.value))) : 0;
  const empty = inPct === 0 && outPct === 0;
  const ring = $('io-ring');
  ring.classList.toggle('is-empty', empty);
  ring.classList.toggle('is-in-only', !empty && outPct === 0);
  ring.classList.toggle('is-out-only', !empty && inPct === 0);
  ring.style.setProperty('--in-pct', `${inPct}%`);
  ring.setAttribute(
    'aria-label',
    `Ввод ${inShare.formatted}, ${deposits ? deposits.formatted : '—'}; вывод ${outShare.formatted}, ${withdrawals ? withdrawals.formatted : '—'}`,
  );
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
  const chartsOnly = Boolean(options.chartsOnly);
  if (!chartsOnly) {
    $('today-label').textContent = fmtDate(d.today);
    $('updated-label').textContent = d.lastUpdateDate ? `обновлено ${fmtDate(d.lastUpdateDate)}` : '';
    $('hero-balance').textContent = d.totalCapital ? d.totalCapital.formatted : '—';
    $('hero-balance-pct').textContent = d.allTime.percent ? d.allTime.percent.formatted : '—';
    $('hero-balance-pct').className = pillClass(d.allTime.percent ? d.allTime.percent.formatted : '', false);
    $('frozen-kpi').textContent = d.frozenCapital ? d.frozenCapital.formatted : '—';
    $('working-kpi').textContent = d.workingCapital ? d.workingCapital.formatted : '—';
    $('daily-kpi').textContent = d.daily.formatted || '—';
    $('month-kpi').textContent = d.monthly.amount ? `${d.monthly.amount.delta} (${d.monthly.percent.formatted})` : '—';
    renderWatch(liveMaterials());
    renderAllocation(liveMaterials());
    renderFlows(d.flows);
    renderInOut(d.inOut);
  }
  applyCapitalHeader();
  applyCumHeader();
  const win = currentWindow();
  $('pnl-kpi').textContent = win.amount ? win.amount.delta : '—';
  const pnlPct = win.percent ? win.percent.formatted : '—';
  $('pnl-pct').textContent = pnlPct;
  $('pnl-pct').className = pillClass(pnlPct, false);
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
}

function renderAll() {
  renderOverview({ animate: true });
  fillCardSelects();
  renderJournal();
  renderArchive();
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
  toggleBalanceShift('');
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
  toggleBalanceShift(kind);
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

$('op-card').addEventListener('change', () => syncCurrentBalance());

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
  renderOverview({ animate: true, chartsOnly: true });
});

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = '/login';
});

$('journal').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-fix]');
  if (!btn) return;
  openOp('update', btn.dataset.fix);
  switchTab('ops');
});

$('watchlist').addEventListener('click', async (event) => {
  const freeze = event.target.closest('[data-freeze]');
  const unfreeze = event.target.closest('[data-unfreeze]');
  const archive = event.target.closest('[data-archive]');
  const tile = event.target.closest('.watch');
  try {
    if (freeze) {
      event.stopPropagation();
      await api('/api/freeze', { method: 'POST', body: JSON.stringify({ cardId: Number(freeze.dataset.freeze) }) });
      await reload();
      return;
    }
    if (unfreeze) {
      event.stopPropagation();
      await api('/api/unfreeze', { method: 'POST', body: JSON.stringify({ cardId: Number(unfreeze.dataset.unfreeze) }) });
      await reload();
      return;
    }
    if (archive) {
      event.stopPropagation();
      openArchive(Number(archive.dataset.archive));
      return;
    }
  } catch (error) {
    alert(error.message);
    return;
  }
  if (!tile) return;
  const open = tile.classList.contains('is-open');
  closeWatchActions();
  if (!open) tile.classList.add('is-open');
});

$('watchlist').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const tile = event.target.closest('.watch');
  if (!tile || event.target.closest('.watch-act')) return;
  event.preventDefault();
  const open = tile.classList.contains('is-open');
  closeWatchActions();
  if (!open) tile.classList.add('is-open');
});

document.addEventListener('click', (event) => {
  if (event.target.closest('#watchlist') || event.target.closest('dialog')) return;
  closeWatchActions();
});

function openArchive(cardId) {
  const item = liveMaterials().find((row) => row.id === cardId);
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
  const item = liveMaterials().find((row) => row.id === state.archiveCardId);
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
    startQuotePolling();
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
