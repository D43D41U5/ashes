/**
 * LES ÉCLATS DU NŒUD FRAPPÉ — le troisième signe de la récolte (spec recolte.md G10).
 *
 * G10 n'en admettait que DEUX : le nœud tressaille (`hit-fx.ts`), le butin s'inscrit au
 * HUD (`ui/pickup-toasts.ts`). Le coup portait donc sans rien ARRACHER — on voyait le
 * tronc frémir, on lisait « +2 bois » à l'autre bout de l'écran, et entre les deux il ne
 * se passait rien. Le troisième signe est demandé par Alexis (2026-07-29) et il comble
 * exactement ce trou : LA MATIÈRE QUITTE LE NŒUD.
 *
 * DEUX RÈGLES, et ce sont elles qui font que ça se lit comme une conséquence :
 *
 *   1. LA COULEUR EST CELLE DU NŒUD — LUE SUR SON PROPRE SPRITE. Aucune table de
 *      teintes n'est écrite ici : on ÉCHANTILLONNE la texture que le nœud affiche à
 *      cette seconde (`nd-hetre_trunk`, `nd-berry_bush-2`, `nd-ash_heap`…) et on en
 *      retient les tons dominants. Une table jumelle aurait dérivé au premier coup de
 *      pinceau — les couleurs des nœuds vivent dans DEUX backends déjà (BootScene en
 *      Phaser Graphics, `lit-props` en Canvas2D) ; une troisième copie était acquise.
 *      Ici, repeindre un nœud repeint ses éclats, sans que personne y pense.
 *
 *   2. LA PROJECTION PROLONGE LE COUP — DONC ELLE PART À L'OPPOSÉ DU RÉCOLTEUR. La hache
 *      entre par la face qui regarde le bûcheron et POUSSE la matière de l'autre côté :
 *      les éclats sortent par la face OPPOSÉE, en éventail large, pas « au hasard autour ».
 *      C'est la seule chose qui distingue une gerbe d'un confetti : on doit pouvoir dire,
 *      sur une image fixe, d'où le coup est venu.
 *
 *      LA PREMIÈRE VERSION LES ENVOYAIT VERS LE RÉCOLTEUR (le raisonnement : un copeau
 *      rebondit vers celui qui frappe). Elle a été corrigée par Alexis le 2026-07-29 et la
 *      capture à 6× lui donne raison sans discussion : la gerbe se TASSAIT SUR LE SPRITE
 *      DU JOUEUR — un tas de grains collé à l'avatar, qui masquait à la fois le geste et
 *      le nœud, et qui ne lisait pas comme de la matière arrachée. Envoyée de l'autre
 *      côté, elle dégage l'avatar et le coup se lit d'un coup d'œil.
 *
 * Et la matière ne tombe pas toute pareil : un éclat de pierre CLAQUE et se pose, une
 * feuille VOLETTE, la cendre MONTE. La famille du nœud décide de la loi de vol
 * (`LOIS`) ; sa texture décide de la couleur. Deux axes, aucun cas particulier.
 *
 * ─── D'OÙ VIENT LE DÉCLENCHEMENT ────────────────────────────────────────────────────
 * DE L'ÉVÉNEMENT `resource_harvested`, JAMAIS DU CLIC — la règle du jus, écrite au long
 * dans `attack-fx.ts`, vaut ici mot pour mot : un éclat qui part sur un coup que la sim
 * refuse est un mensonge, et en multi le jus des AUTRES ne nous arrive que par
 * événements. L'API prend donc la position du RÉCOLTEUR (`fromX/fromY`), pas « celle du
 * joueur » : le jour où le gate de `WorldScene` s'ouvre aux autres entités, il n'y a
 * rien à réécrire ici.
 *
 * Les éclats naissent DANS la boucle de nœuds de `snapshot-view` — elle seule connaît la
 * position réelle du sprite (décalage d'arbre, tressaillement, relief du warp), sa
 * hauteur et sa texture du moment. Les recalculer ici les aurait fait diverger au
 * premier arbre décalé.
 */
import Phaser from 'phaser'
import type { NodeType } from '@ashes/sim'
import { TILE_PX, TIE_ACTOR, ySortDepth } from '../../render/framing'

