/**
 * L'ÉCRAN PRINCIPAL, EN DOM — rendu ISO à la maquette « Ashes UI » Turn 9A.
 *
 * POURQUOI DU DOM, ET PAS DU PHASER. La maquette EST du HTML/CSS : un titre en
 * `text-shadow` doux, un anneau en `conic-gradient`, une police `JetBrains Mono`,
 * des fonds en `radial-gradient` à 7 % d'ambre. Rejoués dans le canvas Phaser —
 * en 1280×720 puis upscalé (`image-rendering: pixelated`) à la fenêtre — le texte
 * se crénelle, la police tombe en `monospace` générique, et un Glow FX shader
 * force le halo. On chassait un écart qui ne se refermait jamais. Ici on ne
 * REPRODUIT plus la maquette : on la REJOUE, au pixel de teinte et de métrique
 * près, en réutilisant sa grammaire CSS. Le canvas Phaser reste derrière (le jeu) ;
 * ce voile ne vit que le temps du menu et se retire au lancement d'une partie.
 *
 * La planche est calée à 1920×1080 (la résolution de la maquette) et mise à
 * l'échelle pour TENIR dans la fenêtre (letterbox), exactement comme le canvas du
 * jeu en `Scale.FIT` — d'où l'identité des proportions à toute taille d'écran.
 *
 * ── CINQ ÉCRANS, UN SEUL VOILE (2026-07-28) ────────────────────────────────────
 * L'accueil a d'abord été LA LISTE DES VALLÉES elle-même. C'était juste tant qu'il n'y
 * avait rien d'autre à faire, mais ça mettait cinq lignes de gestion de sauvegardes
 * devant quelqu'un qui voulait seulement continuer sa partie. L'accueil pose donc
 * maintenant les trois questions dans l'ordre où on se les pose : REPRENDRE (ce que je
 * faisais), JOUER (autre chose), OPTIONS (régler). La liste des vallées est devenue ce
 * qu'elle est — un écran de gestion, à un cran de profondeur.
 *
 * L'anneau et le titre NE BOUGENT JAMAIS d'un écran à l'autre : seul `.bm-corps` est
 * repeint. Ce n'est pas une économie de code, c'est ce qui fait qu'on navigue dans un même
 * lieu au lieu de sauter entre des écrans qui se remplacent.
 */
import { SERVERS, type ServerEntry } from '../../servers'
import type { SlotMeta } from '../../worker/persistence-store'
import type { DerniereMulti } from '../../derniere-partie'
import { NOM_MAX, SEED_MAX, SLOT_COUNT, VEILLEE_SEED, nettoieNom, seedValide } from '../../worker/mondes'
import { depuisQuand, etatDeMonde, nomDeCase, titreDeMonde } from './monde-libelle'
import { repriseLaPlusRecente, type Ecran, type Reprise } from './menu-ecrans'
import { ensureGameFont, GAME_FONT } from './game-font'
import {
  ACTIONS,
  INREBINDABLE,
  ecrireKeymapPerso,
  fusionne,
  lireKeymapPerso,
  poseBinding,
  reinitialise,
  type ActionJeu,
  type KeymapPerso,
} from '../world/keymap-perso'
import { libelleTouches, toucheDepuisEvenement } from '../world/touches'
import { ecrireMute, ecrireVolume, lireReglagesSon } from '../../audio/engine'

export interface MenuHandle {
  destroy(): void
}

export interface MenuCallbacks {
  /** Rouvrir la vallée sauvée dans cette case (elle porte sa propre seed). */
  onContinue(slot: number): void
  /** Semer une vallée neuve dans une case VIDE — `nom` peut être vide (nommer est facultatif). */
  onCreate(slot: number, seed: number, nom: string): void
  /** Effacer une case. L'écran redessine la ligne quand la promesse tient. */
  onDelete(slot: number): Promise<void>
  onServer(server: ServerEntry): void
}

const DESIGN_W = 1920
const DESIGN_H = 1080

/** Ce qu'une ligne de vallée montre à cet instant : son repos, un champ de seed, ou sa confirmation. */
type ModeLigne = 'repos' | 'semer' | 'effacer'

/** Tout ce que le corps a besoin de savoir pour se peindre. Un seul objet : un rendu, une vérité. */
interface Vue {
  ecran: Ecran
  slots: readonly (SlotMeta | null)[]
  multi: DerniereMulti | null
  perso: KeymapPerso
  capture: ActionJeu | null
  ouverte: number
  mode: ModeLigne
}

/**
 * Monte le voile du menu sur `document.body` et rend de quoi le retirer.
 * `slots` est l'état du disque, déjà lu par `MenuScene` — l'écran ne touche pas IndexedDB :
 * il montre ce qu'on lui donne et prévient par callback.
 */
