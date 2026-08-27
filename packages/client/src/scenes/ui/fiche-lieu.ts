/**
 * LA FICHE D'UN LIEU — le registre qu'on ouvre depuis la carte (spec `annales.md` R13-R16,
 * `saison-sans-fin` T5).
 *
 * `/sim` sait depuis longtemps ce qu'un lieu a à dire — `registreDuLieu` était pur, testé,
 * exporté… et **aucun fichier du client ne l'importait**. Une loi livrée sans appelant. Cet
 * écran est son lecteur.
 *
 * ⚠ IL N'ÉCRIT RIEN. Toutes les phrases, toutes les gouttières et tout l'ordre viennent de
 * `ficheDuLieu` (`/sim`) : c'est la doctrine de l'écrivain unique, la même qui empêche la
 * stèle et la chronique de se contredire sur un même fait. Ce module POSE du DOM, un point.
 *
 * Rendu DOM sur `document.body` (la carte est du Phaser upscalé — un texte de registre y
 * crénellerait), en TIROIR sur le bord droit et non en modale : on garde la carte sous les
 * yeux, on clique une autre pastille, la fiche suit. Une modale aurait fait de chaque lecture
 * un aller-retour.
 *
 * ⚠ SA LIMITE, DITE : le tiroir capte le pointeur sur sa largeur (`min(420px, 38vw)`), donc les
 * pastilles qu'il RECOUVRE ne sont pas cliquables tant qu'il est ouvert — « on clique une autre
 * pastille » vaut pour celles qui restent à sa gauche. On l'assume plutôt que de le refermer au
 * clic : une lecture qu'un geste de trop fait disparaître est pire qu'un tiers de carte à
 * découvrir en le fermant (la croix, ou le clic dans le vide).
 */
import { ficheDuLieu, type LigneDeFiche, type ChronicleVolume, type WorldMap } from '@ashes/sim'
import { ensureGameFont, GAME_FONT } from './game-font'
import { HEX } from './palette'

export interface FicheLieu {
  /** Ouvre (ou remplace) la fiche du lieu. `nom` vient de `map.zones[poiId].name` — il porte
   *  déjà le SORT du lieu, baptisé à la génération : rien à recomposer ici. */
  ouvrir(map: WorldMap, poiId: number, nom: string, volumes: ChronicleVolume[]): void
  fermer(): void
  /** Le lieu affiché, ou `null`. UIScene s'en sert pour savoir si ESC lui revient. */
  poiOuvert(): number | null
  destroy(): void
}

/** Ce qu'on pose quand le lieu n'a RIEN à dire — ni fait du pays d'avant, ni ligne de
 *  chronique. Un constat, pas une explication : le silence est l'information (R9, R15). */
export const RIEN_ENCORE = 'Rien ne s’est encore dit ici.'

/** Échappe le texte : les noms de lieu et les lignes de chronique viennent de `/sim`, mais
 *  rien ne justifie de les injecter en HTML brut — un toponyme est une chaîne, pas du balisage. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Une ligne de la colonne : gouttière à gauche, texte à droite, le POIDS en classe.
 *  Exportée pour sa garde : c'est le seul endroit du client qui touche au texte du registre. */
export function ligneHtml(l: LigneDeFiche): string {
  return `<div class="fl-l fl-${l.poids}"><span class="fl-g">${esc(l.gouttiere)}</span><span class="fl-t">${esc(l.texte)}</span></div>`
}

