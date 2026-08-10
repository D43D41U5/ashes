/**
 * L'ATELIER DES PLANS — l'éditeur graphique du bâti (spec `atelier-plans.md`, décisions
 * d'Alexis du 2026-08-10 : le rendu est LE JEU, et l'interface est L'ÉTABLI).
 *
 * LE PRINCIPE QUI NE SE NÉGOCIE PAS : l'éditeur ne dérive rien. Chaque édition rebâtit le
 * lieu par le VRAI moteur — `/sim` est pur, il tourne ici même (`createSim` + `batirLieu`)
 * — et le RENDU est celui du jeu (`scene.ts` : BootScene + SnapshotView + lumière). La
 * validation est la même loi que la suite (`verifierPlan`), la traversabilité passe par
 * `crossingBlocker`/`structureBlocks` — les fonctions du jeu, jamais une copie.
 *
 * ═══ LE GESTE (P-A) — ce qui fait « pro » ═══
 *
 *  · ANNULER/REFAIRE par lieu (Ctrl+Z / Ctrl+Y) — une entrée par TRAIT de pinceau ;
 *  · GLISSER-peindre et glisser-gommer ; PIPETTE (Alt+clic) ; raccourcis (chiffres =
 *    palette, B/E = outils, Espace = pan) ;
 *  · les BADGES d'arêtes posées, permanents (on ne gomme plus à l'aveugle) ;
 *  · zoom molette + pan, l'auteur garde SA caméra pendant qu'il édite ;
 *  · la barre d'état dit la tuile, la faute, et le ● modifié.
 *
 * ÉDITION EN ORIENTATION 0 SEULEMENT : les triplets d'arête (`x,y,D`) sont écrits dans le
 * repère du plan — les éditer sous rotation inviterait l'erreur d'un quart de tour. Les
 * quarts 1-3 restent des APERÇUS (c'est le monde qui tourne les lieux, pas l'auteur).
 *
 * SAUVEGARDE : POST vers l'endpoint dev (`vite.config.ts`), qui réécrit le `.plan` PUIS
 * régénère le module (`tools/plans-compile.mts` — un seul émetteur). Sur la stack Docker le
 * dépôt est monté en LECTURE SEULE : l'endpoint échoue proprement et le bouton « Copier »
 * reste la voie (le texte est le même — `serialiserPlan`, chirurgical, prose préservée).
 */
import Phaser from 'phaser'
import {
  BUILT_KINDS, LEGENDE, POI_TYPES, TERRAIN_GRASS, batirLieu, createEmptyMap, createSim,
  crossingBlocker, parserPlan, regionDe, serialiserPlan, spawnEntity, structureBlocks, verifierPlan,
} from '@ashes/sim'
import type { Plan, SimState, SortDuLieu } from '@ashes/sim'
import { BootScene } from '../scenes/BootScene'
import { AtelierScene, type Arete, type Region } from './scene'
import { vignette } from './apercu'
import {
  bornerZone, coller, effacer, extraire, miroirH, miroirV, redimensionner, tournerFragment,
  type Fragment, type Zone,
} from './selection'
import { autoPermis, exporterPlanche, rendrePlanche, type Variante } from './vignettes'

/** La marge d'herbe autour du plan sur la carte d'essai — les murs du pourtour vivent sur
 *  la tuile EXTÉRIEURE, il leur faut au moins une rangée, et l'œil respire avec deux. */
const MARGE = 2

/** Le plan de travail, MUTABLE — `versPlan()` le fige au format du moteur. */
interface Brouillon {
  usure: number
  fixe: boolean
  grille: string[]
  breches: string[]
  seuils: string[]
  passages: string[]
}

const $ = <E extends HTMLElement>(id: string): E => document.getElementById(id) as E

const etat = {
  kind: '',
  textes: new Map<string, string>(), //  le .plan ORIGINAL de chaque lieu (la prose y vit)
  brouillon: undefined as Brouillon | undefined,
  sort: 'intact' as SortDuLieu,
  quart: 0,
  /** L'avatar fictif DEDANS (au centre de la salle) ou DEHORS (au sud) : ce sont les VRAIES
   *  règles du jeu (nappe, pans) qui décident alors de ce qui s'efface — pas une bascule. */
  dedans: false,
  heure: 12,
  calques: { toits: true, aretes: true, regions: false, grille: true },
  outil: 'peindre' as 'peindre' | 'breche' | 'seuil' | 'passage' | 'gommer' | 'selection',
  car: '.',
  fautes: [] as string[],
  /** LA SÉLECTION (P-B), en cases de PLAN — et le presse-papier qu'on colle, tamponne, reflète. */
  selection: null as Zone | null,
  pressePapier: null as Fragment | null,
  /** Le mode COLLAGE : le fragment suit le curseur, chaque clic l'estampe, Échap le pose. */
  collage: false,
  /** Les lieux BROUILLONS (hors-monde, plans/brouillons/ — décision d'Alexis). */
  brouillons: new Set<string>(),
}

/** Les couleurs d'arête (fantôme ET badges) — brèche rouge, seuil ambre, passage vert. */
const COULEUR_OUTIL = { breche: 0xe06c5a, seuil: 0xc9a227, passage: 0x7aa35a } as const

function versBrouillon(plan: Plan): Brouillon {
  return {
    usure: plan.usure,
    fixe: plan.fixe === true,
    grille: [...plan.grille],
    breches: [...(plan.breches ?? [])],
    seuils: [...(plan.seuils ?? [])],
    passages: [...(plan.passages ?? [])],
  }
}

function versPlan(b: Brouillon): Plan {
  const plan: { -readonly [K in keyof Plan]?: Plan[K] } = { usure: b.usure, grille: [...b.grille] }
  if (b.breches.length) plan.breches = [...b.breches]
  if (b.seuils.length) plan.seuils = [...b.seuils]
  if (b.passages.length) plan.passages = [...b.passages]
  if (b.fixe) plan.fixe = true
  return plan as Plan
}

const footprintDe = (kind: string): number | undefined => POI_TYPES.find((t) => t.slug === kind)?.footprint

// ═══ L'HISTORIQUE — annuler/refaire PAR LIEU (P-A, non négociable) ═══
//
// La pile porte des ÉTATS (le brouillon figé en JSON), l'index pointe le courant. Un TRAIT
// de pinceau (enfoncé → relâché) ne fait qu'UNE entrée : annuler défait le geste, pas la
// case — c'est ce qui distingue un éditeur d'un formulaire.
interface Histoire { pile: string[]; index: number }
const histoires = new Map<string, Histoire>()

function histoireDe(kind: string): Histoire {
  let h = histoires.get(kind)
  if (!h) {
    h = { pile: [JSON.stringify(etat.brouillon)], index: 0 }
    histoires.set(kind, h)
  }
  return h
}

