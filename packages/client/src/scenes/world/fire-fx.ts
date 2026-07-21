/**
 * LE FEU, VIVANT — des langues de flamme, des braises qui montent, et de la fumée.
 *
 * Trois couches de particules, une par structure `fire`, réconciliées au diff `seen`
 * comme les sprites de snapshot :
 *
 *   1. LES FLAMMES — de petites particules chaudes, ÉMISES SUR UNE PETITE LARGEUR
 *      (jamais toutes au même point, sinon ça s'empile en un disque blanc), qui
 *      montent, rétrécissent, s'éteignent.
 *   2. LES BRAISES — quelques étincelles vives et rares qui filent vers le haut.
 *   3. LA FUMÉE — grise, plus lente, elle monte plus haut et gonfle en se dissipant.
 *
 * PAS DE LUMIÈRE AU SOL ici (retirée le 2026-07-21, demande d'Alexis : « retire tous
 * les traitements sur le sol ») — l'ancien bassin (shader additif) et la lightmap de
 * sol ont été supprimés. L'éclairage des VOLUMES (arbres, roches, murs) par les Feux
 * vit toujours dans `dynamic-lighting.ts` ; le sol, lui, n'est plus traité.
 *
 * AUCUNE logique de jeu : pur habillage.
 */
import type { Structure } from '@braises/sim'
import type Phaser from 'phaser'
import { SPARK_DEPTH, TILE_PX } from '../../render/framing'

/** Une petite braise ronde et douce (24 px) — le grain des flammes et des étincelles. */
const EMBER_KEY = 'fx-ember'
function ensureEmberTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(EMBER_KEY)) return
  const S = 24
  const tex = scene.textures.createCanvas(EMBER_KEY, S, S)
  if (!tex) return
  const ctx = tex.getContext()
  const c = S / 2
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, S, S)
  tex.refresh()
}

interface FireUnit {
  flame: Phaser.GameObjects.Particles.ParticleEmitter
  ember: Phaser.GameObjects.Particles.ParticleEmitter
  smoke: Phaser.GameObjects.Particles.ParticleEmitter
}

export class FireFx {
  private units = new Map<number, FireUnit>()

  constructor(private scene: Phaser.Scene) {
    ensureEmberTexture(scene)
  }

  /** Réconcilie les particules avec les Feux du snapshot (les émetteurs s'animent seuls). */
  update(structures: Structure[]): void {
    const seen = new Set<number>()
    for (const s of structures) {
      if (s.type !== 'fire') continue
      seen.add(s.id)
      if (this.units.has(s.id)) continue
      const cx = s.tx * TILE_PX + TILE_PX / 2
      const cy = s.ty * TILE_PX + TILE_PX / 2
      this.units.set(s.id, this.spawn(cx, cy))
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
    // LES FLAMMES : de petites braises chaudes qui montent en s'écartant un peu et se
    // resserrent en pointe. Additif — elles éclairent le foyer.
    const flame = this.scene.add
      .particles(cx, cy - 1, EMBER_KEY, {
        speedY: { min: -40, max: -22 },
        speedX: { min: -7, max: 7 },
        scale: { start: 0.5, end: 0.03 },
        alpha: { start: 0.42, end: 0 },
        lifespan: { min: 340, max: 620 },
        frequency: 34,
        quantity: 1,
        tint: [0xffe27a, 0xffa842, 0xf05a1e],
        blendMode: 'ADD',
      })
      .setDepth(SPARK_DEPTH)

    // LES BRAISES : rares, vives, minuscules — elles filent vers le haut et meurent vite.
    const ember = this.scene.add
      .particles(cx, cy - 2, EMBER_KEY, {
        speedY: { min: -58, max: -34 },
        speedX: { min: -13, max: 13 },
        scale: { start: 0.12, end: 0 },
        alpha: { start: 0.75, end: 0 },
        lifespan: { min: 460, max: 900 },
        frequency: 200,
        quantity: 1,
        tint: [0xffe9a0, 0xffc258],
        blendMode: 'ADD',
      })
      .setDepth(SPARK_DEPTH + 1)

    // LA FUMÉE : de petites volutes grises qui FILENT vers le haut et disparaissent
    // TRÈS VITE (décision utilisateur). Fondu normal, alpha faible, grain menu : elle
    // n'OFFUSQUE rien — on la devine plus qu'on ne la voit, et elle est déjà partie.
    const smoke = this.scene.add
      .particles(cx, cy - 4, EMBER_KEY, {
        speedY: { min: -50, max: -30 },
        speedX: { min: -6, max: 6 },
        scale: { start: 0.4, end: 0.9 },
        alpha: { start: 0.12, end: 0 },
        lifespan: { min: 400, max: 740 },
        frequency: 150,
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
