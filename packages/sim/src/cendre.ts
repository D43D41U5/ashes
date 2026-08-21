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

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // LE CORTÈGE (spec `cortege-cendre.md`) — le front n'est pas une ligne, c'est un CORTÈGE.
  //
  // Ces largeurs sont la GÉOMÉTRIE DU FRONT : elles se calibrent en regardant une carte (quelle
  // part des Prés Bas est stérile à mi-course ?), pas en jouant — d'où leur place ici, à côté de
  // `PART_CIBLE`, et non dans `balance.ts` (règle de partage, en-tête de `balance.ts`).
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  /**
   * LA VALEUR RENDUE HORS CARTE, ou sur une carte sans Cendrière — grande, et **FINIE**.
   *
   * Toute borne du cortège retombe alors sur sa valeur neutre par simple comparaison, sans un `if`
   * de plus chez chaque consommateur. Finie et non `Infinity` : une valeur qui ne survit pas à un
   * aller-retour JSON n'a rien à faire dans un paquet dont l'état doit être sérialisable, même
   * quand elle ne transite que par un retour de fonction — on ne garde pas deux règles.
   */
  MARGE_HORS_CENDRE: 1e9,

  /**
   * ═══ LES BANDES SONT DES PARTS DE LA COURSE DU FRONT, JAMAIS DES DISTANCES ═══
   *
   * **C'est la correction que ce fichier avait DÉJÀ faite un cran plus haut**, et je l'ai refaite
   * à l'identique un cran plus bas avant que la mesure ne me reprenne — voir `PART_CIBLE` :
   * *« ET C'EST UNE PART, PAS UNE DISTANCE… la même valeur couvrait 48 % des Prés Bas sur une seed
   * et 81 % sur une autre »*. Une largeur en tuiles écrite en dur ne veut rien dire : la course du
   * front est calibrée PAR CARTE, par dichotomie.
   *
   * MESURÉ (`tools/mesure-cortege.mts`, seed 2026) : `cendreMax` vaut **74 tuiles** — la course
   * TOTALE du front sur toute la saison. Une bande de 70 tuiles en aurait donc couvert 95 %, et
   * **62 % de la vallée habitable aurait été stérile au jour 1**, avant que le front n'ait bougé
   * d'une tuile. Le réglage se lit donc en part de `cendreMax`, et la sonde le rend en tuiles.
   *
   * LA BANDE STÉRILE — la plus large des deux, et le cœur du réglage. C'est le sens le plus DOUX
   * du cortège, donc celui qui doit prévenir le plus TÔT : il ne confisque rien, il annonce. Le
   * joueur voit sa tournée du sud rendre de moins en moins pendant qu'il a encore le temps de la
   * déplacer. « Le monde prévient, il ne guide pas » (`worldgen.md` R21), à la lettre.
   *
   * ⚠ Doit rester STRICTEMENT SUPÉRIEURE à `FROID_PART` (R5, testé) : en marchant vers le sud on
   * rencontre le stérile AVANT le froid. Deux bandes qui se croisent rendent le cortège illisible,
   * et ça ne se voit pas à l'œil — d'où la garde.
   */
  STERILE_PART: 0.2,

  /**
   * LE PLAFOND DU MULTIPLICATEUR DE REPOUSSE — et il n'est PAS décoratif.
   *
   * Un délai non borné franchirait `Number.MAX_SAFE_INTEGER` et `Math.floor` rendrait n'importe
   * quoi (R2bis). À 12, un nœud collé au front met douze fois le temps normal à revenir : à
   * l'échelle d'une tournée, il ne revient plus — sans qu'on ait eu besoin d'inventer un état
   * « stérile » à persister.
   */
  STERILE_FACTEUR_MAX: 12,

  /**
   * LA BANDE FROIDE, EN PART DE LA COURSE DU FRONT. Plus étroite que la stérile (R5) : le froid
   * est le sens qui MORD, il arrive après l'avertissement.
   */
  FROID_PART: 0.08,

  /**
   * LE FROID MAXIMAL DE LA CENDRE, en degrés de la jauge Température (0-100), atteint sur le
   * brûlé lui-même.
   *
   * L'ordre de grandeur se lit contre la table de `flore-froid` : la nuit ôte 30, l'acte II ôte
   * 25. À 18, la bande de cendre pèse moins qu'une nuit — elle ne décide jamais seule, elle fait
   * BASCULER ce qui était déjà limite. C'est ce qu'on veut : le sud devient invivable *la nuit*,
   * puis invivable tout court quand l'acte descend à son tour.
   *
   * ⚠ Non multiple de 5, DÉLIBÉRÉMENT (R3quater) : hors front, la table de `FLORE` n'atteint que
   * des multiples de 5, et ses deux seuils sont posés hors de ces valeurs pour qu'aucune décision
   * de gel ne se joue au bit de flottant près. Un terme de cendre multiple de 5 remettrait toutes
   * les sommes sur cette grille et rouvrirait exactement le défaut qu'ils avaient fermé.
   */
  FROID_MAX: 18,

  /**
   * LA POUSSÉE DU VENT DE CENDRE (spec `cortege-cendre.md` R6) — en part de la course du front,
   * comme les bandes, et pour la même raison.
   *
   * ═══ LA POUSSÉE, PAS L'AVANCÉE ═══
   *
   * P1-P3 sont des PENTES : elles montent, sans à-coup, et une pente seule finit par ne plus se
   * sentir. Le vent est le BATTEMENT — il vient du sud, il pousse la bande froide devant lui
   * quelques heures, il passe, **et le front de cendre n'a pas bougé d'une tuile**. Rien n'est
   * perdu ; le joueur a seulement dû lâcher quelque chose le temps d'une nuit.
   *
   * C'est aussi le seul des quatre sens qui puisse se répéter chaque année sans s'user : la pente
   * s'habitue, le coup de vent non — et il porte plus loin à mesure que la course du front
   * s'allonge, donc il durcit tout seul, sans un multiplicateur d'acte.
   *
   * À 0,45, un vent de cendre porte le froid à peu près trois fois plus loin que la bande froide
   * de repos (`FROID_PART` 0,08) — assez pour qu'une tournée du sud devienne intenable pendant
   * qu'il souffle, pas assez pour atteindre un village du nord.
   */
  POUSSEE_PART: 0.45,
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
  return frontAuTick(state.map, state.calendarScale, state.tick)
}

