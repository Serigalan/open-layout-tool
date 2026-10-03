import { describe, it, expect } from 'vitest'
import { checkServices, serviceHealth, subscribeHealth, SERVICES } from './serviceHealth'

describe('service health', () => {
  it('starts unknown and records each answer with its time', async () => {
    expect(SERVICES.every(s => serviceHealth()[s].ok === null)).toBe(true)
    let told = 0
    const off = subscribeHealth(() => told++)
    const checks = { server: async () => true, optimizer: async () => false, terrain: async () => true }
    const state = await checkServices(null, checks)
    off()
    expect(state.server.ok).toBe(true)
    expect(state.optimizer.ok).toBe(false)
    expect(typeof state.terrain.at).toBe('string')
    expect(told).toBe(1)
  })

  it('asks one service on its own and keeps the others', async () => {
    const before = serviceHealth()
    const state = await checkServices('optimizer', { optimizer: async () => true })
    expect(state.optimizer.ok).toBe(true)
    expect(state.server).toBe(before.server)
  })
})
