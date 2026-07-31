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
 * vraie, mais pour UN seul individu : le Cendreux LEVÉ, qui hérite du butin d'un cadavre
 * entier. Toutes les bêtes, Cendreux compris, ne portent rien — leur butin vient de
 * `MONSTER_DEFS[type].loot`, versé dans le CADAVRE à la mort ; et les 40 cases se demandent
 * à la levée (`sacOverride`), le seul endroit où un cadavre est là pour les remplir.
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
  /**
   * PLUS AUCUNE ESPÈCE ne porte de sac (spec `cendreux.md` A11, 2026-07-31). Le Cendreux
   * était la seule exception, et elle est tombée quand il a absorbé le zombie : depuis, une
   * horde d'acte III en lève 12 et la méga-horde 16, dont AUCUN n'hérite d'un cadavre. Le
   * sac de 40 cases se demande maintenant à la LEVÉE seule (`spawnMonster(..., SLOTS.NPC)`),
   * garde vérifiée dans `cendreux.test.ts` — sans quoi c'étaient 12 à 16 inventaires vides
   * de plus dans chaque snapshot, vingt fois par seconde.
   */
  it('aucune espèce ne porte de sac — pas même le Cendreux', () => {
    const porteurs = TYPES.filter((t) => MONSTER_DEFS[t].sac > 0)
    expect(porteurs).toEqual([])
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
      if (Object.keys(attendu).length === 0) continue // le Cendreux ne laisse rien (il PORTE)
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

  it("le Cendreux LEVÉ garde de quoi hériter d'un cadavre entier", () => {
    // C'est LA raison d'être du grand sac : `cendreux.ts` y verse le contenu du cadavre dont
    // il se lève. Il ne vient plus de l'espèce mais de l'appel — on vérifie donc le CHEMIN
    // et non la table, sinon la garde ne garde plus rien.
    const sim = monde()
    const leve = entiteDe(sim, spawnMonster(sim, 'cendreux', 10, 10, SLOTS.NPC))
    expect(leve.inventory.length).toBeGreaterThanOrEqual(SLOTS.NPC)
    // …et celui d'une horde, lui, naît les mains vides.
    const deHorde = entiteDe(sim, spawnMonster(sim, 'cendreux', 12, 10))
    expect(deHorde.inventory.length).toBe(0)
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
