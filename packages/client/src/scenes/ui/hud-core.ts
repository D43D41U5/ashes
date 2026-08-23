/**
 * LE HUD DE BASE (maquette Turn 2A), en DOM — « HUD posé sur le monde ».
 *
 * La bande toujours à l'écran : la ligne du jour + le lieu + le Feu du village
 * (haut-gauche), le bandeau de palier (au centre), les MÉDAILLONS de vitale et la
 * ligne poids/blessures/métiers (bas-gauche), la CEINTURE façon Rust (bas-centre).
 * Rendu ISO à la maquette, par-dessus le canvas (voir `hud-dom.ts`) : médaillons-
 * liquide, contour d'encre sur le texte, encre + 2 accents.
 *
 * PUREMENT DE L'AFFICHAGE + DEUX GESTES. Aucune règle de jeu : les valeurs viennent du
 * snapshot (relayées par `UIScene`). Les deux seules actions : cliquer une case de
 * ceinture (→ `set_active_slot`) ; survoler un médaillon (→ le chiffre exact). Les icônes
 * sont les VRAIES (pixel-art généré au boot), extraites en data-URL — pas les émojis de
 * la maquette, qui n'étaient qu'un mannequin.
 *
 * ÉCARTS À LA MAQUETTE, ASSUMÉS (à trancher par Alexis) : (1) le poids reste ABSTRAIT
 * « / 30 », pas en « KG » (décision actée #4) ; (2) 4 médaillons + le poids en ligne
 * secondaire (comme la maquette 2A), là où le HUD Phaser en faisait un 5ᵉ disque ;
 * (3) le Feu du village garde son MOT (tiède/neutre/sombre) au lieu des 5 pips de
 * magnitude — « prévisible dans le sens, flou dans la magnitude » ; (4) les blessures
 * gardent leur LIBELLÉ (jambe/bras/saignement), pas un simple compte.
 */
import {
  CARRY,
  carryTier,
  carryWeight,
  durabilityOf,
  skillLevel,
  SLOTS,
  TEMPERATURE,
  type CarryTier,
  type Entity,
  type Inventory,
  type SkillId,
} from '@ashes/sim'
import type Phaser from 'phaser'
import { itemIconKey } from '../../render/item-art'
import { vitalIconKey, type VitalId } from '../../render/vital-art'
import { INK_OUTLINE, INK_OUTLINE_STRONG, INK_OUTLINE_LIST } from './hud-dom'
import { HEX, VITAL_HEX } from './palette'
import { SKILL_LABELS } from './skill-labels'

const BELT = SLOTS.BELT

/** La couleur du poids par palier (spec portage P11). Les SEUILS, eux, viennent de
 *  `carryTier` (/sim) : le HUD montre la règle, il ne la redéfinit pas. */
const CARRY_COLOR: Record<CarryTier, string> = {
  light: '#7e8a94',
  medium: HEX.ember,
  heavy: HEX.emberDeep,
  overloaded: HEX.alert,
}

/**
 * CE QUE LA CHARGE COÛTE, ÉCRIT (décision d'Alexis, 2026-08-20, question ⑤).
 *
 * Le palier s'affichait seul — « LÉGER », « LOURD » — et la sanction se découvrait en la
 * SUBISSANT : un jour on ne sprinte plus, et on ne sait pas pourquoi. Car dès LOURD le sprint
 * n'est pas ralenti, il est **REFUSÉ** (`sim.ts`, « on ne sprinte plus dès le palier LOURD :
 * refusé, pas ralenti »). La seule phrase du dépôt qui le disait — « lourd (pas de sprint) » —
 * vivait dans `inventory-panel.ts`, du CODE MORT que personne ne monte.
 *
 * Quatre mots rendent la décision jouable : ASHES est un jeu de choix, pas de surprise. On
 * n'écrit la conséquence que là où il y en a une — sous le seuil, le silence est juste.
 */
const CARRY_CONSEQUENCE: Record<CarryTier, string> = {
  light: '',
  medium: '',
  heavy: ' — plus de sprint',
  overloaded: ' — plus de sprint',
}

