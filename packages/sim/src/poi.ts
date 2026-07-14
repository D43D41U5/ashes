/**
 * Les POIs de la Vallée alpine (spec figée 2026-07-08, 26 types). Placement PUR :
 * un semis bruit bleu pose ~90 points, chacun reçoit un type valide pour son biome
 * local (table pondérée, plafonds durs), et devient une Zone nommée. hash2 = seul aléa.
 */
import { hash2 } from './noise'
import { poissonPoints } from './poisson'
import { elevationAt, terrainAt, isBlockingTile, type WorldMap, type Zone } from './map'
import { spawnMonster } from './monsters'
import type { SimState } from './sim'
import { setTile } from './valleygen-primitives'
import { FAUNA, TERRAIN_SCREE } from './balance'
import { distSq } from './geometry'
import { type CarveField, carveDistanceToMain, walkableComponents } from './connectivity'

// ids terrain (balance.ts) — repris localement pour lisibilité de la table.
const SCREE = 9, ROCK = 5, SNOW = 10, BOULDERS = 16, GLACIER = 15, BURNT = 21, PEAT = 18, REED = 19,
  AL_MEADOW = 12, AL_FLOWERS = 20, OLD_GROWTH = 22, HEATH = 11, PINE = 13, FLOWER = 17,
  FOREST = 3, GRASS = 1

export interface PoiType {
  slug: string
  name: string
  family: 'eco' | 'shelter' | 'danger' | 'reward'
  biomes: number[]
  /**
   * LES ZONES OÙ CE LIEU PEUT NAÎTRE (slugs — spec `worldgen.md` R7).
   *
   * C'est ce qui donne enfin une ADRESSE aux lieux. Un lieu sans `zones` reste libre d'apparaître
   * partout où son biome le porte — c'est le cas du Cairn, et c'est voulu : les cairns sont les
   * jalons de TOUTE la vallée, et c'est leur métier de se suivre de proche en proche.
   *
   * Sur une carte sans zones (l'ancienne vallée), ce champ est simplement ignoré : `poi.ts` reçoit
   * un accesseur, il ne connaît pas `zonegraph.ts`.
   */
  zones?: string[]
  /** Chance d'être tiré quand on est ÉLIGIBLE. Ce n'est PAS la rareté — voir `cap`. */
  weight: number
  /** La rareté vit ICI : plafond dur. Un Sanctuaire est précieux parce qu'il y en a deux. */
  cap: number
  /**
   * Exemplaires GARANTIS, servis avant le tirage général (spec lieux ; décision
   * 2026-07-11).
   *
   * **TOUS LES TYPES RÉSERVENT DÉSORMAIS** (2026-07-14). En donnant une ADRESSE aux lieux (la
   * Grotte au Karst, la Mine au Gouffre), on a réduit d'un ordre de grandeur le nombre de points
   * de semis où chacun est éligible — et **le tirage est à SOMME NULLE** : neuf types se
   * disputent les points d'une même zone, donc les perdants disparaissent. Mesuré : « la Mine
   * abandonnée » ne naissait NULLE PART sur la seed 7. C'est exactement la faute que R6 avait
   * nommée en juillet (« le semis décide de l'ABONDANCE ; la réservation décide de l'EXISTENCE »)
   * — l'adressage l'a simplement généralisée à toute la table. Une ligne morte est une ligne
   * morte : on ne joue plus AUCUN type à la loterie. Un lieu dont une mécanique dépend ne peut pas se permettre de
   * perdre la loterie : mesuré, le Belvédère avait 10 points de semis éligibles
   * sur la seed du jeu — et sortait quand même **zéro fois**, écrasé par le Cairn
   * (poids 12, éligible partout). Monter son poids ne réglait rien : le tirage
   * est à SOMME NULLE (le semis borne le total), donc gaver l'un affame l'autre.
   * On ne joue donc plus les lieux chargés à la loterie : **ils réservent leur
   * point.** Absent = 0 (le type prend sa chance comme avant).
   */
  reserve?: number
  minElev?: number
  maxElev?: number
  footprint: number
  nodeKind?: 'gisement' | 'carriere'
  monster?: 'boar' | 'cendreux'
}