export function createFicheLieu(deps: { onFermer(): void }): FicheLieu {
  // La police du jeu, POSÉE et pas héritée : ce tiroir monte sur `document.body`, qui n'en
  // déclare aucune (leçon du menu PAUSE — un `inherit` y récupère la serif du navigateur).
  ensureGameFont()
  document.querySelectorAll('.fiche-lieu').forEach((n) => n.remove())
  const root = document.createElement('div')
  root.className = 'fiche-lieu'
  root.innerHTML = `
  <style>
    /* LE TIROIR, à .985 d'opacité et pas moins : à .965, VU en capture, l'estampille de
       build et le HUD traversaient le fond (la même leçon que le menu PAUSE).
       Le pointeur n'est capté QUE sur lui : hors de sa largeur, la molette et
       le glisser restent à la carte Phaser (mémoire « le DOM vole le geste au canvas » — un
       panneau traversant mangeait la molette du monde entier). */
    .fiche-lieu{position:fixed;top:0;right:0;bottom:0;width:min(420px,38vw);z-index:64;
      display:none;flex-direction:column;font-family:${GAME_FONT};
      background:rgba(20,16,12,.985);border-left:1px solid ${HEX.bordSombre};
      transform:translateX(14px);opacity:0;transition:opacity .18s ease,transform .18s ease;}
    .fiche-lieu.fl-on{opacity:1;transform:none;}
    .fl-head{display:flex;align-items:flex-start;gap:12px;padding:22px 22px 0;}
    .fl-nom{flex:1;font-size:17px;font-weight:700;color:${HEX.ember};letter-spacing:2px;
      line-height:1.35;text-transform:uppercase;}
    .fl-x{background:transparent;border:1px solid ${HEX.bordSombre};color:${HEX.dim};
      font-size:15px;line-height:1;padding:5px 9px;cursor:pointer;}
    .fl-x:hover{color:${HEX.body};border-color:#8a7a52;}
    /* Le plancher clavier : tout écran qui prend la main se referme au clavier. */
    .fl-x:focus-visible{outline:2px solid #e8c66a;outline-offset:3px;}
    .fl-div{height:1px;background:#6b5a3a;margin:16px 22px 0;}
    /* LA COLONNE UNIQUE (décision d'Alexis, 2026-08-25) : le pays d'avant et la mémoire du
       joueur prennent la MÊME forme — même gouttière, même corps, même rythme. On ne
       distingue plus qui est la strate de qui, et c'est le but. */
    .fl-corps{flex:1;overflow-y:auto;padding:18px 22px 26px;}
    .fl-l{display:grid;grid-template-columns:minmax(0,8.5rem) 1fr;column-gap:14px;
      font-size:13px;line-height:1.65;padding:5px 0;}
    .fl-g{color:${HEX.faint};text-align:right;}
    .fl-t{color:${HEX.body};}
    /* Les trois registres, à l'identique de la chronique (season-veil) : une seule grammaire
       de poids dans tout le jeu. */
    .fl-battement .fl-t{color:${HEX.bodyBright};border-left:2px solid ${HEX.ember};padding-left:10px;margin-left:-12px;}
    .fl-intime .fl-t{font-style:italic;color:${HEX.dim};}
    .fl-vide{font-size:13px;color:${HEX.faint};font-style:italic;line-height:1.7;}
  </style>
  <div class="fl-head"><div class="fl-nom"></div><button class="fl-x" aria-label="Fermer">✕</button></div>
  <div class="fl-div"></div>
  <div class="fl-corps"></div>`
  document.body.appendChild(root)

  const elNom = root.querySelector<HTMLElement>('.fl-nom')!
  const elCorps = root.querySelector<HTMLElement>('.fl-corps')!
  const elX = root.querySelector<HTMLButtonElement>('.fl-x')!
  elX.addEventListener('click', () => deps.onFermer())

  let poi: number | null = null
  return {
    ouvrir(map, poiId, nom, volumes) {
      const colonne = ficheDuLieu(map, poiId, volumes)
      elNom.textContent = nom
      elCorps.innerHTML = colonne.length > 0
        ? colonne.map(ligneHtml).join('')
        : `<div class="fl-vide">${RIEN_ENCORE}</div>`
      elCorps.scrollTop = 0
      if (poi === null) {
        root.style.display = 'flex'
        void root.offsetWidth // reflow : la transition ne part pas depuis display:none
        root.classList.add('fl-on')
      }
      poi = poiId
    },
    fermer() {
      if (poi === null) return
      poi = null
      root.classList.remove('fl-on')
      root.style.display = 'none'
    },
    poiOuvert: () => poi,
    destroy() {
      root.remove()
    },
  }
}
