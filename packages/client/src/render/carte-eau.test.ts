/**
 * LES GARDES DE L'EAU DU JOUR SUR LA CARTE (C1, décisions d'Alexis du 2026-09-12 : tout
 * l'arpenté au jour, l'assec en vase dédiée, la crue avec les deux eaux de la carte).
 * Modules purs : on peint dans un tampon et on lit des octets — comme `carte-savoir.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { EAU, TERRAIN_DEEP_WATER, TERRAIN_GRASS, TERRAIN_SHALLOW_WATER, type WorldMap } from '@ashes/sim'
import { creerBrouillard, revele } from './fog'
import { couleurEauCarte, couleurVaseCarte, griserPx, peindreCarteArt, type CarteArt } from './carte-art'
import { peindreSavoirRegion } from './carte-savoir'
import { cleDuRegime, deriverEauDuJour, EAU_JOUR_ASSEC, EAU_JOUR_GUE_FERME, EAU_JOUR_NOYEE, estEauDuJour } from './carte-eau'

const COTE = 96
/** Une vallée jouet : de l'herbe, une mare d'eau peu profonde (24..40)² au cœur profond (29..35)²,
 *  et un champ de distance à l'eau (Chebyshev) — le contrat de `terreNoyee` ne lit que lui. */
function vallee(): WorldMap {
  const terrain = new Array<number>(COTE * COTE).fill(TERRAIN_GRASS)
  for (let y = 24; y <= 40; y++) for (let x = 24; x <= 40; x++) terrain[y * COTE + x] = TERRAIN_SHALLOW_WATER
  for (let y = 29; y <= 35; y++) for (let x = 29; x <= 35; x++) terrain[y * COTE + x] = TERRAIN_DEEP_WATER
  const distEau = new Array<number>(COTE * COTE).fill(0)
  for (let y = 0; y < COTE; y++) {
    for (let x = 0; x < COTE; x++) {
      const t = terrain[y * COTE + x]
      if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) continue
      distEau[y * COTE + x] = Math.max(0, Math.max(24 - x, x - 40, 24 - y, y - 40))
    }
  }
  return { width: COTE, height: COTE, terrain, zones: [], distEau } as unknown as WorldMap
}

function art(map: WorldMap): CarteArt {
  return peindreCarteArt(map, new Uint32Array(map.width * map.height).fill(0x3e7d3a))
}

/** Peint TOUT l'arpenté (tout est vu), le joueur loin ou absent selon `joueur`. */
function peindre(map: WorldMap, a: CarteArt, eau: Uint8Array | null, joueur: { x: number; y: number } | null = null): Uint8ClampedArray {
  const b = creerBrouillard(COTE, COTE)
  revele(b, COTE / 2, COTE / 2, 9999)
  const data = new Uint8ClampedArray(map.width * map.height * 4)
  peindreSavoirRegion(data, a, map, b, 2026, joueur, 22, 0, 0, b.cols - 1, b.rows - 1, eau)
  return data
}

const px = (data: Uint8ClampedArray, tx: number, ty: number): [number, number, number] =>
  [data[(ty * COTE + tx) * 4]!, data[(ty * COTE + tx) * 4 + 1]!, data[(ty * COTE + tx) * 4 + 2]!]
const luma = (c: [number, number, number]): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
/** La couleur qu'un pixel DOIT avoir : la même chaîne que le bake (flottants → clampés). */
const attendu = (c: [number, number, number], enVue: boolean): [number, number, number] => {
  const [r, g, b] = enVue ? c : griserPx(c[0], c[1], c[2])
  const u = new Uint8ClampedArray([r, g, b])
  return [u[0]!, u[1]!, u[2]!]
}

describe('l’eau du jour sur la carte — la dérivation', () => {
  it('363 jours sur 365, la carte du jour EST le bake : `null`, et une clef stable', () => {
    const map = vallee()
    expect(deriverEauDuJour(map, { aSec: false, guesFermes: false, niveau: 0 })).toBeNull()
    expect(deriverEauDuJour(map, { aSec: false, guesFermes: false, niveau: -0.4 })).toBeNull()
    expect(cleDuRegime({ aSec: false, guesFermes: false, niveau: 0 })).toBe(cleDuRegime({ aSec: false, guesFermes: false, niveau: -0.59 }))
    // La clef ne bouge qu'avec l'IMAGE : deux niveaux de même portée de nappe sont un seul régime.
    expect(cleDuRegime({ aSec: false, guesFermes: true, niveau: 0.5 })).toBe(cleDuRegime({ aSec: false, guesFermes: true, niveau: 0.52 }))
    expect(cleDuRegime({ aSec: false, guesFermes: true, niveau: 0.5 })).not.toBe(cleDuRegime({ aSec: false, guesFermes: true, niveau: 1 }))
    expect(cleDuRegime({ aSec: true, guesFermes: false, niveau: -0.7 })).not.toBe(cleDuRegime({ aSec: false, guesFermes: false, niveau: -0.7 }))
  })

  it('l’assec marque l’eau peu profonde, la crue ferme le gué et noie la terre à `d ≤ niveau × PORTEE_CRUE`', () => {
    const map = vallee()
    const sec = deriverEauDuJour(map, { aSec: true, guesFermes: false, niveau: -0.8 })!
    expect(sec[30 * COTE + 25]).toBe(EAU_JOUR_ASSEC) // peu profonde
    expect(sec[30 * COTE + 32]).toBe(0) // profonde : le bake
    expect(sec[30 * COTE + 45]).toBe(0) // la terre : le bake
    expect(estEauDuJour(map, sec, 25, 30)).toBe(false)
    expect(estEauDuJour(map, sec, 32, 30)).toBe(true)

    const crue = deriverEauDuJour(map, { aSec: false, guesFermes: true, niveau: 0.5 })!
    const portee = Math.round(0.5 * EAU.PORTEE_CRUE)
    expect(portee).toBeGreaterThanOrEqual(2) // prémisse : la nappe a une épaisseur à lire
    expect(crue[30 * COTE + 25]).toBe(EAU_JOUR_GUE_FERME)
    expect(crue[30 * COTE + (40 + portee)]).toBe(EAU_JOUR_NOYEE) // la dernière tuile noyée
    expect(crue[30 * COTE + (40 + portee + 1)]).toBe(0) // la première au sec
    expect(estEauDuJour(map, crue, 40 + portee, 30)).toBe(true)
    expect(estEauDuJour(map, crue, 40 + portee + 1, 30)).toBe(false)
    expect(estEauDuJour(map, crue, -1, 30)).toBe(false) // hors carte : jamais de l'eau
  })
})

