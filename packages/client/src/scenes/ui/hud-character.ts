/**
 * L'ÉCRAN PERSONNAGE (maquette Turn 3A), en DOM — ouvert au TAB, en TROIS ONGLETS.
 *
 * ONGLET PERSONNAGE (le geste — on FAIT) : à gauche le SAC + un rappel de la CEINTURE,
 * glisser-déposer et clic droit (envoi rapide) ; à droite l'ARTISANAT : recherche,
 * recettes groupées par rayon, trois états (faisable / manque / grisé), un clic FAIT.
 * Un conteneur ouvert (coffre, dépouille) ajoute sa colonne de butin — et RAMÈNE à PERSONNAGE
 * (on loote, on ne consulte pas ses stats). C'est l'écran d'avant, INTACT.
 *
 * ONGLET MÉTIERS (la maîtrise — on COMPREND) : les quatre métiers en colonnes, chacun sa
 * fiche complète — le geste, l'échelle de PALIERS (atteint ✓ / prochain ▶ / verrouillé),
 * les gains continus, la note d'accès outil. Le contenu vient de `skill-guide.ts`, DÉRIVÉ
 * du sim et testé : la colonne ne peut pas mentir sur un seuil.
 *
 * ONGLET CARTE (le pays — on se SITUE) : la carte plein écran, celle de toujours, avec son
 * brouillard, ses pastilles de lieux et son zoom. Elle est RENDUE PAR PHASER (UIScene) : sur
 * cet onglet le panneau DOM s'efface — fond transparent, `pointer-events:none` — et ne garde
 * que sa barre d'onglets et sa ceinture par-dessus. Le DOM ne redessine pas la carte, il lui
 * fait sa place. M ouvre l'écran DIRECTEMENT sur cet onglet (et le referme).
 *
 * La CEINTURE reste ancrée sur les trois onglets (c'est la hotbar, elle ne saute jamais) ;
 * seul le contenu du haut change. TAB ouvre/ferme ; les en-têtes d'onglet basculent.
 *
 * AUCUNE RÈGLE DE JEU. Les gestes ne calculent QUE l'action à envoyer — la logique dure
 * (`dragToAction`, `quickMoveToAction`, `craftRows`) est PURE et testée, importée telle
 * quelle ; la sim tranche le résultat (invariant §3). Le client n'anticipe que l'affichage.
 */
import {
  CARRY,
  SLOTS,
  carryTier,
  carryWeight,
  durabilityOf,
  hasItems,
  RECIPES,
  nomExigence,
  skillLevel,
  type CarryTier,
  type Inventory,
  type ItemId,
  type PlayerAction,
  type RecipeId,
  type SkillId,
  type Slot,
  type SlotRef,
} from '@ashes/sim'
import type Phaser from 'phaser'
import type { Exigence, RecipeId as RecipeIdType } from '@ashes/sim'
import type { CapacitesEnPortee, CharacterTab, OpenContainerView } from '../../hud-state'
import { ITEM_LABELS, itemIconKey } from '../../render/item-art'
import { coutJetons, craftRows, etatRecette, fonctionsAbsentes, type CraftRow } from './craft-panel'
import { dragIntentFrom, dragToAction, quickMoveToAction } from './inventory-panel'
import {
  cartesDesSaisons,
  carnetComplet,
  railDeLEncyclopedie,
  rangeesDeSection,
  type CarnetsDuJoueur,
  type CarteSaison,
  type CaseEncyclo,
  type FicheEncyclo,
  type SectionId,
} from './encyclopedie'
import { astreUrl } from './astres'
import { HEX } from './palette'
import { SKILL_LABELS } from './skill-labels'
import { skillGuides, type SkillGuide } from './skill-guide'

const COLS = 6
const BAG_LO = SLOTS.BELT // les cases 0..BELT sont la ceinture ; le sac est au-dessus
const BAG_HI = SLOTS.PLAYER

const TIER_COLOR: Record<CarryTier, string> = {
  light: '#8a9a4a',
  medium: '#c9a24a',
  heavy: '#d07a2a',
  overloaded: '#e05a4a',
}
const TIER_LABEL: Record<CarryTier, string> = {
  light: 'LÉGER',
  medium: 'MOYEN',
  heavy: 'LOURD',
  overloaded: 'SURCHARGÉ',
}
/** « à la main », « au Feu », « à un Atelier N1 » — dérivé de l'exigence, pas d'une table. */
const ouFaire = (besoin: Exigence | null): string =>
  besoin === null ? 'à la main' : besoin.fonction === 'feu' ? 'au Feu' : nomExigence(besoin)

/** Les 4 métiers, à gauche : emblème (une icône d'objet du métier), libellé, niveau, barre.
 *  Le niveau vient de `skillLevel` (/sim) — l'écran montre la règle, il ne la refait pas. */
const SKILL_META: { id: SkillId; label: string; item: ItemId }[] = [
  { id: 'woodcutting', label: SKILL_LABELS.woodcutting, item: 'axe' },
  { id: 'mining', label: SKILL_LABELS.mining, item: 'pickaxe' },
  { id: 'foraging', label: SKILL_LABELS.foraging, item: 'berries' },
  { id: 'crafting', label: SKILL_LABELS.crafting, item: 'hammer' },
  { id: 'hunting', label: SKILL_LABELS.hunting, item: 'crude_rod' },
]

/** Le paperdoll autour de l'avatar. DÉCORATIF pour l'instant : aucun système d'équipement
 *  n'existe encore dans /sim (le seul « equip » est l'outil en case active). Les cases sont
 *  posées vides — le jour où l'équipement existera, elles s'y brancheront (spec à écrire). */
const EQUIP_LEFT: { key: string; label: string }[] = [
  { key: 'head', label: 'TÊTE' },
  { key: 'chest', label: 'TORSE' },
  { key: 'hands', label: 'MAINS' },
]
const EQUIP_RIGHT: { key: string; label: string }[] = [
  { key: 'back', label: 'DOS' },
  { key: 'legs', label: 'JAMBES' },
  { key: 'feet', label: 'PIEDS' },
]

export interface HudCharacter {
  update(s: {
    open: boolean
    /** L'onglet À AFFICHER — la vérité vient du registre (TAB pose `perso`, M pose `carte`) ;
     *  l'écran ne garde AUCUN onglet à lui. Un clic d'en-tête repasse par `hooks.setTab`. */
    tab: CharacterTab
    inv: Inventory
    activeSlot: number
    stations: CapacitesEnPortee
    seen: readonly RecipeIdType[]
    container: OpenContainerView | null
    skills: Partial<Record<SkillId, number>>
    /** LE BESTIAIRE (peche.md B5/R11) — le carnet de MON avatar, tel que le snapshot le porte. */
    pecheCarnet: readonly { sp: string; mm: number; prises: number }[]
    /** LE CARNET DE L'ENCYCLOPÉDIE — ce que MON avatar a rencontré (2026-08-24). */
    carnetEncyclo: readonly { k: string; n: number }[]
  }): void
}

