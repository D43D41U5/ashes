/**
 * LES GARDES DE LA CHARBONNIÈRE (spec `cendre.md` R25) — ce que la cendre REND.
 *
 * Décision d'Alexis du 2026-08-27 (piste ④) : le charbon de bois devient le combustible de forge
 * du pauvre (R24, gardé dans `economy.test.ts`), et la vieille cendre en devient la géographie.
 *
 * Elles tournent sur le VRAI monde partout où la propriété est géographique : une carte uniforme
 * n'a ni forêt brûlée, ni bandes, ni foyers — elle ne dirait rien de ce qui est en jeu ici.
 */
import { describe, expect, it } from 'vitest'
import {
  CHARBONNIERE, charbonniereIci, idDeCharbonniere, ouvrirLesCharbonnieres, toutesLesCharbonnieres,
} from './charbonniere'
import {
  BANDE_CROUTE, CENDRE, avanceesDepuisAges, bandeDeCendre, foyersDeLaCarte, terrainCendre,
} from './cendre'
import { BALANCE, NODE_DEFS, TERRAIN_BURNT_FOREST } from './balance'
import { countOf } from './items'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import type { ResourceNode } from './economy'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026
const monde = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1

const auJour = (jour: number): number[] =>
  avanceesDepuisAges(foyers.map(() => Math.max(0, jour - REVEIL)), foyers.length)

describe('A30 — le semis ne tombe QUE sur l’ancienne forêt, et dans le cœur PRIS', () => {
  it('chaque charbonnière est sur de la forêt brûlée, en bande croûte ou plus', () => {
    const av = auJour(600)
    const futs = toutesLesCharbonnieres(map, av, SEED)
    expect(futs.length, 'la carte doit en porter — sinon la garde ne garde rien').toBeGreaterThan(20)
    for (const f of futs) {
      // ⚠ ON INTERROGE LE SOL D'ORIGINE SUR CE QU'IL DEVIENT, jamais `map.terrain` en face : la
      // cendre n'est JAMAIS écrite dans la carte, elle se dérive du tick (« zéro octet dans le
      // `SimState` »). La première écriture de la garde comparait le terrain brut et rendait
      // zéro — c'est elle qui a attrapé le même défaut dans le semis.
      const brut = map.terrain[f.ty * map.width + f.tx]!
      expect(brut === TERRAIN_BURNT_FOREST || terrainCendre(brut, true) === TERRAIN_BURNT_FOREST,
        `${f.tx},${f.ty} (terrain ${brut}) doit rendre de la forêt brûlée au cœur`).toBe(true)
      expect(bandeDeCendre(map, f.tx, f.ty, av, SEED), `${f.tx},${f.ty} doit être au cœur pris`)
        .toBeGreaterThanOrEqual(BANDE_CROUTE)
    }
  })

  it('`charbonniereIci` et le balayage complet disent EXACTEMENT la même chose', () => {
    // L'écrivain unique : le rendu et la récolte interrogent par tuile, le tick balaie. Les deux
    // lectures doivent coïncider, sinon un fût se dessine là où rien ne se récolte.
    const av = auJour(600)
    const futs = toutesLesCharbonnieres(map, av, SEED)
    const attendues = new Set(futs.map((f) => f.ty * map.width + f.tx))
    for (const f of futs) expect(charbonniereIci(map, f.tx, f.ty, av, SEED), `${f.tx},${f.ty}`).toBe(true)
    // …et l'inverse, sur un échantillon large de la carte : rien d'autre n'en porte.
    let vues = 0
    for (let ty = 0; ty < map.height; ty += 5) {
      for (let tx = 0; tx < map.width; tx += 5) {
        const ici = charbonniereIci(map, tx, ty, av, SEED)
        if (ici) vues++
        expect(ici, `${tx},${ty}`).toBe(attendues.has(ty * map.width + tx))
      }
    }
    expect(vues, 'le balayage échantillonné doit en croiser').toBeGreaterThan(0)
  })

  it('deux lectures du même jour rendent le même semis, au fût près (déterminisme)', () => {
    const a = toutesLesCharbonnieres(map, auJour(600), SEED)
    const b = toutesLesCharbonnieres(map, auJour(600), SEED)
    expect(a).toEqual(b)
  })
})

