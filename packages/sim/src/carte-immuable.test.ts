/**
 * LA CARTE NE BOUGE PAS — la garde qui rend l'autosave abordable.
 *
 * MESURÉ (2026-07-28, dans le Worker du navigateur) : une sauvegarde de Veillée pèse 69,7 Mo
 * et sa sérialisation JSON arrête le monde **2,4 à 2,5 s**, toutes les 30 s. Sur 80 s de jeu
 * réel, c'étaient les SEULS gels observés — trois autosaves, trois arrêts. Et **86,9 % de ce
 * poids est la carte** (`map.cendre` 50,7 Mo à lui seul, `map.terrain` 9,7 Mo).
 *
 * D'où la coupe : la carte n'est écrite QU'UNE FOIS, à la naissance du monde ; l'autosave ne
 * réécrit plus que les 9,15 Mo qui bougent (voir `serializePartie`).
 *
 * Toute cette optimisation repose sur UNE affirmation : **`step()` n'écrit jamais dans
 * `state.map`.** Le code le dit de lui-même (« donnée STATIQUE : calculée une fois, jamais
 * modifiée », `map.ts`) et le grep le confirme (`terrain[…] =` n'apparaît que dans les
 * fichiers de worldgen). Mais un grep ne protège pas l'avenir : le jour où un système se
 * mettra à peindre le sol — une tuile brûlée, un champ labouré, une route qui s'use — il
 * réécrira `map.terrain`, la sauvegarde périodique ne le verra plus, et le joueur retrouvera
 * à la reprise une vallée qui a oublié ce qu'il lui a fait. En SILENCE.
 *
 * Ce fichier est ce cri. Il fait vivre le monde de production pour de bon — front de cendre
 * poussé au bout de la saison, récolte, abattage, construction, feu, faune et monstres — et
 * exige que la carte en ressorte identique au bit près. Si un jour cette garde devient
 * rouge, ce n'est PAS elle qu'il faut changer : c'est `serializePartie` qu'il faut retirer.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, NODE_DEFS, TERRAINS } from './balance'
import { generateZonedTerrain } from './zonegen'
import { placeZoneNodes, emplacementsDeVillage } from './zone-content'
import { placeHuntingGrounds } from './faune'
import { nidsAMonstre } from './poi'
import { createSim, spawnEntity, step, type PlayerAction, type SimState } from './sim'
import { drainEvents } from './events'
import { frontActuel } from './cendre'
import { grantItems } from './village'
import { TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, jourDeSaison } from './time'
import type { WorldMap } from './map'
import { serializeCarte, serializePartie, serializeSim } from './persistence'
import { baseDepuisNoeuds } from './node-baseline'

/**
 * LES CHAMPS PAR TUILE — trop gros pour un JSON, hachés élément par élément.
 * Ce sont eux qui font 60 des 69,7 Mo, et donc eux qu'on a sortis de l'autosave.
 */
// `profondeur` (§2quater R38) est par tuile comme eux — et la hacher ici PROUVE R38 :
// le champ est gelé à l'amorce, mille ticks de monde vivant n'en bougent pas un bit.
// `distEau` (`saisons.md` S10) rejoint la liste pour la même raison : la CRUE fait porter de
// l'eau à une tuile de terre par simple comparaison `d ≤ niveau`, elle ne mute rien — c'est
// très exactement le genre de mécanisme dont ce fichier existe pour surveiller la promesse.
const CHAMPS_HACHES = ['terrain', 'cendre', 'profondeur', 'distEau'] as const
/** Le reste de la carte — quelques dizaines de ko, couverts par leur JSON. */
const CHAMPS_JSON = [
  'width', 'height', 'zones', 'cendreMax', 'zoneGrid', 'zonePas', 'zoneDefs', 'seuils', 'fil',
  'annales', // l'état civil du monde d'avant (stratigraphie S-R16) — immuable comme le reste
  'coulees', // les chemins du gibier (forêts-vivantes §4) — gelés à l'amorce, comme le fil
] as const

