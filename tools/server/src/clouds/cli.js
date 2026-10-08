import { dirname, join, resolve } from 'node:path'
import { openDatabase } from '../db.js'
import { cloudStorage } from './storage.js'
import { createCloudStore } from './cloudStore.js'
import { createQueue, runQueueJobs } from './jobs.js'
import { prepareCloud } from './prepare.js'
import { createRunStore } from './runStore.js'
import { executeRun } from './runs.js'

const env = process.env
const DB = env.OLT_SERVER_DB ?? 'olt.sqlite'
const CLOUDS = env.OLT_SERVER_CLOUDS ?? join(dirname(resolve(DB)), 'clouds')
const stamp = () => new Date().toISOString()

export async function main([command, ...args]) {
  const db = openDatabase(DB)
  const clouds = createCloudStore(db)
  const storage = cloudStorage(CLOUDS)
  if (command === 'serve') {
    const queue = createQueue({
      clouds, parallel: Number(env.OLT_CLOUDJOBS_PARALLEL ?? 2),
      log: (m) => console.log(`${stamp()} ${m}`),
    })
    // The long runs (AP 13.7) in a queue of their own, beside the preparations.
    const runQueue = createQueue({
      clouds, jobs: runQueueJobs(createRunStore(db)), parallel: Number(env.OLT_CLOUDRUNS_PARALLEL ?? 2),
      log: (m) => console.log(`${stamp()} ${m}`),
    })
    queue.begin()
    runQueue.begin()
    const close = async () => { await Promise.all([queue.stop(), runQueue.stop()]); db.close(); process.exit(0) }
    process.on('SIGTERM', close)
    process.on('SIGINT', close)
    console.log(`${stamp()} olt-cloudjobs: queue in ${DB}, clouds in ${CLOUDS}`)
    return
  }
  if (command === 'run') {
    const job = clouds.job(Number(args[0]))
    if (!job) throw new Error(`no job ${args[0]}`)
    try {
      await prepareCloud({ cloudId: job.cloud_id, clouds, storage, log: (m) => console.log(`${stamp()} ${m}`) })
    } catch (err) {
      console.error(err?.name === 'AbortError' ? 'the cloud was deleted meanwhile' : String(err?.message ?? err))
      db.close()
      process.exit(1)
    }
    db.close()
    return
  }
  if (command === 'exec') {
    const runs = createRunStore(db)
    try {
      await executeRun({ runId: Number(args[0]), runs, clouds, storage, log: (m) => console.log(`${stamp()} ${m}`) })
    } catch (err) {
      console.error(String(err?.message ?? err))
      db.close()
      process.exit(1)
    }
    db.close()
    return
  }
  console.error('usage: olt-cloudjobs serve | run <job> | exec <run>')
  process.exit(2)
}
