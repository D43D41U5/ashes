/**
 * LE JOUEUR POSE SUR L'ARÊTE — les gardes du mode construction en arête (spec construction R23,
 * décision d'Alexis, 2026-07-30).
 *
 * Le modèle du mur mince existait depuis le 2026-07-27, mais **seul le bâti généré en écrivait**
 * (`poi-batis.ts`) : l'action du joueur ne portait pas d'arête, et `A`/`E` étaient déclarées sans
 * lecteur. Le brancher a ouvert trois portes que `wall-edges.test.ts` ne pouvait pas voir, parce
 * qu'elles ne sont pas dans la collision mais dans la POSE :
 *
 *   1. **L'occupation devient une question d'ARÊTE.** `solidAt` rendait « la première structure
 *      qui n'est ni sol ni toit » — donc un mur d'arête. Trois portes de pose s'y adossaient, et
 *      elles refusaient toutes les trois dès la première arête posée : le COIN d'une pièce
 *      (impossible à fermer), le four ADOSSÉ à son propre mur, le feu de camp contre sa clôture.
 *      Aucune ne LEVAIT — elles disaient « tuile occupée », ce qui se lit comme une règle.
 *   2. **Une arête a DEUX adresses.** Le mur entre (5,5) et (5,6) s'écrit « (5,5)+S » ou
 *      « (5,6)+N ». Sans question symétrique, le joueur qui contourne son mur le rebâtit :
 *      il paie deux fois, et deux sprites se superposent dans une bande de 8 px.
 *   3. **Une bête cherchait le bloqueur SUR la tuile d'arrivée.** Le mur qui lui barre la route
 *      est souvent déclaré sur SA tuile à elle, bit tourné vers la destination. Elle ne trouvait
 *      donc rien à frapper : une enceinte de murs minces aurait été une défense qu'on ignore.
 *
 * Sim-first, headless : seed + inputs → état attendu.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, TERRAIN_GRASS } from './balance'
import { crossingBlocker, edgeBarrierAt, fullTileAt, recognizeFunctions } from './construction'
import { EDGE_BITS, EDGE_E, EDGE_N, EDGE_O, EDGE_S, edgeStep, oppositeEdge } from './geometry'
import { drainEvents } from './events'
import { createEmptyMap } from './map'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { addStructure, evaluateBuild, fireRadius, grantItems, structureAt, structureBlocks, type Structure } from './village'

// ─── Le banc : un colon, un foyer, un marteau en main ────────────────────────

function makeSim(): SimState {
  return createSim(1, { map: createEmptyMap(160, 160, TERRAIN_GRASS) })
}

function act(sim: SimState, id: number, action: PlayerAction): void {
  step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
}

function rejections(sim: SimState): string[] {
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

function slotOf(sim: SimState, id: number, item: string): number {
  return sim.entities.find((e) => e.id === id)!.inventory.findIndex((s) => s?.item === item)
}

/** Un colon planté en (x,y), fourni de quoi bâtir longtemps, marteau EN MAIN, foyer allumé. */
function batisseur(sim: SimState, x: number, y: number): number {
  const id = spawnEntity(sim, x + 0.5, y + 0.5)
  grantItems(sim, id, { campfire: 1, hammer: 1, wood: 80, stone: 40, cut_stone: 40 })
  act(sim, id, { type: 'set_active_slot', slot: slotOf(sim, id, 'campfire') })
  act(sim, id, { type: 'place_campfire', tx: x + 1, ty: y })
  act(sim, id, { type: 'found_village', structureId: structureAt(sim.structures, x + 1, y)!.id })
  act(sim, id, { type: 'set_active_slot', slot: slotOf(sim, id, 'hammer') })
  drainEvents(sim)
  return id
}

/** Les murs qui portent une arête sur cette tuile — l'inventaire du coin. */
const aretesDe = (sim: SimState, tx: number, ty: number): Structure[] =>
  sim.structures.filter((s) => s.tx === tx && s.ty === ty && s.edges !== undefined)

