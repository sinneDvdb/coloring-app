# ColorMe — Smart Coloring Guide

> A browser-based app that analyzes a photo of your empty coloring page and generates a step-by-step coloring guide using your **Ohuhu Honolulu 168 marker set**.

## Quick Start

```bash
cd coloring-app
python3 -m http.server 8080
# Open http://localhost:8080
```

No build step, no dependencies. Three files: `index.html`, `styles.css`, `app.js`, plus `palette.json`.

The guide uses a local llama.cpp vision server. The default endpoint is
`http://192.168.0.52:8001/v1/chat/completions` with model alias `gemma3`.
Change `AI_API_URL` and `AI_MODEL` at the top of `app.js` when needed. The server
must allow browser CORS requests from the address serving this app.

## Architecture

Single-page app, zero dependencies. All processing happens client-side via Canvas API.

### File structure
```
coloring-app/
├── index.html      — UI layout (upload, visual guide, steps, tips)
├── styles.css      — All styling with CSS variables (--accent, --bg, etc.)
├── app.js          — AI analysis, guide rendering, and download logic
├── palette.json    — Ohuhu Honolulu 168 marker codes + hex colors (168 entries)
└── README.md       — This file
```

### Data flow
1. User uploads photo of their empty coloring page (line art)
2. The uploaded image is sent to the local Gemma 3 vision model.
3. The model identifies meaningful areas and chooses a cohesive set of markers from `palette.json`.
4. The response is validated against the built-in Ohuhu 168 palette and rendered as ordered steps.
5. The app provides an approximate visual guide and a downloadable PNG guide image.

## Key Functions in app.js

| Function | Purpose |
|---|---|
| `analyzeWithAI(img)` | Sends the image and marker palette to the local vision model |
| `validateSuggestions(suggestions)` | Rejects invented markers and normalizes model output |
| `renderGuideStep(step)` | Draws the original image with approximate progressive area labels |
| `downloadGuide()` | Creates and downloads a printable PNG guide |
| `renderResults(result)` | Render all UI: region badges, color swatches, steps, tips, visual guide |
| `initVisualGuide(result)` | Set up canvas visual guide with step navigation |

### Visual Guide System

Canvas overlay on top of the coloring page image showing progressive approximate area labels.

- `guideState.currentStep` — current step number (0 = original, 1+ = steps applied)
- `guideState.steps` — array of step objects: `{ color: "#hex", code: "R015", name: "Crimson" }`
- `guideState.guideCanvas` / `guideState.guideCtx` — canvas element and 2D context
- The overlay is intentionally approximate because the vision model returns descriptions,
  not pixel masks.

Controls: Prev, Next, Play/Pause buttons for stepping through the guide.

### AI Color Planning

1. The vision model identifies semantic areas such as sky, petals, leaves, or background.
2. The model chooses colors for harmony, contrast, and coloring order rather than pixel distance.
3. The browser accepts only marker codes present in `palette.json`.
4. The downloadable guide combines the original image, marker choices, reasons, and tips.

## Ohuhu 168 Palette

Built-in, loaded from `palette.json`. This is the **Ohuhu Honolulu 168 Colors** set.

**Source:** [Recapi/ohuhu-colors-kits](https://github.com/Recapi/ohuhu-colors-kits) db.json → "Honolulu/B Classic 168" kit.

Each entry in `palette.json`: `{ code: "R015", name: "Crimson", hex: "#b2484f" }`

**Important:** Do NOT extract colors from a user photo. The user has this specific set — use `palette.json` directly.

**Palette structure:**
- 168 markers total (including 120 Black)
- Codes: 120, B02-B115, BG05-BG315, BGY00-BGY38, BV05-BV514, CG01-CG25, E05-E92, G013-G49, GG03-GG24, R013-R54, RV04-RV34, V010-V416, WG01-WG37, Y02-Y69, YG012-YG510, YGY02-YGY13, YR04-YR59
- Hex values are approximate digital reference colors from community research

## CSS Variables

```css
--bg: #faf8f5;         --card: #ffffff;
--text: #2d2d2d;       --muted: #6b6b6b;
--border: #e8e4df;     --accent: #e07a5f;
--accent-hover: #c96a52; --accent-light: #f4e8e4;
--radius: 16px;        --shadow: 0 4px 24px rgba(0,0,0,0.06);
```

## Git Setup

- **Main branch:** `master` (production)
- **Working branch:** `improve-color-palette-and-guide`
- **Repo:** `sinneDvdb/coloring-app` on GitHub
- **Remote:** `https://github.com/sinneDvdb/coloring-app.git`

## Current Issues / TODO

1. **Approximate regions** — the model describes areas rather than returning pixel masks
2. **No marker exclusion** — user can't exclude specific markers yet
3. **No region editing** — user can't adjust the model's area descriptions yet
4. **No blending guidance** — alcohol markers benefit from knowing which colors blend well together

## Development Notes

- The app is intentionally minimal — no frameworks, no bundler
- All state is in global variables (`guideState`, `analysisResult`, `pageImage`, `ohuhuPalette`)
- The visual guide re-renders the full canvas on each step change (not incremental)
- `palette.json` hex values should have `#` prefix (verified when writing)
- The `describeColor()` function maps HSL values to color names — edit thresholds there to change naming granularity
