/**
 * Noyau de la simulation : état + boucle de tick à pas fixe.
 *
 * Contrat de déterminisme : `step(state, inputs)` est une fonction pure du
 * point de vue de l'extérieur — même état + mêmes inputs = même état suivant,
 * sur n'importe quelle machine. Tout le multi, le replay log et les tests
 * headless reposent sur ce contrat.
 *
 * L'état est un objet JSON-sérialisable (pas de classes, pas de Map) pour
 * que snapshot = JSON.stringify et que le transport Worker/réseau soit
 * trivial.
 */
import { BALANCE, CARRY, COMBAT, HUNT, NODE_DEFS, NUIT, SLOTS, TEMPERATURE, TERRAIN_GRASS, TICK_DT_S, VENT, type FishId, type NodeType, type RecipeId, type Strike } from './balance'
import { moveAvatar } from './collision'
import { advanceDegel } from './gel'
import { advanceEnvols, entretienDesCoins } from './faune'
import { advanceCombat, applyCombatAction, tientUnArc, type CombatAction, type Corpse } from './combat'
import { advanceCendreux } from './cendreux'
import { avanceesDepuisAges, avancerLaCendre, foyersDeLaCarte, jourDuReveilDeLaCendre, tomberLesMortsDeLaCendre } from './cendre'
import { FUMEROLLE, ouvrirLesFumerolles } from './fumerolle'
import { effetsDuJour } from './modificateur'
import { advanceLieuxBrules, advanceReveils, type Reveil } from './morts'
import { advanceDecouverte } from './decouverte'
import { advanceFire } from './fire'
import { advanceTorches } from './torche'
import { applyDebugAction, isDebugAction, refreshGodMode, type DebugAction } from './debug'
import {
  advanceCraft,
  advanceEconomy,
  advanceSpoilage,
  applyEconomyAction,
  type CraftOrder,
  type EconomyAction,
  type ResourceNode,
} from './economy'
import { emitEvent, type SimEvent } from './events'
import { advanceEncyclopedie, type LigneEncyclo } from './encyclopedie'
import { applyInventoryAction, isInventoryAction, type InventoryAction } from './inventory-actions'
import { carryRatio, carryTier, makeInventory, type Inventory, type ItemId, type SkillId } from './items'
import { createEmptyMap, type WorldMap } from './map'
import { advanceAlignment, type Aggression } from './alignment'
import { advanceMonsters, type Monster } from './monsters'
import { advanceWorldEvents, type Horde, type Presage } from './worldevents'
import { advanceRefugees } from './refugees'
import { clarteSurSoi } from './nuit'
import { advanceBrume } from './brume'
import { advanceFoudre } from './foudre'
import { advanceMeteo, meteoSpeedFactor } from './meteo'
import { advanceVent } from './vent'
import { rngNext } from './rng'
import { advanceNightHunt } from './nighthunt'
import { advanceNpcs, type Npc } from './npc'
import { advanceVillageGrowth } from './village-growth'
import { advancePois } from './poi-discovery'
import { advanceDens } from './poi'
import { actForDay, dayTicksAt, TICKS_PER_CYCLE, advanceTime, jourDeSaison } from './time'
import { advanceCultures } from './agriculture'
import { advanceTemperature, coldSpeedFactor } from './temperature'
import { advanceUpkeep, applyVillageAction, getVillageOf, type VillageAction, type Structure, type Village } from './village'

/**
 * L'union des actions possibles dans un tick (village + économie + combat +
 * inventaire).
 * `DebugAction` en fait partie pour transiter par le même canal (et donc être
 * capturée par le replay log), mais elle est INERTE hors sim de debug — voir
 * `debug.ts`, garde `state.debug`.
 */
export type PlayerAction = VillageAction | EconomyAction | CombatAction | InventoryAction | DebugAction

