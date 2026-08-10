/**
 * LES LIEUX BÂTIS — le monde se construit avec le vocabulaire du joueur (maquette).
 *
 * Un set-piece a pour corps son TERRAIN (`t0-exploration` R10 : le Bois Noir EST ses arbres).
 * Un lieu BÂTI a pour corps ses STRUCTURES : la Ferme ruinée EST ses murs. C'est le patron des
 * monuments de Rust — le monde n'est pas décoré, il est *construit*, avec les mêmes pièces que
 * celles qu'on tient en main. Un mur de ruine et un mur qu'on pose sont le même objet.
 *
 * ═══ CE QUE ÇA CHANGE, CONCRÈTEMENT ═══
 *
 * Le sprite peint est traversant : c'est un meuble. Des murs BLOQUENT — donc une ferme a un
 * dedans et un dehors, un seuil, un angle mort. Elle devient un lieu où l'on entre, où l'on se
 * met à couvert, où l'on peut se faire coincer.
 *
 * ═══ LE PLAN EST UNE GRILLE DE CARACTÈRES ═══
 *
 * Lisible d'un coup d'œil, et c'est le but : un plan qu'on ne peut pas LIRE est un plan qu'on
 * n'ose pas modifier. Une ligne = une rangée de tuiles, du nord au sud.
 *
 *     ·  rien          W  mur (pierre)        f  sol
 *     r  sol + toit    (le toit est une couche à part : il se superpose)
 *
 * ═══ PUR ET DÉTERMINISTE ═══
 *
 * Aucun tirage sur le PRNG partagé : l'orientation vient de `hash2` sur les coordonnées de la
 * zone (positionnel et salé), comme tout le worldgen. Même seed → mêmes murs, à la tuile près.
 */
import { hash2 } from './noise'
import { isBlockingTile } from './map'
import { NODE_DEFS, type NodeType } from './balance'
import { STRUCTURE_TYPES, piece } from './pieces'
import type { StructureType } from './items'
import type { SimState } from './sim'
import { addStructure } from './village'
import { SORT_DES_LIEUX, type SortDuLieu, sortDuLieu, usureSelonSort } from './sort-des-lieux'
import type { Plan } from './plan-format'
import { PLANS } from './plans-batis.genere'

/**
 * LE TYPE `Plan` ET SA GRAMMAIRE vivent dans `plan-format.ts` (spec `atelier-plans.md`) :
 * les plans s'écrivent en fichiers `.plan` (prose comprise) et arrivent ici par le module
 * GÉNÉRÉ. Ce module-ci reste le MOTEUR — la légende, les gardes, le poseur.
 */
export type { Plan } from './plan-format'

/**
 * LA LÉGENDE — un caractère, une tuile. Deux RÉGIONS (la salle, la cour), et du contenu.
 *
 * `·` (rien) n'y figure pas : c'est l'absence, et dans une ruine l'absence est la moitié du
 * sujet. Le contenu implique sa région : une table est forcément dans la salle.
 */
export interface Case { region?: 'salle' | 'cour'; piece?: StructureType; toit?: boolean; noeud?: NodeType }
/** EXPORTÉE pour l'Atelier (spec `atelier-plans.md` A6) : la palette de l'éditeur se DÉRIVE
 *  d'elle — jamais une liste recopiée qui divergerait en silence. */
