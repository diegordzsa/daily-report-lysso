// Probe de estado de la tienda Shopify. Solo lee y loguea: NUNCA escribe en Slack.
//
// Existe porque un 402 "Unavailable Shop" no se puede distinguir desde fuera de
// un token revocado ni de un dominio mal escrito sin mirar la respuesta cruda.
// Este probe separa esos casos: pega a /shop.json, imprime status y cuerpo, y
// solo si la tienda responde intenta contar las ordenes del dia.
//
// Deliberadamente no importa src/config.js: asi solo necesita los dos secretos de
// Shopify y no arrastra los de Meta, Slack ni Anthropic.

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API = process.env.SHOPIFY_API_VERSION || '2026-07';
const DATE = process.env.PROBE_DATE;

if (!DOMAIN || !TOKEN) {
  console.error('Faltan SHOPIFY_STORE_DOMAIN o SHOPIFY_ACCESS_TOKEN');
  process.exit(1);
}

// El dominio es un secreto, asi que no se imprime entero: solo lo suficiente para
// detectar una errata (sufijo mal, dominio publico en vez de .myshopify.com).
function maskDomain(d) {
  const [host] = d.split('.');
  const rest = d.slice(host.length);
  return `${host.slice(0, 2)}***${host.slice(-1)}${rest}`;
}

async function call(path) {
  const url = `https://${DOMAIN}/admin/api/${API}/${path}`;
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': TOKEN } });
  const body = await res.text().catch(() => '');
  return { status: res.status, statusText: res.statusText, body };
}

async function main() {
  console.log(`[Probe] Ahora UTC: ${new Date().toISOString()}`);
  console.log(`[Probe] Dominio: ${maskDomain(DOMAIN)} | API ${API} | token ${TOKEN.slice(0, 6)}...(${TOKEN.length} chars)`);

  const shop = await call('shop.json');
  console.log(`[Probe] GET /shop.json -> ${shop.status} ${shop.statusText}`);
  console.log(`[Probe] Cuerpo: ${shop.body.substring(0, 400)}`);

  // Cada status significa una cosa distinta y pide una accion distinta. Sin esto
  // el diagnostico se queda en "Shopify falla".
  const meanings = {
    200: 'La tienda responde. Si el reporte fallo, el problema ya no esta aqui.',
    401: 'Token invalido o revocado -> repetir el authorization code grant.',
    402: 'TIENDA CONGELADA por Shopify (factura impagada) o cerrada/pausada. ' +
         'No es el token ni el codigo: lo resuelve el dueno en el admin de Shopify.',
    403: 'Token sin el scope read_orders / read_all_orders.',
    404: 'El dominio no corresponde a ninguna tienda -> revisar SHOPIFY_STORE_DOMAIN.',
    423: 'Tienda bloqueada (fraude o cierre).',
  };
  console.log(`[Probe] Lectura: ${meanings[shop.status] || 'Status inesperado, ver cuerpo.'}`);

  if (shop.status === 200) {
    try {
      const s = JSON.parse(shop.body).shop;
      console.log(`[Probe] Tienda: ${s.name} | plan=${s.plan_name} | moneda=${s.currency} | tz=${s.iana_timezone}`);
    } catch { /* el cuerpo ya se imprimio arriba */ }
  } else {
    // Sin tienda no hay ordenes que contar: parar aqui y devolver fallo para que
    // se vea en rojo en Actions.
    process.exit(1);
  }

  if (!DATE) {
    console.log('[Probe] Sin PROBE_DATE: no se cuentan ordenes.');
    return;
  }

  const params = new URLSearchParams({
    status: 'any',
    created_at_min: `${DATE}T00:00:00Z`,
    created_at_max: `${DATE}T23:59:59Z`,
  });
  const count = await call(`orders/count.json?${params}`);
  console.log(`[Probe] GET /orders/count.json (${DATE} UTC) -> ${count.status}: ${count.body.substring(0, 200)}`);

  // La llamada exacta que hace el reporte, campos incluidos. La REST Admin API es
  // legacy desde octubre de 2024 y sus endpoints se van retirando por version, asi
  // que antes de fijar una version nueva en SHOPIFY_API_VERSION hay que ver este
  // 200 con `api_version` puesta a la candidata.
  params.set('limit', '1');
  params.set('fields', 'id,created_at,subtotal_price,total_discounts,tags,line_items');
  const list = await call(`orders.json?${params}`);
  const orders = list.status === 200 ? (JSON.parse(list.body).orders ?? []).length : 'n/d';
  console.log(`[Probe] GET /orders.json (misma llamada que el reporte, API ${API}) -> ` +
    `${list.status} ${list.statusText}, ${orders} pedido(s) en la pagina`);
  if (list.status !== 200) {
    console.error(`[Probe] Esta version NO sirve para el reporte. Cuerpo: ${list.body.substring(0, 300)}`);
    process.exit(1);
  }
}

main().catch(e => { console.error('[Probe] FALLO:', e.message); process.exit(1); });
