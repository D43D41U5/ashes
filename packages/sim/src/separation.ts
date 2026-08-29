/**
 * LES CORPS NE SE TRAVERSENT PLUS (demande d'Alexis, 2026-08-27 : « on traverse les
 * sprites des ennemis »).
 *
 * ═══ CE QUI MANQUAIT, ET C'ÉTAIT UN TROU, PAS UN RÉGLAGE ═══
 *
 * `MoveWorld` (collision.ts) connaît la carte, les structures et les nœuds. Il ne connaît
 * PAS les corps. Un avatar, un loup et un Cendreux pouvaient donc occuper la même
 * sous-tuile, et l'on marchait au travers d'une meute comme au travers d'un brouillard.
 * Tout le combat positionnel du GDD §7 — « on ne gagne pas un 1v3 », l'encerclement de
 * `faune.md` R11 — repose sur le fait que les corps PRENNENT DE LA PLACE.
 *
 * ═══ POURQUOI UNE SÉPARATION, ET NON UN BLOCAGE DANS `resolveMove` ═══
 *
 * Un blocage dur (les corps entrent dans `isBlockingTile`/`moveAxis`) coûterait trois
 * choses, et chacune est chère :
 *
 *   ① L'EMMUREMENT. Six loups au contact forment une cage sans porte — c'est déjà le
 *      défaut connu des structures pleine-tuile (`feu-piege-centre`). Une séparation, elle,
 *      pousse aussi CEUX QUI SERRENT : on s'extirpe toujours.
 *   ② LA PARITÉ DE PRÉDICTION. `moveAvatar` est partagé par `step` et par la prédiction
 *      client (invariant §3, `reconciliation.md` R4). Des corps bloquants exigeraient la
 *      liste des entités DANS le monde de prédiction, ou le sprite caoutchouterait contre
 *      chaque PNJ. Une correction POST-mouvement, elle, est une misprédiction ordinaire :
 *      `renderOffset` l'absorbe et la fond (R6), ce pour quoi il a été écrit.
 *   ③ LA FRONTIÈRE TUILE / SOUS-TUILE. Un corps est strictement sous-tuile. Le laisser
 *      entrer dans les requêtes TUILE (`isBlockedAt`) invaliderait l'A* et les champs de
 *      flux de la horde à chaque tick — le cache de `monsters.ts` se signe sur les nœuds,
 *      pas sur des corps qui bougent vingt fois par seconde.
 *
 * ═══ LA MÉTHODE ═══
 *
 * Une passe par tick, APRÈS tous les mouvements. Chaque paire de corps qui se recouvrent
 * se repousse de la moitié du recouvrement, chacun ; le déplacement passe par `resolveMove`
 * (un mur l'arrête, exactement comme un pas) et le TOTAL par corps est borné
 * (`SEPARATION_MAX_TILES`) — ce qui doit rester borné est la distance par unité de temps.
 *
 * JACOBI, PAS GAUSS-SEIDEL : on accumule d'abord toutes les poussées, on les applique
 * ensuite. Un corps cerné reçoit ainsi la somme de ses six voisins d'un coup au lieu
 * d'être ballotté six fois dans l'ordre du tableau — et le résultat ne dépend pas de
 * l'ordre d'itération, ce qui rend la règle lisible autant que rejouable.
 *
 * LE CORPS EST UNE ELLIPSE, PAS UN DISQUE, parce que la hitbox l'est déjà : 0,75 tuile de
 * large pour 0,375 de profondeur (`AVATAR_HITBOX_TILES` / `_DEPTH_TILES`). Deux corps
 * côte à côte s'écartent d'une largeur ; l'un derrière l'autre, d'une profondeur — et
 * c'est exactement ce que l'œil attend d'une vue de dessus, où ce qui est derrière passe
 * derrière. On ne fabrique pas une forme : on réutilise celle qui existe.
 *
 * DÉTERMINISME (invariant §2) : `+ - * /` et `Math.sqrt`. Aucun tirage — la séparation ne
 * consomme pas le PRNG, donc elle ne décale aucun flux existant par elle-même.
 */
