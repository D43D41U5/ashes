/**
 * ESSAI ÉCLAIRAGE DYNAMIQUE — couche 1, la masse « pâteuse » (DA 2026-07-20).
 *
 * Même recette que l'arbre, GÉNÉRALISÉE À TOUT LE DÉCOR (buissons, roches, sphaigne, fleurs,
 * touffes d'herbe, roseaux, cailloux, sapins… — demande d'Alexis 2026-07-24 « tout en cubique »,
 * pour tenir le TOUT-OU-RIEN de la DA du 2026-07-20) : pour chaque prop on fabrique une variante
 * `_lit` = albédo SANS l'ombrage directionnel peint (qui se battait avec la lumière calculée) — les
 * couleurs qui sont un MATÉRIAU (corolle mauve, feuillage vert sur un tronc) restent, seul le
 * hillshade cuit part — + une carte de NORMALES dérivée de la SILHOUETTE (masque lissé en butte,
 * puis facetté). Le relief vient alors 100 % de la lumière, cohérent avec le reste ; le rendu swappe
 * sur `_lit` + `setLighting(true)` quand armé. Chaque prop de clutter a AUSSI une variante MIROIR
 * `_lit_m` (canvas pré-retourné, normale dérivée du retourné) : elle rend la variété par flip sans
 * casser la normale — un flip Phaser n'inverse PAS le canal X de la normale.
 *
 * La normale est dérivée de NOTRE canvas (lisible via `getImageData`), jamais d'une texture
 * Phaser générée (dont la relecture WebGL est incertaine). Convention Y : voir `FLIP_G`.
 */
import type Phaser from 'phaser'

const FLIP_G = true // Phaser attend le vert « Y vers le haut » ; notre espace a Y vers le bas

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}
function enc(v: number): number {
  return Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)))
}
function newCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, ctx: c.getContext('2d')! }
}

/**
 * Carte de normales dérivée du masque alpha d'un canvas (butte lissée → facettes).
 *
 * `passes` (lissage) et `k` (gain sur le gradient) sont les DEUX cadrans du « cubique ». Une grande
 * masse (buisson 12 px) veut BEAUCOUP de lissage → un dôme doux. Un petit prop BLOCKY (la corolle
 * cubique de la fleur, ~6 px) veut PEU de lissage → ses arêtes restent franches, si bien que les
 * cellules du bord regardent NET vers l'extérieur : un vrai cube, pas une bosse molle. Défauts =
 * réglage de la masse pâteuse historique (inchangé pour tous les props qui ne les surchargent pas). */
function normalFromCanvas(src: HTMLCanvasElement, passes = 4, k = 2.6): HTMLCanvasElement {
  const w = src.width, h = src.height
  const srcData = src.getContext('2d')!.getImageData(0, 0, w, h).data
  // 1) hauteur = masque (opaque ? 1 : 0), lissé → butte conforme à la forme
  let hf = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) hf[i] = srcData[i * 4 + 3]! > 8 ? 1 : 0
  for (let pass = 0; pass < passes; pass++) {
    const n = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, cnt = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          s += hf[yy * w + xx]!; cnt++
        }
        n[y * w + x] = s / cnt
      }
    }
    hf = n
  }
  // 2) FACETTES : hauteur moyenne par cellule ~2 px → normale = gradient de cellule
  const cellsX = Math.max(2, Math.round(w / 2)), cellsY = Math.max(2, Math.round(h / 2))
  const csx = w / cellsX, csy = h / cellsY
  const H = new Float32Array(cellsX * cellsY)
  for (let cy = 0; cy < cellsY; cy++) for (let cx = 0; cx < cellsX; cx++) {
    let s = 0, cnt = 0
    for (let y = Math.floor(cy * csy); y < Math.floor((cy + 1) * csy); y++)
      for (let x = Math.floor(cx * csx); x < Math.floor((cx + 1) * csx); x++) { s += hf[y * w + x]!; cnt++ }
    H[cy * cellsX + cx] = cnt ? s / cnt : 0
  }
  const K = k
  const at = (cx: number, cy: number): number =>
    H[Math.min(cellsY - 1, Math.max(0, cy)) * cellsX + Math.min(cellsX - 1, Math.max(0, cx))]!
  const out = newCanvas(w, h)
  const d = out.ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const cx = Math.min(cellsX - 1, Math.floor(x / csx)), cy = Math.min(cellsY - 1, Math.floor(y / csy))
      const dhx = at(cx + 1, cy) - at(cx - 1, cy)
      const dhy = at(cx, cy + 1) - at(cx, cy - 1)
      const [nx, ny, nz] = norm3(-dhx * K, -dhy * K, 1)
      d.data[i] = enc(nx)
      d.data[i + 1] = enc(FLIP_G ? -ny : ny)
      d.data[i + 2] = enc(nz)
      d.data[i + 3] = 255
    }
  }
  out.ctx.putImageData(d, 0, 0)
  return out.c
}

