/**
 * La vue du snapshot : les sprites qui MIROIRENT l'état reçu de l'hôte
 * (structures, nœuds, cadavres, autres entités interpolées) et leur cycle de
 * vie — création, mise à jour, destruction par diff d'ids `seen`. Extrait de
 * `WorldScene` : la scène délègue, ce module possède l'état des sprites.
 * AUCUNE logique de jeu ici — uniquement du rendu d'état reçu (spec client R4).
 */
import {
  activityAt,
  BALANCE,
  FAUNA,
  HUNT,
  sentinelOf,
  STRUCTURE_HP,
  treeJitter,
  type Corpse,
  type Entity,
  type Monster,
  type MonsterType,
  type Npc,
  type ResourceNode,
  type Structure,
} from '@braises/sim'
import Phaser from 'phaser'
import { windSway } from '../../render/wind'
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
import { shakeOffset, type HitFx } from './hit-fx'

/** Le nœud VISÉ à portée s'éclaire d'or ; hors de portée, il se grise (G4). */
const AIM_TINT = 0xffe9a8
const AIM_TINT_FAR = 0x8a8a92

/** Combien de temps le TROU reste visible après qu'un lapin y est rentré (C16).
 *  Assez pour qu'on comprenne où il est passé — pas assez pour joncher la carte. */
const ESCAPE_LINGER_MS = 6000

/** Interpolation des autres entités : vers le dernier snapshot, sur un tick (R4). */
const INTERP_MS = 1000 / BALANCE.TICK_RATE_HZ

/** Emprise VISUELLE par texture d'acteur (tuiles) — R12. Découplée de la
 * résolution native de l'art : un placeholder 12×12 rend ici à ces proportions.
 * L'emprise logique (collision/clic) reste AVATAR_HITBOX_TILES, inchangée.
 * `facesRight` : le sens dans lequel la silhouette est DESSINÉE — le flip du
 * regard (spec R9bis : la bête regarde où elle va) s'en déduit. */
const ACTOR_FOOTPRINTS: Record<string, ActorFootprint & { facesRight?: boolean }> = {
  'spr-player': { widthTiles: 1, heightTiles: 1.6 },
  'spr-npc': { widthTiles: 1, heightTiles: 1.6 },
  'spr-zombie': { widthTiles: 1, heightTiles: 1.6 },
  // Le gibier (spec faune) : sa TAILLE est la première information, et sa
  // POSTURE est la seconde (R9bis/C19) — tête au sol elle broute, tête dressée
  // elle a vu quelque chose, corps tendu elle fuit. Le lapin rase le sol, le
  // cerf domine le joueur — on sait ce qu'on approche, et dans quel état c'est.
  'spr-boar': { widthTiles: 1.5, heightTiles: 1 },
  'spr-boar-root': { widthTiles: 1.5, heightTiles: 1 },
  'spr-boar-charge': { widthTiles: 1.65, heightTiles: 0.85 },
  'spr-deer': { widthTiles: 1.4, heightTiles: 1.8, facesRight: true },
  'spr-deer-graze': { widthTiles: 1.4, heightTiles: 1.4, facesRight: true },
  'spr-deer-flee': { widthTiles: 1.75, heightTiles: 1.35, facesRight: true },
  'spr-deer-bed': { widthTiles: 1.4, heightTiles: 0.95, facesRight: true },
  'spr-rabbit': { widthTiles: 0.6, heightTiles: 0.6, facesRight: true },
  'spr-rabbit-graze': { widthTiles: 0.6, heightTiles: 0.45, facesRight: true },
  'spr-rabbit-flee': { widthTiles: 0.8, heightTiles: 0.45, facesRight: true },
  'spr-wolf': { widthTiles: 1.5, heightTiles: 1.15 },
  'spr-wolf-stalk': { widthTiles: 1.5, heightTiles: 0.8 },
  'spr-wolf-eat': { widthTiles: 1.45, heightTiles: 1 },
  // L'alpha DÉBORDE : il est visiblement plus gros que les siens. C'est le
  // signal qui rend la règle jouable — on ne peut pas le rater dans la meute.
  'spr-wolf-alpha': { widthTiles: 2, heightTiles: 1.55 },
}
const DEFAULT_FOOTPRINT: ActorFootprint = { widthTiles: 1, heightTiles: 1.6 }

