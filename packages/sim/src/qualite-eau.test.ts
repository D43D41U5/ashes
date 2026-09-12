/**
 * ═══ LA QUALITÉ DE L'EAU (spec `qualite-eau.md`) — critères A1-A5, A8, A9 ═══
 *
 * A6 et A7 (l'appel au peuplement, la bête qui renonce) ne sont PAS ici : ils touchent la
 * faune, donc le flux du PRNG seedé, et la spec les veut dans un lot séparé — sinon un test
 * sans rapport qui rougit n'a plus de coupable désigné.
 *
 * A1 a DEUX moitiés, et seule la seconde vit ici : les huit gardes de `coulee.test.ts` passent
 * sans être modifiées (la première), et l'ensemble des tuiles souillées par la SUIE sur le vrai
 * monde joué est identique avant/après la refonte — MESURÉ le 2026-09-12 par
 * `tools/__souille-avant.mts`, 3 graines × 3 âges de foyer, diff vide ; le filet mord (porter
 * `FORCE_SUIE` sous le seuil vide les neuf relevés). Ici on garde la PRÉMISSE de ce relevé : la
 * suie porte la force pleine, donc son verdict ne peut pas se mettre à glisser en silence.
 */
import { describe, expect, it } from 'vitest'
import { carteDeTest } from '../../../tools/carte-cache'
import {
  BALANCE, HUNT, SANG, TERRAIN_DEEP_WATER, TERRAIN_GRASS, TERRAIN_MARSH, TERRAIN_REED_MARSH, TERRAIN_SHALLOW_WATER,
} from './balance'
import { calculeChampDeCendre } from './cendre'
import { attacheAuFil, COULEE, eauSouillee, qualiteDeLEau } from './coulee'
import { porteDeLEau } from './eau'
import { drainEvents } from './events'
import { estGele } from './gel'
import { createEmptyMap, setTile, type WorldMap } from './map'
import { MONDE, MONDE_JOUE } from './zonegraph'
import { deserializeSim, serializeSim } from './persistence'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { calendarScaleForSeasonCycles, dayTicksPourJour, TICKS_PER_CYCLE } from './time'
import { EAU } from './zonegen-water'

/* ─── LE BANC ─────────────────────────────────────────────────────────────────────── */

/** 1 jour de saison = 1 cycle : le tick porte la saison ET l'heure (patron de `gel.test.ts`). */
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)
const coeurDe = (phase: number): number => Math.round((phase - 0.5) * BALANCE.ACT_DAYS)
/**
 * LE JOUR DE RÉFÉRENCE EST LES PLUIES, et c'est MESURÉ — pas une convention.
 * Sur ce banc (`meteoActive: false`, donc aucune pluie ne tombe jamais), le niveau d'eau signé
 * vaut +0,53 à l'Éclosion, **−1,00 à l'Ardeur** (le gué est ASSÉCHÉ : `porteDeLEau` dit non, et
 * le sang ne souille rien — un montage à l'Ardeur aurait mesuré la sécheresse en croyant
 * mesurer le sang), 0,00 aux Pluies et au Grand Froid. Et au Grand Froid le gué est PRIS par la
 * glace. Il ne reste donc qu'une fenêtre pour une eau libre et en eau : les Pluies.
 */
const PLUIES = coeurDe(3)
const GRAND_FROID = coeurDe(4)
/** Le tick du milieu du JOUR d'un jour de saison — au cœur de la phase, jamais à sa frontière. */
function tickDe(jour: number): number {
  return (jour - 1) * TICKS_PER_CYCLE + Math.floor(dayTicksPourJour(jour) / 2)
}

const RIVIERE_Y = 30
const X0 = 5
const X1 = 150
/** Le LAC : loin du fil (11 tuiles > `SANG.ATTACHE`), donc une eau qui ne va nulle part. */
const LAC_X = 120
const LAC_Y = 12
const LAC_R = 5

/**
 * Une rivière horizontale (fil à `RIVIERE_Y`, lit de ±`RIVIERE_DEMI_LIT` en haut-fond, cœur
 * profond sur le fil) ET un lac carré au nord. Le fil est peint amont → aval, x croissant :
 * c'est le contrat de `map.fil`, et tout le sens de l'aval en découle.
 */
function carteRiviereEtLac(): WorldMap {
  const map = createEmptyMap(160, 60, TERRAIN_GRASS)
  const fil: number[] = []
  for (let x = X0; x <= X1; x++) {
    for (let dy = -EAU.RIVIERE_DEMI_LIT; dy <= EAU.RIVIERE_DEMI_LIT; dy++) {
      setTile(map, x, RIVIERE_Y + dy, TERRAIN_SHALLOW_WATER)
    }
    setTile(map, x, RIVIERE_Y, TERRAIN_DEEP_WATER)
    fil.push(RIVIERE_Y * map.width + x)
  }
  for (let dy = -LAC_R; dy <= LAC_R; dy++) {
    for (let dx = -LAC_R; dx <= LAC_R; dx++) setTile(map, LAC_X + dx, LAC_Y + dy, TERRAIN_DEEP_WATER)
  }
  map.fil = fil
  return map
}