/**
 * LE MÊME FRONT, À UN TICK QUELCONQUE — et il n'est pas un confort.
 *
 * `baselineTemperatureAt` existe pour L'HYSTÉRÉSIS DU DÉGEL (`gel.md` G8) : elle relit le froid
 * du monde à un tick PASSÉ. Depuis que le froid de cendre entre dans `froidDuMonde` (R3), lire
 * `state.tick` là-dedans rendrait le front d'AUJOURD'HUI pour une question portant sur HIER — un
 * décalage silencieux, qui ne se verrait que sur une glace qui dégèle trop tôt ou trop tard.
 *
 * Sans allocation (surtout pas un objet littéral par appel) : `froidDuMonde` est sur le chemin
 * chaud de la passe économique, appelé par nœud.
 */
export function frontAuTick(map: WorldMap, calendarScale: number, tick: number): number {
  const max = map.cendreMax
  if (max === undefined) return 0 // une carte sans Cendrière : rien ne brûle
  return avanceeDuFront(seasonDayAtTick(tick, calendarScale), max)
}

/** Cette tuile brûle-t-elle ? Une comparaison, rien de plus — c'est tout l'intérêt du modèle. */
export function estCendre(map: WorldMap, tx: number, ty: number, front: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  const d = map.cendre?.[ty * map.width + tx]
  if (d === undefined) return false
  return d < front
}

