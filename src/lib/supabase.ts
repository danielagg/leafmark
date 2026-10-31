import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Local mode is an explicit development-only choice. A hosted build never falls
// back to an unprotected local library when its configuration is missing.
export const isCloudMode = !(
  import.meta.env.DEV &&
  (import.meta.env.VITE_STORAGE_MODE === 'local' || import.meta.env.MODE === 'local-preview')
);
export const ownerEmail = import.meta.env.VITE_OWNER_EMAIL?.trim() || '';
export const ownerId = import.meta.env.VITE_OWNER_ID?.trim() || '';
const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '';
export const configurationError =
  isCloudMode && (!projectUrl || !publishableKey || !ownerEmail || !ownerId)
    ? 'This library has not been configured yet.'
    : null;
export const supabase: SupabaseClient | null =
  isCloudMode && !configurationError
    ? createClient(projectUrl, publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'leafmark.auth',
        },
      })
    : null;
export const supabaseUrl = projectUrl;
