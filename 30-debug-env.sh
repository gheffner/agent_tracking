#!/bin/sh
# Writes /usr/share/nginx/html/debug-env.json reporting only the LENGTH of each
# SQL_* env var, never the value. Lets you confirm the deployer injected the
# secret without ever exposing it. Safe to leave in production.
set -e
ID_LEN=$(printf '%s' "${SQL_IDENTITY}" | wc -c | tr -d ' ')
SEC_LEN=$(printf '%s' "${SQL_SECRET}" | wc -c | tr -d ' ')
cat > /usr/share/nginx/html/debug-env.json <<EOF
{"sql_identity_len": ${ID_LEN}, "sql_secret_len": ${SEC_LEN}}
EOF
