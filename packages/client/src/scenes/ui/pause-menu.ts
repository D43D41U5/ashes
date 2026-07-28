/**
 * LE MENU PAUSE (ESC) — reprendre, RELIRE LES CONTRÔLES, repartir.
 *
 * Le jeu n'avait ni pause ni rappel des commandes en cours de partie : les touches
 * ne se disaient qu'à l'accueil et par l'onboarding (une fois). Or la règle centrale —
 * « l'OBJET EN MAIN décide du clic » — est puissante mais invisible : rien à l'écran ne
 * rappelle que du bois sur le Feu le NOURRIT, ou que des fibres sur une plaie la PANSENT.
 * Ce menu la garde à portée d'ESC, et fige le monde solo le temps qu'on la lise (l'hôte
 * est mis en pause par WorldScene — voir `menuOpen`).
 *
 * Rendu DOM sur `document.body` (vrai plein écran, hors planche scalée), même grammaire
 * que le voile de mort / la stèle : fond chaud, sourcil braise, titre espacé, filet.
 */
import { ensureGameFont, GAME_FONT } from './game-font'

/** Une ligne du tableau des contrôles : un libellé, la ou les touches. */
const KEYS: [string, string][] = [
  ['Se déplacer', 'ZQSD · WASD · flèches'],
  ['Courir · Marcher lentement', 'SHIFT · C'],
  ['Parer (maintenu)', 'ESPACE'],
  ['Interagir (cueillir, ouvrir)', 'F'],
  ['Tourner ce qu’on pose', 'A · E'],
  ['Ceinture (objet en main)', '1 – 6'],
  ['Jeter ce qu’on tient', 'G'],
  ['Personnage (sac, artisanat)', 'TAB'],
  ['Carte · Chronique', 'M · J'],
  ['Couper le son', 'N'],
]

/** La règle du clic gauche — « l'objet en main décide ». La moitié invisible du jeu.
 *  Colonne de droite tenue COURTE (≤ 34 signes) : en mono, au-delà, la ligne se casse en
 *  deux et le tableau perd son rythme (une ligne sur deux vaut le double de hauteur). */
const CLICKS: [string, string][] = [
  ['un arbre, un rocher', 'abattre, miner (maintenu)'],
  ['une arme en main', 'frapper — maintenu : coup lourd'],
  ['de la nourriture', 'manger — ou la DONNER à un voisin'],
  ['des fibres, et une plaie', 'se panser'],
  ['du bois, sur le Feu', 'le NOURRIR (il tient l’upkeep)'],
  ['du bois, sur un mur abîmé', 'le RÉPARER'],
]

export interface PauseMenu {
  setVisible(open: boolean): void
  destroy(): void
}

export interface PauseMenuDeps {
  /** Referme le menu (WorldScene reprend l'hôte). */
  onResume(): void
  /** Le volume maître courant (0..1) — pour poser le curseur à l'ouverture. */
  getVolume(): number
  /** L'utilisateur a bougé le curseur de son (0..1). */
  onVolume(v: number): void
  /** QUITTER vers l'écran des vallées. WorldScene sauve d'abord, puis recharge. */
  onQuit(): void
}

/**
 * `onResume` referme le menu ; « retour aux vallées » rend la main à l'écran des mondes.
 *
 * ⚠ CE MENU N'EFFACE PLUS RIEN (2026-07-28). Il portait « nouvelle Veillée » et sa confirmation
 * rouge — le seul chemin, à l'époque, pour repartir à neuf, puisque l'accueil n'avait qu'une
 * porte. Depuis l'écran des vallées, effacer se fait DANS LA LISTE, en face de ce qu'on perd
 * (le jour atteint, la seed) et sans traverser la partie qu'on veut quitter. Ici, quitter est
 * devenu un geste sûr : on sauve, et on sort.
 */
