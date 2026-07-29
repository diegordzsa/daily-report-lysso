import {
  STORE_NAME, STORE_CURRENCY, STORE_CURRENCY_CODE, AD_CURRENCY, AD_CURRENCY_CODE,
  STORE_LOCALE, REPORT_TIME_LABEL, SUBSCRIPTION_TAGS,
} from './config.js';

// Con DRY_RUN=1 el reporte se imprime en el log en vez de publicarse. Sirve para
// probar el pipeline completo contra las APIs reales sin mandar un duplicado al
// canal.
export async function sendToSlack(webhookUrl, reportText) {
  if (process.env.DRY_RUN === '1') {
    console.log('[DRY_RUN] No se publica en Slack. Mensaje que se habria enviado:');
    console.log('----------8<----------');
    console.log(reportText);
    console.log('---------->8----------');
    return;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: splitIntoBlocks(reportText).map(text => ({
        type: 'section',
        text: { type: 'mrkdwn', text },
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook error: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
}

// Un bloque `section` de Slack admite 3000 caracteres; pasarse devuelve 400 y el
// reporte entero se pierde. Partimos por lineas, nunca a mitad de una, para que
// un diagnostico largo se reparta en varios bloques en vez de fallar.
const SLACK_SECTION_LIMIT = 2900;

function splitIntoBlocks(text) {
  const blocks = [];
  let current = '';
  for (const line of text.split('\n')) {
    // Una sola linea mas larga que el limite es el unico caso en que hay que
    // cortar por dentro.
    if (line.length > SLACK_SECTION_LIMIT) {
      if (current) { blocks.push(current); current = ''; }
      for (let i = 0; i < line.length; i += SLACK_SECTION_LIMIT) {
        blocks.push(line.slice(i, i + SLACK_SECTION_LIMIT));
      }
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > SLACK_SECTION_LIMIT) {
      blocks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function buildSubscriptionLine(metrics) {
  if (SUBSCRIPTION_TAGS.length === 0 || !metrics.subscriptionCounts) return null;
  const parts = metrics.subscriptionCounts.map(s => `${s.label}: ${s.count}`);
  return `  ${parts.join(' | ')}`;
}

export function formatReport({ date, metrics, diagnosis, hoursSettled }) {
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

  // El gasto, el CPO y el revenue atribuido vienen en moneda de la cuenta de ads;
  // solo el gasto se muestra tambien convertido, porque es el que se cruza con el
  // revenue de Shopify para el MER.
  const spendConverted = metrics.adSpendStore != null
    ? ` (${STORE_CURRENCY}${fmt(metrics.adSpendStore)})`
    : '';
  const merLabel = metrics.merROAS != null
    ? `${metrics.merROAS.toFixed(2)}x`
    : `n/d (sin tipo de cambio ${AD_CURRENCY_CODE}→${STORE_CURRENCY_CODE})`;

  lines.push(
    ``,
    `:loudspeaker: *PAID ADS (Meta)*`,
    `  Gasto: ${AD_CURRENCY}${fmt(metrics.adSpend)}${spendConverted}`,
    `  ROAS (Meta): ${metrics.metaROAS.toFixed(2)}x | MER-ROAS: ${merLabel}`,
    `  CPO: ${AD_CURRENCY}${fmt(metrics.cpo)} | Revenue atribuido: ${AD_CURRENCY}${fmt(metrics.metaAttributedRevenue)}`,
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
    `_Enviado a las ${REPORT_TIME_LABEL}` +
      (hoursSettled != null ? ` · gasto de Meta consolidado ${hoursSettled.toFixed(1)} h tras el cierre del dia` : '') +
      `_`,
    `_Moneda: tienda ${STORE_CURRENCY_CODE} · cuenta de ads ${AD_CURRENCY_CODE}` +
      (metrics.adToStoreRate != null && metrics.adToStoreRate !== 1
        ? ` (1 ${AD_CURRENCY_CODE} = ${metrics.adToStoreRate.toFixed(4)} ${STORE_CURRENCY_CODE})`
        : '') +
      `_`,
  );

  return lines.join('\n');
}

function fmt(n) {
  return n.toLocaleString(STORE_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n) {
  return n.toLocaleString(STORE_LOCALE);
}
