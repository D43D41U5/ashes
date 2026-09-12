/**
 * D1 — LES ÉVÉNEMENTS D'EAU : la vallée, au jour, sans le gel (décision d'Alexis, 2026-09-12).
 *
 * Le niveau d'eau est GLOBAL (aucun terme positionnel : `eau.ts`), donc ces gardes tournent
 * sur une carte vide — la loi ne lit que le tick, l'échelle et le jour de départ, et une
 * carte de production n'y ajouterait que sept secondes. L'horloge est celle de la Veillée
 * (un cycle = un jour de saison), la météo ARMÉE comme dans `veillee.ts` : c'est le régime
 * où la mémoire de pluie compte.
 *
 * Les jours ne sont jamais écrits en dur : on les CHERCHE dans la loi (`jourDeSecheresse`,
 * `jourDeCrue`, doctrine d'`eau-rendu.test.ts`), et on franchit un jour en se posant à son
 * dernier tick puis en faisant UN pas de la vraie sim — `advanceTime` franchit, `advanceEau`
 * relit. L'éclaireur a mesuré, graine 2026 : l'assec bascule j158↑ j160↓ j276↑ j297↓, la crue
 * à l'an 11 (j1201, gués fermés jusqu'au j1223), et RIEN sur la saison jouée (j61 → j120).
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS, YEAR_DAYS } from './balance'
import { CHRONICLE_EVENT_TYPES, chronicleFromEvents } from './chronicle'
import { regimeDEauDuJour, type RegimeDEau } from './eau-evenements'
import { drainEvents, type SimEvent } from './events'
import { createEmptyMap } from './map'
import { modificateurDuJour } from './modificateur'
import { createSim, step, type SimState } from './sim'
import { jourDeSaison, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

type FaitDEau = Extract<SimEvent, { type: `eau_${string}` | `crue_${string}` | `gues_${string}` }>
const TYPES_DEAU: ReadonlySet<SimEvent['type']> = new Set<SimEvent['type']>([
  'eau_a_sec', 'eau_revenue', 'crue_montee', 'crue_retiree', 'gues_fermes', 'gues_rouverts',
])
const estFaitDEau = (e: SimEvent): e is FaitDEau => TYPES_DEAU.has(e.type)

/** L'horloge de la Veillée : un cycle réel = un jour de saison. */
const ECHELLE = TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE

function monde(jourDeDepart: number): SimState {
  return createSim(2026, {
    map: createEmptyMap(24, 24, TERRAIN_GRASS),
    calendarScale: ECHELLE,
    jourDeDepart,
    finDeSaison: null,
    meteoActive: true,
  })
}

/** Le tick du premier instant du jour de saison `jour`. */
function tickDuJour(sim: SimState, jour: number): number {
  return Math.max(0, Math.round(((jour - sim.jourDeDepart) * TICKS_PER_SEASON_DAY) / sim.calendarScale))
}

/** Les trois verdicts de la LOI au jour `jour` — sans toucher à la mémoire de la sim. */
function regimeAuJour(sim: SimState, jour: number): RegimeDEau {
  const tick = sim.tick
  sim.tick = tickDuJour(sim, jour)
  const r = regimeDEauDuJour(sim)
  sim.tick = tick
  return r
}

/** Le premier jour ≥ `depuis` (borne : un an) où `verdict` rend `attendu`. */
function premierJour(sim: SimState, depuis: number, verdict: (r: RegimeDEau) => boolean, attendu: boolean, quoi: string): number {
  for (let j = depuis; j < depuis + YEAR_DAYS; j++) if (verdict(regimeAuJour(sim, j)) === attendu) return j
  throw new Error(`${quoi} : aucun jour en un an depuis le ${depuis} — la loi est cassée`)
}

/** LE PREMIER JOUR OÙ LA CRUE EST TIRÉE (S18 : à l'Éclosion seulement — on balaie des années). */
function jourDeCrue(depuis: number): number {
  for (let j = depuis; j < depuis + YEAR_DAYS * 40; j++) if (modificateurDuJour(j) === 'crue') return j
  throw new Error('la Crue n’est jamais tirée en quarante ans — l’élection est cassée')
}

/** Se poser au DERNIER tick du jour `jour − 1`, faire un pas : la sim franchit `jour`. Rend
 *  les faits d'eau de ce pas — et de lui seul. */
