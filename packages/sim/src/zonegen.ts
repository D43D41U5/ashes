/**
 * LE TERRAIN — le graphe devient un monde.
 *
 * Ce fichier ne DÉCIDE rien : il OBÉIT au graphe (`zonegraph.ts`). C'est tout le sens du
 * renversement (spec `worldgen.md` §1) — l'ancienne vallée dérivait sa structure de son
 * terrain (un champ d'altitude concentrique, puis des bandes de biome). On dérive désormais le
 * terrain de la structure. Un plan d'abord ; des cailloux ensuite.
 *
 * ═══ LES TROIS GESTES — et la carte est PLATE (façon RimWorld) ═══
 *
 * 1. **LA FALAISE EST LA FRONTIÈRE.** Là où deux zones se touchent, on lève un mur — une bande de
 *    ROCHE PLATE d'une tuile, infranchissable (façon montagne RimWorld). Pas de hauteur : c'est un
 *    mur qu'on longe, pas une paroi qu'on domine. `murerLesAretes` la CONSTATE, il ne la peint pas.
 *
 * 2. **LE SEUIL EST LE GOULOT.** Le couloir percé dans la falaise est le SEUL passage d'une zone à
 *    l'autre — un chokepoint plat, droit, parfaitement lisible : on voit ses deux parois à la fois,
 *    on sait qu'on est dans une porte. Rien ne monte ; on entre, simplement.
 *
 * 3. **UNE ZONE EST UNE RÉGION PLATE.** Un pays d'un seul tenant, reconnaissable à sa PALETTE de
 *    sol (spec R7 : un thème, pas une altitude). C'est la couleur, pas la hauteur, qui distingue la
 *    Vieille Sylve du Versant Brûlé (`zone-ambiance.ts` la module encore côté client).
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
import { isWater, MARCHABLE, type WorldMap, type Zone as ZoneRect } from './map'
import { calibreLeFront, computeCendreField } from './cendre'
import { distSq } from './geometry'
import { placeCharniers, placePois } from './poi'
import { densiteDeBase } from './morts'
import { fbm2, hash2 } from './noise'
import { masqueDesSeuils, paintWaterRacine } from './zonegen-water'
import { assainirLeProfondHorsRacine, peindreLesEauxDesZones } from './zonegen-eaux-zones'
import {
  CREUX,
  celluleDe,
  coifferLesCretes,
  composerLHumidite,
  mesurerLaDistanceALEau,
  seuilParQuantile,
  vegetationAt,
  type Creux,
} from './racine-relief'
import { batirLeSocle, type Socle } from './socle'
import { forcerLesGues, tracerLesSentes } from './zonegen-sentes'
import { placerLesSetPieces } from './zonegen-setpieces'
import {
  deriveGrapheZones,
  echantillonAt,
  MONDE,
  voisinAt,
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
   * ═══ LA FALAISE EST UNE ARÊTE, ET ELLE FAIT UNE TUILE ═══
   *
   * Le bandeau de 44 tuiles a disparu. Il coûtait 16 % de la carte, il transformait chaque
   * frontière en no man's land rocheux, et il n'était là que parce que la falaise était *dérivée
   * d'un champ continu* (`marge < 22`) au lieu d'être ce qu'elle est : **le mur entre deux pays**.
   *
   * La falaise ne se peint plus. Elle se CONSTATE, par `murerLesAretes` :
   *
   *   **UNE ARÊTE INTER-ZONES EST UN MUR — SAUF SUR UN SEUIL.**
   *
   * Deux tuiles marchables voisines de zones différentes ? On en mure une (un côté, déterministe) :
   * une ligne de ROCHE PLATE d'une tuile — sans quoi le seuil ne serait plus le seul passage et le
   * test destructif A5 deviendrait un mensonge. Pas de hauteur : c'est un mur qu'on longe.
   *
   * L'exemption « sauf sur un seuil » est le pivot du système, et elle offre un cadeau : le couloir
   * d'un seuil, dont chaque tuile est marquée `rampe`, reste ouvert au milieu du mur ; ses FLANCS,
   * eux (une tuile de couloir contre une tuile d'une autre zone), se murent par la règle générale.
   * *Le goulot se creuse tout seul.* On n'écrit pas une ligne pour ça.
   */

  /** Anneau bloquant au bord de la carte. La vallée est CLOSE : on n'en sort pas. */
  BORDURE: 12,

  /** Échelles du bruit qui sème le sol d'une zone — la variation qui la rend vivante sans la
   *  rendre illisible (spec R7 : une zone est un thème, reconnaissable en trois secondes). Elles
   *  ne s'échantillonnent plus par tuile mais par MOTIF : le bruit décide, le carré exécute. */
  ECHELLE_TERRAIN: 46,
  ECHELLE_TACHES: 120,

  // ══ LE SEUIL — un couloir DROIT et PLAT ═════════════════════════════════════════════════════
  //
  // Il n'a plus à traverser quarante-quatre tuiles de roche : l'arête est fine. Et il ne MONTE plus
  // (la carte est plate) — c'est un simple corridor percé dans le mur de frontière, de longueur
  // FIXE, débouchant de part et d'autre dans le pays.
  //
  // Il est DROIT, dans l'axe qui traverse vraiment la frontière (le méandre est mort avec les
  // courbes) : un rectangle. Ce qui en fait un chokepoint parfaitement lisible — on voit ses deux
  // parois à la fois, on sait qu'on est dans une porte.

  /** Demi-largeur du couloir d'un seuil. 7 → 14 tuiles de passage : une gorge qui tient dans la
   *  fenêtre de 35 tuiles du jeu. */
  DEMI_LARGEUR_SEUIL: 7,

  /** Demi-longueur du couloir plat d'un seuil, en tuiles : il déborde d'autant de chaque côté de la
   *  frontière pour déboucher FRANCHEMENT dans le pays au lieu de mourir contre son mur. */
  DEBORD_SEUIL: 20,

  // ── R11 : LE SECOND PASSAGE EST TOUJOURS PIRE ──────────────────────────────────────
  // La spec le promet depuis le début, le drapeau `secours` était CALCULÉ (`marquerLesSecours`)
  // et affiché dans un toponyme — mais jamais rendu en géométrie : les seize seuils étaient le
  // même rectangle. Un secours devient donc un DÉFILÉ : plus étroit (on s'y engage sans pouvoir
  // se déployer) et plus long (on y reste exposé plus longtemps). Aucun tirage : deux constantes.
  /** Demi-largeur d'un seuil de SECOURS. 4 → 9 tuiles au lieu de 15 : une gorge, pas une porte. */
  DEMI_LARGEUR_SECOURS: 4,
  /** Demi-longueur d'un seuil de SECOURS. 36 au lieu de 20 : la traversée dure, et se mérite. */
  DEBORD_SECOURS: 36,

  /** Demi-largeur du couloir plat que la garde de connexité perce pour rouvrir une poche isolée.
   *  3 → 7 tuiles : on le voit, on le prend. */
  DEMI_RAMPE: 3,

  // ══ UNE ZONE EST UNE RÉGION PLATE, ENTIÈREMENT ═════════════════════════════════════════════
  //
  // Pas de falaise à l'intérieur d'une zone, pas de butte, pas de terrasse : un pays d'un seul
  // tenant, à plat. Toute la roche-mur de la carte est aux FRONTIÈRES (le seul mur qui sépare deux
  // pays) et à l'anneau de bordure — nulle part ailleurs. Une zone se distingue de sa voisine par
  // sa PALETTE de sol (`solDe`), pas par une hauteur.

}

/**
 * ═══ LES BLOCS — la carte, vue de haut, une décision par bloc ═══
 *
 * C'est la seule chose qui rend la carte rectiligne, et c'est trois champs.
 */
export interface Blocs {
  cols: number
  rows: number
  /** L'id de RÉGION du bloc — ou la plus proche, si le bloc est dans le vide. */
  zone: Int32Array
  /** La marge au centre du bloc (distance au bord de sa région). */
  marge: Float64Array
  /** LE BLOC EST-IL DANS LA CREVASSE ? 1 = oui. C'est la question neuve du non-pavage. */
  vide: Uint8Array
}

export function decouperEnBlocs(g: GrapheZones): Blocs {
  const B = RELIEF.BLOC
  const cols = Math.ceil(g.width / B)
  const rows = Math.ceil(g.height / B)
  const zone = new Int32Array(cols * rows)
  const marge = new Float64Array(cols * rows)
  const vide = new Uint8Array(cols * rows)
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const e = echantillonAt(g, bx * B + B / 2, by * B + B / 2)
      const k = by * cols + bx
      zone[k] = e.zone
      marge[k] = e.marge
      vide[k] = e.vide ? 1 : 0
    }
  }
  return { cols, rows, zone, marge, vide }
}

