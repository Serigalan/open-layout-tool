import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { serverLevel } from '../cloudsOnServer'
import { PALETTE } from '../../core/styles/palette'
import useRegistrationSession from './useRegistrationSession'

/**
 * The 3D window's re-referencing as core sees it (`useCloudRegistration`,
 * core/utils/pointCloud/cloudRegistration.js): the session, and — with
 * `level` — the two clouds it is about at that level, the reference cloud in
 * its colour and the one being fitted where the solution puts it.
 */
export default function useCloudRegistration(projectId, level = null) {
  const { session: reg, cloudsVersion, sendPair } = useRegistrationSession(projectId)
  const key = reg && level != null
    ? `${reg.refId}|${reg.adjId}|${reg.refPlane}|${(reg.matrix ?? []).map(v => v.toPrecision(10)).join(',')}|${level}|${cloudsVersion}`
    : null
  const [loaded, setLoaded] = useState({ key: null, clouds: [] })
  useEffect(() => {
    if (!key) return undefined
    let live = true
    api.clouds(projectId).then(async ({ clouds: rows }) => {
      const ref = rows.find(r => r.id === reg.refId), adj = rows.find(r => r.id === reg.adjId)
      const out = []
      if (ref) out.push({ ...(await serverLevel(projectId, ref, level)), color: PALETTE.sectionRefCloud, role: 'ref' })
      if (adj && reg.matrix) {
        out.push({
          ...(await serverLevel(projectId, adj, level)), transform: { matrix: reg.matrix, crs: reg.refPlane },
          color: PALETTE.sectionFitCloud, role: 'adj',
        })
      }
      if (live) setLoaded({ key, clouds: out })
    }).catch(() => { if (live) setLoaded({ key, clouds: [] }) })
    return () => { live = false }
    // the session is part of the key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, projectId])
  return { session: reg, cloudsVersion, sendPair, key, clouds: loaded.key === key ? loaded.clouds : [] }
}
