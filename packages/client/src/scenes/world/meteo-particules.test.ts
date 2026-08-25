/**
 * LA CHUTE SE PROUVE HEADLESS — la physique des gouttes et des flocons.
 *
 * Le rendu se juge sur des pixels (scénario smoke `meteo`), mais une LOI se démontre : la
 * vitesse limite, le vent, le flottement, la rampe de densité et l'escalier de la traînée
 * sont des fonctions, pas des impressions. On balaie donc les domaines entiers plutôt que
 * trois cas choisis — patron « garde exhaustive plutôt que cas choisis ».
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, largeurDe, meteoIntensityAt, type MeteoAspect, type MeteoFront } from '@ashes/sim'
import {
  BUDGET_PARTICULES,
  ChampParticules,
  PROFILS,
  creerRng,
  intensiteDansBande,
  melangeUniforme,
  rampeDe,
  traineeEnRuns,
  type Bande,
  type Melange,
  type Run,
  type Vue,
} from './meteo-particules'

/** Le cœur d'une saison, dérivé d'`ACT_DAYS` (spec `saisons.md` S1) — 1 l'Éclosion,
 *  2 l'Ardeur, 3 les Pluies, 4 le Grand Froid. */
const MI = (phase: number): number => Math.round(BALANCE.ACT_DAYS * (phase - 0.5))

/**
 * LE FRONT QUI PORTE CHAQUE ASPECT (spec `meteo.md` R11) : la neige est une pluie là où il
 * fait froid, le blizzard un orage — et la rampe se lit sur le FRONT (`largeurDe`), jamais sur
 * l'aspect. Le front ne sert ici QUE de porteur de GÉOMÉTRIE : c'est le profil, choisi par
 * l'aspect, qui dit comment ça tombe.
 *
 * ⚠ LA SAISON EST UN CHOIX D'INSTRUMENT, pas une affirmation de calendrier — même raison que
 * `RAMPE_LISIBLE` plus bas, et il faut le dire pour que personne ne lise « il neige en été ».
 * Depuis S7 la largeur est saisonnière : l'Ardeur donne une bande de 60 tuiles, donc une rampe
 * de 9, la seule qui se lise sur un cadre de 40 ; les Pluies en donnent 4 500 et le Grand Froid
 * 1 600, si bien qu'un cadre d'écran y serait tout entier au plein et ne mesurerait plus rien
 * de la rampe. La loi de largeur elle-même est gardée ailleurs, par `l'intensité relue inline`,
 * et celle-là balaie les quatre saisons.
 */
function frontDe(aspect: MeteoAspect): MeteoFront {
  const type = aspect === 'neige' ? 'pluie' : aspect === 'blizzard' ? 'orage' : aspect
  return { type, cycle: 3, day: MI(2), edge: 0, startTick: 0, endTick: 1000 }
}
const RAMPE_PLUIE = rampeDe(frontDe('pluie'))
const BANDE: Bande = { axis: 'x', lo: 100, hi: 160 }
const VUE: Vue = { x0: 110, y0: 40, x1: 150, y1: 64 }

/** Faire tourner le champ N images à 60 Hz, comme le fait la couche. */
function avancer(c: ChampParticules, type: 'pluie' | 'neige' | 'orage' | 'blizzard', n: number, vue = VUE, bande = BANDE): void {
  const profil = PROFILS[type]!
  for (let i = 0; i < n; i++) c.update(1 / 60, melangeUniforme(profil), vue, bande, rampeDe(frontDe(type)))
}

