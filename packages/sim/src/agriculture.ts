/**
 * L'AGRICULTURE — le potager (voie A, spec `agriculture.md`).
 *
 * La pousse est une FONCTION PURE du tick sur l'état PAR PARCELLE (`Structure.plantedAt`) :
 * AUCUNE entité spawnée, AUCUN tirage au PRNG seedé. C'est le garde-fou déterministe — le
 * flux RNG n'est jamais touché (mémoire projet : « RNG fragile au décompte d'entités »). Le
 * rendu client lit le MÊME `cropStage` : une seule source de la maturité.
 */
import { AGRICULTURE, phaseOf } from './balance'
import { emitEvent } from './events'
import { gelMortel } from './gel'
import type { ItemId, StructureType } from './items'
import type { SimState } from './sim'
import { actForDay, TICKS_PER_CYCLE } from './time'

/** Le minimum dont dépend la maturité : le tick de mise en terre (parcelle vide = absent). La
 *  `Structure` du /sim ET l'`AimStructure` du client le satisfont — une seule source du calcul. */
interface Plot {
  plantedAt?: number
  /** LA CULTURE en terre (S16) — absente sur une parcelle d'avant la refonte des saisons :
   *  on la lit alors comme la culture d'hiver, celle qui existait seule. */
  culture?: CultureId
}

/** Les quatre cultures, une par saison (spec `saisons.md` S16). */
export type CultureId = keyof typeof AGRICULTURE.CULTURES

/** La culture qu'une graine met en terre — `null` si l'objet n'est pas une graine. */
export function cultureDeLaGraine(item: ItemId): CultureId | null {
  for (const [id, def] of Object.entries(AGRICULTURE.CULTURES) as [CultureId, { graine: string }][]) {
    if (def.graine === item) return id
  }
  return null
}

/** La culture d'une parcelle — celle d'hiver par défaut (une parcelle d'avant S16). */
export function cultureDe(plot: Plot): CultureId {
  return plot.culture ?? 'hiver'
}

/** Le temps de pousse d'une culture, en ticks. */
export function pousseDe(culture: CultureId): number {
  return Math.round(AGRICULTURE.CULTURES[culture].pousse * TICKS_PER_CYCLE)
}

/**
 * S16 — LA FENÊTRE DE SEMIS EST-ELLE OUVERTE ? Chaque graine ne germe que dans SA saison ;
 * **la serre (et le terroir) affranchissent de la fenêtre**, et c'est enfin ce qui les
 * justifie. Hors fenêtre, la graine n'est pas consommée : elle attend son heure.
 */
export function fenetreOuverte(culture: CultureId, jour: number, type: StructureType): boolean {
  if (type !== 'parcelle') return true // sous verre, la saison n'a plus cours
  return phaseOf(actForDay(jour)) === AGRICULTURE.CULTURES[culture].phase
}

/**
 * LA CULTURE EST-ELLE ADMISE ICI ? (`agriculture.md` J2) — la compatibilité de la BRAISE est
 * totale, dans les deux sens : elle ne germe QUE dans la parcelle de suie, et la suie
 * n'accepte QU'elle. Un axe d'échange de monde, pas un filtre de plus — le patron de la
 * table de pêche souillée (R26b). Les autres cultures gardent leur liberté d'avant.
 */
export function cultureAdmise(culture: CultureId, type: StructureType): boolean {
  return (culture === 'braise') === (type === 'parcelle_de_suie')
}

/** Les structures où l'on CULTIVE (agriculture) : parcelle (plein air) → serre (hiver) → terroir
 *  (le meilleur palier). Une seule source du « c'est un potager » — /sim, aim client, rendu. */
const PLOT_TYPES: readonly StructureType[] = ['parcelle', 'serre', 'terroir', 'parcelle_de_suie']
export function isPlot(type: StructureType): boolean {
  return PLOT_TYPES.includes(type)
}

/**
 * Le stade de pousse d'une parcelle, dans [0, 1] : 0 ≈ à peine semée, 1 = mûre. Une parcelle
 * VIDE (jamais semée) rend -1 (« rien à montrer »). Purement arithmétique, déterministe.
 */
export function cropStage(plot: Plot, tick: number): number {
  if (plot.plantedAt === undefined) return -1
  return Math.min(1, (tick - plot.plantedAt) / pousseDe(cultureDe(plot)))
}

/** Une parcelle est-elle MÛRE (récoltable) ? Pur — le seul juge de « on peut récolter ». */
export function isCropMature(plot: Plot, tick: number): boolean {
  return plot.plantedAt !== undefined && tick - plot.plantedAt >= pousseDe(cultureDe(plot))
}

/**
 * F5 — LE GEL TUE LA CULTURE À CIEL OUVERT (spec `flore-froid.md`, décision d'Alexis
 * 2026-08-19). Une passe de tick, appelée par `step()`.
 *
 * ═══ C'EST LE SEUL ENDROIT OÙ LE FROID DÉTRUIT ═══
 *
 * Le sauvage SUSPEND — un buisson gelé attend, il ne meurt pas (F6) : une saison de 60 jours
 * ne doit pas laisser un monde nu à qui l'a traversée. Le cultivé, lui, PAIE : la graine est
 * perdue, et c'est ce qui donne enfin son prix à la serre. Ça renverse une décision écrite
 * (`agriculture.md` R7 disait « pas de suivi la culture meurt, déterministe et simple ») —
 * renversement acté, consigné dans `docs/decisions.md`.
 *
 * ═══ CE QUI MEURT, ET QUAND ═══
 *
 * La `parcelle` SEULE : `serre` et `terroir` sont hivernales par leur TYPE (R7/R8), et le
 * champ thermique ne les regarde jamais. Et il faut le gel MORTEL (`FLORE.SEUIL_MORTEL`),
 * pas le simple gel : l'acte I ne tue jamais (aucun blizzard n'y est tiré), l'acte II tue
 * sous un blizzard de jour comme de nuit et sous une neige de nuit, l'acte III tue chaque
 * nuit. Le potager de plein air devient un pari, puis n'est plus jouable.
 *
 * ═══ PAS DE COURT-CIRCUIT, ET C'EST RAISONNÉ ═══
 *
 * Une borne O(1) sur « le point le plus doux de la vallée » ne PROUVERAIT rien ici : elle
 * devrait majorer le biome, or le Glacier est à −75 et rien n'interdit d'y bâtir. Le
 * balayage se paie donc en entier — une lecture de propriété par structure —, et seules les
 * rares parcelles SEMÉES vont jusqu'au champ thermique. C'est l'ordre des deux gardes qui
 * fait le coût, pas une borne.
 */
export function advanceCultures(state: SimState): void {
  for (const s of state.structures) {
    if (s.plantedAt === undefined) continue
    if (s.type !== 'parcelle') continue
    if (!gelMortel(state, s.tx, s.ty)) continue
    delete s.plantedAt
    delete s.culture
    emitEvent(state, { type: 'crop_frozen', tick: state.tick, structureId: s.id })
  }
}
