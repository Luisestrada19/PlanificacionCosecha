import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  ViewChild, computed, effect, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { HarvestPlanRepository } from './data/harvest-plan.repository';
import { GeoJsonParserService } from './data/geojson-parser.service';
import { createDemoFundo } from './data/demo-data';
import { HarvestLot, LotAssignment, SupervisorSummary } from './domain/harvest.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <header class="border-b border-slate-800 bg-slate-950 px-4 py-3">
      <div class="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-xl">🌱</div>
          <div><h1 class="text-lg font-bold tracking-tight">Planificador de cosecha</h1><p class="text-xs text-slate-400">Programación operativa · Día siguiente</p></div>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold hover:bg-slate-800">
            <input #fileInput type="file" accept=".geojson,.json,application/geo+json,application/json" multiple class="hidden" (change)="onFiles($event)">
            <span>＋ Importar GeoJSON</span>
          </label>
          <button class="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-slate-950" (click)="exportJson()">↓ Exportar JSON</button>
        </div>
      </div>
    </header>

    <main class="mx-auto grid max-w-[1800px] grid-cols-1 gap-4 p-3 lg:grid-cols-[360px_minmax(0,1fr)] lg:p-4">
      <aside class="space-y-3">
        <section class="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div class="mb-3 flex items-center justify-between"><h2 class="font-bold">Asignación</h2><span class="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-400">2 campos</span></div>
          <label class="mb-1 block text-xs font-semibold text-slate-400">Nombre del supervisor</label>
          <input [(ngModel)]="supervisor" placeholder="Ej. María / Juan Pérez" class="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-emerald-500">
          @if (supervisorChips().length) {
            <div class="mb-3 flex flex-wrap gap-2">
              @for (chip of supervisorChips(); track chip.supervisor) {
                <button (click)="useSupervisor(chip)" class="flex min-h-9 items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 text-xs">
                  <span class="h-3 w-3 rounded-full" [style.background]="chip.color"></span>{{chip.supervisor}}
                </button>
              }
            </div>
          }
          <label class="mb-1 block text-xs font-semibold text-slate-400">Color a pintar</label>
          <div class="flex items-center gap-3">
            <input type="color" [(ngModel)]="color" class="h-12 w-16 cursor-pointer rounded-lg border-0 bg-transparent">
            <div class="flex flex-wrap gap-2">
              @for (c of quickColors; track c) {
                <button (click)="color=c" [style.background]="c" [attr.aria-label]="'Color '+c" class="h-7 w-7 rounded-full border-2" [class.border-white]="color===c" [class.border-slate-600]="color!==c"></button>
              }
            </div>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-2">
            <button (click)="applyPaint()" [disabled]="!selectedLots().length || !supervisor.trim()" class="min-h-11 rounded-lg bg-emerald-500 px-3 text-sm font-bold text-slate-950 disabled:opacity-40">Pintar seleccionados</button>
            <button (click)="clearSelected()" [disabled]="!selectedLots().length" class="min-h-11 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm font-semibold disabled:opacity-40">Despintar</button>
          </div>
          <button (click)="brushMode.set(!brushMode())" [class.bg-amber-400]="brushMode()" [class.text-slate-950]="brushMode()" [class.bg-slate-800]="!brushMode()" class="mt-2 min-h-11 w-full rounded-lg border border-slate-700 text-sm font-bold">
            {{brushMode() ? '✦ Brocha activa · tocar lote para pintar/despintar' : '◉ Activar brocha rápida'}}
          </button>
          <p class="mt-2 text-[11px] leading-relaxed text-slate-500">Con brocha activa, cada toque guarda de inmediato. Si el lote ya tiene el mismo supervisor y color, se despinta.</p>
        </section>

        <section class="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 class="mb-3 font-bold">Filtros y búsqueda</h2>
          <label class="mb-1 block text-xs text-slate-400">Fundo</label>
          <select [ngModel]="selectedFundo()" (ngModelChange)="selectedFundo.set($event)" class="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm">
            <option value="all">Todos los fundos</option>
            @for (f of repo.fundos(); track f.id) { <option [value]="f.id">{{f.name}}</option> }
          </select>
          <label class="mb-1 block text-xs text-slate-400">Módulo / capa</label>
          <select [ngModel]="selectedLayer()" (ngModelChange)="selectedLayer.set($event)" class="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm">
            <option value="all">Todas las capas</option>
            @for (layer of layers(); track layer) { <option [value]="layer">{{layer}}</option> }
          </select>
          <label class="mb-1 block text-xs text-slate-400">Turno</label>
          <select [ngModel]="selectedTurn()" (ngModelChange)="selectedTurn.set($event)" class="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm">
            <option value="all">Todos los turnos</option>
            @for (turn of turns(); track turn) { <option [value]="turn">{{turn}}</option> }
          </select>
          <input [ngModel]="search()" (ngModelChange)="search.set($event)" placeholder="Buscar lote o supervisor..." class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-emerald-500">
          <button (click)="selectAllFiltered()" class="mt-2 min-h-10 w-full rounded-lg border border-slate-700 bg-slate-800 text-sm font-semibold">Seleccionar todos los filtrados</button>
        </section>

        <section class="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div class="mb-3 flex items-center justify-between"><h2 class="font-bold">Indicadores</h2><span class="text-[10px] text-emerald-400">EN VIVO</span></div>
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-lg bg-slate-950 p-3"><p class="text-[10px] uppercase text-slate-500">Seleccionadas</p><p class="text-2xl font-bold text-amber-300">{{selectedHa() | number:'1.2-2'}} <small class="text-xs">ha</small></p><p class="text-xs text-slate-500">{{selectedLots().length}} lotes</p></div>
            <div class="rounded-lg bg-slate-950 p-3"><p class="text-[10px] uppercase text-slate-500">Programadas</p><p class="text-2xl font-bold text-emerald-400">{{programmedHa() | number:'1.2-2'}} <small class="text-xs">ha</small></p><p class="text-xs text-slate-500">{{programmedLots()}} lotes</p></div>
            <div class="rounded-lg bg-slate-950 p-3"><p class="text-[10px] uppercase text-slate-500">Visibles</p><p class="text-2xl font-bold">{{visibleHa() | number:'1.2-2'}} <small class="text-xs">ha</small></p><p class="text-xs text-slate-500">{{filteredLots().length}} lotes</p></div>
            <div class="rounded-lg bg-slate-950 p-3"><p class="text-[10px] uppercase text-slate-500">Fundos</p><p class="text-2xl font-bold">{{repo.fundos().length}}</p><p class="text-xs text-slate-500">importados</p></div>
          </div>
          <h3 class="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">Resumen por supervisor</h3>
          @for (s of summaries(); track s.supervisor) {
            <div class="mb-2 flex items-center justify-between rounded-lg bg-slate-950 px-3 py-2">
              <div class="flex items-center gap-2 text-sm"><span class="h-3 w-3 rounded-full" [style.background]="s.color"></span><span>{{s.supervisor}}</span></div>
              <div class="text-right"><p class="text-sm font-bold">{{s.hectares | number:'1.2-2'}} ha</p><p class="text-[10px] text-slate-500">{{s.lots}} lotes</p></div>
            </div>
          } @empty { <p class="text-xs text-slate-500">Aún no hay lotes asignados.</p> }
        </section>

        <section class="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div class="mb-2 flex items-center justify-between"><h2 class="font-bold">Lotes visibles</h2><span class="text-xs text-slate-500">{{filteredLots().length}}</span></div>
          <div class="max-h-64 space-y-1 overflow-auto">
            @for (lot of filteredLots(); track lot.uid) {
              <button (click)="toggleLot(lot.uid)" class="flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-left text-xs" [class.bg-amber-400/15]="selectedIds().has(lot.uid)" [class.ring-1]="selectedIds().has(lot.uid)" [class.ring-amber-300]="selectedIds().has(lot.uid)" [class.bg-slate-950]="!selectedIds().has(lot.uid)">
                <span class="min-w-0"><strong>{{lot.code}}</strong><span class="ml-2 text-slate-500">{{lot.layer}}</span><span class="block text-[10px] text-slate-500">{{lot.assignment?.supervisor || 'Sin asignar'}}</span></span>
                <span class="shrink-0 text-right">{{lot.areaHa | number:'1.2-2'}} ha<span class="ml-2 inline-block h-3 w-3 rounded-full" [style.background]="lot.assignment?.color || '#475569'"></span></span>
              </button>
            } @empty { <p class="p-3 text-xs text-slate-500">Importa un GeoJSON para ver los lotes.</p> }
          </div>
        </section>
      </aside>

      <section class="min-w-0 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <div><h2 class="font-bold">Plano catastral</h2><p class="text-xs text-slate-400">Satélite · selección táctil · asignación por color</p></div>
          <div class="flex flex-wrap items-center gap-3 text-xs">
            <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="showCodes" (change)="refreshMapStyles()"> Códigos</label>
            <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="showAreas" (change)="refreshMapStyles()"> Hectáreas</label>
            <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="showSupervisor" (change)="refreshMapStyles()"> Supervisor</label>
            <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="showRoads" (change)="toggleRoads()"> Mapa vial</label>
          </div>
        </div>
        <div #mapHost class="relative h-[62vh] min-h-[420px] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 lg:h-[calc(100vh-190px)] lg:min-h-[600px]">
          @if (!repo.fundos().length) {
            <div class="pointer-events-none absolute inset-0 z-[500] grid place-items-center bg-slate-950/45 p-6 text-center">
              <div class="max-w-sm rounded-2xl border border-slate-600 bg-slate-950/90 p-6 shadow-2xl">
                <div class="mb-3 text-4xl">🛰️</div><h3 class="text-lg font-bold">Carga tu plano de fundo</h3>
                <p class="mt-2 text-sm text-slate-400">Importa uno o varios archivos GeoJSON para visualizar y programar la cosecha.</p>
                <button (click)="fileInput.click()" class="mt-4 rounded-lg bg-emerald-500 px-4 py-3 font-bold text-slate-950">Seleccionar archivo</button>
              </div>
            </div>
          }
          @if (dragging()) {
            <div class="pointer-events-none absolute inset-0 z-[1000] grid place-items-center border-4 border-dashed border-emerald-400 bg-emerald-950/70 text-xl font-bold">Suelta aquí tus GeoJSON</div>
          }
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-xs text-slate-400">
          <span>● Amarillo: seleccionado · ● Color asignado: supervisor · ● Gris: sin asignar</span>
          <span>{{status()}}</span>
        </div>
      </section>
    </main>
    @if (selectedLots().length) {
      <div class="fixed bottom-3 left-3 right-3 z-[1100] mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/50 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
        <div><p class="text-xs text-slate-400">{{selectedLots().length}} lotes seleccionados</p><p class="text-lg font-bold text-amber-300">{{selectedHa() | number:'1.2-2'}} ha</p></div>
        <div class="flex gap-2"><button (click)="clearSelection()" class="min-h-11 rounded-lg border border-slate-700 px-4 text-sm">Cancelar</button><button (click)="applyPaint()" [disabled]="!supervisor.trim()" class="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-slate-950 disabled:opacity-40">Pintar</button></div>
      </div>
    }
    @if (toast()) {
      <div class="fixed right-4 top-20 z-[1200] max-w-sm rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm shadow-xl">{{toast()}}</div>
    }
  </div>
  `,
  styles: [`
    :host { display:block; }
    input[type="checkbox"] { accent-color:#34d399; width:16px; height:16px; }
    input[type="color"] { padding:3px; }
  `]
})
export class AppComponent implements AfterViewInit {
  @ViewChild('mapHost') mapHost!: ElementRef<HTMLDivElement>;
  private readonly destroyRef = inject(DestroyRef);
  readonly repo = inject(HarvestPlanRepository);
  private readonly parser = inject(GeoJsonParserService);
  private map?: L.Map;
  private polygonLayers = new Map<string, L.Path>();
  private roadLayer?: L.TileLayer;
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly brushMode = signal(false);
  readonly dragging = signal(false);
  readonly status = signal('Listo');
  readonly toast = signal('');
  supervisor = '';
  color = '#22c55e';
  readonly selectedFundo = signal('all');
  readonly selectedLayer = signal('all');
  readonly selectedTurn = signal('all');
  readonly search = signal('');
  showCodes = true;
  showAreas = false;
  showSupervisor = false;
  showRoads = false;
  readonly quickColors = ['#22c55e','#3b82f6','#f97316','#eab308','#a855f7','#ec4899','#06b6d4','#ef4444','#84cc16','#f8fafc'];

  readonly allLots = computed(() => this.repo.allLots());
  readonly layers = computed(() => [...new Set(this.allLots().map(l => l.layer))].sort((a,b)=>a.localeCompare(b,'es')));
  readonly turns = computed(() => [...new Set(this.allLots().map(l => l.turn))].sort((a,b) => this.turnNumber(a)-this.turnNumber(b)));
  readonly filteredLots = computed(() => {
    const q = this.search().trim().toLocaleLowerCase();
    return this.allLots().filter(l =>
      (this.selectedFundo() === 'all' || l.fundoId === this.selectedFundo()) &&
      (this.selectedLayer() === 'all' || l.layer === this.selectedLayer()) &&
      (this.selectedTurn() === 'all' || l.turn === this.selectedTurn()) &&
      (!q || l.code.toLocaleLowerCase().includes(q) || (l.assignment?.supervisor ?? '').toLocaleLowerCase().includes(q))
    );
  });
  readonly selectedLots = computed(() => {
    const ids = this.selectedIds();
    return this.allLots().filter(l => ids.has(l.uid));
  });
  readonly selectedHa = computed(() => this.selectedLots().reduce((s,l)=>s+l.areaHa,0));
  readonly visibleHa = computed(() => this.filteredLots().reduce((s,l)=>s+l.areaHa,0));
  readonly programmedLots = computed(() => this.allLots().filter(l=>!!l.assignment).length);
  readonly programmedHa = computed(() => this.allLots().filter(l=>!!l.assignment).reduce((s,l)=>s+l.areaHa,0));
  readonly summaries = computed<SupervisorSummary[]>(() => {
    const map = new Map<string, SupervisorSummary>();
    this.allLots().forEach(l => {
      if (!l.assignment) return;
      const key = l.assignment.supervisor.trim();
      const item = map.get(key) ?? { supervisor:key, color:l.assignment.color, lots:0, hectares:0 };
      item.lots++; item.hectares += l.areaHa; item.color = l.assignment.color; map.set(key,item);
    });
    return [...map.values()].sort((a,b)=>b.hectares-a.hectares);
  });
  readonly supervisorChips = computed(() => this.summaries());

  /*constructor() {
    this.repo.addFundo(createDemoFundo());
    effect(() => {
      this.repo.fundos();
      this.repo.assignments();
      if (this.map) this.syncVisibleLayers();
    });
    this.destroyRef.onDestroy(() => this.map?.remove());
  }*/

  ngAfterViewInit(): void {
    this.map = L.map(this.mapHost.nativeElement, { zoomControl: true, preferCanvas: true }).setView([-8.345, -78.84], 16);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
      maxZoom: 20
    }).addTo(this.map);
    this.map.on('click', () => { /* tap empty map intentionally does nothing */ });
    this.installDragDrop();
    this.syncVisibleLayers();
    this.fitCurrentFundo();
    setTimeout(() => { this.map?.invalidateSize(); this.fitCurrentFundo(); }, 150);
  }

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    await this.importFiles(files);
    input.value = '';
  }
  private async importFiles(files: File[]): Promise<void> {
    for (const file of files) {
      try {
        const text = await file.text();
        const fundo = this.parser.parseText(text, file.name);
        this.repo.addFundo(fundo);
        this.selectedFundo.set(fundo.id);
        this.selectedLayer.set('all');
        this.selectedTurn.set('all');
        this.search.set('');
        this.status.set(`${fundo.name}: ${fundo.lots.length} polígonos importados`);
        this.notify(`${fundo.name} importado · ${fundo.lots.length} elementos`);
      } catch (error) {
        this.notify(error instanceof Error ? error.message : 'Error al importar GeoJSON');
        this.status.set('Importación incompleta');
      }
    }
    this.syncVisibleLayers();
    setTimeout(() => { this.map?.invalidateSize(); this.fitCurrentFundo(); }, 120);
  }

  private installDragDrop(): void {
    const el = this.mapHost.nativeElement;
    el.addEventListener('dragover', this.onDragOver);
    el.addEventListener('dragleave', this.onDragLeave);
    el.addEventListener('drop', this.onDrop);
    this.destroyRef.onDestroy(() => {
      el.removeEventListener('dragover', this.onDragOver);
      el.removeEventListener('dragleave', this.onDragLeave);
      el.removeEventListener('drop', this.onDrop);
    });
  }
  private onDragOver = (e: DragEvent): void => { e.preventDefault(); this.dragging.set(true); };
  private onDragLeave = (e: DragEvent): void => { if (e.target === this.mapHost.nativeElement) this.dragging.set(false); };
  private onDrop = (e: DragEvent): void => {
    e.preventDefault(); this.dragging.set(false);
    const files = Array.from(e.dataTransfer?.files ?? []).filter(f => /\\.(geojson|json)$/i.test(f.name));
    void this.importFiles(files);
  };

  toggleLot(uid: string): void {
    if (this.brushMode()) { this.paintSingle(uid); return; }
    this.selectedIds.update(current => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
    this.refreshMapStyles();
  }
  private paintSingle(uid: string): void {
    if (!this.supervisor.trim()) { this.notify('Escribe el nombre del supervisor antes de usar la brocha.'); return; }
    const lot = this.allLots().find(l=>l.uid===uid);
    if (!lot) return;
    const same = lot.assignment?.supervisor === this.supervisor.trim() && lot.assignment?.color.toLowerCase() === this.color.toLowerCase();
    this.repo.setAssignment(uid, same ? null : this.newAssignment());
    this.refreshMapStyles();
  }
  applyPaint(): void {
    const ids = [...this.selectedIds()];
    if (!ids.length || !this.supervisor.trim()) return;
    this.repo.setMany(ids, this.newAssignment());
    this.selectedIds.set(new Set());
    this.refreshMapStyles();
    this.notify(`${ids.length} lotes asignados a ${this.supervisor.trim()}.`);
  }
  clearSelected(): void {
    const ids = [...this.selectedIds()];
    this.repo.setMany(ids, null);
    this.selectedIds.set(new Set());
    this.refreshMapStyles();
  }
  clearSelection(): void { this.selectedIds.set(new Set()); this.refreshMapStyles(); }
  selectAllFiltered(): void {
    this.selectedIds.update(current => new Set([...current, ...this.filteredLots().map(l=>l.uid)]));
    this.refreshMapStyles();
  }
  useSupervisor(item: SupervisorSummary): void { this.supervisor = item.supervisor; this.color = item.color; }
  private newAssignment(): LotAssignment { return { supervisor:this.supervisor.trim(), color:this.color, updatedAt:new Date().toISOString() }; }
  refreshMapStyles(): void { this.syncVisibleLayers(); }

  private syncVisibleLayers(): void {
    if (!this.map) return;
    const visible = new Set(this.filteredLots().map(l=>l.uid));
    for (const [uid, layer] of this.polygonLayers) {
      if (!visible.has(uid)) { this.map.removeLayer(layer); this.polygonLayers.delete(uid); }
    }
    for (const lot of this.filteredLots()) {
      let layer = this.polygonLayers.get(lot.uid);
      if (!layer) {
        const feature = { type:'Feature' as const, properties:{}, geometry:lot.geometry };
        const created = L.geoJSON(feature, {
          style: () => this.styleFor(lot),
          onEachFeature: (_f, child) => {
            child.on('click', (event: L.LeafletMouseEvent) => {
              L.DomEvent.stopPropagation(event);
              this.toggleLot(lot.uid);
            });
          }
        });
        const createdLayer = created.getLayers()[0] as L.Path | undefined;
        if (!createdLayer || !('setStyle' in createdLayer)) continue;
        this.polygonLayers.set(lot.uid, createdLayer);
        createdLayer.addTo(this.map);
        layer = createdLayer;
      }
      layer.setStyle(this.styleFor(lot));
      const label = this.labelFor(lot);
      if (this.showCodes || this.showAreas || this.showSupervisor) {
        if (layer.getTooltip()) layer.setTooltipContent(label);
        else layer.bindTooltip(label, { permanent:true, direction:'center', className:'lot-label', opacity:0.95 });
      } else if (layer.getTooltip()) layer.unbindTooltip();
    }
  }
  private styleFor(lot: HarvestLot): L.PathOptions {
    const selected = this.selectedIds().has(lot.uid);
    return {
      color: selected ? '#facc15' : lot.assignment?.color ?? '#e2e8f0',
      weight: selected ? 4 : lot.assignment ? 2.5 : 1.5,
      opacity: 1,
      fillColor: selected ? '#facc15' : lot.assignment?.color ?? '#64748b',
      fillOpacity: selected ? 0.48 : lot.assignment ? 0.48 : 0.12,
      dashArray: selected ? '5 3' : undefined
    };
  }
  private labelFor(lot: HarvestLot): string {
    const parts: string[] = [];
    if (this.showCodes) parts.push(lot.code);
    if (this.showAreas) parts.push(`${lot.areaHa.toFixed(2)} ha`);
    if (this.showSupervisor && lot.assignment) parts.push(lot.assignment.supervisor);
    return parts.join(' · ');
  }
  toggleRoads(): void {
    if (!this.map) return;
    if (this.showRoads) {
      this.roadLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap contributors', opacity:0.78 }).addTo(this.map);
    } else if (this.roadLayer) { this.map.removeLayer(this.roadLayer); this.roadLayer = undefined; }
  }
  private fitCurrentFundo(): void {
    if (!this.map) return;
    const lots = this.filteredLots();
    const group = L.featureGroup();
    for (const lot of lots) {
      const feature = { type:'Feature' as const, properties:{}, geometry:lot.geometry };
      L.geoJSON(feature).eachLayer(l=>group.addLayer(l));
    }
    if (group.getLayers().length) this.map.fitBounds(group.getBounds(), { padding:[24,24], maxZoom:18 });
  }
  private turnNumber(value: string): number { return Number(value.match(/\\d+/)?.[0] ?? 999); }
  private notify(message: string): void { this.toast.set(message); setTimeout(()=>this.toast.set(''), 5000); }
  exportJson(): void {
    const lots = this.allLots().filter(l=>!!l.assignment);
    const summary = this.summaries();
    const payload = { exportedAt:new Date().toISOString(), planDate:new Date(Date.now()+86400000).toISOString().slice(0,10), summary, lots:lots.map(l=>({ uid:l.uid, fundo:l.fundoName, layer:l.layer, fid:l.fid, code:l.code, turn:l.turn, areaHa:l.areaHa, supervisor:l.assignment?.supervisor, color:l.assignment?.color })) };
    const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='plan-cosecha.json'; a.click(); URL.revokeObjectURL(url);
    this.notify('Plan de cosecha exportado.');
  }
}
