import { useState, useEffect, useRef } from 'react'
import { loadTracks, loadProjects, importProjects, exportProjectsPayload, saveTrack, saveSwitch, updateTrack, updateProject, generateId, recalcAbsLengths, rebuildCoords, nextTrackName } from '../../storage'
import { parseProjectsPayload, PayloadError } from '../../utils/persistenceUtils'
import { parseRecords, buildElements } from '../../utils/vermEsnImport'
import { reconstructElements } from '../../utils/elementReconstruct'
import { ExternalLinkIcon } from '../icons'
import { exportToOsrd, OSRD_URL } from '../../utils/osrdExport'
import { exportExchange, FORMAT_VERSION } from '../../utils/exchangeExport'
import { parseOsrdRailJson } from '../../utils/osrdImport'
import { fitToTracks } from '../../utils/mapRenderUtils'
import { downloadJSON } from '../../utils/fileUtils'
import { EPSG_OPTIONS } from '../../utils/coordinateUtils'
import useTrackHover from '../../hooks/useTrackHover'
import { FILTER_NONE, HIT_TOLERANCE, mapIsLive } from '../../utils/mapConstants'
import { parseGleislageCsv, parseUeberhoehungCsv, listStrecken, buildTracksFromCsv, CSV_EPSG } from '../../utils/gleislageCsvImport'
import { listServerProjects, fetchServerProject, uploadServerProject, deleteServerProject, ServerError } from '../../utils/serverStorage'
import ConfirmModal from '../ConfirmModal'

/**
 * How long the way to OSRD stays offered after an export [ms]. The file is in
 * the downloads folder at that point and the next step is to load it into OSRD,
 * so the link is put where the eye already is instead of at the top of the
 * section — but only for as long as that export is what the user is thinking
 * about.
 */
