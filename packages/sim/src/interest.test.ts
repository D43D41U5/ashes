import { describe, expect, it } from 'vitest'
import { filtreParInteret, INTEREST_RADIUS_TILES } from './interest'
import type { SnapshotMessage } from './protocol'

/**
 * LA ZONE D'INTÉRÊT — ce qu'elle rogne, et surtout ce qu'elle NE DOIT PAS rogner.
 *
 * Deux erreurs sont possibles ici, et la seconde est bien pire que la première :
 *   • rogner trop peu — on paie du fil pour rien (4,76 Mo/s par client mesurés avant) ;
 *   • rogner ce qui n'est pas spatial — un `nodeDelta` jeté n'est JAMAIS rejoué, et le
 *     client garde à vie un stock faux ; un `event` jeté manque à la chronique. Ces
 *     erreurs-là ne se voient pas au tick suivant, mais des heures après.
 */
const base = (): Omit<SnapshotMessage, 'lastProcessedInput'> =>
  ({
    type: 'snapshot',
    tick: 10,
    time: {} as never,
    entities: [
      { id: 1, x: 100, y: 100 }, // le centre : moi
      { id: 2, x: 110, y: 100 }, // à 10 tuiles : dans la vue
      { id: 3, x: 100 + INTEREST_RADIUS_TILES - 1, y: 100 }, // juste dedans
      { id: 4, x: 100 + INTEREST_RADIUS_TILES + 1, y: 100 }, // juste dehors
      { id: 5, x: 2000, y: 2000 }, // à l'autre bout de la vallée
    ] as never,
    structures: [{ id: 9, tx: 2000, ty: 2000 }] as never,
    villages: [] as never,
    functions: [] as never,
    nodeDeltas: [{ id: 77, stock: 3 }] as never,
    npcs: [{ entityId: 2 }, { entityId: 5 }] as never,
    monsters: [{ entityId: 3 }, { entityId: 4 }] as never,
    corpses: [{ id: 1, x: 2000, y: 2000 }] as never,
    blood: [{ x: 100, y: 101, tick: 1 }, { x: 900, y: 900, tick: 1 }] as never,
    wind: { x: 0, y: 0 },
    groundItems: [{ id: 1, x: 102, y: 100 }, { id: 2, x: 900, y: 900 }] as never,
    events: [{ type: 'village_founded' }] as never,
  }) as never

const moi = { x: 100, y: 100 }

describe('la zone d\'intérêt — ce qui arrive au client, et ce qui reste au serveur', () => {
  it('ne garde que les entités du rayon, bornes comprises', () => {
    const vu = filtreParInteret(base(), moi)
    expect(vu.entities.map((e) => e.id)).toEqual([1, 2, 3])
  })

  it('une bête ou un PNJ suit SON corps — jamais de fiche orpheline', () => {
    // Le piège de ce filtre : garder la fiche d'un monstre dont l'entité n'est plus
    // transmise. Le client ne dessinerait rien et aurait payé le transport.
    const vu = filtreParInteret(base(), moi)
    expect(vu.monsters.map((m) => m.entityId)).toEqual([3]) // 4 est sorti avec son corps
    expect(vu.npcs.map((n) => n.entityId)).toEqual([2]) // 5 aussi
  })

  it('rogne aussi le sang et les piles au sol', () => {
    const vu = filtreParInteret(base(), moi)
    expect(vu.blood).toHaveLength(1)
    expect(vu.groundItems.map((g) => g.id)).toEqual([1])
  })

  it('NE ROGNE PAS ce qui n\'est pas spatial — deltas, événements, bâti', () => {
    const b = base()
    const vu = filtreParInteret(b, moi)
    // Un delta jeté ne serait jamais rejoué : le client garderait un stock faux à vie.
    expect(vu.nodeDeltas).toEqual(b.nodeDeltas)
    // Un événement jeté manquerait à la chronique et à l'alignement.
    expect(vu.events).toEqual(b.events)
    // Le bâti sert au-delà de la vue (carte, overlay) et ne pèse rien.
    expect(vu.structures).toEqual(b.structures)
    // Le cadavre lointain reste : le client SUIT le sien après un respawn au Feu.
    expect(vu.corpses).toEqual(b.corpses)
  })

  it('ne réalloue RIEN quand tout est déjà dans le rayon', () => {
    const b = base()
    // On ne garde QUE ce qui est réellement dans le rayon (le point à 165 en sort).
    b.entities = (b.entities as never as { x: number; y: number }[]).filter((e) => e.x <= 100 + INTEREST_RADIUS_TILES) as never
    const vu = filtreParInteret(b, moi)
    expect(vu, 'le corps commun doit être partagé, pas recopié').toBe(b)
  })

  it('le rayon couvre largement le champ de vision (aucun pop à l\'écran)', () => {
    // La caméra montre 20 tuiles de haut, ~36 de large : demi-diagonale ≈ 20,6 tuiles.
    const demiLarge = 36 / 2
    const demiHaut = 20 / 2
    const demiDiagonaleVue = Math.sqrt(demiLarge * demiLarge + demiHaut * demiHaut)
    expect(INTEREST_RADIUS_TILES).toBeGreaterThan(demiDiagonaleVue * 3)
  })

  it('le centre lui-même est toujours vu (on ne se filtre pas soi-même)', () => {
    const vu = filtreParInteret(base(), moi)
    expect(vu.entities.some((e) => e.x === moi.x && e.y === moi.y)).toBe(true)
  })
})
