/**
 * ═══ LA GARDE DES CORPS (spec `lumiere-globale.md` LG-A8) — LE SHADER CONTRE LA RÉFÉRENCE ═══
 *
 * `passe-corps.ts` est la loi, en TypeScript ; `corps-gpu.ts` en est le décalque en GLSL. Jusqu'ici
 * rien ne les mettait face à face AU JEU : la divergence de `pointAuSol` (un ruban qui lisait sa ligne
 * sur ses rangs bas quand le GPU lisait la crête, `bdd5a41`) a été trouvée en relisant, pas par une
 * garde. Celle-ci rend un corps ARMÉ, seul, dans une `DynamicTexture` — le même nœud de rendu
 * (`GiCorpsBatch`), la même caméra inversée (`drawingContext.camera`, `noeud-corps.ts`), le même
 * champ posé — relit ses pixels, et compose chacun par `pixelDuCorps` sur LES MÊMES textures de champ
 * (relues du GPU par `ChampGpu.lire`), le même texel, la même normale. L'écart se compte en niveaux
 * d'octet, comme LG-A2.
 *
 * ═══ CE QU'ELLE PROUVE, ET CE QU'ELLE NE PROUVE PAS ═══
 * Elle compare DEUX CHEMINS sur les MÊMES ENTRÉES : si le champ GPU s'écarte de l'oracle CPU, c'est
 * LG-A2 qui le dit, pas elle. Elle dit si le fragment lit le bon texel au bon endroit (`uvDuChamp`,
 * `mondeDuFragment`), choisit la bonne branche (dessus, face, sous le pixel), et compose comme la loi.
 *
 * ═══ POURQUOI UNE DYNAMICTEXTURE, ET PAS LE CANVAS ═══
 * À l'écran, un corps est composé AVEC le voile (le quad MULTIPLY de `gi-champ`), l'ombre de contact,
 * ses voisins : relire le canvas, c'est relire une somme. Dans une `DynamicTexture` vide, le corps est
 * seul, à l'échelle 1, et chaque pixel relu est la sortie du shader — `appliquerGi` et rien d'autre.
 * Phaser dessine une `DynamicTexture` par le MÊME `renderWebGLStep` que la caméra
 * (`DynamicTextureHandler.js:393`), avec la MÊME projection (`setProjectionMatrixFromDrawingContext`,
 * `flipY = false`) : le nœud, ses uniformes et `mondeDuFragment` y valent ce qu'ils valent à l'écran.
 *
 * Elle se joue dans le SMOKE (`--scenario gi`), sous SwiftShader : sous vitest il n'y a ni canvas ni
 * WebGL (`passe-corps.ts`, en-tête). `snapshot-view.garderLesCorps` l'appelle, derrière `DEV`.
 */
import Phaser from 'phaser'
import { SIGNE_Y_NORMALE } from './corps-gpu'
import type { Rgb } from './corps-ref'
import type { ChampDeLImage } from './noeud-corps'
import { estNonTrivial, pixelDuCorps, type CielDeLHeure, type LectureDuChamp, type PixelDuCorps, type SourcesDuPixel } from './passe-corps'
import type { CorpsPose, Normale } from './sol-du-corps'

/** Les quatre cibles que les corps lisent, relues du GPU (`ChampGpu.lire`) — RGBA, rangée 0 au nord. */
export interface TexturesLues {
  readonly lumiere: Uint8Array
  readonly faceDirecte: Uint8Array
  readonly ombre: Uint8Array
  /** `gi-champ` — le `M` composé qu'un SOL (LG-R14) lit tel quel, sur l'octet même que le shader lit. */
  readonly champ: Uint8Array
}

/** Un corps à éprouver : le sprite ARMÉ tel qu'il est au jeu, et la pose dont son sac dérive. */
export interface CorpsAEprouver {
  readonly sprite: Phaser.GameObjects.Image
  readonly pose: CorpsPose
}

/** Combien de pixels ont pris chaque branche de `lectureDuFeu` — la prémisse des trois branches — et
 *  combien étaient un SOL (LG-R14), hors de ces branches. */
