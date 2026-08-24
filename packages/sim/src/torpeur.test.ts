/**
 * LE CADRAN UNIQUE DU CENDREUX — la torpeur par la température (décisions d'Alexis
 * 2026-08-21, spec `docs/superpowers/specs/2026-08-21-cendreux-pression-croissante-design.md` ;
 * ré-ancré sur l'année qui tourne le 2026-08-23, `docs/specs/saisons.md` S4-S6 et S15).
 *
 * Ce que ce fichier épingle : l'éveil est une PENTE du froid — amorphe au cœur de l'Ardeur,
 * plein régime au cœur du Grand Froid, et toute la pente traversée entre les deux —, la
 * géographie parle (la neige veille quand la plaine dort), l'allure d'un but ne tombe jamais
 * à zéro (pas de statue), et la rampe de saison RESPIRE avec l'année au lieu de saturer une
 * fois pour toutes au premier été.
 */
import { describe, it, expect } from 'vitest'
import { BALANCE, CENDREUX, MONSTER_DEFS, NIGHT_HUNT, TERRAIN_GRASS } from './balance'
import { createSim, type SimState } from './sim'
import { createEmptyMap } from './map'
import { spawnMonster, advanceMonsters } from './monsters'
import { baselineTemperatureAt, eveilCendreuxAt } from './temperature'
import { cycleOffsetForStartHour, seasonRamp, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, YEAR_DAYS } from './time'

/**
 * LE CŒUR D'UNE SAISON, en jour de l'année — dérivé d'`ACT_DAYS`, jamais écrit : 15, 45, 75,
 * 105. C'est là que la courbe du socle pose ses CARDINAUX (S4), donc là — et là seulement —
 * que le cadran et la rampe valent leurs bornes EXACTEMENT. Ancrer ailleurs, c'est ancrer sur
 * une interpolation qu'un calibrage déplacera.
 */
const coeurDeSaison = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2
const ECLOSION = coeurDeSaison(1)
const ARDEUR = coeurDeSaison(2)
const PLUIES = coeurDeSaison(3)
const GRAND_FROID = coeurDeSaison(4)

/** Un état posé au jour de saison voulu, à l'heure voulue, sur plaine nue (patron du banc
 *  `nuits`). Le jour de départ des montages de test est 1 — le décalage du vrai jeu
 *  (`JOUR_DE_DEPART`) est une affaire d'hôte, pas de cadran. */
function jourAHeure(jour: number, heure: number, seed = 1): SimState {
  const state = createSim(seed, {
    map: createEmptyMap(64, 64, TERRAIN_GRASS),
    cycleOffset: cycleOffsetForStartHour(heure),
    calendarScale: 1,
  })
  state.tick = (jour - 1) * TICKS_PER_SEASON_DAY
  state.tick -= state.tick % TICKS_PER_CYCLE
  return state
}
/** À MINUIT — le fond de la nuit, là où les cardinaux nocturnes de S4/S5 se lisent. */
function nuitDuJour(jour: number, seed = 1): SimState {
  return jourAHeure(jour, 0, seed)
}
/** À MIDI — le haut du jour ; l'aube, elle, porte encore tout le froid nocturne (`partDeNuit`). */
function midiDuJour(jour: number): SimState {
  return jourAHeure(jour, 12)
}
/** L'éveil de la plaine nue, au fond de la nuit de ce jour-là. */
function eveilNocturne(jour: number): number {
  const s = nuitDuJour(jour)
  return eveilCendreuxAt(s, 32, 32, s.tick)
}

