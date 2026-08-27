/**
 * LES BORNES DE SEUIL — le seuil s'ANNONCE (worldgen R21, spec t0-exploration R4).
 *
 * Avant : la porte se trouvait en longeant le mur — un beau geste de design, mais le mur qu'on
 * longe avait le charisme d'un grillage, et rien ne signalait la porte à plus d'un écran. Deux
 * BORNES de pierre dressées flanquent désormais chaque couloir de seuil, plantées dans la roche
 * des flancs, et leur tête PERCE la canopée (même mécanique de couronne que les lieux) : on voit
 * la porte venir de loin, on marche vers elle. *Le monde prévient, il ne guide pas* — aucune
 * règle de jeu, du décor, gratuit.
 *
 * Les bornes d'un seuil de SECOURS sont BRISÉES : le second passage est toujours pire (R11), et
 * ça se voit d'abord à ses portiques décapités.
 *
 * Données : `map.seuils` (spec t0-exploration R20) — position, axe de traversée, drapeau
 * secours. Tout est dérivé, rien n'est deviné par les noms.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@ashes/sim'
import { type Crack, cleLit, mirrorCanvas, mirrorCracks, newCanvas, normalFromCanvas, poserPaire } from '../../render/normal-map'
import { STONE_B } from '../../render/matiere'
import { crownDepth, TILE_PX, TIE_NODE, ySortDepth } from '../../render/framing'
import type { Warp } from '../../render/warp'

/** Écart latéral borne↔centre du couloir, en tuiles : la demi-largeur du couloir + 2 — les
 *  bornes se plantent contre les flancs, comme des montants de porte. Le couloir d'un SECOURS
 *  est plus étroit (demi-largeur 4, `RELIEF.DEMI_LARGEUR_SECOURS`) : ses bornes se resserrent
 *  d'autant, sinon les pierres brisées flottent à cinq tuiles du défilé qu'elles annoncent. */
const ECART_TUILES = 9
const ECART_SECOURS_TUILES = 6

const STONE = { lit: 0xb4ada1, mid: 0x8d867b, dark: 0x605a51, deep: 0x3e3a34 }
const SHADOW = 0x000000

const W = 22
const H = 74
const H_BRISEE = 46
const CROWN = 34

export const BORNE_KEY = 'seuil-borne'
export const BORNE_BRISEE_KEY = 'seuil-borne-brisee'
const crownKey = (key: string): string => `${key}-crown`

/** Peint les deux bornes (entière, brisée) et leurs couronnes. À appeler au boot. */
export function makeBorneTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()

  const pilier = (b: number, brisee: boolean): void => {
    const c = W / 2
    g.fillStyle(SHADOW, 0.26).fillEllipse(c + 1, b - 2, W * 0.9, 7) // l'ombre qui ancre
    // Le socle : deux marches grossières.
    g.fillStyle(STONE.dark).fillRect(c - 9, b - 8, 18, 7)
    g.fillStyle(STONE.mid).fillRect(c - 7, b - 12, 14, 5)
    // Le fût : un monolithe dressé, arêtes franches.
    const haut = brisee ? b - (H_BRISEE - 6) : b - (H - 12)
    g.fillStyle(STONE.mid).fillRect(c - 5, haut, 10, b - 10 - haut)
    g.fillStyle(STONE.lit).fillRect(c - 5, haut, 3, b - 10 - haut) //  la lumière au NO
    g.fillStyle(STONE.deep).fillRect(c + 2, haut + 2, 3, b - 12 - haut) // l'ombre au SE
    if (brisee) {
      // LA CASSURE : un chicot en biais — le portique décapité du second passage.
      // (Apex à haut−5 : haut vaut 6 sur la texture brisée, un −7 sortait du canvas d'un pixel.)
      g.fillStyle(STONE.mid).fillTriangle(c - 5, haut, c + 5, haut, c - 2, haut - 5)
      g.fillStyle(STONE.dark).fillRect(c + 4, b - 14, 7, 5) // le tronçon tombé au pied
    } else {
      // LE CHAPEAU : une dalle posée en tête — la silhouette qui se lit à contre-jour.
      g.fillStyle(STONE.dark).fillRect(c - 8, haut - 6, 16, 7)
      g.fillStyle(STONE.lit).fillRect(c - 8, haut - 6, 16, 2)
    }
  }

  g.clear()
  pilier(H, false)
  g.generateTexture(BORNE_KEY, W, H)
  g.generateTexture(crownKey(BORNE_KEY), W, CROWN) // la tête, redessinée au-dessus des houppiers
  g.clear()
  pilier(H_BRISEE, true)
  g.generateTexture(BORNE_BRISEE_KEY, W, H_BRISEE)
  g.destroy()

  // ═══ LES VARIANTES `_lit` (spec da-feeling R5) — albédo APLATI + normale dérivée ═══
  //
  // Même silhouette que la version peinte (deux backends, une forme), l'ombrage NO retiré :
  // socle et fût en tons-MATIÈRE plats, le relief viendra de la lumière. Un monolithe est une
  // grosse masse dressée : cellules de 3 px, base PLANTÉE (le bord bas ne plonge pas), un
  // sillon de fissure au fût — la grammaire du pilote erratique.
  const albedo = (b: number, brisee: boolean): HTMLCanvasElement => {
    const { c: cv, ctx } = newCanvas(W, brisee ? H_BRISEE : H)
    const c = W / 2
    ctx.fillStyle = '#6a645a' // le socle : une pierre plus sombre, posée
    ctx.fillRect(c - 9, b - 8, 18, 7)
    ctx.fillRect(c - 7, b - 12, 14, 5)
    const haut = brisee ? b - (H_BRISEE - 6) : b - (H - 12)
    ctx.fillStyle = '#8d867b' // le fût : LA matière, aplat — la lumière fera les faces
    ctx.fillRect(c - 5, haut, 10, b - 10 - haut)
    if (brisee) {
      ctx.beginPath()
      ctx.moveTo(c - 5, haut); ctx.lineTo(c + 5, haut); ctx.lineTo(c - 2, haut - 5); ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#6a645a'
      ctx.fillRect(c + 4, b - 14, 7, 5) // le tronçon tombé
    } else {
      ctx.fillStyle = STONE_B // le chapeau : une dalle, un ton sous le fût (matière nommée)
      ctx.fillRect(c - 8, haut - 6, 16, 7)
    }
    // L'ombre de contact, PEINTE APRÈS la normale ? Non : ici l'albédo sert AUSSI à dériver la
    // normale — l'ombre s'ajoute donc sur un CLONE après dérivation (voir plus bas).
    return cv
  }
  const ombre = (src: HTMLCanvasElement, b: number): HTMLCanvasElement => {
    const { c: cv, ctx } = newCanvas(src.width, src.height)
    ctx.drawImage(src, 0, 0)
    ctx.fillStyle = 'rgba(0,0,0,0.26)'
    ctx.beginPath()
    ctx.ellipse(W / 2 + 1, b - 2, W * 0.45, 3.5, 0, 0, Math.PI * 2)
    ctx.fill()
    return cv
  }
  const fissure: Crack[] = [{ path: [[W / 2 + 3, H - 10], [W / 2 + 2, H - 30], [W / 2 + 3, H - 46]], crevasse: true }]
  // UNE BORNE EST DRESSÉE — c'est un menhir de seuil. Elle a donc son retourné (2026-08-27),
  // fissure comprise : `mirrorCracks` la fait passer de droite à gauche, faute de quoi le
  // sillon serait gravé du côté opposé à celui que l'albédo montre.
  const entA = albedo(H, false)
  const entN = normalFromCanvas(entA, 1, 3.5, 3, true, fissure)
  const entNM = normalFromCanvas(mirrorCanvas(entA), 1, 3.5, 3, true, mirrorCracks(fissure, entA.width))
  poserPaire(scene, (m) => cleLit(BORNE_KEY, m), ombre(entA, H), entN, entNM)
  // La couronne : la DÉCOUPE HAUTE des mêmes canvas — identiques au pixel là où ils se recouvrent.
  // Elle suit le miroir de son corps (la découpe commute avec le retournement).
  const crop = (src: HTMLCanvasElement, hh: number): HTMLCanvasElement => {
    const { c: cv, ctx } = newCanvas(src.width, hh)
    ctx.drawImage(src, 0, 0)
    return cv
  }
  poserPaire(scene, (m) => cleLit(crownKey(BORNE_KEY), m),
    crop(entA, CROWN), crop(entN, CROWN), crop(entNM, CROWN))
  const briA = albedo(H_BRISEE, true)
  poserPaire(scene, (m) => cleLit(BORNE_BRISEE_KEY, m), ombre(briA, H_BRISEE),
    normalFromCanvas(briA, 1, 3.5, 3, true),
    normalFromCanvas(mirrorCanvas(briA), 1, 3.5, 3, true))
}

