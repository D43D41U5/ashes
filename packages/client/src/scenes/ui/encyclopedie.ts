/**
 * L'ENCYCLOPÉDIE — CE QUE L'ÉCRAN A LE DROIT DE DIRE.
 *
 * Ce module DÉRIVE, depuis les tables de `/sim` et le carnet de l'avatar, exactement ce que
 * l'onglet ENCYCLOPÉDIE affiche — et rien de plus. Il ne dessine pas : `hud-character.ts`
 * pose le DOM à partir de ce qu'il rend ici. La séparation existe pour UNE raison, et c'est
 * une règle de jeu :
 *
 *   **UNE ENTRÉE JAMAIS RENCONTRÉE NE DIT RIEN.** (décision d'Alexis, 2026-08-24 — étendue
 *   ce jour-là du bestiaire des poissons à TOUTES les sections.)
 *
 *   Pas son nom, pas son icône, pas ses conditions, et surtout pas de fiche au survol :
 *   `fiche` vaut `null`, donc le rendu n'a rien à poser sous le curseur. Une fiche « vide »
 *   qu'on cacherait en CSS serait la même fuite, à un inspecteur près.
 *
 * *Conséquence acquise et assumée : le panneau ARTISANAT, lui, liste toutes les recettes
 * découvertes. La recette d'une hache d'acier se lit donc là-bas, et pas ici.*
 *
 * Cette promesse ne se garde pas à l'œil : elle se prouve par un balayage EXHAUSTIF de
 * TOUTES les sections (`encyclopedie.test.ts`), qui cherche dans chaque case muette la
 * moindre chaîne révélatrice. Une entrée ajoutée demain à `/sim` est couverte par
 * construction — c'est tout l'intérêt de dériver ici plutôt que de se souvenir, dans un `if`
 * du rendu, de ne pas parler.
 *
 * ⚠ RIEN N'EST ÉCRIT EN DUR ICI de ce que `/sim` sait déjà : les entrées, leurs rangées et
 * leurs chiffres se lisent dans `NODE_DEFS`, `TOOL_TIERS`, `WEAPON_PROFILES`, `MONSTER_DEFS`,
 * `FISH_SPECIES`, `RECIPES`, `COOK_SLOT`… Une espèce, un outil ou une arme ajoutés à la sim
 * apparaissent ici sans qu'on y touche.
 */
import {
  AGRICULTURE,
  BALANCE,
  COOK_SLOT,
  DRY_SLOT,
  FISH_SPECIES,
  FOOD_VALUES,
  ITEM_WEIGHT,
  MONSTER_DEFS,
  NODE_DEFS,
  RECIPES,
  SPOIL_CYCLES,
  STACK_DEFAULT,
  STACK_SIZES,
  TERRAINS,
  TOOL_DURABILITIES,
  TOOL_TIERS,
  TOOL_YIELD,
  WEAPON_DAMAGE,
  WEAPON_PROFILES,
  ZONES,
  compteEncyclo,
  connuEncyclo,
  isRangedWeapon,
  type ClasseDePrise,
  type FishSpecies,
  type ItemId,
  type LigneEncyclo,
  type MonsterType,
  type NodeType,
  type RecipeId,
  type SkillId,
  type ToolFamily,
  type VerbeCarnet,
} from '@ashes/sim'
import { ITEM_LABELS } from '../../render/item-art'
import { nomDeTerrain } from '../../render/terrain-labels'
import { SKILL_LABELS } from './skill-labels'

/* ═══ CE QUE LE RENDU REÇOIT ════════════════════════════════════════════════ */

/** Une jauge : combien de crans allumés sur combien, et le mot qui la dit. */
export interface Jauge {
  crans: number
  total: number
  /** La teinte de la jauge — la grammaire de `palette.ts` : ambre par défaut. */
  teinte?: 'gel' | 'alerte'
}

/** Une ligne de fiche : un intitulé, une valeur, parfois une jauge. */
export interface LigneFiche {
  k: string
  v: string
  /** Une valeur SECONDAIRE, en plus petit (un chiffre technique, une recette). */
  petit?: boolean
  jauge?: Jauge
}

/** UNE FICHE au survol. Elle n'existe QUE pour une entrée déjà rencontrée. */
export interface FicheEncyclo {
  nom: string
  /** Le mot du coin droit : la classe, le palier, la famille. */
  kicker: string
  /** Le grand chiffre de gauche (celui du joueur) : intitulé, valeur. */
  gauche: readonly [string, string]
  /** Le chiffre de droite (celui de la table) : intitulé, valeur. */
  droite: readonly [string, string]
  /** Les blocs de lignes, séparés par un filet. */
  blocs: readonly (readonly LigneFiche[])[]
  /** Les puces du pied — le CONDITIONNEL (gel) ou le CHAUD (braise). */
  puces: readonly { texte: string; chaud?: boolean }[]
}

/** L'effigie d'une case : un objet du sac, ou le vrai sprite d'une bête. */
export type Effigie = { kind: 'item'; item: ItemId } | { kind: 'sprite'; key: string }

/** UNE CASE de la grille. `fiche === null` veut dire MUETTE : le rendu ne pose rien dessus. */
export interface CaseEncyclo {
  /** L'id de l'entrée — `null` sur une case muette. Le rendu ne s'en sert pas : le laisser
   *  là aurait posé le mot « sandre » dans l'objet d'une case censée n'en rien dire. */
  id: string | null
  /** Le nom AFFICHÉ — `NOM_INCONNU` tant que l'entrée n'a pas été rencontrée. */
  nom: string
  /** Le chiffre du joueur (record, compte), ou `VALEUR_VIDE`. */
  valeur: string
  /** La seconde ligne, plus discrète — ou la chaîne vide. */
  sous: string
  /** L'effigie à peindre, ou `null` — une case muette n'en a pas, pas même une silhouette. */
  effigie: Effigie | null
  /** Le ⚑ du coin : une condition qui change tout (un coin exclusif, une bête de meute). */
  drapeau: boolean
  fiche: FicheEncyclo | null
}

