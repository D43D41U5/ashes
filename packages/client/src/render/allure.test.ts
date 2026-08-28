/**
 * L'allure du cerf (spec faune R26, « Et ça se VOIT ») — les lois pures, prouvées
 * aux bornes exactes : l'odomètre est monotone, la hauteur de bond est continue et
 * nulle aux deux bouts, la marche alterne sur la DISTANCE, la tête tient sous
 * verrou, la transition lever/coucher se lit en niveau (l'horloge peut sauter).
 */
import { describe, expect, it } from 'vitest'
import { ACTOR_FOOTPRINTS } from './framing'
import {
  afficheCerf,
  avanceAllure,
  CLES_CERF_ALLURE,
  BOND_APPUI_PART,
  BOND_HAUTEUR_TUILES,
  BOND_PERIODE_TUILES,
  BOND_V_PLEIN_TUILES_S,
  etatLeverCoucher,
  frameDeMarche,
  hauteurDeBondCerf,
  LEVER_MS,
  MARCHE_DEMI_PAS_TUILES,
  MARCHE_SEUIL_TUILES_S,
  nouvelleAllure,
  ODO_SAUT_MAX_TUILES,
  partDeBond,
  phaseDeBond,
  TETE_CYCLE_TICKS,
  TETE_LEVEE_TICKS,
  TETE_TENUE_MS,
  tenirTete,
  teteLevee,
  type LeverLatch,
  type TenueTete,
} from './allure'

describe("l'odomètre", () => {
  it('adopte la première position sans compter le trajet depuis (0,0)', () => {
    const a = nouvelleAllure()
    expect(avanceAllure(a, 40, 25)).toBe(0)
    expect(a.odometre).toBe(0)
    expect(a.x).toBe(40)
    expect(a.y).toBe(25)
  })

  it('cumule la distance et ne recule JAMAIS — un aller-retour compte double', () => {
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    avanceAllure(a, 1, 0)
    expect(a.odometre).toBeCloseTo(1, 10)
    avanceAllure(a, 0, 0) // il revient sur ses pas : la DISTANCE grandit quand même
    expect(a.odometre).toBeCloseTo(2, 10)
    // Monotonie sur une marche brownienne : jamais une décrue.
    let prev = a.odometre
    for (let i = 0; i < 50; i++) {
      avanceAllure(a, Math.sin(i * 0.7), Math.cos(i * 1.3))
      expect(a.odometre).toBeGreaterThanOrEqual(prev)
      prev = a.odometre
    }
  })

  it("ignore une téléportation : le saut n'avale pas des cycles de pattes", () => {
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    avanceAllure(a, 0.5, 0)
    const avant = a.odometre
    expect(avanceAllure(a, 0.5 + ODO_SAUT_MAX_TUILES + 1, 0)).toBe(0)
    expect(a.odometre).toBe(avant) // le compteur n'a pas bougé…
    expect(a.x).toBeCloseTo(0.5 + ODO_SAUT_MAX_TUILES + 1, 10) // …mais la position est adoptée
  })
})

describe('la marche', () => {
  it('alterne les jambes tous les MARCHE_DEMI_PAS_TUILES, aux bornes exactes', () => {
    expect(frameDeMarche(0)).toBe(0)
    expect(frameDeMarche(MARCHE_DEMI_PAS_TUILES * 0.99)).toBe(0)
    expect(frameDeMarche(MARCHE_DEMI_PAS_TUILES)).toBe(1)
    expect(frameDeMarche(MARCHE_DEMI_PAS_TUILES * 1.99)).toBe(1)
    expect(frameDeMarche(MARCHE_DEMI_PAS_TUILES * 2)).toBe(0)
  })

  it('ne rend que 0 ou 1 sur tout le domaine', () => {
    for (let d = 0; d < 10; d += 0.07) {
      expect([0, 1]).toContain(frameDeMarche(d))
    }
  })
})

