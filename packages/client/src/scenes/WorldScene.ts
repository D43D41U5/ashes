/**
 * La scène de jeu : du CÂBLAGE. Le rendu du snapshot vit dans
 * `world/snapshot-view.ts`, les bindings dans `world/input-bindings.ts`, la
 * publication HUD dans `world/hud-bridge.ts` — ici restent la caméra, la
 * prédiction locale et la frontière de transport.
 *
 * Le client est « bête » (spec client R3-R5, reconciliation R1-R7) : la sim
 * tourne dans le Worker, ici on envoie des intentions numérotées et on interpole
 * des snapshots. La prédiction locale de son propre avatar et la réconciliation
 * par rejeu vivent dans `/sim` (`prediction.ts`, pur et testé) — on ne fait ici
 * que câbler l'I/O réseau et le rendu.
 */
import {
  TEMPERATURE,
  createPrediction,
  decayRenderOffset,
  hash2,
  predictFrame,
  reconcile as reconcilePrediction,
  renderPosition,
  pendingStrike,
  speedScaleFor,
  weaponKind,
  weaponProfile,
  zoneAt,
  type Entity,
  type GameTime,
  type PlayerAction,
  type PredictInput,
  type PredictionState,
  type ResourceNode,
  type SimEvent,
  type Strike,
  type WeaponKind,
  type WorldMap,
  avanceeDuFront,
} from '@braises/sim'
import Phaser from 'phaser'
import { createWorkerHost, type HostConnection } from '../host-connection'
import { getHud, setHud } from '../hud-state'
import { PROTOCOL_VERSION, type ClientToHost, type HostToClient, type ReadyMessage, type SnapshotMessage } from '../protocol'
import {
  AMBIENT_DEPTH,
  lookaheadOffset,
  OVERLAY_DEPTH,
  RELIEF_H,
  TILE_PX,
  zoomForFraming,
} from '../render/framing'
import { ambientTint, daylight } from '../render/lighting'
import { assertNoFold, createWarp, type Warp } from '../render/warp'
import {
  drainQueuedActions,
  publishAlarm,
  publishChronicle,
  publishError,
  publishOpenContainer,
  publishPickup,
  publishPlayerVitals,
  publishSeasonEnded,
  publishStationsInRange,
  publishTimeAndVillage,
} from './world/hud-bridge'
import { ClutterLayer } from './world/clutter-layer'
import { GroundLayer } from './world/ground-layer'
import { CendreLayer } from './world/cendre-layer'
import { ShadeLayer } from './world/shade-layer'
import { PoiLayer } from './world/poi-layer'
import { ShoreCliff } from './world/shore-cliff'
import { FireGlow } from './world/fire-glow'
import { WaterLayer } from './world/water-layer'
import { AmbientLife } from './world/ambient-life'
import { bindDebugKeys } from './world/debug-bindings'
import { syncDebug } from './world/debug-overlay'
import { BuildGhost } from './world/build-ghost'
import { HitFx } from './world/hit-fx'
import { createAttackFx, type AttackFx, type Zone } from './world/attack-fx'
import { createHandWeapons, type HandWeapons } from './world/hand-weapon'
import { bindInputs, type MovementBindings } from './world/input-bindings'
import { SnapshotView, type InterpolatedSprite } from './world/snapshot-view'

/** Cadrage caméra (spec client R10) : « je veux voir ~N tuiles de haut ». */
const VISIBLE_TILES_TALL = 20

/**
 * LA ZONE DE LA SIM, EN PIXELS. La SEULE traduction que le client s'autorise sur le
 * combat : des tuiles vers des pixels. Pas un ajustement, pas un arrondi « qui rend
 * mieux » — la forme dessinée au sol EST la forme frappée. Un télégraphe qui
 * s'arrangerait avec la géométrie apprendrait au joueur une règle qui n'existe pas,
 * et c'est exactement la faute que le dernier passage sur le combat a dû jeter.
 */
const zoneOf = (strike: Strike): Zone => ({
  shape: strike.shape,
  range: strike.range * TILE_PX,
  arcCos: strike.arcCos,
  radius: strike.radius * TILE_PX,
})
/** Caméra « Foxhole » (R11) : force du décalage vers le curseur (px écran → px monde). */
const LOOKAHEAD_STRENGTH = 0.18
/** Borne radiale du décalage caméra, en tuiles. */
const LOOKAHEAD_MAX_TILES = 6
/** Écart prédiction/autorité au-delà duquel on snap (spec client R5). */
const SNAP_DISTANCE_TILES = 1.5
/** Décroissance par frame de l'écart visuel après une correction (lissage de rendu, spec R6). */
const RENDER_OFFSET_DECAY = 0.85
/**
 * Borne du journal d'événements de chronique gardé en mémoire (les plus
 * récents gagnent). Compromis assumé : la chronique d'une Veillée reste
 * courte (quelques dizaines d'événements filtrés sur 60 jours), donc 500
 * suffit largement et évite au log de croître sans borne — et à
 * `chronicleFromEvents` de reparcourir un log arbitrairement long à chaque
 * événement. Le vrai fix (chronique incrémentale) viendra avec la
 * persistance.
 */
const EVENT_LOG_CAP = 500

/**
 * Nos étapes de montage du monde, dans l'ordre (voir `onReady`) — la barre de chargement
 * les compte après les passes de l'hôte. La liste est la SEULE source de vérité : `onReady`
 * doit fournir une fonction pour chacune (c'est un `Record` typé, donc le compilateur refuse
 * d'en oublier une ou d'en inventer une), et le total de la barre s'en déduit.
 */
const BUILD_PHASES = ['relief', 'bake', 'ground', 'water', 'pois', 'clutter', 'world'] as const
type BuildPhase = (typeof BUILD_PHASES)[number]
const BUILD_STEPS = BUILD_PHASES.length


/** Les événements retenus pour la chronique de saison. */
const CHRONICLE_TYPES = new Set([
  'village_founded',
  'act_started',
  'village_archetype_changed',
  'horde_spawned',
  'convoy_spawned',
  'gift_given',
  'entity_died',
  'evacuation_opened',
  'season_ended',
])

