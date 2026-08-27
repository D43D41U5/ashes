/**
 * LES ANNALES — les lecteurs du pays d'avant, et leurs garde-fous (spec `annales.md` R4-R6).
 *
 * Les ÉCRIVAINS des annales sont les passes de génération (`poi.ts`, `zonegen.ts`) — méthode
 * Caves of Qud, des faits estampillés, jamais d'agents simulés (S-R16). Ce module porte le
 * versant LECTURE : la primitive partagée (`faitsDuLieu`) et les deux garde-fous qui empêchent
 * le passé procédural de se lire comme un tableau Excel à la saison 5 — le défaut MESURÉ
 * ailleurs (Starfield : le joueur apprend la distribution et cesse de lire).
 *
 * Tout est PUR : lecture d'une donnée statique de carte, `hash2` positionnel, zéro tirage sur
 * le PRNG d'état, zéro horloge. Un lecteur peut donc tourner côté sim (chronique) comme côté
 * client (stèles), sur les mêmes fonctions.
 */
import type { FaitDeGeneration, WorldMap } from './map'
import { hash2 } from './noise'

/**
 * LE RÉGLAGE DES LECTEURS. Il vit ICI et non dans `balance.ts` : ces nombres se calibrent en
 * REGARDANT une carte et ses textes (combien de stèles parlent ? lesquelles ?), pas en jouant
 * — la ligne de partage de l'en-tête de `balance.ts`, même côté que `CENDRE`.
 */
export const ANNALES = {
  /**
   * LA SAILLANCE (R4) : un fait n'est verbalisé que s'il est LOCALEMENT RARE — au plus
   * `SAILLANCE_MAX` faits du même type dans `SAILLANCE_RAYON` tuiles (lui-même compris).
   * Ce qui est partout est un décor ; ce qui est seul est une histoire. Et comme la
   * distribution change avec la carte, la table fait→texte est INAPPRENABLE par cœur —
   * c'est le garde-fou anti-Excel, par construction et non par obscurité.
   */
  SAILLANCE_RAYON: 160,
  SAILLANCE_MAX: 2,
  /**
   * LA LACUNE SALÉE (R5) : cette part des faits n'est JAMAIS verbalisée par un objet du
   * monde — la stèle est brisée, le fragment illisible. La conséquence physique du fait,
   * elle, reste visible (la clairière de l'essart est là) : le joueur curieux reconstitue en
   * lisant le TERRAIN — la lacune est une leçon, pas une privation. Le tableau Excel devient
   * impossible à REMPLIR.
   *
   * ⚠ Elle ne s'applique qu'aux textes GRAVÉS (les stèles, P2b) — jamais au constat d'un
   * visiteur : la ligne de chronique dit ce que le marcheur voit de ses yeux (R5②).
   */
  PART_MUETTE: 0.25,
  /** Le fait d'ère 2 « sous » une stèle se cherche dans ce rayon — la pose est AU BORD du
   *  fait (t0 R18 : rien ne s'adosse à une sente), jamais dessus. */
  STELE_FAIT_RAYON: 8,
  /** La portée de la ligne 2 : de quoi la stèle a le droit de parler. L'ordre de grandeur est
   *  l'écran et demi — une stèle parle du PAYS autour d'elle, pas de l'autre bout du monde. */
  STELE_PORTEE: 120,
  /**
   * LE RAYON D'APPARTENANCE D'UN FAIT À UN LIEU (R13, décision d'Alexis du 2026-08-25) — « ce
   * qui s'est passé ICI » pour la fiche d'un lieu.
   *
   * ⚠ CE N'EST PAS L'ÉCRAN, malgré ce qu'on serait tenté d'écrire : le cadre fait
   * `VISIBLE_TILES_TALL` = 20 tuiles de haut (≈ 36 de large en 16:9), donc 40 tuiles valent
   * DEUX hauteurs d'écran. C'est le PAYS autour du lieu, le même ordre de grandeur que
   * `STELE_PORTEE` en plus serré.
   *
   * MESURÉ (`tools/diag-fiche.mts --joue`, banc 12 cycles, seed 2026) sur les 14 faits de
   * chronique qui portent un (tx, ty) : **l'empreinte stricte en capte 1**, un rayon de 20 en
   * capte 4, **celui-ci en capte 13**. C'est ce chiffre-là qui a décidé la valeur — sans lui,
   * la fiche d'un lieu tenait UNE ligne à jamais (seuls `poi_first_visit` et `refugee_rumeur`
   * posaient une clef). Il se recalibre en LISANT une fiche, d'où sa place ici et non dans
   * `balance.ts`.
   */
  LIEU_RAYON: 40,
} as const

