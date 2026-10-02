// ── Panel menu icons ────────────────────────────────────────────────────────
//
// One rule for every icon a panel button carries (AP 4.3): 16 × 16, currentColor,
// one stroke width (1.5), one node radius (1.5) — and a drawing that stays
// inside the box, nodes fully visible. The rule lives on the svg root and in
// IconNode, not in each drawing: a drawing states its geometry and nothing
// else. The sidebar icons below follow a rule of their own (SidebarIcon);
// these follow the button wherever it renders them. Both rules are enforced by
// icons.test.js over every icon named there.

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

// A buffer stop at the end of a track: the track up to the buffer face, the
// bar across it, the body behind, and the brake length beyond, fainter.
export const BufferStopIcon = () => (
  <MenuIcon>
    <path d="M2 8 H8" />
    <path d="M8 4 V12" />
    <path d="M8 6 H11 V10 H8" />
    <path d="M11 8 H14" opacity="0.55" />
    <IconNode cx={2} cy={8} />
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

// Tracks gathered under one line or station: the bracket that holds them.
export const AssignTracksIcon = () => (
  <MenuIcon>
    <path d="M4 3 H2 V13 H4" />
    <path d="M7 4 H14 M7 8 H14 M7 12 H14" />
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

// Physics — "v²", MathJax's own render of it, exactly as handed over for this
// button. Not a MenuIcon: a formula glyph is filled type, not a 16×16 stroke
// drawing, and forcing it into that mould would have stopped it looking like
// the thing it names. Exempted from the AP 4.3 rule in icons.test.js the same
// way OverlayThumbnail is — sized in `ex`, so it scales with the button's own
// font-size instead of carrying a fixed pixel size against it.
export const PhysicsIcon = () => (
  <svg width="2.085ex" height="2.025ex" viewBox="0 -883.9 921.6 894.9" aria-hidden="true"
    style={{ verticalAlign: '-.025ex', color: 'currentcolor' }}>
    <g stroke="currentColor" fill="currentColor" strokeWidth={0}>
      <g stroke="none">
        <path d="M173-380q0-25-19-25-24 0-50 29t-43 89q-1 1-2 3t-1 3-2 2-3 1-4 0-8 0H27q-6-6-6-9 0-7 8-29t24-52 44-51 63-22q42 0 65 24t24 56q0 17-3 26 0 6-15 44t-31 89-18 89q0 27 5 44 13 43 63 43 37 0 69-34t50-79 29-83 11-55q0-23-8-40t-18-26-18-18-8-22q0-22 19-41t41-19q19 0 34 18t16 58q0 27-12 83t-37 125-71 119-106 51q-64 0-102-33-37-32-37-95 0-31 8-64t41-117q22-64 22-82" />
        <path d="M595.063-716.303q-19.089 0-30.401-12.726t-11.312-31.108q0-50.197 37.471-86.961t93.324-36.764q64.337 0 107.464 39.592t43.834 102.515q0 30.401-14.14 57.974t-33.936 48.076-56.56 52.318q-25.452 21.917-70.7 65.044l-41.713 39.592 53.732.707q110.999 0 118.069-3.535 4.949-1.414 16.968-62.923v-2.121h28.28v2.121q-.707 2.121-9.191 64.337t-10.605 65.044V-413H553.35v-21.917q0-4.949 4.242-10.605t21.21-24.745q20.503-22.624 35.35-39.592 6.363-7.07 24.038-26.159t24.038-26.159 20.503-23.331 19.796-24.038 16.261-21.21 14.847-22.624 10.605-20.503 9.191-22.624 4.949-21.21 2.121-23.331q0-44.541-24.038-77.063t-68.579-32.522q-23.331 0-41.006 12.019t-24.745 23.331-7.07 13.433q0 .707 3.535.707 12.726 0 26.159 9.898t13.433 32.522q0 17.675-11.312 29.694t-31.815 12.726" />
      </g>
    </g>
  </svg>
)

// Regelwerk — "§", MathJax's own render of it. Same exemption as PhysicsIcon,
// for the same reason: a set typeface character, not a stroke drawing.
export const RegelwerkIcon = () => (
  <svg width="1ex" height="2.149ex" viewBox="0 -750 442 950" aria-hidden="true"
    style={{ verticalAlign: '-.452ex', color: 'currentcolor' }}>
    <g stroke="currentColor" fill="currentColor" strokeWidth={0}>
      <text fontSize={884} fontFamily="serif">§</text>
    </g>
  </svg>
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

// A link: two track ends and the node between them. The gap is the drawing —
// a link has no length, and nothing runs between the ends but the node itself.
export const SwitchLinkIcon = () => (
  <MenuIcon>
    <path d="M1 8 H5" />
    <path d="M11 8 H15" />
    <IconNode cx={8} cy={8} />
  </MenuIcon>
)

// Two elements joined by an arc — the splice tool's menu button, the menu
// counterpart of the sidebar's SpliceElementIcon.
export const SpliceJoinIcon = () => (
  <MenuIcon>
    <path d="M4 15 V11 A7 7 0 0 1 11 4 H15" />
    <IconNode cx={4} cy={11} />
    <IconNode cx={11} cy={4} />
  </MenuIcon>
)

// A platform beside its track: the track above, the slab below.
export const NewPlatformIcon = () => (
  <MenuIcon>
    <path d="M1 4 H15" />
    <rect x="3" y="8" width="10" height="4" rx="1" fill="currentColor" stroke="none" />
  </MenuIcon>
)

// Where the cross section is taken: the track, and the dashed cut through it.
export const CrossSectionCutIcon = () => (
  <MenuIcon>
    <path d="M1 8 H15" />
    <path d="M8 2 V14" strokeDasharray="2.5 2" />
  </MenuIcon>
)

// A point cloud: survey points scattered over the ground line.
export const PointCloudIcon = () => (
  <MenuIcon>
    <path d="M1 14 H15" />
    {[[3, 10], [6, 6.5], [9.5, 9], [12.5, 4.5], [8, 3], [13, 11]].map(([cx, cy]) => (
      <IconNode key={`${cx},${cy}`} cx={cx} cy={cy} />
    ))}
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

// ── Sidebar icons ────────────────────────────────────────────────────────────
//
// One rule for the primary sidebar, the counterpart of the menu icon rule
// above: drawn on a 24 grid, shown at 20 px, one stroke width (2), round ends,
// nodes as filled dots of radius 2. White, because the sidebar and the info
// panel always put them on the primary colour.
const SIDEBAR_ICON_SIZE = 20
const SIDEBAR_ICON_STROKE = 2
const SIDEBAR_ICON_NODE = 2

const SidebarNode = ({ cx, cy }) => (
  <circle cx={cx} cy={cy} r={SIDEBAR_ICON_NODE} fill="currentColor" stroke="none" />
)

const SidebarIcon = ({ children }) => (
  <svg width={SIDEBAR_ICON_SIZE} height={SIDEBAR_ICON_SIZE} viewBox="0 0 24 24" color="white"
    fill="none" stroke="currentColor" strokeWidth={SIDEBAR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round"
  >
    {children}
  </svg>
)

// Layers — a folded map: the panel is first of all where the basemap is picked.
export const LayerIcon = () => (
  <SidebarIcon>
    <path d="M3 6 L9 3.5 L15 6 L21 3.5 V18 L15 20.5 L9 18 L3 20.5 Z" />
    <path d="M9 3.5 V18 M15 6 V20.5" />
  </SidebarIcon>
)

// Topology — as the diagram draws it: tracks as edges, the switch a circle.
export const TopologyIcon = () => (
  <SidebarIcon>
    <path d="M3 16 H8.5 M13.5 16 H21 M12.8 14.2 L19 6" />
    <circle cx="11" cy="16" r="2.5" />
    <SidebarNode cx={3} cy={16} />
    <SidebarNode cx={21} cy={16} />
    <SidebarNode cx={19} cy={6} />
  </SidebarIcon>
)

// Create element — an arc between its two nodes, and the cross that says new.
export const PlaceIcon = () => (
  <SidebarIcon>
    <path d="M4 20 Q6 9 20 8" />
    <SidebarNode cx={4} cy={20} />
    <SidebarNode cx={20} cy={8} />
    <path d="M6 2.5 V8.5 M3 5.5 H9" />
  </SidebarIcon>
)

// Settings — sliders, kept apart from the tool icons around them.
export const SettingsIcon = () => (
  <SidebarIcon>
    <path d="M3 6 H7 M11 6 H21 M3 12 H14 M18 12 H21 M3 18 H5 M9 18 H21" />
    <circle cx="9" cy="6" r="2" />
    <circle cx="16" cy="12" r="2" />
    <circle cx="7" cy="18" r="2" />
  </SidebarIcon>
)

// Home — the house as before, now as an outline: roof, chimney, body.
export const HomeIcon = () => (
  <SidebarIcon>
    <path d="M2 11.5 L12 3 L22 11.5" />
    <path d="M16 6.4 V3.5 H18.5 V8.5" />
    <path d="M5 9 V19.5 A1.5 1.5 0 0 0 6.5 21 H17.5 A1.5 1.5 0 0 0 19 19.5 V9" />
  </SidebarIcon>
)

export const EditElementIcon = () => (
  <SidebarIcon>
    <path d="M16.5 3.5 a2.3 2.3 0 0 1 3.25 3.25 L7.5 19 L2.5 20.5 L4 15.5 Z" />
    <path d="M14.5 5.5 L17.75 8.75" />
  </SidebarIcon>
)

// Data exchange — both ways: import and export.
export const DataExchangeIcon = () => (
  <SidebarIcon>
    <path d="M4 8 H20 M16 4 L20 8 L16 12" />
    <path d="M20 16 H4 M8 12 L4 16 L8 20" />
  </SidebarIcon>
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

// Switches — the through track, and the branch leaving it for the parallel one.
export const ConnectSwitchIcon = () => (
  <SidebarIcon>
    <path d="M2 18 H22" />
    <path d="M6 18 C11 18 12 8 17 8 H22" />
    <SidebarNode cx={6} cy={18} />
  </SidebarIcon>
)

// Splice — two offset track ends, and the dashed piece that will join them.
export const SpliceElementIcon = () => (
  <SidebarIcon>
    <path d="M2 18 H7 M17 6 H22" />
    <path d="M7 18 C12 18 12 6 17 6" strokeDasharray="2.5 2.6" />
    <SidebarNode cx={7} cy={18} />
    <SidebarNode cx={17} cy={6} />
  </SidebarIcon>
)

export const ExternalLinkIcon = ({ color = 'currentColor', size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="15 3 21 3 21 9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="10" y1="14" x2="21" y2="3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Language — Font Awesome Free 7.3.1 "language" (CC BY 4.0), filled, on the
// colour of whatever it sits in.
export const LanguageIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M192 64C209.7 64 224 78.3 224 96L224 128L352 128C369.7 128 384 142.3 384 160C384 177.7 369.7 192 352 192L342.4 192L334 215.1C317.6 260.3 292.9 301.6 261.8 337.1C276 345.9 290.8 353.7 306.2 360.6L356.6 383L418.8 243C423.9 231.4 435.4 224 448 224C460.6 224 472.1 231.4 477.2 243L605.2 531C612.4 547.2 605.1 566.1 589 573.2C572.9 580.3 553.9 573.1 546.8 557L526.8 512L369.3 512L349.3 557C342.1 573.2 323.2 580.4 307.1 573.2C291 566 283.7 547.1 290.9 531L330.7 441.5L280.3 419.1C257.3 408.9 235.3 396.7 214.5 382.7C193.2 399.9 169.9 414.9 145 427.4L110.3 444.6C94.5 452.5 75.3 446.1 67.4 430.3C59.5 414.5 65.9 395.3 81.7 387.4L116.2 370.1C132.5 361.9 148 352.4 162.6 341.8C148.8 329.1 135.8 315.4 123.7 300.9L113.6 288.7C102.3 275.1 104.1 254.9 117.7 243.6C131.3 232.3 151.5 234.1 162.8 247.7L173 259.9C184.5 273.8 197.1 286.7 210.4 298.6C237.9 268.2 259.6 232.5 273.9 193.2L274.4 192L64.1 192C46.3 192 32 177.7 32 160C32 142.3 46.3 128 64 128L160 128L160 96C160 78.3 174.3 64 192 64zM448 334.8L397.7 448L498.3 448L448 334.8z" />
  </svg>
)

export const UndoIcon = () => (
  <SidebarIcon>
    <path d="M9 14 L4 9 L9 4" />
    <path d="M4 9 H14.5 A5.5 5.5 0 0 1 14.5 20 H11" />
  </SidebarIcon>
)

export const InfoIcon = () => (
  <SidebarIcon>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 11 V17" />
    <circle cx="12" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
  </SidebarIcon>
)

// Plan export — the printer the drawing goes out through.
export const PlanExportIcon = () => (
  <SidebarIcon>
    <path d="M6 9 V3 H18 V9" />
    <path d="M6 18 H4 A2 2 0 0 1 2 16 V11 A2 2 0 0 1 4 9 H20 A2 2 0 0 1 22 11 V16 A2 2 0 0 1 20 18 H18" />
    <path d="M6 14 H18 V22 H6 Z" />
  </SidebarIcon>
)

// The merged platform and cross section panel: a cross section — the ballast
// bed with its two rails, and the platform beside it. Both faces tinted, the
// ballast stronger, so bed and platform read as two bodies.
export const StationIcon = () => (
  <SidebarIcon>
    <path d="M1.5 21 H22.5" />
    <path d="M3 21 L6 16 H13 L16 21" fill="currentColor" fillOpacity={0.5} />
    <rect x="7" y="13" width="2" height="3" fill="currentColor" stroke="none" />
    <rect x="10.5" y="13" width="2" height="3" fill="currentColor" stroke="none" />
    <path d="M17 21 V11 H22.5" />
    <rect x="17" y="11" width="5.5" height="10" fill="currentColor" fillOpacity={0.3} stroke="none" />
  </SidebarIcon>
)

// Elevation profile — the gradient over the ground line, its grade changes as
// nodes.
export const ElevationIcon = () => (
  <SidebarIcon>
    <path d="M3 20 H21" />
    <path d="M3 16 L8 11 L12 13 L17 6 L21 9" />
    <SidebarNode cx={8} cy={11} />
    <SidebarNode cx={12} cy={13} />
    <SidebarNode cx={17} cy={6} />
  </SidebarIcon>
)
