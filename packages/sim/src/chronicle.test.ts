import { describe, expect, it } from 'vitest'
import { BALANCE, WORLD_EVENTS } from './balance'
import { chronicleFromEvents, formatChronicleLine, registreDuLieu, scellerLaChronique, volumesDeChronique, type ChronicleWeight } from './chronicle'
import { createEmptyMap } from './map'
import type { SimEvent } from './events'
import { TICKS_PER_SEASON_DAY, YEAR_DAYS } from './time'

// calendarScale = TICKS_PER_SEASON_DAY ⇒ day(tick) = tick + 1. Un jour = un tick,
// ce qui rend les assertions de date lisibles sans arithmétique de calendrier.
const SCALE = TICKS_PER_SEASON_DAY
/**
 * CE BANC-CI OUVRE AU JOUR 1, et pas au jour 51 du vrai monde (spec `saisons.md` S2) : le
 * formateur est PUR, il ne connaît du calendrier que ce qu'on lui passe. Ouvrir à 1 garde
 * « jour N = tick N−1 », donc les dates de ce fichier se lisent nues — c'est ce qui permet
 * d'écrire un jour d'hiver et de le RECONNAÎTRE dans l'attendu.
 */
const DEPART = 1
const NAMES: Record<number, string> = { 1: 'le Foyer de la Rivière', 2: 'la Meute des Cendres' }
/**
 * LA CARTE DU BANC — NUE, sans une seule zone. Le formateur y dérive donc une clef de lieu
 * `undefined` pour tout fait (R13), et les attendus de ce fichier restent des `{day, text,
 * weight}` exacts. La clef de lieu se garde là où elle vit : `fiche-lieu.test.ts`, sur une
 * carte QUI A des lieux — un banc qui se fabriquerait des lieux ici testerait deux choses à la
 * fois et n'en garderait aucune.
 */
const CARTE = createEmptyMap(200, 200, 0)

/** LE PREMIER JOUR D'UN ACTE (S1) — dérivé d'`ACT_DAYS`, jamais recopié : des saisons de
 *  30 jours ouvrent l'Éclosion au 1, l'Ardeur au 31, les Pluies au 61, le Grand Froid au 91,
 *  puis l'Éclosion de l'an 2 au 121. L'acte n'étant pas borné (T2), la formule non plus. */
