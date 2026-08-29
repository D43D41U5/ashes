/**
 * LA COUCHE DU VENT — elle peint les serpentins (`vent-serpentins.ts`, spec `vent.md` V9).
 *
 * Elle ne décide rien : le champ avance, elle pose des rectangles. Même partage que
 * `meteo-particules` / `meteo-layer`, et pour la même raison — la physique doit se tester en
 * Node, et le rendu ne se teste qu'à l'œil.
 *
 * PROFONDEUR : À HAUTEUR D'AIR — au-dessus du sol et de tout ce qui s'y tient, SOUS les
 * houppiers. Le ruban file donc entre les troncs et passe DERRIÈRE la cime : c'est ce qui le
 * met dans le monde. Placé au-dessus du rideau de pluie (l'état d'avant, `METEO_DEPTH − 100`),
 * il se lisait sur la vitre, à la même strate que la météo — un calque, pas du vent.
 */

import Phaser from 'phaser'
import { CROWN_BASE, TILE_PX } from '../../render/framing'
import type { Vue } from './meteo-particules'
import { alphaDuSerpentin, ChampSerpentins, GRAIN_SERPENTIN_PX, positionSerpentin } from './vent-serpentins'

/**
 * ENTRE LE SOL ET LE HOUPPIER (choix d'Alexis, 2026-08-25).
 *
 * La bande de tri Y monte avec la carte (`Y_SORT_BASE + y·TILE_PX`, ~58 600 au sud de la vallée
 * canonique) ; la bande des houppiers part de `CROWN_BASE` (900 000). Entre les deux, tout un
 * intervalle vide : c'est la hauteur d'air où le vent passe. On s'y pose PAR DÉRIVATION du
 * plancher des cimes — écrire 800 000 en dur laisserait la couche derrière si la canopée
 * bougeait.
 */
export const VENT_DEPTH = CROWN_BASE - 1000

/** La teinte d'un ruban — un blanc cassé, très transparent : on le voit passer, on ne le
 *  regarde pas. Le vent n'est pas un personnage. */
const TEINTE = 0xd8e4ee
/** ⚠ C'est un PLAFOND, pas l'opacité peinte : le palier le plus clair vaut `ALPHA_MAX × 0,875 ×
 *  0,9`. À 0,14, la tête d'un ruban culmine donc à ~0,11 — on le voit passer du coin de l'œil,
 *  on ne le regarde pas. (0,34 → 0,22 → 0,14, deux baisses demandées le 2026-08-25.) */
const ALPHA_MAX = 0.14

/**
 * Les paliers d'opacité le long de la traînée, et la PENTE de l'effilement.
 *
 * ⚠ C'ÉTAIT 3 CRANS EN `part²`, ET ÇA MANGEAIT LE TRACÉ. Sous cette loi, les deux tiers arrière
 * d'une traînée tombent sous 0,03 d'opacité : ce qui reste visible est le seul tiers de tête,
 * donc un segment — la vrille du tourbillon s'y lisait comme un arc. Cinq crans, pente linéaire :
 * la queue s'éteint toujours, mais la FORME survit jusqu'au bout. Mesuré sur planche, pas deviné.
 */
const CRANS = 5

/** Les paliers d'ÂGE. La tête d'un ruban s'allume et s'éteint en continu (le fuseau) ; peinte
 *  telle quelle, chaque ruban aurait sa propre opacité, donc son propre `fillStyle`. On la
 *  quantifie : `NIVEAUX × CRANS` styles au total, quelle que soit la population. */
const NIVEAUX = 4

/** Combien de points on échantillonne par cellule de grille. Un tracé qui VRILLE est plus long
 *  que sa course : sous-échantillonné, il se peint en pointillés. La déduplication (voir
 *  `peindre`) absorbe le surplus, donc on prend large. */
const SUR_ECHANTILLON = 3

export class VentLayer {
  private readonly champ = new ChampSerpentins()
  private readonly g: Phaser.GameObjects.Graphics
  private lastMs: number | null = null
  /** Les cellules déjà peintes, UN JEU PAR RUBAN, réutilisés d'une image à l'autre. */
  private readonly vus: Set<number>[] = []
  private readonly p = { x: 0, y: 0 }

