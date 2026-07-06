/**
 * La scène de jeu : rendu de la vallée, avatar prédit, entités interpolées.
 *
 * Le client est « bête » (spec client R3-R5, reconciliation R1-R7) : la sim
 * tourne dans le Worker, ici on envoie des intentions numérotées et on interpole
 * des snapshots. La prédiction locale de son propre avatar et la réconciliation
 * par rejeu vivent dans `/sim` (`prediction.ts`, pur et testé) — on ne fait ici
 * que câbler l'I/O réseau et le rendu.
 */
import {
  BALANCE,
  COMBAT,
  STRUCTURE_HP,
  chronicleFromEvents,
  createPrediction,
  decayRenderOffset,
  predictFrame,
  reconcile as reconcilePrediction,
  renderPosition,
  zoneAt,
  type PredictInput,
  type PredictionState,
  type SimEvent,
  type AccessLevel,
  type Corpse,
  type Entity,
  type Monster,
  type Npc,
  type PlayerAction,
  type RecipeId,
  type ResourceNode,
  type Structure,
  type WorldMap,
} from '@braises/sim'
import Phaser from 'phaser'
import { createDemoMap, DEMO_MAP_SIZE, PLAYER_SPAWN } from '../demo-map'
import type { ClientToHost, HostToClient, SnapshotMessage } from '../protocol'
import {
  actorPlacement,
  type ActorFootprint,
  lookaheadOffset,
  OVERLAY_DEPTH,
  structureDepth,
  zoomForFraming,
} from '../render/framing'

type Buildable = 'wall' | 'door' | 'chest' | 'workshop' | 'furnace'
const BUILD_KEYS: Buildable[] = ['wall', 'door', 'chest', 'workshop', 'furnace']

const TILE_PX = 16
/** Cadrage caméra (spec client R10) : « je veux voir ~N tuiles de haut ». */
const VISIBLE_TILES_TALL = 20
/** Caméra « Foxhole » (R11) : force du décalage vers le curseur (px écran → px monde). */
const LOOKAHEAD_STRENGTH = 0.18
/** Borne radiale du décalage caméra, en tuiles. */
const LOOKAHEAD_MAX_TILES = 6
const INTERP_MS = 1000 / BALANCE.TICK_RATE_HZ
/** Écart prédiction/autorité au-delà duquel on snap (spec client R5). */
const SNAP_DISTANCE_TILES = 1.5
/** Décroissance par frame de l'écart visuel après une correction (lissage de rendu, spec R6). */
const RENDER_OFFSET_DECAY = 0.85

/** Emprise VISUELLE par texture d'acteur (tuiles) — R12. Découplée de la
 * résolution native de l'art : un placeholder 12×12 rend ici à ces proportions.
 * L'emprise logique (collision/clic) reste AVATAR_HITBOX_TILES, inchangée. */
const ACTOR_FOOTPRINTS: Record<string, ActorFootprint> = {
  'spr-player': { widthTiles: 1, heightTiles: 1.6 },
  'spr-npc': { widthTiles: 1, heightTiles: 1.6 },
  'spr-zombie': { widthTiles: 1, heightTiles: 1.6 },
  'spr-boar': { widthTiles: 1.4, heightTiles: 1 },
}
const DEFAULT_FOOTPRINT: ActorFootprint = { widthTiles: 1, heightTiles: 1.6 }

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
}

/** Assombrit/éclaircit légèrement une couleur (variation par tuile). */
function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor))
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor))
  const b = Math.min(255, Math.floor((color & 0xff) * factor))
  return (r << 16) | (g << 8) | b
}

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

interface InterpolatedSprite {
  sprite: Phaser.GameObjects.Image
  fromX: number
  fromY: number
  toX: number
  toY: number
  startedAt: number
}

