/**
 * L'ART DU MONDE BÂTI — les gardes de ce qu'on ne verrait qu'en jeu, et trop tard.
 *
 * L'appareil de pierre et le mobilier se jugent à l'œil (captures
 * `pnpm smoke --dev --scenario lieux-batis`). Ce qui NE se juge pas à l'œil :
 *   • la COUTURE d'une crête ébréchée sur un bord accosté — elle n'apparaît que sur certaines
 *     seeds, à certaines orientations, et on passe six mois sans la voir ;
 *   • la COUVERTURE des seize masques de clôture — il suffit qu'un seul manque pour qu'un angle
 *     d'enclos affiche une texture manquante, quelque part, une fois.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE } from '@braises/sim'
import { BATI_KEYS, BATI_LIT_TYPES, ENCADREMENT_POST, profilDeCrete } from './bati-art'

const N = 1, E = 2, S = 4, O = 8

describe('les clés', () => {
  it('couvrent les seize masques du mur ruiné ET de la clôture, en albédo et en `_lit`', () => {
    for (let m = 0; m < 16; m++) {
      for (const base of [`st-wall-ruine-${m}`, `st-cloture-${m}`]) {
        expect(BATI_KEYS, `${base} manque`).toContain(base)
        expect(BATI_KEYS, `${base}_lit manque`).toContain(`${base}_lit`)
      }
    }
  })

  it('donnent une `_lit` à CHAQUE pièce qui se dresse', () => {
    for (const type of BATI_LIT_TYPES) {
      expect(BATI_KEYS, `st-${type} manque`).toContain(`st-${type}`)
      expect(BATI_KEYS, `st-${type}_lit manque`).toContain(`st-${type}_lit`)
    }
    // Le mobilier au complet — la liste est ici pour qu'un oubli se VOIE, pas pour décorer.
    for (const t of ['table', 'banc', 'paillasse', 'etagere', 'tonneau', 'atre', 'abreuvoir', 'meule', 'poutre', 'mur_bas', 'cloture', 'encadrement']) {
      expect(BATI_LIT_TYPES.has(t), `${t} n'a pas de _lit`).toBe(true)
    }
  })

  it('laissent PLATES les pièces au ras du sol — une normale y ferait un coussin par tuile', () => {
    for (const plat of ['st-friche', 'st-friche-0', 'st-friche-3', 'st-terre', 'st-terre-2', 'st-floor-ruine', 'st-roof-ruine']) {
      expect(BATI_KEYS).toContain(plat)
      expect(BATI_KEYS, `${plat} ne doit PAS avoir de _lit`).not.toContain(`${plat}_lit`)
    }
    for (const plat of ['friche', 'terre', 'floor', 'roof']) expect(BATI_LIT_TYPES.has(plat)).toBe(false)
  })

  it('n’ont aucun doublon', () => {
    expect(new Set(BATI_KEYS).size).toBe(BATI_KEYS.length)
  })
})

describe("l'encadrement de porte", () => {
  /**
   * LE PASSAGE LIBRE DOIT LAISSER ENTRER L'AVATAR — et ce n'est pas une évidence : mes premiers
   * jambages (5 px sur 16) ne laissaient que 6 px, soit MOINS que la hitbox de 9,6. Le bonhomme
   * traversait la pierre. La faute ne se voyait pas à l'œil parce que l'encadrement ne bloque
   * pas : rien ne cognait, ça avait juste l'air faux.
   */
  it('laisse un passage au moins aussi large que la hitbox de l’avatar', () => {
    const libre = (16 - 2 * ENCADREMENT_POST) / 16
    expect(libre, `passage ${libre} tuile pour une hitbox de ${BALANCE.AVATAR_HITBOX_TILES}`)
      .toBeGreaterThanOrEqual(BALANCE.AVATAR_HITBOX_TILES)
  })

  it('garde des jambages VISIBLES — sans eux, ce n’est plus un encadrement mais un trou', () => {
    expect(ENCADREMENT_POST).toBeGreaterThanOrEqual(2)
  })
})

describe('la crête ébréchée', () => {
  it('ne mord JAMAIS le bord qui a un voisin — sinon la grille des tuiles se voit', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (let graine = 0; graine < 40; graine++) {
        const p = profilDeCrete(mask, graine)
        // Le premier pixel d'un bord accosté doit être intact ; le second peut mordre d'un
        // seul pixel (l'entaille rentre en pente, elle ne se coupe pas net).
        if (mask & O) {
          expect(p[0], `masque ${mask} graine ${graine} : entaille au bord ouest`).toBe(0)
          expect(p[1]!).toBeLessThanOrEqual(1)
        }
        if (mask & E) {
          expect(p[15], `masque ${mask} graine ${graine} : entaille au bord est`).toBe(0)
          expect(p[14]!).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('reste bornée : une ruine, pas un tas', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (const d of profilDeCrete(mask, mask * 13 + 5)) {
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThanOrEqual(4)
      }
    }
  })

  it('ébrèche VRAIMENT : un mur droit lirait « entretenu »', () => {
    const p = profilDeCrete(N | S, 5) // ni voisin est, ni voisin ouest : crête entièrement libre
    expect(Math.max(...p)).toBeGreaterThanOrEqual(2)
    expect(new Set(p).size).toBeGreaterThan(1) // et un profil, pas un plateau
  })

  it('est déterministe : deux boots donnent la même ruine', () => {
    expect(profilDeCrete(9, 122)).toEqual(profilDeCrete(9, 122))
  })
})
