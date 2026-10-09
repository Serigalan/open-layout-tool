import { axisPointsCsv } from '../../../utils/pointCloud/railTrace'
import { downloadText } from '../../../utils/fileUtils'

/** What the top of rail of an exported point is (Entscheidung 130). */
export const SO_REFERENCES = ['lower', 'axis', 'left', 'right']

const fileSafe = (text) => String(text).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'Gleis'

/** A point file of axis points, named after what they are and the plane they lie in. */
export function exportAxisPoints(points, { name, epsg, soReference }) {
  downloadText(axisPointsCsv(points, { soReference }), `Gleisachse_${fileSafe(name)}_EPSG${epsg}.csv`, 'text/csv')
}