export function mountMenu(slots: (SlotMeta | null)[], multi: DerniereMulti | null, cb: MenuCallbacks): MenuHandle {
  ensureGameFont()
  const root = document.createElement('div')
  root.className = 'bm-overlay'
  root.innerHTML = style() + planche()
  document.body.appendChild(root)

  const boardEl = root.querySelector<HTMLElement>('.bm')!
  const corpsEl = root.querySelector<HTMLElement>('.bm-corps')!

  const vue: Vue = {
    ecran: 'accueil',
    slots: slots.slice(0, SLOT_COUNT),
    multi,
    perso: lireKeymapPerso(),
    capture: null,
    ouverte: -1,
    mode: 'repos',
  }
  const etat = vue.slots as (SlotMeta | null)[]

  const peindre = (): void => {
    corpsEl.innerHTML = corps(vue)
    brancher()
    if (vue.ecran === 'vallees' && vue.mode === 'semer') corpsEl.querySelector<HTMLInputElement>('.mw-nom')?.focus()
  }

  const va = (vers: Ecran): void => {
    vue.ecran = vers
    vue.ouverte = -1
    vue.mode = 'repos'
    vue.capture = null
    peindre()
  }

  const rouvrirToutes = (): void => {
    vue.ouverte = -1
    vue.mode = 'repos'
    peindre()
  }

  // ── LA CAPTURE D'UNE TOUCHE ──
  // Elle écoute sur `document` EN PHASE DE CAPTURE : le bouton qu'on vient de cliquer a le
  // focus, et sans ça ESPACE ou ENTRÉE le re-déclencheraient au lieu d'être capturés comme
  // touches. C'est aussi pourquoi on `preventDefault` — TAB, sinon, part promener le focus.
  const surTouche = (e: KeyboardEvent): void => {
    if (!vue.capture) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      vue.capture = null
      peindre()
      return
    }
    const nom = toucheDepuisEvenement(e)
    if (!nom) return // touche qu'on ne sait pas nommer : on reste en attente, rien ne bouge
    vue.perso = poseBinding(vue.perso, vue.capture, nom)
    ecrireKeymapPerso(vue.perso)
    vue.capture = null
    peindre()
  }
  document.addEventListener('keydown', surTouche, true)

  // ÉCHAP referme l'écran courant vers l'accueil — sauf en capture (là, il l'annule) et sauf
  // si un geste est armé dans la liste (on désarme d'abord, on sort ensuite).
  const surEchap = (e: KeyboardEvent): void => {
    if (vue.capture || e.key !== 'Escape' || vue.ecran === 'accueil') return
    if (vue.mode !== 'repos') return rouvrirToutes()
    va('accueil')
  }
  document.addEventListener('keydown', surEchap)

  const brancher = (): void => {
    corpsEl.querySelectorAll<HTMLElement>('[data-go]').forEach((el) => {
      el.addEventListener('click', () => va(el.dataset.go as Ecran))
    })

    corpsEl.querySelector<HTMLElement>('[data-reprendre]')?.addEventListener('click', () => {
      const r = repriseLaPlusRecente(vue.slots, vue.multi)
      if (!r) return
      if (r.genre === 'solo') cb.onContinue(r.slot)
      // Le signet ne retient que l'adresse et le nom : `seed`/`maxClients` ne servent qu'à
      // l'affichage de la LISTE des serveurs, et on ne les affiche pas ici.
      else cb.onServer({ name: r.nom, url: r.url, seed: 0, maxClients: 0 })
    })

    corpsEl.querySelectorAll<HTMLElement>('[data-act="server"]').forEach((el) => {
      const server = SERVERS[Number(el.dataset.idx)]
      if (server) el.addEventListener('click', () => cb.onServer(server))
    })

    brancherVallees()
    brancherOptions()
  }

  const brancherVallees = (): void => {
    corpsEl.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => {
      const slot = Number(el.dataset.row)
      const geste = (): void => {
        if (etat[slot]) cb.onContinue(slot)
        else {
          vue.ouverte = slot
          vue.mode = 'semer'
          peindre()
        }
      }
      el.addEventListener('click', geste)
      // AU CLAVIER AUSSI : la ligne est un bouton (`role="button"`), elle doit répondre à
      // ENTRÉE et ESPACE — sinon l'écran ne se traverse qu'à la souris.
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          geste()
        }
      })
    })

    corpsEl.querySelectorAll<HTMLElement>('[data-x]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation() // le ✕ vit DANS la ligne : sans ça, il la reprendrait aussi
        vue.ouverte = Number(el.dataset.x)
        vue.mode = 'effacer'
        peindre()
      })
    })

    corpsEl.querySelectorAll<HTMLElement>('[data-annuler]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        rouvrirToutes()
      })
    })

    const semer = corpsEl.querySelector<HTMLElement>('[data-semer]')
    const champ = corpsEl.querySelector<HTMLInputElement>('.mw-seed')
    if (semer && champ) {
      const fonder = (): void => {
        const seed = Number(champ.value)
        // Une seed illisible ne fonde rien EN SILENCE : le champ se signale et garde la main.
        if (!seedValide(seed)) {
          champ.classList.add('mw-seed-faux')
          champ.focus()
          return
        }
        // Le nom, lui, ne peut pas être « faux » : vide est une réponse valable, et ce qui
        // reste est nettoyé (contrôle, bordures) exactement comme le Worker le fera.
        const nomEl = corpsEl.querySelector<HTMLInputElement>('.mw-nom')
        cb.onCreate(Number(semer.dataset.semer), seed, nettoieNom(nomEl?.value ?? ''))
      }
      semer.addEventListener('click', (e) => {
        e.stopPropagation()
        fonder()
      })
      champ.addEventListener('input', () => champ.classList.remove('mw-seed-faux'))
      // Les deux champs répondent pareil : ENTRÉE fonde, ÉCHAP referme. Et tous deux retiennent
      // leurs touches, sinon l'ÉCHAP global rendrait la main à l'accueil au lieu d'annuler.
      for (const el of [champ, corpsEl.querySelector<HTMLInputElement>('.mw-nom')]) {
        if (!el) continue
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (el.classList.contains('mw-seed')) el.select()
        })
        el.addEventListener('keydown', (ev) => {
          ev.stopPropagation()
          if (ev.key === 'Enter') fonder()
          if (ev.key === 'Escape') rouvrirToutes()
        })
      }
      corpsEl.querySelector<HTMLElement>('[data-de]')?.addEventListener('click', (e) => {
        // LE DÉ — une vallée au hasard, parce que « choisis un entier » n'est pas une invitation
        // à jouer. `Math.random` est ici SANS DANGER : on choisit une seed, on ne simule rien
        // (l'invariant de déterminisme porte sur /sim, pas sur le doigt qui sème).
        e.stopPropagation()
        champ.classList.remove('mw-seed-faux')
        champ.value = String(Math.floor(Math.random() * (SEED_MAX + 1)))
        champ.focus()
        champ.select()
      })
    }

    corpsEl.querySelectorAll<HTMLElement>('[data-effacer]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        const slot = Number(el.dataset.effacer)
        el.setAttribute('disabled', '') // pas de second clic pendant que le disque travaille
        void cb
          .onDelete(slot)
          .then(() => {
            etat[slot] = null
          })
          .catch(() => {
            /* le disque a refusé : la case reste telle quelle, on rouvre la liste */
          })
          .finally(rouvrirToutes)
      })
    })
  }

  const brancherOptions = (): void => {
    const vol = corpsEl.querySelector<HTMLInputElement>('.op-vol')
    const volVal = corpsEl.querySelector<HTMLElement>('.op-vol-val')
    if (vol && volVal) {
      vol.addEventListener('input', () => {
        const pct = Number(vol.value)
        volVal.textContent = `${pct} %`
        ecrireVolume(pct / 100)
      })
    }
    corpsEl.querySelector<HTMLElement>('[data-mute]')?.addEventListener('click', (e) => {
      const el = e.currentTarget as HTMLElement
      ecrireMute(el.dataset.mute !== '1')
      peindre()
    })

    corpsEl.querySelectorAll<HTMLElement>('[data-bind]').forEach((el) => {
      el.addEventListener('click', () => {
        vue.capture = el.dataset.bind as ActionJeu
        peindre()
      })
    })
    corpsEl.querySelectorAll<HTMLElement>('[data-rebind-reset]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        vue.perso = reinitialise(vue.perso, el.dataset.rebindReset as ActionJeu)
        ecrireKeymapPerso(vue.perso)
        peindre()
      })
    })
    corpsEl.querySelector<HTMLElement>('[data-reset-tout]')?.addEventListener('click', () => {
      vue.perso = reinitialise(vue.perso)
      ecrireKeymapPerso(vue.perso)
      peindre()
    })
  }

  peindre()

  // ── MISE À L'ÉCHELLE « FIT » — la planche 1920×1080 tient dans la fenêtre ──
  const fit = (): void => {
    const k = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H)
    boardEl.style.transform = `translate(-50%, -50%) scale(${k})`
  }
  fit()
  window.addEventListener('resize', fit)

  // ── ANTI-FOUT : on révèle une fois la police chargée, pour que le PREMIER
  //    rendu du titre soit déjà en JetBrains Mono (sinon un flash en fallback). ──
  const reveal = (): void => root.classList.add('bm-ready')
  const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts
  if (fonts?.load) {
    Promise.all([fonts.load('700 88px "JetBrains Mono"'), fonts.load('400 16px "JetBrains Mono"')])
      .then(reveal)
      .catch(reveal)
    window.setTimeout(reveal, 400) // garde-fou : jamais bloqué sur un chargement lent
  } else {
    reveal()
  }

  return {
    destroy(): void {
      window.removeEventListener('resize', fit)
      document.removeEventListener('keydown', surTouche, true)
      document.removeEventListener('keydown', surEchap)
      root.remove()
    },
  }
}

