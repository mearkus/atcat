// Three.js rendering of the Stratum board.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DIRS, footprint } from '../shared/engine.js';
import { PLAYER_COLORS, CARD_COLOR, drawHalf } from './art.js';

const CELL = 1;
const THICK = 0.12;
const GAP = 0.06;
const BOARD_TOP = 0.2;

const ease = (t) => 1 - Math.pow(1 - t, 3);

export class BoardScene {
  constructor(container, { onHover, onClick, onRotate } = {}) {
    this.container = container;
    this.onHover = onHover;
    this.onClick = onClick;
    this.onRotate = onRotate;
    this.size = 0;
    this.cards = new Map(); // cardId -> group
    this.anims = [];
    this.textureCache = new Map();

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#1b1f2a');
    scene.fog = new THREE.Fog('#1b1f2a', 18, 40);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = 1.25;
    this.controls.minPolarAngle = 0.15;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

    scene.add(new THREE.HemisphereLight('#dfe8ff', '#2a2218', 1.1));
    const sun = (this.sun = new THREE.DirectionalLight('#fff4e0', 2.2));
    sun.position.set(6, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // Table
    const table = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshStandardMaterial({ color: '#2b2f3d', roughness: 0.95 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);

    this.boardGroup = new THREE.Group();
    scene.add(this.boardGroup);
    this.highlightGroup = new THREE.Group();
    scene.add(this.highlightGroup);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);
    this.hovered = null;

    this.ghost = null;
    this.ghostKey = '';

    this._bindInput();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this._frame());
  }

  // ---------- coordinates ----------
  cellToWorld(x, y) {
    const o = (this.size - 1) / 2;
    return new THREE.Vector3((x - o) * CELL, 0, (y - o) * CELL);
  }

  levelY(level) {
    return BOARD_TOP + level * THICK + THICK / 2;
  }

  worldToCell(p) {
    const o = (this.size - 1) / 2;
    const x = Math.round(p.x / CELL + o);
    const y = Math.round(p.z / CELL + o);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    return { x, y };
  }

