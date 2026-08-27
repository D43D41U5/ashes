/**
 * LA RECETTE DE NORMALE — le module UNIQUE du pipeline `_lit` (spec da-feeling R1).
 *
 * Trois copies vivaient dans le code (lit-trees l'ancêtre, lit-props la généralisation, poi-lit
 * le surensemble) — la recopie de poi-lit était EXPLICITEMENT temporaire (découplage le temps
 * qu'un A/B se joue dans lit-props ; il est tranché et commité depuis). On factorise ICI la
 * version FINALE : celle de poi-lit, dont lit-props est le cas particulier exact
 * (`cell=2, plant=false, cracks=[]` — vérifié ligne à ligne, garde `max(2,…)` comprise :
 * bit-identique, le smoke `cubique` en témoigne).
 *
 * CE QUE LE MODULE SAIT, ET QUE PERSONNE NE DOIT RÉAPPRENDRE :
 *   • La normale se dérive de NOTRE canvas (getImageData), JAMAIS d'une texture Phaser générée
 *     (relecture WebGL incertaine).
 *   • FLIP_G : Phaser attend le vert « Y vers le haut » ; notre espace a Y vers le bas.
 *   • Le MIROIR est une texture `_lit_m` PRÉ-RETOURNÉE dont la normale se dérive DU canvas
 *     retourné — un setFlipX Phaser n'inverse pas le canal X de la normale (mesuré le 24/07).
 *   • Les OMBRES bakées (bandes 0,22, flaques 0,26) se peignent APRÈS la dérivation : le masque
 *     alpha les lirait comme de la MATIÈRE et affaisserait l'arête basse (épinglé le 25/07).
 *   • Les cadrans du 24/07 : petit prop blocky = `passes:1, k:3,5` ; grosse masse = `4 / 2,6` ;
 *     lieu de 42 px = `cell:3` (les facettes grossissent avec la masse, sinon la normale
 *     « grouille ») + base PLANTÉE + fissures gravées.
 */
import type Phaser from 'phaser'

export const FLIP_G = true // Phaser attend le vert « Y vers le haut » ; notre espace a Y vers le bas

export function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

export function enc(v: number): number {
  return Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)))
}

export function newCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  // `willReadFrequently` DÈS LA CRÉATION : ces canvas sont RELUS (getImageData) — par nous pour
  // dériver la normale, et par Phaser lui-même (`CanvasTexture` relit tout le canvas à
  // `addCanvas`). Les attributs de contexte ne s'appliquent qu'à la PREMIÈRE création : le
  // `{ willReadFrequently: true }` que Phaser passe ensuite sur le même canvas est IGNORÉ, d'où
  // les 166 avertissements Canvas2D au boot (mesuré le 26/07). Ils sont des SOURCES de texture,
  // jamais composités : les garder côté CPU est de toute façon le bon choix.
  return { c, ctx: c.getContext('2d', { willReadFrequently: true })! }
}

/** Une fissure = un CHEMIN (polyligne) qui PART d'un point réel (le sol, la jonction de deux
 *  pierres) et remonte en s'affinant. `crevasse` en élargit/creuse l'ORIGINE (path[0]). Elle
 *  creuse la NORMALE (un sillon) — le liseré d'albédo, lui, appartient au peintre. */
type Pt = readonly [number, number]
export interface Crack { path: readonly Pt[]; crevasse?: boolean }

/** Parcourt une polyligne à ~2 échantillons/px ; `fn(px, py, t)` avec t∈[0,1] de l'origine à la pointe. */
export function walkPath(path: readonly Pt[], fn: (px: number, py: number, t: number) => void): void {
  const seg: number[] = []
  let total = 0
  for (let i = 0; i < path.length - 1; i++) {
    const L = Math.hypot(path[i + 1]![0] - path[i]![0], path[i + 1]![1] - path[i]![1])
    seg.push(L); total += L
  }
  if (total === 0) { fn(path[0]![0], path[0]![1], 0); return }
  let acc = 0
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = path[i]!, [x1, y1] = path[i + 1]!, L = seg[i]!
    const steps = Math.max(1, Math.ceil(L * 2))
    for (let s = 0; s <= steps; s++) { const f = s / steps; fn(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, (acc + L * f) / total) }
    acc += L
  }
}

/** Grave les fissures dans le champ de hauteur AVANT lissage : rayon et profondeur DÉCROISSENT
 *  de l'origine (large/creuse) vers la pointe (capillaire). On ne creuse que la matière (hf ≥ 0). */