/** À appeler APRÈS une mutation aboutie (fin de trait, bascule d'arête, usure…). */
function pousserHistoire(): void {
  if (!etat.brouillon) return
  const h = histoireDe(etat.kind)
  const instantane = JSON.stringify(etat.brouillon)
  if (h.pile[h.index] === instantane) return //  rien n'a changé : pas d'entrée vide
  h.pile.length = h.index + 1 //  refaire s'oublie dès qu'on repart ailleurs
  h.pile.push(instantane)
  if (h.pile.length > 200) h.pile.shift()
  h.index = h.pile.length - 1
  majBoutonsHistoire()
}

function restaurerHistoire(direction: -1 | 1): void {
  const h = histoireDe(etat.kind)
  const cible = h.index + direction
  if (cible < 0 || cible >= h.pile.length) return
  h.index = cible
  etat.brouillon = JSON.parse(h.pile[cible]!) as Brouillon
  $<HTMLInputElement>('usure').value = String(etat.brouillon.usure)
  $<HTMLInputElement>('fixe').checked = etat.brouillon.fixe
  rafraichir()
}

function majBoutonsHistoire(): void {
  const h = histoires.get(etat.kind)
  $<HTMLButtonElement>('annuler').disabled = !h || h.index === 0
  $<HTMLButtonElement>('refaire').disabled = !h || h.index >= h.pile.length - 1
}

/** Le compteur de GÉNÉRATIONS d'aperçu : chaque rebâti décale ses ids — sans quoi le
 *  `SnapshotView` (sprites clefs par id, position figée à la création) garderait le sprite
 *  d'une vie antérieure sur une structure qui a changé de tuile. */
let generation = 0

/** LE VRAI MOTEUR, dans la page : la carte d'essai, la sim, le poseur, l'avatar — rien d'autre. */
function batir(plan: Plan, sort: SortDuLieu, quart: number, dedans: boolean): { sim: SimState; playerId: number } {
  const n = plan.grille.length
  const cote = n + 2 * MARGE
  const map = createEmptyMap(cote, cote, TERRAIN_GRASS)
  const sim = createSim(7, { map })
  batirLieu(sim, plan, MARGE, MARGE, sort, quart)
  generation += 1
  for (const s of sim.structures) s.id += generation * 100_000
  for (const nd of sim.nodes) nd.id += generation * 100_000
  const playerId = spawnEntity(sim, MARGE + n / 2, dedans ? MARGE + n / 2 : MARGE + n + 1.5)
  return { sim, playerId }
}

/**
 * LE DEDANS REJOINT-IL LE DEHORS ? On inonde depuis le coin d'herbe (0,0) à travers les
 * VRAIES structures — `crossingBlocker` et `structureBlocks(s, null, false)` : le marcheur
 * étranger du jeu, pas une règle maison. Rend les tuiles de région inaccessibles.
 */
function tuilesEnfermees(sim: SimState): string[] {
  const cote = sim.map.width
  const bloque = (s: Parameters<typeof structureBlocks>[0]): boolean => structureBlocks(s, null, false)
  const vus = new Set(['0,0'])
  const file: [number, number][] = [[0, 0]]
  for (let h = 0; h < file.length; h++) {
    const [x, y] = file[h]!
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= cote || ny >= cote || vus.has(`${nx},${ny}`)) continue
      if (crossingBlocker(sim.structures, x, y, dx, dy, bloque) !== undefined) continue
      vus.add(`${nx},${ny}`)
      file.push([nx, ny])
    }
  }
  // UNE CASE OCCUPÉE PAR UNE PIÈCE PLEINE (coffre, charrette, autel…) ne s'ENTRE pas — on
  // l'atteint depuis sa voisine, et c'est le jeu normal : elle ne compte pas comme enfermée.
  const occupees = new Set(sim.structures.filter((s) => (s.edges ?? 0) === 0 && bloque(s)).map((s) => `${s.tx},${s.ty}`))
  const enfermees: string[] = []
  for (const s of sim.structures) {
    if (s.type !== 'floor' && s.type !== 'terre') continue
    if (occupees.has(`${s.tx},${s.ty}`)) continue
    if (!vus.has(`${s.tx},${s.ty}`)) enfermees.push(`${s.tx - MARGE},${s.ty - MARGE}`)
  }
  return enfermees
}

// ═══ LE JEU, DANS LA PAGE (décision d'Alexis : « le même rendu que ingame ») ═══
//
// Le VRAI BootScene génère toutes les textures puis démarre l'AtelierScene (clé `menu`).
// Config calquée sur `main.ts` du jeu — mêmes réglages de rendu, mêmes lumières.
const jeu = new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 660,
  parent: $('jeu'),
  backgroundColor: '#181d15',
  antialias: true,
  roundPixels: true,
  render: { maxLights: 40 },
  scale: { mode: Phaser.Scale.NONE },
  scene: [BootScene, AtelierScene],
})

const laScene = (): AtelierScene | null => {
  const sc = jeu.scene.getScene('menu') as AtelierScene | null
  return sc?.pret ? sc : null
}

/** Recadrer au prochain rendu — armé au changement de lieu, jamais pendant une édition :
 *  le zoom et le pan appartiennent à l'auteur. */
let recadrer = true

/** La scène, quand elle est prête — le boot (génération des textures) prend quelques
 *  instants : on re-tente, et le DERNIER état demandé gagne. */
function rendre(sim: SimState, playerId: number): void {
  const sc = laScene()
  if (!sc) {
    window.setTimeout(() => rendre(sim, playerId), 120) // attente de boot seulement — pas un timing de jeu
    return
  }
  sc.surClic = (fx, fy, droit, alt) => clicCarte(fx - MARGE, fy - MARGE, droit, alt)
  sc.surGlisse = (fx, fy) => glisseCarte(fx - MARGE, fy - MARGE)
  sc.surRelache = () => finDeTrait()
  sc.surSurvol = (fx, fy) => survolCarte(fx - MARGE, fy - MARGE)
  sc.surZoom = (zoom) => { $('zoom-v').textContent = `${Math.round(zoom * 100)} %` }
  sc.heure = etat.heure
  sc.calques = etat.calques
  const b = etat.brouillon
  // LES BADGES : les triplets POSÉS, visibles en permanence — en orientation 0 seulement
  // (ils sont écrits dans le repère du plan ; sous rotation, l'aperçu reste nu).
  const aretes: Arete[] = []
  const regions: Region[] = []
  if (b && etat.quart === 0) {
    for (const [liste, couleur] of [
      [b.breches, COULEUR_OUTIL.breche], [b.seuils, COULEUR_OUTIL.seuil], [b.passages, COULEUR_OUTIL.passage],
    ] as const) {
      for (const t of liste) {
        const [x, y, d] = t.split(',')
        aretes.push({ tx: Number(x) + MARGE, ty: Number(y) + MARGE, dir: d as Arete['dir'], couleur })
      }
    }
    for (let ry = 0; ry < b.grille.length; ry++) {
      for (let rx = 0; rx < b.grille.length; rx++) {
        const reg = regionDe(b.grille[ry]![rx]!)
        if (reg) regions.push({ tx: rx + MARGE, ty: ry + MARGE, teinte: reg === 'salle' ? 0xe8b34a : 0x7aa35a })
      }
    }
  }
  sc.majSelection(etat.selection ? { tx: etat.selection.x0 + MARGE, ty: etat.selection.y0 + MARGE, w: etat.selection.w, h: etat.selection.h } : null)
  sc.montrer(sim, playerId, aretes, regions, !recadrer)
  recadrer = false
}