export const LEGENDE: Record<string, Case> = {
  '.': { region: 'salle' }, //                      le dallage
  // UN SEUL `:` COUVRE TOUTE LA SALLE (calage du 2026-08-10) : la couverture est une affaire
  // de PLAN, pas de case — une salle ne se couvre pas à moitié autour de son mobilier. Mesuré
  // au navigateur avant la règle : la paillasse et le coffre PERÇAIENT le chaume (2 trous sur
  // la cabane, 1 sur l'abri, smoke `toits`). Le toit se superpose au composant — c'est la
  // règle du jeu (construction : « entièrement toité, l'enclume comprise »).
  ':': { region: 'salle', toit: true }, //          le dallage, encore couvert
  ',': { region: 'cour' }, //                       l'enclos, plein air
  A: { region: 'salle', piece: 'atre' },
  T: { region: 'salle', piece: 'table' },
  b: { region: 'salle', piece: 'banc' },
  L: { region: 'salle', piece: 'paillasse' },
  E: { region: 'salle', piece: 'etagere' },
  o: { region: 'salle', piece: 'tonneau' },
  K: { region: 'salle', piece: 'chest' },
  P: { region: 'salle', piece: 'poutre' },
  M: { region: 'cour', piece: 'meule' },
  a: { region: 'cour', piece: 'abreuvoir' },
  // LES GRAVATS NE SONT PAS UNE PIÈCE (artefact §2) : le nœud `rubble` existe déjà — rendement
  // `components`, pioche `basic` minimum. Fouiller la ruine réutilise le verbe minage, sans une
  // ligne neuve. C'est aussi le seul contenu du plan qu'on EMPORTE : le reste se regarde.
  g: { region: 'cour', noeud: 'rubble' },
  x: { piece: 'friche' }, //                        le champ retourné au sauvage, hors région
  // ── HORS RÉGION (étage 1, spec lieux-batis) — les pièces éparses des petits lieux ──
  // Pas de salle, pas de cour : AUCUN mur ne se dérive de ces cases (le précédent est `x`).
  // Convention : la minuscule est la variante hors-salle d'un caractère que la salle connaît
  // déjà (p/P, l/L), et `G` est le gravats hors cour (le `g` de la cour tirerait une clôture).
  C: { piece: 'charrette' }, //   échouée là où on l'a laissée (la Charrette, l'Épave)
  U: { piece: 'autel' }, //       la pierre dressée d'un oratoire — debout, elle
  m: { piece: 'mur_bas' }, //     le pan écroulé : on l'enjambe, il raconte l'enclos
  p: { piece: 'poutre' }, //      la poutre tombée hors salle (P : la même, en salle)
  l: { piece: 'paillasse' }, //   le couchage à la belle étoile (L : en salle)
  F: { piece: 'atre' }, //        le feu froid d'un camp (A : l'âtre en salle)
  t: { piece: 'tonneau' }, //     le tonneau abandonné dehors (o : en salle)
  G: { noeud: 'rubble' }, //      les gravats hors cour — la fouille des petits lieux
}

/**
 * LA RÉGION D'UN CARACTÈRE — exportée pour que les gardes LISENT la légende au lieu de la
 * recopier. Une garde qui recopie sa référence ne garde plus la référence : elle garde sa copie,
 * et se tait le jour où les deux divergent.
 */
export const regionDe = (c: string): 'salle' | 'cour' | undefined => LEGENDE[c]?.region

/** La barrière que porte le pourtour de chaque région. */
const CLOTURE_DE: Record<'salle' | 'cour', StructureType> = { salle: 'wall', cour: 'cloture' }

/**
 * LES PLANS habitent « packages/sim/src/plans/<kind>.plan » — leur prose comprise — et
 * arrivent ici par le module GÉNÉRÉ (`pnpm plans`, gardé par `plans-batis.test.ts`).
 */
export { PLANS }

/** Les kinds qui ont un plan — le client y lit quels lieux n'ont PAS de sprite de corps. */
export const BUILT_KINDS: readonly string[] = Object.keys(PLANS)

/**
 * CE QUI VIEILLIT. Un mur, une table, un âtre portent leur usure dans leurs PV — le client
 * les assombrit d'autant, et la ruine se voit. Une meule de foin ou un carré de friche,
 * non : « à 30 % de PV » n'y veut rien dire, et les assombrir les rendrait juste sales.
 */
const USURABLE = new Set<StructureType>(STRUCTURE_TYPES.filter((t) => piece(t).usurable))