function franchir(sim: SimState, jour: number): FaitDEau[] {
  sim.tick = tickDuJour(sim, jour) - 1
  expect(jourDeSaison(sim), 'le tick de départ est la veille').toBe(jour - 1)
  drainEvents(sim)
  step(sim, [])
  expect(jourDeSaison(sim), 'un pas franchit le jour').toBe(jour)
  return drainEvents(sim).filter(estFaitDEau)
}

/** Le premier pas du monde : la mémoire s'initialise, sans un mot. */
function naitre(sim: SimState): FaitDEau[] {
  drainEvents(sim)
  step(sim, [])
  return drainEvents(sim).filter(estFaitDEau)
}

describe('D1 — l’assec est un fait de vallée, dit une fois par bascule', () => {
  it('LA MARE QUI PART : un seul `eau_a_sec` le jour où la loi bascule, un seul `eau_revenue` quand elle revient', () => {
    const sim = monde(BALANCE.JOUR_DE_DEPART)
    expect(naitre(sim), 'naître ne raconte rien').toEqual([])
    expect(sim.regimeDEau, 'la mémoire est posée au premier pas').toBeDefined()
    expect(sim.regimeDEau!.jour).toBe(BALANCE.JOUR_DE_DEPART)
    expect(sim.regimeDEau!.aSec, 'prémisse : le monde n’ouvre pas à sec (S2)').toBe(false)

    const jSec = premierJour(sim, BALANCE.JOUR_DE_DEPART + 1, r => r.aSec, true, 'l’assec')
    // La veille : un jour franchi sans bascule ne dit rien — mais la mémoire suit.
    expect(franchir(sim, jSec - 1)).toEqual([])
    expect(sim.regimeDEau!.jour).toBe(jSec - 1)
    // Le jour : UN fait, daté.
    const bascule = franchir(sim, jSec)
    expect(bascule.map(e => e.type)).toEqual(['eau_a_sec'])
    expect(bascule[0]!.day).toBe(jSec)
    expect(sim.regimeDEau!.aSec).toBe(true)
    // Le reste du jour : rien — le verdict est constant dans le jour, on ne relit pas au tick.
    drainEvents(sim)
    for (let k = 0; k < 20; k++) step(sim, [])
    expect(drainEvents(sim).filter(estFaitDEau)).toEqual([])

    // Le retour : un seul fait, le jour où la loi (hystérésis comprise) rend l'eau.
    const jRetour = premierJour(sim, jSec + 1, r => r.aSec, false, 'le retour de l’eau')
    const dits: FaitDEau[] = []
    for (let j = jSec + 1; j <= jRetour; j++) dits.push(...franchir(sim, j))
    expect(dits.map(e => [e.type, e.day])).toEqual([['eau_revenue', jRetour]])
  })

  it('LA SAISON JOUÉE EST MUETTE, l’année parle peu : zéro fait d’eau de j61 à j120, une poignée sur 240 jours (MESURÉ : 4)', () => {
    const sim = monde(BALANCE.JOUR_DE_DEPART)
    naitre(sim)
    const parJour: Array<[number, string]> = []
    for (let j = BALANCE.JOUR_DE_DEPART + 1; j <= BALANCE.JOUR_DE_DEPART + 240; j++) {
      for (const e of franchir(sim, j)) parJour.push([j, e.type])
    }
    const saison = parJour.filter(([j]) => j <= BALANCE.JOUR_DE_DEPART + BALANCE.SEASON_DAYS - 1)
    expect(saison, 'la saison jouée n’a aucun fait d’eau').toEqual([])
    expect(parJour.length, 'l’assec bascule au moins une fois en 240 jours (l’Ardeur)').toBeGreaterThanOrEqual(2)
    expect(parJour.length, 'rare — sinon c’est du bruit, pas un fait').toBeLessThanOrEqual(8)
    // Les faits alternent : on ne sèche pas deux fois sans revenir entre-temps.
    for (let k = 1; k < parJour.length; k++) expect(parJour[k]![1]).not.toBe(parJour[k - 1]![1])
  })
})

