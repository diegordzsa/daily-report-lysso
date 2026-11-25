// node --test src/report.test.js
//
// Cubre el dia sin actividad: 0 filas de Meta y 0 pedidos de Shopify con las dos
// APIs respondiendo 200. Del 15 al 17 de agosto de 2026 ese caso publico
// "verifica que los tokens de acceso siguen activos" y salio con exit 1, tres
// veces al dia, con unas credenciales que estaban perfectas.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// config.js lee el entorno al importarse y hace exit 1 si falta algo, asi que los
// secretos de mentira van antes del import dinamico.
process.env.STORE_NAME = 'Tienda Test';
process.env.META_ACCESS_TOKEN = 'meta-token-test';
process.env.META_AD_ACCOUNT_ID = '000';
process.env.SHOPIFY_STORE_DOMAIN = 'test.myshopify.com';
process.env.SHOPIFY_ACCESS_TOKEN = 'shpca_test';
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/nada';
process.env.STORE_LOCALE = 'es-ES';
process.env.STORE_TIMEZONE = 'Europe/Madrid';

const { calculateMetrics } = await import('./report.js');
const { formatReport, sendToSlack, toSlackMrkdwn } = await import('./slack.js');
const { parseFunnelResponse, FUNNEL_SHOPIFYQL } = await import('./shopify.js');

const DIAGNOSTICO = 'Diagnostico de prueba.';

test('un dia sin actividad no produce NaN ni divisiones por cero', () => {
  const metrics = calculateMetrics([], [], 0.867);

  for (const [campo, valor] of Object.entries(metrics)) {
    if (typeof valor === 'number') {
      assert.ok(Number.isFinite(valor), `${campo} deberia ser finito, es ${valor}`);
    }
  }
  assert.equal(metrics.adSpend, 0);
  assert.equal(metrics.shopifyOrders, 0);
  assert.equal(metrics.shopifyAOV, 0);
  assert.equal(metrics.merROAS, 0);
  assert.equal(metrics.metaROAS, 0);
});

test('el reporte de un dia sin actividad se renderiza entero y avisa de que no son los tokens', () => {
  const metrics = calculateMetrics([], [], 0.867);
  const texto = formatReport({
    date: '2026-08-16',
    metrics,
    diagnosis: DIAGNOSTICO,
    hoursSettled: 11.01,
    sinActividad: true,
  });

  assert.ok(!texto.includes('NaN'), 'el reporte no debe contener NaN');
  assert.ok(texto.includes('no es un problema de tokens'),
    'debe desmentir explicitamente el falso diagnostico de tokens');
  assert.ok(texto.includes('Ordenes: 0'));
  assert.ok(texto.includes(DIAGNOSTICO));
  // La nota va arriba, antes de las cifras: quien abre el mensaje la ve primero.
  assert.ok(texto.indexOf(':zzz:') < texto.indexOf('REVENUE'));
});

test('un dia normal no lleva la nota de sin actividad', () => {
  const metrics = calculateMetrics(
    [{ date: '2026-08-11', spend: 100, impressions: 5000, clicks: 250 }],
    [{ date: '2026-08-11', order_count: 1, order_net_sales: 90, order_tags: '' }],
    0.867,
  );
  const texto = formatReport({
    date: '2026-08-11',
    metrics,
    diagnosis: DIAGNOSTICO,
    hoursSettled: 11.01,
  });

  assert.ok(!texto.includes(':zzz:'));
  assert.ok(!texto.includes('no es un problema de tokens'));
  assert.ok(texto.includes('Ordenes: 1'));
});

test('DRY_RUN=1 no publica nada en Slack', async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('no deberia llamarse a fetch con DRY_RUN=1'); };
  process.env.DRY_RUN = '1';
  try {
    await sendToSlack('https://hooks.slack.test/nada', 'texto');
  } finally {
    delete process.env.DRY_RUN;
    globalThis.fetch = fetchOriginal;
  }
});

// --- Embudo de conversion de la tienda (ShopifyQL `sessions`) -------------------

const FUNNEL = { sessions: 2000, cartSessions: 104, checkoutSessions: 52, convertedSessions: 31 };

test('el embudo de la tienda calcula los % sobre el total de sesiones, como Shopify', () => {
  const m = calculateMetrics([], [], 1, FUNNEL);
  assert.equal(m.storeFunnel.cartRate, 5.2);
  assert.equal(m.storeFunnel.checkoutRate, 2.6);
  assert.equal(m.storeFunnel.conversionRate, 1.55);
});