const SEL_LACUNE = 0x4c414355 // 'LACU'

/**
 * LES FAITS D'UN LIEU — la primitive de lecture partagée, à la clef EXACTE de l'écrivain
 * (`poi.ts` : centre d'empreinte + slug). Un seul point de vérité : quatre lecteurs qui
 * recalculeraient le centre chacun de leur côté, c'est le défaut de la marge de cendre
 * (R1bis de `cortege-cendre.md`), refait ici.
 */
export function faitsDuLieu(map: WorldMap, zone: { x: number; y: number; w: number; h: number; kind?: string }): FaitDeGeneration[] {
  const cx = Math.floor(zone.x + zone.w / 2)
  const cy = Math.floor(zone.y + zone.h / 2)
  const out: FaitDeGeneration[] = []
  for (const f of map.annales ?? []) {
    if (f.x === cx && f.y === cy && f.lieu === zone.kind) out.push(f)
  }
  return out
}

/**
 * LE LIEU AUQUEL UN FAIT APPARTIENT (R13) — le plus proche des lieux dans `LIEU_RAYON`, ou
 * `undefined` si le fait s'est produit en pleine campagne.
 *
 * Sur le CENTRE du lieu et non son empreinte : une empreinte de POI fait quelques tuiles, et
 * mesurée, elle n'attrapait qu'un fait sur quatorze. Strict (`<`) : à égalité, le plus petit
 * `poiId` tranche — l'ordre de `placePois`, déterministe pour une seed.
 *
 * Pur, et O(zones) par appel : on ne l'appelle qu'au formatage d'une chronique (quelques
 * dizaines de faits), jamais dans le tick.
 */
export function lieuDuFait(map: WorldMap, tx: number, ty: number): number | undefined {
  const r2 = ANNALES.LIEU_RAYON * ANNALES.LIEU_RAYON
  let best: number | undefined
  let bestD = r2 + 1
  for (let i = 0; i < map.zones.length; i += 1) {
    const z = map.zones[i]!
    if (z.kind === undefined) continue // une zone sans `kind` est un toponyme, jamais un lieu
    const dx = z.x + z.w / 2 - tx
    const dy = z.y + z.h / 2 - ty
    const d2 = dx * dx + dy * dy
    if (d2 <= r2 && d2 < bestD) {
      bestD = d2
      best = i
    }
  }
  return best
}

/**
 * CE FAIT EST-IL SAILLANT — assez rare autour de lui pour mériter d'être dit ? (R4)
 *
 * O(annales) par appel : les annales d'une carte se comptent en centaines, et un lecteur ne
 * s'interroge qu'à une découverte ou à la pose d'une stèle — jamais dans le tick chaud.
 */
export function saillant(map: WorldMap, fait: FaitDeGeneration): boolean {
  const r2 = ANNALES.SAILLANCE_RAYON * ANNALES.SAILLANCE_RAYON
  let voisins = 0
  for (const f of map.annales ?? []) {
    // (type, CAUSE) et non le type seul : un sort `intact` parmi vingt `brule` est une
    // histoire — le juger au type l'aurait tu avec les autres. MESURÉ sur la carte du
    // harnais : au type seul, 40 lieux « parlants » (le registre intime noyé) ; à la
    // cause près, le rare redevient rare.
    if (f.type !== fait.type || f.cause !== fait.cause) continue
    const dx = f.x - fait.x
    const dy = f.y - fait.y
    if (dx * dx + dy * dy <= r2) voisins += 1
    if (voisins > ANNALES.SAILLANCE_MAX) return false
  }
  return true
}

/**
 * CE FAIT PEUT-IL ÊTRE GRAVÉ DANS LE MONDE — ou sa stèle est-elle brisée ? (R5)
 *
 * Déterministe et POSITIONNEL (`hash2` salé sur la tuile) : le même fait rend le même verdict
 * sur toute machine, à toute heure, sans un octet d'état. Le type n'entre pas dans le sel —
 * deux faits du même lieu se taisent ENSEMBLE : c'est la stèle qui est brisée, pas la phrase.
 */
