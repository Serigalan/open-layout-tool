#!/usr/bin/env node
// olt-cloudjobs — prepares uploaded point clouds (phase 13, AP 13.3).
//
//   olt-cloudjobs serve        take jobs from the queue, at most two at once
//   olt-cloudjobs run <job>    run one job (what serve starts per job)
//
// Same database and cloud directory as olt-server (OLT_SERVER_DB,
// OLT_SERVER_CLOUDS). The module hook first: the jobs run the browser's own
// point cloud code from src/.
import '../src/register.mjs'

const { main } = await import('../src/clouds/cli.js')
await main(process.argv.slice(2))
