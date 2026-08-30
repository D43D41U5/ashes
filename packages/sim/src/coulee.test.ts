/**
 * ═══ A29-A31 — LES COULÉES DE SUIE (spec `cendre.md` R26) ═══
 *
 * Le banc pose une RIVIÈRE À LA MAIN (un fil rectiligne, son lit peint) et un charnier RÉEL
 * (`calculeChampDeCendre`, l'écrivain unique — jamais un champ écrit à la main, la leçon de
 * G7bis) : la souillure se mesure sur la loi entière, pas sur une recopie de ses morceaux.
 */
import { describe, expect, it } from 'vitest'
import { FISH_SPECIES, TERRAIN_DEEP_WATER, TERRAIN_GRASS, TERRAIN_SHALLOW_WATER } from './balance'
import { calculeChampDeCendre } from './cendre'
import { COULEE, eauSouillee } from './coulee'
import { createEmptyMap, setTile, type WorldMap } from './map'
import { tableDePrises, type Conditions } from './peche-table'
import { createSim, type SimState } from './sim'

/** La carte d'essai : une rivière horizontale (fil y=20, x de 5 à 115), lit de ±2 en haut-fond,
 *  cœur profond sur le fil — un monde assez LONG pour voir la dilution s'éteindre. */
function carteRiviere(): WorldMap {
  const map = createEmptyMap(120, 40, TERRAIN_GRASS)
  const fil: number[] = []
  for (let x = 5; x <= 115; x++) {
    for (let dy = -2; dy <= 2; dy++) setTile(map, x, 20 + dy, TERRAIN_SHALLOW_WATER)
    setTile(map, x, 20, TERRAIN_DEEP_WATER)
    fil.push(20 * map.width + x)
  }
  map.fil = fil
  return map
}

/** Le banc : la rivière, et (si demandé) un charnier réel posé SUR la berge à `xFoyer`. */
function banc(xFoyer?: number): SimState {
  const map = carteRiviere()
  const sim = createSim(2026, { map, nodes: [], faunaCap: 0, worldEvents: false, meteoActive: false })
  if (xFoyer !== undefined) {
    sim.map.cendreCout = calculeChampDeCendre(map.width, map.height, map.terrain, [{ tx: xFoyer, ty: 16 }])
    sim.cendreAge = [0] // l'âge 0 : la tache R0 seule — elle touche la berge, pas l'autre rive
  }
  return sim
}

// Le X du foyer et les repères de fil qui en découlent — nommés pour que les gardes se lisent.
const X_FOYER = 40

describe('A29 — la souillure descend le fil, se dilue, et épargne l’amont', () => {
  it('sans cendre, PAS UNE tuile souillée — la prémisse du reste', () => {
    const sim = banc()
    for (let x = 5; x <= 115; x++) expect(eauSouillee(sim, x, 20)).toBe(false)
  })

  it('au droit du foyer : souillé ; loin en AMONT : propre ; la dilution s’éteint en AVAL', () => {
    const sim = banc(X_FOYER)
    // LA PRÉMISSE SE PROUVE (une garde prouve sa prémisse) : la tache touche bien le fil.
    expect(eauSouillee(sim, X_FOYER, 20), 'le droit du foyer est souillé').toBe(true)
    // L'AMONT, hors de portée de la tache : propre — la suie ne remonte pas le courant.
    expect(eauSouillee(sim, 10, 20), 'l’amont lointain est propre').toBe(false)
    // L'AVAL proche : souillé (la descente porte).
    expect(eauSouillee(sim, X_FOYER + 20, 20)).toBe(true)
    // L'AVAL au-delà de toute source + DILUTION_PAS : la rivière s'est lavée.
    expect(eauSouillee(sim, X_FOYER + 25 + COULEE.DILUTION_PAS + 5, 20), 'la rivière se lave').toBe(false)
  })

  it('LE BALAYAGE ENTIER est monotone par morceaux : propre → souillé → propre, sans clignoter', () => {
    // Garde exhaustive plutôt que cas choisis : on balaie TOUT le fil et on affirme UNE
    // propriété — la souillure est un unique intervalle contigu (des sources contiguës en
    // amont d'une seule tache, ça ne peut pas faire deux îlots).
    const sim = banc(X_FOYER)
    const etats: boolean[] = []
    for (let x = 5; x <= 115; x++) etats.push(eauSouillee(sim, x, 20))
    let transitions = 0
    for (let i = 1; i < etats.length; i++) if (etats[i] !== etats[i - 1]) transitions++
    expect(etats.some((e) => e), 'quelque chose est souillé').toBe(true)
    expect(transitions, 'un seul intervalle : monte une fois, redescend une fois').toBeLessThanOrEqual(2)
  })

  it('la suie teint L’EAU, jamais la berge — et le lit entier, pas le seul fil', () => {
    const sim = banc(X_FOYER)
    expect(eauSouillee(sim, X_FOYER + 10, 22), 'le haut-fond du lit est souillé').toBe(true)
    expect(eauSouillee(sim, X_FOYER + 10, 26), 'l’herbe de la berge ne l’est jamais').toBe(false)
  })
})