describe("l'intensité relue inline est celle de la sim", () => {
  it('coïncide avec `meteoIntensityAt` sur TOUT l’axe, pour les cinq types', () => {
    // L'écrivain unique : la couche relit la loi sans recalculer la bande (900 fois par
    // image, ça compte), mais elle ne doit JAMAIS en diverger. On balaie l'axe entier —
    // dehors, sur les deux rampes, au cœur — plutôt que d'affirmer trois points.
    //
    // LES QUATRE CLASSES SUR LES QUATRE SAISONS (spec `saisons.md` S7 : la géométrie du front
    // est saisonnière, et R13 — la largeur de l'orage interpolée sur le froid — est retirée).
    // C'est ce balayage-là qui garde la loi de largeur : la même classe change d'ordre de
    // grandeur d'une saison à l'autre — l'orage sec de l'Ardeur fait 60 tuiles, la pluie des
    // Pluies 4 500 (plus large que la vallée : il pleut du matin au soir), le blizzard du
    // Grand Froid 1 600. Une couche qui recopierait une largeur par TYPE se verrait ici.
    const front = (type: MeteoFront['type'], day: number): MeteoFront =>
      ({ type, cycle: 3, day, edge: 0, startTick: 0, endTick: 1000 })
    const fronts: MeteoFront[] = [
      front('pluie', MI(1)), // l'Éclosion — l'averse qu'on traverse
      front('brouillard', MI(1)),
      front('orage', MI(2)), // l'Ardeur — l'orage sec, la bande la plus étroite de l'année
      front('pluie', MI(3)), // les Pluies — la bande qui noie la carte entière
      front('orage', MI(4)), // le Grand Froid — l'orage qui devient blizzard
      front('vent_de_cendre', MI(4)),
    ]
    for (const front of fronts) {
      const mapW = 1600
      const mapH = 1600
      const tick = 500
      const rampe = rampeDe(front)
      // La bande au tick 500 : la même que `frontMeteoPos` — on la reconstruit par la loi
      // publique pour ne pas dépendre d'un interne.
      const largeur = largeurDe(front)
      const avance = (tick / 1000) * (mapW + largeur)
      const bande: Bande = { axis: 'x', lo: avance - largeur, hi: avance }
      for (let x = Math.floor(bande.lo) - 40; x <= Math.ceil(bande.hi) + 40; x += 1) {
        const attendu = meteoIntensityAt(front, tick, mapW, mapH, x, 800)
        const obtenu = intensiteDansBande(bande, rampe, x, 800)
        expect(obtenu, `${front.type} (jour ${front.day}) en x=${x}`).toBeCloseTo(attendu, 10)
      }
    }
  })
})

describe('la vitesse limite', () => {
  it('BORNE la chute de chaque type — la goutte file, le flocon flâne', () => {
    // C'est la promesse physique : gravité ET vitesse limite distinctes. Une particule
    // lâchée converge vers `vLimite` et n'y dépasse jamais de plus d'un cheveu.
    for (const type of ['pluie', 'neige', 'orage', 'blizzard'] as const) {
      const profil = PROFILS[type]!
      const c = new ChampParticules(1234)
      avancer(c, type, 300)
      const vives = c.particules.filter((p) => p.vive)
      expect(vives.length, `${type} : rien ne vit`).toBeGreaterThan(0)
      for (const p of vives) {
        expect(p.vy, `${type} : vy=${p.vy} > vLimite`).toBeLessThanOrEqual(profil.vLimite * 1.001)
        expect(p.vy, `${type} : vy=${p.vy} négatif`).toBeGreaterThan(0)
      }
    }
  })

  it('SÉPARE les ciels : la goutte tombe 7 fois plus vite que le flocon', () => {
    // L'axe de reconnaissance nº 2 (après la forme). S'il se resserre, deux ciels
    // deviennent le même ciel.
    expect(PROFILS.pluie!.vLimite / PROFILS.neige!.vLimite).toBeGreaterThan(6)
    expect(PROFILS.pluie!.vLimite).toBeGreaterThanOrEqual(8)
    expect(PROFILS.pluie!.vLimite).toBeLessThanOrEqual(10)
    expect(PROFILS.neige!.vLimite).toBeGreaterThanOrEqual(1)
    expect(PROFILS.neige!.vLimite).toBeLessThanOrEqual(1.5)
  })

  it('converge vers la vitesse limite en τ = vLimite / g, pas plus lentement', () => {
    // Le modèle dv/dt = g(1 − v/vLimite) : après 3τ on est à 95 % de l'équilibre. On le
    // vérifie sur l'intégrateur réel, pas sur la formule fermée.
    for (const type of ['pluie', 'neige', 'orage', 'blizzard'] as const) {
      const profil = PROFILS[type]!
      const k = profil.g / profil.vLimite
      let v = 0
      const tau = 1 / k
      const pas = 1 / 240
      for (let t = 0; t < 3 * tau; t += pas) v += (profil.g - k * v) * pas
      expect(v / profil.vLimite, `${type}`).toBeGreaterThan(0.9)
      expect(v / profil.vLimite, `${type}`).toBeLessThan(1.001)
    }
  })
})

