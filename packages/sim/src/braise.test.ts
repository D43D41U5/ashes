/**
 * LA BRAISE (spec `braise.md`) — les critères B-A1 à B-A5, B-A10 et B-A12, un `describe` par
 * critère. Les étapes 3 et 4 du § 3 : la demande en crans, la barre, la vidange, et le déficit
 * que le corps lit.
 *
 * ⚠ **CE QUI N'EST PAS ICI, ET POURQUOI.** B-A6 à B-A8 (recharge, rallumage, mort) attendent la
 * BALISE, qui est l'étape 6 — la recharge n'existe nulle part encore, et une garde qui l'affirmerait
 * serait verte sur du vide. B-A9 (le retrait de `tenue_hiver`) est l'étape 5. B-A11 (plus de faim de
 * survie) et B-A13 (le budget du tick) ne sont pas des tests unitaires : l'un est un retrait, l'autre
 * une MESURE au profileur.
 *
 * ⚠ **ET TOUTES CES GARDES MONTENT LEUR CARTE SANS `cendreCout` NI MÉTÉO**, donc sans souffle de
 * fumerolle, sans froid de cendre et sans front : la demande y est exactement `SOCLE − nuit − étage`,
 * et c'est ce qui permet d'affirmer la TABLE de B-R4b au cran près. Les termes qu'on écarte sont des
 * froids ≥ 0 : ils ne feraient qu'exiger PLUS de crans, jamais moins.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, BRAISE, COMBAT, FIRE, MONSTER_DEFS, TEMPERATURE } from './balance'
import { braiseNeuve, chargePleine, cransCouverts, cransMax, type Braise } from './braise'
import { palierDuSol } from './etages'
import { fenetreDe, meteoMouille, type MeteoFront } from './meteo'
import { deserializeSim, serializeSim } from './persistence'
import { respawn } from './combat'
import { spawnMonster } from './monsters'
import { createSim, spawnEntity, step, type Entity, type SimState } from './sim'
import { TERRASSES } from './terrasses'
import { addItems, countOf, makeInventory } from './items'
import { advanceFire, fireState, fireStateAt, flammeDonnee, foyerAllumable, fireZoneInventory } from './fire'
import { advanceTemperature, airDeLaDemande, baselineTemperature, cransExiges, eveilCendreuxAt, rechargeDeBalise, socleDuJour } from './temperature'
import { estGele } from './gel'
import { addStructure, applyVillageAction, grantItems, type Structure } from './village'
import { PIECES, piece, type StructureType } from './pieces'
import { drainEvents } from './events'
import { cycleOffsetForStartHour, jourDeSaison, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, tourForDay, YEAR_DAYS } from './time'

const T = TEMPERATURE

/** Le cœur d'une saison, DÉRIVÉ de la cadence des actes (patron `temperature.test.ts`) : 15 / 45 /
 *  75 / 105 aujourd'hui. L'Ardeur est le plus chaud de l'année, le Grand Froid le plus froid. */
const coeurDe = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2
const ARDEUR = coeurDe(2)
const GRAND_FROID = coeurDe(4)

/**
 * UNE VALLÉE PLATE, À MIDI OU À MINUIT, UN JOUR DONNÉ.
 *
 * Terrain 9 (éboulis) : son `BIOME_OFFSET` vaut 0, donc l'air est le SOCLE nu — on isole la saison
 * et l'altitude. Échelle de calendrier 1 : un jour de saison vaut `TICKS_PER_SEASON_DAY` ticks, qui
 * est un multiple entier de `TICKS_PER_CYCLE` — l'heure ne bouge donc pas quand on change de jour.
 */
function simPlate(options: { heure?: number; jour?: number; paliers?: boolean; meteo?: boolean } = {}): SimState {
  const heure = options.heure ?? 12
  const state = createSim(1, {
    calendarScale: 1,
    cycleOffset: cycleOffsetForStartHour(heure, 1),
    // `exactOptionalPropertyTypes` : une clé présente à `undefined` n'est pas une clé absente.
    ...(options.meteo === true ? { meteoActive: true } : {}),
  })
  const n = state.map.width * state.map.height
  state.map.terrain = new Array(n).fill(9)
  if (options.paliers) {
    // Une bande de palier par quatre lignes — le montage de `temperature.test.ts`, repris tel quel.
    const { width, height } = state.map
    const palier: number[] = new Array(width * height)
    for (let ty = 0; ty < height; ty++) {
      const p = Math.min(TERRASSES.PALIERS - 1, ty >> 2)
      for (let tx = 0; tx < width; tx++) palier[ty * width + tx] = p
    }
    state.map.palier = palier
  }
  if (options.jour !== undefined) state.tick = (options.jour - 1) * TICKS_PER_SEASON_DAY
  return state
}

/** La ligne du palier `p` dans la carte en paliers (4 lignes par palier : on prend la seconde). */
const ligneDuPalier = (p: number): number => p * 4 + 1

function spawn(state: SimState, x: number, y: number): Entity {
  const id = spawnEntity(state, x, y)
  return state.entities.find((e) => e.id === id)!
}

/** Le jour de saison ABSOLU d'un tour donné (le socle se creuse de tour en tour, `saisons.md` S12). */
const jourDuTour = (tour: number, jour: number): number => (tour - 1) * YEAR_DAYS + jour

describe('B-A1 — la demande ne se mord pas la queue : l’air de la demande ignore la braise', () => {
  it('une braise PLEINE, une braise VIDE et PAS de braise exigent le même nombre de crans', () => {
    // ⚠ C'est la garde de B-R5, et le piège qu'elle ferme a déjà été payé une fois ailleurs : si la
    // braise entrait dans l'air qu'elle lit, elle baisserait sa propre demande, la demande
    // remonterait en se vidant, et on aurait l'oscillation que `feu-station.md` S5 a écartée pour
    // l'attraction des Cendreux. Ici la preuve est directe : l'ÉTAT de la braise ne change pas la
    // demande, parce que `cransExiges` ne lit pas l'entité du tout.
    const state = simPlate({ jour: GRAND_FROID })
    const e = spawn(state, 5.5, 5.5)
    const nu = cransExiges(state, e.x, e.y, e.etage)
    expect(nu, 'la prémisse : cet air exige vraiment des crans').toBeGreaterThan(0)
    for (const [nom, braise] of [
      ['pleine', braiseNeuve()],
      ['vide', { niveau: 0, charge: 0 }],
      ['pleine au niveau 3', braiseNeuve(3)],
    ] as const) {
      e.braise = { ...braise }
      expect(cransExiges(state, e.x, e.y, e.etage), `braise ${nom}`).toBe(nu)
    }
    delete e.braise
    expect(cransExiges(state, e.x, e.y, e.etage), 'sans braise du tout').toBe(nu)
  })

  it('CONTRÔLE POSITIF — au pied d’un feu la demande tombe à 0, et sans lui elle remonte', () => {
    // ⚠ UN FEU, PAS UNE BALISE : la balise est l'étape 6 et n'existe pas encore. Ce que cette garde
    //   tient est la moitié de B-R5 qui est DÉJÀ écrite — « l'air de la demande inclut les feux » —,
    //   et c'est exactement le mécanisme dont la balise héritera (elle est un grand feu persistant).
    const state = simPlate({ jour: GRAND_FROID })
    expect(cransExiges(state, 5.5, 5.5), 'sans feu, le Grand Froid exige').toBeGreaterThan(0)
    state.structures.push({ id: 9100, type: 'fire', tx: 5, ty: 5, villageId: 0, hp: 100 } as never)
    expect(airDeLaDemande(state, 5.5, 5.5), 'la bulle du feu rend cet air doux').toBeGreaterThanOrEqual(T.AMBIANT_DOUX)
    expect(cransExiges(state, 5.5, 5.5), 'au pied du feu, zéro cran demandé').toBe(0)
  })
})

describe('B-A2 — un étage vaut une saison, exactement', () => {
  it('① LA TABLE DE B-R4b : en hiver le palier k demande k+1 crans, en été il en demande k', () => {
    // ⚠ LA PRÉMISSE S'AFFIRME AVANT LA MESURE : on vérifie que la tuile lue est bien AU PALIER visé
    //   (`palierDuSol`, jamais `entity.etage` — qui est EFFACÉ au sol par `poserLEtageDuCorps`, donc
    //   un montage qui le poserait à la main passerait au vert sur une fonctionnalité morte).
    for (const [nom, jour, offset] of [['mi-Ardeur (été)', ARDEUR, 0], ['cœur du Grand Froid (hiver)', GRAND_FROID, 1]] as const) {
      const state = simPlate({ jour, paliers: true })
      for (let p = 0; p < TERRASSES.PALIERS; p++) {
        const ty = ligneDuPalier(p)
        expect(palierDuSol(state.map, 5, ty), `la prémisse : la ligne ${ty} est au palier ${p}`).toBe(p)
        expect(cransExiges(state, 5.5, ty + 0.5), `${nom}, palier ${p}`).toBe(p + offset)
      }
    }
  })

  it('② L’ÉGALITÉ QUI **EST** LA LOI : hiver au palier k = été au palier k+1', () => {
    // Si elle casse, `FROID_PAR_ETAGE` a divergé de l'amplitude du SOCLE — et « un étage vaut une
    // saison » n'est plus vrai. C'est la seule moitié de B-R4b que `balance.ts` ne peut pas écrire :
    // `CRAN_DEGRES` y est lié à `FROID_PAR_ETAGE` par construction, mais que 28 soit AUSSI
    // l'amplitude de l'année ne se prouve qu'en exécutant la courbe.
    const hiver = simPlate({ jour: GRAND_FROID, paliers: true })
    const ete = simPlate({ jour: ARDEUR, paliers: true })
    for (let p = 0; p < TERRASSES.PALIERS - 1; p++) {
      expect(
        cransExiges(hiver, 5.5, ligneDuPalier(p) + 0.5),
        `hiver p${p} doit valoir été p${p + 1}`,
      ).toBe(cransExiges(ete, 5.5, ligneDuPalier(p + 1) + 0.5))
    }
    // Et l'amplitude elle-même, lue sur la courbe : c'est elle qui porte l'égalité ci-dessus.
    const amplitude = socleDuJour(ARDEUR, tourForDay(ARDEUR)) - socleDuJour(GRAND_FROID, tourForDay(GRAND_FROID))
    expect(amplitude, 'l’amplitude de l’année EST le prix d’un étage').toBe(BRAISE.CRAN_DEGRES)
  })

  it('③ MONOTONIE : plus haut exige toujours au moins autant, l’année entière, jour et nuit', () => {
    for (const heure of [12, 0]) {
      const state = simPlate({ heure, paliers: true })
      let vus = 0
      for (let jour = 1; jour <= YEAR_DAYS; jour++) {
        state.tick = (jour - 1) * TICKS_PER_SEASON_DAY
        for (let p = 1; p < TERRASSES.PALIERS; p++) {
          const bas = cransExiges(state, 5.5, ligneDuPalier(p - 1) + 0.5)
          const haut = cransExiges(state, 5.5, ligneDuPalier(p) + 0.5)
          expect(haut, `${heure}h jour ${jour} : p${p} (${haut}) < p${p - 1} (${bas})`).toBeGreaterThanOrEqual(bas)
          if (haut > bas) vus++
        }
      }
      // ⚠ NON-VACUITÉ : si l'altitude ne changeait JAMAIS la demande, la monotonie serait triviale.
      expect(vus, `${heure}h : des paires où l’altitude exige STRICTEMENT plus`).toBeGreaterThan(100)
    }
  })

  it('CONTRÔLE NÉGATIF — un corps à deux crans laissé au palier 2 en hiver MEURT vraiment', () => {
    // Sans lui, toute la table ci-dessus pourrait être juste pendant que le déficit ne fait rien :
    // « on meurt rapidement au troisième » doit se vérifier sur un corps, pas sur un chiffre.
    const state = simPlate({ jour: GRAND_FROID, paliers: true })
    const ty = ligneDuPalier(2)
    const e = spawn(state, 5.5, ty + 0.5)
    expect(cransExiges(state, e.x, e.y), 'la prémisse : ce palier exige trois crans').toBe(3)
    expect(cransMax(e.braise!.niveau), 'et la braise de départ n’en couvre que deux').toBe(2)
    let mort = -1
    for (let i = 0; i < 30000 && mort < 0; i++) {
      advanceTemperature(state)
      if (e.hp <= 0) mort = i
    }
    expect(mort, 'il meurt, et pas au premier tick (on SE MET à mourir)').toBeGreaterThan(1000)
    // …et il lui restait de la braise : ce n'est pas la barre vide qui l'a tué, c'est le déficit.
    expect(cransCouverts(e.braise!), 'un cran couvrait encore').toBeGreaterThan(0)
  })
})

