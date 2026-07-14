/**
 * LE TERRAIN — le graphe devient un monde.
 *
 * Ce fichier ne DÉCIDE rien : il OBÉIT au graphe (`zonegraph.ts`). C'est tout le sens du
 * renversement (spec `worldgen.md` §1) — l'ancienne vallée dérivait sa structure de son
 * terrain (un champ d'altitude concentrique, puis des bandes de biome). On dérive désormais le
 * terrain de la structure. Un plan d'abord ; des cailloux ensuite.
 *
 * ═══ LES TROIS GESTES ═══
 *
 * 1. **LA FALAISE EST LA FRONTIÈRE.** Là où deux zones se touchent, on lève un mur — pas un
 *    champ de roche amorphe, une PAROI, avec une arête. Le champ de MARGE du graphe (la
 *    distance à la frontière la plus proche) est l'outil, et `pays.ts` l'avait déjà nommé sans
 *    en tirer la conséquence : *« c'est ce champ qu'on sculpte pour lever un mur là où deux
 *    pays se touchent. »*
 *
 * 2. **LE SEUIL EST LA RAMPE.** Le couloir percé dans la falaise MONTE — en escalier, un palier
 *    à la fois. Ça rend l'invariant « on ne monte que par une rampe » (spec R3) vrai *par
 *    construction* plutôt que par vérification, et c'est très alpin : **la porte dit qu'on
 *    monte.** Un seuil qui grimpe quatre paliers depuis les Prés Bas annonce, rien qu'en se
 *    montrant, que ce qu'il y a derrière n'est pas pour aujourd'hui.
 *
 * 3. **UNE ZONE EST UNE TERRASSE.** Un palier entier, plat. L'altitude cesse d'être un flottant
 *    qu'on soulève de trois pixels (illisible, et si fragile qu'une seed sur quatre repliait
 *    l'image et faisait planter le jeu). Elle devient un ENTIER, et la verticalité se voit.
 *
 * Pur et déterministe : `hash2`/`fbm2`, et `+ - * / sqrt` uniquement (invariant n°2).
 */
import {
  TERRAINS,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_BOULDERS,
  TERRAIN_BURNT_FOREST,
  TERRAIN_CLIFF,
  TERRAIN_DEEP_WATER,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_HEATH,
  TERRAIN_LARCH,
  TERRAIN_MARSH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PEAT_BOG,
  TERRAIN_PINE,
  TERRAIN_REED_MARSH,
  TERRAIN_ROCK,
  TERRAIN_SCREE,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_SNOW,
} from './balance'
import type { WorldMap, Zone as ZoneRect } from './map'
import { calibreLeFront, computeCendreField } from './cendre'
import { distSq } from './geometry'
import { placePois } from './poi'
import { fbm2, hash2 } from './noise'
import {
  catalogueFrontieres,
  deriveGrapheZones,
  echantillonAt,
  MONDE,
  PALIER_MAX,
  type GrapheZones,
} from './zonegraph'

/**
 * Constantes de FORME — contenu de carte, en tuiles ABSOLUES.
 *
 * ═══ TOUT EST RECTILIGNE (spec `worldgen.md` §2bis, décision d'Alexis du 2026-07-14) ═══
 *
 * La carte n'a plus une seule courbe. Zones, falaises, buttes, seuils, taches de terrain : des
 * rectangles et des polygones à angles droits. Et le geste qui produit ça tient en une phrase :
 *
 *   **LA ZONE SE DÉCIDE PAR BLOC, PAS PAR TUILE.**
 *
 * On interroge le diagramme de puissance UNE fois par bloc de 16 tuiles, en son centre. Toutes les
 * tuiles du bloc héritent du verdict. Une frontière de zone est donc, *par construction*, une
 * union d'arêtes de blocs — c'est-à-dire un polygone rectiligne. On n'a rien à redresser après
 * coup : la forme ne peut pas être courbe, il n'y a pas de représentation pour ça.
 *
 * Le domain warp du graphe SURVIT (les frontières serpentent toujours, en marches d'escalier) :
 * c'est la DÉCISION qui est quantifiée, pas le champ. On garde la variété, on perd les courbes.
 *
 * Et c'est vingt-cinq fois moins cher : neuf mille échantillons au lieu de deux millions et demi.
 */
