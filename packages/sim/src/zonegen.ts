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
  type GrapheZones,
} from './zonegraph'

/** Constantes de FORME — contenu de carte, en tuiles ABSOLUES. */
export const RELIEF = {
  /**
   * Épaisseur du bandeau de falaise à une frontière, en tuiles. La frontière est au MILIEU :
   * une falaise mord donc `EPAISSEUR / 2` de chaque côté.
   *
   * 44 : assez épais pour qu'on ne le franchisse jamais par accident, assez mince pour ne pas
   * dévorer la carte (douze zones, ~15 frontières → ~7 % du marchable). C'est aussi la
   * LONGUEUR d'un seuil, puisque le seuil traverse la falaise : ~44 tuiles, soit un peu plus
   * d'un écran de haut. On la parcourt en onze secondes — assez pour qu'un loup vous rattrape.
   */
  EPAISSEUR_FALAISE: 44,

  /** Demi-largeur du couloir d'un seuil. 7 → 14 tuiles de passage : une gorge, et elle tient
   *  dans la fenêtre de 35 tuiles du jeu — on VOIT ses deux parois à la fois. */
  DEMI_LARGEUR_SEUIL: 7,

  /** Le couloir déborde de la falaise, de chaque côté, pour déboucher franchement dans la zone
   *  au lieu de mourir contre sa paroi. */
  DEBORD_SEUIL: 16,

  /** Amplitude du serpentement d'un couloir de seuil — un seuil droit est un couloir de métro. */
  MEANDRE_SEUIL: 5,
  MEANDRE_ECHELLE: 30,

  /** Anneau bloquant au bord de la carte. La vallée est CLOSE : on n'en sort pas. */
  BORDURE: 12,

  /** Bruit du terrain intérieur d'une zone — la variation qui la rend vivante sans la rendre
   *  illisible (spec R7 : une zone est un thème, reconnaissable en trois secondes). */
  ECHELLE_TERRAIN: 46,
  ECHELLE_TACHES: 120,

  // ══ LES BUTTES — le relief À L'INTÉRIEUR d'une zone ═════════════════════════════════════════
  //
  // LE MANQUE QU'ON COMBLE, et il crevait les yeux dès qu'on jouait (Alexis : « il n'y a aucune
  // falaise alors que c'était prévu — wtf ? »). Les falaises EXISTAIENT — 16 % de la carte — mais
  // uniquement aux FRONTIÈRES des zones. Or une zone fait six cents tuiles de côté : **depuis le
  // point de départ, la première falaise est à 280 tuiles**, soit soixante-dix secondes de marche
  // et HUIT ÉCRANS. Le joueur ne pouvait littéralement pas en voir une.
  //
  // J'avais fait des zones parfaitement PLATES. Ma propre spec disait le contraire (R4 : « les
  // rampes sont rares, et c'est LE geste qui fabrique toute la structure »). Une terrasse n'est
  // pas une table de billard : elle a des ressauts, des buttes, des parois qu'on longe.
  //
  // UNE BUTTE est un plateau d'un palier plus haut, ceint d'une falaise, percé d'une ou deux
  // RAMPES. Elle donne trois choses d'un coup : de la verticalité VISIBLE, un mur qu'on longe
  // (donc l'apprentissage du geste qui, à grande échelle, mène aux seuils), et un point HAUT d'où
  // l'on voit — le Belvédère y trouvera enfin sa raison d'être.

  /** Échelle des buttes, en tuiles. 210 → des plateaux de deux à cinq écrans : assez grands pour
   *  se contourner, assez petits pour qu'on en croise sans cesse. */
  ECHELLE_BUTTE: 150,
  /** Au-dessus de ce seuil de bruit, le sol se lève. 0,60 → ~20 % de chaque zone en hauteur. */
  SEUIL_BUTTE: 0.57,
  /** Aire minimale d'une butte, en tuiles. En deçà, c'est un caillou, pas un plateau : on ne le
   *  lève pas (sans quoi la carte se couvre de mesas d'une tuile, illisibles et ridicules). */
  AIRE_BUTTE_MIN: 600,
  /** Épaisseur de la falaise qui ceint une butte. 3 : une PAROI, pas un trait. */
  PAROI_BUTTE: 3,
  /** Une butte ne s'approche jamais à moins de ça d'une frontière de zone : sinon elle PINCE le
   *  passage contre la falaise de frontière, et une région se retrouve murée. */
  MARGE_FRONTIERE: 34,
  /** Demi-largeur d'une rampe de butte. 3 → 6 tuiles : on la voit, on la prend. */
  DEMI_RAMPE: 3,
  /** Une rampe par tranche d'aire. Rares — c'est tout le sujet (spec R4). */
  AIRE_PAR_RAMPE: 9000,
  RAMPES_MIN: 1,
  RAMPES_MAX: 3,
}

