import { useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import Surface from '../components/Surface'
import { formatMoney, formatSyncTimestamp, tenthsToInputString, toErrorMessage } from '../lib/format'
import { fetchExistingSquad, fetchPlayers, fetchTargetGameweek, saveSquad } from '../lib/squad/api'
import { getFplEntryId } from '../lib/squad/env'
import {
  POSITION_LABEL,
  POSITION_ORDER,
  squadPositionRange,
  type PositionCode,
} from '../lib/squad/positions'
import { fetchSquadSyncStatus, type SquadDiff, type SquadSyncStatus } from '../lib/squad/syncStatus'
import type { SelectablePlayer, SquadSlot, TargetGameweek } from '../lib/squad/types'
import { validateSquad } from '../lib/squad/validate'
import './SquadEntryScreen.css'

/**
 * Ticket #14 — a short, human summary of a reconciliation diff for the sync
 * banner. Mirrors scripts/sync-squad.ts's own summarizeDiff(), duplicated
 * rather than shared for the same reason every scripts/*.ts file already
 * duplicates rather than imports across the scripts/src boundary (see that
 * file's header comment on POSITION_ORDER).
 */
function summarizeDiff(diff: SquadDiff): string {
  const parts: string[] = []
  if (diff.addedPlayerIds.length > 0) parts.push(`${diff.addedPlayerIds.length} player(s) added`)
  if (diff.removedPlayerIds.length > 0) parts.push(`${diff.removedPlayerIds.length} player(s) removed`)
  if (diff.startingChangedPlayerIds.length > 0) {
    parts.push(`${diff.startingChangedPlayerIds.length} player(s) moved starting XI/bench`)
  }
  if (diff.captainChanged) parts.push('captain changed')
  if (diff.viceCaptainChanged) parts.push('vice-captain changed')
  return parts.length > 0 ? parts.join(', ') : 'a difference was detected'
}

/**
 * Ticket #14's "visible last-successful-sync timestamp" and "the difference
 * is … surfaced" DoD items. Stale (last sync attempt failed) always wins —
 * the app must never present stale state as current (product-brief.md
 * §6a) — regardless of what an older successful run's reason says.
 */
function renderSyncBanner(status: SquadSyncStatus | null) {
  if (!status) return null

  if (status.isStale) {
    return (
      <Surface className="squad-sync squad-sync--stale" role="status">
        <p className="squad-sync__title">FPL sync stale</p>
        <p>
          The last sync attempt failed.{' '}
          {status.lastSuccessfulSyncAt
            ? `Showing the last confirmed state, synced ${formatSyncTimestamp(status.lastSuccessfulSyncAt)}.`
            : 'FPL has never been reached successfully — this is your manually-entered squad.'}
        </p>
      </Surface>
    )
  }

  const run = status.lastRunForGameweek
  if (!run) return null

  if (run.reason === 'diff_detected' && run.diff) {
    return (
      <Surface className="squad-sync squad-sync--diff" role="status">
        <p className="squad-sync__title">Squad differs from FPL</p>
        <p>
          {summarizeDiff(run.diff)}. Not overwritten — update the picks below and save if this
          needs correcting.
        </p>
      </Surface>
    )
  }

  if (run.reason === 'confirmed' || run.reason === 'established') {
    return (
      <Surface className="squad-sync squad-sync--confirmed" role="status">
        <p className="squad-sync__title">Confirmed against FPL</p>
        {run.finishedAt && <p className="num">Synced {formatSyncTimestamp(run.finishedAt)}</p>}
      </Surface>
    )
  }

  if (run.reason === 'picks_not_published') {
    return (
      <Surface className="squad-sync squad-sync--pending" role="status">
        <p className="squad-sync__title">Waiting on FPL</p>
        <p>FPL hasn't published picks for this gameweek yet — this is your manually-entered squad.</p>
      </Surface>
    )
  }

  if (run.reason === 'no_deadline_passed') {
    return (
      <Surface className="squad-sync squad-sync--pending" role="status">
        <p className="squad-sync__title">Not yet synced</p>
        <p>This gameweek's deadline hasn't passed yet — squad state is whatever you enter below.</p>
      </Surface>
    )
  }

  return null
}

type LoadState =
  | { status: 'loading' }
  | { status: 'no-gameweeks' }
  | { status: 'no-players' }
  | { status: 'error'; message: string }
  | { status: 'ready' }

function createEmptySlots(): SquadSlot[] {
  const slots: SquadSlot[] = []
  for (const position of POSITION_ORDER) {
    const { start, end } = squadPositionRange(position)
    for (let squadPosition = start; squadPosition <= end; squadPosition += 1) {
      slots.push({
        squadPosition,
        position,
        playerId: null,
        isStarting: false,
        benchOrder: null,
        isCaptain: false,
        isViceCaptain: false,
      })
    }
  }
  return slots
}

function pluralLabel(position: PositionCode): string {
  return `${POSITION_LABEL[position]}s`
}

/**
 * Ticket #13 — manual squad entry. Functional entry form matching #8's
 * design system; no pitch layout (that's item 16, wave 4). See
 * decisions/ticket-13.md for the Tier 2 calls made while building this.
 */
function SquadEntryScreen() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [gameweek, setGameweek] = useState<TargetGameweek | null>(null)
  const [players, setPlayers] = useState<SelectablePlayer[]>([])
  const [slots, setSlots] = useState<SquadSlot[]>(createEmptySlots)
  const [bankInput, setBankInput] = useState('')
  const [squadValueInput, setSquadValueInput] = useState('')
  const [freeTransfersInput, setFreeTransfersInput] = useState('1')
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveErrorMessage, setSaveErrorMessage] = useState('')
  const [syncStatus, setSyncStatus] = useState<SquadSyncStatus | null>(null)
  const fplEntryId = useMemo(() => getFplEntryId(), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const gw = await fetchTargetGameweek()
        if (cancelled) return
        if (!gw) {
          setLoadState({ status: 'no-gameweeks' })
          return
        }

        const playerList = await fetchPlayers()
        if (cancelled) return
        if (playerList.length === 0) {
          setLoadState({ status: 'no-players' })
          return
        }

        const existing = await fetchExistingSquad(gw.id)
        if (cancelled) return

        setGameweek(gw)
        setPlayers(playerList)

        if (existing) {
          setBankInput(tenthsToInputString(existing.bank))
          setSquadValueInput(tenthsToInputString(existing.squadValue))
          setFreeTransfersInput(String(existing.freeTransfers))
          setSlots((prev) =>
            prev.map((slot) => {
              const pick = existing.picks.find((p) => p.squadPosition === slot.squadPosition)
              if (!pick) return slot
              return {
                ...slot,
                playerId: pick.playerId,
                isStarting: pick.isStarting,
                benchOrder: pick.benchOrder,
                isCaptain: pick.isCaptain,
                isViceCaptain: pick.isViceCaptain,
              }
            })
          )
        }

        setLoadState({ status: 'ready' })
      } catch (err) {
        if (cancelled) return
        setLoadState({ status: 'error', message: toErrorMessage(err) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Ticket #14 — sync status is fetched separately from the squad itself:
  // it depends only on knowing the gameweek id, and a failure to read it
  // (e.g. job_runs not migrated yet) should not block the entry form from
  // rendering at all. Silently shows nothing rather than an error banner —
  // this is supplementary context, not something the screen depends on.
  useEffect(() => {
    if (gameweek === null) return
    let cancelled = false
    fetchSquadSyncStatus(gameweek.id)
      .then((status) => {
        if (!cancelled) setSyncStatus(status)
      })
      .catch(() => {
        // Deliberately silent — see comment above.
      })
    return () => {
      cancelled = true
    }
  }, [gameweek])

  const selectedPlayerIds = useMemo(
    () => new Set(slots.map((slot) => slot.playerId).filter((id): id is number => id !== null)),
    [slots]
  )

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  const starters = useMemo(() => slots.filter((s) => s.isStarting && s.playerId !== null), [slots])

  function updateSlot(squadPosition: number, patch: Partial<SquadSlot>) {
    setSlots((prev) =>
      prev.map((slot) => (slot.squadPosition === squadPosition ? { ...slot, ...patch } : slot))
    )
  }

  function handleSelectPlayer(squadPosition: number, rawValue: string) {
    if (rawValue === '') {
      updateSlot(squadPosition, {
        playerId: null,
        isStarting: false,
        benchOrder: null,
        isCaptain: false,
        isViceCaptain: false,
      })
      return
    }
    updateSlot(squadPosition, { playerId: Number(rawValue) })
  }

  function handleToggleStarting(squadPosition: number, checked: boolean) {
    // A bench player can't be captain or vice-captain — clear both when a
    // slot moves to the bench.
    updateSlot(
      squadPosition,
      checked
        ? { isStarting: true }
        : { isStarting: false, isCaptain: false, isViceCaptain: false }
    )
  }

  /** playerId is null when the user picks the blank "— Pick —" option, clearing the choice. */
  function handleSelectCaptain(playerId: number | null) {
    setSlots((prev) => prev.map((slot) => ({ ...slot, isCaptain: slot.playerId === playerId })))
  }

  function handleSelectViceCaptain(playerId: number | null) {
    setSlots((prev) =>
      prev.map((slot) => ({ ...slot, isViceCaptain: slot.playerId === playerId }))
    )
  }

  async function handleSave() {
    const result = validateSquad(slots, bankInput, squadValueInput, freeTransfersInput)
    setValidationErrors(result.errors)
    if (!result.parsed || !gameweek) return

    // Bench order is derived, not user-entered: the four non-starting picks
    // are numbered 1-4 in squad_position order (lowest substituted first).
    // Simpler and can't collide, unlike a free-choice selector — see
    // decisions/ticket-13.md.
    let benchCounter = 0
    const picks = slots
      .filter((slot) => slot.playerId !== null)
      .map((slot) => {
        const player = playersById.get(slot.playerId!)
        if (!player) throw new Error(`Unknown player id ${String(slot.playerId)} in squad`)
        const benchOrder = slot.isStarting ? null : (benchCounter += 1)
        return {
          squadPosition: slot.squadPosition,
          playerId: slot.playerId!,
          playerCode: player.code,
          isStarting: slot.isStarting,
          benchOrder,
          isCaptain: slot.isCaptain,
          isViceCaptain: slot.isViceCaptain,
        }
      })

    setSaveState('saving')
    try {
      await saveSquad(gameweek.id, { ...result.parsed, picks })
      setSaveState('saved')
    } catch (err) {
      setSaveErrorMessage(toErrorMessage(err))
      setSaveState('error')
    }
  }

  if (loadState.status === 'loading') {
    return (
      <AppShell>
        <header className="squad-mark">Squad</header>
        <Surface>
          <p className="squad-status-text">Loading your squad…</p>
        </Surface>
      </AppShell>
    )
  }

  if (loadState.status === 'no-gameweeks') {
    return (
      <AppShell>
        <header className="squad-mark">Squad</header>
        <Surface>
          <p className="squad-status-text">
            No gameweeks are loaded yet. Run the FPL ingest job
            (<code className="num">scripts/ingest-fpl.ts</code>, ticket #11) to populate the
            gameweeks table, then reload this page.
          </p>
        </Surface>
      </AppShell>
    )
  }

  if (loadState.status === 'no-players') {
    return (
      <AppShell>
        <header className="squad-mark">Squad</header>
        <Surface>
          <p className="squad-status-text">
            No players are loaded yet. Run the FPL ingest job
            (<code className="num">scripts/ingest-fpl.ts</code>, ticket #11) to populate the
            players table, then reload this page.
          </p>
        </Surface>
      </AppShell>
    )
  }

  if (loadState.status === 'error') {
    return (
      <AppShell>
        <header className="squad-mark">Squad</header>
        <Surface>
          <p className="squad-status-text squad-status-text--error">
            Couldn't load your squad: {loadState.message}. Check your connection and reload this
            page to try again.
          </p>
        </Surface>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <header className="squad-mark">Squad</header>

      <Surface className="squad-gameweek">
        <p className="squad-gameweek__label">Editing</p>
        <p className="squad-gameweek__name">{gameweek?.name}</p>
        {fplEntryId && gameweek && (
          <a
            className="squad-gameweek__fpl-link"
            href={`https://fantasy.premierleague.com/entry/${fplEntryId}/event/${gameweek.id}`}
            target="_blank"
            rel="noreferrer"
          >
            View on the official FPL site ↗
          </a>
        )}
      </Surface>

      {renderSyncBanner(syncStatus)}

      {POSITION_ORDER.map((position) => (
        <Surface key={position} className="squad-position-group">
          <p className="squad-position-group__title">{pluralLabel(position)}</p>
          {slots
            .filter((slot) => slot.position === position)
            .map((slot) => {
              const options = players.filter(
                (p) =>
                  p.elementType === position &&
                  (p.id === slot.playerId || !selectedPlayerIds.has(p.id))
              )
              return (
                <div className="squad-row" key={slot.squadPosition}>
                  <select
                    className="squad-row__select"
                    value={slot.playerId ?? ''}
                    onChange={(e) => handleSelectPlayer(slot.squadPosition, e.target.value)}
                    aria-label={`${POSITION_LABEL[position]} pick`}
                  >
                    <option value="">— Pick a {POSITION_LABEL[position].toLowerCase()} —</option>
                    {options.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.webName} ({p.teamShortName}) · {formatMoney(p.nowCost)}
                      </option>
                    ))}
                  </select>
                  <label className="squad-row__starting">
                    <input
                      type="checkbox"
                      checked={slot.isStarting}
                      disabled={slot.playerId === null}
                      onChange={(e) => handleToggleStarting(slot.squadPosition, e.target.checked)}
                    />
                    Starting
                  </label>
                </div>
              )
            })}
        </Surface>
      ))}

      <Surface className="squad-captaincy">
        <p className="squad-captaincy__title">Captaincy</p>
        <label className="squad-field">
          <span className="squad-field__label">Captain</span>
          <select
            className="squad-field__input"
            value={starters.find((s) => s.isCaptain)?.playerId ?? ''}
            onChange={(e) =>
              handleSelectCaptain(e.target.value === '' ? null : Number(e.target.value))
            }
          >
            <option value="">— Pick from your starting XI —</option>
            {starters.map((slot) => (
              <option key={slot.squadPosition} value={slot.playerId ?? ''}>
                {playersById.get(slot.playerId!)?.webName ?? 'Unknown player'}
              </option>
            ))}
          </select>
        </label>
        <label className="squad-field">
          <span className="squad-field__label">Vice-captain</span>
          <select
            className="squad-field__input"
            value={starters.find((s) => s.isViceCaptain)?.playerId ?? ''}
            onChange={(e) =>
              handleSelectViceCaptain(e.target.value === '' ? null : Number(e.target.value))
            }
          >
            <option value="">— Pick from your starting XI —</option>
            {starters.map((slot) => (
              <option key={slot.squadPosition} value={slot.playerId ?? ''}>
                {playersById.get(slot.playerId!)?.webName ?? 'Unknown player'}
              </option>
            ))}
          </select>
        </label>
      </Surface>

      <Surface className="squad-money">
        <p className="squad-money__title">Bank and squad value</p>
        <label className="squad-field">
          <span className="squad-field__label">Bank (£m)</span>
          <input
            className="squad-field__input num"
            inputMode="decimal"
            placeholder="0.5"
            value={bankInput}
            onChange={(e) => setBankInput(e.target.value)}
          />
        </label>
        <label className="squad-field">
          <span className="squad-field__label">Squad value (£m)</span>
          <input
            className="squad-field__input num"
            inputMode="decimal"
            placeholder="99.5"
            value={squadValueInput}
            onChange={(e) => setSquadValueInput(e.target.value)}
          />
          <span className="squad-field__hint num">
            Selected players total: {formatMoney(
              slots.reduce((sum, s) => sum + (playersById.get(s.playerId ?? -1)?.nowCost ?? 0), 0)
            )}
          </span>
        </label>
        <label className="squad-field">
          <span className="squad-field__label">Free transfers</span>
          <input
            className="squad-field__input num"
            inputMode="numeric"
            placeholder="1"
            value={freeTransfersInput}
            onChange={(e) => setFreeTransfersInput(e.target.value)}
          />
        </label>
      </Surface>

      {validationErrors.length > 0 && (
        <Surface className="squad-errors" role="alert">
          <p className="squad-errors__title">Fix these before saving</p>
          <ul className="squad-errors__list">
            {validationErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Surface>
      )}

      {saveState === 'error' && (
        <Surface className="squad-errors" role="alert">
          <p className="squad-errors__title">Saving failed</p>
          <p>{saveErrorMessage}. Check your connection and try again.</p>
        </Surface>
      )}

      {saveState === 'saved' && (
        <Surface className="squad-saved" role="status">
          <p className="squad-saved__title">Squad saved</p>
          <p>Your {gameweek?.name} squad is stored. Reload this page any time to see it again.</p>
        </Surface>
      )}

      <div className="squad-picked-count num">
        {slots.filter((s) => s.playerId !== null).length} of 15 picked · {starters.length} of 11
        starting
      </div>

      <button
        type="button"
        className="squad-save-button"
        onClick={() => void handleSave()}
        disabled={saveState === 'saving'}
      >
        {saveState === 'saving' ? 'Saving…' : 'Save squad'}
      </button>
    </AppShell>
  )
}

export default SquadEntryScreen
