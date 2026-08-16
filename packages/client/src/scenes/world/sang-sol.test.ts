import { describe, expect, it } from 'vitest'
import { decorerSang, hachageGoutte, SANG_TEXTURES, teinteSechage, type GoutteSang } from './sang-sol'

/** La cadence réelle du jeu (HUNT.BLOOD_EVERY_TICKS = 16) — recopiée en littéral :
 *  le test vérifie l'appariement à UNE cadence donnée, pas la valeur d'équilibrage. */
const CADENCE = 16

/** Une piste rectiligne : une goutte par intervalle, un pas constant. */
function piste(x0: number, y0: number, pasX: number, pasY: number, n: number, tick0 = 100, phase = 0): GoutteSang[] {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + pasX * i, y: y0 + pasY * i, tick: tick0 + phase + CADENCE * i }))
}

describe('decorerSang — l’orientation suit la course', () => {
  it('une piste vers l’est pointe vers l’est (angle ≈ 0), sauf la première goutte', () => {
    const decors = decorerSang(piste(10, 10, 1.5, 0, 5), CADENCE)
    for (const d of decors.slice(1)) expect(Math.abs(d.angle)).toBeLessThan(0.001)
  })

  it('une piste en diagonale pointe en diagonale', () => {
    const decors = decorerSang(piste(10, 10, 1, 1, 4), CADENCE)
    for (const d of decors.slice(1)) expect(d.angle).toBeCloseTo(Math.PI / 4, 3)
  })

  it('deux pistes entrelacées s’apparient chacune à la SIENNE (phases distinctes)', () => {
    // Une bête vers l'est (phase 0), une vers le sud (phase 7) — les gouttes
    // s'entrelacent dans le tableau chronologique, comme dans la vraie sim.
    const est = piste(10, 10, 1.5, 0, 4, 100, 0)
    const sud = piste(30, 10, 0, 1.5, 4, 100, 7)
    const melange = [...est, ...sud].sort((a, b) => a.tick - b.tick)
    const decors = decorerSang(melange, CADENCE)
    for (let i = 0; i < melange.length; i++) {
      const g = melange[i]!
      if (g.tick < 100 + CADENCE) continue // les deux premières gouttes n'ont pas de précédente
      const versEst = g.y === 10 // la piste est garde y constant
      if (versEst) expect(Math.abs(decors[i]!.angle)).toBeLessThan(0.001)
      else expect(decors[i]!.angle).toBeCloseTo(Math.PI / 2, 3)
    }
  })

  it('au-delà de la portée de course, PAS d’appariement — l’angle vient du hachage', () => {
    // 8 tuiles par intervalle : aucune bête ne court ça — deux pistes distinctes.
    const decors = decorerSang(piste(10, 10, 8, 0, 3), CADENCE)
    const angles = decors.map((d) => d.angle)
    // Si un faux appariement avait eu lieu, tous les angles suivants seraient 0.
    expect(angles.slice(1).some((a) => Math.abs(a) > 0.01)).toBe(true)
  })
})

describe('decorerSang — la variante dit l’allure', () => {
  it('une bête qui stagne laisse la flaque (variante 0)', () => {
    const decors = decorerSang(piste(10, 10, 0.2, 0, 4), CADENCE)
    for (const d of decors.slice(1)) expect(d.variante).toBe(0)
  })

  it('une bête lancée laisse la traînée (variante 2)', () => {
    const decors = decorerSang(piste(10, 10, 3, 0, 4), CADENCE)
    for (const d of decors.slice(1)) expect(d.variante).toBe(2)
  })

  it('au trot : éclaboussure ou gouttelettes (variantes 1/3)', () => {
    const decors = decorerSang(piste(10, 10, 1.2, 0, 6), CADENCE)
    for (const d of decors.slice(1)) expect([1, 3]).toContain(d.variante)
  })

  it('sans précédente, les quatre variantes finissent toutes par servir', () => {
    // 40 gouttes orphelines (ticks espacés hors cadence) : le hachage doit couvrir
    // l'éventail — une piste de premières gouttes ne doit pas être un tampon non plus.
    const gouttes = Array.from({ length: 40 }, (_, i) => ({ x: 5 + i * 7, y: 3 + i * 3, tick: 100 + i * 5 }))
    const variantes = new Set(decorerSang(gouttes, CADENCE).map((d) => d.variante))
    expect(variantes.size).toBe(SANG_TEXTURES.length)
  })
})

describe('decorerSang — stabilité', () => {
  it('deux appels sur les mêmes gouttes rendent EXACTEMENT le même décor (pas de scintillement)', () => {
    const gouttes = [...piste(10, 10, 1.5, 0.3, 6), { x: 50, y: 50, tick: 977 }]
    expect(decorerSang(gouttes, CADENCE)).toEqual(decorerSang(gouttes, CADENCE))
  })

  it('l’échelle respire dans [0,8 ; 1,2]', () => {
    const gouttes = Array.from({ length: 60 }, (_, i) => ({ x: i * 1.3, y: i * 0.7, tick: i * 3 }))
    for (const d of decorerSang(gouttes, CADENCE)) {
      expect(d.echelle).toBeGreaterThanOrEqual(0.8)
      expect(d.echelle).toBeLessThanOrEqual(1.2)
    }
  })

  it('le hachage distingue deux gouttes voisines', () => {
    expect(hachageGoutte(10, 10, 100)).not.toBe(hachageGoutte(10.1, 10, 100))
    expect(hachageGoutte(10, 10, 100)).not.toBe(hachageGoutte(10, 10, 101))
  })
})

describe('teinteSechage — de l’écarlate au brun', () => {
  it('fraîche = texture telle quelle (blanc neutre)', () => {
    expect(teinteSechage(0)).toBe(0xffffff)
  })
  it('sèche = brun terreux, le rouge survivant mieux que le bleu', () => {
    const t = teinteSechage(1)
    const r = (t >> 16) & 0xff
    const b = t & 0xff
    expect(r).toBeGreaterThan(b)
    expect(r).toBeLessThan(255) // elle s'éteint vraiment
  })
  it('borné hors [0;1]', () => {
    expect(teinteSechage(-1)).toBe(0xffffff)
    expect(teinteSechage(2)).toBe(teinteSechage(1))
  })
})
