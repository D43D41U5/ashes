/**
 * LA COUCHE DES PAVÉS — le sol cuit à 16 px/tuile, par CHUNKS autour de la caméra
 * (spec `sol-dessine.md` R8, R11, R12).
 *
 * Le bake plein-carte reste à 1 px/tuile (`map-demo`) : il sert de LIT à l'eau et de source à
 * la minicarte. Par-dessus, cette couche pose des images de `PAVE.CHUNK × 16` px cuites à la
 * demande (`render/paves.ts`, pur) : la vue en tient une poignée, on en garde une couronne
 * autour, on rend les autres. Le bake plein-carte à cette résolution ferait 2,5 M × 256 px —
 * impossible en une texture, et inutile : on ne regarde qu'un écran à la fois.
 *
 * LA CUISSON SE MESURE (R12) : `derniereCuissonMs` et `chunksVivants()` sont la surface de
 * lecture du smoke. Budget : ce qui est DANS L'ÉCRAN se cuit TOUJOURS, tout de suite — un trou
 * à l'écran (le bake plat qui affleure en carré) est pire qu'un à-coup de quelques ms, et
 * Alexis l'a vu le 2026-08-22 (« je vois des carrés comme des chunks quand je bouge la
 * caméra ») quand la première écriture bornait AUSSI le visible à un chunk par frame : un
 * saut de caméra laissait l'écran troué trente frames. Seule la COURONNE se cuit au
 * compte-gouttes (`CUISSONS_COURONNE_PAR_FRAME`), en avance sur le déplacement.
 *
 * NEAREST, comme tout l'art : la caméra agrandit 2,25× ; un pixel cuit est un pixel à l'écran.
 * AUCUNE logique de jeu ici — rendu pur d'état reçu.
 */
import Phaser from 'phaser'
import { ancienneteDeCendre, auCoeurDeLaCendre, avanceesDepuisAges, terrainCendre, type WorldMap } from '@ashes/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { GRAIN_CELLS, familleDe, grainFacteur, type Famille } from '../../render/grain-sol'
import { PAVE, PAVE_COTE, PAVE_PX, cuireChunk, soleilDuPavement } from '../../render/paves'
import { sunDirection, type HeureSolaire } from '../../render/lighting'
import { cendreARemue, signatureCendre, type SignatureCendre } from '../../render/cendre-chunk'
import { cranDeSaison, teinteDuTerrain, teinter } from '../../render/teinte-saison'
import { TERRAIN_COLORS } from '../../render/terrain-colors'
import { contexteDesButtes, densiteDeMoucheture, type ButteContexte } from '../../render/buttes'

/**
 * LA CENDRE FRAÎCHE EST CHAUDE, LA VIEILLE EST FROIDE (spec `cendre.md`). Sans ce dégradé, la
 * frange ne se lisait pas : on ne savait ni d'où la cendre venait, ni quand elle était passée.
 */
const JEUNE = 0x6f5a44 // la cendre du mois : encore le brun du feu
const TIRAGE_VIEUX = 0.55 // de combien on tire vers la teinte de famille quand elle a refroidi
const REFROIDIT_JOURS = 30 // une saison : le temps qu'on la VOIE changer

/** Sous le bake ? Non : AU-DESSUS du bake (−1), SOUS l'eau (+0,25) et tout ce qui vit dessus. */
const PAVE_DEPTH = GROUND_MAP_DEPTH + 0.05
/** LE SURPLOMB de la berge (frange de terre, ombre, ressac sur l'eau) : AU-DESSUS du shader
 *  d'eau (+0,25), des ombres de poissons (+0,27), des reflets (+0,28) et de la GLACE (+0,285 :
 *  la berge garde son bord sur le lac gelé) — une berge cache ce qui passe dessous — mais SOUS
 *  la neige (+0,30), la falaise et les feuilles qui dérivent (+0,32). */
export const SURPLOMB_DEPTH = GROUND_MAP_DEPTH + 0.29

