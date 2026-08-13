// Reintentos con backoff para las llamadas a APIs externas.
//
// Por que existe: el 2026-08-13 el reporte se perdio entero porque Shopify
// devolvio `402 Unavailable Shop` en la PRIMERA llamada, a las 09:01 UTC. La
// tienda respondia 200 otra vez unas horas despues, con el mismo token y el
// mismo dominio. No fallo el codigo ni la autenticacion: fue un hueco transitorio
// del lado de Shopify. Sin reintentos, 265 ms de indisponibilidad bastaban para
// tirar el reporte del dia.
//
// Que se reintenta y que no: esperar solo sirve si el fallo se cura solo. Un
// token revocado (401), un scope que falta (403) o un dominio mal escrito (404)
// no cambian por insistir, asi que fallan a la primera y el aviso llega antes.

export class HttpError extends Error {
  constructor({ label, status, statusText, body, attempts, url }) {
    super(`${label} API error: ${status} ${statusText} — ${String(body).substring(0, 200)}`);
    this.name = 'HttpError';
    this.label = label;
    this.status = status;
    this.statusText = statusText;
    this.body = String(body);
    this.attempts = attempts;
    this.url = url;
  }
}

// 402 esta aqui a proposito. Shopify lo usa para "Unavailable Shop", que cubre
// tanto una tienda congelada por facturacion como un estado transitorio suyo.
// Los dos casos se ven igual desde fuera, asi que se reintenta: si era pasajero
// se salva el reporte, y si era una congelacion real solo se pierden unos
// minutos antes de avisar con un mensaje que ya dice que mirar.
const RETRYABLE = new Set([402, 408, 425, 429, 500, 502, 503, 504]);

export function isRetryableStatus(status) {
  return RETRYABLE.has(status);
}

// El mensaje que llega a Slack lo lee alguien que no tiene el log delante. Un
// volcado de `402 Payment Required` no dice que hacer; esto si.
const EXPLANATIONS = {
  Shopify: {
    0: 'No se pudo contactar con Shopify (red). Suele ser pasajero.',
    402: 'La tienda esta congelada o no disponible en Shopify. Casi siempre es una ' +
         'factura de Shopify impagada o la tienda en pausa. Revisa Shopify admin > ' +
         'Settings > Plan. El token y el codigo estan bien.',
    401: 'El token offline de Shopify fue revocado. Hay que repetir el authorization ' +
         'code grant (ver SETUP.md).',
    403: 'Al token de Shopify le falta el scope read_orders.',
    404: 'El dominio de la tienda no existe. Revisa el secreto SHOPIFY_STORE_DOMAIN.',
    423: 'Shopify ha bloqueado la tienda. Hay que contactar con su soporte.',
  },
  Meta: {
    0: 'No se pudo contactar con la API de Meta (red). Suele ser pasajero.',
    401: 'El token de Meta ya no vale. Regenerarlo con un System User (ver SETUP.md).',
    403: 'Al token de Meta le falta el permiso ads_read, o se agoto el rate limit.',
    429: 'Rate limit de Meta agotado tras varios reintentos.',
  },
};

export function explainHttpError(err) {
  if (!(err instanceof HttpError)) return null;
  const byLabel = EXPLANATIONS[err.label];
  if (!byLabel) return null;
  if (byLabel[err.status]) return byLabel[err.status];
  if (err.status >= 500) return `${err.label} tiene una incidencia en su lado. Suele resolverse solo.`;
  return null;
}

const sleepReal = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchWithRetry(url, options = {}, {
  // 6 intentos con base 2 s dan ~2 s, 4 s, 8 s, 16 s, 32 s: algo mas de un minuto
  // de ventana, suficiente para un hueco corto sin alargar el job.
  attempts = 6,
  baseDelayMs = 2000,
  label = 'HTTP',
  fetchImpl = fetch,
  sleep = sleepReal,
  onRetry = defaultOnRetry,
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, options);
    } catch (err) {
      // Un fallo de red (DNS, TCP, timeout) es el caso transitorio por excelencia.
      lastError = new HttpError({
        label, status: 0, statusText: 'Network error',
        body: err.message, attempts: attempt, url,
      });
      if (attempt === attempts) break;
      await backoff({ attempt, baseDelayMs, sleep, onRetry, label, reason: err.message });
      continue;
    }

    if (res.ok) {
      if (attempt > 1) console.log(`[${label}] Recuperado en el intento ${attempt}.`);
      return res;
    }

    // Solo se lee el cuerpo cuando la respuesta NO sirve: asi el llamador recibe
    // la respuesta buena con el stream intacto para su .json().
    const body = await res.text().catch(() => '');
    lastError = new HttpError({
      label, status: res.status, statusText: res.statusText,
      body, attempts: attempt, url,
    });

    if (!isRetryableStatus(res.status)) throw lastError;
    if (attempt === attempts) break;

    await backoff({
      attempt, baseDelayMs, sleep, onRetry, label,
      reason: `${res.status} ${res.statusText}`,
    });
  }

  throw lastError;
}

async function backoff({ attempt, baseDelayMs, sleep, onRetry, label, reason }) {
  // Exponencial con jitter. El jitter importa poco con un solo cliente, pero
  // evita que los dos fetch en paralelo del reporte reintenten al unisono.
  const delay = Math.round(baseDelayMs * 2 ** (attempt - 1) * (1 + Math.random() * 0.25));
  onRetry({ label, attempt, reason, delay });
  await sleep(delay);
}

function defaultOnRetry({ label, attempt, reason, delay }) {
  console.warn(`[${label}] Intento ${attempt} fallo (${reason}). Reintentando en ${(delay / 1000).toFixed(1)} s...`);
}