export interface Entity {
  id: number
  /** Position du centre, en tuiles (déplacement continu, spec monde R5). */
  x: number
  y: number
  inventory: Inventory
  /** Jauge 0-100. À 0 : vitesse ÷2 (spec économie R7-R8). */
  hunger: number
  /** Jauge 0-100 (spec température). 100 = au chaud, 0 = gelé (hypothermie). */
  temperature: number
  /** XP par métier (niveau dérivé — voir skillLevel). */
  skills: Partial<Record<SkillId, number>>
  /**
   * La case de CEINTURE tenue en main (spec inventaire R8). `-1` = mains nues.
   * C'est elle, et elle seule, qui décide de l'outil et de l'arme : la sim ne
   * fouille plus le sac à la place du joueur (R9). Une case active vide vaut
   * mains nues. L'usure, elle, vit dans la case (`Slot.wear`) — `Entity.wear`,
   * qui agrégeait par TYPE d'item (deux haches, un seul compteur), a disparu.
   */
  activeSlot: number
  /** Tick avant lequel une récolte est refusée (rythme borné). Le craft, lui, n'a
   *  plus de cooldown : il a une DURÉE, et une file (spec craft-file F2). */
  cooldownUntil: number
  /**
   * LA FILE DE CRAFT (spec craft-file F1) : le travail en cours, dans l'état de
   * sim. C'est ici que vit le temps de craft — jamais dans un timer du client,
   * qui divergerait. Seule la TÊTE travaille : un artisan fait une chose à la fois.
   */
  craftQueue: CraftOrder[]
  /**
   * LES RECETTES DÉCOUVERTES (D2, `decouverte.ts`). Absent = rien encore. Un TABLEAU et
   * non un `Set` (invariant §3 : l'état de sim voyage en JSON), alimenté dans un ordre
   * fixe, donc identique au rejeu. Ce qui est appris ne se reprend jamais.
   */
  seen?: RecipeId[]
  /** Combat (spec combat R1-R7). */
  hp: number
  stamina: number
  wounds: { leg?: true; arm?: true; bleeding?: true }
  facing: { x: number; y: number }
  blocking: boolean
  /** A bougé ce tick (module la régén d'endurance). */
  moved: boolean
  /**
   * L'ALLURE du tick (spec chasse C2) : c'est elle qui décide du BRUIT — ce que
   * la faune perçoit (immobile ≪ pas lent ≪ marche ≪ sprint, voir HUNT.NOISE_*).
   * Dans le snapshot exprès : en multi comme en Veillée, on doit VOIR l'autre
   * ramper — la posture est un télégraphe pour les joueurs autant qu'une entrée
   * pour les bêtes. Posée par le pas d'input ; les PNJ restent à `walk` (bruit 1).
   */
  gait: 'still' | 'sneak' | 'walk' | 'sprint'
  /**
   * À BOUT DE SOUFFLE — le verrou d'hystérésis de la course (spec combat R1ter). Posé
   * quand le sprint vide la barre, levé seulement à `SPRINT_RECOVER_STAMINA`. Sans lui,
   * refuser la course à 0 la rend au tick suivant (l'allure retombe à `walk`, la régén
   * crédite) et l'avatar oscille sprint/marche à 10 Hz — mesuré, il courait encore une
   * tuile sur deux, indéfiniment. Absent = frais : un booléen optionnel ne salit le
   * snapshot que de ceux qui sont VRAIMENT à bout.
   */
  exhausted?: true
  /**
   * LE TICK DU DERNIER RECUL (spec combat R4sexies) — le verrou qui interdit à une horde
   * de catapulter. Un coup repousse ; dix coups dans le même tick repoussaient dix fois,
   * et un corps cerné traversait la carte. Ce qui doit rester borné est la distance PAR
   * UNITÉ DE TEMPS, exactement comme un pas — d'où un tick et non un compteur de coups.
   * Absent tant qu'on n'a jamais été poussé : le snapshot ne s'en salit que pour ceux
   * qui ont encaissé.
   */
  knockedAt?: number
  exhaustedUntil: number
  /** LE COÛT DE MORT CROISSANT (V2-21) : morts RAPPROCHÉES → épuisement plus long
   *  (plafonné). Une longue survie fait OUBLIER le compte (`lastDeathAt`), pas de
   *  spirale. Le respawn n'est plus gratuit sans devenir une punition sèche. */
  deathCount: number
  lastDeathAt: number
  /**
   * LE COUP QUI S'ARME. Il porte SA FORME (`strike`) : c'est ce qui permet au
   * télégraphe de dessiner la zone RÉELLEMENT frappée — un pic de lance ne se lit
   * pas comme un tourbillon de hache, et un télégraphe qui montrerait le même arc
   * pour les deux apprendrait une règle qui n'existe pas (voir `attack-fx.ts`).
   * `side` : le pied qui part (les poings alternent). `charged` : le coup est lourd.
   */
  /**
   * `ranged` : ce wind-up est un TIR (spec `tir.md`). Relevé au décochage plutôt que
   * redemandé à l'arme à la résolution — changer de case de ceinture pendant les 0,25 s
   * d'armement ne doit pas transformer une flèche partie en coup de hache. Et le client
   * le lit pour peindre un TRAIT au lieu d'un moulinet : sans lui, il devrait deviner
   * l'arme du tireur pour savoir ce qu'il regarde.
   */
  windup?: { dx: number; dy: number; ticksLeft: number; strike: Strike; side?: 1 | -1; charged?: true; structureId?: number; ranged?: true }
  /**
   * LE CLIC MAINTENU (spec combat R4ter). La sim COMPTE — le client ne fait que
   * dire « j'appuie, et je vise par là ». À maturité (`WeaponProfile.chargeTicks`),
   * le relâchement sort le coup lourd. Dans le snapshot : en multi, on doit VOIR
   * l'autre armer son tourbillon, sinon la charge n'est un télégraphe pour personne.
   */
  charge?: { dx: number; dy: number; ticks: number }
  /**
   * LA JAUGE D'ABATTAGE (spec recolte-maitrise, verbe 1). Même principe que la
   * charge de combat, mais pour le bois : le clic maintenu sur un arbre EMPLIT
   * `ticks` (la sim compte, le client dessine `ticks / FELL_CHARGE_MAX_TICKS`) ;
   * relâcher dans le VERT sort le coup PROPRE. Dans le snapshot : on doit voir la
   * jauge monter. Absent hors abattage — le minage et la cueillette n'en ont pas.
   */
  harvestCharge?: { nodeId: number; ticks: number }
  /**
   * LA LIGNE TENDUE (spec `peche.md` C3). Posée au lancer, effacée à la prise, au raté ou au
   * premier pas. La sim DATE tout : `biteAt` est tiré au lancer (l'attente), `species` et
   * `windowEnd` sont posés À LA TOUCHE — pas avant, pour que le snapshot ne trahisse pas ce qui
   * mord (pendant la fenêtre, quelques ticks, peu importe). Le client en tire le fil, le
   * flotteur, la plongée, le ferrage ; il ne rapporte jamais un résultat. `bait` : un ver est
   * parti au lancer (et ne revient pas). Absent hors pêche.
   */
  fishing?: {
    /** LA TUILE PÊCHÉE — depuis D9 (2026-08-24), la cible est l'EAU, pas un nœud. */
    tx: number
    ty: number
    /** Le coin, s'il y en avait un sous la tuile : il MODIFIE la table, il ne l'autorise pas. */
    nodeId?: number
    castTick: number
    biteAt: number
    bait: boolean
    /** Combien de fois ça a mordillé sans mordre (D11) — la ligne rentre à `NIBBLES_MAX`. */
    nibbles: number
    species?: FishId
    /** Une TROUVAILLE au bout de la ligne (T4) : ce qui n'est pas un poisson. */
    trouvaille?: import('./items').ItemId
    windowEnd?: number
  }
  /**
   * LE BESTIAIRE (spec `peche.md` B5) — une ligne par espèce déjà prise : combien de fois, et
   * le RECORD de taille en millimètres. Un TABLEAU (invariant §3 : ni `Map` ni `Set`, il voyage
   * dans le snapshot), poussé dans l'ordre de `FISH_SPECIES`.
   *
   * **Il survit à la mort** (décision posée le 2026-08-24) : la mort prend le sac, pas la
   * mémoire. C'est un carnet, pas un bien.
   */
  peche?: { sp: FishId; mm: number; tick: number; prises: number }[]
  /**
   * LE CARNET DE L'ENCYCLOPÉDIE (décision d'Alexis, 2026-08-24) — ce que ce joueur a
   * rencontré, et combien de fois : `{ k: 'recolte:wood', n: 1240 }`. C'est lui qui décide
   * du MUET (une entrée jamais rencontrée ne dit rien) pour toutes les sections SAUF les
   * poissons, qui gardent `peche` (il porte le record en millimètres).
   *
   * Alimenté par `advanceEncyclopedie` (un consommateur du flux d'événements), et SEULEMENT
   * pour les joueurs — un carnet de PNJ voyagerait dans chaque snapshot sans lecteur.
   * Comme `peche`, il survit à la mort : c'est une mémoire, pas un bien.
   */
  carnet?: LigneEncyclo[]
  /**
   * LE DÉPEÇAGE EN COURS (spec `depecage.md` C3). Posé par `butcher_start`, couteau en main, sur
   * une carcasse ; effacé au relâchement, au pas, à la mort, au sac plein, au réservoir vide ou
   * quand le maintien cesse d'être rafraîchi (`heldAt` + `HOLD_GRACE_TICKS`). La sim DATE la
   * prochaine coupe (`nextCutAt`) ; le client dessine le geste penché et le coup de lame, il ne
   * rapporte jamais ce qui sort. Absent hors dépeçage.
   */
  butchering?: { corpseId: number; since: number; nextCutAt: number; heldAt: number }
  /** Le pied du prochain coup : +1 / −1 / +1… (les poings dansent, spec R4bis). */
  swingSide: 1 | -1
  /** Point de respawn hors village (position d'apparition). */
  homeX: number
  homeY: number
  /** Alignement personnel (GDD §3) : chaleur −100..+100, engagement 0..100. */
  warmth: number
  engagement: number
  /** DEV seulement : invulnérable, jauges gelées (voir debug.ts). */
  god?: true
  /**
   * Les lieux connus de ce joueur (spec lieux R3) — index dans `map.zones`.
   * Un tableau, pas un `Set` : l'état de sim reste JSON-sérialisable.
   * Présent sur toutes les entités (forme uniforme = snapshot stable), mais
   * SEULS LES JOUEURS l'alimentent : les PNJ n'ont pas de carte.
   */
  knownPois: number[]
  /**
   * Les lieux ATTEINTS (foulés) par ce joueur. Distinct de `knownPois` : depuis
   * que la découverte se fait à VUE, on connaît un lieu avant d'y avoir mis les
   * pieds — `knownPois` ne peut donc plus servir de garde à la charge. Ce qu'on
   * a vu ≠ ce qu'on a atteint, et seul l'atteindre paye.
   */
  reachedPois: number[]
  /**
   * LES COINS DE CHASSE CONNUS de ce joueur (spec faune R24) — par POSITION, pas
   * par index : un coin peut mourir et renaître ailleurs (R27), et LA CARTE EST
   * UNE MÉMOIRE, PAS UN GPS — l'entrée d'un coin mort reste ici jusqu'à ce que
   * le joueur revienne CONSTATER (l'oubli, `advanceCoinsConnus`). Optionnel :
   * les sauvegardes d'avant R24 n'en ont pas.
   */
  knownGrounds?: { x: number; y: number }[]
}

/**
 * UN GROUPE DE RÉFUGIÉS (V2-25, GDD §520) — des survivants arrêtés sur une route. On peut les
 * RECRUTER (ils rejoignent son village en PNJ — la seule source de population hors paliers du
 * Feu), les NOURRIR (chaleur/Foyer), les REFOULER (ne rien faire, ils repartent) ou les
 * DÉPOUILLER (prendre leur maigre butin — prédation/Meute). C'est un OBJET D'ÉTAT, pas un PNJ
 * qui pense : il stationne, puis s'en va à `until`. Sérialisable (invariant §2).
 */
export interface RefugeeGroup {
  id: number
  tx: number
  ty: number
  /** Combien de survivants — autant de PNJ si on les recrute. */
  count: number
  /** Leur maigre bien (pour qui les dépouille). */
  inventory: Inventory
  /** Tick auquel ils repartent si personne ne les a pris en charge. */
  until: number
}