function carveCracks(hf: Float32Array, w: number, h: number, cracks: readonly Crack[]): void {
  for (const cr of cracks) {
    const wide = cr.crevasse ? 2.2 : 1.5
    const deep = cr.crevasse ? 0.9 : 0.7
    walkPath(cr.path, (px, py, t) => {
      const rad = wide * (1 - t) + 0.55 * t
      const dep = deep * (1 - t) + 0.3 * t
      const r = Math.ceil(rad), cx = Math.round(px), cy = Math.round(py)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx, yy = cy + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const d = Math.hypot(dx, dy)
        if (d > rad) continue
        const idx = yy * w + xx
        hf[idx] = Math.max(0, hf[idx]! - dep * (1 - d / rad))
      }
    })
  }
}

/**
 * LA carte de normales : masque alpha → butte lissée (`passes`) → facettes de `cell` px →
 * gradient de cellule × `k`. `plant` = base plantée (le bord bas ne plonge plus — le galet ne
 * « roule » pas sous sa base) ; `cracks` = sillons gravés avant lissage ; `relief` = hauteur de
 * MATIÈRE non binaire (l'écorce d'un tronc), qui remplace le plateau plein.
 */
export function normalFromCanvas(
  src: HTMLCanvasElement,
  passes = 4,
  k = 2.6,
  cell = 2,
  plant = false,
  cracks: readonly Crack[] = [],
  relief?: Float32Array,
): HTMLCanvasElement {
  const w = src.width, h = src.height
  // Le drapeau ne mord que si `src` vient de `newCanvas` (il y est déjà) — on le redit ici pour
  // qu'un futur appelant qui apporterait SON canvas ne réintroduise pas l'avertissement.
  const srcData = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  let hf = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) hf[i] = srcData[i * 4 + 3]! > 8 ? 1 : 0
  // LE RELIEF INTERNE — la seule chose que ce module ne savait pas faire, et qui manquait.
  //
  // Le champ de départ est BINAIRE : matière (1) ou vide (0). Une masse pleine est donc un
  // PLATEAU, et la normale n'y trouve de pente qu'aux BORDS — c'est parfait pour un galet ou un
  // houppier, dont toute la forme est la silhouette, et c'est précisément pourquoi le tronc,
  // lui, avait dû être calculé à part (un cylindre analytique dans `lit-trees`). Un `relief`
  // facultatif donne à la matière une hauteur non binaire : l'écorce peut enfin creuser DANS la
  // colonne. Il ne s'applique qu'à la matière (`hf > 0`), jamais au vide — le contour reste la
  // silhouette, et sans lui le module rend exactement ce qu'il rendait.
  if (relief) for (let i = 0; i < w * h; i++) if (hf[i]! > 0) hf[i] = relief[i]!
  if (plant) {
    for (let x = 0; x < w; x++) {
      let lowest = -1
      for (let y = 0; y < h; y++) if (srcData[(y * w + x) * 4 + 3]! > 8) lowest = y
      for (let y = lowest + 1; y < h; y++) hf[y * w + x] = 1
    }
  }
  if (cracks.length) carveCracks(hf, w, h, cracks)
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
  const cellsX = Math.max(2, Math.round(w / cell)), cellsY = Math.max(2, Math.round(h / cell))
  const csx = w / cellsX, csy = h / cellsY
  const H = new Float32Array(cellsX * cellsY)
  for (let cy = 0; cy < cellsY; cy++) for (let cx = 0; cx < cellsX; cx++) {
    let s = 0, cnt = 0
    for (let y = Math.floor(cy * csy); y < Math.floor((cy + 1) * csy); y++)
      for (let x = Math.floor(cx * csx); x < Math.floor((cx + 1) * csx); x++) { s += hf[y * w + x]!; cnt++ }
    H[cy * cellsX + cx] = cnt ? s / cnt : 0
  }
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
      const [nx, ny, nz] = norm3(-dhx * k, -dhy * k, 1)
      d.data[i] = enc(nx)
      d.data[i + 1] = enc(FLIP_G ? -ny : ny)
      d.data[i + 2] = enc(nz)
      d.data[i + 3] = 255
    }
  }
  out.ctx.putImageData(d, 0, 0)
  return out.c
}

/** Copie MIROIR horizontale d'un canvas — la matière première d'une `_lit_m`. */
export function mirrorCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, ctx } = newCanvas(src.width, src.height)
  ctx.translate(src.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(src, 0, 0)
  return c
}

