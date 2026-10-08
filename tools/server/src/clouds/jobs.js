import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Jobs that run at once at most (AP 13.3). */
const PARALLEL = 2
/** How often the queue is looked at [ms]. */
const POLL = 2000
/** Heap a job's process may take [MB]: two of them stay under the service's MemoryMax of 2 GB. */
const JOB_HEAP_MB = 768

const BIN = fileURLToPath(new URL('../../bin/olt-cloudjobs.mjs', import.meta.url))

/**
 * The queue of olt-cloudjobs (AP 13.3): jobs in SQLite, each run in a process
 * of its own — a job that runs out of memory or crashes takes only itself
 * down, and the cloud says why it failed. What was running when the service
 * stopped is left as it was and queued again at the next start — a deploy
 * restarts the service, and that is no reason to fail a job.
 *
 * `run(job)` runs one job and resolves when it is done; it is a child process
 * here and a direct call in tests.
 */
export function createQueue({ clouds, parallel = PARALLEL, poll = POLL, run = runInChild, log = console.log }) {
  const running = new Map()   // job id → promise
  let timer = null
  let stopped = false

  async function start(job) {
    log(`job ${job.id} (${job.kind}) on cloud ${job.cloud_id} started`)
    try {
      await run(job)
      clouds.finishJob(job.id, 'done')
      log(`job ${job.id} done`)
    } catch (err) {
      if (stopped) { log(`job ${job.id} interrupted, queued again at the next start`); return }
      const reason = String(err?.message ?? err).slice(0, 500)
      clouds.finishJob(job.id, 'failed', reason)
      if (clouds.get(job.cloud_id)) clouds.setStatus(job.cloud_id, 'failed', { error: reason })
      log(`job ${job.id} failed: ${reason}`)
    }
  }

  /** Start what the queue holds, as far as there is room. */
  function tick() {
    while (!stopped && running.size < parallel) {
      const job = clouds.claimJob()
      if (!job) break
      const p = start(job).finally(() => { running.delete(job.id); tick() })
      running.set(job.id, p)
    }
  }

  return {
    begin() {
      clouds.requeueRunning()
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

/** One job in a process of its own; its last words on stderr are the reason it failed. */
function runInChild(job) {
  return new Promise((resolve, reject) => {
    const child = fork(BIN, ['run', String(job.id)], {
      execArgv: [`--max-old-space-size=${JOB_HEAP_MB}`],
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
