// ── Panel menu icons ────────────────────────────────────────────────────────
//
// One rule for every icon a panel button carries (AP 4.3): 16 × 16, currentColor,
// one stroke width (1.5), one node radius (1.5) — and a drawing that stays
// inside the box, nodes fully visible. The rule lives on the svg root and in
// IconNode, not in each drawing: a drawing states its geometry and nothing
// else. The sidebar icons below are white on the primary colour and keep their
// own sizes; these follow the button wherever it renders them. The rule is
// enforced by icons.test.js over every icon named there.

const MENU_ICON_SIZE = 16
const MENU_ICON_STROKE = 1.5
const MENU_ICON_NODE = 1.5

// A filled node — the endpoint of a route. No stroke of its own: the stroke
// width belongs to the line that ends here, not to the dot marking it. A
// secondary route (a parallel being created) keeps the same radius and says
// so with opacity alone.
const IconNode = ({ cx, cy, opacity }) => (
  <circle cx={cx} cy={cy} r={MENU_ICON_NODE} fill="currentColor" opacity={opacity} />
)

const MenuIcon = ({ children }) => (
  <svg width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} viewBox={`0 0 ${MENU_ICON_SIZE} ${MENU_ICON_SIZE}`}
    fill="none" stroke="currentColor" strokeWidth={MENU_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round"
  >
    {children}
  </svg>
)

// The back button every panel carries — one drawing instead of five copies of
// the same one.
export const BackIcon = () => (
  <MenuIcon>
    <path d="M10 3 L5 8 L10 13" />
  </MenuIcon>
)

// Create element panel
export const CreateLineIcon = () => (
  <MenuIcon>
    <path d="M8 14 V2" />
    <IconNode cx={8} cy={14} />
    <IconNode cx={8} cy={2} />
  </MenuIcon>
)

export const CreateArcIcon = () => (
  <MenuIcon>
    <path d="M2 14 A12 12 0 0 1 14 2" />
    <IconNode cx={2} cy={14} />
    <IconNode cx={14} cy={2} />
  </MenuIcon>
)

// A parallel element: the existing one solid, the one being created as the
// ghost below it.
export const CreateParallelIcon = () => (
  <MenuIcon>
    <path d="M2 5 H14" />
    <path d="M2 11 H14" opacity="0.55" />
    <IconNode cx={2} cy={5} />
    <IconNode cx={14} cy={5} />
    <IconNode cx={2} cy={11} opacity="0.55" />
    <IconNode cx={14} cy={11} opacity="0.55" />
  </MenuIcon>
)

// A parallel track: a chain of elements (the joint is a node) and its ghost.
export const CreateParallelTrackIcon = () => (
  <MenuIcon>
    <path d="M2 5 L8 5 L14 3.5" />
    <path d="M2 11 L8 11 L14 9.5" opacity="0.55" />
    <IconNode cx={2} cy={5} />
    <IconNode cx={8} cy={5} />
    <IconNode cx={14} cy={3.5} />
    <IconNode cx={2} cy={11} opacity="0.55" />
    <IconNode cx={8} cy={11} opacity="0.55" />
    <IconNode cx={14} cy={9.5} opacity="0.55" />
  </MenuIcon>
)

// Connect element panel — the piece that joins two existing ends.
export const ConnectStraightIcon = () => (
  <MenuIcon>
    <path d="M8 14 V2" />
    <IconNode cx={8} cy={14} />
    <IconNode cx={8} cy={2} />
  </MenuIcon>
)

export const ConnectCurvedIcon = () => (
  <MenuIcon>
    <path d="M2 14 A10 10 0 0 1 11 5" />
    <IconNode cx={2} cy={14} />
    <IconNode cx={11} cy={5} />
  </MenuIcon>
)

// Connect switch panel
export const SwitchStraightIcon = () => (
  <MenuIcon>
    <path d="M4 14 V2" />
    <path d="M4 14 A10 10 0 0 1 12 4" />
    <IconNode cx={4} cy={14} />
    <IconNode cx={4} cy={2} />
    <IconNode cx={12} cy={4} />
  </MenuIcon>
)

// A curved turnout: both routes leave curved, into opposite directions.
export const SwitchCurvedIcon = () => (
  <MenuIcon>
    <path d="M6 14c.134-4.828 1.5-7.665 6-10" />
    <path d="M6 14C5.374 8.763 4.261 5.673 2 2" />
    <IconNode cx={6} cy={14} />
    <IconNode cx={12} cy={4} />
    <IconNode cx={2} cy={2} />
  </MenuIcon>
)

// A turnout laid into an existing track: the track runs through, the branch
// leaves it.
export const SwitchOnTrackIcon = () => (
  <MenuIcon>
    <path d="M1 11 H15" />
    <path d="M6 11 L14.475 4.265" />
    <IconNode cx={6} cy={11} />
  </MenuIcon>
)

