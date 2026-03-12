#!/usr/bin/env node
// ── Generate placeholder app icons ──────────────────────────────────
// Creates a simple SVG icon and notes about platform-specific icons.
// For production, replace with proper .ico, .icns, and .png icons.

import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const ICONS_DIR = join(ROOT, 'assets', 'icons')

if (!existsSync(ICONS_DIR)) {
  mkdirSync(ICONS_DIR, { recursive: true })
}

// Simple SVG icon (Imara Vision logo — concentric circles)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#4f46e5"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#g)"/>
  <circle cx="256" cy="256" r="140" stroke="white" stroke-width="14" fill="none"/>
  <circle cx="256" cy="256" r="50" fill="white"/>
</svg>`

writeFileSync(join(ICONS_DIR, 'icon.svg'), svg)
console.log('Generated assets/icons/icon.svg')

console.log(`
To create platform-specific icons from icon.svg:

Windows (.ico):
  Use https://convertico.com or imagemagick:
  magick convert icon.svg -resize 256x256 icon.ico

macOS (.icns):
  Use iconutil on macOS or https://cloudconvert.com:
  mkdir icon.iconset
  sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
  iconutil -c icns icon.iconset

Linux (.png - multiple sizes):
  magick convert icon.svg -resize 256x256 icon.png
  magick convert icon.svg -resize 512x512 512x512.png

Place the generated files in assets/icons/
`)