function register(scene: Phaser.Scene, key: string, albedo: HTMLCanvasElement, normal: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key)
  const tex = scene.textures.addCanvas(key, albedo)
  tex?.setDataSource(normal)
}

/** Un prop pâteux : sa clé, sa taille, le tracé de son albédo, et — pour les petits props BLOCKY —
 *  des cadrans de normale (`passes`/`k`, cf. `normalFromCanvas`) pour un cube franc plutôt qu'un dôme. */
interface LitProp { key: string; w: number; h: number; draw: (ctx: CanvasRenderingContext2D) => void; passes?: number; k?: number }

const disc = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void => {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
}
const tri = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void => {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill()
}

/** LE PATCH DE CHAMPIGNONS, cubique — silhouette PARTAGÉE peint↔lit (comme `FLOWERS`/`PEBBLES`) :
 *  BootScene rejoue CES rects en Phaser Graphics, on les peint ici en Canvas2D pour l'albédo `_lit`.
 *  Rects only → même forme aux deux backends ; deux chapeaux bruns à gradins sur pieds crème.
 *  `passes:1`/`k:3.5` sur la normale → arêtes franches (un cube net, pas un dôme). */
export const CHAMPIGNON_RECTS: readonly (readonly [number, number, number, number, string])[] = [
  // Descendus de 3 px (l'ancienne litière retirée) pour que les pieds touchent le sol (origine bas).
  [5, 12, 2, 3, '#d8cdb4'],  // pied gauche
  [3, 10, 6, 2, '#8a5a34'],  // chapeau gauche (bas)
  [4, 9, 4, 1, '#8a5a34'],   // chapeau gauche (gradin haut)
  [10, 9, 2, 6, '#d8cdb4'],  // pied droit (le plus grand)
  [8, 7, 6, 2, '#9c6636'],   // chapeau droit (bas)
  [9, 6, 4, 1, '#9c6636'],   // chapeau droit (gradin haut)
  [9, 6, 2, 1, '#b98a58'],   // reflet NO
]
function drawChampignon(ctx: CanvasRenderingContext2D): void {
  for (const [x, y, w, h, col] of CHAMPIGNON_RECTS) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h) }
}

