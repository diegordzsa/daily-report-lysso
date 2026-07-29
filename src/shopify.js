import {
  SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION, SHOPIFY_ACCESS_TOKEN,
  REPORT_DATE, STORE_TIMEZONE,
} from './config.js';
import { yesterdayInZone } from './freshness.js';

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
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Shopify API error: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
    }

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
