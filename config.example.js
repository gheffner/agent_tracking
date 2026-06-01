// Copy this file to `config.js` and fill in your values for LOCAL development.
// `config.js` is gitignored so secrets never reach source control.
//
// In production (the Docker/nginx image) this file is REPLACED at build time
// with same-origin paths and empty headers — nginx attaches the credentials
// server-side, so the browser never sees the secret.
window.SQL_CONFIG = {
  agent: {
    url: 'https://YOUR-API-ID.execute-api.us-east-1.amazonaws.com/prod/db/agent_platform/sql',
    headers: {
      'X-Identity': 'your-username',
      'X-Internal-Secret': 'PLACEHOLDER_SECRET'
    }
  },
  webhooks: {
    url: 'https://YOUR-API-ID.execute-api.us-east-1.amazonaws.com/prod/db/webhooks/sql',
    headers: {
      'X-Identity': 'your-username',
      'X-Internal-Secret': 'PLACEHOLDER_SECRET'
    }
  }
};