export const POI_PLACEMENT = {
  /**
   * L'ESPACEMENT DU SEMIS, EN TUILES ABSOLUES — et ce mot est tout le correctif.
   *
   * C'était `SPACING_FRAC = 0,08`, une FRACTION de `min(w,h)`. Le rayon d'exclusion
   * grandissait donc avec la carte, et le semis obtenu était une HOMOTHÉTIE exacte
   * du même tirage : le nombre de points ne dépendait pas de la surface. Mesuré :
   *
   *     1200×1800 (le jeu)  → 75 lieux
   *     2400×3600 (la cible, décision du 2026-07-07) → 69 lieux
   *
   * **Quatre fois plus de terre, autant de lieux.** À la taille cible, la vallée
   * aurait été quatre fois plus vide — l'inverse exact de ce qu'on cherche. (Le
   * phénomène était connu et documenté dans `poi.test.ts` ; sa conséquence à
   * l'échelle ne l'était pas.)
   *
   * 96 tuiles = ce que valait `0,08 × 1200` : à la taille du jeu, **rien ne change**.
   * Au-delà, la densité suit enfin la surface.
   */
  SPACING_TILES: 96,
  /**
   * LE GARDE-FOU DES PETITES CARTES. Un espacement absolu est la bonne règle — mais
   * appliqué tel quel à une carte de 240×360 (les tests, les vignettes), il n'y
   * laisserait que six points, et la vallée n'aurait plus aucun lieu. On borne donc
   * l'espacement à une fraction du petit côté : une vallée minuscule reste une
   * vallée peuplée, à sa mesure.
   *
   * À la taille du jeu (1200) les deux règles coïncident exactement — `0,08 × 1200
   * = 96` — et rien ne bouge. Ce n'est donc un garde-fou QUE pour les petites cartes.
   */
  SPACING_MAX_FRAC: 0.08,
  /**
   * La surface de RÉFÉRENCE des plafonds — celle où toute la table a été calibrée
   * (et où elle est jouée aujourd'hui). Les plafonds croissent proportionnellement :
   * une vallée deux fois plus grande porte deux fois plus de Cairns, sinon
   * l'espacement absolu ne servirait à rien — les plafonds la videraient à sa place.
   *
   * La RARETÉ, elle, ne change pas : elle est une DENSITÉ (« deux Sanctuaires par
   * vallée de cette taille »), pas un compte absolu.
   */
  CAP_REFERENCE_AREA: 1200 * 1800,
  CANONICAL: { width: 2400, height: 3600 },

  /**
   * LE RYTHME, ESSAYÉ PUIS RETIRÉ — et la raison mérite d'être consignée, parce que
   * l'idée est bonne et reviendra.
   *
   * Le bruit bleu de Poisson espace parfaitement, et c'est son défaut : il pose les
   * lieux avec une régularité de papier peint, alors qu'on voudrait des GRAPPES
   * (« il y a quelque chose dans ce coin ») et des VIDES (« il n'y a rien, et ce
   * rien se traverse »). Un champ basse fréquence qui écarte les points de ses
   * creux le donne en trois lignes, et la carte y gagne.
   *
   * Mais il fait aussi passer au ROUGE la garde de neutralité spatiale de
   * `poi.test.ts` — et à juste titre : cette garde protège contre un vrai bug (les
   * plafonds raflés par les premiers points de la vague de croissance du semis, un
   * gradient de densité mesuré à 1,31–2,50), et un regroupement volontaire est,
   * pour elle, exactement le même signal. Distinguer la grappe VOULUE de la grappe
   * BUG demande un test bien plus fin que celui-ci.
   *
   * On ne relâche pas une garde durement gagnée pour un agrément. Le rythme
   * reviendra quand il aura son propre critère — c'est-à-dire quand on saura DIRE
   * ce qu'est une bonne grappe, et pas seulement la reconnaître.
   */

  /**
   * LE SEUIL, PAS LE TUNNEL — combien de tuiles de roche un lieu a-t-il le droit
   * de percer pour s'ouvrir sur le monde ?
   *
   * Le correctif du 2026-07-11 (« le lieu creuse son propre sol ») garantissait
   * au lieu une tuile MARCHABLE dans son empreinte. Il ne lui garantissait pas
   * d'être ATTEIGNABLE : mesuré sur la vraie carte, 16 lieux sur 81 (seed du jeu)
   * étaient des poches parfaitement marchables au cœur d'un massif, où nul ne
   * mettra jamais les pieds. La Grotte, la Source chaude et le Belvédère étaient
   * morts à 100 % — les trois devises de la spec `lieux.md`.
   *
   * La distribution mesurée tranche : **10 lieux murés ne sont séparés du monde
   * que par UNE tuile** (une porte), et **29 en sont à plus de vingt-quatre**
   * (ensevelis, sans espoir). Il n'y a donc rien à gagner à creuser loin : au-delà
   * du seuil, le lieu n'est pas mal fermé, il est mal PLACÉ.
   *
   * D'où la règle : la connexité entre dans l'ÉLIGIBILITÉ. Un type qui ne peut
   * pas s'ouvrir ici n'est pas creusé de force — il est écarté DE CE POINT, et
   * `candidatesFor` en propose un autre (ou le point reste sauvage). La Grotte
   * naît alors au BORD du massif, ce qui est précisément l'endroit où se trouve
   * la bouche d'une grotte. Le mécanisme existait déjà ; on lui donne juste les
   * yeux qui lui manquaient.
   *
   * 3 : une porte, une vire, une margelle. Jamais un tunnel.
   */
  MAX_CARVE_TILES: 3,
}