export const RELIEF = {
  /**
   * LE BLOC — le quantum de toute forme de carte, en tuiles. 16 : la moitié d'un écran de large
   * (la caméra en montre 35). Assez gros pour que l'angle droit se VOIE et se lise comme un choix ;
   * assez petit pour qu'une frontière garde son dessin.
   */
  BLOC: 16,

  /**
   * LE MOTIF — le quantum des taches de TERRAIN (bosquets, accents), en tuiles. Plus fin que le
   * bloc : une forêt est un pavage de carrés de 8, pas une éclaboussure. C'est ce qui donne le
   * grain « pixel-art assumé » au sol sans le rendre illisible.
   */
  MOTIF: 8,

  /**
   * ═══ LA FALAISE EST UNE ARÊTE, ET ELLE FAIT UNE TUILE (spec R33) ═══
   *
   * Le bandeau de 44 tuiles a disparu. Il coûtait 16 % de la carte, il transformait chaque
   * frontière en no man's land rocheux, et il n'était là que parce que la falaise était *dérivée
   * d'un champ continu* (`marge < 22`) au lieu d'être ce qu'elle est : **le bord d'un plateau**.
   *
   * La falaise ne se peint plus. Elle se CONSTATE, par `murerLesAretes` :
   *
   *   **UNE ARÊTE EST UN MUR — SAUF ENTRE DEUX RAMPES.**
   *
   * Deux tuiles marchables voisines de paliers différents ? On mure la HAUTE : voilà le bord du
   * plateau, une tuile d'épaisseur, qu'on longe au pixel près. Deux zones voisines au MÊME palier ?
   * On mure aussi (un côté, déterministe) — sans quoi le seuil ne serait plus le seul passage et le
   * test destructif A5 deviendrait un mensonge.
   *
   * L'exemption « sauf entre deux rampes » est le pivot du système, et elle offre un cadeau : le
   * couloir d'un seuil, dont chaque tuile est une rampe, se retrouve **muré sur ses deux flancs par
   * la règle générale** — là où il longe une plaine d'un autre palier. *La gorge se creuse toute
   * seule.* On n'écrit pas une ligne pour ça.
   */

  /** Anneau bloquant au bord de la carte. La vallée est CLOSE : on n'en sort pas. */
  BORDURE: 12,

  /** Échelles du bruit qui sème le sol d'une zone — la variation qui la rend vivante sans la
   *  rendre illisible (spec R7 : une zone est un thème, reconnaissable en trois secondes). Elles
   *  ne s'échantillonnent plus par tuile mais par MOTIF : le bruit décide, le carré exécute. */
  ECHELLE_TERRAIN: 46,
  ECHELLE_TACHES: 120,

  // ══ LE SEUIL — un couloir DROIT, et un ESCALIER ═════════════════════════════════════════════
  //
  // Il n'a plus à traverser quarante-quatre tuiles de roche : l'arête est fine. Sa longueur ne se
  // paie donc plus en mètres, elle se paie en MARCHES (spec R33) — un palier à la fois, chacun sur
  // son palier de repos. Un seuil qui grimpe quatre paliers reste long ; un seuil de plain-pied est
  // une porte, et c'est très bien.
  //
  // Et il est DROIT, dans l'axe qui traverse vraiment la frontière (le méandre est mort avec les
  // courbes) : un rectangle. Ce qui en fait un chokepoint parfaitement lisible — on voit ses deux
  // parois à la fois, on sait qu'on est dans une porte.

  /** Demi-largeur du couloir d'un seuil. 7 → 14 tuiles de passage : une gorge qui tient dans la
   *  fenêtre de 35 tuiles du jeu. */
  DEMI_LARGEUR_SEUIL: 7,

  /** Longueur d'un PALIER DE REPOS dans l'escalier d'un seuil, en tuiles. Chaque marche a sa
   *  terrasse : c'est ce qui rend le dénivelé LISIBLE (on compte les marches en montant). */
  LONGUEUR_MARCHE: 14,

  /** Le couloir déborde dans chaque zone, au-delà de la dernière marche, pour déboucher
   *  franchement dans le pays au lieu de mourir contre son bord. */
  DEBORD_SEUIL: 20,

  /** Demi-largeur du couloir que la garde de connexité perce pour rouvrir une poche. 3 → 7 tuiles :
   *  on le voit, on le prend. (Seul reliquat des rampes de butte : la connexité en a encore besoin.) */
  DEMI_RAMPE: 3,

  // ══ PAS DE FALAISE À L'INTÉRIEUR D'UNE ZONE — décision d'Alexis, 2026-07-14 ═════════════════
  //
  // Les BUTTES (des mesas rectangulaires d'un palier plus haut, semées sur un treillis dans chaque
  // zone) ont existé une demi-journée, et elles sont retirées : *« tu peux retirer les falaises à
  // l'intérieur d'une zone, on gérera l'élévation intrazone plus tard, ne garde que les frontières
  // en falaises. »*
  //
  // **UNE ZONE EST DONC UNE TERRASSE PLATE, ENTIÈREMENT.** Toute la falaise de la carte est aux
  // frontières, et nulle part ailleurs.
  //
  // CE QUE ÇA COÛTE, ET IL FAUT LE DIRE : la garde A26 — *« depuis n'importe où, une paroi est à
  // moins de quatre écrans »* — n'était tenue QUE par les buttes. Sans elles, une zone fait six
  // cents tuiles de côté et la première falaise peut être à huit écrans. C'est exactement le grief
  // qui les avait fait naître (Alexis, sur la carte rendue : *« il n'y a aucune falaise alors que
  // c'était prévu — wtf ? »*). La garde est donc RETIRÉE, pas contournée : elle reviendra avec
  // l'élévation intrazone, et c'est elle qui dira si celle-ci est suffisante.
  //
  // Ce qui SURVIT du chantier : la rampe de seuil, l'arête déduite, et le fait qu'un dénivelé se
  // rende en marches. Le relief intrazone n'aura qu'à poser des paliers ; tout le reste suivra.

}

/**
 * ═══ LES BLOCS — la carte, vue de haut, une décision par bloc ═══
 *
 * C'est la seule chose qui rend la carte rectiligne, et c'est trois champs.
 */
export interface Blocs {
  cols: number
  rows: number
  /** L'id de zone du bloc — le verdict du diagramme de puissance en son centre. */
  zone: Int32Array
  /** La marge (distance à la frontière, en tuiles) au centre du bloc. Sert aux buttes et à la
   *  cendre : plus jamais à peindre une falaise. */
  marge: Float64Array
}

export function decouperEnBlocs(g: GrapheZones): Blocs {
  const B = RELIEF.BLOC
  const cols = Math.ceil(g.width / B)
  const rows = Math.ceil(g.height / B)
  const zone = new Int32Array(cols * rows)
  const marge = new Float64Array(cols * rows)
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const e = echantillonAt(g, bx * B + B / 2, by * B + B / 2)
      const k = by * cols + bx
      zone[k] = e.zone
      marge[k] = e.marge
    }
  }
  return { cols, rows, zone, marge }
}

/** L'index du bloc qui contient la tuile (x, y). Clampé : hors carte, on rend le bloc du bord. */
function blocDe(b: Blocs, x: number, y: number): number {
  const bx = Math.min(b.cols - 1, Math.max(0, Math.floor(x / RELIEF.BLOC)))
  const by = Math.min(b.rows - 1, Math.max(0, Math.floor(y / RELIEF.BLOC)))
  return by * b.cols + bx
}

/**
 * LE PALIER D'UNE ZONE — et il vient du GRAPHE, colorié.
 *
 * Il était tiré ici, par un hash sur l'id. C'était le mauvais endroit ET la mauvaise idée : deux
 * zones voisines pouvaient tirer le même palier, et leur frontière devenait un mur SANS HAUTEUR —
 * une clôture posée sur un sol plat (voir `colorerLesPaliers`, zonegraph.ts). Le palier n'est pas
 * une propriété d'une zone : c'est une propriété d'une zone **par rapport à ses voisines**. Il
 * appartient donc au graphe, et le terrain se contente de le lire.
 */
