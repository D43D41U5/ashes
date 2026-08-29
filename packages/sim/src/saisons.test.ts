/**
 * LES SAISONS (spec `docs/specs/saisons.md`) — les critères d'acceptation, un par `it`.
 *
 * Quatre saisons de trente jours qui tournent, une courbe de température à la place d'une
 * marche par acte, une nuit qui s'allonge, un ciel par saison, un niveau d'eau signé, une
 * menace qui respire et un caractère par saison. Ce fichier est la garde de l'ENSEMBLE :
 * chaque test porte le numéro du critère qu'il tient.
 *
 * ⚠ Les balayages sont EXHAUSTIFS (l'année entière, vingt ans) et non des jours choisis :
 * c'est la leçon maison — une garde sur trois cas choisis rate le dernier rang du domaine.
 */
import { describe, expect, it } from 'vitest'
import { fenetreOuverte } from './agriculture'
import {
  ACTS_PER_YEAR,
  AGRICULTURE,
  ALIGNMENT,
  BALANCE,
  BRUME,
  CENDREUX,
  dureteDeLAnnee,
  EAU,
  FIRE_UPKEEP,
  GEL,
  jourDeLAnnee,
  METEO,
  NIGHT_HUNT,
  SEASON,
  SPOIL_CYCLES,
  TEMPERATURE,
  TERRAIN_GRASS,
  YEAR_DAYS,
} from './balance'
import { drainEvents } from './events'
import { estGele, feuillageDenude } from './gel'
import { createEmptyMap } from './map'
import { episodeDuCycle, fenetreDe, frontMouille, largeurDe, meteoFeuConso, meteoIntensityAt, meteoMouille, meteoTypeDuCycle, type MeteoFront } from './meteo'
import { estAsseche, niveauDEau } from './eau'
import { effetsDe, effetsDuJour, modificateurDeSaison, PART_ORDINAIRE, type ModificateurId } from './modificateur'
import { countOf } from './items'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { grantItems } from './village'
import { dehorsSansMeteo } from './temperature'
import {
  actForDay,
  dayTicksPourJour,
  jourDeSaison,
  partDeNuit,
  phaseForDay,
  seasonRamp,
  TICKS_PER_CYCLE,
  TICKS_PER_SEASON_DAY,
  tourForDay,
} from './time'

/** Le socle de jour et de nuit d'un jour de l'année, en plaine à découvert et à ciel clair —
 *  la table que la spec S4 affiche, recalculée depuis les lois plutôt que recopiée. */
const jourEtNuit = (jour: number, tour = 1): { jour: number; nuit: number } => {
  const j = TEMPERATURE.SOCLE(jour, tour)
  return { jour: j, nuit: j - TEMPERATURE.ECART_NUIT(jour) }
}

/** Un monde nu, posé au jour voulu — le calendrier verrouillé sur le cycle (1 jour = 1 cycle),
 *  comme la Veillée et le banc. `jourDeDepart` reste 1 : c'est le jour que le tick désigne. */
function mondeAuJour(jour: number, options: { meteo?: boolean } = {}): SimState {
  const echelle = TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE
  const sim = createSim(7, {
    map: createEmptyMap(64, 64, TERRAIN_GRASS),
    calendarScale: echelle,
    finDeSaison: null,
    meteoActive: options.meteo ?? false,
  })
  sim.tick = Math.round(((jour - 1) * TICKS_PER_SEASON_DAY) / echelle)
  return sim
}

describe('A1 — le calendrier : quatre saisons de trente jours qui tournent', () => {
  it('trente jours par acte, quatre actes par an, et la phase cycle', () => {
    expect(BALANCE.ACT_DAYS).toBe(30)
    expect(YEAR_DAYS).toBe(120)
    for (let jour = 1; jour <= 3 * YEAR_DAYS; jour++) {
      const attendu = Math.floor((jour - 1) / BALANCE.ACT_DAYS) + 1
      expect(actForDay(jour)).toBe(attendu)
      expect(phaseForDay(jour)).toBe(((attendu - 1) % ACTS_PER_YEAR) + 1)
    }
    // Les quatre bornes qui NOMMENT l'année, et le jour d'ouverture du vrai jeu.
    expect(phaseForDay(1)).toBe(1) // l'Éclosion
    expect(phaseForDay(BALANCE.JOUR_DE_DEPART)).toBe(3) // les Pluies — le monde ouvre là (S2)
    expect(phaseForDay(61)).toBe(3) // les Pluies
    expect(phaseForDay(91)).toBe(4) // le Grand Froid
    expect(phaseForDay(121)).toBe(1) // l'Éclosion de l'an 2…
    expect(tourForDay(121)).toBe(2) // …et c'est bien l'an 2
  })

  it('actForDay reste monotone et non bornée sur dix mille jours', () => {
    let precedent = actForDay(1)
    for (let jour = 1; jour <= 10_000; jour++) {
      const a = actForDay(jour)
      expect(Number.isFinite(a)).toBe(true)
      expect(a).toBeGreaterThanOrEqual(precedent)
      precedent = a
    }
  })
})