export interface Branches {
  nul: number
  auPied: number
  sousLePixel: number
  sol: number
}

/** UN pixel écarté, avec tout ce qui l'a composé — pour LIRE le défaut, pas seulement le compter. */
export interface PixelEcarte {
  readonly i: number
  readonly j: number
  /** RGBA relu dans la cible. */
  readonly lu: readonly [number, number, number, number]
  /** RGB attendu, en niveaux. */
  readonly attendu: readonly [number, number, number]
  /** Le texel (RGB 0-255), la normale décodée, les deux facteurs et la branche du feu. */
  readonly texel: readonly [number, number, number]
  readonly n: readonly [number, number, number]
  readonly fAstre: number
  readonly fFeu: number
  readonly ou: PixelDuCorps['ou']
}

/** L'écart d'UN corps. */
export interface EcartCorps {
  readonly cle: string
  /** Pixels opaques comparés. */
  readonly pixels: number
  /** Pixels où la normale met un terme à l'épreuve (`estNonTrivial`) — la prémisse de `g`. */
  readonly eprouvants: number
  /** Écart moyen par canal, en niveaux. */
  readonly moyenne: number
  /** Part des pixels dont le pire canal s'écarte de plus de 3 niveaux. */
  readonly partSup3: number
  readonly max: number
  readonly branches: Branches
  /**
   * Texels PLEINS relus avec un alpha < 255 : le shader rend `fragColor.a` tel quel, donc un alpha
   * mêlé sur un texel opaque dit que la cible n'a PAS échantillonné le texel au centre — un
   * demi-pixel de travers entre le quad et la grille de la cible, et toute l'épreuve serait floue.
   */
  readonly alphaMele: number
  /** Les trois pixels les plus écartés. */
  readonly echantillon: readonly PixelEcarte[]
}

/** Le verdict, sur tous les corps éprouvés. */
export interface VerdictCorps {
  readonly corps: number
  readonly pixels: number
  readonly eprouvants: number
  readonly moyenne: number
  readonly partSup3: number
  readonly max: number
  readonly branches: Branches
  /** Les cinq corps les plus écartés — pour lire le défaut, pas seulement le compter. */
  readonly pires: readonly EcartCorps[]
  /** Texels pleins relus avec un alpha mêlé, sur tous les corps (voir `EcartCorps.alphaMele`). */
  readonly alphaMele: number
  /** Ce que la garde a REFUSÉ d'éprouver, et pourquoi — une garde qui écarte en silence ne prouve rien. */
  readonly ecartes: { echelle: number; rotation: number; rognes: number; sansTexel: number; horsChamp: number }
}

const CLE_DT = '__garde-corps'
const PLAT: Normale = { x: 0, y: 0, z: 1 }

/** Les pixels d'une source de texture (canvas ou image), mis en cache par clé : on les relit par corps. */
const PIXELS: Map<string, ImageData | null> = new Map()

function pixelsDe(cle: string, source: Phaser.Textures.TextureSource | undefined): ImageData | null {
  const memo = PIXELS.get(cle)
  if (memo !== undefined) return memo
  const img = source?.image as CanvasImageSource | undefined
  const w = source?.width ?? 0
  const h = source?.height ?? 0
  let data: ImageData | null = null
  if (img && w > 0 && h > 0) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.drawImage(img, 0, 0)
      data = ctx.getImageData(0, 0, w, h)
    }
  }
  PIXELS.set(cle, data)
  return data
}

/** La normale telle que `getNormalFromMap` la décode (normalisée), portée dans le repère de la loi. */
function normaleDe(nor: ImageData | null, k: number): Normale {
  if (nor === null) return PLAT
  const x = (nor.data[k]! / 255) * 2 - 1
  const y = (nor.data[k + 1]! / 255) * 2 - 1
  const z = (nor.data[k + 2]! / 255) * 2 - 1
  const l = Math.hypot(x, y, z)
  if (l <= 0) return PLAT
  return { x: x / l, y: (SIGNE_Y_NORMALE * y) / l, z: z / l }
}

