import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Supabase no está configurado para crear usuarios.');

    const authorization = request.headers.get('Authorization');
    if (!authorization) throw new Error('Debes iniciar sesión.');

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) throw new Error('Sesión inválida.');

    const { data: callerProfile, error: profileError } = await caller
      .from('app_profiles')
      .select('role,enabled')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!callerProfile?.enabled || callerProfile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Solo el administrador puede crear usuarios.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const fullName = String(body.fullName ?? '').trim();
    const role = body.role === 'admin' ? 'admin' : 'supervisor';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El correo no tiene un formato válido.');
    if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (!fullName) throw new Error('El nombre es obligatorio.');

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });
    if (error) throw error;
    if (!data.user) throw new Error('Supabase no devolvió el usuario creado.');

    const { error: profileInsertError } = await admin
      .from('app_profiles')
      .upsert({
        id: data.user.id,
        email,
        full_name: fullName,
        role,
        enabled: true
      }, {
        onConflict: 'id'
      });
    if (profileInsertError) throw profileInsertError;

    return new Response(JSON.stringify({ id: data.user.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado.';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
