/**
 * AU FIL DE L'EAU (spec eau-vivante R15) — le courant se VOIT, sans HUD.
 *
 * Le champ de courant vient de `flow-field.ts` — la SOURCE UNIQUE, partagée avec le
 * shader d'eau qui advecte son clapot dessus : la feuille et la surface qu'elle chevauche
 * vont à la MÊME vitesse (COURANT_VITESSE × le même taper de berge — une feuille ne
 * patine plus sur une eau que la berge freine), le vent chahute d'un rien par-dessus.
 * Et la TRAÎNE POINTILLÉE promise par R15 : des points d'1 px semés aux positions
 * passées, alpha par PALIERS (jamais un dégradé) — le sillage discret qui donne le sens.
 * Les lacs et mares n'ont pas de fil : pas de courant, pas de feuilles — c'est juste.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { COURANT_VITESSE, flowAt, taperRive, type FlowField } from '../../render/flow-field'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { riveAt, type RiveField } from '../../render/water-field'

/** Sur l'eau (−0,75), sous tout le reste : la feuille flotte, elle ne vole pas. */
const FEUILLE_DEPTH = GROUND_MAP_DEPTH + 0.32
const MAX_FEUILLES = 7
const RAYON = 28
/** La traîne (R15) : TRAINE_N points recyclés en anneau, semés tous les TRAINE_PAS_S s. */
const TRAINE_N = 2
const TRAINE_PAS_S = 0.45

/**
 * L'OMBRE DE LA FEUILLE, sur le HAUT-FOND seulement : là on voit le fond (le gué est le
 * cœur lisible du plan d'eau), une feuille qui flotte y pose sa silhouette sombre — en
 * profond, l'eau trouble ne montre pas de fond, donc pas d'ombre. Doctrine contact-shadow :
 * noir en alpha normal, CONSTANTE, jamais orientée soleil. Le décalage de 2 px vers le bas
 * n'est pas un angle de lumière : c'est l'épaisseur d'eau entre la feuille et son lit —
 * sans lui, la feuille (plate) couvrirait exactement son ombre. Profondeur vérifiée contre
 * les voisines : quad d'eau +0,25 < ombre +0,26 < poissons +0,27 (la leçon des poissons).
 */
const OMBRE_DEPTH = GROUND_MAP_DEPTH + 0.26
const OMBRE_ALPHA = 0.3
const OMBRE_DECALE_PX = 2
const SHALLOW = 4

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

interface Feuille {
  sprite: Phaser.GameObjects.Image
  /** L'ombre sur le lit — visible sur le HAUT-FOND seulement. */
  ombre: Phaser.GameObjects.Image
  x: number // tuiles
  y: number
  /** Les points de traîne, anneau recyclé — `tete` désigne le prochain à resemer. */
  traine: Phaser.GameObjects.Image[]
  tete: number
  prochainPoint: number
}

