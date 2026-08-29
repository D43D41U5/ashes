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
  TERRAINS,
  TOOL_DURABILITIES,
  TOOL_TIERS,
  TOOL_YIELD,
  TORCHE,
  WEAPON_DAMAGE,
  WEAPON_PROFILES,
  ZONES,
  cleEncyclo,
  compteEncyclo,
  connuEncyclo,
  extremeEncyclo,
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
  type ToolTier,
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
  /** LE PLUS FROID et LE PLUS CHAUD que ce joueur a endurés dans cette saison (décision
   *  d'Alexis, 2026-08-25). Ce ne sont PAS les cardinaux de la table : la carte et sa fiche
   *  disent la même chose, et c'est le relevé du joueur — sinon deux vérités se côtoieraient. */
  froid: string
  chaud: string
  /** LA BARRE JOUR/NUIT, EN POURCENTS DE CYCLE **DEPUIS MINUIT** (décision d'Alexis,
   *  2026-08-27) : deux abscisses, et non une largeur. La barre est une horloge — le jour y
   *  occupe la place qu'il occupe dans la journée, pas un ruban calé à gauche. Le reste est
   *  nuit, des DEUX côtés. */
  lever: number
  coucher: number
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
/** Un nombre décimal à la française. */
const fr = (n: number, dec = 1): string => n.toFixed(dec).replace('.', ',')
/** Les milliers séparés par une espace fine — `1 240` se lit, `1240` se compte. */
const groupe = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
/** Le chiffre que porte une case DÉVERROUILLÉE (`carnetComplet`) : un, jamais zéro — une
 *  case à zéro se tairait, et on ne relirait rien. Il ne prétend pas être un vrai compte. */
export const COMPTE_FEINT = 1
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
/** La recette qui SORT cet objet, s'il y en a une. */
const recetteDe = (item: ItemId): RecipeId | undefined =>
  (Object.keys(RECIPES) as RecipeId[]).find((id) => RECIPES[id].output === item)
/** Une jauge bornée : `n` sur `total`, au moins un cran allumé si `n` compte. */
const jauge = (n: number, total: number, teinte?: Jauge['teinte']): Jauge => {
  const crans = Math.max(0, Math.min(total, Math.round(n)))
  return teinte === undefined ? { crans, total } : { crans, total, teinte }
}

/* ═══ DES MOTS, PLUTÔT QUE DES NOMBRES ═════════════════════════════════════ */

/**
 * UNE FICHE DIT CE QU'ON EN FAIT, JAMAIS COMMENT C'EST CODÉ (décision d'Alexis, 2026-08-25 :
 * « il y a trop d'infos techniques dans les tooltips — réduis la taille ET la nature des
 * infos »). Ont disparu de TOUTES les fiches : les durées en secondes (wind-up, repos, charge,
 * ferrage), les cônes en degrés, l'endurance, la taille de pile, le stock par nœud, la
 * durabilité chiffrée, le poids de tirage, la fourchette de taille, les portions.
 *
 * ⚠ ET LE MOT QUI REMPLACE UN CHIFFRE SE DÉRIVE DE SA TABLE, jamais d'un seuil écrit ici :
 * `motParRang` classe la valeur parmi les valeurs DISTINCTES que la table porte. Une hache
 * d'acier ajoutée demain reclasse les autres toute seule — un seuil en dur, lui, aurait fait
 * mentir la fiche au premier changement d'équilibrage.
 */
function motParRang(v: number, table: readonly number[], mots: readonly string[]): string {
  const vals = [...new Set(table)].sort((a, b) => a - b)
  const i = vals.findIndex((x) => x >= v)
  const rang = i < 0 ? vals.length - 1 : i
  const part = vals.length <= 1 ? 0 : rang / (vals.length - 1)
  return mots[Math.min(mots.length - 1, Math.floor(part * mots.length))]!
}

/** LA TENUE d'un outil ou d'une arme — sa durabilité, en un mot. */
const motDeTenue = (usure: number): string =>
  motParRang(usure, [...Object.values(TOOL_DURABILITIES), BALANCE.TOOL_DURABILITY], [
    'fragile',
    'correcte',
    'solide',
    'robuste',
  ])

