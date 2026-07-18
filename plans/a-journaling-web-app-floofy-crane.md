# Plan: Psychedelic Journaling Web App

## Context
Build a 6-screen journaling web app with a trippy psychedelic aesthetic using neon pink (#FF2D9E), violet (#9B30FF), neon green (#39FF14), and electric blue (#00F5FF). The journal notes feature a diluted watermark-texture background that becomes subtler when a note is opened. Screens: Home, New Entry, Journal List, Search, Settings, Recovery.

## Aesthetic Stance: **Kinetic / Dark Psychedelic**
- **Ground**: Deep near-black (#0A0010) — lets neon colors sing
- **Display font**: `Orbitron` (geometric futuristic, wired via Google Fonts) for headings
- **Body font**: `DM Sans` for readable body copy
- **Mono**: `DM Mono` for timestamps, labels, metadata
- **Texture**: SVG-based noise/blob watermark at low opacity (5–12%) on journal card backgrounds, even lower (3–5%) when a note is open

## Design Tokens (in `src/index.css` via Tailwind `@theme`)
```css
--background: #0A0010
--foreground: #F0E6FF
--card: #150025
--card-foreground: #EDD9FF
--primary: #9B30FF       /* violet */
--primary-foreground: #FFFFFF
--secondary: #FF2D9E     /* neon pink */
--secondary-foreground: #FFFFFF
--muted: #1E0035
--muted-foreground: #8B6FAA
--accent: #39FF14        /* neon green */
--accent-foreground: #0A0010
--border: rgba(155,48,255,0.3)
--ring: #00F5FF           /* electric blue */
--radius: 1rem
```

## Screen Architecture (single-page React with useState-driven routing)

### 1. Home (`screen === 'home'`)
- Full-viewport dark canvas with animated mesh gradient (CSS `@keyframes` hue-rotate on conic-gradient blobs)
- App title "JOURNAL" in Orbitron, large, with neon glow text-shadow
- 3 quick-action cards: "New Entry", "My Journal", "Search"
- Recent entries strip at bottom (last 2–3 entries previewed)
- Floating iridescent orb accent in corner

### 2. New Journal Entry (`screen === 'new-entry'`)
- Full-height editor with textarea
- Card background: `--card` with a psychedelic SVG noise watermark at ~8% opacity (pink/violet blobs)
- Toolbar: mood tag chips (🌀 trippy, 🌸 soft, ⚡ electric, 🌿 earthy) colored in the 4 neon colors
- Word count in DM Mono bottom-right
- "Save" CTA button with violet glow

### 3. Journal List (`screen === 'list'`)
- Masonry-style grid of journal cards
- Each card: date in DM Mono, first line preview, mood chip color-coded
- Card background has low-opacity psychedelic blob watermark unique per entry (seeded by entry id)
- Hover: card lifts with a neon glow border
- FAB (+) button for new entry

### 4. Search (`screen === 'search'`)
- Full-width search input with neon blue glow on focus
- Results list with keyword highlights in neon yellow
- Filter chips by mood tag and date range

### 5. Settings (`screen === 'settings'`)
- Sections: Display (dark/light theme toggle), Privacy (PIN lock toggle), About
- Toggle switches styled with the neon accent colors
- App version in DM Mono

### 6. Recovery Screen (`screen === 'recovery'`)
- Shown when `localStorage` contains an `unsaved_draft` key
- Warning card with pulsing neon red/pink border animation
- "Restore Draft" and "Discard" buttons
- Brief explanation text

## Data Model (localStorage)
```ts
type Entry = {
  id: string;
  title: string;
  body: string;
  mood: 'trippy' | 'soft' | 'electric' | 'earthy';
  createdAt: string; // ISO
  updatedAt: string;
}
// Keys: 'journal_entries', 'unsaved_draft'
```

## File Structure
- `src/App.tsx` — full implementation (all screens as conditional renders, shared state)
- `src/index.css` — Tailwind import + `@theme` tokens + `@font-face` / `@import` for Orbitron, DM Sans, DM Mono + keyframe animations

## Watermark Texture Implementation
SVG inline as a `data:` URI background-image on card elements. The SVG contains overlapping blurred ellipses in pink/violet/green at 15% opacity each, cropped to card dimensions. When the entry is "open" (full-screen), opacity drops to `0.04`.

## Fonts
Use Google Fonts `@import` at top of `src/index.css`:
```
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&family=DM+Mono:wght@400;500&display=swap');
```
Place this as the **very first line** before any other `@import` or `@theme` block.

## Verification
1. Check all 6 screens render without errors by clicking nav
2. Create an entry → verify it appears in Journal List
3. Reload with an unsaved draft in localStorage → verify Recovery screen shows
4. Search for a word → verify highlighting works
5. Check watermark texture is visible on cards but very subtle on open entry