export function createHudCharacter(
  board: HTMLElement,
  game: Phaser.Game,
  hooks: { queue: (a: PlayerAction) => void; setTyping: (v: boolean) => void; setTab: (t: CharacterTab) => void },
): HudCharacter {
  const urls = new Map<string, string>()
  const iconUrl = (item: ItemId): string => {
    const key = itemIconKey(item)
    let u = urls.get(key)
    if (u === undefined) {
      u = game.textures.getBase64(key)
      urls.set(key, u)
    }
    return u
  }

  const root = document.createElement('div')
  root.className = 'hch'
  root.innerHTML = markup()
  board.appendChild(root)

  const $ = <T extends HTMLElement>(s: string): T => root.querySelector<T>(s)!
  const bagGrid = $('.hch-bag')
  const beltRow = $('.hch-belt')
  const weightEl = $('.hch-weight')
  const contWrap = $('.hch-cont')
  const contGrid = $('.hch-cont-grid')
  const contTitle = $('.hch-cont-title')
  const listEl = $('.hch-list')
  const stationNote = $('.hch-note')
  const search = $<HTMLInputElement>('.hch-search')
  const skillsWrap = $('.hch-skills')
  // Les GROUPES d'onglet : l'onglet SAC = ces quatre blocs (l'écran d'avant) ; l'onglet
  // MÉTIERS = le seul `.hch-met`. La ceinture (`.hch-belt`) et la barre d'onglets restent.
  const artWrap = $('.hch-art')
  const persoWrap = $('.hch-perso')
  const sacWrap = $('.hch-sac')
  const metWrap = $('.hch-met')
  const encWrap = $('.hch-enc')
  const encRail = $('.hch-enc-rail')
  const encBody = $('.hch-enc-body')
  const tabBtns = Array.from(root.querySelectorAll<HTMLElement>('.hch-tab'))

  // ── L'avatar : le VRAI sprite du monde (`spr-player`), à ses proportions (carré, pixel) —
  //    la même effigie qu'en jeu, pour que le joueur se reconnaisse. ──
  $<HTMLImageElement>('.hch-av').src = game.textures.getBase64('spr-player')

  // ── Les cartes de métier (à gauche) : bâties une fois, la barre repeinte à l'update. ──
  const skillBars: { fill: HTMLElement; lvl: HTMLElement }[] = SKILL_META.map((sk) => {
    const el = document.createElement('div')
    el.className = 'hch-sk'
    el.innerHTML =
      `<div class="hch-sk-ic"><img src="${iconUrl(sk.item)}" alt=""></div>` +
      `<div class="hch-sk-mid">` +
      `<div class="hch-sk-top"><span class="hch-sk-name">${sk.label}</span><span class="hch-sk-lvl">niv 0</span></div>` +
      `<div class="hch-sk-bar"><div class="hch-sk-fill"></div></div></div>`
    skillsWrap.appendChild(el)
    return { fill: el.querySelector<HTMLElement>('.hch-sk-fill')!, lvl: el.querySelector<HTMLElement>('.hch-sk-lvl')! }
  })

  // ── Les COLONNES de l'onglet MÉTIERS : une fiche par métier, bâtie une fois. Le texte
  //    des paliers est FIXE (il vient de `skill-guide`) ; seuls le niveau, la barre et le
  //    statut ✓/▶/verrouillé se repeignent à l'update, selon le niveau courant. ──
  const metGrid = $('.hch-met-row')
  interface MetCol {
    id: SkillId
    lvl: HTMLElement
    fill: HTMLElement
    paliers: { el: HTMLElement; mark: HTMLElement; level: number }[]
  }
  // `skillGuides()` et `SKILL_META` sont dans le MÊME ordre (woodcutting, mining, foraging,
  // crafting) : on apparie par index pour retrouver l'emblème (icône d'objet) de chaque métier.
  const metCols: MetCol[] = skillGuides().map((guide: SkillGuide, i: number): MetCol => {
    const col = document.createElement('div')
    col.className = 'hch-met-col'
    const paliersHtml = guide.paliers.length
      ? guide.paliers
          .map(
            (p) =>
              `<div class="hch-mp" data-lvl="${p.level}"><span class="hch-mp-mk"></span>` +
              `<span class="hch-mp-lvl">niv ${p.level}</span><span class="hch-mp-txt">${p.text}</span></div>`,
          )
          .join('')
      : `<div class="hch-mp-none">une pente, pas des marches</div>`
    col.innerHTML =
      `<div class="hch-met-head">` +
      `<div class="hch-met-ic"><img src="${iconUrl(SKILL_META[i]!.item)}" alt=""></div>` +
      `<div class="hch-met-name">${guide.label}</div>` +
      `<div class="hch-met-lvl">niveau 0</div>` +
      `<div class="hch-met-bar"><div class="hch-met-fill"></div></div></div>` +
      `<div class="hch-met-gest">${guide.gesture}</div>` +
      `<div class="hch-met-sec">PALIERS</div>` +
      `<div class="hch-met-pal">${paliersHtml}</div>` +
      `<div class="hch-met-sec">TOUJOURS</div>` +
      `<div class="hch-met-pas">${guide.passifs.map((s) => `<div class="hch-mp-pas">${s}</div>`).join('')}</div>` +
      (guide.outilNote ? `<div class="hch-met-outil">${guide.outilNote}</div>` : '')
    metGrid.appendChild(col)
    return {
      id: guide.id,
      lvl: col.querySelector<HTMLElement>('.hch-met-lvl')!,
      fill: col.querySelector<HTMLElement>('.hch-met-fill')!,
      paliers: Array.from(col.querySelectorAll<HTMLElement>('.hch-mp')).map((el) => ({
        el,
        mark: el.querySelector<HTMLElement>('.hch-mp-mk')!,
        level: Number(el.dataset.lvl),
      })),
    }
  })

  // ── État courant (relu à chaque geste : la vérité vient du snapshot) ──
  let inv: Inventory = []
  let activeSlot = -1
  let stations: CapacitesEnPortee = {}
  let seen: readonly RecipeIdType[] = []
  let container: OpenContainerView | null = null
  let activeTab: CharacterTab = 'perso'

  // ── Les ONGLETS : bascule PUREMENT visuelle. Le sac/craft reste monté (jamais détruit) —
  //    le glisser-déposer et la file de craft survivent à un aller-retour sur MÉTIERS.
  //    Sur CARTE, le panneau lui-même s'EFFACE (`hch-carte` : fond transparent, pointeur
  //    qui traverse) pour laisser voir la carte Phaser dessous et la laisser se zoomer. ──
  const applyTab = (): void => {
    const perso = activeTab === 'perso'
    for (const b of tabBtns) b.classList.toggle('is-on', b.dataset.tab === activeTab)
    root.classList.toggle('hch-carte', activeTab === 'carte')
    artWrap.style.display = perso ? '' : 'none'
    persoWrap.style.display = perso ? '' : 'none'
    sacWrap.style.display = perso ? '' : 'none'
    metWrap.style.display = activeTab === 'metiers' ? 'flex' : 'none'
    encWrap.style.display = activeTab === 'encyclopedie' ? 'flex' : 'none'
    // Hors PERSONNAGE, le butin et les métiers-à-gauche disparaissent ; sur PERSONNAGE, leur
    // affichage fin (butin vs stats) reste tranché dans `update`, au vu du conteneur.
    if (!perso) {
      contWrap.style.display = 'none'
      skillsWrap.style.display = 'none'
    }
  }
  for (const b of tabBtns) {
    b.addEventListener('click', () => {
      // L'onglet cliqué part au REGISTRE ; il nous revient au prochain `update`. Un seul
      // écrivain, une seule vérité (c'est lui qui décide aussi si la carte est à l'écran).
      hooks.setTab((b.dataset.tab ?? 'perso') as CharacterTab)
    })
  }

  /**
   * ═══ L'ENCYCLOPÉDIE (décision d'Alexis, 2026-08-24) ═══
   *
   * Un rail de sections à gauche, la grille de la section à droite, une fiche au survol.
   *
   * **UNE ENTRÉE JAMAIS RENCONTRÉE NE DIT RIEN** — et ce n'est pas décidé ici : une case
   * muette arrive d'`encyclopedie.ts` sans effigie, sans nom et sans fiche. Le rendu ne peut
   * donc rien laisser fuir, pas même dans un attribut. Il pose ce que le module pur l'autorise
   * à dire, et rien d'autre.
   *
   * Le carnet vient du SNAPSHOT (`Entity.carnet`, `Entity.peche`), jamais d'un compte tenu
   * ici : l'écran montre la sim, il ne la refait pas.
   */
  /** La SECTION regardée. Purement locale à l'écran — la sim n'a pas à la connaître, et rien
   *  ne la persiste : on rouvre l'encyclopédie sur les ressources, comme un livre à la page 1. */
  let encSection: SectionId = 'ressources'

  /**
   * LE DÉVERROUILLAGE DE RELECTURE (DEV uniquement, 2026-08-25) — un interrupteur au pied du
   * rail qui remplace le carnet de l'avatar par un carnet COMPLET (`carnetComplet`), le temps
   * de relire les fiches. Il ne touche pas à la sauvegarde : le carnet du snapshot est intact,
   * on l'éteint et l'écran redit exactement ce que ce joueur a rencontré.
   *
   * Il PERSISTE (`localStorage`) parce qu'une séance de relecture recharge la page vingt fois,
   * et qu'un interrupteur qu'il faut rarmer à chaque rechargement ne sert personne. La clé est
   * en `braises.` comme toutes les adresses de ce projet (voir l'en-tête de CLAUDE.md).
   *
   * `import.meta.env.DEV` : Rollup élimine la branche du bundle de production, comme pour le
   * panneau debug — un joueur n'a pas d'interrupteur qui lui raconte le jeu qu'il n'a pas joué.
   */
  const CLE_ENC_TOUT = 'braises.dev.encyclo-tout'
  let encTout = false
  if (import.meta.env.DEV) {
    try {
      encTout = localStorage.getItem(CLE_ENC_TOUT) === '1'
    } catch {
      encTout = false
    }
  }

  /** L'URL d'une texture quelconque (une effigie de bête n'est pas une icône d'objet). */
  const texUrl = (key: string): string => {
    let u = urls.get(key)
    if (u === undefined) {
      u = game.textures.getBase64(key)
      urls.set(key, u)
    }
    return u
  }

  /** LA FICHE au survol. Elle n'est appelée QUE pour une case dont `encyclopedie.ts` a rendu
   *  une `fiche` : le rendu ne décide de rien. */
  const ficheDom = (f: FicheEncyclo): HTMLElement => {
    const fi = document.createElement('div')
    fi.className = 'hch-fi'
    const el = (cls: string, txt?: string): HTMLElement => {
      const d = document.createElement('div')
      d.className = cls
      if (txt !== undefined) d.textContent = txt
      return d
    }
    // ── L'en-tête : le nom, et le mot du coin (classe, palier, famille) ──
    const tete = el('hch-fi-h')
    tete.append(el('hch-fi-nom', f.nom), el('hch-fi-cl', f.kicker))
    // ── Les deux grands chiffres : celui du joueur à gauche, celui de la table à droite ──
    const chiffres = el('hch-fi-rec')
    const colonne = (sk: string, val: string, droite: boolean): HTMLElement => {
      const c = el(droite ? 'hch-fi-n' : '')
      const s1 = document.createElement('span')
      s1.className = 'hch-fi-sk'
      s1.textContent = sk
      const b = document.createElement('b')
      b.textContent = val
      c.append(s1, b)
      return c
    }
    chiffres.append(colonne(f.gauche[0], f.gauche[1], false), colonne(f.droite[0], f.droite[1], true))
    fi.append(tete, chiffres)
    // ── Les blocs de lignes, séparés par un filet ──
    f.blocs.forEach((bloc, i) => {
      const b = el(`hch-fi-bloc${i === f.blocs.length - 1 && f.puces.length === 0 ? ' hch-fi-last' : ''}`)
      for (const ligne of bloc) {
        const r = el('hch-fi-r')
        const k = document.createElement('span')
        k.className = 'hch-fi-k'
        k.textContent = ligne.k
        const v = document.createElement('span')
        v.className = `hch-fi-v${ligne.petit === true ? ' hch-fi-vs' : ''}`
        v.textContent = ligne.v
        r.append(k, v)
        if (ligne.jauge) {
          const j = document.createElement('span')
          j.className = 'hch-fi-j'
          for (let n = 0; n < ligne.jauge.total; n++) {
            const i2 = document.createElement('i')
            const teinte = ligne.jauge.teinte
            i2.className = [teinte ?? '', n < ligne.jauge.crans ? 'on' : ''].filter((x) => x).join(' ')
            j.append(i2)
          }
          r.append(j)
        }
        b.append(r)
      }
      fi.append(b)
    })
    // ── Les puces : le GEL porte le conditionnel, la BRAISE ce qui chauffe (palette.ts) ──
    if (f.puces.length > 0) {
      const p = el('hch-fi-puces')
      for (const puce of f.puces) {
        const c = document.createElement('span')
        c.className = `hch-chip${puce.chaud === true ? ' is-chaud' : ''}`
        c.textContent = puce.texte
        p.append(c)
      }
      fi.append(p)
    }
    return fi
  }

  /** UNE CASE. Tout ce qu'elle a le droit de montrer est déjà tranché par `encyclopedie.ts` —
   *  une case muette arrive sans effigie, sans nom et sans fiche : il n'y a rien à cacher ici. */
  const caseDom = (c: CaseEncyclo, rang: number, col: number, cols: number): HTMLElement => {
    const el = document.createElement('div')
    // Le RETOURNEMENT est décidé ici, pas au survol : une fiche de ~300 px ne tient sous une
    // case qu'à la première rangée, et les deux dernières colonnes la feraient sortir à droite.
    el.className = ['hch-bc', c.fiche ? '' : 'is-vide', rang >= 1 ? 'fl-y' : '', col >= cols - 2 ? 'fl-x' : '']
      .filter((k) => k)
      .join(' ')
    const cadre = document.createElement('div')
    cadre.className = 'hch-bc-cadre'
    if (c.drapeau) {
      const coin = document.createElement('span')
      coin.className = 'hch-bc-coin'
      coin.textContent = '⚑'
      cadre.append(coin)
    }
    if (c.effigie !== null) {
      const img = document.createElement('img')
      // UNE EFFIGIE DE BÊTE N'EST PAS CARRÉE (spr-deer 22×22, spr-wolf 22×17, spr-boar 22×15) :
      // l'étirer à 100×100 en `contain` donnerait une échelle de 4,54 — des colonnes de pixels
      // de 4 px et d'autres de 5. On la pose à son échelle NATURELLE ×4 (mémoire « rendu
      // cubique » : NEAREST + facteur entier, ou l'art se crénèle).
      img.className = c.effigie.kind === 'item' ? 'hch-bc-ic' : 'hch-bc-eff'
      img.src = c.effigie.kind === 'item' ? iconUrl(c.effigie.item) : texUrl(c.effigie.key)
      cadre.append(img)
    } else {
      const q = document.createElement('span')
      q.className = 'hch-bc-q'
      q.textContent = '?'
      cadre.append(q)
    }
    const nom = document.createElement('div')
    nom.className = 'hch-bc-nom'
    nom.textContent = c.nom
    const val = document.createElement('div')
    val.className = c.fiche ? 'hch-bc-rec' : 'hch-bc-rec is-vide'
    val.textContent = c.valeur
    const sous = document.createElement('div')
    sous.className = 'hch-bc-n'
    sous.textContent = c.sous
    el.append(cadre, nom, val, sous)
    if (c.fiche) el.append(ficheDom(c.fiche))
    return el
  }

  /** UNE CARTE DE SAISON. Quatre entrées seulement : ce n'est pas une grille d'icônes, et une
   *  saison jamais traversée se tait comme le reste. */
  const carteSaisonDom = (s: CarteSaison): HTMLElement => {
    const el = document.createElement('div')
    el.className = s.fiche === null ? 'hch-sc is-vide' : 'hch-sc'
    const cadre = document.createElement('div')
    cadre.className = 'hch-bc-cadre hch-sc-cadre'
    if (s.phase === null) {
      const q = document.createElement('span')
      q.className = 'hch-bc-q hch-sc-q'
      q.textContent = '?'
      cadre.append(q)
    } else {
      const img = document.createElement('img')
      img.className = 'hch-bc-ic hch-sc-ic'
      img.src = texUrl(`ic-saison-${s.phase}`)
      cadre.append(img)
    }
    const nom = document.createElement('div')
    nom.className = 'hch-sc-nom'
    nom.textContent = s.nom
    const rang = document.createElement('div')
    rang.className = 'hch-sc-k'
    rang.textContent = s.rang
    el.append(cadre, nom, rang)
    if (s.phase !== null) {
      const temps = document.createElement('div')
      temps.className = 'hch-sc-t'
      // LE PLUS FROID à gauche, LE PLUS CHAUD à droite — les relevés de CE joueur (décision
      // d'Alexis, 2026-08-25). Les classes gardent leurs noms : `nuit` peint le froid, `jour`
      // le chaud, et c'est exactement la teinte qu'on veut sous chacun.
      for (const [cls, lbl, v] of [
        ['hch-sc-nuit', 'LE PLUS FROID', s.froid],
        ['hch-sc-jour', 'LE PLUS CHAUD', s.chaud],
      ] as const) {
        const sp = document.createElement('span')
        sp.className = cls
        const i = document.createElement('i')
        i.textContent = lbl
        const b = document.createElement('b')
        b.textContent = v
        sp.append(i, b)
        temps.append(sp)
      }
      // LA BARRE COMMENCE À MINUIT (décision d'Alexis, 2026-08-27) — donc TROIS segments et
      // non deux : la nuit d'avant l'aube, le jour, la nuit d'après le crépuscule. Le jour
      // n'est plus un ruban calé à gauche, il occupe sa place dans la journée, et l'on voit
      // d'un coup d'œil que l'hiver le pousse tard ET le reprend tôt.
      //   Aucun repli pour un jour qui enjamberait minuit : à 48,86 N la bande tient toujours
      // dans un cycle (04h45 → 20h56 au plus large). Et la nuit d'après se DÉDUIT des deux
      // autres, pour que les trois largeurs fassent exactement 100 sous `display:flex`.
      const barre = document.createElement('div')
      barre.className = 'hch-sc-bar'
      //   LES ASTRES SONT CEUX DE LA BARRE HAUTE (`astres.ts`, à la demande d'Alexis) — le
      // même trait, une seule écriture. Seule la TEINTE change, et c'est le fond qui la
      // dicte : la braise du soleil de la barre haute (`emberBright`) disparaîtrait dans la
      // bande d'or, sur laquelle elle ne pèse que 1,8:1. Sur l'or, l'astre est donc ce qu'il y
      // a de plus clair (blanc, 2,9:1) ; sur l'ardoise, la lune est en encre vive (7,4:1).
      //   PEINTS EN FOND, PAS INSÉRÉS : un fond se DÉCOUPE au bord de son segment. Une image
      // enfant déborderait sur la bande voisine dès qu'un segment devient plus étroit qu'elle
      // — la nuit d'après le crépuscule de l'Ardeur ne fait que 12,8 % du cadran, et c'est la
      // plus mince de l'année.
      for (const [cls, w, astre, teinte] of [
        ['is-nuit', s.lever, 'lune', HEX.bodyBright],
        ['is-jour', s.coucher - s.lever, 'soleil', HEX.title],
        ['is-nuit', 100 - s.coucher, 'lune', HEX.bodyBright],
      ] as const) {
        const seg = document.createElement('i')
        seg.className = cls
        seg.style.width = `${w}%`
        seg.style.backgroundImage = `url("${astreUrl(astre, teinte, 1.6)}")`
        barre.append(seg)
      }
      const vecue = document.createElement('div')
      vecue.className = 'hch-sc-v'
      vecue.textContent = s.vecue
      el.append(temps, barre, vecue)
      if (s.fiche) el.append(ficheDom(s.fiche))
    }
    return el
  }

  /** La signature de ce qui est à l'écran — l'encyclopédie est repeinte à CHAQUE image tant
   *  qu'on la regarde, et elle bâtit une grille entière plus ses fiches. Elle ne rebâtit que
   *  quand le carnet ou la section ont bougé. */
  let encSig = ' '
  const paintEncyclopedie = (carnets: CarnetsDuJoueur): void => {
    const sig =
      encSection +
      '|' +
      carnets.encyclo.map((l) => `${l.k}=${l.n}`).join(',') +
      '|' +
      carnets.peche.map((l) => `${l.sp}:${l.mm}:${l.prises}`).join(',')
    if (sig === encSig) return
    encSig = sig

    // ── LE RAIL : une entrée par section, son compte, et les filets qui font les groupes ──
    const rail: HTMLElement[] = []
    for (const e of railDeLEncyclopedie(carnets)) {
      const li = document.createElement('div')
      li.className = `hch-enc-rl hud-click${e.id === encSection ? ' is-on' : ''}`
      li.dataset.section = e.id
      const nom = document.createElement('span')
      nom.textContent = e.nom
      const compte = document.createElement('em')
      compte.textContent = `${e.su}/${e.tot}`
      li.append(nom, compte)
      li.addEventListener('click', () => {
        encSection = e.id
        encSig = ' ' // la section a changé : on force le rebâti au prochain passage
      })
      rail.push(li)
      if (e.filet) {
        const sep = document.createElement('div')
        sep.className = 'hch-enc-sep'
        rail.push(sep)
      }
    }
    // ── L'INTERRUPTEUR DE RELECTURE (DEV) — au pied du rail, sous un filet : il ne fait pas
    //    partie du livre, il en ouvre toutes les pages. Absent du bundle de production.
    if (import.meta.env.DEV) {
      const sep = document.createElement('div')
      sep.className = 'hch-enc-sep'
      const li = document.createElement('div')
      li.className = `hch-enc-rl hch-enc-dev hud-click${encTout ? ' is-on' : ''}`
      const nom = document.createElement('span')
      nom.textContent = 'TOUT RÉVÉLER'
      const etat = document.createElement('em')
      etat.textContent = encTout ? 'dev · on' : 'dev · off'
      li.append(nom, etat)
      li.addEventListener('click', () => {
        encTout = !encTout
        try {
          localStorage.setItem(CLE_ENC_TOUT, encTout ? '1' : '0')
        } catch {
          // un navigateur qui refuse le stockage garde quand même l'interrupteur de la séance
        }
        encSig = ' ' // le carnet affiché change : on force le rebâti au prochain passage
      })
      rail.push(sep, li)
    }
    encRail.replaceChildren(...rail)

    // ── LE CORPS : la grille de la section, ou les quatre cartes des saisons ──
    if (encSection === 'saisons') {
      const grille = document.createElement('div')
      grille.className = 'hch-sais'
      grille.append(...cartesDesSaisons(carnets).map(carteSaisonDom))
      encBody.replaceChildren(grille)
      return
    }
    encBody.replaceChildren(
      ...rangeesDeSection(encSection, carnets).map((r, rang) => {
        const bloc = document.createElement('div')
        bloc.className = 'hch-brangee'
        const tete = document.createElement('div')
        tete.className = 'hch-brang'
        const titre = document.createElement('span')
        titre.className = 'hch-brang-t'
        titre.textContent = r.titre
        const fil = document.createElement('span')
        fil.className = 'hch-brang-fil'
        const note = document.createElement('span')
        note.className = 'hch-brang-s'
        note.textContent = r.note
        tete.append(titre, fil, note)
        const grille = document.createElement('div')
        grille.className = 'hch-bgrid'
        grille.style.gridTemplateColumns = `repeat(${r.cols},minmax(0,1fr))`
        // UNE CASE NE S'ÉTIRE PAS SANS FIN : à deux colonnes (les animaux sauvages), une case
        // pleine largeur ferait 520 px pour une effigie de 112. On borne la LARGEUR DE GRILLE
        // au produit — dérivé, donc juste pour toute section présente ou à venir.
        grille.style.maxWidth = `${r.cols * 240}px`
        grille.append(...r.cases.map((c, col) => caseDom(c, rang, col, r.cols)))
        bloc.append(tete, grille)
        return bloc
      }),
    )
  }

  /** Repeint les colonnes MÉTIERS : niveau, barre, et statut ✓/▶/verrouillé de chaque
   *  palier selon le niveau COURANT. Le texte, lui, est fixe (posé à la construction). */
  const paintMet = (skills: Partial<Record<SkillId, number>>): void => {
    for (const col of metCols) {
      const xp = skills[col.id] ?? 0
      const level = skillLevel(xp)
      const frac = xp > 0 ? Math.min(1, Math.max(0, Math.sqrt(xp / 100) - level)) : 0
      col.lvl.textContent = `niveau ${level}`
      col.fill.style.width = `${(frac * 100).toFixed(0)}%`
      // Le PROCHAIN palier = le plus bas encore verrouillé (Infinity si tout est atteint).
      const nextLevel = Math.min(...col.paliers.filter((p) => p.level > level).map((p) => p.level))
      for (const p of col.paliers) {
        const done = p.level <= level
        const next = !done && p.level === nextLevel
        p.el.classList.toggle('is-done', done)
        p.el.classList.toggle('is-next', next)
        p.el.classList.toggle('is-locked', !done && !next)
        p.mark.textContent = done ? '✓' : next ? '▶' : '·'
      }
    }
  }
  applyTab() // état de départ : l'onglet PERSONNAGE

  // ── La recherche : un vrai <input>. Focalisé = le jeu ne bouge plus (`uiTyping`). ──
  search.addEventListener('focus', () => hooks.setTyping(true))
  search.addEventListener('blur', () => hooks.setTyping(false))
  search.addEventListener('input', () => syncList())
  search.addEventListener('keydown', (e) => {
    e.stopPropagation() // le clavier va à l'input, pas au déplacement Phaser
    if (e.key === 'Escape') search.blur()
  })

  // ── Les cases : construites une fois, repeintes à l'update ──
  interface CellEl {
    el: HTMLElement
    icon: HTMLImageElement
    count: HTMLElement
    wearBg: HTMLElement
    wear: HTMLElement
    num: HTMLElement
    belt: boolean
  }
  const makeCell = (side: SlotRef['side'], slot: number, belt: boolean): CellEl => {
    const el = document.createElement('div')
    el.className = belt ? 'hch-cell hch-cell-belt hud-click' : 'hch-cell hud-click'
    el.dataset.side = side
    el.dataset.slot = String(slot)
    el.innerHTML =
      `<img class="hch-ic" alt="" style="display:none">` +
      (belt ? `<span class="hch-num">${slot + 1}</span>` : '') +
      `<span class="hch-ct"></span>` +
      `<div class="hch-wbg" style="display:none"><div class="hch-w"></div></div>`
    wireCell(el, side)
    return {
      el,
      icon: el.querySelector<HTMLImageElement>('.hch-ic')!,
      count: el.querySelector<HTMLElement>('.hch-ct')!,
      wearBg: el.querySelector<HTMLElement>('.hch-wbg')!,
      wear: el.querySelector<HTMLElement>('.hch-w')!,
      num: el.querySelector<HTMLElement>('.hch-num')!,
      belt,
    }
  }

  const bagCells: CellEl[] = []
  for (let i = BAG_LO; i < BAG_HI; i++) {
    const c = makeCell('player', i, false)
    bagGrid.appendChild(c.el)
    bagCells.push(c)
  }
  const beltCells: CellEl[] = []
  for (let i = 0; i < SLOTS.BELT; i++) {
    const c = makeCell('player', i, true)
    beltRow.appendChild(c.el)
    beltCells.push(c)
  }
  let contCells: CellEl[] = []

  const slotAt = (ref: SlotRef): Slot | null => {
    if (ref.side === 'container') return container?.inv[ref.slot] ?? null
    return inv[ref.slot] ?? null
  }

  // ── Glisser-déposer (pointeur) : from → to → dragToAction. La sim tranche. ──
  let drag: { from: SlotRef; ghost: HTMLElement } | null = null
  function wireCell(el: HTMLElement, side: SlotRef['side']): void {
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      const slot = Number(el.dataset.slot)
      const src = slotAt({ side, slot })
      if (!src) return
      e.preventDefault()
      const ghost = document.createElement('img')
      ghost.className = 'hch-ghost'
      ghost.src = iconUrl(src.item)
      moveGhost(ghost, e.clientX, e.clientY)
      document.body.appendChild(ghost)
      drag = { from: { side, slot }, ghost }
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const slot = Number(el.dataset.slot)
      const action = quickMoveToAction({
        from: { side, slot },
        playerInv: inv,
        container: container ? { kind: container.kind, id: container.id, inv: container.inv } : null,
      })
      if (action) hooks.queue(action)
    })
  }
  document.addEventListener('mousemove', (e) => {
    if (drag) moveGhost(drag.ghost, e.clientX, e.clientY)
  })
  document.addEventListener('mouseup', (e) => {
    if (!drag) return
    const d = drag
    drag = null
    d.ghost.remove()
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-slot]')
    if (!target) return
    const to: SlotRef = { side: target.dataset.side as SlotRef['side'], slot: Number(target.dataset.slot) }
    const src = slotAt(d.from)
    if (!src) return
    const intent = dragIntentFrom(
      d.from,
      to,
      e.shiftKey,
      src,
      slotAt(to),
      container ? { kind: container.kind, id: container.id } : null,
    )
    const action = dragToAction(intent)
    if (action) hooks.queue(action)
  })

  const paintCell = (c: CellEl, slot: Slot | null, active: boolean): void => {
    c.el.classList.toggle('hch-active', active)
    if (c.num) c.num.style.color = active ? '#c98b3a' : '#9a8f78'
    if (!slot) {
      c.icon.style.display = 'none'
      c.count.textContent = ''
      c.wearBg.style.display = 'none'
      return
    }
    c.icon.src = iconUrl(slot.item)
    c.icon.style.display = ''
    // La ceinture affiche « ×N » comme au HUD (elle ne doit pas changer d'un écran à l'autre).
    c.count.textContent = slot.count > 1 ? (c.belt ? '×' : '') + slot.count : ''
    if (slot.wear !== undefined && slot.wear > 0) {
      const left = Math.max(0, 1 - slot.wear / durabilityOf(slot.item))
      c.wearBg.style.display = ''
      c.wear.style.width = `${(left * 100).toFixed(0)}%`
    } else {
      c.wearBg.style.display = 'none'
    }
  }

  // NE RECONSTRUIRE QUE SUR CHANGEMENT. `drawList` détruit et recrée toutes les lignes ;
  // le rappeler à chaque frame RECRÉAIT la ligne entre le `mousedown` et le `mouseup` —
  // le navigateur n'émettait alors aucun `click` (craft cassé) et le scroll se remettait
  // à zéro. On ne redessine donc que si la recherche, les stations ou la bourse ont bougé.
  let lastSig = ''
  const invSig = (): string => inv.map((s) => (s ? `${s.item}:${s.count}` : '-')).join(',')
  const syncList = (): void => {
    const sig = `${search.value}|${JSON.stringify(stations)}|${seen.length}|${invSig()}`
    if (sig === lastSig) return
    lastSig = sig
    drawList()
  }

  const drawList = (): void => {
    const rows = craftRows(seen, search.value)
    const keepScroll = listEl.scrollTop // le geste de défilement survit à la reconstruction
    listEl.innerHTML = ''
    let group: HTMLElement | null = null
    for (const row of rows) {
      if (row.kind === 'header') {
        group = document.createElement('div')
        group.className = 'hch-grp'
        group.innerHTML = `<div class="hch-cat"></div><div class="hch-recs"></div>`
        group.querySelector<HTMLElement>('.hch-cat')!.textContent = row.label
        listEl.appendChild(group)
      } else if (group) {
        group.querySelector('.hch-recs')!.appendChild(recipeRow(row))
      }
    }
    // Note « fonction absente » : DÉRIVÉE des recettes (2026-08-01). L'ancienne liste
    // écrite à la main en comptait trois quand la sim en avait cinq — le four d'acier et
    // l'atelier lourd ne pouvaient pas être annoncés absents. Il n'y a plus de liste.
    const absent = fonctionsAbsentes(stations)
    // ET ELLE SE TAIT QUAND ELLE INDUIRAIT EN ERREUR : tant que rien n'est découvert, parler
    // de stations manquantes désigne une cause qui n'est pas la bonne.
    const noteUtile = absent.length > 0 && rows.length > 0
    stationNote.textContent = noteUtile
      ? `STATIONS ABSENTES ICI — ${absent.map((b) => nomExigence(b).toUpperCase()).join(' · ')}`
      : ''
    stationNote.style.display = noteUtile ? '' : 'none'
    // L'ÉTAT VIDE, ENFIN DESSINÉ — et il fallait le dessiner, pas le remplir.
    //
    // À la minute zéro, `seen` est vide PAR CONSTRUCTION : une recette ne se révèle qu'au
    // contact de sa matière (`decouverte.ts`, règle D2 du 2026-08-01). Le vide est donc
    // CORRECT. Mais rien ne le disait : le tutoriel promet « votre sac et l'artisanat », on
    // pressait TAB, et un tiers de l'écran restait blanc sous un titre et un champ de
    // recherche. Rien n'indiquait si c'était cassé, s'il manquait des ressources, ou s'il
    // fallait débloquer quelque chose — et la seule phrase présente, « STATIONS ABSENTES
    // ICI », orientait vers la MAUVAISE cause (on croyait qu'il manquait un atelier, alors
    // qu'il manquait d'avoir ramassé sa première fibre). La première impasse du parcours.
    // (Audit UX 2026-08-20, P2 ④ / L3-03.)
    //
    // On dit la RÈGLE, pas l'absence — et on distingue les deux vides, qui n'appellent pas
    // le même geste : « rien de découvert » envoie ramasser, « la recherche ne rend rien »
    // envoie corriger sa frappe. Même grammaire que `.hch-mp-none`, l'état vide que ce
    // fichier savait déjà dessiner vingt-six lignes plus haut.
    if (rows.length === 0) {
      const vide = document.createElement('div')
      vide.className = 'hch-liste-vide'
      vide.textContent = search.value.trim()
        ? `Aucune recette ne répond à « ${search.value.trim()} ».`
        : 'Ramassez une matière et sa recette apparaîtra ici.'
      listEl.appendChild(vide)
    }
    listEl.scrollTop = keepScroll
  }

  const recipeRow = (row: Extract<CraftRow, { kind: 'recipe' }>): HTMLElement => {
    const recipe = RECIPES[row.id]
    // TROIS ÉTATS, et le troisième est le nouveau (D2) : VERROUILLÉ, avec sa raison en
    // toutes lettres. Avant, une recette dont la station manquait n'était pas grisée —
    // elle n'était PAS LÀ, et rien ne disait au joueur ce qu'il devait bâtir.
    const { etat, raison } = etatRecette(stations, hasItems(inv, recipe.inputs), row.id, nomExigence)
    const el = document.createElement('div')
    el.className = etat === 'faisable' ? 'hch-rec hud-click' : 'hch-rec-off'
    const droite = etat === 'verrouille' ? `EXIGE ${raison}` : etat === 'manque' ? 'MANQUE' : 'FAISABLE'
    el.classList.add(`hch-rec-${etat}`)
    el.innerHTML =
      `<div class="hch-rec-ic"><img alt="" src="${iconUrl(recipe.output)}"></div>` +
      `<div class="hch-rec-mid"><div class="hch-rec-name"></div><div class="hch-rec-cost"></div></div>` +
      `<div class="hch-rec-state"></div>`
    el.querySelector<HTMLElement>('.hch-rec-name')!.textContent = ITEM_LABELS[recipe.output]
    const cout = el.querySelector<HTMLElement>('.hch-rec-cost')!
    for (const [i, j] of coutJetons(recipe.inputs, inv).entries()) {
      if (i > 0) cout.append(' · ')
      const bout = document.createElement('span')
      if (j.manque) bout.className = 'hch-miss'
      bout.textContent = j.texte
      cout.append(bout)
    }
    cout.append(` — ${ouFaire(recipe.requiert)}`)
    el.querySelector<HTMLElement>('.hch-rec-state')!.textContent = droite
    if (etat === 'faisable') el.addEventListener('click', () => hooks.queue({ type: 'craft', recipeId: row.id as RecipeId }))
    return el
  }

  return {
    update(s) {
      root.style.display = s.open ? 'flex' : 'none'
      if (!s.open) {
        if (drag) {
          drag.ghost.remove()
          drag = null
        }
        container = null // l'onglet, lui, est remis à `perso` par qui ferme l'écran (input-bindings)
        return
      }
      const hadContainer = container !== null
      inv = s.inv
      activeSlot = s.activeSlot
      stations = s.stations
      seen = s.seen
      container = s.container

      // Un conteneur qui S'OUVRE ramène à PERSONNAGE : on loote, on ne lit pas ses stats. Sur
      // le FRONT seulement (null → conteneur) : le forcer à chaque frame collerait l'écran sur
      // PERSONNAGE tant qu'un coffre est ouvert — plus moyen d'aller voir la carte ni les métiers.
      activeTab = container && !hadContainer ? 'perso' : s.tab
      if (activeTab !== s.tab) hooks.setTab(activeTab)
      applyTab()
      paintMet(s.skills)
      // L'encyclopédie ne se repeint QUE quand on la regarde : elle bâtit une grille entière
      // plus ses fiches, et l'écran se met à jour à chaque image tant qu'il est ouvert.
      // LE CARNET AFFICHÉ — celui de l'avatar, ou le carnet complet quand la relecture est
      // armée (DEV). C'est une SUBSTITUTION : les fabriques de cases ne savent rien du levier,
      // et le mémo de `paintEncyclopedie` voit un carnet différent, donc il repeint.
      if (activeTab === 'encyclopedie') {
        paintEncyclopedie(
          import.meta.env.DEV && encTout ? carnetComplet() : { encyclo: s.carnetEncyclo, peche: s.pecheCarnet },
        )
      }

      for (let i = 0; i < bagCells.length; i++) paintCell(bagCells[i]!, inv[BAG_LO + i] ?? null, false)
      for (let i = 0; i < beltCells.length; i++) paintCell(beltCells[i]!, inv[i] ?? null, i === activeSlot)

      const tier = carryTier(carryWeight(inv) / CARRY_CAP)
      const w = carryWeight(inv)
      weightEl.textContent = `${w.toFixed(1)} / ${CARRY_CAP} — ${TIER_LABEL[tier]}`
      weightEl.style.color = TIER_COLOR[tier]

      // Les métiers (à gauche) : niveau + fraction vers le suivant. La fraction, c'est la
      // partie décimale de √(xp/100) — les paliers de `skillLevel` tombent aux entiers.
      for (let i = 0; i < SKILL_META.length; i++) {
        const xp = s.skills[SKILL_META[i]!.id] ?? 0
        const level = skillLevel(xp)
        const frac = xp > 0 ? Math.min(1, Math.max(0, Math.sqrt(xp / 100) - level)) : 0
        skillBars[i]!.lvl.textContent = `niv ${level}`
        skillBars[i]!.fill.style.width = `${(frac * 100).toFixed(0)}%`
      }

      // La gauche de l'onglet PERSONNAGE : un seul locataire. Le butin d'un conteneur ouvert
      // PRIME sur les métiers (on loote, on ne consulte pas ses stats) ; sinon les métiers
      // reprennent la place. Ceci ne vaut QUE sur PERSONNAGE — ailleurs, `applyTab` a tout caché.
      if (activeTab === 'perso') {
        skillsWrap.style.display = container ? 'none' : ''
        if (container) {
          contWrap.style.display = 'block'
          contTitle.textContent = container.title.toUpperCase()
          if (contCells.length !== container.inv.length) {
            contGrid.innerHTML = ''
            contCells = container.inv.map((_, i) => {
              const c = makeCell('container', i, false)
              contGrid.appendChild(c.el)
              return c
            })
          }
          for (let i = 0; i < contCells.length; i++) paintCell(contCells[i]!, container.inv[i] ?? null, false)
        } else {
          contWrap.style.display = 'none'
        }
      }

      syncList() // ne reconstruit la liste QUE si recherche/stations/bourse ont changé
    },
  }
}

