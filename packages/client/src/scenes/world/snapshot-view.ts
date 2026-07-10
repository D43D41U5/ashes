/**
 * La vue du snapshot : les sprites qui MIROIRENT l'état reçu de l'hôte
 * (structures, nœuds, cadavres, autres entités interpolées) et leur cycle de
 * vie — création, mise à jour, destruction par diff d'ids `seen`. Extrait de
 * `WorldScene` : la scène délègue, ce module possède l'état des sprites.
 * AUCUNE logique de jeu ici — uniquement du rendu d'état reçu (spec client R4).
 */
import {
  BALANCE,
  STRUCTURE_HP,
  type Corpse,
  type Entity,
  type Monster,
  type Npc,
  type ResourceNode,
  type Structure,
} from '@braises/sim'
import Phaser from 'phaser'
import type { NodeDelta, SnapshotMessage } from '../../protocol'
import {
  actorPlacement,
  corpseDepth,
  crownAlpha,
  crownDepth,
  GROUND_FIRE_DEPTH,
  nodeDepth,
  structureDepth,
  tileFeetAnchor,
  TILE_PX,
  type ActorFootprint,
} from '../../render/framing'
import { warmthColor } from '../../render/lighting'

/** Interpolation des autres entités : vers le dernier snapshot, sur un tick (R4). */
const INTERP_MS = 1000 / BALANCE.TICK_RATE_HZ

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
/** Clé d'index tuile→nœud : `tx * STRIDE + ty`. STRIDE > toute coordonnée de
 * tuile (carte alpine pleine ≤ 3600) → injectif, pas de collision de clé. */
const NODE_TILE_STRIDE = 1_000_000

export interface InterpolatedSprite {
  sprite: Phaser.GameObjects.Image
  /** Clé de texture courante — évite setTexture/re-dimensionnement inutiles. */
  textureKey: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  startedAt: number
}

export class SnapshotView {
  /** Dernier état reçu — lu par la prédiction (collisions) et les inputs. */
  structures: Structure[] = []
  nodes: ResourceNode[] = []
  corpses: Corpse[] = []
  npcs: Npc[] = []
  monsters: Monster[] = []
  villages: SnapshotMessage['villages'] = []
  /** Les autres entités (tout sauf l'avatar local, qui est prédit). */
  readonly others = new Map<number, InterpolatedSprite>()

  private structureSprites = new Map<number, Phaser.GameObjects.Image>()
  /** Sprites de nœuds POOLÉS, culled à la vue : la carte porte ~60k nœuds, on
   * n'en dessine que les ~centaines visibles (même trick que le décor). */
  private nodePool: Phaser.GameObjects.Image[] = []
  /** Pool SÉPARÉ : un arbre est deux sprites (tronc trié avec les acteurs,
   * houppier dans sa bande propre). Les autres nœuds n'en consomment aucun. */
  private crownPool: Phaser.GameObjects.Image[] = []
  /** Index id→nœud pour appliquer les deltas de stock en O(1). */
  private nodeById = new Map<number, ResourceNode>()
  /** Index tuile→nœud (≤1 nœud/tuile) : le rendu n'itère que la fenêtre caméra,
   * pas les ~140k nœuds — coût par frame borné à la vue, comme le décor. */
  private nodeByTile = new Map<number, ResourceNode>()
  private corpseSprites = new Map<number, Phaser.GameObjects.Image>()

  constructor(private scene: Phaser.Scene) {}

  /** Applique un snapshot complet — hors avatar local (prédit par la scène). */
  apply(msg: SnapshotMessage, playerId: number, now: number): void {
    this.villages = msg.villages
    this.npcs = msg.npcs
    this.monsters = msg.monsters
    this.syncStructures(msg.structures)
    this.applyNodeDeltas(msg.nodeDeltas)
    this.syncCorpses(msg.corpses)
    this.syncEntities(msg.entities, playerId, now)
  }

  /** Fait glisser les autres entités vers leur dernière position connue (R4). */
  interpolate(now: number): void {
    for (const o of this.others.values()) {
      const t = Math.min(1, (now - o.startedAt) / INTERP_MS)
      this.syncActor(o.sprite, o.fromX + (o.toX - o.fromX) * t, o.fromY + (o.toY - o.fromY) * t, o.textureKey)
    }
  }

