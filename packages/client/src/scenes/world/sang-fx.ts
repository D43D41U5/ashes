/**
 * LE SANG QUI QUITTE LE CORPS — la gerbe du coup, et le goutte-à-goutte de la plaie.
 *
 * Le coup porté sur une bête de chair ne SAIGNAIT pas : la gerbe d'`attack-fx` — des
 * brisures grises de matière, quasi sans gravité, la même pour un cerf et pour un
 * Cendreux — disait « ça a porté », jamais « c'est de la CHAIR ». Et une bête en
 * saignement ne perdait son sang que dans la sim (les gouttes au sol, C9) : rien ne
 * TOMBAIT de son corps, la plaie n'existait qu'en teinte (constaté par Alexis le
 * 2026-08-16).
 *
 * Deux gestes, une seule matière :
 *
 *   • LA GICLÉE — au coup porté (`entity_damaged`, jamais le clic : la règle du jus
 *     d'`attack-fx` vaut ici mot pour mot). Des gouttelettes projetées À L'OPPOSÉ du
 *     frappeur — leçon des éclats de récolte : vers lui, elles se tassent sur son
 *     sprite — qui RETOMBENT et se POSENT. C'est la pause au sol qui fait lire du
 *     sang : une pluie qui s'évapore en l'air lit comme une étincelle rouge.
 *
 *   • LA GOUTTE — tant que ça saigne (bête `bleedMortal`/`bleedUntil`, avatar ou PNJ
 *     `wounds.bleeding`), une goutte se détache du corps à cadence lente, tombe
 *     presque droit, s'écrase. Elle est ÉPHÉMÈRE — la trace durable, c'est la sim
 *     qui la pose (C9) et `renderBlood` qui la peint : ici on peint la CHUTE, là-bas
 *     la PISTE. Les deux cadences sont proches mais indépendantes : l'une est du
 *     rendu, l'autre une règle.
 *
 * La balistique est celle de `recolte-fx` (z, vz, gravité, pose au sol sans rebond) —
 * même écrasement de la profondeur (l'axe Y de l'écran se parcourt moins vite), mêmes
 * positions arrondies au pixel (règle des FX pixellisés), même PRNG semé (`semis`) :
 * une gerbe reproductible se teste et ne scintille pas.
 */
import Phaser from 'phaser'
import { TILE_PX, TIE_ACTOR, ySortDepth } from '../../render/framing'
import { contactSol, semis } from './recolte-fx'

/** Les trois valeurs du sang — le vif du jet, le sombre du bord, le presque-séché.
 *  La MÊME palette que les textures de piste (BootScene) : c'est le même sang. */
export const SANG_TONS = [0xc4372a, 0x8e2318, 0x6f1a12] as const

/** La loi d'une matière qui doit SE POSER avant de s'effacer — même contrat que les
 *  familles cassantes de la récolte, vérifié par le test sur le pire envol. */
export interface LoiSang {
  /** Vitesse horizontale, px/s : [min, max]. */
  vitesse: readonly [number, number]
  /** Vitesse d'envol (axe z, px/s) : [min, max]. */
  envol: readonly [number, number]
  /** Hauteur de naissance au-dessus du sol, px : [min, max] — la plaie est sur le CORPS. */
  z0: readonly [number, number]
  /** Gravité, px/s². */
  g: number
  /** Durée de vie, ms — le temps de vol PLUS la pause au sol. */
  vie: number
}

/** LA GICLÉE : ça part franc, ça retombe vite, ça reste posé une demi-seconde. */
export const GICLEE: LoiSang = { vitesse: [26, 58], envol: [22, 46], z0: [6, 12], g: 300, vie: 950 }
/** LA GOUTTE : elle se DÉTACHE (presque aucun élan) et tombe droit — puis la tache tient. */
export const GOUTTE: LoiSang = { vitesse: [2, 10], envol: [0, 8], z0: [7, 13], g: 340, vie: 1100 }

/** Demi-éventail de la giclée : serré (±40°) — un jet, pas une couronne. */
const DEMI_EVENTAIL = 0.7
/** Cadence du goutte-à-goutte, ms — PROCHE de la cadence des gouttes de piste de la
 *  sim (0,8 s) sans s'y caler : caler les deux ferait croire que la goutte peinte
 *  DEVIENT la goutte de piste, et la moindre dérive de phase trahirait le tour. */
