/**
 * La vie ambiante — ce qui bouge sans que rien ne se passe (chantier ambiance).
 *
 * Deux habitants, et ils ne sont QUE du rendu : ils n'existent pas dans `/sim`,
 * ne portent aucun état de jeu, ne peuvent être ni touchés ni tués. C'est
 * délibéré : le jour où un oiseau devient une information (un vol qui s'envole
 * parce qu'une horde approche — GDD §9bis, « annoncés, pas surprises »), il
 * descendra dans la sim et sera émis comme un fait. Tant qu'il est décor, il
 * reste ici, et il ne coûte rien au réseau.
 *
 * - Les OISEAUX traversent le ciel par petits vols, au-dessus de la canopée.
 * - Les LUCIOLES ne sortent que la nuit, et dérivent près du sol.
 *
 * Les deux sont culled à la vue : hors champ, ils sont recyclés, pas simulés.
 */
import Phaser from 'phaser'
import { FLYER_DEPTH, SPARK_DEPTH, TILE_PX } from '../../render/framing'

/** Vols simultanés au plus, et oiseaux par vol. */
const MAX_FLOCKS = 2
const BIRDS_PER_FLOCK = 5
/** Un vol traverse en ~14 s, à cette vitesse (tuiles/s). */
const BIRD_SPEED = 7
/** Secondes entre deux vols (tiré dans cette fourchette). */
const FLOCK_GAP_S: [number, number] = [9, 26]

/**
 * Les lucioles ne se répandent pas : elles s'AGRÈGENT. Un semis uniforme sur
 * tout l'écran donne une guirlande de fête foraine — ce qu'on veut, c'est deux
 * ou trois essaims, petits, à des endroits éloignés, et beaucoup de nuit entre
 * eux. Le noir est ce qui fait exister la lumière.
 */
const MAX_SWARMS = 3
const FLIES_PER_SWARM: [number, number] = [7, 12]
/** Rayon d'un essaim (tuiles) : une nuée lâche au-dessus d'un fourré, pas un point. */
const SWARM_RADIUS = 3.4
/** Un essaim se pose à cette distance du joueur, et jamais plus près. */
const SWARM_DIST: [number, number] = [10, 28]
/** Deux essaims ne se posent jamais à moins de ça l'un de l'autre (tuiles). */
const SWARM_SEPARATION = 16
/** Au-delà : l'essaim est oublié et se reforme ailleurs. */
const SWARM_FORGET_DIST = 46
/** En-deçà de cette obscurité (1 - daylight), aucune luciole ne sort. */
const FIREFLY_NIGHT_THRESHOLD = 0.45
const FIREFLY_DRIFT = 0.35 // tuiles/s — une luciole ne file pas, elle flotte

/**
 * Où les lucioles daignent vivre : SOUS BOIS. Le sous-bois est noir même quand
 * le pré ne l'est pas — c'est là qu'une lueur vaut quelque chose. Jamais un
 * éboulis, jamais la neige, jamais un glacier : une nuée de lucioles sur un névé,
 * et tout le monde comprend que le décor est posé au hasard.
 */
const FIREFLY_TERRAINS = new Set([
  3, // forest
  13, // pine
  14, // larch
  22, // old_growth
])

interface Bird {
  sprite: Phaser.GameObjects.Image
  x: number
  y: number
  vx: number
  vy: number
  /** Déphasage du battement d'ailes : un vol n'est pas un métronome. */
  phase: number
}

/** Une luciole tourne autour de l'ancre de SON essaim — elle ne vagabonde pas. */
interface Firefly {
  sprite: Phaser.GameObjects.Image
  /** Décalage par rapport à l'ancre de l'essaim (tuiles). */
  ox: number
  oy: number
  vx: number
  vy: number
  phase: number
}

/** Un essaim : une ancre plantée dans le MONDE, et ses quelques lueurs. */
interface Swarm {
  x: number
  y: number
  flies: Firefly[]
}

export class AmbientLife {
  /** Lus par le smoke test (`--scenario faune`) : il OBSERVE le jeu, il ne le fabrique pas. */
  readonly birds: Bird[] = []
  readonly swarms: Swarm[] = []
  private nextFlockAt = 3