/** Combien la canopée prend le vent (voir render/wind.ts). Un houppier est lourd :
 * il oscille moins qu'un roseau, mais il est large, donc ça se voit. */
const CROWN_WIND_TAKE = 0.5

/** Chaque type de monstre a sa texture — exhaustif, donc un nouveau type ne
 * peut pas se glisser dans le monde déguisé en sanglier. */
const MONSTER_TEXTURES: Record<MonsterType, string> = {
  zombie: 'spr-zombie',
  cendreux: 'spr-cendreux',
  boar: 'spr-boar',
  deer: 'spr-deer',
  rabbit: 'spr-rabbit',
  wolf: 'spr-wolf',
}

/**
 * LA COULEUR DIT L'INTENTION. Les règles les plus intéressantes de la faune sont
 * des ÉTATS — le sanglier qui fouge est approchable, celui qui menace est sur le
 * point de charger, le loup qui rampe ne vous a pas encore vu. Sans un signal
 * visible, ces règles n'existent pas pour le joueur : il se fait encorner sans
 * comprendre, et le jeu passe pour injuste.
 *
 * L'art est provisoire (tout est généré au boot), donc le signal l'est aussi :
 * une teinte. Quand la direction artistique arrivera, ce sera une posture — tête
 * baissée, échine hérissée, ventre au sol — et cette fonction disparaîtra.
 */
/**
 * La palette des ÉTATS de bête — exportée pour que le smoke test (`--scenario
 * chasse`) lise la même vérité que l'écran, au lieu de recopier des hexas.
 */
export const BEAST_TINTS = {
  bleeding: 0xc4523f, // ELLE SAIGNE (chasse C8) : suivez le sang — elle est à vous
  menace: 0xff6a4a, // il MENACE : reculez — dernière seconde
  winded: 0x9aa8b4, // il souffle : frappez
  rooting: 0x8a7a5a, // il fouge, groin au sol : approchez
  eating: 0x8a7a5a, // il mange, tête dans la carcasse (ou l'appât) : la fenêtre
  stalking: 0x7a8290, // le loup rampe : il ne vous a pas encore choisi
  alert: 0xff9d54, // ALERTÉE : tendue, prête à partir — plus de coup propre (C6)
  curious: 0xffe9a0, // CURIEUSE : tête levée, elle vous regarde — figez-vous
  grazing: 0xdddddd,
} as const

function beastTint(monster: Monster | undefined, windup: boolean, isNpc: boolean, tick: number): number {
  if (!monster) return windup ? 0xff8866 : isNpc ? 0xe8d9a0 : 0xffffff

  // LE SANG PRIME SUR TOUT (spec chasse C8). Une bête qui saigne est une bête
  // qu'on TRAQUE : c'est l'information la plus chère de l'écran, elle passe
  // devant l'humeur. (Et la posture, elle, dit déjà si elle fuit ou si elle est
  // tapie — les deux signaux ne se marchent pas dessus.)
  if (monster.bleedMortal || (monster.bleedUntil !== undefined && tick < monster.bleedUntil)) {
    return BEAST_TINTS.bleeding
  }

  // Le sanglier (spec faune R14) — les trois secondes qui décident de tout.
  if (monster.threatSince !== undefined) return BEAST_TINTS.menace
  if (monster.windedUntil !== undefined) return BEAST_TINTS.winded
  if (monster.rootUntil !== undefined) return BEAST_TINTS.rooting

  // Le repas (R15/C18) : tête dans la carcasse — ou dans l'appât qu'on vient de
  // lui poser. Depuis la mise à mort propre (C6), c'est une fenêtre qui se paie.
  if (monster.eatingUntil !== undefined || monster.baitUntil !== undefined) return BEAST_TINTS.eating

  // Le loup en traque (R11) : tapi, il se fond dans le sous-bois. On le distingue
  // mal — c'est le propos, et c'est loyal : il est là, à qui sait regarder.
  if (monster.stalking) return BEAST_TINTS.stalking

  // LA MÉFIANCE (spec chasse C1/C19) : la bête EST la jauge. Pas de barre
  // flottante — trois teintes, dérivées des seuils de BALANCE. CURIEUSE dit
  // « figez-vous » (la jauge redescendra) ; ALERTÉE dit « trop tard pour le
  // coup propre » — c'est l'information que le chasseur paie de son approche.
  if (monster.suspicion >= HUNT.SUSPICION_ALERT) return BEAST_TINTS.alert
  if (monster.suspicion >= HUNT.SUSPICION_CURIOUS) return BEAST_TINTS.curious

  return windup ? 0xffffff : BEAST_TINTS.grazing
}