/**
 * LE PLAN EST CARRÉ, ET SON CÔTÉ EST L'EMPREINTE DU LIEU.
 *
 * Sans cette garde, un plan trop large déborde de la Zone qui le nomme, qui le dégage de sa
 * végétation et qui interdit d'y fonder — et le bâti se retrouverait à cheval sur une sente
 * ou sur son voisin. C'est une erreur qu'on ne verrait qu'en jeu, sur une seed particulière ;
 * elle doit tomber au démarrage, sur toutes.
 */
export function verifierPlans(footprintDe: (kind: string) => number | undefined): string[] {
  const fautes: string[] = []
  for (const [kind, plan] of Object.entries(PLANS)) {
    const n = plan.grille.length
    const fp = footprintDe(kind)
    if (fp !== undefined && fp !== n) fautes.push(`${kind} : plan ${n}×${n}, empreinte ${fp}`)
    for (const [i, row] of plan.grille.entries()) {
      if (row.length !== n) fautes.push(`${kind} : rangée ${i} fait ${row.length} caractères, pas ${n}`)
      for (const [j, c] of [...row].entries()) {
        if (c !== '·' && LEGENDE[c] === undefined) fautes.push(`${kind} : caractère inconnu « ${c} »`)
        // UNE RÉGION NE TOUCHE JAMAIS LE BORD DU PLAN : ses murs se posent sur la tuile
        // EXTÉRIEURE — au bord, ils tomberaient hors de la Zone qui dégage et protège le lieu.
        if (LEGENDE[c]?.region !== undefined && (i === 0 || j === 0 || i === n - 1 || j === n - 1)) {
          fautes.push(`${kind} : la région en (${j},${i}) touche le bord — ses murs déborderaient du plan`)
        }
      }
    }
    // LES EXCEPTIONS DU CONTOUR DOIVENT DÉSIGNER UNE VRAIE ARÊTE. Une brèche sur une tuile qui
    // n'est pas une région, ou vers un voisin de la même région, ne percerait RIEN — et le
    // silence serait total : le bâtiment naîtrait fermé sans qu'on sache pourquoi.
    const regionAt = (x: number, y: number): string | undefined =>
      (x < 0 || y < 0 || x >= n || y >= n ? undefined : LEGENDE[plan.grille[y]![x]!]?.region)
    const OFF: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], O: [-1, 0] }
    for (const [nom, liste] of [['brèche', plan.breches], ['seuil', plan.seuils], ['passage', plan.passages]] as const) {
      for (const k of liste ?? []) {
        const [sx, sy, d] = k.split(',')
        const x = Number(sx)
        const y = Number(sy)
        const off = OFF[d ?? '']
        if (off === undefined) { fautes.push(`${kind} : ${nom} « ${k} » — direction inconnue`); continue }
        const reg = regionAt(x, y)
        if (reg === undefined) { fautes.push(`${kind} : ${nom} « ${k} » — (${x},${y}) n'est pas une région`); continue }
        if (regionAt(x + off[0], y + off[1]) === reg) fautes.push(`${kind} : ${nom} « ${k} » — ne perce aucun contour`)
      }
    }
  }
  return fautes
}

function rotate(plan: readonly string[], n: number): string[] {
  let g = plan.map((row) => row.split(''))
  for (let k = 0; k < n; k++) {
    const size = g.length
    const next: string[][] = []
    for (let y = 0; y < size; y++) {
      const row: string[] = []
      for (let x = 0; x < size; x++) row.push(g[size - 1 - x]![y]!)
      next.push(row)
    }
    g = next
  }
  return g.map((row) => row.join(''))
}

/**
 * BÂTIT LES LIEUX (appelée à l'amorce, après `createSim` — comme `spawnPoiMonsters`).
 *
 * L'ordre de parcours est celui de `map.zones`, donc l'ordre de `placePois`, donc déterministe.
 * Les nœuds sous l'empreinte sont retirés : on ne fait pas pousser un buisson dans un mur (le
 * worldgen a le droit de faire place nette — c'est déjà ce que fait `foundNpcVillage`).
 */