/** Les 4 vitales en médaillon (le poids, lui, passe en ligne secondaire — maquette 2A). */
const VITALS: { id: Exclude<VitalId, 'carry'>; label: string; min?: number; max: number; warn?: number; unite?: string }[] = [
  { id: 'hp', label: 'PV', max: 100 },
  { id: 'stamina', label: 'ENDURANCE', max: 100 },
  { id: 'hunger', label: 'FAIM', max: 100, warn: 0 },
  // LA TEMPÉRATURE EST EN DEGRÉS (2026-08-22) et son domaine n'est PAS [0, max] : un corps
  // vit entre 25 et 37 °C. D'où `min` — sans lui, la jauge serait pleine aux deux tiers en
  // permanence et ne bougerait plus qu'à peine avant la mort.
  { id: 'temperature', label: 'TEMP', min: TEMPERATURE.CORPS_MORTEL, max: TEMPERATURE.CORPS_SAIN, warn: TEMPERATURE.CORPS_HYPOTHERMIE, unite: '°C' },
]

export interface HudCoreState {
  dayLine: string
  zone: string | undefined
  villageLine: string
  boardLine: string
  hp: number
  stamina: number
  hunger: number
  temperature: number
  wounds: Entity['wounds']
  skills: Partial<Record<SkillId, number>>
  inv: Inventory
  activeSlot: number
  /** Sac ouvert → les vitales redeviennent opaques, la ceinture s'efface (sa rangée est
   *  dans la grille). */
  characterMenuOpen: boolean
  /** Dernière écriture de l'hôte — `null` tant qu'aucune n'a eu lieu. `shownAt` est sur
   *  l'horloge PHASER (le fondu s'y règle), `ok=false` dit l'échec au lieu de le taire. */
  saveState: { at: number; ok: boolean; shownAt: number } | null
  now: number
}

export interface HudCore {
  update(s: HudCoreState): void
  /** Un MÉTIER a monté d'un cran : le plus gros retour du jeu, un palier se franchit.
   *  (Récolte et fabrication vivent dans la pile d'artisanat, bas-droite — `craft-queue.ts`.) */
  pushLevelUp(skill: SkillId, level: number): void
  setVisible(v: boolean): void
}