describe('le bond', () => {
  it('est NUL aux deux bouts et sur tout l’appui — bornes exactes', () => {
    const a = BOND_APPUI_PART / 2
    expect(hauteurDeBondCerf(0)).toBe(0)
    expect(hauteurDeBondCerf(1)).toBe(0)
    expect(hauteurDeBondCerf(a)).toBe(0)
    expect(hauteurDeBondCerf(1 - a)).toBe(0)
    expect(hauteurDeBondCerf(a / 2)).toBe(0)
    expect(hauteurDeBondCerf(1 - a / 2)).toBe(0)
  })

  it('culmine à BOND_HAUTEUR_TUILES à mi-course, strictement positif en l’air', () => {
    expect(hauteurDeBondCerf(0.5)).toBeCloseTo(BOND_HAUTEUR_TUILES, 10)
    const a = BOND_APPUI_PART / 2
    for (let f = a + 0.001; f < 1 - a; f += 0.01) {
      expect(hauteurDeBondCerf(f)).toBeGreaterThan(0)
      expect(hauteurDeBondCerf(f)).toBeLessThanOrEqual(BOND_HAUTEUR_TUILES)
    }
  })

  it('est CONTINU sur tout le domaine (pente bornée, pas de marche)', () => {
    const pas = 0.001
    // Pente maximale de la parabole remappée : 4h/(1−2a) par unité de f, soit
    // 4h/(1−2a)² par unité de phase — on prend 2× de marge.
    const borne = ((4 * BOND_HAUTEUR_TUILES) / (1 - BOND_APPUI_PART) ** 2) * pas * 2
    for (let f = 0; f < 1; f += pas) {
      expect(Math.abs(hauteurDeBondCerf(f + pas) - hauteurDeBondCerf(f))).toBeLessThanOrEqual(borne)
    }
  })

  it('est symétrique : la montée vaut la retombée', () => {
    for (let f = 0; f <= 0.5; f += 0.01) {
      expect(hauteurDeBondCerf(f)).toBeCloseTo(hauteurDeBondCerf(1 - f), 10)
    }
  })

  it('la phase repart du sol là où la fuite a commencé', () => {
    expect(phaseDeBond(7.3, 7.3)).toBe(0)
    expect(phaseDeBond(7.3 + BOND_PERIODE_TUILES / 2, 7.3)).toBeCloseTo(0.5, 10)
    expect(phaseDeBond(7.3 + BOND_PERIODE_TUILES, 7.3)).toBeCloseTo(0, 10)
  })

  it("la part suit la vitesse : 0 à l'arrêt, pleine en pleine fuite, monotone entre", () => {
    expect(partDeBond(0)).toBe(0)
    expect(partDeBond(BOND_V_PLEIN_TUILES_S)).toBe(1)
    expect(partDeBond(BOND_V_PLEIN_TUILES_S * 2)).toBe(1)
    let prev = 0
    for (let v = 0; v <= BOND_V_PLEIN_TUILES_S; v += 0.1) {
      const p = partDeBond(v)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
  })
})

describe('la tête au broutage', () => {
  it('passe exactement TETE_LEVEE_TICKS levée par cycle, pour toute bête', () => {
    for (const id of [1, 7, 42, 1337]) {
      let levee = 0
      for (let t = 0; t < TETE_CYCLE_TICKS; t++) if (teteLevee(id, t)) levee++
      expect(levee).toBe(TETE_LEVEE_TICKS)
    }
  })

  it('est périodique et déterministe', () => {
    for (let t = 0; t < 50; t++) {
      expect(teteLevee(9, t)).toBe(teteLevee(9, t + TETE_CYCLE_TICKS))
      expect(teteLevee(9, t)).toBe(teteLevee(9, t)) // deux lectures, même réponse
    }
  })

  it('la harde ne mâche pas à l’unisson : deux bêtes au moins divergent', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8]
    let divergent = false
    for (let t = 0; t < TETE_CYCLE_TICKS && !divergent; t++) {
      const premiers = teteLevee(ids[0]!, t)
      if (ids.some((id) => teteLevee(id, t) !== premiers)) divergent = true
    }
    expect(divergent).toBe(true)
  })

  it('le verrou ne suit que ce qui tient TETE_TENUE_MS', () => {
    const latch: TenueTete = { levee: false, candidat: false, depuis: 0, neuf: true }
    expect(tenirTete(latch, false, 1000)).toBe(false) // première vue : on adopte
    expect(tenirTete(latch, true, 1010)).toBe(false) // le candidat vient d'apparaître
    expect(tenirTete(latch, true, 1010 + TETE_TENUE_MS - 1)).toBe(false)
    expect(tenirTete(latch, true, 1010 + TETE_TENUE_MS)).toBe(true) // il a tenu : on suit
    // Un frisson d'un aller-retour ne fait rien bouger.
    expect(tenirTete(latch, false, 2000)).toBe(true)
    expect(tenirTete(latch, true, 2010)).toBe(true)
    expect(tenirTete(latch, true, 5000)).toBe(true)
  })
})

