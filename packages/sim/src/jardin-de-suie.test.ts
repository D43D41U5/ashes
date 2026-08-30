/**
 * ═══ J-A1..J-A3 — LE JARDIN DE SUIE (spec `agriculture.md`, chantier ⑦ de la cendre) ═══
 *
 * Le banc joue la VRAIE carte (le sol cendré est géographique) ; la graine vient d'un VRAI
 * murmure quand c'est lui qu'on éprouve — le banc ne fabrique pas sa prémisse.
 */
import { describe, expect, it } from 'vitest'
import { AGRICULTURE, TERRAIN_GRASS } from './balance'
import { cropStage, cultureAdmise, isCropMature, pousseDe } from './agriculture'
import { foyersDeLaCarte, tuileCendree } from './cendre'
import { drainEvents } from './events'
import { addItems, countOf } from './items'
import { advanceMurmures, sitesDeCycle } from './murmure'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { dayTicksPourJour, TICKS_PER_CYCLE } from './time'
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

/** Une tuile CENDRÉE d'herbe (posable) et une tuile SAINE, voisines de l'esprit du test. */
function tuiles(sim: SimState): { cendree: { tx: number; ty: number }; saine: { tx: number; ty: number } } {
  let cendree = null
  let saine = null
  for (let ty = 40; ty < sim.map.height - 40 && (!cendree || !saine); ty += 5) {
    for (let tx = 40; tx < sim.map.width - 40 && (!cendree || !saine); tx += 5) {
      if (sim.map.terrain[ty * sim.map.width + tx] !== TERRAIN_GRASS) continue
      if (tuileCendree(sim, tx, ty)) { if (!cendree) cendree = { tx, ty } }
      else if (!saine) saine = { tx, ty }
    }
  }
  if (!cendree || !saine) throw new Error('tuiles introuvables — la prémisse du banc est morte')
  return { cendree, saine }
}

function poser(sim: SimState, id: number, tx: number, ty: number): void {
  const e = sim.entities.find((x) => x.id === id)!
  e.inventory[0] = { item: 'parcelle_de_suie', count: 1 }
  e.activeSlot = 0
  step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'place_component', tx, ty } }])
}

describe('J-A1 — la pose exige la suie, et passe sans village', () => {
  it('sur sol cendré : posée, villageId 0 ; sur sol sain : « il faut un sol cendré »', () => {
    const sim = banc()
    const { cendree, saine } = tuiles(sim)
    const id = spawnEntity(sim, cendree.tx + 0.5, cendree.ty + 1.5)
    poser(sim, id, cendree.tx, cendree.ty)
    const posee = sim.structures.find((s) => s.type === 'parcelle_de_suie')
    expect(posee, 'posée sans village, sur la cendre').toBeDefined()
    expect(posee!.villageId).toBe(0)
    // LE TÉMOIN : la même pièce sur un sol SAIN est refusée avec ses mots.
    const id2 = spawnEntity(sim, saine.tx + 0.5, saine.ty + 1.5)
    drainEvents(sim)
    poser(sim, id2, saine.tx, saine.ty)
    expect(drainEvents(sim).some((ev) => ev.type === 'action_rejected' && (ev as { reason?: string }).reason === 'il faut un sol cendré')).toBe(true)
  })
})