export function verbalise(fait: FaitDeGeneration): boolean {
  return hash2(fait.x, fait.y, SEL_LACUNE) >= ANNALES.PART_MUETTE
}


// ═══════════════════════════════════════════════════════════════════════════════════════════
// LE TEXTE DES STÈLES (spec `annales.md` R9-R10) — la seule première personne du jeu.
// ═══════════════════════════════════════════════════════════════════════════════════════════

export interface TexteDeStele {
  /** Une ou deux lignes lapidaires — UNE seule (le fragment) si la stèle est brisée. */
  lignes: string[]
  brisee: boolean
  /** Le poiId du lieu que la ligne 2 désigne — absent si brisée, ou sans ligne 2. C'est LUI
   *  que la charge révèle (R11) : le texte et la révélation ne peuvent pas diverger. */
  lieuVise?: number
}

/** La ligne 1 — le fait SOUS la stèle, à l'imparfait (bible T1 : l'imparfait appartient au
 *  pays d'avant). */
const PHRASE_SOUS: Record<string, { pleine: string; fragment: string }> = {
  croisee: { pleine: 'Ici les chemins se répondaient.', fragment: '… les chemins …' },
  gue: { pleine: "Ici l'eau se laissait passer.", fragment: "… l'eau …" },
}

/** « Regarder » une direction : le sud, l'est — l'article suit la voyelle, en DONNÉE (T5 :
 *  jamais une formule sensible à l'accord). */
const REGARD: Record<string, string> = { nord: 'le nord', sud: 'le sud', est: "l'est", ouest: "l'ouest" }
/** « Aller » vers une direction : au sud, à l'est. */
const ALLER: Record<string, string> = { nord: 'au nord', sud: 'au sud', est: "à l'est", ouest: "à l'ouest" }

/**
 * LA LIGNE 2 — le fait d'un LIEU, dans la voix de son auteur : le « nous », le présent et
 * l'impératif admis (bible T2 — une inscription s'adresse au passant, ce n'est pas le
 * narrateur qui parle au joueur).
 *
 * CE QUI N'Y ENTRE JAMAIS (R9bis) : le `sort` — une stèle a été gravée par des VIVANTS, elle
 * ne peut pas savoir ce que la Cendre a fait de ce qu'elle désigne ; et l'`essart`, dont la
 * phrase est locative (« ici le bois a cédé » n'a de sens qu'au lieu même).
 */
function phraseLoin(f: FaitDeGeneration): { pleine: string; fragment: string } | undefined {
  switch (f.type) {
    case 'fondation':
      if (f.cause === 'eau') return { pleine: "Plus loin vivaient ceux de l'eau.", fragment: "… l'eau …" }
      if (f.cause === 'route') return { pleine: 'Plus loin vivaient ceux de la route.', fragment: '… la route …' }
      return undefined
    case 'guet': {
      const d = REGARD[f.cause ?? '']
      return d === undefined ? undefined : { pleine: `Nous guettions ${d}.`, fragment: `… ${d} …` }
    }
    case 'fuite': {
      // Le présent : la stèle de l'exode fige l'instant où on l'a gravée.
      const d = ALLER[f.cause ?? '']
      return d === undefined ? undefined : { pleine: `Nous partons ${d}.`, fragment: `… ${d} …` }
    }
    case 'taille':
      if (f.cause !== 'fer' && f.cause !== 'charbon') return undefined
      return { pleine: `Le ${f.cause} affleure. Taillez.`, fragment: '… taillez …' }
    case 'fosse':
      return { pleine: 'Plus loin dorment les nôtres.', fragment: '… les nôtres …' }
    case 'gravure':
      return { pleine: 'Les pierres parlaient avant nous.', fragment: '… avant nous …' }
    default:
      return undefined
  }
}

/**
 * LE TEXTE D'UNE STÈLE au point donné — fonction PURE, partagée sim/client (l'écrivain
 * unique : la chronique et le rendu ne peuvent pas se contredire).
 *
 * `undefined` si aucun fait d'ère 2 ne vit sous la stèle : ce n'est pas un emplacement de
 * stèle, et l'appelant doit le savoir plutôt que d'afficher une pierre muette par accident.
 */