/** Une rangée d'une section : son intitulé, son compte, et ses cases. */
export interface RangeeEncyclo {
  titre: string
  /** `3 / 5` — combien de cases parlent sur combien. */
  note: string
  cols: number
  cases: readonly CaseEncyclo[]
}

/** L'id d'une section. C'est aussi l'ordre du rail. */
export type SectionId =
  | 'ressources'
  | 'nourriture'
  | 'outils'
  | 'armes'
  | 'poissons'
  | 'animaux'
  | 'monstres'
  | 'saisons'

/** Une entrée du rail : son nom, son compte, et le filet qui la sépare du groupe suivant. */
export interface EntreeDeRail {
  id: SectionId
  nom: string
  su: number
  tot: number
  /** Un filet APRÈS cette entrée — les groupes du rail (ramassé / fait / vivant / monde). */
  filet: boolean
}

/** Une carte de saison : la section SAISONS n'est pas une grille d'icônes. */
export interface CarteSaison {
  /** 1..4 — `null` si la saison n'a jamais été traversée (muette). */
  phase: number | null
  rang: string
  nom: string
  jour: string
  nuit: string
  /** La part du cycle qui est du JOUR, en pourcent (la barre jour/nuit). */
  partJour: number
  vecue: string
  fiche: FicheEncyclo | null
}

/* ═══ LES MOTS FIXES ════════════════════════════════════════════════════════ */

/** Ce que le rendu écrit dans une case muette, à la place du nom. */
export const NOM_INCONNU = '???'
/** Ce que le rendu écrit dans une case muette, à la place du chiffre. */
export const VALEUR_VIDE = '—'

/** Les quatre saisons (spec `saisons.md` S3) — l'ordre EST la phase. */
export const NOMS_DE_SAISON = ['L’ÉCLOSION', 'L’ARDEUR', 'LES PLUIES', 'LE GRAND FROID'] as const
/** Les mêmes, en court : la fiche d'un poisson porte déjà l'eau, l'heure et le pays. */
const SAISON_COURTE = ['éclosion', 'ardeur', 'pluies', 'grand froid'] as const

/** LES TROIS RANGÉES DE PRISES. La classe décide des portions, du cuit et du séché (D12). */
export const CLASSES_DE_PRISE: readonly { classe: ClasseDePrise; titre: string; portions: number }[] = [
  { classe: 'petit', titre: 'LES PETITS', portions: 1 },
  { classe: 'moyen', titre: 'LES MOYENS', portions: 2 },
  { classe: 'gros', titre: 'LES GROS', portions: 4 },
]

/* ═══ LES PETITS FORMATS ════════════════════════════════════════════════════ */

/** Les millimètres de la sim en centimètres qu'on lit, virgule française. */
const enCm = (mm: number): string => `${(mm / 10).toFixed(1).replace('.', ',')} cm`
/** Des ticks en secondes, virgule française. */
const enSec = (ticks: number, dec = 2): string =>
  `${(ticks / BALANCE.TICK_RATE_HZ).toFixed(dec).replace('.', ',')} s`
/** Un nombre décimal à la française. */
const fr = (n: number, dec = 1): string => n.toFixed(dec).replace('.', ',')
/** Les milliers séparés par une espace fine — `1 240` se lit, `1240` se compte. */
const groupe = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
/** `×7`, ou la chaîne vide : une case muette ne compte rien. */
const fois = (n: number): string => (n > 0 ? `×${groupe(n)}` : '')
/** Le libellé d'un objet — la table du sac, jamais un mot recopié. */
const nomDItem = (item: ItemId): string => ITEM_LABELS[item] ?? item
/** Le nom d'un pays, DÉRIVÉ du graphe de zones : une zone renommée se renomme ici toute seule. */
const nomDeZone = (slug: string): string => ZONES.find((z) => z.slug === slug)?.nom ?? slug
/** Le nom d'un terrain d'habitat, en français. */
const nomDHabitat = (t: number): string => nomDeTerrain(TERRAINS[t]?.name ?? String(t))
/** Un coût de recette, en clair : `5 bois · 3 pierres · 2 fibres`. */
const coutEnClair = (id: RecipeId): string =>
  Object.entries(RECIPES[id].inputs)
    .map(([item, n]) => `${n} ${nomDItem(item as ItemId).toLowerCase()}`)
    .join(' · ')
/** La station d'une recette, en clair. `requiert` est une exigence de fonction, ou rien. */
const stationEnClair = (id: RecipeId): string => {
  const req = RECIPES[id].requiert
  if (req === null || req === undefined) return 'à la main'
  return typeof req === 'string' ? req : `${req.fonction} N${req.niveau}`
}
/** La recette qui SORT cet objet, s'il y en a une. */
const recetteDe = (item: ItemId): RecipeId | undefined =>
  (Object.keys(RECIPES) as RecipeId[]).find((id) => RECIPES[id].output === item)
/** Une jauge bornée : `n` sur `total`, au moins un cran allumé si `n` compte. */
const jauge = (n: number, total: number, teinte?: Jauge['teinte']): Jauge => {
  const crans = Math.max(0, Math.min(total, Math.round(n)))
  return teinte === undefined ? { crans, total } : { crans, total, teinte }
}

/* ═══ LE CARNET, VU DE L'ÉCRAN ══════════════════════════════════════════════ */

/** Ce que l'écran reçoit du snapshot : le carnet général, et celui des prises. */
export interface CarnetsDuJoueur {
  encyclo: readonly LigneEncyclo[]
  peche: readonly { sp: string; mm: number; prises: number }[]
}

/** Une entrée est-elle RENCONTRÉE ? La seule question qui décide du muet. */
const connu = (c: CarnetsDuJoueur, id: string): boolean => connuEncyclo(c.encyclo, id)
/** Le compte d'un verbe sur une entrée. */
const compte = (c: CarnetsDuJoueur, verbe: VerbeCarnet, id: string): number =>
  compteEncyclo(c.encyclo, verbe, id)

