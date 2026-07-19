/**
 * L'ÉCRAN DE CHARGEMENT — le seul écran du jeu tant que la vallée n'est pas née.
 *
 * RENDU ISO à la maquette « Ashes UI » Turn 8B (« la braise qui respire »), en DOM
 * comme le menu (voir `menu-dom.ts`) : un canvas Phaser upscalé se crénelle et ne
 * saurait égaler l'anneau en `conic-gradient`, la flamme qui pulse et la police
 * JetBrains Mono. L'ANNEAU EST LA PROGRESSION — sa portion d'ambre est le compte réel
 * des passes de l'hôte (`done / total`), rien n'est brodé. Une étincelle l'orbite, la
 * braise couve au centre. Le voile est un noir opaque : s'effacer EST le fondu, et le
 * monde (déjà monté derrière) apparaît.
 *
 * LA JAUGE DIT LA VÉRITÉ, LE TEXTE RACONTE. La ligne du bas tire au sort un GESTE DU
 * MONDE — il ne rend AUCUN compte de la machine (« les rivières creusent leur lit »
 * pendant qu'un flow field se taille, c'est un rapport d'ingénieur déguisé en poème).
 * On préfère l'aveu : des gestes qui parlent du jeu, pas de sa cuisine.
 */
import { ensureGameFont, GAME_FONT } from './game-font'

export interface LoadingScreen {
  /** Le compte de l'hôte (`undefined` tant qu'il n'a rien dit) et l'horloge de la scène. */
  update(progress: { done: number; total: number } | undefined, now: number): void
  /** Le monde est debout DERRIÈRE le voile : on remplit l'anneau (c'est mérité) et on
   *  commence à s'effacer. Le fond étant un noir opaque, l'effacer EST le fondu. */
  fadeOut(now: number): void
  /** Une frame de fondu. Rend `true` quand il ne reste plus rien à l'écran — et
   *  l'écran s'est alors détruit lui-même : ne plus l'appeler. */
  fadeStep(now: number): boolean
  destroy(): void
}

/**
 * LES GESTES DU MONDE. À l'infinitif, comme un ordre donné à la vallée avant
 * qu'elle existe. Ils ne décrivent AUCUNE passe réelle de la génération : ils
 * disent le jeu (le froid, la faim, les loups, le Feu, les soixante jours) à
 * quelqu'un qui ne l'a pas encore lancé. Tirés dans un ordre différent à chaque
 * chargement (voir `shuffled`).
 */
const GESTES = [
  'Souffler sur les braises…',
  'Coucher la neige sur les crêtes…',
  'Apprendre aux loups le chemin des cols…',
  'Enterrer ce que la saison passée a laissé…',
  'Compter les nuits qui restent…',
  'Fendre du bois pour un feu qui n’existe pas encore…',
  'Donner un nom à des lieux que personne n’a vus…',
  'Faire descendre les rivières jusqu’au lac…',
  'Cacher du fer sous la roche…',
  'Rappeler aux Cendrés qu’ils ont été des hommes…',
  'Poser une carcasse là où le loup la trouvera…',
  'Tendre la nuit au-dessus de la vallée…',
  'Ouvrir la chronique à sa première page…',
  'Vieillir les troncs de la vieille forêt…',
  'Laisser une tanière entrouverte, au cas où…',
  'Écarter les mélèzes pour laisser passer l’avalanche…',
  'Aiguiser ce qui doit mordre…',
  'Semer des baies loin des chemins…',
  'Apprendre au froid à trouver les portes mal jointes…',
  'Attiser le Feu du village d’à côté…',
  'Mesurer la distance entre deux feux…',
  'Réveiller ce qui dormait sous la cendre…',
  'Compter jusqu’à soixante…',
]
/** Le texte change toutes les ~3 s : on en lit deux ou trois par chargement. */
const GESTE_MS = 3000
/** Le fondu final. Court : on veut entrer dans le monde, pas assister à une transition. */
const FADE_MS = 420

/** La planche de la maquette 8B (16:9), mise à l'échelle pour TENIR dans la fenêtre. */
const DESIGN_W = 1200
const DESIGN_H = 675

/**
 * Aisance de l'anneau : il REJOINT la vérité en douceur, sans jamais la devancer.
 * Constante de temps en MILLISECONDES, et non « une fraction par frame » : les
 * dernières étapes du chargement (le montage des couches, côté client) consomment
 * délibérément une frame CHACUNE — au rythme d'une frame, un lissage par frame n'aurait
 * rattrapé qu'une poignée de pour-cent par étape, et l'anneau aurait plafonné avant de
 * sauter d'un coup. Le lissage suit donc le temps qui passe, pas le nombre de frames.
 */
const EASE_MS = 140
/** Sous ce delta, inutile de retracer : l'œil ne verrait rien bouger. */
const REDRAW_EPS = 0.002

