/**
 * ═══ A37-A38 — LES BÊTES CENDREUSES (spec `cendre.md` R30) ═══
 *
 * Le banc joue la VRAIE carte, cendre mûrie : la profondeur, la lisière et les bandes sont
 * géographiques — une carte peinte à la main ne dirait rien de la frontière à double sens.
 */
import { describe, expect, it } from 'vitest'
import { CENDREUSE, FAUNA, TERRAIN_GRASS } from './balance'
import { profondeurNueDeCendre } from './cendre'
import { foyersDeLaCarte } from './cendre'
import { advanceCendreux } from './cendreux'
import { die } from './combat'
import { drainEvents } from './events'
import { morsureDeLaCendre } from './faune'
import { addItems, countOf } from './items'
import { moveToward, spawnMonster } from './monsters'
import { fireZoneInventory } from './fire'
import { createSim, spawnEntity, type SimState } from './sim'
import { addStructure } from './village'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026
const monde = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)

function banc(): SimState {
  const sim = createSim(SEED, { map: monde.map, faunaCap: 0, worldEvents: false, meteoActive: false })
  sim.cendreAge = foyersDeLaCarte(sim.map).map(() => 120)
  drainEvents(sim)
  return sim
}

/** Une tuile PROFONDE (au-delà de la frange — là où la morsure mord), et une tuile de
 *  LISIÈRE : cendrée, avec une voisine orthogonale saine (la frontière se teste là). */
function tuiles(sim: SimState): { fond: { tx: number; ty: number }; lisiere: { tx: number; ty: number; sx: number; sy: number } } {
  let fond: { tx: number; ty: number } | null = null
  let lisiere: { tx: number; ty: number; sx: number; sy: number } | null = null
  for (let ty = 20; ty < sim.map.height - 20 && (!fond || !lisiere); ty += 3) {
    for (let tx = 20; tx < sim.map.width - 20 && (!fond || !lisiere); tx += 3) {
      const p = profondeurNueDeCendre(sim, tx, ty)
      if (p > 20 && !fond && sim.map.terrain[ty * sim.map.width + tx] === TERRAIN_GRASS) fond = { tx, ty }
      if (p >= 0 && !lisiere) {
        for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (profondeurNueDeCendre(sim, tx + sx, ty + sy) < 0) { lisiere = { tx, ty, sx, sy }; break }
        }
      }
    }
  }
  if (!fond || !lisiere) throw new Error('fond ou lisière introuvable — la prémisse du banc est morte')
  return { fond, lisiere }
}

