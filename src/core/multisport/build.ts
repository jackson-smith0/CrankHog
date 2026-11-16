// One session file in, what to store and what to tell the rider out: the
// parsed session, what it adds up to, and every error and warning, so the
// import report can say exactly why a file did or didn't land on its day.
import { contentId } from '../workout/ids'
import type { DateKey } from '../workout/schedule'
import { estimateSession, type SessionEstimate, type SessionThresholds } from './estimate'
import type { SessionWorkout } from './model'
import { parseSession, type ParsedSession, type SessionMessage } from './parse'

export interface SessionFileResult {
  parsed: ParsedSession
  /** Null when the file has errors: a file is imported whole or not at all. */
  workout: SessionWorkout | null
  date: DateKey | null
  estimate: SessionEstimate | null
  errors: SessionMessage[]
  warnings: SessionMessage[]
}

/** Reads a session file and works out what it adds up to with the rider's thresholds. */
export function sessionFromFile(fileName: string, text: string, thresholds: SessionThresholds, now: number): SessionFileResult {
  const parsed = parseSession(fileName, text)
  const errors = parsed.errors
  if (errors.length > 0 || !parsed.header.sport) return { parsed, workout: null, date: parsed.date, estimate: null, errors, warnings: parsed.warnings }
  const estimate = estimateSession(parsed.header.sport, parsed.sections, parsed.header, thresholds)
  const h = parsed.header
  const workout: SessionWorkout = {
    // same file, same id: importing it again replaces it rather than adding a copy
    id: contentId(`session-${h.sport}`, text.replace(/\r\n/g, '\n').trim()),
    sport: h.sport!,
    name: parsed.name,
    text: text.replace(/\r\n/g, '\n').trim() + '\n',
    tags: [],
    source: 'import',
    ...(h.pool ? { pool: h.pool } : {}),
    ...(h.durationS !== undefined ? { durationS: h.durationS } : {}),
    ...(h.distanceM !== undefined ? { distanceM: h.distanceM } : {}),
    ...(h.effort ? { effort: h.effort } : {}),
    ...(h.notes ? { notes: h.notes } : {}),
    createdAt: now,
    updatedAt: now,
  }
  return { parsed, workout, date: parsed.date, estimate, errors, warnings: [...parsed.warnings, ...estimate.warnings.map((text) => ({ text }))] }
}

/** A stored session read back, with what it adds up to now (thresholds may have changed since it was imported). */
export function describeSession(w: Pick<SessionWorkout, 'text' | 'name'>, thresholds: SessionThresholds): { parsed: ParsedSession; estimate: SessionEstimate | null } {
  const parsed = parseSession(`${w.name}.txt`, w.text)
  if (!parsed.header.sport) return { parsed, estimate: null }
  return { parsed, estimate: estimateSession(parsed.header.sport, parsed.sections, parsed.header, thresholds) }
}
