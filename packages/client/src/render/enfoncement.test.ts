/**
 * LA COMPOSITION DES MILIEUX (spec `peche.md` R13) — et surtout : **AUCUNE MARCHE**.
 *
 * Alexis, en jouant : *« tu avais mis une transition sympa pour l'eau, tu peux faire la même
 * pour le marais ? Et gérer toutes les transitions possibles de manière propre ? »* La vase
 * était binaire (une lecture de terrain par tuile) et éteinte par des portes (« pas si dans
 * l'eau », « pas si sous la neige ») — trois marches, dont deux à des endroits qu'on ne pense
 * pas à jouer (vase → eau, neige sur vase).
 *
 * Ces gardes ne regardent pas des CAS choisis : elles balaient le domaine entier et affirment
 * une seule propriété — la fonction est LIPSCHITZ, c'est-à-dire qu'un petit pas du joueur ne
 * peut pas produire un grand saut du corps. C'est la forme exacte de « feel = pente continue ».
 */
import { describe, expect, it } from 'vitest'
import {
  COUPE_MAX_FRACTION,
  EAU_PX,
  NEIGE_GENOUX_PX,
  RAMPE_TUILES,
  VASE_PX,
  enfoncement,
  rampe,
  epaisseurQuiSEnfonce,
  type Milieux,
} from './enfoncement'

const H = 20 // la hauteur d'un avatar, en px monde
const SEC: Milieux = { dRive: -9, dVase: -9, hauteurNeige: 0, enfoui: 0, displayH: H }

/** La pente maximale admissible, en px de corps par tuile parcourue : celle de l'eau, la plus
 *  profonde des deux rampes. Tout ce qui dépasse est une MARCHE. */
const PENTE_MAX = EAU_PX / RAMPE_TUILES

describe('les milieux se composent sans une seule marche', () => {
  it('TERRE → VASE → EAU, pas par pas : ni la découpe ni la descente ne sautent', () => {
    // Le trajet que fait un joueur qui entre dans un marais puis dans la mare qu'il borde :
    // la vase monte, l'eau prend le relais, et à aucun moment le corps ne doit sursauter.
    const PAS = 0.005
    let avant = enfoncement(SEC)
    for (let t = 0; t <= 4; t += PAS) {
      // La vase commence à t = 0,5 ; l'eau à t = 2 (elles se CHEVAUCHENT entre 2 et 2,6 —
      // c'est là que les anciennes portes faisaient tomber la vase à zéro d'un coup).
      const m: Milieux = { ...SEC, dVase: t - 0.5, dRive: t - 2 }
      const ici = enfoncement(m)
      expect(Math.abs(ici.coupe - avant.coupe), `découpe à t=${t.toFixed(3)}`).toBeLessThanOrEqual(PENTE_MAX * PAS * 2 + 1e-9)
      expect(Math.abs(ici.descente - avant.descente), `descente à t=${t.toFixed(3)}`).toBeLessThanOrEqual(PENTE_MAX * PAS * 2 + 1e-9)
      avant = ici
    }
    // …et la PRÉMISSE : le trajet a bien traversé les deux milieux, sinon la garde ne prouve rien.
    expect(enfoncement({ ...SEC, dVase: 0.6, dRive: -9 }).coupe).toBeCloseTo(VASE_PX, 5)
    expect(enfoncement({ ...SEC, dVase: 2, dRive: 2 }).coupe).toBeCloseTo(EAU_PX, 5)
  })

  it('LE DOMAINE ENTIER : aucune combinaison ne saute, sur aucun axe', () => {
    // Balayage exhaustif (et pas des cas choisis) : les quatre milieux, croisés. On dérive
    // chaque axe séparément — une discontinuité ne se cache pas dans un coin du produit.
    const PAS = 0.01
    for (let neige = 0; neige <= 2; neige += 0.5) {
      for (let enfoui = 0; enfoui <= 1; enfoui += 0.5) {
        for (let dVase = -1; dVase <= 1; dVase += 0.25) {
          let avant = enfoncement({ dRive: -1, dVase, hauteurNeige: neige, enfoui, displayH: H })
          for (let dRive = -1; dRive <= 1; dRive += PAS) {
            const ici = enfoncement({ dRive, dVase, hauteurNeige: neige, enfoui, displayH: H })
            expect(Math.abs(ici.coupe - avant.coupe), `neige ${neige} enfoui ${enfoui} vase ${dVase} rive ${dRive.toFixed(2)}`).toBeLessThanOrEqual(PENTE_MAX * PAS + 1e-9)
            expect(Math.abs(ici.descente - avant.descente)).toBeLessThanOrEqual(PENTE_MAX * PAS + 1e-9)
            avant = ici
          }
        }
      }
    }
  })

  it('LE ZÉRO TOMBE SUR LE TRAIT : au bord d’un milieu, il ne fait encore RIEN', () => {
    expect(rampe(0)).toBe(0)
    expect(rampe(-0.0001)).toBe(0)
    expect(enfoncement({ ...SEC, dVase: 0 }).coupe).toBe(0)
    expect(enfoncement({ ...SEC, dRive: 0 }).coupe).toBe(0)
    // Et la rampe est PLEINE exactement à sa portée, jamais avant.
    expect(rampe(RAMPE_TUILES)).toBe(1)
    expect(rampe(RAMPE_TUILES - 0.01)).toBeLessThan(1)
  })
})