/**
 * LA SILHOUETTE TASSÉE (spec chasse C19). Qui se fait discret se PLIE : le
 * rampeur (`gait: sneak`) perd un quart de sa hauteur — les pieds ne bougent
 * pas, c'est le corps qui descend. Les BÊTES, elles, ont désormais de vraies
 * POSTURES (`beastTexture`) ; seul l'alpha garde l'écrasement (sa silhouette
 * propre n'a pas de variante tapie, et c'est lui qu'on doit reconnaître).
 */
export const CROUCH_FACTOR = 0.72

function isCrouched(monster: Monster | undefined, entity: Entity): boolean {
  if (!monster) return entity.gait === 'sneak'
  return monster.alpha === true && (monster.stalking === true || monster.eatingUntil !== undefined)
}

/**
 * LA POSTURE DIT L'ÉTAT (spec faune R9bis / chasse C19). Avant la teinte, avant
 * tout : la SILHOUETTE. Tête au sol = elle broute (approchez) ; tête dressée =
 * elle a vu quelque chose (figez-vous) — c'est aussi la posture de la
 * SENTINELLE ; corps tendu à l'horizontale = elle fuit ; couchée = elle dort
 * (réveillable, R10). Le sanglier fouge ou charge, le loup rampe ou mange.
 */
function beastTexture(monster: Monster, sentinel: boolean, hour: number): string {
  if (monster.type === 'boar') {
    if (monster.chargeUntil !== undefined) return 'spr-boar-charge'
    if (monster.rootUntil !== undefined) return 'spr-boar-root'
    return 'spr-boar'
  }
  if (monster.type === 'wolf') {
    if (monster.alpha) return 'spr-wolf-alpha' // sa silhouette EST son identité : on n'y touche pas
    if (monster.eatingUntil !== undefined) return 'spr-wolf-eat'
    if (monster.stalking) return 'spr-wolf-stalk'
    return 'spr-wolf'
  }
  if (monster.type === 'deer' || monster.type === 'rabbit') {
    const base = monster.type === 'deer' ? 'spr-deer' : 'spr-rabbit'
    if (monster.fleeSince >= 0) return `${base}-flee`
    // LA BÊTE TAPIE (spec chasse C11) : à bout de sang, couchée dans un fourré.
    // Même posture que le sommeil — mais la teinte, elle, dira le sang.
    if (monster.bedded && monster.type === 'deer') return 'spr-deer-bed'
    // Tête dressée : la garde, ou une bête qui a repéré quelque chose. Celle qui
    // MANGE un appât (C18), elle, a la tête dans l'herbe : posture de broutage.
    if (monster.baitUntil === undefined && (sentinel || monster.suspicion >= HUNT.SUSPICION_CURIOUS)) return base
    // Hors de ses heures, le cerf se COUCHE (le lapin tassé broute pareil).
    if (monster.type === 'deer' && activityAt('deer', hour) < FAUNA.REST_BELOW) return 'spr-deer-bed'
    return `${base}-graze`
  }
  return MONSTER_TEXTURES[monster.type]
}

/** Clé d'index tuile→nœud : `tx * STRIDE + ty`. STRIDE > toute coordonnée de
 * tuile (carte alpine pleine ≤ 3600) → injectif, pas de collision de clé. */
const NODE_TILE_STRIDE = 1_000_000

