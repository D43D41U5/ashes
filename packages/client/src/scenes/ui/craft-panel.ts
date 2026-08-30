/**
 * LE PANNEAU D'ARTISANAT — à droite de l'écran d'inventaire (spec craft-file F14).
 *
 * Depuis LE PIVOT RUST (spec construction R20), il est REDEVENU PUR : il ne
 * fabrique QUE des recettes (outils, armes, survie, matériaux, campement). Les
 * PIÈCES STRUCTURELLES (mur, porte, sol, toit) ont leur propre menu — celui du
 * MARTEAU (`ui/build-menu.ts`) ; les COMPOSANTS (enclume, four…) sont des objets
 * qu'on tient et pose. Le panneau ne montre plus jamais de construction.
 *
 * Quatre règles, demandées le 2026-07-13 :
 *   1. ON NE MONTRE QUE CE QU'ON PEUT FAIRE ICI. Une recette de four sans four à
 *      portée n'est pas grisée : elle n'est PAS LÀ. Le panneau dit ce que le lieu
 *      permet — c'est une lecture du lieu, pas un catalogue.
 *   2. GROUPÉ PAR CATÉGORIE (outils, armes, survie, matériaux), en-têtes visibles.
 *   3. DÉFILABLE (molette) — la liste ne déborde jamais de son cadre.
 *   4. UN CHAMP DE RECHERCHE pour filtrer au clavier.
 *
 * La logique — QUOI afficher — est PURE et testée (`craftRows`). Le Phaser en
 * dessous n'est que du placement.
 *
 * Ce qui reste GRISÉ, c'est ce dont on n'a pas les MATÉRIAUX : la recette est
 * faisable ici, elle est juste hors de portée de bourse — une invitation à aller
 * chercher les trois fibres qui manquent.
 */
import { RECIPES, countOf, libelleExigence, type Exigence, type Inventory, type ItemBag, type ItemId, type RecipeId } from '@ashes/sim'
import type { CapacitesEnPortee } from '../../hud-state'
import { ITEM_LABELS } from '../../render/item-art'

// ─── La logique (pure, testée — craft-panel.test.ts) ─────────────────────────

export type CraftCategory = 'campement' | 'composants' | 'outils' | 'armes' | 'survie' | 'materiaux'

export const CATEGORY_LABEL: Record<CraftCategory, string> = {
  campement: 'CAMPEMENT',
  // Les COMPOSANTS (spec construction R20) : fabriqués au Feu, portés, posés — ce
  // sont des OBJETS d'artisanat, pas des pièces du menu du marteau (les barrières).
  composants: 'COMPOSANTS',
  outils: 'OUTILS',
  armes: 'ARMES',
  survie: 'SURVIE',
  materiaux: 'MATÉRIAUX',
}

/**
 * L'ordre des rayons à l'écran : ALPHABÉTIQUE (décision utilisateur, 2026-07-13).
 * Un ordre qu'on peut PRÉDIRE se cherche moins qu'un ordre qu'on a jugé « logique ».
 * DÉRIVÉ, jamais recopié : un nouveau rayon prend sa place tout seul.
 */
export const CATEGORY_ORDER: readonly CraftCategory[] = (Object.keys(CATEGORY_LABEL) as CraftCategory[]).sort((a, b) =>
  CATEGORY_LABEL[a].localeCompare(CATEGORY_LABEL[b], 'fr'),
)

/**
 * La catégorie de chaque recette. `Record<RecipeId, …>` est le garde-fou : ajouter
 * une recette à la sim sans lui donner de rayon ne compile plus.
 */
