import { useState, useEffect, useRef } from 'react'
import { loadTracks, loadSwitches, loadProjects, importProjects, exportProjectsPayload, saveTrack, saveSwitch, updateTrack, updateProject, generateId, recalcAbsLengths, rebuildCoords, nextTrackName, commitSwitchConnection } from '../../storage'
import { parseProjectsPayload, PayloadError } from '../../utils/persistenceUtils'
import { parseRecords, buildElements } from '../../utils/vermEsnImport'
import { reconstructElements } from '../../utils/elementReconstruct'
import { ExternalLinkIcon } from '../icons'
import { exportToOsrd, OSRD_URL } from '../../utils/osrdExport'
import { exportExchange, FORMAT_VERSION } from '../../utils/exchangeExport'
import { parseOsrdRailJson } from '../../utils/osrdImport'
import { fitToTracks } from '../../utils/mapRenderUtils'
import { downloadJSON } from '../../utils/fileUtils'
import { EPSG_OPTIONS, crsDatum, crsLabel } from '../../utils/coordinateUtils'
import useTrackHover from '../../hooks/useTrackHover'
import { FILTER_NONE, HIT_TOLERANCE, mapIsLive } from '../../utils/mapConstants'
import { parseGleislageCsv, parseUeberhoehungCsv, listStrecken, buildTracksFromCsv, CSV_EPSG } from '../../utils/gleislageCsvImport'
import { parseMdbPayload, listMdbStrecken, buildTracksFromMdb, buildAllTracksFromMdb, mdbSwitchInventory } from '../../utils/mdbImport'
import { placeMdbSwitches } from '../../utils/mdbSwitchPlacement'
import { linkAllJoints } from '../../utils/trackLinkUtils'
import { transformTrackToPlane } from '../../utils/planeTransform'
import { loadGridsFor } from '../../utils/ntv2Grid'
import { convertMdbOnServer, OptimizerError } from '../../utils/optimizerService'

/**
 * How long the way to OSRD stays offered after an export [ms]. The file is in
 * the downloads folder at that point and the next step is to load it into OSRD,
 * so the link is put where the eye already is instead of at the top of the
 * section — but only for as long as that export is what the user is thinking
 * about.
 */
const OSRD_LINK_TIMEOUT = 30000

/** The line-number picker's entry for „every line in the file“. */
const ALL_STRECKEN = '*'

function ExchangeSection({ title, description, children }) {
  return (
    <div className="element-form">
      <span className="create-element-section">{title}</span>
      {description && (
        <p style={{ margin: 0, fontSize: 12, color: '#555', fontFamily: 'system-ui, sans-serif', lineHeight: 1.4 }}>
          {description}
        </p>
      )}
      {children}
    </div>
  )
}

function trackLabel(track) {
  const parts = [track.lineNumber, track.name || track.trackNumber].filter(Boolean)
  return parts.length ? parts.join(' · ') : track.id
}

