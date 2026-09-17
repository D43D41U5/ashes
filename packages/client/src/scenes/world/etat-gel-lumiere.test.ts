/**
 * CE QUE LA LUMIÈRE LIT EN PLUS DANS LA FAÇADE (`etat-gel.ts`, en-tête ; spec
 * `lumiere-globale.md` LG-R11, LG-R18 ; `nuit-noire.md` N2bis).
 *
 * Ce que ce fichier garde : que la prédiction du client (`clarteSurSoiAt` sur la façade) rend
 * EXACTEMENT ce que l'autorité rend sur le vrai `SimState` — derrière un fût, sous la torche
 * d'un autre avatar, à côté d'un figurant qui en porte une. Et que chaque champ optionnel
 * COMPTE : sans lui, la façade est plus claire que l'autorité, le sens interdit de N2bis.
 * Le montage est celui de `lumiere.test.ts` (sim) : minuit de nouvelle lune, un feu libre.
 */
import { describe, expect, it } from 'vitest'
import {
  FIRE,
  LUNAISON_JOURS,
  LUNE_PLEINE_JOUR,
  SLOTS,
  TERRAIN_GRASS,
  addItems,
  clarteSurSoiAt,
  createEmptyMap,
  createSim,
  cycleOffsetForStartHour,
  getGameTime,
  jourDeSaison,
  makeInventory,
  spawnEntity,
  type Entity,
  type Npc,
  type SimState,
  type Structure,
} from '@ashes/sim'
import { creerEtatGel, majEtatGel, type SourceDuGel } from './etat-gel'

const FEU = { tx: 50, ty: 48 }
/** Un porteur de torche AVATAR, loin du feu : là, seule sa flamme éclaire. */
const AUTRE = { x: 40.5, y: 40.5 }
/** Un porteur de torche FIGURANT, aussi loin : sa flamme ne compte pas (LG-R18). */
const PNJ = { x: 60.5, y: 40.5 }

function nuitNoire(): SimState {
  const jourDeDepart = Math.floor(LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2)
  const sim = createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), jourDeDepart, meteoActive: true })
  sim.cycleOffset = cycleOffsetForStartHour(0, jourDeSaison(sim))
  return sim
}
const ent = (sim: SimState, id: number): Entity => sim.entities.find((e) => e.id === id)!

/** Le feu libre de `addStructure`, à la main : la sim n'exporte pas son bâtisseur. */
function feu(sim: SimState, tx: number, ty: number): void {
  const fuel = makeInventory(FIRE.FUEL_SLOTS)
  addItems(fuel, { wood: 3 })
  const s = { id: sim.nextStructureId, type: 'fire', tx, ty, villageId: 0, ownerId: 0, access: 'public', hp: 100, fuel, burnAt: sim.tick, burnSlot: 0 }
  sim.nextStructureId += 1
  sim.structures.push(s as unknown as Structure)
}
function porteur(sim: SimState, x: number, y: number): Entity {
  const e = ent(sim, spawnEntity(sim, x, y))
  e.inventory = makeInventory(SLOTS.PLAYER)
  e.inventory[0] = { item: 'torche_vive', count: 1, wear: 0 }
  e.activeSlot = 0
  return e
}

/** Le monde témoin : un feu, un fût juste à l'ouest, deux porteurs de torche dont un figurant. */
function monde(): SimState {
  const sim = nuitNoire()
  feu(sim, FEU.tx, FEU.ty)
  sim.nodes.push({ id: 9001, type: 'tree', tx: FEU.tx - 1, ty: FEU.ty, stock: 5, regrowAt: 0 })
  porteur(sim, AUTRE.x, AUTRE.y)
  const pnj = porteur(sim, PNJ.x, PNJ.y)
  sim.npcs.push({ entityId: pnj.id } as unknown as Npc)
  return sim
}

type Porte = { nodes?: boolean; entities?: boolean; npcs?: boolean }
function sourceDepuis(sim: SimState, porte: Porte): SourceDuGel {
  const src: SourceDuGel = {
    map: sim.map,
    temps: getGameTime(sim),
    calendarScale: sim.calendarScale,
    jourDeDepart: sim.jourDeDepart,
    cendreAge: sim.cendreAge,
    seed: sim.seed,
    structures: sim.structures,
    meteo: sim.meteo ?? null,
    brume: sim.brume ?? null,
    ...(porte.nodes ? { nodes: sim.nodes } : {}),
    ...(porte.entities ? { entities: sim.entities } : {}),
    ...(porte.npcs ? { npcs: sim.npcs, monsters: sim.monsters } : {}),
  }
  return src
}