const N_BIT = 1, E_BIT = 2, S_BIT = 4, O_BIT = 8
const DIRS: readonly [string, number, number, number, number][] = [
  // [nom, dx, dy, bit chez le VOISIN (qui porte le mur), bit chez la région]
  ['N', 0, -1, S_BIT, N_BIT],
  ['E', 1, 0, O_BIT, E_BIT],
  ['S', 0, 1, N_BIT, S_BIT],
  ['O', -1, 0, E_BIT, O_BIT],
]

/**
 * BÂTIT LES LIEUX (appelée à l'amorce, après `createSim` — comme `spawnPoiMonsters`).
 *
 * ═══ LES MURS SE DÉRIVENT DU POURTOUR, ET SE POSENT DEHORS ═══
 *
 * Pour chaque arête du contour d'une région, on pose la barrière **sur la tuile extérieure**,
 * avec le bit qui regarde la région (décision d'Alexis). Deux conséquences directes :
 *   • la salle garde 100 % de son dallage — ses tuiles ne portent AUCUNE bande de collision ;
 *   • un angle est un mur à DEUX arêtes, sur une seule structure : `structureAt` survit.
 *
 * Et une règle qui tombe d'elle-même : **on ne clôture pas contre son propre mur**. Là où la
 * cour touche la salle, c'est le mur de la salle qui ferme — poser en plus une clôture y
 * collerait deux barrières dos à dos.
 *
 * L'ordre de parcours est celui de `map.zones`, donc celui de `placePois`, donc déterministe.
 */
export function buildPoiStructures(state: SimState, seed: number): void {
  const map = state.map
  for (const z of map.zones) {
    if (z.kind === undefined) continue
    const plan = PLANS[z.kind]
    if (plan === undefined) continue

    // LE SORT DU LIEU (spec stratigraphie S-R17) : brûlé, pillé ou intact — dérivé de la carte,
    // le MÊME verdict que celui du toponyme (`placeOne` nomme d'après lui). Il module l'usure,
    // le mobilier et la fouille ; le plan, lui, ne bouge pas.
    const sort = sortDuLieu(map, z.x, z.y, z.w, z.h)

    // L'ORIENTATION, tirée de la position — positionnelle et salée, jamais du PRNG partagé.
    // Sauf pour un plan `fixe`, qui se pose dans le sens où il est écrit (cf. `Plan.fixe`).
    const quart = plan.fixe ? 0 : Math.min(3, Math.floor(hash2(z.x, z.y, seed ^ 0x42415449) * 4)) // 'BATI'

    batirLieu(state, plan, z.x, z.y, sort, quart)
  }
}

/**
 * BÂTIR UN LIEU — le corps du poseur, extrait pour l'Atelier (spec `atelier-plans.md` A4/A7) :
 * l'éditeur l'appelle avec le plan EN COURS D'ÉDITION, dans un SimState d'aperçu — le même
 * moteur, jamais une réimplémentation. `sort` et `quart` sont DÉCIDÉS par l'appelant
 * (`buildPoiStructures` les dérive de la carte ; l'Atelier les fait basculer à la main).
 */
