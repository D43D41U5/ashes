/**
 * LE CARRÉ DU FEU SE VOIT — la frontière de construction, marteau en main
 * (demande d'Alexis, 2026-08-04 ; spec construction R2).
 *
 * Le domaine d'un village est un CARRÉ : `chebyshev(tuile, Feu) ≤ R`, R grandissant
 * avec le palier (10 → 13 → 16). Rien à l'écran ne le disait. Trois couches le disent
 * maintenant, et elles répondent à deux questions différentes :
 *
 *   • **A — LE LISERÉ** (`trait`) : le trait exact, au bord extérieur de la dernière tuile
 *     légale, plus une bande tiède vers l'intérieur. Il répond « ça s'arrête ICI ».
 *     Il porte un SECOND trait, effacé, sur le carré RÉSERVÉ (R_max) : la place est
 *     retenue dès la fondation (R1), monter le Feu ne fait que l'ouvrir. Le trait faible
 *     dit « le carré ira jusque-là » — pas « tout y sera constructible ».
 *   • **B — LE TAPIS** (`tapis`) : chaque tuile du domaine, teintée selon que la pièce
 *     ARMÉE y passerait. Il répond « OÙ, exactement ». Il n'existe qu'armé : sans pièce
 *     en main la question n'a pas de sens, le verdict dépend de la pièce (voir
 *     `tuilePosable`).
 *   • **C — LE DEHORS** (`dehors`) : tout ce qui est hors du carré s'assombrit et se
 *     refroidit. Il répond « de quel CÔTÉ je suis » — et c'est le seul qui réponde encore
 *     quand aucun bord n'est à l'écran, ce qui est le cas courant : le cadre montre 20
 *     tuiles de haut (`VISIBLE_TILES_TALL`) quand le carré en fait 21 dès le palier 1.
 *
 * ═══ LE DEHORS MULTIPLIE, IL NE SE MÊLE PAS ═══
 *
 * Même raisonnement que le voile de nuit (`night-veil.ts`) : un voile en blend NORMAL
 * porte un terme additif qui est un PLANCHER — il ne l'assombrit pas, il le DÉLAVE, et
 * il écrase le contraste de tout ce qu'il couvre. En `MULTIPLY`, un noir reste noir et
 * le RAPPORT entre deux teintes est conservé : le dehors s'éteint sans qu'on y perde la
 * lecture d'une bête ou d'un tronc. La teinte est légèrement froide — le dehors n'est
 * pas tenu par le Feu.
 *
 * ═══ CE QUE CETTE COUCHE NE DÉCIDE PAS ═══
 *
 * Rien. La sim revalide toute pose (`evaluateBuild`, invariant §3). Un tapis vert n'est
 * pas une promesse : c'est « rien ici ne l'interdit *de ce que le client peut voir* »,
 * à la granularité de LA TUILE — le fantôme, lui, garde le dernier mot sur l'ARÊTE.
 */
// PHASER EN TYPE SEUL — le module porte trois fonctions PURES (`bornesDuCarre`,
// `rayonReserve`, `tuilePosable`) que le test headless interroge : un `import Phaser`
// de valeur ferait entrer tout le moteur (et son `window`) dans vitest. D'où aussi le
// blend mode donné par son NOM, comme `fire-ground-glow`.
import type Phaser from 'phaser'
import {
  BALANCE,
  chebyshev,
  fireRadius,
  nodeAt,
  noeudDefriche,
  piece,
  terrainAt,
  terrainConstructible,
  zoneAt,
  type ResourceNode,
  type StructureType,
  type Village,
  type WorldMap,
} from '@ashes/sim'
import { FLOOR_DEPTH, CANOPY_DEPTH, TILE_PX } from '../../render/framing'
import { BAD_TINT, OK_TINT } from './build-ghost'
import { COL } from '../ui/palette'
import type { Placeable } from '../../hud-state'

/**
 * LES PROFONDEURS. Le tapis et le liseré sont des marques AU SOL : au-dessus du fond
 * (sol, eau, falaise, sol bâti — tous ≤ `FLOOR_DEPTH`) et sous TOUT ce qui a des pieds
 * (la bande de tri commence à 1000). Ils passent aussi au-dessus du voile d'ambiance
 * éclairé (`AMBIENT_DEPTH_LIT = 8`), et c'est voulu : une affordance de construction
 * ne doit pas s'éteindre à la tombée de la nuit, justement quand on ne voit plus rien.
 */
