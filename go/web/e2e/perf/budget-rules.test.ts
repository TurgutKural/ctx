// Unit gate on the byte-budget RULES (budget-rules.ts). The script half
// (chunk-budget.ts) needs a built dist/ and exits the process; the rules do
// not, so they are testable — and the stale-override rule in particular must
// stay a failure, because as a warning it accumulated unread across two
// Rolldown rechunkings.

import { describe, expect, it } from 'vitest'
import { evaluateBudget, stemOf, type ArtifactMeasurement, type Budget } from './budget-rules'

const budget: Budget = {
  calibrated: true,
  raw_threshold_bytes: 1024,
  total_transfer_bytes: 1_000_000,
  defaults: { js_br_bytes: 6144, css_br_bytes: 3072 },
  overrides: { 'GraphPage.js': 16_200 },
}

function js(rel: string, brSize: number | null, rawSize = 99_999): ArtifactMeasurement {
  return { rel, rawSize, brSize }
}

describe('stemOf', () => {
  it('strips the 8-char vite content hash from js and css', () => {
    expect(stemOf('GraphPage-Cr0MwOqk.js')).toBe('GraphPage.js')
    expect(stemOf('index-zuPZayN5.css')).toBe('index.css')
  })

  it('leaves an unhashed name alone', () => {
    expect(stemOf('theme-boot.js')).toBe('theme-boot.js')
  })
})

describe('evaluateBudget', () => {
  it('passes a build that stays under every limit', () => {
    const v = evaluateBudget([js('assets/GraphPage-Cr0MwOqk.js', 16_000), js('assets/api-CAUB0fct.js', 500)], budget)
    expect(v.failures).toEqual([])
    expect(v.total).toBe(16_500)
    expect(v.rows).toHaveLength(2)
  })

  it('fails a chunk over its override and one over the per-extension default', () => {
    const v = evaluateBudget([js('assets/GraphPage-Cr0MwOqk.js', 16_201), js('assets/api-CAUB0fct.js', 6_145)], budget)
    expect(v.failures).toHaveLength(2)
    expect(v.failures[0]).toContain("exceeds budget 16200 B for 'GraphPage.js'")
    expect(v.failures[1]).toContain("exceeds budget 6144 B for 'api.js'")
  })

  it('FAILS on a stale override — a name-keyed budget must not rot into decoration', () => {
    // The Rolldown rechunking class: the named chunk is gone, its bytes moved
    // into a chunk that now silently rides the 6144 default. This was a WARN
    // and therefore invisible; it is a failure now.
    const v = evaluateBudget([js('assets/api-CAUB0fct.js', 500)], budget)
    expect(v.failures).toHaveLength(1)
    expect(v.failures[0]).toContain("stale override 'GraphPage.js'")
    expect(v.failures[0]).toContain('re-measure in the pinned container')
  })

  it('fails a missing .br sibling at/above the compression threshold, and only then', () => {
    const noOverrides = { ...budget, overrides: {} }
    const small = evaluateBudget([js('assets/tiny-AAAAAAAA.js', null, 1_023)], noOverrides)
    expect(small.failures).toEqual([])
    expect(small.total).toBe(1_023)

    const big = evaluateBudget([js('assets/big-AAAAAAAA.js', null, 1_024)], noOverrides)
    expect(big.failures).toHaveLength(1)
    expect(big.failures[0]).toContain('precompression broken')
  })

  it('counts an uncompressed artifact at its raw size and skips its per-chunk row', () => {
    const v = evaluateBudget([js('assets/big-AAAAAAAA.js', null, 2_000)], { ...budget, overrides: {} })
    expect(v.total).toBe(2_000)
    expect(v.rows).toEqual([])
  })

  it('fails the transfer total independently of the per-chunk verdicts', () => {
    const v = evaluateBudget([js('assets/a-AAAAAAAA.js', 6_000), js('assets/b-BBBBBBBB.js', 6_000)], {
      ...budget,
      overrides: {},
      total_transfer_bytes: 10_000,
    })
    expect(v.total).toBe(12_000)
    expect(v.failures).toHaveLength(1)
    expect(v.failures[0]).toContain('transfer total 12000 B exceeds total_transfer_bytes 10000 B')
  })

  it('applies the css default to css and the js default to js', () => {
    const v = evaluateBudget([js('assets/x-AAAAAAAA.css', 3_073), js('assets/x-AAAAAAAA.js', 3_073)], {
      ...budget,
      overrides: {},
    })
    expect(v.failures).toHaveLength(1)
    expect(v.failures[0]).toContain("for 'x.css'")
  })
})
