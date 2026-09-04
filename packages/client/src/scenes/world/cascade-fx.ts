/**
 * LA CASCADE, VIVANTE — les gouttes, la brume et la lueur au pied d'une chute (T-A9).
 *
 * `cliff-layer` POSE la nappe (les sprites de `chute-art`, au pas du shader d'eau) et l'écume ;
 * ici vit ce que des sprites au pas ne savent pas faire — ce qui S'ÉCHAPPE de la chute :
 *
 *   1. LES GOUTTES — des carrés de 2 px (la cellule de la nappe) projetés vers le haut à
 *      l'impact et qui RETOMBENT (`gravityY`) : une parabole courte, comme les escarbilles
 *      d'un feu — c'est l'arc qui donne le poids de l'eau. Blanc d'écume, puis les bleus pâles.
 *   2. LA BRUME — des carrés de 4 px, presque transparents, qui montent lentement et prennent
 *      le vent comme la fumée d'un feu : de loin, c'est elle qui dit « une cascade », avant
 *      qu'on lise la nappe.
 *   3. LA LUEUR — un petit halo froid, en ADD, sur l'eau du pied : l'écume renvoie la lumière
 *      qu'elle reçoit — le jour, plus fort ; la nuit, la lune seule. Quantifié à 4 px et
 *      NEAREST, jamais lissé, et qui VACILLE PAR ALPHA au pas de la nappe (`CHUTE_HZ`), pas par
 *      taille (mémoire « FX de lumière pixellisés »).
 *
 * Une cascade n'ÉMET pas de lumière, elle la renvoie : aucun point light dans
 * `dynamic-lighting`, rien qui creuse le voile — la lueur seule, et sous le voile au palier 0.
 *
 * Les unités se réconcilient sur les chutes VISIBLES que `CliffLayer` a posées à l'image
 * (`chutes`), une par colonne de tuile — hors champ, elles meurent ; à l'entrée, `fastForward`
 * leur donne d'emblée leur régime, sinon une cascade naîtrait vide au bord de l'écran.
 * AUCUNE logique de jeu : de l'eau qu'on regarde.
 */
import Phaser from 'phaser'
import { VENT } from '@ashes/sim'
import { CHUTE_HZ, tirage } from '../../render/chute-art'
import { CLIFF_DEPTH, LIFT_TUILES, strateDEtage, TILE_PX } from '../../render/framing'
import type { ChuteVue } from './cliff-layer'

/** La goutte : un carré PLEIN de 2 px monde, la cellule de la nappe, teinté par émetteur. */
const GOUTTE_KEY = 'fx-chute-goutte'
/** La brume : un carré plein de 4 px, le grain des lueurs. */
const BRUME_KEY = 'fx-chute-brume'
/** La lueur au pied. */
const LUEUR_KEY = 'fx-chute-lueur'
const LUEUR_PX = 4
/** Le rayon de la lueur, en cellules : 2 × 4 px = 8 px de part et d'autre — la lueur tient dans
 *  sa colonne (20 px pour 16), deux colonnes voisines ne s'additionnent qu'à la frange, où
 *  l'alpha est déjà mort. */
const LUEUR_RAYON = 2

/** On RÉGÉNÈRE toujours (même raison que `fire-fx.ensureEmberTexture` : la clé vit sur le
 *  TextureManager global et survit à un HMR). */
