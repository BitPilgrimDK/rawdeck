# RawDeck ⚡ — Winamp 2.x-Style Web Radio Player

> A modular HTML5 radio player that looks like Winamp 2.x and pulls 20,000+ commercial-free stations from three community-curated GitHub repositories (DonutsDelivery / deroverda / rrradio).

**No install. No build. No backend. No ads. Just open `index.html` in any browser and play.**
** Or run it from github pages https://bitpilgrimdk.github.io/rawdeck/ **

---

## What It Is

RawDeck is a fully self-contained web application that recreates the classic **Winamp 2.x** interface in pure HTML, CSS, and JavaScript. It aggregates radio stations from three curated open-source directories at startup, presenting them in a unified playlist with search, genre filtering, and source tagging.

Every station is **commercial-free and talk-free** — hand-picked by the maintainers of the source projects (credits for hand picking the stations goes to them and thanks).

---

## Features

### Winamp 2.x Interface
- **Metallic grey window frames** with classic raised/sunken beveled borders
- **Blue gradient title bars** with RawDeck branding
- **Neon green VFD-style display** with software glow effect
- **Odometer-style time counter** — click to toggle between elapsed and remaining time
- **Auto-scrolling track marquee** for long radio station names
- **STEREO/kbps/kHz status indicators**
- **32-band frequency spectrum analyzer** powered by Web Audio API
- **Classic transport buttons**: Previous, Play, Pause, Stop, Next, Eject
- **Position seek bar** and **Volume/Balance sliders** with retro block thumbs
- **10-band graphic equalizer** (+ preamp) with ON/OFF, presets, and flat reset
- **Shuffle, Repeat, EQ toggle, and Playlist toggle** buttons

### Station Aggregation
RawDeck fetches stations dynamically at runtime from three sources (no hardcoded lists):