// ─────────────────────────────────────────────────────────────────────────────
// LES DEUX QUESTIONS PURES, BALAYÉES SUR TOUT LEUR ESPACE.
//
// Ce sont quatre bits et quatre directions : l'espace ENTIER tient en seize cas, donc on ne
// choisit pas d'exemples — on les prend tous. Un cas choisi à la main aurait très bien pu tomber
// sur la seule direction où l'inversion N/S ne se voit pas.

describe('l’arête a deux adresses — `edgeBarrierAt` les voit toutes les deux', () => {
  const mur = (tx: number, ty: number, edges: number): Structure =>
    ({ id: tx * 100 + ty + edges, type: 'wall', tx, ty, villageId: 1, ownerId: 1, access: 'public', hp: 200, edges }) as Structure

  it('un mur déclaré ICI se trouve depuis les DEUX tuiles, sur les quatre arêtes', () => {
    for (const bit of EDGE_BITS) {
      const { dx, dy } = edgeStep(bit)
      const monde = [mur(10, 10, bit)]
      expect(edgeBarrierAt(monde, 10, 10, bit), `bit ${bit} depuis sa propre tuile`).toBeDefined()
      // La MÊME maçonnerie, vue d'en face : le voisin la nomme par le bit opposé.
      expect(edgeBarrierAt(monde, 10 + dx, 10 + dy, oppositeEdge(bit)), `bit ${bit} depuis le voisin`).toBeDefined()
      // Et elle ne déborde sur AUCUNE des trois autres arêtes de sa propre tuile.
      for (const autre of EDGE_BITS) {
        if (autre === bit) continue
        expect(edgeBarrierAt(monde, 10, 10, autre), `bit ${bit} ne doit pas répondre pour ${autre}`).toBeUndefined()
      }
    }
  })

  it('un mur PLEINE TUILE ne porte aucune arête — la migration reste silencieuse', () => {
    const plein = { id: 1, type: 'wall', tx: 10, ty: 10, villageId: 1, ownerId: 1, access: 'public', hp: 200 } as Structure
    for (const bit of EDGE_BITS) expect(edgeBarrierAt([plein], 10, 10, bit)).toBeUndefined()
    // …mais il prend bien sa tuile, lui, et c'est ce que l'autre question doit dire.
    expect(fullTileAt([plein], 10, 10)).toBeDefined()
    expect(fullTileAt([mur(10, 10, EDGE_N)], 10, 10), 'une arête ne prend PAS la tuile').toBeUndefined()
  })

  it('`crossingBlocker` barre le franchissement que l’arête porte, et lui seul', () => {
    const passe = (): boolean => true
    for (const bit of EDGE_BITS) {
      const { dx, dy } = edgeStep(bit)
      // Déclaré CHEZ MOI : c'est le cas que `solidAt(destination)` ratait — la destination est vide.
      const chezMoi = [mur(10, 10, bit)]
      expect(fullTileAt(chezMoi, 10 + dx, 10 + dy), 'la destination est bien vide').toBeUndefined()
      expect(crossingBlocker(chezMoi, 10, 10, dx, dy, passe), `sortir par ${bit}`).toBeDefined()
      // Déclaré CHEZ LE VOISIN, bit opposé : la même maçonnerie, l'autre adresse.
      const chezLui = [mur(10 + dx, 10 + dy, oppositeEdge(bit))]
      expect(crossingBlocker(chezLui, 10, 10, dx, dy, passe), `sortir par ${bit}, mur déclaré en face`).toBeDefined()
      // Les trois autres sorties restent libres : un mur au nord ne ferme pas l'est.
      for (const autre of EDGE_BITS) {
        if (autre === bit) continue
        const pas = edgeStep(autre)
        expect(crossingBlocker(chezMoi, 10, 10, pas.dx, pas.dy, passe), `${bit} ne doit pas fermer ${autre}`).toBeUndefined()
      }
    }
  })

  it('une porte laisse passer les siens et barre les autres — le filtre suit l’arête', () => {
    const porte = { id: 1, type: 'door', tx: 10, ty: 10, villageId: 7, ownerId: 1, access: 'village', hp: 100, edges: EDGE_N } as Structure
    const membre = crossingBlocker([porte], 10, 10, 0, -1, (s) => s.villageId !== 7)
    const etranger = crossingBlocker([porte], 10, 10, 0, -1, (s) => s.villageId === 7)
    expect(membre, 'le sien entre').toBeUndefined()
    expect(etranger, 'l’étranger bute').toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LA POSE, PAR L'ACTION RÉELLE.

describe('poser un mur sur une arête (R23)', () => {
  it('LE COIN D’UNE PIÈCE : deux arêtes sur la même tuile, deux murs distincts', () => {
    // C'est le cas que `solidAt` interdisait, et il n'est pas exotique : toute pièce a quatre
    // coins. La deuxième pose trouvait la première et refusait « tuile occupée ».
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_N })
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_O })
    expect(rejections(sim), 'aucune des deux poses ne doit être refusée').toEqual([])
    const coin = aretesDe(sim, 41, 41)
    expect(coin).toHaveLength(2)
    expect(coin.map((s) => s.edges).sort()).toEqual([EDGE_N, EDGE_O].sort())
    // DEUX STRUCTURES, donc DEUX FOIS LES PV (décision d'Alexis) : un pillard qui casse le coin
    // ouvre UN côté. C'est la conséquence de jeu de la granularité, et elle s'affirme ici.
    expect(new Set(coin.map((s) => s.id)).size, 'deux identités distinctes').toBe(2)
    expect(coin.every((s) => s.hp > 0)).toBe(true)
  })

  it('la MÊME arête ne se pose pas deux fois, même vue de l’autre côté', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_S })
    expect(rejections(sim)).toEqual([])
    // (41,41)+SUD et (41,42)+NORD sont la même maçonnerie. Le joueur qui contourne son mur
    // vise la seconde adresse ; sans question symétrique il paie et bâtit une doublure.
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 42, edges: EDGE_N })
    expect(rejections(sim)).toEqual(['cette arête porte déjà un mur'])
    expect(aretesDe(sim, 41, 42), 'aucune doublure').toHaveLength(0)
  })

  it('une arête ne prend pas la tuile : on y ADOSSE son four, et on y plante son feu', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_N })
    expect(rejections(sim)).toEqual([])
    // Le coffre passe par `place_component` (objets tenus-et-posés) : il visait la même porte.
    grantItems(sim, id, { chest: 1 })
    act(sim, id, { type: 'set_active_slot', slot: slotOf(sim, id, 'chest') })
    act(sim, id, { type: 'place_component', tx: 41, ty: 41 })
    expect(rejections(sim), 'on adosse son coffre à son propre mur').toEqual([])
    expect(structureAt(sim.structures, 41, 41)).toBeDefined()
    expect(fullTileAt(sim.structures, 41, 41)?.type).toBe('chest')
    // Et le mur est toujours là, entier : deux couches, pas un remplacement.
    expect(aretesDe(sim, 41, 41)).toHaveLength(1)
  })

  it('un NŒUD sur la tuile n’empêche plus l’arête — mais toujours la pose pleine tuile', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    sim.nodes.push({ id: 9001, type: 'berry_bush', tx: 41, ty: 41, stock: 3, regrowAt: 0 })
    // Pleine tuile : refusée, comme avant (récolter = défricher, R5).
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41 })
    expect(rejections(sim)).toEqual(['un nœud occupe la tuile'])
    // Sur l'arête : acceptée. Le mur court sur le TRAIT, il ne prend pas le buisson.
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_N })
    expect(rejections(sim)).toEqual([])
    expect(aretesDe(sim, 41, 41)).toHaveLength(1)
  })

  it('sol et toit refusent l’arête ; deux bits d’un coup aussi', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    // Une pièce MOLLE n'a pas d'arête à porter : `floorAt`/`roofAt` ne regardent pas `edges`,
    // et on en empilerait dix sur la même tuile sans que rien ne le dise.
    expect(evaluateBuild(sim, id, 'floor', 41, 41, undefined, EDGE_N).reason).toBe('no_edge')
    expect(evaluateBuild(sim, id, 'roof', 41, 41, undefined, EDGE_N).reason).toBe('no_edge')
    // UN clic = UN segment : `EDGE_N | EDGE_E` poserait un angle pour le prix d'un mur.
    expect(evaluateBuild(sim, id, 'wall', 41, 41, undefined, EDGE_N | EDGE_E).reason).toBe('bad_tile')
    expect(evaluateBuild(sim, id, 'wall', 41, 41, undefined, 0).reason).toBe('bad_tile')
  })

  it('la POSE SANS ARÊTE reste pleine tuile — rien de ce qui existait ne bouge', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41 })
    expect(rejections(sim)).toEqual([])
    const mur = structureAt(sim.structures, 41, 41)!
    expect(mur.edges, 'aucun `edges` écrit, pas même un 0').toBeUndefined()
    expect(fullTileAt(sim.structures, 41, 41)?.type).toBe('wall')
  })

  it('l’invariant de navigabilité tient en murs minces : on ne scelle pas son Feu', () => {
    // Le Feu est en (41,40). On le ceint de ses quatre arêtes : la dernière doit être refusée,
    // sinon on s'emmure — et c'est très exactement la garde que R7 existe pour tenir.
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const [fx, fy] = [41, 40]
    for (const bit of [EDGE_N, EDGE_E, EDGE_S]) {
      act(sim, id, { type: 'build', structure: 'wall', tx: fx, ty: fy, edges: bit })
    }
    expect(rejections(sim), 'les trois premières passent').toEqual([])
    act(sim, id, { type: 'build', structure: 'wall', tx: fx, ty: fy, edges: EDGE_O })
    expect(rejections(sim)).toEqual(['cela couperait le passage'])
    expect(aretesDe(sim, fx, fy)).toHaveLength(3)
  })

  it('AMÉLIORER un mur d’arête ne le rend pas pleine tuile', () => {
    // LE PIÈGE DE MIGRATION À L'ENVERS. `edges === undefined` VEUT DIRE « prend sa tuile » : c'est
    // ce qui rend la migration silencieuse, et c'est donc aussi ce qu'une amélioration ne doit
    // JAMAIS produire. Si `upgrade_structure` retirait la structure pour en reposer une, le mur
    // perdrait son arête, se mettrait à bloquer toute sa tuile — et sur un coin il partagerait
    // cette tuile avec un second mur d'arête. Le geste est offert par le clic (le fantôme vise
    // l'arête, et cliquer une arête déjà prise l'améliore) : ce chemin est joué en partie.
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_N })
    const mur = aretesDe(sim, 41, 41)[0]!
    act(sim, id, { type: 'upgrade_structure', structureId: mur.id })
    expect(rejections(sim)).toEqual([])
    const apres = sim.structures.find((s) => s.id === mur.id)!
    expect(apres.material, 'le palier est bien monté').toBe('stone')
    expect(apres.edges, 'l’arête survit à l’amélioration').toBe(EDGE_N)
    expect(fullTileAt(sim.structures, 41, 41), 'et le mur ne prend toujours pas sa tuile').toBeUndefined()
    expect(edgeBarrierAt(sim.structures, 41, 41, EDGE_N)?.id).toBe(mur.id)
  })

  it('hors du carré du Feu, une arête est refusée comme une tuile', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const loin = 41 + fireRadius(1) + 1
    expect(evaluateBuild(sim, id, 'wall', loin, 40, undefined, EDGE_N).reason).toBe('out_of_square')
  })

  it('parité handler : `evaluateBuild.ok` ⇒ la pose écrit bien l’arête demandée', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    // Quatre tuiles VOISINES, une par bit — toutes à portée de bras (`BUILD_RANGE`), et dont
    // les quatre arêtes visées sont bien quatre traits DIFFÉRENTS (aucune adresse partagée).
    const cibles: [number, number, number][] = [
      [39, 42, EDGE_N],
      [40, 42, EDGE_E],
      [41, 42, EDGE_S],
      [42, 42, EDGE_O],
    ]
    for (const [tx, ty, bit] of cibles) {
      expect(evaluateBuild(sim, id, 'wall', tx, ty, undefined, bit).ok, `verdict pour ${bit}`).toBe(true)
      act(sim, id, { type: 'build', structure: 'wall', tx, ty, edges: bit })
      expect(aretesDe(sim, tx, ty)[0]?.edges, `pose pour ${bit}`).toBe(bit)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// L'INVARIANT N°2 — le rejeu au bit près.

describe('une partie qui bâtit en arêtes rejoue à l’identique', () => {
  it('même seed + mêmes inputs ⇒ même état, arêtes comprises', () => {
    const options = { map: createEmptyMap(120, 120, TERRAIN_GRASS) }
    // Le setup EST rejoué par `runReplay` : spawn et dotation y vivent, pas dehors.
    const setup = (state: SimState): void => {
      const nouveau = spawnEntity(state, 40.5, 40.5)
      grantItems(state, nouveau, { campfire: 1, hammer: 1, wood: 80, stone: 40 })
    }
    const sim = createSim(7, options)
    const log = createReplayLog(7, options)
    setup(sim)
    const id = sim.entities[0]!.id
    const jouer = (action: PlayerAction): void => {
      recordAndStep(sim, log, [{ entityId: id, dx: 0, dy: 0, action }])
    }
    jouer({ type: 'set_active_slot', slot: slotOf(sim, id, 'campfire') })
    jouer({ type: 'place_campfire', tx: 41, ty: 40 })
    jouer({ type: 'found_village', structureId: structureAt(sim.structures, 41, 40)!.id })
    jouer({ type: 'set_active_slot', slot: slotOf(sim, id, 'hammer') })
    // Une pièce : quatre segments autour de (41,42), plus le doublon refusé et l'angle.
    jouer({ type: 'build', structure: 'wall', tx: 41, ty: 42, edges: EDGE_N })
    jouer({ type: 'build', structure: 'wall', tx: 41, ty: 42, edges: EDGE_O })
    jouer({ type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_S }) // refusé : doublon
    jouer({ type: 'build', structure: 'floor', tx: 41, ty: 42 })

    expect(aretesDe(sim, 41, 42)).toHaveLength(2)
    const rejoue = runReplay(log, setup)
    expect(snapshot(rejoue)).toBe(snapshot(sim))
  })

  it('les arêtes survivent au snapshot — elles partent au réseau et en base', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_E })
    const brut = JSON.parse(snapshot(sim)) as { structures: { tx: number; ty: number; edges?: number }[] }
    const mur = brut.structures.find((s) => s.tx === 41 && s.ty === 41)
    expect(mur?.edges).toBe(EDGE_E)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CE QUE LA COLLISION EN FAIT — la promesse de jeu, bout en bout.

describe('un mur de joueur sur arête arrête pour de bon', () => {
  it('la bande est celle de l’équilibrage, et elle coupe le passage qu’elle porte', () => {
    // On ne recopie pas l'épaisseur : elle se DÉDUIT de `WALL_EDGE_SUB`, sinon la garde rougit
    // le jour où la constante bouge, en accusant le modèle au lieu du chiffre.
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 42, edges: EDGE_N })
    expect(rejections(sim)).toEqual([])
    const bande = BALANCE.WALL_EDGE_SUB / 2 / BALANCE.SUBTILES_PER_TILE
    const mur = aretesDe(sim, 41, 42)[0]!
    expect(mur.edges).toBe(EDGE_N)
    // La bande mord d'une demi-épaisseur DE CHAQUE CÔTÉ du trait y = 42 (mur à cheval).
    expect(bande).toBeGreaterThan(0)
    expect(crossingBlocker(sim.structures, 41, 41, 0, 1, () => true), 'entrer par le nord').toBeDefined()
    expect(crossingBlocker(sim.structures, 41, 41, 1, 0, () => true), 'longer vers l’est').toBeUndefined()
  })

  it('un mur d’arête et une pièce MOLLE partagent leur tuile sans se masquer', () => {
    // Le bug du 2026-07-27, côté POSE cette fois : la tuile porte le sol PUIS le mur, et toute
    // question qui rend « la première structure » reçoit le sol.
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'floor', tx: 41, ty: 41 })
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_N })
    expect(rejections(sim)).toEqual([])
    expect(fullTileAt(sim.structures, 41, 41), 'ni le sol ni l’arête ne prennent la tuile').toBeUndefined()
    expect(edgeBarrierAt(sim.structures, 41, 41, EDGE_N), 'le mur reste consultable sous le sol').toBeDefined()
    expect(crossingBlocker(sim.structures, 41, 41, 0, -1, () => true)).toBeDefined()
  })

  it('la structure du monde bâti et celle du joueur sont le même objet', () => {
    // Une Ferme pose ses barrières par `addStructure` + `s.edges = bits` ; le joueur passe par
    // l'action. Les deux doivent être indiscernables pour tout ce qui lit le monde.
    const sim = makeSim()
    const monde = addStructure(sim, 'wall', 60, 60, 0, 0, 'public', 'stone')
    monde.edges = EDGE_S
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_S })
    const joueur = aretesDe(sim, 41, 41)[0]!
    expect(Object.keys(joueur).includes('edges')).toBe(true)
    expect(crossingBlocker(sim.structures, 60, 60, 0, 1, () => true)?.id).toBe(monde.id)
    expect(crossingBlocker(sim.structures, 41, 41, 0, 1, () => true)?.id).toBe(joueur.id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LA PORTE S'OUVRE ET SE FERME (spec construction R26, décision d'Alexis 2026-07-30).