/**
 * LA CARTE DU MÉANDRE (critère A2bis) — un fil qui se replie : il descend vers l'est à
 * `Y_HAUT`, tourne, et remonte vers l'ouest à `Y_BAS`. Les deux biefs sont à portée
 * d'attache (`SANG.ATTACHE`) d'une même tuile : c'est le seul montage où « le premier pas
 * trouvé » et « le pas le plus proche » ne donnent PAS la même réponse.
 */
const Y_HAUT = 20
const Y_BAS = 25
const X_COUDE = 60
const X_VERSE = 30

function carteMeandre(): WorldMap {
  const map = createEmptyMap(80, 50, TERRAIN_GRASS)
  const fil: number[] = []
  const pousse = (x: number, y: number): void => {
    for (let dy = -EAU.RIVIERE_DEMI_LIT; dy <= EAU.RIVIERE_DEMI_LIT; dy++) {
      setTile(map, x, y + dy, TERRAIN_SHALLOW_WATER)
    }
    setTile(map, x, y, TERRAIN_DEEP_WATER)
    fil.push(y * map.width + x)
  }
  for (let x = X0; x <= X_COUDE; x++) pousse(x, Y_HAUT) // l'amont, vers l'est
  for (let y = Y_HAUT + 1; y <= Y_BAS; y++) pousse(X_COUDE, y) // le coude
  for (let x = X_COUDE - 1; x >= X0; x--) pousse(x, Y_BAS) // l'aval, vers l'ouest
  map.fil = fil
  return map
}

/** LE HAUT-FOND où l'on saigne. **Pas l'eau profonde** : elle BLOQUE, et un avatar posé
 *  dessus se fait éjecter d'une tuile par la collision — la goutte tombait alors sur une
 *  tuile voisine, et le banc mesurait autre chose que ce qu'il croyait (MESURÉ : 60,5/30,5
 *  devenait 59,5/29,5). Le bord du lit, lui, porte un corps. */
const GUE_X = 60
const GUE_Y = RIVIERE_Y + EAU.RIVIERE_DEMI_LIT

function sim(map: WorldMap, jour = PLUIES): SimState {
  const s = createSim(2026, { map, nodes: [], faunaCap: 0, worldEvents: false, meteoActive: false, calendarScale: SCALE })
  s.tick = tickDe(jour)
  return s
}

/** Un avatar qui saigne, posé là. Le sang est le sang : la même passe que pour les bêtes. */
function blesse(s: SimState, x: number, y: number): number {
  const id = spawnEntity(s, x, y)
  s.entities.find((e) => e.id === id)!.wounds.bleeding = true
  return id
}

function ticks(s: SimState, n: number, inputs: MoveInput[] = []): void {
  for (let t = 0; t < n; t++) step(s, inputs)
}

/** L'index de tuile — la forme exacte que porte une souillure. */
const idx = (map: WorldMap, tx: number, ty: number): number => ty * map.width + tx

/* ─── A1 (seconde moitié) — LA SUIE PORTE LA FORCE PLEINE ─────────────────────────── */

describe('A1 — la refonte ne change rien au verdict de la suie', () => {
  it('une tuile souillée par la suie porte la force PLEINE, et `eauSouillee` le dit', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    // Le charnier sur la BERGE (la cendre ne traverse pas l'eau : aucune tuile du lit n'est
    // jamais cendrée — la leçon payée au banc de `PORTEE_SOURCE`).
    const xFoyer = 40
    s.map.cendreCout = calculeChampDeCendre(map.width, map.height, map.terrain, [
      { tx: xFoyer, ty: RIVIERE_Y - EAU.RIVIERE_DEMI_LIT - 2 },
    ])
    s.cendreAge = [0]
    expect(qualiteDeLEau(s, xFoyer, RIVIERE_Y), 'la suie est au plafond').toBe(COULEE.FORCE_SUIE)
    expect(COULEE.FORCE_SUIE).toBeGreaterThanOrEqual(SANG.SEUIL_SOUILLE)
    expect(eauSouillee(s, xFoyer, RIVIERE_Y)).toBe(true)
    // L'AMONT lointain reste propre : le porteur n'a pas élargi la loi de la suie.
    expect(qualiteDeLEau(s, X0 + 2, RIVIERE_Y)).toBe(0)
  })

  it('sans cendre ET sans sang, la qualité est 0 partout (le COÛT de Q12 se mesure hors suite : `__porte-q12.mts`)', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    expect(s.souillures).toEqual([])
    for (const [tx, ty] of [[40, RIVIERE_Y], [LAC_X, LAC_Y], [40, 5]] as const) {
      expect(qualiteDeLEau(s, tx, ty), `(${tx},${ty})`).toBe(0)
    }
  })
})

/* ─── A2 — LE SANG DESCEND ────────────────────────────────────────────────────────── */

