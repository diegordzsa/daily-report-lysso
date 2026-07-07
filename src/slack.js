import { STORE_NAME, STORE_CURRENCY, STORE_LOCALE, REPORT_TIME_LABEL, SUBSCRIPTION_TAGS } from './config.js';

export async function sendToSlack(webhookUrl, reportText) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: reportText },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook error: ${res.status} ${res.statusText}`);
  }
}

function buildSubscriptionLine(metrics) {
  if (SUBSCRIPTION_TAGS.length === 0 || !metrics.subscriptionCounts) return null;
  const parts = metrics.subscriptionCounts.map(s => `${s.label}: ${s.count}`);
  return `  ${parts.join(' | ')}`;
}

export function formatReport({ date, metrics, diagnosis }) {
  const d = new Date(date);
  const dateStr = d.toLocaleDateString(STORE_LOCALE, {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const subscriptionLine = buildSubscriptionLine(metrics);

  const lines = [
    `:bar_chart: *${STORE_NAME} — Reporte Diario*`,
    dateStr,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `:moneybag: *REVENUE*`,
    `  Net Sales (Shopify): ${STORE_CURRENCY}${fmt(metrics.shopifyRevenue)}`,
    `  Ordenes: ${metrics.shopifyOrders} | AOV: ${STORE_CURRENCY}${fmt(metrics.shopifyAOV)}`,
  ];

  if (subscriptionLine) {
    lines.push(subscriptionLine);
  }

  lines.push(
    ``,
    `:loudspeaker: *PAID ADS (Meta)*`,
    `  Gasto: ${STORE_CURRENCY}${fmt(metrics.adSpend)}`,
    `  ROAS: ${metrics.metaROAS.toFixed(2)}x | CPO: ${STORE_CURRENCY}${fmt(metrics.cpo)}`,
    `  Revenue atribuido: ${STORE_CURRENCY}${fmt(metrics.metaAttributedRevenue)}`,
    ``,
    `:mag: *FUNNEL*`,
    `  Impresiones: ${fmtInt(metrics.impressions)}`,
    `  Link Clicks: ${fmtInt(metrics.linkClicks)} (CTR: ${metrics.ctr.toFixed(1)}%)`,
    `  Add to Cart: ${metrics.addToCarts} (${metrics.addToCartRate.toFixed(1)}%)`,
    `  Checkout: ${metrics.checkoutsInitiated} (${metrics.checkoutRate.toFixed(1)}%)`,
    `  Compras: ${metrics.metaOrders} (${metrics.purchaseRate.toFixed(1)}%)`,
    ``,
    `:robot_face: *DIAGNOSTICO (Claude)*`,
    ...diagnosis.split('\n').map(line => `  ${line}`),
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `_Generado automaticamente a las ${REPORT_TIME_LABEL}_`,
  );

  return lines.join('\n');
}

function fmt(n) {
  return n.toLocaleString(STORE_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n) {
  return n.toLocaleString(STORE_LOCALE);
}