describe('B-R6 — le corps lit le DÉFICIT, et une braise qui couvre le sauve vraiment', () => {
  /** Le corps après `n` ticks de froid, dans cette vallée, avec cette braise. */
  function corpsApres(braise: Braise | undefined, jour: number, heure: number, palier: number, n: number): Entity {
    const state = simPlate({ jour, heure, paliers: true })
    const e = spawn(state, 5.5, ligneDuPalier(palier) + 0.5)
    if (braise === undefined) delete e.braise
    else e.braise = braise
    for (let i = 0; i < n; i++) advanceTemperature(state)
    return e
  }

  it('la nuit d’hiver en plaine : COUVERT on ne refroidit pas d’un degré, À VIDE on meurt', () => {
    // ⚠ C'est la garde que les quatre critères ci-dessus ne portent PAS : ils éprouvent la demande,
    //   la barre et la vidange — pas le fait que couvrir serve à quelque chose. Les deux moitiés
    //   sont dans le même test parce que l'une est le contrôle de l'autre.
    const nuit = simPlate({ jour: GRAND_FROID, heure: 0, paliers: true })
    expect(cransExiges(nuit, 5.5, ligneDuPalier(0) + 0.5), 'la prémisse : la plaine exige un cran la nuit d’hiver').toBe(1)

    // 10 000 ticks : la dérive est un EXPONENTIEL de constante `K_DRIFT` (0,0002), donc il faut
    // ~6 500 ticks pour qu'un corps parti de 37 atteigne l'hypothermie en visant 26 — à 5 000 il
    // est encore à 30,0 et la garde rougissait pour une bonne raison (ma première version).
    const couvert = corpsApres(braiseNeuve(), GRAND_FROID, 0, 0, 10000)
    expect(couvert.temperature, 'couvert : le corps tient ses 37').toBe(T.CORPS_SAIN)
    expect(couvert.hp, 'et il ne prend rien').toBe(100)
    expect(cransCouverts(couvert.braise!), 'il lui reste un cran — c’est lui qui paie').toBe(1)

    const vide = corpsApres({ niveau: 0, charge: 0 }, GRAND_FROID, 0, 0, 10000)
    expect(vide.temperature, 'à vide : le corps descend').toBeLessThan(T.CORPS_HYPOTHERMIE)
    expect(vide.hp, 'et le froid mord').toBeLessThan(100)
  })

  it('AU SOMMET À VIDE, on SE MET à mourir — on ne meurt pas au premier tick (B-R6)', () => {
    // ⚠ LA GARDE DE LA BORNE DU MODÈLE DU CORPS. L'air du palier 3 en hiver vaut −86 °C ; si le
    //   corps le lisait, la VITESSE de dérive (proportionnelle à l'écart) exploserait et on
    //   mourrait instantanément. Il ne lit qu'un déficit, re-borné par `clampTemp` : le pire air du
    //   jeu, et pas un degré de moins. « On meurt rapidement » se lit *rapidement*, pas
    //   *instantanément* — et c'est ce qui donne au repli le temps d'être une décision.
    const sommet = simPlate({ jour: GRAND_FROID, paliers: true })
    const p = TERRASSES.PALIERS - 1
    expect(cransExiges(sommet, 5.5, ligneDuPalier(p) + 0.5), 'la prémisse : le sommet exige quatre crans').toBe(4)
    expect(airDeLaDemande(sommet, 5.5, ligneDuPalier(p) + 0.5), 'et son air est bien hors de l’échelle du corps').toBeLessThan(T.AMBIANT_MIN)

    const e = corpsApres({ niveau: 0, charge: 0 }, GRAND_FROID, 12, p, 100)
    expect(e.hp, 'cent ticks (cinq secondes) : il est encore debout').toBe(100)
    expect(e.temperature, 'mais il a commencé à descendre').toBeLessThan(T.CORPS_SAIN)
    // Et il ne descend pas plus vite qu'au pire air BORNÉ : le déficit sature, il n'emballe rien.
    const plancher = corpsApres({ niveau: 0, charge: 0 }, GRAND_FROID, 12, 2, 100)
    expect(e.temperature, 'le sommet ne refroidit pas plus vite que le palier 2 à vide').toBe(plancher.temperature)
  })
})

describe('B-A3 — la barre se vide du haut, d’un cran à la fois', () => {
  it('en vidange continue, `cransCouverts` perd 1 exactement à chaque multiple de DUREE_CRAN', () => {
    const state = simPlate({ jour: GRAND_FROID })
    const e = spawn(state, 5.5, 5.5)
    expect(cransExiges(state, e.x, e.y), 'la prémisse : la vidange court').toBeGreaterThan(0)
    const braise = e.braise!
    expect(braise.charge).toBe(chargePleine(0))
    let precedent = cransCouverts(braise)
    expect(precedent).toBe(2)
    const chutes: number[] = []
    for (let i = 1; i <= chargePleine(0); i++) {
      advanceTemperature(state)
      const n = cransCouverts(braise)
      // ⚠ JAMAIS DEUX D'UN COUP, et jamais à la hausse : la barre est monotone décroissante.
      expect(n, `tick ${i}`).toBeLessThanOrEqual(precedent)
      expect(precedent - n, `tick ${i} : une chute de ${precedent - n} crans`).toBeLessThanOrEqual(1)
      if (n < precedent) chutes.push(i)
      // ⚠ **LA CHARGE RESTE ENTIÈRE, À CHAQUE TICK** (invariant n°2 : la barre doit être exacte au
      //   bit entre moteurs JS). C'est la seule garde qui le voie : B-A10 compare deux runs du MÊME
      //   processus, donc une charge devenue flottante y serait flottante à l'identique.
      expect(Number.isInteger(braise.charge), `tick ${i} : charge ${braise.charge}`).toBe(true)
      precedent = n
      if (n === 0 && braise.charge === 0) break
    }
    // Deux chutes, aux deux premiers ticks de chaque cran — c'est `floor` : un cran ne vaut que
    // plein, donc le premier tick de froid fait déjà tomber le compte de 2 à 1.
    expect(chutes, 'les deux chutes tombent aux multiples de DUREE_CRAN').toEqual([1, BRAISE.DUREE_CRAN + 1])
    expect(braise.charge, 'la barre finit vide').toBe(0)
  })

  it('les deux nombres qui RENDENT la barre entière (invariant n°2)', () => {
    // La charge ne peut rester entière que si ces deux-là le sont : un `DUREE_CRAN` fractionnaire
    // (un `ticksForCycles` qui cesserait d'arrondir) ou une vidange fractionnaire suffiraient à
    // faire diverger deux moteurs JS sur la barre. Le test du dessus les éprouve EN MARCHE ; ceux-ci
    // le disent à la source, là où un réglage se change.
    expect(Number.isInteger(BRAISE.DUREE_CRAN)).toBe(true)
    expect(BRAISE.VIDANGE_PAR_TICK).toBe(1)
    expect(Number.isInteger(chargePleine(3))).toBe(true)
  })

  it('AUCUN MONSTRE NE PORTE DE BRAISE — ni à la naissance, ni au premier tick', () => {
    // ⚠ Deux commentaires de `sim.ts` l'affirment et rien ne le testait. L'invariant tient à une
    //   COÏNCIDENCE NUMÉRIQUE — aucun sac de `MONSTER_DEFS` ne vaut `SLOTS.PLAYER` — et à l'écart
    //   des monstres par `monsterIds` dans la boucle du froid. Un sac de monstre qui tomberait par
    //   hasard sur la valeur du joueur, ou un `monsterIds` qu'on oublierait, passerait sans bruit.
    const state = simPlate({ jour: GRAND_FROID }) // le froid MORD : la vidange court
    const moi = spawn(state, 5.5, 5.5)
    const types = Object.keys(MONSTER_DEFS) as (keyof typeof MONSTER_DEFS)[]
    for (const [k, type] of types.entries()) spawnMonster(state, type, 10.5 + k, 10.5)
    expect(state.monsters.length, 'la prémisse : la population existe').toBe(types.length)
    const porteurs = () => state.entities.filter((e) => e.braise !== undefined).map((e) => e.id)
    expect(porteurs(), 'à la naissance').toEqual([moi.id])
    for (let t = 0; t < 500; t++) {
      state.tick++
      advanceTemperature(state)
    }
    expect(porteurs(), 'et après 500 ticks de froid').toEqual([moi.id])
    expect(moi.braise!.charge, 'contrôle positif : la vidange a bien couru').toBeLessThan(chargePleine(0))
  })
})

describe('B-A4 — la laisse vaut `(N − d) × T`, et zéro quand la demande égale les crans', () => {
  /** Les ticks de froid tenus avant le DÉFICIT, mesurés sur la vraie passe de tick. */
  function ticksAvantDeficit(niveau: number, palier: number, jour: number): number {
    const state = simPlate({ jour, paliers: true })
    const ty = ligneDuPalier(palier)
    const e = spawn(state, 5.5, ty + 0.5)
    e.braise = braiseNeuve(niveau)
    const d = cransExiges(state, e.x, e.y)
    let tenu = 0
    for (let i = 0; i < chargePleine(niveau) + 2; i++) {
      advanceTemperature(state)
      if (cransCouverts(e.braise) < d) break
      tenu++
    }
    return tenu
  }

  it('la table, au tick près — et `d = N` ne donne AUCUN répit (B-R7b)', () => {
    // ⚠ MI-ARDEUR : au cœur de l'été, le palier `k` exige exactement `k` crans (B-R4b), donc le
    //   montage se lit « demande d = palier ». C'est ce qui permet de balayer `d` sans toucher à
    //   autre chose que l'altitude.
    for (const niveau of [0, 1]) {
      const N = cransMax(niveau)
      for (let d = 1; d <= 3; d++) {
        const attendu = d >= N ? 0 : (N - d) * BRAISE.DUREE_CRAN
        expect(ticksAvantDeficit(niveau, d, ARDEUR), `N=${N}, d=${d}`).toBe(attendu)
      }
    }
  })
})

describe('B-A5 — zéro demande, zéro vidange (B-R8)', () => {
  const TICKS = 2000

  it('l’été en bas, une grotte et le pied d’un feu ne coûtent RIEN ; le froid, lui, coûte', () => {
    // ① L'ÉTÉ EN BAS — l'air est au-dessus du doux, la demande est nulle.
    const ete = simPlate({ jour: ARDEUR })
    const e1 = spawn(ete, 5.5, 5.5)
    expect(cransExiges(ete, e1.x, e1.y), 'la prémisse : zéro cran demandé').toBe(0)
    for (let i = 0; i < TICKS; i++) advanceTemperature(ete)
    expect(e1.braise!.charge, 'l’été ne coûte pas un tick de braise').toBe(chargePleine(0))

    // ② UNE GROTTE — 13 °C fixes, quelle que soit la saison dehors (`GROTTE_AMBIANT`).
    const grotte = simPlate({ jour: GRAND_FROID })
    const i0 = 5 * grotte.map.width + 5
    grotte.map.etages = [{ niveau: -1, idx: [i0], terrain: [9], x0: 5, y0: 5, x1: 6, y1: 6 }]
    const e2 = spawn(grotte, 5.5, 5.5)
    e2.etage = -1
    expect(airDeLaDemande(grotte, 5.5, 5.5, -1), 'la prémisse : l’air de la grotte').toBe(T.GROTTE_AMBIANT)
    expect(cransExiges(grotte, 5.5, 5.5, -1), 'donc zéro cran').toBe(0)
    for (let i = 0; i < TICKS; i++) advanceTemperature(grotte)
    expect(e2.braise!.charge, 'la grotte ne coûte pas un tick de braise').toBe(chargePleine(0))

    // ③ AU PIED D'UN FEU — en plein Grand Froid, la bulle suffit (ce dont la balise héritera).
    const camp = simPlate({ jour: GRAND_FROID })
    camp.structures.push({ id: 9101, type: 'fire', tx: 5, ty: 5, villageId: 0, hp: 100 } as never)
    const e3 = spawn(camp, 5.5, 5.5)
    expect(cransExiges(camp, e3.x, e3.y), 'la prémisse : le feu annule la demande').toBe(0)
    for (let i = 0; i < TICKS; i++) advanceTemperature(camp)
    expect(e3.braise!.charge, 'le camp ne coûte pas un tick de braise').toBe(chargePleine(0))

    // ④ AU PIED D'UNE BALISE ALLUMÉE — la clause que B-A5 nomme, et qui n'était pas écrivable
    //    avant l'étape 6. ⚠ AVEC UNE BRAISE PLEINE, exprès : sous B-R9, une braise ENTAMÉE
    //    REMONTE ici (c'est B-A6), donc seule la pleine peut affirmer « inchangée ».
    const balise = simPlate({ jour: GRAND_FROID })
    addStructure(balise, 'balise', 5, 5, 0, 1).allumee = true
    const e5 = spawn(balise, 6.5, 5.5)
    expect(cransExiges(balise, e5.x, e5.y), 'la prémisse : le plateau annule la demande').toBe(0)
    for (let i = 0; i < TICKS; i++) advanceTemperature(balise)
    expect(e5.braise!.charge, 'la balise ne coûte pas un tick, et ne déborde pas').toBe(chargePleine(0))

    // ⚠ CONTRÔLE POSITIF, dans le même test : sans rien de tout ça, elle se vide bien — sinon les
    //   trois égalités ci-dessus seraient vraies d'une vidange qui ne marche pas du tout.
    const froid = simPlate({ jour: GRAND_FROID })
    const e4 = spawn(froid, 5.5, 5.5)
    for (let i = 0; i < TICKS; i++) advanceTemperature(froid)
    expect(e4.braise!.charge, 'le Grand Froid à découvert, lui, coûte').toBe(chargePleine(0) - TICKS)
  })
})

