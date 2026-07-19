import { useState, useEffect, useRef } from 'react'
import { fetchRecoveryStatus, fetchEntries, saveEntry, checkHealth } from './api'

// ─── Palette — 5-colour Galaxy ────────────────────────────────────────────────
// #E70D98  hot magenta  · #991FA6  deep violet  · #F040B8  neon pink
// #30C0B7  bright teal  · #498099  muted steel-blue
const C = {
  bg:      '#04020C',
  paper:   '#080614',
  panel:   '#0B0818',
  pink:    '#E70D98',   // hot magenta
  yellow:  '#30C0B7',   // bright teal  (primary accent)
  green:   '#498099',   // muted steel-blue
  blue:    '#498099',   // muted steel-blue (alias)
  cyan:    '#30C0B7',   // bright teal  (alias)
  orange:  '#F040B8',   // neon pink
  white:   '#E8F4F8',   // cool off-white
  dim:     '#4A6070',
  border:  '#1A2A38',
  radical:    '#E70D98',
  watermelon: '#E70D98',
  tangerine:  '#F040B8',
  hippieGreen:'#991FA6',
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Mood = 'wild' | 'mellow' | 'charged' | 'grounded'
type Screen = 'home' | 'new-entry' | 'list' | 'search' | 'settings' | 'recovery'

interface Entry {
  id: string
  title: string
  body: string
  mood: Mood
  createdAt: string
  updatedAt: string
}

const MOOD_META: Record<Mood, { label: string; symbol: string; color: string; bg: string }> = {
  wild:     { label: 'WILD',     symbol: '★', color: '#E70D98', bg: '#130310' },  // hot magenta
  mellow:   { label: 'MELLOW',   symbol: '◆', color: '#30C0B7', bg: '#031210' },  // bright teal
  charged:  { label: 'CHARGED',  symbol: '▲', color: '#991FA6', bg: '#0C0414' },  // deep violet
  grounded: { label: 'GROUNDED', symbol: '●', color: '#498099', bg: '#060E14' },  // steel-blue
}

const SAMPLE_ENTRIES: Entry[] = [
  {
    id: '1',
    title: 'Colours Bleeding Into the Walls',
    body: 'Woke up with the strangest sensation that every surface had a halo. The morning light was violet. I traced patterns on the windowsill and they wrote back to me in spirals.',
    mood: 'wild',
    createdAt: '2026-07-15T08:22:00Z',
    updatedAt: '2026-07-15T08:22:00Z',
  },
  {
    id: '2',
    title: 'Quiet Like Deep Water',
    body: 'Nothing happened today but everything felt significant. The hum of the fridge became music. I made tea and watched the steam curl. My thoughts were pink and slow.',
    mood: 'mellow',
    createdAt: '2026-07-14T21:10:00Z',
    updatedAt: '2026-07-14T21:10:00Z',
  },
  {
    id: '3',
    title: '3AM Signal Burst',
    body: 'Brain was a supercollider. Ideas colliding at the speed of blue light. Wrote six pages. Deleted three. The other three are inside these walls now, breathing.',
    mood: 'charged',
    createdAt: '2026-07-13T03:04:00Z',
    updatedAt: '2026-07-13T03:04:00Z',
  },
  {
    id: '4',
    title: 'Roots and Mycelium',
    body: "Walked barefoot on the grass. Felt the whole network beneath me — living, talking, feeding. I am part of something older than language. That felt enough for today.",
    mood: 'grounded',
    createdAt: '2026-07-12T17:45:00Z',
    updatedAt: '2026-07-12T17:45:00Z',
  },
  {
    id: '5',
    title: 'Electric Sunday',
    body: 'Every object had a twin today. Shadow and substance. Listened to records on repeat until the words lost meaning and became pure sound. Wrote this in the dark.',
    mood: 'charged',
    createdAt: '2026-07-11T22:33:00Z',
    updatedAt: '2026-07-11T22:33:00Z',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function isoKey(iso: string) { return iso.slice(0, 10) }

// ─── Shared primitives ────────────────────────────────────────────────────────

// Watermark: flat coloured blobs at very low opacity, no blur — sharp psychedelic colour fields
function Watermark({ opacity = 0.07, open = false }: { opacity?: number; open?: boolean }) {
  const o = open ? opacity * 0.4 : opacity
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -40, left: -40, width: 220, height: 160, background: C.pink,   opacity: o * 0.6, borderRadius: '50%' }} />
      <div style={{ position: 'absolute', top: 20,  right: -60, width: 180, height: 180, background: C.blue,  opacity: o * 0.5, borderRadius: '50%' }} />
      <div style={{ position: 'absolute', bottom: -30, left: 60,  width: 200, height: 120, background: C.cyan,  opacity: o * 0.5, borderRadius: '50%' }} />
      <div style={{ position: 'absolute', bottom: 0, right: 0,   width: 140, height: 140, background: C.green, opacity: o * 0.4, borderRadius: '50%' }} />
      <div style={{ position: 'absolute', top: '40%', left: '30%', width: 160, height: 100, background: C.yellow, opacity: o * 0.35, borderRadius: '50%' }} />
    </div>
  )
}

function Tag({ mood, small }: { mood: Mood; small?: boolean }) {
  const m = MOOD_META[mood]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: small ? '2px 8px' : '4px 10px',
      border: `2px solid ${m.color}`,
      background: m.bg,
      color: m.color,
      fontFamily: "'Orbitron', sans-serif",
      fontSize: small ? 9 : 10,
      fontWeight: 700,
      letterSpacing: '0.12em',
      borderRadius: 4,
    }}>
      <span>{m.symbol}</span>
      <span>{m.label}</span>
    </span>
  )
}

