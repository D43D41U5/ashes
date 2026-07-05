/**
 * La scène de jeu : rendu de la vallée, avatar prédit, entités interpolées.
 *
 * Le client est « bête » (spec client R3-R5) : la sim tourne dans le Worker,
 * ici on envoie des intentions et on interpole des snapshots. La seule
 * logique partagée est `moveAvatar` de /sim, rejouée pour la prédiction
 * locale de son propre avatar.
 */
import {
  BALANCE,
  moveAvatar,
  zoneAt,
  type Entity,
  type PlayerAction,
  type RecipeId,
  type ResourceNode,
  type Structure,
  type WorldMap,
} from '@braises/sim'
import Phaser from 'phaser'
import { createDemoMap, DEMO_MAP_SIZE, PLAYER_SPAWN } from '../demo-map'
import type { ClientToHost, HostToClient } from '../protocol'

type Buildable = 'wall' | 'door' | 'chest' | 'workshop' | 'furnace'
const BUILD_KEYS: Buildable[] = ['wall', 'door', 'chest', 'workshop', 'furnace']

const TILE_PX = 16
const INTERP_MS = 1000 / BALANCE.TICK_RATE_HZ
/** Écart prédiction/autorité au-delà duquel on snap (spec client R5). */
const SNAP_DISTANCE_TILES = 1.5

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
  private predicted = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y }
  private others = new Map<number, InterpolatedSprite>()
  private lastSentInput = { dx: 0, dy: 0 }
  private keys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key[]>
  private structures: Structure[] = []
  private structureSprites = new Map<number, Phaser.GameObjects.Image>()
  private nodes: ResourceNode[] = []
  private nodeSprites = new Map<number, Phaser.GameObjects.Image>()
  private myVillageId: number | null = null
  private myHunger = 100
  private selected: Buildable = 'wall'
  private ghost!: Phaser.GameObjects.Rectangle

  constructor() {
    super('world')
  }

  create(): void {
    this.map = createDemoMap()
    this.bakeMapTexture()
    this.add.image(0, 0, 'map-demo').setOrigin(0)

    this.playerSprite = this.add.image(0, 0, 'spr-player').setDepth(10)
    this.syncSprite(this.playerSprite, this.predicted.x, this.predicted.y)

    const worldPx = DEMO_MAP_SIZE * TILE_PX
    this.cameras.main.setBounds(0, 0, worldPx, worldPx)
    this.cameras.main.startFollow(this.playerSprite, true, 0.12, 0.12).setZoom(2)
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
      .setDepth(8)
      .setStrokeStyle(1, 0xffffff, 0.5)

    this.input.mouse?.disableContextMenu()
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2
      const tx = Math.floor(world.x / TILE_PX)
      const ty = Math.floor(world.y / TILE_PX)
      if (pointer.rightButtonDown()) {
        const target = this.structures.find((s) => s.tx === tx && s.ty === ty)
        if (target) this.sendAction({ type: 'demolish', structureId: target.id })
      } else {
        // Un nœud vivant sous le clic → récolter ; sinon → bâtir.
        const node = this.nodes.find((n) => n.tx === tx && n.ty === ty && n.stock > 0)
        if (node) this.sendAction({ type: 'harvest', nodeId: node.id })
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

    if (dx !== this.lastSentInput.dx || dy !== this.lastSentInput.dy) {
      this.lastSentInput = { dx, dy }
      this.send({ type: 'input', dx, dy })
    }

    // Prédiction locale (R5) : même code que la sim, au dt de la frame —
    // structures, nœuds, appartenance et faim compris.
    const world = {
      map: this.map,
      structures: this.structures,
      nodes: this.nodes,
      moverVillageId: this.myVillageId,
    }
    const speedScale = this.myHunger <= 0 ? BALANCE.HUNGER_SPEED_MALUS : 1
    const moved = moveAvatar(world, this.predicted.x, this.predicted.y, dx, dy, deltaMs / 1000, speedScale)
    this.predicted = moved
    this.syncSprite(this.playerSprite, moved.x, moved.y)

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
  }

  private onHostMessage(msg: HostToClient): void {
    if (msg.type === 'ready') {
      this.playerId = msg.playerId
      return
    }
    this.registry.set('time', msg.time)
    this.syncStructures(msg.structures)
    this.syncNodes(msg.nodes)
    this.myVillageId = msg.villages.find((v) => v.memberIds.includes(this.playerId))?.id ?? null
    this.registry.set(
      'village',
      msg.villages.find((v) => v.id === this.myVillageId)?.memberIds.length ?? 0,
    )
    for (const event of msg.events) {
      if (event.type === 'action_rejected' && event.entityId === this.playerId) {
        this.registry.set('error', { reason: event.reason, at: this.time.now })
      }
    }
    const now = this.time.now
    const seen = new Set<number>()
    for (const entity of msg.entities) {
      if (entity.id === this.playerId) {
        this.registry.set('inv', entity.inventory)
        this.registry.set('hunger', entity.hunger)
        this.registry.set('skills', entity.skills)
        this.myHunger = entity.hunger
        this.reconcile(entity)
        continue
      }
      seen.add(entity.id)
      const existing = this.others.get(entity.id)
      if (existing) {
        existing.fromX = existing.toX
        existing.fromY = existing.toY
        existing.toX = entity.x
        existing.toY = entity.y
        existing.startedAt = now
      } else {
        const sprite = this.add.image(0, 0, 'spr-npc').setDepth(9)
        this.syncSprite(sprite, entity.x, entity.y)
        this.others.set(entity.id, {
          sprite,
          fromX: entity.x,
          fromY: entity.y,
          toX: entity.x,
          toY: entity.y,
          startedAt: now,
        })
      }
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
      if (!this.structureSprites.has(s.id)) {
        const sprite = this.add
          .image(s.tx * TILE_PX, s.ty * TILE_PX, `st-${s.type}`)
          .setOrigin(0)
          .setDepth(s.type === 'fire' ? 5 : 6)
        this.structureSprites.set(s.id, sprite)
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

  /** Réconciliation douce vers la position autoritative (R5). */
  private reconcile(authoritative: Entity): void {
    const ex = authoritative.x - this.predicted.x
    const ey = authoritative.y - this.predicted.y
    const distSq = ex * ex + ey * ey
    if (distSq > SNAP_DISTANCE_TILES * SNAP_DISTANCE_TILES) {
      this.predicted = { x: authoritative.x, y: authoritative.y }
    } else {
      this.predicted = { x: this.predicted.x + ex * 0.2, y: this.predicted.y + ey * 0.2 }
    }
  }

  private axis(plus: 'right' | 'down', minus: 'left' | 'up'): -1 | 0 | 1 {
    const p = this.keys[plus].some((k) => k.isDown)
    const m = this.keys[minus].some((k) => k.isDown)
    if (p === m) return 0
    return p ? 1 : -1
  }

  private syncSprite(sprite: Phaser.GameObjects.Image, x: number, y: number): void {
    sprite.setPosition(x * TILE_PX, y * TILE_PX)
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
