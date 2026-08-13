import { fetchShopifyOrders, getYesterday } from './shopify.js';
import { fetchMetaAds, fetchAdAccountInfo } from './meta.js';
import { hoursSinceDayClose } from './freshness.js';
import { explainHttpError } from './http.js';
import { generateDiagnosis } from './claude.js';
import { sendToSlack, formatReport } from './slack.js';
import {
  STORE_NAME, META_ACCESS_TOKEN,
  SLACK_WEBHOOK_URL, SUBSCRIPTION_TAGS,
  META_ACCOUNT_TIMEZONE, STORE_TIMEZONE, MIN_HOURS_AFTER_CLOSE,
  AD_CURRENCY_CODE, STORE_CURRENCY_CODE,
} from './config.js';

// Meta sigue agregando gasto durante horas despues de que cierra el dia en la
// timezone de la cuenta. Publicar antes de tiempo subestima el spend, lo que
// infla ROAS y MER. Preferimos no publicar a publicar cifras incorrectas.
async function assertMetaDataIsSettled(reportDate) {
  const { timeZone: liveTimeZone, currency } = await fetchAdAccountInfo(META_ACCESS_TOKEN);
  const timeZone = liveTimeZone || META_ACCOUNT_TIMEZONE;

  if (!liveTimeZone) {
    console.warn(`[Freshness] Usando fallback META_ACCOUNT_TIMEZONE=${timeZone}`);
  }
  if (timeZone !== STORE_TIMEZONE) {
    console.warn(
      `[Freshness] La cuenta de Meta (${timeZone}) y la tienda (${STORE_TIMEZONE}) estan en ` +
      `zonas distintas: "ayer" puede no ser el mismo dia en las dos fuentes.`
    );
  }
  // La moneda de la cuenta decide en que unidad viene el gasto. Si cambia y no se
  // actualiza AD_CURRENCY_CODE, la conversion a moneda de tienda queda muda pero
  // equivocada — asi que se avisa fuerte.
  if (currency && currency !== AD_CURRENCY_CODE) {
    console.error(
      `[Moneda] La cuenta de Meta factura en ${currency} pero AD_CURRENCY_CODE=${AD_CURRENCY_CODE}. ` +
      `Corrige el workflow: el gasto convertido y el MER-ROAS estan mal.`
    );
  }

  const hours = hoursSinceDayClose(reportDate, timeZone);

  console.log(
    `[Freshness] ${reportDate} cerro hace ${hours.toFixed(2)} h en ${timeZone} ` +
    `(minimo requerido: ${MIN_HOURS_AFTER_CLOSE} h)`
  );

  if (hours >= MIN_HOURS_AFTER_CLOSE) return { timeZone, hours };

  const reason = hours < 0
    ? `el dia todavia no termina en ${timeZone} (faltan ${(-hours).toFixed(1)} h)`
    : `solo han pasado ${hours.toFixed(1)} h desde el cierre, el minimo es ${MIN_HOURS_AFTER_CLOSE} h`;

  console.error(`Datos de Meta sin consolidar: ${reason}`);
  await sendToSlack(SLACK_WEBHOOK_URL,
    `:hourglass_flowing_sand: *${STORE_NAME} — Reporte Diario NO publicado*\n${reportDate}\n\n` +
    `Meta aun no consolida el gasto: ${reason}.\n` +
    `No se publica el reporte para no dar cifras incorrectas ` +
    `(un gasto subestimado infla ROAS y MER).`
  );
  process.exit(1);
}

// Tipo de cambio de la moneda de la cuenta de ads a la moneda de la tienda.
// Devuelve null si no se pudo obtener: es preferible marcar el MER-ROAS como no
// disponible que publicar una division entre dos monedas distintas.
async function fetchAdToStoreRate() {
  if (AD_CURRENCY_CODE === STORE_CURRENCY_CODE) return 1;
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${AD_CURRENCY_CODE}&to=${STORE_CURRENCY_CODE}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rate = json.rates?.[STORE_CURRENCY_CODE];
    if (!rate) throw new Error('respuesta sin tipo de cambio');
    console.log(`[FX] ${AD_CURRENCY_CODE}→${STORE_CURRENCY_CODE} rate=${rate}`);
    return rate;
  } catch (err) {
    console.warn(`[FX] No se pudo obtener el tipo de cambio: ${err.message}`);
    return null;
  }
}