test('sin sesiones el embudo no produce NaN', () => {
  const m = calculateMetrics([], [], 1,
    { sessions: 0, cartSessions: 0, checkoutSessions: 0, convertedSessions: 0 });
  for (const v of Object.values(m.storeFunnel)) assert.ok(Number.isFinite(v));
});

test('el reporte muestra carrito, checkout y conversion con formato es-ES', () => {
  const metrics = calculateMetrics([], [], 1, FUNNEL);
  const texto = formatReport({ date: '2026-11-15', metrics, diagnosis: DIAGNOSTICO, hoursSettled: 11 });
  assert.ok(texto.includes('CONVERSIÓN TIENDA (Shopify)'));
  assert.ok(texto.includes('Sesiones: 2000'));
  assert.ok(texto.includes('Añadido al carrito: 5,20% (104)'));
  assert.ok(texto.includes('Llegaron al checkout: 2,60% (52)'));
  assert.ok(texto.includes('Conversión: 1,55% (31)'));
  // La seccion va entre el revenue y los ads.
  assert.ok(texto.indexOf('REVENUE') < texto.indexOf('CONVERSIÓN TIENDA'));
  assert.ok(texto.indexOf('CONVERSIÓN TIENDA') < texto.indexOf('PAID ADS'));
});

test('si el embudo no se pudo leer, el reporte sale igual y dice por que', () => {
  const metrics = calculateMetrics([], [], 1, null);
  metrics.storeFunnelError = 'al token de Shopify le falta el scope read_reports';
  const texto = formatReport({ date: '2026-11-15', metrics, diagnosis: DIAGNOSTICO, hoursSettled: 11 });
  assert.ok(texto.includes('No disponible — al token de Shopify le falta el scope read_reports'));
  assert.ok(!texto.includes('NaN'));
});

test('parseFunnelResponse lee la fila de ShopifyQL (valores como string)', () => {
  const f = parseFunnelResponse({ data: { shopifyqlQuery: {
    parseErrors: [],
    tableData: { columns: [], rows: [{
      sessions: '2000', sessions_with_cart_additions: '104',
      sessions_that_reached_checkout: '52', sessions_that_completed_checkout: '31',
    }] },
  } } });
  assert.deepEqual(f, FUNNEL);
});

test('parseFunnelResponse traduce ACCESS_DENIED a "falta read_reports"', () => {
  assert.throws(
    () => parseFunnelResponse({ errors: [{ message: 'Access denied for shopifyqlQuery field.',
      extensions: { code: 'ACCESS_DENIED' } }] }),
    /read_reports/,
  );
});

test('parseFunnelResponse falla con los parseErrors de ShopifyQL', () => {
  assert.throws(
    () => parseFunnelResponse({ data: { shopifyqlQuery: { tableData: null, parseErrors: ['Column Not Found'] } } }),
    /Column Not Found/,
  );
});

test('la consulta ShopifyQL pide solo el dia del reporte', () => {
  assert.match(FUNNEL_SHOPIFYQL('2026-11-15'), /FROM sessions SHOW .* SINCE 2026-11-15 UNTIL 2026-11-15$/);
});

// --- Varias cuentas de Meta (EASY_02 + EASY_04) -------------------------------

test('META_AD_ACCOUNT_ID acepta varias cuentas, con o sin act_ y con espacios', async () => {
  const { parseAdAccountIds } = await import('./config.js');
  assert.deepEqual(parseAdAccountIds('111, act_222 ,,111'), ['111', '222']);
  assert.deepEqual(parseAdAccountIds('111'), ['111']);
});

test('el gasto de las dos cuentas se suma y se desglosa por cuenta', () => {
  const metrics = calculateMetrics([
    { account_name: 'EASY_02', spend: 100, impressions: 1000, clicks: 50, actions_link_click: 40 },
    { account_name: 'EASY_04', spend: 50.5, impressions: 500, clicks: 20, actions_link_click: 10 },
  ], [], 1);
  assert.equal(metrics.adSpend, 150.5);
  assert.equal(metrics.impressions, 1500);
  assert.equal(metrics.linkClicks, 50);
  assert.deepEqual(metrics.spendByAccount, [
    { name: 'EASY_02', spend: 100 }, { name: 'EASY_04', spend: 50.5 },
  ]);
  const texto = formatReport({ date: '2026-11-24', metrics, diagnosis: DIAGNOSTICO, hoursSettled: 11 });
  assert.ok(texto.includes('  • *EASY_02*: $100,00\n  • *EASY_04*: $50,50'));
});

