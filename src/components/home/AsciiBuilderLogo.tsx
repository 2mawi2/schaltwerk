import { useEffect, useMemo, useRef } from 'react'

interface AsciiBuilderLogoProps {
  asciiArt?: string
  colorClassName?: string
  paused?: boolean
  // Animation tuning
  settleDurationMs?: number
  spinDurationMs?: number
}

// Default ASCII art: current SCHALTWERK banner from HomeScreen
const DEFAULT_ASCII = `╔═══╗╔═══╗╔╗ ╔╗╔═══╗╔╗  ╔═══╗╔╗  ╔╗╔═══╗╔═══╗╔╗╔═╗
║╔═╗║║╔═╗║║║ ║║║╔═╗║║║  ╚╗╔╗║║║  ║║║╔══╝║╔═╗║║║║╔╝
║╚══╗║║ ╚╝║╚═╝║║╚═╝║║║   ║║║║║║ ╔╝║║╚══╗║╚═╝║║╚╝╝ 
╚══╗║║║ ╔╗║╔═╗║║╔═╗║║║   ║║║║║║╔╝╔╝║╔══╝║╔╗╔╝║╔╗║ 
║╚═╝║║╚═╝║║║ ║║║║ ║║║╚═╗ ║║║║║╚╝╔╝ ║╚══╗║║║╚╗║║║╚╗
╚═══╝╚═══╝╚╝ ╚╝╚╝ ╚╝╚══╝ ╚╝╚╝╚══╝  ╚═══╝╚╝╚═╝╚╝╚═╝`

