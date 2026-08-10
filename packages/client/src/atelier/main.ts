/**
 * L'ATELIER DES PLANS — l'éditeur graphique du bâti (spec `atelier-plans.md`, décisions
 * d'Alexis du 2026-08-10 : P2, page autonome sans Phaser).
 *
 * LE PRINCIPE QUI NE SE NÉGOCIE PAS (A7) : l'éditeur ne dérive rien. Chaque édition rebâtit
 * le lieu par le VRAI moteur — `/sim` est pur, il tourne ici même : `createSim` +
 * `batirLieu` sur une carte d'essai, et l'aperçu ne fait que PEINDRE ces structures
 * (`apercu.ts`, albédos réels de `bati-art`). La validation est la même loi que la suite
 * (`verifierPlan`), la traversabilité passe par `crossingBlocker`/`structureBlocks` — les
 * fonctions du jeu, jamais une copie.
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
import {
  BUILT_KINDS, LEGENDE, POI_TYPES, TERRAIN_GRASS, batirLieu, createEmptyMap, createSim,
  crossingBlocker, parserPlan, serialiserPlan, structureBlocks, verifierPlan,
} from '@ashes/sim'
import type { Plan, SimState, SortDuLieu } from '@ashes/sim'
import { composerApercu, vignette } from './apercu'

/** La marge d'herbe autour du plan sur la carte d'essai — les murs du pourtour vivent sur
 *  la tuile EXTÉRIEURE, il leur faut au moins une rangée, et l'œil respire avec deux. */
const MARGE = 2
const T = 16

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
  montrerToits: true,
  outil: 'peindre' as 'peindre' | 'breche' | 'seuil' | 'passage',
  car: '.',
  fautes: [] as string[],
  manquantes: [] as string[],
}

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