export interface SimState {
  /** Numéro de tick — l'unique notion de temps dans /sim. */
  tick: number
  /** Seed d'origine, conservée pour l'en-tête du replay log. */
  seed: number
  /** État courant du PRNG (avance à chaque tirage). */
  rngState: number
  /** Jours de saison écoulés par jour réel (1 en multi, libre en Veillée/test). */
  calendarScale: number
  /**
   * LE JOUR OÙ CE MONDE A COMMENCÉ (spec `saisons.md` S2). Le vrai jeu ouvre au jour 51, à la
   * fin de l'Ardeur ; un montage de test ouvre au jour 1, à l'Éclosion. Dans l'ÉTAT et non
   * dans une option volatile : le replay et la sauvegarde doivent le retrouver, sinon une
   * partie reprise change de saison — patron de `finDeSaison`.
   */
  jourDeDepart: number
  /**
   * LE RESET (spec `saison-sans-fin.md` R3b, T4) — le jour de saison après lequel la saison
   * FINIT (verdicts, évacuation avant), ou `null` : JAMAIS. **En solo, jamais** (R4 — décision
   * d'Alexis 2026-08-21 : ni verdict ni Arche en Veillée, la saison ne finit pas, elle tourne) ;
   * le multi garde le jour 61 tant que le wipe n'est pas bâti. Dans l'état, pas dans une
   * option volatile : le replay et la sauvegarde doivent le retrouver. Absent d'une vieille
   * sauvegarde : `undefined` vaut `null` — une Veillée d'avant le pivot ne finit plus non plus.
   */
  finDeSaison: number | null
  /**
   * Décalage de PHASE du cycle jour/nuit, en ticks (0 = le cycle démarre à
   * l'aube). N'affecte QUE le cycle diégétique, jamais le calendrier de saison —
   * permet de commencer une partie à une heure donnée (ex. minuit pour tester la
   * nuit). Voir `cycleOffsetForStartHour` (time.ts).
   */
  cycleOffset: number
  map: WorldMap
  nextEntityId: number
  entities: Entity[]
  villages: Village[]
  structures: Structure[]
  /**
   * LES FONCTIONS ÉMERGENTES reconnues (spec construction R9-R10) — dérivé PUR des
   * structures, recalculé à chaque mutation (`refreshFunctions`). Dans le snapshot :
   * le tableau du village et l'overlay client le lisent au lieu de re-reconnaître.
   */
  functions: import('./construction').RecognizedFunction[]
  nodes: ResourceNode[]
  npcs: Npc[]
  monsters: Monster[]
  corpses: Corpse[]
  nextCorpseId: number
  /**
   * LES SOLS QUI TRAVAILLENT (spec `cendreux.md` R14, R21) — les réveils en cours.
   *
   * Le SEUL état neuf du chantier du réveil, et il est minimal : quatre nombres par entrée,
   * une poignée d'entrées à la fois (le plafond de l'acte les borne), JSON-sérialisable. Le
   * CHAMP des morts, lui, n'y est pas et n'y sera jamais : il se dérive de la carte et du
   * tick (R15), comme le front de cendre.
   */
  reveils: Reveil[]
  /** LES LIEUX BRÛLÉS (décision ⑧, 2026-08-21) : charniers/repaires assainis au feu — la
   *  densité des morts tombe autour, la respiration se suspend, jusqu'à `until`. */
  lieuxBrules: { zone: number; until: number }[]
  /**
   * L'ÂGE EFFECTIF DE CHAQUE FOYER DE CENDRE, en jours, indexé comme `foyersDeLaCarte(map)`
   * (spec `cendre.md`). **Le seul état de toute la mécanique** — tout le reste se dérive du tick.
   * Il existe parce qu'un GEL (brûler la fosse, R16) est un ACTE et non une fonction du temps, et
   * il porte du même coup le caractère de la saison (R18 : `deluge` fait vieillir de 0,4 jour,
   * `reveil` de 1,6). Dix nombres. Avancé une fois par bascule de jour de saison.
   */
  cendreAge: number[]
  /**
   * LE DERNIER JOUR DE SAISON OÙ LA CENDRE A VIEILLI. **Un nombre, et il n'est pas redondant** :
   * `debug_set_season_day` RÉÉCRIT le tick, donc `jourDeSaison(tick − 1)` est déjà la veille du
   * jour visé et ne dit RIEN des centaines de jours enjambés. Sans cette mémoire, un saut de
   * saison laissait la cendre à sa tache initiale (CONSTATÉ au navigateur : âge 1 au jour 240) —
   * un outil de debug qui ment sur l'état du monde, et le même piège pour un serveur qui rattrape
   * du retard.
   */
  cendreJour: number
  /**
   * LES ENVOLS RÉCENTS (forêts-vivantes §3 R4bis) : les perchoirs se reposent — un envol
   * par zone tous les `ENVOL_COOLDOWN_TICKS`. Liste BORNÉE (purgée à chaque déclenchement),
   * JSON-sérialisable. Optionnelle : une sauvegarde d'avant reprend sans, et se la crée.
   */
  envols?: { x: number; y: number; t: number }[]
  hordes: Horde[]
  nextHordeId: number
  /** LE PRÉSAGE DE LA VEILLE (décision ⑱, 2026-08-21) : la horde de ce soir, décidée à
   *  l'aube — null la plupart des jours. La méga-horde scriptée n'existe plus (⑲). */
  presage: Presage | null
  lastConvoyDay: number
  /** Mémoire d'agression entre villages (premier sang, spec alignement R4). */
  aggressions: Aggression[]
  evacuation: { tx: number; ty: number } | null
  /** L'ARCHE EST PARTIE — le verrou une-seule-fois, comme `megaHordeSpawned`. Sans lui,
   *  `evacuation = null` au départ re-remplissait la condition d'ouverture au tick suivant :
   *  ouvre→part→ouvre→part À CHAQUE TICK dès le jour 58 (57 600 événements/jour mesurés au
   *  banc de saison le 2026-08-16, `evacuatedIds` regonflé en boucle, un tirage RNG par
   *  réouverture). Absent d'une vieille sauvegarde : `undefined` vaut `false`, l'Arche n'y
   *  était jamais partie. */
  arkDeparted: boolean
  /** L'ARCHE (V2-24) : les entités montées à bord AVANT le départ (dans le rayon à l'heure du
   *  départ). L'évacuation n'est plus un marqueur passif — elle LÈVE L'ANCRE : seuls les
   *  embarqués comptent au verdict Foyer, pas ceux qui traînent près à la fin. */
  evacuatedIds: number[]
  /** LES RÉFUGIÉS (V2-25, GDD §520) — groupes de survivants arrivés sur les routes, en
   *  attente d'être recrutés/nourris/dépouillés/refoulés. Objets d'état (comme l'évacuation),
   *  pas des PNJ : ils attendent, puis repartent. `nextRefugeeGroupId`/`lastRefugeeDay`
   *  cadencent l'arrivée (comme les convois). */
  refugeeGroups: RefugeeGroup[]
  nextRefugeeGroupId: number
  lastRefugeeDay: number
  /** Lieux déjà atteints par un joueur, tous joueurs confondus (spec lieux R12).
   *  Global : il n'y a qu'un premier — en multi, c'est une course. */
  visitedPois: number[]
  seasonEnded: boolean
  nextVillageId: number
  nextStructureId: number
  /** Buffer d'événements de domaine, drainé par l'hôte (voir events.ts). */
  events: SimEvent[]
  /** Outils de dev armés ? Faux partout sauf hôte de développement (voir debug.ts). */
  debug: boolean
  /** Plafond de faune ambiante de ce monde (0 = aucune ; spec faune R1). */
  faunaCap: number
  /** Hordes et convois armés ? (voir SimOptions.worldEvents) */
  worldEvents: boolean
  /** Le foyer, qui dessine les trois cercles (voir SimOptions.home). `null` = monde uniforme. */
  home: { x: number; y: number } | null
  /** Prochaine identité de harde à distribuer (spec faune R9). */
  nextHerdId: number
  /**
   * LA PRESSION DE CHASSE (spec faune R16). Les endroits où l'on vient d'abattre
   * du gibier : le peuplement ambiant n'y sème plus rien jusqu'à `until`. C'est
   * ce qui interdit de farmer sur place — le gibier déserte ce qu'on chasse.
   */
  faunaQuiet: { x: number; y: number; until: number }[]
  /**
   * LES COINS DE CHASSE (spec faune R17) : les lieux FIXES où le gibier vit —
   * un biome ouvert à portée d'eau, semé une fois pour la saison. Entre eux, la
   * vallée est vide. C'est une décision d'HÔTE, comme `faunaCap` et `dens` : une
   * liste VIDE rend l'ancien peuplement uniforme (les bancs de test n'ont pas
   * demandé de géographie).
   */
  grounds: { x: number; y: number }[]
  /**
   * LE DÉFICIT DE COINS (faune R27) : combien de coins éteints attendent encore
   * leur renaissance — l'entretien quotidien retente, borné, jusqu'à résorption.
   * Optionnel : les sauvegardes d'avant R27 n'en ont pas (`?? 0` à la lecture).
   */
  coinsAResemer?: number
  /**
   * LE SANG AU SOL (spec chasse C9). Les gouttes semées par ce qui saigne — bête
   * blessée comme avatar (le sang est le sang). C'est de l'ÉTAT, pas des
   * événements : haute fréquence ≠ domaine. Le client les dessine et les efface,
   * personne d'autre ne les consomme. Borné des deux côtés (TTL + plafond FIFO) :
   * le snapshot reste petit.
   */
  blood: { x: number; y: number; tick: number }[]
  /**
   * LE CAP DU VENT (spec `vent.md` V1/V4 ; l'odorat, chasse C17), un des huit relèvements —
   * DÉRIVÉ du front météo qui traverse, ou du relèvement d'ambiance entre deux fronts. L'odeur
   * DESCEND le vent : une menace au vent d'une bête la trahit, quels que soient son allure, son
   * couvert et le dos tourné. La parade n'est pas un facteur de plus : c'est un CÔTÉ.
   *
   * ⚠ `{0, 0}` est une SENTINELLE, pas une valeur : « ce monde n'a pas de vent, et n'en aura
   * jamais » — une décision d'HÔTE (comme `faunaCap`) dont les bancs se servent pour mesurer
   * l'odorat en canal isolé. La loi ne la produit jamais, et ne l'écrase jamais.
   */
  wind: { x: number; y: number }
  /**
   * LA FORCE DU VENT AU CENTRE DE LA CARTE (spec `vent.md` V3), de `VENT.AMBIANT` à 1 — et 0
   * tout court sous la sentinelle ci-dessus. Elle ne vit PAS dans la norme de `wind` : une norme
   * qui pourrait légitimement valoir 0 au calme entrerait en collision avec la sentinelle.
   *
   * C'est la valeur GLOBALE, pour le HUD et les lecteurs grossiers. Ce qui a besoin de la force
   * LÀ OÙ IL SE TROUVE appelle `ventForceAt(state, x, y)` : la bande est spatiale.
   */
  windForce: number
  /**
   * LES PILES D'ITEMS AU SOL (spec chasse C18, décision utilisateur n°4). Ce
   * qu'on JETTE : appât pour le gibier, viande pour détourner une meute, charge
   * larguée en fuite. Périssables — le monde ne se jonche pas.
   */
  /** `surCoulee` (forêts-vivantes §4) : mémorisé à la PREMIÈRE lecture d'appât — fonction
   *  pure de la position, même tick même valeur partout : déterministe et rejouable. */
  groundItems: { id: number; x: number; y: number; item: ItemId; count: number; expiresAt: number; surCoulee?: boolean }[]
  nextGroundItemId: number
  /**
   * Les LIEUX que l'hôte a peuplés d'une bête (index de `map.zones`). Le
   * peuplement reste une décision d'hôte, exactement comme `faunaCap` : sans
   * cette liste, `advanceDens` prendrait « ce lieu n'a pas de bête » pour « sa
   * bête est morte » et sèmerait des sangliers dans des mondes qui n'en voulaient
   * pas — jusque dans les bancs de test headless, dont il a tué les villageois.
   */
  dens: number[]
  /**
   * Les tanières dont la bête est tombée, et le tick où elle reviendra (spec
   * faune R16). Sans ça, un lieu tué une fois reste vide pour la saison.
   */
  denRespawns: { zone: number; at: number }[]
  /**
   * LA BRUME (spec `brume.md`) — la nappe en cours (annoncée ou levée), ou rien. Les trois
   * champs sont OPTIONNELS (patron `envols`) : une sauvegarde d'avant reprend sans, et s'en
   * crée à la prochaine annonce. La géométrie de la nappe au tick se CALCULE (`brumeCentre`),
   * seul le corridor élu est rangé.
   */
  brume?: import('./brume').Brume | null
  /** Le filon découvert par le dernier retrait de Brume — retiré vidé ou périmé. */
  brumeFilon?: { nodeId: number; expiresDay: number } | null
  /** Le dernier jour de saison où l'annonce de Brume a été jouée (une par jour au plus). */
  lastBrumeDay?: number
  /**
   * LA MÉTÉO (spec `meteo.md`) — le front en cours, ou rien. Champs OPTIONNELS (patron
   * Brume ci-dessus) : une sauvegarde d'avant reprend sans, et s'en crée à la prochaine
   * élection. La géométrie de la bande au tick se CALCULE (`frontMeteoPos`), seule
   * l'élection du jour est rangée — purgée sitôt le front sorti.
   */
  meteo?: import('./meteo').MeteoFront | null
  /** Le dernier jour de saison où l'élection météo a été jouée (au plus un front par jour). */
  lastMeteoCycle?: number
  /** Le dernier jour de saison ÉVALUÉ pour l'annonce de la veille au crépuscule (spec R9,
   *  patron `lastBrumeDay`) — au plus une annonce de blizzard par jour annoncé. */
  lastMeteoAnnonceCycle?: number
  /** Fronts armés ? Interrupteur DÉDIÉ (spec meteo.md R10), absent/faux par défaut —
   *  séparé de `worldEvents` (voir SimOptions.meteoActive). */
  meteoActive?: boolean
}

