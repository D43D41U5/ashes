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
