interface SparklineProps {
  /** Bucketed values, oldest first. Zero-length or flat-all-zero renders nothing. */
  points: number[]
  height?: number
  /** Accessible label describing what the trend shows. */
  label: string
}

/**
 * Minimal dependency-free SVG area sparkline (E-6). Single accent color that
 * follows the theme tokens via currentColor; the caller sets text-accent.
 */
export function Sparkline({ points, height = 36, label }: SparklineProps) {
  if (points.length < 2 || points.every((p) => p === 0)) {
    return <span className="text-caption text-ink3">No trend yet</span>
  }

  const width = 120
  const max = Math.max(...points)
  const stepX = width / (points.length - 1)
  // Leave a little headroom so thick strokes don't clip at the top.
  const scaleY = (value: number) => height - 3 - (value / max) * (height - 6)

  const coords = points.map((p, i) => `${(i * stepX).toFixed(1)},${scaleY(p).toFixed(1)}`)
  const linePath = `M${coords.join(' L')}`
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`
  const lastX = width
  const lastY = scaleY(points[points.length - 1]!).toFixed(1)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={label}
    >
      <path d={areaPath} fill="currentColor" opacity={0.12} />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill="currentColor" />
    </svg>
  )
}
