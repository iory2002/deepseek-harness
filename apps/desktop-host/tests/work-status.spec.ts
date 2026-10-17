import { Context } from '@deepseek-ai/cordis'
import { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { JobEventFilter, JobEventListener, JobStatus, JobView } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-questions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installDesktopWorkStatusInspection } from '../src/work-status.ts'

type AgentState = { id: SessionId; status: 'idle' | 'running' }
/** One registered job; an unowned record is visible to every caller, as the real registry projects it. */
type JobRecord = { readonly id: string; readonly status: JobStatus; readonly owner?: SessionId }

let ctx: Context
let inspect: ReturnType<typeof installDesktopWorkStatusInspection>
const live: AgentState[] = []
const topLevel: SessionId[] = []
const registryJobs: JobRecord[] = []
/** Listeners the inspector registered on the job stream, so a test can settle a job. */
let jobListeners: JobEventListener[] = []

/** One record as the registry projects it. */
function jobView(record: JobRecord): JobView {
  return {
    id: JobId(record.id),
    kind: 'bash',
    label: 'sleep 60',
    ...record.owner === undefined ? {} : { owner: record.owner },
    status: record.status,
    startedAt: 0,
    output: { total: 0, earliest: 0 },
  }
}

/** A registry whose only served member is the per-owner roster the inspector reads. */
class RosterOnlyJobRegistry extends JobRegistry {
  readonly events = {
    subscribe: (_filter: JobEventFilter, listener: JobEventListener): () => void => {
      jobListeners.push(listener)
      return () => { jobListeners = jobListeners.filter(entry => entry !== listener) }
    },
  }
  start(): never { throw new Error('unsupported') }
  list(caller?: SessionId): JobView[] {
    return registryJobs
      .filter(job => job.owner === undefined || (caller !== undefined && job.owner === caller))
      .map(jobView)
  }
  get(): never { throw new Error('unsupported') }
  read(): never { throw new Error('unsupported') }
  readAt(): never { throw new Error('unsupported') }
  kill(): never { throw new Error('unsupported') }
  wait(): never { throw new Error('unsupported') }
  remove(): never { throw new Error('unsupported') }
  attachController(): () => void { return () => {} }
}

function agent(id: string, status: 'idle' | 'running' = 'idle', root = true): AgentState {
  const state = { id: SessionId(id), status }
  live.push(state)
  if (root) topLevel.push(state.id)
  return state
}

/** Report one agent changing status, the way the agent loop does. */
function reportStatus(state: AgentState, status: 'idle' | 'running'): void {
  state.status = status
  ctx.emit('agent/status', { agent: state, status } as never)
}

/** Report one job settling, the transition that ends background work. */
function reportSettled(record: JobRecord): void {
  for (const listener of [...jobListeners]) {
    listener({ type: 'settled', job: jobView(record), cause: 'producer', awaited: false })
  }
}

/** A pending question the test can answer later. */
function askQuestion(): { readonly answer: Promise<unknown>; settle: () => void } {
  const settle = Promise.withResolvers<AskUserQuestionAnswer>()
  void ctx.waterfall('user-questions/request', { questions: [] }, () => settle.promise)
  return { answer: settle.promise, settle: () => { settle.resolve({ answers: [] }) } }
}

beforeEach(() => {
  live.length = 0
  topLevel.length = 0
  registryJobs.length = 0
  jobListeners = []
  ctx = new Context()
  // Narrow service doubles exercise the inspector against a real Cordis event lifecycle.
  ctx.provide('agents', { list: () => live, roots: () => live.filter(state => topLevel.includes(state.id)) } as never)
  new RosterOnlyJobRegistry(ctx)
  inspect = installDesktopWorkStatusInspection(ctx)
})

afterEach(async () => { await ctx.fiber.dispose() })

