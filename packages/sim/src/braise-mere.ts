/**
 * ═══ LA BRAISE-MÈRE (spec `cendre.md` R28, chantier ④ des dix — 2026-08-30) ═══
 *
 * La parade qui se nourrit : posée près d'une frange, gavée de CHARBON, elle tient le foyer de
 * cendre de sa cellule — un R16 permanent, payé au poids au lieu du rituel quotidien. R3ter au
 * mot : elle repousse le SEUIL (l'âge du foyer ne monte pas), jamais le CLIMAT.
 *
 * ZÉRO octet d'état cendre (R28c) : le combustible vit dans la structure (`s.fuel`, le patron
 * du feu libre), la consommation s'ancre sur `s.burnAt` (le patron de la bûche), et la bascule
 * de jour DÉRIVE l'ensemble des foyers tenus en balayant les structures. Éteinte, la cendre
 * reprend SA marche — sans rattrapage : le temps gagné est acquis, comme R16.
 *
 * Le réglage vit dans `BRAISE_MERE` ci-dessous : il se calibre en JOUANT (combien coûte tenir
 * un foyer), c'est donc une affaire de `balance.ts`… mais le bloc reste ici, à côté de sa loi,
 * le temps du calibrage — comme `FUMEROLLE` et `MURMURE` (cinq nombres, une maison).
 */
import { BALANCE } from './balance'
import { foyerDeLaTuile } from './cendre'
import { countOf } from './items'
import type { SimState } from './sim'
import type { Structure } from './village'

export const BRAISE_MERE = {
  /** Combien de temps UN charbon tient la braise — ~8-12 charbons par jour de jeu (30 min
   *  réelles) : tenir UN foyer est un métier de village, tenir les neuf est hors de portée. */
  TICKS_PAR_CHARBON: Math.round(200 * BALANCE.TICK_RATE_HZ),
  /** La part des Cendreux tués au-delà de la croûte qui laissent un cœur (R29a) — par
   *  hachage, jamais au PRNG : la doctrine du butin. */
  PART_COEUR: 1 / 3,
} as const

/** ARDENTE ? Du charbon en soute, ou l'unité en cours pas encore consumée (`burnAt` ancré). */
export function braiseMereArdente(tick: number, s: Structure): boolean {
  if (s.type !== 'braise_mere') return false
  if (s.fuel !== undefined && countOf(s.fuel, 'charcoal') > 0) return true
  return s.burnAt !== undefined && tick - s.burnAt < BRAISE_MERE.TICKS_PAR_CHARBON
}

/** Le temps que la soute fait tenir (l'affichage du panneau) — le jumeau de
 *  `fuelTicksRemaining`, en charbon : l'unité en cours + celles qui attendent. */
export function braiseFuelTicksRemaining(tick: number, s: Structure): number {
  const charbon = s.fuel ? countOf(s.fuel, 'charcoal') : 0
  if (s.burnAt === undefined) return charbon * BRAISE_MERE.TICKS_PAR_CHARBON
  return Math.max(0, charbon * BRAISE_MERE.TICKS_PAR_CHARBON - (tick - s.burnAt))
}

/** La progression de l'unité EN COURS (0..1) — l'indicateur du slot, comme la bûche. */
export function braiseBurnProgress(tick: number, s: Structure): number {
  if (s.burnAt === undefined) return 0
  return Math.max(0, Math.min(1, (tick - s.burnAt) / BRAISE_MERE.TICKS_PAR_CHARBON))
}

/**
 * LA CONSOMMATION AU TICK (A35) — le patron de la bûche du feu libre : `burnAt` ancre l'unité
 * en cours ; à échéance elle est consumée et la suivante s'engage. Sans charbon, `burnAt`
 * expire tout seul — l'extinction est un silence, pas un événement (le jour suivant lit
 * simplement « plus ardente », R28b).
 */
export function advanceBraiseMeres(state: SimState): void {
  for (const s of state.structures) {
    if (s.type !== 'braise_mere') continue
    const charbon = s.fuel !== undefined ? countOf(s.fuel, 'charcoal') : 0
    if (s.burnAt === undefined) {
      // Rien n'est engagé : la première unité s'engage dès qu'il y a du charbon.
      if (charbon > 0) s.burnAt = state.tick
      continue
    }
    if (state.tick - s.burnAt < BRAISE_MERE.TICKS_PAR_CHARBON) continue
    // L'unité en cours est consumée — on la retire de la soute, la suivante s'engage.
    if (charbon > 0 && s.fuel) {
      const i = s.fuel.findIndex((c) => c !== null && c.item === 'charcoal' && c.count > 0)
      if (i >= 0) {
        const c = s.fuel[i]!
        c.count -= 1
        if (c.count <= 0) s.fuel[i] = null
      }
      if (charbon > 1) s.burnAt = s.burnAt + BRAISE_MERE.TICKS_PAR_CHARBON
      else delete s.burnAt
    } else {
      delete s.burnAt
    }
  }
}

/**
 * LES FOYERS TENUS À CET INSTANT (R28b) — dérivé d'un balayage des structures, appelé UNE fois
 * par bascule de jour par `sim.ts`, à côté du gel des fosses brûlées R16. Idempotent par
 * construction : deux braises-mères sur la même cellule tiennent le même foyer.
 */
export function foyersTenusParBraise(state: SimState): Set<number> {
  const tenus = new Set<number>()
  if (!state.map.cendreCout) return tenus
  for (const s of state.structures) {
    if (s.type !== 'braise_mere') continue
    if (!braiseMereArdente(state.tick, s)) continue
    const foyer = foyerDeLaTuile(state.map, s.tx, s.ty)
    if (foyer >= 0) tenus.add(foyer)
  }
  return tenus
}
