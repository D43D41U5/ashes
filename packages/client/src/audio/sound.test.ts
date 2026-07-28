import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@braises/sim'
import { soundForEvent, type SoundSpec } from './sound'
import { SONORES, VOIX } from './inventaire'

/** Fabrique un événement synthétique (les champs superflus sont ignorés par le routage). */
const ev = (type: string, extra: Record<string, unknown> = {}): SimEvent =>
  ({ type, tick: 0, ...extra }) as unknown as SimEvent

/**
 * QUI A UNE VOIX, ET QUI N'EN A PAS — la table exhaustive vit dans `inventaire.ts`.
 *
 * Elle y a MONTÉ (elle était ici) le jour où le banc d'écoute est né : le banc doit lire au
 * runtime ce que le test vérifie, et une seconde copie aurait divergé au premier arbitrage.
 * La garantie n'a pas bougé — `Record<SimEvent['type'], …>` rend le fichier ROUGE tant que
 * personne n'a dit ce qu'une nouvelle variante fait entendre.
 *
 * Le monde émet **61 faits de domaine** ; **10 sonnent**. Les 51 autres étaient muets parce
 * que personne ne les avait regardés — pas parce qu'on avait décidé qu'ils se taisent. La
 * nuance compte : `sound.ts` dit lui-même en en-tête « ESTHÉTIQUE À VALIDER — je ne peux pas
 * ENTENDRE le résultat », et l'audit de GATE 1 classe le son « oreilles d'Alexis ». Un
 * silence choisi est un choix de design ; un silence par omission est un trou.
 *
 * Ce qui suit ne tranche donc RIEN d'esthétique — ça rend l'inventaire exact et impossible à
 * laisser dériver. La liste des `muet` est ce sur quoi Alexis a à se prononcer, au banc.
 */

describe('la table de routage audio (soundForEvent)', () => {
  it('sonne les faits qui comptent (récolte, coup, mort, hurlement, nuit)', () => {
    expect(soundForEvent(ev('resource_harvested', { entityId: 1 }), true)).not.toBeNull()
    expect(soundForEvent(ev('monster_slain'), false)).not.toBeNull()
    expect(soundForEvent(ev('wolf_howl', { targetEntityId: 1 }), true)).not.toBeNull()
    expect(soundForEvent(ev('night_started'), false)).not.toBeNull()
    expect(soundForEvent(ev('entity_died', { entityId: 1 }), true)).not.toBeNull()
  })

  it('reste MUET sur les faits non sonores (haute fréquence ou hors registre)', () => {
    expect(soundForEvent(ev('action_rejected', { entityId: 1 }), true)).toBeNull()
    expect(soundForEvent(ev('meal_eaten', { entityId: 1 }), true)).toBeNull()
    expect(soundForEvent(ev('season_day_started', { day: 3 }), false)).toBeNull()
  })

  it('« sur moi » vs « sur un autre » : encaisser diffère de toucher', () => {
    const onMe = soundForEvent(ev('entity_damaged', { entityId: 1 }), true)!
    const onOther = soundForEvent(ev('entity_damaged', { entityId: 2 }), false)!
    expect(onMe.wave).not.toBe(onOther.wave) // choc mat (bruit filtré) ≠ « tac » clair
  })

  it('la récolte ne sonne QUE pour moi (pas les PNJ, sinon un vacarme de fond)', () => {
    expect(soundForEvent(ev('resource_harvested', { entityId: 1 }), false)).toBeNull()
  })

  it("CHAQUE fait de domaine a une voix ou un silence DÉCIDÉ — aucun par omission", () => {
    // La table est exhaustive par le compilateur ; ce test vérifie qu'elle dit la VÉRITÉ sur
    // le routage réel. Les deux moitiés comptent : un `voix` qui ne sonne pas est une promesse
    // non tenue, un `muet` qui sonne est un son que personne n'a voulu.
    const desaccords: string[] = []
    for (const [type, attendu] of Object.entries(VOIX)) {
      // On essaie les deux points de vue : plusieurs sons ne se déclenchent que « sur moi ».
      const sonne =
        soundForEvent(ev(type, { entityId: 1 }), true) !== null ||
        soundForEvent(ev(type, { entityId: 2 }), false) !== null
      const vu = sonne ? 'voix' : 'muet'
      if (vu !== attendu) desaccords.push(`${type} : table dit « ${attendu} », routage fait « ${vu} »`)
    }
    expect(desaccords).toEqual([])
  })

  it("l'inventaire tranché de GATE 1 : 61 faits, 34 voix", () => {
    // Un compte, pas un jugement. S'il bouge, c'est qu'un fait de domaine est né ou qu'une
    // voix a changé — dans les deux cas, quelqu'un doit le savoir.
    const total = Object.keys(VOIX).length
    const voix = SONORES.length
    expect(total).toBe(61)
    expect(voix).toBe(34)
  })

  it('L’AXE D’ALIGNEMENT S’ENTEND : les verbes chauds montent, les froids tombent', () => {
    // Le principe qui a décidé la famille SOCIAL, et la seule chose qui la rende lisible à
    // l'oreille avant qu'on en ait appris les mots. Une retouche de timbre qui inverserait
    // une pente casserait le sens sans casser aucun autre test — celui-ci la rattrape.
    const spec = (t: string): SoundSpec => soundForEvent(ev(t, { entityId: 2 }), false)!
    for (const chaud of ['gift_given', 'refugees_fed', 'refugees_recruited', 'refugees_arrived']) {
      const s = spec(chaud)
      expect(s.freqEnd, `${chaud} doit MONTER`).toBeGreaterThan(s.freq)
    }
    for (const froid of ['refugees_robbed', 'member_banished']) {
      const s = spec(froid)
      expect(s.freqEnd, `${froid} doit TOMBER`).toBeLessThan(s.freq)
      // Le timbre du prédateur, réservé aux verbes froids et à la horde qui marche.
      expect(s.wave, `${froid} est un verbe froid`).toBe('sawtooth')
    }
  })

  it('la CHUTE D’UN VILLAGE pèse plus lourd qu’une mort d’homme', () => {
    // Une hiérarchie qu'on ne peut pas expliquer au joueur : elle doit s'entendre. Un village
    // qui tombe est plus qu'une personne qui s'éteint — c'est plus long, et plus grave.
    const village = soundForEvent(ev('village_fell', { villageId: 3 }), false)!
    const homme = soundForEvent(ev('entity_died', { entityId: 2 }), false)!
    expect(village.dur).toBeGreaterThan(homme.dur)
    expect(village.freqEnd!).toBeLessThan(homme.freqEnd!)
  })

  it('tous les gains restent BAS et les durées positives (décor sonore, pas arcade)', () => {
    for (const type of SONORES) {
      const s = soundForEvent(ev(type, { entityId: 1 }), true)
      expect(s).not.toBeNull()
      expect(s!.gain).toBeGreaterThan(0)
      expect(s!.gain).toBeLessThanOrEqual(0.15)
      expect(s!.dur).toBeGreaterThan(0)
    }
  })
})