export const POI_TYPES: PoiType[] = [
  // Économie
  { slug: 'gisement', zones: ['karst', 'aiguilles', 'gouffre'], name: 'le Gisement', family: 'eco', biomes: [SCREE, ROCK, BOULDERS], minElev: 0.55, weight: 2, cap: 3, reserve: 1, footprint: 4, nodeKind: 'gisement' },
  { slug: 'carriere', zones: ['alpages', 'aiguilles', 'karst'], name: 'la Carrière', family: 'eco', biomes: [SCREE, BOULDERS], weight: 3, cap: 4, reserve: 1, footprint: 4, nodeKind: 'carriere' },
  { slug: 'saline', zones: ['alpages', 'ruines'], name: 'la Saline', family: 'eco', biomes: [AL_MEADOW, AL_FLOWERS, HEATH], weight: 2, cap: 3, reserve: 1, footprint: 3 },
  { slug: 'verger', zones: ['pres_bas', 'sylve'], name: 'le Verger sauvage', family: 'eco', biomes: [FLOWER, GRASS, AL_MEADOW], weight: 3, cap: 4, reserve: 1, footprint: 3 },
  // Abris
  { slug: 'ruines', zones: ['ruines'], name: 'les Ruines', family: 'shelter', biomes: [OLD_GROWTH, FOREST, GRASS], weight: 3, cap: 4, reserve: 1, footprint: 4 },
  { slug: 'cabane', zones: ['alpages'], name: 'la Cabane de berger', family: 'shelter', biomes: [AL_MEADOW, AL_FLOWERS], weight: 4, cap: 5, reserve: 1, footprint: 2 },
  { slug: 'abri', zones: ['karst', 'aiguilles', 'gouffre', 'ruines'], name: "l'Abri sous roche", family: 'shelter', biomes: [ROCK, BOULDERS, SCREE], weight: 5, cap: 6, reserve: 1, footprint: 2 },
  { slug: 'mine', zones: ['karst', 'gouffre'], name: 'la Mine abandonnée', family: 'shelter', biomes: [SCREE, ROCK], minElev: 0.5, weight: 3, cap: 3, reserve: 1, footprint: 3 },
  { slug: 'oratoire', zones: ['alpages', 'karst'], name: 'l’Oratoire', family: 'shelter', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.55, weight: 3, cap: 3, reserve: 1, footprint: 2 },
  { slug: 'bivouac', name: 'le Vieux bivouac', family: 'shelter', biomes: [GRASS, AL_MEADOW, HEATH, FOREST, SCREE, FLOWER, OLD_GROWTH, PINE], weight: 4, cap: 4, reserve: 1, footprint: 2 },
  // Danger
  { slug: 'taniere', zones: ['sylve', 'pres_bas'], name: 'la Tanière', family: 'danger', biomes: [FOREST, PINE, GRASS], weight: 6, cap: 8, reserve: 1, footprint: 3, monster: 'boar' },
  { slug: 'repaire', zones: ['brule', 'cendriere'], name: 'le Repaire de Cendrés', family: 'danger', biomes: [BURNT, ROCK, SCREE], weight: 4, cap: 5, reserve: 1, footprint: 3, monster: 'cendreux' },
  { slug: 'epave', zones: ['aiguilles', 'glacier'], name: "l'Épave d'avalanche", family: 'danger', biomes: [SCREE, BOULDERS], minElev: 0.55, weight: 3, cap: 3, reserve: 1, footprint: 2 },
  { slug: 'fondriere', zones: ['tourbiere', 'lac_mort'], name: 'la Fondrière', family: 'danger', biomes: [PEAT, REED], weight: 3, cap: 3, reserve: 1, footprint: 3 },
  /**
   * LE CHAMP DE CREVASSES — était une LIGNE MORTE (mesuré 2026-07-13) : biome
   * `GLACIER` seul, or le glacier est `walkable: false` et se cache derrière la
   * neige et la roche, elles aussi bloquantes. Sur la vraie carte, 176 000 tuiles
   * de glacier existaient et **pas une seule** n'était à moins de trois tuiles du
   * monde. Le lieu ne pouvait donc naître nulle part — problème déjà noté au
   * journal le 2026-07-09 (« disparaît des 5 seeds testées ») et laissé en suspens.
   *
   * On lui rend l'accès sans lui retirer son sujet : il naît désormais sur le haut
   * pierrier (le sol brisé sous la glace), et son empreinte de 4 mord dans le
   * minéral au-dessus. Les biomes de glace et de neige RESTENT dans sa liste : le
   * jour où la neige deviendra praticable (question ouverte, cf. la note de session
   * sur les 24 % de carte-mur), il remontera de lui-même vers la vraie marge du
   * glacier, sans qu'on retouche cette ligne.
   */
  { slug: 'crevasses', zones: ['glacier'], name: 'le Champ de crevasses', family: 'danger', biomes: [GLACIER, SNOW, SCREE, BOULDERS], minElev: 0.66, weight: 3, cap: 3, reserve: 1, footprint: 4 },
  // Récompense / paysage
  /**
   * LE BELVÉDÈRE — `minElev` était à 0,75, **au-dessus du plafond du marchable**
   * (`BANDS.SCREE = 0,73` : tout ce qui monte plus haut est roche, neige ou glace,
   * et tout cela bloque). Il ne pouvait donc naître QUE sur du bloquant, et
   * n'existait que par la grâce d'un percement — 16 000 tuiles ouvrables sur 2,16
   * millions, soit 0,7 % de la carte. Il a fini par perdre : sur la seed 31415, il
   * ne sortait pas (garde de réservation au rouge).
   *
   * Un point de vue où l'on ne peut pas se tenir n'est pas un point de vue. Il se
   * pose désormais sur le HAUT PIERRIER (0,66-0,73) — l'endroit le plus élevé où
   * l'on puisse poser le pied, ce qui est très exactement la définition d'un
   * belvédère. `AL_MEADOW` sort de sa liste : cette bande s'arrête à 0,64, elle
   * était inatteignable sous ce `minElev` — une ligne qui mentait.
   */
  { slug: 'belvedere', zones: ['alpages', 'aiguilles'], name: 'le Belvédère', family: 'reward', biomes: [SCREE, ROCK], minElev: 0.66, weight: 3, cap: 4, reserve: 1, footprint: 2 },
  { slug: 'grotte', zones: ['karst', 'gouffre'], name: 'la Grotte', family: 'reward', biomes: [ROCK, SCREE], weight: 4, cap: 5, reserve: 1, footprint: 2 },
  { slug: 'cascade', zones: ['alpages', 'karst', 'aiguilles'], name: 'la Cascade', family: 'reward', biomes: [ROCK, SCREE], minElev: 0.4, weight: 2, cap: 4, reserve: 1, footprint: 2 },
  { slug: 'erratique', zones: ['pres_bas', 'alpages', 'ruines'], name: 'le Bloc erratique', family: 'reward', biomes: [BOULDERS, AL_MEADOW, GRASS, FLOWER], weight: 4, cap: 5, reserve: 1, footprint: 2 },
  { slug: 'arbre', zones: ['sylve'], name: "l'Arbre remarquable", family: 'reward', biomes: [OLD_GROWTH], weight: 2, cap: 3, reserve: 1, footprint: 2 },
  { slug: 'cairn', name: 'le Cairn', family: 'reward', biomes: [GRASS, AL_MEADOW, HEATH, SCREE, ROCK, FLOWER, AL_FLOWERS, FOREST, PINE], weight: 12, cap: 14, reserve: 1, footprint: 1 },
  { slug: 'sanctuaire', zones: ['aiguilles', 'alpages', 'karst'], name: 'le Sanctuaire', family: 'reward', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.7, weight: 1, cap: 2, reserve: 1, footprint: 2 },
  { slug: 'source_chaude', zones: ['alpages', 'karst'], name: 'la Source chaude', family: 'reward', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.55, weight: 2, cap: 2, reserve: 1, footprint: 2 },
  { slug: 'arche', zones: ['aiguilles', 'karst'], name: "l'Arche de roche", family: 'reward', biomes: [ROCK, SCREE], weight: 2, cap: 2, reserve: 1, footprint: 2 },
  { slug: 'tarn', zones: ['alpages', 'glacier'], name: 'le Tarn', family: 'reward', biomes: [AL_MEADOW, SCREE, AL_FLOWERS], minElev: 0.45, weight: 3, cap: 3, reserve: 1, footprint: 3 },
  { slug: 'petroglyphes', zones: ['karst', 'gouffre', 'aiguilles'], name: 'les Pétroglyphes', family: 'reward', biomes: [ROCK, SCREE], minElev: 0.55, weight: 2, cap: 2, reserve: 1, footprint: 2 },
]