  /** LU PAR LE SMOKE : ce que la couche a réellement semé cette image. */
  readonly sonde = { vivants: 0, cible: 0, rects: 0 }

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(VENT_DEPTH).setVisible(false)
    for (let i = 0; i < this.champ.serpentins.length; i++) this.vus.push(new Set<number>())
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
   * Des rectangles à bords francs sur la grille du ruban (2 px) — une demi-grille sous celle
   * des FX de lumière, décidée sur planche : « des lignes assez fines ».
   *
   * ═══ LA TRAÎNÉE EST UN PASSÉ, PAS UN SEGMENT ═══
   *
   * Le tracé retenu VRILLE (voir `vent-serpentins`) : la traînée n'est plus une droite derrière
   * la tête, c'est la SUITE DES POSITIONS QU'ELLE A OCCUPÉES. On la remonte en interrogeant la
   * forme close à des âges passés — aucun historique gardé, aucune allocation par image.
   *
   * Deux pièges, tous deux invisibles tant que le tracé était droit :
   * — UNE CELLULE PEUT REVENIR. Près du cœur de la vrille, le tracé se tasse : la même cellule
   *   est rencontrée deux fois et se peindrait deux fois, donc DEUX FOIS PLUS OPAQUE — un nœud
   *   brillant au milieu du ruban. D'où le jeu de cellules vues, un par ruban, tenu sur toute
   *   l'image (les crans se peignent du plus proche de la tête au plus lointain : à cellule
   *   partagée, c'est le cran le plus clair qui gagne, ce qui est le bon sens de lecture).
   * — LE PAS D'ÉCHANTILLONNAGE SUIT LA COURSE, PAS L'ARC. Une vrille est plus longue que la
   *   distance parcourue : on sur-échantillonne (`SUR_ECHANTILLON`), la déduplication fait le
   *   ménage.
   *
   * ⚠ L'ORDRE DES BOUCLES EST LE SUJET. `meteo-layer` le dit pour la pluie — « deux `fillStyle`
   * par ciel, pas un par particule : chaque changement de style rompt le lot », deux styles pour
   * 650 gouttes. Peindre serpentin-par-serpentin en aurait coûté `population × CRANS`. On boucle
   * donc sur les STYLES à l'extérieur et sur les rubans à l'intérieur : `NIVEAUX × CRANS` styles
   * au total, que le cadre en porte trois ou neuf.
   */
  private peindre(): void {
    const g = this.g.clear().setVisible(true)
    const parTuile = TILE_PX / GRAIN_SERPENTIN_PX
    for (const jeu of this.vus) jeu.clear()
    let rects = 0
    for (let niveau = 0; niveau < NIVEAUX; niveau++) {
      for (let cran = 0; cran < CRANS; cran++) {
        // Le palier prend l'opacité du MILIEU de sa tranche : la tête garde presque tout,
        // la queue n'en retient qu'un souffle. Pente LINÉAIRE (voir `CRANS`).
        const part = 1 - (cran + 0.5) / CRANS
        const age = (niveau + 0.5) / NIVEAUX
        g.fillStyle(TEINTE, ALPHA_MAX * age * part)
        for (let i = 0; i < this.champ.serpentins.length; i++) {
          const s = this.champ.serpentins[i]!
          if (s.vie < 0) continue
          const tete = alphaDuSerpentin(s.vie, s.duree)
          if (tete <= 0) continue
          // Le ruban n'appartient qu'à UN niveau d'âge : celui où son fuseau le range.
          if (Math.min(NIVEAUX - 1, Math.floor(tete * NIVEAUX)) !== niveau) continue
          const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy)
          if (v === 0) continue
          // La traînée couvre `longueur` tuiles de course — ou toute la vie du ruban s'il
          // vient de naître : elle POUSSE derrière lui, elle n'existe pas d'un coup.
          const span = Math.min(s.vie, s.longueur / v)
          const n = Math.max(2, Math.round(s.longueur * parTuile * SUR_ECHANTILLON))
          const debut = Math.floor((cran * n) / CRANS)
          const fin = Math.floor(((cran + 1) * n) / CRANS)
          const jeu = this.vus[i]!
          for (let k = debut; k < fin; k++) {
            positionSerpentin(s, s.vie - (k / n) * span, this.p)
            const cx = Math.floor(this.p.x * parTuile)
            const cy = Math.floor(this.p.y * parTuile)
            const clef = cx * 65_536 + cy
            if (jeu.has(clef)) continue
            jeu.add(clef)
            g.fillRect(cx * GRAIN_SERPENTIN_PX, cy * GRAIN_SERPENTIN_PX, GRAIN_SERPENTIN_PX, GRAIN_SERPENTIN_PX)
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
