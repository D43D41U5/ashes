/**
 * LE MUR MINCE, SUR ARÊTE — les gardes du modèle (décision d'Alexis, 2026-07-27).
 *
 * Un mur ne prend plus sa tuile : il vit sur une ou plusieurs de ses ARÊTES, et ce qu'il bloque
 * n'est plus une case mais un FRANCHISSEMENT. Trois choses doivent tenir, et aucune ne se voit
 * à l'œil :
 *
 *   1. **La migration est silencieuse.** Un mur SANS `edges` se comporte exactement comme avant.
 *      C'est ce qui permet aux villages déjà bâtis, aux parties sauvegardées et aux 800 tests
 *      seedés de ne pas bouger d'un pixel.
 *   2. **L'arête coupe le passage QU'ELLE porte, et elle seule.** Une tuile bordée au nord se
 *      traverse d'est en ouest — c'est tout l'intérêt : la salle garde son dallage.
 *   3. **Les deux gardes de navigabilité suivent.** Ce sont elles qui empêchent d'emmurer son
 *      propre Feu et qui décident du bonus d'enceinte : une erreur ici ne se verrait qu'en
 *      partie, et tard.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS } from './balance'
import { isBlockedAt, moveAvatar } from './collision'
import { blocksNavigation, placementKeepsNavigable, recognizeFunctions, type PlacedStructure } from './construction'
import { createEmptyMap } from './map'
import type { Structure } from './village'

const map = createEmptyMap(32, 32, TERRAIN_GRASS)
const N = 1, E = 2, S = 4, O = 8

/** Un mur, avec ou sans arêtes. `edges` absent = comportement historique (tuile pleine). */
const mur = (tx: number, ty: number, edges?: number): Structure =>
  ({ id: tx * 100 + ty, type: 'wall', tx, ty, villageId: 0, ownerId: 0, access: 'public', hp: 200, edges }) as Structure

describe('la migration est silencieuse', () => {
  it('un mur SANS arêtes bloque sa tuile, exactement comme avant', () => {
    const world = { map, structures: [mur(5, 5)] }
    expect(isBlockedAt(world, 5, 5)).toBe(true)
  })

  it('un mur AVEC arêtes ne bloque PAS sa tuile — on s’y tient', () => {
    const world = { map, structures: [mur(5, 5, N)] }
    expect(isBlockedAt(world, 5, 5)).toBe(false)
  })
})

describe('l’arête coupe le passage qu’elle porte, et lui seul', () => {
  /** Combien de tuiles l'avatar parcourt-il en `pas` pas dans cette direction ? */
  const glisser = (structures: Structure[], x: number, y: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1): { x: number; y: number } => {
    let p = { x, y }
    for (let i = 0; i < 40; i++) p = moveAvatar({ map, structures }, p.x, p.y, dx, dy, 0.05)
    return p
  }

  it('un mur au NORD arrête qui monte, et laisse passer qui longe', () => {
    const murs = [mur(5, 5, N)]
    // Vers le nord, l'arête arrête.
    const versNord = glisser(murs, 5.5, 5.5, 0, -1)
    expect(versNord.y, 'la bande nord doit arrêter').toBeGreaterThan(5)
    // Vers l'est, on LONGE : rien ne s'y oppose — mais il faut se tenir SOUS la bande, et le
    // point de départ se DÉDUIT de l'équilibrage, il ne se recopie pas. Un chiffre écrit à la
    // main (5,62, calibré du temps où la bande valait 0,25) rougit le jour où l'épaisseur
    // change, en accusant le modèle au lieu de la constante.
    //
    // CE QUE LE DOUBLEMENT (`WALL_EDGE_SUB` 2 → 4) A CHANGÉ ICI : la bande occupe la moitié de
    // la tuile, il ne reste que 0,5 de libre — moins que l'avatar (0,6). On ne longe donc plus
    // un mur en marchant SUR sa tuile : on le longe en débordant sur la tuile d'en dessous.
    // C'est cohérent (on ne chevauche pas un mur), et sans effet sur le dedans — c'est très
    // exactement pourquoi la convention pose le mur sur la tuile du DEHORS (test suivant) : la
    // salle garde alors ses tuiles ENTIÈRES, et on s'y tient au centre.
    const bande = BALANCE.WALL_EDGE_SUB / BALANCE.SUBTILES_PER_TILE
    const souslaBande = 5 + bande + BALANCE.AVATAR_HITBOX_TILES / 2 + 0.02
    const versEst = glisser(murs, 5.5, souslaBande, 1, 0)
    expect(versEst.x, 'longer une arête nord doit être libre').toBeGreaterThan(7)
  })

  it('LA CONVENTION : le mur sur la tuile du DEHORS laisse la salle traversable', () => {
    // Le mur appartient à (5,5) et déclare son arête SUD : la bande est à CHEVAL sur la limite
    // (5,5)/(5,6) — une demi-épaisseur de chaque côté. La salle qui commence en (5,6) n'est donc
    // plus tout à fait ENTIÈRE : elle perd `WALL_EDGE_SUB/2` sous-tuiles sur sa première rangée.
    // Ce qui compte reste vrai — la tuile n'est pas bloquée, et on la traverse d'est en ouest —
    // mais il faut se tenir sous la morsure, et cette limite se DÉDUIT de l'équilibrage.
    const murs = [mur(5, 5, S)]
    expect(isBlockedAt({ map, structures: murs }, 5, 6)).toBe(false)
    const morsure = BALANCE.WALL_EDGE_SUB / 2 / BALANCE.SUBTILES_PER_TILE
    const libre = 6 + morsure + BALANCE.AVATAR_HITBOX_TILES / 2 + 0.02
    expect(libre, 'la morsure doit laisser tenir l’avatar dans la tuile').toBeLessThan(7)
    const versEst = glisser(murs, 5.5, libre, 1, 0)
    expect(versEst.x, 'la salle doit rester traversable').toBeGreaterThan(7)
    // Et la sortie par le nord reste fermée : c'est bien un mur.
    const versNord = glisser(murs, 5.5, 6.5, 0, -1)
    expect(versNord.y).toBeGreaterThan(5.7)
  })

  /**
   * LE MUR QUI PARTAGE SA TUILE AVEC UNE PIÈCE MOLLE — le bug du 2026-07-27, en une ligne.
   *
   * Une barrière se pose sur la tuile du DEHORS ; pour la salle d'une ferme, ce dehors est la
   * COUR, et la cour a sa terre battue. La tuile portait donc `terre` PUIS `wall`, et la
   * collision, qui demandait « le solide » (tout sauf sol et toit), recevait la terre : le mur
   * n'était jamais consulté et **on traversait le mur du sud**. La garde ne teste pas la
   * fonction fautive, elle teste le SYMPTÔME — un marcheur, un mur, et l'ordre de pose.
   */
  it('un mur BLOQUE même s’il partage sa tuile avec une pièce molle posée avant lui', () => {
    const terre = { id: 1, type: 'terre', tx: 5, ty: 5, villageId: 0, ownerId: 0, access: 'public', hp: 50 } as Structure
    const murs = [terre, mur(5, 5, N)] //  l'ordre COMPTE : c'est celui du monde bâti
    const versSud = glisser(murs, 5.5, 4.5, 0, 1)
    expect(versSud.y, 'la bande nord doit arrêter, terre ou pas').toBeLessThan(5)
  })

  it('une arête déclarée par le VOISIN coupe aussi — deux tuiles partagent une arête', () => {
    // Le mur est sur (5,4) et déclare son arête SUD : c'est la même que l'arête NORD de (5,5).
    const versNord = glisser([mur(5, 4, S)], 5.5, 5.5, 0, -1)
    expect(versNord.y).toBeGreaterThan(5)
  })

  it('sans arête de ce côté, on passe', () => {
    const versNord = glisser([mur(5, 5, S)], 5.5, 5.5, 0, -1)
    expect(versNord.y, 'une arête SUD ne doit pas fermer le nord').toBeLessThan(4)
  })
})

