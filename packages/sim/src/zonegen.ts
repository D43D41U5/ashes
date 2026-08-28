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
  TERRAIN_WILLOW,
  TERRAIN_WET_MEADOW,
  TERRAIN_JUNIPER_HEATH,
} from './balance'
import { isWater, MARCHABLE, type WorldMap, type Zone as ZoneRect } from './map'
import { calculeChampDeCendre, computeCendreField, foyersDeLaCarte } from './cendre'
import { distSq } from './geometry'
import { placeCharniers, placePois, placeSteles } from './poi'
import { peindreLesClairieres } from './clairieres'
import { densiteDeBase } from './morts'
import { fbm2, hash2 } from './noise'
import { deriverDistanceEau, deriverProfondeur } from './profondeur'
import { deriverNatureDeLEau } from './peche-nature'
import { tracerLesCoulees } from './zonegen-coulees'
import { placeHuntingGrounds } from './faune'
import { masqueDesSeuils, paintWaterRacine, type Riviere } from './zonegen-water'
import { assainirLeProfondHorsRacine, peindreLesEauxDesZones } from './zonegen-eaux-zones'
import {
  CREUX,
  celluleDe,
  coifferLesCretes,
  composerLHumidite,
  composerLaRoche,
  familleDeCellule,
  grainDuSol,
  lireLeChampAt,
  lireLeChampGraine,
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
  type MondeGen,
  type Rect,
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
  /**
   * LES AFFLEUREMENTS du monde réduit (t0-exploration §2sexies) — le CONTENANT registré : le
   * semis des minerais et l'exclusion des villages les lisent ici, jamais en devinant le
   * terrain (les `boulders` ordinaires du pré ne sont pas des gisements). `[]` sur le plan
   * complet. Donnée de GÉNÉRATION : elle ne va ni dans `WorldMap` ni dans `SimState`.
   */
  affleurements: Affleurement[]
}

/**
 * LA GÉNÉRATION — et l'ordre des passes EST le sujet.
 *
 * On ne PEINT plus les falaises : on les CONSTATE. C'est tout le renversement du rectiligne, et il
 * se lit dans l'ordre ci-dessous — le sol, le relief, les portes… **et le mur en dernier**, déduit
 * de ce que les trois premières ont sculpté. Une falaise n'est plus une décision : c'est une
 * conséquence.
 */