export function batirLieu(state: SimState, plan: Plan, x0: number, y0: number, sort: SortDuLieu, quart: number): void {
    const map = state.map
    const usure = usureSelonSort(plan.usure, sort)
    const g = rotate(plan.grille, quart)
    const n = g.length

    // PLACE NETTE sous le bâti (le worldgen a le droit — cf. `foundNpcVillage`).
    state.nodes = state.nodes.filter((nd) => nd.tx < x0 || nd.tx >= x0 + n || nd.ty < y0 || nd.ty >= y0 + n)

    const caseAt = (rx: number, ry: number): Case =>
      (rx < 0 || ry < 0 || rx >= n || ry >= n ? {} : (LEGENDE[g[ry]![rx]!] ?? {}))
    const region = (rx: number, ry: number): 'salle' | 'cour' | undefined => caseAt(rx, ry).region
    const libre = (tx: number, ty: number): boolean =>
      tx >= 0 && ty >= 0 && tx < map.width && ty < map.height && !isBlockingTile(map, tx, ty)

    // Les exceptions du contour, tournées avec le plan : une brèche déclarée au nord d'une
    // tuile reste au nord de CETTE tuile, quel que soit le quart de tour du bâtiment.
    const tournee = (k: string): string => {
      const [rx, ry, d] = [Number(k.split(',')[0]), Number(k.split(',')[1]), k.split(',')[2]!]
      let x = rx, y = ry, dir = d
      for (let i = 0; i < quart; i++) {
        const nx = n - 1 - y
        const ny = x
        x = nx; y = ny
        dir = { N: 'E', E: 'S', S: 'O', O: 'N' }[dir as 'N']!
      }
      return `${x},${y},${dir}`
    }
    const breches = new Set((plan.breches ?? []).map(tournee))
    const seuils = new Set((plan.seuils ?? []).map(tournee))
    const passages = new Set((plan.passages ?? []).map(tournee))

    // LA SALLE EST-ELLE COUVERTE ? Un seul `:` dans la grille le dit (cf. LEGENDE) : chaque
    // case de la salle portera alors son toit, le mobilier compris. `.` seul = à ciel ouvert.
    const couverte = plan.grille.some((ligne) => ligne.includes(':'))

    // ── 1. LE SOL ET LE CONTENU ──
    for (let ry = 0; ry < n; ry++) {
      for (let rx = 0; rx < n; rx++) {
        const c = caseAt(rx, ry)
        const tx = x0 + rx
        const ty = y0 + ry
        if (!libre(tx, ty)) continue // on ne bâtit pas dans une falaise ni dans l'eau
        // CHAQUE RÉGION A SON SOL, et c'est ce qui la fait lire comme une PIÈCE : le dallage
        // pour la salle, la terre battue pour la cour. Sans sol, un enclos n'était qu'une
        // clôture posée dans l'herbe.
        if (c.region === 'salle') poser(state, 'floor', tx, ty, usure)
        else if (c.region === 'cour') poser(state, 'terre', tx, ty, usure)
        // LE FEU A PRIS LE TOIT ET LE MOBILIER : un lieu brûlé ne garde que la pierre — l'âtre
        // debout au milieu des murs calcinés, l'image même de la ferme incendiée. Les pillards,
        // eux, n'emportent que les CONTENANTS (coffre, tonneau, étagère) : le reste se regarde.
        if ((c.toit || (couverte && c.region === 'salle')) && sort !== 'brule') poser(state, 'roof', tx, ty, usure)
        if (c.piece && !pieceRetiree(c.piece, sort)) poser(state, c.piece, tx, ty, usure)
        // Le nœud vient APRÈS le sol : il se pose SUR la terre battue, il ne la remplace pas.
        if (c.noeud) semer(state, c.noeud, tx, ty, sort)
      }
    }

    // ── 2. LES BARRIÈRES, DÉRIVÉES DU POURTOUR ──
    // On accumule les bits PAR TUILE EXTÉRIEURE avant de poser : un angle est un mur à deux
    // arêtes, pas deux murs qui se disputent la même tuile.
    const aretes = new Map<number, { tx: number; ty: number; type: StructureType; bits: number }>()
    for (let ry = 0; ry < n; ry++) {
      for (let rx = 0; rx < n; rx++) {
        const reg = region(rx, ry)
        if (reg === undefined) continue
        for (const [d, dx, dy, bitVoisin] of DIRS) {
          const voisine = region(rx + dx, ry + dy)
          if (voisine === reg) continue //                     même pièce : rien à fermer
          // ON NE CLÔTURE PAS CONTRE SON PROPRE MUR : là où la cour touche la salle, c'est le
          // mur de la salle qui ferme. Sans ça, deux barrières dos à dos.
          if (reg === 'cour' && voisine === 'salle') continue
          const k = `${rx},${ry},${d}`
          if (breches.has(k) || passages.has(k)) continue //   le contour est percé ici
          const tx = x0 + rx + dx
          const ty = y0 + ry + dy
          if (!libre(tx, ty)) continue
          const type = seuils.has(k) ? 'encadrement' : CLOTURE_DE[reg]
          const i = ty * map.width + tx
          const dejaLa = aretes.get(i)
          // Un ENCADREMENT ne fusionne pas avec un mur : c'est une pièce à part, et la seule
          // du contour qui laisse passer. Il gagne sur l'arête qu'il occupe.
          if (dejaLa && dejaLa.type === type) dejaLa.bits |= bitVoisin
          else if (dejaLa && type === 'encadrement') aretes.set(i, { tx, ty, type, bits: bitVoisin })
          else if (!dejaLa) aretes.set(i, { tx, ty, type, bits: bitVoisin })
        }
      }
    }
    for (const a of [...aretes.values()].sort((p1, p2) => (p1.ty - p2.ty) || (p1.tx - p2.tx))) {
      const s = a.type === 'wall'
        ? addStructure(state, 'wall', a.tx, a.ty, 0, 0, 'public', 'stone')
        : addStructure(state, a.type, a.tx, a.ty, 0, 0, 'public')
      s.edges = a.bits
      if (USURABLE.has(a.type)) s.hp = Math.max(1, Math.floor(s.hp * usure))
    }
}

