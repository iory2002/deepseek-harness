/**
 * Shell-side copy of the Desktop Host work report, its validation at the child
 * process boundary, and the shell-owned states the companion window adds.
 * @module
 */

/** Work states the companion window renders. */
export type DesktopWorkPhase = 'starting' | 'idle' | 'working' | 'waiting' | 'subagent' | 'background' | 'offline'

/** Work the companion window renders, including the shell-owned startup and offline states. */
export interface DesktopWorkStatus {
  /** Most specific state the reported counts support. */
  readonly phase: DesktopWorkPhase
  /** Running agents that own their own turn. */
  readonly agents: number
  /** Running agents delegated by another agent. */
  readonly subagents: number
  /** Jobs still running or stopping. */
  readonly jobs: number
  /** Approval and user-question requests awaiting an answer. */
  readonly waits: number
  /**
   * Work bursts the Host reports as finished since it started. Compared between
   * reports: an increase is a burst that ended, a decrease is a new Host process.
   */
  readonly completed: number
}

/** Phases a Host may report; `starting` and `offline` belong to the shell alone. */
const HOST_PHASES: ReadonlySet<string> = new Set(['idle', 'working', 'waiting', 'subagent', 'background'])

/** Status shown until the Host answers its first work request. */
export const STARTING_WORK_STATUS: DesktopWorkStatus = { phase: 'starting', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 0 }

/** Status shown while the Host cannot answer. */
export const OFFLINE_WORK_STATUS: DesktopWorkStatus = { phase: 'offline', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 0 }

/** One reported count, or undefined when the value is not a non-negative integer. */
function reportedCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Validate one work report crossing the Host process boundary.
 * @param value - Candidate IPC payload.
 * @returns the validated report, or undefined for a malformed one.
 */
export function parseHostWorkStatus(value: unknown): DesktopWorkStatus | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const phase = candidate.phase
  if (typeof phase !== 'string' || !HOST_PHASES.has(phase)) return undefined
  const agents = reportedCount(candidate.agents)
  const subagents = reportedCount(candidate.subagents)
  const jobs = reportedCount(candidate.jobs)
  const waits = reportedCount(candidate.waits)
  const completed = reportedCount(candidate.completed)
  if (agents === undefined || subagents === undefined || jobs === undefined
    || waits === undefined || completed === undefined) return undefined
  return { phase: phase as DesktopWorkPhase, agents, subagents, jobs, waits, completed }
}
