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
import { reopenFreshVeillee } from './reopen-veillee'

/** Une ligne du tableau des contrôles : un libellé, la ou les touches. */
const KEYS: [string, string][] = [
  ['Se déplacer', 'ZQSD · WASD · flèches'],
  ['Courir · Marcher lentement', 'SHIFT · C'],
  ['Parer (maintenu)', 'ESPACE'],
  ['Ceinture (objet en main)', '1 – 6'],
  ['Jeter ce qu’on tient', 'G'],
  ['Sac & artisanat', 'TAB'],
  ['Carte · Chronique', 'M · J'],
  ['Couper le son', 'N'],
]

/** La règle du clic gauche — « l'objet en main décide ». La moitié invisible du jeu. */
const CLICKS: [string, string][] = [
  ['un nœud, un arbre', 'récolter (maintenu : coup lourd d’abattage)'],
  ['une arme en main', 'frapper (maintenu : coup lourd chargé)'],
  ['de la nourriture', 'manger — ou, sur un voisin, la lui DONNER'],
  ['des fibres, et une plaie', 'se panser'],
  ['du bois, sur le Feu', 'le NOURRIR (le seul geste qui tient l’upkeep)'],
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
}

/** `onResume` referme le menu ; le bouton « nouvelle Veillée » pose le deep-link `?fresh`. */
export function createPauseMenu({ onResume, getVolume, onVolume }: PauseMenuDeps): PauseMenu {
  document.querySelectorAll('.pause-menu').forEach((n) => n.remove())
  const root = document.createElement('div')
  root.className = 'pause-menu'
  const row = ([a, b]: [string, string], sep = '·', cls = ''): string =>
    `<div class="pm-row ${cls}"><span class="pm-l">${a}</span><span class="pm-sep">${sep}</span><span class="pm-r">${b}</span></div>`
  root.innerHTML = `
  <style>
    .pause-menu{position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;
      opacity:0;transition:opacity .2s ease;pointer-events:auto;overflow-y:auto;padding:40px 0;
      background:rgba(20,16,12,.93);
      -webkit-backdrop-filter:brightness(.7);backdrop-filter:brightness(.7);font-family:inherit;}
    .pause-menu.pm-on{opacity:1;}
    .pm-glow{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:900px;height:400px;pointer-events:none;
      background:radial-gradient(ellipse at bottom,rgba(201,139,58,.16),transparent 68%);}
    .pm-card{position:relative;text-align:center;max-width:640px;margin:auto;padding:0 44px;}
    .pm-eyebrow{font-size:12px;color:#c98b3a;letter-spacing:4px;}
    .pm-title{font-size:26px;font-weight:700;color:#c98b3a;letter-spacing:6px;margin-top:14px;
      text-shadow:0 2px 0 #14141a,0 0 18px rgba(201,139,58,.25);}
    .pm-div{width:80px;height:1px;background:#6b5a3a;margin:22px auto;}
    .pm-sect{font-size:12px;color:#c98b3a;letter-spacing:4px;margin:24px 0 12px;}
    .pm-table{max-width:520px;margin:0 auto;text-align:left;}
    .pm-row{display:flex;align-items:baseline;gap:10px;font-size:13.5px;line-height:1.9;}
    .pm-l{flex:0 0 46%;color:#9a8f78;}
    .pm-sep{color:#6b5a3a;}
    .pm-r{flex:1;color:#e8e0c8;}
    .pm-row.pm-click .pm-l{color:#c0a074;}
    .pm-sound{display:flex;align-items:center;gap:14px;justify-content:center;margin-top:4px;}
    .pm-vol{-webkit-appearance:none;appearance:none;width:280px;height:4px;background:#3a3225;border-radius:2px;outline:none;}
    .pm-vol::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#c98b3a;cursor:pointer;border:2px solid #14100c;}
    .pm-vol::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#c98b3a;cursor:pointer;border:2px solid #14100c;}
    .pm-vol-val{font-size:13px;color:#e8c66a;min-width:42px;text-align:left;}
    .pm-hint{font-size:12px;color:#6f6a60;letter-spacing:.5px;margin-top:14px;}
    .pm-row2{display:flex;gap:14px;justify-content:center;margin-top:30px;flex-wrap:wrap;}
    .pm-btn{background:rgba(201,139,58,.14);border:2px solid #c98b3a;color:#e8c66a;font-size:15px;font-weight:700;
      letter-spacing:2px;padding:13px 30px;transition:background .12s ease,color .12s ease;}
    .pm-btn:hover{background:rgba(232,198,106,.24);color:#f2ead0;}
    .pm-btn.pm-ghost{background:transparent;border-color:#6b5a3a;color:#9a8f78;letter-spacing:1px;font-weight:400;}
    .pm-btn.pm-ghost:hover{color:#e8e0c8;border-color:#8a7a52;background:rgba(40,34,26,.4);}
    /* LA CONFIRMATION D'EFFACEMENT : rouge d'alerte, le seul de l'écran — on ne clique pas
       « effacer » par inadvertance quand le bouton porte la couleur du danger. */
    .pm-confirm[hidden]{display:none;}
    /* Le display:flex de .pm-row2 ÉCRASE le [hidden]{display:none} de la feuille du navigateur :
       sans cette règle plus spécifique, masquer la rangée de choix n'avait AUCUN effet visuel
       (les deux rangées restaient à l'écran, la confirmation débordait sous le pli). */
    .pm-row2[hidden]{display:none;}
    .pm-warn{font-size:13px;color:#e05a4a;letter-spacing:1px;margin-top:26px;line-height:1.7;}
    .pm-warn b{color:#f2ead0;font-weight:700;}
    .pm-btn.pm-danger{background:rgba(224,90,74,.16);border-color:#e05a4a;color:#e05a4a;}
    .pm-btn.pm-danger:hover{background:rgba(224,90,74,.3);color:#f2ead0;}
  </style>
  <div class="pm-glow"></div>
  <div class="pm-card">
    <div class="pm-eyebrow">LA VEILLÉE, EN PAUSE</div>
    <div class="pm-title">BRAISES</div>
    <div class="pm-div"></div>
    <div class="pm-sect">LE CLIC GAUCHE — L’OBJET EN MAIN DÉCIDE</div>
    <div class="pm-table">${CLICKS.map((c) => row(c, '→', 'pm-click')).join('')}</div>
    <div class="pm-sect">LES TOUCHES</div>
    <div class="pm-table">${KEYS.map((k) => row(k)).join('')}</div>
    <div class="pm-sect">LE SON</div>
    <div class="pm-sound">
      <input type="range" class="pm-vol" min="0" max="100" step="1" aria-label="Volume">
      <span class="pm-vol-val"></span>
    </div>
    <div class="pm-hint">ESPACE pare de face · maintenir le clic, c’est charger un coup lourd · N coupe le son.</div>
    <div class="pm-row2 pm-choices">
      <button class="pm-btn pm-resume">REPRENDRE</button>
      <button class="pm-btn pm-ghost pm-fresh">nouvelle Veillée</button>
    </div>
    <div class="pm-confirm" hidden>
      <div class="pm-warn">Repartir efface <b>la Veillée en cours</b> — la vallée, le Feu, tout ce que vous y avez bâti.<br>C'est sans retour.</div>
      <div class="pm-row2">
        <button class="pm-btn pm-ghost pm-cancel">revenir en arrière</button>
        <button class="pm-btn pm-danger pm-fresh-go">EFFACER ET REPARTIR</button>
      </div>
    </div>
  </div>`
  document.body.appendChild(root)

  root.querySelector<HTMLElement>('.pm-resume')!.addEventListener('click', () => onResume())

  // « nouvelle Veillée » EFFACE la sauvegarde, sans retour — et le bouton vivait à côté de
  // « REPRENDRE ». Un seul clic de travers et la partie en cours disparaissait. Il ouvre
  // désormais une CONFIRMATION explicite : le geste destructeur demande un second clic, sur
  // un bouton rouge qui NOMME ce qu'on perd. (À la stèle de fin de saison, pas de garde-fou :
  // la saison est finie, repartir y est le geste attendu — il n'y a plus rien à protéger.)
  const choices = root.querySelector<HTMLElement>('.pm-choices')!
  const confirm = root.querySelector<HTMLElement>('.pm-confirm')!
  const askConfirm = (open: boolean): void => {
    confirm.hidden = !open
    choices.hidden = open // on ne laisse pas les deux rangées à l'écran : le choix est franc
    // La carte de pause est HAUTE (contrôles + son) et défile : posée en bas, la confirmation
    // tombait sous le pli, boutons coupés. On l'amène à l'œil. `behavior` par défaut = instantané
    // (un défilement animé serait du mouvement, proscrit en `prefers-reduced-motion`).
    if (open) confirm.scrollIntoView({ block: 'center' })
  }
  root.querySelector<HTMLElement>('.pm-fresh')!.addEventListener('click', () => askConfirm(true))
  root.querySelector<HTMLElement>('.pm-cancel')!.addEventListener('click', () => askConfirm(false))
  root.querySelector<HTMLElement>('.pm-fresh-go')!.addEventListener('click', reopenFreshVeillee)

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
        askConfirm(false) // refermer la pause désarme la confirmation : jamais armée à l'insu
      }
    },
    destroy() {
      root.remove()
    },
  }
}