/**
 * L'EMPREINTE DE LA CARTE. On ne garde pas une copie (7,5 M de nombres, ~60 Mo) : on somme.
 *
 * `Math.imul` et les entiers 32 bits sont dans les opérations autorisées à /sim (invariant §2) ;
 * l'empreinte est donc reproductible d'un moteur à l'autre, comme le reste. On mêle l'INDICE à
 * la valeur pour qu'une permutation ne passe pas inaperçue.
 *
 * ELLE DOIT COUVRIR TOUTE LA CARTE, et c'est A0 qui l'exige : le mode d'échec pour lequel ce
 * fichier existe — « un jour, un système se mettra à peindre le sol » — arrivera très
 * probablement sous la forme d'un CHAMP NEUF de `WorldMap`. Une empreinte qui énumère les
 * champs à la main l'ignorerait en silence, et la garde serait verte pendant que la
 * sauvegarde ment. La liste est donc confrontée aux clés réelles (A0), pas choisie.
 */
function empreinte(map: WorldMap): string {
  const melange = (h: number, i: number, v: number): number =>
    (Math.imul(h ^ (i + 0x9e3779b9), 0x85ebca6b) ^ Math.imul(v | 0, 0xc2b2ae35)) | 0

  const champs = map as unknown as Record<string, number[] | undefined>
  // `cendre` porte des distances FRACTIONNAIRES : on ne peut pas la hacher en entiers sans
  // perdre exactement ce qui pourrait changer. On multiplie avant d'arrondir — la précision
  // retenue (1/1024 de tuile) est très en deçà de toute modification qui aurait un sens.
  const haches = CHAMPS_HACHES.map((nom) => {
    const arr = champs[nom]
    if (!arr) return 'ø'
    let h = 0x811c9dc5
    for (let i = 0; i < arr.length; i++) h = melange(h, i, Math.round(arr[i]! * 1024))
    return `${h >>> 0}/${arr.length}`
  })

  const petit = map as unknown as Record<string, unknown>
  const petits = JSON.stringify(CHAMPS_JSON.map((nom) => petit[nom]))
  let hP = 0x811c9dc5
  for (let i = 0; i < petits.length; i++) hP = melange(hP, i, petits.charCodeAt(i))

  return `${haches.join(':')}:${hP >>> 0}`
}

/**
 * Le monde de PRODUCTION, comme `worker/veillee.ts` et le banc le bâtissent — **jour de départ
 * compris** (`saisons.md` S2 : le monde ouvre au jour 51, à la fin de l'Ardeur). Le laisser au
 * défaut 1 ouvrait la partie dans une Éclosion encore gelée, où la cueillette ne prend rien
 * (F3) : A3 mesurait alors le gel au lieu de mesurer la carte.
 */
function mondeReel(): { sim: SimState; joueur: number } {
  const carte = generateZonedTerrain(2026)
  const nodes = placeZoneNodes(carte)
  const emplacements = emplacementsDeVillage(carte, nodes, {
    coinsDeChasse: placeHuntingGrounds(carte.map, 2026),
    nids: nidsAMonstre(carte.map),
  })
  const base = emplacements[0]!
  const sim = createSim(2026, {
    map: carte.map,
    nodes,
    calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE,
    jourDeDepart: BALANCE.JOUR_DE_DEPART,
    home: { x: base.tx + 0.5, y: base.ty + 0.5 },
  })
  const joueur = spawnEntity(sim, base.tx + 0.5, base.ty + 0.5)
  return { sim, joueur }
}

const agir = (sim: SimState, id: number, action: PlayerAction): string[] => {
  step(sim, [{ entityId: id, dx: 0, dy: 0, action }])
  return drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
}

