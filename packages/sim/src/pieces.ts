/**
 * ═══ LE REGISTRE DES PIÈCES — une table, et l'union en DÉRIVE ═══
 *
 * `StructureType` n'est plus une liste qu'on tient à jour à côté de ses tables : elle
 * EST `keyof typeof PIECES`. Ajouter une pièce, c'est ajouter une entrée — et une
 * entrée incomplète ne compile pas.
 *
 * CE QU'IL RÉPARE, ET C'EST MESURÉ (2026-08-01). Une pièce traversait NEUF sites.
 * Quatre étaient des `Record<StructureType, …>` : les oublier ne compilait pas. Les
 * cinq autres écrivaient la propriété EN PROSE — une chaîne de `if`, un `Set`, une
 * entrée de dessin — et leur défaut était le plus dangereux des deux :
 *   · oubliée dans `structureBlocks`, une jardinière devient un MUR ;
 *   · oubliée dans `blocksNavigation`, elle fait refuser les poses alentour ;
 *   · oubliée dans `USURABLE`, elle est neuve pour l'éternité.
 * La palissade, ajoutée le 2026-08-01, a coûté 19 fichiers en deux commits, et le
 * message du second nomme lui-même « les six listes écrites à la main que le
 * compilateur ne gardait pas ». C'est cette classe de défaut qu'on supprime ici, pas
 * un défaut particulier.
 *
 * CE QU'IL NE CHANGE PAS. Tout ce qui suit est transcrit à l'identique depuis
 * `STRUCTURE_COSTS`, `STRUCTURE_HP`, `DEFAULT_ACCESS`, `COMPONENTS`, `CONTAINER_TYPES`,
 * `POSABLE_SUR_EAU`, `USURABLE` et `structureBlocks` — un déménagement, pas un
 * rééquilibrage. Relevé avant/après : 34 pièces, 408 combinaisons de blocage et les
 * ordres de clés, tous identiques.
 *
 * LA SEULE CHOSE QU'IL CHANGE, et c'était le but : `blocksNavigation` (R7) comptait six
 * pièces basses — banc, friche, terre battue, encadrement, poutre, mur bas — comme des
 * MURS, alors que le joueur les enjambe. `structure-blocking.test.ts` avait nommé ces six
 * écarts, jugé que « la vérité que le joueur ressent est la bonne », et prescrit ce
 * registre comme remède, à appliquer AVANT que ces pièces ne deviennent posables (D1).
 * Conséquence de jeu : R7 refuse désormais strictement MOINS qu'avant — une ruine de
 * poutres ne scelle plus un Feu. Testé par sa conséquence, pas par sa définition
 * (`construction.test.ts`, « une ruine de POUTRES ne scelle rien »).
 *
 * DÉTERMINISME. Données pures, sérialisables, sans tirage et sans import de valeur :
 * ce module est une FEUILLE du graphe (`balance.ts` le lit, jamais l'inverse). Le
 * dessin, lui, reste côté client, indexé par le même nom.
 *
 * Le vocabulaire vient de la spec `docs/specs/construction.md` (R8 les deux familles,
 * R14 les pièces molles, R23 l'arête, R7 la navigabilité) et des quatre décisions du
 * 2026-08-01 (`docs/decisions.md`).
 */
import type { AccessLevel, ItemBag } from './items'

/**
 * LA MATIÈRE d'une pièce — bois, pierre, métal. Alias de `WallMaterial`, dont le nom
 * datait du temps où seuls les murs en avaient une : depuis D3 (2026-08-01), toute pièce
 * peut en déclarer, et un `WallMaterial` sur une table se lirait mal. Le nom historique
 * survit pour ses ~20 lecteurs ; le neuf s'écrit `Matiere`.
 */
export type Matiere = 'wood' | 'stone' | 'metal'

/**
 * LA FAMILLE — ce que la pièce EST. Elle porte le rayon des menus (D1) et rien d'autre :
 * aucune règle de sim n'en dépend, pour qu'ajouter un rayon reste sans conséquence.
 */
export type Famille =
  /** Le Feu — l'ancre *sui generis* (R1). Une seule pièce, et elle n'est comme aucune autre. */
  | 'ancre'
  /** Ce qui EST le bâtiment : murs, sols, toits, seuils, enclos (D1 → le marteau). */
  | 'structure'
  /** L'atome ACTIF (R8) : groupé, il fait émerger une fonction (R9). */
  | 'composant'
  /** Ce qui est DANS le bâtiment et dit qu'on y VIVAIT (D1 → l'établi). */
  | 'mobilier'
  /** Ce qui dit qu'on CULTIVAIT là. */
  | 'ferme'
  /** Ce qui dit que c'est TOMBÉ. */
  | 'vestige'
  /** Héritage V3, conservé pour les parties déjà jouées — rien de neuf n'y entre. */
  | 'heritage'