/** Relit le framebuffer d'une `DynamicTexture`, rangée 0 en HAUT — le motif de `ChampGpu.lire`. */
function lireLaTexture(scene: Phaser.Scene, dt: Phaser.Textures.DynamicTexture): Uint8Array | null {
  const r = scene.sys.renderer
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return null
  const dc = (dt as unknown as { drawingContext: { framebuffer: unknown } | null }).drawingContext
  if (!dc || !dc.framebuffer) return null
  r.glWrapper.updateBindingsFramebuffer({ bindings: { framebuffer: dc.framebuffer as Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper } })
  const gl = r.gl
  const w = dt.width
  const h = dt.height
  const bas = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bas)
  const haut = new Uint8Array(w * h * 4)
  for (let j = 0; j < h; j++) haut.set(bas.subarray((h - 1 - j) * w * 4, (h - j) * w * 4), j * w * 4)
  return haut
}

/**
 * UNE `DynamicTexture` À LA TAILLE DU CORPS — recréée quand la taille change plutôt que
 * redimensionnée : `setSize` redimensionne caméra et cible, mais c'est un chemin de moins à
 * prouver, et la garde ne tourne pas à chaque image.
 */
function textureDeTravail(scene: Phaser.Scene, w: number, h: number): Phaser.Textures.DynamicTexture {
  const tm = scene.textures
  if (tm.exists(CLE_DT)) {
    const dt = tm.get(CLE_DT) as Phaser.Textures.DynamicTexture
    if (dt.width === w && dt.height === h) return dt
    tm.remove(CLE_DT)
  }
  return tm.addDynamicTexture(CLE_DT, w, h) as Phaser.Textures.DynamicTexture
}

/** Rend le corps seul, sans teinte ni alpha, et rend ses pixels ; `null` si la cible n'est pas relisible. */
function rendreSeul(scene: Phaser.Scene, sprite: Phaser.GameObjects.Image, x0: number, y0: number, w: number, h: number): Uint8Array | null {
  const dt = textureDeTravail(scene, w, h)
  dt.camera.setZoom(1)
  dt.camera.setScroll(x0, y0)
  // LA TEINTE ET L'ALPHA SORTENT DE L'ÉPREUVE : `fragColor` entre dans `appliquerGi` déjà teinté, et
  // la référence compose le TEXEL. On les retire le temps du rendu, puis on les remet à l'identique.
  // Phaser 4 : quatre coins de teinte, quatre de « tint2 » et un MODE — `clearTint` remet les trois.
  const teinte = sprite.isTinted
  const t1 = [sprite.tintTopLeft, sprite.tintTopRight, sprite.tintBottomLeft, sprite.tintBottomRight] as const
  const t2 = [sprite.tint2TopLeft, sprite.tint2TopRight, sprite.tint2BottomLeft, sprite.tint2BottomRight] as const
  const mode = sprite.tintMode
  const alpha = sprite.alpha
  sprite.clearTint()
  sprite.setAlpha(1)
  // Le corps peut se tenir à une fraction de pixel : on le décale de cette fraction pour qu'il tombe
  // sur la grille de la cible — le handler ajoute `x, y` à sa position le temps du dessin, et les
  // coordonnées monde du fragment suivent ce décalage. La référence lit les mêmes points.
  const fx = Math.round(sprite.x - sprite.displayOriginX) - (sprite.x - sprite.displayOriginX)
  const fy = Math.round(sprite.y - sprite.displayOriginY) - (sprite.y - sprite.displayOriginY)
  dt.clear()
  dt.draw(sprite, fx, fy)
  dt.render()
  if (teinte) {
    sprite.setTint(t1[0], t1[1], t1[2], t1[3])
    sprite.setTint2(t2[0], t2[1], t2[2], t2[3])
    sprite.setTintMode(mode)
  }
  sprite.setAlpha(alpha)
  return lireLaTexture(scene, dt)
}

/**
 * LA GARDE — chaque corps rendu seul, chaque pixel opaque composé par la référence sur les mêmes
 * entrées, l'écart compté en niveaux. Les corps qu'elle ne sait pas éprouver sont COMPTÉS (`ecartes`).
 */
