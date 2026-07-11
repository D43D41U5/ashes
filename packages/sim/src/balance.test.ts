import { describe, expect, it } from 'vitest'
import { SLOTS, TERRAINS, TERRAIN_SCREE, TERRAIN_SNOW } from './balance'

describe('les tailles de sac (spec inventaire R11)', () => {
  // Deux `addItems` de la sim jettent leur reliquat À RAISON — parce que le sac
  // de destination est TOUJOURS au moins aussi grand que la source :
  //   - combat.ts `killEntity` : le cadavre (CORPSE) reçoit le sac du mort (NPC/PLAYER) ;
  //   - cendreux.ts : le Cendreux (NPC) se lève en héritant du cadavre d'un humain ;
  //   - village.ts `applyStructureDamage` : le coffre détruit (CHEST) se répand dans un cadavre.
  // Tourner ces boutons en playtest (ce à quoi balance.ts invite) sans respecter
  // la chaîne détruirait des items en silence. Ce test le transforme en échec de CI.
  it('CORPSE ≥ NPC ≥ PLAYER et NPC ≥ CHEST — sinon un transfert tronque en silence', () => {
    expect(SLOTS.CORPSE).toBeGreaterThanOrEqual(SLOTS.NPC)
    expect(SLOTS.NPC).toBeGreaterThanOrEqual(SLOTS.PLAYER)
    expect(SLOTS.NPC).toBeGreaterThanOrEqual(SLOTS.CHEST)
    // La ceinture est une RÉGION du sac du joueur, pas un sac à part (R7).
    expect(SLOTS.PLAYER).toBeGreaterThanOrEqual(SLOTS.BELT)
  })
})

describe('terrains d\'altitude alpins', () => {
  it('scree est marchable et lent (éboulis)', () => {
    expect(TERRAIN_SCREE).toBe(9)
    expect(TERRAINS[TERRAIN_SCREE]).toEqual({ name: 'scree', walkable: true, speedFactor: 0.7 })
  })
  it('snow est bloquant (pics)', () => {
    expect(TERRAIN_SNOW).toBe(10)
    expect(TERRAINS[TERRAIN_SNOW]!.walkable).toBe(false)
  })
})