/** Combien de chunks de COURONNE (hors écran) se cuisent par frame. Le visible n'est pas borné. */
const CUISSONS_COURONNE_PAR_FRAME = 2
/**
 * Combien de chunks PÉRIMÉS PAR LA CENDRE se recuisent par frame — le visible d'abord.
 *
 * ⚠ CEUX-LÀ SE BUDGÈTENT, ET LE VISIBLE AUSSI. Un chunk qui manque à l'écran est un TROU : il se
 * cuit tout de suite, sans budget. Un chunk périmé, lui, montre encore l'image d'hier — la cendre
 * y a un jour de retard, ce que personne ne peut voir. MESURÉ sur seed 2026, un joueur planté
 * devant le front : **28 chunks d'un coup** au pire jour de saison (~8 ms pièce = 220 ms, une
 * saccade franche). Étalés à deux par image, les 28 passent en 14 images — un quart de seconde,
 * invisible, contre une frame perdue.
 */
const RECUISSONS_CENDRE_PAR_FRAME = 2
/** La couronne gardée autour de la vue, en chunks : cuite en avance, pour que le visible n'ait
 *  en général rien à cuire quand on marche. */
const COURONNE = 1
/** LA MARGE DU VISIBLE, en px monde : `update()` lit la vue de la frame PRÉCÉDENTE (la caméra
 *  ne suit le joueur qu'au rendu, après `update`). Ce qui est à moins d'une demi-tuile-de-chunk
 *  du bord compte donc comme visible et se cuit tout de suite — sinon une bande d'un pixel de
 *  bake plat peut affleurer une frame au bord qui avance. */
const MARGE_VISIBLE_PX = (PAVE.CHUNK * PAVE_PX) / 2
/** Un chunk non vu depuis tant de frames se rend. Long : revenir sur ses pas ne doit pas recuire
 *  (2 s à 60 fps) ; le plafond `MAX_VIVANTS` borne la mémoire quoi qu'il arrive. */
const OUBLI_FRAMES = 120
/** Plafond de chunks vivants : au-delà, les plus anciens se rendent, même vus récemment.
 *  258² × 4 o = **266 Ko** par image depuis le débord (`PAVE.BAVE`, 2026-08-23) → ~25 Mo, et
 *  jusqu'au double sur une côte, où chaque chunk porte AUSSI son surplomb. */
const MAX_VIVANTS = 96

/**
 * Verse un tampon RGBA carré dans une CanvasTexture NEAREST et pose son image — partagé avec le
 * manteau (`gel-layer.ts`), qui cuit à la même maille.
 *
 * `x, y` sont ceux du PREMIER PIXEL DU TAMPON, débord compris (`PAVE.BAVE`) : l'appelant décale
 * de `−BAVE` le coin du chunk. Le côté se DÉDUIT du tampon (√(n/4)) plutôt que d'être supposé :
 * une couche qui cuirait à une autre taille resterait juste, et le jour où le débord change,
 * rien ici ne ment.
 */
/**
 * LES CRANS DU SOLEIL — combien de positions distinctes la lèvre du pavement connaît, de l'est
 * (+1) à l'ouest (−1). Huit de chaque côté : la lèvre change de côté d'à peu près un pixel d'un
 * cran au suivant, ce qui est la définition d'« assez fin » ici, et ça borne la recuisson à
 * dix-sept vagues par jour au grand maximum — sur les seuls chunks à relief.
 */
const CRANS_SOLEIL = 8

export function poserChunk(
  scene: Phaser.Scene, cle: string, rgba: Uint8ClampedArray, x: number, y: number, depth: number,
): Phaser.GameObjects.Image | null {
  const S = Math.round(Math.sqrt(rgba.length / 4))
  // Une clé déjà prise (une scène rechargée à chaud sans passer par `destroy`) ne doit PAS
  // laisser un trou permanent recuit à chaque frame : on la rend, puis on recrée.
  if (scene.textures.exists(cle)) scene.textures.remove(cle)
  const tex = scene.textures.createCanvas(cle, S, S)
  if (!tex) return null
  const ctx = tex.getContext()
  const img = ctx.createImageData(S, S)
  img.data.set(rgba)
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
  return scene.add.image(x, y, cle).setOrigin(0, 0).setDepth(depth)
}