// ══ LE CORPS, ÉCRAN PAR ÉCRAN ═══════════════════════════════════════════════════════════════

function corps(v: Vue): string {
  if (v.ecran === 'jouer') return ecranJouer()
  if (v.ecran === 'vallees') return ecranVallees(v)
  if (v.ecran === 'serveurs') return ecranServeurs()
  if (v.ecran === 'options') return ecranOptions(v)
  return ecranAccueil(v)
}

/** Le bouton de sortie d'un écran secondaire. ÉCHAP fait la même chose (voir `surEchap`). */
function retour(): string {
  return `<div class="bm-retour"><button class="mw-btn mw-ghost" data-go="accueil">← retour</button></div>`
}

/** Un titre d'écran secondaire — on sait toujours où l'on est. */
function chapeau(titre: string): string {
  return `<div class="mw-sect">${titre}</div>`
}

/**
 * L'ACCUEIL — trois questions, dans l'ordre où on se les pose.
 *
 * « REPRENDRE » n'apparaît QUE s'il y a quelque chose à reprendre : un bouton grisé au premier
 * lancement promettrait à un nouveau venu quelque chose qu'il ne peut pas avoir.
 */
function ecranAccueil(v: Vue): string {
  const r = repriseLaPlusRecente(v.slots, v.multi)
  // JOUER et OPTIONS n'ont PAS de sous-titre (demande d'Alexis) : les deux mots se suffisent,
  // et les gloser mettait trois lignes de commentaire là où il n'y a aucune décision à prendre.
  // REPRENDRE garde le sien — ce n'est pas une glose, c'est LA partie qu'on rouvrira.
  return `<div class="bm-menu">
    ${r ? entreeReprendre(r, Date.now()) : ''}
    ${entree('JOUER', '', 'data-go="jouer"')}
    ${entree('OPTIONS', '', 'data-go="options"')}
  </div>`
}