/**
 * Empreinte qu'aurait la Zone d'un type de POI centrée sur (tx,ty) — même calcul
 * (`Math.floor(footprint / 2)`) que celui utilisé plus bas par `placePois` pour
 * poser la Zone réellement : les deux doivent rester en accord. Clampée à la
 * carte (revue « les lieux », Minor « clamp zones aux bords ») : un point proche
 * d'un bord peut recevoir une empreinte qui déborde en négatif ou au-delà de
 * `width`/`height` — une tuile hors carte n'est ni lisible (`terrainAt` la
 * traite en void) ni creusable, et une Zone non clampée fuit dans les boucles
 * qui balayent `[z.x, z.x+z.w)` (rendu, `poisAt`…).
 */
function footprintAt(map: WorldMap, t: PoiType, tx: number, ty: number): Pick<Zone, 'x' | 'y' | 'w' | 'h'> {
  const half = Math.floor(t.footprint / 2)
  return clampFootprint(map, { x: tx - half, y: ty - half, w: t.footprint, h: t.footprint })
}

/** Clampe un rectangle d'empreinte aux limites de la carte [0,width) × [0,height). */
function clampFootprint(map: WorldMap, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>): Pick<Zone, 'x' | 'y' | 'w' | 'h'> {
  const x0 = Math.max(0, z.x)
  const y0 = Math.max(0, z.y)
  const x1 = Math.min(map.width, z.x + z.w)
  const y1 = Math.min(map.height, z.y + z.h)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

/**
 * L'empreinte TOUCHE-T-ELLE l'anneau de bordure ? Alors le lieu n'a rien à faire
 * là : `footprintAt` clampe à la carte, donc un point de semis tiré près du bord
 * reçoit une empreinte rognée qui mord sur le mur scellé. Mesuré : sept lieux sur
 * cinq seeds (dont deux Mines et un Repaire) naissaient à cheval sur l'enceinte —
 * moitié dans le monde, moitié dans un mur qu'on ne perce jamais. On les écarte,
 * on ne les rafistole pas.
 */
function touchesBorderRing(map: WorldMap, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>): boolean {
  return z.x <= 0 || z.y <= 0 || z.x + z.w >= map.width || z.y + z.h >= map.height
}

/**
 * LA TUILE D'ENTRÉE — celle de l'empreinte qui coûte le moins cher à relier au
 * monde, et `undefined` si aucune ne tient dans le budget (cf.
 * `POI_PLACEMENT.MAX_CARVE_TILES`). Départage par balayage row-major : le premier
 * minimum rencontré gagne — déterministe, aucun aléa requis.
 */
function entryTile(
  map: WorldMap, field: CarveField, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>,
): { index: number; cost: number } | undefined {
  let best: { index: number; cost: number } | undefined
  for (let ty = z.y; ty < z.y + z.h; ty++) {
    for (let tx = z.x; tx < z.x + z.w; tx++) {
      const i = ty * map.width + tx
      const d = field.dist[i]!
      if (d > field.limit) continue // hors d'atteinte, ou séparé par de l'eau
      if (best === undefined || d < best.cost) best = { index: i, cost: d }
    }
  }
  return best
}

/**
 * Types valides pour la tuile : biome, altitude, plafond — ET **le lieu s'ouvre
 * sur le monde**.
 *
 * Ce dernier critère est le correctif du 2026-07-13. Il remplace l'ancien
 * (« l'empreinte contient une tuile marchable, ou peut en recevoir une »), qui
 * était vrai et insuffisant : une tuile marchable au cœur d'un massif de roche
 * reste une tuile où nul ne va. On ne demande donc plus au lieu d'avoir un SOL,
 * on lui demande d'avoir un SEUIL — cf. `POI_PLACEMENT.MAX_CARVE_TILES` pour la
 * mesure qui a fixé la règle.
 */
/**
 * OÙ EST-ON ? — le slug de la zone d'une tuile, ou `undefined` sur une carte sans zones.
 *
 * C'est le SEUL lien entre les lieux et le graphe de zones, et il est volontairement mince : un
 * accesseur, pas une dépendance. `poi.ts` ne connaît toujours pas `zonegraph.ts` — il reçoit une
 * fonction, et il s'en sert si elle existe. L'ancienne carte (qui n'a pas de zones) continue donc
 * de poser ses lieux exactement comme avant, sans une ligne de branche.
 */
export type ZoneLookup = (tx: number, ty: number) => string | undefined

function isEligible(
  map: WorldMap,
  field: CarveField,
  t: PoiType,
  tx: number,
  ty: number,
  used: Map<string, number>,
  zoneDe?: ZoneLookup,
): boolean {
  const terr = terrainAt(map, tx, ty)
  if (!t.biomes.includes(terr)) return false

  // LA ZONE, quand la carte en a une — et **elle REMPLACE le filtre d'altitude**.
  //
  // C'est ce qui donne enfin une ADRESSE aux lieux : la Grotte au Karst, le Champ de crevasses au
  // Glacier, l'Arbre remarquable dans la Vieille Sylve. Et c'est plus JUSTE que `minElev` :
  // « le Belvédère est haut » était une approximation d'« il est dans les Hauts Alpages ou les
  // Aiguilles ». On dit maintenant la chose, au lieu de la circonscrire par un nombre.
  //
  // (Les `minElev` de la table ont été calibrés sur l'ANCIEN champ d'altitude continu : sur la
  // nouvelle carte, où l'altitude se dérive d'un palier entier, ils ne veulent plus rien dire.
  // Les garder ET la zone aurait rendu la moitié de la table stérile en silence — le genre de
  // ligne morte que ce projet a déjà payé trois fois.)
  //
  // Un lieu SANS `zones` reste libre d'apparaître partout où son biome le porte, et garde son
  // filtre d'altitude : c'est le cas du Cairn, et c'est voulu — les cairns sont les jalons de
  // TOUTE la vallée, et c'est leur métier de se suivre de proche en proche.
  if (t.zones && zoneDe) {
    const z = zoneDe(tx, ty)
    if (z === undefined || !t.zones.includes(z)) return false
  } else {
    const el = elevationAt(map, tx, ty)
    if (el < (t.minElev ?? 0) || el > (t.maxElev ?? 1)) return false
  }
  if ((used.get(t.slug) ?? 0) >= capFor(map, t)) return false // le plafond suit la SURFACE
  const fp = footprintAt(map, t, tx, ty)
  if (touchesBorderRing(map, fp)) return false
  return entryTile(map, field, fp) !== undefined
}

function candidatesFor(
  map: WorldMap, field: CarveField, tx: number, ty: number, used: Map<string, number>, zoneDe?: ZoneLookup,
): PoiType[] {
  return POI_TYPES.filter((t) => isEligible(map, field, t, tx, ty, used, zoneDe))
}

/**
 * Pose le lieu : la Zone, son nom numéroté, et **le percement de son seuil** —
 * la file des tuiles bloquantes qui le séparent encore du monde, remontée par
 * `field.parent` depuis sa tuile d'entrée. Chacune devient de l'éboulis : la
 * Grotte perce sa porte, le Belvédère sa vire, la Source chaude sa margelle.
 *
 * `isEligible` a déjà garanti que ce seuil tient dans le budget — `entryTile` ne
 * peut donc rendre `undefined` qu'en théorie (défense en profondeur).
 *
 * NOTE D'ORDRE : le champ de creusement est calculé UNE fois, avant toute pose.
 * Percer un seuil ne le met pas à jour — et c'est voulu : les lieux sont espacés
 * d'au moins 96 tuiles, la porte de l'un n'ouvre jamais le seuil de l'autre. Un
 * champ figé est donc exact ici, et il épargne au générateur de tout recalculer
 * quatre-vingts fois.
 */
function placeOne(
  map: WorldMap, field: CarveField, t: PoiType, tx: number, ty: number, used: Map<string, number>,
): void {
  const count = (used.get(t.slug) ?? 0) + 1
  used.set(t.slug, count)
  const z = footprintAt(map, t, tx, ty)
  map.zones.push({ name: `${t.name} ${roman(count)}`, ...z, kind: t.slug })

  const entry = entryTile(map, field, z)
  if (entry === undefined || entry.cost === 0) return // déjà de plain-pied sur le monde

  // Du seuil vers le monde, en suivant le chemin que le champ a mémorisé. On
  // s'arrête à `dist === 0` — c'est-à-dire au monde — et NON à la première tuile
  // marchable rencontrée : le chemin peut très bien traverser une POCHE (des
  // tuiles marchables, mais murées elles aussi) avant de retomber sur la roche
  // qui la sépare encore du monde. S'arrêter là rouvrirait le lieu sur la poche,
  // et la poche sur rien.
  for (let i = entry.index; i !== -1 && field.dist[i]! > 0; i = field.parent[i]!) {
    const ex = i % map.width
    const ey = (i / map.width) | 0
    if (isBlockingTile(map, ex, ey)) setTile(map, ex, ey, TERRAIN_SCREE)
  }
}

/**
 * LA RÉSERVATION (décision d'Alexis, 2026-07-11) — les lieux chargés ne jouent
 * plus à la loterie.
 *
 * Un lieu dont une mécanique dépend ne peut pas se permettre de ne pas exister.
 * Or le tirage pondéré est à **somme nulle** : le semis borne le nombre total de
 * lieux (~66 points pour une somme de plafonds de ~107), donc chaque lieu tiré
 * en prive un autre. Mesuré sur la seed du jeu : le Belvédère avait **10 points
 * éligibles** et sortait pourtant **zéro fois**, écrasé par le Cairn (poids 12,
 * éligible dans neuf biomes) ; et monter son poids ne faisait qu'affamer l'Arche.
 * Un jeu de taupes.
 *
 * D'où : chaque type à `reserve` prend d'abord ses exemplaires garantis, AVANT
 * que le tirage général ne consomme les points. Le reste du semis se joue comme
 * avant — la réservation garantit l'existence, elle ne fixe pas l'abondance.
 *
 * Neutralité spatiale : on sert dans l'ordre de `pts`, qui est DÉJÀ mélangé
 * (Fisher-Yates déterministe, cf. `shuffled`) — donc « le premier point éligible »
 * n'est pas « le point le plus proche de pts[0] ». Le correctif de biais du
 * 2026-07-09 tient, et son test le vérifie.
 *
 * Retourne les INDEX des points consommés, que le tirage général doit sauter.
 */
function reserveCharged(
  map: WorldMap,
  field: CarveField,
  pts: readonly { x: number; y: number }[],
  used: Map<string, number>,
  seed: number,
  radius: number,
  zoneDe?: ZoneLookup,
): Set<number> {
  const taken = new Set<number>()
  // Ordre déterministe : celui de POI_TYPES. Les premiers servis ont priorité
  // sur les points contestés — c'est la table qui arbitre, pas le hasard.
  for (const t of POI_TYPES) {
    const want = Math.min(t.reserve ?? 0, capFor(map, t))
    let got = 0
    for (let i = 0; i < pts.length && got < want; i++) {
      if (taken.has(i)) continue
      const p = pts[i]!
      const tx = Math.floor(p.x)
      const ty = Math.floor(p.y)
      if (!isEligible(map, field, t, tx, ty, used, zoneDe)) continue
      placeOne(map, field, t, tx, ty, used)
      taken.add(i)
      got += 1
    }
    // LE FILET — si le SEMIS n'avait aucun point pour lui, on lui en trouve un.
    while (got < want && placeReserveAnywhere(map, field, t, used, seed, radius, zoneDe)) got += 1
  }
  return taken
}

/**
 * LE FILET DE LA RÉSERVATION — le dernier trou de la promesse, bouché.
 *
 * `reserve` dit : « ce lieu porte une mécanique, il ne peut pas se permettre de ne
 * pas exister » (décision d'Alexis, 2026-07-11). Mais la réservation ne cherchait
 * son point que **dans le semis de Poisson** — soixante-six points sur toute la
 * carte. Un lieu dont le biome est rare pouvait donc perdre une DEUXIÈME loterie :
 * non plus celle du tirage pondéré (celle-là était réglée), mais celle du semis.
 * Vu en direct : l'Arbre remarquable (seul biome possible : la vieille forêt) ne
 * sortait sur aucune carte de la seed 7 — pas faute de vieille forêt, mais faute
 * qu'un des soixante-six points y tombe.
 *
 * On balaie donc la carte à gros pas, on récolte toutes les tuiles où ce lieu
 * pourrait naître **en respectant l'espacement du semis** (sinon il s'agglutinerait
 * contre un voisin), et on en tire une au sort. Déterministe (hash2), spatialement
 * neutre (le tirage porte sur la liste entière, pas sur le premier trouvé — un
 * balayage row-major aurait toujours choisi le coin nord-ouest).
 *
 * Ce n'est PAS un chemin dégradé : c'est ce que « réserver » veut dire. Le semis
 * décide de l'abondance ; la réservation décide de l'existence.
 */
function placeReserveAnywhere(
  map: WorldMap,
  field: CarveField,
  t: PoiType,
  used: Map<string, number>,
  seed: number,
  radius: number,
  zoneDe?: ZoneLookup,
): boolean {
  const step = Math.max(4, Math.round(radius / 4)) // assez fin pour trouver, assez gros pour rester bon marché
  const r2 = radius * radius
  const libres: number[] = []
  for (let ty = step; ty < map.height - step; ty += step) {
    for (let tx = step; tx < map.width - step; tx += step) {
      if (!isEligible(map, field, t, tx, ty, used, zoneDe)) continue
      // L'espacement du semis vaut aussi pour lui : un lieu réservé n'a pas le
      // droit de se coller à un autre (une garde le vérifie).
      let libre = true
      for (const z of map.zones) {
        if (z.kind === undefined) continue
        if (distSq(tx, ty, z.x + z.w / 2, z.y + z.h / 2) < r2) { libre = false; break }
      }
      if (libre) libres.push(ty * map.width + tx)
    }
  }
  if (libres.length === 0) return false // la carte ne peut vraiment pas le porter
  const k = Math.min(libres.length - 1, Math.floor(hash2(t.cap, seed ^ 0x52535620, 0x9f) * libres.length))
  const i = libres[k]!
  placeOne(map, field, t, i % map.width, (i / map.width) | 0, used)
  return true
}

/**
 * Mélange Fisher-Yates déterministe (pur : hash2, pas de Math.random).
 *
 * Indispensable ici : `poissonPoints` renvoie ses points dans l'ORDRE D'ACCEPTATION,
 * c'est-à-dire une vague de croissance partant de `pts[0]`. Comme `placePois` consomme
 * des plafonds durs au fil de l'itération, les points proches de `pts[0]` épuisaient les
 * quotas et les points atteints tard restaient sans POI — un gradient de densité orienté
 * vers `pts[0]` (mesuré : 54 POIs au nord contre 31 au sud sur la seed 2026). Les positions
 * du semis, elles, n'ont jamais été biaisées ; seul leur ordre l'était.
 */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(hash2(i, seed, 0x53484655) * (i + 1))) // salt 'SHFU'
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/**
 * L'ESPACEMENT DU SEMIS sur cette carte — absolu, sauf sur les petites cartes où il
 * se borne à une fraction du petit côté (sinon elles n'auraient aucun lieu). À la
 * taille du jeu, les deux règles donnent le même nombre : 96.
 */
