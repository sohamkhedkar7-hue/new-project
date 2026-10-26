import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export async function saveScenario(snapshot) {
  if (!supabase) throw new Error('Supabase is not configured. Add the project URL and anon key to your .env file.');
  const { error } = await supabase.from('simulation_snapshots').insert({
    scenario: snapshot,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Supabase save failed: ${error.message}`);
}
