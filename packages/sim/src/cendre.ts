/**
 * LE FRONT DE CENDRE — la saison n'est plus un compteur qui durcit, c'est une VALLÉE QU'ON PERD.
 *
 * *Décision d'Alexis, 2026-07-14 : « on a une zone T2 à côté de la zone de départ — est-ce qu'on
 * n'en ferait pas notre zone de propagation de la difficulté ? Comme on pousse les joueurs à
 * migrer au fur et à mesure vers des zones plus haut niveau. »*
 *
 * ═══ CE QUE ÇA REQUALIFIE ═══
 *
 * La Cendrière était une zone T2 posée au pas de la porte pour le FRISSON (spec R13 : « de chez
 * toi, tu vois l'enfer »). Elle devient un **MOTEUR** : l'enfer que tu vois est celui qui viendra
 * te chercher. Un compte à rebours planté dans ton jardin.
 *
 * Et les trois actes du GDD trouvent enfin un LIEU. Le troisième **s'appelle déjà « Cendre »** —
 * mais ce n'était qu'un multiplicateur de faim, un nombre qui monte. Désormais il a une
 * géographie. Personne ne dit au joueur de migrer : **le sol brûle derrière lui.**
 *
 * ═══ ZÉRO OCTET DANS L'ÉTAT ═══
 *
 * On ne MUTE pas la carte. Et on ne stocke même pas le front : **il ne coûte RIEN au `SimState`.**
 *
 * On avait prévu d'y ranger un scalaire (l'avancée du front, en tuiles) — c'était déjà bon marché.
 * Mais un scalaire dérivable du tick est de **l'état REDONDANT**, et l'invariant du monde l'interdit
 * en toutes lettres : *« le tick est la seule horloge ; toute notion dérivée est une fonction pure
 * du numéro de tick »* (spec `monde.md` R1). L'état redondant finit toujours par diverger de sa
 * source. Le front est donc **calculé, jamais rangé**.
 *
 * Tout se dérive de deux choses statiques, posées à la génération :
 *
 *     map.cendre[i]   la distance de la tuile à la frontière de la Cendrière (négative dedans)
 *     map.cendreMax   l'avancée finale du front, CALIBRÉE pour cette carte
 *
 *     une tuile brûle  ⟺  map.cendre[i] < front(tick)
 *
 * Les replays retrouvent le front exactement sans qu'on l'ait sérialisé ; le client le recalcule
 * du tick, sans qu'on lui transmette une seule tuile.
 *
 * Pur et déterministe : `+ - * /` et `sqrt` (invariant n°2).
 */
import { BALANCE } from './balance'
import { emitEvent } from './events'
import type { WorldMap } from './map'
import type { SimState } from './sim'
import { seasonDayAtTick } from './time'

export const CENDRE = {
  /**
   * L'ACTE OÙ LE FRONT S'ÉBRANLE. Avant, la Cendrière reste chez elle — le joueur a le temps de
   * bâtir, de s'attacher, et de croire que ça durera.
   *
   * Acte I : rien. Acte II : la cendre se met en marche. Acte III : elle dévore.
   * (C'est le calendrier du GDD, à la lettre — son troisième acte s'appelle « Cendre ».)
   */
  ACTE_DEPART: 2,

  /**
   * LA PART DES PRÉS BAS QUE LA CENDRE AURA MANGÉE au dernier jour — **la cible, pas la distance**.
   *
   * *Décision d'Alexis : « elle en mange une grosse part ».* Les villages du sud doivent partir ;
   * ceux du nord tiennent. **La vallée rétrécit sans disparaître** — il reste toujours un endroit
   * où naître, et c'est ce qui rend le jeu jouable pour qui rejoint au jour 40.
   *
   * ET C'EST UNE PART, PAS UNE DISTANCE — la correction est là, et elle vaut d'être dite. On avait
   * d'abord fixé l'avancée maximale du front à un nombre de tuiles (340). Mesuré : la même valeur
   * couvrait **48 % des Prés Bas sur une seed et 81 % sur une autre** — la forme des zones change
   * tout. C'était une LOTERIE, et sur un jeu où **une saison = une carte = une seed pendant des
   * semaines**, une loterie qui décide si la vallée brûle à moitié ou aux quatre cinquièmes n'est
   * pas acceptable.
   *
   * On vise donc la PART, et on calibre la distance **par carte**, à la génération (`calibreLeFront`
   * — une dichotomie, quelques passes sur les tuiles de la racine). La promesse est alors tenue sur
   * TOUTE seed, par construction.
   */
  PART_CIBLE: 0.6,

  /** Bornes de la dichotomie de calibrage, en tuiles. Large : la forme des zones varie beaucoup. */
  AVANCEE_MIN: 0,
  AVANCEE_PLAFOND: 2000,

  /**
   * LA COURBE. Le front n'avance pas linéairement : il ACCÉLÈRE.
   *
   * Une progression linéaire donne une menace qu'on s'habitue à voir bouger. Une progression qui
   * accélère donne une menace qu'on croit maîtriser — jusqu'au jour où elle traverse le village
   * en une nuit. L'exposant vaut 2 : la moitié de la saison n'a mangé qu'un quart du chemin.
   *
   * (`t × t`, pas `t ** 2` : l'opérateur de puissance est interdit dans /sim — il n'est pas exact
   * entre moteurs JS, invariant n°2.)
   */
  COURBE: (t: number): number => t * t,
}