const OSRD_LINK_TIMEOUT = 30000

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
  const osrdInputRef                    = useRef(null)
  const [osrdErrors, setOsrdErrors]     = useState([])
  const [osrdExported, setOsrdExported] = useState(false)
  const osrdLinkTimer                   = useRef(null)
  const exchangeInputRef                = useRef(null)
  const [exchangeOpen, setExchangeOpen] = useState(false)
  const [serverProjects, setServerProjects] = useState(null)   // null → not fetched yet
  const [serverDown, setServerDown]         = useState(false)
  const [serverPassword, setServerPassword] = useState('')
  const [serverBusy, setServerBusy]         = useState(false)
  const [serverStatus, setServerStatus]     = useState(null)   // { error: bool, text }
  const [importError, setImportError]       = useState(null)   // why a project file was refused
  const [serverDelete, setServerDelete]     = useState(null)   // entry awaiting confirmation

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

  // The server client and the payload check both carry a `code`, so one lookup
  // names either. An error without one says as much as the caller knows: a
  // request that threw was the server being unreachable, a file that threw was
  // the file. Codes with no text of their own fall back to the generic one.
  const codedErrorText = (err, fallback = 'unavailable') => {
    const code = (err instanceof ServerError || err instanceof PayloadError) ? err.code : fallback
    const key  = `data_exchange_server_err_${code}`
    const text = t(key)
    return text === key ? t('data_exchange_server_err_unavailable') : text
  }

  // Take imported projects into the store — from a file or from the server.
  // Ids that are already here are asked about one by one; nothing is written
  // until every conflict is answered.
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

  // ── Server store ───────────────────────────────────────────────────────────
  // What lies on the server is public: everyone may list and import, only the
  // shared password puts something there or takes it away. The list is read
  // once when the panel opens and re-read after every write.

  useEffect(() => {
    if (!exchangeOpen || serverProjects !== null) return   // opened once is enough
    let cancelled = false
    listServerProjects()
      .then(list => { if (!cancelled) { setServerProjects(list); setServerDown(false) } })
      .catch(() => { if (!cancelled) { setServerProjects([]); setServerDown(true) } })
    return () => { cancelled = true }
  }, [exchangeOpen, serverProjects])

  const reloadServerList = async () => {
    try {
      setServerProjects(await listServerProjects())
      setServerDown(false)
    } catch {
      setServerDown(true)
    }
  }

  // Only the open project goes up, and only ever as itself — the plain export
  // button writes the whole local store into one file, which is not something
  // to put on a server everyone can read.
  const handleServerUpload = async () => {
    if (!project || !serverPassword || serverBusy) return
    setServerBusy(true)
    setServerStatus(null)
    try {
      await uploadServerProject(project.id, exportProjectsPayload(new Set([project.id])), serverPassword)
      await reloadServerList()
      setServerStatus({ error: false, text: t('data_exchange_server_uploaded').replace('{{title}}', project.title ?? '') })
    } catch (err) {
      setServerStatus({ error: true, text: codedErrorText(err) })
    } finally {
      setServerBusy(false)
    }
  }

  const handleServerImport = async (entry) => {
    if (serverBusy) return
    setServerBusy(true)
    setServerStatus(null)
    try {
      ingestProjects(parseProjectsPayload(await fetchServerProject(entry.id)).projects)
    } catch (err) {
      setServerStatus({ error: true, text: codedErrorText(err) })
    } finally {
      setServerBusy(false)
    }
  }

  const handleServerDelete = async () => {
    const entry = serverDelete
    setServerDelete(null)
    if (!entry || !serverPassword) return
    setServerBusy(true)
    setServerStatus(null)
    try {
      await deleteServerProject(entry.id, serverPassword)
      await reloadServerList()
    } catch (err) {
      setServerStatus({ error: true, text: codedErrorText(err) })
    } finally {
      setServerBusy(false)
    }
  }

  const serverEntryMeta = (entry) => {
    const tracks = t('data_exchange_server_tracks').replace('{{n}}', entry.tracks ?? 0)
    const date = entry.updated ? new Date(entry.updated * 1000).toLocaleDateString() : ''
    return [tracks, date].filter(Boolean).join(' · ')
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
          now and then rather than every session — putting the project on the
          server, the Gleislage CSV, and the alignment exchange format (the
          same tracks as the OSRD export, but with the design data itself:
          element chain and heights). */}
      {exchangeOpen && (
        <>
          <ExchangeSection
            title={t('data_exchange_server')}
            description={t('data_exchange_server_desc')}
          >
            {serverProjects === null ? (
              <p className="server-note">{t('data_exchange_server_loading')}</p>
            ) : serverDown ? (
              <p className="server-note">{t('data_exchange_server_offline')}</p>
            ) : serverProjects.length === 0 ? (
              <p className="server-note">{t('data_exchange_server_empty')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {serverProjects.map(entry => (
                  <div key={entry.id} className="server-row">
                    <span className="server-row-title" title={entry.title || entry.id}>
                      {entry.title || entry.id}
                    </span>
                    <span className="server-row-meta">{serverEntryMeta(entry)}</span>
                    <button
                      className="panel-btn server-row-btn"
                      disabled={serverBusy}
                      onClick={() => handleServerImport(entry)}
                    >
                      {t('data_exchange_import')}
                    </button>
                    {serverPassword && (
                      <span
                        className="server-row-delete"
                        title={t('data_exchange_server_delete')}
                        onClick={() => setServerDelete(entry)}
                      >
                        ×
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="form-field" style={{ marginTop: 6 }}>
              <label>{t('data_exchange_server_password')}</label>
              <input
                type="password"
                autoComplete="current-password"
                value={serverPassword}
                onChange={e => { setServerPassword(e.target.value); setServerStatus(null) }}
              />
            </div>
            <button
              className="panel-btn panel-btn-full"
              style={{ marginTop: 2 }}
              disabled={!project || !serverPassword || serverBusy}
              onClick={handleServerUpload}
            >
              {t('data_exchange_server_upload')}
            </button>
            {serverStatus && (
              <p className={`server-note${serverStatus.error ? ' server-note-error' : ' server-note-ok'}`}>
                {serverStatus.text}
              </p>
            )}
          </ExchangeSection>

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
      {serverDelete && (
        <ConfirmModal
          t={t}
          message={t('data_exchange_server_delete_confirm').replace('{{title}}', serverDelete.title || serverDelete.id)}
          onCancel={() => setServerDelete(null)}
          onConfirm={handleServerDelete}
        />
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
