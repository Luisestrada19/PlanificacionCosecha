import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase.config';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
