import Anthropic from '@anthropic-ai/sdk';
import { STORE_NAME, STORE_CURRENCY, STORE_INDUSTRY, ROAS_BENCHMARK, CLAUDE_MODEL, SUBSCRIPTION_TAGS } from './config.js';

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

export async function generateDiagnosis(metrics) {
  const client = new Anthropic();

  const subscriptionBlock = buildSubscriptionLines(metrics);
  const subscriptionSection = subscriptionBlock
    ? `\n${subscriptionBlock}`
    : '';

  const prompt = `Eres un analista de ecommerce DTC. Tienes los siguientes datos de ayer para ${STORE_NAME}:

METRICAS PAID (Meta Ads):
- Gasto: ${STORE_CURRENCY}${metrics.adSpend.toFixed(2)}
- Impresiones: ${metrics.impressions}
- Link Clicks: ${metrics.linkClicks}
- Add to Carts: ${metrics.addToCarts}
- Checkouts Iniciados: ${metrics.checkoutsInitiated}
- Compras (atribuidas Meta): ${metrics.metaOrders}
- ROAS Meta: ${metrics.metaROAS.toFixed(2)}x
- CTR: ${metrics.ctr.toFixed(2)}%
- Add to Cart Rate: ${metrics.addToCartRate.toFixed(2)}%
- Checkout Rate: ${metrics.checkoutRate.toFixed(2)}%
- Purchase Rate: ${metrics.purchaseRate.toFixed(2)}%

METRICAS SHOPIFY (fuente de verdad):
- Revenue neto: ${STORE_CURRENCY}${metrics.shopifyRevenue.toFixed(2)}
- Ordenes reales: ${metrics.shopifyOrders}
- AOV: ${STORE_CURRENCY}${metrics.shopifyAOV.toFixed(2)}${subscriptionSection}

Identifica en 3-4 lineas:
1. Cual es el punto mas debil del funnel hoy y por que
${buildRoasInstruction()}
3. Una accion concreta que se deberia tomar hoy

Responde en espanol, directo, sin introducciones.`;

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}
