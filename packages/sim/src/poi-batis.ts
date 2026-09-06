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
import { isBlockingTile, isWater } from './map'
import { fondDuLieu, terrainAEtage } from './etages'
import { NODE_DEFS, type NodeType } from './balance'
import { STRUCTURE_TYPES, piece } from './pieces'
import type { StructureType } from './items'
import type { SimState } from './sim'
import { addStructure } from './village'
import { SORT_DES_LIEUX, type SortDuLieu, sortDuLieu, usureSelonSort } from './sort-des-lieux'
import type { Plan } from './plan-format'
import { PLANS, VIGNETTES } from './plans-batis.genere'

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
export interface Case { region?: 'salle' | 'cour' | 'antre'; piece?: StructureType; toit?: boolean; noeud?: NodeType }
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
  // ── ÉTAGE 2 — LE VOCABULAIRE NATUREL (spec lieux-batis, décision d'Alexis 2026-08-10) ──
  // (`#` n'entrera JAMAIS ici : il ouvre un commentaire `.plan` — une rangée qui commence
  // par lui disparaîtrait au parse. Gardé par `plans-batis.test.ts`.)
  r: { region: 'antre' }, //      la poche minérale À CIEL OUVERT : sol roc — sa clôture se PEINT en massif
  // LE MASSIF (révision du 2026-08-11, décision d'Alexis : « de vraies parois rocheuses,
  // épaisses et non traversables sur au moins une tuile complète ») : la roche en masse,
  // pleine-tuile et INCASSABLE — l'épaisseur qui clôt un antre. Jamais dérivé : il se peint,
  // et la garde de clôture (verifierPlan) exige qu'il ceigne tout pourtour d'antre.
  H: { piece: 'massif' },
  R: { piece: 'rocher' }, //      le bloc erratique de poche — il bloque, on le contourne
  e: { piece: 'eboulis' }, //     les pierres croulées — plein-tuile bas, on l'enjambe
  Y: { noeud: 'tree' }, //        un VRAI arbre récoltable, semé par le plan (jamais du décor)
  B: { noeud: 'berry_bush' }, //  un vrai buisson à baies — le sort module son stock (patron g/G)
  // ── ÉTAGE 3 (REVU : « tout en pièces, partout ») — LE VOCABULAIRE MINIER ──
  // Plus de corps-sprite : un lieu se COMPOSE, la mine la première. (`#` interdit ;
  // jamais les minuscules `s`/`i` — garde d'épellation ; un seul code-unit UTF-16.)
  D: { piece: 'chevalement' }, //  la tour du puits — le Derrick qui dit « mine » de loin
  n: { piece: 'galerie' }, //      la bouche boisée — le porche en n, on le franchit
  I: { piece: 'etai' }, //         le poteau de boisage, droit comme un I
  w: { piece: 'wagonnet' }, //     la berline échouée — le double-u de ses deux essieux
}

/**
 * LA RÉGION D'UN CARACTÈRE — exportée pour que les gardes LISENT la légende au lieu de la
 * recopier. Une garde qui recopie sa référence ne garde plus la référence : elle garde sa copie,
 * et se tait le jour où les deux divergent.
 */
export const regionDe = (c: string): 'salle' | 'cour' | 'antre' | undefined => LEGENDE[c]?.region

/** La barrière que porte le pourtour de chaque région. L'ANTRE n'y est plus (révision du
 *  2026-08-11) : sa clôture ne se dérive pas, elle se PEINT en massif — la roche n'est pas
 *  un mur qu'on tire au cordeau, c'est une masse que le plan dessine. */
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
  for (const [kind, plan] of Object.entries(PLANS)) fautes.push(...verifierPlan(kind, plan, footprintDe(kind)))
  return fautes
}

/**
 * LA GARDE D'UN SEUL PLAN — extraite pour l'Atelier (spec `atelier-plans.md` A8) : l'éditeur
 * la fait tourner sur le plan EN COURS D'ÉDITION, à chaque frappe — la même loi que la suite,
 * jamais une copie.
 */