function MoodBtn({ mood, selected, onClick }: { mood: Mood; selected: boolean; onClick: () => void }) {
  const m = MOOD_META[mood]
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        border: `3px solid ${selected ? m.color : C.border}`,
        background: selected ? m.color : 'transparent',
        color: selected ? C.bg : C.dim,
        fontFamily: "'Orbitron', sans-serif",
        fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
        cursor: 'pointer',
        transition: 'none',
        borderRadius: 6,
      }}
    >{m.symbol} {m.label}</button>
  )
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function Calendar({ entries, onSelectDay, onClose }: {
  entries: Entry[]; onSelectDay: (k: string) => void; onClose: () => void
}) {
  const today = new Date()
  const [yr, setYr] = useState(today.getFullYear())
  const [mo, setMo] = useState(today.getMonth())

  const dotMap: Record<string, Mood[]> = {}
  entries.forEach(e => {
    const k = isoKey(e.createdAt)
    if (!dotMap[k]) dotMap[k] = []
    dotMap[k].push(e.mood)
  })

  const daysInMo = new Date(yr, mo + 1, 0).getDate()
  const firstDow = new Date(yr, mo, 1).getDay()
  const todayKey = isoKey(today.toISOString())
  const monthLabel = new Date(yr, mo, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()

  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMo }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  function prev() { mo === 0 ? (setYr(y => y - 1), setMo(11)) : setMo(m => m - 1) }
  function next() { mo === 11 ? (setYr(y => y + 1), setMo(0)) : setMo(m => m + 1) }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)' }} />
      <div style={{
        position: 'relative', zIndex: 1,
        background: C.paper,
        border: `3px solid ${C.yellow}`,
        width: 'min(380px, 94vw)',
        padding: 0,
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {/* Header bar */}
        <div style={{ background: C.yellow, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={prev} style={{ background: 'none', border: '2px solid #000', padding: '2px 10px', fontFamily: "'Orbitron', sans-serif", fontSize: 14, fontWeight: 900, cursor: 'pointer', borderRadius: 6 }}>‹</button>
          <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 900, color: '#000', letterSpacing: '0.1em' }}>{monthLabel}</span>
          <button onClick={next} style={{ background: 'none', border: '2px solid #000', padding: '2px 10px', fontFamily: "'Orbitron', sans-serif", fontSize: 14, fontWeight: 900, cursor: 'pointer', borderRadius: 6 }}>›</button>
        </div>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `2px solid ${C.border}` }}>
          {['SU','MO','TU','WE','TH','FR','SA'].map(d => (
            <div key={d} style={{ textAlign: 'center', padding: '8px 0', fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.dim, borderRight: `1px solid ${C.border}` }}>{d}</div>
          ))}
        </div>
        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} style={{ borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, minHeight: 52 }} />
            const dk = `${yr}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const moods = dotMap[dk] || []
            const has = moods.length > 0
            const isToday = dk === todayKey
            return (
              <button
                key={i}
                onClick={() => { if (has) { onSelectDay(dk); onClose() } }}
                style={{
                  minHeight: 52,
                  borderTop: `1px solid ${C.border}`,
                  borderRight: `1px solid ${C.border}`,
                  borderBottom: `1px solid ${C.border}`,
                  borderLeft: `1px solid ${C.border}`,
                  background: isToday ? C.pink : has ? '#1A1A1A' : 'transparent',
                  color: isToday ? '#fff' : has ? C.white : C.dim,
                  fontFamily: "'DM Mono', monospace", fontSize: 12,
                  cursor: has ? 'pointer' : 'default',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                  outline: 'none',
                  borderRadius: 6,
                }}
              >
                <span>{day}</span>
                {has && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    {moods.slice(0, 3).map((mood, mi) => (
                      <div key={mi} style={{ width: 5, height: 5, background: MOOD_META[mood].color, borderRadius: 2 }} />
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '10px',
            background: C.border, border: 'none',
            color: C.white, fontFamily: "'Orbitron', sans-serif", fontSize: 10, letterSpacing: '0.1em',
            cursor: 'pointer',
            borderRadius: 6,
          }}
        >CLOSE</button>
      </div>
    </div>
  )
}

// ─── Entry Detail ─────────────────────────────────────────────────────────────
function EntryDetail({ entry, onBack }: { entry: Entry; onBack: () => void }) {
  const m = MOOD_META[entry.mood]
  return (
    <div style={{ background: C.bg, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top strip */}
      <div style={{ background: m.color, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: '2px solid #000', padding: '3px 10px', fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 900, cursor: 'pointer', color: '#000', borderRadius: 6 }}>← BACK</button>
        <Tag mood={entry.mood} />
        <span style={{ marginLeft: 'auto', fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#000', opacity: 0.7 }}>
          {fmtDate(entry.createdAt)} {fmtTime(entry.createdAt)}
        </span>
      </div>
      {/* Body */}
      <div style={{ flex: 1, padding: '32px 28px', position: 'relative', overflow: 'hidden' }}>
        <Watermark open />
        <div style={{ position: 'relative' }}>
          <h2 style={{
            fontFamily: "'Orbitron', sans-serif", fontWeight: 900, fontSize: 'clamp(18px, 3vw, 28px)',
            color: m.color, margin: '0 0 24px',
            textTransform: 'uppercase', letterSpacing: '0.04em',
            borderLeft: `5px solid ${m.color}`, paddingLeft: 16,
          }}>{entry.title}</h2>
          <div style={{
            background: C.panel, border: `2px solid ${C.border}`,
            padding: '28px 24px',
            position: 'relative', overflow: 'hidden',
            borderRadius: 8,
          }}>
            <div className="stripe-h" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
            <p style={{ position: 'relative', color: C.white, fontSize: 16, lineHeight: 1.9, margin: 0, whiteSpace: 'pre-wrap', fontFamily: "'DM Sans', sans-serif" }}>
              {entry.body}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Entry Card ───────────────────────────────────────────────────────────────
function EntryCard({ entry, onClick }: { entry: Entry; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  const m = MOOD_META[entry.mood]
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? m.bg : C.paper,
        border: `3px solid ${hov ? m.color : C.border}`,
        padding: '16px 18px',
        cursor: 'pointer',
        position: 'relative', overflow: 'hidden',
        transition: 'border-color 0.1s, background 0.1s',
        borderRadius: 8,
      }}
    >
      <Watermark opacity={0.09} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Tag mood={entry.mood} small />
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>{fmtDate(entry.createdAt)}</span>
        </div>
        <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, color: m.color, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {entry.title}
        </div>
        <div style={{ fontSize: 12, color: '#AAAAAA', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {entry.body}
        </div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim, marginTop: 6 }}>{fmtTime(entry.createdAt)}</div>
      </div>
    </div>
  )
}

// ─── New Entry Form ───────────────────────────────────────────────────────────
function NewEntryForm({ onSave, onCancel, initialDraft }: {
  onSave: (e: Entry) => void
  onCancel: () => void
  initialDraft?: { title: string; body: string; mood: Mood } | null
}) {
  const [title, setTitle] = useState(initialDraft?.title ?? '')
  const [body, setBody] = useState(initialDraft?.body ?? '')
  const [mood, setMood] = useState<Mood>(initialDraft?.mood ?? 'wild')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  useEffect(() => {
    if (title || body) {
      localStorage.setItem('unsaved_draft', JSON.stringify({ title, body, mood }))
    } else {
      localStorage.removeItem('unsaved_draft')
    }
  }, [title, body, mood])

  function handleSave() {
    if (!body.trim()) return
    const now = new Date().toISOString()
    onSave({ id: uid(), title: title.trim() || 'Untitled', body: body.trim(), mood, createdAt: now, updatedAt: now })
    localStorage.removeItem('unsaved_draft')
  }

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0
  const m = MOOD_META[mood]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg }}>
      {/* Header bar */}
      <div style={{ background: m.color, padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <button onClick={onCancel} style={{ background: 'none', border: '2px solid #000', padding: '3px 10px', fontFamily: "'Orbitron', sans-serif", fontSize: 10, fontWeight: 900, cursor: 'pointer', color: '#000', borderRadius: 6 }}>CANCEL</button>
        <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 900, color: '#000', letterSpacing: '0.12em' }}>NEW ENTRY</span>
        <button
          onClick={handleSave}
          disabled={!body.trim()}
          style={{
            background: body.trim() ? '#000' : 'rgba(0,0,0,0.3)',
            border: '2px solid #000',
            padding: '3px 14px',
            color: body.trim() ? m.color : 'rgba(0,0,0,0.5)',
            fontFamily: "'Orbitron', sans-serif", fontSize: 10, fontWeight: 900,
            cursor: body.trim() ? 'pointer' : 'not-allowed', letterSpacing: '0.08em',
            borderRadius: 6,
          }}
        >SAVE</button>
      </div>
      {/* Meta bar */}
      <div style={{ background: C.panel, borderBottom: `2px solid ${C.border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim, marginRight: 4 }}>MOOD:</span>
        {(['wild','mellow','charged','grounded'] as Mood[]).map(mo => (
          <MoodBtn key={mo} mood={mo} selected={mood === mo} onClick={() => setMood(mo)} />
        ))}
        <span style={{ marginLeft: 'auto', fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>
      {/* Editor area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="TITLE YOUR ENTRY..."
          style={{
            background: 'transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: `3px solid ${m.color}`,
            outline: 'none', padding: '18px 24px',
            fontFamily: "'Orbitron', sans-serif", fontSize: 18, fontWeight: 900,
            color: m.color, textTransform: 'uppercase',
            caretColor: m.color, flexShrink: 0,
            borderRadius: 6,
          }}
        />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Watermark opacity={0.07} />
          <div className="stripe-h" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={"let it pour out...\n\nno judgement, no structure\njust what's in your head right now"}
            style={{
              position: 'relative', width: '100%', height: '100%',
              background: 'transparent',
              border: 'none', outline: 'none',
              padding: '20px 24px',
              color: C.white, fontSize: 15, lineHeight: 1.8,
              fontFamily: "'DM Sans', sans-serif",
              resize: 'none', caretColor: m.color,
              borderRadius: 6,
            }}
          />
        </div>
      </div>
      {/* Footer */}
      <div style={{ background: C.panel, borderTop: `2px solid ${C.border}`, padding: '8px 20px', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>{wordCount} WORDS</span>
      </div>
    </div>
  )
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function SettingsPanel() {
  const [darkMode, setDarkMode]   = useState(true)
  const [pinLock, setPinLock]     = useState(false)
  const [autoSave, setAutoSave]   = useState(true)
  const [haptics, setHaptics]     = useState(true)

  const rows = [
    { label: 'Dark Mode',       sub: 'Deep black canvas',      on: darkMode,  set: () => setDarkMode(v => !v),  color: C.pink },
    { label: 'Auto-save Drafts',sub: 'Save while you write',   on: autoSave,  set: () => setAutoSave(v => !v),  color: C.cyan },
    { label: 'PIN Lock',        sub: 'Require PIN to open',    on: pinLock,   set: () => setPinLock(v => !v),   color: C.orange },
    { label: 'Haptic Feedback', sub: 'Vibrate on interactions', on: haptics,  set: () => setHaptics(v => !v),   color: C.green },
  ]

  return (
    <div style={{ padding: '24px 24px', overflowY: 'auto', height: '100%' }}>
      <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, color: C.dim, letterSpacing: '0.2em', marginBottom: 20 }}>PREFERENCES</div>
      <div style={{ border: `2px solid ${C.border}`, borderRadius: 8 }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : '0px solid transparent', background: C.paper }}>
            <div>
              <div style={{ fontSize: 14, color: C.white, marginBottom: 2 }}>{r.label}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>{r.sub}</div>
            </div>
            <button
              onClick={r.set}
              style={{
                width: 48, height: 24,
                background: r.on ? r.color : C.border,
                border: `2px solid ${r.on ? r.color : C.dim}`,
                cursor: 'pointer', position: 'relative', flexShrink: 0,
                borderRadius: 12,
              }}
            >
              <div style={{
                position: 'absolute', top: 2, left: r.on ? 24 : 2,
                width: 16, height: 16,
                background: r.on ? '#000' : C.dim,
                transition: 'left 0.15s',
                borderRadius: 4,
              }} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 28, border: `2px solid ${C.border}`, padding: '20px', textAlign: 'center', background: C.paper }}>
        <div className="checker" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
        <div style={{ position: 'relative', fontFamily: "'Orbitron', sans-serif", fontSize: 22, fontWeight: 900, color: C.yellow, letterSpacing: '0.08em', marginBottom: 4 }}>JOURNAL</div>
        <div style={{ position: 'relative', fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>v1.0.0 · your data lives on this device</div>
      </div>
    </div>
  )
}