export function generateZonedTerrain(
  seed: number,
  joueurs = MONDE.JOUEURS_CIBLE,
  monde: MondeGen = 'vallee',
): CarteZonee {
  const g = deriveGrapheZones(seed, joueurs, monde)
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

  // ── PASSE 1b-bis : LA ROCHE-MÈRE — le SECOND axe (spec `roche-mere.md` R1-R3) ──
  //
  // ⚠ ELLE SE COMPOSE ICI, ET PAS AILLEURS : le calcaire n'inonde pas (R4, passe 1.5) et son
  // drainage entre dans l'humidité avant les quantiles (R4, passe 1.55). Les deux la veulent
  // déjà faite. Comme le socle : jamais rendue, jamais dans `WorldMap` ni `SimState` — elle ne
  // vit que le temps de la génération, et le monde la relit en la RECALCULANT.
  if (creux) composerLaRoche(creux, seed)

  const regles = reglesDuSol(g, creux, seed)

  // ── PASSE 1c : LE SOL — chaque zone compose selon sa palette, DÉRIVÉE du socle (S-R10) ──
  //
  // ⚠ **LE CACHE PAR MOTIF SURVIT EXACTEMENT LÀ OÙ LE VERDICT EST ENCORE PAR MOTIF**
  // (`sol-dessine.md` R20, 2026-08-27). Depuis que la lecture est molle, une zone DÉRIVÉE rend un
  // verdict par tuile : il n'y a plus rien à mémoriser pour elle. Le chemin HISTORIQUE, lui,
  // échantillonne toujours au centre du carré de 8 — les Prés Bas (repeints par leurs propres
  // passes) et le Névé (de la neige, et rien d'autre), soit ~800 000 tuiles de la vallée. Les
  // servir sans cache, c'était recalculer six `gradientNoise2` par tuile pour une valeur
  // constante sur le carré : le cache est donc conservé pour elles seules, et il reste EXACT —
  // le prédicat est très exactement « cette zone passe-t-elle par le chemin historique ? ».
  const M_SOL = RELIEF.MOTIF
  const parMotif = new Uint8Array(g.zones.length)
  for (const z of g.zones) parMotif[z.id] = regles?.parZone[z.id] == null ? 1 : 0
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
      if (parMotif[z] === 0) { terrain[i] = solDe(g, z, x, y, creux, regles); continue }
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
  const { riviere, chenaux } = paintWaterRacine(terrain, zone, g, width, height, seed, RELIEF.BORDURE, creux)

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
  peindreLaVegetationRacine(terrain, zone, g, width, height, seed, creux, riviere, chenaux)

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
  //
  // ⚠ ELLE NE SE PEINT QUE S'IL Y A UNE CENDRIÈRE À ANNONCER (2026-08-24). Elle EST l'annonce
  // du feu — « de ton pas de porte, tu vois l'enfer » ; sans Cendrière au sud, elle posait une
  // bande calcinée de 40 tuiles le long du bord bas de la carte, qui n'annonce plus rien et qui
  // mange le T0 là où il vient justement de s'étendre.
  if (g.zones.some((z) => z.def.slug === 'cendriere')) {
    peindreLisiereSud(terrain, zone, g, width, height, seed)
  }

  // ── PASSE 1.59 : LES BOSQUETS DE CRÊTE — le bois SEC, et le repère du haut pays ───────────
  //
  // Demande d'Alexis, 2026-07-29 : « quelques patchs de forêt déposés de manière équilibrée loin
  // des points d'eau ». APRÈS la lisière sud, et c'est ce qui les tient hors du sud calciné : la
  // passe ne coiffe que l'herbe et la fleuraie, or la lisière a déjà pris ce qui lui revient.
  peindreLesBosquetsDeCrete(terrain, zone, g, width, height, seed, creux)

  // ── PASSE 1.595 : LES LISIÈRES — l'écotone pré/bois entrelacé, hors Racine (S-R11) ──
  entrelacerLesLisieres(terrain, zone, g, width, height, seed)

  // ── PASSE 1.6 : LES SET-PIECES — trois endroits à grande empreinte, COURONNÉS et non plus
  //    posés (spec t0-exploration R9, révisé §2quinquies : élection pure, aucun tirage) ──
  const setPieces = placerLesSetPieces(terrain, zone, g, width, height)

  // ── PASSE 1.62 : LES CLAIRIÈRES — le biome des trouées (décision d'Alexis, 2026-08-25) ──
  //
  // APRÈS tout ce qui pose du bois (le sol, la lisière sud, les bosquets de crête, les lisières
  // entrelacées, les set-pieces — le Bois Noir a droit à ses trouées comme le reste), et AVANT
  // les sentes : une sente qui traverse une clairière la recouvre, comme elle recouvre un bois.
  // La passe ne mord QUE du boisé, tuile par tuile — voir `clairieres.ts` : c'est ce qui laisse
  // `deriverProfondeur` bit à bit identique.
  peindreLesClairieres(terrain, zone, g.racine, width, height, seed)

  // ── PASSE 1.7 : LES SENTES — les routes du pays d'avant, et leurs gués (R17, R7) ──
  // Elles CONTOURNENT les set-pieces (R18 : un lieu se poste au bord du chemin) ; et la
  // garantie « au moins deux gués » vit à part, indépendante des aléas du traceur.
  const { gues, croisees } = tracerLesSentes(terrain, zone, g, width, height, seed, riviere, setPieces, creux)
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
   * Dérivé du diagramme de puissance comme la marge des frontières, mais lu AU BLOC : il épouse
   * la forme réelle de la Cendrière, angles droits compris.
   *
   * ⚠ CE N'EST PLUS UN MOTEUR (2026-08-24) : le front de cendre est retiré, la Cendrière ne fait
   * plus partie du monde joué, et ce champ ne sert qu'à DATER la reprise du versant Brûlé
   * (`peindreLesStadesDuBrule`) sur le plan complet, qui dort. Là où il n'y a pas de Cendrière,
   * il n'y a pas de champ — et chaque lecteur écrit ce qu'il fait dans ce cas.
   */
  const cendriere = g.zones.find((z) => z.def.slug === 'cendriere')
  const champCendre = cendriere === undefined ? undefined : computeCendreField(width, height, (x, y) => {
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
    // distance au site — une borne honnête.
    if (voisinAt(g, x, y) === cendriere.id) return m
    return Math.sqrt(distSq(x, y, cendriere.x, cendriere.y))
  })

  // ── LES AFFLEUREMENTS — la géologie du monde réduit (t0-exploration §2sexies) ────────────
  //
  // MONDE RÉDUIT SEUL : sur le plan complet la passe rend [] sans toucher UNE tuile — le fer
  // reste l'exclusivité du Karst (worldgen R9/A14), et le chemin 'vallee' reste octet-identique.
  // ELLE NE LIT PLUS LE CHAMP DE CENDRE (2026-08-24) : sa clause « hors d'atteinte du front »
  // (R48/R49 — un gisement que la cendre avale à mi-saison est une économie confisquée) n'a plus
  // d'objet, puisque plus rien n'avale. Le pré nu suffit à la porter.
  const affleurements = poserLesAffleurements(terrain, zone, g, width, height, creux)

  // ── LES STADES DU VERSANT BRÛLÉ (stratigraphie, couche IV) : la reprise, datée par le champ
  //    de cendre qu'on vient de poser. AVANT les lieux — le semis lit le terrain des stades.
  //    Sans Cendrière il n'y a ni champ ni zone « brûlé » : la passe n'a rien à dater.
  if (champCendre) peindreLesStadesDuBrule(terrain, zone, g, champCendre, width, height, seed)

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
    width, height, terrain, zones: toponymes(g), ...(champCendre ? { cendre: champCendre } : {}),
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
    // LES AFFLEUREMENTS (t0-exploration §2sexies), donnée de premier ordre : le client en tire
    // teinte, dalles et chicot — patron « seuils → bornes ». Omis quand il n'y en a pas (le
    // plan complet, les cartes d'avant) : additive, une vieille sauvegarde se relit sans.
    ...(affleurements.length > 0
      ? { affleurements: affleurements.map((a) => ({ ...a.rect, ressource: a.ressource })) }
      : {}),
    // LA PROFONDEUR INTRA-MASSIF (spec §2quater R38) — dérivée du terrain FINAL (les sentes
    // qui coupent un bois y creusent leur lisière), gelée à l'amorce, statique ensuite.
    profondeur: deriverProfondeur(terrain, zone, g.racine, width, height),
    // LA DISTANCE À L'EAU (S10) : ce qui permet à la crue de monter depuis les rives.
    distEau: deriverDistanceEau(terrain, width, height),
    // LA NATURE DE L'EAU (`peche.md` T1) : rivière / lac / mare / marais, par tuile. Dérivée du
    // terrain FINAL et du fil — donc APRÈS que les gués et les set-pieces ont fini de creuser.
    // Sans elle, la table de prises n'aurait aucun moyen de savoir ce qu'est l'eau qu'on pêche.
    natureEau: deriverNatureDeLEau(terrain, riviere?.fil, width, height),
  }
  // LES COULÉES (forêts-vivantes §4) — dérivées après la profondeur (elles lisent le pic) :
  // couche → eau, pour chaque massif à cœur qui boit. Champ additif, patron `fil`.
  // ET UNE PAR COIN DE CHASSE (faune R24/R26, décision d'Alexis 2026-08-28) : les coins se
  // calculent ICI, sur le terrain final — `placeHuntingGrounds` est pur de (carte, graine),
  // l'hôte qui le rappellera après rendra les MÊMES coins, au bit près. Sans ça, coulées et
  // coins ne se rencontraient jamais (deux semis indépendants — mesuré : 28-448 tuiles d'écart).
  const coulees = tracerLesCoulees(
    terrain, zone, g, width, height, map.profondeur!, creux,
    placeHuntingGrounds(map, seed),
  )
  if (coulees.length > 0) map.coulees = coulees
  const carte: CarteZonee = { map, graphe: g, zone, rampe, affleurements }

  // ── PASSE 4.5 : LES SET-PIECES ET LES GUÉS ENTRENT DANS LA CARTE ──────────
  //
  // AVANT les lieux : le semis de Poisson écarte ses points de tout lieu déjà enregistré
  // (spec t0-exploration R10) — un Cairn au milieu du Cercle de pierres n'est pas un Cairn.
  // Les set-pieces sont des LIEUX (kind : ils se découvrent, la garde A19 les couvre) ; les
  // gués sont des TOPONYMES (un nom qu'on foule, pas une pastille).
  for (const p of setPieces) {
    map.zones.push({ name: p.nom, x: p.x, y: p.y, w: p.w, h: p.h, kind: p.kind })
    // LA GRAVURE d'un set-piece de pierres (annales, ère 0) : le Cercle n'entre jamais dans
    // `placeOne` (il est posé ici, pas semé), son fait s'écrit donc ici — même clef de centre
    // que `faitsDuLieu`, sans quoi le lecteur ne le retrouverait pas.
    if (p.kind === 'cercle_pierres') {
      ;(map.annales ??= []).push({
        ere: 0, type: 'gravure',
        x: Math.floor(p.x + p.w / 2), y: Math.floor(p.y + p.h / 2), lieu: p.kind,
      })
    }
  }
  for (const q2 of gues) {
    map.zones.push({ name: 'le Gué', x: q2.x - 3, y: q2.y - 3, w: 7, h: 7 })
    // Les annales (S-R16) : un gué est un fait de l'ère des routes — le point où le pays
    // d'avant a choisi de franchir son eau.
    ;(map.annales ??= []).push({ ere: 2, type: 'gue', x: q2.x, y: q2.y })
  }
  // LES CROISÉES et LES PORTES — l'ère des routes complète son état civil (spec `annales.md`
  // R2). Des LECTURES de ce que les passes ont déjà décidé : zéro tirage, zéro tuile touchée.
  for (const c of croisees) {
    ;(map.annales ??= []).push({ ere: 2, type: 'croisee', x: c.x, y: c.y })
  }
  // Le pays d'avant BORNAIT ses portes (les bornes de seuil du client le montrent déjà —
  // t0-exploration R4) ; le fait donne au lecteur le droit de le dire. Une porte de secours
  // porte sa cause : le passage qu'on se méritait déjà.
  for (const s of map.seuils ?? []) {
    ;(map.annales ??= []).push({ ere: 2, type: 'porte', x: s.x, y: s.y, ...(s.secours ? { cause: 'secours' } : {}) })
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
  // LES STÈLES (annales.md R8) : en DERNIER — elles se posent au bord des faits de l'ère 2 en
  // respectant les empreintes de tous les lieux déjà placés.
  placeSteles(map, champDeCreusement)

  // ── LE CHAMP DE CHEMINEMENT DE LA CENDRE (spec `cendre.md` R4) ───────────────────────────
  //
  // APRÈS `placeCharniers`, forcément : les fosses SONT les sources. Une passe de plus au patron
  // de `distEau` — un balayage, un champ statique, plus rien à calculer ensuite. Sur une carte
  // sans charnier (bancs, tests) il rend deux tableaux de `-1` et rien ne brûle jamais.
  //
  // ⚠ MONDE RÉDUIT SEUL, et c'est le précédent de ce fichier (`poserLesAffleurements`,
  //   `carrieresDeLEnceinte`) : les passes de CONTENU ne tournent que là où l'on joue. Ici la
  //   raison est chiffrée — le plan complet porte **51 fosses sur 3,75 M de tuiles** et la passe y
  //   coûte **2,2 s**, ce qui fait sauter le budget A13 (une carte de production naît en moins de
  //   15 s). Le jour où la vallée entière se jouera, elle paiera ce prix avec le reste ; en
  //   attendant, on ne le paie pas pour un plan qui dort.
  if (g.monde === 'racine') {
    const foyers = foyersDeLaCarte(map)
    if (foyers.length > 0) {
      map.cendreCout = calculeChampDeCendre(width, height, terrain, foyers)
    }
  }

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
  riviere: Riviere | null,
  chenaux: readonly number[],
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
      // L'ÉCHELLE À CINQ ÉTAGES (spec §2ter R32) : prairie humide → bosquet → herbe →
      // fleuraie → lande à genévriers. Un champ, un ordre.
      const v = vegetationAt(creux, x, y)
      terrain[i] =
        v === 2 ? TERRAIN_WET_MEADOW
        : v === 1 ? TERRAIN_FOREST
        : v === -1 ? TERRAIN_FLOWER_MEADOW
        : v === -2 ? TERRAIN_JUNIPER_HEATH
        : TERRAIN_GRASS
    }
  }

  // ═══ LA SAULAIE — le bois de l'eau qui COULE (spec §2ter R33) ═══
  //
  // Dérivée du réseau que le module d'eau publie : le fil de LA rivière (galerie large) et
  // les chenaux entre lacs (galerie modeste). Cœur plein contre la berge, frange effilochée
  // par motif ('RIPI', quantifié au bloc). Elle ne cède que le thème du pré, cinq
  // étages compris (les étages de R32) : l'eau, le marais, la roselière, la roche gardent leur nature. Les
  // passes ultérieures gardent leur priorité — set-pieces (1.6), sentes et gués (1.7) et la
  // lisière sud (1.58) la traversent ou la convertissent.
  //
  // Les CHENAUX s'estampent HORS du `if (riviere)` : une Racine dégénérée sans rivière garde
  // ses ruisseaux entre lacs — et leur saulaie (les chenaux sont publiés par construction,
  // voir `EauxDeLaRacine`).
  const selRipi = (seed ^ 0x52495049) | 0 /* 'RIPI' */
  const M = RELIEF.MOTIF
  const cede = (t: number): boolean =>
    t === TERRAIN_GRASS || t === TERRAIN_FOREST || t === TERRAIN_FLOWER_MEADOW ||
    t === TERRAIN_WET_MEADOW || t === TERRAIN_JUNIPER_HEATH
  const estamper = (sources: readonly number[], plein: number, frange: number): void => {
    for (const i0 of sources) {
      const cx = i0 % width
      const cy = (i0 - cx) / width
      for (let dy = -frange; dy <= frange; dy++) {
        for (let dx = -frange; dx <= frange; dx++) {
          const x = cx + dx
          const y = cy + dy
          if (x < x0 || y < y0 || x >= x1 || y >= y1) continue
          const i = y * width + x
          if (zone[i] !== g.racine || !cede(terrain[i]!)) continue
          const d = Math.max(Math.abs(dx), Math.abs(dy))
          if (d > plein && hash2(Math.floor(x / M), Math.floor(y / M), selRipi) >= CREUX.RIPI_BASCULE) continue
          terrain[i] = TERRAIN_WILLOW
        }
      }
    }
  }
  if (riviere) estamper(riviere.fil, CREUX.RIPI_FIL_PLEIN, CREUX.RIPI_FIL_FRANGE)
  estamper(chenaux, CREUX.RIPI_RU_PLEIN, CREUX.RIPI_RU_FRANGE)
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
  /** Une TUILE accepte-t-elle d'être boisée ? Le pré, la fleuraie — et la lande à genévriers
   *  (spec §2ter R37) : le mot sec s'installe précisément là où naissent les conifères de
   *  crête, l'exclure les affamerait. La prairie humide, elle, reste nue : un fond mouillé
   *  ne porte pas le bois sec. */
  const tuileLibre = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const i = y * width + x
    if (zone[i] !== g.racine) return false
    const t = terrain[i]!
    return t === TERRAIN_GRASS || t === TERRAIN_FLOWER_MEADOW || t === TERRAIN_JUNIPER_HEATH
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
  const horsSeuils = masqueDesSeuils(creux, g, g.racine)
  const bosquets = coifferLesCretes(creux, horsSeuils, peignable)
  if (bosquets.length === 0) return

  // ═══ LE CONTOUR DU BOSQUET EST UNE LIGNE DE NIVEAU, LUE À LA TUILE (R23, 2026-08-27) ═══
  //
  // (Retour d'Alexis : *« il y a toujours des patterns carrés, au niveau de pine et larch vs le
  // reste »* — et il avait raison là où R21 s'était arrêtée. R21 n'avait réparé que l'ESSENCE
  // À L'INTÉRIEUR du bois ; son CONTOUR restait une union de carrés de 8, remplis d'un bloc.
  // MESURÉ, seed 2026 : herbe/mélèzes 69,6 % des bords portés par un segment droit de 8 tuiles
  // ou plus, sur 6 813 bords — le dernier gros damier de la carte.)
  //
  // Le bosquet ÉTAIT déjà une ligne de niveau : `coifferLesCretes` garde les cellules dont
  // l'altitude dépasse `plancher`. On ne change donc pas la règle, on la lit à la bonne échelle.
  // La MARGE (`altLarge − plancher`) devient un champ de cellules, et le peintre en prend le
  // niveau zéro par la LECTURE MOLLE : bilinéaire entre les quatre cellules qui entourent la
  // tuile, plus le grain. La recette exacte du lapiaz et de la butte d'affleurement.
  //
  // ⚠ **DEUX COURONNES, PAS UNE.** Une tuile du bord d'une cellule lit une cellule au-delà ; une
  // tuile de la première couronne en lit deux. Sans la seconde, la sentinelle (très négative)
  // rentrerait dans l'interpolation et retaillerait un bord DROIT à la frontière de la couronne :
  // on aurait déplacé le carré d'un cran, pas supprimé.
  //
  // ⚠ **LA COURONNE RESPECTE LE MASQUE DES SEUILS** : un bosquet ne nourrit pas une porte
  // (worldgen R10.3), et le débord n'est pas une porte dérobée.
  const nCell = creux.cols * creux.rows
  const SENTINELLE = -1 // bien en dessous de toute marge réelle : `altLarge` vit dans [0, 1]
  const marge = new Float64Array(nCell).fill(SENTINELLE)
  const ecrit = new Uint8Array(nCell)
  for (const bosquet of bosquets) {
    let front = bosquet.cellules.slice()
    for (const k of front) { marge[k] = creux.altLarge[k]! - bosquet.plancher; ecrit[k] = 1 }
    for (let anneau = 0; anneau < 2; anneau++) {
      const suivant: number[] = []
      for (const k of front) {
        const kx = k % creux.cols
        const ky = (k - kx) / creux.cols
        const voisines = [
          kx > 0 ? k - 1 : -1,
          kx + 1 < creux.cols ? k + 1 : -1,
          ky > 0 ? k - creux.cols : -1,
          ky + 1 < creux.rows ? k + creux.cols : -1,
        ]
        for (const v of voisines) {
          if (v < 0 || ecrit[v] === 1) continue
          if (creux.dedans[v] !== 1 || horsSeuils[v] === 0) continue
          marge[v] = creux.altLarge[v]! - bosquet.plancher
          ecrit[v] = 1
          suivant.push(v)
        }
      }
      front = suivant
    }
  }

  const sel = (seed ^ 0x43524554) | 0 /* 'CRET' */
  for (let k = 0; k < nCell; k++) {
    if (ecrit[k] !== 1) continue
    const kx = k % creux.cols
    const tx0 = (creux.mx0 + kx) * M
    const ty0 = (creux.my0 + (k - kx) / creux.cols) * M
    // ⚠ **L'ESSENCE AUSSI EST MOLLE** (R21) : pin ou mélèze se tirait à PILE OU FACE PAR MOTIF
    // (`hash2` au centre du carré de 8), donc un bois de montagne sortait en damier, huit tuiles
    // par case — MESURÉ, seed 42 : 28,6 % des bords pin/mélèze portés par un segment droit de 8+
    // tuiles, quand le reste de la carte est à 3 %. Le mélange voulu était le bon ; c'est le
    // TIRAGE qui était faux. Il vient du même champ que le haut bois des zones.
    for (let dy = 0; dy < M; dy++) {
      const y = ty0 + dy
      for (let dx = 0; dx < M; dx++) {
        const x = tx0 + dx
        // LE VÉTO EST À LA TUILE, et il n'a plus besoin d'être à la cellule. `peignable` exigeait
        // les 64 tuiles libres pour que les tuiles refusées ne COUPENT pas un bosquet plein ; un
        // bord déjà dentelé n'a pas ce souci — et `tuileLibre` reste la vérité (ni eau, ni sente,
        // ni prairie humide sous un bois sec). `peignable` garde son rôle d'ÉLECTION dans
        // `coifferLesCretes` : le compte et la taille des bosquets ne bougent pas.
        if (!tuileLibre(x, y)) continue
        if (lireLeChampAt(creux, marge, x, y, sel, CREUX.CRETE_GRAIN_CONTOUR) <= 0) continue
        terrain[y * width + x] = hautBoisAt(g, x, y, grainDuSol(x, y, sel) * CREUX.GRAIN_TUILE_AMPLITUDE)
      }
    }
  }
}