const TAPIS_DEPTH = FLOOR_DEPTH + 3
const TRAIT_DEPTH = FLOOR_DEPTH + 4
/** Le dehors, lui, COIFFE le monde : il doit éteindre les arbres et les bêtes, pas
 *  seulement le sol. Au-dessus de la canopée, sous les oiseaux et le voile de nuit. */
const DEHORS_DEPTH = CANOPY_DEPTH + 20_000

/** Le multiplicateur du dehors : ~35 % plus sombre, et un cheveu plus froid. */
const DEHORS_MUL = 0xa6adba

/** Le liseré : un tiret par tuile, calé sur la grille de l'art — jamais un pointillé
 *  qui glisse. 10 px de trait sur les 16 de la tuile, centré. */
const TIRET = 10
const TIRET_MARGE = (TILE_PX - TIRET) / 2
const EPAISSEUR = 1

/** La bande tiède, vers l'INTÉRIEUR : trois marches de 2 px, quantifiées (jamais un dégradé). */
const BANDE = [0.15, 0.09, 0.05] as const
const BANDE_PAS = 2

const TAPIS_OK_ALPHA = 0.11
const TAPIS_NON_ALPHA = 0.2
const GRILLE_ALPHA = 0.07
const RESERVE_ALPHA = 0.3

/** Clé de tuile pour les index (mêmes bornes que l'index de nœuds de /sim). */
const STRIDE = 1_000_000
const cle = (tx: number, ty: number): number => tx * STRIDE + ty

/** Les bornes du carré d'un village à SON palier, tuiles incluses. */
export function bornesDuCarre(v: Village): { x0: number; y0: number; x1: number; y1: number } {
  const r = fireRadius(v.tier)
  return { x0: v.fireTx - r, y0: v.fireTy - r, x1: v.fireTx + r, y1: v.fireTy + r }
}

/** Le rayon MAXIMAL — celui que la fondation RÉSERVE (spec construction R1-R2). */
export function rayonReserve(): number {
  const paliers = BALANCE.FIRE_RADIUS_BY_TIER
  return paliers[paliers.length - 1] ?? 0
}

/**
 * LA PIÈCE VIT-ELLE SUR UNE ARÊTE ? — LU AU REGISTRE (`piece().arete`), pas écrit ici.
 * Un mur, une porte, une palissade courent sur le trait : ils ne prennent pas la tuile,
 * donc ni un nœud, ni un corps, ni une structure ne s'oppose à eux À LA TUILE. Une
 * liste écrite à la main aurait oublié la palissade — elle est née après R23.
 */
function surArete(placing: Placeable): boolean {
  return piece(placing as StructureType).arete !== 'interdite'
}

/**
 * LE VERDICT D'UNE TUILE, à la granularité du TAPIS (spec construction R4/R5/R23).
 *
 * `occupee` est fourni par l'appelant (structure pleine-tuile, nœud ou corps), INDEXÉ :
 * le tapis interroge jusqu'à 33×33 tuiles, et `fullTileAt` balaie tout le tableau des
 * structures. Le pré-index rend la question O(1) sans changer sa réponse.
 *
 * DEUX RÈGLES SE LISENT ICI, et elles ne sont pas symétriques :
 *   • le TERRAIN juge PAR PIÈCE (`terrainConstructible`) — le gué porte des planches,
 *     pas un mur ; c'est pourquoi le tapis change quand on change de pièce armée ;
 *   • le LANDMARK (`zoneAt`) ne refuse QUE le feu de camp. La sim ne le teste que dans
 *     `place_campfire`/`light_fire` (village.ts) : un mur dans un toponyme passe.
 *
 * L'ARÊTE, elle, ne se juge pas ici : une tuile qui porte déjà un mur au nord peut en
 * recevoir trois autres. C'est le fantôme qui tranche l'arête visée, à la frame.
 */
export function tuilePosable(
  map: WorldMap,
  placing: Placeable,
  tx: number,
  ty: number,
  occupee: boolean,
): boolean {
  if (placing === 'fire' && zoneAt(map, tx + 0.5, ty + 0.5) !== undefined) return false
  if (!terrainConstructible(terrainAt(map, tx, ty), placing as StructureType)) return false
  if (surArete(placing)) return true
  return !occupee
}

/** Ce que la couche a besoin de savoir du monde, à cette frame. */
export interface EtatCarre {
  /** Le marteau est-il en main ? Rangé, les trois couches s'éteignent (spec construction R21). */
  marteau: boolean
  /** MON village — jamais celui du voisin : on ne bâtit pas chez lui. */
  village: Village | undefined
  /** La pièce armée, ou `null` (le tapis n'existe qu'armé). */
  placing: Placeable | null
  map: WorldMap
  /** Les structures du snapshot, TELLES QUELLES : la couche fait le tri (`piece().occupe`)
   *  pendant qu'elle indexe. Les filtrer chez l'appelant allouait un tableau par frame. */
  structures: readonly { tx: number; ty: number; type: string; edges?: number }[]
  nodes: ResourceNode[]
  /** Les corps vivants (acteurs) : leur tuile interdit une pose pleine-tuile. */
  corps: readonly { x: number; y: number; hp: number }[]
  camera: Phaser.Cameras.Scene2D.Camera
}

