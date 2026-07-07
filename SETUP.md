# Guia de Configuracion — Daily Report Template

Este template genera un reporte diario automatico que combina datos de **Meta Ads** y **Shopify**, genera un diagnostico con **Claude AI**, y lo envia a **Slack**.

---

## Checklist Rapido

1. Crear un nuevo repo en GitHub usando este template
2. Configurar los 8 secretos requeridos en GitHub (Settings > Secrets and variables > Actions)
3. Ajustar la hora del cron en `.github/workflows/daily-report.yml` segun tu timezone
4. (Opcional) Descomentar y configurar variables opcionales en el workflow
5. Probar ejecutando el workflow manualmente (Actions > Daily Report > Run workflow)

---

## Secretos Requeridos

Configura estos 8 secretos en tu repositorio de GitHub:
**Settings > Secrets and variables > Actions > New repository secret**

### `STORE_NAME`
Nombre de tu tienda que aparecera en el reporte de Slack.
- Ejemplo: `Mi Tienda ES`, `Brand MX`, `Store US`

### `META_ACCESS_TOKEN`
Token de acceso de la Marketing API de Meta (Facebook/Instagram Ads).

**Como obtenerlo:**
1. Ve a [Meta Business Suite](https://business.facebook.com) > Business Settings
2. En el menu izquierdo: **Users > System Users**
3. Si no tienes un System User, crea uno con rol Admin
4. Haz clic en el System User > **Generate New Token**
5. Selecciona tu app y el permiso `ads_read`
6. Copia el token generado

> **Nota:** Los tokens de System User no expiran. Los tokens de usuario normal expiran en ~60 dias.

### `META_AD_ACCOUNT_ID`
El ID numerico de tu cuenta de anuncios de Meta (sin el prefijo `act_`).

**Como obtenerlo:**
1. Ve a [Meta Business Suite](https://business.facebook.com) > Business Settings
2. En el menu izquierdo: **Accounts > Ad Accounts**
3. Selecciona tu cuenta de anuncios
4. Copia el **Account ID** (solo los numeros, sin `act_`)
- Ejemplo: `2217973965310655`

### `SHOPIFY_STORE_DOMAIN`
El dominio `.myshopify.com` de tu tienda.

**Como obtenerlo:**
1. Ve al admin de tu tienda Shopify
2. El dominio esta en la URL: `https://TU-TIENDA.myshopify.com/admin`
3. Copia solo la parte `tu-tienda.myshopify.com`
- Ejemplo: `mi-tienda.myshopify.com`

### `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET`
Credenciales de una Custom App de Shopify con acceso a la Admin API.

**Como obtenerlos:**
1. Ve a [Shopify Partners](https://partners.shopify.com) o al **Dev Dashboard** de tu tienda
2. Crea una nueva app (Custom App)
3. En **API credentials**, configura los scopes de Admin API:
   - `read_orders` (requerido)
4. Instala la app en tu tienda
5. Copia el **Client ID** y **Client Secret** de la seccion de credenciales

> **Importante:** Esta app usa `client_credentials` grant (no requiere un token estatico `shpat_`). Solo necesitas el Client ID y Client Secret.

### `ANTHROPIC_API_KEY`
API key de Anthropic para usar Claude.

**Como obtenerla:**
1. Ve a [console.anthropic.com](https://console.anthropic.com)
2. Inicia sesion o crea una cuenta
3. Ve a **API Keys** en el menu
4. Crea una nueva key y copiala
- Formato: `sk-ant-api03-...`

### `SLACK_WEBHOOK_URL`
URL de Incoming Webhook de Slack para enviar el reporte.

**Como obtenerlo:**
1. Ve a [api.slack.com/apps](https://api.slack.com/apps)
2. Crea una nueva app (From scratch) o usa una existente
3. En el menu izquierdo: **Incoming Webhooks**
4. Activa los webhooks (toggle ON)
5. Haz clic en **Add New Webhook to Workspace**
6. Selecciona el canal donde quieres recibir el reporte
7. Copia la **Webhook URL**
- Formato: `https://hooks.slack.com/services/T.../B.../...`

---

## Variables Opcionales

Estas variables tienen valores por defecto. Para cambiarlas, descomenta las lineas correspondientes en `.github/workflows/daily-report.yml`.

| Variable | Default | Cuando cambiar |
|---|---|---|
| `STORE_CURRENCY` | `€` | Si tu tienda usa otra moneda (`$`, `£`, `MX$`) |
| `STORE_LOCALE` | `es-ES` | Si necesitas otro formato de numeros (`en-US`, `es-MX`, `pt-BR`) |
| `STORE_INDUSTRY` | _(vacio)_ | Para benchmarks especificos en el diagnostico de Claude |
| `ROAS_BENCHMARK` | _(vacio)_ | Para que Claude compare contra un benchmark de tu industria |
| `REPORT_TIME_LABEL` | `5:00 AM` | Si cambias la hora del cron, actualiza esto para que coincida |
| `META_API_VERSION` | `v21.0` | Si Meta depreca esta version |
| `SHOPIFY_API_VERSION` | `2024-10` | Si Shopify depreca esta version |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Para usar otro modelo de Claude |

---

## Subscription Tags (Opcional)

Si tu tienda tiene suscripciones y quieres trackearlas en el reporte, configura la variable `SUBSCRIPTION_TAGS` con un JSON array.

Cada entrada tiene:
- `tag`: El tag exacto que Shopify pone en las ordenes de suscripcion
- `label`: El nombre que aparecera en el reporte

**Ejemplo:**
```
SUBSCRIPTION_TAGS: '[{"tag":"Kaching Subscription First Order","label":"1ª Susc"},{"tag":"appstle_subscription_recurring_order","label":"Recurrentes"}]'
```

Si no defines `SUBSCRIPTION_TAGS` o lo dejas vacio, las metricas de suscripcion simplemente no aparecen en el reporte.

---

## Timezone y Cron

El cron de GitHub Actions usa UTC. Ajusta la expresion segun tu zona horaria:

| Hora local deseada | Timezone | Cron UTC |
|---|---|---|
| 5:00 AM | Madrid (CEST, verano) | `0 3 * * *` |
| 5:00 AM | Madrid (CET, invierno) | `0 4 * * *` |
| 7:00 AM | Mexico City (CDT, verano) | `0 12 * * *` |
| 7:00 AM | Mexico City (CST, invierno) | `0 13 * * *` |
| 8:00 AM | Nueva York (EDT, verano) | `0 12 * * *` |
| 8:00 AM | Nueva York (EST, invierno) | `0 13 * * *` |
| 9:00 AM | Buenos Aires (ART) | `0 12 * * *` |

Edita la linea `cron:` en `.github/workflows/daily-report.yml`.

> **Nota:** GitHub Actions puede tener un retraso de hasta 15 minutos en los cron jobs.

---

## Probar el Reporte

1. Ve a tu repositorio en GitHub
2. Haz clic en la pestana **Actions**
3. Selecciona el workflow **Daily Report**
4. Haz clic en **Run workflow** > **Run workflow**
5. Espera a que termine y revisa el canal de Slack

Si falla, haz clic en el job para ver los logs y el mensaje de error.

---

## Errores Comunes

| Error | Causa | Solucion |
|---|---|---|
| `Missing required env var: X` | Falta un secreto en GitHub | Agrega el secreto en Settings > Secrets |
| `Meta API error: 190` | Token de Meta expirado o invalido | Genera un nuevo token (usa System User para que no expire) |
| `Meta API error: 100` | Ad Account ID incorrecto | Verifica el ID en Business Settings > Ad Accounts |
| `Shopify token exchange failed: 401` | Client ID/Secret incorrectos | Verifica las credenciales en el Dev Dashboard de Shopify |
| `Shopify API error: 404` | Dominio de tienda incorrecto | Verifica que el dominio `.myshopify.com` es correcto |
| `Slack webhook error: 403/404` | Webhook URL invalida o desactivada | Crea un nuevo webhook en api.slack.com |
| `Claude diagnosis failed` | API key de Anthropic invalida o sin saldo | Verifica la key en console.anthropic.com |
| `SUBSCRIPTION_TAGS is not valid JSON` | Formato JSON incorrecto | Verifica que el JSON es valido (usa un validador online) |
