import { afterEach, describe, expect, it } from 'vitest'
import { as, PW, setup, signIn } from './helpers.js'
import { BRAKE_ATTEMPTS, SESSION_IDLE } from '../src/auth.js'

let ctx
afterEach(async () => { await ctx?.app.close(); ctx?.db.close() })

describe('signing in', () => {
  it('opens a session: the cookie is HttpOnly and SameSite=Strict, /me knows the user', async () => {
    ctx = await setup()
    const res = await ctx.app.inject({ method: 'POST', url: '/api/login', payload: { login: 'max', password: PW } })
    expect(res.statusCode).toBe(200)
    expect(res.json().user).toMatchObject({ login: 'max', name: 'Max Muster', role: 'user' })
    expect(res.json().user.password_hash).toBeUndefined()
    const cookie = res.cookies.find(c => c.name === 'olt_session')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' })
    const me = await as(ctx.app, cookie.value)('GET', '/api/me')
    expect(me.statusCode).toBe(200)
    expect(me.json().user.login).toBe('max')
  })

  it('takes the login without regard to case', async () => {
    ctx = await setup()
    await expect(signIn(ctx.app, 'MAX')).resolves.toBeTypeOf('function')
  })

  it('refuses a wrong password and an unknown login alike', async () => {
    ctx = await setup()
    const wrong = await ctx.app.inject({ method: 'POST', url: '/api/login', payload: { login: 'max', password: 'nope nope nope' } })
    const unknown = await ctx.app.inject({ method: 'POST', url: '/api/login', payload: { login: 'nobody', password: PW } })
    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.json()).toEqual(unknown.json())
  })

  it('brakes after five failures for a minute, the right password included', async () => {
    ctx = await setup()
    const tryIt = (password) => ctx.app.inject({ method: 'POST', url: '/api/login', payload: { login: 'max', password } })
    for (let i = 1; i < BRAKE_ATTEMPTS; i++) expect((await tryIt('wrong password!')).statusCode).toBe(401)
    const fifth = await tryIt('wrong password!')
    expect(fifth.statusCode).toBe(429)
    expect(fifth.json()).toMatchObject({ error: 'too_many_attempts', retryAfter: 60 })
    expect((await tryIt(PW)).statusCode).toBe(429)
    ctx.clock.t += 61 * 1000
    expect((await tryIt(PW)).statusCode).toBe(200)
  })

  it('a session unused for 30 days has run out; use keeps it alive', async () => {
    ctx = await setup()
    const max = await signIn(ctx.app, 'max')
    ctx.clock.t += SESSION_IDLE - 1000
    expect((await max('GET', '/api/me')).statusCode).toBe(200)
    ctx.clock.t += SESSION_IDLE - 1000
    expect((await max('GET', '/api/me')).statusCode).toBe(200)
    ctx.clock.t += SESSION_IDLE + 1000
    expect((await max('GET', '/api/me')).statusCode).toBe(401)
  })

  it('signing out ends every session of the user', async () => {
    ctx = await setup()
    const a = await signIn(ctx.app, 'max')
    const b = await signIn(ctx.app, 'max')
    expect((await a('POST', '/api/logout')).statusCode).toBe(204)
    expect((await b('GET', '/api/me')).statusCode).toBe(401)
  })

  it('a writing request without JSON is refused', async () => {
    ctx = await setup()
    const res = await ctx.app.inject({ method: 'POST', url: '/api/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'login=max&password=x' })
    expect(res.statusCode).toBe(415)
  })
})

describe('users and roles', () => {
  it('a user may not create users; an admin may, and the new one must change the start password', async () => {
    ctx = await setup()
    const max = await signIn(ctx.app, 'max')
    expect((await max('POST', '/api/admin/users', { login: 'eve', password: 'x'.repeat(12) })).statusCode).toBe(403)
    const ada = await signIn(ctx.app, 'ada')
    const created = await ada('POST', '/api/admin/users', { login: 'lena', name: 'Lena Schulz', password: 'start-password-1' })
    expect(created.statusCode).toBe(201)
    expect(created.json().user).toMatchObject({ login: 'lena', role: 'user', mustChangePassword: true })

    const lena = await signIn(ctx.app, 'lena', 'start-password-1')
    expect((await lena('GET', '/api/me')).statusCode).toBe(200)
    expect((await lena('GET', '/api/admin/users')).json()).toEqual({ error: 'password_change_required' })
    expect((await lena('POST', '/api/me/password', { current: 'start-password-1', next: 'short' })).statusCode).toBe(422)
    expect((await lena('POST', '/api/me/password', { current: 'start-password-1', next: 'my own long password' })).statusCode).toBe(204)
    expect((await lena('GET', '/api/me')).json().user.mustChangePassword).toBe(false)
  })

  it('refuses a password under 12 characters and a login that is taken', async () => {
    ctx = await setup()
    const ada = await signIn(ctx.app, 'ada')
    expect((await ada('POST', '/api/admin/users', { login: 'kurt', password: 'elevenchars' })).json()).toEqual({ error: 'password_too_short' })
    expect((await ada('POST', '/api/admin/users', { login: 'Max', password: 'x'.repeat(12) })).json()).toEqual({ error: 'login_taken' })
  })

  it('a deactivated user is signed out and cannot sign in again', async () => {
    ctx = await setup()
    const max = await signIn(ctx.app, 'max')
    const ada = await signIn(ctx.app, 'ada')
    const id = (await max('GET', '/api/me')).json().user.id
    expect((await ada('PATCH', `/api/admin/users/${id}`, { active: false })).statusCode).toBe(200)
    expect((await max('GET', '/api/me')).statusCode).toBe(401)
    const again = await ctx.app.inject({ method: 'POST', url: '/api/login', payload: { login: 'max', password: PW } })
    expect(again.statusCode).toBe(401)
    expect((await ada('PATCH', `/api/admin/users/${id}`, { active: true })).statusCode).toBe(200)
    await expect(signIn(ctx.app, 'max')).resolves.toBeTypeOf('function')
  })

  it('a reset password has to be changed and ends the sessions', async () => {
    ctx = await setup()
    const max = await signIn(ctx.app, 'max')
    const ada = await signIn(ctx.app, 'ada')
    const id = (await max('GET', '/api/me')).json().user.id
    await ada('PATCH', `/api/admin/users/${id}`, { password: 'reset-password-1' })
    expect((await max('GET', '/api/me')).statusCode).toBe(401)
    const again = await signIn(ctx.app, 'max', 'reset-password-1')
    expect((await again('GET', '/api/me')).json().user.mustChangePassword).toBe(true)
  })

  it('the last active admin cannot be demoted or deactivated', async () => {
    ctx = await setup()
    const ada = await signIn(ctx.app, 'ada')
    const id = (await ada('GET', '/api/me')).json().user.id
    expect((await ada('PATCH', `/api/admin/users/${id}`, { role: 'user' })).json()).toEqual({ error: 'last_admin' })
    expect((await ada('PATCH', `/api/admin/users/${id}`, { active: false })).json()).toEqual({ error: 'last_admin' })
    // With a second admin it can.
    const maxId = (await ada('GET', '/api/admin/users')).json().users.find(u => u.login === 'max').id
    await ada('PATCH', `/api/admin/users/${maxId}`, { role: 'admin' })
    expect((await ada('PATCH', `/api/admin/users/${id}`, { role: 'user' })).statusCode).toBe(200)
  })
})