describe('l\'éveil — la pente de température', () => {
  it('les deux bouts du cadran sont les CARDINAUX de la courbe : 0 au cœur de l\'Ardeur, 1 au cœur du Grand Froid', () => {
    // C'est le contrat central du cadran, et il ne se lit plus sur une table d'actes mais sur
    // la courbe de l'année (S4/S5) : CHAUD=+6 °C / FROID=−14 encadrent la nuit de plaine des
    // deux saisons extrêmes — +20 °C au cœur de l'été, −16 au cœur de l'hiver. L'éveil y vaut
    // donc 0 et 1 EXACTEMENT, et la pente est ce qui se passe entre les deux.
    expect(eveilNocturne(ARDEUR)).toBe(0)
    expect(eveilNocturne(GRAND_FROID)).toBe(1)
    // La mi-pente est TRAVERSÉE, jamais enjambée — et elle tombe entre le cœur des Pluies et
    // celui du Grand Froid : l'automne finissant est le moment où les morts se réveillent.
    let mi = -1
    for (let jour = ARDEUR; jour <= GRAND_FROID && mi < 0; jour++) {
      if (eveilNocturne(jour) >= 0.5) mi = jour
    }
    expect(mi).toBeGreaterThan(PLUIES)
    expect(mi).toBeLessThan(GRAND_FROID)
    // Et une fois franchie, elle ne repasse plus dessous : la pente monte, elle n'oscille pas
    // autour de la moitié (ce que ferait un cadran keyé sur l'heure plutôt que sur la saison).
    for (let jour = mi; jour <= GRAND_FROID; jour++) expect(eveilNocturne(jour)).toBeGreaterThanOrEqual(0.5)
  })

  it('l\'éveil de minuit RESPIRE avec l\'année : il retombe vers l\'Ardeur, il remonte vers le Grand Froid', () => {
    // L'ancienne garde disait « il ne descend jamais » — vrai d'un arc à sens unique, faux
    // d'une année qui boucle (S15) : la menace respire, elle ne sature plus au premier été.
    // Garde exhaustive plutôt que cas choisis : on balaie l'année entière, du tour 1.
    const borne = (e: number) => {
      expect(e).toBeGreaterThanOrEqual(0)
      expect(e).toBeLessThanOrEqual(1)
    }
    let prev = eveilNocturne(1)
    borne(prev)
    for (let jour = 2; jour <= ARDEUR; jour++) {
      const e = eveilNocturne(jour)
      borne(e)
      expect(e).toBeLessThanOrEqual(prev) // l'Éclosion dégèle : la vallée se rendort
      prev = e
    }
    for (let jour = ARDEUR + 1; jour <= GRAND_FROID; jour++) {
      const e = eveilNocturne(jour)
      borne(e)
      expect(e).toBeGreaterThanOrEqual(prev) // les Pluies puis l'hiver : elle se relève
      prev = e
    }
    for (let jour = GRAND_FROID + 1; jour <= YEAR_DAYS; jour++) {
      const e = eveilNocturne(jour)
      borne(e)
      expect(e).toBeLessThanOrEqual(prev) // et l'hiver finissant redescend vers l'Éclosion
      prev = e
    }
  })

  it('la géographie parle : quand la plaine dort, la neige veille (le Névé)', () => {
    // Mi-Éclosion, en plein jour : la plaine est à +8 °C, au-dessus de TORPEUR.CHAUD — elle
    // dort. La neige (BIOME_OFFSET −16 °C) est à −8 sur la MÊME carte, au MÊME tick : le Névé
    // reste dangereux quand le reste de la vallée ne l'est plus. C'est midi et non le tick 0 :
    // l'aube porte encore le plein froid nocturne (`partDeNuit`), la plaine n'y dort pas.
    const state = midiDuJour(ECLOSION)
    state.map.terrain[32 * 64 + 40] = 10 // neige
    expect(eveilCendreuxAt(state, 32.5, 32.5, state.tick)).toBe(0) // l'herbe dort
    expect(eveilCendreuxAt(state, 40.5, 32.5, state.tick)).toBeGreaterThan(0) // la neige veille
  })

  it('de nuit tiède, un cendreux avec un BUT avance quand même — lentement, jamais statue', () => {
    // GAIT_MIN : « presque amorphe » n'est pas « immobile en marche ».
    //
    // LA NUIT TIÈDE SE CHERCHE, ELLE NE SE CHOISIT PAS. Au cœur de l'Ardeur la plaine est à
    // +20 °C : le cendreux ne cherche même plus la chaleur (`CONVERGE_SOUS` = 8) — sans but,
    // il ne bouge pas du tout, et « jamais statue » ne veut plus rien dire là. La garde vise
    // donc la nuit la plus tiède où il ait ENCORE un but : la première, après l'Ardeur, où la
    // plaine repasse sous `CONVERGE_SOUS`. L'éveil y vaut toujours 0 — c'est bien un amorphe.
    const marche = (jour: number): number => {
      const state = nuitDuJour(jour)
      state.structures.push({ type: 'fire', tx: 45, ty: 32, villageId: 0 } as never)
      const id = spawnMonster(state, 'cendreux', 30.5, 32.5)
      const ent = state.entities.find((e) => e.id === id)!
      const x0 = ent.x
      for (let t = 0; t < 200; t++) advanceMonsters(state)
      return ent.x - x0
    }
    expect(marche(ARDEUR)).toBe(0) // sans but, l'été le fige : c'est là que vit l'amorphe
    let tiedeAvecBut = -1
    for (let jour = ARDEUR; jour <= GRAND_FROID && tiedeAvecBut < 0; jour++) {
      const s = nuitDuJour(jour)
      if (baselineTemperatureAt(s, 32, 32, s.tick) < CENDREUX.TORPEUR.CONVERGE_SOUS) tiedeAvecBut = jour
    }
    expect(eveilNocturne(tiedeAvecBut)).toBe(0) // tiède au point d'être amorphe…
    const tiede = marche(tiedeAvecBut)
    const froide = marche(GRAND_FROID)
    expect(tiede).toBeGreaterThan(0) // …et il marche quand même (constat du panel)
    expect(froide).toBeGreaterThan(tiede) // le froid presse le pas
    // Et le froid ne le rend jamais PLUS RAPIDE que sa vitesse nominale (R10) :
    expect(froide).toBeLessThanOrEqual(MONSTER_DEFS.cendreux.speed * (200 / BALANCE.TICK_RATE_HZ) + 0.001)
  })
})

