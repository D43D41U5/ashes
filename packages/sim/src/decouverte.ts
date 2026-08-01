/**
 * ═══ LA DÉCOUVERTE DES RECETTES (décision d'Alexis, D2, 2026-08-01) ═══
 *
 * *Une recette apparaît la première fois qu'on TOUCHE sa matière.* C'est le modèle de
 * Valheim, retenu contre ma recommandation (le grisé-avec-raison, moins cher) parce qu'il
 * est meilleur en sensation : le catalogue reste PROPORTIONNEL à la progression, et
 * chaque ressource neuve ouvre un petit événement au lieu d'ajouter une ligne grise à un
 * mur de deux cents.
 *
 * DEUX RÉVÉLATEURS, et il en faut deux :
 *
 *   1. LA MATIÈRE. Tenir un lingot de fer révèle tout ce qui SE FAIT AVEC — donc l'acier,
 *      donc une raison d'aller bâtir le four d'acier. C'est le « un cran en aval ».
 *   2. LA FONCTION à portée. Poser un Atelier N2 révèle ce qu'un Atelier N2 sait faire.
 *      Sans elle, les chaînes profondes se mordent la queue : l'acier exige le lingot
 *      d'acier, qui exige le four d'acier — la raison de bâtir le four resterait
 *      invisible tant qu'on n'aurait pas déjà de l'acier. ⚠ Cette seconde règle est MA
 *      proposition (D2-bis) et n'a pas encore été arbitrée par Alexis : elle vit ici, dans
 *      une seule fonction, et s'enlève en supprimant `revelerParFonction`.
 *
 * CE QUI EST RÉVÉLÉ LE RESTE. La découverte décide de l'APPARITION, pas de l'affichage
 * courant : une recette vue une fois garde sa ligne, grisée, avec sa raison. On ne
 * reprend jamais au joueur ce qu'il a appris.
 *
 * DÉTERMINISME. Aucun tirage, aucune horloge : on balaie les entités dans l'ordre du
 * tableau, les cases dans l'ordre du sac, les recettes dans l'ordre de `RECIPES`. Le
 * `seen` est un TABLEAU (pas un `Set` — invariant §3), trié par construction puisqu'on
 * n'y pousse que dans cet ordre. Même seed + mêmes inputs ⇒ même `seen` ET même flux
 * d'événements, ce que `replay.test.ts` garde.
 */
import { BALANCE, RECIPES, type RecipeId } from './balance'
import { emitEvent } from './events'
import { distSq } from './geometry'
import type { ItemId } from './items'
import { sertExigence } from './pieces'
import type { Entity, SimState } from './sim'

/**
 * L'INDEX INVERSE matière → recettes qui la consomment. Bâti UNE fois au chargement du
 * module : sans lui, chaque tick rebalaierait les 34 recettes pour chaque case de chaque
 * sac. Pur, déterministe, et l'ordre de `RECIPES` s'y conserve.
 */
const RECETTES_PAR_MATIERE: Partial<Record<ItemId, RecipeId[]>> = (() => {
  const index: Partial<Record<ItemId, RecipeId[]>> = {}
  for (const id of Object.keys(RECIPES) as RecipeId[]) {
    for (const item of Object.keys(RECIPES[id].inputs) as ItemId[]) {
      ;(index[item] ??= []).push(id)
    }
  }
  return index
})()

/** Marque `id` comme découverte par `e`, et émet le fait. `false` si elle l'était déjà. */
function reveler(state: SimState, e: Entity, id: RecipeId): boolean {
  const seen = (e.seen ??= [])
  if (seen.includes(id)) return false
  seen.push(id)
  // UN FAIT DE JEU DISCRET (règle de projet) : la chronique et un bandeau peuvent s'en
  // nourrir sans qu'on ait à instrumenter la découverte après coup.
  emitEvent(state, { type: 'recipe_revealed', tick: state.tick, entityId: e.id, recipeId: id })
  return true
}

/** Règle 1 — ce qu'on PORTE révèle ce qui se fait avec. */
function revelerParMatiere(state: SimState, e: Entity): void {
  for (const slot of e.inventory) {
    if (slot === null) continue
    for (const id of RECETTES_PAR_MATIERE[slot.item] ?? []) reveler(state, e, id)
  }
}

/** Règle 2 — la STATION à portée de bras révèle ce qu'elle sait faire (D2-bis). */
function revelerParFonction(state: SimState, e: Entity): void {
  const r = BALANCE.INTERACT_RANGE
  for (const s of state.structures) {
    if (distSq(e.x, e.y, s.tx + 0.5, s.ty + 0.5) > r * r) continue
    for (const id of Object.keys(RECIPES) as RecipeId[]) {
      const besoin = RECIPES[id].requiert
      if (besoin !== null && sertExigence(s.type, besoin)) reveler(state, e, id)
    }
  }
}

/**
 * LE TICK DE LA DÉCOUVERTE. Ne concerne que les AVATARS : un PNJ n'a pas de catalogue à
 * lire, et lui en tenir un ferait grossir le snapshot d'un état que personne ne regarde.
 * Les morts n'apprennent plus rien.
 */
export function advanceDecouverte(state: SimState): void {
  for (const e of state.entities) {
    if (e.hp <= 0 || !estAvatar(state, e.id)) continue
    revelerParMatiere(state, e)
    revelerParFonction(state, e)
  }
}

/** Un AVATAR = une entité qui n'est ni PNJ, ni monstre (les deux ont leur propre table). */
function estAvatar(state: SimState, id: number): boolean {
  return !state.npcs.some((n) => n.entityId === id) && !state.monsters.some((m) => m.entityId === id)
}

/** Cette recette est-elle découverte par cette entité ? (le client peint là-dessus) */
export function estDecouverte(e: Pick<Entity, 'seen'>, id: RecipeId): boolean {
  return e.seen?.includes(id) ?? false
}
