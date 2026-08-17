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
process.env.REPORT_TIME_LABEL = '11:00 (Madrid)';

const { calculateMetrics } = await import('./report.js');
const { formatReport, sendToSlack } = await import('./slack.js');

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
