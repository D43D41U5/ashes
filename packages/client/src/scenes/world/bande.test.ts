/**
 * LA CADENCE DE LA BANDE (demande d'Alexis, 2026-08-02 — spec `tir.md` T2ter).
 *
 * On prouve ici la PENTE, et pas au navigateur : mesurer une cadence au banc demande de
 * figer la boucle et de l'avancer image par image, or chaque image y coûte un rendu
 * logiciel entier — on n'y tient pas les 0,9 s d'une bande. Le smoke garde ce qu'il sait
 * faire (les éclats existent pendant la bande, ils CESSENT quand elle est pleine) ; la
 * loi, elle, se démontre.
 */
import { describe, expect, it } from 'vitest'
import { periodeEclat } from './bande'

describe('la cadence des éclats de bande', () => {
  it('ACCÉLÈRE continûment — strictement décroissante sur TOUTE la course', () => {
    // Aucun palier : c'est une cadence qu'on entend monter, pas un seuil qu'on apprend.
    // On balaie tout l'intervalle plutôt que trois points choisis — une pente affirmée
    // sur des cas choisis ne dit rien de ce qui se passe entre eux.
    for (let i = 0; i < 100; i++) {
      const a = periodeEclat(i / 100)
      const b = periodeEclat((i + 1) / 100)
      expect(b, `la période doit tomber entre ${i / 100} et ${(i + 1) / 100}`).toBeLessThan(a)
    }
  })

  it('a des BORNES exactes aux deux bouts', () => {
    expect(periodeEclat(0)).toBe(420)
    expect(periodeEclat(1)).toBe(110)
    // …et la corde n'est jamais « plus que pleine » : au-delà, la période ne descend plus.
    expect(periodeEclat(1.4)).toBe(110)
    expect(periodeEclat(-3)).toBe(420)
  })

  it('la bande PLEINE bat près de QUATRE FOIS plus vite qu’au départ', () => {
    // L'écart doit être franc : c'est lui, et lui seul, qui rend la maturité lisible sans
    // jauge sur une arme dont la FORME ne change pas (un cône reste un cône).
    expect(periodeEclat(0) / periodeEclat(1)).toBeGreaterThan(3.5)
  })
})
