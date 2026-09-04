import { describe, expect, it } from 'vitest'
import type { MeteoAspect } from '@ashes/sim'
import type { Nappe } from './engine'
import {
  AVANCE_S,
  cibleDuCiel,
  FONDU_NAPPE_S,
  GRESIL,
  intensiteEntendue,
  LITS,
  PART_AVANCE,
  SonsDuCiel,
  TONNERRE,
  TONNERRE_CLAQUE,
} from './meteo-audio'
import { PORTEE } from './spatial'
import type { SoundSpec } from './sound'

const ASPECTS = Object.keys(LITS) as MeteoAspect[]

describe('les lits du ciel (cibleDuCiel)', () => {
  it('un lit par aspect, gains sous le plafond, et UN SEUL silence décidé : le brouillard', () => {
    // La table est exhaustive par le compilateur (`Record<MeteoAspect, …>`) ; ici on garde
    // ce qu'elle DIT : tout aspect s'entend à pleine intensité — sauf le brouillard, qui est
    // un déni de perception, pas un phénomène qui tombe. Un aspect ajouté muet par accident
    // rougit ici, pas dans les oreilles d'un joueur.
    const muets = ASPECTS.filter((a) => {
      const c = cibleDuCiel(a, 1)
      return c.pluie.gain === 0 && c.vent.gain === 0
    })
    expect(muets).toEqual(['brouillard'])
    for (const a of ASPECTS) {
      const lit = LITS[a]
      // Le plafond des one-shots est 0,15 (`sound.test`) ; un LIT permanent reste bien dessous.
      expect(lit.pluie.gain, a).toBeLessThanOrEqual(0.06)
      expect(lit.vent.gain, a).toBeLessThanOrEqual(0.06)
      expect(lit.pluie.hz, a).toBeGreaterThan(100)
      expect(lit.vent.hz, a).toBeGreaterThan(100)
    }
  })

  it('le niveau suit l’intensité en RAMPE (linéaire, bornes exactes), et le ciel clair est le repos', () => {
    for (const a of ASPECTS) {
      expect(cibleDuCiel(a, 0)).toEqual(cibleDuCiel(null, 1)) // hors bande = ciel clair
      const demi = cibleDuCiel(a, 0.5)
      const plein = cibleDuCiel(a, 1)
      expect(demi.pluie.gain).toBeCloseTo(plein.pluie.gain / 2, 10)
      expect(demi.vent.gain).toBeCloseTo(plein.vent.gain / 2, 10)
      // Le TIMBRE ne bouge pas avec l'intensité : c'est le niveau qui dit la distance au cœur.
      expect(demi.pluie.hz).toBe(plein.pluie.hz)
      expect(demi.vent.hz).toBe(plein.vent.hz)
    }
    const repos = cibleDuCiel(null, 0)
    expect(repos.pluie.gain).toBe(0)
    expect(repos.vent.gain).toBe(0)
  })

  it('la hiérarchie des vents se lit : le blizzard domine, la neige murmure', () => {
    expect(LITS.blizzard.vent.gain).toBeGreaterThan(LITS.vent_de_cendre.vent.gain)
    expect(LITS.vent_de_cendre.vent.gain).toBeGreaterThan(LITS.neige.vent.gain)
    // Le vent de cendre RACLE plus haut que le blizzard ne hurle — deux timbres, deux ciels.
    expect(LITS.vent_de_cendre.vent.hz).toBeGreaterThan(LITS.blizzard.vent.hz)
    // L'orage crépite plus fort et plus sombre que la pluie.
    expect(LITS.orage.pluie.gain).toBeGreaterThan(LITS.pluie.pluie.gain)
    expect(LITS.orage.pluie.hz).toBeLessThan(LITS.pluie.pluie.hz)
  })
})

describe('R9 — on l’entend avant de le voir (intensiteEntendue)', () => {
  it('le présent plein, ou le murmure du futur — jamais moins que l’un des deux', () => {
    expect(intensiteEntendue(1, 0)).toBe(1)
    expect(intensiteEntendue(0, 0)).toBe(0)
    // Le mur n'est pas encore là (présent 0) mais il sera là dans une minute : ça murmure.
    expect(intensiteEntendue(0, 1)).toBe(PART_AVANCE)
    expect(PART_AVANCE).toBeGreaterThan(0)
    expect(PART_AVANCE).toBeLessThan(1) // le futur s'entend, il ne domine pas
    expect(AVANCE_S).toBeGreaterThan(0)
    // Sous le mur, le futur n'ajoute rien : pas de sur-volume au cœur.
    expect(intensiteEntendue(1, 1)).toBe(1)
  })
})

/** Une nappe espionne : retient chaque `regler`, pour compter et relire. */
function nappeEspion(): {
  nappe: Nappe
  appels: { niveau: number; hz: number; fonduS: number }[]
  arrets: number[]
} {
  const appels: { niveau: number; hz: number; fonduS: number }[] = []
  const arrets: number[] = []
  return {
    appels,
    arrets,
    nappe: {
      regler: (niveau, hz, fonduS) => {
        appels.push({ niveau, hz, fonduS })
      },
      arreter: () => {
        arrets.push(1)
      },
    },
  }
}

