/**
 * Le PANNEAU DEBUG (DEV uniquement) — des interrupteurs CLIQUABLES, armés par P.
 *
 * Remplace les touches F2-F5 (F5 rechargeait la page — raccourci navigateur) par
 * un panneau DOM : on clique un toggle, il pilote le MÊME état registry / action
 * que les touches. Les raccourcis F2/F3/F4 restent, en accélérateurs (voir
 * debug-bindings.ts) ; le panneau est la surface principale.
 *
 * DOM et non Phaser : un bouton se clique sans ambiguïté, et le canvas upscalé
 * (Scale.FIT) rendrait des libellés flous. Comme tout le debug, ce module n'est
 * importé que sous `import.meta.env.DEV` : Rollup l'élimine du bundle de prod.
 *
 * ═══ LE RELEVÉ THERMIQUE (2026-08-22) ═══
 *
 * Le panneau porte aussi un CADRAN : les quatre températures de la tuile sous les pieds,
 * plus ce que le ciel y fait. Elles ne sont pas décoratives — depuis que la neige se dérive
 * du froid (spec `meteo.md` R11-R13), c'est `T₀` qui décide si un front tombe en pluie ou en
 * neige, si un orage est un blizzard, si un gué prend. Sans cadran, ces lois sont invisibles
 * en jouant, et un calibrage se ferait à l'aveugle.
 *
 * Le panneau ne CALCULE rien : `WorldScene` lui pousse un relevé déjà lu par les fonctions
 * de `/sim` (`majThermo`). C'est la même règle que partout — le client est bête, et deux
 * lectures d'une même loi finiraient par diverger.
 */
import type Phaser from 'phaser'
import { coeurDeLaSaisonSuivante, GEL, nomDeSaison, phaseForDay, TEMPERATURE, type PlayerAction } from '@ashes/sim'
import { getHud, setHud } from '../../hud-state'
import { ensureGameFont, GAME_FONT } from '../ui/game-font'

const SPEEDS = [1, 2, 4, 8] as const
const HOUR_DAY = 12
const HOUR_NIGHT = 0
// Les deux bornes du teint — LUES sur la sim, jamais recopiées : c'est la même échelle
// que la jauge du HUD et que les malus de froid.
// ⚠ Le cadran montre DEUX échelles : l'ambiant (°C du monde) et le corps (°C, 25→37). Le
// teint se lit donc sur des seuils différents — les confondre peindrait tout en rouge.
const CORPS_CONFORT = TEMPERATURE.CORPS_CONFORT
const CORPS_HYPOTHERMIE = TEMPERATURE.CORPS_HYPOTHERMIE
const AIR_DOUX = TEMPERATURE.AMBIANT_DOUX
const AIR_MORDANT = GEL.SEUIL_GUE // sous zéro, l'air mord : l'eau prend

export interface DebugPanelDeps {
  sendAction(action: PlayerAction): void
  setSpeed(factor: number): void
  isNight(): boolean
  /** Le jour de saison courant — vient du dernier snapshot, comme `isNight`. Le saut de
   *  calendrier en a besoin pour savoir OÙ il est avant de dire où il va. */
  seasonDay(): number
}

/**
 * CE QUE LE CADRAN MONTRE — quatre températures, dans l'ordre où la sim les compose, plus
 * l'état du ciel et du sol. Les noms sont ceux des fonctions de `/sim`, pour qu'on puisse
 * aller lire la loi derrière chaque nombre.
 */
export interface ReleveThermique {
  /** `dehorsSansMeteo` — le froid du MONDE sans le front : biome, heure, acte, Brume, cendre.
   *  C'est l'entrée de R11/R12 : la neige et le blizzard se décident LÀ-DESSUS. */
  monde: number
  /** `baselineTemperature` — le front compris, l'abri compris ; NI le feu ni la source chaude.
   *  C'est ce que lisent le gel, la flore et l'éveil des Cendreux. */
  lieu: number
  /** `ambientTemperature` — la cible du corps : le lieu, PLANCHÉ par le feu et la source chaude. */
  ressenti: number
  /** La jauge de l'avatar, qui DÉRIVE vers l'ambiant (elle est en retard, c'est normal). */
  corps: number
  /** L'aspect du ciel au point (`meteoAspectAt`) — `null` hors de toute bande. */
  ciel: string | null
  /** L'intensité de la bande ici, 0 → 1 (la rampe bord → cœur). */
  intensite: number
  /** Les degrés que le front retranche ICI (`meteoColdAt`) — pour un orage, la pente R12. */
  froidDuFront: number
  /** La couverture de neige au sol, 0 → 1, et le niveau qui commande le pas. */
  neige: number
  niveauNeige: number
  /** `cibleCorporelle(ressenti)` — la température où le corps se STABILISERAIT ici. Le
   *  corps y dérive ; comparer les deux dit si l'on se réchauffe ou si l'on s'éteint. */
  cibleCorps: number
  /** La tuile est-elle gelée (`estGele`) ? */
  glace: boolean
}

