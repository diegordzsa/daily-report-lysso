import Anthropic from '@anthropic-ai/sdk';
import {
  STORE_NAME, STORE_CURRENCY, STORE_CURRENCY_CODE, AD_CURRENCY, AD_CURRENCY_CODE,
  STORE_INDUSTRY, ROAS_BENCHMARK, CLAUDE_MODEL, SUBSCRIPTION_TAGS,
} from './config.js';

function buildSubscriptionLines(metrics) {
  if (SUBSCRIPTION_TAGS.length === 0 || !metrics.subscriptionCounts) return '';
  return metrics.subscriptionCounts
    .map(s => `- ${s.label}: ${s.count}`)
    .join('\n');
}

function buildRoasInstruction() {
  if (STORE_INDUSTRY && ROAS_BENCHMARK) {
    return `2. Si el ROAS es bueno, malo o normal para un DTC de ${STORE_INDUSTRY} (benchmark: ${ROAS_BENCHMARK})`;
  }
  return '2. Si el ROAS es bueno, malo o normal para ecommerce DTC';
}

export async function generateDiagnosis(metrics, { sinActividad = false } = {}) {
  const client = new Anthropic();

  const subscriptionBlock = buildSubscriptionLines(metrics);
  const subscriptionSection = subscriptionBlock
    ? `\n${subscriptionBlock}`
    : '';

  // Las dos monedas van explicitas en el prompt: la cuenta de ads y la tienda no
  // facturan necesariamente en la misma, y sin decirlo el modelo compara gasto
  // contra revenue como si fueran la misma unidad.
  const merLine = metrics.merROAS != null
    ? `- MER-ROAS (Shopify revenue / ad spend, ambos en ${STORE_CURRENCY_CODE}): ${metrics.merROAS.toFixed(2)}x`
    : `- MER-ROAS: no disponible (no se pudo convertir ${AD_CURRENCY_CODE} a ${STORE_CURRENCY_CODE})`;
  const spendConverted = metrics.adSpendStore != null
    ? ` (= ${STORE_CURRENCY}${metrics.adSpendStore.toFixed(2)} ${STORE_CURRENCY_CODE})`
    : '';

  // Sin un dia sin actividad declarado, el modelo lee los ceros como un embudo con
  // fugas y receta optimizaciones de creatividades que no existen.
  const contextoSinActividad = sinActividad
    ? `\nCONTEXTO: este dia no tuvo NINGUNA actividad — cero entrega de ads y cero
pedidos. Las dos APIs respondieron correctamente, asi que los ceros son reales y no
un fallo de lectura. No analices el embudo (no hay embudo): di en 2-3 lineas que el
dia estuvo parado y que hay que comprobar si la tienda o las campanas estan en pausa.\n`
    : '';

  const prompt = `Eres un analista de ecommerce DTC. Tienes los siguientes datos de ayer para ${STORE_NAME}:
${contextoSinActividad}
IMPORTANTE — monedas distintas: la cuenta de Meta factura en ${AD_CURRENCY_CODE} y la
tienda de Shopify en ${STORE_CURRENCY_CODE}. No compares cifras de las dos fuentes sin
convertir; los ratios ya vienen calculados en la moneda correcta.

METRICAS PAID (Meta Ads, en ${AD_CURRENCY_CODE}):
- Gasto: ${AD_CURRENCY}${metrics.adSpend.toFixed(2)} ${AD_CURRENCY_CODE}${spendConverted}
- Impresiones: ${metrics.impressions}
- Link Clicks: ${metrics.linkClicks}
- Add to Carts: ${metrics.addToCarts}
- Checkouts Iniciados: ${metrics.checkoutsInitiated}
- Compras (atribuidas Meta): ${metrics.metaOrders}
- CPO: ${AD_CURRENCY}${metrics.cpo.toFixed(2)} ${AD_CURRENCY_CODE}
- Revenue atribuido por Meta: ${AD_CURRENCY}${metrics.metaAttributedRevenue.toFixed(2)} ${AD_CURRENCY_CODE}
- ROAS Meta (pixel, ambos en ${AD_CURRENCY_CODE}): ${metrics.metaROAS.toFixed(2)}x
${merLine}
- CTR: ${metrics.ctr.toFixed(2)}%
- Add to Cart Rate: ${metrics.addToCartRate.toFixed(2)}%
- Checkout Rate: ${metrics.checkoutRate.toFixed(2)}%
- Purchase Rate: ${metrics.purchaseRate.toFixed(2)}%

METRICAS SHOPIFY (fuente de verdad, en ${STORE_CURRENCY_CODE}):
- Revenue neto: ${STORE_CURRENCY}${metrics.shopifyRevenue.toFixed(2)} ${STORE_CURRENCY_CODE}
- Ordenes reales: ${metrics.shopifyOrders}
- AOV: ${STORE_CURRENCY}${metrics.shopifyAOV.toFixed(2)} ${STORE_CURRENCY_CODE}${subscriptionSection}

Identifica en 3-4 lineas:
1. Cual es el punto mas debil del funnel hoy y por que
${buildRoasInstruction()}
3. Si hay discrepancia significativa entre el ROAS Meta y el MER-ROAS, que implica
4. Una accion concreta que se deberia tomar hoy

Responde en espanol, directo, sin introducciones.`;

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    // 300 cortaba la respuesta a media frase: el prompt pide cuatro puntos.
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}
