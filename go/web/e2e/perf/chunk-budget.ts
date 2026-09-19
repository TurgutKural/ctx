// Deterministic on-disk byte gate (overnight plan C, wave C-W1 = PLc).
//
//   bun run test:budget        (run `bun run build` first — release build,
//                               NO VITE_E2E; in CI both happen inside the
//                               pinned toolchain container)
//
// Reads every dist/**/*.{js,css} artifact plus its precompressed .br sibling
// (the bytes go/web/web.go actually serves) and asserts against
// chunk-budget.json: a per-chunk budget for EVERY chunk (override or
// per-extension default), plus the transfer total. Zero runner variance —
// pure byte counts, no browser. The Lighthouse lab-metric layer is separate
// (nightly, warn-only); THIS gate is the PR authority for bundle bytes.
//
// Design decisions (masterplan C-W1):
//  - dist/ missing or empty is a hard FAIL, never a skip — a wiring bug that
//    runs the gate before the build must be visible (review C3-M2).
//  - A chunk at/above the compression threshold without a .br sibling is a
//    FAIL: precompression is broken, the Go handler would fall back to raw.
//  - Budgets/verdicts hold only for in-container builds (brotli output is
//    toolchain-version-sensitive) — see chunk-budget.json _doc.
//
// The verdict RULES live in budget-rules.ts (pure, unit-tested); this file is
// the IO half: walk dist/, measure, print, exit.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { evaluateBudget, type ArtifactMeasurement, type Budget } from './budget-rules'

const webRoot = new URL('../..', import.meta.url).pathname
const distDir = join(webRoot, 'dist')
const budgetPath = new URL('./chunk-budget.json', import.meta.url).pathname
const budget = JSON.parse(readFileSync(budgetPath, 'utf8')) as Budget

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

if (!existsSync(distDir)) {
  console.error('chunk-budget: dist/ missing — run `bun run build` first (release build, no VITE_E2E)')
  process.exit(1)
}

const files = walk(distDir)
  .filter((p) => /\.(?:js|css)$/.test(p))
  .sort()

if (files.length === 0) {
  console.error('chunk-budget: no js/css artifacts under dist/ — run `bun run build` first')
  process.exit(1)
}

const artifacts: ArtifactMeasurement[] = files.map((file) => {
  const brPath = `${file}.br`
  return {
    rel: relative(distDir, file),
    rawSize: statSync(file).size,
    brSize: existsSync(brPath) ? statSync(brPath).size : null,
  }
})

const { failures, rows, total } = evaluateBudget(artifacts, budget)

console.log(`chunk-budget: ${artifacts.length} artifacts, transfer total ${total} B / limit ${budget.total_transfer_bytes} B`)
if (process.env.CTX_BUDGET_VERBOSE) for (const r of rows) console.log(r)

if (failures.length > 0) {
  console.error(`chunk-budget: ${failures.length} violation(s):`)
  for (const f of failures) console.error(`  FAIL ${f}`)
  process.exit(1)
}
console.log('chunk-budget: OK')