/** L'index du bloc qui contient la tuile (x, y). Clampé : hors carte, on rend le bloc du bord. */
function blocDe(b: Blocs, x: number, y: number): number {
  const bx = Math.min(b.cols - 1, Math.max(0, Math.floor(x / RELIEF.BLOC)))
  const by = Math.min(b.rows - 1, Math.max(0, Math.floor(y / RELIEF.BLOC)))
  return by * b.cols + bx
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
/** Où une matière se pose, quand elle est DÉRIVÉE du socle (spec stratigraphie S-R10). */
type SelonLeChamp = 'humide' | 'sec' | 'haut' | 'bas'

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
  /**
   * ═══ LE SOL DÉRIVÉ (spec stratigraphie S-R10) — la zone lit le SOCLE au lieu de deux bruits ═══
   *
   * Si `partTaches` est déclaré, la zone quitte le tirage à deux bruits indépendants : ses
   * taches se posent dans la BANDE du champ (`tachesSelon` : l'humide, le sec, le haut, le bas),
   * découpée par QUANTILE PAR ZONE pour que la part soit un CONTRAT sur toute seed (le patron
   * `seuilParQuantile`). Idem pour l'accent. Les parts ci-dessous sont les parts EMPIRIQUES
   * mesurées sur l'ancien tirage (3 seeds, 2026-08-09) : la composition de chaque zone est
   * PRÉSERVÉE — seul l'ORDRE change. Ce qui se lit comme logique est DÉRIVÉ.
   *
   * Sans `partTaches` : le chemin historique (les Prés Bas, repeints de toute façon par leurs
   * propres passes ; le Névé, qui est de la neige quel que soit le chemin).
   */
  partTaches?: number
  tachesSelon?: SelonLeChamp
  partAccent?: number
  accentSelon?: SelonLeChamp
}

const PALETTES: Record<string, Palette> = {
  // ── T0 : LA RACINE. Un PRÉ, pas un bois : on s'y reconnaît à son ciel. Des bosquets, pas une
  //    futaie — et pas une pierre qui menace.
  pres_bas: { sol: TERRAIN_GRASS, taches: TERRAIN_FOREST, accent: TERRAIN_FLOWER_MEADOW, rarete: 0.24, seuilTaches: 0.7 },

  // ── T1 : la ceinture. Chacune enseigne une leçon différente. ──
  // La Sylve est le CONTRAIRE des Prés Bas : un couvert fermé, percé de rares clairières.
  // Dérivée : la vieille futaie tient les FONDS humides, pin et mélèze prennent les hauteurs
  // sèches, les clairières s'ouvrent sur le sec — la forêt raconte son eau.
  sylve: { sol: TERRAIN_OLD_GROWTH, taches: TERRAIN_FOREST, accent: TERRAIN_GRASS, rarete: 0.1, seuilTaches: 0.44, partTaches: 0.6, tachesSelon: 'haut', partAccent: 0.015, accentSelon: 'sec' },
  // Le Karst : les affleurements couronnent les dos, l'éboulis tapisse le reste.
  karst: { sol: TERRAIN_SCREE, taches: TERRAIN_BOULDERS, accent: TERRAIN_ROCK, rarete: 0.14, seuilTaches: 0.55, partTaches: 0.32, tachesSelon: 'haut', partAccent: 0.02, accentSelon: 'haut' },
  // La Tourbière : la roselière suit l'HUMIDE — et l'eau libre (couche II, `zonegen-eaux-zones`)
  // arrive exactement là où la roselière l'annonce : deux lectures du même champ. L'accent d'eau
  // POSÉ est mort (S-R9) : ses mares sont désormais des cuvettes inondées, avec rive et drainage.
  tourbiere: { sol: TERRAIN_PEAT_BOG, taches: TERRAIN_REED_MARSH, accent: TERRAIN_SHALLOW_WATER, rarete: 0.18, seuilTaches: 0.5, partTaches: 0.54, tachesSelon: 'humide' },
  // Les Alpages : les combes humides fleurissent, l'éboulis couronne.
  alpages: { sol: TERRAIN_ALPINE_MEADOW, taches: TERRAIN_ALPINE_FLOWERS, accent: TERRAIN_SCREE, rarete: 0.14, seuilTaches: 0.6, partTaches: 0.285, tachesSelon: 'humide', partAccent: 0.02, accentSelon: 'haut' },
  // Le Versant Brûlé : la lande REPREND par les creux humides — la première esquisse de la
  // succession (couche IV) : là où l'eau stagne, la vie revient d'abord.
  brule: { sol: TERRAIN_BURNT_FOREST, taches: TERRAIN_HEATH, accent: TERRAIN_BOULDERS, rarete: 0.1, seuilTaches: 0.62, partTaches: 0.27, tachesSelon: 'humide', partAccent: 0.014, accentSelon: 'haut' },
  ruines: { sol: TERRAIN_HEATH, taches: TERRAIN_GRASS, accent: TERRAIN_BOULDERS, rarete: 0.16, seuilTaches: 0.58, partTaches: 0.27, tachesSelon: 'humide', partAccent: 0.018, accentSelon: 'haut' },

  // ── T2 : les marges. ──
  cendriere: { sol: TERRAIN_BURNT_FOREST, taches: TERRAIN_BOULDERS, accent: TERRAIN_ROCK, rarete: 0.16, seuilTaches: 0.62, partTaches: 0.264, tachesSelon: 'haut', partAccent: 0.027, accentSelon: 'haut' },
  glacier: { sol: TERRAIN_SNOW, taches: TERRAIN_SCREE, accent: TERRAIN_ROCK, rarete: 0.12, seuilTaches: 0.68, partTaches: 0.176, tachesSelon: 'haut', partAccent: 0.024, accentSelon: 'haut' },

  // ── LE NÉVÉ BLANC — un SEUIL, pas une zone. Il ne nourrit rien (spec R10.3) ──
  //
  // De la neige, et RIEN d'autre. Pas un accent (`rarete: 0` : jamais), presque pas de taches. C'est
  // délibérément le sol le plus PAUVRE de la carte — et c'est ce qui fait de lui une porte plutôt
  // qu'un pays : *on ne campe pas dans un seuil.* Aucune règle n'interdit d'y bâtir ; il n'y a
  // simplement rien à y prendre, et l'on y meurt de froid. **Zéro code de restriction, zéro
  // frustration** (spec R17).
  //
  // On y court à demi-vitesse (`snow`, speedFactor 0,5) : la traversée se PAIE, en temps et en
  // chaleur. C'est le seul gardien dont il ait besoin.
  neve: { sol: TERRAIN_SNOW, taches: TERRAIN_SNOW, accent: TERRAIN_SNOW, rarete: 0, seuilTaches: 0.99 },
  aiguilles: { sol: TERRAIN_SCREE, taches: TERRAIN_BOULDERS, accent: TERRAIN_ROCK, rarete: 0.2, seuilTaches: 0.52, partTaches: 0.51, tachesSelon: 'haut', partAccent: 0.034, accentSelon: 'haut' },
  // Le Gouffre : l'éboulis ROULE — il s'accumule dans les creux, pas sur les dos.
  gouffre: { sol: TERRAIN_BOULDERS, taches: TERRAIN_SCREE, accent: TERRAIN_ROCK, rarete: 0.18, seuilTaches: 0.5, partTaches: 0.48, tachesSelon: 'bas', partAccent: 0.03, accentSelon: 'haut' },
  // Le Lac Mort : il a ENFIN son lac (couche II, `zonegen-eaux-zones` — la grande cuvette de la
  // zone, cœur profond ceint de haut-fond et de marais). L'accent d'eau POSÉ est mort (S-R9).
  // Le cœur reste un mur (R5) : on n'y entre pas, on en fait le tour — sa case fantastique est
  // réservée, on lui laisse sa forme.
  lac_mort: { sol: TERRAIN_MARSH, taches: TERRAIN_REED_MARSH, accent: TERRAIN_DEEP_WATER, rarete: 0.3, seuilTaches: 0.5, partTaches: 0.49, tachesSelon: 'humide' },
}

/** Le Névé : les hauteurs de la Tourbière et de la Sylve gardent leurs mélèzes et leurs pins —
 *  un thème n'est pas un aplat. On y reviendra à la passe d'ambiance. */
const HAUT_BOIS = [TERRAIN_PINE, TERRAIN_LARCH]

