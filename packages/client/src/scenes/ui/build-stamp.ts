/**
 * LE NUMÉRO DE BUILD — un cartouche discret en bas à droite (demande d'Alexis).
 *
 * Il ne sert qu'à UNE chose : vérifier d'un coup d'œil que le jeu servi correspond au dernier
 * code produit. Le contenu (`BUILD_ID` : horodatage + hash git court) vient du module virtuel
 * `virtual:braises-build-id` (vite.config), réévalué à chaque changement en dev ; ici on ne fait
 * que le POSER dans le DOM.
 *
 * DOM et non Phaser (comme le reste du chrome), et surtout `pointer-events:none` : le cartouche
 * couvre un coin de l'écran mais ne doit JAMAIS manger un clic (récolter/frapper/bâtir passent
 * au travers). Teinte effacée, ombre portée pour rester lisible sur n'importe quel fond. Il parle
 * la VOIX du jeu (`GAME_FONT`, JetBrains Mono) — chasse fixe, ce qui aligne l'horodatage et le
 * hash ; c'est aussi la règle du garde-fou de typographie (un écran sur `body` pose la police).
 */
import { BUILD_ID } from 'virtual:braises-build-id'
import { ensureGameFont, GAME_FONT } from './game-font'

export function mountBuildStamp(): void {
  if (document.getElementById('braises-build')) return
  ensureGameFont()
  const el = document.createElement('div')
  el.id = 'braises-build'
  el.textContent = `build ${BUILD_ID}`
  el.style.cssText = [
    'position:fixed',
    'right:6px',
    'bottom:4px',
    'z-index:2147483000', // toujours visible, au-dessus du HUD/menus…
    'pointer-events:none', // …mais transparent au clic : ne bloque rien
    `font:10px/1 ${GAME_FONT}`,
    'letter-spacing:0.02em',
    'color:rgba(230,217,196,0.34)', // effacé (crème du jeu, très baissé)
    'text-shadow:0 1px 2px rgba(0,0,0,0.8)', // lisible sur fond clair comme sombre
    'user-select:none',
  ].join(';')
  document.body.appendChild(el)
}