export const GOUTTE_CADENCE_MS = 520
/** Plafond de gouttelettes vivantes : une mêlée qui saigne de partout reste une mêlée. */
const MAX_GOUTTELETTES = 96

/** Combien de gouttelettes par coup — la giclée DIT le poids, comme la gerbe d'impact. */
export function nombreGiclee(amount: number): number {
  return Math.max(4, Math.min(10, 3 + Math.round(amount / 4)))
}

/**
 * L'AXE de projection : à l'OPPOSÉ du frappeur, unitaire — ou rien quand frappeur et
 * frappé se confondent (à bout touchant, pas d'axe : on ne projette pas au hasard).
 * La réplique exacte de la règle de la gerbe d'`attack-fx`, exportée pour être testée.
 */
export function axeOppose(x: number, y: number, fromX: number, fromY: number): { dx: number; dy: number } | null {
  const ex = x - fromX
  const ey = y - fromY
  const len = Math.sqrt(ex * ex + ey * ey)
  if (len <= 0.001) return null
  return { dx: ex / len, dy: ey / len }
}

interface Gouttelette {
  img: Phaser.GameObjects.Image
  /** Position au SOL (monde), et hauteur au-dessus de lui. */
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  g: number
  ne: number
  vie: number
  /** Déjà posée ? La tache ne s'écrase qu'une fois. */
  posee: boolean
  /** La strate du corps touché (`strateDeProfondeur`) : le sang naît dans son monde. */
  strate: number
}

// Des IMAGES `__WHITE` teintées, pas des `Rectangle` : les Shapes n'ont pas le composant
// Lighting, or le sang est de la MATIÈRE du monde — il prend sa nuit (le voile d'ambiance
// passe SOUS les sprites, seule l'ambiante fait leur nuit ; leçon des empreintes, 2026-08-16).
export class SangFx {
  private readonly gouttelettes: Gouttelette[] = []

  /** L'éclairage dynamique est-il armé ? (posé par WorldScene) — lu à la naissance de chaque
   *  goutte : une gouttelette vit moins d'une seconde, pas besoin de réarmer le pool. */
  lighting = true

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * LA GICLÉE d'un coup porté. `x/y` : le pied du sprite touché (px monde) ;
   * `fromX/fromY` : d'où le coup est venu. Sans origine, pas de giclée — même règle
   * que la gerbe d'impact, mêmes raisons. `strate` : celle du sprite touché
   * (`strateDeProfondeur(sprite.depth)`), 0 sur une carte plate.
   */
  gicler(x: number, y: number, amount: number, now: number, fromX?: number, fromY?: number, strate = 0): void {
    if (fromX === undefined || fromY === undefined) return
    const axe = axeOppose(x, y, fromX, fromY)
    if (!axe) return
    const base = Math.atan2(axe.dy, axe.dx)
    const rnd = semis((Math.round(x * 7) ^ Math.round(y * 13) ^ Math.round(now)) | 1)
    const n = nombreGiclee(amount)
    for (let i = 0; i < n; i++) {
      // L'éventail est ÉTALÉ puis désaligné — un tirage pur laisse des trous, et un
      // trou dans un jet de six gouttes se voit (leçon de la gerbe de récolte).
      const part = n === 1 ? 0.5 : i / (n - 1)
      const a = base + (part - 0.5 + (rnd() - 0.5) * 0.3) * 2 * DEMI_EVENTAIL
      this.pousser(x, y, a, GICLEE, rnd, now, i, strate)
    }
  }

  /**
   * UNE GOUTTE de saignement continu — appelée par `snapshot-view` à cadence lente
   * pour chaque acteur qui saigne. `x/y` : le pied du sprite (px monde). `graine` :
   * l'identité de l'acteur, pour que deux bêtes ne gouttent pas à l'identique.
   */
  goutter(x: number, y: number, now: number, graine: number, strate = 0): void {
    const rnd = semis((graine ^ Math.round(now)) | 1)
    // La goutte naît un peu à côté de l'axe du corps — une plaie n'est pas au centre.
    this.pousser(x + (rnd() - 0.5) * 7, y, rnd() * Math.PI * 2, GOUTTE, rnd, now, 0, strate)
  }