//
// Ce qui rend le geste possible, et ce qui le rend SENSÉ, sont deux choses différentes :
//   • possible : une bascule à portée de bras, réservée à qui a le droit ;
//   • sensée : une porte CLOSE arrête TOUT LE MONDE, y compris son propriétaire. Sans cette
//     seconde moitié, on n'aurait jamais de raison d'ouvrir, et la touche serait décorative.
// Les deux se testent, et la seconde est celle qu'on casserait sans le voir.

describe('pousser une porte (R26)', () => {
  /**
   * Pose une porte sur l'arête NORD de (41,43) et rend sa structure.
   *
   * PAS EN (41,41) : la tuile au nord y est celle du FEU du village, qui bloque en PLEINE TUILE —
   * `crossingBlocker` rendait donc le Feu et la garde accusait la porte de retenir le joueur. Une
   * sonde doit franchir une arête LIBRE des deux côtés, sinon elle mesure le voisinage.
   */
  const poserPorte = (sim: SimState, id: number): Structure => {
    act(sim, id, { type: 'build', structure: 'door', tx: 41, ty: 43, material: 'wood', edges: EDGE_N })
    return aretesDe(sim, 41, 43).find((s) => s.type === 'door')!
  }
  /**
   * ON VIENT À SA PORTE. `toggle_door` exige `INTERACT_RANGE` (1,5 tuile), pas `BUILD_RANGE` (6) :
   * on bâtit à distance de bras tendu, on pousse une porte au contact. Sans ce déplacement, la
   * garde mesurait un refus « trop loin » sur un geste parfaitement câblé.
   */
  const venirALaPorte = (sim: SimState, id: number): void => {
    const moi = sim.entities.find((e) => e.id === id)!
    moi.x = 41.5
    moi.y = 43.5
  }

  it('une porte NEUVE est CLOSE — et une porte close arrête même les siens', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const porte = poserPorte(sim, id)
    expect(porte.open, 'aucun `open` écrit : `undefined` EST close').toBeUndefined()
    // LE CŒUR DE LA RÈGLE. Le bâtisseur est membre du village de sa porte, et pourtant elle le
    // retient : c'est ce qui donne un sens à l'ouvrir.
    const monVillage = sim.villages[0]!.id
    expect(structureBlocks(porte, monVillage, false), 'close, elle arrête son propriétaire').toBe(true)
    expect(structureBlocks(porte, null, false), 'close, elle arrête l’étranger').toBe(true)
    expect(crossingBlocker(sim.structures, 41, 43, 0, -1, (s) => structureBlocks(s, monVillage, false))).toBeDefined()
  })

  it('la touche d’interaction la bascule, et l’état SURVIT au snapshot', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const porte = poserPorte(sim, id)
    const monVillage = sim.villages[0]!.id
    venirALaPorte(sim, id)

    act(sim, id, { type: 'toggle_door', structureId: porte.id })
    expect(rejections(sim)).toEqual([])
    const ouverte = sim.structures.find((s) => s.id === porte.id)!
    expect(ouverte.open).toBe(true)
    // OUVERTE, PLUS PERSONNE N'EST RETENU — l'étranger non plus. C'est le prix de l'oubli.
    expect(structureBlocks(ouverte, monVillage, false)).toBe(false)
    expect(structureBlocks(ouverte, null, false), 'ouverte, le pillard entre aussi').toBe(false)
    expect(crossingBlocker(sim.structures, 41, 43, 0, -1, (s) => structureBlocks(s, null, false))).toBeUndefined()
    // Et l'état part au réseau et en base.
    const brut = JSON.parse(snapshot(sim)) as { structures: { id: number; open?: boolean }[] }
    expect(brut.structures.find((s) => s.id === porte.id)?.open).toBe(true)

    // ON LA REFERME : `open` doit DISPARAÎTRE, pas passer à `false`. `undefined` est déjà
    // « close » (c'est la migration silencieuse des murs, R25) ; un `false` explicite alourdirait
    // chaque snapshot d'un champ qui ne dit rien de neuf.
    act(sim, id, { type: 'toggle_door', structureId: porte.id })
    expect(rejections(sim)).toEqual([])
    const refermee = sim.structures.find((s) => s.id === porte.id)!
    expect(refermee.open).toBeUndefined()
    expect(Object.keys(refermee).includes('open'), 'la clé elle-même s’en va').toBe(false)
  })

  it('elle ÉMET son fait de domaine, avec qui l’a poussée', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const porte = poserPorte(sim, id)
    venirALaPorte(sim, id)
    drainEvents(sim)
    act(sim, id, { type: 'toggle_door', structureId: porte.id })
    const faits = drainEvents(sim).filter((e) => e.type === 'door_toggled')
    expect(faits).toHaveLength(1)
    expect(faits[0]).toMatchObject({ structureId: porte.id, open: true, byEntityId: id })
  })

  it('trop loin, on ne l’atteint pas — une porte n’est pas un interrupteur', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const porte = poserPorte(sim, id)
    // On s'éloigne juste au-delà de la portée de bras (le rayon d'interaction, pas de bâtir).
    const moi = sim.entities.find((e) => e.id === id)!
    moi.y = 43.5 + BALANCE.INTERACT_RANGE + 0.5
    moi.x = 41.5
    act(sim, id, { type: 'toggle_door', structureId: porte.id })
    expect(rejections(sim)).toEqual(['trop loin'])
    expect(sim.structures.find((s) => s.id === porte.id)?.open).toBeUndefined()
  })

  it('sans droit, on ne l’ouvre pas — un pillard la CASSE, il ne la pousse pas', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const porte = poserPorte(sim, id)
    // La porte du village, mise en `private` : elle n'est plus qu'à son propriétaire.
    porte.access = 'private'
    const etranger = spawnEntity(sim, 41.5, 43.5)
    act(sim, etranger, { type: 'toggle_door', structureId: porte.id })
    expect(rejections(sim)).toEqual(['cette porte n’est pas à vous'])
    expect(sim.structures.find((s) => s.id === porte.id)?.open).toBeUndefined()
  })

  it('ce n’est pas une porte : refus net (un mur ne se pousse pas)', () => {
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    act(sim, id, { type: 'build', structure: 'wall', tx: 41, ty: 41, edges: EDGE_N })
    const mur = aretesDe(sim, 41, 41)[0]!
    act(sim, id, { type: 'toggle_door', structureId: mur.id })
    expect(rejections(sim)).toEqual(['ce n’est pas une porte'])
  })

  it('LE VILLAGE NE S’ENFERME PAS : ses PNJ franchissent une porte close, pas celle d’un rival', () => {
    // Sans cette capacité, fermer sa porte enfermerait ses propres PNJ et leurs corvées
    // s'arrêteraient sans un seul message. On ne simule pas le battant qu'ils poussent.
    const sim = makeSim()
    const id = batisseur(sim, 40, 40)
    const porte = poserPorte(sim, id)
    const monVillage = sim.villages[0]!.id
    expect(structureBlocks(porte, monVillage, true), 'son PNJ passe').toBe(false)
    expect(structureBlocks(porte, monVillage + 99, true), 'le PNJ d’un rival, non').toBe(true)
    // Et ils ne TOUCHENT PAS à l'état : la décision du joueur est la seule qui compte.
    expect(sim.structures.find((s) => s.id === porte.id)?.open).toBeUndefined()
  })

  it('l’ENCEINTE ne dépend pas de l’état de la porte — ouvrir sa forge ne la déclasse pas', () => {
    // Une porte est ce qui rend une enceinte navigable (R13) : elle ne la ROMPT jamais, ouverte
    // ou close. Sans cette garde, ouvrir la porte de sa forge lui ferait perdre un palier en
    // silence — un bonus qui s'évapore au moment où l'on entre travailler.
    const base = [
      { id: 1, type: 'workshop' as const, tx: 7, ty: 7, villageId: 1 },
      { id: 2, type: 'roof' as const, tx: 7, ty: 7, villageId: 1 },
      { id: 10, type: 'wall' as const, tx: 7, ty: 7, villageId: 1, edges: EDGE_N },
      { id: 11, type: 'wall' as const, tx: 7, ty: 7, villageId: 1, edges: EDGE_E },
      { id: 12, type: 'wall' as const, tx: 7, ty: 7, villageId: 1, edges: EDGE_S },
    ]
    for (const ouverte of [undefined, true]) {
      const s = [...base, { id: 13, type: 'door' as const, tx: 7, ty: 7, villageId: 1, edges: EDGE_O, open: ouverte }]
      const f = recognizeFunctions(s).find((x) => x.functionId === 'atelier')
      expect(f?.enclosed, `porte ${ouverte === true ? 'ouverte' : 'close'}`).toBe(true)
    }
  })

  it('une partie qui ouvre et referme rejoue au bit près', () => {
    const options = { map: createEmptyMap(120, 120, TERRAIN_GRASS) }
    const setup = (state: SimState): void => {
      const nouveau = spawnEntity(state, 40.5, 40.5)
      grantItems(state, nouveau, { campfire: 1, hammer: 1, wood: 80, stone: 40 })
    }
    const sim = createSim(11, options)
    const log = createReplayLog(11, options)
    setup(sim)
    const id = sim.entities[0]!.id
    const jouer = (action: PlayerAction): void => {
      recordAndStep(sim, log, [{ entityId: id, dx: 0, dy: 0, action }])
    }
    jouer({ type: 'set_active_slot', slot: slotOf(sim, id, 'campfire') })
    jouer({ type: 'place_campfire', tx: 41, ty: 40 })
    jouer({ type: 'found_village', structureId: structureAt(sim.structures, 41, 40)!.id })
    jouer({ type: 'set_active_slot', slot: slotOf(sim, id, 'hammer') })
    // LA PORTE JUSTE SOUS SES PIEDS (arête nord de (40,41), le colon est en (40,5 ; 40,5)) : la
    // bascule exige la portée de BRAS, et un rejeu ne peut pas tricher en déplaçant l'entité à la
    // main — seuls les inputs sont journalisés. On bâtit donc à un pas.
    jouer({ type: 'build', structure: 'door', tx: 40, ty: 41, material: 'wood', edges: EDGE_N })
    const porte = aretesDe(sim, 40, 41).find((s) => s.type === 'door')!
    jouer({ type: 'toggle_door', structureId: porte.id })
    jouer({ type: 'toggle_door', structureId: porte.id })
    jouer({ type: 'toggle_door', structureId: porte.id })
    expect(sim.structures.find((s) => s.id === porte.id)?.open).toBe(true)
    expect(snapshot(runReplay(log, setup))).toBe(snapshot(sim))
  })
})