/** CE QUE ÇA RASSASIE — la valeur de faim, en un mot. */
const motDeFaim = (faim: number): string =>
  motParRang(faim, Object.values(FOOD_VALUES), ['une bouchée', 'un en-cas', 'un repas', 'un festin'])

/** COMBIEN DE TEMPS ÇA TIENT. Pas de péremption du tout ⇒ rien ne la prend. */
const motDeGarde = (cycles: number | undefined): string =>
  cycles === undefined
    ? 'ne se gâte pas'
    : motParRang(cycles, Object.values(SPOIL_CYCLES), [
        'se gâte vite',
        'quelques cycles',
        'longtemps',
        'très longtemps',
      ])

/** CE QUE LE COUP CHARGÉ AJOUTE — un rapport, pas deux chiffres à soustraire de tête. */
const motDeCharge = (leger: number, charge: number): string => {
  const r = leger <= 0 ? 1 : charge / leger
  return r >= 2.75
    ? 'trois fois plus fort'
    : r >= 2.25
      ? 'deux fois et demie plus fort'
      : r >= 1.75
        ? 'deux fois plus fort'
        : r >= 1.25
          ? 'moitié plus fort'
          : 'à peine plus fort'
}

/** LE RENDEMENT D'UN OUTIL, rapporté aux mains nues — c'est la seule comparaison qui parle. */
const MULTIPLES = [
  '',
  'autant qu’à mains nues',
  'deux fois plus',
  'trois fois plus',
  'quatre fois plus',
  'cinq fois plus',
] as const
const motDeRendement = (rendement: number): string =>
  MULTIPLES[Math.min(MULTIPLES.length - 1, Math.max(1, Math.round(rendement / TOOL_YIELD.none)))]!

/** COMBIEN LE GIBIER EST FAROUCHE — sa distance d'alerte, en un mot. */
const motFarouche = (alerte: number): string =>
  motParRang(
    alerte,
    (Object.keys(MONSTER_DEFS) as MonsterType[]).filter((t) => MONSTER_DEFS[t].damage === 0).map((t) => MONSTER_DEFS[t].alertRange ?? 0),
    ['placide', 'méfiant', 'farouche', 'très farouche'],
  )

/**
 * LE NOM PLURIEL D'UN NŒUD — « les arbres », pas `tree`. Il sert DEUX lignes : d'où sort une
 * ressource, et ce qu'un outil ouvre. Une seule table, pour que les deux disent le même mot.
 */
const NOEUDS_AU_PLURIEL: Record<string, string> = {
  tree: 'les arbres',
  old_tree: 'les géants de la sylve',
  rock: 'la caillasse',
  bloc: 'les blocs de pierre',
  fiber_plant: 'les touffes de fibre',
  berry_bush: 'les buissons',
  champignon: 'les coins à champignons',
  leaf_pile: 'les tas de feuilles',
  fumerolle: 'les fumerolles',
  iron_vein: 'les filons de fer',
  coal_seam: 'les veines de charbon',
  charbonniere: 'les fûts calcinés',
  peat_cut: 'les coupes de tourbe',
  quarry: 'les carrières',
  ash_heap: 'les tas de cendre',
  rubble: 'les décombres',
  fishing_spot_river: 'les coins de rivière',
  fishing_spot_lake: 'les coins de lac',
  // LE GLANAGE (spec `glanage.md`) : on ne les « récolte » pas, on les RAMASSE — le mot doit
  // dire le geste, puisque c'est le seul bois et la seule pierre qui viennent sans outil.
  branche_au_sol: 'le bois mort au sol',
  pierre_au_sol: 'les pierres au sol',
}
const auPluriel = (t: NodeType): string => NOEUDS_AU_PLURIEL[t] ?? nomDeNoeud(t)

/** AVEC QUOI on le prend. */
const AVEC_QUOI: Record<ToolFamily, string> = {
  axe: 'à la hache',
  pickaxe: 'à la pioche',
  rod: 'à la canne',
  knife: 'au couteau',
}

/** CE QU'IL FAUT EN MAIN. Rien du tout quand les mains suffisent : pas de ligne, pas de bruit. */
const EXIGENCE_DE_PALIER: Partial<Record<ToolTier, string>> = {
  crude: 'un outil, même de fortune',
  basic: 'un outil d’atelier',
  iron: 'un outil de fer',
  steel: 'un outil d’acier',
}

