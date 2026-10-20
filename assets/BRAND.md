# Personas — Brand Reference (v3)

Extension: **Personas** (`samerde.personas`)
Tagline: **Easily manage your dev personas:** the different Git identities,
VS Code profiles, and extensions that you need in different contexts.

## Mark

Three heads share one body built from profile-grid cells: the amber head is
the **active persona**, the outlined heads are the contexts you are not in
right now. Filled cells are "installed," outlined cells are "not installed,"
and the extended hand cell reaches across profiles.

## Colors

| Token          | Hex       | Use                                    |
|----------------|-----------|----------------------------------------|
| Midnight       | `#16213E` | Icon tile, gallery banner background   |
| Midnight Deep  | `#131C34` | Banner gradient start                  |
| Midnight Lift  | `#1A2747` | Banner gradient end                    |
| Cell Sky       | `#38BDF8` | Cell gradient start, outline stroke    |
| Cell Cobalt    | `#2563EB` | Cell gradient end                      |
| Persona Amber  | `#F5A623` | Active persona head — one use per mark |
| Text Primary   | `#E8EDF5` | Wordmark (dark backgrounds)            |
| Text Secondary | `#9FB3D1` | Taglines, captions                     |

## Typography

Inter (700 wordmark, 400 taglines). Fallback: Segoe UI, sans-serif.

## package.json snippets

```json
"name": "personas",
"displayName": "Personas",
"description": "Easily manage your dev personas: the different Git identities, VS Code profiles, and extensions that you need in different contexts.",
"icon": "media/icon-256.png",
"galleryBanner": { "color": "#16213E", "theme": "dark" }
```

## Files

- `icon.svg`, `icon-256.png` (marketplace icon), `icon-128.png`
- `logo.svg`/`logo.png` (dark) and `logo-light.svg`/`logo-light.png` (light)
- `banner.svg`, `banner.png` (1280×320) — README hero
- `social-preview.svg`, `social-preview.png` (1280×640) — GitHub social preview
- `blog-hero.svg/png` (1600×840) — personas blog series hero
- `marketplace-mockup`, `matrix-ui-mockup` — design previews (staged data)

## Usage rules

- Amber appears exactly once per composition: the active persona's head.
- Exactly one head is amber; never two active personas.
- The hand cell stays on the right; flip the whole mark rather than moving it.
- Dark logo for dark backgrounds; use `logo-light` on white (outline opacity
  0.55, cobalt strokes, Midnight wordmark).
- Command palette prefix: "Personas:". Activity bar label: "Personas".