export function palierDe(g: GrapheZones, id: number): number {
  return g.paliers[id]!
}

/**
 * LA PALETTE D'UNE ZONE — ce qu'on a sous les pieds, et ce qui la fait reconnaître.
 *
 * `sol` domine ; `taches` s'y sème en bosquets basse fréquence ; `accent` est rare. La zone est
 * un THÈME, pas un biome : elle peut mêler des terrains tant qu'elle se lit en trois secondes.
 *
 * RÈGLE DE SÛRETÉ, non négociable : **le sol dominant d'une zone est toujours MARCHABLE.** Une
 * zone dont le fond bloque serait une zone où le seuil débouche sur un mur — et la garde de
 * connexité (A2) le dirait, mais trop tard : on l'aurait construite.
 */
interface Palette {
  sol: number
  taches: number
  accent: number
  /** Fréquence de l'accent, [0,1]. */
  rarete: number
  /**
   * LE SEUIL DES TACHES — plus il est HAUT, plus la zone est nue.
   *
   * Il valait 0,58 partout, et c'était une faute : `fbm2` a une moyenne de 0,5, donc **32 % de
   * chaque zone** se couvrait de ses taches. Les Prés Bas se retrouvaient boisés au tiers — ce
   * n'étaient plus des prés, c'était un bois clair, et le joueur naissait sous les arbres. Une
   * zone doit se reconnaître EN TROIS SECONDES : les Prés Bas se reconnaissent à leur CIEL.
   *
   * 0,68 → ~13 % de taches (des bosquets dans un pré). 0,45 → ~62 % (une futaie percée de
   * clairières). C'est ce chiffre qui décide si la zone est un couvert ou une étendue.
   */
  seuilTaches: number
}

const PALETTES: Record<string, Palette> = {
  // ── T0 : LA RACINE. Un PRÉ, pas un bois : on s'y reconnaît à son ciel. Des bosquets, pas une
  //    futaie — et pas une pierre qui menace.
  pres_bas: { sol: TERRAIN_GRASS, taches: TERRAIN_FOREST, accent: TERRAIN_FLOWER_MEADOW, rarete: 0.24, seuilTaches: 0.7 },

  // ── T1 : la ceinture. Chacune enseigne une leçon différente. ──
  // La Sylve est le CONTRAIRE des Prés Bas : un couvert fermé, percé de rares clairières.
  sylve: { sol: TERRAIN_OLD_GROWTH, taches: TERRAIN_FOREST, accent: TERRAIN_GRASS, rarete: 0.1, seuilTaches: 0.44 },
  karst: { sol: TERRAIN_SCREE, taches: TERRAIN_BOULDERS, accent: TERRAIN_ROCK, rarete: 0.14, seuilTaches: 0.55 },
  tourbiere: { sol: TERRAIN_PEAT_BOG, taches: TERRAIN_REED_MARSH, accent: TERRAIN_SHALLOW_WATER, rarete: 0.18, seuilTaches: 0.5 },
  alpages: { sol: TERRAIN_ALPINE_MEADOW, taches: TERRAIN_ALPINE_FLOWERS, accent: TERRAIN_SCREE, rarete: 0.14, seuilTaches: 0.6 },
  brule: { sol: TERRAIN_BURNT_FOREST, taches: TERRAIN_HEATH, accent: TERRAIN_BOULDERS, rarete: 0.1, seuilTaches: 0.62 },
  ruines: { sol: TERRAIN_HEATH, taches: TERRAIN_GRASS, accent: TERRAIN_BOULDERS, rarete: 0.16, seuilTaches: 0.58 },

  // ── T2 : les marges. ──
  cendriere: { sol: TERRAIN_BURNT_FOREST, taches: TERRAIN_BOULDERS, accent: TERRAIN_ROCK, rarete: 0.16, seuilTaches: 0.62 },
  glacier: { sol: TERRAIN_SNOW, taches: TERRAIN_SCREE, accent: TERRAIN_ROCK, rarete: 0.12, seuilTaches: 0.68 },
  aiguilles: { sol: TERRAIN_SCREE, taches: TERRAIN_BOULDERS, accent: TERRAIN_ROCK, rarete: 0.2, seuilTaches: 0.52 },
  gouffre: { sol: TERRAIN_BOULDERS, taches: TERRAIN_SCREE, accent: TERRAIN_ROCK, rarete: 0.18, seuilTaches: 0.5 },
  // Le Lac Mort : une eau trop claire. Le cœur est PROFOND (donc un mur — l'eau profonde ne se
  // nage pas, spec R5), et il est ceint de marais. On n'y entre pas, on en fait le tour — et
  // c'est très bien : sa case fantastique est réservée, on lui laisse sa forme.
  lac_mort: { sol: TERRAIN_MARSH, taches: TERRAIN_REED_MARSH, accent: TERRAIN_DEEP_WATER, rarete: 0.3, seuilTaches: 0.5 },
}

/** Le Névé : les hauteurs de la Tourbière et de la Sylve gardent leurs mélèzes et leurs pins —
 *  un thème n'est pas un aplat. On y reviendra à la passe d'ambiance. */
const HAUT_BOIS = [TERRAIN_PINE, TERRAIN_LARCH]

export interface CarteZonee {
  map: WorldMap
  graphe: GrapheZones
  /** Id de zone par tuile. C'est L'ÉTIQUETTE : les ressources, la faune et le climat la lisent. */
  zone: Int32Array
  /** Palier (entier) par tuile. */
  palier: Int32Array
  /** Cette tuile est-elle une rampe ? (le couloir d'un seuil) — l'exemption de l'invariant R3. */
  rampe: Uint8Array
}

/**
 * LA GÉNÉRATION — et l'ordre des passes EST le sujet.
 *
 * On ne PEINT plus les falaises : on les CONSTATE. C'est tout le renversement du rectiligne, et il
 * se lit dans l'ordre ci-dessous — le sol, le relief, les portes… **et le mur en dernier**, déduit
 * de ce que les trois premières ont sculpté. Une falaise n'est plus une décision : c'est une
 * conséquence.
 */
