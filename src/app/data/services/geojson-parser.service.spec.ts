import { describe, expect, it } from 'vitest';
import { GeoJsonParserService } from './geojson-parser.service';

describe('GeoJsonParserService', () => {
  it('uses stable FID and property names for each lot', () => {
    const parser = new GeoJsonParserService();
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 11,
          properties: { FID: 'LOT-A', Text: 'A1', Layer: 'MODULO 1', AREA_HA: '2.50' },
          geometry: { type: 'Polygon', coordinates: [[[-78.84, -8.34], [-78.83, -8.34], [-78.83, -8.35], [-78.84, -8.34]]] }
        },
        {
          type: 'Feature',
          id: 12,
          properties: { FID: 'LOT-B', Text: 'B1', Layer: 'MODULO 1', AREA_HA: '3.75' },
          geometry: { type: 'Polygon', coordinates: [[[-78.82, -8.34], [-78.81, -8.34], [-78.81, -8.35], [-78.82, -8.34]]] }
        }
      ]
    };
    const fundo = parser.parseText(JSON.stringify(geojson), 'campo.geojson', 'fundo-1');
    expect(fundo.lots.map(lot => lot.code)).toEqual(['A1', 'B1']);
    expect(fundo.lots.map(lot => lot.fid)).toEqual(['LOT-A', 'LOT-B']);
    expect(fundo.lots.map(lot => lot.areaHa)).toEqual([2.5, 3.75]);
  });

  it('accepts code and layer property variants', () => {
    const parser = new GeoJsonParserService();
    const geojson = {
      type: 'Feature',
      properties: { codigo: 'C-10', capa: 'SECTOR SUR', area_m2: '10000' },
      geometry: { type: 'Polygon', coordinates: [[[-78.84, -8.34], [-78.83, -8.34], [-78.83, -8.35], [-78.84, -8.34]]] }
    };
    const fundo = parser.parseText(JSON.stringify(geojson), 'fundo.geojson', 'fundo-2');
    expect(fundo.lots[0].code).toBe('C-10');
    expect(fundo.lots[0].layer).toBe('SECTOR SUR');
  });

  it('does not import legend placeholders as lots', () => {
    const parser = new GeoJsonParserService();
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: '--LEYENDA' },
          geometry: { type: 'Polygon', coordinates: [[[-78.84, -8.34], [-78.83, -8.34], [-78.83, -8.35], [-78.84, -8.34]]] }
        },
        {
          type: 'Feature',
          properties: { name: 'T1 - L1' },
          geometry: { type: 'Polygon', coordinates: [[[-78.82, -8.34], [-78.81, -8.34], [-78.81, -8.35], [-78.82, -8.34]]] }
        }
      ]
    };
    const fundo = parser.parseText(JSON.stringify(geojson), 'fundo.geojson', 'fundo-3');
    expect(fundo.lots).toHaveLength(1);
    expect(fundo.lots[0].code).toBe('T1 - L1');
  });
});