/** Enregistre une texture `_lit` : l'albédo en canvas, la normale en dataSource. */
export function registerLit(scene: Phaser.Scene, key: string, albedo: HTMLCanvasElement, normal: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key)
  const tex = scene.textures.addCanvas(key, albedo)
  tex?.setDataSource(normal)
}

// ═══════════════════════════════════════════════════════════════════════════
//  LA PAIRE — LA MÉTHODE PAR DÉFAUT DE TOUT SPRITE DRESSÉ
//  (demande d'Alexis, 2026-08-27 : « la même technique pour tout ce qui est dressé »)
// ═══════════════════════════════════════════════════════════════════════════
//
// Un sprite DRESSÉ se retourne pour varier le décor — et un `setFlipX` Phaser retourne le
// sprite SANS inverser le canal X de sa normale : le miroir s'éclaire alors du mauvais côté
// (mesuré le 24/07). Le miroir est donc une TEXTURE, `_lit_m`, dont l'albédo ET la normale
// sont pré-retournés.
//
// La recette tenait en quatre lignes recopiées dans `lit-props`, `poi-lit` et
// `essai-da-caillou`, avec son ordre commenté en prose à chaque fois. Elle vit ICI désormais,
// en UN exemplaire, parce que son ORDRE est ce qui casse en silence :
//
//   ① LES DEUX NORMALES SE DÉRIVENT DE LA MASSE NUE. `normalFromCanvas` lit le masque ALPHA :
//      une ombre bakée y passerait pour de la matière et affaisserait l'arête basse.
//   ② L'OMBRE SE POSE ENSUITE, sur l'albédo, une seule fois.
//   ③ ET LE MIROIR SE PREND SUR L'ALBÉDO OMBRÉ, pas sur la masse nue — sinon une tuile sur
//      deux livre un caillou sans ombre (journal du 25/07, payé une fois).
//
// `dresse` est REQUIS, sans valeur par défaut, et c'est délibéré : un défaut à `true` aurait
// donné sa `_lit_m` à l'eau, aux dalles du gué et aux sols de friche sans que personne s'en
// avise, et un défaut à `false` aurait laissé le compilateur muet sur chaque nouveau sprite
// dressé. En le rendant obligatoire, `tsc` énumère les sites d'appel à notre place — la leçon
// de `enumerer-une-union-par-le-compilateur`. « Dressé par défaut » ne veut pas dire un drapeau
// qui vaut `true` tout seul : ça veut dire qu'il n'y a qu'UNE recette, et que tout ce qui se
// tient debout y passe.

/**
 * LA CLÉ D'UNE TEXTURE `_lit`, VARIANTE MIROIR COMPRISE — la SEULE fabrique de ce nom.
 * Générateurs et consommateurs l'appellent tous les deux : ils ne peuvent donc pas diverger.
 * Un miroir généré que personne ne pose est une loi morte ; un miroir posé que personne n'a
 * généré est le carré vert `__MISSING`. Les deux se voient, aucun ne se rattrape.
 */
export function cleLit(base: string, miroir = false): string {
  return miroir ? `${base}_lit_m` : `${base}_lit`
}

/** Le relief se retourne AVEC le canvas — sinon la normale du miroir creuse à l'envers de sa
 *  matière. (Il vivait dans `essai-da-caillou` ; il appartient à la recette.) */
export function mirrorRelief(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = src[y * w + (w - 1 - x)]!
  return out
}

/** Les sillons se retournent AVEC le canvas : `[x, y] → [w - 1 - x, y]`. (Il vivait inline
 *  dans `poi-lit` ; même raison — une fissure gravée à droite doit passer à gauche.) */
export function mirrorCracks(cracks: readonly Crack[], w: number): readonly Crack[] {
  return cracks.map((c) => ({ ...c, path: c.path.map(([x, y]) => [w - 1 - x, y] as const) }))
}

/**
 * LE CHAMP DE NORMALES ÉCRIT À LA MAIN SE RETOURNE AUTREMENT QU'UN CANVAS — et c'est pour ça
 * qu'il a son propre chemin (`registerLitPaireDeChamp`) au lieu d'être plié dans la recette
 * ordinaire. Retourner l'image ne suffit pas : il faut aussi **nier `nx`**, parce qu'une pente
 * qui montait vers l'est monte vers l'ouest une fois la pierre retournée. `ny` et `nz` ne
 * bougent pas — le miroir est horizontal.
 *
 * `field` est entrelacé (nx, ny, nz), repère écran, y vers le BAS — comme `packNormals`.
 */
