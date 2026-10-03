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
import { BALANCE, BRAISE, COMBAT, MONSTER_DEFS, TEMPERATURE } from './balance'
import { braiseNeuve, chargePleine, cransCouverts, cransMax, type Braise } from './braise'
import { palierDuSol } from './etages'
import { fenetreDe, type MeteoFront } from './meteo'
import { deserializeSim, serializeSim } from './persistence'
import { respawn } from './combat'
import { spawnMonster } from './monsters'
import { createSim, spawnEntity, step, type Entity, type SimState } from './sim'
import { TERRASSES } from './terrasses'
import { advanceTemperature, airDeLaDemande, cransExiges, socleDuJour } from './temperature'
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
