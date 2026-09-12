/**
 * LES VOIX DE L'EAU SE TIENNENT QUELQUE PART (B3, reprise de l'eau — 2026-09-12).
 *
 * Deux voix passaient sans lieu : le splash d'un AUTRE corps (plein et au centre à trente
 * tuiles comme à trois) et le clapotis de rive (des deux oreilles, l'eau étant d'un côté). On
 * garde ici ce que chaque voix TEND au moteur — le lieu, ou son absence — et la géométrie du
 * point de rive, lue sur le même SDF que le shader et l'immersion.
 */
import { describe, expect, it } from 'vitest'
import { buildRiveField, riveAt } from '../render/water-field'
import { pointDeRive, SonsDeLEau, type JoueUnSon } from './eau-audio'
import type { SoundSpec } from './sound'

const EAU = 4
const TERRE = 1

/** Une mare 4×4 (x et y de 4 à 7) au centre d'un pré 12×12 — le montage de `water-field.test.ts`. */
function mare(): ReturnType<typeof buildRiveField> {
  const w = 12
  const h = 12
  const terrain = new Array(w * h).fill(TERRE)
  for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) terrain[y * w + x] = EAU
  return buildRiveField(terrain, w, h)
}

/** Un moteur qui n'écoute rien mais note tout : le son, son retard, et le lieu tendu. */
function enregistreur(): { play: JoueUnSon; joues: { spec: SoundSpec; delay: number; at: { x: number; y: number } | undefined }[] } {
  const joues: { spec: SoundSpec; delay: number; at: { x: number; y: number } | undefined }[] = []
  return { joues, play: (spec, delay = 0, at) => { joues.push({ spec, delay, at }) } }
}

describe('pointDeRive — le clapotis se tient sur la rive la plus proche', () => {
  it('à terre, à l’ouest de la mare, le point est sur l’arête ouest de l’eau, à la même hauteur', () => {
    const rive = mare()
    const p = pointDeRive(rive, 2, 5.5)
    expect(p).not.toBeNull()
    // L'arête ouest de l'eau est à x = 4 (le zéro du SDF) : on y tombe, et l'écart n'a pas de composante Y.
    expect(p!.x).toBeCloseTo(4, 0)
    expect(Math.abs(p!.y - 5.5)).toBeLessThan(0.15)
    expect(Math.abs(riveAt(rive, p!.x, p!.y))).toBeLessThan(0.35)
    // Et il est À DROITE du corps : c'est de ce côté que le moteur panoramiquera.
    expect(p!.x).toBeGreaterThan(2)
  })

  it('au nord de la mare, le point est en dessous du corps (l’eau est au sud)', () => {
    const rive = mare()
    const p = pointDeRive(rive, 5.5, 2)
    expect(p).not.toBeNull()
    expect(p!.y).toBeGreaterThan(2)
    expect(Math.abs(p!.x - 5.5)).toBeLessThan(0.15)
    expect(Math.abs(riveAt(rive, p!.x, p!.y))).toBeLessThan(0.35)
  })

  it('DANS l’eau, il n’y a pas de point de rive : le clapotis est ici', () => {
    expect(pointDeRive(mare(), 5.5, 5.5)).toBeNull()
  })

  it('sur un pré SANS eau, le champ est plat : pas de direction, donc pas de lieu', () => {
    const w = 12
    const rive = buildRiveField(new Array(w * w).fill(TERRE), w, w)
    expect(pointDeRive(rive, 6, 6)).toBeNull()
  })
})

describe('SonsDeLEau — ce que chaque voix tend au moteur', () => {
  it('le clapotis tend le point de rive ; le patauge (mes pas) n’a pas de lieu', () => {
    const sons = new SonsDeLEau()
    const { play, joues } = enregistreur()
    const rive = { x: 4, y: 5.5 }
    // À deux tuiles de l'eau, immobile : un seul clapotis, sur la rive.
    sons.update(1000, -2, false, play, rive)
    expect(joues).toHaveLength(1)
    expect(joues[0]!.at).toEqual(rive)
    // Dans l'eau et en marche, bien plus tard : le patauge part (sans lieu) — et le clapotis
    // de « ici » (dRive > 0, pas de rive donnée) part au centre aussi.
    sons.update(100_000, 0.5, true, play, null)
    const pas = joues.slice(1)
    expect(pas.length).toBeGreaterThanOrEqual(1)
    expect(pas.every((j) => j.at === undefined)).toBe(true)
  })

  it('le splash d’un AUTRE corps tend son lieu ; le mien reste « ici », byte pour byte', () => {
    const sons = new SonsDeLEau()
    const autre = enregistreur()
    sons.splash(false, autre.play, { x: 10, y: 20 })
    expect(autre.joues).toHaveLength(2)
    expect(autre.joues.every((j) => j.at !== undefined && j.at.x === 10 && j.at.y === 20)).toBe(true)
    const moi = enregistreur()
    sons.splash(true, moi.play, { x: 10, y: 20 })
    expect(moi.joues).toHaveLength(2)
    expect(moi.joues.every((j) => j.at === undefined)).toBe(true)
    // Et « moi » sonne plein là où l'autre sonne feutré (le facteur 0,45 n'a pas bougé).
    expect(moi.joues[0]!.spec.gain).toBeGreaterThan(autre.joues[0]!.spec.gain * 2)
  })
})