/** LA CASE MUETTE — une seule fabrique, pour qu'aucune section n'invente sa façon de se taire. */
function caseMuette(): CaseEncyclo {
  return { id: null, nom: NOM_INCONNU, valeur: VALEUR_VIDE, sous: '', effigie: null, drapeau: false, fiche: null }
}

/* ═══ RESSOURCES ════════════════════════════════════════════════════════════ */

/** Les métiers qui font une rangée de RESSOURCES, dans l'ordre où on les rencontre. */
const METIERS_DE_RECOLTE: readonly SkillId[] = ['woodcutting', 'mining', 'foraging']

/** Le nœud d'où sort cet item — le premier de la table, qui porte ses conditions. */
const noeudDe = (item: ItemId): NodeType | undefined =>
  (Object.keys(NODE_DEFS) as NodeType[]).find((t) => NODE_DEFS[t].item === item)

/** Les ressources d'un métier, dans l'ordre de `NODE_DEFS`, sans doublon. */
function ressourcesDe(skill: SkillId): ItemId[] {
  const out: ItemId[] = []
  for (const t of Object.keys(NODE_DEFS) as NodeType[]) {
    const def = NODE_DEFS[t]
    // La PÊCHE n'est pas une ressource : les coins de pêche rendent des poissons, qui ont
    // leur propre section (et leur propre carnet, avec le record).
    if (def.skill !== skill || def.skill === 'hunting') continue
    if (!out.includes(def.item)) out.push(def.item)
  }
  return out
}

function ficheRessource(item: ItemId, c: CarnetsDuJoueur): FicheEncyclo {
  const t = noeudDe(item)
  const def = t === undefined ? undefined : NODE_DEFS[t]
  const rendement = def?.minTool === 'basic' ? TOOL_YIELD.basic : TOOL_YIELD.none
  return {
    nom: nomDItem(item).toUpperCase(),
    kicker: 'RESSOURCE',
    gauche: ['récolté', groupe(compte(c, 'recolte', item))],
    droite: ['poids', fr(ITEM_WEIGHT[item] ?? 0)],
    blocs: [
      [
        { k: 'source', v: t === undefined ? '—' : nomDeNoeud(t) },
        { k: 'outil', v: def?.tool === null || def?.tool === undefined ? 'mains nues' : nomDeFamille(def.tool) },
        { k: 'palier', v: def?.minTool === 'basic' ? 'outil d’atelier' : def?.minTool === 'crude' ? 'de fortune' : 'aucun' },
        { k: 'métier', v: def === undefined ? '—' : SKILL_LABELS[def.skill] },
      ],
      [
        { k: 'stock', v: `${def?.stock ?? 0} / nœud`, petit: true },
        { k: 'rendement', v: `×${rendement}`, petit: true, jauge: jauge(rendement, TOOL_YIELD.steel) },
        { k: 'repousse', v: def?.renewable === true ? 'oui' : 'non', petit: true },
        { k: 'pile', v: String(STACK_SIZES[item] ?? STACK_DEFAULT), petit: true },
      ],
    ],
    puces: def?.gelif === true ? [{ texte: '⚑ le gel la prend' }] : [],
  }
}

/** Le nom d'un type de nœud, en clair. Un mot de jeu par type, faute de table en /sim. */
const NOMS_DE_NOEUD: Record<string, string> = {
  tree: 'arbre',
  old_tree: 'géant de la sylve',
  rock: 'caillasse',
  bloc: 'bloc de pierre',
  fiber_plant: 'touffe de fibre',
  berry_bush: 'buisson',
  champignon: 'coin à champignons',
  leaf_pile: 'tas de feuilles',
  fumerolle: 'fumerolle',
  iron_vein: 'filon de fer',
  coal_seam: 'veine de charbon',
  peat_cut: 'coupe de tourbe',
  quarry: 'carrière',
  ash_heap: 'tas de cendre',
  rubble: 'décombres',
  fishing_spot_river: 'coin de rivière',
  fishing_spot_lake: 'coin de lac',
}
const nomDeNoeud = (t: NodeType): string => NOMS_DE_NOEUD[t] ?? t

/** Le nom d'une famille d'outil, en clair. */
const NOMS_DE_FAMILLE: Record<ToolFamily, string> = {
  axe: 'hache',
  pickaxe: 'pioche',
  rod: 'canne',
  knife: 'couteau',
}
const nomDeFamille = (f: ToolFamily): string => NOMS_DE_FAMILLE[f] ?? f

/* ═══ NOURRITURE ════════════════════════════════════════════════════════════ */

/** Tout ce qui SORT d'un poste de cuisson ou du séchoir, par poste. */
function sortiesDe(structure: 'fire' | 'furnace' | 'sechoir'): ItemId[] {
  // Deux tables, deux postes : le FEU et le FOUR cuisent (`COOK_SLOT`), le SÉCHOIR sèche
  // (`DRY_SLOT`) — et c'est un autre ORDRE de durée (des minutes, pas des secondes).
  const table = structure === 'sechoir' ? DRY_SLOT.sechoir : COOK_SLOT[structure]
  const out: ItemId[] = []
  for (const item of Object.keys(table ?? {}) as ItemId[]) {
    const entree = table?.[item]
    if (entree !== undefined && !out.includes(entree.output)) out.push(entree.output)
  }
  return out
}

