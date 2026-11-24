import type { AppRole } from './auth.service';

export function canImportGeoJson(role: AppRole | null): boolean {
  return role === 'admin';
}

export function canManageUsers(role: AppRole | null): boolean {
  return role === 'admin';
}

export function canPaintLots(role: AppRole | null): boolean {
  return role === 'admin' || role === 'supervisor';
}

export function canExportPlan(role: AppRole | null): boolean {
  return role === 'admin' || role === 'supervisor';
}
