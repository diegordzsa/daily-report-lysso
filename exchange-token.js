const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const CODE = process.argv[2];

if (!CLIENT_ID || !CLIENT_SECRET || !SHOP || !CODE) {
  console.error('\nUsage:');
  console.error('  SHOPIFY_CLIENT_ID=xxx SHOPIFY_CLIENT_SECRET=xxx SHOPIFY_STORE_DOMAIN=xxx node exchange-token.js AUTH_CODE\n');
  process.exit(1);
}

const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: CODE,
  }).toString(),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`\n❌ Token exchange failed: ${res.status} — ${body}`);
  process.exit(1);
}

const data = await res.json();
console.log('\n✅ SUCCESS! Offline access token:\n');
console.log(`   ${data.access_token}\n`);
console.log(`Scopes: ${data.scope}`);
console.log('\nAdd this as SHOPIFY_ACCESS_TOKEN in GitHub Secrets.');
