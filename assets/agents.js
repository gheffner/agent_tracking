/* RevOps dashboards — Agents command room helpers.
 * Loaded after common.js (and risk.js) on agents.html. Adds renderers + the
 * write (toggle) logic under RevOps. Self-contained esc/json so it works even
 * against a stale cached common.js.
 */
(function () {
  const R = window.RevOps;
  const esc = R.esc || function (s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  if (!R.esc) R.esc = esc;

  // Pretty-print a value (objects → JSON; strings that look like JSON → parsed).
  function jsonBlock(v) {
    let obj = v;
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try { obj = JSON.parse(t); } catch (_) { obj = v; }
      }
    }
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    return `<pre class="json">${esc(text)}</pre>`;
  }
  R.jsonBlock = R.jsonBlock || jsonBlock;

  /* ---------- semver ---------- */
  R.semverCmp = function (a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  };
  R.latestVersion = (versions) => versions.slice().sort(R.semverCmp).pop();

  /* ---------- confirm modal (returns Promise<boolean>) ---------- */
  R.confirmModal = function (opts) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.innerHTML = `<div class="modal ${opts.danger ? 'danger' : ''}">
        <h3>${esc(opts.title)}</h3>
        <p>${opts.message || ''}</p>
        <div class="actions">
          <button class="btn" data-x="0">Cancel</button>
          <button class="btn-primary ${opts.danger ? 'danger' : ''}" data-x="1">${esc(opts.confirmLabel || 'Confirm')}</button>
        </div></div>`;
      document.body.appendChild(back);
      const done = (v) => { back.remove(); document.removeEventListener('keydown', onkey); resolve(v); };
      back.addEventListener('click', e => {
        if (e.target === back) return done(false);
        const x = e.target.closest('[data-x]');
        if (x) done(x.dataset.x === '1');
      });
      const onkey = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
      document.addEventListener('keydown', onkey);
    });
  };

  /* ---------- toggle write ---------- *
   * ON  = activate latest version (deactivate any other active version first,
   *       in a separate statement, to avoid a transient unique-index violation).
   * OFF = deactivate all active versions for the ref.
   * Returns the RETURNING rows so the caller can confirm the new state. */
  R.setAgentActive = async function (agentRef, turnOn, latestVersion) {
    if (turnOn) {
      await R.sql('agent',
        `UPDATE core.agents SET is_active = false
         WHERE agent_ref = $1 AND is_active = true AND version <> $2`, [agentRef, latestVersion]);
      return R.sql('agent',
        `UPDATE core.agents SET is_active = true
         WHERE agent_ref = $1 AND version = $2
         RETURNING agent_ref, version, is_active`, [agentRef, latestVersion]);
    }
    return R.sql('agent',
      `UPDATE core.agents SET is_active = false
       WHERE agent_ref = $1 AND is_active = true
       RETURNING agent_ref, version, is_active`, [agentRef]);
  };

  /* ---------- LLM transcript ---------- */
  function toolUse(name, input) {
    return `<div class="block"><div class="block-label">🔧 tool_use · ${esc(name)}</div>${jsonBlock(input)}</div>`;
  }
  function renderContent(content) {
    if (content == null) return '';
    if (typeof content === 'string') return esc(content);
    if (Array.isArray(content)) {
      return content.map(b => {
        if (typeof b === 'string') return esc(b);
        if (!b || typeof b !== 'object') return esc(String(b));
        if (b.type === 'text') return esc(b.text || '');
        if (b.type === 'tool_use') return toolUse(b.name, b.input);
        if (b.type === 'tool_result')
          return `<div class="block"><div class="block-label">↩ tool_result</div>${renderContent(b.content)}</div>`;
        return jsonBlock(b);
      }).join('');
    }
    return jsonBlock(content);
  }
  function renderMsg(m) {
    const role = String((m && m.role) || 'assistant').toLowerCase();
    const cls = ['system', 'user', 'assistant', 'tool', 'developer'].includes(role) ? role : 'assistant';
    let body = renderContent(m.content);
    if (Array.isArray(m.tool_calls)) {
      body += m.tool_calls.map(tc => toolUse(
        (tc.function && tc.function.name) || tc.name || 'call',
        (tc.function && tc.function.arguments) || tc.input)).join('');
    }
    return `<div class="msg ${cls}"><div class="role">${esc(role)}</div>
      <div class="body">${body || '<span style="color:var(--muted)">(empty)</span>'}</div>
      <details class="raw"><summary>raw</summary>${jsonBlock(m)}</details></div>`;
  }
  // calls: rows from runs.llm_calls ordered by iteration. The last call's
  // `messages` is the full accumulated conversation; its `response` is the final turn.
  R.renderTranscript = function (calls) {
    if (!calls || !calls.length) return '<div class="empty">No LLM calls recorded for this run.</div>';
    const last = calls[calls.length - 1];
    const msgs = Array.isArray(last.messages) ? last.messages.slice() : [];
    let html = '<div class="transcript">';
    for (const m of msgs) html += renderMsg(m);
    if (last.response != null) html += renderMsg({ role: 'assistant', content: last.response });
    html += '</div>';
    return html;
  };

  // Compact per-iteration table of model calls.
  R.renderCallTable = function (calls) {
    if (!calls || !calls.length) return '';
    const rows = calls.map(c => `<tr>
      <td class="num">${esc(c.iteration)}</td>
      <td><span class="mono">${esc(c.model_id)}</span></td>
      <td class="num">${R.fmt.compact(c.tokens_input)}</td>
      <td class="num">${R.fmt.compact(c.tokens_output)}</td>
      <td class="num">${R.fmt.ms(c.latency_ms)}</td>
      <td class="num">${R.fmt.usd4(c.cost_usd)}</td>
      <td>${esc(c.stop_reason) || '—'}</td></tr>`).join('');
    return `<div class="table-wrap" style="margin-top:16px"><table class="data"><thead><tr>
      <th class="num">Iter</th><th>Model</th><th class="num">Tok in</th><th class="num">Tok out</th>
      <th class="num">Latency</th><th class="num">Cost</th><th>Stop reason</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };

  /* ---------- run-event timeline ---------- */
  R.renderTimeline = function (events) {
    if (!events || !events.length) return '<div class="empty">No events recorded for this run.</div>';
    const ERR = /error|fail|halt|exceeded|rejected|invalid|stale/i;
    const items = events.map(e => {
      const err = ERR.test(e.event_type || '');
      const hasPayload = e.payload && typeof e.payload === 'object' && Object.keys(e.payload).length;
      return `<div class="tl-item ${err ? 'err' : ''}">
        <div class="tl-head"><span class="tl-type">${esc(e.event_type)}</span>
          <span class="tl-time">${esc(R.fmt.dt(e.ts))} · #${esc(e.sequence_no)}</span></div>
        ${hasPayload ? `<details class="raw"><summary>payload</summary>${jsonBlock(e.payload)}</details>` : ''}
      </div>`;
    }).join('');
    return `<div class="timeline">${items}</div>`;
  };
})();
