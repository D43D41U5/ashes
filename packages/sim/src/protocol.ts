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
 * `prediction.ts`. Le serveur, qui ne dépend que de `@braises/sim`, le lit d'ici.
 */
import type { Corpse } from './combat'
import type { RecognizedFunction } from './construction'
import type { ResourceNode } from './economy'
import type { SimEvent } from './events'
import type { WorldMap } from './map'
import type { Monster } from './monsters'
import type { Npc } from './npc'
import type { Entity, PlayerAction } from './sim'
import type { GameTime } from './time'
import type { Structure, Village } from './village'

/** À incrémenter à tout changement incompatible — vérifié au `ready`. */
export const PROTOCOL_VERSION = 1

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
  playerSpawn: { x: number; y: number }
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

/** Changement de stock d'un nœud (récolte/repousse) — seul état de nœud mutable. */
export interface NodeDelta {
  id: number
  stock: number
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
  npcs: Npc[]
  monsters: Monster[]
  corpses: Corpse[]
  /** LE SANG AU SOL (spec chasse C9) : les gouttes que le client dessine et efface. */
  blood: { x: number; y: number; tick: number }[]
  /** LE VENT (C17) : il doit SE VOIR — une règle invisible est une injustice. */
  wind: { x: number; y: number }
  /** LES PILES AU SOL (C18) : l'appât posé, la viande jetée, la charge larguée. */
  groundItems: { id: number; x: number; y: number; item: string; count: number; expiresAt: number }[]
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

export type HostToClient = ReadyMessage | SnapshotMessage | ProgressMessage | ChatBroadcast