describe('le vent', () => {
  it('le BLIZZARD rase : son vent dépasse sa chute — la neige ordinaire non', () => {
    // C'est LA différence lisible entre neige et blizzard, et elle est géométrique :
    // la trajectoire du blizzard est plus horizontale que verticale.
    expect(Math.abs(PROFILS.blizzard!.vent)).toBeGreaterThan(PROFILS.blizzard!.vLimite)
    expect(Math.abs(PROFILS.neige!.vent)).toBeLessThan(PROFILS.neige!.vLimite)
  })

  it("l'ORAGE penche plus que la PLUIE, et la pluie reste quasi verticale", () => {
    const pente = (t: 'pluie' | 'orage') => Math.abs(PROFILS[t]!.vent) / PROFILS[t]!.vLimite
    expect(pente('orage')).toBeGreaterThan(pente('pluie') * 2)
    expect(pente('pluie')).toBeLessThan(0.15) // « quasi verticale » : moins de 9°
  })

  it('emporte la vitesse horizontale VERS le vent, à la même constante de temps', () => {
    const c = new ChampParticules(99)
    avancer(c, 'blizzard', 200)
    const vives = c.particules.filter((p) => p.vive)
    expect(vives.length).toBeGreaterThan(0)
    for (const p of vives) {
      // Le vent est vers l'est : aucune particule ne remonte le vent.
      expect(p.vx, `vx=${p.vx}`).toBeGreaterThan(0)
      expect(p.vx).toBeLessThanOrEqual(PROFILS.blizzard!.vent * 1.3)
    }
  })
})

describe('le flocon flotte', () => {
  it('neige et blizzard oscillent, pluie et orage NON — c’est la signature du flocon', () => {
    expect(PROFILS.neige!.flotte).toBeGreaterThan(0)
    expect(PROFILS.blizzard!.flotte).toBeGreaterThan(0)
    expect(PROFILS.pluie!.flotte).toBe(0)
    expect(PROFILS.orage!.flotte).toBe(0)
  })

  it("l'oscillation vaut une fraction SENSIBLE de la chute — sinon on ne la voit pas", () => {
    // Sous 30 % de la vitesse de chute, le tangage se noie dans la descente : le flocon
    // lirait « point qui tombe droit », c'est-à-dire une pluie lente.
    expect(PROFILS.neige!.flotte / PROFILS.neige!.vLimite).toBeGreaterThan(0.3)
  })

  it('a une PHASE PROPRE par particule — la neige ne tangue pas en chœur', () => {
    const c = new ChampParticules(7)
    avancer(c, 'neige', 120)
    const phases = c.particules.filter((p) => p.vive).map((p) => p.phase)
    expect(phases.length).toBeGreaterThan(20)
    // Étalées sur tout le cercle : on compte les quadrants occupés.
    const quadrants = new Set(phases.map((f) => Math.floor((f / (Math.PI * 2)) * 4)))
    expect(quadrants.size, 'les phases se groupent').toBe(4)
  })
})