async function run() {
  const yesterday = getYesterday();
  const { hours: hoursSettled } = await assertMetaDataIsSettled(yesterday);

  let metaData, shopifyData;
  try {
    [metaData, shopifyData] = await Promise.all([
      fetchMetaAds(META_ACCESS_TOKEN, yesterday),
      fetchShopifyOrders(),
    ]);
  } catch (err) {
    console.error('API fetch failed:', err.message);
    // Ya se reintento con backoff dentro de fetchWithRetry: si llegamos aqui, el
    // fallo persiste y hace falta que alguien actue. El mensaje dice que mirar.
    const explanation = explainHttpError(err);
    const attempts = err.attempts > 1 ? ` (tras ${err.attempts} intentos)` : '';
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *${STORE_NAME} — Reporte Diario FALLIDO*\n${yesterday}\n\n` +
      `No se pudieron obtener datos${attempts}.\n` +
      `Error: ${err.message}` +
      (explanation ? `\n\n:wrench: *Que hacer:* ${explanation}` : '')
    );
    process.exit(1);
  }

  console.log(`[Debug] Yesterday: ${yesterday}`);
  console.log(`[Debug] Meta rows: ${metaData.length}, Shopify rows: ${shopifyData.length}`);

  if (metaData.length === 0 && shopifyData.length === 0) {
    console.warn('Both APIs returned 0 rows — sending warning to Slack');
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *${STORE_NAME} — Reporte Diario*\n${yesterday}\n\nNo se obtuvieron datos de Meta ni de Shopify. Verifica que los tokens de acceso siguen activos.`
    );
    process.exit(1);
  }

  const adToStoreRate = await fetchAdToStoreRate();
  const metrics = calculateMetrics(metaData, shopifyData, adToStoreRate);

  const subDebug = metrics.subscriptionCounts.map(s => `${s.label}: ${s.count}`).join(', ');
  console.log(`[Debug] Orders: ${metrics.shopifyOrders}, Net Sales: ${metrics.shopifyRevenue.toFixed(2)}${subDebug ? `, ${subDebug}` : ''}`);
  console.log(`[Debug] adSpend=${metrics.adSpend.toFixed(2)} ${AD_CURRENCY_CODE}, ` +
    `adSpendStore=${metrics.adSpendStore?.toFixed(2) ?? 'n/d'} ${STORE_CURRENCY_CODE}, ` +
    `merROAS=${metrics.merROAS?.toFixed(2) ?? 'n/d'}`);

  let diagnosis;
  try {
    diagnosis = await generateDiagnosis(metrics);
  } catch (err) {
    console.error('Claude diagnosis failed:', err.message, err.status ?? '', err.error ?? '');
    diagnosis = 'Diagnostico no disponible — error al generar analisis.';
  }

  const reportText = formatReport({
    date: yesterday,
    metrics,
    diagnosis,
    hoursSettled,
  });

  try {
    await sendToSlack(SLACK_WEBHOOK_URL, reportText);
    console.log('Report sent to Slack successfully.');
  } catch (err) {
    console.error('Failed to send to Slack:', err.message);
    process.exit(1);
  }
}

function sum(rows, field) {
  return rows.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
}

function hasTag(row, tag) {
  const tags = row.order_tags || '';
  return tags.includes(tag);
}

function calculateMetrics(metaRows, shopifyRows, adToStoreRate) {
  // Todo lo que sale de Meta viene en la moneda de la cuenta de ads.
  const adSpend = sum(metaRows, 'spend');
  const impressions = sum(metaRows, 'impressions');
  const clicks = sum(metaRows, 'clicks');
  const linkClicks = sum(metaRows, 'actions_link_click');
  const addToCarts = sum(metaRows, 'actions_offsite_conversion_fb_pixel_add_to_cart');
  const checkoutsInitiated = sum(metaRows, 'actions_offsite_conversion_fb_pixel_initiate_checkout');
  const metaOrders = sum(metaRows, 'actions_offsite_conversion_fb_pixel_purchase');
  const metaAttributedRevenue = sum(metaRows, 'action_values_offsite_conversion_fb_pixel_purchase');

  // Gasto y revenue atribuido estan los dos en moneda de ads: el ratio es valido
  // sin convertir nada.
  const metaROAS = adSpend > 0 ? metaAttributedRevenue / adSpend : 0;
  const cpo = metaOrders > 0 ? adSpend / metaOrders : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const addToCartRate = linkClicks > 0 ? (addToCarts / linkClicks) * 100 : 0;
  const checkoutRate = addToCarts > 0 ? (checkoutsInitiated / addToCarts) * 100 : 0;
  const purchaseRate = checkoutsInitiated > 0 ? (metaOrders / checkoutsInitiated) * 100 : 0;

  // Lo que sale de Shopify viene en la moneda de la tienda.
  const shopifyRevenue = sum(shopifyRows, 'order_net_sales');
  const shopifyOrders = sum(shopifyRows, 'order_count');
  const shopifyAOV = shopifyOrders > 0 ? shopifyRevenue / shopifyOrders : 0;

  // El MER-ROAS cruza las dos fuentes, asi que exige misma moneda. Sin tipo de
  // cambio se queda en null y el reporte lo marca como no disponible: un MER
  // calculado con monedas distintas es un numero falso con pinta de correcto.
  const adSpendStore = adToStoreRate == null ? null : adSpend * adToStoreRate;
  const merROAS = adSpendStore == null
    ? null
    : (adSpendStore > 0 ? shopifyRevenue / adSpendStore : 0);

  const orderRows = shopifyRows.filter(r => Number(r.order_count) > 0);
  const subscriptionCounts = SUBSCRIPTION_TAGS.map(({ tag, label }) => ({
    label,
    count: orderRows.filter(r => hasTag(r, tag)).length,
  }));

  return {
    adSpend, adSpendStore, adToStoreRate,
    impressions, clicks, linkClicks, addToCarts,
    checkoutsInitiated, metaOrders, metaAttributedRevenue,
    metaROAS, merROAS, cpo, ctr, addToCartRate, checkoutRate, purchaseRate,
    shopifyRevenue, shopifyOrders, shopifyAOV,
    subscriptionCounts,
  };
}

run();
