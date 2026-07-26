/**
 * LES POISSONS-OMBRES (spec eau-vivante R14) — l'eau réagit à ta présence avant même
 * que tu la touches.
 *
 * Des TACHES sombres de 8×4 px glissent SOUS la surface (profondeur entre le sol et le
 * quad d'eau : la nappe les teinte d'elle-même), errent lentement dans leur plan d'eau,
 * et FUIENT en dard quand une entité approche à moins d'1,5 tuile. 100 % client, seedé
 * par hash positionnel (zéro `Math.random`), ~6 par écran.
 *
 * ══ LA FRONTIÈRE, écrite ici pour ne pas l'oublier (règle « objets de jeu réels ») ══
 * Tant que la PÊCHE n'existe pas, ces poissons sont du DÉCOR assumé — aucun état sim,
 * aucune interaction de jeu. LE JOUR où la pêche existe, les spawns montent dans /sim
 * (des nœuds récoltables, déterministes, snapshotés) et ce module devient leur RENDU.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { riveAt, type RiveField } from '../../render/water-field'

/** Sous l'eau (−0,75), sur le sol (−1) : la nappe teinte le poisson d'elle-même. */
const POISSON_DEPTH = GROUND_MAP_DEPTH + 0.15
const MAX_POISSONS = 6
/** Rayon (tuiles) autour de la caméra où un poisson peut vivre. */
const RAYON = 26
/** Une entité à moins d'1,5 tuile déclenche la FUITE en dard. */
const RAYON_FUITE = 1.5
const VITESSE_ERRE = 0.35 // tuiles/s
const VITESSE_FUITE = 3.2

const SHALLOW = 4
const DEEP = 6

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

interface Poisson {
  sprite: Phaser.GameObjects.Image
  x: number // tuiles
  y: number
  capX: number
  capY: number
  /** > now = en fuite (le dard dure ~0,6 s), puis retour à l'errance. */
  fuiteJusqua: number
  prochainVirage: number
}

export class PoissonsOmbres {
  private readonly poissons: Poisson[] = []
  private graine = 0
  private prochaine = 0

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    private readonly rive: RiveField,
  ) {
    if (!scene.textures.exists('fx-poisson')) {
      const cv = document.createElement('canvas')
      cv.width = 8
      cv.height = 4
      const ctx = cv.getContext('2d')!
      ctx.fillStyle = 'rgba(16,24,34,0.5)'
      ctx.fillRect(1, 0, 6, 4) // le corps
      ctx.fillStyle = 'rgba(16,24,34,0.35)'
      ctx.fillRect(0, 1, 1, 2) // la queue
      ctx.fillRect(7, 1, 1, 2) // le museau
      scene.textures.addCanvas('fx-poisson', cv)
      scene.textures.get('fx-poisson').setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
  }

  private eau(tx: number, ty: number): boolean {
    if (tx < 1 || ty < 1 || tx >= this.map.width - 1 || ty >= this.map.height - 1) return false
    const t = this.map.terrain[Math.floor(ty) * this.map.width + Math.floor(tx)]
    return t === SHALLOW || t === DEEP
  }

  /** Chaque frame : naissances au compte-gouttes près de la caméra, errance, fuite, cull. */
  update(
    nowMs: number,
    dtMs: number,
    camTx: number,
    camTy: number,
    entites: { x: number; y: number }[],
  ): void {
    // ── Naissances : une tuile d'eau LARGE (≥ 1 tuile du bord) tirée près de la caméra ──
    if (this.poissons.length < MAX_POISSONS && nowMs >= this.prochaine) {
      this.prochaine = nowMs + 900
      for (let essai = 0; essai < 5; essai++) {
        const g = this.graine++
        const tx = camTx + (hache(g, essai, 3) - 0.5) * RAYON * 1.6
        const ty = camTy + (hache(essai, g, 5) - 0.5) * RAYON * 1.6
        if (!this.eau(tx, ty) || riveAt(this.rive, tx, ty) < 0.8) continue
        const a = hache(g, essai, 9) * 6.2831853
        const sprite = this.scene.add
          .image(tx * TILE_PX, ty * TILE_PX, 'fx-poisson')
          .setDepth(POISSON_DEPTH)
        this.poissons.push({
          sprite,
          x: tx,
          y: ty,
          capX: Math.cos(a),
          capY: Math.sin(a),
          fuiteJusqua: 0,
          prochainVirage: nowMs + 1500 + hache(g, 2, 11) * 3000,
        })
        break
      }
    }

    const dtS = dtMs / 1000
    for (let i = this.poissons.length - 1; i >= 0; i--) {
      const p = this.poissons[i]!
      // ── LA FUITE : l'entité la plus proche décide ──
      let menace: { x: number; y: number } | null = null
      let d2min = RAYON_FUITE * RAYON_FUITE
      for (const e of entites) {
        const dx = p.x - e.x
        const dy = p.y - e.y
        const d2 = dx * dx + dy * dy
        if (d2 < d2min) {
          d2min = d2
          menace = e
        }
      }
      if (menace) {
        const dx = p.x - menace.x
        const dy = p.y - menace.y
        const n = Math.sqrt(dx * dx + dy * dy) || 1
        p.capX = dx / n
        p.capY = dy / n
        p.fuiteJusqua = nowMs + 600
      } else if (nowMs >= p.prochainVirage) {
        // l'errance vire sans hâte, d'un cap hashé — jamais deux poissons en banc parfait
        p.prochainVirage = nowMs + 1500 + hache(this.graine++, i, 13) * 3000
        const a = hache(this.graine, i, 17) * 6.2831853
        p.capX = Math.cos(a)
        p.capY = Math.sin(a)
      }
      const vite = nowMs < p.fuiteJusqua ? VITESSE_FUITE : VITESSE_ERRE
      const nx = p.x + p.capX * vite * dtS
      const ny = p.y + p.capY * vite * dtS
      // le poisson ne sort JAMAIS de l'eau : au bord, il vire le long de la berge
      if (this.eau(nx, ny) && riveAt(this.rive, nx, ny) > 0.3) {
        p.x = nx
        p.y = ny
      } else {
        const a = hache(this.graine++, i, 19) * 6.2831853
        p.capX = Math.cos(a)
        p.capY = Math.sin(a)
      }
      // ── Cull hors de portée de la caméra ──
      if (Math.max(Math.abs(p.x - camTx), Math.abs(p.y - camTy)) > RAYON * 1.6) {
        p.sprite.destroy()
        this.poissons.splice(i, 1)
        continue
      }
      p.sprite.setPosition(Math.round(p.x * TILE_PX), Math.round(p.y * TILE_PX))
      p.sprite.setFlipX(p.capX < 0)
      // le dard s'étire un rien (par la LARGEUR d'affichage, pas une échelle continue)
      p.sprite.setDisplaySize(nowMs < p.fuiteJusqua ? 10 : 8, 4)
    }
  }

  /** Sonde du smoke (A8) : combien de poissons vivent, et la distance min à un point. */
  get vivants(): number {
    return this.poissons.length
  }
  distanceMin(tx: number, ty: number): number {
    let d = Infinity
    for (const p of this.poissons) {
      const dd = Math.max(Math.abs(p.x - tx), Math.abs(p.y - ty))
      if (dd < d) d = dd
    }
    return d
  }

  destroy(): void {
    for (const p of this.poissons) p.sprite.destroy()
    this.poissons.length = 0
  }
}