describe('B-A10 — déterminisme et sauvegarde', () => {
  it('même graine, mêmes inputs ⇒ même braise au bit près', () => {
    const run = (): string => {
      const state = simPlate({ jour: GRAND_FROID })
      spawn(state, 5.5, 5.5)
      for (let i = 0; i < 300; i++) step(state, [])
      return JSON.stringify(state.entities.map((e) => e.braise))
    }
    const a = run()
    expect(a).toContain('charge')
    expect(run()).toBe(a)
  })

  it('UNE SAUVEGARDE D’AVANT LA BRAISE se relit, tourne un tick, et reçoit une braise pleine', () => {
    // ⚠ C'est la garde de B-R2 : les gardes de sauvegarde ne voient que la RACINE du `SimState`,
    //   donc un champ requis sur `Entity` aurait fait jeter toute vallée en cours au premier tick.
    //   On FABRIQUE l'ancien monde (une entité sans le champ) plutôt que de supposer qu'il se relit.
    const avant = simPlate({ jour: GRAND_FROID })
    const e = spawn(avant, 5.5, 5.5)
    delete e.braise
    const json = serializeSim(avant)
    expect(json, 'la sauvegarde fabriquée ne porte pas le champ').not.toContain('"braise"')
    const relu = deserializeSim(json)
    expect(relu, 'elle se relit').not.toBeNull()
    const corps = relu!.entities[0]!
    expect(corps.braise, 'et elle arrive sans braise').toBeUndefined()
    step(relu!, [])
    expect(corps.braise, 'le premier tick lui en pose une').toBeDefined()
    expect(cransMax(corps.braise!.niveau)).toBe(BRAISE.CRANS_DEPART)
    // Pleine à un tick de vidange près (le Grand Froid exige, donc ce tick-là a déjà coûté).
    expect(corps.braise!.charge).toBeGreaterThanOrEqual(chargePleine(0) - 1)
  })

  it('UNE SAUVEGARDE QUI PORTE LE CHAMP le rend au bit, et la vidange reprend où elle en était', () => {
    // L'autre moitié du tour : la garde du dessus fabrique le monde d'AVANT, celle-ci éprouve le
    // monde d'APRÈS. Un niveau d'arbre et une charge à mi-cran — ni le plein, ni zéro, ni un
    // multiple de `DUREE_CRAN` : les trois valeurs qu'un bug d'arrondi rendrait quand même.
    const monde = simPlate({ jour: GRAND_FROID })
    const e = spawn(monde, 5.5, 5.5)
    e.braise = { niveau: 2, charge: 12_345 }
    const relu = deserializeSim(serializeSim(monde))
    expect(relu).not.toBeNull()
    const corps = relu!.entities[0]!
    expect(corps.braise, 'le champ traverse le JSON au bit').toEqual({ niveau: 2, charge: 12_345 })
    step(relu!, [])
    expect(corps.braise!.charge, 'et la vidange reprend d’UN tick, pas d’un plein').toBe(12_344)
    expect(corps.braise!.niveau, 'le niveau ne se réinitialise pas en chemin').toBe(2)
  })
})

describe('B-A12 — la fenêtre du palier 1 est une loi, pas un effet de bord', () => {
  /** Les jours de l'année où le palier 1 est HABITABLE avec `cransMax` crans, au tour donné. */
  function fenetre(tour: number, heure: number, crans: number): number[] {
    const state = simPlate({ heure, paliers: true })
    const jours: number[] = []
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      state.tick = (jourDuTour(tour, jour) - 1) * TICKS_PER_SEASON_DAY
      if (cransExiges(state, 5.5, ligneDuPalier(1) + 0.5) <= crans) jours.push(jour)
    }
    return jours
  }

  it('elle existe, elle contient le cœur de l’Ardeur, et elle RÉTRÉCIT de tour en tour (S12)', () => {
    const crans = BRAISE.CRANS_DEPART - 1 // une braise pleine de 2 crans n'en couvre que 1 (B-R7b)
    const largeurs: number[] = []
    for (const heure of [12, 0]) {
      for (const tour of [1, 3, 6]) {
        const jours = fenetre(tour, heure, crans)
        expect(jours.length, `tour ${tour} à ${heure}h : la fenêtre existe`).toBeGreaterThan(0)
        expect(jours, `tour ${tour} à ${heure}h : elle contient le cœur de l’Ardeur`).toContain(ARDEUR)
        // Elle est d'un seul morceau : la saison est une marée, pas un clignotement.
        expect(jours[jours.length - 1]! - jours[0]! + 1, `tour ${tour} à ${heure}h : d’un seul tenant`).toBe(jours.length)
      }
      const l = [1, 3, 6].map((tour) => fenetre(tour, heure, crans).length)
      largeurs.push(...l)
      // MONOTONE DÉCROISSANTE, et STRICTEMENT entre le premier tour et le dernier.
      expect(l[1], `${heure}h : le tour 3 ne doit pas être plus large que le tour 1`).toBeLessThanOrEqual(l[0]!)
      expect(l[2], `${heure}h : le tour 6 ne doit pas être plus large que le tour 3`).toBeLessThanOrEqual(l[1]!)
      expect(l[2], `${heure}h : et le tour 6 est STRICTEMENT plus serré que le tour 1`).toBeLessThan(l[0]!)
    }
    // ⚠ ET LA NUIT EST PLUS SERRÉE QUE LE JOUR, à tour égal : sans ça la fenêtre serait celle d'un
    //   air moyen, et le montage ne verrait pas l'écart nocturne.
    expect(largeurs[3], 'la nuit du tour 1 est plus serrée que son jour').toBeLessThan(largeurs[0]!)
  })
})

describe('l’arithmétique de la barre (B-R3, B-R7b)', () => {
  it('`cransCouverts` est `floor`, borné, et un cran ne vaut que PLEIN', () => {
    const b: Braise = { niveau: 0, charge: chargePleine(0) }
    expect(cransCouverts(b)).toBe(2)
    b.charge -= 1
    expect(cransCouverts(b), 'un seul tick de froid, et le cran du haut ne compte plus').toBe(1)
    b.charge = BRAISE.DUREE_CRAN
    expect(cransCouverts(b)).toBe(1)
    b.charge = BRAISE.DUREE_CRAN - 1
    expect(cransCouverts(b)).toBe(0)
    b.charge = 0
    expect(cransCouverts(b)).toBe(0)
    // ⚠ BORNÉ PAR LE HAUT : une charge aberrante (un item de debug, une sauvegarde bricolée) ne
    //   doit pas rendre plus de crans que l'arbre n'en a donné.
    b.charge = chargePleine(0) * 10
    expect(cransCouverts(b)).toBe(cransMax(0))
    expect(cransCouverts({ niveau: 0, charge: -1 }), 'ni moins que zéro').toBe(0)
  })

  it('le niveau de l’arbre est le SEUL levier du nombre de crans (B-R14)', () => {
    for (const niveau of [0, 1, 2, 3]) {
      expect(cransMax(niveau)).toBe(BRAISE.CRANS_DEPART + niveau)
      expect(chargePleine(niveau)).toBe(cransMax(niveau) * BRAISE.DUREE_CRAN)
      expect(cransCouverts(braiseNeuve(niveau)), 'une braise neuve est PLEINE').toBe(cransMax(niveau))
    }
  })

  it('UN CRAN DE RETARD VAUT LA NUIT D’HIVER EN PLAINE — la calibration de DEFICIT_DEGRES', () => {
    // ⚠ Le seul nombre de `BRAISE` qui soit une calibration contre le MONDE : la spec dit « un cran
    //   de retard vaut la nuit d'hiver létale d'aujourd'hui en plaine ». On le relit sur la vallée,
    //   pas sur la constante — un `SOCLE` ou un `ECART_NUIT` retouché doit faire rougir ICI.
    const nuit = simPlate({ heure: 0, jour: GRAND_FROID })
    const airReel = airDeLaDemande(nuit, 5.5, 5.5)
    const unCranDeRetard = T.AMBIANT_DOUX - BRAISE.DEFICIT_DEGRES
    expect(Math.abs(unCranDeRetard - airReel), `un cran (${unCranDeRetard} °C) contre la nuit d’hiver (${airReel} °C)`).toBeLessThan(1)
    // Et il est LÉTAL : c'est tout l'objet de la calibration.
    expect(unCranDeRetard).toBeLessThan(T.AMBIANT_DOUX)
    expect(TEMPERATURE.AMBIANT_DOUX - (T.CORPS_SAIN - T.CORPS_HYPOTHERMIE) / T.PENTE_CORPS).toBeGreaterThan(unCranDeRetard)
  })
})

describe('B-R11, moitié BRAISE — se relever rend une braise PLEINE, au niveau atteint', () => {
  it('la mort prend la charge, pas l’échelle — et la nuit qui vient de tuer ne retue pas', () => {
    // ⚠ **POURQUOI CETTE MOITIÉ D'ÉTAPE 9 EST ICI** : une braise ne se recharge qu'à une balise
    //   allumée (B-R9), qui est l'étape 6 — donc entre l'étape 4 et elle, se relever avec une braise
    //   vide rouvre la nuit qui vient de tuer. MESURÉ sur le monde JOUÉ avant cette ligne (graine
    //   2026, au point de naissance, aucun input, météo éteinte) : premier mort au jour 67, puis
    //   QUATRE morts en quatorze jours, à 8 000-31 000 ticks d'intervalle.
    const nuit = simPlate({ heure: 0, jour: GRAND_FROID })
    const moi = spawn(nuit, 5.5, 5.5)
    moi.braise = { niveau: 2, charge: 0 } // une braise d'arbre (niveau 2), VIDE
    expect(cransExiges(nuit, moi.x, moi.y), 'la prémisse : cette nuit-là EXIGE un cran').toBe(1)
    // On meurt de froid — le mécanisme lui-même est prouvé par `temperature.test.ts` ; ici on veut
    // seulement un corps à terre.
    moi.temperature = T.CORPS_MORTEL
    moi.hp = 0.2
    advanceTemperature(nuit)
    expect(moi.downedAt, 'la prémisse : on est bien à terre').toBe(nuit.tick)

    expect(respawn(nuit, moi)).toBe(true)
    expect(moi.braise!.niveau, 'l’échelle traverse la mort (B-R11)').toBe(2)
    expect(moi.braise!.charge, 'la charge repart au plein').toBe(chargePleine(2))
    expect(cransCouverts(moi.braise!)).toBe(cransMax(2))

    // LE POINT : le corps relevé TIENT la même nuit. Dix mille ticks — la dérive est exponentielle
    // (`K_DRIFT`), il en faut ~6 500 pour tomber de 37 à l'hypothermie.
    for (let t = 0; t < 10_000; t++) {
      nuit.tick++
      advanceTemperature(nuit)
    }
    expect(moi.temperature, 'couvert, il tient 37 °C').toBe(T.CORPS_SAIN)
    expect(moi.hp).toBe(COMBAT.RESPAWN_HP)

    // ⚠ CONTRÔLE POSITIF — c'est bien la braise rendue qui le sauve, pas le montage : on la vide à
    //   la main (le corps que `respawn` rendait AVANT cette ligne) et la même nuit le reprend.
    moi.braise = { niveau: 2, charge: 0 }
    for (let t = 0; t < 10_000; t++) {
      nuit.tick++
      advanceTemperature(nuit)
    }
    expect(moi.temperature, 'vidée, la même nuit le reprend').toBeLessThan(T.CORPS_HYPOTHERMIE)
    expect(moi.hp).toBeLessThan(COMBAT.RESPAWN_HP)
  })
})

