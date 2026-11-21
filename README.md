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

## Funcionalidades
- Importación múltiple GeoJSON por selector o drag & drop.
- Parser de metadatos HTML en `properties.description` y `properties.description.value`.
- Sanitización léxica de controles dentro de strings y eliminación de comas finales.
- Identificadores compuestos por fundo/capa/FID/índice.
- Conversión UTM a WGS84 para coordenadas fuera de rangos geográficos.
- Mapa Esri World Imagery y capa opcional OSM.
- Selección múltiple, pintura por supervisor/color, despintado y brocha rápida.
- Filtros, búsqueda, etiquetas, hectáreas y resumen por supervisor.
- Persistencia de asignaciones en localStorage y exportación JSON.

## Notas de implementación / producción
- `angular.json` no declara una carpeta `public` como asset porque Angular exige que las rutas de assets estén dentro del source root; esta aplicación no necesita assets estáticos externos.
1. El archivo `LOMAS_V2.geojson` suministrado en la conversación está truncado: termina a mitad de un objeto `Feature`. El importador lo reportará como inválido; vuelve a exportarlo completo desde QGIS/ArcGIS/Google Earth.
2. La detección UTM se activa cuando las coordenadas exceden los rangos de longitud/latitud. La zona se estima como 17 o 18 según el Este; si se trabaja con otra zona, datum o hemisferio, conviene incorporar metadatos CRS explícitos o configurar la zona por fundo.
3. El cálculo de área geométrica es solo respaldo. Se prioriza `AREA_HA` del archivo de origen.
4. El repositorio expone `syncWithRemoteDatabase(payload)` como punto de integración REST. No se ejecuta ninguna sincronización remota sin configurar endpoint y autenticación.
5. La cartografía Esri y OSM requiere conexión a Internet y está sujeta a las condiciones de uso de sus proveedores.
6. Los lotes e infraestructura que no sean polígonos se omiten del flujo de asignación. Se puede ampliar el modelo si se desea asignar infraestructura o visualizar puntos/líneas como elementos informativos.
7. Para una operación de campo crítica, añadir pruebas unitarias al parser con fixtures completos de exportaciones ArcGIS/KML y validar CRS, área y topología antes de publicar.

## Estructura
- `src/app/domain`: modelos.
- `src/app/data/geojson-parser.service.ts`: parsing y normalización.
- `src/app/data/harvest-plan.repository.ts`: persistencia desacoplada.
- `src/app/app.component.ts`: interfaz y capa Leaflet.