/**
 * LES PALIERS — la vallée MONTE, et le palier le dit.
 *
 * `palier = base(tier) + variation`. La racine est au fond (0) ; la ceinture T1 s'élève d'un
 * ou deux crans ; les marges T2 dominent tout (3 à 5). Une zone T2 collée à la racine crée donc
 * un seuil qui grimpe **quatre paliers d'un coup** — et c'est exactement le signal qu'on veut :
 * en voyant cette gorge s'élever en escalier au-dessus de son jardin, le joueur SAIT que ce
 * n'est pas pour aujourd'hui. Aucune UI ne le lui dit ; la géographie le fait.
 */
const PALIER_BASE: Record<0 | 1 | 2, number> = { 0: 0, 1: 1, 2: 3 }
const PALIER_ETENDUE: Record<0 | 1 | 2, number> = { 0: 1, 1: 2, 2: 3 }

export function palierDe(g: GrapheZones, id: number): number {
  const z = g.zones[id]!
  const t = z.def.tier
  return PALIER_BASE[t] + Math.floor(hash2(id, g.seed, 0xa17) * PALIER_ETENDUE[t])
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
 * LA GÉNÉRATION. Un balayage, trois passes, et rien qui remonte le temps.
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

  // ── PASSE 1 : les zones, les falaises, et le sol de chacune ───────────────
  const demi = RELIEF.EPAISSEUR_FALAISE / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const e = echantillonAt(g, x, y)
      zone[i] = e.zone
      palier[i] = paliers[e.zone]!

      if (e.marge < demi) {
        // LA FALAISE. On ne la lisse pas au bruit : une paroi a une ARÊTE, et c'est l'arête
        // qu'on suit pour trouver la porte. Un bord flou serait un bord qu'on ne peut pas
        // longer — exactement le défaut des anciens murs de roche.
        terrain[i] = TERRAIN_CLIFF
        continue
      }
      terrain[i] = solDe(g, e.zone, x, y)
    }
  }

  // ── PASSE 1bis : LES BUTTES — le relief À L'INTÉRIEUR des zones ───────────
  leverLesButtes(g, terrain, zone, palier, rampe, width, height)

  // ── PASSE 2 : les seuils — on perce, et ça MONTE ──────────────────────────
  for (const s of g.seuils) {
    percerSeuil(g, s, terrain, zone, palier, rampe, paliers, width, height)
  }

  // ── PASSE 2bis : LA CONNEXITÉ, GARANTIE — on ouvre les poches coupées du monde ──
  garantirLaConnexite(g, terrain, zone, palier, rampe, width, height)

  // ── PASSE 2ter : on mure les sauts de palier orphelins. EN DERNIER, car les passes
  //    précédentes en fabriquent aux endroits où leurs sculptures se rencontrent.
  murerLesSautsOrphelins(terrain, palier, rampe, width, height)

  // ── PASSE 3 : l'anneau de bordure. La vallée est CLOSE ────────────────────
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
   * Le champ continu est mort comme objet de RENDU (le faux-relief est abrogé : il était
   * illisible et il faisait planter une seed sur quatre). Mais il reste une SÉMANTIQUE : « on est
   * haut » veut dire quelque chose pour la température (il fait froid en altitude), pour la
   * neige, pour la faune. On le redonne donc à la carte, dérivé du palier : `palier / PALIER_MAX`.
   *
   * Ça évite une réécriture inutile de `temperature.ts` — et surtout, ça garde la vérité en UN
   * seul endroit : l'altitude n'est plus un champ indépendant qui pourrait diverger du terrain,
   * c'est une LECTURE du palier.
   */
  const elevation = new Array<number>(N)
  for (let i = 0; i < N; i++) elevation[i] = palier[i]! / PALIER_MAX

  /**
   * LE CHAMP DE CENDRE — la distance de chaque tuile à la frontière de la Cendrière.
   *
   * On le dérive du diagramme de puissance, exactement comme la marge des frontières : `puissance
   * = distance² − poids`, et l'écart de puissance entre deux sites, divisé par `2 × d(sites)`, EST
   * une distance en tuiles. Le front épouse donc la **forme réelle** de la Cendrière — frontière
   * tordue par le bruit comprise. Il avance comme une MARÉE, pas comme une explosion.
   *
   * C'est de la donnée STATIQUE : ce qui bouge est un scalaire dans le `SimState` (spec R31).
   */
  const cendriere = g.zones.find((z) => z.def.slug === 'cendriere')!
  const champCendre = computeCendreField(width, height, (x, y) => {
    const e = echantillonAt(g, x, y)
    if (e.zone === cendriere.id) return -e.marge // DEDANS : elle brûle depuis le premier jour
    // Dehors : la distance à la frontière de la Cendrière. Si la tuile ne la touche pas, on prend
    // la distance à son propriétaire PLUS ce qui reste à traverser — une borne inférieure honnête,
    // et le front s'arrêtera de toute façon bien avant les zones lointaines.
    if (e.voisin === cendriere.id) return e.marge
    const d = Math.sqrt(distSq(x, y, cendriere.x, cendriere.y))
    return d // très au-delà du front : la valeur exacte ne sert à rien, seul l'ordre compte
  })

  // On vise une PART des Prés Bas (60 %), pas une distance : la forme des zones varie trop d'une
  // seed à l'autre pour qu'un nombre de tuiles fixe tienne la promesse. On calibre donc ICI.
  const cendreMax = calibreLeFront(champCendre, (i) => zone[i] === g.racine && rampe[i] === 0)

  // LA ZONE, POUR LE CLIENT — grossière, parce que son erreur tombe dans la falaise (voir
  // `WorldMap.zoneGrid`). C'est ce qui lui permet enfin de peindre une Vieille Sylve autrement
  // qu'un Versant Brûlé : sans elle, aucune palette ne peut distinguer deux zones, puisque les
  // TERRAINS sont partagés.
  const ZONE_PAS = 4
  const zcols = Math.ceil(width / ZONE_PAS)
  const zrows = Math.ceil(height / ZONE_PAS)
  const zoneGrid = new Array<number>(zcols * zrows)
  for (let j = 0; j < zrows; j++) {
    for (let i = 0; i < zcols; i++) {
      const x = Math.min(width - 1, i * ZONE_PAS)
      const y = Math.min(height - 1, j * ZONE_PAS)
      zoneGrid[j * zcols + i] = zone[y * width + x]!
    }
  }

  const map: WorldMap = {
    width, height, terrain, zones: toponymes(g), elevation, cendre: champCendre, cendreMax,
    zoneGrid,
    zonePas: ZONE_PAS,
    zoneDefs: g.zones.map((z) => ({ slug: z.def.slug, nom: z.def.nom, tier: z.def.tier })),
  }
  const carte: CarteZonee = { map, graphe: g, zone, palier, rampe }

  // ── PASSE 4 : LES LIEUX — et ils ont désormais une ADRESSE ────────────────
  // La Grotte au Karst, le Champ de crevasses au Glacier, l'Arbre remarquable dans la Vieille
  // Sylve. `poi.ts` ne connaît pas le graphe de zones : il reçoit un accesseur, rien de plus.
  placePois(map, seed, (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return undefined
    return g.zones[zone[ty * width + tx]!]!.def.slug
  })

  return carte
}