describe('A2 — le sang descend le fil, et il ne remonte jamais', () => {
  const pose = (s: SimState, tx: number, ty: number, crans = 4): void => {
    s.souillures.push({ i: idx(s.map, tx, ty), tick: s.tick, crans, pas: attacheAuFil(s.map, tx, ty) })
  }

  it('l’aval se salit sur `DILUTION_PAS` pas, l’amont JAMAIS, et la force décroît', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    const xSang = 60
    pose(s, xSang, RIVIERE_Y)
    // LA PRÉMISSE : la goutte s'est bien attachée au fleuve, pas à une eau dormante.
    expect(s.souillures[0]!.pas, 'attachée au fil').toBeGreaterThanOrEqual(0)

    expect(qualiteDeLEau(s, xSang, RIVIERE_Y), 'au droit de la plaie').toBeGreaterThan(0)
    // L'AMONT, à un seul pas : RIEN. C'est la règle, et elle n'a pas de tolérance.
    for (let n = 1; n <= 10; n++) {
      expect(qualiteDeLEau(s, xSang - n, RIVIERE_Y), `amont −${n}`).toBe(0)
    }
    // L'AVAL : salit jusqu'à DILUTION_PAS, plus rien au-delà.
    expect(qualiteDeLEau(s, xSang + SANG.DILUTION_PAS, RIVIERE_Y), 'le dernier pas porté').toBeGreaterThan(0)
    expect(qualiteDeLEau(s, xSang + SANG.DILUTION_PAS + 1, RIVIERE_Y), 'la rivière s’est lavée').toBe(0)

    // LA FORCE DÉCROÎT, sans clignoter : monotone sur tout le parcours.
    let precedente = Number.POSITIVE_INFINITY
    for (let n = 0; n <= SANG.DILUTION_PAS; n++) {
      const f = qualiteDeLEau(s, xSang + n, RIVIERE_Y)
      expect(f, `aval +${n} décroît`).toBeLessThan(precedente)
      precedente = f
    }
  })

  it('la traînée teint le LIT en travers, et jamais la berge (Q7bis)', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    pose(s, 60, RIVIERE_Y)
    const x = 60 + 5 // bien dans la traînée
    expect(qualiteDeLEau(s, x, RIVIERE_Y + EAU.RIVIERE_DEMI_LIT), 'le bord du lit').toBeGreaterThan(0)
    // Une tuile de plus : c'est de la terre. Elle ne se tache pas, jamais.
    expect(qualiteDeLEau(s, x, RIVIERE_Y + EAU.RIVIERE_DEMI_LIT + 1), 'la berge').toBe(0)
  })

  it('A2bis — LE COUDE NE COUD PAS : l’attache prend le pas le plus PROCHE', () => {
    const map = carteMeandre()
    const s = sim(map)
    // La tuile versée est à 3 du bief amont (y=20) et à 2 du bief aval (y=25) : les deux sont
    // à portée d'attache, et seul le PLUS PROCHE est le bon. Sans la loi du plus-proche-point,
    // le premier pas trouvé serait celui d'en haut — et le sang traverserait le coude.
    const yVerse = 23
    expect(Math.abs(yVerse - Y_HAUT), 'le bief amont est à portée').toBeLessThanOrEqual(SANG.ATTACHE)
    expect(Math.abs(yVerse - Y_BAS)).toBeLessThan(Math.abs(yVerse - Y_HAUT))
    const pas = attacheAuFil(map, X_VERSE, yVerse)
    const iPas = map.fil![pas]!
    expect((iPas - (iPas % map.width)) / map.width, 'attachée au bief AVAL').toBe(Y_BAS)

    s.souillures.push({ i: idx(map, X_VERSE, yVerse), tick: s.tick, crans: 4, pas })
    // Le bief AVAL, à l'ouest du point de verse : souillé (le fil y descend).
    expect(qualiteDeLEau(s, X_VERSE - 20, Y_BAS), 'aval du bon bief').toBeGreaterThan(0)
    // Le bief AMONT, à l'est : PROPRE. C'est ce que « le premier pas trouvé » aurait sali.
    expect(qualiteDeLEau(s, X_VERSE + 20, Y_HAUT), 'l’autre bief').toBe(0)
  })

  it('au-delà de `SANG.ATTACHE` du fil, il n’y a pas de fleuve : pas d’attache', () => {
    const map = carteRiviereEtLac()
    expect(attacheAuFil(map, LAC_X, LAC_Y), 'le lac est hors du fleuve').toBe(-1)
    expect(attacheAuFil(map, 60, RIVIERE_Y), 'le fil, lui, s’attache à lui-même').toBeGreaterThanOrEqual(0)
  })
})

/* ─── A3 — L'EAU DORMANTE ─────────────────────────────────────────────────────────── */