describe('LA MÉTÉO NE PEUT QUE MONTER LA DEMANDE — et sous un orage, un palier devient le suivant', () => {
  /**
   * ⚠ **LE TROU QUE CE BLOC BOUCHE.** Les vingt autres gardes de ce fichier montent leur monde
   * `meteoActive` à faux (voir l'en-tête) : l'affirmation écrite dans `cransExiges` — *« un orage au
   * palier 1 en fait un endroit de palier 2 »* — n'avait **aucun test**, dans aucun des deux sens.
   * C'est exactement le trou rapporté le 2026-10-02 sur les bornes de gel, au même endroit du
   * raisonnement : une inégalité que le code tient et qu'aucune preuve ne joue.
   *
   * Le front se pose comme dans `gel.test.ts` (même patron, mêmes raisons) : la fenêtre se LIT
   * (`fenetreDe`), elle ne s'écrit pas, et le tick tombe au CŒUR de la fenêtre — là où la bande
   * couvre la carte et où le froid du front est plein.
   */
  const poserFront = (state: SimState, type: MeteoFront['type'], edge: MeteoFront['edge']): void => {
    const day = jourDeSaison(state, state.tick)
    const fenetre = fenetreDe({ type, day })
    const startTick = state.tick - Math.floor(fenetre / 2)
    state.meteo = {
      type,
      cycle: Math.floor(startTick / TICKS_PER_CYCLE),
      day: jourDeSaison(state, startTick),
      edge,
      startTick,
      endTick: startTick + fenetreDe({ type, day: jourDeSaison(state, startTick) }),
    }
  }
  const CLASSES: MeteoFront['type'][] = ['pluie', 'brouillard', 'orage', 'vent_de_cendre']

  it('un front AJOUTE des crans ou n’en change aucun, jamais il n’en retire', () => {
    const montees = new Map<MeteoFront['type'], number>()
    let points = 0
    let baisses = 0
    for (const type of CLASSES) {
      let monte = 0
      for (const jour of [coeurDe(1), ARDEUR, coeurDe(3), GRAND_FROID]) {
        for (const heure of [12, 0]) {
          const sim = simPlate({ heure, jour, paliers: true, meteo: true })
          for (let p = 0; p < TERRASSES.PALIERS; p++) {
            const y = ligneDuPalier(p) + 0.5
            sim.meteo = null
            const sans = cransExiges(sim, 5.5, y)
            // Le front du jour, posé au cœur de sa fenêtre. `edge` 3 pour le vent de cendre : la
            // même convention que `gel.test.ts` (sa bande ne part pas du même bord).
            poserFront(sim, type, type === 'vent_de_cendre' ? 3 : 0)
            const avec = cransExiges(sim, 5.5, y)
            points++
            // ① LA LOI : la météo REFROIDIT, donc elle ne peut qu'exiger PLUS. Le contraire serait
            //   un front qui réchauffe — ce que `meteo.ts` interdit, et que rien ne vérifiait ici.
            expect(avec, `${type} jour ${jour} ${heure}h palier ${p}`).toBeGreaterThanOrEqual(sans)
            if (avec < sans) baisses++
            if (avec > sans) monte++
          }
        }
      }
      montees.set(type, monte)
    }
    expect(baisses).toBe(0)
    expect(points).toBe(CLASSES.length * 4 * 2 * TERRASSES.PALIERS)
    // ② LA NON-VACUITÉ, et c'est elle qui rend ① autre chose qu'une tautologie : l'orage DÉPLACE
    //    vraiment des paliers. MESURÉ ce jour-là, sur les 32 points de ce balayage : **orage 24**,
    //    pluie 8, vent de cendre 8, brouillard 0 — et AUCUNE baisse, dans aucune classe. On affirme
    //    le signe et l'ordre, pas le compte : les comptes sont un calibrage (`METEO.COLD`).
    expect(montees.get('orage'), 'l’orage monte la demande quelque part').toBeGreaterThan(0)
    expect(montees.get('orage')!, 'et plus souvent que la pluie — 22 °C contre 4').toBeGreaterThan(montees.get('pluie')!)
    // ③ CONTRÔLE NÉGATIF — le brouillard ne porte pas de froid (`METEO.COLD.brouillard` = 0) : il
    //    ne doit JAMAIS déplacer un cran. Une garde qui verrait tout monter mesurerait son montage.
    expect(montees.get('brouillard'), 'le brouillard ne refroidit pas').toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//   LA BALISE (étape 6) — B-A6, B-A7, et la loi ⓒ d'Alexis : « doux garanti dans tout le rayon »
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * UNE BALISE POSÉE PAR LA VRAIE PORTE (`addStructure`), donc avec son bois de naissance et sans
 * ancre de combustion — c'est l'état exact d'une balise qu'un joueur vient de poser.
 *
 * `allumee` se donne à la main ici plutôt que par l'action : les gardes de cette section éprouvent
 * la RECHARGE et la CHALEUR, pas le geste (B-A7 et le rejeu, eux, passent par l'action).
 */
function poserBalise(state: SimState, tx: number, ty: number, options: { allumee?: boolean; etage?: number } = {}): Structure {
  const s = addStructure(state, 'balise', tx, ty, 0, 1, 'private', undefined, undefined, options.etage)
  if (options.allumee === true) s.allumee = true
  return s
}

describe('B-A6 — seule une balise ALLUMÉE recharge', () => {
  /** Une braise ENTAMÉE : c'est la seule qui puisse montrer une recharge (une pleine est déjà au
   *  plafond, et affirmer son immobilité ne prouverait rien). */
  const entamee = (): Braise => ({ niveau: 0, charge: chargePleine(0) - 10 * BRAISE.RECHARGE_PAR_TICK })

  it('la charge REMONTE dans le rayon d’une balise allumée, et par pas de RECHARGE_PAR_TICK', () => {
    const state = simPlate({ jour: GRAND_FROID })
    poserBalise(state, 5, 5, { allumee: true })
    const e = spawn(state, 6.5, 5.5) // à une tuile : dans le rayon, jamais sous la structure
    e.braise = entamee()
    const depart = e.braise.charge
    expect(cransExiges(state, e.x, e.y), 'la prémisse ⓐ : le plateau rend l’air DOUX, donc zéro cran').toBe(0)
    expect(rechargeDeBalise(state, e.x, e.y, e.etage), 'la prémisse ⓑ : on est bien dans le rayon').toBe(true)
    advanceTemperature(state)
    expect(e.braise.charge, 'un tick = un pas de recharge, exactement').toBe(depart + BRAISE.RECHARGE_PAR_TICK)
    for (let i = 0; i < 9; i++) advanceTemperature(state)
    expect(e.braise.charge, 'dix ticks suffisaient : la voilà pleine').toBe(chargePleine(0))
    for (let i = 0; i < 50; i++) advanceTemperature(state)
    expect(e.braise.charge, 'et ça ne DÉBORDE pas — `chargePleine` est le plafond').toBe(chargePleine(0))
  })

  it('elle ne bouge PAS : hors rayon, en braises, éteinte, ni près d’un feu qui n’est pas une balise', () => {
    const TICKS = 200
    // ⚠ CHAQUE CAS EST UN MONDE À LUI, et chacun doit être FROID : une charge immobile ne prouve
    //   rien si la demande est nulle par ailleurs (ce serait l'été qui tient la garde, pas le cas).
    const cas: [string, (s: SimState) => void, number, number][] = [
      // ① HORS RAYON — la balise est allumée, mais à plus de FIRE_RANGE : rien ne doit remonter.
      ['hors rayon', (s) => { poserBalise(s, 5, 5, { allumee: true }) }, 5 + T.FIRE_RANGE + 2.5, 5.5],
      // ② EN BRAISES — allumée, mais son bois est fini et la fenêtre de braises court (B-R9 au mot :
      //    « pas en braises »). Le cône atténué chauffe encore ; il ne recharge pas.
      ['en braises', (s) => {
        const b = poserBalise(s, 5, 5, { allumee: true })
        b.fuel = makeInventory(FIRE.FUEL_SLOTS) // plus une bûche
        b.emberUntil = s.tick + FIRE.EMBER_TICKS
      }, 6.5, 5.5],
      // ③ ÉTEINTE — bâtie, pleine de bois, jamais allumée. C'est B-R10 vu par la recharge.
      ['éteinte', (s) => { poserBalise(s, 5, 5) }, 6.5, 5.5],
      // ④ UN FEU DE CAMP — il chauffe (donc la vidange ne court pas), mais il ne recharge rien :
      //    « à une balise allumée, et NULLE PART AILLEURS ».
      ['un feu, pas une balise', (s) => { addStructure(s, 'fire', 5, 5, 0, 1) }, 6.5, 5.5],
    ]
    for (const [nom, monter, x, y] of cas) {
      const state = simPlate({ jour: GRAND_FROID })
      monter(state)
      const e = spawn(state, x, y)
      e.braise = entamee()
      const depart = e.braise.charge
      expect(rechargeDeBalise(state, e.x, e.y, e.etage), `${nom} : aucune recharge ici`).toBe(false)
      for (let i = 0; i < TICKS; i++) advanceTemperature(state)
      expect(e.braise.charge, `${nom} : la charge ne REMONTE pas`).toBeLessThanOrEqual(depart)
    }
  })

  it('CONTRÔLE POSITIF — les quatre cas ci-dessus sont bien FROIDS : la charge y descend ou tient', () => {
    // ⚠ CE QUE CE TEST FERME : « elle ne remonte pas » serait vrai d'une recharge en panne. On
    //   affirme donc le SIGNE de chaque cas, et il n'est pas le même partout — c'est ce qui prouve
    //   que le montage est vivant : hors rayon la braise se VIDE (rien ne couvre le Grand Froid),
    //   tandis qu'au pied d'un feu ou de braises elle TIENT (la bulle couvre, B-R8).
    const TICKS = 200
    const state = simPlate({ jour: GRAND_FROID })
    poserBalise(state, 5, 5, { allumee: true })
    const loin = spawn(state, 5 + T.FIRE_RANGE + 2.5, 5.5)
    loin.braise = entamee()
    const departLoin = loin.braise.charge
    const pres = spawn(state, 6.5, 5.5)
    pres.braise = entamee()
    for (let i = 0; i < TICKS; i++) advanceTemperature(state)
    expect(loin.braise.charge, 'hors rayon, le Grand Froid mord : elle se VIDE de TICKS').toBe(departLoin - TICKS)
    expect(pres.braise.charge, 'dans le rayon, elle est pleine : la recharge a bien tourné').toBe(chargePleine(0))
  })

  it('G-R7 — une balise de la TERRASSE ne recharge pas un corps dans la salle du dessous', () => {
    const state = simPlate({ jour: GRAND_FROID })
    const i0 = 5 * state.map.width + 5
    state.map.etages = [{ niveau: -1, idx: [i0], terrain: [9], x0: 5, y0: 5, x1: 6, y1: 6 }]
    poserBalise(state, 5, 5, { allumee: true }) // AU SOL : `etage` absent
    const dessous = spawn(state, 5.5, 5.5)
    dessous.etage = -1
    dessous.braise = entamee()
    const depart = dessous.braise.charge
    expect(rechargeDeBalise(state, 5.5, 5.5, -1), 'la roche arrête la recharge, comme la chaleur').toBe(false)
    for (let i = 0; i < 100; i++) advanceTemperature(state)
    expect(dessous.braise.charge, 'la grotte à 13 °C ne coûte rien et ne rend rien').toBe(depart)
    // CONTRÔLE POSITIF : le MÊME point, au SOL, recharge.
    expect(rechargeDeBalise(state, 5.5, 5.5), 'au sol, sous la balise, elle recharge').toBe(true)
  })
})

describe('la loi ⓒ (2026-10-03) — dans le rayon d’une balise allumée, il fait DOUX partout', () => {
  it('l’abri et la recharge COÏNCIDENT, tuile par tuile, là où le feu de camp a une falaise', () => {
    // ⚠ C'EST LA GARDE DE LA DÉCISION, et elle se lit en deux colonnes sur le MÊME rayon :
    //   le feu de camp garde son cône (zone gratuite = 57 % du rayon), la balise plancher le rayon
    //   ENTIER. L'implication qu'on affirme est la forme exacte de la décision d'Alexis :
    //   « recharge ⟺ demande nulle », donc un seul rayon pour les deux lois.
    const pas = 0.5
    const rayon = T.FIRE_RANGE
    const lire = (type: 'fire' | 'balise'): { gratuites: number; divergences: number; total: number } => {
      const state = simPlate({ jour: GRAND_FROID })
      // ⚠ LES DEUX FOYERS SE DONNENT LA FLAMME À LA MAIN DEPUIS B-R17 (2026-10-04) : tout foyer
      //   libre naît ÉTEINT, donc un `addStructure` nu ne chauffe plus rien et les deux colonnes
      //   de cette garde auraient lu 0 — un vert pour la mauvaise raison du côté balise, un rouge
      //   du côté feu. Ce qu'on éprouve ici est la GÉOMÉTRIE de deux foyers qui brûlent.
      if (type === 'balise') poserBalise(state, 5, 5, { allumee: true })
      else addStructure(state, 'fire', 5, 5, 0, 1).allumee = true
      let gratuites = 0
      let divergences = 0
      let total = 0
      for (let d = pas; d < rayon; d += pas) {
        const x = 5.5 + d
        total += 1
        const libre = cransExiges(state, x, 5.5) === 0
        if (libre) gratuites += 1
        // L'implication, dans les DEUX sens : une balise recharge exactement où elle affranchit.
        const recharge = rechargeDeBalise(state, x, 5.5)
        if (type === 'balise' && recharge !== libre) divergences += 1
        if (type === 'fire' && recharge) divergences += 1 // un feu ne recharge nulle part
      }
      return { gratuites, divergences, total }
    }
    const feu = lire('fire')
    const balise = lire('balise')
    expect(balise.divergences, 'balise : la recharge et la demande nulle coïncident, tuile par tuile').toBe(0)
    expect(feu.divergences, 'feu : il ne recharge nulle part, même là où il affranchit').toBe(0)
    expect(balise.gratuites, 'la balise affranchit TOUT son rayon').toBe(balise.total)
    // LA FALAISE DU FEU DE CAMP, mesurée et non supposée : elle existe, et elle est PLUS PETITE
    // que le rayon. La loi, pas le chiffre — `FIRE_WARMTH` est un nombre d'équilibrage.
    expect(feu.gratuites, 'le feu, lui, en affranchit moins').toBeLessThan(feu.total)
    expect(feu.gratuites, 'mais il en affranchit quand même — son cœur est chaud').toBeGreaterThan(0)
    const partFeu = feu.gratuites / feu.total
    expect(partFeu, 'et la part gratuite du feu reste celle de sa bulle linéaire (≈ 57 %, MESURÉ)')
      .toBeCloseTo(1 - T.AMBIANT_DOUX / T.FIRE_WARMTH, 1)
  })

  it('les BRAISES gardent le cône : le plateau est la promesse d’une balise ALLUMÉE', () => {
    // Sans cette garde, « doux partout » aurait pu être écrit sur `fireActive` (allumé OU braises)
    // et le combustible d'une balise n'aurait plus valu grand-chose.
    const state = simPlate({ jour: GRAND_FROID })
    const b = poserBalise(state, 5, 5, { allumee: true })
    const bord = 5.5 + T.FIRE_RANGE - 0.5 // dans le rayon, mais loin du centre
    expect(cransExiges(state, bord, 5.5), 'allumée : le bord du rayon est doux').toBe(0)
    b.fuel = makeInventory(FIRE.FUEL_SLOTS)
    b.emberUntil = state.tick + FIRE.EMBER_TICKS
    expect(fireState(state, b), 'la prémisse : elle est bien en BRAISES').toBe('ember')
    expect(cransExiges(state, bord, 5.5), 'en braises : le bord redevient froid').toBeGreaterThan(0)
  })
})

describe('le plateau ne sort PAS dans le monde de base (vérifié le 2026-10-03, un commentaire était faux)', () => {
  /**
   * ⚠ **CE QUE J'AVAIS ÉCRIT, ET QUI ÉTAIT FAUX** : « ce plateau sort par TOUS les lecteurs de
   * `fireBubble` — l'air du corps, l'air de la demande, l'éveil des Cendreux et la faune ». Les
   * deux derniers sont faux, et c'est STRUCTUREL : l'éveil lit `baselineTemperature` *hors feu*
   * (la note S5 de `feu-station.md` : sinon un Cendreux oscille à la lisière de la bulle) et
   * `faune.ts` ne lit aucune température. `fireBubble` n'a que trois appelants — `airDeLaDemande`
   * (la demande en crans), `ambientTemperature` (plus aucun appelant dans `/sim` : les deux
   * lectures du HUD) et `nighthunt.ts` (un prédicat `> 0`, INCHANGÉ au bit — le plateau ne fait
   * que monter une valeur déjà positive dans le rayon).
   *
   * Conséquence de jeu, et elle est voulue : **une balise allumée ne dégèle pas la glace de son
   * rayon et n'endort pas les Cendreux.** Elle couvre la DEMANDE d'un corps ; elle ne réchauffe
   * pas le monde.
   */
  it('la température de BASE est la même dedans et dehors, alors que la demande, elle, tombe à 0', () => {
    const state = simPlate({ jour: GRAND_FROID, heure: 0, paliers: true })
    const ty = ligneDuPalier(3) // le palier le plus froid : le gel y est certain à toute saison
    const loin = 5 + Math.ceil(T.FIRE_RANGE) + 3 // hors rayon, MÊME ligne donc même palier
    expect(loin, 'la tuile témoin tient dans la carte').toBeLessThan(state.map.width)
    // DE L'EAU de part et d'autre : un gué (seuil 0) dans le rayon, un gué témoin dehors.
    state.map.terrain[ty * state.map.width + 6] = 4
    state.map.terrain[ty * state.map.width + loin] = 4
    poserBalise(state, 5, ty, { allumee: true })
    // ⓐ LA PRÉMISSE : on est bien dans le rayon, et le plateau y est bien vu par la DEMANDE.
    expect(rechargeDeBalise(state, 6.5, ty + 0.5), 'prémisse : la tuile d’eau est dans le rayon').toBe(true)
    expect(cransExiges(state, 6.5, ty + 0.5), 'le plateau EST vu par la demande : zéro cran').toBe(0)
    expect(cransExiges(state, loin + 0.5, ty + 0.5), 'dehors, le palier 3 en Grand Froid exige des crans').toBeGreaterThan(0)
    expect(airDeLaDemande(state, 6.5, ty + 0.5), 'et l’air de la demande vaut le plancher doux').toBeGreaterThanOrEqual(T.AMBIANT_DOUX)
    // ⓑ LA LOI : le monde de base ne bouge pas d'un bit. C'est la clause SENSIBLE — elle rougirait
    //   si `fireBubble` entrait dans `baselineTemperature`, ou si `estGele` lisait l'air du corps.
    expect(baselineTemperature(state, 6.5, ty + 0.5), 'le froid de BASE ignore la balise').toBe(
      baselineTemperature(state, loin + 0.5, ty + 0.5),
    )
    expect(estGele(state, 6, ty), 'la glace du rayon TIENT').toBe(true)
    expect(estGele(state, loin, ty), 'comme celle du témoin').toBe(true)
    // ⓒ ET LE CADRAN DES CENDREUX NON PLUS — même valeur dedans et dehors, au bit.
    expect(eveilCendreuxAt(state, 6.5, ty + 0.5, state.tick), 'l’éveil lit le froid de base, hors feu').toBe(
      eveilCendreuxAt(state, loin + 0.5, ty + 0.5, state.tick),
    )
    expect(eveilCendreuxAt(state, 6.5, ty + 0.5, state.tick), 'et il est bien ÉVEILLÉ : la garde n’est pas vide').toBeGreaterThan(0)
  })
})

describe('B-A7 + B-A17 ② — le rallumage n’exige AUCUNE charge (B-R17 ②, la clause inversée)', () => {
  /** Le geste, par la VRAIE porte (l'action) : c'est elle qu'un joueur traverse. */
  const allumer = (state: SimState, e: Entity, s: Structure): void => {
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: { type: 'light_foyer', structureId: s.id } }])
  }

  it('B-A17 ② — une braise À 0 allume, exactement comme une braise pleine (la charge ne garde plus rien)', () => {
    // ⚠ LE VERDICT DE CETTE GARDE S'EST INVERSÉ LE 2026-10-04, et la garde est GARDÉE pour ça :
    //   elle affirmait `charge 0 ⇒ refus`, et ce refus fermait l'ascension pour de bon (mesuré :
    //   sans balise la charge tombe sous un cran au jour 67, et seule une balise ALLUMÉE recharge
    //   — la seule issue était de mourir). B-R17 ② le retire : la braise est la SOURCE du feu, pas
    //   son réservoir. C'est la décision du 2026-09-28 honorée au mot.
    for (const [nom, charge] of [['pleine', BRAISE.DUREE_CRAN], ['à 0', 0]] as const) {
      const state = simPlate({ jour: ARDEUR })
      const b = poserBalise(state, 5, 5)
      const e = spawn(state, 6.5, 5.5)
      e.braise = { niveau: 0, charge }
      expect(fireState(state, b), `${nom} : la prémisse — elle est éteinte`).toBe('out')
      allumer(state, e, b)
      expect(b.allumee, `braise ${nom} : la flamme est donnée`).toBe(true)
      expect(fireState(state, b), `braise ${nom} : elle brûle`).toBe('lit')
      expect(cransCouverts(e.braise!), `braise ${nom} : et allumer ne rend AUCUN cran`).toBe(cransCouverts({ niveau: 0, charge }))
    }
  })

  it('une balise SANS BOIS refuse la flamme — un refus lisible plutôt qu’un geste mort', () => {
    const state = simPlate({ jour: ARDEUR })
    const b = poserBalise(state, 5, 5)
    b.fuel = makeInventory(FIRE.FUEL_SLOTS)
    const e = spawn(state, 6.5, 5.5)
    allumer(state, e, b)
    expect(b.allumee, 'rien à brûler : la braise n’est pas dépensée pour rien').toBe(false)
  })

  it('allumer ne COÛTE rien à la braise (le patron de `light_torch`)', () => {
    const state = simPlate({ jour: ARDEUR })
    const b = poserBalise(state, 5, 5)
    const e = spawn(state, 6.5, 5.5)
    const avant = e.braise!.charge
    allumer(state, e, b)
    expect(b.allumee, 'la prémisse : elle s’est bien allumée').toBe(true)
    expect(e.braise!.charge, 'la charge est intacte — c’est une DÉCISION ouverte (§ 5)').toBe(avant)
  })

  it('CONTRÔLE POSITIF du geste — trop loin, ce n’est pas la charge qui refuse', () => {
    const state = simPlate({ jour: ARDEUR })
    const b = poserBalise(state, 5, 5)
    const e = spawn(state, 5.5 + BALANCE.INTERACT_RANGE + 2, 5.5)
    allumer(state, e, b)
    expect(b.allumee, 'la portée de bras garde le geste').toBe(false)
  })
})

describe('B-R17 — un foyer éteint ne brûle RIEN, et chaque extinction lui reprend la flamme', () => {
  const bois = (s: Structure): number => (s.fuel ? countOf(s.fuel, 'wood') : 0)

  it('éteinte, son bois de naissance est INTACT après une fenêtre de combustion entière', () => {
    // ⚠ LA GARDE LA PLUS IMPORTANTE DE L'ÉTAPE : sans elle, une balise bâtie brûlait ses dix bûches
    //   sans flamme et se trouvait VIDE le jour où l'on vient enfin l'allumer.
    const state = simPlate({ jour: ARDEUR })
    const b = poserBalise(state, 5, 5)
    const depart = bois(b)
    expect(depart, 'la prémisse : elle naît AVEC du bois').toBe(FIRE.FUEL_START_WOOD)
    expect(b.burnAt, 'et SANS ancre de combustion — sinon la première bûche partirait à l’allumage').toBeUndefined()
    // ⚠ LE TICK AVANCE À LA MAIN. `advanceFire` est UNE PHASE, pas un tour d'horloge : appelée mille
    //   fois au même tick, elle ne peut rien consumer (`tick >= burnAt + BURN_TICKS` reste faux) et
    //   la garde serait verte sur une mécanique morte. C'est le piège « une phase seule n'est pas un
    //   tick », et c'est ce test qui l'a attrapé.
    const brulerUneFenetre = (): void => {
      for (let i = 0; i < FIRE.BURN_TICKS + 10; i++) { state.tick += 1; advanceFire(state) }
    }
    brulerUneFenetre()
    expect(bois(b), 'pas une bûche consumée').toBe(depart)
    // CONTRÔLE POSITIF : la MÊME balise, allumée, brûle bien — donc l'horloge du montage tourne.
    b.allumee = true
    brulerUneFenetre()
    expect(bois(b), 'allumée, elle consume sa bûche').toBe(depart - 1)
  })

  it('le temps passé éteinte n’est pas FACTURÉ : on l’allume, et sa bûche brûle une fenêtre pleine', () => {
    const state = simPlate({ jour: ARDEUR })
    const b = poserBalise(state, 5, 5)
    const depart = bois(b)
    for (let i = 0; i < FIRE.BURN_TICKS * 3; i++) { state.tick += 1; advanceFire(state) }
    b.allumee = true
    advanceFire(state) // l'ancre se pose ICI (clause « Sécurité »)
    for (let i = 0; i < FIRE.BURN_TICKS - 2; i++) { state.tick += 1; advanceFire(state) }
    expect(bois(b), 'la fenêtre n’est pas écoulée : sa bûche tient encore').toBe(depart)
    state.tick += 2
    advanceFire(state)
    expect(bois(b), 'et elle finit à l’heure, pas trois fenêtres plus tôt').toBe(depart - 1)
  })

  it('les braises mortes REPRENNENT la flamme : du bois seul ne rallume pas une balise', () => {
    const state = simPlate({ jour: ARDEUR })
    const b = poserBalise(state, 5, 5, { allumee: true })
    b.fuel = makeInventory(FIRE.FUEL_SLOTS) // à sec
    b.emberUntil = state.tick + 5
    state.tick += 6 // les braises ont fini de rougir
    advanceFire(state)
    expect(b.allumee, 'la flamme est reprise, et ÉCRITE `false` — pas effacée (B-R18)').toBe(false)
    addItems(b.fuel!, { wood: 3 })
    advanceFire(state)
    expect(fireState(state, b), 'du bois dans une balise reprise ne la rallume pas').toBe('out')
    expect(bois(b), 'et ce bois-là ne part pas en fumée non plus').toBe(3)
  })

  it('UNE SAUVEGARDE D’AVANT LA BALISE se relit, et son Feu brûle exactement comme avant', () => {
    // ═══ LA DETTE DE B-R2, UN CHAMP PLUS LOIN — `Structure.allumee` (étape 6) ═══
    //
    // ⚠ Les gardes de `persistence.ts` NE VOIENT QUE LA RACINE du `SimState` (`SAVE_REQUIRED_KEYS`
    //   et un recollage SUPERFICIEL) : un champ neuf à l'intérieur d'un objet de LISTE les franchit
    //   toutes sans un mot. `Entity.braise` a sa garde deux `describe` plus haut ; `allumee` est né
    //   avec l'étape 6 et n'en avait aucune. Et son sinistre serait PIRE qu'un throw : la porte de
    //   combustion vit dans `advanceFire`, donc une porte mal cadrée n'aurait pas planté — elle
    //   aurait éteint EN SILENCE tous les feux de toutes les vallées sauvegardées.
    //
    // ⚠ CE QUI FERAIT ROUGIR CETTE GARDE, et la réponse a CHANGÉ le 2026-10-04 : la porte `allumee`
    //   n'est plus réservée à la balise (B-R17), donc ce qui la tient n'est plus le TYPE mais le
    //   DÉFAUT DÉRIVÉ de `flammeDonnee` (`s.allumee ?? !estBalise(s.type)`). Remplacer ce défaut
    //   par un `s.allumee === true` sec fait tomber les deux dernières clauses : le feu relu
    //   n'allumerait plus et ne consumerait plus une bûche. C'est LÀ qu'est la migration.
    const avant = simPlate({ jour: ARDEUR })
    spawn(avant, 5.5, 5.5)
    const feu = addStructure(avant, 'fire', 8, 8, 0, 1)
    // ⚠ LA PRÉMISSE NE SE FABRIQUE PLUS TOUTE SEULE DEPUIS B-R17 : `addStructure` écrit désormais
    //   `allumee: false` sur tout foyer libre, donc un feu neuf n'est PLUS « le monde d'avant ». On
    //   retire le champ à la main — c'est exactement ce que porte une sauvegarde d'avant la loi, et
    //   sans ce `delete` la garde éprouverait un feu moderne en croyant relire un ancien.
    delete feu.allumee
    // ⚠ ET IL MANQUAIT LA MOITIÉ DE LA PRÉMISSE, trouvé le 2026-10-04 en fermant la fenêtre d'un
    //   tick (B-A17 ⑧) : le pré-B-R17 `addStructure` donnait à tout feu libre ses dix bûches **ET
    //   L'ANCRE DE COMBUSTION** (`burnAt = tick`) — c'est même exactement ce qui faisait qu'un feu
    //   de camp naissait ALLUMÉ sans braise, la faille que B-R17 est venu fermer. Le `addStructure`
    //   d'aujourd'hui ne pose plus d'ancre nulle part, donc retirer `allumee` seul fabriquait une
    //   forme que le monde d'avant **ne produisait pas** : du bois, aucune ancre, aucune braise.
    //   Sans ces deux lignes la garde éprouvait un feu CHIMÉRIQUE, et c'est elle qui a rougi quand
    //   le droit de brûler s'est mis à regarder l'ancre.
    feu.burnAt = avant.tick
    feu.burnSlot = feu.fuel!.findIndex((sl) => sl !== null)
    // LES PRÉMISSES — sans elles on relirait un monde sans feu, et tout serait vert pour rien.
    expect(bois(feu), 'un feu libre naît AVEC son bois').toBe(FIRE.FUEL_START_WOOD)
    expect(feu.burnAt, 'et le monde d’avant lui posait son ancre à la naissance').toBeDefined()
    expect('allumee' in feu, 'et le monde d’avant n’a pas ce champ du tout').toBe(false)
    const json = serializeSim(avant)
    expect(json, 'la sauvegarde fabriquée ne porte pas le champ').not.toContain('"allumee"')

    const relu = deserializeSim(json)
    expect(relu, 'elle se relit').not.toBeNull()
    const feuRelu = relu!.structures.find((s) => s.type === 'fire')!
    expect(feuRelu.allumee, 'le feu arrive sans le champ').toBeUndefined()
    // IL TOURNE — et des TOURS D'HORLOGE entiers, pas une phase : `step()` est le seul qui dirait
    // qu'une passe quelconque jette au premier tick sur une structure sans `allumee`.
    expect(() => { for (let i = 0; i < 5; i++) step(relu!, []) }).not.toThrow()
    expect(fireState(relu!, feuRelu), 'et il BRÛLE : `allumee` absent vaut « pas une balise »').toBe('lit')
    // Puis sa bûche part à l'heure, comme avant l'étape 6 (patron de tick à la main du describe).
    const depart = bois(feuRelu)
    for (let i = 0; i < FIRE.BURN_TICKS + 10; i++) { relu!.tick += 1; advanceFire(relu!) }
    expect(bois(feuRelu), 'une bûche consumée, ni zéro ni dix').toBe(depart - 1)
    expect(feuRelu.allumee, 'et rien ne lui a posé le champ en chemin').toBeUndefined()
    // ⚠ TROISIÈME CLAUSE, ET C'EST ELLE QUI FERME LA PORTE DÉROBÉE (B-R18) : quand ce feu d'avant
    //   la loi s'éteint pour de bon, l'extinction doit ÉCRIRE `false` et non effacer. Sinon il
    //   retomberait sur « né avant la loi » = allumé, et une bûche le rallumerait sans braise —
    //   la loi serait contournable au bois pour toujours, sur toutes les sauvegardes du monde.
    feuRelu.fuel = makeInventory(FIRE.FUEL_SLOTS) // à sec
    delete feuRelu.emberUntil
    advanceFire(relu!)
    expect(feuRelu.allumee, 'éteint pour de bon, il porte `false` — il n’est plus « d’avant »').toBe(false)
    addItems(feuRelu.fuel!, { wood: 3 })
    advanceFire(relu!)
    expect(fireState(relu!, feuRelu), 'et du bois seul ne le rallume pas').toBe('out')
  })

  it('UNE BALISE EST TOUJOURS LIBRE, quel que soit le village qu’on lui passe (B-R10)', () => {
    // ⚠ L'INVARIANT A CHANGÉ D'ADRESSE, et c'est ce que cette garde tient. Il vivait au SITE de
    //   pose (`place_component` calculait un `baliseLibre`) ; il vit maintenant dans
    //   `addStructure`, donc il couvre la CLASSE — un futur plan, POI ou set-piece qui créerait
    //   une balise ne peut plus en faire une balise de village par mégarde (relevé à l'audit de
    //   fusion, 2026-10-04 : aucun plan n'en crée AUJOURD'HUI, et c'est pour ça qu'il fallait
    //   fermer avant que ce ne soit plus vrai).
    //
    // ⚠ CE QUI FERAIT ROUGIR CETTE GARDE, et pourquoi le sinistre serait vicieux plutôt que
    //   bruyant : retirer la ligne ne jette RIEN. La balise basculerait sur la branche FOYER —
    //   `fireStateAt` la rendrait 'lit' ÉTERNELLEMENT sans regarder le bois, et `addStructure` ne
    //   lui donnerait PAS de soute (`estFoyer(type) && villageId === 0`). Les trois clauses
    //   ci-dessous sont donc liées : le `villageId`, la soute, et l'état 'out' à la naissance.
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 6.5, 5.5)
    // On fonde un vrai village pour que le piège soit atteignable : c'est son id qu'un site de
    // création naïf passerait.
    const b = addStructure(state, 'balise', 5, 5, 7, e.id)
    expect(b.villageId, 'le village passé est IGNORÉ — une balise n’appartient à aucun').toBe(0)
    expect(b.fuel, 'donc elle a sa propre soute, comme un feu libre').toBeDefined()
    expect(countOf(b.fuel!, 'wood'), 'et ses dix bûches de naissance').toBe(FIRE.FUEL_START_WOOD)
    expect(fireState(state, b), 'et elle naît ÉTEINTE, pas allumée pour toujours').toBe('out')
    // CONTRÔLE : un FEU de village, lui, garde son village — l'invariant ne mord que la balise.
    const foyer = addStructure(state, 'fire', 9, 9, 7, e.id)
    expect(foyer.villageId, 'un Feu de village garde le sien').toBe(7)
    expect(foyer.fuel, 'et il n’a pas de soute de structure : il tourne sur `village.fuel`').toBeUndefined()
  })
})

describe('la charge ne bouge QUE d’un pas à la fois (B-R8 + B-R9)', () => {
  it('à chaque tick, le delta vaut −VIDANGE, 0 ou +RECHARGE — jamais les deux, jamais autre chose', () => {
    // ⚠ CE QUE CETTE GARDE FERME : la vidange et la recharge vivent dans la MÊME boucle, à deux
    //   lignes d'écart. Qu'elles ne se croisent jamais n'est pas un ordre d'écriture, c'est une
    //   propriété de la loi ⓒ (dans le rayon, la demande est NULLE, donc la vidange ne court pas).
    //   Si le plateau cessait de planchéer, on verrait ici un delta de `RECHARGE − VIDANGE`.
    const state = simPlate({ jour: GRAND_FROID })
    addStructure(state, 'balise', 5, 5, 0, 1).allumee = true
    const e = spawn(state, 6.5, 5.5)
    e.braise = { niveau: 0, charge: Math.floor(chargePleine(0) / 2) }
    const vus = new Set<number>()
    // Le corps entre et sort du rayon : les deux régimes se croisent dans un seul run.
    for (let i = 0; i < 400; i++) {
      e.x = i % 100 < 50 ? 6.5 : 5.5 + T.FIRE_RANGE + 3
      const avant = e.braise.charge
      advanceTemperature(state)
      vus.add(e.braise.charge - avant)
    }
    for (const delta of vus) {
      expect([-BRAISE.VIDANGE_PAR_TICK, 0, BRAISE.RECHARGE_PAR_TICK], `delta observé ${delta}`).toContain(delta)
    }
    expect(vus.has(-BRAISE.VIDANGE_PAR_TICK), 'la prémisse ⓐ : on a bien vu la vidange courir').toBe(true)
    expect(vus.has(BRAISE.RECHARGE_PAR_TICK), 'la prémisse ⓑ : et la recharge aussi').toBe(true)
  })
})

describe('B-A8, moitié BALISE — les balises bâties restent sur la carte après la mort', () => {
  it('on se relève avec une braise pleine, et sa balise est toujours là, telle qu’on l’a laissée', () => {
    // ⚠ CE QUI N'EST PAS ICI : la POSITION (« on repart en bas »), qui est l'étape 9 — et le
    //   rallumage des balises bâties, qui est la même étape. Ce qu'on tient aujourd'hui est la
    //   moitié vérifiable : la mort ne RASE rien, donc la remontée est bien « l'échelle qu'on
    //   s'est construite » (B-R11).
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 6.5, 5.5)
    e.braise = { niveau: 2, charge: 7 }
    const b = addStructure(state, 'balise', 5, 5, 0, e.id)
    b.allumee = true
    const avant = { id: b.id, tx: b.tx, ty: b.ty, allumee: b.allumee, bois: countOf(b.fuel!, 'wood') }
    e.hp = 0
    e.downedAt = state.tick // la porte de `respawn` : sans corps à terre, il ne fait RIEN
    expect(respawn(state, e), 'la prémisse : on se relève vraiment').toBe(true)
    expect(e.braise.niveau, 'le niveau traverse la mort').toBe(2)
    expect(e.braise.charge, 'et la charge repart au plein de CE niveau').toBe(chargePleine(2))
    const apres = state.structures.find((s) => s.id === avant.id)
    expect(apres, 'la balise est toujours sur la carte').toBeDefined()
    expect({ id: apres!.id, tx: apres!.tx, ty: apres!.ty, allumee: apres!.allumee, bois: countOf(apres!.fuel!, 'wood') },
      'et rien d’elle n’a changé').toEqual(avant)
  })
})

