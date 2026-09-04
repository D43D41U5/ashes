/**
 * LES GARDES DES RUS ET DES CUVETTES — la capillarité et la variété de l'eau de la Racine.
 *
 * Elles se mesurent sur les VRAIES cartes de production (les seeds de garde maison), et leur
 * ÉTALON n'est jamais le réglage qui les a produites :
 *   — A-RU1 se juge contre `FAUNA.GROUND_WATER_NEAR`, la portée qu'un coin de chasse EXIGE —
 *     une règle de jeu, pas une molette de worldgen ;
 *   — A-LAC1 se juge contre la DISPERSION des cuvettes, pas contre leur taille : elle
 *     attraperait le retour du plafond saturé quelle que soit la valeur de ce plafond.
 */
import { describe, expect, it } from 'vitest'
import { FAUNA, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER, TERRAINS } from './balance'
import { carteDeTest } from '../../../tools/carte-cache'
import { type CarteZonee } from './zonegen'
import { COUDE, estUnCoude } from './zonegen-water'

const SEEDS = [2026, 7, 42]
const cartes: CarteZonee[] = SEEDS.map((s) => carteDeTest(s))
const estEau = (t: number | undefined): boolean => t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER

describe('les rus de la Racine (zonegen-rus) — la capillarité', () => {
  /**
   * A-RU1 — LA TERRE À PORTÉE D'EAU.
   *
   * MESURÉ AVANT le chantier (2026-08-30, `tools/__sonde-eau-morpho.mts`) : **80 à 82 %** de la
   * terre marchable de la Racine était à plus de `GROUND_WATER_NEAR` d'une eau — donc incapable
   * de porter un coin de chasse, sur quatre cinquièmes du pays. APRÈS : 40 à 42 %.
   *
   * Le plafond est posé à 55 % : il laisse de la marge au calibrage (`RUS.TETE_FLUX_MIN` est
   * une molette d'œil) tout en rougissant AVANT que le défaut ne revienne. Il reste beaucoup de
   * terre sèche, et c'est voulu — une eau partout ne vaudrait pas mieux qu'une eau nulle part.
   */
  it('A-RU1 — moins de 55 % de la Racine marchable est hors de portée d’eau du gibier', () => {
    for (const c of cartes) {
      const { width: W, height: H, terrain } = c.map
      const dist = new Int32Array(W * H).fill(-1)
      let file: number[] = []
      for (let i = 0; i < W * H; i++) if (estEau(terrain[i])) { dist[i] = 0; file.push(i) }
      while (file.length) {
        const suiv: number[] = []
        for (const i of file) {
          const x = i % W
          const y = (i - x) / W
          const d = dist[i]! + 1
          if (d > FAUNA.GROUND_WATER_NEAR) continue // on ne mesure pas plus loin qu'il ne faut
          for (const j of [x > 0 ? i - 1 : -1, x + 1 < W ? i + 1 : -1, y > 0 ? i - W : -1, y + 1 < H ? i + W : -1]) {
            if (j >= 0 && dist[j] === -1) { dist[j] = d; suiv.push(j) }
          }
        }
        file = suiv
      }
      let marchable = 0
      let loin = 0
      for (let i = 0; i < W * H; i++) {
        if (c.zone[i] !== c.graphe.racine) continue
        if (estEau(terrain[i]) || TERRAINS[terrain[i]!]?.walkable !== true) continue
        marchable++
        if (dist[i] === -1) loin++ // jamais atteint : au-delà de la portée
      }
      const part = loin / marchable
      expect(part, `seed ${c.graphe.seed} : ${(100 * part).toFixed(1)} % hors de portée d’eau`).toBeLessThan(0.55)
    }
  })

  /**
   * A-LAC1 — LES CUVETTES NE SONT PLUS DES JUMELLES.
   *
   * MESURÉ AVANT : 8 à 11 cuvettes sur 17-20 tenaient dans 4 % d'écart autour de 2 100 tuiles,
   * et plusieurs masses d'eau faisaient EXACTEMENT `LAC_MAX_CELLULES × 64` — le plafond était
   * saturé, donc c'est LUI qui donnait sa taille à chaque lac.
   *
   * La garde ne regarde ni la taille ni le plafond : elle regarde la SATURATION. Un plafond
   * atteint par tout le monde entasse les cuvettes contre la plus grande — MESURÉ AVANT : 8 des
   * 17 cuvettes (47 %) tenaient dans ±5 % de la plus grande. C'est ce tas-là qu'on interdit, et
   * la garde survivrait à n'importe quel changement de la valeur du plafond.
   */
  it('A-LAC1 — les cuvettes ne s’entassent pas contre la plus grande (plafond saturé)', () => {
    for (const c of cartes) {
      const { width: W, height: H, terrain } = c.map
      const vu = new Uint8Array(W * H)
      const aires: number[] = []
      for (let s = 0; s < W * H; s++) {
        if (vu[s] || terrain[s] !== TERRAIN_DEEP_WATER) continue
        const pile = [s]
        vu[s] = 1
        let n = 0
        while (pile.length) {
          const i = pile.pop()!
          n++
          const x = i % W
          const y = (i - x) / W
          for (const j of [x > 0 ? i - 1 : -1, x + 1 < W ? i + 1 : -1, y > 0 ? i - W : -1, y + 1 < H ? i + W : -1]) {
            if (j >= 0 && !vu[j] && terrain[j] === TERRAIN_DEEP_WATER) { vu[j] = 1; pile.push(j) }
          }
        }
        if (n >= 32) aires.push(n) // sous 32 tuiles, c'est une flaque, pas une cuvette
      }
      expect(aires.length, `seed ${c.graphe.seed} : pas assez de cuvettes pour juger`).toBeGreaterThanOrEqual(6)
      const max = Math.max(...aires)
      const auPlafond = aires.filter((a) => a >= max * 0.95).length
      const part = auPlafond / aires.length
      expect(part, `seed ${c.graphe.seed} : ${auPlafond}/${aires.length} cuvettes dans ±5 % de la plus grande (${max} t)`)
        .toBeLessThan(0.25)
    }
  })
})