describe('la rampe de saison (seasonRamp) — elle RESPIRE (S15)', () => {
  it('au plancher au cœur de l\'Ardeur, au plafond au cœur du Grand Froid, jamais hors des deux', () => {
    expect(seasonRamp(0, 10, ARDEUR)).toBe(0)
    expect(seasonRamp(0, 10, GRAND_FROID)).toBe(10)
    expect(seasonRamp(2, 6, GRAND_FROID)).toBe(6)
    // Les deux saisons de TRANSITION sont entre les deux — l'année a une forme, pas des marches.
    for (const entredeux of [ECLOSION, PLUIES]) {
      expect(seasonRamp(0, 10, entredeux)).toBeGreaterThan(0)
      expect(seasonRamp(0, 10, entredeux)).toBeLessThan(10)
    }
    // Balayage de l'année entière : elle ne sort JAMAIS de ses deux bornes (ex-clamp au jour 60).
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      expect(seasonRamp(0, 10, jour)).toBeGreaterThanOrEqual(0)
      expect(seasonRamp(0, 10, jour)).toBeLessThanOrEqual(10)
    }
  })

  it('et le PLANCHER monte d\'un tour à l\'autre : l\'été de l\'an 3 est plus dur que celui de l\'an 1', () => {
    // C'est tout le sens de S15 : la rampe redescend chaque été, mais jamais aussi bas
    // qu'avant. Sans ce socle, une année qui boucle rendrait l'an 10 identique à l'an 1.
    const eteDeLAn = (tour: number): number => seasonRamp(0, 10, ARDEUR + (tour - 1) * YEAR_DAYS)
    expect(eteDeLAn(2)).toBeGreaterThan(eteDeLAn(1))
    expect(eteDeLAn(3)).toBeGreaterThan(eteDeLAn(2))
    // …mais un été reste un été : il ne rejoint jamais l'hiver de son propre tour.
    expect(eteDeLAn(3)).toBeLessThan(seasonRamp(0, 10, GRAND_FROID + 2 * YEAR_DAYS))
  })

  it('le plafond des rôdeurs morts MONTE avec le froid : 1 au cœur de l\'Ardeur, UNDEAD_MAX_FIN au cœur du Grand Froid', () => {
    const plafondDuJour = (jour: number): number =>
      Math.round(seasonRamp(1, NIGHT_HUNT.UNDEAD_MAX_FIN, jour))
    expect(plafondDuJour(ARDEUR)).toBe(1)
    expect(plafondDuJour(GRAND_FROID)).toBe(NIGHT_HUNT.UNDEAD_MAX_FIN)
    let prev = 0
    for (let jour = ARDEUR; jour <= GRAND_FROID; jour++) {
      const p = plafondDuJour(jour)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
    // Une table de trois valeurs est plate ; une rampe visite TOUS les crans intermédiaires.
    const crans = new Set<number>()
    for (let jour = ARDEUR; jour <= GRAND_FROID; jour++) crans.add(plafondDuJour(jour))
    expect(crans.size).toBe(NIGHT_HUNT.UNDEAD_MAX_FIN)
  })
})

describe('la satiété atténue l\'éveil (fondation de « rassasié, il s\'affaisse »)', () => {
  it('un cendreux repu au cœur du froid retombe amorphe ; l\'affamé y veille à plein', () => {
    const state = nuitDuJour(GRAND_FROID) // plaine de nuit du cœur de l'hiver : éveil brut = 1
    const id = spawnMonster(state, 'cendreux', 30.5, 32.5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    const ent = state.entities.find((e) => e.id === id)!
    // Le champ n'existe pas encore à la naissance : l'éveil est le brut.
    expect(monster.satiete).toBeUndefined()
    // Repu (SATIETE_MAX) : il porte l'échelle entière de degrés — éveil 1 − 1 = 0.
    monster.satiete = CENDREUX.BOIRE.SATIETE_MAX
    const x0 = ent.x
    state.structures.push({ type: 'fire', tx: 45, ty: 32, villageId: 0 } as never)
    for (let t = 0; t < 100; t++) advanceMonsters(state)
    // Il a un but (le feu) : il avance au plancher, pas à plein — comparé à l'affamé.
    const repu = ent.x - x0
    const temoin = nuitDuJour(GRAND_FROID)
    temoin.structures.push({ type: 'fire', tx: 45, ty: 32, villageId: 0 } as never)
    const id2 = spawnMonster(temoin, 'cendreux', 30.5, 32.5)
    const ent2 = temoin.entities.find((e) => e.id === id2)!
    const x1 = ent2.x
    for (let t = 0; t < 100; t++) advanceMonsters(temoin)
    expect(ent2.x - x1).toBeGreaterThan(repu)
    expect(repu).toBeGreaterThan(0) // même repu : un but = jamais statue
  })
})