interface Chunk {
  image: Phaser.GameObjects.Image
  cle: string
  /** Le surplomb de berge, s'il y a de l'eau dans le chunk. */
  surplomb?: { image: Phaser.GameObjects.Image; cle: string }
  /** Dernière frame où le chunk était dans la vue ou sa couronne. */
  vu: number
  /** Ce chunk porte du pavement de lapiaz : lui seul se périme quand le soleil tourne. */
  relief: boolean
  /** L'image de ce chunk a pris du retard : elle se recuira au budget
   *  (`RECUISSONS_CENDRE_PAR_FRAME`) plutôt que de laisser un trou à l'écran. La CAUSE est
   *  gardée pour que les deux sondes ne se mélangent pas — la cendre avance sur un front, la
   *  saison touche tout à la fois, et confondre les deux compteurs rendrait le smoke muet sur
   *  l'un des deux. */
  perime?: 'cendre' | 'saison' | 'soleil'
  /** CE QUE LE CHUNK SAIT DE LA CENDRE au moment où il a été cuit (`render/cendre-chunk.ts`) :
   *  par fosse, l'avancée à laquelle sa première tuile ici prend feu, et les âges d'alors. C'est
   *  ce qui décide de le jeter — un ensemble « porte de la cendre » ne pouvait pas voir venir le
   *  front, et un chunk vierge n'était jamais recuit. */
  cendre: SignatureCendre
}

export class PaveLayer {
  private chunks = new Map<number, Chunk>()
  /** Le contexte des buttes (rôle + pente par tuile) — la pente commande la densité de rouille.
   *  Vide sur une carte sans affleurement : coût nul, comme chez `clutter-layer`. */
  private buttes: Map<number, ButteContexte> = new Map()
  private frame = 0
  /** La dernière cuisson, en ms — la sonde R12. */
  derniereCuissonMs = 0
  /** Le total cuit depuis la naissance de la couche (chunks). */
  cuits = 0
  /** Les trames de grain par famille, 64×64 cellules, cuites une fois (le même calcul que
   *  l'atlas d'hier, `grain-sol.ts`) — lues par le pixel, jamais recalculées par chunk. */
  private trames = new Map<Famille, Float32Array>()

  /**
   * « Cette tuile est-elle cendrée ? » — posé par `WorldScene`, la fonction de /sim et non une
   * copie. Absent tant que la carte n'a pas de champ de cendre : rien ne change alors.
   */
  cendreIci: ((tx: number, ty: number) => boolean) | null = null
  /** Les âges des foyers du dernier snapshot — la cendre fraîche est plus chaude (voir
   *  `couleurCendre`). */
  cendreAge: readonly number[] = []
  /** Les avancées dérivées des âges — mémoïsées : le bake les demande par pixel. */
  private avancees: readonly number[] = []
  /** À appeler quand `cendreAge` change (voir `cendreABouge`). */
  private majAvancees(): void {
    this.avancees = avanceesDepuisAges(this.cendreAge, this.cendreAge.length)
  }
  /** La dernière relève de signature de cendre, en ms — la sonde (spec `sol-dessine.md` R12). */
  derniereSignatureMs = 0
  /** Combien de chunks la cendre a fait recuire depuis la naissance de la couche. */
  recuitsCendre = 0
  /**
   * ═══ LA SAISON SUR LE SOL (spec `saisons.md` S17, branchée le 2026-08-25) ═══
   *
   * S17 promettait que « la palette des terrains VIVANTS glisse sur la même courbe que la
   * température ». Elle n'était branchée que sur le DÉCOR (`clutter-layer`) : les touffes
   * roussissaient sur un sol qui restait vert, et la planche `planche-saisons` montrait depuis
   * deux jours une chose que le jeu ne faisait pas.
   *
   * Le sol qu'on VOIT est cette couche-ci (le bake 1 px/tuile ne sert plus qu'au lit de l'eau et
   * à la minicarte) : la teinte entre donc par `couleurAt`, le seul point où la couleur d'une
   * tuile se décide, et elle est CUITE dans le chunk comme le reste.
   *
   * ⚠ **CUITE VEUT DIRE PÉRIMABLE.** Un chunk garde son image jusqu'à ce qu'on la jette : sans
   * périmage, le sol porterait la couleur du jour où on est passé la première fois, pour
   * toujours. C'est exactement le problème de la cendre, résolu de la même façon et par le même
   * budget — le visible d'abord, deux par image.
   */
  jourDeLAnnee = 1
  private cranCuit: number | null = null
  /** Combien de chunks la SAISON a fait recuire — la sonde, séparée de celle de la cendre. */
  recuitsSaison = 0