export interface DebugPanel {
  /** Pousse un relevé (ou `null` : rien à montrer). Appelé par `WorldScene`, throttlé. */
  majThermo(r: ReleveThermique | null): void
}

export function createDebugPanel(scene: Phaser.Scene, deps: DebugPanelDeps): DebugPanel {
  const reg = scene.registry

  ensureGameFont()
  const root = document.createElement('div')
  root.style.cssText = [
    'position:fixed', 'top:96px', 'left:12px', 'z-index:50',
    'display:none', 'flex-direction:column', 'gap:6px',
    'padding:10px 10px 11px', 'width:186px',
    `font:12px/1.3 ${GAME_FONT}`, 'color:#e6d9c4', // la police du jeu, même en outil de dev
    'background:rgba(20,15,11,0.86)', 'border:1px solid #33291f', 'border-radius:12px',
    'backdrop-filter:blur(6px)', 'box-shadow:0 14px 40px -16px rgba(0,0,0,0.7)',
    'user-select:none',
  ].join(';')

  const title = document.createElement('div')
  title.textContent = 'DEBUG'
  title.style.cssText = 'font-size:10px;letter-spacing:0.22em;color:#6b5f50;font-weight:600;margin-bottom:2px'
  root.appendChild(title)

  const mkBtn = (): HTMLButtonElement => {
    const b = document.createElement('button')
    b.style.cssText = [
      'appearance:none', 'cursor:pointer', 'text-align:left',
      'padding:7px 9px', 'border-radius:8px', 'border:1px solid #33291f',
      'font:inherit', 'color:#e6d9c4', 'background:#241a13', 'transition:background 120ms,color 120ms',
    ].join(';')
    b.onmouseenter = () => { b.style.background = '#2f2117' }
    b.onmouseleave = () => { render() }
    root.appendChild(b)
    return b
  }

  const bGod = mkBtn()
  const bLight = mkBtn()
  const bSpeed = mkBtn()
  const bNight = mkBtn()
  const bReveil = mkBtn()
  const bSaison = mkBtn()

  // ── LE SAUT DE CALENDRIER ── un CHAMP à la place du jour affiché : il MONTRE le jour courant
  // en repli et le remplace dès qu'on tape. Sans lui, seul le bouton « saison suivante » existe,
  // et viser un jour précis (une garde à reproduire, un relevé de banc) demanderait quatre clics
  // et un calcul mental.
  const saut = document.createElement('div')
  saut.style.cssText = 'display:flex;gap:6px;align-items:stretch'
  const champ = document.createElement('input')
  champ.type = 'number'
  champ.min = '1'
  champ.style.cssText = [
    'flex:1', 'min-width:0', 'appearance:textfield',
    'padding:7px 9px', 'border-radius:8px', 'border:1px solid #33291f',
    'font:inherit', 'color:#e6d9c4', 'background:#241a13', 'outline:none',
  ].join(';')
  const bJour = mkBtn()
  bJour.style.flex = '0 0 auto'
  saut.append(champ, bJour)
  root.appendChild(saut)

  // ── LE CADRAN THERMIQUE ── une grille libellé/valeur, monospace pour que les nombres
  // ne dansent pas d'une image à l'autre (un cadran qui gigote ne se lit pas).
  const thermo = document.createElement('div')
  thermo.style.cssText = [
    'margin-top:4px', 'padding-top:7px', 'border-top:1px solid #33291f',
    'display:grid', 'grid-template-columns:1fr auto', 'gap:1px 8px',
    'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace', 'color:#9a8b76',
  ].join(';')
  root.appendChild(thermo)

  /** Une ligne du cadran, allouée UNE fois : on ne réécrit que les valeurs. */
  const ligne = (label: string): HTMLSpanElement => {
    const l = document.createElement('span')
    l.textContent = label
    l.style.color = '#6b5f50'
    const v = document.createElement('span')
    v.style.cssText = 'color:#e6d9c4;text-align:right;font-variant-numeric:tabular-nums'
    thermo.append(l, v)
    return v
  }
  const vMonde = ligne('monde T₀')
  const vLieu = ligne('lieu')
  const vRessenti = ligne('ressenti')
  const vCorps = ligne('corps')
  const vCible = ligne('cible corps')
  const vCiel = ligne('ciel')
  const vSol = ligne('sol')

  /** Le teint d'un AIR : ambre sous l'air doux, rouge sous zéro (là où l'eau prend). */
  const teinteAir = (t: number): string => (t < AIR_MORDANT ? '#e2603f' : t < AIR_DOUX ? '#f6a94a' : '#e6d9c4')
  /** Le teint d'un CORPS : ambre dès qu'il quitte les 37, rouge à l'hypothermie — la même
   *  lecture que la jauge du HUD, pour qu'un coup d'œil suffise. */
  const teinteCorps = (t: number): string => (t < CORPS_HYPOTHERMIE ? '#e2603f' : t < CORPS_CONFORT ? '#f6a94a' : '#e6d9c4')
  /** Un degré, toujours signé de son unité : le cadran est en °C et ne doit pas se relire
   *  comme une jauge. Une décimale — le dixième bouge, le centième danserait. */
  const un = (t: number): string => (Number.isFinite(t) ? `${t.toFixed(1)}°` : '—')

  let dernier: ReleveThermique | null = null

  // Un toggle actif s'allume en ambre ; inactif, il reste terne.
  const paint = (b: HTMLButtonElement, label: string, active: boolean): void => {
    b.textContent = label
    b.style.background = active ? '#3a2716' : '#241a13'
    b.style.color = active ? '#f6a94a' : '#9a8b76'
    b.style.borderColor = active ? '#5a3c1e' : '#33291f'
  }

  function render(): void {
    const on = Boolean(getHud(reg, 'debugOn'))
    root.style.display = on ? 'flex' : 'none'
    if (!on) return
    paint(bGod, `Invulnérabilité${getHud(reg, 'debugGod') ? ' ·on' : ''}`, Boolean(getHud(reg, 'debugGod')))
    paint(bLight, `Éclairage dynamique${getHud(reg, 'debugLighting') ? ' ·on' : ''}`, Boolean(getHud(reg, 'debugLighting')))
    const sp = getHud(reg, 'debugSpeed') ?? 1
    paint(bSpeed, `Cadence ×${sp}`, sp !== 1)
    paint(bNight, deps.isNight() ? 'Passer au JOUR' : 'Passer à la NUIT', false)
    paint(bReveil, 'Réveiller le sol  ·F6', false)
    // Le bouton DIT OÙ IL VA — « saison suivante » sans nom obligerait à compter les saisons de
    // tête, et le panneau est fait pour qu'on n'ait pas à le faire.
    const cible = coeurDeLaSaisonSuivante(deps.seasonDay())
    paint(bSaison, `Saut → ${nomDeSaison(phaseForDay(cible))}`, false)
    paint(bJour, 'Aller', false)
    // LE CHAMP MONTRE LE JOUR COURANT EN REPLI : c'est le relevé qu'il remplace. On n'écrase
    // jamais ce qui est en train d'être tapé — `value` reste au joueur, `placeholder` au monde.
    champ.placeholder = `jour ${deps.seasonDay()}`
    peindreThermo()
  }

  function peindreThermo(): void {
    const r = dernier
    if (!r) {
      thermo.style.display = 'none'
      return
    }
    thermo.style.display = 'grid'
    vMonde.textContent = un(r.monde)
    vMonde.style.color = teinteAir(r.monde)
    vLieu.textContent = un(r.lieu)
    vLieu.style.color = teinteAir(r.lieu)
    vRessenti.textContent = un(r.ressenti)
    vRessenti.style.color = teinteAir(r.ressenti)
    vCorps.textContent = un(r.corps)
    vCorps.style.color = teinteCorps(r.corps)
    // LA CIBLE : où le corps FINIRAIT s'il restait là. Elle dit si l'on est en train de
    // gagner ou de perdre — un corps à 34 qui vise 36 se réchauffe, à 34 qui vise 27 il meurt.
    vCible.textContent = un(r.cibleCorps)
    vCible.style.color = teinteCorps(r.cibleCorps)
    // LE CIEL : l'aspect DÉRIVÉ (pluie ou neige, orage ou blizzard — R11), son emprise ici,
    // et ce qu'il retranche. « −0 » se dit « clair » : un front hors bande n'est pas un ciel.
    vCiel.textContent = r.ciel === null
      ? 'clair'
      : `${r.ciel} ${(r.intensite * 100).toFixed(0)}% −${r.froidDuFront.toFixed(0)}`
    vCiel.style.color = r.ciel === null ? '#6b5f50' : '#8fb0bc'
    // LE SOL : la couverture continue, le NIVEAU qui commande le pas (0/1/2), et la glace.
    const niveaux = ['nue', 'poudreuse', 'genoux']
    vSol.textContent = r.glace
      ? 'glace'
      : r.neige > 0 ? `${niveaux[r.niveauNeige] ?? '?'} ${r.neige.toFixed(2)}` : 'nu'
    vSol.style.color = r.glace ? '#8fb0bc' : r.neige > 0 ? '#e6d9c4' : '#6b5f50'
  }

  bGod.onclick = () => {
    const god = !getHud(reg, 'debugGod')
    setHud(reg, 'debugGod', god)
    deps.sendAction({ type: 'debug_god', on: god })
    render()
  }
  bLight.onclick = () => {
    setHud(reg, 'debugLighting', !getHud(reg, 'debugLighting'))
    render()
  }
  bSpeed.onclick = () => {
    const cur = getHud(reg, 'debugSpeed') ?? 1
    const next = SPEEDS[(SPEEDS.indexOf(cur as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!
    setHud(reg, 'debugSpeed', next)
    deps.setSpeed(next)
    render()
  }
  bNight.onclick = () => {
    deps.sendAction({ type: 'debug_set_hour', hour: deps.isNight() ? HOUR_DAY : HOUR_NIGHT })
    render()
  }
  // LE SOL SE RÉVEILLE (spec `cendreux.md` R21bis). Pas un toggle : un GESTE, qu'on rejoue à
  // chaque clic — d'où l'absence d'état allumé/éteint.
  bReveil.onclick = () => {
    deps.sendAction({ type: 'debug_reveil' })
    render()
  }

  /**
   * LE SAUT DE CALENDRIER (`debug_set_season_day`) — l'action existait dans /sim depuis V0-9 et
   * n'avait AUCUNE surface : personne ne pouvait l'atteindre en jouant.
   *
   * Ce qu'elle débloque, mesuré le 2026-08-24 : le monde ouvre aux Pluies (S2), et l'aridité
   * demande de la CHALEUR autant que de la sécheresse — le premier jour où la vallée est
   * vraiment à sec est le jour 154, soit **h 46,5 de jeu**. Les trois régimes du niveau d'eau
   * (S10 : la mare partie, la terre noyée, le gué que la crue ferme) et l'art qui les peint
   * étaient donc invisibles dans toute séance de playtest raisonnable. Trois clics y mènent.
   *
   * Le jour VISÉ se calcule dans /sim (`coeurDeLaSaisonSuivante`) : c'est du calendrier, pas du
   * rendu, et le client est bête. Il vise le CŒUR de la saison — ses cardinaux y sont posés,
   * donc son bord ne la montre pas (voir la docstring côté sim).
   */
  const sauterAu = (jour: number): void => {
    deps.sendAction({ type: 'debug_set_season_day', day: jour })
    champ.value = ''
    render()
  }
  bSaison.onclick = () => sauterAu(coeurDeLaSaisonSuivante(deps.seasonDay()))
  const sautDemande = (): void => {
    // Le champ VIDE veut dire « rien de saisi », pas « jour 0 » : on ne saute qu'à un jour lu.
    const jour = Number.parseInt(champ.value, 10)
    if (Number.isFinite(jour) && jour >= 1) sauterAu(jour)
  }
  bJour.onclick = sautDemande
  champ.onkeydown = (e) => {
    if (e.key === 'Enter') sautDemande()
  }
  // LE CHAMP PREND LE CLAVIER, PAR LE PATRON DE LA MAISON — `debugTyping`, lu par
  // `input-bindings` et par `WorldScene` au même titre qu'`uiTyping` et `chatTyping`. Un
  // `stopPropagation` sur le champ aurait été un PARI : Phaser écoute le clavier sur la fenêtre,
  // et rien ne garantit qu'on soit sur son chemin de bouillonnement. Le drapeau, lui, est déjà
  // honoré partout où une touche part au jeu. Et c'est un TROISIÈME drapeau, pas `uiTyping` :
  // UIScene remet celui-là à faux à chaque image quand l'écran personnage est fermé.
  champ.onfocus = () => setHud(reg, 'debugTyping', true)
  champ.onblur = () => setHud(reg, 'debugTyping', false)

  document.body.appendChild(root)
  render()

  // Le panneau suit l'état : P (debugOn) l'affiche/cache, et les leviers changés au
  // clavier (F2/F3/F4) rafraîchissent les toggles. `changedata` couvre tout le registry.
  const onChange = (): void => render()
  reg.events.on('changedata', onChange)
  scene.events.once('shutdown', () => {
    reg.events.off('changedata', onChange)
    root.remove()
  })

  return {
    majThermo(r: ReleveThermique | null): void {
      dernier = r
      // Repeindre SEULEMENT quand le panneau est ouvert : fermé, il ne coûte rien.
      if (getHud(reg, 'debugOn')) peindreThermo()
    },
  }
}