/**
 * COMMENT LA MATIÈRE QUITTE LE NŒUD. Quatre lois, pas douze : ce qui change d'un nœud à
 * l'autre est la MATIÈRE, et la matière n'a que quatre comportements dans ce jeu.
 */
export type Famille = 'bois' | 'pierre' | 'feuille' | 'poussiere'

/**
 * La famille de chaque nœud. `Record<NodeType, …>` DÉLIBÉRÉMENT : un nœud ajouté à
 * `NodeType` casse la compilation ici tant qu'on ne lui a pas donné sa matière — une
 * table exhaustive par construction, jamais par relecture (règle maison).
 */
export const FAMILLE_DE_NOEUD: Record<NodeType, Famille> = {
  // LA FUMEROLLE : on gratte du SEL sur sa lèvre — de la matière minérale qui s'écaille.
  fumerolle: 'pierre',
  tree: 'bois',
  old_tree: 'bois',
  rock: 'pierre',
  bloc: 'pierre',
  quarry: 'pierre',
  iron_vein: 'pierre',
  coal_seam: 'pierre',
  // LA CHARBONNIÈRE (R25) : c'est du BOIS, même brûlé — il se casse en copeaux noirs, pas en
  // éclats. La famille suit la matière, jamais le lieu où elle se trouve.
  charbonniere: 'bois',
  rubble: 'pierre',
  // LE GLANAGE (spec `glanage.md`) : on se BAISSE, rien n'est fracturé — mais la matière
  // reste ce qu'elle est. Une branche fait des copeaux, une pierre fait des éclats ; c'est
  // le VOLUME du geste qui les distingue du coup d'outil, pas leur loi de vol.
  branche_au_sol: 'bois',
  pierre_au_sol: 'pierre',
  // Cueillis à MAINS NUES : rien n'est fracturé, ça se détache et ça retombe.
  fiber_plant: 'feuille',
  berry_bush: 'feuille',
  champignon: 'feuille',
  leaf_pile: 'feuille', // le tas éclate en feuilles — ce qu'il est

  // La bêche dans la tourbe et le râteau dans la cendre lèvent une POUSSIÈRE : elle monte.
  peat_cut: 'poussiere',
  ash_heap: 'poussiere',

  // LES COINS DE PÊCHE (spec peche.md) : rien ne se fracture, rien ne se détache — la prise a son
  // propre rendu (le ferrage, `peche-fx`). Rangés en « feuille » parce que c'est la loi la plus
  // légère ; le FX de récolte commun n'y tombe en pratique jamais (la prise n'est pas un coup).
  fishing_spot_river: 'feuille',
  fishing_spot_lake: 'feuille',
}

export interface Loi {
  /** Combien d'éclats au coup de base (le rendement et la frappe nette en ajoutent). */
  n: number
  /** Vitesse horizontale, px/s : [min, max]. */
  vitesse: readonly [number, number]
  /** Vitesse d'ENVOL (axe z, px/s) : [min, max]. Négative = ça retombe tout de suite. */
  envol: readonly [number, number]
  /** Gravité, px/s². Faible = ça flotte. */
  g: number
  /** Durée de vie, ms. */
  vie: number
  /** Côté du carré, en px d'art (2 ou 3 — on est en pixel art, pas en volutes). */
  taille: number
  /** Le vol PAPILLONNE (feuille, cendre) : une dérive latérale lente s'ajoute. */
  flotte: boolean
}

/**
 * Les quatre lois.
 *
 * LES DEUX FAMILLES CASSANTES (bois, pierre) SONT CALIBRÉES POUR SE POSER AVANT DE
 * S'EFFACER — c'est une propriété, pas un réglage à l'œil, et `recolte-fx.test.ts` la
 * vérifie sur le pire cas (une morsure à `IMPACT_MAX_PX` de haut, l'envol maximal). Un
 * éclat qui s'éteint encore en l'air lit comme une disparition ; posé, il lit comme un
 * débris. C'est cette demi-seconde au sol qui fait qu'on VOIT ce qu'on a arraché.
 *
 * LES DEUX AUTRES NE SE POSENT PAS, ET C'EST LE PROPOS : une feuille sort du cadre en
 * papillonnant, une poussière MONTE et se dissipe. Leur gravité est un dixième de celle
 * du bois — elles s'effacent en l'air parce que c'est ce que fait la matière légère.
 */
