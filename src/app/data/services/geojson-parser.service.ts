import { Injectable } from '@angular/core';
import type { Geometry, Position } from 'geojson';
import { kml } from '@tmcw/togeojson';
import { strFromU8, unzipSync } from 'fflate';
import { Fundo, HarvestLot, GeoJsonFeatureCollection, GeoJsonFeature } from '../../domain/harvest.models';

@Injectable({ providedIn: 'root' })
export class GeoJsonParserService {
  async parseFile(file: File, stableFundoId?: string): Promise<Fundo> {
    if (/\.kml$/i.test(file.name)) {
      return this.parseText(await file.text(), file.name, stableFundoId);
    }
    if (/\.kmz$/i.test(file.name)) {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const kmlEntry = Object.keys(archive).find(name => /\.kml$/i.test(name) && !name.endsWith('/'));
      if (!kmlEntry) throw new Error(`${file.name}: el archivo KMZ no contiene un documento KML.`);
      const kmlName = file.name.replace(/\.kmz$/i, '.kml');
      return this.parseText(strFromU8(archive[kmlEntry]), kmlName, stableFundoId);
    }
    return this.parseText(await file.text(), file.name, stableFundoId);
  }

  parseText(rawText: string, fileName: string, stableFundoId?: string): Fundo {
    if (/\.kml$/i.test(fileName)) {
      if (typeof DOMParser === 'undefined') throw new Error('El navegador no permite leer archivos KML.');
      const xml = new DOMParser().parseFromString(rawText, 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error(`${fileName}: el archivo KML no es válido.`);
      const converted = kml(xml) as GeoJsonFeatureCollection;
      return this.parseFeatureCollection(converted, fileName, stableFundoId);
    }

    const cleaned = this.sanitizeJson(rawText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      const recoveredFeatures = this.recoverCompleteFeatures(cleaned);
      if (!recoveredFeatures.length) {
        const detail = error instanceof Error ? error.message : 'error desconocido';
        throw new Error(`No se pudo leer ${fileName}. El GeoJSON puede estar truncado o mal formado. Detalle: ${detail}`);
      }
      parsed = { type: 'FeatureCollection', features: recoveredFeatures };
    }
    if (!this.isFeatureCollection(parsed) && !this.isFeature(parsed)) {
      throw new Error(`${fileName}: se esperaba un GeoJSON FeatureCollection o Feature.`);
    }
    const collection: GeoJsonFeatureCollection = this.isFeatureCollection(parsed)
      ? parsed
      : { type: 'FeatureCollection', features: [parsed] };
    return this.parseFeatureCollection(collection, fileName, stableFundoId);
  }

  private parseFeatureCollection(
    collection: GeoJsonFeatureCollection,
    fileName: string,
    stableFundoId?: string
  ): Fundo {
    const features = collection.features;
    const fundoName = this.fundoNameFromFileName(fileName);
    const fundoId = stableFundoId ?? this.slug(fundoName) + '-' + Date.now().toString(36);
    const lots: HarvestLot[] = [];

    features.forEach((feature, index) => {
      if (!feature.geometry ||
          (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) return;
      const direct = feature.properties ?? {};
      const html = this.readHtmlMetadata(direct['description']);
      const merged = { ...direct, ...html };
      const layer = this.propertyValue(merged, ['Layer', 'layer', 'capa', 'module', 'name']) ?? 'SIN CAPA';
      const fid = this.propertyValue(merged, ['FID', 'fid', 'objectid', 'ObjectID', 'id']) ?? String(feature.id ?? '');
      const code = this.propertyValue(merged, ['Text', 'text', 'codigo', 'code', 'name', 'Name', 'lot', 'lote'])
        ?? `LOTE ${index + 1}`;
      const areaRaw = this.propertyValue(merged, ['AREA_HA', 'area_ha', 'hectares', 'area']);
      const areaM2Raw = this.propertyValue(merged, ['area_m2', 'AREA_M2']);
      const areaHa = this.numberValue(areaRaw)
        ?? (this.numberValue(areaM2Raw) !== null ? this.numberValue(areaM2Raw)! / 10000 : null)
        ?? this.estimateAreaHa(feature.geometry);
      const normalizedGeometry = this.normalizeGeometry(feature.geometry);
      const turn = code.match(/\bT\s*\d+/i)?.[0]?.replace(/\s+/g, '').toUpperCase() ?? 'SIN TURNO';
      const auxiliaryName = /^(?:[-_.*]+)?(?:leyenda|legend|leyend|descripcion|description)(?:[-_.*]+)?$/i.test(code)
        || /^(?:[-_.*]+)?(?:leyenda|legend|leyend|descripcion|description)(?:[-_.*]+)?$/i.test(layer);
      if (auxiliaryName) return;
      const identity = fid || code;
      lots.push({
        uid: `${fundoId}__${this.slug(layer)}__${this.slug(identity) || index}`,
        fundoId, fundoName, layer, fid: fid || String(index + 1), code, turn, areaHa,
        geometry: normalizedGeometry, properties: merged, assignment: null
      });
    });
    if (!lots.length) throw new Error(`${fileName}: no contiene polígonos utilizables.`);
    return { id: fundoId, name: fundoName, lots, importedAt: new Date().toISOString() };
  }

  fundoNameFromFileName(fileName: string): string {
    return fileName.replace(/\.(?:kmz|kml|geojson|json|txt)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Fundo importado';
  }

  private propertyValue(properties: Record<string, unknown>, names: string[]): string | null {
    for (const name of names) {
      const exact = properties[name];
      if (exact !== undefined && exact !== null && String(exact).trim()) return String(exact).trim();
      const found = Object.entries(properties).find(([key]) => key.localeCompare(name, undefined, { sensitivity: 'base' }) === 0);
      if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim()) return String(found[1]).trim();
    }
    return null;
  }

  private sanitizeJson(input: string): string {
    // Lexer: escapa controles literales dentro de strings sin tocar escapes ya válidos.
    let out = '', inString = false, escaped = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (inString) {
        if (escaped) { out += ch; escaped = false; continue; }
        if (ch === '\\') { out += ch; escaped = true; continue; }
        if (ch === '"') { out += ch; inString = false; continue; }
        const code = ch.charCodeAt(0);
        if (code === 10) out += '\\n';
        else if (code === 13) out += '\\r';
        else if (code === 9) out += '\\t';
        else if (code < 32) out += `\\u${code.toString(16).padStart(4, '0')}`;
        else out += ch;
      } else {
        out += ch;
        if (ch === '"') inString = true;
      }
    }
    // Comas finales fuera de strings.
    let cleaned = '', quoted = false, slash = false;
    for (let i = 0; i < out.length; i++) {
      const ch = out[i];
      if (quoted) {
        cleaned += ch;
        if (slash) slash = false;
        else if (ch === '\\') slash = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') { quoted = true; cleaned += ch; }
      else if (ch === ',') {
        let j = i + 1;
        while (j < out.length && /\s/.test(out[j])) j++;
        if (out[j] !== '}' && out[j] !== ']') cleaned += ch;
      } else cleaned += ch;
    }
    return cleaned;
  }

  private readHtmlMetadata(description: unknown): Record<string, string> {
    const html = typeof description === 'string'
      ? description
      : (description && typeof description === 'object' && 'value' in description)
        ? String((description as { value: unknown }).value ?? '') : '';
    if (!html || typeof DOMParser === 'undefined') return {};
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const result: Record<string, string> = {};
    doc.querySelectorAll('tr').forEach(row => {
      const cells = Array.from(row.querySelectorAll('td,th'));
      if (cells.length >= 2) {
        const key = (cells[0].textContent ?? '').trim();
        const value = (cells[1].textContent ?? '').trim();
        if (key) result[key] = value;
      }
    });
    return result;
  }

  private isFeatureCollection(value: unknown): value is GeoJsonFeatureCollection {
    return !!value && typeof value === 'object' &&
      (value as { type?: string }).type === 'FeatureCollection' &&
      Array.isArray((value as { features?: unknown }).features);
  }
  private isFeature(value: unknown): value is GeoJsonFeature {
    return !!value && typeof value === 'object' &&
      (value as { type?: string }).type === 'Feature';
  }
  private recoverCompleteFeatures(rawText: string): GeoJsonFeature[] {
    const featuresMatch = /"features"\s*:\s*\[/i.exec(rawText);
    if (!featuresMatch) return [];

    const start = featuresMatch.index + featuresMatch[0].length;
    const features: GeoJsonFeature[] = [];
    let depth = 0;
    let objectStart = -1;
    let inString = false;
    let escaped = false;

    for (let i = start; i < rawText.length; i++) {
      const ch = rawText[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        if (depth === 0) objectStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && objectStart >= 0) {
          const candidate = rawText.slice(objectStart, i + 1);
          try {
            const feature = JSON.parse(candidate) as unknown;
            if (this.isFeature(feature)) features.push(feature);
          } catch {
            // Saltar objetos incompletos o dañados dentro de un archivo truncado.
          }
          objectStart = -1;
        }
      }
    }
    return features;
  }
  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number(value.replace(',', '.').replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  private slug(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private normalizeGeometry(geometry: Geometry): Geometry {
    const coords = (geometry as unknown as { coordinates?: unknown }).coordinates;
    if (!coords) return geometry;
    const positions: Position[] = [];
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        let [x, y] = [value[0], value[1]];
        if (Math.abs(x) > 180 || Math.abs(y) > 90) [x, y] = this.utmToWgs84(x, y, this.guessUtmZone(x));
        positions.push([x, y]);
        return [x, y, ...value.slice(2)];
      }
      if (Array.isArray(value)) return value.map(walk);
      return value;
    };
    return { ...geometry, coordinates: walk(coords) } as Geometry;
  }

  private guessUtmZone(easting: number): number { return easting > 500000 ? 18 : 17; }
  private utmToWgs84(easting: number, northing: number, zone: number): [number, number] {
    // Inversa Transverse Mercator WGS84; Perú sur (hemisferio S).
    const a = 6378137, ecc = 0.00669438, k0 = 0.9996;
    const x = easting - 500000, y = northing - 10000000;
    const eccPrime = ecc / (1 - ecc);
    const m = y / k0;
    const mu = m / (a * (1 - ecc / 4 - 3 * ecc ** 2 / 64 - 5 * ecc ** 3 / 256));
    const e1 = (1 - Math.sqrt(1 - ecc)) / (1 + Math.sqrt(1 - ecc));
    const j1 = 3 * e1 / 2 - 27 * e1 ** 3 / 32;
    const j2 = 21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32;
    const j3 = 151 * e1 ** 3 / 96, j4 = 1097 * e1 ** 4 / 512;
    const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);
    const c1 = eccPrime * Math.cos(fp) ** 2, t1 = Math.tan(fp) ** 2;
    const n1 = a / Math.sqrt(1 - ecc * Math.sin(fp) ** 2);
    const r1 = a * (1 - ecc) / (1 - ecc * Math.sin(fp) ** 2) ** 1.5;
    const d = x / (n1 * k0);
    const lat = fp - (n1 * Math.tan(fp) / r1) * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * eccPrime) * d ** 4 / 24 + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * eccPrime - 3 * c1 ** 2) * d ** 6 / 720);
    const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
    const lon = lon0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * eccPrime + 24 * t1 ** 2) * d ** 5 / 120) / Math.cos(fp);
    return [lon * 180 / Math.PI, lat * 180 / Math.PI];
  }

  private estimateAreaHa(geometry: Geometry): number {
    // Fallback aproximado para polígonos WGS84; el AREA_HA del GIS tiene prioridad.
    const rings: Position[][] = [];
    const collect = (g: unknown): void => {
      if (!Array.isArray(g)) return;
      if (g.length && Array.isArray(g[0]) && typeof g[0][0] === 'number') rings.push(g as Position[]);
      else g.forEach(collect);
    };
    collect((geometry as unknown as { coordinates?: unknown }).coordinates);
    if (!rings.length) return 0;
    const ring = rings[0], lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const xy = ring.map(p => [p[0] * 111320 * Math.cos(lat0 * Math.PI / 180), p[1] * 110540] as const);
    let area = 0;
    for (let i = 0; i < xy.length - 1; i++) area += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
    return Math.abs(area / 2) / 10000;
  }
}
