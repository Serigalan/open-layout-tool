import { buildApp } from './app.js'
import { openDatabase } from './db.js'
import { createAuth, passwordAcceptable, randomPassword } from './auth.js'

/**
 * olt-server — the Open Layout Tool's project server (phase 10).
 *
 *   olt-server serve                       run the API (OLT_SERVER_HOST, OLT_SERVER_PORT)
 *   olt-server create-admin <login> [name] create an admin; the start password comes
 *                                          from OLT_ADMIN_PASSWORD or is generated and printed
 *   olt-server backup <file>               write a consistent copy of the database
 *   olt-server user-count                  print how many users exist (setup asks this
 *                                          before creating the first admin)
 *
 * The database is OLT_SERVER_DB (default ./olt.sqlite). Started through
 * bin/olt-server.mjs, which registers the module hook first.
 */
const env = process.env
const DB = env.OLT_SERVER_DB ?? 'olt.sqlite'

async function main([command, ...args]) {
  if (command === 'serve') {
    const db = openDatabase(DB)
    const app = buildApp({
      db,
      secureCookie: env.OLT_SERVER_INSECURE_COOKIE !== '1',
      ...(env.OLT_SERVER_TRUST_PROXY ? { trustProxy: env.OLT_SERVER_TRUST_PROXY.split(',').map(s => s.trim()).filter(Boolean) } : {}),
      logger: { level: env.OLT_SERVER_LOG ?? 'info' },
    })
    setInterval(() => app.auth.sweep(), 3600 * 1000).unref()
    const close = async () => { await app.close(); db.close(); process.exit(0) }
    process.on('SIGTERM', close)
    process.on('SIGINT', close)
    await app.listen({ host: env.OLT_SERVER_HOST ?? '127.0.0.1', port: Number(env.OLT_SERVER_PORT ?? 8787) })
    return
  }
  if (command === 'create-admin') {
    const [login, ...nameParts] = args
    if (!login) throw new Error('usage: olt-server create-admin <login> [name]')
    const db = openDatabase(DB)
    const auth = createAuth(db)
    if (auth.userByLogin(login)) throw new Error(`a user "${login}" exists already`)
    const given = env.OLT_ADMIN_PASSWORD
    if (given && !passwordAcceptable(given)) throw new Error('OLT_ADMIN_PASSWORD is shorter than 12 characters')
    const password = given ?? randomPassword()
    await auth.createUser({ login, name: nameParts.join(' ') || login, password, role: 'admin', mustChangePassword: true })
    console.log(`admin "${login}" created.`)
    if (!given) console.log(`start password: ${password}  (to be changed at the first sign-in)`)
    db.close()
    return
  }
  if (command === 'backup') {
    const [file] = args
    if (!file) throw new Error('usage: olt-server backup <file>')
    const db = openDatabase(DB)
    await db.backup(file)
    db.close()
    console.log(`backup written to ${file}`)
    return
  }
  if (command === 'user-count') {
    const db = openDatabase(DB)
    console.log(db.prepare('select count(*) as n from user').get().n)
    db.close()
    return
  }
  throw new Error('usage: olt-server serve | create-admin <login> [name] | backup <file> | user-count')
}

main(process.argv.slice(2)).catch(err => {
  console.error(err.message)
  process.exit(1)
})