  constructor(
    private scene: Phaser.Scene,
    private map: WorldMap,
    /** La couleur de sol de chaque tuile, 0xRRGGBB, telle que le bake l'a cuite. */
    private couleurs: Uint32Array,
    private seed: number,
    /** LE SECOND TON des tuiles de butte d'affleurement (bit 24 posé quand il y en a un), cuit
     *  par les mêmes passes que le premier. Les pavés le sèment à 4 px (`mouchetureIci`).
     *  Absent sur une carte sans butte : la moucheture ne coûte alors rien du tout. */
    private mouchetures?: Uint32Array,
  ) {
    if (mouchetures) this.buttes = contexteDesButtes(map)
  }

  /**
   * LA MOUCHETURE D'UNE TUILE — le second ton d'une butte et sa densité, ou `null`.
   *
   * ⚠ **LA CENDRE L'ÉTEINT** : une tuile cendrée porte la teinte de la cendre (`couleurAt`), et
   * y semer de la rouille ferait deux matières sur le même sol. La géologie est dessous, elle
   * n'est plus ce qu'on voit.
   */
  private moucheture = (tx: number, ty: number): { tache: number; densite: number } | null => {
    const m = this.mouchetures
    if (!m) return null
    const { width, height } = this.map
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return null
    const i = ty * width + tx
    const brut = m[i]!
    if (!brut || this.cendreIci?.(tx, ty)) return null
    const ctx = this.buttes.get(i)
    return {
      tache: teinter(brut & 0xffffff, teinteDuTerrain(this.map.terrain[i] ?? 0, this.jourDeLAnnee)),
      densite: densiteDeMoucheture(ctx?.grad ?? 0),
    }
  }

  /**
   * LA COULEUR D'UNE TUILE CENDRÉE — la teinte de sa famille, tirée vers le brun du feu quand la
   * cendre est FRAÎCHE (spec `cendre.md`). Elle refroidit sur `REFROIDIT_JOURS` vers le gris de la
   * poussière lessivée : le joueur lit **où le front vient de passer** rien qu'au sol, à un écran
   * de distance. Gratuit — l'ancienneté se recalcule, elle ne se range pas.
   */
  private couleurCendre(tx: number, ty: number, terrain: number): number {
    const base = TERRAIN_COLORS[terrain] ?? 0x71695a
    const jours = ancienneteDeCendre(this.map, tx, ty, this.cendreAge, this.seed)
    const froid = jours < 0 || jours > REFROIDIT_JOURS ? 1 : jours / REFROIDIT_JOURS
    const t = TIRAGE_VIEUX + (1 - TIRAGE_VIEUX) * froid
    const r = ((JEUNE >> 16) & 255) + (((base >> 16) & 255) - ((JEUNE >> 16) & 255)) * t
    const v = ((JEUNE >> 8) & 255) + (((base >> 8) & 255) - ((JEUNE >> 8) & 255)) * t
    const b = (JEUNE & 255) + ((base & 255) - (JEUNE & 255)) * t
    return (Math.round(r) << 16) | (Math.round(v) << 8) | Math.round(b)
  }

