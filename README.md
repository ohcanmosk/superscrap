# SuperScrap

Compara los productos más baratos de **Coto**, **Dia** y **Carrefour** (con y sin promo), según el día de la semana.

**Solo con stock en mi zona** (Ituzaingó, Castelar, Morón): oculta lo que no hay. Muestra el stock por localidad
("Castelar: 1 de 3 locales"; tocando la etiqueta se ve cada local):
- Dia: 2 locales en Ituzaingó, 2 en Castelar y 3 en Morón (unidades hasta 24).
- Coto: Morón (opcional Ciudadela y Moreno). Coto no publica Castelar y en Ituzaingó no hay Coto.
- Carrefour: opcional Hiper Moreno y San Justo (apagados por defecto), hasta 50 u. El Hiper Ituzaingó (Ratti) y los Carrefour Express no publican stock.

Los locales se eligen en Configuración → Mi zona.

Pestañas: 🥛 Leches · ☕ Café molido (sin torrado) · 🐟 Atún en lomitos · 🌱 Milanesas de soja Granja del Sol ·
🧻 Papel higiénico hoja simple · 🧻 Papel higiénico doble hoja · 🔎 Buscar (cualquier producto).
Se ordena por precio por kilo, litro o metro (papel: metros por rollo × rollos) cuando el envase lo indica.

## Cómo usarla

- **Recomendado:** doble clic en `iniciar.bat` (necesita Node 18+). Se abre `http://localhost:8787`.
  El servidor (`server.js`, sin dependencias) solo sirve la página y reenvía los pedidos a Dia, porque la web de Dia no permite consultas directas desde el navegador.
- **Doble clic en `index.html`:** funciona solo si `iniciar.bat` está corriendo (usa ese servidor). Sin servidor, Dia no se puede consultar.

## En el celular

**Opción A: en casa (misma WiFi), con la PC prendida.** Ejecutá `iniciar.bat`; la consola muestra
`Desde el celular (misma WiFi): http://192.168.x.x:8787`. Abrí esa dirección en el celular.
La primera vez Windows puede preguntar si permite a Node en la red: aceptá "Redes privadas".

**Opción B: desde cualquier lado (GitHub Pages, gratis).**
1. Creá un repo **público** en github.com (ej. `superscrap`) y subí todos los archivos de esta carpeta
   (incluida `.github/workflows/precios.yml` y `data/`).
2. En el repo: *Settings → Pages → Source: Deploy from a branch → main / (root)*.
3. *Actions → Actualizar precios → Run workflow* para probar. Después corre solo a las 00:25, 7:17 y 13:17 (hora AR); el catálogo completo, solo a las 7:17.

**Carga sobre los supermercados:** la web nunca consulta a los súper desde el navegador; solo lee lo que baja el robot (una cantidad fija de pedidos por día, con pausas), así no importa cuánta gente la use. En vivo solo con el servidor local (`iniciar.bat`), que no repite un mismo pedido dentro de 1 minuto.
4. Abrí `https://TU-USUARIO.github.io/superscrap/` en el celular y en Chrome tocá ⋮ → *Agregar a pantalla principal*.

En la versión web, Coto se consulta en vivo desde el celular. Dia no permite consultas directas desde el navegador,
así que usa la copia que guarda GitHub dos veces por día (la app indica la hora de esa copia).
La configuración se guarda por dispositivo (los de la PC no pasan al celular).

## De dónde salen los datos

- Dia: API VTEX pública `diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search/frescos/leches/...`
  (precio, precio anterior y promos tipo "Llevando 2 a $X c/u", "2do al 70%", "3x2").
- Coto: JSON Endeca de `coto.com.ar/sitios/cdigi/categoria/...leches/_/N-zpvqr7?format=json`
  (`sku.activePrice` y `product.dtoDescuentos`, con el precio por unidad de la promo).

## Listas de compras

Pestaña **🧾 Listas**: armás listas (se guardan en tu dispositivo) con lo que comprás: qué buscar (con `-palabra` para excluir), marca, tamaño o talle y cantidad. La app busca cada producto en el catálogo completo de Coto, Dia y Carrefour (lo baja el robot de GitHub 1 vez por día), elige el más conveniente en cada súper (o el que fijes) y te dice **a qué súper conviene ir** el día elegido, con el total de cada uno y el detalle, incluyendo promos y tus medios de pago.

## Histórico

Botón **📈 Histórico** (arriba a la derecha): página aparte con los últimos 7, 14 o 40 días. Se puede filtrar por súper, formato (ej. café de 250 g o de 500 g), marca y palabras del nombre.
- Lo más barato de cada súper día por día, sin promo y con promo.
- **¿Qué día de la semana conviene?**: promedio por día de la semana de cada súper, sin promo y con promo, con el día más barato marcado.
- **Un producto**: su precio día por día y qué promo tuvo cada día de la semana.

Los datos los junta el robot de GitHub (3 veces por día) en `data/historial/`, así que el histórico crece solo una vez subido el proyecto.

## Búsqueda libre

Escribí lo que buscás (ej. `cafe cabrales`). Se buscan en Dia y Coto y quedan solo los productos que tienen **todas**
las palabras en el nombre. En **Quitar palabras** cargá lo que no querés (ej. `torrado, capsulas`): los productos que
lo tengan en el nombre no entran en el análisis. También vale escribirlo directo: `cafe cabrales -torrado`.
Cada palabra quitada aparece como chip con ✕ para volver a incluirla, y la app indica cuántos productos se quitaron. En la versión web (GitHub Pages)
la búsqueda en Dia depende de proxies públicos y puede fallar; con `iniciar.bat` funciona siempre.

Las categorías fijas se configuran en `categorias.js`.

## Reglas

- **Descuentos con medios de pago:** en la pestaña 💳 Descuentos elegís qué billeteras y bancos tenés (Mercado Pago, MODO, Cuenta DNI, Naranja X…). Los precios de cada día incluyen el mejor descuento que publica cada súper para esos medios (ej. Coto −25% los viernes con Mercado Pago). La pestaña muestra todos los descuentos de la semana con su tope, compra mínima y condiciones; se actualizan solos dos veces por día. El cupón **Club Dia** de los martes también aparece: 20% (lo que comunica Dia; el legal no dice el %), sobre toda la compra salvo leches infantiles, golosinas, vinos, carnes y productos de mostrador, y se suma al resto de los descuentos. Las promos que Coto publica semana a semana (ej. 20% con Mercado Pago el finde) aparecen como "sin confirmar" hasta que las publica, y no se aplican a los precios. El descuento del medio de pago no se suma a las promos del producto (2da al 50%, 2x1…), salvo que la promo diga que es acumulable.
- Marcas excluidas: TREGAR por defecto (editable).
- Leches: se excluyen chocolatadas, en polvo, condensadas, infantiles y vegetales. Las "especiales" (0% lactosa, proteína, etc.) se pueden activar.

La configuración y los últimos precios se guardan en el navegador (localStorage).
