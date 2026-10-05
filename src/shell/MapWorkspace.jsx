import { Suspense, lazy, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useI18n } from '../locales/i18nContext'
import { MapContext } from '../map/MapContext'
import useMapInstance, { ELEVATION_BASEMAPS } from '../map/useMapInstance'
import TiltToggle from '../map/TiltToggle'
import { renderTracksOnMap, updateMapColors } from '../map/trackLayers'
import { currentProject, currentWorkingCopy, deleteKmLine, loadSwitches, loadTracks, redo, saveKmLine, undo } from '../storage'
import { useHiddenTracks, useProject } from '../hooks/useStore'
import { FILTER_NONE } from '../map/pick'
import { highlightTopology, zoomToTopologyTracks } from '../utils/topologyLayer'
import { selectionHighlight } from '../utils/topologyGraph'
import { ensureKmLines } from '../utils/kmLineSource'
import { isMultilineTarget, isProjectRedo, isProjectUndo } from '../utils/keyboard'
import { escapeAction, frontHandler } from './escape'
import { loadSettings, saveSettings } from '../utils/settings'
import useKmLineHover from '../hooks/useKmLineHover'
import useKmOverlays from './useKmOverlays'
import { OVERLAYS_CLOSED, closesTrackTable, overlayReducer } from './overlays'
import { PANELS, panelById } from './panels'
import Sidebar from './Sidebar'
import StepNotice from './StepNotice'
import MapLegend from './MapLegend'
import { START_REGION } from '../map/style'
import usePanelWidth from './usePanelWidth'
import RuleFieldsScope from '../components/form/RuleFieldsScope'
import ConfirmModal from '../components/ConfirmModal'
import ElevationLegend from '../components/ElevationLegend'
import PopoutWindow from '../components/PopoutWindow'
import WorkingCopyBar from '../components/collab/WorkingCopyBar'

// The overlays and dialogs are chunks of their own (R9.1), loaded when first shown.
const TrackTableOverlay = lazy(() => import('../components/TrackTableOverlay'))
const PhysicsOverlay = lazy(() => import('../components/PhysicsOverlay'))
const RegelwerkOverlay = lazy(() => import('../components/RegelwerkOverlay'))
const PlanPreviewOverlay = lazy(() => import('../components/PlanPreviewOverlay'))
const ElevationOverlay = lazy(() => import('../components/ElevationOverlay'))
const CrossSectionOverlay = lazy(() => import('../components/CrossSectionOverlay'))
const TopologyGraphOverlay = lazy(() => import('../components/TopologyGraphOverlay'))
const CompareOverlay = lazy(() => import('../components/collab/CompareOverlay'))
const ConflictDialog = lazy(() => import('../components/collab/ConflictDialog'))
const CheckInDialog = lazy(() => import('../components/collab/CheckInDialog'))
import { TRACKS_HOVER_LAYER, TRACKS_LAYER } from '../map/layerIds'
import { PALETTE } from '../styles/palette'

const DEFAULT_COLOR = PALETTE.primaryDefault

/**
 * The open project on the map (R2.3–R2.5): the sidebar and the panel made from
 * the panel register, the map drawing the store, the one overlay and popup
 * over it, and the working copy's bar and dialogs (`wc`, useWorkingCopy's).
 * `onHome` is called once the working copy is closed.
 */