export interface SimOptions {
  map?: WorldMap
  calendarScale?: number
  /** Le jour de saison où le monde ouvre (spec `saisons.md` S2) — 51 dans le vrai jeu,
   *  1 par défaut (les montages de test ouvrent à l'Éclosion). */
  jourDeDepart?: number
  /** Le jour après lequel la saison finit, ou `null` : jamais (le solo). Défaut : le jour 60 —
   *  la saison nominale des bancs, des tests et du multi d'aujourd'hui. */
  finDeSaison?: number | null
  /** Nœuds de ressources — typiquement `generateNodes(map, seed)`. */
  nodes?: ResourceNode[]
  /** Décalage de phase du cycle (ticks) — voir `cycleOffsetForStartHour`. */
  cycleOffset?: number
  /** Arme les `DebugAction` (TP, heure, invulnérabilité). Jamais en production. */
  debug?: boolean
  /**
   * Combien de bêtes ambiantes ce monde porte-t-il (spec faune R1) ? C'est une
   * décision d'HÔTE, comme la densité de nœuds ou l'échelle du calendrier :
   * une carte de jeu grouille (`FAUNA.CAP`), un banc de test est vierge (0, le
   * défaut) — sinon chaque scénario headless traînerait trente lapins et un
   * flux de PRNG qu'il n'a pas demandé.
   */
  faunaCap?: number
  /**
   * LES COINS DE CHASSE (spec faune R17) — typiquement `placeHuntingGrounds(map, seed)`.
   * Sans eux, le peuplement redevient uniforme : un banc de test n'a pas demandé
   * de géographie, et il ne doit pas en payer une.
   */
  grounds?: { x: number; y: number }[]
  /**
   * Ce monde connaît-il les ÉVÉNEMENTS DU MONDE (hordes, convois) ? Vrai par
   * défaut : une partie en a, évidemment. Un banc de test PNJ, lui, mesure une
   * ÉCONOMIE — il ne devrait pas voir son verdict décidé par une guerre qu'il n'a
   * pas demandée. Même raison que `faunaCap` ci-dessus, et même précédent.
   *
   * Trouvé en le mesurant (2026-07-12) : les hordes tombent sur un `roll` par
   * nuit, donc sur le FLUX du PRNG. Toute modification de comportement — le craft
   * qui prend du temps, par exemple — décale ce flux et rebat le tirage. Or à
   * ≥ 5 hordes un village PNJ est RASÉ, à ≤ 4 il tient : le critère « il survit
   * 10 jours » n'était pas une propriété du village, c'était le tirage du seed 11.
   */
  worldEvents?: boolean
  /**
   * LE FOYER : le point de départ du joueur. Décision d'HÔTE (comme `faunaCap` ou
   * la densité de nœuds) : c'est lui qui dessine LES TROIS CERCLES du GDD §8bis —
   * médiocre et sûr autour, riche et dangereux au loin. Absent = monde uniforme
   * (un banc de test ne veut pas d'une géographie qu'il n'a pas demandée).
   */
  home?: { x: number; y: number }
  /**
   * LA MÉTÉO (spec `meteo.md` R10) : fronts armés ? FAUX par défaut — l'inverse de
   * `worldEvents`, et c'est voulu : les bancs et leurs seuils ABSOLUS (la famine du banc
   * de scénario) ne doivent pas rougir parce qu'un front qu'ils n'ont pas demandé est
   * passé — on mesure l'économie sans le bruit météo, puis avec. Le vrai jeu (Veillée,
   * LAN) l'arme explicitement à la création du monde.
   */
  meteoActive?: boolean
}