describe('D1 — la crue monte et ferme les gués, puis rend dans l’ordre', () => {
  it('le jour de la Crue : `crue_montee` ET `gues_fermes` ; puis `gues_rouverts` avant (ou avec) `crue_retiree`', () => {
    const jCrue = jourDeCrue(BALANCE.JOUR_DE_DEPART)
    const sim = monde(jCrue - 1)
    expect(naitre(sim)).toEqual([])
    expect(sim.regimeDEau!.crue, 'prémisse : la veille de la Crue est sèche').toBe(false)
    expect(sim.regimeDEau!.guesFermes).toBe(false)

    const montee = franchir(sim, jCrue)
    expect(montee.map(e => e.type).sort()).toEqual(['crue_montee', 'gues_fermes'])
    for (const e of montee) expect(e.day).toBe(jCrue)

    const jGues = premierJour(sim, jCrue + 1, r => r.guesFermes, false, 'la réouverture des gués')
    const jRetrait = premierJour(sim, jCrue + 1, r => r.crue, false, 'le retrait de la crue')
    expect(jGues, 'les gués (seuil 0,3) rouvrent avant que la crue (> 0) ne soit partie').toBeLessThanOrEqual(jRetrait)
    const dits: Array<[string, number]> = []
    for (let j = jCrue + 1; j <= jRetrait; j++) for (const e of franchir(sim, j)) dits.push([e.type, e.day])
    expect(dits).toEqual([['gues_rouverts', jGues], ['crue_retiree', jRetrait]])
  })
})

describe('D1 — la mémoire est additive, la chronique dit les six', () => {
  it('UNE SAUVEGARDE D’AVANT D1 reprise en plein assec ne « sèche » pas : elle prend l’état tel quel, et ne raconte que la bascule suivante', () => {
    const sim = monde(BALANCE.JOUR_DE_DEPART)
    const jSec = premierJour(sim, BALANCE.JOUR_DE_DEPART + 1, r => r.aSec, true, 'l’assec')
    expect(sim.regimeDEau, 'prémisse : aucune mémoire avant le premier pas').toBeUndefined()
    // On se pose EN PLEIN assec avant tout pas — comme une sauvegarde d'avant D1 rechargée là.
    sim.tick = tickDuJour(sim, jSec) + 5
    expect(naitre(sim), 'le premier pas n’invente pas un assèchement').toEqual([])
    expect(sim.regimeDEau!.aSec).toBe(true)
    expect(sim.regimeDEau!.jour).toBe(jSec)
    const jRetour = premierJour(sim, jSec + 1, r => r.aSec, false, 'le retour de l’eau')
    expect(franchir(sim, jRetour).map(e => e.type)).toEqual(['eau_revenue'])
  })

  it('les six types sont retenus par la chronique, l’entrée d’un régime est un battement, sa sortie un récit', () => {
    for (const t of TYPES_DEAU) expect(CHRONICLE_EVENT_TYPES.has(t), `${t} est dans la liste retenue`).toBe(true)
    const map = createEmptyMap(8, 8, TERRAIN_GRASS)
    const j = BALANCE.JOUR_DE_DEPART
    const tick = (jour: number): number => Math.round(((jour - j) * TICKS_PER_SEASON_DAY) / ECHELLE)
    const events: SimEvent[] = [
      { type: 'eau_a_sec', tick: tick(j + 97), day: j + 97 },
      { type: 'eau_revenue', tick: tick(j + 99), day: j + 99 },
      { type: 'crue_montee', tick: tick(j + 1140), day: j + 1140 },
      { type: 'gues_fermes', tick: tick(j + 1140), day: j + 1140 },
      { type: 'gues_rouverts', tick: tick(j + 1162), day: j + 1162 },
      { type: 'crue_retiree', tick: tick(j + 1166), day: j + 1166 },
    ]
    const lignes = chronicleFromEvents(events, ECHELLE, j, {}, map)
    expect(lignes.map(l => l.weight)).toEqual(['battement', 'recit', 'battement', 'battement', 'recit', 'recit'])
    expect(lignes.map(l => l.day)).toEqual([j + 97, j + 99, j + 1140, j + 1140, j + 1162, j + 1166])
    expect(lignes[0]!.text).toMatch(/à sec/)
    expect(lignes[2]!.text).toMatch(/crue/i)
    expect(lignes[3]!.text).toMatch(/gués/)
    // Aucune ligne ne parle d'un LIEU : la vallée entière bascule, la fiche d'un lieu n'en veut pas.
    for (const l of lignes) expect(l.lieu).toBeUndefined()
  })
})
