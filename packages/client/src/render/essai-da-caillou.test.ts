/**
 * LA COUVERTURE DES MASSES COMPOSÉES (essai DA du 2026-08-26).
 *
 * Une masse faite de rects qui se chevauchent PEUT être trouée, et c'est le mode d'échec le plus
 * sournois de cette façon de dessiner : sur l'albédo, une poche de vide entre deux verts voisins
 * ne se voit pas — il faut l'ombre chinoise pour qu'elle saute aux yeux. Le premier tour en a
 * livré deux (7-8,5-6 et 2,8), passées à travers l'œil et la planche.
 *
 * Et un trou n'est pas cosmétique : `normalFromCanvas` dérive la normale du MASQUE ALPHA. Une
 * poche y devient un puits — la lumière creuse un cratère au milieu d'un buisson.
 */
import { describe, expect, it } from 'vitest'
import { ESSAIS, trousDe } from './essai-da-caillou'

describe('essai DA caillou/buisson — les masses composées', () => {
  /**
   * D'ABORD : la garde sait-elle rougir ? Trois ✓ obtenus par accident valent zéro — une sonde
   * qu'on n'a pas vue échouer ne prouve rien. Deux rects qui se touchent par un coin laissent
   * une poche : si `trousDe` ne la voit pas, tout le reste de ce fichier est décoratif.
   */
  it('la garde DÉTECTE un trou (sinon elle ne garde rien)', () => {
    // ⚠ Premier fixture REFUSÉ par la garde, et elle avait raison : deux blocs côte à côte avec
    // un jour entre eux, ce n'est pas une poche — c'est une ÉCHANCRURE ouverte par le haut. Il
    // faut vraiment enclore le vide pour l'appeler un trou, sinon la garde crierait sur toutes
    // les silhouettes crantées (or c'est exactement ce que la référence dessine).
    const troue = [
      { rect: [0, 0, 9, 2] as const, h: 1, ton: '#000' }, // barre du haut
      { rect: [0, 2, 4, 4] as const, h: 1, ton: '#000' },
      { rect: [5, 2, 4, 4] as const, h: 1, ton: '#000' }, // …le jour est en x=4
      { rect: [0, 6, 9, 2] as const, h: 1, ton: '#000' }, // barre du bas : le vide est enclos
    ]
    const trous = trousDe(troue, 16, 16)
    expect(trous.length, 'la colonne x=4, close en haut et en bas : c’est une poche').toBeGreaterThan(0)
    expect(trous.every(([x]) => x === 4)).toBe(true)

    // Et le CONTRE-EXEMPLE : la même chose sans la barre du bas est une échancrure, pas un trou.
    expect(trousDe(troue.slice(0, 3), 16, 16)).toEqual([])
  })

  it('AUCUNE masse d’essai n’a de poche de vide', () => {
    expect(ESSAIS.length, 'la garde doit d’abord VOIR').toBeGreaterThanOrEqual(8)
    for (const e of ESSAIS) {
      expect(trousDe(e.masses, e.w, e.h), `${e.key} : silhouette trouée`).toEqual([])
    }
  })

  it('chaque masse tient dans son cadre (un rect qui déborde se fait clipper en silence)', () => {
    for (const e of ESSAIS) {
      for (const m of e.masses) {
        const [x, y, w, h] = m.rect
        expect(x >= 0 && y >= 0 && x + w <= e.w && y + h <= e.h, `${e.key} : rect [${m.rect}] hors cadre ${e.w}×${e.h}`).toBe(true)
      }
    }
  })

  /**
   * LES PIEDS AU SOL. Un prop dont la matière s'arrête à mi-tuile FLOTTE — et le défaut ne se voit
   * qu'en jeu, jamais sur une planche où chaque case est cadrée à part.
   */
  it('chaque essai touche le bas de son cadre (à une rangée près, réservée au contact)', () => {
    for (const e of ESSAIS) {
      const bas = Math.max(...e.masses.map((m) => m.rect[1] + m.rect[3]))
      expect(bas, `${e.key} : la masse s’arrête à ${bas} pour un cadre de ${e.h}`).toBeGreaterThanOrEqual(e.h - 2)
    }
  })
})