describe('les deux lois de la composition', () => {
  it('① UN MAX, JAMAIS UNE SOMME : deux milieux ne s’empilent pas', () => {
    const eau = enfoncement({ ...SEC, dRive: 1 })
    const vase = enfoncement({ ...SEC, dVase: 1 })
    const lesDeux = enfoncement({ ...SEC, dRive: 1, dVase: 1 })
    expect(lesDeux.coupe).toBe(Math.max(eau.coupe, vase.coupe))
    expect(lesDeux.coupe).toBeLessThan(eau.coupe + vase.coupe) // la somme aurait noyé l'acteur
    // …et la vase est bien à MI-CHEMIN de l'eau (la correction d'Alexis, en un nombre).
    expect(vase.coupe).toBeCloseTo(eau.coupe / 2, 5)
  })

  it('② CE QUI MONTE NE FAIT PAS DESCENDRE : la neige découpe, elle n’enfonce pas', () => {
    for (let h = 0; h <= 2; h += 0.25) {
      const m = enfoncement({ ...SEC, hauteurNeige: h })
      expect(m.descente, `neige ${h}`).toBe(0)
      if (h > 0.01) expect(m.coupe).toBeGreaterThan(0)
    }
    // Sur une vase enneigée, la neige n'ajoute rien à la DESCENTE — seule la vase creuse.
    const vaseSeule = enfoncement({ ...SEC, dVase: 1 })
    const vaseEnneigee = enfoncement({ ...SEC, dVase: 1, hauteurNeige: 2 })
    expect(vaseEnneigee.descente).toBe(vaseSeule.descente)
    expect(vaseEnneigee.coupe).toBe(Math.max(vaseSeule.coupe, enfoncement({ ...SEC, hauteurNeige: 2 }).coupe))
  })

  it('L’EAU, LA VASE ET LA NEIGE NE CACHENT JAMAIS PLUS DE 45 % DU CORPS — la terre, si', () => {
    // On doit toujours voir QUI patauge ; un Cendreux qui sort de terre, lui, peut être entier
    // dessous — c'est ce qui doit rester vrai du lapin au cerf.
    const petit = { ...SEC, displayH: 6 } // un lapin : 45 % font 2,7 px, sous les 7 px de l'eau
    expect(enfoncement({ ...petit, dRive: 1 }).coupe).toBeCloseTo(6 * COUPE_MAX_FRACTION, 5)
    expect(enfoncement({ ...petit, dVase: 1 }).coupe).toBeCloseTo(6 * COUPE_MAX_FRACTION, 5)
    expect(enfoncement({ ...petit, hauteurNeige: 2 }).coupe).toBeCloseTo(Math.min(NEIGE_GENOUX_PX, 6 * COUPE_MAX_FRACTION), 5)
    expect(enfoncement({ ...petit, enfoui: 1 }).coupe).toBe(6) // la terre recouvre TOUT
  })

  it('LA GLACE PORTE : une rive retournée n’immerge plus (gel.md G5)', () => {
    // L'appelant retourne le signe de `dRive` quand la glace tient — la loi doit alors rendre
    // un corps parfaitement sec, sans reliquat d'immersion.
    const surLaGlace = enfoncement({ ...SEC, dRive: -1.5 })
    expect(surLaGlace.immersion).toBe(0)
    expect(surLaGlace.coupe).toBe(0)
    expect(surLaGlace.descente).toBe(0)
  })
})

describe('ce qui s’enfonce, c’est l’ÉPAISSEUR (le corps couché, 2026-08-25)', () => {
  it('un corps DEBOUT s’enfonce sur sa hauteur ; un corps COUCHÉ sur son petit côté', () => {
    expect(epaisseurQuiSEnfonce(12, 24, false)).toBe(24) // le marcheur : sa hauteur
    expect(epaisseurQuiSEnfonce(24, 10, true)).toBe(10) // couché est-ouest : son épaisseur
    expect(epaisseurQuiSEnfonce(10, 24, true)).toBe(10) // couché NORD-SUD : la même épaisseur
  })

  it('…et c’est ce qui empêchait l’eau de couper un rampant EN DEUX', () => {
    // Le défaut : `displayH` d'un couché nord-sud est sa LONGUEUR (24), et le plafond de coupe
    // vaut 45 % — l'eau lui prenait 45 % du corps par le pied. Sur son épaisseur, jamais plus
    // de 4,5 px, soit moins d'un cinquième de sa longueur.
    const milieu = { dRive: 5, dVase: -99, hauteurNeige: 0, enfoui: 0 }
    const faux = enfoncement({ ...milieu, displayH: 24 })
    const juste = enfoncement({ ...milieu, displayH: epaisseurQuiSEnfonce(10, 24, true) })
    expect(faux.coupe).toBeGreaterThan(6) // ce que le corps perdait sur sa longueur
    expect(juste.coupe).toBeLessThanOrEqual(10 * COUPE_MAX_FRACTION)
    expect(juste.coupe / 24).toBeLessThan(0.2)
  })
})