/**
 * LE GESTE qui la pose (D1, décision d'Alexis 2026-08-01) : *ce qui EST le bâtiment se
 * bâtit au marteau ; ce qui est DANS le bâtiment se fabrique puis se pose.*
 *
 * `monde` = aucune route joueur AUJOURD'HUI (le worldgen la pose, personne d'autre).
 * C'est un état de fait qu'on nomme, pas une règle : la tranche T6 le fera basculer.
 */
export type Pose = 'marteau' | 'objet' | 'feu' | 'monde'

/** La COUCHE occupée (R14) : le sol et le toit se superposent à ce qui est dessous. */
export type Occupe = 'tuile' | 'sol' | 'toit'

/**
 * L'ARÊTE (R23-R25). Un mur vit sur un TRAIT, pas sur une case ; un sol n'a pas d'arête
 * à porter, et la palissade n'a aucune forme pleine-tuile historique à honorer (elle est
 * née après R23, et le rendu n'en connaît aucune).
 */
export type Arete = 'requise' | 'possible' | 'interdite'

/**
 * CE QU'ELLE FAIT AU PASSAGE.
 *   · `oui`     — on ne traverse pas.
 *   · `enjambe` — un banc, une poutre tombée, un carré de friche : on passe DESSUS.
 *                 Une ruine dont chaque débris bloque est un labyrinthe, pas un lieu.
 *   · `non`     — pièce MOLLE (R14) : le sol et le toit ne s'opposent à rien.
 *   · `porte`   — close elle arrête tout le monde, ouverte plus personne (R26).
 */
export type Bloque = 'oui' | 'enjambe' | 'non' | 'porte'

/** Les quatre fonctions émergentes (R9-R10). Le bonus d'enceinte, lui, vit dans `FUNCTIONS`. */
export type FunctionId = 'forge' | 'atelier' | 'grenier' | 'ferme'

/**
 * CE QU'UNE RECETTE EXIGE DU LIEU — et le FEU y a sa place à part.
 *
 * Les fonctions émergent d'un amas de composants (R9) ; le Feu, lui, est l'ancre *sui
 * generis* (R1) : il n'émerge de rien, il ne monte pas de palier, et il est la seule
 * station qu'un survivant nu puisse allumer. Le nommer ici, à côté des quatre fonctions,
 * évite de lui inventer une fausse fonction à un seul membre — et permet à `requiert`
 * d'avoir UNE seule forme.
 */
export type StationFonction = FunctionId | 'feu'

/**
 * L'EXIGENCE d'une recette : une CAPACITÉ à portée, pas un objet précis.
 *
 * C'est le remplacement de `Recipe.station`, qui nommait un type de structure
 * (`'workshop'`, `'four_acier'`). Nommer l'objet forçait chaque station neuve à venir
 * retoucher les recettes ET les listes d'UI ; nommer la capacité laisse le registre
 * répondre — une station qui déclare `fonction` + `palier` sert d'elle-même toutes les
 * recettes de son rang et des rangs inférieurs.
 */
export interface Exigence {
  fonction: StationFonction
  /** Le palier MINIMAL. Le Feu n'en a qu'un ; les fonctions vont de 1 à 3 (R10). */
  niveau: number
}

/**
 * LA CAPACITÉ QU'UNE PIÈCE OFFRE comme station de craft, ou `null` (un mur ne forge pas).
 * Source unique : la sim s'en sert pour valider, le client pour griser — deux lecteurs,
 * une définition, donc aucun fantôme vert là où la sim refuse.
 */
export function capaciteStation(type: StructureType): Exigence | null {
  if (type === 'fire') return { fonction: 'feu', niveau: 1 }
  const f = piece(type).fonction
  return f === undefined ? null : { fonction: f, niveau: palierDe(type) }
}

/**
 * Cette pièce sert-elle l'exigence demandée ? Un palier SUPÉRIEUR sert les inférieurs —
 * un atelier lourd sait ce que sait un établi. C'est la lecture cumulative de R10, et
 * c'est ce qui empêche une station de rang 3 d'être inutile pour une recette de rang 1.
 */
export function sertExigence(type: StructureType, besoin: Exigence): boolean {
  const offre = capaciteStation(type)
  return offre !== null && offre.fonction === besoin.fonction && offre.niveau >= besoin.niveau
}

/**
 * LE NOM NU d'une fonction — sans article, pour les ÉNUMÉRATIONS.
 *
 * Il en faut deux, et c'est ce que j'avais manqué : « il faut **une** Forge N2 » se dit
 * dans une phrase, mais une liste qui compose « RECETTES DE **une** Forge N2 » ne se lit
 * pas — c'est ce que le navigateur affichait. Le nu se juxtapose, l'article se phrase.
 */
export const FONCTION_NOM: Record<StationFonction, string> = {
  feu: 'Feu',
  forge: 'Forge',
  atelier: 'Atelier',
  grenier: 'Grenier',
  ferme: 'Ferme',
}

/** Le nom AVEC son article — pour les phrases : « il faut une Forge N2 ». */
export const FONCTION_LABEL: Record<StationFonction, string> = {
  feu: 'le Feu',
  forge: 'une Forge',
  atelier: 'un Atelier',
  grenier: 'un Grenier',
  ferme: 'une Ferme',
}