/**
 * LE CHAMP DE CENDRE — la distance de chaque tuile à la frontière de la Cendrière.
 *
 * Négative DEDANS (la Cendrière brûle depuis le premier jour), positive dehors, en tuiles. C'est
 * de la donnée STATIQUE de carte : calculée une fois, jamais modifiée. Ce qui bouge, c'est le
 * seuil qu'on lui compare.
 *
 * On le dérive du diagramme de puissance, exactement comme la marge des frontières : la
 * « puissance » d'un site est `distance² − poids`, et l'écart de puissance entre deux sites,
 * divisé par `2 × d(sites)`, EST une distance en tuiles. On mesure donc simplement la puissance
 * de la Cendrière contre celle du propriétaire de la tuile.
 *
 * CONSÉQUENCE HEUREUSE : le front épouse la **forme réelle** de la Cendrière (frontière tordue par
 * le bruit comprise) au lieu d'être un disque. Il avance comme une marée, pas comme une explosion.
 */
export function computeCendreField(
  width: number,
  height: number,
  distanceALaCendriere: (x: number, y: number) => number,
): number[] {
  const out = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = distanceALaCendriere(x, y)
    }
  }
  return out
}

/**
 * L'AVANCÉE DU FRONT au jour de saison donné, en tuiles.
 *
 * Zéro pendant l'acte I : le joueur a le temps de bâtir et de s'attacher. Puis ça accélère.
 */
export function avanceeDuFront(jourDeSaison: number, avanceeMax: number): number {
  // La fin de l'acte I : c'est là que la cendre s'ébranle.
  const debut = BALANCE.ACT_BOUNDARIES[CENDRE.ACTE_DEPART - 2] ?? 21
  if (jourDeSaison <= debut) return 0
  const t = (jourDeSaison - debut) / (BALANCE.SEASON_DAYS - debut)
  const borne = t < 0 ? 0 : t > 1 ? 1 : t
  return avanceeMax * CENDRE.COURBE(borne)
}

/**
 * LE CALIBRAGE DU FRONT — on vise une PART, on en déduit une DISTANCE.
 *
 * Dichotomie sur l'avancée : quelle distance brûle exactement `PART_CIBLE` des tuiles de la racine ?
 * Trente itérations suffisent à cadrer au dixième de tuile — et c'est calculé UNE FOIS, à la
 * génération. Le résultat vit dans la carte (`map.cendreMax`), pas dans l'état.
 *
 * `estRacine` exclut les couloirs de seuil : un seuil n'appartient à aucune des zones qu'il relie,
 * et la gorge qui mène à la Cendrière est dans le feu depuis le premier jour — c'est une gorge de
 * cendre, pas un pré.
 */
