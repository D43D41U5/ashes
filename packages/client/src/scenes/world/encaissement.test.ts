import { describe, expect, it } from 'vitest'
import {
  amplitudeRecul,
  ARRET_MS,
  DEGATS_PLEIN,
  encaissement,
  ENCAISSE_MS,
  RECUL_MAX_PX,
  RECUL_MIN_PX,
  secousseDuCoup,
  SECOUSSE_PORTE_MAX,
  SECOUSSE_PORTE_MIN,
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