export default function DataExchangePanel({ t, map, project, onProjectImported, onTrackSaved }) {
  const tracks = project ? loadTracks(project.id) : []
  const trackCount = tracks.length
  const [before, after] = t('data_exchange_project_desc').split('{{tracks}}')
  const importInputRef = useRef(null)

  const [phase, setPhase]               = useState('idle')
  const [selectedIds, setSelectedIds]   = useState(new Set())
  const [conflicts, setConflicts]       = useState([])   // [{existing, imported}, ...]
  const resolvedRef                     = useRef([])
  const [trackConflicts, setTrackConflicts] = useState([])   // [{existing, imported}, ...]
  const [epsg, setEpsg]                 = useState('5683')
  const [esnErrors, setEsnErrors]       = useState([])
  const esnInputRef                     = useRef(null)
  const trackImportRef                  = useRef(null)
  const csvInputRef                     = useRef(null)
  const cantInputRef                    = useRef(null)
  const csvRowsRef                      = useRef(null)   // parsed rows, kept out of state
  const cantRowsRef                     = useRef(null)
  const [cantCount, setCantCount]       = useState(0)
  const [csvStrecken, setCsvStrecken]   = useState([])
  const [csvStrecke, setCsvStrecke]     = useState('3824')
  const [csvSourceEpsg, setCsvSourceEpsg] = useState(String(CSV_EPSG))
  const [csvTargetEpsg, setCsvTargetEpsg] = useState(String(CSV_EPSG))
  const [csvErrors, setCsvErrors]       = useState([])
  const [csvBusy, setCsvBusy]           = useState(false)
  const mdbInputRef                     = useRef(null)
  const mdbPayloadRef                   = useRef(null)   // converted Satzarten, kept out of state
  const [mdbStrecken, setMdbStrecken]   = useState([])
  const [mdbStrecke, setMdbStrecke]     = useState('')
  const [mdbCounts, setMdbCounts]       = useState(null)
  const [mdbErrors, setMdbErrors]       = useState([])
  const [mdbSwitches, setMdbSwitches]   = useState(true)
  const [mdbBusy, setMdbBusy]           = useState(false)
  // The second MDB importer, the one that writes DB_REF. Its own file and
  // its own line picker: it is a different question asked of the same kind
  // of database, and answering it replaces the coordinates for good.
  const dbrefInputRef                   = useRef(null)
  const dbrefPayloadRef                 = useRef(null)
  const [dbrefStrecken, setDbrefStrecken] = useState([])
  const [dbrefStrecke, setDbrefStrecke] = useState('')
  const [dbrefCounts, setDbrefCounts]   = useState(null)
  const [dbrefErrors, setDbrefErrors]   = useState([])
  const [dbrefSwitches, setDbrefSwitches] = useState(true)
  const [dbrefBusy, setDbrefBusy]       = useState(false)
  const [dbrefTarget, setDbrefTarget]   = useState('5684')
  const osrdInputRef                    = useRef(null)
  const [osrdErrors, setOsrdErrors]     = useState([])
  const [osrdExported, setOsrdExported] = useState(false)
  const osrdLinkTimer                   = useRef(null)
  const exchangeInputRef                = useRef(null)
  const [exchangeOpen, setExchangeOpen] = useState(false)
  const [importError, setImportError]       = useState(null)   // why a project file was refused

  useTrackHover(map, phase, 'selecting', project)

  // Click handler for map selection
  useEffect(() => {
    if (phase !== 'selecting' || !map?.current) return
    const m = map.current

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
      if (!features.length) return
      const { trackId } = features[0].properties
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.has(trackId) ? next.delete(trackId) : next.add(trackId)
        return next
      })
    }

    m.on('click', onClick)
    return () => m.off('click', onClick)
  }, [phase, map])

  // Cleanup hover on unmount
  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m) || !m.getLayer('tracks-hover-layer')) return
      m.setFilter('tracks-hover-layer', FILTER_NONE)
      m.getCanvas().style.cursor = ''
    }
  }, [map])

  // The payload check carries a `code`; an error without one says as much as
  // the caller knows — a broken file.
  const codedErrorText = (err, fallback) => {
    const code = err instanceof PayloadError ? err.code : fallback
    return t(`data_exchange_import_err_${code}`)
  }

  // Take imported projects into the store. Ids that are already here are
  // asked about one by one; nothing is written until every conflict is
  // answered.
  const ingestProjects = (incoming) => {
    const existing = loadProjects()
    const existingIds = new Set(existing.map(p => p.id))
    const conflicting = incoming.filter(p => existingIds.has(p.id))
    const noConflict  = incoming.filter(p => !existingIds.has(p.id))

    if (conflicting.length === 0) {
      importProjects(incoming)
      onProjectImported?.()
      return
    }
    resolvedRef.current = noConflict
    setConflicts(conflicting.map(imp => ({
      imported: imp,
      existing: existing.find(p => p.id === imp.id),
    })))
  }

  const handleProjectImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    setImportError(null)
    reader.onload = (ev) => {
      try {
        ingestProjects(parseProjectsPayload(JSON.parse(ev.target.result)).projects)
      } catch (err) {
        // A file this tool will not take — broken JSON, or a project from
        // before the current model. Both say so rather than doing nothing.
        setImportError(codedErrorText(err, 'invalid_payload'))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const resolveConflict = (keepImported) => {
    const [current, ...rest] = conflicts
    const chosen = keepImported ? current.imported : current.existing
    resolvedRef.current = [...resolvedRef.current, chosen]
    if (rest.length === 0) {
      importProjects(resolvedRef.current)
      resolvedRef.current = []
      setConflicts([])
      onProjectImported?.()
    } else {
      setConflicts(rest)
    }
  }

  const handleProjectExport = () => {
    downloadJSON(exportProjectsPayload(), project ? `${project.title}.json` : 'olt_projects.json')
  }

  const handleTracksExport = () => {
    if (!selectedIds.size) return
    const data = selectedTracks.map(({ elements, coordinates: _c, ...trackRest }) => ({
      ...trackRest,
      elements: (elements ?? []).map(({ geometry: _g, renderCoords: _rc, ...rest }) => rest),
    }))
    downloadJSON(data, project ? `${project.title}_tracks.json` : 'tracks.json')
  }

  // Rebuild display geometry from the element scalars (native CRS per element).
  function reconstructTrack(track) {
    const elements = reconstructElements(track.elements, track.epsg)
    return { ...track, elements, coordinates: rebuildCoords(elements) }
  }

  const handleTracksImport = (e) => {
    const file = e.target.files?.[0]
    if (!file || !project) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        const incoming = Array.isArray(data) ? data : [data]
        const existingTracks = loadTracks(project.id)
        const existingIds = new Set(existingTracks.map(t => t.id))

        const conflicting = incoming.filter(t => existingIds.has(t.id))
        const noConflict  = incoming.filter(t => !existingIds.has(t.id))

        noConflict.forEach(track => saveTrack(project.id, reconstructTrack(track)))

        if (noConflict.length > 0) onTrackSaved?.()

        if (conflicting.length > 0) {
          setTrackConflicts(conflicting.map(imp => ({
            imported: imp,
            existing: existingTracks.find(t => t.id === imp.id),
          })))
        }
      } catch (err) {
        console.error('Track import error:', err)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const resolveTrackConflict = (keepImported) => {
    const [current, ...rest] = trackConflicts
    if (keepImported) updateTrack(project.id, reconstructTrack(current.imported))
    onTrackSaved?.()
    if (rest.length === 0) {
      setTrackConflicts([])
    } else {
      setTrackConflicts(rest)
    }
  }

  const handleEsnImport = (e) => {
    const file = e.target.files?.[0]
    if (!file || !project) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const { elements, errors } = buildElements(parseRecords(ev.target.result), Number(epsg))
        setEsnErrors(errors)
        if (errors.length || !elements.length) return
        const recalced = recalcAbsLengths(elements)
        saveTrack(project.id, { id: generateId(), epsg: Number(epsg), coordinates: rebuildCoords(recalced), elements: recalced })
        onTrackSaved?.()
      } catch (err) {
        console.error('Verm.ESN import error:', err)
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  // ── Gleislage CSV ────────────────────────────────────────────────────────
  // Parsing the export (tens of MB) yields the available line numbers; the
  // chosen one is then turned into tracks.
  const handleCsvFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !project) return
    setCsvErrors([]); setCsvBusy(true); setCsvStrecken([])
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const rows = parseGleislageCsv(ev.target.result)
        csvRowsRef.current = rows
        const list = listStrecken(rows)
        setCsvStrecken(list)
        setCsvStrecke(list.some(s => s.strecke === csvStrecke) ? csvStrecke : (list[0]?.strecke ?? ''))
      } catch (err) {
        csvRowsRef.current = null
        setCsvErrors([`Parse-Fehler: ${err.message}`])
      } finally {
        setCsvBusy(false)
      }
    }
    reader.readAsText(file)
  }

  const handleCantFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCsvErrors([]); setCsvBusy(true)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        cantRowsRef.current = parseUeberhoehungCsv(ev.target.result)
        setCantCount(cantRowsRef.current.length)
      } catch (err) {
        cantRowsRef.current = null
        setCantCount(0)
        setCsvErrors([`Überhöhung – Parse-Fehler: ${err.message}`])
      } finally {
        setCsvBusy(false)
      }
    }
    reader.readAsText(file)
  }

  const handleCsvImport = () => {
    if (!csvRowsRef.current || !csvStrecke || !project) return
    const { tracks: parsed, errors } = buildTracksFromCsv(
      csvRowsRef.current, csvStrecke, cantRowsRef.current,
      { sourceEpsg: Number(csvSourceEpsg), targetEpsg: Number(csvTargetEpsg) })
    setCsvErrors(errors)
    if (!parsed.length) return
    const names = new Set(loadTracks(project.id).map(tr => tr.name).filter(Boolean))
    parsed.forEach(tr => {
      const elements = recalcAbsLengths(tr.elements)
      const name = names.has(tr.name) ? nextTrackName(tr.name.split('.')[0], names) : tr.name
      names.add(name)
      saveTrack(project.id, {
        ...tr, id: generateId(), name, elements, coordinates: rebuildCoords(elements),
      })
    })
    onTrackSaved?.()
  }

  // ── MDB (Access) ─────────────────────────────────────────────────────────
  // The browser cannot read an Access file, so it goes to the server, is
  // converted there and deleted again (ROADMAP decision 11). Everything after
  // that happens here, on the Satzarten the converter hands back.
  const readMdbFile = ({ ref, setErrors, setBusy, setStrecken, setStrecke, setCounts }) => async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !project) return
    setErrors([]); setBusy(true); setStrecken([]); setCounts(null)
    try {
      const payload = parseMdbPayload(await convertMdbOnServer(file))
      ref.current = payload
      setCounts(payload.elements.length ? {
        elements: payload.elements.length,
        tracks: payload.tracks.length,
        nodes: payload.nodes.length,
      } : null)
      const list = listMdbStrecken(payload)
      setStrecken(list)
      setStrecke(ALL_STRECKEN)
      if (!list.length) setErrors([t('data_exchange_mdb_err_empty')])
    } catch (err) {
      ref.current = null
      const code = err instanceof OptimizerError ? err.code : 'internal'
      setErrors([t(`data_exchange_mdb_err_${code}`) ?? code, ...(err?.detail ? [err.detail] : [])])
    } finally {
      setBusy(false)
    }
  }

  const handleMdbFile = readMdbFile({
    ref: mdbPayloadRef, setErrors: setMdbErrors, setBusy: setMdbBusy,
    setStrecken: setMdbStrecken, setStrecke: setMdbStrecke, setCounts: setMdbCounts,
  })

  const handleDbrefFile = readMdbFile({
    ref: dbrefPayloadRef, setErrors: setDbrefErrors, setBusy: setDbrefBusy,
    setStrecken: setDbrefStrecken, setStrecke: setDbrefStrecke, setCounts: setDbrefCounts,
  })

  /**
   * Every track into one plane, with the regional grids that cover them loaded
   * first. Each element is refitted to its own two transformed nodes, so the
   * nodes stay exactly where the transformation puts them and the lengths and
   * radii follow (planeTransform). What that cost is reported: how far the
   * plane stretched, and how far a joint's tangent opened beyond what it
   * already was.
   */
  const toPlane = async (tracks, target, notes) => {
    const box = tracks.reduce((b, tr) => {
      const cs = tr.coordinates ?? []
      for (const c of [cs[0], cs[cs.length - 1]]) {
        if (!c) continue
        b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1])
        b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1])
      }
      return b
    }, [180, 90, -180, -90])

    // The area alone does not say which grid is worth loading: Hesse's is a
    // DHDN refinement and does a PD/83 chain in the same rectangle no good.
    const datums = [...new Set(tracks.map(tr => crsDatum(tr.epsg)).filter(Boolean))]
    const grids = await loadGridsFor(box, datums)
    notes.push(t(grids.length ? 'data_exchange_mdb_grids' : 'data_exchange_mdb_grid_none')
      .replace('{{names}}', grids.map(g => g.name).join(', ')))

    let moved = 0, gap = 0, lo = Infinity, hi = -Infinity
    const out = tracks.map(tr => {
      if (Number(tr.epsg) === target) return tr
      const res = transformTrackToPlane(tr, target)
      if (!res) return tr
      moved += 1
      gap = Math.max(gap, res.tangentGap)
      lo = Math.min(lo, res.scale.min); hi = Math.max(hi, res.scale.max)
      return res.track
    })
    if (moved) {
      notes.push(t('data_exchange_mdb_moved')
        .replace('{{n}}', moved)
        .replace('{{crs}}', crsLabel(target))
        .replace('{{mm}}', (Math.max(Math.abs(lo - 1), Math.abs(hi - 1)) * 1000).toFixed(2))
        .replace('{{deg}}', gap.toExponential(1)))
    }
    return out
  }

  const runMdbImport = async ({ payload, strecke, withSwitches, target, setErrors, setBusy }) => {
    if (!payload || !strecke || !project) return
    setBusy(true)
    // The whole file at once is the common case — a Betriebsstelle's switches
    // rarely sit on one line number, so picking a single one splits them up.
    const built = strecke === ALL_STRECKEN
      ? buildAllTracksFromMdb(payload)
      : buildTracksFromMdb(payload, strecke)
    const inventory = mdbSwitchInventory(payload)

    // Switches part the tracks they sit on, so this has to happen before
    // anything is saved: what comes back are the tracks as they are afterwards,
    // and records carrying their symbol — the same shape a switch dialog
    // commits, so an imported switch is stored and drawn like a built one.
    const placed = withSwitches
      ? placeMdbSwitches(payload, built.tracks, inventory.units, {
        newId: generateId, existingSwitches: loadSwitches(project.id),
      })
      : { tracks: built.tracks, switches: [], errors: [] }

    const notes = [...built.errors, ...inventory.errors, ...placed.errors]
    if (!placed.tracks.length) { setErrors(notes); setBusy(false); return }

    const names = new Set(loadTracks(project.id).map(tr => tr.name).filter(Boolean))
    const addTracks = placed.tracks.map(tr => {
      const elements = recalcAbsLengths(tr.elements)
      const name = !tr.name || names.has(tr.name)
        ? nextTrackName((tr.name ?? 'mdb').split('.')[0], names)
        : tr.name
      names.add(name)
      return { ...tr, id: tr.id ?? generateId(), name, elements, coordinates: rebuildCoords(elements) }
    })

    // Into one plane, for the importer that was asked for that. The survey
    // states its alignment in the Landessystem and the railway works in
    // DB_REF, and a track carries one plane — so the chains come in as many
    // planes as the file uses and stay cut at every boundary between them.
    // Carried over, they are one network in one plane, and what is written is
    // DB_REF coordinates: the Landessystem is gone from the project, not
    // converted again for every draw.
    //
    // The grids come first and only then: a finer regional grid is worth its
    // 80 MB for the one conversion an import is, and which one is worth
    // loading cannot be known before the data says where it lies.
    if (target) {
      const moved = await toPlane(addTracks, target, notes)
      addTracks.length = 0
      addTracks.push(...moved)
    }

    // The chains the import builds are cut wherever the Lagesystem changes, and
    // those cuts are joints, not ends — so they are linked here rather than
    // left for someone to find. It runs over the project as it will be, tracks
    // and switches together: a switch port claims an end, and what a turnout
    // already holds is not an open joint. Last, because the ids are handed out
    // above and a port names a track by its id.
    const afterTracks   = [...loadTracks(project.id), ...addTracks]
    const afterSwitches = [...loadSwitches(project.id), ...placed.switches]
    const { links, joints, fanned } = linkAllJoints(afterTracks, afterSwitches,
      afterSwitches.map(sw => sw.name).filter(Boolean))
    if (links.length) {
      notes.push(t('data_exchange_mdb_links')
        .replace('{{n}}', links.length)
        .replace('{{crs}}', joints.filter(j => j.crsChange).length))
    }
    if (fanned) notes.push(t('data_exchange_mdb_fanned').replace('{{n}}', fanned))

    setErrors(notes)
    // One commit, one undo step — a whole database is thousands of tracks, and
    // saving them one at a time would leave as many steps behind.
    commitSwitchConnection(project.id, {
      removeTrackIds: [], addTracks, addSwitches: [...placed.switches, ...links], remap: [],
    })
    setBusy(false)
    onTrackSaved?.()
  }

  /**
   * The plain import: every chain keeps the plane it was surveyed in. What is
   * stored are the file's own coordinates, and the conversion to WGS84 happens
   * for the map alone.
   */
  const handleMdbImport = () => runMdbImport({
    payload: mdbPayloadRef.current, strecke: mdbStrecke, withSwitches: mdbSwitches,
    target: null, setErrors: setMdbErrors, setBusy: setMdbBusy,
  })

  /** The one that writes DB_REF, and writes it for good (planeTransform). */
  const handleDbrefImport = () => runMdbImport({
    payload: dbrefPayloadRef.current, strecke: dbrefStrecke, withSwitches: dbrefSwitches,
    target: Number(dbrefTarget), setErrors: setDbrefErrors, setBusy: setDbrefBusy,
  })

  // Exchange-file import — the geometry comes from horizontal_alignment, the
  // heights from vertical_alignment (see osrdImport); tracks already present
  // get a fresh id rather than silently replacing what is there.
  const handleOsrdImport = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !project) return
    setOsrdErrors([])
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const { tracks: parsed, errors, infra, switches } = parseOsrdRailJson(JSON.parse(ev.target.result))
        setOsrdErrors(errors)
        if (!parsed.length) return
        const existingIds = new Set(loadTracks(project.id).map(tr => tr.id))
        const existingNames = new Set(loadTracks(project.id).map(tr => tr.name).filter(Boolean))
        const idMap = {}
        const imported = []
        parsed.forEach(tr => {
          const elements = recalcAbsLengths(tr.elements)
          const name = tr.name && !existingNames.has(tr.name)
            ? tr.name
            : nextTrackName(tr.name?.split('.')[0] || 'track', existingNames)
          existingNames.add(name)
          const id = existingIds.has(tr.id) ? generateId() : (tr.id ?? generateId())
          if (tr.id && id !== tr.id) idMap[tr.id] = id
          const track = { ...tr, id, name, elements, coordinates: rebuildCoords(elements) }
          saveTrack(project.id, track)
          imported.push(track)
        })
        // Switches the import could rebuild into the app's own model — they
        // are drawn as switch bodies (fill, LCS mark, branch geometry) and
        // regenerated on the next export, which is why the passthrough copy
        // below is dropped there by id.
        const remapId = (id) => idMap[id] ?? id
        switches.forEach(sw => saveSwitch(project.id, {
          ...sw,
          portA_trackId:  sw.portA_trackId  ? remapId(sw.portA_trackId)  : sw.portA_trackId,
          portB1_trackId: sw.portB1_trackId ? remapId(sw.portB1_trackId) : sw.portB1_trackId,
          portB2_trackId: sw.portB2_trackId ? remapId(sw.portB2_trackId) : sw.portB2_trackId,
        }))

        // Keep everything the app does not model, so an export hands it back.
        // Ports of carried-over switches follow tracks that had to be re-id'd.
        const remapPorts = (sw) => ({
          ...sw,
          ports: Object.fromEntries(Object.entries(sw.ports ?? {}).map(([k, p]) =>
            [k, idMap[p?.track] ? { ...p, track: idMap[p.track] } : p])),
        })
        updateProject(project.id, {
          osrd: { ...infra, ...(infra.switches ? { switches: infra.switches.map(remapPorts) } : {}) },
        })
        onTrackSaved?.()
        // The import usually lands far outside the current view — show it.
        fitToTracks(map?.current, imported)
      } catch (err) {
        setOsrdErrors([`Parse-Fehler: ${err.message}`])
      }
    }
    reader.readAsText(file)
  }

  useEffect(() => () => clearTimeout(osrdLinkTimer.current), [])

  const handleOsrdExport = () => {
    if (!project) return
    downloadJSON(exportToOsrd(project.id), `${project.title}_osrd.json`)
    clearTimeout(osrdLinkTimer.current)
    setOsrdExported(true)
    osrdLinkTimer.current = setTimeout(() => setOsrdExported(false), OSRD_LINK_TIMEOUT)
  }

  const handleExchangeExport = () => {
    if (!project) return
    downloadJSON(exportExchange(project.id), `${project.title}_trassierung.json`)
  }

  const selectedTracks = tracks.filter(tr => selectedIds.has(tr.id))

  if (trackConflicts.length > 0) {
    const { existing } = trackConflicts[0]
    const msg = t('import_track_conflict_message').replace('{{name}}', trackLabel(existing))
    return (
      <div className="modal-overlay">
        <div className="modal" onClick={e => e.stopPropagation()}>
          <p className="modal-message">{msg}</p>
          <div className="modal-actions">
            <button className="modal-btn modal-btn-cancel" onClick={() => resolveTrackConflict(false)}>
              {t('import_keep_existing')}
            </button>
            <button className="modal-btn modal-btn-confirm" onClick={() => resolveTrackConflict(true)}>
              {t('import_keep_imported')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (conflicts.length > 0) {
    const { existing } = conflicts[0]
    const msg = t('import_conflict_message').replace('{{title}}', existing.title ?? existing.id)
    return (
      <div className="modal-overlay">
        <div className="modal" onClick={e => e.stopPropagation()}>
          <p className="modal-message">{msg}</p>
          <div className="modal-actions">
            <button className="modal-btn modal-btn-cancel" onClick={() => resolveConflict(false)}>
              {t('import_keep_existing')}
            </button>
            <button className="modal-btn modal-btn-confirm" onClick={() => resolveConflict(true)}>
              {t('import_keep_imported')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <h2>{t('data_exchange')}</h2>

      <ExchangeSection
        title={t('data_exchange_project')}
        description={before + trackCount + after}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleProjectImport}
          />
          <button className="panel-btn panel-btn-full" style={{ flex: 1 }} onClick={() => importInputRef.current?.click()}>
            {t('data_exchange_import')}
          </button>
          <button className="panel-btn panel-btn-full" style={{ flex: 1 }} onClick={handleProjectExport}>
            {t('data_exchange_export')}
          </button>
        </div>
        {importError && (
          <p style={{ margin: '6px 0 0', fontSize: 11, color: '#e74c3c', fontFamily: 'system-ui, sans-serif' }}>
            {importError}
          </p>
        )}
      </ExchangeSection>

      <ExchangeSection title={t('data_exchange_tracks')}>
        <input
          ref={trackImportRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleTracksImport}
        />
        <button className="panel-btn panel-btn-full" disabled={!project} onClick={() => trackImportRef.current?.click()}>
          {t('data_exchange_import')}
        </button>
        <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '6px 0' }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="panel-btn panel-btn-full"
            style={{ flex: 1, background: phase === 'selecting' ? 'var(--color-primary)' : undefined }}
            onClick={() => setPhase(p => p === 'selecting' ? 'idle' : 'selecting')}
          >
            {t('data_exchange_select')}
          </button>
          <button
            className="panel-btn panel-btn-full"
            style={{ flex: 1, opacity: selectedIds.size ? 1 : 0.4 }}
            onClick={handleTracksExport}
            disabled={!selectedIds.size}
          >
            {t('data_exchange_export')}
          </button>
        </div>
        {selectedTracks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
            {selectedTracks.map(tr => (
              <div
                key={tr.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '3px 8px', borderRadius: 4, background: '#e8e8f4',
                  fontSize: 12, fontFamily: 'system-ui, sans-serif', color: 'var(--color-primary)',
                }}
              >
                <span>{trackLabel(tr)}</span>
                <span
                  style={{ cursor: 'pointer', marginLeft: 6, color: '#999', fontWeight: 700 }}
                  onClick={() => setSelectedIds(prev => { const n = new Set(prev); n.delete(tr.id); return n })}
                >
                  ×
                </span>
              </div>
            ))}
          </div>
        )}
      </ExchangeSection>

      <ExchangeSection title={t('data_exchange_vermesn')}>
        <div className="form-field">
          <label>{t('data_exchange_vermesn_crs')}</label>
          <select className="settings-select" value={epsg} onChange={e => setEpsg(e.target.value)}>
            {EPSG_OPTIONS.map(o => (
              <option key={o.code} value={o.code}>EPSG {o.code} – {o.label}</option>
            ))}
          </select>
        </div>
        <input
          ref={esnInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleEsnImport}
        />
        <button
          className="panel-btn panel-btn-full"
          disabled={!project}
          onClick={() => { setEsnErrors([]); esnInputRef.current?.click() }}
        >
          {t('data_exchange_import')}
        </button>
        {esnErrors.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {esnErrors.map((err, i) => (
              <p key={i} style={{ margin: '2px 0', fontSize: 11, color: '#e74c3c', fontFamily: 'system-ui, sans-serif' }}>
                {err}
              </p>
            ))}
          </div>
        )}
      </ExchangeSection>

      <ExchangeSection
        title={t('data_exchange_osrd')}
        description={t('data_exchange_osrd_desc')}
      >
        <a
          href={OSRD_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            color: 'var(--color-primary)', fontFamily: 'system-ui, sans-serif', fontSize: 13,
            fontWeight: 500, textDecoration: 'none',
          }}
        >
          {t('data_exchange_osrd_open')}
          <ExternalLinkIcon color="var(--color-primary)" />
        </a>
        <input ref={osrdInputRef} type="file" accept=".json,application/json"
          style={{ display: 'none' }} onChange={handleOsrdImport} />
        {/* While the export is fresh the section shows the way on to OSRD in
            place of its own two buttons: that is the only thing there is to do
            with the file that just landed. */}
        {osrdExported ? (
          <a
            className="panel-btn panel-btn-full"
            href={OSRD_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 5, textDecoration: 'none', boxSizing: 'border-box',
            }}
          >
            {t('data_exchange_osrd_continue')}
            <ExternalLinkIcon color="currentColor" />
          </a>
        ) : (
          <>
            <button className="panel-btn panel-btn-full" onClick={handleOsrdExport}>
              {t('data_exchange_export')}
            </button>
            <button className="panel-btn panel-btn-full" style={{ marginTop: 2 }}
              onClick={() => osrdInputRef.current?.click()}>
              {t('data_exchange_import')}
            </button>
          </>
        )}
        {osrdErrors.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {osrdErrors.map((msg, i) => (
              <div key={i} style={{ color: '#e74c3c', fontSize: 12, fontFamily: 'system-ui, sans-serif' }}>
                {msg}
              </div>
            ))}
          </div>
        )}
      </ExchangeSection>

      {/* Behind the dot at the bottom: the imports and exports that are needed
          now and then rather than every session — the Gleislage CSV and the
          alignment exchange format (the same tracks as the OSRD export, but
          with the design data itself: element chain and heights). */}
      {exchangeOpen && (
        <>
          <ExchangeSection title={t('data_exchange_csv')} description={t('data_exchange_csv_desc')}>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={handleCsvFile}
            />
            <button
              className="panel-btn panel-btn-full"
              disabled={!project || csvBusy}
              onClick={() => csvInputRef.current?.click()}
            >
              {csvBusy ? t('data_exchange_csv_reading') : t('data_exchange_csv_choose')}
            </button>
            {csvStrecken.length > 0 && (
              <>
                <input
                  ref={cantInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={handleCantFile}
                />
                <button
                  className="panel-btn panel-btn-full"
                  style={{ marginTop: 2 }}
                  disabled={csvBusy}
                  onClick={() => cantInputRef.current?.click()}
                >
                  {cantCount
                    ? t('data_exchange_csv_cant_loaded').replace('{{n}}', cantCount)
                    : t('data_exchange_csv_cant')}
                </button>
                <div className="form-field" style={{ marginTop: 6 }}>
                  <label>{t('data_exchange_csv_source_crs')}</label>
                  <select className="settings-select" value={csvSourceEpsg}
                    onChange={e => setCsvSourceEpsg(e.target.value)}>
                    {EPSG_OPTIONS.map(o => (
                      <option key={o.code} value={o.code}>EPSG {o.code} – {o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>{t('data_exchange_csv_target_crs')}</label>
                  <select className="settings-select" value={csvTargetEpsg}
                    onChange={e => setCsvTargetEpsg(e.target.value)}>
                    {EPSG_OPTIONS.map(o => (
                      <option key={o.code} value={o.code}>EPSG {o.code} – {o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>{t('data_exchange_csv_line')}</label>
                  <select className="settings-select" value={csvStrecke}
                    onChange={e => setCsvStrecke(e.target.value)}>
                    {csvStrecken.map(s => (
                      <option key={s.strecke} value={s.strecke}>{s.strecke} ({s.count})</option>
                    ))}
                  </select>
                </div>
                <button className="panel-btn panel-btn-full" style={{ marginTop: 2 }}
                  disabled={!csvStrecke} onClick={handleCsvImport}>
                  {t('data_exchange_import')}
                </button>
              </>
            )}
            {csvErrors.length > 0 && (
              <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto' }}>
                {csvErrors.map((err, i) => (
                  <p key={i} style={{ margin: '2px 0', fontSize: 11, color: '#e74c3c', fontFamily: 'system-ui, sans-serif' }}>
                    {err}
                  </p>
                ))}
              </div>
            )}
          </ExchangeSection>
          <ExchangeSection title={t('data_exchange_mdb')} description={t('data_exchange_mdb_desc')}>
            <input
              ref={mdbInputRef}
              type="file"
              accept=".mdb,.MDB,application/x-msaccess"
              style={{ display: 'none' }}
              onChange={handleMdbFile}
            />
            <button
              className="panel-btn panel-btn-full"
              disabled={!project || mdbBusy}
              onClick={() => mdbInputRef.current?.click()}
            >
              {mdbBusy ? t('data_exchange_mdb_reading') : t('data_exchange_mdb_choose')}
            </button>
            {mdbCounts && (
              <p className="selecting-hint">
                {t('data_exchange_mdb_counts')
                  .replace('{{elements}}', mdbCounts.elements)
                  .replace('{{tracks}}', mdbCounts.tracks)
                  .replace('{{nodes}}', mdbCounts.nodes)}
              </p>
            )}
            {mdbStrecken.length > 0 && (
              <>
                <div className="form-field" style={{ marginTop: 6 }}>
                  <label>{t('data_exchange_csv_line')}</label>
                  <select className="settings-select" value={mdbStrecke}
                    onChange={e => setMdbStrecke(e.target.value)}>
                    <option value={ALL_STRECKEN}>
                      {t('data_exchange_mdb_all').replace('{{n}}', mdbStrecken.length)}
                    </option>
                    {mdbStrecken.map(x => (
                      <option key={x.strecke} value={x.strecke}>{x.strecke} ({x.count})</option>
                    ))}
                  </select>
                </div>
                <label className="transition-curve-row">
                  <input type="checkbox" checked={mdbSwitches}
                    onChange={e => setMdbSwitches(e.target.checked)} />
                  {t('data_exchange_mdb_switches')}
                </label>
                <button className="panel-btn panel-btn-full" style={{ marginTop: 2 }}
                  disabled={!mdbStrecke} onClick={handleMdbImport}>
                  {t('data_exchange_import')}
                </button>
              </>
            )}
            {mdbErrors.length > 0 && (
              <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto' }}>
                {mdbErrors.map((err, i) => (
                  <p key={i} style={{ margin: '2px 0', fontSize: 11, color: '#e74c3c', fontFamily: 'system-ui, sans-serif' }}>
                    {err}
                  </p>
                ))}
              </div>
            )}
          </ExchangeSection>
          <ExchangeSection
            title={t('data_exchange_dbref')}
            description={t('data_exchange_dbref_desc')}
          >
            <input ref={dbrefInputRef} type="file" accept=".mdb,.accdb,application/x-msaccess"
              style={{ display: 'none' }} onChange={handleDbrefFile} />
            <button className="panel-btn panel-btn-full" disabled={!project || dbrefBusy}
              onClick={() => dbrefInputRef.current?.click()}
            >
              {dbrefBusy ? t('data_exchange_mdb_reading') : t('data_exchange_mdb_choose')}
            </button>
            {dbrefCounts && (
              <p className="selecting-hint">
                {t('data_exchange_mdb_counts')
                  .replace('{{elements}}', dbrefCounts.elements)
                  .replace('{{tracks}}', dbrefCounts.tracks)
                  .replace('{{nodes}}', dbrefCounts.nodes)}
              </p>
            )}
            {dbrefStrecken.length > 0 && (
              <>
                <div className="form-field" style={{ marginTop: 6 }}>
                  <label>{t('data_exchange_csv_line')}</label>
                  <select className="settings-select" value={dbrefStrecke}
                    onChange={e => setDbrefStrecke(e.target.value)}>
                    <option value={ALL_STRECKEN}>
                      {t('data_exchange_mdb_all').replace('{{n}}', dbrefStrecken.length)}
                    </option>
                    {dbrefStrecken.map(x => (
                      <option key={x.strecke} value={x.strecke}>{x.strecke} ({x.count})</option>
                    ))}
                  </select>
                </div>
                <div className="form-field" style={{ marginTop: 6 }}>
                  <label>{t('data_exchange_dbref_target')}</label>
                  <select className="settings-select" value={dbrefTarget}
                    onChange={e => setDbrefTarget(e.target.value)}>
                    {EPSG_OPTIONS.filter(o => o.code >= 5681 && o.code <= 5685).map(o => (
                      <option key={o.code} value={o.code}>{o.code} – {o.label}</option>
                    ))}
                  </select>
                </div>
                <label className="transition-curve-row">
                  <input type="checkbox" checked={dbrefSwitches}
                    onChange={e => setDbrefSwitches(e.target.checked)} />
                  {t('data_exchange_mdb_switches')}
                </label>
                <button className="panel-btn panel-btn-full" style={{ marginTop: 2 }}
                  disabled={!dbrefStrecke || dbrefBusy} onClick={handleDbrefImport}>
                  {t('data_exchange_import')}
                </button>
              </>
            )}
            {dbrefErrors.length > 0 && (
              <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto' }}>
                {dbrefErrors.map((err, i) => (
                  <p key={i} style={{ margin: '2px 0', fontSize: 11, color: '#e74c3c', fontFamily: 'system-ui, sans-serif' }}>
                    {err}
                  </p>
                ))}
              </div>
            )}
          </ExchangeSection>
          <ExchangeSection
            title={t('data_exchange_alignment')}
            description={t('data_exchange_alignment_desc').replace('{{version}}', FORMAT_VERSION)}
          >
            <button className="panel-btn panel-btn-full" disabled={!project} onClick={handleExchangeExport}>
              {t('data_exchange_export')}
            </button>
            <input ref={exchangeInputRef} type="file" accept=".json,application/json"
              style={{ display: 'none' }} onChange={handleOsrdImport} />
            <button className="panel-btn panel-btn-full" style={{ marginTop: 2 }}
              disabled={!project} onClick={() => exchangeInputRef.current?.click()}>
              {t('data_exchange_import')}
            </button>
          </ExchangeSection>
        </>
      )}
      <div className="panel-dot-row">
        <button
          className={`panel-dot${exchangeOpen ? ' active' : ''}`}
          title={t('data_exchange_more')}
          aria-label={t('data_exchange_more')}
          aria-expanded={exchangeOpen}
          onClick={() => setExchangeOpen(o => !o)}
        />
      </div>
    </>
  )
}