/** Les nourritures, par rangée : ce qui se mange BRUT, ce qui passe au feu, ce qui sèche. */
function rangeesNourriture(): { titre: string; items: ItemId[] }[] {
  // ⚠ LE POISSON CRU EST UNE PRISE, PAS UN PLAT. `FOOD_VALUES` porte les dix-huit espèces
  // (on peut les manger crues) : les laisser ici doublerait toute la section POISSONS dans
  // NOURRITURE — 39 entrées au lieu de 21, et deux cases pour le même sandre. Le CUIT et le
  // SÉCHÉ, eux, sont par CLASSE (D12) : ce sont bien des plats, et ils restent.
  const prises = new Set<string>(FISH_SPECIES.map((sp) => sp.id))
  const mangeables = (Object.keys(FOOD_VALUES) as ItemId[]).filter(
    (i) => (FOOD_VALUES[i] ?? 0) > 0 && !prises.has(i),
  )
  const auFeu = [...sortiesDe('fire'), ...sortiesDe('furnace')]
  const auSechoir = sortiesDe('sechoir')
  // Le ragoût sort d'une RECETTE au Feu, pas d'un poste de cuisson : il rejoint le feu.
  const parRecetteAuFeu = mangeables.filter(
    (i) => !auFeu.includes(i) && !auSechoir.includes(i) && recetteDe(i) !== undefined,
  )
  const brut = mangeables.filter(
    (i) => !auFeu.includes(i) && !auSechoir.includes(i) && !parRecetteAuFeu.includes(i),
  )
  return [
    { titre: 'CRU', items: brut },
    { titre: 'AU FEU', items: [...auFeu.filter((i) => mangeables.includes(i)), ...parRecetteAuFeu] },
    { titre: 'AU SÉCHOIR', items: auSechoir.filter((i) => mangeables.includes(i)) },
  ]
}

function ficheNourriture(item: ItemId, c: CarnetsDuJoueur): FicheEncyclo {
  const faim = FOOD_VALUES[item] ?? 0
  const rec = recetteDe(item)
  const secheDepuis = (Object.entries(DRY_SLOT.sechoir ?? {}) as [string, { output: ItemId; ticks: number }][]).find(
    ([, e]) => e.output === item,
  )
  const cuitDepuis = (Object.entries(COOK_SLOT.fire ?? {}) as [string, { output: ItemId; ticks: number }][]).find(
    ([, e]) => e.output === item,
  )
  const source = secheDepuis ?? cuitDepuis
  const bloc2: LigneFiche[] = source
    ? [
        { k: 'depuis', v: nomDItem(source[0] as ItemId).toLowerCase(), petit: true },
        { k: 'poste', v: secheDepuis ? 'séchoir' : 'feu · four', petit: true },
        { k: 'temps', v: enSec(source[1].ticks, 0), petit: true },
      ]
    : rec !== undefined
      ? [
          { k: 'recette', v: coutEnClair(rec), petit: true },
          { k: 'station', v: stationEnClair(rec), petit: true },
          { k: 'temps', v: `${RECIPES[rec].seconds} s`, petit: true },
        ]
      : [{ k: 'source', v: 'du monde', petit: true }]
  return {
    nom: nomDItem(item).toUpperCase(),
    kicker: 'NOURRITURE',
    gauche: ['mangées', fois(compte(c, 'mange', item)) || VALEUR_VIDE],
    droite: ['poids', fr(ITEM_WEIGHT[item] ?? 0)],
    blocs: [
      [
        { k: 'faim', v: String(faim), petit: true, jauge: jauge(faim / 12, 5) },
        {
          k: 'péremption',
          v: SPOIL_CYCLES[item] === undefined ? 'aucune' : `${SPOIL_CYCLES[item]} cycles`,
          petit: true,
        },
        { k: 'pile', v: String(STACK_SIZES[item] ?? STACK_DEFAULT), petit: true },
      ],
      bloc2,
    ],
    puces: [],
  }
}

/* ═══ OUTILS ════════════════════════════════════════════════════════════════ */

/**
 * LES OUTILS, PAR PALIER — les rangées SONT les marches de `TOOL_TIERS`, et une famille qui
 * n'a qu'une marche (la canne, le couteau : `peche.md` G7, `depecage.md` G5) n'apparaît donc
 * qu'à la première. Aucun trou à dessiner : la table dit tout.
 */
const PALIERS: readonly { cle: 'crude' | 'basic' | 'iron' | 'steel'; titre: string }[] = [
  { cle: 'crude', titre: 'FORTUNE' },
  { cle: 'basic', titre: 'ATELIER' },
  { cle: 'iron', titre: 'FER' },
  { cle: 'steel', titre: 'ACIER' },
]

/** LE MARTEAU n'est d'aucune famille outillée (il ne récolte rien : il bâtit). Il rejoint le
 *  palier de sa RECETTE — elle exige le Feu, donc l'atelier. Dérivé, pas posé. */
const HORS_FAMILLE: readonly ItemId[] = ['hammer']

function outilsDuPalier(cle: 'crude' | 'basic' | 'iron' | 'steel'): ItemId[] {
  const out: ItemId[] = []
  for (const famille of Object.keys(TOOL_TIERS) as ToolFamily[]) {
    const item = TOOL_TIERS[famille][cle]
    // Une marche qui répète la précédente n'existe pas : on ne la dessine pas deux fois.
    const dejaPlusBas = PALIERS.slice(0, PALIERS.findIndex((p) => p.cle === cle)).some(
      (p) => TOOL_TIERS[famille][p.cle] === item,
    )
    if (!dejaPlusBas && !out.includes(item)) out.push(item)
  }
  for (const item of HORS_FAMILLE) {
    const rec = recetteDe(item)
    const palier = rec !== undefined && RECIPES[rec].requiert !== null ? 'basic' : 'crude'
    if (palier === cle && !out.includes(item)) out.push(item)
  }
  return out
}

/** La famille d'un outil, retrouvée dans la table (le marteau n'en a pas). */
const familleDe = (item: ItemId): ToolFamily | undefined =>
  (Object.keys(TOOL_TIERS) as ToolFamily[]).find((f) =>
    (Object.keys(TOOL_TIERS[f]) as ('crude' | 'basic' | 'iron' | 'steel')[]).some((k) => TOOL_TIERS[f][k] === item),
  )

/** Le palier EFFECTIF d'un outil — la marche la plus BASSE où il apparaît. */
function palierDe(item: ItemId): 'crude' | 'basic' | 'iron' | 'steel' {
  const f = familleDe(item)
  if (f === undefined) return recetteDe(item) !== undefined && RECIPES[recetteDe(item)!].requiert !== null ? 'basic' : 'crude'
  return PALIERS.find((p) => TOOL_TIERS[f][p.cle] === item)?.cle ?? 'crude'
}