describe('A2ter — toute l’eau du fleuve est dans le fleuve (vrai monde joué)', () => {
  /** LA BORNE D'AVANT : euclidienne. Rejouée ici pour que la garde PROUVE qu'elle mord au lieu
   *  de l'affirmer — sans ce témoin, un vert ne dirait pas si la loi neuve sert à quelque chose. */
  function attacheEuclidienne(map: WorldMap, tx: number, ty: number): number {
    const fil = map.fil!
    let pas = -1
    let meilleure = SANG.ATTACHE * SANG.ATTACHE + 1
    for (let k = 0; k < fil.length; k++) {
      const i = fil[k]!
      const x = i % map.width
      const dx = x - tx
      const dy = (i - x) / map.width - ty
      const d2 = dx * dx + dy * dy
      if (d2 < meilleure) {
        meilleure = d2
        pas = k
        if (d2 === 0) break
      }
    }
    return pas
  }

  it('AUCUN coin de lit ne se lit comme une mare — et la borne euclidienne, elle, en rate 7 %', () => {
    // LA DÉRIVATION DE Q6bis, affirmée : la borne couvre le lit entier, coins compris.
    expect(SANG.ATTACHE, 'ATTACHE = DEMI_LIT + 1').toBe(COULEE.DEMI_LIT + 1)
    const { map } = carteDeTest(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const fil = map.fil
    expect(fil && fil.length, 'la prémisse : ce monde a un fleuve').toBeTruthy()
    const w = map.width
    const vues = new Set<number>()
    let dansLaBande = 0
    let orphelinesCheb = 0
    let orphelinesEucl = 0
    for (const i of fil!) {
      const x0 = i % w
      const y0 = (i - x0) / w
      // LE DOMAINE EST LE LIT (≤ DEMI_LIT), PAS LA BORNE : balayer la boîte de rayon `ATTACHE`
      // rendait `orphelinesCheb === 0` vrai pour TOUTE valeur de la borne — la garde ne pouvait
      // pas échouer (revue du 2026-09-12). Sur le lit, une borne trop courte fait des orphelines.
      for (let ty = y0 - COULEE.DEMI_LIT; ty <= y0 + COULEE.DEMI_LIT; ty++) {
        for (let tx = x0 - COULEE.DEMI_LIT; tx <= x0 + COULEE.DEMI_LIT; tx++) {
          if (tx < 0 || ty < 0 || tx >= w || ty >= map.height) continue
          const j = ty * w + tx
          if (vues.has(j)) continue
          vues.add(j)
          const t = map.terrain[j]
          if (t !== TERRAIN_SHALLOW_WATER && t !== TERRAIN_DEEP_WATER) continue
          dansLaBande += 1
          if (attacheAuFil(map, tx, ty) < 0) orphelinesCheb += 1
          if (attacheEuclidienne(map, tx, ty) < 0) orphelinesEucl += 1
        }
      }
    }
    expect(dansLaBande, 'le balayage a bien vu du fleuve').toBeGreaterThan(1000)
    expect(orphelinesCheb, 'pas UNE tuile d’eau du fleuve sans attache').toBe(0)
    // LE TÉMOIN : la borne d'avant en ratait des centaines. Si ce compte tombait à zéro, c'est
    // la carte qui aurait changé de forme — et la garde au-dessus ne prouverait plus rien.
    expect(orphelinesEucl, 'la borne euclidienne, elle, orpheline tout un lit de coins').toBeGreaterThan(100)
  })
})

describe('A3 — l’eau dormante ne coule pas', () => {
  it('le disque est SYMÉTRIQUE, nul au-delà de `PORTEE_DORMANTE`, et n’atteint pas la terre', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    s.souillures.push({ i: idx(map, LAC_X, LAC_Y), tick: s.tick, crans: 4, pas: -1 })

    const centre = qualiteDeLEau(s, LAC_X, LAC_Y)
    expect(centre).toBeGreaterThan(0)
    // SYMÉTRIE : les quatre côtés et les quatre diagonales, à la même distance, au bit près.
    for (let d = 1; d <= SANG.PORTEE_DORMANTE; d++) {
      const ref = qualiteDeLEau(s, LAC_X + d, LAC_Y)
      expect(ref, `d=${d} décroît`).toBeLessThan(centre)
      for (const [dx, dy] of [[-d, 0], [0, d], [0, -d], [d, d], [-d, -d]] as const) {
        if (Math.abs(dx) > LAC_R || Math.abs(dy) > LAC_R) continue // hors du lac : c'est de la terre
        expect(qualiteDeLEau(s, LAC_X + dx, LAC_Y + dy), `(${dx},${dy}) symétrique`).toBe(ref)
      }
    }
    expect(qualiteDeLEau(s, LAC_X + SANG.PORTEE_DORMANTE + 1, LAC_Y), 'hors de portée').toBe(0)
  })

  it('AUCUNE tuile de terre n’est jamais souillée, sur aucune des deux formes', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    s.souillures.push({ i: idx(map, LAC_X, LAC_Y), tick: s.tick, crans: 4, pas: -1 })
    s.souillures.push({ i: idx(map, 60, RIVIERE_Y), tick: s.tick, crans: 4, pas: attacheAuFil(map, 60, RIVIERE_Y) })
    // LE BALAYAGE EXHAUSTIF plutôt que des cas choisis : toute la bande des deux formes.
    let terres = 0
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const t = map.terrain[idx(map, tx, ty)]
        if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) continue
        if (qualiteDeLEau(s, tx, ty) !== 0) terres += 1
      }
    }
    expect(terres, 'tuiles de terre souillées').toBe(0)
  })
})

/* ─── A4 — LES BORNES ─────────────────────────────────────────────────────────────── */