/** Intention d'un avatar pour un tick : déplacement, postures, au plus une action. */
export interface MoveInput {
  entityId: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint?: boolean
  /** LE PAS LENT (spec chasse C2) : discret pour la faune, et lent — c'est le prix. */
  sneak?: boolean
  block?: boolean
  action?: PlayerAction
}

export function createSim(seed: number, options: SimOptions = {}): SimState {
  const state: SimState = {
    tick: 0,
    seed,
    rngState: seed >>> 0,
    calendarScale: options.calendarScale ?? BALANCE.DEFAULT_CALENDAR_SCALE,
    jourDeDepart: options.jourDeDepart ?? 1,
    // RELATIF AU JOUR DE DÉPART (S2) : une saison dure `SEASON_DAYS` jours À PARTIR de
    // l'ouverture. En absolu, un monde né au jour 51 rendait ses verdicts dix cycles plus tard.
    finDeSaison:
      options.finDeSaison === undefined
        ? (options.jourDeDepart ?? 1) + BALANCE.SEASON_DAYS - 1
        : options.finDeSaison,
    cycleOffset: ((options.cycleOffset ?? 0) % TICKS_PER_CYCLE + TICKS_PER_CYCLE) % TICKS_PER_CYCLE,
    // Copies profondes (JSON — l'état est JSON-sérialisable par design) :
    // les options sont des ENTRÉES immuables. Les partager par référence
    // corromprait le replay log (bug attrapé par le test A7 — la sim live
    // mutait les nœuds du log, le replay partait d'arbres vides).
    map: options.map ? (JSON.parse(JSON.stringify(options.map)) as WorldMap) : createEmptyMap(64, 64, TERRAIN_GRASS),
    nextEntityId: 1,
    entities: [],
    villages: [],
    structures: [],
    functions: [],
    nodes: options.nodes ? (JSON.parse(JSON.stringify(options.nodes)) as ResourceNode[]) : [],
    npcs: [],
    monsters: [],
    corpses: [],
    reveils: [],
    lieuxBrules: [],
    cendreAge: [],
    cendreJour: 0,
    nextCorpseId: 1,
    hordes: [],
    refugeeGroups: [],
    nextRefugeeGroupId: 1,
    lastRefugeeDay: 0,
    nextHordeId: 1,
    lastConvoyDay: 0,
    aggressions: [],
    presage: null,
    evacuation: null,
    arkDeparted: false,
    evacuatedIds: [],
    visitedPois: [],
    seasonEnded: false,
    nextVillageId: 1,
    nextStructureId: 1,
    events: [],
    debug: options.debug ?? false,
    faunaCap: options.faunaCap ?? 0,
    worldEvents: options.worldEvents ?? true,
    home: options.home ?? null,
    nextHerdId: 1,
    faunaQuiet: [],
    grounds: options.grounds ? options.grounds.map((g) => ({ x: g.x, y: g.y })) : [],
    dens: [],
    denRespawns: [],
    blood: [],
    // Le vent de départ : le premier des huit relèvements. Il tournera (C17, `vent.md` V4).
    wind: { x: 1, y: 0 },
    // La force de départ : l'ambiance. La première phase la recalcule (`vent.md` V3).
    windForce: VENT.AMBIANT,
    groundItems: [],
    nextGroundItemId: 1,
  }
  // LA MÉTÉO s'arme à la DEMANDE seulement, et la clé n'existe pas sinon (patron des
  // champs optionnels de la Brume) : une partie sans météo garde l'empreinte d'état — donc
  // le snapshot ET la forme attendue par la persistance — d'avant le système, au bit près.
  if (options.meteoActive) state.meteoActive = true
  // LE JOUR ET L'ACTE DE NAISSANCE SE DÉRIVENT (S2) — ils étaient écrits en dur, `1` et `1`,
  // et aucun compilateur ne l'aurait dit : un monde né au jour 51 se serait cru à l'Éclosion
  // pendant que l'Ardeur finissait. La phase du cycle dépend de `cycleOffset` (0 = aube).
  const startsAtNight = state.cycleOffset >= dayTicksAt(state, 0)
  emitEvent(state, { type: 'season_day_started', tick: 0, day: state.jourDeDepart })
  emitEvent(state, { type: 'act_started', tick: 0, act: actForDay(state.jourDeDepart) })
  emitEvent(state, startsAtNight ? { type: 'night_started', tick: 0 } : { type: 'day_started', tick: 0 })
  return state
}

/**
 * Fait naître une entité. `slots` = la taille de son sac : la capacité se donne
 * À LA NAISSANCE (spec inventaire R1, R7) — les PNJ et les bêtes en reçoivent un
 * grand (`SLOTS.NPC`), le joueur celui de sa ceinture + son sac.
 */
export function spawnEntity(state: SimState, x: number, y: number, slots: number = SLOTS.PLAYER): number {
  const id = state.nextEntityId
  state.nextEntityId += 1
  state.entities.push({
    id,
    x,
    y,
    inventory: makeInventory(slots),
    hunger: 100,
    temperature: TEMPERATURE.CORPS_SAIN,
    skills: {},
    /**
     * UN AVATAR NAÎT AVEC SA PREMIÈRE CASE ARMÉE (décision d'Alexis, 2026-08-20, question ⑨).
     *
     * La ceinture est l'affordance la plus structurante du HUD — « l'objet en main décide du
     * clic » est la règle centrale du jeu — et elle démarrait ÉTEINTE : mesuré sur deux
     * captures de deux lots, zéro pixel d'ambre dans la bande de ceinture au premier instant.
     * Rien ne disait qu'on peut « tenir » quelque chose, ni où ça se voit. Le rendu de l'état
     * actif fonctionne (290 px d'anneau mesurés ailleurs) : c'est `activeSlot` qui valait −1.
     *
     * La case est vide au départ, donc on ne perd aucune information — on allume seulement le
     * repère, au moment où le joueur le découvre.
     *
     * GARDÉ SUR LE SAC DU JOUEUR, et c'est nécessaire : `spawnEntity` sert AUSSI aux PNJ
     * (`SLOTS.NPC`) et aux monstres (leur propre sac). Armer leur case 0 leur mettrait en main
     * ce qui s'y trouve et changerait `equipBestWeapon` — une conséquence de combat pour une
     * question d'interface. Seul l'avatar est concerné.
     *
     * ET C'EST ICI, PAS CHEZ L'HÔTE : le serveur REJOUE les arrivées par `spawnEntity`
     * (`replay-log.ts`). Poser la case dans `veillee.ts` seulement aurait fait diverger le
     * replay du direct. Aucun tirage RNG, aucun compte d'entité changé : même graine, même état.
     */
    activeSlot: slots === SLOTS.PLAYER ? 0 : -1,
    cooldownUntil: 0,
    craftQueue: [],
    hp: 100,
    stamina: 100,
    wounds: {},
    facing: { x: 1, y: 0 },
    blocking: false,
    moved: false,
    // `walk` par défaut : les PNJ (qui ne passent pas par les inputs) sonnent
    // comme des marcheurs (spec chasse C2) ; l'avatar joué est re-posé chaque tick.
    gait: 'walk',
    exhaustedUntil: 0,
    deathCount: 0,
    lastDeathAt: 0,
    swingSide: 1,
    homeX: x,
    homeY: y,
    warmth: 0,
    engagement: 0,
    knownPois: [],
    reachedPois: [],
  })
  // Consomme un pas de PRNG : le spawn fait partie de l'histoire déterministe.
  state.rngState = rngNext(state.rngState)
  emitEvent(state, { type: 'entity_spawned', tick: state.tick, entityId: id, x, y })
  return id
}

