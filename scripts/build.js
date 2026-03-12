#!/usr/bin/env node
// ── Imara Vision Agent — Build Script ─────────────────────────────
// Compiles TypeScript, copies static assets, and prepares for packaging.

import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')
const SRC = join(ROOT, 'src')

console.log('Building Imara Vision Agent...\n')

// 1. tsc already compiled to dist/ — do NOT clean it
mkdirSync(DIST, { recursive: true })
console.log('  TypeScript compiled to dist/')

// 3. Copy static UI assets (HTML, CSS, JS)
const uiSrc = join(SRC, 'desktop', 'ui')
const uiDist = join(DIST, 'desktop', 'ui')
if (existsSync(uiSrc)) {
  cpSync(uiSrc, uiDist, { recursive: true })
  console.log('  Copied desktop UI assets')
}

// 4. Assets stay at root level — electron-builder reads from assets/ directly
console.log('  Assets at assets/ (used by electron-builder)')

console.log('\nBuild complete!')
console.log('  Run `npm run package` to create installers.')
