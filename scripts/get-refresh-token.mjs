#!/usr/bin/env node
// One-time local helper: completes the JTL-FFN OAuth2 authorization-code flow
// and prints a refresh_token you paste into the GitHub repo secret JTL_REFRESH_TOKEN.
// Run locally: node scripts/get-refresh-token.mjs
// Nothing here is uploaded anywhere — it only talks to JTL's OAuth server and your browser.

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline/promises';
import { exec } from 'node:child_process';

const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const AUTH_BASE = 'https://oauth2.api.jtl-software.com';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const clientId = await rl.question('JTL OAuth Client ID: ');
const clientSecret = await rl.question('JTL OAuth Client Secret: ');
rl.close();

const state = randomBytes(12).toString('hex');
const authorizeUrl = new URL(`${AUTH_BASE}/authorize`);
authorizeUrl.searchParams.set('response_type', 'code');
authorizeUrl.searchParams.set('client_id', clientId);
authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authorizeUrl.searchParams.set('scope', 'ffn.merchant.read');
authorizeUrl.searchParams.set('state', state);

console.log('\nRedirect URI muss in der JTL OAuth-App-Konfiguration exakt so hinterlegt sein:');
console.log(`  ${REDIRECT_URI}\n`);
console.log('Öffne diese URL im Browser (wird gleich automatisch versucht):');
console.log(authorizeUrl.toString() + '\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code || returnedState !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Fehler: kein code oder state stimmt nicht überein.');
    server.close();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Login erfolgreich, du kannst dieses Fenster schließen und zum Terminal zurückkehren.');

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const body = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('\nToken-Austausch fehlgeschlagen:', body);
      process.exit(1);
    }
    console.log('\n✅ Erfolgreich! Trage diese Werte als GitHub Repository Secrets ein\n(Settings → Secrets and variables → Actions → New repository secret):\n');
    console.log('JTL_CLIENT_ID       =', clientId);
    console.log('JTL_CLIENT_SECRET   =', clientSecret);
    console.log('JTL_REFRESH_TOKEN   =', body.refresh_token);
    console.log('\n(access_token läuft nach kurzer Zeit ab, wird vom update-stock Skript automatisch aus dem refresh_token neu geholt — der wird nicht separat gebraucht)');
  } catch (err) {
    console.error('\nFehler beim Token-Austausch:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${opener} "${authorizeUrl.toString()}"`);
});