/**
 * LE BROUILLON SURVIT AU RECHARGEMENT (revue du 2026-08-10) : chaque sauvegarde régénère
 * `plans-batis.genere.ts`, qui vit dans `/sim` — et le plugin de full-reload recharge alors
 * TOUTES les pages, l'Atelier compris (c'est voulu pour le jeu, subi ici). Sans ce filet,
 * vingt minutes d'édition partaient au premier `balance.ts` touché dans un autre onglet.
 */
function memoriser(): void {
  sessionStorage.setItem('atelier', JSON.stringify({
    kind: etat.kind, brouillon: etat.brouillon, sort: etat.sort, quart: etat.quart,
    dedans: etat.dedans, heure: etat.heure, calques: etat.calques,
  }))
}

/** Le brouillon diffère-t-il du disque ? — le ● de la barre d'état et de la liste des lieux. */
function modifie(): boolean {
  return etat.brouillon !== undefined && etat.kind !== '' && texteCourant() !== etat.textes.get(etat.kind)
}

function rafraichir(): void {
  const b = etat.brouillon
  if (!b) return
  memoriser()
  const plan = versPlan(b)
  // LA MÊME LOI QUE LA SUITE (A8) : verifierPlan sur le plan en cours, à chaque édition.
  etat.fautes = verifierPlan(etat.kind, plan, footprintDe(etat.kind))
  // …plus l'usure, que la GRAMMAIRE juge d'habitude (parserPlan) : le champ nombre de la
  // page la contourne — vidé, `Number('')` vaut 0 et le compilateur refusait en bout de
  // chaîne avec un message de lecture seule trompeur (revue du 2026-08-10).
  if (!(b.usure > 0 && b.usure <= 1)) etat.fautes = [`${etat.kind} : usure « ${b.usure} » hors ]0, 1]`, ...etat.fautes]
  const valide = etat.fautes.length === 0
  let enfermees: string[] = []
  if (valide) {
    const { sim, playerId } = batir(plan, etat.sort, etat.quart, etat.dedans)
    enfermees = tuilesEnfermees(sim)
    rendre(sim, playerId) //  LE RENDU EST LE JEU : SnapshotView, lumière, vraies règles
  }
  const validation = $('validation')
  validation.innerHTML = ''
  for (const f of etat.fautes) {
    const div = document.createElement('div')
    div.className = 'faute'
    div.textContent = `✗ ${f}`
    validation.appendChild(div)
  }
  for (const t of enfermees) {
    const div = document.createElement('div')
    div.className = 'faute'
    div.textContent = `✗ la tuile (${t}) est ENFERMÉE — aucun chemin depuis le dehors`
    validation.appendChild(div)
  }
  if (valide && enfermees.length === 0) {
    const div = document.createElement('div')
    div.className = 'ok'
    div.textContent = '✓ plan valide, dedans joignable'
    validation.appendChild(div)
  }
  if (etat.quart !== 0) {
    const div = document.createElement('div')
    div.className = 'note'
    div.textContent = 'quart ≠ 0 : aperçu seulement, l’édition se fait en orientation 0'
    validation.appendChild(div)
  }
  // Une faute BLOQUE la sauvegarde (A8) — l'enfermement avertit, il ne bloque pas : une
  // ruine scellée est peut-être voulue un jour, la garde de la suite tranchera.
  $<HTMLButtonElement>('sauver').disabled = !valide
  // ── La barre d'état : la faute et le ● modifié se lisent sans chercher. ──
  const sbFautes = $('sb-fautes')
  sbFautes.textContent = valide ? '✓ 0 faute' : `✗ ${etat.fautes.length} faute(s)`
  sbFautes.className = valide ? 'ok' : 'faute'
  const sale = modifie()
  $('sb-modifie').textContent = sale ? '● modifié' : '— enregistré'
  $('voir-diff').style.display = sale ? '' : 'none'
  const opt = document.querySelector<HTMLOptionElement>(`#lieux option[value="${etat.kind}"]`)
  if (opt) {
    const base = etat.brouillons.has(etat.kind) ? `${etat.kind} (brouillon)` : etat.kind
    opt.textContent = sale ? `${base} ●` : base
  }
  const transformable = etat.selection !== null || (etat.collage && etat.pressePapier !== null)
  for (const id of ['miroir-h', 'miroir-v', 'tourner-frag'] as const) $<HTMLButtonElement>(id).disabled = !transformable
  majBoutonsHistoire()
  if (valide) planifierPlanche() //  P-C : la planche suit, tant que la mesure le permet
}

function message(texte: string): void {
  $('etat').textContent = texte
}

// ── LA PALETTE, DÉRIVÉE DE LA LÉGENDE (A6) — l'effaceur d'abord, puis chaque caractère.
//    Les DIX premières cases portent leur raccourci (1…9, 0). ──
const ordrePalette = (): string[] => ['·', ...Object.keys(LEGENDE)]

function construirePalette(): void {
  const palette = $('palette')
  palette.innerHTML = ''
  const entrees: [string, { piece?: string; noeud?: string; region?: string }][] =
    [['·', {}], ...Object.entries(LEGENDE)]
  for (const [i, [car, def]] of entrees.entries()) {
    const tuile = document.createElement('div')
    tuile.className = 'tuile' + (car === etat.car ? ' actif' : '')
    tuile.appendChild(vignette(def.piece, def.region))
    const carEl = document.createElement('span')
    carEl.className = 'car'
    carEl.textContent = car
    tuile.appendChild(carEl)
    const nom = document.createElement('span')
    nom.className = 'nom'
    nom.textContent = def.piece ?? def.noeud ?? def.region ?? (car === '·' ? 'rien' : '?')
    tuile.appendChild(nom)
    if (i < 10) {
      const kbd = document.createElement('span')
      kbd.className = 'kbd'
      kbd.textContent = String((i + 1) % 10)
      tuile.appendChild(kbd)
    }
    tuile.addEventListener('click', () => {
      etat.car = car
      construirePalette()
    })
    palette.appendChild(tuile)
  }
}