// ─── Search Panel ─────────────────────────────────────────────────────────────
function SearchPanel({ entries, onOpen }: { entries: Entry[]; onOpen: (e: Entry) => void }) {
  const [query, setQuery] = useState('')
  const [mood, setMood] = useState<Mood | null>(null)

  const results = entries.filter(e => {
    const mOk = !mood || e.mood === mood
    if (!query.trim()) return mOk
    const q = query.toLowerCase()
    return mOk && (e.title.toLowerCase().includes(q) || e.body.toLowerCase().includes(q))
  })

  function hl(text: string) {
    if (!query.trim()) return <>{text}</>
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return <>{parts.map((p, i) => p.toLowerCase() === query.toLowerCase() ? <mark key={i} style={{ background: C.yellow, color: '#000', padding: '0 2px' }}>{p}</mark> : p)}</>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search bar */}
      <div style={{ background: C.panel, borderBottom: `3px solid ${C.cyan}`, padding: '14px 20px', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        <span style={{ color: C.cyan, fontFamily: "'Orbitron', sans-serif", fontSize: 14 }}>◎</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="SEARCH YOUR THOUGHTS..."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontFamily: "'DM Mono', monospace", fontSize: 13,
            color: C.white, caretColor: C.cyan,
            borderRadius: 6,
          }}
        />
      </div>
      {/* Mood filters */}
      <div style={{ background: C.panel, borderBottom: `2px solid ${C.border}`, padding: '10px 20px', display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        {(['wild','mellow','charged','grounded'] as Mood[]).map(m => (
          <MoodBtn key={m} mood={m} selected={mood === m} onClick={() => setMood(mood === m ? null : m)} />
        ))}
      </div>
      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {results.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: C.dim, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
            {query || mood ? 'NO RESULTS' : 'START TYPING TO SEARCH'}
          </div>
        ) : results.map(e => {
          const m = MOOD_META[e.mood]
          return (
            <div key={e.id} onClick={() => onOpen(e)} style={{ background: C.paper, border: `2px solid ${C.border}`, padding: '14px 16px', cursor: 'pointer', position: 'relative', overflow: 'hidden', borderRadius: 8 }}
              onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.borderColor = m.color}
              onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.borderColor = C.border}
            >
              <Watermark opacity={0.06} />
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Tag mood={e.mood} small />
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>{fmtDate(e.createdAt)}</span>
                </div>
                <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 700, color: m.color, marginBottom: 4, textTransform: 'uppercase' }}>{hl(e.title)}</div>
                <div style={{ fontSize: 12, color: '#AAAAAA', lineHeight: 1.6 }}>{hl(e.body.slice(0, 130))}…</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Recovery Screen ──────────────────────────────────────────────────────────
function RecoveryScreen({ draft, onRestore, onDiscard }: {
  draft: { title: string; body: string; mood: Mood }
  onRestore: () => void
  onDiscard: () => void
}) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{
        maxWidth: 400, width: '100%',
        border: `3px solid ${C.pink}`,
        background: C.paper,
        animation: 'recovery-flash 1.2s ease-in-out infinite',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <div style={{ background: C.pink, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>⚠</span>
          <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 13, fontWeight: 900, color: '#000', letterSpacing: '0.1em' }}>UNSAVED DRAFT FOUND</span>
        </div>
        <div style={{ padding: '24px 24px 20px' }}>
          <p style={{ color: '#AAAAAA', fontSize: 13, lineHeight: 1.7, margin: '0 0 20px' }}>
            An incomplete entry was found. Your last writing session was interrupted. Do you want to restore it?
          </p>
          <div style={{ background: C.panel, border: `2px solid ${C.border}`, padding: '14px 16px', marginBottom: 20, position: 'relative', overflow: 'hidden', borderRadius: 8 }}>
            <Watermark opacity={0.08} />
            <div style={{ position: 'relative' }}>
              <Tag mood={draft.mood} small />
              <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, color: C.white, margin: '8px 0 4px', textTransform: 'uppercase' }}>{draft.title || 'Untitled'}</div>
              <div style={{ fontSize: 12, color: '#AAAAAA' }}>{draft.body.slice(0, 80)}…</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim, marginTop: 6 }}>
                {draft.body.trim().split(/\s+/).length} words recovered
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onDiscard}
              style={{
                flex: 1, padding: '12px',
                background: 'transparent', border: `2px solid ${C.border}`,
                color: C.dim, fontFamily: "'Orbitron', sans-serif", fontSize: 10, fontWeight: 700,
                cursor: 'pointer', letterSpacing: '0.08em',
                borderRadius: 6,
              }}
            >DISCARD</button>
            <button
              onClick={onRestore}
              style={{
                flex: 2, padding: '12px',
                background: C.pink, border: `2px solid ${C.pink}`,
                color: '#000', fontFamily: "'Orbitron', sans-serif", fontSize: 10, fontWeight: 900,
                cursor: 'pointer', letterSpacing: '0.08em',
                borderRadius: 6,
              }}
            >RESTORE DRAFT</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── WAL Recovery Banner (backend crash recovery, separate from the
// client-side unsaved-draft recovery above) ────────────────────────────────
function WalRecoveryBanner({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999,
      background: C.yellow, color: '#000',
      padding: '10px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      fontFamily: "'DM Mono', monospace", fontSize: 12,
    }}>
      <span>
        ⚠ Recovered from an unexpected shutdown — {count} {count === 1 ? 'entry was' : 'entries were'} restored from the crash log.
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: 'transparent', border: '1px solid #000', color: '#000',
          fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: 'pointer',
          padding: '2px 8px', borderRadius: 4,
        }}
      >DISMISS</button>
    </div>
  )
}

