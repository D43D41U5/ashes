import type { NodeType } from './balance'
/**
 * Protocole client ⇄ hôte de simulation (spec client R1-R3).
 *
 * L'hôte est aujourd'hui un Web Worker (mode Veillée) et demain un serveur
 * (Phase LAN) : ces messages sont la répétition générale du réseau. On ne
 * transmet jamais de position côté client, seulement des intentions.
 *
 * Il vit dans `/sim` — et non plus dans le client — parce qu'il est le contrat
 * PARTAGÉ entre n'importe quel hôte (Worker, serveur Colyseus) et n'importe quel
 * client : pur (rien que des types + une constante), au même titre que le netcode
 * `prediction.ts`. Le serveur, qui ne dépend que de `@ashes/sim`, le lit d'ici.
 */
import type { Corpse } from './combat'
import type { RecognizedFunction } from './construction'
import type { ResourceNode } from './economy'
import type { SimEvent } from './events'
import type { ChronicleVolume } from './chronicle'
import type { WorldMap } from './map'
import type { Monster } from './monsters'
import type { Reveil } from './morts'
import type { Npc } from './npc'
import type { Entity, PlayerAction } from './sim'
import type { GameTime } from './time'
import type { Structure, Village } from './village'

/** À incrémenter à tout changement incompatible — vérifié au `ready`. */
// v3 : les actions de station `cook_put`/`cook_take` (slot de cuisson, spec feu-station).
// v4 : cuisson 3 entrées / 3 sorties (`cook_take_in`/`cook_take_out`) + combustible en 3 slots.
// v5 : les cases du feu (combustible/entrées/sorties) deviennent de vrais conteneurs — `cook_put`/
//      `cook_take_*` retirées, tout passe par `transfer` + `zone` ; entrées en STACKS (verrou de conso).
export const PROTOCOL_VERSION = 5

/**
 * LE CHAT DE PROXIMITÉ — un rayon d'audition, en tuiles. Le serveur ne relaie un
 * message qu'aux joueurs à moins de ça de l'émetteur : on s'entend de près, pas
 * d'un bout à l'autre de la vallée. Ce n'est PAS un nombre de /sim (le chat ne
 * touche pas la simulation déterministe) — il vit ici, dans le protocole partagé.
 */
export const CHAT_RADIUS_TILES = 14
/** Longueur max d'un message (le serveur tronque, le client borne la saisie). */
export const CHAT_MAX_LEN = 200

/**
 * Le client demande à REJOINDRE — il ne choisit ni la seed, ni la carte, ni
 * le rythme : ce sont des décisions d'hôte (scénario côté Worker aujourd'hui,
 * serveur en LAN). Il reçoit tout ça dans `ready`.
 */
export interface JoinMessage {
  type: 'join'
  protocolVersion: number
}

export interface InputMessage {
  type: 'input'
  /** Numéro croissant : l'hôte l'acquitte, le client rejoue les non-acquittés (spec reconciliation R1). */
  seq: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint: boolean
  /** Le PAS LENT (spec chasse C2) : la sim en dérive `Entity.gait` — le bruit. */
  sneak: boolean
  block: boolean
}

/** Une action ponctuelle (construire, fonder…) — appliquée au prochain tick. */
export interface ActionMessage {
  type: 'action'
  action: PlayerAction
}

/**
 * Pause/reprise de l'hôte — SOLO uniquement (onglet caché : le rAF du rendu
 * est suspendu mais pas le timer du Worker ; sans pause, l'avatar répéterait
 * son dernier input sans pilote). Un serveur LAN ignorera ces messages :
 * le monde des autres ne s'arrête pas.
 */
export interface PauseMessage {
  type: 'pause'
}
export interface ResumeMessage {
  type: 'resume'
}

