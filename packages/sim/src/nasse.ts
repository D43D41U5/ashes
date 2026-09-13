/**
 * ═══ LA NASSE — LA PÊCHE QUI TRAVAILLE SANS NOUS (spec `nasse.md`) ═══
 *
 * Reprise de l'eau **D3** (« à quoi sert un roseau »), quatre décisions d'Alexis du 2026-09-13 :
 * un roseau sert à faire une **nasse** ; elle est **appâtée** (la prise est proportionnelle à
 * l'appât dépensé) ; elle est **personnelle**, relevée à la main ; c'est un **ouvrage posé** —
 * une pièce du registre, donc qu'on peut **perdre**.
 *
 * ═══ CE MODULE EST UN ASSEMBLAGE, PAS UN SYSTÈME ═══
 *
 * Tout le savoir est ailleurs, et c'est le but. La nasse appelle EXACTEMENT la chaîne de la canne
 * — `conditionsAt` → `tableDePrises` → `tirerLigne` (`peche-table.ts`) — sur sa propre tuile. Elle
 * hérite donc **sans une ligne de plus** :
 *   · **la nature du lieu** (rivière ≠ lac ≠ mare) — c'est la promesse « le lieu dicte la prise » ;
 *   · **la saison et le créneau horaire** ;
 *   · **la souillure** (`eauSouillee` via `conditionsAt` ; `especeRetenue` ÉCHANGE la table) —
 *     le branchement sur la qualité de l'eau (D1) est intégral et gratuit ;
 *   · **le gel, l'assec et la vase** — par `eauIndisponible`, le prédicat MÊME du flotteur, et
 *     NON par `conditionsAt` : `natureDeLEau` ne consulte que `porteDeLEau` (« l'eau est-elle
 *     LÀ »), or une eau GELÉE garde sa nature — donc sa table. C'est la seule garde de bridage
 *     écrite ici, et elle l'est parce que son absence passait au VERT (voir la boucle).
 *
 * Et aucune matière neuve : la `fiber` de la roselière la bâtit (les « roseaux, sphaigne » que
 * `economy.ts` y sème déjà), `worms` l'appâte (l'appât que la canne consomme déjà). **Ni item
 * `roseau`, ni nœud neuf** — l'empreinte de carte ne bouge pas d'un bit.
 *
 * ═══ DÉTERMINISME ═══
 *
 * UN SEUL tirage par tentative pour la table, et `tirerLaTaille` en fait TROIS quelle que soit
 * la branche (son invariant, pas le nôtre) : le compte de tirages ne dépend donc que de l'issue
 * — poisson = 1+3, rien/trouvaille = 1 —, exactement comme la canne. **Sans nasse posée, ce
 * module ne tire RIEN** : les mondes et les tests qui n'en ont pas ne voient pas leur flux seedé
 * décalé d'un cran (la leçon coûteuse du décompte d'entités).
 *
 * Le niveau d'eau est hoisté **à la demande** : une nasse qui ne tente pas ne paie pas le
 * rembobinage de huit cycles d'élection météo que `niveauDEau` coûte (E5, comme les pêcheurs).
 */
import { NASSE } from './balance'
import { niveauDEau } from './eau'
import { emitEvent } from './events'
import { addItems, countOf, freeRoomFor, removeItems } from './items'
import { conditionsAt, tableDePrises, tirerLigne } from './peche-table'
import { eauIndisponible, portionsDe, tirerLaTaille } from './economy'
import { rngRoll } from './rng'

import type { FishId } from './balance'
import type { Inventory, ItemId } from './items'
import type { TableDePrises } from './peche-table'
import type { SimState } from './sim'
import type { Structure } from './village'

/**
 * LA RELÈVE DES NASSES, TICK APRÈS TICK — appelée par `step()`.
 *
 * L'ORDRE DES GARDES EST LE COÛT : le type, puis la cadence (un modulo), puis le panier, et
 * seulement alors l'eau et le PRNG. Un monde sans nasse paie une lecture de propriété par
 * structure, comme `advanceCultures` — et rien d'autre.
 */
