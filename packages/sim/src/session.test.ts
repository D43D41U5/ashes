import { describe, expect, it } from 'vitest'
import { aLAbriDeLaNuit } from './test-abri'
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

/** Récolte un nœud jusqu'à `want`, en respectant le rechargement. On se PLANTE sur le
 *  nœud avant chaque coup : le monde BOUGE désormais (un buisson/arbre épuisé rouvre
 *  ailleurs, spec recolte-vivante) — « qui joue bien » SUIT la ressource, il ne reste pas
 *  assis. Le pathing est testé ailleurs ; ici on mesure l'ÉCONOMIE, pas le déplacement. */
function recolter(sim: SimState, id: number, nodeId: number, item: 'wood' | 'berries' | 'fiber', want: number): void {
  for (let g = 0; g < 400 && countOf(me(sim).inventory, item) < want; g++) {
    const node = sim.nodes.find((n) => n.id === nodeId)!
    if (node.stock <= 0) break
    me(sim).x = node.tx + 0.5
    me(sim).y = node.ty + 0.5
    act(sim, id, { type: 'harvest', nodeId })
    for (let t = 1; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
  }
}

/** Ramasse un nœud de GLANAGE (stock 1, mains nues) : un coup, et il n'y est plus. */
function ramasser(sim: SimState, id: number, nodeId: number): void {
  const node = sim.nodes.find((n) => n.id === nodeId)!
  me(sim).x = node.tx + 0.5
  me(sim).y = node.ty + 0.5
  act(sim, id, { type: 'harvest', nodeId })
  for (let t = 1; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) step(sim, [])
}

/** Enfile une recette et attend qu'elle sorte (le craft est dans le TEMPS, spec craft-file). */
function fabriquer(sim: SimState, id: number, recipeId: 'rope' | 'crude_axe'): void {
  act(sim, id, { type: 'craft', recipeId })
  for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && me(sim).craftQueue.length > 0; t++) step(sim, [])
}

/**
 * Le monde du banc : de quoi vivre à portée de main — le reste est au joueur.
 *
 * ET IL OUVRE AU JOUR 61, comme le vrai jeu (spec `saisons.md` S2) : la première session
 * d'un joueur se joue à l'ouverture des Pluies, jamais au premier matin de l'Éclosion — qui,
 * depuis que le socle est une courbe (S4), s'ouvre ENCORE GELÉ (+3 °C le jour, −8 la nuit).
 * Mesuré au jour 1, ce banc ne mesurait plus la boucle de survie mais l'hypothermie : le
 * cueilleur finissait à 16 PV avec trois repas au compteur, contre 26 à l'ouverture réelle.
 * Le froid a son propre banc ; celui-ci demande si le jeu est JOUABLE.
 */
function mondeSolo(): { sim: SimState; id: number } {
  const nodes: ResourceNode[] = [
    { id: 1, type: 'berry_bush', tx: 11, ty: 10, stock: 8, regrowAt: 0 },
    { id: 2, type: 'berry_bush', tx: 9, ty: 10, stock: 8, regrowAt: 0 },
    { id: 3, type: 'berry_bush', tx: 10, ty: 11, stock: 8, regrowAt: 0 },
    { id: 4, type: 'tree', tx: 10, ty: 9, stock: 10, regrowAt: 0 },
    { id: 5, type: 'tree', tx: 12, ty: 11, stock: 10, regrowAt: 0 },
    { id: 6, type: 'fiber_plant', tx: 9, ty: 11, stock: 6, regrowAt: 0 },
    // LE GLANAGE (spec `glanage.md`) — la première hache se RAMASSE. Depuis G1, plus rien ne
    // se coupe à mains nues : sans ces cinq objets par terre, ce banc ne mesurerait plus « le
    // jeu est-il jouable », il mesurerait un joueur qui n'a aucun geste à faire. Deux branches
    // et trois pierres : exactement le prix du hachereau (bois 2 + pierre 3 + corde 1).
    { id: 7, type: 'branche_au_sol', tx: 10, ty: 8, stock: 1, regrowAt: 0 },
    { id: 8, type: 'branche_au_sol', tx: 12, ty: 12, stock: 1, regrowAt: 0 },
    { id: 9, type: 'pierre_au_sol', tx: 11, ty: 12, stock: 1, regrowAt: 0 },
    { id: 10, type: 'pierre_au_sol', tx: 9, ty: 12, stock: 1, regrowAt: 0 },
    { id: 11, type: 'pierre_au_sol', tx: 8, ty: 10, stock: 1, regrowAt: 0 },
  ]
  const sim = createSim(21, {
    map: createEmptyMap(32, 32, TERRAIN_GRASS),
    nodes,
    jourDeDepart: BALANCE.JOUR_DE_DEPART,
  })
  const id = spawnEntity(sim, 10.5, 10.2)
  return { sim, id }
}

