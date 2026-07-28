import { seasonDayAtTick } from '@braises/sim'
import { describe, expect, it } from 'vitest'
import { metaDepuisSauvegarde, type SaveRecord } from './persistence-store'
import { SLOT_COUNT, seedValide, slotValide } from './mondes'

/**
 * L'ÉCRAN DES VALLÉES PROMET, IL NE DOIT PAS MENTIR.
 *
 * « jour 14 · seed 2026 », en face d'un bouton EFFACER : ce sont des promesses faites sur une
 * sauvegarde qu'on n'a PAS ouverte (on ne désérialise pas cinq mondes pour peindre un menu).
 * Le seul endroit où elles peuvent se tromper est cette déduction-là — on la prouve ici.
 *
 * Elle ne sert QUE les Veillées d'avant l'écran des vallées (celles d'après portent leur méta,
 * écrite par l'hôte dans la même transaction que la partie). C'est exactement pour ça qu'elle
 * mérite un test : ce chemin ne se rejoue plus jamais après le premier passage au menu.
 */
const enveloppe = (partie: Record<string, unknown>): string => JSON.stringify({ v: 1, partie, noeuds: {} })

const record = (sim: string, savedAt = 1_700_000_000_000): SaveRecord => ({ sim, playerId: 7, chronicle: [], savedAt })

describe('metaDepuisSauvegarde — ce que le menu dit d’une case sans l’ouvrir', () => {
  it('lit la seed et le jour de saison dans l’enveloppe carte/partie', () => {
    const rec = record(enveloppe({ seed: 4242, tick: 36_000, calendarScale: 120 }))
    const meta = metaDepuisSauvegarde(rec)

    expect(meta.seed).toBe(4242)
    expect(meta.seasonDay).toBe(seasonDayAtTick(36_000, 120))
    expect(meta.savedAt).toBe(rec.savedAt)
    // Rien ne dit quand ce monde a été FONDÉ : sa dernière sauvegarde fait foi, faute de mieux.
    expect(meta.createdAt).toBe(rec.savedAt)
  })

  it('lit AUSSI l’ancienne enveloppe (`{v, sim}`, carte comprise) — une reprise ne se perd pas', () => {
    // Le format d'avant la coupe carte/partie se reprend encore (`boot()` le relit puis le
    // réécrit au format neuf) : il doit donc s'AFFICHER, sinon le menu prétend « jour ? » d'une
    // vallée parfaitement lisible, et le joueur croit sa partie perdue.
    const vieux = JSON.stringify({ v: 1, sim: { seed: 99, tick: 20_000, calendarScale: 120 } })
    const meta = metaDepuisSauvegarde(record(vieux))

    expect(meta.seed).toBe(99)
    expect(meta.seasonDay).toBe(seasonDayAtTick(20_000, 120))
  })

  it('un tick de 0 reste le JOUR 1 — une vallée fondée n’est pas une vallée inconnue', () => {
    expect(metaDepuisSauvegarde(record(enveloppe({ seed: 1, tick: 0, calendarScale: 120 }))).seasonDay).toBe(1)
  })

  it('NE JETTE JAMAIS : une sauvegarde illisible rend des inconnus, pas une exception', () => {
    // Une case illisible doit rester affichable — donc EFFAÇABLE. Si cette fonction jetait,
    // l'écran entier tomberait et le joueur n'aurait plus aucun moyen de récupérer sa place.
    for (const brut of ['', '{{', 'null', '[]', '"texte"', '{"v":1}', enveloppe({})]) {
      const meta = metaDepuisSauvegarde(record(brut))
      expect(meta.seed).toBe(0)
      expect(meta.seasonDay).toBe(0) // « jour ? », jamais un jour 1 inventé
      expect(meta.savedAt).toBe(1_700_000_000_000)
    }
  })

  it('sans échelle de calendrier, le jour est INCONNU — on n’invente pas un jour 1', () => {
    // `seasonDayAtTick(tick, 0)` rendrait 1 quel que soit le tick : une saison bien avancée
    // s'afficherait comme fraîche, et l'on effacerait la mauvaise case en la croyant vide.
    expect(metaDepuisSauvegarde(record(enveloppe({ seed: 5, tick: 500_000 }))).seasonDay).toBe(0)
  })
})

describe('les bornes d’un monde — une clé fantôme ne se rattrape pas', () => {
  it('slotValide n’accepte que les cases qui existent', () => {
    // Écrire dans une case hors bornes poserait une clé que plus rien ne relit ni n'efface :
    // le disque grossit, l'écran des vallées n'en sait rien. On refuse en amont.
    for (let i = 0; i < SLOT_COUNT; i++) expect(slotValide(i)).toBe(true)
    for (const n of [-1, SLOT_COUNT, 1.5, NaN, Infinity]) expect(slotValide(n)).toBe(false)
  })

  it('seedValide n’accepte qu’un entier positif borné', () => {
    for (const n of [0, 1, 2026, 999_999_999]) expect(seedValide(n)).toBe(true)
    for (const n of [-1, 1_000_000_000, 3.5, NaN, Infinity]) expect(seedValide(n)).toBe(false)
  })
})
