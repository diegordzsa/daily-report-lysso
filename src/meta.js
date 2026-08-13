import { META_AD_ACCOUNT_ID, META_API_VERSION } from './config.js';
import { fetchWithRetry } from './http.js';

const ACTION_MAP = {
  'link_click': 'actions_link_click',
  'offsite_conversion.fb_pixel_add_to_cart': 'actions_offsite_conversion_fb_pixel_add_to_cart',
  'offsite_conversion.fb_pixel_initiate_checkout': 'actions_offsite_conversion_fb_pixel_initiate_checkout',
  'offsite_conversion.fb_pixel_purchase': 'actions_offsite_conversion_fb_pixel_purchase',
};

const ACTION_VALUE_MAP = {
  'offsite_conversion.fb_pixel_purchase': 'action_values_offsite_conversion_fb_pixel_purchase',
};

function extractActions(actionsArray, map) {
  const result = {};
  for (const key of Object.values(map)) {
    result[key] = 0;
  }
  if (!Array.isArray(actionsArray)) return result;

  for (const entry of actionsArray) {
    const mapped = map[entry.action_type];
    if (mapped) {
      result[mapped] = parseFloat(entry.value) || 0;
    }
  }
  return result;
}

// Timezone y moneda de la cuenta publicitaria. La timezone define cuando cierra
// el dia para Meta, que es lo que determina si el gasto ya esta consolidado; la
// moneda define en que unidad viene `spend` y `action_values`.
// Devuelve {} si no se pudo leer, para que el llamador use sus fallbacks.
export async function fetchAdAccountInfo(accessToken) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'timezone_name,currency',
  });
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${META_AD_ACCOUNT_ID}?${params}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[Meta] No se pudo leer timezone/moneda de la cuenta: ${res.status}`);
      return {};
    }
    const json = await res.json();
    return { timeZone: json.timezone_name || null, currency: json.currency || null };
  } catch (err) {
    console.warn(`[Meta] No se pudo leer timezone/moneda de la cuenta: ${err.message}`);
    return {};
  }
}

export async function fetchMetaAds(accessToken, date) {
  const fields = 'spend,impressions,clicks,actions,action_values,cpc,cpm,ctr,frequency';
  const params = new URLSearchParams({
    access_token: accessToken,
    // Fecha explicita, nunca date_preset=yesterday: el preset lo resuelve Meta en
    // la timezone de la cuenta y podria no ser el mismo dia que el resto del
    // reporte.
    time_range: JSON.stringify({ since: date, until: date }),
    level: 'account',
    fields,
  });

  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${META_AD_ACCOUNT_ID}/insights?${params}`;

  console.log(`[Meta] Fetching ad insights...`);
  const res = await fetchWithRetry(url, {}, { label: 'Meta' });

  const json = await res.json();

  if (json.error) {
    throw new Error(`Meta API error: ${json.error.message}`);
  }

  const data = json.data || [];
  console.log(`[Meta] Got ${data.length} rows`);

  // Esta linea es la que permite medir la deriva de consolidacion hacia adelante:
  // se cruza contra el valor consolidado dias despues. No la quites.
  if (data.length > 0) {
    const rawSpend = data.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);
    console.log(`[Meta] Raw spend for ${date}: ${rawSpend.toFixed(2)}`);
  }

  if (data.length === 0) return [];

  return data.map(row => ({
    date: row.date_start,
    spend: parseFloat(row.spend) || 0,
    impressions: parseInt(row.impressions) || 0,
    clicks: parseInt(row.clicks) || 0,
    cpc: parseFloat(row.cpc) || 0,
    cpm: parseFloat(row.cpm) || 0,
    ctr: parseFloat(row.ctr) || 0,
    frequency: parseFloat(row.frequency) || 0,
    ...extractActions(row.actions, ACTION_MAP),
    ...extractActions(row.action_values, ACTION_VALUE_MAP),
  }));
}
