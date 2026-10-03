import { useEffect, useState } from 'react'

/** Seconds since `running` turned true, counted up once a second; 0 while it is not (R10.12). */
export default function useElapsed(running) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running) return undefined
    const start = Date.now()
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000)
    return () => { clearInterval(timer); setElapsed(0) }
  }, [running])
  return running ? elapsed : 0
}