// Silhouettes = celles de `BootScene.makeClutter` (À GARDER EN PHASE : deux backends de dessin,
// Phaser Graphics là-bas, Canvas2D ici). L'ombrage directionnel peint est retiré ; les couleurs
// qui sont un MATÉRIAU (corolle, feuillage) restent. La normale se lit sur l'alpha seul.
const PROPS: LitProp[] = [
  // La masse pâteuse (déjà cubique avant le 2026-07-24) : silhouette APLATIE d'une seule couleur.
  { key: 'cl-bush', w: 16, h: 16, draw: (c) => { c.fillStyle = '#2f5330'; c.fillRect(2, 5, 12, 9); c.fillRect(3, 4, 10, 9) } },
  { key: 'cl-low_bush', w: 16, h: 16, draw: (c) => { c.fillStyle = '#4b4a2e'; c.fillRect(4, 8, 9, 6) } },
  { key: 'cl-boulder', w: 16, h: 16, draw: (c) => { c.fillStyle = '#5f5f64'; disc(c, 8, 10, 5) } },
  { key: 'cl-sphagnum', w: 16, h: 16, draw: (c) => { c.fillStyle = '#6a6a3a'; disc(c, 8, 11, 4) } },
  // Le petit décor de sol + les brins, désormais cubiques (mousse, touffes… « tout en cubique »).
  //  Les FLEURS, elles, ont plusieurs VARIÉTÉS (forme + couleur) — voir `FLOWERS` plus bas.
  { key: 'cl-grass_tuft', w: 16, h: 16, draw: (c) => { c.fillStyle = '#5a6e33'; c.fillRect(5, 9, 2, 5); c.fillRect(8, 8, 2, 6); c.fillRect(11, 10, 2, 4) } },
  { key: 'cl-reed', w: 16, h: 16, draw: (c) => { c.fillStyle = '#6d7a40'; c.fillRect(6, 4, 1, 11); c.fillRect(9, 3, 1, 12); c.fillRect(11, 6, 1, 9) } },
  { key: 'cl-lichen', w: 16, h: 16, draw: (c) => { c.fillStyle = '#777c50'; disc(c, 6, 10, 2); disc(c, 9, 11, 2) } },
  { key: 'cl-snowdrift', w: 16, h: 16, draw: (c) => { c.fillStyle = '#d8dde6'; disc(c, 8, 12, 4) } },
  // Les conifères / troncs décoratifs (feuillage + fût = 2 matériaux, gardés).
  { key: 'cl-conifer', w: 16, h: 16, draw: (c) => { c.fillStyle = '#24401f'; tri(c, 8, 1, 2, 13, 14, 13) } },
  { key: 'cl-pine', w: 16, h: 16, draw: (c) => { c.fillStyle = '#2f5030'; tri(c, 8, 3, 4, 13, 12, 13) } },
  { key: 'cl-larch', w: 16, h: 16, draw: (c) => { c.fillStyle = '#6f7a3a'; tri(c, 8, 3, 5, 12, 11, 12) } },
  { key: 'cl-burnt_trunk', w: 16, h: 16, draw: (c) => { c.fillStyle = '#2b2b2f'; c.fillRect(7, 4, 2, 10) } },
  { key: 'cl-big_trunk', w: 16, h: 16, draw: (c) => { c.fillStyle = '#3a2c1a'; c.fillRect(6, 4, 4, 11); c.fillStyle = '#24401f'; disc(c, 8, 4, 5) } },
  { key: 'cl-stump', w: 16, h: 16, draw: (c) => { c.fillStyle = '#4a3826'; c.fillRect(6, 9, 4, 5) } },
  // Le nœud roche (masse pâteuse côté SnapshotView) — pas de miroir (les nœuds ne se miroitent pas).
  { key: 'nd-rock', w: 16, h: 16, draw: (c) => { c.fillStyle = '#6a6a72'; c.fillRect(3, 6, 11, 8) } },
  // Le nœud CHAMPIGNON — cubique (arêtes franches, `passes:1`/`k:3.5`), silhouette partagée avec BootScene.
  { key: 'nd-champignon', w: 16, h: 16, passes: 1, k: 3.5, draw: drawChampignon },
]

/** LES VARIÉTÉS DE FLEUR (demande d'Alexis 2026-07-24 : « un peu de variation, forme ET couleur —
 *  toujours CUBIQUE »). Une seule fleur clonée = un pré en copier-coller ; on en tire plusieurs par
 *  tuile (hash, cf. `PropInstance.variant`). Chaque variété : une TÊTE BLOCKY (liste de rects, la
 *  silhouette partagée peint↔lit) et sa couleur-matériau `bloom`. La tige est commune. `passes:1`+
 *  `k:3.5` gardent les arêtes franches (cube net, pas bosse) — la même recette que la 1re tête. */
