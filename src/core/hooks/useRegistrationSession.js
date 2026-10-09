import { useCallback, useEffect, useRef, useState } from 'react'
import { openChannel } from '../../server/cloud3d/channel'

/**
 * The 3D window's re-referencing as a cross section sees it (AP 13.14): the
 * session — reference cloud, cloud to fit, the plane and the transformation
 * being fitted — and a way to send a pair picked in the section into the
 * 3D window's list. The cross section asks for the session when it opens, in
 * the main window or a window of its own; `cloudsVersion` counts the times a
 * cloud's re-referencing was kept or put back since, so the clouds are read
 * anew.
 */
export default function useRegistrationSession(projectId) {
  const [session, setSession] = useState(null)
  const [cloudsVersion, setCloudsVersion] = useState(0)
  const channel = useRef(null)

  useEffect(() => {
    if (!projectId) return undefined
    const ch = openChannel(projectId, (msg) => {
      if (msg.type === 'registration') setSession(msg.session ?? null)
      if (msg.type === 'clouds') setCloudsVersion(v => v + 1)
    })
    channel.current = ch
    ch?.postMessage({ type: 'registration?' })
    return () => { ch?.close(); channel.current = null }
  }, [projectId])

  const sendPair = useCallback((pair) => channel.current?.postMessage({ type: 'pair', pair }), [])
  return { session, cloudsVersion, sendPair }
}