describe('A2/A16 — la courbe : continue, cyclique à tour fixé, et bornée en pente', () => {
  it('la pente ne dépasse jamais 1 °C par jour, tour de l’an compris, sur vingt ans', () => {
    for (let tour = 1; tour <= 20; tour++) {
      for (let j = 1; j <= YEAR_DAYS; j++) {
        const ecart = Math.abs(TEMPERATURE.SOCLE(j + 1, tour) - TEMPERATURE.SOCLE(j, tour))
        expect(ecart, `tour ${tour}, jour ${j}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('cyclique À TOUR FIXÉ — et volontairement PAS d’une année sur l’autre', () => {
    for (let j = 1; j <= YEAR_DAYS; j++) {
      expect(TEMPERATURE.SOCLE(j + YEAR_DAYS, 3)).toBe(TEMPERATURE.SOCLE(j, 3))
    }
    // S12 fait glisser les cardinaux voisins : deux années consécutives DIFFÈRENT, et c'est
    // le mécanisme, pas un défaut. La garde le dit, sinon quelqu'un « corrigera » la cyclicité.
    expect(TEMPERATURE.SOCLE(75, 2)).toBeLessThan(TEMPERATURE.SOCLE(75, 1))
  })

  it('les quatre cardinaux valent ce que la spec affiche', () => {
    expect(jourEtNuit(15)).toEqual({ jour: 8, nuit: -2 })
    expect(jourEtNuit(45)).toEqual({ jour: 26, nuit: 20 })
    expect(jourEtNuit(75)).toEqual({ jour: 8, nuit: -2 })
    expect(jourEtNuit(105)).toEqual({ jour: -2, nuit: -16 })
  })
})

describe('A3 — l’Ardeur ne voit pas un flocon, le Grand Froid ne voit que ça', () => {
  /** Il neige là où la pluie ferait geler un gué : `T₀ − COLD.pluie < SEUIL_NEIGE`. */
  const neigeraitA = (t: number): boolean => t - METEO.COLD.pluie < METEO.SEUIL_NEIGE

  it('aucune nuit d’Ardeur ne neige, toutes les nuits du cœur de l’hiver neigent', () => {
    for (let j = 31; j <= 60; j++) {
      expect(neigeraitA(jourEtNuit(j).nuit), `nuit du jour ${j}`).toBe(false)
    }
    for (let j = 100; j <= 110; j++) {
      expect(neigeraitA(jourEtNuit(j).nuit), `nuit du jour ${j}`).toBe(true)
    }
  })

  it('l’écart jour/nuit SAISONNIER écarte les nuits froides de l’été et creuse celles de l’hiver', () => {
    // ⚠ CE QUE LA MESURE DIT VRAIMENT, et la spec cite un chiffre PÉRIMÉ : les « 107 nuits sur
    // 120 » de S5 ont été mesurées sur la courbe d'AVANT que l'été monte à +26 (Q2). Avec le
    // socle actuel, un écart fixe de 12 °C donne 87 nuits neigeuses contre 77 pour la courbe —
    // l'écart de COMPTE s'est réduit. Ce que la courbe achète reste net, et c'est ceci : six
    // degrés de plus sur les nuits d'été, deux de moins sur celles du cœur de l'hiver.
    let fixe = 0
    let saisonnier = 0
    for (let j = 1; j <= YEAR_DAYS; j++) {
      if (neigeraitA(TEMPERATURE.SOCLE(j, 1) - 12)) fixe++
      if (neigeraitA(jourEtNuit(j).nuit)) saisonnier++
    }
    expect(saisonnier).toBeLessThan(fixe)
    expect(jourEtNuit(45).nuit - (TEMPERATURE.SOCLE(45, 1) - 12)).toBe(6) // l'été respire
    expect(jourEtNuit(105).nuit - (TEMPERATURE.SOCLE(105, 1) - 12)).toBe(-2) // l'hiver mord
  })
})

describe('A4 — l’eau prend tard et lisiblement', () => {
  it('les gués gèlent la nuit autour de l’hiver, jamais pendant l’Ardeur', () => {
    for (let j = 31; j <= 60; j++) {
      expect(jourEtNuit(j).nuit, `nuit du jour ${j}`).toBeGreaterThan(GEL.SEUIL_GUE)
    }
    expect(jourEtNuit(105).nuit).toBeLessThan(GEL.SEUIL_GUE)
  })

  it('les lacs ne prennent qu’au cœur du Grand Froid', () => {
    const prend = (j: number): boolean => jourEtNuit(j).nuit < GEL.SEUIL_PROFOND
    expect(prend(105)).toBe(true)
    expect(prend(75)).toBe(false) // mi-Pluies : le lac tient
    expect(prend(45)).toBe(false) // mi-Ardeur : évidemment
  })
})

describe('A5/A6 — les épisodes, et la journée de pluie qui dure une journée', () => {
  const echelle = TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE

  /** La suite des cycles porteurs d'un front, sur les trente jours d'une saison. */
  const series = (premierJour: number): number[] => {
    const suites: number[] = []
    let courante = 0
    for (let j = premierJour; j < premierJour + BALANCE.ACT_DAYS; j++) {
      const cycle = j - 1 // 1 jour = 1 cycle à cette échelle
      if (meteoTypeDuCycle(cycle, echelle, 1) !== null) courante++
      else if (courante > 0) {
        suites.push(courante)
        courante = 0
      }
    }
    if (courante > 0) suites.push(courante)
    return suites
  }

  it('les Pluies portent au moins une série de trois jours ; l’Ardeur n’en porte pas de longue', () => {
    const pluies = series(61)
    expect(Math.max(...pluies)).toBeGreaterThanOrEqual(3)
    const ardeur = series(31)
    expect(Math.max(...ardeur)).toBeLessThanOrEqual(METEO.PAR_SAISON(2).episode[1])
  })

  it('un épisode est BORNÉ par la fourchette de sa saison', () => {
    for (let cycle = 0; cycle < 4 * YEAR_DAYS; cycle++) {
      const ep = episodeDuCycle(cycle, echelle, 1)
      if (ep === null) continue
      const duree = ep.fin - ep.debut
      const saison = METEO.PAR_SAISON(actForDay(ep.debut + 1))
      expect(duree).toBeGreaterThanOrEqual(saison.episode[0])
      expect(duree).toBeLessThanOrEqual(saison.episode[1])
    }
  })

  it('une pluie des Pluies couvre un point LES DEUX TIERS D’UN CYCLE (« une journée de pluie »)', () => {
    const W = 1581
    const H = 868
    const front: MeteoFront = {
      type: 'pluie',
      cycle: 60,
      day: 75, // mi-Pluies
      edge: 0,
      startTick: 0,
      endTick: fenetreDe({ type: 'pluie', day: 75 }),
    }
    let couvert = 0
    for (let t = 0; t < front.endTick; t += 20) {
      if (meteoIntensityAt(front, t, W, H, W / 2, H / 2) > 0) couvert += 20
    }
    // A6 SE DIT EN PART DE CYCLE, PAS EN MINUTES (reformulé le 2026-08-24, quand le cycle est
    // passé de 45 à 30 min). La promesse de S5 est « une journée de pluie est une journée » :
    // écrite « > 30 min réelles », la garde passait au rouge alors que la pluie couvrait
    // exactement la même PART du cycle qu'avant (74 %) — elle mesurait la durée du jour, pas
    // la météo. Ce qu'on affirme est donc la couverture relative.
    expect(couvert / TICKS_PER_CYCLE).toBeGreaterThan(2 / 3)
    // …et une averse d'Ardeur, elle, ne dure qu'un instant : c'est la MÊME loi, deux saisons.
    const ete: MeteoFront = { ...front, day: 45, endTick: fenetreDe({ type: 'pluie', day: 45 }) }
    let bref = 0
    for (let t = 0; t < ete.endTick; t += 20) {
      if (meteoIntensityAt(ete, t, W, H, W / 2, H / 2) > 0) bref += 20
    }
    expect(bref / TICKS_PER_CYCLE).toBeLessThan(1 / 15)
  })

  it('la largeur et la fenêtre se lisent PAR SAISON, jamais par type seul', () => {
    expect(largeurDe({ type: 'pluie', day: 75 })).toBeGreaterThan(largeurDe({ type: 'pluie', day: 45 }))
    expect(fenetreDe({ type: 'pluie', day: 75 })).toBeGreaterThan(fenetreDe({ type: 'pluie', day: 45 }))
  })
})

describe('A8 — le crépuscule mobile ne perd pas son événement', () => {
  it('la nuit tombe EXACTEMENT une fois par cycle, à toute saison', () => {
    for (const jour of [15, 45, 75, 105]) {
      const sim = mondeAuJour(jour)
      drainEvents(sim)
      let nuits = 0
      for (let t = 0; t < TICKS_PER_CYCLE; t++) {
        step(sim, [])
        for (const e of drainEvents(sim)) if (e.type === 'night_started') nuits++
      }
      expect(nuits, `jour ${jour}`).toBe(1)
    }
  })

  it('la nuit d’hiver dure DEUX FOIS la nuit d’été — les heures de la France', () => {
    // ⚠ L'ÉQUINOXE NE VAUT PLUS 0,625 (décision d'Alexis, 2026-08-26) : le soleil de la vallée
    // est celui de Paris, et un équinoxe, par définition, partage le jour en deux. L'ancienne
    // valeur — quinze heures de jour un 21 mars — n'était le soleil de nulle part.
    const nuitDe = (jour: number): number => TICKS_PER_CYCLE - dayTicksPourJour(jour)
    expect(nuitDe(105) / nuitDe(45)).toBeGreaterThan(2)
    // L'équinoxe partage le cycle : douze heures de jour, douze de nuit, à dix minutes près
    // (les dix minutes que valent la réfraction et le demi-diamètre du soleil — c'est pour ça
    // qu'un « équinoxe » réel donne 12 h 10 de jour, et non 12 h 00).
    for (const equinoxe of [15, 75]) {
      const heuresDeJour = (dayTicksPourJour(equinoxe) / TICKS_PER_CYCLE) * 24
      expect(heuresDeJour, `équinoxe au jour ${equinoxe}`).toBeCloseTo(12 + 10 / 60, 1)
    }
  })

  it('la part de nuit reste continue quelle que soit la longueur du jour', () => {
    for (const jour of [15, 45, 75, 105]) {
      const dayTicks = dayTicksPourJour(jour)
      let precedent = partDeNuit(0, dayTicks)
      for (let t = 1; t < TICKS_PER_CYCLE; t++) {
        const v = partDeNuit(t, dayTicks)
        expect(Math.abs(v - precedent), `jour ${jour}, tick ${t}`).toBeLessThan(0.01)
        precedent = v
      }
    }
  })
})

describe('A11 — aucune loi ne reste à trois paliers', () => {
  const LOIS = [
    ['SEASON.REGROW_ACT_FACTOR', SEASON.REGROW_ACT_FACTOR],
    ['FIRE_UPKEEP.ACT_FACTOR', FIRE_UPKEEP.ACT_FACTOR],
    ['ALIGNMENT.ACT_FACTOR', ALIGNMENT.ACT_FACTOR],
    ['NIGHT_HUNT.CHANCE_PER_MIN', NIGHT_HUNT.CHANCE_PER_MIN],
    ['BRUME.CHANCE_PER_DAY', BRUME.CHANCE_PER_DAY],
    ['CENDREUX.CONVERGE_TILES', CENDREUX.CONVERGE_TILES],
  ] as const

  it('les sept lois déclarent QUATRE paliers', () => {
    for (const [nom, loi] of LOIS) {
      expect(loi.paliers.length, nom).toBe(ACTS_PER_YEAR)
    }
  })

  it('la Brume est un mécanisme de FROID : zéro sur les trente jours de l’Ardeur', () => {
    for (let j = 31; j <= 60; j++) expect(BRUME.CHANCE_PER_DAY(actForDay(j)), `jour ${j}`).toBe(0)
    expect(BRUME.CHANCE_PER_DAY(4)).toBeGreaterThan(0) // le Grand Froid, lui, la lève
  })

  it('chaque loi atteint son maximum dans la saison où sa pression est voulue', () => {
    // La faim, le combustible, les dons, la chasse nocturne, la portée des cendreux : au
    // Grand Froid. La repousse (un facteur de LENTEUR) aussi — et son minimum est à
    // l'Éclosion, le seul vrai répit de l'année (S13 : la seule ligne qui s'écarte).
    for (const [nom, loi] of LOIS) {
      const valeurs = [1, 2, 3, 4].map((a) => loi(a) as number)
      expect(Math.max(...valeurs), nom).toBe(valeurs[3])
    }
    expect(SEASON.REGROW_ACT_FACTOR(1)).toBeLessThan(SEASON.REGROW_ACT_FACTOR(2)) // l'Ardeur sèche
  })
})

describe('A12 — le plafond d’ambiant laisse passer l’été', () => {
  it('le cœur de l’Ardeur rend bien +26 °C en plaine à découvert', () => {
    const sim = mondeAuJour(45)
    // Midi : la part de nuit est nulle, on lit le socle nu.
    sim.cycleOffset = Math.round(TICKS_PER_CYCLE * 0.25)
    expect(dehorsSansMeteo(sim, 32, 32, sim.tick)).toBeCloseTo(26, 5)
    expect(TEMPERATURE.AMBIANT_MAX).toBeGreaterThanOrEqual(26)
  })
})

describe('A14/A18 — l’hiver s’élargit, la menace respire, et le plancher monte', () => {
  it('le minimum de l’année ne descend JAMAIS sous celui de l’an 1', () => {
    const minDe = (tour: number): number => {
      let m = Infinity
      for (let j = 1; j <= YEAR_DAYS; j++) m = Math.min(m, TEMPERATURE.SOCLE(j, tour))
      return m
    }
    const an1 = minDe(1)
    for (let tour = 1; tour <= 20; tour++) expect(minDe(tour), `an ${tour}`).toBe(an1)
  })

  it('le nombre de jours froids croît d’une année sur l’autre, puis plafonne', () => {
    const froids = (tour: number): number => {
      let n = 0
      for (let j = 1; j <= YEAR_DAYS; j++) if (TEMPERATURE.SOCLE(j, tour) < 4) n++
      return n
    }
    expect(froids(3)).toBeGreaterThan(froids(1))
    expect(froids(6)).toBeGreaterThan(froids(3))
    expect(froids(20)).toBe(froids(10)) // le glissement a atteint sa borne
  })

  it('à phase fixée la dureté croît par tour ; à tour fixé l’Ardeur est plus douce que l’hiver', () => {
    for (let tour = 1; tour < 8; tour++) {
      const ete = dureteDeLAnnee(45 + (tour - 1) * YEAR_DAYS)
      const eteSuivant = dureteDeLAnnee(45 + tour * YEAR_DAYS)
      expect(eteSuivant, `an ${tour} → ${tour + 1}`).toBeGreaterThan(ete)
    }
    for (let tour = 1; tour <= 5; tour++) {
      const base = (tour - 1) * YEAR_DAYS
      expect(dureteDeLAnnee(base + 45)).toBeLessThan(dureteDeLAnnee(base + 105))
    }
  })

  it('la rampe de menace n’est plus une montée à sens unique', () => {
    // Le défaut qu'elle remplace : clampée au jour 60, elle saturait au milieu de l'Ardeur de
    // l'an 1 et n'en redescendait plus jamais — hordes pleines chaque nuit, dès le premier été.
    const ardeur = seasonRamp(0, 10, 45)
    const hiver = seasonRamp(0, 10, 105)
    const printempsSuivant = seasonRamp(0, 10, 135)
    expect(ardeur).toBeLessThan(hiver)
    expect(printempsSuivant).toBeLessThan(hiver)
  })
})

describe('A17 — la forêt reverdit', () => {
  it('dénudée au cœur du Grand Froid, feuillue au cœur de l’Ardeur, chaque année sur vingt ans', () => {
    const sim = mondeAuJour(1)
    const tx = 10
    const ty = 10
    sim.map.terrain[ty * sim.map.width + tx] = 3 // TERRAIN_FOREST : un feuillu
    const nuAuJour = (jour: number): boolean => {
      sim.tick = Math.round(((jour - 1) * TICKS_PER_SEASON_DAY) / sim.calendarScale)
      return feuillageDenude(sim, tx, ty)
    }
    for (let tour = 1; tour <= 20; tour++) {
      const base = (tour - 1) * YEAR_DAYS
      expect(nuAuJour(base + 105), `an ${tour}, cœur de l’hiver`).toBe(true)
      expect(nuAuJour(base + 45), `an ${tour}, cœur de l’été`).toBe(false)
    }
  })

  it('la fenêtre nue enjambe le tour de l’an et ne clignote pas', () => {
    const sim = mondeAuJour(1)
    const tx = 11
    const ty = 11
    sim.map.terrain[ty * sim.map.width + tx] = 3
    const etats: boolean[] = []
    for (let j = 1; j <= 2 * YEAR_DAYS; j++) {
      sim.tick = Math.round(((j - 1) * TICKS_PER_SEASON_DAY) / sim.calendarScale)
      etats.push(feuillageDenude(sim, tx, ty))
    }
    // Deux bascules par an, pas plus : elle tombe une fois, elle repousse une fois.
    let bascules = 0
    for (let i = 1; i < etats.length; i++) if (etats[i] !== etats[i - 1]) bascules++
    expect(bascules).toBe(4)
  })
})

describe('A15 — seule la violence fait taire le gibier', () => {
  it('la pluie et la neige laissent naître, l’orage et le vent de cendre non', () => {
    expect(METEO.QUIET.pluie).toBe(false) // …et la neige EST la classe `pluie` (R11)
    expect(METEO.QUIET.brouillard).toBe(false)
    expect(METEO.QUIET.orage).toBe(true) // …donc le blizzard aussi
    expect(METEO.QUIET.vent_de_cendre).toBe(true)
  })
})

describe('A21/A22 — le caractère de la saison', () => {
  it('pur, stable, et une saison sur trois n’en a pas', () => {
    let sans = 0
    let total = 0
    for (let tour = 1; tour <= 50; tour++) {
      for (let phase = 1; phase <= ACTS_PER_YEAR; phase++) {
        const a = modificateurDeSaison(tour, phase)
        expect(modificateurDeSaison(tour, phase)).toBe(a) // pur : deux lectures, même réponse
        total++
        if (a === null) sans++
      }
    }
    expect(sans / total).toBeGreaterThan(PART_ORDINAIRE - 0.15)
    expect(sans / total).toBeLessThan(PART_ORDINAIRE + 0.15)
  })

  it('jamais deux tours de suite le même caractère', () => {
    for (let phase = 1; phase <= ACTS_PER_YEAR; phase++) {
      for (let tour = 2; tour <= 200; tour++) {
        const a = modificateurDeSaison(tour - 1, phase)
        const b = modificateurDeSaison(tour, phase)
        if (a !== null) expect(b, `phase ${phase}, an ${tour}`).not.toBe(a)
      }
    }
  })

  it('un caractère ne tombe que dans SA saison', () => {
    const attendu: Record<number, ModificateurId[]> = {
      1: ['gelees_tardives', 'crue', 'grande_levee', 'reveil'],
      2: ['canicule', 'orages_secs', 'ete_pourri', 'nuee'],
      3: ['deluge', 'ete_indien', 'rouille', 'brame'],
      4: ['hiver_noir', 'grandes_neiges', 'disette', 'meute', 'vents_de_cendre'],
    }
    for (let tour = 1; tour <= 50; tour++) {
      for (let phase = 1; phase <= ACTS_PER_YEAR; phase++) {
        const a = modificateurDeSaison(tour, phase)
        if (a !== null) expect(attendu[phase]).toContain(a)
      }
    }
  })

  it('les dix-sept mordent : aucun caractère n’est une étiquette vide', () => {
    const tous: ModificateurId[] = [
      'gelees_tardives', 'crue', 'grande_levee', 'reveil',
      'canicule', 'orages_secs', 'ete_pourri', 'nuee',
      'deluge', 'ete_indien', 'rouille', 'brame',
      'hiver_noir', 'grandes_neiges', 'disette', 'meute', 'vents_de_cendre',
    ]
    for (const id of tous) {
      expect(Object.keys(effetsDe(id)).length, id).toBeGreaterThan(0)
    }
    // Quatre par saison, plus les Vents de cendre au Grand Froid (2026-08-28).
    expect(tous.length).toBe(4 * ACTS_PER_YEAR + 1)
  })

  it('le caractère du jour est celui de la saison de ce jour', () => {
    for (let jour = 1; jour <= 3 * YEAR_DAYS; jour++) {
      const attendu = modificateurDeSaison(tourForDay(jour), phaseForDay(jour))
      const effets = effetsDuJour(jour)
      expect(effets, `jour ${jour} (${jourDeLAnnee(jour)} de l’année)`).toBe(
        attendu === null ? effetsDuJour(jour) : effetsDe(attendu),
      )
    }
  })
})

describe('A19 — la fenêtre de semis', () => {
  it('chaque culture a SA saison, et la serre affranchit de la fenêtre', () => {
    const phases = [1, 2, 3, 4]
    for (const [id, def] of Object.entries(AGRICULTURE.CULTURES)) {
      for (const phase of phases) {
        const jour = (phase - 1) * BALANCE.ACT_DAYS + 15 // le cœur de la saison
        expect(fenetreOuverte(id as never, jour, 'parcelle'), `${id} en phase ${phase}`).toBe(
          phase === def.phase,
        )
        expect(fenetreOuverte(id as never, jour, 'serre'), `${id} sous serre`).toBe(true)
      }
    }
  })

  it('la graine hors fenêtre n’est PAS consommée', () => {
    const sim = mondeAuJour(105) // le Grand Froid : la pousse verte n'a rien à y faire
    const id = spawnEntity(sim, 5, 5)
    const acteur = sim.entities.find((e) => e.id === id)!
    grantItems(sim, id, { graine_verte: 2 })
    sim.structures.push({
      id: 1,
      type: 'parcelle',
      tx: 5,
      ty: 6,
      hp: 10,
      maxHp: 10,
      villageId: 0,
      ownerId: id,
    } as never)
    step(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'plant', structureId: 1 } }])
    expect(sim.structures[0]!.plantedAt).toBeUndefined()
    expect(countOf(acteur.inventory, 'graine_verte')).toBe(2) // rien n'a été mangé
  })

  it('le tubercule des Pluies traverse l’hiver sans pourrir', () => {
    expect(SPOIL_CYCLES.tubercule).toBeUndefined()
    expect(SPOIL_CYCLES.pousse_verte).toBeDefined() // …et la pousse verte, elle, ne se garde pas
  })
})

describe('A9 — le déterminisme tient', () => {
  it('deux mondes de même graine rejouent au bit près, météo armée', () => {
    const jouer = (): string => {
      const sim = mondeAuJour(51, { meteo: true })
      for (let t = 0; t < 400; t++) step(sim, [])
      return JSON.stringify({ tick: sim.tick, rng: sim.rngState, meteo: sim.meteo })
    }
    expect(jouer()).toBe(jouer())
  })

  it('le caractère de la saison ne consomme AUCUN tirage', () => {
    // La garde de S18 : si l'élection touchait le PRNG, l'état du tirage divergerait entre un
    // monde qui lit son caractère et un monde qui ne le lit pas.
    const sim = mondeAuJour(51)
    const avant = sim.rngState
    for (let jour = 1; jour <= 500; jour++) effetsDuJour(jour)
    expect(sim.rngState).toBe(avant)
  })
})

describe('A7bis — le niveau d’eau va dans les deux sens', () => {
  it('le gel et la sécheresse ne peuvent pas se produire le même jour', () => {
    // La garde de forme : l'aridité demande de la CHALEUR (le socle au-dessus de son seuil),
    // le gel demande du froid. Les deux domaines sont disjoints par construction.
    for (let j = 1; j <= YEAR_DAYS; j++) {
      const chaud = TEMPERATURE.SOCLE(j, 1) > 14
      const gelant = jourEtNuit(j).nuit < GEL.SEUIL_PROFOND
      expect(chaud && gelant, `jour ${j}`).toBe(false)
    }
  })

  it('un gué ne gèle pas au cœur de l’Ardeur, même de nuit', () => {
    const sim = mondeAuJour(45)
    sim.map.terrain[32 * sim.map.width + 32] = 4 // TERRAIN_SHALLOW_WATER
    sim.cycleOffset = Math.round(TICKS_PER_CYCLE * 0.8) // en pleine nuit
    expect(estGele(sim, 32, 32)).toBe(false)
  })
})

describe('A7 — l’assèchement porte une hystérésis (patron G8)', () => {
  it('le verdict ne bascule JAMAIS dans la bande morte : toute bascule est franche', () => {
    // Trois ans de cycles avec la météo ARMÉE : les fronts réels font respirer
    // `cyclesDepuisPluie`, donc le niveau oscille autour du seuil au fil de l'Ardeur — le
    // clignotement que l'hystérésis interdit. La loi se lit aux bords de cycle (le niveau est
    // constant dans un cycle : chaleur au jour entier, cycles secs par cycle), et la
    // propriété gardée est exactement G8 : une bascule du verdict n'arrive QUE sur un niveau
    // FRANC — jamais dans la bande (`−SEUIL`, `−SEUIL + HYSTERESIS`).
    const sim = mondeAuJour(1, { meteo: true })
    sim.map.terrain[32 * sim.map.width + 32] = 4 // TERRAIN_SHALLOW_WATER : le gué témoin
    const entree = -EAU.SEUIL_ASSECHEMENT
    const sortie = entree + EAU.HYSTERESIS_ASSECHEMENT
    let prev: boolean | null = null
    let dansLaBande = 0
    let bascules = 0
    let basculesFranches = 0
    for (let c = 0; c < 3 * YEAR_DAYS; c++) {
      const t = c * TICKS_PER_CYCLE
      const etat = { ...sim, tick: t }
      const n = niveauDEau(etat, t)
      if (n > entree && n < sortie) dansLaBande++
      const v = estAsseche(etat, 32, 32)
      if (prev !== null && v !== prev) {
        bascules++
        if (n <= entree || n >= sortie) basculesFranches++
      }
      prev = v
    }
    // Les trois prémisses qui rendraient la garde vide, affirmées : la bande est traversée,
    // et le gué sèche puis revient au fil des ans.
    expect(dansLaBande, 'aucun cycle dans la bande morte — la garde ne teste rien').toBeGreaterThan(0)
    expect(bascules, 'le gué ne sèche jamais — la garde ne teste rien').toBeGreaterThan(0)
    expect(basculesFranches, 'une bascule DANS la bande : l’hystérésis ne tient pas').toBe(bascules)
  })
})

describe('les Vents de cendre — le vent de cendre a de nouveau un électeur (2026-08-28)', () => {
  it('chaque élection du front TRACE au caractère, et il en existe — garde d’atteignabilité au runtime', () => {
    // Balayage de 200 ans de cycles (1 jour = 1 cycle) : TOUTE élection `vent_de_cendre`
    // doit venir d'un bloc dont le jour de départ porte le caractère (son seul électeur),
    // et il doit y en avoir AU MOINS UNE — la prémisse sans laquelle « le front existe »
    // resterait une affirmation de table, pas de runtime (le marais injoignable a déjà
    // coûté quatre espèces).
    const scale = TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE
    let elus = 0
    for (let cycle = 0; cycle < 200 * YEAR_DAYS; cycle++) {
      if (meteoTypeDuCycle(cycle, scale, 1) !== 'vent_de_cendre') continue
      elus++
      const bloc = Math.floor(cycle / METEO.BLOC_EPISODE)
      const jourDuBloc = bloc * METEO.BLOC_EPISODE + 1 // 1 cycle = 1 jour, départ au jour 1
      expect(effetsDuJour(jourDuBloc).ciel?.vent_de_cendre ?? 0, `cycle ${cycle} : élu hors caractère`).toBeGreaterThan(0)
    }
    expect(elus, 'aucun vent de cendre élu en 200 ans — le caractère n’élit pas').toBeGreaterThan(0)
  })

  it('il AFFAME le feu sans le mouiller — et l’orage sec de l’Ardeur ne s’est pas mis à presser', () => {
    // Le front posé à la main, mi-fenêtre (patron `debug_meteo`) : bande de 420 sur une
    // carte de 64, le centre est au cœur. `FEU_CONSO.vent_de_cendre` (1,8) dormait derrière
    // la porte du mouillé tant qu'aucune saison ne l'élisait.
    const sim = mondeAuJour(100, { meteo: true }) // Grand Froid, an 1 : aucun caractère (gel.test l'affirme)
    const fenetre = TICKS_PER_CYCLE
    sim.meteo = {
      type: 'vent_de_cendre', cycle: Math.floor(sim.tick / TICKS_PER_CYCLE), day: jourDeSaison(sim),
      edge: 3, startTick: sim.tick - fenetre / 2, endTick: sim.tick + fenetre / 2,
    }
    expect(meteoIntensityAt(sim.meteo, sim.tick, sim.map.width, sim.map.height, 32, 32)).toBeGreaterThan(0.9)
    expect(meteoFeuConso(sim, 32, 32)).toBeCloseTo(METEO.FEU_CONSO.vent_de_cendre, 5)
    expect(meteoMouille(sim, 32, 32)).toBe(false) // sec : la pose d'un feu neuf reste libre
    // Le témoin : l'orage SEC de l'Ardeur passe par la même porte élargie et doit rester à 1.
    const ete = mondeAuJour(45, { meteo: true })
    ete.meteo = {
      type: 'orage', cycle: Math.floor(ete.tick / TICKS_PER_CYCLE), day: jourDeSaison(ete),
      edge: 0, startTick: ete.tick - fenetre / 2, endTick: ete.tick + fenetre / 2,
    }
    expect(meteoIntensityAt(ete.meteo, ete.tick, ete.map.width, ete.map.height, 32, 32)).toBeGreaterThan(0.9)
    expect(meteoFeuConso(ete, 32, 32)).toBe(1)
  })
})

describe('S18 — les Orages secs assèchent TOUTE leur saison, pluie comprise', () => {
  it('sous le caractère, aucun front ne mouille ; hors du caractère, la pluie mouille toujours', () => {
    // Le caractère se CHERCHE en balayant l'élection (patron `eau-rendu`) : jamais un jour
    // écrit en dur. « `MOUILLE` faux partout — aucun front mouillé de la saison » (S18) :
    // avant le correctif, seule l'aridité lisait `jamaisMouille` — il pleuvait sur les feux
    // (conso ×1,5, pose refusée) pendant que la terre ne recevait rien.
    let jourSec = -1
    for (let j = 1; j <= 30 * YEAR_DAYS && jourSec < 0; j++) {
      if (effetsDuJour(j).jamaisMouille === true) jourSec = j
    }
    expect(jourSec, 'aucun caractère « les Orages secs » en trente ans — prémisse morte').toBeGreaterThan(0)
    expect(frontMouille({ type: 'pluie', day: jourSec })).toBe(false)
    expect(frontMouille({ type: 'orage', day: jourSec })).toBe(false)
    // Le témoin : un jour SANS le caractère, la pluie mouille comme toujours.
    let jourHumide = -1
    for (let j = 1; j <= YEAR_DAYS && jourHumide < 0; j++) {
      if (effetsDuJour(j).jamaisMouille !== true) jourHumide = j
    }
    expect(jourHumide).toBeGreaterThan(0)
    expect(frontMouille({ type: 'pluie', day: jourHumide })).toBe(true)
  })
})

describe('S2 — le monde ouvre à l’ouverture des Pluies', () => {
  it('un monde né au jour 61 date son premier jour au 61, et sa saison est les Pluies', () => {
    const sim = createSim(3, {
      map: createEmptyMap(32, 32, TERRAIN_GRASS),
      calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE,
      jourDeDepart: BALANCE.JOUR_DE_DEPART,
      finDeSaison: null,
    })
    expect(jourDeSaison(sim)).toBe(61)
    expect(phaseForDay(jourDeSaison(sim))).toBe(3)
    const naissance = drainEvents(sim).filter((e) => e.type === 'season_day_started' || e.type === 'act_started')
    expect(naissance.some((e) => e.type === 'season_day_started' && e.day === 61)).toBe(true)
    expect(naissance.some((e) => e.type === 'act_started' && e.act === actForDay(61))).toBe(true)
  })

  it('la saison ne finit pas dix cycles après l’ouverture', () => {
    const sim = createSim(3, {
      map: createEmptyMap(32, 32, TERRAIN_GRASS),
      calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE,
      jourDeDepart: BALANCE.JOUR_DE_DEPART,
    })
    // `finDeSaison` par défaut : SEASON_DAYS jours À PARTIR de l'ouverture, pas le jour 60 absolu.
    expect(sim.finDeSaison).toBe(BALANCE.JOUR_DE_DEPART + BALANCE.SEASON_DAYS - 1)
  })
})
