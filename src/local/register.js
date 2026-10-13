import { extend } from '../core/extensions'
import { SpliceJoinIcon } from '../core/components/icons'
import { LocalSpliceTool } from './splice/tools'

/**
 * What only the local build adds to core (decision 293): its own simplified
 * tools, docked on at the same extension points the server's go to
 * (core/extensions.js) — once, when src/main.local.jsx starts, before the
 * first render. The main build never imports this file.
 */

// Joining two tracks, simplified and computed in the browser (the server's
// splice runs on the optimizer service).
extend('panelTools', { panel: 'splice', id: 'splice', icon: SpliceJoinIcon, titleKey: 'splice_local_start', Component: LocalSpliceTool })
