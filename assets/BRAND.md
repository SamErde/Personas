# Profile Extension Manager — Brand Reference (v2, "Personas")

## Mark

One person, many personas. Three heads share one body built from profile-grid
cells: the amber head is the **active persona**, the outlined heads are the
contexts you are not in right now. Filled cells are "installed," outlined
cells are "not installed," and the extended hand cell reaches across profiles —
the product's whole job in one figure.

## Colors

| Token          | Hex       | Use                                    |
|----------------|-----------|----------------------------------------|
| Midnight       | `#16213E` | Icon tile, gallery banner background   |
| Midnight Deep  | `#131C34` | Banner gradient start                  |
| Midnight Lift  | `#1A2747` | Banner gradient end                    |
| Cell Sky       | `#38BDF8` | Cell gradient start, outline stroke    |
| Cell Cobalt    | `#2563EB` | Cell gradient end                      |
| Persona Amber  | `#F5A623` | Active persona head — one use per mark |
| Text Primary   | `#E8EDF5` | Wordmark                               |
| Text Secondary | `#9FB3D1` | Taglines, captions                     |

## Typography

Inter (700 wordmark, 400 taglines). Fallback: Segoe UI, sans-serif.

## Directory roles

- `assets/` stores brand, content, mockup, and other reusable source images for
  the repository, README, blog posts, documentation sites, and social previews.
  It is excluded from the packaged VS Code extension by `.vscodeignore`.
- `media/` stores only the images required by the VS Code extension package,
  such as the Marketplace icon and activity bar icon referenced from `package.json`.

## package.json snippets

```json
"icon": "media/icon-256.png",
"galleryBanner": { "color": "#16213E", "theme": "dark" }
```

## Files

- `icon.svg`, `icon-256.png` (marketplace icon), `icon-128.png`
- `logo.svg`, `logo.png` — horizontal lockup (dark backgrounds)
- `banner.svg`, `banner.png` (1280×320) — README hero
- `social-preview.svg`, `social-preview.png` (1280×640) — GitHub social preview
- `archive-puzzle/` — v1 puzzle-matrix identity, retained for reference

## Usage rules

- Amber appears exactly once per composition: the active persona's head.
- Exactly one head is amber; never two active personas.
- The hand cell stays on the right; flip the whole mark rather than moving it.
- The logo/lockup assumes dark backgrounds (outline cells at 40% opacity
  disappear on white). For light contexts, raise outline opacity to 0.6 and
  swap Text Primary to Midnight.
- No extra cells, faces, or gloss. The filled/outlined contrast is the story.