/**
 * Retire un avatar joueur du monde (multi : déconnexion). Miroir PUR du chemin
 * mort-PNJ (`combat.ts`) : l'entité disparaît et le village qui l'employait est
 * nettoyé de sa référence. À la différence de la mort d'un joueur — qui RESPAWN
 * l'entité au Feu sans la retirer —, ici l'entité s'en va pour de bon.
 *
 * Ne consomme PAS de pas de PRNG (un départ n'est pas un tirage) et n'est pas
 * gardé par `debug` : c'est une opération d'hôte structurelle. Doit s'appliquer
 * EN TÊTE DE TICK, avant `step` — jamais au milieu d'une itération d'inputs, où
 * un `entities` qui rétrécit sauterait des avatars.
 */
export function despawnAvatar(state: SimState, id: number): void {
  const existed = state.entities.some((e) => e.id === id)
  if (!existed) return
  state.entities = state.entities.filter((e) => e.id !== id)
  for (const village of state.villages) {
    village.memberIds = village.memberIds.filter((m) => m !== id)
    for (const task of village.tasks) if (task.claimedBy === id) task.claimedBy = null
  }
  emitEvent(state, { type: 'entity_despawned', tick: state.tick, entityId: id })
}

/**
 * LA formule du modificateur de vitesse d'un avatar — partagée entre `step`
 * (autorité) et la prédiction du client. Toute condition ajoutée ici est
 * automatiquement prédite juste ; une copie divergente côté client serait
 * une misprédiction systématique (rubber-band).
 */
/**
 * LE PRIX DE LA CHARGE (spec portage.md P5) : 1 tant qu'on est sous le confort,
 * puis décroissance linéaire, plancher à `SPEED_FLOOR`.
 *
 * `+ − × ÷`, `min`, `max` : rien d'autre. Cette fonction entre dans la vitesse,
 * donc dans le replay ET dans la prédiction du client — une fonction Math
 * approximée (`pow`, `exp`) donnerait un résultat différent d'un moteur JS à
 * l'autre, et un replay enregistré au navigateur ne rejouerait pas sur Node
 * (invariant §2).
 */
export function carrySpeedFactor(ratio: number): number {
  const tier = carryTier(ratio)
  if (tier === 'light') return CARRY.SPEED_LIGHT
  if (tier === 'medium') return CARRY.SPEED_MEDIUM
  if (tier === 'heavy') return CARRY.SPEED_HEAVY
  // SURCHARGÉ, et là SEULEMENT : la peine grandit à chaque objet de plus. On part
  // du palier lourd et on descend, jusqu'au plancher (on rampe, mais on avance).
  const over = ratio - CARRY.HEAVY_MAX
  return Math.max(CARRY.SPEED_FLOOR, CARRY.SPEED_HEAVY - CARRY.OVERLOAD_MALUS_PER_RATIO * over)
}

/**
 * La vitesse, TOUT COMPRIS — et c'est la SEULE formule : la sim l'applique, et la
 * prédiction locale du client l'appelle littéralement (spec portage.md P10). Une
 * copie côté client divergerait au premier ajustement, et une divergence de vitesse
 * fait se téléporter l'avatar à chaque réconciliation.
 *
 * Le poids entre ICI, pas ailleurs. On ne SPRINTE PAS chargé (P6) : au-dessus de
 * `SPRINT_MAX`, le sprint n'est pas ralenti — il est REFUSÉ. C'est la première
 * chose que le joueur sent, avant même de regarder une jauge.
 */
export function speedScaleFor(
  entity: Pick<Entity, 'hunger' | 'wounds' | 'stamina' | 'temperature' | 'inventory'> & { exhausted?: true | undefined },
  input: { sprint: boolean; block: boolean; moving: boolean; charging?: boolean; sneak?: boolean; drawing?: boolean },
  /** LA MÉTÉO SOUS LES PIEDS (spec meteo.md R7) : `meteoSpeedFactor(state, x, y)` du
   *  marcheur, fourni par l'appelant — la formule reste pure d'état, la prédiction client
   *  passera le sien (même fonction, même snapshot). Défaut 1 : ciel clair. */
  meteoFactor = 1,
  /** LA CLARTÉ SUR SOI (`nuit.clarteSurSoi`), dans [0, 1] — fournie par l'appelant, comme la
   *  météo au-dessus, pour que la formule reste pure d'état et que la prédiction du client
   *  passe exactement la même. Défaut 1 : plein jour. */
  clarte = 1,
): { scale: number; sprinting: boolean; sneaking: boolean } {
  let scale = 1
  if (entity.hunger <= 0) scale *= BALANCE.HUNGER_SPEED_MALUS
  scale *= coldSpeedFactor(entity.temperature)
  // LA PLUIE ALOURDIT LE PAS (spec meteo.md R7) — même chaîne, même endroit que le froid,
  // et MÊME PÉRIMÈTRE assumé : les HUMAINS (décision d'intégrateur T5). Les monstres n'ont
  // pas de température et ne passent pas par ici — l'asymétrie est celle du froid, déjà
  // actée : le blizzard rend le VOYAGE plus dangereux (« voyager devient dangereux », GDD),
  // il ne ralentit pas la meute qui vous y attend. Multiplicatif, pendant le front
  // seulement : le facteur revient à 1 avec la bande, aucune accumulation au sol.
  scale *= meteoFactor
  if (entity.wounds.leg) scale *= COMBAT.LEG_WOUND_SPEED
  const ratio = carryRatio(entity.inventory)
  const tier = carryTier(ratio)
  scale *= carrySpeedFactor(ratio)
  // ═══ ON NE COURT PAS, ET ON NE PARE PAS, DANS LE NOIR ═══
  // (décision d'Alexis, 2026-08-26 : « la sortie dehors la nuit doit être dure ». Le pourquoi
  // de ces deux capacités-là — et la mesure qui les désigne — vit dans le bloc `NUIT` de
  // `balance.ts`.) REFUSÉES, pas dégradées : c'est le patron du palier LOURD juste en dessous,
  // et c'est ce qui rend la règle lisible sans une ligne d'interface — on appuie, le corps ne
  // suit pas. Elle se répare d'un geste que le joueur possède déjà : une torche, un feu, ou
  // simplement attendre que la lune revienne.
  const voitClair = clarte >= NUIT.SEUIL_NOIR
  // On ne sprinte plus dès le palier LOURD (spec P6) : refusé, pas ralenti.
  const canSprint = (tier === 'light' || tier === 'medium') && voitClair
  const blocking = input.block && entity.stamina > 0 && voitClair
  // ON NE CHARGE PAS EN COURANT (spec R4ter) : armer un coup lourd, c'est se planter
  // sur ses appuis. Le sprint est refusé, pas seulement ralenti — sans quoi la charge
  // serait une posture de fuite, et l'engagement qu'elle est censée coûter n'existerait pas.
  const charging = input.charging ?? false
  // LE PAS LENT (spec chasse C2). Il PRIME sur le sprint : on ne court pas
  // accroupi, et des deux touches tenues, c'est l'intention délibérée qui gagne.
  // Il se COMBINE à la charge (× les deux facteurs) : ramper lance armée est
  // exactement l'approche que la mise à mort propre récompense (C6).
  //
  // ═══ SAUF L'ARC : ON NE BANDE PAS ACCROUPI ═══
  // (décision d'Alexis, 2026-08-02 : « lorsqu'on bande on est forcément debout »)
  //
  // Tirer à l'arc demande de se PLANTER sur ses appuis et d'ouvrir la poitrine — la
  // posture même qu'on abandonne en rampant. La bande CHASSE donc le pas lent, elle ne
  // s'y ajoute pas ; c'est la seule exception à la ligne du dessus, et elle vaut pour
  // les armes de tir seulement (une lance s'arme très bien à quatre pattes).
  //
  // ET ELLE A DES DENTS, parce qu'elle croise `tir.md` T7 : perdre le pas lent fait
  // passer la visibilité de `VIS_SNEAK` (0,55) à `VIS_WALK` (1) — puis la bande la
  // majore encore. Ramper vers une bête EN BANDANT n'est donc pas seulement interdit :
  // c'est le plus mauvais des choix. La parade tient en un geste — s'arrêter, se
  // relever, bander, décocher — et c'est exactement le stop-and-go de chasse C1.
  const sneaking = (input.sneak ?? false) && !blocking && !(input.drawing ?? false)
  // À BOUT DE SOUFFLE, ON MARCHE — et on le reste jusqu'à `SPRINT_RECOVER_STAMINA`
  // (R1ter). `stamina > 0` seul rendait la course DÈS le premier point regagné, d'où une
  // oscillation sprint/marche à 10 Hz qui laissait fuir à 5 t/s pour toujours.
  const sprinting =
    !blocking && !charging && !sneaking && input.sprint && entity.stamina > 0 && !entity.exhausted && input.moving && canSprint
  if (blocking) scale *= COMBAT.BLOCK_MOVE_FACTOR
  else if (sprinting) scale *= COMBAT.SPRINT_FACTOR
  else if (sneaking) scale *= HUNT.SNEAK_SPEED_FACTOR
  if (charging) scale *= COMBAT.CHARGE_MOVE_FACTOR
  return { scale, sprinting, sneaking }
}