describe('LA SESSION SOLO — le jeu est-il jouable ?', () => {
  it('QUI JOUE BIEN SURVIT : ramasser, faire du feu, CUISINER, manger', () => {
    const { sim, id } = mondeSolo()

    // 0. LE GLANAGE, ET C'EST LA PREMIÈRE CHOSE QU'ON FAIT (spec `glanage.md`). L'arbre est là,
    //    à deux pas, et il ne cède pas : il faut d'abord ramasser de quoi tailler le hachereau.
    //    C'est l'ouverture réelle de toute partie depuis le 2026-08-25.
    for (const n of [7, 8, 9, 10, 11]) ramasser(sim, id, n)
    expect(countOf(me(sim).inventory, 'wood')).toBe(2)
    expect(countOf(me(sim).inventory, 'stone')).toBe(3)
    recolter(sim, id, 6, 'fiber', 3)
    fabriquer(sim, id, 'rope')
    fabriquer(sim, id, 'crude_axe')
    expect(countOf(me(sim).inventory, 'crude_axe'), 'le hachereau est taillé').toBe(1)
    me(sim).activeSlot = me(sim).inventory.findIndex((sl) => sl !== null && sl.item === 'crude_axe')

    // 1. Le bois — MAINTENANT il vient. Sans Feu on ne cuisine pas, et sans cuisine on meurt.
    recolter(sim, id, 4, 'wood', 10)
    act(sim, id, { type: 'light_fire' })
    expect(sim.villages).toHaveLength(1)
    // LE CAMP : là où le Feu brûle. On PART récolter (les nœuds dérivent, spec
    // recolte-vivante), on REVIENT cuisiner — le Feu est une station, elle a une portée.
    const foyer = { x: me(sim).x, y: me(sim).y }

    // 2. De quoi faire un ragoût (4 baies + 1 fibre) — et de la marge.
    recolter(sim, id, 6, 'fiber', 6)
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

      // De retour AU FEU : cuisiner et se rassasier sont des gestes de camp (le Feu
      // est une station à portée — la tournée a pu nous emmener loin).
      me(sim).x = foyer.x
      me(sim).y = foyer.y
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
    const { sim, id } = mondeSolo()
    // À L'ABRI, ET C'EST EXPRÈS : ce banc exige une mort DE FAIM, donc la faim doit être la
    // seule cause possible. Dehors, depuis que la nuit mord, le loup signerait à sa place — et
    // le banc mesurerait la prédation en croyant mesurer la faim. Assis près de son Feu, notre
    // joueur a tout ce qu'il faut pour vivre : il ne lui manque que de se nourrir.
    aLAbriDeLaNuit(sim, id)
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

  // TIMEOUT EXPLICITE (2026-07-24) : ce banc est le SEUL à devoir rester DEHORS — sa prémisse
  // est « sans jamais faire de feu », on ne peut donc pas l'abriter comme les autres. Depuis que
  // la nuit mord, son sujet est CHASSÉ : la simulation fait plus de travail que les autres
  // bancs. L'ASSERTION est inchangée — c'est le chronomètre qu'on corrige, pas la règle. Et le
  // fait qu'il soit chassé sert plutôt son propos : cueillir sans feu ne tient pas un homme,
  // la nuit encore moins. (À l'ouverture réelle du monde il en réchappe, la moitié des PV en
  // moins ; c'est au premier matin de l'Éclosion, gelé, qu'il y laissait la peau.)
  it('LA CUEILLETTE SEULE NE SUFFIT PAS : manger des baies crues ne tient pas un homme', { timeout: 60_000 }, () => {
    const { sim, id } = mondeSolo()

    // Il cueille et croque, sans jamais faire de feu — la stratégie qui marchait
    // AVANT (un buisson = 171 minutes de survie).
    let baiesMangees = 0
    let morts = 0
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
      for (const ev of drainEvents(sim)) {
        if (ev.type === 'entity_died' && ev.entityId === 1) morts += 1
      }
    }

    // Il a mangé, il a rasé ses buissons — et la nuit sans feu l'a TUÉ. La cueillette
    // est un dépannage, pas un mode de vie.
    //
    // LE COMPTE DE REPAS A BAISSÉ (6 → 5) le 2026-07-31, et pas par un adoucissement : la
    // cueillette pure est désormais INTERROMPUE. Mesuré sur ce montage exact — le loup de
    // la nuit le tue, il respawne, et depuis que toute mort seule et loin d'un feu se relève
    // (spec `cendreux.md` R6), **ses propres cadavres reviennent le chasser**.
    //
    // ET IL NE SE LIT PLUS DU TOUT (2026-08-29, thermogenèse — `economie.md` R7bis) : aux
    // Pluies douces de l'ouverture, l'ancien décret ×2 est parti et la faim tient 4 pts/h —
    // le premier repas tombe à h14,7 (relevé à la sonde), la nuit arrive AVANT le deuxième,
    // et la traque fait le reste : sac perdu sur le cadavre, plus une baie à croquer. Le
    // compte de repas mesurait le décret supprimé ; ce qui porte la démonstration est la
    // FORME — il a dû manger, il a rasé ses buissons, il finit sur le fil, et surtout LA
    // NUIT SANS FEU LE TUE. C'est désormais elle, avec le Grand Froid qui affame (la
    // thermogenèse), qui interdit de vivre de cueillette — pas un multiplicateur.
    expect(baiesMangees).toBeGreaterThanOrEqual(1)
    expect(morts).toBeGreaterThanOrEqual(1) // la nuit sans feu n'a pas pardonné
    expect(me(sim).hunger).toBeLessThan(60) // il vit sur le fil, jamais rassasié
    expect(sim.nodes.filter((n) => n.type === 'berry_bush').reduce((s, n) => s + n.stock, 0)).toBe(0)
  })
})
