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

export interface Plan {
  /**
   * LE PLAN NE DÉCRIT QUE DES RÉGIONS ET LEUR CONTENU — les murs se DÉRIVENT du pourtour.
   *
   * C'est la conséquence directe du modèle d'arête : un mur n'est plus une tuile qu'on pose,
   * c'est une propriété du contour d'une salle. Une salle de 6×4 s'écrit donc 6×4, et ses
   * vingt-quatre tuiles sont TOUTES praticables — là où l'ancien plan en réclamait 8×6 pour en
   * rendre quinze.
   */
  readonly grille: readonly string[]
  /**
   * L'USURE — la fraction de PV que gardent les murs. Elle n'est pas cosmétique : le client
   * assombrit à mesure, et bascule sol et toit sur leurs textures ruinées. 1 = neuf.
   */
  readonly usure: number
  /**
   * LES BRÈCHES — des arêtes du pourtour SANS mur (`"x,y,D"`). **C'est ici que vit la ruine.**
   * Elle ne se dit plus en tuiles retirées mais en contour percé : le pan est écroulé, et c'est
   * par là qu'on entre.
   */
  readonly breches?: readonly string[]
  /** LES SEUILS — les arêtes qui portent un encadrement (l'entrée du bâtiment). */
  readonly seuils?: readonly string[]
  /** LES PASSAGES — les arêtes de clôture laissées nues : on entre dans la cour sans porte. */
  readonly passages?: readonly string[]
  /**
   * L'ORIENTATION FIXE — le lieu se pose TEL QU'IL EST ÉCRIT, sans quart de tour.
   *
   * Par défaut un bâti tourne (`hash2` sur sa position) : deux fermes ne se ressemblent pas, et
   * on ne lit pas le monde comme un catalogue. Mais quand la LECTURE d'un plan dépend de son
   * orientation à l'écran, la variété coûte plus qu'elle ne rapporte — le plan le déclare ici,
   * et il est alors écrit dans le sens où on le verra.
   */
  readonly fixe?: boolean
}

/**
 * LA LÉGENDE — un caractère, une tuile. Deux RÉGIONS (la salle, la cour), et du contenu.
 *
 * `·` (rien) n'y figure pas : c'est l'absence, et dans une ruine l'absence est la moitié du
 * sujet. Le contenu implique sa région : une table est forcément dans la salle.
 */