describe('A4 — les bornes tiennent des deux côtés', () => {
  it('un combat de MILLE ticks dans un gué laisse UNE souillure, pas mille', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    // LA PRÉMISSE : la tuile porte bien de l'eau, et elle n'est pas prise par la glace.
    expect(porteDeLEau(s, GUE_X, GUE_Y), 'la tuile porte de l’eau').toBe(true)
    expect(estGele(s, GUE_X, GUE_Y), 'et elle n’est pas gelée').toBe(false)
    blesse(s, GUE_X + 0.5, GUE_Y + 0.5)
    ticks(s, 1000)
    expect(s.souillures.length, 'une tuile, une souillure').toBe(1)
    expect(s.souillures[0]!.i, 'et c’est bien SA tuile').toBe(idx(map, GUE_X, GUE_Y))
    // La force s'est MONTÉE jusqu'au plafond, et pas au-delà.
    const plafond = Math.ceil(SANG.FORCE_MAX / SANG.FORCE_PAR_GOUTTE)
    expect(s.souillures[0]!.crans).toBeLessThanOrEqual(plafond)
    expect(s.souillures[0]!.crans * SANG.FORCE_PAR_GOUTTE).toBeGreaterThanOrEqual(SANG.FORCE_MAX)
    expect(qualiteDeLEau(s, GUE_X, GUE_Y)).toBeGreaterThanOrEqual(SANG.SEUIL_SOUILLE)
    expect(eauSouillee(s, GUE_X, GUE_Y)).toBe(true)
  })

  it('une souillure EXPIRE : `TACHE_TICKS` sans une goutte, et l’eau est propre', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    s.souillures.push({ i: idx(map, 60, RIVIERE_Y), tick: s.tick - SANG.TACHE_TICKS, crans: 4, pas: -1 })
    expect(qualiteDeLEau(s, 60, RIVIERE_Y), 'déjà éteinte à la lecture').toBe(0)
    step(s, [])
    expect(s.souillures, 'et balayée de l’état').toEqual([])
  })

  it('une souillure PÂLIT avec l’âge — la rivière se lave, elle ne s’éteint pas d’un coup', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    const neuve = { i: idx(map, 60, RIVIERE_Y), tick: s.tick, crans: 4, pas: -1 }
    s.souillures.push(neuve)
    const pleine = qualiteDeLEau(s, 60, RIVIERE_Y)
    neuve.tick = s.tick - Math.floor(SANG.TACHE_TICKS / 2)
    const mure = qualiteDeLEau(s, 60, RIVIERE_Y)
    expect(mure).toBeGreaterThan(0)
    expect(mure).toBeLessThan(pleine)
  })

  it('le plafond FIFO : la PLUS VIEILLE souillure s’efface, et le tableau ne grossit pas', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    // `TACHES_MAX` souillures déjà là — sur des tuiles d'eau du lit, distinctes.
    for (let k = 0; k < SANG.TACHES_MAX; k++) {
      s.souillures.push({ i: idx(map, X0 + k, RIVIERE_Y), tick: s.tick, crans: 1, pas: -1 }) // rangée du fil ; le gué est au bord du lit — aucune collision
    }
    const doyenne = s.souillures[0]!.i
    // Puis une goutte sur une tuile NEUVE, par le vrai chemin : la plus vieille saute.
    blesse(s, GUE_X + 0.5, GUE_Y + 0.5)
    ticks(s, 2 * HUNT.BLOOD_EVERY_TICKS + 2)
    expect(s.souillures.length, 'le plafond tient').toBe(SANG.TACHES_MAX)
    expect(s.souillures.some((t) => t.i === doyenne), 'la doyenne a sauté').toBe(false)
    expect(s.souillures.some((t) => t.i === idx(map, GUE_X, GUE_Y)), 'la neuve est là').toBe(true)
  })

  it('le plafond évince la MOINS RÉCEMMENT NOURRIE — jamais le gué qu’on saigne encore', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    const t0 = s.tick
    const gue = idx(map, GUE_X, GUE_Y)
    // Le gué est CRÉÉ le premier (le plus vieux à la naissance)…
    s.souillures.push({ i: gue, tick: t0 - 200, crans: 4, pas: attacheAuFil(map, GUE_X, GUE_Y) })
    // …puis 63 autres, plus jeunes que lui : le tableau est plein.
    for (let k = 1; k < SANG.TACHES_MAX; k++) {
      s.souillures.push({ i: idx(map, X0 + k, RIVIERE_Y), tick: t0 - 200 + k, crans: 1, pas: -1 })
    }
    const doyenne = s.souillures[1]!.i // la moins récemment nourrie, une fois le gué rafraîchi
    // On saigne DANS le gué : sa souillure est rafraîchie sur place, pas recréée.
    blesse(s, GUE_X + 0.5, GUE_Y + 0.5)
    ticks(s, 2 * HUNT.BLOOD_EVERY_TICKS + 2)
    const leGue = s.souillures.find((t) => t.i === gue)
    expect(leGue, 'la prémisse : le gué est là').toBeDefined()
    expect(leGue!.tick, 'et il est désormais le plus frais').toBeGreaterThan(t0 - 200 + SANG.TACHES_MAX)
    drainEvents(s)
    // Une goutte sur une tuile NEUVE : il faut évincer quelqu’un.
    blesse(s, 100.5, GUE_Y + 0.5)
    ticks(s, 2 * HUNT.BLOOD_EVERY_TICKS + 2)
    const faits = drainEvents(s).filter((e) => e.type === 'water_fouled')
    expect(s.souillures.length, 'le plafond tient').toBe(SANG.TACHES_MAX)
    expect(s.souillures.some((t) => t.i === gue), 'le gué qu’on saigne est toujours là').toBe(true)
    expect(s.souillures.some((t) => t.i === doyenne), 'la moins récemment nourrie a sauté').toBe(false)
    expect(faits.some((e) => e.tx === GUE_X && e.ty === GUE_Y), 'et le gué ne s’est pas ré-annoncé').toBe(false)
    expect(faits.some((e) => e.tx === 100 && e.ty === GUE_Y), 'la neuve, elle, s’est annoncée').toBe(true)
  })
})

