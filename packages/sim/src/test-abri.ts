/**
 * L'ABRI DU TEST — « ce banc ne parle pas de la nuit ».
 *
 * Depuis que les rôdeurs de nuit MORDENT pour de vrai (le drapeau `nightHunter` : ils étaient
 * exemptés de rien et le courage leur interdisait d'engager, donc ils tournaient jusqu'à l'aube
 * sans toucher personne), tout banc qui laisse un sujet dehors plusieurs cycles finit par le
 * faire dévorer. Ses PV tombent, son sac se vide au sol, et le test lit un emplacement nul —
 * un échec qui ne parle absolument pas de ce qu'il mesurait.
 *
 * Ce n'est PAS un contournement : c'est l'isolement de la variable. Un banc qui mesure le
 * POURRISSEMENT ou la FAIM doit s'assurer que la faim et le pourrissement sont bien les seules
 * causes en jeu. On ne désarme donc pas la nuit — on met le sujet à l'abri, avec la parade que
 * le jeu documente lui-même et que le joueur possède dès la première minute : un Feu.
 *
 * Le banc qui parle VRAIMENT de la nuit (« loin d'un Feu, la nuit mord ») n'appelle évidemment
 * pas ceci — c'est tout son sujet d'être dehors.
 */
import type { SimState } from './sim'
import { step } from './sim'
import { grantItems } from './village'

/**
 * Allume un Feu sous le sujet : il traversera les nuits sans être chassé (`underFireWard`).
 * Consomme un tick — les bancs qui comptent des ticks à l'unité doivent en tenir compte.
 */
export function aLAbriDeLaNuit(sim: SimState, entityId: number): void {
  grantItems(sim, entityId, { wood: 20 })
  step(sim, [{ entityId, dx: 0, dy: 0, action: { type: 'light_fire' } }])
}