export function poiSpacing(width: number, height: number): number {
  return Math.min(POI_PLACEMENT.SPACING_TILES, POI_PLACEMENT.SPACING_MAX_FRAC * Math.min(width, height))
}

/**
 * Le plafond EFFECTIF d'un type sur cette carte — le plafond de la table, mis à
 * l'échelle de la surface. Voir `CAP_REFERENCE_AREA` : la rareté est une densité,
 * pas un compte. Jamais moins d'un exemplaire si la table en prévoyait au moins un.
 */
export function capFor(map: WorldMap, t: PoiType): number {
  const k = (map.width * map.height) / POI_PLACEMENT.CAP_REFERENCE_AREA
  // LE PLAFOND CROÎT AVEC LA CARTE, IL NE RÉTRÉCIT JAMAIS. Une vallée deux fois plus
  // grande porte deux fois plus de Cairns ; une vallée deux fois plus PETITE garde
  // les siens. (Sans ce `max`, une carte de test de 240×360 — soit 4 % de la surface
  // de référence — voyait TOUS ses plafonds tomber à 1 : vingt-six lieux au total,
  // dont onze pris par les réservations. La carte se vidait, et les tests le disaient.)
  return Math.max(t.cap, Math.round(t.cap * k))
}

/**
 * LE SEMIS, ET SON RYTHME. Poisson espace les points d'au moins `SPACING_TILES` —
 * une régularité parfaite, et c'est bien le défaut : on n'explore pas un papier
 * peint. Un champ basse fréquence abandonne donc les points qui tombent dans ses
 * creux : il reste des GRAPPES (« il y a quelque chose dans ce coin ») et des VIDES
 * (« il n'y a rien, et ce rien se traverse »). L'espacement minimal est intact — on
 * ne fait que renoncer à des points, jamais en rapprocher.
 */
