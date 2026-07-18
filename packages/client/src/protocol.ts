/**
 * Protocole client ⇄ hôte de simulation (spec client R1-R3).
 *
 * L'hôte est aujourd'hui un Web Worker (mode Veillée) et demain un serveur
 * (Phase LAN) : ces messages sont la répétition générale du réseau. On ne
 * transmet jamais de position côté client, seulement des intentions.
 */
import type {
  Corpse,
  Entity,
  GameTime,
  Monster,
  Npc,
  PlayerAction,
  RecognizedFunction,
  ResourceNode,
  SimEvent,
  Structure,
  Village,
  WorldMap,
} from '@braises/sim'

/** À incrémenter à tout changement incompatible — vérifié au `ready`. */
export const PROTOCOL_VERSION = 1

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

export type ClientToHost = JoinMessage | InputMessage | ActionMessage | PauseMessage | ResumeMessage | DebugSpeedMessage

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

export type HostToClient = ReadyMessage | SnapshotMessage | ProgressMessage
