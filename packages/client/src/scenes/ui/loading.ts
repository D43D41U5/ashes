/**
 * L'ÉCRAN DE CHARGEMENT — le seul écran du jeu tant que la vallée n'est pas née.
 *
 * LA BARRE DIT LA VÉRITÉ, LE TEXTE RACONTE. C'est un partage volontaire :
 *
 * - la barre ne bouge que si un vrai travail a avancé. L'hôte annonce chacune de
 *   ses passes (`progress`), et la barre n'est QUE son compte (`done / total`) —
 *   rien n'est inventé, aucune animation de complaisance ;
 * - le texte, lui, ne dit pas ce que la machine fabrique. « les rivières creusent
 *   leur lit » pendant que le worker taille un flow field, c'est un rapport
 *   d'ingénieur déguisé en poème. On préfère l'aveu : ce sont des GESTES DU MONDE,
 *   tirés au sort, qui parlent du jeu et non de sa cuisine.
 *
 * La génération tourne dans le Worker : le thread principal reste libre de peindre,
 * donc cet écran vit vraiment (la barre monte, le texte tourne). Il ne porte RIEN
 * d'autre — pas de mode d'emploi, pas d'accueil : l'ancienne popup d'accueil (qui
 * s'ouvrait EN JEU, par-dessus le monde, et qu'il fallait congédier) est supprimée,
 * et son contenu n'a pas été recyclé ici. Une salle d'attente n'est pas un manuel.
 */
import type Phaser from 'phaser'

export interface LoadingScreen {
  /** Le compte de l'hôte (`undefined` tant qu'il n'a rien dit) et l'horloge de la scène. */
  update(progress: { done: number; total: number } | undefined, now: number): void
  /** Le monde est debout DERRIÈRE le voile : on remplit la barre (c'est mérité) et on
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
  'Oublier volontairement un sentier…',
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

/** La barre : large et basse, comme une braise qui court sous la cendre. */
const BAR_W = 560
const BAR_H = 14
/** Encre (le cerne), cendre (la barre vide), braise (le remplissage). */
const INK = 0x14100c
const ASH = 0x2b2723
const EMBER = 0xe8842c
/** Le fond : celui de la page (index.html) et de la caméra — l'écran ne « saute » pas au premier rendu. */
const BACKDROP = 0x0e0e12

/**
 * Aisance de la barre : elle REJOINT la vérité en douceur, sans jamais la devancer.
 * Constante de temps en MILLISECONDES, et non « une fraction par frame » : les dernières
 * étapes du chargement (le montage des couches, côté client) consomment délibérément une
 * frame CHACUNE — au rythme d'une frame, un lissage par frame n'aurait rattrapé qu'une
 * poignée de pour-cent par étape, et la barre aurait plafonné vers 85 % avant de sauter
 * d'un coup. Le lissage suit donc le temps qui passe, pas le nombre de frames.
 */
const EASE_MS = 140
/** Sous ce delta, inutile de retracer : l'œil ne verrait rien bouger. */
const REDRAW_EPS = 0.002

export function createLoadingScreen(scene: Phaser.Scene, depth: number): LoadingScreen {
  const W = scene.scale.width
  const H = scene.scale.height
  const cx = W / 2
  const barX = cx - BAR_W / 2
  const barY = H / 2 + 30

  const style = {
    fontFamily: 'monospace',
    fontSize: '16px',
    color: '#e8e0c8',
    stroke: '#14141a',
    strokeThickness: 3,
  } as const

  const backdrop = scene.add.rectangle(0, 0, W, H, BACKDROP).setOrigin(0)

  const title = scene.add
    .text(cx, H / 2 - 120, 'BRAISES', { ...style, fontSize: '44px', color: '#e8842c' })
    .setOrigin(0.5)
  const subtitle = scene.add
    .text(cx, H / 2 - 78, 'la Veillée', { ...style, fontSize: '18px', color: '#c8b88a', strokeThickness: 0 })
    .setOrigin(0.5)

  // Le geste en cours, JUSTE au-dessus de la barre — là où un autre jeu écrirait
  // « chargement des assets ». Il ne rend AUCUN compte de la machine : c'est du décor.
  const geste = scene.add
    .text(cx, barY - 16, '', { ...style, fontSize: '15px', color: '#b8b0a0', strokeThickness: 0 })
    .setOrigin(0.5, 1)

  const bar = scene.add.graphics()

  // Et RIEN d'autre. Un écran de chargement dit qu'il travaille et combien il en
  // reste — c'est tout ce qu'on lui demande. Le reste s'apprend en jouant.
  const root = scene.add.container(0, 0, [backdrop, title, subtitle, geste, bar]).setDepth(depth)

  /** Ce que la barre AFFICHE (lissé) et ce qu'elle a déjà tracé. */
  let shown = 0
  let drawn = -1

  const draw = (frac: number): void => {
    bar.clear()
    bar.fillStyle(ASH, 1).fillRect(barX, barY, BAR_W, BAR_H)
    if (frac > 0) {
      bar.fillStyle(EMBER, 1).fillRect(barX, barY, Math.max(2, Math.round(BAR_W * frac)), BAR_H)
    }
    bar.lineStyle(2, INK, 1).strokeRect(barX, barY, BAR_W, BAR_H)
  }
  draw(0)

  // Un ordre neuf à chaque chargement (mélange de Fisher-Yates), qu'on parcourt
  // ensuite en ligne droite : on ne retombe donc jamais deux fois sur le même geste
  // dans la même attente — ce qu'un tirage indépendant, lui, ferait sans se gêner.
  // (`Math.random` : on est dans le CLIENT. /sim, lui, n'a pas le droit d'y toucher.)
  const shuffled = [...GESTES]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  let geste0 = -1 // index du geste affiché ; -1 = aucun encore
  let gesteAt = 0
  /** Instant où le fondu a commencé — `-1` tant que le monde n'est pas là. */
  let fadeFrom = -1
  /** Horloge du dernier `update` — le lissage suit le TEMPS, pas les frames. */
  let lastNow = -1

  return {
    update(progress, now) {
      // `done` = passes ACHEVÉES : la barre ne compte que du travail fait.
      const target = progress && progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0
      // Une étape de montage peut bloquer le thread une demi-seconde : `dt` est alors
      // énorme et la barre rattrape presque tout — c'est voulu, elle a du retard à rendre.
      const dt = lastNow < 0 ? 0 : now - lastNow
      lastNow = now
      shown += (target - shown) * Math.min(1, dt / EASE_MS)
      if (Math.abs(shown - drawn) > REDRAW_EPS) {
        draw(shown)
        drawn = shown
      }

      if (geste0 < 0 || now - gesteAt >= GESTE_MS) {
        geste0 = (geste0 + 1) % shuffled.length
        gesteAt = now
        geste.setText(shuffled[geste0]!)
      }
    },

    fadeOut(now) {
      fadeFrom = now
      draw(1) // la barre va au bout : le monde est là, ce n'est plus une promesse
      drawn = 1
    },

    fadeStep(now) {
      if (fadeFrom < 0) return false
      const k = (now - fadeFrom) / FADE_MS
      if (k >= 1) {
        root.destroy()
        return true
      }
      // L'alpha d'un conteneur se propage à ses enfants : le voile, le titre et la
      // barre s'effacent d'un seul geste, et le monde (déjà rendu dessous) apparaît.
      root.setAlpha(1 - k)
      return false
    },

    destroy() {
      root.destroy() // le fond, le titre, la barre, les touches — tout part ensemble
    },
  }
}
