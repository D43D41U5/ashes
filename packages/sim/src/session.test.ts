import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS } from './balance'
import { type ResourceNode } from './economy'
import { drainEvents } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { TICKS_PER_CYCLE } from './time'

/**
 * LA SESSION SOLO — le banc qui dit si le jeu est JOUABLE.
 *
 * Un monde qui punit tout le monde n'est pas exigeant : il est cassé. Le chantier
 * tension a rendu la faim mortelle, la nourriture périssable, la nuit hostile et la
 * récolte médiocre autour du camp. Il faut donc prouver les DEUX bords :
 *
 *   - qui joue BIEN survit (sinon c'est injuste — et injouable) ;
 *   - qui joue MAL meurt (sinon rien de tout cela n'a servi à rien).
 *
 * Le bot ne triche pas : il joue avec les mêmes actions qu'un humain, aux mêmes
 * cadences. S'il s'en sort, un joueur qui a compris les règles s'en sortira.
 */
const me = (sim: SimState) => sim.entities[0]!

function act(sim: SimState, id: number, action: PlayerAction): void {
  step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
}

/** Récolte un nœud jusqu'à `want`, en respectant le rechargement. */
function recolter(sim: SimState, id: number, nodeId: number, item: 'wood' | 'berries' | 'fiber', want: number): void {
  for (let g = 0; g < 400 && countOf(me(sim).inventory, item) < want; g++) {
    const node = sim.nodes.find((n) => n.id === nodeId)!
    if (node.stock <= 0) break
    act(sim, id, { type: 'harvest', nodeId })
    for (let t = 1; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
  }
}

/** Le monde du banc : de quoi vivre à portée de main — le reste est au joueur. */
function mondeSolo(): { sim: SimState; id: number } {
  const nodes: ResourceNode[] = [
    { id: 1, type: 'berry_bush', tx: 11, ty: 10, stock: 8, regrowAt: 0 },
    { id: 2, type: 'berry_bush', tx: 9, ty: 10, stock: 8, regrowAt: 0 },
    { id: 3, type: 'berry_bush', tx: 10, ty: 11, stock: 8, regrowAt: 0 },
    { id: 4, type: 'tree', tx: 10, ty: 9, stock: 10, regrowAt: 0 },
    { id: 5, type: 'tree', tx: 12, ty: 11, stock: 10, regrowAt: 0 },
    { id: 6, type: 'fiber_plant', tx: 9, ty: 11, stock: 6, regrowAt: 0 },
  ]
  const sim = createSim(21, { map: createEmptyMap(32, 32, TERRAIN_GRASS), nodes })
  const id = spawnEntity(sim, 10.5, 10.2)
  return { sim, id }
}

describe('LA SESSION SOLO — le jeu est-il jouable ?', () => {
  it('QUI JOUE BIEN SURVIT : ramasser, faire du feu, CUISINER, manger', () => {
    const { sim, id } = mondeSolo()

    // 1. Le bois d'abord — sans Feu, on ne cuisine pas, et sans cuisine on meurt.
    recolter(sim, id, 4, 'wood', 10)
    act(sim, id, { type: 'light_fire' })
    expect(sim.villages).toHaveLength(1)

    // 2. De quoi faire un ragoût (4 baies + 1 fibre) — et de la marge.
    recolter(sim, id, 6, 'fiber', 3)
    recolter(sim, id, 1, 'berries', 8)
    recolter(sim, id, 2, 'berries', 14)

    // 3. Vivre : deux cycles (1h36 de jeu). Le bot joue comme un joueur qui a
    //    compris : il RÉCOLTE tout ce qui a repoussé dès qu'il en manque, il CUISINE
    //    dès qu'il peut, et il mange avant d'être à sec. Rien de virtuose — juste
    //    quelqu'un qui ne subit pas.
    let ragouts = 0
    for (let t = 0; t < 2 * TICKS_PER_CYCLE; t++) {
      // La tournée des nœuds, toutes les ~30 s : c'est ce que fait n'importe qui
      // qui n'a pas envie de mourir. Les buissons repoussent lentement — il faut
      // donc y retourner SOUVENT, et ne rien laisser derrière soi.
      if (t % 600 === 0) {
        for (const n of sim.nodes) {
          if (n.stock <= 0) continue
          if (n.type === 'berry_bush' && countOf(me(sim).inventory, 'berries') < 16) {
            recolter(sim, id, n.id, 'berries', 16)
          } else if (n.type === 'fiber_plant' && countOf(me(sim).inventory, 'fiber') < 6) {
            recolter(sim, id, n.id, 'fiber', 6)
          }
        }
      }

      const faim = me(sim).hunger
      if (faim < 60 && countOf(me(sim).inventory, 'stew') > 0) {
        act(sim, id, { type: 'eat', item: 'stew' })
      } else if (
        me(sim).craftQueue.length === 0 &&
        countOf(me(sim).inventory, 'berries') >= 4 &&
        countOf(me(sim).inventory, 'fiber') >= 1 &&
        countOf(me(sim).inventory, 'stew') < 2
      ) {
        // ON CUISINE. C'est ça, la règle : le cru ne nourrit pas un homme.
        act(sim, id, { type: 'craft', recipeId: 'stew' })
      } else if (faim < 30 && countOf(me(sim).inventory, 'berries') > 0) {
        act(sim, id, { type: 'eat', item: 'berries' }) // le dépannage, pas le régime
      } else {
        step(sim, [])
      }
      for (const ev of drainEvents(sim)) if (ev.type === 'item_crafted' && ev.item === 'stew') ragouts += 1
    }

    // IL EST VIVANT. Le jeu est dur, il n'est pas injuste : qui a compris la boucle
    // (bois → feu → cuisine) traverse ses deux premiers jours.
    expect(me(sim).hp).toBeGreaterThan(0)
    expect(me(sim).hunger).toBeGreaterThan(0)
    expect(ragouts).toBeGreaterThan(0) // il a bel et bien cuisiné : c'est ÇA, la parade
  })

  it('QUI JOUE MAL MEURT : rester assis, ne rien faire, ignorer sa faim', () => {
    const { sim } = mondeSolo()
    drainEvents(sim)

    // Il ne fait RIEN. Avant le chantier tension, ce joueur s'en tirait sans y
    // penser : la faim ne tuait pas, et un buisson valait trois heures de survie.
    let morts = 0
    for (let t = 0; t < 2 * TICKS_PER_CYCLE; t++) {
      step(sim, [])
      for (const e of drainEvents(sim)) {
        if (e.type === 'entity_died' && e.entityId === 1 && e.cause === 'hunger') morts += 1
      }
    }

    // IL EST MORT DE FAIM. Dans Braises la mort n'est pas une fin (GDD §7 : « chère,
    // pas cruelle ») — on renaît au Feu, nu, épuisé, tout son butin sur le cadavre.
    // Ce qu'on exige ici, c'est que l'erreur SE PAIE : elle se payait par rien.
    expect(morts).toBeGreaterThanOrEqual(1)

    // …et pas par une BOUCLE DE MORT : il renaît avec de quoi réagir, pas déjà
    // condamné. Une punition dont on ne peut pas se relever n'est pas une punition,
    // c'est la fin de la partie.
    expect(morts).toBeLessThanOrEqual(3)
  })

  it('LA CUEILLETTE SEULE NE SUFFIT PAS : manger des baies crues ne tient pas un homme', () => {
    const { sim, id } = mondeSolo()

    // Il cueille et croque, sans jamais faire de feu — la stratégie qui marchait
    // AVANT (un buisson = 171 minutes de survie).
    let baiesMangees = 0
    for (let t = 0; t < 2 * TICKS_PER_CYCLE; t++) {
      const e = me(sim)
      if (e.hp <= 0) break
      if (e.hunger < 40 && countOf(e.inventory, 'berries') > 0) {
        act(sim, id, { type: 'eat', item: 'berries' })
        baiesMangees += 1
      } else if (t % 300 === 0) {
        for (const n of sim.nodes) {
          if (n.type === 'berry_bush' && n.stock > 0) recolter(sim, id, n.id, 'berries', 20)
        }
        step(sim, [])
      } else {
        step(sim, [])
      }
    }

    // Il a mangé — beaucoup —, et il a quand même souffert : les buissons se vident,
    // ils repoussent lentement, et les baies POURRISSENT dans son sac. La cueillette
    // est un dépannage, pas un mode de vie. (On n'exige pas qu'il MEURE : on exige
    // que ça ne soit plus une promenade.)
    expect(baiesMangees).toBeGreaterThan(5)
    expect(me(sim).hunger).toBeLessThan(60) // il vit sur le fil, jamais rassasié
  })
})