/**
 * ═══ LES AFFLEUREMENTS — la géologie donne le minerai (spec t0-exploration §2sexies) ═══
 *
 * MONDE RÉDUIT SEUL (plan `'racine'`). Sur les dos les plus hauts et les plus secs du pays, la
 * terre s'use jusqu'à l'os : une petite rocaille de pierrier perce le pré. Même famille que les
 * bosquets de crête — le chapeau sur la bosse — mais l'élection est PAR RANG GLOBAL : on prend
 * les quelques sommets les plus hauts du pays entier, écartés entre eux, pas une couverture par
 * grille. Un affleurement est un événement géologique, pas un semis (R47).
 *
 * L'identité (ferreux/charbonneux) suit le RANG : `CREUX.AFFL_IDENTITES`, du plus haut sommet au
 * dernier — zéro tirage, la géologie décide (R48). Le PLANCHER (R51) : si la bande sèche ne
 * fournit pas assez de sommets, on relâche la sécheresse et on force au meilleur rang — la
 * sécheresse cède avant le compte, jamais l'inverse.
 *
 * Le semis des nœuds (`iron_vein`/`coal_seam` SUR la rocaille) vit dans `zone-content.ts` — ici
 * on ne fait que la géologie, et on la REGISTRE (`CarteZonee.affleurements`) : le contenant est
 * une donnée, pas une devinette de terrain (les `boulders` ordinaires du pré n'en sont pas).
 */
