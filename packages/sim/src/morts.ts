/**
 * LE CHAMP DES MORTS — « combien de morts dorment ici » (spec `cendreux.md` R14-R19).
 *
 * ═══ POURQUOI UN CHAMP, ET PAS DES LIEUX ═══
 *
 * *Décision d'Alexis, 2026-07-31 : le Cendreux ne naît pas, il se RÉVEILLE — le sol en est déjà
 * plein.* La nuit qui chasse téléportait un mort à un offset ; un loup qui arrive du noir est
 * juste, un cadavre qui se matérialise dans un pré ne l'est pas.
 *
 * On a d'abord cherché à le faire sortir d'une TRACE du monde — cendre, sol brûlé, Repaire.
 * MESURÉ sur la carte de production (seed 2026), autour de là où le joueur vit réellement :
 * **zéro** tuile brûlée dans la couronne de naissance (la plus proche à 74 tuiles), **zéro**
 * cendre avant le **jour 60**, Repaire le plus proche à 110 tuiles. Une naissance conditionnée
 * à une trace aurait supprimé le Cendreux de la nuit jusqu'au jour ~55.
 *
 * D'où la forme retenue : un CHAMP CONTINU, qui a un plancher partout et du relief là où le
 * monde est mort. La trace est une couleur, jamais une condition (R16).
 *
 * ═══ DÉRIVÉ, JAMAIS RANGÉ ═══
 *
 * Le champ n'ajoute **aucun octet au `SimState`** et **aucun tableau à la carte**. Il se lit en
 * O(1) de deux choses déjà présentes — `zoneTierAt` (le tier de la zone, au bloc) et
 * `estCendre` (le front, dérivé du tick). C'est le modèle de `cendre.ts`, et il vient d'un
 * invariant : *« le tick est la seule horloge ; toute notion dérivée est une fonction pure du
 * numéro de tick. Aucun état temporel redondant »* (`monde.md` R1).
 *
 * Pur et déterministe : `+ - * /`, `min`, `max`, `floor`, `sqrt` (invariant n°2).
 */
import { CENDREUX, MORTS, NIGHT_HUNT } from './balance'
import { estCendre, frontActuel } from './cendre'
import { isBlockedAt } from './collision'
import { emitEvent } from './events'
import { fireActive } from './fire'
import { distSq } from './geometry'
import { zoneTierAt, type WorldMap } from './map'
import { spawnMonster } from './monsters'
import { pathToward, solidesEternels } from './pathfinding'
import type { SimState } from './sim'

/**
 * UN SOL QUI TRAVAILLE — le Cendreux n'est pas encore là, mais il arrive.
 *
 * C'est le seul état neuf du chantier, et il est minimal à dessein : quatre nombres, aucun
 * objet, JSON-sérialisable — l'invariant de `SimState` l'exige (snapshot, transport Worker,
 * persistance). On a écarté de le porter par `Corpse`, dont la forme collait pourtant
 * (`risesAt` existe déjà) : un cadavre est MANGÉ par les prédateurs (`faune.ts`), FOUILLÉ par
 * les PNJ (`npc-errands.ts`), ouvrable au conteneur et expédié en entier à chaque client. Un
 * faux cadavre aurait fait venir les loups renifler un réveil.
 */
export interface Reveil {
  x: number
  y: number
  /** Le tick où il sort. */
  at: number
  /** Pour QUI le sol s'est réveillé — recopié sur `huntTargetId` à l'émergence. */
  preyId: number
}

/**
 * COMBIEN DE MORTS DORMENT SOUS CETTE TUILE — de `MORTS.PLANCHER` à 1.
 *
 * Ne rend JAMAIS zéro, et c'est la règle centrale (R16) : le champ possède l'intensité de la
 * nuit, pas son existence. `NIGHT_HUNT.UNDEAD_SHARE` possède déjà le « si », par acte, et il
 * marche. Trois fois aujourd'hui, une règle qui laissait la géographie *autoriser* la nuit l'a
 * rendue muette autour de chez le joueur ; le plancher est ce qui rend ce quatrième échec
 * impossible par construction plutôt que par vigilance.
 *
 * Sur une carte sans zones — un banc headless — `zoneTierAt` rend 0 et `estCendre` rend faux :
 * le champ y vaut son plancher, uniformément, et le tirage pondéré qui s'appuie dessus
 * redevient exactement uniforme. Le comportement d'un banc est donc préservé au bit près (R17).
 */
export function densiteDesMorts(state: SimState, tx: number, ty: number): number {
  const cendre = estCendre(state.map, tx, ty, frontActuel(state)) ? MORTS.PART_CENDRE : 0
  const d = densiteDeBase(state.map, tx, ty) + cendre
  return d > 1 ? 1 : d
}