/** « Feu », « Atelier N2 » — la forme NUE, celle des listes et des puces. */
export function nomExigence(besoin: Exigence): string {
  const nom = FONCTION_NOM[besoin.fonction]
  return besoin.fonction === 'feu' ? nom : `${nom} N${besoin.niveau}`
}

/**
 * « le Feu », « un Atelier N2 » — ce qu'on DIT au joueur quand le lieu ne suffit pas.
 *
 * C'est le remplacement du nom d'objet brut (« station requise : workshop ») : la recette
 * ne connaît plus l'objet, et de toute façon plusieurs objets répondent à la même
 * exigence. Le Feu n'a pas de rang — l'écrire « le Feu N1 » ne dirait rien à personne.
 */
export function libelleExigence(besoin: Exigence): string {
  const nom = FONCTION_LABEL[besoin.fonction]
  return besoin.fonction === 'feu' ? nom : `${nom} N${besoin.niveau}`
}

export interface PieceDef {
  /** Le nom français, celui des menus. Il vit ICI pour que la sim puisse livrer une
   *  pièce complète — le client n'a plus sa propre table à tenir d'accord. */
  label: string
  fam: Famille
  pose: Pose
  occupe: Occupe
  arete: Arete
  bloque: Bloque
  pv: number
  /** Ce que coûte la PIÈCE : pose au marteau, chantier d'un village PNJ, remboursement. */
  cout: ItemBag
  /**
   * Ce que coûte l'OBJET à fabriquer, quand il diffère du coût de la pièce.
   *
   * Une seule pièce déroge — le `furnace`, à 10 pierres en recette contre 8 en pièce.
   * C'est une DÉRIVE trouvée par le registre (les onze autres composants ont les deux
   * nombres égaux) : le four est le seul composant venu de l'héritage V3, où il valait
   * 8. Conservée telle quelle ici, à arbitrer — ce sont deux pierres, et c'est à Alexis.
   */
  coutObjet?: ItemBag
  acces: AccessLevel
  /** L'eau libre est INCONSTRUCTIBLE, sauf ce qui porte sa propre assise (R4). */
  eau: boolean
  /**
   * VIEILLIT-ELLE ? Un mur, une table, un âtre portent leur usure dans leurs PV — le
   * client les assombrit d'autant, et la ruine se voit. Une meule de foin ou un carré
   * de friche, non : « à 30 % de PV » n'y veut rien dire.
   */
  usurable: boolean
  /**
   * DU MONDE AU SENS FORT (décision d'Alexis, 2026-08-11) : la même loi que la falaise,
   * portée par une structure. `applyStructureDamage` est inerte sur elle, le siège ne la
   * désigne jamais, le flow field et la joignabilité des spawns la traitent comme la
   * roche. Réservée aux pièces `pose: 'monde'` posées à l'amorce — un état qui ne bouge
   * jamais, c'est ce qui autorise ces trois lectures à la considérer comme du terrain.
   */
  incassable?: boolean
  /** Nombre de cases si c'est un CONTENEUR ; absent = elle ne contient rien. */
  capacite?: number
  /** Le palier du FEU qui la débloque (R6). Absent = libre dès le palier 1. */
  unlockTier?: number
  /**
   * LES MATIÈRES qu'elle accepte, dans l'ordre de progression. Absent = une seule, son
   * essence (la palissade EST de bois — décision d'Alexis, 2026-08-01).
   *
   * D3 (décision d'Alexis) : DEUX RÉGIMES, et c'est `matiereChiffre` qui les sépare.
   */
  matieres?: readonly Matiere[]
  /**
   * LA MATIÈRE CHANGE-T-ELLE LES CHIFFRES, ou seulement l'œil ? (D3)
   *
   * `true` — le STRUCTUREL : PV et coût montent avec la matière (`WALL_TIERS`), et on
   * améliore sur place au marteau (R8). C'est la défense, elle doit se payer.
   * `false`/absent — le MOBILIER et la DÉCO : mêmes PV, même coût, seule la teinte
   * change, et elle se choisit À LA POSE. Le motif est arithmétique autant
   * qu'esthétique : 40 pièces × 4 matières font 640 nombres, et le GDD veut des ordres
   * de grandeur qu'on éprouve en playtest — personne n'en calibre 640.
   */
  matiereChiffre?: boolean
  /**
   * LA FONCTION qu'elle sert (R9), et le PALIER auquel elle la porte (R10). Les deux
   * vont ensemble ou pas du tout — c'est ce couple qui fait de `FUNCTIONS.recipeByTier`
   * une table DÉRIVÉE, et c'est la porte par laquelle un meuble peut compter (D4) :
   * la paillasse déclarera `fonction: 'dortoir'` le jour où le Dortoir arrivera, sans
   * une ligne de logique neuve.
   *
   * ⚠ DISTINCT de `unlockTier` : le four se pose dès le palier 1 du village
   * (`unlockTier: 1`) mais porte la Forge à son palier 2 (`palier: 2`).
   */
  fonction?: FunctionId
  palier?: number
}

