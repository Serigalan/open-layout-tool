import { useEffect, useRef } from 'react'
import { openChannel } from '../../server/cloud3d/channel'

/** How long the project rests before the 3D window gets it again [ms]. */
const SEND_AFTER = 400

/**
 * The main window's side of the 3D window (AP 13.10): it answers the 3D
 * window's hello with the project — tracks, switches, routes, measured axes,
 * gauge profile — and sends it again after every change, tells it which cross
 * section is shown, and opens the cross section where the 3D window was
 * double-clicked.
 */
export default function useCloud3dChannel({ project, at, onShowCrossSection }) {
  const listening = useRef(false)
  const channel = useRef(null)
  const latest = useRef({ project, at, onShowCrossSection })
  useEffect(() => { latest.current = { project, at, onShowCrossSection } })

  const projectId = project?.id ?? null
  useEffect(() => {
    if (!projectId) return
    const send = (msg) => channel.current?.postMessage(msg)
    const ch = openChannel(projectId, (msg) => {
      const { project: p, at: a, onShowCrossSection: show } = latest.current
      if (msg.type === 'hello') {
        listening.current = true
        send({ type: 'project', data: projectData(p) })
        send({ type: 'section', at: a ?? null })
      } else if (msg.type === 'ping') {
        listening.current = true
        send({ type: 'pong' })
      } else if (msg.type === 'station' && msg.trackId) {
        show?.({ trackId: msg.trackId, station: msg.station })
      }
    })
    channel.current = ch
    return () => { ch?.close(); channel.current = null; listening.current = false }
  }, [projectId])

  useEffect(() => {
    if (!listening.current || !project) return
    const timer = setTimeout(() => channel.current?.postMessage({ type: 'project', data: projectData(project) }), SEND_AFTER)
    return () => clearTimeout(timer)
  }, [project])

  const trackId = at?.trackId ?? null, station = at?.station ?? null
  const routeId = at?.routeId ?? null, routeStation = at?.routeStation ?? null
  useEffect(() => {
    if (!listening.current) return
    channel.current?.postMessage({ type: 'section', at: trackId ? { trackId, station, routeId, routeStation } : null })
  }, [trackId, station, routeId, routeStation])
}

/** What the 3D window needs of the project. */
const projectData = (p) => (p ? {
  id: p.id, title: p.title, tracks: p.tracks ?? [], switches: p.switches ?? [],
  axisSurveys: p.axisSurveys ?? [], gaugeProfile: p.gaugeProfile ?? null, routes: p.routes ?? [],
} : null)