describe('A30 — l’eau souillée échange sa table, dans les deux sens', () => {
  const cond = (souille: boolean): Conditions => ({
    nature: 'riviere', zone: 'pres_bas', saison: 3, creneau: 'jour', surCoin: false, souille,
  })

  it('l’eau souillée ne retient QUE les espèces de suie — et il y en a', () => {
    const poissons = tableDePrises(cond(true)).lignes.filter((l) => l.kind === 'poisson')
    expect(poissons.length, 'quelque chose mord dans la suie').toBeGreaterThan(0)
    for (const l of poissons) {
      expect((l as { species: { souillee?: boolean } }).species.souillee, 'que des espèces de suie').toBe(true)
    }
  })

  it('l’eau claire ne retient JAMAIS une espèce de suie — sur tout le domaine des natures', () => {
    for (const nature of ['riviere', 'lac', 'mare', 'crue'] as const) {
      for (const saison of [1, 2, 3, 4]) {
        const t = tableDePrises({ ...cond(false), nature, saison })
        for (const l of t.lignes) {
          if (l.kind !== 'poisson') continue
          expect((l as { species: { souillee?: boolean } }).species.souillee ?? false, `${nature} s${saison}`).toBe(false)
        }
      }
    }
  })

  it('LA LAMPROIE FERME LA TABLE (T7) : elle est déclarée en DERNIER — l’ordre est le tirage', () => {
    // La garde du bit-près des replays d'eau claire : une espèce de suie insérée AILLEURS
    // qu'en queue décalerait le tirage cumulatif de toutes les tables existantes.
    const idx = FISH_SPECIES.findIndex((sp) => sp.souillee === true)
    expect(idx, 'il existe une espèce de suie').toBeGreaterThanOrEqual(0)
    for (let i = idx; i < FISH_SPECIES.length; i++) {
      expect(FISH_SPECIES[i]!.souillee, 'rien de propre après la première espèce de suie').toBe(true)
    }
  })
})

describe('A31 — la coulée suit le foyer, et un foyer gelé la fige', () => {
  it('l’âge qui monte étend la souillure vers l’aval ; l’âge figé la fige', () => {
    const sim = banc(X_FOYER)
    const bord = (): number => {
      let dernier = -1
      for (let x = 5; x <= 115; x++) if (eauSouillee(sim, x, 20)) dernier = x
      return dernier
    }
    const jeune = bord()
    expect(jeune, 'la coulée existe à l’âge 0').toBeGreaterThan(0)
    // LE FOYER VIEILLIT (le monde a tourné) : la tache grandit, la coulée descend plus loin.
    sim.cendreAge = [25]
    sim.tick += 1 // un état différent — le cache doit suivre l'ÂGE, pas s'accrocher au tick
    const vieux = bord()
    expect(vieux, 'la coulée suit l’avancée').toBeGreaterThan(jeune)
    // LE FOYER GELÉ (R16 : brûler la fosse fige l'âge) : mêmes jours qui passent, même coulée.
    sim.cendreAge = [25]
    expect(bord(), 'un âge figé fige la coulée').toBe(vieux)
  })
})