export interface Affleurement {
  rect: Rect
  ressource: 'fer' | 'charbon'
}

/** Le rayon qu'aurait une butte parfaitement ronde, en tuiles — l'unité dans laquelle se compte
 *  l'éloignement au sommet (`AFFL_COMPACITE`). √(320/π) ≈ 10,1 ; écrit en dur parce qu'il DÉRIVE
 *  de `AFFL_TUILES` et que `/sim` n'a pas droit à `Math.PI ** 0.5` — la constante suffit, et le
 *  test de forme (R6sexies ①) verrait tout de suite un réglage qui ne tient plus. */
const RAYON_DE_BUTTE = 10.1

function poserLesAffleurements(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  creux: Creux | null,
): Affleurement[] {
  if (g.monde !== 'racine' || !creux) return []
  const M = RELIEF.MOTIF
  const n = creux.cols * creux.rows

  // La rocaille ne coiffe que le pré, la fleuraie et la lande (R47) — motif ENTIER, la leçon
  // des bosquets : une miette de pierrier au milieu d'un pré se lit comme une erreur.
  // (La clause « hors d'atteinte du front » est tombée le 2026-08-24 avec le front lui-même :
  // plus rien n'avale un gisement, donc plus rien à mettre hors d'atteinte.)
  const tuileLibre = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const i = y * width + x
    if (zone[i] !== g.racine) return false
    const t = terrain[i]!
    return t === TERRAIN_GRASS || t === TERRAIN_FLOWER_MEADOW || t === TERRAIN_JUNIPER_HEATH
  }
  const peignable = (tx0: number, ty0: number): boolean => {
    for (let dy = 0; dy < M; dy++) {
      for (let dx = 0; dx < M; dx++) if (!tuileLibre(tx0 + dx, ty0 + dy)) return false
    }
    return true
  }

  // Les deux masques des bosquets de crête, à l'identique : `libre` fait la forme, `sec`
  // qualifie le sommet (la sécheresse EST l'éloignement de l'eau, par dérivation).
  const horsSeuils = masqueDesSeuils(creux, g, g.racine)
  const libre = new Uint8Array(n)
  const sec = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    if (creux.dedans[k] !== 1) continue
    if (horsSeuils.length > 0 && horsSeuils[k] === 0) continue
    const kx = k % creux.cols
    const ky = (k - kx) / creux.cols
    if (!peignable((creux.mx0 + kx) * M, (creux.my0 + ky) * M)) continue
    libre[k] = 1
    if (creux.hum[k]! < creux.seuilFleuraie) sec[k] = 1
  }

  const pris = new Uint8Array(n)
  const sommets: { kx: number; ky: number }[] = []
  const affs: Affleurement[] = []
  for (const ressource of CREUX.AFFL_IDENTITES) {
    // ── LE SOMMET : le plus haut du pays parmi les candidates écartées des buttes déjà prises.
    //    Deux tours : la bande sèche d'abord ; si elle est vide, le plancher R51 relâche `sec`.
    // ═══ LA ROCHE DONNE LE MINERAI (spec `roche-mere.md` R12-R13) ═══
    //
    // Le fer est un filon de contact (GRANITE), la houille un bassin sédimentaire (ARGILE), et
    // le CALCAIRE ne porte ni l'un ni l'autre — un carbonate pur n'a rien à donner. La
    // prospection cesse d'être une loterie et devient une lecture de carte : *sur le calcaire,
    // il n'y a pas de fer.* L'identité suivait le RANG du sommet, un ordre invisible au joueur.
    //
    // ⚠ **LA CASCADE EST LA RÈGLE, PAS UNE PRÉCAUTION — la dérivation nue casse le jeu une fois
    // sur trois.** MESURÉ (`tools/__diag-buttes.mts`, 10 seeds) sur « la butte prend le minerai
    // de la roche où elle tombe » : **3 seeds sur 10 perdent tout leur charbon ou tout leur
    // fer** (aucune butte sur argile, ou aucune sur granite), et **22 buttes sur 50 (44 %)**
    // tombent sur le calcaire, donc stériles. Ce n'est pas une pénurie de terrain — celui-ci est
    // équi-réparti entre les trois provinces (29-39 / 33-37 / 28-36 %) — c'est qu'on n'élit que
    // CINQ buttes au rang global : cinq tirages dans trois provinces laissent souvent une
    // province vide. Descendre le rang pour trouver la bonne roche coûte un sommet plus bas.
    //
    // L'ORDRE DES CRANS DIT CE QUI COMPTE : **la sécheresse cède avant la roche, la roche cède
    // avant le compte, et le compte ne cède jamais.** R51 disait déjà la moitié de cette phrase.
    // `familleDeCellule` : −1 calcaire · 0 granite · +1 argile.
    const famVoulue = ressource === 'fer' ? 0 : 1
    const CRANS: { roche: 'voulue' | 'hors_calcaire' | 'toute'; sec: boolean }[] = [
      { roche: 'voulue', sec: true },
      { roche: 'voulue', sec: false },
      { roche: 'hors_calcaire', sec: true },
      { roche: 'hors_calcaire', sec: false },
      { roche: 'toute', sec: true },
      { roche: 'toute', sec: false },
    ]
    let sommet = -1
    for (const cran of CRANS) {
      const exigeSec = cran.sec
      let haut = -Infinity
      for (let k = 0; k < n; k++) {
        if ((exigeSec ? sec[k] : libre[k]) !== 1 || pris[k] === 1) continue
        if (cran.roche !== 'toute') {
          const f = familleDeCellule(creux, k)
          if (cran.roche === 'voulue' ? f !== famVoulue : f === -1) continue
        }
        const kx = k % creux.cols
        const ky = (k - kx) / creux.cols
        let loin = true
        for (const s of sommets) {
          const dx = kx - s.kx
          const dy = ky - s.ky
          if (dx * dx + dy * dy < CREUX.AFFL_ECART * CREUX.AFFL_ECART) { loin = false; break }
        }
        if (!loin) continue
        const a = creux.altLarge[k]!
        if (a > haut || (a === haut && k < sommet)) { haut = a; sommet = k }
      }
      if (sommet >= 0) break
    }
    if (sommet < 0) continue // plus une cellule libre dans tout le pays — la garde A28 le verra

    // ══ LE CHAPEAU SE FAIT À LA TUILE, PLUS À LA CELLULE (R6bis étendu aux buttes, 2026-08-27)
    //
    // Il empilait 2 à 5 carrés de 8×8 : mesuré, **100 % de ses segments de bord faisaient
    // ≥ 8 tuiles** (3/3, 5/5, 6/6 sur trois graines) — le défaut du lapiaz, en pire, puisqu'une
    // butte n'a que cinq cellules pour se donner une silhouette.
    //
    // On croît donc TUILE À TUILE, en prenant toujours **la plus haute de la frontière** :
    // le contour est alors la ligne de niveau qui enferme exactement `AFFL_TUILES` tuiles.
    // Trois propriétés, toutes par construction et non par garde — c'est ce qui rend le
    // remplacement franc :
    //   ① ORGANIQUE : une ligne de niveau d'un champ mou (bilinéaire + grain) n'a aucun bord droit ;
    //   ② BORNÉE : le plafond en tuiles remplace exactement le plafond en cellules, aire égale ;
    //   ③ CONNEXE : la croissance part du sommet et ne franchit que des voisines.
    // La whitelist de terrain se relit PAR TUILE (`tuileLibre`) : une butte contourne la
    // rivière et la route au lieu de les recouvrir — « seul le THÈME cède », la règle du fichier.
    // Deux bornes, et la seconde est GÉOLOGIQUE : le plafond en tuiles donne la taille, et
    // `AFFL_CHAPEAU` interdit de descendre sous le ras de l'os — sans lui, une butte qui n'a pas
    // 320 tuiles de sommet à sa disposition irait les chercher au fond de la vallée voisine.
    const plancher = creux.altLarge[sommet]! - CREUX.AFFL_CHAPEAU
    const selContour = (g.seed ^ 0x41464643) | 0 /* 'AFFC' */
    const altMolle = (x: number, y: number): number =>
      lireLeChampAt(creux, creux.altLarge, x, y, selContour, CREUX.AFFL_GRAIN_CONTOUR)

    const skx0 = sommet % creux.cols
    const sky0 = (sommet - skx0) / creux.cols
    // La tuile de départ : le centre de la cellule du sommet.
    const departX = (creux.mx0 + skx0) * M + M / 2
    const departY = (creux.my0 + sky0) * M + M / 2
    const depart = departY * width + departX

    const capT: number[] = []
    const dansCap = new Set<number>()
    let front: number[] = []
    const enFront = new Set<number>()
    if (tuileLibre(departX, departY)) {
      front.push(depart)
      enFront.add(depart)
    }
    while (capT.length < CREUX.AFFL_TUILES && front.length > 0) {
      // La plus haute de la frontière, PÉNALISÉE PAR L'ÉLOIGNEMENT AU SOMMET — départage par
      // index, donc déterministe. Sans la pénalité, la croissance suit la crête et la butte
      // s'étire en ruban (mesuré en jeu : 18 % de remplissage de sa boîte).
      let meilleur = 0
      let hMax = -Infinity
      for (let f = 0; f < front.length; f++) {
        const i = front[f]!
        const ix = i % width
        const iy = (i - ix) / width
        const ex = ix - departX
        const ey = iy - departY
        const a = altMolle(ix, iy)
          - CREUX.AFFL_COMPACITE * Math.sqrt(ex * ex + ey * ey) / RAYON_DE_BUTTE
        if (a > hMax) { hMax = a; meilleur = f }
      }
      const i = front[meilleur]!
      front[meilleur] = front[front.length - 1]!
      front.pop()
      enFront.delete(i)
      capT.push(i)
      dansCap.add(i)
      const ix = i % width
      const iy = (i - ix) / width
      for (const v of [ix > 0 ? i - 1 : -1, ix + 1 < width ? i + 1 : -1, iy > 0 ? i - width : -1, iy + 1 < height ? i + width : -1]) {
        if (v < 0 || dansCap.has(v) || enFront.has(v)) continue
        const vx = v % width
        const vy = (v - vx) / width
        if (!tuileLibre(vx, vy) || altMolle(vx, vy) < plancher) continue
        front.push(v)
        enFront.add(v)
      }
    }
    front = []
    if (capT.length === 0) continue // le sommet lui-même n'était pas peignable — A28 le verra

    // ── LA PEINTURE, et le REGISTRE : la boîte englobante des TUILES peintes (plus des motifs).
    //    A29 exige que chaque nœud de minerai tombe dans un rect registré ; une tuile dentelée
    //    hors de la bbox des motifs y serait « hors de toute butte ».
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const i of capT) {
      terrain[i] = TERRAIN_SCREE
      const ix = i % width
      const iy = (i - ix) / width
      if (ix < x0) x0 = ix
      if (iy < y0) y0 = iy
      if (ix + 1 > x1) x1 = ix + 1
      if (iy + 1 > y1) y1 = iy + 1
    }
    // Les CELLULES touchées sont marquées prises : l'écartement des buttes suivantes
    // (`AFFL_ECART`) et l'élection se raisonnent toujours à la maille du motif.
    for (let cy = Math.floor(y0 / M); cy <= Math.floor((y1 - 1) / M); cy++) {
      for (let cx = Math.floor(x0 / M); cx <= Math.floor((x1 - 1) / M); cx++) {
        const kx = cx - creux.mx0
        const ky = cy - creux.my0
        if (kx < 0 || ky < 0 || kx >= creux.cols || ky >= creux.rows) continue
        pris[ky * creux.cols + kx] = 1
      }
    }
    sommets.push({ kx: skx0, ky: sky0 })
    affs.push({ rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, ressource })
  }
  return affs
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
  /**
   * Amplitude du grain qui BROUILLE la limite des stades (± la moitié), en tuiles de distance
   * au front. Sans lui, chaque bande serait une courbe de niveau propre — et morte.
   */
  DITHER: 26,
  /**
   * L'échelle de ce grain, en tuiles (`sol-dessine.md` R24, 2026-08-27).
   *
   * ⚠ IL ÉTAIT TIRÉ PAR MOTIF, ET C'EST CE QUI DÉCOUPAIT LA SUCCESSION EN CARRÉS : un saut de
   * ±13 tuiles de distance au front à chaque arête de motif, donc une limite de stade qui
   * tombait sur la grille de 8. MESURÉ, seed 2026 : lande/calciné 65,8 % de bords portés par un
   * segment droit de 8 tuiles ou plus, herbe/mélèzes 68,2 %. 28 tuiles : l'ordre de grandeur du
   * déplacement qu'il produit — un grain plus fin ferait de la dentelle sur une frontière qui
   * doit se lire comme une avancée du feu.
   */
  DITHER_ECHELLE: 28,
  /** La part de mélèzes semés dans la bande pionnière — les éclaireurs du bois. */
  MELEZES_PIONNIERS: 0.16,
  /** L'échelle des taches de pionniers, en tuiles : des bosquets d'éclaireurs, pas un semis. */
  PIONNIERS_ECHELLE: 34,
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
  /**
   * ET LE CHAMP DES PIONNIERS, ÉCHANTILLONNÉ AU MÊME PAS — parce que sa part est un CONTRAT.
   *
   * ⚠ `fbm2` N'EST PAS UNIFORME : c'est une cloche centrée sur 0,5 d'écart-type ≈ 0,17. Le
   * comparer directement à `MELEZES_PIONNIERS` = 0,16 ne sèmerait pas 16 % de la bande mais
   * **2,6 %** (0,16 est à deux écarts-types du centre). On prend donc le QUANTILE du champ sur
   * la zone, exactement comme pour les stades : la part reste vraie quel que soit le bruit.
   */
  const pions: number[] = []
  for (let y = 0; y < height; y += M) {
    for (let x = 0; x < width; x += M) {
      const i = y * width + x
      if (zone[i] !== brule.id) continue
      dists.push(champCendre[i]!)
      pions.push(fbm2(x, y, STADES_BRULE.PIONNIERS_ECHELLE, (sel ^ 0x504e) | 0 /* 'PN' */))
    }
  }
  if (dists.length < 32) return
  /** Le quantile d'un échantillon, par histogramme d'entiers — déterministe, sans tri. */
  const quantileDe = (vals: readonly number[], part: number): number => {
    let lo = Infinity
    let hi = -Infinity
    for (const d of vals) {
      if (d < lo) lo = d
      if (d > hi) hi = d
    }
    const etendue = hi - lo || 1
    const SEAUX = 1024
    const hist = new Int32Array(SEAUX)
    for (const d of vals) {
      let b = Math.floor(((d - lo) / etendue) * SEAUX)
      if (b < 0) b = 0
      if (b >= SEAUX) b = SEAUX - 1
      hist[b]!++
    }
    const cible = Math.floor(vals.length * part)
    let cum = 0
    for (let b = 0; b < SEAUX; b++) {
      cum += hist[b]!
      if (cum > cible) return lo + ((b + 1) / SEAUX) * etendue
    }
    return hi
  }
  const qSterile = quantileDe(dists, STADES_BRULE.PART_STERILE)
  const qLande = quantileDe(dists, STADES_BRULE.PART_LANDE)
  const qPionnier = quantileDe(dists, STADES_BRULE.PART_PIONNIER)
  const qPion = quantileDe(pions, STADES_BRULE.MELEZES_PIONNIERS)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (zone[i] !== brule.id) continue
      const t = terrain[i]!
      // Seul le THÈME cède (calciné, lande, herbe) : l'eau, la roche, les routes et tout ce
      // que d'autres passes ont posé gardent leur nature — la règle de toutes les passes.
      if (t !== TERRAIN_BURNT_FOREST && t !== TERRAIN_HEATH && t !== TERRAIN_GRASS && t !== TERRAIN_LARCH) continue
      // LE GRAIN EST À LA TUILE, PLUS AU MOTIF (R24) : le champ de cendre est continu, c'est le
      // dither qui découpait la succession en carrés de 8.
      const d = champCendre[i]!
        + (fbm2(x, y, STADES_BRULE.DITHER_ECHELLE, sel) - 0.5) * STADES_BRULE.DITHER
      if (d < qSterile) terrain[i] = TERRAIN_BURNT_FOREST
      else if (d < qLande) terrain[i] = TERRAIN_HEATH
      else if (d < qPionnier) {
        // Les ÉCLAIREURS : un champ, comparé à SON quantile — donc 16 % de la bande, en taches.
        terrain[i] = fbm2(x, y, STADES_BRULE.PIONNIERS_ECHELLE, (sel ^ 0x504e) | 0) < qPion
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
      // Seul le THÈME du pré cède : les cinq étages de l'échelle ET la saulaie (spec §2ter
      // R36 — dans la bande du gradient, rien ne perce l'annonce du feu). L'eau, le marais,
      // la roche et tout ce que les autres passes poseront gardent leur nature.
      if (t !== TERRAIN_GRASS && t !== TERRAIN_FOREST && t !== TERRAIN_FLOWER_MEADOW
        && t !== TERRAIN_WILLOW && t !== TERRAIN_WET_MEADOW && t !== TERRAIN_JUNIPER_HEATH) continue
      const mx = Math.floor(x / M)
      const my = Math.floor(y / M)
      const v = sud - y + (hash2(mx, my, sel) - 0.5) * LISIERE_SUD.DITHER
      if (v < LISIERE_SUD.PLEIN) terrain[i] = TERRAIN_BURNT_FOREST
      else if (v < LISIERE_SUD.LANDE) terrain[i] = TERRAIN_HEATH
    }
  }
}