/**
 * ═══ LE CORTÈGE — LA MARGE DE CENDRE, ET C'EST LA SEULE LECTURE DU CHAMP ═══
 * *(spec `cortege-cendre.md` R1 ; décision d'Alexis 2026-08-21 « la pression doit être appliquée
 * par l'environnement ».)*
 *
 * `map.cendre` est une distance PAR TUILE, précalculée — et jusqu'ici **une seule question la
 * lisait** : « est-ce brûlé ? ». Un champ entier, un seul sens. Le cortège en tire les autres :
 * la stérilité qui marche devant le feu, le froid qui le précède, la hantise qui le suit. Aucun
 * n'ajoute un octet à l'état : ce sont des comparaisons sur un champ qui existe déjà.
 *
 * LA CONVENTION DE SIGNE EST POSÉE ICI, UNE FOIS, ET NULLE PART AILLEURS :
 * - **`marge < 0`** — la tuile est **dans le brûlé**. Plus c'est négatif, plus elle a brûlé TÔT.
 * - **`marge ≥ 0`** — la tuile est **devant le front**, à autant de tuiles.
 *
 * Quatre sites d'appel qui recalculeraient `d − front` chacun de leur côté, c'est le même défaut
 * de signe débogué trois fois (R1bis). Les consommateurs appellent CECI, jamais `map.cendre`.
 *
 * Hors carte, ou carte sans Cendrière : `CENDRE.MARGE_HORS_CENDRE`, grande valeur **finie** — tout
 * seuil du cortège retombe alors sur sa valeur neutre par simple comparaison, sans un `if` de plus
 * chez le consommateur (et sans `Infinity`, qui ne survit pas à un aller-retour JSON).
 */
export function margeDeCendre(map: WorldMap, tx: number, ty: number, front: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return CENDRE.MARGE_HORS_CENDRE
  const d = map.cendre?.[ty * map.width + tx]
  if (d === undefined) return CENDRE.MARGE_HORS_CENDRE
  return d - front
}

/**
 * LE FROID DE LA CENDRE (spec `cortege-cendre.md` R3) — une EXPOSITION de plus, pas une loi.
 *
 * Rendu POSITIF, comme `brumeColdAt` et `meteoColdAt` : c'est le nombre de degrés qu'on RETIRE.
 * Le consommateur unique est `froidDuMonde`, qui le soustrait dans `exposed` — donc l'abri
 * l'amortit et le feu le planche (l'ambiant est un `max`). On n'écrit pas une mécanique neuve,
 * on ajoute une exposition à celles qui existent déjà.
 *
 * **La fiction est gratuite** : une terre brûlée n'a plus de couvert. *Le froid vient d'où plus
 * rien ne pousse.* Aucune explication à écrire — c'est un fait physique, et c'est exactement
 * l'espèce de lore que ce jeu peut porter.
 *
 * RAMPE, jamais marche : nul à la limite de la bande, maximal dès qu'on entre dans le brûlé. Un
 * mur de froid à franchir d'un pas ne se sent pas venir ; une rampe, si (c'est le raisonnement
 * du front météo, `meteo.md` R4).
 */
export function froidDeCendre(map: WorldMap, tx: number, ty: number, front: number): number {
  const bande = bandeDeCendre(map, CENDRE.FROID_PART)
  if (bande <= 0) return 0 // carte sans Cendrière : le cortège n'existe pas
  const marge = margeDeCendre(map, tx, ty, front)
  if (marge >= bande) return 0 // hors de la bande : rien
  if (marge <= 0) return CENDRE.FROID_MAX // dans le brûlé : plein pot
  // Rampe linéaire sur la bande. Division seule — aucune transcendante (invariant #2).
  return (CENDRE.FROID_MAX * (bande - marge)) / bande
}

/**
 * LA LARGEUR D'UNE BANDE DU CORTÈGE, EN TUILES — dérivée de la course calibrée du front.
 *
 * Une carte sans Cendrière (banc headless) rend 0 : **tous les sens du cortège y sont neutres**,
 * et le comportement du banc est préservé au bit près, comme le promet R17 de `cendreux.md`.
 */
export function bandeDeCendre(map: WorldMap, part: number): number {
  const max = map.cendreMax
  if (max === undefined) return 0
  return max * part
}

