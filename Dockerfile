FROM nginx:1.27-alpine

# Only substitute our SQL_* env vars at startup, leave nginx's $variables alone.
ENV NGINX_ENVSUBST_FILTER=^SQL_

# Harmless defaults so the container still starts if the deployer forgot to set
# the env vars — SQL calls will just fail clearly (502 / 401) instead of nginx
# crash-looping. Override ALL THREE at deploy time. SQL_API_BASE must be the
# SQL proxy API Gateway base URL (the part before /db/...), e.g.
#   https://XXXXXXXX.execute-api.us-east-1.amazonaws.com/prod
# It is intentionally NOT baked in here, so no internal URL lives in the repo.
ENV SQL_API_BASE="https://127.0.0.1"
ENV SQL_IDENTITY=""
ENV SQL_SECRET=""

# Static dashboards
COPY index.html \
     agents.html \
     agent_runs.html \
     llm_usage.html \
     tool_calls.html \
     webhooks.html \
     decisions.html \
     kyb.html \
     kyc.html \
     /usr/share/nginx/html/

# Shared assets (styles + runtime)
COPY assets/ /usr/share/nginx/html/assets/

# In-container config: dashboards call same-origin proxy paths. nginx attaches
# X-Identity / X-Internal-Secret server-side so the browser never sees the secret.
RUN printf "window.SQL_CONFIG = { agent: { url: '/api/sql', headers: {} }, webhooks: { url: '/api/webhooks/sql', headers: {} } };\n" \
    > /usr/share/nginx/html/config.js

# nginx config template — SQL_IDENTITY and SQL_SECRET are substituted from the
# container's runtime env vars by the official nginx image's entrypoint.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Diagnostic: writes /debug-env.json with env var lengths (no values) at startup.
COPY 30-debug-env.sh /docker-entrypoint.d/30-debug-env.sh
RUN chmod +x /docker-entrypoint.d/30-debug-env.sh

EXPOSE 80