describe('l’eau du jour sur la carte — la peinture', () => {
  it('PEINDRE « COMME LE BAKE » = COPIER LE BAKE : un état tout-bake force la branche eau sur chaque tuile d’eau, et rien ne change d’un octet', () => {
    const map = vallee()
    const a = art(map)
    const sans = peindre(map, a, null, { x: 30, y: 30 })
    const avec = peindre(map, a, new Uint8Array(COTE * COTE), { x: 30, y: 30 })
    expect(Buffer.from(avec).equals(Buffer.from(sans))).toBe(true)
    // Et hors de vue (la matière grise), même chose.
    expect(Buffer.from(peindre(map, a, new Uint8Array(COTE * COTE))).equals(Buffer.from(peindre(map, a, null)))).toBe(true)
  })

  it('L’ASSEC : la mare devient VASE (la référence du monde assagie), sa forme reste, et l’eau profonde qui la jouxte prend le liseré de la rive du jour', () => {
    const map = vallee()
    const a = art(map)
    const eau = deriverEauDuJour(map, { aSec: true, guesFermes: false, niveau: -0.8 })
    const vif = peindre(map, a, eau, { x: 30, y: 30 })
    const vase = couleurVaseCarte()
    expect(px(vif, 25, 30)).toEqual(attendu(vase, true))
    expect(px(vif, 26, 26)).toEqual(attendu(vase, true)) // partout sur la mare, pas sur son bord seul
    expect(luma(px(vif, 25, 30))).toBeGreaterThan(luma(px(vif, 32, 30))) // la vase est plus claire que l'eau qui reste
    // Le cœur profond : sa tuile de bord (29,30) touche la vase = la terre du jour → liseré ;
    // sa tuile centrale (32,32) non. Avant l'assec, (29,30) touchait de l'eau : pas de liseré.
    expect(px(vif, 29, 30)).toEqual(attendu(couleurEauCarte(true, true), true))
    expect(px(vif, 32, 32)).toEqual(attendu(couleurEauCarte(true, false), true))
    const kBord = (30 * COTE + 29) * 4
    expect(px(vif, 29, 30)).not.toEqual([a.vive[kBord], a.vive[kBord + 1], a.vive[kBord + 2]])
    // La terre n'a pas bougé (une tuile EN VUE : le disque fait 3 cellules, (44,30) est à 2).
    const kTerre = (30 * COTE + 44) * 4
    expect(px(vif, 44, 30)).toEqual([a.vive[kTerre], a.vive[kTerre + 1], a.vive[kTerre + 2]])
    // Hors de vue : la vase GRISÉE — la mémoire, comme le reste de l'arpenté.
    const gris = peindre(map, a, eau)
    expect(px(gris, 25, 30)).toEqual(attendu(vase, false))
    expect(px(gris, 25, 30)).not.toEqual(px(vif, 25, 30))
  })

  it('LA CRUE : le gué fermé prend l’EAU PROFONDE de la carte, la terre noyée l’EAU PEU PROFONDE, et le liseré se redessine sur la rive du jour', () => {
    const map = vallee()
    const a = art(map)
    const niveau = 1
    const eau = deriverEauDuJour(map, { aSec: false, guesFermes: true, niveau })
    const vif = peindre(map, a, eau, { x: 30, y: 30 })
    const portee = Math.round(niveau * EAU.PORTEE_CRUE)
    // Le gué (eau peu profonde du bake) : profond aujourd'hui, et sans liseré — il n'a plus de
    // rive, la nappe l'a rejoint. Même octets que le cœur profond.
    expect(px(vif, 25, 30)).toEqual(attendu(couleurEauCarte(true, false), true))
    expect(px(vif, 25, 30)).toEqual(px(vif, 32, 32))
    // La bande noyée : eau peu profonde ; sa dernière tuile touche la terre → liseré (plus sombre).
    expect(px(vif, 40 + 2, 30)).toEqual(attendu(couleurEauCarte(false, false), true))
    expect(px(vif, 40 + portee, 30)).toEqual(attendu(couleurEauCarte(false, true), true))
    expect(luma(px(vif, 40 + portee, 30))).toBeLessThan(luma(px(vif, 40 + 2, 30)))
    // Au-delà de la nappe : le sol du bake, intact.
    const kSol = (30 * COTE + 40 + portee + 1) * 4
    expect(px(vif, 40 + portee + 1, 30)).toEqual([a.vive[kSol], a.vive[kSol + 1], a.vive[kSol + 2]])
    // Le bord du bake (41,30 était la rive) n'a plus de liseré : la rive a bougé.
    expect(px(vif, 40, 30)).toEqual(attendu(couleurEauCarte(true, false), true))
  })
})