import { BALANCE, COMBAT, MONSTER_DEFS } from './balance'
import { resolveMove } from './collision'
import { getVillageOf } from './village'
import type { SimState } from './sim'
import { enVol } from './vol'

/** La DEMI-largeur d'un corps d'homme : deux hommes se touchent à la somme des deux. */
const DEMI_X = BALANCE.AVATAR_HITBOX_TILES / 2
/** Idem en profondeur (nord-sud). */
const DEMI_Y = BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2
/** L'emprise la plus large du bestiaire — ce qui borne la sortie rapide de la boucle. */
const CORPS_MAX = Math.max(1, ...Object.values(MONSTER_DEFS).map((d) => d.corps ?? 1))
/** La plus grande distance de contact possible entre deux corps — la sortie rapide. */
const CONTACT_MAX_X = DEMI_X * CORPS_MAX * 2
const CONTACT_MAX_Y = DEMI_Y * CORPS_MAX * 2

/** Sous cette distance normalisée, deux corps sont CONFONDUS : il n'y a plus d'axe à suivre. */
const EPS = 1e-6

/** Le carré de la distance normalisée EN DEÇÀ DE LAQUELLE la règle mord (zone morte comprise). */
const REPOS_2 = (1 - COMBAT.SEPARATION_DEADBAND) * (1 - COMBAT.SEPARATION_DEADBAND)

/**
 * QUI A UN CORPS ? Tout ce qui se tient AU SOL et vit.
 *
 * Deux exclusions, et pas une de plus :
 *  · un mort ne prend plus de place (il est déjà sorti du pipeline de combat) ;
 *  · CE QUI VOLE n'est pas là (spec faune R21) — un oiseau en plein bond passe au-dessus
 *    des têtes, et `combat.ts` a déjà tranché que seul le trait l'atteint. Lui donner un
 *    corps au sol l'aurait fait bousculer un loup depuis les airs.
 */
function auSol(state: SimState, entityId: number, hp: number): boolean {
  if (hp <= 0) return false
  const m = state.monsters.find((x) => x.entityId === entityId)
  return m === undefined || !enVol(m, state.tick)
}

/**
 * LA PASSE DE SÉPARATION DU TICK.
 *
 * À appeler APRÈS tout ce qui déplace (pas d'input, PNJ, monstres, charges et reculs du
 * combat) : elle corrige l'état final, elle ne se dispute avec personne.
 */