// Lightweight 3D builder animation that renders into a <pre> efficiently.
export function AsciiBuilderLogo({
  asciiArt = DEFAULT_ASCII,
  colorClassName = 'text-cyan-400',
  paused = false,
  settleDurationMs = 1600,
  spinDurationMs = 2600,
}: AsciiBuilderLogoProps) {
  const preRef = useRef<HTMLPreElement | null>(null)
  const frameRef = useRef<number | null>(null)

  // Parse ASCII art into target grid and particle targets
  const { width, height, targetCells } = useMemo(() => {
    const lines = asciiArt.replace(/\s+$/g, '').split('\n')
    const h = lines.length
    const w = lines.reduce((m, l) => Math.max(m, l.length), 0)
    const grid: string[][] = Array.from({ length: h }, (_, y) => {
      const line = lines[y]
      const row: string[] = []
      for (let x = 0; x < w; x++) {
        row.push(line[x] ?? ' ')
      }
      return row
    })

    const cells: { x: number; y: number; char: string }[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = grid[y][x]
        if (ch !== ' ' && ch !== '\\t') {
          cells.push({ x, y, char: ch })
        }
      }
    }

    return { width: w, height: h, targetCells: cells }
  }, [asciiArt])

  // Animation state stored in refs to avoid re-renders
  const particlesRef = useRef<Array<{
    char: string
    // target 3D position (z = 0 plane)
    tx: number
    ty: number
    tz: number
    // start 3D position
    sx: number
    sy: number
    sz: number
    // per-particle delay to create cascade effect
    delayMs: number
  }>>([])

  const startTimeRef = useRef<number | null>(null)

  // Initialize particles on mount or when art changes
  useEffect(() => {
    const particles: typeof particlesRef.current = []

    // Normalize target coordinates to center for better projection
    const centerX = (width - 1) / 2
    const centerY = (height - 1) / 2

    // Random generator with stable seed from art shape for determinism
    let seed = width * 131 + height * 733 + targetCells.length * 997
    const rand = () => {
      seed ^= seed << 13
      seed ^= seed >> 17
      seed ^= seed << 5
      // Convert to [0,1)
      return ((seed >>> 0) % 100000) / 100000
    }

    for (const cell of targetCells) {
      // Target on z=0 plane, scale so each char is 1 unit
      const tx = cell.x - centerX
      const ty = cell.y - centerY
      const tz = 0

      // Start positions: a loose sphere/hemisphere, some behind and around
      const r = 18 + rand() * 14
      const theta = rand() * Math.PI * 2
      const phi = Math.acos(2 * rand() - 1)
      // Spherical to Cartesian
      const sx = r * Math.sin(phi) * Math.cos(theta)
      const sy = r * Math.sin(phi) * Math.sin(theta)
      const sz = r * Math.cos(phi) + 18 // shift back to ensure perspective

      const delayMs = (Math.abs(tx) + Math.abs(ty)) * 12 + rand() * 180

      particles.push({ char: cell.char, tx, ty, tz, sx, sy, sz, delayMs })
    }

    particlesRef.current = particles
    startTimeRef.current = null
  }, [width, height, targetCells])

  // Render frame to pre element
  useEffect(() => {
    if (!preRef.current) return

    const pre = preRef.current
    let running = true

    const raf = (cb: FrameRequestCallback) =>
      (typeof window !== 'undefined' && window.requestAnimationFrame)
        ? window.requestAnimationFrame(cb)
        : (setTimeout(() => cb(performance.now()), 16) as unknown as number)

    const caf = (id: number) => {
      if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(id)
      } else {
        clearTimeout(id as unknown as any)
      }
    }

    const fov = 42 // pseudo focal length; higher = less perspective

    // Reusable buffers
    const depth = new Float32Array(width * height)
    const chars = new Array<string>(width * height)

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

    const draw = (timestamp: number) => {
      if (!running) return
      if (paused) { frameRef.current = raf(draw); return }

      if (startTimeRef.current == null) startTimeRef.current = timestamp
      const elapsed = timestamp - startTimeRef.current

      // Clear buffers
      for (let i = 0; i < depth.length; i++) {
        depth[i] = -Infinity
        chars[i] = ' '
      }

      // Calculate if animation has settled
      const allSettled = particlesRef.current.every(p => {
        const localTime = Math.max(0, elapsed - p.delayMs)
        return localTime >= settleDurationMs
      })

      // Enable wobble only after all particles have settled to prevent stray dots
      const spinPhase = (elapsed % spinDurationMs) / spinDurationMs
      const wobbleAngle = allSettled ? (Math.sin(spinPhase * Math.PI * 2) * 6 * Math.PI) / 180 : 0
      const wobbleAngleY = allSettled ? (Math.cos(spinPhase * Math.PI * 2) * 5 * Math.PI) / 180 : 0

      for (let p = 0; p < particlesRef.current.length; p++) {
        const particle = particlesRef.current[p]
        const localTime = Math.max(0, elapsed - particle.delayMs)
        const settleT = Math.min(1, localTime / settleDurationMs)
        const eased = easeOutCubic(settleT)

        // Interpolate in 3D
        let x = particle.sx + (particle.tx - particle.sx) * eased
        let y = particle.sy + (particle.ty - particle.sy) * eased
        let z = particle.sz + (particle.tz - particle.sz) * eased

        // Apply a gentle rotation around origin to create 3D feel
        const rotX = (-18 * Math.PI) / 180 * (1 - eased) + wobbleAngle
        const rotY = (22 * Math.PI) / 180 * (1 - eased) + wobbleAngleY

        // Rotate Y
        const cosY = Math.cos(rotY)
        const sinY = Math.sin(rotY)
        const rx = x * cosY + z * sinY
        const rz = -x * sinY + z * cosY
        // Rotate X
        const cosX = Math.cos(rotX)
        const sinX = Math.sin(rotX)
        const ry = y * cosX - rz * sinX
        const rzz = y * sinX + rz * cosX

        // Perspective project to char grid
        const scale = fov / (fov + rzz)
        const sx = rx * scale
        const sy = ry * scale

        // Map to grid coordinates
        const gx = Math.round(sx + (width - 1) / 2)
        const gy = Math.round(sy + (height - 1) / 2)

        if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
          const idx = gy * width + gx
          // Depth test: nearer wins (larger scale ~ nearer => smaller rzz)
          const d = -rzz
          if (d > depth[idx]) {
            depth[idx] = d
            chars[idx] = particle.char
          }
        }
      }

      // Compose lines
      const outLines: string[] = []
      for (let y = 0; y < height; y++) {
        const from = y * width
        const to = from + width
        outLines.push(chars.slice(from, to).join(''))
      }

      pre.textContent = outLines.join('\n')

      frameRef.current = raf(draw)
    }

    frameRef.current = raf(draw)

    return () => {
      running = false
      if (frameRef.current != null) caf(frameRef.current)
    }
  }, [width, height, paused, settleDurationMs, spinDurationMs])

  return (
    <pre
      ref={preRef}
      className={`${colorClassName} ascii-logo text-[10px] sm:text-xs md:text-sm lg:text-base xl:text-lg 2xl:text-xl font-mono select-none`}
      aria-label="SCHALTWERK animated logo"
    />
  )
}
