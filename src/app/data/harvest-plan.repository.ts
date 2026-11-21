import { Injectable, signal } from '@angular/core';
import { Fundo, HarvestLot, LotAssignment, StoredPlan } from '../domain/harvest.models';

const STORAGE_KEY = 'harvest-plan-v1';
@Injectable({ providedIn: 'root' })
export class HarvestPlanRepository {
  readonly fundos = signal<Fundo[]>([]);
  readonly assignments = signal<Record<string, LotAssignment | null>>({});

  constructor() {
    this.loadAssignments();
  }
  addFundo(fundo: Fundo): void {
    this.fundos.update(items => [...items.filter(x => x.id !== fundo.id), fundo]);
    this.applyStoredAssignments();
    this.persist();
  }
  setAssignment(uid: string, assignment: LotAssignment | null): void {
    this.assignments.update(current => ({ ...current, [uid]: assignment }));
    this.persist();
  }
  setMany(uids: string[], assignment: LotAssignment | null): void {
    this.assignments.update(current => {
      const next = { ...current };
      uids.forEach(uid => next[uid] = assignment);
      return next;
    });
    this.persist();
  }
  allLots(): HarvestLot[] {
    const saved = this.assignments();
    return this.fundos().flatMap(f => f.lots.map(l => ({ ...l, assignment: saved[l.uid] ?? null })));
  }
  private loadAssignments(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredPlan;
      if (parsed.version === 1 && parsed.assignments) this.assignments.set(parsed.assignments);
      if (parsed.version === 1 && Array.isArray(parsed.fundos)) this.fundos.set(parsed.fundos);
    } catch { localStorage.removeItem(STORAGE_KEY); }
  }
  private persist(): void {
    const payload: StoredPlan = { version: 1, assignments: this.assignments(), fundos: this.fundos() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
  private applyStoredAssignments(): void {
    // Las asignaciones se resuelven dinámicamente por uid en allLots().
  }
  async syncWithRemoteDatabase(payload: unknown): Promise<void> {
    // Punto de extensión: conectar aquí HttpClient + endpoint REST.
    // No realiza llamadas hasta que se configure una API.
    void payload;
    return Promise.resolve();
  }
}
