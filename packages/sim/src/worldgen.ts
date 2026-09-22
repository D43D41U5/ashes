/**
 * Le peuplement du monde — villages 100 % PNJ (spec pnj R10, village-pnj-evolution R1).
 *
 * L'outil du mode Veillée, des tests et du monde-gen : il fonde un village
 * complet par les mêmes briques que le jeu (createVillage, addStructure,
 * spawnNpcsAround) — son seul privilège de monde-gen est de faire place nette.
 *
 * Depuis `village-pnj-evolution` : le village naît au PALIER 1, le CAMPEMENT —
 * Feu, grenier approvisionné, une paillasse par habitant (aux emplacements des
 * futurs logis : le lit du colon deviendra sa chambre au palier 2), le mobilier
 * autour du grenier. Plus AUCUNE `house` (le chip d'une tuile qui lisait comme
 * une image posée) : le type survit pour les parties sauvées, plus rien n'en pose.
 */
import { ALIGNMENT, BALANCE, VILLAGE_GROWTH } from './balance'
import { addItems } from './items'
import { RING_OFFSETS, spawnNpcsAround } from './npc'
import type { SimState } from './sim'
import { addStructure, createVillage, type Village } from './village'
import { bedAnchor, HUT_SPOTS } from './village-plan'

/**
 * ═══ QUI S'INSTALLE AUTOUR DE CELUI QUI NAÎT — LA LOI COMMUNE AUX TROIS HÔTES ═══
 *
 * Le monde se peuplait de trois façons différentes : la Veillée posait ses voisins au plus
 * proche du joueur, le banc de calibrage plantait un Foyer EXACTEMENT sur le point de naissance
 * puis écartait ses trois sites au maximum, et la zone LAN ne fondait RIEN. Une seule loi depuis
 * le 2026-09-22, appelée par les trois : c'est l'invariant « une simulation, pas deux jeux »
 * appliqué au peuplement, pas un arbitrage de design.
 *
 * ⚠ **LA MARGE DU RAIDEUR EST GARANTIE, PAS SEULEMENT MESURÉE.** L'IA de raid de la Meute vise
 * le village le plus proche À VOL D'OISEAU (`nearestOtherVillage`, `npc-errands.ts`). Quand ses
 * deux cibles sont à quasi-égalité, elle raide la même chaque nuit jusqu'à destruction mutuelle
 * — et on mesure alors une guerre au lieu d'une économie. Le banc s'en protégeait SEUL, par son
 * écartement maximal ; serrer les voisins autour du joueur retire cette protection, or
 * `npc-errands.ts` est du /sim pur et le même raid tourne en solo.
 *
 * MESURÉ le 2026-09-22 (`tools/__marge-solo.mts`, tri au plus proche, 5 villages) — marge de la
 * Meute entre ses deux cibles : **52,6 %** (graine 2026), **78,6 %** (7), **80,5 %** (909), et
 * **3,3 %** (4242 : deux cibles à 132 et 136 tuiles). Une graine sur quatre livrait le cas
 * dégénéré, sans aucune garde en solo. On décale donc le site de la Meute d'un cran vers
 * l'extérieur jusqu'à ce que sa marge passe `BALANCE.MARGE_DE_CIBLE_MIN` : elle naît un peu plus
 * loin, et le drame Foyer-vs-Meute reste un drame CHOISI plutôt qu'une fatalité de placement.
 *
 * ⚠ **CE QUE LA LOI NE FAIT PAS.** Elle ne garantit la marge que du RAIDEUR : un neutre à
 * quasi-égalité entre deux voisins ne détruit personne, il donne. Elle ne dit rien non plus de
 * ce qui arrive une fois le village du JOUEUR fondé — une cible de plus, et c'est la sienne.
 *
 * Déterministe et sans tirage : mêmes emplacements + même `premier` = mêmes sites.
 */
export function peuplerLesVoisins(
  state: SimState,
  emplacements: readonly { tx: number; ty: number }[],
  /** Le site du joueur (ou la base de la zone) : on ne fonde JAMAIS dessus. */
  premier: { tx: number; ty: number },
  combien: number = BALANCE.VILLAGES_VEILLEE,
  habitants: number = BALANCE.NPC_PER_VILLAGE,
): { sites: { tx: number; ty: number }[]; margeDeCible: number } {
  const d2 = (a: { tx: number; ty: number }, b: { tx: number; ty: number }): number =>
    (a.tx - b.tx) * (a.tx - b.tx) + (a.ty - b.ty) * (a.ty - b.ty)

  // LES PLUS PROCHES D'ABORD (spec `ascension.md` V-R4) : le joueur doit RENCONTRER ses voisins.
  const candidats = emplacements
    .filter((e) => e.tx !== premier.tx || e.ty !== premier.ty)
    .slice()
    .sort((a, b) => d2(a, premier) - d2(b, premier))

  /** La marge du village `i` entre sa cible la plus proche et la suivante, en pour-cent. */
  const margeDe = (sites: readonly { tx: number; ty: number }[], i: number): number => {
    let premiere = Infinity
    let seconde = Infinity
    for (let j = 0; j < sites.length; j++) {
      if (j === i) continue
      const d = Math.sqrt(d2(sites[i]!, sites[j]!))
      if (d < premiere) { seconde = premiere; premiere = d } else if (d < seconde) { seconde = d }
    }
    // Moins de deux cibles : aucun choix à faire, donc aucune oscillation possible.
    if (premiere === Infinity || seconde === Infinity || premiere === 0) return 100
    return ((seconde - premiere) / premiere) * 100
  }

  const sites = candidats.slice(0, combien)
  /** L'index de la Meute dans `dispositions` — c'est elle, et elle seule, qui raide. */
  const MEUTE = 1
  // On ne reprend jamais un site déjà écarté : le balayage va vers l'extérieur et s'arrête.
  let prochain = combien
  while (
    sites.length > MEUTE + 1 &&
    prochain < candidats.length &&
    margeDe(sites, MEUTE) <= BALANCE.MARGE_DE_CIBLE_MIN
  ) {
    sites[MEUTE] = candidats[prochain]!
    prochain++
  }

  // Le Foyer et la Meute D'ABORD : le moteur d'alignement exige un caractère chaud ET un froid,
  // sans quoi `isOutsider()` est toujours faux et tout le pilier tourne à vide. Les suivants
  // naissent NEUTRES et leur archétype ÉMERGE de leurs actes, comme pour tout le monde.
  const dispositions = ['foyer', 'meute'] as const
  for (const [i, v] of sites.entries()) {
    foundNpcVillage(state, v.tx, v.ty, habitants, dispositions[i] ?? 'neutre')
  }

  return { sites, margeDeCible: Math.round(margeDe(sites, MEUTE) * 10) / 10 }
}