export interface InterpolatedSprite {
  sprite: Phaser.GameObjects.Image
  /** Clé de texture courante — évite setTexture/re-dimensionnement inutiles. */
  textureKey: string
  /** Silhouette TASSÉE ce snapshot (rampeur, tapi, fougeur) — lue par `interpolate`. */
  crouch: boolean
  fromX: number
  fromY: number
  toX: number
  toY: number
  startedAt: number
}

export class SnapshotView {
  /** Dernier état reçu — lu par la prédiction (collisions) et les inputs. */
  structures: Structure[] = []

  /** Le nœud sous le curseur (spec recolte.md G4), et s'il est à portée de bras. */
  private aimedNodeId: number | null = null
  private aimedInRange = false
  /** La mémoire des coups reçus — pour le tressaillement. Posée par WorldScene. */
  private hitFx?: HitFx

  /** Ce que le curseur vise MAINTENANT. Purement de l'affichage : la sim revalide. */
  setAim(nodeId: number | null, inRange: boolean): void {
    this.aimedNodeId = nodeId
    this.aimedInRange = inRange
  }

  setHitFx(fx: HitFx): void {
    this.hitFx = fx
  }
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
  /** Les gouttes de sang (C9), poolées : la sim les plafonne, le pool suit. */
  private bloodPool: Phaser.GameObjects.Image[] = []
  /** Les terriers de lapin (C16), poolés. */
  private burrowPool: Phaser.GameObjects.Image[] = []
  /** Les piles jetées au sol (C18). */
  private groundSprites = new Map<number, Phaser.GameObjects.Image>()
  /** Relief continu (Task 3) — soulève chaque billboard du sol sous ses pieds. */
  private warp?: import('../../render/warp').Warp

  constructor(private scene: Phaser.Scene) {}

  setWarp(warp: import('../../render/warp').Warp): void {
    this.warp = warp
  }

  /** Le tick et l'heure du dernier snapshot — la posture des bêtes en dépend
   * (sentinelle dérivée du tick, cerf couché hors de ses heures). */
  private tick = 0
  private hour = 12

  /** LE SANG AU SOL (spec chasse C9), LE VENT (C17), LES PILES (C18). */
  blood: SnapshotMessage['blood'] = []
  wind: SnapshotMessage['wind'] = { x: 1, y: 0 }
  groundItems: SnapshotMessage['groundItems'] = []

  /** Applique un snapshot complet — hors avatar local (prédit par la scène). */
  apply(msg: SnapshotMessage, playerId: number, now: number): void {
    this.villages = msg.villages
    this.npcs = msg.npcs
    this.monsters = msg.monsters
    this.tick = msg.tick
    this.hour = msg.time.hourOfCycle
    this.blood = msg.blood
    this.wind = msg.wind
    this.groundItems = msg.groundItems
    this.syncStructures(msg.structures)
    this.applyNodeDeltas(msg.nodeDeltas)
    this.syncCorpses(msg.corpses)
    this.syncEntities(msg.entities, playerId, now)
    this.syncGroundItems()
  }

  /**
   * LES GOUTTES (spec chasse C9). Une piste qu'on SUIT : les fraîches sont vives,
   * les vieilles pâlissent — c'est la seule horloge que le chasseur ait, et elle
   * doit se lire d'un coup d'œil. Poolé : le plafond de la sim (BLOOD_CAP) borne
   * ce que l'on dessine, et le pool ne grandit jamais au-delà.
   */
  renderBlood(): void {
    let used = 0
    for (const b of this.blood) {
      let g = this.bloodPool[used]
      if (!g) {
        g = this.scene.add.image(0, 0, 'fx-blood').setOrigin(0.5, 0.5)
        this.bloodPool[used] = g
      }
      const lift = this.warp?.lift(b.x, b.y) ?? 0
      g.setPosition(b.x * TILE_PX, b.y * TILE_PX - lift)
      g.setDepth(corpseDepth(b.y, TILE_PX) - 1) // au sol, sous tout le reste
      // Elle sèche : de l'écarlate au brun, et elle s'efface.
      const age = Math.max(0, Math.min(1, (this.tick - b.tick) / HUNT.BLOOD_TTL))
      g.setAlpha(0.85 * (1 - age * 0.8))
      g.setScale(1 - age * 0.25)
      g.setVisible(true)
      used++
    }
    for (let i = used; i < this.bloodPool.length; i++) this.bloodPool[i]!.setVisible(false)
  }