export function createHudCore(
  board: HTMLElement,
  game: Phaser.Game,
  onSlot: (slot: number) => void,
): HudCore {
  // Les icônes pixel-art, extraites une fois en data-URL (le DOM ne lit pas les textures Phaser).
  const urls = new Map<string, string>()
  const iconUrl = (key: string): string => {
    let u = urls.get(key)
    if (u === undefined) {
      u = game.textures.getBase64(key)
      urls.set(key, u)
    }
    return u
  }

  const root = document.createElement('div')
  root.className = 'hc'
  root.innerHTML = markup()
  board.appendChild(root)

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!
  const dayEl = $('.hc-day')
  const zoneEl = $('.hc-zone')
  const villageEl = $('.hc-village')
  const boardEl = $('.hc-board')
  const saveEl = $('.hc-save')
  const centreEl = $('.hc-centre')
  const woundsEl = $('.hc-wounds')
  const weightEl = $('.hc-weight')
  const skillsEl = $('.hc-skills')

  // ── Les 4 médaillons : disque cerné, remplissage-liquide, icône SILHOUETTE, infobulle ──
  const fills = new Map<string, HTMLElement>()
  const tips = new Map<string, HTMLElement>()
  const vitalsWrap = $('.hc-vitals')
  for (const v of VITALS) {
    const cell = document.createElement('div')
    cell.className = 'hc-med'
    cell.innerHTML =
      `<div class="hc-tip"></div>` +
      `<div class="hc-disc"><div class="hc-fill"></div>` +
      `<img class="hc-vicon" src="${iconUrl(vitalIconKey(v.id))}" alt=""></div>`
    vitalsWrap.appendChild(cell)
    fills.set(v.id, cell.querySelector<HTMLElement>('.hc-fill')!)
    tips.set(v.id, cell.querySelector<HTMLElement>('.hc-tip')!)
  }

  // ── La ceinture : BELT cases cliquables (→ set_active_slot) ──
  const beltWrap = $('.hc-belt')
  const tlWrap = $('.hc-tl')
  const slots: {
    cell: HTMLElement
    num: HTMLElement
    icon: HTMLImageElement
    count: HTMLElement
    wearBg: HTMLElement
    wear: HTMLElement
  }[] = []
  for (let i = 0; i < BELT; i++) {
    const cell = document.createElement('div')
    cell.className = 'hc-slot hud-click'
    cell.innerHTML =
      `<span class="hc-num">${i + 1}</span>` +
      `<img class="hc-iicon" alt="" style="display:none">` +
      `<span class="hc-count"></span>` +
      `<div class="hc-wearbg" style="display:none"><div class="hc-wear"></div></div>`
    cell.addEventListener('click', () => onSlot(i))
    beltWrap.appendChild(cell)
    slots.push({
      cell,
      num: cell.querySelector<HTMLElement>('.hc-num')!,
      icon: cell.querySelector<HTMLImageElement>('.hc-iicon')!,
      count: cell.querySelector<HTMLElement>('.hc-count')!,
      wearBg: cell.querySelector<HTMLElement>('.hc-wearbg')!,
      wear: cell.querySelector<HTMLElement>('.hc-wear')!,
    })
  }

  // ── Le bandeau de niveau (au centre) : fondu après un délai. (Les toasts de récolte ont
  // rejoint la pile d'artisanat, bas-droite — `craft-queue.ts`, 2026-08-22 : le coin haut-droit
  // est réservé.) ──
  const TOAST_MS = 2600
  const FADE_MS = 500
  /** L'indicateur de sauvegarde tient un peu plus qu'un toast (on lève rarement les yeux
   *  pile au bon moment), puis s'efface. Un ÉCHEC, lui, ne s'efface jamais. */
  const SAVE_MS = 3200
  const SAVE_FADE_MS = 700
  interface Toast {
    at: number
    el: HTMLElement
  }
  const toasts: Toast[] = []

  return {
    setVisible(v) {
      root.style.display = v ? '' : 'none'
    },

    // NIVEAU est la boucle la plus gratifiante du jeu — il doit se LIRE plus lourd qu'une
    // simple récolte ambre : un bandeau doré à deux lignes (+ lueur non-réduite). Aucune
    // fusion — chaque palier est un fait unique. Même cycle de vie/fondu que les toasts
    // (l'horloge Phaser via `s.now`), donc le nettoyage le prend sans code en plus.
    // (FABRIQUÉ, lui, vit dans la pile d'artisanat en bas à droite — `craft-queue.ts` — depuis
    // le 2026-08-22 : la tuile de l'ordre passe au vert et sort, au lieu d'un chip ici.)

    /**
     * LE PALIER DE MÉTIER SE JOUE AU CENTRE (décision d'Alexis, 2026-08-20, question ⑪).
     *
     * L'arbitrage était : « la récompense doit-elle rejoindre le geste, ou rester un journal
     * de coin ? » — et la réponse est LES DEUX, selon ce qu'on récompense. La RESSOURCE garde
     * sa retenue : le compte de la ceinture est déjà le meilleur retour du jeu — précis,
     * persistant, dans le champ de vision. Mais le PALIER, que le code désigne lui-même comme
     * l'une des deux boucles les plus gratifiantes, se posait à 645-670 px du joueur en
     * glyphes de 6,7 à 10 px : on montait de niveau dans le coin de l'œil.
     *
     * Il passe donc au centre, au-dessus de l'avatar — là où le regard est déjà. Et il
     * RETROUVE son liseré d'encre : c'était la seule ligne du HUD à l'avoir perdu, parce que
     * sa déclaration de `text-shadow` remplaçait celle héritée de `.hc-toast` au lieu de s'y
     * ajouter — la plus grosse récompense de l'écran était la moins lisible.
     */
    pushLevelUp(skill, level) {
      const el = document.createElement('div')
      el.className = 'hc-toast hc-levelup'
      el.innerHTML = `<span class="hc-lvl-skill">${SKILL_LABELS[skill]}</span><span class="hc-lvl-num">NIVEAU ${level}</span>`
      centreEl.prepend(el)
      toasts.push({ at: performanceNow(), el })
    },

    update(s) {
      lastNow = s.now // l'horloge que `pushLevelUp` réutilise entre deux frames
      dayEl.textContent = s.dayLine
      zoneEl.textContent = s.zone ? s.zone.toUpperCase() : ''
      zoneEl.style.display = s.zone ? '' : 'none'
      villageEl.textContent = s.villageLine
      villageEl.style.display = s.villageLine ? '' : 'none'
      boardEl.textContent = s.boardLine
      boardEl.style.display = s.boardLine ? '' : 'none'

      // LA SAUVEGARDE, DITE puis effacée. Le succès est une réassurance FUGACE (on la montre
      // le temps d'être vue, puis elle s'en va — un HUD n'est pas un journal) ; l'ÉCHEC, lui,
      // RESTE : tant que l'écriture ne passe pas, le joueur doit le savoir. Le fondu se règle
      // sur `s.now`, l'horloge Phaser — comme les toasts, jamais un timer parallèle.
      if (s.saveState === null) {
        saveEl.style.display = 'none'
      } else {
        const age = s.now - s.saveState.shownAt
        const ko = !s.saveState.ok
        saveEl.style.display = ko || age < SAVE_MS + SAVE_FADE_MS ? '' : 'none'
        saveEl.textContent = ko ? 'SAUVEGARDE IMPOSSIBLE' : 'partie sauvegardée'
        saveEl.classList.toggle('hc-save-ko', ko)
        saveEl.style.opacity = ko || age < SAVE_MS ? '1' : String(Math.max(0, 1 - (age - SAVE_MS) / SAVE_FADE_MS))
      }

      // En jeu le HUD s'efface un peu ; sac ouvert il redevient opaque, et la ceinture
      // s'efface (sa rangée est dans la grille du sac — sinon deux ceintures à l'écran).
      root.style.setProperty('--hud-alpha', s.characterMenuOpen ? '1' : '.85')
      beltWrap.style.display = s.characterMenuOpen ? 'none' : ''
      // Le coin haut-gauche (jour, lieu, village) cède la place à la BARRE D'ONGLETS de
      // l'écran personnage, qui occupe le même coin. Invisible de toute façon sur les onglets
      // opaques ; sur l'onglet CARTE, où le panneau s'efface, les deux se chevaucheraient.
      tlWrap.style.display = s.characterMenuOpen ? 'none' : ''

      // Vitales : hauteur du liquide + couleur (rouge sous le seuil d'alarme) + infobulle.
      const vals: Record<string, number> = {
        hp: s.hp,
        stamina: s.stamina,
        hunger: s.hunger,
        temperature: s.temperature,
      }
      for (const v of VITALS) {
        const cur = vals[v.id]!
        const lo = v.min ?? 0
        const frac = Math.min(1, Math.max(0, (cur - lo) / (v.max - lo)))
        const warn = v.warn !== undefined && cur <= v.warn
        const fill = fills.get(v.id)!
        fill.style.height = `${(frac * 100).toFixed(1)}%`
        fill.style.background = warn ? HEX.alert : VITAL_HEX[v.id].fill
        fill.style.borderTopColor = warn ? HEX.alert : VITAL_HEX[v.id].rim
        // Une jauge à unité se lit en VALEUR (« TEMP 34 °C »), pas en fraction : « 34 / 37 »
        // ne veut rien dire d'une température. Les autres gardent leur « x / max ».
        tips.get(v.id)!.textContent = v.unite
          ? `${v.label} ${Math.round(cur)} ${v.unite}`
          : `${v.label} ${Math.ceil(cur)} / ${v.max}`
      }

      // Ligne secondaire : poids (couleur par palier), blessures (libellé, rouge), métiers.
      const carry = carryWeight(s.inv)
      const tier = carryTier(carry / CARRY.CAPACITY)
      weightEl.textContent = `▲ ${carry.toFixed(carry % 1 ? 1 : 0)} / ${CARRY.CAPACITY}${CARRY_CONSEQUENCE[tier]}`
      weightEl.style.color = CARRY_COLOR[tier]
      const wounds = [
        s.wounds.leg ? 'jambe blessée' : null,
        s.wounds.arm ? 'bras blessé' : null,
        s.wounds.bleeding ? 'SAIGNEMENT — fibres en main, clic pour panser' : null,
      ].filter(Boolean)
      woundsEl.textContent = wounds.length ? `■ ${wounds.join(' · ')}` : ''
      woundsEl.style.display = wounds.length ? '' : 'none'
      const skillsText = (Object.keys(SKILL_LABELS) as SkillId[])
        .map((id) => ({ id, level: skillLevel(s.skills[id] ?? 0) }))
        .filter(({ level }) => level > 0)
        .map(({ id, level }) => `⚒ ${SKILL_LABELS[id]} ${level}`)
        .join('  ')
      skillsEl.textContent = skillsText
      skillsEl.style.display = skillsText ? '' : 'none'

      // Ceinture : icône réelle, compte, usure, surlignage de la case tenue.
      for (let i = 0; i < BELT; i++) {
        const slot = s.inv[i] ?? null
        const sv = slots[i]!
        const active = i === s.activeSlot
        sv.cell.classList.toggle('hc-slot-active', active)
        sv.num.style.color = active ? HEX.ember : HEX.dim
        if (!slot) {
          sv.icon.style.display = 'none'
          sv.count.textContent = ''
          sv.wearBg.style.display = 'none'
          continue
        }
        sv.icon.src = iconUrl(itemIconKey(slot.item))
        sv.icon.style.display = ''
        sv.count.textContent = slot.count > 1 ? `×${slot.count}` : ''
        if (slot.wear !== undefined && slot.wear > 0) {
          const left = Math.max(0, 1 - slot.wear / durabilityOf(slot.item))
          sv.wearBg.style.display = ''
          sv.wear.style.width = `${(left * 100).toFixed(0)}%`
        } else {
          sv.wearBg.style.display = 'none'
        }
      }

      // Fondu des toasts échus.
      for (let k = toasts.length - 1; k >= 0; k--) {
        const t = toasts[k]!
        const age = s.now - t.at
        if (age > TOAST_MS + FADE_MS) {
          t.el.remove()
          toasts.splice(k, 1)
        } else if (age > TOAST_MS) {
          t.el.style.opacity = String(Math.max(0, 1 - (age - TOAST_MS) / FADE_MS))
        }
      }
    },
  }

  // L'horloge du bandeau suit le `now` que `update` reçoit ; `pushLevelUp` peut arriver
  // hors update, on y prend donc le dernier `now` connu.
  function performanceNow(): number {
    return lastNow
  }
}

