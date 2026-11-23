# SuperScrap · Leches

Compara las leches más baratas de **Dia** y **Coto** (con y sin promo), según el día de la semana.

## Cómo usarla

- **Recomendado:** doble clic en `iniciar.bat` (necesita Node 18+). Se abre `http://localhost:8787`.
  El servidor (`server.js`, sin dependencias) solo sirve la página y reenvía los pedidos a Dia, porque la web de Dia no permite consultas directas desde el navegador.
- **Sin servidor:** abrí `index.html` directamente. Coto se consulta directo; para Dia intenta pasar por proxies públicos (allorigins / corsproxy), que pueden fallar.

## En el celular

**Opción A: en casa (misma WiFi), con la PC prendida.** Ejecutá `iniciar.bat`; la consola muestra
`Desde el celular (misma WiFi): http://192.168.x.x:8787`. Abrí esa dirección en el celular.
La primera vez Windows puede preguntar si permite a Node en la red: aceptá "Redes privadas".

**Opción B: desde cualquier lado (GitHub Pages, gratis).**
1. Creá un repo **público** en github.com (ej. `superscrap`) y subí todos los archivos de esta carpeta
   (incluida `.github/workflows/precios.yml` y `data/`).
2. En el repo: *Settings → Pages → Source: Deploy from a branch → main / (root)*.
3. *Actions → Actualizar precios → Run workflow* para probar. Después corre solo a las 7:17 y 13:17 (hora AR).
4. Abrí `https://TU-USUARIO.github.io/superscrap/` en el celular y en Chrome tocá ⋮ → *Agregar a pantalla principal*.

En la versión web, Coto se consulta en vivo desde el celular. Dia no permite consultas directas desde el navegador,
así que usa la copia que guarda GitHub dos veces por día (la app indica la hora de esa copia).
Los registros de góndola y la configuración se guardan por dispositivo (los de la PC no pasan al celular).

## De dónde salen los datos

- Dia: API VTEX pública `diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search/frescos/leches/...`
  (precio, precio anterior y promos tipo "Llevando 2 a $X c/u", "2do al 70%", "3x2").
- Coto: JSON Endeca de `coto.com.ar/sitios/cdigi/categoria/...leches/_/N-zpvqr7?format=json`
  (`sku.activePrice` y `product.dtoDescuentos`, con el precio por unidad de la promo).

## Reglas

- **Coto fin de semana:** % configurable para sábado y domingo (15% por defecto). Se aplica solo a productos sin promo.
- **Club Dia:** % configurable por día, para todas las leches o solo para la marca DIA. Por defecto no suma a las promos.
- Marcas excluidas: TREGAR por defecto (editable).
- Se excluyen chocolatadas, en polvo, condensadas, infantiles y vegetales. Las "especiales" (0% lactosa, proteína, etc.) se pueden activar.

Configuración, registros de góndola y últimos precios se guardan en el navegador (localStorage).
