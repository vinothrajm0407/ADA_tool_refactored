/**
 * generate-icons.mjs
 *
 * Generates PNG icon files for the Chrome extension from the ADA shield SVG.
 * Run once before building the extension.
 *
 * Usage:
 *   node scripts/generate-icons.mjs
 *
 * Requires: npm install -D sharp (or: npm install -D @resvg/resvg-js)
 *
 * If you prefer not to install sharp, export the SVG from Figma/Inkscape
 * at 16×16, 48×48, and 128×128 px and place the PNG files in extension/icons/.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ICONS_DIR = join(__dirname, '..', 'icons')

// The shield SVG — identical to ShieldMark.jsx and BrandLogo.jsx
function shieldSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 46" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#0F766E"/>
  <path d="M20 4L34 10V26C34 33 20 40 20 40C20 40 6 33 6 26V10L20 4Z" fill="white" fill-opacity="0.15"/>
  <path d="M20 4L34 10V26C34 33 20 40 20 40C20 40 6 33 6 26V10L20 4Z" stroke="white" stroke-width="1.5"/>
  <circle cx="20" cy="14" r="3" fill="white"/>
  <line x1="20" y1="18" x2="20" y2="26" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M13 22L20 19L27 22" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M20 26L17 32M20 26L23 32" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
</svg>`
}

async function generate() {
  mkdirSync(ICONS_DIR, { recursive: true })

  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.error(
      '\n  ✗  sharp not installed.\n' +
      '     Run: npm install -D sharp\n' +
      '     Then re-run: node scripts/generate-icons.mjs\n\n' +
      '  Alternatively, export the icon from Figma at 16, 48, 128 px\n' +
      '  and place the PNG files in extension/icons/\n'
    )
    process.exit(1)
  }

  const sizes = [16, 48, 128]
  for (const size of sizes) {
    const svg  = Buffer.from(shieldSvg(size))
    const dest = join(ICONS_DIR, `icon-${size}.png`)
    await sharp(svg).resize(size, size).png().toFile(dest)
    console.log(`  ✓  icon-${size}.png`)
  }

  console.log('\n  Icons written to extension/icons/\n')
}

generate().catch(err => {
  console.error(err)
  process.exit(1)
})