/** Avance la simulation d'exactement un tick. Mute `state` en place. */
export function step(state: SimState, inputs: MoveInput[]): void {
  // LA MARQUE DU BUFFER, prise AVANT que quoi que ce soit n'émette : le carnet de
  // l'encyclopédie ne lira que la tranche écrite par CE tick (voir `advanceEncyclopedie` —
  // le buffer n'est vidé que par l'hôte, et un appelant qui ne draine pas ferait recompter).
  const eventsAuDepart = state.events.length
  // `moved` décrit CE tick : remis à zéro ici, levé par chaque système de
  // déplacement (inputs, PNJ, monstres). Sans ce reset, une entité sans
  // input garderait la valeur d'un tick passé — et la régén d'endurance
  // (qui en dépend) mentirait.
  for (const entity of state.entities) entity.moved = false
  for (const input of inputs) {
    const entity = state.entities.find((e) => e.id === input.entityId)
    if (!entity) continue
    // L'action d'abord (un mur bâti ce tick bloque dès ce tick), le pas ensuite.
    const action = input.action
    if (action) {
      if (isDebugAction(action)) {
        applyDebugAction(state, input.entityId, action)
      } else if (isInventoryAction(action)) {
        applyInventoryAction(state, input.entityId, action)
      } else if (
        action.type === 'harvest' ||
        action.type === 'harvest_charge_start' ||
        action.type === 'harvest_release' ||
        action.type === 'cast_line' ||
        action.type === 'butcher_start' ||
        action.type === 'butcher_stop' ||
        action.type === 'craft' ||
        action.type === 'cancel_craft' ||
        action.type === 'eat'
      ) {
        applyEconomyAction(state, input.entityId, action)
      } else if (
        action.type === 'attack' ||
        action.type === 'attack_charge' ||
        action.type === 'attack_release' ||
        action.type === 'attack_cancel' ||
        action.type === 'bandage' ||
        action.type === 'loot_corpse'
      ) {
        applyCombatAction(state, input.entityId, action)
      } else {
        applyVillageAction(state, input.entityId, action)
      }
    }

    // LA CLARTÉ SUR SOI, lue UNE FOIS pour ce corps et pour ce tick : la posture ci-dessous
    // et `speedScaleFor` plus bas doivent juger sur le MÊME nombre, sans quoi un avatar
    // pourrait garder sa parade et perdre ses jambes (ou l'inverse) à la frontière du seuil.
    const clarte = clarteSurSoi(state, entity)
    // Postures (spec combat) : bloquer, viser, sprinter.
    // ⚠ ON NE PARE PAS CE QU'ON NE VOIT PAS (2026-08-26) : même seuil que `speedScaleFor`.
    entity.blocking = (input.block ?? false) && entity.stamina > 0 && clarte >= NUIT.SEUIL_NOIR
    // LE PAS ORIENTE — SAUF QUAND ON ARME (décision d'Alexis, 2026-08-02). Pendant une
    // charge, c'est la VISÉE qui tient le corps : reculer en bandant ne doit pas faire
    // pivoter l'archer dos à sa cible, alors que la zone, elle, continue de la montrer.
    // Un corps qui regarde ailleurs que son propre télégraphe est un mensonge de plus.
    if ((input.dx !== 0 || input.dy !== 0) && entity.charge === undefined) {
      const len = Math.sqrt(input.dx * input.dx + input.dy * input.dy)
      entity.facing = { x: input.dx / len, y: input.dy / len }
    }

    if (entity.windup) {
      entity.moved = false
      entity.gait = 'still' // le wind-up immobilise : on frappe, on ne marche pas
      continue // le wind-up immobilise (spec R4)
    }
    const { scale: speedScale, sprinting, sneaking } = speedScaleFor(entity, {
      sprint: input.sprint ?? false,
      block: input.block ?? false,
      moving: input.dx !== 0 || input.dy !== 0,
      charging: entity.charge !== undefined,
      sneak: input.sneak ?? false,
      // BANDER, c'est se tenir DEBOUT (décision d'Alexis) : seule une arme de TIR chasse
      // le pas lent — une lance s'arme très bien accroupi.
      drawing: entity.charge !== undefined && tientUnArc(entity),
      // LE FRONT SOUS LES PIEDS (spec meteo.md R7) : évalué à la position du marcheur,
      // ce tick — la rampe de `meteoIntensity` fait le reste (une pente, jamais un mur).
    }, meteoSpeedFactor(state, entity.x, entity.y), clarte)
    // L'ALLURE du tick (spec chasse C2) — ce que la faune entendra de ce pas.
    const moving = input.dx !== 0 || input.dy !== 0
    entity.gait = !moving ? 'still' : sprinting ? 'sprint' : sneaking ? 'sneak' : 'walk'
    if (sprinting) {
      entity.stamina = Math.max(0, entity.stamina - COMBAT.SPRINT_STAMINA_PER_S / BALANCE.TICK_RATE_HZ)
    }
    const world = {
      map: state.map,
      structures: state.structures,
      nodes: state.nodes,
      moverVillageId: getVillageOf(state, input.entityId)?.id ?? null,
      // LE GEL SOUS LES PIEDS (spec `gel.md` G4) : la glace ouvre le lac et change la
      // vitesse du gué — la marchabilité et le pas se décident dans `collision.ts`, ici on
      // ne fait que donner l'heure du monde.
      etat: state,
    }
    const moved = moveAvatar(world, entity.x, entity.y, input.dx, input.dy, TICK_DT_S, speedScale)
    entity.moved = moved.x !== entity.x || moved.y !== entity.y
    entity.x = moved.x
    entity.y = moved.y
  }
  // La découverte est la conséquence du pas qu'on vient de faire (spec lieux R6).
  advancePois(state)
  // Les tanières vidées se repeuplent (spec faune R16) — hors de vue, et jamais vite.
  advanceDens(state, state.seed)
  // Le monde d'abord (spawns/alarmes), puis PNJ, monstres, résolution.
  if (state.worldEvents) {
    advanceWorldEvents(state)
    // LES RÉFUGIÉS (V2-25) : un événement du monde comme les convois — même interrupteur.
    // Arrivée positionnée par hash2 (aucun tirage RNG), donc pas de décalage du flux seedé.
    advanceRefugees(state)
    // LA BRUME (spec brume.md) : même interrupteur — annonce au crépuscule (hash2, aucun
    // tirage), nappe de l'aube au crépuscule, filon gardé au retrait.
    advanceBrume(state)
    // LA NUIT QUI CHASSE : c'est un ÉVÉNEMENT DU MONDE, il suit donc le même
    // interrupteur — un banc de test qui n'a pas demandé de guerre n'a pas non plus
    // demandé de loups.
    advanceNightHunt(state)
  }
  // LA MÉTÉO (spec meteo.md R10) : son interrupteur `meteoActive` est DÉDIÉ ET SÉPARÉ de
  // `worldEvents` — un banc peut mesurer l'économie sous la pluie sans convois ni hordes.
  // Élection au bord de cycle par hash2 (aucun tirage), bande purgée sitôt sortie.
  advanceMeteo(state)
  // LE VENT (spec `vent.md`) — juste après la météo, parce qu'il en est DÉRIVÉ : le front du
  // tick doit être connu. Et avant la faune, qui lit le cap pour l'odorat — l'ordre qu'avait
  // déjà l'ancien `advanceWind` en tête d'`advanceFauna`.
  advanceVent(state)
  // LA FOUDRE (spec meteo.md R8) : la résolution de l'impact élu — phase dédiée au même
  // endroit (`foudre.ts` : meteo.ts reste sans import de combat). Impacts par hash2,
  // zéro tirage ; l'abri supprime ou épargne, jamais de report.
  advanceFoudre(state)
  // LES VILLAGES PNJ VIVENT AUX BORDS DU CYCLE (spec village-pnj-evolution) : à
  // l'aube la porte s'ouvre, le palier monte au surplus, la prospérité attire un
  // colon ; au crépuscule la porte se ferme. Avant la passe PNJ : le village se
  // réveille, PUIS ses habitants agissent. Aucun tirage RNG (patron refugees).
  advanceVillageGrowth(state)
  advanceNpcs(state)
  advanceMonsters(state)
  // L'ENVOL DE LA LISIÈRE (forêts-vivantes §3) — après les bêtes : l'alarme qu'il pose se
  // lit au tick suivant, comme tout stimulus de méfiance.
  advanceEnvols(state)
  advanceCendreux(state)
  // LE SOL QUI TRAVAILLE rend son mort — ou le feu l'en empêche (R21). Juste après la levée
  // d'un cadavre : c'est le même geste, à deux échelles de temps, et les deux se laissent
  // annuler par la même garde de feu. Aucun tirage : le site et l'instant ont été décidés à
  // la plantation, donc allumer un feu ne décale pas le flux du PRNG.
  advanceReveils(state)
  advanceLieuxBrules(state)
  advanceCombat(state)
  advanceAlignment(state)
  // L'UPKEEP DU FEU (spec construction R16) : le Feu brûle son combustible, et à sec les
  // murs cèdent. Le seul évier permanent — après l'alignement (les raids ont pu casser),
  // avant l'avance du temps (l'acte de CE tick module la combustion).
  advanceUpkeep(state)
  // LE FEU LIBRE brûle son combustible (spec feu-station S2/S12) — jumeau de l'upkeep,
  // pour la structure feu hors village. À sec, il passe en braises puis s'éteint.
  advanceFire(state)
  // LA TORCHE brûle juste après le Feu : deux horloges de combustion, côte à côte, et la
  // seconde ne peut pas s'allumer sans la première (spec `torche.md`).
  advanceTorches(state)
  advanceTime(state)
  // LA CENDRE VIEILLIT — une fois par bascule de jour de saison, jamais au tick (spec `cendre.md`
  // R9/R16/R18). Elle ne mute aucune tuile : elle avance l'ÂGE de chaque foyer, et l'appartenance
  // d'une tuile s'en dérive par une comparaison. Un foyer dont la fosse brûle aujourd'hui ne
  // vieillit pas ; le caractère de la saison module ce que vaut un jour.
  if (jourDeSaison(state) !== jourDeSaison(state, state.tick - 1)) {
    const jour = jourDeSaison(state)
    const reveil = jourDuReveilDeLaCendre(state)
    if (jour > reveil) {
      const foyers = foyersDeLaCarte(state.map)
      const brulees = state.lieuxBrules
      const gelee = (zone: number): boolean =>
        brulees.some((lb) => lb.zone === zone && state.tick < lb.until)
      // ⚠ ON AVANCE DU NOMBRE DE JOURS FRANCHIS, PAS D'UN. Un tick n'enjambe qu'un jour en marche
      // normale — mais `debug_set_season_day` en saute des centaines, et un serveur qui rattrape
      // du retard peut en franchir plusieurs. Avancer de 1 rendait alors un âge de 1 au jour 240
      // (CONSTATÉ au navigateur : la cendre restait à sa tache initiale après un saut de saison),
      // c'est-à-dire un outil de debug qui MENT sur l'état du monde.
      //
      // La boucle est bornée : au-delà, la courbe est plate à l'échelle du jeu, et on ne veut pas
      // qu'un tick pathologique fasse tourner la sim sur des millions d'itérations.
      const depuis = state.cendreJour > reveil ? state.cendreJour : reveil
      const franchis = Math.min(400, Math.max(1, jour - depuis))
      for (let n = 0; n < franchis; n++) {
        avancerLaCendre(state.cendreAge, foyers, gelee, effetsDuJour(jour - n).cendre ?? 1)
      }
      state.cendreJour = jour
      // …ET CE QU'ELLE A TUÉ TOMBE (R13). L'arbre est resté debout et récoltable pendant son
      // agonie : ce n'est pas l'ancien front, qui effaçait au passage et sans préavis.
      const { restants, tombes } = tomberLesMortsDeLaCendre(
        state.nodes, state.map, state.cendreAge, state.seed, (t) => NODE_DEFS[t as NodeType]?.vivant === true,
      )
      if (tombes > 0) {
        state.nodes = restants
        emitEvent(state, { type: 'cendre_avance', tick: state.tick, jour, front: 0, noeudsBrules: tombes })
      }
      // LES FUMEROLLES S'OUVRENT — celles que le cœur de la corruption vient d'atteindre. Après
      // la chute des morts, et pas avant : une bouche sous un arbre attendait que l'arbre tombe.
      ouvrirLesFumerolles(
        state.nodes, state.map, avanceesDepuisAges(state.cendreAge, state.cendreAge.length),
        state.seed, FUMEROLLE.SEL_STOCK,
      )
    }
    // LE COIN VIVANT (faune R27) — à CHAQUE bascule de jour, front éveillé ou
    // pas : la cendre n'est qu'une des morts d'un coin, l'OCCUPATION (un bâti
    // dans le dernier massif-dortoir) n'attend pas le réveil de la Cendrière.
    entretienDesCoins(state)
  }
  advanceCraft(state)
  // LA DÉCOUVERTE (D2) après le craft : ce qu'on vient de fabriquer révèle la suite au
  // tick même, sans attendre le suivant.
  advanceDecouverte(state)
  advanceSpoilage(state)
  advanceEconomy(state)
  advanceCultures(state) // F5 — le gel tue le potager de plein air (spec flore-froid)
  advanceTemperature(state)
  // LE DÉGEL NE LAISSE PERSONNE EMMURÉ (spec `gel.md` G8bis). Juste APRÈS la température :
  // c'est elle qui vient de faire fondre la glace, on répare dans le même tick — jamais un
  // tick de jeu passé à l'intérieur d'une tuile non marchable. Inerte dans un monde qui ne
  // gèle pas (personne ne peut se tenir sur de l'eau profonde sans lui).
  advanceDegel(state)
  // LE CARNET DE L'ENCYCLOPÉDIE lit le buffer d'événements du tick : il doit passer APRÈS
  // tout ce qui émet (récolte, craft, repas, mise à mort) et avant que l'hôte ne draine.
  advanceEncyclopedie(state, eventsAuDepart)
  // En DERNIER : les invulnérables retrouvent leurs jauges pleines, quoi qu'il
  // se soit passé pendant le tick (faim, froid, saignement). No-op hors debug.
  refreshGodMode(state)
}

/** Snapshot canonique — sert d'égalité d'état dans les tests et le replay. */
export function snapshot(state: SimState): string {
  return JSON.stringify(state)
}
