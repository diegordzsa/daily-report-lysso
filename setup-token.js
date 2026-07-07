import http from 'node:http';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = 'read_orders';

if (!CLIENT_ID || !CLIENT_SECRET || !SHOP) {
  console.error('\n❌ Missing environment variables. Run with:');
  console.error('   SHOPIFY_CLIENT_ID=xxx SHOPIFY_CLIENT_SECRET=xxx SHOPIFY_STORE_DOMAIN=xxx node setup-token.js\n');
  process.exit(1);
}

const nonce = crypto.randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (state !== nonce) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('State mismatch — possible CSRF. Try again.');
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('No authorization code received.');
      return;
    }

    try {
      const tokenRes = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
        }).toString(),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Token exchange failed: ${tokenRes.status} — ${body}`);
        console.error(`\n❌ Token exchange failed: ${tokenRes.status} — ${body}`);
        server.close();
        return;
      }

      const data = await tokenRes.json();
      const token = data.access_token;

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <h1>✅ Token obtained!</h1>
        <p>Your offline access token has been printed in the terminal.</p>
        <p>Add it as <code>SHOPIFY_ACCESS_TOKEN</code> in your GitHub Secrets.</p>
        <p>You can close this tab.</p>
      `);

      console.log('\n✅ SUCCESS! Here is your offline access token:\n');
      console.log(`   ${token}\n`);
      console.log('Add this as SHOPIFY_ACCESS_TOKEN in GitHub Secrets:');
      console.log(`   https://github.com/diegordzsa/daily-report-lysso/settings/secrets/actions\n`);
      console.log(`Scopes granted: ${data.scope || SCOPES}`);

      server.close();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error: ${err.message}`);
      console.error(`\n❌ Error: ${err.message}`);
      server.close();
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  const authorizeUrl = `https://${SHOP}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${nonce}`;

  console.log('\n🔐 Shopify OAuth Token Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\nOpening browser to authorize the app on ${SHOP}...`);
  console.log(`\nIf the browser doesn't open, visit this URL:\n`);
  console.log(`   ${authorizeUrl}\n`);

  try {
    const cmd = process.platform === 'win32' ? 'start' :
                process.platform === 'darwin' ? 'open' : 'xdg-open';
    execSync(`${cmd} "${authorizeUrl}"`);
  } catch {
    // Browser open failed — URL is printed above
  }
});
