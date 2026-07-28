/**
 * LES BANCS VOYAGEURS — la garniture V2 de la brume (choix d'Alexis du 2026-07-26 : V1+V2).
 *
 * Des nappes DISCRÈTES : elles naissent sur les GRANDES EAUX seulement (le lac, la rivière
 * large — jamais une flaque), dérivent au vent lissé du monde, s'éteignent par paliers.
 * Leur raison d'être est le VOLUME que le drap plein écran ne donnera jamais : chaque banc
 * vit dans la bande de profondeur des HOUPPIERS, trié par sa rangée — l'un passe DEVANT un
 * arbre, l'autre DERRIÈRE. La marée (V1) coiffe le monde au-dessus ; les bancs voyagent dessous.
 *
 * La grammaire FX maison, au pied de la lettre : silhouettes blocky au grain 4 px (NEAREST),
 * 3 crans d'alpha bakés dans la texture, vacillement par l'alpha (jamais par la taille),
 * spawn seedé par hash positionnel — zéro Math.random. Purement cosmétique, zéro /sim.
 *
 * Inspiration consignée (recherche du 26/07) : Sea of Thieves — le banc est un OBJET qu'on
 * voit arriver, pas un état ; Don't Starve — la brume par nappes locales liées au lieu.
 */
import Phaser from 'phaser'
import { TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER, type WorldMap } from '@ashes/sim'
import { crownDepth, TILE_PX } from '../../render/framing'
import { brumeDuMatin, lerpColor } from '../../render/lighting'

/** Largeurs des 4 gabarits de banc, en tuiles (hauteur ≈ 0,55×). */
const GABARITS = [7, 9, 11, 13]
const GRAIN = 4
/** Flotte maximale autour de la caméra — la rareté est l'identité du banc (pas un drap). */
const MAX_BANCS = 5
/** Rayon (tuiles) autour de la caméra où un banc peut naître, et au-delà duquel il meurt. */
const RAYON_SPAWN = 34
const RAYON_CULL = 60
/** Écart minimal entre deux bancs à la naissance : jamais un empilement d'alpha. */
const ECART_MIN = 14
/** Dérive (tuiles/s) appliquée au vent lissé — même ordre que les nappes de la marée. */
const VITESSE = 0.26
/** Fenêtre de naissance (heures) ; la vie et l'enveloppe globale font le reste. */
const NAISSANCE = { debut: 4.6, fin: 6.6 }
const VIE_MIN = 1.5
const VIE_MAX = 3
const FONDU_IN = 0.35
const FONDU_OUT = 0.5
const ALPHA_MAX = 0.55
/** Teinte de nuit des bancs — la même que la marée (plancher nocturne du shader de nappes). */
const TEINTE_NUIT = 0x6b7599

