import type { Kind } from "@shared/watching/types"

import { BatteryHalfIcon as SolarBatteryHalfIcon } from "@solar-icons/react/bold-duotone/battery-half"
import { BoxIcon as SolarBoxIcon } from "@solar-icons/react/bold-duotone/box"
import { BoxMinimalisticIcon as SolarBoxMinimalisticIcon } from "@solar-icons/react/bold-duotone/box-minimalistic"
import { CalendarMinimalisticIcon as SolarCalendarMinimalisticIcon } from "@solar-icons/react/bold-duotone/calendar-minimalistic"
import { ChatRoundDotsIcon as SolarChatRoundDotsIcon } from "@solar-icons/react/bold-duotone/chat-round-dots"
import { CodeFileIcon as SolarCodeFileIcon } from "@solar-icons/react/bold-duotone/code-file"
import { CpuIcon as SolarCpuIcon } from "@solar-icons/react/bold-duotone/cpu"
import { CupHotIcon as SolarCupHotIcon } from "@solar-icons/react/bold-duotone/cup-hot"
import { DocumentTextIcon as SolarDocumentTextIcon } from "@solar-icons/react/bold-duotone/document-text"
import { DownloadMinimalisticIcon as SolarDownloadMinimalisticIcon } from "@solar-icons/react/bold-duotone/download-minimalistic"
import { EyeIcon as SolarEyeIcon } from "@solar-icons/react/bold-duotone/eye"
import { FolderWithFilesIcon as SolarFolderWithFilesIcon } from "@solar-icons/react/bold-duotone/folder-with-files"
import { GasStationIcon as SolarGasStationIcon } from "@solar-icons/react/bold-duotone/gas-station"
import { GitForkIcon as SolarGitForkIcon } from "@solar-icons/react/bold-duotone/git-fork"
import { GlobalIcon as SolarGlobalIcon } from "@solar-icons/react/bold-duotone/global"
import { HeartPulseIcon as SolarHeartPulseIcon } from "@solar-icons/react/bold-duotone/heart-pulse"
import { HistoryIcon as SolarHistoryIcon } from "@solar-icons/react/bold-duotone/history"
import { InboxInIcon as SolarInboxInIcon } from "@solar-icons/react/bold-duotone/inbox-in"
import { LayersIcon as SolarLayersIcon } from "@solar-icons/react/bold-duotone/layers"
import { LetterIcon as SolarLetterIcon } from "@solar-icons/react/bold-duotone/letter"
import { LinkRoundAngleIcon as SolarLinkRoundAngleIcon } from "@solar-icons/react/bold-duotone/link-round-angle"
import { MagnifierIcon as SolarMagnifierIcon } from "@solar-icons/react/bold-duotone/magnifier"
import { PauseIcon as SolarPauseIcon } from "@solar-icons/react/bold-duotone/pause"
import { PlayIcon as SolarPlayIcon } from "@solar-icons/react/bold-duotone/play"
import { PulseIcon as SolarPulseIcon } from "@solar-icons/react/bold-duotone/pulse"
import { RestartIcon as SolarRestartIcon } from "@solar-icons/react/bold-duotone/restart"
import { ServerMinimalisticIcon as SolarServerMinimalisticIcon } from "@solar-icons/react/bold-duotone/server-minimalistic"
import { ServerPathIcon as SolarServerPathIcon } from "@solar-icons/react/bold-duotone/server-path"
import { ServerSquareIcon as SolarServerSquareIcon } from "@solar-icons/react/bold-duotone/server-square"
import { ShieldCheckIcon as SolarShieldCheckIcon } from "@solar-icons/react/bold-duotone/shield-check"
import { SpeedometerMiddleIcon as SolarSpeedometerMiddleIcon } from "@solar-icons/react/bold-duotone/speedometer-middle"
import { SsdRoundIcon as SolarSsdRoundIcon } from "@solar-icons/react/bold-duotone/ssd-round"
import { StarsIcon as SolarStarsIcon } from "@solar-icons/react/bold-duotone/stars"
import { TagPriceIcon as SolarTagPriceIcon } from "@solar-icons/react/bold-duotone/tag-price"
import { TestTubeIcon as SolarTestTubeIcon } from "@solar-icons/react/bold-duotone/test-tube"
import { TextFieldIcon as SolarTextFieldIcon } from "@solar-icons/react/bold-duotone/text-field"
import { WalletIcon as SolarWalletIcon } from "@solar-icons/react/bold-duotone/wallet"
import { WiFiRouterIcon as SolarWiFiRouterIcon } from "@solar-icons/react/bold-duotone/wi-fi-router"

