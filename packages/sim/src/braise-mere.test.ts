/**
 * ═══ A34-A36 — LA BRAISE-MÈRE ET LE CŒUR DE BRAISE (spec `cendre.md` R28/R29) ═══
 *
 * Le banc joue la VRAIE carte (les foyers, le champ de coût, les bandes sont géographiques) et
 * traverse le VRAI tick pour la bascule de jour : le gel du foyer vit dans l'espace entre deux
 * phases (`sim.ts`), pas dans une fonction seule — la leçon « une phase seule n'est pas un tick ».
 */
import { describe, expect, it } from 'vitest'
import { BANDE_CROUTE, bandeDeCendre, avanceesDepuisAges, foyerDeLaTuile, foyersDeLaCarte } from './cendre'
import { advanceBraiseMeres, BRAISE_MERE, braiseMereArdente, foyersTenusParBraise } from './braise-mere'
import { die } from './combat'
import { drainEvents } from './events'
import { fireZoneAccepts, fireZoneInventory, fireSlotLocked } from './fire'
import { addItems, countOf } from './items'
import { spawnMonster } from './monsters'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { calendarScaleForSeasonCycles, TICKS_PER_CYCLE } from './time'
import { addStructure } from './village'
import { BALANCE, TERRAIN_GRASS } from './balance'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026
const monde = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)

/** Une tuile d'HERBE possédée par un foyer — l'herbe, parce que la première version rendait
 *  (0, 0) : la bordure appartient à un foyer au sens du champ, et tout s'y refusait
 *  « terrain inconstructible » pour une raison qui n'avait rien du chantier. */
function tuileDUnFoyer(sim: SimState): { tx: number; ty: number; foyer: number } {
  for (let ty = 40; ty < sim.map.height - 40; ty += 7) {
    for (let tx = 40; tx < sim.map.width - 40; tx += 7) {
      if (sim.map.terrain[ty * sim.map.width + tx] !== TERRAIN_GRASS) continue
      const foyer = foyerDeLaTuile(sim.map, tx, ty)
      if (foyer >= 0) return { tx, ty, foyer }
    }
  }
  throw new Error('aucune tuile possédée — la prémisse du banc est morte')
}

/** Le banc : la vraie carte, un jour PAR cycle (la bascule se traverse au tick), la cendre
 *  déjà réveillée (jour de départ au-delà du réveil) et âgée de 5 jours partout. */
function banc(): SimState {
  const sim = createSim(SEED, {
    map: monde.map, faunaCap: 0, worldEvents: false, meteoActive: false,
    calendarScale: SCALE, jourDeDepart: 100,
  })
  sim.cendreAge = foyersDeLaCarte(sim.map).map(() => 5)
  drainEvents(sim)
  return sim
}

describe('A34 — la braise-mère tient la ligne, sans rattrapage', () => {
  it('ardente à la bascule : SON foyer ne vieillit pas, les autres si — puis éteinte, il reprend', () => {
    const sim = banc()
    const { tx, ty, foyer } = tuileDUnFoyer(sim)
    const id = spawnEntity(sim, tx + 0.5, ty + 2.5)
    const s = addStructure(sim, 'braise_mere', tx, ty, 0, id)
    addItems(fireZoneInventory(s, 'fuel')!, { charcoal: 3 })
    expect(braiseMereArdente(sim.tick, s), 'la soute pleine rend ardente').toBe(true)
    expect(foyersTenusParBraise(sim).has(foyer), 'le foyer de sa cellule est tenu').toBe(true)
    // LA BASCULE DE JOUR, PAR LE VRAI TICK : on se pose juste avant la frontière et on la passe.
    sim.tick = TICKS_PER_CYCLE * 3 - 2
    const avant = [...sim.cendreAge]
    step(sim, [{ entityId: id, dx: 0, dy: 0 }])
    step(sim, [{ entityId: id, dx: 0, dy: 0 }])
    expect(sim.cendreAge[foyer], 'le foyer tenu n’a pas vieilli').toBe(avant[foyer])
    const autres = sim.cendreAge.filter((_, k) => k !== foyer)
    const avantAutres = avant.filter((_, k) => k !== foyer)
    expect(autres.some((a, k) => a > avantAutres[k]!), 'les autres foyers, eux, vieillissent').toBe(true)
    // ÉTEINTE (soute vidée, unité en cours consumée d'office) : le jour suivant reprend la
    // marche — et l'âge repart d'où il était, JAMAIS d'un rattrapage.
    const soute = fireZoneInventory(s, 'fuel')!
    for (let i = 0; i < soute.length; i++) soute[i] = null
    delete s.burnAt
    const gele = sim.cendreAge[foyer]!
    sim.tick = TICKS_PER_CYCLE * 4 - 2
    step(sim, [{ entityId: id, dx: 0, dy: 0 }])
    step(sim, [{ entityId: id, dx: 0, dy: 0 }])
    expect(sim.cendreAge[foyer], 'la marche reprend d’un jour, pas de deux').toBe(gele! + 1)
  })

  it('deux braises-mères sur le même foyer = le même gel (idempotent)', () => {
    const sim = banc()
    const { tx, ty, foyer } = tuileDUnFoyer(sim)
    const id = spawnEntity(sim, tx + 0.5, ty + 3.5)
    for (const dx of [0, 1]) {
      const s = addStructure(sim, 'braise_mere', tx + dx, ty, 0, id)
      addItems(fireZoneInventory(s, 'fuel')!, { charcoal: 1 })
    }
    const tenus = foyersTenusParBraise(sim)
    expect(tenus.has(foyer)).toBe(true)
    expect([...tenus].filter((f) => f === foyer)).toHaveLength(1)
  })
})