describe('B-R10 — une balise est une BASE, pas un village', () => {
  it('posée AU MILIEU de son propre village, elle reste LIBRE (villageId 0) et garde son combustible', () => {
    // ⚠ CE QUE CETTE GARDE FERME : `place_component` donne au posé le `villageId` du poseur. Sans
    //   clause, une balise bâtie dans son village basculait sur la branche FOYER de toute la
    //   machine du feu — allumée pour toujours (`fireStateAt` rend 'lit' sans regarder le bois) et
    //   SANS zone combustible (`fireZoneInventory` la refuse à un Foyer). Une balise de camp et une
    //   balise de village auraient été deux objets différents.
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 5.5, 5.5)
    grantItems(state, e.id, { balise: 1 })
    grantItems(state, e.id, { wood: 20 }) // le Feu du village se paie, lui (`STRUCTURE_COSTS.fire`)
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    expect(state.villages, 'la prémisse ⓐ : il a bien un village').toHaveLength(1)
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: { type: 'set_active_slot', slot: 0 } }])
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: { type: 'place_component', tx: 5, ty: 4 } }])
    const b = state.structures.find((s) => s.type === 'balise')
    expect(b, 'la prémisse ⓑ : elle est bien posée (dans le carré du Feu)').toBeDefined()
    expect(b!.villageId, 'et elle est LIBRE, comme un feu de camp').toBe(0)
    expect(fireState(state, b!), 'donc éteinte à la naissance, comme toute balise').toBe('out')
    expect(fireZoneInventory(b!, 'fuel'), 'et elle a bien une zone combustible').toBeDefined()
  })
})


