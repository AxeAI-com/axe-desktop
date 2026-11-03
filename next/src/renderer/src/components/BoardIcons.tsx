// The three line icons the chat screens share with the board: a page, a copy mark and a retry arrow.
// 24 px grid, 1.5 stroke, drawn at the size the board uses (16 or 14).

function Line({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {children}
    </svg>
  )
}

export const PageIcon = ({ size = 16 }: { size?: number }) => (
  <Line size={size}>
    <path d="M6.5 3.5h7.5l4 4v13h-11.5zM14 3.5v4h4" />
  </Line>
)
export const WebMark = ({ size = 16 }: { size?: number }) => (
  <Line size={size}>
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9M12 3C9.5 5.7 8.2 8.7 8.2 12s1.3 6.3 3.8 9" />
  </Line>
)
export const CopyMark = ({ size = 16 }: { size?: number }) => (
  <Line size={size}>
    <path d="M9 9h11v11H9zM15 9V4H4v11h5" />
  </Line>
)
export const RetryMark = ({ size = 16 }: { size?: number }) => (
  <Line size={size}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" />
  </Line>
)