describe('R28a — elle se pose À LA FRANGE, sans village et hors carré', () => {
  it('place_component l’accepte SANS village (le statut du feu de camp), et refuse toujours le coffre', () => {
    const sim = banc()
    const { tx, ty } = tuileDUnFoyer(sim)
    const id = spawnEntity(sim, tx + 0.5, ty + 0.5)
    const e = sim.entities.find((x) => x.id === id)!
    addItems(e.inventory, { braise_mere: 1 })
    e.activeSlot = e.inventory.findIndex((c) => c !== null && c.item === 'braise_mere')
    // On balaie les voisines (une tuile du vrai monde peut porter un nœud, un terrain dur…) :
    // la promesse de R28a n'est pas « toute tuile accepte », c'est « AUCUN refus ne parle de
    // village ni de carré » — et qu'une candidate finit par accepter.
    let posee
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
      step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'place_component', tx: tx + dx, ty: ty + dy } }])
      for (const ev of drainEvents(sim)) {
        if (ev.type !== 'action_rejected') continue
        const raison = (ev as { reason?: string }).reason ?? ''
        expect(raison.includes('village'), `refus « ${raison} » : l’exemption a fui`).toBe(false)
        expect(raison.includes('carré'), `refus « ${raison} » : l’exemption a fui`).toBe(false)
      }
      posee = sim.structures.find((s) => s.type === 'braise_mere')
      if (posee) break
    }
    expect(posee, 'posée sans village, quelque part autour').toBeDefined()
    expect(posee!.villageId, 'au statut du feu de camp').toBe(0)
    // LE TÉMOIN : le coffre, lui, exige toujours son village — l'exemption ne fuit pas.
    addItems(e.inventory, { chest: 1 })
    e.activeSlot = e.inventory.findIndex((c) => c !== null && c.item === 'chest')
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'place_component', tx: tx + 2, ty } }])
    expect(sim.structures.some((s) => s.type === 'chest'), 'le coffre reste refusé sans village').toBe(false)
  })
})

describe('A35 — elle mange son charbon, et la soute se verrouille', () => {
  it('un charbon consommé toutes les TICKS_PAR_CHARBON ; à sec, plus ardente', () => {
    const sim = banc()
    const { tx, ty } = tuileDUnFoyer(sim)
    const id = spawnEntity(sim, tx + 0.5, ty + 2.5)
    const s = addStructure(sim, 'braise_mere', tx, ty, 0, id)
    const soute = fireZoneInventory(s, 'fuel')!
    expect(fireZoneAccepts(s, 'fuel', 'charcoal')).toBe(true)
    expect(fireZoneAccepts(s, 'fuel', 'wood'), 'pas de bûche dans une braise-mère').toBe(false)
    expect(fireZoneAccepts(s, 'cookIn', 'raw_meat'), 'elle ne cuit rien').toBe(false)
    addItems(soute, { charcoal: 2 })
    advanceBraiseMeres(sim) // engage la première unité
    expect(s.burnAt, 'l’unité s’engage').toBeDefined()
    expect(fireSlotLocked(s, 'fuel', soute.findIndex((c) => c !== null)), 'l’unité en cours est verrouillée').toBe(1)
    // L'échéance de la première unité : un charbon part, la suivante s'engage.
    sim.tick += BRAISE_MERE.TICKS_PAR_CHARBON
    advanceBraiseMeres(sim)
    expect(countOf(soute, 'charcoal')).toBe(1)
    expect(braiseMereArdente(sim.tick, s)).toBe(true)
    // La seconde : la soute est à sec, la braise expire d'elle-même.
    sim.tick += BRAISE_MERE.TICKS_PAR_CHARBON
    advanceBraiseMeres(sim)
    expect(countOf(soute, 'charcoal')).toBe(0)
    expect(braiseMereArdente(sim.tick, s), 'à sec, plus ardente').toBe(false)
  })
})

