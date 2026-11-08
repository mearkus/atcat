// Card face artwork, drawn to 2D canvas. Used for the 3D textures and for the
// HTML hand. Each player also has a distinct symbol so colour isn't the only cue.
export const PLAYER_COLORS = ['#e4572e', '#2ab7ca', '#f2c14e', '#9b72e8'];
export const PLAYER_SYMBOLS = ['circle', 'triangle', 'square', 'diamond'];
export const STONE_COLOR = '#8b8f99';
export const CARD_COLOR = '#efe6d2';

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  const r = ch(n >> 16);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawSymbol(ctx, shape, cx, cy, r) {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.95, cy + r * 0.7);
      ctx.lineTo(cx - r * 0.95, cy + r * 0.7);
      ctx.closePath();
      break;
    case 'square':
      ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
      break;
    case 'diamond':
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      break;
  }
}

/** Draw one card half: p = player seat (-1 for stone), k = 'c' | 'g' | 's'. */
export function drawHalf(ctx, size, p, k, bg = null) {
  ctx.clearRect(0, 0, size, size);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  }
  const pad = size * 0.04;
  if (k === 's') {
    const grd = ctx.createLinearGradient(0, 0, size, size);
    grd.addColorStop(0, '#a3a7b0');
    grd.addColorStop(1, '#6f737d');
    ctx.fillStyle = grd;
    roundRect(ctx, pad, pad, size - 2 * pad, size - 2 * pad, size * 0.1);
    ctx.fill();
    // Speckles + a crack to read as stone.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${0.08 + rnd() * 0.1})`;
      ctx.beginPath();
      ctx.arc(pad + rnd() * (size - 2 * pad), pad + rnd() * (size - 2 * pad), size * (0.01 + rnd() * 0.025), 0, 7);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,40,48,0.55)';
    ctx.lineWidth = size * 0.025;
    ctx.beginPath();
    ctx.moveTo(size * 0.2, size * 0.25);
    ctx.lineTo(size * 0.42, size * 0.45);
    ctx.lineTo(size * 0.38, size * 0.62);
    ctx.lineTo(size * 0.7, size * 0.82);
    ctx.stroke();
    return;
  }
  const color = PLAYER_COLORS[p] || '#ccc';
  const grd = ctx.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, shade(color, 0.12));
  grd.addColorStop(1, shade(color, -0.12));
  ctx.fillStyle = grd;
  roundRect(ctx, pad, pad, size - 2 * pad, size - 2 * pad, size * 0.1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = size * 0.03;
  roundRect(ctx, size * 0.12, size * 0.12, size * 0.76, size * 0.76, size * 0.07);
  ctx.stroke();
  const shape = PLAYER_SYMBOLS[p] || 'circle';
  if (k === 'g') {
    // Gem halves: a bright faceted badge.
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    drawSymbol(ctx, 'diamond', size / 2, size / 2, size * 0.3);
    ctx.fill();
    ctx.fillStyle = shade(color, -0.25);
    drawSymbol(ctx, shape, size / 2, size / 2, size * 0.13);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    drawSymbol(ctx, shape, size / 2, size / 2, size * 0.2);
    ctx.fill();
  }
}

/** A <canvas> showing a whole card (two halves side by side). */
export function cardCanvas(card, seat, px = 56) {
  const c = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = px * 2 * dpr;
  c.height = px * dpr;
  c.style.width = `${px * 2}px`;
  c.style.height = `${px}px`;
  const ctx = c.getContext('2d');
  ctx.fillStyle = CARD_COLOR;
  roundRect(ctx, 0, 0, c.width, c.height, px * 0.12 * dpr);
  ctx.fill();
  const half = document.createElement('canvas');
  half.width = half.height = 128;
  card.cells.forEach((k, i) => {
    drawHalf(half.getContext('2d'), 128, k === 's' ? -1 : seat, k);
    const inset = px * 0.06 * dpr;
    ctx.drawImage(half, i * px * dpr + inset, inset, px * dpr - 2 * inset, px * dpr - 2 * inset);
  });
  return c;
}

export function symbolSwatch(seat, px = 18) {
  const c = document.createElement('canvas');
  c.width = c.height = px * 2;
  c.style.width = c.style.height = `${px}px`;
  const ctx = c.getContext('2d');
  ctx.fillStyle = PLAYER_COLORS[seat];
  drawSymbol(ctx, PLAYER_SYMBOLS[seat], px, px, px * 0.85);
  ctx.fill();
  return c;
}