// A switch connection: two branches, joined by a middle element — the S.
export const SwitchConnectionIcon = () => (
  <MenuIcon>
    <path d="M2 13 A6 6 0 0 1 8 8 A6 6 0 0 0 14 3" />
    <IconNode cx={2} cy={13} />
    <IconNode cx={14} cy={3} />
  </MenuIcon>
)

// Edit element panel
export const EditLengthIcon = () => (
  <MenuIcon>
    <path d="M8 2 V14 M5 2 H11 M5 14 H11" />
  </MenuIcon>
)

export const DeleteElementIcon = () => (
  <MenuIcon>
    <path d="M3 4 H13 M6 4 V2 H10 V4 M5 4 V13 H11 V4" />
  </MenuIcon>
)

export const EditTracksIcon = () => (
  <MenuIcon>
    <path d="M2 4 Q5 2 8 4 Q11 6 14 4" />
    <path d="M2 9 Q5 7 8 9 Q11 11 14 9" />
  </MenuIcon>
)

// The only shapes in the set that fill instead of stroke: bars read as rows
// of properties, and a stroked bar at this size is a hollow box.
export const EditPropertiesIcon = () => (
  <MenuIcon>
    <rect x="2" y="4" width="12" height="2" rx="1" fill="currentColor" stroke="none" />
    <rect x="2" y="8" width="8" height="2" rx="1" fill="currentColor" stroke="none" />
    <rect x="2" y="12" width="10" height="2" rx="1" fill="currentColor" stroke="none" />
  </MenuIcon>
)

export const ChangeDirectionIcon = () => (
  <MenuIcon>
    <path d="M2 5 H11 M8 2 L11 5 L8 8" />
    <path d="M14 11 H5 M8 8 L5 11 L8 14" />
  </MenuIcon>
)

export const DeleteTrackIcon = () => (
  <MenuIcon>
    <path d="M3 4 H13 M6 4 V2 H10 V4 M5 4 V13 H11 V4" />
  </MenuIcon>
)

// A switch being deleted: the route that stays, the branch that goes, and the
// cross that says so.
export const DeleteSwitchIcon = () => (
  <MenuIcon>
    <path d="M2 12 H14 M6 12 Q10 12 14 6" />
    <path d="M3 3 L7 7 M7 3 L3 7" />
  </MenuIcon>
)

// Optimize track panel — the alignment as it is, and the optimized variant as
// the dashed ghost of it.
export const OptimizeTrackModeIcon = () => (
  <MenuIcon>
    <path d="M1 15 Q2 6 8 3 Q12 1 15 1" />
    <path d="M3.5 15 Q4.5 8.5 9 5.5 Q12 3.8 15 3.8" strokeDasharray="2.5 1.5" opacity="0.6" />
  </MenuIcon>
)

export const OptimizeElementModeIcon = () => (
  <MenuIcon>
    <path d="M2 14 A12 12 0 0 1 14 2" />
    <path d="M4.5 13 A10.5 10.5 0 0 1 13 4.5" strokeDasharray="2 1.5" opacity="0.6" />
    <IconNode cx={2} cy={14} />
    <IconNode cx={14} cy={2} />
  </MenuIcon>
)

// The two crossing kinds AP 3.2/3.3 will place — drawn ahead of the geometry,
// so the panels that place them reach for an icon instead of a placeholder.
// A crossing is two routes that cross, one node per port. A crossing switch is
// that crossing with a slip route joining the two ends on each side of it —
// the double-slip drawing; the single slip is it with one bow left out.
export const CrossingIcon = () => (
  <MenuIcon>
    <path d="M2 2 L14 14" />
    <path d="M14 2 L2 14" />
    <IconNode cx={2} cy={2} />
    <IconNode cx={14} cy={14} />
    <IconNode cx={14} cy={2} />
    <IconNode cx={2} cy={14} />
  </MenuIcon>
)

export const CrossingSwitchIcon = () => (
  <MenuIcon>
    <path d="M2 2 L14 14" />
    <path d="M14 2 L2 14" />
    <path d="M2 2 Q8 6 14 2" />
    <path d="M2 14 Q8 10 14 14" />
    <IconNode cx={2} cy={2} />
    <IconNode cx={14} cy={14} />
    <IconNode cx={14} cy={2} />
    <IconNode cx={2} cy={14} />
  </MenuIcon>
)

// A crossing laid into an existing track: the track runs through it, the cross
// route crosses it — the crossing kinds' counterpart of the turnout on a track.
export const CrossingOnTrackIcon = () => (
  <MenuIcon>
    <path d="M1 8 H15" />
    <path d="M4 2 L12 14" />
    <IconNode cx={8} cy={8} />
  </MenuIcon>
)