export function advanceSeparation(state: SimState): void {
  const poussee = COMBAT.SEPARATION_PUSH
  if (poussee <= 0) return
  const corps = state.entities
  const n = corps.length
  if (n < 2) return

  // Les poussées accumulées, en tuiles. Alloué par appel et non au niveau module : deux
  // sims peuvent cohabiter dans le même processus (le banc en instancie plusieurs), et un
  // tampon partagé les ferait se marcher dessus — le précédent est le cache de `monsters.ts`.
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  const solide = new Uint8Array(n)
  // ═══ CHAQUE ESPÈCE SON EMPRISE (`MonsterDef.corps`, spec R4septies) ═══
  //
  // Elle valait celle d'un homme pour TOUT LE MONDE — un lapin bousculait un marcheur, et
  // c'était la réserve écrite dans la spec du matin. La demi-emprise se relève ICI, une
  // fois par passe et par corps : la lire dans la double boucle coûterait un `find` sur
  // `state.monsters` par PAIRE, soit O(n²·m) là où la règle tient en O(n²).
  const demiX = new Float64Array(n)
  const demiY = new Float64Array(n)
  const especeDe = new Map<number, number>()
  for (const m of state.monsters) especeDe.set(m.entityId, MONSTER_DEFS[m.type].corps ?? 1)
  for (let i = 0; i < n; i++) {
    const e = corps[i]!
    solide[i] = auSol(state, e.id, e.hp) ? 1 : 0
    const k = especeDe.get(e.id) ?? 1 // un avatar ou un PNJ : l'emprise d'un homme
    demiX[i] = DEMI_X * k
    demiY[i] = DEMI_Y * k
  }

  for (let i = 0; i < n; i++) {
    if (solide[i] === 0) continue
    const a = corps[i]!
    for (let j = i + 1; j < n; j++) {
      if (solide[j] === 0) continue
      const b = corps[j]!
      const dx = b.x - a.x
      // Sortie large d'abord, et sur la PLUS GROSSE emprise possible : la très grande
      // majorité des paires est loin, et un test sur un axe coûte une soustraction et une
      // comparaison. Borner par le contact de CETTE paire demanderait deux additions de
      // plus sur des paires qu'on rejette de toute façon.
      if (dx > CONTACT_MAX_X || dx < -CONTACT_MAX_X) continue
      const dy = b.y - a.y
      if (dy > CONTACT_MAX_Y || dy < -CONTACT_MAX_Y) continue
      // LE CONTACT EST LA SOMME DES DEUX DEMI-EMPRISES : un lapin contre un homme se
      // touchent plus près que deux hommes, et c'est toute la règle.
      const contactX = demiX[i]! + demiX[j]!
      const contactY = demiY[i]! + demiY[j]!
      if (dx > contactX || dx < -contactX) continue
      if (dy > contactY || dy < -contactY) continue
      // L'ELLIPSE : on ramène les deux axes à l'unité, on y raisonne en disque, on revient.
      const u = dx / contactX
      const v = dy / contactY
      const d2 = u * u + v * v
      // LA ZONE MORTE, ET C'EST L'HYSTÉRÉSIS DE LA RÈGLE (voir `SEPARATION_DEADBAND`) : on
      // ne pousse pas pour un cheveu de chevauchement, mais quand on pousse, on repousse
      // jusqu'au contact PLEIN. Un corps qui vient d'être écarté ne peut donc pas
      // re-déclencher au tick suivant — sans quoi il oscille, et c'est mesuré.
      if (d2 >= REPOS_2) continue
      let nx: number
      let ny: number
      let chevauchement: number
      if (d2 <= EPS) {
        // CORPS CONFONDUS — aucun axe ne se dégage. On écarte par l'IDENTITÉ (le rang des
        // deux ids), jamais au hasard : un tirage salirait le PRNG de l'état, et deux
        // corps exactement superposés doivent se séparer de la même façon à chaque rejeu.
        nx = a.id <= b.id ? 1 : -1
        ny = 0
        chevauchement = 1
      } else {
        const d = Math.sqrt(d2)
        nx = u / d
        ny = v / d
        chevauchement = 1 - d
      }
      // Chacun prend la moitié : deux corps qui se poussent se poussent également —
      // le pipeline ne connaît pas les camps (`combat.md` R4quinquies, « personne ne triche »).
      const part = chevauchement * 0.5 * poussee
      const ex = nx * part * contactX
      const ey = ny * part * contactY
      px[i] = px[i]! - ex
      py[i] = py[i]! - ey
      px[j] = px[j]! + ex
      py[j] = py[j]! + ey
    }
  }

  const plafond = COMBAT.SEPARATION_MAX_TILES
  for (let i = 0; i < n; i++) {
    let dx = px[i]!
    let dy = py[i]!
    if (dx === 0 && dy === 0) continue
    // ═══ UN CORPS CERNÉ NE SE FAIT PAS CATAPULTER ═══
    // Six voisins donnent six poussées, et leur somme n'est bornée par rien. On plafonne
    // la NORME du déplacement, pas chaque contribution : c'est la distance par unité de
    // temps qui doit rester bornée, exactement comme un pas — et c'est le raisonnement
    // qui a déjà donné son verrou de tick au recul (`combat.md` R4sexies).
    const norme = Math.sqrt(dx * dx + dy * dy)
    if (norme > plafond) {
      const k = plafond / norme
      dx *= k
      dy *= k
    }
    const e = corps[i]!
    const world = {
      map: state.map,
      structures: state.structures,
      nodes: state.nodes,
      moverVillageId: getVillageOf(state, e.id)?.id ?? null,
      etat: state,
    }
    const pousse = resolveMove(world, e.x, e.y, dx, dy)
    e.x = pousse.x
    e.y = pousse.y
  }
}