/** Un balayage de points : quarts de tuile sur la fenêtre qui contient le feu et les porteurs. */
function* points(): Generator<[number, number]> {
  for (let ty = 38; ty <= 56; ty++) for (let tx = 38; tx <= 64; tx++) for (const q of [0.25, 0.75]) yield [tx + q, ty + q]
}
const clarte = (etat: SimState, x: number, y: number): number => clarteSurSoiAt(etat, etat.tick, x, y, false)

describe('la façade rend la même clarté que le vrai SimState (LG-R11, LG-R18)', () => {
  it('L1 — tout porté, la prédiction vaut l’autorité au bit près, sur tout le balayage', () => {
    const sim = monde()
    const facade = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true, npcs: true }))
    // Le ciel seul, loin de toute flamme : le plancher de la nuit (la nouvelle lune n'est pas
    // le zéro exact — c'est `clarteDuCiel` qui le dit, pas ce test).
    const ciel = clarte(sim, 90.5, 90.5)
    let n = 0
    let eclaires = 0
    for (const [x, y] of points()) {
      const vrai = clarte(sim, x, y)
      expect(clarte(facade, x, y), `(${x}, ${y})`).toBe(vrai)
      n++
      if (vrai > ciel) eclaires++
    }
    // La prémisse : le balayage traverse des points qu'une flamme éclaire ET des points au ciel seul.
    expect(n).toBeGreaterThan(900)
    expect(eclaires).toBeGreaterThan(50)
    expect(eclaires).toBeLessThan(n)
  })

  it('L2 — sans les nœuds, la façade est PLUS CLAIRE que l’autorité derrière le fût (N2bis)', () => {
    const sim = monde()
    const sans = creerEtatGel(sourceDepuis(sim, { entities: true, npcs: true }))
    let mensonges = 0
    for (const [x, y] of points()) {
      const vrai = clarte(sim, x, y)
      const predit = clarte(sans, x, y)
      expect(predit, `(${x}, ${y})`).toBeGreaterThanOrEqual(vrai) // jamais plus sombre : un fût ne fait qu'ôter
      if (predit > vrai) mensonges++
    }
    expect(mensonges).toBeGreaterThan(0)
    // Le point témoin : à l'ouest du fût, dans son ombre — la sim y voit moins que la façade nue.
    const ombre: [number, number] = [FEU.tx - 2.5, FEU.ty + 0.5]
    expect(clarte(sim, ...ombre)).toBeLessThan(clarte(sans, ...ombre))
    expect(clarte(sim, ...ombre)).toBeGreaterThan(0) // pénombre, pas le noir : le fût ne fait que 2×2 texels
  })

  it('L3 — sans les corps, la torche de l’autre avatar manque ; avec, elle vaut l’autorité', () => {
    const sim = monde()
    const sans = creerEtatGel(sourceDepuis(sim, { nodes: true, npcs: true }))
    const avec = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true, npcs: true }))
    const pres: [number, number] = [AUTRE.x + 1, AUTRE.y + 1]
    const vrai = clarte(sim, ...pres)
    expect(vrai).toBeGreaterThan(0.5) // à un pas du porteur, sa flamme domine le ciel de nouvelle lune
    expect(clarte(avec, ...pres)).toBe(vrai)
    expect(clarte(sans, ...pres)).toBeLessThan(vrai)
  })

  it('L4 — sans les figurants, la façade compte la torche d’un PNJ que l’autorité ignore (LG-R18)', () => {
    const sim = monde()
    const sans = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true }))
    const avec = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true, npcs: true }))
    const pres: [number, number] = [PNJ.x + 1, PNJ.y + 1]
    const vrai = clarte(sim, ...pres)
    expect(clarte(avec, ...pres)).toBe(vrai)
    expect(clarte(sans, ...pres)).toBeGreaterThan(vrai)
  })

  it('L5 — `majEtatGel` remet les quatre champs à jour, et les efface quand la source ne les porte plus', () => {
    const sim = monde()
    const facade = creerEtatGel(sourceDepuis(sim, {}))
    const ombre: [number, number] = [FEU.tx - 2.5, FEU.ty + 0.5]
    const nu = clarte(facade, ...ombre)
    majEtatGel(facade, sourceDepuis(sim, { nodes: true, entities: true, npcs: true }))
    expect(clarte(facade, ...ombre)).toBe(clarte(sim, ...ombre))
    expect(clarte(facade, ...ombre)).toBeLessThan(nu)
    majEtatGel(facade, sourceDepuis(sim, {}))
    expect(clarte(facade, ...ombre)).toBe(nu)
  })
})
