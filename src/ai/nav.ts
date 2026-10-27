// Grid navigation: bounded Dijkstra flood with preallocated buffers (no per-query allocation).

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

/** Return the cost of entering a cell, or a negative number if it is impassable. */
export type CellCost = (cell: number) => number;

export class NavGrid {
  readonly dist: Float32Array;
  readonly parent: Int32Array;
  private readonly heapCell: Int32Array;
  private readonly heapCost: Float32Array;
  private heapSize = 0;
  private lastStart = -1;
  /** Number of floods run (diagnostics; lets tests bound navigation work). */
  floods = 0;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    const n = w * h;
    this.dist = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.heapCell = new Int32Array(n * 8 + 8);
    this.heapCost = new Float32Array(n * 8 + 8);
  }

  /**
   * Flood from `start`. Diagonal steps require both orthogonal neighbours to be passable
   * (no corner cutting). Stops early when `goal` returns true for a settled cell, returning
   * that cell; otherwise returns -1 after exploring everything within `maxCost`.
   * Each step costs `length × (base + cost(cell))`.
   */
  flood(start: number, cost: CellCost, maxCost = Infinity, goal?: (cell: number) => boolean, base = 1): number {
    const { dist, parent, w, h } = this;
    dist.fill(Infinity);
    parent.fill(-1);
    this.heapSize = 0;
    this.lastStart = start;
    this.floods++;
    if (start < 0) return -1;
    dist[start] = 0;
    this.push(start, 0);
    while (this.heapSize > 0) {
      const d = this.heapCost[0];
      const c = this.pop();
      if (d > dist[c]) continue;
      if (goal && goal(c)) return c;
      const cx = c % w;
      const cz = (c - cx) / w;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const nz = cz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const nc = nz * w + nx;
        const step = cost(nc);
        if (step < 0) continue;
        let len = 1;
        if (k >= 4) {
          if (cost(cz * w + nx) < 0 || cost(nz * w + cx) < 0) continue;
          len = SQRT2;
        }
        const nd = d + len * (base + step);
        if (nd < dist[nc] && nd <= maxCost) {
          dist[nc] = nd;
          parent[nc] = c;
          this.push(nc, nd);
        }
      }
    }
    return -1;
  }

  /** Write the path from the last flood's start to `goal` into `out` (start excluded). Returns length. */
  pathTo(goal: number, out: Int32Array): number {
    if (goal < 0 || (goal !== this.lastStart && this.parent[goal] < 0)) return 0;
    let len = 0;
    for (let c = goal; c !== this.lastStart && c >= 0; c = this.parent[c]) len++;
    if (len > out.length) return 0;
    let i = len - 1;
    for (let c = goal; c !== this.lastStart && c >= 0; c = this.parent[c]) out[i--] = c;
    return len;
  }

  reached(cell: number): boolean {
    return cell >= 0 && this.dist[cell] !== Infinity;
  }

  private push(cell: number, cost: number): void {
    let i = this.heapSize++;
    const hc = this.heapCell;
    const hk = this.heapCost;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= cost) break;
      hc[i] = hc[p];
      hk[i] = hk[p];
      i = p;
    }
    hc[i] = cell;
    hk[i] = cost;
  }

  private pop(): number {
    const hc = this.heapCell;
    const hk = this.heapCost;
    const top = hc[0];
    const n = --this.heapSize;
    if (n > 0) {
      const lc = hc[n];
      const lk = hk[n];
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= n) break;
        if (m + 1 < n && hk[m + 1] < hk[m]) m++;
        if (hk[m] >= lk) break;
        hc[i] = hc[m];
        hk[i] = hk[m];
        i = m;
      }
      hc[i] = lc;
      hk[i] = lk;
    }
    return top;
  }
}
