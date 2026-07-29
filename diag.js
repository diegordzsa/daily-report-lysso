// TEMPORAL — diagnostico Fase 1. Solo lee y loguea. No escribe en Slack.
// Borrar al terminar (Fase 6).

const META_TOKEN = process.env.META_ACCESS_TOKEN;
const META_ACCT = process.env.META_AD_ACCOUNT_ID;
const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOP_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const META_VER = 'v21.0';
const SHOP_VER = '2024-10';

function line() { console.log('='.repeat(70)); }

async function metaAccount() {
  line();
  console.log('1.1  META — cuenta, timezone y moneda');
  line();
  const p = new URLSearchParams({
    access_token: META_TOKEN,
    fields: 'name,timezone_name,timezone_offset_hours_utc,currency,account_status,business_country_code',
  });
  const res = await fetch(`https://graph.facebook.com/${META_VER}/act_${META_ACCT}?${p}`);
  const json = await res.json();
  if (!res.ok || json.error) {
    console.log(`ERROR ${res.status}: ${JSON.stringify(json.error ?? json)}`);
    return null;
  }
  for (const [k, v] of Object.entries(json)) console.log(`  ${k}: ${v}`);
  return json;
}

async function shopifyShop() {
  line();
  console.log('1.2  SHOPIFY — timezone y moneda');
  line();
  const res = await fetch(
    `https://${SHOP_DOMAIN}/admin/api/${SHOP_VER}/shop.json`,
    { headers: { 'X-Shopify-Access-Token': SHOP_TOKEN } },
  );
  if (!res.ok) {
    console.log(`ERROR ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const { shop } = await res.json();
  for (const k of [
    'name', 'domain', 'myshopify_domain', 'iana_timezone', 'timezone',
    'currency', 'money_format', 'money_with_currency_format',
    'primary_locale', 'country_code', 'weight_unit',
  ]) {
    console.log(`  ${k}: ${shop[k]}`);
  }
  return shop;
}

// Gasto ya consolidado de los ultimos dias, dia a dia.
async function metaConsolidated(days = 8) {
  line();
  console.log(`1.4  META — gasto CONSOLIDADO ultimos ${days} dias (time_increment=1)`);
  line();
  const until = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const p = new URLSearchParams({
    access_token: META_TOKEN,
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    level: 'account',
    fields: 'spend,impressions,clicks',
  });
  const res = await fetch(`https://graph.facebook.com/${META_VER}/act_${META_ACCT}/insights?${p}`);
  const json = await res.json();
  if (!res.ok || json.error) {
    console.log(`ERROR ${res.status}: ${JSON.stringify(json.error ?? json)}`);
    return;
  }
  console.log(`  rango: ${since} -> ${until}`);
  for (const r of json.data || []) {
    console.log(`  CONSOLIDADO ${r.date_start}  spend=${r.spend}  impr=${r.impressions}  clicks=${r.clicks}`);
  }
}

// Cuantas ordenes caen fuera de la ventana UTC que usa shopify.js hoy.
// Detecta el bug de recorte si la tienda no esta en UTC.
async function shopifyWindowCheck(shop) {
  line();
  console.log('EXTRA — ordenes de ayer dentro/fuera de la ventana UTC actual');
  line();
  if (!shop) return;
  const tz = shop.iana_timezone;
  const now = new Date();
  const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const d = new Date(`${localToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const yLocal = d.toISOString().slice(0, 10);
  const yUtc = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  console.log(`  ayer segun TZ tienda (${tz}): ${yLocal}`);
  console.log(`  ayer segun UTC (lo que usa getYesterday hoy): ${yUtc}`);

  // Ventana amplia: 3 dias, sin recorte, para ver la verdad.
  const p = new URLSearchParams({
    status: 'any',
    created_at_min: `${yLocal}T00:00:00${shop.timezone.match(/[+-]\d{2}:\d{2}/)?.[0] ?? 'Z'}`,
    created_at_max: `${yLocal}T23:59:59${shop.timezone.match(/[+-]\d{2}:\d{2}/)?.[0] ?? 'Z'}`,
    limit: '250',
    fields: 'id,created_at,subtotal_price,currency,total_price_set',
  });
  const res = await fetch(
    `https://${SHOP_DOMAIN}/admin/api/${SHOP_VER}/orders.json?${p}`,
    { headers: { 'X-Shopify-Access-Token': SHOP_TOKEN } },
  );
  if (!res.ok) {
    console.log(`  ERROR ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  const { orders } = await res.json();
  console.log(`  ordenes en el dia local completo ${yLocal}: ${orders.length}`);

  const cutoff = new Date(`${yLocal}T23:59:59Z`).getTime();
  let dropped = 0, kept = 0, revKept = 0, revDropped = 0;
  for (const o of orders) {
    const t = new Date(o.created_at).getTime();
    const v = parseFloat(o.subtotal_price) || 0;
    if (t > cutoff) { dropped++; revDropped += v; } else { kept++; revKept += v; }
  }
  console.log(`  dentro de created_at_max=${yLocal}T23:59:59Z : ${kept} ordenes, ${revKept.toFixed(2)}`);
  console.log(`  FUERA (se estan perdiendo)                  : ${dropped} ordenes, ${revDropped.toFixed(2)}`);
  if (orders[0]) {
    console.log(`  ejemplo created_at: ${orders[0].created_at}`);
    console.log(`  ejemplo currency: ${orders[0].currency}`);
    console.log(`  ejemplo total_price_set: ${JSON.stringify(orders[0].total_price_set)}`);
  }
}

async function main() {
  console.log(`AHORA (UTC): ${new Date().toISOString()}`);
  console.log(`AHORA (Madrid): ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`);
  const acct = await metaAccount();
  const shop = await shopifyShop();
  await metaConsolidated(8);
  await shopifyWindowCheck(shop);

  line();
  console.log('RESUMEN');
  line();
  console.log(`  Meta   tz=${acct?.timezone_name}  moneda=${acct?.currency}`);
  console.log(`  Shopify tz=${shop?.iana_timezone}  moneda=${shop?.currency}`);
  console.log(`  Monedas coinciden: ${acct?.currency === shop?.currency}`);
}

main().catch(e => { console.error('FALLO:', e); process.exit(1); });
