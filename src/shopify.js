import {
  SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION, SHOPIFY_ACCESS_TOKEN,
  REPORT_DATE, STORE_TIMEZONE,
} from './config.js';
import { yesterdayInZone } from './freshness.js';
import { fetchWithRetry } from './http.js';

// "Ayer" en la timezone de la tienda, no en UTC. Con toISOString() el reporte se
// iba un dia atras en cuanto la hora local pasaba de la UTC (en Madrid, a partir
// de las 22:00 en verano).
export function getYesterday() {
  if (REPORT_DATE) return REPORT_DATE;
  return yesterdayInZone(STORE_TIMEZONE);
}

// La app de Shopify y la tienda estan en organizaciones distintas, asi que el
// grant `client_credentials` no aplica: el token es uno offline obtenido por
// authorization code grant y guardado en SHOPIFY_ACCESS_TOKEN.
export async function fetchShopifyOrders() {
  const accessToken = SHOPIFY_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Falta SHOPIFY_ACCESS_TOKEN (token offline del authorization code grant)');
  }

  const yesterday = getYesterday();
  // Ventana UTC holgada de +-1 dia alrededor del dia local. El recorte fino lo
  // hace el filtro por fecha local de abajo; la ventana solo evita paginar todo
  // el historico. Si se ajustase exacto a 00:00-23:59:59Z se perderian ordenes en
  // tiendas cuya timezone no sea UTC.
  const dayMs = 86400000;
  const minDate = new Date(Date.parse(`${yesterday}T00:00:00Z`) - dayMs).toISOString().slice(0, 10);
  const maxDate = new Date(Date.parse(`${yesterday}T00:00:00Z`) + dayMs).toISOString().slice(0, 10);

  const params = new URLSearchParams({
    status: 'any',
    created_at_min: `${minDate}T00:00:00Z`,
    created_at_max: `${maxDate}T23:59:59Z`,
    limit: '250',
    fields: 'id,created_at,subtotal_price,total_discounts,tags,line_items',
  });

  const allOrders = [];
  let url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params}`;

  while (url) {
    console.log(`[Shopify] Fetching orders...`);
    const res = await fetchWithRetry(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    }, { label: 'Shopify' });

    const json = await res.json();
    allOrders.push(...(json.orders || []));

    const link = res.headers.get('link');
    const next = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  console.log(`[Shopify] Got ${allOrders.length} total orders`);

  const yesterdayOrders = allOrders.filter(o => o.created_at?.slice(0, 10) === yesterday);
  console.log(`[Shopify] ${yesterdayOrders.length} orders for ${yesterday}`);

  return yesterdayOrders.map(order => ({
    date: yesterday,
    order_count: 1,
    order_net_sales: parseFloat(order.subtotal_price) || 0,
    order_tags: order.tags || '',
  }));
}

// Embudo de conversion "como en Shopify" (Analytics > Conversion rate breakdown):
// sesiones -> sesiones con anadido al carrito -> sesiones que llegaron al checkout
// -> sesiones que convirtieron. Sale del dataset `sessions` de ShopifyQL, que
// cuenta sesiones de la tienda online, no clicks de Meta: es el embudo de TODO el
// trafico, no solo el pagado.
//
// Requiere el scope `read_reports` (ademas de `read_orders`) y Admin API >= 2025-10.
// ShopifyQL interpreta las fechas en la timezone de la tienda, asi que
// SINCE/UNTIL con el mismo dia da exactamente el "ayer" local que usa el reporte.
export const FUNNEL_SHOPIFYQL = (date) =>
  `FROM sessions SHOW sessions, sessions_with_cart_additions, ` +
  `sessions_that_reached_checkout, sessions_that_completed_checkout ` +
  `SINCE ${date} UNTIL ${date}`;

export async function fetchShopifyFunnel(date = getYesterday(), { fetchImpl } = {}) {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const query = `query($q: String!) {
    shopifyqlQuery(query: $q) {
      tableData { columns { name } rows }
      parseErrors
    }
  }`;

  console.log(`[Shopify] Fetching conversion funnel (ShopifyQL sessions)...`);
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { q: FUNNEL_SHOPIFYQL(date) } }),
  }, { label: 'Shopify', ...(fetchImpl ? { fetchImpl } : {}) });

  return parseFunnelResponse(await res.json());
}

// GraphQL contesta 200 aunque falte el scope: el error viene en `errors` (p. ej.
// ACCESS_DENIED por no tener read_reports). Se convierte en excepcion con un
// mensaje que dice que hacer.
export function parseFunnelResponse(json) {
  if (json.errors?.length) {
    const msg = json.errors.map(e => e.message).join('; ');
    const denied = json.errors.some(e => e.extensions?.code === 'ACCESS_DENIED')
      || /access denied|read_reports/i.test(msg);
    throw new Error(denied
      ? `al token de Shopify le falta el scope read_reports (${msg})`
      : `ShopifyQL: ${msg}`);
  }
  const result = json.data?.shopifyqlQuery;
  if (result?.parseErrors?.length) {
    throw new Error(`ShopifyQL parse error: ${result.parseErrors.join('; ')}`);
  }
  const row = result?.tableData?.rows?.[0] ?? {};
  const n = (k) => Number(row[k]) || 0;
  return {
    sessions: n('sessions'),
    cartSessions: n('sessions_with_cart_additions'),
    checkoutSessions: n('sessions_that_reached_checkout'),
    convertedSessions: n('sessions_that_completed_checkout'),
  };
}
