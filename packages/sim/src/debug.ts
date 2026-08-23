/**
 * Outils de DÉVELOPPEMENT — pas du jeu.
 *
 * Quatre leviers pour arpenter le monde sans le jouer : se téléporter, forcer
 * l'heure, devenir invulnérable, se donner un objet. Ils vivent dans /sim (et pas
 * dans le client) parce que la sim est autoritative : un client qui déplacerait son
 * avatar tout seul serait recalé au snapshot suivant.
 *
 * Deux gardes rendent la chose sûre :
 * - Elles ne s'appliquent QUE si la sim a été créée avec `debug: true`. L'hôte
 *   de production ne l'activera pas — un client trafiqué qui enverrait ces
 *   actions se les verrait ignorer par l'autorité, silencieusement.
 * - Elles passent par le canal `action` ordinaire (`PlayerAction`), donc elles
 *   sont capturées par le replay log : une partie où l'on a triché se rejoue
 *   quand même à l'identique.
 */
import { WORLD_EVENTS, METEO, MORTS, NIGHT_HUNT, TEMPERATURE, WALL_TIERS } from './balance'
import { emitEvent } from './events'
import { spawnHorde } from './worldevents'
import { addItems, type ItemId } from './items'
import { spawnMonster } from './monsters'
import { die } from './combat'
import { densiteDesMorts, siteDansLaCouronne } from './morts'
import type { Entity, SimState } from './sim'
import { seasonRamp, cycleOffsetForStartHour, getGameTime, seasonDayAtTick, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { addStructure } from './village'
import { desiredOrders } from './village-plan'

export type DebugAction =
  /** Poser l'avatar sur une tuile, sans se soucier des obstacles ni de la distance. */
  | { type: 'debug_teleport'; x: number; y: number }
  /** Forcer l'heure murale du cycle (0-24) — décale la PHASE, jamais le calendrier. */
  | { type: 'debug_set_hour'; hour: number }
  /**
   * SAUTER AU JOUR DE SAISON — l'outil sans lequel la SAISON est intestable.
   *
   * En Veillée, la saison est compressée sur quelques cycles jour/nuit (couplage V0-9,
   * `calendarScaleForSeasonCycles`) : atteindre l'acte III (jour 43) demande tout de même
   * plusieurs heures de jeu. Personne ne verra donc jamais le front de cendre avancer d'un seul
   * élan — ni un playtesteur, ni un smoke test. Une mécanique qu'on ne peut pas ATTEINDRE est une
   * mécanique morte, et ce projet en a déjà enterré cinq.
   *
   * On saute donc le TICK, ce qui est la seule façon honnête : le tick EST le calendrier. Tout
   * ce qui en dérive (l'acte, la faim, le froid, le front) suit sans qu'on ait à le forcer — et
   * la cendre rattrape son retard au premier tick, puisqu'elle voit le jour basculer.
   *
   * Armée uniquement en DEV (`state.debug`), comme les autres.
   */
  | { type: 'debug_set_season_day'; day: number }
  /** Invulnérabilité + jauges gelées (voir `refreshGodMode`). */
  | { type: 'debug_god'; on: boolean }
  /**
   * Se donner un objet ET LE METTRE EN MAIN. Sans lui, le combat est INVÉRIFIABLE
   * dans le vrai jeu : le joueur démarre les mains vides (spec économie — pas de kit
   * de départ), et il faudrait donc récolter, câbler une corde et forger avant de
   * pouvoir seulement REGARDER un coup de lance à l'écran. Un garde-fou qu'on ne peut
   * pas atteindre ne garde rien.
   */
  | { type: 'debug_grant'; item: ItemId }
  /**
   * RÉVEILLER LE SOL ICI ET MAINTENANT (spec `cendreux.md` R21bis).
   *
   * Sans lui, voir le sol travailler demandait de réunir TROIS conditions à la fois — acte III
   * (le jour de saison n'a ni touche ni bouton, il fallait la console), la nuit, et se tenir
   * hors de la bulle de tout feu — puis d'attendre un tirage à la minute, à 55 %. Et le
   * plafond de l'acte sature après un ou deux réveils : MESURÉ, **2 sur une nuit entière**.
   * Le geste le plus caractéristique du monstre qui donne son nom au jeu était, en pratique,
   * inobservable — et une mécanique qu'on ne peut pas ATTEINDRE est une mécanique morte
   * (même raison que `debug_set_season_day`, même remède).
   *
   * ON PLANTE UN VRAI RÉVEIL, PAS UNE ANIMATION. Même couronne, mêmes constantes, même
   * `state.reveils` : il travaille ses quatre secondes, un feu à portée l'ÉTOUFFE (la parade
   * de R21 se teste donc par ce chemin aussi), et il rend un Cendreux qui porte les trois
   * marques du rôdeur. Ce qu'on voit est ce que le jeu fait — un raccourci qui aurait joué
   * l'animation sans passer par la sim n'aurait rien prouvé du tout.
   *
   * Ce qu'il court-circuite, et c'est tout : le TIRAGE de `advanceNightHunt` (l'acte, l'heure,
   * la chance, le plafond). Le reste de la chaîne est intact.
   */
  | { type: 'debug_reveil' }
  /**
   * LEVER UNE HORDE MAINTENANT (2026-08-21). Depuis la pente continue (décision ⑭), plus
   * aucune horde n'est GARANTIE une nuit donnée — or le smoke `horde` et le playtest doivent
   * pouvoir en regarder une sans rejouer des nuits de loterie. Même philosophie que
   * `debug_reveil` : on court-circuite le TIRAGE (la chance de l'aube), rien d'autre — la
   * planification (origine par la densité, cible = feu le plus proche) et le spawn (champ de
   * flux, bande de marche) sont la vraie chaîne. Aucun tirage consommé : la taille vient de
   * la rampe du jour, l'élection d'origine du hash du tick.
   */
  | { type: 'debug_horde' }
  /**
   * POSER UNE CARCASSE ICI (spec `depecage.md`). Le smoke `depecage` et le playtest doivent
   * pouvoir regarder une découpe sans d'abord traquer un cerf. On fait NAÎTRE une vraie bête de
   * l'espèce demandée à deux tuiles et on la fait MOURIR par `die()` — la chaîne réelle (table de
   * loot, os, marqueur `carcass`, `monster_slain`, pression de chasse) ; ce qu'on court-circuite,
   * c'est la traque. `clean` : la bête meurt « d'un coup propre » (elle laisse sa peau brute).
   */
  | { type: 'debug_carcass'; species: import('./balance').MonsterType; clean?: boolean }
  /**
   * TAMPONNER LE PALIER DE BÂTI D'UN VILLAGE PNJ (spec `village-pnj-evolution.md`).
   *
   * Sans lui, VOIR un hameau ou un bourg exige des jours de Veillée : la cadence du
   * chantier (`BUILD_PACE_TICKS`) étale exprès la construction sur un arc de saison.
   * Une mécanique qu'on ne peut pas ATTEINDRE est une mécanique morte (même remède
   * que `debug_set_season_day`) — le playtest et le smoke doivent pouvoir regarder
   * chaque palier MAINTENANT.
   *
   * On tamponne le PLAN DIRECTEUR, pas un décor : `desiredOrders` — la même vérité
   * que le tableau du village — posée pièce à pièce par `addStructure`. Ce qu'on
   * court-circuite, et c'est tout : la main-d'œuvre et le coût. Aucun tirage.
   */
  | { type: 'debug_village_stage'; villageId: number; stage: number }
  /**
   * ARMER UN FRONT MÉTÉO ICI ET MAINTENANT (spec `meteo.md`, chantier de rendu).
   *
   * Sans lui, DEUX des cinq ciels sont inobservables — et ce n'est pas une conjecture,
   * c'est un relevé : en Veillée (`VEILLEE_SEASON_CYCLES = 6`) l'élection ne tombe qu'aux
   * bords de cycle, soit les jours de saison 1, 11, 21, 31, 41, 51… ; balayés sur 40 cycles,
   * ces jours n'élisent JAMAIS `pluie` ni `orage` (la table de l'acte III ne porte pas la
   * pluie du tout, et l'orage y pèse 0,05). Un rendu qu'on ne peut pas ATTEINDRE est un
   * rendu invérifiable — même motif, même remède que `debug_set_season_day`.
   *
   * ON ARME UN VRAI FRONT, PAS UN DÉCOR : le record posé est exactement celui qu'une
   * élection produirait (type, jour, bord, deux échéances), donc TOUTE la chaîne d'effets
   * suit sans une ligne de plus — le froid mord, le feu consomme, le gibier se tait, le pas
   * s'alourdit, la foudre s'élit dans ses créneaux. Ce qu'on court-circuite, et c'est tout :
   * le tirage d'occurrence et de type de `advanceMeteo`. Aucun tirage consommé.
   *
   * `phase` place la bande dans SA traversée (0 = elle entre, 0,5 = elle est au milieu de la
   * carte, 1 = elle sort) : sans ça il faudrait regarder passer vingt-quatre minutes de
   * traversée pour voir la bande arriver au centre. `type: null` purge le front.
   */
  | { type: 'debug_meteo'; meteo: import('./meteo').MeteoType | null; edge?: 0 | 1 | 2 | 3; phase?: number }

export function isDebugAction(action: { type: string }): action is DebugAction {
  return action.type.startsWith('debug_')
}

export function applyDebugAction(state: SimState, entityId: number, action: DebugAction): void {
  if (!state.debug) return
  const entity = state.entities.find((e) => e.id === entityId)
  if (!entity) return

  if (action.type === 'debug_teleport') {
    // Bornes de la carte seulement : le TP de debug traverse les murs, l'eau et
    // la roche — c'est précisément à ça qu'il sert. On garde juste l'avatar
    // DANS la carte (hors-bornes = terrain indéfini, donc collision cassée).
    entity.x = clamp(action.x, 0.5, state.map.width - 0.5)
    entity.y = clamp(action.y, 0.5, state.map.height - 0.5)
    // Un wind-up en cours frapperait depuis l'ancienne position : on l'annule.
    delete entity.windup
  } else if (action.type === 'debug_set_hour') {
    // hourOfCycle dérive de (tick + cycleOffset) : pour viser une heure sans
    // toucher au tick (qui porte le calendrier, les cooldowns, les wind-ups),
    // on ne bouge que la phase.
    const target = cycleOffsetForStartHour(clamp(action.hour, 0, 24))
    state.cycleOffset = (((target - state.tick) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
  } else if (action.type === 'debug_set_season_day') {
    // ON ATTERRIT JUSTE AVANT LE JOUR VISÉ, PAS DESSUS — et ce détail est tout le correctif.
    //
    // Poser le tick PILE sur le premier tick du jour 60 ne franchit aucune bascule : `advanceTime`
    // compare le jour d'avant et le jour d'après, les trouve égaux, et **rien ne se déclenche**.
    // Ni `season_day_started`, ni `act_started`, ni le front de cendre. Le monde se retrouvait au
    // jour 60 avec la vallée intacte — un mensonge, et exactement le genre d'outil de debug qui
    // fait perdre une journée à celui qui lui fait confiance.
    //
    // On se pose donc UN TICK AVANT. La sim franchit la bascule d'elle-même, au tick suivant, par
    // sa machinerie normale : les événements sortent, la cendre avance, l'acte change. **Le debug
    // ne simule pas le temps — il le laisse passer.**
    const jour = Math.max(1, Math.round(action.day))
    const premierTick = Math.round(((jour - 1) * TICKS_PER_SEASON_DAY) / state.calendarScale)
    state.tick = Math.max(0, premierTick - 1)
  } else if (action.type === 'debug_reveil') {
    // Le site se cherche EXACTEMENT comme la nuit le cherche (`nighthunt.ts`) : la couronne
    // serrée du mort, pondérée par le champ des morts, sur un sol qui mène à la proie. Rien
    // ne convient tout autour → on ne plante rien, comme la nuit qui passe son tour.
    //
    // AUCUN TIRAGE CONSOMMÉ, et ce n'est pas un détail : appuyer sur une touche de debug ne
    // doit pas décaler le flux seedé du monde entier. Le `tirage` vient donc du TICK — la
    // seule horloge de la sim (`monde.md` R1) — ce qui reste déterministe et rejouable
    // (l'action passe par le canal `PlayerAction`, donc par le replay-log), tout en variant
    // d'un appui à l'autre. C'est la même exigence qu'à l'étouffement et à l'émergence, où
    // R21 interdit déjà le moindre tirage.
    const site = siteDansLaCouronne(
      state, entity.x, entity.y, (state.tick % 997) / 997,
      (tx, ty) => densiteDesMorts(state, tx, ty),
      { dist: NIGHT_HUNT.SPAWN_DIST_UNDEAD, ring: NIGHT_HUNT.SPAWN_RING_UNDEAD },
    )
    if (!site) return
    state.reveils.push({ x: site.x, y: site.y, at: state.tick + MORTS.REVEIL_TICKS, preyId: entity.id })
    // ÇA S'ANNONCE, comme toujours : le bandeau et le son du raclement font partie de ce
    // qu'on vient vérifier. Les taire aurait fait tester une demi-chaîne.
    const enCours = state.reveils.filter((r) => r.preyId === entity.id).length
    emitEvent(state, {
      type: 'cendreux_prowl', tick: state.tick, targetEntityId: entity.id, count: enCours, x: site.x, y: site.y,
    })
  } else if (action.type === 'debug_horde') {
    // La taille du JOUR (la rampe ⑭), le chemin réel de spawn — seul le dé est court-circuité.
    const jour = seasonDayAtTick(state.tick, state.calendarScale)
    const taille = Math.max(1, Math.round(seasonRamp(WORLD_EVENTS.HORDE_TAILLE.DEBUT, WORLD_EVENTS.HORDE_TAILLE.FIN, jour)))
    // Le pseudo-tirage vient du TICK (patron debug_reveil) : appuyer sur une touche de dev
    // ne consomme pas un pas du PRNG — le contrat écrit plus haut est tenu à la lettre.
    spawnHorde(state, taille, undefined, (state.tick % 997) / 997)
  } else if (action.type === 'debug_carcass') {
    const id = spawnMonster(state, action.species, entity.x + 2, entity.y)
    const monster = state.monsters.find((m) => m.entityId === id)
    const bete = state.entities.find((e) => e.id === id)
    if (!monster || !bete) return
    if (action.clean === true) monster.slainClean = true
    die(state, bete, entity.id)
  } else if (action.type === 'debug_village_stage') {
    const village = state.villages.find((v) => v.id === action.villageId && v.chiefId === 0)
    if (!village) return // les villages à chef humain ne se tamponnent pas
    village.buildTier = clamp(Math.round(action.stage), 1, 3)
    // Le plan se recalcule après chaque passe : les montées en pierre ne se voient
    // qu'une fois les murs de bois posés. Quatre passes suffisent ; huit est un
    // garde-fou, pas une attente.
    for (let passe = 0; passe < 8; passe++) {
      const orders = desiredOrders(state, village)
      if (orders.length === 0) break
      for (const order of orders) {
        if (order.action === 'defriche') {
          // LE TAMPON DOIT ATTEINDRE LE MÊME ÉTAT QUE LE CHANTIER, sinon il ment — et c'est
          // très exactement par ce mensonge qu'un logis tamponné s'est retrouvé bâti AUTOUR
          // d'un arbre vivant sur une photo d'accueil. On vide le nœud (stock 0), ce que
          // `poseLibre` lit comme libre et le client comme une souche : le même état que si
          // un villageois l'avait abattu. Ce qu'on court-circuite reste la main-d'œuvre et le
          // temps, jamais le RÉSULTAT.
          for (const n of state.nodes) {
            if (n.tx === order.tx && n.ty === order.ty) n.stock = 0
          }
        } else if (order.action === 'pose') {
          addStructure(state, order.structure, order.tx, order.ty, village.id, 0, undefined, order.material, order.edges)
        } else if (order.action === 'place') {
          addStructure(state, order.component, order.tx, order.ty, village.id, 0)
        } else {
          const s = state.structures.find((st) => st.id === order.structureId)
          if (s && (s.type === 'wall' || s.type === 'door')) {
            s.material = 'stone'
            s.hp = WALL_TIERS.stone[s.type].hp
          }
        }
      }
    }
    // Les portes suivent le rituel (R7) : tamponnées en plein jour, elles naissent OUVERTES
    // — sinon la photo d'un village « ouvert le jour » montrerait un fort barricadé à midi.
    if (!getGameTime(state).isNight) {
      for (const s of state.structures) {
        if (s.type === 'door' && s.villageId === village.id) s.open = true
      }
    }
  } else if (action.type === 'debug_meteo') {
    if (action.meteo === null) {
      state.meteo = null
      return
    }
    // La fenêtre est celle d'un vrai front (`TRAVERSEE_TICKS`), simplement REMONTÉE dans le
    // temps de `phase` traversées : à `phase` = 0,5 la bande est pile au milieu de la carte
    // au tick courant, et elle continue sa route ensuite comme n'importe quel front élu.
    const phase = clamp(action.phase ?? 0.5, 0, 1)
    const startTick = state.tick - Math.round(phase * METEO.TRAVERSEE_TICKS)
    state.meteo = {
      type: action.meteo,
      cycle: Math.floor(state.tick / TICKS_PER_CYCLE),
      day: seasonDayAtTick(state.tick, state.calendarScale),
      edge: action.edge ?? 0,
      startTick,
      endTick: startTick + METEO.TRAVERSEE_TICKS,
    }
  } else if (action.type === 'debug_grant') {
    // On le met EN MAIN, pas juste dans le sac : c'est la main qui décide de tout
    // (spec inventaire R9), et un objet au fond du sac ne prouve rien à l'écran.
    if (!addItems(entity.inventory, { [action.item]: 1 })) return
    const slot = entity.inventory.findIndex((s) => s !== null && s.item === action.item)
    if (slot >= 0) entity.activeSlot = slot
  } else {
    if (action.on) entity.god = true
    else delete entity.god
  }
}

/**
 * Fin de tick : on remet à plat les jauges des invulnérables. Couplé au garde
 * de `applyDamage` (combat.ts), ça couvre TOUTES les façons de mourir — coups,
 * saignement, faim, froid — sans avoir à disséminer un `if (god)` dans chaque
 * système.
 */
export function refreshGodMode(state: SimState): void {
  if (!state.debug) return
  for (const entity of state.entities) {
    if (!entity.god) continue
    entity.hp = 100
    entity.stamina = 100
    entity.hunger = 100
    entity.temperature = TEMPERATURE.CORPS_SAIN
    entity.wounds = {}
    entity.exhaustedUntil = 0
  }
}

/** Vrai si cette entité ne peut pas être blessée (garde de `applyDamage`). */
export function isInvulnerable(state: SimState, entity: Entity): boolean {
  return state.debug && entity.god === true
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