describe('le lever et le coucher', () => {
  const neuf = (): LeverLatch => ({ couche: false, debut: -1, neuf: true })

  it('première vue : on adopte ce qu’on voit, sans jouer la transition', () => {
    const l = neuf()
    expect(etatLeverCoucher(l, true, false, 1000)).toBe('couche')
    const l2 = neuf()
    expect(etatLeverCoucher(l2, false, false, 1000)).toBe('debout')
  })

  it('se lever passe par la frame intermédiaire, tenue LEVER_MS, puis commet', () => {
    const l = neuf()
    etatLeverCoucher(l, true, false, 0) // adopté couché
    expect(etatLeverCoucher(l, false, false, 1000)).toBe('transition')
    expect(etatLeverCoucher(l, false, false, 1000 + LEVER_MS - 1)).toBe('transition')
    expect(etatLeverCoucher(l, false, false, 1000 + LEVER_MS)).toBe('debout')
    expect(etatLeverCoucher(l, false, false, 1000 + LEVER_MS + 1)).toBe('debout') // stable
  })

  it('se coucher aussi — la même frame, dans l’autre sens', () => {
    const l = neuf()
    etatLeverCoucher(l, false, false, 0)
    expect(etatLeverCoucher(l, true, false, 500)).toBe('transition')
    expect(etatLeverCoucher(l, true, false, 500 + LEVER_MS)).toBe('couche')
  })

  it('LE TEMPS EST UN NIVEAU : une horloge qui saute par-dessus la fenêtre commet quand même', () => {
    const l = neuf()
    etatLeverCoucher(l, true, false, 0)
    expect(etatLeverCoucher(l, false, false, 1000)).toBe('transition')
    // L'horloge headless avale trois secondes d'un coup : on ne reste pas à genoux.
    expect(etatLeverCoucher(l, false, false, 4000)).toBe('debout')
  })

  it('URGENT (la fuite) saute la transition : debout à l’image même', () => {
    const l = neuf()
    etatLeverCoucher(l, true, false, 0)
    expect(etatLeverCoucher(l, false, true, 1000)).toBe('debout')
  })

  it('un état qui se ravise en pleine transition abandonne le geste', () => {
    const l = neuf()
    etatLeverCoucher(l, true, false, 0)
    expect(etatLeverCoucher(l, false, false, 1000)).toBe('transition')
    expect(etatLeverCoucher(l, true, false, 1100)).toBe('couche') // il se recouche : on y est déjà
    expect(etatLeverCoucher(l, false, false, 1200)).toBe('transition') // et le geste repart de zéro
    expect(etatLeverCoucher(l, false, false, 1200 + LEVER_MS - 1)).toBe('transition')
  })
})