export function mirrorField(field: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + (w - 1 - x)) * 3
      const dst = (y * w + x) * 3
      out[dst] = -field[src]!
      out[dst + 1] = field[src + 1]!
      out[dst + 2] = field[src + 2]!
    }
  }
  return out
}

/** Le masque de matière qui accompagne le champ — retourné, lui, sans autre forme de procès. */
export function mirrorAlpha(alpha: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = alpha[y * w + (w - 1 - x)]!
  return out
}

/**
 * LE MIROIR D'UNE NORMALE DÉJÀ ENCODÉE — pour qui a écrit sa carte à la main, en pixels, sans
 * garder le champ flottant sous la main (le Feu et ses bûches croisées).
 *
 * Retourner l'image ne suffit pas, exactement comme pour `mirrorField` : il faut aussi INVERSER
 * LE CANAL X. Encodé, `-x` s'écrit `255 - enc(x)` — c'est l'inverse exact de `enc`, au bit de
 * l'arrondi près. Le vert (Y) et le bleu (Z) ne bougent pas : le miroir est horizontal.
 *
 * ⚠ Sans cette inversion on obtient le défaut même qu'on chasse : une pierre retournée dont la
 * face éclairée reste du côté d'avant.
 */
export function mirrorNormalCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h)
  const out = newCanvas(w, h)
  const o = out.ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + (w - 1 - x)) * 4
      const di = (y * w + x) * 4
      o.data[di] = 255 - d.data[si]!
      o.data[di + 1] = d.data[si + 1]!
      o.data[di + 2] = d.data[si + 2]!
      o.data[di + 3] = d.data[si + 3]!
    }
  }
  out.ctx.putImageData(o, 0, 0)
  return out.c
}

/** Ce qu'un sprite éclairable a besoin de dire de lui-même. `albedo` porte la MASSE NUE — sans
 *  ombre bakée : c'est `ombrer` qui la pose, et la recette décide QUAND. */
export interface RecetteLit {
  albedo: HTMLCanvasElement
  /** SE TIENT-IL DEBOUT ? Requis — voir l'en-tête de section. `false` = au ras du sol (une
   *  dalle, un plancher, une flaque) : pas de miroir, il n'apporterait rien de visible. */
  dresse: boolean
  /** L'ombre de contact, bakée dans l'albédo APRÈS la dérivation des deux normales. */
  ombrer?: ((ctx: CanvasRenderingContext2D) => void) | undefined
  // Les cadrans sont RELAYÉS tels quels par des appelants qui les tiennent facultatifs — d'où le
  // `| undefined` explicite (`exactOptionalPropertyTypes`), et non un simple `?`.
  passes?: number | undefined
  k?: number | undefined
  cell?: number | undefined
  plant?: boolean | undefined
  sillons?: readonly Crack[] | undefined
  relief?: Float32Array | undefined
}

/**
 * POSE `<base>_lit` — ET `<base>_lit_m` SI LE SPRITE EST DRESSÉ. L'unique chemin.
 *
 * Les défauts de `passes`/`k`/`cell` sont ceux de `normalFromCanvas` : ils ne sont pas
 * redéclarés ici, sans quoi deux tables de cadrans finiraient par se désaccorder.
 */
/**
 * LA POSE, NUE — les deux clés, l'albédo et son retourné. Sortie de `registerLitPaire` pour qui
 * a déjà ses normales sous la main : le recuit saisonnier des cimes redessine trente-cinq
 * albédos par cran, mais leur NORMALE ne dépend pas du jour et vit en cache. Lui faire redériver
 * la normale à chaque recuit, c'est payer la seule partie chère pour rien.
 *
 * ⚠ Le retourné se prend ICI, sur l'albédo tel qu'il est passé — donc OMBRÉ si l'appelant l'a
 * ombré. C'est l'ordre de `registerLitPaire`, et il n'y a pas deux façons de le faire.
 */
export function poserPaire(
  scene: Phaser.Scene,
  cles: (miroir: boolean) => string,
  albedo: HTMLCanvasElement,
  normale: HTMLCanvasElement,
  normaleMiroir: HTMLCanvasElement | null,
): void {
  const albM = normaleMiroir ? mirrorCanvas(albedo) : null
  registerLit(scene, cles(false), albedo, normale)
  if (normaleMiroir && albM) registerLit(scene, cles(true), albM, normaleMiroir)
}

