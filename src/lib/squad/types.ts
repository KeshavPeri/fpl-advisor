import type { PositionCode } from './positions'

/** A row from `public.players`, trimmed to what the entry screen needs. */
export interface SelectablePlayer {
  id: number
  code: number
  webName: string
  teamId: number
  teamShortName: string
  elementType: PositionCode
  nowCost: number // tenths of a million
}

export interface TargetGameweek {
  id: number
  name: string
  deadlineTime: string
}

/** One of the 15 squad slots as held in form state — a slot can be empty. */
export interface SquadSlot {
  squadPosition: number
  position: PositionCode
  playerId: number | null
  isStarting: boolean
  benchOrder: number | null
  isCaptain: boolean
  isViceCaptain: boolean
}

export interface SquadFormState {
  slots: SquadSlot[]
  bank: string // free-text £m input, e.g. "0.5"
  squadValue: string // free-text £m input, e.g. "99.5"
  freeTransfers: string
}

export type SquadSource = 'manual' | 'api_sync' | 'override'
