import { useEffect, useSyncExternalStore } from 'react'
import { serviceHealth, subscribeHealth, watchServices } from '../utils/serviceHealth'

/** The last look at the services, kept current once a minute while in use (R10.12). */
export default function useServiceHealth() {
  useEffect(() => watchServices(), [])
  return useSyncExternalStore(subscribeHealth, serviceHealth, serviceHealth)
}