/** La capacité de portage — le dénominateur du poids (spec portage P11, /sim). */
const CARRY_CAP = CARRY.CAPACITY

function markup(): string {
  return `
  <style>
    /* Écran façon Rust en DEUX ONGLETS. La CEINTURE ne bouge pas (identique au HUD, bas-centre)
       et reste sur les deux onglets ; l'onglet SAC pose le sac juste au-dessus d'elle et
       l'ARTISANAT en colonne à droite ; l'onglet MÉTIERS remplit le haut de ses colonnes.
       Coordonnées dans le plan 1920×1080 (voir hud-dom.ts). */
    .hch{position:absolute;inset:0;background:#14100c;display:none;pointer-events:auto;
      background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.012) 0 2px,transparent 2px 4px);}
    .hch-close{position:absolute;top:24px;right:30px;font-size:12px;color:#8b8474;letter-spacing:1px;}

    /* SAC : bas-centre, colonnes ALIGNÉES sur la ceinture, posé JUSTE au-dessus d'elle.
       bottom = 26 (ceinture) + 78 (sa hauteur) + 16 (interstice ≤20). */
    .hch-sac{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);display:flex;flex-direction:column;}
    .hch-sac-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;}
    .hch-sac-t{font-size:13px;font-weight:700;color:#ffffff;letter-spacing:1px;}
    .hch-weight{font-size:12px;letter-spacing:1px;}
    .hch-bag{display:grid;grid-template-columns:repeat(${COLS},78px);grid-auto-rows:78px;gap:5px;}
    .hch-cell{position:relative;background:#1b1b22;border:3px solid #14141a;}
    .hch-active{background:#241d14;border-color:#c98b3a;}
    .hch-ic{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;image-rendering:pixelated;pointer-events:none;}
    .hch-num{position:absolute;top:3px;left:5px;font-size:11px;color:#9a8f78;}
    .hch-ct{position:absolute;bottom:3px;right:5px;font-size:11px;color:#e8e0c8;}
    .hch-wbg{position:absolute;left:4px;right:4px;bottom:5px;height:4px;background:#3a2f22;}
    .hch-w{height:100%;background:#c98b3a;}

    /* PAPERDOLL : l'avatar (effigie pixel du vrai sprite du monde) encadré, debout sur une
       braise, flanqué de deux colonnes de slots d'équipement — DÉCORATIFS pour l'instant
       (aucun système d'équipement en /sim). Posé JUSTE au-dessus du sac. */
    /* Le bloc fait la LARGEUR DE L'INVENTAIRE (493 = la grille du sac, étiré par .hch-sac) :
       les deux colonnes de slots aux bords, le portrait au centre. Haut (2×) et bien séparé
       du sac par la marge. Les 3 slots se répartissent sur toute la hauteur (haut/milieu/bas). */
    /* PERSONNAGE : ancré en HAUT, top aligné sur ARTISANAT (top:70), largeur de l'inventaire. */
    .hch-perso{position:absolute;left:50%;top:70px;transform:translateX(-50%);width:493px;}
    .hch-doll-h{font-size:17px;font-weight:700;color:#ffffff;letter-spacing:1px;margin-bottom:14px;}
    .hch-doll{display:flex;align-items:center;justify-content:space-between;}
    .hch-eqcol{display:flex;flex-direction:column;justify-content:space-between;height:492px;}
    .hch-eq{position:relative;width:78px;height:78px;background:rgba(27,27,34,.5);border:3px solid #14141a;display:grid;place-items:center;}
    .hch-eq-lbl{font-size:9px;color:#8b8474;letter-spacing:1px;}
    .hch-portrait{position:relative;width:300px;height:492px;border:3px solid #2a2a34;background:#16120d;
      background-image:radial-gradient(ellipse at 50% 50%,rgba(201,139,58,.14),rgba(20,16,12,0) 60%);display:grid;place-items:center;overflow:hidden;}
    .hch-portrait::after{content:'';position:absolute;bottom:118px;left:50%;transform:translateX(-50%);width:150px;height:18px;
      background:radial-gradient(ellipse,rgba(201,139,58,.4),rgba(201,139,58,0) 70%);}
    /* MÊMES PROPORTIONS QU'EN JEU : l'emprise du joueur est 1×1,6 tuile (widthTiles/heightTiles
       de spr-player dans snapshot-view.ts) — donc un rectangle vertical, pas un carré. Centré. */
    .hch-av{position:relative;width:150px;height:240px;image-rendering:pixelated;filter:drop-shadow(0 0 10px rgba(201,139,58,.25));}

    /* MÉTIERS : colonne à GAUCHE, verticalement centrée — emblème + niveau + barre de braise
       vers le niveau suivant. S'efface quand un conteneur ouvre (le butin reprend la gauche). */
    .hch-skills{position:absolute;left:60px;top:50%;transform:translateY(-50%);width:250px;display:flex;flex-direction:column;gap:12px;}
    .hch-sk-h{font-size:13px;color:#c98b3a;letter-spacing:2px;margin-bottom:2px;}
    .hch-sk{display:flex;align-items:center;gap:12px;background:#16120d;border:3px solid #14141a;padding:10px 12px;}
    .hch-sk-ic{width:40px;height:40px;background:#1b1b22;border:2px solid #2a2a34;display:grid;place-items:center;flex:0 0 auto;}
    .hch-sk-ic img{width:28px;height:28px;image-rendering:pixelated;}
    .hch-sk-mid{flex:1;min-width:0;}
    .hch-sk-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
    .hch-sk-name{font-size:14px;color:#e8e0c8;letter-spacing:1px;}
    .hch-sk-lvl{font-size:12px;color:#c98b3a;letter-spacing:1px;}
    .hch-sk-bar{height:5px;background:#2a2320;}
    .hch-sk-fill{height:100%;background:#c98b3a;transition:width .2s ease;}

    /* CEINTURE : COPIE EXACTE du HUD (hud-core .hc-belt / .hc-slot) — même taille, même
       place, même style, pour qu'ouvrir le sac ne la fasse ni sauter ni changer. Redessinée
       ici (et non le HUD) pour que le glisser-déposer vers la ceinture marche, comme Rust. */
    .hch-belt{position:absolute;left:50%;transform:translateX(-50%);bottom:26px;display:flex;gap:5px;}
    .hch-cell-belt{width:78px;height:78px;background:rgba(27,27,34,.8);box-shadow:0 3px 0 rgba(0,0,0,.5);}
    .hch-cell-belt.hch-active{background:rgba(27,27,34,.86);box-shadow:0 0 0 1px #14141a,0 3px 0 rgba(0,0,0,.5);}

    /* CONTENEUR ouvert (coffre, dépouille) : à GAUCHE, aligné bas — là où Rust met les
       habits. Caché tant qu'aucun conteneur n'est ouvert (basculé au JS). */
    .hch-cont{position:absolute;left:60px;bottom:120px;display:none;}
    .hch-cont-title{font-size:11px;color:#c98b3a;letter-spacing:1px;margin-bottom:8px;}
    .hch-cont-grid{display:grid;grid-template-columns:repeat(${COLS},66px);grid-auto-rows:66px;gap:6px;}
    .hch-cont-grid .hch-cell{width:66px;height:66px;}

    /* ARTISANAT : colonne à DROITE, toujours visible (pas d'onglet), dégagée du bas-centre. */
    .hch-art{position:absolute;top:70px;right:60px;width:600px;bottom:150px;display:flex;flex-direction:column;min-width:0;}
    .hch-art-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;}
    .hch-art-t{font-size:17px;font-weight:700;color:#ffffff;letter-spacing:1px;}
    .hch-art-hint{font-size:12px;color:#8b8474;letter-spacing:1px;}
    .hch-search{background:#1b1b22;border:3px solid #14141a;padding:12px 14px;font-size:16px;color:#e8e0c8;letter-spacing:1px;
      margin-bottom:18px;font-family:inherit;outline:none;}
    .hch-search::placeholder{color:#8b8474;}
    .hch-search:focus{border-color:#6b5a3a;}
    /* La liste défile : une VRAIE barre visible (le contenu déborde presque toujours). */
    .hch-list{flex:1;min-height:0;overflow-y:scroll;display:flex;flex-direction:column;gap:18px;padding-right:12px;
      scrollbar-width:thin;scrollbar-color:#6b5a3a #16120d;}
    .hch-list::-webkit-scrollbar{width:14px;}
    .hch-list::-webkit-scrollbar-track{background:#1b1b22;border:1px solid #14141a;}
    .hch-list::-webkit-scrollbar-thumb{background:#6b5a3a;border:3px solid #16120d;}
    .hch-list::-webkit-scrollbar-thumb:hover{background:#c98b3a;}
    .hch-cat{font-size:13px;color:#c98b3a;letter-spacing:2px;margin-bottom:10px;}
    .hch-recs{display:flex;flex-direction:column;gap:8px;}
    .hch-rec{display:flex;align-items:center;gap:14px;background:#1b1b22;border-left:3px solid #c98b3a;padding:13px 16px;}
    .hch-rec:hover{background:#2a2a34;}
    .hch-rec-off{display:flex;align-items:center;gap:14px;background:#17151a;border-left:3px solid #2a2a34;padding:13px 16px;}
    .hch-rec-ic{width:46px;height:46px;background:#14100c;border:2px solid #2a2a34;display:grid;place-items:center;flex:0 0 auto;}
    .hch-rec-ic img{width:34px;height:34px;image-rendering:pixelated;}
    .hch-rec-off .hch-rec-ic img{opacity:.4;}
    .hch-rec-mid{flex:1;min-width:0;}
    .hch-rec-name{font-size:17px;color:#e8e0c8;}
    .hch-rec-off .hch-rec-name{color:#8b8474;}
    .hch-rec-cost{font-size:14px;color:#9a8f78;margin-top:2px;}
    .hch-rec-off .hch-rec-cost{color:#8b8474;}
    .hch-rec-state{font-size:13px;color:#8a9a4a;letter-spacing:1px;flex:0 0 auto;}
    .hch-rec-off .hch-rec-state{color:#e05a4a;}
    /* GRAMMAIRE DE PALETTE (palette.ts) : le rouge porte ce qui BLOQUE (la bourse vide),
       le GEL ce qui est CONDITIONNEL — ici, un lieu qu'il reste à bâtir. Les deux états ne
       demandent pas le même geste (aller chercher vs aller bâtir) : ils ne peuvent pas
       porter la même couleur, ou la liste ne dit plus quoi faire. */
    .hch-rec-off.hch-rec-verrouille .hch-rec-state{color:#6f93a0;}
    .hch-miss{color:#e05a4a;}
    .hch-note{font-size:12px;color:#8b8474;letter-spacing:1px;margin-top:12px;padding-top:12px;border-top:1px solid #2a2a34;}
    .hch-ghost{position:fixed;width:44px;height:44px;image-rendering:pixelated;pointer-events:none;z-index:60;transform:translate(-50%,-50%);opacity:.85;}

    /* ONGLETS : barre fine en haut-gauche. TAB ouvre/ferme ; ces en-tetes basculent le
       contenu du haut (PERSONNAGE / METIERS / CARTE). L'onglet actif porte un liseré de braise.
       Sur CARTE, le panneau s'EFFACE : la carte est rendue par Phaser SOUS le HUD DOM, donc le
       fond opaque partirait devant elle et le panneau lui volerait molette et glisser. On rend
       le fond transparent et le pointeur traversant — seuls les .hud-click (onglets, ceinture)
       gardent le clic, exactement comme le HUD par-dessus le monde (voir hud-dom.ts). */
    .hch-carte{background:none;pointer-events:none;}
    /* La ceinture RESTE affichée sur CARTE (elle est ancrée aux trois onglets) mais elle rend
       le POINTEUR : ses cases sont du DOM cliquable, elles voleraient le glisser de la carte
       (MESURÉ : un glisser parti d'une case ne déplaçait rien) et leur clic droit enverrait un
       objet dans un sac qu'on ne voit même pas. Les touches 1-6, elles, marchent toujours. */
    .hch-carte .hch-cell-belt{pointer-events:none;cursor:default;}
    .hch-tabs{position:absolute;top:22px;left:40px;display:flex;gap:4px;}
    .hch-tab{font-size:13px;font-weight:700;letter-spacing:2px;color:#8b8474;background:none;border:none;
      border-bottom:3px solid transparent;padding:6px 16px 8px;cursor:pointer;font-family:inherit;}
    .hch-tab:hover{color:#e8e0c8;}
    .hch-tab.is-on{color:#f4ecd2;border-bottom-color:#c98b3a;}

    /* ONGLET METIERS : quatre colonnes pleine largeur, centrées, entre la barre d'onglets et
       la ceinture. Chaque colonne = une fiche : geste, echelle de paliers, passifs, note outil. */
    .hch-met{position:absolute;left:0;right:0;top:96px;bottom:120px;display:none;justify-content:center;align-items:flex-start;}
    /* L'ENCYCLOPÉDIE (décision d'Alexis, 2026-08-24) — UN RAIL DE SECTIONS, PUIS UNE GRILLE.
       Une entrée JAMAIS RENCONTRÉE est MUETTE : un « ? », pas de nom, pas de silhouette, et
       AUCUNE fiche n'est posée dessus — le survol ne peut donc rien fuiter. Seuls les comptes
       du rail avouent qu'il reste des choses à trouver. */
    .hch-enc{position:absolute;left:0;right:0;top:96px;bottom:120px;display:none;padding:0 40px;gap:28px;align-items:stretch;}
    /* LE RAIL : la largeur de la colonne des métiers (250 px), pour que l'écran garde sa mesure. */
    .hch-enc-rail{width:250px;flex:0 0 250px;display:flex;flex-direction:column;gap:3px;
      border-right:1px solid #22222a;padding-right:20px;}
    .hch-enc-rl{display:flex;align-items:baseline;justify-content:space-between;gap:8px;
      padding:9px 10px 9px 11px;border-left:3px solid transparent;font-size:13px;letter-spacing:.10em;
      color:#8b8474;cursor:pointer;}
    .hch-enc-rl em{font-style:normal;font-size:11px;letter-spacing:.04em;color:#4a4740;flex:0 0 auto;}
    .hch-enc-rl:hover{color:#e8e0c8;background:#191519;}
    .hch-enc-rl.is-on{color:#f4ecd2;background:#1b1b22;border-left-color:#c98b3a;}
    .hch-enc-rl.is-on em{color:#c98b3a;}
    .hch-enc-sep{height:1px;background:#22222a;margin:7px 10px;}
    /* L'interrupteur de relecture (DEV) : il se voit comme un outil, pas comme une section. */
    .hch-enc-dev{color:#6b5f50;font-size:11px;letter-spacing:.06em;}
    .hch-enc-dev.is-on{color:#8fb0bc;background:#141a1d;border-left-color:#8fb0bc;}
    .hch-enc-dev.is-on em{color:#8fb0bc;}
    .hch-enc-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;}
    .hch-brangee{display:flex;flex-direction:column;flex:1;min-height:0;}
    .hch-brang{display:flex;align-items:baseline;gap:12px;margin-bottom:6px;}
    .hch-brang-t{font-size:11px;letter-spacing:.20em;color:#c98b3a;}
    .hch-brang-fil{flex:1;height:1px;background:#22222a;}
    .hch-brang-s{font-size:10px;letter-spacing:.06em;color:#6b6455;}
    .hch-bgrid{flex:1;min-height:0;display:grid;grid-auto-rows:minmax(0,1fr);gap:10px;}

    /* LA CASE. L'effigie est celle du SAC pour un objet, celle du MONDE pour une bête —
       la même image qu'en jeu, pour qu'une rencontre se reconnaisse. */
    /* ⚠ max-height:max-content — UNE CASE NE S'ÉTIRE PAS EN HAUTEUR NON PLUS (2026-08-25).
       La rangée prend son tiers du cadre (décision du 2026-08-24), mais la CASE, elle, s'arrête
       à ce que son contenu demande. Sans ce plafond, une section d'UNE seule rangée (MONSTRES)
       donnait une case de 560 px de haut — et sa fiche, qui s'ouvre DESSOUS (le côté est décidé
       au rang : fl-y à partir de la deuxième rangée), tombait 117 px sous le bord de l'écran :
       MESURÉ, la seule des 80 fiches du livre à déborder. Le plafond vaut max-content et non un
       nombre : il suit ce que la case contient — cadre, nom, chiffre — donc l'art et la typo
       peuvent bouger sans qu'on le recalibre.
       (Un backtick dans ce commentaire casserait le template literal : mémoire vécue.) */
    .hch-bc{position:relative;background:#1b1b22;border:2px solid #2a2a34;padding:9px 6px 7px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:default;
      max-height:max-content;}
    .hch-bc:hover{border-color:#6b5a3a;background:#211c17;z-index:30;}
    .hch-bc-cadre{position:relative;width:112px;height:112px;flex:0 0 auto;background:#14100c;border:2px solid #22222a;
      display:grid;place-items:center;margin-bottom:6px;}
    .hch-bc-ic{width:100px;height:100px;image-rendering:pixelated;object-fit:contain;}
    /* L'effigie d'une bête : sa taille NATURELLE ×4 (facteur entier), jamais étirée. */
    .hch-bc-eff{image-rendering:pixelated;transform:scale(4);transform-origin:center center;}
    .hch-bc-nom{font-size:13px;color:#e8e0c8;letter-spacing:.03em;text-align:center;}
    .hch-bc-rec{font-size:15px;color:#c98b3a;margin-top:3px;letter-spacing:.02em;}
    .hch-bc-rec.is-vide{color:#4a4740;}
    .hch-bc-n{font-size:10px;color:#8b8474;height:13px;}
    .hch-bc-coin{position:absolute;top:-4px;left:-4px;font-size:15px;color:#6f93a0;line-height:1;}
    /* La case MUETTE ne réagit pas au survol : le curseur apprend tout de suite qu'il n'y a
       rien dessous, au lieu de promettre une fiche qui ne viendra jamais. */
    .hch-bc.is-vide{background:#17151a;border-style:dashed;border-color:#26262f;}
    .hch-bc.is-vide:hover{border-color:#26262f;background:#17151a;}
    .hch-bc.is-vide .hch-bc-cadre{border-style:dashed;border-color:#22222a;}
    .hch-bc.is-vide .hch-bc-nom{color:#5c574d;letter-spacing:.14em;}
    .hch-bc-q{font-size:56px;font-weight:700;color:#6b5a3a;line-height:1;}

    /* LES SAISONS : quatre cartes larges, pas une grille d'icônes. Elles ne remplissent pas
       toute la bande — la fiche s'ouvre DESSOUS, et doit tenir au-dessus de la ceinture. */
    .hch-sais{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
      grid-auto-rows:540px;align-items:start;gap:16px;}
    .hch-sc{position:relative;background:#1b1b22;border:2px solid #2a2a34;height:100%;
      display:flex;flex-direction:column;align-items:center;justify-content:center;padding:26px 20px 20px;}
    .hch-sc:hover{border-color:#6b5a3a;background:#211c17;z-index:30;}
    .hch-sc.is-vide{background:#17151a;border-style:dashed;border-color:#26262f;}
    .hch-sc.is-vide:hover{border-color:#26262f;background:#17151a;}
    .hch-sc.is-vide .hch-bc-cadre{border-style:dashed;border-color:#22222a;}
    .hch-sc.is-vide .hch-sc-nom{color:#5c574d;letter-spacing:.16em;}
    .hch-sc-cadre{width:190px;height:190px;margin-bottom:22px;}
    .hch-sc-ic{width:176px;height:176px;}
    .hch-sc-q{font-size:80px;}
    .hch-sc-nom{font-size:19px;font-weight:700;color:#f4ecd2;letter-spacing:.10em;text-align:center;}
    .hch-sc-k{font-size:11px;color:#8b8474;letter-spacing:.18em;margin-top:5px;}
    .hch-sc-t{display:flex;gap:26px;margin-top:22px;}
    .hch-sc-t span{text-align:center;}
    .hch-sc-t i{display:block;font-style:normal;font-size:10px;color:#8b8474;letter-spacing:.10em;margin-bottom:3px;}
    .hch-sc-t b{font-size:20px;font-weight:700;line-height:1;}
    .hch-sc-jour b{color:#c98b3a;}
    .hch-sc-nuit b{color:#6f93a0;}
    /* LE CADRAN JOUR/NUIT — assez HAUT pour porter ses astres (2026-08-27, à la demande
       d'Alexis). ⚠ background-color et non le raccourci background : les segments posent leur
       soleil ou leur lune en background-image, et le raccourci l'effacerait. Et pas de
       image-rendering:pixelated : les astres sont des TRAITS SVG, pas de l'art 16 px. */
    .hch-sc-bar{width:100%;height:24px;background:#2a2a34;margin-top:18px;display:flex;}
    .hch-sc-bar i{display:block;height:100%;background-repeat:no-repeat;background-position:center;
                  background-size:20px 20px;}
    .hch-sc-bar i.is-jour{background-color:#c98b3a;}
    .hch-sc-bar i.is-nuit{background-color:#3b4a52;}
    .hch-sc-v{font-size:12px;color:#8b8474;margin-top:12px;letter-spacing:.06em;}

    /* LA FICHE au survol — TRAVERSANTE (pointer-events:none) : posée sous le curseur elle
       lui volerait le survol de sa propre case et clignoterait. Elle se retourne EN HAUT hors
       de la première rangée et À GAUCHE sur les deux dernières colonnes : elle sortirait du
       cadre autrement (les classes fl-y / fl-x sont posées à la construction). */
    .hch-fi{position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%);width:274px;
      background:#16120d;border:2px solid #2a2a34;box-shadow:0 8px 0 rgba(0,0,0,.45),0 0 0 1px #0c0a07;
      padding:12px 14px 10px;text-align:left;opacity:0;pointer-events:none;z-index:30;
      transition:opacity .09s linear;}
    .hch-bc:hover .hch-fi,.hch-sc:hover .hch-fi{opacity:1;}
    .fl-x .hch-fi{left:auto;right:0;transform:none;}
    .fl-y .hch-fi{top:auto;bottom:calc(100% + 8px);}
    .hch-fi-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;
      border-bottom:1px solid #2a2a34;padding-bottom:7px;margin-bottom:9px;}
    .hch-fi-nom{font-size:15px;font-weight:700;color:#f4ecd2;letter-spacing:.10em;}
    .hch-fi-cl{font-size:11px;color:#8b8474;letter-spacing:.14em;flex:0 0 auto;}
    .hch-fi-rec{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:11px;
      white-space:nowrap;gap:12px;}
    .hch-fi-sk{display:block;font-size:10px;color:#8b8474;letter-spacing:.10em;margin-bottom:1px;}
    .hch-fi-n{text-align:right;}
    .hch-fi-rec b{font-size:19px;color:#c98b3a;font-weight:700;line-height:1;}
    .hch-fi-n b{font-size:15px;color:#e8e0c8;}
    .hch-fi-bloc{display:flex;flex-direction:column;gap:5px;padding-bottom:9px;margin-bottom:9px;
      border-bottom:1px solid #1e1e26;}
    .hch-fi-last{border-bottom:none;padding-bottom:0;margin-bottom:2px;}
    .hch-fi-r{display:flex;align-items:center;gap:8px;font-size:12px;}
    /* 92 px : les intitulés de l'encyclopédie sont plus longs que ceux du seul bestiaire
       (« rendement », « durabilité », « temp. jour ») — à 56 px ils chevauchaient la valeur. */
    .hch-fi-k{color:#8b8474;letter-spacing:.06em;font-size:11px;width:92px;flex:0 0 92px;line-height:1.35;}
    .hch-fi-v{color:#e8e0c8;flex:1;min-width:0;}
    .hch-fi-vs{font-size:11px;color:#b9b09a;}
    .hch-fi-j{display:flex;gap:2px;flex:0 0 auto;}
    .hch-fi-j i{width:6px;height:10px;background:#2a2a34;display:block;}
    .hch-fi-j i.on{background:#c98b3a;}
    /* La grammaire de palette.ts : le GEL porte le conditionnel (le froid), le rouge ce qui
       blesse. Une jauge de dégâts en ambre dirait « ça chauffe », pas « ça tue ». */
    .hch-fi-j i.gel.on{background:#6f93a0;}
    .hch-fi-j i.alerte.on{background:#e05a4a;}
    .hch-fi-puces{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px;}
    .hch-chip{font-size:10px;letter-spacing:.06em;color:#6f93a0;border:1px solid #2c3c42;
      background:#151c1f;padding:3px 7px;}
    .hch-chip.is-chaud{color:#c98b3a;border-color:#3d3020;background:#1c1710;}
    .hch-met-row{display:flex;gap:26px;justify-content:center;padding:0 40px;}
    .hch-met-col{width:396px;background:#16120d;border:3px solid #14141a;padding:22px 22px 24px;display:flex;flex-direction:column;}
    .hch-met-head{display:grid;grid-template-columns:48px 1fr auto;grid-template-rows:auto auto;column-gap:14px;align-items:center;margin-bottom:16px;}
    .hch-met-ic{grid-row:1 / span 2;width:48px;height:48px;background:#1b1b22;border:2px solid #2a2a34;display:grid;place-items:center;}
    .hch-met-ic img{width:34px;height:34px;image-rendering:pixelated;}
    .hch-met-name{font-size:18px;font-weight:700;color:#ffffff;letter-spacing:1px;}
    .hch-met-lvl{grid-column:3;grid-row:1;font-size:13px;color:#c98b3a;letter-spacing:1px;}
    .hch-met-bar{grid-column:2 / span 2;grid-row:2;height:5px;background:#2a2320;margin-top:7px;}
    .hch-met-fill{height:100%;background:#c98b3a;transition:width .2s ease;}
    .hch-met-gest{font-size:14px;color:#b9b09a;line-height:1.5;margin-bottom:18px;min-height:44px;}
    .hch-met-sec{font-size:12px;color:#c98b3a;letter-spacing:2px;margin-bottom:9px;}
    .hch-met-pal{display:flex;flex-direction:column;gap:7px;margin-bottom:18px;}
    .hch-mp{display:grid;grid-template-columns:18px 52px 1fr;column-gap:8px;align-items:baseline;font-size:13px;line-height:1.4;}
    .hch-mp-mk{text-align:center;font-size:12px;}
    .hch-mp-lvl{letter-spacing:.5px;}
    .hch-mp.is-done{color:#e8e0c8;}
    .hch-mp.is-done .hch-mp-mk{color:#8a9a4a;}
    .hch-mp.is-next{color:#f4ecd2;}
    .hch-mp.is-next .hch-mp-mk{color:#c98b3a;}
    .hch-mp.is-locked{color:#6f685a;}
    .hch-mp.is-locked .hch-mp-mk{color:#4a453a;}
    .hch-mp-none{font-size:13px;color:#8b8474;font-style:italic;margin-bottom:18px;}
    /* L'état vide de la liste de recettes — même encre et même italique que son voisin
       ci-dessus, centré parce qu'il occupe une colonne entière et non une ligne. */
    .hch-liste-vide{font-size:13px;color:#8b8474;font-style:italic;text-align:center;padding:28px 18px;line-height:1.6;}
    .hch-met-pas{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;}
    .hch-mp-pas{font-size:13px;color:#b9b09a;line-height:1.4;padding-left:14px;text-indent:-14px;}
    .hch-mp-pas::before{content:'• ';color:#c98b3a;}
    .hch-met-outil{font-size:12px;color:#9a8f78;line-height:1.45;border-top:1px solid #2a2a34;padding-top:12px;padding-left:16px;text-indent:-16px;margin-top:8px;}
    .hch-met-outil::before{content:'⚑ ';color:#c98b3a;}
  </style>
  <div class="hch-close">TAB — FERMER</div>
  <div class="hch-tabs">
    <button class="hch-tab hud-click" data-tab="perso">PERSONNAGE</button>
    <button class="hch-tab hud-click" data-tab="metiers">MÉTIERS</button>
    <button class="hch-tab hud-click" data-tab="encyclopedie">ENCYCLOPÉDIE</button>
    <button class="hch-tab hud-click" data-tab="carte">CARTE</button>
  </div>
  <div class="hch-met"><div class="hch-met-row"></div></div>
  <div class="hch-enc">
    <div class="hch-enc-rail"></div>
    <div class="hch-enc-body"></div>
  </div>
  <div class="hch-art">
    <div class="hch-art-h"><span class="hch-art-t">ARTISANAT</span><span class="hch-art-hint">MOLETTE POUR DÉFILER</span></div>
    <input class="hch-search" type="text" placeholder="rechercher une recette…" spellcheck="false">
    <div class="hch-list"></div>
    <div class="hch-note"></div>
  </div>
  <div class="hch-cont"><div class="hch-cont-title"></div><div class="hch-cont-grid"></div></div>
  <div class="hch-skills"><div class="hch-sk-h">NIVEAUX</div></div>
  <div class="hch-perso">
    <div class="hch-doll-h">PERSONNAGE</div>
    <div class="hch-doll">
      <div class="hch-eqcol">${EQUIP_LEFT.map((e) => `<div class="hch-eq" data-eq="${e.key}"><span class="hch-eq-lbl">${e.label}</span></div>`).join('')}</div>
      <div class="hch-portrait"><img class="hch-av" alt=""></div>
      <div class="hch-eqcol">${EQUIP_RIGHT.map((e) => `<div class="hch-eq" data-eq="${e.key}"><span class="hch-eq-lbl">${e.label}</span></div>`).join('')}</div>
    </div>
  </div>
  <div class="hch-sac">
    <div class="hch-sac-h"><span class="hch-sac-t">SAC</span><span class="hch-weight"></span></div>
    <div class="hch-bag"></div>
  </div>
  <div class="hch-belt"></div>`
}

function moveGhost(el: HTMLElement, x: number, y: number): void {
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}