/** Ce qu'un outil OUVRE : les nœuds que sa famille récolte. */
function ouvreDe(f: ToolFamily | undefined): string {
  if (f === undefined) return 'le bâti'
  const noeuds = (Object.keys(NODE_DEFS) as NodeType[]).filter((t) => NODE_DEFS[t].tool === f)
  return noeuds.map(nomDeNoeud).join(' · ') || '—'
}

function ficheOutil(item: ItemId, c: CarnetsDuJoueur): FicheEncyclo {
  const f = familleDe(item)
  const palier = palierDe(item)
  const rendement = TOOL_YIELD[palier]
  const usure = TOOL_DURABILITIES[item] ?? BALANCE.TOOL_DURABILITY
  const rec = recetteDe(item)
  const metier: SkillId = f === 'axe' ? 'woodcutting' : f === 'pickaxe' ? 'mining' : f === 'rod' || f === 'knife' ? 'hunting' : 'crafting'
  return {
    nom: nomDItem(item).toUpperCase(),
    kicker: PALIERS.find((p) => p.cle === palier)!.titre,
    gauche: ['fabriqués', fois(compte(c, 'fabrique', item)) || VALEUR_VIDE],
    droite: ['durabilité', String(usure)],
    blocs: [
      [
        { k: 'famille', v: f === undefined ? 'bâti' : nomDeFamille(f) },
        { k: 'ouvre', v: ouvreDe(f), petit: true },
        { k: 'métier', v: SKILL_LABELS[metier] },
      ],
      [
        { k: 'rendement', v: `×${rendement}`, petit: true, jauge: jauge(rendement, TOOL_YIELD.steel) },
        { k: 'usure', v: `${usure} coups`, petit: true, jauge: jauge((usure / 180) * 5, 5) },
      ],
      rec === undefined
        ? [{ k: 'recette', v: '—', petit: true }]
        : [
            { k: 'recette', v: coutEnClair(rec), petit: true },
            { k: 'station', v: stationEnClair(rec), petit: true },
            { k: 'temps', v: `${RECIPES[rec].seconds} s`, petit: true },
          ],
    ],
    puces: [],
  }
}

/* ═══ ARMES ═════════════════════════════════════════════════════════════════ */

/** Les armes, DÉRIVÉES du barème de dégâts — plus la munition, qui n'en a pas. */
function rangeesArmes(): { titre: string; items: ItemId[] }[] {
  const armes = (Object.keys(WEAPON_DAMAGE) as ItemId[]).filter((i) => WEAPON_DAMAGE[i] !== undefined)
  return [
    { titre: 'MÊLÉE', items: armes.filter((i) => !isRangedWeapon(i)) },
    { titre: 'TIR', items: armes.filter((i) => isRangedWeapon(i)) },
    { titre: 'MUNITION', items: ['arrow'] },
  ]
}

/** L'angle d'un cône, depuis son cosinus — pour LIRE la portée d'un coup. */
const angleDe = (arcCos: number): string => {
  if (arcCos <= -1) return 'tout autour'
  // acos est interdit en /sim (invariant §2) mais l'écran n'est pas la sim : il peut lire.
  return `cône ${Math.round((Math.acos(arcCos) * 180) / Math.PI)}°`
}

function ficheArme(item: ItemId, c: CarnetsDuJoueur): FicheEncyclo {
  const p = WEAPON_PROFILES[item as keyof typeof WEAPON_PROFILES]
  const rec = recetteDe(item)
  const usure = TOOL_DURABILITIES[item] ?? BALANCE.TOOL_DURABILITY
  if (p === undefined) {
    // La MUNITION : pas de profil, elle se compte et se tire.
    return {
      nom: nomDItem(item).toUpperCase(),
      kicker: 'MUNITION',
      gauche: ['fabriquées', fois(compte(c, 'fabrique', item)) || VALEUR_VIDE],
      droite: ['poids', fr(ITEM_WEIGHT[item] ?? 0, 2)],
      blocs: [
        [
          { k: 'pile', v: String(STACK_SIZES[item] ?? STACK_DEFAULT), petit: true },
          { k: 'pour', v: 'les arcs', petit: true },
        ],
        rec === undefined
          ? [{ k: 'recette', v: '—', petit: true }]
          : [
              { k: 'recette', v: `${coutEnClair(rec)} → ×${RECIPES[rec].count ?? 1}`, petit: true },
              { k: 'station', v: stationEnClair(rec), petit: true },
              { k: 'temps', v: `${RECIPES[rec].seconds} s`, petit: true },
            ],
      ],
      puces: [],
    }
  }
  const tir = isRangedWeapon(item)
  return {
    nom: nomDItem(item).toUpperCase(),
    kicker: tir ? 'TIR' : 'MÊLÉE',
    gauche: ['dégâts', String(p.light.damage)],
    droite: ['portée', fr(p.light.range)],
    blocs: [
      [
        {
          k: 'léger',
          v: `${p.light.damage} · ${fr(p.light.range)} · ${angleDe(p.light.arcCos)}`,
          petit: true,
          jauge: jauge((p.light.damage / 34) * 5, 5),
        },
        {
          k: 'chargé',
          v: `${p.charged.damage} · ${fr(p.charged.range)} · ${angleDe(p.charged.arcCos)}`,
          petit: true,
          jauge: jauge((p.charged.damage / 34) * 5, 5),
        },
        { k: 'charge', v: enSec(p.chargeTicks), petit: true },
      ],
      [
        { k: 'wind-up', v: enSec(p.light.windupTicks), petit: true, jauge: jauge((p.light.windupTicks / 14) * 5, 5) },
        {
          k: 'repos',
          v: `${enSec(p.light.recoveryHit)} touché · ${enSec(p.light.recoveryWhiff)} à vide`,
          petit: true,
        },
        { k: 'endurance', v: `${p.light.stamina} · ${p.charged.stamina}`, petit: true },
      ],
      rec === undefined
        ? [{ k: 'durabilité', v: String(usure), petit: true }]
        : [
            { k: 'durabilité', v: String(usure), petit: true },
            { k: 'recette', v: coutEnClair(rec), petit: true },
            { k: 'station', v: stationEnClair(rec), petit: true },
          ],
    ],
    puces: tir ? [{ texte: '⚑ elle ne frappe pas au corps à corps' }] : [],
  }
}

