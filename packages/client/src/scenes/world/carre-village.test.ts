/**
 * LA FRONTIÈRE DE CONSTRUCTION — le liseré ne doit pas mentir d'une tuile.
 *
 * Deux propriétés seulement, et aucune n'est une redite du code :
 *
 *  1. LE RECTANGLE DESSINÉ EST EXACTEMENT LE CARRÉ DE LA SIM. On ne compare pas le
 *     client à lui-même : on interroge `evaluateBuild` sur un VRAI village fondé par les
 *     vraies actions, tuile par tuile, et on exige que « le refus est `out_of_square` »
 *     coïncide au bit près avec « la tuile est hors des bornes que je peins ». Un liseré
 *     juste d'une tuile près serait pire que pas de liseré : il ferait perdre le clic en
 *     promettant le contraire.
 *
 *  2. LE TAPIS DIT LA MÊME CHOSE QUE LA SIM, PIÈCE PAR PIÈCE. Le terrain juge par pièce
 *     (le gué porte le sol, pas le mur) et le landmark ne refuse que le feu de camp :
 *     deux asymétries qu'un tapis « eau = rouge » aurait écrasées.
 *
 * Balayage EXHAUSTIF sur la fenêtre, pas des cas choisis : c'est de la géométrie, et une
 * erreur de géométrie se cache toujours dans la tuile qu'on n'a pas listée.
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE,
  POSABLE_SUR_EAU,
  TERRAIN_DEEP_WATER,
  TERRAIN_GRASS,
  TERRAIN_SHALLOW_WATER,
  createEmptyMap,
  createSim,
  evaluateBuild,
  fireRadius,
  getVillageOf,
  grantItems,
  spawnEntity,
  step,
  structureAt,
  terrainAt,
  zoneAt,
  type PlayerAction,
  type SimState,
  type Village,
  type WorldMap,
} from '@ashes/sim'
import { bornesDuCarre, rayonReserve, tuilePosable } from './carre-village'

function act(sim: SimState, id: number, action: PlayerAction): void {
  step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
}

/** Un colon équipé, son feu posé et promu : un VRAI village, pas un objet fabriqué. */
function villageFonde(fireTx: number, fireTy: number): { sim: SimState; id: number; village: Village } {
  const sim = createSim(1, { map: createEmptyMap(160, 160, TERRAIN_GRASS) })
  const id = spawnEntity(sim, fireTx + 1.5, fireTy + 0.5)
  grantItems(sim, id, { campfire: 1, hammer: 1, wood: 80, stone: 40 })
  const slot = (item: string): number => sim.entities.find((e) => e.id === id)!.inventory.findIndex((s) => s?.item === item)
  act(sim, id, { type: 'set_active_slot', slot: slot('campfire') })
  act(sim, id, { type: 'place_campfire', tx: fireTx, ty: fireTy })
  const fire = structureAt(sim.structures, fireTx, fireTy)!
  act(sim, id, { type: 'found_village', structureId: fire.id })
  act(sim, id, { type: 'set_active_slot', slot: slot('hammer') })
  const village = getVillageOf(sim, id)!
  return { sim, id, village }
}

describe('le liseré tombe sur la frontière de la sim', () => {
  it('C1 — les bornes peintes coïncident tuile à tuile avec le refus « out_of_square »', () => {
    const FEU_X = 60
    const FEU_Y = 60
    const { sim, id, village } = villageFonde(FEU_X, FEU_Y)
    expect(village.tier, 'un village neuf naît au palier 1').toBe(1)

    const b = bornesDuCarre(village)
    const r = fireRadius(village.tier)
    // La prémisse : les bornes décrivent bien un carré (2R+1)², sinon la suite ne
    // prouverait rien de ce qu'on peint.
    expect(b.x1 - b.x0 + 1).toBe(2 * r + 1)
    expect(b.y1 - b.y0 + 1).toBe(2 * r + 1)

    // Le balayage : toute la fenêtre du carré débordée de 3 tuiles, coin compris.
    let horsVus = 0
    let dedansVus = 0
    for (let ty = b.y0 - 3; ty <= b.y1 + 3; ty++) {
      for (let tx = b.x0 - 3; tx <= b.x1 + 3; tx++) {
        const dansLePeint = tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1
        const verdict = evaluateBuild(sim, id, 'wall', tx, ty)
        const horsCarrePourLaSim = verdict.reason === 'out_of_square'
        expect(horsCarrePourLaSim, `(${tx},${ty}) : la sim et le liseré ne disent pas la même chose`)
          .toBe(!dansLePeint)
        if (horsCarrePourLaSim) horsVus++
        else dedansVus++
      }
    }
    // Une garde sur la GARDE : sans ça, un `evaluateBuild` qui rendrait toujours le même
    // refus (« no_hammer », par exemple) ferait passer le test en ne prouvant rien.
    expect(dedansVus, 'aucune tuile DEDANS balayée').toBe((2 * r + 1) ** 2)
    expect(horsVus, 'aucune tuile DEHORS balayée').toBeGreaterThan(0)
  })

  it('C2 — monter le Feu d’un palier déplace le liseré d’autant, sans le décoller de la sim', () => {
    const { sim, id, village } = villageFonde(60, 60)
    const avant = bornesDuCarre(village)
    // On ne simule pas la montée : on lit le palier suivant, et on exige que le liseré
    // suive `FIRE_RADIUS_BY_TIER` — la table qui commande AUSSI `evaluateBuild`.
    const promu: Village = { ...village, tier: 2 }
    const apres = bornesDuCarre(promu)
    expect(apres.x0).toBe(avant.x0 - (fireRadius(2) - fireRadius(1)))
    expect(apres.x1).toBe(avant.x1 + (fireRadius(2) - fireRadius(1)))
    // Et la tuile qui vient d'entrer dans le carré est bien celle que la sim ouvre.
    const neuve = { tx: avant.x1 + 1, ty: 60 }
    expect(evaluateBuild(sim, id, 'wall', neuve.tx, neuve.ty).reason).toBe('out_of_square')
    sim.villages[0]!.tier = 2
    expect(evaluateBuild(sim, id, 'wall', neuve.tx, neuve.ty).reason).not.toBe('out_of_square')
  })

  it('C3 — le carré RÉSERVÉ est le plus grand palier, jamais un nombre écrit à la main', () => {
    const paliers = BALANCE.FIRE_RADIUS_BY_TIER
    expect(rayonReserve()).toBe(Math.max(...paliers))
    for (let tier = 1; tier <= paliers.length; tier++) {
      expect(fireRadius(tier), `le palier ${tier} dépasse la réserve`).toBeLessThanOrEqual(rayonReserve())
    }
  })
})

