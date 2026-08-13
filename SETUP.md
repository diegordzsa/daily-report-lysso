# Reporte Diario — Lyssoderma

Combina datos de **Meta Ads** y **Shopify**, genera un diagnostico con **Claude** y
lo publica en Slack (`#reporte-diario-lysso`).

---

## Ficha de la tienda

Todo lo de esta tabla esta **medido contra las APIs** el 2026-07-29, no copiado de
otro repo. Si algo de aqui cambia, hay que volver a medirlo, no adivinarlo.

| Dato | Valor | Como se midio |
|---|---|---|
| Cuenta Meta | `EASY_02` | `GET /act_<id>?fields=name` |
| TZ cuenta Meta | `Europe/Madrid` (**con DST**) | `timezone_name` |
| Offset en verano | UTC+2 | `timezone_offset_hours_utc` |
| Moneda Meta | **USD** | `currency` |
| Tienda Shopify | `SKIN+ EUR` / `lyssoderma.com` | `GET /shop.json` |
| TZ Shopify | `Europe/Madrid` | `iana_timezone` |
| Moneda Shopify | **EUR** | `currency`, `money_format` |
| Cierre del dia | 00:00 Madrid = 22:00 UTC verano / 23:00 UTC invierno | calculado |
| `MIN_HOURS_AFTER_CLOSE` | 3 | politica |
| Entrega | **09:00 Europe/Madrid** = 9 h post-cierre | decidido, ver abajo |
| Deriva medida a 11.1-12.8 h | −0.00 % a −0.18 % | logs vs. consolidado |
| Retraso del cron de GitHub | +2 h 05 min a +3 h 49 min | 7 ejecuciones |

**Las dos monedas no coinciden.** Meta gasta en USD y la tienda factura en EUR. El
gasto, el CPO y el revenue atribuido salen en USD; el revenue neto y el AOV en EUR.
Solo el gasto se convierte a EUR, para poder cruzarlo con el revenue en el MER-ROAS.

---

## Timezone, cierre del dia y por que la entrega es a las 09:00

Meta **sigue agregando gasto durante horas** despues de que el dia cierra en la
timezone de la cuenta publicitaria. Publicar antes de tiempo da un gasto
subestimado, que infla ROAS y MER. Preferimos no publicar a publicar mal.

1. **Cierre del dia**: la cuenta esta en `Europe/Madrid`, asi que el dia cierra a
   las 00:00 de Madrid — 22:00 UTC en verano, 23:00 UTC en invierno.
2. **Hora mas temprana defendible**: cierre + `MIN_HOURS_AFTER_CLOSE` (3 h) =
   **03:00 Madrid**.
3. **Entrega elegida**: **09:00 Madrid**, o sea **9 h despues del cierre**, el
   triple del minimo.

Aqui hubo suerte: la cuenta de Meta, la tienda y quien lee el reporte estan **los
tres en `Europe/Madrid`**, asi que el cambio de horario se cancela solo y las 09:00
son siempre 9 h post-cierre, en enero igual que en julio. Por eso el cron externo
se configura **en la zona `Europe/Madrid`, nunca en UTC**: en UTC habria que
moverlo dos veces al ano (07:00 verano / 08:00 invierno).

En los dos dias del ano en que cambia la hora la entrega cae a 8 h post-cierre
(salto de primavera) o 10 h (salto de otono). Las dos siguen muy por encima del
minimo de 3 h.

**Lo que no esta medido:** la deriva de consolidacion se midio entre 11.1 h y
12.8 h post-cierre, donde el error es de −0.18 % como maximo y ya plano. Las 9 h de
la entrega estan **extrapoladas** desde ahi, no medidas directamente. Si en algun
momento se quiere adelantar la entrega, hay que medir primero con un probe (ver
abajo), no bajarla por corazonada.

---

## El guard de frescura

`src/report.js` comprueba, **antes de pedir cualquier dato**, cuantas horas lleva
cerrado el dia que va a reportar. Lee `timezone_name` de la API de Meta en cada
ejecucion (con `META_ACCOUNT_TIMEZONE` como fallback si la llamada falla).

Si no llega a `MIN_HOURS_AFTER_CLOSE`, avisa en Slack y sale con `exit 1`, para que
se vea en rojo en Actions. Ejemplo real de una ejecucion a las 00:26 Madrid:

```
[Freshness] 2026-07-29 cerro hace 0.45 h en Europe/Madrid (minimo requerido: 3 h)
Datos de Meta sin consolidar: solo han pasado 0.4 h desde el cierre, el minimo es 3 h
##[error]Process completed with exit code 1
```

El calculo del instante de cierre esta en `src/freshness.js` y usa
`Intl.DateTimeFormat`, correcto en los cambios de horario.

---

## Reintentos y red de seguridad