describe('la traînée', () => {
  it('la GOUTTE s’étire, le FLOCON reste un carré', () => {
    expect(PROFILS.pluie!.trainee).toBeGreaterThan(0)
    expect(PROFILS.orage!.trainee).toBeGreaterThan(0)
    expect(PROFILS.neige!.trainee).toBe(0)
  })

  it('un trait vertical ne fait qu’UN rectangle, de la bonne longueur', () => {
    const runs: Run[] = []
    const n = traineeEnRuns(10, 20, 0, 9, 5, 1, runs, 0)
    expect(n).toBe(1)
    expect(runs[0]).toEqual({ cx: 10, cy: 16, w: 1, h: 5 })
  })

  it('un trait horizontal (le blizzard) part À L’OPPOSÉ du sens de marche', () => {
    // La tête est en (30, 8) et le vent pousse vers +x : la traînée est DERRIÈRE, donc
    // à gauche. Une traînée devant la goutte lirait « la pluie remonte ».
    const runs: Run[] = []
    const n = traineeEnRuns(30, 8, 11, 2, 3, 2, runs, 0)
    expect(n).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < n; i++) expect(runs[i]!.cx).toBeLessThanOrEqual(30)
    expect(runs[0]!.cx + runs[0]!.w).toBe(31) // la tête est bien incluse
  })

  it('couvre EXACTEMENT L cellules le long de l’axe dominant, quelle que soit la pente', () => {
    // Balayage : toutes les pentes, toutes les longueurs utiles. La somme des étendues
    // sur l'axe dominant doit valoir L — ni trou, ni double-couche.
    const runs: Run[] = []
    for (let ang = 0; ang < 360; ang += 7) {
      const vx = Math.cos((ang * Math.PI) / 180) * 10
      const vy = Math.sin((ang * Math.PI) / 180) * 10
      for (let L = 1; L <= 8; L++) {
        const n = traineeEnRuns(50, 50, vx, vy, L, 1, runs, 0)
        const yDom = Math.abs(vy) >= Math.abs(vx)
        let total = 0
        for (let i = 0; i < n; i++) total += yDom ? runs[i]!.h : runs[i]!.w
        expect(total, `ang=${ang} L=${L}`).toBe(L)
      }
    }
  })

  /**
   * LE COMPTE DE RECTANGLES PAR GOUTTE — le nombre qui commande le budget de rastérisation,
   * et le PRIX EXACT de la pluie fine.
   *
   * Il vaut `1 + longueur × |pente|`, en CELLULES du grain de ce ciel. Affiner la goutte de
   * 4 px à 1 px multiplie la longueur en cellules par quatre — donc l'escalier aussi, à pente
   * égale. Le plafond n'est donc plus un nombre unique : chaque profil porte le sien, écrit
   * ici EN TOUTES LETTRES, parce que c'est lui qu'on paie et qu'un profil qui le dépasserait
   * doit rougir avant la machine.
   *
   * ⚠ Le plafond est écrit À LA MAIN et non dérivé de `vent/vLimite` : une garde écrite avec
   * la constante qu'elle teste ne garde rien.
   */
  it('reste sous SON plafond de rectangles par goutte, profil par profil', () => {
    const PLAFOND = { pluie: 3, neige: 1, orage: 8, blizzard: 3 } as const
    const runs: Run[] = []
    for (const type of ['pluie', 'neige', 'orage', 'blizzard'] as const) {
      const profil = PROFILS[type]!
      const v = Math.sqrt(profil.vent ** 2 + profil.vLimite ** 2)
      // `parTuile` = TILE_PX / grainPx — la conversion tuiles → cellules DE CE CIEL.
      const parTuile = 16 / profil.grainPx
      const L = profil.trainee === 0 ? 1 : Math.max(1, Math.round(v * profil.trainee * parTuile))
      const n = traineeEnRuns(50, 50, profil.vent, profil.vLimite, L, profil.taille[1]!, runs, 0)
      expect(n, `${type} : ${n} rectangles pour L=${L} cellules de ${profil.grainPx} px`)
        .toBeLessThanOrEqual(PLAFOND[type])
    }
  })

  /**
   * LA FINESSE EST UN NOMBRE, PAS UN ADJECTIF (demande d'Alexis, 2026-08-19).
   *
   * La goutte doit faire UN pixel d'art de large et s'étirer nettement. On l'affirme sur les
   * profils réels : largeur = 1 cellule × `grainPx` = 1 px monde, et un rapport
   * longueur/largeur d'au moins 15:1. La neige et le blizzard sont EXCLUS — leur silhouette
   * carrée sur 4 px est validée, et cette garde les casserait à raison si on les affinait.
   */
  it('la GOUTTE fait 1 px monde de large et s’étire au moins 15 fois plus qu’elle n’est large', () => {
    for (const type of ['pluie', 'orage'] as const) {
      const p = PROFILS[type]!
      expect(p.grainPx, `${type} : grain`).toBe(1)
      expect(p.taille[0] * p.grainPx, `${type} : largeur lointaine`).toBe(1)
      expect(p.taille[1] * p.grainPx, `${type} : largeur proche`).toBe(1)
      const longueurPx = Math.sqrt(p.vent ** 2 + p.vLimite ** 2) * p.trainee * 16
      expect(longueurPx / (p.taille[1] * p.grainPx), `${type} : rapport`).toBeGreaterThanOrEqual(15)
      // Et elle est DISCRÈTE : une goutte isolée reste sous le quart d'opacité.
      expect(p.alpha[1], `${type} : opacité proche`).toBeLessThanOrEqual(0.26)
    }
    // La neige et le blizzard N'ONT PAS BOUGÉ : le grain des FX de lumière, et rien d'autre.
    for (const type of ['neige', 'blizzard'] as const) expect(PROFILS[type]!.grainPx).toBe(4)
  })

  /**
   * LA TRAÎNÉE NE DOIT PAS DÉPASSER LA MARGE D'ÉMISSION (`MARGE_TUILES` = 1,5 tuile dans
   * `meteo-layer`). Au-delà, une goutte née sur le bord traînerait DANS le cadre un trait
   * dont la tête n'est pas encore entrée — et l'allonger est justement ce qu'on vient de
   * faire. Le nombre est recopié ici À DESSEIN : la couche est du Phaser, ce fichier est pur.
   */
  it('aucune traînée ne dépasse la marge d’émission de 1,5 tuile', () => {
    for (const type of ['pluie', 'neige', 'orage', 'blizzard'] as const) {
      const p = PROFILS[type]!
      const longueurTuiles = Math.sqrt(p.vent ** 2 + p.vLimite ** 2) * p.trainee
      expect(longueurTuiles, `${type} : ${longueurTuiles.toFixed(2)} tuile`).toBeLessThanOrEqual(1.5)
    }
  })
})