/**
 * LA PART DU CHAMP QUI NE DÉPEND PAS DU TEMPS — plancher + tier, sans la cendre.
 *
 * Elle existe parce que les CHARNIERS se posent à la GÉNÉRATION (`placeCharniers`), quand il n'y
 * a ni tick ni `SimState` : le front n'a pas encore bougé, et il n'a rien à dire sur où la vallée
 * a enterré ses morts. Le terme de cendre reste donc à `densiteDesMorts` — c'est le seul des deux
 * qui soit une fonction du tick, et il doit le rester (R15).
 *
 * Un seul calcul pour les deux lectures : le semis des charniers et l'intensité de la nuit
 * penchent du même côté par construction, et non parce que deux formules se ressemblent.
 */
export function densiteDeBase(map: WorldMap, tx: number, ty: number): number {
  const tier = zoneTierAt(map, tx, ty)
  // Hors table, on retombe sur le DERNIER palier, pas sur le premier : un tier qu'on ajouterait
  // demain serait plus dur que ceux d'aujourd'hui, jamais plus doux. Le repli doit se tromper
  // du côté où le monde va.
  const part = MORTS.PART_TIER[tier] ?? MORTS.PART_TIER[MORTS.PART_TIER.length - 1]!
  return MORTS.PLANCHER + part
}

/**
 * COMBIEN DE RÔDEURS CE SOL PEUT PORTER, sur un plafond d'acte donné.
 *
 * Le plafond de `NIGHT_HUNT.UNDEAD_MAX_ALIVE` reste le TOIT ; la densité dit quelle part on en
 * atteint. À l'acte III (plafond 5) : deux rôdeurs sur le pré de son village, cinq aux marges
 * sous la cendre. Le joueur ne lit pas un nombre, il lit un LIEU.
 *
 * Le plancher à `MIN_RODEURS` est la même règle que celle du champ, vue d'un cran plus haut :
 * la densité MODULE, elle n'interdit pas. Sans lui, un plafond de 3 sur un sol à 0,25 rendrait
 * `ceil(0.75)` = 1 — ça tient encore — mais tout futur plafond bas retomberait à zéro, et on
 * aurait rebâti l'interrupteur qu'on vient de démonter.
 */
export function rodeursPortes(state: SimState, tx: number, ty: number, plafond: number): number {
  if (plafond <= 0) return 0
  const n = Math.ceil(plafond * densiteDesMorts(state, tx, ty))
  return n < MORTS.MIN_RODEURS ? MORTS.MIN_RODEURS : n
}

/**
 * OÙ LE SOL SE RÉVEILLE, autour d'une proie — ou `undefined` si vraiment rien ne convient.
 *
 * ═══ UNE COURONNE, PAS QUATRE DIAGONALES ═══
 *
 * L'ancien placement posait `ox` ET `oy` à ±`SPAWN_DIST` : quatre points, tous en diagonale, à
 * 21,2 tuiles — jamais 15, jamais de côté. On balaie désormais l'anneau
 * [`SPAWN_DIST` − `SPAWN_RING`, `SPAWN_DIST` + `SPAWN_RING`], soit ~200 tuiles : le danger peut
 * venir de partout, et le champ a enfin de la matière à pondérer.
 *
 * ═══ ET SON SOL MÈNE À LA PROIE ═══
 *
 * L'ancien point n'était que CLAMPÉ aux bords de carte — aucune marchabilité, aucune
 * joignabilité. C'est le bug exact que R12 vient de corriger pour la horde, et il coûtait ici
 * MESURÉ, sur 1 600 points : **14,0 % de naissances dans la roche ou un mur** et 4,2 % sur un
 * sol libre sans aucun chemin vers la proie — **18,2 % de nuits perdues**, en silence.
 *
 * ═══ UN SEUL TIRAGE (R19) ═══
 *
 * Le choix pondéré se fait sur la SOMME CUMULÉE des densités de l'anneau : un tirage, et il
 * tombe dans la tuile qui le contient. L'ancien en consommait deux (`ox`, `oy`).
 *
 * Le repli — la tuile élue est bloquée, ou injoignable — parcourt l'ordre cumulé à partir de
 * l'élue, sans jamais retirer. Une boucle de rejet aurait fait dépendre le flux du PRNG de la
 * FORME DU TERRAIN : le déterminisme serait resté vrai (même seed, même carte, même flux) mais
 * illisible, et toute retouche de worldgen aurait décalé des tests sans rapport.
 *
 * ═══ ET IL EST BORNÉ ═══
 *
 * L'A\* n'est payé qu'une fois en cas normal — seule la tuile élue est vérifiée. Mais un A\* qui
 * ÉCHOUE coûte son budget entier (4 096 tuiles explorées), et un repli non borné les enchaîne :
 * MESURÉ sur une proie ceinte de roche, **1 593 ms pour un seul réveil**, trente-deux fois le
 * budget d'un tick à 20 Hz. D'où `MORTS.ESSAIS_MAX` — les tuiles bloquées, elles, continuent de
 * défiler gratuitement.
 */