export function advanceNasses(state: SimState): void {
  let niveau: number | undefined
  for (const s of state.structures) {
    if (s.type !== 'fish_trap') continue
    // LA CADENCE, DÉCALÉE PAR `id` (N6) : deux nasses posées à des ticks différents ne battent
    // pas ensemble, et ça ne coûte AUCUN champ d'état — `id` est stable au rejeu comme à la
    // sauvegarde. Entre deux tentatives : ni nature de l'eau, ni tirage.
    if ((state.tick + s.id) % NASSE.CADENCE_TICKS !== 0) continue
    const inv = s.inventory
    if (inv === undefined) continue
    // ═══ PLEINE ? DEUX BORNES, et dans les deux cas AUCUN APPÂT CONSOMMÉ (N10) ═══
    //
    // Une nasse pleine attend qu'on la relève, elle ne gâche pas les vers — et elle repart sans
    // aucun geste dès que la relève lui rend de la place.
    //
    // ⚠ LA PREMIÈRE BORNE EST LA VRAIE, et s'en remettre aux CASES était un plafond FICTIF : les
    // poissons crus s'empilent par 5, donc huit cases ne bornent pas huit prises mais huit PILES
    // — une trentaine de portions pour un ouvrage à huit fibres que personne ne surveille, et la
    // pêche passive sortait la canne du jeu.
    if (prisesStockees(inv) >= NASSE.CAPACITE) continue
    // La seconde borne reste nécessaire : sans case libre, rien ne RENTRERAIT (`ranger` l'exige).
    if (!inv.some((sl) => sl === null)) continue
    if (niveau === undefined) niveau = niveauDEau(state)
    // ═══ L'EAU EST-ELLE PÊCHABLE AUJOURD'HUI ? — LE PRÉDICAT DE LA CANNE, PAS UN AUTRE ═══
    //
    // ⚠ `conditionsAt` NE SUFFIT PAS, et c'est le piège de ce module : `natureDeLEau` ne consulte
    // que `porteDeLEau` (l'eau est-elle LÀ) — une eau GELÉE garde sa nature, donc sa table. Le
    // refus du gel vit dans `eauIndisponible` (« l'eau est prise », `peche.md` D7①), et c'est
    // exactement le prédicat que le flotteur interroge. Une nasse qui pêcherait à travers la
    // glace serait passée VERTE sur la seule table (N7).
    //
    // Il couvre les TROIS pertes d'un coup — gel, assec (N8), vase — et L'APPÂT EST PRÉSERVÉ :
    // on ne brûle pas des vers à pêcher dans la glace.
    if (eauIndisponible(state, s.tx, s.ty, niveau) !== null) continue
    const c = conditionsAt(state, s.tx, s.ty, false, niveau)
    if (c === null) continue
    // APPÂTÉE (N3) : pas d'appât, pas de prise. Jamais « moins » — RIEN.
    const appat = trouverLAppat(inv)
    if (appat === null) continue
    removeItems(inv, { [appat.item]: 1 }) // N4 : EXACTEMENT un par tentative — c'est le lien « prise ∝ appât »
    const table = tableDePrises(c)
    appliquerLePouvoirDeLAppat(table, appat.rienDiv)
    const { value, next } = rngRoll(state.rngState)
    state.rngState = next
    const ligne = tirerLigne(table, value)
    // « RIEN » : l'appât a nourri sans rien donner. Il est DÉPENSÉ quand même — c'est le frein
    // de la table (sans lui, une nasse serait un robinet), et c'est ce qui fait qu'une eau
    // pauvre rend moins PAR APPÂT. La nature module la nasse comme elle module la canne.
    if (ligne.kind === 'rien') continue
    if (ligne.kind === 'trouvaille') {
      ranger(state, s, inv, ligne.trouvaille.item, 1)
      continue
    }
    // LA TAILLE, À NIVEAU 0 — personne ne tenait la ligne : la maîtrise d'un pêcheur ne peut pas
    // biaiser une prise qu'il n'a pas ferrée (et c'est aussi ce qui garde la nasse honnête face
    // à la canne d'un expert).
    const sp = ligne.species
    const mm = tirerLaTaille(state, sp, 0)
    ranger(state, s, inv, sp.id, portionsDe(sp, mm), sp.id, mm)
  }
}