/**
 * ═══ LES RÈGLES DU SOL DÉRIVÉ — les seuils de quantile par zone (S-R10) ═══
 *
 * Calculées UNE fois après le socle : pour chaque zone qui déclare `partTaches`, la bande du
 * champ (altitude grainée ou mouille) qui recevra ses taches et son accent. Le quantile porte
 * sur les cellules de LA zone (hors vide) : la part est un contrat par zone, sur toute seed.
 *
 * `champAlt` reçoit son grain ('ASOL') pour la même raison que l'humidité du Creux : sans lui,
 * une bande d'altitude est une COURBE DE NIVEAU — propre et morte. L'ordre vient du champ, la
 * texture vient du bruit.
 */
interface RegleSol {
  tacheSeuil: number
  tacheHaut: boolean
  tacheAlt: boolean
  partAccent: number
  accentSeuil: number
  accentHaut: boolean
  accentAlt: boolean
}
interface ReglesSol {
  parZone: (RegleSol | null)[]
  champAlt: Float64Array
  champHum: Float64Array
}

function reglesDuSol(g: GrapheZones, socle: Socle | null, seed: number): ReglesSol | null {
  if (!socle) return null
  const n = socle.cols * socle.rows
  const M = RELIEF.MOTIF
  const sel = (seed ^ 0x41534f4c) | 0 /* 'ASOL' */
  const champAlt = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const kx = k % socle.cols
    const ky = (k - kx) / socle.cols
    champAlt[k] = socle.altLarge[k]!
      + (fbm2(kx * M + M / 2, ky * M + M / 2, CREUX.ECHELLE_BRUIT, sel) - 0.5) * 0.2
  }
  const champHum = socle.mouille

  const parZone = g.zones.map((z): RegleSol | null => {
    const p = PALETTES[z.def.slug]
    if (p?.partTaches === undefined) return null
    const actives = new Uint8Array(n)
    let compte = 0
    for (let k = 0; k < n; k++) {
      if (socle.zoneCell[k] === z.id && socle.videCell[k] === 0) {
        actives[k] = 1
        compte++
      }
    }
    if (compte === 0) return null
    const bande = (selon: SelonLeChamp, part: number): { seuil: number; haut: boolean; alt: boolean } => {
      const alt = selon === 'haut' || selon === 'bas'
      const haut = selon === 'haut' || selon === 'humide'
      const champ = alt ? champAlt : champHum
      return { seuil: seuilParQuantile(champ, actives, haut ? 1 - part : part, -1, 2), haut, alt }
    }
    const t = bande(p.tachesSelon ?? 'humide', p.partTaches)
    const a = bande(p.accentSelon ?? 'haut', p.partAccent ?? 0)
    return {
      tacheSeuil: t.seuil, tacheHaut: t.haut, tacheAlt: t.alt,
      partAccent: p.partAccent ?? 0, accentSeuil: a.seuil, accentHaut: a.haut, accentAlt: a.alt,
    }
  })
  return { parZone, champAlt, champHum }
}

export interface CarteZonee {
  map: WorldMap
  graphe: GrapheZones
  /** Id de zone par tuile. C'est L'ÉTIQUETTE : les ressources, la faune et le climat la lisent. */
  zone: Int32Array
  /** Cette tuile est-elle sur un SEUIL ? (le couloir d'un goulot) — l'exemption du murage d'arête. */
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
  const rampe = new Uint8Array(N)

  // ── LES BLOCS — une décision par bloc de 16 tuiles. C'est ici, et NULLE PART ailleurs, que la
  //    carte devient rectiligne : une frontière ne peut plus être qu'une union d'arêtes de blocs.
  const blocs = decouperEnBlocs(g)