// ─── DESKTOP LAYOUT ───────────────────────────────────────────────────────────
function DesktopApp({ entries, onAddEntry, draft, onRestore, onDiscard }: {
  entries: Entry[]
  onAddEntry: (e: Entry) => void
  draft: { title: string; body: string; mood: Mood } | null
  onRestore: () => void
  onDiscard: () => void
}) {
  const [screen, setScreen] = useState<Screen>(draft ? 'recovery' : 'home')
  const [openEntry, setOpenEntry] = useState<Entry | null>(null)
  const [calOpen, setCalOpen] = useState(false)

  // ── Todo list state ────────────────────────────────────────────────────────
  interface TodoItem { id: string; text: string; done: boolean }
  const [todos, setTodos] = useState<TodoItem[]>(() => {
    try { const r = localStorage.getItem('journal_todos'); return r ? JSON.parse(r) : [] } catch { return [] }
  })
  const [newTodo, setNewTodo] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  useEffect(() => { localStorage.setItem('journal_todos', JSON.stringify(todos)) }, [todos])

  function addTodo() {
    if (!newTodo.trim()) return
    setTodos(prev => [...prev, { id: Math.random().toString(36).slice(2), text: newTodo.trim(), done: false }])
    setNewTodo('')
  }
  function toggleTodo(id: string) { setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t)) }
  function deleteTodo(id: string) { setTodos(prev => prev.filter(t => t.id !== id)) }
  function startEdit(t: TodoItem) { setEditingId(t.id); setEditText(t.text) }
  function commitEdit(id: string) { setTodos(prev => prev.map(t => t.id === id ? { ...t, text: editText.trim() || t.text } : t)); setEditingId(null) }
  const [dateFilter, setDateFilter] = useState<string | null>(null)

  if (screen === 'recovery' && draft) {
    return <RecoveryScreen draft={draft} onRestore={() => { onRestore(); setScreen('new-entry') }} onDiscard={() => { onDiscard(); setScreen('home') }} />
  }

  const navItems: { id: Screen; label: string; color: string }[] = [
    { id: 'home',      label: 'HOME',     color: C.yellow },
    { id: 'list',      label: 'JOURNAL',  color: C.pink   },
    { id: 'new-entry', label: '+ NEW',    color: C.green  },
    { id: 'search',    label: 'SEARCH',   color: C.cyan   },
    { id: 'settings',  label: 'SETTINGS', color: C.dim    },
  ]

  const displayEntries = dateFilter
    ? entries.filter(e => isoKey(e.createdAt) === dateFilter)
    : entries

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: C.bg }}>
      {/* Top nav bar */}
      <div style={{ background: '#000', borderBottom: `3px solid ${C.yellow}`, display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ padding: '0 24px', display: 'flex', alignItems: 'center', borderRight: `3px solid ${C.yellow}`, background: C.yellow, borderRadius: 0 }}>
          <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 18, fontWeight: 900, color: '#000', letterSpacing: '0.15em' }}>JOURNAL</span>
        </div>
        {/* Nav items */}
        {navItems.map(n => {
          const active = screen === n.id
          return (
            <button
              key={n.id}
              onClick={() => { setScreen(n.id); setOpenEntry(null) }}
              style={{
                padding: '14px 22px',
                background: active ? n.color : 'transparent',
                borderTop: 'none', borderLeft: 'none', borderBottom: 'none', borderRight: `1px solid ${C.border}`,
                color: active ? '#000' : C.dim,
                fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 700,
                letterSpacing: '0.1em', cursor: 'pointer',
                transition: 'background 0.1s, color 0.1s',
                borderRadius: 6,
              }}
              onMouseEnter={ev => { if (!active) { (ev.currentTarget as HTMLElement).style.background = n.color + '22'; (ev.currentTarget as HTMLElement).style.color = n.color } }}
              onMouseLeave={ev => { if (!active) { (ev.currentTarget as HTMLElement).style.background = 'transparent'; (ev.currentTarget as HTMLElement).style.color = C.dim } }}
            >{n.label}</button>
          )
        })}
        {/* Date + calendar button — top right */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 0, borderLeft: `1px solid ${C.border}` }}>
          {dateFilter && (
            <button
              onClick={() => setDateFilter(null)}
              style={{ background: '#FF6B1A', border: 'none', padding: '0 10px', height: '100%', fontFamily: "'DM Mono', monospace", fontSize: 8, color: '#000', cursor: 'pointer', fontWeight: 700, letterSpacing: '0.05em', borderRadius: 6 }}
            >
              {new Date(dateFilter + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()} ✕
            </button>
          )}
          <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', borderRight: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
            </span>
          </div>
          <button
            onClick={() => setCalOpen(true)}
            title="Browse by date"
            style={{
              background: C.yellow, border: 'none',
              padding: '0 18px', height: '100%',
              fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 900,
              color: '#000', cursor: 'pointer', letterSpacing: '0.05em',
              display: 'flex', alignItems: 'center', gap: 7,
              borderRadius: 6,
            }}
          >
            <span style={{ fontSize: 14 }}>⬡</span>
            <span>CALENDAR</span>
          </button>
        </div>
      </div>

      {/* Main layout: sidebar + content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT SIDEBAR — entry list */}
        <div style={{ width: 260, borderRight: `3px solid ${C.border}`, display: 'flex', flexDirection: 'column', background: C.paper, flexShrink: 0, borderRadius: 8 }}>
          {/* Sidebar header */}
          <div style={{ background: C.panel, borderBottom: `2px solid ${C.border}`, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 10, color: C.pink, letterSpacing: '0.1em' }}>ENTRIES</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {dateFilter && (
                <button onClick={() => setDateFilter(null)} style={{ background: C.orange, border: 'none', padding: '2px 6px', fontFamily: "'DM Mono', monospace", fontSize: 8, color: '#000', cursor: 'pointer', letterSpacing: '0.05em', borderRadius: 6 }}>
                  {new Date(dateFilter + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()} ✕
                </button>
              )}
              {/* Calendar icon */}
              <button
                onClick={() => setCalOpen(true)}
                style={{ background: C.cyan, border: 'none', padding: '4px 8px', fontFamily: "'Orbitron', sans-serif", fontSize: 10, color: '#000', cursor: 'pointer', fontWeight: 900, borderRadius: 6 }}
                title="Calendar"
              >⬡</button>
            </div>
          </div>
          {/* Entry scroll list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {displayEntries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>NO ENTRIES</div>
            ) : displayEntries.map(e => {
              const m = MOOD_META[e.mood]
              const isActive = openEntry?.id === e.id
              return (
                <button
                  key={e.id}
                  onClick={() => { setOpenEntry(e); setScreen('list') }}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: isActive ? m.bg : 'transparent',
                    borderTop: `2px solid ${isActive ? m.color : 'transparent'}`,
                    borderRight: `2px solid ${isActive ? m.color : 'transparent'}`,
                    borderBottom: `2px solid ${isActive ? m.color : 'transparent'}`,
                    borderLeft: `4px solid ${m.color}`,
                    padding: '10px 12px', marginBottom: 4,
                    cursor: 'pointer',
                    borderRadius: 6,
                  }}
                  onMouseEnter={ev => { if (!isActive) (ev.currentTarget as HTMLElement).style.background = '#1E1E1E' }}
                  onMouseLeave={ev => { if (!isActive) (ev.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.dim, marginBottom: 3 }}>{fmtDate(e.createdAt)} · {fmtTime(e.createdAt)}</div>
                  <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 10, fontWeight: 700, color: m.color, textTransform: 'uppercase', marginBottom: 3, lineHeight: 1.3 }}>
                    {e.title.length > 26 ? e.title.slice(0, 26) + '…' : e.title}
                  </div>
                  <Tag mood={e.mood} small />
                </button>
              )
            })}
          </div>
          {/* Sidebar footer count */}
          <div style={{ background: C.panel, borderTop: `2px solid ${C.border}`, padding: '8px 16px' }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.dim }}>
              {dateFilter ? `${displayEntries.length} on this day` : `${entries.length} total entries`}
            </span>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {screen === 'home' && (
            <div style={{ flex: 1, overflow: 'auto', padding: '40px 48px', background: 'rgb(0, 0, 0)' }}>
              {/* Big title block */}
              <div style={{ borderLeft: `8px solid ${C.pink}`, paddingLeft: 24, marginBottom: 40 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.dim, letterSpacing: '0.2em', marginBottom: 8 }}>
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}
                </div>
                <h1 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 'clamp(40px, 5vw, 72px)', fontWeight: 900, color: 'rgb(153, 31, 166)', margin: 0, letterSpacing: '0.06em', lineHeight: 1 }}>JOURNAL</h1>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: C.dim, marginTop: 10, fontStyle: 'italic' }}>a space between thoughts</div>
              </div>

              {/* Stats bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0, border: `3px solid ${C.border}`, marginBottom: 40, borderRadius: 8 }}>
                {[
                  { label: 'TOTAL ENTRIES',  value: entries.length,   color: C.pink   },
                  { label: 'THIS WEEK',       value: entries.filter(e => Date.now() - new Date(e.createdAt).getTime() < 7*86400000).length, color: C.green },
                  { label: 'MOODS CAPTURED', value: new Set(entries.map(e => e.mood)).size, color: C.cyan },
                ].map((s, i) => (
                  <div key={s.label} style={{ padding: '24px 28px', background: C.paper, borderRight: i < 2 ? `2px solid ${C.border}` : '0px solid transparent' }}>
                    <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 'clamp(28px, 3vw, 48px)', fontWeight: 900, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.value}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.dim, letterSpacing: '0.15em' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* ── Todo list ── */}
              <div style={{ marginBottom: 40 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim, letterSpacing: '0.15em' }}>TO-DO</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.dim }}>
                    {todos.filter(t => t.done).length}/{todos.length} done
                  </div>
                </div>

                {/* Table */}
                <div style={{ border: `3px solid ${C.border}`, background: C.paper, borderRadius: 8 }}>
                  {/* Header row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 72px', background: C.yellow, borderBottom: `2px solid ${C.border}` }}>
                    <div style={{ padding: '8px 0 8px 10px', fontFamily: "'Orbitron', sans-serif", fontSize: 8, fontWeight: 900, color: '#fff', background: 'rgb(153, 31, 166)' }}>#</div>
                    <div style={{ padding: '8px 12px', fontFamily: "'Orbitron', sans-serif", fontSize: 8, fontWeight: 900, color: '#fff', letterSpacing: '0.12em', background: 'rgb(153, 31, 166)' }}>TASK</div>
                    <div style={{ padding: '8px 12px', fontFamily: "'Orbitron', sans-serif", fontSize: 8, fontWeight: 900, color: '#fff', letterSpacing: '0.12em', textAlign: 'center', background: 'rgb(153, 31, 166)' }}>STATUS</div>
                  </div>

                  {/* Rows */}
                  {todos.length === 0 && (
                    <div style={{ padding: '22px', textAlign: 'center', fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>
                      no tasks yet — add one below
                    </div>
                  )}
                  {todos.map((t, i) => (
                    <div key={t.id} style={{
                      display: 'grid', gridTemplateColumns: '32px 1fr 72px',
                      borderBottom: `1px solid ${C.border}`,
                      background: t.done ? 'rgba(92,139,104,0.08)' : i % 2 === 0 ? C.paper : C.panel,
                      alignItems: 'center',
                    }}>
                      {/* Row number */}
                      <div style={{ padding: '10px 0 10px 10px', fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.dim }}>{i + 1}</div>

                      {/* Task text — click to edit */}
                      <div style={{ padding: '8px 12px' }}>
                        {editingId === t.id ? (
                          <input
                            autoFocus
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            onBlur={() => commitEdit(t.id)}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(t.id); if (e.key === 'Escape') setEditingId(null) }}
                            style={{
                              width: '100%', background: 'transparent',
                              borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: `2px solid ${C.yellow}`,
                              outline: 'none', color: C.white,
                              fontFamily: "'DM Sans', sans-serif", fontSize: 13,
                              caretColor: C.yellow,
                              borderRadius: 6,
                            }}
                          />
                        ) : (
                          <span
                            onClick={() => startEdit(t)}
                            title="Click to edit"
                            style={{
                              fontSize: 13, color: t.done ? C.dim : C.white,
                              textDecoration: t.done ? 'line-through' : 'none',
                              cursor: 'text',
                              fontFamily: "'DM Sans', sans-serif",
                            }}
                          >{t.text}</span>
                        )}
                      </div>

                      {/* Status + delete */}
                      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                        <button
                          onClick={() => toggleTodo(t.id)}
                          title={t.done ? 'Mark undone' : 'Mark done'}
                          style={{
                            width: 22, height: 22, border: `2px solid ${t.done ? C.green : C.border}`,
                            background: t.done ? C.green : 'transparent',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: t.done ? '#000' : C.dim, fontSize: 10, fontWeight: 900, flexShrink: 0,
                            borderRadius: 6,
                          }}
                        >{t.done ? '✓' : ''}</button>
                        <button
                          onClick={() => deleteTodo(t.id)}
                          title="Delete"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim, fontSize: 14, lineHeight: 1, padding: '0 2px' }}
                          onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.color = C.radical ?? C.orange}
                          onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.color = C.dim}
                        >×</button>
                      </div>
                    </div>
                  ))}

                  {/* Add row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 72px', borderTop: `2px solid ${C.border}`, background: C.panel }}>
                    <div style={{ padding: '10px 0 10px 10px', fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.yellow }}>+</div>
                    <input
                      value={newTodo}
                      onChange={e => setNewTodo(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addTodo()}
                      placeholder="new task... (enter to add)"
                      style={{
                        background: 'transparent', border: 'none', outline: 'none',
                        borderBottom: newTodo ? `2px solid ${C.yellow}` : '2px solid transparent',
                        padding: '10px 12px', color: C.white,
                        fontFamily: "'DM Sans', sans-serif", fontSize: 13,
                        caretColor: C.yellow,
                      }}
                    />
                    <button
                      onClick={addTodo}
                      disabled={!newTodo.trim()}
                      style={{
                        margin: '6px 10px', background: newTodo.trim() ? C.yellow : C.border,
                        border: 'none', color: newTodo.trim() ? '#000' : C.dim,
                        fontFamily: "'Orbitron', sans-serif", fontSize: 8, fontWeight: 900,
                        cursor: newTodo.trim() ? 'pointer' : 'not-allowed', letterSpacing: '0.08em',
                        borderRadius: 6,
                      }}
                    >ADD</button>
                  </div>
                </div>
              </div>

              {/* Recent entries */}
              <div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim, letterSpacing: '0.15em', marginBottom: 14 }}>RECENT</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {entries.slice(0, 4).map(e => <EntryCard key={e.id} entry={e} onClick={() => { setOpenEntry(e); setScreen('list') }} />)}
                </div>
              </div>
            </div>
          )}

          {screen === 'list' && (
            openEntry
              ? <EntryDetail entry={openEntry} onBack={() => setOpenEntry(null)} />
              : (
                <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
                  <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 14, fontWeight: 700, color: C.pink, letterSpacing: '0.1em' }}>ALL ENTRIES</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>{displayEntries.length} shown</span>
                  </div>
                  {displayEntries.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: "'Orbitron', sans-serif", fontSize: 13, color: C.dim }}>
                      {dateFilter ? 'NO ENTRIES ON THIS DAY' : 'NO ENTRIES YET'}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                      {displayEntries.map(e => <EntryCard key={e.id} entry={e} onClick={() => setOpenEntry(e)} />)}
                    </div>
                  )}
                </div>
              )
          )}

          {screen === 'new-entry' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <NewEntryForm
                onSave={e => { onAddEntry(e); setScreen('list') }}
                onCancel={() => setScreen('home')}
                initialDraft={null}
              />
            </div>
          )}

          {screen === 'search' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <SearchPanel entries={entries} onOpen={e => { setOpenEntry(e); setScreen('list') }} />
            </div>
          )}

          {screen === 'settings' && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <SettingsPanel />
            </div>
          )}
        </div>
      </div>

      {/* Calendar overlay */}
      {calOpen && <Calendar entries={entries} onClose={() => setCalOpen(false)} onSelectDay={dk => { setDateFilter(dk); setCalOpen(false) }} />}
    </div>
  )
}