/**
 * ═══ B-A17 — LE FEU NE NAÎT QUE DU FEU (B-R17, la loi du 2026-10-04) ═══
 *
 * ⚠ **CE QUE CE BLOC ÉPROUVE EST NEUF, ET LE DÉFAUT QU'IL FERME EST PLUS VIEUX QUE LA BRAISE.**
 * `addStructure` donnait dix bûches ET l'ancre de combustion à tout feu libre : un feu de camp
 * **naissait allumé, à cinq bois, sans braise**. La prémisse de la décision du 2026-09-28 — *« toute
 * flamme du monde descend de la braise »* — était donc fausse dans le code qui la citait, et c'est
 * ce qui rendait tolérable le verrou de `light_balise` (une braise à 0 ne pouvait plus rien allumer,
 * et plus rien ne la rechargeait : la seule issue était de mourir).
 *
 * Les clauses de B-A7 et du bloc B-R17 juste au-dessus couvrent déjà ② (l'allumage à charge 0) et
 * ④ (le bois intact d'un foyer éteint) **pour la balise**. Ce bloc-ci porte ce qui n'existait pas :
 * le FEU DE CAMP par le vrai chemin joueur, le trou de `found_village`, et la pluie déplacée.
 */
describe('B-A17 — le feu ne naît que du feu (B-R17)', () => {
  const bois = (s: Structure): number => (s.fuel ? countOf(s.fuel, 'wood') : 0)

  /** Poser un feu de camp PAR LE VRAI CHEMIN JOUEUR : l'objet en main, l'action, le tick. */
  function poserUnFeu(state: SimState, e: Entity, tx: number, ty: number): Structure {
    grantItems(state, e.id, { campfire: 1 })
    e.activeSlot = e.inventory.findIndex((sl) => sl?.item === 'campfire')
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: { type: 'place_campfire', tx, ty } }])
    return state.structures.find((s) => s.type === 'fire' && s.tx === tx && s.ty === ty)!
  }
  const allumer = (state: SimState, e: Entity, s: Structure): void => {
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: { type: 'light_foyer', structureId: s.id } }])
  }

  it('① un feu de camp bâti naît ÉTEINT, et s’allume à la braise', () => {
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 5.5, 5.5)
    const feu = poserUnFeu(state, e, 6, 5)
    expect(feu, 'la prémisse : la pose a bien abouti par l’action').toBeDefined()
    expect(bois(feu), 'et il porte ses dix bûches de naissance').toBe(FIRE.FUEL_START_WOOD)
    expect(feu.allumee, '`false` ÉCRIT, pas absent — c’est ça, la migration (B-R18)').toBe(false)
    expect(fireState(state, feu), 'DONC il naît éteint, et c’est toute la loi').toBe('out')
    expect(feu.burnAt, 'et sans ancre de combustion : rien ne brûle encore').toBeUndefined()
    // CONTRÔLE POSITIF — la même pose, puis le geste : il prend.
    allumer(state, e, feu)
    expect(fireState(state, feu), 'la braise lui donne la flamme').toBe('lit')
  })

  it('① bis un feu de camp ÉTEINT ne brûle pas son bois (sinon il serait vide le jour de l’allumage)', () => {
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 5.5, 5.5)
    const feu = poserUnFeu(state, e, 6, 5)
    const depart = bois(feu)
    const brulerUneFenetre = (): void => {
      for (let i = 0; i < FIRE.BURN_TICKS + 10; i++) { state.tick += 1; advanceFire(state) }
    }
    brulerUneFenetre()
    expect(bois(feu), 'éteint : pas une bûche consumée').toBe(depart)
    // CONTRÔLE POSITIF : le MÊME feu, allumé, brûle — donc l'horloge du montage tourne bien.
    feu.allumee = true
    brulerUneFenetre()
    expect(bois(feu), 'allumé : il consume').toBe(depart - 1)
  })

  it('③ le bois seul ne rallume pas un feu de camp mort — il faut la braise', () => {
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 5.5, 5.5)
    const feu = poserUnFeu(state, e, 6, 5)
    allumer(state, e, feu)
    expect(fireState(state, feu), 'la prémisse : il brûle').toBe('lit')
    feu.fuel = makeInventory(FIRE.FUEL_SLOTS) // à sec
    delete feu.emberUntil
    advanceFire(state)
    expect(feu.allumee, 'mort, il porte `false` (ÉCRIT, pas effacé — B-R18)').toBe(false)
    addItems(feu.fuel!, { wood: 3 })
    advanceFire(state)
    expect(fireState(state, feu), 'une bûche ne suffit plus : la loi n’est pas contournable au bois').toBe('out')
    expect(bois(feu), 'et ce bois-là ne part pas en fumée non plus').toBe(3)
    // CONTRÔLE POSITIF : la braise, elle, le reprend.
    allumer(state, e, feu)
    expect(fireState(state, feu), 'la braise rallume').toBe('lit')
  })

  it('⑥ `found_village` EXIGE la flamme — sinon la loi avait un trou le jour de sa naissance', () => {
    // ⚠ LE TROU, EN UNE PHRASE : promouvoir met `villageId ≠ 0`, or `fireStateAt` rend alors `'lit'`
    //   SANS REGARDER LE BOIS (branche du Foyer de village). Bâtir puis fonder donnait donc du feu
    //   sans braise — le contournement le plus court de toute la loi.
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 5.5, 5.5)
    const feu = poserUnFeu(state, e, 6, 5)
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: { type: 'found_village', structureId: feu.id } }])
    expect(feu.villageId, 'un feu éteint ne fonde pas').toBe(0)
    expect(state.villages.length, 'et aucun village n’est né').toBe(0)
    // CONTRÔLE POSITIF : le MÊME feu, la MÊME tuile, allumé — il fonde.
    allumer(state, e, feu)
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: { type: 'found_village', structureId: feu.id } }])
    expect(feu.villageId, 'allumé, il fonde — seule la flamme changeait').not.toBe(0)
  })

  it('⑦ la pluie n’empêche plus RIEN — ni poser, ni allumer — et R5 garde sa vraie pression', () => {
    // ⚠ CETTE GARDE A CHANGÉ DE VERDICT AVANT D'ÊTRE COMMITÉE, et c'est la suite qui l'a obtenu.
    //   J'avais DÉPLACÉ le refus R5 de la pose vers l'allumage en le croyant forcé par B-R17. Le
    //   bloc rouge de `meteo.test.ts` a nommé le vrai problème : « R5 RALLUMAGE SACRÉ », dont la
    //   raison d'être est qu'on ne puisse PAS se retrouver sans feu après être mort sous un orage.
    //   B-R17 tue le chemin qui le tenait (du bois ne rallume plus rien), donc garder le refus
    //   refabriquait un verrou de la famille exacte qu'on venait de retirer. Décision d'Alexis :
    //   AUCUNE garde de pluie — la braise est une braise VIVE.
    const poserAverse = (state: SimState): void => {
      const fenetre = fenetreDe({ type: 'pluie', day: jourDeSaison(state, state.tick) })
      const startTick = state.tick - Math.floor(fenetre / 2)
      state.meteo = {
        type: 'pluie',
        cycle: Math.floor(startTick / TICKS_PER_CYCLE),
        day: jourDeSaison(state, startTick),
        edge: 0,
        startTick,
        endTick: startTick + fenetreDe({ type: 'pluie', day: jourDeSaison(state, startTick) }),
      }
    }
    const state = simPlate({ jour: coeurDe(3), meteo: true })
    const e = spawn(state, 5.5, 5.5)
    poserAverse(state)
    // ⚠ LA PRÉMISSE SE PROUVE : sans elle la garde serait verte sur un monde sec. Et elle a déjà
    //   servi — MESURÉ en balayant 4 cardinaux × 4 bords, un ORAGE ne mouille pas une seule tuile
    //   à mi-Ardeur (`frontMouille` rend faux pour `METEO.ORAGE_SEC_PHASE`). D'où une pluie de
    //   Pluies, et non l'orage d'été que j'avais écrit d'abord.
    expect(meteoMouille(state, 6, 5), 'la prémisse : l’averse mouille bien CETTE tuile').toBe(true)
    const feu = poserUnFeu(state, e, 6, 5)
    expect(feu, 'sous l’averse, poser PASSE').toBeDefined()
    allumer(state, e, feu)
    expect(fireState(state, feu), 'et allumer passe AUSSI — la braise ne craint pas la pluie').toBe('lit')
    // ⚠ ET R5 N'EST PAS VIDÉ POUR AUTANT : sa vraie pression est la FAIM du feu, pas l'extinction.
    //   Deux mondes jumeaux, même tick, même bûche — celui sous l'averse brûle plus vite. Sans
    //   cette clause, « la pluie ne garde plus rien » serait vrai par vacuité.
    const faim = (avecPluie: boolean): number => {
      const st = simPlate({ jour: coeurDe(3), meteo: true })
      const ee = spawn(st, 5.5, 5.5)
      if (avecPluie) poserAverse(st)
      const f = poserUnFeu(st, ee, 6, 5)
      f.allumee = true
      const depart = (f.fuel ? countOf(f.fuel, 'wood') : 0)
      for (let i = 0; i < FIRE.BURN_TICKS * 2; i++) { st.tick += 1; advanceFire(st) }
      return depart - (f.fuel ? countOf(f.fuel, 'wood') : 0)
    }
    const sec = faim(false)
    const mouille = faim(true)
    expect(sec, 'la prémisse : à sec, le feu consume bien').toBeGreaterThan(0)
    expect(mouille, 'sous l’averse il AFFAME plus vite — c’est ça, R5, et c’est intact').toBeGreaterThan(sec)

    // ─── la BALISE : même loi, et c'est le CONTRÔLE que le retrait vaut pour les deux foyers ───
    const s2 = simPlate({ jour: coeurDe(3), meteo: true })
    const e2 = spawn(s2, 6.5, 5.5)
    poserAverse(s2)
    expect(meteoMouille(s2, 5, 5), 'la prémisse, chez la balise aussi').toBe(true)
    const b = poserBalise(s2, 5, 5)
    allumer(s2, e2, b)
    expect(fireState(s2, b), 'une balise s’allume aussi sous l’averse').toBe('lit')
  })
  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ⑧ ET ⑨ — LA FENÊTRE D'UN TICK. Trouvées par l'audit de fusion, écrites AVANT le correctif.
  //
  // LA CAUSE EST UN ORDRE, pas une condition manquante : `step` applique les actions du joueur,
  // PUIS `advanceFire`, PUIS `advanceTime` — l'action et la combustion voient donc le MÊME
  // numéro de tick. Or la ligne qui reprend la flamme (`allumee = false`) vit en BAS de
  // l'itération d'`advanceFire`. Au tick où les braises meurent (`state.tick === emberUntil`),
  // `allumee` vaut donc encore `true` quand le bois arrive, la clause « Sécurité » le trouve,
  // RANCRE et rallume — sans braise. La loi était contournable au bois, une fois, dans une
  // fenêtre large d'exactement UN tick.
  // ════════════════════════════════════════════════════════════════════════════════════════════

  /** Un feu ALLUMÉ amené au tick EXACT où ses braises meurent, par la combustion réelle. */
  function auTickDesBraisesMortes(state: SimState, e: Entity, feu: Structure, recul = 0): void {
    feu.fuel = makeInventory(FIRE.FUEL_SLOTS)
    addItems(feu.fuel, { wood: 1 }) // une seule bûche : la fenêtre suivante l'éteint
    feu.allumee = true
    feu.burnAt = state.tick
    feu.burnSlot = feu.fuel.findIndex((sl) => sl !== null)
    delete feu.emberUntil
    // ⚠ DEUX COMPTEURS, ET C'EST UNE FAUTE QUE J'AI PAYÉE : un seul `garde` partagé était déjà
    //   épuisé par la première boucle (BURN_TICKS), si bien que la seconde ne tournait PAS UNE FOIS
    //   et que le montage s'arrêtait 599 ticks avant la cible — c'est l'assertion de montage juste
    //   en dessous qui l'a dit, et sans elle les quatre gardes auraient jugé le mauvais tick.
    let gardeBuche = 0
    while (feu.emberUntil === undefined && gardeBuche++ < FIRE.BURN_TICKS + 50) step(state, [])
    expect(feu.emberUntil, 'le montage : la bûche a bien fini et les braises sont nées').toBeDefined()
    let gardeBraises = 0
    while (state.tick < feu.emberUntil! - recul && gardeBraises++ < FIRE.EMBER_TICKS + 50) step(state, [])
    expect(state.tick, 'le montage vise le tick voulu, au tick près').toBe(feu.emberUntil! - recul)
    grantItems(state, e.id, { wood: 3 })
  }
  /** La porte du NOURRISSAGE — le clic, `feed_fire`. */
  const nourrir = (state: SimState, e: Entity, feu: Structure): void => {
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: { type: 'feed_fire', structureId: feu.id } }])
  }
  /** La porte du MODAL — `transfer`, qui n'a AUCUNE garde à elle et repose sur « Sécurité ». */
  const deposer = (state: SimState, e: Entity, feu: Structure): void => {
    const ent = state.entities.find((x) => x.id === e.id)!
    const from = ent.inventory.findIndex((sl) => sl?.item === 'wood')
    step(state, [{ entityId: e.id, dx: 0, dy: 0, action: {
      type: 'transfer', kind: 'structure', containerId: feu.id,
      from: { side: 'player', slot: from },
      to: { side: 'container', slot: 0, zone: 'fuel' }, count: 1,
    } }])
  }

  it('⑫ ALLUMER UN FOYER N’EST PAS MUET — un feu de camp dit `fire_relit`, une balise `balise_allumee`', () => {
    // ⚠ CE QUE ÇA RÉPARE : avant B-R17, raviver un camp au bois émettait `fire_relit`, dont le seul
    //   consommateur est la VOIX du client. La loi tue ce chemin (le bois ne rallume plus rien) et
    //   le remplace par `light_foyer`, qui n'émettait RIEN pour un feu de camp — le geste le plus
    //   fréquent qu'elle introduise se jouait donc dans le silence complet (audit du 2026-10-04).
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 5.5, 5.5)
    const feu = poserUnFeu(state, e, 6, 5)
    drainEvents(state)
    allumer(state, e, feu)
    const evts = drainEvents(state)
    expect(evts.some((ev) => ev.type === 'fire_relit' && ev.structureId === feu.id), 'le feu de camp PARLE').toBe(true)
    expect(evts.some((ev) => ev.type === 'balise_allumee'), 'et il ne se fait PAS passer pour une balise').toBe(false)
    // LA BALISE, elle, garde son événement à elle — un palier gagné ne se noie pas dans un geste courant.
    const s2 = simPlate({ jour: ARDEUR })
    const e2 = spawn(s2, 6.5, 5.5)
    const b = poserBalise(s2, 5, 5)
    drainEvents(s2)
    allumer(s2, e2, b)
    const evts2 = drainEvents(s2)
    expect(evts2.some((ev) => ev.type === 'balise_allumee' && ev.structureId === b.id), 'la balise dit SON événement').toBe(true)
    expect(evts2.some((ev) => ev.type === 'fire_relit'), 'et pas celui du feu de camp').toBe(false)
  })

  for (const [nom, porte] of [['feed_fire (le clic)', nourrir], ['transfer (le modal)', deposer]] as const) {
    it(`⑧ au tick où les braises MEURENT, le bois ne rallume pas — porte ${nom}`, () => {
      const state = simPlate({ jour: ARDEUR })
      const e = spawn(state, 5.5, 5.5)
      const feu = poserUnFeu(state, e, 6, 5)
      auTickDesBraisesMortes(state, e, feu)
      // ⚠ LA PRÉMISSE, SANS QUOI UN `EMBER_TICKS` CHANGÉ RENDRAIT LA GARDE VERTE SUR UN TICK QUE
      //   LE JEU NE VISITE JAMAIS : à cet instant le feu est DÉJÀ éteint au sens de l'état…
      expect(fireStateAt(state.tick, feu), 'prémisse : les braises sont mortes à CE tick').toBe('out')
      // …et pourtant la flamme lui est encore DONNÉE — c'est tout l'écart, et c'est la fenêtre.
      expect(flammeDonnee(feu), 'prémisse : `allumee` est encore `true` — l’écart est là').toBe(true)
      porte(state, e, feu)
      // ⚠ ON AFFIRME L'ÉTAT APRÈS UN `step` COMPLET, ET JAMAIS L'ABSENCE DE `fire_relit` : gater la
      //   seule porte du nourrissage laisserait la clause « Sécurité » rallumer EN SILENCE, et une
      //   garde sur l'événement serait verte pendant que le feu brûle.
      expect(fireState(state, feu), 'le bois ne rallume pas : la loi tient').toBe('out')
      expect(feu.allumee, 'et la flamme est reprise, ÉCRITE `false` (B-R18)').toBe(false)
      expect(feu.burnAt, 'et rien n’est ancré : aucune combustion n’a repris').toBeUndefined()
      expect(bois(feu), 'le bois, lui, reste dans la soute — il attend la braise').toBeGreaterThan(0)
    })

    it(`⑧ bis CONTRÔLE POSITIF — UN TICK PLUS TÔT, le même montage rallume (porte ${nom})`, () => {
      const state = simPlate({ jour: ARDEUR })
      const e = spawn(state, 5.5, 5.5)
      const feu = poserUnFeu(state, e, 6, 5)
      auTickDesBraisesMortes(state, e, feu, 1) // un tick AVANT la mort des braises
      expect(fireStateAt(state.tick, feu), 'prémisse : à ce tick il est encore en BRAISES').toBe('ember')
      porte(state, e, feu)
      expect(fireState(state, feu), 'nourrir des braises VIVES rallume — c’est légitime, et ça doit rester').toBe('lit')
    })
  }

  it('⑨ une sauvegarde d’AVANT la loi dont le feu est mort ne se rallume pas au bois, dès le premier tick', () => {
    // ⚠ CETTE GARDE N'APPELLE PAS `advanceFire` EN DIRECT, ET C'EST LE POINT : la garde de
    //   migration qui existait le faisait, donc elle était STRUCTURELLEMENT aveugle au trou —
    //   *une phase seule n'est pas un tick*, et la fenêtre vit dans l'ordre action-avant-feu.
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 5.5, 5.5)
    const feu = poserUnFeu(state, e, 6, 5)
    // LA PRÉMISSE D'UNE VIEILLE SAUVEGARDE : le champ est ABSENT, donc « né avant la loi », donc
    // `flammeDonnee` rend VRAI pour un feu — et la soute est vide, donc l'état est `'out'`.
    delete feu.allumee
    delete feu.burnAt
    delete feu.burnSlot
    delete feu.emberUntil
    feu.fuel = makeInventory(FIRE.FUEL_SLOTS)
    expect(flammeDonnee(feu), 'prémisse : absent = né avant la loi = la flamme est donnée').toBe(true)
    expect(fireStateAt(state.tick, feu), 'prémisse : et pourtant il est éteint, faute de bois').toBe('out')
    grantItems(state, e.id, { wood: 3 })
    nourrir(state, e, feu)
    expect(fireState(state, feu), 'le bois ne ressuscite pas un feu mort d’avant la loi').toBe('out')
    expect(feu.allumee, 'le premier tick ÉCRIT `false` : la porte dérobée se ferme pour toujours').toBe(false)
    // CONTRÔLE : sans l'input, un `step` à vide écrit le même `false` — donc c'est bien le tick
    // qui referme, et la garde ne doit pas son vert à l'action.
    const s2 = simPlate({ jour: ARDEUR })
    const e2 = spawn(s2, 5.5, 5.5)
    const f2 = poserUnFeu(s2, e2, 6, 5)
    delete f2.allumee
    delete f2.burnAt
    f2.fuel = makeInventory(FIRE.FUEL_SLOTS)
    step(s2, [])
    expect(f2.allumee, 'un tick à vide suffit à reprendre la flamme d’une vieille sauvegarde').toBe(false)
  })

  for (const [nom2, porte2] of [['feed_fire', nourrir], ['transfer', deposer]] as const) {
  it(`⑨ bis LA FORME QUE LE MONDE D’AVANT PRODUISAIT VRAIMENT : un feu mort y porte ses braises ÉTEINTES — porte ${nom2}`, () => {
    // ⚠ LA PRÉMISSE DE ⑨ EST CONSTRUITE À LA MAIN, et il faut le dire : un feu d'avant la loi qui a
    //   brûlé tout son bois n'a pas « ni ancre ni braises » — `advanceFire` lui a effacé l'ancre ET
    //   posé `emberUntil`, qui est donc dans le PASSÉ quand on relit la sauvegarde. C'est cette
    //   forme-là qu'un joueur réel apporte, et c'est l'autre branche du droit de brûler qui la
    //   prend (braises mortes), pas celle de ⑨. Les deux gardes éprouvent donc deux chemins.
    const state = simPlate({ jour: ARDEUR })
    const e = spawn(state, 5.5, 5.5)
    const feu = poserUnFeu(state, e, 6, 5)
    delete feu.allumee // le monde d'avant n'avait pas le champ
    delete feu.burnAt
    delete feu.burnSlot
    feu.fuel = makeInventory(FIRE.FUEL_SLOTS) // à sec : la dernière bûche a fini
    feu.emberUntil = state.tick - 1 // … et ses braises ont fini de rougir, AVANT le chargement
    expect(flammeDonnee(feu), 'prémisse : absent = né avant la loi = flamme donnée').toBe(true)
    expect(fireStateAt(state.tick, feu), 'prémisse : et il est bel et bien éteint').toBe('out')
    grantItems(state, e.id, { wood: 3 })
    porte2(state, e, feu)
    expect(fireState(state, feu), 'le bois ne ressuscite pas un feu d’avant la loi dont les braises sont mortes').toBe('out')
    expect(feu.allumee, 'et le premier tick écrit `false`').toBe(false)
    // CONTRÔLE POSITIF — LE MÊME FEU, braises encore VIVES : là le bois doit rallumer.
    const s3 = simPlate({ jour: ARDEUR })
    const e3 = spawn(s3, 5.5, 5.5)
    const f3 = poserUnFeu(s3, e3, 6, 5)
    delete f3.allumee
    delete f3.burnAt
    delete f3.burnSlot
    f3.fuel = makeInventory(FIRE.FUEL_SLOTS)
    f3.emberUntil = s3.tick + 100 // braises VIVES
    grantItems(s3, e3.id, { wood: 3 })
    porte2(s3, e3, f3)
    expect(fireState(s3, f3), 'des braises vives se nourrissent encore — c’est S15, et ça ne bouge pas').toBe('lit')
  })
  }
})

