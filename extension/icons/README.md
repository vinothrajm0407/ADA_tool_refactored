# Extension Icons

Place three PNG files here:

| File | Size |
|---|---|
| `icon-16.png` | 16 × 16 px |
| `icon-48.png` | 48 × 48 px |
| `icon-128.png` | 128 × 128 px |

## Generate automatically

```bash
cd extension
npm install -D sharp
node scripts/generate-icons.mjs
```

## Generate manually

Export the ADA shield SVG from BrandLogo.jsx (ShieldMark component)
at 16, 48, and 128 px using Figma, Inkscape, or any SVG exporter.
The shield fill color is `#0F766E` (teal).

The extension will load (with Chrome's default puzzle-piece icon)
even if these files are missing — add them before submitting to the store.
