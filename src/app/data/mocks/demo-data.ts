import { Fundo, HarvestLot } from '../../domain/harvest.models';

export function createDemoFundo(): Fundo {
  const baseLng = -78.8420, baseLat = -8.3450;
  const lots: HarvestLot[] = [];
  const rows = [
    { code:'T1 - L17', area:1.03, dx:0, dy:0, layer:'MODULO 1' },
    { code:'T1 - L16', area:1.09, dx:0.0010, dy:0, layer:'MODULO 1' },
    { code:'T1 - L15', area:0.98, dx:0.0020, dy:0, layer:'MODULO 1' },
    { code:'T2 - L2', area:1.13, dx:0, dy:-0.0010, layer:'MODULO 1' },
    { code:'T2 - L3', area:1.15, dx:0.0010, dy:-0.0010, layer:'MODULO 1' },
    { code:'T3 - L4', area:0.86, dx:0.0020, dy:-0.0010, layer:'MODULO 2' },
    { code:'T3 - L5', area:0.92, dx:0, dy:-0.0020, layer:'MODULO 2' },
    { code:'T4 - L6', area:1.11, dx:0.0010, dy:-0.0020, layer:'MODULO 2' }
  ];
  const fundoId = 'fundo-las-lomas-demo';
  rows.forEach((r, i) => {
    const x = baseLng + r.dx, y = baseLat + r.dy;
    lots.push({
      uid:`${fundoId}__${r.layer.replaceAll(' ','-')}__${i}__${i}`,
      fundoId, fundoName:'Fundo Las Lomas (demo)', layer:r.layer, fid:String(i),
      code:r.code, turn:r.code.match(/T\d+/)?.[0] ?? 'T1', areaHa:r.area,
      geometry:{
        type:'Polygon',
        coordinates:[[
          [x,y],[x+0.00072,y],[x+0.00072,y-0.00048],
          [x,y-0.00048],[x,y]
        ]]
      },
      properties:{ FID:i, Layer:r.layer, Text:r.code, AREA_HA:r.area },
      assignment:null
    });
  });
  return { id:fundoId, name:'Fundo Las Lomas (demo)', lots, importedAt:new Date().toISOString() };
}
