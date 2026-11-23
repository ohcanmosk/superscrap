# CLAUDE.md

Guía para trabajar en este repo. La app y el código están en castellano (rioplatense): mantené ese idioma en textos de la UI, comentarios y commits.

## Qué es

**SuperScrap**: web app (PWA) sin build ni dependencias que compara precios de **Coto**, **Dia** y **Carrefour** (Argentina) y muestra los 4 productos más baratos de cada súper (`TOP_N` en `index.html`), con y sin promo, según el día de la semana (con el mejor descuento del día para los medios de pago del usuario: Mercado Pago, MODO, bancos…).

Pestañas (categorías fijas, definidas en `categorias.js`):
- 🥛 **Leches** (enteras/descremadas, con filtros propios de tipo: larga vida, sachet, especiales).
- ☕ **Café molido**: solo los que dicen *tostado* en el nombre (o marcas que solo venden tostado: Café Martínez, Seattle's Best, Happy Day). Excluye *torrado*, cápsulas, saquitos e instantáneo. Los "Café Molido ... Intenso" sin aclarar se ocultan porque suelen ser torrados.
- 🐟 **Atún en lomitos**: solo "lomitos"/"lomos", sin desmenuzado.
- 🌱 **Milanesas de soja Granja del Sol**.
- 🧻 **Papel higiénico hoja simple** y **doble hoja** (dos pestañas, para no comparar una contra otra): precio **por metro**. Solo entran los que dicen en el nombre "simple"/"S/H" o "doble hoja"/"D/H" ("doble textura" no cuenta). Cada producto muestra la cuenta (`p.detalle`, de `parseMetrosDetalle`/`tamanoCoto`): "4 rollos × 30 m = 120 m" o "12 m² según Coto ≈ 120 m". Auditado el 23/11/2026: los 97 papeles dan rollos × metros correctos y, en Coto, el precio por m² coincide con los metros del nombre.
- 🔎 **Buscar**: búsqueda libre del usuario con la misma lógica (ver abajo).
- 💳 **Descuentos**: descuentos con billeteras y bancos que publica cada súper, por día (ver "Descuentos con medios de pago").

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Toda la app: HTML + CSS + JS en un solo archivo. Fetch, parseo, cálculo de precios, render y localStorage. |
| `historico.html` | Página aparte (botón "📈 Histórico" del header): lee `data/historial/<cat>.json` y muestra, para 7/14/40 días, lo más barato por kg/L de cada súper día por día (sin promo / con promo), una tabla por día de la semana y el detalle de un producto. Gráficos SVG propios (sin librerías) con tooltip. |
| `comun.js` | Funciones compartidas por `index.html`, `historico.html` y `scrape.js`: `norm`, `parseSize`, `parseDiaTeaser`, `cleanCarrefourTeaser`, `vtexOffer`, `cotoOffer`, `matchesCat`. Cambiar acá la lectura de precios/promos la cambia en la app y en el histórico. Tamaño por categoría con `tamano(name, c)` (`c.medida === "metros"` → `parseMetros`; `c.porDefecto` → 1 L en leches) y `tamanoCoto` (papel de Coto: `sku.referencePrice` es precio por m², metros = precio ÷ ref × 10). |
| `categorias.js` | Config compartida de categorías (URLs de Dia/Coto/Carrefour, filtros regex, unidad, archivos de snapshot) y de "mi zona" (`ZONA`: tiendas cuyo stock se mira). La cargan `index.html` (`window.SuperScrapCats`) y `scrape.js` (`require`). |
| `promos.js` | Baja los descuentos con medios de pago de Coto, Dia y Carrefour y los normaliza (`bajarPromos`). Lo llama `scrape.js`; también `node promos.js` solo. |
| `logos/` | Logos de billeteras/bancos (PNG chicos con fondo blanco, sacados de coto.com.ar). Los referencia `MEDIOS[k].logo` en `comun.js`. |
| `scrape.js` | Lo corre GitHub Actions (`.github/workflows/precios.yml`, 7:17 y 13:17 AR). Baja todas las categorías y guarda versiones recortadas en `data/*.json` + `data/meta.json` + `data/dia-stock.json` (stock de las tiendas Dia de la zona). |
| `server.js` | Servidor local Node 18+ sin dependencias (`iniciar.bat`, puerto 8787). Sirve estáticos y hace de proxy `/proxy?url=` (solo hosts de Dia/Coto/Carrefour) porque Dia y Carrefour no permiten CORS. Único POST permitido: la simulación de compra de Dia (`POST_PATHS`). `/ping` responde `superscrap`. |
| `sw.js` | Service worker: network-first con caché (`superscrap-vN`). **Subí la versión de `CACHE`** si cambiás archivos del shell, y agregá archivos nuevos a `SHELL`. |
| `data/` | Snapshots generados por `scrape.js` (commiteados por el bot). No editar a mano. |

## Cómo correr / probar

```bash
node server.js            # http://localhost:8787 (NO_OPEN=1 para no abrir el navegador, PORT=xxxx para otro puerto)
node scrape.js            # regenera data/*.json (requiere red)
```

No hay tests ni linter. Para verificar: `node --check` sobre `categorias.js`/`scrape.js` (y sobre el `<script>` de `index.html` extraído), y abrir la app con `server.js` revisando cada pestaña.

## Flujo de datos

1. **Orden de fuentes** (`getJSON` en `index.html`): servidor local `/proxy` → directo (Coto permite CORS, Dia no) → snapshot `data/<snap>.json` (solo categorías fijas, solo si la página se sirve por http). Cada intento tiene timeout (`FETCH_TIMEOUT`).
   - Si la página se abre con doble clic (`file://`), se busca el servidor en `LOCAL_SERVER` (`http://localhost:8787`); por eso `server.js` responde `/proxy` y `/ping` con `access-control-allow-origin: *`.
   - **No hay proxies públicos**: allorigins y corsproxy.io dejaron de andar (nov 2026: timeout / piden API key) y los alternativos probados (codetabs, thingproxy, cors.eu.org, cors-anywhere…) también fallan. Sin servidor local, Dia solo sale de los snapshots y la búsqueda libre no puede traer Dia.
   - Coto bloquea a Chrome headless por user-agent: al probar con `--headless`, pasá `--user-agent` de un Chrome normal.
2. **Dia**: API VTEX pública `diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search` — por categoría (`/frescos/leches/...?map=c,c,c`) o por texto (`?ft=...`), máx. 50 resultados (`_from=0&_to=49`), `O=OrderByPriceASC`. Promos en `commertialOffer.Teasers` ("Llevando 2 a $X", "2do al 70%", "3x2", "%") → `parseDiaTeaser`.
3. **Coto**: JSON Endeca `www.coto.com.ar/sitios/cdigi/categoria/...?format=json` — por categoría (`/_/N-xxxx`) o por texto (`?Ntt=...`). Los productos están anidados: `cotoRecords` busca el primer objeto con `@type` y `records`. Precio en `sku.activePrice`, promos en `product.dtoDescuentos` (JSON string, `precioDesc` = precio por unidad con promo).
   **Carrefour**: también VTEX (`www.carrefour.com.ar`, sin CORS). Teasers tipo `PROMO-2do al 50% Max 8 unidades Combinable ...` → `cleanCarrefourTeaser` los recorta a "2do al 50%" e ignora los de Tarjeta/Cuenta Digital Carrefour. `ListPrice` > `Price` = oferta.
4. Se normaliza todo a `{ store, id, sku, name, brand, url, img, size, unit, shelf, list, promos[], hasPromo, tipo, cat, stock }` (`normVtex(p, "dia"|"carrefour")` / `normCoto`). `STORES = ["coto","dia","carrefour"]` define el orden de columnas.
5. **Filtro por categoría** (`matchesCat`): sobre el nombre normalizado (minúsculas, sin acentos) — todos los `include` deben matchear, `exclude` descarta, `brand` (opcional) contra marca o nombre. Coto además puede filtrar por `cotoCategory`.
6. **Precio** (`priceFor`): `one` = pagando 1 unidad ese día; `best` = mejor precio c/u aprovechando promos. Reglas:
   - Descuento con medio de pago (`pagoPara`): el mayor % de las promos de ese súper que valen ese día (`dias`, `desde`/`hasta` contra la fecha del próximo día elegido), en el local u online según `S.donde`, con un medio que el usuario tiene (`S.medios`). Se aplica sobre `one` y `best`. Las `soloSinOferta` (Coto) no aplican a productos con promo u oferta. No se tienen en cuenta tope ni compra mínima (se muestran).
   - Ya no hay descuentos cargados a mano (antes: finde de Coto y Club Dia); `S.cotoWeekend`/`S.club` viejos se borran al cargar.
7. **Orden** (`cmp`): por precio por kg/L (`oneU`/`bestU`) usando el tamaño parseado del nombre (`parseSize`: g, kg, ml, L, packs "3 x 170 g"). Productos sin tamaño conocido (ej. "x 3 Ud.") van al final, ordenados por precio del envase. En Leches, si no dice tamaño se asume 1 L y solo se aceptan envases de 0,5 a 2 L.

## Mi zona (stock por tienda)

Config en `ZONA` de `categorias.js`; el usuario marca tiendas en Configuración → Mi zona (`S.zona.on`, clave `"<store>:<id>"`) y activa "Solo con stock en mi zona" (`S.zona.only`). `p.stock` = `{ <id tienda>: true/false | unidades }`.
- **Coto**: cada producto trae `product.sDisp_<sucursal>`; `"1004"` = hay stock (así lo lee Coto Digital), `"1001"` = no. Solo ~36 sucursales (Hiper): Morón 215, Ciudadela 129, Moreno 219. Castelar (199) no se publica; en Ituzaingó no hay Coto. `scrape.js` guarda esos campos en el snapshot.
- **Dia y Carrefour (VTEX)**: cada local con "retiro en tienda" es un seller (`ardiaprodNNNN`, `carrefourarNNNN`; se listan con `/api/checkout/pub/pickup-points?geoCoordinates=long;lat`, el prefijo del id del punto es el seller). Compra simulada (`SIMULATION[store]`, POST, hasta 50 ítems, `quantity: 99`) **sin `postalCode`**: devuelve las unidades de ese local, con tope `STOCK_CAP` (Dia 24, Carrefour 50); `availability != "available"` = 0. Con código postal responde `cannotBeDelivered` (no hace envíos) y no sirve. Sin servidor local se usa `data/<súper>-stock.json`.
  - Dia: locales de Ituzaingó (2), Castelar (2) y Morón (4; Independencia 173 da casi todo 0, apagado por defecto). Williams Morris 3924 (Castelar) se sacó a pedido del usuario.
  - Carrefour: solo los Hiper que venden online son sellers (Villa Tesei 0010 —sacado a pedido del usuario—, Moreno 0021, San Justo 0012; los dos últimos apagados por defecto, así que Carrefour no filtra por stock salvo que se activen). El Hiper Ituzaingó (Ratti, 0036) y los Express solo son puntos de retiro de `carrefourar0899` y no publican stock ("no encontrado").
- Las etiquetas se agrupan por `loc` (localidad): "Castelar: 1 de 3 locales"; el detalle por local va en `title` (hover o tocar).
- `hasZonaStock`: true si alguna tienda marcada tiene; false si se sabe que ninguna; null si no se sabe (no se oculta).

## Histórico

- `scrape.js` agrega una toma a `data/historial/<cat>.json` **solo en GitHub Actions** (`GITHUB_ACTIONS=true`) o con `node scrape.js --historial`, para que las corridas locales no generen conflictos con los commits del bot. Guarda 60 días (`HIST_DIAS`).
- Formato: `{ v, productos: { "<súper>:<id>": [nombre, MARCA, súper, tamaño, unidad] }, tomas: [{ t: ISO, d: "YYYY-MM-DD" (hora AR), p: { "<súper>:<id>": [sin promo, lista, mejor c/u con promo|null, unidades de la promo|null, texto|null] } }] }`.
- Solo productos que pasan el filtro de la categoría (`matchesCat`, y en leches `cotoCategory` + envases de 0,5 a 2 L). La búsqueda libre no tiene histórico.
- "Con promo" = mínimo entre precio sin promo y la mejor promo c/u (incluye descuentos de 1 unidad de Coto como "35%Dto"). No incluye los descuentos con medios de pago.
- `historico.html` agrega por día (menor precio del día de cada producto) y por súper (menor precio por kg/L; los productos sin tamaño conocido no entran en esa comparación pero sí en "Un producto"). Respeta las marcas excluidas de la configuración de la app.
- Colores de los súper en el histórico validados con el script de la skill dataviz (claro: `#0a4ea2`, `#d6001c`, `#00876a`; oscuro: `#5a95ec`, `#ef4d5f`, `#1fa088`).

## Descuentos con medios de pago

- **Fuentes** (`promos.js`, ninguna es oficial):
  - Coto: `coto.com.ar/rest/model/atg/actors/cProfileActor/getPromocionesMulticanal` (JSON, CORS abierto). `promocionesSucursalesFisicas` = local, `promocionesDigitales` = online. `dias[].id`: 1 = domingo … 7 = sábado; vacío = todos. El medio sale de `descripcion` + `icono` (`logo_mercadopago.png`…).
  - Dia: la página `/medios-de-pago-y-promociones` trae las tarjetas como JSON (`"cards":[...]`, con `daysToShow`, `availableOn`, `active`, `terms`). Hay más de un bloque: se usa el **último** (el de la página de promos) y se descartan las vencidas leyendo fechas de `terms` (`parseVigencia`). %, tope y mínimo salen del texto legal.
  - Carrefour: Master Data pública `/api/dataentities/BP/search` (header `accept: application/vnd.vtex.ds.v10+json`, `_where=active=true AND active_to>…`) + `FB` (bancos, por `idBank`: ahí se ve que una promo sin nombre de medio es de Mercado Pago). `hyper/market/express` = local; `maxi` aparte (mayorista); `ecommerce` = online.
- Formato normalizado (`data/promos.json`): `{ id, super, medio, banco, pct, cuotas, dias[], local, online, tiendas, tope, minimo, desde, hasta, cuando, soloSinOferta, acumulable, resumen, legal, url }`. `banco` solo cuando hace falta otro medio además (ej. MODO desde la app de Supervielle).
- `MEDIOS` / `clasificarMedio(...textos)` en `comun.js`: catálogo y detección por regex (prioridad billetera > banco > beneficio > "todos los medios" > tarjeta). Para un medio nuevo: agregalo a `MEDIOS` (y su logo a `logos/` si hay).
- `scrape.js` la corre en cada actualización; si un súper falla, conserva sus promos anteriores vigentes. `bajarPromos` saca vencidas, sin % ni cuotas, y repetidas.
- La pestaña 💳 Descuentos (`renderPromos`) elige medios (`S.medios`, chips con logo) y lista por día desde hoy (+ "Todos los días"), filtros `S.pf` (mis medios/todos, súper, cuotas) y `S.donde`. El detalle de cada promo (texto legal) va en un `<details>`.

## Búsqueda libre

- Se manda a Dia y Carrefour (`ft=`) y Coto (`Ntt=`) lo que escribió el usuario, sin las palabras con `-`.
- Después se filtra: el nombre tiene que contener **todas** las palabras (plural simple: "milanesas" → "milanesa").
- **Quitar palabras**: campo aparte ("Quitar palabras") o `-palabra` en la búsqueda (ej. `cafe cabrales -torrado`). Las `-palabras` se mueven a la lista `qExcl` (chips con ✕). Todo producto cuyo nombre tenga alguna queda fuera del análisis (rankings, veredicto y tabla), y se muestra cuántos se quitaron. Agregar o sacar palabras quitadas **no** vuelve a consultar a Dia/Coto: solo re-filtra lo que ya está cargado.
- No tiene snapshot en `data/`, así que en GitHub Pages los resultados de Dia dependen de los proxies públicos (pueden fallar). Con `server.js` funciona siempre.

## Agregar una categoría fija

1. Agregá una entrada en `CATEGORIAS` de `categorias.js` (`label`, `emoji`, `unit`, `dia[]`, `coto`, `carrefour[]`, `include[]`, `exclude`, `brand?`, `snap`). Probá antes las búsquedas en las APIs para ajustar los regex (sin tildes, en minúsculas).
2. `snap` = `{ dia: [un nombre por URL], coto: "nombre", carrefour: [un nombre por URL] }`.
3. Corré `node scrape.js` para generar los `data/*.json` nuevos. La pestaña aparece sola.

## Filtro por marca

En "Todos los productos" hay chips por marca (con cantidad), multi-selección; "Todas" limpia. Solo filtra esa tabla, no los rankings ni el veredicto. Las marcas se agrupan con `brandKey` (sin acentos, sin "La/El/Los/Las" al principio) porque Dia y Coto las escriben distinto. La selección se guarda por categoría (`brands` / `brands:<cat>`) y se limpia al hacer una búsqueda nueva.

## Estado en el navegador (localStorage, prefijo `superscrap:`)

- `settings` (medios de pago `medios`, `donde`, filtros de Descuentos `pf`, zona, filtros), `promos` (último `data/promos.json`), `cat` (pestaña actual), `query` (última búsqueda, solo palabras a buscar), `queryExcl` (palabras quitadas), `insitu` (registros "góndola vs online", cada uno con su `cat`; los viejos sin `cat` son de leches).
- Caché de productos por categoría: `products` / `fetchedAt` para leches (claves históricas) y `products:<cat>` / `fetchedAt:<cat>` para el resto (incluye `busqueda`).
- Los productos guardados de versiones viejas tenían `liters`; `loadProducts` los migra a `size`/`unit`.

## Convenciones

- Sin dependencias ni paso de build: JS plano en el navegador y Node 18+ (usa `fetch` nativo).
- Escapá siempre con `esc()` lo que venga de las APIs antes de meterlo en `innerHTML`.
- Si cambiás campos que usa la app de Coto o Dia, revisá `COTO_KEEP` / `trimDia` en `scrape.js` para que los snapshots los incluyan.
- `server.js` solo hace proxy a los hosts de `ALLOWED_HOSTS`; no lo abras a cualquier URL.