export class WorldScene extends Phaser.Scene {
  private worker!: Worker
  private map!: WorldMap
  private playerId = 0
  private playerSprite!: Phaser.GameObjects.Image
  /** Prédiction à pas fixe + réconciliation par rejeu (spec reconciliation). */
  private prediction: PredictionState = createPrediction(PLAYER_SPAWN.x, PLAYER_SPAWN.y)
  /** Position LOGIQUE du joueur (ancre autorité) — pour viser, mesurer une distance. */
  private get predicted(): { x: number; y: number } {
    return this.prediction.base
  }
  private others = new Map<number, InterpolatedSprite>()
  private keys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key[]>
  private structures: Structure[] = []
  private structureSprites = new Map<number, Phaser.GameObjects.Image>()
  private nodes: ResourceNode[] = []
  private nodeSprites = new Map<number, Phaser.GameObjects.Image>()
  private npcs: Npc[] = []
  private villages: SnapshotMessage['villages'] = []
  private monsters: Monster[] = []
  private corpses: Corpse[] = []
  private corpseSprites = new Map<number, Phaser.GameObjects.Image>()
  private myVillageId: number | null = null
  private myHunger = 100
  private eventLog: SimEvent[] = []
  private evacMarker: Phaser.GameObjects.Arc | null = null
  private myWoundedLeg = false
  private sprintKeys: Phaser.Input.Keyboard.Key[] = []
  private blockKey!: Phaser.Input.Keyboard.Key
  private selected: Buildable = 'wall'
  private ghost!: Phaser.GameObjects.Rectangle

  constructor() {
    super('world')
  }

