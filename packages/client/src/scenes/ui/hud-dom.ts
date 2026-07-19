/**
 * LE HUD EN DOM — la racine partagée des voiles du jeu, rendue ISO à la maquette
 * « Ashes UI » (Turns 2A–5A). Même pivot que le menu (9A) et le chargement (8B) : un
 * canvas Phaser upscalé (`image-rendering:pixelated`) crénelle le texte et ne rejoue
 * pas les `border`, `box-shadow`, `filter`, `radial-gradient` de la maquette. Le HUD
 * vit donc en DOM, PAR-DESSUS le canvas du monde.
 *
 * LA PLANCHE EST À 1920×1080 (la résolution de la maquette) et mise à l'échelle « FIT »
 * — exactement comme le canvas du jeu en `Scale.FIT`. Les deux remplissent la fenêtre à
 * l'identique (16:9), donc le HUD DOM et le monde restent alignés et proportionnés
 * ensemble à toute taille d'écran.
 *
 * CLICS QUI TRAVERSENT. Le monde se joue AU CLIC (se déplacer, récolter, la carte) : la
 * racine et la planche sont en `pointer-events:none` — le canvas dessous reçoit tout.
 * Seuls les CONTRÔLES du HUD (boutons, cases de ceinture, recettes…) rallument
 * `pointer-events:auto` sur eux-mêmes. C'est le patron standard d'un HUD DOM sur canvas.
 */
import { ensureGameFont, GAME_FONT } from './game-font'

export const HUD_DESIGN_W = 1920
export const HUD_DESIGN_H = 1080

export interface HudDom {
  /** La planche 1920×1080 (mise à l'échelle) — les sections y accrochent leur DOM. */
  readonly board: HTMLElement
  /** Cache/montre tout le HUD d'un coup (ex. l'écran de rupture doit primer). */
  setVisible(v: boolean): void
  destroy(): void
}

/** Monte la racine du HUD sur `document.body` et rend la planche + de quoi la retirer. */
export function mountHud(): HudDom {
  ensureGameFont()

  const overlay = document.createElement('div')
  overlay.className = 'hud-overlay'
  const board = document.createElement('div')
  board.className = 'hud-board'
  overlay.appendChild(styleTag())
  overlay.appendChild(board)
  document.body.appendChild(overlay)

  const fit = (): void => {
    const k = Math.min(window.innerWidth / HUD_DESIGN_W, window.innerHeight / HUD_DESIGN_H)
    board.style.transform = `translate(-50%, -50%) scale(${k})`
  }
  fit()
  window.addEventListener('resize', fit)

  return {
    board,
    setVisible(v: boolean): void {
      overlay.style.display = v ? '' : 'none'
    },
    destroy(): void {
      window.removeEventListener('resize', fit)
      overlay.remove()
    },
  }
}

function styleTag(): HTMLStyleElement {
  const s = document.createElement('style')
  s.textContent = `
  .hud-overlay{position:fixed;inset:0;z-index:40;overflow:hidden;pointer-events:none;}
  .hud-board{position:absolute;left:50%;top:50%;width:${HUD_DESIGN_W}px;height:${HUD_DESIGN_H}px;
    transform-origin:center center;transform:translate(-50%,-50%);pointer-events:none;
    color:#e8e0c8;font-family:${GAME_FONT};}
  .hud-board *{box-sizing:border-box;}
  /* Un contrôle cliquable du HUD rallume le pointeur sur lui-même. */
  .hud-click{pointer-events:auto;cursor:pointer;}`
  return s
}

/**
 * LE CONTOUR D'ENCRE de la maquette : le texte du HUD flotte sur le monde (feuillage,
 * neige), il se détoure d'un liseré sombre sur les 4 côtés (+ une ombre portée douce
 * pour les titres). Reproduit le `text-shadow` multi-passes de la maquette 2A.
 */
export const INK_OUTLINE = 'text-shadow:-1px 0 0 #14141a,1px 0 0 #14141a,0 -1px 0 #14141a,0 1px 0 #14141a;'
export const INK_OUTLINE_STRONG =
  'text-shadow:-1.5px 0 0 #14141a,1.5px 0 0 #14141a,0 -1.5px 0 #14141a,0 1.5px 0 #14141a,0 2px 2px rgba(0,0,0,.7);'