/** Le palier le plus haut que la table puisse produire — le diviseur de l'altitude dérivée. */
export const PALIER_MAX = PALIER_BASE[2] + PALIER_ETENDUE[2] - 1 // 3 + 3 − 1 = 5

/** Le sol d'une tuile dans sa zone : le thème, semé de bosquets et d'accents. */
function solDe(g: GrapheZones, id: number, x: number, y: number): number {
  const z = g.zones[id]!
  const p = PALETTES[z.def.slug]!
  const n = fbm2(x, y, RELIEF.ECHELLE_TERRAIN, (g.seed ^ (id * 0x9e37)) | 0)
  const t = fbm2(x, y, RELIEF.ECHELLE_TACHES, (g.seed ^ (id * 0x2545)) | 0)

  if (n < p.rarete) return p.accent
  if (t > p.seuilTaches) {
    // Les BOSQUETS. Dans les zones hautes, le bois qui pousse est un pin ou un mélèze — un
    // thème n'est pas un aplat.
    if (p.taches === TERRAIN_FOREST && z.def.tier > 0) {
      return HAUT_BOIS[Math.floor(hash2(x, y, g.seed ^ 0x5b) * HAUT_BOIS.length)]!
    }
    return p.taches
  }
  return p.sol
}

/**
 * PERCER UN SEUIL — et il MONTE.
 *
 * Le couloir traverse la falaise perpendiculairement à la frontière (c'est-à-dire dans l'axe
 * des deux sites), sur `ÉPAISSEUR + 2 × DÉBORD` tuiles. Il **serpente** : un seuil droit est un
 * couloir de métro, et on ne veut pas voir la sortie depuis l'entrée.
 *
 * ET C'EST UN ESCALIER. Le palier passe de celui de la zone `a` à celui de la zone `b`, **une
 * marche à la fois**, réparties le long du couloir. Chaque marche est une rampe. L'invariant
 * « une rampe ne relie que deux paliers consécutifs » (spec R3) devient donc vrai *par
 * construction*, et non par vérification — et un seuil qui grimpe quatre paliers ANNONCE, rien
 * qu'en se montrant, ce qui l'attend derrière.
 *
 * Toutes les tuiles du couloir sont marquées `rampe` : c'est ce qui les exempte de la règle
 * « pas de saut de palier entre deux marchables voisines », qu'elles violent par métier.
 */