describe('A36 — le cœur ne se paie qu’au cœur', () => {
  /** Une tuile au-delà de la croûte pour un âge de cendre MÛR, et une tuile HORS cendre. */
  function tuiles(sim: SimState): { coeur: { tx: number; ty: number }; dehors: { tx: number; ty: number } } {
    const av = avanceesDepuisAges(sim.cendreAge, sim.cendreAge.length)
    let coeur: { tx: number; ty: number } | null = null
    let dehors: { tx: number; ty: number } | null = null
    for (let ty = 0; ty < sim.map.height && (!coeur || !dehors); ty += 5) {
      for (let tx = 0; tx < sim.map.width && (!coeur || !dehors); tx += 5) {
        const b = bandeDeCendre(sim.map, tx, ty, av, SEED)
        if (b >= BANDE_CROUTE && !coeur) coeur = { tx, ty }
        if (b < 0 && !dehors) dehors = { tx, ty }
      }
    }
    if (!coeur || !dehors) throw new Error('bandes introuvables — la prémisse du banc est morte')
    return { coeur, dehors }
  }

  it('au-delà de la croûte : le cœur tombe sur sa part de hachage, sans toucher le PRNG', () => {
    const sim = banc()
    sim.cendreAge = foyersDeLaCarte(sim.map).map(() => 120) // la croûte existe pour de vrai
    const { coeur } = tuiles(sim)
    // Des morts en série au même endroit : la part de hachage doit en faire tomber CERTAINS —
    // et deux sims identiques doivent faire tomber LES MÊMES (déterminisme du hachage).
    const recolte = (s: SimState): boolean[] => {
      const out: boolean[] = []
      for (let n = 0; n < 24; n++) {
        const id = spawnMonster(s, 'cendreux', coeur.tx + 0.5, coeur.ty + 0.5)
        const e = s.entities.find((x) => x.id === id)!
        s.tick += 1 // le hachage lit (id, tick) : chaque mort est son propre tirage
        // LA GARDE DU FLUX enveloppe la MORT seule : le spawn tire (c'est son droit), le
        // butin jamais — c'est le drop qui est promis sans PRNG (R29a), pas le monde entier.
        const rng = s.rngState
        die(s, e, 0)
        expect(s.rngState, 'pas un tirage du PRNG dans la mort').toBe(rng)
        const c = s.corpses[s.corpses.length - 1]
        out.push(c !== undefined && countOf(c.inventory, 'coeur_de_braise') > 0)
      }
      return out
    }
    const a = recolte(sim)
    expect(a.some(Boolean), 'certains tombent').toBe(true)
    expect(a.some((v) => !v), 'pas tous').toBe(true)
    const sim2 = banc()
    sim2.cendreAge = foyersDeLaCarte(sim2.map).map(() => 120)
    expect(recolte(sim2), 'même seed, mêmes morts → même butin').toEqual(a)
  })

  it('hors cendre : jamais — les sièges qui viennent à vous ne paient rien', () => {
    const sim = banc()
    sim.cendreAge = foyersDeLaCarte(sim.map).map(() => 120)
    const { dehors } = tuiles(sim)
    for (let n = 0; n < 24; n++) {
      const id = spawnMonster(sim, 'cendreux', dehors.tx + 0.5, dehors.ty + 0.5)
      const e = sim.entities.find((x) => x.id === id)!
      sim.tick += 1
      die(sim, e, 0)
      const c = sim.corpses[sim.corpses.length - 1]
      expect(c === undefined || countOf(c.inventory, 'coeur_de_braise') === 0).toBe(true)
    }
  })
})
