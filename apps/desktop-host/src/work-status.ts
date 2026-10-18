/**
 * Live work snapshot the Electron shell renders in its always-on-top companion
 * window while the application is in the background.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { JobStatus } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'

/** Primary state the shell shows for the Host's work. */
export type DesktopWorkPhase = 'idle' | 'working' | 'waiting' | 'approval' | 'subagent' | 'background'

/** Point-in-time account of the work one Desktop Host is running. */
export interface DesktopWorkStatus {
  /** Most specific state the reported counts support. */
  readonly phase: DesktopWorkPhase
  /** Running agents that own their own turn, including resumed top-level sessions. */
  readonly agents: number
  /** Running agents created as delegated children of another agent. */
  readonly subagents: number
  /** Jobs still running or stopping, counted once each across every owner. */
  readonly jobs: number
  /** Approval and user-question requests awaiting an answer. */
  readonly waits: number
  /**
   * Work bursts that ran to completion since this Host started. Only ever
   * increases, so the shell reads an increase as "a burst just ended" even when
   * the burst fits entirely between two polls; restarting the Host resets it.
   */
  readonly completed: number
}

/** Whether one job status is work the Host is still carrying. */
function isLiveJob(status: JobStatus): boolean {
  return status === 'running' || status === 'stopping'
}

/**
 * Register the work inspector on the owning Host context.
 *
 * The counting listeners register ahead of every answerer: the Web bridge claims
 * a forwarded request and waits for its Client without delegating, so a listener
 * behind it would never see the request as pending. They only count and delegate,
 * so the composed answerers observe no change in order or outcome.
 * @param ctx - Booted Desktop profile context; disposal makes the inspector reject.
 * @returns Inspector reporting the current work snapshot. Pending interactions are counted
 *   from the first dispatch after registration.
 */
export function installDesktopWorkStatusInspection(ctx: Context): () => DesktopWorkStatus {
  let stopped = false
  ctx.effect(() => () => { stopped = true })
  let approvals = 0
  let questions = 0
  ctx.on('approval/request', async (_request, next) => {
    approvals++
    try { return await next() } finally { approvals-- }
  }, { prepend: true })
  ctx.on('user-questions/request', async (_request, next) => {
    questions++
    try { return await next() } finally { questions-- }
  }, { prepend: true })
  /** Whether the previous observation still had work in flight. */
  let carrying = false
  let completed = 0

  const counts = (): Omit<DesktopWorkStatus, 'completed'> => {
    const agents = ctx.get('agents')
    const jobs = ctx.get('jobs')
    if (agents === undefined || jobs === undefined) throw new Error('desktop work: task services are unavailable')
    const live = agents.list()
    const roots = new Set(agents.roots().map(agent => agent.id))
    let running = 0
    let subagents = 0
    for (const agent of live) {
      if (agent.status !== 'running') continue
      if (roots.has(agent.id)) running++
      else subagents++
    }
    // An owned listing already includes the unowned roster, so ids deduplicate across owners.
    const owners = live.length === 0 ? [undefined] : live.map(agent => agent.id)
    const liveJobs = new Set<string>()
    for (const owner of owners) {
      for (const job of jobs.list(owner)) if (isLiveJob(job.status)) liveJobs.add(job.id)
    }
    const background = liveJobs.size
    const waits = approvals + questions
    // An approval holds the work it guards, so it outranks a pending question,
    // which in turn outranks every state that is not waiting for a person.
    const phase: DesktopWorkPhase = approvals > 0 ? 'approval'
      : questions > 0 ? 'waiting'
        : subagents > 0 ? 'subagent'
          : running > 0 ? 'working'
            : background > 0 ? 'background'
              : 'idle'
    return { phase, agents: running, subagents, jobs: background, waits }
  }

  /**
   * Take one observation and advance the completion edge. The poll and both
   * event streams pass through here, so no reader can disagree about whether
   * work was still in flight.
   */
  const observe = (): DesktopWorkStatus => {
    const reported = counts()
    // A pending interaction belongs to the burst: an agent that stopped to ask
    // is not finished, and leaving it out would announce the same burst twice.
    const busy = reported.agents + reported.subagents + reported.jobs > 0 || reported.waits > 0
    if (carrying && !busy) completed++
    carrying = busy
    return { ...reported, completed }
  }

  // Polling alone misses any burst that starts and ends between two ticks; the
  // Host sees both edges here and reports them through the count instead. The
  // profile has already booted when this installs, so both services are present.
  const agents = ctx.get('agents')
  const jobs = ctx.get('jobs')
  if (agents !== undefined && jobs !== undefined) {
    ctx.on('agent/status', () => { observe() })
    ctx.effect(() => jobs.events.subscribe({ owners: 'all' }, (event) => {
      if (event.type === 'settled') observe()
    }))
  }

  return () => {
    if (stopped) throw new Error('desktop work: Host is stopping')
    return observe()
  }
}
