import { utmToWgs84 } from '../../../utils/coordinateUtils'

// Helper: UTM object → WGS84 array for map display
export const toWgs = (utm) => utmToWgs84(utm.easting, utm.northing, utm.zone)