/** OÙ ÇA SE FABRIQUE, avec son article — « au feu », « à l’atelier ». */
const AU_POSTE: Record<string, string> = {
  atelier: 'à l’atelier',
  feu: 'au feu',
  forge: 'à la forge',
  grenier: 'au grenier',
  ferme: 'à la ferme',
}

/** OÙ ELLE MORD. */
const EN_EAU: Record<string, string> = { riviere: 'en rivière', mare: 'en mare', lac: 'en lac' }
/** QUAND ELLE MORD. */
const AU_CRENEAU: Record<string, string> = {
  aube: 'à l’aube',
  jour: 'en plein jour',
  crepuscule: 'au crépuscule',
  nuit: 'la nuit',
}

/** UN RELEVÉ DE TEMPÉRATURE, ou le vide s'il n'y en a pas — au degré près : le dixième est du
 *  bruit sur un souvenir de saison. */
const degre = (t: number | undefined): string => (t === undefined ? VALEUR_VIDE : `${signe(Math.round(t))} °C`)

/** LA RECETTE EN UNE LIGNE : ce qu'elle coûte, et où on la fait. Le NIVEAU de station n'y est
 *  plus — c'est le panneau ARTISANAT qui gère la progression, pas l'encyclopédie. */
const phraseDeRecette = (id: RecipeId): string => {
  const req = RECIPES[id].requiert
  const fonction = req === null || req === undefined ? undefined : typeof req === 'string' ? req : req.fonction
  const ou = fonction === undefined ? 'à la main' : (AU_POSTE[fonction] ?? `à ${fonction}`)
  return `${coutEnClair(id)}, ${ou}`
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
    // ⚠ CE QUI SE MANGE EST UNE NOURRITURE, PAS UNE RESSOURCE (Alexis, 2026-08-25 : « les baies
    // sont dans ressources ET dans nourriture… retire de ressources »). Même doctrine que E9
    // pour le poisson cru : une entrée vit dans UNE section, celle qui répond à la question
    // qu'on se pose devant elle — d'une baie on veut savoir ce qu'elle rassasie, pas si elle
    // repousse. La règle est DÉRIVÉE de `FOOD_VALUES`, pas une liste d'exceptions à tenir :
    // une plante comestible ajoutée demain quitte RESSOURCES toute seule.
    if ((FOOD_VALUES[def.item] ?? 0) > 0) continue
    if (!out.includes(def.item)) out.push(def.item)
  }
  return out
}