export function calibreLeFront(champ: readonly number[], estRacine: (i: number) => boolean): number {
  const tuiles: number[] = []
  for (let i = 0; i < champ.length; i++) if (estRacine(i)) tuiles.push(champ[i]!)
  if (tuiles.length === 0) return 0
  const vise = Math.round(tuiles.length * CENDRE.PART_CIBLE)

  let lo = CENDRE.AVANCEE_MIN
  let hi = CENDRE.AVANCEE_PLAFOND
  for (let it = 0; it < 30; it++) {
    const m = (lo + hi) / 2
    let n = 0
    for (const d of tuiles) if (d < m) n += 1
    if (n < vise) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

/**
 * LE FRONT, À CET INSTANT — et il n'est PAS dans l'état.
 *
 * C'est la meilleure trouvaille du chantier, et elle vient d'un invariant plutôt que d'une idée :
 * *« le tick est la seule horloge ; toute notion dérivée est une fonction pure du numéro de tick.
 * Aucun état temporel redondant »* (spec `monde.md` R1).
 *
 * On avait prévu de stocker l'avancée du front dans le `SimState` — un scalaire, c'était déjà
 * bon marché. Mais un scalaire dérivable du tick est **de l'état redondant**, et l'état redondant
 * finit toujours par diverger de sa source. Le front est donc calculé, jamais rangé : **zéro
 * octet ajouté au `SimState`**, zéro risque de désynchronisation, et les replays le retrouvent
 * exactement sans qu'on ait à le sérialiser.
 */
export function frontActuel(state: { tick: number; calendarScale: number; map: WorldMap }): number {
  const max = state.map.cendreMax
  if (max === undefined) return 0 // une carte sans Cendrière : rien ne brûle
  return avanceeDuFront(seasonDayAtTick(state.tick, state.calendarScale), max)
}

/** Cette tuile brûle-t-elle ? Une comparaison, rien de plus — c'est tout l'intérêt du modèle. */
export function estCendre(map: WorldMap, tx: number, ty: number, front: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  const d = map.cendre?.[ty * map.width + tx]
  if (d === undefined) return false
  return d < front
}

/**
 * LA PART DE LA VALLÉE SOUS LA CENDRE, au jour donné. Un outil de MESURE, pour les gardes et
 * l'équilibrage — on ne devine pas un chiffre pareil, on le compte.
 */
export function partSousLaCendre(map: WorldMap, front: number, filtre?: (i: number) => boolean): number {
  const champ = map.cendre
  if (!champ) return 0
  let dedans = 0
  let total = 0
  for (let i = 0; i < champ.length; i++) {
    if (filtre && !filtre(i)) continue
    total += 1
    if (champ[i]! < front) dedans += 1
  }
  return total === 0 ? 0 : dedans / total
}

/**
 * LA CENDRE AVANCE, ET CE QU'ELLE ATTEINT MEURT.
 *
 * Appelé au BASCULEMENT d'un jour de saison, jamais à chaque tick : le front ne bouge qu'une fois
 * par jour, et balayer les nœuds vingt fois par seconde pour rien serait une faute de goût autant
 * que de perf.
 *
 * CE QUI MEURT : les nœuds de récolte. Un pré brûlé n'a plus de baies, une forêt cendrée n'a plus
 * de bois. C'est ce qui fait que la migration n'est pas une consigne mais une **fuite** — le
 * village qui reste ne meurt pas d'un coup, il s'appauvrit, jour après jour, jusqu'à ce que rester
 * coûte plus que partir. C'est le mécanisme le plus doux qu'on puisse infliger, et le plus cruel.
 *
 * (Ce que la cendre fait à la FAUNE — les Cendreux y naissent-ils ? de jour ? — reste une décision
 * de design, non prise. Elle n'est pas ici.)
 *
 * Émet UN événement par jour (`cendre_avance`), pas un par nœud : la chronique veut savoir que la
 * vallée a reculé, pas qu'un buisson a grillé. Haute fréquence n'est pas domaine.
 */
export function avancerLaCendre(state: SimState): void {
  const champ = state.map.cendre
  if (!champ) return
  const front = frontActuel(state)
  if (front <= 0) return // l'acte I : la Cendrière reste chez elle

  const width = state.map.width
  const avant = state.nodes.length
  state.nodes = state.nodes.filter((n) => {
    const d = champ[n.ty * width + n.tx]
    return d === undefined || d >= front
  })
  const brules = avant - state.nodes.length
  if (brules === 0) return

  emitEvent(state, {
    type: 'cendre_avance',
    tick: state.tick,
    jour: seasonDayAtTick(state.tick, state.calendarScale),
    front: Math.round(front),
    noeudsBrules: brules,
  })
}