// A basemap preview, not a menu icon: it shows the overlays in the colours
// they are drawn in on the map, so it carries those colours instead of
// currentColor and its own frame. It lives here for the same reason as every
// other drawing — the panels compose, they do not draw.
export const OverlayThumbnail = ({ kmColor, kmOtherColor, kmJumpColor }) => (
  <svg className="basemap-thumbnail" viewBox="0 0 60 45" aria-hidden="true">
    <rect width="60" height="45" fill="#f4f4f6" />
    <line x1="5" y1="41" x2="55" y2="23" stroke={kmOtherColor ?? '#78716c'} strokeWidth="1.4" strokeDasharray="3 2" />
    <line x1="5" y1="29" x2="55" y2="9" stroke={kmColor ?? '#0f766e'} strokeWidth="1.6" />
    {[[5, 29], [17.5, 24], [42.5, 14], [55, 9]].map(([x, y]) => (
      <circle key={x} cx={x} cy={y} r="1.9" fill={kmColor ?? '#0f766e'} stroke="#fff" strokeWidth="0.7" />
    ))}
    <circle cx="30" cy="19" r="2.4" fill={kmJumpColor ?? '#b3261e'} stroke="#fff" strokeWidth="0.8" />
  </svg>
)

export const LayerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path d="M12 2L2 7l10 5 10-5-10-5z" fill="white" opacity="0.9"/>
    <path d="M2 12l10 5 10-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 17l10 5 10-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
  </svg>
)

export const PlaceIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="14" r="2" fill="white"/>
    <path d="M8 14 V2" stroke="white" strokeWidth="1.5"/>
    <circle cx="8" cy="2" r="2" fill="white"/>
  </svg>
)

export const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="3" stroke="white" strokeWidth="2"/>
    <path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
)

export const HomeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="white" viewBox="0 0 16 16">
    <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L2 8.207V13.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V8.207l.646.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293zM13 7.207V13.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.207l5-5z"/>
  </svg>
)

export const EditElementIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export const DataExchangeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M12 3v12M7 11l5 5 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 20h14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

export const ConnectElementIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="14" r="2" fill="white"/>
    <path d="M8 14 V8" stroke="white" strokeWidth="1.5"/>
    <circle cx="8" cy="5" r="0.5" fill="white"/>
    <circle cx="8" cy="2" r="0.5" fill="white"/>
  </svg>
)

export const LogoIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" xmlSpace="preserve" viewBox="0 0 135.65 136.98" className={className}>
    <defs>
      <clipPath id="b"><path d="M-1347.3 1737.07h1920V-923.35h-1920Z"/></clipPath>
      <filter id="a" width="1.06" height="1.06" x="-.03" y="-.03" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="1.593"/></filter>
    </defs>
    <rect width="128" height="128" x="3.824" y="5.157" filter="url(#a)" opacity=".187" ry="16.444"/>
    <path fill="#fff" d="M0 0h78.915l19.771-26.296 3.25-19.276v-45.82l-47.735-34.352H-.169l-23.64 28.814v52.564z" clipPath="url(#b)" transform="matrix(1.0179 0 0 -1.0179 28.06 0)"/>
    <path fill="currentColor" d="M46.824 93.076c-2.117 9.151-3.23 18.972-3.23 29.574v5.357h18.492c-3.231-14.731-8.801-26.115-15.262-34.931zM3.823 64.172V86.38a70.557 70.557 0 0 1 10.583 5.134c9.47 5.803 16.71 14.061 21.612 24.328V81.246c-3.788-3.348-7.687-6.138-11.474-8.37-7.241-4.24-14.37-6.919-20.72-8.704zm39.659 13.726C48.272 65.4 55.29 54.462 64.648 45.2V.002H43.482zm5.904 6.25c5.904 6.92 11.251 15.4 15.262 26.003V56.36c-6.684 8.035-11.809 17.298-15.262 27.788zM116.003.002H72.112v38.502c13.145-10.49 27.515-16.182 39.658-19.307 2.005-.558 4.122.67 4.567 2.678.557 2.009-.668 4.018-2.673 4.576-12.7 3.236-28.184 9.597-41.441 21.985v35.489c3.23-7.031 7.464-13.057 12.7-18.303 10.471-10.378 23.394-15.735 33.977-18.525 2.005-.558 4.121.67 4.567 2.678.557 2.009-.668 4.018-2.674 4.576-5.235 1.339-11.251 3.46-17.044 6.696C82.583 72.542 72.334 92.74 72.334 122.65v5.357h43.78c8.69 0 15.708-7.031 15.708-15.736V15.737c-.111-8.705-7.13-15.735-15.819-15.735zM28.331 66.515c2.451 1.451 5.013 3.125 7.576 5.134V.002H19.53c-8.69 0-15.708 7.03-15.708 15.735V56.36c7.353 1.785 15.93 4.91 24.508 10.155zM9.839 97.652c-2.005-1.228-4.01-2.232-6.016-3.125v17.744c0 8.705 7.019 15.736 15.708 15.736h12.922c-4.01-13.615-11.585-23.883-22.614-30.355z"/>
  </svg>
)