export function texteDeStele(map: WorldMap, sx: number, sy: number): TexteDeStele | undefined {
  const annales = map.annales ?? []

  // Le fait SOUS la stèle : le plus proche croisee/gue dans STELE_FAIT_RAYON, strict (le
  // premier gagne à égalité — l'ordre des annales est celui de la génération, déterministe).
  const rSous2 = ANNALES.STELE_FAIT_RAYON * ANNALES.STELE_FAIT_RAYON
  let sous: FaitDeGeneration | undefined
  let sousD = rSous2 + 1
  for (const f of annales) {
    if (f.type !== 'croisee' && f.type !== 'gue') continue
    const d2 = (f.x - sx) * (f.x - sx) + (f.y - sy) * (f.y - sy)
    if (d2 <= rSous2 && d2 < sousD) { sousD = d2; sous = f }
  }
  if (sous === undefined) return undefined

  // La ligne 2 : le fait de LIEU saillant le plus proche à portée.
  const rLoin2 = ANNALES.STELE_PORTEE * ANNALES.STELE_PORTEE
  let loin: FaitDeGeneration | undefined
  let loinPhrase: { pleine: string; fragment: string } | undefined
  let loinD = rLoin2 + 1
  for (const f of annales) {
    if (f.lieu === undefined) continue
    const phrase = phraseLoin(f)
    if (phrase === undefined) continue
    const d2 = (f.x - sx) * (f.x - sx) + (f.y - sy) * (f.y - sy)
    if (d2 > rLoin2 || d2 >= loinD) continue
    if (!saillant(map, f)) continue // en dernier : c'est le test O(annales)
    loinD = d2
    loin = f
    loinPhrase = phrase
  }

  // LA STÈLE BRISÉE (R10) : un fragment, tiré de la ligne la plus parlante — et rien d'autre.
  if (!verbalise(sous)) {
    return { lignes: [(loinPhrase ?? PHRASE_SOUS[sous.type]!).fragment], brisee: true }
  }

  const lignes = [PHRASE_SOUS[sous.type]!.pleine]
  let lieuVise: number | undefined
  if (loin !== undefined && loinPhrase !== undefined) {
    lignes.push(loinPhrase.pleine)
    // Le lieu désigné : la zone dont le centre et le kind sont EXACTEMENT ceux du fait — la
    // même clef que `faitsDuLieu`, à l'envers.
    for (let poiId = 0; poiId < map.zones.length; poiId += 1) {
      const z = map.zones[poiId]!
      if (z.kind !== loin.lieu) continue
      if (Math.floor(z.x + z.w / 2) === loin.x && Math.floor(z.y + z.h / 2) === loin.y) {
        lieuVise = poiId
        break
      }
    }
  }
  return { lignes, brisee: false, ...(lieuVise !== undefined ? { lieuVise } : {}) }
}


// ═══════════════════════════════════════════════════════════════════════════════════════════
// LA VOIX DU VISITEUR (spec `annales.md` R14) — ce qu'un marcheur constate d'un fait.
//
// C'est le SECOND lecteur du même vocabulaire, et il ne parle pas comme le premier : la stèle
// a un auteur mort (le « nous », l'impératif — bible T2), le visiteur n'a que ses yeux. Il dit
// donc à la troisième personne, et il a le droit de dire le SORT — que la stèle ignore par
// construction (R9bis) : les ruines brûlées se VOIENT.
//
// La lacune salée (R5) ne s'applique PAS ici : elle borne les textes GRAVÉS dans le monde,
// jamais le constat d'un visiteur (R5②). Une fiche ne se brise pas.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** Ce qu'un fait devient sous les yeux d'un visiteur : sa phrase et son registre. */
export interface PhraseDeFait {
  texte: string
  /** Le même registre que la chronique — la fiche mêle les deux sans qu'on distingue lequel
   *  est lequel : `intime` pour ce qui touche les morts, `recit` pour le reste. */
  poids: 'recit' | 'intime'
}

/** « le sud », « l'est » — l'article suit la voyelle, en DONNÉE (jamais une formule d'accord). */
const LE_POINT: Record<string, string> = { nord: 'le nord', sud: 'le sud', est: "l'est", ouest: "l'ouest" }
/** « au sud », « à l'est ». */
const AU_POINT: Record<string, string> = { nord: 'au nord', sud: 'au sud', est: "à l'est", ouest: "à l'ouest" }

