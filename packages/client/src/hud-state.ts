/**
 * Le contrat typé du registry Phaser entre WorldScene (écrivain) et UIScene
 * (lecteur). Le registry de Phaser est stringly-typed (`get` renvoie `any`) :
 * on le canalise ici par une interface exhaustive + deux helpers, pour que
 * toute clé et tout type soient vérifiés à la compilation. Les scènes ne
 * doivent JAMAIS appeler `registry.set/get` directement — uniquement
 * `setHud`/`getHud`.
 */
import type { CraftOrder, Entity, GameTime, Inventory, ItemId, PlayerAction, SkillId, Village, VillageTask, WorldMap } from '@braises/sim'
import type Phaser from 'phaser'

/** Ce que le joueur peut sélectionner pour bâtir. */
export type Buildable = 'wall' | 'door' | 'chest' | 'workshop' | 'furnace'

/** Les stations d'artisanat (les recettes `station: null` n'en demandent aucune). */
export type StationId = 'fire' | 'workshop' | 'furnace'

/** Le conteneur ouvert, RÉSOLU depuis le snapshot (WorldScene) pour que UIScene
 *  n'ait pas à fouiller structures/cadavres. `null` dès qu'il disparaît (dépouille
 *  vidée → effacée) : c'est le signal qui referme proprement le panneau de loot. */
export interface OpenContainerView {
  kind: 'structure' | 'corpse'
  id: number
  inv: Inventory
  title: string
}