function hache(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(s, 0x2c1b3c6d)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  // ÷ 0x10000, pas 0xffff : borne [0,1) STRICTE — un hash d'INDEXATION qui rend 1,0 exact
  // tire eligibles[length] (TypeError) et le gabarit fantôme fx-banc-4 (revue, MESURÉ).
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

interface Banc {
  sprite: Phaser.GameObjects.Image
  x: number // px monde (centre)
  y: number
  naissance: number // heure de jeu
  vie: number // heures de jeu avant le fondu de sortie
  allure: number // facteur de dérive propre (0,8..1,2)
  phase: number // le vacillement d'alpha ne bat pas d'un banc à l'autre
  demiH: number // px — pour la rangée de tri (le PIED du banc)
}

export class MistBanks {
  private scene: Phaser.Scene
  private eligibles: { tx: number; ty: number }[] = []
  private bancs: Banc[] = []
  private prochaine = 0
  private graine = 0

  constructor(scene: Phaser.Scene, map: WorldMap) {
    this.scene = scene
    this.bakeTextures(scene)

    // ── Les GRANDES EAUX : une tuile d'eau dont tout le voisinage (Tchebychev ≤ 2) est de
    //    l'eau — l'intérieur du lac et le cœur de la rivière large, jamais une flaque. ──
    const { width, height, terrain } = map
    const eau = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false
      const t = terrain[y * width + x]!
      return t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER
    }
    const combe = map.zones.find((z) => z.kind === 'combe_brumeuse')
    const dansCombe = (x: number, y: number): boolean =>
      !!combe && x >= combe.x - 2 && x < combe.x + combe.w + 2 && y >= combe.y - 2 && y < combe.y + combe.h + 2
    for (let ty = 2; ty < height - 2; ty += 2) {
      boucle: for (let tx = 2; tx < width - 2; tx += 2) {
        if (dansCombe(tx, ty)) continue
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) if (!eau(tx + dx, ty + dy)) continue boucle
        this.eligibles.push({ tx, ty })
      }
    }
  }

  /** 4 gabarits de nappe, bakés une fois : ellipse découpée par un bruit-valeur INTERPOLÉ
   *  (regardé au smoke : le hash par cellule indépendant rendait un poivre-et-sel de pixels
   *  isolés, pas une nappe), 3 crans d'alpha, cellules de 4 px, NEAREST. */
  private bakeTextures(scene: Phaser.Scene): void {
    // Bruit-valeur lissé sur une grille de ~3,5 cellules : les plaques se tiennent.
    const vnoise = (px: number, py: number, s: number): number => {
      const ix = Math.floor(px)
      const iy = Math.floor(py)
      const fx = px - ix
      const fy = py - iy
      const u = fx * fx * (3 - 2 * fx)
      const v = fy * fy * (3 - 2 * fy)
      const a = hache(ix, iy, s)
      const b = hache(ix + 1, iy, s)
      const c = hache(ix, iy + 1, s)
      const d = hache(ix + 1, iy + 1, s)
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
    }
    GABARITS.forEach((tuiles, k) => {
      const key = `fx-banc-${k}`
      if (scene.textures.exists(key)) return
      const W = tuiles * TILE_PX
      const H = Math.round(tuiles * 0.55) * TILE_PX
      const cv = document.createElement('canvas')
      cv.width = W
      cv.height = H
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      for (let cy = 0; cy < H / GRAIN; cy++) {
        for (let cx = 0; cx < W / GRAIN; cx++) {
          const nx = ((cx + 0.5) / (W / GRAIN)) * 2 - 1
          const ny = ((cy + 0.5) / (H / GRAIN)) * 2 - 1
          const r = nx * nx + ny * ny
          if (r >= 1) continue
          const n = vnoise(cx / 3.5, cy / 3.5, 31 + k)
          const v = (1 - r) * (0.45 + 0.75 * n)
          if (v < 0.16) continue
          const lum = v >= 0.52 ? 1.13 : v >= 0.32 ? 1 : 0.93
          const a = v >= 0.52 ? 0.85 : v >= 0.32 ? 0.6 : 0.3
          ctx.fillStyle = `rgba(${Math.round(214 * lum)}, ${Math.round(221 * lum)}, ${Math.min(255, Math.round(232 * lum))}, ${a})`
          ctx.fillRect(cx * GRAIN, cy * GRAIN, GRAIN, GRAIN)
        }
      }
      scene.textures.addCanvas(key, cv)
      scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
    })
  }

  update(
    nowMs: number,
    dtMs: number,
    hour: number,
    vent: { x: number; y: number },
    day: number,
    camTx: number,
    camTy: number,
  ): void {
    const enveloppe = brumeDuMatin(hour)
    // ── Naissances : dans la fenêtre seulement, au compte-gouttes (un contrôle par ~700 ms),
    //    sur une grande eau proche de la caméra, jamais collé à un banc vivant. ──
    if (
      hour >= NAISSANCE.debut &&
      hour <= NAISSANCE.fin &&
      this.bancs.length < MAX_BANCS &&
      nowMs >= this.prochaine &&
      this.eligibles.length > 0
    ) {
      this.prochaine = nowMs + 700
      // D'ABORD le voisinage, ENSUITE le hasard : tirer sur toute la carte puis rejeter le
      // lointain ratait presque toujours (mesuré au smoke : 0-1 banc là où la flotte en veut 5).
      const proches = this.eligibles.filter(
        (c) => Math.max(Math.abs(c.tx - camTx), Math.abs(c.ty - camTy)) <= RAYON_SPAWN,
      )
      for (let essai = 0; essai < 6 && proches.length > 0 && this.bancs.length < MAX_BANCS; essai++) {
        const cell = proches[Math.floor(hache(this.graine++, essai, 53) * proches.length)]!
        if (
          this.bancs.some(
            (b) => Math.max(Math.abs(b.x / TILE_PX - cell.tx), Math.abs(b.y / TILE_PX - cell.ty)) < ECART_MIN,
          )
        )
          continue
        const g = this.graine
        const k = Math.floor(hache(cell.tx, cell.ty, g) * GABARITS.length)
        const sprite = this.scene.add
          .image(cell.tx * TILE_PX, cell.ty * TILE_PX, `fx-banc-${k}`)
          .setAlpha(0)
        this.bancs.push({
          sprite,
          x: cell.tx * TILE_PX,
          y: cell.ty * TILE_PX,
          naissance: hour,
          vie: VIE_MIN + (VIE_MAX - VIE_MIN) * hache(cell.ty, cell.tx, g + 1),
          allure: 0.8 + 0.4 * hache(cell.tx, g, 7),
          phase: hache(g, cell.ty, 11) * 6.28,
          demiH: sprite.height / 2,
        })
        break
      }
    }

    // ── Vies : dérive au vent, fondu d'entrée/sortie par paliers d'alpha, mort au cull. ──
    const dtS = dtMs / 1000
    // L'aube éclaire les bancs avant le sol — même racine du jour que le shader de nappes.
    const teinte = lerpColor(TEINTE_NUIT, 0xffffff, Math.sqrt(Math.max(0, day)))
    for (let i = this.bancs.length - 1; i >= 0; i--) {
      const b = this.bancs[i]!
      const age = hour - b.naissance
      const sortie = 1 - Math.max(0, age - b.vie) / FONDU_OUT
      const entree = Math.min(1, age / FONDU_IN)
      const dCam = Math.max(Math.abs(b.x / TILE_PX - camTx), Math.abs(b.y / TILE_PX - camTy))
      // âge négatif = l'heure a sauté en arrière (debug) ; enveloppe nulle = fenêtre fermée.
      if (age < 0 || sortie <= 0 || enveloppe <= 0.001 || dCam > RAYON_CULL) {
        b.sprite.destroy()
        this.bancs.splice(i, 1)
        continue
      }
      b.x += vent.x * VITESSE * b.allure * dtS * TILE_PX
      b.y += vent.y * VITESSE * b.allure * dtS * TILE_PX
      // Le vacillement : par l'ALPHA, jamais par la taille (la grammaire FX maison).
      const vacille = 1 + 0.08 * Math.sin(nowMs / 2300 + b.phase)
      b.sprite
        .setPosition(Math.round(b.x), Math.round(b.y))
        .setAlpha(ALPHA_MAX * entree * Math.min(1, sortie) * Math.min(1, enveloppe * 3) * vacille)
        .setTint(teinte)
        .setDepth(crownDepth((b.y + b.demiH) / TILE_PX, TILE_PX) + 1)
    }
  }

  destroy(): void {
    for (const b of this.bancs) b.sprite.destroy()
    this.bancs = []
  }
}