function ficheRessource(item: ItemId, c: CarnetsDuJoueur): FicheEncyclo {
  const t = noeudDe(item)
  const def = t === undefined ? undefined : NODE_DEFS[t]
  const outil = def === undefined || def.tool === null || def.tool === undefined ? 'à mains nues' : AVEC_QUOI[def.tool]
  const lignes: LigneFiche[] = [
    { k: 'source', v: t === undefined ? `le monde, ${outil}` : `${auPluriel(t)}, ${outil}` },
  ]
  // LA LIGNE « IL FAUT » N'EXISTE QUE S'IL FAUT QUELQUE CHOSE. Sans elle, rien n'explique
  // qu'une pioche de fortune ne morde pas dans un filon — et le joueur croit le jeu cassé.
  const exige = def === undefined ? undefined : EXIGENCE_DE_PALIER[def.minTool ?? 'none']
  if (exige !== undefined) lignes.push({ k: 'il faut', v: exige })
  return {
    nom: nomDItem(item).toUpperCase(),
    kicker: 'RESSOURCE',
    gauche: ['récolté', groupe(compte(c, 'recolte', item))],
    droite: ['poids', fr(ITEM_WEIGHT[item] ?? 0)],
    blocs: [lignes],
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
  charbonniere: 'fût calciné',
  peat_cut: 'coupe de tourbe',
  quarry: 'carrière',
  ash_heap: 'tas de cendre',
  rubble: 'décombres',
  fishing_spot_river: 'coin de rivière',
  fishing_spot_lake: 'coin de lac',
  branche_au_sol: 'branche tombée',
  pierre_au_sol: 'pierre détachée',
}
const nomDeNoeud = (t: NodeType): string => NOMS_DE_NOEUD[t] ?? t


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
  const rec = recetteDe(item)
  const secheDepuis = (Object.entries(DRY_SLOT.sechoir ?? {}) as [string, { output: ItemId; ticks: number }][]).find(
    ([, e]) => e.output === item,
  )
  const cuitDepuis = (Object.entries(COOK_SLOT.fire ?? {}) as [string, { output: ItemId; ticks: number }][]).find(
    ([, e]) => e.output === item,
  )
  const source = secheDepuis ?? cuitDepuis
  const dOu: LigneFiche = source
    ? { k: secheDepuis ? 'au séchoir' : 'au feu', v: `depuis ${nomDItem(source[0] as ItemId).toLowerCase()}` }
    : rec !== undefined
      ? { k: 'recette', v: phraseDeRecette(rec) }
      : { k: 'se trouve', v: 'dans le monde' }
  return {
    nom: nomDItem(item).toUpperCase(),
    kicker: 'NOURRITURE',
    gauche: ['mangées', fois(compte(c, 'mange', item)) || VALEUR_VIDE],
    droite: ['rassasie', motDeFaim(FOOD_VALUES[item] ?? 0)],
    blocs: [[{ k: 'se garde', v: motDeGarde(SPOIL_CYCLES[item]) }, dOu]],
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

/** LE MARTEAU n'est d'aucune famille outillée (il ne récolte rien : il bâtit) ; LA TORCHE non
 *  plus (elle ne récolte rien : elle éclaire — spec `torche.md`). Tous deux rejoignent le palier
 *  de leur RECETTE : le marteau exige le Feu (atelier), la torche non (fortune). Dérivé, pas posé. */
export const HORS_FAMILLE: readonly ItemId[] = ['hammer', 'torche']

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
function ouvreDe(item: ItemId, f: ToolFamily | undefined): string {
  // Les deux outils SANS famille ne récoltent rien — ils ne peuvent donc pas se dériver de
  // `NODE_DEFS`, et leur ligne se dit à la main. Un `if (f === undefined) return 'le bâti'`
  // nu aurait fait dire à la torche qu'elle ouvre le bâti : la garde d'exhaustivité de
  // l'encyclopédie l'aurait laissée passer (elle compte les cases, pas leur sens).
  if (item === 'torche') return 'la nuit'
  if (f === undefined) return 'le bâti'
  const noeuds = (Object.keys(NODE_DEFS) as NodeType[]).filter((t) => NODE_DEFS[t].tool === f)
  return noeuds.map(nomDeNoeud).join(' · ') || '—'
}

function ficheOutil(item: ItemId, c: CarnetsDuJoueur): FicheEncyclo {
  const f = familleDe(item)
  const palier = palierDe(item)
  const rec = recetteDe(item)
  const lignes: LigneFiche[] = [{ k: 'ouvre', v: ouvreDe(item, f) }]
  // LA TORCHE NE RÉCOLTE RIEN : sa deuxième ligne dit ce qu'elle DURE, là où un outil dit ce
  // qu'il rend. C'est la seule case de la section dont le rendement n'a pas de sens — et la
  // faire mentir à « ×2 » aurait promis un outil de fortune qui coupe.
  if (item === 'torche') lignes.push({ k: 'brûle', v: `~${Math.round(TORCHE.BURN_TICKS / (20 * 60))} min` })
  else lignes.push({ k: 'récolte', v: motDeRendement(TOOL_YIELD[palier]) })
  if (rec !== undefined) lignes.push({ k: 'recette', v: phraseDeRecette(rec) })
  return {
    nom: nomDItem(item).toUpperCase(),
    kicker: PALIERS.find((p) => p.cle === palier)!.titre,
    gauche: ['fabriqués', fois(compte(c, 'fabrique', item)) || VALEUR_VIDE],
    droite: ['tenue', motDeTenue(TOOL_DURABILITIES[item] ?? BALANCE.TOOL_DURABILITY)],
    blocs: [lignes],
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
      droite: ['pour', 'les arcs'],
      blocs: [
        rec === undefined
          ? [{ k: 'recette', v: '—' }]
          : [{ k: 'recette', v: `${phraseDeRecette(rec)} → ×${RECIPES[rec].count ?? 1}` }],
      ],
      puces: [],
    }
  }
  const lignes: LigneFiche[] = [
    { k: 'chargé', v: motDeCharge(p.light.damage, p.charged.damage) },
    { k: 'tenue', v: motDeTenue(usure) },
  ]
  if (rec !== undefined) lignes.push({ k: 'recette', v: phraseDeRecette(rec) })
  return {
    nom: nomDItem(item).toUpperCase(),
    kicker: isRangedWeapon(item) ? 'TIR' : 'MÊLÉE',
    gauche: ['dégâts', String(p.light.damage)],
    droite: ['portée', fr(p.light.range)],
    blocs: [lignes],
    puces: isRangedWeapon(item) ? [{ texte: '⚑ elle ne frappe pas au corps à corps' }] : [],
  }
}

/* ═══ POISSONS ══════════════════════════════════════════════════════════════ */

/** LA RARETÉ, en un mot et en crans : le poids de tirage brut ne veut rien dire au joueur. */
const cransRarete = (poids: number): number => (poids >= 6 ? 1 : poids >= 4 ? 2 : poids >= 2 ? 3 : 4)
const motRarete = (poids: number): string =>
  poids >= 6 ? 'commune' : poids >= 4 ? 'assez commune' : poids >= 2 ? 'rare' : 'très rare'

function fichePoisson(sp: FishSpecies, l: { mm: number; prises: number }): FicheEncyclo {
  const eaux = sp.eaux.map((e) => EN_EAU[e] ?? `en ${e}`).join(' ou ')
  const ou = sp.zones ? `${eaux} (${sp.zones.map(nomDeZone).join(' · ')})` : eaux
  const quand = sp.creneaux ? sp.creneaux.map((cr) => AU_CRENEAU[cr] ?? cr).join(' et ') : 'à toute heure'
  return {
    nom: sp.label.toUpperCase(),
    kicker: sp.classe.toUpperCase(),
    gauche: ['record', enCm(l.mm)],
    droite: ['prises', `×${l.prises}`],
    blocs: [
      [
        { k: 'mord', v: `${ou}, ${quand}` },
        {
          k: 'saison',
          v: sp.saisons ? sp.saisons.map((n) => SAISON_COURTE[n - 1] ?? '').join(' · ') : 'toute l’année',
        },
        { k: 'rareté', v: motRarete(sp.weight), jauge: jauge(cransRarete(sp.weight), 4) },
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
  tetras: 'Grand tétras',
}
/** Le sprite du monde — la MÊME effigie qu'en jeu, pour qu'une bête se reconnaisse. */
const SPRITES_DE_BETE: Record<MonsterType, string> = {
  rabbit: 'spr-rabbit',
  deer: 'spr-deer',
  boar: 'spr-boar',
  wolf: 'spr-wolf',
  cendreux: 'spr-cendreux',
  tetras: 'spr-tetras',
}

function ficheBete(t: MonsterType, c: CarnetsDuJoueur): FicheEncyclo {
  const d = MONSTER_DEFS[t]
  const gibier = d.damage === 0
  const heures = d.activity === undefined ? 'à toute heure' : (NOMS_D_ACTIVITE[d.activity] ?? d.activity)
  const enBande = d.herdSize ? `, en ${gibier ? 'harde' : 'meute'} de ${d.herdSize[0]} à ${d.herdSize[1]}` : ' — seul'
  const ou: LigneFiche = {
    k: gibier ? 'on la croise' : 'on le croise',
    v: d.habitat ? d.habitat.map(nomDHabitat).join(' · ') : 'partout où le froid l’éveille',
  }
  // DEUX GRAMMAIRES, parce que ce ne sont pas les mêmes questions : d'un gibier on veut savoir
  // s'il détalera de loin ; d'un prédateur, quand il sort et ce qu'il laisse.
  const lignes: LigneFiche[] = gibier
    ? [
        { k: 'paît', v: `${heures}${enBande}` },
        { k: 'farouche', v: motFarouche(d.alertRange ?? 0), jauge: jauge(((d.alertRange ?? 0) / 14) * 5, 5) },
        ou,
      ]
    : [{ k: 'rôde', v: `${heures}${enBande}` }, ou]
  lignes.push({ k: 'dépouille', v: butinEnClair(t) })
  const puces: { texte: string; chaud?: boolean }[] = []
  if (d.predator === true) puces.push({ texte: '⚑ il chasse en meute' })
  if (d.chargeChance > 0) puces.push({ texte: '⚑ blessé, il charge' })
  if (t === 'cendreux') puces.push({ texte: '⚑ il boit le feu', chaud: true }, { texte: '⚑ il vient en horde', chaud: true })
  return {
    nom: NOMS_DE_BETE[t].toUpperCase(),
    kicker: t === 'cendreux' ? 'MORT-VIVANT' : gibier ? 'GIBIER' : 'DANGEREUSE',
    gauche: ['abattus', fois(compte(c, 'abat', t)) || VALEUR_VIDE],
    droite: gibier ? ['points de vie', String(d.hp)] : ['dégâts', String(d.damage)],
    blocs: [lignes],
    puces,
  }
}

/* ═══ SAISONS ═══════════════════════════════════════════════════════════════ */

/**
 * LES DEUX BOUTS DU JOUR SONT **DÉRIVÉS**, jamais recopiés (2026-08-26). Les trois autres
 * colonnes de la table sont des recopies assumées de la spec ; celles-ci ne pouvaient pas
 * l'être, parce que le RENDU s'y cale désormais (`lighting.heureSolaire`) : deux écritures du
 * même nombre, et la fiche promettrait une durée de journée que le monde ne tiendrait pas —
 * c'est très exactement le défaut qu'on vient de corriger, rejoué dans l'autre sens.
 *
 * ⚠ **AUCUN ARRONDI** : ces deux nombres sont les abscisses de la barre, et la fiche écrit
 * juste en dessous les mêmes instants EN HEURES. Un `Math.floor` sur la part de jour posait le
 * bout droit de la barre à 18h46 quand la ligne « coucher » disait 18h56 — la divergence que
 * la dérivation était censée rendre impossible.
 *
 * Le cardinal `i` est celui de la phase `i` : les deux courbes posent un point au CŒUR de
 * chaque saison (jours 15 · 45 · 75 · 105), dans l'ordre des phases.
 */
function leverDe(phase: number): number {
  return (BALANCE.LEVER_DU_JOUR.cardinaux[phase - 1]!.valeur / 24) * 100
}

function coucherDe(phase: number): number {
  return leverDe(phase) + BALANCE.PART_DE_JOUR.cardinaux[phase - 1]!.valeur * 100
}

/** Une heure murale en « 06h46 » — le format d'un almanach, puisque c'en est un. */
function heureDite(h: number): string {
  const m = Math.round((h % 1) * 60)
  return `${String(Math.floor(h) + (m === 60 ? 1 : 0)).padStart(2, '0')}h${String(m === 60 ? 0 : m).padStart(2, '0')}`
}

/**
 * ═══ LE LEVER ET LE COUCHER SE DISENT EN PLAGES, PAS EN INSTANTS (2026-08-26) ═══
 *
 * (Alexis : « On ne peut pas avoir les mêmes heures tout au long d'une saison. Dans ce cas,
 * l'encyclopédie doit montrer les plages pour les 2. »)
 *
 * Les deux courbes du soleil (`LEVER_DU_JOUR`, `PART_DE_JOUR`) interpolent JOUR PAR JOUR entre
 * leurs cardinaux — le soleil se lève quelques minutes plus tôt ou plus tard chaque matin. Un
 * cardinal ne décrit donc que le MILIEU de sa saison ; l'afficher seul laisserait croire que
 * les Pluies ont un horaire, alors qu'elles en ont trente.
 *
 * ⚠ **LE PLUS TÔT ET LE PLUS TARD DE LA SAISON, PAS SES DEUX BOUTS** — et la différence n'est
 * pas cosmétique. Une saison est centrée sur son cardinal (`coeurDeLaSaisonSuivante`), donc
 * l'Ardeur et le Grand Froid ENJAMBENT leur solstice : la courbe y descend puis remonte, et
 * leurs deux extrémités sont presque égales. Mesuré avant d'écrire : les bouts donnaient
 * « 05h41 → 05h45 » pour l'Ardeur — ce qui cache le 04h45 du solstice, c'est-à-dire tout
 * l'été. On balaie donc les trente jours et l'on rend le minimum et le maximum.
 *
 * Sans flèche, pour la même raison : le glissement n'est monotone que dans les saisons
 * d'équinoxe. Une flèche y affirmerait un sens que deux saisons sur quatre n'ont pas.
 */
function bornesDeSaison(phase: number): { lever: [number, number]; coucher: [number, number] } {
  let lMin = Infinity, lMax = -Infinity, cMin = Infinity, cMax = -Infinity
  for (let d = 0; d < BALANCE.ACT_DAYS; d++) {
    const j = (phase - 1) * BALANCE.ACT_DAYS + 1 + d
    const l = BALANCE.LEVER_DU_JOUR(j)
    const c = l + 24 * BALANCE.PART_DE_JOUR(j)
    if (l < lMin) lMin = l
    if (l > lMax) lMax = l
    if (c < cMin) cMin = c
    if (c > cMax) cMax = c
  }
  return { lever: [lMin, lMax], coucher: [cMin, cMax] }
}

/** Une plage d'heures, du plus tôt au plus tard. Un seul horaire quand la saison ne bouge pas. */
function plage([a, b]: [number, number]): string {
  return heureDite(a) === heureDite(b) ? heureDite(a) : `${heureDite(a)} – ${heureDite(b)}`
}

/**
 * LES CARDINAUX DE SAISON (spec `saisons.md` S4/S6) — la température au CŒUR de chaque
 * saison, et la part de jour de son cycle. Recopiés de la spec plutôt que recalculés : la
 * courbe de `/sim` interpole entre ces cardinaux, et c'est le cardinal qui NOMME la saison.
 */
const CARDINAUX: readonly { jour: number; nuit: number; ciel: string; fronts: string }[] = [
  { jour: 8, nuit: -2, ciel: 'pluie · brouillard du matin', fronts: '1 cycle sur 2' },
  { jour: 26, nuit: 20, ciel: 'orage sec · pluie rare', fronts: '1 cycle sur 3' },
  { jour: 8, nuit: -2, ciel: 'pluie · brouillard épais', fronts: '2 cycles sur 3' },
  { jour: -2, nuit: -16, ciel: 'neige · blizzard', fronts: '3 cycles sur 4' },
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
    // ⚠ CE SONT LES RELEVÉS DU JOUEUR, pas les cardinaux de la table (décision d'Alexis,
    // 2026-08-25) : la saison ne dit pas ce qu'elle vaut en théorie, elle dit ce qu'on y a
    // enduré. Froid à gauche, chaud à droite.
    gauche: ['le plus froid', degre(extremeEncyclo(c.encyclo, 'froid', String(phase)))],
    droite: ['le plus chaud', degre(extremeEncyclo(c.encyclo, 'chaud', String(phase)))],
    blocs: [
      [
        // ⚠ PAS DE LIGNE « vécue » ICI : la CARTE la porte déjà, deux fois — `rang` dit
        // « SAISON 3 · 30 JOURS » et `vecue` dit « vécue ×2 », juste au-dessus de cette fiche.
        // La répéter coûtait la ligne dont le soleil avait besoin (la fiche en tient quatre).
        // LE SOLEIL, DIT EN HEURES (2026-08-26) : la barre jour/nuit donnait une PART, jamais
        // un horaire — or c'est l'horaire qu'on lit sur l'horloge du HUD, et c'est par là que
        // le joueur vérifie que le monde tient sa promesse. Deux lignes et non une : le lever
        // et le coucher ne glissent pas du même côté, et c'est ça, une saison.
        { k: 'lever', v: plage(bornesDeSaison(phase).lever) },
        { k: 'coucher', v: plage(bornesDeSaison(phase).coucher) },
        { k: 'ciel', v: k.ciel },
        { k: 'semis', v: cultureDe(phase) },
      ],
    ],
    // LA CADENCE DES FRONTS, en puce : la fiche tient quatre lignes (voir le bloc), la puce
    // porte ce qui n'y rentrait plus. Le champ était calculé juste (vérifié contre
    // `METEO.PAR_SAISON` : moyenne d'`episode` / `BLOC_EPISODE`) et jamais montré.
    puces: [{ texte: `fronts : ${k.fronts}` }],
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
        froid: '',
        chaud: '',
        lever: 0,
        coucher: 0,
        vecue: '',
        fiche: null,
      }
    }
    return {
      phase,
      rang: `SAISON ${phase} · ${BALANCE.ACT_DAYS} JOURS`,
      nom: NOMS_DE_SAISON[phase - 1]!,
      froid: degre(extremeEncyclo(c.encyclo, 'froid', String(phase))),
      chaud: degre(extremeEncyclo(c.encyclo, 'chaud', String(phase))),
      lever: leverDe(phase),
      coucher: coucherDe(phase),
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

/* ═══ LE DÉVERROUILLAGE DE RELECTURE (DEV) ══════════════════════════════════ */

/**
 * UN CARNET QUI A TOUT RENCONTRÉ — pour RELIRE les fiches, pas pour jouer (2026-08-25).
 *
 * Relire les tooltips demandait, autrement, d'avoir vraiment récolté, fabriqué, mangé, pêché
 * et abattu chaque entrée : quelques dizaines d'heures de Veillée pour voir une fois toutes
 * les fiches — et donc, en pratique, des fiches qu'on n'a jamais relues. Même remède que
 * partout ailleurs dans ce projet : ce qu'on ne peut pas ATTEINDRE ne se corrige pas.
 *
 * ⚠ C'EST UNE SUBSTITUTION, PAS UNE DÉROGATION. On ne passe pas un drapeau « révèle tout » aux
 * fabriques de cases : on leur donne un carnet complet, et elles suivent leur chemin ORDINAIRE.
 * Il n'existe donc toujours qu'UNE seule façon pour une case de parler — la règle du muet
 * (*une entrée jamais rencontrée ne dit rien*) reste entière, et ses balayages exhaustifs, qui
 * partent d'un carnet VIDE, gardent exactement ce qu'ils gardaient.
 *
 * Il MIROITE LES ÉNUMÉRATEURS DE L'ÉCRAN (`ressourcesDe`, `rangeesNourriture`, `outilsDuPalier`,
 * `rangeesArmes`, `FISH_SPECIES`, `MONSTER_DEFS`, les quatre saisons) et non les tables brutes de
 * `/sim` : une entrée ajoutée demain à une section entre ici par le même chemin qu'elle entre
 * dans la grille. La garde qui le prouve est dans `encyclopedie.test.ts` — `su === tot` sur
 * CHAQUE entrée du rail, la seule assertion qui dise « complètement » plutôt que « à l'œil ».
 *
 * Le VERBE est celui de la section qui affiche la case : c'est lui que le chiffre montre.
 */
export function carnetComplet(): CarnetsDuJoueur {
  const encyclo: LigneEncyclo[] = []
  const note = (verbe: VerbeCarnet, id: string): void => {
    const k = cleEncyclo(verbe, id)
    if (!encyclo.some((l) => l.k === k)) encyclo.push({ k, n: COMPTE_FEINT })
  }
  for (const skill of METIERS_DE_RECOLTE) for (const i of ressourcesDe(skill)) note('recolte', i)
  for (const r of rangeesNourriture()) for (const i of r.items) note('mange', i)
  for (const p of PALIERS) for (const i of outilsDuPalier(p.cle)) note('fabrique', i)
  for (const r of rangeesArmes()) for (const i of r.items) note('fabrique', i)
  for (const t of Object.keys(MONSTER_DEFS) as MonsterType[]) note('abat', t)
  for (const phase of [1, 2, 3, 4]) {
    note('vecu', String(phase))
    // LES RELEVÉS DE SAISON — les cardinaux de la table font des relevés PLAUSIBLES (la nuit
    // pour le froid, le jour pour le chaud) : une fiche relue sur des `—` ne se relit pas.
    const k = CARDINAUX[phase - 1]!
    encyclo.push({ k: cleEncyclo('froid', String(phase)), n: k.nuit }, { k: cleEncyclo('chaud', String(phase)), n: k.jour })
  }
  return {
    encyclo,
    // LE RECORD EST LE MAXIMUM DE L'ESPÈCE : un `0,0 cm` sous le nom d'un brochet ferait relire
    // une fiche qui ment, et c'est justement la relecture qu'on vient chercher.
    peche: FISH_SPECIES.map((sp) => ({ sp: sp.id, mm: sp.tailleMaxMm, prises: COMPTE_FEINT })),
  }
}