  /**
   * LA CENDRE A AVANCÉ — on PÉRIME les chunks dont l'aspect change ; `render` les recuira au
   * budget, le visible d'abord. Rend combien viennent de se périmer (la sonde du smoke).
   *
   * Appelé une fois par changement d'âge (donc au plus une fois par jour de saison, et pas du
   * tout quand tous les foyers sont gelés). On ne touche QUE les chunks concernés : un chunk se
   * recuit en 5,5 à 10,9 ms, la vue en tient une douzaine — recuire toute la carte serait
   * absurde, et ne rien recuire laisserait la cendre d'hier peinte pour toujours.
   *
   * ⚠ **« CONCERNÉ » NE VEUT PAS DIRE « QUI PORTE DÉJÀ DE LA CENDRE »**, et c'est tout le sujet :
   * un chunk cuit AVANT que le front l'atteigne n'en portait pas, n'était donc jamais jeté, donc
   * jamais recuit — la cendre s'arrêtait net sur une arête de chunk. La question se pose au SEUIL
   * (`cendreARemue`) : le foyer a-t-il bougé, et son avancée a-t-elle atteint la première tuile
   * d'ici ?
   */
  cendreABouge(): number {
    this.majAvancees()
    let perimes = 0
    for (const c of this.chunks.values()) {
      if (c.perime || !cendreARemue(c.cendre, this.cendreAge)) continue
      c.perime = 'cendre'
      perimes++
    }
    return perimes
  }

  /** La trame de grain d'un terrain — celle de sa famille, cuite une fois par seed. */
  private trameDe = (t: number): Float32Array | null => {
    const f = familleDe(t)
    if (!f) return null
    let trame = this.trames.get(f)
    if (!trame) {
      trame = new Float32Array(GRAIN_CELLS * GRAIN_CELLS)
      for (let cy = 0; cy < GRAIN_CELLS; cy++) {
        for (let cx = 0; cx < GRAIN_CELLS; cx++) trame[cy * GRAIN_CELLS + cx] = grainFacteur(cx, cy, f, this.seed)
      }
      this.trames.set(f, trame)
    }
    return trame
  }

  /**
   * ═══ LE TERRAIN EFFECTIF — celui qu'on VOIT, cendre comprise (spec `cendre.md` R11) ═══
   *
   * La carte n'est JAMAIS mutée : c'est tout le principe de la cendre, qui se dérive de dix
   * nombres. Le sol dessiné ne peut donc pas la voir dans `map.terrain` — on la lui apprend ici,
   * au seul endroit où il lit le terrain.
   *
   * ⚠ C'EST CE QUI DONNE À LA CENDRE SES BORDS. Une couche séparée peignait un pixel par tuile :
   * la bonne couleur, le bon grain, et **aucune frange** — la limite avec le vivant était une
   * découpe nette au milieu d'un monde dont toutes les autres frontières débordent. En passant
   * par le pavé, la cendre reçoit sa frange irrégulière, son liseré, son arête et son ombre
   * portée comme n'importe quel terrain : elle cesse d'être posée SUR le monde.
   */
  private terrainAt = (tx: number, ty: number): number => {
    const { width, height, terrain } = this.map
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return 0
    const brut = terrain[ty * width + tx] ?? 0
    if (!this.cendreIci?.(tx, ty)) return brut
    // DEUX BANDES (spec `cendre.md` R11) : la frange est de la cendre, le cœur recycle les
    // terrains de la Cendrière. La corruption EST la Cendrière qui s'étend — elle en a la peau.
    const profond = auCoeurDeLaCendre(this.map, tx, ty, this.avancees, this.seed)
    return terrainCendre(brut, profond) ?? brut
  }

  /** LE TERRAIN TEL QU'IL SE VOIT — cendre comprise. La seule vérité pour qui doit s'accorder au
   *  sol PEINT et non au sol de la carte (les terrains de cendre sont DÉRIVÉS : `map.terrain` ne
   *  les porte pas, et qui l'interrogerait ne trouverait jamais de cendre nulle part). */
  terrainAffiche(tx: number, ty: number): number {
    return this.terrainAt(tx, ty)
  }