export function createLoadingScreen(): LoadingScreen {
  ensureGameFont()

  const root = document.createElement('div')
  root.className = 'bl-overlay'
  root.innerHTML = style() + board()
  document.body.appendChild(root)

  const boardEl = root.querySelector<HTMLElement>('.bl')!
  const ringEl = root.querySelector<HTMLElement>('.bl-ring')!
  const gesteEl = root.querySelector<HTMLElement>('.bl-geste')!
  const pctEl = root.querySelector<HTMLElement>('.bl-pct')!

  // ── MISE À L'ÉCHELLE « FIT » — la planche 1200×675 tient dans la fenêtre ──
  const fit = (): void => {
    const k = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H)
    boardEl.style.transform = `translate(-50%, -50%) scale(${k})`
  }
  fit()
  window.addEventListener('resize', fit)

  const drawRing = (frac: number): void => {
    // La portion d'ambre = la progression ; le reste, la piste sombre (comme la maquette).
    ringEl.style.background = `conic-gradient(#c98b3a ${(frac * 100).toFixed(1)}%,#241a10 0)`
    pctEl.textContent = `${Math.round(frac * 100)} % · LA BRAISE COUVE`
  }
  drawRing(0)

  // Un ordre neuf à chaque chargement (mélange de Fisher-Yates), qu'on parcourt
  // ensuite en ligne droite : on ne retombe donc jamais deux fois sur le même geste
  // dans la même attente. (`Math.random` : on est dans le CLIENT. /sim n'y touche pas.)
  const shuffled = [...GESTES]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }

  /** Ce que l'anneau AFFICHE (lissé) et ce qu'il a déjà tracé. */
  let shown = 0
  let drawn = -1
  let geste0 = -1 // index du geste affiché ; -1 = aucun encore
  let gesteAt = 0
  let fadeFrom = -1 // instant où le fondu a commencé — `-1` tant que le monde n'est pas là
  let lastNow = -1 // horloge du dernier `update` — le lissage suit le TEMPS, pas les frames

  return {
    update(progress, now) {
      // `done` = passes ACHEVÉES : l'anneau ne compte que du travail fait.
      const target = progress && progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0
      // Une étape de montage peut bloquer le thread une demi-seconde : `dt` est alors
      // énorme et l'anneau rattrape presque tout — c'est voulu, il a du retard à rendre.
      const dt = lastNow < 0 ? 0 : now - lastNow
      lastNow = now
      shown += (target - shown) * Math.min(1, dt / EASE_MS)
      if (Math.abs(shown - drawn) > REDRAW_EPS) {
        drawRing(shown)
        drawn = shown
      }

      if (geste0 < 0 || now - gesteAt >= GESTE_MS) {
        geste0 = (geste0 + 1) % shuffled.length
        gesteAt = now
        gesteEl.textContent = shuffled[geste0]!
      }
    },

    fadeOut(now) {
      fadeFrom = now
      drawRing(1) // l'anneau va au bout : le monde est là, ce n'est plus une promesse
      drawn = 1
    },

    fadeStep(now) {
      if (fadeFrom < 0) return false
      const k = (now - fadeFrom) / FADE_MS
      if (k >= 1) {
        this.destroy()
        return true
      }
      root.style.opacity = String(1 - k) // le voile s'efface, le monde (rendu dessous) apparaît
      return false
    },

    destroy() {
      window.removeEventListener('resize', fit)
      root.remove()
    },
  }
}

/** La feuille de style du voile : échelle, images clés (flamme, étincelle). La police
 *  vit dans `<head>` (voir `ensureGameFont`), pour survivre au menu qui précède. */
function style(): string {
  return `<style>
  .bl-overlay{position:fixed;inset:0;z-index:50;background:#0f0b08;overflow:hidden;}
  .bl{position:absolute;left:50%;top:50%;width:${DESIGN_W}px;height:${DESIGN_H}px;overflow:hidden;
    background:#0f0b08;color:#e4ebef;transform-origin:center center;transform:translate(-50%,-50%);
    font-family:${GAME_FONT};}
  .bl *{box-sizing:border-box;}
  @keyframes blFlamePulse{0%,100%{transform:translateY(0) scale(1);opacity:.9}50%{transform:translateY(-4px) scale(1.08);opacity:1}}
  @keyframes blRingSpin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
  </style>`
}

/** La planche 8B, au pixel de la maquette. L'anneau et le %, eux, se peignent au fil
 *  de l'update (progression réelle). */
function board(): string {
  return `<div class="bl">
    <div style="position:absolute;inset:0;background:radial-gradient(60% 60% at 50% 42%,rgba(201,139,58,.12),transparent 60%);"></div>

    <div style="position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);text-align:center;">
      <div class="bl-ring" style="position:relative;width:150px;height:150px;margin:0 auto;border-radius:50%;background:conic-gradient(#c98b3a 0%,#241a10 0);">
        <div style="position:absolute;inset:8px;border-radius:50%;background:#0f0b08;display:grid;place-items:center;">
          <div style="font-size:52px;line-height:1;animation:blFlamePulse 1.3s ease-in-out infinite;filter:drop-shadow(0 0 16px rgba(201,139,58,.7));">🔥</div>
        </div>
        <div style="position:absolute;inset:0;animation:blRingSpin 3.4s linear infinite;"><div style="position:absolute;left:50%;top:-3px;transform:translateX(-50%);width:7px;height:7px;border-radius:50%;background:#e8c66a;box-shadow:0 0 10px #e8c66a;"></div></div>
      </div>

      <div style="font-size:52px;font-weight:700;color:#e8763a;letter-spacing:5px;margin-top:34px;text-shadow:0 0 30px rgba(201,139,58,.4);">BRAISES</div>
      <div style="font-size:16px;color:#e8e0c8;letter-spacing:2px;margin-top:8px;">la Veillée</div>
    </div>

    <div style="position:absolute;left:50%;bottom:70px;transform:translateX(-50%);width:620px;text-align:center;">
      <div class="bl-geste" style="font-size:13px;color:#9a8f78;letter-spacing:1px;min-height:1em;"></div>
      <div class="bl-pct" style="font-size:11px;color:#6f6a60;letter-spacing:2px;margin-top:14px;">0 % · LA BRAISE COUVE</div>
    </div>
  </div>`
}
