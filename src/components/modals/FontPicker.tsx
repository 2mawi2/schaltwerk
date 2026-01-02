import { useEffect, useMemo, useState } from 'react'

type FontEntry = { family: string; monospace: boolean }

interface Props {
  load: () => Promise<FontEntry[]>
  onSelect: (family: string) => void
  onClose: () => void
}

export function FontPicker({ load, onSelect, onClose }: Props) {
  const [fonts, setFonts] = useState<FontEntry[]>([])
  const [query, setQuery] = useState('')
  const [monoOnly, setMonoOnly] = useState(true)

  useEffect(() => {
    let cancelled = false
    void load().then(list => { if (!cancelled) setFonts(list) })
    return () => { cancelled = true }
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return fonts.filter(f => (!monoOnly || f.monospace) && (q === '' || f.family.toLowerCase().includes(q)))
  }, [fonts, query, monoOnly])

  return (
    <div className="mt-2 p-3 bg-elevated/50 border border-subtle rounded">
      <div className="flex items-center gap-2 mb-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search installed fonts"
          className="flex-1 bg-elevated text-primary rounded px-3 py-2 border border-subtle placeholder-text-muted text-body"
        />
        <label className="flex items-center gap-2 text-caption text-secondary">
          <input type="checkbox" checked={monoOnly} onChange={(e) => setMonoOnly(e.target.checked)} />
          Monospace only
        </label>
        <button onClick={onClose} className="px-3 py-2 text-caption bg-elevated hover:bg-hover border border-subtle rounded text-secondary">Close</button>
      </div>
      <div className="max-h-56 overflow-auto border border-subtle rounded">
        {filtered.length === 0 ? (
          <div className="p-3 text-caption text-muted">No fonts found</div>
        ) : (
          <ul>
            {filtered.map(f => (
              <li key={f.family}>
                <button
                  onClick={() => onSelect(f.family)}
                  className="w-full text-left px-3 py-2 hover:bg-hover/60 transition-colors">
                  <span className="text-secondary">{f.family}</span>
                  {f.monospace ? <span className="ml-2 px-2 py-0.5 text-caption rounded bg-hover text-secondary">mono</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