// ═══ LE TRAIT — peindre et gommer au GLISSER, une entrée d'historique par geste ═══
const trait = { actif: false, sale: false, derniere: '' }
/** Le coin de départ d'une sélection en cours de tirage (P-B). */
let selDepart: { x: number; y: number } | null = null

/** Pousser la sélection courante vers la scène — sans rebâtir le monde. */
function majSelectionScene(): void {
  laScene()?.majSelection(etat.selection
    ? { tx: etat.selection.x0 + MARGE, ty: etat.selection.y0 + MARGE, w: etat.selection.w, h: etat.selection.h }
    : null)
}

/** PEINDRE UNE CASE — LE chemin, unique (souris, glisser, sonde du smoke) : mêmes bornes,
 *  même garde d'orientation. Ne pousse PAS l'historique — le trait s'en charge à la fin. */
function peindreCase(rx: number, ry: number, car: string): boolean {
  const b = etat.brouillon
  if (!b) return false
  if (etat.quart !== 0) {
    message('l’édition se fait en orientation 0 — repasse quart à 0')
    return false
  }
  const n = b.grille.length
  if (rx < 0 || ry < 0 || rx >= n || ry >= n) return false
  if (b.grille[ry]![rx] === car) return true //  déjà cette case : rien à repeindre
  const rangee = [...b.grille[ry]!]
  rangee[rx] = car
  b.grille[ry] = rangee.join('')
  rafraichir()
  return true
}

/** L'ARÊTE LA PLUS PROCHE du point (u,v) dans sa tuile — le tri des quatre distances,
 *  le patron de la visée du jeu (`aim.ts`). Stable : à égalité, l'ordre déclaré tranche. */
function areteLaPlusProche(u: number, v: number): 'N' | 'E' | 'S' | 'O' {
  return [
    { d: 'N' as const, dist: v }, { d: 'E' as const, dist: 1 - u },
    { d: 'S' as const, dist: 1 - v }, { d: 'O' as const, dist: u },
  ].sort((p, q) => p.dist - q.dist)[0]!.d
}

/** LE CLIC — début de trait (peindre/gommer), bascule d'arête, PIPETTE (Alt+clic),
 *  gomme rapide (clic droit). Coordonnées de PLAN, fraction comprise. */
function clicCarte(fx: number, fy: number, droit: boolean, alt: boolean): void {
  const b = etat.brouillon
  if (!b) return
  if (etat.quart !== 0) {
    message('l’édition se fait en orientation 0 — repasse quart à 0')
    return
  }
  const rx = Math.floor(fx)
  const ry = Math.floor(fy)
  const n = b.grille.length
  // LE COLLAGE ARMÉ (P-B) : chaque clic estampe le fragment — Échap pour reposer l'outil.
  if (etat.collage && etat.pressePapier) {
    coller(b, etat.pressePapier, rx, ry)
    rafraichir()
    pousserHistoire()
    return
  }
  if (rx < 0 || ry < 0 || rx >= n || ry >= n) return
  // LA SÉLECTION (P-B) : le rectangle se tire au glisser ; les opérations viennent après
  // (Ctrl+C/X/V, Suppr, miroirs, tourner).
  if (etat.outil === 'selection') {
    trait.actif = true
    trait.derniere = `${rx},${ry}`
    selDepart = { x: rx, y: ry }
    etat.selection = { x0: rx, y0: ry, w: 1, h: 1 }
    majSelectionScene()
    return
  }
  // LA PIPETTE (P-A) : Alt+clic prend le caractère sous le curseur — la main ne voyage plus.
  if (alt) {
    etat.car = b.grille[ry]![rx]!
    construirePalette()
    message(`pipette : « ${etat.car} »`)
    return
  }
  // LA GOMME (l'outil, ou le clic DROIT depuis n'importe quel outil) : le triplet de
  // l'arête visée s'il y en a un, sinon la case redevient `·` — et le glisser continue.
  if (droit || etat.outil === 'gommer') {
    const triplet = `${rx},${ry},${areteLaPlusProche(fx - rx, fy - ry)}`
    for (const liste of [b.breches, b.seuils, b.passages]) {
      const i = liste.indexOf(triplet)
      if (i >= 0) {
        liste.splice(i, 1)
        rafraichir()
        pousserHistoire()
        return
      }
    }
    trait.actif = true
    trait.sale = peindreCase(rx, ry, '·')
    trait.derniere = `${rx},${ry}`
    return
  }
  if (etat.outil === 'peindre') {
    trait.actif = true
    trait.sale = peindreCase(rx, ry, etat.car)
    trait.derniere = `${rx},${ry}`
    return
  }
  {
    const triplet = `${rx},${ry},${areteLaPlusProche(fx - rx, fy - ry)}`
    const liste = b[etat.outil === 'breche' ? 'breches' : etat.outil === 'seuil' ? 'seuils' : 'passages']
    const i = liste.indexOf(triplet)
    if (i >= 0) liste.splice(i, 1)
    else liste.push(triplet)
  }
  rafraichir()
  pousserHistoire()
}

/** LE GLISSER — la suite du trait : la sélection s'étire, la peinture et la gomme suivent
 *  la main, case par case. */
function glisseCarte(fx: number, fy: number): void {
  if (!trait.actif) return
  const rx = Math.floor(fx)
  const ry = Math.floor(fy)
  const cle = `${rx},${ry}`
  if (cle === trait.derniere) return
  trait.derniere = cle
  if (etat.outil === 'selection' && selDepart) {
    const n = etat.brouillon?.grille.length ?? 1
    const cx = Math.max(0, Math.min(rx, n - 1))
    const cy = Math.max(0, Math.min(ry, n - 1))
    etat.selection = {
      x0: Math.min(selDepart.x, cx), y0: Math.min(selDepart.y, cy),
      w: Math.abs(cx - selDepart.x) + 1, h: Math.abs(cy - selDepart.y) + 1,
    }
    majSelectionScene()
    return
  }
  if (etat.outil !== 'peindre' && etat.outil !== 'gommer') return
  if (peindreCase(rx, ry, etat.outil === 'gommer' ? '·' : etat.car)) trait.sale = true
}

/** LA FIN DU TRAIT : UNE entrée d'historique pour tout le geste (la sélection n'en fait pas). */
function finDeTrait(): void {
  if (!trait.actif) return
  trait.actif = false
  selDepart = null
  if (trait.sale) pousserHistoire()
  trait.sale = false
  trait.derniere = ''
}