export const RECIPE_CATEGORY: Record<RecipeId, CraftCategory> = {
  // LE FEU DE CAMP est une recette comme une autre : elle produit un OBJET
  // (station: null → faisable partout) qu'on pose ensuite au sol.
  campfire: 'campement',
  // LE COFFRE (décision d'Alexis) : fabriqué à la main, posé en objet tenu — plus au marteau.
  chest: 'campement',
  sechoir: 'campement', // la claie du bord de l'eau : on la pose à son camp (peche.md S1)
  braise_mere: 'composants', // la parade de la cendre : forgée N2, posée à la frange (cendre.md R28)
  crude_axe: 'outils',
  crude_pickaxe: 'outils',
  // LE TIR (spec `tir.md`) : les arcs sont des ARMES, la flèche est leur munition —
  // elle se range avec eux, parce qu'on vient les chercher dans le même geste.
  crude_bow: 'armes',
  crude_rod: 'outils', // la canne (peche.md D4) : un outil de récolte, pas une arme
  // LA TORCHE (spec `torche.md`) : un outil, et le seul dont le rendement est de VOIR.
  torche: 'outils',
  crude_knife: 'outils', // le couteau (depecage.md D4) : un outil de récolte, pas une arme
  bow: 'armes',
  arrow: 'armes',
  axe: 'outils',
  pickaxe: 'outils',
  iron_axe: 'outils',
  iron_pickaxe: 'outils',
  steel_axe: 'outils',
  steel_pickaxe: 'outils',
  hammer: 'outils',
  crude_spear: 'armes',
  spear: 'armes',
  stew: 'survie',
  cooked_meat: 'survie',
  tenue_hiver: 'survie', // la tenue d'hiver : de la survie pure (le froid tue en acte III)
  graine: 'survie', // la graine du potager (agriculture) : de la nourriture à venir
  // Les trois graines de saison (S16) — même famille, même rayon.
  graine_verte: 'survie',
  graine_fruit: 'survie',
  graine_tubercule: 'survie',
  rope: 'materiaux',
  leather: 'materiaux', // le cuir : un matériau tanné
  iron_ingot: 'materiaux',
  iron_ingot_charbon: 'materiaux', // le même lingot, fondu au charbon de bois (R24) : même rayon
  steel_ingot: 'materiaux', // l'acier : le lingot du T3
  // Les COMPOSANTS (spec construction §4bis) : assemblés au Feu, posés pour émerger.
  enclume: 'composants',
  furnace: 'composants',
  four_acier: 'composants',
  workshop: 'composants',
  tour_meca: 'composants',
  atelier_lourd: 'composants',
  silo: 'composants',
  cave: 'composants',
  reserve: 'composants',
  parcelle: 'composants',
  serre: 'composants',
  terroir: 'composants',
  parcelle_de_suie: 'composants', // le jardin de suie : fabriqué au Feu, posé sur la cendre (agriculture.md J1)
}

/** Une ligne de la liste : un en-tête de rayon, ou une recette. */
export type CraftRow = { kind: 'header'; label: string } | { kind: 'recipe'; id: RecipeId }

/** Sans accents ni casse : taper « epieu » doit trouver « Épieu taillé ». */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * CE QUE LE PANNEAU MONTRE, ici et maintenant. Pur : `stations` = les stations à
 * portée (le contexte), `query` = la recherche. Les recettes `station: null` (la
 * couche 1, à la main) sont TOUJOURS là — on les fait n'importe où.
 *
 * Une catégorie vide ne pose pas d'en-tête : un rayon sans article n'est pas un rayon.
 */
export function craftRows(seen: readonly RecipeId[], query: string): CraftRow[] {
  const q = fold(query.trim())
  const visible = (Object.keys(RECIPES) as RecipeId[]).filter((id) => {
    // LA DÉCOUVERTE décide de l'APPARITION (D2) — plus le lieu. Une recette qu'on a
    // rencontrée garde sa ligne où qu'on soit ; ce qu'on n'a jamais croisé n'existe pas
    // encore. C'est ce qui rend le catalogue proportionnel à la progression au lieu de
    // présenter deux cents lignes grises à la minute zéro.
    if (!seen.includes(id)) return false
    if (q === '') return true
    return fold(ITEM_LABELS[RECIPES[id].output]).includes(q) // LA RECHERCHE
  })

  const rows: CraftRow[] = []
  for (const cat of CATEGORY_ORDER) {
    const ids = visible.filter((id) => RECIPE_CATEGORY[id] === cat)
    if (ids.length === 0) continue
    rows.push({ kind: 'header', label: CATEGORY_LABEL[cat] })
    for (const id of ids) rows.push({ kind: 'recipe', id })
  }
  return rows
}

/**
 * L'ÉTAT D'UNE LIGNE, et sa RAISON — le remplacement du filtre qui cachait (D2).
 *
 * L'ancienne règle (13 juillet) faisait disparaître ce que le lieu ne permettait pas :
 * excellente à 33 recettes, elle empêchait à 200 de savoir que le contenu existe. On
 * montre désormais, grisé, avec la raison en toutes lettres — « exige un Atelier N2 » —
 * parce que c'est la raison elle-même qui donne envie de bâtir la station suivante.
 */