describe('R14 — le troupeau se MÉLANGE, il ne commute pas', () => {
  /** Un mélange pluie/neige dont la part de froid est donnée par une fonction de x. */
  const melange = (part: (x: number) => number): Melange => ({
    doux: PROFILS.pluie,
    froid: PROFILS.neige,
    part: (x: number) => part(x),
  })
  const BANDE_LARGE: Bande = { axis: 'x', lo: 0, hi: 400 }
  const VUE_LARGE: Vue = { x0: 100, y0: 40, x1: 160, y1: 70 }

  it('à MOITIÉ de part, il tombe MOITIÉ de flocons — le grésil existe, ce n’est pas un fondu', () => {
    // DÈS LA PREMIÈRE IMAGE, ET ENCORE QUINZE SECONDES PLUS TARD — et c'est le pilotage par
    // cible qui l'offre : chaque espèce est semée à SA cible d'un coup, si bien qu'il n'y a
    // AUCUN régime transitoire à attendre. (Un tirage de nature par naissance en aurait eu un
    // de dix secondes, le temps qu'une espèce dix fois plus lente peuple le cadre — et le
    // relevé précoce aurait menti. MESURÉ, dans cette version-là : 0,20 à deux secondes.)
    const part = (n: number): number => {
      const c = new ChampParticules(0x9e17)
      for (let i = 0; i < n; i++) c.update(1 / 60, melange(() => 0.5), VUE_LARGE, BANDE_LARGE, RAMPE_PLUIE)
      const vivantes = c.particules.filter((p) => p.vive)
      expect(vivantes.length, `${n} images`).toBeGreaterThan(200) // la prémisse : il tombe quelque chose
      return vivantes.filter((p) => p.froid).length / vivantes.length
    }
    for (const n of [1, 30, 900]) {
      // Les DEUX populations coexistent, dans la proportion demandée. La cible exacte n'est pas
      // 0,50 mais 0,55/(0,55+0,69) = 0,44 : chaque espèce vise SA densité de table, et le flocon
      // en a moins que la goutte. AUCUN aspect ne l'emporte — c'est ça, du grésil.
      expect(part(n), `${n} images`).toBeGreaterThan(0.4)
      expect(part(n), `${n} images`).toBeLessThan(0.5)
    }
  })

  it('LE CAS SIGNALÉ, à l’écran — de part et d’autre d’une lisière, flocons ici et gouttes là DANS LA MÊME IMAGE', () => {
    // La part passe de 1 à 0 sur la maille du champ de neige, autour de x = 130. Ce que la
    // garde affirme : la nature d'une particule suit LE POINT OÙ ELLE NAÎT. Avant R14, tout
    // le cadre portait un seul aspect — celui lu sous les pieds du joueur.
    const c = new ChampParticules(0x51ee7)
    const rampe = (x: number): number => Math.min(1, Math.max(0, (130 - x) / 4))
    for (let i = 0; i < 600; i++) c.update(1 / 60, melange(rampe), VUE_LARGE, BANDE_LARGE, RAMPE_PLUIE)
    const gauche = c.particules.filter((p) => p.vive && p.x < 120)
    const droite = c.particules.filter((p) => p.vive && p.x > 142)
    expect(gauche.length).toBeGreaterThan(40)
    expect(droite.length).toBeGreaterThan(40)
    // Le froid pur à gauche, le doux pur à droite — la tolérance couvre la DÉRIVE : une
    // particule garde sa nature en traversant, et c'est exactement ce qu'on veut d'elle.
    expect(gauche.filter((p) => p.froid).length / gauche.length).toBeGreaterThan(0.9)
    expect(droite.filter((p) => p.froid).length / droite.length).toBeLessThan(0.1)
  })

  it('SANS ASPECT FROID, RIEN NE CHANGE — pas un flocon, pas un tirage de plus', () => {
    // `melangeUniforme` doit être INERTE : c'est ce qui garde le flux d'aléa d'avant R14, donc
    // toutes les gardes statistiques de ce fichier. Deux champs de même graine, l'un mené par
    // le mélange dégénéré, l'autre par un mélange à part nulle : mêmes positions au bit près.
    const a = new ChampParticules(0x1234)
    const b = new ChampParticules(0x1234)
    for (let i = 0; i < 60; i++) {
      a.update(1 / 60, melangeUniforme(PROFILS.pluie), VUE_LARGE, BANDE_LARGE, RAMPE_PLUIE)
      b.update(1 / 60, { doux: PROFILS.pluie, froid: null, part: () => 1 }, VUE_LARGE, BANDE_LARGE, RAMPE_PLUIE)
    }
    expect(a.particules.some((p) => p.froid)).toBe(false)
    for (let i = 0; i < a.particules.length; i++) {
      expect(b.particules[i]!.x, `particule ${i}`).toBe(a.particules[i]!.x)
      expect(b.particules[i]!.vive, `particule ${i}`).toBe(a.particules[i]!.vive)
    }
  })

  it('CHAQUE POPULATION GARDE SA PHYSIQUE — le flocon flâne pendant que la goutte file, côte à côte', () => {
    const c = new ChampParticules(0xbeef)
    for (let i = 0; i < 600; i++) c.update(1 / 60, melange(() => 0.5), VUE_LARGE, BANDE_LARGE, RAMPE_PLUIE)
    const vitesse = (froid: boolean): number => {
      const lot = c.particules.filter((p) => p.vive && p.froid === froid)
      return lot.reduce((s, p) => s + p.vy, 0) / Math.max(1, lot.length)
    }
    // Sept fois plus lent, c'est la table (1,2 contre 9 tuiles/s). On demande un facteur 3 :
    // la garde vise le fait que les deux physiques COEXISTENT, pas le calibrage de la table.
    expect(vitesse(false)).toBeGreaterThan(vitesse(true) * 3)
  })
})