/** LE SURVOL — le FANTÔME de ce que le clic ferait, et la barre d'état (tuile + caractère). */
function survolCarte(fx: number, fy: number): void {
  const sc = laScene()
  if (!sc) return
  const b = etat.brouillon
  const rx = Math.floor(fx)
  const ry = Math.floor(fy)
  const n = b?.grille.length ?? 0
  if (!b || etat.quart !== 0 || rx < 0 || ry < 0 || rx >= n || ry >= n) {
    sc.majFantome(null)
    $('sb-pos').textContent = ''
    return
  }
  const car = b.grille[ry]![rx]!
  const def = LEGENDE[car]
  $('sb-pos').textContent = `(${rx}, ${ry}) · « ${car} » ${def?.piece ?? def?.noeud ?? def?.region ?? (car === '·' ? 'rien' : '?')}`
  const tx = rx + MARGE
  const ty = ry + MARGE
  if (etat.collage && etat.pressePapier) {
    sc.majFantome({ zone: { tx, ty, w: etat.pressePapier.w, h: etat.pressePapier.h, couleur: 0xe8b34a } })
  } else if (etat.outil === 'selection') sc.majFantome({ contour: { tx, ty, couleur: 0xe8b34a } })
  else if (etat.outil === 'peindre') sc.majFantome({ tuile: { tx, ty, texture: textureDeCar(etat.car) } })
  else if (etat.outil === 'gommer') sc.majFantome({ contour: { tx, ty, couleur: 0xe06c5a } })
  else sc.majFantome({ arete: { tx, ty, dir: areteLaPlusProche(fx - rx, fy - ry), couleur: COULEUR_OUTIL[etat.outil] } })
}

// ═══ COPIER / COUPER / COLLER / TRANSFORMER (P-B) ═══

function copierSelection(): void {
  const b = etat.brouillon
  if (!b || !etat.selection) return
  etat.pressePapier = extraire(b, bornerZone(etat.selection, b.grille.length))
  message(`copié : ${etat.pressePapier.w}×${etat.pressePapier.h} — Ctrl+V pour coller, « + tampon » pour garder`)
}

function couperSelection(): void {
  const b = etat.brouillon
  if (!b || !etat.selection) return
  copierSelection()
  effacer(b, bornerZone(etat.selection, b.grille.length))
  rafraichir()
  pousserHistoire()
}

function supprimerSelection(): void {
  const b = etat.brouillon
  if (!b || !etat.selection) return
  effacer(b, bornerZone(etat.selection, b.grille.length))
  rafraichir()
  pousserHistoire()
}

function armerCollage(): void {
  if (!etat.pressePapier) return
  etat.collage = true
  message('collage armé : chaque clic estampe le fragment — Échap pour reposer')
}

function toutDeposer(): void {
  etat.collage = false
  etat.selection = null
  selDepart = null
  majSelectionScene()
  laScene()?.majFantome(null)
}

/** MIROIR/ROTATION : sur le presse-papier si le collage est armé, sinon SUR PLACE dans la
 *  sélection — extraire, transformer, recoller au même coin (une entrée d'historique). */
function transformer(op: (f: Fragment) => Fragment): void {
  const b = etat.brouillon
  if (etat.collage && etat.pressePapier) {
    etat.pressePapier = op(etat.pressePapier)
    return
  }
  if (!b || !etat.selection) return
  const zone = bornerZone(etat.selection, b.grille.length)
  const f = op(extraire(b, zone))
  effacer(b, zone)
  coller(b, f, zone.x0, zone.y0)
  // Un quart de tour échange w et h : la sélection suit, bornée au plan.
  etat.selection = bornerZone({ x0: zone.x0, y0: zone.y0, w: f.w, h: f.h }, b.grille.length)
  rafraichir()
  pousserHistoire()
}

// ═══ LES TAMPONS (P-B) — des fragments NOMMÉS, gardés en localStorage, entre lieux. ═══

function lireTampons(): Record<string, Fragment> {
  try {
    return JSON.parse(localStorage.getItem('atelier-tampons') ?? '{}') as Record<string, Fragment>
  } catch {
    return {}
  }
}

function construireTampons(): void {
  const tampons = lireTampons()
  const conteneur = $('tampons')
  conteneur.innerHTML = ''
  for (const [nom, f] of Object.entries(tampons)) {
    const puce = document.createElement('span')
    puce.className = 'tampon'
    puce.textContent = `${nom} ${f.w}×${f.h}`
    puce.title = 'cliquer = armer le collage'
    puce.addEventListener('click', () => {
      etat.pressePapier = f
      armerCollage()
    })
    const x = document.createElement('span')
    x.className = 'x'
    x.textContent = '✕'
    x.addEventListener('click', (e) => {
      e.stopPropagation()
      const t = lireTampons()
      delete t[nom]
      localStorage.setItem('atelier-tampons', JSON.stringify(t))
      construireTampons()
    })
    puce.appendChild(x)
    conteneur.appendChild(puce)
  }
}

/** La texture de fantôme d'un caractère de palette — la VRAIE clé du jeu, jamais un dessin
 *  à part : la pièce, le nœud, ou le sol de la région. `·` n'a rien à montrer (case vide). */
function textureDeCar(car: string): string | null {
  const def = LEGENDE[car]
  if (!def) return null
  if (def.piece) return `st-${def.piece}`
  if (def.noeud) return `nd-${def.noeud}`
  return def.region === 'salle' ? 'st-floor' : def.region === 'cour' ? 'st-terre-0' : null
}

// ═══ LA PLANCHE (P-C) — auto tant que la MESURE le permet, débranchée sinon ═══

let plancheTimer = 0

function rafraichirPlanche(): void {
  const b = etat.brouillon
  if (!b || etat.fautes.length > 0) return
  const plan = versPlan(b)
  void rendrePlanche(
    $('planche'),
    (sort, quart) => batir(plan, sort, quart, false),
    (v: Variante) => {
      // PROMOUVOIR une vignette : ses réglages deviennent ceux de la vue principale.
      etat.sort = v.sort
      etat.quart = v.quart
      $<HTMLSelectElement>('sort').value = v.sort
      $<HTMLSelectElement>('quart').value = String(v.quart)
      if (v.heure !== 12) {
        etat.heure = v.heure
        $<HTMLInputElement>('heure').value = String(Math.max(6, Math.min(18, v.heure)))
        $('heure-v').textContent = `${etat.heure}h`
      }
      rafraichir()
    },
    (texte) => { $('planche-cout').textContent = texte },
  )
}

function planifierPlanche(): void {
  if (!autoPermis()) return //  la mesure a coupé l'auto : bouton « rafraîchir » seulement
  window.clearTimeout(plancheTimer)
  plancheTimer = window.setTimeout(rafraichirPlanche, 900) //  après la dernière frappe
}

// ═══ LE MONDE (P-D) — le diff, l'historique git, « tester en jeu » ═══