  // ── PASSE 1 : LES ZONES ET LA ROCHE ───────────────────────────────────────
  //
  // La carte n'est PAS un pavage (spec R39) : ce qui n'est pas une région est du VIDE. On ne peint
  // donc plus une zone partout — on peint des ÎLES, et le reste devient de la ROCHE PLATE,
  // infranchissable (façon montagne RimWorld). Pas de gouffre, pas de hauteur : un mur qu'on longe.
  /**
   * LE SOL, MÉMORISÉ PAR MOTIF — et ce n'est pas une approximation, c'est la lecture de `solDe`.
   *
   * `solDe` n'échantillonne le bruit qu'au CENTRE du motif de 8×8 : « tout le carré partage son
   * verdict », dit sa doc, et c'est vrai. On le lui demandait pourtant une fois par TUILE —
   * soixante-quatre fois le même calcul, six évaluations de `gradientNoise2` à chaque fois. C'était
   * 20 % du temps de génération (MESURÉ).
   *
   * On le calcule donc une fois par (motif, région) — la région varie DANS un motif, un motif de 8
   * n'étant pas aligné sur le bloc de 16, d'où la clé à deux termes. Le cache ne vit que le temps
   * d'une RANGÉE de motifs, puisque `my` ne dépend que de `y` : un tableau plat, vidé au changement
   * de rangée. `solDe` étant pure, le terrain est BIT À BIT le même (invariant n°2).
   */
  // ── PASSE 1a : LES ZONES ET LA ROCHE DU VIDE ──
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const k = blocDe(blocs, x, y)
      zone[i] = blocs.zone[k]! // même dans le vide : la cendre et l'ambiance ont besoin d'une région de rattachement
      if (blocs.vide[k]) terrain[i] = TERRAIN_ROCK
    }
  }

  // ── PASSE 1b : LE SOCLE — le micro-relief muet devenu MONDE (spec stratigraphie, couche I) ──
  //
  // Décision d'Alexis, 2026-08-09 (Stratigraphie) : le champ d'ordre de la Racine (2026-07-29)
  // s'étend à la carte entière, et il gagne un passé physique — uplift par tier, érosion
  // stream-power, drainage, accumulation de flux, mouille (voir `socle.ts`). La Racine y est le
  // NIVEAU DE BASE : elle garde son champ historique, le reste du monde s'érode vers elle. Le
  // champ reste INVISIBLE — la carte reste plate (pivot RimWorld) — et ne vit que le temps de
  // la génération : il ne va ni dans `WorldMap`, ni dans `SimState`. AVANT le sol depuis la
  // couche II : c'est lui que `solDe` lit.
  const creux = batirLeSocle(g, seed, zone, width, height,
    (x, y) => blocs.vide[blocDe(blocs, x, y)] === 1)
  const regles = reglesDuSol(g, creux, seed)

  // ── PASSE 1c : LE SOL — chaque zone compose selon sa palette, DÉRIVÉE du socle (S-R10) ──
  const M_SOL = RELIEF.MOTIF
  const colsMotif = Math.ceil(width / M_SOL)
  const solCache = new Int16Array(colsMotif * g.zones.length).fill(-1)
  let rangeeMotif = -1

  for (let y = 0; y < height; y++) {
    const rangee = Math.floor(y / M_SOL)
    if (rangee !== rangeeMotif) { solCache.fill(-1); rangeeMotif = rangee }
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const k = blocDe(blocs, x, y)
      if (blocs.vide[k]) continue // la roche du vide est déjà posée
      const z = blocs.zone[k]!
      const kc = Math.floor(x / M_SOL) * g.zones.length + z
      let sol = solCache[kc]!
      if (sol < 0) {
        sol = solDe(g, z, x, y, creux, regles)
        solCache[kc] = sol
      }
      terrain[i] = sol
    }
  }

  // ── PASSE 1.5 : L'EAU DE LA RACINE — lacs, LA RIVIÈRE, ruisseaux et marais des Prés Bas ──
  //
  // Avant les seuils : un seuil qui traverserait un plan d'eau le rouvre en couloir marchable
  // (la porte gagne), donc l'eau ne bouche jamais un passage. Et l'invariant « tout cœur profond
  // est ceint de haut-fond marchable » garantit qu'aucune poche de terre n'est enclavée — la garde
  // de connexité (passe 3) n'a rien à réparer. La rivière rend son fil et son cœur : les sentes
  // s'en servent pour percer les gués.
  //
  // Les lacs sont désormais des CUVETTES INONDÉES (le creux commande) : ils épousent le fond du
  // pays au lieu d'être des rectangles tirés au sort.
  const riviere = paintWaterRacine(terrain, zone, g, width, height, seed, RELIEF.BORDURE, creux)

  // ── PASSE 1.52 : LES EAUX DES ZONES — l'eau dérivée hors Racine (stratigraphie, couche II) ──
  //
  // Mares-cuvettes et rus de la Tourbière, LE lac du Lac Mort, ruisseaux de la Sylve — inondés
  // et tracés sur les champs du socle (altitude, récepteurs D8), là où `solDe` a déjà posé la
  // roselière : l'eau arrive exactement où le sol l'annonçait. Avant les seuils (la porte gagne)
  // et avant le murage (l'assainissement R45 interne au module précède la déduction des arêtes).
  peindreLesEauxDesZones(terrain, zone, g, width, height, creux)

  // ── PASSE 1.55 : LA VÉGÉTATION DE LA RACINE — dérivée de l'eau qu'on vient de poser ───────
  //
  // APRÈS l'eau, et c'est tout le renversement de ce chantier : la végétation ne peut suivre
  // l'humidité que si l'eau existe déjà. Bosquet dans les creux humides et le long des rives,
  // fleuraie sur les dos secs, herbe entre les deux.
  peindreLaVegetationRacine(terrain, zone, g, width, height, seed, creux)

  // ── PASSE 1.58 : LA LISIÈRE SUD — le seul gradient de la carte (spec t0-exploration R13-R15) ──
  //
  // La frontière de la Cendrière est la seule qui AVANCE (le front la franchira au jour 1) :
  // elle a droit à un traitement que les autres n'ont pas. Herbe → lande → lisière calcinée,
  // par motifs dithérés — le sud se SENT avant de se toucher.
  //
  // APRÈS l'eau et la végétation depuis le 2026-07-29 (elle passait avant) : la passe de
  // végétation repeint herbe/bosquet/fleuraie, elle EFFACERAIT donc la bande. La promesse
  // d'origine — « la rivière qui s'y jette garde ses berges d'eau, pas de cendre » — est tenue
  // à l'identique par l'autre bout : `peindreLisiereSud` ne touche QUE le thème du pré et
  // laisse l'eau, le marais et la roche intacts.
  peindreLisiereSud(terrain, zone, g, width, height, seed)

  // ── PASSE 1.59 : LES BOSQUETS DE CRÊTE — le bois SEC, et le repère du haut pays ───────────
  //
  // Demande d'Alexis, 2026-07-29 : « quelques patchs de forêt déposés de manière équilibrée loin
  // des points d'eau ». APRÈS la lisière sud, et c'est ce qui les tient hors du sud calciné : la
  // passe ne coiffe que l'herbe et la fleuraie, or la lisière a déjà pris ce qui lui revient.
  peindreLesBosquetsDeCrete(terrain, zone, g, width, height, seed, creux)

  // ── PASSE 1.595 : LES LISIÈRES — l'écotone pré/bois entrelacé, hors Racine (S-R11) ──
  entrelacerLesLisieres(terrain, zone, g, width, height, seed)

  // ── PASSE 1.6 : LES SET-PIECES — trois endroits à grande empreinte (spec t0-exploration R9) ──
  const setPieces = placerLesSetPieces(terrain, zone, g, width, height, seed)

  // ── PASSE 1.7 : LES SENTES — les routes du pays d'avant, et leurs gués (R17, R7) ──
  // Elles CONTOURNENT les set-pieces (R18 : un lieu se poste au bord du chemin) ; et la
  // garantie « au moins deux gués » vit à part, indépendante des aléas du traceur.
  const gues = tracerLesSentes(terrain, zone, g, width, height, seed, riviere, setPieces, creux)
  forcerLesGues(terrain, riviere, gues, width, height)

  // ── PASSE 1.8 : L'ASSAINISSEMENT DU PROFOND — l'anneau de R45, CONSTATÉ ──
  //
  // Les coudes de la rivière et les bords des gués fabriquent des coins où le cœur profond
  // touche la terre sèche — mille géométries, et chaque fois qu'on croit avoir couvert les
  // cas, il en reste un (la leçon de `garantirLaConnexite`, mot pour mot). On cesse donc de
  // raisonner : tout PROFOND de la Racine au contact orthogonal d'une terre marchable sèche
  // redevient haut-fond (le point fixe tient en UNE passe : convertir produit de l'eau,
  // jamais de la terre — le prédicat est statique). AVANT le murage, et c'est important :
  // à la frontière, ce haut-fond neuf forme une paire marchable inter-zones que
  // `murerLesAretes` mure ensuite — déplacé APRÈS, l'assainissement ROUVRAIT ces frontières
  // (mesuré : 137 ouvertures sur la seed 7, le profond était le mur). (Le Lac Mort, lui,
  // garde son profond ceint de marais : c'est SA forme, voulue — on ne touche que la Racine.)
  assainirLeProfond(terrain, zone, g.racine, width, height)

  // ── PASSE 2 : les seuils — on perce tout droit un couloir PLAT dans la frontière ──
  for (const s of g.seuils) {
    percerSeuil(g, blocs, s, terrain, zone, rampe, width, height, creux, regles)
  }

  // ── PASSE 3 : LES ARÊTES — le mur, DÉDUIT. Puis on garantit qu'on circule. ─
  //
  // Les deux se répondent, d'où les deux tours : murer peut couper une poche, et l'ouvrir peut
  // fabriquer une arête neuve là où le percement rase une frontière. Deux tours suffisent (mesuré :
  // le second n'ouvre plus rien), et on FINIT par la connexité — l'invariant qui ne se négocie pas
  // est « toute zone est atteignable » (A2), pas « pas une arête ne traîne » (le seuil en fabrique).

  for (let tour = 0; tour < 2; tour++) {
    murerLesAretes(terrain, zone, rampe, width, height)
    garantirLaConnexite(g, terrain, zone, rampe, width, height, creux, regles)
  }

  // ── PASSE 3.5 : LA REPRISE D'ASSAINISSEMENT, INTRA-ZONE SEULEMENT ──
  //
  // La fenêtre pointée par la revue : un couloir de seuil ou une rampe de connexité qui perce
  // du profond fabrique du sol sec au contact du cœur — APRÈS la passe 1.8. On repasse donc,
  // mais en ne comptant que les voisins secs DE LA RACINE : à la frontière, le profond est un
  // mur légitime (R5), et le convertir ici ROUVRIRAIT une frontière que `murerLesAretes` ne
  // repassera plus (mesuré : 137 ouvertures quand la passe pleine tournait à cette place).
  assainirLeProfond(terrain, zone, g.racine, width, height, true)
  // Et son pendant HORS Racine (stratigraphie, couche II) : un couloir de connexité qui a percé
  // du profond de zone laisse le même défaut — même point fixe, même restriction intra-zone.
  assainirLeProfondHorsRacine(terrain, zone, g.racine, width, height, true)

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
    // LE VIDE NE BRÛLE PAS. Un bloc de crevasse se rattache à sa région la plus proche (il faut bien
    // qu'un échantillon réponde) — mais il n'est DANS aucune zone, et une crevasse n'a rien à brûler.
    // Sans cette ligne, un quart de la Cendrière « ne brûlait pas au jour 1 » : c'étaient ses marges
    // de vide, comptées comme siennes.
    if (blocs.vide[k]) return Math.abs(m) + 1
    if (zid === cendriere.id) return -m // DEDANS : elle brûle depuis le premier jour
    // Dehors : la distance à la frontière de la Cendrière. Si le bloc ne la touche pas, on prend la
    // distance au site — une borne honnête, et le front s'arrête de toute façon bien avant.
    if (voisinAt(g, x, y) === cendriere.id) return m
    return Math.sqrt(distSq(x, y, cendriere.x, cendriere.y))
  })

  // On vise une PART des Prés Bas (60 %), pas une distance : la forme des zones varie trop d'une
  // seed à l'autre pour qu'un nombre de tuiles fixe tienne la promesse. On calibre donc ICI.
  const cendreMax = calibreLeFront(champCendre, (i) => zone[i] === g.racine && rampe[i] === 0)

  // ── LES STADES DU VERSANT BRÛLÉ (stratigraphie, couche IV) : la reprise, datée par le champ
  //    de cendre qu'on vient de poser. AVANT les lieux — le semis lit le terrain des stades.
  peindreLesStadesDuBrule(terrain, zone, g, champCendre, width, height, seed)

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
    width, height, terrain, zones: toponymes(g), cendre: champCendre, cendreMax,
    zoneGrid,
    zonePas: ZONE_PAS,
    zoneDefs: g.zones.map((z) => ({ slug: z.def.slug, nom: z.def.nom, tier: z.def.tier })),
    // LES SEUILS, DONNÉE DE PREMIER ORDRE (spec t0-exploration R20) : le client en tire les
    // BORNES qui annoncent les portes (worldgen R21) — il ne devine plus rien par les noms.
    seuils: g.seuils.map((s) => ({
      x: s.x, y: s.y, ax: s.ax, ay: s.ay, secours: s.secours, vers: g.zones[s.b]!.def.nom,
    })),
    // LE FIL DE LA RIVIÈRE, amont → aval (spec eau-vivante R15) : une DONNÉE, pas une règle.
    // Il était jeté après la génération — rien au runtime ne savait dans quel sens l'eau
    // coule. Le client en dérive le courant (feuilles qui dérivent) ; demain, un courant
    // qui pousse serait une décision de design à part (consignée, pas ouverte).
    ...(riviere ? { fil: riviere.fil.slice() } : {}),
  }
  const carte: CarteZonee = { map, graphe: g, zone, rampe }

  // ── PASSE 4.5 : LES SET-PIECES ET LES GUÉS ENTRENT DANS LA CARTE ──────────
  //
  // AVANT les lieux : le semis de Poisson écarte ses points de tout lieu déjà enregistré
  // (spec t0-exploration R10) — un Cairn au milieu du Cercle de pierres n'est pas un Cairn.
  // Les set-pieces sont des LIEUX (kind : ils se découvrent, la garde A19 les couvre) ; les
  // gués sont des TOPONYMES (un nom qu'on foule, pas une pastille).
  for (const p of setPieces) {
    map.zones.push({ name: p.nom, x: p.x, y: p.y, w: p.w, h: p.h, kind: p.kind })
  }
  for (const q2 of gues) {
    map.zones.push({ name: 'le Gué', x: q2.x - 3, y: q2.y - 3, w: 7, h: 7 })
    // Les annales (S-R16) : un gué est un fait de l'ère des routes — le point où le pays
    // d'avant a choisi de franchir son eau.
    ;(map.annales ??= []).push({ ere: 2, type: 'gue', x: q2.x, y: q2.y })
  }

  // ── PASSE 5 : LES LIEUX — et ils ont désormais une ADRESSE ────────────────
  const zoneDe = (tx: number, ty: number): string | undefined => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return undefined
    return g.zones[zone[ty * width + tx]!]!.def.slug
  }
  const champDeCreusement = placePois(map, seed, zoneDe)

  // ── PASSE 6 : LES CHARNIERS — l'adresse n'est plus une zone, c'est une DENSITÉ ────
  //
  // Ils ne passent pas par la loterie (`horsSemis`) : leur abondance est commandée par le champ
  // des morts, celui-là même que la nuit lit pour savoir combien de rôdeurs ce sol peut porter.
  // `poi.ts` ne connaît toujours pas `morts.ts` — il reçoit un accesseur, exactement comme pour
  // les zones. (spec `cendreux.md` R20 ; décision d'Alexis du 2026-07-31.)
  placeCharniers(map, seed, (tx, ty) => densiteDeBase(map, tx, ty), zoneDe, champDeCreusement)

  return carte
}

