/**
 * LES STRUCTURES EN `_lit` — les chips dressés (spec da-feeling R4, vague A du 25/07).
 *
 * Chaque chip 16×16 de `BootScene.makeStructures` reçoit son albédo APLATI (silhouette
 * partagée — deux backends, une forme ; les MATÉRIAUX gardés : ferrure dorée, braise du four,
 * vitrage ; le hillshade retiré — il n'y en avait presque pas, ces chips étaient déjà plats)
 * et sa normale blocky. Le swap vit dans `snapshot-view.syncStructures`, dérivé de
 * `LIT_STRUCTURE_TYPES` — jamais une liste recopiée.
 *
 * HORS PÉRIMÈTRE, et c'est un CHOIX consigné :
 *   • `wall`/`door` (l'autotile re-texture chaque frame — la recette champ-de-hauteur est le
 *     chantier suivant) ; `fire` (déjà `_lit`, generateFireProp) ;
 *   • le COFFRE, parti dans `bati-art.ts` : il est désormais vu à 45° comme le reste du
 *     mobilier (dessus foreshortené + face avant), au lieu d'être un carré plat ;
 *   • les pièces du MONDE BÂTI (mobilier, clôture, mur ruiné) : elles vivent dans `bati-art.ts`,
 *     qui les dessine UNE fois et en tire ses DEUX textures. Elles y gagnent ce que les chips
 *     d'ici n'ont pas : une vraie silhouette et du relief GRAVÉ (mesuré : un chip plein cadre
 *     s'incline de 0,0° sur sa matière — sa `_lit` ne fait rien à l'intérieur) ;
 *   • les pièces AU RAS DU SOL — `floor`, `roof`, `parcelle`, `terroir` : une normale en butte
 *     ferait de chaque tuile un coussin (un plancher-édredon, un toit matelassé par tuile).
 *     Elles restent peintes, et la question « quelle normale pour le plat ? » est consignée
 *     pour Alexis (docs/decisions.md).
 *
 * Les ÉMISSIFS (braise du four, flamme bleutée du four d'acier, voyant de l'atelier lourd)
 * restent dans l'albédo : la nuit les assombrit comme le reste — s'ils doivent LUIRE un jour,
 * ce sera un FX au patron FireFx, pas une exception du pipeline.
 */
import type Phaser from 'phaser'
import { disc, tri } from './lit-props'
import { cleLit, newCanvas, registerLitPaire } from './normal-map'

interface LitChip {
  type: string
  passes?: number
  k?: number
  draw: (ctx: CanvasRenderingContext2D) => void
}

/** LES CHIPS SONT TOUS DRESSÉS — ce sont des BÂTIMENTS vus de trois quarts, pas des dalles.
 *  Ils ont donc tous leur retourné (2026-08-27, « la même technique pour tout ce qui est
 *  dressé »). Le drapeau ne se met pas par chip : il n'y a pas de cas, et un `dresse?: boolean`
 *  par entrée aurait invité quelqu'un à en poser un `false` sans y penser. Ce qui est AU RAS DU
 *  SOL (`floor`, `roof`, `parcelle`, `terroir`) n'a jamais eu de chip ici — voir l'en-tête. */
const CHIPS_DRESSES = true

const CHIPS: readonly LitChip[] = [
  { type: 'workshop', draw: (c) => { c.fillStyle = '#3c3c40'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#5c5c62'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#2a2a2e'; c.fillRect(4, 7, 8, 5) } },
  { type: 'furnace', draw: (c) => { c.fillStyle = '#4a3220'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#9c7448'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#2a2a2e'; c.fillRect(4, 4, 8, 8); c.fillStyle = '#e8842c'; c.fillRect(6, 8, 4, 3) } },
  { type: 'enclume', draw: (c) => { c.fillStyle = '#24242a'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#3c3c44'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#54545e'; c.fillRect(2, 5, 12, 2); c.fillStyle = '#3c3c44'; tri(c, 11, 5, 16, 5, 11, 9); c.fillStyle = '#24242a'; c.fillRect(6, 10, 4, 4) } },
  { type: 'four_acier', draw: (c) => { c.fillStyle = '#2a3038'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#4a5560'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#1c2228'; c.fillRect(4, 5, 8, 8); c.fillStyle = '#7ac0ff'; c.fillRect(6, 8, 4, 4); c.fillStyle = '#d8f0ff'; c.fillRect(7, 9, 2, 2) } },
  { type: 'tour_meca', draw: (c) => { c.fillStyle = '#2a2a30'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#3c3c44'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#8a6234'; disc(c, 8, 8, 4); c.fillStyle = '#2a2a30'; disc(c, 8, 8, 2) } },
  { type: 'atelier_lourd', draw: (c) => { c.fillStyle = '#1c1c22'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#2e2e34'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#44444c'; c.fillRect(2, 2, 12, 3); c.fillStyle = '#e8842c'; c.fillRect(5, 8, 4, 3) } },
  { type: 'silo', draw: (c) => { c.fillStyle = '#4a3520'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#8a6a3a'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#a8834a'; c.fillRect(2, 2, 5, 12); c.fillStyle = '#6a4c2c'; c.fillRect(6, 1, 4, 2) } },
  { type: 'cave', draw: (c) => { c.fillStyle = '#2a2a30'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#4a4a52'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#1c1c22'; c.fillRect(5, 6, 6, 8); c.fillStyle = '#66666e'; c.fillRect(1, 2, 14, 2) } },
  { type: 'reserve', draw: (c) => { c.fillStyle = '#3a2c1e'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#7a5a34'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#9a9aa3'; c.fillRect(1, 5, 14, 1); c.fillRect(1, 10, 14, 1) } },
  { type: 'serre', draw: (c) => { c.fillStyle = '#6a4c2c'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#bfe0d8'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#8ab0a8'; c.fillRect(7, 1, 1, 14); c.fillRect(1, 7, 14, 1) } },
  // La MAISON : silhouette NON pleine-cadre (coins du pignon transparents, rangée basse vide) —
  // reproduite à l'exact, c'est elle qui donne le pignon facetté.
  { type: 'house', draw: (c) => { c.fillStyle = '#7a4a2a'; c.fillRect(1, 6, 14, 9); c.fillStyle = '#9c3f2e'; tri(c, 0, 7, 8, 0, 16, 7); c.fillStyle = '#2a1e12'; c.fillRect(6, 10, 4, 5) } },
]

/** Les `Structure.type` qui ont leur `_lit` — la source du swap de SnapshotView (jamais recopié). */
export const LIT_STRUCTURE_TYPES: ReadonlySet<string> = new Set(CHIPS.map((c) => c.type))

/** Toutes les clés générées — la surface testable (garde A1 de la spec da-feeling). Le retourné
 *  en fait partie : une clé absente que le rendu demande, c'est le carré vert. */
export const LIT_STRUCTURE_KEYS: ReadonlySet<string> = new Set(
  CHIPS.flatMap((c) => [cleLit(`st-${c.type}`), ...(CHIPS_DRESSES ? [cleLit(`st-${c.type}`, true)] : [])]),
)

export function generateLitStructures(scene: Phaser.Scene): void {
  for (const chip of CHIPS) {
    const alb = newCanvas(16, 16)
    chip.draw(alb.ctx)
    registerLitPaire(scene, `st-${chip.type}`, {
      albedo: alb.c, dresse: CHIPS_DRESSES, passes: chip.passes ?? 1, k: chip.k ?? 3.5,
    })
  }
}
