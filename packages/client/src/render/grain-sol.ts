/**
 * LA MATIÈRE SOUS-TUILE DU SOL — cinq familles de matériau, une par façon dont le sol se
 * comporte sous le pied (décision d'Alexis, 2026-07-30).
 *
 * ═══ POURQUOI DES FAMILLES, ET PAS UN GRAIN UNIQUE ═══
 *
 * Le bake du sol fait 1 px par tuile : un aplat de 16 px à l'écran, quand l'eau d'à côté est
 * calculée au pixel. On comble l'écart par un bruit-valeur postérisé en CRANS FRANCS à la
 * maille 4 px — la grille canonique de la DA (brume, Feu) — en luminance seule, statique.
 *
 * Mais un grain UNIQUE serait faux, et l'histogramme le dit : sur une carte réelle, 17 terrains
 * portent 98 % de la surface et aucun ne dépasse 14 % (MESURÉ le 2026-07-30, seed de la Racine,
 * 3,75 M de tuiles). La neige pèse 11 % et la forêt calcinée 11 % : leur appliquer le même grain
 * blocky, c'est affirmer qu'on marche sur la même chose. Or la neige est lisse et balayée, pas
 * granuleuse.
 *
 * Cinq familles couvrent ~96 % de la carte, aucune anecdotique — minéral 29 %, litière 24 %,
 * herbeux 24 %, neige 11 %, humide 7 %. C'est la forme que le projet donne déjà à son
 * vocabulaire : `matiere.ts` nomme des MATÉRIAUX, pas des objets. Cinq jeux de réglages se
 * calibrent en playtest ; dix-sept, non.
 *
 * ═══ CE QUI FERME L'AUTRE ROUTE ═══
 *
 * Moduler l'amplitude par tuile via l'alpha des sommets est IMPOSSIBLE : `Mesh2D` n'implémente
 * qu'`AlphaSingle` (vérifié dans les typings de Phaser 4). D'où l'atlas à N blocs : chaque tuile
 * vise le bloc de sa famille par ses UV. Aucun sommet de plus, aucun draw call de plus — et à
 * l'intérieur d'une famille la continuité tient, l'UV suivant toujours `tx % GRAIN_TILES`.
 *
 * Pur (aucun import Phaser) : la cuisson de l'atlas vit dans `scenes/world/ground-layer.ts`.
 */
import { fbm2, TERRAINS } from '@ashes/sim'

/** La maille du grain, en px monde — la grille canonique de l'art (brume, Feu). */
export const GRAIN_CELL_PX = 4

/** Le bloc d'une famille : 16×16 tuiles, soit 64×64 cellules de 4 px. */
export const GRAIN_TILES = 16
export const GRAIN_CELLS = (GRAIN_TILES * 16) / GRAIN_CELL_PX // 64

/** Les cinq familles, dans l'ORDRE DES BLOCS de l'atlas — l'index sert d'UV. */
export const FAMILLES = ['mineral', 'litiere', 'herbe', 'neige', 'humide'] as const
export type Famille = (typeof FAMILLES)[number]

interface Profil {
  /** Échelle du bruit, en cellules : petit = motif serré et cassant, grand = ondulation large. */
  echelle: number
  /** Les trois crans, du plus clair au plus sombre. TOUS ≤ 1 : en MULTIPLY, on ne peut
   *  qu'assombrir — un cran > 1 serait silencieusement écrêté par le mélange. */
  crans: readonly [number, number, number]
  /** Les deux seuils de postérisation : t < s0 → cran 2 · t < s1 → cran 1 · sinon cran 0. */
  seuils: readonly [number, number]
  /**
   * L'AMPLITUDE DU DAMIER PAR TUILE (crête à crête), qui appartient au bake et non à l'atlas.
   *
   * MESURÉ le 2026-07-30, et c'est la surprise de la planche : sur la neige, témoin et matière
   * étaient presque indiscernables. Le damier global du bake (±3,5 %) écrasait un grain doux
   * de 1 % — et sur un biome CLAIR il ne se lit pas comme de la matière, il se lit comme une
   * GRILLE de 16 px. Le vrai défaut de la neige n'était pas le manque de grain, c'était lui.
   *
   * Le damier devient donc une propriété de famille au même titre que les crans : là où le
   * grain sous-tuile porte la variation, la tuile peut se taire. De moyenne 1 par construction
   * (`1 − d/2 + d × hash`), il ne demande aucune compensation.
   */
  damier: number
}

/**
 * LES PROFILS. Chaque famille dit ce qu'on foule, pas seulement à quel point c'est marqué :
 * l'ÉCHELLE porte le caractère (un éboulis est cassant et serré, une congère est large et
 * molle) autant que l'amplitude. Ordres de grandeur calibrables en playtest, comme tout
 * nombre d'équilibrage.
 */
