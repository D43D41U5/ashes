import { describe, expect, it } from 'vitest'
import { BALANCE } from '@ashes/sim'
import { empechementDeFonder } from './hud-bridge'

/**
 * LE CLIENT NE PROMET PLUS CE QUE LA SIM REFUSERA (audit UX 2026-08-20, D3-2).
 *
 * La fenêtre « Fonder un Foyer ici » s'affichait dès qu'on avait un feu libre sous la main.
 * Or la sim refuse à moins de **32 tuiles** d'un autre Feu — `FIRE_MIN_DISTANCE`, deux fois le
 * rayon maximal, pour que deux carrés de village ne se chevauchent jamais (fondation R1). Le
 * joueur cliquait, la sim refusait, et **rien à l'écran n'avait annoncé la règle** : le client
 * ignorait jusqu'à l'existence de cette distance.
 *
 * C'est la classe de défaut la plus coûteuse du jeu, et elle avait déjà mordu une fois — le
 * fantôme de construction restait VERT hors du carré du village. On la répare de la même
 * façon : par une affordance PRÉVENTIVE, avant le clic, plutôt qu'un refus après coup.
 *
 * LA MÉTRIQUE EST CELLE DE LA SIM — Chebyshev, pas euclidienne, et STRICTEMENT inférieur. Un
 * miroir qui arrondirait autrement interdirait des poses légales (ou en promettrait
 * d'illégales), et on aurait remplacé un mensonge par un autre.
 */
const MIN = BALANCE.FIRE_MIN_DISTANCE

describe('le miroir de la règle de fondation', () => {
  it('la distance gardée est bien celle du sim, et elle vaut 32', () => {
    // Si `FIRE_MIN_DISTANCE` bouge, ce test le dit — le libellé montré au joueur l'interpole,
    // donc il suivra, mais l'ordre de grandeur mérite d'être vu changer.
    expect(MIN).toBe(32)
  })

  it('AUCUN village : rien n’empêche', () => {
    expect(empechementDeFonder([], { tx: 100, ty: 100 })).toBeNull()
  })

  it('un village LOIN : rien n’empêche', () => {
    expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: MIN, ty: 0 })).toBeNull()
  })

  it('un village TROP PRÈS : la raison est donnée, et elle porte le nombre', () => {
    const r = empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: MIN - 1, ty: 0 })
    expect(r).not.toBeNull()
    expect(r).toContain(String(MIN))
  })

  it('la métrique est CHEBYSHEV, pas euclidienne — la diagonale ne sauve pas', () => {
    // En euclidien, (23,23) est à 32,5 d'un feu en (0,0) : ce serait permis. En Chebyshev il
    // est à 23, donc refusé — et c'est la sim qui a raison, parce que ce sont des CARRÉS qui
    // ne doivent pas se chevaucher, pas des cercles.
    expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: 23, ty: 23 })).not.toBeNull()
    // Et à la distance exacte, en diagonale, ça passe : le bord se touche sans chevaucher.
    expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: MIN, ty: MIN })).toBeNull()
  })

  it('LA BORNE EXACTE : `< min` refuse, `= min` accepte — comme la sim', () => {
    // Un miroir décalé d'une tuile interdirait une pose que la sim accorde. On balaie la
    // frontière des deux côtés plutôt que d'affirmer sur un cas.
    for (const d of [MIN - 2, MIN - 1]) {
      expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: d, ty: 0 }), `d=${d}`).not.toBeNull()
    }
    for (const d of [MIN, MIN + 1, MIN + 20]) {
      expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: d, ty: 0 }), `d=${d}`).toBeNull()
    }
  })

  it('PLUSIEURS villages : un seul trop proche suffit à empêcher', () => {
    const loin = { fireTx: 500, fireTy: 500 }
    const pres = { fireTx: 10, fireTy: 10 }
    expect(empechementDeFonder([loin], { tx: 12, ty: 12 })).toBeNull()
    expect(empechementDeFonder([loin, pres], { tx: 12, ty: 12 })).not.toBeNull()
  })
})
