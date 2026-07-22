/**
 * LA GÉOMÉTRIE DE LA CEINTURE — les seules constantes partagées de la rangée du bas.
 *
 * Le RENDU de la ceinture vit désormais entièrement dans le HUD DOM (`hud-core.ts`) ;
 * l'ancien renderer Phaser `createHotbar` (et la trilogie `vitals`/`pickup-toasts`) a
 * été retiré — c'était du code mort sans importeur, qui dupliquait la logique du HUD
 * réel (audit UI/UX P3). Ne restent ici que la taille de case et le bas d'écran, dont
 * `inventory-panel.ts` a besoin pour aligner la grille du sac sur la ceinture.
 */
import type Phaser from 'phaser'

/** Taille et gouttière RUST : de grandes cases, quasi jointives. La ceinture est
 *  une rangée de la grille du sac — elle doit s'écrire dans le même alphabet. */
export const CELL = 62
export const GAP = 2
/** Marge sous les cases. */
const MARGIN = 20

/** Le bord BAS des cases de ceinture. Les vitales s'alignent dessus : le bas de
 *  l'écran doit lire comme une seule bande, pas comme deux blocs qui flottent. */
export function hotbarBottom(scene: Phaser.Scene): number {
  return scene.scale.height - MARGIN
}
