import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { FunctionsHttpError, type User } from '@supabase/supabase-js';
import { supabase } from '../config/supabase.client';

export type AppRole = 'admin' | 'supervisor';
export interface AppProfile {
  id: string;
  email: string;
  role: AppRole;
  fullName: string;
  enabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(null);
  readonly isReady = signal(false);
  readonly isSigningIn = signal(false);
  readonly error = signal('');
  readonly profile = signal<AppProfile | null>(null);
  readonly isAdmin = signal(false);
  readonly isSupervisor = signal(false);

  constructor() {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      this.user.set(session?.user ?? null);
      this.isReady.set(true);
      if (session?.user) void this.loadProfile(session.user);
      else this.clearProfile();
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
    void this.restoreSession();
  }

  async signIn(email: string, password: string): Promise<void> {
    this.error.set('');
    this.isSigningIn.set(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });
      if (error) throw error;
      this.isSigningIn.set(false);
    } catch (error) {
      const message = this.errorMessage(error);
      if (message.includes('500') || message.toLowerCase().includes('unexpected')) {
        this.error.set('El servidor rechazó el inicio de sesión. Verifica que Email Auth esté habilitado y que el usuario admin exista como cuenta confirmada.');
      } else {
        this.error.set(message);
      }
      this.isSigningIn.set(false);
    }
  }

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }

  async createUser(input: { email:string; password:string; fullName:string; role:'admin'|'supervisor' }): Promise<void> {
    if (!this.isAdmin()) throw new Error('Solo el administrador puede crear usuarios.');
    const { error } = await supabase.functions.invoke('create-team-user', { body: input });
    if (error) await this.throwFunctionError(error);
  }

  async updateManagedUser(input: {
    id: string;
    email: string;
    fullName: string;
    role: AppRole;
    temporaryPassword?: string;
  }): Promise<void> {
    if (!this.isAdmin()) throw new Error('Solo el administrador puede editar usuarios.');
    const { error } = await supabase.functions.invoke('update-team-user', { body: input });
    if (error) await this.throwFunctionError(error);
  }

  async listUsers(): Promise<AppProfile[]> {
    if (!this.isAdmin()) throw new Error('Solo el administrador puede consultar usuarios.');
    const { data, error } = await supabase
      .from('app_profiles')
      .select('id,email,role,full_name,enabled')
      .order('email');
    if (error) throw error;
    return (data ?? []).map(row => ({
      id: row.id,
      email: row.email,
      role: row.role,
      fullName: row.full_name,
      enabled: row.enabled
    }));
  }

  async setUserEnabled(userId: string, enabled: boolean): Promise<void> {
    if (!this.isAdmin()) throw new Error('Solo el administrador puede cambiar usuarios.');
    const { error } = await supabase
      .from('app_profiles')
      .update({ enabled })
      .eq('id', userId);
    if (error) throw error;
  }

  async listFundoPermissions(userId: string): Promise<string[]> {
    if (!this.isAdmin()) throw new Error('Solo el administrador puede consultar permisos.');
    const { data, error } = await supabase
      .from('user_fundo_permissions')
      .select('fundo_id')
      .eq('user_id', userId);
    if (error) throw error;
    return (data ?? []).map(row => row.fundo_id);
  }

  async setFundoPermissions(userId: string, fundoIds: string[]): Promise<void> {
    if (!this.isAdmin()) throw new Error('Solo el administrador puede asignar fundos.');
    const { error } = await supabase.rpc('set_user_fundo_permissions', {
      p_user_id: userId,
      p_fundo_ids: [...new Set(fundoIds)]
    });
    if (error) throw error;
  }

  private async restoreSession(): Promise<void> {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      this.user.set(data.session?.user ?? null);
      if (data.session?.user) await this.loadProfile(data.session.user);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.isReady.set(true);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'No se pudo completar la autenticación.';
  }

  private async throwFunctionError(error: Error): Promise<never> {
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.clone().json() as { error?: string; message?: string };
        const message = body.error || body.message;
        if (message) throw new Error(message);
      } catch (responseError) {
        if (responseError instanceof Error && !(responseError instanceof SyntaxError)) throw responseError;
      }
    }
    throw error;
  }

  private async loadProfile(user: User): Promise<void> {
    const { data, error } = await supabase
      .from('app_profiles')
      .select('id,email,role,full_name,enabled')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      this.error.set(error.message);
      this.clearProfile();
      return;
    }
    if (!data || !data.enabled) {
      this.error.set('Tu cuenta está deshabilitada. Solicita acceso al administrador.');
      await supabase.auth.signOut();
      this.clearProfile();
      return;
    }
    const profile: AppProfile = {
      id: data.id,
      email: data.email,
      role: data.role,
      fullName: data.full_name,
      enabled: data.enabled
    };
    this.profile.set(profile);
    this.isAdmin.set(profile.role === 'admin');
    this.isSupervisor.set(profile.role === 'supervisor');
  }

  private clearProfile(): void {
    this.profile.set(null);
    this.isAdmin.set(false);
    this.isSupervisor.set(false);
  }
}