export interface FlowerVariant { bloom: string; stem: readonly [number, number, number, number]; rects: readonly (readonly [number, number, number, number])[] }
export const FLOWER_STEM_COLOR = '#50662f'
export const FLOWERS: readonly FlowerVariant[] = [
  // 0 — cube dodu chanfreiné, mauve (la tête d'origine)
  { bloom: '#9a7bb0', stem: [7, 8, 2, 6], rects: [[5, 4, 6, 5], [6, 3, 4, 1]] },
  // 1 — tête haute et étroite, jaune (une hampe dressée)
  { bloom: '#d8c25e', stem: [7, 9, 2, 5], rects: [[6, 3, 4, 6], [7, 2, 2, 1]] },
  // 2 — gemme en losange à gradins, blanc-crème
  { bloom: '#e6e2ee', stem: [7, 9, 2, 5], rects: [[7, 3, 2, 1], [6, 4, 4, 1], [5, 5, 6, 2], [6, 7, 4, 1], [7, 8, 2, 1]] },
  // 3 — corolle large et basse, rose-rouge
  { bloom: '#c85f7a', stem: [7, 8, 2, 6], rects: [[4, 5, 8, 3], [5, 4, 6, 1]] },
]
/** Dessine une variété de fleur (tige + tête) sur un contexte Canvas2D — l'albédo `_lit`. La version
 *  peinte de BootScene rejoue la MÊME donnée `FLOWERS` (autre backend), d'où silhouette identique. */
function drawFlower(ctx: CanvasRenderingContext2D, f: FlowerVariant): void {
  ctx.fillStyle = FLOWER_STEM_COLOR
  ctx.fillRect(f.stem[0], f.stem[1], f.stem[2], f.stem[3])
  ctx.fillStyle = f.bloom
  for (const [x, y, w, h] of f.rects) ctx.fillRect(x, y, w, h)
}

/** LES CAILLOUX, VRAIMENT CARRÉS (demande d'Alexis 2026-07-24 : « vraiment carrés, configurations
 *  différentes, normale correspondante, moins fréquents, et un peu en forêt »). Fini les disques
 *  ronds : chaque variété est un petit tas de BLOCS carrés (liste de rects), gris de deux tons pour la
 *  matière. `passes:1`+`k:3.5` → arêtes franches (de vrais cubes au sol, pas des galets flous). */
export interface PebbleVariant { rects: readonly (readonly [number, number, number, number])[] }
export const PEBBLE_TONES = ['#71717a', '#5a5a62'] as const
export const PEBBLES: readonly PebbleVariant[] = [
  // 0 — deux blocs, l'un dominant
  { rects: [[5, 9, 4, 4], [10, 11, 3, 3]] },
  // 1 — trois blocs en escalier
  { rects: [[5, 11, 3, 3], [8, 9, 4, 4], [12, 12, 2, 2]] },
  // 2 — un gros galet carré + un éclat
  { rects: [[6, 9, 5, 5], [12, 12, 2, 2]] },
  // 3 — un semis de trois petits carrés
  { rects: [[4, 12, 2, 2], [7, 10, 3, 3], [11, 12, 3, 3]] },
]
/** Dessine une variété de cailloux (blocs carrés, deux tons) — l'albédo `_lit`. BootScene rejoue la
 *  MÊME donnée `PEBBLES`+`PEBBLE_TONES` en Phaser Graphics → silhouette identique. */
function drawPebbles(ctx: CanvasRenderingContext2D, p: PebbleVariant): void {
  p.rects.forEach(([x, y, w, h], i) => { ctx.fillStyle = PEBBLE_TONES[i % PEBBLE_TONES.length]!; ctx.fillRect(x, y, w, h) })
}