const PROFILS: Record<Famille, Profil> = {
  // Roche, éboulis, chaos : cassé, contrasté, serré. C'est la famille qui a le droit d'être
  // franche — on doit lire de la pierre brisée, pas un aplat gris.
  mineral: { echelle: 2.4, crans: [1, 0.93, 0.855], seuils: [0.36, 0.56], damier: 0.07 },
  // Sous-bois : litière fine, tachetée, medium. La forêt a déjà son propre sol (`solForet`) ;
  // le grain le complète sans le doubler.
  litiere: { echelle: 3.0, crans: [1, 0.955, 0.915], seuils: [0.34, 0.54], damier: 0.055 },
  // Herbe, lande, alpages : très fin, discret. Un pré se lit presque uni — trop de grain et
  // l'herbe devient de la moquette.
  herbe: { echelle: 3.4, crans: [1, 0.975, 0.95], seuils: [0.32, 0.52], damier: 0.045 },
  // Neige, glacier : large et mou — des congères, pas du grain. La plus douce des cinq, et
  // c'est tout l'argument des familles : le grain unique la rendait granuleuse, donc fausse.
  // La congère porte sa variation par le grain LARGE, et se tait à la tuile : c'est
  // l'inverse exact du réglage global, et la seule façon que la neige cesse d'être une grille.
  neige: { echelle: 7.0, crans: [1, 0.98, 0.962], seuils: [0.3, 0.5], damier: 0.012 },
  // Marais, tourbière, roselière : moucheté, irrégulier, sourd — le sec et le détrempé.
  humide: { echelle: 2.7, crans: [1, 0.945, 0.895], seuils: [0.38, 0.58], damier: 0.05 },
}

/**
 * TERRAIN → FAMILLE. `null` = aucun grain, et c'est délibéré : ces terrains ont leur propre
 * couche (l'eau son shader, la falaise sa paroi, le mur son bâti) ou n'existent pas (void).
 * C'est la même règle que le fondu de frontière du bake, qui les tient déjà pour structurels.
 *
 * La table doit couvrir TOUT `TERRAINS` — le registre de la sim est l'autorité, et un test
 * l'affirme : ajouter un biome sans lui donner de matière fait rougir la suite, pas passer
 * un aplat en douce.
 */
export const FAMILLE_PAR_TERRAIN: Record<number, Famille | null> = {
  0: null, // void
  1: 'herbe', // grass
  2: 'mineral', // road — une sente battue, du gravier tassé
  3: 'litiere', // forest
  4: null, // shallow_water — le shader
  5: 'mineral', // rock
  6: null, // deep_water — le shader
  7: null, // wall — le bâti
  8: 'humide', // marsh
  9: 'mineral', // scree
  10: 'neige', // snow
  11: 'herbe', // heath
  12: 'herbe', // alpine_meadow
  13: 'litiere', // pine
  14: 'litiere', // larch
  15: 'neige', // glacier
  16: 'mineral', // boulders
  17: 'herbe', // flower_meadow
  18: 'humide', // peat_bog
  19: 'humide', // reed_marsh
  20: 'herbe', // alpine_flowers
  21: 'litiere', // burnt_forest
  22: 'litiere', // old_growth
  23: null, // cliff — la paroi
}

/** L'index de bloc d'une famille dans l'atlas (son UV horizontal). */
export function indexFamille(f: Famille): number {
  return FAMILLES.indexOf(f)
}

/** La famille d'un terrain, ou `null` s'il ne porte pas de grain. */
export function familleDe(terrain: number): Famille | null {
  return FAMILLE_PAR_TERRAIN[terrain] ?? null
}

/** Le facteur de luminance d'une cellule (coordonnées CELLULE, pas tuile) : fbm postérisé. */
export function grainFacteur(cx: number, cy: number, f: Famille, seed: number): number {
  const p = PROFILS[f]
  const t = fbm2(cx, cy, p.echelle, seed)
  return t < p.seuils[0] ? p.crans[2] : t < p.seuils[1] ? p.crans[1] : p.crans[0]
}

/**
 * LA MOYENNE D'UNE FAMILLE — et elle est la CONTREPARTIE du MULTIPLY.
 *
 * La passe ne peut qu'assombrir : sans compensation, adopter le grain ferait foncer le monde
 * de 2 à 6 % selon la famille, en silence. On relève donc le bake de `1 / moyenne` sur chaque
 * tuile, et la luminance moyenne du composite retombe sur celle du témoin.
 *
 * Elle est MESURÉE sur le bloc réellement cuit, jamais estimée depuis les seuils : une seule
 * vérité, donc l'atlas et la compensation ne peuvent pas diverger.
 */
const moyennes = new Map<string, number>()
export function moyenneFamille(f: Famille, seed: number): number {
  const cle = f + ':' + seed
  const memo = moyennes.get(cle)
  if (memo !== undefined) return memo
  let somme = 0
  for (let cy = 0; cy < GRAIN_CELLS; cy++) {
    for (let cx = 0; cx < GRAIN_CELLS; cx++) somme += grainFacteur(cx, cy, f, seed)
  }
  const m = somme / (GRAIN_CELLS * GRAIN_CELLS)
  moyennes.set(cle, m)
  return m
}

/** Les ids de terrain que le registre de la sim déclare — l'autorité de l'exhaustivité. */
export function terrainsDeclares(): number[] {
  return Object.keys(TERRAINS).map(Number)
}

/** Le profil d'une famille (lecture seule) — pour les tests et la planche d'essai. */
export function profilDe(f: Famille): Readonly<Profil> {
  return PROFILS[f]
}
