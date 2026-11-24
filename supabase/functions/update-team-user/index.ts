import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Supabase no está configurado para editar usuarios.');
    }

    const authorization = request.headers.get('Authorization');
    if (!authorization) throw new RequestError('Debes iniciar sesión.', 401);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const { data: { user: callerUser }, error: callerError } = await caller.auth.getUser();
    if (callerError || !callerUser) throw new RequestError('Sesión inválida.', 401);

    const { data: callerProfile, error: callerProfileError } = await caller
      .from('app_profiles')
      .select('role,enabled')
      .eq('id', callerUser.id)
      .maybeSingle();
    if (callerProfileError) throw callerProfileError;
    if (!callerProfile?.enabled || callerProfile.role !== 'admin') {
      throw new RequestError('Solo el administrador puede editar usuarios.', 403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new RequestError('La solicitud no contiene JSON válido.', 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new RequestError('Los datos del usuario no son válidos.', 400);
    }

    const input = body as Record<string, unknown>;
    const userId = typeof input.id === 'string' ? input.id : '';
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
    const role = input.role;
    const temporaryPassword = input.temporaryPassword === undefined
      ? ''
      : typeof input.temporaryPassword === 'string'
        ? input.temporaryPassword
        : null;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      throw new RequestError('El identificador del usuario no es válido.', 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new RequestError('El correo no tiene un formato válido.', 400);
    }
    if (!fullName) throw new RequestError('El nombre es obligatorio.', 400);
    if (role !== 'admin' && role !== 'supervisor') {
      throw new RequestError('El rol no es válido.', 400);
    }
    if (temporaryPassword === null) {
      throw new RequestError('La contraseña temporal no es válida.', 400);
    }
    if (temporaryPassword && temporaryPassword.length < 8) {
      throw new RequestError('La contraseña temporal debe tener al menos 8 caracteres.', 400);
    }
    if (userId === callerUser.id) {
      throw new RequestError('No puedes editar tu propia cuenta desde este panel.', 403);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: targetProfile, error: targetProfileError } = await admin
      .from('app_profiles')
      .select('id,role,enabled')
      .eq('id', userId)
      .maybeSingle();
    if (targetProfileError) throw targetProfileError;
    if (!targetProfile) throw new RequestError('No se encontró el perfil del usuario.', 404);

    const { data: emailOwner, error: emailOwnerError } = await admin
      .from('app_profiles')
      .select('id')
      .eq('email', email)
      .neq('id', userId)
      .maybeSingle();
    if (emailOwnerError) throw emailOwnerError;
    if (emailOwner) throw new RequestError('Ya existe otro usuario con ese correo.', 409);

    if (targetProfile.role === 'admin' && role === 'supervisor' && targetProfile.enabled) {
      const { count, error: adminsError } = await admin
        .from('app_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('enabled', true);
      if (adminsError) throw adminsError;
      if (count !== null && count <= 1) {
        throw new RequestError('No se puede quitar el rol del único administrador habilitado.', 409);
      }
    }

    const { data: targetAuth, error: targetAuthError } = await admin.auth.admin.getUserById(userId);
    if (targetAuthError || !targetAuth.user) {
      throw new RequestError('No se encontró la cuenta de autenticación del usuario.', 404);
    }

    const userAttributes: {
      email: string;
      email_confirm: boolean;
      user_metadata: Record<string, unknown>;
      password?: string;
    } = {
      email,
      email_confirm: true,
      user_metadata: {
        ...targetAuth.user.user_metadata,
        full_name: fullName
      }
    };
    if (temporaryPassword) userAttributes.password = temporaryPassword;

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, userAttributes);
    if (authUpdateError) throw new RequestError(authUpdateError.message, 400);

    const { data: updatedProfile, error: profileUpdateError } = await admin
      .from('app_profiles')
      .update({
        email,
        full_name: fullName,
        role,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select('id')
      .maybeSingle();
    if (profileUpdateError) throw profileUpdateError;
    if (!updatedProfile) throw new Error('Supabase no actualizó el perfil del usuario.');

    return jsonResponse({ id: userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado.';
    const status = error instanceof RequestError ? error.status : 500;
    return jsonResponse({ error: message }, status);
  }
});