interface Case { region?: 'salle' | 'cour'; piece?: StructureType; toit?: boolean; noeud?: NodeType }
const LEGENDE: Record<string, Case> = {
  '.': { region: 'salle' }, //                      le dallage
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

export const PLANS: Record<string, Plan> = {
  /**
   * LA FERME RUINÉE (t0-exploration R19) — « on vivait ici, on est partis ».
   *
   * Une SALLE de 11×6 et sa COUR de 11×5, dans une emprise de 18 (décision d'Alexis,
   * 2026-07-27 : « c'est tout rikiki », puis deux tuiles de large en plus). Le 6×4 d'origine
   * tenait dans un écran de vingt tuiles de haut comme une cabane — on entrait, on ressortait,
   * sans jamais avoir traversé quoi que ce soit. À 11×6, la salle vaut 66 tuiles au lieu de 24 :
   * elle a un fond, des angles morts, et une distance entre la porte et l'âtre. Le mobilier
   * reste plaqué aux murs — au milieu, un meuble flotte ; contre un mur, il s'appuie, et le
   * centre reste ce qu'il doit être : un espace où l'on circule (il y en a maintenant assez pour
   * que ça se remarque). L'emprise, elle, ne bouge pas : c'est la friche de l'est qui cède ses
   * deux colonnes — un champ se resserre sans qu'on le remarque, une salle non.
   *
   * **AUCUN TOIT** (décision d'Alexis) : une ferme ruinée est à ciel ouvert. C'est ce qui la
   * sépare d'une maison entretenue, et ça permet d'en voir le dedans sans rien escamoter.
   *
   * **ELLE NE TOURNE PAS** (décision d'Alexis, 2026-07-27) : la cour est au SUD dans le plan,
   * donc VERS LE BAS de l'écran — on arrive par l'enclos, la salle est derrière, et le seuil
   * qui les sépare se lit de face. Le quart de tour aléatoire la présentait de profil ou de
   * dos une fois sur deux. Prix payé : toutes les fermes d'une carte se ressemblent.
   */
  ferme_ruinee: {
    usure: 0.45,
    fixe: true,
    grille: [
      '··················',
      '··················',
      '·.A....E....·xxx··',
      '·L.........o·xxxx·',
      '·L..Tb......·xxxx·',
      '·...Tb.....K·xxx··',
      '·..P.......E··xxx·',
      '·...........·xxxx·',
      '·,M,,,,a,,,,·xxx··',
      '·,,g,,,,,,,,··xx··',
      '·,,,,,,,g,,,···x··',
      '·,,,,,,,,,,,······',
      '·,,,,,,,,,,,······',
      '··················',
      '···xxxxx··········',
      '··xxxxxx··········',
      '···xxxx···········',
      '··················',
    ],
    // LE PAN EST ÉCROULÉ : deux arêtes du pourtour sans mur. C'est la seconde entrée, et c'est
    // là que la ruine se dit — dans le contour percé, pas dans une tuile retirée.
    breches: ['11,4,E', '11,5,E'],
    // LE SEUIL FAIT DEUX CASES (décision d'Alexis, 2026-07-27) : deux arêtes mitoyennes. Le
    // client les reconnaît voisines et supprime les montants du MILIEU — sinon une porte de
    // deux cases lit comme deux portes d'une case, dos à dos.
    seuils: ['4,7,S', '5,7,S'], //  le seuil encadré, entre la salle et la cour
    // LE PASSAGE DE LA CLÔTURE FAIT DEUX CASES lui aussi (demande d'Alexis, 2026-07-27) : une
    // ouverture d'une seule tuile est un goulot pour un corps qui en fait une — on la franchit
    // au pixel près, et on s'y coince dès qu'on arrive en biais.
    passages: ['4,12,S', '5,12,S'], // le passage nu de la clôture
  },
  /**
   * LA CABANE DE BERGER — DEBOUT, elle (`usure: 1`), et c'est tout le contraste : la même
   * grammaire dit « ruine » et « entretenu » en changeant un nombre. Couverte, elle.
   */
  cabane: {
    usure: 1,
    grille: [
      '·····',
      '·:::·',
      '·L:K·',
      '·:::·',
      '·····',
    ],
    seuils: ['2,3,S'],
  },
  /**
   * LES RUINES — des pans de murs très usés, à ciel ouvert, et c'est tout ce qui reste.
   *
   * La plus abîmée des salles (`usure: 0.25` : les murs tiennent à peine debout, le client les
   * assombrit d'autant). DEUX brèches — on entre par l'est en enjambant le pan écroulé (le
   * `mur_bas` couché exactement là où le mur manque), ou par le sud, où les gravats se sont
   * répandus dans l'ouverture. La poutre au milieu de la salle est ce qui reste de la charpente.
   */
  ruines: {
    usure: 0.25,
    grille: [
      '······',
      '·....·',
      '·.P..m',
      '·....·',
      '·....·',
      '··G··G',
    ],
    breches: ['4,2,E', '2,4,S'],
  },
  /**
   * L'ABRI SOUS ROCHE — un couvert minéral adossé, ouvert au sud.
   *
   * La seule salle COUVERTE du périmètre (`:`) : c'est un toit qu'on cherche, pas une maison.
   * Tout le côté sud est brèche — un abri n'a pas de porte, il a un surplomb. La paillasse dit
   * que quelqu'un y a dormi ; les gravats dans l'ouverture, que personne n'est revenu.
   * (NB : comme la cabane, il tourne — « adossé » se lit dans le mur plein, où qu'il regarde.)
   */
  abri: {
    usure: 0.8,
    grille: [
      '····',
      '·::·',
      '·L:·',
      '·G··',
    ],
    breches: ['1,2,S', '2,2,S'],
  },
  /**
   * LA MINE ABANDONNÉE — le carreau condamné, pas le souterrain (différé, cf. décision
   * 2026-07-27 « souterrain multi-couche »).
   *
   * Une petite salle de pierre (le bâtiment du carreau), son seuil encadré — la seule entrée
   * de mine qui se lise comme une porte — et les poutres du chevalement tombées dehors. La
   * fouille la plus riche du périmètre : TROIS tas de gravats, les haldes autour du puits.
   */
  mine: {
    usure: 0.55,
    grille: [
      '·····',
      '·..·G',
      '·.P··',
      '····p',
      '·G·G·',
    ],
    seuils: ['1,2,S'],
  },
  /**
   * L'ORATOIRE — l'édicule alpin : la pierre dressée et son enclos ruiné.
   *
   * Aucune salle : l'autel tient debout au centre (il ne tombe pas, il s'oublie), et l'enclos
   * n'existe plus qu'en pans de mur bas éboulés aux coins. Un seul tas de gravats — on ne
   * pille pas grand-chose à un lieu qui n'a jamais rien possédé.
   */
  oratoire: {
    usure: 0.6,
    grille: [
      'm·m',
      '·U·',
      'm·G',
    ],
  },
  /**
   * LE VIEUX BIVOUAC — le feu froid de ceux qui sont partis.
   *
   * Aucune salle, aucun mur : un âtre éteint, le couchage à la belle étoile, le tonneau
   * qu'on n'a pas porté plus loin. Le camp se lit en un coup d'œil — et s'il est BRÛLÉ,
   * le feu ne laisse que l'âtre, ce qui est exactement l'histoire qu'il faut.
   */
  bivouac: {
    usure: 0.8,
    grille: [
      'l··',
      '·Ft',
      '·G·',
    ],
  },
  /**
   * LA CHARRETTE ABANDONNÉE — échouée sur le bord du chemin (elle naît `pres: 'route'`).
   *
   * Le corps du lieu est la charrette elle-même : elle BLOQUE, on la contourne. Le tonneau a
   * roulé à côté, les gravats disent ce que le chargement est devenu. Née près d'une sente,
   * elle sera presque toujours « pillée » — c'est voulu, c'est la règle de lecture S-R17.
   */
  charrette: {
    usure: 0.7,
    grille: [
      '··G',
      '·C·',
      '·t·',
    ],
  },
  /**
   * L'ÉPAVE D'AVALANCHE — le convoi pris par la montagne (aiguilles, glacier).
   *
   * La même charrette que le bord des routes, mais disloquée (`usure: 0.35`) : les poutres
   * du chargement éparpillées dans la pente, deux tas de gravats. Pas de tonneau — ce qui
   * roulait a fini plus bas.
   */
  epave: {
    usure: 0.35,
    grille: [
      '····',
      '·Cp·',
      '·pG·',
      'G···',
    ],
  },
}

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
    const usure = usureSelonSort(plan.usure, sort)

    // L'ORIENTATION, tirée de la position — positionnelle et salée, jamais du PRNG partagé.
    // Sauf pour un plan `fixe`, qui se pose dans le sens où il est écrit (cf. `Plan.fixe`).
    const quart = plan.fixe ? 0 : Math.min(3, Math.floor(hash2(z.x, z.y, seed ^ 0x42415449) * 4)) // 'BATI'
    const g = rotate(plan.grille, quart)
    const n = g.length
    const x0 = z.x
    const y0 = z.y

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
        if (c.toit && sort !== 'brule') poser(state, 'roof', tx, ty, usure)
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
