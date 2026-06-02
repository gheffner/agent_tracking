/* RevOps dashboards — KYB/KYC evidence rendering helpers.
 * Loaded after common.js on kyb.html / kyc.html. Adds renderers under RevOps.
 * All DB-sourced strings are escaped via RevOps.esc before hitting innerHTML.
 */
(function () {
  const R = window.RevOps;
  const esc = R.esc;

  /* ---- recommendation / risk badges ---- */
  R.recBadge = function (rec) {
    if (!rec) return '<span class="badge gray">—</span>';
    const r = String(rec).toUpperCase();
    const cls = { APPROVE: 'green', PURSUE: 'green', DECLINE: 'red', REJECT: 'red', FLAG: 'red',
      EDD: 'amber', DEFER: 'amber', REVISE: 'amber', SKIP: 'gray' }[r] || 'blue';
    return `<span class="badge ${cls}">${esc(r)}</span>`;
  };
  R.hitBadge = function (hit) {
    return hit ? '<span class="badge red">HIT</span>' : '<span class="badge green">clean</span>';
  };

  /* ---- small key/value grid ---- */
  function kv(pairs) {
    const rows = pairs.filter(p => p[1] !== undefined && p[1] !== null && p[1] !== '')
      .map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`).join('');
    return `<div class="kv">${rows}</div>`;
  }
  function yn(b) { return b ? '<span class="badge green">yes</span>' : '<span class="badge gray">no</span>'; }
  function ev(title, ref, when, bodyHtml) {
    return `<div class="evidence"><div class="ev-head">${esc(title)}
      ${ref ? `<span class="mono">${esc(ref)}</span>` : ''}
      ${when ? `<span class="when">${esc(R.fmt.dt(when))}</span>` : ''}</div>${bodyHtml}</div>`;
  }
  R.jsonBlock = (obj) => `<pre class="json">${esc(JSON.stringify(obj, null, 2))}</pre>`;

  /* ---- Stripe: get_account ---- */
  function stripeAccount(res) {
    if (!res || res.ok === false) return errBlock(res);
    const caps = res.capabilities || {};
    const capChips = Object.keys(caps).map(k =>
      `<span class="badge ${caps[k] === 'active' ? 'green' : 'gray'}">${esc(k)}</span>`).join(' ');
    const req = res.requirements || {};
    const due = (req.currently_due || []).length;
    const pastDue = (req.past_due || []).length;
    const disabled = req.disabled_reason;
    const reqChips = [
      disabled ? `<span class="badge red">disabled: ${esc(disabled)}</span>` : '',
      pastDue ? `<span class="badge red">${pastDue} past due</span>` : '',
      due ? `<span class="badge amber">${due} currently due</span>` : '',
      (!disabled && !pastDue && !due) ? '<span class="badge green">no open requirements</span>' : ''
    ].filter(Boolean).join(' ');
    const company = res.company || {};
    const bp = res.business_profile || {};
    return kv([
      ['Business', esc(company.name || bp.name)],
      ['Account type', esc(res.type)],
      ['Business type', esc(res.business_type)],
      ['Structure', esc(company.structure)],
      ['MCC', esc(bp.mcc)],
      ['Country', esc(res.country)],
      ['Email', esc(res.email)],
      ['Created', res.created_iso ? esc(R.fmt.dt(res.created_iso)) : null],
      ['Charges enabled', yn(res.charges_enabled)],
      ['Payouts enabled', yn(res.payouts_enabled)],
      ['Details submitted', yn(res.details_submitted)],
      ['Stripe account', esc(res.account_id)]
    ]) +
    `<div class="chips" style="margin-top:10px"><span class="k" style="color:var(--muted);font-size:11px">Capabilities:</span> ${capChips || '—'}</div>` +
    `<div class="chips" style="margin-top:8px"><span class="k" style="color:var(--muted);font-size:11px">Requirements:</span> ${reqChips || '—'}</div>`;
  }

  /* ---- Stripe: list_account_persons ---- */
  function stripePersons(res) {
    if (!res || res.ok === false) return errBlock(res);
    const persons = res.persons || [];
    if (!persons.length) return '<div class="empty">No persons returned.</div>';
    const rows = persons.map(p => {
      const rel = p.relationship || {};
      const roles = ['owner', 'representative', 'director', 'executive'].filter(k => rel[k])
        .map(k => `<span class="badge blue">${k}</span>`).join(' ') || '—';
      const pct = rel.percent_ownership != null ? rel.percent_ownership + '%' : '—';
      return `<tr>
        <td>${esc(p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '))}</td>
        <td>${roles}</td>
        <td class="num">${esc(pct)}</td>
        <td>${esc(p.email) || '—'}</td>
        <td>${yn(p.id_number_provided)}</td>
        <td>${yn(p.ssn_last_4_provided)}</td>
        <td>${esc(p.verification_status) || '—'}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="data"><thead><tr>
      <th>Name</th><th>Role</th><th class="num">Ownership</th><th>Email</th>
      <th>ID#</th><th>SSN last4</th><th>Verification</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  /* ---- Stripe: get_customer (often a 403 permission error) ---- */
  function stripeCustomer(res) {
    if (!res) return '<div class="empty">No result.</div>';
    if (res.ok === false) return errBlock(res);
    return R.jsonBlock(res);
  }

  function errBlock(res) {
    const e = res && res.error ? res.error : {};
    const msg = e.message || (res && res.message) || 'Call failed';
    const status = res && res.status ? ` (HTTP ${esc(res.status)})` : '';
    return `<div class="banner show err" style="display:block">⚠ ${esc(msg)}${status}</div>` +
      (e.request_log_url ? `<div style="margin-top:6px"><a href="${esc(e.request_log_url)}" target="_blank" rel="noopener">Stripe request log ↗</a></div>` : '');
  }

  /* ---- Screening tools (sanctions / peps / sos / domain / sec) ---- */
  function matchList(matches) {
    if (!matches || !matches.length) return '';
    const rows = matches.slice(0, 10).map(m =>
      `<tr><td>${esc(m.name)}</td><td class="num">${esc(m.score)}</td><td>${esc(m.countries) || '—'}</td>
       <td>${esc(m.birth_date) || '—'}</td>
       <td>${m.opensanctions_url ? `<a href="${esc(m.opensanctions_url)}" target="_blank" rel="noopener">source ↗</a>` : '—'}</td></tr>`).join('');
    return `<div class="table-wrap" style="margin-top:8px"><table class="data"><thead><tr>
      <th>Match</th><th class="num">Score</th><th>Countries</th><th>DOB</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function screening(tool, res) {
    if (!res) return '<div class="empty">No result.</div>';
    if (tool === 'sanctions.check' || tool === 'peps.check') {
      const screened = res.total_entries_screened ?? res.total_peps_screened;
      return kv([
        ['Query', esc(res.query)],
        ['Result', R.hitBadge(res.hit)],
        ['Entries screened', screened != null ? R.fmt.num(screened) : null],
        ['Top matches', (res.top_matches || []).length]
      ]) + matchList(res.top_matches);
    }
    if (tool === 'sos.entity_search' || tool === 'sos.officer_search') {
      return kv([
        ['State', esc(res.state)],
        ['Status', `<span class="badge ${res.status === 'ok' ? 'green' : 'amber'}">${esc(res.status)}</span>`],
        ['Message', esc(res.message)],
        ['Portal', res.search_url ? `<a href="${esc(res.search_url)}" target="_blank" rel="noopener">open ↗</a>` : null]
      ]);
    }
    if (tool === 'domain.whois' || tool === 'domain.wayback') {
      return kv([
        ['Domain', esc(res.domain)],
        ['A records', (res.a_records || []).length],
        ['MX records', (res.mx_records || []).length],
        ['RDAP', esc(res.rdap_error) || 'ok'],
        ['DNSSEC signed', yn(res.dnssec_signed)],
        ['CT certs seen', res.ct_cert_count],
        ['First seen', res.ct_first_seen ? esc(R.fmt.dt(res.ct_first_seen)) : null]
      ]);
    }
    if (tool === 'sec.search') {
      return kv([['Query', esc(res.query)], ['Hits', res.hit_count ?? (res.results || []).length]]);
    }
    return R.jsonBlock(res);
  }

  /* ---- Markdown-lite for the full_case_file narrative (escape-first, safe) ---- */
  R.mdLite = function (md) {
    if (!md) return '';
    const lines = String(md).split('\n');
    let out = '', listOpen = false, tableRows = null;
    const closeList = () => { if (listOpen) { out += '</ul>'; listOpen = false; } };
    const flushTable = () => {
      if (!tableRows) return;
      const body = tableRows.map((cells, i) => {
        const tag = i === 0 ? 'th' : 'td';
        return '<tr>' + cells.map(c => `<${tag}>${inline(c.trim())}</${tag}>`).join('') + '</tr>';
      }).join('');
      out += `<table>${body}</table>`; tableRows = null;
    };
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    for (let raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (/^\s*\|.*\|\s*$/.test(line)) {                 // table row
        closeList();
        const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
        if (/^[\s:|-]+$/.test(line.replace(/\|/g, ''))) continue; // separator row
        (tableRows = tableRows || []).push(cells);
        continue;
      } else { flushTable(); }
      if (/^###\s+/.test(line)) { closeList(); out += `<h4>${inline(line.replace(/^###\s+/, ''))}</h4>`; }
      else if (/^##\s+/.test(line)) { closeList(); out += `<h3>${inline(line.replace(/^##\s+/, ''))}</h3>`; }
      else if (/^#\s+/.test(line)) { closeList(); out += `<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`; }
      else if (/^---+\s*$/.test(line)) { closeList(); out += '<hr>'; }
      else if (/^\s*[-•]\s+/.test(line)) { if (!listOpen) { out += '<ul>'; listOpen = true; } out += `<li>${inline(line.replace(/^\s*[-•]\s+/, ''))}</li>`; }
      else if (line.trim() === '') { closeList(); }
      else { closeList(); out += `<p>${inline(line)}</p>`; }
    }
    closeList(); flushTable();
    return out;
  };

  /* ---- Dispatch: render a single tool_call as an evidence card ---- */
  R.renderToolCall = function (call) {
    const tool = call.tool_name;
    const res = call.result;
    let body;
    if (tool === 'stripe.get_account') body = stripeAccount(res);
    else if (tool === 'stripe.list_account_persons') body = stripePersons(res);
    else if (tool === 'stripe.get_customer') body = stripeCustomer(res);
    else if (tool.startsWith('stripe.')) body = res && res.ok === false ? errBlock(res) : R.jsonBlock(res);
    else body = screening(tool, res);
    const argHint = call.tool_args && (call.tool_args.account_id || call.tool_args.customer_id || call.tool_args.query || call.tool_args.name);
    return ev(tool, argHint, call.started_at,
      (call.status && call.status !== 'succeeded' ? `<div style="margin-bottom:8px">${R.statusBadge(call.status)}</div>` : '') + body);
  };

  /* ---- Render the decision case file (slack summary + markdown narrative) ---- */
  R.renderCaseFile = function (payload, rec, conf, human, agreed) {
    if (!payload) return '';
    let html = ev('Decision', rec ? rec : null, null,
      kv([
        ['Agent recommendation', R.recBadge(rec)],
        ['Confidence', conf != null ? Number(conf).toFixed(2) : null],
        ['Human decision', human ? R.recBadge(human) : null],
        ['Agreed', agreed == null ? null : (agreed ? '<span class="badge green">yes</span>' : '<span class="badge red">no</span>')]
      ]));
    if (payload.slack_summary) html += `<div class="slack-summary">${esc(payload.slack_summary)}</div>`;
    if (payload.full_case_file) html += `<div class="casefile" style="margin-top:12px">${R.mdLite(payload.full_case_file)}</div>`;
    return html;
  };

  /* ---- Lazy-load the full evidence drawer for one run into a container ---- */
  const ENRICH = new Set(['sanctions.check', 'peps.check', 'sos.entity_search', 'sos.officer_search',
    'sec.search', 'domain.whois', 'domain.wayback', 'web.search', 'web.fetch']);

  R.loadCaseDetail = async function (runId, container) {
    container.innerHTML = '<div class="empty">Loading case evidence…</div>';
    try {
      const calls = await R.sql('agent',
        `SELECT tool_name, status::text status, tool_args, result, started_at
         FROM runs.tool_calls WHERE run_id = $1 ORDER BY started_at`, [runId]);
      const [meta] = await R.sql('agent',
        `SELECT r.final_output,
                d.recommendation, d.confidence_score, d.recommendation_payload rp,
                d.human_decision, d.agreed_with_agent
         FROM runs.agent_runs r
         LEFT JOIN LATERAL (SELECT * FROM decisions.records d WHERE d.run_id = r.run_id
                            ORDER BY created_at DESC LIMIT 1) d ON true
         WHERE r.run_id = $1`, [runId]);

      let html = '';
      if (meta && meta.rp) {
        html += `<div class="section-label">Decision &amp; case file</div>` +
          R.renderCaseFile(meta.rp, meta.recommendation, meta.confidence_score, meta.human_decision, meta.agreed_with_agent);
      }
      const stripe = calls.filter(c => c.tool_name.startsWith('stripe.'));
      const enrich = calls.filter(c => ENRICH.has(c.tool_name));
      if (stripe.length) html += `<div class="section-label">Stripe data retrieved</div>` + stripe.map(R.renderToolCall).join('');
      if (enrich.length) html += `<div class="section-label">Screening &amp; enrichment</div>` + enrich.map(R.renderToolCall).join('');
      if (meta && meta.final_output && Object.keys(meta.final_output).length)
        html += `<div class="section-label">Agent final output</div>` + ev('final_output', '', null, R.jsonBlock(meta.final_output));
      container.innerHTML = html || '<div class="empty">No Stripe or screening evidence stored for this run.</div>';
      container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      container.innerHTML = `<div class="banner show err" style="display:block">Failed to load case: ${esc(e.message)}</div>`;
    }
  };
})();
