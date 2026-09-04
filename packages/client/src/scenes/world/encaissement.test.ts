import { describe, expect, it } from 'vitest'
import {
  amplitudeRecul,
  ARRET_MS,
  DEGATS_PLEIN,
  encaissement,
  ENCAISSE_MS,
  RECUL_MAX_PX,
  RECUL_MIN_PX,
  FLASH_BLANC,
  IMPACT_TINT,
  secousseDuCoup,
  SECOUSSE_PORTE_MAX,
  SECOUSSE_PORTE_MIN,
  teinteImpact,
} from './encaissement'

/**
 * CE QUI FERAIT ROUGIR — énoncé avant d'accepter un vert :
 *  · un temps d'arrêt qui n'arrête rien (l'écart bouge pendant `ARRET_MS`) ;
 *  · une couture qui saute à la fin de l'arrêt (le corps claquerait) ;
 *  · une réaction qui déborde de sa fenêtre (un corps rouge pour toujours) ;
 *  · une amplitude qui ne DISTINGUE pas deux armes (le poing et la lance au même écart).
 * Balayé sur tout le domaine, pas sur trois instants choisis.
 */
describe('encaissement — la réaction dans le temps', () => {
  it('LE TEMPS D’ARRÊT ARRÊTE : sur toute sa durée, rien ne bouge et la teinte est pleine', () => {
    for (let t = 0; t < ARRET_MS; t++) {
      const e = encaissement(t)
      expect(e).toEqual({ recul: 1, ecrase: 1, arret: true, teinte: 1 })
    }
  })

  it('la couture est CONTINUE : le dernier instant cloué et le premier instant libre se valent', () => {
    const avant = encaissement(ARRET_MS - 1e-9)
    const apres = encaissement(ARRET_MS)
    expect(apres.recul).toBeCloseTo(avant.recul, 12)
    expect(apres.ecrase).toBeCloseTo(avant.ecrase, 12)
    expect(apres.teinte).toBeCloseTo(avant.teinte, 12)
    // …et l'arrêt, LUI, a bien cessé : sans quoi le corps resterait cloué.
    expect(avant.arret).toBe(true)
    expect(apres.arret).toBe(false)
  })

  it('la détente ne remonte JAMAIS, et elle meurt exactement au bout', () => {
    let precedent = 1
    for (let t = ARRET_MS; t < ENCAISSE_MS; t += 0.5) {
      const e = encaissement(t)
      expect(e.recul).toBeLessThanOrEqual(precedent + 1e-12)
      expect(e.recul).toBeGreaterThanOrEqual(0)
      expect(e.ecrase).toBeCloseTo(e.recul, 12)
      precedent = e.recul
    }
    expect(encaissement(ENCAISSE_MS - 1e-9).recul).toBeLessThan(1e-9)
  })

  it('HORS FENÊTRE, rien : ni avant le coup, ni après la réaction', () => {
    for (const t of [-1e6, -1, ENCAISSE_MS, ENCAISSE_MS + 1, 1e6]) {
      expect(encaissement(t)).toEqual({ recul: 0, ecrase: 0, arret: false, teinte: 0 })
    }
  })
})

describe('amplitudeRecul — l’arme se sent', () => {
  it('bornée, jamais décroissante, et plate au-delà du plein', () => {
    let precedent = -Infinity
    for (let d = 0; d <= DEGATS_PLEIN * 3; d += 0.25) {
      const a = amplitudeRecul(d)
      expect(a).toBeGreaterThanOrEqual(RECUL_MIN_PX)
      expect(a).toBeLessThanOrEqual(RECUL_MAX_PX)
      expect(a).toBeGreaterThanOrEqual(precedent - 1e-12)
      precedent = a
    }
    expect(amplitudeRecul(0)).toBe(RECUL_MIN_PX)
    expect(amplitudeRecul(DEGATS_PLEIN)).toBe(RECUL_MAX_PX)
    expect(amplitudeRecul(DEGATS_PLEIN * 10)).toBe(RECUL_MAX_PX)
  })

  it('DEUX ARMES NE RENDENT PAS LE MÊME ÉCART : le poing (6) et la lance (16) se distinguent d’au moins un pixel', () => {
    // Les dégâts sont ceux de `combat.md` R5 — mains nues 6, épieu 10, lance 16.
    const poing = amplitudeRecul(6)
    const epieu = amplitudeRecul(10)
    const lance = amplitudeRecul(16)
    expect(epieu - poing).toBeGreaterThanOrEqual(1)
    expect(lance - epieu).toBeGreaterThanOrEqual(1)
  })
})

describe('secousseDuCoup — le cadre confirme sans disputer', () => {
  it('reste sous la secousse ENCAISSÉE (0,006) sur tout le domaine, et suit les dégâts', () => {
    let precedent = -Infinity
    for (let d = 0; d <= DEGATS_PLEIN * 3; d += 0.25) {
      const s = secousseDuCoup(d)
      expect(s).toBeGreaterThanOrEqual(SECOUSSE_PORTE_MIN)
      expect(s).toBeLessThanOrEqual(SECOUSSE_PORTE_MAX)
      // La règle de WorldScene : frapper ne doit jamais se ressentir comme prendre.
      expect(s).toBeLessThan(0.006)
      expect(s).toBeGreaterThanOrEqual(precedent - 1e-12)
      precedent = s
    }
  })
})

/**
 * CE QUI FERAIT ROUGIR ICI — et c'est la faute NATURELLE, celle qu'on écrit sans y penser :
 * une teinte qui se retire vers le NOIR. En `MULTIPLY`, 0x000000 éteint le corps et
 * 0xffffff est l'identité ; interpoler « vers zéro » comme on le fait pour une alpha
 * plongerait le sprite dans le noir au moment précis où il devait redevenir lui-même.
 * Le balayage l'attrape sur TOUT le domaine, pas aux deux bouts.
 */
describe('teinteImpact — la teinte se retire vers le blanc, jamais vers le noir', () => {
  const canaux = (c: number): [number, number, number] => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]

  it('les deux bouts sont exacts : plein = la teinte d’impact, rien = l’identité du mode', () => {
    expect(teinteImpact(1)).toBe(IMPACT_TINT)
    expect(teinteImpact(0)).toBe(FLASH_BLANC)
    // Hors domaine, on plafonne — un `e.teinte` négatif ne doit pas fabriquer une couleur.
    expect(teinteImpact(-3)).toBe(FLASH_BLANC)
    expect(teinteImpact(9)).toBe(IMPACT_TINT)
  })

  it('chaque canal va de sa valeur pleine vers 255, sans jamais redescendre ni sortir de l’octet', () => {
    const pleins = canaux(IMPACT_TINT)
    const precedents: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (let part = 1; part >= 0; part -= 0.005) {
      const c = canaux(teinteImpact(part))
      for (let i = 0 as 0 | 1 | 2; i < 3; i++) {
        expect(c[i]).toBeGreaterThanOrEqual(0)
        expect(c[i]).toBeLessThanOrEqual(255)
        // Le canal ne peut que MONTER vers 255 à mesure que la teinte se retire : un canal
        // qui descend, c'est un corps qui s'assombrit en guérissant.
        expect(c[i]).toBeGreaterThanOrEqual(precedents[i])
        expect(c[i]).toBeGreaterThanOrEqual(pleins[i])
        precedents[i] = c[i]
      }
    }
  })
})