export function generateZonedTerrain(seed: number, joueurs = MONDE.JOUEURS_CIBLE): CarteZonee {
  const g = deriveGrapheZones(seed, joueurs)
  const { width, height } = g
  const N = width * height

  const terrain = new Array<number>(N).fill(TERRAIN_GRASS)
  const zone = new Int32Array(N)
  const palier = new Int32Array(N)
  const rampe = new Uint8Array(N)
  const paliers = g.zones.map((z) => palierDe(g, z.id))

  // ── LES BLOCS — une décision par bloc de 16 tuiles. C'est ici, et NULLE PART ailleurs, que la
  //    carte devient rectiligne : une frontière ne peut plus être qu'une union d'arêtes de blocs.
  const blocs = decouperEnBlocs(g)

  // ── PASSE 1 : les zones, les paliers, le sol de chacune. Pas une falaise. ─
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const z = blocs.zone[blocDe(blocs, x, y)]!
      zone[i] = z
      palier[i] = paliers[z]!
      terrain[i] = solDe(g, z, x, y)
    }
  }

  // ── PASSE 2 : les seuils — on perce tout droit, et ça MONTE, marche à marche ──
  for (const s of g.seuils) {
    percerSeuil(g, blocs, s, terrain, zone, palier, rampe, paliers, width, height)
  }

  // ── PASSE 3 : LES ARÊTES — le mur, DÉDUIT. Puis on garantit qu'on circule. ─
  //
  // Les deux se répondent, d'où les deux tours : murer peut couper une poche, et l'ouvrir peut
  // fabriquer une arête neuve là où le percement rase un plateau. Deux tours suffisent (mesuré :
  // le second n'ouvre plus rien), et on FINIT par la connexité — l'invariant qui ne se négocie pas
  // est « toute zone est atteignable » (A2), pas « pas une arête ne traîne » (A9 exempte les
  // rampes, qui sont précisément ce que le percement fabrique).

  for (let tour = 0; tour < 2; tour++) {
    murerLesAretes(terrain, zone, palier, rampe, width, height)
    garantirLaConnexite(g, terrain, zone, palier, rampe, width, height)
  }

  // ── PASSE 4 : l'anneau de bordure. La vallée est CLOSE ────────────────────
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= RELIEF.BORDURE && y >= RELIEF.BORDURE && x < width - RELIEF.BORDURE && y < height - RELIEF.BORDURE) {
        continue
      }
      const i = y * width + x
      terrain[i] = TERRAIN_CLIFF
      rampe[i] = 0
    }
  }

  /**
   * L'ALTITUDE, DÉRIVÉE DU PALIER — et elle survit exprès.
   *
   * Le palier ENTIER est désormais donnée de premier ordre de la carte (spec R36) : c'est lui que
   * le rendu soulève d'une marche, lui que la garde A9 lit. Mais « on est haut » reste une
   * SÉMANTIQUE continue pour la température (il fait froid en altitude) et pour les filtres de
   * lieux. On la redonne donc, dérivée : `palier / PALIER_MAX`. Une lecture, jamais un champ
   * indépendant qui pourrait diverger du terrain.
   */
  const elevation = new Array<number>(N)
  for (let i = 0; i < N; i++) elevation[i] = palier[i]! / PALIER_MAX

  /**
   * LE CHAMP DE CENDRE — la distance de chaque tuile à la frontière de la Cendrière.
   *
   * Dérivé du diagramme de puissance comme la marge des frontières, mais lu AU BLOC : le front
   * épouse donc la forme réelle de la Cendrière, angles droits compris. Il avance comme une MARÉE
   * — une marée rectiligne, qui prend la vallée bloc par bloc.
   *
   * C'est de la donnée STATIQUE : ce qui bouge est un scalaire dans le `SimState` (spec R31).
   */
  const cendriere = g.zones.find((z) => z.def.slug === 'cendriere')!
  const champCendre = computeCendreField(width, height, (x, y) => {
    const k = blocDe(blocs, x, y)
    const zid = blocs.zone[k]!
    const m = blocs.marge[k]!
    if (zid === cendriere.id) return -m // DEDANS : elle brûle depuis le premier jour
    // Dehors : la distance à la frontière de la Cendrière. Si le bloc ne la touche pas, on prend la
    // distance au site — une borne honnête, et le front s'arrête de toute façon bien avant.
    const e = echantillonAt(g, x, y)
    if (e.voisin === cendriere.id) return m
    return Math.sqrt(distSq(x, y, cendriere.x, cendriere.y))
  })

  // On vise une PART des Prés Bas (60 %), pas une distance : la forme des zones varie trop d'une
  // seed à l'autre pour qu'un nombre de tuiles fixe tienne la promesse. On calibre donc ICI.
  const cendreMax = calibreLeFront(champCendre, (i) => zone[i] === g.racine && rampe[i] === 0)

  /**
   * LA ZONE, POUR LE CLIENT — et elle est désormais EXACTE, gratuitement.
   *
   * Elle était grossière (pas de 4 tuiles, arrondi au plus proche) et son erreur — deux tuiles au
   * bord d'une zone — était réputée « invisible, elle tombe dans la bande de falaise de 44 tuiles ».
   * **Cet argument vient de mourir avec la bande.** Une erreur de deux tuiles sur une arête d'UNE
   * tuile se verrait comme le nez au milieu de la figure.
   *
   * Mais le rectiligne la rend gratuite : la zone est constante par BLOC. Une grille au pas du bloc,
   * lue au plancher, ne commet donc **aucune** erreur — elle rend la vérité, exactement. On paie
   * même seize fois moins de mémoire qu'avant.
   */
  const ZONE_PAS = RELIEF.BLOC
  const zoneGrid = new Array<number>(blocs.cols * blocs.rows)
  for (let k = 0; k < zoneGrid.length; k++) zoneGrid[k] = blocs.zone[k]!

  const map: WorldMap = {
    width, height, terrain, zones: toponymes(g), elevation, cendre: champCendre, cendreMax,
    palier: Array.from(palier),
    palierMax: PALIER_MAX,
    zoneGrid,
    zonePas: ZONE_PAS,
    zoneDefs: g.zones.map((z) => ({ slug: z.def.slug, nom: z.def.nom, tier: z.def.tier })),
  }
  const carte: CarteZonee = { map, graphe: g, zone, palier, rampe }

  // ── PASSE 5 : LES LIEUX — et ils ont désormais une ADRESSE ────────────────
  placePois(map, seed, (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return undefined
    return g.zones[zone[ty * width + tx]!]!.def.slug
  })

  return carte
}