/** LE VRAI MOTEUR, dans la page : la carte d'essai, la sim, le poseur — rien d'autre. */
function batir(plan: Plan, sort: SortDuLieu, quart: number): SimState {
  const cote = plan.grille.length + 2 * MARGE
  const map = createEmptyMap(cote, cote, TERRAIN_GRASS)
  const sim = createSim(7, { map })
  batirLieu(sim, plan, MARGE, MARGE, sort, quart)
  return sim
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

const scene = $<HTMLCanvasElement>('scene')

/**
 * LE BROUILLON SURVIT AU RECHARGEMENT (revue du 2026-08-10) : chaque sauvegarde régénère
 * `plans-batis.genere.ts`, qui vit dans `/sim` — et le plugin de full-reload recharge alors
 * TOUTES les pages, l'Atelier compris (c'est voulu pour le jeu, subi ici). Sans ce filet,
 * vingt minutes d'édition partaient au premier `balance.ts` touché dans un autre onglet.
 */
function memoriser(): void {
  sessionStorage.setItem('atelier', JSON.stringify({
    kind: etat.kind, brouillon: etat.brouillon, sort: etat.sort, quart: etat.quart, montrerToits: etat.montrerToits,
  }))
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
    const sim = batir(plan, etat.sort, etat.quart)
    const apercu = composerApercu(scene, sim.structures, sim.nodes, sim.map.width, etat.montrerToits)
    etat.manquantes = [...apercu.manquantes]
    enfermees = tuilesEnfermees(sim)
    const echelle = Math.max(2, Math.min(5, Math.floor(880 / scene.width)))
    scene.style.width = `${scene.width * echelle}px`
    scene.style.height = `${scene.height * echelle}px`
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
  $('manquantes').textContent = etat.manquantes.length ? etat.manquantes.join(' · ') : 'rien — tout l’aperçu est en vrai albédo'
  // Une faute BLOQUE la sauvegarde (A8) — l'enfermement avertit, il ne bloque pas : une
  // ruine scellée est peut-être voulue un jour, la garde de la suite tranchera.
  $<HTMLButtonElement>('sauver').disabled = !valide
}

function message(texte: string): void {
  $('etat').textContent = texte
}

// ── LA PALETTE, DÉRIVÉE DE LA LÉGENDE (A6) — l'effaceur d'abord, puis chaque caractère. ──
function construirePalette(): void {
  const palette = $('palette')
  palette.innerHTML = ''
  const entrees: [string, { piece?: string; noeud?: string; region?: string }][] =
    [['·', {}], ...Object.entries(LEGENDE)]
  for (const [car, def] of entrees) {
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
    tuile.addEventListener('click', () => {
      etat.car = car
      construirePalette()
    })
    palette.appendChild(tuile)
  }
}

// ── LES CLICS SUR LA SCÈNE : peinture par palette, arêtes au plus près (le tri des quatre
//    distances — le patron de la visée du jeu). ──
/** PEINDRE UNE CASE — LE chemin, unique : la souris ET la sonde du smoke passent ici
 *  (mêmes bornes, même garde d'orientation — la promesse « pas de chemin privé » tenue). */
function peindreCase(rx: number, ry: number, car: string): boolean {
  const b = etat.brouillon
  if (!b) return false
  if (etat.quart !== 0) {
    message('l’édition se fait en orientation 0 — repasse quart à 0')
    return false
  }
  const n = b.grille.length
  if (rx < 0 || ry < 0 || rx >= n || ry >= n) return false
  const rangee = [...b.grille[ry]!]
  rangee[rx] = car
  b.grille[ry] = rangee.join('')
  rafraichir()
  return true
}

scene.addEventListener('mousedown', (e) => {
  const b = etat.brouillon
  if (!b) return
  if (etat.quart !== 0) {
    message('l’édition se fait en orientation 0 — repasse quart à 0')
    return
  }
  const cadre = scene.getBoundingClientRect()
  const fx = ((e.clientX - cadre.left) / cadre.width) * (scene.width / T) - MARGE
  const fy = ((e.clientY - cadre.top) / cadre.height) * (scene.height / T) - MARGE
  const rx = Math.floor(fx)
  const ry = Math.floor(fy)
  const n = b.grille.length
  if (rx < 0 || ry < 0 || rx >= n || ry >= n) return
  if (etat.outil === 'peindre') {
    peindreCase(rx, ry, etat.car)
    return
  }
  {
    const u = fx - rx
    const v = fy - ry
    const dir = [
      { d: 'N', dist: v }, { d: 'E', dist: 1 - u }, { d: 'S', dist: 1 - v }, { d: 'O', dist: u },
    ].sort((p, q) => p.dist - q.dist)[0]!.d
    const triplet = `${rx},${ry},${dir}`
    const liste = b[etat.outil === 'breche' ? 'breches' : etat.outil === 'seuil' ? 'seuils' : 'passages']
    const i = liste.indexOf(triplet)
    if (i >= 0) liste.splice(i, 1)
    else liste.push(triplet)
  }
  rafraichir()
})

// ── CHARGEMENT : les .plan par l'endpoint dev (la PROSE arrive avec — c'est elle que la
//    sauvegarde chirurgicale préserve). ──
async function charger(): Promise<void> {
  const r = await fetch('/atelier/api/plans')
  if (!r.ok) throw new Error(`endpoint plans : ${r.status}`)
  const data = (await r.json()) as { kind: string; texte: string }[]
  for (const { kind, texte } of data) etat.textes.set(kind, texte)
  const kinds = [...etat.textes.keys()].sort()
  const absents = BUILT_KINDS.filter((k) => !etat.textes.has(k))
  if (absents.length) message(`⚠ module généré en avance sur les .plan : ${absents.join(', ')}`)
  const select = $<HTMLSelectElement>('lieux')
  select.innerHTML = ''
  for (const k of kinds) {
    const opt = document.createElement('option')
    opt.value = k
    opt.textContent = k
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
      const m = JSON.parse(memoire) as { kind: string; brouillon: Brouillon; sort: SortDuLieu; quart: number; montrerToits: boolean }
      if (etat.textes.has(m.kind)) {
        etat.sort = m.sort
        etat.quart = m.quart
        etat.montrerToits = m.montrerToits
        $<HTMLSelectElement>('sort').value = m.sort
        $<HTMLSelectElement>('quart').value = String(m.quart)
        $<HTMLInputElement>('toits').checked = m.montrerToits
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
  // UN BROUILLON NON SAUVÉ NE SE JETTE PAS EN SILENCE (revue du 2026-08-10).
  if (!opts?.force && etat.brouillon && etat.kind && texteCourant() !== etat.textes.get(etat.kind)) {
    if (!window.confirm(`Des éditions non sauvées sur « ${etat.kind} » — les abandonner ?`)) {
      $<HTMLSelectElement>('lieux').value = etat.kind
      return
    }
  }
  etat.kind = kind
  $<HTMLSelectElement>('lieux').value = kind
  const texte = etat.textes.get(kind)!
  etat.brouillon = versBrouillon(parserPlan(texte))
  $<HTMLInputElement>('usure').value = String(etat.brouillon.usure)
  $<HTMLInputElement>('fixe').checked = etat.brouillon.fixe
  message('')
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
      body: JSON.stringify({ kind: etat.kind, texte }),
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
  if (etat.brouillon) { etat.brouillon.usure = Number((e.target as HTMLInputElement).value); rafraichir() }
})
$<HTMLInputElement>('fixe').addEventListener('change', (e) => {
  if (etat.brouillon) { etat.brouillon.fixe = (e.target as HTMLInputElement).checked; rafraichir() }
})
$<HTMLSelectElement>('sort').addEventListener('change', (e) => {
  etat.sort = (e.target as HTMLSelectElement).value as SortDuLieu
  rafraichir()
})
$<HTMLSelectElement>('quart').addEventListener('change', (e) => {
  etat.quart = Number((e.target as HTMLSelectElement).value)
  rafraichir()
})
$<HTMLInputElement>('toits').addEventListener('change', (e) => {
  etat.montrerToits = (e.target as HTMLInputElement).checked
  rafraichir()
})
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="outil"]')) {
  radio.addEventListener('change', () => {
    etat.outil = radio.value as typeof etat.outil
  })
}
$<HTMLButtonElement>('sauver').addEventListener('click', () => { void sauver() })
$<HTMLButtonElement>('copier').addEventListener('click', () => {
  void navigator.clipboard.writeText(texteCourant()).then(() => message('texte du .plan copié'))
})

construirePalette()
void charger().catch((e: Error) => message(`✗ chargement : ${e.message} — l'Atelier exige le serveur de dev (pnpm dev)`))

// LA SONDE DU SMOKE (A9) : l'état se LIT, et « peindre » passe par le même chemin que la
// souris (la grille du brouillon + rafraichir) — le harnais n'a pas de chemin privé.
declare global { interface Window { __ATELIER__?: unknown } }
window.__ATELIER__ = {
  pret: (): boolean => etat.brouillon !== undefined,
  kinds: (): string[] => [...etat.textes.keys()].sort(),
  choisir,
  etat,
  peindre: peindreCase,
  texteCourant,
}
