import { describe, expect, it } from 'vitest'
import { BALANCE, SLOTS, TERRAINS, TERRAIN_SCREE, TERRAIN_SNOW } from './balance'
import { stackSize } from './items'

describe('les tailles de sac (spec inventaire R11)', () => {
  // Les `addItems` de la sim qui jettent leur reliquat le font À RAISON — parce que
  // le sac de destination est TOUJOURS assez grand pour la source. Deux familles :
  //
  // 1. Le sac de destination est plus GRAND (c'est ce que ce test garde) :
  //    - combat.ts `killEntity` : le cadavre (CORPSE) reçoit le sac du mort (NPC/PLAYER) ;
  //    - village.ts `applyStructureDamage` et `demolish` : un conteneur détruit ou
  //      démoli (CHEST) répand son contenu dans un tas au sol (CORPSE).
  //
  // 2. Le sac de destination est plus PETIT, et c'est sûr quand même —
  //    cendreux.ts : le Cendreux (NPC, 40) hérite d'un cadavre (CORPSE, 48). Ce
  //    n'est PAS `NPC ≥ CORPSE` (c'est faux) qui le sauve : le contenu de ce
  //    cadavre vient du sac d'une ENTITÉ (killEntity), et `toBag` le re-fusionne
  //    en piles pleines — il se re-range donc dans au plus autant de cases que la
  //    source. L'invariant qui compte est celui de la source : NPC ≥ PLAYER.
  //
  // Tourner ces boutons en playtest (ce à quoi balance.ts invite) sans respecter
  // la chaîne détruirait des items en silence. Ce test le transforme en échec de CI.
  it('CORPSE ≥ NPC ≥ PLAYER et CORPSE ≥ CHEST — sinon un transfert tronque en silence', () => {
    expect(SLOTS.CORPSE).toBeGreaterThanOrEqual(SLOTS.NPC)
    expect(SLOTS.NPC).toBeGreaterThanOrEqual(SLOTS.PLAYER)
    expect(SLOTS.CORPSE).toBeGreaterThanOrEqual(SLOTS.CHEST)
    // La ceinture est une RÉGION du sac du joueur, pas un sac à part (R7).
    expect(SLOTS.PLAYER).toBeGreaterThanOrEqual(SLOTS.BELT)
  })

  // Le stade « work » de la récolte PNJ (npc.ts) ne s'achève qu'à la CIBLE DE
  // PORTAGE. Si une case pleine du butin en contenait moins, un PNJ pourrait
  // saturer son sac avant d'atteindre la cible, et frapperait alors le buisson
  // pour l'éternité (chaque coup jetant sa récolte, faute de place) sans jamais
  // passer au rangement. Deux boutons de balance.ts, un seul livelock.
  it('une case pleine du butin porte au moins la cible de portage du PNJ', () => {
    for (const item of Object.keys(BALANCE.NPC_CARRY_TARGETS) as (keyof typeof BALANCE.NPC_CARRY_TARGETS)[]) {
      expect(stackSize(item)).toBeGreaterThanOrEqual(BALANCE.NPC_CARRY_TARGETS[item])
    }
  })
})

describe('terrains d\'altitude alpins', () => {
  it('scree est marchable et lent (éboulis)', () => {
    expect(TERRAIN_SCREE).toBe(9)
    // `cover: 1` : l'éboulis n'abrite personne (spec chasse C3).
    expect(TERRAINS[TERRAIN_SCREE]).toEqual({ name: 'scree', walkable: true, speedFactor: 0.7, cover: 1 })
  })
  it('snow est bloquant (pics)', () => {
    expect(TERRAIN_SNOW).toBe(10)
    expect(TERRAINS[TERRAIN_SNOW]!.walkable).toBe(false)
  })
})