  private pousser(x: number, y: number, angle: number, loi: LoiSang, rnd: () => number, now: number, i: number, strate: number): void {
    if (this.gouttelettes.length >= MAX_GOUTTELETTES) {
      this.gouttelettes.shift()?.img.destroy() // la plus vieille s'efface : le sang neuf prime
    }
    const v = loi.vitesse[0] + rnd() * (loi.vitesse[1] - loi.vitesse[0])
    const z = loi.z0[0] + rnd() * (loi.z0[1] - loi.z0[0])
    const ton = SANG_TONS[i % SANG_TONS.length]!
    const cote = rnd() < 0.25 ? 3 : 2
    const img = this.scene.add
      .image(Math.round(x), Math.round(y - z), '__WHITE')
      .setDisplaySize(cote, cote)
      .setTint(ton)
      .setDepth(strate + ySortDepth(y / TILE_PX, TILE_PX, TIE_ACTOR))
    img.setLighting(this.lighting)
    this.gouttelettes.push({
      img,
      x,
      y,
      z,
      vx: Math.cos(angle) * v,
      // Le monde est vu de dessus : la profondeur (Y écran) se parcourt moins vite
      // que la largeur — même écrasement que la gerbe de récolte.
      vy: Math.sin(angle) * v * 0.6,
      vz: loi.envol[0] + rnd() * (loi.envol[1] - loi.envol[0]),
      g: loi.g,
      ne: now, // la vie court depuis le DESSIN, pas depuis l'événement (leçon recolte-fx)
      vie: loi.vie,
      posee: false,
      strate,
    })
  }

  /** Chaque frame : le sang vole, retombe, S'ÉCRASE, sèche. `dt` borné — l'horloge
   *  headless saute, et une frame de 400 ms enverrait la giclée à trois tuiles. */
  update(now: number, dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000
    for (let i = this.gouttelettes.length - 1; i >= 0; i--) {
      const e = this.gouttelettes[i]!
      const age = now - e.ne
      if (age >= e.vie) {
        e.img.destroy()
        this.gouttelettes.splice(i, 1)
        continue
      }
      e.x += e.vx * dt
      e.y += e.vy * dt
      e.z += e.vz * dt
      e.vz -= e.g * dt
      if (e.z <= 0) {
        // AU SOL. Pas de rebond (à cette échelle, un rebond lit comme un tremblement) ;
        // la goutte S'ÉCRASE — une fois — en tache plus large que haute, et c'est cette
        // tache qui tient jusqu'au bout de sa vie.
        e.z = 0
        e.vx = 0
        e.vy = 0
        e.vz = 0
        if (!e.posee) {
          e.posee = true
          // `displayWidth`, pas `width` : sur une image `__WHITE`, `width` est la taille de la
          // TEXTURE (4 px), pas celle de la tache — l'écrasement se mesure sur l'affiché.
          e.img.setDisplaySize(e.img.displayWidth + 1, Math.max(1, e.img.displayHeight - 1))
        }
      }
      const k = age / e.vie
      // Pleine jusqu'aux deux tiers, puis elle sèche vite — un fondu étalé ferait
      // de la brume rose, pas du sang.
      e.img.setAlpha(k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35)
      e.img.setPosition(Math.round(e.x), Math.round(e.y - e.z))
      e.img.setDepth(e.strate + ySortDepth(e.y / TILE_PX, TILE_PX, TIE_ACTOR))
    }
  }

  /** Sondes du smoke : un FX de quelques centaines de ms naît et meurt entre deux
   *  captures headless — le harnais LIT ces comptes pour savoir quand figer. */
  get enAir(): number {
    let n = 0
    for (const e of this.gouttelettes) if (e.z > 0) n++
    return n
  }
  get auSol(): number {
    let n = 0
    for (const e of this.gouttelettes) if (e.z <= 0) n++
    return n
  }
}

/** L'instant du contact au sol du PIRE envol d'une loi — la promesse « ça se pose
 *  avant de s'effacer » rendue calculable (et donc testée), comme à la récolte. */
export function pireContact(loi: LoiSang): number {
  return contactSol(loi.z0[1], loi.envol[1], loi.g)
}