/** LES FAMILLES À VARIÉTÉS — un même `kind` de clutter porté par N textures `cl-<kind>-<i>`, tirées
 *  par tuile (hash `PropInstance.variant`). `passes`/`k` : les cadrans de normale (cube franc). */
const VARIANT_FAMILIES: { kind: string; passes: number; k: number; draws: ((ctx: CanvasRenderingContext2D) => void)[] }[] = [
  { kind: 'flower', passes: 1, k: 3.5, draws: FLOWERS.map((f) => (c: CanvasRenderingContext2D) => drawFlower(c, f)) },
  { kind: 'pebbles', passes: 1, k: 3.5, draws: PEBBLES.map((p) => (c: CanvasRenderingContext2D) => drawPebbles(c, p)) },
]
/** Combien de variétés par `kind` (pour ClutterLayer : quelle texture tirer). */
export const VARIANT_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(VARIANT_FAMILIES.map((f) => [f.kind, f.draws.length]))
/** Le stem de texture d'une variété — `<kind>-<i>`. SEULE fabrique de ce nom (ClutterLayer pose, ce
 *  module génère : ils ne peuvent pas diverger). */
export function variantBase(kind: string, i: number): string {
  return `${kind}-${i}`
}

/** La clé de texture `_lit` d'un prop de clutter, variante MIROIR comprise. LA SEULE fonction qui
 *  la calcule — clutter-layer l'appelle, ce module la génère : elles ne peuvent pas diverger (un
 *  kind câblé sans texture générée donnerait le carré vert `__MISSING`). */
export function litClutterTextureKey(kind: string, mirror: boolean): string {
  return `cl-${kind}_lit${mirror ? '_m' : ''}`
}

/** Les `kind` de clutter qui ont une variante `_lit` (swap côté ClutterLayer) — DÉRIVÉ de `PROPS`
 *  (tout `cl-*`) + les FAMILLES à variétés (`flower`, `pebbles` : hors `PROPS`, plusieurs textures
 *  chacune). Un kind ne peut jamais figurer ici sans que sa/ses texture(s) soi(en)t générée(s). */
export const LIT_CLUTTER_KINDS: ReadonlySet<string> = new Set([
  ...PROPS.filter((p) => p.key.startsWith('cl-')).map((p) => p.key.slice(3)),
  ...VARIANT_FAMILIES.map((f) => f.kind),
])
/** Les `type` de NŒUD qui ont une variante `_lit` (swap côté SnapshotView). LISTE EXPLICITE, PAS
 *  une dérivation du préfixe `nd-` : ce namespace contient aussi des sprites qui NE sont PAS des
 *  types de nœud (`nd-tree_trunk`, `nd-tree_crown`, `nd-berry_bush-2`, `nd-rubble`, `nd-fiber_plant`…).
 *  Dériver de `nd-*` polluerait ce whitelist et ferait demander à SnapshotView un `nd-<type>_lit`
 *  inexistant. On ne met ici QUE des `n.type` réels (test : chacun a bien sa texture générée). */
export const LIT_NODE_TYPES: ReadonlySet<string> = new Set(['rock', 'champignon'])
/** Toutes les clés de texture RÉELLEMENT générées par `generateLitProps` — surface testable du
 *  câblage (le clutter a `_lit` + `_lit_m` ; les nœuds, `_lit` seul ; chaque variété de fleur, les deux). */
export const LIT_PROP_KEYS: ReadonlySet<string> = new Set([
  ...PROPS.flatMap((p) => (p.key.startsWith('cl-') ? [`${p.key}_lit`, `${p.key}_lit_m`] : [`${p.key}_lit`])),
  ...VARIANT_FAMILIES.flatMap((fam) => fam.draws.flatMap((_, i) => [`cl-${variantBase(fam.kind, i)}_lit`, `cl-${variantBase(fam.kind, i)}_lit_m`])),
])

/** Copie MIROIR horizontale d'un canvas. La normale de `_lit_m` est dérivée de CE canvas retourné
 *  (pas d'un flip Phaser, qui ne retourne pas le canal X de la normale) → éclairage X juste par
 *  construction. */
function mirrorCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, ctx } = newCanvas(src.width, src.height)
  ctx.translate(src.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(src, 0, 0)
  return c
}

/** Enregistre les variantes `_lit` (albédo + normal map) de tout le décor, et `_lit_m` (miroir
 *  pré-retourné) pour le clutter — voir l'en-tête. */
export function generateLitProps(scene: Phaser.Scene): void {
  for (const p of PROPS) {
    const alb = newCanvas(p.w, p.h)
    p.draw(alb.ctx)
    register(scene, `${p.key}_lit`, alb.c, normalFromCanvas(alb.c, p.passes, p.k))
    if (p.key.startsWith('cl-')) {
      const m = mirrorCanvas(alb.c)
      register(scene, `${p.key}_lit_m`, m, normalFromCanvas(m, p.passes, p.k))
    }
  }
  // Les FAMILLES à variétés (fleurs, cailloux…) — chacune son `cl-<kind>-<i>_lit` + `_lit_m`.
  for (const fam of VARIANT_FAMILIES) {
    for (let i = 0; i < fam.draws.length; i++) {
      const alb = newCanvas(16, 16)
      fam.draws[i]!(alb.ctx)
      const base = `cl-${variantBase(fam.kind, i)}`
      register(scene, `${base}_lit`, alb.c, normalFromCanvas(alb.c, fam.passes, fam.k))
      const m = mirrorCanvas(alb.c)
      register(scene, `${base}_lit_m`, m, normalFromCanvas(m, fam.passes, fam.k))
    }
  }
}

/**
 * LE FEU — 2-3 BÛCHES CROISÉES, NORMAL-MAPPÉES (demande d'Alexis). Contrairement à la
 * masse pâteuse (un blob lissé depuis la silhouette), on bâtit un vrai CHAMP DE HAUTEUR
 * où CHAQUE bûche est un RONDIN cylindrique : la normale montre alors des rondins
 * distincts, pas une bosse. De ce même relief on tire l'ombrage du sprite NON éclairé —
 * les deux modes montrent le même bois. La flamme vit dans les particules (FireFx), pas
 * ici : la base est du bois mat, propre à éclairer.
 *
 * Tout est sur la grille 2 px (évaluation par cellule de 2×2) — le style pixel du jeu.
 */
const FIRE_SIZE = 16
const FIRE_CELL = 2
// x0,y0 → x1,y1 (px) et rayon du rondin : deux diagonales croisées + un rondin au sol devant.
const FIRE_LOGS: readonly (readonly [number, number, number, number, number])[] = [
  [3, 4, 13, 11, 2.6],
  [13, 4, 3, 11, 2.6],
  [4, 13, 12, 13, 2.3],
]
const FIRE_TONES: readonly [number, number, number][] = [
  [0x6b, 0x4a, 0x2f], // bois
  [0x77, 0x53, 0x30], // bois, une pointe plus chaud
  [0x5f, 0x43, 0x28], // bois, plus sombre (le rondin du sol, dans l'ombre des autres)
]
const FIRE_NORMAL_K = 3.4 // gain sur le gradient de hauteur — le galbe des rondins

