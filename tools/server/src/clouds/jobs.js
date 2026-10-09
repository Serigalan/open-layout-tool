import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Jobs that run at once at most (AP 13.3). */
const PARALLEL = 2
/** How often the queue is looked at [ms]. */
const POLL = 2000
/** Heap a job's process may take [MB]: two of them stay under the service's MemoryMax of 2 GB. */
const JOB_HEAP_MB = 768
/** Heap a long run's process may take [MB] (AP 13.7): it holds a slice and 64 MB of segments. */
const RUN_HEAP_MB = 320

const BIN = fileURLToPath(new URL('../../bin/olt-cloudjobs.mjs', import.meta.url))

/**
 * The queue of olt-cloudjobs (AP 13.3): jobs in SQLite, each run in a process
 * of its own — a job that runs out of memory or crashes takes only itself
 * down, and the cloud says why it failed. What was running when the service
 * stopped is left as it was and queued again at the next start — a deploy
 * restarts the service, and that is no reason to fail a job.
 *
 * `run(job)` runs one job and resolves when it is done; it is a child process
 * here and a direct call in tests. `jobs` says where the jobs come from and
 * where they end — the preparations of `clouds` unless given (runQueueJobs
 * for the long runs of AP 13.7).
 */
export function createQueue({
  clouds, jobs = prepareJobs(clouds), parallel = PARALLEL, poll = POLL, run = jobs.runInChild, log = console.log,
}) {
  const running = new Map()   // job id → promise
  let timer = null
  let stopped = false

  async function start(job) {
    log(`${jobs.label(job)} started`)
    try {
      await run(job)
      jobs.done(job)
      log(`${jobs.label(job)} done`)
    } catch (err) {
      if (stopped) { log(`${jobs.label(job)} interrupted, queued again at the next start`); return }
      const reason = String(err?.message ?? err).slice(0, 500)
      jobs.failed(job, reason)
      log(`${jobs.label(job)} failed: ${reason}`)
    }
  }

  /** Start what the queue holds, as far as there is room. */
  function tick() {
    while (!stopped && running.size < parallel) {
      const job = jobs.claim()
      if (!job) break
      const p = start(job).finally(() => { running.delete(job.id); tick() })
      running.set(job.id, p)
    }
  }

  return {
    begin() {
      jobs.requeue()
      tick()
      timer = setInterval(tick, poll)
    },
    tick,
    /** Wait until no job runs (and none is started meanwhile). */
    async drain() {
      while (running.size) await Promise.allSettled([...running.values()])
    },
    /** Stop taking jobs and wait for the running ones. */
    async stop() {
      stopped = true
      clearInterval(timer)
      await Promise.allSettled(running.values())
    },
    running: () => running.size,
  }
}

/** The preparations of uploaded clouds (AP 13.3). */
function prepareJobs(clouds) {
  return {
    claim: () => clouds.claimJob(),
    requeue: () => clouds.requeueRunning(),
    label: (job) => `job ${job.id} (${job.kind}) on cloud ${job.cloud_id}`,
    done: (job) => clouds.finishJob(job.id, 'done'),
    failed(job, reason) {
      clouds.finishJob(job.id, 'failed', reason)
      if (clouds.get(job.cloud_id)) clouds.setStatus(job.cloud_id, 'failed', { error: reason })
    },
    runInChild: (job) => runInChild(['run', String(job.id)], JOB_HEAP_MB),
  }
}

/**
 * The long runs over a project's clouds (AP 13.7): a queue of their own next
 * to the preparations, so that a check along a track does not wait hours
 * behind the preparation of a delivery. A run finishes itself when it is
 * done (with its result); here it only fails, or was cancelled meanwhile.
 */
export function runQueueJobs(runs) {
  return {
    claim: () => runs.claim(),
    requeue() { runs.requeueRunning(); runs.prune() },
    label: (run) => `run ${run.id} (${run.kind}) in project ${run.project_id}`,
    done: () => {},
    failed: (run, reason) => runs.finish(run.id, 'failed', reason),
    runInChild: (run) => runInChild(['exec', String(run.id)], RUN_HEAP_MB),
  }
}

/** One job in a process of its own; its last words on stderr are the reason it failed. */
function runInChild(args, heapMb) {
  return new Promise((resolve, reject) => {
    const child = fork(BIN, args, {
      execArgv: [`--max-old-space-size=${heapMb}`],
      stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
    })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); process.stderr.write(d) })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim().split('\n').at(-1) || `exited with ${signal ?? code}`))
    })
  })
}