export function etatRecette(
  caps: CapacitesEnPortee,
  aLesMateriaux: boolean,
  id: RecipeId,
  /** Comment nommer l'exigence. Défaut : la forme AVEC article, pour une phrase. Une puce
   *  étroite passe `nomExigence` (la forme nue) — sinon « EXIGE un Atelier N1 » passe à la
   *  ligne et double la hauteur de la ligne, ce que le navigateur a montré. */
  nommer: (b: Exigence) => string = libelleExigence,
): { etat: 'faisable' | 'manque' | 'verrouille'; raison?: string } {
  const besoin = RECIPES[id].requiert
  if (!lieuPermet(caps, besoin)) return { etat: 'verrouille', raison: nommer(besoin!) }
  return { etat: aLesMateriaux ? 'faisable' : 'manque' }
}

/**
 * Le lieu répond-il à l'exigence ? `null` = à la main, donc toujours oui (spec
 * craft-fortune C1). Sinon la fonction doit être à portée AU MOINS à ce palier — c'est le
 * même verdict que `sertExigence` côté sim, lu sur la capacité publiée par le pont.
 */
export function lieuPermet(caps: CapacitesEnPortee, besoin: Exigence | null): boolean {
  return besoin === null || (caps[besoin.fonction] ?? 0) >= besoin.niveau
}

/**
 * LES FONCTIONS QUI MANQUENT ICI — dérivé, plus écrit à la main.
 *
 * La note « stations absentes » de l'écran perso lisait une liste de trois entrées
 * (`['furnace','workshop','fire']`) quand la sim en comptait cinq : le four d'acier et
 * l'atelier lourd ne pouvaient STRUCTURELLEMENT pas être annoncés absents. On dérive
 * désormais des recettes elles-mêmes — une exigence qu'aucune recette ne porte n'a pas à
 * être annoncée, et une exigence neuve entre toute seule.
 */
export function fonctionsAbsentes(caps: CapacitesEnPortee): Exigence[] {
  const besoins: Exigence[] = []
  for (const id of Object.keys(RECIPES) as RecipeId[]) {
    const b = RECIPES[id].requiert
    if (b === null || lieuPermet(caps, b)) continue
    // On ne garde que le palier le PLUS BAS manquant par fonction : annoncer « Forge N2 et
    // Forge N3 absentes » quand on n'a aucune forge dit deux fois la même chose.
    const vu = besoins.find((x) => x.fonction === b.fonction)
    if (vu === undefined) besoins.push(b)
    else if (b.niveau < vu.niveau) vu.niveau = b.niveau
  }
  return besoins
}

/** Le coût, en une ligne : « bois 2 · pierre 3 · corde 1 ». */
export function costLine(id: RecipeId): string {
  return bagLine(RECIPES[id].inputs)
}

/** Un jeton de coût : ce qu'on lit, et s'il manque à la bourse. */
export interface CoutJeton {
  texte: string
  manque: boolean
}

/**
 * LE COÛT, JETON PAR JETON — « bois 2 » d'un côté, « fibre 2 (0) » de l'autre, et celui
 * qui manque le DIT.
 *
 * Il vit ici, pur, parce que les DEUX menus en ont besoin et qu'ils ne l'écrivaient pas
 * pareil : le marteau nommait ses items en anglais brut (« wood 2 ») et rougissait le
 * manquant ; l'artisanat les nommait en français et ne rougissait rien. Deux menus voisins,
 * deux vérités — exactement ce que le composant partagé est venu supprimer.
 */
export function coutJetons(inputs: ItemBag, inv: Inventory): CoutJeton[] {
  return (Object.keys(inputs) as ItemId[]).map((item) => {
    const need = inputs[item] ?? 0
    const ai = countOf(inv, item)
    return { texte: ai >= need ? `${ITEM_LABELS[item].toLowerCase()} ${need}` : `${ITEM_LABELS[item].toLowerCase()} ${need} (${ai})`, manque: ai < need }
  })
}

export function bagLine(inputs: ItemBag): string {
  return (Object.keys(inputs) as ItemId[])
    .map((item) => `${ITEM_LABELS[item].toLowerCase()} ${inputs[item]}`)
    .join(' · ')
}