/**
 * DEV : change la CADENCE de l'hôte (×1 par défaut). C'est une affaire d'hôte,
 * pas de simulation — le tick reste fixe, on en joue seulement plus par seconde.
 * Les autres leviers de debug (TP, heure, invulnérabilité) passent, eux, par
 * `action` : ce sont des mutations d'état, donc elles appartiennent à /sim.
 * Un serveur de production ignorera ce message.
 */
export interface DebugSpeedMessage {
  type: 'debug_speed'
  /** Multiplicateur de ticks par seconde (1 = temps normal). */
  factor: number
}

/**
 * LE CHAT DE PROXIMITÉ (montant) : le joueur PARLE. L'hôte le relaie aux joueurs
 * proches (rayon `CHAT_RADIUS_TILES`), jamais à la vallée entière. Le chat ne passe
 * PAS par /sim : il ne mute pas l'état déterministe, l'hôte le route à part.
 */
export interface ChatMessage {
  type: 'chat'
  text: string
}

export type ClientToHost =
  | JoinMessage
  | InputMessage
  | ActionMessage
  | ChatMessage
  | PauseMessage
  | ResumeMessage
  | DebugSpeedMessage

export interface ReadyMessage {
  type: 'ready'
  protocolVersion: number
  playerId: number
  map: WorldMap
  seed: number
  /** Liste COMPLÈTE des nœuds, envoyée UNE fois (comme la carte). Le jeu de
   * nœuds est stable au runtime ; le snapshot ne transporte ensuite que les
   * changements de stock (`nodeDeltas`) — découple le nombre de nœuds du coût
   * par tick, condition des forêts denses. */
  nodes: ResourceNode[]
  /**
   * LES COINS DE CHASSE (spec faune R17) — les lieux fixes où le gibier vit.
   * Envoyés UNE fois, comme la carte et les nœuds : c'est une donnée de MONDE,
   * pas d'état. (Le client connaît déjà chaque buisson de baies de la vallée ;
   * le modèle de confiance ne change pas.)
   */
  grounds: { x: number; y: number }[]
  calendarScale: number
  /** Le jour de saison où le monde a ouvert (spec `saisons.md` S2). Le client en a besoin
   *  pour DATER : sans lui, son gel, sa neige et sa défeuillaison lisent le mauvais jour. */
  jourDeDepart: number
  playerSpawn: { x: number; y: number }
  /**
   * LA CHRONIQUE REPRISE (persistance Veillée, P1-6) — présente UNIQUEMENT quand l'hôte
   * relit une sauvegarde : le log borné des faits chronique-dignes déjà survenus, pour que
   * le client réamorce son `eventLog` d'affichage et retrouve le récit de la saison. Absente
   * sur un monde tout neuf (le récit se construit alors au fil de l'eau, depuis « Acte I »).
   */
  chronicle?: SimEvent[]
  /**
   * LES ANNÉES RÉVOLUES, SCELLÉES (saison-sans-fin T5) : un volume de chronique formatée par
   * an, relisible à jamais. `chronicle` ne porte que l'année courante, brute. Absent sur un
   * monde neuf, et sur une reprise qui n'a pas encore passé un tour de l'année.
   */
  volumes?: ChronicleVolume[]
  /**
   * QUAND CE MONDE EST NÉ — horloge murale de l'hôte à la fondation, stable pour toute la vie
   * de la vallée (relue du disque à chaque reprise). Avec la seed, elle NOMME le monde : deux
   * vallées de même seed fondées à deux instants sont deux vallées.
   *
   * Le client s'en sert pour son brouillard de guerre, qui vit hors de la sauvegarde de sim et
   * n'avait, jusqu'au 2026-07-30, aucun moyen de savoir de quel monde il était (voir
   * `render/fog.ts`). Aucune règle de jeu n'en dépend.
   *
   * OPTIONNELLE, et elle N'INCRÉMENTE PAS `PROTOCOL_VERSION` — même raison que `ProgressMessage`
   * ci-dessous : elle est additive. Un hôte qui ne l'envoie pas (un serveur, où la Veillée n'a
   * pas de sens) reste jouable ; le client ouvre alors une carte vierge plutôt que d'en croire
   * une qu'il ne peut pas rattacher.
   */
  createdAt?: number
}

