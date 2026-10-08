import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildTree, selectNodes } from './lod'
import { pointMaterial, pickLowMaterial, setLook, edlPass } from './shaders'
import { sourceOf } from '../utils/pointCloud/cloudSource'
import { modelMatrix } from './placement'

/**
 * The 3D view of a project's point clouds (AP 13.8–13.11), plain three.js on
 * WebGL2, in a window of its own.
 *
 * Everything is drawn relative to an `origin` near the clouds: float32 at
 * 4 467 335 / 5 333 806 would keep only about half a metre (AP 13.8). The
 * view's plane is the tracks' (or the first cloud's); a tile in another plane
 * is converted point by point in the worker. A re-referenced cloud is drawn
 * through its model matrix (placement.js, AP 13.13), so that the
 * transformation being fitted moves it without a tile read again. The axes:
 * x east, y north, z up.
 *
 * Tiles come by level of detail within a point budget (lod.js), read through
 * the same source and OPFS cache as the cross section (cloudSource), decoded
 * in workers; tiles no longer drawn stay on the graphics card until the
 * loaded points exceed twice the budget, the least recently drawn going
 * first. The points are shaded by eye-dome lighting, which gives a cloud
 * without normals its edges.
 */

// Colours are drawn as they are stored — the shaders and the EDL pass work on
// the raw values, and a line in #e00 should look like #e00.
THREE.ColorManagement.enabled = false

/** Tiles read and decoded at a time. */
const PARALLEL_LOADS = 6
/** How often the drawn tiles are chosen anew while the camera moves [ms]. */
const SELECT_EVERY = 120
/** Half the edge of the square searched around a click for a point [px]. */
const PICK_RADIUS = 8
/** Speed of the walk along a track [m/s], four times that with Shift. */
const WALK_SPEED = 6

/** Whether two placements put the points into the same pre plane about the same origin. */
const samePre = (a, b) => !!a && !!b && a.preCrs === b.preCrs && a.preOrigin.every((v, i) => v === b.preOrigin[i])

const DEFAULTS = { coloring: 'intensity', budget: 6e6, sizeFactor: 1, edl: true, edlStrength: 0.6 }

export class Viewer {
  constructor(canvas, { projectId, origin, viewCrs, zRange, onStatus = () => {}, onDoubleClick = () => {} }) {
    this.canvas = canvas
    this.projectId = projectId
    this.origin = origin
    this.viewCrs = viewCrs
    this.zRange = zRange
    this.onStatus = onStatus
    this.onDoubleClick = onDoubleClick
    this.options = { ...DEFAULTS }
    this.clouds = []            // { key, row, levels, crs, color, rgb, roots, nodes }
    this.loaded = new Map()     // node → { points, lastDrawn }
    this.loading = new Set()
    this.queue = []
    this.drawn = []
    this.dirty = true
    this.lastSelect = 0
    this.needSelect = true

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer = renderer

    this.scene = new THREE.Scene()
    this.pointsGroup = new THREE.Group()
    this.overlay = new THREE.Group()
    this.overlay.layers.set(1)
    this.scene.add(this.pointsGroup, this.overlay)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20000)
    camera.up.set(0, 0, 1)
    camera.layers.enable(1)
    this.camera = camera

    const controls = new OrbitControls(camera, canvas)
    controls.screenSpacePanning = true
    controls.zoomToCursor = true
    controls.enableDamping = false
    controls.addEventListener('change', () => { this.dirty = true; this.needSelect = true })
    this.controls = controls

    this.edl = edlPass()
    this.target = null
    this.pick = {
      target: new THREE.WebGLRenderTarget(2 * PICK_RADIUS + 1, 2 * PICK_RADIUS + 1),
      pixels: new Uint8Array((2 * PICK_RADIUS + 1) ** 2 * 4),
    }

    this.workers = Array.from({ length: 2 }, () => {
      const w = new Worker(new URL('./tileWorker.js', import.meta.url), { type: 'module' })
      w.onmessage = ({ data }) => this.decoded(data)
      return w
    })
    this.jobs = new Map()
    this.nextJob = 1
    this.nextNodeId = { value: 1 }