/**
 * LA PRISE STOCKÉE — tout ce qui n'est PAS de l'appât. C'est exactement ce que `NASSE.CAPACITE`
 * borne, et l'appât en est exclu exprès : garnir sa nasse de vers ne doit pas voler la place du
 * poisson, sinon « appâter » et « relever » deviendraient le même geste.
 */
function prisesStockees(inv: Inventory): number {
  let n = 0
  for (const sl of inv) {
    if (sl === null) continue
    if (NASSE.APPATS[sl.item] !== undefined) continue
    n += sl.count
  }
  return n
}

/**
 * L'APPÂT À DÉPENSER — le PREMIER présent dans l'ordre de `NASSE.APPATS`, et **cet ordre EST la
 * règle** : il décide quoi part en premier quand le panier porte des vers ET de la viande. Le
 * moins cher d'abord, pour que le joueur ne perde pas sa viande sans l'avoir voulu.
 */
function trouverLAppat(inv: Inventory): { item: ItemId; rienDiv: number } | null {
  for (const [item, pouvoir] of Object.entries(NASSE.APPATS)) {
    if (pouvoir === undefined) continue
    if (countOf(inv, item as ItemId) > 0) return { item: item as ItemId, rienDiv: pouvoir.rienDiv }
  }
  return null
}

/**
 * LE POUVOIR DE L'APPÂT (« où je dépense ») — il DIVISE le poids du « rien », le levier même
 * dont se sert un coin de pêche (`COIN_RIEN_DIV`). Un appât riche fait mordre plus par appât
 * dépensé ; il ne DÉBLOQUE aucune espèce : *la géographie module, elle n'autorise jamais* —
 * et un appât non plus.
 *
 * Sur la table qu'on vient de bâtir, jamais sur une table partagée : `tableDePrises` en rend
 * une NEUVE à chaque appel (ses lignes sont des objets frais), donc la muter ici est sans effet
 * de bord. Plancher à 1 : même le meilleur appât du monde ne garantit pas la touche.
 */
function appliquerLePouvoirDeLAppat(table: TableDePrises, rienDiv: number): void {
  if (rienDiv <= 1) return
  const rien = table.lignes.find((l) => l.kind === 'rien')
  if (rien === undefined) return
  const reduit = Math.max(1, Math.floor(rien.weight / rienDiv))
  table.total -= rien.weight - reduit
  rien.weight = reduit
}

/**
 * RANGER LA PRISE DANS LE PANIER — et le DIRE (N15).
 *
 * Deux événements, comme la canne : le fait spécifique (`nasse_caught`, ancré sur l'OUVRAGE —
 * personne ne tenait la ligne) et le flux commun que la chronique lit (`resource_harvested`,
 * attribué au propriétaire, `nodeId: -1` : aucun nœud n'a été entamé). **Ni bestiaire, ni record,
 * ni XP** : une prise qu'on n'a pas ferrée n'est pas un exploit de pêcheur.
 *
 * On range CE QUI RENTRE, comme `landFish` : une prise de 4 portions dans un panier qui n'en
 * prend que 2 en range 2 — jeter les quatre serait une punition sans raison lisible. Et « ce qui
 * rentre » se lit contre les DEUX bornes : la place des cases **et** le plafond de prise — sans
 * quoi une dernière touche ferait déborder `NASSE.CAPACITE` de toute sa portée.
 */
function ranger(state: SimState, s: Structure, inv: Inventory, item: ItemId, voulu: number, species?: FishId, mm?: number): void {
  const place = Math.min(freeRoomFor(inv, item), NASSE.CAPACITE - prisesStockees(inv))
  if (place <= 0) return // garanti impossible (case libre ET plafond non atteint, exigés plus haut), jamais silencieux pour autant
  const count = Math.min(voulu, place)
  addItems(inv, { [item]: count })
  emitEvent(state, {
    type: 'nasse_caught',
    tick: state.tick,
    structureId: s.id,
    ownerId: s.ownerId,
    tx: s.tx,
    ty: s.ty,
    item,
    count,
    ...(species !== undefined && mm !== undefined ? { species, mm } : {}),
  })
  emitEvent(state, { type: 'resource_harvested', tick: state.tick, entityId: s.ownerId, nodeId: -1, item, count })
}
