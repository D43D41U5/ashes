import { describe, expect, it } from 'vitest'
import { COMBAT, staminaCapFor, TEMPERATURE } from '@ashes/sim'
import { etatVital } from './hud-core'

const endurance = { id: 'stamina', label: 'ENDURANCE', max: 100 }
const faim = { id: 'hunger', label: 'FAIM', max: 100, warn: 0 }
const temp = { id: 'temperature', label: 'TEMP', max: TEMPERATURE.CORPS_SAIN, warn: TEMPERATURE.CORPS_HYPOTHERMIE, unite: '°C' }

describe('la jauge d’endurance dit l’épuisement (item 10, R1ter)', () => {
  it('L’ALERTE SUIT LE VERROU, PAS LE NIVEAU — et c’est tout le problème', () => {
    // ═══ POURQUOI LA BARRE NE POUVAIT PAS LE DIRE À SA PLACE ═══
    //
    // Le verrou se pose à 0 et ne se lève qu'au quart du plafond (`SPRINT_RECOVER_FRACTION`).
    // Entre les deux, la jauge remonte pendant que la course reste REFUSÉE. Lire « il me
    // reste de l'endurance » et se voir refuser le sprint est exactement l'incohérence qui
    // se prend pour un bug — et le joueur n'avait aucun moyen de savoir laquelle des deux
    // lectures était la bonne.
    const auMilieu = COMBAT.SPRINT_RECOVER_FRACTION * 100 - 5
    expect(etatVital(endurance, auMilieu, true).alerte, 'verrou tenu, barre remontée').toBe(true)
    expect(etatVital(endurance, auMilieu, false).alerte, 'même barre, verrou levé').toBe(false)
    // Et à barre VIDE sans verrou (cas de bord), on ne crie pas : c'est le verrou qui parle.
    expect(etatVital(endurance, 0, false).alerte).toBe(false)
  })

  it('L’INFOBULLE NOMME LE SEUIL — sinon la punition est de durée inconnue', () => {
    const bulle = etatVital(endurance, 12, true).bulle
    expect(bulle).toContain('À BOUT DE SOUFFLE')
    // Le seuil est DÉRIVÉ de la fraction, jamais recopié : une garde écrite avec un nombre
    // en dur ne garderait rien le jour où le réglage bouge.
    expect(bulle).toContain(String(Math.ceil(COMBAT.SPRINT_RECOVER_FRACTION * 100)))
    // Les trois verbes refusés sont nommés : c'est CE que le joueur ne pouvait pas déduire.
    for (const verbe of ['course', 'coup', 'parade']) expect(bulle).toContain(verbe)
  })

  it('LE PLAFOND DE LA FAIM SE LIT — fraction sur le max COURANT, seuil dérivé (R2ter)', () => {
    // Ventre vide : la sim plafonne à `STARVED_STAMINA_CAP` (40) — l'infobulle doit dire
    // « / 40 », jamais « / 100 » : une barre qui « n'arrive plus à monter » sans que rien
    // ne le dise est exactement l'incohérence que ce fichier existe pour tuer.
    const cap = staminaCapFor(0)
    expect(etatVital(endurance, 12, false, cap).bulle).toBe(`ENDURANCE 12 / ${Math.round(cap)}`)
    // Et le seuil de reprise de l'affamé descend avec son plafond : ¼ × 40 = 10, pas 25.
    expect(etatVital(endurance, 2, true, cap).bulle).toContain(String(Math.ceil(COMBAT.SPRINT_RECOVER_FRACTION * cap)))
    // Les autres vitales ignorent le plafond : c'est une règle d'ENDURANCE.
    expect(etatVital(faim, 50, false, cap).bulle).toBe('FAIM 50 / 100')
  })

  it('LE VERROU NE DÉBORDE PAS SUR LES AUTRES VITALES', () => {
    // `exhausted` est un état d'ENDURANCE. S'il repeignait la faim ou la température, le
    // joueur lirait trois alarmes pour une seule cause.
    expect(etatVital(faim, 50, true).alerte).toBe(false)
    expect(etatVital(temp, 36, true).alerte).toBe(false)
    expect(etatVital(faim, 50, true).bulle).toBe('FAIM 50 / 100')
  })

  it('LES AUTRES RÈGLES D’AFFICHAGE SONT INTACTES', () => {
    // Non-régression : l'extraction de la fonction pure ne devait rien changer d'autre.
    expect(etatVital(faim, 0, false).alerte).toBe(true) // le seuil `warn` mord toujours
    expect(etatVital(temp, 34.4, false).bulle).toBe('TEMP 34 °C') // une unité se lit en valeur
    expect(etatVital(endurance, 12.1, false).bulle).toBe('ENDURANCE 13 / 100') // et les autres en fraction
  })
})
