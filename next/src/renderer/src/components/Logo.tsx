// The real Axe AI mark and lockup (marketing/logo-redrawn), drawn in currentColor.

const MARK =
  "M1.57 169.21 L153.42 145.22 L138.73 104.91 L194.09 169.21Z M96.26 0.23 L41.12 143.74 L83.37 151.17 L0.00 166.97Z M195.25 166.73 L98.55 47.22 L70.99 80.10 L98.99 0.00Z"

export function AxeMark({ size = 30, className }: { size?: number; className?: string }) {
  const width = (size * 195.25) / 169.21
  return (
    <svg width={width} height={size} viewBox="0 0 195.25 169.21" fill="currentColor" aria-hidden="true" className={className}>
      <path d={MARK} />
    </svg>
  )
}

export function AxeLockup({ height = 18, className }: { height?: number; className?: string }) {
  const width = (height * 711.7) / 128
  return (
    <svg role="img" aria-label="Axe AI" width={width} height={height} viewBox="0 0 711.7 128" fill="currentColor" className={className}>
      <g transform="scale(0.756463)">
        <path d={MARK} />
      </g>
      <g transform="translate(187.7 0)">
        <path d="M118.551 128H101.977L88.3284 92.5091H30.0278L16.3788 128H0L50.1113 0H68.6349L118.551 128ZM35.6823 77.9636H82.6738L59.0806 14.9333L35.6823 77.9636Z" />
        <path d="M224.94 128H207.001L172.099 75.2485L137.002 128H118.868L163.91 62.8364L122.768 0H141.096L173.659 49.8424L206.611 0H223.575L181.848 62.0606L224.94 128Z" />
        <path d="M246.308 128V0H336.586V14.5455H261.907V55.8545H320.012V70.4H261.907V113.455H339.511V128H246.308Z" />
        <path d="M487.316 128H470.742L457.093 92.5091H398.792L385.143 128H368.764L418.876 0H437.399L487.316 128ZM404.447 77.9636H451.438L427.845 14.9333L404.447 77.9636Z" />
        <path d="M523.223 0V128H507.625V0H523.223Z" />
      </g>
    </svg>
  )
}