describe("l'émission suit la bande", () => {
  it('AUCUNE particule hors de la bande — jamais, sur 400 images', () => {
    // La règle dure : sous la bande il pleut, à dix tuiles de sa lisière il ne pleut pas.
    // Le cadre déborde ici largement des deux côtés du front.
    const bande: Bande = { axis: 'x', lo: 200, hi: 240 }
    const vue: Vue = { x0: 170, y0: 40, x1: 270, y1: 64 }
    const c = new ChampParticules(4242)
    for (let i = 0; i < 400; i++) c.update(1 / 60, melangeUniforme(PROFILS.pluie), vue, bande, RAMPE_PLUIE)
    for (const p of c.particules) {
      if (!p.vive) continue
      expect(p.x, `x=${p.x} hors bande`).toBeGreaterThan(bande.lo)
      expect(p.x, `x=${p.x} hors bande`).toBeLessThan(bande.hi)
    }
  })

  it('la DENSITÉ suit l’intensité en RAMPE CONTINUE — jamais un interrupteur', () => {
    // On promène le cadre du dehors vers le cœur et on relève le compte cible. Il doit
    // monter à chaque pas, sans palier ni saut : c'est « feel = pente continue », mesuré
    // sur toute la rampe et pas à ses bornes.
    const bande: Bande = { axis: 'x', lo: 0, hi: 400 }
    const rampe = RAMPE_PLUIE
    const comptes: number[] = []
    // Le cadre est ÉTROIT (4 tuiles) et on le fait glisser du dehors franc jusqu'au cœur :
    // au premier pas il est entièrement hors bande, au dernier entièrement au plein.
    for (let centre = -4; centre <= rampe; centre += rampe / 24) {
      const c = new ChampParticules(11)
      const vue: Vue = { x0: centre, y0: 40, x1: centre + 4, y1: 64 }
      for (let i = 0; i < 3; i++) c.update(1 / 60, melangeUniforme(PROFILS.pluie), vue, bande, rampe)
      comptes.push(c.cible)
    }
    expect(comptes[0]).toBe(0) // dehors : rien
    expect(comptes[comptes.length - 1]).toBeGreaterThan(0)
    for (let i = 1; i < comptes.length; i++) {
      expect(comptes[i], `pas ${i} : ${comptes[i - 1]} → ${comptes[i]}`).toBeGreaterThanOrEqual(comptes[i - 1]!)
    }
    // Et la montée est RÉELLE, pas deux paliers : au moins la moitié des pas progressent.
    let montees = 0
    for (let i = 1; i < comptes.length; i++) if (comptes[i]! > comptes[i - 1]!) montees++
    expect(montees).toBeGreaterThan(comptes.length / 2)
  })

  it('la densité SPATIALE penche vers le cœur : plus dense dedans que sur la rampe', () => {
    // Le compte global suit la moyenne ; le tirage par REJET fait le gradient DANS le
    // cadre. Sans lui, un cadre à cheval sur la lisière aurait un rideau uniforme.
    const bande: Bande = { axis: 'x', lo: 100, hi: 400 }
    const rampe = RAMPE_PLUIE
    const vue: Vue = { x0: 100, y0: 40, x1: 100 + 2 * rampe, y1: 64 }
    const c = new ChampParticules(2026)
    for (let i = 0; i < 240; i++) c.update(1 / 60, melangeUniforme(PROFILS.pluie), vue, bande, rampe)
    let bord = 0
    let coeur = 0
    for (const p of c.particules) {
      if (!p.vive) continue
      if (p.x < 100 + rampe / 2) bord++
      else if (p.x > 100 + rampe) coeur++
    }
    expect(coeur, `bord ${bord} / cœur ${coeur}`).toBeGreaterThan(bord * 1.5)
  })

  it('NE DÉPASSE JAMAIS le budget — même sur un cadre immense au cœur du front', () => {
    const bande: Bande = { axis: 'x', lo: -1e4, hi: 1e4 }
    const vue: Vue = { x0: 0, y0: 0, x1: 400, y1: 300 } // 120 000 tuiles² : 100 000 gouttes sans plafond
    const c = new ChampParticules(5)
    for (let i = 0; i < 40; i++) c.update(1 / 60, melangeUniforme(PROFILS.blizzard), vue, bande, rampeDe(frontDe('blizzard')))
    expect(c.cible).toBe(BUDGET_PARTICULES)
    expect(c.particules.filter((p) => p.vive).length).toBeLessThanOrEqual(BUDGET_PARTICULES)
  })

  it('tout meurt quand le front sort (`vider`)', () => {
    const c = new ChampParticules(3)
    avancer(c, 'pluie', 60)
    expect(c.vivantes).toBeGreaterThan(0)
    c.vider()
    expect(c.vivantes).toBe(0)
    expect(c.particules.every((p) => !p.vive)).toBe(true)
  })
})

