# Planificador de cosecha

Aplicación Angular standalone + Signals + Leaflet para planificar la cosecha del día siguiente.

## Requisitos
- Node.js 20.19+ o 22.12+
- npm

## Ejecutar
```bash
npm install
npm start
```
Abrir http://localhost:4200

## Publicar en GitHub Pages
- En el repositorio, ve a **Settings → Pages** y selecciona **GitHub Actions** como origen.
- Al hacer push a `main`, el workflow compila y publica la aplicación automáticamente.
- Para probar el build de Pages localmente, ejecuta `npm run build:pages`. Genera los archivos en `dist/harvest-planner/browser`.
- La URL del sitio será https://luisestrada19.github.io/PlanificacionCosecha/.

## Mapas compartidos con Supabase
1. Ejecuta una sola vez `supabase/migrations/20261120220000_shared_fundos.sql` en el SQL Editor del proyecto.
2. Ejecuta `supabase/migrations/20261120224500_managed_users.sql`. Esta migración configura perfiles y RLS; no escribe directamente en `auth.users`.
3. Con el proyecto vinculado en Supabase CLI, despliega las funciones con `supabase functions deploy create-team-user` y `supabase functions deploy update-team-user`. Supabase agrega automáticamente las claves `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`.
4. En Supabase **Authentication → URL Configuration**, configura la URL de GitHub Pages como **Site URL** y como URL de retorno permitida.
5. `src/app/core/config/supabase.config.ts` contiene la URL y la clave pública `publishable`. Esta clave se incluye en el navegador; nunca pongas una clave `service_role` en la aplicación.

## Roles
- **Administrador:** crea y edita usuarios, asigna contraseñas temporales, carga versiones de GeoJSON, pinta lotes, consulta asignaciones, exporta y administra el equipo.
- **Supervisor:** consulta los mapas actualizados, pinta lotes y usa las exportaciones disponibles, pero no puede importar ni subir GeoJSON ni administrar usuarios.

El acceso usa correo y contraseña creados por el administrador. El usuario inicial es `admin@agbsmart.com` con la contraseña temporal `Cosecha2027`; cámbiala desde **Cambiar contraseña** al iniciar sesión.

Cada carga de un fundo crea una versión nueva y mantiene las anteriores. La app descarga la versión vigente al iniciar sesión y el botón **Actualizar mapas** vuelve a consultar Supabase. Si encuentra fundos guardados solo en este navegador, pide confirmación para subirlos junto con sus asignaciones; conserva también los GeoJSON originales como respaldo.
Las versiones anteriores se conservan en la base de datos; la interfaz carga la vigente. La exploración y restauración de versiones anteriores queda para una siguiente mejora.

## Funcionalidades
- Importación múltiple GeoJSON, KML o KMZ por selector o drag & drop.
- Parser de metadatos HTML en `properties.description` y `properties.description.value`.
- Sanitización léxica de controles dentro de strings y eliminación de comas finales.
- Identificadores compuestos por fundo/capa/FID/índice.
- Conversión UTM a WGS84 para coordenadas fuera de rangos geográficos.
- Mapa Esri World Imagery y capa opcional OSM.
- Pantalla completa para el mapa y exportación PNG/PDF del fundo seleccionado (elige un fundo específico en el filtro para habilitarla).
- Selección múltiple, pintura por supervisor/color, despintado y brocha rápida.
- Filtros, búsqueda, etiquetas, hectáreas y resumen por supervisor.
- Persistencia compartida de mapas/asignaciones en Supabase, caché local y exportación JSON.

## Permisos por fundo

Ejecuta también `supabase/migrations/20261124005000_fundo_permissions.sql` después de las migraciones anteriores.

- Los administradores ven todos los fundos y pueden asignar permisos desde **Usuarios**.
- Los supervisores solo ven los fundos marcados en **Fundos asignados**.
- Los filtros, el listado de lotes visibles, la asignación y las exportaciones usan únicamente esos fundos.
- Las restricciones también existen en Supabase mediante RLS y RPC; ocultar controles en Angular no permite eludir permisos.

## Cambiar el tamaño y el acercamiento de PNG/PDF

Todas las opciones principales están juntas en [harvest-map.component.ts](src/app/features/harvest-map/harvest-map.component.ts):

```ts
private readonly exportWidth = 1600;
private readonly exportHeight = 900;
private readonly exportPadding: [number, number] = [70, 55];
private readonly exportMaxZoom = 19;
private readonly pdfPageMargin = 10;
```