/** Le résumé de la partie qu'on reprendrait. Les deux modes n'en disent pas autant — voir `menu-ecrans`. */
function entreeReprendre(r: Reprise, maintenant: number): string {
  const quand = depuisQuand(r.at, maintenant)
  const sous =
    r.genre === 'solo'
      ? `${titreDeMonde(r.slot, r.meta)} — ${etatDeMonde(r.meta)}${quand ? ` · ${quand}` : ''}`
      : `${r.nom} — vallée partagée${quand ? ` · rejointe ${quand}` : ''}`
  return entree('REPRENDRE', esc(sous), 'data-reprendre', 'bm-e-fort')
}

/** Une entrée d'accueil. Sans sous-titre, la ligne se resserre d'elle-même : le padding suffit,
 *  et une entrée courte à côté d'une entrée haute donne la hiérarchie sans qu'on l'écrive. */
function entree(titre: string, sous: string, attr: string, cls = ''): string {
  return `<button class="bm-entree ${cls}" ${attr}>
    <span class="bm-e-titre">${titre}</span>
    ${sous ? `<span class="bm-e-sous">${sous}</span>` : ''}
  </button>`
}

/** DEUX TUILES, et pas une liste : solo/multi est le seul vrai embranchement du jeu, et aucun
 *  des deux n'est le défaut de l'autre. */
function ecranJouer(): string {
  return `${chapeau('JOUER')}
  <div class="bm-tuiles">
    <button class="bm-tuile" data-go="vallees">
      <span class="bm-t-icone">🔥</span>
      <span class="bm-t-titre">SEUL</span>
      <span class="bm-t-sous">La Veillée — la vallée pour vous seul, hors ligne</span>
    </button>
    <button class="bm-tuile" data-go="serveurs">
      <span class="bm-t-icone">⛺</span>
      <span class="bm-t-titre">À PLUSIEURS</span>
      <span class="bm-t-sous">Une vallée partagée — soixante jours, et des voisins</span>
    </button>
  </div>
  ${retour()}`
}

function ecranVallees(v: Vue): string {
  const maintenant = Date.now()
  const lignes = v.slots
    .map((meta, i) => ligne(i, meta ?? null, i === v.ouverte ? v.mode : 'repos', maintenant))
    .join('')
  return `${chapeau('VOS VALLÉES')}
  <div class="mw-list">${lignes}</div>
  ${retour()}`
}

function ecranServeurs(): string {
  const rows = SERVERS.map(
    (s, i) => `
    <div class="row-server" data-act="server" data-idx="${i}">
      <span class="rs-nom">${esc(s.name)}</span>
      <div class="rs-detail">
        <div>seed ${s.seed}</div>
        <div class="rs-max">max ${s.maxClients} joueurs</div>
      </div>
    </div>`,
  ).join('')
  return `${chapeau('LES VALLÉES PARTAGÉES')}
  <div class="mw-list">${rows}</div>
  ${retour()}`
}

/**
 * LES OPTIONS — le son, puis les touches.
 *
 * Les touches viennent de `keymap-perso` : la ligne affiche ce qui RÉPOND vraiment, donc parfois
 * les trois alias livrés et parfois la seule touche choisie. Une action à qui l'on a volé sa
 * touche s'affiche « — » en rouge et se répare d'un clic : le travail restant est visible, à sa
 * place, au lieu d'être un refus qu'on ne comprend pas.
 */