function ensureCarre(scene: Phaser.Scene, key: string, S: number): void {
  if (scene.textures.exists(key)) scene.textures.remove(key)
  const tex = scene.textures.createCanvas(key, S, S)
  if (!tex) return
  const ctx = tex.getContext()
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = 'rgba(255,255,255,1)'
  ctx.fillRect(0, 0, S, S)
  tex.refresh()
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** Le halo froid : un disque aplati (vu du dessus), très creusé — presque tout au centre. Blanc
 *  bleuté : en ADD sur l'eau, c'est le rouge qui manque à l'eau, donc le blanc qui la réveille
 *  sans la jaunir. */
function ensureLueur(scene: Phaser.Scene): void {
  if (scene.textures.exists(LUEUR_KEY)) scene.textures.remove(LUEUR_KEY)
  const side = LUEUR_RAYON * 2 + 1
  const tex = scene.textures.createCanvas(LUEUR_KEY, side, side)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(side, side)
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const dx = i - LUEUR_RAYON
      const dy = (j - LUEUR_RAYON) * 1.25
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (LUEUR_RAYON + 0.5))
      const u = 1 - t
      const k = (j * side + i) * 4
      img.data[k] = 0xd8
      img.data[k + 1] = 0xec
      img.data[k + 2] = 0xff
      img.data[k + 3] = Math.round(u * u * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(LUEUR_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** Les tons des gouttes : le blanc de l'écume (`chute-art.BLANC`) puis deux bleus pâles — une
 *  goutte s'éteint vers l'eau, pas vers le gris. */
const TONS_GOUTTES = [0xfffcf0, 0xdcecf8, 0xbcd6ea]
const TONS_BRUME = [0xe8f2fa, 0xd0e2f0]

/** Combien chaque couche prend le vent (px/s² par unité de vent) — la brume comme la fumée
 *  d'un feu, les gouttes à peine : elles ont du poids. */
const GOUTTE_VENT = 10
const BRUME_VENT = 46
/** La part au-dessus de l'ambiance, comme `fire-fx.PRISE_FORCE`. */
const PRISE_FORCE = 1.2

/** Le régime de la lueur : ce qu'elle vaut en plein jour, et ce que la lune seule lui rend. */
const LUEUR_JOUR = 0.2
const LUEUR_LUNE = 0.12
/** L'amplitude du vacillement, par alpha, au pas de la nappe. */
const LUEUR_VACILLE = 0.3

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter
function applyWind(e: Emitter, wind: { x: number; y: number }, take: number, prise: number): void {
  e.accelerationX = wind.x * take * prise
  e.accelerationY = wind.y * take * prise
}

/** `c × m`, canal par canal — la nuit des hauteurs sur une teinte de particule. */
function moduler(c: number, m: number): number {
  const k = (d: number): number => Math.round((((c >> d) & 255) * ((m >> d) & 255)) / 255)
  return (k(16) << 16) | (k(8) << 8) | k(0)
}

interface ChuteUnit {
  tx: number
  gouttes: Emitter
  brume: Emitter
  lueur: Phaser.GameObjects.Image
  /** Le palier de l'eau du pied — au-dessus de 0, la couche est hors du voile et prend `teinte`. */
  hs: number
  /** La dernière teinte posée sur les particules : on ne repose que si elle change. */
  teinte: number
}

export class CascadeFx {
  private units = new Map<number, ChuteUnit>()

  constructor(private scene: Phaser.Scene, private width: number) {
    ensureCarre(scene, GOUTTE_KEY, 2)
    ensureCarre(scene, BRUME_KEY, 4)
    ensureLueur(scene)
  }

  /**
   * Réconcilie les unités avec les chutes posées à cette image, et les fait vivre.
   * @param chutes   `CliffLayer.chutes` après son `render`
   * @param now      l'horloge de rendu (ms) — celle de la nappe
   * @param day      `daylight(hour)`, 0..1
   * @param lune     `lueurDeLune`, 0..1
   * @param teinte   `teinteDesHauteurs` : la nuit plate des paliers ≥ 1 (0xffffff = rien)
   * @param wind     le vecteur de vent rendu (calme plat = {0,0})
   * @param force    `state.windForce`
   */
  update(
    chutes: readonly ChuteVue[],
    now: number,
    day: number,
    lune: number,
    teinte: number,
    wind: { x: number; y: number } = { x: 0, y: 0 },
    force: number = VENT.AMBIANT,
  ): void {
    const prise = 1 + PRISE_FORCE * Math.min(1, Math.max(0, (force - VENT.AMBIANT) / (1 - VENT.AMBIANT)))
    const pas = Math.floor(now / (1000 / CHUTE_HZ))
    const seen = new Set<number>()
    for (const c of chutes) {
      const id = c.ty * this.width + c.tx
      seen.add(id)
      let unit = this.units.get(id)
      if (!unit) {
        unit = this.spawn(c)
        this.units.set(id, unit)
      }
      applyWind(unit.gouttes, wind, GOUTTE_VENT, prise)
      applyWind(unit.brume, wind, BRUME_VENT, prise)
      // La lueur : ce que l'écume renvoie — le jour, puis la lune quand le jour s'en va ; et
      // elle vacille au pas de la nappe, colonne par colonne (deux voisines ne battent pas ensemble).
      const base = LUEUR_JOUR * day + LUEUR_LUNE * lune * (1 - day)
      const vacille = 1 - LUEUR_VACILLE * (tirage(c.tx, pas, 8) / 7)
      unit.lueur.setAlpha(base * vacille)
      // La nuit des hauteurs (T-R7) : hors du voile, la couche prend la teinte plate — comme la
      // paroi et son écume (`CliffLayer.poser`). Au palier 0, le voile fait la nuit tout seul.
      const t = c.hs >= 1 ? teinte : 0xffffff
      if (t !== unit.teinte) {
        unit.teinte = t
        unit.lueur.setTint(t)
        unit.gouttes.setParticleTint(TONS_GOUTTES.map((k) => moduler(k, t)))
        unit.brume.setParticleTint(TONS_BRUME.map((k) => moduler(k, t)))
      }
    }
    for (const [id, unit] of this.units) {
      if (seen.has(id)) continue
      this.detruire(unit)
      this.units.delete(id)
    }
  }

  private spawn(c: ChuteVue): ChuteUnit {
    // Le point d'impact : le haut de la tuile d'eau du pied, à l'écran (l'eau du palier `hs`
    // est levée de `hs × LIFT_TUILES` tuiles), au milieu de la colonne.
    const cx = c.tx * TILE_PX + TILE_PX / 2
    const cy = (c.ty + 1 - c.hs * LIFT_TUILES) * TILE_PX
    // Juste au-dessus de l'écume (`CLIFF_DEPTH`), sous tout corps du palier.
    const depth = strateDEtage(c.hs) + CLIFF_DEPTH
    // Toute la largeur de la colonne, jamais un point : sinon les gouttes s'empilent en pilier.
    const largeur: Phaser.Types.GameObjects.Particles.ParticleEmitterRandomZoneConfig = {
      type: 'random',
      source: { getRandomPoint: (p) => { p.x = (Math.random() - 0.5) * TILE_PX; p.y = Math.random() * 2 } },
    }

    // LES GOUTTES : projetées à l'impact, elles RETOMBENT — un arc court (apex ≈ 6 px monde
    // pour la plus vive), qui donne l'échelle ; elles meurent en retombant dans l'écume.
    const gouttes = this.scene.add
      .particles(cx, cy, GOUTTE_KEY, {
        emitZone: largeur,
        speedY: { min: -34, max: -12 },
        speedX: { min: -9, max: 9 },
        alpha: { start: 1, end: 0.35 },
        lifespan: { min: 380, max: 680 },
        frequency: 42,
        quantity: 1,
        tint: TONS_GOUTTES,
        blendMode: 'NORMAL',
      })
      .setDepth(depth + 0.03)
    gouttes.gravityY = 90

    // LA BRUME : lente, presque transparente, elle monte ET dérive au vent ; elle gonfle un peu
    // en mourant — comme la fumée d'un feu.
    const brume = this.scene.add
      .particles(cx, cy + 2, BRUME_KEY, {
        emitZone: largeur,
        speedY: { min: -11, max: -5 },
        speedX: { min: -3, max: 3 },
        scale: { start: 1, end: 1.75 },
        alpha: { start: 0.26, end: 0 },
        lifespan: { min: 900, max: 1500 },
        frequency: 110,
        quantity: 1,
        tint: TONS_BRUME,
        blendMode: 'NORMAL',
      })
      .setDepth(depth + 0.02)

    // LA LUEUR : sur l'eau du pied, sous les gouttes — elles doivent la traverser en clair.
    const side = (LUEUR_RAYON * 2 + 1) * LUEUR_PX
    const lueur = this.scene.add
      .image(cx, cy + 5, LUEUR_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(depth + 0.01)
      .setBlendMode('ADD')
      .setDisplaySize(side, side)
      .setAlpha(0)

    // Le régime d'emblée : une chute qui entre dans le champ tombe depuis toujours.
    gouttes.fastForward(1500)
    brume.fastForward(1500)
    return { tx: c.tx, gouttes, brume, lueur, hs: c.hs, teinte: 0xffffff }
  }

  private detruire(u: ChuteUnit): void {
    u.gouttes.destroy()
    u.brume.destroy()
    u.lueur.destroy()
  }

  destroy(): void {
    for (const u of this.units.values()) this.detruire(u)
    this.units.clear()
  }
}
