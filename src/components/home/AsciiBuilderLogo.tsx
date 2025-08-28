import { useEffect, useMemo, useRef } from 'react'

interface AsciiBuilderLogoProps {
  asciiArt?: string
  colorClassName?: string
  paused?: boolean
  // Snap/settle tuning
  settleDurationMs?: number
  spinDurationMs?: number // used if idleMode='wobble'
  // Fall/swirl tuning
  fallDurationMs?: number
  groupGapMs?: number
  cameraDollyMs?: number
  shakeIntensity?: number
  shadingCharset?: string
  groupOrder?: 'center-out' | 'left-to-right' | 'right-to-left'
  // Shorter intro tease (few early artifacts)
  introTeaseMs?: number
  introTeaseFraction?: number
  // End motion style
  idleMode?: 'artifact' | 'artifact+pulse' | 'pulse' | 'wobble' | 'still'
  // Camera pulse settings (if pulse or artifact+pulse)
  idlePulseMinDelayMs?: number
  idlePulseMaxDelayMs?: number
  idlePulseDurationMs?: number
  idlePulseAngleDeg?: number
  // Artifact echo settings (idleMode 'artifact' or 'artifact+pulse')
  idleArtifactMinDelayMs?: number
  idleArtifactMaxDelayMs?: number
  idleArtifactDurationMs?: number
  idleArtifactMagnitude?: number
  idleArtifactFraction?: number
}

const DEFAULT_ASCII = `╔═══╗╔═══╗╔╗ ╔╗╔═══╗╔╗  ╔═══╗╔╗  ╔╗╔═══╗╔═══╗╔╗╔═╗
║╔═╗║║╔═╗║║║ ║║║╔═╗║║║  ╚╗╔╗║║║  ║║║╔══╝║╔═╗║║║║╔╝
║╚══╗║║ ╚╝║╚═╝║║╚═╝║║║   ║║║║║║ ╔╝║║╚══╗║╚═╝║║╚╝╝ 
╚══╗║║║ ╔╗║╔═╗║║╔═╗║║║   ║║║║║║╔╝╔╝║╔══╝║╔╗╔╝║╔╗║ 
║╚═╝║║╚═╝║║║ ║║║║ ║║║╚═╗ ║║║║║╚╝╔╝ ║╚══╗║║║╚╗║║║╚╗
╚═══╝╚═══╝╚╝ ╚╝╚╝ ╚╝╚══╝ ╚╝╚╝╚══╝  ╚═══╝╚╝╚═╝╚╝╚═╝`

