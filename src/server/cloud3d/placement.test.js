import { describe, it, expect } from 'vitest'
import { cloudPlacement, modelMatrix, invertAffine, multiply } from './placement'
import { transformMatrix, applyMatrix, IDENTITY } from '../../core/utils/pointCloud/registration'
import { cloudToPlane } from '../../core/utils/pointCloud/cloudCrs'

const bounds = { minE: 4467500, maxE: 4467700, minN: 5333650, maxN: 5333750, minZ: 500, maxZ: 515 }
const T = { id: 7, matrix: transformMatrix({ tE: 0.3, tN: -0.1, tH: 0.05, kappa: 0.0008 }, [4467600, 5333700, 507]), crs: 5678 }

describe('where a cloud is drawn in 3D (AP 13.13)', () => {
  it('without re-referencing: the view plane itself, nothing turned', () => {
    const p = cloudPlacement({ crs: 5678, bounds }, 5678)
    expect(p.preCrs).toBe(5678)
    expect(p.matrix).toEqual(IDENTITY)
    expect(p.toView(4467600, 5333700, 507)).toEqual([4467600, 5333700, 507])
  })

  it('through its transformation, as the cross section reads it, and back', () => {
    const index = { crs: 5678, bounds, transform: T }
    const p = cloudPlacement(index, 5678)
    const read = cloudToPlane(index, 5678)
    for (const q of [[4467510, 5333660, 501], [4467690, 5333745, 514]]) {
      p.toView(...q).forEach((v, i) => expect(v).toBeCloseTo(read(...q)[i], 6))
      p.toFile(...p.toView(...q)).forEach((v, i) => expect(v).toBeCloseTo(q[i], 6))
    }
  })

  it('a cloud in a local system is drawn by its transformation alone', () => {
    const local = { crs: null, bounds: { minE: -50, maxE: 50, minN: -20, maxN: 20, minZ: -2, maxZ: 8 } }
    const toWorld = { matrix: transformMatrix({ tE: 4467600, tN: 5333700, tH: 507, kappa: 1.1 }, [0, 0, 0]), crs: 5678 }
    const p = cloudPlacement(local, 5678, toWorld)
    expect(p.preCrs).toBeNull()
    p.toView(10, 5, 1).forEach((v, i) => expect(v).toBeCloseTo(applyMatrix(toWorld.matrix, [10, 5, 1])[i], 6))
  })

  it('the model matrix takes points relative to the pre origin to points relative to the view origin', () => {
    const p = cloudPlacement({ crs: 5678, bounds, transform: T }, 5678)
    const origin = [4467520, 5333730, 503]
    const m = modelMatrix(p, origin)
    const q = [4467640.123, 5333711.456, 508.789]
    const rel = applyMatrix(m, q.map((v, i) => v - p.preOrigin[i]))
    rel.forEach((v, i) => expect(v + origin[i]).toBeCloseTo(p.toView(...q)[i], 6))
    multiply(m, invertAffine(m)).forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], 9))
  })
})