let lastNow = 0

/**
 * LE SOL DU HUD, EN DEUX NOMBRES (décision d'Alexis, 2026-08-20, question ③).
 *
 * Exportés parce qu'ils sont GARDÉS : `hud-plaque.test` recalcule le contraste composite du
 * texte du HUD sur cette plaque, posée sur les pires fonds mesurés au banc. Écrits en dur dans
 * la chaîne CSS, ils auraient pu se diluer au premier réglage « pour faire moins lourd », et la
 * garde serait passée au vert sans plus rien garder.
 */
export const PLAQUE_ENCRE = '10,8,6'
/** 0,80 : choisi PAR LE CALCUL, pas à l'œil — voir le test, qui rejoue la table des seuils. */
export const PLAQUE_ALPHA = 0.8

function markup(): string {
  return `
  <style>
    .hc{--hud-alpha:.85;}

    /* ═══ LE SOL DU HUD (décision d'Alexis, 2026-08-20, question ③) ═══
       Six classes de texte, ZÉRO déclaration de background : elles étaient posées à nu sur un
       monde qui change de couleur et d'heure sous elles. Mesuré au banc : le monde passe de
       L=0,308 à midi à 0,032 à minuit (×0,104) pendant que les médaillons opaques ne bougent
       pas (×0,821). Résultat, contre le sol de midi : encre atténuée 1,43:1, bandeau du jour
       2,24:1 (échec AA sur le texte le PLUS important du HUD), alarme de surcharge 1,64:1 —
       le texte le moins lisible du cadre était celui qui crie.
       Et la preuve n'est pas un calcul : DEUX lecteurs experts sur huit, outils de pixels en
       main, ont transcrit « 0 / 40 » là où ce fichier interpole CARRY.CAPACITY = 60.

       LA PLAQUE, PAS LA TEINTE — c'est l'arbitrage. Les teintes du HUD sont déjà calculées et
       passent sur les trois fonds officiels de la palette ; c'est le QUATRIÈME fond, le monde
       éclairé, que la charte n'a jamais modélisé. On lui en donne un.

       UN VOILE QUI S'ÉTEINT, pas une dalle : ancré au coin, il se fond avant d'atteindre le
       monde. Une plaque à bord franc ferait deux rectangles noirs dans les angles d'un jeu qui
       n'en a aucun. Transparent au clic (pointer-events:none) — un sol n'attrape rien ; les
       médaillons, eux, rallument le pointeur sur eux-mêmes via .hc-med. */
    /* haut-gauche : jour, lieu, village, tableau */
    .hc-tl{position:absolute;top:24px;left:26px;}
    .hc-tl::before{content:'';position:absolute;pointer-events:none;z-index:-1;
      inset:-18px -46px -22px -30px;
      background:radial-gradient(ellipse at 18% 22%,rgba(${PLAQUE_ENCRE},${PLAQUE_ALPHA}),rgba(${PLAQUE_ENCRE},${(PLAQUE_ALPHA * 0.65).toFixed(2)}) 52%,rgba(${PLAQUE_ENCRE},0) 80%);}
    .hc-day{font-size:15px;font-weight:700;color:#ffffff;letter-spacing:1px;${INK_OUTLINE_STRONG}}
    .hc-zone{font-size:12px;color:#9a8f78;letter-spacing:2px;margin-top:3px;${INK_OUTLINE}}
    .hc-village{font-size:12px;color:#c8b88a;letter-spacing:1px;margin-top:6px;${INK_OUTLINE}}
    .hc-board{font-size:12px;color:#9a8f78;letter-spacing:1px;margin-top:3px;${INK_OUTLINE}}
    /* L'INDICATEUR DE SAUVEGARDE : discret par nature (une réassurance, pas une récompense) —
       d'où la teinte éteinte et la petite taille. En ÉCHEC il passe au rouge d'alerte : là,
       il faut qu'on le voie. */
    /* Teinte dim (#9a8f78) et non faint (#8b8474) : au premier essai, l'indicateur était
       ILLISIBLE sur un sol clair — discret ne veut pas dire invisible, et une réassurance
       qu'on ne peut pas lire ne rassure personne. C'est la teinte des lignes lieu/tableau,
       déjà lisibles à la capture. (Le sort de faint, qui échoue au contraste WCAG partout
       ailleurs, est une question de palette réservée à Alexis.) */
    .hc-save{font-size:11px;color:#9a8f78;letter-spacing:2px;margin-top:8px;${INK_OUTLINE}transition:opacity .4s ease;}
    .hc-save.hc-save-ko{color:#e05a4a;}
    /* LE CENTRE — réservé à ce qui MÉRITE le regard. Posé au-dessus de l'avatar (qui vit au
       milieu du cadre), jamais dessus : on ne cache pas le personnage au moment où il progresse.
       Transparent au clic, comme tout le HUD. */
    .hc-centre{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);display:flex;
      flex-direction:column;align-items:center;gap:6px;pointer-events:none;}
    .hc-toast{font-size:14px;color:#e8e0c8;letter-spacing:1px;${INK_OUTLINE_STRONG}transition:opacity .3s ease;}
    /* NIVEAU — le plus gros des trois : deux lignes, or vif, et une lueur qui s'éteint (hors réduction). */
    .hc-toast.hc-levelup{display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 22px;
      background:linear-gradient(180deg,rgba(232,198,106,.05),rgba(232,198,106,.18));
      border-top:2px solid #e8c66a;border-bottom:2px solid #e8c66a;}
    /* Le liseré d'encre REVIENT (il était perdu : cette règle remplaçait celle de .hc-toast au
       lieu de s'y ajouter), et la lueur ambre s'y ajoute au lieu de s'y substituer. */
    .hc-levelup .hc-lvl-skill{font-size:19px;font-weight:700;letter-spacing:3px;color:#f4ecd2;
      text-shadow:0 0 12px rgba(232,198,106,.5),${INK_OUTLINE_LIST};}
    .hc-levelup .hc-lvl-num{font-size:12px;letter-spacing:4px;color:#e8c66a;${INK_OUTLINE}}
    @media (prefers-reduced-motion: no-preference){
      .hc-toast.hc-levelup{animation:hc-lvl-pulse 1s ease-out;}
      @keyframes hc-lvl-pulse{from{box-shadow:0 0 22px rgba(232,198,106,.55);}to{box-shadow:0 0 0 rgba(232,198,106,0);}}
    }
    /* bas-gauche : médaillons + ligne secondaire */
    /* z-index 10 : les vitales restent visibles PAR-DESSUS l'écran personnage (3A),
       comme la maquette (« la fenêtre ne les recouvre pas »). */
    .hc-bl{position:absolute;left:26px;bottom:24px;opacity:var(--hud-alpha);z-index:10;}
    .hc-vitals{display:flex;gap:12px;align-items:flex-end;}
    /* Le médaillon capte le survol (→ l'infobulle) ; ailleurs le HUD laisse le clic
       filer au monde. Une petite zone morte bas-gauche, comme tout HUD. */
    .hc-med{position:relative;pointer-events:auto;}
    .hc-disc{position:relative;width:70px;height:70px;border-radius:50%;background:#1b1b22;border:3px solid #14141a;overflow:hidden;box-shadow:0 3px 0 rgba(0,0,0,.5);}
    .hc-fill{position:absolute;left:0;bottom:0;width:100%;height:0;background:#b0473c;border-top:2px solid #cf6a5c;transition:height .18s ease;}
    .hc-vicon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:30px;height:30px;image-rendering:pixelated;filter:brightness(0);}
    .hc-tip{position:absolute;bottom:78px;left:50%;transform:translateX(-50%);background:#14100c;border:2px solid #14141a;padding:4px 8px;font-size:11px;color:#e8e0c8;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .1s ease;}
    .hc-med:hover .hc-tip{opacity:1;}
    .hc-2nd{position:relative;display:flex;gap:16px;align-items:center;margin-top:10px;flex-wrap:wrap;max-width:900px;}
    /* La ligne secondaire porte le poids, les plaies et les métiers — dont l'alarme de
       surcharge, mesurée à 1,52:1 sur l'herbe. Même sol, ancré en bas à gauche. */
    .hc-2nd::before{content:'';position:absolute;pointer-events:none;z-index:-1;
      inset:-12px -46px -14px -22px;
      background:radial-gradient(ellipse at 14% 50%,rgba(${PLAQUE_ENCRE},${PLAQUE_ALPHA}),rgba(${PLAQUE_ENCRE},${(PLAQUE_ALPHA * 0.62).toFixed(2)}) 54%,rgba(${PLAQUE_ENCRE},0) 82%);}
    .hc-weight{font-size:12px;letter-spacing:1px;${INK_OUTLINE}}
    .hc-wounds{font-size:12px;color:#e05a4a;letter-spacing:1px;${INK_OUTLINE}}
    .hc-skills{font-size:12px;color:#9a8f78;letter-spacing:1px;${INK_OUTLINE}}
    /* bas-centre : ceinture */
    .hc-belt{position:absolute;left:50%;transform:translateX(-50%);bottom:26px;display:flex;gap:5px;opacity:var(--hud-alpha);}
    .hc-slot{position:relative;width:78px;height:78px;background:rgba(27,27,34,.8);border:3px solid #14141a;box-shadow:0 3px 0 rgba(0,0,0,.5);}
    .hc-slot-active{background:rgba(27,27,34,.86);border-color:#c98b3a;box-shadow:0 0 0 1px #14141a,0 3px 0 rgba(0,0,0,.5);}
    .hc-num{position:absolute;top:3px;left:5px;font-size:11px;color:#9a8f78;${INK_OUTLINE}}
    .hc-iicon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;image-rendering:pixelated;}
    .hc-count{position:absolute;bottom:3px;right:5px;font-size:11px;color:#e8e0c8;${INK_OUTLINE}}
    .hc-wearbg{position:absolute;left:4px;right:4px;bottom:5px;height:4px;background:#3a2f22;}
    .hc-wear{height:100%;background:#c98b3a;}
  </style>
  <div class="hc-tl">
    <div class="hc-day"></div>
    <div class="hc-zone"></div>
    <div class="hc-village"></div>
    <div class="hc-board"></div>
    <div class="hc-save"></div>
  </div>
  <div class="hc-centre"></div>
  <div class="hc-bl">
    <div class="hc-vitals"></div>
    <div class="hc-2nd">
      <span class="hc-weight"></span>
      <span class="hc-wounds"></span>
      <span class="hc-skills"></span>
    </div>
  </div>
  <div class="hc-belt"></div>`
}
