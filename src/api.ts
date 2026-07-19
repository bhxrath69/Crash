// API layer — tries the C backend first, falls back to localStorage.
//
// Default is same-origin ('') because in the portable/production build,
// journal(.exe) serves the built frontend AND the API on the same port —
// so relative /api/... requests just work, from any port you launch on.
// For `npm run dev` (separate Vite dev server + separately-running
// backend), set VITE_API_URL in a .env file to point at the backend,
// e.g. VITE_API_URL=http://localhost:8080
const BASE = (import.meta as any).env?.VITE_API_URL ?? ''
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
//
// NOTE: free-tier hosts (e.g. Render) can take 30-60s to wake from a cold
// start. A short timeout here would cause every operation for the rest of
// the session to silently fall back to localStorage — which is exactly
// the bug that made entries look like they "didn't sync" across devices.
// So: generous timeout, and every entry operation below tries the network
// fresh each time rather than trusting a single early snapshot.

let _connected = false
const COLD_START_TIMEOUT_MS = 45000

export function isConnected() { return _connected }

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS) })
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
    const res = await fetch(`${BASE}/api/recovery-status`, { signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ── entries ───────────────────────────────────────────────────────────────────
//
// Each of these tries the real backend fresh, every time — it does NOT
// gate on the cached `_connected` flag from an earlier check, since that
// flag can go stale the instant a cold-start timeout happens once.

export async function fetchEntries(): Promise<Entry[]> {
  try {
    const res = await fetch(`${BASE}/api/entries`, { signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS) })
    if (res.ok) {
      const data: Entry[] = await res.json()
      _connected = true
      // keep localStorage in sync for offline resilience
      localStorage.setItem(LS_KEY, JSON.stringify(data))
      return data
    }
  } catch { /* fall through */ }
  _connected = false
  // localStorage fallback
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function saveEntry(entry: Entry): Promise<Entry> {
  try {
    const res = await fetch(`${BASE}/api/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS),
    })
    if (res.ok) {
      const saved: Entry = await res.json()
      _connected = true
      _patchLocalStorage(saved)
      return saved
    }
  } catch { /* fall through */ }
  _connected = false
  // localStorage fallback
  _patchLocalStorage(entry)
  return entry
}

export async function removeEntry(id: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/entries/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS),
    })
    if (res.ok) _connected = true
  } catch { /* fall through */ }
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