export const LOIS: Record<Famille, Loi> = {
  // LE BOIS : ça saute, ça vole, ça se plante dans l'herbe. Le geste le plus franc.
  bois: { n: 7, vitesse: [20, 46], envol: [46, 70], g: 300, vie: 700, taille: 2, flotte: false },
  // LA PIERRE : plus vif, plus court, plus bas. Un éclat de roche ne plane pas.
  pierre: { n: 7, vitesse: [22, 48], envol: [40, 66], g: 380, vie: 600, taille: 2, flotte: false },
  // LA FEUILLE : elle se DÉTACHE (envol quasi nul) et descend en papillonnant, longtemps.
  feuille: { n: 6, vitesse: [10, 26], envol: [2, 14], g: 48, vie: 950, taille: 2, flotte: true },
  // LA POUSSIÈRE : elle MONTE et s'efface. Gravité presque nulle, gros grain, vie longue.
  poussiere: { n: 6, vitesse: [8, 20], envol: [14, 26], g: 10, vie: 850, taille: 3, flotte: true },
}

/** LES FAMILLES CASSANTES : celles dont la matière doit toucher le sol avant de s'éteindre. */
export const CASSANTES: readonly Famille[] = ['bois', 'pierre']

/**
 * L'INSTANT DU CONTACT AU SOL (ms) d'un éclat parti de `z0` à la vitesse d'envol `vz`.
 * Racine de `z0 + vz·t − g·t²/2 = 0`. Pure, donc opposable : c'est elle qui rend la
 * promesse « ça se pose avant de s'effacer » VÉRIFIABLE plutôt que déclarée.
 */
export function contactSol(z0: number, vz: number, g: number): number {
  return ((vz + Math.sqrt(vz * vz + 2 * g * z0)) / g) * 1000
}

/**
 * LE TON DE REPLI, par famille — et il ne sert QUE si la texture s'est révélée illisible.
 * Ce ne sont pas « les couleurs des nœuds » (celles-là se lisent sur les sprites, règle 1) :
 * c'est la matière la plus neutre de chaque famille, pour qu'un échantillonnage raté rende
 * une gerbe terne plutôt qu'une gerbe FAUSSE.
 */
export const TON_DE_REPLI: Record<Famille, number> = {
  bois: 0x6b5334,
  pierre: 0x6a6a72,
  feuille: 0x4f7a35,
  poussiere: 0x8d8884,
}

/** L'éventail : demi-angle de la gerbe autour de la direction de projection. Large — un
 *  coup de hache ne projette pas dans un tube. */
const DEMI_EVENTAIL = 1.15 // rad, ≈ 66°

/** Les tons du givre (blanc-bleu) et de la sève qui repart (verts) — voir `givre`. */
const TONS_GIVRE: readonly number[] = [0xeaf4ff, 0xc9dff5, 0xffffff, 0xa8cde4]
const TONS_SEVE: readonly number[] = [0x7fbf5a, 0xb8e08a, 0xe8f5c0, 0x4f7a35]
/** Plafond d'éclats vivants. La récolte tourne à ~1 coup/s toute une partie : sans ce
 *  plafond, une session entière de minage finirait en champ de gravier. */
const MAX_ECLATS = 96
/** Décalage de clé pour la gerbe de FEUILLAGE : elle vole sous le même `nodeId` et le même
 *  instant que la gerbe de copeaux, et la garde anti-doublon en étoufferait une des deux.
 *  Très au-delà du plus grand id de nœud du jeu (~336 000 mesurés en Vieille Sylve). */
const FEUILLAGE_MARQUE = 100_000_000

/** Plafond par gerbe. Un épuisement en jette deux fois plus qu'une frappe, mais il reste
 *  une poignée de grains — pas un feu d'artifice. */
const MAX_PAR_GERBE = 16
/** Hauteur d'impact : mi-hauteur du sprite, mais jamais plus haut que la ceinture d'un
 *  avatar (24 px). Un arbre de six tuiles se coupe au PIED, pas dans son houppier. */