describe('la carte est immuable pendant la partie', () => {
  it("A0 — l'empreinte couvre TOUTE la carte, par construction et non par choix", () => {
    // La garde de la garde. Le jour où `WorldMap` gagne un champ — une couche de sol peint,
    // une usure de route, une humidité —, `empreinte()` l'ignorerait sans rien dire et A1-A3
    // resteraient vertes pendant que la sauvegarde périodique perdrait ce champ à chaque
    // reprise. On confronte donc la liste couverte aux clés RÉELLES du monde de production :
    // ajouter un champ rend ce test rouge, et son auteur doit alors trancher — le hacher, ou
    // le déclarer volatile et le sortir de la carte. Même méthode que `SAVE_REQUIRED_KEYS`
    // dans `persistence.test.ts` : la liste ne se maintient pas de mémoire.
    const { sim } = mondeReel()
    const couverts = [...CHAMPS_HACHES, ...CHAMPS_JSON].sort()
    expect(Object.keys(sim.map).sort()).toEqual(couverts)

    // ET CHAQUE CHAMP HACHÉ DOIT L'ÊTRE POUR DE VRAI. `empreinte` boucle sur `arr.length` : un
    // champ par tuile rangé en tableau TYPÉ ressortirait du `JSON.parse(JSON.stringify)` de
    // `createSim` en objet indexé — truthy, donc accepté, mais de longueur `undefined`, donc
    // haché sur zéro élément. La liste serait complète, l'empreinte constante, et la garde
    // verte en ne couvrant rien (« une garde qui dégrade cache le défaut »).
    for (const nom of CHAMPS_HACHES) {
      const champ = (sim.map as unknown as Record<string, unknown>)[nom]
      expect(Array.isArray(champ), `${nom} n'est pas un tableau : l'empreinte ne le hache pas`).toBe(true)
      expect((champ as unknown[]).length, `${nom} n'a pas une valeur par tuile`).toBe(
        sim.map.width * sim.map.height,
      )
    }
  })

  it("A1 — mille ticks de monde vivant ne changent pas un bit de `map`", () => {
    const { sim, joueur } = mondeReel()
    const avant = empreinte(sim.map)

    // Un monde qui VIT : le joueur marche (donc il découvre, il piétine, il traverse l'eau),
    // pendant que la faune, les monstres, les villages PNJ et le feu font leur travail.
    for (let t = 0; t < 1000; t++) {
      const dx = t % 4 === 0 ? 1 : t % 4 === 2 ? -1 : 0
      const dy = t % 4 === 1 ? 1 : t % 4 === 3 ? -1 : 0
      step(sim, [{ entityId: joueur, dx, dy }])
      drainEvents(sim)
    }

    expect(empreinte(sim.map)).toBe(avant)
  })

  it("A2 — le FRONT DE CENDRE dévore la vallée sans réécrire une tuile", () => {
    // Le suspect n°1, et de loin : c'est le système qui « brûle » la carte. Il ne le fait
    // pas en peignant le sol — il déplace un SEUIL (`cendreFront`, un seul nombre) et compare
    // (`map.cendre[i] < front`). C'est ce qui rend le front bon marché, et c'est très
    // exactement ce que cette garde protège : le jour où quelqu'un le fera « pour de vrai »
    // en repeignant le terrain, l'autosave allégée mentirait.
    const { sim, joueur } = mondeReel()
    const avant = empreinte(sim.map)
    const noeudsAvant = sim.nodes.length

    expect(sim.map.cendreMax ?? 0).toBeGreaterThan(0)
    // Le front ne se POSE pas : il se DÉDUIT du tick (`frontActuel` → `seasonDayAtTick`). Pour
    // l'amener au bout de la saison, on avance donc l'horloge du monde — il n'existe aucun
    // champ d'état à écrire, et c'est justement pour ça que la cendre ne coûte rien.
    // Et la cendre ne MORD qu'au BASCULEMENT d'un jour de saison (le reste des ticks, elle ne
    // coûte qu'un test) : on se pose donc juste AVANT la frontière, pour que le premier `step`
    // la franchisse. Un tick plus loin et le test serait passé sans que rien ne brûle.
    //
    // LE JOUR SE CHOISIT DANS LE GRAND FROID (`saisons.md` S11) : la Cendre ne mord plus que
    // l'hiver, et un jour de l'Ardeur — l'ancien 59 — laisserait le front à zéro, donc rien à
    // garder. Le cœur du Grand Froid tombe encore DANS la saison de ce monde-là, qui se ferme
    // à `JOUR_DE_DEPART + SEASON_DAYS − 1`, soit le jour 110 : on prouve la cendre sans jamais
    // déborder sur la fin de saison.
    const JOUR = 3 * BALANCE.ACT_DAYS + Math.floor(BALANCE.ACT_DAYS / 2) // le cœur du Grand Froid
    // `JOUR − jourDeDepart` et non `JOUR − 1` : le tick compte DEPUIS l'ouverture du monde (S2).
    sim.tick = Math.ceil(((JOUR - sim.jourDeDepart) * TICKS_PER_SEASON_DAY) / sim.calendarScale) - 1
    expect(jourDeSaison(sim)).toBe(JOUR - 1)
    expect(frontActuel({ ...sim, tick: sim.tick + 1 })).toBeGreaterThan(0) // sans ça, rien à garder

    // Dix ticks suffisent : le basculement tombe au premier, et le cœur du Grand Froid est le
    // moment le plus cher de l'année — méga-horde, évacuation, champ de flux… chaque tick y
    // coûte cher. On prouve la cendre, pas l'endgame.
    for (let t = 0; t < 10; t++) {
      step(sim, [{ entityId: joueur, dx: 0, dy: 0 }])
      drainEvents(sim)
    }

    // La preuve que la cendre a bien MORDU : elle dévore les nœuds qu'elle recouvre.
    expect(jourDeSaison(sim)).toBe(JOUR)
    expect(sim.nodes.length).toBeLessThan(noeudsAvant)
    expect(empreinte(sim.map)).toBe(avant)
  })

  it("A3 — RÉCOLTER, ABATTRE, BÂTIR et FONDER ne touchent pas la carte", () => {
    // Les gestes qui MODIFIENT le monde pour de bon. Ils écrivent tous ailleurs — dans
    // `nodes`, `structures`, `villages`, `groundItems` — et c'est la promesse à tenir : ces
    // listes-là restent dans la sauvegarde périodique, la carte n'y est plus.
    const { sim, joueur } = mondeReel()
    const avant = empreinte(sim.map)

    grantItems(sim, joueur, { campfire: 1, hammer: 1, wood: 80, stone: 40 })
    const slotDe = (item: string): number =>
      sim.entities.find((e) => e.id === joueur)!.inventory.findIndex((s) => s?.item === item)

    // Un nœud à portée, quel qu'il soit : on le vide. (S'il n'y en a pas dans le rayon, le
    // refus est muet et la garde reste valable — on ne teste pas la récolte ici, on teste la carte.)
    const moi = sim.entities.find((e) => e.id === joueur)!
    // Le nœud le plus proche RÉCOLTABLE À MAINS NUES, et on va À LUI : sur la carte de
    // production, rien ne garantit ce qui pousse près du spawn — un site déplacé (R17bis a
    // bougé les emplacements) peut mettre en premier un arbre ou une roche, que ce joueur
    // sans outil ne peut pas mordre, et le test mesurerait alors son inventaire, pas la carte.
    const proche = sim.nodes.reduce((meilleur, n) => {
      const def = NODE_DEFS[n.type]
      if (def.tool !== null || def.minForageLevel !== undefined) return meilleur
      const ex = n.tx + 0.5 - moi.x
      const ey = n.ty + 0.5 - moi.y
      const d = ex * ex + ey * ey // pas `**` : /sim doit rejouer au bit près entre moteurs
      return d < (meilleur.d ?? Infinity) ? { n, d } : meilleur
    }, {} as { n?: (typeof sim.nodes)[number]; d?: number }).n
    expect(proche).toBeDefined()
    const stockAvant = proche!.stock
    moi.x = proche!.tx + 0.5
    moi.y = proche!.ty + 1.5 // à portée, jamais sous ses pieds
    for (let t = 0; t < 200; t++) agir(sim, joueur, { type: 'harvest', nodeId: proche!.id })
    expect(proche!.stock).toBeLessThan(stockAvant) // la récolte a bien MORDU

    // Le feu se fonde À CÔTÉ, jamais sous ses propres pieds : une structure pleine-tuile
    // emmure l'acteur centré dessus (leçon `feu-piege-centre-place-component`). Et sur une
    // tuile LIBRE, cherchée parmi les voisines : viser d'office la tuile au-dessus, c'était
    // viser le buisson — ça ne marchait avant que parce que le nœud d'à côté se vidait et
    // disparaissait. Un buisson renouvelable, lui, reste.
    const refus: string[] = []
    const libre = (tx: number, ty: number): boolean =>
      TERRAINS[sim.map.terrain[ty * sim.map.width + tx]!]?.walkable === true &&
      !sim.nodes.some((n) => n.tx === tx && n.ty === ty) &&
      !sim.structures.some((s) => s.tx === tx && s.ty === ty)
    const monTx = Math.floor(moi.x)
    const monTy = Math.floor(moi.y)
    const voisines = [[0, 1], [1, 0], [-1, 0], [1, 1], [-1, 1], [0, -1], [1, -1], [-1, -1]]
      .map(([dx, dy]) => [monTx + dx!, monTy + dy!] as const)
    const [feuTx, feuTy] = voisines.find(([tx, ty]) => libre(tx, ty)) ?? voisines[0]!
    refus.push(...agir(sim, joueur, { type: 'set_active_slot', slot: slotDe('campfire') }))
    refus.push(...agir(sim, joueur, { type: 'place_campfire', tx: feuTx, ty: feuTy }))
    const feu = sim.structures.find((s) => s.tx === feuTx && s.ty === feuTy)
    expect(feu, `refus : ${refus.join(', ')}`).toBeDefined()
    refus.push(...agir(sim, joueur, { type: 'found_village', structureId: feu!.id }))
    expect(sim.villages.length, `refus : ${refus.join(', ')}`).toBeGreaterThan(0)

    // BÂTIR — les deux gestes, parce qu'ils écrivent dans des listes différentes : le MUR
    // (`build`, une barrière à cheval sur l'arête des tuiles — le plus proche d'une écriture
    // de terrain qui existe dans ce jeu) et le COMPOSANT tenu (`place_component`). La pose
    // passe par l'input, jamais par `addStructure` : sinon le replay divergerait
    // (leçon `feu-piege-centre-place-component`).
    const structuresAvant = sim.structures.length
    for (const [dx, dy] of [[2, 0], [3, 0], [2, 1], [3, 1]] as const) {
      const tx = feuTx + dx
      const ty = feuTy + dy
      moi.x = tx + 0.5
      moi.y = ty + 1.5
      refus.push(...agir(sim, joueur, { type: 'build', structure: 'wall', tx, ty }))
    }
    const compTx = feuTx + 2
    const compTy = feuTy + 3
    moi.inventory[0] = { item: 'workshop', count: 1 }
    moi.activeSlot = 0
    moi.x = compTx + 0.5
    moi.y = compTy + 1.5
    refus.push(...agir(sim, joueur, { type: 'place_component', tx: compTx, ty: compTy }))

    // La preuve que le monde a VRAIMENT changé — sans quoi la garde ne prouverait rien.
    expect(sim.structures.length, `refus : ${refus.join(', ')}`).toBeGreaterThan(structuresAvant)
    expect(empreinte(sim.map)).toBe(avant)
  })
})