/**
 * ═══ LA LISIÈRE SUD — le seul gradient de la carte, et il est ASSUMÉ (R13-R15) ═══
 *
 * « De ton pas de porte, tu vois l'enfer » (décision fondatrice R13) : la frontière de la
 * Cendrière est la seule qui avance, elle a droit au seul dégradé du jeu. Herbe → lande →
 * lisière calcinée sur ~40 tuiles, décidé par MOTIF de 8 avec un dither positionnel : des
 * marches irrégulières de blocs (R32 : le bruit ne survit que quantifié), jamais une ligne.
 *
 * L'exception à « une zone = un thème » (worldgen R7) est bornée ICI : aucune autre
 * frontière ne déteint. Et rien d'autre ne change : les terrains existent (aucun id neuf),
 * les nœuds suivent les admissions en place, la garde A17 reste un critère.
 */
const LISIERE_SUD = {
  /** Portée du gradient depuis la frontière Cendrière, en tuiles. */
  LARGEUR: 40,
  /** En deçà : la lisière CALCINÉE (burnt_forest) domine. */
  PLEIN: 14,
  /** Entre PLEIN et LANDE : la lande (heath). Au-delà : le pré reprend. */
  LANDE: 30,
  /** Amplitude du dither positionnel (± la moitié), en tuiles de distance. */
  DITHER: 16,
} as const

/** L'anneau de R45, tenu au point fixe : le profond de la Racine ne touche jamais la terre.
 *  `memeZone` restreint le déclencheur aux voisins secs DE LA RACINE — la variante d'après
 *  murage, qui ne rouvre jamais une frontière (le profond y est un mur légitime, R5). */
function assainirLeProfond(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  memeZone = false,
): void {
  for (let passe = 0; passe < 8; passe++) {
    let corriges = 0
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        if (terrain[i] !== TERRAIN_DEEP_WATER || zone[i] !== racineId) continue
        for (const j of [i - 1, i + 1, i - width, i + width]) {
          const t = terrain[j]!
          if (isWater(t)) continue
          if (TERRAINS[t]?.walkable !== true) continue
          if (memeZone && zone[j] !== racineId) continue
          terrain[i] = TERRAIN_SHALLOW_WATER
          corriges++
          break
        }
      }
    }
    if (corriges === 0) return
  }
}

/**
 * ═══ LA VÉGÉTATION DE LA RACINE — TROIS TERRAINS, UN SEUL ORDRE ═══
 *
 * *(Décision d'Alexis, 2026-07-29 — voir `racine-relief.ts` pour la mesure qui l'a motivée.)*
 *
 * `solDe` composait les Prés Bas avec deux bruits INDÉPENDANTS : l'un tirait la fleuraie, l'autre
 * les bosquets, graines différentes, aucune interaction. D'où le grief : *« l'enchaînement des
 * biomes ne suit aucune logique et produit un patchwork de polygones sans inspiration. »* Il n'y
 * avait pas d'enchaînement parce qu'il n'y avait aucune VARIABLE D'ORDRE.
 *
 * Ici, une seule : l'humidité — elle-même dérivée du creux et de l'eau. La succession devient
 * lisible d'un bout à l'autre du pays :
 *
 *   roselière → marais → BOSQUET → HERBE → FLEURAIE
 *   (l'eau)     (la rive)  (le creux)  (le pré)  (le dos sec)
 *
 * ON NE REPEINT QUE LE THÈME DU PRÉ (herbe, bosquet, fleuraie) : l'eau, le marais, la roselière,
 * la roche et tout ce que les autres passes ont posé gardent leur nature. C'est ce qui rend cette
 * passe sûre à glisser au milieu des autres — et c'est la même règle que `peindreLisiereSud`.
 *
 * ET LES SET-PIECES SONT ÉPARGNÉS par construction : ils se peignent APRÈS (passe 1.6), donc le
 * Bois Noir garde sa futaie et la Combe brumeuse sa roselière.
 */
function peindreLaVegetationRacine(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  seed: number,
  creux: Creux | null,
): void {
  if (!creux) return
  const r = g.zones[g.racine]!.rect
  if (!r) return

  // L'humidité se compose APRÈS l'eau : elle en dérive. `estEau` lit le terrain déjà peint —
  // lacs, rivière, ruisseaux et flaques comprises.
  mesurerLaDistanceALEau(creux, (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const i = y * width + x
    if (zone[i] !== g.racine) return false
    return isWater(terrain[i]!)
  })
  composerLHumidite(creux, seed)

  const y0 = Math.max(0, r.y)
  const y1 = Math.min(height, r.y + r.h)
  const x0 = Math.max(0, r.x)
  const x1 = Math.min(width, r.x + r.w)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x
      if (zone[i] !== g.racine) continue
      const t = terrain[i]!
      // Seul le thème du pré cède. Tout le reste est le fait d'une autre passe : on n'y touche pas.
      if (t !== TERRAIN_GRASS && t !== TERRAIN_FOREST && t !== TERRAIN_FLOWER_MEADOW) continue
      const v = vegetationAt(creux, x, y)
      terrain[i] = v === 1 ? TERRAIN_FOREST : v === -1 ? TERRAIN_FLOWER_MEADOW : TERRAIN_GRASS
    }
  }
}

/**
 * ═══ LES BOSQUETS DE CRÊTE — un bois SEC, et il n'est pas le même que celui des rives ═══
 *
 * *(Demande d'Alexis, 2026-07-29 ; essence tranchée par lui : pin et mélèze, pas le feuillu des
 * berges. Placement : `coifferLesCretes`, dans `racine-relief.ts`.)*
 *
 * LE PROBLÈME MESURÉ : `arbresDeLaRacine` sème des arbres épars sur l'herbe et dense dans la
 * futaie — et s'arrête là. La FLEURAIE ne porte pas un seul arbre (0 sur 86 000 tuiles, vérifié).
 * Ce trou existait avant ce chantier ; la fleuraie n'étant qu'un moucheté de 5 %, il ne se voyait
 * pas. Elle est passée à 13,5 % en plaques cohérentes : le trou est devenu un ENDROIT, et un
 * endroit sans une seule verticale — rien qui casse l'horizon, rien vers quoi marcher.
 *
 * DEUX BOIS QUI RACONTENT DEUX CHOSES. Le pin et le mélèze étaient réservés aux zones de palier
 * > 0 (`HAUT_BOIS`, dans `solDe`) ; ils descendent ici sur les crêtes sèches de la Racine. Feuillu
 * sombre au fond humide, conifère clair sur la bosse : la logique qu'on vient d'installer (humide
 * = couvert, sec = ouvert) reste lisible, et le bois sec ne se lit pas comme son rattrapage. C'est
 * aussi un avant-goût de ce que promettent les hauteurs — la même grammaire que le vieil arbre
 * dérisoire du Bois Noir, ou que le filon de fer du teaser.
 *
 * ON NE COIFFE QUE L'HERBE ET LA FLEURAIE. Tout le reste est le fait d'une autre passe et garde
 * sa nature : l'eau, le marais, la roselière, la roche, la lande et le calciné du sud (qui vient
 * d'être peint), les couloirs de seuil. La règle est la même que partout dans ce fichier.
 */