/**
 * ═══ LA MOLLESSE DES FRONTIÈRES — le réglage se juge EN REGARDANT UNE CARTE, il vit donc ici ═══
 *
 * (Retour d'Alexis, 2026-08-27 : *« beaucoup de frontières de biomes sont trop droites (scree vs
 * boulder par exemple) ; il faudrait trouver une gestion universelle des frontières entre biomes
 * de même hauteur. »* — MESURÉ avant d'écrire une ligne, seed 2026, vallée entière, part des
 * segments de bord rectilignes de ≥ 8 tuiles : pins/mélèzes **99,5 %**, éboulis/blocs **87,4 %**,
 * blocs/brûlé **100 %**, alpage/fleurs **99,5 %**, tourbe/roselière **98,4 %** — quand le pré des
 * Prés Bas est à **1-3 %** depuis `sol-dessine` (2026-08-22). Le pré avait été réparé ; la
 * réparation n'avait jamais quitté la Racine.)
 */
const SOL_MOU = {
  /**
   * LE SEL DU GRAIN DU SOL — un seul pour toute la carte, et c'est le point.
   *
   * Le grain est tiré UNE fois par tuile (`grainDuSol`) et sert les trois verdicts du sol :
   * l'accent, la tache, l'essence du haut bois. Deux sels différents feraient deux dentelles
   * étrangères sur la même tuile. Il reste distinct de celui de l'humidité de la Racine
   * (`selGrain`) : deux bords qui partageraient leur grain se ressembleraient — la même dentelle,
   * décalée.
   */
  SEL: 0x534f4c4d, /* 'SOLM' */
  /**
   * L'ÉCHELLE DU PARTAGE PIN / MÉLÈZE, en tuiles.
   *
   * L'essence du haut bois était un PILE-OU-FACE PAR MOTIF (`hash2` au centre du carré de 8) :
   * pas une forme, une mosaïque — 27 939 bords, 99,5 % rectilignes, la plus grosse couture de la
   * carte. Un `hash2` par TUILE ne la répare pas, il la remplace par des confettis : il faut un
   * CHAMP. 40 tuiles — deux écrans de large : des peuplements qu'on traverse, pas des taches.
   * CALIBRÉ à la mesure (11,9 % de segments ≥ 8, contre 99,5 % avant).
   */
  ECHELLE_HAUT_BOIS: 40,
  /** Le sel du champ des essences — jamais celui du grain, jamais celui d'une palette. */
  SEL_HAUT_BOIS: 0x424f4953, /* 'BOIS' */
} as const

