import { describe, expect, it } from 'vitest'
import { BALANCE, TEMPERATURE } from './balance'
import { drainEvents, type SimEvent } from './events'
import { createSim, step, type SimState } from './sim'
import {
  actForDay,
  calendarScaleForSeasonCycles,
  cycleOffsetForStartHour,
  fractionDuJourAtTick,
  dayTicksAt,
  dayTicksPourJour,
  estCrepuscule,
  getGameTime,
  jourDeSaison,
  NIGHT_RAMP_TICKS,
  partDeNuit,
  phaseForDay,
  seasonDayAtTick,
  TICKS_PER_CYCLE,
  TICKS_PER_SEASON_DAY,
  YEAR_DAYS,
} from './time'

describe('temps (A1 — fonction pure du tick)', () => {
  /**
   * LE JOUR ET SA FRACTION NE PEUVENT PAS SE CONTREDIRE — ils sortent de la MÊME division.
   *
   * `jourFrac` existe pour ce qui doit couler (le ruban de la barre haute) plutôt que sauter.
   * Le piège serait qu'elle dérive du jour entier : à la bascule, le compteur avancerait d'un
   * cran pendant que la fraction serait encore à 0,999, et l'affichage reculerait d'un jour le
   * temps d'une image. On balaie donc la bascule tick par tick et on affirme que la position
   * CONTINUE — jour + fraction — est strictement croissante et sans marche.
   */
  it('la fraction du jour recolle exactement au compteur, à la bascule comme ailleurs', () => {
    const echelle = 32 // le calendrier verrouillé sur le cycle (S2)
    const parJour = TICKS_PER_SEASON_DAY / echelle
    // Un balayage CONTIGU de part et d'autre de chaque bascule — pas trois cas épars, sans
    // quoi l'écart mesuré serait celui entre deux jours éloignés et ne prouverait rien.
    for (const bascule of [parJour, 2 * parJour, 7 * parJour]) {
      let precedent = -Infinity
      for (let k = -3; k <= 3; k += 1) {
        const tick = bascule + k
        const jour = seasonDayAtTick(tick, echelle, 1)
        const frac = fractionDuJourAtTick(tick, echelle)
        expect(frac).toBeGreaterThanOrEqual(0)
        expect(frac).toBeLessThan(1)
        // La position continue avance toujours, et jamais d'un jour d'un coup.
        const position = jour + frac
        if (precedent > -Infinity) {
          expect(position, `au tick ${tick}`).toBeGreaterThan(precedent)
          expect(position - precedent, `au tick ${tick}`).toBeLessThan(0.001)
        }
        precedent = position
      }
    }
    // Le premier tick d'un jour porte une fraction NULLE : c'est ce qui fait que le ruban
    // touche le filet du jour au moment exact où le compteur change.
    expect(fractionDuJourAtTick(parJour, echelle)).toBe(0)
    expect(seasonDayAtTick(parJour, echelle, 1)).toBe(2)
  })

  it('début de partie : jour 1, acte I, à l’aube (horloge murale), de jour', () => {
    const sim = createSim(1)
    // Le cycle démarre à l'aube ; l'horloge murale la place à CYCLE_DAWN_HOUR.
    expect(getGameTime(sim)).toEqual({
      tick: 0,
      hourOfCycle: BALANCE.CYCLE_DAWN_HOUR,
      isNight: false,
      nuit: 1, // l'aube est le FOND du froid : la pente ne le rend qu'au fil de la matinée

      // La longueur du JOUR est saisonnière (S6) : au 1er de l'Éclosion l'année sort tout juste
      // de l'hiver, le jour n'occupe encore que 0,557 du cycle et il s'allongera jusqu'à
      // l'Ardeur. Épinglé en littéral — une garde relue à la courbe qu'elle teste ne garde rien.
      dayTicks: 30_096,
      seasonDay: 1,
      jourFrac: 0, // le jour vient de commencer — la part écoulée est nulle

      act: 1,
      tour: 1, // l'an 1 (saison-sans-fin T2)
      phase: 1, // l'Éclosion
    })
  })

  it('le cycle bascule en nuit à la longueur du jour, puis reboucle à l’aube', () => {
    // Posé à l'ÉQUINOXE (mi-Éclosion, jour 15), où le jour occupe 0,625 du cycle : la valeur
    // d'avant que la longueur du jour devienne saisonnière (S6), donc la nuit y tombe encore à
    // 21 h murales (aube 6 h + 15 h de jour). Le calendrier est verrouillé sur le cycle
    // (un jour = un cycle), si bien que le jour 15 s'ouvre pile sur une aube.
    const sim = createSim(1, { calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE })
    const aube = 14 * TICKS_PER_CYCLE
    sim.tick = aube
    expect(jourDeSaison(sim)).toBe(15)
    const jour = dayTicksAt(sim, aube)
    expect(jour).toBe(33_750) // 0,625 × 54 000

    sim.tick = aube + jour - 1
    expect(getGameTime(sim).isNight).toBe(false)
    sim.tick = aube + jour
    expect(getGameTime(sim).isNight).toBe(true)
    expect(getGameTime(sim).hourOfCycle).toBe(21)
    sim.tick = aube + TICKS_PER_CYCLE
    expect(getGameTime(sim).isNight).toBe(false)
    expect(getGameTime(sim).hourOfCycle).toBe(BALANCE.CYCLE_DAWN_HOUR)

    // Et la longueur du jour SUIT la saison : entre le cœur de l'Ardeur et celui du Grand
    // Froid, le crépuscule recule de près de six heures murales. C'est le mécanisme de S6 —
    // la nuit est la fenêtre de danger, elle s'allonge quand le froid mord.
    expect(dayTicksPourJour(45)).toBe(38_880) // 0,72 du cycle : 12,6 min de nuit réelle
    expect(dayTicksPourJour(105)).toBe(25_920) // 0,48 : 23,4 min de nuit réelle
  })

  it('cycleOffsetForStartHour : démarrer à minuit met le cycle en nuit, calendrier intact', () => {
    const sim = createSim(1, { cycleOffset: cycleOffsetForStartHour(0) })
    const t = getGameTime(sim)
    expect(t.hourOfCycle).toBe(0)
    expect(t.isNight).toBe(true)
    expect(t.seasonDay).toBe(1) // le décalage ne touche QUE le cycle, pas le calendrier
    // createSim émet night_started (pas day_started) quand on démarre de nuit.
    const types = drainEvents(sim).map((e) => e.type)
    expect(types).toContain('night_started')
    expect(types).not.toContain('day_started')
  })

  it('cycleOffsetForStartHour(6) = 0 : l’aube est le départ par défaut', () => {
    expect(cycleOffsetForStartHour(BALANCE.CYCLE_DAWN_HOUR)).toBe(0)
    expect(createSim(1).cycleOffset).toBe(0)
    expect(getGameTime(createSim(1)).hourOfCycle).toBe(BALANCE.CYCLE_DAWN_HOUR)
  })

  it('minuit (0h murale) tombe en pleine nuit, à toute saison', () => {
    const sim = createSim(1)
    // Minuit = 18h après l'aube de 6h → phase 0.75 du cycle, bien dans la nuit.
    sim.tick = Math.round(TICKS_PER_CYCLE * 0.75)
    expect(getGameTime(sim).hourOfCycle).toBe(0)
    expect(getGameTime(sim).isNight).toBe(true)
    // Et ça tient les 120 jours de l'année, pas seulement au jour du montage : même la plus
    // longue journée (cœur de l'Ardeur) s'arrête à 0,72 du cycle, loin avant minuit.
    const minuit = Math.round(TICKS_PER_CYCLE * 0.75)
    for (let j = 1; j <= YEAR_DAYS; j++) {
      expect(dayTicksPourJour(j), `le jour ${j} déborde sur minuit`).toBeLessThan(minuit)
    }
  })

  it('le jour de saison avance avec le calendrier, modulé par calendarScale', () => {
    expect(seasonDayAtTick(TICKS_PER_SEASON_DAY - 1, 1, 1)).toBe(1)
    expect(seasonDayAtTick(TICKS_PER_SEASON_DAY, 1, 1)).toBe(2)
    // À l'échelle 720, un jour de saison passe 720 fois plus vite.
    expect(seasonDayAtTick(TICKS_PER_SEASON_DAY / 720, 720, 1)).toBe(2)
    // LE JOUR DE DÉPART décale le calendrier tout entier (S2 : le vrai jeu ouvre au 51ᵉ, à la
    // fin de l'Ardeur ; les montages de test ouvrent au 1er). Il est REQUIS, et c'est ce qui a
    // empêché les appels d'avant de recevoir le jour 1 en silence.
    expect(seasonDayAtTick(0, 1, BALANCE.JOUR_DE_DEPART)).toBe(51)
    expect(seasonDayAtTick(TICKS_PER_SEASON_DAY, 1, BALANCE.JOUR_DE_DEPART)).toBe(52)
  })

  it('les saisons changent aux jours 31, 61, 91 et 121 (quatre saisons de trente jours, S1)', () => {
    // Les bornes sont épinglées en LITTÉRAUX, pas à `ACT_DAYS` : une garde écrite avec la
    // constante qu'elle teste ne garde rien.
    expect(actForDay(30)).toBe(1) // l'Éclosion
    expect(actForDay(31)).toBe(2) // l'Ardeur
    expect(actForDay(60)).toBe(2)
    expect(actForDay(61)).toBe(3) // les Pluies
    expect(actForDay(90)).toBe(3)
    expect(actForDay(91)).toBe(4) // le Grand Froid
    expect(actForDay(120)).toBe(4)
    expect(actForDay(121)).toBe(5) // l'an 2 commence — et c'est une Éclosion
    expect(phaseForDay(121)).toBe(1)
    // Le monde ouvre à la fin de l'Ardeur (S2) et la saison de wipe multi s'achève en plein
    // Grand Froid : c'est le pacing que le jour 51 a été choisi pour tenir.
    expect(actForDay(BALANCE.JOUR_DE_DEPART)).toBe(2)
    expect(actForDay(BALANCE.JOUR_DE_DEPART + BALANCE.SEASON_DAYS - 1)).toBe(4)
  })
})

