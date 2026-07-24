/**
 * ROUVRIR une Veillée NEUVE — le deep-link de boot `?solo&fresh` que `MenuScene` consomme
 * (`params.has('solo')` + `params.has('fresh')` → `clearSlot()` puis relance solo). Une SEULE
 * source de ce contrat : la stèle de fin de saison et le menu pause l'appellent, MenuScene le
 * lit. La seed est fixe (`VEILLEE_SEED`) — c'est la MÊME vallée qui se réveille, vidée des
 * marques ; d'où « rouvrir », pas « nouvelle vallée ».
 */
import { clearFog } from '../../render/fog'

export function reopenFreshVeillee(): void {
  // Une Veillée NEUVE oublie aussi la CARTE : le brouillard vit hors de la sauvegarde de sim
  // (localStorage), donc `clearSlot()` ne l'emporte pas. Sans ça, on rouvrirait une vallée
  // vierge avec le savoir géographique de la précédente — et il n'y aurait plus rien à découvrir.
  clearFog()
  window.location.href = window.location.pathname + '?solo&fresh'
}
