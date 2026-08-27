/**
 * LE CORPS COUCHÉ, EN HUIT CAPS — ce que la silhouette promet.
 *
 * Deux textures (est-ouest, nord-sud) ne savaient pas dire une diagonale : un corps qui rampe
 * vers le nord-est n'avait le choix qu'entre deux mensonges (« pour moi non », Alexis,
 * 2026-08-25, sur la version à deux axes). Ces gardes tiennent les trois promesses du remède :
 * le cap suit la marche, la boîte est l'enveloppe exacte, et les caps CARDINAUX rendent au pixel
 * près l'ancien pion — celui qu'Alexis avait validé.
 */
import { describe, expect, it } from 'vitest'
import {
  COUCHE_EPAISSEUR,
  COUCHE_LONGUEUR,
  ORIENTATIONS_COUCHE,
  boiteCouchee,
  capDOrientation,
  cleCouchee,
  orientCouchee,
  rasterCorpsCouche,
} from './corps-couche'

/** L'écart d'angle le plus court entre deux caps (rad). */
function ecartAngle(a: number, b: number): number {
  let d = (a - b) % Math.PI // un corps n'a pas de tête : le cap et son opposé se valent
  if (d > Math.PI / 2) d -= Math.PI
  if (d < -Math.PI / 2) d += Math.PI
  return d
}

describe('le corps couché en huit caps', () => {
  it('① le cap suit le DÉPLACEMENT, sur tout le tour d’horizon', () => {
    const marge = Math.PI / ORIENTATIONS_COUCHE + 1e-9
    for (let deg = 0; deg < 360; deg++) {
      const th = (deg * Math.PI) / 180
      const o = orientCouchee(Math.cos(th) * 3, Math.sin(th) * 3)
      expect(Math.abs(ecartAngle(capDOrientation(o), th)), `cap ${deg}°`).toBeLessThanOrEqual(marge)
    }
  })

  it('② une DIAGONALE ne tombe pas sur un axe — c’était tout le défaut', () => {
    // Le nord-est franc : ni couché est-ouest, ni couché nord-sud.
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1.9], [-1.9, 2]] as const) {
      const o = orientCouchee(dx, dy)
      const { w, h } = boiteCouchee(o)
      expect(o % 2, `(${dx},${dy}) → cap ${o} : ce n’est pas un cap oblique`).toBe(1)
      // Une boîte d'axe a un côté à l'ÉPAISSEUR ; une boîte oblique est large des deux côtés
      // (24 × 24 à 45° : l'enveloppe d'un corps de 24 × 10 tourné d'un huitième de tour).
      expect(Math.min(w, h), `(${dx},${dy}) : la boîte est celle d’un axe`).toBeGreaterThan(COUCHE_EPAISSEUR)
    }
  })

  it('③ un corps n’a pas de tête : un cap et son opposé donnent la MÊME variante', () => {
    for (let deg = 0; deg < 360; deg++) {
      const th = (deg * Math.PI) / 180
      const a = orientCouchee(Math.cos(th), Math.sin(th))
      const b = orientCouchee(-Math.cos(th), -Math.sin(th))
      expect(b, `cap ${deg}° vs son opposé`).toBe(a)
    }
  })

  it('④ les caps CARDINAUX rendent l’ancien pion, au pixel près', () => {
    const est = boiteCouchee(0)
    const nord = boiteCouchee(ORIENTATIONS_COUCHE / 4)
    expect(est).toEqual({ w: COUCHE_LONGUEUR, h: COUCHE_EPAISSEUR })
    expect(nord).toEqual({ w: COUCHE_EPAISSEUR, h: COUCHE_LONGUEUR })
    // Et le dessin : 24 × 10 pleins, avec un liseré d'un pixel tout autour (les deux `fillRect`
    // de l'ancien `makeSpriteCouche` : bord 24 × 10, corps 22 × 8).
    const px = rasterCorpsCouche(0)
    expect(px.length).toBe(COUCHE_LONGUEUR * COUCHE_EPAISSEUR)
    expect(px.filter((v) => v === 0).length, 'aucun trou dans un cap cardinal').toBe(0)
    const corps = px.filter((v) => v === 2).length
    expect(corps).toBe((COUCHE_LONGUEUR - 2) * (COUCHE_EPAISSEUR - 2))
  })

  it('⑤ la boîte CONTIENT le corps, et de près : aucune variante ne rogne ni ne flotte', () => {
    const aire = COUCHE_LONGUEUR * COUCHE_EPAISSEUR
    for (let o = 0; o < ORIENTATIONS_COUCHE; o++) {
      const px = rasterCorpsCouche(o)
      const { w, h } = boiteCouchee(o)
      expect(px.length).toBe(w * h)
      const plein = px.filter((v) => v !== 0).length
      // ±12 % : la rastérisation d'un rectangle tourné ne tombe pas sur des pixels entiers.
      expect(plein, `cap ${o} : aire ${plein} au lieu de ~${aire}`).toBeGreaterThan(aire * 0.88)
      expect(plein, `cap ${o} : aire ${plein} au lieu de ~${aire}`).toBeLessThan(aire * 1.12)
      // Le corps TOUCHE ses quatre bords (sinon la boîte est trop grande, et l'emprise ment).
      const ligne = (y: number): boolean => px.slice(y * w, (y + 1) * w).some((v) => v !== 0)
      const colonne = (x: number): boolean => Array.from({ length: h }, (_, y) => px[y * w + x]).some((v) => v !== 0)
      expect(ligne(0) && ligne(h - 1), `cap ${o} : la boîte flotte en hauteur`).toBe(true)
      expect(colonne(0) && colonne(w - 1), `cap ${o} : la boîte flotte en largeur`).toBe(true)
    }
  })

  it('⑥ chaque cap a sa clé, et elle se replie proprement', () => {
    expect(cleCouchee('spr-x', 0)).toBe('spr-x-0')
    expect(cleCouchee('spr-x', ORIENTATIONS_COUCHE)).toBe('spr-x-0')
    expect(cleCouchee('spr-x', -1)).toBe(`spr-x-${ORIENTATIONS_COUCHE - 1}`)
  })
})