describe('temps (A2 — une année accélérée headless)', () => {
  // Le timeout par défaut de vitest (5 s) EST l'assertion de performance :
  // la spec exige < 60 s, on tourne en fait en bien moins.
  it('120 jours à l’échelle 1440 émettent 120 débuts de jour et les quatre saisons, dans l’ordre', () => {
    // L'unité balayée est l'ANNÉE et non plus la saison : depuis S1 l'arc ne monte plus, il
    // TOURNE — les quatre saisons ne se voient qu'en jouant les 120 jours. L'échelle passe donc
    // de 720 à 1440 pour tenir dans le même nombre de ticks (le banc mesure le flux
    // d'événements, pas la cadence).
    const scale = 1440
    const sim = createSim(9, { calendarScale: scale })
    const days: number[] = []
    const acts: number[] = []
    const collect = (events: SimEvent[]) => {
      for (const e of events) {
        if (e.type === 'season_day_started') days.push(e.day)
        if (e.type === 'act_started') acts.push(e.act)
      }
    }
    collect(drainEvents(sim))

    // Jusqu'au dernier tick du jour 120 (le tick suivant entamerait l'Éclosion de l'an 2).
    const ticksForYear = (YEAR_DAYS * TICKS_PER_SEASON_DAY) / scale - 1
    for (let t = 0; t < ticksForYear; t++) {
      step(sim, [])
      collect(drainEvents(sim))
    }

    expect(days).toEqual(Array.from({ length: YEAR_DAYS }, (_, i) => i + 1))
    expect(acts).toEqual([1, 2, 3, 4]) // l'Éclosion · l'Ardeur · les Pluies · le Grand Froid
    expect(getGameTime(sim).seasonDay).toBe(YEAR_DAYS)
  })
})