  // ---------- board ----------
  buildBoard(size) {
    this.size = size;
    this.boardGroup.clear();
    for (const g of this.cards.values()) this.scene.remove(g);
    this.cards.clear();
    const extent = size * CELL + 0.6;
    const base = new THREE.Mesh(
      new RoundedBoxGeometry(extent, BOARD_TOP, extent, 3, 0.12),
      new THREE.MeshStandardMaterial({ color: '#5a3d2b', roughness: 0.7 }),
    );
    base.position.y = BOARD_TOP / 2;
    base.receiveShadow = true;
    base.castShadow = true;
    this.boardGroup.add(base);

    const tileGeo = new THREE.PlaneGeometry(CELL - 0.06, CELL - 0.06);
    const matA = new THREE.MeshStandardMaterial({ color: '#3d4456', roughness: 0.9 });
    const matB = new THREE.MeshStandardMaterial({ color: '#363c4d', roughness: 0.9 });
    const matC = new THREE.MeshStandardMaterial({ color: '#5b6480', roughness: 0.8 });
    const c = Math.floor(size / 2);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = new THREE.Mesh(tileGeo, x === c && y === c ? matC : (x + y) % 2 ? matA : matB);
        t.rotation.x = -Math.PI / 2;
        t.position.copy(this.cellToWorld(x, y));
        t.position.y = BOARD_TOP + 0.002;
        t.receiveShadow = true;
        this.boardGroup.add(t);
      }
    }
    // Centre marker
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.28, 32),
      new THREE.MeshBasicMaterial({ color: '#aab4d4', transparent: true, opacity: 0.6 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(this.cellToWorld(c, c));
    ring.position.y = BOARD_TOP + 0.004;
    this.boardGroup.add(ring);
    this.centerRing = ring;

    this.sun.shadow.camera.left = -extent;
    this.sun.shadow.camera.right = extent;
    this.sun.shadow.camera.top = extent;
    this.sun.shadow.camera.bottom = -extent;
    this.sun.shadow.camera.updateProjectionMatrix();

    this.resetCamera();
  }

  resetCamera() {
    const d = this.size * 1.25 + 3;
    this.camera.position.set(0, d * 0.95, d * 0.75);
    this.controls.target.set(0, 0, 0.3);
    this.controls.minDistance = this.size * 0.6;
    this.controls.maxDistance = this.size * 3;
    this.controls.update();
  }

  // ---------- cards ----------
  halfTexture(p, k) {
    const key = `${p}:${k}`;
    if (!this.textureCache.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      drawHalf(canvas.getContext('2d'), 128, p, k, CARD_COLOR);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.textureCache.set(key, tex);
    }
    return this.textureCache.get(key);
  }

  makeCard(halves, { ghost = false } = {}) {
    // halves: [{p, k}, {p, k}] in footprint order; card is built along +x.
    const g = new THREE.Group();
    const opacity = ghost ? 0.72 : 1;
    const body = new THREE.Mesh(
      this._bodyGeo || (this._bodyGeo = new RoundedBoxGeometry(2 * CELL - GAP, THICK, CELL - GAP, 2, 0.03)),
      new THREE.MeshStandardMaterial({ color: CARD_COLOR, roughness: 0.6, transparent: ghost, opacity }),
    );
    body.castShadow = !ghost;
    body.receiveShadow = true;
    g.add(body);
    const faceGeo = this._faceGeo || (this._faceGeo = new THREE.PlaneGeometry(CELL - GAP - 0.08, CELL - GAP - 0.08));
    halves.forEach((h, i) => {
      const face = new THREE.Mesh(
        faceGeo,
        new THREE.MeshStandardMaterial({
          map: this.halfTexture(h.p, h.k),
          roughness: 0.55,
          transparent: ghost,
          opacity,
        }),
      );
      face.rotation.x = -Math.PI / 2;
      face.position.set((i - 0.5) * CELL, THICK / 2 + 0.001, 0);
      face.receiveShadow = true;
      g.add(face);
      if (h.k === 'g') {
        const gem = new THREE.Mesh(
          this._gemGeo || (this._gemGeo = new THREE.OctahedronGeometry(0.16, 0)),
          new THREE.MeshStandardMaterial({
            color: PLAYER_COLORS[h.p] || '#fff',
            emissive: PLAYER_COLORS[h.p] || '#fff',
            emissiveIntensity: 0.35,
            metalness: 0.3,
            roughness: 0.15,
            transparent: ghost,
            opacity,
          }),
        );
        gem.scale.y = 0.7;
        gem.position.set((i - 0.5) * CELL, THICK / 2 + 0.12, 0);
        gem.castShadow = !ghost;
        gem.userData.spin = true;
        g.add(gem);
      }
    });
    return g;
  }

  positionCard(group, x, y, rot, level) {
    const [[ax, ay], [bx, by]] = footprint(x, y, rot);
    const a = this.cellToWorld(ax, ay);
    const b = this.cellToWorld(bx, by);
    group.position.set((a.x + b.x) / 2, this.levelY(level), (a.z + b.z) / 2);
    const [dx, dy] = DIRS[rot];
    group.rotation.y = Math.atan2(-dy, dx);
  }

  /** Sync meshes with a game view. */
  setState(view, { animate = true } = {}) {
    if (view.size !== this.size || view.gameId !== this._gameId) this.buildBoard(view.size);
    this._gameId = view.gameId;
    this._lastMoveNumber = view.moveNumber;
    this.heights = view.board.map((s) => s.length);

    // Collect cards present on the board.
    const present = new Map();
    view.board.forEach((stack, i) => {
      const x = i % view.size;
      const y = (i - x) / view.size;
      stack.forEach((e, level) => {
        if (!present.has(e.c)) present.set(e.c, { cells: [], level });
        present.get(e.c).cells.push({ x, y, ...e });
      });
    });

    for (const [id, g] of this.cards) {
      if (!present.has(id)) {
        this.scene.remove(g);
        this.cards.delete(id);
      }
    }
    const lm = view.lastMove;
    for (const [id, info] of present) {
      if (this.cards.has(id)) continue;
      let x, y, rot, halves;
      if (lm && lm.card.id === id) {
        ({ x, y, rot } = lm);
        halves = lm.card.cells.map((k) => ({ k, p: k === 's' ? -1 : lm.seat }));
      } else {
        // Reconstruct orientation from the two cells (order is irrelevant visually
        // only if we know which half is which, so derive from positions).
        const [c0, c1] = info.cells;
        x = c0.x;
        y = c0.y;
        rot = DIRS.findIndex(([dx, dy]) => c0.x + dx === c1.x && c0.y + dy === c1.y);
        halves = [c0, c1];
      }
      const g = this.makeCard(halves);
      this.positionCard(g, x, y, rot, info.level);
      this.scene.add(g);
      this.cards.set(id, g);
      if (animate && lm && lm.card.id === id) {
        const targetY = g.position.y;
        g.position.y += 2.5;
        this.anims.push({ obj: g, from: g.position.y, to: targetY, t: 0, dur: 0.38, onDone: () => this.onLand?.(id) });
      }
    }
    this._markLast(lm);
    this.ghostKey = '';
  }

  _markLast(lm) {
    this.lastMarker?.removeFromParent();
    this.lastMarker = null;
    const g = lm && this.cards.get(lm.card.id);
    if (!g) return;
    const line = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * CELL - GAP + 0.04, THICK + 0.02, CELL - GAP + 0.04)),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }),
    );
    g.add(line);
    this.lastMarker = line;
  }

  // ---------- ghost preview ----------
  setGhost(card, seat, x, y, rot, legal) {
    const key = card ? `${card.id}:${x}:${y}:${rot}:${legal}` : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    if (this.ghost) this.scene.remove(this.ghost);
    this.ghost = null;
    if (!card) return;
    const halves = card.cells.map((k) => ({ k, p: k === 's' ? -1 : seat }));
    const g = this.makeCard(halves, { ghost: true });
    const fp = footprint(x, y, rot);
    const inB = fp.map(([cx, cy]) => cx >= 0 && cy >= 0 && cx < this.size && cy < this.size);
    const h = fp.map(([cx, cy], i) => (inB[i] ? this.heights[cy * this.size + cx] : 0));
    const level = Math.max(...h);
    this.positionCard(g, x, y, rot, level);
    g.position.y += 0.12;
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * CELL - GAP + 0.06, THICK + 0.04, CELL - GAP + 0.06)),
      new THREE.LineBasicMaterial({ color: legal ? '#5dff9a' : '#ff5d5d' }),
    );
    g.add(outline);
    this.ghost = g;
    this.ghostBaseY = g.position.y;
    this.scene.add(g);
  }

  clearGhost() {
    this.setGhost(null);
  }

  // ---------- group highlight ----------
  highlightCells(indices, color) {
    this.highlightGroup.clear();
    if (!indices || !indices.length) return;
    const geo = new THREE.PlaneGeometry(CELL - 0.12, CELL - 0.12);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
    for (const i of indices) {
      const x = i % this.size;
      const y = (i - x) / this.size;
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.copy(this.cellToWorld(x, y));
      m.position.y = this.levelY(this.heights[i] - 1) + THICK / 2 + 0.01;
      this.highlightGroup.add(m);
    }
  }

  // ---------- input ----------
  _bindInput() {
    const el = this.renderer.domElement;
    let down = null;
    const toCell = (ev) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      // Prefer hits on card tops so towers are easy to target.
      const meshes = [];
      for (const g of this.cards.values()) meshes.push(g.children[0]);
      const hit = this.raycaster.intersectObjects(meshes, false)[0];
      const p = new THREE.Vector3();
      if (hit && hit.face && hit.face.normal.y > 0.5) p.copy(hit.point);
      else if (!this.raycaster.ray.intersectPlane(this.pickPlane, p)) return null;
      return this.worldToCell(p);
    };
    el.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'touch') return;
      const c = toCell(ev);
      this.hovered = c;
      this.onHover?.(c);
    });
    el.addEventListener('pointerleave', () => {
      this.hovered = null;
      this.onHover?.(null);
    });
    el.addEventListener('pointerdown', (ev) => {
      down = { x: ev.clientX, y: ev.clientY, button: ev.button, t: performance.now() };
    });
    el.addEventListener('pointerup', (ev) => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      const button = down.button;
      down = null;
      if (moved > 8 || button !== 0) return;
      const c = toCell(ev);
      this.onClick?.(c, ev.pointerType);
    });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    el.addEventListener(
      'wheel',
      (ev) => {
        if (ev.shiftKey || ev.altKey) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          this.onRotate?.(ev.deltaY > 0 ? 1 : -1);
        }
      },
      { capture: true, passive: false },
    );
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Pull back on narrow (portrait) screens so the whole board fits.
    this.camera.fov = w < h ? 58 : 42;
    this.camera.updateProjectionMatrix();
  }

  /** Camera azimuth in quarter turns (0 = default view from the front). */
  viewQuarter() {
    return Math.round(this.controls.getAzimuthalAngle() / (Math.PI / 2));
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.anims = this.anims.filter((a) => {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.obj.position.y = a.from + (a.to - a.from) * ease(k);
      if (k >= 1) a.onDone?.();
      return k < 1;
    });
    if (this.ghost) this.ghost.position.y = this.ghostBaseY + Math.sin(t * 4) * 0.03;
    for (const g of this.cards.values()) {
      for (const c of g.children) if (c.userData.spin) c.rotation.y = t * 0.8;
    }
    if (this.centerRing) this.centerRing.visible = this._lastMoveNumber === 0;
    const hl = this.highlightGroup.children[0];
    if (hl) hl.material.opacity = 0.3 + 0.2 * Math.sin(t * 4);
    this.controls.update();
    const q = this.viewQuarter();
    if (q !== this._viewQ) {
      this._viewQ = q;
      this.onViewTurn?.(q);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._resize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