export const ConnectSwitchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <circle cx="4" cy="14" r="2" fill="white"/>
    <path d="M4 14 V2" stroke="white" strokeWidth="1.5"/>
    <circle cx="4" cy="2" r="2" fill="white"/>
    <path d="M4 14 A10 10 0 0 1 12 4" fill="none" stroke="white" strokeWidth="1.5"/>
    <circle cx="12" cy="4" r="2" fill="white"/>
  </svg>
)

// The crossing panel's counterpart: two routes that cross instead of part,
// one node per port.
export const ConnectCrossingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <path d="M2 14 L14 2" stroke="white" strokeWidth="1.5"/>
    <path d="M2 2 L14 14" stroke="white" strokeWidth="1.5"/>
    <circle cx="2" cy="14" r="2" fill="white"/>
    <circle cx="14" cy="2" r="2" fill="white"/>
    <circle cx="2" cy="2" r="2" fill="white"/>
    <circle cx="14" cy="14" r="2" fill="white"/>
  </svg>
)

export const OptimizeTrackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <path d="M1 15 Q2 6 8 3 Q12 1 15 1" fill="none" stroke="white" strokeWidth="1.5"/>
    <path d="M3.5 15 Q4.5 8.5 9 5.5 Q12 3.8 15 3.8" fill="none" stroke="white" strokeWidth="1.2" strokeDasharray="2.5 1.5" opacity="0.85"/>
  </svg>
)

export const SpliceElementIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <path d="M5 16 V11" stroke="white" strokeWidth="1.5"/>
    <circle cx="5" cy="11" r="2" fill="white"/>
    <path d="M5 11 A6 6 0 0 1 11 5" fill="none" stroke="white" strokeWidth="1.5"/>
    <circle cx="11" cy="5" r="2" fill="white"/>
    <path d="M11 5 H16" stroke="white" strokeWidth="1.5"/>
  </svg>
)

export const ExternalLinkIcon = ({ color = 'currentColor', size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="15 3 21 3 21 9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="10" y1="14" x2="21" y2="3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export const UndoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 454.839 454.839" fill="white">
    <path d="M404.908,283.853c0,94.282-76.71,170.986-170.986,170.986h-60.526c-10.03,0-18.158-8.127-18.158-18.157v-6.053c0-10.031,8.127-18.158,18.158-18.158h60.526c70.917,0,128.618-57.701,128.618-128.618c0-70.917-57.701-128.618-128.618-128.618H122.255l76.905,76.905c8.26,8.257,8.26,21.699,0,29.956c-8.015,8.009-21.964,7.997-29.961,0L56.137,149.031c-4.001-4.001-6.206-9.321-6.206-14.981c0-5.656,2.205-10.979,6.206-14.978L169.205,6.002c7.997-8.003,21.958-8.003,29.956,0c8.26,8.255,8.26,21.699,0,29.953l-76.905,76.911h111.666C328.198,112.866,404.908,189.573,404.908,283.853z"/>
  </svg>
)

export const InfoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2"/>
    <line x1="12" y1="8" x2="12" y2="8" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="12" y1="12" x2="12" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

export const PlanExportIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M6 2 H14 L19 7 V22 H6 Z" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M14 2 V7 H19" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M9 13 L12 16 L16 11" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export const PlatformIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="3" width="18" height="8" rx="1" stroke="white" strokeWidth="2"/>
    <path d="M8 3 L4 11 M13 3 L9 11 M18 3 L14 11" stroke="white" strokeWidth="1.2" opacity="0.85"/>
    <path d="M2 16 H22 M2 20 H22" stroke="white" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

export const CrossSectionIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M12 3 L20 8 V16 L12 21 L4 16 V8 Z" stroke="white" strokeWidth="1.6" strokeLinejoin="round" opacity="0.85"/>
    <path d="M3 17 H21" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 17 V14 M16 17 V14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

export const ElevationIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M3 20 H21" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    <path d="M3 16 L8 11 L12 13 L17 6 L21 9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="8" cy="11" r="1.7" fill="white"/>
    <circle cx="12" cy="13" r="1.7" fill="white"/>
    <circle cx="17" cy="6" r="1.7" fill="white"/>
  </svg>
)