describe('B-A17 ⑩① — `foyerAllumable` ÉQUIVAUT à ce que `light_foyer` accepte, l’équivalence se PROUVE', () => {
  // ⚠ POURQUOI UNE ÉQUIVALENCE ET PAS DEUX TESTS SÉPARÉS : B-R18 interdit un second prédicat, mais
  //   `light_foyer` garde ses refus un par un parce qu'ils portent chacun un MOTIF lisible pour le
  //   joueur. Deux écritures du même droit, donc — et c'est exactement le genre de paire qui dérive
  //   en silence. On la PROUVE au lieu de l'espérer, sur une énumération tirée du REGISTRE : une
  //   pièce `foyer` ajoutée demain entre dans la matrice sans qu'on y pense.
  const TYPES_FOYER = (Object.keys(PIECES) as StructureType[]).filter((t) => piece(t).foyer === true)

  it('① la matrice complète : le prédicat et la porte disent la même chose, sur toutes les formes', () => {
    expect(TYPES_FOYER.length, 'la prémisse : le registre porte bien des foyers').toBeGreaterThanOrEqual(2)
    const ecarts: string[] = []
    let acceptes = 0
    let refuses = 0
    for (const type of TYPES_FOYER) {
      for (const flamme of [undefined, true, false] as const) {
        for (const bois of [0, 5]) {
          for (const village of [0, 1]) {
            const state = simPlate({ jour: ARDEUR })
            const e = spawn(state, 6.5, 5.5) // collé à la tuile (6,5) : à portée de bras
            e.braise = { niveau: 0, charge: 1 }
            const s0 = addStructure(state, type, 6, 5, 0, e.id)
            if (flamme === undefined) delete s0.allumee
            else s0.allumee = flamme
            s0.fuel = makeInventory(FIRE.FUEL_SLOTS)
            if (bois > 0) addItems(s0.fuel, { wood: bois })
            s0.villageId = village
            const attendu = foyerAllumable(s0)
            drainEvents(state)
            applyVillageAction(state, e.id, { type: 'light_foyer', structureId: s0.id })
            const refus = drainEvents(state).some((ev) => ev.type === 'action_rejected')
            const obtenu = !refus
            if (obtenu) acceptes++
            else refuses++
            if (attendu !== obtenu) {
              ecarts.push(`${type} flamme=${String(flamme)} bois=${bois} village=${village} : prédicat ${attendu}, porte ${obtenu}`)
            }
          }
        }
      }
    }
    // ⚠ LES DEUX CONTRÔLES QUI EMPÊCHENT UN VERT PAR VACUITÉ : si la porte refusait TOUT (acteur mal
    //   placé, braise absente…), le prédicat n'aurait qu'à rendre faux partout pour coïncider.
    expect(acceptes, 'contrôle : la porte accepte vraiment dans certains cas').toBeGreaterThan(0)
    expect(refuses, 'contrôle : et elle refuse vraiment dans d’autres').toBeGreaterThan(0)
    expect(ecarts, 'aucun écart entre le prédicat du miroir et la porte de la sim').toEqual([])
  })

})