export function poiSemis(width: number, height: number, seed: number): { x: number; y: number }[] {
  const bruts = poissonPoints(width, height, seed, poiSpacing(width, height))
  // Mélangé : les plafonds doivent se consommer dans un ordre SPATIALEMENT NEUTRE (cf. `shuffled`).
  return shuffled(bruts, seed)
}

/** Pose les POIs comme Zones nommées dans map.zones (pur, déterministe). */
export function placePois(map: WorldMap, seed: number, zoneDe?: ZoneLookup): void {
  const radius = poiSpacing(map.width, map.height)
  const pts = poiSemis(map.width, map.height, seed)
  const used = new Map<string, number>()

  // CE QUI COMMUNIQUE AVEC QUOI — calculé une fois, pour toute la carte. Sans ce
  // champ, un lieu peut naître dans une poche marchable au cœur d'un massif : des
  // tuiles parfaitement praticables où nul n'ira jamais. Voir
  // `POI_PLACEMENT.MAX_CARVE_TILES`.
  const field = carveDistanceToMain(map, walkableComponents(map), POI_PLACEMENT.MAX_CARVE_TILES)

  // D'ABORD les lieux chargés : ils réservent leur point (voir `reserveCharged`).
  const taken = reserveCharged(map, field, pts, used, seed, radius, zoneDe)

  // PUIS le tirage général, sur ce qui reste du semis.
  for (let i = 0; i < pts.length; i++) {
    if (taken.has(i)) continue // point déjà pris par une réservation
    const p = pts[i]!
    const tx = Math.floor(p.x)
    const ty = Math.floor(p.y)
    const cands = candidatesFor(map, field, tx, ty, used, zoneDe)
    if (cands.length === 0) continue // biome sans POI valide → point sauvage (l'entre-deux)
    // Tirage pondéré déterministe.
    const total = cands.reduce((s, t) => s + t.weight, 0)
    let r = hash2(tx, ty, seed ^ 0x504f49) * total
    let picked = cands[cands.length - 1]!
    for (const t of cands) {
      if (r < t.weight) { picked = t; break }
      r -= t.weight
    }
    placeOne(map, field, picked, tx, ty, used)
  }
}