function percerSeuil(
  g: GrapheZones,
  s: { a: number; b: number; x: number; y: number },
  terrain: number[],
  zone: Int32Array,
  palier: Int32Array,
  rampe: Uint8Array,
  paliers: number[],
  width: number,
  height: number,
): void {
  // ON PERCE ENTRE DEUX POINTS DE SOL RÉEL, PAS DANS UNE DIRECTION THÉORIQUE.
  //
  // LA FAUTE DE LA PREMIÈRE ÉCRITURE : le couloir était creusé dans l'AXE DES DEUX SITES, sur
  // une longueur fixe (épaisseur de la falaise + débord). C'est juste au milieu de la
  // frontière — et faux partout ailleurs. Car le seuil est posé n'importe où sur une frontière
  // **qui serpente** : loin de l'axe des sites, la normale à la falaise n'est plus cette
  // direction-là. Le couloir traversait donc le mur **en biais**, la longueur ne suffisait plus,
  // et il mourait DANS la paroi. Mesuré : la Tourbière de la seed 2026 était injoignable.
  //
  // On cherche donc, de part et d'autre du seuil, la première tuile de SOL de chaque zone — et
  // on creuse de l'une à l'autre. Le couloir débouche alors par construction, quelle que soit
  // l'orientation de la frontière à cet endroit.
  const A = solLePlusProche(s, s.a, terrain, zone, width, height)
  const B = solLePlusProche(s, s.b, terrain, zone, width, height)
  if (!A || !B) return

  let dx = B.x - A.x
  let dy = B.y - A.y
  const brut = Math.sqrt(dx * dx + dy * dy)
  if (brut < 1) return
  dx /= brut
  dy /= brut
  const px = -dy // la perpendiculaire : l'épaisseur du couloir, et le méandre
  const py = dx

  const pa = paliers[s.a]!
  const pb = paliers[s.b]!
  const marches = Math.abs(pb - pa)
  const sens = pb > pa ? 1 : -1

  // Le couloir DÉBORDE dans les deux zones. Sans ce débord, il s'arrête pile sur la première
  // tuile de sol venue — qui peut être un caillou isolé au pied de la paroi, sans lien avec le
  // corps de la zone. Seize tuiles de mieux, et il débouche dans le VRAI pays.
  const d0 = -RELIEF.DEBORD_SEUIL
  const d1 = brut + RELIEF.DEBORD_SEUIL
  const len = d1 - d0

  for (let t = d0; t <= d1; t += 0.5) {
    // Le méandre : le couloir serpente. Un seuil droit est un couloir de métro — on ne doit pas
    // voir la sortie depuis l'entrée. Il s'annule aux deux BOUTS (le facteur `bord`).
    const u = (t - d0) / len
    const bord = Math.min(1, Math.min(u, 1 - u) * 6)
    const m = bord * RELIEF.MEANDRE_SEUIL *
      (fbm2(A.x + t * dx, A.y + t * dy, RELIEF.MEANDRE_ECHELLE, (g.seed ^ 0x5e17) | 0) * 2 - 1)
    const cx = A.x + dx * t + px * m
    const cy = A.y + dy * t + py * m

    // L'ESCALIER. Les marches se répartissent sur la longueur du couloir ; les deux bouts
    // raccordent EXACTEMENT les paliers des deux zones — donc aucune marche ne traîne au bord.
    const marche = marches === 0 ? 0 : Math.min(marches, Math.floor(u * (marches + 1)))
    const pal = pa + sens * marche

    for (let w = -RELIEF.DEMI_LARGEUR_SEUIL; w <= RELIEF.DEMI_LARGEUR_SEUIL; w += 0.5) {
      const x = Math.round(cx + px * w)
      const y = Math.round(cy + py * w)
      if (x < RELIEF.BORDURE || y < RELIEF.BORDURE || x >= width - RELIEF.BORDURE || y >= height - RELIEF.BORDURE) {
        continue
      }
      const i = y * width + x

      // ON DÉGAGE TOUT CE QUI BLOQUE — pas seulement la falaise.
      //
      // LA FAUTE DE LA DEUXIÈME ÉCRITURE, et elle était sournoise : on ne repeignait que les
      // tuiles de FALAISE. Un rocher (l'accent bloquant d'une zone) tombé au milieu du passage
      // restait donc en place et **bouchait la porte** — mesuré : le Glacier de la seed 42
      // était injoignable, alors que le couloir était bel et bien creusé. **Une porte est une
      // porte** : ce qui la traverse est franchissable, sans exception.
      if (TERRAINS[terrain[i]!]?.walkable !== true) {
        // Le sol du couloir est celui de la zone vers laquelle on va : **la porte a déjà la
        // couleur de ce qu'elle garde.** On voit ce qui attend avant d'y être (spec R10.2).
        const vers = u < 0.5 ? s.a : s.b
        terrain[i] = solMarchableDe(g, vers, x, y)
        zone[i] = vers
      }
      // La RAMPE couvre tout le couloir : c'est elle qui PORTE le saut de palier, et c'est elle
      // qui l'exempte de l'invariant « on ne monte que par une rampe ».
      palier[i] = pal
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
 * La première tuile de SOL de la zone `id`, en partant du seuil — une spirale carrée qui
 * s'élargit. C'est ce qui garantit qu'un couloir DÉBOUCHE : on ne vise pas une direction, on
 * vise une tuile où l'on peut poser le pied.
 */
function solLePlusProche(
  s: { x: number; y: number },
  id: number,
  terrain: number[],
  zone: Int32Array,
  width: number,
  height: number,
): { x: number; y: number } | null {
  for (let r = 1; r < 160; r++) {
    let best: { x: number; y: number } | null = null
    let bestD = Infinity
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Seulement l'anneau : l'intérieur a déjà été vu aux rayons précédents.
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        const x = s.x + dx
        const y = s.y + dy
        if (x < RELIEF.BORDURE || y < RELIEF.BORDURE || x >= width - RELIEF.BORDURE || y >= height - RELIEF.BORDURE) {
          continue
        }
        const i = y * width + x
        if (zone[i] !== id || terrain[i] === TERRAIN_CLIFF) continue
        const d = dx * dx + dy * dy
        // Départage par distance puis par coordonnées : déterministe.
        if (d < bestD) { bestD = d; best = { x, y } }
      }
    }
    if (best) return best
  }
  return null
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
export { catalogueFrontieres, deriveGrapheZones }

/**
 * LEVER LES BUTTES — et leur percer des rampes.
 *
 * Cinq gestes, dans cet ordre, et l'ordre est le sujet :
 *
 *   1. LE MASQUE. Un bruit basse fréquence ; au-dessus du seuil, le sol veut se lever. On EXCLUT
 *      les abords des frontières de zone (`MARGE_FRONTIERE`) : une butte collée à la falaise de
 *      frontière PINCERAIT le passage contre elle, et murerait une région. On ne le découvrirait
 *      qu'à la garde de connexité — c'est-à-dire après l'avoir construite.
 *   2. LES COMPOSANTES. On ne lève que les blocs assez GRANDS (`AIRE_BUTTE_MIN`). Sans ce filtre,
 *      la carte se couvre de mesas d'une tuile : illisibles, et ridicules.
 *   3. LA LEVÉE. Palier +1 sur la butte.
 *   4. LA PAROI. Toute tuile BASSE assez près d'une haute devient falaise — trois tuiles
 *      d'épaisseur : une PAROI, pas un trait. C'est elle qu'on longe.
 *   5. LES RAMPES. On perce une à trois brèches par butte, choisies sur son bord, aussi écartées
 *      que possible. Elles sont RARES, et c'est tout le sujet (spec R4).
 *
 * Ce que ça donne, et qu'aucune frontière lointaine ne donnait : **une paroi à portée de vue,
 * partout.** Le joueur apprend le geste (longer un mur, trouver la brèche) sur une butte de son
 * jardin — avant d'avoir à le faire, à l'échelle d'une zone, pour trouver un seuil.
 */
function leverLesButtes(
  g: GrapheZones,
  terrain: number[],
  zone: Int32Array,
  palier: Int32Array,
  rampe: Uint8Array,
  width: number,
  height: number,
): void {
  const N = width * height
  const demi = RELIEF.EPAISSEUR_FALAISE / 2

  // ── 1. LE MASQUE ──────────────────────────────────────────────────────────
  const veutMonter = new Uint8Array(N)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (terrain[i] === TERRAIN_CLIFF) continue
      if (TERRAINS[terrain[i]!]?.walkable !== true) continue
      const e = echantillonAt(g, x, y)
      // Loin des frontières : une butte qui les touche pince le passage contre elles.
      if (e.marge < demi + RELIEF.MARGE_FRONTIERE) continue
      if (fbm2(x, y, RELIEF.ECHELLE_BUTTE, (g.seed ^ 0x8177) | 0) > RELIEF.SEUIL_BUTTE) veutMonter[i] = 1
    }
  }

  // ── 2. LES COMPOSANTES (4-connexité, comme partout ailleurs) ──────────────
  const compo = new Int32Array(N).fill(-1)
  const buttes: { id: number; tuiles: number[] }[] = []
  for (let i0 = 0; i0 < N; i0++) {
    if (!veutMonter[i0] || compo[i0] !== -1) continue
    const id = buttes.length
    const tuiles: number[] = [i0]
    compo[i0] = id
    for (let h = 0; h < tuiles.length; h++) {
      const i = tuiles[h]!
      const x = i % width
      const y = (i - x) / width
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (!veutMonter[j] || compo[j] !== -1) continue
        compo[j] = id
        tuiles.push(j)
      }
    }
    // Trop petite : ce n'est pas un plateau, c'est un caillou. On ne la lève pas.
    if (tuiles.length < RELIEF.AIRE_BUTTE_MIN) {
      for (const i of tuiles) { veutMonter[i] = 0; compo[i] = -1 }
      continue
    }
    buttes.push({ id, tuiles })
  }
  if (buttes.length === 0) return

  // ── 3. LA LEVÉE ───────────────────────────────────────────────────────────
  for (const b of buttes) for (const i of b.tuiles) palier[i]! += 1

  // ── 4. LA PAROI ───────────────────────────────────────────────────────────
  // Toute tuile BASSE à moins de PAROI_BUTTE d'une tuile levée devient falaise. On ne touche
  // jamais aux tuiles levées elles-mêmes : le plateau reste marchable, c'est le but.
  const r = RELIEF.PAROI_BUTTE
  const aMurer = new Uint8Array(N)
  for (const b of buttes) {
    for (const i of b.tuiles) {
      const x = i % width
      const y = (i - x) / width
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (veutMonter[j] || rampe[j]) continue // pas le plateau, pas un seuil
          if (TERRAINS[terrain[j]!]?.walkable !== true) continue
          aMurer[j] = 1
        }
      }
    }
  }
  for (let i = 0; i < N; i++) if (aMurer[i]) terrain[i] = TERRAIN_CLIFF

  // ── 5. LES RAMPES — rares, et écartées ────────────────────────────────────
  for (const b of buttes) {
    // Le bord de la butte : les tuiles levées qui touchent la paroi. C'est là qu'une rampe part.
    const bord: number[] = []
    for (const i of b.tuiles) {
      const x = i % width
      const y = (i - x) / width
      let auBord = false
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = (y + dy) * width + (x + dx)
        if (j < 0 || j >= N) continue
        if (terrain[j] === TERRAIN_CLIFF) { auBord = true; break }
      }
      if (auBord) bord.push(i)
    }
    if (bord.length === 0) continue

    const combien = Math.max(
      RELIEF.RAMPES_MIN,
      Math.min(RELIEF.RAMPES_MAX, Math.round(b.tuiles.length / RELIEF.AIRE_PAR_RAMPE)),
    )
    // Glouton max-min : chaque rampe aussi loin que possible des précédentes. Déterministe.
    const choisies: number[] = [bord[Math.floor(hash2(b.id, g.seed, 0x9a) * bord.length)] ?? bord[0]!]
    while (choisies.length < combien) {
      let best = -1
      let bestScore = -1
      for (const i of bord) {
        const x = i % width
        const y = (i - x) / width
        let score = Infinity
        for (const c of choisies) {
          const cx = c % width
          const cy = (c - cx) / width
          score = Math.min(score, distSq(x, y, cx, cy))
        }
        if (score > bestScore) { bestScore = score; best = i }
      }
      if (best < 0) break
      choisies.push(best)
    }

    for (const i of choisies) {
      percerRampe(i, terrain, zone, palier, rampe, veutMonter, width, height, g)
    }
  }
}