/**
 * LA TABLE. L'ordre des clés est celui de l'ancienne union — les projections
 * (`STRUCTURE_COSTS`, `STRUCTURE_HP`…) gardent donc leur ordre de clés à l'identique.
 */
export const PIECES = {
  // ── L'ANCRE ────────────────────────────────────────────────────────────────
  fire: {
    label: 'Feu', fam: 'ancre', pose: 'feu', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 900, cout: { wood: 10 }, acces: 'village', eau: false, usurable: false,
  },

  // ── LES BARRIÈRES DU MARTEAU (R8, R20) ─────────────────────────────────────
  wall: {
    label: 'Mur', fam: 'structure', pose: 'marteau', occupe: 'tuile', arete: 'possible',
    bloque: 'oui', pv: 200, cout: { wood: 2 }, acces: 'village', eau: false, usurable: true,
    matieres: ['wood', 'stone', 'metal'], matiereChiffre: true,
  },
  palissade: {
    // Des rondins dressés : l'enceinte d'un village n'est pas le mur d'un bâtiment.
    // Sans palier de matériau — le bois est son essence (décision d'Alexis, 2026-08-01).
    label: 'Palissade', fam: 'structure', pose: 'marteau', occupe: 'tuile', arete: 'requise',
    bloque: 'oui', pv: 300, cout: { wood: 3 }, acces: 'village', eau: false, usurable: false,
  },
  door: {
    label: 'Porte', fam: 'structure', pose: 'marteau', occupe: 'tuile', arete: 'possible',
    bloque: 'porte', pv: 150, cout: { wood: 3 }, acces: 'village', eau: false, usurable: false,
    matieres: ['wood', 'stone', 'metal'], matiereChiffre: true,
  },
  floor: {
    // La SEULE pièce qui porte sa propre assise : des planches sur l'eau (R4).
    label: 'Sol', fam: 'structure', pose: 'marteau', occupe: 'sol', arete: 'interdite',
    bloque: 'non', pv: 60, cout: { wood: 1 }, acces: 'village', eau: true, usurable: true,
  },
  roof: {
    label: 'Toit', fam: 'structure', pose: 'marteau', occupe: 'toit', arete: 'interdite',
    bloque: 'non', pv: 60, cout: { wood: 1 }, acces: 'village', eau: false, usurable: true,
  },

  // ── CE QU'ON TIENT ET QU'ON POSE ───────────────────────────────────────────
  chest: {
    label: 'Coffre', fam: 'mobilier', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 100, cout: { wood: 4 }, acces: 'private', eau: false, usurable: false,
    capacite: 24,
  },
  /**
   * LE SÉCHOIR (spec `peche.md` D13/S1, décision d'Alexis 2026-08-24) — une claie de bois et de
   * corde, posée dehors. Il prend le poisson ET la viande, et rend du séché qui traverse
   * l'hiver (`DRY_SLOT`) : c'est la promesse « conserves » du GDD, tenue SANS SEL.
   *
   * Du MOBILIER, pas un composant : il ne fait émerger aucune fonction et n'appartient à aucun
   * amas — on le pose où l'on veut, on y accroche, on part. **Aucun combustible, aucune
   * surveillance, et la météo ne l'interrompt pas** (D13, contre ma recommandation d'un
   * séchage suspendu par la pluie : le couplage ajoutait une surveillance pour une décision
   * que le joueur ne prend qu'une fois).
   */
  sechoir: {
    label: 'Séchoir', fam: 'mobilier', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 80, cout: { wood: 6, rope: 2 }, acces: 'village', eau: false, usurable: true,
  },
  workshop: {
    label: 'Établi', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 100, cout: { wood: 6, stone: 4 }, acces: 'village', eau: false, usurable: false,
    unlockTier: 1, fonction: 'atelier', palier: 1,
  },
  furnace: {
    label: 'Four', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 100, cout: { stone: 8 }, coutObjet: { stone: 10 },
    acces: 'village', eau: false, usurable: false,
    unlockTier: 1, fonction: 'forge', palier: 2,
  },
  house: {
    // Héritage V3 : on en franchit le seuil, et le flood-fill la traverse.
    label: 'Maison', fam: 'heritage', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 100, cout: { wood: 8 }, acces: 'village',
    eau: false, usurable: false,
  },

  // ── LES COMPOSANTS (R8) — groupés, ils font émerger une fonction ────────────
  // Forge : enclume (fer de récup, dès P1) → four → four d'acier (exige P3).
  enclume: {
    label: 'Enclume', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 120, cout: { stone: 6, iron_ore: 2 }, acces: 'village', eau: false, usurable: false,
    unlockTier: 1, fonction: 'forge', palier: 1,
  },
  four_acier: {
    label: "Four d'acier", fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 150, cout: { cut_stone: 8, iron_ingot: 5 }, acces: 'village', eau: false, usurable: false,
    unlockTier: 3, fonction: 'forge', palier: 3,
  },
  // Atelier : établi (= `workshop`, plus haut) → tour méca → atelier lourd (P3).
  tour_meca: {
    label: 'Tour mécanique', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 120, cout: { wood: 8, iron_ingot: 3 }, acces: 'village', eau: false, usurable: false,
    unlockTier: 2, fonction: 'atelier', palier: 2,
  },
  atelier_lourd: {
    label: 'Atelier lourd', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 150, cout: { cut_stone: 6, iron_ingot: 6 }, acces: 'village', eau: false, usurable: false,
    unlockTier: 3, fonction: 'atelier', palier: 3,
  },
  // Grenier : des CONTENEURS anti-pourriture, réserve COMMUNE du village.
  silo: {
    label: 'Silo', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 100, cout: { wood: 8, fiber: 4 }, acces: 'village', eau: false, usurable: false,
    capacite: 36, unlockTier: 1, fonction: 'grenier', palier: 1,
  },
  cave: {
    label: 'Cave', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 130, cout: { stone: 8, cut_stone: 4 }, acces: 'village', eau: false, usurable: false,
    capacite: 36, unlockTier: 2, fonction: 'grenier', palier: 2,
  },
  reserve: {
    label: 'Réserve', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 160, cout: { cut_stone: 8, iron_ingot: 3 }, acces: 'village', eau: false, usurable: false,
    capacite: 36, unlockTier: 3, fonction: 'grenier', palier: 3,
  },
  // Ferme : parcelle (de saison) → serre (cultures d'hiver) → terroir. En plein air.
  parcelle: {
    label: 'Parcelle', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 60, cout: { wood: 4, fiber: 4 }, acces: 'village', eau: false, usurable: false,
    unlockTier: 1, fonction: 'ferme', palier: 1,
  },
  serre: {
    label: 'Serre', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 80, cout: { wood: 8, fiber: 6 }, acces: 'village', eau: false, usurable: false,
    unlockTier: 2, fonction: 'ferme', palier: 2,
  },
  terroir: {
    label: 'Terroir', fam: 'composant', pose: 'objet', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 100, cout: { cut_stone: 6, hardwood: 4 }, acces: 'village', eau: false, usurable: false,
    unlockTier: 3, fonction: 'ferme', palier: 3,
  },

  // ── LE MONDE BÂTI — ce qui dit qu'on VIVAIT là (`poi-batis.ts`) ─────────────
  table: {
    label: 'Table', fam: 'mobilier', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 60, cout: { wood: 4 }, acces: 'village', eau: false, usurable: true,
  },
  banc: {
    label: 'Banc', fam: 'mobilier', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 40, cout: { wood: 2 }, acces: 'village', eau: false, usurable: true,
  },
  paillasse: {
    // Un couchage au ras du sol : le dormeur s'y tient DESSUS, et un campement dont
    // chaque lit bloque ferait de l'anneau du Feu un piège à hordes.
    label: 'Paillasse', fam: 'mobilier', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 40, cout: { fiber: 6, wood: 2 }, acces: 'village',
    eau: false, usurable: false,
  },
  etagere: {
    label: 'Étagère', fam: 'mobilier', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 50, cout: { wood: 3 }, acces: 'private', eau: false, usurable: true,
  },
  tonneau: {
    label: 'Tonneau', fam: 'mobilier', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 60, cout: { wood: 5 }, acces: 'village', eau: false, usurable: true,
  },
  friche: {
    label: 'Friche', fam: 'ferme', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 30, cout: { fiber: 2 }, acces: 'village', eau: false, usurable: false,
  },
  terre: {
    // Le sol d'une cour : sans elle, un enclos n'est qu'une clôture posée dans l'herbe.
    label: 'Terre battue', fam: 'structure', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 40, cout: { stone: 1 }, acces: 'village', eau: false, usurable: false,
  },
  cloture: {
    // AU MARTEAU depuis D1 (2026-08-01) : une clôture EST le bâtiment (l'enclos), donc
    // elle se bâtit en matériaux bruts. Elle avait coût, PV et dessin depuis le monde bâti
    // — il ne lui manquait qu'une route vers le joueur, et c'est ce champ.
    label: 'Clôture', fam: 'structure', pose: 'marteau', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 80, cout: { wood: 1 }, acces: 'village', eau: false, usurable: true,
  },
  abreuvoir: {
    label: 'Abreuvoir', fam: 'ferme', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 120, cout: { stone: 4 }, acces: 'village', eau: false, usurable: true,
  },
  meule: {
    label: 'Meule de foin', fam: 'ferme', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 40, cout: { fiber: 8 }, acces: 'village', eau: false, usurable: false,
  },
  encadrement: {
    // Un TROU DANS LE MUR tenu par deux jambages et un linteau : il ne ferme rien.
    // Une `door` sans village bloquerait TOUT LE MONDE — aucune ruine ne peut en porter.
    // AU MARTEAU depuis D1 : un seuil EST le bâtiment. Il ne ferme rien (`enjambe`) — c'est
    // ce qui le distingue d'une porte, et ce qui donne une entrée à un bâtiment sans serrure.
    label: 'Encadrement', fam: 'structure', pose: 'marteau', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 120, cout: { wood: 4 }, acces: 'village', eau: false, usurable: false,
  },
  atre: {
    label: 'Âtre', fam: 'mobilier', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 250, cout: { stone: 8 }, acces: 'village', eau: false, usurable: true,
  },
  // ── CE QUI RESTE `monde`, ET POURQUOI (D1) ────────────────────────────────
  // Une poutre TOMBÉE et un carré de FRICHE ne se bâtissent pas : ce sont des états du
  // monde, pas des ouvrages. Le MUR BAS est un vestige (un mur qui s'est écroulé), pas une
  // pièce qu'on dresse — le joueur a la palissade et le mur pour ça. Et la TERRE BATTUE
  // devra d'abord régler sa COUCHE : elle est déclarée `tuile` alors qu'elle est un
  // revêtement de sol, donc posée par un joueur elle interdirait tout meuble sur sa case.
  poutre: {
    label: 'Poutre tombée', fam: 'vestige', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 60, cout: { wood: 3 }, acces: 'village', eau: false, usurable: true,
  },
  mur_bas: {
    label: 'Mur bas', fam: 'vestige', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 150, cout: { stone: 2 }, acces: 'village', eau: false, usurable: true,
  },
  charrette: {
    // Échouée là où on l'a laissée : le corps de la Charrette abandonnée et des épaves.
    // Elle BLOQUE — un chariot n'est pas un débris qu'on enjambe, c'est un obstacle qu'on
    // contourne, et c'est ce qui donne enfin un corps solide à un lieu qui n'était qu'un sprite.
    label: 'Charrette', fam: 'vestige', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 80, cout: { wood: 4 }, acces: 'village', eau: false, usurable: true,
  },
  autel: {
    // La pierre dressée d'un oratoire. Debout, elle — un autel ne tombe pas, il s'oublie.
    label: 'Autel', fam: 'mobilier', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 250, cout: { stone: 6 }, acces: 'village', eau: false, usurable: true,
  },
  // ── LE VOCABULAIRE NATUREL (spec lieux-batis, étage 2 — décision d'Alexis 2026-08-10) ──
  // Le minéral ne VIEILLIT pas (`usurable: false`) : « à 30 % de PV » n'y veut rien dire —
  // l'argument de la meule — et l'usure du sort ne mord pas le roc.
  roc: {
    // Le plancher de pierre nue d'un antre. Un SOL (R14) : occupe 'sol' — fullTileAt
    // l'ignore, la couche sol le juge, le rendu le couche à FLOOR_DEPTH.
    label: 'Roc', fam: 'structure', pose: 'monde', occupe: 'sol', arete: 'interdite',
    bloque: 'non', pv: 60, cout: { stone: 1 }, acces: 'village', eau: false, usurable: false,
  },
  massif: {
    // La roche en masse — l'épaisseur qui clôt un antre (≥ 1 tuile pleine, peinte `H`
    // dans la grille, jamais dérivée). INCASSABLE : de la vraie roche, pas un mur — les
    // hordes la contournent, rien ne la mâche, rien ne naît derrière.
    label: 'Massif rocheux', fam: 'structure', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 500, cout: { stone: 3 }, acces: 'village', eau: false, usurable: false,
    incassable: true,
  },
  rocher: {
    // Le bloc erratique de poche : plein-tuile, on le CONTOURNE — le corps solide du minéral.
    label: 'Rocher', fam: 'vestige', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 250, cout: { stone: 6 }, acces: 'village', eau: false, usurable: false,
  },
  eboulis: {
    // Les pierres croulées : basses, on passe PAR-DESSUS — le mur_bas du minéral.
    label: 'Éboulis', fam: 'vestige', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 150, cout: { stone: 2 }, acces: 'village', eau: false, usurable: false,
  },
  // ── LE VOCABULAIRE MINIER (spec lieux-batis, étage 3 REVU — décision d'Alexis
  // 2026-08-10 : « tout en pièces, partout ») : la mine se construit de A à Z comme un
  // bâtiment. Du BOIS d'œuvre qui vieillit et brûle — rien de tout ça ne survit au feu.
  chevalement: {
    // La tour du puits — la silhouette qui dit « mine » de loin, en PIÈCE haute.
    label: 'Chevalement', fam: 'vestige', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 400, cout: { wood: 8 }, acces: 'village', eau: false, usurable: true,
  },
  galerie: {
    // La bouche boisée d'une galerie — MOLLE : c'est un porche, on la franchit. Posée
    // devant le passage d'un antre, elle est l'entrée qu'on lit comme une porte.
    label: 'Entrée de galerie', fam: 'vestige', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'non', pv: 300, cout: { wood: 4, stone: 2 }, acces: 'village', eau: false, usurable: true,
  },
  etai: {
    // Le poteau de boisage : bas, on passe PAR-DESSUS ses calages — le mur_bas du mineur.
    label: 'Étai', fam: 'vestige', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'enjambe', pv: 80, cout: { wood: 2 }, acces: 'village', eau: false, usurable: true,
  },
  wagonnet: {
    // La berline échouée sur son bout de voie : elle BLOQUE, on la contourne (la
    // charrette du sous-sol).
    label: 'Wagonnet', fam: 'vestige', pose: 'monde', occupe: 'tuile', arete: 'interdite',
    bloque: 'oui', pv: 120, cout: { wood: 2, iron_ingot: 1 }, acces: 'village', eau: false, usurable: true,
  },
} as const satisfies Record<string, PieceDef>