/* ─── A4bis — LE PLAFOND SOUS UN CORPS QUI MARCHE ─────────────────────────────────── */

/**
 * LE RÉGIME QUE LE MONDE JOUÉ PRODUIT VRAIMENT. L'empreinte de `/sim` a relevé **27
 * `water_fouled` en 4 000 ticks** sur un seul scénario : ce sont des CRÉATIONS en série, donc
 * un corps qui SE DÉPLACE en saignant — pas le combat sur place que gardent A4 et A8. C'est
 * dans ce régime, et seulement là, que l'éviction FIFO et la dé-duplication par tuile se
 * rencontrent.
 *
 * Le banc est une rivière LONGUE (400 tuiles) : il faut plus de `TACHES_MAX` tuiles d'eau
 * d'affilée pour que le plafond soit atteint par le vrai chemin. Et le trajet reste sous la
 * mort : un avatar qui saigne perd ses points de vie et **s'arrête vers le tick 1 440**
 * (MESURÉ) — au-delà, on mesurerait un cadavre.
 */
const LONG_X1 = 390
function carteLongueRiviere(): WorldMap {
  const map = createEmptyMap(400, 60, TERRAIN_GRASS)
  const fil: number[] = []
  for (let x = X0; x <= LONG_X1; x++) {
    for (let dy = -EAU.RIVIERE_DEMI_LIT; dy <= EAU.RIVIERE_DEMI_LIT; dy++) {
      setTile(map, x, RIVIERE_Y + dy, TERRAIN_SHALLOW_WATER)
    }
    setTile(map, x, RIVIERE_Y, TERRAIN_DEEP_WATER)
    fil.push(RIVIERE_Y * map.width + x)
  }
  map.fil = fil
  return map
}

describe('A4bis — un corps qui marche en saignant', () => {
  it('le plafond tient, et l’éviction tourne sur le vrai chemin', () => {
    const map = carteLongueRiviere()
    const s = sim(map)
    const id = blesse(s, 10.5, GUE_Y + 0.5)
    expect(porteDeLEau(s, 10, GUE_Y), 'la prémisse : il part les pieds dans l’eau').toBe(true)
    const tuiles: number[] = []
    for (let t = 0; t < 1100; t++) {
      step(s, [{ entityId: id, dx: 1, dy: 0 }])
      for (const e of drainEvents(s)) if (e.type === 'water_fouled') tuiles.push(idx(map, e.tx, e.ty))
    }
    // LA PRÉMISSE DU RÉGIME : il a bel et bien marché, et il est encore vivant en train de saigner.
    const lui = s.entities.find((e) => e.id === id)!
    expect(lui.x, 'il a longé le lit (≈ 2 tuiles/s en haut-fond)').toBeGreaterThan(100)
    expect(lui.wounds.bleeding, 'et il saignait encore').toBe(true)
    // ① (RETIRÉ le 2026-09-12, revue) « un événement par tuile » ne pouvait pas échouer ici : sur
    //    une marche droite, ~1,6 tuile sépare deux gouttes, chacune tombe sur une tuile neuve. La
    //    re-entrée — le seul cas où une tuile pourrait s’annoncer deux fois — est gardée par A8bis.
    // ② LE PLAFOND : il a fait plus de tuiles que le tableau n’en tient, et le tableau tient.
    expect(tuiles.length, 'le trajet dépasse le plafond').toBeGreaterThan(SANG.TACHES_MAX)
    expect(s.souillures.length, 'et le tableau ne grossit pas').toBe(SANG.TACHES_MAX)
    // ③ L’ÉVICTION A BIEN TOURNÉ PAR LE VRAI CHEMIN : les premières tuiles ne sont plus là,
    //    les dernières y sont. (Elles n’ont pas EXPIRÉ : le trajet tient dans `TACHE_TICKS`.)
    const vivantes = new Set(s.souillures.map((t) => t.i))
    expect(vivantes.has(tuiles[0]!), 'la première tuile a sauté').toBe(false)
    expect(vivantes.has(tuiles[tuiles.length - 1]!), 'la dernière est là').toBe(true)
  })
})

/* ─── LE VERDICT QU'EN TIRE LA PÊCHE, ET LE MARAIS ─────────────────────────────────── */