describe('J-A2 — la compatibilité est totale, et le gel ne la touche pas', () => {
  it('braise sur suie ✓ (en plein gel) ; légume sur suie ✗ ; braise sur parcelle : jamais de fenêtre', () => {
    const sim = banc()
    const { cendree } = tuiles(sim)
    // PLEIN GEL : le tick au cœur de la nuit — là où la parcelle nue refuserait.
    sim.tick = dayTicksPourJour(1) + Math.floor((TICKS_PER_CYCLE - dayTicksPourJour(1)) / 2)
    const id = spawnEntity(sim, cendree.tx + 0.5, cendree.ty + 1.5)
    poser(sim, id, cendree.tx, cendree.ty)
    const plot = sim.structures.find((s) => s.type === 'parcelle_de_suie')!
    const e = sim.entities.find((x) => x.id === id)!
    // LE LÉGUME D'ABORD, seul au sac : refusé avec les mots de la suie.
    addItems(e.inventory, { graine: 1 })
    drainEvents(sim)
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'plant', structureId: plot.id } }])
    expect(drainEvents(sim).some((ev) => ev.type === 'action_rejected' && (ev as { reason?: string }).reason === 'seule l’orge-de-braise pousse dans la suie')).toBe(true)
    // LA BRAISE ENSUITE : semée, en plein gel.
    addItems(e.inventory, { graine_de_braise: 1 })
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'plant', structureId: plot.id } }])
    expect(plot.plantedAt, 'semée en plein Grand Froid').toBeDefined()
    expect(plot.culture).toBe('braise')
    // …ET LA TABLE LE DIT : la braise n'est admise QUE là, sur tout le domaine des types.
    for (const type of ['parcelle', 'serre', 'terroir'] as const) {
      expect(cultureAdmise('braise', type), `braise sur ${type}`).toBe(false)
      expect(cultureAdmise('hiver', type), `hiver sur ${type}`).toBe(true)
    }
    expect(cultureAdmise('hiver', 'parcelle_de_suie')).toBe(false)
  })

  it('F5 ne tue JAMAIS la culture de suie : elle mûrit à travers le gel, et se récolte', () => {
    const sim = banc()
    const { cendree } = tuiles(sim)
    const id = spawnEntity(sim, cendree.tx + 0.5, cendree.ty + 1.5)
    poser(sim, id, cendree.tx, cendree.ty)
    const plot = sim.structures.find((s) => s.type === 'parcelle_de_suie')!
    const e = sim.entities.find((x) => x.id === id)!
    addItems(e.inventory, { graine_de_braise: 1 })
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'plant', structureId: plot.id } }])
    expect(plot.plantedAt).toBeDefined()
    // La pousse traverse les nuits gelées : on saute au terme PAR le temps, la passe F5
    // tourne à chaque step — dix pas répartis suffisent à lui donner sa chance de tuer.
    const terme = pousseDe('braise')
    for (let k = 0; k < 10; k++) {
      sim.tick += Math.floor(terme / 10)
      step(sim, [{ entityId: id, dx: 0, dy: 0 }])
    }
    expect(plot.plantedAt, 'le gel ne l’a pas tuée').toBeDefined()
    expect(isCropMature(plot, sim.tick), 'mûre').toBe(true)
    expect(cropStage(plot, sim.tick)).toBe(1)
    drainEvents(sim)
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'harvest_crop', structureId: plot.id } }])
    expect(countOf(e.inventory, 'orge_de_braise'), 'la moisson').toBe(AGRICULTURE.CULTURES.braise.rendement)
    expect(countOf(e.inventory, 'graine_de_braise'), 'et sa graine — la boucle se referme').toBe(1)
  })
})

describe('J-A3 — la graine vient du murmure', () => {
  it('le visiteur calme reçoit la graine avec le murmure ; le sprinteur, rien', () => {
    const sim = banc()
    sim.tick = dayTicksPourJour(1) + Math.floor((TICKS_PER_CYCLE - dayTicksPourJour(1)) / 2)
    const site = sitesDeCycle(sim, Math.floor(sim.tick / TICKS_PER_CYCLE))[0]!
    expect(site, 'un site — la prémisse').toBeDefined()
    const id = spawnEntity(sim, site.tx + 0.5, site.ty + 0.5)
    advanceMurmures(sim)
    const e = sim.entities.find((x) => x.id === id)!
    expect(countOf(e.inventory, 'graine_de_braise'), 'le don du murmure').toBe(1)
    // LE TÉMOIN : un sprinteur sur un AUTRE site ne reçoit rien.
    const site2 = sitesDeCycle(sim, Math.floor(sim.tick / TICKS_PER_CYCLE))[1]!
    const id2 = spawnEntity(sim, site2.tx + 0.5, site2.ty + 0.5)
    const e2 = sim.entities.find((x) => x.id === id2)!
    e2.gait = 'sprint'
    advanceMurmures(sim)
    expect(countOf(e2.inventory, 'graine_de_braise')).toBe(0)
  })
})