/** LE TYPE, DÉRIVÉ. C'est tout le propos : la liste ne se tient plus à la main. */
export type StructureType = keyof typeof PIECES

/** Les clés, dans l'ordre de la table — l'ordre canonique de toutes les projections. */
export const STRUCTURE_TYPES = Object.keys(PIECES) as StructureType[]

/** Les clés dont un champ vaut une valeur donnée — un filtre au niveau du TYPE. */
type KeysWhere<F extends keyof PieceDef, V> = {
  [K in StructureType]: (typeof PIECES)[K] extends Record<F, V> ? K : never
}[StructureType]

/**
 * LES PIÈCES DU MARTEAU (R20, D1) — dérivées de `pose`, plus écrites nulle part.
 * Le menu du marteau, le fantôme, la visée d'arête et la validation serveur lisent
 * toutes cette même définition : c'était la liste la plus recopiée du projet.
 */
export type BarrierType = KeysWhere<'pose', 'marteau'>

/** Les COMPOSANTS (R8) — dérivés de la famille. */
export type ComponentType = KeysWhere<'fam', 'composant'>

export const BARRIER_TYPES = STRUCTURE_TYPES.filter((t) => PIECES[t].pose === 'marteau') as BarrierType[]

/**
 * LES SOLIDES ÉTERNELS (décision d'Alexis, 2026-08-11) — les pièces `incassable`, dérivées
 * du registre. Trois lectures les traitent comme de la ROCHE et non comme du bâti : les
 * dégâts (inertes), le flow field (le gradient contourne au lieu de traverser) et la
 * joignabilité des spawns (« la roche disqualifie, le mur non » — le massif est roche).
 * UNE table dérivée, jamais trois listes.
 */
