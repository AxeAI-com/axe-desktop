import type { ReactNode, SVGProps } from "react"

type P = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, children, strokeWidth = 1.4, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const SidebarIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6 3v10" />
  </Icon>
)
export const SearchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </Icon>
)
export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
)
export const NewChatIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M13.5 8.5v3a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    <path d="M11.6 2.4a1.4 1.4 0 0 1 2 2L8.4 9.6 6 10l.4-2.4 5.2-5.2Z" />
  </Icon>
)
export const ChevronDown = (p: P) => (
  <Icon size={10} strokeWidth={1.4} {...p} viewBox="0 0 10 10">
    <path d="M2 4l3 3 3-3" />
  </Icon>
)
export const ChevronRight = (p: P) => (
  <Icon size={9} strokeWidth={1.6} {...p} viewBox="0 0 10 10">
    <path d="M3.5 2 6.5 5 3.5 8" />
  </Icon>
)
export const EyeIcon = (p: P) => (
  <Icon size={16} {...p}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
)
export const SendIcon = (p: P) => (
  <Icon size={14} strokeWidth={1.8} {...p}>
    <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
  </Icon>
)
export const StopIcon = (p: P) => (
  <svg width={p.size ?? 10} height={p.size ?? 10} viewBox="0 0 10 10" aria-hidden="true">
    <rect x="0.5" y="0.5" width="9" height="9" rx="2" fill="currentColor" />
  </svg>
)
export const CopyIcon = (p: P) => (
  <Icon size={15} strokeWidth={1.3} {...p}>
    <rect x="5" y="5" width="8.5" height="8.5" rx="1.6" />
    <path d="M10.5 5V3.6A1.6 1.6 0 0 0 8.9 2H3.6A1.6 1.6 0 0 0 2 3.6v5.3A1.6 1.6 0 0 0 3.6 10.5H5" />
  </Icon>
)
export const RetryIcon = (p: P) => (
  <Icon size={15} strokeWidth={1.3} {...p}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" />
  </Icon>
)
export const MoreIcon = (p: P) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="8" cy="3.5" r="1.25" />
    <circle cx="8" cy="8" r="1.25" />
    <circle cx="8" cy="12.5" r="1.25" />
  </svg>
)
export const CheckIcon = (p: P) => (
  <Icon strokeWidth={1.8} {...p}>
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </Icon>
)
export const XIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
)
export const PencilIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M10.8 2.7a1.5 1.5 0 0 1 2.1 2.1L5.5 12.2 2.5 13l.8-3 7.5-7.3Z" />
  </Icon>
)
export const PinIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M9.5 2.5 13.5 6.5 11 7.5 8.5 10l-.5 3L3 8l3-.5L8.5 5l1-2.5Z" />
    <path d="M5.5 10.5 2.5 13.5" />
  </Icon>
)
export const ArchiveIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <rect x="2" y="3" width="12" height="3" rx="1" />
    <path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3" />
  </Icon>
)
export const TrashIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M2.5 4h11M6 4V2.8h4V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4" />
  </Icon>
)
export const FolderIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5Z" />
  </Icon>
)
export const GlobeIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c1.8 1.8 2.6 3.8 2.6 6S9.8 12.2 8 14C6.2 12.2 5.4 10.2 5.4 8S6.2 3.8 8 2Z" />
  </Icon>
)
export const GearIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
  </Icon>
)
export const SunIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1" />
  </Icon>
)
export const MoonIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6Z" />
  </Icon>
)
export const MonitorIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
    <path d="M6 13.5h4M8 11v2.5" />
  </Icon>
)
export const ArrowDownIcon = (p: P) => (
  <Icon strokeWidth={1.6} {...p}>
    <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />
  </Icon>
)
export const SignOutIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11 13.5 8l-3-3M13.5 8H6" />
  </Icon>
)
export const CreditIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v6M5 8h6" />
  </Icon>
)
export const TerminalIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
    <path d="M4.5 6.5 6.5 8.5 4.5 10.5M8.5 10.5h3" />
  </Icon>
)
export const AlertIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.5M8 11h.01" />
  </Icon>
)
/** A warning triangle: a check that found something (security rows, repo alerts). */
export const WarnIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M8 2.7l6 10.3H2z" />
    <path d="M8 6.7v2.6M8 11.3v.4" />
  </Icon>
)
export const PaperclipIcon = (p: P) => (
  <Icon {...p}>
    <path d="M13.2 7.6 8.1 12.7a3.2 3.2 0 0 1-4.5-4.5l5.4-5.4a2.1 2.1 0 0 1 3 3L6.6 11.2a1.05 1.05 0 0 1-1.5-1.5l4.9-4.9" />
  </Icon>
)
export const TelescopeIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="m2.5 9.5 9-4.5 1.5 3-9 4.5zM11.5 5l1-.5 1.5 3-1 .5M7 11l-1.5 3.5M8.5 10.5 10 14" />
  </Icon>
)
export const FileIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M9.5 1.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-8z" />
    <path d="M9.5 1.5v4h3M5.5 8.5h5M5.5 11h3.5" />
  </Icon>
)
export const BrainIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M6 2.5a2 2 0 0 0-2 2 2 2 0 0 0-1.5 3.3A2.2 2.2 0 0 0 4 11.5a2 2 0 0 0 4 0v-7a2 2 0 0 0-2-2zM10 2.5a2 2 0 0 1 2 2 2 2 0 0 1 1.5 3.3 2.2 2.2 0 0 1-1.5 3.7 2 2 0 0 1-4 0" />
  </Icon>
)
export const RewindIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5V5h2.5" />
  </Icon>
)
export const BranchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-2 3-5.5 4" />
  </Icon>
)
export const DiffIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 2.5h6l3 3v8h-9z" />
    <path d="M6 7.5h4M8 5.5v4M6 11.5h4" />
  </Icon>
)