export function AsciiBuilderLogo({
  asciiArt = DEFAULT_ASCII,
  colorClassName = 'text-cyan-400',
  paused = false,
  // Assembly
  settleDurationMs = 900,
  spinDurationMs = 2600,
  fallDurationMs = 1400,
  groupGapMs = 140,
  cameraDollyMs = 900,
  shakeIntensity = 0.6,
  shadingCharset = ' .,:;irsXA253hMHGS#9B&@',
  groupOrder = 'center-out',
  // Ultra-short intro tease
  introTeaseMs = 24,
  introTeaseFraction = 0.006,
  // Idle style defaults to artifact echoes
  idleMode = 'artifact', // 'artifact' | 'artifact+pulse' | 'pulse' | 'wobble' | 'still'
  // Pulse settings
  idlePulseMinDelayMs = 5200,
  idlePulseMaxDelayMs = 8200,
  idlePulseDurationMs = 1100,
  idlePulseAngleDeg = 1.1,
  // Artifact echo settings
  idleArtifactMinDelayMs = 1600,
  idleArtifactMaxDelayMs = 2600,
  idleArtifactDurationMs = 900,
  idleArtifactMagnitude = 3.6,
  idleArtifactFraction = 0.10,
}: AsciiBuilderLogoProps) {
  const preRef = useRef<HTMLPreElement | null>(null)
  const frameRef = useRef<number | null>(null)

  // Parse art and build groups; also compute spatial group orders
  const {
    width, height, targetCells, groups, cellNormals, cellToGroup,
    centerX, centerY
  } = useMemo(() => {
    const lines = asciiArt.replace(/\s+$/g, '').split('\n')
    const h = lines.length
    const w = lines.reduce((m, l) => Math.max(m, l.length), 0)
    const grid: string[][] = Array.from({ length: h }, (_, y) => {
      const line = lines[y] ?? ''
      const row: string[] = []
      for (let x = 0; x < w; x++) row.push(line[x] ?? ' ')
      return row
    })

    const cells: { x: number; y: number; char: string }[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = grid[y][x]
        if (ch !== ' ' && ch !== '\t') cells.push({ x, y, char: ch })
      }
    }

    // Occupancy and normals
    const occ = (x: number, y: number) =>
      x >= 0 && x < w && y >= 0 && y < h && grid[y][x] !== ' ' ? 1 : 0

    const cellNormals: Record<number, { nx: number; ny: number; nz: number }> = {}
    for (let i = 0; i < cells.length; i++) {
      const { x, y } = cells[i]
      const gx = occ(x + 1, y) - occ(x - 1, y)
      const gy = occ(x, y + 1) - occ(x, y - 1)
      let nx = -(gx)
      let ny = -(gy)
      const nz = 0.9
      const mag = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      nx /= mag; ny /= mag
      cellNormals[i] = { nx, ny, nz }
    }

    // Segment into letter-like groups via column gaps
    const colOcc: number[] = Array(w).fill(0)
    for (let x = 0; x < w; x++) {
      let c = 0
      for (let y = 0; y < h; y++) if (grid[y][x] !== ' ') c++
      colOcc[x] = c
    }
    const gapThreshold = Math.max(0, Math.floor(h * 0.06))
    const segments: Array<{ start: number; end: number; cx: number }> = []
    let inSeg = false, start = 0
    for (let x = 0; x < w; x++) {
      const filled = colOcc[x] > gapThreshold
      if (filled && !inSeg) { inSeg = true; start = x }
      else if (!filled && inSeg) { inSeg = false; segments.push({ start, end: x - 1, cx: (start + (x - 1)) / 2 }) }
    }
    if (inSeg) segments.push({ start: start, end: w - 1, cx: (start + (w - 1)) / 2 })

    // Fallback chunking
    if (segments.length <= 1 && w > 0) {
      const chunks = Math.min(9, Math.ceil(w / Math.max(8, Math.floor(w / 9))))
      const step = Math.ceil(w / chunks)
      const segs: typeof segments = []
      for (let i = 0; i < chunks; i++) {
        const s = i * step
        const e = Math.min(w - 1, (i + 1) * step - 1)
        if (s <= e) segs.push({ start: s, end: e, cx: (s + e) / 2 })
      }
      segments.splice(0, segments.length, ...segs)
    }

    // Build assembly order based on requested groupOrder
    const cx = (w - 1) / 2
    const orderedIndices = segments
      .map((seg, idx) => ({ idx, seg }))
      .sort((a, b) => {
        if (groupOrder === 'center-out') {
          const da = Math.abs(a.seg.cx - cx), db = Math.abs(b.seg.cx - cx)
          return da - db
        } else if (groupOrder === 'left-to-right') {
          return a.seg.cx - b.seg.cx
        }
        return b.seg.cx - a.seg.cx
      })
      .map(({ idx }) => idx)
    const groupOrderIndex: number[] = Array(segments.length)
    for (let rank = 0; rank < orderedIndices.length; rank++) {
      groupOrderIndex[orderedIndices[rank]] = rank
    }

    // Spatial scan orders for idle artifacts (right-to-left ping-pong)
    const byXAsc = segments
      .map((s, i) => ({ i, x: s.cx }))
      .sort((a, b) => a.x - b.x)
      .map(o => o.i)
    const byXDesc = [...byXAsc].reverse()

    // Map cell -> segment index
    const cellToGroup: number[] = Array(cells.length)
    for (let i = 0; i < cells.length; i++) {
      const x = cells[i].x
      let g = 0
      for (let s = 0; s < segments.length; s++) {
        if (x >= segments[s].start && x <= segments[s].end) { g = s; break }
      }
      cellToGroup[i] = g
    }

    const centerX = (w - 1) / 2
    const centerY = (h - 1) / 2

    return {
      width: w,
      height: h,
      targetCells: cells,
      groups: {
        segments,
        order: orderedIndices,
        orderIndex: groupOrderIndex,
        byXAsc,
        byXDesc
      },
      cellNormals,
      cellToGroup,
      centerX,
      centerY
    }
  }, [asciiArt, groupOrder])

  // Particles
  const particlesRef = useRef<Array<{
    id: number
    char: string
    // target
    tx: number; ty: number; tz: number
    // start
    sx: number; sy: number; sz: number
    delayMs: number
    fallMs: number
    settleMs: number
    nx: number; ny: number; nz: number
    groupRank: number
    segmentId: number
  }>>([])

  const startTimeRef = useRef<number | null>(null)

  // Group -> particle ids (for idle artifact selection)
  const groupToParticleIdsRef = useRef<number[][]>([])

  // Intro/pulse RNG
  const pulseSeedRef = useRef<number>(0)
  const lastPulseAtRef = useRef<number>(-Infinity)
  const nextPulseDelayRef = useRef<number>(0)
  const pulseStartAtRef = useRef<number>(-1)

  // Idle artifact scheduler
  const artifactSeedRef = useRef<number>(0)
  const lastArtifactAtRef = useRef<number>(-Infinity)
  const nextArtifactDelayRef = useRef<number>(0)
  const scanArrayRef = useRef<number[]>([])
  const scanIndexRef = useRef<number>(0)
  const scanDirRef = useRef<1 | -1>(1)
  const allSetAtRef = useRef<number>(-1)

  // Per-particle echo states during idle artifacts
  const echoStatesRef = useRef<Map<number, {
    start: number
    duration: number
    baseAngle: number
    mag: number
    zSign: number
  }>>(new Map())

  useEffect(() => {
    const particles: typeof particlesRef.current = []

    // RNG
    let seed = width * 131 + height * 733 + targetCells.length * 997
    const rand = () => {
      seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5
      return ((seed >>> 0) % 100000) / 100000
    }

    // Spawn parameters
    const span = Math.max(width, height)
    const spawnR = span * 1.2
    const baseFall = fallDurationMs
    const baseSettle = settleDurationMs
    const perGroupDelay = groupGapMs

    // Build particles
    for (let i = 0; i < targetCells.length; i++) {
      const { x, y, char } = targetCells[i]
      const segmentId = cellToGroup[i]
      const groupRank = groups.orderIndex[segmentId]

      const tx = x - centerX
      const ty = y - centerY
      const tz = 0

      const angle = rand() * Math.PI * 2
      const radius = spawnR * (0.6 + 0.4 * rand())
      const sx = (Math.cos(angle) * radius) + (rand() - 0.5) * span * 0.3
      const sy = -(height * 0.9 + 8 + rand() * 8)
      const sz = 16 + rand() * 18

      // Ultra-short, tiny intro teaser
      const isTeaser = (groupRank <= 1) && (rand() < introTeaseFraction)
      const delayMs = isTeaser
        ? Math.floor(rand() * 18) // ultra-short 0–18ms
        : introTeaseMs + groupRank * perGroupDelay + Math.floor(rand() * 120)

      const fallMs = baseFall + Math.floor((rand() - 0.5) * 250)
      const settleMs = baseSettle + Math.floor((rand() - 0.5) * 150)

      const { nx, ny, nz } = cellNormals[i]
      particles.push({
        id: i, char, tx, ty, tz, sx, sy, sz,
        delayMs, fallMs, settleMs, nx, ny, nz,
        groupRank, segmentId
      })
    }

    particlesRef.current = particles
    startTimeRef.current = null

    // Group -> particle ids
    const g2p: number[][] = Array(groups.segments.length).fill(0).map(() => [])
    for (let p = 0; p < particles.length; p++) {
      const seg = particles[p].segmentId
      g2p[seg].push(p)
    }
    groupToParticleIdsRef.current = g2p

    // Reset schedules
    pulseSeedRef.current = width * 92821 + height * 19333 + targetCells.length * 77
    artifactSeedRef.current = width * 53407 + height * 27103 + targetCells.length * 911
    lastPulseAtRef.current = -Infinity
    nextPulseDelayRef.current = 0
    pulseStartAtRef.current = -1

    lastArtifactAtRef.current = -Infinity
    nextArtifactDelayRef.current = 0
    echoStatesRef.current.clear()
    scanArrayRef.current = groups.byXDesc.slice() // start right-to-left
    scanIndexRef.current = 0
    scanDirRef.current = 1
    allSetAtRef.current = -1
  }, [
    width, height, targetCells, cellToGroup,
    groups, centerX, centerY,
    fallDurationMs, settleDurationMs, groupGapMs,
    introTeaseMs, introTeaseFraction
  ])

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

    const baseFov = 44
    const minFov = 36

    const depth = new Float32Array(width * height)
    const chars = new Array<string>(width * height)

    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t
    const easeInCubic = (t: number) => t * t * t
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
    const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)

    const lightDir = normalize3([-0.4, -0.25, 0.88])
    function normalize3(v: [number, number, number]) {
      const m = Math.hypot(v[0], v[1], v[2]) || 1
      return [v[0] / m, v[1] / m, v[2] / m] as [number, number, number]
    }

    const groupSnapAt: number[] = []
    const groupSnapped: boolean[] = Array(groups.segments.length).fill(false)

    const pulseRand = () => {
      let s = pulseSeedRef.current
      s ^= s << 13; s ^= s >> 17; s ^= s << 5
      pulseSeedRef.current = s
      return ((s >>> 0) % 100000) / 100000
    }
    const artifactRand = () => {
      let s = artifactSeedRef.current
      s ^= s << 13; s ^= s >> 17; s ^= s << 5
      artifactSeedRef.current = s
      return ((s >>> 0) % 100000) / 100000
    }

    const scheduleArtifactEcho = (now: number) => {
      const scan = scanArrayRef.current
      if (scan.length === 0) return
      const segId = scan[Math.max(0, Math.min(scan.length - 1, scanIndexRef.current))]

      // Next pointer for ping-pong scan (R->L then L->R)
      scanIndexRef.current += scanDirRef.current
      if (scanIndexRef.current >= scan.length) {
        scanIndexRef.current = scan.length - 2
        scanDirRef.current = -1
      } else if (scanIndexRef.current < 0) {
        scanIndexRef.current = 1
        scanDirRef.current = 1
      }

      const ids = groupToParticleIdsRef.current[segId] || []
      if (ids.length === 0) return

      const takeFraction = clamp(idleArtifactFraction, 0.02, 0.45)
      const count = Math.max(3, Math.floor(ids.length * takeFraction))
      const chosen: number[] = []

      // Reservoir-like random pick without duplicates
      for (let i = 0; i < ids.length && chosen.length < count; i++) {
        const idx = Math.floor(artifactRand() * ids.length)
        const pid = ids[idx]
        if (!chosen.includes(pid)) chosen.push(pid)
      }

      const dur = idleArtifactDurationMs
      for (const pid of chosen) {
        // Create or refresh echo state
        const baseAngle = artifactRand() * Math.PI * 2
        const mag = idleArtifactMagnitude * (0.8 + artifactRand() * 0.4)
        const zSign = artifactRand() < 0.5 ? 1 : -1
        echoStatesRef.current.set(pid, { start: now, duration: dur, baseAngle, mag, zSign })
      }

      lastArtifactAtRef.current = now
      nextArtifactDelayRef.current = idleArtifactMinDelayMs +
        artifactRand() * (idleArtifactMaxDelayMs - idleArtifactMinDelayMs)
    }

    const draw = (timestamp: number) => {
      if (!running) return
      if (paused) { frameRef.current = raf(draw); return }

      if (startTimeRef.current == null) startTimeRef.current = timestamp
      const elapsed = timestamp - startTimeRef.current

      const dollyT = clamp(elapsed / cameraDollyMs, 0, 1)
      let fov = lerp(baseFov, minFov, easeOutCubic(dollyT))

      for (let i = 0; i < depth.length; i++) { depth[i] = -Infinity; chars[i] = ' ' }

      const allSet = particlesRef.current.every(p => (elapsed - p.delayMs - p.fallMs) >= p.settleMs)
      if (allSet && allSetAtRef.current < 0) {
        allSetAtRef.current = elapsed
        // give it a brief beat before the first idle artifact
        lastArtifactAtRef.current = elapsed
        nextArtifactDelayRef.current = Math.max(idleArtifactMinDelayMs * 0.7, 900)
      }

      // End motion: camera pulse/wobble
      let extraRotX = 0
      let extraRotY = 0
      if (allSet) {
        if ((idleMode === 'wobble') || (idleMode === 'pulse' && false)) {
          // keep wobble only if explicitly chosen
          const wobblePhase = (elapsed % spinDurationMs) / spinDurationMs
          const amp = 0.6 * Math.PI / 180
          extraRotX = Math.sin(wobblePhase * Math.PI * 2) * amp
          extraRotY = Math.cos(wobblePhase * Math.PI * 2) * amp
        }
        if (idleMode === 'pulse' || idleMode === 'artifact+pulse') {
          let active = pulseStartAtRef.current >= 0 &&
                       elapsed < (pulseStartAtRef.current + idlePulseDurationMs)
          if (!active) {
            if ((elapsed - lastPulseAtRef.current) >= nextPulseDelayRef.current) {
              pulseStartAtRef.current = elapsed
              lastPulseAtRef.current = elapsed
              const nextDelay = idlePulseMinDelayMs +
                pulseRand() * (idlePulseMaxDelayMs - idlePulseMinDelayMs)
              nextPulseDelayRef.current = nextDelay
              active = true
            }
          }
          if (active) {
            const t = clamp((elapsed - pulseStartAtRef.current) / idlePulseDurationMs, 0, 1)
            const e = Math.sin(Math.PI * t)
            const amp = (idlePulseAngleDeg * Math.PI) / 180
            extraRotX += e * amp * 0.75
            extraRotY += e * amp * 1.0
            fov += e * 1.2
          }
        }
      }

      // World rotation decays from swirl to idle stillness
      const swirlDecay = 1 - clamp(elapsed / (fallDurationMs + groups.segments.length * groupGapMs + 400), 0, 1)
      const worldRotX = (swirlDecay * (18 * Math.PI / 180)) + extraRotX
      const worldRotY = (swirlDecay * (-22 * Math.PI / 180)) + extraRotY

      // Schedule idle artifact echoes (right->left->right ping-pong)
      if (allSet && (idleMode === 'artifact' || idleMode === 'artifact+pulse')) {
        if ((elapsed - lastArtifactAtRef.current) >= nextArtifactDelayRef.current) {
          scheduleArtifactEcho(elapsed)
        }
      }

      // Light/shade
      const [lx, ly, lz] = lightDir

      // Group snap shake (during assembly only)
      let shakeX = 0, shakeY = 0
      if (shakeIntensity > 0) {
        const now = elapsed
        for (let gi = 0; gi < groupSnapAt.length; gi++) {
          const t = now - groupSnapAt[gi]
          if (t >= 0 && t < 260) {
            const k = (1 - t / 260)
            shakeX += (Math.sin(t * 0.09 + gi) * 0.7) * k
            shakeY += (Math.cos(t * 0.11 + gi * 1.3) * 0.5) * k
          }
        }
        shakeX *= shakeIntensity
        shakeY *= shakeIntensity
      }

      for (let p = 0; p < particlesRef.current.length; p++) {
        const particle = particlesRef.current[p]
        const localTime = elapsed - particle.delayMs
        if (localTime < 0) continue

        const inFall = localTime < particle.fallMs
        const tFall = clamp(localTime / particle.fallMs, 0, 1)
        const afterFallTime = localTime - particle.fallMs
        const tSettle = clamp(afterFallTime / particle.settleMs, 0, 1)

        // Pre-target (intro feel)
        const preTargetX = particle.tx + Math.sin(particle.tx * 0.35 + particle.ty * 0.15) * 0.6
        const preTargetY = particle.ty - 2
        const preTargetZ = particle.tz + 2 + Math.cos(particle.tx * 0.3 + particle.ty * 0.27) * 0.8

        let x, y, z
        if (inFall) {
          const e = easeInCubic(tFall)
          const swirlA = (1 - tFall) * (Math.PI * 0.7)
          const cosA = Math.cos(swirlA), sinA = Math.sin(swirlA)
          let xf = particle.sx + (preTargetX - particle.sx) * e
          let yf = particle.sy + (preTargetY - particle.sy) * e
          let zf = particle.sz + (preTargetZ - particle.sz) * e
          const rx = xf * cosA + zf * sinA
          const rz = -xf * sinA + zf * cosA
          x = rx; y = yf; z = rz
        } else {
          const e = easeOutBack(tSettle, 1.2)
          x = preTargetX + (particle.tx - preTargetX) * e
          y = preTargetY + (particle.ty - preTargetY) * e
          z = preTargetZ + (particle.tz - preTargetZ) * e
          if (!groupSnapped[particle.groupRank] && tSettle >= 0.02) {
            groupSnapped[particle.groupRank] = true
            groupSnapAt.push(elapsed)
          }
        }

        // Idle artifact echo offset (applies after assembly)
        let echoActive = false
        let echoSnapFlash = false
        if (allSet) {
          const es = echoStatesRef.current.get(particle.id)
          if (es) {
            const te = clamp((elapsed - es.start) / es.duration, 0, 1)
            if (te >= 1) {
              echoStatesRef.current.delete(particle.id)
            } else {
              // Symmetric out-and-back envelope
              const amp = Math.sin(Math.PI * te) // 0..1..0
              const theta = es.baseAngle + te * 5.3
              const rad = es.mag * amp
              const dx = Math.cos(theta) * rad
              const dy = Math.sin(theta * 0.9) * rad * 0.33
              const dz = rad * 0.85 * es.zSign
              x += dx; y += dy; z += dz
              echoActive = amp > 0.12
              echoSnapFlash = te > 0.85
            }
          }
        }

        // Apply world rotation
        const cosY = Math.cos(worldRotY), sinY = Math.sin(worldRotY)
        const wx = x * cosY + z * sinY
        const wz = -x * sinY + z * cosY
        const cosX = Math.cos(worldRotX), sinX = Math.sin(worldRotX)
        const wy = y * cosX - wz * sinX
        const wzz = y * sinX + wz * cosX

        // Screen shake (only during settle)
        const fx = wx + shakeX * (1 - tSettle)
        const fy = wy + shakeY * (1 - tSettle)
        const fz = wzz

        // Project
        const scale = fov / (fov + fz)
        const sx = fx * scale
        const sy = fy * scale
        const gx = Math.round(sx + (width - 1) / 2)
        const gy = Math.round(sy + (height - 1) / 2)

        if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
          const idx = gy * width + gx
          const d = -fz
          if (d > depth[idx]) {
            depth[idx] = d

            // Shade during fall or echo; flash on snap-in (intro or echo)
            if (inFall || echoActive) {
              const lambert = Math.max(0, particle.nx * lx + particle.ny * ly + particle.nz * lz)
              const ambient = 0.25
              const b = clamp(ambient + lambert * 0.8, 0, 1)
              const i = Math.min(shadingCharset.length - 1, Math.floor(b * (shadingCharset.length - 1)))
              const shadeChar = shadingCharset[i]
              chars[idx] = echoSnapFlash ? '█' : shadeChar
            } else {
              const snapT = Math.max(0, 1 - tSettle)
              const flash = snapT > 0.85 ? '█' : particle.char
              chars[idx] = flash
            }
          }
        }
      }

      // Compose frame
      const outLines: string[] = []
      for (let y = 0; y < height; y++) {
        const from = y * width
        outLines.push(chars.slice(from, from + width).join(''))
      }
      pre.textContent = outLines.join('\n')

      frameRef.current = raf(draw)
    }

    frameRef.current = raf(draw)
    return () => {
      running = false
      if (frameRef.current != null) caf(frameRef.current)
    }
  }, [
    width, height, paused,
    spinDurationMs, cameraDollyMs, fallDurationMs, settleDurationMs,
    shadingCharset, groups.segments.length, shakeIntensity,
    idleMode, idlePulseMinDelayMs, idlePulseMaxDelayMs, idlePulseDurationMs, idlePulseAngleDeg,
    idleArtifactMinDelayMs, idleArtifactMaxDelayMs, idleArtifactDurationMs, idleArtifactMagnitude, idleArtifactFraction
  ])

  return (
    <pre
      ref={preRef}
      className={`${colorClassName} ascii-logo text-[10px] sm:text-xs md:text-sm lg:text-base xl:text-lg 2xl:text-xl font-mono select-none`}
      aria-label="SCHALTWERK 3D assembled logo"
    />
  )
}