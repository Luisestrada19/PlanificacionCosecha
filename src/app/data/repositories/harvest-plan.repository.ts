import { Injectable, inject, signal } from '@angular/core';
import { Fundo, HarvestLot, LotAssignment, StoredPlan } from '../../domain/harvest.models';
import { GeoJsonParserService } from '../services/geojson-parser.service';
import { supabase } from '../../core/config/supabase.client';

const STORAGE_KEY = 'harvest-plan-v1';
const GEOJSON_BUCKET = 'fundo-geojson';

@Injectable({ providedIn: 'root' })
export class HarvestPlanRepository {
  readonly fundos = signal<Fundo[]>([]);
  readonly assignments = signal<Record<string, LotAssignment | null>>({});
  readonly hasLocalFundsToSync = signal(false);
  readonly localFundsToSyncCount = signal(0);
  private readonly parser = inject(GeoJsonParserService);
  private localFundsToSync: Fundo[] = [];

  constructor() {
    this.loadAssignments();
  }

  async refreshFromRemote(): Promise<void> {
    const localFundos = this.fundos();
    const localAssignments = this.assignments();
    const { data: role, error: roleError } = await supabase.rpc('current_app_role');
    if (roleError) throw new Error(`No se pudo validar el rol: ${roleError.message}`);
    const { data: hasAccess, error: accessError } = await supabase.rpc('has_team_access');
    if (accessError) throw new Error(`No se pudo validar el acceso del equipo: ${accessError.message}`);
    if (!hasAccess) throw new Error('Tu cuenta no está habilitada. Solicita acceso al administrador.');

    const { data: remoteFundos, error: fundosError } = await supabase
      .from('fundos')
      .select('id,name,current_version_id')
      .order('name');
    if (fundosError) throw new Error(`No se pudieron cargar los fundos: ${fundosError.message}`);

    const currentVersionIds = remoteFundos.map(fundo => fundo.current_version_id).filter((id): id is string => !!id);
    const versionsById = new Map<string, { id:string; fundo_id:string; file_name:string; storage_path:string; created_at:string }>();
    if (currentVersionIds.length) {
      const { data: versions, error: versionsError } = await supabase
        .from('fundo_versions')
        .select('id,fundo_id,file_name,storage_path,created_at')
        .in('id', currentVersionIds);
      if (versionsError) throw new Error(`No se pudieron cargar las versiones de los fundos: ${versionsError.message}`);
      versions.forEach(version => versionsById.set(version.id, version));
    }

    const loadedFundos = await Promise.all(remoteFundos.map(async remoteFundo => {
      if (!remoteFundo.current_version_id) return null;
      const version = versionsById.get(remoteFundo.current_version_id);
      if (!version) throw new Error(`Falta la versión vigente del fundo ${remoteFundo.name}.`);
      const { data: file, error: fileError } = await supabase.storage.from(GEOJSON_BUCKET).download(version.storage_path);
      if (fileError) throw new Error(`No se pudo descargar ${version.file_name}: ${fileError.message}`);
      const bytes = await file.arrayBuffer();
      const localFile = new File([bytes], version.file_name, { type: file.type || 'application/octet-stream' });
      const parsed = await this.parser.parseFile(localFile, remoteFundo.id);
      return {
        ...parsed,
        name: remoteFundo.name,
        importedAt: version.created_at,
        lots: parsed.lots.map(lot => ({ ...lot, fundoName: remoteFundo.name }))
      };
    }));
    const fundos = loadedFundos.filter((fundo): fundo is Fundo => fundo !== null);
    let remoteAssignments: Record<string, LotAssignment | null> = {};
    if (fundos.length) {
      const { data: rows, error: assignmentsError } = await supabase
        .from('lot_assignments')
        .select('lot_uid,supervisor,color,updated_at')
        .in('fundo_id', fundos.map(fundo => fundo.id));
      if (assignmentsError) throw new Error(`No se pudieron cargar las asignaciones: ${assignmentsError.message}`);
      remoteAssignments = Object.fromEntries(rows.map(row => [
        row.lot_uid,
        { supervisor: row.supervisor, color: row.color, updatedAt: row.updated_at }
      ]));
    }
    const remoteIds = new Set(fundos.map(fundo => fundo.id));
    const remoteNames = new Set(fundos.map(fundo => fundo.name.trim().toLocaleLowerCase('es')));
    this.localFundsToSync = role === 'admin'
      ? localFundos.filter(fundo =>
          !remoteIds.has(fundo.id) && !remoteNames.has(fundo.name.trim().toLocaleLowerCase('es')))
      : [];
    this.hasLocalFundsToSync.set(this.localFundsToSync.length > 0);
    this.localFundsToSyncCount.set(this.localFundsToSync.length);
    for (const fundo of this.localFundsToSync) {
      for (const lot of fundo.lots) {
        const assignment = localAssignments[lot.uid];
        if (assignment) remoteAssignments[lot.uid] = assignment;
      }
    }
    this.fundos.set([...fundos, ...this.localFundsToSync]);
    this.assignments.set(remoteAssignments);
    this.persist();
  }