/**
 * L'ESSENCE DU HAUT BOIS — pin ou mélèze, décidée par un CHAMP et non par un tirage.
 *
 * Le grain lui arrive du sol (déjà multiplié par son amplitude) : c'est ce qui donne au bord des
 * peuplements la même dentelle qu'aux taches et aux accents de la même tuile. Sans lui, le seuil
 * d'un `fbm2` rend des contours lisses — propres, et morts (la leçon de `LAPIAZ.GRAIN_CONTOUR`).
 */
function hautBoisAt(g: GrapheZones, x: number, y: number, grain: number): number {
  return fbm2(x, y, SOL_MOU.ECHELLE_HAUT_BOIS, (g.seed ^ SOL_MOU.SEL_HAUT_BOIS) | 0) + grain > 0.5
    ? HAUT_BOIS[0]!
    : HAUT_BOIS[1]!
}

/**
 * LE SOL D'UNE TUILE — le thème de sa zone, semé de bosquets et d'accents.
 *
 * ⚠ **LE VERDICT EST À LA TUILE, LE CHAMP RESTE AU MOTIF** (`sol-dessine.md` R20, 2026-08-27) —
 * exactement la réparation que `humAt` a faite pour la Racine, étendue à toutes les zones. Les
 * champs du socle (`champAlt`, `champHum`) ne sont PAS recalculés par tuile : on les lit
 * BILINÉAIREMENT entre les quatre cellules qui entourent la tuile, plus un grain fin, et on
 * compare aux MÊMES seuils de quantile. L'interpolation conserve la moyenne et le grain est
 * symétrique : les parts de chaque palette restent le contrat qu'elles étaient.
 *
 * ⚠ **CE QUI RESTE DROIT LE RESTE, et c'est la règle qu'Alexis a posée** : *entre biomes de même
 * hauteur*. Le mur du vide (`rock`) et la falaise (`cliff`) SONT une hauteur — ils gardent leurs
 * arêtes de bloc (R32), et la mesure le montre : après ce chantier, tout ce qui dépasse 90 % de
 * segments longs est `rock|…` ou `cliff|…`, plus une seule paire biome/biome.
 *
 * Le CHEMIN HISTORIQUE, lui, échantillonne toujours au centre du motif : il ne sert que les Prés
 * Bas (entièrement repeints par leurs propres passes) et le Névé (de la neige, et rien d'autre).
 * Le rendre mou ne changerait pas un pixel et déplacerait le flux du PRNG pour rien.
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
  // Le centre du MOTIF qui contient la tuile — le chemin HISTORIQUE seul s'en sert désormais.
  const M = RELIEF.MOTIF
  const mx = Math.floor(x / M) * M + M / 2
  const my = Math.floor(y / M) * M + M / 2

  // ═══ LE CHEMIN DÉRIVÉ (S-R10) : la zone lit le socle, l'accent gagne sur la tache ═══
  const r = regles?.parZone[id]
  if (socle && regles && r) {
    // LE GATE RESTE À LA CELLULE : « cette tuile est-elle dans le rectangle du socle ? ». Hors
    // socle, on retombe sur le chemin historique — `lireLeChampGraine` clampe au bord et ne
    // saurait pas le dire.
    if (celluleDe(socle, x, y) >= 0) {
      // LE GRAIN DU SOL, UNE SEULE FOIS POUR LA TUILE — partagé par les trois verdicts. Ce n'est
      // pas une économie de `fbm2` : trois grains indépendants feraient trois dentelles
      // étrangères là où il n'y a qu'un sol.
      const grain = grainDuSol(x, y, (g.seed ^ SOL_MOU.SEL) | 0) * CREUX.GRAIN_TUILE_AMPLITUDE
      const va = lireLeChampGraine(socle, r.accentAlt ? regles.champAlt : regles.champHum, x, y, grain)
      if (r.partAccent > 0 && (r.accentHaut ? va >= r.accentSeuil : va < r.accentSeuil)) return p.accent
      const vt = lireLeChampGraine(socle, r.tacheAlt ? regles.champAlt : regles.champHum, x, y, grain)
      if (r.tacheHaut ? vt >= r.tacheSeuil : vt < r.tacheSeuil) {
        if (p.taches === TERRAIN_FOREST && z.def.tier > 0) return hautBoisAt(g, x, y, grain)
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
      return hautBoisAt(g, x, y, grainDuSol(x, y, (g.seed ^ SOL_MOU.SEL) | 0) * CREUX.GRAIN_TUILE_AMPLITUDE)
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
      // « vers », jamais « de » : les noms de zone PORTENT leur article (« le Karst »,
      // « les Aiguilles ») — « le seuil de le Karst » était la faute affichée au survol de la
      // carte. « vers » est insensible à l'accord PAR CONSTRUCTION (bible T5), et c'est déjà
      // la forme du passage de secours.
      name: s.secours ? `l'autre passage vers ${vers.def.nom}` : `le seuil vers ${vers.def.nom}`,
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