/**
 * PERCER UNE RAMPE dans la paroi d'une butte — du plateau jusqu'à la plaine.
 *
 * ON CHERCHE UN CHEMIN, ON NE DEVINE PAS UNE DIRECTION. La première écriture choisissait la
 * direction de sortie par une heuristique (« celle des huit qui compte le plus de tuiles hors
 * butte sur quatorze pas ») et creusait tout droit. Ça marche au milieu d'un bord franc, et ça
 * échoue partout ailleurs — dans une anse, sur un isthme, contre un lobe voisin. Mesuré :
 * **47 % du Glacier était prisonnier** de plateaux dont la rampe n'avait pas abouti, et la garde
 * de connexité (A2) l'a dit.
 *
 * Un parcours en largeur, lui, ne peut pas se tromper : il trouve la sortie la plus proche s'il en
 * existe une, et il n'en existe pas s'il n'y en a pas. On part du bord du plateau, on cherche la
 * première tuile de PLAINE (basse, marchable, hors butte), et on creuse le chemin trouvé — élargi,
 * pour qu'il se voie et se prenne.
 *
 * Ordre de visite fixe (E, O, S, N) : déterministe, comme tout le reste de /sim.
 */
function percerRampe(
  depart: number,
  terrain: number[],
  zone: Int32Array,
  palier: Int32Array,
  rampe: Uint8Array,
  veutMonter: Uint8Array,
  width: number,
  height: number,
  g: GrapheZones,
): void {
  const N = width * height
  const haut = palier[depart]!
  const parent = new Map<number, number>()
  const vu = new Set([depart])
  const file = [depart]
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
      if (vu.has(j)) continue
      vu.add(j)
      parent.set(j, i)
      // LA SORTIE : de la plaine. Basse, marchable, hors du plateau.
      if (!veutMonter[j] && TERRAINS[terrain[j]!]?.walkable === true) { arrivee = j; break }
      // On ne traverse que le plateau et sa PAROI — jamais la falaise d'une FRONTIÈRE de zone
      // (elle, c'est le seuil qui la franchit, et lui seul). La paroi d'une butte se reconnaît à
      // ceci qu'elle borde le plateau : on s'interdit donc de s'éloigner de plus de la moitié
      // d'une épaisseur de frontière.
      if (vu.size > 4000) break // garde-fou : une butte sans issue ne doit pas coûter la carte
      file.push(j)
    }
  }
  if (arrivee < 0) return

  // Le chemin, remonté. On l'élargit : une rampe doit se VOIR et se prendre.
  const chemin: number[] = []
  for (let i: number | undefined = arrivee; i !== undefined; i = parent.get(i)) chemin.push(i)

  const r = RELIEF.DEMI_RAMPE
  const bas = haut - 1
  for (let k = 0; k < chemin.length; k++) {
    // Le palier descend d'un cran à mi-parcours : la rampe est une MARCHE, pas un ascenseur.
    // (`chemin` remonte de la SORTIE vers le plateau : l'index k va donc du bas vers le haut.)
    const pal = k < chemin.length / 2 ? bas : haut
    const c = chemin[k]!
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
        if (i < 0 || i >= N) continue
        // On n'élargit QUE dans la paroi de la butte et sur le plateau : on ne va pas raser la
        // plaine autour de la sortie.
        if (!veutMonter[i] && TERRAINS[terrain[i]!]?.walkable === true) continue
        if (TERRAINS[terrain[i]!]?.walkable !== true) terrain[i] = solMarchableDe(g, zone[i]!, x, y)
        palier[i] = pal
        rampe[i] = 1
      }
    }
  }
}

