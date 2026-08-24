/**
 * LA COUCHE DU VENT — elle peint les serpentins (`vent-serpentins.ts`, spec `vent.md` V9).
 *
 * Elle ne décide rien : le champ avance, elle pose des rectangles. Même partage que
 * `meteo-particules` / `meteo-layer`, et pour la même raison — la physique doit se tester en
 * Node, et le rendu ne se teste qu'à l'œil.
 *
 * PROFONDEUR : au-dessus du monde, mais SOUS le grain de la pluie. Un ruban qui passerait
 * devant le rideau donnerait l'impression d'être sur la vitre plutôt que dans l'air.
 */

import Phaser from 'phaser'
import { TILE_PX } from '../../render/framing'
import { METEO_DEPTH } from './meteo-layer'
import type { Vue } from './meteo-particules'
import { alphaDuSerpentin, ChampSerpentins, GRAIN_PX } from './vent-serpentins'

/** Juste sous le rideau météo : dans l'air, pas sur la vitre. */
export const VENT_DEPTH = METEO_DEPTH - 100

/** La teinte d'un ruban — un blanc cassé, très transparent : on le voit passer, on ne le
 *  regarde pas. Le vent n'est pas un personnage. */
const TEINTE = 0xd8e4ee
const ALPHA_MAX = 0.34

/** Les paliers d'opacité le long de la traînée — trois : assez pour lire un effilement, assez
 *  peu pour ne pas rompre le lot à chaque cellule. */
const CRANS = 3

/** Les paliers d'ÂGE. La tête d'un ruban s'allume et s'éteint en continu (le fuseau) ; peinte
 *  telle quelle, chaque ruban aurait sa propre opacité, donc son propre `fillStyle`. On la
 *  quantifie : `NIVEAUX × CRANS` styles au total, quelle que soit la population. */
const NIVEAUX = 4

export class VentLayer {
  private readonly champ = new ChampSerpentins()
  private readonly g: Phaser.GameObjects.Graphics
  private lastMs: number | null = null

  /** LU PAR LE SMOKE : ce que la couche a réellement semé cette image. */
  readonly sonde = { vivants: 0, cible: 0, rects: 0 }

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(VENT_DEPTH).setVisible(false)
  }

  /**
   * UNE IMAGE. `cap` est le vent de la sim (unitaire), `part` la part de souffle au-dessus de
   * l'ambiance — 0 au calme, 1 au cœur d'une bande. À 0, la couche s'éteint entièrement : un
   * serpentin permanent serait du bruit, pas un présage.
   */
  update(nowMs: number, cap: { x: number; y: number }, part: number, camera: Phaser.Cameras.Scene2D.Camera): void {
    const dt = this.lastMs === null ? 0 : Math.min(0.25, Math.max(0, (nowMs - this.lastMs) / 1000))
    this.lastMs = nowMs
    const vue: Vue = {
      x0: camera.worldView.x / TILE_PX,
      y0: camera.worldView.y / TILE_PX,
      x1: (camera.worldView.x + camera.worldView.width) / TILE_PX,
      y1: (camera.worldView.y + camera.worldView.height) / TILE_PX,
    }
    this.champ.update(dt, vue, cap, part)
    if (this.champ.vivants === 0) {
      this.g.clear().setVisible(false)
      this.sonde.vivants = 0
      this.sonde.cible = this.champ.cible
      this.sonde.rects = 0
      return
    }
    this.peindre()
  }

  /**
   * Des rectangles à bords francs sur la grille de 4 px — le grain des FX de lumière.
   *
   * ═══ LA QUEUE S'EFFILE, ET C'EST CE QUI EN FAIT DU VENT ═══
   *
   * Peint à opacité constante, un ruban est une BARRE : la planche du banc montrait des traits
   * horizontaux réguliers qui se lisaient comme un artefact de compression, pas comme un
   * souffle. Ce qui manquait n'est pas la finesse — c'est le DÉGRADÉ le long de la traînée :
   * la tête est nette, la queue se dissout. Elle est peinte par CRANS (trois paliers, pas un
   * `fillStyle` par cellule), pour la raison qui vaut aussi pour la pluie : chaque changement
   * de style rompt le lot.
   */
  private peindre(): void {
    const g = this.g.clear().setVisible(true)
    const parTuile = TILE_PX / GRAIN_PX
    let rects = 0
    // ⚠ L'ORDRE DES BOUCLES EST LE SUJET. `meteo-layer` le dit pour la pluie — « deux
    // `fillStyle` par ciel, pas un par particule : chaque changement de style rompt le lot »,
    // deux styles pour 650 gouttes. Peindre serpentin-par-serpentin en aurait coûté
    // `population × CRANS`. On boucle donc sur les STYLES à l'extérieur et sur les rubans à
    // l'intérieur : `NIVEAUX × CRANS` styles au total, que le cadre en porte trois ou quatorze.
    for (let niveau = 0; niveau < NIVEAUX; niveau++) {
      for (let cran = 0; cran < CRANS; cran++) {
        // Le palier prend l'opacité du MILIEU de sa tranche : la tête garde presque tout,
        // la queue n'en retient qu'un souffle.
        const part = 1 - (cran + 0.5) / CRANS
        const age = (niveau + 0.5) / NIVEAUX
        g.fillStyle(TEINTE, ALPHA_MAX * age * part * part)
        for (const s of this.champ.serpentins) {
          if (s.vie < 0) continue
          const tete = alphaDuSerpentin(s.vie, s.duree)
          if (tete <= 0) continue
          // Le ruban n'appartient qu'à UN niveau d'âge : celui où son fuseau le range.
          if (Math.min(NIVEAUX - 1, Math.floor(tete * NIVEAUX)) !== niveau) continue
          // Le ruban est une SUITE DE CELLULES le long de son cap — quantifiées, jamais un
          // trait lissé. Une cellule par pas de grille : la longueur en tuiles donne le compte.
          const n = Math.max(1, Math.round(s.longueur * parTuile))
          const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy)
          const ux = v === 0 ? 1 : s.vx / v
          const uy = v === 0 ? 0 : s.vy / v
          const debut = Math.floor((cran * n) / CRANS)
          const fin = Math.floor(((cran + 1) * n) / CRANS)
          for (let i = debut; i < fin; i++) {
            // Il se dessine DERRIÈRE sa tête : c'est une traînée, elle suit.
            const cx = Math.floor((s.x - ux * (i / parTuile)) * parTuile)
            const cy = Math.floor((s.y - uy * (i / parTuile)) * parTuile)
            g.fillRect(cx * GRAIN_PX, cy * GRAIN_PX, GRAIN_PX, GRAIN_PX)
            rects++
          }
        }
      }
    }
    this.sonde.vivants = this.champ.vivants
    this.sonde.cible = this.champ.cible
    this.sonde.rects = rects
  }

  destroy(): void {
    this.g.destroy()
  }
}