// One Solar Bold Duotone icon per kind of watch (spec 0001; the same set the web uses). The kind shows only as this
// icon, never as a label on a row.

type SolarComponent = (props: Record<string, unknown>) => React.ReactNode

const ICONS: Record<Kind, SolarComponent> = {
  processes: SolarCpuIcon as SolarComponent,
  memory: SolarServerMinimalisticIcon as SolarComponent,
  battery: SolarBatteryHalfIcon as SolarComponent,
  ports: SolarServerSquareIcon as SolarComponent,
  docker: SolarBoxIcon as SolarComponent,
  gitrepos: SolarGitForkIcon as SolarComponent,
  brew: SolarCupHotIcon as SolarComponent,
  macos: SolarRestartIcon as SolarComponent,
  timemachine: SolarHistoryIcon as SolarComponent,
  hogs: SolarFolderWithFilesIcon as SolarComponent,
  network: SolarWiFiRouterIcon as SolarComponent,
  pagespeed: SolarSpeedometerMiddleIcon as SolarComponent,
  wallets: SolarWalletIcon as SolarComponent,
  fees: SolarGasStationIcon as SolarComponent,
  mentions: SolarChatRoundDotsIcon as SolarComponent,
  email: SolarLetterIcon as SolarComponent,
  global: SolarGlobalIcon as SolarComponent,
  downloads: SolarDownloadMinimalisticIcon as SolarComponent,
  uptime: SolarPulseIcon as SolarComponent,
  page: SolarDocumentTextIcon as SolarComponent,
  price: SolarTagPriceIcon as SolarComponent,
  security: SolarShieldCheckIcon as SolarComponent,
  repo: SolarCodeFileIcon as SolarComponent,
  custom: SolarStarsIcon as SolarComponent,
  health: SolarHeartPulseIcon as SolarComponent,
  expiry: SolarCalendarMinimalisticIcon as SolarComponent,
  dns: SolarServerPathIcon as SolarComponent,
  status: SolarLayersIcon as SolarComponent,
  feed: SolarInboxInIcon as SolarComponent,
  seo: SolarMagnifierIcon as SolarComponent,
  links: SolarLinkRoundAngleIcon as SolarComponent,
  tests: SolarTestTubeIcon as SolarComponent,
  outdated: SolarBoxMinimalisticIcon as SolarComponent,
  disk: SolarSsdRoundIcon as SolarComponent,
}

export function KindIcon({ kind, size = 16, className = "" }: { kind: Kind; size?: number; className?: string; strokeWidth?: number }) {
  const Icon = ICONS[kind]
  return <Icon size={size} className={`axe-icon ${className}`.trim()} aria-hidden="true" focusable="false" />
}

/** Competitor pages has its own glyph in the catalogue (an eye); it drafts a Page changes watch. */
export function CompetitorIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <SolarEyeIcon size={size} className={`axe-icon ${className}`.trim()} aria-hidden="true" focusable="false" />
}

/** The 32 px circle a watch row and the plan card start with. */
export function KindTile({ kind, size = 32 }: { kind: Kind; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-fill-2 text-ink-2" style={{ width: size, height: size }}>
      <KindIcon kind={kind} size={Math.round(size * 0.5)} />
    </span>
  )
}

const glyph = (Solar: SolarComponent) =>
  function Glyph({ size = 16, className = "" }: { size?: number; className?: string }) {
    return <Solar size={size} className={`axe-icon ${className}`.trim()} aria-hidden="true" focusable="false" />
  }

/** The chevron and row menus' Pause, Resume and Rename. */
export const PauseIcon = glyph(SolarPauseIcon as SolarComponent)
export const PlayIcon = glyph(SolarPlayIcon as SolarComponent)
export const TypeIcon = glyph(SolarTextFieldIcon as SolarComponent)
