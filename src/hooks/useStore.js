import { useSyncExternalStore } from 'react'
import { currentProject, hiddenTracks, lastStep, redoStep, subscribe, undoStep } from '../storage'

// The open project, read through a subscription (R1.4): a component that uses
// one of these renders again after every write and every undo, and only reads
// what is there now. The store is immutable, so each part keeps its identity
// until something changes it — a component reading the switches is not
// re-rendered by a height edit of a track.

const EMPTY = Object.freeze([])

/** The open project (hydrated), or null. */
export function useProject() {
  return useSyncExternalStore(subscribe, currentProject, currentProject)
}

const part = (key) => () => currentProject()?.[key] ?? EMPTY

const tracksOf = part('tracks')
const switchesOf = part('switches')
const platformsOf = part('platforms')
const axisSurveysOf = part('axisSurveys')
const referenceAxesOf = part('referenceAxes')
export const useTracks = () => useSyncExternalStore(subscribe, tracksOf, tracksOf)
export const useSwitches = () => useSyncExternalStore(subscribe, switchesOf, switchesOf)
export const usePlatforms = () => useSyncExternalStore(subscribe, platformsOf, platformsOf)
export const useAxisSurveys = () => useSyncExternalStore(subscribe, axisSurveysOf, axisSurveysOf)
export const useReferenceAxes = () => useSyncExternalStore(subscribe, referenceAxesOf, referenceAxesOf)
/** The ids of the tracks hidden on the map (a Set, kept on this device). */
export const useHiddenTracks = () => useSyncExternalStore(subscribe, hiddenTracks, hiddenTracks)
/** The step undo would take back and the one redo would bring again: { before, after }, or null. */
export const useUndoStep = () => useSyncExternalStore(subscribe, undoStep, undoStep)
export const useRedoStep = () => useSyncExternalStore(subscribe, redoStep, redoStep)
/** The last step taken, undone or redone: { serial, kind, before, after }, or null. */
export const useLastStep = () => useSyncExternalStore(subscribe, lastStep, lastStep)
