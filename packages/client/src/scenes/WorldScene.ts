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
  type SimEvent,
  type WorldMap,
} from '@braises/sim'
import Phaser from 'phaser'
import { createWorkerHost, type HostConnection } from '../host-connection'
import { setHud } from '../hud-state'
import { PROTOCOL_VERSION, type ClientToHost, type HostToClient, type ReadyMessage, type SnapshotMessage } from '../protocol'
import { lookaheadOffset, OVERLAY_DEPTH, TILE_PX, zoomForFraming } from '../render/framing'
import { ambientTint, canopyDensity, canopyStrength, daylight, sampleCanopyCoverage } from '../render/lighting'
import {
  publishAlarm,
  publishChronicle,
  publishError,
  publishPlayerVitals,
  publishSeasonEnded,
  publishTimeAndVillage,
} from './world/hud-bridge'
import { FireGlow } from './world/fire-glow'
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

/** Profondeurs des couches de lumière (au-dessus des sprites ~1000-1200, sous le ghost à OVERLAY_DEPTH). */
const CANOPY_DEPTH = 2000
const AMBIENT_DEPTH = 2100

/**
 * Atténuation de la canopée MONDE : l'immersion du sous-bois est portée par le
 * voile écran (UIScene), la texture monde ne garde qu'un repère discret « c'est
 * de la forêt » lisible de l'extérieur. Calé en playtest.
 */
