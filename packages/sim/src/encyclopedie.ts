/**
 * ═══ LE CARNET DE L'ENCYCLOPÉDIE (décision d'Alexis, 2026-08-24) ═══
 *
 * *Une entrée jamais rencontrée ne dit rien.* La règle du bestiaire (`peche.md` R11 : « une
 * espèce jamais prise ne dit rien ») s'étend à TOUTE l'encyclopédie — ressources, nourriture,
 * outils, armes, bêtes, monstres, saisons. Pas de nom, pas d'icône, pas de fiche. Ce module
 * tient la seule chose dont l'écran a besoin pour trancher : **ce que ce joueur a rencontré,
 * et combien de fois**.
 *
 * IL NE S'INSTRUMENTE NULLE PART. C'est un CONSOMMATEUR du flux d'événements (règle de projet :
 * « on n'instrumente jamais la logique après coup ») — il lit `state.events` en fin de tick,
 * avant que l'hôte ne le draine, et n'ajoute pas une ligne dans la récolte, le craft ou le
 * combat. Une action neuve qui émet son fait entre au carnet sans qu'on y touche.
 *
 * ⚠ **`peche` reste le carnet des POISSONS** (spec `peche.md` B5) : il porte le RECORD en
 * millimètres, que celui-ci ne saurait dire. Les deux cohabitent — l'écran lit l'un pour les
 * prises, l'autre pour tout le reste.
 *
 * DÉTERMINISME. Aucun tirage, aucune horloge : on balaie `state.events` dans l'ordre d'émission
 * et les entités dans l'ordre du tableau. Le carnet est un TABLEAU de `{ k, n }` (invariant §3 :
 * ni `Map` ni `Set`, il voyage dans le snapshot), poussé dans cet ordre — donc trié par
 * construction. Même seed + mêmes inputs ⇒ même carnet.
 *
 * SEULS LES JOUEURS EN ONT UN. Un PNJ qui bûcheronne toute la saison alourdirait chaque
 * snapshot d'un carnet que personne ne lira jamais (même garde que `knownPois`, `poi-discovery`).
 */
import { BALANCE, RECIPES } from './balance'
import type { SimState } from './sim'
import { baselineTemperature } from './temperature'
import { jourDeSaison, phaseForDay } from './time'

/**
 * LE VERBE d'une rencontre. Il n'y en a pas un par section : c'est le GESTE qui compte, et
 * deux sections peuvent partager le même (le bois se récolte, le sel aussi). L'écran choisit
 * lequel il montre ; le carnet, lui, les tient tous.
 */
export type VerbeCarnet = 'recolte' | 'fabrique' | 'mange' | 'abat' | 'vecu' | 'froid' | 'chaud'

/**
 * LES DEUX VERBES QUI NE COMPTENT PAS (2026-08-25, décision d'Alexis : « je veux qu'on garde
 * les températures max et min RENCONTRÉES par le joueur »).
 *
 * `froid` et `chaud` portent un RELEVÉ, pas un compte : le plus froid et le plus chaud que ce
 * joueur a endurés dans cette saison-là, en °C. Ils vivent dans le même carnet parce que c'est
 * exactement la même chose que le reste — *ce que ce joueur a rencontré* — et parce qu'un
 * second tableau aurait demandé un champ de snapshot, une clé de persistance et quatre relais
 * côté client pour deux nombres.
 *
 * ⚠ CE QU'ON RELÈVE EST LA TEMPÉRATURE DU LIEU (`baselineTemperature` — le front et l'abri
 * compris, NI le feu NI la source chaude). Prendre le ressenti aurait fait dire à la fiche
 * « le plus chaud du Grand Froid : +20 °C » à qui a passé la saison collé à son feu : c'est le
 * feu qu'on aurait mesuré, pas la saison.
 */
export const VERBES_DE_RELEVE: readonly VerbeCarnet[] = ['froid', 'chaud']

/** Une ligne du carnet : une clé `verbe:id`, et le compte — ou, pour `froid`/`chaud`, le RELEVÉ. */
export interface LigneEncyclo {
  k: string
  n: number
}

/** La clé d'une ligne. UNE seule fabrique, pour que l'écran et la sim ne divergent pas. */
export function cleEncyclo(verbe: VerbeCarnet, id: string): string {
  return `${verbe}:${id}`
}