function distToSegment(px: number, py: number, seg: readonly [number, number, number, number, number]): number {
  const [x0, y0, x1, y1] = seg
  const dx = x1 - x0
  const dy = y1 - y0
  const l2 = dx * dx + dy * dy || 1
  let t = ((px - x0) * dx + (py - y0) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  const cx = x0 + t * dx
  const cy = y0 + t * dy
  const ex = px - cx
  const ey = py - cy
  return Math.sqrt(ex * ex + ey * ey)
}

/** Enregistre `st-fire` (bois ombré, hors éclairage dynamique) et `st-fire_lit` (bois mat
 *  + normal map cylindrique, pour le pipeline de lumières). Appelé au boot. */
export function generateFireProp(scene: Phaser.Scene): void {
  const S = FIRE_SIZE
  const cells = S / FIRE_CELL // 8×8 cellules de 2 px
  // Hauteur et bûche d'appartenance PAR CELLULE (le rondin le plus haut l'emporte).
  const H = new Float32Array(cells * cells)
  const which = new Int8Array(cells * cells).fill(-1)
  let hMax = 0
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const px = cx * FIRE_CELL + FIRE_CELL / 2
      const py = cy * FIRE_CELL + FIRE_CELL / 2
      let best = -1
      let hi = 0
      for (let i = 0; i < FIRE_LOGS.length; i++) {
        const seg = FIRE_LOGS[i]!
        const r = seg[4]
        const d = distToSegment(px, py, seg)
        if (d >= r) continue
        const h = Math.sqrt(r * r - d * d) // section circulaire du rondin
        if (h > hi) { hi = h; best = i }
      }
      H[cy * cells + cx] = hi
      which[cy * cells + cx] = best
      if (hi > hMax) hMax = hi
    }
  }
  const hAt = (cx: number, cy: number): number =>
    H[Math.min(cells - 1, Math.max(0, cy)) * cells + Math.min(cells - 1, Math.max(0, cx))]! / (hMax || 1)

  const albedo = newCanvas(S, S) // bois MAT (variante _lit)
  const shaded = newCanvas(S, S) // bois OMBRÉ (variante non éclairée)
  const normal = newCanvas(S, S)
  const nd = normal.ctx.createImageData(S, S)
  // Lumière FIXE du sprite non éclairé : le hillshade maison (haut-gauche).
  const [lx, ly, lz] = norm3(-0.5, -0.6, 0.85)
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const b = which[cy * cells + cx]!
      if (b < 0) continue // pas de bois ici : transparent (la silhouette vient de l'albédo)
      // Normale de la cellule = gradient du champ de hauteur, galbé par K.
      const dhx = hAt(cx + 1, cy) - hAt(cx - 1, cy)
      const dhy = hAt(cx, cy + 1) - hAt(cx, cy - 1)
      const [nx, ny, nz] = norm3(-dhx * FIRE_NORMAL_K, -dhy * FIRE_NORMAL_K, 1)
      const [r, g, bl] = FIRE_TONES[b]!
      // Albédo mat.
      albedo.ctx.fillStyle = `rgb(${r},${g},${bl})`
      albedo.ctx.fillRect(cx * FIRE_CELL, cy * FIRE_CELL, FIRE_CELL, FIRE_CELL)
      // Ombré : albédo × (ambiante + diffus du relief).
      const diff = Math.max(0, nx * lx + ny * ly + nz * lz)
      const k = 0.55 + 0.55 * diff
      shaded.ctx.fillStyle = `rgb(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(bl * k))})`
      shaded.ctx.fillRect(cx * FIRE_CELL, cy * FIRE_CELL, FIRE_CELL, FIRE_CELL)
      // Normal map (encodée) sur le bloc 2×2.
      for (let y = cy * FIRE_CELL; y < (cy + 1) * FIRE_CELL; y++) {
        for (let x = cx * FIRE_CELL; x < (cx + 1) * FIRE_CELL; x++) {
          const idx = (y * S + x) * 4
          nd.data[idx] = enc(nx)
          nd.data[idx + 1] = enc(FLIP_G ? -ny : ny)
          nd.data[idx + 2] = enc(nz)
          nd.data[idx + 3] = 255
        }
      }
    }
  }
  normal.ctx.putImageData(nd, 0, 0)
  // `st-fire` : sprite ombré simple (aucune normal — rendu quand l'éclairage est éteint).
  if (scene.textures.exists('st-fire')) scene.textures.remove('st-fire')
  scene.textures.addCanvas('st-fire', shaded.c)
  // `st-fire_lit` : bois mat + normal map (rendu quand l'éclairage est armé).
  register(scene, 'st-fire_lit', albedo.c, normal.c)
}