/**
 * L'hôte BÂTIT le monde (plusieurs secondes) et dit où il en est : une passe
 * vient de commencer. Purement informatif — l'écran de chargement du client en
 * fait sa barre, aucune décision de jeu n'en dépend, et un hôte qui n'en enverrait
 * aucun resterait jouable (la barre attendrait simplement le `ready`). C'est
 * pourquoi ce message N'INCRÉMENTE PAS `PROTOCOL_VERSION` : il est additif.
 */
export interface ProgressMessage {
  type: 'progress'
  /** Identifiant STABLE de la passe qui commence (`hydrology`, `nodes`…). L'écran de
   *  chargement ne l'AFFICHE pas — il raconte autre chose (voir ui/loading.ts) : c'est
   *  le rapport honnête de l'hôte, que lisent le smoke test et le debug. */
  phase: string
  /** Passes ACHEVÉES sur le total : `done / total` est la barre, telle quelle. */
  done: number
  total: number
}

/**
 * Changement d'état d'un nœud transmis par tick. Le STOCK est le cas courant (récolte,
 * repousse). La POSITION (`tx/ty`) n'accompagne le delta QUE lorsqu'un nœud de bois/plante
 * a DÉRIVÉ (spec recolte-vivante D1) — ce qui coïncide toujours avec `stock → 0`. Absente
 * le reste du temps : le nœud n'a pas bougé. Le client, en recevant `tx/ty`, déménage le
 * sprite de cet id (souche à l'ancien coin, pousse au nouveau). Serveur autoritatif : la
 * position vient de la sim, le client ne la recalcule pas (invariant §3).
 */
export interface NodeDelta {
  id: number
  stock: number
  tx?: number
  ty?: number
  /** Tick de repousse à plein — joint UNIQUEMENT quand `stock` tombe à 0, pour que le
   *  client anime la repousse (la pousse grandit, le minéral se reforme) sur `[tick, regrowAt]`
   *  au lieu de « popper ». Absent sinon : un delta de stock ordinaire ne le porte pas. */
  regrowAt?: number
  /**
   * LE TYPE — joint UNIQUEMENT quand le nœud est NEUF pour le client (une fumerolle qui s'ouvre,
   * un filon que la Brume découvre).
   *
   * ⚠ SANS LUI, UN NŒUD NÉ EN COURS DE PARTIE N'EXISTAIT PAS POUR LE JOUEUR : `applyDeltas` jette
   * tout id inconnu (`if (!n) continue`), et la liste complète ne part qu'UNE fois, au message
   * `ready`. Le filon de la Brume portait ce défaut depuis sa naissance — il se posait dans la sim
   * et personne ne pouvait le voir ni le miner. Constaté au navigateur en ouvrant les fumerolles.
   */
  neuf?: NodeType
}

