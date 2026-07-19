// API layer — tries the C backend first, falls back to localStorage.
// Set VITE_API_URL in .env to override the default localhost:8080.

const BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8080'
const LS_KEY = 'journal_entries'

export type Mood = 'wild' | 'mellow' | 'charged' | 'grounded'

export interface Entry {
  id: string
  title: string
  body: string
  mood: Mood
  createdAt: string
  updatedAt: string
}

// ── connectivity ──────────────────────────────────────────────────────────────

let _connected = false

export function isConnected() { return _connected }

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })
    _connected = res.ok
  } catch {
    _connected = false
  }
  return _connected
}

// ── crash recovery status ───────────────────────────────────────────────────

export interface RecoveryStatus {
  replayedOnLastStartup: number
}

export async function fetchRecoveryStatus(): Promise<RecoveryStatus | null> {
  try {
    const res = await fetch(`${BASE}/api/recovery-status`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ── entries ───────────────────────────────────────────────────────────────────

export async function fetchEntries(): Promise<Entry[]> {
  if (_connected) {
    try {
      const res = await fetch(`${BASE}/api/entries`)
      if (res.ok) {
        const data: Entry[] = await res.json()
        // keep localStorage in sync for offline resilience
        localStorage.setItem(LS_KEY, JSON.stringify(data))
        return data
      }
    } catch { /* fall through */ }
  }
  // localStorage fallback
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function saveEntry(entry: Entry): Promise<Entry> {
  if (_connected) {
    try {
      const res = await fetch(`${BASE}/api/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      if (res.ok) {
        const saved: Entry = await res.json()
        _patchLocalStorage(saved)
        return saved
      }
    } catch { /* fall through */ }
  }
  // localStorage fallback
  _patchLocalStorage(entry)
  return entry
}

export async function removeEntry(id: string): Promise<void> {
  if (_connected) {
    try {
      await fetch(`${BASE}/api/entries/${id}`, { method: 'DELETE' })
    } catch { /* fall through */ }
  }
  _removeLocalStorage(id)
}

// ── helpers ───────────────────────────────────────────────────────────────────

function _patchLocalStorage(entry: Entry) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const entries: Entry[] = raw ? JSON.parse(raw) : []
    const idx = entries.findIndex(e => e.id === entry.id)
    if (idx >= 0) entries[idx] = entry
    else entries.unshift(entry)
    localStorage.setItem(LS_KEY, JSON.stringify(entries))
  } catch { /* ignore */ }
}

function _removeLocalStorage(id: string) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const entries: Entry[] = JSON.parse(raw)
    localStorage.setItem(LS_KEY, JSON.stringify(entries.filter(e => e.id !== id)))
  } catch { /* ignore */ }
}
