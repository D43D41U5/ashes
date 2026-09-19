/**
 * ═══ LES DRAPEAUX D'UN CORPS — UNE LOI, DEUX LECTEURS (`corps-gpu.ts`) ═══
 *
 * Le nœud empaquette quatre entiers dans un flottant d'attribut (`empaqueterDrapeaux`), le fragment
 * les défait par `floor` après un arrondi. Le miroir JS de ce décodage (`depaqueterDrapeaux`) est
 * tenu ici face à l'empaquetage sur TOUTES les combinaisons — et au bruit d'interpolation : un
 * varying constant sur les quatre sommets revient à un ulp près, pas exactement.
 *
 * Et le texte GLSL est tenu face à la forme : plus aucun uniforme par sprite (c'est ce qui laisse les
 * corps s'empiler dans un lot), les deux varyings et les deux attributs déclarés dans l'addition, le
 * décodage du fragment écrit dans le même ordre que le miroir.
 */
import { describe, expect, it } from 'vitest'
import { ATTRIBUTS_CORPS, GLSL_CORPS, SOL_MAX, VARYINGS_CORPS, depaqueterDrapeaux, empaqueterDrapeaux, empaqueterTeinte, faireAdditionCorps } from './corps-gpu'

describe('les drapeaux d’un corps, empaquetés dans un flottant', () => {
  it('se défont exactement sur toutes les combinaisons, même à un ulp près', () => {
    let n = 0
    for (let sol = 0; sol <= SOL_MAX; sol++) {
      for (const ciel of [0, 1]) {
        for (const ruban of [0, 1]) {
          for (const dresse of [0, 1]) {
            const d = empaqueterDrapeaux(dresse, ruban, ciel, sol)
            // Exact en float32 : l'attribut est un Float32Array.
            expect(Math.fround(d)).toBe(d)
            for (const bruit of [0, 1e-6, -1e-6, 0.25, -0.25]) {
              expect(depaqueterDrapeaux(d + bruit)).toEqual({ dresse, ruban, ciel, sol })
            }
            n++
          }
        }
      }
    }
    expect(n).toBe(2 * 2 * 2 * (SOL_MAX + 1))
  })

  it('sont distincts deux à deux : aucune combinaison n’en recouvre une autre', () => {
    const vus = new Set<number>()
    for (let sol = 0; sol <= SOL_MAX; sol++)
      for (const ciel of [0, 1])
        for (const ruban of [0, 1])
          for (const dresse of [0, 1]) vus.add(empaqueterDrapeaux(dresse, ruban, ciel, sol))
    expect(vus.size).toBe(2 * 2 * 2 * (SOL_MAX + 1))
  })
})

describe('la teinte secondaire empaquetée comme Phaser le fait (`Utils.getTintAppendFloatAlpha`)', () => {
  it('pose l’alpha en octet haut, non signé, le RGB en bas', () => {
    expect(empaqueterTeinte(0x123456, 1)).toBe(0xff123456)
    expect(empaqueterTeinte(0xffffff, 0.5)).toBe(0x7fffffff)
    expect(empaqueterTeinte(0x000000, 0)).toBe(0)
    // `(a × 255) | 0` tronque, et le résultat est un Uint32 (jamais négatif).
    expect(empaqueterTeinte(0xabcdef, 0.999)).toBe(0xfeabcdef)
    expect(empaqueterTeinte(0xabcdef, 1)).toBeGreaterThan(0)
  })
})

describe('le GLSL des corps lit le par-sprite dans les sommets, jamais dans des uniformes', () => {
  it('ne déclare plus aucun uniforme par sprite', () => {
    for (const nom of ['uGiPied', 'uGiAncreX', 'uGiCrete', 'uGiSeuil', 'uGiDresse', 'uGiRuban', 'uGiExpo', 'uGiLift', 'uGiCiel', 'uGiSol']) {
      expect(GLSL_CORPS, nom).not.toMatch(new RegExp(`uniform\\s+float\\s+${nom}\\b`))
    }
  })

  it('lit les deux varyings, que l’addition déclare avec leurs attributs et recopie au sommet', () => {
    expect(GLSL_CORPS).toContain(`${VARYINGS_CORPS.a}.x`)
    expect(GLSL_CORPS).toContain(`${VARYINGS_CORPS.b}.z`)
    const add = faireAdditionCorps(true).additions
    expect(add.outVariables).toContain(`varying vec4 ${VARYINGS_CORPS.a};`)
    expect(add.outVariables).toContain(`varying vec4 ${VARYINGS_CORPS.b};`)
    expect(add.vertexHeader).toContain(`attribute vec4 ${ATTRIBUTS_CORPS.a};`)
    expect(add.vertexHeader).toContain(`attribute vec4 ${ATTRIBUTS_CORPS.b};`)
    expect(add.vertexProcess).toContain(`${VARYINGS_CORPS.a} = ${ATTRIBUTS_CORPS.a};`)
    expect(add.vertexProcess).toContain(`${VARYINGS_CORPS.b} = ${ATTRIBUTS_CORPS.b};`)
  })

  it('défait les drapeaux dans l’ordre du miroir : l’arrondi, puis sol, ciel, ruban, dresse', () => {
    const i = (s: string) => GLSL_CORPS.indexOf(s)
    const arrondi = i(`floor(${VARYINGS_CORPS.b}.z + 0.5)`)
    const sol = i('float sol = floor(drapeaux / 8.0);')
    const ciel = i('float ciel = floor(drapeaux / 4.0);')
    const ruban = i('float ruban = floor(drapeaux / 2.0);')
    const dresse = i('float dresse = drapeaux - 2.0 * ruban;')
    expect(arrondi).toBeGreaterThan(-1)
    expect(sol).toBeGreaterThan(arrondi)
    expect(ciel).toBeGreaterThan(sol)
    expect(ruban).toBeGreaterThan(ciel)
    expect(dresse).toBeGreaterThan(ruban)
  })
})