/**
 * Crée un village 100 % PNJ complet (spec R10) : Feu, grenier approvisionné,
 * campement et villageois. L'outil du mode Veillée, des tests et du peuplement.
 */
export function foundNpcVillage(
  state: SimState,
  tx: number,
  ty: number,
  count: number,
  disposition: 'foyer' | 'meute' | 'neutre' = 'neutre',
): Village {
  // Le monde-gen a le droit de faire place nette — mais SEULEMENT sous le campement
  // (Feu, grenier, anneau d'accueil, les 8 emplacements de logis, le mobilier) : le
  // chantier du palier 2, lui, n'a pas besoin de terrain vierge — les arêtes et les
  // sols se posent en ignorant les nœuds (spec construction R23), et le plan SAUTE
  // les emplacements pris. Raser tout le disque de l'enceinte affamerait les tests
  // (et les villages) dont les buissons vivent à six tuiles du Feu.
  //
  // ET LE PAS DEVANT LE FEU ET LE GRENIER — leurs quatre voisins de côté. Un PNJ n'agit qu'à
  // `INTERACT_RANGE − 0,2` = 1,3 tuile : la diagonale (1,41) ne suffit pas, il lui faut UN côté
  // libre. Or l'anneau d'accueil n'en dégage aucun, et une forêt dense les prend tous les
  // quatre — MESURÉ le 2026-09-03 (graine 2026, après les terrasses qui redistribuent le
  // semis) : le grenier du Clan du Levant emmuré par des arbres, 3/3 PNJ « sans chemin », et
  // chacun rejouait son A* jusqu'au bout (4 cibles × 4 096 nœuds) À CHAQUE TICK — 42 ms/tick
  // pour 1,2 à nu, ×35. Huit tuiles de plus, toutes dans le campement.
  const reserved = [
    [tx, ty],
    [tx, ty - 2],
    ...([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).flatMap(([dx, dy]) => [[tx + dx, ty + dy], [tx + dx, ty - 2 + dy]]),
    ...RING_OFFSETS.slice(0, count + 2).map(([dx, dy]) => [tx + dx, ty + dy]),
    ...HUT_SPOTS.map((spot) => bedAnchor(tx, ty, spot)),
  ]
  state.nodes = state.nodes.filter((n) => !reserved.some(([rx, ry]) => n.tx === rx && n.ty === ry))

  const village = createVillage(state, { chiefId: 0, tx, ty, npcsArrived: true }) // on peuple nous-mêmes
  village.foundedSize = count // l'effectif de fondation (mémoire du village, cf. village.ts)
  addStructure(state, 'fire', tx, ty, village.id, 0)
  // Le grenier d'un village PNJ est ouvert aux siens (accès `village`, pas le
  // défaut `private` du coffre) et naît approvisionné.
  const chest = addStructure(state, 'chest', tx, ty - 2, village.id, 0, 'village')
  addItems(chest.inventory!, VILLAGE_GROWTH.STOCK_INITIAL)
  // LE CAMPEMENT (palier 1) : une paillasse par habitant, sur l'ANCRE des futurs
  // logis. Pas de mobilier : il ferait COUVERTURE dans la mêlée (voir village-plan.ts).
  for (const spot of HUT_SPOTS.slice(0, count)) {
    const [ax, ay] = bedAnchor(tx, ty, spot)
    addStructure(state, 'paillasse', ax, ay, village.id, 0)
  }
  spawnNpcsAround(state, village, count)
  // Un village PNJ naît armé (spec combat R13) et avec son caractère
  // ensemencé (spec alignement R12) — l'archétype ÉMERGE ensuite des actes.
  const seedWarmth = disposition === 'foyer' ? ALIGNMENT.SEED_WARMTH : disposition === 'meute' ? -ALIGNMENT.SEED_WARMTH : 0
  for (const npc of state.npcs) {
    if (npc.villageId !== village.id) continue
    const entity = state.entities.find((e) => e.id === npc.entityId)
    if (entity) {
      addItems(entity.inventory, { spear: 1 })
      entity.warmth = seedWarmth
      entity.engagement = disposition === 'neutre' ? 0 : ALIGNMENT.SEED_ENGAGEMENT
    }
  }
  return village
}
