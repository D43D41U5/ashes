import { describe, expect, it } from 'vitest'
import { MONSTER_DEFS, SLOTS, TERRAIN_GRASS, type MonsterType } from './balance'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, type Entity, type SimState } from './sim'
import { spawnMonster } from './monsters'
import { applyDamage } from './combat'
import { countOf, isEmpty } from './items'

/**
 * LE SAC D'UNE BÊTE — une bête n'est pas un porteur, et la donnée le dit enfin.
 *
 * Toutes les espèces naissaient avec le sac d'un PNJ (40 cases). La raison écrite était
 * vraie, mais pour UNE seule d'entre elles : le Cendreux levé hérite du butin d'un cadavre
 * entier. Les cinq autres ne portent rien — leur butin vient de `MONSTER_DEFS[type].loot`,
 * versé dans le CADAVRE à la mort.
 *
 * Le prix était MESURÉ : un lapin pesait **574 octets de JSON dont 201 pour son sac vide**,
 * soit un sac plus GROS que celui d'un humain (18 cases, 91 o) — répété pour ~600 bêtes,
 * dans le snapshot de chaque client, vingt fois par seconde. Après : **375 octets, sac à 2**.
 *
 * Ces gardes tiennent les deux bouts : la maigreur ne doit pas coûter une miette de butin.
 */
const TYPES = Object.keys(MONSTER_DEFS) as MonsterType[]

function monde(): SimState {
  return createSim(1, { map: createEmptyMap(48, 48, TERRAIN_GRASS) })
}

const entiteDe = (sim: SimState, id: number): Entity => sim.entities.find((e) => e.id === id)!

describe('le sac des bêtes — déclaré par espèce, et nul pour presque toutes', () => {
  it('seul le Cendreux porte un sac ; toutes les autres espèces en ont zéro', () => {
    const porteurs = TYPES.filter((t) => MONSTER_DEFS[t].sac > 0)
    expect(porteurs).toEqual(['cendreux'])
    expect(MONSTER_DEFS.cendreux.sac).toBe(SLOTS.NPC) // il doit tenir un cadavre entier
  })

  it('une bête naît donc les mains vides, sans un octet de sac', () => {
    const sim = monde()
    for (const t of TYPES) {
      const e = entiteDe(sim, spawnMonster(sim, t, 10, 10))
      expect(e.inventory.length, `${t} : sac`).toBe(MONSTER_DEFS[t].sac)
      expect(isEmpty(e.inventory), `${t} : sac non vide à la naissance`).toBe(true)
    }
  })

  /**
   * LA GARDE QUI COMPTE. Un sac à zéro ne doit RIEN faire perdre : le butin d'une bête
   * n'a jamais transité par son sac, il naît dans le cadavre. Si cette hypothèse était
   * fausse, la chasse rendrait des carcasses vides — et rien d'autre ne le dirait.
   */
  it('le butin arrive au cadavre malgré le sac nul (la chasse rend toujours)', () => {
    const sim = monde()
    const chasseur = spawnEntity(sim, 5, 5)
    let verifiees = 0
    for (const t of TYPES) {
      const attendu = MONSTER_DEFS[t].loot
      if (Object.keys(attendu).length === 0) continue // le zombie ne laisse rien
      const avant = sim.corpses.length
      const bete = entiteDe(sim, spawnMonster(sim, t, 20, 20))
      applyDamage(sim, bete, 9_999, chasseur)
      expect(sim.corpses.length, `${t} : pas de cadavre`).toBe(avant + 1)
      const cadavre = sim.corpses[sim.corpses.length - 1]!
      for (const [item, n] of Object.entries(attendu)) {
        expect(countOf(cadavre.inventory, item as never), `${t} : ${item} perdu`).toBeGreaterThanOrEqual(n)
      }
      verifiees += 1
    }
    expect(verifiees, 'aucune espèce à butin : le test ne garde rien').toBeGreaterThan(2)
  })

  it("le Cendreux garde de quoi hériter d'un cadavre entier", () => {
    // C'est LA raison d'être du grand sac : `cendreux.ts` y verse le contenu du cadavre
    // dont il se lève. Un sac rétréci ferait tomber le butin par terre à chaque levée.
    expect(MONSTER_DEFS.cendreux.sac).toBeGreaterThanOrEqual(SLOTS.NPC)
  })

  it("une bête pèse désormais moins qu'un humain sur le fil (le gain, chiffré)", () => {
    const sim = monde()
    const humain = entiteDe(sim, spawnEntity(sim, 5, 5))
    const lapin = entiteDe(sim, spawnMonster(sim, 'rabbit', 20, 20))
    const poids = (e: Entity): number => JSON.stringify(e).length
    // Avant, un lapin pesait PLUS qu'un joueur (574 contre 466) à cause de son seul sac.
    expect(poids(lapin)).toBeLessThan(poids(humain))
    expect(JSON.stringify(lapin.inventory).length).toBeLessThan(10) // « [] », et rien de plus
  })
})
