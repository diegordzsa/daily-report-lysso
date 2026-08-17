function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function optional(name, defaultValue = '') {
  return process.env[name] || defaultValue;
}

function numeric(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`${name} is not a number ("${raw}") — using default ${defaultValue}`);
    return defaultValue;
  }
  return n;
}

function parseSubscriptionTags(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(t => t.tag && t.label);
  } catch {
    console.error('SUBSCRIPTION_TAGS is not valid JSON — ignoring');
    return [];
  }
}

export const STORE_NAME = required('STORE_NAME');
export const META_ACCESS_TOKEN = required('META_ACCESS_TOKEN');
export const META_AD_ACCOUNT_ID = required('META_AD_ACCOUNT_ID');
export const SHOPIFY_STORE_DOMAIN = required('SHOPIFY_STORE_DOMAIN');
export const SHOPIFY_ACCESS_TOKEN = required('SHOPIFY_ACCESS_TOKEN');
export const ANTHROPIC_API_KEY = required('ANTHROPIC_API_KEY');
export const SLACK_WEBHOOK_URL = required('SLACK_WEBHOOK_URL');

// --- Monedas -----------------------------------------------------------------
// Shopify factura en una moneda y la cuenta de Meta puede gastar en otra. No son
// intercambiables: el gasto, el CPO y el revenue atribuido vienen en la moneda de
// la CUENTA DE ADS; el revenue neto y el AOV en la de la TIENDA. Mezclarlas no
// falla, solo da cifras falsas — de ahi que cada una tenga su propio simbolo y su
// codigo ISO para la conversion.
export const STORE_CURRENCY = optional('STORE_CURRENCY', '€');
export const STORE_CURRENCY_CODE = optional('STORE_CURRENCY_CODE', 'EUR');
export const AD_CURRENCY = optional('AD_CURRENCY', '$');
export const AD_CURRENCY_CODE = optional('AD_CURRENCY_CODE', 'USD');

// --- Zonas horarias y frescura ----------------------------------------------
// META_ACCOUNT_TIMEZONE es solo el fallback: report.js lee la timezone real de la
// cuenta en cada ejecucion. STORE_TIMEZONE decide que dia es "ayer".
export const META_ACCOUNT_TIMEZONE = optional('META_ACCOUNT_TIMEZONE', 'Europe/Madrid');
export const STORE_TIMEZONE = optional('STORE_TIMEZONE', 'Europe/Madrid');
export const MIN_HOURS_AFTER_CLOSE = numeric('MIN_HOURS_AFTER_CLOSE', 3);

// --- Avisos de fallo ---------------------------------------------------------
// El mismo fallo se reintenta hasta tres veces al dia (entrega + dos respaldos) y
// sin esto cada intento publicaba su propio aviso identico: el 15-ago el canal
// recibio tres. El workflow pone ALERT_ON_FAILURE=false en el respaldo
// intermedio, que reintenta en silencio; la entrega y el respaldo final si avisan.
// Default `true`: correr esto a mano o en local siempre avisa.
export const ALERT_ON_FAILURE = optional('ALERT_ON_FAILURE', 'true') !== 'false';
// Que intento del dia es este ('entrega', 'respaldo final'). Va en el aviso para
// que dos mensajes el mismo dia no parezcan un duplicado.
export const ATTEMPT_LABEL = optional('ATTEMPT_LABEL');

export const STORE_LOCALE = optional('STORE_LOCALE', 'es-ES');
export const STORE_INDUSTRY = optional('STORE_INDUSTRY');
export const ROAS_BENCHMARK = optional('ROAS_BENCHMARK');
export const REPORT_TIME_LABEL = optional('REPORT_TIME_LABEL', '9:00 (Madrid)');
// Verificadas contra las cuentas reales el 2026-08-17 con los probes (`api_version`):
// Meta v26.0 devolvio insights del 11-ago (spend 194.59 USD, 3081 impresiones) y
// Shopify 2026-07 sirvio `orders.json` con los mismos `fields` que usa el reporte.
// Venian en v21.0 (Meta la retira el 2027-01-21) y 2024-10 (fuera de soporte desde
// finales de 2025, funcionaba solo porque Shopify degrada a una version soportada).
// No subir ninguna de las dos sin repetir esos probes antes: ver SETUP.md.
export const META_API_VERSION = optional('META_API_VERSION', 'v26.0');
export const SHOPIFY_API_VERSION = optional('SHOPIFY_API_VERSION', '2026-07');
export const CLAUDE_MODEL = optional('CLAUDE_MODEL', 'claude-sonnet-4-6');
export const REPORT_DATE = optional('REPORT_DATE');
export const SUBSCRIPTION_TAGS = parseSubscriptionTags(optional('SUBSCRIPTION_TAGS'));