  async uploadLocalFunds(): Promise<void> {
    await this.requireAdmin();
    for (const fundo of [...this.localFundsToSync]) {
      const geojson = {
        type: 'FeatureCollection',
        features: fundo.lots.map(lot => ({
          type: 'Feature',
          id: lot.fid,
          properties: lot.properties,
          geometry: lot.geometry
        }))
      };
      const fileName = `${fundo.name.replace(/[\\/]/g, '_')}.geojson`;
      const file = new File([JSON.stringify(geojson)], fileName, { type: 'application/geo+json' });
      const assignments = fundo.lots.flatMap(lot => {
        const assignment = this.assignments()[lot.uid];
        return assignment ? [{ lot_uid:lot.uid, supervisor:assignment.supervisor, color:assignment.color }] : [];
      });
      await this.addFundo(fundo, file, assignments);
      this.localFundsToSync = this.localFundsToSync.filter(item => item.id !== fundo.id);
      this.hasLocalFundsToSync.set(this.localFundsToSync.length > 0);
      this.localFundsToSyncCount.set(this.localFundsToSync.length);
    }
  }

  async addFundo(
    fundo: Fundo,
    file: File,
    assignments: Array<{ lot_uid:string; supervisor:string; color:string }> = []
  ): Promise<void> {
    await this.requireAdmin();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw new Error(`No se pudo validar la sesión: ${userError.message}`);
    if (!user) throw new Error('Inicia sesión antes de subir un GeoJSON.');

    const versionId = crypto.randomUUID();
    const safeFileName = file.name.replace(/[\\/]/g, '_');
    const storagePath = `${fundo.id}/${versionId}/${safeFileName}`;
    const { error: uploadError } = await supabase.storage
      .from(GEOJSON_BUCKET)
      .upload(storagePath, file, { contentType: file.type || 'application/geo+json', upsert: false });
    if (uploadError) throw new Error(`No se pudo subir ${file.name}: ${uploadError.message}`);

    const { error: registerError } = await supabase.rpc('register_fundo_version', {
      p_fundo_id: fundo.id,
      p_name: fundo.name,
      p_version_id: versionId,
      p_file_name: safeFileName,
      p_storage_path: storagePath,
      p_assignments: assignments
    });
    if (registerError) {
      const { error: cleanupError } = await supabase.storage.from(GEOJSON_BUCKET).remove([storagePath]);
      const cleanupDetail = cleanupError ? ` No se pudo limpiar el archivo subido: ${cleanupError.message}` : '';
      throw new Error(`No se pudo registrar la versión de ${fundo.name}: ${registerError.message}.${cleanupDetail}`);
    }

    this.fundos.update(items => [...items.filter(item => item.id !== fundo.id), fundo]);
    this.persist();
  }

  async setAssignment(uid: string, assignment: LotAssignment | null): Promise<void> {
    const lot = this.allLots().find(item => item.uid === uid);
    if (!lot) throw new Error('No se encontró el lote que se quiere actualizar.');
    await this.saveRemoteAssignments([{ lot, assignment }]);
    this.assignments.update(current => ({ ...current, [uid]: assignment }));
    this.persist();
  }

  async setMany(uids: string[], assignment: LotAssignment | null): Promise<void> {
    const selected = new Set(uids);
    const lots = this.allLots().filter(lot => selected.has(lot.uid));
    if (!lots.length) return;
    await this.saveRemoteAssignments(lots.map(lot => ({ lot, assignment })));
    this.assignments.update(current => {
      const next = { ...current };
      lots.forEach(lot => next[lot.uid] = assignment);
      return next;
    });
    this.persist();
  }

  allLots(): HarvestLot[] {
    const saved = this.assignments();
    return this.fundos().flatMap(fundo => fundo.lots.map(lot => ({ ...lot, assignment: saved[lot.uid] ?? null })));
  }

  clearInMemory(): void {
    this.fundos.set([]);
    this.assignments.set({});
    this.localFundsToSync = [];
    this.hasLocalFundsToSync.set(false);
    this.localFundsToSyncCount.set(0);
  }

  private async saveRemoteAssignments(changes: Array<{ lot:HarvestLot; assignment:LotAssignment|null }>): Promise<void> {
    const payload = changes.map(({ lot, assignment }) => ({
      fundo_id: lot.fundoId,
      lot_uid: lot.uid,
      supervisor: assignment?.supervisor ?? null,
      color: assignment?.color ?? null
    }));
    const { error } = await supabase.rpc('save_lot_assignments', { p_assignments: payload });
    if (error) throw new Error(`No se pudieron guardar las asignaciones: ${error.message}`);
  }

  private async requireAdmin(): Promise<void> {
    const { data: role, error } = await supabase.rpc('current_app_role');
    if (error) throw new Error(`No se pudo validar tu rol: ${error.message}`);
    if (role !== 'admin') throw new Error('Solo el administrador puede importar o subir GeoJSON.');
  }

  private loadAssignments(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredPlan;
      if (parsed.version === 1 && parsed.assignments) this.assignments.set(parsed.assignments);
      if (parsed.version === 1 && Array.isArray(parsed.fundos)) this.fundos.set(parsed.fundos);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private persist(): void {
    const payload: StoredPlan = { version: 1, assignments: this.assignments(), fundos: this.fundos() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}