  private couleurAt = (tx: number, ty: number): number => {
    const { width, height } = this.map
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return 0
    if (this.cendreIci?.(tx, ty)) {
      const brut = this.map.terrain[ty * width + tx] ?? 0
      const profond = auCoeurDeLaCendre(this.map, tx, ty, this.avancees, this.seed)
      const c = terrainCendre(brut, profond)
      // Au CŒUR, le terrain recyclé garde SA couleur d'origine (c'est la Cendrière, pas de la
      // cendre fraîche) : seule la frange porte le dégradé de chaleur.
      if (c !== undefined) return profond ? (TERRAIN_COLORS[c] ?? 0) : this.couleurCendre(tx, ty, c)
    }
    // LA TEINTE DE LA SAISON, sur le VIVANT et lui seul (`teinteDuTerrain` rend l'identité sur
    // la roche, l'eau, la route, le mur). Elle se pose ICI, après la cendre : un sol cendré est
    // mort, il ne tourne pas avec l'année — et il n'y arrive pas non plus par accident, puisque
    // les terrains de cendre ne sont pas dans `TERRAINS_VIVANTS`.
    const brut = this.couleurs[ty * width + tx] ?? 0
    return teinter(brut, teinteDuTerrain(this.map.terrain[ty * width + tx] ?? 0, this.jourDeLAnnee))
  }

  /**
   * LA SAISON A TOURNÉ D'UN CRAN — on périme TOUT, et `render` recuira au budget.
   *
   * « Tout », contrairement à la cendre : la cendre avance sur un front, la saison touche chaque
   * tuile vivante de la carte à la même seconde. Rend combien viennent de se périmer.
   *
   * Appelé à chaque image ; il ne fait rien tant que le cran n'a pas bougé — soit une heure de
   * jeu (un jour de saison vaut trente minutes réelles, le cran en vaut deux).
   */
  /**
   * ═══ LE SOLEIL TOURNE, ET SEULES LES FISSURES S'EN APERÇOIVENT ═══
   *
   * *(Décision d'Alexis, 2026-08-27 : « fais les 2 » — la lèvre figée ET la lèvre qui suit le
   * jour.)* Le relief du pavement est cuit dans l'image : pour qu'il tourne, il faut recuire.
   * Trois gardes rendent la chose bon marché, et il faut les trois :
   *
   *   ① SEULS LES CHUNKS À RELIEF se périment (`ChunkCuit.relief`) — un pré rend la même image
   *      à toute heure, et il n'y a aucune raison de le recuire douze fois par jour.
   *   ② LE SOLEIL EST QUANTIFIÉ (`CRANS_SOLEIL`) : on ne recuit pas sur un flottant qui bouge à
   *      chaque image, on recuit quand la LÈVRE aurait vraiment changé de côté d'un pixel.
   *   ③ ET LE BUDGET DE `render` étale la vague, comme il étale déjà celle de la saison.
   *
   * `soleilTournant = false` fige la lumière plein nord (`soleilDuPavement(0)`) : la convention
   * du liseré, celle que le pavé truque déjà partout. Aucun autre chemin de code — c'est le même
   * relief, avec un vecteur constant.
   */
  soleilTournant = true
  /** L'heure murale poussée par la scène (comme `jourDeLAnnee`). */
  heureSolaire = 12 as unknown as HeureSolaire
  private cranSoleil = Number.NaN
  private soleil = soleilDuPavement(0)

  soleilABouge(): number {
    const dirX = this.soleilTournant ? sunDirection(this.heureSolaire).x : 0
    const cran = Math.round(dirX * CRANS_SOLEIL)
    if (cran === this.cranSoleil) return 0
    this.cranSoleil = cran
    this.soleil = soleilDuPavement(cran / CRANS_SOLEIL)
    let perimes = 0
    for (const c of this.chunks.values()) {
      if (c.perime || !c.relief) continue
      c.perime = 'soleil'
      perimes++
    }
    return perimes
  }