export function createPauseMenu({ onResume, getVolume, onVolume, onQuit }: PauseMenuDeps): PauseMenu {
  // La police du jeu, POSÉE et pas héritée : ce voile monte sur `document.body`, qui n'en
  // déclare aucune — un `inherit` y récupérait la serif par défaut du navigateur.
  ensureGameFont()
  document.querySelectorAll('.pause-menu').forEach((n) => n.remove())
  const root = document.createElement('div')
  root.className = 'pause-menu'
  // Plus de séparateur « · » : c'est la GRILLE qui aligne les deux colonnes (le point
  // flottait, et son gris échouait au contraste). `display:contents` sur la ligne fait
  // tomber ses deux cellules directement dans la grille du tableau.
  const row = ([a, b]: [string, string], cls = ''): string =>
    `<div class="pm-row ${cls}"><span class="pm-l">${a}</span><span class="pm-r">${b}</span></div>`
  root.innerHTML = `
  <style>
    /* flex-start et non center : la carte est plus haute que la fenêtre (contrôles + son),
       et la centrer poussait la rangée d'actions — donc REPRENDRE — SOUS LE PLI, sans que
       rien ne signale qu'il fallait défiler. Le fond monte à .985 : à .93 le HUD traversait
       (le filet du menu tombait pile sur la ligne de conseil du jeu). */
    .pause-menu{position:fixed;inset:0;z-index:70;display:none;align-items:flex-start;justify-content:center;
      opacity:0;transition:opacity .2s ease;pointer-events:auto;overflow-y:auto;padding:40px 0 0;
      background:rgba(20,16,12,.985);
      -webkit-backdrop-filter:brightness(.7);backdrop-filter:brightness(.7);font-family:${GAME_FONT};}
    .pause-menu.pm-on{opacity:1;}
    .pm-glow{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:900px;height:400px;pointer-events:none;
      background:radial-gradient(ellipse at bottom,rgba(201,139,58,.16),transparent 68%);}
    .pm-card{position:relative;text-align:center;max-width:640px;margin:auto;padding:0 44px;}
    .pm-eyebrow{font-size:12px;color:#c98b3a;letter-spacing:4px;}
    .pm-title{font-size:26px;font-weight:700;color:#c98b3a;letter-spacing:6px;margin-top:14px;
      text-shadow:0 2px 0 #14141a,0 0 18px rgba(201,139,58,.25);}
    .pm-div{width:80px;height:1px;background:#6b5a3a;margin:22px auto;}
    .pm-sect{font-size:12px;color:#c98b3a;letter-spacing:4px;margin:24px 0 12px;}
    /* UNE GRILLE, pas des lignes flex : les deux colonnes s'alignent d'elles-mêmes et le
       rythme vertical devient CONSTANT. En flex, la colonne droite était contrainte à
       ~32 signes pour des phrases de 45 : une ligne sur deux se cassait, donc alternait
       26 px et 51 px de hauteur. Le tableau ne se lisait ni comme liste ni comme grille. */
    .pm-table{display:grid;grid-template-columns:minmax(0,15rem) 1fr;column-gap:18px;row-gap:9px;
      max-width:40rem;margin:0 auto;text-align:left;font-size:13.5px;line-height:1.5;}
    .pm-row{display:contents;}
    .pm-l{color:#9a8f78;}
    .pm-r{color:#e8e0c8;}
    .pm-row.pm-click .pm-l{color:#c0a074;}
    .pm-sound{display:flex;align-items:center;gap:14px;justify-content:center;margin-top:4px;}
    .pm-vol{-webkit-appearance:none;appearance:none;width:280px;height:4px;background:#3a3225;border-radius:2px;outline:none;}
    .pm-vol::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#c98b3a;cursor:pointer;border:2px solid #14100c;}
    .pm-vol::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#c98b3a;cursor:pointer;border:2px solid #14100c;}
    .pm-vol-val{font-size:13px;color:#e8c66a;min-width:42px;text-align:left;}
    /* La rangée d'actions COLLE EN BAS : quelle que soit la hauteur de la carte ou de la
       fenêtre, REPRENDRE reste sous la main. C'est le geste pour lequel on a ouvert le menu. */
    .pm-row2{position:sticky;bottom:0;display:flex;gap:14px;justify-content:center;flex-wrap:wrap;
      margin-top:30px;padding:18px 0 24px;
      background:linear-gradient(transparent,rgba(20,16,12,.985) 42%);}
    .pm-btn{background:rgba(201,139,58,.14);border:2px solid #c98b3a;color:#e8c66a;font-size:15px;font-weight:700;
      letter-spacing:2px;padding:13px 30px;transition:background .12s ease,color .12s ease;}
    .pm-btn:hover{background:rgba(232,198,106,.24);color:#f2ead0;}
    .pm-btn.pm-ghost{background:transparent;border-color:#6b5a3a;color:#9a8f78;letter-spacing:1px;font-weight:400;}
    .pm-btn.pm-ghost:hover{color:#e8e0c8;border-color:#8a7a52;background:rgba(40,34,26,.4);}
  </style>
  <div class="pm-glow"></div>
  <div class="pm-card">
    <div class="pm-eyebrow">LA VEILLÉE, EN PAUSE</div>
    <div class="pm-title">BRAISES</div>
    <div class="pm-div"></div>
    <div class="pm-sect">LE CLIC GAUCHE — L’OBJET EN MAIN DÉCIDE</div>
    <div class="pm-table">${CLICKS.map((c) => row(c, 'pm-click')).join('')}</div>
    <div class="pm-sect">LES TOUCHES</div>
    <div class="pm-table">${KEYS.map((k) => row(k)).join('')}</div>
    <div class="pm-sect">LE SON</div>
    <div class="pm-sound">
      <input type="range" class="pm-vol" min="0" max="100" step="1" aria-label="Volume">
      <span class="pm-vol-val"></span>
    </div>
    <div class="pm-row2 pm-choices">
      <button class="pm-btn pm-resume">REPRENDRE</button>
      <button class="pm-btn pm-ghost pm-quit">retour aux vallées</button>
    </div>
  </div>`
  document.body.appendChild(root)

  root.querySelector<HTMLElement>('.pm-resume')!.addEventListener('click', () => onResume())

  // « RETOUR AUX VALLÉES » ne détruit rien et ne demande donc pas de confirmation : la partie
  // est ÉCRITE avant qu'on parte (WorldScene attend le `saved` de l'hôte). Le bouton reste
  // fantôme, à côté de REPRENDRE — le geste principal doit rester le plus lumineux des deux.
  root.querySelector<HTMLElement>('.pm-quit')!.addEventListener('click', () => onQuit())

  // LE CURSEUR DE SON : posé au volume courant, il règle le volume maître en direct (persisté
  // par le moteur audio). `onVolume` route vers WorldScene (le moteur y vit) via le registre.
  const vol = root.querySelector<HTMLInputElement>('.pm-vol')!
  const volVal = root.querySelector<HTMLElement>('.pm-vol-val')!
  const paint = (pct: number): void => {
    volVal.textContent = `${pct} %`
  }
  vol.value = String(Math.round(getVolume() * 100))
  paint(Number(vol.value))
  vol.addEventListener('input', () => {
    const pct = Number(vol.value)
    paint(pct)
    onVolume(pct / 100)
  })

  let shown = false
  return {
    setVisible(open) {
      // Appelé chaque frame par UIScene : on ne fait le travail (reflow, classe) que sur CHANGEMENT.
      if (open === shown) return
      shown = open
      if (open) {
        root.style.display = 'flex'
        void root.offsetWidth // reflow : la transition d'opacité ne part pas depuis display:none
        root.classList.add('pm-on')
      } else {
        root.classList.remove('pm-on')
        root.style.display = 'none'
      }
    },
    destroy() {
      root.remove()
    },
  }
}