export default function MapWorkspace({ wc, onHome }) {
  const { t, language } = useI18n()
  const project = useProject()
  // The tracks hidden on the map — a redraw when that changes, like a write.
  const hidden = useHiddenTracks()
  const projectRef = useRef(project)
  useEffect(() => { projectRef.current = project }, [project])

  // The topology view (AP 9.3) is on while its panel is open (AP 9.5): a way of
  // looking, not a setting of the project. The ref is what the map callbacks
  // read. The basemap the view replaced with Liberty is kept to go back to.
  const topologyRef = useRef(false)
  const [basemapBeforeTopology, setBasemapBeforeTopology] = useState(null)
  // What is picked in the topology view: { kind: 'switch'|'track', id } or null.
  const [topologySelection, setTopologySelection] = useState(null)

  // The map, its basemap and the elevation legend's range (R2.1). Every style
  // that loads — the first and each basemap change — gets the project and the
  // kilometrage overlays drawn onto it again.
  const { map, mapContainer, mapVersion, activeBasemap, setBasemap, elevationRange, tilt } = useMapInstance({
    onStyleLoad: ({ fit }) => {
      if (projectRef.current) {
        renderTracksOnMap(map.current, projectRef.current, { fit, topology: topologyRef.current })
        // An empty project is looked at where railways are planned (R10.13).
        if (fit && !(projectRef.current.tracks ?? []).length) map.current.fitBounds(START_REGION, { padding: 40, duration: 0 })
      }
      km.restore()
    },
  })
  const mapCtx = { map, mapVersion }
  const km = useKmOverlays(map)
  useKmLineHover(map, km.kmOverlays.db || km.kmOverlays.other, t)

  // A panel is always open, the info panel first — for an empty project with
  // its first steps (R10.13).
  const [activePanel, setActivePanel] = useState('info')
  const [overlays, dispatch] = useReducer(overlayReducer, OVERLAYS_CLOSED)
  const { overlay, popup, detached } = overlays
  // Two states over each other (AP 10.3): { before, after, beforeLabel, afterLabel, drawUnchanged }.
  const [compare, setCompare] = useState(null)
  const [color, setColorState] = useState(() => loadSettings().color ?? DEFAULT_COLOR)

  // Whether the element table holds edits nobody has written yet, and what to
  // do once the user has said the word on losing them.
  const [tableDirty, setTableDirty] = useState(false)
  const [discardAsk, setDiscardAsk] = useState(null)   // () => void, the way on

  /**
   * Run `action` on the overlays — but closing the element table is the one
   * step that can lose work: nothing it holds is written until Save. Every way
   * out comes by here — its own ✕, the panel's back button, another icon, the
   * way back to the start page — so the question is asked once, in one place,
   * and only when there is something to lose. `then` runs after the action.
   */
  const act = useCallback((action, then) => {
    const go = () => { dispatch(action); then?.() }
    if (tableDirty && closesTrackTable(overlays, action)) setDiscardAsk(() => go)
    else go()
  }, [overlays, tableDirty])

  const openOverlay = useCallback((o) => act({ type: 'open', overlay: o }), [act])
  const closeOverlay = useCallback((kind) => act({ type: 'close', kind }), [act])

  // The cross section in a window of its own: opened here, in the click, so
  // the browser lets it through. A blocked window leaves it over the map.
  const detachOverlay = (kind) => {
    const win = window.open('', `olt-${kind}`, 'popup,width=1100,height=600')
    if (win) dispatch({ type: 'detach', kind, win })
  }

  // An update put a merged record in place of the working copy: the element
  // table's edits were made on the old one and go with it.
  useEffect(() => {
    if (wc.replaced) dispatch({ type: 'close', kind: 'trackTable' })
  }, [wc.replaced])

  // ── panels ──
  const panelSize = usePanelWidth()
  const selectPanel = (next, then) => {
    // The open panel's icon leaves it open: there is always one.
    if (next === activePanel) { then?.(); return }
    const leaving = panelById(activePanel)
    // Entering and leaving may also keep what they replace (the basemap).
    const ctx = { ...shell, basemapBeforeTopology, setBasemapBeforeTopology }
    act({ type: 'panelChange' }, () => {
      leaving?.onLeave?.(ctx)
      setActivePanel(next)
      panelById(next)?.onEnter?.(ctx)
      then?.()
    })
  }

  // Docked again it is the overlay of its panel, so that panel is opened.
  const dockDetached = () => {
    const owner = PANELS.find(p => p.overlay === detached?.kind)
    if (owner) selectPanel(owner.id, () => dispatch({ type: 'dock' }))
  }

  const goHome = () => act({ type: 'closeAll' }, async () => {
    setCompare(null)
    await wc.close()
    onHome()
  })

  const setColor = (c) => {
    setColorState(c)
    document.documentElement.style.setProperty('--color-primary', c)
    saveSettings({ color: c })
  }

  // What the panel register's entries read and call (see shell/panels.js).
  const shell = {
    activeBasemap, setBasemap,
    kmOverlays: km.kmOverlays, setKmOverlay: km.setKmOverlay, kmLinesError: km.kmLinesError,
    topologySelection, setTopologySelection,
    overlay, openOverlay, closeOverlay, detached,
    showPhysics: () => act({ type: 'popup', popup: { kind: 'physics' } }),
    showRegelwerk: (regelwerkId = '') => act({ type: 'popup', popup: { kind: 'regelwerk', regelwerkId } }),
    closePopup: () => act({ type: 'closePopup' }),
    // Picking another track keeps the edits — they are the table's, not one
    // track's — so only closing it (null) has to be asked about.
    showTrackTable: (track, row) => (track
      ? openOverlay({ kind: 'trackTable', track, initialRow: row ?? null })
      : closeOverlay('trackTable')),
    setCompare,
    color, setColor,
    selectPanel,
  }

  // ── the map draws the store ──
  useEffect(() => {
    // Not on isStyleLoaded(): that stays false while a tile loads, and the
    // colour would be dropped. updateMapColors only touches layers that exist.
    if (map.current) updateMapColors(map.current, color)
    // The topology symbols carry the colour too.
    if (topologyRef.current && map.current && projectRef.current) {
      renderTracksOnMap(map.current, projectRef.current, { topology: true })
    }
  }, [color, map])

  const topology = activePanel === 'topology'
  useEffect(() => {
    topologyRef.current = topology
    // Drawn as soon as the tracks are on the map — not on isStyleLoaded(),
    // which stays false while any tile is still loading and so skipped the
    // switch on the first open. A style still coming in (the change to
    // Liberty) draws it from its own style.load, through the ref.
    if (map.current?.getLayer(TRACKS_LAYER) && projectRef.current) {
      renderTracksOnMap(map.current, projectRef.current, { topology })
    }
  }, [topology, map])

  // A switch or track picked in the topology view (on the map or in the
  // diagram): a switch with the tracks it connects, a track with the switches
  // it runs into, highlighted.
  useEffect(() => {
    highlightTopology(map.current, selectionHighlight(topologySelection, loadSwitches()))
  }, [topologySelection, map])

  // A pick in the diagram also takes the map to what it highlights: a switch's
  // tracks, or the track itself.
  const pickInTopologyDiagram = (selection) => {
    setTopologySelection(selection)
    if (!selection) return
    const { trackIds } = selectionHighlight(selection, loadSwitches())
    zoomToTopologyTracks(map.current, loadTracks().filter(tr => trackIds.includes(tr.id)))
  }

  // The kilometrage lines the tracks name are fetched in the background,
  // after every change of the tracks and once on opening. Nothing on screen
  // waits for them — they are read when a plan is drawn.
  const syncKmLines = useCallback(() => {
    const asked = currentProject()
    ensureKmLines(asked)
      .then(({ save, remove, errors }) => {
        // Another project may have been opened while the lines were fetched.
        if (currentProject()?.id !== asked?.id) return
        for (const lineNumber of remove) deleteKmLine(lineNumber)
        for (const line of save) saveKmLine(line)
        if (errors.length) console.warn('[map] Kilometrage lines unavailable:', errors)
      })
      .catch(err => console.warn('[map] Kilometrage lines:', err))
  }, [])

  // Whenever what the map shows changed — a write, an undo, a merge taken
  // over, a track hidden or shown — it is drawn again. Nothing that writes
  // has to say so.
  const drawn = useRef(null)
  useEffect(() => {
    if (!project) { drawn.current = null; return }
    const parts = [project.tracks, project.switches, project.platforms, project.endMarks, hidden]
    const before = drawn.current
    drawn.current = parts
    if (before && parts.every((x, i) => x === before[i])) return
    // Before the style has loaded there is nothing to draw on yet; its
    // style.load handler draws the project as it is then.
    if (map.current?.getLayer(TRACKS_LAYER)) {
      renderTracksOnMap(map.current, project, { topology: topologyRef.current })
    }
    if (!before || parts[0] !== before[0]) syncKmLines()
  }, [project, hidden, syncKmLines, map])

  // Element and switch labels are language-dependent, so a language change has
  // to redraw them.
  useEffect(() => {
    if (map.current?.getLayer(TRACKS_LAYER) && projectRef.current) {
      renderTracksOnMap(map.current, projectRef.current, { topology: topologyRef.current })
    }
  }, [language, map])

  // The track the element table shows is outlined on the map.
  const tableTrackId = overlay?.kind === 'trackTable' ? overlay.track.id : null
  useEffect(() => {
    if (!map.current?.getLayer(TRACKS_HOVER_LAYER)) return
    map.current.setFilter(TRACKS_HOVER_LAYER, tableTrackId ? ['==', ['get', 'trackId'], tableTrackId] : FILTER_NONE)
  }, [tableTrackId, map])

  // Ctrl+Z outside a field takes the last project step back.
  useEffect(() => {
    const onKey = (e) => {
      if (isProjectUndo(e)) {
        e.preventDefault()
        undo()
      } else if (isProjectRedo(e)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Escape, in the one order shell/escape states (R10.2). A field keeps its own
  // Escape, and an open dialog handles it itself.
  useEffect(() => {
    const onKey = (e) => {
      // A text area and an open select keep their Escape; a field that handled
      // it already says so (defaultPrevented).
      if (e.key !== 'Escape' || e.defaultPrevented || isMultilineTarget(e.target)) return
      const formCancel = frontHandler()
      const action = escapeAction({
        modalOpen: !!document.querySelector('[aria-modal="true"]'), formCancel, compare, popup, overlay,
      })
      if (!action || action === 'modal') return
      e.preventDefault()
      if (action === 'form') formCancel()
      else if (action === 'compare') setCompare(null)
      else if (action === 'popup') act({ type: 'closePopup' })
      else closeOverlay(overlay.kind)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compare, popup, overlay, act, closeOverlay])

  const panel = panelById(activePanel)
  const PanelComponent = panel?.Component

  return (
    <MapContext.Provider value={mapCtx}>
      <div className="layout">
        <Sidebar active={activePanel} onSelect={selectPanel} onUndo={undo} onRedo={redo} onHome={goHome} />

        {PanelComponent && (
          <aside className="sidebar-secondary" style={panelSize.width ? { width: panelSize.width } : undefined}>
            <div className="panel-content">
            <Suspense fallback={<p className="selecting-hint">…</p>}>
              <RuleFieldsScope key={activePanel}>
                <PanelComponent {...(panel.props?.(shell) ?? {})} />
              </RuleFieldsScope>
            </Suspense>
            </div>
            {/* Its width by the right edge, a double click back to the standard one (R10.9). */}
            <div className="panel-resize" onPointerDown={panelSize.onResizeStart} onDoubleClick={panelSize.resetWidth} />
          </aside>
        )}

        <div className="map-pane">
          <div className="map-container" ref={mapContainer} />
          <TiltToggle tilt={tilt} />
          {wc.wc && (
            <WorkingCopyBar projectTitle={wc.wc.project.title} variantName={wc.wc.variant.name} base={wc.base}
              changes={wc.changes.length} serverNewer={wc.serverNewer} busy={wc.busy}
              onCheckIn={wc.askCheckIn}
              onUpdate={() => wc.startUpdate()}
              onShowChanges={() => setCompare({
                before: currentWorkingCopy().basePayload, after: currentWorkingCopy().project,
                beforeLabel: `${wc.wc.variant.name} · ${t('wc_base')}`, afterLabel: t('wc_working_copy'),
              })} />
          )}
          {wc.note && <button type="button" className="wc-note" onClick={wc.clearNote}>{wc.note}</button>}
          {ELEVATION_BASEMAPS.has(activeBasemap) && <ElevationLegend range={elevationRange} />}
          <StepNotice />
          <MapLegend color={color} />

          <Suspense fallback={null}>
          {overlay?.kind === 'trackTable' && <TrackTableOverlay track={overlay.track}
            initialRow={overlay.initialRow} onPickTrack={(track) => openOverlay({ kind: 'trackTable', track, initialRow: null })}
            onDirtyChange={setTableDirty} onClose={() => closeOverlay('trackTable')} />}
          {overlay?.kind === 'profile' && <ElevationOverlay trackId={overlay.trackId}
            section={detached?.kind === 'crossSection' ? detached.at : null} onClose={() => closeOverlay('profile')} />}
          {overlay?.kind === 'crossSection' && <CrossSectionOverlay at={overlay.at}
            onAtChange={(at) => openOverlay({ kind: 'crossSection', at })} onClose={() => closeOverlay('crossSection')}
            onDetach={() => detachOverlay('crossSection')} />}
          {overlay?.kind === 'planPreview' && <PlanPreviewOverlay plan={overlay.plan} filenameBase={overlay.filenameBase}
            onClose={() => closeOverlay('planPreview')} />}
          {overlay?.kind === 'topologyGraph' && topology && <TopologyGraphOverlay
            selection={topologySelection} onSelect={pickInTopologyDiagram}
            onDeleted={() => setTopologySelection(null)}
            onClose={() => closeOverlay('topologyGraph')} />}

          {popup?.kind === 'physics' && <PhysicsOverlay onClose={shell.closePopup} />}
          {popup?.kind === 'regelwerk' && <RegelwerkOverlay regelwerkId={popup.regelwerkId} onClose={shell.closePopup} />}

          {compare && <CompareOverlay mapVersion={mapVersion} {...compare} onClose={() => setCompare(null)} />}
          {wc.syncDialog?.kind === 'merge' && (
            <ConflictDialog mapVersion={mapVersion} result={wc.syncDialog.prepared.result} busy={wc.busy}
              title={t('wc_merge_title')} mineLabel={t('wc_working_copy')}
              theirsLabel={`${t('wc_server')} (${wc.syncDialog.prepared.head.author.name})`}
              onCancel={wc.cancelDialog} onApply={wc.applyMerge} />
          )}
          {wc.syncDialog?.kind === 'checkin' && (
            <CheckInDialog changes={wc.changes} errors={wc.syncDialog.errors} busy={wc.busy}
              onCancel={wc.cancelDialog} onSubmit={wc.submitCheckIn} />
          )}
          </Suspense>
          {/* The cross section in its own window, beside whatever overlay the
              map shows — under a boundary of its own, so an overlay loading
              for the first time does not blank the window meanwhile. */}
          {detached?.kind === 'crossSection' && (
            <Suspense fallback={null}>
              <PopoutWindow win={detached.win} onClose={() => dispatch({ type: 'closeDetached' })}>
                <CrossSectionOverlay at={detached.at} detached
                  onAtChange={(at) => openOverlay({ kind: 'crossSection', at })}
                  onClose={() => dispatch({ type: 'closeDetached' })} onDock={dockDetached} />
              </PopoutWindow>
            </Suspense>
          )}
          {discardAsk && (
            <ConfirmModal
              message={t('table_discard_confirm')}
              confirmLabel={t('table_discard')}
              onConfirm={() => { const go = discardAsk; setDiscardAsk(null); go() }}
              onCancel={() => setDiscardAsk(null)}
            />
          )}
        </div>
      </div>
    </MapContext.Provider>
  )
}
