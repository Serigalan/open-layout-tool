import { dirname, join, resolve } from 'node:path'
import { openDatabase } from '../db.js'
import { cloudStorage } from './storage.js'
import { createCloudStore } from './cloudStore.js'
import { createQueue } from './jobs.js'
import { prepareCloud } from './prepare.js'

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
    queue.begin()
    const close = async () => { await queue.stop(); db.close(); process.exit(0) }
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
  console.error('usage: olt-cloudjobs serve | run <job>')
  process.exit(2)
}