// Libraries (package G)

/** Skills: a book with a spark. */
export const SkillIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2H12v10H4.5A1.5 1.5 0 0 0 3 13.5z" />
    <path d="M3 13.5A1.5 1.5 0 0 0 4.5 15H12v-3" />
    <path d="M7.5 4.5v3M6 6h3" />
  </Icon>
)
/** Agents: a small helper with a face. */
export const AgentIcon = (p: P) => (
  <Icon {...p}>
    <rect x="2.5" y="4.5" width="11" height="9" rx="3" />
    <path d="M8 2v2.5" />
    <circle cx="6" cy="9" r="0.6" fill="currentColor" />
    <circle cx="10" cy="9" r="0.6" fill="currentColor" />
  </Icon>
)
/** Connectors: a plug. */
/** Dashboard: four tiles. */
export const DashboardIcon = (p: P) => (
  <Icon {...p}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </Icon>
)

/** Customize: two sliders. */
export const SlidersIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 5h6M12 5h1.5M2.5 11h2M8 11h5.5" />
    <circle cx="10.25" cy="5" r="1.6" />
    <circle cx="6.25" cy="11" r="1.6" />
  </Icon>
)

export const PlugIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5.5 2v3M10.5 2v3" />
    <path d="M3.5 5h9v2.5a4.5 4.5 0 0 1-9 0z" />
    <path d="M8 12v2.5" />
  </Icon>
)
export const ChecklistIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 4l1 1 2-2M2.5 9l1 1 2-2" />
    <path d="M8 4h5.5M8 9h5.5M8 13h5.5" />
  </Icon>
)
export const ChatIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 3.5h10a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H7l-3 2.5V11H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
  </Icon>
)
export const ChartIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 13.5h11" />
    <path d="M4.5 11V8M8 11V4.5M11.5 11V6.5" />
  </Icon>
)
export const ShapesIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="5.5" cy="5.5" r="3" />
    <rect x="8" y="8" width="5.5" height="5.5" rx="1" />
  </Icon>
)
export const SparkIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M12 4l-1.8 1.8M5.8 10.2 4 12" />
  </Icon>
)
export const ExternalIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5" />
    <path d="M12 9.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V4.5A.5.5 0 0 1 3 4h3.5" />
  </Icon>
)
export const MicIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
    <path d="M3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2" />
  </Icon>
)
export const MicOffIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <path d="M10.25 6.5V4a2.25 2.25 0 0 0-4.4-.7M5.75 6.25V7.5a2.25 2.25 0 0 0 3.9 1.55M3.25 7.5a4.75 4.75 0 0 0 7.9 3.55M12.75 7.5c0 .5-.08 1-.22 1.45M8 12.25v2M2.5 2.5l11 11" />
  </Icon>
)
/** Talk mode: three bars of a voice. */
export const VoiceIcon = (p: P) => (
  <Icon strokeWidth={1.4} {...p}>
    <path d="M4 6.5v3M8 3.5v9M12 6v4" />
  </Icon>
)
export const ScreenIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" />
    <path d="M6 14h4M8 11.25V14" />
  </Icon>
)
export const ClipboardIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <rect x="3.25" y="2.75" width="9.5" height="11.5" rx="1.5" />
    <path d="M6 2.75V2.5a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v.25M5.75 7h4.5M5.75 9.75h3" />
  </Icon>
)
export const OpenIcon = (p: P) => (
  <Icon strokeWidth={1.4} {...p}>
    <path d="M6.5 3.5h-3v9h9v-3M9 2.5h4.5V7M13.5 2.5 7.5 8.5" />
  </Icon>
)
export const BackIcon = (p: P) => (
  <Icon strokeWidth={1.5} {...p}>
    <path d="M9.5 3.5 5 8l4.5 4.5" />
  </Icon>
)
export const KeyboardIcon = (p: P) => (
  <Icon strokeWidth={1.3} {...p}>
    <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
    <path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6" />
  </Icon>
)

