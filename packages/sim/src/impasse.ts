/**
 * ═══ L'IMPASSE — LE FILET SOUS TOUTES LES MACHINES À ÉTATS (2026-08-28) ═══
 *
 * Demande d'Alexis (capture `tremblement.png`) : « je ne veux plus JAMAIS voir une
 * entité trembler — elle suit son intention si elle peut, sinon elle fait autre
 * chose. » Chaque cause CONNUE d'oscillation a son correctif de racine (hystérésis,
 * engagement, veto de cap — voir `FAUNA` et la carte du 2026-08-28) ; ce module
 * attrape LES AUTRES : celles qu'on écrira sans le vouloir demain.
 *
 * ═══ LA SIGNATURE ═══
 *
 * Sur une fenêtre de `IMPASSE.FENETRE_TICKS`, la bête a PARCOURU beaucoup (chemin
 * brut ≥ `BRUT_MIN`) sans ALLER nulle part (déplacement net ≤ `NET_MAX`). Un
 * brouteur fait des pas courts — brut faible. Un voyageur va quelque part — net
 * grand. Seule l'oscillation a les deux : c'est la définition mesurable du
 * tremblement, et c'est la même que `tools/diag-tremblement.mts`, l'instrument qui
 * a chiffré le mal (5-15 % des bête-ticks avant correctifs) — le filet et la sonde
 * regardent le monde avec les mêmes yeux.
 *
 * ═══ LE RENONCEMENT ═══
 *
 * Détectée, la bête RENONCE : `renonceJusqua` est posé, le pilote
 * (`advanceMonsters`) saute son pas — elle se tient là, elle souffle — et ses
 * intentions TRANSITOIRES sont rendues (cap d'errance, chemin, rappels engagés,
 * traque) : à la reprise, chaque machine à états repart d'une page blanche et
 * choisit AUTRE CHOSE — c'est très exactement la consigne. La RÉCIDIVE rapprochée
 * (un nouveau renoncement à moins de `RECIDIVE_TICKS` du précédent) double le
 * souffle, plafonné : une cause de racine encore inconnue se voit quelques
 * secondes par demi-minute, jamais vingt fois par seconde. Loin de toute
 * récidive, l'ardoise s'efface.
 *
 * Trois exclusions, et pas une de plus :
 *   · CE QUI VOLE (spec faune R21) : l'envol est un geste engagé, et son cercle
 *     serré ressemble à s'y méprendre à la signature.
 *   · LE SANG : une bête blessée dont le bourreau vit encore rejoue sa machine
 *     immédiatement (l'exception vit dans le pilote) — on ne cloue jamais une
 *     proie sous les crocs.
 *   · LA HORDE EN MARCHE (attrapé par `worldevents.test` : « elle ne se retasse
 *     pas » tombait de 68 à 53 %) : douze goules qui s'engouffrent dans une
 *     porte FONT LA QUEUE — beaucoup de chemin de séparation, aucun net. C'est
 *     un siège, pas un tremblement ; renoncer y ARRÊTE un marcheur et la
 *     colonne se retasse derrière lui. Le grouillement d'une masse est sa
 *     nature — et `cendreuxStep` a déjà sa propre réponse au blocage : il frappe.
 *
 * MESURE APRÈS COUP (`advanceSeparation` comprise) : la fenêtre lit l'état FINAL
 * du tick, celui que le snapshot emporte et que l'œil voit — une oscillation
 * fabriquée par la séparation elle-même est un tremblement comme un autre.
 *
 * Déterminisme (invariant §2) : `+ − × ÷`, `Math.sqrt`, zéro tirage. L'état vit
 * dans `Monster` (nombres nus) : snapshot, replay et Veillée le portent tel quel.
 */
import { IMPASSE } from './balance'
import type { Monster } from './monsters'
import type { Entity, SimState } from './sim'
import { enVol } from './vol'

/** Les champs de guet, rendus — une bête immobile ne porte pas un octet. */
function oublieLaFenetre(monster: Monster): void {
  delete monster.impAncreX
  delete monster.impAncreY
  delete monster.impBrut
  delete monster.impPrevX
  delete monster.impPrevY
  delete monster.impDepuis
}

/**
 * LE RENONCEMENT : la bête souffle, et ses intentions transitoires sont rendues.
 * On ne touche qu'à ce qui est un PROJET (cap, chemin, rappels, traque) — jamais
 * aux faits (blessures, faim, alerte, appartenance) : la bête renonce à son
 * geste, pas à sa mémoire.
 */