export class CarreVillage {
  private readonly tapis: Phaser.GameObjects.Graphics
  private readonly trait: Phaser.GameObjects.Graphics
  private readonly dehors: Phaser.GameObjects.Graphics
  /** Empreinte du dernier tapis peint : il ne se redessine que si sa réponse a changé.
   *  Un NOMBRE, pas une chaîne — l'empreinte se recalcule à chaque frame, et concaténer
   *  jusqu'à un millier de clés de tuile allouerait une chaîne par frame pour rien. */
  private sigTapis = -1
  /** …et le liseré, qui ne bouge qu'au changement de village ou de palier. */
  private sigTrait = ''
  /** L'index d'occupation, RÉUTILISÉ d'une frame à l'autre (vidé, jamais réalloué). */
  private readonly prises = new Set<number>()
  /** Le verdict d'occupation relevé au balayage, gardé pour la passe de peinture :
   *  sans lui, le carré serait balayé deux fois (une pour l'empreinte, une pour peindre).
   *  Redimensionné au seul changement de palier. */
  private occupees = new Uint8Array(0)

  constructor(scene: Phaser.Scene) {
    this.tapis = scene.add.graphics().setDepth(TAPIS_DEPTH).setVisible(false)
    this.trait = scene.add.graphics().setDepth(TRAIT_DEPTH).setVisible(false)
    this.dehors = scene.add.graphics().setDepth(DEHORS_DEPTH).setVisible(false)
    this.dehors.setBlendMode('MULTIPLY')
  }

  update(e: EtatCarre): void {
    // Pas de marteau, ou pas de village : il n'y a pas de domaine à montrer. Le monde
    // reste au clair — la lecture est juste, « aucun Feu ne tient ce sol ».
    if (!e.marteau || e.village === undefined) {
      this.tapis.setVisible(false)
      this.trait.setVisible(false)
      this.dehors.setVisible(false)
      this.sigTapis = -1
      this.sigTrait = ''
      return
    }
    const v = e.village
    const b = bornesDuCarre(v)
    this.peindreTrait(v, b)
    this.peindreDehors(b, e.camera)
    this.peindreTapis(e, v, b)
  }

  /** A — le liseré, plus le trait effacé du carré réservé. Statique par palier. */
  private peindreTrait(v: Village, b: { x0: number; y0: number; x1: number; y1: number }): void {
    const sig = `${v.id}|${v.tier}|${v.fireTx},${v.fireTy}`
    this.trait.setVisible(true)
    if (sig === this.sigTrait) return
    this.sigTrait = sig
    const g = this.trait
    g.clear()

    const x = b.x0 * TILE_PX
    const y = b.y0 * TILE_PX
    const w = (b.x1 - b.x0 + 1) * TILE_PX
    const h = (b.y1 - b.y0 + 1) * TILE_PX

    // La bande tiède, vers l'intérieur : des CADRES qui ne se chevauchent pas aux angles
    // (sans quoi les quatre coins doubleraient leur alpha et feraient quatre taches).
    BANDE.forEach((alpha, i) => {
      const inset = EPAISSEUR + i * BANDE_PAS
      g.fillStyle(COL.emberBright, alpha)
      cadre(g, x + inset, y + inset, w - inset * 2, h - inset * 2, BANDE_PAS)
    })

    // Le trait : un tiret par tuile, sur les quatre côtés.
    g.fillStyle(COL.emberBright, 0.85)
    for (let tx = b.x0; tx <= b.x1; tx++) {
      const px = tx * TILE_PX + TIRET_MARGE
      g.fillRect(px, y, TIRET, EPAISSEUR)
      g.fillRect(px, y + h - EPAISSEUR, TIRET, EPAISSEUR)
    }
    for (let ty = b.y0; ty <= b.y1; ty++) {
      const py = ty * TILE_PX + TIRET_MARGE
      g.fillRect(x, py, EPAISSEUR, TIRET)
      g.fillRect(x + w - EPAISSEUR, py, EPAISSEUR, TIRET)
    }

    // LE CARRÉ RÉSERVÉ (R1) : ce que les paliers ouvriront, en trait effacé et espacé —
    // une tuile sur deux, pour qu'aucune confusion ne soit possible avec la vraie limite.
    const rMax = rayonReserve()
    if (fireRadius(v.tier) >= rMax) return
    const rx = (v.fireTx - rMax) * TILE_PX
    const ry = (v.fireTy - rMax) * TILE_PX
    const rw = (2 * rMax + 1) * TILE_PX
    g.fillStyle(COL.emberBright, RESERVE_ALPHA)
    for (let tx = v.fireTx - rMax; tx <= v.fireTx + rMax; tx += 2) {
      const px = tx * TILE_PX + TIRET_MARGE
      g.fillRect(px, ry, TIRET, EPAISSEUR)
      g.fillRect(px, ry + rw - EPAISSEUR, TIRET, EPAISSEUR)
    }
    for (let ty = v.fireTy - rMax; ty <= v.fireTy + rMax; ty += 2) {
      const py = ty * TILE_PX + TIRET_MARGE
      g.fillRect(rx, py, EPAISSEUR, TIRET)
      g.fillRect(rx + rw - EPAISSEUR, py, EPAISSEUR, TIRET)
    }
  }

