import { META_AD_ACCOUNT_IDS, META_API_VERSION } from './config.js';
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

// Nombre, timezone y moneda de una cuenta publicitaria. La timezone define cuando
// cierra el dia para Meta, que es lo que determina si el gasto ya esta
// consolidado; la moneda define en que unidad viene `spend` y `action_values`.
// Si no se pudo leer, devuelve solo el id para que el llamador use sus fallbacks.
export async function fetchAdAccountInfo(accessToken, accountId) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'name,timezone_name,currency',
  });
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}?${params}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[Meta] No se pudo leer la cuenta act_${accountId}: ${res.status}`);
      return { accountId };
    }
    const json = await res.json();
    return {
      accountId,
      name: json.name || null,
      timeZone: json.timezone_name || null,
      currency: json.currency || null,
    };
  } catch (err) {
    console.warn(`[Meta] No se pudo leer la cuenta act_${accountId}: ${err.message}`);
    return { accountId };
  }
}

export function fetchAllAdAccountInfo(accessToken) {
  return Promise.all(META_AD_ACCOUNT_IDS.map(id => fetchAdAccountInfo(accessToken, id)));
}

// Insights de TODAS las cuentas configuradas, una fila por cuenta y dia. Si una
// cuenta falla (p. ej. el System User no tiene asignada EASY_04), falla todo: un
// reporte con la mitad del gasto infla ROAS y MER sin que se note.
export async function fetchMetaAds(accessToken, date) {
  const perAccount = await Promise.all(
    META_AD_ACCOUNT_IDS.map(id => fetchAccountInsights(accessToken, id, date)),
  );
  return perAccount.flat();
}

async function fetchAccountInsights(accessToken, accountId, date) {
  const fields = 'account_id,account_name,spend,impressions,clicks,actions,action_values,cpc,cpm,ctr,frequency';
  const params = new URLSearchParams({
    access_token: accessToken,
    // Fecha explicita, nunca date_preset=yesterday: el preset lo resuelve Meta en
    // la timezone de la cuenta y podria no ser el mismo dia que el resto del
    // reporte.
    time_range: JSON.stringify({ since: date, until: date }),
    level: 'account',
    fields,
  });

  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/insights?${params}`;

  console.log(`[Meta] Fetching ad insights (act_${accountId})...`);
  const res = await fetchWithRetry(url, {}, { label: 'Meta' });

  const json = await res.json();

  if (json.error) {
    throw new Error(`Meta API error (act_${accountId}): ${json.error.message}`);
  }

  const data = json.data || [];
  console.log(`[Meta] act_${accountId}: ${data.length} rows`);

  // Esta linea es la que permite medir la deriva de consolidacion hacia adelante:
  // se cruza contra el valor consolidado dias despues. No la quites.
  if (data.length > 0) {
    const rawSpend = data.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);
    console.log(`[Meta] Raw spend for ${date} (act_${accountId}): ${rawSpend.toFixed(2)}`);
  }

  return data.map(row => ({
    date: row.date_start,
    account_id: row.account_id || accountId,
    account_name: row.account_name || `act_${accountId}`,
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
