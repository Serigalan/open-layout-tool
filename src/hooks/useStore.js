import { useSyncExternalStore } from 'react'
import { canUndo, currentProject, subscribe } from '../storage'

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
export const useTracks = () => useSyncExternalStore(subscribe, tracksOf, tracksOf)
export const useSwitches = () => useSyncExternalStore(subscribe, switchesOf, switchesOf)
/** Whether there is a step to take back. */
export const useCanUndo = () => useSyncExternalStore(subscribe, canUndo, canUndo)