function peindreLesBosquetsDeCrete(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  seed: number,
  creux: Creux | null,
): void {
  if (!creux) return
  const M = RELIEF.MOTIF
  /** Une TUILE accepte-t-elle d'être boisée ? Seuls le pré et la fleuraie cèdent. */
  const tuileLibre = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const i = y * width + x
    if (zone[i] !== g.racine) return false
    const t = terrain[i]!
    return t === TERRAIN_GRASS || t === TERRAIN_FLOWER_MEADOW
  }
  /**
   * Un MOTIF ENTIER accepte-t-il d'être boisé ? On exige les 64 tuiles, pas une majorité — et
   * c'est ce qui a supprimé les miettes. Un motif à moitié pris (une rive, un ruisseau, une
   * sente) entrait dans le chapeau, puis ses tuiles refusées COUPAIENT le bosquet à la peinture :
   * il sortait en un bois plus deux ou trois taches de vingt tuiles à côté. Une miette de
   * conifère au milieu d'un pré ne se lit pas comme un boqueteau, elle se lit comme une erreur.
   */
  const peignable = (tx0: number, ty0: number): boolean => {
    for (let dy = 0; dy < M; dy++) {
      for (let dx = 0; dx < M; dx++) if (!tuileLibre(tx0 + dx, ty0 + dy)) return false
    }
    return true
  }
  // Le masque des seuils est celui de l'eau : un bosquet dans une porte la NOURRIRAIT (du bois),
  // et worldgen R10.3 l'interdit au même titre que l'eau. Une seule règle, un seul masque.
  const bosquets = coifferLesCretes(creux, masqueDesSeuils(creux, g, g.racine), peignable)

  const sel = (seed ^ 0x43524554) | 0 /* 'CRET' */
  for (const bosquet of bosquets) {
    for (const k of bosquet) {
      const kx = k % creux.cols
      const tx0 = (creux.mx0 + kx) * M
      const ty0 = (creux.my0 + (k - kx) / creux.cols) * M
      // L'essence se tire PAR MOTIF, pas par bosquet : un bois de montagne est un mélange de pins
      // et de mélèzes, pas une monoculture. Même grain que le reste de la carte (R32).
      const essence = HAUT_BOIS[Math.floor(hash2(tx0 / M, ty0 / M, sel) * HAUT_BOIS.length)]!
      // Le motif est ENTIÈREMENT libre (`peignable` l'a exigé) : on le prend en entier, et le
      // bosquet reste donc d'un seul tenant.
      for (let dy = 0; dy < M; dy++) {
        for (let dx = 0; dx < M; dx++) terrain[(ty0 + dy) * width + tx0 + dx] = essence
      }
    }
  }
}

/**
 * ═══ LES LISIÈRES — l'écotone pré/bois, en entrelacs de motifs (S-R11) ═══
 *
 * Une frontière de quantile est déjà organique (le grain du champ la déchiquette), mais elle
 * reste BINAIRE : pré d'un côté, bois de l'autre, au motif près. La lisière l'ENTRELACE : au
 * contact des deux classes, des motifs basculent de l'autre côté (hash positionnel 'LISI'),
 * SYMÉTRIQUEMENT — autant de pré qui s'avance que de bois qui recule, la composition par zone
 * reste son contrat. R32 tient : l'entrelacs est un damier irrégulier de carrés de 8, pas un
 * dégradé.
 *
 * HORS Racine (son écotone est déjà l'affaire de son champ réglé) et hors Névé. Seul le THÈME
 * cède : eau, marais, roche, routes, et tout ce que d'autres passes ont posé gardent leur
 * nature — la règle de toutes les passes de ce fichier.
 */
const LISIERE = {
  /** La chance qu'un motif de bord bascule de l'autre côté. */
  PART_BASCULE: 0.34,
} as const

const CLASSE_BOIS = new Set([TERRAIN_FOREST, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_OLD_GROWTH])
const CLASSE_PRE = new Set([TERRAIN_GRASS, TERRAIN_FLOWER_MEADOW, TERRAIN_HEATH, TERRAIN_ALPINE_MEADOW, TERRAIN_ALPINE_FLOWERS])

function entrelacerLesLisieres(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  seed: number,
): void {
  const M = RELIEF.MOTIF
  const cols = Math.ceil(width / M)
  const rows = Math.ceil(height / M)
  const sel = (seed ^ 0x4c495349) | 0 /* 'LISI' */
  const neve = g.zones.find((z) => z.def.slug === 'neve')?.id ?? -1

  // La classe de chaque motif, lue à son centre — une passe, AVANT toute bascule (sinon une
  // bascule en amont ferait boule de neige sur ses voisines : la lisière deviendrait une marée).
  const classe = new Int8Array(cols * rows) // 0 = ni l'un ni l'autre, 1 = pré, 2 = bois
  const centre = new Int32Array(cols * rows)
  for (let my = 0; my < rows; my++) {
    for (let mx = 0; mx < cols; mx++) {
      const cx = Math.min(width - 1, mx * M + M / 2)
      const cy = Math.min(height - 1, my * M + M / 2)
      const i = cy * width + cx
      centre[my * cols + mx] = i
      if (zone[i] === g.racine || zone[i] === neve) continue
      const t = terrain[i]!
      classe[my * cols + mx] = CLASSE_PRE.has(t) ? 1 : CLASSE_BOIS.has(t) ? 2 : 0
    }
  }

  for (let my = 0; my < rows; my++) {
    for (let mx = 0; mx < cols; mx++) {
      const k = my * cols + mx
      const c = classe[k]!
      if (c === 0) continue
      // Un voisin cardinal de l'AUTRE classe, dans la MÊME zone ? (l'écotone est interne — une
      // frontière de zones reste un mur, pas une lisière.)
      const iCentre = centre[k]!
      let voisinAutre = -1
      for (const v of [mx > 0 ? k - 1 : -1, mx + 1 < cols ? k + 1 : -1, my > 0 ? k - cols : -1, my + 1 < rows ? k + cols : -1]) {
        if (v < 0) continue
        const cv = classe[v]!
        if (cv === 0 || cv === c) continue
        if (zone[centre[v]!] !== zone[iCentre]) continue
        voisinAutre = v
        break
      }
      if (voisinAutre < 0) continue
      if (hash2(mx, my, sel) >= LISIERE.PART_BASCULE) continue
      // La bascule : les tuiles de CE motif qui portent SA classe prennent le terrain du voisin.
      const de = terrain[iCentre]!
      const vers = terrain[centre[voisinAutre]!]!
      for (let dy = 0; dy < M; dy++) {
        const y = my * M + dy
        if (y >= height) break
        for (let dx = 0; dx < M; dx++) {
          const x = mx * M + dx
          if (x >= width) break
          const i = y * width + x
          if (zone[i] !== zone[iCentre]) continue
          if (terrain[i] === de) terrain[i] = vers
        }
      }
    }
  }
}

/**
 * ═══ LES STADES DU VERSANT BRÛLÉ — la reprise, datée par le feu (stratigraphie S-R20) ═══
 *
 * « C'est là que ça a commencé » (worldgen §3) : le Versant Brûlé n'est pas uniformément mort —
 * il MEURT PRÈS DU FEU ET REVIT LOIN DE LUI. La distance à la Cendrière (le champ de cendre,
 * déjà calculé) devient l'ÂGE de la perturbation, et la zone se compose par stades de
 * succession écologique, du plus jeune au plus vieux :
 *
 *   cendre stérile → lande (mousses, épilobes — et les premières baies) → pionniers (l'herbe
 *   revient, les premiers mélèzes s'y risquent) → jeune futaie serrée
 *
 * Les parts sont des QUANTILES de la distance réellement tirée sur les tuiles de la zone
 * (patron `seuilParQuantile`) : le gradient est un contrat sur toute seed, quelle que soit la
 * forme de la zone. Le dither par motif (le patron de la lisière sud — le seul bord que
 * l'audit visuel ait jugé vivant) déchiquette les fronts de bande : des marches irrégulières,
 * jamais une courbe de niveau. Les NŒUDS suivent tout seuls : `terrainAdmet` donne les baies
 * à la lande, le bois aux mélèzes — chaque stade porte sa table, par construction.
 */