  /**
   * C — le dehors s'éteint. Quatre rectangles, bornés au CADRE de la caméra : le monde
   * fait 3 600 tuiles de côté, peindre « tout sauf le carré » à l'échelle du monde serait
   * un quad de 57 600 px pour un écran qui en montre 320. Redessiné à chaque frame — la
   * caméra glisse en continu, et quatre `fillRect` ne coûtent rien.
   */
  private peindreDehors(
    b: { x0: number; y0: number; x1: number; y1: number },
    cam: Phaser.Cameras.Scene2D.Camera,
  ): void {
    const g = this.dehors
    g.setVisible(true)
    g.clear()
    g.fillStyle(DEHORS_MUL, 1)
    const vue = cam.worldView
    const gauche = vue.x
    const droite = vue.x + vue.width
    const haut = vue.y
    const bas = vue.y + vue.height
    const cx0 = b.x0 * TILE_PX
    const cy0 = b.y0 * TILE_PX
    const cx1 = (b.x1 + 1) * TILE_PX
    const cy1 = (b.y1 + 1) * TILE_PX

    if (haut < cy0) g.fillRect(gauche, haut, vue.width, Math.min(cy0, bas) - haut)
    if (bas > cy1) g.fillRect(gauche, Math.max(cy1, haut), vue.width, bas - Math.max(cy1, haut))
    // Les flancs ne couvrent QUE la tranche déjà épargnée par le haut et le bas : sans
    // ça, les quatre coins seraient peints deux fois — invisible en NORMAL, doublement
    // sombre en MULTIPLY.
    const yA = Math.max(haut, cy0)
    const yB = Math.min(bas, cy1)
    if (yB > yA) {
      if (gauche < cx0) g.fillRect(gauche, yA, Math.min(cx0, droite) - gauche, yB - yA)
      if (droite > cx1) g.fillRect(Math.max(cx1, gauche), yA, droite - Math.max(cx1, gauche), yB - yA)
    }
  }

