import { describe, expect, it } from 'vitest';
import { canExportPlan, canImportGeoJson, canManageUsers, canPaintLots } from './permissions';

describe('role permissions', () => {
  it('allows only admins to import GeoJSON', () => {
    expect(canImportGeoJson('admin')).toBe(true);
    expect(canImportGeoJson('supervisor')).toBe(false);
    expect(canImportGeoJson(null)).toBe(false);
  });

  it('allows only admins to manage users', () => {
    expect(canManageUsers('admin')).toBe(true);
    expect(canManageUsers('supervisor')).toBe(false);
  });

  it('allows both roles to paint and export plans', () => {
    expect(canPaintLots('admin')).toBe(true);
    expect(canPaintLots('supervisor')).toBe(true);
    expect(canExportPlan('admin')).toBe(true);
    expect(canExportPlan('supervisor')).toBe(true);
  });
});