/* ═══ POISSONS ══════════════════════════════════════════════════════════════ */

/** LA FENÊTRE DE FERRAGE et la RARETÉ, en jauges : les deux nombres bruts ne veulent rien
 *  dire au joueur (un compte de ticks, un poids de tirage). */
const cransFerrage = (ticks: number): number => Math.max(1, Math.min(6, Math.round((ticks - 4) / 2)))
const motFerrage = (ticks: number): string =>
  ticks <= 6 ? 'éclair' : ticks <= 9 ? 'court' : ticks <= 13 ? 'large' : 'très large'
const cransRarete = (poids: number): number => (poids >= 6 ? 1 : poids >= 4 ? 2 : poids >= 2 ? 3 : 4)
const motRarete = (poids: number): string =>
  poids >= 6 ? 'commune' : poids >= 4 ? 'assez commune' : poids >= 2 ? 'rare' : 'très rare'

function fichePoisson(sp: FishSpecies, l: { mm: number; prises: number }): FicheEncyclo {
  const portions = CLASSES_DE_PRISE.find((k) => k.classe === sp.classe)!.portions
  return {
    nom: sp.label.toUpperCase(),
    kicker: sp.classe.toUpperCase(),
    gauche: ['record', enCm(l.mm)],
    droite: ['prises', `×${l.prises}`],
    blocs: [
      [
        { k: 'eau', v: sp.eaux.map((e) => (e === 'riviere' ? 'rivière' : e)).join(' · ') },
        {
          k: 'saison',
          v: sp.saisons ? sp.saisons.map((n) => SAISON_COURTE[n - 1] ?? '').join(' · ') : 'toute l’année',
        },
        {
          k: 'heure',
          v: sp.creneaux ? sp.creneaux.map((cr) => (cr === 'crepuscule' ? 'crépuscule' : cr)).join(' · ') : 'à toute heure',
        },
        { k: 'pays', v: sp.zones ? sp.zones.map(nomDeZone).join(' · ') : 'partout' },
      ],
      [
        {
          k: 'ferrage',
          v: `${motFerrage(sp.windowTicks)} · ${enSec(sp.windowTicks)}`,
          petit: true,
          jauge: jauge(cransFerrage(sp.windowTicks), 6),
        },
        { k: 'rareté', v: motRarete(sp.weight), petit: true, jauge: jauge(cransRarete(sp.weight), 4) },
        { k: 'taille', v: `${Math.round(sp.tailleMinMm / 10)} – ${Math.round(sp.tailleMaxMm / 10)} cm`, petit: true },
        { k: 'portions', v: String(portions), petit: true },
      ],
    ],
    // ⚑ E3 : sans cette puce, la fiche laisse croire que le sandre mord sur n'importe quel lac.
    puces: sp.coinSeul === true ? [{ texte: '⚑ coin exclusif' }] : [],
  }
}

/* ═══ BÊTES ET MONSTRES ═════════════════════════════════════════════════════ */

/** Le rythme d'une bête, en clair. */
const NOMS_D_ACTIVITE: Record<string, string> = {
  diurnal: 'plein jour',
  nocturnal: 'la nuit',
  crepuscular: 'aube · crépuscule',
}

/** Le butin d'une bête, en clair : `2 quartiers · 2 os`. */
const butinEnClair = (t: MonsterType): string => {
  const loot = MONSTER_DEFS[t].loot
  const lignes = Object.entries(loot).map(([item, n]) => `${n} ${nomDItem(item as ItemId).toLowerCase()}`)
  return lignes.join(' · ') || 'ce qu’il portait'
}

/** Le nom français d'une bête. */
const NOMS_DE_BETE: Record<MonsterType, string> = {
  rabbit: 'Lapin',
  deer: 'Cerf',
  boar: 'Sanglier',
  wolf: 'Loup',
  cendreux: 'Cendreux',
}
/** Le sprite du monde — la MÊME effigie qu'en jeu, pour qu'une bête se reconnaisse. */
const SPRITES_DE_BETE: Record<MonsterType, string> = {
  rabbit: 'spr-rabbit',
  deer: 'spr-deer',
  boar: 'spr-boar',
  wolf: 'spr-wolf',
  cendreux: 'spr-cendreux',
}

function ficheBete(t: MonsterType, c: CarnetsDuJoueur): FicheEncyclo {
  const d = MONSTER_DEFS[t]
  const gibier = d.damage === 0
  const bloc1: LigneFiche[] = gibier
    ? [
        { k: 'vitesse', v: fr(d.speed), petit: true, jauge: jauge((d.speed / 6) * 5, 5) },
        { k: 'alerte', v: `${d.alertRange ?? 0} tuiles`, petit: true, jauge: jauge(((d.alertRange ?? 0) / 14) * 5, 5) },
        { k: 'fuite', v: `${d.flightRange ?? 0} tuiles`, petit: true, jauge: jauge(((d.flightRange ?? 0) / 14) * 5, 5) },
      ]
    : [
        { k: 'dégâts', v: String(d.damage), petit: true, jauge: jauge((d.damage / 34) * 5, 5, 'alerte') },
        { k: 'wind-up', v: enSec(d.windupTicks), petit: true, jauge: jauge((d.windupTicks / 14) * 5, 5) },
        { k: 'repos', v: enSec(d.attackCooldownTicks), petit: true, jauge: jauge((d.attackCooldownTicks / 50) * 5, 5) },
        { k: 'vitesse', v: fr(d.speed), petit: true, jauge: jauge((d.speed / 6) * 5, 5) },
      ]
  const bloc2: LigneFiche[] = [
    { k: 'heures', v: d.activity === undefined ? 'à toute heure' : (NOMS_D_ACTIVITE[d.activity] ?? d.activity) },
    ...(d.herdSize ? [{ k: gibier ? 'harde' : 'meute', v: `${d.herdSize[0]} – ${d.herdSize[1]}` }] : []),
    ...(d.aggroRange > 0 ? [{ k: 'vue', v: `${d.aggroRange} tuiles`, petit: true, jauge: jauge((d.aggroRange / 14) * 5, 5) }] : []),
    ...(d.habitat
      ? [{ k: 'habitat', v: d.habitat.map(nomDHabitat).join(' · '), petit: true }]
      : [{ k: 'habitat', v: 'partout où le froid l’éveille', petit: true }]),
  ]
  const puces: { texte: string; chaud?: boolean }[] = []
  if (d.predator === true) puces.push({ texte: '⚑ il chasse en meute' })
  if (d.chargeChance > 0) puces.push({ texte: '⚑ blessé, il charge' })
  if (t === 'cendreux') puces.push({ texte: '⚑ il boit le feu', chaud: true }, { texte: '⚑ il vient en horde', chaud: true })
  return {
    nom: NOMS_DE_BETE[t].toUpperCase(),
    kicker: t === 'cendreux' ? 'MORT-VIVANT' : gibier ? 'GIBIER' : 'DANGEREUSE',
    gauche: ['abattus', fois(compte(c, 'abat', t)) || VALEUR_VIDE],
    droite: ['points de vie', String(d.hp)],
    blocs: [bloc1, bloc2, [{ k: 'dépouille', v: butinEnClair(t), petit: true }]],
    puces,
  }
}

