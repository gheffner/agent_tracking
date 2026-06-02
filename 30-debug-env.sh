#!/bin/sh
# Writes /usr/share/nginx/html/debug-env.json reporting whether the SQL_* env vars
# were injected — never the secret value. Lets you diagnose a misconfigured deploy
# (e.g. SQL_API_BASE not set → /api/sql 502s). Safe to leave in production.
set -e
ID_LEN=$(printf '%s' "${SQL_IDENTITY}" | wc -c | tr -d ' ')
SEC_LEN=$(printf '%s' "${SQL_SECRET}" | wc -c | tr -d ' ')
API_LEN=$(printf '%s' "${SQL_API_BASE}" | wc -c | tr -d ' ')
# is_default = true means SQL_API_BASE was NOT set in the deploy (still the
# harmless localhost fallback) → that's why /api/sql would 502.
if [ "${SQL_API_BASE}" = "https://127.0.0.1" ] || [ -z "${SQL_API_BASE}" ]; then
  API_DEFAULT=true
else
  API_DEFAULT=false
fi
cat > /usr/share/nginx/html/debug-env.json <<EOF
{"sql_identity_len": ${ID_LEN}, "sql_secret_len": ${SEC_LEN}, "sql_api_base_len": ${API_LEN}, "sql_api_base_is_default": ${API_DEFAULT}}
EOF