/**
 * LA TABLE, TENUE PAR LE COMPILATEUR — un `Record` sur l'union des types : un type ajouté à
 * `FaitDeGeneration` ne compile plus tant qu'il n'a pas sa voix. C'est la garde d'exhaustivité
 * par CONSTRUCTION ; l'atteignabilité des CAUSES, elle, se prouve à part sur une vraie carte
 * (une table balayée fabrique ses propres conditions).
 *
 * Les temps suivent la bible T1 : l'imparfait appartient au pays d'avant (ce qui DURAIT), le
 * passé composé dit ce qui l'a fini (ère 3 — la Cendre, la fosse, le départ).
 */
const VOIX: Record<FaitDeGeneration['type'], (f: FaitDeGeneration) => PhraseDeFait> = {
  // ── Ère 0 : la pierre et l'eau ──
  gravure: () => ({ texte: 'Les pierres portaient une écriture.', poids: 'recit' }),

  // ── Ère 1 : l'implantation ──
  fondation: (f) => ({
    texte:
      f.cause === 'eau' ? "Quelqu'un s'était installé ici, pour l'eau."
      : f.cause === 'route' ? "Quelqu'un s'était installé ici, pour la route."
      : "Quelqu'un s'était installé ici.",
    poids: 'recit',
  }),
  essart: () => ({ texte: 'Le bois avait reculé pour faire la place.', poids: 'recit' }),
  taille: (f) => ({
    texte:
      f.cause === 'fer' ? 'On taillait le fer, là où la roche affleure.'
      : f.cause === 'charbon' ? 'On tirait le charbon, là où la roche affleure.'
      : 'On taillait la roche là où elle affleure.',
    poids: 'recit',
  }),
  guet: (f) => ({
    texte: LE_POINT[f.cause ?? ''] === undefined ? 'On surveillait, depuis ici.' : `On regardait ${LE_POINT[f.cause!]}.`,
    poids: 'recit',
  }),

  // ── Ère 2 : les routes ──
  gue: () => ({ texte: "L'eau se laissait passer ici.", poids: 'recit' }),
  croisee: () => ({ texte: 'Des chemins se répondaient ici.', poids: 'recit' }),
  porte: (f) => ({
    texte: f.cause === 'secours' ? "C'était une porte de secours." : 'Le pays borne ici son seuil.',
    poids: 'recit',
  }),

  // ── Ère 3 : la Cendre ──
  sort: (f) => (
    f.cause === 'brule' ? { texte: 'La Cendre est passée : tout a brûlé.', poids: 'intime' }
    : f.cause === 'pille' ? { texte: 'On est venu prendre ce qui restait.', poids: 'recit' }
    : { texte: "Personne n'y est revenu.", poids: 'intime' }
  ),
  fosse: () => ({ texte: 'La vallée a enterré ici.', poids: 'intime' }),
  fuite: (f) => ({
    texte: AU_POINT[f.cause ?? ''] === undefined ? 'Ils sont partis.' : `Ils sont partis ${AU_POINT[f.cause!]}.`,
    poids: 'intime',
  }),
}

/**
 * CE QU'UN VISITEUR CONSTATE D'UN FAIT — fonction TOTALE (tout fait a sa voix : c'est le
 * `Record` ci-dessus qui le garantit, pas une discipline).
 *
 * Pure et partagée sim/client, comme `texteDeStele` : l'écrivain unique. Si la fiche et la
 * chronique décrivaient le même fait avec deux phrases écrites deux fois, elles finiraient
 * par se contredire — c'est très exactement le défaut que ce module existe pour empêcher.
 */
export function phraseDuFait(f: FaitDeGeneration): PhraseDeFait {
  return VOIX[f.type](f)
}

/**
 * LE NOM D'UNE ÈRE — la gouttière de la fiche, dans les mots de `map.ts` (le schéma les écrit
 * déjà en toutes lettres : « 0 = la pierre et l'eau, 1 = l'implantation, 2 = les routes,
 * 3 = la Cendre »). On ne baptise rien ici : on donne au lecteur ce que la donnée dit déjà.
 * Totale — une ère hors domaine rend son chiffre plutôt que rien.
 */
export function nomDEre(ere: number): string {
  return ['la pierre et l’eau', 'l’implantation', 'les routes', 'la Cendre'][ere] ?? `l’ère ${ere}`
}