  create(): void {
    this.map = createDemoMap()
    this.bakeMapTexture()
    this.add.image(0, 0, 'map-demo').setOrigin(0)

    this.playerSprite = this.add.image(0, 0, 'spr-player')
    this.applyFootprint(this.playerSprite, 'spr-player')
    this.syncSprite(this.playerSprite, this.predicted.x, this.predicted.y)

    const worldPx = DEMO_MAP_SIZE * TILE_PX
    this.cameras.main.setBounds(0, 0, worldPx, worldPx)
    const zoom = zoomForFraming(VISIBLE_TILES_TALL, TILE_PX, this.scale.height)
    this.cameras.main.startFollow(this.playerSprite, true, 0.16, 0.16).setZoom(zoom)
    this.cameras.main.setBackgroundColor('#0e0e12')

    this.scene.launch('ui')

    const kb = this.input.keyboard!
    const grab = (codes: number[]) => codes.map((c) => kb.addKey(c, false))
    const K = Phaser.Input.Keyboard.KeyCodes
    this.keys = {
      up: grab([K.Z, K.W, K.UP]),
      down: grab([K.S, K.DOWN]),
      left: grab([K.Q, K.A, K.LEFT]),
      right: grab([K.D, K.RIGHT]),
    }

    // Mode construction : F fonde, 1-5 choisit, clic bâtit, clic droit démolit.
    kb.addKey(K.F, false).on('down', () => this.sendAction({ type: 'light_fire' }))
    ;[K.ONE, K.TWO, K.THREE, K.FOUR, K.FIVE].forEach((code, i) => {
      kb.addKey(code, false).on('down', () => {
        this.selected = BUILD_KEYS[i]!
        this.registry.set('selected', this.selected)
      })
    })
    this.registry.set('selected', this.selected)

    // Combat : ESPACE attaque vers le pointeur, C bloque, SHIFT sprinte, X bande.
    this.sprintKeys = grab([K.SHIFT])
    this.blockKey = kb.addKey(K.C, false)
    kb.addKey(K.SPACE, false).on('down', () => {
      const world = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
      const dx = world.x / TILE_PX - this.predicted.x
      const dy = world.y / TILE_PX - this.predicted.y
      this.sendAction({ type: 'attack', dx, dy })
    })
    kb.addKey(K.X, false).on('down', () => this.sendAction({ type: 'bandage' }))
    kb.addKey(K.J, false).on('down', () => {
      this.registry.set('journalOpen', !this.registry.get('journalOpen'))
    })
    // T : donner 3 baies à l'entité la plus proche (l'acte chaud fondamental).
    kb.addKey(K.T, false).on('down', () => {
      const nearest = [...this.others.entries()]
        .map(([id, r]) => ({ id, d: Math.hypot(r.toX - this.predicted.x, r.toY - this.predicted.y) }))
        .sort((a, b) => a.d - b.d)[0]
      if (nearest && nearest.d < 1.5) {
        this.sendAction({ type: 'give', targetEntityId: nearest.id, item: 'berries', count: 3 })
      }
    })
    kb.addKey(K.G, false).on('down', () => {
      const world = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
      const target = this.structures.find(
        (s) => s.tx === Math.floor(world.x / TILE_PX) && s.ty === Math.floor(world.y / TILE_PX),
      )
      if (target) this.sendAction({ type: 'repair', structureId: target.id })
    })

    // Manger et crafter.
    kb.addKey(K.E, false).on('down', () => this.sendAction({ type: 'eat', item: 'berries' }))
    kb.addKey(K.R, false).on('down', () => this.sendAction({ type: 'eat', item: 'stew' }))
    const craftKeys: [number, RecipeId][] = [
      [K.SIX, 'stew'],
      [K.SEVEN, 'axe'],
      [K.EIGHT, 'pickaxe'],
      [K.NINE, 'iron_ingot'],
      [K.ZERO, 'iron_axe'],
    ]
    for (const [code, recipeId] of craftKeys) {
      kb.addKey(code, false).on('down', () => this.sendAction({ type: 'craft', recipeId }))
    }

    this.ghost = this.add
      .rectangle(0, 0, TILE_PX, TILE_PX, 0xffffff, 0.22)
      .setOrigin(0)
      .setDepth(OVERLAY_DEPTH)
      .setStrokeStyle(1, 0xffffff, 0.5)

    this.input.mouse?.disableContextMenu()
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
      const tx = Math.floor(world.x / TILE_PX)
      const ty = Math.floor(world.y / TILE_PX)
      if (pointer.rightButtonDown()) {
        const target = this.structures.find((s) => s.tx === tx && s.ty === ty)
        if (target) this.sendAction({ type: 'demolish', structureId: target.id })
      } else if (pointer.event.shiftKey) {
        // Shift+clic : faire tourner l'accès d'une structure à soi (partage).
        const target = this.structures.find((s) => s.tx === tx && s.ty === ty)
        if (target) {
          const cycle: Record<AccessLevel, AccessLevel> = { private: 'village', village: 'public', public: 'private' }
          this.sendAction({ type: 'set_access', structureId: target.id, access: cycle[target.access] })
        }
      } else {
        // Priorité au clic : cadavre → nœud vivant → bâtir.
        const corpse = this.corpses.find((c) => Math.floor(c.x) === tx && Math.floor(c.y) === ty)
        const node = this.nodes.find((n) => n.tx === tx && n.ty === ty && n.stock > 0)
        if (corpse) this.sendAction({ type: 'loot_corpse', corpseId: corpse.id })
        else if (node) this.sendAction({ type: 'harvest', nodeId: node.id })
        else this.sendAction({ type: 'build', structure: this.selected, tx, ty })
      }
    })

    // Hook de debug/pilotage (pattern __MANIF__) : smoke tests et futurs bots.
    ;(window as unknown as { __BRAISES__: unknown }).__BRAISES__ = { scene: this }

    this.worker = new Worker(new URL('../worker/sim-worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (e: MessageEvent<HostToClient>) => this.onHostMessage(e.data))
    this.send({
      type: 'init',
      seed: 2026,
      map: this.map,
      calendarScale: 720, // démo : un jour de saison toutes les 2 min
      playerSpawn: PLAYER_SPAWN,
    })
  }

  override update(_time: number, deltaMs: number): void {
    const dx = this.axis('right', 'left')
    const dy = this.axis('down', 'up')
    const sprint = this.sprintKeys.some((k) => k.isDown)
    const block = this.blockKey.isDown

    // Prédiction locale (spec reconciliation R1-R7). `predictFrame` consomme le
    // dt de frame en sous-pas de tick fixes (rejeu exact de la suite de dt du
    // serveur → pas de divergence de coin), numérote chaque input et le bufferise.
    // On transmet à l'hôte un `input` par tick consommé ; la réconciliation par
    // rejeu (dans `onHostMessage`) recalera l'ancre sur l'autorité.
    const world = {
      map: this.map,
      structures: this.structures,
      nodes: this.nodes,
      moverVillageId: this.myVillageId,
    }
    let speedScale = this.myHunger <= 0 ? BALANCE.HUNGER_SPEED_MALUS : 1
    if (this.myWoundedLeg) speedScale *= COMBAT.LEG_WOUND_SPEED
    if (block) speedScale *= COMBAT.BLOCK_MOVE_FACTOR
    else if (sprint && (dx !== 0 || dy !== 0)) speedScale *= COMBAT.SPRINT_FACTOR
    const input: PredictInput = { dx, dy, sprint, block }
    for (const buffered of predictFrame(this.prediction, world, deltaMs / 1000, input, speedScale)) {
      this.send({ type: 'input', seq: buffered.seq, dx, dy, sprint, block })
    }
    // Rendu (R6-R7) : l'écart de correction résiduel fond chaque frame, puis le
    // sprite s'affiche à l'ancre extrapolée du reliquat sous-tick + cet écart —
    // fluide, sans latence, la sim restant exacte.
    decayRenderOffset(this.prediction, RENDER_OFFSET_DECAY)
    const render = renderPosition(this.prediction, world, input, speedScale)
    this.syncSprite(this.playerSprite, render.x, render.y)

    // Le fantôme de construction suit le pointeur, aligné sur la grille.
    const pointer = this.input.activePointer
    const pw = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
    this.ghost.setPosition(Math.floor(pw.x / TILE_PX) * TILE_PX, Math.floor(pw.y / TILE_PX) * TILE_PX)

    // Interpolation des autres entités (R4) : vers le dernier snapshot, sur un tick.
    const now = this.time.now
    for (const o of this.others.values()) {
      const t = Math.min(1, (now - o.startedAt) / INTERP_MS)
      this.syncSprite(o.sprite, o.fromX + (o.toX - o.fromX) * t, o.fromY + (o.toY - o.fromY) * t)
    }

    this.registry.set('zone', zoneAt(this.map, this.predicted.x, this.predicted.y)?.name)

    // Caméra « Foxhole » (R11) : le point suivi se décale vers le curseur pour
    // voir plus loin là où l'on vise. Calcul en ÉCRAN-espace (écart au centre),
    // jamais depuis la position monde du pointeur → pas de boucle caméra↔curseur.
    const off = lookaheadOffset(
      pointer.x, pointer.y, this.scale.width / 2, this.scale.height / 2,
      LOOKAHEAD_STRENGTH, LOOKAHEAD_MAX_TILES, TILE_PX,
    )
    // followOffset est SOUSTRAIT du point suivi → on nie pour pencher VERS le curseur.
    this.cameras.main.setFollowOffset(-off.x, -off.y)
  }

  private onHostMessage(msg: HostToClient): void {
    if (msg.type === 'ready') {
      this.playerId = msg.playerId
      return
    }
    this.registry.set('time', msg.time)
    this.villages = msg.villages
    this.syncStructures(msg.structures)
    this.syncNodes(msg.nodes)
    this.npcs = msg.npcs
    this.monsters = msg.monsters
    this.syncCorpses(msg.corpses)
    const myVillage = msg.villages.find((v) => v.memberIds.includes(this.playerId))
    this.myVillageId = myVillage?.id ?? null
    this.registry.set('village', myVillage?.memberIds.length ?? 0)
    this.registry.set('tasks', myVillage?.tasks ?? [])
    this.registry.set('archetype', myVillage?.archetype ?? null)
    this.registry.set('villageWarmth', myVillage?.warmth ?? 0)
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
    let chronicleDirty = false
    for (const event of msg.events) {
      if (event.type === 'action_rejected' && event.entityId === this.playerId) {
        this.registry.set('error', { reason: event.reason, at: this.time.now })
      } else if (event.type === 'alarm_raised' && event.villageId === this.myVillageId) {
        this.registry.set('alarm', { at: this.time.now })
      }
      if (CHRONICLE_TYPES.has(event.type)) {
        this.eventLog.push(event)
        chronicleDirty = true
        if (event.type === 'evacuation_opened') {
          this.evacMarker?.destroy()
          this.evacMarker = this.add
            .circle(event.tx * TILE_PX + 8, event.ty * TILE_PX + 8, 10, 0xffd94a, 0.6)
            .setStrokeStyle(2, 0xfff2b0)
            .setDepth(OVERLAY_DEPTH)
        }
        if (event.type === 'season_ended') this.registry.set('seasonEnded', true)
      }
    }
    if (chronicleDirty) {
      const names = Object.fromEntries(msg.villages.map((v) => [v.id, v.name]))
      this.registry.set('chronicle', chronicleFromEvents(this.eventLog, 720, names))
    }
    const now = this.time.now
    const seen = new Set<number>()
    for (const entity of msg.entities) {
      if (entity.id === this.playerId) {
        this.registry.set('inv', entity.inventory)
        this.registry.set('hunger', entity.hunger)
        this.registry.set('skills', entity.skills)
        this.registry.set('hp', entity.hp)
        this.registry.set('stamina', entity.stamina)
        this.registry.set('wounds', entity.wounds)
        this.myHunger = entity.hunger
        this.myWoundedLeg = entity.wounds.leg === true
        this.reconcile(entity, msg.lastProcessedInput)
        continue
      }
      seen.add(entity.id)
      const npc = this.npcs.find((n) => n.entityId === entity.id)
      let record = this.others.get(entity.id)
      if (record) {
        record.fromX = record.toX
        record.fromY = record.toY
        record.toX = entity.x
        record.toY = entity.y
        record.startedAt = now
      } else {
        const sprite = this.add.image(0, 0, 'spr-npc')
        this.applyFootprint(sprite, 'spr-npc')
        this.syncSprite(sprite, entity.x, entity.y)
        record = { sprite, fromX: entity.x, fromY: entity.y, toX: entity.x, toY: entity.y, startedAt: now }
        this.others.set(entity.id, record)
      }
      // Les villageois se distinguent des errants et des monstres ; un
      // dormeur s'estompe ; un wind-up flashe (lisibilité, spec R4).
      const monster = this.monsters.find((m) => m.entityId === entity.id)
      if (monster) {
        const key = monster.type === 'zombie' ? 'spr-zombie' : 'spr-boar'
        record.sprite.setTexture(key)
        this.applyFootprint(record.sprite, key)
        record.sprite.setTint(entity.windup ? 0xffffff : 0xdddddd)
      } else {
        record.sprite.setTexture('spr-npc')
        this.applyFootprint(record.sprite, 'spr-npc')
        record.sprite.setTint(entity.windup ? 0xff8866 : npc ? 0xe8d9a0 : 0xffffff)
      }
      record.sprite.setAlpha(npc?.sleeping ? 0.45 : 1)
    }
    for (const [id, o] of this.others) {
      if (!seen.has(id)) {
        o.sprite.destroy()
        this.others.delete(id)
      }
    }
  }

  /** Synchronise les sprites de structures avec le snapshot. */
  private syncStructures(structures: Structure[]): void {
    this.structures = structures
    const seen = new Set<number>()
    for (const s of structures) {
      seen.add(s.id)
      let sprite = this.structureSprites.get(s.id)
      if (!sprite) {
        sprite = this.add
          .image(s.tx * TILE_PX, s.ty * TILE_PX, `st-${s.type}`)
          .setOrigin(0)
          .setDepth(s.type === 'fire' ? 5 : structureDepth(s.ty))
        this.structureSprites.set(s.id, sprite)
      }
      if (s.type === 'fire') {
        // La couleur du Feu (spec alignement R9) : bleu ↔ blanc ↔ rouge.
        const warmth = this.villages.find((v) => v.id === s.villageId)?.warmth ?? 0
        const t = Math.max(-1, Math.min(1, warmth / 100))
        const r = t > 0 ? Math.floor(255 - 130 * t) : 255
        const g = Math.floor(255 - 90 * Math.abs(t))
        const b = t < 0 ? Math.floor(255 + 140 * t) : 255
        sprite.setTint(Phaser.Display.Color.GetColor(r, g, b))
      } else {
        // Une structure endommagée s'assombrit et rougit — lisible de loin.
        const ratio = Math.max(0, Math.min(1, s.hp / STRUCTURE_HP[s.type]))
        const shade = Math.floor(140 + 115 * ratio)
        sprite.setTint(Phaser.Display.Color.GetColor(255, shade, shade))
      }
    }
    for (const [id, sprite] of this.structureSprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.structureSprites.delete(id)
      }
    }
  }

  /** Synchronise les sprites de nœuds : un nœud épuisé s'estompe. */
  private syncNodes(nodes: ResourceNode[]): void {
    this.nodes = nodes
    for (const n of nodes) {
      let sprite = this.nodeSprites.get(n.id)
      if (!sprite) {
        sprite = this.add.image(n.tx * TILE_PX, n.ty * TILE_PX, `nd-${n.type}`).setOrigin(0).setDepth(4)
        this.nodeSprites.set(n.id, sprite)
      }
      sprite.setAlpha(n.stock > 0 ? 1 : 0.25)
    }
  }

  private syncCorpses(corpses: Corpse[]): void {
    this.corpses = corpses
    const seen = new Set<number>()
    for (const c of corpses) {
      seen.add(c.id)
      if (!this.corpseSprites.has(c.id)) {
        const sprite = this.add.image(c.x * TILE_PX, c.y * TILE_PX, 'spr-corpse').setDepth(3)
        this.corpseSprites.set(c.id, sprite)
      }
    }
    for (const [id, sprite] of this.corpseSprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.corpseSprites.delete(id)
      }
    }
  }

  /**
   * Réconciliation par rejeu (spec reconciliation R3-R6) : purge les inputs
   * acquittés, pose l'ancre sur l'autorité et rejoue les inputs en attente. La
   * sim reste exacte ; l'écart de correction va dans `renderOffset` (lissé au
   * rendu), et au-delà du seuil de snap c'est un vrai téléport (respawn au Feu).
   */
  private reconcile(authoritative: Entity, lastProcessedInput: number): void {
    const world = {
      map: this.map,
      structures: this.structures,
      nodes: this.nodes,
      moverVillageId: this.myVillageId,
    }
    reconcilePrediction(
      this.prediction,
      world,
      { x: authoritative.x, y: authoritative.y },
      lastProcessedInput,
      SNAP_DISTANCE_TILES,
    )
  }

  private axis(plus: 'right' | 'down', minus: 'left' | 'up'): -1 | 0 | 1 {
    const p = this.keys[plus].some((k) => k.isDown)
    const m = this.keys[minus].some((k) => k.isDown)
    if (p === m) return 0
    return p ? 1 : -1
  }

  private syncSprite(sprite: Phaser.GameObjects.Image, x: number, y: number): void {
    const p = actorPlacement(x, y, DEFAULT_FOOTPRINT, TILE_PX, BALANCE.AVATAR_HITBOX_TILES)
    sprite.setPosition(p.px, p.py)
    sprite.setDepth(p.depth)
  }

  /** Applique l'emprise visuelle d'un acteur (R12) : origine PIEDS + taille
   * d'affichage en tuiles. À rappeler après chaque `setTexture` (setDisplaySize
   * dépend de la frame courante). */
  private applyFootprint(sprite: Phaser.GameObjects.Image, textureKey: string): void {
    const fp = ACTOR_FOOTPRINTS[textureKey] ?? DEFAULT_FOOTPRINT
    sprite.setOrigin(0.5, 1)
    sprite.setDisplaySize(fp.widthTiles * TILE_PX, fp.heightTiles * TILE_PX)
  }

  private send(msg: ClientToHost): void {
    this.worker.postMessage(msg)
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
}
