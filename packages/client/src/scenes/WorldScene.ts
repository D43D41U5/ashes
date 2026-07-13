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
  createPrediction,
  decayRenderOffset,
  hash2,
  predictFrame,
  reconcile as reconcilePrediction,
  renderPosition,
  speedScaleFor,
  zoneAt,
  type Entity,
  type GameTime,
  type PlayerAction,
  type PredictInput,
  type PredictionState,
  type ResourceNode,
  type SimEvent,
  type WorldMap,
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
import { bindInputs, type MovementBindings } from './world/input-bindings'
import { SnapshotView, type InterpolatedSprite } from './world/snapshot-view'

/** Cadrage caméra (spec client R10) : « je veux voir ~N tuiles de haut ». */
const VISIBLE_TILES_TALL = 20
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
  private onReady(msg: ReadyMessage): void {
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
    const overlay = Boolean(getHud(this.registry, 'mapOpen')) || Boolean(getHud(this.registry, 'inventoryOpen'))
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
    this.hitFx.update(time)
    this.ground.render(this.cameras.main)
    this.clutter?.update(this.cameras.main, time) // le vent : le décor plie
    this.view.renderNodes(this.cameras.main, this.predicted.x, this.predicted.y, time)
    if (this.lastTime) {
      const hour = this.lastTime.hourOfCycle
      this.shade.render(this.cameras.main, hour) // ombre du relief selon le soleil
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

    const dx = this.axis('right', 'left')
    const dy = this.axis('down', 'up')
    const sprint = this.inputs.sprintKeys.some((k) => k.isDown)
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
    const { scale } = speedScaleFor(
      { hunger: this.myHunger, wounds: this.myWounds, stamina: this.myStamina, temperature: this.myTemperature },
      { sprint, block, moving: dx !== 0 || dy !== 0 },
    )
    const speedScale = this.myWindup ? 0 : scale
    const input: PredictInput = { dx, dy, sprint, block }
    for (const buffered of predictFrame(this.prediction, world, deltaMs / 1000, input, speedScale)) {
      this.send({ type: 'input', seq: buffered.seq, dx, dy, sprint, block })
    }
    // Rendu (R6-R7) : l'écart de correction résiduel fond chaque frame, puis le
    // sprite s'affiche à l'ancre extrapolée du reliquat sous-tick + cet écart —
    // fluide, sans latence, la sim restant exacte.
    decayRenderOffset(this.prediction, RENDER_OFFSET_DECAY)
    const render = renderPosition(this.prediction, world, input, speedScale)
    this.view.syncActor(this.playerSprite, render.x, render.y, 'spr-player')

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
      this.reconcile(me, msg.lastProcessedInput)
    }
  }

  /** Événements du snapshot : erreurs/alarme pour MOI, chronique, marqueurs. */
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