describe('Desktop Host work status', () => {
  it('reports idle for a live but quiet Host', () => {
    agent('quiet')
    expect(inspect()).toEqual({ phase: 'idle', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 0 })
  })

  it('reports a running top-level agent as working', () => {
    agent('busy', 'running')
    expect(inspect()).toEqual({ phase: 'working', agents: 1, subagents: 0, jobs: 0, waits: 0, completed: 0 })
  })

  it('separates delegated children from their running parents', () => {
    agent('parent', 'running')
    agent('child', 'running', false)
    expect(inspect()).toEqual({ phase: 'subagent', agents: 1, subagents: 1, jobs: 0, waits: 0, completed: 0 })
  })

  it('counts live jobs once across overlapping owner listings', () => {
    const first = agent('first')
    const second = agent('second')
    registryJobs.push(
      { id: 'bash-1', status: 'running', owner: first.id },
      { id: 'bash-2', status: 'completed', owner: first.id },
      { id: 'bash-3', status: 'stopping', owner: second.id },
      // Visible to both owned listings; the union must still count it once.
      { id: 'bash-4', status: 'running' },
    )
    expect(inspect()).toEqual({ phase: 'background', agents: 0, subagents: 0, jobs: 3, waits: 0, completed: 0 })
  })

  it('reads the unowned roster when no agent is live', () => {
    registryJobs.push({ id: 'bash-1', status: 'running' }, { id: 'bash-2', status: 'killed' })
    expect(inspect()).toEqual({ phase: 'background', agents: 0, subagents: 0, jobs: 1, waits: 0, completed: 0 })
  })

  it('counts a pending question as waiting and clears it when the request settles', async () => {
    const pending = Promise.withResolvers<AskUserQuestionAnswer>()
    const asked = ctx.waterfall('user-questions/request', { questions: [] }, () => pending.promise)
    expect(inspect()).toEqual({ phase: 'waiting', agents: 0, subagents: 0, jobs: 0, waits: 1, completed: 0 })
    pending.resolve({ answers: [] })
    await asked
    // The question was the whole burst: answering it finishes the work.
    expect(inspect()).toEqual({ phase: 'idle', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 1 })
  })

  it('keeps waiting ahead of other running work', () => {
    agent('busy', 'running')
    const settle = Promise.withResolvers<AskUserQuestionAnswer>()
    void ctx.waterfall('user-questions/request', { questions: [] }, () => settle.promise)
    expect(inspect()).toEqual({ phase: 'waiting', agents: 1, subagents: 0, jobs: 0, waits: 1, completed: 0 })
    settle.resolve({ answers: [] })
  })

  it('restores the delegated request outcome after observing it', async () => {
    const answer = { answers: [{ id: 'q1', selected: ['yes'] }] }
    await expect(ctx.waterfall('user-questions/request', { questions: [] }, () => Promise.resolve(answer)))
      .resolves.toEqual(answer)
  })

  it('does not classify unavailable task services as idle', async () => {
    const empty = new Context()
    try {
      expect(() => installDesktopWorkStatusInspection(empty)()).toThrow('task services are unavailable')
    } finally { await empty.fiber.dispose() }
  })

  it('refuses inspection after disposal', async () => {
    expect(inspect().phase).toBe('idle')
    await ctx.fiber.dispose()
    expect(() => inspect()).toThrow('Host is stopping')
  })
})

describe('Desktop Host completion count', () => {
  it('never announces a burst the live but quiet Host did not run', () => {
    agent('quiet')
    reportStatus(live[0]!, 'idle')
    expect(inspect().completed).toBe(0)
  })

  it('announces a burst once its last work ends', () => {
    const busy = agent('busy', 'running')
    expect(inspect().completed).toBe(0)
    reportStatus(busy, 'idle')
    expect(inspect().completed).toBe(1)
  })

  it('does not announce the same burst twice', () => {
    const busy = agent('busy', 'running')
    inspect()
    reportStatus(busy, 'idle')
    reportStatus(busy, 'idle')
    expect(inspect().completed).toBe(1)
  })

  it('announces a burst that both started and ended between two polls', () => {
    const busy = agent('busy')
    // Both edges arrive as status events; no poll ever sees the agent running.
    reportStatus(busy, 'running')
    reportStatus(busy, 'idle')
    expect(inspect()).toEqual({ phase: 'idle', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 1 })
  })

  it('holds the burst open while a question is pending', async () => {
    const busy = agent('busy', 'running')
    const asked = askQuestion()
    inspect()
    reportStatus(busy, 'idle')
    expect(inspect().completed).toBe(0)
    asked.settle()
    await asked.answer
    expect(inspect().completed).toBe(1)
  })

  it('waits for a settling job while an agent still runs', () => {
    const busy = agent('busy', 'running')
    registryJobs.push({ id: 'bash-1', status: 'running' })
    inspect()
    registryJobs[0] = { id: 'bash-1', status: 'completed' }
    reportSettled(registryJobs[0])
    expect(inspect().completed).toBe(0)
    reportStatus(busy, 'idle')
    expect(inspect().completed).toBe(1)
  })

  it('announces a job-only burst when the job settles', () => {
    registryJobs.push({ id: 'bash-1', status: 'running' })
    expect(inspect().completed).toBe(0)
    registryJobs[0] = { id: 'bash-1', status: 'completed' }
    reportSettled(registryJobs[0])
    expect(inspect().completed).toBe(1)
  })

  it('releases the job listener on disposal', async () => {
    expect(jobListeners).toHaveLength(1)
    await ctx.fiber.dispose()
    expect(jobListeners).toHaveLength(0)
  })
})