export interface SnapshotMessage {
  type: 'snapshot'
  tick: number
  /** `seq` du dernier input du joueur appliqué à ce tick — ancre de réconciliation (spec R2). */
  lastProcessedInput: number
  time: GameTime
  entities: Entity[]
  structures: Structure[]
  villages: Village[]
  /** LES FONCTIONS ÉMERGENTES reconnues (spec construction R9-R22) : l'overlay les
   *  affiche (« Forge · N2 »). Dérivé PUR des structures — le client ne les recalcule
   *  pas, il les lit (et les PRÉDIT pour le fantôme, R22). */
  functions: RecognizedFunction[]
  nodeDeltas: NodeDelta[]
  /**
   * L'ÂGE DE CHAQUE FOYER DE CENDRE, en jours (spec `cendre.md`). **Dix nombres, et c'est tout ce
   * que la cendre coûte au réseau** : le client en dérive la frange entière en relisant
   * `estCendre` sur le champ statique qu'il a reçu avec la carte. Ni tuile, ni masque, ni delta —
   * le patron du gel et du niveau d'eau, poussé à son terme.
   */
  cendreAge: number[]
  npcs: Npc[]
  monsters: Monster[]
  corpses: Corpse[]
  /** LES SOLS QUI TRAVAILLENT (spec `cendreux.md` R21) : le client peint le sol qui se
   *  soulève, et son extinction sans `cendreux_risen` DIT que le feu a gagné. Quatre nombres
   *  par entrée, une poignée d'entrées à la fois — le plafond de l'acte les borne. */
  reveils: Reveil[]
  /** LE SANG AU SOL (spec chasse C9) : les gouttes que le client dessine et efface. */
  blood: { x: number; y: number; tick: number }[]
  /** LE CAP DU VENT (C17, `vent.md`) : il doit SE VOIR — une règle invisible est une injustice.
   *  Le client le LIT, il ne le recompose jamais de `front.edge` (écrivain unique, A8). */
  wind: { x: number; y: number }
  /** LA FORCE DU VENT au centre de la carte (`vent.md` V3), de `VENT.AMBIANT` à 1 — 0 sous la
   *  sentinelle du calme plat. Le client ne l'invente plus (il l'inventait : `vent-lisse.ts`).
   *  La force LOCALE se recalcule de la fonction pure partagée `ventForceAt`. */
  windForce: number
  /** LES PILES AU SOL (C18) : l'appât posé, la viande jetée, la charge larguée. */
  groundItems: { id: number; x: number; y: number; item: string; count: number; expiresAt: number }[]
  /**
   * LE FRONT MÉTÉO EN COURS (spec `meteo.md` — « le contrat sim est prêt : `state.meteo`
   * dans le snapshot »), ou `null`. CINQ champs plats, une fois par snapshot : c'est le
   * RECORD D'ÉLECTION, jamais la géométrie.
   *
   * Tout le reste, le client le RECALCULE des fonctions pures partagées, du tick :
   * la bande (`frontMeteoPos`), le gradient bord → cœur (`meteoIntensityAt`), le malus de
   * pas de sa prédiction locale (`meteoSpeedFactor`), et jusqu'aux impacts de foudre
   * (`foudreTelegrapheAt`/`foudreImpactAt`) — pas un octet de géométrie ne transite, pas
   * une position d'éclair. Ce que le snapshot porte, c'est ce que le client ne peut PAS
   * dériver : quel front l'autorité a élu. Sans lui, la pluie dessinée ne serait pas la
   * pluie simulée — et un ciel qui ment sur le froid qu'il apporte est pire qu'un ciel vide.
   */
  meteo: import('./meteo').MeteoFront | null
  /**
   * LA NAPPE DE BRUME (spec `brume.md`), ou rien — le record, patron `meteo` : la géométrie
   * se recalcule (`brumeCentre`, `dansLaBrume`). OPTIONNEL, donc ADDITIF (le précédent
   * `createdAt?` fait loi : pas de bump de `PROTOCOL_VERSION`). Sans elle, la température
   * que le client relisait était trop CHAUDE de `BRUME.COLD_MALUS` sous la nappe, et le
   * rendu pouvait MANQUER une glace que la sim avait posée — un manquement à G5 documenté
   * dans `etat-gel.ts`, soldé par ce champ.
   */
  brume?: import('./brume').Brume | null
  events: SimEvent[]
}

/**
 * LE CHAT DE PROXIMITÉ ENTENDU (descendant, multi) — avec la POSITION de l'émetteur.
 * L'hôte le diffuse à tous les joueurs ; le FILTRAGE par distance se fait CÔTÉ CLIENT
 * (chacun compare sa position à `x,y`). Il transite sur son PROPRE canal réseau
 * (`chatmsg`, en tableau `[from, x, y, text]`) et non dans le snapshot : le chat est
 * filtré par destinataire (proximité) et ne fait pas partie de l'état déterministe —
 * un canal à part le garde hors du corps de snapshot partagé par tous.
 */