export const INCASSABLE_TYPES = new Set<StructureType>(
  STRUCTURE_TYPES.filter((t) => (PIECES[t] as PieceDef).incassable === true),
)
export const estIncassable = (t: StructureType): boolean => INCASSABLE_TYPES.has(t)


/**
 * L'ORDRE CANONIQUE DES FONCTIONS — celui du catalogue (§4bis), et il porte du sens :
 * la Forge d'abord (le métal ouvre tout le reste), puis l'Atelier, le Grenier, la Ferme.
 * Il ordonne `COMPONENT_TYPES` et l'itération de `FUNCTIONS` : deux tables dérivées dont
 * l'ordre doit être STABLE, puisque le flux d'événements de la reconnaissance en dépend.
 */
export const FUNCTION_IDS: readonly FunctionId[] = ['forge', 'atelier', 'grenier', 'ferme']

/**
 * Les COMPOSANTS, groupés par FONCTION et ordonnés par PALIER — enclume, four, four
 * d'acier, puis établi, tour, atelier lourd, etc. C'est l'ordre historique de la table
 * `COMPONENTS`, reproduit ici par une RÈGLE au lieu d'une liste : « chaque fonction, du
 * plus simple au plus riche ».
 */
const rangFonction = (t: StructureType): number => {
  const f = piece(t).fonction
  return f === undefined ? FUNCTION_IDS.length : FUNCTION_IDS.indexOf(f)
}