export function verifierPlan(kind: string, plan: Plan, fp: number | undefined): string[] {
  const fautes: string[] = []
  // UN LIEU N'A PAS D'ANCRE : l'ancre est le mot des vignettes (G-R6), et un plan ancré posé
  // comme un lieu ignorerait sa clé en silence — la faute le dit.
  if (plan.ancre !== undefined) fautes.push(`${kind} : « ancre » — un lieu n'a pas d'ancre (c'est une vignette : plans/vignettes/)`)
  {
    const n = plan.grille.length
    if (fp !== undefined && fp !== n) fautes.push(`${kind} : plan ${n}×${n}, empreinte ${fp}`)
    for (const [i, row] of plan.grille.entries()) {
      if (row.length !== n) fautes.push(`${kind} : rangée ${i} fait ${row.length} caractères, pas ${n}`)
      for (const [j, c] of [...row].entries()) {
        // « # » ne sera JAMAIS un caractère de grille : il ouvre un commentaire `.plan` — une
        // rangée qui commence par lui disparaît au parse, avant même d'arriver ici.
        if (c === '#') fautes.push(`${kind} : « # » en grille — il ouvre un commentaire .plan (interdit, étage 2)`)
        else if (c !== '·' && LEGENDE[c] === undefined) fautes.push(`${kind} : caractère inconnu « ${c} »`)
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
        // LA ROCHE NE S'ÉCROULE PAS EN PAN ET NE PORTE PAS D'ENCADREMENT (2026-08-11) : sur
        // un antre, seule la GUEULE (`passage`) a un sens — brèche et seuil sont des mots de
        // maçonnerie, et les accepter bâtirait un contour que le poseur ne sait plus dériver.
        if (reg === 'antre' && nom !== 'passage') { fautes.push(`${kind} : ${nom} « ${k} » — pas de ${nom} sur un antre (la roche ne connaît que le passage)`); continue }
        if (regionAt(x + off[0], y + off[1]) === reg) { fautes.push(`${kind} : ${nom} « ${k} » — ne perce aucun contour`); continue }
        // LE TRIPLET CÔTÉ COUR D'UN MUR DE SALLE EST MORT (revue du 2026-08-10) : là où la
        // cour touche la salle, c'est le mur DE LA SALLE qui ferme (« on ne clôture pas
        // contre son propre mur ») — le poseur saute l'arête AVANT de lire les exceptions.
        // Un tel triplet était donc validé ici et ignoré là-bas : le silence même que cette
        // garde promet d'empêcher.
        if (reg === 'cour' && regionAt(x + off[0], y + off[1]) === 'salle') {
          fautes.push(`${kind} : ${nom} « ${k} » — sans effet côté cour (le mur appartient à la salle : déclare l'arête côté salle)`)
        }
      }
    }
    // L'ANTRE NE CÔTOIE PAS LA MAÇONNERIE (étage 2) : seule la paire cour/salle a sa règle de
    // préséance (« on ne clôture pas contre son propre mur ») — antre contre salle ou cour,
    // chacune poserait sa barrière DANS l'autre, dos à dos. Une tuile de « rien » les sépare ;
    // la faute le dit, plutôt qu'un bâti absurde qu'on ne verrait qu'en jeu.
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (regionAt(x, y) !== 'antre') continue
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const r2 = regionAt(x + dx, y + dy)
          if (r2 !== undefined && r2 !== 'antre') {
            fautes.push(`${kind} : l'antre en (${x},${y}) touche la ${r2} — barrières dos à dos (sépare-les d'une tuile)`)
          }
        }
      }
    }
    // ═══ LA GARDE DE CLÔTURE (révision du 2026-08-11) ═══
    // « Non traversable sur au moins une tuile complète » se PROUVE ici, sur TOUT le
    // pourtour — jamais des cas choisis : chaque arête d'antre donne sur une tuile MASSIF
    // (ou une autre tuile d'antre), ou porte un `passage` explicite — la gueule. Et une
    // gueule qui donne dans la roche n'ouvre rien : la faute le dit, plutôt qu'une poche
    // scellée qu'on ne verrait qu'en jeu.
    const pieceAt = (x: number, y: number): string | undefined =>
      (x < 0 || y < 0 || x >= n || y >= n ? undefined : LEGENDE[plan.grille[y]![x]!]?.piece)
    const passagesBruts = new Set(plan.passages ?? [])
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (regionAt(x, y) !== 'antre') continue
        for (const [d, off] of Object.entries(OFF)) {
          const vx = x + off[0]
          const vy = y + off[1]
          if (regionAt(vx, vy) === 'antre') continue
          if (passagesBruts.has(`${x},${y},${d}`)) {
            if (pieceAt(vx, vy) === 'massif') fautes.push(`${kind} : le passage « ${x},${y},${d} » donne dans la roche — la gueule doit ouvrir sur du praticable`)
            continue
          }
          if (pieceAt(vx, vy) !== 'massif') {
            fautes.push(`${kind} : l'antre en (${x},${y}) n'est pas clos côté ${d} — massif (H) ou passage exigé`)
          }
        }
      }
    }
  }
  return fautes
}

