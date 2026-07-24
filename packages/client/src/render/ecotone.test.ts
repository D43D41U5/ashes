/**
 * LES GARDES DE LA LISIÈRE — un champ pur, donc testable sans navigateur ni carte réelle.
 */
import { describe, expect, it } from 'vitest'
import { champLisiere, poidsLisiere } from './ecotone'

/** Une grille 6×1 coupée en deux : zone 0 à gauche, zone 1 à droite. */
const DEUX_PAYS = [0, 0, 0, 1, 1, 1]

describe('le champ de lisière', () => {
  it('les cellules qui touchent l’autre pays sont à distance 0, et le DÉSIGNENT', () => {
    const c = champLisiere(DEUX_PAYS, 6, 1, 3)
    // Les deux cellules de part et d'autre de la couture.
    expect(c.dist[2]).toBe(0)
    expect(c.dist[3]).toBe(0)
    // Et chacune regarde vers l'AUTRE pays, jamais vers le sien.
    expect(c.voisin[2]).toBe(1)
    expect(c.voisin[3]).toBe(0)
  })

  it('la distance croît vers le cœur, et sature à la portée', () => {
    const c = champLisiere(DEUX_PAYS, 6, 1, 3)
    expect(c.dist[1]).toBe(1)
    expect(c.dist[0]).toBe(2)
    // Portée 3 : au-delà on est au cœur (ici la grille est trop courte pour saturer, on le
    // vérifie sur une grille large).
    const large = champLisiere([...Array(20).fill(0), ...Array(20).fill(1)], 40, 1, 3)
    expect(large.dist[0]).toBe(3)
    expect(large.voisin[0]).toBe(-1)
  })

  it('la lisière ne FRANCHIT jamais la frontière : elle reste chez elle', () => {
    // Une cellule du pays 0 ne doit jamais hériter d'un voisin propagé DEPUIS le pays 1.
    const c = champLisiere(DEUX_PAYS, 6, 1, 3)
    for (let i = 0; i <= 2; i++) expect(c.voisin[i], `cellule ${i} (pays 0)`).not.toBe(0)
    for (let i = 3; i <= 5; i++) expect(c.voisin[i], `cellule ${i} (pays 1)`).not.toBe(1)
  })

  it('un pays SANS frontière n’a aucune lisière', () => {
    const c = champLisiere([0, 0, 0, 0], 4, 1, 3)
    expect([...c.voisin]).toEqual([-1, -1, -1, -1])
    expect([...c.dist]).toEqual([3, 3, 3, 3])
  })

  it('le poids vaut le maximum contre la couture et zéro au cœur', () => {
    const c = champLisiere([...Array(20).fill(0), ...Array(20).fill(1)], 40, 1, 4)
    expect(poidsLisiere(c, 19, 0.5)).toBeCloseTo(0.5) // contre la frontière
    expect(poidsLisiere(c, 0, 0.5)).toBe(0) // au cœur
    // …et décroît en s'éloignant : c'est tout l'intérêt.
    expect(poidsLisiere(c, 18, 0.5)).toBeLessThan(poidsLisiere(c, 19, 0.5))
    expect(poidsLisiere(c, 18, 0.5)).toBeGreaterThan(poidsLisiere(c, 17, 0.5))
  })

  it('fonctionne en deux dimensions (la vraie grille en est une)', () => {
    // 4×4 : moitié haute zone 0, moitié basse zone 1.
    const g = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]
    const c = champLisiere(g, 4, 4, 2)
    expect(c.dist[4]).toBe(0) // rangée 1 touche la rangée 2
    expect(c.voisin[4]).toBe(1)
    expect(c.dist[0]).toBe(1) // rangée 0 est à une cellule
    expect(c.voisin[0]).toBe(1)
  })
})
