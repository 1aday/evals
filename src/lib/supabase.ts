import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Create a dummy client or real client based on env availability
// This prevents build-time errors when env vars aren't available
let supabase: SupabaseClient;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  // Create a mock client that does nothing - for SSR/build time
  // The hooks will handle this gracefully
  console.warn('Supabase credentials not found. Database features will be disabled.');
  supabase = {
    from: () => ({
      select: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
      insert: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
      update: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
      upsert: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
      delete: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
    }),
  } as unknown as SupabaseClient;
}

export { supabase };
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Types for our database tables
export interface DbSystemPrompt {
  id: string;
  model: string;
  prompt: string;
  created_at: string;
  updated_at: string;
}

export interface DbChatSession {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface DbChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  citations?: Record<string, unknown>[];
  search_status?: Record<string, unknown>;
  created_at: string;
}

export interface DbUserSettings {
  id: string;
  settings: {
    model: string;
    reasoningEffort: string;
    verbosity: string;
    webSearch: boolean;
  };
  created_at: string;
  updated_at: string;
}

