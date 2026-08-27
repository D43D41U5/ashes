/**
 * ═══ LA TORCHE — la seule lumière qui MARCHE (décision d'Alexis, 2026-08-26) ═══
 *
 * Le contrat complet — et les trois interdits qui le tiennent — est écrit sur `ItemId`
 * (`items.ts`, entrée `torche`). En deux mots : elle ÉCLAIRE, elle ne chauffe pas, elle ne
 * repousse rien, et elle ne prend feu qu'AU FOYER. Ce module n'a donc que deux devoirs :
 *
 *   • **L'HORLOGE** (`advanceTorches`) — une torche vive TENUE EN MAIN brûle d'un tick par
 *     tick, et retombe en fagot éteint quand `TORCHE.BURN_TICKS` sont passés. On la rallume
 *     au Feu, indéfiniment : la rareté n'est pas dans la matière, elle est dans **le trajet
 *     de retour**. C'est ça, la laisse.
 *
 *   • **LA LECTURE** (`torcheVive`) — qui, dans un état, porte une flamme. Le client s'en
 *     sert pour poser sa lumière, la sim pour rien d'autre : aucune règle de jeu ne consulte
 *     cette fonction, et c'est délibéré (voir les interdits).
 *
 * ⚠ SEULE LA TORCHE TENUE BRÛLE. Celle qui dort au sac ne se consume pas — sans quoi les
 * torches de rechange fondraient dans le dos du joueur, et emporter la nuit deviendrait un
 * pari sur une horloge qu'on ne voit pas. La règle est lisible d'un coup d'œil : ce qui brûle
 * est ce qu'on voit brûler.
 *
 * ⚠ AUCUN TIRAGE ICI. L'horloge est un compteur entier sur `Slot.wear` : pas de PRNG touché,
 * donc allumer une torche ne décale pas le flux seedé du monde (invariant n°2, et le même
 * raisonnement que `morts.ts` sur le rallumage d'un feu).
 */
import { TORCHE } from './balance'
import { fireStateAt } from './fire'
import { emitEvent } from './events'
import { heldSlot } from './inventory-actions'
import type { Entity, SimState } from './sim'
import type { Slot } from './items'
import type { Structure } from './village'

/** La case tenue est-elle une torche ALLUMÉE ? */
export function estTorcheVive(slot: Slot | null): boolean {
  return slot !== null && slot.item === 'torche_vive'
}

/**
 * La torche vive que cette entité TIENT — `null` si elle n'en tient pas.
 *
 * Rend la case elle-même (et non un booléen) parce que son `wear` EST le combustible
 * restant : le client en tire l'agonie de la flamme, qui faiblit avant de mourir.
 */
export function torcheVive(entity: Entity): Slot | null {
  const slot = heldSlot(entity)
  return estTorcheVive(slot) ? slot : null
}

/** Combien de ticks il reste à brûler à cette case (0 si ce n'est pas une torche vive). */
export function ticksDeFlamme(slot: Slot | null): number {
  if (!estTorcheVive(slot)) return 0
  return Math.max(0, TORCHE.BURN_TICKS - (slot?.wear ?? 0))
}

/**
 * De 1 (torche neuve) à 0 (elle vient de mourir) — la part de flamme qui reste.
 *
 * PARTAGÉE avec le client (c'est de là que la lumière tire son agonie) : la même formule
 * des deux côtés, jamais deux courbes qui divergent. Le patron de `fuelBurnProgress`.
 */
export function partDeFlamme(slot: Slot | null): number {
  if (TORCHE.BURN_TICKS <= 0) return 0
  return ticksDeFlamme(slot) / TORCHE.BURN_TICKS
}

/**
 * Ce foyer peut-il DONNER le feu ? Allumé ou en braises — pas éteint.
 *
 * Les braises comptent exprès : un foyer qui rougit encore allume une torche, et c'est
 * précisément l'heure où l'on en a besoin (le sas d'alerte de `feu-station` S2). Refuser
 * les braises aurait fait de l'extinction une double peine.
 */
export function foyerDonneLeFeu(tick: number, s: Structure): boolean {
  if (s.type !== 'fire') return false
  const st = fireStateAt(tick, s)
  return st === 'lit' || st === 'ember'
}

/**
 * L'HORLOGE DE COMBUSTION — une phase de tick, comme `advanceFire`.
 *
 * Balaye les entités DANS L'ORDRE DU TABLEAU (déterminisme : jamais un tri, jamais un
 * `Object.keys`), et n'avance que la case TENUE. À terme, la torche redevient `torche` —
 * elle ne DISPARAÎT pas : le bois et la fibre sont toujours là, c'est la flamme qui s'en
 * est allée. Le joueur garde donc son objet et sa case ; il lui manque un feu.
 */
export function advanceTorches(state: SimState): void {
  for (const entity of state.entities) {
    const slot = heldSlot(entity)
    if (!estTorcheVive(slot) || slot === null) continue
    slot.wear = (slot.wear ?? 0) + 1
    if (slot.wear < TORCHE.BURN_TICKS) continue
    slot.item = 'torche'
    delete slot.wear
    emitEvent(state, { type: 'torche_eteinte', tick: state.tick, entityId: entity.id })
  }
}
