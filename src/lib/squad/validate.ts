import { parseMoneyInput } from '../format'
import {
  FORMATION_BOUNDS,
  POSITION_LABEL,
  POSITION_ORDER,
  STARTING_XI_SIZE,
  SQUAD_SIZE,
} from './positions'
import type { SquadSlot } from './types'

export interface ParsedSquad {
  bank: number
  squadValue: number
  freeTransfers: number
}

export interface ValidationResult {
  errors: string[]
  parsed: ParsedSquad | null
}

/**
 * UI-enforced squad rules (DoD): exactly 15 picks, exactly 11 starters,
 * captain and vice-captain are different players, the starting XI is a
 * legal FPL formation. Every rejection names what is wrong and what to do
 * about it — generic, unhelpful catch-all messages are not acceptable here.
 */
export function validateSquad(
  slots: SquadSlot[],
  bankInput: string,
  squadValueInput: string,
  freeTransfersInput: string
): ValidationResult {
  const errors: string[] = []

  const filled = slots.filter((slot) => slot.playerId !== null)
  if (filled.length < SQUAD_SIZE) {
    const missing = SQUAD_SIZE - filled.length
    errors.push(
      `Your squad has ${filled.length} of ${SQUAD_SIZE} players picked. ` +
        `Fill the remaining ${missing} slot${missing === 1 ? '' : 's'} before saving.`
    )
  }

  const starters = filled.filter((slot) => slot.isStarting)
  if (filled.length === SQUAD_SIZE && starters.length !== STARTING_XI_SIZE) {
    errors.push(
      `You have ${starters.length} players in the starting XI; a squad needs exactly ` +
        `${STARTING_XI_SIZE}. Move players between the starting XI and the bench to fix it.`
    )
  }

  if (filled.length === SQUAD_SIZE && starters.length === STARTING_XI_SIZE) {
    for (const position of POSITION_ORDER) {
      const [min, max] = FORMATION_BOUNDS[position]
      const count = starters.filter((slot) => slot.position === position).length
      if (count < min || count > max) {
        const label = POSITION_LABEL[position]
        const range = min === max ? `exactly ${min}` : `between ${min} and ${max}`
        errors.push(
          `Your starting XI has ${count} ${label.toLowerCase()}${count === 1 ? '' : 's'}; ` +
            `a legal formation needs ${range}. Swap a starting player for a bench player ` +
            `of a different position to fix it.`
        )
      }
    }
  }

  const captain = filled.find((slot) => slot.isCaptain)
  const viceCaptain = filled.find((slot) => slot.isViceCaptain)
  if (!captain) {
    errors.push('No captain is selected. Pick a captain before saving.')
  }
  if (!viceCaptain) {
    errors.push('No vice-captain is selected. Pick a vice-captain before saving.')
  }
  if (captain && viceCaptain && captain.playerId === viceCaptain.playerId) {
    errors.push(
      'Captain and vice-captain are the same player. Pick two different players before saving.'
    )
  }

  const bank = parseMoneyInput(bankInput)
  if (bank === null) {
    errors.push(
      'Bank must be a number with at most one decimal place, like 0.5. Fix the Bank field before saving.'
    )
  }

  const squadValue = parseMoneyInput(squadValueInput)
  if (squadValue === null) {
    errors.push(
      'Squad value must be a number with at most one decimal place, like 99.5. Fix the Squad ' +
        'value field before saving.'
    )
  }

  const freeTransfers = /^\d+$/.test(freeTransfersInput.trim())
    ? Number.parseInt(freeTransfersInput.trim(), 10)
    : null
  if (freeTransfers === null) {
    errors.push(
      'Free transfers must be a whole number, 0 or more. Fix the Free transfers field before saving.'
    )
  }

  if (errors.length > 0 || bank === null || squadValue === null || freeTransfers === null) {
    return { errors, parsed: null }
  }

  return { errors: [], parsed: { bank, squadValue, freeTransfers } }
}