/** Un diff de LIGNES (LCS) — un .plan fait quelques dizaines de lignes, l'O(n·m) est libre. */
function differ(avant: string[], apres: string[]): { t: '+' | '-' | ' '; l: string }[] {
  const n = avant.length
  const m = apres.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = avant[i] === apres[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const sortie: { t: '+' | '-' | ' '; l: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (avant[i] === apres[j]) { sortie.push({ t: ' ', l: avant[i]! }); i++; j++ }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { sortie.push({ t: '-', l: avant[i]! }); i++ }
    else { sortie.push({ t: '+', l: apres[j]! }); j++ }
  }
  while (i < n) { sortie.push({ t: '-', l: avant[i]! }); i++ }
  while (j < m) { sortie.push({ t: '+', l: apres[j]! }); j++ }
  return sortie
}

function montrerDiff(avant: string, apres: string, titre: string): void {
  const pre = $('diff')
  pre.style.display = 'block'
  pre.innerHTML = ''
  const entete = document.createElement('div')
  entete.className = 'ctx'
  entete.textContent = `── ${titre} ──`
  pre.appendChild(entete)
  for (const { t, l } of differ(avant.split('\n'), apres.split('\n'))) {
    const ligne = document.createElement('div')
    ligne.className = t === '+' ? 'plus' : t === '-' ? 'moins' : 'ctx'
    ligne.textContent = `${t} ${l}`
    pre.appendChild(ligne)
  }
}

async function chargerHistorique(): Promise<void> {
  const conteneur = $('historique')
  conteneur.textContent = '…'
  try {
    const r = await fetch(`/atelier/api/plans/historique?kind=${etat.kind}`)
    const data = (await r.json()) as { rev: string; date: string; sujet: string }[] | { erreur: string }
    if (!r.ok || !Array.isArray(data)) throw new Error((data as { erreur: string }).erreur ?? `HTTP ${r.status}`)
    conteneur.innerHTML = ''
    for (const { rev, date, sujet } of data) {
      const ligne = document.createElement('div')
      ligne.textContent = `${date} ${rev} — ${sujet}`
      ligne.title = 'cliquer : diff de cette version vers le brouillon courant'
      ligne.addEventListener('click', () => {
        void fetch(`/atelier/api/plans/version?kind=${etat.kind}&rev=${rev}`)
          .then((rep) => rep.json())
          .then((v) => montrerDiff((v as { texte: string }).texte, texteCourant(), `${rev} (${date}) → brouillon`))
      })
      conteneur.appendChild(ligne)
    }
    if (!conteneur.childElementCount) conteneur.textContent = 'aucune entrée (fichier jamais commité ?)'
  } catch (e) {
    conteneur.textContent = `✗ ${(e as Error).message}`
  }
}

// ═══ LA CRÉATION (P-E) — des BROUILLONS, hors-monde (décision d'Alexis) ═══

async function creerBrouillon(base: string | null): Promise<void> {
  const nom = window.prompt('Nom du nouveau lieu (minuscules et _ seulement) :', base ? `${base}_bis` : 'mon_lieu')
  if (!nom) return
  if (!/^[a-z_]+$/.test(nom)) { message(`✗ « ${nom} » : minuscules et _ seulement`); return }
  if (etat.textes.has(nom)) { message(`✗ « ${nom} » existe déjà`); return }
  let texte: string
  if (base) texte = texteCourant()
  else {
    const cote = Math.max(3, Math.min(24, Number(window.prompt('Côté de la grille :', '5') ?? 5) || 5))
    texte = `# ═══ ${nom.toUpperCase()} — brouillon d'Atelier (HORS-MONDE tant que POI_TYPES l'ignore) ═══\nusure: 1\ngrille:\n${Array.from({ length: cote }, () => '·'.repeat(cote)).join('\n')}\n`
  }
  try {
    const r = await fetch('/atelier/api/plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-atelier': '1' },
      body: JSON.stringify({ kind: nom, texte, brouillon: true }),
    })
    const rep = (await r.json()) as { ok?: boolean; erreur?: string }
    if (!r.ok || !rep.ok) throw new Error(rep.erreur ?? `HTTP ${r.status}`)
    etat.textes.set(nom, texte)
    etat.brouillons.add(nom)
    const opt = document.createElement('option')
    opt.value = nom
    opt.textContent = `${nom} (brouillon)`
    $<HTMLSelectElement>('lieux').appendChild(opt)
    choisir(nom, { force: true })
    message(`✓ brouillon « ${nom} » créé (plans/brouillons/) — hors-monde tant que POI_TYPES l'ignore`)
  } catch (e) {
    message(`✗ création impossible : ${(e as Error).message}`)
  }
}
function champActif(): boolean {
  const a = document.activeElement
  if (a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement) return true
  // Un radio, une case, un curseur ou un bouton ne CAPTURENT pas les raccourcis — cliquer
  // l'outil « sélection » puis Ctrl+C doit copier, pas se taire (le focus reste sur le radio).
  return a instanceof HTMLInputElement && !['radio', 'checkbox', 'range', 'button'].includes(a.type)
}

window.addEventListener('keydown', (e) => {
  if (champActif()) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    restaurerHistoire(e.shiftKey ? 1 : -1)
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    restaurerHistoire(1)
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copierSelection(); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') { e.preventDefault(); couperSelection(); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); armerCollage(); return }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); supprimerSelection(); return }
  if (e.key === 'Escape') { toutDeposer(); return }
  if (e.key === ' ') {
    e.preventDefault() //  Espace = PAN, pas le défilement de page
    const sc = laScene()
    if (sc) sc.espace = true
    return
  }
  if (e.key === 'b' || e.key === 'B') choisirOutil('peindre')
  else if (e.key === 'e' || e.key === 'E') choisirOutil('gommer')
  else if (e.key === 'm' || e.key === 'M') choisirOutil('selection')
  else if (/^[0-9]$/.test(e.key)) {
    const i = e.key === '0' ? 9 : Number(e.key) - 1
    const car = ordrePalette()[i]
    if (car !== undefined) {
      etat.car = car
      construirePalette()
    }
  }
})
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    const sc = laScene()
    if (sc) sc.espace = false
  }
})

function choisirOutil(outil: typeof etat.outil): void {
  etat.outil = outil
  const radio = document.querySelector<HTMLInputElement>(`input[name="outil"][value="${outil}"]`)
  if (radio) radio.checked = true
}

