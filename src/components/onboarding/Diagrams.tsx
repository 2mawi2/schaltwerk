// Uses the automatic JSX runtime; no React import needed

import { theme } from '../../common/theme'

function Arrow({ x1, y1, x2, y2, color = theme.colors.text.tertiary }: { x1: number; y1: number; x2: number; y2: number; color?: string }) {
  // simple arrow marker replacement (triangle)
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const len = 8
  const ax = x2 - Math.cos(angle) * len
  const ay = y2 - Math.sin(angle) * len
  const left = { x: ax + Math.cos(angle + Math.PI / 2) * (len / 2), y: ay + Math.sin(angle + Math.PI / 2) * (len / 2) }
  const right = { x: ax + Math.cos(angle - Math.PI / 2) * (len / 2), y: ay + Math.sin(angle - Math.PI / 2) * (len / 2) }
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} />
      <polygon points={`${x2},${y2} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />
    </g>
  )
}

export function LifecycleDiagram() {
  // Spec -> Running -> Reviewed -> Integrate -> Cleanup, with two integrate branches
  const text = (x: number, y: number, label: string, cls = 'fill-slate-300') => (
    <text x={x} y={y} className={cls} fontSize={13} textAnchor="middle">{label}</text>
  )
  return (
    <div className="w-full overflow-x-auto flex justify-center">
      <svg viewBox="0 0 720 220" className="w-[92%] max-w-[900px] h-60 block" preserveAspectRatio="xMidYMid meet">
        {text(100, 30, 'Spec')}
        {text(240, 30, 'Running')}
        {text(380, 30, 'Reviewed')}
        {text(520, 30, 'Integrate')}
        {text(640, 30, 'Cleanup')}

        <Arrow x1={130} y1={80} x2={210} y2={80} />
        <Arrow x1={270} y1={80} x2={350} y2={80} />
        <Arrow x1={410} y1={80} x2={490} y2={80} />
        <Arrow x1={550} y1={80} x2={620} y2={80} />

        {/* Stage dots */}
        {[100, 240, 380, 520, 640].map((x) => (
          <circle key={x} cx={x} cy={80} r={6} className="fill-blue-400" />
        ))}

        {/* Integrate branches */}
        <Arrow x1={520} y1={100} x2={610} y2={135} />
        <Arrow x1={520} y1={100} x2={610} y2={170} />
        <text x={614} y={137} fontSize={13} className="fill-slate-400">PR to feature/main</text>
        <text x={614} y={172} fontSize={13} className="fill-slate-400">Squash merge</text>
      </svg>
    </div>
  )
}

export function BranchingDiagram() {
  // Start from main or feature to schaltwerk/session, integrate back
  return (
    <div className="w-full overflow-x-auto flex justify-center">
      <svg viewBox="0 0 720 220" className="w-[92%] max-w-[900px] h-60 block" preserveAspectRatio="xMidYMid meet">
        <text x={100} y={28} fontSize={14} className="fill-slate-300">Start from main</text>
        <text x={100} y={48} fontSize={13} className="fill-slate-400">main</text>
        <Arrow x1={140} y1={44} x2={260} y2={44} />
        <text x={200} y={34} fontSize={11} className="fill-slate-500">create session</text>
        <rect x={260} y={32} width={200} height={28} rx={5} className="fill-slate-800 stroke-slate-600" strokeWidth={1} />
        <text x={360} y={50} fontSize={13} textAnchor="middle" className="fill-emerald-300">schaltwerk/my-session</text>
        <Arrow x1={460} y1={44} x2={620} y2={44} />
        <text x={620} y={48} fontSize={13} className="fill-slate-400">integrate → main</text>

        <text x={100} y={118} fontSize={14} className="fill-slate-300">Start from feature</text>
        <text x={100} y={138} fontSize={13} className="fill-slate-400">feature/payments</text>
        <Arrow x1={200} y1={134} x2={260} y2={134} />
        <rect x={260} y={122} width={200} height={28} rx={5} className="fill-slate-800 stroke-slate-600" strokeWidth={1} />
        <text x={360} y={140} fontSize={13} textAnchor="middle" className="fill-emerald-300">schaltwerk/my-session</text>
        <Arrow x1={460} y1={134} x2={620} y2={134} />
        <text x={620} y={138} fontSize={13} className="fill-slate-400">integrate → feature/payments</text>
      </svg>
    </div>
  )
}

export default function OnboardingDiagrams() { return null }
