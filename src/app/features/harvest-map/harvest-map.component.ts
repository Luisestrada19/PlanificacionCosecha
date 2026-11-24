import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  ViewChild, computed, effect, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { toPng } from 'html-to-image';
import { AuthService, AppProfile, AppRole } from '../../core/auth/auth.service';
import { HarvestPlanRepository } from '../../data/repositories/harvest-plan.repository';
import { GeoJsonParserService } from '../../data/services/geojson-parser.service';
import { Fundo, HarvestLot, LotAssignment, SupervisorSummary } from '../../domain/harvest.models';

@Component({
  selector: 'app-harvest-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <header class="border-b border-slate-800 bg-slate-950 px-4 py-3">
      <div class="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-xl">🌱</div>
          <div><h1 class="text-lg font-bold tracking-tight">Programación de cosecha</h1><p class="text-xs text-slate-400">Planificación para el día siguiente</p></div>
        </div>
        <div class="flex flex-wrap gap-2">
          @if (auth.isAdmin()) {
            <label class="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold hover:bg-slate-800">
              <input #fileInput type="file" accept=".geojson,.json,.kml,.kmz,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" multiple class="hidden" [disabled]="isSyncing()" (change)="onFiles($event)">
              <span>＋ Importar mapa</span>
            </label>
            <button (click)="openAdminPanel()" class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold">Usuarios</button>
          }
          <!--<button class="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-slate-950" (click)="exportJson()">↓ Exportar JSON</button>-->
          <button (click)="refreshRemote()" [disabled]="isSyncing()" class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold disabled:opacity-40">{{isSyncing() ? 'Actualizando…' : '↻ Actualizar mapas'}}</button>
          <span class="self-center text-xs text-slate-400">{{auth.user()?.email}}</span>
          <button (click)="openPasswordPanel()" class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold">Cambiar contraseña</button>
          <button (click)="signOut()" class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold">Cerrar Sesión</button>
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
            <button (click)="applyPaint()" [disabled]="!selectedLots().length || !supervisor.trim() || isSavingAssignments()" class="min-h-11 rounded-lg bg-emerald-500 px-3 text-sm font-bold text-slate-950 disabled:opacity-40">Pintar seleccionados</button>
            <button (click)="clearSelected()" [disabled]="!selectedLots().length || isSavingAssignments()" class="min-h-11 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm font-semibold disabled:opacity-40">Despintar</button>
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
            } @empty { <p class="p-3 text-xs text-slate-500">Importa un mapa GeoJSON, KML o KMZ para ver los lotes.</p> }
          </div>
        </section>
      </aside>

      <section #mapPanel class="map-panel min-w-0 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <div><h2 class="font-bold">Planito</h2><p class="text-xs text-slate-400">Satélite · selección táctil · asignación por color</p></div>
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex flex-wrap items-center gap-3 text-xs">
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="showCodes" (change)="refreshMapStyles()"> Códigos</label>
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="showAreas" (change)="refreshMapStyles()"> Hectáreas</label>
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="showSupervisor" (change)="refreshMapStyles()"> Supervisor</label>
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="showRoads" (change)="toggleRoads()"> Mapa vial</label>
            </div>
            <div class="flex flex-wrap gap-2">
              <button (click)="exportMapImage()" [disabled]="exporting() || selectedFundo() === 'all'" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold disabled:opacity-40">↓ PNG</button>
              <button (click)="exportMapPdf()" [disabled]="exporting() || selectedFundo() === 'all'" class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold disabled:opacity-40">↓ PDF</button>
              <button (click)="toggleMapFullscreen()" class="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950">{{isMapFullscreen() ? 'Salir de pantalla completa' : '⛶ Pantalla completa'}}</button>
            </div>
          </div>
        </div>
        <div #mapHost [class.exporting]="exporting()" class="map-canvas relative h-[62vh] min-h-[420px] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 lg:h-[calc(100vh-190px)] lg:min-h-[600px]">
          @if (exporting()) {
            <div class="pointer-events-none absolute left-4 top-4 z-[1000] rounded-lg bg-slate-950/90 px-4 py-3 shadow-lg">
              <p class="font-bold" [style.font-size.px]="exportHeaderNameFontSize">{{exportingFundoName()}}</p>
              <p class="text-slate-300" [style.font-size.px]="exportHeaderDateFontSize">Plan de cosecha · {{planDateLabel()}}</p>
            </div>
            <div class="pointer-events-none absolute bottom-5 left-5 z-[1000] max-w-[520px] rounded-xl border border-slate-600 bg-slate-950/95 px-4 py-3 shadow-2xl">
              <p class="mb-2 font-bold uppercase tracking-wide text-slate-300" [style.font-size.px]="exportLegendTitleFontSize">Leyenda de supervisores</p>
              <div class="grid grid-cols-2 gap-x-5 gap-y-1.5" [style.font-size.px]="exportLegendFontSize">
                @for (s of exportSupervisors(); track s.supervisor) {
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="shrink-0 rounded-sm border border-white/40" [style.width.px]="exportLegendSwatchSize" [style.height.px]="exportLegendSwatchSize" [style.background]="s.color"></span>
                    <span class="truncate font-semibold">{{s.supervisor}}</span>
                  </div>
                }
                @if (exportUnassignedLots()) {
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="shrink-0 rounded-sm border border-slate-300/70 bg-slate-500/30" [style.width.px]="exportLegendSwatchSize" [style.height.px]="exportLegendSwatchSize"></span>
                    <span class="truncate font-semibold">Sin asignar</span>
                  </div>
                }
              </div>
            </div>
          }
          @if (!repo.fundos().length) {
            <div class="pointer-events-none absolute inset-0 z-[500] grid place-items-center bg-slate-950/45 p-6 text-center">
              <div class="max-w-sm rounded-2xl border border-slate-600 bg-slate-950/90 p-6 shadow-2xl">
                <div class="mb-3 text-4xl">🛰️</div><h3 class="text-lg font-bold">Carga tu plano de fundo</h3>
                @if (auth.isAdmin()) {
                  <p class="mt-2 text-sm text-slate-400">Importa uno o varios archivos GeoJSON, KML o KMZ para visualizar y programar la cosecha.</p>
                  <button (click)="openFilePicker()" class="pointer-events-auto mt-4 rounded-lg bg-emerald-500 px-4 py-3 font-bold text-slate-950">Seleccionar archivo</button>
                } @else {
                  <p class="mt-2 text-sm text-slate-400">El administrador aún no ha cargado mapas compartidos para tu cuenta.</p>
                }
              </div>
            </div>
          }
          @if (dragging()) {
            <div class="pointer-events-none absolute inset-0 z-[1000] grid place-items-center border-4 border-dashed border-emerald-400 bg-emerald-950/70 text-xl font-bold">Suelta aquí tus mapas GeoJSON, KML o KMZ</div>
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
        <div class="flex gap-2"><button (click)="clearSelection()" class="min-h-11 rounded-lg border border-slate-700 px-4 text-sm">Cancelar</button><button (click)="applyPaint()" [disabled]="!supervisor.trim() || isSavingAssignments()" class="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-slate-950 disabled:opacity-40">Pintar</button></div>
      </div>
    }
    @if (toast()) {
      <div class="fixed right-4 top-20 z-[1200] max-w-sm rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm shadow-xl">{{toast()}}</div>
    }
    @if (!auth.isReady() || !auth.user()) {
      <div class="fixed inset-0 z-[3000] grid place-items-center bg-slate-950 p-4">
        <section class="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
          <div class="mb-3 text-4xl">🌱</div>
          <h1 class="text-xl font-bold">Planificador de cosecha</h1>
          @if (!auth.isReady()) {
            <p class="mt-3 text-sm text-slate-400">Verificando sesión…</p>
          } @else {
            <p class="mt-3 text-sm text-slate-400">Inicia sesión con tu cuenta administrada.</p>
            <form (submit)="login($event)" class="mt-5 space-y-3 text-left">
              <label class="block text-xs font-semibold text-slate-400">Correo
                <input [(ngModel)]="loginEmail" name="loginEmail" type="email" autocomplete="username" required class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100">
              </label>
              <label class="block text-xs font-semibold text-slate-400">Contraseña
                <input [(ngModel)]="loginPassword" name="loginPassword" type="password" autocomplete="current-password" required class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100">
              </label>
              <button type="submit" [disabled]="auth.isSigningIn()" class="min-h-11 w-full rounded-lg bg-emerald-500 px-4 font-bold text-slate-950 disabled:opacity-40">{{auth.isSigningIn() ? 'Ingresando…' : 'Ingresar'}}</button>
            </form>
          }
          @if (auth.error()) { <p class="mt-3 text-sm text-rose-300">{{auth.error()}}</p> }
        </section>
      </div>
    }
    @if (remoteError()) {
      <div class="fixed inset-0 z-[2900] grid place-items-center bg-slate-950 p-4">
        <section class="w-full max-w-lg rounded-2xl border border-rose-900 bg-slate-900 p-6 shadow-2xl">
          <h2 class="text-lg font-bold">No se pudo acceder a los datos del equipo</h2>
          <p class="mt-3 text-sm text-slate-300">{{remoteError()}}</p>
          <p class="mt-3 text-xs text-slate-400">Si es tu primera vez, el administrador debe crear y habilitar tu cuenta en Supabase.</p>
          <div class="mt-5 flex gap-2">
            <button (click)="refreshRemote()" [disabled]="isSyncing()" class="min-h-11 rounded-lg bg-emerald-500 px-4 font-bold text-slate-950 disabled:opacity-40">Reintentar</button>
            <button (click)="signOut()" class="min-h-11 rounded-lg border border-slate-700 px-4">Salir</button>
          </div>
        </section>
      </div>
    }
    @if (passwordPanel()) {
      <div class="fixed inset-0 z-[2870] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
        <form (submit)="changePassword($event)" class="w-full max-w-md space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
          <h2 class="text-lg font-bold">Cambiar contraseña</h2>
          <label class="block text-xs text-slate-400">Nueva contraseña
            <input [(ngModel)]="newPassword" name="newPassword" type="password" autocomplete="new-password" required minlength="8" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100">
          </label>
          <label class="block text-xs text-slate-400">Confirmar contraseña
            <input [(ngModel)]="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100">
          </label>
          <div class="flex gap-2">
            <button type="button" (click)="closePasswordPanel()" class="min-h-11 flex-1 rounded-lg border border-slate-700">Cancelar</button>
            <button type="submit" [disabled]="isChangingPassword()" class="min-h-11 flex-1 rounded-lg bg-emerald-500 font-bold text-slate-950 disabled:opacity-40">Guardar</button>
          </div>
        </form>
      </div>
    }
    @if (adminPanel()) {
      <div class="fixed inset-0 z-[2850] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
        <section class="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
          <div class="flex items-center justify-between gap-3">
            <div><h2 class="text-lg font-bold">Administración de usuarios</h2><p class="text-xs text-slate-400">Cuentas creadas por el administrador</p></div>
            <button (click)="closeAdminPanel()" class="min-h-10 rounded-lg border border-slate-700 px-3 text-sm">Cerrar</button>
          </div>
          <form (submit)="createSupervisor($event)" class="mt-4 grid gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4 md:grid-cols-2">
            <label class="text-xs text-slate-400">Nombre
              <input [(ngModel)]="newUserName" name="newUserName" required class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-slate-100">
            </label>
            <label class="text-xs text-slate-400">Correo
              <input [(ngModel)]="newUserEmail" name="newUserEmail" type="email" required class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-slate-100">
            </label>
            <label class="text-xs text-slate-400">Contraseña temporal
              <input [(ngModel)]="newUserPassword" name="newUserPassword" type="password" required minlength="8" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-slate-100">
            </label>
            <label class="text-xs text-slate-400">Rol
              <select [(ngModel)]="newUserRole" name="newUserRole" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-slate-100">
                <option value="supervisor">Supervisor</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <button type="submit" [disabled]="isManagingUsers()" class="min-h-11 rounded-lg bg-emerald-500 px-4 font-bold text-slate-950 md:col-span-2 disabled:opacity-40">{{isManagingUsers() ? 'Creando…' : 'Crear usuario'}}</button>
          </form>
          <div class="mt-4 max-h-72 space-y-2 overflow-auto">
            @for (user of users(); track user.id) {
              <div class="rounded-xl border border-slate-800 px-3 py-3">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div><p class="text-sm font-bold">{{user.fullName || user.email}}</p><p class="text-xs text-slate-400">{{user.email}} · {{user.role}}</p></div>
                  <div class="flex gap-2">
                    <button type="button" (click)="openEditUser(user)" [disabled]="user.id === auth.profile()?.id || isManagingUsers()" class="min-h-10 rounded-lg border border-slate-700 px-3 text-xs disabled:opacity-40">Editar</button>
                    <button type="button" (click)="toggleUser(user)" [disabled]="user.id === auth.profile()?.id || isManagingUsers()" class="min-h-10 rounded-lg border border-slate-700 px-3 text-xs disabled:opacity-40">{{user.enabled ? 'Deshabilitar' : 'Habilitar'}}</button>
                  </div>
                </div>
                @if (user.role === 'admin') {
                  <p class="mt-3 text-xs text-emerald-400">Acceso a todos los fundos.</p>
                } @else {
                  <p class="mt-3 text-xs font-semibold text-slate-400">Fundos asignados</p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    @for (fundo of repo.fundos(); track fundo.id) {
                      <label class="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs">
                        <input type="checkbox"
                          [checked]="hasFundoPermission(user.id, fundo.id)"
                          [disabled]="isManagingUsers()"
                          (change)="toggleFundoPermission(user, fundo.id)">
                        {{fundo.name}}
                      </label>
                    } @empty {
                      <p class="text-xs text-slate-500">Carga un fundo antes de asignar permisos.</p>
                    }
                  </div>
                }
              </div>
            } @empty { <p class="py-4 text-center text-xs text-slate-500">No hay usuarios registrados.</p> }
          </div>
        </section>
      </div>
    }
    @if (editingUser()) {
      <div class="fixed inset-0 z-[2900] grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm">
        <form (submit)="saveUserEdits($event)" class="w-full max-w-md space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
          <h2 class="text-lg font-bold">Editar usuario</h2>
          <label class="block text-xs text-slate-400">Nombre
            <input [(ngModel)]="editUserName" name="editUserName" required class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100">
          </label>
          <label class="block text-xs text-slate-400">Correo
            <input [(ngModel)]="editUserEmail" name="editUserEmail" type="email" required class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100">
          </label>
          <label class="block text-xs text-slate-400">Rol
            <select [(ngModel)]="editUserRole" name="editUserRole" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100">
              <option value="supervisor">Supervisor</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <label class="block text-xs text-slate-400">Contraseña temporal (opcional)
            <input [(ngModel)]="editUserTemporaryPassword" name="editUserTemporaryPassword" type="password" autocomplete="new-password" minlength="8" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100">
          </label>
          <p class="text-xs text-slate-500">Déjala vacía para conservar la contraseña actual. Si la asignas, debe tener al menos 8 caracteres.</p>
          <div class="flex gap-2">
            <button type="button" (click)="closeEditUser()" [disabled]="isManagingUsers()" class="min-h-11 flex-1 rounded-lg border border-slate-700 disabled:opacity-40">Cancelar</button>
            <button type="submit" [disabled]="isManagingUsers()" class="min-h-11 flex-1 rounded-lg bg-emerald-500 font-bold text-slate-950 disabled:opacity-40">{{isManagingUsers() ? 'Guardando…' : 'Guardar cambios'}}</button>
          </div>
        </form>
      </div>
    }
    @if (repo.hasLocalFundsToSync()) {
      <div class="fixed inset-0 z-[2800] grid place-items-center bg-slate-950 p-4">
        <section class="w-full max-w-lg rounded-2xl border border-amber-700 bg-slate-900 p-6 shadow-2xl">
          <h2 class="text-lg font-bold">Subir los mapas guardados en este navegador</h2>
          <p class="mt-3 text-sm text-slate-300">Se encontraron {{repo.localFundsToSyncCount()}} fundos locales. Se guardarán como GeoJSON versionados en Supabase junto con sus asignaciones actuales para compartirlos con el equipo.</p>
          <p class="mt-3 text-xs text-slate-400">Se migran las geometrías y propiedades disponibles en la app; conserva los archivos GeoJSON originales como respaldo.</p>
          <button (click)="migrateLocalData()" [disabled]="isSyncing()" class="mt-5 min-h-11 rounded-lg bg-emerald-500 px-4 font-bold text-slate-950 disabled:opacity-40">{{isSyncing() ? 'Subiendo…' : 'Subir mapas y asignaciones'}}</button>
        </section>
      </div>
    }
  </div>
  `,
  styles: [`
    :host { display:block; }
    input[type="checkbox"] { accent-color:#34d399; width:16px; height:16px; }
    input[type="color"] { padding:3px; }
    .map-panel:fullscreen {
      box-sizing:border-box;
      display:flex;
      flex-direction:column;
      width:100vw;
      height:100vh;
      padding:1rem;
      overflow:auto;
      background:#020617;
    }
    .map-panel:fullscreen .map-canvas {
      height:calc(100vh - 170px) !important;
      min-height:0 !important;
      flex:1;
    }
    .map-canvas.exporting .leaflet-control-container {
      display:none;
    }
    .map-canvas.exporting .leaflet-control-zoom {
      display:none !important;
    }
  `]
})
export class HarvestMapComponent implements AfterViewInit {
  // CONFIGURACION EXPORTACION PNG/PDF
  // - Para acercar o alejar: aumentar/disminuir exportPadding; cambiar exportMaxZoom.
  // - Tamaño base de la imagen: exportWidth y exportHeight.
  private readonly exportWidth = 2560;
  private readonly exportHeight = 1440;
  private readonly exportPadding: [number, number] = [25, 25];
  private readonly exportMaxZoom = 100;
  private readonly pdfPageMargin = 5;
  readonly exportLotLabelFontSize = 24;
  readonly exportLegendFontSize = 24;
  readonly exportLegendTitleFontSize = 30;
  readonly exportHeaderNameFontSize = 40;
  readonly exportHeaderDateFontSize = 24;
  readonly exportLegendSwatchSize = 24;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('mapHost') mapHost!: ElementRef<HTMLDivElement>;
  @ViewChild('mapPanel') mapPanel!: ElementRef<HTMLElement>;
  private readonly destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthService);
  readonly repo = inject(HarvestPlanRepository);
  private readonly parser = inject(GeoJsonParserService);
  private map?: L.Map;
  private zoomControl?: L.Control.Zoom;
  private polygonLayers = new Map<string, L.Path>();
  private roadLayer?: L.TileLayer;
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly brushMode = signal(false);
  readonly dragging = signal(false);
  readonly exporting = signal(false);
  readonly exportingFundoName = signal('');
  readonly isMapFullscreen = signal(false);
  readonly isSyncing = signal(false);
  readonly isSavingAssignments = signal(false);
  readonly isManagingUsers = signal(false);
  readonly isChangingPassword = signal(false);
  readonly passwordPanel = signal(false);
  readonly adminPanel = signal(false);
  readonly editingUser = signal<AppProfile | null>(null);
  readonly users = signal<AppProfile[]>([]);
  readonly userFundoPermissions = signal<Record<string, string[]>>({});
  readonly remoteError = signal('');
  readonly status = signal('Listo');
  readonly toast = signal('');
  loginEmail = '';
  loginPassword = '';
  newUserName = '';
  newUserEmail = '';
  newUserPassword = '';
  newPassword = '';
  confirmPassword = '';
  editUserName = '';
  editUserEmail = '';
  editUserRole: AppRole = 'supervisor';
  editUserTemporaryPassword = '';
  newUserRole: 'admin' | 'supervisor' = 'supervisor';
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
  readonly quickColors = ['#22c55e', '#3b82f6', '#f97316', '#eab308', '#a855f7', '#ec4899', '#06b6d4', '#ef4444', '#84cc16', '#f8fafc'];

  readonly allLots = computed(() => this.repo.allLots());
  readonly layers = computed(() => [...new Set(this.allLots().map(l => l.layer))].sort((a, b) => a.localeCompare(b, 'es')));
  readonly turns = computed(() => [...new Set(this.allLots().map(l => l.turn))].sort((a, b) => this.turnNumber(a) - this.turnNumber(b)));
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
  readonly selectedHa = computed(() => this.selectedLots().reduce((s, l) => s + l.areaHa, 0));
  readonly visibleHa = computed(() => this.filteredLots().reduce((s, l) => s + l.areaHa, 0));
  readonly programmedLots = computed(() => this.allLots().filter(l => !!l.assignment).length);
  readonly programmedHa = computed(() => this.allLots().filter(l => !!l.assignment).reduce((s, l) => s + l.areaHa, 0));
  readonly summaries = computed<SupervisorSummary[]>(() => {
    const map = new Map<string, SupervisorSummary>();
    this.allLots().forEach(l => {
      if (!l.assignment) return;
      const key = l.assignment.supervisor.trim();
      const item = map.get(key) ?? { supervisor: key, color: l.assignment.color, lots: 0, hectares: 0 };
      item.lots++; item.hectares += l.areaHa; item.color = l.assignment.color; map.set(key, item);
    });
    return [...map.values()].sort((a, b) => b.hectares - a.hectares);
  });
  readonly supervisorChips = computed(() => this.summaries());
  readonly exportSupervisors = computed<SupervisorSummary[]>(() => {
    const fundoId = this.selectedFundo();
    if (fundoId === 'all') return [];
    const map = new Map<string, SupervisorSummary>();
    this.allLots().filter(lot => lot.fundoId === fundoId).forEach(lot => {
      if (!lot.assignment) return;
      const key = lot.assignment.supervisor.trim();
      const item = map.get(key) ?? { supervisor: key, color: lot.assignment.color, lots: 0, hectares: 0 };
      item.lots++;
      item.hectares += lot.areaHa;
      item.color = lot.assignment.color;
      map.set(key, item);
    });
    return [...map.values()].sort((a, b) => a.supervisor.localeCompare(b.supervisor, 'es'));
  });
  readonly exportUnassignedLots = computed(() => {
    const fundoId = this.selectedFundo();
    if (fundoId === 'all') return 0;
    return this.allLots().filter(lot => lot.fundoId === fundoId && !lot.assignment).length;
  });

  private loadedUserId = '';

  constructor() {
    effect(() => {
      const ready = this.auth.isReady();
      const user = this.auth.user();
      if (!ready) return;
      if (!user) {
        this.loadedUserId = '';
        this.remoteError.set('');
        this.repo.clearInMemory();
        this.syncVisibleLayers();
        return;
      }
      if (this.loadedUserId === user.id) return;
      this.loadedUserId = user.id;
      void this.loadRemoteData();
    });
    this.destroyRef.onDestroy(() => this.map?.remove());
  }

  async login(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await this.auth.signIn(this.loginEmail, this.loginPassword);
  }
  openFilePicker(): void {
    if (this.auth.isAdmin()) this.fileInput?.nativeElement.click();
  }
  openPasswordPanel(): void {
    this.newPassword = '';
    this.confirmPassword = '';
    this.passwordPanel.set(true);
  }
  closePasswordPanel(): void { this.passwordPanel.set(false); }
  async changePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.newPassword !== this.confirmPassword) {
      this.notify('Las contraseñas no coinciden.');
      return;
    }
    this.isChangingPassword.set(true);
    try {
      await this.auth.updatePassword(this.newPassword);
      this.passwordPanel.set(false);
      this.newPassword = '';
      this.confirmPassword = '';
      this.notify('Contraseña actualizada.');
    } catch (error) {
      this.notify(`No se pudo cambiar la contraseña: ${this.errorMessage(error)}`);
    } finally {
      this.isChangingPassword.set(false);
    }
  }
  async openAdminPanel(): Promise<void> {
    if (!this.auth.isAdmin()) return;
    this.adminPanel.set(true);
    await this.loadUsers();
  }
  closeAdminPanel(): void { this.adminPanel.set(false); }
  openEditUser(user: AppProfile): void {
    if (!this.auth.isAdmin() || user.id === this.auth.profile()?.id) return;
    this.editingUser.set(user);
    this.editUserName = user.fullName;
    this.editUserEmail = user.email;
    this.editUserRole = user.role;
    this.editUserTemporaryPassword = '';
  }
  closeEditUser(): void {
    this.editingUser.set(null);
    this.editUserTemporaryPassword = '';
  }
  async saveUserEdits(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const user = this.editingUser();
    if (!user || !this.auth.isAdmin()) return;
    this.isManagingUsers.set(true);
    try {
      await this.auth.updateManagedUser({
        id: user.id,
        email: this.editUserEmail,
        fullName: this.editUserName,
        role: this.editUserRole,
        ...(this.editUserTemporaryPassword
          ? { temporaryPassword: this.editUserTemporaryPassword }
          : {})
      });
      this.closeEditUser();
      await this.loadUsers();
      this.notify('Usuario actualizado correctamente.');
    } catch (error) {
      this.notify(`No se pudo actualizar el usuario: ${this.errorMessage(error)}`);
      this.isManagingUsers.set(false);
    }
  }
  private async loadUsers(): Promise<void> {
    this.isManagingUsers.set(true);
    try {
      const users = await this.auth.listUsers();
      this.users.set(users);
      const permissions: Record<string, string[]> = {};
      await Promise.all(users.map(async user => {
        permissions[user.id] = await this.auth.listFundoPermissions(user.id);
      }));
      this.userFundoPermissions.set(permissions);
    } catch (error) {
      this.notify(`No se pudieron cargar los usuarios: ${this.errorMessage(error)}`);
    } finally {
      this.isManagingUsers.set(false);
    }
  }
  async createSupervisor(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!this.auth.isAdmin()) return;
    this.isManagingUsers.set(true);
    try {
      await this.auth.createUser({
        email: this.newUserEmail,
        password: this.newUserPassword,
        fullName: this.newUserName,
        role: this.newUserRole
      });
      this.newUserName = '';
      this.newUserEmail = '';
      this.newUserPassword = '';
      this.newUserRole = 'supervisor';
      await this.loadUsers();
      this.notify('Usuario creado correctamente.');
    } catch (error) {
      this.notify(`No se pudo crear el usuario: ${this.errorMessage(error)}`);
      this.isManagingUsers.set(false);
    }
  }

  hasFundoPermission(userId: string, fundoId: string): boolean {
    return (this.userFundoPermissions()[userId] ?? []).includes(fundoId);
  }

  async toggleFundoPermission(user: AppProfile, fundoId: string): Promise<void> {
    if (user.role === 'admin') {
      this.notify('Los administradores tienen acceso a todos los fundos.');
      return;
    }
    const current = this.userFundoPermissions()[user.id] ?? [];
    const next = current.includes(fundoId)
      ? current.filter(id => id !== fundoId)
      : [...current, fundoId];
    this.isManagingUsers.set(true);
    try {
      await this.auth.setFundoPermissions(user.id, next);
      this.userFundoPermissions.update(values => ({ ...values, [user.id]: next }));
      this.notify(`Permisos de ${user.fullName || user.email} actualizados.`);
    } catch (error) {
      this.notify(`No se pudieron actualizar los permisos: ${this.errorMessage(error)}`);
    } finally {
      this.isManagingUsers.set(false);
    }
  }
  async toggleUser(user: AppProfile): Promise<void> {
    if (!this.auth.isAdmin() || user.id === this.auth.profile()?.id) return;
    this.isManagingUsers.set(true);
    try {
      await this.auth.setUserEnabled(user.id, !user.enabled);
      await this.loadUsers();
      this.notify(`Usuario ${user.enabled ? 'deshabilitado' : 'habilitado'}.`);
    } catch (error) {
      this.notify(`No se pudo actualizar el usuario: ${this.errorMessage(error)}`);
      this.isManagingUsers.set(false);
    }
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.mapHost.nativeElement, {
      zoomControl: false,
      preferCanvas: true,
      zoomAnimation: true,
      markerZoomAnimation: false
    }).setView([-8.345, -78.84], 16);
    this.zoomControl = L.control.zoom({ position: 'topleft' }).addTo(this.map);
    this.map.on('zoomend moveend', () => this.syncVisibleLayers());
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
      maxZoom: 20,
      crossOrigin: true
    }).addTo(this.map);
    this.map.on('click', () => { /* tap empty map intentionally does nothing */ });
    if (this.auth.isAdmin()) this.installDragDrop();
    this.syncVisibleLayers();
    this.fitCurrentFundo();
    setTimeout(() => { this.map?.invalidateSize(); this.fitCurrentFundo(); }, 150);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.destroyRef.onDestroy(() => document.removeEventListener('fullscreenchange', this.onFullscreenChange));
  }

  private async loadRemoteData(): Promise<void> {
    this.isSyncing.set(true);
    this.remoteError.set('');
    this.status.set('Sincronizando mapas del equipo…');
    try {
      await this.repo.refreshFromRemote();
      const currentFundo = this.selectedFundo();
      if (currentFundo !== 'all' && !this.repo.fundos().some(fundo => fundo.id === currentFundo)) {
        this.selectedFundo.set(this.repo.fundos()[0]?.id ?? 'all');
      }
      this.syncVisibleLayers();
      this.fitCurrentFundo();
      this.status.set(`${this.repo.fundos().length - this.repo.localFundsToSyncCount()} fundos sincronizados`);
    } catch (error) {
      this.repo.clearInMemory();
      this.syncVisibleLayers();
      this.selectedFundo.set('all');
      this.remoteError.set(this.errorMessage(error));
      this.status.set('Error de sincronización');
    } finally {
      this.isSyncing.set(false);
    }
  }
  refreshRemote(): Promise<void> {
    return this.loadRemoteData();
  }
  async signOut(): Promise<void> {
    try {
      await this.auth.signOut();
    } catch (error) {
      this.notify(`No se pudo cerrar la sesión: ${this.errorMessage(error)}`);
    }
  }
  async migrateLocalData(): Promise<void> {
    this.isSyncing.set(true);
    try {
      await this.repo.uploadLocalFunds();
      this.notify('Mapas y asignaciones locales subidos a Supabase.');
      await this.loadRemoteData();
    } catch (error) {
      const message = this.errorMessage(error);
      this.remoteError.set(message);
      this.notify(`No se pudo completar la migración: ${message}`);
    } finally {
      this.isSyncing.set(false);
    }
  }

  async onFiles(event: Event): Promise<void> {
    if (!this.auth.isAdmin()) {
      this.notify('Solo el administrador puede importar GeoJSON.');
      return;
    }
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    await this.importFiles(files);
    input.value = '';
  }
  private async importFiles(files: File[]): Promise<void> {
    if (!this.auth.isAdmin()) {
      this.notify('Solo el administrador puede importar GeoJSON.');
      return;
    }
    for (const file of files) {
      try {
        const fundoName = this.parser.fundoNameFromFileName(file.name);
        const existing = this.repo.fundos().find(item => item.name.toLocaleLowerCase('es') === fundoName.toLocaleLowerCase('es'));
        const fundoId = existing?.id ?? crypto.randomUUID();
        const fundo = await this.parser.parseFile(file, fundoId);
        this.status.set(`Subiendo ${file.name}…`);
        await this.repo.addFundo(fundo, file);
        this.selectedFundo.set(fundo.id);
        this.selectedLayer.set('all');
        this.selectedTurn.set('all');
        this.search.set('');
        this.status.set(`${fundo.name}: ${fundo.lots.length} polígonos importados`);
        this.notify(`${fundo.name} importado · ${fundo.lots.length} elementos`);
      } catch (error) {
        this.notify(`No se pudo importar el archivo: ${this.errorMessage(error)}`);
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
    const files = Array.from(e.dataTransfer?.files ?? []).filter(f => /\.(geojson|json|kml|kmz)$/i.test(f.name));
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
    const lot = this.allLots().find(l => l.uid === uid);
    if (!lot) return;
    const same = lot.assignment?.supervisor === this.supervisor.trim() && lot.assignment?.color.toLowerCase() === this.color.toLowerCase();
    void this.saveAssignments(() => this.repo.setAssignment(uid, same ? null : this.newAssignment()));
  }
  applyPaint(): void {
    const ids = [...this.selectedIds()];
    if (!ids.length || !this.supervisor.trim()) return;
    const supervisor = this.supervisor.trim();
    void this.saveAssignments(() => this.repo.setMany(ids, this.newAssignment()), () => {
      this.selectedIds.set(new Set());
      this.notify(`${ids.length} lotes asignados a ${supervisor}.`);
    });
  }
  clearSelected(): void {
    const ids = [...this.selectedIds()];
    void this.saveAssignments(() => this.repo.setMany(ids, null), () => this.selectedIds.set(new Set()));
  }
  clearSelection(): void { this.selectedIds.set(new Set()); this.refreshMapStyles(); }
  selectAllFiltered(): void {
    this.selectedIds.update(current => new Set([...current, ...this.filteredLots().map(l => l.uid)]));
    this.refreshMapStyles();
  }
  useSupervisor(item: SupervisorSummary): void { this.supervisor = item.supervisor; this.color = item.color; }
  private newAssignment(): LotAssignment { return { supervisor: this.supervisor.trim(), color: this.color, updatedAt: new Date().toISOString() }; }
  refreshMapStyles(): void { this.syncVisibleLayers(); }
  private async saveAssignments(save: () => Promise<void>, afterSave?: () => void): Promise<void> {
    if (this.isSavingAssignments()) return;
    this.isSavingAssignments.set(true);
    try {
      await save();
      afterSave?.();
      this.refreshMapStyles();
    } catch (error) {
      this.notify(`No se pudo guardar la asignación: ${this.errorMessage(error)}`);
    } finally {
      this.isSavingAssignments.set(false);
    }
  }

  private syncVisibleLayers(): void {
    if (!this.map) return;
    const visible = new Set(this.filteredLots().map(l => l.uid));
    const showLabels = this.exporting() || this.map.getZoom() >= 15;
    for (const [uid, layer] of this.polygonLayers) {
      if (!visible.has(uid)) { this.map.removeLayer(layer); this.polygonLayers.delete(uid); }
    }
    for (const lot of this.filteredLots()) {
      let layer = this.polygonLayers.get(lot.uid);
      if (!layer) {
        const feature = { type: 'Feature' as const, properties: {}, geometry: lot.geometry };
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
      if (showLabels && (this.showCodes || this.showAreas || this.showSupervisor)) {
        if (layer.getTooltip()) layer.setTooltipContent(label);
        else layer.bindTooltip(label, { permanent: true, direction: 'center', className: 'lot-label', opacity: 0.95 });
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
      this.roadLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors', opacity: 0.78, crossOrigin: true }).addTo(this.map);
    } else if (this.roadLayer) { this.map.removeLayer(this.roadLayer); this.roadLayer = undefined; }
  }
  private fitCurrentFundo(exportMode = false): void {
    if (!this.map) return;
    const lots = this.filteredLots();
    const group = L.featureGroup();
    for (const lot of lots) {
      const feature = { type: 'Feature' as const, properties: {}, geometry: lot.geometry };
      L.geoJSON(feature).eachLayer(l => group.addLayer(l));
    }
    if (group.getLayers().length) {
      this.map.fitBounds(group.getBounds(), {
        padding: exportMode ? this.exportPadding : [24, 24],
        maxZoom: exportMode ? this.exportMaxZoom : 18
      });
    }
  }
  private turnNumber(value: string): number { return Number(value.match(/\d+/)?.[0] ?? 999); }
  private notify(message: string): void { this.toast.set(message); setTimeout(() => this.toast.set(''), 5000); }
  private onFullscreenChange = (): void => {
    this.isMapFullscreen.set(document.fullscreenElement === this.mapPanel.nativeElement);
    setTimeout(() => this.map?.invalidateSize({ pan: false }), 100);
  };
  toggleMapFullscreen(): void {
    const panel = this.mapPanel.nativeElement;
    if (document.fullscreenElement === panel) {
      void document.exitFullscreen().catch(error => this.notify(`No se pudo salir de pantalla completa: ${this.errorMessage(error)}`));
      return;
    }
    if (!panel.requestFullscreen) {
      this.notify('Este navegador no permite pantalla completa para el mapa.');
      return;
    }
    void panel.requestFullscreen().catch(error => this.notify(`No se pudo activar pantalla completa: ${this.errorMessage(error)}`));
  }
  planDateLabel(): string {
    const planDate = new Date();
    planDate.setDate(planDate.getDate() + 1);
    return planDate.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  async exportMapImage(): Promise<void> {
    try {
      const { image, fundo } = await this.captureFundoMap();
      this.downloadMapFile(image, `${this.fundoFileName(fundo)}-mapa.png`);
      this.notify('Mapa exportado como PNG.');
    } catch (error) {
      this.notify(`No se pudo exportar el mapa: ${this.errorMessage(error)}`);
    }
  }
  async exportMapPdf(): Promise<void> {
    try {
      const { image, fundo } = await this.captureFundoMap();
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const imageSize = pdf.getImageProperties(image);
      const pageWidth = pdf.internal.pageSize.getWidth() - (this.pdfPageMargin * 2);
      const pageHeight = pdf.internal.pageSize.getHeight() - (this.pdfPageMargin * 2);
      const scale = Math.min(pageWidth / imageSize.width, pageHeight / imageSize.height);
      const width = imageSize.width * scale;
      const height = imageSize.height * scale;
      pdf.addImage(image, 'PNG',
        (pdf.internal.pageSize.getWidth() - width) / 2,
        (pdf.internal.pageSize.getHeight() - height) / 2,
        width, height);
      pdf.save(`${this.fundoFileName(fundo)}-mapa.pdf`);
      this.notify('Mapa exportado como PDF.');
    } catch (error) {
      this.notify(`No se pudo exportar el mapa: ${this.errorMessage(error)}`);
    }
  }
  private async captureFundoMap(): Promise<{ image: string; fundo: Fundo }> {
    const fundo = this.repo.fundos().find(item => item.id === this.selectedFundo());
    if (!fundo) throw new Error('Selecciona un fundo específico antes de exportar.');
    if (!this.map) throw new Error('El mapa todavía no está listo.');

    const previousLayer = this.selectedLayer();
    const previousTurn = this.selectedTurn();
    const previousSearch = this.search();
    const previousSelection = this.selectedIds();
    const previousCenter = this.map.getCenter();
    const previousZoom = this.map.getZoom();
    const previousWidth = this.mapHost.nativeElement.style.width;
    const previousHeight = this.mapHost.nativeElement.style.height;
    const previousShowCodes = this.showCodes;
    const previousShowAreas = this.showAreas;
    const previousShowSupervisor = this.showSupervisor;
    this.exportingFundoName.set(fundo.name);
    this.exporting.set(true);
    if (this.zoomControl) this.map.removeControl(this.zoomControl);
    try {
      this.mapHost.nativeElement.style.width = `${this.exportWidth}px`;
      this.mapHost.nativeElement.style.height = `${this.exportHeight}px`;
      this.mapHost.nativeElement.style.setProperty('--export-lot-label-font-size', `${this.exportLotLabelFontSize}px`);
      this.selectedLayer.set('all');
      this.selectedTurn.set('all');
      this.search.set('');
      this.selectedIds.set(new Set());
      this.showCodes = true;
      this.showAreas = false;
      this.showSupervisor = false;
      this.map.invalidateSize({ pan: false });
      this.syncVisibleLayers();
      this.fitCurrentFundo(true);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(), 350))));
      const image = await toPng(this.mapHost.nativeElement, { pixelRatio: 1.5, cacheBust: true, backgroundColor: '#0f172a' });
      return { image, fundo };
    } finally {
      this.mapHost.nativeElement.style.width = previousWidth;
      this.mapHost.nativeElement.style.height = previousHeight;
      this.mapHost.nativeElement.style.removeProperty('--export-lot-label-font-size');
      this.selectedLayer.set(previousLayer);
      this.selectedTurn.set(previousTurn);
      this.search.set(previousSearch);
      this.selectedIds.set(previousSelection);
      this.showCodes = previousShowCodes;
      this.showAreas = previousShowAreas;
      this.showSupervisor = previousShowSupervisor;
      this.syncVisibleLayers();
      this.map.setView(previousCenter, previousZoom, { animate: false });
      if (this.zoomControl) this.map.addControl(this.zoomControl);
      this.exporting.set(false);
      setTimeout(() => this.map?.invalidateSize({ pan: false }), 100);
    }
  }
  private downloadMapFile(dataUrl: string, fileName: string): void {
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  private fundoFileName(fundo: Fundo): string {
    const name = fundo.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return name || 'fundo';
  }
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Error inesperado.';
  }
  exportJson(): void {
    const lots = this.allLots().filter(l => !!l.assignment);
    const summary = this.summaries();
    const payload = { exportedAt: new Date().toISOString(), planDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), summary, lots: lots.map(l => ({ uid: l.uid, fundo: l.fundoName, layer: l.layer, fid: l.fid, code: l.code, turn: l.turn, areaHa: l.areaHa, supervisor: l.assignment?.supervisor, color: l.assignment?.color })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'plan-cosecha.json'; a.click(); URL.revokeObjectURL(url);
    this.notify('Plan de cosecha exportado.');
  }
}