const IMPACT_MAX_PX = 14
/** Le point d'émission avance À L'OPPOSÉ du récolteur : la face de SORTIE, pas le centre. */
const AVANCE_FACE_PX = 3.5

/**
 * LA DIRECTION DE PROJECTION : du récolteur VERS le nœud, et au-delà — normalisée.
 *
 * C'est toute la « direction de projection logique » : le coup entre par la face qui
 * regarde le récolteur et ressort de l'autre côté. La gerbe s'éloigne donc de lui, ce qui
 * la fait lire comme de la matière POUSSÉE, et ce qui dégage son sprite (l'inverse — la
 * version d'origine — empilait les grains sur l'avatar).
 *
 * Un récolteur exactement sur le nœud (impossible en jeu — l'emprise l'en empêche — mais
 * pas en test) projette vers le BAS de l'écran, c'est-à-dire vers la caméra : sans côté
 * opposé à choisir, on prend le seul repli qui reste visible.
 */
export function directionProjection(nx: number, ny: number, fx: number, fy: number): { dx: number; dy: number } {
  const dx = nx - fx
  const dy = ny - fy
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d < 0.001) return { dx: 0, dy: 1 }
  return { dx: dx / d, dy: dy / d }
}

/**
 * LES TONS DOMINANTS d'une texture — les couleurs qui la COUVRENT, du plus étendu au
 * moins. Les pixels transparents (ou quasi) ne comptent pas : c'est de l'art à silhouette
 * découpée, le fond n'est pas une couleur du nœud.
 *
 * Pourquoi les dominants et pas la MOYENNE : moyenner le tronc d'un bouleau (écorce
 * claire + rayures sombres) rend un gris de boue qui n'est dans le sprite nulle part. Les
 * aplats d'un pixel art SONT ses matériaux — on les prend tels quels.
 */
export function tonsDominants(pixels: readonly (readonly [number, number, number, number])[], max: number): number[] {
  const surface = new Map<number, number>()
  for (const [r, g, b, a] of pixels) {
    if (a < 128) continue
    const teinte = (r << 16) | (g << 8) | b
    surface.set(teinte, (surface.get(teinte) ?? 0) + 1)
  }
  return [...surface.entries()]
    .sort((u, v) => v[1] - u[1] || u[0] - v[0]) // à surface égale, l'ordre est STABLE (pas de scintillement)
    .slice(0, max)
    .map(([teinte]) => teinte)
}

/** Combien de tons on retient par texture. Trois : la masse, sa nuance, et l'accent
 *  (la baie rouge, la veine de rouille, la braise). Au-delà, on ramasse de l'anti-alias. */
const TONS_PAR_TEXTURE = 3

/**
 * LES TROIS VALEURS D'UN MÊME TON. Un albédo `_lit` est UNIFORME par matériau — le relief
 * y vient de la lumière, pas du dessin. Un tronc n'a donc qu'UNE couleur à donner, et sept
 * grains rigoureusement identiques lisent comme un aplat qui bouge, pas comme de la matière
 * qui éclate.
 *
 * On décline donc chaque ton en trois VALEURS — sombre / juste / claire — exactement comme
 * le pixel art du jeu décline ses matériaux. Trois PAS FRANCS, jamais un dégradé continu :
 * l'art de ce jeu est quantifié, ses éclats aussi (règle des FX pixellisés). C'est la
 * matière qu'on nuance, pas la couleur qu'on change — ±22 % reste dans la famille du ton.
 */
export const VALEURS = [0.78, 1, 1.22] as const

export function nuance(ton: number, valeur: number): number {
  const composante = (decalage: number): number => {
    const c = Math.round((((ton >> decalage) & 0xff) * valeur))
    return Math.max(0, Math.min(255, c))
  }
  return (composante(16) << 16) | (composante(8) << 8) | composante(0)
}

/** Un PRNG minuscule (xorshift32). Le hasard du rendu n'a aucune contrainte de
 *  déterminisme inter-moteurs (on n'est pas dans /sim) — mais SEMÉ, une gerbe est
 *  reproductible, donc testable et stable d'une frame à l'autre.
 *
 *  EXPORTÉ pour la terre du réveil (`reveil-fx.ts`) : deux générateurs de hasard de rendu
 *  auraient été deux nombres à retrouver le jour où une gerbe se met à clignoter. */
