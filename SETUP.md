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
| Entrega | **11:00 Europe/Madrid** = 11 h post-cierre | medido en los logs, ver abajo |
| Deriva medida a 11.1-12.8 h | −0.00 % a −0.18 % | logs vs. consolidado |
| Retraso del cron de GitHub | +2 h 05 min a +3 h 49 min | 7 ejecuciones |

**Las dos monedas no coinciden.** Meta gasta en USD y la tienda factura en EUR. El
gasto, el CPO y el revenue atribuido salen en USD; el revenue neto y el AOV en EUR.
Solo el gasto se convierte a EUR, para poder cruzarlo con el revenue en el MER-ROAS.

---

## Timezone, cierre del dia y por que la entrega es a las 11:00

Meta **sigue agregando gasto durante horas** despues de que el dia cierra en la
timezone de la cuenta publicitaria. Publicar antes de tiempo da un gasto
subestimado, que infla ROAS y MER. Preferimos no publicar a publicar mal.

1. **Cierre del dia**: la cuenta esta en `Europe/Madrid`, asi que el dia cierra a
   las 00:00 de Madrid — 22:00 UTC en verano, 23:00 UTC en invierno.
2. **Hora mas temprana defendible**: cierre + `MIN_HOURS_AFTER_CLOSE` (3 h) =
   **03:00 Madrid**.
3. **Entrega real**: **11:00 Madrid**, o sea **11 h despues del cierre**.

Aqui hubo suerte: la cuenta de Meta, la tienda y quien lee el reporte estan **los
tres en `Europe/Madrid`**, asi que el cambio de horario se cancela solo y las 11:00
son siempre 11 h post-cierre, en enero igual que en julio.

> **Corregido el 2026-08-17.** Este documento y el pie del reporte decian **09:00
> Madrid**, pero la entrega llevaba semanas saliendo a las **11:00**: cron-job.org
> dispara a las `09:00 UTC`, no a las 09:00 de Madrid, y todos los logs lo firman
> (`[Freshness] ... cerro hace 11.01 h`, sin variacion entre dias).
>
> Se decide **quedarse a las 11:00** y corregir los textos, no al reves: 11 h
> post-cierre caen dentro de la franja donde la deriva de consolidacion **si esta
> medida** (11.1-12.8 h, error maximo −0.18 % y ya plano), mientras que las 9 h que
> se documentaban estaban extrapoladas. La hora que estabamos publicando era mejor
> que la que creiamos tener.
>
> Si algun dia se quiere adelantar de verdad la entrega, hay que **cambiar la
> timezone del job en cron-job.org a `Europe/Madrid`** (hoy va en UTC) y medir
> antes la deriva a esa hora con el probe de Meta, no bajarla por corazonada.

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
| Commit vacio los dias 1 y 15 | `keepalive.yml` | Que GitHub no apague el respaldo (ver abajo) |
| Como maximo 2 avisos por dia | `ALERT_ON_FAILURE` | Que un fallo no llene el canal de mensajes iguales |

**Politica de avisos.** Los tres disparos del dia comparten diagnostico: si falla la
entrega, los respaldos fallan igual, y tres avisos identicos solo entierran el
mensaje. Avisan **la entrega y el respaldo final**; el intermedio reintenta en
silencio. El workflow lo decide en el paso *"Decidir si este intento avisa en
Slack"* y lo pasa en `ALERT_ON_FAILURE`; `ATTEMPT_LABEL` sale en el titulo del
mensaje (`Reporte Diario FALLIDO — respaldo final`) para que dos avisos del mismo
dia no parezcan un duplicado. Suprimir el aviso **no** suprime el `exit 1`: la
ejecucion sigue en rojo en Actions.

**Que se reintenta y que no.** Esperar solo sirve si el fallo se cura solo:

- **Se reintenta**: `402` (tienda no disponible), `408`, `425`, `429`, `5xx` y
  errores de red.
- **Falla a la primera**: `401` (token revocado), `403` (falta scope), `404`
  (dominio mal). Insistir no los arregla y solo retrasa el aviso.

Si un `402` era una congelacion real por facturacion, los reintentos se gastan en
~1 min y el aviso de Slack ya dice que mirar el plan en el admin de Shopify.

### La red de seguridad y el jitter

