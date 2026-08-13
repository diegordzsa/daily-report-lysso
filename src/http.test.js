// node --test src/http.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry, HttpError, isRetryableStatus, explainHttpError } from './http.js';

// Sin espera real: los tests no deben tardar lo que tardan los backoffs.
const noSleep = async () => {};

function responder(sequence) {
  let i = 0;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const step = sequence[Math.min(i, sequence.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    return new Response(step.body ?? '', { status: step.status });
  };
  return { fetchImpl, calls };
}

test('devuelve la respuesta sin reintentar cuando sale bien a la primera', async () => {
  const { fetchImpl, calls } = responder([{ status: 200, body: '{"ok":true}' }]);
  const res = await fetchWithRetry('https://x/y', {}, { fetchImpl, sleep: noSleep });

  assert.equal(res.status, 200);
  assert.equal(await res.json().then(j => j.ok), true);
  assert.equal(calls.length, 1);
});

// Este es el caso que rompio el reporte del 2026-08-13.
test('reintenta un 402 Unavailable Shop y se recupera', async () => {
  const { fetchImpl, calls } = responder([
    { status: 402, body: '{"errors":"Unavailable Shop"}' },
    { status: 402, body: '{"errors":"Unavailable Shop"}' },
    { status: 200, body: '{"orders":[]}' },
  ]);
  const res = await fetchWithRetry('https://x/y', {}, { fetchImpl, sleep: noSleep });

  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
});

test('reintenta ante 429 y 5xx', async () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const { fetchImpl, calls } = responder([{ status }, { status: 200, body: '{}' }]);
    const res = await fetchWithRetry('https://x/y', {}, { fetchImpl, sleep: noSleep });
    assert.equal(res.status, 200, `status ${status} deberia reintentarse`);
    assert.equal(calls.length, 2);
  }
});

test('reintenta ante error de red', async () => {
  const { fetchImpl, calls } = responder([
    new TypeError('fetch failed'),
    { status: 200, body: '{}' },
  ]);
  const res = await fetchWithRetry('https://x/y', {}, { fetchImpl, sleep: noSleep });

  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

// Un token revocado no se arregla esperando: reintentar solo retrasa el aviso.
test('NO reintenta ante 401, 403 ni 404', async () => {
  for (const status of [401, 403, 404]) {
    const { fetchImpl, calls } = responder([{ status, body: 'nope' }]);
    await assert.rejects(
      () => fetchWithRetry('https://x/y', {}, { fetchImpl, sleep: noSleep }),
      (err) => err instanceof HttpError && err.status === status,
    );
    assert.equal(calls.length, 1, `status ${status} no deberia reintentarse`);
  }
});

test('se rinde tras agotar los intentos y conserva status y cuerpo', async () => {
  const { fetchImpl, calls } = responder([{ status: 402, body: '{"errors":"Unavailable Shop"}' }]);
  await assert.rejects(
    () => fetchWithRetry('https://x/y', {}, { fetchImpl, sleep: noSleep, attempts: 4, label: 'Shopify' }),
    (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 402);
      assert.match(err.body, /Unavailable Shop/);
      assert.match(err.message, /Shopify/);
      assert.equal(err.attempts, 4);
      return true;
    },
  );
  assert.equal(calls.length, 4);
});

test('el backoff crece y se le pasa al sleep', async () => {
  const waits = [];
  const { fetchImpl } = responder([{ status: 503 }, { status: 503 }, { status: 200, body: '{}' }]);
  await fetchWithRetry('https://x/y', {}, {
    fetchImpl, sleep: async (ms) => { waits.push(ms); }, baseDelayMs: 1000,
  });

  assert.equal(waits.length, 2);
  assert.ok(waits[1] > waits[0], `el segundo backoff (${waits[1]}) debe superar al primero (${waits[0]})`);
});

test('explainHttpError dice que hacer, no solo que fallo', () => {
  const frozen = new HttpError({
    label: 'Shopify', status: 402, statusText: 'Payment Required',
    body: '{"errors":"Unavailable Shop"}', attempts: 6, url: 'https://x',
  });
  assert.match(explainHttpError(frozen), /congelada|factura/i);

  const revoked = new HttpError({
    label: 'Shopify', status: 401, statusText: 'Unauthorized',
    body: '', attempts: 1, url: 'https://x',
  });
  assert.match(explainHttpError(revoked), /token/i);

  // Un 5xx sin entrada propia cae en el generico, no en null.
  const upstream = new HttpError({
    label: 'Meta', status: 503, statusText: 'Service Unavailable',
    body: '', attempts: 6, url: 'https://x',
  });
  assert.match(explainHttpError(upstream), /incidencia/i);

  assert.equal(explainHttpError(new Error('otra cosa')), null);
});

test('isRetryableStatus clasifica como se espera', () => {
  for (const s of [402, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableStatus(s), true, `${s} deberia ser reintentable`);
  }
  for (const s of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryableStatus(s), false, `${s} no deberia ser reintentable`);
  }
});