    this.walk = null
    this.keys = new Set()
    this.onKey = (e) => {
      if (!this.walk || e.target?.closest?.('input, select, textarea')) return
      const k = e.key.toLowerCase()
      if (!['w', 'a', 's', 'd', 'shift', 'r', 'f'].includes(k)) return
      if (e.type === 'keydown') this.keys.add(k)
      else this.keys.delete(k)
      e.preventDefault()
    }
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
    this.onDblClick = (e) => {
      const hit = this.pickAt(e.offsetX, e.offsetY)
      if (hit) this.onDoubleClick(hit)
    }
    canvas.addEventListener('dblclick', this.onDblClick)
    this.setupWalkMouse()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas.parentElement ?? canvas)
    this.resize()
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  /** Initialise the workers' grids for the planes the clouds and the view are in. */
  initWorkers({ base, box }) {
    this.gridArea = { base, box }
    const crs = this.clouds.filter(c => c.crs != null && c.place.preCrs != null && c.crs !== c.place.preCrs)
      .map(c => [c.crs, c.place.preCrs])
    for (const w of this.workers) w.postMessage({ type: 'init', base, crs, box })
  }

  /**
   * A cloud to draw: `row` as the API lists it, `levels[l]` the index of level
   * l (1…4, with `server: { level }`), `place` where it is drawn (placement.js).
   */
  addCloud({ key, row, levels, place, color }) {
    const { roots, nodes } = buildTree(key, levels, this.nextNodeId)
    const cloud = { key, row, levels, crs: row.crs, color, rgb: row.rgb, roots, nodes, visible: true, zSamples: [], zRange: null }
    this.clouds.push(cloud)
    this.place(cloud, place)
    this.needSelect = true
  }

  /**
   * Draw a cloud elsewhere (AP 13.13): a new transformation moves what is
   * loaded; a new pre plane or origin reads its tiles again.
   */
  setPlacement(key, place) {
    const cloud = this.clouds.find(c => c.key === key)
    if (!cloud) return
    const same = samePre(cloud.place, place)
    if (!same) {
      // The workers may need the grids of a plane they have not converted into yet.
      if (this.gridArea && cloud.crs != null && place.preCrs != null && cloud.crs !== place.preCrs) {
        for (const w of this.workers) w.postMessage({ type: 'init', ...this.gridArea, crs: [[cloud.crs, place.preCrs]] })
      }
      for (const [node, { points }] of [...this.loaded]) {
        if (node.cloud !== key) continue
        this.pointsGroup.remove(points)
        points.geometry.dispose()
        points.material.dispose()
        points.userData.low.dispose()
        this.loaded.delete(node)
      }
      cloud.zSamples = []
      cloud.zRange = null
    }
    this.place(cloud, place)
    this.needSelect = true
    this.dirty = true
  }

  /** Set a cloud's placement: its model matrix, and its boxes in the view's frame. */
  place(cloud, place) {
    cloud.place = place
    cloud.model = new THREE.Matrix4().set(...modelMatrix(place, this.origin))
    const [oe, on, oz] = this.origin
    // The boxes in the view's frame: the corners carried over, widened a little.
    for (const n of cloud.nodes) {
      const [x0, y0, z0, x1, y1, z1] = n.box
      const corners = [[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]]
        .map(([e, nn, z]) => place.toView(e, nn, z))
      const [es, ns, zs] = [0, 1, 2].map(i => corners.map(c => c[i]))
      n.view = new THREE.Box3(
        new THREE.Vector3(Math.min(...es) - oe - 0.05, Math.min(...ns) - on - 0.05, Math.min(...zs) - oz - 0.05),
        new THREE.Vector3(Math.max(...es) - oe + 0.05, Math.max(...ns) - on + 0.05, Math.max(...zs) - oz + 0.05))
    }
    cloud.modelInverse = cloud.model.clone().invert()
    for (const [node, { points }] of this.loaded) {
      if (node.cloud !== cloud.key) continue
      points.matrix.copy(cloud.model)
      points.matrixWorldNeedsUpdate = true
      this.bound(points.geometry, node, cloud)
    }
  }

  /**
   * A tile's bounds in its geometry's own frame — the pre plane: three.js
   * culls by them through the model matrix.
   */
  bound(geometry, node, cloud) {
    geometry.boundingBox = node.view.clone().applyMatrix4(cloud.modelInverse)
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere())
  }

  /** Whether a cloud is drawn here at all. */
  hasCloud(key) { return this.clouds.some(c => c.key === key) }

  /** Stop drawing a cloud and free what it loaded. */
  removeCloud(key) {
    for (const [node, { points }] of [...this.loaded]) {
      if (node.cloud !== key) continue
      this.pointsGroup.remove(points)
      points.geometry.dispose()
      points.material.dispose()
      points.userData.low.dispose()
      this.loaded.delete(node)
    }
    this.clouds = this.clouds.filter(c => c.key !== key)
    this.needSelect = true
    this.dirty = true
  }

  setCloudVisible(key, visible) {
    const c = this.clouds.find(x => x.key === key)
    if (c) { c.visible = visible; this.needSelect = true }
  }

  setOptions(options) {
    this.options = { ...this.options, ...options }
    for (const [node, entry] of this.loaded) this.look(node, entry.points)
    this.dirty = true
    this.needSelect = true
  }

  /** Put the camera above the clouds, looking at them from the south-west. */
  frame(box) {
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length()
    this.controls.target.copy(center)
    this.camera.position.copy(center).add(new THREE.Vector3(-0.45 * size, -0.6 * size, 0.5 * size))
    this.camera.far = Math.max(1000, size * 20)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.dirty = true
    this.needSelect = true
  }

  /** Look straight down on the point the camera looks at. */
  topView() {
    this.stopWalk()
    const t = this.controls.target
    const d = Math.max(30, this.camera.position.distanceTo(t))
    this.camera.position.set(t.x, t.y - d * 0.001, t.z + d)
    this.controls.update()
    this.dirty = true
    this.needSelect = true
  }

  // ── walking along a track ─────────────────────────────────────────────────

  /**
   * Walk along a track (AP 13.8): W/S along it, A/D across, R/F up and down,
   * the mouse turns the view. `samples` from trackGeometry, in the view's
   * plane; `station` where to start.
   */
  startWalk(samples, station = 0) {
    const usable = samples.filter(p => p.z != null)
    if (usable.length < 2) return false
    this.walk = { samples: usable, s: station, across: 0, height: 2.5, yaw: 0, pitch: -0.12 }
    this.controls.enabled = false
    this.placeWalker()
    return true
  }

  stopWalk() {
    if (!this.walk) return
    this.walk = null
    this.keys.clear()
    this.controls.enabled = true
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    this.controls.target.copy(this.camera.position).addScaledVector(dir, 20)
    this.controls.update()
  }

  get walking() { return !!this.walk }

  setupWalkMouse() {
    let drag = null
    this.canvas.addEventListener('pointerdown', (e) => { if (this.walk) drag = { x: e.clientX, y: e.clientY } })
    window.addEventListener('pointerup', () => { drag = null })
    window.addEventListener('pointermove', (e) => {
      if (!drag || !this.walk) return
      this.walk.yaw -= (e.clientX - drag.x) * 0.004
      this.walk.pitch = Math.max(-1.4, Math.min(1.4, this.walk.pitch - (e.clientY - drag.y) * 0.004))
      drag = { x: e.clientX, y: e.clientY }
      this.placeWalker()
    })
  }

  /** The sample at station s, interpolated. */
  sampleAt(samples, s) {
    let i = samples.findIndex(p => p.s >= s)
    if (i <= 0) i = i < 0 ? samples.length - 1 : 1
    const a = samples[i - 1], b = samples[i]
    const u = b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0
    return { e: a.e + u * (b.e - a.e), n: a.n + u * (b.n - a.n), z: a.z + u * (b.z - a.z), bearing: b.bearing }
  }

  placeWalker() {
    const w = this.walk
    const first = w.samples[0].s, last = w.samples[w.samples.length - 1].s
    w.s = Math.max(first, Math.min(last, w.s))
    const p = this.sampleAt(w.samples, w.s)
    const b = p.bearing * Math.PI / 180
    const right = [Math.cos(b), -Math.sin(b)]
    const [oe, on, oz] = this.origin
    this.camera.position.set(p.e - oe + right[0] * w.across, p.n - on + right[1] * w.across, p.z - oz + w.height)
    // Ahead along the track, turned by yaw, tilted by pitch.
    const heading = b - w.yaw
    const look = new THREE.Vector3(Math.sin(heading) * Math.cos(w.pitch), Math.cos(heading) * Math.cos(w.pitch), Math.sin(w.pitch))
    this.camera.lookAt(this.camera.position.clone().add(look))
    this.dirty = true
    this.needSelect = true
  }

  /** Where the walk stands: { station, across } or null. */
  walkState() {
    return this.walk ? { station: this.walk.s, across: this.walk.across } : null
  }

  stepWalk(dt) {
    const k = this.keys
    if (!this.walk || !k.size) return
    const v = WALK_SPEED * (k.has('shift') ? 4 : 1) * dt
    const w = this.walk
    if (k.has('w')) w.s += v
    if (k.has('s')) w.s -= v
    if (k.has('d')) w.across += v * 0.5
    if (k.has('a')) w.across -= v * 0.5
    if (k.has('r')) w.height += v * 0.5
    if (k.has('f')) w.height = Math.max(0.3, w.height - v * 0.5)
    this.placeWalker()
  }

  // ── overlays: tracks, measured axes, section plane, picks ───────────────────

  /** Replace the overlay objects of one kind (`name`) by `objects`, given in absolute plane coordinates. */
  setOverlay(name, objects) {
    for (const o of this.overlay.children.filter(c => c.userData.kind === name)) {
      this.overlay.remove(o)
      o.geometry?.dispose()
      o.material?.dispose()
    }
    for (const o of objects) {
      o.userData.kind = name
      o.layers.set(1)
      this.overlay.add(o)
    }
    this.dirty = true
  }

  /** A polyline of `[e, n, z]` as a three.js line relative to the origin. */
  line(points, color, { loop = false, opacity = 1 } = {}) {
    const [oe, on, oz] = this.origin
    const g = new THREE.BufferGeometry().setFromPoints(points.map(([e, n, z]) => new THREE.Vector3(e - oe, n - on, z - oz)))
    const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })
    return loop ? new THREE.LineLoop(g, m) : new THREE.Line(g, m)
  }

  /** A filled quad of four `[e, n, z]` corners, see-through. */
  quad(corners, color, opacity = 0.18) {
    const [oe, on, oz] = this.origin
    const v = corners.map(([e, n, z]) => [e - oe, n - on, z - oz])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([...v[0], ...v[1], ...v[2], ...v[0], ...v[2], ...v[3]], 3))
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })
    return new THREE.Mesh(g, m)
  }

  /** Points as small squares that keep their size on screen. */
  markers(points, color, size = 7) {
    const [oe, on, oz] = this.origin
    const g = new THREE.BufferGeometry().setFromPoints(points.map(([e, n, z]) => new THREE.Vector3(e - oe, n - on, z - oz)))
    return new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }))
  }

  // ── loading and choosing tiles ──────────────────────────────────────────────

  look(node, points) {
    const cloud = this.clouds.find(c => c.key === node.cloud)
    const o = this.options
    const coloring = o.coloring === 'rgb' && !cloud.rgb ? 'intensity' : o.coloring
    const common = { size: node.voxel, scale: this.projScale, sizeFactor: o.sizeFactor }
    setLook(points.material, {
      ...common, coloring, hasColor: !!cloud.rgb, cloudColor: cloud.color,
      zRange: cloud.zRange ?? [this.zRange[0] - cloud.place.preOrigin[2], this.zRange[1] - cloud.place.preOrigin[2]],
    })
    const low = points.userData.low.uniforms
    low.uSize.value = node.voxel * o.sizeFactor
    low.uScale.value = this.projScale
  }

  async load(node) {
    this.loading.add(node)
    try {
      const cloud = this.clouds.find(c => c.key === node.cloud)
      const placed = cloud.place
      const index = cloud.levels[node.level]
      const bytes = await sourceOf(this.projectId, index).readMany(node.segs.map(s => [s[0], s[1]]))
      const data = await new Promise((resolve, reject) => {
        const id = this.nextJob++
        this.jobs.set(id, { resolve, reject })
        const copies = bytes.map(b => b.slice())
        this.workers[id % this.workers.length].postMessage({
          type: 'tile', id, preCrs: cloud.place.preCrs, origin: cloud.place.preOrigin, tx: node.tx, ty: node.ty,
          segs: node.segs.map(s => [s[2], s[3]]), bytes: copies,
          cloud: {
            crs: index.crs, grid: index.grid, perMetre: index.perMetre, tileSize: index.tileSize,
            rgb: index.rgb, intensityShift: index.intensityShift,
          },
        }, copies.map(c => c.buffer))
      })
      // Moved to another pre plane meanwhile: these points are of the old one.
      if (samePre(cloud.place, placed)) this.addPoints(node, data)
    } catch (err) {
      node.failed = true
      console.error('tile did not load', err)
    } finally {
      this.loading.delete(node)
      this.needSelect = true
      this.pump()
    }
  }

  decoded(data) {
    const job = this.jobs.get(data.id)
    if (!job) return
    this.jobs.delete(data.id)
    if (data.type === 'error') job.reject(new Error(data.message))
    else job.resolve(data)
  }

  addPoints(node, { count, position, color, intensity }) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(position, 3))
    g.setAttribute('intensity', new THREE.BufferAttribute(intensity, 1, true))
    if (color) g.setAttribute('color', new THREE.BufferAttribute(color, 3, true))
    const cloud = this.clouds.find(c => c.key === node.cloud)
    this.bound(g, node, cloud)
    const points = new THREE.Points(g, pointMaterial())
    points.userData = { node, low: pickLowMaterial(), count }
    points.visible = false
    points.matrixAutoUpdate = false
    points.matrix.copy(cloud.model)
    points.matrixWorldNeedsUpdate = true
    this.heightsFrom(node, position, count)
    this.look(node, points)
    this.pointsGroup.add(points)
    this.loaded.set(node, { points, lastDrawn: 0 })
  }

  /**
   * The height range the colouring by height spans, per cloud: the 2nd to the
   * 98th percentile of the coarsest tiles' points — a bird or a crane above
   * the track does not wash the ramp out.
   */
  heightsFrom(node, position, count) {
    const cloud = this.clouds.find(c => c.key === node.cloud)
    if (!cloud.roots.includes(node)) return
    const step = Math.max(1, Math.floor(count / 2000))
    for (let i = 0; i < count; i += step) cloud.zSamples.push(position[3 * i + 2])
    const z = [...cloud.zSamples].sort((a, b) => a - b)
    cloud.zRange = [z[Math.floor(z.length * 0.02)], z[Math.min(z.length - 1, Math.floor(z.length * 0.98))]]
    for (const [n, entry] of this.loaded) if (n.cloud === cloud.key) this.look(n, entry.points)
  }

  pump() {
    while (this.loading.size < PARALLEL_LOADS && this.queue.length) {
      const node = this.queue.shift()
      if (!this.loaded.has(node) && !this.loading.has(node) && !node.failed) this.load(node)
    }
  }

  /** Choose the tiles to draw and to load. */
  select() {
    this.camera.updateMatrixWorld()
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse))
    const pos = this.camera.position
    const { draw, load, points } = selectNodes(this.clouds.filter(c => c.visible).flatMap(c => c.roots), {
      visible: (n) => frustum.intersectsBox(n.view),
      distance: (n) => n.view.distanceToPoint(pos),
      projScale: this.projScale,
      isLoaded: (n) => this.loaded.has(n),
      budget: this.options.budget,
      threshold: 1,
    })
    const t = performance.now()
    const drawSet = new Set(draw)
    for (const [node, entry] of this.loaded) {
      const on = drawSet.has(node)
      entry.points.visible = on
      if (on) entry.lastDrawn = t
    }
    this.drawn = draw.map(n => this.loaded.get(n).points)
    this.queue = load.filter(n => !this.loading.has(n) && !n.failed)
    this.pump()
    this.evict(drawSet)
    this.dirty = true
    this.onStatus({ points, tiles: draw.length, loading: this.loading.size + this.queue.length })
  }

  /** Free the graphics memory of tiles long not drawn once more than twice the budget is loaded. */
  evict(drawSet) {
    let total = 0
    for (const { points } of this.loaded.values()) total += points.userData.count
    if (total <= 2 * this.options.budget) return
    const old = [...this.loaded].filter(([n]) => !drawSet.has(n)).sort((a, b) => a[1].lastDrawn - b[1].lastDrawn)
    for (const [node, { points }] of old) {
      if (total <= 1.5 * this.options.budget) break
      total -= points.userData.count
      this.pointsGroup.remove(points)
      points.geometry.dispose()
      points.material.dispose()
      points.userData.low.dispose()
      this.loaded.delete(node)
    }
  }

  // ── drawing ──────────────────────────────────────────────────────────────────

  get projScale() {
    const h = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y
    return h / (2 * Math.tan(this.camera.fov * Math.PI / 360))
  }

  resize() {
    const box = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect()
    const w = Math.max(1, Math.floor(box.width)), h = Math.max(1, Math.floor(box.height))
    this.renderer.setSize(w, h, false)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.target?.dispose()
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType),
    })
    this.edl.material.uniforms.uTexel.value.set(1 / size.x, 1 / size.y)
    for (const [node, entry] of this.loaded) this.look(node, entry.points)
    this.dirty = true
    this.needSelect = true
  }

  tick = (now) => {
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.stepWalk(dt)
    if (this.needSelect && now - this.lastSelect > SELECT_EVERY) {
      this.needSelect = false
      this.lastSelect = now
      this.select()
    }
    if (this.dirty) {
      this.dirty = false
      this.render()
    }
  }

  render() {
    const cam = this.camera
    // The near plane follows the distance to what is looked at: depth keeps
    // its precision from a metre away to the whole delivery.
    const d = this.walk ? 2 : cam.position.distanceTo(this.controls.target)
    cam.near = Math.max(0.05, Math.min(5, d / 500))
    cam.updateProjectionMatrix()
    const r = this.renderer
    if (this.options.edl) {
      r.setRenderTarget(this.target)
      r.setClearColor('#1d1f27', 1)
      r.clear()
      r.render(this.scene, cam)
      r.setRenderTarget(null)
      const u = this.edl.material.uniforms
      u.tColor.value = this.target.texture
      u.tDepth.value = this.target.depthTexture
      u.uNear.value = cam.near
      u.uFar.value = cam.far
      u.uStrength.value = this.options.edlStrength
      r.render(this.edl.scene, this.edl.camera)
    } else {
      r.setRenderTarget(null)
      r.setClearColor('#1d1f27', 1)
      r.render(this.scene, cam)
    }
  }

  // ── picking (AP 13.11) ────────────────────────────────────────────────────────

  /**
   * The point drawn nearest to (x, y) [CSS px on the canvas], within
   * PICK_RADIUS: `{ node, index, position }` with position relative to the
   * origin — or null. Two passes over a small window around the click: the
   * tile and the upper bits of the point's index, then its lowest byte.
   */
  pickAt(x, y) {
    if (!this.drawn.length) return null
    const r = this.renderer, cam = this.camera
    const dpr = r.getPixelRatio()
    const full = r.getDrawingBufferSize(new THREE.Vector2())
    const size = 2 * PICK_RADIUS + 1
    const px = Math.round(x * dpr), py = Math.round(y * dpr)
    cam.setViewOffset(full.x, full.y, px - PICK_RADIUS, py - PICK_RADIUS, size, size)
    cam.layers.set(0)
    const pass = (low) => {
      this.drawn.forEach((p, i) => {
        if (low) { p.userData.look = p.material; p.material = p.userData.low } else p.material.uniforms.uPickId.value = i + 1
      })
      r.setRenderTarget(this.pick.target)
      r.setClearColor(0x000000, 0)
      r.clear()
      r.render(this.scene, cam)
      const out = new Uint8Array(size * size * 4)
      r.readRenderTargetPixels(this.pick.target, 0, 0, size, size, out)
      this.drawn.forEach((p) => {
        if (low) p.material = p.userData.look
        else p.material.uniforms.uPickId.value = 0
      })
      return out
    }
    const high = pass(false), low = pass(true)
    cam.clearViewOffset()
    cam.layers.enable(1)
    r.setRenderTarget(null)
    this.dirty = true
    let best = null
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const k = 4 * (j * size + i)
        const tile = (high[k] << 4) | (high[k + 1] >> 4)
        if (!tile) continue
        const d = (i - PICK_RADIUS) ** 2 + (j - PICK_RADIUS) ** 2
        if (d > PICK_RADIUS ** 2 || (best && d >= best.d)) continue
        best = { d, tile, index: ((high[k + 1] & 15) << 16) | (high[k + 2] << 8) | low[k] }
      }
    }
    if (!best) return null
    const points = this.drawn[best.tile - 1]
    if (!points || best.index >= points.userData.count) return null
    const a = points.geometry.attributes.position
    const at = new THREE.Vector3(a.getX(best.index), a.getY(best.index), a.getZ(best.index)).applyMatrix4(points.matrix)
    return { node: points.userData.node, index: best.index, position: [at.x, at.y, at.z] }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
    this.canvas.removeEventListener('dblclick', this.onDblClick)
    this.resizeObserver.disconnect()
    for (const w of this.workers) w.terminate()
    this.controls.dispose()
    for (const { points } of this.loaded.values()) {
      points.geometry.dispose()
      points.material.dispose()
      points.userData.low.dispose()
    }
    this.target?.dispose()
    this.pick.target.dispose()
    this.renderer.dispose()
  }
}