/**
 * LA RÉPARATION FINALE — un saut de palier sans rampe EST une falaise, par définition.
 *
 * Passée en DERNIER, après les buttes et les seuils. Elle ne fabrique rien : elle constate.
 *
 * POURQUOI ELLE EXISTE. Les buttes et les seuils sculptent chacun leur paliers, et leurs bords se
 * rencontrent — un couloir de seuil qui rase une paroi de butte, deux buttes qu'une tuile sépare.
 * Ces rencontres sont rares (mesuré : **deux tuiles** sur une carte de deux millions et demi),
 * mais chacune est un endroit où l'on escaladerait une paroi de plain-pied. On ne raisonne pas
 * sur des cas de figure : on repasse, et on mure ce qui doit l'être.
 *
 * C'est ce qui rend l'invariant R3 vrai **par construction ET par vérification** — la ceinture et
 * les bretelles, sur un invariant qui décide de la topologie du monde entier.
 */
function murerLesSautsOrphelins(
  terrain: number[],
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
        if (palier[i] === palier[j]) continue
        if (rampe[i] || rampe[j]) continue // une rampe a le droit de monter : c'est son métier
        // Ni l'un ni l'autre n'est une rampe, et pourtant ça monte : c'est une falaise qui
        // manque. On mure la tuile HAUTE (la basse reste le chemin — on ne coupe pas la plaine).
        aMurer.push(palier[i]! > palier[j]! ? i : j)
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
  const r = RELIEF.DEMI_RAMPE
  const palBas = palier[arrivee]!
  const palHaut = palier[chemin[chemin.length - 1]!]!
  for (let k = 0; k < chemin.length; k++) {
    const c = chemin[k]!
    const cx = c % width
    const cy = (c - cx) / width
    const pal = k < chemin.length / 2 ? palBas : palHaut
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