describe('A37 — la conversion est un hachage plafonné et veillé', () => {
  it('des morts par cendre en série : une part se relève — la même sur deux sims', () => {
    const leve = (sim: SimState): boolean[] => {
      const { fond } = tuiles(sim)
      const out: boolean[] = []
      for (let n = 0; n < 24; n++) {
        const id = spawnMonster(sim, 'deer', fond.tx + 0.5, fond.ty + 0.5)
        const e = sim.entities.find((x) => x.id === id)!
        sim.tick += 1
        die(sim, e, 0, 'cendre')
        const c = sim.corpses[sim.corpses.length - 1]!
        out.push(c.bete === 'deer' && c.risesAt !== undefined)
      }
      return out
    }
    const sim = banc()
    const a = leve(sim)
    expect(a.some(Boolean), 'certaines se relèveront').toBe(true)
    expect(a.some((v) => !v), 'pas toutes').toBe(true)
    expect(leve(banc()), 'même seed → mêmes levées').toEqual(a)
  })

  it('la levée traverse advanceCendreux : la bête revient CENDREUSE, le cadavre est REPRIS', () => {
    const sim = banc()
    const { fond } = tuiles(sim)
    for (let n = 0; n < 24 && !sim.corpses.some((c) => c.bete !== undefined); n++) {
      const id = spawnMonster(sim, 'deer', fond.tx + 0.5, fond.ty + 0.5)
      sim.tick += 1
      die(sim, sim.entities.find((x) => x.id === id)!, 0, 'cendre')
    }
    const marque = sim.corpses.find((c) => c.bete !== undefined)!
    expect(marque, 'un cadavre marqué existe — la prémisse').toBeDefined()
    sim.tick = marque.risesAt!
    advanceCendreux(sim)
    const levee = sim.monsters.find((m) => m.cendreuse === true)
    expect(levee, 'la bête s’est relevée').toBeDefined()
    expect(levee!.type).toBe('deer')
    expect(sim.corpses.some((c) => c.id === marque.id), 'le cadavre est repris — viande comprise').toBe(false)
  })

  it('un FEU actif à portée veille le cadavre marqué : la levée est annulée', () => {
    const sim = banc()
    const { fond } = tuiles(sim)
    let marque
    for (let n = 0; n < 24 && !marque; n++) {
      const id = spawnMonster(sim, 'deer', fond.tx + 0.5, fond.ty + 0.5)
      sim.tick += 1
      die(sim, sim.entities.find((x) => x.id === id)!, 0, 'cendre')
      marque = sim.corpses.find((c) => c.bete !== undefined)
    }
    expect(marque, 'un cadavre marqué — la prémisse').toBeDefined()
    const veilleur = spawnEntity(sim, fond.tx + 2.5, fond.ty + 0.5)
    const feu = addStructure(sim, 'fire', fond.tx + 1, fond.ty, 0, veilleur)
    addItems(fireZoneInventory(feu, 'fuel')!, { wood: 3 })
    sim.tick = marque!.risesAt!
    advanceCendreux(sim)
    expect(sim.monsters.some((m) => m.cendreuse === true), 'rien ne s’est levé').toBe(false)
    expect(marque!.bete, 'la marque est rendue — le cadavre redevient un cadavre').toBeUndefined()
    expect(sim.corpses.some((c) => c.id === marque!.id), 'et il est toujours là, à dépecer').toBe(true)
  })

  it('une mort PAR ARME ne convertit jamais ; le plafond et le feu tiennent la porte', () => {
    const sim = banc()
    const { fond } = tuiles(sim)
    // L'ARME : cause absente → jamais de marque, quel que soit le hachage (24 essais).
    for (let n = 0; n < 24; n++) {
      const id = spawnMonster(sim, 'deer', fond.tx + 0.5, fond.ty + 0.5)
      sim.tick += 1
      die(sim, sim.entities.find((x) => x.id === id)!, 1)
    }
    expect(sim.corpses.every((c) => c.bete === undefined), 'l’arme ne convertit pas').toBe(true)
    // LE PLAFOND, lu à la levée : 12 corrompues vivantes → le cadavre marqué redevient un cadavre.
    for (let n = 0; n < CENDREUSE.MAX; n++) {
      const id = spawnMonster(sim, 'deer', fond.tx + 0.5, fond.ty + 0.5)
      sim.monsters.find((m) => m.entityId === id)!.cendreuse = true
    }
    let marque
    for (let n = 0; n < 48 && !marque; n++) {
      const id = spawnMonster(sim, 'deer', fond.tx + 0.5, fond.ty + 0.5)
      sim.tick += 1
      die(sim, sim.entities.find((x) => x.id === id)!, 0, 'cendre')
      marque = sim.corpses.find((c) => c.bete !== undefined)
    }
    expect(marque, 'un cadavre marqué — la prémisse du plafond').toBeDefined()
    sim.tick = marque!.risesAt!
    advanceCendreux(sim)
    expect(sim.monsters.filter((m) => m.cendreuse === true).length, 'pas une de plus que MAX').toBe(CENDREUSE.MAX)
    expect(marque!.bete, 'le cadavre a rendu sa marque').toBeUndefined()
  })
})

describe('A38 — la frontière à double sens, et le cuir au butin', () => {
  it('la corrompue ne pose JAMAIS un axe de pas hors du sol cendré', () => {
    const sim = banc()
    const { lisiere } = tuiles(sim)
    const id = spawnMonster(sim, 'deer', lisiere.tx + 0.5, lisiere.ty + 0.5)
    const m = sim.monsters.find((x) => x.entityId === id)!
    m.cendreuse = true
    const e = sim.entities.find((x) => x.id === id)!
    // On la POUSSE vers la sortie, cent pas — elle longe, elle ne sort pas. Garde exhaustive
    // sur le trajet entier : chaque position traversée est un sol cendré.
    for (let n = 0; n < 100; n++) {
      moveToward(sim, m, e, e.x + lisiere.sx * 8, e.y + lisiere.sy * 8, false, 1)
      expect(profondeurNueDeCendre(sim, Math.floor(e.x), Math.floor(e.y)), `pas ${n} : encore chez elle`).toBeGreaterThanOrEqual(0)
    }
  })

  it('la morsure l’épargne, et sa mort rend le cuir cendré', () => {
    const sim = banc()
    const { fond } = tuiles(sim)
    const id = spawnMonster(sim, 'deer', fond.tx + 0.5, fond.ty + 0.5)
    const m = sim.monsters.find((x) => x.entityId === id)!
    m.cendreuse = true
    const e = sim.entities.find((x) => x.id === id)!
    const hp = e.hp
    expect(morsureDeLaCendre(sim, m, e), 'pas de morsure chez elle').toBe(false)
    expect(e.hp, 'pas un point de vie perdu').toBe(hp)
    // LE TÉMOIN : la même bête SANS drapeau est mordue — la prémisse de l'exemption.
    const id2 = spawnMonster(sim, 'deer', fond.tx + 0.5, fond.ty + 0.5)
    const m2 = sim.monsters.find((x) => x.entityId === id2)!
    const e2 = sim.entities.find((x) => x.id === id2)!
    morsureDeLaCendre(sim, m2, e2)
    expect(e2.hp).toBeLessThan(hp)
    expect(FAUNA.CENDRE_DOT_HP_S).toBeGreaterThan(0)
    // LE CUIR : elle se chasse, la dépouille grise tombe au cadavre.
    die(sim, e, 1)
    const c = sim.corpses[sim.corpses.length - 1]!
    expect(countOf(c.inventory, 'cuir_cendre')).toBe(1)
  })
})
