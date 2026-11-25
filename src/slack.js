import {
  STORE_NAME, STORE_CURRENCY, STORE_CURRENCY_CODE, AD_CURRENCY, AD_CURRENCY_CODE,
  STORE_LOCALE, REPORT_TIME_LABEL, SUBSCRIPTION_TAGS, STORE_TIMEZONE,
} from './config.js';
import { dayCloseInstant } from './freshness.js';

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

// Un dia entero en ceros se lee igual que un reporte roto, y quien lo mira acaba
// sospechando de los tokens. Esta nota dice explicitamente que las dos APIs
// contestaron bien, que es justo lo que no se podia deducir mirando el mensaje.
const NOTA_SIN_ACTIVIDAD =
  `_:zzz: Dia sin actividad: ni pedidos en Shopify ni entrega de ads en Meta. ` +
  `Las dos APIs respondieron correctamente, asi que *no es un problema de tokens* — ` +
  `los ceros son reales. Si no se esperaba, mira si la tienda o las campanas estan en pausa._`;

// Mismo embudo y mismos porcentajes que Shopify > Analytics > "Conversion rate
// breakdown": cada paso sobre el total de sesiones. Si no se pudo leer, se dice
// por que en vez de mostrar ceros, que se leerian como un dia sin ventas.
function buildStoreFunnelLines(metrics) {
  const header = `:shopping_trolley: *CONVERSIÓN TIENDA (Shopify)*`;
  const f = metrics.storeFunnel;
  if (!f) {
    const reason = metrics.storeFunnelError ? ` — ${metrics.storeFunnelError}` : '';
    return [header, `  _No disponible${reason}_`];
  }
  return [
    header,
    `  Sesiones: ${fmtInt(f.sessions)}`,
    `  Añadido al carrito: ${fmtPct(f.cartRate)} (${fmtInt(f.cartSessions)})`,
    `  Llegaron al checkout: ${fmtPct(f.checkoutRate)} (${fmtInt(f.checkoutSessions)})`,
    `  Conversión: ${fmtPct(f.conversionRate)} (${fmtInt(f.convertedSessions)})`,
  ];
}

// Nombre legible de una zona horaria para la nota. Lo que no esta aqui sale con
// su ultimo tramo ("America/Bogota" -> "Bogota").
const ZONE_LABELS = {
  'Mexico/General': 'México',
  'America/Mexico_City': 'México',
  'Europe/Madrid': 'Madrid',
};
function zoneLabel(tz) {
  return ZONE_LABELS[tz] || tz.split('/').pop().replace(/_/g, ' ');
}

function timeIn(instant, timeZone) {
  return new Date(instant).toLocaleTimeString(STORE_LOCALE, {
    timeZone, hour: '2-digit', minute: '2-digit',
  });
}

// Una cuenta en otra zona horaria cuenta "su" dia, no el de la tienda: EASY_04
// (Mexico) va de 07:00 a 07:00 de Madrid en invierno. Se dice en el reporte para
// que nadie compare horas sin saberlo. La hora de cierre se calcula para la fecha
// del reporte (cambia con el horario de verano de Madrid). Version corta a
// proposito: las horas de consolidacion van solo en el log.
function buildZoneNotes(date, adAccounts = []) {
  const storeCity = zoneLabel(STORE_TIMEZONE);
  return adAccounts
    .filter(a => a.timeZone && a.timeZone !== STORE_TIMEZONE)
    .map(a =>
      `_${a.name} cuenta el día en hora de ${zoneLabel(a.timeZone)} ` +
      `(cierra ${timeIn(dayCloseInstant(date, a.timeZone), STORE_TIMEZONE)} ${storeCity}); ` +
      `su gasto puede ajustarse ligeramente_`);
}

function sentAtLabel(sentAt) {
  if (REPORT_TIME_LABEL) return REPORT_TIME_LABEL;
  return `${timeIn(sentAt, STORE_TIMEZONE)} (${zoneLabel(STORE_TIMEZONE)})`;
}

export function formatReport({
  date, metrics, diagnosis, sinActividad = false, adAccounts = [], sentAt = new Date(),
}) {
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
    ...(sinActividad ? [NOTA_SIN_ACTIVIDAD, ``] : []),
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

  lines.push(``, ...buildStoreFunnelLines(metrics));

  lines.push(
    ``,
    `:loudspeaker: *PAID ADS (Meta)*`,
    `  Gasto: ${AD_CURRENCY}${fmt(metrics.adSpend)}${spendConverted}`,
    ...(metrics.spendByAccount?.length > 1
      ? metrics.spendByAccount.map(a => `  • *${a.name}*: ${AD_CURRENCY}${fmt(a.spend)}`)
      : []),
    `  ROAS (Meta): ${metrics.metaROAS.toFixed(2)}x | MER-ROAS: ${merLabel}`,
    `  CPO: ${AD_CURRENCY}${fmt(metrics.cpo)} | Revenue atribuido: ${AD_CURRENCY}${fmt(metrics.metaAttributedRevenue)}`,
    ``,
    `:mag: *FUNNEL ADS (pixel de Meta)*`,
    `  Impresiones: ${fmtInt(metrics.impressions)}`,
    `  Link Clicks: ${fmtInt(metrics.linkClicks)} (CTR: ${metrics.ctr.toFixed(1)}%)`,
    `  Add to Cart: ${metrics.addToCarts} (${metrics.addToCartRate.toFixed(1)}%)`,
    `  Checkout: ${metrics.checkoutsInitiated} (${metrics.checkoutRate.toFixed(1)}%)`,
    `  Compras: ${metrics.metaOrders} (${metrics.purchaseRate.toFixed(1)}%)`,
    ``,
    `:robot_face: *DIAGNOSTICO (Claude)*`,
    ...toSlackMrkdwn(diagnosis).split('\n').map(line => `  ${line}`),
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ...buildZoneNotes(date, adAccounts),
    `_Enviado a las ${sentAtLabel(sentAt)}_`,
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

// Claude responde en Markdown, pero Slack usa su propio mrkdwn: `**x**` sale con
// los asteriscos literales. Se traduce lo que el modelo suele usar: negritas
// (`**x**`, `__x__`) a `*x*`, titulos (`## x`) a una linea en negrita, tachado
// (`~~x~~`) a `~x~` y vinetas `* ` / `- ` a `• `. Las vinetas van antes que las
// negritas para no confundir un `* ` de lista con un asterisco de Slack.
export function toSlackMrkdwn(text) {
  return String(text)
    .split('\n')
    .map(line => line
      .replace(/^(\s*)#{1,6}\s+(.+?)\s*#*\s*$/, '$1**$2**')
      .replace(/^(\s*)[*-]\s+/, '$1• '))
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/~~(.+?)~~/g, '~$1~');
}

function fmtPct(n) {
  return `${n.toLocaleString(STORE_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function fmtInt(n) {
  return n.toLocaleString(STORE_LOCALE);
}