export const COMPONENT_TYPES = STRUCTURE_TYPES.filter((t) => PIECES[t].fam === 'composant').sort(
  (a, b) => rangFonction(a) - rangFonction(b) || palierDe(a) - palierDe(b),
) as ComponentType[]

/**
 * CETTE PIÈCE SERT-ELLE UNE FONCTION ? (les barrières et le Feu, non)
 *
 * La question porte sur le CHAMP `fonction`, pas sur la famille — et c'est la porte que
 * D4 demandait (décision d'Alexis, 2026-08-01) : *« aucun effet par défaut, et l'exception
 * se déclare »*. Le jour où la paillasse doit compter, elle écrit `fonction: 'dortoir',
 * palier: 1` dans son entrée et entre dans le modèle d'amas (R9-R10) sans une ligne de
 * logique neuve — alors qu'elle reste, pour les menus, du MOBILIER.
 *
 * Aujourd'hui les deux lectures donnent le même ensemble (les douze composants), et
 * `pieces.test.ts` l'affirme : c'est un élargissement du possible, pas un changement.
 *
 * ⚠ Le Dortoir n'est PAS déclaré, exprès : le §4bis le donne pour différé et son effet
 * (« récupération accrue ») n'existe pas. Une fonction qui émerge sans rien faire est une
 * promesse que le jeu ne tient pas — c'est une tranche de gameplay, pas une ligne de table.
 */
