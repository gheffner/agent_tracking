# RevOps Agent Platform — Observability Hub

Static dashboards for the RevOps agent platform. Reads live from the production
RDS via the internal SQL proxy (two databases: `agent_platform` and `webhooks`).
No build step — plain HTML + Chart.js + a small shared runtime.

## Pages

| File | Source | Purpose |
|---|---|---|
| `index.html` | `core.*` + pulse | Hub landing page, live platform pulse, kill switches & spend caps |
| `agent_runs.html` | `runs.agent_runs`, `runs.run_events` | Run volume, success/fail per agent, status mix, cost, operational events |
| `llm_usage.html` | `runs.llm_calls` | Spend by model over time, tokens, cache savings, latency, cost per agent |
| `tool_calls.html` | `runs.tool_calls` | Tool success rates, latency by tool, top tools, error mix |
| `webhooks.html` | `webhook_events` (webhooks DB) | Ingestion by source, throughput, processed/failed rates, recent failures |
| `decisions.html` | `decisions.records`, `runs.approvals` | Agent-vs-human agreement, recommendations, approval SLA |

Every dashboard has a global date-range control: **Day / Week / 2 Weeks / 30 Days**
presets plus a custom from→to range. Time-series granularity auto-selects
(hourly ≤2 days, daily ≤45 days, weekly beyond). All pages auto-refresh every 60s.

Shared code lives in `assets/`:
- `styles.css` — design system (dark observability theme)
- `common.js` — SQL client, formatters, charts, tables, nav, date-range control

## How the SQL proxy works

Dashboards never talk to AWS directly. They POST `{sql, params}` to same-origin
paths and nginx forwards to the AWS API Gateway, attaching the credentials:

- `/api/sql` → `…/prod/db/agent_platform/sql`
- `/api/webhooks/sql` → `…/prod/db/webhooks/sql`

nginx injects `X-Identity` and `X-Internal-Secret` from container env vars, so
the secret never reaches the browser.

## Deploy (deploybay)

The repo ships a `Dockerfile` building an nginx image on port 80. Set these env
vars in deploybay before deploying:

| Env var | Value |
|---|---|
| `SQL_API_BASE` | SQL proxy API Gateway base URL — the part before `/db/…`, e.g. `https://XXXXXXXX.execute-api.us-east-1.amazonaws.com/prod` |
| `SQL_IDENTITY` | your proxy identity |
| `SQL_SECRET` | the `X-Internal-Secret` for the SQL proxy |

deploybay substitutes them into the nginx config at container startup. No secrets
*or internal URLs* live in the repo or any built image layer. (Confirm injection
at `/debug-env.json` — it reports only the *length* of each var, never the value.)

## Local development

**Option A — run the container (matches prod):**
```sh
docker build -t revops-hub .
docker run --rm -p 8080:80 \
  -e SQL_API_BASE=https://XXXXXXXX.execute-api.us-east-1.amazonaws.com/prod \
  -e SQL_IDENTITY=your-identity \
  -e SQL_SECRET=your-secret-here \
  revops-hub
# open http://localhost:8080
```

**Option B — open the HTML directly:**
```sh
cp config.example.js config.js
# edit config.js, fill in the AWS URLs + identity + secret for both DBs
open index.html
```
In this mode the browser calls AWS directly with the secret embedded in
`config.js`. `config.js` is gitignored — keep it that way.

> Note: opening via `file://` may hit CORS on the API. If so, serve the folder
> over http: `python3 -m http.server 8080` then open `http://localhost:8080`.

## Adding a dashboard

1. Copy any page (e.g. `tool_calls.html`) as a starting point.
2. Add it to the `PAGES` array in `assets/common.js` so it appears in the nav.
3. Add its filename to the `COPY` line in the `Dockerfile`.
4. Write queries with `RevOps.sql('agent' | 'webhooks', sql, params)`.