export class FeuillesDerive {
  private readonly feuilles: Feuille[] = []
  private graine = 0
  private prochaine = 0

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    /** Le champ de courant partagé (WaterLayer.flow) — nul : le module est inerte. */
    private readonly flow: FlowField | null,
    /** Le champ de rive partagé (WaterLayer.rive) — le taper de berge des feuilles. */
    private readonly rive: RiveField | null,
  ) {
    if (!flow) return
    // ── Les textures : deux feuilles mortes (tan, rouille) + le point de traîne ──
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
    if (!scene.textures.exists('fx-traine')) {
      const cv = document.createElement('canvas')
      cv.width = 1
      cv.height = 1
      const ctx = cv.getContext('2d')!
      ctx.fillStyle = '#e9e7da' // le ton de l'écume, un cran sous elle
      ctx.fillRect(0, 0, 1, 1)
      scene.textures.addCanvas('fx-traine', cv)
      scene.textures.get('fx-traine').setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
  }

  /** Le vecteur courant local (aval, norme ≤ 1) ou null — sonde du smoke (A9). */
  courantEn(tx: number, ty: number): { x: number; y: number } | null {
    return this.flow ? flowAt(this.flow, tx, ty) : null
  }

  update(nowMs: number, dtMs: number, camTx: number, camTy: number, vent: { x: number; y: number }): void {
    if (!this.flow) return
    // ── Naissances : une tuile de courant près de la caméra ──
    if (this.feuilles.length < MAX_FEUILLES && nowMs >= this.prochaine) {
      this.prochaine = nowMs + 1100
      for (let essai = 0; essai < 6; essai++) {
        const g = this.graine++
        const tx = camTx + (hache(g, essai, 23) - 0.5) * RAYON * 1.7
        const ty = camTy + (hache(essai, g, 29) - 0.5) * RAYON * 1.7
        if (!flowAt(this.flow, tx, ty)) continue
        const sprite = this.scene.add
          .image(tx * TILE_PX, ty * TILE_PX, `fx-feuille-${g % 2}`)
          .setDepth(FEUILLE_DEPTH)
          .setAlpha(0.9)
        const ombre = this.scene.add
          .image(tx * TILE_PX, ty * TILE_PX + OMBRE_DECALE_PX, `fx-feuille-${g % 2}`)
          .setTint(0x10151a)
          .setTintMode(Phaser.TintModes.FILL) // la SILHOUETTE sombre, pas la feuille assombrie
          .setAlpha(OMBRE_ALPHA)
          .setDepth(OMBRE_DEPTH)
          .setVisible(false)
        const traine: Phaser.GameObjects.Image[] = []
        for (let k = 0; k < TRAINE_N; k++) {
          traine.push(
            this.scene.add
              .image(tx * TILE_PX, ty * TILE_PX, 'fx-traine')
              .setDepth(FEUILLE_DEPTH - 0.01)
              .setVisible(false),
          )
        }
        this.feuilles.push({ sprite, ombre, x: tx, y: ty, traine, tete: 0, prochainPoint: nowMs + TRAINE_PAS_S * 1000 })
        break
      }
    }
    const dtS = dtMs / 1000
    for (let i = this.feuilles.length - 1; i >= 0; i--) {
      const f = this.feuilles[i]!
      const c = flowAt(this.flow, f.x, f.y)
      const horsChamp = Math.max(Math.abs(f.x - camTx), Math.abs(f.y - camTy)) > RAYON * 1.7
      if (!c || horsChamp) {
        // sortie du courant (embouchure, berge) ou de la vue : la feuille s'en va
        f.sprite.destroy()
        f.ombre.destroy()
        for (const p of f.traine) p.destroy()
        this.feuilles.splice(i, 1)
        continue
      }
      // L'aval porte À LA VITESSE DE L'EAU : le vecteur raccourcit déjà aux virages
      // (flow-field), le taper de berge est LE MÊME que celui du shader — la feuille
      // et le clapot qu'elle chevauche avancent ensemble, jusque contre la rive.
      const taper = this.rive ? taperRive(riveAt(this.rive, f.x, f.y)) : 1
      f.x += (c.x * COURANT_VITESSE * taper + vent.x * 0.06) * dtS
      f.y += (c.y * COURANT_VITESSE * taper + vent.y * 0.06) * dtS
      f.sprite.setPosition(Math.round(f.x * TILE_PX), Math.round(f.y * TILE_PX))
      f.sprite.setFlipX(c.x < 0)
      // L'ombre sur le lit : HAUT-FOND seulement (en profond, l'eau trouble n'a pas de fond).
      const surGue = this.map.terrain[Math.floor(f.y) * this.map.width + Math.floor(f.x)] === SHALLOW
      f.ombre.setVisible(surGue)
      if (surGue) {
        f.ombre.setPosition(Math.round(f.x * TILE_PX), Math.round(f.y * TILE_PX) + OMBRE_DECALE_PX)
        f.ombre.setFlipX(c.x < 0)
      }
      // ── La traîne pointillée (R15) : au pas, les points existants DESCENDENT d'un
      // palier d'alpha, et le suivant de l'anneau se resème sous la feuille. ──
      if (nowMs >= f.prochainPoint) {
        f.prochainPoint = nowMs + TRAINE_PAS_S * 1000
        for (const p of f.traine) if (p.visible) p.setAlpha(0.2)
        const p = f.traine[f.tete]!
        f.tete = (f.tete + 1) % TRAINE_N
        p.setPosition(Math.round(f.x * TILE_PX), Math.round(f.y * TILE_PX))
        p.setAlpha(0.42)
        p.setVisible(true)
      }
    }
  }

  /** Sondes du smoke (A9) : les feuilles existent et avancent vers l'AVAL. */
  get vivantes(): number {
    return this.feuilles.length
  }

  destroy(): void {
    for (const f of this.feuilles) {
      f.sprite.destroy()
      f.ombre.destroy()
      for (const p of f.traine) p.destroy()
    }
    this.feuilles.length = 0
  }
}