/**
 * LE SOL D'UNE TUILE — le thème de sa zone, semé de bosquets et d'accents, et QUANTIFIÉ AU MOTIF.
 *
 * Le bruit ne décide plus tuile par tuile : il décide par carré de 8. Une forêt devient un pavage
 * de carrés, un affleurement de roche un rectangle. C'est le grain « pixel-art assumé » de la
 * nouvelle direction artistique — et c'est la même quantification que les zones, un cran plus fin.
 */
function solDe(g: GrapheZones, id: number, x: number, y: number): number {
  const z = g.zones[id]!
  const p = PALETTES[z.def.slug]!
  // Le centre du MOTIF qui contient la tuile : tout le carré partage son verdict.
  const M = RELIEF.MOTIF
  const mx = Math.floor(x / M) * M + M / 2
  const my = Math.floor(y / M) * M + M / 2
  const n = fbm2(mx, my, RELIEF.ECHELLE_TERRAIN, (g.seed ^ (id * 0x9e37)) | 0)
  const t = fbm2(mx, my, RELIEF.ECHELLE_TACHES, (g.seed ^ (id * 0x2545)) | 0)

  if (n < p.rarete) return p.accent
  if (t > p.seuilTaches) {
    // Les BOSQUETS. Dans les zones hautes, le bois qui pousse est un pin ou un mélèze — un
    // thème n'est pas un aplat.
    if (p.taches === TERRAIN_FOREST && z.def.tier > 0) {
      return HAUT_BOIS[Math.floor(hash2(mx, my, g.seed ^ 0x5b) * HAUT_BOIS.length)]!
    }
    return p.taches
  }
  return p.sol
}

/**
 * PERCER UN SEUIL — un couloir DROIT, et il MONTE marche à marche.
 *
 * ═══ CE QUI A CHANGÉ, ET POURQUOI C'EST PLUS SIMPLE ═══
 *
 * L'ancien couloir cherchait le sol de part et d'autre d'une bande de roche de 44 tuiles, creusait
 * en biais dans une direction théorique, serpentait au bruit, et se trompait — deux zones sont
 * devenues injoignables avant qu'il ne tienne. Toute cette complication venait d'une seule cause :
 * **il fallait traverser une ÉPAISSEUR**, et la frontière n'avait pas d'orientation connue.
 *
 * Avec l'arête fine et les blocs, la frontière a une orientation : c'est celle d'une **arête de
 * bloc**, donc un axe. On la lit (`axeDeTraversee`), on creuse un RECTANGLE dans cet axe, et on a
 * fini. Pas de méandre, pas de biais, pas de recherche de sol : un couloir droit qui traverse.
 *
 * ET C'EST UN ESCALIER. Le palier passe de celui de la zone `a` à celui de la zone `b`, une marche
 * à la fois, chacune sur son palier de repos de `LONGUEUR_MARCHE` tuiles. L'invariant « une rampe
 * ne relie que deux paliers consécutifs » (R3) est vrai *par construction*. Un seuil qui grimpe
 * quatre paliers ANNONCE, rien qu'en se montrant, ce qui l'attend derrière.
 *
 * Toutes les tuiles du couloir sont marquées `rampe` — ce qui les exempte de la règle « une arête
 * est un mur », qu'elles violent par métier. Leurs FLANCS, eux, ne sont pas exemptés : `murerLesAretes`
 * les mure partout où le couloir longe une plaine d'un autre palier. **La gorge se creuse seule.**
 */
function percerSeuil(
  g: GrapheZones,
  blocs: Blocs,
  s: { a: number; b: number; x: number; y: number },
  terrain: number[],
  zone: Int32Array,
  palier: Int32Array,
  rampe: Uint8Array,
  paliers: number[],
  width: number,
  height: number,
): void {
  const axe = axeDeTraversee(blocs, s, width, height)
  if (!axe) return
  const { ax, ay, versA, versB } = axe
  // La perpendiculaire — la largeur du couloir. En rectiligne, c'est l'autre axe, point final.
  const px = -ay
  const py = ax

  const pa = paliers[s.a]!
  const pb = paliers[s.b]!
  const marches = Math.abs(pb - pa)
  const sens = pb > pa ? 1 : -1

  // LA LONGUEUR SE PAIE EN MARCHES. Chaque palier de repos fait `LONGUEUR_MARCHE` tuiles ; le
  // couloir déborde ensuite dans chaque pays — et il déborde depuis SON SOL, pas depuis le point du
  // seuil : `versA`/`versB` disent où chaque pays commence vraiment. Sans ça, un seuil posé de
  // travers sur une marche d'escalier de la frontière mourrait dans le mur.
  const demi = Math.round((marches * RELIEF.LONGUEUR_MARCHE) / 2)
  const dos = versA + demi + RELIEF.DEBORD_SEUIL
  const face = versB + demi + RELIEF.DEBORD_SEUIL
  const L = RELIEF.DEMI_LARGEUR_SEUIL

  for (let t = -dos; t <= face; t++) {
    // L'ESCALIER : on répartit les marches sur la longueur, et les deux bouts raccordent EXACTEMENT
    // les paliers des deux zones — donc aucune marche ne traîne au bord, donc le couloir débouche
    // de plain-pied dans chaque pays (c'est ce qui l'empêche d'être muré par sa propre règle).
    const u = (t + dos) / (dos + face)
    const marche = marches === 0 ? 0 : Math.min(marches, Math.floor(u * (marches + 1)))
    const pal = pa + sens * marche
    // Le sol du couloir est celui de la zone vers laquelle on va : **la porte a déjà la couleur de
    // ce qu'elle garde.** On voit ce qui attend avant d'y être (spec R10.2).
    const vers = u < 0.5 ? s.a : s.b

    for (let w = -L; w <= L; w++) {
      const x = s.x + ax * t + px * w
      const y = s.y + ay * t + py * w
      if (x < RELIEF.BORDURE || y < RELIEF.BORDURE || x >= width - RELIEF.BORDURE || y >= height - RELIEF.BORDURE) {
        continue
      }
      const i = y * width + x
      // ON DÉGAGE TOUT CE QUI BLOQUE — pas seulement la falaise. Un rocher (l'accent bloquant d'une
      // zone) tombé au milieu du passage boucherait la porte. **Une porte est une porte.**
      if (TERRAINS[terrain[i]!]?.walkable !== true) {
        terrain[i] = solMarchableDe(g, vers, x, y)
        zone[i] = vers
      }
      palier[i] = pal
      rampe[i] = 1
    }
  }
}

