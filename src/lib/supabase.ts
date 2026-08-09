import { createClient } from '@supabase/supabase-js'

// These come from Vercel environment variables at build time — never hardcode
// real values here or commit them to the repo. See decisions.md if this ever
// needs to change; §7 of the system design is why keys never live in the repo.
//
// Uses Supabase's current key type (as of Aug 2026): the publishable key
// (sb_publishable_...), which replaces the legacy anon JWT key. Same public,
// safe-to-expose role — just a new format. See:
// https://supabase.com/docs/guides/getting-started/api-keys
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined

export const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

if (!supabaseConfigured) {
  console.warn(
    'Supabase env vars are missing — set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY ' +
      'in Vercel project settings (Production, Preview and Development environments).'
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabasePublishableKey ?? '')