export interface ChatBroadcast {
  type: 'chat'
  from: number
  x: number
  y: number
  text: string
}

/**
 * L'HÔTE A ÉCRIT LA PARTIE — ou n'a PAS PU. Purement informatif, aucun effet sur la sim.
 *
 * Le joueur doit SAVOIR que sa progression est à l'abri : dans un jeu de survie où une
 * heure de veillée peut disparaître, une sauvegarde muette est une source d'angoisse. Et
 * surtout il doit savoir quand elle ne l'est PAS — un échec silencieux (disque plein,
 * stockage refusé) est bien pire que pas d'indicateur du tout : il laisse croire au salut.
 *
 * `at` est une horloge MURALE, donc un concern d'HÔTE : /sim ne la produit jamais (elle
 * n'entre pas dans l'état déterministe, elle ne fait que traverser ce canal).
 */
export interface SavedMessage {
  type: 'saved'
  at: number
  ok: boolean
}

/**
 * CE QUE COÛTE L'HÔTE, MESURÉ SUR SON PROPRE MOTEUR — sonde de DEV, jamais émise en prod.
 *
 * Tout ce que le projet sait de son coût par tick a été mesuré sur Node (et sous `tsx`, qui
 * ment de ~25 %). Or la Veillée ne tourne PAS sur Node : elle tourne dans un Web Worker de
 * navigateur, et ce moteur-là n'a jamais eu un seul chiffre. C'est le seul qui décide de ce
 * qu'Alexis ressent manette en main — donc le seul sur lequel on ait le droit de dire
 * « MESURÉ » à propos d'un gel.
 *
 * Ce canal ne porte AUCUN état de jeu : rien ici n'entre dans la sim, rien n'en sort. Les
 * durées sont des horloges MURALES, donc un concern d'HÔTE exclusivement (interdit à /sim).
 *
 * On envoie le PIC autant que la moyenne : une moyenne noie exactement ce qu'on cherche.
 * Un tick à 1 s tous les six cents ne déplace pas une moyenne — il arrête le monde.
 */
export interface PerfMessage {
  type: 'perf'
  /** Ticks joués dans la fenêtre relevée. */
  ticks: number
  /** Coût MOYEN d'un tick d'hôte sur la fenêtre (step + snapshot + envoi), en ms. */
  moyenneMs: number
  /** Le tick le PLUS CHER de la fenêtre — c'est lui qu'on sent. */
  picMs: number
  /** Part de `step()` (donc de /sim) dans ce pic : sépare la faute de la sim de celle de l'hôte. */
  picStepMs: number
  /** Numéro du tick du pic — un repère pour savoir QUEL moment de jeu coûte. */
  picTick: number
  /**
   * LE PLUS GRAND TROU ENTRE DEUX DÉBUTS DE TICK, en ms — et c'est LA mesure du gel.
   *
   * Le coût d'un tick ne dit pas tout : ce qui arrête le monde peut tourber HORS du tick
   * (l'autosave est appelée par son propre minuteur, une GC tombe où elle veut). Un tick à
   * 20 Hz doit repartir toutes les 50 ms ; l'écart réel entre deux départs mesure donc tout
   * ce qui a occupé le Worker, d'où que ça vienne. C'est le seul chiffre qui corresponde à
   * ce que le joueur voit : les PNJ, les bêtes et l'horloge du monde s'arrêtent puis sautent.
   */
  picEcartMs: number
  /** Dernière sérialisation d'autosave : le temps pendant lequel le Worker n'a PAS tiqué. −1 si aucune. */
  serialisationMs: number
  /** Poids de la dernière sauvegarde, en octets. −1 si aucune. */
  sauvegardeOctets: number
}

export type HostToClient =
  | ReadyMessage
  | SnapshotMessage
  | ProgressMessage
  | ChatBroadcast
  | SavedMessage
  | PerfMessage