// ── CHARGEMENT : les .plan par l'endpoint dev (la PROSE arrive avec — c'est elle que la
//    sauvegarde chirurgicale préserve). ──
async function charger(): Promise<void> {
  const r = await fetch('/atelier/api/plans')
  if (!r.ok) throw new Error(`endpoint plans : ${r.status}`)
  const data = (await r.json()) as { kind: string; texte: string; brouillon?: boolean }[]
  for (const { kind, texte, brouillon } of data) {
    etat.textes.set(kind, texte)
    if (brouillon) etat.brouillons.add(kind)
  }
  const kinds = [...etat.textes.keys()].sort()
  const absents = BUILT_KINDS.filter((k) => !etat.textes.has(k))
  if (absents.length) message(`⚠ module généré en avance sur les .plan : ${absents.join(', ')}`)
  const select = $<HTMLSelectElement>('lieux')
  select.innerHTML = ''
  for (const k of kinds) {
    const opt = document.createElement('option')
    opt.value = k
    opt.textContent = etat.brouillons.has(k) ? `${k} (brouillon)` : k
    select.appendChild(opt)
  }
  // ── LA SÉANCE REPREND OÙ ELLE EN ÉTAIT : le lieu, les bascules, et le BROUILLON s'il
  //    différait du disque — le full-reload (chaque sauvegarde en déclenche un) ne mange
  //    plus le travail en cours. ──
  const memoire = sessionStorage.getItem('atelier')
  const sauve = sessionStorage.getItem('atelier-sauve')
  sessionStorage.removeItem('atelier-sauve')
  if (memoire) {
    try {
      const m = JSON.parse(memoire) as {
        kind: string; brouillon: Brouillon; sort: SortDuLieu; quart: number
        dedans?: boolean; heure?: number; calques?: typeof etat.calques
      }
      if (etat.textes.has(m.kind)) {
        etat.sort = m.sort
        etat.quart = m.quart
        etat.dedans = m.dedans === true
        etat.heure = m.heure ?? 12
        if (m.calques) etat.calques = m.calques
        $<HTMLSelectElement>('sort').value = m.sort
        $<HTMLSelectElement>('quart').value = String(m.quart)
        $<HTMLInputElement>('dedans').checked = etat.dedans
        $<HTMLInputElement>('heure').value = String(etat.heure)
        $('heure-v').textContent = `${etat.heure}h`
        for (const [id, cle] of [['c-toits', 'toits'], ['c-aretes', 'aretes'], ['c-regions', 'regions'], ['c-grille', 'grille']] as const) {
          $<HTMLInputElement>(id).checked = etat.calques[cle]
        }
        choisir(m.kind, { force: true })
        const disque = versBrouillon(parserPlan(etat.textes.get(m.kind)!))
        if (JSON.stringify(m.brouillon) !== JSON.stringify(disque)) {
          etat.brouillon = m.brouillon
          $<HTMLInputElement>('usure').value = String(m.brouillon.usure)
          $<HTMLInputElement>('fixe').checked = m.brouillon.fixe
          message('brouillon NON SAUVÉ restauré après rechargement')
          rafraichir()
        } else if (sauve) message(`✓ ${sauve}.plan sauvé, module régénéré — la page a rechargé avec lui`)
        return
      }
    } catch { /* mémoire illisible : on repart du premier lieu */ }
  }
  choisir(kinds[0]!)
}

function choisir(kind: string, opts?: { force?: boolean }): void {
  // UN BROUILLON NON SAUVÉ NE SE JETTE PAS EN SILENCE (revue du 2026-08-10) — mais il reste
  // dans l'HISTORIQUE de son lieu : y revenir retrouve la pile d'annulation.
  if (!opts?.force && etat.brouillon && etat.kind && modifie()) {
    if (!window.confirm(`Des éditions non sauvées sur « ${etat.kind} » — les abandonner ?`)) {
      $<HTMLSelectElement>('lieux').value = etat.kind
      return
    }
  }
  etat.kind = kind
  $<HTMLSelectElement>('lieux').value = kind
  const texte = etat.textes.get(kind)!
  etat.brouillon = versBrouillon(parserPlan(texte))
  histoireDe(kind) //  la pile naît avec l'état du disque
  $<HTMLInputElement>('usure').value = String(etat.brouillon.usure)
  $<HTMLInputElement>('fixe').checked = etat.brouillon.fixe
  message(etat.brouillons.has(kind) ? 'BROUILLON hors-monde — la naissance passe par POI_TYPES + déplacer le fichier' : '')
  toutDeposer() //  la sélection et le collage ne voyagent pas d'un lieu à l'autre
  $('diff').style.display = 'none'
  $('historique').innerHTML = ''
  recadrer = true //  un NOUVEAU lieu se recadre ; une édition, jamais
  rafraichir()
}

/** Le texte à sauver : le .plan ORIGINAL patché chirurgicalement — la prose survit. */
function texteCourant(): string {
  return serialiserPlan(etat.textes.get(etat.kind)!, versPlan(etat.brouillon!))
}

async function sauver(): Promise<void> {
  const texte = texteCourant()
  try {
    const r = await fetch('/atelier/api/plans', {
      method: 'POST',
      // `x-atelier` force un PREFLIGHT : sans lui, n'importe quelle page visitée pendant que
      // `pnpm dev` tourne pouvait poster en « simple request » (revue du 2026-08-10).
      headers: { 'content-type': 'application/json', 'x-atelier': '1' },
      body: JSON.stringify({ kind: etat.kind, texte, ...(etat.brouillons.has(etat.kind) ? { brouillon: true } : {}) }),
    })
    const rep = (await r.json()) as { ok?: boolean; erreur?: string }
    if (!r.ok || !rep.ok) {
      // LE REFUS DU COMPILATEUR N'EST PAS UNE PANNE : il se montre TEL QUEL — le conseil
      // « lecture seule ? » sur une usure invalide envoyait corriger le mauvais problème.
      if (r.status === 422) { message(`✗ le compilateur refuse : ${rep.erreur ?? ''}`); return }
      throw new Error(rep.erreur ?? `HTTP ${r.status}`)
    }
    etat.textes.set(etat.kind, texte)
    sessionStorage.setItem('atelier-sauve', etat.kind)
    memoriser()
    message(`✓ ${etat.kind}.plan sauvé, module régénéré — le jeu en dev recharge tout seul`)
  } catch (e) {
    message(`✗ sauvegarde impossible (${(e as Error).message}) — dépôt en lecture seule (stack Docker) ? « Copier » puis colle dans packages/sim/src/plans/${etat.kind}.plan et lance pnpm plans`)
  }
}

