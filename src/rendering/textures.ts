// Small canvas-drawn textures for labels and world icons (cached; created once per session).

import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  cache.set(key, t);
  return t;
}

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

/** Door number plaque. */
export function plaqueTexture(text: string): THREE.CanvasTexture {
  return canvasTexture(`plaque:${text}`, 128, 64, (g) => {
    g.fillStyle = '#e9dcbc';
    roundRect(g, 4, 4, 120, 56, 10);
    g.fill();
    g.strokeStyle = '#6b4a2b';
    g.lineWidth = 5;
    g.stroke();
    g.fillStyle = '#3b2616';
    g.font = `bold ${text.length > 4 ? 26 : 36}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 34);
  });
}

export const CIRCUIT_LABEL = ['A', 'B', 'C'] as const;

/** Draw a circuit symbol (A ▲, B ●, C ■) centred at (x, y). */
export function drawCircuitSymbol(g: CanvasRenderingContext2D, circuit: number, x: number, y: number, r: number): void {
  g.beginPath();
  if (circuit === 0) {
    g.moveTo(x, y - r);
    g.lineTo(x + r * 0.95, y + r * 0.75);
    g.lineTo(x - r * 0.95, y + r * 0.75);
    g.closePath();
  } else if (circuit === 1) {
    g.arc(x, y, r * 0.85, 0, Math.PI * 2);
  } else {
    g.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
  }
  g.fill();
}

/** Circuit tag: symbol plus letter, used on fixtures and breaker switches. */
export function circuitTagTexture(circuit: number): THREE.CanvasTexture {
  return canvasTexture(`tag:${circuit}`, 128, 64, (g) => {
    g.fillStyle = '#1d2230';
    roundRect(g, 2, 2, 124, 60, 12);
    g.fill();
    g.strokeStyle = '#f2d9a0';
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = '#ffd88a';
    drawCircuitSymbol(g, circuit, 36, 32, 17);
    g.font = `bold 40px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(CIRCUIT_LABEL[circuit], 88, 34);
  });
}

export type IconKind = 'repair' | 'help' | 'helped' | 'exit' | 'locked';

export function iconTexture(kind: IconKind): THREE.CanvasTexture {
  return canvasTexture(`icon:${kind}`, 128, 128, (g) => {
    const bg = kind === 'help' ? '#7fb6e8' : kind === 'helped' ? '#6fcf97' : kind === 'locked' ? '#59606e' : '#ffc35a';
    g.fillStyle = 'rgba(10,14,28,0.85)';
    roundRect(g, 10, 10, 108, 108, 26);
    g.fill();
    g.strokeStyle = bg;
    g.lineWidth = 8;
    g.stroke();
    g.fillStyle = bg;
    g.strokeStyle = bg;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (kind === 'repair') {
      // Wrench
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(42, 86);
      g.lineTo(76, 52);
      g.stroke();
      g.beginPath();
      g.arc(82, 46, 18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(10,14,28,1)';
      g.fillRect(80, 26, 14, 18);
    } else if (kind === 'help' || kind === 'helped') {
      g.font = `bold 74px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(kind === 'help' ? '!' : '✓', 64, 68);
    } else if (kind === 'exit') {
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(36, 64);
      g.lineTo(88, 64);
      g.moveTo(68, 42);
      g.lineTo(90, 64);
      g.lineTo(68, 86);
      g.stroke();
    } else {
      g.lineWidth = 10;
      g.strokeRect(42, 60, 44, 32);
      g.beginPath();
      g.arc(64, 58, 16, Math.PI, 0);
      g.stroke();
    }
  });
}

/** Soft radial blob for smoke/sparks and the creature's ground shadow. */
export function blobTexture(): THREE.CanvasTexture {
  return canvasTexture('blob', 64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
