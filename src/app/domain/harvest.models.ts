import type { Feature, FeatureCollection, Geometry } from 'geojson';

export interface LotAssignment {
  supervisor: string;
  color: string;
  updatedAt: string;
}
export interface HarvestLot {
  uid: string;
  fundoId: string;
  fundoName: string;
  layer: string;
  fid: string;
  code: string;
  turn: string;
  areaHa: number;
  geometry: Geometry;
  properties: Record<string, unknown>;
  assignment: LotAssignment | null;
}
export interface Fundo {
  id: string;
  name: string;
  lots: HarvestLot[];
  importedAt: string;
}
export interface StoredPlan {
  version: 1;
  assignments: Record<string, LotAssignment | null>;
  fundos?: Fundo[];
}
export interface SupervisorSummary {
  supervisor: string;
  color: string;
  lots: number;
  hectares: number;
}
export type GeoJsonFeatureCollection = FeatureCollection<Geometry, Record<string, unknown>>;
export type GeoJsonFeature = Feature<Geometry, Record<string, unknown>>;