describe('le tapis dit ce que la pièce ARMÉE peut faire', () => {
  /** Prairie, un gué à l'ouest, de l'eau profonde plus loin, un toponyme au sud. */
  function carte(): WorldMap {
    const m = createEmptyMap(64, 64, TERRAIN_GRASS)
    m.terrain[32 * m.width + 10] = TERRAIN_SHALLOW_WATER
    m.terrain[32 * m.width + 12] = TERRAIN_DEEP_WATER
    m.zones.push({ name: 'La Combe', x: 20, y: 40, w: 6, h: 6 })
    return m
  }

  it('T1 — le gué porte le sol et refuse le mur (la porte de terrain juge PAR PIÈCE)', () => {
    const m = carte()
    // La prémisse, prouvée et non supposée : cette tuile EST un gué, et la liste des
    // pièces posables sur l'eau contient le sol sans contenir le mur.
    expect(terrainAt(m, 10, 32)).toBe(TERRAIN_SHALLOW_WATER)
    expect(POSABLE_SUR_EAU).toContain('floor')
    expect(POSABLE_SUR_EAU).not.toContain('wall')

    expect(tuilePosable(m, 'floor', 10, 32, false), 'des planches sur le gué').toBe(true)
    expect(tuilePosable(m, 'wall', 10, 32, false), 'un mur dans la rivière').toBe(false)
    // L'eau PROFONDE ne porte rien, sol compris : elle n'est même pas marchable.
    expect(terrainAt(m, 12, 32)).toBe(TERRAIN_DEEP_WATER)
    expect(tuilePosable(m, 'floor', 12, 32, false)).toBe(false)
  })

  it('T2 — le landmark ne refuse QUE le feu de camp (la sim ne le teste nulle part ailleurs)', () => {
    const m = carte()
    expect(zoneAt(m, 22.5, 42.5), 'la prémisse : cette tuile est bien dans un toponyme').toBeDefined()
    expect(tuilePosable(m, 'fire', 22, 42, false), 'on ne fonde pas sur un landmark').toBe(false)
    // …mais on y bâtit. R1 autorise expressément un village dans une zone-région, et
    // `evaluateBuild` ne consulte jamais `zoneAt` : un tapis tout rouge ici mentirait.
    expect(tuilePosable(m, 'wall', 22, 42, false)).toBe(true)
    expect(tuilePosable(m, 'chest', 22, 42, false)).toBe(true)
  })

  it('T3 — une tuile occupée refuse ce qui la PREND, jamais ce qui la borde', () => {
    const m = carte()
    // Le mur, la porte et la palissade vivent sur l'ARÊTE : un buisson, un corps ou un
    // coffre sur la tuile ne s'oppose pas à eux — on longe une haie, on ceint son four.
    for (const arete of ['wall', 'door', 'palissade'] as const) {
      expect(tuilePosable(m, arete, 30, 30, true), `${arete} borde la tuile, il ne la prend pas`).toBe(true)
    }
    // Ce qui prend la tuile, lui, se heurte à ce qui y est déjà.
    for (const pleine of ['floor', 'roof', 'chest', 'enclume', 'fire'] as const) {
      expect(tuilePosable(m, pleine, 30, 30, true), `${pleine} prend la tuile`).toBe(false)
      expect(tuilePosable(m, pleine, 30, 30, false)).toBe(true)
    }
  })
})