const TERRAIN_COLORS: Record<number, number> = {
  // (les couleurs sont des placeholders R8, remplacées par de vrais tilesets en V3+)
  0: 0x101014, // void
  1: 0x3e7d3a, // herbe
  2: 0xb2996a, // route
  3: 0x2c5a2e, // forêt
  4: 0x4a7fa8, // eau peu profonde
  5: 0x6d6d70, // roche
  6: 0x274a6d, // eau profonde
  7: 0x4a4038, // mur
  8: 0x556b4a, // marais
  // Biomes alpins (SP3) — portés depuis BIOME_RGB (sim/vignette.ts) en 0xRRGGBB.
  9: 0x96928a, // éboulis (scree)
  10: 0xeef2f8, // neige (snow)
  11: 0x8a7078, // lande (heath)
  12: 0xb2c278, // alpage (alpine_meadow)
  13: 0x507438, // forêt claire de pins (pine)
  14: 0x9c964e, // mélèzes (larch)
  15: 0xcee2ee, // glacier
  16: 0x7c7468, // chaos de blocs (boulders)
  17: 0x9cb25c, // pré fleuri (flower_meadow)
  18: 0x484c3a, // tourbière (peat_bog)
  19: 0x707a50, // roselière (reed_marsh)
  20: 0xbebe94, // alpage fleuri (alpine_flowers)
  21: 0x4a3e38, // forêt brûlée (burnt_forest)
  22: 0x1c3a28, // vieille forêt (old_growth)
  /**
   * LA FALAISE — et elle doit se lire comme un MUR, pas comme un caillou.
   *
   * Elle est le squelette de la carte : c'est en la LONGEANT qu'on trouve les portes (« on ne
   * trouve pas une porte, on suit un mur »). Il lui faut donc l'arête la plus franche de toute la
   * palette : presque noire, très froide, sans le moindre parent visuel dans la roche (0x6d6d70)
   * ni le mur (0x4a4038). À l'écran, on ne doit pas pouvoir hésiter une seconde.
   */
  23: 0x22242c, // falaise (cliff)
}

/** Assombrit/éclaircit légèrement une couleur (variation par tuile). */
function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor))
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor))
  const b = Math.min(255, Math.floor((color & 0xff) * factor))
  return (r << 16) | (g << 8) | b
}

export class WorldScene extends Phaser.Scene {
  /** La frontière de transport (Worker aujourd'hui, Colyseus en LAN). */
  private host!: HostConnection
  private map!: WorldMap
  private ambientRect: Phaser.GameObjects.Rectangle | null = null
  private fireGlow: FireGlow | null = null
  private water: WaterLayer | null = null
  /** Oiseaux et lucioles — décor pur, hors sim (voir world/ambient-life.ts). */
  ambientLife: AmbientLife | null = null
  private lastTime: GameTime | null = null
  /** Couvert de canopée lissé autour de l'avatar — piloté vers la valeur échantillonnée. */
  /** Le monde n'existe qu'après `ready` (carte, spawn, calendrier reçus de l'hôte). */
  private worldReady = false
  /** Les étapes de montage du monde qui restent à jouer — une par frame (voir `onReady`).
   *  Non vide ⇒ le monde est en train de naître : `update` ne fait QUE le monter. */
  private buildQueue: [phase: string, run: () => void][] = []
  /** Combien de passes l'hôte s'est-il annoncé ? (lu de ses `progress`) — la barre est
   *  la somme des siennes et des nôtres, sinon elle reculerait à la passation. */
  private hostPhases = 0
  private worldSeed = 0
  private clutter?: ClutterLayer
  private ground!: GroundLayer
  private shade!: ShadeLayer
  private cendre!: CendreLayer
  private pois!: PoiLayer
  private shoreCliff!: ShoreCliff
  private calendarScale = 1
  /** Dernier tick de snapshot appliqué — rejette les snapshots périmés/hors ordre. */
  private lastSnapshotTick = 0
  private playerId = 0
  /** Les lieux que MON joueur connaît — lu du snapshot, jamais décidé ici (client bête). */
  private myKnownPois: readonly number[] = []
  private playerSprite!: Phaser.GameObjects.Image
  /** Prédiction à pas fixe + réconciliation par rejeu (spec reconciliation). */
  private prediction: PredictionState = createPrediction(0, 0)
  /** Position LOGIQUE du joueur (ancre autorité) — pour viser, mesurer une distance. */
  private get predicted(): { x: number; y: number } {
    return this.prediction.base
  }
  /** Les sprites-miroirs du snapshot (structures, nœuds, cadavres, autres entités). */
  private view!: SnapshotView
  /** Le retour de frappe (tressaillement + butin qui monte) — spec recolte.md G9. */
  private hitFx!: HitFx
  /** La silhouette de ce qu'on va poser, quand le mode construction est armé. */
  private buildGhost!: BuildGhost
  /** Exposé pour le hook `__BRAISES__` (les smoke tests lisent `others.size`). */
  private get others(): ReadonlyMap<number, InterpolatedSprite> {
    return this.view.others
  }
  /**
   * LES ENTITÉS DU DERNIER SNAPSHOT, telles quelles — surface de LECTURE du smoke
   * test (`window.__BRAISES__.scene.lastEntities`). Le smoke lit l'état, il ne le
   * fabrique pas : c'est ce qui lui permet de vérifier que la zone qu'il VOIT au sol
   * est bien celle que la SIM va frapper, au lieu de compter des tracés — un compteur
   * de commandes de dessin dit qu'il se passe quelque chose, jamais QUOI.
   */
  lastEntities: Entity[] = []
  private inputs!: MovementBindings
  private myVillageId: number | null = null
  private myHunger = 100
  private eventLog: SimEvent[] = []
  private evacMarker: Phaser.GameObjects.Arc | null = null
  private myWounds: Entity['wounds'] = {}
  private myStamina = 100
  private myTemperature = 100
  /** Mon avatar télégraphie : la sim l'immobilise — la prédiction aussi. */
  private myWindup = false
  /** Je CHARGE : la sim me ralentit (COMBAT.CHARGE_MOVE_FACTOR) — la prédiction doit
   *  le savoir, sinon mon avatar file plus vite que l'autorité et se fait rappeler à
   *  chaque snapshot. La formule reste celle de /sim (`speedScaleFor`). */
  private myCharging = false
  /** Les WIND-UPS du dernier snapshot : qui arme un coup, vers où, avec QUELLE FORME.
   *  C'est le TÉLÉGRAPHE du GDD §7 — on doit voir venir le coup, le sien comme
   *  celui d'en face. Il vient du snapshot, jamais du clic (invariant §3). */
  private windups: {
    id: number
    dx: number
    dy: number
    ticksLeft: number
    strike: Strike
    side: 1 | -1
    charged: boolean
  }[] = []
  /** LES CHARGES du dernier snapshot : qui maintient son clic, et où en est le coup.
   *  `strike` = ce qui partirait MAINTENANT (la sim tranche — `pendingStrike`). */
  private charges: { id: number; dx: number; dy: number; ratio: number; strike: Strike }[] = []
  /** CE QUE CHACUN TIENT, et où il regarde — l'arme dessinée dans la main. */
  private hands: { id: number; kind: WeaponKind; fx: number; fy: number }[] = []
  private attackFx!: AttackFx
  private handWeapons!: HandWeapons
  /** Qui armait un coup à la frame précédente, et sa zone — pour savoir quand il PART. */
  private armes = new Map<number, { x: number; y: number; dx: number; dy: number; zone: Zone; charged: boolean }>()
  /** DEV : dernière demande de TP consommée (horodatage de la carte) — évite de la rejouer. */
  private lastTeleportAt = 0
  /** Relief continu (Y-shear vertical) — source du rendu et du picking, créé au boot. */
  private warp!: Warp

  constructor() {
    super('world')
  }

