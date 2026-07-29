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

export const STORE_LOCALE = optional('STORE_LOCALE', 'es-ES');
export const STORE_INDUSTRY = optional('STORE_INDUSTRY');
export const ROAS_BENCHMARK = optional('ROAS_BENCHMARK');
export const REPORT_TIME_LABEL = optional('REPORT_TIME_LABEL', '9:00 (Madrid)');
export const META_API_VERSION = optional('META_API_VERSION', 'v21.0');
export const SHOPIFY_API_VERSION = optional('SHOPIFY_API_VERSION', '2024-10');
export const CLAUDE_MODEL = optional('CLAUDE_MODEL', 'claude-sonnet-4-6');
export const REPORT_DATE = optional('REPORT_DATE');
export const SUBSCRIPTION_TAGS = parseSubscriptionTags(optional('SUBSCRIPTION_TAGS'));