El bloque `schedule` volvio al workflow, pero **no es la entrega**: esa sigue
siendo el `workflow_dispatch` de cron-job.org a las 11:00 Madrid. El jitter de
2-3 h que descarto el cron de GitHub para la entrega **da igual para un
backstop**: solo se le pide que ocurra el mismo dia.

El primer paso consulta si ya hubo una ejecucion correcta hoy y, si la hubo,
termina sin publicar nada (queda en verde). Verificado en un runner el
2026-08-13: `Ejecuciones correctas hoy (2026-08-13): 2` → no publico nada. Asi
que en un dia normal estos dos disparos no mandan ningun duplicado al canal.

### Por que existe `keepalive.yml`

GitHub **desactiva los workflows con `schedule` de los repos publicos tras 60 dias
sin actividad**. La trampa: "actividad" son *commits*, no ejecuciones. Este repo
corre el reporte a diario y aun asi el contador avanza. Sin nada que lo evite, el
backstop se habria apagado solo, en silencio, y justo es lo que cubre una caida
como la del 2026-08-13.

`keepalive.yml` hace un commit vacio los dias **1 y 15** de cada mes: hueco maximo
~31 dias, muy por debajo de los 60. Como el propio keepalive tambien es un
`schedule`, se mantiene vivo a si mismo. Verificado el 2026-08-13 disparandolo a
mano: commit `20dcca0` empujado por `github-actions[bot]`.

Los commits `chore: keepalive` en el historial son eso y solo eso; se pueden
ignorar.

> Alternativa descartada: **poner el repo en privado** elimina la regla de raiz
> (solo aplica a repos publicos). Se decidio mantenerlo publico. Si algun dia se
> cambia de idea, ojo: el PAT de cron-job.org necesita scope `repo` completo —
> con `public_repo` la entrega diaria empezaria a dar 404.

### Probes de diagnostico

```bash
# Estado de la tienda: distingue un 402 de un token revocado o un dominio mal
gh workflow run shopify-probe.yml --ref main -f probe_date=2026-08-12

# Frescura de Meta
gh workflow run meta-freshness-probe.yml --ref main
```

Ninguno de los dos escribe en Slack. `shopify-probe.js` traduce cada status HTTP
a la accion que toca, que es justo lo que no se podia deducir del log del fallo.

Los dos aceptan `-f api_version=...` para probar una version de API **contra las
cuentas reales antes de fijarla** en el codigo (ver "Versiones de API" mas abajo).

---

## Incidente 2026-08-15 — el falso fallo de tokens

Del 15 al 17 de agosto el canal recibio **tres mensajes identicos al dia**:

> :warning: *Lyssoderma — Reporte Diario* — No se obtuvieron datos de Meta ni de
> Shopify. Verifica que los tokens de acceso siguen activos.

**Los tokens estaban perfectos y las dos APIs respondian.** El mensaje era una
conjetura del codigo, y mando a revisar credenciales sanas durante tres dias.

**Lo que decia el log** (ejecuciones `31875899555`, `31941197416`, `32013082304`):

```
[Shopify] Got 0 total orders      <- 200 con lista vacia, sin un solo reintento
[Meta] Got 0 rows                 <- 200 con data: []
[Debug] Meta rows: 0, Shopify rows: 0
Both APIs returned 0 rows — sending warning to Slack
```

Como leerlo:

- `fetchWithRetry` **lanza ante cualquier status de error**. Un token revocado
  (401), una tienda congelada (402) o un scope que falta (403) habrian salido por
  el `catch` con otro mensaje. Si el flujo llego a contar filas, hubo `200`.
- Tampoco aparece `[Freshness] Usando fallback META_ACCOUNT_TIMEZONE`, que solo se
  calla cuando `fetchAdAccountInfo` devolvio 200 con `timezone_name`: prueba
  directa de que **el token de Meta leia la cuenta sin problema**.

**Lo que pasaba de verdad:** se acabo la actividad. El ultimo reporte correcto
(14-ago, del dia 13) ya traia `Meta Raw spend: 0.00` y `0 orders`; los ultimos
pedidos son del 12-ago. Confirmado con los dos probes el 17-ago:

```
[Probe] GET /shop.json -> 200 OK
[Probe] Tienda: SKIN+ EUR | plan=professional | moneda=EUR | tz=Europe/Madrid
[Probe] GET /orders/count.json (2026-08-16 UTC) -> 200: {"count":0}
[Probe] Cuenta: EASY_02 | tz=Europe/Madrid | moneda=USD
[Probe] Sin filas para 2026-08-16
```

Tienda viva en plan `professional`, cuenta de Meta legible, cero pedidos y cero
entrega de ads. **Un hecho de negocio, no una averia**: sin ads no hay trafico y
sin trafico no hay pedidos.

**Por que fueron tres mensajes y no uno.** El camino de "0 filas" hacia `exit 1`. El
guard del backstop solo busca ejecuciones **correctas** del dia, asi que no veia
ninguna, dejaba correr los dos respaldos, y cada uno republicaba el mismo aviso.

**Lo que se cambio:**

1. Cero filas con 200 en las dos fuentes ya **no es un fallo**: se publica el
   reporte en ceros, con una nota que dice que las dos APIs respondieron bien y que
   no es problema de tokens. Sale con `exit 0`, asi que los respaldos se saltan y
   solo hay **un mensaje al dia**.
2. El diagnostico de Claude recibe el contexto de "dia parado" para no inventarse
   lecturas de embudo sobre ceros.
3. Politica de avisos de como maximo dos (ver arriba).
4. `src/report.test.js` cubre el caso: `calculateMetrics([], [], rate)` sin `NaN` y
   el reporte en ceros renderizado entero.

> **La regla que queda:** un cuerpo vacio con `200` es un **dato**, no un fallo.
> Solo un status HTTP de error justifica hablar de tokens. Si un mensaje del canal
> te manda a revisar credenciales, comprueba primero que hubo un status de error de
> verdad — con `gh run view <id> --log` o con los probes.

---

## Versiones de API

| Que | Fijada | Antes | Ojo |
|---|---|---|---|
| `SHOPIFY_API_VERSION` | `2026-07` | `2024-10` | La REST Admin API es **legacy** desde octubre de 2024 y sus endpoints se retiran por version. El reporte usa `orders.json`. |
| `META_API_VERSION` | `v26.0` | `v21.0` | Meta garantiza ~2 anos por version. La `v21.0` que habia **se retira el 2027-01-21**. |

Las dos se subieron el **2026-08-17**, despues de probarlas contra las cuentas
reales: Shopify `2026-07` sirvio `orders.json` con los mismos `fields` del reporte
(200, pedidos del 11-ago) y Meta `v26.0` devolvio insights de ese dia (spend 194.59
USD, 3081 impresiones). Las anteriores estaban las dos fuera o al borde de soporte;
`2024-10` funcionaba solo porque Shopify degrada en silencio a una version
soportada, que es la clase de cosa que se rompe sin avisar.

Ninguna de las dos se sube a ciegas. El procedimiento es probar la candidata contra
las cuentas reales, que para eso los probes aceptan `api_version`, y solo despues
fijarla en `config.js`:

```bash
gh workflow run shopify-probe.yml --ref main -f api_version=2026-07 -f probe_date=2026-08-11
gh workflow run meta-freshness-probe.yml --ref main -f api_version=v26.0 -f probe_date=2026-08-11
```

`shopify-probe.js` repite **la llamada exacta del reporte** (`orders.json` con sus
mismos `fields`) y sale en rojo si esa version ya no la sirve. Si la version mas
nueva ya no trae REST, fijar la ultima que si funcione y planificar aparte la
migracion a GraphQL.

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
- **Schedule**: modo *Custom*, `0 9 * * *` (MINUTES con **un solo valor**; si queda
  en *every* dispara 60 veces al dia). **La timezone del job esta en UTC**, asi que
  el disparo entra a las 09:00 UTC = **11:00 de Madrid** en verano y 10:00 en
  invierno. Comprobado en todas las ejecuciones: arrancan a las `09:00:4x` UTC.
  Ponerla en `Europe/Madrid` moveria la entrega a las 09:00 reales y la dejaria a
  9 h post-cierre — no lo hagas sin medir antes la deriva a esa hora.
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
| `REPORT_TIME_LABEL` | `11:00 (Madrid)` | Hora **real** de envio, en el pie |
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
2. Dispararlo 1 h y 2 h antes de la hora de entrega durante ~5 dias.
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