/** Les quatre directions d'arête — une seule table pour la garde, le poseur et l'orientation. */
const OFF_DIR: Record<string, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], O: [-1, 0] }

/**
 * TOURNER UN TRIPLET « x,y,D » d'un quart à la fois — la même loi que `rotate` pour la
 * grille : une brèche déclarée au nord d'une tuile reste au nord de CETTE tuile.
 */
function tournerTriplet(k: string, quart: number, n: number): string {
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

export function rotate(plan: readonly string[], n: number): string[] {
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
export function buildPoiStructures(state: SimState, seed: number): RapportDeVignettes {
  const map = state.map
  for (const z of map.zones) {
    if (z.kind === undefined) continue
    const plan = PLANS[z.kind]
    if (plan === undefined) continue

    // LE SORT DU LIEU (spec stratigraphie S-R17) : brûlé, pillé ou intact — dérivé de la carte,
    // le MÊME verdict que celui du toponyme (`placeOne` nomme d'après lui). Il module l'usure,
    // le mobilier et la fouille ; le plan, lui, ne bouge pas.
    const sort = sortDuLieu(map, z.x, z.y, z.w, z.h)

    // L'ORIENTATION — positionnelle et salée, jamais du PRNG partagé ; et depuis le
    // 2026-08-11, la GUEULE S'ORIENTE (voir `choisirQuart`). Un plan `fixe` se pose
    // dans le sens où il est écrit (cf. `Plan.fixe`).
    const quart = plan.fixe ? 0 : choisirQuart(plan, map, z.x, z.y, seed)

    batirLieu(state, plan, z.x, z.y, sort, quart)
  }
  // LES GROTTES N'ONT PAS DE PLAN : elles se meublent (G-R6), après les lieux, et le rapport remonte.
  return meublerLesGrottes(state, seed)
}

/** Jusqu'où la gueule regarde pour juger son souffle. Réglage worldgen (se calibre en
 *  REGARDANT une carte, cf. balance.ts en-tête) : 4 tuiles suffisent à distinguer « donne
 *  sur l'ouvert » de « donne sur un massif ou l'anneau de bordure ». */
const SOUFFLE_MAX = 4

/**
 * LE QUART DE TOUR D'UN LIEU — et la GUEULE S'ORIENTE (révision du 2026-08-11).
 *
 * Un plan sans passage tourne comme avant : `hash2` positionnel salé ('BATI'), jamais le
 * PRNG partagé. Un plan À PASSAGE (l'antre et sa gueule) choisit parmi les quatre quarts
 * celui qui donne à ses passages le plus de SOUFFLE — de tuiles praticables devant, sur le
 * terrain FIGÉ (les structures n'existent pas encore à l'amorce). Sous roche incassable,
 * une gueule tournée vers un côté scellé n'est pas un défaut de lecture, c'est une poche
 * morte (le problème du 2026-07-13). Le tirage positionnel reste le DÉPART du parcours :
 * à souffle égal, deux lieux ne se ressemblent pas.
 */
function choisirQuart(plan: Plan, map: SimState['map'], x0: number, y0: number, seed: number): number {
  const base = Math.min(3, Math.floor(hash2(x0, y0, seed ^ 0x42415449) * 4)) // 'BATI'
  const passages = plan.passages ?? []
  if (passages.length === 0) return base
  const n = plan.grille.length
  let meilleur = base
  let meilleurSouffle = -1
  for (let i = 0; i < 4; i++) {
    const q = (base + i) % 4
    let souffle = 0
    for (const k of passages) {
      const [sx, sy, d] = tournerTriplet(k, q, n).split(',')
      const off = OFF_DIR[d!]!
      let tx = x0 + Number(sx) + off[0]
      let ty = y0 + Number(sy) + off[1]
      for (let pas = 0; pas < SOUFFLE_MAX; pas++) {
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) break
        if (isBlockingTile(map, tx, ty)) break
        souffle += 1
        tx += off[0]
        ty += off[1]
      }
    }
    if (souffle > meilleurSouffle) {
      meilleurSouffle = souffle
      meilleur = q
    }
  }
  return meilleur
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
    const region = (rx: number, ry: number): 'salle' | 'cour' | 'antre' | undefined => caseAt(rx, ry).region
    const libre = (tx: number, ty: number): boolean =>
      tx >= 0 && ty >= 0 && tx < map.width && ty < map.height && !isBlockingTile(map, tx, ty)

    // Les exceptions du contour, tournées avec le plan : une brèche déclarée au nord d'une
    // tuile reste au nord de CETTE tuile, quel que soit le quart de tour du bâtiment.
    const tournee = (k: string): string => tournerTriplet(k, quart, n)
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
        else if (c.region === 'antre') poser(state, 'roc', tx, ty, usure) //  la pierre nue (étage 2)
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
        // L'ANTRE NE DÉRIVE RIEN (révision du 2026-08-11) : sa clôture est le MASSIF peint
        // dans la grille — la garde de clôture (verifierPlan) a déjà exigé qu'il y soit.
        if (reg === 'antre') continue
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
// Le MINÉRAL survit au feu (étage 2) : sans quoi un antre brûlé perdrait ses blocs de pierre.
const SURVIT_AU_FEU = new Set<StructureType>(['atre', 'autel', 'mur_bas', 'rocher', 'eboulis', 'massif'])
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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// L'AMEUBLEMENT DES GROTTES — DES VIGNETTES ANCRÉES (spec `grottes.md` G-R6, G-A8)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Une Grotte n'a pas de plan : sa forme vient du karst (`zonegen-karst.ts`), salle par salle.
// Ce qui la MEUBLE est une composition de vignettes — de petits `.plan` (3×3 à 5×5) SANS
// région (aucun mur dérivé : rien ne clôt, G-R7), chacun portant une ANCRE qui dit où il a un
// sens : contre la paroi, au bord de l'eau, au centre de la salle, ou contre une porte. Par
// salle, 2 à 4 vignettes élues au hachage positionnel parmi celles dont l'ancre est disponible ;
// chacune se pose là où elle tient À 100 % sur du creusé sec et libre — ou ne se pose pas.
// L'intention ne se rogne jamais, et ce qui n'a pas trouvé sa place se COMPTE (G-A8).

/** Une vignette posée : où, laquelle, tournée de combien — ce que la garde et le smoke relisent. */
export interface PoseDeVignette {
  /** L'index de la zone `grotte` dans `map.zones`, et celui de la salle dans `Zone.salles`. */
  zone: number
  salle: number
  nom: string
  /** Le coin haut-gauche de l'empreinte, et le quart de tour appliqué. */
  x: number
  y: number
  quart: number
}

/** Ce que la passe rapporte — le compte des vignettes sans place n'est pas caché (G-A8). */
export interface RapportDeVignettes {
  /** Les salles parcourues (toutes les salles de toutes les Grottes). */
  salles: number
  /** Les vignettes ÉLUES puis posées. */
  posees: PoseDeVignette[]
  /** Les vignettes élues qui n'ont trouvé aucune place : rapportées, jamais rognées. */
  nonPosees: { zone: number; salle: number; nom: string }[]
}

/** Les vignettes habitent « packages/sim/src/plans/vignettes/<nom>.plan » (même compilateur). */
export { VIGNETTES }

/** Le côté d'une vignette : de 3 à 5 tuiles — assez pour composer, jamais une salle entière. */
const VIGNETTE_COTE = { MIN: 3, MAX: 5 }

/** De 2 à 4 vignettes par salle (G-R6). */
const VIGNETTES_PAR_SALLE = { MIN: 2, MAX: 4 }

/** Le sel de l'élection et de la pose — positionnel, jamais le PRNG partagé. */
const SEL_VIGNETTE = 0x56494e47 // 'VING'

/**
 * LA GARDE D'UNE VIGNETTE — au compilateur (`pnpm plans`) et dans la suite, la même loi.
 *
 * Carrée, petite, ANCRÉE, et hors région : un `.` ou un `r` y dériverait un mur ou un dallage
 * que le poseur des Grottes ne sait pas poser — une vignette n'a pas de pourtour. Ses pièces
 * sont celles du bivouac (`sousRoche`, G-R7) et son seul nœud est la fouille (`rubble`) : la
 * pierre du karst se sème ailleurs (`pierreDuKarst`), et rien de vivant ne pousse sous la roche.
 */
export function verifierVignette(nom: string, plan: Plan): string[] {
  const fautes: string[] = []
  const n = plan.grille.length
  if (n < VIGNETTE_COTE.MIN || n > VIGNETTE_COTE.MAX) fautes.push(`${nom} : ${n} rangées — une vignette fait de ${VIGNETTE_COTE.MIN} à ${VIGNETTE_COTE.MAX} de côté`)
  if (plan.ancre === undefined) fautes.push(`${nom} : sans « ancre » — une vignette dit où elle a un sens (eau, paroi, centre, porte)`)
  for (const cle of ['breches', 'seuils', 'passages'] as const) {
    if (plan[cle]?.length) fautes.push(`${nom} : « ${cle} » — une vignette n'a pas de contour`)
  }
  let contenu = 0
  for (const [i, row] of plan.grille.entries()) {
    if (row.length !== n) fautes.push(`${nom} : rangée ${i} fait ${row.length} caractères, pas ${n}`)
    for (const [j, c] of [...row].entries()) {
      if (c === '·') continue
      const cas = LEGENDE[c]
      if (c === '#' || cas === undefined) { fautes.push(`${nom} : caractère inconnu « ${c} » en (${j},${i})`); continue }
      if (cas.region !== undefined) fautes.push(`${nom} : « ${c} » en (${j},${i}) est une région (${cas.region}) — une vignette n'en a pas`)
      if (cas.piece !== undefined && !piece(cas.piece).sousRoche) fautes.push(`${nom} : « ${c} » (${cas.piece}) ne se pose pas sous la roche (G-R7)`)
      if (cas.noeud !== undefined && cas.noeud !== 'rubble') fautes.push(`${nom} : « ${c} » (${cas.noeud}) — le seul nœud d'une vignette est la fouille (rubble)`)
      contenu += 1
    }
  }
  if (contenu === 0) fautes.push(`${nom} : vignette vide`)
  return fautes
}

/**
 * MEUBLE LES GROTTES — appelée par `buildPoiStructures`, après les lieux bâtis.
 *
 * Pour chaque salle de chaque Grotte (`Zone.salles`, posé par le karst), dans l'ordre de
 * `map.zones` : on élit `2 + hash·3` vignettes parmi celles dont l'ancre est DISPONIBLE (une
 * salle sans eau n'offre pas `eau` ; toute salle a une paroi, un centre et au moins une porte),
 * en partant d'un rang haché ; chaque élue cherche, sur les quatre quarts de tour et toutes les
 * positions de la salle rangées au hachage (au centre : par distance au germe), la première
 * empreinte qui TIENT :
 *   • à 100 % sur des tuiles de la salle, sèches, sans nœud, sans structure, sans corps ;
 *   • à ≥ 1 tuile de toute vignette déjà posée (la circulation ENTRE elles) ;
 *   • jamais sur une porte, et sans en isoler aucune : les portes de la salle restent reliées
 *     entre elles par du sol libre autant qu'avant la pose (la circulation VERS chaque porte) ;
 *   • et qui honore son ancre — `paroi` touche la roche, `eau` touche la nappe (sans y tremper),
 *     `centre` ne touche ni l'une ni l'autre, `porte` touche une porte.
 * Une élue sans place se compte et ne se pose pas.
 */
export function meublerLesGrottes(state: SimState, seed: number): RapportDeVignettes {
  const map = state.map
  const width = map.width
  const total = width * map.height
  const rapport: RapportDeVignettes = { salles: 0, posees: [], nonPosees: [] }
  const noms = Object.keys(VIGNETTES).sort()
  if (noms.length === 0) return rapport
  const sel = seed ^ SEL_VIGNETTE
  for (const [iz, z] of map.zones.entries()) {
    if (z.kind !== 'grotte' || z.etage === undefined || z.salles === undefined) continue
    const niveau = z.etage
    // CE QUI OCCUPE DÉJÀ L'ÉTAGE : la pierre semée par le karst, tout bâti — et LA TANIÈRE, la
    // tuile du fond où naît la bête (`fondDuLieu`, une lecture de la carte). Jamais les corps :
    // l'ameublement est POSITIONNEL (contrat A5/A6 de `lieux-batis.md` — la parité d'amorce
    // solo/LAN se juge sur les structures au bit près), et un sanglier se lit dans le PRNG.
    const occupees = new Set<number>()
    for (const nd of state.nodes) if (nd.etage === niveau) occupees.add(nd.ty * width + nd.tx)
    for (const s of state.structures) if (s.etage === niveau) occupees.add(s.ty * width + s.tx)
    const taniere = fondDuLieu(map, z)
    if (taniere >= 0) occupees.add(taniere)
    const terrain = (i: number): number => terrainAEtage(map, niveau, i % width, (i - (i % width)) / width)
    // Creusé = un terrain d'étage POSÉ et non nul ; un trou de grille (jamais attendu, mais la
    // paroi l'a été un jour) est de la roche, pas du creusé.
    const creusee = (i: number): boolean => Number.isInteger(terrain(i)) && terrain(i) !== 0
    const voisines = (i: number): number[] => {
      const x = i % width
      const v: number[] = []
      if (x > 0) v.push(i - 1)
      if (x < width - 1) v.push(i + 1)
      if (i >= width) v.push(i - width)
      if (i + width < total) v.push(i + width)
      return v
    }
    for (const [is, salle] of z.salles.entries()) {
      rapport.salles += 1
      const dans = new Set(salle.tuiles)
      const seche = (i: number): boolean => dans.has(i) && creusee(i) && !isWater(terrain(i))
      // LES PORTES : les tuiles de la salle qui touchent du creusé hors salle (boyau, gueule).
      const portes = new Set(salle.tuiles.filter((i) => voisines(i).some((j) => !dans.has(j) && creusee(j))))
      const aDeLEau = salle.tuiles.some((i) => isWater(terrain(i)))
      const gx = salle.germe % width
      const gy = (salle.germe - gx) / width
      // LE SOL LIBRE — pour juger la circulation vers les portes ; les empreintes posées s'en retirent.
      const libre = new Set(salle.tuiles.filter((i) => seche(i) && !occupees.has(i)))
      // Les PAIRES de portes reliées par du sol libre (une porte occupée par la pierre du karst
      // reste un départ : on en sort par ses voisines). Une pose ne doit en rompre aucune.
      const portesReliees = (): number => {
        const liste = [...portes]
        let n = 0
        for (let a = 0; a < liste.length; a++) {
          const vu = new Set<number>([liste[a]!])
          const pile = [liste[a]!]
          while (pile.length) {
            const i = pile.pop()!
            for (const j of voisines(i)) if (libre.has(j) && !vu.has(j)) { vu.add(j); pile.push(j) }
          }
          for (let b = a + 1; b < liste.length; b++) if (vu.has(liste[b]!)) n += 1
        }
        return n
      }
      const reliees = portesReliees()
      // LA COURONNE des vignettes posées : une tuile de circulation entre deux (8 voisines).
      const couronne = new Set<number>()
      // La boîte de la salle — les positions candidates y restent.
      let x0 = width, y0 = map.height, x1 = 0, y1 = 0
      for (const i of salle.tuiles) {
        const x = i % width
        const y = (i - x) / width
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }

      const placer = (plan: Plan, nom: string): PoseDeVignette | undefined => {
        const n = plan.grille.length
        const q0 = Math.min(3, Math.floor(hash2(gx + n, gy, sel + 2) * 4))
        const candidates: { x: number; y: number; cle: number }[] = []
        // L'EMPREINTE d'une vignette, ce sont ses CASES PLEINES — une case vide (`·`) est de la
        // composition, pas de l'occupation : elle peut être de la roche ou de l'eau (la rive
        // se compose autour de l'eau). D'où une boîte de candidats qui déborde de la salle de n − 1.
        for (let y = Math.max(0, y0 - n + 1); y <= y1; y++) {
          for (let x = Math.max(0, x0 - n + 1); x <= x1 && x + n <= width; x++) {
            const cx = x + (n - 1) / 2
            const cy = y + (n - 1) / 2
            const cle = plan.ancre === 'centre'
              ? (cx - gx) * (cx - gx) + (cy - gy) * (cy - gy) + hash2(x, y, sel) * 0.5
              : hash2(x, y, sel)
            candidates.push({ x, y, cle })
          }
        }
        candidates.sort((a, b) => (a.cle - b.cle) || (a.y - b.y) || (a.x - b.x))
        for (let dq = 0; dq < 4; dq++) {
          const quart = (q0 + dq) % 4
          const g = rotate(plan.grille, quart)
          const pleines: number[] = []
          for (let ry = 0; ry < n; ry++) for (let rx = 0; rx < n; rx++) if (LEGENDE[g[ry]![rx]!] !== undefined) pleines.push(ry * width + rx)
          for (const c of candidates) {
            const origine = c.y * width + c.x
            const empreinte = pleines.map((d) => origine + d)
            if (!empreinte.every((i) => libre.has(i) && !couronne.has(i) && !portes.has(i))) continue
            // L'ANCRE — jugée sur le voisinage à 4 de l'empreinte.
            let paroi = false, eau = false, porte = false
            for (const i of empreinte) {
              for (const j of voisines(i)) {
                if (!creusee(j)) paroi = true
                else if (isWater(terrain(j))) eau = true
                if (portes.has(j)) porte = true
              }
            }
            const ancre = plan.ancre
            if (ancre === 'paroi' && !paroi) continue
            if (ancre === 'eau' && !eau) continue
            if (ancre === 'centre' && (paroi || eau)) continue
            if (ancre === 'porte' && !porte) continue
            // LA CIRCULATION VERS CHAQUE PORTE — on retire l'empreinte et l'on recompte.
            for (const i of empreinte) libre.delete(i)
            if (portes.size > 0 && portesReliees() < reliees) {
              for (const i of empreinte) libre.add(i)
              continue
            }
            // ÇA TIENT : on pose, tourné, à l'étage.
            for (let ry = 0; ry < n; ry++) {
              for (let rx = 0; rx < n; rx++) {
                const cas = LEGENDE[g[ry]![rx]!]
                if (cas === undefined) continue
                const tx = c.x + rx
                const ty = c.y + ry
                if (cas.piece) {
                  const s = addStructure(state, cas.piece, tx, ty, 0, 0, 'public', undefined, undefined, niveau)
                  if (USURABLE.has(cas.piece)) s.hp = Math.max(1, Math.floor(s.hp * plan.usure))
                }
                if (cas.noeud) semerAEtage(state, cas.noeud, tx, ty, niveau)
              }
            }
            for (const i of empreinte) {
              occupees.add(i)
              const x = i % width
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  if (x + dx < 0 || x + dx >= width) continue
                  const j = i + dy * width + dx
                  if (j >= 0 && j < total) couronne.add(j)
                }
              }
            }
            return { zone: iz, salle: is, nom, x: c.x, y: c.y, quart }
          }
        }
        return undefined
      }

      // L'ÉLECTION : 2 à 4, parmi les ancres disponibles, depuis un rang haché.
      const nb = VIGNETTES_PAR_SALLE.MIN + Math.min(
        VIGNETTES_PAR_SALLE.MAX - VIGNETTES_PAR_SALLE.MIN,
        Math.floor(hash2(gx, gy, sel) * (VIGNETTES_PAR_SALLE.MAX - VIGNETTES_PAR_SALLE.MIN + 1)),
      )
      const depart = Math.min(noms.length - 1, Math.floor(hash2(gx, gy, sel + 1) * noms.length))
      let elues = 0
      for (let k = 0; k < noms.length && elues < nb; k++) {
        const nom = noms[(depart + k) % noms.length]!
        const plan = VIGNETTES[nom]!
        if (plan.ancre === 'eau' && !aDeLEau) continue //     l'ancre n'est pas disponible : pas élue
        if (plan.ancre === 'porte' && portes.size === 0) continue
        elues += 1
        const pose = placer(plan, nom)
        if (pose) rapport.posees.push(pose)
        else rapport.nonPosees.push({ zone: iz, salle: is, nom })
      }
    }
  }
  return rapport
}

/** Semer un nœud À L'ÉTAGE — même règle d'identifiant que `semer` (au-dessus de tous). */
function semerAEtage(state: SimState, type: NodeType, tx: number, ty: number, etage: number): void {
  let id = 1
  for (const nd of state.nodes) if (nd.id >= id) id = nd.id + 1
  state.nodes.push({ id, type, tx, ty, etage, stock: NODE_DEFS[type].stock, regrowAt: 0 })
}
