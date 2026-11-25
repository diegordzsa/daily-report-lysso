// Probe de frescura de Meta. Solo lee y loguea: NUNCA escribe en Slack.
//
// Dos usos:
//  1. Validar la autenticacion del cron externo sin publicar un reporte duplicado.
//  2. Medir la deriva de consolidacion a la hora a la que se dispare, para poder
//     decidir con datos si se adelanta la entrega. Cruzar el `spend` de aqui
//     contra el valor consolidado dias despues.
//
// Deliberadamente no importa src/config.js: asi solo necesita los dos secretos de
// Meta y no arrastra los de Shopify, Slack ni Anthropic.

const TOKEN = process.env.META_ACCESS_TOKEN;
// Una o varias cuentas separadas por coma, igual que en el reporte.
const ACCOUNTS = String(process.env.META_AD_ACCOUNT_ID || '')
  .split(',').map(id => id.trim().replace(/^act_/, '')).filter(Boolean);
const API = process.env.META_API_VERSION || 'v26.0';
const FALLBACK_TZ = process.env.META_ACCOUNT_TIMEZONE || 'Europe/Madrid';

if (!TOKEN || ACCOUNTS.length === 0) {
  console.error('Faltan META_ACCESS_TOKEN o META_AD_ACCOUNT_ID');
  process.exit(1);
}

function partsInZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return parts;
}

function zoneOffsetMs(date, timeZone) {
  const p = partsInZone(date, timeZone);
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function localMidnightToUtc(year, month, day, timeZone) {
  const naive = Date.UTC(year, month - 1, day);
  const offset = zoneOffsetMs(new Date(naive), timeZone);
  const instant = naive - offset;
  const corrected = zoneOffsetMs(new Date(instant), timeZone);
  return corrected === offset ? instant : naive - corrected;
}

function hoursSinceClose(dateStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const close = localMidnightToUtc(
    next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone,
  );
  return { hours: (Date.now() - close) / 3600000, close: new Date(close).toISOString() };
}

function yesterdayInZone(timeZone) {
  const p = partsInZone(new Date(), timeZone);
  const today = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  return new Date(today - 86400000).toISOString().slice(0, 10);
}

// Lista las cuentas que el token puede ver, con su id. Sirve para sacar el id de
// una cuenta nueva (EASY_04) y para confirmar que el System User ya la tiene
// asignada antes de meterla en META_AD_ACCOUNT_ID.
async function listVisibleAccounts() {
  const params = new URLSearchParams({
    access_token: TOKEN, fields: 'name,account_id,currency,timezone_name', limit: '100',
  });
  const res = await fetch(`https://graph.facebook.com/${API}/me/adaccounts?${params}`);
  const json = await res.json();
  if (!res.ok || json.error) {
    console.warn(`[Probe] No se pudieron listar las cuentas visibles: ${JSON.stringify(json.error ?? json)}`);
    return;
  }
  console.log(`[Probe] Cuentas que ve el token (${(json.data || []).length}):`);
  for (const a of json.data || []) {
    const enUso = ACCOUNTS.includes(a.account_id) ? '  <- en META_AD_ACCOUNT_ID' : '';
    console.log(`[Probe]   ${a.name} | id=${a.account_id} | ${a.currency} | ${a.timezone_name}${enUso}`);
  }
}

async function probeAccount(account) {
  const infoParams = new URLSearchParams({
    access_token: TOKEN, fields: 'name,timezone_name,currency',
  });
  const infoRes = await fetch(`https://graph.facebook.com/${API}/act_${account}?${infoParams}`);
  const info = await infoRes.json();
  if (!infoRes.ok || info.error) {
    console.error(`[Probe] act_${account}: error leyendo la cuenta: ${JSON.stringify(info.error ?? info)}`);
    return false;
  }
  const timeZone = info.timezone_name || FALLBACK_TZ;
  console.log(`[Probe] Cuenta: ${info.name} (act_${account}) | tz=${timeZone} | moneda=${info.currency}`);
  console.log(`[Probe] Ahora en la zona de la cuenta: ${new Date().toLocaleString('es-ES', { timeZone })}`);

  const date = process.env.PROBE_DATE || yesterdayInZone(timeZone);
  const { hours, close } = hoursSinceClose(date, timeZone);
  console.log(`[Probe] Fecha: ${date} | cierre: ${close} | hace ${hours.toFixed(2)} h`);

  const params = new URLSearchParams({
    access_token: TOKEN,
    time_range: JSON.stringify({ since: date, until: date }),
    level: 'account',
    fields: 'spend,impressions,clicks',
  });
  const res = await fetch(`https://graph.facebook.com/${API}/act_${account}/insights?${params}`);
  const json = await res.json();
  if (!res.ok || json.error) {
    console.error(`[Probe] act_${account}: error en insights: ${JSON.stringify(json.error ?? json)}`);
    return false;
  }

  const rows = json.data || [];
  if (rows.length === 0) {
    console.log(`[Probe] ${info.name}: sin filas para ${date}`);
    return true;
  }
  const spend = rows.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);
  // Esta es la linea que se cruza contra el consolidado dias despues.
  console.log(`[Probe] MUESTRA ${info.name} ${date} h=${hours.toFixed(2)} spend=${spend.toFixed(2)} ${info.currency}`);
  for (const r of rows) {
    console.log(`[Probe]   impresiones=${r.impressions} clicks=${r.clicks}`);
  }
  return true;
}

async function main() {
  console.log(`[Probe] Ahora UTC: ${new Date().toISOString()} | Graph API ${API}`);
  await listVisibleAccounts();

  let ok = true;
  for (const account of ACCOUNTS) {
    ok = (await probeAccount(account)) && ok;
  }
  if (!ok) process.exit(1);
}

main().catch(e => { console.error('[Probe] FALLO:', e.message); process.exit(1); });
