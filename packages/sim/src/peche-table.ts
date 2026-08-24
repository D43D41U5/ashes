/**
 * ═══ LA TABLE DE PRISES (spec `peche.md` D10-D11, T1-T8) ═══
 *
 * *Ce qui mord dépend de l'EAU, de la ZONE, de la SAISON et de l'HEURE — et il peut ne rien
 * mordre du tout.* Quatre axes, et pourtant aucune matrice à quatre entrées : chaque espèce
 * DÉCLARE ses conditions (`FISH_SPECIES`, `balance.ts`), et cette table les filtre puis les
 * pèse. Ajouter une espèce est une ligne ; ajouter un axe serait un champ.
 *
 * TOUT EST PUR ET ENTIER ICI : les poids sont des entiers, le tirage est un cumul, les bornes
 * de créneau sont des ticks. Aucune fonction Math approximée (invariant §2), aucune horloge —
 * le tick est le temps. Le seul flottant est le tirage lui-même (`rngRoll`), et il ne sert
 * qu'à une comparaison.
 *
 * ⚠ CE MODULE NE TIRE RIEN. Il rend une table et sait la lire ; c'est `economy.ts` qui
 * consomme le PRNG d'état, parce que c'est là que vit l'action. Un module qui tire en douce
 * est un module qu'on ne peut pas tester sans état.
 */
import { FISHING, FISH_SPECIES, TROUVAILLES, type CreneauDePeche, type FishSpecies, type NomDeNature, type Trouvaille } from './balance'
import { estInonde, porteDeLEau } from './eau'
import { zoneSlugAt } from './map'
import { NATURE_MARAIS, NATURE_RIEN, NOM_DE_NATURE, type NatureEau } from './peche-nature'

import type { SimState } from './sim'
import { debutDeCycle, dayTicksAt, jourDeSaison, phaseForDay } from './time'

/**
 * LA NATURE DE L'EAU D'UNE TUILE, AUJOURD'HUI (T1) — `null` si on ne peut pas y pêcher.
 *
 * Deux sources, et l'ordre compte : la CRUE d'abord (c'est un état du jour, et une terre
 * inondée n'a pas de nature dans la carte immuable), puis la carte. `porteDeLEau` tranche le
 * reste : une mare partie ne porte plus rien, même si la carte la dit « mare » pour toujours.
 *
 * `niveauConnu` se passe quand on balaie plusieurs tuiles au même tick (tous les pêcheurs du
 * monde, une fois par tick) : le niveau d'eau est global, et le relire par tuile paierait un
 * rembobinage de huit cycles d'élection météo à chaque ligne tendue (E5).
 */
export function natureDeLEau(state: SimState, tx: number, ty: number, niveauConnu?: number): NomDeNature | null {
  const carte = state.map.natureEau
  const i = ty * state.map.width + tx
  const brute = (carte?.[i] ?? NATURE_RIEN) as NatureEau
  // ⚠ LE MARAIS N'EST PAS UNE EAU DE PÊCHE (décision d'Alexis, 2026-08-24) — c'est un SOL MOU.
  //
  // Il a d'abord été rendu pêchable, puis retiré, et le raisonnement mérite d'être gardé : le
  // marais fait **87 % de l'eau de la vallée** (257 201 tuiles contre 39 221 d'eau ouverte,
  // mesuré graine 909). Pêchable, la Tourbière devenait de loin le premier terrain de pêche et
  // la distinction rivière/lac cessait de peser — or c'est elle qui porte D10 (« la géographie
  // module »). On garde donc la pêche sur l'eau OUVERTE, et le marais reste ce que la sim en
  // faisait déjà : un terrain lent (`speedFactor` 0,6 ; roselière 0,55) où l'on s'enlise.
  //
  // Il porte quand même sa nature dans la carte immuable (`NATURE_MARAIS`) : c'est une vérité
  // de terrain, et d'autres systèmes la liront. Elle n'est simplement pas un axe de la TABLE.
  if (!porteDeLEau(state, tx, ty, niveauConnu)) return null
  // Une tuile de marais que la CRUE a noyée reste du marais dans la carte : on ne la rend pas
  // pêchable pour autant (c'est de la vase sous l'eau), elle tombe donc en `null`.
  if (brute === NATURE_MARAIS) return null
  if (brute !== NATURE_RIEN) return NOM_DE_NATURE[brute] as NomDeNature
  // Pas de nature dans la carte, et pourtant il y a de l'eau : c'est la CRUE (une terre que
  // le niveau a noyée). Une carte d'AVANT la nature tombe ici aussi — elle n'a pas de crue,
  // et son eau permanente passe alors pour une mare, la nature la plus pauvre : on ne fait
  // pas de cadeau à une vieille sauvegarde, on lui donne quelque chose de jouable.
  if (estInonde(state, tx, ty, niveauConnu)) return 'crue'
  return carte === undefined ? 'mare' : null
}