describe('SonsDuCiel — la machine à états des nappes', () => {
  it('retente tant que l’audio dort, pose la cible au réveil, et ne re-rampe pas à l’identique', () => {
    const pluie = nappeEspion()
    const vent = nappeEspion()
    const sons = new SonsDuCiel()
    // L'audio dort : `ouvre` rend null — rien ne casse, rien ne se perd.
    sons.update(() => null, 'pluie', 1)
    expect(pluie.appels.length).toBe(0)
    // Le moteur se réveille : les nappes s'ouvrent et la cible se pose.
    const ouvre = (forme: 'pluie' | 'vent'): Nappe => (forme === 'pluie' ? pluie.nappe : vent.nappe)
    sons.update(ouvre, 'pluie', 1)
    expect(pluie.appels.length).toBe(1)
    expect(pluie.appels[0]).toEqual({ niveau: LITS.pluie.pluie.gain, hz: LITS.pluie.pluie.hz, fonduS: FONDU_NAPPE_S })
    expect(vent.appels[0]!.niveau).toBe(0)
    // La même cible reposée cent fois ne rampe qu'une : l'automation ne se remplit pas pour rien.
    for (let i = 0; i < 100; i++) sons.update(ouvre, 'pluie', 1)
    expect(pluie.appels.length).toBe(1)
    // Le ciel change : la cible suit.
    sons.update(ouvre, 'blizzard', 0.5)
    expect(pluie.appels.length).toBe(2)
    expect(vent.appels[vent.appels.length - 1]!.niveau).toBeCloseTo(LITS.blizzard.vent.gain / 2, 10)
    expect(sons.sonde.gainVent).toBeCloseTo(LITS.blizzard.vent.gain / 2, 10)
  })

  it('TAIRE arrête les deux nappes — sans quoi la pluie survit à la partie', () => {
    // LE DÉFAUT QU'ON FERME (Alexis, 2026-08-31 : « ça reste même sur l'écran d'accueil pendant
    // des minutes ») : une nappe est une source BOUCLÉE sur le master du MOTEUR, qui survit au
    // `shutdown` de la scène. Sans extinction explicite, quitter une partie sous l'averse
    // laissait la pluie tourner sur le menu, pour toujours.
    const pluie = nappeEspion()
    const vent = nappeEspion()
    const sons = new SonsDuCiel()
    const ouvre = (forme: 'pluie' | 'vent'): Nappe => (forme === 'pluie' ? pluie.nappe : vent.nappe)
    sons.update(ouvre, 'orage', 1)
    expect(pluie.appels.length).toBe(1) // PRÉMISSE : il pleut vraiment avant qu'on se taise
    expect(pluie.arrets.length).toBe(0)

    sons.taire()
    expect(pluie.arrets.length).toBe(1)
    expect(vent.arrets.length).toBe(1)
    expect(sons.sonde.gainPluie).toBe(0)

    // ET LA VEILLÉE SUIVANTE REPART DU SILENCE : les nappes sont relâchées, donc `update`
    // en REDEMANDE au moteur (une cible mémorisée sur des nœuds morts ne se reposerait jamais).
    const pluie2 = nappeEspion()
    const vent2 = nappeEspion()
    sons.update((f) => (f === 'pluie' ? pluie2.nappe : vent2.nappe), 'orage', 1)
    expect(pluie2.appels.length).toBe(1)
    expect(pluie.appels.length).toBe(1) // l'ancienne nappe ne reçoit plus rien
  })
})

describe('le tonnerre et le grésillement', () => {
  it('la frappe gronde en DEUX couches au point d’impact, portée CRI (auto-localisant)', () => {
    const joues: { spec: SoundSpec; delayS: number; at: { x: number; y: number } | undefined }[] = []
    const sons = new SonsDuCiel()
    sons.tonnerre(12, 34, (spec, delayS = 0, at) => joues.push({ spec, delayS, at }))
    expect(joues.length).toBe(2)
    expect(joues[0]!.spec).toBe(TONNERRE)
    expect(joues[1]!.spec).toBe(TONNERRE_CLAQUE)
    for (const j of joues) {
      expect(j.at).toEqual({ x: 12, y: 34 })
      expect(j.spec.portee).toBe(PORTEE.CRI)
      expect(j.spec.gain).toBeLessThanOrEqual(0.15) // le plafond de la maison tient aussi ici
    }
    expect(sons.sonde.tonnerres).toBe(1)
  })

  it('le grésillement est CADENCÉ et se resserre vers la frappe — muet à rampe nulle', () => {
    const sons = new SonsDuCiel()
    let grains = 0
    const play = (): void => {
      grains += 1
    }
    // Rampe nulle : pas un grain (le télégraphe n'a pas commencé).
    for (let t = 0; t < 2000; t += 16) sons.gresille(t, 5, 5, 0, play)
    expect(grains).toBe(0)
    // Rampe pleine : des grains, espacés — jamais un par image (60 fps ⇒ 125 appels/2 s).
    for (let t = 0; t < 2000; t += 16) sons.gresille(t, 5, 5, 1, play)
    expect(grains).toBeGreaterThan(5)
    expect(grains).toBeLessThan(40)
    expect(sons.sonde.grains).toBe(grains)
    // Et le grain lui-même reste un souffle : bref, haut, sous le plafond.
    expect(GRESIL.dur).toBeLessThan(0.1)
    expect(GRESIL.gain).toBeLessThanOrEqual(0.05)
  })
})
