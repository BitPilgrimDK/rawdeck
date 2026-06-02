# RawDeck ⚡ — Winamp 2.x-Style Web Radio Player

> A single-file HTML5 radio player that looks like Winamp 2.x and pulls 20,000+ commercial-free stations from three community-curated GitHub repositories.

**No install. No build. No backend. Just open `index.html` in any browser and play.**

---

## What It Is

RawDeck is a fully self-contained web application that recreates the classic **Winamp 2.x** interface in pure HTML, CSS, and JavaScript. It aggregates radio stations from three curated open-source directories at startup, presenting them in a unified playlist with search, genre filtering, and source tagging.

Every station on sources deroverda and donutsdelivery are **commercial-free and talk-free** — hand-picked. 

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
| **[rrradio](https://github.com/MarkusSteinbrecher/rrradio)** | Structured JSON | ~24,000 | some embedded ads on some stations
| **[recommended-radio-streams](https://github.com/deroverda/recommended-radio-streams)** | Markdown bullet list | ~390 | no ads
| **[Free-Radio-NoAds-NoTalk](https://github.com/DonutsDelivery/Free-Radio-NoAds-NoTalk)** | Markdown research files | ~200 | no ads
| **Custom URLs** (added by you) | Any stream URL | Unlimited |

All stations are unified into a consistent schema: `id`, `name`, `country`, `genre`, `streamUrl`, `favicon`, `source`, and `quality_tier`.

### Search & Filter
- **Free-text search** across station name, genre, country, and source
- **Genre dropdown** auto-populated from all loaded stations
- **Source dropdown** to filter by rrradio / deroverda / DonutsDelivery / Custom
- **Clear filter button** to reset everything at once

### Playback
- **HTML5 Audio** with **Web Audio API** processing chain
- Resolves `.pls` and `.m3u` playlist URLs to actual audio streams automatically
- Supports `.mp3`, `.aac`, `.ogg`, `.flac`, `.opus`, and other HTML5-compatible formats
- Falls back gracefully when a stream fails

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

## Getting Started

1. **Open `index.html`** in any modern browser (Chrome, Firefox, Edge, Safari — desktop or mobile).
2. Wait a few seconds while stations load from all three sources.
3. Click a station in the playlist, or press **Play** (►).
4. Use the Equalizer (EQ button) to tweak the sound, or the search bar to find specific genres.

### Android APK

Since RawDeck is a single HTML file, you can wrap it into an Android APK trivially:
```bash
# Using a WebView wrapper like https://github.com/nicedoc/WebViewWrapper
# Point the WebView at index.html and package as APK
```

---

## Technical Details

### Architecture
- **Single file**: Everything is in `index.html` — no dependencies, no build step
- **CSS**: Inline `<style>` block with CSS custom properties for theming
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
