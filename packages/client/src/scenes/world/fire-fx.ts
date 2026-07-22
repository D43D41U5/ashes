/**
 * LE FEU, VIVANT — des langues de flamme, des braises qui montent, et de la fumée.
 *
 * Trois couches de particules, une par structure `fire`, réconciliées au diff `seen`
 * comme les sprites de snapshot :
 *
 *   1. LES FLAMMES — de petites particules chaudes, ÉMISES SUR UNE PETITE LARGEUR
 *      (jamais toutes au même point, sinon ça s'empile en un disque blanc), qui
 *      montent POSÉMENT (pas de fusée), rétrécissent, s'éteignent.
 *   2. LES BRAISES — quelques étincelles vives et rares qui filent vers le haut.
 *   3. LA FUMÉE — grise, plus lente, elle monte plus haut et gonfle en se dissipant.
 *
 * Le grain est PIXEL (carré dur, NEAREST — comme le reste du jeu), et LE VENT pousse les
 * trois couches : accélération latérale ∝ au vent de la sim, la fumée (légère) prend le
 * plus, la flamme (chaude, elle monte dru) le moins. Calme plat = aucune dérive.
 *
 * PAS DE LUMIÈRE AU SOL ici (retirée le 2026-07-21, demande d'Alexis) : l'éclairage des
 * VOLUMES par les Feux vit dans `dynamic-lighting.ts` ; le sol n'est plus traité.
 *
 * AUCUNE logique de jeu : pur habillage.
 */
import Phaser from 'phaser'
import type { Structure } from '@braises/sim'
import { SPARK_DEPTH, TILE_PX } from '../../render/framing'

/** Une braise en PIXEL — un CARRÉ PLEIN et UNIFORME (demande d'Alexis : plus rond du
 *  tout). Pas de dégradé, pas de cœur brillant qui arrondit à l'œil : un aplat blanc à
 *  bords francs, teinté par émetteur, filtre NEAREST → un « gros pixel » carré net.
 *
 *  On RÉGÉNÈRE toujours (remove + recreate) : la texture vit sur le TextureManager GLOBAL
 *  du jeu, donc un simple `exists` la garderait figée à sa version d'un HMR précédent —
 *  le piège qui laissait voir les vieilles particules rondes sans hard refresh. */
const EMBER_KEY = 'fx-ember'
function ensureEmberTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(EMBER_KEY)) scene.textures.remove(EMBER_KEY)
  const S = 8
  const tex = scene.textures.createCanvas(EMBER_KEY, S, S)
  if (!tex) return
  const ctx = tex.getContext()
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = 'rgba(255,255,255,1)'
  ctx.fillRect(0, 0, S, S) // carré PLEIN et uniforme : aucune rondeur possible
  tex.refresh()
  // NEAREST : le carré reste net au zoom (le LINEAR par défaut, posé après la passe de
  // BootScene, relisserait ses bords).
  scene.textures.get(EMBER_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** Combien chaque couche prend le vent (px/s² par unité de vent). La fumée est légère et
 *  dérive fort ; la flamme, chaude, monte presque droit ; les braises entre les deux. */
const FLAME_WIND = 14
const EMBER_WIND = 30
const SMOKE_WIND = 58

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter
function applyWind(e: Emitter, wind: { x: number; y: number }, take: number): void {
  e.accelerationX = wind.x * take
  e.accelerationY = wind.y * take
}

interface FireUnit {
  flame: Emitter
  ember: Emitter
  smoke: Emitter
}

export class FireFx {
  private units = new Map<number, FireUnit>()

  constructor(private scene: Phaser.Scene) {
    ensureEmberTexture(scene)
  }

  /** Réconcilie les particules avec les Feux du snapshot et LE VENT les pousse (vecteur
   *  unité de la sim, {0,0} = calme plat → aucune dérive). */
  update(structures: Structure[], wind: { x: number; y: number } = { x: 0, y: 0 }): void {
    const seen = new Set<number>()
    for (const s of structures) {
      if (s.type !== 'fire') continue
      seen.add(s.id)
      let unit = this.units.get(s.id)
      if (!unit) {
        const cx = s.tx * TILE_PX + TILE_PX / 2
        const cy = s.ty * TILE_PX + TILE_PX / 2
        unit = this.spawn(cx, cy)
        this.units.set(s.id, unit)
      }
      applyWind(unit.flame, wind, FLAME_WIND)
      applyWind(unit.ember, wind, EMBER_WIND)
      applyWind(unit.smoke, wind, SMOKE_WIND)
    }
    for (const [id, unit] of this.units) {
      if (seen.has(id)) continue
      unit.flame.destroy()
      unit.ember.destroy()
      unit.smoke.destroy()
      this.units.delete(id)
    }
  }

  private spawn(cx: number, cy: number): FireUnit {
    // LES FLAMMES : de petites braises chaudes qui montent POSÉMENT (montée ralentie —
    // elles fusaient) en s'écartant un peu et se resserrent en pointe. Additif.
    const flame = this.scene.add
      .particles(cx, cy - 1, EMBER_KEY, {
        speedY: { min: -18, max: -9 },
        speedX: { min: -4, max: 4 },
        scale: { start: 1.1, end: 0.12 },
        alpha: { start: 0.5, end: 0 },
        lifespan: { min: 620, max: 1100 },
        frequency: 72, // moins dense : on voit des CARRÉS distincts, pas un halo fusionné
        quantity: 1,
        tint: [0xffe27a, 0xffa842, 0xf05a1e],
        blendMode: 'ADD',
      })
      .setDepth(SPARK_DEPTH)

    // LES BRAISES : rares, vives, minuscules — elles filent vers le haut et meurent vite.
    const ember = this.scene.add
      .particles(cx, cy - 2, EMBER_KEY, {
        speedY: { min: -30, max: -18 },
        speedX: { min: -8, max: 8 },
        scale: { start: 0.18, end: 0 },
        alpha: { start: 0.85, end: 0 },
        lifespan: { min: 700, max: 1300 },
        frequency: 230,
        quantity: 1,
        tint: [0xffe9a0, 0xffc258],
        blendMode: 'ADD',
      })
      .setDepth(SPARK_DEPTH + 1)

    // LA FUMÉE : de petites volutes grises qui montent et se dissipent VITE (décision
    // utilisateur). Fondu normal, alpha faible, grain menu : elle n'OFFUSQUE rien.
    const smoke = this.scene.add
      .particles(cx, cy - 4, EMBER_KEY, {
        speedY: { min: -26, max: -15 },
        speedX: { min: -4, max: 4 },
        scale: { start: 0.5, end: 1.1 },
        alpha: { start: 0.14, end: 0 },
        lifespan: { min: 900, max: 1500 },
        frequency: 160,
        quantity: 1,
        tint: [0x5a554d, 0x6f6a61],
        blendMode: 'NORMAL',
      })
      .setDepth(SPARK_DEPTH - 1)

    return { flame, ember, smoke }
  }

  destroy(): void {
    for (const unit of this.units.values()) {
      unit.flame.destroy()
      unit.ember.destroy()
      unit.smoke.destroy()
    }
    this.units.clear()
  }
}