/**
 * LE COUDE — la définition a changé de nature le 2026-08-30 (courbure fenêtrée au lieu de
 * « les deux pas diffèrent »), et elle n'avait plus aucune garde : l'ancienne A2ter, seule à
 * l'exercer, gardait un défaut de peinture qui n'existe plus. Trois cas suffisent, sur des fils
 * FABRIQUÉS — c'est une fonction pure, elle se juge sans carte.
 */
describe('estUnCoude — la courbure fenêtrée', () => {
  const W = 512
  /** Un fil droit de `n` tuiles vers l'est. */
  const droit = (n: number, x0 = 100, y0 = 100): number[] => {
    const f: number[] = []
    for (let i = 0; i < n; i++) f.push(y0 * W + x0 + i)
    return f
  }

  it('une ligne droite n’a AUCUN coude', () => {
    const fil = droit(200)
    let n = 0
    for (let k = 0; k < fil.length; k++) if (estUnCoude(fil, k, W)) n++
    expect(n).toBe(0)
  })

  it('un angle droit rend UN seul coude, au virage', () => {
    // 100 vers l'est, puis 100 vers le sud : le pivot est à l'index 99.
    const fil: number[] = []
    for (let i = 0; i < 100; i++) fil.push(100 * W + 100 + i)
    for (let i = 1; i <= 100; i++) fil.push((100 + i) * W + 199)
    const coudes: number[] = []
    for (let k = 0; k < fil.length; k++) if (estUnCoude(fil, k, W)) coudes.push(k)
    expect(coudes.length, `coudes trouvés : ${coudes.join(',')}`).toBe(1)
    expect(Math.abs(coudes[0]! - 99), 'le coude est AU virage').toBeLessThanOrEqual(COUDE.FENETRE)
  })

  it('un escalier de Manhattan à petits pas n’est PAS une suite de coudes', () => {
    // Le cas qui a motivé la réécriture : une COURBE rastérisée alterne des pas en x et en y.
    // L'ancienne définition (« les deux pas diffèrent ») en aurait fait un coude sur deux.
    const fil: number[] = []
    let x = 100
    let y = 100
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) x++
      else y++
      fil.push(y * W + x)
    }
    let n = 0
    for (let k = 0; k < fil.length; k++) if (estUnCoude(fil, k, W)) n++
    expect(n, 'une diagonale en escalier est une DROITE, pas cent coudes').toBe(0)
  })
})