describe('Le verdict qu’en tire la pêche — la portée du booléen, épinglée', () => {
  // `peche-table.ts` lit `eauSouillee` (le SEUIL), pas la force : ce que le joueur sent, c’est la
  // portée du booléen. Les nombres sont écrits EN DUR, exprès : régler `FORCE_PAR_GOUTTE`,
  // `SEUIL_SOUILLE`, `DILUTION_PAS` ou `PORTEE_DORMANTE` doit faire rougir ICI, pour que la
  // portée ressentie bouge par décision et non en silence (revue du 2026-09-12).
  it('pleine force : 28 pas d’aval sur le fleuve, 3 tuiles sur une eau dormante', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    const X = 40
    s.souillures.push({ i: idx(map, X, RIVIERE_Y), tick: s.tick, crans: 4, pas: attacheAuFil(map, X, RIVIERE_Y) })
    s.souillures.push({ i: idx(map, LAC_X, LAC_Y), tick: s.tick, crans: 4, pas: -1 })
    expect(eauSouillee(s, X + 28, RIVIERE_Y), '28 pas d’aval').toBe(true)
    expect(eauSouillee(s, X + 29, RIVIERE_Y), '29 pas : lavée').toBe(false)
    expect(eauSouillee(s, X - 1, RIVIERE_Y), 'l’amont, jamais').toBe(false)
    expect(eauSouillee(s, LAC_X + 3, LAC_Y), '3 tuiles').toBe(true)
    expect(eauSouillee(s, LAC_X + 4, LAC_Y), '4 tuiles : propre').toBe(false)
  })

  it('une seule goutte ne fait JAMAIS une eau souillée — il faut saigner', () => {
    const map = carteRiviereEtLac()
    const s = sim(map)
    s.souillures.push({ i: idx(map, 40, RIVIERE_Y), tick: s.tick, crans: 1, pas: attacheAuFil(map, 40, RIVIERE_Y) })
    s.souillures.push({ i: idx(map, LAC_X, LAC_Y), tick: s.tick, crans: 1, pas: -1 })
    expect(eauSouillee(s, 40, RIVIERE_Y)).toBe(false)
    expect(eauSouillee(s, LAC_X, LAC_Y)).toBe(false)
    expect(qualiteDeLEau(s, 40, RIVIERE_Y), 'mais la force existe').toBeGreaterThan(0)
  })
})

describe('Q7 — le marais garde le sang, crue ou pas (décision d’Alexis, 2026-09-12)', () => {
  function carteAuMarais(): WorldMap {
    const map = carteRiviereEtLac()
    for (let y = 48; y <= 52; y++) for (let x = 30; x <= 34; x++) setTile(map, x, y, TERRAIN_MARSH)
    return map
  }

  it('hors crue, le sang versé dans un marais le souille — en disque, et il l’annonce', () => {
    const map = carteAuMarais()
    const s = sim(map)
    // LA PRÉMISSE qui fait tout l’intérêt de la garde : pour la loi de l’eau, ce marais est de
    // la TERRE aujourd’hui. Sans elle, un vert prouverait seulement qu’il était en crue.
    expect(porteDeLEau(s, 32, 50), 'hors crue : pas d’eau au sens de `eau.ts`').toBe(false)
    expect(estGele(s, 32, 50), 'et pas de glace').toBe(false)
    blesse(s, 32.5, 50.5)
    ticks(s, 2 * HUNT.BLOOD_EVERY_TICKS + 2)
    expect(s.souillures.map((t) => t.i), 'une souillure, au marais').toEqual([idx(map, 32, 50)])
    expect(drainEvents(s).filter((e) => e.type === 'water_fouled')).toHaveLength(1)
    expect(qualiteDeLEau(s, 33, 50), 'le disque teint le marais voisin').toBeGreaterThan(0)
    expect(qualiteDeLEau(s, 32, 47), 'et pas l’herbe dans le rayon du disque').toBe(0)
  })

  it('la roselière aussi (décision d’Alexis, même jour)', () => {
    const map = carteRiviereEtLac()
    for (let y = 48; y <= 52; y++) for (let x = 30; x <= 34; x++) setTile(map, x, y, TERRAIN_REED_MARSH)
    const s = sim(map)
    expect(porteDeLEau(s, 32, 50), 'la prémisse : de la terre pour `eau.ts`').toBe(false)
    blesse(s, 32.5, 50.5)
    ticks(s, 2 * HUNT.BLOOD_EVERY_TICKS + 2)
    expect(s.souillures.map((t) => t.i), 'une souillure, à la roselière').toEqual([idx(map, 32, 50)])
    expect(qualiteDeLEau(s, 33, 50), 'le disque teint la roselière voisine').toBeGreaterThan(0)
  })

  it('LE TÉMOIN : le même sang sur l’herbe d’à côté ne souille rien', () => {
    const s = sim(carteAuMarais())
    blesse(s, 32.5, 45.5)
    ticks(s, 2 * HUNT.BLOOD_EVERY_TICKS + 2)
    expect(s.souillures).toEqual([])
  })
})

/* ─── A5 — LA GLACE PROTÈGE ───────────────────────────────────────────────────────── */

