import { describe, expect, it } from 'vitest'
import { COMBAT, WEAPON_PROFILES, inStrikeZone } from '@ashes/sim'
import { ciblesDesignees, type Corps } from './cibles'

const MOI = 1
const corps = (id: number, x: number, y: number, hp = 100): Corps => ({ id, x, y, hp })
const coup = (id: number, strike = WEAPON_PROFILES.spear.light, ranged = false) => ({ id, dx: 1, dy: 0, strike, ranged })

/**
 * CE QUI FERAIT ROUGIR, énoncé avant tout vert :
 *  · une fonction qui rend TOUJOURS une liste vide (le vrai risque d'un branchement neuf :
 *    rien, à l'écran, ne distingue « ça marche » de « ça sort tôt à chaque image ») ;
 *  · un désaccord avec `inStrikeZone` — le dessin promettrait ce que la sim ne fait pas ;
 *  · le surlignage des cibles d'un TIERS, qui exigerait de rejouer ici quatre alliances.
 */
describe('qui prend le coup du joueur (item 2, R15)', () => {
  it('MON coup désigne TOUT ce qui est dans son arc — et rien d’autre', () => {
    const monde = [corps(MOI, 10, 10), corps(2, 11, 10), corps(3, 10, 14), corps(4, 11.5, 10)]
    const vus = ciblesDesignees(coup(MOI), monde, MOI)
    expect(vus.slice().sort()).toEqual([2, 4]) // devant, à portée de lance
    // …et jamais soi-même : la sim non plus ne se frappe pas (`target.id === attacker.id`).
    expect(vus).not.toContain(MOI)
  })

  it('LE VERDICT EST CELUI DE LA SIM, partout — balayé, pas échantillonné', () => {
    // La propriété qui porte tout : ce que l'anneau promet est ce que `inStrikeZone`
    // accorde. On balaie le voisinage au quart de tuile plutôt que de choisir trois points.
    const strike = WEAPON_PROFILES.iron_axe.light
    let dedans = 0
    for (let dx = -3; dx <= 3; dx += 0.25) {
      for (let dy = -3; dy <= 3; dy += 0.25) {
        if (dx === 0 && dy === 0) continue
        const monde = [corps(MOI, 10, 10), corps(2, 10 + dx, 10 + dy)]
        const attendu = inStrikeZone(strike, 10, 10, 1, 0, 10 + dx, 10 + dy)
        const obtenu = ciblesDesignees(coup(MOI, strike), monde, MOI).includes(2)
        expect(obtenu, `(${dx}, ${dy})`).toBe(attendu)
        if (attendu) dedans++
      }
    }
    expect(dedans, 'la garde prouve sa prémisse : la zone n’est pas vide').toBeGreaterThan(20)
  })

  it('LE COUP D’UN AUTRE NE DÉSIGNE RIEN — le liseré ne répond qu’à « qui vais-je toucher ? »', () => {
    // ═══ UN SEUL SENS, UNE SEULE COULEUR (décision d'Alexis) ═══
    //
    // Le premier jet soulignait AUSSI le joueur quand le coup d'un adversaire l'atteignait.
    // L'information est réelle, mais dans le MÊME rouge elle rendait le liseré ambigu au
    // moment exact où il doit se lire sans réfléchir. Elle a besoin de son propre signe.
    //
    // Et ça retire au passage toute tentation de rejouer côté client les quatre alliances
    // de `resolveStrike` (harde, espèce cendreux, même village, vol) : un loup verrait
    // sinon ses propres frères soulignés, alors qu'il ne peut pas les toucher.
    const monde = [corps(MOI, 11, 10), corps(2, 10, 10), corps(3, 11.5, 10)]
    expect(ciblesDesignees(coup(2), monde, MOI)).toEqual([])
  })

  it('UN MORT N’EST PLUS UNE CIBLE', () => {
    expect(ciblesDesignees(coup(MOI), [corps(MOI, 10, 10), corps(2, 11, 10, 0)], MOI)).toEqual([])
  })

  it('UN TIR NE DÉSIGNE RIEN : l’arc a déjà son retour (`tir.md` T2ter)', () => {
    const monde = [corps(MOI, 10, 10), corps(2, 11, 10)]
    expect(ciblesDesignees(coup(MOI, WEAPON_PROFILES.bow.light, true), monde, MOI)).toEqual([])
  })

  it('UN ARMEUR ABSENT DU SNAPSHOT ne fait pas tomber le rendu', () => {
    // La zone d'intérêt rogne les entités lointaines : un wind-up peut survivre une image
    // de plus que le corps qui le porte.
    expect(ciblesDesignees(coup(99), [corps(MOI, 10, 10)], MOI)).toEqual([])
  })

  it('LE TOURBILLON prend tout le tour, y compris le dos', () => {
    const monde = [corps(MOI, 10, 10), corps(2, 11, 10), corps(3, 9, 10), corps(4, 10, 11)]
    const vus = ciblesDesignees(coup(MOI, WEAPON_PROFILES.iron_axe.charged), monde, MOI)
    expect(vus.slice().sort()).toEqual([2, 3, 4])
    expect(COMBAT.HIT_BODY_RADIUS).toBeGreaterThan(0) // le corps compte, pas le seul centre
  })
})