/**
 * ═══ L'AXE QUI TRAVERSE VRAIMENT LA FRONTIÈRE — et la faute qu'il a fallu deux gardes pour voir ═══
 *
 * Un couloir rectiligne n'a qu'une question à poser : *dans quel sens est l'autre zone ?* La
 * première réponse était naïve — « la direction où je trouve la zone `b` le plus vite ». Elle a un
 * angle mort, et il est fatal :
 *
 * **Le point d'un seuil est POSÉ SUR la frontière.** Le bloc qui le contient appartient donc à `a`
 * ou à `b`, et c'est un coup de dé. S'il tombe côté `b`, on trouve `b` à une tuile dans les QUATRE
 * directions — et l'on choisit la première venue, c'est-à-dire l'est. Le couloir se creuse alors
 * **le long du mur**, entièrement dans `b`, et il ne relie rien du tout.
 *
 * Ça n'a pas fait tomber la garde de connexité, et c'est le plus inquiétant : **le tunnel d'accès
 * d'un lieu rebouchait le trou par accident** (il perçait la frontière d'une tuile — voir
 * `carveDistanceToMain`). La carte tenait par un bug. En interdisant ce tunnel, le Gouffre est
 * devenu injoignable — et la vraie faute, tapie dessous depuis le début, est enfin apparue.
 * *Une garde verte pour la mauvaise raison est pire qu'une garde rouge.*
 *
 * On cherche donc l'axe qui SÉPARE : celui où l'on trouve `a` d'un côté et `b` de l'autre, au plus
 * court. Le vecteur rendu pointe de `a` VERS `b`, et il porte les distances aux deux pays — de quoi
 * garantir que le couloir débouche pour de bon des deux bouts, quelle que soit la marche
 * d'escalier que la frontière dessine à cet endroit.
 */
interface Traversee {
  ax: number
  ay: number
  /** Distance (tuiles) au sol de `a`, en reculant. */
  versA: number
  /** Distance (tuiles) au sol de `b`, en avançant. */
  versB: number
}

function axeDeTraversee(
  blocs: Blocs,
  s: { a: number; b: number; x: number; y: number },
  width: number,
  height: number,
): Traversee | null {
  const PORTEE = 24 * RELIEF.BLOC
  // La distance au premier bloc de la zone `z`, en partant du seuil dans la direction (dx, dy).
  const distA = (dx: number, dy: number, z: number): number => {
    for (let d = 0; d <= PORTEE; d++) {
      const x = s.x + dx * d
      const y = s.y + dy * d
      if (x < 0 || y < 0 || x >= width || y >= height) break
      if (blocs.zone[blocDe(blocs, x, y)] === z) return d
    }
    return Infinity
  }

  let best: Traversee | null = null
  let bestCout = Infinity
  for (const [ax, ay] of [[1, 0], [0, 1]] as const) {
    // Les deux orientations de l'axe : `b` devant et `a` derrière, ou l'inverse.
    for (const sens of [1, -1] as const) {
      const dx = ax * sens
      const dy = ay * sens
      const versB = distA(dx, dy, s.b)
      const versA = distA(-dx, -dy, s.a)
      const cout = versA + versB
      if (cout < bestCout) { bestCout = cout; best = { ax: dx, ay: dy, versA, versB } }
    }
  }
  return best && Number.isFinite(bestCout) ? best : null
}

/** Le sol d'une zone, mais GARANTI marchable : dans un couloir de seuil, l'accent bloquant
 *  d'une zone (le rocher, l'eau profonde) n'a rien à faire — il boucherait la porte. */
function solMarchableDe(g: GrapheZones, id: number, x: number, y: number): number {
  const t = solDe(g, id, x, y)
  if (TERRAINS[t]?.walkable === true) return t
  return PALETTES[g.zones[id]!.def.slug]!.sol
}

/**
 * LES TOPONYMES — de PETITES étiquettes au cœur de chaque zone, pas des rectangles qui la
 * couvriraient. `zoneAt` rend la PREMIÈRE zone contenant le point : une étiquette à la taille
 * du pays masquerait tous les lieux qu'il contient (on survolerait une Grotte et on lirait
 * « le Karst »). Un nom de zone est une étiquette d'état-major, posée en son centre.
 *
 * Et les SEUILS en portent un aussi : ils ont un nom, et ils se montrent.
 */
function toponymes(g: GrapheZones): ZoneRect[] {
  const out: ZoneRect[] = []
  const r = 7
  for (const z of g.zones) {
    out.push({
      name: z.def.nom,
      x: Math.max(0, Math.min(g.width - 2 * r - 1, Math.round(z.x) - r)),
      y: Math.max(0, Math.min(g.height - 2 * r - 1, Math.round(z.y) - r)),
      w: 2 * r + 1,
      h: 2 * r + 1,
    })
  }
  const rs = 5
  for (const s of g.seuils) {
    const vers = g.zones[s.b]!
    out.push({
      name: s.secours ? `l'autre passage vers ${vers.def.nom}` : `le seuil de ${vers.def.nom}`,
      x: Math.max(0, Math.min(g.width - 2 * rs - 1, s.x - rs)),
      y: Math.max(0, Math.min(g.height - 2 * rs - 1, s.y - rs)),
      w: 2 * rs + 1,
      h: 2 * rs + 1,
    })
  }
  return out
}