describe("afficheCerf — l'intégration", () => {
  const PLEINE_FUITE = 4.6

  it('la fuite se lit en bonds : appui groupé au sol, silhouette étirée en l’air, sommet à mi-bond', () => {
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    const releves: { phase: number; key: string; h: number }[] = []
    for (let x = 0; x <= BOND_PERIODE_TUILES; x += 0.05) {
      avanceAllure(a, x, 0)
      const aff = afficheCerf(a, 'spr-deer-flee', 3, 100, 1000 + x, PLEINE_FUITE)
      releves.push({ phase: phaseDeBond(a.odometre, a.origineBond), key: aff.key, h: aff.hauteurBond })
    }
    // Le premier bond part du sol : l'entrée en fuite a posé l'origine ICI.
    expect(releves[0]!.key).toBe('spr-deer-flee-sol')
    expect(releves[0]!.h).toBe(0)
    // Au sommet : la pleine hauteur, silhouette étirée.
    const sommet = releves.find((r) => Math.abs(r.phase - 0.5) < 0.02)!
    expect(sommet.key).toBe('spr-deer-flee')
    expect(sommet.h).toBeCloseTo(BOND_HAUTEUR_TUILES, 2)
    // À la retombée (fin de période) : de nouveau l'appui.
    const fin = releves[releves.length - 1]!
    expect(fin.key).toBe('spr-deer-flee-sol')
    expect(fin.h).toBe(0)
    // Les deux familles apparaissent, et le sol est EXACTEMENT là où h ≈ 0.
    for (const r of releves) {
      if (r.key === 'spr-deer-flee-sol') expect(r.h).toBe(0)
      else expect(r.h).toBeGreaterThan(0)
    }
  })

  it("une bête qui souffle entre deux sprints ne reste pas pendue en l'air", () => {
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    // Elle s'arrête pile à mi-bond (phase 0,5)…
    avanceAllure(a, 0.2, 0)
    afficheCerf(a, 'spr-deer-flee', 3, 100, 1000, PLEINE_FUITE) // l'origine se pose au premier appel
    avanceAllure(a, BOND_PERIODE_TUILES / 2 + 0.2, 0)
    const enVol = afficheCerf(a, 'spr-deer-flee', 3, 100, 1010, PLEINE_FUITE)
    expect(enVol.hauteurBond).toBeGreaterThan(0.4)
    // …et la vitesse récente retombe : la hauteur suit, jusqu'au sol.
    const ralenti = afficheCerf(a, 'spr-deer-flee', 3, 100, 1020, PLEINE_FUITE / 4)
    expect(ralenti.hauteurBond).toBeLessThan(enVol.hauteurBond)
    const arrete = afficheCerf(a, 'spr-deer-flee', 3, 100, 1030, 0)
    expect(arrete.hauteurBond).toBe(0)
    expect(arrete.key).toBe('spr-deer-flee-sol')
  })

  it('le broutage-déplacement montre le cycle de pattes, alterné sur la DISTANCE', () => {
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    const keys: string[] = []
    for (let x = 0.1; x <= 1.3; x += 0.1) {
      avanceAllure(a, x, 0)
      keys.push(afficheCerf(a, 'spr-deer-graze', 3, 100, 1000, 1.6).key)
    }
    expect(keys).toContain('spr-deer-walk-0')
    expect(keys).toContain('spr-deer-walk-1')
    expect(keys.every((k) => k.startsWith('spr-deer-walk-'))).toBe(true)
    // L'alternance suit l'odomètre : la frame change là où la distance franchit le demi-pas.
    expect(keys[0]).toBe(`spr-deer-walk-${frameDeMarche(0.1)}`)
    expect(keys[keys.length - 1]).toBe(`spr-deer-walk-${frameDeMarche(1.3)}`)
  })

  it("la marche vaut aussi pour la tête dressée en déplacement (la file de l'aube) — mais JAMAIS immobile", () => {
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    avanceAllure(a, 0.5, 0)
    expect(afficheCerf(a, 'spr-deer', 3, 100, 1000, 1.6).key.startsWith('spr-deer-walk-')).toBe(true)
    // Immobile, la tête dressée est un SIGNAL (alerte/sentinelle) : on n'y touche pas.
    expect(afficheCerf(a, 'spr-deer', 3, 100, 1010, 0).key).toBe('spr-deer')
    // La borne exacte du seuil : à peine au-dessus il marche, à peine en dessous il est planté.
    expect(afficheCerf(a, 'spr-deer-graze', 3, 100, 1020, MARCHE_SEUIL_TUILES_S * 1.01).key.startsWith('spr-deer-walk-')).toBe(true)
    expect(afficheCerf(a, 'spr-deer-graze', 3, 100, 1030, MARCHE_SEUIL_TUILES_S * 0.99).key.startsWith('spr-deer-graze')).toBe(true)
  })

  it('à l’arrêt au broutage, la tête se lève et mâche — sous verrou', () => {
    const id = 7
    // Trouve la frontière tête baissée → levée de cette bête.
    let t0 = -1
    for (let t = 0; t < TETE_CYCLE_TICKS * 2; t++) {
      if (!teteLevee(id, t) && teteLevee(id, t + 1)) {
        t0 = t
        break
      }
    }
    expect(t0).toBeGreaterThanOrEqual(0)
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    expect(afficheCerf(a, 'spr-deer-graze', id, t0, 1000, 0).key).toBe('spr-deer-graze')
    // Le tick a basculé : le dessin ne suit qu'après la tenue.
    expect(afficheCerf(a, 'spr-deer-graze', id, t0 + 1, 1010, 0).key).toBe('spr-deer-graze')
    expect(afficheCerf(a, 'spr-deer-graze', id, t0 + 1, 1010 + TETE_TENUE_MS, 0).key).toBe('spr-deer-graze-tete')
  })

  it('du couché au broutage : la frame de lever, tenue, puis debout', () => {
    // Un tick où CETTE bête a le mufle dans l'herbe — pour que l'arrivée soit `-graze` nue.
    let tBas = -1
    for (let t = 0; t < TETE_CYCLE_TICKS; t++) {
      if (!teteLevee(3, t)) {
        tBas = t
        break
      }
    }
    expect(tBas).toBeGreaterThanOrEqual(0)
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    expect(afficheCerf(a, 'spr-deer-bed', 3, tBas, 0, 0).key).toBe('spr-deer-bed') // adopté couché
    expect(afficheCerf(a, 'spr-deer-graze', 3, tBas, 1000, 0).key).toBe('spr-deer-lever')
    expect(afficheCerf(a, 'spr-deer-graze', 3, tBas, 1000 + LEVER_MS - 1, 0).key).toBe('spr-deer-lever')
    expect(afficheCerf(a, 'spr-deer-graze', 3, tBas, 1000 + LEVER_MS, 0).key).toBe('spr-deer-graze')
  })

  it('levé par la fuite : debout à l’image même, pas à genoux pendant 280 ms', () => {
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    afficheCerf(a, 'spr-deer-bed', 3, 10, 0, 0)
    const aff = afficheCerf(a, 'spr-deer-flee', 3, 10, 100, PLEINE_FUITE)
    expect(aff.key.startsWith('spr-deer-flee')).toBe(true)
  })

  it('les postures hors cerf-lois passent inchangées', () => {
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    expect(afficheCerf(a, 'spr-deer', 3, 10, 0, 0).key).toBe('spr-deer')
  })

  it('chaque clé émise a son EMPRISE — sinon la bête se dessine à la taille par défaut, en silence', () => {
    for (const cle of CLES_CERF_ALLURE) {
      expect(ACTOR_FOOTPRINTS[cle], `${cle} n'a pas d'emprise`).toBeDefined()
    }
    // Et les deux frames de marche partagent la MÊME : une boîte qui pompe à
    // chaque demi-pas se lirait comme un tremblement, pas comme une foulée.
    expect(ACTOR_FOOTPRINTS['spr-deer-walk-0']).toEqual(ACTOR_FOOTPRINTS['spr-deer-walk-1'])
  })

  it('idempotente à l’image : deux appels au même instant rendent la même chose', () => {
    const a = nouvelleAllure()
    avanceAllure(a, 0, 0)
    avanceAllure(a, 0.7, 0)
    const un = afficheCerf(a, 'spr-deer-flee', 3, 100, 1000, PLEINE_FUITE)
    const deux = afficheCerf(a, 'spr-deer-flee', 3, 100, 1000, PLEINE_FUITE)
    expect(deux).toEqual(un)
  })
})
