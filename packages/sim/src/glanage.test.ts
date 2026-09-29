/**
 * ═══ LE GLANAGE — critères d'acceptation (spec `glanage.md`) ═══
 *
 * Décision d'Alexis, 2026-08-25 : **plus rien ne se récolte à mains nues**, pour le bois et la
 * pierre. L'arbre exige une hache, le rocher une pioche — au moins de fortune. Et parce que
 * tout outil de fortune est fait de bois et de pierre, la boucle se refermerait sur elle-même
 * si rien ne l'ouvrait : ce qui l'ouvre est le GLANAGE, une branche tombée au pied d'un arbre,
 * une pierre détachée au pied d'un rocher, qu'on ramasse les mains vides.
 *
 * ═══ CE QUI FERAIT ROUGIR CE FICHIER ═══
 *
 * Gater le glanage derrière un outil (la partie ne pourrait plus commencer) ; rendre l'arbre ou
 * le rocher à `minTool: 'none'` (le verrou s'évapore) ; semer le glanage à plat au lieu de
 * l'ancrer sur un parent (on ne le chercherait plus où il a du sens) ; le rendre `renewable`
 * (filet de pierre infini dans sa propre cour) ; ou retirer la marche d'outil du tableau du
 * village (les PNJ se planteraient devant un tronc, en silence, à 20 Hz).
 *
 * ⚠ Le verrou est éprouvé À TROIS ÉTAGES, et il faut les trois : la RÈGLE (`NODE_DEFS`), le
 * GESTE (le refus qui tombe et qui NOMME l'outil), et le MONDE (le glanage existe assez près
 * d'un spawn pour que le premier outil soit taillable). Les deux premiers passeraient très bien
 * sur un monde où le glanage n'existe nulle part.
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE, NODE_DEFS, RECIPES, TERRAIN_ROAD, TERRAIN_GRASS, TERRAINS,
  TOOL_RANK, type NodeType,
} from './balance'
import { MONDE } from './zonegraph'
import type { ResourceNode } from './economy'
import { countOf, type ItemId } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { grantItems } from './village'
import { drainEvents } from './events'
import { emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from './zone-content'
import { placeHuntingGrounds } from './faune'
import { nidsAMonstre } from './poi'
import { carteDeTest } from '../../../tools/carte-cache'

// ─── Montage nu : un monde plat, les nœuds qu'on nomme, un acteur à côté ───────────────

let idc = 500
function noeud(type: NodeType, tx: number, ty: number): ResourceNode {
  return { id: ++idc, type, tx, ty, stock: NODE_DEFS[type].stock, regrowAt: 0 }
}
function monde(nodes: ResourceNode[]): SimState {
  return createSim(3, { map: createEmptyMap(48, 48, TERRAIN_GRASS), nodes, jourDeDepart: BALANCE.JOUR_DE_DEPART })
}
const moi = (s: SimState) => s.entities[0]!
function agir(s: SimState, id: number, action: PlayerAction): void {
  step(s, [{ entityId: id, dx: 0, dy: 0, action }])
}
function enMain(s: SimState, id: number, item: ItemId): void {
  grantItems(s, id, { [item]: 1 })
  const e = s.entities.find((x) => x.id === id)!
  e.activeSlot = e.inventory.findIndex((sl) => sl !== null && sl.item === item)
}
function refus(s: SimState): string[] {
  return drainEvents(s).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// G1 — LA RÈGLE : le bois et la pierre exigent un outil
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('G1 — plus rien ne se coupe ni ne se casse à mains nues', () => {
  /**
   * LA TABLE D'ABORD, ET SUR TOUT SON DOMAINE. Un test qui frappe deux nœuds choisis
   * laisserait passer le troisième — et c'est le troisième qui rouvrirait la porte
   * (`garde-exhaustive-plutot-que-cas`). On énumère donc `NODE_DEFS` en entier : tout ce qui
   * rend du bois ou de la pierre exige au moins la fortune, sauf ce qui se RAMASSE.
   */
  it('A1 — dans NODE_DEFS, tout ce qui rend wood/stone est gaté, sauf le glanage', () => {
    const glanage: NodeType[] = ['branche_au_sol', 'pierre_au_sol']
    for (const [type, def] of Object.entries(NODE_DEFS) as [NodeType, (typeof NODE_DEFS)[NodeType]][]) {
      if (def.item !== 'wood' && def.item !== 'stone') continue
      if (glanage.includes(type)) {
        expect(TOOL_RANK[def.minTool], `${type} doit rester ramassable les mains vides`).toBe(0)
        expect(def.tool, `${type} n'exige aucune famille d'outil`).toBeNull()
      } else {
        expect(TOOL_RANK[def.minTool], `${type} doit exiger au moins l'outil de fortune`).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('A2 — l’arbre refuse la main nue, le hachereau l’ouvre', () => {
    const arbre = noeud('tree', 11, 10)
    const sim = monde([arbre])
    const id = spawnEntity(sim, 10.4, 10.5)
    drainEvents(sim)

    agir(sim, id, { type: 'harvest', nodeId: arbre.id })
    expect(countOf(moi(sim).inventory, 'wood')).toBe(0)
    expect(refus(sim)).toEqual(['il faut une hache en main']) // G4 : le refus NOMME l'outil
    expect(sim.nodes[0]!.stock).toBe(NODE_DEFS.tree.stock)

    enMain(sim, id, 'crude_axe')
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    agir(sim, id, { type: 'harvest', nodeId: arbre.id })
    expect(countOf(moi(sim).inventory, 'wood')).toBeGreaterThan(0)
  })

  it('A3 — le rocher refuse la main nue, la pioche de fortune l’ouvre — le FILON, non', () => {
    const rocher = noeud('rock', 11, 10)
    const filon = noeud('iron_vein', 9, 10)
    const sim = monde([rocher, filon])
    const id = spawnEntity(sim, 10.4, 10.5)
    drainEvents(sim)

    agir(sim, id, { type: 'harvest', nodeId: rocher.id })
    expect(refus(sim)).toEqual(['il faut une pioche en main'])

    // La fortune ouvre le rocher…
    enMain(sim, id, 'crude_pickaxe')
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    agir(sim, id, { type: 'harvest', nodeId: rocher.id })
    expect(countOf(moi(sim).inventory, 'stone')).toBeGreaterThan(0)

    // …et PAS le filon : `craft-fortune` C5 tient toujours, trois pierres ficelées ne
    // valent pas une forge. Le verrou du bois n'a pas dilué celui du fer.
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    drainEvents(sim)
    agir(sim, id, { type: 'harvest', nodeId: filon.id })
    expect(refus(sim)).toEqual(['il faut un outil forgé en main'])
  })

  it('A4 — la CUEILLETTE n’est pas touchée : baies, fibre, champignons restent au geste nu', () => {
    const fibre = noeud('fiber_plant', 11, 10)
    const sim = monde([fibre])
    const id = spawnEntity(sim, 10.4, 10.5)
    drainEvents(sim)
    agir(sim, id, { type: 'harvest', nodeId: fibre.id })
    expect(countOf(moi(sim).inventory, 'fiber')).toBeGreaterThan(0)
    expect(refus(sim)).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// G2 — LE GESTE : on se baisse, on ne frappe pas
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('G2 — le glanage est un ramassage', () => {
  it('A5 — mains vides, un seul geste, et il n’en reste rien', () => {
    const branche = noeud('branche_au_sol', 11, 10)
    const caillou = noeud('pierre_au_sol', 9, 10)
    const sim = monde([branche, caillou])
    const id = spawnEntity(sim, 10.4, 10.5)
    drainEvents(sim)

    agir(sim, id, { type: 'harvest', nodeId: branche.id })
    expect(countOf(moi(sim).inventory, 'wood')).toBe(1)
    expect(sim.nodes.find((n) => n.id === branche.id)!.stock).toBe(0)
    expect(refus(sim)).toEqual([])

    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
    agir(sim, id, { type: 'harvest', nodeId: caillou.id })
    expect(countOf(moi(sim).inventory, 'stone')).toBe(1)
  })

  it('A6 — il ne BLOQUE pas, et il n’est pas renouvelable', () => {
    for (const type of ['branche_au_sol', 'pierre_au_sol'] as const) {
      // Ne bloque pas : on doit pouvoir marcher dessus, il est par terre.
      expect(NODE_DEFS[type].blockHalfSub, `${type} ne doit rien bloquer`).toBe(0)
      // Pas `renewable` : `defriche.ts` en exempterait le glanage de « rien ne repousse dans
      // l'emprise d'un village » — une pierre au sol infinie dans sa propre cour.
      expect(NODE_DEFS[type].renewable, `${type} ne doit pas être renouvelable`).toBeUndefined()
      // Pas `vivant` : une branche morte ne gèle pas et la cendre ne la fait pas tomber.
      expect(NODE_DEFS[type].vivant, `${type} n'est pas de la flore`).toBeUndefined()
    }
  })

  it('A7 — une pierre ne donne pas de GRAINE : le butin d’herboriste reste végétal', () => {
    const caillou = noeud('pierre_au_sol', 11, 10)
    const sim = monde([caillou])
    const id = spawnEntity(sim, 10.4, 10.5)
    // Cueilleur chevronné et coin riche : les conditions exactes du butin (`forageBounty`).
    moi(sim).skills.foraging = 100_000
    agir(sim, id, { type: 'harvest', nodeId: caillou.id, whole: true })
    expect(countOf(moi(sim).inventory, 'graine')).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// G3 — LE MONDE : le glanage existe, il est ancré, et il ouvre la partie
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('G3 — le semis du glanage, sur le vrai monde', () => {
  const SEEDS = [2026, 7, 42]
  const GLANAGE: NodeType[] = ['branche_au_sol', 'pierre_au_sol']
  const PARENTS: Record<string, NodeType[]> = {
    branche_au_sol: ['tree', 'old_tree'],
    pierre_au_sol: ['rock', 'bloc'],
  }

  for (const seed of SEEDS) {
    it(`A9 (graine ${seed}) — ancré sur un parent, au sec, hors sente : et il en existe`, () => {
      const c = carteDeTest(seed)
      const nodes = placeZoneNodes(c)
      const { width, terrain } = c.map
      const parLieu = new Map<number, ResourceNode>()
      for (const n of nodes) parLieu.set(n.ty * width + n.tx, n)

      const glane = nodes.filter((n) => GLANAGE.includes(n.type))
      expect(glane.length, 'un monde sans glanage est un monde où la partie ne commence pas').toBeGreaterThan(0)

      for (const g of glane) {
        const i = g.ty * width + g.tx
        // Au SEC et hors sente (`terrainAdmet`, t0-exploration R18).
        expect(TERRAINS[terrain[i]!]?.walkable, `${g.type} sur du non-marchable`).toBe(true)
        expect(terrain[i], `${g.type} sur une sente`).not.toBe(TERRAIN_ROAD)
        expect(c.rampe[i], `${g.type} sur une rampe de seuil`).toBeFalsy()
        // ANCRÉ : un parent de SA matière dans le 8-voisinage. C'est ce qui fait qu'on le
        // cherche là où il a du sens — au pied de ce qu'on ne sait pas encore entamer.
        let ancre = false
        for (let dy = -1; dy <= 1 && !ancre; dy++) {
          for (let dx = -1; dx <= 1 && !ancre; dx++) {
            const v = parLieu.get((g.ty + dy) * width + (g.tx + dx))
            if (v && PARENTS[g.type]!.includes(v.type)) ancre = true
          }
        }
        expect(ancre, `${g.type} en (${g.tx}, ${g.ty}) n'a aucun parent voisin`).toBe(true)
      }
    })
  }

  it('A9bis — le semis est DÉTERMINISTE : même graine, même glanage, au nœud près', () => {
    const c = carteDeTest(2026)
    const empreinte = (ns: ResourceNode[]): string =>
      ns.filter((n) => GLANAGE.includes(n.type)).map((n) => `${n.type}@${n.tx},${n.ty}`).join('|')
    expect(empreinte(placeZoneNodes(c))).toBe(empreinte(placeZoneNodes(c)))
  })

  /**
   * ⚠ **LA GARDE QUI COMPTE VRAIMENT** — et c'est une garde d'ATTEIGNABILITÉ, pas de table.
   * Toutes les autres pourraient être vertes sur un monde où le glanage tombe à trois cents
   * tuiles de tout point de départ : la partie serait injouable et rien ne le dirait. Elle
   * affirme donc, depuis les tuiles où l'on NAÎT, qu'on trouve de quoi tailler le hachereau
   * (bois 2 + pierre 3) dans un rayon qu'on peut marcher.
   *
   * Le rayon est ÉCRIT, pas dérivé de `GLANAGE_CHANCE` : une garde écrite avec la constante
   * qu'elle teste ne garde rien. 120 tuiles ≈ 30 s de marche en ligne droite
   * (`WALK_SPEED_TILES_PER_S` = 4). Il est large exprès — il ne dit pas « c'est bien calibré »
   * (ça se règle en jouant, `recolte.md` G11), il dit « ce n'est pas fermé ».
   *
   * **MARGE MESURÉE** (`node --import tsx tools/mesure-glanage.mts`, graines 2026/7/42, monde
   * joué) : le rayon du hachereau vaut 45-52 tuiles au spawn MÉDIAN et 77-84 au PIRE. À 80,
   * cette garde rougissait sur le pire spawn de la graine 7 — d'un cheveu, et pour de bon :
   * 1 pierre au sol pour les 3 qu'exige le hachereau. Elle est donc posée au-dessus du pire
   * cas mesuré, pas au-dessus du cas moyen ; si elle rougit un jour, c'est que le semis a
   * vraiment reculé, pas qu'une graine a eu de la malchance.
   */
  it('A8 — depuis un spawn, de quoi tailler le PREMIER outil est à portée de marche', () => {
    const RAYON = 120
    for (const seed of SEEDS) {
      const c = carteDeTest(seed)
      const nodes = placeZoneNodes(c)
      const spawns = pointsDeSpawnDuMonde(c, nodes)
      expect(spawns.length, `graine ${seed} : aucun point de spawn`).toBeGreaterThan(0)
      for (const s of spawns) {
        let bois = 0
        let pierre = 0
        for (const n of nodes) {
          if (Math.max(Math.abs(n.tx - s.tx), Math.abs(n.ty - s.ty)) > RAYON) continue
          if (n.type === 'branche_au_sol') bois += 1
          else if (n.type === 'pierre_au_sol') pierre += 1
        }
        const prix = RECIPES.crude_axe.inputs
        expect(bois, `graine ${seed}, spawn (${s.tx}, ${s.ty}) : pas assez de bois au sol`).toBeGreaterThanOrEqual(prix.wood ?? 0)
        expect(pierre, `graine ${seed}, spawn (${s.tx}, ${s.ty}) : pas assez de pierre au sol`).toBeGreaterThanOrEqual(
          prix.stone ?? 0,
        )
      }
    }
  })
})

/** Les points de spawn du monde, par le vrai chemin (`pointsDeSpawn`). */
function pointsDeSpawnDuMonde(c: ReturnType<typeof carteDeTest>, nodes: ResourceNode[]) {
  return pointsDeSpawn(
    c,
    emplacementsDeVillage(c, nodes, { coinsDeChasse: placeHuntingGrounds(c.map, c.graphe.seed), nids: nidsAMonstre(c.map) }),
    Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE),
    c.graphe.seed,
  )
}

/**
 * ═══ G5/G6 — « LE VILLAGE GLANE, TAILLE, PUIS COUPE » EST RETIRÉ LE 2026-09-29 ═══
 *
 * Six gardes partent avec l'IA villageoise (pivot de la braise) : A10 (« il POSTE le glanage,
 * jamais la corvée de bois »), A11 (« un glanage HORS PORTÉE n'envoie personne »), A11bis (« la
 * hache casse pendant le RETOUR »), A12 (« il s'outille tout seul et l'arbre finit par tomber »)
 * et A16 (« un glanage ENCLAVÉ cesse d'être élu »), avec le montage `villageNu` qui les servait.
 *
 * ⚠ CE QU'ELLES ÉPROUVAIENT N'ÉTAIT PAS LE GLANAGE — c'était le TABLEAU DES CORVÉES : quelle
 * corvée un village poste, laquelle il retire, comment un villageois se rééquipe en route. Le
 * glanage lui-même garde ses treize gardes ci-dessus (G1 le verrou de l'outil, G2 le ramassage,
 * G3 le semis sur le vrai monde), et c'est la moitié qui compte pour la braise : **un joueur qui
 * monte ramasse la branche au sol pour tailler sa première hache**, exactement comme avant.
 *
 * La boucle « glaner → tailler → couper » reste donc éprouvée là où elle vit encore : dans la
 * main du joueur. Ce qui s'en va, c'est le village qui la déléguait.
 */