export function isComponent(type: StructureType): boolean {
  return piece(type).fonction !== undefined
}

/**
 * PROJETTE le registre en table indexée par pièce. C'est la forme de TOUTES les vues
 * dérivées (`STRUCTURE_COSTS`, `STRUCTURE_HP`…) : exhaustive par construction, sans
 * `as` sur un `Object.fromEntries` qui rendrait un index de chaînes et laisserait
 * passer une clé manquante.
 */
export function parPiece<T>(valeur: (t: StructureType) => T): Record<StructureType, T> {
  const table = {} as Record<StructureType, T>
  for (const t of STRUCTURE_TYPES) table[t] = valeur(t)
  return table
}

/**
 * LA PIÈCE, VUE COMME UN `PieceDef` — et c'est par ici que tout le monde la lit.
 *
 * `PIECES` est figée `as const` (c'est ce qui fait dériver `StructureType` et les deux
 * unions filtrées), donc chaque entrée porte son type LITTÉRAL exact : les champs
 * optionnels qu'elle omet n'existent pas sur elle, et `PIECES[t].palier` ne compile pas
 * pour une clé quelconque. Cet accesseur élargit au contrat commun, où l'absent
 * redevient `undefined` — la précision du littéral sert la DÉRIVATION, la vue élargie
 * sert la LECTURE.
 */
export function piece(type: StructureType): PieceDef {
  return PIECES[type]
}

/**
 * LE PALIER auquel un composant porte sa fonction. `0` pour ce qui n'en sert aucune —
 * `fonction` et `palier` vont toujours ensemble (affirmé par `pieces.test.ts`).
 */
export function palierDe(type: StructureType): number {
  return piece(type).palier ?? 0
}

/** Les matières qu'une pièce accepte. Défaut : le bois seul — son essence. */
export function matieresDe(type: StructureType): readonly Matiere[] {
  return piece(type).matieres ?? ['wood']
}

/**
 * LA MATIÈRE CHANGE-T-ELLE LES CHIFFRES de cette pièce ? (D3)
 *
 * Remplace les deux `type === 'wall' || type === 'door'` écrits à la main dans
 * `village.ts` (au coût, et aux PV) : la question appartient à la pièce, pas à ses
 * lecteurs. Une pièce structurelle neuve qui gagne des paliers n'a plus à venir se faire
 * inscrire dans deux conditions.
 */
export function matiereChiffre(type: StructureType): boolean {
  return piece(type).matiereChiffre === true
}

/**
 * ═══ L'INVARIANT DE NAVIGABILITÉ (R7) : est-ce un OBSTACLE ? ═══
 *
 * Une seule ligne, et c'est le point. `structureBlocks` (le déplacement) et cette
 * question-ci (le flood-fill de R7, la détection d'enceinte R13-R14) lisent le MÊME
 * champ : ce que le joueur sent sous ses pieds et ce que la garde calcule ne peuvent
 * plus diverger. Seule la PORTE fait exception, et c'est le cœur du modèle — close elle
 * arrête tout le monde, mais pour R7 elle ne ferme pas, sinon clore un village serait
 * interdit (« on entre dans sa forge », parce qu'on la POUSSE).
 *
 * ── CE QUE ÇA CORRIGE (2026-08-01) ──
 * `blocksNavigation` était une liste de QUATRE exceptions (`door`, `floor`, `roof`,
 * `house`) écrite AVANT que les pièces basses du monde bâti n'existent : le banc, la
 * friche, la terre battue, l'encadrement, la poutre et le mur bas y comptaient donc
 * comme des MURS, par simple péremption. `structure-blocking.test.ts` avait nommé les
 * six écarts, jugé que « la vérité que le joueur ressent est la bonne », et prescrit mot
 * pour mot le remède : *faire de la géométrie une donnée déclarée UNE fois par type*.
 * Le défaut était LATENT (ces pièces ne sont posées que par le worldgen) et devait être
 * refermé AVANT qu'elles ne deviennent posables au marteau — donc maintenant, avant la
 * tranche qui les ouvre au joueur (D1).
 */
export function bloqueNavigation(type: StructureType): boolean {
  return piece(type).bloque === 'oui'
}

/** Le coût de l'OBJET à fabriquer — le coût de la pièce, sauf dérogation (le four). */
export function coutObjet(type: StructureType): ItemBag {
  const def = piece(type)
  return def.coutObjet ?? def.cout
}

/**
 * LES DEUX CAPACITÉS DE CONTENEUR, nommées — `SLOTS` (balance) les lit ici pour que la
 * taille d'un coffre soit écrite UNE fois, du côté de la pièce qui la porte.
 */
export const CAPACITE_COFFRE = PIECES.chest.capacite
export const CAPACITE_GRENIER = PIECES.silo.capacite