test('con una sola cuenta no se muestra desglose', () => {
  const metrics = calculateMetrics([{ account_name: 'EASY_02', spend: 100 }], [], 1);
  const texto = formatReport({ date: '2026-11-24', metrics, diagnosis: DIAGNOSTICO, hoursSettled: 11 });
  assert.ok(!texto.includes('*EASY_02*'));
});

// --- Zonas horarias distintas (EASY_04 en Mexico) -----------------------------

const CUENTAS = [
  { name: 'EASY_02', timeZone: 'Europe/Madrid' },
  { name: 'EASY_04', timeZone: 'Mexico/General' },
];

test('nota corta para la cuenta en hora de Mexico, con el cierre en hora de Madrid', () => {
  const metrics = calculateMetrics([], [], 1);
  const texto = formatReport({ date: '2026-11-24', metrics, diagnosis: DIAGNOSTICO, adAccounts: CUENTAS });
  assert.ok(texto.includes(
    'EASY_04 cuenta el día en hora de México (cierra 07:00 Madrid); su gasto puede ajustarse ligeramente'));
  // EASY_02 esta en la zona de la tienda: sin nota.
  assert.ok(!texto.includes('EASY_02 cuenta el día'));
  // Las horas de consolidacion solo van en el log.
  assert.ok(!texto.includes('consolidado'));
});

test('en verano EASY_04 cierra a las 08:00 de Madrid', () => {
  const metrics = calculateMetrics([], [], 1);
  const texto = formatReport({ date: '2026-07-15', metrics, diagnosis: DIAGNOSTICO, adAccounts: CUENTAS });
  assert.ok(texto.includes('(cierra 08:00 Madrid)'));
});

test('el pie dice la hora real de envio en Madrid, no un texto fijo', () => {
  const metrics = calculateMetrics([], [], 1);
  const invierno = formatReport({ date: '2026-11-24', metrics, diagnosis: DIAGNOSTICO,
    sentAt: new Date('2026-11-25T09:01:00Z') });
  assert.ok(invierno.includes('_Enviado a las 10:01 (Madrid)_'));
  const verano = formatReport({ date: '2026-07-15', metrics, diagnosis: DIAGNOSTICO,
    sentAt: new Date('2026-07-16T09:01:00Z') });
  assert.ok(verano.includes('_Enviado a las 11:01 (Madrid)_'));
});

test('arrancar unos segundos antes de las 3 h espera en vez de abortar', async () => {
  const { waitMsToReachMinimum } = await import('./report.js');
  // 3 h menos 20 s: espera 20 s + 30 s de colchon.
  assert.equal(waitMsToReachMinimum(3 - 20 / 3600, 3, 30), 50000);
  // Ya pasado el minimo (el caso normal, 3.01 h): no espera.
  assert.equal(waitMsToReachMinimum(3.011, 3, 30), 0);
  // Faltan 2 h: no tiene sentido esperar, se aborta como siempre.
  assert.equal(waitMsToReachMinimum(1, 3, 30), 0);
  // Justo en el borde del margen: espera.
  assert.ok(waitMsToReachMinimum(2.5, 3, 30) > 0);
});

// --- Diagnostico en mrkdwn de Slack ------------------------------------------

test('las negritas de Markdown del diagnostico pasan al formato de Slack', () => {
  assert.equal(toSlackMrkdwn('El **checkout** cae y el __ROAS__ baja'),
    'El *checkout* cae y el *ROAS* baja');
  assert.equal(toSlackMrkdwn('## Diagnostico'), '*Diagnostico*');
  assert.equal(toSlackMrkdwn('* uno\n- dos\n1. tres'), '• uno\n• dos\n1. tres');
  assert.equal(toSlackMrkdwn('- **Accion:** pausar'), '• *Accion:* pausar');
  assert.equal(toSlackMrkdwn('~~viejo~~'), '~viejo~');
  // Lo que ya esta en formato Slack no se toca.
  assert.equal(toSlackMrkdwn('Gasto *alto* hoy'), 'Gasto *alto* hoy');
});

test('el reporte no deja ** literales del diagnostico', () => {
  const metrics = calculateMetrics([], [], 1);
  const texto = formatReport({ date: '2026-11-24', metrics,
    diagnosis: '1. **Punto debil:** checkout\n2. **ROAS** normal' });
  assert.ok(!texto.includes('**'));
  assert.ok(texto.includes('  1. *Punto debil:* checkout'));
});
