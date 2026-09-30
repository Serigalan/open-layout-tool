import { useRef, useState } from 'react'
import {
  loadTracks, loadSwitches, generateId, recalcAbsLengths, rebuildCoords, nextTrackName,
  commitSwitchConnection,
} from '../../storage'
import {
  readProviArchive, listProviAxes, buildProviTracks, proviPlaceableUnits, proviHeights,
  proviSwitchCandidates, proviProject, PROVI_FRAMES,
} from '../../utils/proviImport'
import { placeMdbSwitches } from '../../utils/mdbSwitchPlacement'
import { linkAllJoints } from '../../utils/trackLinkUtils'
import { fitToTracks } from '../../utils/mapRenderUtils'

const noteStyle = { margin: '2px 0', fontSize: 11, color: '#e74c3c', fontFamily: 'system-ui, sans-serif' }

/**
 * The ProVI import: a zip archive of axes, each becoming one track with its
 * cant, its gradient and the switches it states (proviImport). The axes are
 * listed first and picked — an archive holds variants of a track lying on top
 * of each other, and which of them belong in the project is the user's call.
 *
 * `onReport(source, counts, lines)` keeps the run's report with the project's
 * other import reports.
 */
export default function ProviImportSection({ t, map, project, onReport, onTrackSaved }) {
  const inputRef = useRef(null)
  const filesRef = useRef(null)   // the unpacked archive, kept out of state
  const [fileName, setFileName] = useState('')
  const [axes, setAxes] = useState(null)
  const [chosen, setChosen] = useState(new Set())
  const [frame, setFrame] = useState('R')
  const [busy, setBusy] = useState(null)   // null, 'reading' or 'importing'
  const [notes, setNotes] = useState([])

  // The placement reports why a switch could not be set by a locale key; the
  // report is plain text, so the key is spelled out — without the figure some
  // of them name, which the placement does not pass on.
  const readable = (line) => line.replace(/\bswitch_on_track_\w+\b/g, (key) => {
    const text = t(key)
    return text.includes('{{') ? text.split(/ – |: /)[0] : text
  })

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy('reading')
    setNotes([])
    try {
      const files = readProviArchive(await file.arrayBuffer())
      const list = listProviAxes(files)
      filesRef.current = files
      setFileName(file.name)
      setAxes(list)
      setChosen(new Set(list.map(a => a.name)))
      if (!list.length) setNotes([t('data_exchange_provi_none')])
    } catch (err) {
      filesRef.current = null
      setAxes(null)
      setNotes([`${file.name}: ${err.message}`])
    }
    setBusy(null)
  }

  const toggle = (name) => setChosen((prev) => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  const runImport = () => {
    const files = filesRef.current
    if (!files || !project || !chosen.size) return
    setBusy('importing')
    // The work is synchronous and takes seconds for a whole archive: the busy
    // label is drawn first.
    setTimeout(() => {
      try {
        const names = axes.map(a => a.name).filter(n => chosen.has(n))
        const built = buildProviTracks(files, names, { fallbackFrame: frame })
        const placeable = proviPlaceableUnits(built.units, built.axes)
        const placed = placeMdbSwitches({ points: [] }, built.tracks, placeable.units, {
          newId: generateId, existingSwitches: loadSwitches(project.id),
          tracksFor: proviSwitchCandidates, project: proviProject,
        })
        // Heights last: the switches have cut the tracks, and each piece takes
        // the stretch of its axis's gradient it covers.
        const withHeights = proviHeights(placed.tracks, built.axes)
        const lines = [...built.errors, ...placeable.errors, ...placed.errors, ...withHeights.errors]

        const taken = new Set(loadTracks(project.id).map(tr => tr.name).filter(Boolean))
        const addTracks = withHeights.tracks.map((tr) => {
          const elements = recalcAbsLengths(tr.elements)
          const name = !tr.name || taken.has(tr.name)
            ? nextTrackName((tr.name ?? 'provi').split('.')[0], taken)
            : tr.name
          taken.add(name)
          return { ...tr, id: tr.id ?? generateId(), name, elements, coordinates: rebuildCoords(elements) }
        })

        // Axes that meet end to end are one line: linked, as the MDB import
        // does, over the project as it will be — a switch port claims its end.
        const afterTracks = [...loadTracks(project.id), ...addTracks]
        const afterSwitches = [...loadSwitches(project.id), ...placed.switches]
        const { links, joints, fanned } = linkAllJoints(afterTracks, afterSwitches,
          afterSwitches.map(sw => sw.name).filter(Boolean))
        if (links.length) {
          lines.push(t('data_exchange_mdb_links')
            .replace('{{n}}', links.length)
            .replace('{{crs}}', joints.filter(j => j.crsChange).length))
        }
        if (fanned) lines.push(t('data_exchange_mdb_fanned').replace('{{n}}', fanned))

        const readableLines = lines.map(readable)
        setNotes(readableLines)
        onReport?.(`ProVI · ${fileName}`, { tracks: addTracks.length, switches: placed.switches.length }, readableLines)
        if (addTracks.length) {
          commitSwitchConnection(project.id, {
            removeTrackIds: [], addTracks, addSwitches: [...placed.switches, ...links], remap: [],
          })
          onTrackSaved?.()
          fitToTracks(map?.current, addTracks)
        }
      } catch (err) {
        console.error('ProVI import error:', err)
        setNotes([`ProVI: ${err.message}`])
      }
      setBusy(null)
    }, 0)
  }

  const allChosen = axes?.length > 0 && chosen.size === axes.length

  return (
    <>
      <input ref={inputRef} type="file" accept=".zip,application/zip"
        style={{ display: 'none' }} onChange={handleFile} />
      <button className="panel-btn panel-btn-full" disabled={!project || busy != null}
        onClick={() => inputRef.current?.click()}>
        {busy === 'reading' ? t('data_exchange_provi_reading') : t('data_exchange_provi_choose')}
      </button>
      {axes?.length > 0 && (
        <>
          <p className="selecting-hint">
            {t('data_exchange_provi_counts')
              .replace('{{axes}}', axes.length)
              .replace('{{gradients}}', axes.filter(a => a.gradient).length)}
          </p>
          <div className="form-field">
            <label>{t('data_exchange_provi_frame')}</label>
            <select className="settings-select" value={frame} onChange={e => setFrame(e.target.value)}>
              {PROVI_FRAMES.map(f => <option key={f.frame} value={f.frame}>{f.label}</option>)}
            </select>
          </div>
          <label className="transition-curve-row">
            <input type="checkbox" checked={allChosen}
              onChange={() => setChosen(allChosen ? new Set() : new Set(axes.map(a => a.name)))} />
            <span>{t('data_exchange_provi_all')}</span>
          </label>
          <div className="provi-axis-list">
            {axes.map(a => (
              <label key={a.name} className="provi-axis-row">
                <input type="checkbox" checked={chosen.has(a.name)} onChange={() => toggle(a.name)} />
                <span className="provi-axis-name">{a.name}</span>
                <span className="provi-axis-title">
                  {[a.title, `${(a.length / 1000).toFixed(2)} km`,
                    a.gradient ? t('data_exchange_provi_gradient') : null].filter(Boolean).join(' · ')}
                </span>
              </label>
            ))}
          </div>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 4 }}
            disabled={!project || !chosen.size || busy != null} onClick={runImport}>
            {busy === 'importing'
              ? t('data_exchange_provi_importing')
              : t('data_exchange_provi_import').replace('{{n}}', chosen.size)}
          </button>
        </>
      )}
      {notes.length > 0 && (
        <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto' }}>
          {notes.map((line, i) => <p key={i} style={noteStyle}>{line}</p>)}
        </div>
      )}
    </>
  )
}
