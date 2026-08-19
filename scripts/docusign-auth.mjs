#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = loadDotEnv(resolve(process.cwd(), '.env'));
const defaultMcpScope = 'adm_store_unified_repo_read aow_manage manage_app_keys signature';

const config = {
  clientId: readEnv('DOCUSIGN_CLIENT_ID'),
  clientSecret: readEnv('DOCUSIGN_CLIENT_SECRET'),
  redirectUri: readEnv('DOCUSIGN_OAUTH_REDIRECT_URI', 'http://localhost:4111/auth/docusign/callback'),
  scope: normalizeMcpScope(readEnv('DOCUSIGN_MCP_SCOPE', defaultMcpScope)),
  environment: readEnv('DOCUSIGN_ENVIRONMENT', 'demo'),
  authBaseUrl: readEnv('DOCUSIGN_AUTH_BASE_URL'),
  mcpUrl: readEnv('DOCUSIGN_MCP_URL', 'https://mcp-d.docusign.com/mcp'),
};

if (!config.clientId || !config.clientSecret) {
  fail('Missing DOCUSIGN_CLIENT_ID or DOCUSIGN_CLIENT_SECRET in .env.');
}

const authHost =
  config.authBaseUrl ||
  (config.environment === 'production'
    ? 'https://account.docusign.com'
    : 'https://account-d.docusign.com');

const redirectUrl = new URL(config.redirectUri);
const callbackPath = redirectUrl.pathname;
const port = Number(redirectUrl.port || (redirectUrl.protocol === 'https:' ? 443 : 80));

if (!['localhost', '127.0.0.1'].includes(redirectUrl.hostname)) {
  fail(`DOCUSIGN_OAUTH_REDIRECT_URI must use localhost for this helper. Received: ${config.redirectUri}`);
}

const state = crypto.randomUUID();
const authUrl = new URL('/oauth/auth', authHost);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', config.scope);
authUrl.searchParams.set('client_id', config.clientId);
authUrl.searchParams.set('redirect_uri', config.redirectUri);
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('resource', config.mcpUrl);

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', config.redirectUri);

  if (requestUrl.pathname !== callbackPath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const returnedState = requestUrl.searchParams.get('state');
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(`Docusign authorization failed: ${errorDescription || error}`);
    server.close();
    fail(`Docusign authorization failed: ${errorDescription || error}`);
  }

  if (!code || returnedState !== state) {
    // Keep listening: a stale tab reload or a probe should not kill the flow.
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing authorization code or state mismatch. Re-open the authorization URL printed in the terminal.');
    console.error(
      `Ignored callback without a valid code/state (state received: ${returnedState ?? 'none'}, expected: ${state}). Still listening.`,
    );
    return;
  }

  try {
    const token = await exchangeCodeForToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Docusign authorization complete</h1><p>You can close this tab and return to the terminal.</p>');
    printTokenResult(token);
  } catch (exchangeError) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Failed to exchange authorization code. Check the terminal for details.');
    console.error(exchangeError);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.once('error', error => {
  if (error.code === 'EADDRINUSE') {
    fail(`Port ${port} is already in use. Stop that process or change DOCUSIGN_OAUTH_REDIRECT_URI in .env and in the Docusign app settings.`);
  }

  fail(`Unable to start local callback server: ${error.message}`);
});

server.listen(port, redirectUrl.hostname, () => {
  console.log(`Listening for Docusign OAuth callback at ${config.redirectUri}`);
  console.log('Opening Docusign authorization URL...');
  console.log(authUrl.toString());
  openBrowser(authUrl.toString());
});

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    resource: config.mcpUrl,
  });

  const response = await fetch(new URL('/oauth/token', authHost), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

function printTokenResult(token) {
  console.log('\nDocusign token received. Add/update these values in .env:\n');
  console.log(`DOCUSIGN_MCP_ACCESS_TOKEN=${token.access_token}`);

  if (token.refresh_token) {
    console.log(`DOCUSIGN_MCP_REFRESH_TOKEN=${token.refresh_token}`);
  }

  if (token.scope) {
    console.log(`DOCUSIGN_MCP_SCOPE=${token.scope}`);
  }

  if (token.expires_in) {
    const expiresAt = new Date(Date.now() + Number(token.expires_in) * 1000).toISOString();
    console.log(`\nAccess token expires at approximately ${expiresAt}.`);
  }
}

function openBrowser(url) {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

  const child = execFile(command, args, error => {
    if (error) {
      console.log(`Could not open browser automatically. Open this URL manually:\n${url}`);
    }
  });

  child.unref();
}

function loadDotEnv(path) {
  try {
    const content = readFileSync(path, 'utf8');
    const parsed = {};

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }

      const [key, ...valueParts] = trimmed.split('=');
      const rawValue = valueParts.join('=').trim();
      parsed[key.trim()] = rawValue.replace(/^["']|["']$/g, '');
    }

    return parsed;
  } catch {
    return {};
  }
}

function readEnv(name, fallback = '') {
  return process.env[name] || env[name] || fallback;
}

function normalizeMcpScope(scope) {
  if (!scope || scope.trim() === 'signature') {
    return defaultMcpScope;
  }

  return scope;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