  /** Place un acteur (R12 + R13) en consommant TOUT l'`ActorPlacement` :
   * position pieds, depth Y-sort et taille d'affichage — l'emprise réelle est
   * déduite de la texture. `setDisplaySize` dépend de la frame courante : le
   * rappeler ici, chaque frame, couvre aussi les changements de texture. */
  syncActor(sprite: Phaser.GameObjects.Image, x: number, y: number, textureKey: string): void {
    const footprint = ACTOR_FOOTPRINTS[textureKey] ?? DEFAULT_FOOTPRINT
    const p = actorPlacement(x, y, footprint, TILE_PX, BALANCE.AVATAR_HITBOX_TILES)
    sprite.setPosition(p.px, p.py)
    sprite.setDepth(p.depth)
    sprite.setDisplaySize(p.displayW, p.displayH)
  }

  private syncEntities(entities: Entity[], playerId: number, now: number): void {
    const seen = new Set<number>()
    // Index par entityId, UNE fois par snapshot — le `.find` par entité était
    // O(N×M) à chaque snapshot.
    const npcByEntity = new Map(this.npcs.map((n) => [n.entityId, n]))
    const monsterByEntity = new Map(this.monsters.map((m) => [m.entityId, m]))
    for (const entity of entities) {
      if (entity.id === playerId) continue
      seen.add(entity.id)
      let record = this.others.get(entity.id)
      if (record) {
        record.fromX = record.toX
        record.fromY = record.toY
        record.toX = entity.x
        record.toY = entity.y
        record.startedAt = now
      } else {
        const sprite = this.scene.add.image(0, 0, 'spr-npc').setOrigin(0.5, 1)
        this.syncActor(sprite, entity.x, entity.y, 'spr-npc')
        record = {
          sprite,
          textureKey: 'spr-npc',
          fromX: entity.x,
          fromY: entity.y,
          toX: entity.x,
          toY: entity.y,
          startedAt: now,
        }
        this.others.set(entity.id, record)
      }
      // Les villageois se distinguent des errants et des monstres ; un
      // dormeur s'estompe ; un wind-up flashe (lisibilité, spec R4).
      const npc = npcByEntity.get(entity.id)
      const monster = monsterByEntity.get(entity.id)
      const key = monster ? (monster.type === 'zombie' ? 'spr-zombie' : 'spr-boar') : 'spr-npc'
      if (record.textureKey !== key) {
        // setTexture réinitialise la frame : ne le rappeler que si la texture
        // change vraiment. `syncActor` re-applique aussitôt l'emprise (R12).
        record.sprite.setTexture(key)
        record.textureKey = key
        this.syncActor(record.sprite, record.toX, record.toY, key)
      }
      record.sprite.setTint(
        monster ? (entity.windup ? 0xffffff : 0xdddddd) : entity.windup ? 0xff8866 : npc ? 0xe8d9a0 : 0xffffff,
      )
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
        // Ancrage PIEDS : un toit de maison plus haut que sa tuile montera sans
        // décaler son tri ni son emprise logique. Le Feu, lui, est un foyer à
        // plat — il reste sous la bande, on marche autour, jamais derrière.
        const a = tileFeetAnchor(s.tx, s.ty, TILE_PX)
        sprite = this.scene.add
          .image(a.px, a.py, `st-${s.type}`)
          .setOrigin(0.5, 1)
          .setDepth(s.type === 'fire' ? GROUND_FIRE_DEPTH : structureDepth(s.ty, TILE_PX))
        this.structureSprites.set(s.id, sprite)
      }
      if (s.type === 'fire') {
        // La couleur du Feu (spec alignement R9) : bleu ↔ blanc ↔ rouge. Même
        // formule que les halos de lumière (module pur `lighting`).
        const warmth = this.villages.find((v) => v.id === s.villageId)?.warmth ?? 0
        sprite.setTint(warmthColor(warmth))
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

  /** Reçoit la liste COMPLÈTE des nœuds (message `ready`, une fois) et l'indexe
   * par id (deltas O(1)) ET par tuile (rendu culled O(1)/tuile visible). La
   * carte en porte ~140k ; positions figées au runtime. */
  setNodes(nodes: ResourceNode[]): void {
    this.nodes = nodes
    this.nodeById = new Map(nodes.map((n) => [n.id, n]))
    this.nodeByTile = new Map(nodes.map((n) => [n.tx * NODE_TILE_STRIDE + n.ty, n]))
  }

  /** Applique les changements de stock reçus par tick (récolte/repousse). Le jeu
   * de nœuds est stable au runtime : seul `stock` bouge, jamais d'ajout/retrait. */
  private applyNodeDeltas(deltas: NodeDelta[]): void {
    for (const d of deltas) {
      const n = this.nodeById.get(d.id)
      if (n) n.stock = d.stock
    }
  }

  /** Dessine les nœuds visibles (pool réutilisé). N'itère que la FENÊTRE de
   * tuiles caméra (≤1 nœud/tuile via l'index) — coût borné à la vue, jamais
   * O(nombre total de nœuds). Appelé chaque frame ; un nœud épuisé s'estompe.
   *
   * Un arbre est DEUX sprites : le tronc (opaque, trié avec les acteurs) et le
   * houppier (bande propre, alpha du disque de découvert). `playerX/playerY` sont
   * la position LOGIQUE de l'avatar en tuiles : le disque suit l'avatar, pas la
   * caméra, sinon il glisserait avec le lookahead du pointeur. */
  renderNodes(camera: Phaser.Cameras.Scene2D.Camera, playerX: number, playerY: number): void {
    const v = camera.worldView
    // La fenêtre s'élargit : 3 rangées vers le BAS (les cimes des arbres plantés
    // sous le bord de l'écran montent dans la vue) et 1 colonne de chaque côté
    // (le houppier déborde d'une demi-tuile).
    const tx0 = Math.floor(v.x / TILE_PX) - 2
    const ty0 = Math.floor(v.y / TILE_PX) - 1
    const tx1 = Math.ceil((v.x + v.width) / TILE_PX) + 2
    const ty1 = Math.ceil((v.y + v.height) / TILE_PX) + 4
    const feetY = playerY + BALANCE.AVATAR_HITBOX_TILES / 2
    let used = 0
    let crownsUsed = 0
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const n = this.nodeByTile.get(tx * NODE_TILE_STRIDE + ty)
        if (n === undefined) continue
        const isTree = n.type === 'tree'
        const texture = isTree ? 'nd-tree_trunk' : `nd-${n.type}`
        let sprite = this.nodePool[used]
        if (!sprite) {
          sprite = this.scene.add.image(0, 0, texture).setOrigin(0.5, 1)
          this.nodePool[used] = sprite
        }
        const a = tileFeetAnchor(tx, ty, TILE_PX)
        sprite.setPosition(a.px, a.py)
        // Le sprite est POOLÉ : sa depth suit la tuile qu'il occupe cette frame,
        // jamais celle où il a été créé.
        sprite.setDepth(nodeDepth(ty, TILE_PX))
        sprite.setTexture(texture)
        // Le tronc reste OPAQUE en toutes circonstances : les troncs dessinent la
        // structure de la forêt, ce sont les houppiers qui s'ouvrent.
        sprite.setAlpha(n.stock > 0 ? 1 : 0.25)
        sprite.setVisible(true)
        used++
        if (!isTree) continue

        // Le houppier : ancré 6 px sous le sommet du tronc (22 px), donc à py−16.
        let crown = this.crownPool[crownsUsed]
        if (!crown) {
          crown = this.scene.add.image(0, 0, 'nd-tree_crown').setOrigin(0.5, 1)
          this.crownPool[crownsUsed] = crown
        }
        crown.setPosition(a.px, a.py - 16)
        crown.setDepth(crownDepth(ty + 1, TILE_PX))
        // Distance des pieds du joueur au PIED DU TRONC : l'arbre à ton contact
        // s'efface, celui dont la cime te survole de loin reste opaque.
        const dx = playerX - (tx + 0.5)
        const dy = feetY - (ty + 1)
        const d = Math.sqrt(dx * dx + dy * dy)
        crown.setAlpha(n.stock > 0 ? crownAlpha(d) : 0.25)
        crown.setVisible(true)
        crownsUsed++
      }
    }
    for (let i = used; i < this.nodePool.length; i++) this.nodePool[i]!.setVisible(false)
    for (let i = crownsUsed; i < this.crownPool.length; i++) this.crownPool[i]!.setVisible(false)
  }

  private syncCorpses(corpses: Corpse[]): void {
    this.corpses = corpses
    const seen = new Set<number>()
    for (const c of corpses) {
      seen.add(c.id)
      if (!this.corpseSprites.has(c.id)) {
        // Ossements à plat : centrés sur la position de l'entité (pas d'ancrage
        // pieds), mais dans la bande de tri — un buisson au sud les recouvre.
        const sprite = this.scene.add
          .image(c.x * TILE_PX, c.y * TILE_PX, 'spr-corpse')
          .setOrigin(0.5, 0.5)
          .setDepth(corpseDepth(c.y, TILE_PX))
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
}
