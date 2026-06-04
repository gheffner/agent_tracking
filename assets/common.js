/* GTM Agent Platform dashboards — shared runtime.
 *
 * Exposes a single global: window.RevOps
 *
 * Data access goes through window.SQL_CONFIG (set by config.js). Two databases
 * are supported, matching the two AWS API Gateway routes:
 *   SQL_CONFIG.agent     -> /db/agent_platform/sql   (runs, decisions, core, observations…)
 *   SQL_CONFIG.webhooks  -> /db/webhooks/sql         (webhook_events, oauth tokens)
 *
 * In production each entry's `url` is a same-origin path (/api/sql, /api/webhooks/sql)
 * and nginx injects the X-Identity / X-Internal-Secret headers, so the browser
 * never sees the secret. In local dev, config.js holds the real AWS URLs + headers.
 */
(function () {
  const RevOps = {};

  /* ----------------------------- SQL client ----------------------------- */
  async function sql(db, query, params = []) {
    if (!window.SQL_CONFIG) {
      throw new Error('Missing config.js — copy config.example.js to config.js and fill in your credentials.');
    }
    const cfg = window.SQL_CONFIG[db];
    if (!cfg) throw new Error(`Unknown database "${db}" in SQL_CONFIG.`);
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { ...(cfg.headers || {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: query, params })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'SQL error');
    return json.rows || [];
  }
  RevOps.sql = sql;

  /* ----------------------------- Formatters ----------------------------- */
  const nf = new Intl.NumberFormat('en-US');
  const fmt = {
    num: (n) => (n == null ? '—' : nf.format(Math.round(Number(n)))),
    usd: (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    usd4: (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })),
    pct: (n) => (n == null ? '—' : Number(n).toFixed(1) + '%'),
    compact: (n) => {
      if (n == null) return '—';
      n = Number(n);
      if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return nf.format(Math.round(n));
    },
    ms: (n) => {
      if (n == null) return '—';
      n = Number(n);
      if (n < 1000) return Math.round(n) + ' ms';
      if (n < 60000) return (n / 1000).toFixed(1) + ' s';
      const m = Math.floor(n / 60000), s = Math.round((n % 60000) / 1000);
      return m + 'm ' + s + 's';
    },
    dt: (s) => {
      if (!s) return '—';
      const d = new Date(s);
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
    rel: (s) => {
      if (!s) return '—';
      const diff = (Date.now() - new Date(s).getTime()) / 1000;
      if (diff < 60) return Math.round(diff) + 's ago';
      if (diff < 3600) return Math.round(diff / 60) + 'm ago';
      if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
      return Math.round(diff / 86400) + 'd ago';
    }
  };
  RevOps.fmt = fmt;

  /* Escape untrusted strings before inserting into innerHTML. */
  RevOps.esc = function (s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  /* ----------------------------- Color palette ----------------------------- */
  const PALETTE = ['#6366f1', '#22d3ee', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6', '#60a5fa', '#2dd4bf', '#fb923c'];
  RevOps.PALETTE = PALETTE;
  const _colorMap = {};
  let _colorIdx = 0;
  // Stable color per category key (model id, agent ref, source, status…)
  RevOps.colorFor = function (key) {
    if (!(key in _colorMap)) _colorMap[key] = PALETTE[_colorIdx++ % PALETTE.length];
    return _colorMap[key];
  };
  const STATUS_COLOR = {
    completed: '#34d399', succeeded: '#34d399', processed: '#34d399', approved: '#34d399',
    failed: '#f87171', failed_permanent: '#f87171', failed_retryable: '#fb923c', rejected: '#f87171', expired: '#fb923c',
    running: '#60a5fa', pending: '#fbbf24', sleeping: '#a78bfa', received: '#fbbf24',
    awaiting_approval: '#22d3ee', cancelled: '#7f8aa0', skipped_blocked: '#7f8aa0'
  };
  RevOps.statusColor = (s) => STATUS_COLOR[s] || RevOps.colorFor(s);

  /* ----------------------------- Chart.js defaults ----------------------------- */
  RevOps.applyChartDefaults = function () {
    if (!window.Chart) return;
    Chart.defaults.color = '#b3bccd';
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.borderColor = '#283145';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = '#1b2230';
    Chart.defaults.plugins.tooltip.borderColor = '#344056';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = '#e7ebf3';
    Chart.defaults.plugins.tooltip.bodyColor = '#b3bccd';
    Chart.defaults.plugins.tooltip.padding = 11;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.maintainAspectRatio = false;
  };

  // Create-or-replace a chart bound to a canvas id.
  const _charts = {};
  RevOps.chart = function (canvasId, config) {
    if (_charts[canvasId]) _charts[canvasId].destroy();
    const el = document.getElementById(canvasId);
    if (!el) return null;
    _charts[canvasId] = new Chart(el, config);
    return _charts[canvasId];
  };

  const GRID = { color: 'rgba(40,49,69,.5)' };
  RevOps.axes = {
    x: (opts = {}) => ({ grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, ...opts }),
    y: (opts = {}) => ({ beginAtZero: true, grid: GRID, ...opts }),
    yStacked: (opts = {}) => ({ beginAtZero: true, stacked: true, grid: GRID, ...opts })
  };

  /* ----------------------------- DOM helpers ----------------------------- */
  RevOps.kpis = function (containerId, items) {
    const el = document.getElementById(containerId);
    el.innerHTML = items.map(k => `
      <div class="kpi">
        <div class="label">${k.label}</div>
        <div class="value ${k.tone || ''}">${k.value}</div>
        ${k.sub ? `<div class="sub">${k.sub}</div>` : ''}
      </div>`).join('');
  };

  // columns: [{key, label, num?, render?(row)=>html}]
  RevOps.table = function (containerId, columns, rows, emptyMsg = 'No data in this range.') {
    const el = document.getElementById(containerId);
    if (!rows || !rows.length) { el.innerHTML = `<div class="empty">${emptyMsg}</div>`; return; }
    const head = columns.map(c => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('');
    const body = rows.map(r => '<tr>' + columns.map(c => {
      const v = c.render ? c.render(r) : (r[c.key] ?? '—');
      return `<td class="${c.num ? 'num' : ''}">${v}</td>`;
    }).join('') + '</tr>').join('');
    el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  };

  RevOps.badge = (text, cls) => `<span class="badge ${cls}">${text}</span>`;
  RevOps.statusBadge = function (s) {
    const map = {
      completed: 'green', succeeded: 'green', processed: 'green', approved: 'green',
      failed: 'red', failed_permanent: 'red', rejected: 'red',
      failed_retryable: 'amber', expired: 'amber', received: 'amber', pending: 'amber',
      running: 'blue', awaiting_approval: 'cyan', sleeping: 'blue',
      cancelled: 'gray', skipped_blocked: 'gray'
    };
    return RevOps.badge(s, map[s] || 'gray');
  };

  RevOps.banner = function (id, msg, kind = 'err') {
    const el = document.getElementById(id);
    if (!el) return;
    if (!msg) { el.className = 'banner'; el.textContent = ''; return; }
    el.className = `banner show ${kind}`;
    el.textContent = msg;
  };

  RevOps.setLoading = (on) => {
    document.querySelectorAll('[data-loads]').forEach(el => el.classList.toggle('loading', on));
  };

  /* ----------------------------- Navigation ----------------------------- */
  const PAGES = [
    { href: 'index.html', label: 'Overview' },
    { href: 'agents.html', label: 'Agents' },
    { href: 'agent_runs.html', label: 'Agent Runs' },
    { href: 'llm_usage.html', label: 'LLM Usage' },
    { href: 'tool_calls.html', label: 'Tool Calls' },
    { href: 'webhooks.html', label: 'Webhooks' },
    { href: 'decisions.html', label: 'Decisions' },
    { href: 'risk.html', label: 'Merchant Risk' }
  ];
  RevOps.nav = function (active) {
    const links = PAGES.map(p =>
      `<a href="${p.href}" class="${p.href === active ? 'active' : ''}">${p.label}</a>`).join('');
    const html = `
      <nav class="nav">
        <a class="nav-brand" href="index.html"><span class="dot"></span>GTM Agent Platform</a>
        <div class="nav-links">${links}</div>
        <div class="nav-status" id="nav-status"></div>
      </nav>`;
    document.body.insertAdjacentHTML('afterbegin', html);
  };
  RevOps.setStatus = function (txt) {
    const el = document.getElementById('nav-status');
    if (el) el.innerHTML = txt;
  };

  /* ----------------------------- Date range control -----------------------------
   * Presets are rolling windows. Custom uses two <input type=date> (local midnight).
   * State: { fromISO, toISO, bucket, key }. bucket is a date_trunc unit string.
   */
  function pickBucket(fromMs, toMs) {
    const days = (toMs - fromMs) / 86400000;
    if (days <= 2) return 'hour';
    if (days <= 45) return 'day';
    return 'week';
  }

  RevOps.DateRange = function (containerId, onChange) {
    const el = document.getElementById(containerId);
    const presets = [
      { key: '1d', label: 'Day', days: 1 },
      { key: '7d', label: 'Week', days: 7 },
      { key: '14d', label: '2 Weeks', days: 14 },
      { key: '30d', label: '30 Days', days: 30 }
    ];
    let state = { key: '7d', fromISO: null, toISO: null, bucket: 'day' };

    el.innerHTML = `
      <div class="controls">
        <div class="seg" id="${containerId}-seg">
          ${presets.map(p => `<button data-key="${p.key}" data-days="${p.days}">${p.label}</button>`).join('')}
        </div>
        <div class="daterange">
          <input type="date" id="${containerId}-from" title="From">
          <span>→</span>
          <input type="date" id="${containerId}-to" title="To">
          <button class="btn" id="${containerId}-apply">Apply</button>
        </div>
        <button class="btn" id="${containerId}-refresh" title="Refresh now">↻</button>
      </div>`;

    const seg = el.querySelector(`#${containerId}-seg`);
    const fromInput = el.querySelector(`#${containerId}-from`);
    const toInput = el.querySelector(`#${containerId}-to`);

    function emit() { onChange(state); }

    function applyPreset(key, days) {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86400000);
      state = { key, fromISO: from.toISOString(), toISO: to.toISOString(), bucket: pickBucket(from, to) };
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.key === key));
      // reflect into the date inputs for clarity
      fromInput.value = from.toISOString().slice(0, 10);
      toInput.value = to.toISOString().slice(0, 10);
      emit();
    }

    seg.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => applyPreset(b.dataset.key, Number(b.dataset.days)));
    });

    el.querySelector(`#${containerId}-apply`).addEventListener('click', () => {
      if (!fromInput.value || !toInput.value) return;
      const from = new Date(fromInput.value + 'T00:00:00');
      const to = new Date(toInput.value + 'T23:59:59');
      if (to <= from) return;
      state = { key: 'custom', fromISO: from.toISOString(), toISO: to.toISOString(), bucket: pickBucket(from, to) };
      seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      emit();
    });

    el.querySelector(`#${containerId}-refresh`).addEventListener('click', emit);

    RevOps._currentRange = () => state;
    applyPreset('7d', 7); // default
    return { get: () => state, refresh: emit };
  };

  /* Label a time bucket according to granularity. */
  RevOps.bucketLabel = function (iso, bucket) {
    const d = new Date(iso);
    if (bucket === 'hour') return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' });
    if (bucket === 'week') return 'wk ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  /* Pivot tall rows into aligned stacked-chart datasets.
   * rows: [{bucket, <seriesKey>, <valueKey>}], returns { labels, order, byLabel }.
   * labels = sorted distinct bucket ISO strings; order = distinct series keys (first-seen).
   * datasetFor(seriesName) -> array of values aligned to labels (0-filled). */
  RevOps.pivot = function (rows, seriesKey, valueKey, bucketKey = 'bucket') {
    const labels = [];
    const order = [];
    const map = {}; // label -> {series -> value}
    for (const r of rows) {
      const b = r[bucketKey];
      const s = r[seriesKey];
      if (!(b in map)) { map[b] = {}; labels.push(b); }
      if (!order.includes(s)) order.push(s);
      map[b][s] = Number(r[valueKey]) || 0;
    }
    labels.sort();
    return {
      labels,
      order,
      datasetFor: (s) => labels.map(l => (map[l] && map[l][s] != null ? map[l][s] : 0))
    };
  };

  /* Auto-refresh helper — returns a stop() fn. */
  RevOps.autoRefresh = function (fn, ms = 60000) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  };

  window.RevOps = RevOps;
})();