// ── Le câblage des contrôles. ──
$<HTMLSelectElement>('lieux').addEventListener('change', (e) => choisir((e.target as HTMLSelectElement).value))
$<HTMLInputElement>('usure').addEventListener('change', (e) => {
  if (etat.brouillon) {
    etat.brouillon.usure = Number((e.target as HTMLInputElement).value)
    rafraichir()
    pousserHistoire()
  }
})
$<HTMLInputElement>('fixe').addEventListener('change', (e) => {
  if (etat.brouillon) {
    etat.brouillon.fixe = (e.target as HTMLInputElement).checked
    rafraichir()
    pousserHistoire()
  }
})
$<HTMLSelectElement>('sort').addEventListener('change', (e) => {
  etat.sort = (e.target as HTMLSelectElement).value as SortDuLieu
  rafraichir()
})
$<HTMLSelectElement>('quart').addEventListener('change', (e) => {
  etat.quart = Number((e.target as HTMLSelectElement).value)
  rafraichir()
})
$<HTMLInputElement>('dedans').addEventListener('change', (e) => {
  // L'avatar CHANGE DE PLACE (dedans/dehors) : on rebâtit — nappe et pans, les vraies
  // règles, décident alors seules de ce qui s'efface.
  etat.dedans = (e.target as HTMLInputElement).checked
  rafraichir()
})
$<HTMLInputElement>('heure').addEventListener('input', (e) => {
  etat.heure = Number((e.target as HTMLInputElement).value)
  $('heure-v').textContent = `${etat.heure}h`
  const sc = laScene()
  if (sc) sc.heure = etat.heure //  la lumière suit à la frame — pas besoin de rebâtir
  memoriser()
})
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="outil"]')) {
  radio.addEventListener('change', () => {
    etat.outil = radio.value as typeof etat.outil
  })
}
for (const [id, cle] of [['c-toits', 'toits'], ['c-aretes', 'aretes'], ['c-regions', 'regions'], ['c-grille', 'grille']] as const) {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    etat.calques[cle] = (e.target as HTMLInputElement).checked
    rafraichir()
  })
}
$<HTMLButtonElement>('annuler').addEventListener('click', () => restaurerHistoire(-1))
$<HTMLButtonElement>('refaire').addEventListener('click', () => restaurerHistoire(1))
$<HTMLButtonElement>('recadrer').addEventListener('click', () => laScene()?.recadrer())
$<HTMLButtonElement>('sauver').addEventListener('click', () => { void sauver() })
$<HTMLButtonElement>('copier').addEventListener('click', () => {
  void navigator.clipboard.writeText(texteCourant()).then(() => message('texte du .plan copié'))
})
// ── P-B : transformations et tampons. ──
$<HTMLButtonElement>('miroir-h').addEventListener('click', () => transformer(miroirH))
$<HTMLButtonElement>('miroir-v').addEventListener('click', () => transformer(miroirV))
$<HTMLButtonElement>('tourner-frag').addEventListener('click', () => transformer(tournerFragment))
$<HTMLButtonElement>('tampon-plus').addEventListener('click', () => {
  if (!etat.pressePapier && etat.selection) copierSelection()
  if (!etat.pressePapier) { message('rien à tamponner — sélectionne puis Ctrl+C'); return }
  const nom = window.prompt('Nom du tampon :')
  if (!nom) return
  const t = lireTampons()
  t[nom] = etat.pressePapier
  localStorage.setItem('atelier-tampons', JSON.stringify(t))
  construireTampons()
})
// ── P-C : la planche. ──
$<HTMLButtonElement>('planche-maj').addEventListener('click', () => rafraichirPlanche())
$<HTMLButtonElement>('exporter').addEventListener('click', () => { void exporterPlanche(etat.kind, jeu) })
// ── P-D : le diff, l'historique, tester en jeu. ──
$<HTMLButtonElement>('voir-diff').addEventListener('click', () => {
  const pre = $('diff')
  if (pre.style.display !== 'none') { pre.style.display = 'none'; return }
  montrerDiff(etat.textes.get(etat.kind) ?? '', texteCourant(), 'disque → brouillon')
})
$<HTMLButtonElement>('historique-maj').addEventListener('click', () => { void chargerHistorique() })
$<HTMLButtonElement>('tester').addEventListener('click', () => {
  // La Veillée dev s'ouvre TÉLÉPORTÉE au lieu (WorldScene lit `?atelier=`) — un brouillon
  // hors-monde n'y existe pas : on prévient au lieu d'ouvrir un onglet pour rien.
  if (etat.brouillons.has(etat.kind)) { message('un BROUILLON n’existe pas dans le monde — promeus-le d’abord (POI_TYPES)'); return }
  if (modifie()) message('⚠ éditions non sauvées : le jeu montrera la version du DISQUE')
  window.open(`/?solo&atelier=${etat.kind}`, '_blank')
})
// ── P-E : création et redimensionnement. ──
$<HTMLButtonElement>('nouveau').addEventListener('click', () => { void creerBrouillon(null) })
$<HTMLButtonElement>('dupliquer').addEventListener('click', () => { void creerBrouillon(etat.kind) })
for (const bouton of document.querySelectorAll<HTMLButtonElement>('[data-redim]')) {
  bouton.addEventListener('click', () => {
    const b = etat.brouillon
    if (!b) return
    redimensionner(b, bouton.dataset.redim as 'N' | 'S' | 'E' | 'O', Number(bouton.dataset.delta) as 1 | -1)
    toutDeposer() //  la sélection ne survit pas à un décalage de grille
    rafraichir()
    pousserHistoire()
  })
}

construirePalette()
construireTampons()
void charger().catch((e: Error) => message(`✗ chargement : ${e.message} — l'Atelier exige le serveur de dev (pnpm dev)`))

// LA SONDE DU SMOKE (A9) : l'état se LIT, et « peindre » passe par le même chemin que la
// souris — le harnais n'a pas de chemin privé. `peindre` clôt son trait (une entrée
// d'historique), comme un clic isolé.
declare global { interface Window { __ATELIER__?: unknown } }
window.__ATELIER__ = {
  pret: (): boolean => etat.brouillon !== undefined,
  /** Le RENDU est-il debout ? (le boot Phaser génère les textures avant la scène) */
  rendu: (): boolean => laScene() !== null,
  kinds: (): string[] => [...etat.textes.keys()].sort(),
  choisir,
  etat,
  peindre: (rx: number, ry: number, car: string): boolean => {
    const ok = peindreCase(rx, ry, car)
    if (ok) pousserHistoire()
    return ok
  },
  annuler: (): void => restaurerHistoire(-1),
  refaire: (): void => restaurerHistoire(1),
  texteCourant,
  /** Tuile de PLAN → pixels ÉCRAN du canvas (lecture seule) : le harnais pilote la VRAIE
   *  souris — sélection tirée, collage estampé — sans recopier la caméra. */
  ecran: (rx: number, ry: number): { x: number; y: number } | null => {
    const sc = laScene()
    if (!sc) return null
    const cam = sc.cameras.main
    return {
      x: ((rx + MARGE + 0.5) * 16 - cam.worldView.x) * cam.zoom,
      y: ((ry + MARGE + 0.5) * 16 - cam.worldView.y) * cam.zoom,
    }
  },
}