export function semis(graine: number): () => number {
  let s = graine | 0
  if (s === 0) s = 0x9e3779b9
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

interface Eclat {
  img: Phaser.GameObjects.Image
  /** Position au SOL (monde), et hauteur au-dessus de lui. */
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  g: number
  ne: number
  vie: number
  flotte: boolean
  phase: number
  /** La strate du nœud frappé (`strateDEtage` / `strateDeProfondeur`) : l'éclat naît dans son
   *  monde — sur une terrasse, au-dessus de ses pavés et de sa paroi. */
  strate: number
}

/**
 * LA GERBE. Un banc d'éclats RÉUTILISÉS : la récolte est le geste le plus répété du jeu,
 * créer/détruire des objets Phaser à chaque coup est le chemin le plus court vers un
 * minage qui hoquette.
 */
export class RecolteFx {
  private readonly eclats: Eclat[] = []
  /** Les tons déjà lus, par clé de texture — un échantillonnage par texture, pas par coup. */
  private readonly tons = new Map<string, number[]>()
  /** Le dernier coup ÉCLATÉ par nœud : la boucle de nœuds repasse chaque frame, la gerbe
   *  ne part qu'une fois par frappe. */
  private readonly vus = new Map<number, number>()

  /** L'éclairage dynamique est-il armé ? (posé par WorldScene) — lu à la naissance de chaque
   *  éclat : un éclat vit moins de deux secondes, pas besoin de réarmer après coup. */
  lighting = true

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * LES TONS D'UNE TEXTURE, lus sur son propre sprite (et mémorisés). Une texture
   * illisible (absente, ou rendue hors canvas) rend une liste VIDE : l'appelant s'en
   * remet alors au ton de repli. On ne devine jamais une couleur.
   */
  private tonsDe(texture: string): number[] {
    const connus = this.tons.get(texture)
    if (connus) return connus
    const pixels: [number, number, number, number][] = []
    const src = this.scene.textures.get(texture)
    const frame = src?.get()
    if (frame) {
      // Un pas de 1 px : les sprites de nœud font 16×16 (au plus ~32×48 pour un fût).
      // C'est quelques centaines de lectures, UNE fois par texture de toute la partie.
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const c = this.scene.textures.getPixel(x, y, texture)
          if (c) pixels.push([c.red, c.green, c.blue, c.alpha])
        }
      }
    }
    const tons = tonsDominants(pixels, TONS_PAR_TEXTURE)
    this.tons.set(texture, tons)
    return tons
  }

  /**
   * LA GERBE D'UN COUP. `px/py` : le PIED du sprite du nœud (origine 0.5/1), tel que
   * `snapshot-view` vient de le poser — relief et tressaillement compris. `hauteur` : sa
   * hauteur affichée. `fromX/fromY` : le RÉCOLTEUR, d'où le coup est parti.
   *
   * `clean` (frappe nette, spec recolte-maitrise) et `count` (le rendement) épaississent
   * la gerbe : le coup qui rapporte le plus est celui qui arrache le plus. C'est la seule
   * lecture de maîtrise qu'on ait dans le monde — le reste est au HUD.
   *
   * DEUX HORLOGES, ET ELLES NE SE CONFONDENT PAS. `at` est l'instant du COUP : il ne sert
   * qu'à reconnaître deux fois la même frappe (la boucle de nœuds repasse chaque frame).
   * `now` est l'instant du DESSIN, et c'est de lui que les éclats datent leur vie. Les
   * faire vieillir depuis `at` les faisait NAÎTRE DÉJÀ VIEUX de l'écart entre l'événement
   * et la frame qui le peint : invisible à 60 im/s, mais mesuré à un TIERS de leur vie
   * dès que la frame s'allonge — la gerbe du bois s'éteignait avant d'avoir été rendue.
   */
  eclater(
    nodeId: number,
    at: number,
    now: number,
    type: NodeType,
    texture: string,
    px: number,
    py: number,
    hauteur: number,
    fromX: number,
    fromY: number,
    count: number,
    clean: boolean,
    strate = 0,
  ): void {
    if (this.vus.get(nodeId) === at) return
    this.vus.set(nodeId, at)

    const { dx, dy } = directionProjection(px, py, fromX, fromY)
    this.gerbe({
      graine: nodeId * 7919 + at * 31,
      famille: FAMILLE_DE_NOEUD[type],
      texture,
      now,
      // Le point de sortie : mi-hauteur du sprite, plafonné à hauteur de ceinture, et
      // avancé sur la face OPPOSÉE au récolteur — la matière sort par là.
      x: px + dx * AVANCE_FACE_PX,
      y: py + dy * AVANCE_FACE_PX,
      z: Math.min(hauteur * 0.5, IMPACT_MAX_PX),
      angle: Math.atan2(dy, dx),
      demiEventail: DEMI_EVENTAIL,
      // Le coup qui rapporte le plus est celui qui arrache le plus.
      surplus: Math.min(3, Math.max(0, count - 1)) + (clean ? 2 : 0),
      force: 1,
      strate,
    })
  }

  /**
   * LE NŒUD MEURT — et il ne meurt pas dans une direction (spec recolte.md G15).
   *
   * Une frappe POUSSE la matière d'un côté ; un épuisement la DISPERSE. Le rocher qui rend
   * sa dernière pierre s'effondre sur lui-même, le buisson vidé lâche ses feuilles tout
   * autour : l'éventail s'ouvre donc à 360° et il n'y a plus de récolteur dans l'équation.
   * C'est la SEULE différence de fond avec `eclater` — même matière, même couleur lue sur
   * le même sprite, même loi de vol. Une gerbe plus fournie (`force`), parce que ce coup-là
   * est le dernier et qu'il vaut d'être vu.
   */
  eclatement(type: NodeType, texture: string, px: number, py: number, hauteur: number, now: number, strate = 0): void {
    this.gerbe({
      // Semé sur l'INSTANT seul : un épuisement n'arrive qu'une fois par nœud, il n'a pas
      // de frappe à reconnaître.
      graine: Math.floor(now) * 2654435761,
      famille: FAMILLE_DE_NOEUD[type],
      texture,
      now,
      x: px,
      y: py,
      z: Math.min(hauteur * 0.5, IMPACT_MAX_PX),
      angle: 0,
      demiEventail: Math.PI, // le tour complet
      surplus: 0,
      force: 2,
      strate,
    })
  }

  /**
   * LE HOUPPIER ENCAISSE LE COUP (demande d'Alexis, 2026-07-29 : « des feuilles qui
   * virevoltent lorsqu'on tape un arbre »).
   *
   * La hache mord le FÛT, à hauteur de ceinture — et c'est là que partent les copeaux. Mais
   * un arbre est une masse de six tuiles : le choc le remonte, et ce qui se détache là-haut
   * n'est pas du bois, c'est du FEUILLAGE. Deux gerbes pour un seul coup, à deux hauteurs
   * différentes, de deux matières différentes — c'est ce décalage qui donne son échelle à
   * l'arbre. Une seule gerbe au pied ferait un poteau qu'on gratte.
   *
   * Elles ne partagent QUE la mémoire du coup : les feuilles tombent de la CIME (`hauteur`
   * = l'ancrage du houppier), prennent leur couleur sur la texture du HOUPPIER (pas du
   * fût), suivent la loi `feuille` (gravité au dixième, vol long, papillonnement) et
   * s'éparpillent à 360° — une feuille qu'on décroche ne part pas dans une direction, elle
   * descend en tournoyant.
   */
  feuillage(nodeId: number, at: number, now: number, textureHouppier: string, px: number, py: number, hauteur: number, rayon: number, strate = 0): void {
    // Sa propre marque : sans elle, la garde anti-doublon de `eclater` étoufferait l'une
    // des deux gerbes du même coup — elles portent le même `nodeId` et le même `at`.
    const marque = nodeId + FEUILLAGE_MARQUE
    if (this.vus.get(marque) === at) return
    this.vus.set(marque, at)
    this.gerbe({
      graine: nodeId * 104729 + at * 17,
      famille: 'feuille', // un arbre est de la famille BOIS ; ce qui tombe de sa cime, non
      texture: textureHouppier,
      now,
      x: px,
      y: py,
      z: hauteur,
      angle: 0,
      demiEventail: Math.PI,
      surplus: 0,
      force: 0.6, // discret : ça arrive à chaque coup, dix fois par arbre
      // SUR LA COURONNE DU HOUPPIER, jamais en son cœur. Nées au centre, les feuilles sont
      // vertes SUR DU VERT et il leur faudrait presque toute leur vie pour sortir de la
      // silhouette : on ne verrait rien. Nées au bord, elles s'en détachent tout de suite.
      rayon,
      strate,
    })
  }

  /**
   * LE JET LUI-MÊME — un seul chemin pour la frappe et pour l'épuisement. Ce qui les
   * distingue tient dans `angle`/`demiEventail` (un éventail dirigé contre un tour complet)
   * et dans `force` ; tout le reste — couleur lue sur la texture, loi de la matière,
   * écrasement de la profondeur — leur est commun, et doit le rester.
   */
  /**
   * LE GIVRE QUI PREND, LA SÈVE QUI REPART (spec `flore-froid.md` F8 révisée) : la gerbe d'une
   * plante qui disparaît sous le gel (des éclats blanc-bleu qui flottent) ou qui repousse au
   * dégel (des éclats verts). Famille `feuille` : légers, ils flottent — ce n'est pas un choc.
   * Les tons sont DONNÉS, pas lus sur une texture : le givre n'a pas la couleur de la plante.
   */
  givre(x: number, y: number, hauteur: number, now: number, graine: number, degel: boolean, strate = 0): void {
    this.gerbe({
      graine,
      famille: 'feuille',
      texture: '',
      tons: degel ? TONS_SEVE : TONS_GIVRE,
      now,
      x,
      y,
      z: Math.max(2, hauteur * 0.4),
      angle: 0,
      demiEventail: Math.PI,
      surplus: 0,
      force: 0.8,
      strate,
    })
  }

  private gerbe(o: {
    graine: number
    famille: Famille
    texture: string
    /** Des tons imposés : la gerbe ne lit pas la texture. */
    tons?: readonly number[]
    now: number
    x: number
    y: number
    z: number
    angle: number
    demiEventail: number
    surplus: number
    force: number
    /**
     * RAYON D'ÉMISSION, en px : chaque grain part à cette distance du centre, DANS SA
     * PROPRE DIRECTION. Zéro = tout part d'un point (une morsure de hache est ponctuelle).
     * Non nul = la gerbe naît sur une COURONNE — ce qu'il faut pour un houppier, qui n'est
     * pas un point mais une masse : des feuilles nées en son centre restent prisonnières de
     * sa silhouette (vert sur vert) et s'éteignent avant d'en sortir.
     */
    rayon?: number
    /** La strate où la gerbe naît (0 : le palier du sol, carte plate). */
    strate: number
  }): void {
    const loi = LOIS[o.famille]
    const tons = o.tons ?? this.tonsDe(o.texture)
    const rnd = semis(o.graine)
    const combien = Math.min(Math.round(loi.n * o.force) + o.surplus, MAX_PAR_GERBE)
    for (let i = 0; i < combien; i++) {
      // L'éventail est ÉTALÉ, pas tiré au sort : `i/(n-1)` couvre tout l'angle, la part
      // aléatoire ne fait que le désaligner. Un tirage pur laisse des trous — et un trou
      // dans une gerbe de six grains se voit.
      const part = combien === 1 ? 0.5 : i / (combien - 1)
      const a = o.angle + (part - 0.5 + (rnd() - 0.5) * 0.35) * 2 * o.demiEventail
      const v = loi.vitesse[0] + rnd() * (loi.vitesse[1] - loi.vitesse[0])
      const vz = loi.envol[0] + rnd() * (loi.envol[1] - loi.envol[0])
      const base = tons.length > 0 ? tons[i % tons.length]! : TON_DE_REPLI[o.famille]
      const ton = nuance(base, VALEURS[Math.min(VALEURS.length - 1, Math.floor(rnd() * VALEURS.length))]!)
      const cote = loi.taille + (rnd() < 0.25 ? 1 : 0)
      const r = o.rayon ?? 0
      this.pousser({
        x: o.x + Math.cos(a) * r,
        y: o.y + Math.sin(a) * r * 0.6,
        z: o.z,
        vx: Math.cos(a) * v,
        // Le monde est vu de DESSUS : l'axe Y de l'écran est de la PROFONDEUR, il se
        // parcourt moins vite que la largeur. Sans cet écrasement, une gerbe tirée vers
        // le sud fuse deux fois plus loin qu'une gerbe tirée vers l'est.
        vy: Math.sin(a) * v * 0.6,
        vz,
        g: loi.g,
        ne: o.now, // la vie d'un éclat court depuis le DESSIN, pas depuis l'événement
        vie: loi.vie,
        flotte: loi.flotte,
        phase: rnd() * 6.28,
        ton,
        cote,
        strate: o.strate,
      })
    }
  }

  private pousser(g: {
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    g: number
    ne: number
    vie: number
    flotte: boolean
    phase: number
    ton: number
    cote: number
    strate: number
  }): void {
    if (this.eclats.length >= MAX_ECLATS) {
      this.eclats.shift()?.img.destroy() // le plus vieux s'éteint : la gerbe neuve prime
    }
    // Une IMAGE `__WHITE` teintée, pas un `Rectangle` : les Shapes n'ont pas le composant
    // Lighting, or un éclat de récolte est de la MATIÈRE du monde — il prend sa nuit.
    const img = this.scene.add
      .image(Math.round(g.x), Math.round(g.y - g.z), '__WHITE')
      .setDisplaySize(g.cote, g.cote)
      .setTint(g.ton)
      .setDepth(g.strate + ySortDepth(g.y / TILE_PX, TILE_PX, TIE_ACTOR))
    img.setLighting(this.lighting)
    this.eclats.push({ img, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz, g: g.g, ne: g.ne, vie: g.vie, flotte: g.flotte, phase: g.phase, strate: g.strate })
  }

  /**
   * Chaque frame : la matière vole, retombe, se pose, s'efface. `dt` est BORNÉ — l'horloge
   * headless saute (règle maison), et une frame de 400 ms projetterait les éclats à trois
   * tuiles au lieu de les faire retomber.
   */
  update(now: number, dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000
    for (let i = this.eclats.length - 1; i >= 0; i--) {
      const e = this.eclats[i]!
      const age = now - e.ne
      if (age >= e.vie) {
        e.img.destroy()
        this.eclats.splice(i, 1)
        continue
      }
      e.x += e.vx * dt
      e.y += e.vy * dt
      e.z += e.vz * dt
      e.vz -= e.g * dt
      if (e.z <= 0) {
        // AU SOL. Ça s'arrête net (pas de rebond : à cette échelle un rebond lit comme
        // un tremblement), et ça reste posé le temps qu'il reste — c'est cette pause au
        // sol qui fait qu'on VOIT ce qui est tombé, au lieu d'une pluie qui s'évapore.
        e.z = 0
        e.vx = 0
        e.vy = 0
        e.vz = 0
      } else if (e.flotte) {
        // Le PAPILLONNEMENT : une dérive latérale lente. `Math.sin` est ici chez lui —
        // c'est du rendu, pas de la sim.
        e.x += Math.sin(age / 110 + e.phase) * 8 * dt
      }
      const k = age / e.vie
      // Le grain reste PLEIN presque tout du long puis s'éteint vite : un fondu étalé sur
      // toute la vie fait de la brume, pas des éclats.
      e.img.setAlpha(k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35)
      // Position ARRONDIE : l'art est sur une grille de pixels, un éclat en sous-pixel
      // scintillerait (règle des FX pixellisés).
      e.img.setPosition(Math.round(e.x), Math.round(e.y - e.z))
      e.img.setDepth(e.strate + ySortDepth(e.y / TILE_PX, TILE_PX, TIE_ACTOR))
    }
    // La mémoire des coups s'oublie — elle ne sert qu'à ne pas éclater deux fois.
    if (this.vus.size > 64) {
      for (const [id, at] of this.vus) if (now - at > 2000) this.vus.delete(id)
    }
  }

  /** Sonde du smoke : combien d'éclats vivent à cette frame. */
  get vivants(): number {
    return this.eclats.length
  }

  destroy(): void {
    for (const e of this.eclats) e.img.destroy()
    this.eclats.length = 0
    this.tons.clear()
    this.vus.clear()
  }
}
