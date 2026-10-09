// Deliberately wrong implementations (plan v2 §4c, M1). Test-only: built from the production
// factory with one rule swapped, so production code carries no variant switch.
import { makeFormat, k } from '../hooks/format'

/** k-units rounded instead of floored, in both the k and the M branch. */
export function kRound(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${Math.round(n / 100_000) / 10}M`
}

export const MUTANTS = {
  kRound: makeFormat({ kUnits: kRound, isDue: (tokens, threshold) => tokens >= threshold }),
  dueGt: makeFormat({ kUnits: k, isDue: (tokens, threshold) => tokens > threshold }),
} as const
