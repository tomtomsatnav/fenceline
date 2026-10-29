// Interval estimates for the study's rates. Every rate in results.md carries a 95% Wilson interval; differences between
// two rates carry Newcombe's hybrid score interval (method 10), which is built from the two Wilson intervals.
export const Z95 = 1.959963984540054;

/** Wilson score interval for k successes in n trials: {k, n, p, lo, hi}. n = 0 gives NaNs. */
export function wilson(k, n, z = Z95) {
  if (!n) return { k, n, p: NaN, lo: NaN, hi: NaN };
  const p = k / n; const z2 = z * z;
  const mid = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { k, n, p, lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

/** Newcombe hybrid score interval for p1 - p2: {d, lo, hi}. */
export function newcombe(k1, n1, k2, n2, z = Z95) {
  const a = wilson(k1, n1, z); const b = wilson(k2, n2, z);
  if (!n1 || !n2) return { d: NaN, lo: NaN, hi: NaN };
  const d = a.p - b.p;
  return { d, lo: d - Math.sqrt((a.p - a.lo) ** 2 + (b.hi - b.p) ** 2), hi: d + Math.sqrt((a.hi - a.p) ** 2 + (b.p - b.lo) ** 2) };
}

/**
 * Smallest difference p2 - p1 (p2 > p1) a two-sided test at alpha .05 detects with 80% power, n per arm, by the normal
 * approximation. Used only to say, in advance, which differences the grid can and cannot see.
 */
export function mde(p1, n, { zA = Z95, zB = 0.8416212335729143 } = {}) {
  for (let p2 = p1 + 0.005; p2 < 1; p2 += 0.005) {
    const pb = (p1 + p2) / 2;
    const need = (zA * Math.sqrt(2 * pb * (1 - pb)) + zB * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p2 - p1) ** 2;
    if (need <= n) return p2 - p1;
  }
  return NaN;
}

export const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-');
/** "3/10 (30%, 11-60)" */
export const fmtRate = (w) => (w.n ? `${w.k}/${w.n} (${pct(w.p)}, ${Math.round(w.lo * 100)}-${Math.round(w.hi * 100)})` : '-');
/** "+20 pts (-5 to +43)" */
export const fmtDiff = (d) => {
  const s = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}`;
  return Number.isFinite(d.d) ? `${s(d.d)} pts (${s(d.lo)} to ${s(d.hi)})` : '-';
};