/**
 * CETTE TUILE SE PÊCHE-T-ELLE ? — la loi, en un booléen, pour le CLIENT (spec `peche.md` E6).
 *
 * ⚠ ELLE EXISTE PARCE QUE LE CURSEUR S'EN ÉTAIT ÉCARTÉ. La visée appelait `porteDeLEau`, qui
 * ne dit oui que sur les deux terrains d'eau ou une terre inondée — le MARAIS, lui, se pêche
 * (il ne s'assèche pas, il est mouillé par nature). Résultat : sur 7 % de la carte, la sim
 * acceptait le lancer et le client refusait de le proposer. Le joueur, lui, voyait de l'eau.
 *
 * Une portée recopiée d'un côté est une portée qui divergera — c'est vrai d'une loi aussi.
 */
export function eauPechable(state: SimState, tx: number, ty: number, niveauConnu?: number): boolean {
  return natureDeLEau(state, tx, ty, niveauConnu) !== null
}

/**
 * LE CRÉNEAU DU CYCLE (T5) — aube, plein jour, crépuscule, nuit.
 *
 * Bornes dérivées de `dayTicksAt`, donc **saisonnières par construction** : la nuit du Grand
 * Froid est plus longue, et ses espèces mordent donc plus longtemps. Personne n'a à l'écrire.
 * L'aube et le crépuscule prennent chacun `CRENEAU_PART_NUM/DEN` du jour (un huitième).
 */
export function creneauAt(state: SimState, tick: number = state.tick): CreneauDePeche {
  const pos = tick - debutDeCycle(state, tick)
  const jour = dayTicksAt(state, tick)
  const marge = Math.max(1, Math.floor((jour * FISHING.CRENEAU_PART_NUM) / FISHING.CRENEAU_PART_DEN))
  if (pos >= jour) return 'nuit'
  if (pos < marge) return 'aube'
  if (pos >= jour - marge) return 'crepuscule'
  return 'jour'
}

/** Une ligne de la table : ce qui peut sortir de l'eau — ou pas. */
export type LignePrise =
  | { kind: 'rien'; weight: number }
  | { kind: 'poisson'; weight: number; species: FishSpecies }
  | { kind: 'trouvaille'; weight: number; trouvaille: Trouvaille }

export interface TableDePrises {
  lignes: LignePrise[]
  total: number
}

/** L'endroit et l'instant, tels que la table les lit — quatre axes, plus le coin. */
export interface Conditions {
  nature: NomDeNature
  zone: string | undefined
  saison: number
  creneau: CreneauDePeche
  surCoin: boolean
}

/** Une condition ABSENTE ne filtre rien (T2) : c'est ce qui rend la table extensible. */
function retient<T>(declare: readonly T[] | undefined, valeur: T): boolean {
  return declare === undefined || declare.includes(valeur)
}

/**
 * L'ESPÈCE MORD-ELLE ICI, MAINTENANT ? La conjonction des quatre axes, plus le coin.
 * Exportée : la garde A8 la balaie sur tout le domaine au lieu d'échantillonner des touches.
 */
