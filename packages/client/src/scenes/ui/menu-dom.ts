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
 * ── L'ÉCRAN DES MONDES (2026-07-28) ────────────────────────────────────────────
 * La carte « JOUER SEUL » a laissé place à L'ÉTAT DU DISQUE : cinq cases, vides ou
 * occupées. Ce n'était pas un embellissement — la porte unique lançait `mode:'solo'`
 * sans rien dire, donc REPRENAIT en silence la vallée du jour 14 ; et le seul chemin
 * pour repartir à neuf passait par le bouton rouge du menu pause, c'est-à-dire par
 * l'intérieur de la partie qu'on voulait justement quitter.
 *
 * Les trois gestes tiennent DANS la ligne : fonder (la ligne devient un champ de
 * seed), reprendre (un clic), effacer (la ligne devient sa propre confirmation, en
 * rouge — le seul rouge de l'écran, comme au menu pause). Aucune fenêtre modale : le
 * joueur ne perd jamais de vue la liste où il choisit.
 */
import { SERVERS, type ServerEntry } from '../../servers'
import type { SlotMeta } from '../../worker/persistence-store'
import { NOM_MAX, SEED_MAX, SLOT_COUNT, VEILLEE_SEED, nettoieNom, seedValide } from '../../worker/mondes'
import { depuisQuand, etatDeMonde, nomDeCase, titreDeMonde } from './monde-libelle'
import { ensureGameFont, GAME_FONT } from './game-font'

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

/** Ce qu'une ligne montre à cet instant : son repos, un champ de seed, ou sa confirmation. */
type ModeLigne = 'repos' | 'semer' | 'effacer'

/**
 * Monte le voile du menu sur `document.body` et rend de quoi le retirer.
 * `slots` est l'état du disque, déjà lu par `MenuScene` — l'écran ne touche pas IndexedDB :
 * il montre ce qu'on lui donne et prévient par callback.
 */
export function mountMenu(slots: (SlotMeta | null)[], cb: MenuCallbacks): MenuHandle {
  ensureGameFont()
  const root = document.createElement('div')
  root.className = 'bm-overlay'
  root.innerHTML = style() + board()
  document.body.appendChild(root)

  const boardEl = root.querySelector<HTMLElement>('.bm')!
  const listeEl = root.querySelector<HTMLElement>('.mw-list')!

  // L'ÉTAT DE L'ÉCRAN — une copie locale du disque (que `onDelete` met à jour) et le mode de
  // CHAQUE ligne. Une seule ligne quitte le repos à la fois : ouvrir un champ de seed pendant
  // qu'une confirmation d'effacement est armée ailleurs laisserait deux gestes en attente.
  const etat = slots.slice(0, SLOT_COUNT)
  let ouverte = -1
  let mode: ModeLigne = 'repos'

  const peindre = (): void => {
    const maintenant = Date.now()
    listeEl.innerHTML = etat
      .map((meta, i) => ligne(i, meta ?? null, i === ouverte ? mode : 'repos', maintenant))
      .join('')
    brancher()
    // Le champ de seed vient d'apparaître : on y met le curseur, et on SÉLECTIONNE la valeur
    // proposée — taper la sienne ne demande alors pas d'effacer d'abord.
    // On donne le curseur au NOM, pas à la seed : nommer est le premier geste, et la seed a
    // déjà une valeur utilisable. (Le champ de seed reste pré-rempli et se sélectionne au clic.)
    if (mode === 'semer') listeEl.querySelector<HTMLInputElement>('.mw-nom')?.focus()
  }

  const rouvrirToutes = (): void => {
    ouverte = -1
    mode = 'repos'
    peindre()
  }

  const brancher = (): void => {
    listeEl.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => {
      const slot = Number(el.dataset.row)
      const geste = (): void => {
        if (etat[slot]) cb.onContinue(slot)
        else {
          ouverte = slot
          mode = 'semer'
          peindre()
        }
      }
      el.addEventListener('click', geste)
      // AU CLAVIER AUSSI : la ligne est un bouton (`role="button"`), elle doit répondre à
      // ENTRÉE et ESPACE — sinon l'écran d'accueil du jeu ne se traverse qu'à la souris.
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          geste()
        }
      })
    })

    listeEl.querySelectorAll<HTMLElement>('[data-x]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation() // le ✕ vit DANS la ligne : sans ça, il la reprendrait aussi
        ouverte = Number(el.dataset.x)
        mode = 'effacer'
        peindre()
      })
    })

    listeEl.querySelectorAll<HTMLElement>('[data-annuler]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        rouvrirToutes()
      })
    })

    const semer = listeEl.querySelector<HTMLElement>('[data-semer]')
    const champ = listeEl.querySelector<HTMLInputElement>('.mw-seed')
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
        const nomEl = listeEl.querySelector<HTMLInputElement>('.mw-nom')
        cb.onCreate(Number(semer.dataset.semer), seed, nettoieNom(nomEl?.value ?? ''))
      }
      semer.addEventListener('click', (e) => {
        e.stopPropagation()
        fonder()
      })
      champ.addEventListener('click', (e) => {
        e.stopPropagation()
        champ.select() // cliquer la seed la SÉLECTIONNE : on la remplace, on ne l'édite pas
      })
      champ.addEventListener('input', () => champ.classList.remove('mw-seed-faux'))
      // Les deux champs répondent pareil : ENTRÉE fonde, ÉCHAP referme. Et tous deux retiennent
      // leurs touches, sinon un « e » tapé dans un nom déclencherait la ceinture du jeu derrière.
      for (const el of [champ, listeEl.querySelector<HTMLInputElement>('.mw-nom')]) {
        if (!el) continue
        el.addEventListener('click', (e) => e.stopPropagation())
        el.addEventListener('keydown', (e) => {
          e.stopPropagation()
          if (e.key === 'Enter') fonder()
          if (e.key === 'Escape') rouvrirToutes()
        })
      }
      // LE DÉ — une vallée au hasard, parce que « choisis un entier » n'est pas une invitation
      // à jouer. `Math.random` est ici SANS DANGER : on choisit une seed, on ne simule rien
      // (l'invariant de déterminisme porte sur /sim, pas sur le doigt qui sème).
      listeEl.querySelector<HTMLElement>('[data-de]')?.addEventListener('click', (e) => {
        e.stopPropagation()
        champ.classList.remove('mw-seed-faux')
        champ.value = String(Math.floor(Math.random() * (SEED_MAX + 1)))
        champ.focus()
        champ.select()
      })
    }

    listeEl.querySelectorAll<HTMLElement>('[data-effacer]').forEach((el) => {
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

  peindre()

  // ── MISE À L'ÉCHELLE « FIT » — la planche 1920×1080 tient dans la fenêtre ──
  const fit = (): void => {
    const k = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H)
    boardEl.style.transform = `translate(-50%, -50%) scale(${k})`
  }
  fit()
  window.addEventListener('resize', fit)

  // ── LES VALLÉES PARTAGÉES : une ligne par serveur ──
  root.querySelectorAll<HTMLElement>('[data-act="server"]').forEach((el) => {
    const server = SERVERS[Number(el.dataset.idx)]
    if (server) el.addEventListener('click', () => cb.onServer(server))
  })

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
      root.remove()
    },
  }
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
  .bm .row-server{cursor:pointer;transition:background .12s ease,border-color .12s ease,box-shadow .12s ease,color .12s ease;}
  .bm .row-server:hover{background:rgba(201,139,58,.08)!important;border-color:#c98b3a!important;box-shadow:0 0 24px rgba(201,139,58,.2);}

  /* L'ÉCRAN DES MONDES. Une ligne par case, hauteur CONSTANTE quel que soit son mode
     (repos, semer, effacer) : la liste ne doit pas sauter sous le curseur quand on arme
     un effacement — on cliquerait la ligne du dessous. */
  .bm .mw-sect{font-size:13px;color:#c98b3a;letter-spacing:4px;margin-top:52px;text-align:left;}
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
    color:#6b6558;font-size:14px;line-height:1;cursor:pointer;font-family:inherit;
    transition:color .12s ease,border-color .12s ease,background .12s ease;}
  .bm .mw-x:hover{color:#e05a4a;border-color:#e05a4a;background:rgba(224,90,74,.12);}

  /* SEMER — la ligne devient son champ de seed, sans changer de hauteur. Les colonnes sont
     FIXES (et le conseil, seul élastique, se coupe plutôt qu'il ne pousse) : la ligne doit
     tenir sur UN rang quelle que soit la largeur du texte. */
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
    font-size:17px;line-height:1;cursor:pointer;font-family:inherit;}
  .bm .mw-de:hover{border-color:#c98b3a;background:rgba(201,139,58,.14);}
  .bm .mw-actes{display:flex;gap:12px;}

  /* EFFACER — le seul rouge de l'écran, comme au menu pause : on ne perd pas une vallée
     d'un bouton qui ressemble aux autres. */
  .bm .mw-row.mw-effacer{grid-template-columns:1fr auto auto;border-color:#e05a4a;
    background:rgba(224,90,74,.1);}
  .bm .mw-warn{font-size:14px;color:#e05a4a;letter-spacing:1px;}
  .bm .mw-warn b{color:#f2ead0;font-weight:700;}
  .bm .mw-btn{background:rgba(201,139,58,.16);border:2px solid #c98b3a;color:#e8c66a;font-size:14px;
    font-weight:700;letter-spacing:2px;padding:10px 22px;cursor:pointer;font-family:inherit;
    transition:background .12s ease,color .12s ease;}
  .bm .mw-btn:hover{background:rgba(232,198,106,.24);color:#f2ead0;}
  .bm .mw-btn.mw-ghost{background:transparent;border-color:#6b5a3a;color:#9a8f78;letter-spacing:1px;font-weight:400;}
  .bm .mw-btn.mw-ghost:hover{color:#e8e0c8;border-color:#8a7a52;background:rgba(40,34,26,.4);}
  .bm .mw-btn.mw-danger{background:rgba(224,90,74,.16);border-color:#e05a4a;color:#e05a4a;}
  .bm .mw-btn.mw-danger:hover{background:rgba(224,90,74,.3);color:#f2ead0;}
  .bm .mw-btn[disabled]{opacity:.5;cursor:default;}

  @keyframes bmFlamePulse{0%,100%{transform:translateY(0) scale(1);opacity:.9}50%{transform:translateY(-4px) scale(1.08);opacity:1}}
  @keyframes bmRingSpin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
  </style>`
}

/** UNE LIGNE de l'écran des mondes, dans le mode où elle se trouve. */
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

/** La planche 9A, au pixel de la maquette. Les cinq vallées, puis les vallées partagées. */
function board(): string {
  const rows = SERVERS.map(
    (s, i) => `
    <div class="row-server" data-act="server" data-idx="${i}" style="margin-top:12px;background:rgba(27,27,34,.55);border:2px solid #2a2a34;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:20px;font-weight:700;color:#f2ead0;letter-spacing:1px;">${esc(s.name)}</span>
      <div style="text-align:right;">
        <div style="font-size:12px;color:#9a8f78;letter-spacing:1px;">seed ${s.seed}</div>
        <div style="font-size:12px;color:#c98b3a;letter-spacing:1px;margin-top:4px;">max ${s.maxClients} joueurs</div>
      </div>
    </div>`,
  ).join('')

  return `<div class="bm">
    <div style="position:absolute;inset:0;background:radial-gradient(90% 60% at 50% 18%,rgba(201,139,58,.07),transparent 55%),radial-gradient(120% 100% at 50% 120%,rgba(201,139,58,.05),transparent 55%);"></div>

    <div style="position:absolute;left:50%;top:72px;transform:translateX(-50%);width:860px;text-align:center;">
      <div style="position:relative;width:132px;height:132px;margin:0 auto 26px;border-radius:50%;background:conic-gradient(#c98b3a 100%,#241a10 0);">
        <div style="position:absolute;inset:8px;border-radius:50%;background:#0f0b08;display:grid;place-items:center;">
          <div style="font-size:46px;line-height:1;animation:bmFlamePulse 1.3s ease-in-out infinite;filter:drop-shadow(0 0 16px rgba(201,139,58,.7));">🔥</div>
        </div>
        <div style="position:absolute;inset:0;animation:bmRingSpin 3.4s linear infinite;"><div style="position:absolute;left:50%;top:-3px;transform:translateX(-50%);width:7px;height:7px;border-radius:50%;background:#e8c66a;box-shadow:0 0 10px #e8c66a;"></div></div>
      </div>

      <div style="font-size:80px;line-height:1;font-weight:700;color:#e8763a;letter-spacing:8px;text-shadow:0 0 46px rgba(201,139,58,.5),0 0 18px rgba(201,139,58,.4);">BRAISES</div>
      <div style="font-size:16px;color:#c9a24a;letter-spacing:2px;margin-top:14px;">Survie · une vallée de 60 jours · l'alignement émerge</div>

      <div class="mw-sect">LA VEILLÉE — VOS VALLÉES</div>
      <div class="mw-list"></div>

      <div style="font-size:13px;color:#8b8474;letter-spacing:2px;margin-top:36px;">— ou rejoindre une vallée partagée —</div>
      ${rows}
    </div>

    <div style="position:absolute;left:0;right:0;bottom:26px;text-align:center;font-size:12px;color:#8b8474;letter-spacing:2px;">Phase LAN</div>
    <div style="position:absolute;bottom:24px;right:28px;font-size:11px;color:#3a3a44;letter-spacing:1px;">v0.1.0 · ALPHA</div>
  </div>`
}

/** Un nom de vallée vient d'une config de confiance, mais on n'injecte jamais de
 *  HTML brut dans `innerHTML` sans échapper — la règle, pas l'exception. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