  /**
   * LES TERRIERS (spec chasse C16). Le lapin naît avec le sien et il y court
   * quand on le lève. **Sans le trou dessiné, le lapin s'évapore** — et c'est le
   * décor qui avoue. Avec lui, la règle devient une géométrie qu'on LIT : je vois
   * le trou, je vois le lapin, je sais qu'il faut couper la ligne entre les deux.
   *
   * On dessine le terrier de chaque lapin vivant, plus ceux où l'on vient de voir
   * un lapin RENTRER (`markEscape`) — car la sim, elle, a effacé la bête : le
   * trou survivrait mal à son occupant, et le joueur n'aurait rien compris.
   */
  private escapes: { x: number; y: number; at: number }[] = []

  /** Un lapin vient de rentrer ICI (event `prey_escaped`) : le trou reste un moment. */
  markEscape(x: number, y: number, now: number): void {
    this.escapes.push({ x, y, at: now })
  }

  renderBurrows(now: number): void {
    // Les échappées vieillissent (purement visuel — rien de tout ceci n'est de la sim).
    if (this.escapes.length > 0) {
      this.escapes = this.escapes.filter((e) => now - e.at < ESCAPE_LINGER_MS)
    }

    let used = 0
    const draw = (x: number, y: number, alpha: number): void => {
      let g = this.burrowPool[used]
      if (!g) {
        g = this.scene.add.image(0, 0, 'fx-burrow').setOrigin(0.5, 0.5)
        this.burrowPool[used] = g
      }
      const lift = this.warp?.lift(x, y) ?? 0
      g.setPosition(x * TILE_PX, y * TILE_PX - lift)
      g.setDepth(corpseDepth(y, TILE_PX) - 2) // à même le sol, sous les gouttes
      g.setAlpha(alpha)
      g.setVisible(true)
      used++
    }

    for (const m of this.monsters) {
      if (m.burrowX === undefined || m.burrowY === undefined) continue
      draw(m.burrowX, m.burrowY, 0.9)
    }
    // Le trou où l'on vient de le perdre : il s'efface lentement, comme un regret.
    for (const e of this.escapes) {
      draw(e.x, e.y, 0.9 * (1 - (now - e.at) / ESCAPE_LINGER_MS))
    }
    for (let i = used; i < this.burrowPool.length; i++) this.burrowPool[i]!.setVisible(false)
  }

  /** LES PILES AU SOL (C18) : ce qu'on a jeté existe, et ça se voit. */
  private syncGroundItems(): void {
    const seen = new Set<number>()
    for (const p of this.groundItems) {
      seen.add(p.id)
      let sprite = this.groundSprites.get(p.id)
      if (!sprite) {
        const lift = this.warp?.lift(p.x, p.y) ?? 0
        sprite = this.scene.add
          .image(p.x * TILE_PX, p.y * TILE_PX - lift, `it-${p.item}`)
          .setOrigin(0.5, 0.5)
          .setDepth(corpseDepth(p.y, TILE_PX))
          .setScale(0.8)
        this.groundSprites.set(p.id, sprite)
      }
    }
    for (const [id, sprite] of this.groundSprites) {
      if (!seen.has(id)) {
        sprite.destroy()
        this.groundSprites.delete(id)
      }
    }
  }

  /** Fait glisser les autres entités vers leur dernière position connue (R4). */
  interpolate(now: number): void {
    for (const o of this.others.values()) {
      const t = Math.min(1, (now - o.startedAt) / INTERP_MS)
      this.syncActor(o.sprite, o.fromX + (o.toX - o.fromX) * t, o.fromY + (o.toY - o.fromY) * t, o.textureKey, o.crouch)
    }
  }

