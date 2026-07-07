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
export const SHOPIFY_ACCESS_TOKEN = optional('SHOPIFY_ACCESS_TOKEN');
export const SHOPIFY_CLIENT_ID = optional('SHOPIFY_CLIENT_ID');
export const SHOPIFY_CLIENT_SECRET = optional('SHOPIFY_CLIENT_SECRET');
export const ANTHROPIC_API_KEY = required('ANTHROPIC_API_KEY');
export const SLACK_WEBHOOK_URL = required('SLACK_WEBHOOK_URL');

export const STORE_CURRENCY = optional('STORE_CURRENCY', '€');
export const STORE_LOCALE = optional('STORE_LOCALE', 'es-ES');
export const STORE_INDUSTRY = optional('STORE_INDUSTRY');
export const ROAS_BENCHMARK = optional('ROAS_BENCHMARK');
export const REPORT_TIME_LABEL = optional('REPORT_TIME_LABEL', '5:00 AM');
export const META_API_VERSION = optional('META_API_VERSION', 'v21.0');
export const SHOPIFY_API_VERSION = optional('SHOPIFY_API_VERSION', '2024-10');
export const CLAUDE_MODEL = optional('CLAUDE_MODEL', 'claude-sonnet-4-6');
export const SUBSCRIPTION_TAGS = parseSubscriptionTags(optional('SUBSCRIPTION_TAGS'));