  saisonABouge(): number {
    const cran = cranDeSaison(this.jourDeLAnnee)
    if (cran === this.cranCuit) return 0
    this.cranCuit = cran
    // ⚠ PAS DE CAS PARTICULIER AU PREMIER APPEL. La couche naît AVANT que `WorldScene` ne lui
    // pousse le jour du snapshot : ses premiers chunks portent donc la teinte du jour 1. Un
    // court-circuit « rien n'est encore cuit » les laisserait tels quels **pour toujours** —
    // ils ne seraient jamais périmés ensuite, puisque le cran, lui, aurait déjà été noté.
    let perimes = 0
    for (const c of this.chunks.values()) {
      if (c.perime) continue
      c.perime = 'saison'
      perimes++
    }
    return perimes
  }

  /** Les chunks de la vue (et sa couronne) : cuit ce qui manque, rend ce qui est loin. */
  render(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.frame++
    const cotePx = PAVE.CHUNK * PAVE_PX
    const v = camera.worldView
    const cx0 = Math.max(0, Math.floor(v.x / cotePx) - COURONNE)
    const cy0 = Math.max(0, Math.floor(v.y / cotePx) - COURONNE)
    const cxMax = Math.ceil((this.map.width * TILE_PX) / cotePx) - 1
    const cyMax = Math.ceil((this.map.height * TILE_PX) / cotePx) - 1
    const cx1 = Math.min(cxMax, Math.floor((v.x + v.width) / cotePx) + COURONNE)
    const cy1 = Math.min(cyMax, Math.floor((v.y + v.height) / cotePx) + COURONNE)

    // Le VISIBLE d'abord, sans budget : l'écran ne doit jamais montrer un trou. La couronne
    // ensuite, au compte-gouttes.
    const m = MARGE_VISIBLE_PX
    const visible = (cx: number, cy: number): boolean =>
      cx * cotePx < v.x + v.width + m && (cx + 1) * cotePx > v.x - m
      && cy * cotePx < v.y + v.height + m && (cy + 1) * cotePx > v.y - m
    let budgetCouronne = CUISSONS_COURONNE_PAR_FRAME
    for (const passeVisible of [true, false]) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (visible(cx, cy) !== passeVisible) continue
          const k = cy * 65536 + cx
          const c = this.chunks.get(k)
          if (c) {
            c.vu = this.frame
            continue
          }
          if (!passeVisible) {
            if (budgetCouronne <= 0) continue
            budgetCouronne--
          }
          this.cuire(cx, cy, k)
        }
      }
    }

    // LES PÉRIMÉS DE LA CENDRE : le visible d'abord, au budget. Ils gardent leur image d'hier
    // jusqu'à leur tour — un jour de retard sur la frange, contre une saccade de 220 ms.
    let budgetCendre = RECUISSONS_CENDRE_PAR_FRAME
    for (const passeVisible of [true, false]) {
      if (budgetCendre <= 0) break
      for (const [k, c] of [...this.chunks]) {
        if (budgetCendre <= 0) break
        if (!c.perime) continue
        const cx = k % 65536
        const cy = (k - cx) / 65536
        if (visible(cx, cy) !== passeVisible) continue
        budgetCendre--
        if (c.perime === 'saison') this.recuitsSaison++
        else this.recuitsCendre++
        this.rendre(k, c)
        this.cuire(cx, cy, k)
      }
    }

    // L'oubli : ce qui n'a pas été vu depuis longtemps se rend ; et si on en garde trop (une
    // longue marche), les plus anciens partent d'abord — jamais un chunk vu cette frame.
    for (const [k, c] of this.chunks) {
      if (this.frame - c.vu > OUBLI_FRAMES) this.rendre(k, c)
    }
    if (this.chunks.size > MAX_VIVANTS) {
      const parAge = [...this.chunks.entries()].sort((a, b) => a[1].vu - b[1].vu)
      for (const [k, c] of parAge) {
        if (this.chunks.size <= MAX_VIVANTS || c.vu === this.frame) break
        this.rendre(k, c)
      }
    }
  }

  /** Combien de chunks VISIBLES manquent à l'écran en ce moment — la sonde du smoke : doit
   *  valoir 0 après tout rendu, saut de caméra compris. */
  trousVisibles(camera: Phaser.Cameras.Scene2D.Camera): number {
    const cotePx = PAVE.CHUNK * PAVE_PX
    const v = camera.worldView
    const cxMax = Math.ceil((this.map.width * TILE_PX) / cotePx) - 1
    const cyMax = Math.ceil((this.map.height * TILE_PX) / cotePx) - 1
    let trous = 0
    for (let cy = Math.max(0, Math.floor(v.y / cotePx)); cy <= Math.min(cyMax, Math.floor((v.y + v.height) / cotePx)); cy++) {
      for (let cx = Math.max(0, Math.floor(v.x / cotePx)); cx <= Math.min(cxMax, Math.floor((v.x + v.width) / cotePx)); cx++) {
        if (!this.chunks.has(cy * 65536 + cx)) trous++
      }
    }
    return trous
  }

  private cuire(cx: number, cy: number, k: number): void {
    const t0 = performance.now()
    const S = PAVE_COTE
    // Le tampon commence UN PIXEL AVANT le chunk (`PAVE.BAVE`) : l'image se pose d'autant en
    // arrière, et deux voisines se recouvrent au lieu de se toucher (voir `PAVE.BAVE`).
    const x0 = cx * S - PAVE.BAVE
    const y0 = cy * S - PAVE.BAVE
    const cle = `pave-${this.seed >>> 0}-${cx}-${cy}`
    // LA SIGNATURE DE CENDRE, relevée AVANT la cuisson (les âges ne bougent pas entre les deux) :
    // c'est elle qui dira demain si ce chunk doit être jeté.
    const tSig = performance.now()
    const cendre = signatureCendre(this.map, this.seed, cx, cy, this.cendreAge)
    this.derniereSignatureMs = performance.now() - tSig
    const cuit = cuireChunk({ cx, cy, seed: this.seed, soleil: this.soleil, terrainAt: this.terrainAt, couleurAt: this.couleurAt, trameDe: this.trameDe, moucheture: this.moucheture })
    const image = this.poser(cle, cuit.sol, x0, y0, PAVE_DEPTH)
    if (!image) return
    const chunk: Chunk = { image, cle, vu: this.frame, cendre, relief: cuit.relief }
    if (cuit.surplomb) {
      const cleSur = cle + '-surplomb'
      const sur = this.poser(cleSur, cuit.surplomb, x0, y0, SURPLOMB_DEPTH)
      if (sur) chunk.surplomb = { image: sur, cle: cleSur }
    }
    this.chunks.set(k, chunk)
    this.cuits++
    this.derniereCuissonMs = performance.now() - t0
  }

  /** Verse un tampon RGBA dans une CanvasTexture NEAREST et pose son image. */
  private poser(cle: string, rgba: Uint8ClampedArray, x: number, y: number, depth: number): Phaser.GameObjects.Image | null {
    return poserChunk(this.scene, cle, rgba, x, y, depth)
  }

  private rendre(k: number, c: Chunk): void {
    c.image.destroy()
    this.scene.textures.remove(c.cle)
    if (c.surplomb) {
      c.surplomb.image.destroy()
      this.scene.textures.remove(c.surplomb.cle)
    }
    this.chunks.delete(k)
  }

  /** Combien de chunks portent un surplomb de berge — la sonde du smoke. */
  surplombsVivants(): number {
    let n = 0
    for (const c of this.chunks.values()) if (c.surplomb) n++
    return n
  }

  /** Combien de chunks sont cuits et posés — la sonde du smoke (`matiere`). */
  chunksVivants(): number {
    return this.chunks.size
  }

  destroy(): void {
    for (const [k, c] of this.chunks) this.rendre(k, c)
  }
}