const ROMANS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV']
function roman(n: number): string { return ROMANS[n] ?? String(n) }

/**
 * Tuiles marchables de l'empreinte de la zone [z.x, z.x+z.w) × [z.y, z.y+z.h).
 * Si aucune (repaire/tanière posé sur du rock, glacier…), retombe sur l'anneau
 * de tuiles à +1 autour de l'empreinte. Ordre de construction déjà stable
 * (balayage row-major) : un index dans cette liste est donc un tirage
 * déterministe reproductible d'un run à l'autre.
 */
function walkableTilesFor(map: WorldMap, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>): Array<{ tx: number; ty: number }> {
  const inFootprint: Array<{ tx: number; ty: number }> = []
  for (let ty = z.y; ty < z.y + z.h; ty++) {
    for (let tx = z.x; tx < z.x + z.w; tx++) {
      if (!isBlockingTile(map, tx, ty)) inFootprint.push({ tx, ty })
    }
  }
  if (inFootprint.length > 0) return inFootprint
  const ring: Array<{ tx: number; ty: number }> = []
  for (let ty = z.y - 1; ty < z.y + z.h + 1; ty++) {
    for (let tx = z.x - 1; tx < z.x + z.w + 1; tx++) {
      const inside = tx >= z.x && tx < z.x + z.w && ty >= z.y && ty < z.y + z.h
      if (inside) continue
      if (!isBlockingTile(map, tx, ty)) ring.push({ tx, ty })
    }
  }
  return ring
}

