/**
 * ═══ A39-A40 — LE BÛCHER RITUEL (spec `cendre.md` R31) ═══
 *
 * Le banc joue la VRAIE carte (les charniers, les foyers, le champ de coût sont
 * géographiques) et traverse le VRAI tick pour le brûlage : le rituel vit dans l'espace entre
 * `advanceLieuxBrules` et `avancerLaCendre` — « une phase seule n'est pas un tick ».
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, MORTS } from './balance'
import { foyersDeLaCarte, tuileCendree } from './cendre'
import { die } from './combat'
import { drainEvents } from './events'
import { addItems } from './items'
import { spawnMonster } from './monsters'
import { advanceBuchers, BUCHER, tenterLeRituel } from './bucher'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { calendarScaleForSeasonCycles } from './time'
import { addStructure } from './village'
import { fireZoneInventory } from './fire'
import { LUNAISON_JOURS } from './nuit'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026
const monde = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

/** Le banc : la vraie carte, la cendre âgée (les fosses ont un territoire à rendre), MIDI
 *  (le brûlage est un geste de jour). */
function banc(): { sim: SimState; zone: number; cx: number; cy: number; foyer: number } {
  const sim = createSim(SEED, {
    map: monde.map, faunaCap: 0, worldEvents: false, meteoActive: false,
    calendarScale: SCALE, jourDeDepart: 100,
  })
  sim.cendreAge = foyersDeLaCarte(sim.map).map(() => 30)
  const zone = sim.map.zones.findIndex((z) => z.kind === 'charnier')
  const z = sim.map.zones[zone]!
  const foyer = foyersDeLaCarte(sim.map).findIndex((f) => f.zone === zone)
  drainEvents(sim)
  return { sim, zone, cx: Math.floor(z.x + z.w / 2), cy: Math.floor(z.y + z.h / 2), foyer }
}

/** N cadavres de Cendreux, tombés PAR une vraie mort au point demandé. */
function rendre(sim: SimState, x: number, y: number, n: number): void {
  for (let k = 0; k < n; k++) {
    const id = spawnMonster(sim, 'cendreux', x + 0.5, y + 0.5)
    sim.tick += 1
    die(sim, sim.entities.find((e) => e.id === id)!, 0)
  }
}

describe('A39 — la fosse compte ses morts', () => {
  it('un Cendreux à portée est consumé et compté ; une bête, jamais ; trop loin, jamais', () => {
    const b = banc()
    rendre(b.sim, b.cx, b.cy, 3)
    // …et un CERF mort au même endroit, le témoin : la fosse ne mange que ses morts.
    const cerf = spawnMonster(b.sim, 'deer', b.cx + 0.5, b.cy + 0.5)
    b.sim.tick += 1
    die(b.sim, b.sim.entities.find((e) => e.id === cerf)!, 1)
    // …et un Cendreux HORS rayon.
    rendre(b.sim, b.cx + MORTS.BRULE_RAYON + 4, b.cy, 1)
    b.sim.tick += 20 - (b.sim.tick % 20) // la cadence de la passe
    advanceBuchers(b.sim)
    const rendus = drainEvents(b.sim).filter((e) => e.type === 'cadavre_rendu')
    expect(rendus).toHaveLength(3)
    expect(b.sim.buchers.find((q) => q.zone === b.zone)?.rendus).toBe(3)
    expect(b.sim.corpses.some((c) => c.cendreux === true), 'le lointain reste — les 3 proches sont consumés').toBe(true)
    expect(b.sim.corpses.filter((c) => c.cendreux === true)).toHaveLength(1)
    expect(b.sim.corpses.some((c) => c.carcass !== undefined), 'la carcasse du cerf est intacte').toBe(true)
  })
})

describe('A40 — le rituel recule, borné et cadencé', () => {
  it('fosse nourrie + brûlage R16 = le recul, mesuré en TUILES rendues ; puis la lune verrouille', () => {
    const b = banc()
    // LA PRÉMISSE : une tuile cendrée à la frange du foyer nourri, qui doit REDEVENIR saine.
    // On la cherche sur la vraie carte — juste dedans à l'âge 30, dehors à l'âge 27.
    b.sim.buchers.push({ zone: b.zone, rendus: BUCHER.CADAVRES, dernierRituelJour: -LUNAISON_JOURS })
    let temoin: { tx: number; ty: number } | null = null
    for (let r = 5; r < 60 && !temoin; r++) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) {
        const tx = b.cx + dx
        const ty = b.cy + dy
        if (!tuileCendree(b.sim, tx, ty)) continue
        const age = [...b.sim.cendreAge]
        b.sim.cendreAge[b.foyer] = 30 - BUCHER.JOURS_RENDUS
        const encore = tuileCendree(b.sim, tx, ty)
        b.sim.cendreAge = age
        if (!encore) { temoin = { tx, ty }; break }
      }
    }
    expect(temoin, 'une tuile de frange sensible au recul — la prémisse').not.toBeNull()
    // LE BRÛLAGE, PAR LE VRAI TICK : un feu de camp allumé au bord de la fosse, de jour.
    const id = spawnEntity(b.sim, b.cx + 1.5, b.cy + 0.5)
    const feu = addStructure(b.sim, 'fire', b.cx + 1, b.cy, 0, id)
    addItems(fireZoneInventory(feu, 'fuel')!, { wood: 3 })
    b.sim.tick += 20 - (b.sim.tick % 20)
    step(b.sim, [{ entityId: id, dx: 0, dy: 0 }])
    const evs = drainEvents(b.sim)
    expect(evs.some((e) => e.type === 'charnier_brule'), 'le brûlage R16 a pris').toBe(true)
    expect(evs.some((e) => e.type === 'bucher_rituel'), 'et le rituel avec lui').toBe(true)
    expect(b.sim.cendreAge[b.foyer], 'l’âge a reculé').toBe(30 - BUCHER.JOURS_RENDUS)
    expect(tuileCendree(b.sim, temoin!.tx, temoin!.ty), 'la tuile témoin est REDEVENUE saine').toBe(false)
    expect(b.sim.buchers.find((q) => q.zone === b.zone)?.rendus, 'les rendus sont consumés').toBe(0)
    // LA LUNE VERROUILLE : renourrie le jour même, la fosse ne recule plus.
    b.sim.buchers.find((q) => q.zone === b.zone)!.rendus = BUCHER.CADAVRES
    tenterLeRituel(b.sim, b.zone, b.foyer, b.cx, b.cy)
    expect(b.sim.cendreAge[b.foyer], 'pas deux reculs dans la même lune').toBe(30 - BUCHER.JOURS_RENDUS)
  })

  it('fosse affamée : le brûlage garde son effet normal, sans recul ; et le plancher tient', () => {
    const b = banc()
    b.sim.buchers.push({ zone: b.zone, rendus: BUCHER.CADAVRES - 1, dernierRituelJour: -LUNAISON_JOURS })
    tenterLeRituel(b.sim, b.zone, b.foyer, b.cx, b.cy)
    expect(b.sim.cendreAge[b.foyer], 'affamée : rien').toBe(30)
    // LE PLANCHER : un foyer tout jeune ne descend jamais sous 0 — la tache R0 est éternelle.
    b.sim.cendreAge[b.foyer] = 1
    b.sim.buchers.find((q) => q.zone === b.zone)!.rendus = BUCHER.CADAVRES
    tenterLeRituel(b.sim, b.zone, b.foyer, b.cx, b.cy)
    expect(b.sim.cendreAge[b.foyer]).toBe(0)
  })
})
