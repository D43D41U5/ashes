/**
 * LES NÉNUPHARS (geste 09, eau-fond) — l'eau immobile porte sa flore.
 *
 * Des coussins ANCRÉS sur le haut-fond calme (pas de courant : les lacs et les
 * mares — la rivière emporte tout), semés par hash positionnel autour de la caméra
 * à la manière des feuilles (`feuilles-derive.ts`) mais SANS dérive : un nénuphar
 * est amarré.
 *
 * DA CUBIQUE (reprise sur retour d'Alexis — le premier jet n'avait ni la silhouette
 * ni la normale) : la recette des dalles de gué, à l'identique — silhouette BLOCKY
 * en rects, albédo deux MATÉRIAUX (coussin, plat qui prend le jour), variante `_lit`
 * + carte de normales `passes:1`/`k:3.5` (un cube net, pas un dôme), sprites en
 * `setLighting(true)`, et JAMAIS de flipX en mode lit — un flip Phaser n'inverse pas
 * le canal X de la normale ; la variété vient des deux gabarits et de l'échelle.
 * Ombre de contact séparée sur le lit (silhouette FILL décalée de 2 px — l'épaisseur
 * d'eau), bob d'1 px par crans francs — jamais un glissé.
 *
 * DÉCOR ASSUMÉ, la frontière est écrite : le jour où les nénuphars se récoltent,
 * ce sont de vrais nœuds posés dans /sim (règle « objets de jeu réels ») — un
 * chantier séparé, à trancher explicitement.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { flowAt, type FlowField } from '../../render/flow-field'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { enc, FLIP_G, newCanvas, norm3, registerLit } from '../../render/normal-map'
import { riveAt, type RiveField } from '../../render/water-field'

/** Sur l'eau (−0,75), sous les feuilles (−0,68) : le coussin flotte, amarré. */
const NENUPHAR_DEPTH = GROUND_MAP_DEPTH + 0.3
/** L'ombre sur le lit — même palier que celle des feuilles. */
const OMBRE_DEPTH = GROUND_MAP_DEPTH + 0.26
const OMBRE_ALPHA = 0.3
const OMBRE_DECALE_PX = 2
/** Le plafond de coussins À L'ÉCRAN — deux à trois colonies, pas un tapis. */
const MAX_NENUPHARS = 16
const RAYON = 28
/** Une colonie : de 3 à 6 feuilles autour d'un pied, dans ce rayon (tuiles). */
const COLONIE_MIN = 4
const COLONIE_MAX = 7
const COLONIE_RAYON = 1.1
/** Deux feuilles se CHEVAUCHENT (c'est un tapis de rhizome — elles se poussent et se
 *  montent dessus), sans se superposer pile. Une grande feuille fait 1,1 tuile : à 0,45
 *  elles mordent l'une sur l'autre de moitié, comme sur l'eau. Le premier réglage
 *  (0,75) rejetait EXACTEMENT les voisines qui font la grappe — grappe max 2, mesuré. */
const ESPACEMENT = 0.45
/** Distance minimale à la rive (tuiles) : le nénuphar tient le large — centre de mare,
 *  cœur de lac —, jamais la frange d'écume. */
const RIVE_MIN = 1.2
/** Les deux eaux (ids de `TERRAINS`, sim/balance.ts) — même duplication assumée que les
 *  feuilles. Le cœur PROFOND d'un lac est le lieu-dit du nénuphar : il s'enracine au
 *  fond et monte à la surface. Sur le profond, pas d'ombre portée : pas de lit visible. */
const SHALLOW = 4
const DEEP = 6

/**
 * LA TOILE : 16×16, comme TOUT le clutter (`lit-props.ts`). Ce n'est pas cosmétique —
 * la normale facette par cellules de 2 px, et une toile de côté impair coupe la
 * dernière cellule en deux (les 11×9 du premier jet grésillaient au bord).
 */
const TOILE = 20

/**
 * LES GABARITS — trois tailles de feuille, chacune sa fente. La botanique donne la
 * silhouette : un disque à peine ovale, FENDU d'un sinus qui va du bord jusqu'au
 * CENTRE (là où s'attache le pétiole — c'est par là que l'eau de pluie s'évacue).
 * Ce n'est donc pas un coin rogné : c'est une entaille en V qui mord jusqu'au cœur.
 * Le sinus pointe dans une direction différente par gabarit : la variété vient de là,
 * de la taille et du vert — jamais d'un flipX, qui n'inverserait pas le canal X de la
 * normale. [demi-largeur, demi-hauteur, angle du sinus (rad, 0 = vers l'est), vert]
 *
 * UN SEUL TON PAR FEUILLE — la règle de la masse pâteuse (`lit-props.ts` : « silhouette
 * APLATIE d'une seule couleur », l'albédo SANS ombrage directionnel peint). Le premier
 * jet avait un « plat qui prend le jour » : c'était un hillshade cuit, exactement ce qui
 * se bat avec la lumière calculée. Deux tons ne se justifient que pour deux MATÉRIAUX
 * (le fût et le feuillage, le buisson et ses baies) — une feuille de nénuphar est un
 * seul matériau. Le relief vient à 100 % de la normale.
 */