export function especeRetenue(sp: FishSpecies, c: Conditions): boolean {
  if (!sp.eaux.includes(c.nature)) return false
  if (!retient(sp.zones, c.zone ?? '')) return false
  if (!retient(sp.saisons, c.saison)) return false
  if (!retient(sp.creneaux, c.creneau)) return false
  // `coinSeul` : la récompense d'avoir trouvé le coin (E3). Le sandre et le silure n'existent
  // que là — c'est la seule chose qu'un coin AUTORISE, et elle est déclarée espèce par espèce.
  return sp.coinSeul !== true || c.surCoin
}

/**
 * LE POIDS DU « RIEN » (T3) — le frein qui remplace le `stock` du coin depuis D9.
 *
 * Sur l'eau nue il n'y a pas de stock : sans cette ligne, une mare serait un robinet de
 * nourriture infini. Le coin le DIVISE (`COIN_RIEN_DIV`) — c'est là qu'est son vrai cadeau,
 * et c'est ce qui lui garde un sens maintenant que toute l'eau se pêche. Plancher à 1 : même
 * le meilleur coin du monde peut ne pas mordre du premier coup.
 */
export function poidsDuRien(c: Conditions): number {
  const base = FISHING.RIEN_PAR_EAU[c.nature]
  if (!c.surCoin) return base
  return Math.max(1, Math.floor(base / FISHING.COIN_RIEN_DIV))
}

/**
 * LA TABLE, POUR CES CONDITIONS (T7) — l'ordre est celui des déclarations : le « rien »
 * d'abord, puis les espèces dans l'ordre de `FISH_SPECIES`, puis les trouvailles. **Cet ordre
 * EST le tirage cumulatif** : le réordonner change les prises de tous les replays enregistrés.
 *
 * ⚠ LE LAC MORT (décision posée le 2026-08-24) : aucun poisson n'y mord — mais on y pêche, et
 * on y remonte des choses. L'exclure du geste aurait rendu le mécanisme MUET là-bas (un refus
 * sans raison lisible) ; une table stérile dit la même chose en la faisant SENTIR. La
 * géographie module, elle n'autorise jamais.
 */
export function tableDePrises(c: Conditions): TableDePrises {
  const lignes: LignePrise[] = [{ kind: 'rien', weight: poidsDuRien(c) }]
  const mort = c.zone === 'lac_mort'
  if (!mort) {
    for (const sp of FISH_SPECIES) {
      if (especeRetenue(sp, c)) lignes.push({ kind: 'poisson', weight: sp.weight, species: sp })
    }
  }
  for (const tr of TROUVAILLES) {
    if (tr.eaux.includes(c.nature)) lignes.push({ kind: 'trouvaille', weight: tr.weight, trouvaille: tr })
  }
  let total = 0
  for (const l of lignes) total += l.weight
  return { lignes, total }
}

/**
 * LE TIRAGE CUMULATIF (T7) — `value` est le flottant de `rngRoll`, et il ne sert qu'ici, à une
 * comparaison. La table n'est jamais vide (le « rien » y est toujours), donc il y a toujours
 * une ligne à rendre : pas de branche « table vide » à tester, donc pas de branche à oublier.
 */
export function tirerLigne(table: TableDePrises, value: number): LignePrise {
  let tirage = Math.floor(value * table.total)
  for (const l of table.lignes) {
    if (tirage < l.weight) return l
    tirage -= l.weight
  }
  return table.lignes[table.lignes.length - 1]!
}

/** Les conditions d'une tuile, ici et maintenant — `null` si cette eau ne se pêche pas. */
export function conditionsAt(state: SimState, tx: number, ty: number, surCoin: boolean, niveauConnu?: number): Conditions | null {
  const nature = natureDeLEau(state, tx, ty, niveauConnu)
  if (nature === null) return null
  return {
    nature,
    zone: zoneSlugAt(state.map, tx, ty),
    saison: phaseForDay(jourDeSaison(state)),
    creneau: creneauAt(state),
    surCoin,
  }
}