describe('le PRNG est local au client', () => {
  it('est déterministe pour une graine, et différent d’une graine à l’autre', () => {
    const a = creerRng(1)
    const b = creerRng(1)
    const c = creerRng(2)
    const sa = Array.from({ length: 8 }, () => a())
    const sb = Array.from({ length: 8 }, () => b())
    const sc = Array.from({ length: 8 }, () => c())
    expect(sa).toEqual(sb)
    expect(sa).not.toEqual(sc)
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('le brouillard', () => {
  it("n'a AUCUN profil de chute — il ne tombe rien, c'est son signalement", () => {
    expect(PROFILS.brouillard).toBeNull()
  })
})

describe("le rideau ne penche pas d'un côté", () => {
  /**
   * LE DÉFAUT MESURÉ (rapport d'Alexis, 2026-08-23) : « un front d'orage qui arrivait depuis
   * le sud, à sa frontière nord, il y avait bien plus de particules à gauche de l'écran ».
   *
   * L'INVARIANT QUI LE TRANCHE, et il est EXACT plutôt qu'une tolérance choisie : sur une
   * bande d'axe `y`, `intensiteDansBande` NE DÉPEND PAS DE x. La densité du rideau doit donc
   * être UNIFORME EN x sur tout le cadre — où que tombe la lisière. On balaie les dix déciles
   * de largeur et non les deux moitiés : le défaut se logeait tout entier dans le premier.
   *
   * DEUX CAUSES, toutes deux dans `naitre` :
   *   ① le haut du cadre est HORS bande sous une lisière d'amont, donc toute naissance tirée
   *     là sortait à I = 0 et mourait, tandis que celles du bord OUEST (`vent > 0`) passaient ;
   *   ② une particule sortie PAR LE BAS rentrait par un bord tiré AU FLUX — donc parfois à
   *     l'ouest, alors qu'elle vient du haut. Le bord ouest recevait une part de TOUTES les
   *     sorties au lieu des seules sorties à l'est.
   *
   * RELEVÉ, même montage, 6 graines × 300 images, décile le plus chargé RAPPORTÉ À LA MOYENNE
   * (et le plus creux au-dessous) — avant → après :
   *     pluie          8,89 → 1,13   (creux 0,08 → 0,91)
   *     neige          9,48 → 1,17   (creux 0,03 → 0,90)
   *     orage          8,79 → 1,16   (creux 0,08 → 0,87)
   *     blizzard       1,75 → 1,10   (creux 0,44 → 0,90)
   *     vent de cendre 1,52 → 1,16   (creux 0,61 → 0,84)
   * Les deux ciels qui RASENT (blizzard, cendre) penchaient moins parce que leur vent traînait
   * le rideau à travers le cadre — le défaut y était masqué, pas absent.
   */
  const VUE_ECRAN: Vue = { x0: 0, y0: 0, x1: 38, y1: 25 }
  const DECILES = 10
  /**
   * UNE RAMPE LISIBLE, LA MÊME POUR LES CINQ — et c'est un choix d'INSTRUMENT, pas un oubli
   * de `rampeDe`. Ce qu'on teste ici est la GÉOMÉTRIE de `naitre` sous une lisière, or les
   * largeurs réelles ne la rendent pas toutes lisible : le blizzard du Grand Froid et le vent
   * de cendre portent des rampes de 240 et 63 tuiles pour un cadre de 25 (et la pluie des
   * Pluies, 675), si bien que leur rideau tombe à quelques dizaines de particules — on ne lit
   * pas un penchant sur un échantillon que le bruit de tirage emporte. 9 tuiles est la rampe
   * d'une averse d'Ardeur, la plus étroite de l'année ; `l'intensité relue inline` garde la
   * loi de largeur elle-même, ailleurs dans ce fichier.
   */
  const RAMPE_LISIBLE = 9

  /** Le rideau établi sous une lisière d'amont d'axe `y`, en déciles de LARGEUR d'écran. */
  function decilesSousLisiere(aspect: MeteoAspect): { hist: number[]; vivantes: number; cible: number } {
    const profil = PROFILS[aspect]!
    // La lisière d'AMONT tombe à 40 % de la hauteur du cadre : le haut est HORS bande.
    const bande: Bande = { axis: 'y', lo: VUE_ECRAN.y0 + 10, hi: VUE_ECRAN.y0 + 410 }
    const hist = new Array<number>(DECILES).fill(0)
    let vivantes = 0
    let cible = 0
    // PLUSIEURS GRAINES : une seule rend un bruit de tirage qu'on prendrait pour un penchant
    // (relevé 182/126 sur une graine contre 1153/1051 sur huit, au même code).
    for (let graine = 0; graine < 6; graine++) {
      const c = new ChampParticules(1000 + graine * 7919)
      for (let i = 0; i < 300; i++) c.update(1 / 30, melangeUniforme(profil), VUE_ECRAN, bande, RAMPE_LISIBLE)
      vivantes += c.vivantes
      cible += c.cible
      const w = VUE_ECRAN.x1 - VUE_ECRAN.x0
      for (const p of c.particules) {
        if (!p.vive) continue
        const d = Math.floor(((p.x - VUE_ECRAN.x0) / w) * DECILES)
        hist[Math.min(DECILES - 1, Math.max(0, d))]! += 1
      }
    }
    return { hist, vivantes, cible }
  }

  // LES CINQ QUI TOMBENT — le brouillard n'a pas de grain. Et surtout PAS les seuls quatre
  // « classiques » : `vent_de_cendre` porte le plus haut rapport vent/chute de la table
  // (6,43 contre 5,24 au blizzard), c'est-à-dire le profil le PLUS exposé à ce défaut.
  for (const aspect of ['pluie', 'neige', 'orage', 'blizzard', 'vent_de_cendre'] as const) {
    it(`${aspect} — la densité est UNIFORME en x sous une lisière d'axe y`, () => {
      const { hist } = decilesSousLisiere(aspect)
      const total = hist.reduce((a, b) => a + b, 0)
      const moyenne = total / DECILES
      const dit = `déciles ${hist.join(' ')} (moyenne ${moyenne.toFixed(0)})`
      expect(total, dit).toBeGreaterThan(600)
      // Aucun décile ne porte moitié plus que la moyenne, ni moitié moins. Le défaut mettait
      // le premier à NEUF fois la moyenne (et les autres à un douzième) sous la pluie.
      for (let d = 0; d < DECILES; d++) {
        expect(hist[d]!, `décile ${d} — ${dit}`).toBeLessThan(moyenne * 1.5)
        expect(hist[d]!, `décile ${d} — ${dit}`).toBeGreaterThan(moyenne * 0.55)
      }
    })

    it(`${aspect} — la population REJOINT sa cible sous une lisière d'axe y`, () => {
      const { vivantes, cible } = decilesSousLisiere(aspect)
      expect(vivantes, `vivantes ${vivantes} / cible ${cible}`).toBeGreaterThan(cible * 0.8)
    })
  }
})