const GABARITS: readonly (readonly [number, number, number, string])[] = [
  // Les verts sont ceux d'une feuille EN PLEIN SOLEIL, dans la famille de l'herbe du
  // pré : au premier jet, plus sombres que tout le décor, elles se lisaient comme des
  // trous dans l'eau (regardé). Le relief ne vient QUE de la lumière (normalePlaque).
  [9, 7, 0.0, '#3d6f36'], // la grande feuille (18×14 px, plus large qu'une tuile) — fente à l'est
  [7, 6, 2.36, '#427539'], // la moyenne — fente au sud-ouest
  [6, 5, 4.2, '#487c3d'], // la jeune — fente au nord-ouest
]

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

/** Peint l'albédo d'un gabarit, centré sur la toile : l'ellipse pleine d'UN vert, puis
 *  le SINUS entaillé jusqu'au centre. À 8-12 px, l'ellipse se rastérise chunky d'elle-
 *  même — le pixel-art vient de la taille, pas d'un lissage. */
function peindre(ctx: CanvasRenderingContext2D, k: number): void {
  const [rx, ry, sinus, vert] = GABARITS[k]!
  const c = TOILE / 2
  ctx.fillStyle = vert
  ctx.beginPath()
  ctx.ellipse(c, c, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  // LE SINUS : un coin de tarte retiré, du bord jusqu'au centre. `destination-out`
  // creuse VRAIMENT l'alpha — la normale, qui se dérive du masque, prendra la fente.
  const demi = 0.4 // demi-angle de la fente (rad) — large à cette taille, sinon invisible
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.moveTo(c, c)
  ctx.lineTo(c + Math.cos(sinus - demi) * TOILE, c + Math.sin(sinus - demi) * TOILE)
  ctx.lineTo(c + Math.cos(sinus + demi) * TOILE, c + Math.sin(sinus + demi) * TOILE)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * LA NORMALE D'UNE PLAQUE — et non la butte de `normalFromCanvas`.
 *
 * `normalFromCanvas` lisse la silhouette en BUTTE puis la facette : c'est la recette
 * d'une masse qui a du volume (buisson, roche, dalle), et elle est juste pour elles.
 * Un nénuphar, lui, FLOTTE À PLAT : sa face regarde le ciel d'un bout à l'autre, donc
 * le soleil doit l'éclairer d'un seul tenant. Dérivée de la silhouette, sa normale
 * l'ombrait clair d'un côté et sombre de l'autre — un petit pain, pas une feuille
 * (regardé, retour d'Alexis ; MESURÉ : 30-44 % de la surface seulement regardait le
 * ciel, la rampe de bord mangeant presque toute une feuille de 18 px).
 *
 * On l'écrit donc directement : (0,0,1) PARTOUT, et le seul DERNIER pixel du bord
 * s'incline vers l'extérieur — le bourrelet de la feuille, qui garde une arête lisible
 * sans jamais ombrer le plat. Même encodage que la recette maison (`enc`, `FLIP_G`).
 */
function normalePlaque(alb: HTMLCanvasElement): HTMLCanvasElement {
  const w = alb.width
  const h = alb.height
  const src = alb.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const { c, ctx } = newCanvas(w, h)
  const out = ctx.createImageData(w, h)
  const dedans = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3]! > 128
  const PENTE = 0.34 // l'inclinaison du bourrelet — nz reste à 0,95 : le bord prend le jour, il ne s'éteint pas
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let gx = 0
      let gy = 0
      if (dedans(x, y)) {
        if (!dedans(x + 1, y)) gx += 1
        if (!dedans(x - 1, y)) gx -= 1
        if (!dedans(x, y + 1)) gy += 1
        if (!dedans(x, y - 1)) gy -= 1
      }
      const [nx, ny, nz] = norm3(gx * PENTE, gy * PENTE, 1)
      out.data[i] = enc(nx)
      out.data[i + 1] = enc(FLIP_G ? -ny : ny)
      out.data[i + 2] = enc(nz)
      out.data[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return c
}

interface Nenuphar {
  sprite: Phaser.GameObjects.Image
  /** L'ombre sur le lit — NULLE en eau profonde : là, pas de fond visible. */
  ombre: Phaser.GameObjects.Image | null
  /** Le gabarit — pour re-swapper la texture au toggle debug. */
  k: number
  x: number // tuiles
  y: number
  /** Phase du bob — deux feuilles ne respirent pas ensemble. */
  phase: number
}

export class Nenuphars {
  private readonly coussins: Nenuphar[] = []
  private graine = 0
  private prochaine = 0
  private lit = true

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    /** Le champ de courant partagé (WaterLayer.flow) — un nénuphar n'y survit pas. */
    private readonly flow: FlowField | null,
    /** Le champ de rive partagé (WaterLayer.rive) — nul : la carte est sèche, module inerte. */
    private readonly rive: RiveField | null,
  ) {
    if (!rive) return
    // ── Les textures : la feuille peinte (mode éteint) ET sa variante _lit + normale ──
    if (!scene.textures.exists('fx-nenuphar-0')) {
      for (let k = 0; k < GABARITS.length; k++) {
        // Le peint : le même albédo — le contrat « éteint = comme avant » n'a pas
        // d'avant ici, on donne au mode OFF la version sans normale, simplement.
        const peint = newCanvas(TOILE, TOILE)
        peindre(peint.ctx, k)
        scene.textures.addCanvas(`fx-nenuphar-${k}`, peint.c)
        scene.textures.get(`fx-nenuphar-${k}`).setFilter(Phaser.Textures.FilterMode.NEAREST)
        // Le _lit : une NORMALE DE PLAQUE, pas la butte du clutter (voir normalePlaque).
        const alb = newCanvas(TOILE, TOILE)
        peindre(alb.ctx, k)
        registerLit(scene, `fx-nenuphar-${k}_lit`, alb.c, normalePlaque(alb.c))
      }
    }
  }

  /** Le toggle debug (panneau P) : _lit + LightsManager, ou le coussin peint. */
  setLighting(lit: boolean): void {
    this.lit = lit
    for (const c of this.coussins) {
      c.sprite.setTexture(lit ? `fx-nenuphar-${c.k}_lit` : `fx-nenuphar-${c.k}`)
      c.sprite.setLighting(lit)
    }
  }

  /** Pose UNE feuille : le sprite (éclairé), et son ombre SI le lit se voit. */
  private poser(tx: number, ty: number, graine: number): void {
    const k = Math.floor(hache(graine, 3, 89) * GABARITS.length) % GABARITS.length
    const px = Math.round(tx * TILE_PX)
    const py = Math.round(ty * TILE_PX)
    const sprite = this.scene.add
      .image(px, py, this.lit ? `fx-nenuphar-${k}_lit` : `fx-nenuphar-${k}`)
      // Un rien de profondeur par la position : dans la grappe, la feuille du bas
      // couvre celle du haut — le tri en Y du reste du jeu, à l'échelle du tapis.
      .setDepth(NENUPHAR_DEPTH + ty * 1e-4)
    sprite.setLighting(this.lit)
    // L'ombre de contact : la silhouette FILL de la feuille PEINTE (l'alpha suffit),
    // décalée de l'épaisseur d'eau — elle ne bobbe pas, elle est sur le lit. En eau
    // PROFONDE il n'y a pas de fond visible : pas d'ombre (la règle des feuilles).
    const ombre =
      this.terrainEn(tx, ty) === SHALLOW
        ? this.scene.add
            .image(px, py + OMBRE_DECALE_PX, `fx-nenuphar-${k}`)
            .setTint(0x10151a)
            .setTintMode(Phaser.TintModes.FILL)
            .setAlpha(OMBRE_ALPHA)
            .setDepth(OMBRE_DEPTH)
        : null
    this.coussins.push({ sprite, ombre, k, x: tx, y: ty, phase: hache(graine, 13, 57) * 6.28 })
  }

  /** Le terrain d'une position, bornes comprises (hors carte : 0 = void). */
  private terrainEn(tx: number, ty: number): number {
    const ix = Math.floor(tx)
    const iy = Math.floor(ty)
    if (ix < 0 || iy < 0 || ix >= this.map.width || iy >= this.map.height) return 0
    return this.map.terrain[iy * this.map.width + ix] ?? 0
  }

  /**
   * L'EAU QUI NE BOUGE PAS — la condition du nénuphar (il s'amarre par un rhizome ;
   * un courant, même faible, l'emporte). On sonde le VOISINAGE, pas le seul point :
   * le champ de courant s'exhale au-delà du couloir de la rivière, et un lac que le
   * fil traverse n'est dormant nulle part près de lui.
   */
  private dormante(tx: number, ty: number): boolean {
    if (!this.flow) return true
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (flowAt(this.flow, tx + dx, ty + dy)) return false
    }
    return true
  }

  /** Le lieu-dit d'une feuille : de l'eau, dormante, au large de la frange d'écume. */
  private accueille(tx: number, ty: number): boolean {
    const t = this.terrainEn(tx, ty)
    if (t !== SHALLOW && t !== DEEP) return false
    if (!this.rive || riveAt(this.rive, tx, ty) < RIVE_MIN) return false
    return this.dormante(tx, ty)
  }

  update(nowMs: number, camTx: number, camTy: number): void {
    if (!this.rive) return
    // ── LA COLONIE (retour d'Alexis + botanique) : le nénuphar se propage par RHIZOME,
    //    il ne pousse jamais seul. On cherche un PIED en eau dormante — centre de mare,
    //    cœur de lac —, puis on sème 3 à 6 feuilles autour de lui, assez serrées pour
    //    se toucher. Chaque feuille revalide son propre lieu : la grappe s'arrête d'elle
    //    -même contre la rive ou au bord du courant, elle ne déborde pas sur la berge.
    if (this.coussins.length + COLONIE_MIN <= MAX_NENUPHARS && nowMs >= this.prochaine) {
      this.prochaine = nowMs + 1600
      for (let essai = 0; essai < 8; essai++) {
        const g = this.graine++
        const px0 = camTx + (hache(g, essai, 41) - 0.5) * RAYON * 1.7
        const py0 = camTy + (hache(essai, g, 43) - 0.5) * RAYON * 1.7
        if (!this.accueille(px0, py0)) continue
        if (this.coussins.some((c) => Math.max(Math.abs(c.x - px0), Math.abs(c.y - py0)) < COLONIE_RAYON * 2)) continue
        const n = COLONIE_MIN + Math.floor(hache(g, 5, 61) * (COLONIE_MAX - COLONIE_MIN + 1))
        for (let f = 0; f < n; f++) {
          // Semis en spirale hashée autour du pied, PLUSIEURS essais par feuille : une
          // place refusée (trop près d'une sœur, hors de l'eau dormante) ne doit pas
          // trouer la colonie — c'est ce qui la laissait à 2-3 feuilles éparses.
          for (let tour = 0; tour < 5; tour++) {
            const ang = hache(g, f * 5 + tour, 67) * 6.2831853
            // Le rayon croît DOUCEMENT avec le rang : les premières feuilles se serrent
            // contre le pied, le tapis s'étale ensuite — jamais une rosace régulière.
            const r = f === 0 ? 0 : (0.5 + hache(f, g + tour, 71) * 0.5) * COLONIE_RAYON * (0.45 + (0.55 * f) / n)
            const tx = px0 + Math.cos(ang) * r
            const ty = py0 + Math.sin(ang) * r * 0.75 // le plan de l'eau est vu de biais
            if (!this.accueille(tx, ty)) continue
            if (this.coussins.some((c) => Math.abs(c.x - tx) < ESPACEMENT && Math.abs(c.y - ty) < ESPACEMENT * 0.8)) continue
            this.poser(tx, ty, g * 7 + f)
            break
          }
        }
        break
      }
    }
    // ── La vie de la feuille : un bob d'1 px par crans, et la sortie de vue ──
    for (let i = this.coussins.length - 1; i >= 0; i--) {
      const c = this.coussins[i]!
      if (Math.max(Math.abs(c.x - camTx), Math.abs(c.y - camTy)) > RAYON * 1.7) {
        c.sprite.destroy()
        c.ombre?.destroy()
        this.coussins.splice(i, 1)
        continue
      }
      // Le bob : −1 / 0 / +1 px, FRANC (Math.round) — l'eau le porte, elle ne le berce pas.
      const bob = Math.round(Math.sin(nowMs * 0.0006 + c.phase))
      c.sprite.setY(Math.round(c.y * TILE_PX) + bob)
    }
  }

  /** Sonde du smoke : les feuilles existent. */
  get vivants(): number {
    return this.coussins.length
  }

  /** Sonde du smoke : la plus grosse grappe à l'écran (voisines à ≤ 2 tuiles) — une
   *  colonie se MESURE, elle ne s'affirme pas. */
  get plusGrandeGrappe(): number {
    let max = 0
    for (const a of this.coussins) {
      let n = 0
      for (const b of this.coussins) if (Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2) n++
      if (n > max) max = n
    }
    return max
  }

  destroy(): void {
    for (const c of this.coussins) {
      c.sprite.destroy()
      c.ombre?.destroy()
    }
    this.coussins.length = 0
  }
}