  /** B — le tapis : une tuile, une réponse, pour LA PIÈCE ARMÉE. */
  private peindreTapis(
    e: EtatCarre,
    v: Village,
    b: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const placing = e.placing
    if (placing === null) {
      this.tapis.setVisible(false)
      this.sigTapis = -1
      return
    }
    this.tapis.setVisible(true)

    // ═══ L'INDEX D'OCCUPATION, PUIS L'EMPREINTE — deux passes, et il en faut deux ═══
    //
    // ① Le bâti pleine-tuile et les corps vivants s'indexent, bornés au carré : c'est ce
    //    qui rend le verdict O(1) par tuile (sans quoi `fullTileAt` balaierait tout le
    //    tableau des structures 1 089 fois). Coût : O(structures + acteurs).
    //
    // ② L'EMPREINTE se relève ensuite EN BALAYANT LE CARRÉ, tuile par tuile, `nodeAt`
    //    compris. Un compte (`nodes.length`) n'aurait rien gardé : /sim l'écrit noir sur
    //    blanc (`economy.ts`) — le NOMBRE de nœuds ne bouge jamais, mais un nœud de bois
    //    ou de plante **se DÉPLACE** à l'épuisement. Or « récolter = défricher » (R5) est
    //    exactement le geste qu'on fait pour libérer une tuile où bâtir : une empreinte
    //    aveugle au déménagement aurait laissé le tapis rouge sur la tuile qu'on vient
    //    de dégager, au moment précis où on la regarde.
    //    Le prix est 1 089 lectures de Map par frame ; ce qu'on protège est l'envoi de
    //    1 089 rectangles à la carte graphique.
    //
    // L'empreinte est COMMUTATIVE (une somme de produits) : l'ordre du snapshot n'a pas
    // à être stable pour que la garde tienne.
    const r = fireRadius(v.tier)
    const prises = this.prises
    prises.clear()
    for (const s of e.structures) {
      if (s.edges !== undefined) continue // une barrière d'arête ne prend pas la tuile
      if (piece(s.type as StructureType).occupe !== 'tuile') continue // sol et toit sont MOUS
      if (chebyshev(v.fireTx, v.fireTy, s.tx, s.ty) > r) continue
      prises.add(cle(s.tx, s.ty))
    }
    for (const c of e.corps) {
      if (c.hp <= 0) continue
      const tx = Math.floor(c.x)
      const ty = Math.floor(c.y)
      if (chebyshev(v.fireTx, v.fireTy, tx, ty) > r) continue
      prises.add(cle(tx, ty))
    }

    // Tout ce qu'on balaie est DANS le carré de `v` : son seul foyer suffit à juger du
    // défrichement, inutile de traîner la liste entière des villages jusqu'ici.
    const emprise = [v]
    const cote = b.x1 - b.x0 + 1
    if (this.occupees.length !== cote * cote) this.occupees = new Uint8Array(cote * cote)
    const occupees = this.occupees
    let sig = ((v.id * 31 + v.tier) * 131 + hachageTexte(placing)) | 0
    for (let ty = b.y0; ty <= b.y1; ty++) {
      for (let tx = b.x0; tx <= b.x1; tx++) {
        const k = cle(tx, ty)
        // Un nœud DÉFRICHÉ n'occupe plus rien : c'est une souche, et la sim l'a déjà
        // libérée (`poseLibre`). Le tapis doit dire la même chose, sinon on montre rouge
        // ce que le marteau accepte — juste sur la tuile qu'on vient de dégager.
        const noeud = nodeAt(e.nodes, tx, ty)
        const occupee = prises.has(k) || (noeud !== undefined && !noeudDefriche(emprise, noeud))
        occupees[(ty - b.y0) * cote + (tx - b.x0)] = occupee ? 1 : 0
        if (occupee) sig = (sig + Math.imul(k, 2654435761)) | 0
      }
    }
    if (sig === this.sigTapis) return
    this.sigTapis = sig

    const g = this.tapis
    g.clear()
    for (let ty = b.y0; ty <= b.y1; ty++) {
      for (let tx = b.x0; tx <= b.x1; tx++) {
        const occupee = occupees[(ty - b.y0) * cote + (tx - b.x0)] === 1
        const ok = tuilePosable(e.map, placing, tx, ty, occupee)
        g.fillStyle(ok ? OK_TINT : BAD_TINT, ok ? TAPIS_OK_ALPHA : TAPIS_NON_ALPHA)
        g.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX)
      }
    }
    // La grille : c'est elle qui rend le tapis COMPTABLE — on mesure une pièce à l'œil
    // avant de la bâtir. Des lignes traversantes, pas un contour par tuile (34 traits
    // au lieu de 2 178).
    g.fillStyle(COL.body, GRILLE_ALPHA)
    const h = (b.y1 - b.y0 + 1) * TILE_PX
    const w = (b.x1 - b.x0 + 1) * TILE_PX
    for (let tx = b.x0; tx <= b.x1 + 1; tx++) g.fillRect(tx * TILE_PX, b.y0 * TILE_PX, EPAISSEUR, h)
    for (let ty = b.y0; ty <= b.y1 + 1; ty++) g.fillRect(b.x0 * TILE_PX, ty * TILE_PX, w, EPAISSEUR)
  }

  destroy(): void {
    this.tapis.destroy()
    this.trait.destroy()
    this.dehors.destroy()
  }
}

/** Un hachage d'identifiant de pièce — le tapis change avec la pièce armée, et une
 *  comparaison d'entiers ne sait pas comparer deux chaînes. */
function hachageTexte(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

/** Un CADRE d'épaisseur `ep` vers l'intérieur, en quatre rectangles qui ne se recouvrent pas. */
function cadre(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, ep: number): void {
  if (w <= 2 * ep || h <= 2 * ep) return
  g.fillRect(x, y, w, ep)
  g.fillRect(x, y + h - ep, w, ep)
  g.fillRect(x, y + ep, ep, h - 2 * ep)
  g.fillRect(x + w - ep, y + ep, ep, h - 2 * ep)
}