export function garderLesCorps(
  scene: Phaser.Scene,
  corps: ReadonlyArray<CorpsAEprouver>,
  champ: ChampDeLImage,
  lues: TexturesLues,
): VerdictCorps {
  const [cx, cy, gw, gh] = champ.cadre
  const pas = champ.pas
  const ciel: CielDeLHeure = { mn: [champ.mn[0], champ.mn[1], champ.mn[2]], a: champ.a, ambiante: champ.ambiante }
  const sources: SourcesDuPixel = {
    astre: champ.astre[3] > 0 ? { x: champ.astre[0], y: champ.astre[1], z: champ.astre[2] } : null,
    feu: champ.feu[3] > 0 ? { x: champ.feu[0], y: champ.feu[1], z: champ.feu[2] } : null,
  }
  // LA PRISE DE TEXEL, DANS LA CONVENTION DE LA GRILLE : le texel `i` couvre `[cadre.x + i·pas, +pas)`,
  // celle du quad de sol (`champ-gpu`, `setPosition(ox·pas, oy·pas)`) et de l'oracle. Un fragment qui
  // lirait ailleurs se verrait ici — c'est le but.
  let horsChamp = 0
  const lire = (x: number, y: number): LectureDuChamp | null => {
    const tx = Math.floor((x - cx) / pas)
    const ty = Math.floor((y - cy) / pas)
    if (tx < 0 || ty < 0 || tx >= gw || ty >= gh) return null
    const k = (ty * gw + tx) * 4
    const L = lues.lumiere
    const F = lues.faceDirecte
    const M = lues.champ
    return {
      light: [L[k]! / 255, L[k + 1]! / 255, L[k + 2]! / 255],
      directFace: [F[k]! / 255, F[k + 1]! / 255, F[k + 2]! / 255],
      ombre: lues.ombre[k + 1]! / 255,
      m: [M[k]! / 255, M[k + 1]! / 255, M[k + 2]! / 255],
    }
  }
  const NOIR: LectureDuChamp = { light: [0, 0, 0], directFace: [0, 0, 0], ombre: 0 }

  const ecartes = { echelle: 0, rotation: 0, rognes: 0, sansTexel: 0, horsChamp: 0 }
  const total = { pixels: 0, eprouvants: 0, somme: 0, sup3: 0, max: 0, alphaMele: 0 }
  const branches: Branches = { nul: 0, auPied: 0, sousLePixel: 0, sol: 0 }
  const parCorps: EcartCorps[] = []

  for (const { sprite, pose } of corps) {
    if (sprite.scaleX !== 1 || sprite.scaleY !== 1) { ecartes.echelle++; continue }
    if (sprite.rotation !== 0) { ecartes.rotation++; continue }
    if (sprite.isCropped) { ecartes.rognes++; continue }
    const frame = sprite.frame
    const w = frame.cutWidth
    const h = frame.cutHeight
    const tex = sprite.texture
    const alb = pixelsDe(tex.key, tex.source[frame.sourceIndex])
    if (alb === null) { ecartes.sansTexel++; continue }
    const nor = tex.dataSource.length > 0 ? pixelsDe(`${tex.key}#normale`, tex.dataSource[frame.sourceIndex] as Phaser.Textures.TextureSource | undefined) : null
    const x0 = Math.round(sprite.x - sprite.displayOriginX)
    const y0 = Math.round(sprite.y - sprite.displayOriginY)
    const lu = rendreSeul(scene, sprite, x0, y0, w, h)
    if (lu === null) { ecartes.sansTexel++; continue }

    let pixels = 0
    let eprouvants = 0
    let somme = 0
    let sup3 = 0
    let max = 0
    let alphaMele = 0
    const br: Branches = { nul: 0, auPied: 0, sousLePixel: 0, sol: 0 }
    const echantillon: Array<PixelEcarte & { pire: number }> = []
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        // UN MIROIR RETOURNE LE TEXEL, PAS LA NORMALE : `outInverseRotationMatrix` ne porte que la
        // rotation (`OutInverseRotation.glsl`), et `TransformerImage` ne retourne que le quad. Un
        // corps en miroir lit donc le texel d'en face avec SA normale telle quelle — c'est Phaser, et la
        // garde reproduit Phaser. (Que ce soit le bon look est une autre question, notée en LG-A8.)
        const ti = frame.cutX + (sprite.flipX ? w - 1 - i : i)
        const tj = frame.cutY + (sprite.flipY ? h - 1 - j : j)
        const kt = (tj * alb.width + ti) * 4
        // Seuls les texels PLEINS : sur un bord à demi transparent, la cible mêle le corps au vide, et ce
        // mélange-là est celui de Phaser, pas de la loi.
        if (alb.data[kt + 3]! < 255) continue
        const texel: Rgb = [alb.data[kt]! / 255, alb.data[kt + 1]! / 255, alb.data[kt + 2]! / 255]
        const normale = normaleDe(nor, kt)
        // Le fragment est au CENTRE du pixel (`mondeDuFragment`) ; le corps a été décalé sur la grille.
        // Et il est DESSINÉ : `pixelDuCorps` le remonte du lift de la pose (⓪), comme le shader.
        const xw = x0 + i + 0.5
        const yw = y0 + j + 0.5
        let hors = false
        const prise = (x: number, y: number): LectureDuChamp => {
          const l = lire(x, y)
          if (l === null) { hors = true; return NOIR }
          return l
        }
        const px = pixelDuCorps(pose, xw, yw, prise, ciel, sources, texel, normale)
        if (hors) { horsChamp++; continue }
        const k = (j * w + i) * 4
        if (lu[k + 3]! < 255) alphaMele++
        let pire = 0
        const attendu: [number, number, number] = [0, 0, 0]
        for (let c = 0; c < 3; c++) {
          attendu[c] = Math.round(Math.min(1, px.rgb[c]!) * 255)
          const d = Math.abs(lu[k + c]! - attendu[c]!)
          somme += d
          if (d > pire) pire = d
        }
        pixels++
        if (estNonTrivial(px, texel)) eprouvants++
        if (pire > 3) sup3++
        if (pire > max) max = pire
        br[px.ou]++
        if (pire > 0 && (echantillon.length < 3 || pire > echantillon[echantillon.length - 1]!.pire)) {
          echantillon.push({
            pire, i, j,
            lu: [lu[k]!, lu[k + 1]!, lu[k + 2]!, lu[k + 3]!],
            attendu,
            texel: [alb.data[kt]!, alb.data[kt + 1]!, alb.data[kt + 2]!],
            n: [+normale.x.toFixed(3), +normale.y.toFixed(3), +normale.z.toFixed(3)],
            fAstre: +px.fAstre.toFixed(4),
            fFeu: +px.fFeu.toFixed(4),
            ou: px.ou,
          })
          echantillon.sort((a, b) => b.pire - a.pire)
          if (echantillon.length > 3) echantillon.length = 3
        }
      }
    }
    if (pixels === 0) continue
    parCorps.push({
      cle: tex.key, pixels, eprouvants, moyenne: somme / (pixels * 3), partSup3: sup3 / pixels, max, branches: br, alphaMele,
      echantillon: echantillon.map((e) => ({ i: e.i, j: e.j, lu: e.lu, attendu: e.attendu, texel: e.texel, n: e.n, fAstre: e.fAstre, fFeu: e.fFeu, ou: e.ou })),
    })
    total.pixels += pixels
    total.eprouvants += eprouvants
    total.somme += somme
    total.sup3 += sup3
    total.alphaMele += alphaMele
    if (max > total.max) total.max = max
    branches.nul += br.nul
    branches.auPied += br.auPied
    branches.sousLePixel += br.sousLePixel
    branches.sol += br.sol
  }
  ecartes.horsChamp = horsChamp
  parCorps.sort((a, b) => b.moyenne - a.moyenne)
  return {
    corps: parCorps.length,
    pixels: total.pixels,
    eprouvants: total.eprouvants,
    moyenne: total.pixels > 0 ? total.somme / (total.pixels * 3) : 0,
    partSup3: total.pixels > 0 ? total.sup3 / total.pixels : 0,
    max: total.max,
    branches,
    alphaMele: total.alphaMele,
    pires: parCorps.slice(0, 5),
    ecartes,
  }
}