describe('A31 — elle apparaît AU FIL de la cendre, jamais au premier jour', () => {
  it('rien à l’ouverture, et le compte ne fait que croître ensuite', () => {
    // Au jour 61 la tache initiale n'a que frange et bande nue (R20, mesuré) : le charbon est la
    // récompense de la DURÉE, il ne peut pas exister le premier jour. C'est l'inverse de la
    // pédagogie de R3 — et c'est voulu.
    expect(toutesLesCharbonnieres(map, auJour(BALANCE.JOUR_DE_DEPART), SEED).length).toBe(0)
    const comptes = [120, 240, 600, 1200].map((j) => toutesLesCharbonnieres(map, auJour(j), SEED).length)
    for (let i = 1; i < comptes.length; i++) {
      expect(comptes[i]!, `jour ${[120, 240, 600, 1200][i]} contre le précédent`)
        .toBeGreaterThanOrEqual(comptes[i - 1]!)
    }
    expect(comptes[comptes.length - 1]!, 'et l’an 10 doit en porter beaucoup').toBeGreaterThan(comptes[0]!)
  })

  it('le stock du registre est celui du réglage — une seule source', () => {
    expect(NODE_DEFS.charbonniere.stock).toBe(CHARBONNIERE.STOCK)
    expect(NODE_DEFS.charbonniere.item).toBe('charcoal')
    expect(NODE_DEFS.charbonniere.renewable, 'R15 : rien ne repousse dans la cendre').toBeUndefined()
    expect(NODE_DEFS.charbonniere.fini, 'et c’est un gisement, pas une tournée').toBe(true)
  })
})

describe('A32 — un GISEMENT FINI : on la vide une fois, elle ne revient pas', () => {
  /** Le monde joué, au jour de cendre voulu, avec ses charbonnières ouvertes. */
  function mondeAvecCharbon(jour: number): { sim: SimState; futs: ResourceNode[] } {
    const sim = createSim(SEED, { map, calendarScale: 1 })
    sim.cendreAge = foyers.map(() => Math.max(0, jour - REVEIL))
    ouvrirLesCharbonnieres(sim.nodes, sim.map, auJour(jour), sim.seed)
    return { sim, futs: sim.nodes.filter((n) => n.type === 'charbonniere') }
  }

  it('l’ouverture est IDEMPOTENTE : la rejouer n’en pose pas une seconde', () => {
    const { sim, futs } = mondeAvecCharbon(600)
    expect(futs.length, 'il en faut pour que la garde prouve quelque chose').toBeGreaterThan(20)
    const encore = ouvrirLesCharbonnieres(sim.nodes, sim.map, auJour(600), sim.seed)
    expect(encore).toBe(0)
    expect(sim.nodes.filter((n) => n.type === 'charbonniere').length).toBe(futs.length)
  })

  it('récoltée jusqu’au bout, elle ne repousse pas — et le semis ne la rouvre jamais', () => {
    const { sim, futs } = mondeAvecCharbon(600)
    const cible = futs[0]!
    // Un joueur au pied du fût, jamais dessus (leçon `feu-piege-centre-place-component`).
    const id = spawnEntity(sim, cible.tx + 0.5, cible.ty + 1.5)
    const agir = (a: PlayerAction): void => step(sim, [{ entityId: id, dx: 0, dy: 0, action: a }])
    for (let t = 0; t < 400 && cible.stock > 0; t++) agir({ type: 'harvest', nodeId: cible.id })
    expect(cible.stock, 'le fût doit se vider').toBe(0)
    const moi = sim.entities.find((x) => x.id === id)!
    expect(countOf(moi.inventory, 'charcoal'), 'et rendre son charbon').toBeGreaterThan(0)
    // LA MARQUE DU GISEMENT : `regrowAt` à 0, celle que le client sait déjà lire.
    expect(cible.regrowAt, 'un gisement fini ne se donne pas d’échéance').toBe(0)
    // …et mille jours plus tard, le semis ne la remet pas sur pied.
    const rouvertes = ouvrirLesCharbonnieres(sim.nodes, sim.map, auJour(1200), sim.seed)
    const encore = sim.nodes.find((n) => n.id === cible.id)!
    expect(encore.stock, 'la charbonnière vidée reste vide').toBe(0)
    expect(rouvertes, 'les autres, elles, peuvent s’ouvrir').toBeGreaterThanOrEqual(0)
  })

  it('l’id vient de la POSITION, donc il survit à une reprise de partie', () => {
    const a = idDeCharbonniere(map, 300, 400)
    expect(idDeCharbonniere(map, 300, 400)).toBe(a)
    // Deux mailles voisines ne partagent jamais un id.
    expect(idDeCharbonniere(map, 300 + CHARBONNIERE.MAILLE, 400)).not.toBe(a)
    expect(idDeCharbonniere(map, 300, 400 + CHARBONNIERE.MAILLE)).not.toBe(a)
  })
})
