// Pure verdict rules of the on-disk byte gate (chunk-budget.ts is the IO half).
//
// Split out for the same reason a11y.ts sits next to axe.ts: a gate whose rules
// live inside a top-level script with process.exit() cannot be unit-tested, so
// nobody notices when it stops biting. Everything here is a pure function over
// measurements; reading dist/ and printing stays in chunk-budget.ts.

export interface Budget {
  calibrated: boolean
  raw_threshold_bytes: number
  total_transfer_bytes: number
  defaults: { js_br_bytes: number; css_br_bytes: number }
  overrides: Record<string, number>
}

/** One dist artifact as measured on disk. `brSize` is null when no .br sibling exists. */
export interface ArtifactMeasurement {
  /** Path relative to dist/, e.g. `assets/GraphPage-Cr0MwOqk.js`. */
  rel: string
  rawSize: number
  brSize: number | null
}

export interface BudgetVerdict {
  failures: string[]
  /** One human-readable line per artifact; printed under CTX_BUDGET_VERBOSE. */
  rows: string[]
  /** Sum of served bytes (.br when present, raw otherwise). */
  total: number
}

/** Strip the 8-char vite content hash: `GraphPage-Cr0MwOqk.js` -> `GraphPage.js`. */
export function stemOf(name: string): string {
  return name.replace(/-[A-Za-z0-9_-]{8}(?=\.(?:js|css)$)/, '')
}

/**
 * Apply the budget to a set of measurements. Four failure classes:
 *   - an artifact at/above the compression threshold without a .br sibling
 *     (precompression broken — the Go handler would serve raw),
 *   - an artifact over its per-chunk budget,
 *   - an override naming a chunk that no longer exists,
 *   - the transfer total over its limit.
 *
 * The stale-override class is a FAILURE, not a warning: the budget is
 * name-keyed, so every Rolldown rechunking silently voids some entries. As a
 * warning that drift accumulated unread — a budget that names chunks nobody
 * builds any more is decoration, and the chunks that inherited their bytes fall
 * back to the per-extension default without anyone deciding that. A red gate
 * here means one thing only: re-measure in the pinned container and re-cut the
 * budget in the same commit (chunk-budget.json `_doc` RUNBOOK).
 */
export function evaluateBudget(artifacts: ArtifactMeasurement[], budget: Budget): BudgetVerdict {
  const failures: string[] = []
  const rows: string[] = []
  const seenStems = new Set<string>()
  let total = 0

  for (const a of artifacts) {
    const served = a.brSize ?? a.rawSize
    const stem = stemOf(a.rel.split('/').pop() as string)
    seenStems.add(stem)
    total += served

    if (a.brSize === null && a.rawSize >= budget.raw_threshold_bytes) {
      failures.push(
        `${a.rel}: ${a.rawSize} B raw with NO .br sibling (threshold ${budget.raw_threshold_bytes}) — precompression broken`,
      )
      continue
    }

    const limit =
      budget.overrides[stem] ?? (stem.endsWith('.css') ? budget.defaults.css_br_bytes : budget.defaults.js_br_bytes)
    const kind = a.brSize === null ? 'raw' : 'br'
    rows.push(`  ${a.rel} (${stem}): ${served} B ${kind} / limit ${limit}`)
    if (served > limit) {
      failures.push(`${a.rel}: ${served} B ${kind} exceeds budget ${limit} B for '${stem}'`)
    }
  }

  for (const key of Object.keys(budget.overrides)) {
    if (!seenStems.has(key)) {
      failures.push(
        `stale override '${key}': no matching chunk in dist/ — the budget names a chunk this build does not produce; re-measure in the pinned container and re-cut the budget`,
      )
    }
  }

  if (total > budget.total_transfer_bytes) {
    failures.push(`transfer total ${total} B exceeds total_transfer_bytes ${budget.total_transfer_bytes} B`)
  }

  return { failures, rows, total }
}