- `exportWidth` y `exportHeight`: tamaño de la imagen capturada antes de convertirla a PDF.
- `exportPadding`: margen alrededor del fundo al exportar. Reduce los valores para acercar el fundo; auméntalos para alejarlo.
- `exportMaxZoom`: nivel máximo de acercamiento. Sube el valor solo si el mapa queda demasiado pequeño.
- `pdfPageMargin`: margen en milímetros alrededor de la imagen dentro del PDF.
- `exportLotLabelFontSize`: tamaño de los textos/códigos de cada lote en PNG/PDF.
- `exportLegendFontSize`: tamaño del texto de cada supervisor en la leyenda.
- `exportLegendTitleFontSize`: tamaño del título «Leyenda de supervisores».
- `exportHeaderNameFontSize`: tamaño del nombre del fundo en la cabecera.
- `exportHeaderDateFontSize`: tamaño de la fecha y texto de cosecha.
- `exportLegendSwatchSize`: tamaño en píxeles de los cuadrados de color de la leyenda.

Métodos relacionados:

- `fitCurrentFundo(exportMode)`: controla el zoom y el enfoque del mapa. El modo exportación usa `exportPadding` y `exportMaxZoom`.
- `captureFundoMap()`: captura temporalmente el mapa a tamaño PNG, aplica los rótulos y leyenda, y restaura la vista normal.
- `exportMapImage()`: descarga el PNG.
- `exportMapPdf()`: usa la misma imagen PNG para crear el PDF, así que no se necesita ajustar la leyenda por separado.
- La leyenda visible en PNG/PDF está dentro de la plantilla Angular, junto al contenedor `mapHost` y el bloque `Leyenda de supervisores`.
- Los estilos de tamaño de rótulos están en [styles.css](src/styles.css), selector `.map-canvas.exporting .leaflet-tooltip.lot-label`.
- Los estilos de controles ocultos están en el bloque `styles` de `harvest-map.component.ts`, selector `.map-canvas.exporting .leaflet-control-container`.

## Notas de implementación / producción
- `angular.json` no declara una carpeta `public` como asset porque Angular exige que las rutas de assets estén dentro del source root; esta aplicación no necesita assets estáticos externos.
1. La detección UTM se activa cuando las coordenadas exceden los rangos de longitud/latitud. La zona se estima como 17 o 18 según el Este; si se trabaja con otra zona, datum o hemisferio, conviene incorporar metadatos CRS explícitos o configurar la zona por fundo.
2. El cálculo de área geométrica es solo respaldo. Se prioriza `AREA_HA` del archivo de origen.
3. Supabase protege tablas y archivos mediante RLS; solo perfiles habilitados con rol `admin` o `supervisor` pueden acceder.
4. La cartografía Esri y OSM requiere conexión a Internet y está sujeta a las condiciones de uso de sus proveedores.
5. Los lotes e infraestructura que no sean polígonos se omiten del flujo de asignación. Se puede ampliar el modelo si se desea asignar infraestructura o visualizar puntos/líneas como elementos informativos.
6. Para una operación de campo crítica, añadir pruebas unitarias al parser con fixtures completos de exportaciones ArcGIS/KML y validar CRS, área y topología antes de publicar.

## Estructura
- `src/app/app.component.ts`: componente raíz minimalista.
- `src/app/features/harvest-map`: composición funcional del mapa, exportaciones y asignaciones.
- `src/app/app.config.ts`: proveedores globales de Angular.
- `src/app/core/auth`: sesión, perfil y permisos por rol.
- `src/app/core/config`: configuración pública de Supabase y tipos generados.
- `src/app/domain`: modelos y contratos del dominio.
- `src/app/data/repositories`: persistencia remota y caché local.
- `src/app/data/services`: parser GeoJSON/KML/KMZ.
- `src/app/data/mocks`: datos de demostración.
- `supabase/migrations`: esquema, RLS y usuario inicial.
- `supabase/functions/create-team-user`: creación segura de usuarios desde el panel admin.

## Pruebas
```bash
npm test
npm run build:pages
```t.

## Recuperación del inicio de sesión
Si aparece `500` en `/auth/v1/token?grant_type=password`:

1. Ve a **Authentication → Providers** y habilita **Email**.
2. Ve a **Authentication → Users** y crea `admin@agbsmart.com` con `Cosecha2027`, marcándolo como confirmado.
3. Si ya existía con datos dañados, elimínalo desde **Users** y créalo de nuevo. Es más seguro que editar `auth.users` manualmente.
4. Ejecuta otra vez la migración `20261120224500_managed_users.sql`; el trigger asignará automáticamente el perfil `admin`.
5. Borra la sesión/caché del navegador e inicia con el correo y contraseña.t.