const STADES_BRULE = {
  /** Les parts cumulées des stades, du plus proche du feu au plus loin. */
  PART_STERILE: 0.36,
  PART_LANDE: 0.66, //   stérile + lande
  PART_PIONNIER: 0.86, // + pionniers ; le reste : jeune futaie
  /** Amplitude du dither par motif (± la moitié), en tuiles de distance au front. */
  DITHER: 26,
  /** La part de mélèzes semés PAR MOTIF dans la bande pionnière — les éclaireurs du bois. */
  MELEZES_PIONNIERS: 0.16,
} as const

function peindreLesStadesDuBrule(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  champCendre: readonly number[],
  width: number,
  height: number,
  seed: number,
): void {
  const brule = g.zones.find((z) => z.def.slug === 'brule')
  if (!brule) return
  const sel = (seed ^ 0x53544144) | 0 /* 'STAD' */
  const M = RELIEF.MOTIF

  // Les quantiles de la distance au front, sur les tuiles de la zone (histogramme, en motifs).
  const dists: number[] = []
  for (let y = 0; y < height; y += M) {
    for (let x = 0; x < width; x += M) {
      const i = y * width + x
      if (zone[i] === brule.id) dists.push(champCendre[i]!)
    }
  }
  if (dists.length < 32) return
  let lo = Infinity
  let hi = -Infinity
  for (const d of dists) {
    if (d < lo) lo = d
    if (d > hi) hi = d
  }
  const etendue = hi - lo || 1
  const SEAUX = 1024
  const hist = new Int32Array(SEAUX)
  for (const d of dists) {
    let b = Math.floor(((d - lo) / etendue) * SEAUX)
    if (b < 0) b = 0
    if (b >= SEAUX) b = SEAUX - 1
    hist[b]!++
  }
  const quantile = (part: number): number => {
    const cible = Math.floor(dists.length * part)
    let cum = 0
    for (let b = 0; b < SEAUX; b++) {
      cum += hist[b]!
      if (cum > cible) return lo + ((b + 1) / SEAUX) * etendue
    }
    return hi
  }
  const qSterile = quantile(STADES_BRULE.PART_STERILE)
  const qLande = quantile(STADES_BRULE.PART_LANDE)
  const qPionnier = quantile(STADES_BRULE.PART_PIONNIER)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (zone[i] !== brule.id) continue
      const t = terrain[i]!
      // Seul le THÈME cède (calciné, lande, herbe) : l'eau, la roche, les routes et tout ce
      // que d'autres passes ont posé gardent leur nature — la règle de toutes les passes.
      if (t !== TERRAIN_BURNT_FOREST && t !== TERRAIN_HEATH && t !== TERRAIN_GRASS && t !== TERRAIN_LARCH) continue
      const mx = Math.floor(x / M)
      const my = Math.floor(y / M)
      const d = champCendre[i]! + (hash2(mx, my, sel) - 0.5) * STADES_BRULE.DITHER
      if (d < qSterile) terrain[i] = TERRAIN_BURNT_FOREST
      else if (d < qLande) terrain[i] = TERRAIN_HEATH
      else if (d < qPionnier) {
        terrain[i] = hash2(mx, my, sel ^ 0x504e) < STADES_BRULE.MELEZES_PIONNIERS
          ? TERRAIN_LARCH : TERRAIN_GRASS
      } else terrain[i] = TERRAIN_LARCH
    }
  }
}

function peindreLisiereSud(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  seed: number,
): void {
  const r = g.zones[g.racine]!.rect
  if (!r) return
  const sud = r.y + r.h // la frontière Cendrière EST le bord sud du rectangle de la Racine
  const sel = (seed ^ 0x4c495355) | 0 /* 'LISU' */
  const M = RELIEF.MOTIF
  const y0 = Math.max(0, sud - LISIERE_SUD.LARGEUR - LISIERE_SUD.DITHER)
  for (let y = y0; y < Math.min(height, sud); y++) {
    for (let x = r.x; x < Math.min(width, r.x + r.w); x++) {
      const i = y * width + x
      if (zone[i] !== g.racine) continue
      const t = terrain[i]!
      // Seul le THÈME du pré cède : herbe, bosquets, fleuraie. L'eau, le marais, la roche
      // et tout ce que les autres passes poseront gardent leur nature.
      if (t !== TERRAIN_GRASS && t !== TERRAIN_FOREST && t !== TERRAIN_FLOWER_MEADOW) continue
      const mx = Math.floor(x / M)
      const my = Math.floor(y / M)
      const v = sud - y + (hash2(mx, my, sel) - 0.5) * LISIERE_SUD.DITHER
      if (v < LISIERE_SUD.PLEIN) terrain[i] = TERRAIN_BURNT_FOREST
      else if (v < LISIERE_SUD.LANDE) terrain[i] = TERRAIN_HEATH
    }
  }
}

/**
 * LE SOL D'UNE TUILE — le thème de sa zone, semé de bosquets et d'accents, et QUANTIFIÉ AU MOTIF.
 *
 * Le bruit ne décide plus tuile par tuile : il décide par carré de 8. Une forêt devient un pavage
 * de carrés, un affleurement de roche un rectangle. C'est le grain « pixel-art assumé » de la
 * nouvelle direction artistique — et c'est la même quantification que les zones, un cran plus fin.
 */