/**
 * CE QUE LE SORT RETIRE DU PLAN. Le feu ne laisse que la pierre — l'âtre, l'autel, le mur
 * bas ; les pillards n'emportent que ce qui se porte et se vide — les contenants. L'oubli
 * ne retire rien.
 */
const SURVIT_AU_FEU = new Set<StructureType>(['atre', 'autel', 'mur_bas'])
function pieceRetiree(type: StructureType, sort: SortDuLieu): boolean {
  if (sort === 'brule') return !SURVIT_AU_FEU.has(type)
  if (sort === 'pille') return type === 'chest' || type === 'tonneau' || type === 'etagere'
  return false
}

/** Pose une pièce du monde : sans village, publique, et usée si elle peut l'être. */
/**
 * SEMER UN NŒUD — un identifiant au-dessus de tous les autres, pour ne jamais en écraser un.
 * Le bâti passe après la génération de contenu, qui a déjà distribué ses propres identifiants ;
 * un compteur reparti de zéro ferait deux nœuds avec le même id, et le premier ramassage
 * viderait les deux.
 */
function semer(state: SimState, type: NodeType, tx: number, ty: number, sort: SortDuLieu): void {
  let id = 1
  for (const nd of state.nodes) if (nd.id >= id) id = nd.id + 1
  // LE SORT PORTE LE COMBIEN, JAMAIS LE SI (spec stratigraphie S-R18) : une ruine pillée garde
  // un fond de fouille (plancher à 1), une ruine intacte garde TOUT — la règle de lecture
  // « loin des routes = riche » que le joueur peut apprendre, puis transmettre.
  const base = NODE_DEFS[type].stock
  const stock = sort === 'pille'
    ? Math.max(1, Math.floor(base * SORT_DES_LIEUX.STOCK_PILLE))
    : sort === 'intact' ? base * SORT_DES_LIEUX.STOCK_INTACT : base
  state.nodes.push({ id, type, tx, ty, stock, regrowAt: 0 })
}

function poser(state: SimState, type: StructureType, tx: number, ty: number, usure: number): void {
  const s = addStructure(state, type, tx, ty, 0, 0, 'public')
  if (USURABLE.has(type)) s.hp = Math.max(1, Math.floor(s.hp * usure))
}
