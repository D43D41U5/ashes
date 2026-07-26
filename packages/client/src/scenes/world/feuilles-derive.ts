/**
 * AU FIL DE L'EAU (spec eau-vivante R15) — le courant se VOIT, sans HUD.
 *
 * La worldgen garde désormais le FIL de la rivière (`map.fil`, amont → aval — une donnée,
 * pas une règle). Au boot, on l'élargit en un CHAMP DE COURANT par tuile de rivière
 * (la direction du segment de fil le plus proche, tamponnée sur la largeur du lit) ; des
 * FEUILLES de 5×4 px y dérivent vers l'aval, portées d'un rien par le vent. Les lacs et
 * mares n'ont pas de fil : pas de courant, pas de feuilles — c'est juste.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'

/** Sur l'eau (−0,75), sous tout le reste : la feuille flotte, elle ne vole pas. */
const FEUILLE_DEPTH = GROUND_MAP_DEPTH + 0.32
const MAX_FEUILLES = 7
const RAYON = 28
const VITESSE = 0.55 // tuiles/s vers l'aval
/** Demi-largeur du tampon de courant autour du fil (le lit fait demi-3). */
const DEMI_LIT = 3

const SHALLOW = 4
const DEEP = 6

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

interface Feuille {
  sprite: Phaser.GameObjects.Image
  x: number
  y: number
}

export class FeuillesDerive {
  /** tuile → direction du courant, encodée en angle seizièmes de tour (0..15). */
  private readonly courant = new Map<number, number>()
  private readonly feuilles: Feuille[] = []
  private graine = 0
  private prochaine = 0

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
  ) {
    // ── Les textures : deux feuilles mortes, tan et rouille ──
    if (!scene.textures.exists('fx-feuille-0')) {
      for (let k = 0; k < 2; k++) {
        const cv = document.createElement('canvas')
        cv.width = 5
        cv.height = 4
        const ctx = cv.getContext('2d')!
        ctx.fillStyle = k === 0 ? '#c9a35a' : '#a8763c'
        ctx.fillRect(0, 1, 5, 2)
        ctx.fillRect(1, 0, 3, 4)
        ctx.fillStyle = k === 0 ? '#8a6a30' : '#6b4826'
        ctx.fillRect(2, 1, 1, 2) // la nervure
        scene.textures.addCanvas(`fx-feuille-${k}`, cv)
        scene.textures.get(`fx-feuille-${k}`).setFilter(Phaser.Textures.FilterMode.NEAREST)
      }
    }
    // ── Le champ de courant : le fil élargi à la largeur du lit ──
    const fil = map.fil
    if (!fil || fil.length < 2) return
    const { width, height, terrain } = map
    const eau = (i: number): boolean => terrain[i] === SHALLOW || terrain[i] === DEEP
    for (let i = 0; i < fil.length - 1; i++) {
      const a = fil[i]!
      const b = fil[i + 1]!
      const ax = a % width
      const ay = (a - ax) / width
      const bx = b % width
      const by = (b - bx) / width
      const angle = Math.atan2(by - ay, bx - ax)
      const code = ((Math.round((angle / (2 * Math.PI)) * 16) % 16) + 16) % 16
      for (let dy = -DEMI_LIT; dy <= DEMI_LIT; dy++) {
        for (let dx = -DEMI_LIT; dx <= DEMI_LIT; dx++) {
          const tx = ax + dx
          const ty = ay + dy
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
          const j = ty * width + tx
          if (eau(j)) this.courant.set(j, code)
        }
      }
    }
  }

  private courantEn(tx: number, ty: number): { x: number; y: number } | null {
    const code = this.courant.get(Math.floor(ty) * this.map.width + Math.floor(tx))
    if (code === undefined) return null
    const a = (code / 16) * 2 * Math.PI
    return { x: Math.cos(a), y: Math.sin(a) }
  }

  update(nowMs: number, dtMs: number, camTx: number, camTy: number, vent: { x: number; y: number }): void {
    if (this.courant.size === 0) return
    // ── Naissances : une tuile de courant près de la caméra, en AMONT de la vue de préférence ──
    if (this.feuilles.length < MAX_FEUILLES && nowMs >= this.prochaine) {
      this.prochaine = nowMs + 1100
      for (let essai = 0; essai < 6; essai++) {
        const g = this.graine++
        const tx = camTx + (hache(g, essai, 23) - 0.5) * RAYON * 1.7
        const ty = camTy + (hache(essai, g, 29) - 0.5) * RAYON * 1.7
        if (!this.courantEn(tx, ty)) continue
        const sprite = this.scene.add
          .image(tx * TILE_PX, ty * TILE_PX, `fx-feuille-${g % 2}`)
          .setDepth(FEUILLE_DEPTH)
          .setAlpha(0.9)
        this.feuilles.push({ sprite, x: tx, y: ty })
        break
      }
    }
    const dtS = dtMs / 1000
    for (let i = this.feuilles.length - 1; i >= 0; i--) {
      const f = this.feuilles[i]!
      const c = this.courantEn(f.x, f.y)
      const horsChamp = Math.max(Math.abs(f.x - camTx), Math.abs(f.y - camTy)) > RAYON * 1.7
      if (!c || horsChamp) {
        // sortie du courant (embouchure, berge) ou de la vue : la feuille s'en va
        f.sprite.destroy()
        this.feuilles.splice(i, 1)
        continue
      }
      // l'aval porte, le vent chahute d'un rien — la trajectoire reste celle de l'eau
      f.x += (c.x * VITESSE + vent.x * 0.06) * dtS
      f.y += (c.y * VITESSE + vent.y * 0.06) * dtS
      f.sprite.setPosition(Math.round(f.x * TILE_PX), Math.round(f.y * TILE_PX))
      f.sprite.setFlipX(c.x < 0)
    }
  }

  /** Sondes du smoke (A9) : les feuilles existent et avancent vers l'AVAL. */
  get vivantes(): number {
    return this.feuilles.length
  }

  destroy(): void {
    for (const f of this.feuilles) f.sprite.destroy()
    this.feuilles.length = 0
  }
}