export function siteDansLaCouronne(
  state: SimState,
  px: number,
  py: number,
  tirage: number,
  /**
   * Le poids d'une tuile. Absent → uniforme, et c'est le cas du LOUP : il vient du bois, pas du
   * sol. Le champ des morts ne doit pondérer que ce qui se réveille — pondérer aussi la bête
   * aurait été gratuit à écrire et faux à lire. Ce qu'ils partagent, c'est la couronne et
   * l'exigence d'un sol qui mène à la proie ; le bug de placement n'avait pas d'espèce.
   */
  poids?: (tx: number, ty: number) => number,
  /**
   * La couronne, par espèce (R22). Absente → celle du LOUP, qui garde ses 15 tuiles parce
   * qu'il les couvre en trois secondes. Le mort naît bien plus près, et c'est le réveil qui
   * le paie en préavis — on ne rapproche que ce qui est lent.
   */
  couronne?: { dist: number; ring: number },
): { x: number; y: number } | undefined {
  const world = { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null, etat: state }
  // Le monde tel que la ROCHE le voit : ni murs ni portes — MAIS les SOLIDES ÉTERNELS
  // (le massif d'un antre, 2026-08-11) y sont : ils SONT de la roche. « La roche
  // disqualifie, le mur non » — un mort né derrière un massif ne serait pas une menace,
  // ce serait un décor, très exactement comme derrière une falaise.
  const terrainSeul = { map: state.map, nodes: state.nodes, structures: solidesEternels(state.structures), moverVillageId: null, etat: state }
  const dist = couronne?.dist ?? NIGHT_HUNT.SPAWN_DIST
  const ring = couronne?.ring ?? NIGHT_HUNT.SPAWN_RING
  const dMin = dist - ring
  const dMax = dist + ring
  const ptx = Math.floor(px)
  const pty = Math.floor(py)

  // L'anneau, balayé dans un ordre FIXE (row-major) : c'est lui qui rend le repli reproductible.
  const tuiles: { x: number; y: number; poids: number }[] = []
  let somme = 0
  const r = Math.floor(dMax) + 1
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy
      if (d2 < dMin * dMin || d2 > dMax * dMax) continue
      const x = ptx + dx
      const y = pty + dy
      if (x < 1 || y < 1 || x >= state.map.width - 1 || y >= state.map.height - 1) continue
      const p = poids ? poids(x, y) : 1
      somme += p
      tuiles.push({ x, y, poids: p })
    }
  }
  if (tuiles.length === 0) return undefined

  // Le tirage tombe dans la somme cumulée — la tuile la plus dense a la plus grosse part.
  let cible = tirage * somme
  // Défaut à la DERNIÈRE tuile, pas à la première : un tirage qui frôle 1 laisse un résidu
  // flottant positif et sortirait de la boucle sans avoir rien élu. Retomber sur l'index 0
  // aurait donné à la première tuile de l'anneau une part qu'elle n'a pas.
  let debut = tuiles.length - 1
  for (let i = 0; i < tuiles.length; i++) {
    cible -= tuiles[i]!.poids
    if (cible <= 0) {
      debut = i
      break
    }
  }

  // Le repli : à partir de l'élue, on avance dans l'ordre cumulé. Aucun tirage supplémentaire.
  let essais = 0
  for (let k = 0; k < tuiles.length && essais < MORTS.ESSAIS_MAX; k++) {
    const t = tuiles[(debut + k) % tuiles.length]!
    // Naître DANS un mur, non : la tuile elle-même se juge avec ses structures.
    if (isBlockedAt(world, t.x, t.y)) continue
    essais += 1
    // JOIGNABLE — MAIS PAR LE TERRAIN SEUL, et c'est la subtilité de toute la fonction.
    //
    // Un mort qui naît de l'autre côté d'une falaise n'est pas une menace, c'est un décor : la
    // roche doit le disqualifier. Un mur, NON — R3 dit précisément qu'un Cendreux qui ne peut
    // pas atteindre sa cible **frappe le franchissement qui le bloque**, et c'est ce qui donne
    // leur raison d'être aux murs, au toit et à la porte. Exiger un chemin à travers les
    // structures aurait donc supprimé le SIÈGE du canal de la nuit, en silence : le joueur qui
    // s'enclot serait redevenu intouchable — l'exact bug qu'A4 vient de fermer.
    //
    // On interroge donc un monde SANS structures — et ce n'est pas une invention : c'est
    // exactement ce que fait déjà `computeFlowField` pour la horde, pour la même raison écrite
    // dans les mêmes termes (*« les STRUCTURES sont ignorées : le gradient traverse les murs, et
    // le zombie qui bute dessus les frappe — c'est le siège naturel »*). La convergence de masse
    // et le rôdeur solitaire jugent enfin le terrain de la même façon.
    //
    // C'est aussi le chemin le moins cher : pas d'index d'occupation à bâtir, et le mur ne fait
    // plus échouer un A* jusqu'à épuiser son budget.
    const chemin = pathToward(terrainSeul, t.x + 0.5, t.y + 0.5, ptx, pty)
    if (!chemin || chemin.length === 0) continue
    return { x: t.x + 0.5, y: t.y + 0.5 }
  }
  return undefined
}