/* ═══ SAISONS ═══════════════════════════════════════════════════════════════ */

/**
 * LES CARDINAUX DE SAISON (spec `saisons.md` S4/S6) — la température au CŒUR de chaque
 * saison, et la part de jour de son cycle. Recopiés de la spec plutôt que recalculés : la
 * courbe de `/sim` interpole entre ces cardinaux, et c'est le cardinal qui NOMME la saison.
 */
const CARDINAUX: readonly { jour: number; nuit: number; partJour: number; ciel: string; fronts: string }[] = [
  { jour: 8, nuit: -2, partJour: 62, ciel: 'pluie · brouillard du matin', fronts: '1 cycle sur 2' },
  { jour: 26, nuit: 20, partJour: 72, ciel: 'orage sec · pluie rare', fronts: '1 cycle sur 3' },
  { jour: 8, nuit: -2, partJour: 62, ciel: 'pluie · brouillard épais', fronts: '2 cycles sur 3' },
  { jour: -2, nuit: -16, partJour: 48, ciel: 'neige · blizzard', fronts: '3 cycles sur 4' },
]

/** La culture de chaque saison — DÉRIVÉE de la table du potager (S16). */
function cultureDe(phase: number): string {
  const entree = Object.values(AGRICULTURE.CULTURES).find((cu) => cu.phase === phase)
  return entree === undefined ? '—' : nomDItem(entree.recolte as ItemId).toLowerCase()
}

const signe = (n: number): string => (n > 0 ? `+${n}` : String(n))

function ficheSaison(phase: number, c: CarnetsDuJoueur): FicheEncyclo {
  const k = CARDINAUX[phase - 1]!
  return {
    nom: NOMS_DE_SAISON[phase - 1]!,
    kicker: `SAISON ${phase}`,
    gauche: ['vécue', fois(compte(c, 'vecu', String(phase))) || VALEUR_VIDE],
    droite: ['jours', String(BALANCE.ACT_DAYS)],
    blocs: [
      [
        { k: 'temp. jour', v: `${signe(k.jour)} °C`, petit: true, jauge: jauge(((k.jour + 16) / 42) * 5, 5, 'gel') },
        { k: 'temp. nuit', v: `${signe(k.nuit)} °C`, petit: true, jauge: jauge(((k.nuit + 16) / 42) * 5, 5, 'gel') },
        { k: 'clarté', v: `${fr(k.partJour / 100, 2)} du cycle`, petit: true, jauge: jauge((k.partJour / 100) * 5, 5) },
      ],
      [
        { k: 'fronts', v: k.fronts, petit: true },
        { k: 'ciel', v: k.ciel },
      ],
      [{ k: 'semis', v: cultureDe(phase), petit: true }],
    ],
    puces: [],
  }
}

/** Les quatre cartes de la section SAISONS — muettes tant qu'on ne les a pas traversées. */
export function cartesDesSaisons(c: CarnetsDuJoueur): CarteSaison[] {
  return [1, 2, 3, 4].map((phase): CarteSaison => {
    const n = compte(c, 'vecu', String(phase))
    if (n === 0) {
      return {
        phase: null,
        rang: `SAISON ${phase}`,
        nom: NOM_INCONNU,
        jour: '',
        nuit: '',
        partJour: 0,
        vecue: '',
        fiche: null,
      }
    }
    const k = CARDINAUX[phase - 1]!
    return {
      phase,
      rang: `SAISON ${phase} · ${BALANCE.ACT_DAYS} JOURS`,
      nom: NOMS_DE_SAISON[phase - 1]!,
      jour: `${signe(k.jour)} °C`,
      nuit: `${signe(k.nuit)} °C`,
      partJour: k.partJour,
      vecue: `vécue ×${n}`,
      fiche: ficheSaison(phase, c),
    }
  })
}

/* ═══ LA FABRIQUE D'UNE CASE ════════════════════════════════════════════════ */

/** Une case d'ITEM : muette tant que le carnet ne connaît pas l'objet. */
function caseItem(
  item: ItemId,
  c: CarnetsDuJoueur,
  verbe: VerbeCarnet,
  fiche: (i: ItemId, c: CarnetsDuJoueur) => FicheEncyclo,
): CaseEncyclo {
  if (!connu(c, item)) return caseMuette()
  const n = compte(c, verbe, item)
  return {
    id: item,
    nom: nomDItem(item),
    valeur: verbe === 'recolte' ? groupe(n) : fois(n) || VALEUR_VIDE,
    sous: '',
    effigie: { kind: 'item', item },
    drapeau: false,
    fiche: fiche(item, c),
  }
}

