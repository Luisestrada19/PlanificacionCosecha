export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      app_profiles: {
        Row: { id:string; email:string; full_name:string; role:'admin'|'supervisor'; enabled:boolean; created_at:string; updated_at:string };
        Insert: { id:string; email:string; full_name?:string; role?:'admin'|'supervisor'; enabled?:boolean; created_at?:string; updated_at?:string };
        Update: { id?:string; email?:string; full_name?:string; role?:'admin'|'supervisor'; enabled?:boolean; created_at?:string; updated_at?:string };
        Relationships: [];
      },
      fundos: {
        Row: { id: string; name: string; current_version_id: string | null; created_by: string; created_at: string };
        Insert: { id: string; name: string; current_version_id?: string | null; created_by: string; created_at?: string };
        Update: { id?: string; name?: string; current_version_id?: string | null; created_by?: string; created_at?: string };
        Relationships: [];
      };
      fundo_versions: {
        Row: { id: string; fundo_id: string; file_name: string; storage_path: string; uploaded_by: string; created_at: string };
        Insert: { id: string; fundo_id: string; file_name: string; storage_path: string; uploaded_by: string; created_at?: string };
        Update: { id?: string; fundo_id?: string; file_name?: string; storage_path?: string; uploaded_by?: string; created_at?: string };
        Relationships: [];
      };
      lot_assignments: {
        Row: { fundo_id: string; lot_uid: string; supervisor: string; color: string; updated_by: string; updated_at: string };
        Insert: { fundo_id: string; lot_uid: string; supervisor: string; color: string; updated_by: string; updated_at?: string };
        Update: { fundo_id?: string; lot_uid?: string; supervisor?: string; color?: string; updated_by?: string; updated_at?: string };
        Relationships: [];
      };
      user_fundo_permissions: {
        Row: { user_id:string; fundo_id:string; created_at:string };
        Insert: { user_id:string; fundo_id:string; created_at?:string };
        Update: { user_id?:string; fundo_id?:string; created_at?:string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      has_team_access: { Args: Record<PropertyKey, never>; Returns: boolean };
      current_app_role: { Args: Record<PropertyKey, never>; Returns: 'admin'|'supervisor' };
      register_fundo_version: {
        Args: { p_fundo_id: string; p_name: string; p_version_id: string; p_file_name: string; p_storage_path: string; p_assignments?: Json };
        Returns: undefined;
      };
      save_lot_assignments: { Args: { p_assignments: Json }; Returns: undefined };
      set_user_fundo_permissions: { Args: { p_user_id: string; p_fundo_ids: string[] }; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