function renonce(state: SimState, monster: Monster): void {
  // La récidive se lit sur le SOUFFLE PRÉCÉDENT, dont l'échéance est gardée
  // (le pilote ne l'efface pas ; le guet la nettoie une fois la rancune éteinte).
  const recidive = monster.renonceJusqua !== undefined && state.tick - monster.renonceJusqua < IMPASSE.RECIDIVE_TICKS
  const coups = recidive ? Math.min(IMPASSE.RENONCE_COUPS_MAX, (monster.renonceCoups ?? 1) + 1) : 1
  monster.renonceCoups = coups
  let souffle = IMPASSE.RENONCE_TICKS
  for (let k = 1; k < coups; k++) souffle *= 2
  monster.renonceJusqua = state.tick + souffle

  monster.wanderDx = 0
  monster.wanderDy = 0
  monster.stalking = false
  if (monster.path !== undefined && monster.path.length > 0) monster.path = []
  delete monster.stuckSince
  delete monster.stuckD
  delete monster.homing
  delete monster.regrouping
  delete monster.separating
  delete monster.ranging
  delete monster.regagne
  delete monster.jinkDx
  delete monster.jinkDy
}

/**
 * Le guet du tick — appelé par `step()` APRÈS la séparation, dernier de tout ce
 * qui regarde une position.
 */
export function advanceImpasse(state: SimState): void {
  if (state.monsters.length === 0) return
  const byId = new Map<number, Entity>()
  for (const e of state.entities) byId.set(e.id, e)

  // Les membres de horde, hors du guet (exclusion ③ ci-dessus).
  let enHorde: Set<number> | null = null
  if (state.hordes.length > 0) {
    enHorde = new Set()
    for (const h of state.hordes) for (const id of h.memberEntityIds) enHorde.add(id)
  }

  for (const monster of state.monsters) {
    const entity = byId.get(monster.entityId)
    if (!entity || entity.hp <= 0 || enVol(monster, state.tick) || (enHorde !== null && enHorde.has(monster.entityId))) {
      oublieLaFenetre(monster)
      continue
    }

    if (monster.renonceJusqua !== undefined) {
      // Elle souffle : on ne mesure pas une bête qu'on immobilise nous-mêmes.
      if (state.tick < monster.renonceJusqua) {
        oublieLaFenetre(monster)
        continue
      }
      // LA RÉMISSION : loin de toute récidive, l'ardoise s'efface — la
      // prochaine impasse repartira du souffle court, et le snapshot maigrit.
      if (state.tick - monster.renonceJusqua >= IMPASSE.RECIDIVE_TICKS) {
        delete monster.renonceJusqua
        delete monster.renonceCoups
      }
    }

    if (
      monster.impPrevX === undefined ||
      monster.impPrevY === undefined ||
      monster.impAncreX === undefined ||
      monster.impAncreY === undefined ||
      monster.impDepuis === undefined
    ) {
      monster.impAncreX = entity.x
      monster.impAncreY = entity.y
      monster.impPrevX = entity.x
      monster.impPrevY = entity.y
      monster.impBrut = 0
      monster.impDepuis = state.tick
      continue
    }

    const ddx = entity.x - monster.impPrevX
    const ddy = entity.y - monster.impPrevY
    monster.impBrut = (monster.impBrut ?? 0) + Math.sqrt(ddx * ddx + ddy * ddy)
    monster.impPrevX = entity.x
    monster.impPrevY = entity.y

    if (state.tick - monster.impDepuis < IMPASSE.FENETRE_TICKS) continue

    const nx = entity.x - monster.impAncreX
    const ny = entity.y - monster.impAncreY
    const netCarre = nx * nx + ny * ny
    const brut = monster.impBrut ?? 0

    if (brut >= IMPASSE.BRUT_MIN && netCarre <= IMPASSE.NET_MAX * IMPASSE.NET_MAX) {
      renonce(state, monster)
      oublieLaFenetre(monster)
      continue
    }

    // Une bête à l'arrêt complet rend ses champs : le snapshot reste maigre.
    if (brut === 0) {
      oublieLaFenetre(monster)
      continue
    }
    monster.impAncreX = entity.x
    monster.impAncreY = entity.y
    monster.impBrut = 0
    monster.impDepuis = state.tick
  }
}
