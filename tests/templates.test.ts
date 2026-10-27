import { describe, expect, it } from 'vitest';
import { NavGrid } from '../src/ai/nav';
import { K, loadLevel } from '../src/levels/LevelData';
import { TEMPLATES } from '../src/levels/templates';

describe('authored templates', () => {
  for (const t of TEMPLATES) {
    describe(t.id, () => {
      const L = loadLevel(t.id);

      it('has a nook, exit, three circuits with fixtures and switches, and spawn candidates', () => {
        expect(L.nookCells.length).toBeGreaterThan(4);
        expect(L.exitCells.length).toBeGreaterThan(0);
        expect(L.landingCells.length).toBeGreaterThan(0);
        for (let c = 0; c < 3; c++) {
          expect(L.fixtures.filter((f) => f.circuit === c && !f.nook).length).toBeGreaterThan(1);
          expect(L.switches.filter((s) => s.circuit === c).length).toBeGreaterThan(0);
        }
        expect(L.fixtures.some((f) => f.nook)).toBe(true);
        expect(L.panels.some((p) => p.inNook)).toBe(true);
        expect(L.spawns.length).toBeGreaterThanOrEqual(2);
      });

      it('labels every door it declares', () => {
        expect(t.doorLabels.length).toBe(L.doors.length);
      });

      it('keeps blocking furniture off required paths: every floor cell is reachable from the start', () => {
        const nav = new NavGrid(L.w, L.h);
        nav.flood(L.startCell, (c) => (L.walk[c] ? 0 : -1));
        for (let i = 0; i < L.w * L.h; i++) if (L.walk[i]) expect(nav.reached(i)).toBe(true);
      });

      it('never blocks a doorway with furniture on either side', () => {
        for (const d of L.doors.filter((door) => door.open)) {
          for (const c of d.cells) {
            const sides = d.alongX ? [c - L.w, c + L.w] : [c - 1, c + 1];
            for (const s of sides) expect(L.kind[s]).not.toBe(K.Furniture);
          }
        }
      });

      it('gives every tenant spot a closed door and an open porch', () => {
        for (const sp of L.tenants) {
          expect(L.kind[sp.doorCell]).toBe(K.DoorClosed);
          expect(L.walk[sp.porchCell]).toBe(1);
        }
      });
    });
  }

  it('the final template ends at apartment 104', () => {
    expect(loadLevel('long-wing').template.exitLabel).toBe('104');
  });
});
