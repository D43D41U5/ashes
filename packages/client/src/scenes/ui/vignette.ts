/**
 * LA VIGNETTE — les bords de l'image s'assombrissent vers l'encre, et le regard tombe au centre.
 *
 * C'est le geste de cadrage le moins cher et le plus payant du rendu : sans lui, une carte
 * top-down est un tapis uniforme qui remplit l'écran jusqu'aux angles, et rien ne dit où
 * regarder. Avec lui, l'image a un CENTRE — là où vit l'avatar.
 *
 * DEUX PARTIS PRIS, tous deux pour rester dans les clous du projet :
 *
 *   • ELLE N'AJOUTE AUCUNE COULEUR. Elle assombrit vers `HEX.ink` — l'encre déjà partout
 *     (contours, cadres, voiles). Un vrai étalonnage (bascule teal/orange, poussée de
 *     saturation) introduirait des teintes HORS de la règle « encre + 2 accents », qui est
 *     un invariant d'architecture du projet, pas une préférence : c'est une décision
 *     d'Alexis, pas la mienne. La vignette, elle, ne touche que la LUMINOSITÉ.
 *
 *   • EN DOM, PAS EN POST-FX PHASER. Un pipeline de post-traitement est ce qui a le plus de
 *     chances de rendre différemment — ou blanc — sous swiftshader : on y perdrait la
 *     vérification visuelle au smoke, le seul juge qui vaille ici. Un dégradé DOM rend à
 *     l'identique partout, et suit la grammaire des VOILES (mort, stèle) qui sont déjà des
 *     dégradés DOM lisses. (Le grain pixellisé, lui, régit les FX de LUMIÈRE du monde —
 *     halos, flaques — pas les cadrages : une vignette quantifiée baverait en bandes.)
 *
 * STATIQUE : aucune animation, donc rien à désarmer en `prefers-reduced-motion`.
 * `pointer-events:none` — elle ne mange aucun clic. Sous le HUD (z-index 40) et sous tous
 * les voiles : elle cadre le MONDE, l'interface vit par-dessus.
 */
import { HEX } from './palette'

export interface Vignette {
  destroy(): void
}

/** L'encre en composantes, pour la poser en rgba à opacité croissante vers les bords. */
function inkRgb(): string {
  const h = HEX.ink.replace('#', '')
  const n = parseInt(h, 16)
  return `${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff}`
}

/** Monte la vignette sur `document.body`. Idempotent : une seule à l'écran. */
export function mountVignette(): Vignette {
  document.querySelectorAll('.world-vignette').forEach((n) => n.remove())
  const el = document.createElement('div')
  el.className = 'world-vignette'
  const ink = inkRgb()
  // Le centre reste TOTALEMENT clair (jusqu'à 45 %) : on cadre, on ne salit pas le jeu.
  // Puis la montée est douce et s'arrête à ~0,5 dans les angles — au-delà, on ne lit plus
  // ce qui arrive par les bords, et dans ce jeu ce qui arrive par les bords vous tue.
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:5', // au-dessus du canvas, SOUS la file de craft (10), le HUD (40) et les voiles
    'pointer-events:none',
    `background:radial-gradient(ellipse at center,rgba(${ink},0) 45%,rgba(${ink},.22) 76%,rgba(${ink},.5) 100%)`,
  ].join(';')
  document.body.appendChild(el)
  return {
    destroy(): void {
      el.remove()
    },
  }
}
