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
import type { WorldMap, Zone as ZoneRect } from './map'
import { calibreLeFront, computeCendreField } from './cendre'
import { distSq } from './geometry'
import { placePois } from './poi'
import { fbm2, hash2 } from './noise'
import {
  deriveGrapheZones,
  echantillonAt,
  MONDE,
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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const k = blocDe(blocs, x, y)
      const z = blocs.zone[k]!
      zone[i] = z // même dans le vide : la cendre et l'ambiance ont besoin d'une région de rattachement
      if (blocs.vide[k]) {
        terrain[i] = TERRAIN_ROCK
        continue
      }
      terrain[i] = solDe(g, z, x, y)
    }
  }

  // ── PASSE 2 : les seuils — on perce tout droit un couloir PLAT dans la frontière ──
  for (const s of g.seuils) {
    percerSeuil(g, blocs, s, terrain, zone, rampe, width, height)
  }

  // ── PASSE 3 : LES ARÊTES — le mur, DÉDUIT. Puis on garantit qu'on circule. ─
  //
  // Les deux se répondent, d'où les deux tours : murer peut couper une poche, et l'ouvrir peut
  // fabriquer une arête neuve là où le percement rase une frontière. Deux tours suffisent (mesuré :
  // le second n'ouvre plus rien), et on FINIT par la connexité — l'invariant qui ne se négocie pas
  // est « toute zone est atteignable » (A2), pas « pas une arête ne traîne » (le seuil en fabrique).

  for (let tour = 0; tour < 2; tour++) {
    murerLesAretes(terrain, zone, rampe, width, height)
    garantirLaConnexite(g, terrain, zone, rampe, width, height)
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
    width, height, terrain, zones: toponymes(g), cendre: champCendre, cendreMax,
    zoneGrid,
    zonePas: ZONE_PAS,
    zoneDefs: g.zones.map((z) => ({ slug: z.def.slug, nom: z.def.nom, tier: z.def.tier })),
  }
  const carte: CarteZonee = { map, graphe: g, zone, rampe }

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
  s: { a: number; b: number; x: number; y: number; ax: number; ay: number },
  terrain: number[],
  zone: Int32Array,
  rampe: Uint8Array,
  width: number,
  height: number,
): void {
  // L'AXE DE TRAVERSÉE vient du SEUIL, et c'est une leçon. Les régions se chevauchent (spec R40) :
  // leurs formes sont des polygones en L, et la normale à la frontière ne se déduit plus de quatre
  // nombres. On l'a donc CONSTATÉE au balayage (`catalogueDesPortes`), et on la transporte.
  const ax = s.ax
  const ay = s.ay
  const px = -ay
  const py = ax

  // Le couloir est posé SUR la frontière : il déborde d'autant de chaque côté (longueur fixe, plate).
  const half = RELIEF.DEBORD_SEUIL
  const L = RELIEF.DEMI_LARGEUR_SEUIL

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
        terrain[i] = solMarchableDe(g, vers, x, y)
        zone[i] = vers
      }
      rampe[i] = 1
    }
  }
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

      if (percerVersLeMonde(g, poche, monde, terrain, zone, rampe, width, height)) ouvert = true
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
        if (TERRAINS[terrain[i]!]?.walkable !== true) terrain[i] = solMarchableDe(g, zid, x, y)
        rampe[i] = 1
      }
    }
  }
  return true
}