/**
 * Spawn runtime des monstres de POI (tanière → sanglier, repaire → cendreux).
 * Déterministe, et garanti sur une tuile marchable : le tirage naïf dans
 * l'empreinte pouvait tomber sur du rock/glacier non praticable (repaire en
 * biome ROCK, tanière en lisière FOREST/rock…) et bloquer le monstre. Si
 * l'empreinte et son anneau +1 n'offrent aucune tuile marchable, le monstre
 * ne spawne pas (rare — un repaire sans sol praticable ne pose rien).
 */
export function spawnPoiMonsters(state: SimState, seed: number): void {
  for (let zone = 0; zone < state.map.zones.length; zone++) {
    // On RETIENT les lieux peuplés : eux seuls repeupleront (spec faune R16). Le
    // peuplement appartient à l'hôte, et un monde qui n'a jamais voulu de bêtes de
    // lieu ne doit pas en voir apparaître au bout de quatre minutes.
    if (populateDen(state, zone, seed) && !state.dens.includes(zone)) state.dens.push(zone)
  }
}

/** Pose la bête d'un lieu sur son empreinte. Sans effet si le lieu n'en a pas. */
function populateDen(state: SimState, zone: number, seed: number): boolean {
  const z = state.map.zones[zone]
  if (!z) return false
  const t = POI_TYPES.find((p) => p.slug === z.kind)
  if (!t?.monster) return false
  const candidates = walkableTilesFor(state.map, z)
  if (candidates.length === 0) return false // aucune tuile praticable dans/autour de l'empreinte
  const r = hash2(z.x, z.y, seed ^ 0x4d4f4e) // 'MON'
  const idx = Math.min(candidates.length - 1, Math.floor(r * candidates.length))
  const tile = candidates[idx]!
  const id = spawnMonster(state, t.monster, tile.tx + 0.5, tile.ty + 0.5)
  const born = state.monsters.find((m) => m.entityId === id)
  if (born) born.homePoi = zone // elle appartient à ce lieu, et elle y reviendra
  return true
}

/**
 * LE RETOUR DES BÊTES DE LIEU (spec faune R16).
 *
 * La bête d'une tanière est RÉSIDENTE : elle ne se dissipe pas avec la faune
 * ambiante. Mais tuée, elle ne revenait jamais — et le lieu devenait une coquille
 * vide pour le reste de la saison. Un joueur qui « nettoyait » les tanières
 * supprimait définitivement une source de viande de sa vallée.
 *
 * Elle repeuple donc son lieu après `DEN_RESPAWN_TICKS` — mais **jamais sous les
 * yeux de quelqu'un** (`DEN_SPAWN_CLEARANCE`) : une bête qui se matérialise devant
 * vous, c'est le décor qui avoue. Tant qu'un avatar campe la tanière, on attend.
 *
 * Ce n'est PAS un robinet : le délai est long, et un seul occupant par lieu. On ne
 * farme pas une tanière — on y revient.
 */
export function advanceDens(state: SimState, seed: number): void {
  if (state.dens.length === 0) return // aucun lieu peuplé par l'hôte : rien à repeupler

  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  const avatars = state.entities.filter((e) => !monsterIds.has(e.id) && e.hp > 0)
  const occupied = new Set<number>()
  for (const m of state.monsters) if (m.homePoi !== undefined) occupied.add(m.homePoi)

  for (const zone of state.dens) {
    const z = state.map.zones[zone]
    if (!z) continue
    if (occupied.has(zone)) continue // sa bête est là : rien à faire

    const pending = state.denRespawns.find((d) => d.zone === zone)
    if (!pending) {
      // Elle vient de tomber : on note l'heure de son retour.
      state.denRespawns.push({ zone, at: state.tick + FAUNA.DEN_RESPAWN_TICKS })
      continue
    }
    if (state.tick < pending.at) continue

    // L'heure est venue — mais pas devant témoin.
    const cx = z.x + z.w / 2
    const cy = z.y + z.h / 2
    let watched = false
    for (const a of avatars) {
      if (distSq(a.x, a.y, cx, cy) <= FAUNA.DEN_SPAWN_CLEARANCE * FAUNA.DEN_SPAWN_CLEARANCE) {
        watched = true
        break
      }
    }
    if (watched) continue

    if (populateDen(state, zone, seed)) {
      state.denRespawns = state.denRespawns.filter((d) => d.zone !== zone)
    }
  }
}