const WORLD_CANOPY_HINT = 0.45
/** Constante de lissage du couvert (ms) : entrer/sortir du sous-bois fond le voile en douceur. */
const CANOPY_EASE_MS = 350

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
  private canopyImage: Phaser.GameObjects.Image | null = null
  private ambientRect: Phaser.GameObjects.Rectangle | null = null
  private fireGlow: FireGlow | null = null
  private lastTime: GameTime | null = null
  /** Couvert de canopée lissé autour de l'avatar — piloté vers la valeur échantillonnée. */
  private canopyCoverage = 0
  /** Le monde n'existe qu'après `ready` (carte, spawn, calendrier reçus de l'hôte). */
  private worldReady = false
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

  constructor() {
    super('world')
  }

  create(): void {
    // Origine PIEDS (R12) — indépendante de la texture, posée une fois ;
    // position/taille/depth viennent de `syncActor` à chaque frame.
    this.playerSprite = this.add.image(0, 0, 'spr-player').setOrigin(0.5, 1)
    this.view = new SnapshotView(this)

    const zoom = zoomForFraming(VISIBLE_TILES_TALL, TILE_PX, this.scale.height)
    this.cameras.main.startFollow(this.playerSprite, true, 0.16, 0.16).setZoom(zoom)
    this.cameras.main.setBackgroundColor('#0e0e12')

    this.scene.launch('ui')

    // Les handlers lisent l'état à la frappe : on passe des ACCESSEURS.
    this.inputs = bindInputs(this, {
      sendAction: (action) => this.sendAction(action),
      predicted: () => this.predicted,
      structures: () => this.view.structures,
      nodes: () => this.view.nodes,
      corpses: () => this.view.corpses,
      others: () => this.view.others,
    })

    // Le fantôme de construction, aligné sur la grille (suit le pointeur en update).
    this.ghost = this.add
      .rectangle(0, 0, TILE_PX, TILE_PX, 0xffffff, 0.22)
      .setOrigin(0)
      .setDepth(OVERLAY_DEPTH)
      .setStrokeStyle(1, 0xffffff, 0.5)

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
  }

  /** Le monde arrive de l'hôte : carte, calendrier, spawn (décisions d'hôte). */
  private onReady(msg: ReadyMessage): void {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      publishError(this.registry, `protocole hôte v${msg.protocolVersion} ≠ client v${PROTOCOL_VERSION}`, this.time.now)
      return
    }
    this.playerId = msg.playerId
    this.map = msg.map
    this.calendarScale = msg.calendarScale
    this.bakeMapTexture()
    this.add.image(0, 0, 'map-demo').setOrigin(0).setDepth(-1)
    this.bakeCanopyTexture()
    this.canopyImage = this.add.image(0, 0, 'canopy').setOrigin(0).setDepth(CANOPY_DEPTH)
    const worldPx = this.map.width * TILE_PX
    this.ambientRect = this.add
      .rectangle(0, 0, worldPx, worldPx, 0x000000, 0)
      .setOrigin(0)
      .setDepth(AMBIENT_DEPTH)
    this.fireGlow = new FireGlow(this)
    this.cameras.main.setBounds(0, 0, worldPx, worldPx)
    this.prediction = createPrediction(msg.playerSpawn.x, msg.playerSpawn.y)
    this.view.syncActor(this.playerSprite, this.predicted.x, this.predicted.y, 'spr-player')
    // La carte plein écran (M, rendue par UIScene) a besoin de la carte : pour
    // la mettre à l'échelle et pour nommer la zone/POI sous le curseur.
    setHud(this.registry, 'mapData', this.map)
    this.worldReady = true
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.worldReady) return
    if (this.lastTime) {
      const hour = this.lastTime.hourOfCycle
      const amb = ambientTint(hour)
      this.ambientRect?.setFillStyle(amb.color).setAlpha(amb.alpha)
      this.canopyImage?.setAlpha(canopyStrength(daylight(hour)))
      this.fireGlow?.update(this.view.structures, this.view.villages, daylight(hour))
    }

    // Voile de sous-bois : on échantillonne le couvert autour de l'avatar et on
    // le lisse dans le temps (pas de saut en franchissant une bordure). UIScene
    // en fait la vignette écran ; ici on ne publie que le couvert lissé.
    const targetCoverage = sampleCanopyCoverage(this.map, this.predicted.x, this.predicted.y)
    this.canopyCoverage += (targetCoverage - this.canopyCoverage) * Math.min(1, deltaMs / CANOPY_EASE_MS)
    setHud(this.registry, 'canopyCoverage', this.canopyCoverage)
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

    // Le fantôme de construction suit le pointeur, aligné sur la grille.
    const pointer = this.input.activePointer
    const pw = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
    this.ghost.setPosition(Math.floor(pw.x / TILE_PX) * TILE_PX, Math.floor(pw.y / TILE_PX) * TILE_PX)

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

  /** Le monde vu par la prédiction locale (collisions, vitesses). */
  private predictionWorld(): {
    map: WorldMap
    structures: SnapshotMessage['structures']
    nodes: SnapshotMessage['nodes']
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
    reconcilePrediction(
      this.prediction,
      this.predictionWorld(),
      { x: authoritative.x, y: authoritative.y },
      lastProcessedInput,
      SNAP_DISTANCE_TILES,
    )
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

  /** Bake la carte statique en une texture (R8) — API generateTexture éprouvée dans Manif. */
  private bakeMapTexture(): void {
    const g = this.add.graphics()
    for (let ty = 0; ty < this.map.height; ty++) {
      for (let tx = 0; tx < this.map.width; tx++) {
        const base = TERRAIN_COLORS[this.map.terrain[ty * this.map.width + tx] ?? 0] ?? 0xff00ff
        g.fillStyle(shade(base, 0.92 + 0.16 * hash2(tx, ty)))
        g.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX)
      }
    }
    g.generateTexture('map-demo', this.map.width * TILE_PX, this.map.height * TILE_PX)
    g.destroy()
  }

  /** Cuit la pénombre de couvert en une texture monde : tuiles boisées assombries, mouchetées. */
  private bakeCanopyTexture(): void {
    const g = this.add.graphics()
    for (let ty = 0; ty < this.map.height; ty++) {
      for (let tx = 0; tx < this.map.width; tx++) {
        const density = canopyDensity(this.map.terrain[ty * this.map.width + tx] ?? 0)
        if (density <= 0) continue
        const a = Math.min(1, density * WORLD_CANOPY_HINT * (0.85 + 0.3 * hash2(tx, ty)))
        g.fillStyle(0x040807, a)
        g.fillRect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX)
      }
    }
    g.generateTexture('canopy', this.map.width * TILE_PX, this.map.height * TILE_PX)
    g.destroy()
  }
}