  /** `sample` rend l'id de terrain d'une tuile (-1 hors carte) : les lucioles
   *  choisissent leur biome, elles ne se posent pas n'importe où. */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sample: (tx: number, ty: number) => number,
  ) {}

  /**
   * @param darkness 1 - daylight : 0 en plein jour, ~1 au cœur de la nuit.
   * @param dtS      secondes écoulées depuis la frame précédente.
   */
  update(camera: Phaser.Cameras.Scene2D.Camera, nowS: number, dtS: number, darkness: number): void {
    this.updateBirds(camera, nowS, dtS)
    this.updateFireflies(camera, nowS, dtS, darkness)
  }

  /* ── Les oiseaux ──────────────────────────────────────────────────────── */

  private updateBirds(camera: Phaser.Cameras.Scene2D.Camera, nowS: number, dtS: number): void {
    if (nowS >= this.nextFlockAt && this.birds.length + BIRDS_PER_FLOCK <= MAX_FLOCKS * BIRDS_PER_FLOCK) {
      this.launchFlock(camera)
      const [lo, hi] = FLOCK_GAP_S
      this.nextFlockAt = nowS + lo + Math.random() * (hi - lo)
    }

    const v = camera.worldView
    const marginPx = 6 * TILE_PX
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i]!
      b.x += b.vx * dtS
      b.y += b.vy * dtS
      b.sprite.setPosition(b.x * TILE_PX, b.y * TILE_PX)
      // Le battement d'ailes, vu de dessus : l'envergure se pince et s'ouvre.
      const flap = 0.55 + 0.45 * Math.abs(Math.sin(nowS * 9 + b.phase))
      b.sprite.setScale(1, flap)

      // Sorti du champ (avec marge) : recyclé. Un oiseau ne survit pas à sa traversée.
      const px = b.x * TILE_PX
      const py = b.y * TILE_PX
      if (px < v.x - marginPx || px > v.x + v.width + marginPx || py < v.y - marginPx || py > v.y + v.height + marginPx) {
        b.sprite.destroy()
        this.birds.splice(i, 1)
      }
    }
  }

  /** Un vol entre par un bord et sort par l'autre, en diagonale molle. */
  private launchFlock(camera: Phaser.Cameras.Scene2D.Camera): void {
    const v = camera.worldView
    const leftToRight = Math.random() < 0.5
    // Le point d'entrée est HORS champ : un oiseau ne se matérialise jamais à l'écran.
    const x0 = (leftToRight ? v.x - 5 * TILE_PX : v.x + v.width + 5 * TILE_PX) / TILE_PX
    const y0 = (v.y + Math.random() * v.height) / TILE_PX
    const heading = (leftToRight ? 1 : -1) * BIRD_SPEED
    const drift = (Math.random() - 0.5) * BIRD_SPEED * 0.5

    for (let i = 0; i < BIRDS_PER_FLOCK; i++) {
      // Une formation lâche : les retardataires traînent derrière et de biais.
      const lag = i * 1.5 + Math.random()
      const sprite = this.scene.add
        .image(0, 0, 'fx-bird')
        .setDepth(FLYER_DEPTH)
        .setAlpha(0.75)
        .setFlipX(!leftToRight)
        .setDisplaySize(TILE_PX * 0.55, TILE_PX * 0.35)
      this.birds.push({
        sprite,
        x: x0 - (leftToRight ? lag : -lag),
        y: y0 + (Math.random() - 0.5) * 3,
        vx: heading,
        vy: drift,
        phase: Math.random() * Math.PI * 2,
      })
    }
  }

  /* ── Les lucioles ─────────────────────────────────────────────────────── */

  private updateFireflies(camera: Phaser.Cameras.Scene2D.Camera, nowS: number, dtS: number, darkness: number): void {
    // La nuit tombe : les essaims s'allument un à un. Le jour, tout s'éteint.
    const wanted =
      darkness < FIREFLY_NIGHT_THRESHOLD
        ? 0
        : Math.round(MAX_SWARMS * ((darkness - FIREFLY_NIGHT_THRESHOLD) / (1 - FIREFLY_NIGHT_THRESHOLD)))

    const cx = camera.midPoint.x / TILE_PX
    const cy = camera.midPoint.y / TILE_PX

    // Un essaim que le joueur a laissé loin derrière n'existe plus : on le
    // reforme ailleurs plutôt que de le traîner.
    for (let i = this.swarms.length - 1; i >= 0; i--) {
      const s = this.swarms[i]!
      if (Math.hypot(s.x - cx, s.y - cy) > SWARM_FORGET_DIST) {
        for (const f of s.flies) f.sprite.destroy()
        this.swarms.splice(i, 1)
      }
    }
    while (this.swarms.length > wanted) {
      const s = this.swarms.pop()!
      for (const f of s.flies) f.sprite.destroy()
    }
    while (this.swarms.length < wanted) {
      const anchor = this.findSwarmSpot(cx, cy)
      if (!anchor) break // aucun point assez éloigné des autres : on n'en force pas un
      this.swarms.push(this.makeSwarm(anchor.x, anchor.y))
    }

    for (const s of this.swarms) {
      for (const f of s.flies) {
        // Elle flotte autour de l'ancre, et y est doucement rappelée : sans ce
        // rappel, l'essaim se dilue en quelques secondes et redevient un semis.
        f.vx += (Math.sin(nowS * 1.3 + f.phase) - f.ox / SWARM_RADIUS) * dtS * 0.6
        f.vy += (Math.cos(nowS * 1.1 + f.phase * 1.3) - f.oy / SWARM_RADIUS) * dtS * 0.6
        f.vx = Math.max(-FIREFLY_DRIFT, Math.min(FIREFLY_DRIFT, f.vx))
        f.vy = Math.max(-FIREFLY_DRIFT, Math.min(FIREFLY_DRIFT, f.vy))
        f.ox += f.vx * dtS
        f.oy += f.vy * dtS

        // Elle s'allume et s'éteint — et reste éteinte plus longtemps qu'allumée
        // (puissance 3 : la lueur est un événement, pas un régime).
        const pulse = 0.5 + 0.5 * Math.sin(nowS * 2.2 + f.phase)
        f.sprite.setPosition((s.x + f.ox) * TILE_PX, (s.y + f.oy) * TILE_PX)
        f.sprite.setAlpha(0.05 + 0.85 * pulse * pulse * pulse)
      }
    }
  }

  /**
   * Un point à bonne distance du joueur, loin des essaims déjà posés, ET dans un
   * biome où des lucioles ont une raison d'être. Si aucun tirage ne convient, on
   * ne pose RIEN : au-dessus d'un glacier, la nuit reste noire — c'est correct.
   */
  private findSwarmSpot(cx: number, cy: number): { x: number; y: number } | null {
    const [dMin, dMax] = SWARM_DIST
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2
      const d = dMin + Math.random() * (dMax - dMin)
      const x = cx + Math.cos(a) * d
      const y = cy + Math.sin(a) * d
      if (!FIREFLY_TERRAINS.has(this.sample(Math.floor(x), Math.floor(y)))) continue
      if (this.swarms.every((s) => Math.hypot(s.x - x, s.y - y) >= SWARM_SEPARATION)) return { x, y }
    }
    return null
  }

  private makeSwarm(x: number, y: number): Swarm {
    const [lo, hi] = FLIES_PER_SWARM
    const count = lo + Math.floor(Math.random() * (hi - lo + 1))
    const flies: Firefly[] = []
    for (let i = 0; i < count; i++) {
      const sprite = this.scene.add
        .image(0, 0, 'glow') // le halo radial du boot : une luciole est une lueur, pas un point dur
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(SPARK_DEPTH)
        .setTint(0xc8e87a)
        // MINUSCULE. Une luciole est un point de lumière, pas une lanterne.
        .setDisplaySize(TILE_PX * 0.3, TILE_PX * 0.3)
      flies.push({
        sprite,
        ox: (Math.random() - 0.5) * SWARM_RADIUS,
        oy: (Math.random() - 0.5) * SWARM_RADIUS,
        vx: 0,
        vy: 0,
        phase: Math.random() * Math.PI * 2,
      })
    }
    return { x, y, flies }
  }

  destroy(): void {
    for (const b of this.birds) b.sprite.destroy()
    for (const s of this.swarms) for (const f of s.flies) f.sprite.destroy()
    this.birds.length = 0
    this.swarms.length = 0
  }
}