export class BorneLayer {
  private readonly sprites: { img: Phaser.GameObjects.Image; base: string; mir: boolean }[] = []

  constructor(scene: Phaser.Scene, map: WorldMap, warp: Warp) {
    for (const s of map.seuils ?? []) {
      // La perpendiculaire à l'axe de traversée : les deux flancs du couloir.
      const perpX = -s.ay
      const perpY = s.ax
      const ecart = s.secours ? ECART_SECOURS_TUILES : ECART_TUILES
      for (const cote of [-1, 1] as const) {
        const tx = s.x + perpX * ecart * cote + 0.5
        const ty = s.y + perpY * ecart * cote + 1
        const px = tx * TILE_PX
        const py = ty * TILE_PX - warp.lift(tx, ty)
        const key = s.secours ? BORNE_BRISEE_KEY : BORNE_KEY
        // Nominal : la variante _lit (albédo aplati + normale) — le toggle debug rebascule.
        // LES DEUX FLANCS D'UN SEUIL NE SONT PLUS JUMEAUX : celui de droite porte le retourné.
        // Le bit vient du CÔTÉ, pas d'un hash — deux bornes qui se font face doivent se
        // répondre, pas tirer au sort chacune de son côté.
        const mir = cote === 1
        const body = scene.add.image(px, py, cleLit(key, mir)).setOrigin(0.5, 1)
        body.setLighting(true)
        body.setDepth(ySortDepth(ty, TILE_PX, TIE_NODE))
        this.sprites.push({ img: body, base: key, mir })
        if (!s.secours) {
          // La tête perce la canopée — même superposition au pixel près que les lieux.
          const crown = scene.add.image(px, py - H, cleLit(crownKey(BORNE_KEY), mir)).setOrigin(0.5, 0)
          crown.setLighting(true)
          crown.setDepth(crownDepth(ty, TILE_PX))
          this.sprites.push({ img: crown, base: crownKey(BORNE_KEY), mir })
        }
      }
    }
  }

  /** Le toggle debug : _lit + LightsManager, ou la version peinte d'avant — comme les lieux. */
  setLighting(lit: boolean): void {
    for (const e of this.sprites) {
      // Le retourné se REPOSE au rebasculement : sans son bit, le toggle debug remettait
      // toutes les bornes droites, et l'A/B aurait comparé deux rendus différents.
      e.img.setTexture(lit ? cleLit(e.base, e.mir) : e.base)
      e.img.setLighting(lit)
    }
  }

  destroy(): void {
    for (const e of this.sprites) e.img.destroy()
    this.sprites.length = 0
  }
}