  create(): void {
    // Origine PIEDS (R12) — indépendante de la texture, posée une fois ;
    // position/taille/depth viennent de `syncActor` à chaque frame.
    this.playerSprite = this.add.image(0, 0, 'spr-player').setOrigin(0.5, 1)
    this.view = new SnapshotView(this)
    this.hitFx = new HitFx()
    // Le combat se voit : la lame qui s'arme, l'impact, et l'écran qui saigne.
    // Juste sous les overlays — au-dessus du monde, sous le HUD.
    this.attackFx = createAttackFx(this, OVERLAY_DEPTH - 10)
    // Sous le télégraphe : l'arme se pose SUR le corps, la zone se peint AU SOL.
    this.handWeapons = createHandWeapons(this, OVERLAY_DEPTH - 12)
    this.view.setHitFx(this.hitFx) // elle seule dessine les nœuds : à elle le tressaillement
    this.buildGhost = new BuildGhost(this)

    const zoom = zoomForFraming(VISIBLE_TILES_TALL, TILE_PX, this.scale.height)
    this.cameras.main.setZoom(zoom)
    this.cameras.main.setBackgroundColor('#0e0e12')
    // Le suivi ne démarre qu'une fois l'avatar posé au spawn (onReady) : `startFollow`
    // ancre la caméra sur la position COURANTE de la cible, et ici elle vaut (0, 0).

    // La vallée n'existe pas encore : UIScene ne montrera que son écran de
    // chargement tant que ce drapeau est faux (posé AVANT le lancement — un
    // rechargement à chaud pourrait sinon lui laisser un `true` périmé du monde
    // précédent, et le HUD paraîtrait sur du vide).
    setHud(this.registry, 'worldReady', false)
    // ET LE JOUEUR N'A PAS LA MAIN. Les bindings sont posés dès maintenant, mais devant
    // un écran de chargement une touche n'a aucun sens : elle partirait quand même à
    // l'hôte (qui, lui, obéit), ouvrirait le sac derrière le voile, ou peindrait un
    // message par-dessus la barre. On rend l'input à la dernière étape du montage.
    this.input.enabled = false
    if (this.input.keyboard) this.input.keyboard.enabled = false
    this.scene.launch('ui')

    // Les handlers lisent l'état à la frappe : on passe des ACCESSEURS.
    this.inputs = bindInputs(this, {
      sendAction: (action) => this.sendAction(action),
      predicted: () => this.predicted,
      structures: () => this.view.structures,
      nodes: () => this.view.nodes,
      corpses: () => this.view.corpses,
      // Les handlers d'input sont posés dès `create`, mais `this.warp` n'existe
      // qu'après `onReady` (génération de carte). Avant, on renvoie le point plat :
      // de toute façon les actions sont des no-op sur structures/nodes vides.
      unproject: (px, py) => (this.warp ? this.warp.unproject(px, py) : { x: px, y: py }),
    })

    // Le mode debug (F1) — DEV seulement : en prod la condition est statiquement
    // fausse, le bloc et l'import sont éliminés du bundle.
    if (import.meta.env.DEV) {
      bindDebugKeys(this, {
        sendAction: (action) => this.sendAction(action),
        setSpeed: (factor) => this.send({ type: 'debug_speed', factor }),
        isNight: () => this.lastTime?.isNight ?? false,
      })
    }

    // Hook de debug/pilotage (pattern __MANIF__) : smoke tests et futurs bots.
    ;(window as unknown as { __BRAISES__: unknown }).__BRAISES__ = { scene: this }

    this.host = createWorkerHost()
    this.host.onMessage((msg) => this.onHostMessage(msg))
    this.host.onError((message) => {
      // L'hôte est mort : plus AUCUN snapshot n'arrivera. Ce n'est pas une erreur de
      // jeu qu'on chasse au bout de trois secondes — c'est la fin de la partie. Elle
      // va sur le canal de RUPTURE, qui reste à l'écran et propose de recharger.
      setHud(this.registry, 'fatal', { reason: `hôte perdu : ${message}` })
    })

    // Onglet caché : le rAF de Phaser s'arrête mais PAS le timer du Worker —
    // sans pause, l'hôte répéterait le dernier input (avatar sans pilote) et
    // empilerait des snapshots. Veillée = solo : on fige le monde.
    const onVisibility = (): void => {
      if (document.hidden) this.send({ type: 'pause' })
      // On ne « reprend » pas un monde qui n'a pas encore commencé : tant que les couches
      // se montent, l'hôte doit rester à l'arrêt (c'est la dernière étape qui le lance).
      else if (this.worldReady) this.send({ type: 'resume' })
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onVisibility)
      this.host.terminate()
    })

    // La génération de la grande carte alpine prend quelques secondes côté worker.
    // L'attente est TENUE PAR UIScene (caméra neutre) : un texte à scrollFactor 0
    // dans la caméra zoomée d'ici ne serait cadré que par chance.
    this.send({ type: 'join', protocolVersion: PROTOCOL_VERSION })
  }

  /**
   * Le monde arrive de l'hôte (carte, calendrier, spawn) — mais on ne le MONTE pas
   * ici : on ne fait qu'aligner les étapes. Les monter d'un trait bloquait le thread
   * principal ~3 secondes (mesuré : bake de la texture de terrain, maillages du sol,
   * décor procédural…), et pendant ces 3 secondes l'écran de chargement était FIGÉ,
   * barre coincée. Découpées, elles se jouent une par frame (voir `pumpBuild`) : le
   * navigateur reprend la main entre chaque, la barre monte, le texte tourne.
   */
  /** LES COINS DE CHASSE (spec faune R17) — donnée de monde, reçue une fois. */
  grounds: { x: number; y: number }[] = []

  private onReady(msg: ReadyMessage): void {
    this.grounds = msg.grounds ?? []
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      // Rien ne sera jouable : on ne sait pas lire ce que cet hôte enverra. Rupture.
      setHud(this.registry, 'fatal', {
        reason: `protocole hôte v${msg.protocolVersion} ≠ client v${PROTOCOL_VERSION}`,
      })
      return
    }
    this.playerId = msg.playerId
    this.worldSeed = msg.seed
    this.calendarScale = msg.calendarScale
    this.map = msg.map
    const worldW = this.map.width * TILE_PX
    const worldH = this.map.height * TILE_PX

    // L'ORDRE EST CELUI D'AVANT, à la ligne près : découper n'est pas réordonner.
    // Le `Record` typé par BUILD_PHASES est le garde-fou : ajouter une étape sans
    // l'annoncer (ou l'inverse) ne compile pas — la barre ne peut donc pas se
    // désaccorder en silence de ce qu'elle compte.
    const steps: Record<BuildPhase, () => void> = {
      relief: () => {
        // Garde anti-repli : un H trop grand replierait le sol sur les pentes sud.
        // NE JAMAIS aplatir l'eau à 0 « pour la poser à plat » : sur les flancs
        // (élévation ~0,65) ça creuse une marche de plus de 100 px sous chaque
        // rivière, la berge sud se dessine par-dessus le lit et la petite rivière
        // disparaît sous sa propre texture repliée. L'eau suit le relief ; c'est la
        // FALAISE DE BERGE qui porte le warp (voir ShoreCliff).
        if (this.map.elevation) {
          assertNoFold(this.map.elevation, this.map.width, this.map.height, RELIEF_H, TILE_PX)
        }
        this.warp = createWarp((tx, ty) => this.sampleElevation(tx, ty), RELIEF_H, TILE_PX)
        this.view.setWarp(this.warp)
      },
      // Terrain baké à 1 px/tuile (texture = map.width×map.height px, sous la limite
      // WebGL même pour une grande carte) puis étiré à la taille monde : les tuiles
      // étant des aplats, l'étirement NEAREST est pixel-identique au bake 16 px/tuile.
      bake: () => this.bakeMapTexture(),
      ground: () => {
        this.ground = new GroundLayer(this, this.map, this.warp, 'map-demo')
      },
      water: () => {
        // L'eau, par-dessus le sol : un shader qui défait le cisaillement du relief et
        // réfracte le fond (le bake `map-demo` lui sert de lit).
        this.water = new WaterLayer(this, this.map, 'map-demo')
        this.shade = new ShadeLayer(this, this.map, this.warp)
        this.cendre = new CendreLayer(this, this.map, String(this.map.width))
      },
      pois: () => {
        this.pois = new PoiLayer(this, this.map, this.warp) // les lieux se voient enfin
        this.shoreCliff = new ShoreCliff(this, this.map, this.warp)
        this.view.setNodes(msg.nodes)
      },
      clutter: () => {
        this.clutter = new ClutterLayer(this, this.map, this.worldSeed, this.warp)
      },
      world: () => {
        this.ambientRect = this.add
          .rectangle(0, 0, worldW, worldH, 0x000000, 0)
          .setOrigin(0)
          .setDepth(AMBIENT_DEPTH)
        this.fireGlow = new FireGlow(this)
        this.ambientLife = new AmbientLife(this, (tx, ty) =>
          tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height ? -1 : (this.map.terrain[ty * this.map.width + tx] ?? -1),
        )
        this.cameras.main.setBounds(0, 0, worldW, worldH)
        this.prediction = createPrediction(msg.playerSpawn.x, msg.playerSpawn.y)
        this.view.syncActor(this.playerSprite, this.predicted.x, this.predicted.y, 'spr-player')
        // Bornes posées et avatar au spawn : le suivi peut s'ancrer sans panoramique.
        this.cameras.main.startFollow(this.playerSprite, true, 0.16, 0.16)
        // La carte plein écran (M, rendue par UIScene) a besoin de la carte : pour
        // la mettre à l'échelle et pour nommer la zone/POI sous le curseur.
        setHud(this.registry, 'mapData', this.map)
        this.worldReady = true
        // Le monde est debout (carte bakée, couches montées, avatar au spawn) : UIScene
        // peut lever son écran de chargement et découvrir le HUD. On le dit EN DERNIER —
        // le drapeau ne doit pas devancer ce qu'il annonce.
        setHud(this.registry, 'worldReady', true)
        // Le joueur reprend la main (elle lui était retirée pendant le montage), et
        // l'hôte peut ENFIN faire tourner le monde : il nous attendait (sim-worker).
        this.input.enabled = true
        if (this.input.keyboard) this.input.keyboard.enabled = true
        this.send({ type: 'resume' })
      },
    }
    this.buildQueue = BUILD_PHASES.map((p) => [p, steps[p]])
    this.publishBuildProgress() // la barre passe la main à l'étage client
  }

  /**
   * Une étape de montage par frame. Entre deux, le navigateur peint : c'est tout
   * l'objet du découpage. On ne pompe qu'une seule étape — deux d'affilée, et on
   * aurait re-fabriqué le gel qu'on vient de défaire.
   */
  private pumpBuild(): void {
    const step = this.buildQueue.shift()
    if (!step) return
    step[1]()
    this.publishBuildProgress()
  }

  /**
   * La barre, vue du client : les passes de l'hôte SUIVIES de nos étapes de montage.
   * On ne connaît pas le détail du ladder de l'hôte — juste son total (`hostPhases`,
   * lu de ses `progress`) : on ajoute le nôtre derrière. Le compte ne recule donc
   * jamais, et 100 % veut vraiment dire « le monde est debout ».
   */
  private publishBuildProgress(): void {
    const total = this.hostPhases + BUILD_STEPS
    setHud(this.registry, 'loadProgress', {
      phase: this.buildQueue[0]?.[0] ?? 'world',
      done: total - this.buildQueue.length,
      total,
    })
  }

  override update(time: number, deltaMs: number): void {
    // Le monde se monte encore : UNE étape, et on rend la main au navigateur (il a
    // un écran de chargement à peindre). Deux étapes d'affilée refabriqueraient le
    // gel qu'on cherche à défaire.
    if (this.buildQueue.length > 0) {
      this.pumpBuild()
      return
    }
    if (!this.worldReady) return
    // Les gestes d'inventaire posés par UIScene (elle ne parle pas à l'hôte).
    for (const action of drainQueuedActions(this.registry)) this.sendAction(action)
    // Le clic MAINTENU : il récolte en boucle, à la cadence du rechargement.
    this.inputs.tickHold()
    // CE QU'ON VISE, à chaque frame — le curseur bouge, le nœud s'épuise, et la
    // caméra glisse encore après la course : une visée figée mentirait aussitôt.
    const aim = this.inputs.aim(this.input.activePointer)
    const overlay = Boolean(getHud(this.registry, 'mapOpen')) || Boolean(getHud(this.registry, 'characterMenuOpen'))
    this.view.setAim(overlay ? null : aim.nodeId, aim.inRange)
    this.buildGhost.update(
      overlay ? null : this.inputs.selected(),
      aim.tx,
      aim.ty,
      aim.inRange,
      this.view.structures,
      this.warp,
    )
    // Les stations à portée : elles grisent (ou non) les vignettes du panneau de
    // craft. Miroir pur du client — la sim revalide tout, à l'enfilage et à chaque
    // tick (spec craft-file F7, F14).
    publishStationsInRange(this.registry, this.predicted, this.view.structures)
    this.checkVitals()

    // LE COMBAT SE VOIT. Tout se redessine à chaque frame à partir du SNAPSHOT : la
    // zone qui va être frappée, la charge qui mûrit, l'arme qu'on tient. Rien n'est
    // anticipé au clic (invariant §3) — et rien n'est inventé : la forme de la zone
    // vient du `strike` que la sim transporte, sinon le télégraphe apprendrait une
    // règle qui n'existe pas.
    this.attackFx.beginFrame()
    const spriteOf = (id: number): Phaser.GameObjects.Image | null =>
      id === this.playerId ? this.playerSprite : (this.view.others.get(id)?.sprite ?? null)

    // LA CHARGE : le clic est enfoncé quelque part, et le coup mûrit. On peint la zone
    // qui partirait MAINTENANT — elle change de forme à maturité, et ce basculement
    // est le seul « c'est prêt » dont le joueur ait besoin.
    for (const c of this.charges) {
      const sprite = spriteOf(c.id)
      if (!sprite) continue
      this.attackFx.charge(
        sprite.x,
        sprite.y,
        c.dx,
        c.dy,
        c.ratio,
        zoneOf(c.strike),
        c.id === this.playerId,
        time,
      )
    }

    const encore = new Set<number>()
    for (const w of this.windups) {
      const sprite = spriteOf(w.id)
      if (!sprite) continue
      encore.add(w.id)
      const progress = Math.max(0, Math.min(1, 1 - w.ticksLeft / Math.max(1, w.strike.windupTicks)))
      const zone = zoneOf(w.strike)
      this.attackFx.telegraph(sprite.x, sprite.y, w.dx, w.dy, progress, zone, w.id === this.playerId, w.side, w.charged)
      this.armes.set(w.id, { x: sprite.x, y: sprite.y, dx: w.dx, dy: w.dy, zone, charged: w.charged })
    }
    // UN WIND-UP QUI DISPARAÎT = LE COUP EST PARTI. La zone claque — y compris dans le
    // vide : un coup manqué coûte de l'endurance ET cloue sur place (récupération
    // punitive, spec R4). Le joueur doit le SENTIR.
    for (const [id, a] of this.armes) {
      if (encore.has(id)) continue
      this.attackFx.slash(a.x, a.y, a.dx, a.dy, a.zone, time, a.charged)
      this.armes.delete(id)
    }
    this.attackFx.update(time)

    // L'ARME EN MAIN, sur chaque corps : ce qui dit CE QUI PEUT arriver (hand-weapon.ts).
    this.handWeapons.render(
      this.hands.flatMap((h) => {
        const sprite = spriteOf(h.id)
        return sprite ? [{ x: sprite.x, y: sprite.y, fx: h.fx, fy: h.fy, kind: h.kind }] : []
      }),
    )

    this.hitFx.update(time)
    this.ground.render(this.cameras.main)
    // LE VENT DE LA SIM (spec chasse C17) : le décor plie DANS SON SENS. C'est
    // la seule affordance de l'odorat — et elle doit exister, sans quoi la règle
    // « approcher sous le vent » serait une injustice invisible (C19).
    if (this.clutter) this.clutter.wind = this.view.wind
    this.clutter?.update(this.cameras.main, time) // le vent : le décor plie
    this.view.renderNodes(this.cameras.main, this.predicted.x, this.predicted.y, time)
    // LE SANG AU SOL (spec chasse C9) : la piste, et son horloge — les gouttes
    // fraîches sont vives, les vieilles pâlissent. C'est tout ce que le chasseur
    // a pour savoir s'il suit une bête ou un souvenir.
    this.view.renderBlood()
    // LES TERRIERS (spec chasse C16) : le trou EXISTE à l'écran, sans quoi le
    // lapin qui s'y engouffre s'évapore — et la géométrie de la chasse au lapin
    // (couper la ligne du terrier) resterait une règle invisible.
    this.view.renderBurrows(time)
    if (this.lastTime) {
      const hour = this.lastTime.hourOfCycle
      this.shade.render(this.cameras.main, hour) // ombre du relief selon le soleil
      // LA CENDRE. Le client la RECALCULE du jour de saison — on ne lui transmet aucune tuile,
      // aucun état. Elle ne se recuit que quand le front a bougé, c'est-à-dire une fois par jour.
      //
      // Et elle mange les NŒUDS : sans cette ligne, le client dessinerait des arbres dans un pré
      // carbonisé, et le joueur s'y cognerait. Le protocole n'envoie jamais la disparition d'un
      // nœud (il ne transmet que les stocks) — mais il n'a pas à le faire : le client DÉRIVE.
      const front = avanceeDuFront(this.lastTime.seasonDay, this.map.cendreMax ?? 0)
      this.cendre.update(front)
      this.view.majCendre(this.map.cendre, this.map.width, front)
      this.shoreCliff.render(this.cameras.main) // DÉMO falaise de berge
      // Les lieux ont besoin de savoir OÙ est le joueur (le nom grossit quand on
      // approche) et CE QU'IL CONNAÎT (on ne nomme pas un lieu qu'on n'a pas vu).
      this.pois.update(this.cameras.main, this.predicted.x, this.predicted.y, this.myKnownPois)
      const amb = ambientTint(hour)
      this.ambientRect?.setFillStyle(amb.color).setAlpha(amb.alpha)
      const day = daylight(hour)
      this.water?.update(time, hour, day) // la houle, et le soleil dessus
      this.fireGlow?.update(this.view.structures, this.view.villages, day, time)
      // La vie ambiante : les oiseaux traversent, les lucioles ne sortent qu'à la nuit.
      this.ambientLife?.update(this.cameras.main, time / 1000, deltaMs / 1000, 1 - day)
    }

    // ON NE MARCHE PAS EN TAPANT. Le champ de recherche du panneau de craft prend
    // le clavier ; sans cette garde, écrire « hache » enverrait Z-A-H-E au
    // déplacement — le personnage partirait en courant pendant qu'on cherche.
    const typing = Boolean(getHud(this.registry, 'uiTyping'))
    const dx = typing ? 0 : this.axis('right', 'left')
    const dy = typing ? 0 : this.axis('down', 'up')
    const sprint = !typing && this.inputs.sprintKeys.some((k) => k.isDown)
    // LE PAS LENT (spec chasse C2) : il prime sur le sprint dans la sim — on
    // transmet les deux tels quels, c'est `speedScaleFor` qui arbitre.
    const sneak = !typing && this.inputs.sneakKeys.some((k) => k.isDown)
    // La PARADE est débranchée du clavier (2026-07-12) : plus personne ne peut
    // l'armer. On continue de la transmettre — la sim, la prédiction et
    // `speedScaleFor` la connaissent — mais elle vaut désormais toujours `false`.
    // Le jour où parer revient, c'est cette ligne qu'on rebranche.
    const block = false

    // Prédiction locale (spec reconciliation R1-R7). `predictFrame` consomme le
    // dt de frame en sous-pas de tick fixes (rejeu exact de la suite de dt du
    // serveur → pas de divergence de coin), numérote chaque input et le bufferise.
    // On transmet à l'hôte un `input` par tick consommé ; la réconciliation par
    // rejeu (dans `onHostMessage`) recalera l'ancre sur l'autorité.
    const world = this.predictionWorld()
    // LA formule de vitesse vient de /sim (`speedScaleFor`) : les conditions
    // d'endurance (sprint/blocage annulés à 0) sont prédites juste. Pendant
    // son propre wind-up, la sim immobilise — la prédiction gèle (scale 0).
    // LE POIDS ENTRE DANS LA VITESSE — et par la MÊME formule que la sim
    // (`speedScaleFor`, spec portage.md P10). Le client ne recopie rien : une
    // seconde formule divergerait au premier ajustement, et une divergence de
    // vitesse fait se téléporter l'avatar à chaque réconciliation.
    const carried = getHud(this.registry, 'inv') ?? []
    const { scale } = speedScaleFor(
      {
        hunger: this.myHunger,
        wounds: this.myWounds,
        stamina: this.myStamina,
        temperature: this.myTemperature,
        inventory: carried,
      },
      { sprint, block, moving: dx !== 0 || dy !== 0, charging: this.myCharging, sneak },
    )
    const speedScale = this.myWindup ? 0 : scale
    // `sneak` n'entre pas dans PredictInput : la prédiction rejoue le
    // `speedScale` bufferisé, qui le contient déjà — mais l'HÔTE, lui, doit
    // savoir (l'allure décide du bruit, et la sim pose `Entity.gait`).
    const input: PredictInput = { dx, dy, sprint, block }
    for (const buffered of predictFrame(this.prediction, world, deltaMs / 1000, input, speedScale)) {
      this.send({ type: 'input', seq: buffered.seq, dx, dy, sprint, sneak, block })
    }
    // Rendu (R6-R7) : l'écart de correction résiduel fond chaque frame, puis le
    // sprite s'affiche à l'ancre extrapolée du reliquat sous-tick + cet écart —
    // fluide, sans latence, la sim restant exacte.
    decayRenderOffset(this.prediction, RENDER_OFFSET_DECAY)
    const render = renderPosition(this.prediction, world, input, speedScale)
    // La silhouette du rampeur se TASSE (spec chasse C19) — la sienne aussi :
    // le joueur doit SENTIR sa posture sans regarder une jauge.
    this.view.syncActor(this.playerSprite, render.x, render.y, 'spr-player', sneak)

    // La tuile réellement sous le curseur (unproject), pas la projection plate —
    // elle nourrit la visée (`aim`, plus haut), la caméra de visée et le debug.
    const pointer = this.input.activePointer
    const pw = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
    const groundPoint = this.warp.unproject(pw.x, pw.y)
    const gx = Math.floor(groundPoint.x / TILE_PX)
    const gy = Math.floor(groundPoint.y / TILE_PX)

    // DEV : exécute un TP demandé par la carte et nourrit l'overlay. Le corps vit
    // dans un module (pas une méthode) pour que la prod n'en garde rien — voir
    // l'en-tête de debug-overlay.ts.
    if (import.meta.env.DEV) {
      this.lastTeleportAt = syncDebug(this, {
        map: this.map,
        hover: { gx, gy },
        tick: this.lastSnapshotTick,
        lastTeleportAt: this.lastTeleportAt,
        sendAction: (action) => this.sendAction(action),
      })
    }

    // Interpolation des autres entités (R4) : vers le dernier snapshot, sur un tick.
    this.view.interpolate(this.time.now)

    setHud(this.registry, 'zone', zoneAt(this.map, this.predicted.x, this.predicted.y)?.name)
    // Le marqueur « tu es ici » de la carte plein écran suit l'ancre autorité.
    setHud(this.registry, 'playerPos', { x: this.predicted.x, y: this.predicted.y })

    // Caméra « Foxhole » (R11) : SEULEMENT en visée (clic droit maintenu), le
    // point suivi se décale vers le curseur pour voir plus loin là où l'on vise.
    // Calcul en ÉCRAN-espace (écart au centre), jamais depuis la position monde
    // du pointeur → pas de boucle caméra↔curseur. Au relâchement, le lerp du
    // startFollow ramène la caméra en douceur (offset cible à zéro).
    const off = pointer.rightButtonDown()
      ? lookaheadOffset(
          pointer.x, pointer.y, this.scale.width / 2, this.scale.height / 2,
          LOOKAHEAD_STRENGTH, LOOKAHEAD_MAX_TILES, TILE_PX,
        )
      : { x: 0, y: 0 }
    // followOffset est SOUSTRAIT du point suivi → on nie pour pencher VERS le curseur.
    this.cameras.main.setFollowOffset(-off.x, -off.y)
  }

  private onHostMessage(msg: HostToClient): void {
    if (msg.type === 'ready') {
      this.onReady(msg)
      return
    }
    if (msg.type === 'progress') {
      // L'hôte bâtit. On relaie son compte, mais SUR NOTRE TOTAL : ses passes, puis nos
      // étapes de montage. Sans ça, la barre atteindrait 100 % à la fin de sa besogne à
      // lui, et se figerait là pendant qu'on monte les couches (~3 s mesurées).
      this.hostPhases = msg.total
      setHud(this.registry, 'loadProgress', { phase: msg.phase, done: msg.done, total: msg.total + BUILD_STEPS })
      return
    }
    if (msg.type !== 'snapshot') return // type inconnu : futur protocole, on ignore
    // L'hôte tique déjà (il a envoyé son `ready`) alors que les couches se montent
    // encore, une par frame : ce snapshot n'a nulle part où s'afficher — le warp, les
    // nœuds, les sprites n'existent pas tous. On le JETTE ; le suivant est à 50 ms.
    if (!this.worldReady) return
    // Rejette les snapshots périmés ou hors ordre (garanti trivial sur Worker,
    // vital sur un vrai réseau).
    if (msg.tick <= this.lastSnapshotTick) return
    this.lastSnapshotTick = msg.tick

    const myVillage = msg.villages.find((v) => v.memberIds.includes(this.playerId))
    this.myVillageId = myVillage?.id ?? null
    publishTimeAndVillage(this.registry, msg.time, myVillage)
    this.lastTime = msg.time

    // Le monde d'abord : la réconciliation ci-dessous rejoue la prédiction
    // contre les structures/nœuds de CE snapshot, pas du précédent.
    this.view.apply(msg, this.playerId, this.time.now)
    // Le conteneur ouvert (loot) résolu contre CE snapshot : une dépouille vidée
    // s'efface (spec R16), ou le joueur s'en est éloigné hors de portée → le
    // panneau se referme au lieu de planter sur un id mort ou de rester fantôme.
    publishOpenContainer(this.registry, this.view.structures, this.view.corpses, this.predicted)
    this.processEvents(msg)

    this.lastEntities = msg.entities
    // QUI ARME UN COUP, cette frame — moi comme les bêtes. Lu du snapshot, avec LA
    // FORME du coup : c'est elle que le télégraphe dessine, jamais un arc supposé.
    this.windups = msg.entities.flatMap((e) =>
      e.windup
        ? [
            {
              id: e.id,
              dx: e.windup.dx,
              dy: e.windup.dy,
              ticksLeft: e.windup.ticksLeft,
              strike: e.windup.strike,
              side: e.windup.side ?? 1,
              charged: e.windup.charged === true,
            },
          ]
        : [],
    )
    // QUI CHARGE — et où en est son coup. `pendingStrike` (de /sim) répond à la seule
    // question qui compte : « qu'est-ce qui partirait s'il relâchait maintenant ? ».
    // C'est la sim qui tranche, pas une règle recopiée ici — la seule façon que la
    // forme peinte à l'écran soit CELLE qui frappera.
    this.charges = msg.entities.flatMap((e) => {
      if (!e.charge) return []
      const max = Math.max(1, weaponProfile(e).chargeTicks)
      return [
        {
          id: e.id,
          dx: e.charge.dx,
          dy: e.charge.dy,
          ratio: Math.min(1, e.charge.ticks / max),
          strike: pendingStrike(e),
        },
      ]
    })
    // CE QUE CHACUN TIENT. Aucun ajout au protocole : le snapshot transporte déjà
    // l'`Entity` complète (sac + case active), donc `weaponKind` lit la main de
    // n'importe qui — la mienne comme celle du villageois d'en face.
    this.hands = msg.entities.flatMap((e) => {
      const kind = weaponKind(e)
      return kind === 'unarmed' ? [] : [{ id: e.id, kind, fx: e.facing.x, fy: e.facing.y }]
    })

    // Mon entité autoritative : jauges HUD + réconciliation de la prédiction.
    const me = msg.entities.find((e) => e.id === this.playerId)
    if (me) {
      publishPlayerVitals(this.registry, me)
      this.myKnownPois = me.knownPois
      this.myHunger = me.hunger
      this.myWounds = me.wounds
      this.myStamina = me.stamina
      this.myTemperature = me.temperature
      this.myWindup = me.windup !== undefined
      this.myCharging = me.charge !== undefined
      this.myWeapon = weaponKind(me)
      this.reconcile(me, msg.lastProcessedInput)
    }
  }

  /** Événements du snapshot : erreurs/alarme pour MOI, chronique, marqueurs. */
  /**
   * LES AVERTISSEMENTS DU CORPS. Le jeu punit — il doit donc PRÉVENIR, et assez tôt
   * pour qu'on puisse encore agir. Deux crans par danger : un rappel discret quand
   * ça commence à mordre, une alerte quand ça tue. Chacun a son propre répit : une
   * alerte qui se répète à chaque frame n'est plus une alerte, c'est un décor.
   */
  private warnedAt: Record<string, number> = {}

  private warn(key: string, message: string, repitMs: number): void {
    const now = this.time.now
    if ((this.warnedAt[key] ?? -1e9) + repitMs > now) return
    this.warnedAt[key] = now
    publishError(this.registry, message, now)
  }

  /**
   * LES TROIS PHRASES DU DÉBUT. Un jeu exigeant DOIT dire ses règles — sinon il
   * n'est pas exigeant, il est obscur, et le joueur meurt sans savoir pourquoi.
   *
   * Trois, pas trente : le strict nécessaire pour ne pas mourir la première nuit.
   * Elles ne se répètent jamais (ce serait du bruit), et elles arrivent au moment
   * où elles servent — pas dans un mur de texte qu'on ferme sans lire.
   */
  private hintsDone = 0
  /** L'arme qu'on tient (snapshot) — et si la règle du coup lourd a déjà été dite. */
  private myWeapon: WeaponKind = 'unarmed'
  private armeHint = false

  private checkHints(): void {
    const now = this.time.now
    if (this.hintsDone === 0 && now > 2000) {
      this.hintsDone = 1
      publishError(this.registry, 'Clic gauche : récolter. TAB : votre sac et l’artisanat.', now)
    } else if (this.hintsDone === 1 && now > 12000) {
      this.hintsDone = 2
      publishError(this.registry, 'Ramassez du bois : il vous faut un FEU avant la nuit.', now)
    } else if (this.hintsDone === 2 && now > 24000) {
      this.hintsDone = 3
      // LA règle du jeu, dite une fois, en clair. Le cru ne nourrit plus un homme.
      publishError(this.registry, 'Le feu cuit, réchauffe, et tient les loups à distance.', now)
    }
    // LA RÈGLE DU COMBAT, dite À L'INSTANT OÙ ELLE SERT — pas dans un mur de texte au
    // démarrage, qu'on ferme sans lire : la première fois qu'une arme arrive en main.
    // Sans elle, le coup chargé (spec combat R4ter) reste un SECRET : rien à l'écran
    // ne dit qu'un clic peut se tenir, et un joueur qui ne connaît pas la moitié de son
    // arsenal ne « manque pas de skill » — on lui a caché le bouton.
    if (!this.armeHint && this.myWeapon !== 'unarmed') {
      this.armeHint = true
      publishError(this.registry, 'MAINTENEZ le clic : un coup lourd s’arme. Il fait mal — et rate cher.', now)
    }
  }

  private checkVitals(): void {
    if (!getHud(this.registry, 'worldReady')) return
    this.checkHints()
    // LA FAIM TUE désormais : à 0, les PV fondent. On le dit, fort.
    if (this.myHunger <= 0) this.warn('famine', 'VOUS MOUREZ DE FAIM.', 6000)
    else if (this.myHunger < 25) this.warn('faim', 'La faim vous tenaille — il faut manger.', 45000)
    // Le froid tue aussi, et il tue plus vite qu'on ne le croit.
    if (this.myTemperature <= TEMPERATURE.HYPOTHERMIA) this.warn('gel', 'VOUS GELEZ. Trouvez un feu.', 6000)
    else if (this.myTemperature < 45) this.warn('froid', 'Le froid vous prend.', 45000)
  }

  private processEvents(msg: SnapshotMessage): void {
    let chronicleDirty = false
    for (const event of msg.events) {
      if (event.type === 'action_rejected' && event.entityId === this.playerId) {
        publishError(this.registry, event.reason, this.time.now)
      } else if (event.type === 'resource_harvested' && event.entityId === this.playerId) {
        // LE COUP A PORTÉ — et on ne le sait QUE parce que la sim le dit (G9). Rien
        // n'est affiché au clic : un « +1 bois » qui monte avant le refus de la sim
        // serait un mensonge, et le client n'a pas le droit de mentir (invariant §3).
        this.hitFx.hit(event.nodeId, this.time.now) // le nœud tressaille
        publishPickup(this.registry, event.item, event.count) // et le butin s'inscrit au HUD
      } else if (event.type === 'entity_damaged') {
        // LE COUP A PORTÉ — et on ne le sait QUE parce que la sim le dit. Un coup
        // qui « part » à l'écran mais que la sim refuse serait un mensonge (G9) —
        // et EN MULTI, le jus des autres joueurs ne peut venir que de là : d'eux, on
        // ne reçoit que des événements.
        const now = this.time.now
        const onMe = event.entityId === this.playerId
        const cible = onMe ? this.playerSprite : (this.view.others.get(event.entityId)?.sprite ?? null)
        if (cible) {
          this.attackFx.impact(cible, now)
          this.attackFx.spark(cible.x, cible.y, event.amount, onMe, now)
        }
        if (onMe) {
          this.attackFx.hurt(now) // l'écran saigne…
          // …et la caméra encaisse. PUREMENT visuel : la position reste autoritative,
          // rien de ce qui suit ne touche la simulation (multi).
          this.cameras.main.shake(90, 0.006)
        }
      } else if (event.type === 'monster_slain') {
        // LA MISE À MORT claque : deux étincelles là où la bête est tombée. C'est le
        // seul retour qui dit « c'est fini » — sans lui, le loup disparaît, point.
        const tueur = this.view.others.get(event.byEntityId)?.sprite ?? this.playerSprite
        this.attackFx.spark(tueur.x, tueur.y - 6, 0, false, this.time.now)
      } else if (event.type === 'night_started') {
        // LA NUIT S'ANNONCE. C'est la règle la plus dure du jeu (loin d'un feu, on
        // est chassé) : elle doit être DITE, une fois, chaque soir. Une punition
        // qu'on n'a pas vue venir n'est pas une règle, c'est une injustice.
        publishError(this.registry, 'La nuit tombe. Loin d’un feu, on est chassé.', this.time.now)
      } else if (event.type === 'alarm_raised' && event.villageId === this.myVillageId) {
        publishAlarm(this.registry, this.time.now)
      } else if (event.type === 'wolf_howl' && event.targetEntityId === this.playerId) {
        // LE HURLEMENT (spec faune R13). C'est le seul avertissement que le joueur
        // recevra avant de voir la meute se placer autour de lui — et le GDD §9bis
        // en fait une règle : « annoncés, pas surprises ». Il passe par le canal
        // des erreurs faute d'audio (le son est acté « après GATE 1 ») : c'est un
        // pis-aller assumé, la vraie place de cette ligne est un cor dans le noir.
        const meute = event.packSize > 1 ? `${event.packSize} loups` : 'Un loup'
        publishError(this.registry, `Un hurlement, tout près. ${meute} vous ont choisi.`, this.time.now)
      } else if (event.type === 'prey_escaped') {
        // LE LAPIN RENTRE CHEZ LUI (spec chasse C16). Il disparaît — mais le TROU,
        // lui, reste un moment : sans ça, la bête s'évaporerait et ce serait le
        // décor qui avoue. Le joueur doit VOIR où elle est passée, et comprendre
        // qu'il fallait couper la ligne. Purement visuel : la sim n'en sait rien.
        this.view.markEscape(event.x, event.y, this.time.now)
      }
      if (CHRONICLE_TYPES.has(event.type)) {
        this.eventLog.push(event)
        if (this.eventLog.length > EVENT_LOG_CAP) {
          this.eventLog.splice(0, this.eventLog.length - EVENT_LOG_CAP)
        }
        chronicleDirty = true
        if (event.type === 'evacuation_opened') {
          this.evacMarker?.destroy()
          this.evacMarker = this.add
            .circle(event.tx * TILE_PX + 8, event.ty * TILE_PX + 8, 10, 0xffd94a, 0.6)
            .setStrokeStyle(2, 0xfff2b0)
            .setDepth(OVERLAY_DEPTH)
        }
        if (event.type === 'season_ended') {
          publishSeasonEnded(this.registry)
          // La saison est finie : l'objectif d'évacuation n'a plus de sens.
          this.evacMarker?.destroy()
          this.evacMarker = null
        }
      }
    }
    if (chronicleDirty) {
      publishChronicle(this.registry, this.eventLog, this.calendarScale, msg.villages)
    }
  }

  /**
   * La caméra suit l'avatar par lerp : sur un SAUT (TP de debug, respawn au Feu
   * d'un village lointain), elle traverserait la carte en glissant pendant des
   * secondes. Au-delà du seuil de snap, on la repose sèchement sur l'avatar.
   */
  private recenterCamera(): void {
    this.view.syncActor(this.playerSprite, this.predicted.x, this.predicted.y, 'spr-player')
    this.cameras.main.centerOn(this.playerSprite.x, this.playerSprite.y)
  }

  /** Le monde vu par la prédiction locale (collisions, vitesses). */
  private predictionWorld(): {
    map: WorldMap
    structures: SnapshotMessage['structures']
    nodes: ResourceNode[]
    moverVillageId: number | null
  } {
    return {
      map: this.map,
      structures: this.view.structures,
      nodes: this.view.nodes,
      moverVillageId: this.myVillageId,
    }
  }

  /**
   * Réconciliation par rejeu (spec reconciliation R3-R6) : purge les inputs
   * acquittés, pose l'ancre sur l'autorité et rejoue les inputs en attente. La
   * sim reste exacte ; l'écart de correction va dans `renderOffset` (lissé au
   * rendu), et au-delà du seuil de snap c'est un vrai téléport (respawn au Feu).
   */
  private reconcile(authoritative: Entity, lastProcessedInput: number): void {
    // Mesuré AVANT le rejeu : au-delà du seuil de snap, l'avatar n'a pas marché,
    // il a sauté (TP de debug, respawn) — la caméra doit sauter avec lui.
    const jumped =
      Math.abs(authoritative.x - this.predicted.x) > SNAP_DISTANCE_TILES ||
      Math.abs(authoritative.y - this.predicted.y) > SNAP_DISTANCE_TILES
    reconcilePrediction(
      this.prediction,
      this.predictionWorld(),
      { x: authoritative.x, y: authoritative.y },
      lastProcessedInput,
      SNAP_DISTANCE_TILES,
    )
    if (jumped) this.recenterCamera()
  }

  private axis(plus: 'right' | 'down', minus: 'left' | 'up'): -1 | 0 | 1 {
    const p = this.inputs.keys[plus].some((k) => k.isDown)
    const m = this.inputs.keys[minus].some((k) => k.isDown)
    if (p === m) return 0
    return p ? 1 : -1
  }

  private send(msg: ClientToHost): void {
    this.host.send(msg)
  }

  private sendAction(action: PlayerAction): void {
    this.send({ type: 'action', action })
  }

  // Échantillonneur d'altitude clampé aux bords — partagé bake/warp/hillshade.
  private sampleElevation(tx: number, ty: number): number {
    const { width, height } = this.map
    const cx = tx < 0 ? 0 : tx >= width ? width - 1 : tx
    const cy = ty < 0 ? 0 : ty >= height ? height - 1 : ty
    return this.map.elevation?.[cy * width + cx] ?? 0
  }

  /** Bake la carte statique en une texture (R8) — API generateTexture éprouvée dans Manif.
   *  La couleur d'une tuile = biome × grain (bruit par tuile). Le RELIEF n'est PLUS
   *  cuit ici : l'ombre du versant est dynamique (ShadeLayer, suit le soleil).
   *  Le facteur reste CONSTANT PAR TUILE : c'est ce qui autorise le bake à 1 px/tuile.
   *  Grain gardé faible (nearest) sinon le damier par tuile masque l'ombre. */
  private bakeMapTexture(): void {
    const { width, height } = this.map
    const g = this.add.graphics()
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const base = TERRAIN_COLORS[this.map.terrain[ty * width + tx] ?? 0] ?? 0xff00ff
        const grain = 0.96 + 0.07 * hash2(tx, ty)
        g.fillStyle(shade(base, grain))
        g.fillRect(tx, ty, 1, 1) // 1 px/tuile — étiré à la taille monde par setDisplaySize
      }
    }
    g.generateTexture('map-demo', width, height)
    g.destroy()
  }
}