/** Combien de fois ce joueur a fait ça. `0` = jamais — donc MUET, côté écran. */
export function compteEncyclo(carnet: readonly LigneEncyclo[] | undefined, verbe: VerbeCarnet, id: string): number {
  if (carnet === undefined) return 0
  const k = cleEncyclo(verbe, id)
  return carnet.find((l) => l.k === k)?.n ?? 0
}

/**
 * A-T-IL RENCONTRÉ CETTE ENTRÉE, PAR QUELQUE GESTE QUE CE SOIT ?
 *
 * ⚠ C'est cette question-là que pose le MUET, pas celle du verbe de sa section. Une viande
 * séchée qu'on a fabriquée sans jamais la manger est connue : on l'a eue en main. Trancher sur
 * le seul verbe d'affichage rendrait muette une case dont le joueur a le stock dans son sac —
 * et l'encyclopédie mentirait sur ce qu'il sait.
 */
export function connuEncyclo(carnet: readonly LigneEncyclo[] | undefined, id: string): boolean {
  if (carnet === undefined) return false
  const suffixe = `:${id}`
  // ⚠ LES RELEVÉS NE SONT PAS DES RENCONTRES. `chaud:3` vaut +11 (des degrés), et sans cette
  // garde une saison traversée rendrait « connu » toute entrée dont l'id est « 3 ». Aucun objet
  // ne s'appelle « 3 » aujourd'hui — c'est bien pour ça qu'il faut l'écrire maintenant.
  return carnet.some((l) => l.n > 0 && l.k.endsWith(suffixe) && !VERBES_DE_RELEVE.some((v) => l.k.startsWith(`${v}:`)))
}

/**
 * LE RELEVÉ D'UNE SAISON — le plus froid ou le plus chaud endurés, en °C. `undefined` si cette
 * saison n'a jamais été traversée : l'écran n'a alors rien à dire (même règle que le muet).
 */
export function extremeEncyclo(
  carnet: readonly LigneEncyclo[] | undefined,
  verbe: 'froid' | 'chaud',
  id: string,
): number | undefined {
  if (carnet === undefined) return undefined
  return carnet.find((l) => l.k === cleEncyclo(verbe, id))?.n
}

/**
 * POUSSE UN RELEVÉ VERS SON EXTRÊME. `sens < 0` garde le plus petit, `sens > 0` le plus grand.
 * Rien à voir avec `noter` : on n'additionne pas des degrés.
 */
function noterExtreme(carnet: LigneEncyclo[], verbe: VerbeCarnet, id: string, valeur: number, sens: number): void {
  const k = cleEncyclo(verbe, id)
  const ligne = carnet.find((l) => l.k === k)
  if (ligne === undefined) carnet.push({ k, n: valeur })
  else if (sens < 0 ? valeur < ligne.n : valeur > ligne.n) ligne.n = valeur
}

/** Ajoute `n` au compte de `verbe:id`. Pousse la ligne si elle n'existait pas. */
function noter(carnet: LigneEncyclo[], verbe: VerbeCarnet, id: string, n: number): void {
  if (n <= 0) return
  const k = cleEncyclo(verbe, id)
  const ligne = carnet.find((l) => l.k === k)
  if (ligne === undefined) carnet.push({ k, n })
  else ligne.n += n
}

/**
 * LE CARNET AVANCE — appelé en fin de tick, AVANT le drain de l'hôte (le Worker comme le
 * serveur drainent après `step`).
 *
 * ⚠ `depuis` EST LA LONGUEUR DU BUFFER AU DÉBUT DU TICK, et ce n'est pas un détail : le
 * buffer n'est vidé que par l'HÔTE. Un appelant qui ne draine pas — un test, un banc, un
 * outil headless — le laisse grossir, et compter le buffer entier recompterait la même
 * récolte à chaque tick jusqu'au drain (CONSTATÉ : 5 flèches devenaient 610). On ne lit
 * donc que la tranche que CE tick a écrite, et le carnet dit la même chose que le drain
 * ait lieu ou non.
 */