describe('couplage cycle↔calendrier (V0-9 — l’endgame observable en solo)', () => {
  // Le tick où finit la saison : `seasonDayAtTick` bascule à `jourDeDepart + SEASON_DAYS`.
  const finDeSaison = (scale: number): number => (BALANCE.SEASON_DAYS * TICKS_PER_SEASON_DAY) / scale

  /** Un monde ouvert AU JOUR DU VRAI JEU (S2 : le 51ᵉ, fin de l'Ardeur), à l'heure murale
   *  voulue. C'est ce jour de départ qui place le Grand Froid dans le dernier tiers de la
   *  saison — au jour 1, une saison de 60 jours ne l'atteindrait jamais. */
  const monde = (scale: number, heure: number): SimState =>
    createSim(1, {
      calendarScale: scale,
      cycleOffset: cycleOffsetForStartHour(heure),
      jourDeDepart: BALANCE.JOUR_DE_DEPART,
    })

  /**
   * LES NUITS DE LA SAISON, et celles du GRAND FROID parmi elles — la mesure de l'endgame.
   * Toute la pression de fin de saison se joue LA NUIT (les hordes qui grossissent, la chasse
   * nocturne, le froid qui tue) : si aucune nuit d'hiver ne tient dans la saison, la montée est
   * inobservable en solo.
   *
   * Les DEUX comptes sont rendus, et c'est délibéré : le total pin la GÉOMÉTRIE (combien de
   * cycles la saison porte), le sous-compte pin l'endgame. Ne garder que le second laisserait
   * passer un helper qui trouve un crépuscule de travers.
   *
   * Le crépuscule est MOBILE depuis S6 — il recule de près de six heures entre l'Ardeur et le
   * Grand Froid — donc on ne le recalcule pas : on le demande au monde, et on vérifie au
   * passage que `estCrepuscule` (l'écrivain unique de l'égalité, celui que quatre systèmes
   * lisent) tombe bien sur le tick trouvé.
   */
  const nuitsDeLaSaison = (sim: SimState, fin: number): { toutes: number[]; grandFroid: number[] } => {
    const toutes: number[] = []
    const grandFroid: number[] = []
    for (let k = 0; k * TICKS_PER_CYCLE <= fin + TICKS_PER_CYCLE; k++) {
      const aube = k * TICKS_PER_CYCLE - sim.cycleOffset
      const t = aube + dayTicksAt(sim, aube)
      if (t < 0 || t >= fin) continue
      expect(estCrepuscule(sim, t), `le tick ${t} n'est pas un crépuscule`).toBe(true)
      toutes.push(t)
      if (phaseForDay(jourDeSaison(sim, t)) === 4) grandFroid.push(t)
    }
    return { toutes, grandFroid }
  }

  it('l’échelle DÉRIVÉE fait tomber les nuits du Grand Froid DANS la saison — quelle que soit l’heure de départ', () => {
    // Un éventail de cadences jouables, dont CELLE QUI SORT (`VEILLEE_SEASON_CYCLES` =
    // SEASON_DAYS : un jour de saison par cycle, le couplage à 1 pour 1).
    for (const cycles of [4, 6, 8, 12, BALANCE.SEASON_DAYS]) {
      const scale = calendarScaleForSeasonCycles(cycles)
      // La saison dure EXACTEMENT `cycles` cycles (contrat du couplage), donc elle porte
      // `cycles` crépuscules — plus, éventuellement, celui du cycle DÉJÀ ENTAMÉ à l'ouverture
      // (une partie ne commence pas forcément à une aube). C'est la géométrie que le couplage
      // achète, et c'est elle que l'échelle codée en dur perd.
      expect(finDeSaison(scale)).toBeCloseTo(cycles * TICKS_PER_CYCLE, 3)
      // Pour toute heure de départ, une nuit du Grand Froid précède la fin de saison.
      for (const heure of [0, 6, 9, 15, 21]) {
        const nuits = nuitsDeLaSaison(monde(scale, heure), finDeSaison(scale))
        expect([cycles, cycles + 1], `${cycles} cycles, départ à ${heure} h`).toContain(nuits.toutes.length)
        expect(nuits.grandFroid.length, `${cycles} cycles, départ à ${heure} h`).toBeGreaterThan(0)
        // Et à la cadence qui SORT, l'endgame est une saison, pas un soir : vingt nuits
        // d'hiver au moins, contre UNE à l'échelle codée en dur (test suivant).
        if (cycles === BALANCE.SEASON_DAYS) expect(nuits.grandFroid.length).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it('RÉGRESSION : une échelle codée en dur (720) réduit tout l’endgame à UNE nuit', () => {
    // Le défaut que le couplage règle : à 720, les 60 jours de saison tiennent en 2,7 cycles.
    // La saison ENTIÈRE ne compte alors que deux ou trois nuits, et la fenêtre du Grand Froid —
    // le dernier tiers, puisque le monde ouvre au 51ᵉ — est plus étroite que l'intervalle entre
    // deux crépuscules. Quelle que soit l'heure de départ, l'hiver se joue en UNE nuit : ce
    // n'est plus une saison qui monte, c'est un soir. C'est l'inverse de la promesse du
    // couplage (test ci-dessus : la même fenêtre en porte vingt).
    //
    // La version d'avant affirmait qu'il existait des heures de départ SANS aucune nuit
    // d'endgame. Mesuré sous le calendrier du 2026-08-23, ce n'est plus vrai : le crépuscule
    // recule en hiver (S6), donc les nuits se resserrent juste assez pour qu'il en tombe
    // toujours une. Le défaut n'a pas bougé — il se dit maintenant en COMPTE, et pour TOUTE
    // heure de départ au lieu de quelques-unes.
    const debutDuGrandFroid = (91 - BALANCE.JOUR_DE_DEPART) * (TICKS_PER_SEASON_DAY / 720)
    expect(finDeSaison(720) - debutDuGrandFroid).toBeLessThan(TICKS_PER_CYCLE) // moins d'un cycle

    // Balayé au quart d'heure sur les 24 h de départ possibles. On pin les DEUX comptes : la
    // saison entière ne porte que deux ou trois nuits (la géométrie du découplage), dont
    // exactement UNE d'hiver (l'endgame). Le second seul laisserait passer un helper qui
    // trouve un crépuscule de travers.
    const saison = new Set<number>()
    const hiver = new Set<number>()
    for (let h = 0; h < 24; h += 0.25) {
      const nuits = nuitsDeLaSaison(monde(720, h), finDeSaison(720))
      saison.add(nuits.toutes.length)
      hiver.add(nuits.grandFroid.length)
    }
    expect([...saison].sort((a, b) => a - b)).toEqual([2, 3])
    expect([...hiver]).toEqual([1])
  })
})

describe('un JOUR est un CYCLE, et il dure 45 minutes (décision 2026-08-23)', () => {
  it('le cycle jour/nuit dure 45 minutes réelles', () => {
    // Le NOMBRE, pas sa dérivation : `TICKS_PER_CYCLE / (Hz × 60)` recalculé depuis
    // `CYCLE_REAL_MINUTES` ne garderait rien (il vaudrait toujours `CYCLE_REAL_MINUTES`).
    // 45 est la décision — c'est elle qu'on affirme, et c'est elle que casserait un retour
    // à 48. La durée du jour AFFICHÉ suit, puisque le jour est le cycle (test suivant).
    expect(TICKS_PER_CYCLE / (BALANCE.TICK_RATE_HZ * 60)).toBe(45)
  })

  it('le calendrier est VERROUILLÉ sur le cycle : le rapport est un entier, donc sans dérive', () => {
    // 1 728 000 / 54 000 = 32. C'est ce qui rend le couplage « un jour = un cycle » STABLE :
    // le basculement du jour retombe sur la MÊME phase du cycle, indéfiniment. Une durée de
    // cycle qui ne diviserait pas la journée de 24 h (46 min, p. ex.) le ferait glisser d'un
    // cycle à l'autre, et le compteur du HUD redeviendrait faux — lentement.
    expect(TICKS_PER_SEASON_DAY % TICKS_PER_CYCLE).toBe(0)
  })

  it('à l’échelle « un jour par cycle », le jour bascule UNE fois par cycle, toujours à la même heure', () => {
    // Le défaut corrigé (Veillée, échelle 300) : DIX jours de saison par cycle jour/nuit —
    // le HUD montrait « JOUR 3 · 09H » puis « JOUR 4 · 11H ». On balaie ici une saison
    // ENTIÈRE, tick par tick, et on exige deux choses : le bon NOMBRE de basculements, et
    // toujours la même PHASE du cycle (pas de dérive).
    const scale = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)
    expect(scale).toBe(32) // le rapport épinglé du test précédent, en littéral

    const cycles = 8 // huit cycles suffisent à voir une dérive : elle serait déjà de 8 × le pas
    const phases = new Set<number>()
    let bascules = 0
    for (let tick = 1; tick <= cycles * TICKS_PER_CYCLE; tick++) {
      if (seasonDayAtTick(tick, scale, 1) !== seasonDayAtTick(tick - 1, scale, 1)) {
        bascules++
        phases.add(tick % TICKS_PER_CYCLE)
      }
    }
    expect(bascules).toBe(cycles) // un jour par cycle, ni dix ni zéro
    // ET TOUJOURS AU MÊME POINT DU CYCLE — c'est ça, l'absence de dérive. Le point lui-même
    // est le tick 0 du calendrier ; dans une partie, l'heure murale qu'il vise est celle de la
    // NAISSANCE du monde (`cycleOffset`), 9 h en Veillée. Un seul élément dans l'ensemble : la
    // bascule ne glisse pas d'un cycle à l'autre.
    expect([...phases]).toEqual([0])
  })

  it('RÉGRESSION : l’échelle de la Veillée d’avant (6 cycles pour la saison) faisait bondir le compteur', () => {
    // La preuve du défaut, en ses termes : dix jours de saison dans un seul cycle.
    const ancienne = calendarScaleForSeasonCycles(6)
    const jourA = seasonDayAtTick(0, ancienne, 1)
    const jourB = seasonDayAtTick(TICKS_PER_CYCLE, ancienne, 1)
    expect(jourB - jourA).toBe(10)
  })
})

describe('la nuit tombe en PENTE (`partDeNuit`, décision 2026-08-23)', () => {
  /**
   * Le pas maximal admis, SANS DIMENSION. La rampe est linéaire sur `NIGHT_RAMP_TICKS`, donc la
   * part de nuit ne peut bouger de plus d'un tick de rampe — et on garde la PART plutôt que les
   * degrés parce que l'écart jour/nuit est saisonnier depuis S5 (6 °C au cœur de l'Ardeur,
   * 14 au cœur du Grand Froid) : comparer un saut d'hiver à un pas d'été ne garderait rien.
   */
  const MARCHE_MAX = 1 / NIGHT_RAMP_TICKS

  it('GARDE EXHAUSTIVE — aucun saut de froid sur tout le cycle, tick par tick, TOUTE L’ANNÉE', () => {
    // Le défaut réparé : `isNight` était un booléen, donc l'écart jour/nuit tombait d'un bloc en
    // UN tick au crépuscule et remontait d'un bloc à l'aube. Le balayage porte sur le cycle
    // ENTIER de CHACUN des 120 jours de l'année — depuis S6 la longueur du jour est saisonnière,
    // donc chaque jour a sa géométrie de rampe, et un seul jour choisi ne garderait qu'elle. Une
    // seule propriété affirmée : la part de nuit ne bouge jamais de plus d'un pas de rampe.
    let pire = 0
    let ou = ''
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      const dayTicks = dayTicksPourJour(jour)
      // La couture du cycle est un tick comme un autre : on part du dernier tick de la nuit.
      let precedent = partDeNuit(TICKS_PER_CYCLE - 1, dayTicks)
      for (let t = 0; t < TICKS_PER_CYCLE; t++) {
        const v = partDeNuit(t, dayTicks)
        const saut = v > precedent ? v - precedent : precedent - v
        if (saut > pire) {
          pire = saut
          ou = `jour ${jour}, cycleTick ${t}`
        }
        precedent = v
      }
    }
    expect(pire, `plus grand saut : ${ou}`).toBeLessThanOrEqual(MARCHE_MAX + 1e-9)
    // Et ce que ça vaut EN DEGRÉS sur la nuit la plus dure de l'année (cœur du Grand Froid,
    // 14 °C d'écart) : moins d'un centième de degré par tick, contre douze d'un coup avant.
    expect(pire * TEMPERATURE.ECART_NUIT(105)).toBeLessThan(0.01)
  })

  it('LA NUIT EST BIT-EXACTE : `isNight` ⟹ part de nuit PLEINE, sur toute la nuit et toute l’année', () => {
    // Ce que cette garde PIN : les deux pentes vivent du côté du JOUR. Les faire déborder sur
    // la nuit renverrait des loups dans les nuits du Grand Froid (`nighthunt` tire contre
    // l'éveil, « le vivant a quitté la vallée » est une promesse testée à zéro) et rétrécirait
    // toutes les hordes (`planifierHorde` lit l'éveil AU TICK DU CRÉPUSCULE). Voir `partDeNuit`.
    const fautes: string[] = []
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      const dayTicks = dayTicksPourJour(jour)
      for (let t = dayTicks; t < TICKS_PER_CYCLE; t++) {
        if (partDeNuit(t, dayTicks) !== 1) fautes.push(`jour ${jour}, cycleTick ${t}`)
      }
    }
    expect(fautes.length, fautes.slice(0, 3).join(' · ')).toBe(0)
  })

  it('le plein jour ne porte aucun froid de nuit, et les lisières sont des pentes bornées', () => {
    // Aux trois géométries extrêmes de l'année : le jour le plus long (cœur de l'Ardeur), le
    // plus court (cœur du Grand Froid) et l'équinoxe entre les deux.
    for (const jour of [45, 15, 105]) {
      const dayTicks = dayTicksPourJour(jour)
      // Entre les deux rampes : zéro, franc — balayé tick par tick, pas par échantillons.
      let nonNuls = 0
      for (let t = NIGHT_RAMP_TICKS; t <= dayTicks - NIGHT_RAMP_TICKS; t++) {
        if (partDeNuit(t, dayTicks) !== 0) nonNuls++
      }
      expect(nonNuls, `jour ${jour} : ${nonNuls} ticks de plein jour portent du froid de nuit`).toBe(0)

      expect(partDeNuit(0, dayTicks)).toBe(1) // l'aube : le fond du froid
      expect(partDeNuit(NIGHT_RAMP_TICKS / 2, dayTicks)).toBeCloseTo(0.5, 9)
      expect(partDeNuit(dayTicks - NIGHT_RAMP_TICKS / 2, dayTicks)).toBeCloseTo(0.5, 9)

      // Et la part reste dans [0, 1] sur TOUT le cycle, sans exception.
      let hors = 0
      for (let t = 0; t < TICKS_PER_CYCLE; t++) {
        const v = partDeNuit(t, dayTicks)
        if (!(v >= 0 && v <= 1)) hors++
      }
      expect(hors, `jour ${jour} : ${hors} ticks hors [0, 1]`).toBe(0)
    }
  })
})