  /** Place un acteur (R12 + R13) en consommant TOUT l'`ActorPlacement` :
   * position pieds, depth Y-sort et taille d'affichage — l'emprise réelle est
   * déduite de la texture. `setDisplaySize` dépend de la frame courante : le
   * rappeler ici, chaque frame, couvre aussi les changements de texture.
   * `crouch` (spec chasse C19) : la silhouette se TASSE, les pieds ne bougent pas
   * (origine (0.5, 1)) — le tri en profondeur et l'emprise logique non plus. */
  syncActor(sprite: Phaser.GameObjects.Image, x: number, y: number, textureKey: string, crouch = false): void {
    const footprint = ACTOR_FOOTPRINTS[textureKey] ?? DEFAULT_FOOTPRINT
    const p = actorPlacement(x, y, footprint, TILE_PX, BALANCE.AVATAR_HITBOX_TILES)
    const feetY = y + BALANCE.AVATAR_HITBOX_TILES / 2
    const lift = this.warp?.lift(x, feetY) ?? 0
    sprite.setPosition(p.px, p.py - lift)
    sprite.setDepth(p.depth)
    sprite.setDisplaySize(p.displayW, crouch ? p.displayH * CROUCH_FACTOR : p.displayH)
  }

  private syncEntities(entities: Entity[], playerId: number, now: number): void {
    const seen = new Set<number>()
    // Index par entityId, UNE fois par snapshot — le `.find` par entité était
    // O(N×M) à chaque snapshot.
    const npcByEntity = new Map(this.npcs.map((n) => [n.entityId, n]))
    const monsterByEntity = new Map(this.monsters.map((m) => [m.entityId, m]))
    // LES SENTINELLES du tick (R9bis) : dérivées ICI, avec exactement le même
    // calcul que la sim (`sentinelOf`) — la posture tête haute ne ment jamais.
    const herds = new Map<number, Monster[]>()
    for (const m of this.monsters) {
      if (m.herdId === undefined) continue
      const members = herds.get(m.herdId)
      if (members) members.push(m)
      else herds.set(m.herdId, [m])
    }
    const sentinels = new Set<number>()
    for (const members of herds.values()) {
      const id = sentinelOf(members, this.tick)
      if (id >= 0) sentinels.add(id)
    }
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
          crouch: false,
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
      // LA POSTURE dit l'état (R9bis/C19) — et l'alpha garde sa silhouette
      // propre (spec faune R12) : le joueur doit pouvoir le désigner d'un coup
      // d'œil, c'est LUI qu'il faut abattre.
      const key = monster ? beastTexture(monster, sentinels.has(entity.id), this.hour) : 'spr-npc'
      if (record.textureKey !== key) {
        // setTexture réinitialise la frame : ne le rappeler que si la texture
        // change vraiment. `syncActor` re-applique aussitôt l'emprise (R12).
        record.sprite.setTexture(key)
        record.textureKey = key
        this.syncActor(record.sprite, record.toX, record.toY, key)
      }
      // LE REGARD (R9bis) : le sprite se met dans le sens où la bête regarde —
      // la sim oriente déjà `facing` (marche, gel qui fixe, sentinelle qui
      // balaie). On ne bascule qu'au-delà d'un seuil : un regard plein nord ne
      // fait pas claquer le miroir à chaque frame.
      if (monster && Math.abs(entity.facing.x) > 0.25) {
        const facesRight = ACTOR_FOOTPRINTS[key]?.facesRight === true
        record.sprite.setFlipX(facesRight ? entity.facing.x < 0 : entity.facing.x > 0)
      }
      record.crouch = isCrouched(monster, entity)
      record.sprite.setTint(beastTint(monster, entity.windup !== undefined, npc !== undefined, this.tick))
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
        const lift = this.warp?.lift(s.tx + 0.5, s.ty + 1) ?? 0
        sprite = this.scene.add
          .image(a.px, a.py - lift, `st-${s.type}`)
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
   * carte en porte ~330k ; positions figées au runtime. */
  setNodes(nodes: ResourceNode[]): void {
    this.tousLesNoeuds = nodes
    this.reindexer(nodes)
  }

  private reindexer(nodes: ResourceNode[]): void {
    this.nodes = nodes
    this.nodeById = new Map(nodes.map((n) => [n.id, n]))
    this.nodeByTile = new Map(nodes.map((n) => [n.tx * NODE_TILE_STRIDE + n.ty, n]))
  }

  /**
   * LES NŒUDS QUE LA CENDRE A MANGÉS — et le client le DÉCOUVRE, on ne le lui dit pas.
   *
   * LE TROU QU'ON BOUCHE, et il était béant. Le protocole envoie les nœuds UNE fois, au `ready`,
   * puis ne transmet que des changements de STOCK. Son commentaire l'assumait : *« le jeu de nœuds
   * est stable au runtime : seul `stock` bouge, jamais d'ajout/retrait »*. Le front de cendre a
   * rendu cette phrase FAUSSE — `/sim` détruisait 335 902 nœuds et **le client n'en savait rien**.
   * Il continuait à dessiner des arbres dans un pré carbonisé, et à s'y cogner. Mesuré au smoke
   * test : « jour 1 → 58, nœuds 335 902 → 335 902 ». La mécanique était morte à l'écran.
   *
   * ON NE TRANSMET RIEN. Le client a `map.cendre` (statique) et le tick : il RECALCULE le front,
   * exactement comme la sim, et laisse tomber ce qui a brûlé. Zéro octet sur le fil, zéro version
   * de protocole, zéro état à synchroniser — c'est toute la vertu du modèle, et il fallait juste
   * s'en souvenir jusqu'ici.
   */
  private tousLesNoeuds: ResourceNode[] = []
  private dernierFront = -Infinity

  majCendre(champ: readonly number[] | undefined, width: number, front: number): void {
    if (!champ || front <= this.dernierFront) return
    this.dernierFront = front
    const vivants = this.tousLesNoeuds.filter((n) => (champ[n.ty * width + n.tx] ?? Infinity) >= front)
    if (vivants.length === this.nodes.length) return
    this.reindexer(vivants)
  }

  /** Applique les changements de stock reçus par tick (récolte/repousse). */
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
  renderNodes(camera: Phaser.Cameras.Scene2D.Camera, playerX: number, playerY: number, now: number): void {
    const v = camera.worldView
    // La fenêtre s'élargit vers le BAS pour les cimes qui débordent (un houppier planté sous l'écran
    // survole encore la vue). Colonnes ±2 pour le débord de houppier. (Plus de marge de lift : plat.)
    const crownMargin = 4
    const tx0 = Math.floor(v.x / TILE_PX) - 2
    const ty0 = Math.floor(v.y / TILE_PX) - 1
    const tx1 = Math.ceil((v.x + v.width) / TILE_PX) + 2
    const ty1 = Math.ceil((v.y + v.height) / TILE_PX) + crownMargin
    const feetY = playerY + BALANCE.AVATAR_HITBOX_TILES / 2
    let used = 0
    let crownsUsed = 0
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const n = this.nodeByTile.get(tx * NODE_TILE_STRIDE + ty)
        if (n === undefined) continue
        // LE GROS BOIS EST UN ARBRE : deux sprites (tronc + houppier), un décalage dans sa tuile,
        // et le houppier s'efface autour du joueur. Sans cette ligne, il naissait sans houppier —
        // un fût nu au milieu d'une futaie, ce qui est exactement ce qu'il n'est pas.
        const isTree = n.type === 'tree' || n.type === 'old_tree'
        const texture = n.type === 'tree'
          ? 'nd-tree_trunk'
          : n.type === 'old_tree'
            ? 'nd-old_tree_trunk'
            : `nd-${n.type}`
        let sprite = this.nodePool[used]
        if (!sprite) {
          sprite = this.scene.add.image(0, 0, texture).setOrigin(0.5, 1)
          this.nodePool[used] = sprite
        }
        // Un arbre est décalé dans sa tuile (spec décalage d'origine) — MÊME
        // fonction pure que la collision, donc sprite et hitbox coïncident au bit
        // près. Les autres nœuds restent centrés sur leur tuile.
        const j = isTree ? treeJitter(tx, ty) : { dx: 0, dy: 0 }
        const a = tileFeetAnchor(tx, ty, TILE_PX)
        // Le coup qui porte fait TRESSAILLIR le nœud (spec recolte.md G10). Le
        // décalage est purement visuel et transitoire : il s'ajoute au dessin, il
        // ne touche ni la tuile, ni la profondeur, ni l'emprise logique.
        const hitAt = this.hitFx?.hitAt(n.id)
        const shake = hitAt === undefined ? 0 : shakeOffset(now, hitAt)
        const px = a.px + j.dx * TILE_PX + shake
        const py = a.py + j.dy * TILE_PX
        const lift = this.warp?.lift(tx + 0.5 + j.dx, ty + 1 + j.dy) ?? 0
        sprite.setPosition(px, py - lift)
        // Le sprite est POOLÉ : sa depth suit la tuile qu'il occupe cette frame,
        // jamais celle où il a été créé. Le pied réel intègre le décalage Y, pour
        // que deux arbres proches se trient par leur vrai pied, pas par le pool.
        sprite.setDepth(nodeDepth(ty + j.dy, TILE_PX))
        sprite.setTexture(texture)
        // LA SURBRILLANCE DIT CE QUI VA SE PASSER (spec recolte.md G4) : le nœud
        // visé s'éclaire s'il est à portée, et se GRISE s'il ne l'est pas. On
        // teinte le sprite plutôt que de dessiner un cadre au sol : la teinte suit
        // le billboard, donc elle reste juste quel que soit le relief. Les sprites
        // sont POOLÉS — d'où le `clearTint` systématique sur les autres.
        if (n.id === this.aimedNodeId) sprite.setTint(this.aimedInRange ? AIM_TINT : AIM_TINT_FAR)
        else sprite.clearTint()
        // Le tronc reste OPAQUE en toutes circonstances : les troncs dessinent la
        // structure de la forêt, ce sont les houppiers qui s'ouvrent.
        sprite.setAlpha(n.stock > 0 ? 1 : 0.25)
        sprite.setVisible(true)
        used++
        if (!isTree) continue

        // Le houppier : ancré 6 px sous le sommet du tronc (22 px), donc à py−16.
        let crown = this.crownPool[crownsUsed]
        if (!crown) {
          crown = this.scene.add.image(0, 0, n.type === 'old_tree' ? 'nd-old_tree_crown' : 'nd-tree_crown').setOrigin(0.5, 1)
          this.crownPool[crownsUsed] = crown
        }
        // LE POOL RÉUTILISE LES SPRITES : la texture doit être reposée à CHAQUE image, sinon un
        // houppier de gros bois se retrouve sur un arbre ordinaire (et l'inverse) selon l'ordre
        // dans lequel le pool a été servi. Le tronc le faisait déjà ; le houppier, non.
        crown.setTexture(n.type === 'old_tree' ? 'nd-old_tree_crown' : 'nd-tree_crown')
        crown.setPosition(px, py - 16 - lift) // `px` porte déjà le tressaillement
        crown.setDepth(crownDepth(ty + 1 + j.dy, TILE_PX))
        // Un arbre visé s'éclaire ENTIER : teinter le tronc seul donnerait un
        // houppier flottant, détaché de ce qu'on vise.
        if (n.id === this.aimedNodeId) crown.setTint(this.aimedInRange ? AIM_TINT : AIM_TINT_FAR)
        else crown.clearTint()
        // Distance des pieds du joueur au PIED DU TRONC : l'arbre à ton contact
        // s'efface, celui dont la cime te survole de loin reste opaque.
        const dx = playerX - (tx + 0.5)
        const dy = feetY - (ty + 1)
        const d = Math.sqrt(dx * dx + dy * dy)
        crown.setAlpha(n.stock > 0 ? crownAlpha(d) : 0.25)
        // La canopée prend le vent, elle aussi. Sans ça, la forêt reste une photo
        // posée sur un sol qui remue — et c'est le contraste qui trahit le décor.
        // Origine (0.5, 1) : le houppier bascule autour du haut du tronc.
        crown.setRotation(windSway(tx + j.dx, ty + j.dy, now, CROWN_WIND_TAKE, this.wind))
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
        const lift = this.warp?.lift(c.x, c.y) ?? 0
        const sprite = this.scene.add
          .image(c.x * TILE_PX, c.y * TILE_PX - lift, 'spr-corpse')
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