// ─── MOBILE LAYOUT ────────────────────────────────────────────────────────────
function MobileApp({ entries, onAddEntry, draft, onRestore, onDiscard }: {
  entries: Entry[]
  onAddEntry: (e: Entry) => void
  draft: { title: string; body: string; mood: Mood } | null
  onRestore: () => void
  onDiscard: () => void
}) {
  const [screen, setScreen] = useState<Screen>(draft ? 'recovery' : 'home')
  const [openEntry, setOpenEntry] = useState<Entry | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [calOpen, setCalOpen] = useState(false)
  const [dateFilter, setDateFilter] = useState<string | null>(null)

  if (screen === 'recovery' && draft) {
    return <RecoveryScreen draft={draft} onRestore={() => { onRestore(); setScreen('new-entry') }} onDiscard={() => { onDiscard(); setScreen('home') }} />
  }

  if (screen === 'new-entry') {
    return (
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <NewEntryForm
          onSave={e => { onAddEntry(e); setScreen('list') }}
          onCancel={() => setScreen('home')}
          initialDraft={null}
        />
      </div>
    )
  }

  if (screen === 'list' && openEntry) {
    return (
      <div style={{ height: '100dvh', overflowY: 'auto' }}>
        <EntryDetail entry={openEntry} onBack={() => setOpenEntry(null)} />
      </div>
    )
  }

  const displayEntries = dateFilter
    ? entries.filter(e => isoKey(e.createdAt) === dateFilter)
    : entries

  const navItems: { id: Screen; label: string; color: string }[] = [
    { id: 'home',      label: 'HOME',    color: C.yellow },
    { id: 'list',      label: 'LIST',    color: C.pink   },
    { id: 'new-entry', label: '+NEW',    color: C.green  },
    { id: 'search',    label: 'SEARCH',  color: C.cyan   },
    { id: 'settings',  label: 'CONFIG',  color: C.dim    },
  ]

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: C.bg, overflow: 'hidden' }}>
      {/* Mobile top bar */}
      <div style={{ background: '#000', borderBottom: `3px solid ${C.yellow}`, padding: '0', display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
        <div style={{ background: C.yellow, padding: '10px 16px', display: 'flex', alignItems: 'center' }}>
          <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 14, fontWeight: 900, color: '#000', letterSpacing: '0.12em' }}>JOURNAL</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '0 12px' }}>
          {/* Calendar btn */}
          {screen === 'list' && (
            <>
              {dateFilter && <button onClick={() => setDateFilter(null)} style={{ background: C.orange, border: 'none', padding: '4px 8px', fontFamily: "'DM Mono', monospace", fontSize: 8, color: '#000', cursor: 'pointer', borderRadius: 6 }}>CLR ✕</button>}
              <button onClick={() => setCalOpen(true)} style={{ background: C.cyan, border: 'none', padding: '6px 10px', fontFamily: "'Orbitron', sans-serif", fontSize: 11, color: '#000', cursor: 'pointer', fontWeight: 900, borderRadius: 6 }}>⬡</button>
            </>
          )}
          {/* Drawer btn */}
          {screen === 'list' && (
            <button onClick={() => setDrawerOpen(true)} style={{ background: 'transparent', border: `2px solid ${C.border}`, padding: '5px 8px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center', borderRadius: 6 }}>
              {[0,1,2].map(i => <div key={i} style={{ width: 14, height: 2, background: C.pink }} />)}
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* HOME */}
        {screen === 'home' && (
          <div style={{ padding: '28px 20px 20px' }}>
            <div style={{ borderLeft: `6px solid ${C.pink}`, paddingLeft: 16, marginBottom: 28 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.dim, letterSpacing: '0.18em', marginBottom: 6 }}>
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
              </div>
              <h1 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 38, fontWeight: 900, color: C.yellow, margin: 0, lineHeight: 1, letterSpacing: '0.06em' }}>JOURNAL</h1>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 8, fontStyle: 'italic' }}>a space between thoughts</div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', border: `2px solid ${C.border}`, marginBottom: 24, borderRadius: 8 }}>
              {[
                { label: 'ENTRIES',  value: entries.length,   color: C.pink  },
                { label: 'WEEK',     value: entries.filter(e => Date.now() - new Date(e.createdAt).getTime() < 7*86400000).length, color: C.green },
                { label: 'MOODS',    value: new Set(entries.map(e => e.mood)).size, color: C.cyan },
              ].map((s, i) => (
                <div key={s.label} style={{ padding: '16px 10px', background: C.paper, borderRight: i < 2 ? `1px solid ${C.border}` : '0px solid transparent', textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 26, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: C.dim, marginTop: 4, letterSpacing: '0.1em' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Quick actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
              {[
                { label: '+ NEW ENTRY', screen: 'new-entry' as Screen, color: C.green, bg: '#001208' },
                { label: 'MY JOURNAL',  screen: 'list'      as Screen, color: C.pink,  bg: '#1A0010' },
              ].map(a => (
                <button
                  key={a.label}
                  onClick={() => setScreen(a.screen)}
                  style={{
                    padding: '18px 12px',
                    background: a.bg,
                    border: `3px solid ${a.color}`,
                    color: a.color,
                    fontFamily: "'Orbitron', sans-serif", fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.06em', cursor: 'pointer', textAlign: 'center',
                    borderRadius: 6,
                  }}
                >{a.label}</button>
              ))}
            </div>

            {/* Recent */}
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.dim, letterSpacing: '0.15em', marginBottom: 12 }}>RECENT</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {entries.slice(0, 3).map(e => <EntryCard key={e.id} entry={e} onClick={() => { setOpenEntry(e); setScreen('list') }} />)}
            </div>
          </div>
        )}

        {/* LIST */}
        {screen === 'list' && (
          <div style={{ padding: '16px 16px' }}>
            {dateFilter && (
              <div style={{ background: C.panel, border: `2px solid ${C.orange}`, padding: '8px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 8 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.orange }}>
                  {new Date(dateFilter + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' }).toUpperCase()}
                </span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.dim }}>{displayEntries.length} entries</span>
              </div>
            )}
            {displayEntries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', fontFamily: "'Orbitron', sans-serif", fontSize: 12, color: C.dim }}>
                {dateFilter ? 'NO ENTRIES ON THIS DAY' : 'NO ENTRIES YET'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {displayEntries.map(e => <EntryCard key={e.id} entry={e} onClick={() => setOpenEntry(e)} />)}
              </div>
            )}
          </div>
        )}

        {/* SEARCH */}
        {screen === 'search' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <SearchPanel entries={entries} onOpen={e => { setOpenEntry(e); setScreen('list') }} />
          </div>
        )}

        {/* SETTINGS */}
        {screen === 'settings' && <SettingsPanel />}
      </div>

      {/* Mobile bottom nav */}
      <div style={{ background: '#000', borderTop: `3px solid ${C.yellow}`, display: 'flex', flexShrink: 0 }}>
        {navItems.map(n => {
          const active = screen === n.id
          return (
            <button
              key={n.id}
              onClick={() => { setScreen(n.id); setOpenEntry(null) }}
              style={{
                flex: 1,
                padding: '10px 4px',
                background: active ? n.color : 'transparent',
                border: 'none',
                borderRight: `1px solid ${C.border}`,
                color: active ? '#000' : C.dim,
                fontFamily: "'Orbitron', sans-serif", fontSize: 8, fontWeight: 700,
                letterSpacing: '0.06em', cursor: 'pointer',
                borderRadius: 6,
              }}
            >{n.label}</button>
          )
        })}
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100 }} />
          <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 260, background: C.paper, border: `3px solid ${C.pink}`, zIndex: 110, display: 'flex', flexDirection: 'column', borderRadius: '0 10px 10px 0' }}>
            <div style={{ background: C.pink, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 900, color: '#000', letterSpacing: '0.1em' }}>ALL ENTRIES</span>
              <button onClick={() => setDrawerOpen(false)} style={{ background: 'none', border: '2px solid #000', padding: '2px 8px', cursor: 'pointer', color: '#000', fontFamily: "'Orbitron', sans-serif", fontSize: 10, fontWeight: 900, borderRadius: 6 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
              {entries.map(e => {
                const m = MOOD_META[e.mood]
                return (
                  <button
                    key={e.id}
                    onClick={() => { setOpenEntry(e); setDrawerOpen(false) }}
                    style={{
                      width: '100%', textAlign: 'left',
                      background: 'transparent',
                      borderTop: '2px solid transparent',
                      borderRight: '2px solid transparent',
                      borderBottom: '2px solid transparent',
                      borderLeft: `4px solid ${m.color}`,
                      padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
                      borderRadius: 6,
                    }}
                    onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = '#1E1E1E'}
                    onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.dim, marginBottom: 3 }}>{fmtDate(e.createdAt)} · {fmtTime(e.createdAt)}</div>
                    <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 9, fontWeight: 700, color: m.color, textTransform: 'uppercase', marginBottom: 3 }}>
                      {e.title.length > 28 ? e.title.slice(0, 28) + '…' : e.title}
                    </div>
                    <Tag mood={e.mood} small />
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {calOpen && <Calendar entries={entries} onClose={() => setCalOpen(false)} onSelectDay={dk => { setDateFilter(dk); setCalOpen(false) }} />}
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [entries, setEntries] = useState<Entry[]>(() => {
    try {
      const s = localStorage.getItem('journal_entries')
      return s ? JSON.parse(s) : SAMPLE_ENTRIES
    } catch { return SAMPLE_ENTRIES }
  })
  const [draft, setDraft] = useState<{ title: string; body: string; mood: Mood } | null>(() => {
    try {
      const raw = localStorage.getItem('unsaved_draft')
      if (!raw) return null
      const d = JSON.parse(raw)
      return d.body ? d : null
    } catch { return null }
  })
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [walReplayCount, setWalReplayCount] = useState<number | null>(null)

  useEffect(() => {
    checkHealth().then(() => {
      fetchEntries().then(loaded => {
        if (loaded.length > 0) setEntries(loaded)
      })
      fetchRecoveryStatus().then(status => {
        if (status && status.replayedOnLastStartup > 0) {
          setWalReplayCount(status.replayedOnLastStartup)
        }
      })
    })
  }, [])

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  useEffect(() => { localStorage.setItem('journal_entries', JSON.stringify(entries)) }, [entries])

  function addEntry(e: Entry) {
    setEntries(prev => [e, ...prev]) // optimistic UI update
    saveEntry(e).then(saved => {
      // If the backend assigned different fields (e.g. it generated the id
      // server-side), reconcile the optimistic entry with the saved one.
      setEntries(prev => prev.map(existing => existing.id === e.id ? saved : existing))
    })
  }
  function handleRestore() { setDraft(null) }
  function handleDiscard() { localStorage.removeItem('unsaved_draft'); setDraft(null) }

  const shared = { entries, onAddEntry: addEntry, draft, onRestore: handleRestore, onDiscard: handleDiscard }

  return (
    <>
      {walReplayCount !== null && (
        <WalRecoveryBanner count={walReplayCount} onDismiss={() => setWalReplayCount(null)} />
      )}
      {isMobile
        ? <MobileApp {...shared} />
        : <DesktopApp {...shared} />}
    </>
  )
}
