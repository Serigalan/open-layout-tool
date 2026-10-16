// crossSection — the cross section of a track at a station: running plane,
// superstructure and the clearance contours of DB Ril 800.0130.
//
// This file is the module's public face: code outside src/core/utils/crossSection/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/crossSection.md.

export {
  cantAngle, cantPivot, crossSection, DEFAULT_RAIL, DEFAULT_SLEEPER, fitSection, placeSection,
  PLANUM_EDGE, platformSection, RAILS, rotatePoint, RUNNING_CIRCLE_DISTANCE, sectionAtStation,
  sectionLevels, sectionLinePoints, sectionNeighbours, sectionOrigin, SLEEPERS, superstructureAt,
  TRACK_GAUGE,
} from './crossSectionUtils'
export {
  DEFAULT_GAUGE_PROFILE, GAUGE_PROFILES, gaugeProfile, gaugeProfileAreas, gaugeProfileLabelKey,
  gaugeProfileRing, LICHTRAUM_SOURCE, QUERSCHNITT_KATALOG,
} from './gaugeProfiles'