function solDe(
  g: GrapheZones,
  id: number,
  x: number,
  y: number,
  socle: Socle | null = null,
  regles: ReglesSol | null = null,
): number {
  const z = g.zones[id]!
  const p = PALETTES[z.def.slug]!
  // Le centre du MOTIF qui contient la tuile : tout le carré partage son verdict.
  const M = RELIEF.MOTIF
  const mx = Math.floor(x / M) * M + M / 2
  const my = Math.floor(y / M) * M + M / 2

  // ═══ LE CHEMIN DÉRIVÉ (S-R10) : la zone lit le socle, l'accent gagne sur la tache ═══
  const r = regles?.parZone[id]
  if (socle && regles && r) {
    const k = celluleDe(socle, x, y)
    if (k >= 0) {
      const va = r.accentAlt ? regles.champAlt[k]! : regles.champHum[k]!
      if (r.partAccent > 0 && (r.accentHaut ? va >= r.accentSeuil : va < r.accentSeuil)) return p.accent
      const vt = r.tacheAlt ? regles.champAlt[k]! : regles.champHum[k]!
      if (r.tacheHaut ? vt >= r.tacheSeuil : vt < r.tacheSeuil) {
        if (p.taches === TERRAIN_FOREST && z.def.tier > 0) {
          return HAUT_BOIS[Math.floor(hash2(mx, my, g.seed ^ 0x5b) * HAUT_BOIS.length)]!
        }
        return p.taches
      }
      return p.sol
    }
  }

  // ═══ LE CHEMIN HISTORIQUE — les Prés Bas (repeints par leurs passes), le Névé, le hors-grille ═══
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
 * ═══ PERCER UN SEUIL — un COULOIR PLAT dans le mur de frontière ═══
 *
 * Le seuil est le seul endroit où l'on passe d'une zone à l'autre : un corridor droit percé dans la
 * roche-mur, de longueur FIXE, débouchant de part et d'autre dans le pays. La carte est plate — il
 * ne monte pas, il TRAVERSE.
 *
 * Et ça rachète l'objection qui avait tué les cols : *« la porte est introuvable au sol. »* Un mur
 * de roche se longe. **On ne cherche pas la porte : on longe le mur jusqu'au passage.** C'est R4,
 * tenue par la géométrie et non par une promesse.
 *
 * Le couloir est DROIT — deux zones se font face selon un axe, il n'y a rien à chercher. C'est ce
 * qui avait coûté deux réécritures à l'ancienne version, qui creusait en biais dans une direction
 * théorique et mourait DANS le mur ; le rectiligne supprime la question au lieu d'y répondre.
 *
 * Toutes ses tuiles sont marquées `rampe` — ce qui les exempte de « une arête inter-zones est un
 * mur », qu'elles violent par métier. Leurs FLANCS, eux, ne le sont pas : la roche les borde de part
 * et d'autre. **Le goulot se taille tout seul.**
 */
function percerSeuil(
  g: GrapheZones,
  _blocs: Blocs,
  s: { a: number; b: number; x: number; y: number; ax: number; ay: number; secours?: boolean },
  terrain: number[],
  zone: Int32Array,
  rampe: Uint8Array,
  width: number,
  height: number,
  socle: Socle | null,
  regles: ReglesSol | null,
): void {
  // L'AXE DE TRAVERSÉE vient du SEUIL, et c'est une leçon. Les régions se chevauchent (spec R40) :
  // leurs formes sont des polygones en L, et la normale à la frontière ne se déduit plus de quatre
  // nombres. On l'a donc CONSTATÉE au balayage (`catalogueDesPortes`), et on la transporte.
  const ax = s.ax
  const ay = s.ay
  const px = -ay
  const py = ax

  // Le couloir est posé SUR la frontière : il déborde d'autant de chaque côté (longueur fixe, plate).
  // R11 — un seuil de SECOURS n'est pas une seconde porte, c'est un DÉFILÉ : plus étroit et plus
  // long. Le drapeau était calculé et affiché depuis le début ; il commande enfin la géométrie.
  const secours = s.secours === true
  const half = secours ? RELIEF.DEBORD_SECOURS : RELIEF.DEBORD_SEUIL
  const L = secours ? RELIEF.DEMI_LARGEUR_SECOURS : RELIEF.DEMI_LARGEUR_SEUIL

  for (let t = -half; t <= half; t++) {
    // Le sol du couloir est celui de la région vers laquelle on va : **la porte a déjà la couleur de
    // ce qu'elle garde.** On voit ce qui attend avant d'y être (spec R10.2).
    const vers = t < 0 ? s.a : s.b

    for (let w = -L; w <= L; w++) {
      const x = s.x + ax * t + px * w
      const y = s.y + ay * t + py * w
      if (x < RELIEF.BORDURE || y < RELIEF.BORDURE || x >= width - RELIEF.BORDURE || y >= height - RELIEF.BORDURE) {
        continue
      }
      const i = y * width + x
      // ON DÉGAGE TOUT CE QUI BLOQUE — le vide comme le rocher. **Une porte est une porte.**
      if (TERRAINS[terrain[i]!]?.walkable !== true) {
        terrain[i] = solMarchableDe(g, vers, x, y, socle, regles)
        zone[i] = vers
      }
      rampe[i] = 1
    }
  }
}

/** Le sol d'une zone, mais GARANTI marchable : dans un couloir de seuil, l'accent bloquant
 *  d'une zone (le rocher, l'eau profonde) n'a rien à faire — il boucherait la porte. */
function solMarchableDe(
  g: GrapheZones,
  id: number,
  x: number,
  y: number,
  socle: Socle | null,
  regles: ReglesSol | null,
): number {
  const t = solDe(g, id, x, y, socle, regles)
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
export { deriveGrapheZones }

/**
 * ═══ MURER LES ARÊTES — LA FALAISE, DÉDUITE ═══
 *
 * **UNE ARÊTE INTER-ZONES EST UN MUR — SAUF SUR UN SEUIL.** Toute la topologie du monde tient dans
 * cette phrase : c'est le seul mur qui sépare deux pays sur la carte plate.
 *
 * Ce qu'on ne fait plus : peindre une bande de falaise de 44 tuiles là où un champ continu
 * descendait sous un seuil. Ça coûtait 16 % de la carte, ça noyait chaque frontière dans un no
 * man's land rocheux, et ça n'avait qu'une raison d'être — la falaise était *dérivée d'un champ*
 * au lieu d'être ce qu'elle est : **le mur entre deux pays**.
 *
 * Un seul cas, un seul geste : **DEUX TUILES MARCHABLES VOISINES DE ZONES DIFFÉRENTES** → on en mure
 * une, d'un côté déterministe (le plus grand id : donc une ligne d'UNE tuile, jamais deux). Sans ce
 * mur, deux zones voisines auraient une frontière ouverte — le seuil ne serait plus le seul passage,
 * et le test destructif A5 deviendrait un mensonge. Pas de hauteur : de la roche plate qu'on longe.
 *
 * L'EXEMPTION EST LE PIVOT, et elle rend un service qu'on n'a pas eu à écrire : les tuiles d'un
 * couloir de seuil sont marquées `rampe`, donc leurs arêtes internes ne se murent pas — mais leurs
 * FLANCS (une tuile de couloir contre une tuile d'une autre zone) se murent par la règle générale.
 * **Le goulot se creuse tout seul.**
 */
function murerLesAretes(
  terrain: number[],
  zone: Int32Array,
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
        if (rampe[i] && rampe[j]) continue // un seuil a le droit de traverser : c'est son métier
        if (zone[i] !== zone[j]) {
          aMurer.push(zone[i]! > zone[j]! ? i : j) // la frontière — le seul mur, sinon A5 ment
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
  rampe: Uint8Array,
  width: number,
  height: number,
  socle: Socle | null,
  regles: ReglesSol | null,
): void {
  const N = width * height
  const walk = (i: number): boolean => MARCHABLE[terrain[i]!] === 1

  const inonder = (depart: number): Uint8Array => {
    const vu = new Uint8Array(N)
    if (!walk(depart)) return vu
    vu[depart] = 1
    const file = [depart]
    for (let h = 0; h < file.length; h++) {
      const i = file[h]!
      const x = i % width
      const y = (i - x) / width
      // Les quatre voisins, DÉROULÉS — même ordre qu'avant (est, ouest, sud, nord), donc même
      // ordre de découverte et même `file`.
      //
      // CORRECTION D'UNE ATTRIBUTION FAUSSE, écrite ici même : ce corps de BFS pesait 16,8 % du
      // profil, et j'en avais crédité les CINQ tableaux que le `for…of [[1,0],…]` allouait par
      // tuile dépilée. C'était faux. Le même littéral retiré ailleurs dans ce fichier
      // (`murerLesAretes`, un par tuile marchable, deux passes) ne rend RIEN de mesurable sur
      // douze passes A/B : V8 supprime ces petits tableaux qui ne s'échappent pas. Les 16,8 %
      // étaient le corps entier, et ce qu'on a gagné ici vient surtout de `MARCHABLE`. Le
      // déroulé reste — il ne coûte rien et ne dépend pas d'une optimisation de moteur, or
      // `/sim` doit tourner aussi bien dans un Worker de navigateur que sur Node.
      if (x + 1 < width) { const j = i + 1; if (!vu[j] && walk(j)) { vu[j] = 1; file.push(j) } }
      if (x > 0) { const j = i - 1; if (!vu[j] && walk(j)) { vu[j] = 1; file.push(j) } }
      if (y + 1 < height) { const j = i + width; if (!vu[j] && walk(j)) { vu[j] = 1; file.push(j) } }
      if (y > 0) { const j = i - width; if (!vu[j] && walk(j)) { vu[j] = 1; file.push(j) } }
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
        // Déroulé comme dans `inonder`, et dans le MÊME ordre : l'ordre de `poche` compte
        // (c'est `poche[0]` qui donne la zone du percement, et l'ordre de la file décide
        // quelle tuile atteint le monde la première).
        if (x + 1 < width) { const j = i + 1; if (!vues[j] && walk(j) && !monde[j]) { vues[j] = 1; poche.push(j) } }
        if (x > 0) { const j = i - 1; if (!vues[j] && walk(j) && !monde[j]) { vues[j] = 1; poche.push(j) } }
        if (y + 1 < height) { const j = i + width; if (!vues[j] && walk(j) && !monde[j]) { vues[j] = 1; poche.push(j) } }
        if (y > 0) { const j = i - width; if (!vues[j] && walk(j) && !monde[j]) { vues[j] = 1; poche.push(j) } }
      }
      if (poche.length < POCHE_MIN) continue // du décor, pas un défaut

      if (percerVersLeMonde(g, poche, monde, terrain, zone, rampe, width, height, socle, regles)) ouvert = true
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
  rampe: Uint8Array,
  width: number,
  height: number,
  socle: Socle | null,
  regles: ReglesSol | null,
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

  // Le chemin, remonté depuis le monde : on le creuse à plat, dans la zone de la poche.
  const chemin: number[] = []
  for (let i: number | undefined = arrivee; i !== undefined; i = parent.get(i)) chemin.push(i)

  // On creuse un couloir PLAT (largeur `DEMI_RAMPE`) le long du chemin, sans jamais déborder chez le
  // voisin — c'est ce qui préserve le test destructif A5 (on ne perce jamais une frontière). Les
  // tuiles sont marquées `rampe` : ça les exempte du re-murage et les tient stériles, comme un seuil.
  const r = RELIEF.DEMI_RAMPE
  for (const c of chemin) {
    const cx = c % width
    const cy = (c - cx) / width
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < RELIEF.BORDURE || y < RELIEF.BORDURE || x >= width - RELIEF.BORDURE || y >= height - RELIEF.BORDURE) {
          continue
        }
        const i = y * width + x
        if (zone[i] !== zid) continue // on ne déborde jamais chez le voisin
        if (TERRAINS[terrain[i]!]?.walkable !== true) terrain[i] = solMarchableDe(g, zid, x, y, socle, regles)
        rampe[i] = 1
      }
    }
  }
  return true
}
