FROM nginx:1.27-alpine

# Only substitute our SQL_* env vars at startup, leave nginx's $variables alone.
ENV NGINX_ENVSUBST_FILTER=^SQL_

# Empty defaults so the container still starts if the deployer forgot to set the
# env vars — /api/sql will just fail at AWS with a clear 401/403 instead of
# nginx crash-looping on an unknown variable. Override these at deploy time.
ENV SQL_IDENTITY=""
ENV SQL_SECRET=""

# Static dashboards
COPY index.html \
     agent_runs.html \
     llm_usage.html \
     tool_calls.html \
     webhooks.html \
     decisions.html \
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
