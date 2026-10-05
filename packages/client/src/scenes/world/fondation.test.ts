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
    expect(empechementDeFonder([], { tx: 100, ty: 100 }, 'lit')).toBeNull()
  })

  it('un village LOIN : rien n’empêche', () => {
    expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: MIN, ty: 0 }, 'lit')).toBeNull()
  })

  it('un village TROP PRÈS : la raison est donnée, et elle porte le nombre', () => {
    const r = empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: MIN - 1, ty: 0 }, 'lit')
    expect(r).not.toBeNull()
    expect(r).toContain(String(MIN))
  })

  it('la métrique est CHEBYSHEV, pas euclidienne — la diagonale ne sauve pas', () => {
    // En euclidien, (23,23) est à 32,5 d'un feu en (0,0) : ce serait permis. En Chebyshev il
    // est à 23, donc refusé — et c'est la sim qui a raison, parce que ce sont des CARRÉS qui
    // ne doivent pas se chevaucher, pas des cercles.
    expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: 23, ty: 23 }, 'lit')).not.toBeNull()
    // Et à la distance exacte, en diagonale, ça passe : le bord se touche sans chevaucher.
    expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: MIN, ty: MIN }, 'lit')).toBeNull()
  })

  it('LA BORNE EXACTE : `< min` refuse, `= min` accepte — comme la sim', () => {
    // Un miroir décalé d'une tuile interdirait une pose que la sim accorde. On balaie la
    // frontière des deux côtés plutôt que d'affirmer sur un cas.
    for (const d of [MIN - 2, MIN - 1]) {
      expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: d, ty: 0 }, 'lit'), `d=${d}`).not.toBeNull()
    }
    for (const d of [MIN, MIN + 1, MIN + 20]) {
      expect(empechementDeFonder([{ fireTx: 0, fireTy: 0 }], { tx: d, ty: 0 }, 'lit'), `d=${d}`).toBeNull()
    }
  })

  it('PLUSIEURS villages : un seul trop proche suffit à empêcher', () => {
    const loin = { fireTx: 500, fireTy: 500 }
    const pres = { fireTx: 10, fireTy: 10 }
    expect(empechementDeFonder([loin], { tx: 12, ty: 12 }, 'lit')).toBeNull()
    expect(empechementDeFonder([loin, pres], { tx: 12, ty: 12 }, 'lit')).not.toBeNull()
  })
})

/**
 * ═══ ET LA FLAMME (B-R17 ⓑ, 2026-10-04) ═══
 *
 * « Un feu éteint ne fonde pas » est entré dans `found_village` le jour où tout feu bâti a
 * commencé à naître ÉTEINT — autrement dit la clause est devenue **le cas ordinaire**, pas le cas
 * limite. Sans miroir, le premier geste de tout joueur qui pose un feu et ouvre son modal est un
 * bouton plein, cliqué, refusé en silence : exactement le défaut que le reste de ce fichier
 * répare pour la distance, à la même place, par la même affordance.
 *
 * ⚠ CE QUE CES GARDES ATTRAPENT ET QUE `/sim` NE PEUT PAS : la sim refuse CORRECTEMENT. Aucun
 * test de `village.ts` ne rougit si le client promet. C'est une classe de défaut qui ne vit que
 * dans le miroir.
 */
describe('le miroir de la flamme', () => {
  it('UN FEU ÉTEINT n’est pas fondable, et on le dit AVANT le clic', () => {
    const r = empechementDeFonder([], { tx: 100, ty: 100 }, 'out')
    expect(r).not.toBeNull()
    // La phrase nomme le GESTE qui débloque, pas la règle : c'est une braise qu'il faut.
    expect(r).toMatch(/allumer/i)
  })

  it('UN FEU EN BRAISES FONDE — on exige la flamme, pas le bois', () => {
    // `found_village` teste `=== 'out'`, donc `ember` passe : un feu qui rougit brûle encore.
    // Mettre la frontière sur « plein » aurait interdit la fondation pendant tout le sas
    // d'alerte de `feu-station` S2, et rien ne l'aurait annoncé.
    expect(empechementDeFonder([], { tx: 100, ty: 100 }, 'ember')).toBeNull()
  })

  /**
   * ⚠ L'ORDRE DES DEUX RAISONS N'EST PAS LIBRE, et c'est la seule chose ici qu'un test de
   * distance ne dirait pas : `found_village` juge la flamme AVANT la distance. Un feu éteint ET
   * trop proche doit donc s'entendre dire « allume-le », parce que c'est la première chose que
   * la sim lui dira. Un miroir qui inverse envoie le joueur déménager son camp pour découvrir,
   * trente tuiles plus loin, qu'il lui manquait une braise.
   */
  it('ÉTEINT ET TROP PROCHE : c’est la FLAMME qui parle, comme dans la sim', () => {
    const colle = [{ fireTx: 0, fireTy: 0 }]
    const r = empechementDeFonder(colle, { tx: 1, ty: 1 }, 'out')
    expect(r).toMatch(/allumer/i)
    expect(r).not.toContain(String(MIN))
    // CONTRÔLE : la même géométrie, la flamme donnée → c'est la distance qui parle. Sans cette
    // ligne, la garde ci-dessus passerait au vert sur un miroir qui ne saurait QUE la flamme.
    expect(empechementDeFonder(colle, { tx: 1, ty: 1 }, 'lit')).toContain(String(MIN))
  })
})