function ecranOptions(v: Vue): string {
  const son = lireReglagesSon()
  const pct = Math.round(son.volume * 100)
  const effectif = fusionne(v.perso)

  let groupe = ''
  const lignes = ACTIONS.map((a) => {
    let enTete = ''
    if (a.groupe !== groupe) {
      groupe = a.groupe
      enTete = `<div class="op-groupe">${a.groupe}</div>`
    }
    const fige = INREBINDABLE.includes(a.action)
    const enCapture = v.capture === a.action
    const touches = enCapture ? 'pressez une touche…' : libelleTouches(effectif[a.action])
    const cls = ['op-touche', enCapture ? 'op-capture' : '', effectif[a.action].length === 0 ? 'op-muette' : '']
      .filter(Boolean)
      .join(' ')
    const commande = fige
      ? `<span class="${cls} op-fige" title="la sortie de secours ne se rebinde pas">${touches}</span><span></span>`
      : `<button class="${cls}" data-bind="${a.action}">${touches}</button>` +
        `<button class="op-reset" data-rebind-reset="${a.action}" title="rendre la touche d’origine">↺</button>`
    return `${enTete}<div class="op-ligne"><span class="op-nom">${a.libelle}</span>${commande}</div>`
  }).join('')

  return `${chapeau('OPTIONS')}
  <div class="op-sect"><span>LE SON</span></div>
  <div class="op-son">
    <input type="range" class="op-vol" min="0" max="100" step="1" value="${pct}" aria-label="Volume">
    <span class="op-vol-val">${pct} %</span>
    <button class="mw-btn mw-ghost" data-mute="${son.muted ? '1' : '0'}">${son.muted ? 'son coupé' : 'son actif'}</button>
  </div>
  <div class="op-sect"><span>LES TOUCHES</span><button class="op-reset-tout" data-reset-tout>tout réinitialiser</button></div>
  <div class="op-liste">${lignes}</div>
  ${retour()}`
}

// ══ LA LIGNE D'UNE VALLÉE ═══════════════════════════════════════════════════════════════════

/** UNE LIGNE de l'écran des vallées, dans le mode où elle se trouve. */
function ligne(slot: number, meta: SlotMeta | null, mode: ModeLigne, maintenant: number): string {
  // ÉCHAPPÉ, toujours : le nom d'une vallée est le seul texte libre du jeu, et il arrive ici
  // dans un `innerHTML`. Le nettoyage à la saisie ne remplace pas l'échappement au rendu.
  const nom = `<span class="mw-name">${esc(titreDeMonde(slot, meta))}</span>`

  if (mode === 'semer') {
    // Le champ de nom REMPLACE le titre, il ne s'ajoute pas à côté : c'est la même place, donc
    // on tape ce qu'on lira. Son invite est le nom de repli — la ligne montre ainsi elle-même
    // comment elle s'appellera si on ne la nomme pas, et nommer reste facultatif sans le dire.
    return `<div class="mw-row mw-semer">
      <input class="mw-champ mw-nom" type="text" placeholder="${nomDeCase(slot)}" aria-label="nom de la vallée" maxlength="${NOM_MAX}">
      <input class="mw-champ mw-seed" type="text" inputmode="numeric" value="${VEILLEE_SEED}" aria-label="seed de la vallée" maxlength="9">
      <button class="mw-de" data-de title="une seed au hasard">⚄</button>
      <span class="mw-actes"><button class="mw-btn" data-semer="${slot}">FONDER</button>
      <button class="mw-btn mw-ghost" data-annuler>annuler</button></span>
    </div>`
  }

  if (mode === 'effacer') {
    const etat = meta ? etatDeMonde(meta) : ''
    return `<div class="mw-row mw-effacer">
      <span class="mw-warn">Effacer <b>${esc(titreDeMonde(slot, meta))}</b>${etat ? ` (${esc(etat)})` : ''} — c'est sans retour.</span>
      <button class="mw-btn mw-ghost" data-annuler>revenir en arrière</button>
      <button class="mw-btn mw-danger" data-effacer="${slot}">EFFACER</button>
    </div>`
  }

  if (!meta) {
    return `<div class="mw-row mw-vide mw-clic" data-row="${slot}" role="button" tabindex="0">
      ${nom}
      <span class="mw-state">— case vide —</span>
      <span class="mw-when">fonder une vallée</span>
      <span></span>
    </div>`
  }

  return `<div class="mw-row mw-plein mw-clic" data-row="${slot}" role="button" tabindex="0">
    ${nom}
    <span class="mw-state">${esc(etatDeMonde(meta))}</span>
    <span class="mw-when">${esc(depuisQuand(meta.savedAt, maintenant))}</span>
    <button class="mw-x" data-x="${slot}" title="effacer ce monde" aria-label="effacer ${esc(titreDeMonde(slot, meta))}">✕</button>
  </div>`
}

/** La planche 9A : l'anneau, le titre, et un CORPS qui change d'écran en écran. */
function planche(): string {
  return `<div class="bm">
    <div class="bm-fond"></div>

    <div class="bm-colonne">
      <div class="bm-anneau">
        <div class="bm-anneau-fond"><div class="bm-flamme">🔥</div></div>
        <div class="bm-anneau-tour"><div class="bm-etincelle"></div></div>
      </div>

      <div class="bm-titre">ASHES</div>
      <div class="bm-baseline">Survie · une vallée de 60 jours · l'alignement émerge</div>

      <div class="bm-corps"></div>
    </div>

    <div class="bm-phase">Phase LAN</div>
    <div class="bm-version">v0.1.0 · ALPHA</div>
  </div>`
}

