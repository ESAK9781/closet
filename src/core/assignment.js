// Minimum-cost rectangular assignment (the job scipy's linear_sum_assignment did).
// Shortest-augmenting-path Hungarian algorithm, O(n^2 m); fine for ~50 fields a page.

/**
 * @param {number[][]} cost rows x cols matrix
 * @returns {Array<[number, number]>} [row, col] pairs, one per row when rows <= cols
 */
export function linearSumAssignment(cost) {
  const n = cost.length;
  if (!n) return [];
  const m = cost[0].length;
  if (!m) return [];
  if (n > m) {
    const t = Array.from({ length: m }, (_, j) => Array.from({ length: n }, (_, i) => cost[i][j]));
    return linearSumAssignment(t).map(([r, c]) => [c, r]);
  }
  // 1-indexed potentials (classic e-maxx formulation)
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1); // p[j] = row matched to column j
  const way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(Infinity);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = [];
  for (let j = 1; j <= m; j++) if (p[j]) out.push([p[j] - 1, j - 1]);
  return out.sort((a, b) => a[0] - b[0]);
}
