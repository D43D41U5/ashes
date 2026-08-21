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
import { ACTIONS, keymapEffectif } from '../world/keymap-perso'
import { libelleTouches } from '../world/touches'

/**
 * LE TABLEAU DES TOUCHES SE DÉRIVE, IL NE SE RÉCITE PLUS.
 *
 * Il était une liste écrite à la main — « Se déplacer · ZQSD · WASD · flèches ». Elle disait
 * vrai tant que personne ne pouvait rien changer ; depuis l'écran des réglages, elle aurait
 * MENTI dès le premier rebind, et c'est le pire endroit pour mentir : c'est là qu'on vient
 * quand on ne sait plus quelle touche fait quoi. Elle vient donc de la même source que le jeu
 * (`keymapEffectif`) et se recalcule à CHAQUE ouverture — un réglage changé en cours de partie
 * se lit tout de suite.
 *
 * Y RESTE EN DUR ce que `KEYMAP` ne porte pas : la ceinture (`BELT_BINDINGS`, six touches pour
 * une seule notion — les lister une par une noierait le tableau).
 */
function lignesDeTouches(): [string, string][] {
  const effectif = keymapEffectif()
  const out: [string, string][] = ACTIONS.map((a) => [a.libelle, libelleTouches(effectif[a.action])])
  out.push(['Ceinture (objet en main)', '1 – 6'])
  return out
}

/** La règle du clic gauche — « l'objet en main décide ». La moitié invisible du jeu.
 *  Colonne de droite tenue COURTE (≤ 34 signes) : en mono, au-delà, la ligne se casse en
 *  deux et le tableau perd son rythme (une ligne sur deux vaut le double de hauteur). */
export const CLICKS: [string, string][] = [
  ['un arbre, un rocher', 'abattre, miner (maintenu)'],
  ['une arme en main', 'frapper — maintenu : coup lourd'],
  ['une HACHE sur un arbre', 'elle abat : l’outil prime'],
  ['de la nourriture', 'manger — ou la DONNER à un voisin'],
  // « se panser » était FAUX depuis qu'on panse AUTRUI (aim.ts, 2026-07-28) : le troisième
  // verbe chaud du jeu était livré, testé, et enseigné par une ligne qui l'ignorait.
  ['des fibres, et une plaie', 'panser — soi, ou un blessé'],
  ['du bois, sur le Feu', 'le NOURRIR (il tient l’upkeep)'],
  ['du bois, sur un mur abîmé', 'le RÉPARER'],
  ['une graine, sur une parcelle', 'semer'],
  ['un cadavre, une pile au sol', 'fouiller, ramasser'],
]

/**
 * LE CLIC DROIT — quatre gestes que RIEN, dans tout le jeu, ne nommait (audit UX, D5-5).
 *
 * Le seul tableau de gestes du dépôt était borné à l'autre bouton (« LE CLIC GAUCHE — L'OBJET
 * EN MAIN DÉCIDE »), et aucune chaîne affichée du client ne mentionnait le bouton droit : un
 * grep n'y trouvait que des commentaires et l'Atelier, hors build. Conséquence : l'arc restait
 * un objet mort dans le sac — sa grammaire ne se découvrait qu'en appuyant au hasard sur un
 * bouton dont rien ne suggérait qu'il serve.
 */
export const CLICS_DROITS: [string, string][] = [
  ['un ARC en main', 'lever et bander — relâcher décoche'],
  ['l’arc levé', 'la visée suit le curseur'],
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
  /** QUITTER vers le menu principal. WorldScene sauve d'abord, puis rend la main à MenuScene. */
  onQuit(): void
}

/**
 * `onResume` referme le menu ; « retour au menu principal » rend la main à `MenuScene`.
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
    /* LE PLANCHER CLAVIER (décision d'Alexis, 2026-08-20, question ⑩). Sur tout le client,
       la pseudo-classe focus-visible n'existait QU'À l'écran d'accueil : 4 occurrences, les quatre dans
       menu-dom.ts, zéro dans les 43 autres modules d'UI. La reco était « pas une campagne, un
       plancher » — tout écran qui BLOQUE le jeu doit être franchissable au clavier, parce
       qu'un écran modal sans sortie clavier n'est pas un inconfort, c'est un piège. */
    .pm-btn:focus-visible{outline:2px solid #e8c66a;outline-offset:3px;}
    .pm-btn.pm-ghost{background:transparent;border-color:#6b5a3a;color:#9a8f78;letter-spacing:1px;font-weight:400;}
    .pm-btn.pm-ghost:hover{color:#e8e0c8;border-color:#8a7a52;background:rgba(40,34,26,.4);}
  </style>
  <div class="pm-glow"></div>
  <div class="pm-card">
    <div class="pm-eyebrow">LA VEILLÉE, EN PAUSE</div>
    <div class="pm-title">ASHES</div>
    <div class="pm-div"></div>
    <div class="pm-sect">LE CLIC GAUCHE — L’OBJET EN MAIN DÉCIDE</div>
    <div class="pm-table">${CLICKS.map((c) => row(c, 'pm-click')).join('')}</div>
    <div class="pm-sect">LE CLIC DROIT — VISER</div>
    <div class="pm-table">${CLICS_DROITS.map((c) => row(c, 'pm-click')).join('')}</div>
    <div class="pm-sect">LES TOUCHES</div>
    <div class="pm-table pm-keys"></div>
    <div class="pm-sect">LE SON</div>
    <div class="pm-sound">
      <input type="range" class="pm-vol" min="0" max="100" step="1" aria-label="Volume">
      <span class="pm-vol-val"></span>
    </div>
    <div class="pm-row2 pm-choices">
      <button class="pm-btn pm-resume">REPRENDRE</button>
      <button class="pm-btn pm-ghost pm-quit">retour au menu principal</button>
    </div>
  </div>`
  document.body.appendChild(root)

  root.querySelector<HTMLElement>('.pm-resume')!.addEventListener('click', () => onResume())

  // « RETOUR AU MENU PRINCIPAL » ne détruit rien et ne demande donc pas de confirmation : la
  // partie est ÉCRITE avant qu'on parte (WorldScene attend le `saved` de l'hôte). Le bouton reste
  // fantôme, à côté de REPRENDRE — le geste principal doit rester le plus lumineux des deux.
  //
  // Il DIT OÙ IL VA, et il n'a pas toujours été vrai : il portait « retour aux vallées » alors
  // qu'il atterrissait sur l'accueil, laissant la liste des vallées à deux clics de son propre
  // nom. Le geste va au SEUIL (décision d'Alexis, 2026-07-29) ; l'étiquette le suit.
  root.querySelector<HTMLElement>('.pm-quit')!.addEventListener('click', () => onQuit())

  // Repeint le tableau depuis le jeu de touches EFFECTIF. Appelé à chaque ouverture : c'est le
  // seul moment qui compte, et ça coûte quinze lignes de HTML.
  const tableKeys = root.querySelector<HTMLElement>('.pm-keys')!
  const peindreTouches = (): void => {
    tableKeys.innerHTML = lignesDeTouches()
      .map((l) => row(l))
      .join('')
  }
  peindreTouches()

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
        peindreTouches() // un réglage changé depuis la dernière ouverture doit se lire ici
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
