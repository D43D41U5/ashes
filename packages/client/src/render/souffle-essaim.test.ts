import { describe, expect, it } from 'vitest'
import { souffleDEssaim, SOUFFLE_AMP, SOUFFLE_PLANCHER, SOUFFLE_RAD_S } from './souffle-essaim'

/** Les maxima locaux du souffle sur `duree` secondes, au pas `pas`. */
function pics(phase: number, duree = 600, pas = 0.05): number[] {
  const out: number[] = []
  let avant = souffleDEssaim(-pas, phase)
  let ici = souffleDEssaim(0, phase)
  for (let t = pas; t < duree; t += pas) {
    const apres = souffleDEssaim(t, phase)
    if (ici > avant && ici > apres) out.push(ici)
    avant = ici
    ici = apres
  }
  return out
}

describe('le souffle d\'un essaim de lucioles', () => {
  it('reste un FACTEUR borné : jamais sous le plancher, jamais au-dessus de 1', () => {
    // Balayage, pas trois instants choisis : c'est la borne d'un multiplicateur d'intensité.
    for (const phase of [0, 1.3, 2.7, 4.9, 6.1]) {
      for (let t = 0; t < 400; t += 0.05) {
        const v = souffleDEssaim(t, phase)
        expect(v).toBeGreaterThanOrEqual(SOUFFLE_PLANCHER)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('ORGANIQUE : deux respirations de suite ne se ressemblent pas', () => {
    // LA garde de la demande d'Alexis (« organique en intensité »), et elle SAIT échouer :
    // remplacer la somme par son seul premier terme donne 1 hauteur distincte sur 40, mesuré.
    const p = pics(1.3).slice(0, 40)
    expect(p.length).toBe(40)
    const distinctes = new Set(p.map((v) => v.toFixed(2))).size
    expect(distinctes).toBeGreaterThan(15)
  })

  it('un SINUS SEUL, lui, rend un métronome — c\'est ce qu\'on refuse', () => {
    // Le contre-exemple est DANS le test : sans lui, « 26 hauteurs distinctes » ne dit rien.
    const sinus = (t: number) => SOUFFLE_PLANCHER + (1 - SOUFFLE_PLANCHER) * (0.5 + 0.5 * Math.sin(SOUFFLE_RAD_S[0] * t + 1.3))
    const p: number[] = []
    let avant = sinus(-0.05)
    let ici = sinus(0)
    for (let t = 0.05; t < 600; t += 0.05) {
      const apres = sinus(t)
      if (ici > avant && ici > apres) p.push(ici)
      avant = ici
      ici = apres
    }
    expect(new Set(p.slice(0, 40).map((v) => v.toFixed(2))).size).toBe(1)
  })

  it('les trois pulsations sont INCOMMENSURABLES — sinon la somme se referme', () => {
    // C'est la PRÉMISSE de la garde du dessus : trois fréquences dans un rapport rationnel
    // simple redonneraient une onde périodique courte, plus riche mais tout aussi apprise.
    const rapports = [SOUFFLE_RAD_S[1] / SOUFFLE_RAD_S[0], SOUFFLE_RAD_S[2] / SOUFFLE_RAD_S[1]]
    for (const r of rapports) {
      for (let q = 1; q <= 6; q++) {
        for (let p = 1; p <= 6; p++) {
          if (Math.abs(r - p / q) < 0.02) throw new Error(`rapport ${r} trop proche de ${p}/${q}`)
        }
      }
    }
    expect(rapports.every((r) => r > 1)).toBe(true)
  })

  it('les amplitudes somment à 0,5 : le brut couvre exactement [0, 1] avant plancher', () => {
    expect(SOUFFLE_AMP[0] + SOUFFLE_AMP[1] + SOUFFLE_AMP[2]).toBeCloseTo(0.5, 10)
  })
})
