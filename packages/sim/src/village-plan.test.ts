/**
 * LE CAMPEMENT POSÉ, ET LE GRENIER COMME FONCTION — ce qui survit au plan directeur.
 *
 * ⚠ CE FICHIER S'APPELAIT « L'ÉVOLUTION DES VILLAGES PNJ » (spec `village-pnj-evolution.md`,
 * critères R1-R10) ET IL A PERDU HUIT DE SES DOUZE GARDES LE 2026-09-29, avec le plan directeur
 * (tranche 4 du retrait des villages PNJ, pivot de la braise du 2026-09-28). Ce qui est parti,
 * et pourquoi chacune n'avait plus de sujet :
 *
 *   · « le plan directeur (R3) : au palier 2, il veut la PALISSADE puis les logis, et rien deux
 *     fois » — c'était `desiredOrders` en personne ;
 *   · « le déterminisme (R10) : deux runs identiques, CHANTIER COMPRIS » — sans chantier, elle
 *     se réduisait à « deux mondes identiques le restent », que `sim.test.ts` et `replay.test.ts`
 *     gardent déjà, et mieux (même seed + mêmes inputs = même état ET même flux d'événements) ;
 *   · les QUATRE de « le logis est couvert et défriché » (décision d'Alexis du 2026-08-20 : « les
 *     PNJ mettent un toit et un sol à leurs maisons et coupent tout arbre à l'intérieur ») et les
 *     DEUX de « la cour entière se défriche » — toutes lisaient les ordres rendus par
 *     `desiredOrders`. ⚠ **La moitié utile de leur loi est recueillie ailleurs, pas perdue** : que
 *     rien de `renewable` ne se défriche est désormais demandé à `noeudDefrichable` lui-même
 *     (`peche.test.ts`, « un coin de pêche ne se défriche pas »), et c'est la forme forte — on
 *     interroge la RÈGLE, plus un consommateur. Ce qui ne se mesure plus, et il faut le dire :
 *     qu'un bâtisseur COMMANDE un toit et défriche sa cour avant de bâtir. Le jour où la balise
 *     ouvre un rayon de construction, c'est cette promesse-là qu'il faudra réécrire.
 *
 * Restent quatre gardes, et toutes ont un sujet VIVANT : le campement que `foundNpcVillage`
 * bâtit encore (le worldgen le pose à la naissance), la palissade au marteau DU JOUEUR, et le
 * grenier comme FONCTION — que le rapport du banc lit toujours.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS } from './balance'
import { drainEvents } from './events'
import { addItems } from './items'
import { createEmptyMap } from './map'
import type { ResourceNode } from './economy'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { addStructure } from './village'
import { estGrenier } from './village-plan'
import { STRUCTURE_TYPES, piece } from './pieces'
import { foundNpcVillage } from './worldgen'

function npcVillageSim(count = 3): SimState {
  const map = createEmptyMap(28, 28, TERRAIN_GRASS)
  const nodes: ResourceNode[] = [
    { id: 1, type: 'berry_bush', tx: 24, ty: 12, stock: 12, regrowAt: 0 },
    { id: 2, type: 'tree', tx: 3, ty: 12, stock: 12, regrowAt: 0 },
    { id: 3, type: 'fiber_plant', tx: 12, ty: 24, stock: 8, regrowAt: 0 },
    { id: 4, type: 'rock', tx: 24, ty: 24, stock: 12, regrowAt: 0 },
  ]
  const sim = createSim(11, { map, nodes, worldEvents: false })
  foundNpcVillage(sim, 12, 12, count)
  drainEvents(sim)
  return sim
}

const village = (sim: SimState) => sim.villages[0]!

describe('la fondation au campement (R1-R2)', () => {
  it('plus aucune house : des paillasses, le mobilier, et rien d’autre', () => {
    const sim = npcVillageSim(3)
    const types = sim.structures.map((s) => s.type)
    expect(types.filter((t) => t === 'house')).toHaveLength(0)
    expect(types.filter((t) => t === 'paillasse')).toHaveLength(3)
    // Et RIEN d'autre que le Feu et le grenier : pas de mobilier — il ferait
    // couverture dans la mêlée (mesuré, voir village-plan.ts).
    expect(sim.structures).toHaveLength(5)
  })

  // ⚠ « LA PAILLASSE EST UN DOMICILE : chaque PNJ en reçoit une » est partie le 2026-09-29 :
  // plus aucun dormeur à loger. Ce qui reste ci-dessus — le campement POSÉ, des paillasses et
  // pas de `house` — se voit toujours sur la carte, et c'est ce que `foundNpcVillage` bâtit.
  // ⚠ Et les paillasses n'ont plus PERSONNE dessus : c'est du DÉCOR, question ouverte pour
  // Alexis (voir l'en-tête de `village-plan.ts`).
})

describe('la palissade au marteau du joueur (décision 2026-08-01)', () => {
  it('se pose sur une arête ; la pose pleine-tuile est refusée avec son motif', () => {
    const sim = createSim(3, { map: createEmptyMap(32, 32, TERRAIN_GRASS) })
    const player = spawnEntity(sim, 15.5, 15.5)
    const e = sim.entities.find((x) => x.id === player)!
    addItems(e.inventory, { wood: 20, hammer: 1 })
    e.activeSlot = e.inventory.findIndex((s) => s?.item === 'hammer')
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    drainEvents(sim)

    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'build', structure: 'palissade', tx: 17, ty: 15, edges: 1 } }])
    const posee = sim.structures.find((s) => s.type === 'palissade')
    expect(posee).toBeDefined()
    expect(posee!.edges).toBe(1)
    expect(posee!.ownerId).toBe(player)

    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'build', structure: 'palissade', tx: 18, ty: 15 } }])
    const evs = drainEvents(sim)
    expect(evs.some((ev) => ev.type === 'action_rejected' && ev.reason === 'la palissade se pose sur une arête')).toBe(true)
    expect(sim.structures.filter((s) => s.type === 'palissade')).toHaveLength(1)
  })
})

describe('le grenier est une FONCTION, pas un type (P0.3)', () => {
  /**
   * Le registre déclare `silo`, `cave` et `reserve` avec `fonction: 'grenier'` et
   * `capacite: 36` ; le prédicat ne reconnaissait que `chest`. Le bourg montait donc sa
   * réserve — 8 bois et 4 fibres — et n'en tirait rien : elle ne comptait pas dans les stocks,
   * et le village mourait en perdant son coffre à 4 bois, une réserve pleine sous les yeux.
   *
   * La garde balaie TOUTES les pièces que le registre déclare grenier, pas le seul silo :
   * ajouter un quatrième palier ne doit pas rouvrir ce trou.
   *
   * ⚠ RÉÉCRITE LE 2026-09-29 : elle passait par `granaries` et `granaryStocks`, partis avec le
   * plan directeur. Elle demande maintenant au PRÉDICAT lui-même — `estGrenier` —, qui est ce
   * que la coupe a gardé exprès parce que le rapport du banc le lit (`scenario.ts`). Même loi,
   * un cran plus près de sa source.
   */
  const PIECES_GRENIER = STRUCTURE_TYPES.filter((t) => piece(t).fonction === 'grenier')

  it('P0.3a — la garde voit ce qu’elle garde : le registre porte bien des greniers non-coffres', () => {
    expect(PIECES_GRENIER.length).toBeGreaterThanOrEqual(3)
    expect(PIECES_GRENIER).not.toContain('chest') // le coffre en est un par son ACCÈS, pas par sa fonction
  })

  it('P0.3b — chaque pièce à `fonction: grenier` est reconnue comme grenier du village', () => {
    for (const type of PIECES_GRENIER) {
      const sim = npcVillageSim()
      const v = village(sim)
      // On retire le coffre de fondation : il ne reste QUE la réserve bâtie.
      sim.structures = sim.structures.filter((s) => s.type !== 'chest')
      const s = addStructure(sim, type, 14, 12, v.id, 0)
      s.access = 'village'
      addItems(s.inventory ??= [], { berries: 9 })
      expect(sim.structures.filter((st) => estGrenier(st, v.id)).map((st) => st.type)).toEqual([type])
      // ET LA PRÉMISSE NÉGATIVE, sans quoi le prédicat pourrait dire « oui » à tout : un accès
      // PRIVÉ sur la même pièce la sort du grenier commun (c'est l'ACCÈS qui tranche, pas le type).
      s.access = 'private'
      expect(sim.structures.filter((st) => estGrenier(st, v.id))).toHaveLength(0)
    }
  })

  // ⚠ « P0.3c — et le tableau ne se tait plus » est partie le 2026-09-29 avec le tableau du
  // village. Sa loi utile survit en P0.3b : un silo EST un grenier du village — c'était la
  // prémisse dont le tableau se servait. C'est le consommateur qui a disparu, pas la règle.
})
