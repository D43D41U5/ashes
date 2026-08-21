import { describe, expect, it } from 'vitest'
import { WORLD_EVENTS } from './balance'
import { chronicleFromEvents, formatChronicleLine, type ChronicleWeight } from './chronicle'
import type { SimEvent } from './events'
import { TICKS_PER_SEASON_DAY } from './time'

// calendarScale = TICKS_PER_SEASON_DAY ⇒ day(tick) = tick + 1. Un jour = un tick,
// ce qui rend les assertions de date lisibles sans arithmétique de calendrier.
const SCALE = TICKS_PER_SEASON_DAY
const NAMES: Record<number, string> = { 1: 'le Foyer de la Rivière', 2: 'la Meute des Cendres' }

/** `Omit` DISTRIBUTIF : sur une union discriminée, préserve les clés de chaque membre
 *  (un `Omit<SimEvent,'tick'>` nu ne garderait que les clés communes). */
type NoTick<E> = E extends unknown ? Omit<E, 'tick'> : never
/** Le jour N tombe au tick N-1 sous SCALE. */
const at = (day: number, e: NoTick<SimEvent>): SimEvent => ({ ...e, tick: day - 1 }) as SimEvent

describe('chronicleFromEvents — entrées structurées {jour, texte, poids}', () => {
  it('sépare le jour du texte (pas de préfixe « Jour N — » dans le texte)', () => {
    const [entry] = chronicleFromEvents(
      [at(1, { type: 'village_founded', villageId: 1, chiefId: 9, tx: 0, ty: 0 })],
      SCALE,
      NAMES,
    )
    expect(entry).toEqual({ day: 1, text: "Un Feu s'est allumé : le Foyer de la Rivière.", weight: 'recit' })
    expect(formatChronicleLine(entry!)).toBe("Jour 1 — Un Feu s'est allumé : le Foyer de la Rivière.")
  })

  it('classe les poids : battement (Grand Froid, horde), récit (don), intime (mort)', () => {
    const entries = chronicleFromEvents(
      [
        at(22, { type: 'act_started', act: 2 }),
        at(26, { type: 'horde_spawned', hordeId: 1, size: 9, fireTx: 20, fireTy: 10, villageId: 1, tx: 40, ty: 40 }),
        at(28, { type: 'gift_given', byEntityId: 7, toVillageId: 1, item: 'berries', count: 3 }),
        at(30, { type: 'entity_died', entityId: 7, byEntityId: 0, wasMonster: false }),
      ],
      SCALE,
      NAMES,
    )
    const byDay = Object.fromEntries(entries.map((e) => [e.day, e.weight])) as Record<number, ChronicleWeight>
    expect(byDay[22]).toBe('battement')
    expect(byDay[26]).toBe('battement')
    expect(byDay[28]).toBe('recit')
    expect(byDay[30]).toBe('intime')
    // L'Acte II est bien « le Grand Froid ».
    expect(entries.find((e) => e.day === 22)!.text).toBe('le Grand Froid a commencé.')
    // « Quelqu'un est tombé. » — l'intime, sobre.
    expect(entries.find((e) => e.day === 30)!.text).toBe("Quelqu'un est tombé.")
  })

  it("n'annonce pas l'Acte I, ni la mort d'un monstre", () => {
    const entries = chronicleFromEvents(
      [
        at(1, { type: 'act_started', act: 1 }),
        at(5, { type: 'entity_died', entityId: 3, byEntityId: 1, wasMonster: true }),
      ],
      SCALE,
      NAMES,
    )
    expect(entries).toHaveLength(0)
  })

  it('déduplique les dons par paire (donneur, village)', () => {
    const entries = chronicleFromEvents(
      [
        at(10, { type: 'gift_given', byEntityId: 7, toVillageId: 1, item: 'berries', count: 3 }),
        at(11, { type: 'gift_given', byEntityId: 7, toVillageId: 1, item: 'wood', count: 1 }),
        at(12, { type: 'gift_given', byEntityId: 8, toVillageId: 1, item: 'wood', count: 1 }),
      ],
      SCALE,
      NAMES,
    )
    // Deux donneurs distincts → deux lignes ; le second don du même donneur est mangé.
    expect(entries.filter((e) => e.text.includes('offerts')).length).toBe(2)
  })

  it("ne garde que les POI de devise `recit` (sanctuaire oui, cairn non)", () => {
    const entries = chronicleFromEvents(
      [
        at(8, { type: 'poi_first_visit', poiId: 1, kind: 'sanctuaire', name: 'le Sanctuaire', byEntityId: 7 }),
        at(9, { type: 'poi_first_visit', poiId: 2, kind: 'cairn', name: 'un cairn', byEntityId: 7 }),
      ],
      SCALE,
      NAMES,
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.text).toBe('le Sanctuaire a été atteint pour la première fois.')
  })

  it('le premier LECTEUR d\u2019annales : un lieu humain raconte son commencement (décision 2026-08-21)', () => {
    const entries = chronicleFromEvents(
      [
        // La fondation dit le POURQUOI — le toponyme dit déjà la fin, la chronique dit le
        // commencement (« deux témoins qui ne se concertent pas »).
        at(9, { type: 'poi_first_visit', poiId: 3, kind: 'ferme_ruinee', name: 'la Ferme brûlée I', byEntityId: 7, faits: [{ ere: 1, type: 'fondation', cause: 'eau', saillant: true }, { ere: 3, type: 'sort', cause: 'brule', saillant: true }] }),
        at(11, { type: 'poi_first_visit', poiId: 4, kind: 'charrette', name: 'la Charrette II', byEntityId: 7, faits: [{ ere: 1, type: 'fondation', cause: 'route', saillant: true }, { ere: 3, type: 'sort', cause: 'pille', saillant: true }] }),
      ],
      SCALE,
      NAMES,
    )
    expect(entries).toHaveLength(2)
    // Forme ACTIVE (« On a atteint ») : insensible à l'accord par construction — « la Ferme
    // brûlée a été atteint » serait la faute exacte de « le seuil de le Karst ».
    expect(entries[0]).toEqual({ day: 9, text: "On a atteint la Ferme brûlée I. Quelqu'un vivait là, pour l'eau.", weight: 'recit' })
    expect(entries[1]).toEqual({ day: 11, text: "On a atteint la Charrette II. Quelqu'un vivait là, pour la route.", weight: 'recit' })
  })

  it('l\u2019intact CHUCHOTE, et il gagne sur la cause : personne n\u2019était revenu (poids intime)', () => {
    const entries = chronicleFromEvents(
      [at(14, { type: 'poi_first_visit', poiId: 5, kind: 'ferme_ruinee', name: 'la Ferme des Prés III', byEntityId: 7, faits: [{ ere: 1, type: 'fondation', cause: 'eau', saillant: true }, { ere: 3, type: 'sort', cause: 'intact', saillant: true }] })],
      SCALE,
      NAMES,
    )
    // AU PLUS UNE proposition (règle de l'écrivain) : l'intact prime sur la cause — c'est le
    // payoff de la doctrine « loin des routes = intact = riche », et sa sobriété EST son poids.
    expect(entries).toEqual([{ day: 14, text: "On a atteint la Ferme des Prés III. Personne n'était revenu.", weight: 'intime' }])
  })

  it('le GUET parle quand le lieu n\u2019a ni sort ni fondation — « Elle regardait le sud. »', () => {
    const entries = chronicleFromEvents(
      [at(6, { type: 'poi_first_visit', poiId: 8, kind: 'tour_guet', name: 'la Tour de guet effondrée I', byEntityId: 7, faits: [{ ere: 1, type: 'guet', cause: 'sud', saillant: true }] })],
      SCALE,
      NAMES,
    )
    expect(entries).toEqual([{ day: 6, text: 'On a atteint la Tour de guet effondrée I. Elle regardait le sud.', weight: 'recit' }])
    // Et l'article se plie à la direction : « l'est », jamais « le est ».
    const est = chronicleFromEvents(
      [at(7, { type: 'poi_first_visit', poiId: 9, kind: 'tour_guet', name: 'la Tour de guet effondrée I', byEntityId: 7, faits: [{ ere: 1, type: 'guet', cause: 'est', saillant: true }] })],
      SCALE,
      NAMES,
    )
    expect(est[0]!.text).toBe("On a atteint la Tour de guet effondrée I. Elle regardait l'est.")
  })

  it('la stèle SE CITE — le seul « nous » du jeu, entre guillemets', () => {
    const entries = chronicleFromEvents(
      [at(12, { type: 'poi_first_visit', poiId: 20, kind: 'stele', name: 'la Stèle II', byEntityId: 7, stele: { lignes: ['Ici les chemins se répondaient.', 'Nous guettions le sud.'] } })],
      SCALE,
      NAMES,
    )
    expect(entries).toEqual([{ day: 12, text: 'On a lu la Stèle II. « Ici les chemins se répondaient. Nous guettions le sud. »', weight: 'recit' }])
  })

  it('la rumeur du réfugié se raconte — le prix est dit, jamais un conseil', () => {
    const entries = chronicleFromEvents(
      [at(17, { type: 'refugee_rumeur', groupId: 3, byEntityId: 7, poiId: 4, kind: 'ferme_ruinee', name: 'la Ferme brûlée I' })],
      SCALE,
      NAMES,
    )
    expect(entries).toEqual([{ day: 17, text: 'Pour un repas, des réfugiés ont dit où trouver la Ferme brûlée I.', weight: 'recit' }])
  })

  it('un intact SANS fondation se tait — l\u2019arrière-pays intact est un décor, pas une ligne', () => {
    const entries = chronicleFromEvents(
      [at(3, { type: 'poi_first_visit', poiId: 12, kind: 'bivouac', name: 'le Vieux bivouac I', byEntityId: 7, faits: [{ ere: 3, type: 'sort', cause: 'intact', saillant: true }] })],
      SCALE,
      NAMES,
    )
    expect(entries).toHaveLength(0)
  })

  it('un fait NON SAILLANT se tait — le rare se dit, le commun se tait (R4)', () => {
    const entries = chronicleFromEvents(
      [at(4, { type: 'poi_first_visit', poiId: 11, kind: 'abri', name: "l'Abri sous roche II", byEntityId: 7, faits: [{ ere: 3, type: 'sort', cause: 'intact', saillant: false }] })],
      SCALE,
      NAMES,
    )
    expect(entries).toHaveLength(0)
  })

  it('la FOSSE reste muette en chronique — 80 charniers feraient 80 lignes (R4, le rare se dit)', () => {
    const entries = chronicleFromEvents(
      [at(5, { type: 'poi_first_visit', poiId: 10, kind: 'charnier', name: 'le Charnier IV', byEntityId: 7, faits: [{ ere: 3, type: 'fosse', saillant: true }] })],
      SCALE,
      NAMES,
    )
    expect(entries).toHaveLength(0)
  })

  it('un lieu SANS annales et sans devise recit reste muet — pas de spam de premières visites', () => {
    const entries = chronicleFromEvents(
      [at(5, { type: 'poi_first_visit', poiId: 6, kind: 'tarn', name: 'le Tarn I', byEntityId: 7 })],
      SCALE,
      NAMES,
    )
    expect(entries).toHaveLength(0)
  })

  it('déplie la fin de saison : un battement puis les verdicts en récit', () => {
    const entries = chronicleFromEvents(
      [
        at(48, {
          type: 'season_ended',
          verdicts: [
            { villageId: 1, name: 'le Foyer de la Rivière', archetype: 'foyer', score: 3, outcome: 'a tenu jusqu’au bout' },
            { villageId: 2, name: 'la Meute des Cendres', archetype: 'meute', score: 2, outcome: 'est partie les bras pleins' },
          ],
        }),
      ],
      SCALE,
      NAMES,
    )
    expect(entries.map((e) => e.weight)).toEqual(['battement', 'recit', 'recit'])
    expect(entries[0]!.text).toBe("Le monde s'est éteint. Ce qu'on retiendra :")
    expect(entries[1]!.text).toBe('le Foyer de la Rivière a tenu jusqu’au bout.')
    expect(entries.every((e) => e.day === 48)).toBe(true)
  })

  /**
   * LE MOT « MÉGA-HORDE » NE SE DÉPENSE QU'UNE FOIS PAR SAISON (décision d'Alexis,
   * 2026-08-02). Le seuil valait `12` écrit en clair — soit exactement la taille d'une
   * horde d'ACTE III ORDINAIRE : la chronique criait donc au loup toutes les nuits de
   * l'acte III, et le mot ne pesait plus rien quand la vraie tombait.
   *
   * On balaie TOUTES les tailles que le jeu produit vraiment — les trois hordes d'acte
   * de la RAMPE — au lieu de piquer deux cas : c'est la propriété qu'on affirme (« seuls
   * les sommets de la pente portent les grands mots »), pas un échantillon.
   */
  it('les mots du récit se dérivent de la rampe : « déferlé » au sommet, « grande » à mi-pente, rien en bas', () => {
    // `''` quand la chronique ne dit RIEN — une petite horde de début de saison n'a pas de
    // ligne du tout, et c'est le comportement voulu : la chronique n'est pas un journal.
    const texteDe = (size: number, villageId?: number): string =>
      chronicleFromEvents(
        [at(30, villageId === undefined
          ? { type: 'horde_spawned', hordeId: 1, size, fireTx: 20, fireTy: 10, tx: 40, ty: 40 }
          : { type: 'horde_spawned', hordeId: 1, size, fireTx: 20, fireTy: 10, villageId, tx: 40, ty: 40 })],
        SCALE, NAMES,
      )[0]?.text ?? ''

    const grande = (WORLD_EVENTS.HORDE_TAILLE.DEBUT + WORLD_EVENTS.HORDE_TAILLE.FIN) / 2
    expect(texteDe(WORLD_EVENTS.HORDE_TAILLE.DEBUT, 1)).toBe('') // le bas de la pente se tait
    expect(texteDe(Math.ceil(grande), 1)).toContain('grande horde')
    expect(texteDe(WORLD_EVENTS.HORDE_TAILLE.FIN, 1)).toContain('a déferlé')
    // Et la cible peut être un simple feu de camp (décision ⑬) : le récit le dit sans village.
    expect(texteDe(WORLD_EVENTS.HORDE_TAILLE.FIN)).toContain('un feu isolé')
  })
})