// Downloads and updates.
export const DownloadIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 2.5v8m0 0 3-3m-3 3-3-3" />
    <path d="M2.5 11v1a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1" />
  </Icon>
)
export const UpdateIcon = (p: P) => (
  <Icon {...p}>
    <path d="M13.5 8A5.5 5.5 0 1 1 11.6 3.8" />
    <path d="M13.5 2.5v3h-3" />
  </Icon>
)
export const ClockIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 4.75V8l2.25 1.5" />
  </Icon>
)
export const PhoneIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4.5" y="1.75" width="7" height="12.5" rx="1.75" />
    <path d="M7.25 11.75h1.5" />
  </Icon>
)
export const BoltIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 1.75 3.75 9h3.5L6.75 14.25 12.25 7H8.75L9 1.75Z" />
  </Icon>
)

/** Glyphs drawn on the board's 24 px grid (1.5 stroke), for the window frame and the account menu. */
const glyph = (d: string) =>
  function Glyph24(p: P) {
    return (
      <Icon viewBox="0 0 24 24" strokeWidth={1.5} {...p}>
        <path d={d} />
      </Icon>
    )
  }
export const FolderPlusIcon = glyph("M4 19.5h16a1.5 1.5 0 0 0 1.5-1.5V8.5A1.5 1.5 0 0 0 20 7h-7.6a1.5 1.5 0 0 1-1.2-.6l-1-1.3A1.5 1.5 0 0 0 9 4.5H4A1.5 1.5 0 0 0 2.5 6v12A1.5 1.5 0 0 0 4 19.5zM12 10.5v6M9 13.5h6")
export const CommandIcon = glyph("M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3")
export const GearGlyph = glyph(
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2l-.3 2h-3.9l-.3-2a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L3 9.3l2-3.4 1.9.7a7 7 0 0 1 2-1.2l.3-2h3.9l.3 2a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z",
)
export const SlidersGlyph = glyph("M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4")
export const PhoneGlyph = glyph("M7.5 3h9v18h-9zM11 18h2")
export const UserIcon = glyph("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6")
export const WifiOffIcon = glyph("M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4.5-2.5M14.5 10a10 10 0 0 1 4.5 2.5M2 9a15 15 0 0 1 4-2.6M11 5.6A15 15 0 0 1 22 9")

// The menu bar panel's set: the same 24 px grid and 1.5 stroke as the glyphs above (and the watch kinds),
// drawn at 16 (the chevron at 12).
export const ComposeGlyph = glyph("M20 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H11M17.4 3.6a2 2 0 0 1 2.9 2.9L12.5 14.3l-3.8.9.9-3.8z")
export const OpenGlyph = glyph("M10 5H5.5A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V14M14 4h6v6M20 4l-9 9")
export const BackGlyph = glyph("M14.5 5.5 8 12l6.5 6.5")
export const PlusGlyph = glyph("M12 5v14M5 12h14")
export const MicGlyph = glyph("M12 3.5a3 3 0 0 0-3 3V12a3 3 0 0 0 6 0V6.5a3 3 0 0 0-3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5v3")
export const ChatGlyph = glyph("M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z")
export const ChevronGlyph = glyph("M7 10l5 5 5-5")
export const StopGlyph = glyph("M7.5 7.5h9v9h-9z")