export function registerLitPaire(scene: Phaser.Scene, base: string, r: RecetteLit): void {
  const w = r.albedo.width
  const h = r.albedo.height
  const sillons = r.sillons ?? []
  // ① LES DEUX NORMALES, SUR LA MASSE NUE. Le miroir dérive la sienne DU CANVAS RETOURNÉ —
  //    jamais un flip appliqué après coup, qui laisserait le canal X à l'endroit.
  const nrm = normalFromCanvas(r.albedo, r.passes, r.k, r.cell, r.plant, sillons, r.relief)
  const nrmM = r.dresse
    ? normalFromCanvas(
      mirrorCanvas(r.albedo), r.passes, r.k, r.cell, r.plant,
      mirrorCracks(sillons, w),
      r.relief ? mirrorRelief(r.relief, w, h) : undefined,
    )
    : null
  // ② L'OMBRE, une fois, sur l'albédo.
  r.ombrer?.(r.albedo.getContext('2d', { willReadFrequently: true })!)
  // ③ LE MIROIR SE PREND SUR L'ALBÉDO OMBRÉ, et AVANT que Phaser ne prenne la propriété du
  //    canvas (`addCanvas`). Les deux raisons sont bonnes ; la seconde est silencieuse.
  poserPaire(scene, (m) => cleLit(base, m), r.albedo, nrm, nrmM)
}

/** Ce qu'un sprite dont la normale est ÉCRITE À LA MAIN a besoin de dire de lui-même. */
export interface RecetteLitChamp {
  albedo: HTMLCanvasElement
  /** Le champ entrelacé (nx, ny, nz), repère écran, y vers le BAS. */
  champ: Float32Array
  /** Ce qui est MATIÈRE — le vide reçoit la normale plate. */
  alpha: Uint8Array
  dresse: boolean
  ombrer?: ((ctx: CanvasRenderingContext2D) => void) | undefined
}

/** POSE LA PAIRE D'UN SPRITE À NORMALE ÉCRITE À LA MAIN (le socle minéral). Même ordre que
 *  `registerLitPaire` — l'ombre après, le miroir sur l'ombré — mais le miroir du CHAMP passe
 *  par `mirrorField`, qui nie `nx`. */
export function registerLitPaireDeChamp(scene: Phaser.Scene, base: string, r: RecetteLitChamp): void {
  const w = r.albedo.width
  const h = r.albedo.height
  const nrm = packNormals(r.champ, r.alpha, w, h)
  const nrmM = r.dresse ? packNormals(mirrorField(r.champ, w, h), mirrorAlpha(r.alpha, w, h), w, h) : null
  r.ombrer?.(r.albedo.getContext('2d', { willReadFrequently: true })!)
  poserPaire(scene, (m) => cleLit(base, m), r.albedo, nrm, nrmM)
}

/**
 * EMBALLE UN CHAMP DE NORMALES ÉCRIT À LA MAIN (socle minéral) — même encodage que
 * `normalFromCanvas`, et c'est tout l'intérêt de le sortir ici : `enc` et `FLIP_G` ne sont
 * appliqués qu'à UN endroit. Un module qui referait « 128 + v × 127 » de son côté finirait par
 * diverger de la convention du shader, et l'erreur serait plausible à l'œil (une face claire,
 * une face sombre) tout en étant inversée.
 *
 * `field` est entrelacé (nx, ny, nz), dans le repère de l'écran, **y vers le BAS** — comme le
 * gradient de `normalFromCanvas`. `alpha` décide de ce qui est matière ; le vide reçoit la
 * normale plate, jamais une valeur non initialisée.
 */
export function packNormals(field: Float32Array, alpha: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const out = newCanvas(w, h)
  const d = out.ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (!alpha[i]) {
      d.data[o] = enc(0); d.data[o + 1] = enc(0); d.data[o + 2] = enc(1); d.data[o + 3] = 255
      continue
    }
    const nx = field[i * 3]!, ny = field[i * 3 + 1]!, nz = field[i * 3 + 2]!
    d.data[o] = enc(nx)
    d.data[o + 1] = enc(FLIP_G ? -ny : ny)
    d.data[o + 2] = enc(nz)
    d.data[o + 3] = 255
  }
  out.ctx.putImageData(d, 0, 0)
  return out.c
}
