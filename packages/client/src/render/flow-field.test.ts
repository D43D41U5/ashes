/**
 * LE CHAMP DE COURANT — testé en pur, contre les garanties dont dépendent le shader
 * d'eau (advection du clapot vers l'aval) et les feuilles qui dérivent : le couloir
 * suit le fil, les marches de Manhattan se lissent en diagonales, le courant expire
 * hors du couloir, et l'eau loin du fil n'a AUCUN courant.
 */
import { describe, expect, it } from 'vitest'
import { buildFlowField, COURANT_VITESSE, flowAt, taperRive, TAPER_RIVE_MAX, TAPER_RIVE_MIN } from './flow-field'

const EAU = 4
const TERRE = 1

/** Un monde 60×40 : une rivière horizontale (bande y∈[14..24], fil y=19, amont x=4 →
 *  aval x=55) et une mare 6×6 isolée au sud-ouest, loin du fil. */
function monde(): { width: number; height: number; terrain: number[]; fil: number[] } {
  const width = 60
  const height = 40
  const terrain = new Array<number>(width * height).fill(TERRE)
  for (let y = 14; y <= 24; y++) for (let x = 2; x <= 57; x++) terrain[y * width + x] = EAU
  for (let y = 32; y <= 37; y++) for (let x = 4; x <= 9; x++) terrain[y * width + x] = EAU
  const fil: number[] = []
  for (let x = 4; x <= 55; x++) fil.push(19 * width + x)
  return { width, height, terrain, fil }
}

describe('le champ de courant — le fil élargi en vecteurs (l’eau suit le flow)', () => {
  it('pas de fil → pas de champ', () => {
    const { fil, ...sansFil } = monde()
    expect(buildFlowField(sansFil)).toBeNull()
    expect(buildFlowField({ ...sansFil, fil: [fil[0]!] })).toBeNull()
  })

  it('au milieu du lit, le courant suit le fil vers l’aval, à pleine vitesse', () => {
    const f = buildFlowField(monde())!
    const v = flowAt(f, 30.5, 19.5)!
    expect(v).not.toBeNull()
    expect(v.x).toBeGreaterThan(0.9) // l'aval est +x, la moyenne 3×3 ne raccourcit pas une ligne droite
    expect(Math.abs(v.y)).toBeLessThan(0.05)
  })

  it('le courant EXPIRE au-delà du couloir (exhalaison), et meurt tout à fait plus loin', () => {
    const f = buildFlowField(monde())!
    // Couloir plein : fil ± 3 → y∈[16..22]. Au bord du couloir, le courant vit encore.
    expect(flowAt(f, 30.5, 22.5)!.x).toBeGreaterThan(0.5)
    // Une tuile d'exhalaison (y=23, hors couloir) : présent mais expiré.
    const exhale = flowAt(f, 30.5, 23.5)
    expect(exhale).not.toBeNull()
    expect(exhale!.x).toBeLessThan(0.6)
    expect(exhale!.x).toBeGreaterThan(0.01)
    // La bande d'eau continue jusqu'à y=24 mais le courant n'y survit pas 2 passes d'expiration…
    const mort = flowAt(f, 30.5, 24.5)
    if (mort) expect(Math.sqrt(mort.x * mort.x + mort.y * mort.y)).toBeLessThan(0.3)
  })

  it('l’eau loin du fil (la mare) n’a AUCUN courant', () => {
    const f = buildFlowField(monde())!
    for (let y = 32; y <= 37; y++)
      for (let x = 4; x <= 9; x++) expect(flowAt(f, x + 0.5, y + 0.5)).toBeNull()
  })

  it('les marches de Manhattan d’un coude se lissent en diagonale continue', () => {
    // Un fil en escalier : +x jusqu'à (20,19), puis alternance x/y vers le sud-est —
    // la marche 4-connexe d'un tracé diagonal réel.
    const width = 60
    const height = 40
    const terrain = new Array<number>(width * height).fill(TERRE)
    for (let y = 14; y <= 34; y++) for (let x = 2; x <= 45; x++) terrain[y * width + x] = EAU
    const fil: number[] = []
    for (let x = 4; x <= 20; x++) fil.push(19 * width + x)
    let px = 20
    let py = 19
    for (let k = 0; k < 20; k++) {
      if (k % 2 === 0) px++
      else py++
      fil.push(py * width + px)
    }
    const f = buildFlowField({ width, height, terrain, fil })!
    // Au cœur de l'escalier, la tangente lissée est ~diagonale (45°) : ni plein +x, ni plein +y.
    const v = flowAt(f, 26.5, 24.5)!
    expect(v).not.toBeNull()
    expect(v.x).toBeGreaterThan(0.3)
    expect(v.y).toBeGreaterThan(0.3)
    const angle = Math.abs(Math.atan2(v.y, v.x) - Math.PI / 4)
    expect(angle).toBeLessThan(0.3) // à ±17° de la diagonale
  })

  it('un index de fil SEC (peinture sautée par la worldgen) ne crashe pas et ne peint pas la terre', () => {
    const m = monde()
    // Un barrage de terre en travers du lit, pile sur un point du fil.
    for (let y = 14; y <= 24; y++) m.terrain[y * m.width + 30] = TERRE
    const f = buildFlowField(m)!
    expect(flowAt(f, 30.5, 19.5)).toBeNull() // la tuile sèche n'a pas de courant
    expect(flowAt(f, 28.5, 19.5)).not.toBeNull() // l'amont, si
  })

  it('la vitesse et le taper partagés sont ceux du contrat feuilles/surface', () => {
    expect(COURANT_VITESSE).toBeCloseTo(0.55, 5)
    expect(taperRive(TAPER_RIVE_MIN)).toBe(0)
    expect(taperRive(TAPER_RIVE_MAX)).toBe(1)
    expect(taperRive(0.4)).toBeGreaterThan(0)
    expect(taperRive(0.4)).toBeLessThan(1)
    // smoothstep : pente continue, monotone.
    expect(taperRive(0.3)).toBeLessThan(taperRive(0.5))
  })
})
