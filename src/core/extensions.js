/**
 * The extension points of core (Paket L, decision 277): where the server
 * components dock onto an app that runs without them.
 *
 * core never imports from src/server. Where a server part has to appear — a
 * tool in a panel, a terrain source, the clouds on the server — core asks
 * here, and src/server/register.js puts it in before the first render. The
 * local build never runs register.js: every list is empty, every provided
 * value its fallback, and core runs complete on its own.
 *
 * Two kinds:
 *
 *   extend(point, entry)        lists, in the order the entries came
 *   provide(name, value)        one value — a hook, a service — or nothing
 *
 * Lists (what an entry holds is documented where core reads it):
 *
 *   panelTools          a tool in a panel's menu      { panel, id, icon, titleKey, section?, Component, props? }
 *   importSections      a format in the data exchange  { id, Component }
 *   sidebarFoot         beside the sidebar's foot      Component
 *   workspaceAddons     rendered in the map view       Component({ project, crossSectionAt, onShowCrossSection })
 *   terrainSources      a source of ground heights     { id, sample, label }        (elevationSource)
 *   cloudProviders      clouds from elsewhere           { list, reader }             (projectClouds, cloudSource)
 *   crossSectionTools   beside the section's cloud      Component({ projectId, clouds, level, onLevel })
 *   localStoreSections  what else the browser keeps     { id, read, deleteAll, ... } (localStore)
 *
 * Provided values:
 *
 *   useCloudServer          the point cloud panel's clouds on the server
 *   useServerRun            long runs over the clouds on the server
 *   useCloudRegistration    a re-referencing the 3D window runs, seen in the section
 *   regelwerkService        the rule catalogues as the optimizer service has them
 */

const EMPTY = Object.freeze([])
const lists = new Map()
const values = new Map()

/** Add `entry` to the list `point`. */
export function extend(point, entry) {
  if (!lists.has(point)) lists.set(point, [])
  lists.get(point).push(entry)
}

/** The entries of `point`, in the order they came — empty without the server. */
export const extensionsOf = (point) => lists.get(point) ?? EMPTY

/** Provide the value behind `name` — once, before the first render (a hook has to stay the same). */
export function provide(name, value) {
  values.set(name, value)
}

/** The value behind `name`, or `fallback` where nothing provides it. */
export const provided = (name, fallback) => (values.has(name) ? values.get(name) : fallback)

/** Forget everything — for the tests, which register and look again. */
export function resetExtensions() {
  lists.clear()
  values.clear()
}