**Incidente del 2026-08-13.** El reporte fallo con
`Shopify API error: 402 Payment Required — {"errors":"Unavailable Shop"}`. La
llamada murio a los 265 ms, en el primer intento. Horas despues la misma tienda,
con el mismo token y el mismo dominio, respondia `200 OK` (plan `professional`,
3 ordenes el 12-ago). O sea: **hueco transitorio de Shopify, no fallo de token ni
de codigo**. Lo que convirtio un parpadeo en un reporte perdido fue que no habia
ningun reintento en ninguna parte.

Ahora hay tres capas, de la mas barata a la mas lenta:

| Capa | Donde | Cubre |
|---|---|---|
| Backoff exponencial, 6 intentos (~1 min) | `src/http.js` | Huecos de segundos a un minuto |
| Mensaje de Slack con *que hacer* | `src/http.js` → `explainHttpError` | Que el aviso sea accionable |
| Disparos de respaldo ~12:00 y ~15:00 Madrid | `daily-report.yml` (`schedule`) | Caidas de horas |

**Que se reintenta y que no.** Esperar solo sirve si el fallo se cura solo:

- **Se reintenta**: `402` (tienda no disponible), `408`, `425`, `429`, `5xx` y
  errores de red.
- **Falla a la primera**: `401` (token revocado), `403` (falta scope), `404`
  (dominio mal). Insistir no los arregla y solo retrasa el aviso.

Si un `402` era una congelacion real por facturacion, los reintentos se gastan en
~1 min y el aviso de Slack ya dice que mirar el plan en el admin de Shopify.

### La red de seguridad y el jitter

El bloque `schedule` volvio al workflow, pero **no es la entrega**: esa sigue
siendo el `workflow_dispatch` de cron-job.org a las 09:00 Madrid. El jitter de
2-3 h que descarto el cron de GitHub para la entrega **da igual para un
backstop**: solo se le pide que ocurra el mismo dia.

El primer paso consulta si ya hubo una ejecucion correcta hoy y, si la hubo,
termina sin publicar nada (queda en verde). Verificado en un runner el
2026-08-13: `Ejecuciones correctas hoy (2026-08-13): 2` → no publico nada. Asi
que en un dia normal estos dos disparos no mandan ningun duplicado al canal.

### Probes de diagnostico

```bash
# Estado de la tienda: distingue un 402 de un token revocado o un dominio mal
gh workflow run shopify-probe.yml --ref main -f probe_date=2026-08-12

# Frescura de Meta
gh workflow run meta-freshness-probe.yml --ref main
```

Ninguno de los dos escribe en Slack. `shopify-probe.js` traduce cada status HTTP
a la accion que toca, que es justo lo que no se podia deducir del log del fallo.

---

## Por que no hay cron de GitHub (para la entrega)

**El scheduler de GitHub Actions no sirve para una hora fija.** Medido en este
repo, 7 ejecuciones del cron `0 7 * * *` entre el 23 y el 29 de julio de 2026:

| Fecha | Arranque real UTC | Retraso |
|---|---|---|
| 07-23 | 09:29:36 | +2 h 29 min |
| 07-24 | 09:26:53 | +2 h 26 min |
| 07-25 | 09:05:31 | +2 h 05 min |
| 07-26 | 09:20:22 | +2 h 20 min |
| 07-27 | 10:49:22 | **+3 h 49 min** |
| 07-28 | 09:41:33 | +2 h 41 min |
| 07-29 | 09:43:52 | +2 h 43 min |

Casi dos horas de diferencia entre el dia mas puntual y el mas tarde, sin patron.
Por eso **la entrega** la dispara cron-job.org por `workflow_dispatch`. El
`schedule:` que hay en el workflow es solo la red de seguridad descrita arriba, a
otras horas y con un guard que impide duplicados.

### Disparo externo (cron-job.org)

- **Nombre**: `Lysso reporte diario`
- **URL**: `https://api.github.com/repos/diegordzsa/daily-report-lysso/actions/workflows/daily-report.yml/dispatches`
- **Method**: `POST`
- **Body**: `{"ref":"main"}`
- **Headers**:
  - `Accept: application/vnd.github+json`
  - `Authorization: Bearer <PAT existente>`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `Content-Type: application/json`
- **Schedule**: modo *Custom*, timezone **`Europe/Madrid`**, `0 9 * * *`
  (MINUTES con **un solo valor**; si queda en *every* dispara 60 veces al dia)
- **Respuesta correcta**: `204 No Content`
  · `401` = token mal copiado · `403` = falta permiso *Actions: Read and write*
  · `404` = URL con errata
- Activar **aviso por email al fallar**: sin cron de GitHub no hay red de seguridad.

Se reutiliza el PAT que ya existe en cron-job.org, con acceso a todos los repos.
No hace falta crear uno nuevo.

---

## Secretos requeridos

Son **7**, en *Settings > Secrets and variables > Actions*:

| Secreto | Notas |
|---|---|
| `STORE_NAME` | Nombre que aparece en el reporte |
| `META_ACCESS_TOKEN` | Token de System User (no expira). Permiso `ads_read` |
| `META_AD_ACCOUNT_ID` | Numerico, sin el prefijo `act_` |
| `SHOPIFY_STORE_DOMAIN` | `xxx.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Token **offline** (`shpat_...`), ver abajo |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` |
| `SLACK_WEBHOOK_URL` | Incoming webhook del canal `#reporte-diario-lysso` |

### Sobre el token de Shopify

La app de Shopify y la tienda estan en **organizaciones distintas**, asi que el
grant `client_credentials` **no funciona** aqui. El token es uno *offline* obtenido
por authorization code grant:

1. El dueno de la tienda abre la URL de autorizacion y aprueba la app.
2. Devuelve la URL de callback, que trae un parametro `code`.
3. `SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=... SHOPIFY_STORE_DOMAIN=... node exchange-token.js <code>`
4. El token que imprime se guarda como `SHOPIFY_ACCESS_TOKEN`.

Los tokens offline no caducan, pero si se revoca la app hay que repetir el proceso.
`SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET` **no** son secretos del repo: solo se
usan en local para ese intercambio puntual.

---

## Variables del workflow

Estan en `.github/workflows/daily-report.yml`, con los valores medidos.

| Variable | Valor | Que hace |
|---|---|---|
| `META_ACCOUNT_TIMEZONE` | `Europe/Madrid` | Fallback si falla la lectura de la API |
| `STORE_TIMEZONE` | `Europe/Madrid` | Decide que dia es "ayer" |
| `MIN_HOURS_AFTER_CLOSE` | `3` | Horas minimas tras el cierre para publicar |
| `REPORT_TIME_LABEL` | `9:00 (Madrid)` | Hora **real** de envio, en el pie |
| `STORE_CURRENCY` / `_CODE` | `€` / `EUR` | Moneda de la tienda (revenue, AOV) |
| `AD_CURRENCY` / `_CODE` | `$` / `USD` | Moneda de la cuenta de ads (gasto, CPO) |
| `STORE_LOCALE` | `es-ES` | Formato de numeros (`1.234,56`) |
| `SUBSCRIPTION_TAGS` | _(sin usar)_ | JSON de tags de suscripcion, si aplica |

`DRY_RUN=1` imprime el reporte en el log en vez de publicarlo — util para probar
sin duplicar mensajes en el canal.

---

## Probar

```bash
# Sintaxis
for f in src/*.js; do node --check "$f"; done

# Pipeline completo sin publicar en Slack
gh workflow run daily-report.yml --ref main -f report_date=2026-07-28
```

Para validar la autenticacion del cron externo, dispara el workflow desde
cron-job.org con **Run now** y comprueba que responde `204`. Ten en cuenta que eso
**si** publica un reporte en Slack; si prefieres no duplicar, monta antes un
workflow de probe que no escriba en Slack.

---

## Si se quiere adelantar la hora

No bajarla a mano. El procedimiento es:

1. Montar `meta-freshness-probe.yml` (`workflow_dispatch`, solo loguea, nada de
   Slack) que pida el gasto del dia anterior y lo escriba en el log.
2. Dispararlo 1 h y 2 h antes de las 09:00 durante ~5 dias.
3. Cruzar cada muestra contra el valor consolidado dias despues.
4. Si el error se mantiene por debajo de ~0.2 %, entonces si bajar la hora y
   `MIN_HOURS_AFTER_CLOSE`. Si se dispara, se queda como esta y se borra el probe.

---

## Errores comunes

| Error | Causa | Solucion |
|---|---|---|
| `Missing required env var: X` | Falta un secreto | Anadirlo en Settings > Secrets |
| Sale en rojo con `[Freshness] ... cerro hace N h` | Se disparo demasiado pronto | Correcto: es el guard. Revisar la hora del cron externo |
| `[Moneda] La cuenta de Meta factura en X` | Cambio la moneda de la cuenta | Actualizar `AD_CURRENCY_CODE` y `AD_CURRENCY` |
| `MER-ROAS: n/d` | Fallo el tipo de cambio | Transitorio. Es intencionado: mejor `n/d` que dividir monedas distintas |
| `Meta API error: 190` | Token de Meta invalido | Regenerar con System User |
| `Shopify API error: 401` | Token offline revocado | Repetir el authorization code grant |
| `Shopify API error: 402 — Unavailable Shop` | Tienda congelada, pausada o hueco transitorio de Shopify | Ya se reintenta ~1 min y hay backstop a las 12:00 y 15:00. Si persiste, mirar Shopify admin > Settings > Plan (factura impagada). Confirmar con `shopify-probe.yml` |
| `Slack webhook error: 400` | Payload invalido | El reporte se trocea en bloques de 2900; revisar el body del error |