/** La feuille de style du voile : police, images clés, survols, échelle. */
function style(): string {
  return `<style>
  .bm-overlay{position:fixed;inset:0;z-index:50;background:#0f0b08;overflow:hidden;
    opacity:0;transition:opacity .18s ease;}
  .bm-overlay.bm-ready{opacity:1;}
  .bm{position:absolute;left:50%;top:50%;width:${DESIGN_W}px;height:${DESIGN_H}px;overflow:hidden;
    background:#0f0b08;color:#e4ebef;transform-origin:center center;transform:translate(-50%,-50%);
    font-family:${GAME_FONT};}
  .bm *{box-sizing:border-box;}
  .bm button{font-family:inherit;}
  .bm-fond{position:absolute;inset:0;
    background:radial-gradient(90% 60% at 50% 18%,rgba(201,139,58,.07),transparent 55%),
               radial-gradient(120% 100% at 50% 120%,rgba(201,139,58,.05),transparent 55%);}
  .bm-phase{position:absolute;left:0;right:0;bottom:26px;text-align:center;font-size:12px;color:#8b8474;letter-spacing:2px;}
  .bm-version{position:absolute;bottom:24px;right:28px;font-size:11px;color:#3a3a44;letter-spacing:1px;}

  /* LE CHAPEAU NE BOUGE PAS d'un écran à l'autre : anneau, titre et baseline sont posés une
     fois, seul .bm-corps est repeint. C'est ce qui fait qu'on navigue dans un lieu. */
  .bm-colonne{position:absolute;left:50%;top:72px;transform:translateX(-50%);width:880px;text-align:center;}
  .bm-anneau{position:relative;width:132px;height:132px;margin:0 auto 26px;border-radius:50%;
    background:conic-gradient(#c98b3a 100%,#241a10 0);}
  .bm-anneau-fond{position:absolute;inset:8px;border-radius:50%;background:#0f0b08;display:grid;place-items:center;}
  .bm-flamme{font-size:46px;line-height:1;animation:bmFlamePulse 1.3s ease-in-out infinite;
    filter:drop-shadow(0 0 16px rgba(201,139,58,.7));}
  .bm-anneau-tour{position:absolute;inset:0;animation:bmRingSpin 3.4s linear infinite;}
  .bm-etincelle{position:absolute;left:50%;top:-3px;transform:translateX(-50%);width:7px;height:7px;
    border-radius:50%;background:#e8c66a;box-shadow:0 0 10px #e8c66a;}
  .bm-titre{font-size:80px;line-height:1;font-weight:700;color:#e8763a;letter-spacing:8px;
    text-shadow:0 0 46px rgba(201,139,58,.5),0 0 18px rgba(201,139,58,.4);}
  .bm-baseline{font-size:16px;color:#c9a24a;letter-spacing:2px;margin-top:14px;}
  .bm-corps{margin-top:44px;}
  .bm-retour{margin-top:28px;text-align:center;}

  /* L'ACCUEIL : trois entrées, la première marquée d'un bord chaud — c'est celle qu'on
     vient chercher, et elle n'existe que s'il y a une partie derrière. */
  .bm-menu{display:flex;flex-direction:column;gap:14px;}
  .bm-entree{display:block;width:100%;text-align:left;padding:22px 28px;cursor:pointer;
    background:rgba(27,27,34,.55);border:2px solid #2a2a34;
    transition:background .12s ease,border-color .12s ease,box-shadow .12s ease;}
  .bm-entree:hover,.bm-entree:focus-visible{background:rgba(201,139,58,.1);border-color:#c98b3a;
    box-shadow:0 0 24px rgba(201,139,58,.25);outline:none;}
  .bm-e-titre{display:block;font-size:22px;font-weight:700;color:#e8c66a;letter-spacing:3px;}
  .bm-e-sous{display:block;font-size:13px;color:#9a8f78;letter-spacing:1px;margin-top:9px;}
  .bm-entree.bm-e-fort{border-top-color:#6b5a3a;}
  .bm-entree.bm-e-fort .bm-e-sous{color:#c0a074;}
  .bm-entree:hover .bm-e-titre{color:#f2ead0;}

  /* JOUER : deux tuiles de MÊME poids — aucun des deux modes n'est le défaut de l'autre. */
  .bm-tuiles{display:grid;grid-template-columns:1fr 1fr;gap:22px;}
  .bm-tuile{padding:38px 26px;cursor:pointer;background:rgba(27,27,34,.55);border:2px solid #2a2a34;
    border-top:2px solid #6b5a3a;text-align:center;
    transition:background .12s ease,border-color .12s ease,box-shadow .12s ease;}
  .bm-tuile:hover,.bm-tuile:focus-visible{background:rgba(201,139,58,.1);border-color:#c98b3a;
    box-shadow:0 0 24px rgba(201,139,58,.25);outline:none;}
  .bm-t-icone{display:block;font-size:44px;line-height:1;filter:drop-shadow(0 0 14px rgba(201,139,58,.5));}
  .bm-t-titre{display:block;font-size:22px;font-weight:700;color:#e8c66a;letter-spacing:3px;margin-top:20px;}
  .bm-t-sous{display:block;font-size:13px;color:#9a8f78;letter-spacing:1px;margin-top:12px;line-height:1.6;}
  .bm-tuile:hover .bm-t-titre{color:#f2ead0;}

  /* LES VALLÉES PARTAGÉES */
  .bm .row-server{cursor:pointer;background:rgba(27,27,34,.55);border:2px solid #2a2a34;padding:18px 24px;
    display:flex;justify-content:space-between;align-items:center;text-align:left;
    transition:background .12s ease,border-color .12s ease,box-shadow .12s ease;}
  .bm .row-server:hover{background:rgba(201,139,58,.08);border-color:#c98b3a;box-shadow:0 0 24px rgba(201,139,58,.2);}
  .bm .rs-nom{font-size:20px;font-weight:700;color:#f2ead0;letter-spacing:1px;}
  .bm .rs-detail{text-align:right;font-size:12px;color:#9a8f78;letter-spacing:1px;}
  .bm .rs-max{color:#c98b3a;margin-top:4px;}

  /* L'ÉCRAN DES VALLÉES. Une ligne par case, hauteur CONSTANTE quel que soit son mode
     (repos, semer, effacer) : la liste ne doit pas sauter sous le curseur quand on arme
     un effacement — on cliquerait la ligne du dessous. */
  .bm .mw-sect{font-size:13px;color:#c98b3a;letter-spacing:4px;text-align:left;}
  .bm .mw-list{margin-top:16px;display:flex;flex-direction:column;gap:10px;}
  /* Le overflow:hidden n'est pas décoratif : la hauteur est FIXE, donc tout ce qui déborde
     déborde SUR les lignes voisines — un conseil trop long a déjà écrasé le nom de la case. */
  .bm .mw-row{height:66px;overflow:hidden;background:rgba(27,27,34,.55);border:2px solid #2a2a34;
    padding:0 22px;display:grid;align-items:center;gap:16px;text-align:left;
    grid-template-columns:320px 1fr auto 40px;
    transition:background .12s ease,border-color .12s ease,box-shadow .12s ease;}
  .bm .mw-row.mw-clic{cursor:pointer;}
  .bm .mw-row.mw-clic:hover,.bm .mw-row.mw-clic:focus-visible{background:rgba(201,139,58,.1);border-color:#c98b3a;
    box-shadow:0 0 24px rgba(201,139,58,.25);outline:none;}
  .bm .mw-row.mw-clic:hover .mw-name,.bm .mw-row.mw-clic:focus-visible .mw-name{color:#f2ead0;}
  /* Le bord haut chaud dit « ici, il y a un monde » — la case vide ne le porte pas. */
  .bm .mw-row.mw-plein{border-top-color:#6b5a3a;}
  /* Le titre porte un NOM LIBRE (24 signes au plus) : la colonne est taillée pour, et ce qui
     dépasserait malgré tout se coupe proprement plutôt que de pousser l'état du monde. */
  .bm .mw-name{font-size:18px;font-weight:700;color:#e8c66a;letter-spacing:2px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
  .bm .mw-row.mw-vide .mw-name{color:#6b6558;}
  .bm .mw-state{font-size:14px;color:#c0a074;letter-spacing:1px;}
  .bm .mw-row.mw-vide .mw-state{color:#8b8474;}
  .bm .mw-when{font-size:12px;color:#8b8474;letter-spacing:1px;white-space:nowrap;}
  .bm .mw-x{grid-column:4;width:34px;height:34px;justify-self:end;background:transparent;border:1px solid #3a3a44;
    color:#6b6558;font-size:14px;line-height:1;cursor:pointer;
    transition:color .12s ease,border-color .12s ease,background .12s ease;}
  .bm .mw-x:hover{color:#e05a4a;border-color:#e05a4a;background:rgba(224,90,74,.12);}

  /* LE CHAMP DE NOM OCCUPE LA COLONNE DU TITRE — la même largeur, la même graisse, la même
     place : on écrit LÀ OÙ ON LIRA. Et son invite est « VALLÉE N », donc le repli se montre
     lui-même — inutile d'écrire quelque part que nommer est facultatif. */
  .bm .mw-row.mw-semer{grid-template-columns:320px 120px 40px auto;border-color:#c98b3a;
    background:rgba(201,139,58,.08);}
  .bm .mw-champ{width:100%;background:#14100c;border:2px solid #3a3225;
    font-family:inherit;padding:9px 12px;outline:none;}
  .bm .mw-champ:focus{border-color:#c98b3a;}
  .bm .mw-nom{color:#f2ead0;font-size:18px;font-weight:700;letter-spacing:2px;}
  .bm .mw-nom::placeholder{color:#6b6558;font-weight:700;letter-spacing:2px;}
  .bm .mw-seed{color:#e8c66a;font-size:15px;letter-spacing:2px;}
  .bm .mw-seed-faux{border-color:#e05a4a;color:#e05a4a;}
  .bm .mw-de{width:40px;height:40px;background:transparent;border:2px solid #3a3225;color:#c98b3a;
    font-size:17px;line-height:1;cursor:pointer;}
  .bm .mw-de:hover{border-color:#c98b3a;background:rgba(201,139,58,.14);}
  .bm .mw-actes{display:flex;gap:12px;}

  /* EFFACER — le seul rouge de l'écran, comme au menu pause : on ne perd pas une vallée
     d'un bouton qui ressemble aux autres. */
  .bm .mw-row.mw-effacer{grid-template-columns:1fr auto auto;border-color:#e05a4a;
    background:rgba(224,90,74,.1);}
  .bm .mw-warn{font-size:14px;color:#e05a4a;letter-spacing:1px;}
  .bm .mw-warn b{color:#f2ead0;font-weight:700;}
  .bm .mw-btn{background:rgba(201,139,58,.16);border:2px solid #c98b3a;color:#e8c66a;font-size:14px;
    font-weight:700;letter-spacing:2px;padding:10px 22px;cursor:pointer;
    transition:background .12s ease,color .12s ease;}
  .bm .mw-btn:hover{background:rgba(232,198,106,.24);color:#f2ead0;}
  .bm .mw-btn.mw-ghost{background:transparent;border-color:#6b5a3a;color:#9a8f78;letter-spacing:1px;font-weight:400;}
  .bm .mw-btn.mw-ghost:hover{color:#e8e0c8;border-color:#8a7a52;background:rgba(40,34,26,.4);}
  .bm .mw-btn.mw-danger{background:rgba(224,90,74,.16);border-color:#e05a4a;color:#e05a4a;}
  .bm .mw-btn.mw-danger:hover{background:rgba(224,90,74,.3);color:#f2ead0;}
  .bm .mw-btn[disabled]{opacity:.5;cursor:default;}

  /* LES OPTIONS. La liste des touches tient en DEUX COLONNES, et c'est le point : en une seule
     elle dépassait le pli, et le défilement ne se voyait pas — on lisait un écran tronqué sans
     savoir qu'il continuait. Les groupes ne se coupent pas entre colonnes (break-inside), et la
     hauteur maximale reste comme filet si la table grandit encore. */
  .op-sect{font-size:12px;color:#c98b3a;letter-spacing:4px;text-align:left;margin:26px 0 12px;
    display:flex;align-items:center;justify-content:space-between;}
  .op-son{display:flex;align-items:center;gap:16px;}
  .op-vol{-webkit-appearance:none;appearance:none;width:320px;height:4px;background:#3a3225;border-radius:2px;outline:none;}
  .op-vol::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#c98b3a;cursor:pointer;border:2px solid #14100c;}
  .op-vol::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#c98b3a;cursor:pointer;border:2px solid #14100c;}
  .op-vol-val{font-size:13px;color:#e8c66a;min-width:52px;text-align:left;}
  .op-reset-tout{background:transparent;border:0;color:#8b8474;font-size:11px;letter-spacing:1px;
    cursor:pointer;text-decoration:underline;}
  .op-reset-tout:hover{color:#e8e0c8;}
  .op-liste{column-count:2;column-gap:48px;max-height:420px;overflow-y:auto;text-align:left;}
  .op-groupe{font-size:11px;color:#6b6558;letter-spacing:3px;margin:12px 0 8px;break-inside:avoid;}
  .op-groupe:first-child{margin-top:0;}
  .op-ligne{display:grid;grid-template-columns:1fr 118px 30px;align-items:center;gap:10px;padding:4px 0;
    break-inside:avoid;}
  .op-nom{font-size:13px;color:#e8e0c8;letter-spacing:1px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
  .op-touche{display:block;width:100%;background:#14100c;border:2px solid #3a3225;color:#e8c66a;
    font-size:12px;letter-spacing:1px;padding:7px 6px;text-align:center;cursor:pointer;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    transition:border-color .12s ease,color .12s ease,background .12s ease;}
  button.op-touche:hover{border-color:#c98b3a;color:#f2ead0;background:rgba(201,139,58,.12);}
  /* EN CAPTURE : la case s'allume et le DIT. Un état d'attente muet ferait croire à un clic
     perdu, et le joueur cliquerait ailleurs — donc annulerait sans le vouloir. */
  .op-touche.op-capture{border-color:#c98b3a;color:#f2ead0;background:rgba(201,139,58,.2);}
  /* SANS TOUCHE : on vient de la lui voler. Rouge, parce que c'est du travail qui reste. */
  .op-touche.op-muette{border-color:#e05a4a;color:#e05a4a;}
  .op-touche.op-fige{cursor:default;color:#8b8474;border-color:#2a2a34;background:transparent;}
  .op-reset{width:30px;height:30px;background:transparent;border:1px solid #3a3a44;color:#6b6558;
    font-size:14px;line-height:1;cursor:pointer;transition:color .12s ease,border-color .12s ease;}
  .op-reset:hover{color:#e8c66a;border-color:#c98b3a;}

  @keyframes bmFlamePulse{0%,100%{transform:translateY(0) scale(1);opacity:.9}50%{transform:translateY(-4px) scale(1.08);opacity:1}}
  @keyframes bmRingSpin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
  </style>`
}

/** Un nom de vallée vient du joueur, un nom de serveur d'une config de confiance — mais on
 *  n'injecte jamais de HTML brut dans `innerHTML` sans échapper. La règle, pas l'exception. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