/** Le catalogue des frontières, réexporté : les tests destructifs en ont besoin pour reboucher
 *  les seuils et vérifier qu'une zone devient bien une île (A5). */
export { catalogueFrontieres, deriveGrapheZones, PALIER_MAX }

/**
 * ═══ MURER LES ARÊTES — LA FALAISE, DÉDUITE ═══
 *
 * **UNE ARÊTE EST UN MUR — SAUF ENTRE DEUX RAMPES.** Toute la topologie du monde tient dans cette
 * phrase, et c'est le cœur du rectiligne (spec R33).
 *
 * Ce qu'on ne fait plus : peindre une bande de falaise de 44 tuiles là où un champ continu
 * descendait sous un seuil. Ça coûtait 16 % de la carte, ça noyait chaque frontière dans un no
 * man's land rocheux, et ça n'avait qu'une raison d'être — la falaise était *dérivée d'un champ*
 * au lieu d'être ce qu'elle est : **le bord d'un plateau**.
 *
 * Deux cas, et un seul geste :
 *
 *   1. **PALIERS DIFFÉRENTS** → on mure la tuile HAUTE. La basse reste le chemin : on ne coupe pas
 *      la plaine, on pose une lèvre au bord du plateau. C'est ce qui se longe, et c'est ce que le
 *      client dessine en marche.
 *   2. **MÊME PALIER, ZONES DIFFÉRENTES** → on mure quand même, d'un côté (le plus grand id :
 *      déterministe, donc une ligne d'UNE tuile, jamais deux). Sans ce cas, deux zones de même
 *      palier auraient une frontière ouverte — le seuil ne serait plus le seul passage, et le test
 *      destructif A5 deviendrait un mensonge.
 *
 * L'EXEMPTION EST LE PIVOT, et elle rend un service qu'on n'a pas eu à écrire : les flancs d'un
 * couloir de seuil ne sont *pas* exemptés (une seule de leurs deux tuiles est une rampe), donc le
 * cas 1 les mure partout où le couloir longe une plaine plus basse. **La gorge se creuse toute
 * seule.** Idem pour la brèche d'une butte : dedans-dehors, deux rampes, elle reste ouverte ; tout
 * le reste du bord, une rampe et une plaine, se mure.
 */
function murerLesAretes(
  terrain: number[],
  zone: Int32Array,
  palier: Int32Array,
  rampe: Uint8Array,
  width: number,
  height: number,
): void {
  const aMurer: number[] = []
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x
      if (TERRAINS[terrain[i]!]?.walkable !== true) continue
      for (const j of [i + 1, i + width]) {
        if (TERRAINS[terrain[j]!]?.walkable !== true) continue
        if (rampe[i] && rampe[j]) continue // un escalier a le droit de monter : c'est son métier
        if (palier[i] !== palier[j]) {
          aMurer.push(palier[i]! > palier[j]! ? i : j) // la LÈVRE, au bord du plateau
        } else if (zone[i] !== zone[j]) {
          aMurer.push(zone[i]! > zone[j]! ? i : j) // la frontière plate — sinon A5 ment
        }
      }
    }
  }
  for (const i of aMurer) terrain[i] = TERRAIN_CLIFF
}

/**
 * LA CONNEXITÉ, GARANTIE — et non plus espérée.
 *
 * Dernière passe. On inonde depuis la racine ; toute POCHE marchable de taille conséquente qui
 * n'est pas atteinte se voit percer un passage jusqu'au monde.
 *
 * POURQUOI ELLE EXISTE, ET POURQUOI ELLE EST HONNÊTE. Les buttes, leurs parois, leurs rampes, les
 * couloirs de seuil et les accents bloquants des palettes se rencontrent de mille façons ; chaque
 * fois qu'on croit avoir couvert les cas, il en reste un. Mesuré : **47 % du Glacier** se
 * retrouvait prisonnier, et trois réécritures de la recherche de rampe n'y ont rien changé — le
 * signe qu'on raisonnait sur la mauvaise cause.
 *
 * On cesse donc de raisonner par cas. On CONSTATE ce qui est coupé, et on l'ouvre. C'est le même
 * geste que `connectivity.ts` faisait déjà pour les lieux — à ceci près qu'ici on ne peut pas se
 * contenter d'écarter le point : une moitié de zone n'est pas un lieu qu'on déplace.
 *
 * DEUX GARDE-FOUS, ET ILS SONT LA RAISON POUR LAQUELLE ÇA NE CASSE RIEN :
 *
 *   • **On ne perce QUE dans la zone de la poche.** Jamais à travers une frontière — sans quoi on
 *     ouvrirait une porte dérobée dans une falaise de frontière, et tout le test destructif (A5,
 *     « on bouche les seuils, la zone devient une île ») deviendrait un mensonge.
 *   • **On ignore les poches minuscules** (< `POCHE_MIN`). Une clairière de trente tuiles au cœur
 *     d'un massif n'est pas un défaut : c'est du décor. La spec le dit depuis juillet — *« marchable
 *     n'est pas atteignable »*, et c'est très bien ainsi.
 */
const POCHE_MIN = 150

function garantirLaConnexite(
  g: GrapheZones,
  terrain: number[],
  zone: Int32Array,
  palier: Int32Array,
  rampe: Uint8Array,
  width: number,
  height: number,
): void {
  const N = width * height
  const walk = (i: number): boolean => TERRAINS[terrain[i]!]?.walkable === true

  const inonder = (depart: number): Uint8Array => {
    const vu = new Uint8Array(N)
    if (!walk(depart)) return vu
    vu[depart] = 1
    const file = [depart]
    for (let h = 0; h < file.length; h++) {
      const i = file[h]!
      const x = i % width
      const y = (i - x) / width
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (vu[j] || !walk(j)) continue
        vu[j] = 1
        file.push(j)
      }
    }
    return vu
  }

  // Le MONDE : la composante de la racine.
  let depart = -1
  for (let i = 0; i < N && depart < 0; i++) {
    if (zone[i] === g.racine && walk(i) && !rampe[i]) depart = i
  }
  if (depart < 0) return
  let monde = inonder(depart)

  // Les poches, une par une. On répète : ouvrir une poche peut en révéler une autre derrière.
  for (let passe = 0; passe < 6; passe++) {
    const vues = new Uint8Array(N)
    let ouvert = false

    for (let i0 = 0; i0 < N; i0++) {
      if (monde[i0] || vues[i0] || !walk(i0)) continue
      // Une poche : on la relève.
      const poche: number[] = [i0]
      vues[i0] = 1
      for (let h = 0; h < poche.length; h++) {
        const i = poche[h]!
        const x = i % width
        const y = (i - x) / width
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (vues[j] || !walk(j) || monde[j]) continue
          vues[j] = 1
          poche.push(j)
        }
      }
      if (poche.length < POCHE_MIN) continue // du décor, pas un défaut

      if (percerVersLeMonde(g, poche, monde, terrain, zone, palier, rampe, width, height)) ouvert = true
    }

    if (!ouvert) break
    monde = inonder(depart)
  }
}

