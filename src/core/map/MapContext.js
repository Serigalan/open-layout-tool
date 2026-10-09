import { createContext, useContext } from 'react'

// The app's MapLibre map (R2.2): the ref useMapInstance holds, and how many
// maps have been made so far (a map made anew has none of what an effect drew
// on the one before). Outside a provider there is no map.
export const MapContext = createContext({ map: { current: null }, mapVersion: 0 })

/** The map ref — `map.current` is the MapLibre map, or null. */
export const useMap = () => useContext(MapContext).map