export function advanceEncyclopedie(state: SimState, depuis: number): void {
  // ── CE QUI SE PASSE À CHAQUE TICK DOIT ÊTRE GRATUIT QUAND IL NE SE PASSE RIEN ──
  // Le carnet vit dans la boucle chaude : bâtir deux `Set` sur ~600 bêtes et rebalayer les
  // joueurs vingt fois par seconde se paierait sur toute la sim pour, l'écrasante majorité du
  // temps, ne rien écrire. On ne fait donc le travail que s'il y a quelque chose à écrire.
  const saison = phaseForDay(jourDeSaison(state))
  const entre = saison !== phaseForDay(jourDeSaison(state, state.tick - 1))
  // LA PASSE DE SAISON une fois par seconde suffit (et à l'entrée d'une saison, tout de suite) :
  // elle n'existe que pour les joueurs qui n'ont pas encore la ligne de la saison en cours — un
  // avatar qui vient d'apparaître, un monde qui vient d'ouvrir. Une seconde de retard sur une
  // saison de trente jours ne se voit pas ; le coût par tick, lui, se mesurerait.
  // ⚠ `=== 1`, PAS `=== 0` : `advanceEncyclopedie` passe APRÈS `advanceTime`, donc le PREMIER
  // tick d'un monde s'y présente avec `tick` valant déjà 1. Caler la cadence sur 0 aurait fait
  // attendre une seconde entière à la saison d'ouverture — et le test l'a vu tout de suite.
  const passeSaison = entre || state.tick % BALANCE.TICK_RATE_HZ === 1
  const aDesFaits = state.events.length > depuis
  if (!passeSaison && !aDesFaits) return

  const npcIds = new Set(state.npcs.map((n) => n.entityId))
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  const estJoueur = (id: number): boolean => !npcIds.has(id) && !monsterIds.has(id)
  /** Le carnet de ce joueur, créé au besoin — `undefined` si l'auteur n'est pas un joueur. */
  const carnetDe = (id: number): LigneEncyclo[] | undefined => {
    if (!estJoueur(id)) return undefined
    const e = state.entities.find((x) => x.id === id)
    return e === undefined ? undefined : (e.carnet ??= [])
  }
  /** Note, si et seulement si l'auteur est un joueur. */
  const noterPour = (id: number, verbe: VerbeCarnet, quoi: string, n: number): void => {
    const carnet = carnetDe(id)
    if (carnet !== undefined) noter(carnet, verbe, quoi, n)
  }

  for (let i = depuis; i < state.events.length; i++) {
    const ev = state.events[i]!
    switch (ev.type) {
      // ── CE QU'ON PREND AU MONDE ──
      case 'resource_harvested':
        noterPour(ev.entityId, 'recolte', ev.item, ev.count)
        break
      // Le dépeçage est une récolte : la carcasse est un gisement qu'on vide (depecage.md).
      case 'carcass_cut':
        noterPour(ev.entityId, 'recolte', ev.item, 1)
        break
      // ── CE QU'ON FAIT DE SES MAINS ──
      case 'item_crafted':
        noterPour(ev.entityId, 'fabrique', ev.item, RECIPES[ev.recipeId]?.count ?? 1)
        break
      // ── CE QU'ON MANGE ──
      case 'meal_eaten':
        noterPour(ev.entityId, 'mange', ev.item, 1)
        break
      // ── CE QU'ON ABAT ── (le tueur seul : voir un loup mourir n'apprend pas le loup)
      case 'monster_slain':
        noterPour(ev.byEntityId, 'abat', ev.monsterType, 1)
        break
      default:
        break
    }
  }

  // ── CE QU'ON TRAVERSE ──
  // La saison ne s'émet pas comme une prise : on la VIT, simplement en étant là. On la note
  // donc à l'entrée dans la saison — et, au tout premier tick d'un monde, pour celle qui est
  // déjà en cours (sinon la saison de naissance ne serait jamais comptée, et un joueur né aux
  // Pluies aurait un `???` sur la saison qu'il est en train de vivre).
  if (!passeSaison) return
  for (const e of state.entities) {
    if (!estJoueur(e.id)) continue
    const carnet = (e.carnet ??= [])
    if (entre || compteEncyclo(carnet, 'vecu', String(saison)) === 0) {
      noter(carnet, 'vecu', String(saison), 1)
    }
    // ── CE QU'ON A ENDURÉ ──
    // Une fois par seconde suffit : le froid du monde est une rampe lente (l'heure, l'acte, la
    // bande météo), et rater une seconde ne peut pas rater un extrême. Arrondi au dixième de
    // degré — le snapshot n'a pas à porter dix-sept décimales d'un flottant.
    const t = Math.round(baselineTemperature(state, e.x, e.y) * 10) / 10
    noterExtreme(carnet, 'froid', String(saison), t, -1)
    noterExtreme(carnet, 'chaud', String(saison), t, 1)
  }
}