| Source | Type | Stations |
|---|---|---|
| **[rrradio](https://github.com/MarkusSteinbrecher/rrradio)** | Structured JSON | ~24,000 |
| **[recommended-radio-streams](https://github.com/deroverda/recommended-radio-streams)** | Markdown bullet list | ~390 |
| **[Free-Radio-NoAds-NoTalk](https://github.com/DonutsDelivery/Free-Radio-NoAds-NoTalk)** | Markdown research files | ~200 |
| **Custom URLs** (added by you) | Any stream URL | Unlimited |

All stations are unified into a consistent schema: `id`, `name`, `country`, `genre`, `streamUrl`, `favicon`, `source`, and `quality_tier`.

### Search & Filter
- **Free-text search** across station name, genre, country, and source (debounced for performance)
- **Genre dropdown** auto-populated from all loaded stations
- **Source dropdown** to filter by rrradio / deroverda / DonutsDelivery / Custom / Favorites
- **Clear filter button** to reset everything at once

### Playback
- **HTML5 Audio** with **Web Audio API** processing chain
- Resolves `.pls` and `.m3u` playlist URLs to actual audio streams automatically
- Supports `.mp3`, `.aac`, `.ogg`, `.flac`, `.opus`, and other HTML5-compatible formats
- Falls back gracefully when a stream fails
- **Exponential backoff reconnection** with watchdog for live streams (2s → 4s → 8s → 16s → 30s + jitter)
- **Favorites persistence** via localStorage

### Local & Custom Sources
- **Load local audio files** (`.mp3`, `.flac`, `.ogg`, `.wav`, `.m4a`) via the Eject button
- **Add any network stream URL** via the +URL dialog with optional name, genre, and country

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `N` | Next station |
| `P` | Previous station |
| `S` | Stop |
| `V` | Toggle Shuffle |
| `R` | Toggle Repeat |
| `E` | Toggle Equalizer window |
| `L` | Toggle Playlist window |
| `O` | Open local file (Eject) |
| `U` | Add custom stream URL |

---

## Project Structure

The app has been split into three clean frontend files for maintainability:

```
RawDeck/
├── index.html          # HTML layout — structure and markup only
├── style.css           # All visual styling extracted from <style>
├── app.js              # All application logic extracted from <script>
├── sw.js               # Service Worker — offline caching
├── manifest.json       # PWA manifest (app name, icons, theme)
├── radio1.png          # PWA app icon
└── README.md           # This file
```

### `index.html`
Contains only the semantic HTML structure — the document outline, all UI elements (player window, equalizer, playlist, dialogs), and external resource links. Zero inline CSS or JS. The Service Worker registration script remains inline in the `<head>` as required by the PWA spec.

### `style.css`
The complete visual design system: Winamp 2.x window frames, VFD display styling, slider tracks and thumbs, EQ bands, playlist items, dialog overlays, responsive breakpoints, and animations. Uses CSS custom properties (`--win-bg`, `--display-text`, `--neon`, etc.) for consistent theming.

### `app.js`
The entire application engine wrapped in an IIFE (Immediately Invoked Function Expression) for scope isolation:
- **State management** — a single `state` object holds all application state
- **DOM references** — cached element lookups via `document.getElementById()`
- **Audio engine** — Web Audio API graph construction (preamp → 10-band EQ → volume → pan → analyser)
- **Reconnection system** — exponential backoff with watchdog for live stream recovery
- **Spectrum analyzer** — canvas-based frequency visualizer with throttled rendering
- **Station fetching** — three data source parsers with deduplication
- **Playlist rendering** — filter/search with virtual rendering
- **Event binding** — all UI event listeners
- **Keyboard shortcuts** — full keybinding system

---

## Service Worker & Offline Caching

The Service Worker (`sw.js`) provides offline support via a **Cache First** strategy:

### Cached Assets
On installation, the SW pre-caches the following files into a named cache (`rawdeck-v2-cache`):

```
./index.html
./style.css
./app.js
./manifest.json
./radio1.png
```

These are the minimal set of files required for the app shell to render and function offline. All three frontend files (`index.html`, `style.css`, `app.js`) are cached together to ensure the app loads correctly without a network connection.

### Cache-First Strategy
```javascript
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});
```

- On every fetch, the SW first checks if the requested resource exists in the cache
- If cached, it returns the cached version immediately (zero network latency)
- If not cached, it falls through to the network (`fetch(e.request)`)
- This means station data (fetched from remote GitHub sources at runtime) is never cached — only the app shell is cached for offline use

### Update Flow
1. When the user revisits the app and the SW script has changed, the browser detects the byte difference
2. The new SW installs in the background while the old one remains active
3. On the next page load, the new SW takes over and caches the updated assets
4. The cache name (`rawdeck-v2-cache`) remains stable; old assets are overwritten in place

### Registration
Registration happens in the `<head>` of `index.html` on page load:
```javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.warn('PWA registration missed: ', err));
  });
}
```

---

## Performance Optimizations

The application includes several performance improvements:

- **Throttled animation loops** — time display updates at ~10fps, spectrum at ~30fps, idle spectrum at ~15fps (instead of all running at 60fps)
- **Consolidated canvas rendering** — single-pass bar drawing with pre-set glow/shadow, avoiding per-bar gradient creation and shadow toggling
- **Debounced search filtering** — playlist re-render is delayed 120ms after the user stops typing
- **Object URL cleanup** — blob URLs created for local file playback are revoked when no longer needed

---

## Getting Started

1. **Open `index.html`** in any modern browser (Chrome, Firefox, Edge, Safari — desktop or mobile).
2. Wait a few seconds while stations load from all three sources.
3. Click a station in the playlist, or press **Play** (►).
4. Use the Equalizer (EQ button) to tweak the sound, or the search bar to find specific genres.

### Running Locally
Since RawDeck is client-side only, you can serve it with any static file server:

```bash
# Python
python -m http.server 8080

# Node.js (npx)
npx serve .

# Or just open index.html directly from the filesystem
```

### Android APK

Since RawDeck is a pure HTML app, you can wrap it into an Android APK:
```bash
# Using a WebView wrapper like https://github.com/nicedoc/WebViewWrapper
# Point the WebView at index.html and package as APK
```

---

## Technical Details

### Architecture
- **Frontend split**: HTML structure (`index.html`), visual design (`style.css`), application logic (`app.js`)
- **CSS**: Custom properties for consistent theming, no preprocessor needed
- **JavaScript**: IIFE pattern with a state object managing all application state
- **Audio**: `HTMLAudioElement` bridged to `AudioContext` via `createMediaElementSource`

### Web Audio Chain
```
Audio Element → Preamp (GainNode) → 10×Peaking EQ Filters → Volume (GainNode) → StereoPanner → Analyser → Destination
```

The EQ filters are BiquadFilterNodes with `type: 'peaking'` at standard ISO frequencies: 31Hz, 62Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz.

### Data Parsing
Each source requires a different parsing strategy:
- **rrradio**: Direct JSON array inside a `{ stations: [...] }` wrapper
- **deroverda**: Markdown bullet lists under `###` headings — parses `[Name](url): desc [Stream](url)` format
- **DonutsDelivery**: Structured markdown research files with `### Name` + `**Stream URL**: ...` fields

### Cross-Origin & Playlist Resolution
- Audio element uses `crossOrigin` for CORS-compatible streams
- `.pls` and `.m3u8`/`.m3u` URLs are fetched and parsed client-side to extract the actual audio endpoint
- HLS (`.m3u8`) native playback depends on browser support

---

## Credits & Data Sources

- **[rrradio](https://github.com/MarkusSteinbrecher/rrradio)** by Markus Steinbrecher — Massive curated radio station catalog with metadata, favicons, and geo-location
- **[recommended-radio-streams](https://github.com/deroverda/recommended-radio-streams)** by deroverda — Hand-picked internet radio stations across underground, freeform, jazz, ambient, and electronic genres
- **[Free-Radio-NoAds-NoTalk](https://github.com/DonutsDelivery/Free-Radio-NoAds-NoTalk)** by DonutsDelivery — Commercial-free internet radio player with curated SomaFM, RadCap, and Radio Paradise stations

### Winamp
Winamp is a registered trademark of Winamp SA. RawDeck is an independent, non-commercial fan project inspired by the Winamp 2.x visual design. No Winamp code or assets are used.

---

## License

MIT — do whatever you want with it. The station data belongs to the respective source repositories and their maintainers.