/** Une case de BÊTE : muette tant qu'on n'en a pas abattu une. */
function caseBete(t: MonsterType, c: CarnetsDuJoueur): CaseEncyclo {
  if (!connu(c, t)) return caseMuette()
  const d = MONSTER_DEFS[t]
  return {
    id: t,
    nom: NOMS_DE_BETE[t],
    valeur: fois(compte(c, 'abat', t)) || VALEUR_VIDE,
    sous: `${d.hp} PV`,
    effigie: { kind: 'sprite', key: SPRITES_DE_BETE[t] },
    drapeau: d.predator === true || d.chargeChance > 0,
    fiche: ficheBete(t, c),
  }
}

/** Une case de PRISE : muette tant que l'espèce n'a pas été sortie de l'eau. */
function casePoisson(sp: FishSpecies, c: CarnetsDuJoueur): CaseEncyclo {
  const l = c.peche.find((x) => x.sp === sp.id)
  if (l === undefined) return caseMuette()
  return {
    id: sp.id,
    nom: sp.label.charAt(0).toUpperCase() + sp.label.slice(1),
    valeur: enCm(l.mm),
    sous: `×${l.prises}`,
    effigie: { kind: 'item', item: sp.id as ItemId },
    drapeau: sp.coinSeul === true,
    fiche: fichePoisson(sp, l),
  }
}

/** `3 / 5` — combien de cases parlent, sur combien. */
const note = (cases: readonly CaseEncyclo[]): string =>
  `${cases.filter((x) => x.fiche !== null).length} / ${cases.length}`

/** Une rangée bâtie : le nombre de colonnes est celui de la rangée LA PLUS PEUPLÉE. */
function rangee(titre: string, cases: CaseEncyclo[], cols: number): RangeeEncyclo {
  return { titre, note: note(cases), cols, cases }
}

/* ═══ LES SECTIONS ══════════════════════════════════════════════════════════ */

/** Le contenu brut d'une section : ses rangées, avant tout habillage. */
function contenuDe(id: SectionId, c: CarnetsDuJoueur): { titre: string; cases: CaseEncyclo[] }[] {
  switch (id) {
    case 'ressources':
      return METIERS_DE_RECOLTE.map((skill) => ({
        titre: SKILL_LABELS[skill].toUpperCase(),
        cases: ressourcesDe(skill).map((i) => caseItem(i, c, 'recolte', ficheRessource)),
      }))
    case 'nourriture':
      return rangeesNourriture().map((r) => ({
        titre: r.titre,
        cases: r.items.map((i) => caseItem(i, c, 'mange', ficheNourriture)),
      }))
    case 'outils':
      return PALIERS.map((p) => ({
        titre: p.titre,
        cases: outilsDuPalier(p.cle).map((i) => caseItem(i, c, 'fabrique', ficheOutil)),
      })).filter((r) => r.cases.length > 0)
    case 'armes':
      return rangeesArmes().map((r) => ({
        titre: r.titre,
        cases: r.items.map((i) => caseItem(i, c, 'fabrique', ficheArme)),
      }))
    case 'poissons':
      return CLASSES_DE_PRISE.map((k) => ({
        titre: k.titre,
        cases: FISH_SPECIES.filter((sp) => sp.classe === k.classe).map((sp) => casePoisson(sp, c)),
      }))
    case 'animaux': {
      const betes = (Object.keys(MONSTER_DEFS) as MonsterType[]).filter((t) => t !== 'cendreux')
      return [
        { titre: 'LE GIBIER', cases: betes.filter((t) => MONSTER_DEFS[t].damage === 0).map((t) => caseBete(t, c)) },
        {
          titre: 'CE QUI REND LES COUPS',
          cases: betes.filter((t) => MONSTER_DEFS[t].damage > 0).map((t) => caseBete(t, c)),
        },
      ]
    }
    case 'monstres':
      return [{ titre: 'LES MORTS-VIVANTS', cases: [caseBete('cendreux', c)] }]
    case 'saisons':
      // La section SAISONS n'est pas une grille : voir `cartesDesSaisons`.
      return []
  }
}

/**
 * LES RANGÉES D'UNE SECTION, telles qu'elles s'affichent.
 *
 * LE NOMBRE DE COLONNES EST DÉRIVÉ de la rangée la plus peuplée de la section : une entrée
 * ajoutée à `/sim` élargit la grille toute seule, au lieu de déborder d'un nombre écrit ici.
 */
export function rangeesDeSection(id: SectionId, c: CarnetsDuJoueur): RangeeEncyclo[] {
  const brut = contenuDe(id, c)
  const cols = Math.max(1, ...brut.map((r) => r.cases.length))
  return brut.map((r) => rangee(r.titre, r.cases, cols))
}

/** Le rail : une entrée par section, avec son compte — et les filets qui font les groupes. */
export function railDeLEncyclopedie(c: CarnetsDuJoueur): EntreeDeRail[] {
  const def: readonly { id: SectionId; nom: string; filet: boolean }[] = [
    { id: 'ressources', nom: 'RESSOURCES', filet: false },
    { id: 'nourriture', nom: 'NOURRITURE', filet: true },
    { id: 'outils', nom: 'OUTILS', filet: false },
    { id: 'armes', nom: 'ARMES', filet: true },
    { id: 'poissons', nom: 'POISSONS', filet: false },
    { id: 'animaux', nom: 'ANIMAUX SAUVAGES', filet: false },
    { id: 'monstres', nom: 'MONSTRES', filet: true },
    { id: 'saisons', nom: 'SAISONS', filet: false },
  ]
  return def.map(({ id, nom, filet }) => {
    if (id === 'saisons') {
      const cartes = cartesDesSaisons(c)
      return { id, nom, filet, su: cartes.filter((x) => x.fiche !== null).length, tot: cartes.length }
    }
    const cases = contenuDe(id, c).flatMap((r) => r.cases)
    return { id, nom, filet, su: cases.filter((x) => x.fiche !== null).length, tot: cases.length }
  })
}

/** Toutes les sections, pour un balayage exhaustif (tests) — l'ordre du rail. */
export const SECTIONS: readonly SectionId[] = [
  'ressources',
  'nourriture',
  'outils',
  'armes',
  'poissons',
  'animaux',
  'monstres',
  'saisons',
]
