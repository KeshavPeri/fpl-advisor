/**
 * VITE_FPL_ENTRY_ID — the browser-side counterpart of scripts/sync-squad.ts's
 * FPL_ENTRY_ID (ticket #14). Never hardcoded, matching src/lib/supabase.ts's
 * own convention for env-sourced config. Used only for a convenience link
 * back to Keshav's own entry on the official FPL site — the app itself
 * never calls any endpoint that needs it (all reads go through Supabase).
 */
export function getFplEntryId(): string | null {
  const raw = import.meta.env.VITE_FPL_ENTRY_ID as string | undefined
  if (!raw || raw.trim() === '') return null
  return raw.trim()
}