describe('A5 — la glace protège l’eau qu’elle couvre', () => {
  it('au GRAND FROID, l’eau prise ne se souille pas — le sang est SUR la glace', () => {
    const s = sim(carteRiviereEtLac(), GRAND_FROID)
    // LES DEUX PRÉMISSES, affirmées : l'eau est là, ET elle est prise. Sans la seconde, zéro
    // souillure prouverait seulement que la mare s'était asséchée.
    expect(porteDeLEau(s, GUE_X, GUE_Y), 'la tuile porte de l’eau').toBe(true)
    expect(estGele(s, GUE_X, GUE_Y), 'et la glace a pris').toBe(true)
    blesse(s, GUE_X + 0.5, GUE_Y + 0.5)
    ticks(s, 200)
    expect(s.souillures, 'rien n’est entré dans l’eau').toEqual([])
    expect(qualiteDeLEau(s, GUE_X, GUE_Y)).toBe(0)
  })

  it('LE TÉMOIN : la même tuile, le même sang, l’eau LIBRE — et elle se souille', () => {
    const s = sim(carteRiviereEtLac(), PLUIES)
    expect(estGele(s, GUE_X, GUE_Y), 'l’eau est libre').toBe(false)
    expect(porteDeLEau(s, GUE_X, GUE_Y)).toBe(true)
    blesse(s, GUE_X + 0.5, GUE_Y + 0.5)
    ticks(s, 200)
    expect(s.souillures.length).toBe(1)
  })
})

/* ─── A8 / A9 — L'ÉVÉNEMENT, ET LA FORME DE L'ÉTAT ────────────────────────────────── */

describe('A8 — l’événement ne bégaie pas', () => {
  it('un combat continu sur une tuile d’eau émet UN `water_fouled`, pas un par goutte', () => {
    const s = sim(carteRiviereEtLac())
    blesse(s, GUE_X + 0.5, GUE_Y + 0.5)
    ticks(s, 600)
    const fouled = drainEvents(s).filter((e) => e.type === 'water_fouled')
    expect(fouled.length, 'un seul fait de domaine').toBe(1)
    expect(fouled[0]).toMatchObject({ tx: GUE_X, ty: GUE_Y })
  })

  it('A8bis — il PART et il REVIENT : la tuile n’est annoncée qu’une fois', () => {
    const map = carteLongueRiviere()
    const s = sim(map)
    const T0_X = 10
    const id = blesse(s, T0_X + 0.5, GUE_Y + 0.5)
    const tuiles: number[] = []
    const recolte = (): void => {
      for (const e of drainEvents(s)) if (e.type === 'water_fouled') tuiles.push(idx(map, e.tx, e.ty))
    }
    const marche = (n: number, dx: -1 | 0 | 1): void => {
      for (let t = 0; t < n; t++) {
        step(s, dx === 0 ? [] : [{ entityId: id, dx, dy: 0 }])
        recolte()
      }
    }
    const surT0 = (): number => tuiles.filter((i) => i === idx(map, T0_X, GUE_Y)).length
    marche(40, 0) // il saigne sur place : la tuile est annoncée
    expect(surT0(), 'annoncée une fois').toBe(1)
    marche(120, 1) // il s’en va…
    const lui = s.entities.find((e) => e.id === id)!
    expect(Math.floor(lui.x), 'la prémisse : il a bien QUITTÉ sa tuile').toBeGreaterThan(T0_X)
    marche(120, -1) // …et il revient dessus
    expect(Math.floor(lui.x), 'et il est REVENU sur elle').toBe(T0_X)
    marche(60, 0) // le temps de plusieurs gouttes
    // La souillure vit encore — sinon une seconde annonce serait JUSTE (l’eau s’était lavée).
    const mienne = s.souillures.find((t) => t.i === idx(map, T0_X, GUE_Y))
    expect(mienne, 'la souillure de départ vit toujours').toBeDefined()
    expect(s.tick - mienne!.tick, 'et elle est loin d’expirer').toBeLessThan(SANG.TACHE_TICKS)
    expect(surT0(), 'UNE seule annonce pour tout le trajet').toBe(1)
  })

  it('sans cendre et sans sang, l’eau n’émet RIEN', () => {
    const s = sim(carteRiviereEtLac())
    spawnEntity(s, GUE_X + 0.5, GUE_Y + 0.5) // un corps, mais il ne saigne pas
    ticks(s, 400)
    expect(drainEvents(s).some((e) => e.type === 'water_fouled')).toBe(false)
  })
})

describe('A9 — la forme de l’état : JSON, et la carte reste immuable', () => {
  it('une souillure traverse la sauvegarde sans perdre un champ', () => {
    const s = sim(carteRiviereEtLac())
    s.souillures.push({ i: idx(s.map, 60, RIVIERE_Y), tick: s.tick, crans: 3, pas: 55 })
    const relu = deserializeSim(serializeSim(s))
    expect(relu.souillures).toEqual(s.souillures)
  })

  it('une sauvegarde d’AVANT le champ se relit, et ses souillures sont vides', () => {
    const s = sim(carteRiviereEtLac())
    const brut = JSON.parse(serializeSim(s)) as { sim: Record<string, unknown> }
    delete brut.sim.souillures
    expect(deserializeSim(JSON.stringify(brut)).souillures).toEqual([])
  })

  it('la souillure vit dans `SimState`, JAMAIS dans `map`', () => {
    const s = sim(carteRiviereEtLac())
    const avant = s.map.terrain.slice()
    blesse(s, GUE_X + 0.5, GUE_Y + 0.5)
    ticks(s, 200)
    expect(s.souillures.length).toBe(1)
    expect(Array.from(s.map.terrain)).toEqual(Array.from(avant))
  })
})