/**
 * LA STÉRILITÉ (spec `cortege-cendre.md` R2) — le MULTIPLICATEUR du délai de repousse.
 *
 * Le sens qui marche LE PLUS LOIN devant le feu, et c'est délibéré : c'est le plus doux, donc
 * celui qui doit prévenir le plus tôt. Le sol est **encore là, encore vert, encore marchable** —
 * et il ne redonne plus. Le joueur **abandonne sa tournée avant d'abandonner son terrain**.
 *
 * Rend un facteur ≥ 1 : 1 hors bande (rien ne change), jusqu'à `STERILE_FACTEUR_MAX` collé au
 * front. **Plafonné, et le plafond n'est pas décoratif** : un délai non borné franchirait
 * `Number.MAX_SAFE_INTEGER` et `Math.floor` rendrait n'importe quoi (R2bis).
 *
 * Ce qu'il ne fait JAMAIS : produire `regrowAt === 0`. C'est une signature portante de
 * `economy.ts` (`stock 0` + `regrowAt 0` = défriché, ne revient pas ; `setNodes` teste
 * `regrowAt > 0`). **La stérilité allonge un délai, elle ne pose pas une marque.**
 */
export function facteurSterilite(map: WorldMap, tx: number, ty: number, front: number): number {
  const bande = bandeDeCendre(map, CENDRE.STERILE_PART)
  if (bande <= 0) return 1 // carte sans Cendrière : la repousse normale, au bit près
  const marge = margeDeCendre(map, tx, ty, front)
  if (marge >= bande) return 1 // hors bande : la repousse normale
  if (marge <= 0) return CENDRE.STERILE_FACTEUR_MAX // brûlé : le nœud n'existe déjà plus, mais la borne tient
  // Rampe de 1 (bord de bande) à MAX (collé au front).
  return 1 + ((CENDRE.STERILE_FACTEUR_MAX - 1) * (bande - marge)) / bande
}

/**
 * LA DIRECTION DE LA CENDRIÈRE depuis un point — 'nord' | 'sud' | 'est' | 'ouest', ou
 * `undefined` sur une carte sans Cendrière ou en terrain plat de cendre.
 *
 * Pour les ANNALES (spec `annales.md` R3) : la Tour de guet regarde VERS la Cendrière (`guet`),
 * la charrette fuit À L'OPPOSÉ (`fuite`). Des MOTS, jamais des degrés — le pays d'avant n'a pas
 * de boussole graduée, et aucun lecteur n'aura à formater un angle.
 *
 * Lecture BRUTE du champ de distance (pas de la marge au front) : c'est une question de
 * GÉNÉRATION — « où est la Cendrière ? » — qui ne dépend d'aucun tick. On échantillonne aux
 * quatre cardinaux à `pas` tuiles (bornés à la carte) ; la pente la plus FORTE vers le bas du
 * champ désigne la Cendrière. Départage : l'ordre fixe est-ouest-sud-nord (déterminisme).
 */
export function directionCendriere(map: WorldMap, tx: number, ty: number, pas = 24): 'nord' | 'sud' | 'est' | 'ouest' | undefined {
  const champ = map.cendre
  if (!champ) return undefined
  const lire = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= map.width ? map.width - 1 : x
    const cy = y < 0 ? 0 : y >= map.height ? map.height - 1 : y
    return champ[cy * map.width + cx]!
  }
  const ici = lire(tx, ty)
  const pentes: ['est' | 'ouest' | 'sud' | 'nord', number][] = [
    ['est', ici - lire(tx + pas, ty)],
    ['ouest', ici - lire(tx - pas, ty)],
    ['sud', ici - lire(tx, ty + pas)],
    ['nord', ici - lire(tx, ty - pas)],
  ]
  let best = pentes[0]!
  for (const q of pentes) if (q[1] > best[1]) best = q
  return best[1] > 0 ? best[0] : undefined
}

/** L'opposé d'une direction — la fuite tourne le dos au guet. */
export function directionOpposee(d: 'nord' | 'sud' | 'est' | 'ouest'): 'nord' | 'sud' | 'est' | 'ouest' {
  return d === 'nord' ? 'sud' : d === 'sud' ? 'nord' : d === 'est' ? 'ouest' : 'est'
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
