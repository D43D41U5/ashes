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
import { setHud } from '../hud-state'
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
  publishAlarm,
  publishChronicle,
  publishError,
  publishPlayerVitals,
  publishSeasonEnded,
  publishTimeAndVillage,
} from './world/hud-bridge'
import { ClutterLayer } from './world/clutter-layer'
import { GroundLayer } from './world/ground-layer'
import { ShadeLayer } from './world/shade-layer'
import { ShoreCliff } from './world/shore-cliff'
import { FireGlow } from './world/fire-glow'
import { bindDebugKeys } from './world/debug-bindings'
import { syncDebug } from './world/debug-overlay'
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
  private lastTime: GameTime | null = null
  /** Couvert de canopée lissé autour de l'avatar — piloté vers la valeur échantillonnée. */
  /** Le monde n'existe qu'après `ready` (carte, spawn, calendrier reçus de l'hôte). */
  private worldReady = false
  private worldSeed = 0
  private clutter?: ClutterLayer
  private ground!: GroundLayer
  private shade!: ShadeLayer
  private shoreCliff!: ShoreCliff
  private loadingText: Phaser.GameObjects.Text | null = null
  private calendarScale = 1
  /** Dernier tick de snapshot appliqué — rejette les snapshots périmés/hors ordre. */
  private lastSnapshotTick = 0
  private playerId = 0
  private playerSprite!: Phaser.GameObjects.Image
  /** Prédiction à pas fixe + réconciliation par rejeu (spec reconciliation). */
  private prediction: PredictionState = createPrediction(0, 0)
  /** Position LOGIQUE du joueur (ancre autorité) — pour viser, mesurer une distance. */
  private get predicted(): { x: number; y: number } {
    return this.prediction.base
  }
  /** Les sprites-miroirs du snapshot (structures, nœuds, cadavres, autres entités). */
  private view!: SnapshotView
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
  private ghost!: Phaser.GameObjects.Rectangle
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

    const zoom = zoomForFraming(VISIBLE_TILES_TALL, TILE_PX, this.scale.height)
    this.cameras.main.setZoom(zoom)
    this.cameras.main.setBackgroundColor('#0e0e12')
    // Le suivi ne démarre qu'une fois l'avatar posé au spawn (onReady) : `startFollow`
    // ancre la caméra sur la position COURANTE de la cible, et ici elle vaut (0, 0).

    this.scene.launch('ui')

    // Les handlers lisent l'état à la frappe : on passe des ACCESSEURS.
    this.inputs = bindInputs(this, {
      sendAction: (action) => this.sendAction(action),
      predicted: () => this.predicted,
      structures: () => this.view.structures,
      nodes: () => this.view.nodes,
      corpses: () => this.view.corpses,
      others: () => this.view.others,
      // Les handlers d'input sont posés dès `create`, mais `this.warp` n'existe
      // qu'après `onReady` (génération de carte). Avant, on renvoie le point plat :
      // de toute façon les actions sont des no-op sur structures/nodes vides.
      unproject: (px, py) => (this.warp ? this.warp.unproject(px, py) : { x: px, y: py }),
    })

    // Le fantôme de construction, aligné sur la grille (suit le pointeur en update).
    this.ghost = this.add
      .rectangle(0, 0, TILE_PX, TILE_PX, 0xffffff, 0.22)
      .setOrigin(0)
      .setDepth(OVERLAY_DEPTH)
      .setStrokeStyle(1, 0xffffff, 0.5)

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
      // L'hôte est mort : plus de snapshots. On le dit au joueur plutôt que
      // de le laisser marcher dans un monde figé.
      publishError(this.registry, `hôte perdu : ${message}`, this.time.now)
    })

    // Onglet caché : le rAF de Phaser s'arrête mais PAS le timer du Worker —
    // sans pause, l'hôte répéterait le dernier input (avatar sans pilote) et
    // empilerait des snapshots. Veillée = solo : on fige le monde.
    const onVisibility = (): void => {
      this.send({ type: document.hidden ? 'pause' : 'resume' })
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onVisibility)
      this.host.terminate()
    })

    this.send({ type: 'join', protocolVersion: PROTOCOL_VERSION })
    // La génération de la grande carte alpine prend quelques secondes côté worker.
    this.loadingText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Génération de la vallée alpine…', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#e8c66a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH)
  }

  /** Le monde arrive de l'hôte : carte, calendrier, spawn (décisions d'hôte). */
  private onReady(msg: ReadyMessage): void {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      publishError(this.registry, `protocole hôte v${msg.protocolVersion} ≠ client v${PROTOCOL_VERSION}`, this.time.now)
      return
    }
    this.playerId = msg.playerId
    this.map = msg.map
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
    this.calendarScale = msg.calendarScale
    const worldW = this.map.width * TILE_PX
    const worldH = this.map.height * TILE_PX
    // Terrain baké à 1 px/tuile (texture = map.width×map.height px, sous la limite
    // WebGL même pour une grande carte) puis étiré à la taille monde : les tuiles
    // étant des aplats, l'étirement NEAREST est pixel-identique au bake 16 px/tuile.
    this.bakeMapTexture()
    this.ground = new GroundLayer(this, this.map, this.warp, 'map-demo')
    this.shade = new ShadeLayer(this, this.map, this.warp)
    this.shoreCliff = new ShoreCliff(this, this.map, this.warp)
    this.worldSeed = msg.seed
    this.view.setNodes(msg.nodes)
    this.clutter = new ClutterLayer(this, this.map, this.worldSeed, this.warp)
    this.ambientRect = this.add
      .rectangle(0, 0, worldW, worldH, 0x000000, 0)
      .setOrigin(0)
      .setDepth(AMBIENT_DEPTH)
    this.fireGlow = new FireGlow(this)
    this.cameras.main.setBounds(0, 0, worldW, worldH)
    this.prediction = createPrediction(msg.playerSpawn.x, msg.playerSpawn.y)
    this.view.syncActor(this.playerSprite, this.predicted.x, this.predicted.y, 'spr-player')
    // Bornes posées et avatar au spawn : le suivi peut s'ancrer sans panoramique.
    this.cameras.main.startFollow(this.playerSprite, true, 0.16, 0.16)
    // La carte plein écran (M, rendue par UIScene) a besoin de la carte : pour
    // la mettre à l'échelle et pour nommer la zone/POI sous le curseur.
    setHud(this.registry, 'mapData', this.map)
    this.loadingText?.destroy()
    this.loadingText = null
    this.worldReady = true
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.worldReady) return
    this.ground.render(this.cameras.main)
    this.clutter?.update(this.cameras.main)
    this.view.renderNodes(this.cameras.main, this.predicted.x, this.predicted.y)
    if (this.lastTime) {
      const hour = this.lastTime.hourOfCycle
      this.shade.render(this.cameras.main, hour) // ombre du relief selon le soleil
      this.shoreCliff.render(this.cameras.main) // DÉMO falaise de berge
      const amb = ambientTint(hour)
      this.ambientRect?.setFillStyle(amb.color).setAlpha(amb.alpha)
      this.fireGlow?.update(this.view.structures, this.view.villages, daylight(hour))
    }

    const dx = this.axis('right', 'left')
    const dy = this.axis('down', 'up')
    const sprint = this.inputs.sprintKeys.some((k) => k.isDown)
    const block = this.inputs.blockKey.isDown

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

    // Le fantôme de construction suit le pointeur, aligné sur la grille — la
    // tuile réellement sous le curseur (unproject), pas la projection plate.
    const pointer = this.input.activePointer
    const pw = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
    const groundPoint = this.warp.unproject(pw.x, pw.y)
    const gx = Math.floor(groundPoint.x / TILE_PX)
    const gy = Math.floor(groundPoint.y / TILE_PX)
    this.ghost.setPosition(gx * TILE_PX, gy * TILE_PX - this.warp.lift(gx + 0.5, gy + 1))

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
    if (msg.type !== 'snapshot') return // type inconnu : futur protocole, on ignore
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
    this.processEvents(msg)

    // Mon entité autoritative : jauges HUD + réconciliation de la prédiction.
    const me = msg.entities.find((e) => e.id === this.playerId)
    if (me) {
      publishPlayerVitals(this.registry, me)
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
      } else if (event.type === 'alarm_raised' && event.villageId === this.myVillageId) {
        publishAlarm(this.registry, this.time.now)
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