/** Une propriété par clé du registry — la seule source de vérité des clés. */
export interface HudState {
  /** La vallée est-elle générée ? Posé à `false` au boot de WorldScene, à `true`
   *  quand l'hôte a livré son `ready` (carte, spawn, calendrier) et que les couches
   *  de rendu sont montées. C'est le drapeau qui garde le HUD : tant qu'il est faux,
   *  UIScene ne montre QUE son écran de chargement. */
  worldReady: boolean
  /** Où en est la naissance du monde — `done` passes achevées sur `total`, et le nom
   *  de celle qui commence. `done/total` EST la barre de l'écran de chargement (on ne
   *  la brode pas) ; `phase`, elle, ne s'affiche jamais — l'écran raconte autre chose
   *  (ui/loading.ts). Absent tant que l'hôte n'a rien dit. */
  loadProgress: { phase: string; done: number; total: number }
  /** Heure de jeu du dernier snapshot. */
  time: GameTime
  /** Nom de la zone où se trouve l'avatar (undefined hors zone nommée). */
  zone: string | undefined
  /** Nombre de membres de mon village (0 = pas de village). */
  village: number
  /** Tableau des tâches de mon village. */
  tasks: VillageTask[]
  /** Archétype de mon village (null = pas de village). */
  archetype: Village['archetype'] | null
  /** Chaleur du Feu de mon village. */
  villageWarmth: number
  inv: Inventory
  /** Case tenue en main (`-1` = mains nues) — surligne la ceinture (spec inventaire R8). */
  activeSlot: number
  /** LA FILE DE CRAFT de mon avatar (spec craft-file F15-F16). Elle vient du
   *  snapshot, TELLE QUELLE : le client n'a aucun décompte local — un timer client
   *  divergerait de la sim, et c'est exactement ce que la file dans `SimState`
   *  est là pour empêcher. */
  craftQueue: CraftOrder[]
  /** Les stations à portée d'interaction. MIROIR du client (comme le surlignage de
   *  visée) : il grise les recettes qu'on ne peut pas lancer ici. La sim reste seule
   *  juge — si elle refuse malgré le miroir, c'est elle qui a raison. */
  stationsInRange: StationId[]
  hunger: number
  /** Température du corps de l'avatar (0-100 ; sous 20, le froid mord). */
  temperature: number
  skills: Partial<Record<SkillId, number>>
  hp: number
  stamina: number
  wounds: Entity['wounds']
  /** Structure armée pour le mode construction — `null` = DÉSARMÉ, et c'est
   *  l'état de départ : le clic nu ne bâtit jamais (spec recolte.md G1-G2). */
  selected: Buildable | null
  /** L'écran d'inventaire (TAB) est-il ouvert ? (l'UI arrive au chantier 7). */
  inventoryOpen: boolean
  /** LE CHAMP DE RECHERCHE DU CRAFT A LE CLAVIER. Tant qu'il l'a, plus une touche
   *  ne part au jeu : taper « hache » ferait sinon MARCHER le personnage (Z, Q, S,
   *  D sont des lettres) et « journal » ouvrirait le journal. Un champ de saisie
   *  qui ne prend pas le clavier n'est pas un champ de saisie. */
  uiTyping: boolean
  /** Le conteneur ouvert à côté du sac (coffre/cadavre), ou null. Posé par
   *  input-bindings à l'ouverture de TAB (le plus proche à portée). */
  openContainer: { kind: 'structure' | 'corpse'; id: number } | null
  /** Son contenu, résolu chaque snapshot par WorldScene (null s'il a disparu). */
  openContainerView: OpenContainerView | null
  /** File des récoltes reçues de la sim (WorldScene POSE, UIScene draine) : les
   *  toasts « +2 BOIS (14) ». Une file, pas une valeur — deux récoltes peuvent
   *  tomber dans le même snapshot. */
  pickups: { item: ItemId; count: number }[]
  /** File d'actions posées par UIScene (l'écran d'inventaire) — WorldScene la
   *  draine et parle seule à l'hôte (l'UI ne connaît pas le transport). */
  pendingActions: PlayerAction[]
  /** Journal (J) ouvert à la demande. */
  journalOpen: boolean
  /** Carte plein écran (M) ouverte à la demande. */
  mapOpen: boolean
  /** La carte du monde, publiée une fois au `ready` — sert au rendu de la carte
   * plein écran et au lookup de zone/POI sous le curseur (`zoneAt`). */
  mapData: WorldMap
  /** Les lieux que MON joueur connaît (spec lieux R1) — index dans `mapData.zones`.
   *  La carte plein écran ne montre que ceux-là : le terrain est offert, les lieux se gagnent. */
  knownPois: number[]
  /** Position LOGIQUE de l'avatar (tuiles) — le marqueur « tu es ici » de la carte. */
  playerPos: { x: number; y: number }
  /** La chronique de la saison, déjà mise en forme. */
  chronicle: string[]
  /** Dernier message d'erreur à afficher (action rejetée, avertissement…). Il s'efface
   *  tout seul au bout de quelques secondes : c'est du bruit de partie. */
  error: { reason: string; at: number }
  /** LA RUPTURE : l'hôte est mort (exception du Worker, transport rompu, protocole
   *  désaccordé). Plus aucun snapshot n'arrivera — ce message-là ne s'efface JAMAIS et
   *  ouvre l'écran de rupture (ui/fatal.ts), avec son bouton de rechargement. */
  fatal: { reason: string }
  /** Dernière alarme de mon village (flash rouge). */
  alarm: { at: number }
  seasonEnded: boolean

  // ─── Mode debug (DEV uniquement — voir scenes/world/debug-bindings.ts) ───
  /** F1 : le mode debug est-il armé ? (rien d'autre ne s'affiche ni ne répond sans lui) */
  debugOn: boolean
  /** État courant des leviers, pour l'affichage (l'autorité, elle, est dans /sim). */
  debugGod: boolean
  debugSpeed: number
  /** Ce que l'overlay affiche — publié par WorldScene, seule à connaître le relief. */
  debugInfo: {
    tick: number
    fps: number
    /** Tuile sous le curseur (après correction du relief) et ce qu'on y trouve. */
    hover: { tx: number; ty: number; terrain: string; elevation: number; zone: string } | null
  }
  /** Demande de TP posée par UIScene (clic sur la carte) — consommée par WorldScene. */
  debugTeleport: { x: number; y: number; at: number }
}

type Registry = Phaser.Data.DataManager

export function setHud<K extends keyof HudState>(registry: Registry, key: K, value: HudState[K]): void {
  registry.set(key, value)
}

/** `undefined` tant que WorldScene n'a pas encore écrit la clé. */
export function getHud<K extends keyof HudState>(registry: Registry, key: K): HudState[K] | undefined {
  // Seule coercition autorisée sur le registry : le point de passage typé.
  return registry.get(key) as HudState[K] | undefined
}