/**
 * Ouvrir une poche : un parcours en largeur DEPUIS la poche, à travers le bloquant, jusqu'à la
 * première tuile du monde — **en restant dans la zone de la poche**. Puis on creuse le chemin.
 *
 * Rend `false` si aucun chemin n'existe sans sortir de la zone : la poche reste alors close, et
 * c'est la bonne réponse — on ne perce jamais une frontière (voir `garantirLaConnexite`).
 */
function percerVersLeMonde(
  g: GrapheZones,
  poche: readonly number[],
  monde: Uint8Array,
  terrain: number[],
  zone: Int32Array,
  palier: Int32Array,
  rampe: Uint8Array,
  width: number,
  height: number,
): boolean {
  const N = width * height
  const zid = zone[poche[0]!]!
  const parent = new Map<number, number>()
  const vu = new Uint8Array(N)
  const file: number[] = []
  for (const i of poche) { vu[i] = 1; file.push(i) }

  let arrivee = -1
  for (let h = 0; h < file.length && arrivee < 0; h++) {
    const i = file[h]!
    const x = i % width
    const y = (i - x) / width
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < RELIEF.BORDURE || ny < RELIEF.BORDURE || nx >= width - RELIEF.BORDURE || ny >= height - RELIEF.BORDURE) {
        continue
      }
      const j = ny * width + nx
      if (vu[j]) continue
      // ON NE SORT PAS DE LA ZONE. C'est ce qui garantit qu'on ne perce jamais une frontière —
      // donc que le test destructif (A5) reste vrai.
      if (zone[j] !== zid) continue
      vu[j] = 1
      parent.set(j, i)
      if (monde[j]) { arrivee = j; break }
      file.push(j)
    }
  }
  if (arrivee < 0) return false

  // Le chemin, remonté, creusé en RAMPE : il traverse une paroi, donc il monte ou descend.
  const chemin: number[] = []
  for (let i: number | undefined = arrivee; i !== undefined; i = parent.get(i)) chemin.push(i)

  /**
   * ═══ UNE POCHE QU'ON NE REJOINT QU'EN GRIMPANT QUATRE PALIERS N'EST PAS UNE POCHE ═══
   *
   * C'est un DÉBRIS — et il a fallu deux diagnostics pour le voir.
   *
   * Le raccord posait deux paliers d'un coup (`k < moitié ? bas : haut`) : deux tuiles de rampe
   * voisines à deux crans d'écart, un mur qu'on escalade de plain-pied. La garde A10 l'a dit.
   * Répartir les marches sur la longueur du chemin n'a rien réglé, et **rallonger le chemin dans la
   * poche a TRIPLÉ la faute** — un couloir qui serpente et qu'on élargit de trois tuiles se replie
   * sur lui-même : deux tuiles voisines à l'écran, mais à huit crans l'une de l'autre le long du
   * chemin. On soignait un symptôme avec l'outil qui l'aggrave.
   *
   * LA CAUSE, elle, est géométrique : **ces poches sont des bouts de COULOIR DE SEUIL**, sectionnés
   * par leurs propres flancs quand `murerLesAretes` les a murés. Un fragment d'escalier, donc au
   * palier de la zone d'EN FACE (jusqu'à 5), échoué dans une plaine au palier 1. Lui bâtir un
   * escalier de quatre marches dans cent cinquante tuiles, c'est demander l'impossible à la
   * géométrie — et la géométrie répond en sautant des marches.
   *
   * On cesse donc de le demander. Un fragment à deux paliers ou plus du monde **devient de la
   * roche**. On ne perd rien (c'était un morceau de porte que personne ne pouvait atteindre), on
   * gagne un invariant vrai par construction, et le rendu y gagne un éperon rocheux de plus.
   *
   * Les vraies poches — une part de zone qu'une butte a coupée — sont, elles, à UN palier du monde :
   * elles se rouvrent par une rampe, et c'est exactement ce qu'une rampe sait faire.
   */
  const r = RELIEF.DEMI_RAMPE
  const palBas = palier[arrivee]!
  const palHaut = palier[chemin[chemin.length - 1]!]!
  const marches = Math.abs(palHaut - palBas)
  const sens = palHaut > palBas ? 1 : -1

  if (marches > 1) {
    for (const i of poche) terrain[i] = TERRAIN_CLIFF
    return true // on a bel et bien changé la carte : la passe suivante doit rejouer l'inondation
  }

  for (let k = 0; k < chemin.length; k++) {
    const c = chemin[k]!
    const cx = c % width
    const cy = (c - cx) / width
    // `chemin` remonte de l'ARRIVÉE (le monde) vers la poche : k va donc du bas vers le haut. Une
    // seule marche à franchir (les autres cas sont devenus de la roche) : elle tombe à mi-chemin.
    const pal = k < chemin.length / 2 ? palBas : palBas + sens * marches
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < RELIEF.BORDURE || y < RELIEF.BORDURE || x >= width - RELIEF.BORDURE || y >= height - RELIEF.BORDURE) {
          continue
        }
        const i = y * width + x
        if (zone[i] !== zid) continue // on ne déborde jamais chez le voisin
        if (TERRAINS[terrain[i]!]?.walkable !== true) terrain[i] = solMarchableDe(g, zid, x, y)
        palier[i] = pal
        rampe[i] = 1
      }
    }
  }
  return true
}
