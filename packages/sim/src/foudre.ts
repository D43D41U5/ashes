/**
 * LA FOUDRE — LA RÉSOLUTION (spec `meteo.md` R8, tranche T6). L'élection est PURE et vit
 * dans `meteo.ts` (`foudreImpactAt` — le client y dessine l'éclair, rien ne transite) ;
 * ICI, on ne fait qu'encaisser : au tick d'impact d'un front `orage` actif, les corps
 * exposés dans le rayon prennent `FOUDRE_DEGATS`. Phase DÉDIÉE, appelée par `step()`
 * juste après `advanceMeteo` — elle ne vit pas dans `meteo.ts` parce qu'elle importe
 * `die()` (combat → temperature → meteo : le module de géométrie doit rester feuille).
 *
 * ═══ L'ABRI IMMUNISE — DEUX FOIS, ET SANS RE-ÉLECTION ═══
 *
 * 1. La TUILE D'IMPACT abritée (`isSheltered` à CE tick) SUPPRIME l'impact entièrement :
 *    pas de report, pas de re-élection — le ciel ne se venge pas ailleurs. Et comme
 *    chaque créneau est indépendant par hash (voir `meteo.ts`), la suppression ne
 *    décale RIEN pour les impacts suivants.
 * 2. Un CORPS debout sur une tuile abritée dans le rayon d'un impact voisin est épargné
 *    aussi — l'abri immunise, période (« rentrez, ou courez entre les coups »).
 *
 * ═══ ZÉRO TIRAGE, ZÉRO ÉVÉNEMENT NEUF ═══
 *
 * Les dégâts passent par le chemin ENVIRONNEMENTAL existant (décrément direct + `die`,
 * patron exact du froid dans `temperature.ts` et de la faim dans `economy.ts`) — pas par
 * `applyDamage`, qui tire le PRNG aux paliers de blessure : la résolution ne touche pas
 * un octet du flux seedé. L'éclair lui-même n'émet RIEN (le client le recalcule du
 * tick) ; la mort, elle, passe par les événements de mort existants — cause `lightning`
 * pour la chronique et le voile, et les monstres meurent par LEUR chemin (`die` connaît
 * les deux : loot, `monster_slain`, pression de chasse).
 */
import { METEO } from './balance'
import { die } from './combat'
import { isInvulnerable } from './debug'
import { distSq } from './geometry'
import { foudreImpactAt } from './meteo'
import type { SimState } from './sim'
import { isSheltered } from './temperature'

/** La frappe du tick — no-op sans front `orage` actif ou hors tick d'impact. */
export function advanceFoudre(state: SimState): void {
  if (!state.meteoActive) return
  const front = state.meteo
  if (!front || front.type !== 'orage') return
  const impact = foudreImpactAt(front, state.tick, state.map.width, state.map.height)
  if (!impact) return
  // L'abri du point visé immunise AU MOMENT de la frappe : impact supprimé, entièrement.
  if (isSheltered(state, Math.floor(impact.x), Math.floor(impact.y))) return
  const r2 = METEO.FOUDRE_RAYON * METEO.FOUDRE_RAYON
  // Copie défensive (patron advanceCombat/advanceTemperature) : die() réassigne les tableaux.
  for (const entity of [...state.entities]) {
    if (entity.hp <= 0) continue
    if (distSq(entity.x, entity.y, impact.x, impact.y) > r2) continue
    // Le corps sous un toit est épargné aussi — l'abri immunise, période.
    if (isSheltered(state, Math.floor(entity.x), Math.floor(entity.y))) continue
    if (isInvulnerable(state, entity)) continue
    const before = entity.hp
    entity.hp = Math.max(0, entity.hp - METEO.FOUDRE_DEGATS)
    if (before > 0 && entity.hp <= 0) die(state, entity, 0, 'lightning')
  }
}