/**
 * CE QUE PÈSE UNE SAUVEGARDE — la garde qui empêche le gel de revenir.
 *
 * Le poids EST le gel : mesuré dans le Worker du navigateur, la sérialisation coûtait
 * ~2,45 s pour 69,7 Mo et coûte ~200 ms pour 9,2 Mo. Rien, jusqu'ici, ne surveillait ce
 * poids — le correctif serait donc mort en silence le jour où quelqu'un remettrait la carte
 * dans la sauvegarde périodique, ou y ajouterait un autre champ par tuile. On garde donc la
 * TAILLE, pas la durée : une durée dépend de la machine et rendrait la suite capricieuse,
 * alors que le nombre d'octets est le même partout et dit exactement la même chose.
 *
 * Le plafond est large exprès (20 Mo pour 9,2 mesurés) : il n'est pas là pour calibrer, il
 * est là pour crier quand un ordre de grandeur change.
 */
describe('le poids de la sauvegarde périodique', () => {
  /** Généreux : on veut attraper un facteur, pas discuter un mégaoctet. */
  const PLAFOND_PARTIE_MO = 1

  it("A4 — la partie pèse un ordre de grandeur de moins que l'état entier", () => {
    const { sim } = mondeReel()

    const entier = serializeSim(sim).length
    const base = baseDepuisNoeuds(sim.nodes)
    const partie = serializePartie(sim, base).length
    const naissance = serializeCarte(sim.map, sim.seed, sim.nodes).length

    // Le fait central : l'enregistrement de naissance (carte + nœuds d'origine) est
    // l'essentiel du poids, et il n'est plus du voyage.
    expect(naissance / entier).toBeGreaterThan(0.9)
    expect(partie / 1e6).toBeLessThan(PLAFOND_PARTIE_MO)

    // Et la partie ne contient NI la carte NI les nœuds — la vérification directe, au cas
    // où les rapports de taille tiendraient un jour par accident.
    const texte = serializePartie(sim, base)
    expect(texte).not.toContain('"terrain":[')
    expect(texte).not.toContain('"berry_bush"')
  })
})