describe('les deux gardes de navigabilité suivent', () => {
  const feu = { tx: 10, ty: 10 }
  const entites = [{ id: 1, x: 10.5, y: 10.5, hp: 100 }]
  /** L'enceinte MINCE d'une tuile : les quatre arêtes de (10,10), moins celle qu'on va poser. */
  const carre = (sauf: number): PlacedStructure[] =>
    ([N, E, S, O].filter((b) => b !== sauf)).map((b, i) => ({ tx: 10, ty: 10, type: 'wall' as const, edges: b, id: i } as never))

  it('refuse la pose qui FERME l’enceinte du Feu, même en murs minces', () => {
    const derniere = { tx: 10, ty: 10, type: 'wall' as const, edges: O } as never
    expect(placementKeepsNavigable(map, carre(O), entites, 99, feu, 3, derniere)).toBe(false)
  })

  it('accepte une arête qui ne ferme rien', () => {
    const ailleurs = { tx: 4, ty: 4, type: 'wall' as const, edges: N } as never
    expect(placementKeepsNavigable(map, [], entites, 99, feu, 3, ailleurs)).toBe(true)
  })

  it('reconnaît une enceinte de murs MINCES autour d’un composant', () => {
    // Un établi seul, ceint des quatre arêtes de sa tuile et couvert : l'Atelier doit se
    // déclarer CLOS. Sans le test de franchissement, le remplissage sortirait et dirait non.
    const s = [
      { id: 1, type: 'workshop' as const, tx: 7, ty: 7, villageId: 1 },
      { id: 2, type: 'roof' as const, tx: 7, ty: 7, villageId: 1 },
      ...[N, E, S, O].map((b, i) => ({ id: 10 + i, type: 'wall' as const, tx: 7, ty: 7, villageId: 1, edges: b })),
    ]
    const f = recognizeFunctions(s).find((x) => x.functionId === 'atelier')
    expect(f?.enclosed, 'une enceinte d’arêtes doit compter comme une enceinte').toBe(true)
  })

  it('une arête MANQUANTE ouvre l’enceinte — la ruine reste une ruine', () => {
    const s = [
      { id: 1, type: 'workshop' as const, tx: 7, ty: 7, villageId: 1 },
      { id: 2, type: 'roof' as const, tx: 7, ty: 7, villageId: 1 },
      ...[N, E, S].map((b, i) => ({ id: 10 + i, type: 'wall' as const, tx: 7, ty: 7, villageId: 1, edges: b })),
    ]
    const f = recognizeFunctions(s).find((x) => x.functionId === 'atelier')
    expect(f?.enclosed).toBe(false)
  })
})

describe('le vocabulaire ne bouge pas', () => {
  it('un mur reste bloquant au sens de la navigabilité, arêtes ou non', () => {
    expect(blocksNavigation('wall')).toBe(true)
    expect(blocksNavigation('roof')).toBe(false)
  })
})
