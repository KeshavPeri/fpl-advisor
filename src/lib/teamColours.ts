/**
 * Per-club shirt colours for the pitch (ticket #276, H3 — "all shirts are one identical dark
 * placeholder. Use team colour or short name so the pitch reads."). Keyed on `players.teams
 * (short_name)`, which `fetchPlayers` (src/lib/squad/api.ts) already selects.
 *
 * design-reference.md names the official FPL app as the anti-reference and explicitly bans "club
 * crests as decoration" and "saturated team colours" — the sports-app convention of a shirt as a
 * literal, bright kit graphic. These colours are deliberately NOT that: every value sits close in
 * luminance to this app's own --surface-1/--surface-2 tokens (src/index.css, ~L14-18%), so a
 * shirt reads as "the app's own material, faintly tinted toward a club's identity" rather than as
 * a broadcast-graphic kit dropped onto a dark app. No hue below falls in the app's banned
 * green (~90-160°) or yellow (~45-65°) ranges either — the same "no green, no yellow" rule
 * design-reference.md states for the app's own accent colours, applied here to a decorative
 * addition that sits outside that rule's literal scope but not outside its spirit. Two amber
 * trims (EVE, MUN) sit at ~40-41°, deliberately kept a clear step short of that 45° line so they
 * read as muted gold rather than yellow.
 *
 * The 20 clubs are this season's live set, taken from `scripts/lib/oddsClubNames.ts` (ticket
 * #238's own verified-against-live-data list, dated 15 Sept 2026 — the newest, most-verified
 * account of `public.teams` membership committed anywhere in this repo; there is no seeded teams
 * table to read short_name from directly, see that file's own header). Short names below follow
 * the FPL API's own three-letter convention for each of those 20 full club names.
 *
 * Every value here is a Tier 3 (design-reference.md/escalation.md) judgement call, not measured
 * or sourced from an official brand-colour reference — reported to the decisions log as such.
 */

export interface TeamColours {
  /** The shirt body's dominant tone (PlayerShirt.css's gradient start). */
  readonly primary: string
  /** The shirt's trim/gradient-end tone. */
  readonly secondary: string
}

/** This season's 20 clubs, short_name -> colours. See this file's header for how the set and the
 *  values themselves were decided. */
const TEAM_COLOURS: Readonly<Record<string, TeamColours>> = {
  ARS: { primary: '#5c2730', secondary: '#c7cbd1' }, // Arsenal — muted red, off-white trim
  AVL: { primary: '#4a273f', secondary: '#33526e' }, // Aston Villa — muted claret, muted blue
  BOU: { primary: '#6b2430', secondary: '#1c2430' }, // Bournemouth — muted cherry, near-ink trim
  BRE: { primary: '#6e2b34', secondary: '#cdc6b4' }, // Brentford — muted red, stripe off-white
  BHA: { primary: '#24406b', secondary: '#c7cbd1' }, // Brighton and Hove Albion — muted blue, white
  CHE: { primary: '#1f3a66', secondary: '#aab0bb' }, // Chelsea — muted royal blue, silver trim
  COV: { primary: '#2d4f78', secondary: '#c7cbd1' }, // Coventry City — muted sky blue, white
  CRY: { primary: '#5e2531', secondary: '#263a63' }, // Crystal Palace — muted red, muted blue
  EVE: { primary: '#1c3560', secondary: '#a98a4a' }, // Everton — muted royal blue, muted gold trim
  FUL: { primary: '#2c313c', secondary: '#7d8290' }, // Fulham — charcoal, light-grey trim
  HUL: { primary: '#6b3c1e', secondary: '#1c1f27' }, // Hull City — muted amber, near-ink trim
  IPS: { primary: '#1f3f6b', secondary: '#c7cbd1' }, // Ipswich Town — muted blue, white
  LEE: { primary: '#2b303b', secondary: '#9c7a3c' }, // Leeds United — charcoal, muted gold trim
  LIV: { primary: '#641f2b', secondary: '#8a7a5a' }, // Liverpool — muted red, muted gold trim
  MCI: { primary: '#244f78', secondary: '#c7cbd1' }, // Manchester City — muted sky blue, white
  MUN: { primary: '#641f26', secondary: '#b89446' }, // Manchester United — muted red, muted gold trim
  NEW: { primary: '#212530', secondary: '#c7cbd1' }, // Newcastle United — near-ink, white (stripes)
  NFO: { primary: '#55212c', secondary: '#c7cbd1' }, // Nottingham Forest — muted red, white
  SUN: { primary: '#6b2731', secondary: '#c7cbd1' }, // Sunderland — muted red, white (stripes)
  TOT: { primary: '#262b38', secondary: '#c7cbd1' }, // Tottenham Hotspur — muted navy, white
}

/** Every short_name this file has a colour for — exported so the test can assert full coverage
 *  against the same list this file itself is keyed on, and so a future ticket that needs "every
 *  known club" doesn't need to re-derive the key list from the object shape. */
export const KNOWN_TEAM_SHORT_NAMES: readonly string[] = Object.keys(TEAM_COLOURS)

/**
 * Looks up a club's shirt colours by `short_name`. Returns `undefined` — never a made-up
 * default pair — for a club this file doesn't recognise (a promoted/renamed club ahead of this
 * file's own next update, or simply no team data yet); the caller (PlayerShirt.tsx) falls back
 * to today's neutral shirt gradient in that case, per this ticket's own DoD. Trimmed and
 * upper-cased defensively — `short_name` is stored upper-case by the FPL API today, but a caller
 * should not have to know that to get a hit.
 */
export function getTeamColours(shortName: string | null | undefined): TeamColours | undefined {
  if (!shortName) return undefined
  return TEAM_COLOURS[shortName.trim().toUpperCase()]
}