/**
 * LE SOL TRAVAILLE, PUIS IL REND SON MORT — ou le feu l'en empêche (spec `cendreux.md` R21).
 *
 * ═══ LA PARADE, GÉNÉRALISÉE ═══
 *
 * S4 disait déjà : *« un cadavre près d'un feu allumé ou en braises ne se relève pas »*, et R9
 * le maintient mot pour mot. Mais cette règle ne servait qu'un canal — la levée d'un cadavre —
 * et la mesure a montré qu'il ne se déclenchait qu'**une fois par saison**. Autant dire jamais.
 *
 * Le réveil lui donne enfin sa fréquence. Le sol se soulève à sept tuiles, ça s'annonce, et le
 * joueur a `MORTS.REVEIL_TICKS` pour rallumer son feu : *on veille ses morts au feu, ou ils
 * reviennent* devient le geste de chaque nuit au lieu d'une ligne de lore. La garde est la
 * MÊME (`CENDREUX.HEARTH_WARD_RADIUS`, `fireActive` — donc braises comprises) : on ne lui
 * apprend pas une deuxième règle, on lui donne enfin des occasions de servir.
 *
 * ═══ AUCUN TIRAGE ═══
 *
 * Ni ici ni à l'émergence : le site et l'instant ont été décidés à la plantation. Le flux du
 * PRNG ne dépend donc pas de la durée du réveil, ni du fait qu'un feu l'ait annulé — sans quoi
 * allumer un feu aurait décalé le monde entier (invariant n°2).
 */
export function advanceReveils(state: SimState): void {
  if (state.reveils.length === 0) return
  const ward = CENDREUX.HEARTH_WARD_RADIUS
  const restants: Reveil[] = []
  for (const r of state.reveils) {
    // LE FEU VEILLE — et il veille pendant TOUT le réveil, pas seulement à l'instant de sortir.
    // C'est ce qui en fait une parade qu'on peut JOUER : on voit le sol travailler, on rallume.
    const veille = state.structures.some(
      (s) => s.type === 'fire' && fireActive(state, s) && distSq(s.tx + 0.5, s.ty + 0.5, r.x, r.y) <= ward * ward,
    )
    if (veille) {
      emitEvent(state, { type: 'reveil_etouffe', tick: state.tick, x: r.x, y: r.y })
      continue
    }
    if (state.tick < r.at) {
      restants.push(r)
      continue
    }
    // IL SORT. Le sac reste à ZÉRO : celui-là n'hérite d'aucun cadavre (A11) — seule la levée
    // demande ses 40 cases, et douze inventaires vides par snapshot coûtaient cher (voir la
    // note de `spawnMonster`).
    const id = spawnMonster(state, 'cendreux', r.x, r.y)
    const monster = state.monsters.find((m) => m.entityId === id)
    if (monster) {
      monster.ambient = true // il se dissipera comme la faune : pas d'accumulation
      monster.nightHunter = true // il MORD : exempté d'un courage qu'il ne pourrait satisfaire
      monster.huntTargetId = r.preyId // pour QUI il est venu — stable, contrairement à `targetId`
      monster.targetId = r.preyId
    }
    // On RÉUTILISE `cendreux_risen` : « un cendreux se relève » est exactement le fait qui
    // vient de se produire, et il a déjà sa voix à l'inventaire. Un second événement pour la
    // même chose aurait forcé chaque consommateur (chronique, son, alignement) à connaître
    // deux noms pour un fait.
    emitEvent(state, { type: 'cendreux_risen', tick: state.tick, entityId: id, x: r.x, y: r.y })
  }
  state.reveils = restants
}