const PREMIER_JOUR_DE = (acte: number): number => (acte - 1) * BALANCE.ACT_DAYS + 1

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
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entry).toEqual({ day: 1, text: "Un Feu s'est allumé : le Foyer de la Rivière.", weight: 'recit' })
    expect(formatChronicleLine(entry!)).toBe("Jour 1 — Un Feu s'est allumé : le Foyer de la Rivière.")
  })

  it('classe les poids : battement (Grand Froid, horde), récit (don), intime (mort)', () => {
    // Le Grand Froid est la QUATRIÈME saison depuis que l'année en compte quatre (S1/S3) :
    // l'acte 4 de l'an 1, ouvert au jour 91. C'est la saison qu'on met sous le battement,
    // parce que c'est celle qui frappe.
    const hiver = PREMIER_JOUR_DE(4)
    const entries = chronicleFromEvents(
      [
        at(hiver, { type: 'act_started', act: 4 }),
        at(hiver + 4, { type: 'horde_spawned', hordeId: 1, size: 9, fireTx: 20, fireTy: 10, villageId: 1, tx: 40, ty: 40 }),
        at(hiver + 6, { type: 'gift_given', byEntityId: 7, toVillageId: 1, item: 'berries', count: 3 }),
        at(hiver + 8, { type: 'entity_died', entityId: 7, byEntityId: 0, wasMonster: false }),
      ],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    const byDay = Object.fromEntries(entries.map((e) => [e.day, e.weight])) as Record<number, ChronicleWeight>
    expect(byDay[hiver]).toBe('battement')
    expect(byDay[hiver + 4]).toBe('battement')
    expect(byDay[hiver + 6]).toBe('recit')
    expect(byDay[hiver + 8]).toBe('intime')
    // L'acte 4 est bien « le Grand Froid ».
    expect(entries.find((e) => e.day === hiver)!.text).toBe('le Grand Froid a commencé.')
    // « Quelqu'un est tombé. » — l'intime, sobre.
    expect(entries.find((e) => e.day === hiver + 8)!.text).toBe("Quelqu'un est tombé.")
  })

  // L'ACTE DE NAISSANCE DU MONDE NE SE RACONTE PAS — et la garde porte sur le TICK 0, pas
  // sur le numéro de l'acte : depuis que le monde ouvre en pleine Ardeur (S2), son premier
  // acte n'est plus le 1 et « ne pas annoncer l'acte I » ne voudrait plus rien dire.
  it("n'annonce pas le premier instant du monde, ni la mort d'un monstre", () => {
    const entries = chronicleFromEvents(
      [
        at(1, { type: 'act_started', act: 1 }),
        at(5, { type: 'entity_died', entityId: 3, byEntityId: 1, wasMonster: true }),
      ],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
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
      DEPART,
      NAMES,
      CARTE,
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
      DEPART,
      NAMES,
      CARTE,
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
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries).toHaveLength(2)
    // Forme ACTIVE (« On a atteint ») : insensible à l'accord par construction — « la Ferme
    // brûlée a été atteint » serait la faute exacte de « le seuil de le Karst ».
    // Et chaque ligne de lieu porte sa clef `lieu` (le poiId) — la jointure de la fiche par lieu (T5).
    expect(entries[0]).toEqual({ day: 9, text: "On a atteint la Ferme brûlée I. Quelqu'un vivait là, pour l'eau.", weight: 'recit', lieu: 3 })
    expect(entries[1]).toEqual({ day: 11, text: "On a atteint la Charrette II. Quelqu'un vivait là, pour la route.", weight: 'recit', lieu: 4 })
  })

  it('l\u2019intact CHUCHOTE, et il gagne sur la cause : personne n\u2019était revenu (poids intime)', () => {
    const entries = chronicleFromEvents(
      [at(14, { type: 'poi_first_visit', poiId: 5, kind: 'ferme_ruinee', name: 'la Ferme des Prés III', byEntityId: 7, faits: [{ ere: 1, type: 'fondation', cause: 'eau', saillant: true }, { ere: 3, type: 'sort', cause: 'intact', saillant: true }] })],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    // AU PLUS UNE proposition (règle de l'écrivain) : l'intact prime sur la cause — c'est le
    // payoff de la doctrine « loin des routes = intact = riche », et sa sobriété EST son poids.
    expect(entries).toEqual([{ day: 14, text: "On a atteint la Ferme des Prés III. Personne n'était revenu.", weight: 'intime', lieu: 5 }])
  })

  it('le GUET parle quand le lieu n\u2019a ni sort ni fondation — « Elle regardait le sud. »', () => {
    const entries = chronicleFromEvents(
      [at(6, { type: 'poi_first_visit', poiId: 8, kind: 'tour_guet', name: 'la Tour de guet effondrée I', byEntityId: 7, faits: [{ ere: 1, type: 'guet', cause: 'sud', saillant: true }] })],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries).toEqual([{ day: 6, text: 'On a atteint la Tour de guet effondrée I. Elle regardait le sud.', weight: 'recit', lieu: 8 }])
    // Et l'article se plie à la direction : « l'est », jamais « le est ».
    const est = chronicleFromEvents(
      [at(7, { type: 'poi_first_visit', poiId: 9, kind: 'tour_guet', name: 'la Tour de guet effondrée I', byEntityId: 7, faits: [{ ere: 1, type: 'guet', cause: 'est', saillant: true }] })],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(est[0]!.text).toBe("On a atteint la Tour de guet effondrée I. Elle regardait l'est.")
  })

  // LE FRONT MORD AU GRAND FROID (S11) : ses jours se posent donc dans la quatrième saison,
  // là où il avance vraiment — un mors daté du printemps serait une donnée qui ment.
  it('le premier MORS seulement : la Cendre se met en marche une fois, puis la carte parle', () => {
    const hiver = PREMIER_JOUR_DE(4)
    const entries = chronicleFromEvents(
      [
        at(hiver, { type: 'cendre_avance', jour: hiver, front: 1, noeudsBrules: 0 }), // rien mangé : muet
        at(hiver + 1, { type: 'cendre_avance', jour: hiver + 1, front: 2, noeudsBrules: 3 }), // LE mors
        at(hiver + 2, { type: 'cendre_avance', jour: hiver + 2, front: 3, noeudsBrules: 8 }), // silence — 40 lignes identiques ne racontent rien
        at(hiver + 19, { type: 'cendre_avance', jour: hiver + 19, front: 12, noeudsBrules: 20 }),
      ],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries).toEqual([{ day: hiver + 1, text: 'La Cendre s’est mise en marche : le sud brûle.', weight: 'battement' }])
  })

  it('la Cendre PREND : la première fois chez chacun chuchote, ensuite le constat courant', () => {
    const hiver = PREMIER_JOUR_DE(4)
    const entries = chronicleFromEvents(
      [
        at(hiver + 4, { type: 'cendre_prend', jour: hiver + 4, villageId: 2, count: 3 }),
        at(hiver + 6, { type: 'cendre_prend', jour: hiver + 6, villageId: 2, count: 1 }),
        at(hiver + 9, { type: 'cendre_prend', jour: hiver + 9, villageId: 1, count: 2 }), // un AUTRE village : son intime à lui
      ],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries).toEqual([
      { day: hiver + 4, text: 'La Cendre est entrée chez « la Meute des Cendres ».', weight: 'intime' },
      { day: hiver + 6, text: 'La Cendre a pris d’autres ouvrages à « la Meute des Cendres ».', weight: 'recit' },
      { day: hiver + 9, text: 'La Cendre est entrée chez « le Foyer de la Rivière ».', weight: 'intime' },
    ])
  })

  it('l’acte est TOTAL et les saisons REVIENNENT : l’acte 8 est le Grand Froid de l’an 2, et il dit son caractère', () => {
    // L'arc oscille (T2) : on nomme la PHASE, pas le numéro global, et l'an se dit dès le
    // deuxième tour. Les QUATRE saisons ont désormais leur nom (S3) — « la Cendre » a quitté
    // la table : elle nomme le front, pas une saison.
    //
    // Et depuis S18, la ligne porte le CARACTÈRE de la saison quand elle en tire un (une sur
    // trois n'en a pas). C'est le seul endroit du jeu qui le nomme : le HUD se tait.
    const acteDe = (acte: number): string =>
      chronicleFromEvents([at(PREMIER_JOUR_DE(acte), { type: 'act_started', act: acte })], SCALE, DEPART, NAMES, CARTE)[0]!.text

    // L'an 1 se tait sur son numéro — c'est la seule année que le joueur n'a pas à situer.
    expect(acteDe(2)).toBe('l’Ardeur a commencé.')
    expect(acteDe(4)).toBe('le Grand Froid a commencé.')
    // L'an 2 dit le sien, et ces deux saisons-là ont tiré un caractère.
    expect(acteDe(5)).toBe('L’an 2 — l’Éclosion a commencé. — la Grande Levée.')
    expect(acteDe(8)).toBe('L’an 2 — le Grand Froid a commencé. — la Meute.')
  })

  it('la stèle SE CITE — le seul « nous » du jeu, entre guillemets', () => {
    const entries = chronicleFromEvents(
      [at(12, { type: 'poi_first_visit', poiId: 20, kind: 'stele', name: 'la Stèle II', byEntityId: 7, stele: { lignes: ['Ici les chemins se répondaient.', 'Nous guettions le sud.'] } })],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries).toEqual([{ day: 12, text: 'On a lu la Stèle II. « Ici les chemins se répondaient. Nous guettions le sud. »', weight: 'recit', lieu: 20 }])
  })

  it('la rumeur du réfugié se raconte — le prix est dit, jamais un conseil', () => {
    const entries = chronicleFromEvents(
      [at(17, { type: 'refugee_rumeur', groupId: 3, byEntityId: 7, poiId: 4, kind: 'ferme_ruinee', name: 'la Ferme brûlée I' })],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries).toEqual([{ day: 17, text: 'Pour un repas, des réfugiés ont dit où trouver la Ferme brûlée I.', weight: 'recit', lieu: 4 }])
  })

  it('un intact SANS fondation se tait — l\u2019arrière-pays intact est un décor, pas une ligne', () => {
    const entries = chronicleFromEvents(
      [at(3, { type: 'poi_first_visit', poiId: 12, kind: 'bivouac', name: 'le Vieux bivouac I', byEntityId: 7, faits: [{ ere: 3, type: 'sort', cause: 'intact', saillant: true }] })],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries).toHaveLength(0)
  })

  it('un fait NON SAILLANT se tait — le rare se dit, le commun se tait (R4)', () => {
    const entries = chronicleFromEvents(
      [at(4, { type: 'poi_first_visit', poiId: 11, kind: 'abri', name: "l'Abri sous roche II", byEntityId: 7, faits: [{ ere: 3, type: 'sort', cause: 'intact', saillant: false }] })],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries).toHaveLength(0)
  })

  it('la FOSSE reste muette en chronique — 80 charniers feraient 80 lignes (R4, le rare se dit)', () => {
    const entries = chronicleFromEvents(
      [at(5, { type: 'poi_first_visit', poiId: 10, kind: 'charnier', name: 'le Charnier IV', byEntityId: 7, faits: [{ ere: 3, type: 'fosse', saillant: true }] })],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries).toHaveLength(0)
  })

  it('un lieu SANS annales et sans devise recit reste muet — pas de spam de premières visites', () => {
    const entries = chronicleFromEvents(
      [at(5, { type: 'poi_first_visit', poiId: 6, kind: 'tarn', name: 'le Tarn I', byEntityId: 7 })],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
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
      DEPART,
      NAMES,
      CARTE,
    )
    expect(entries.map((e) => e.weight)).toEqual(['battement', 'recit', 'recit'])
    expect(entries[0]!.text).toBe("Le monde s'est éteint. Ce qu'on retiendra :")
    expect(entries[1]!.text).toBe('le Foyer de la Rivière a tenu jusqu’au bout.')
    expect(entries.every((e) => e.day === 48)).toBe(true)
  })

  /**
   * LE MOT « MÉGA-HORDE » NE SE DÉPENSE QU'UNE FOIS PAR SAISON (décision d'Alexis,
   * 2026-08-02). Le seuil valait `12` écrit en clair — soit exactement la taille d'une horde
   * ORDINAIRE de la saison la plus dure : la chronique criait donc au loup toutes les nuits
   * de l'hiver, et le mot ne pesait plus rien quand la vraie tombait.
   *
   * On balaie TOUTES les tailles que le jeu produit vraiment — le bas, le milieu et le
   * sommet de la RAMPE — au lieu de piquer deux cas : c'est la propriété qu'on affirme
   * (« seuls les sommets de la pente portent les grands mots »), pas un échantillon.
   */
  it('les mots du récit se dérivent de la rampe : « déferlé » au sommet, « grande » à mi-pente, rien en bas', () => {
    // `''` quand la chronique ne dit RIEN — une petite horde de début de saison n'a pas de
    // ligne du tout, et c'est le comportement voulu : la chronique n'est pas un journal.
    const texteDe = (size: number, villageId?: number): string =>
      chronicleFromEvents(
        [at(30, villageId === undefined
          ? { type: 'horde_spawned', hordeId: 1, size, fireTx: 20, fireTy: 10, tx: 40, ty: 40 }
          : { type: 'horde_spawned', hordeId: 1, size, fireTx: 20, fireTy: 10, villageId, tx: 40, ty: 40 })],
        SCALE, DEPART, NAMES, CARTE,
      )[0]?.text ?? ''

    const grande = (WORLD_EVENTS.HORDE_TAILLE.DEBUT + WORLD_EVENTS.HORDE_TAILLE.FIN) / 2
    expect(texteDe(WORLD_EVENTS.HORDE_TAILLE.DEBUT, 1)).toBe('') // le bas de la pente se tait
    expect(texteDe(Math.ceil(grande), 1)).toContain('grande horde')
    expect(texteDe(WORLD_EVENTS.HORDE_TAILLE.FIN, 1)).toContain('a déferlé')
    // Et la cible peut être un simple feu de camp (décision ⑬) : le récit le dit sans village.
    expect(texteDe(WORLD_EVENTS.HORDE_TAILLE.FIN)).toContain('un feu isolé')
  })
})


// ═══ LA MÉMOIRE DES HIVERS (saison-sans-fin T5) — décision d'Alexis : la chronique se scelle ═══
describe('les volumes — un par année, et le formateur repart à neuf au tour de l’année', () => {
  // SCALE = un jour par tick : le jour N tombe au tick N−1 ; l'année fait `YEAR_DAYS` jours
  // (120 depuis S1), donc l'an 1 = jours 1..120 et l'an 2 = 121..240.
  it('partitionne par AN, dans l’ordre, et chaque an a ses PREMIÈRES FOIS', () => {
    // Le front mord au Grand Froid (S11) — et il remord au suivant, un an plus tard : c'est
    // exactement ce que ce test veut voir, la même saison qui revient.
    const hiver = PREMIER_JOUR_DE(4)
    const hiver2 = hiver + YEAR_DAYS
    const volumes = volumesDeChronique(
      [
        at(hiver + 1, { type: 'cendre_avance', jour: hiver + 1, front: 2, noeudsBrules: 3 }), // an 1 : le premier mors
        at(hiver + 14, { type: 'cendre_prend', jour: hiver + 14, villageId: 2, count: 3 }), //  an 1 : intime
        at(hiver2 + 1, { type: 'cendre_avance', jour: hiver2 + 1, front: 20, noeudsBrules: 5 }), // an 2 : l'hiver REVIENT
        at(hiver2 + 14, { type: 'cendre_prend', jour: hiver2 + 14, villageId: 2, count: 1 }), //  an 2 : chuchote de nouveau
      ],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    expect(volumes.map((v) => v.an)).toEqual([1, 2])
    expect(volumes[0]!.entrees.map((e) => e.weight)).toEqual(['battement', 'intime'])
    // L'an 2 redit le mors et rechuchote : la mémoire du formateur est PAR ANNÉE.
    expect(volumes[1]!.entrees.map((e) => e.weight)).toEqual(['battement', 'intime'])
    expect(volumes[1]!.entrees[0]!.text).toBe('La Cendre s’est mise en marche : le sud brûle.')
  })

  it('un flux vide rend zéro volume ; un an dont rien ne se dit garde un volume VIDE', () => {
    expect(volumesDeChronique([], SCALE, DEPART, NAMES, CARTE)).toEqual([])
    // Un événement muet (un cairn, hors devise récit, sans annales) : l'an existe dans le flux
    // mais son volume est vide — on le garde (l'an a eu lieu), ses entrées sont [].
    const anDeux = YEAR_DAYS + 30
    const v = volumesDeChronique([at(anDeux, { type: 'poi_first_visit', poiId: 2, kind: 'cairn', name: 'un cairn', byEntityId: 7 })], SCALE, DEPART, NAMES, CARTE)
    expect(v).toEqual([{ an: 2, entrees: [] }])
  })
})

describe('le scellement — les années révolues deviennent des textes, l’année courante reste un flux', () => {
  it('au tour de l’an 3 : les ans 1 et 2 scellés, l’an 3 brut', () => {
    const hiver = PREMIER_JOUR_DE(4)
    const an3 = PREMIER_JOUR_DE(2 * 4 + 1) // l'acte 9 : l'Éclosion de l'an 3, au jour 241
    const flux = [
      at(hiver + 1, { type: 'cendre_avance', jour: hiver + 1, front: 2, noeudsBrules: 3 }),
      at(hiver + 1 + YEAR_DAYS, { type: 'cendre_avance', jour: hiver + 1 + YEAR_DAYS, front: 20, noeudsBrules: 5 }),
      at(an3, { type: 'act_started', act: 9 }),
      at(an3 + 20, { type: 'cendre_avance', jour: an3 + 20, front: 30, noeudsBrules: 2 }),
    ]
    const { volumes, courant } = scellerLaChronique(flux, SCALE, DEPART, NAMES, 3, CARTE)
    expect(volumes.map((v) => v.an)).toEqual([1, 2])
    expect(volumes.every((v) => v.entrees.length === 1)).toBe(true)
    expect(courant).toHaveLength(2) // les deux événements de l'an 3, BRUTS
    expect(courant.every((e) => e.tick >= 2 * YEAR_DAYS)).toBe(true)
  })

  it('rien à sceller au tour de l’an 1 : tout reste courant', () => {
    const flux = [at(22, { type: 'cendre_avance', jour: 22, front: 2, noeudsBrules: 3 })]
    const { volumes, courant } = scellerLaChronique(flux, SCALE, DEPART, NAMES, 1, CARTE)
    expect(volumes).toEqual([])
    expect(courant).toHaveLength(1)
  })
})

describe('la fiche par lieu — annales et chronique interfeuillées par la clef de LIEU', () => {
  it('une ferme : ses faits d’avant, puis ce que le joueur y a fait, an par an', () => {
    const map = createEmptyMap(60, 60, 0)
    map.zones.push({ name: 'la Ferme brûlée I', x: 10, y: 10, w: 2, h: 2, kind: 'ferme_ruinee' }) // poiId 0
    map.annales = [
      { ere: 1, type: 'fondation', x: 11, y: 11, lieu: 'ferme_ruinee', cause: 'eau' },
      { ere: 3, type: 'sort', x: 11, y: 11, lieu: 'ferme_ruinee', cause: 'brule' },
    ]
    // Une visite de l'an 1, une rumeur de l'an 2 : la fiche doit les rendre dans cet ordre,
    // an par an — l'année fait `YEAR_DAYS` jours (S1), donc le second est au-delà.
    const anDeux = YEAR_DAYS + 40
    const volumes = volumesDeChronique(
      [
        at(9, { type: 'poi_first_visit', poiId: 0, kind: 'ferme_ruinee', name: 'la Ferme brûlée I', byEntityId: 7, faits: [{ ere: 1, type: 'fondation', cause: 'eau', saillant: true }] }),
        at(anDeux, { type: 'refugee_rumeur', groupId: 1, byEntityId: 7, poiId: 0, kind: 'ferme_ruinee', name: 'la Ferme brûlée I' }),
        at(anDeux + 1, { type: 'poi_first_visit', poiId: 1, kind: 'sanctuaire', name: 'le Sanctuaire', byEntityId: 7 }), // un AUTRE lieu
      ],
      SCALE,
      DEPART,
      NAMES,
      CARTE,
    )
    const fiche = registreDuLieu(map, 0, volumes)
    // La vallée écrit les premières lignes…
    expect(fiche.annales.map((f) => `${f.type}:${f.cause}`)).toEqual(['fondation:eau', 'sort:brule'])
    // …le joueur écrit les suivantes, an par an — et rien d'un autre lieu ne s'y glisse.
    expect(fiche.lignes.map((l) => [l.an, l.entree.day])).toEqual([[1, 9], [2, anDeux]])
    expect(fiche.lignes[0]!.entree.text).toContain("pour l'eau")
    expect(fiche.lignes[1]!.entree.text).toContain('réfugiés')
  })

  it('un poiId inconnu rend une fiche vide, jamais une erreur', () => {
    expect(registreDuLieu(createEmptyMap(10, 10, 0), 42, [])).toEqual({ annales: [], lignes: [] })
  })
})
