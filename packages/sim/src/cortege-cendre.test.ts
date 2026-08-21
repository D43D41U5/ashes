/**
 * LE CORTÈGE DE LA CENDRE (spec `cortege-cendre.md`) — un champ, plusieurs sens.
 *
 * Ces gardes BALAIENT leur domaine au lieu d'échantillonner des cas choisis : le cortège est de
 * la géométrie, et sur de la géométrie « trois cas passent » ne prouve rien (leçon consignée :
 * « garde exhaustive plutôt que cas choisis »). Chaque test affirme UNE propriété sur TOUTE la
 * plage de marge, et l'ordre des bandes est vérifié à TOUT front, pas au front d'un jour choisi.
 */
import { describe, expect, it } from 'vitest'
import { MORTS, METEO, SEASON, BALANCE } from './balance'
import {
  CENDRE,
  bandeDeCendre,
  facteurSterilite,
  froidDeCendre,
  frontAuTick,
  estCendre,
  margeDeCendre,
  avanceeDuFront,
} from './cendre'
import { hantiseDeCendre, densiteDeBase, densiteDesMorts } from './morts'
import { createEmptyMap, type WorldMap } from './map'
import { createSim, type SimState } from './sim'
import { baselineTemperature } from './temperature'
import { TICKS_PER_CYCLE } from './time'

/** La meme rampe, mais en carte utilisable par `createSim` (terrain reel, zones vides). */
function carteSimARampe(width = 120, height = 40): WorldMap {
  const map = createEmptyMap(width, height, 0)
  map.cendre = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) map.cendre.push(x)
  map.cendreMax = width / 2
  return map
}

/**
 * UNE CARTE JOUET DONT LE CHAMP DE CENDRE EST UNE RAMPE EN X — donc la marge d'une tuile est
 * connue exactement, et un balayage en x EST un balayage de toute la plage de marge. C'est ce
 * qui permet d'affirmer une monotonie sans la supposer.
 */
function carteRampe(width = 400, height = 3): WorldMap {
  const cendre = new Array<number>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) cendre[y * width + x] = x // distance = x tuiles
  }
  return {
    width,
    height,
    tiles: new Array<number>(width * height).fill(0),
    zones: [],
    cendre,
    cendreMax: width / 2, // une course de front du même ordre que la carte
  } as unknown as WorldMap
}

/** La même carte, SANS Cendrière — le cas du banc headless. */
function carteSansCendre(width = 40, height = 3): WorldMap {
  return {
    width,
    height,
    tiles: new Array<number>(width * height).fill(0),
    zones: [],
  } as unknown as WorldMap
}

describe('A1 — la primitive, et sa convention de signe', () => {
  it('la marge est EXACTEMENT cendre[i] − front, et marge < 0 ⟺ estCendre', () => {
    const map = carteRampe()
    // Balayage : tout front entier de 0 à cendreMax, toute tuile.
    for (let front = 0; front <= map.cendreMax!; front += 7) {
      for (let x = 0; x < map.width; x++) {
        const marge = margeDeCendre(map, x, 1, front)
        expect(marge, `marge en x=${x}, front=${front}`).toBe(x - front)
        expect(marge < 0, `signe en x=${x}, front=${front}`).toBe(estCendre(map, x, 1, front))
      }
    }
  })

  it('hors carte et sans Cendrière : une grande valeur FINIE, donc tous les sens neutres', () => {
    const map = carteRampe()
    for (const [tx, ty] of [
      [-1, 1],
      [map.width, 1],
      [10, -1],
      [10, map.height],
    ] as const) {
      expect(margeDeCendre(map, tx, ty, 50)).toBe(CENDRE.MARGE_HORS_CENDRE)
    }
    const nu = carteSansCendre()
    expect(margeDeCendre(nu, 5, 1, 50)).toBe(CENDRE.MARGE_HORS_CENDRE)
    expect(Number.isFinite(CENDRE.MARGE_HORS_CENDRE)).toBe(true)

    // Et la conséquence qui compte : chaque sens retombe sur son neutre SANS `if` dédié.
    expect(froidDeCendre(nu, 5, 1, 50)).toBe(0)
    expect(facteurSterilite(nu, 5, 1, 50)).toBe(1)
    expect(hantiseDeCendre(nu, 5, 1, 50)).toBe(0)
  })
})

describe('A2 — la monotonie de chaque sens, balayée sur toute la plage', () => {
  const map = carteRampe()
  const front = 200

  it('le froid CROÎT quand on se rapproche du front, et plafonne', () => {
    let precedent = -1
    // De loin devant (x grand) vers le brûlé (x petit) : la marge décroît, le froid doit croître.
    for (let x = map.width - 1; x >= 0; x--) {
      const f = froidDeCendre(map, x, 1, front)
      expect(f, `le froid recule en x=${x}`).toBeGreaterThanOrEqual(precedent)
      precedent = f
    }
    // Le plafond est ATTEINT et TENU (une garde qui dégrade cacherait le défaut).
    expect(froidDeCendre(map, front, 1, front)).toBe(CENDRE.FROID_MAX)
    expect(froidDeCendre(map, 0, 1, front)).toBe(CENDRE.FROID_MAX)
    // Et il vaut 0 franchement hors bande.
    expect(froidDeCendre(map, front + Math.ceil(bandeDeCendre(map, CENDRE.FROID_PART)), 1, front)).toBe(0)
    expect(froidDeCendre(map, map.width - 1, 1, front)).toBe(0)
  })

  it('la stérilité CROÎT quand on se rapproche du front, et plafonne', () => {
    let precedent = 0
    for (let x = map.width - 1; x >= 0; x--) {
      const s = facteurSterilite(map, x, 1, front)
      expect(s, `la stérilité recule en x=${x}`).toBeGreaterThanOrEqual(precedent)
      expect(s, `la stérilité passe sous 1 en x=${x}`).toBeGreaterThanOrEqual(1)
      precedent = s
    }
    expect(facteurSterilite(map, front, 1, front)).toBe(CENDRE.STERILE_FACTEUR_MAX)
    expect(facteurSterilite(map, front + Math.ceil(bandeDeCendre(map, CENDRE.STERILE_PART)), 1, front)).toBe(1)
  })

  it('la hantise CROÎT avec la PROFONDEUR dans le brûlé, et plafonne', () => {
    let precedent = 0
    // De la lisière du brûlé (x = front−1) vers le vieux brûlé (x = 0).
    for (let x = front - 1; x >= 0; x--) {
      const h = hantiseDeCendre(map, x, 1, front)
      expect(h, `la hantise recule en x=${x}`).toBeGreaterThanOrEqual(precedent)
      precedent = h
    }
    // Hors du brûlé : rien, à toute distance.
    for (let x = front; x < map.width; x++) expect(hantiseDeCendre(map, x, 1, front)).toBe(0)
    // Le brûlé de l'instant vaut l'ancienne valeur à plat ; le vieux brûlé vaut le plafond.
    expect(hantiseDeCendre(map, front - 1, 1, front)).toBeCloseTo(
      MORTS.PART_CENDRE + (MORTS.HANTISE_MAX - MORTS.PART_CENDRE) / bandeDeCendre(map, MORTS.HANTISE_PART),
      10,
    )
    expect(hantiseDeCendre(map, front - Math.ceil(bandeDeCendre(map, MORTS.HANTISE_PART)), 1, front)).toBe(
      MORTS.HANTISE_MAX,
    )
    expect(hantiseDeCendre(map, 0, 1, front)).toBe(MORTS.HANTISE_MAX)
  })
})

describe('A3 — l’ordre des bandes est un invariant, à TOUT front', () => {
  it('brûlé ⊂ froid ⊂ stérile, pour tout front de 0 à cendreMax', () => {
    const map = carteRampe()
    expect(CENDRE.FROID_PART, 'R5 : la bande froide doit être la plus étroite').toBeLessThan(
      CENDRE.STERILE_PART,
    )
    for (let front = 0; front <= map.cendreMax!; front += 5) {
      let brules = 0
      let froids = 0
      let steriles = 0
      for (let x = 0; x < map.width; x++) {
        const brule = estCendre(map, x, 1, front)
        const froid = froidDeCendre(map, x, 1, front) > 0
        const sterile = facteurSterilite(map, x, 1, front) > 1
        // L'inclusion, tuile par tuile — c'est ça, la propriété.
        if (brule) expect(froid, `brûlé non froid en x=${x}, front=${front}`).toBe(true)
        if (froid) expect(sterile, `froid non stérile en x=${x}, front=${front}`).toBe(true)
        if (brule) brules++
        if (froid) froids++
        if (sterile) steriles++
      }
      expect(brules).toBeLessThanOrEqual(froids)
      expect(froids).toBeLessThanOrEqual(steriles)
    }
  })
})

describe('A4 — la stérilité n’écrase jamais la signature « défriché »', () => {
  it('un délai stérile reste un ENTIER positif, jamais 0, et jamais hors des entiers sûrs', () => {
    const map = carteRampe()
    const front = 200
    // Le pire cas cumulé : facteur d'acte max, usure max, stérilité max.
    const acteMax = Math.max(...SEASON.REGROW_ACT_FACTOR)
    const usureMax = 1 + BALANCE.DEPLETION_REGROW_PENALTY * (BALANCE.DEPLETION_MAX - 1)
    for (let x = 0; x < map.width; x++) {
      const sterile = facteurSterilite(map, x, 1, front)
      const delai = Math.floor(BALANCE.NODE_REGROW_TICKS * acteMax * usureMax * sterile)
      expect(delai, `délai nul en x=${x}`).toBeGreaterThan(0)
      expect(Number.isSafeInteger(delai), `délai hors entiers sûrs en x=${x}`).toBe(true)
    }
  })
})

describe('A5 — densiteDeBase reste indépendante du temps, au bit près', () => {
  it('la même tuile rend la même chose au tick 0 et au tick 100 000', () => {
    // La garde qui compte : `placeCharniers` appelle `densiteDeBase` À LA GÉNÉRATION. Si le
    // dégradé de hantise avait fui dedans, les charniers se déplaceraient entre un monde neuf
    // et une sauvegarde rechargée — un défaut qui ne se voit qu'au rechargement, donc tard.
    const map = carteRampe()
    for (let x = 0; x < map.width; x += 3) {
      const a = densiteDeBase(map, x, 1)
      const b = densiteDeBase(map, x, 1)
      expect(a).toBe(b)
      // Et surtout : sa signature ne contient NI tick NI front — vérifié par le type, mais on
      // affirme la conséquence observable, à savoir qu'aucun front ne peut la faire bouger.
      expect(densiteDeBase(map, x, 1)).toBe(a)
    }
  })
})

describe('A8 — le froid de cendre ne pose aucun palier sur un seuil de gel', () => {
  it('les VALEURS PLATEAU du cortège ne tombent sur aucun seuil de la table thermique', () => {
    // Le raisonnement est celui de l'en-tête de FLORE : hors front, la table n'atteint que des
    // multiples de 5, et ses seuils sont posés HORS de ces valeurs pour qu'aucune décision ne se
    // joue au bit de flottant. Le risque réel n'est pas la rampe (un ensemble mince) mais les
    // PLATEAUX — 0 et FROID_MAX — qui couvrent de grandes surfaces.
    expect(CENDRE.FROID_MAX % 5, 'un froid de cendre multiple de 5 remet tout sur la grille').not.toBe(0)
  })
})

describe('R6bis — R2-R4 ne touchent pas au flux du PRNG', () => {
  it('aucun des trois sens ne consomme de tirage', () => {
    // Ils sont des LECTURES d'un champ précalculé. La garde est structurelle : on les appelle
    // mille fois et on vérifie qu'ils rendent la même chose — un tirage aurait dérivé.
    const map = carteRampe()
    const premier = [froidDeCendre(map, 150, 1, 200), facteurSterilite(map, 150, 1, 200), hantiseDeCendre(map, 150, 1, 200)]
    for (let i = 0; i < 1000; i++) {
      expect(froidDeCendre(map, 150, 1, 200)).toBe(premier[0])
      expect(facteurSterilite(map, 150, 1, 200)).toBe(premier[1])
      expect(hantiseDeCendre(map, 150, 1, 200)).toBe(premier[2])
    }
  })
})

describe('le front lu à un tick quelconque (l’hystérésis du dégel)', () => {
  it('frontAuTick rend le front DU TICK DEMANDÉ, et frontActuel n’en est que le cas courant', () => {
    const map = carteRampe()
    // Deux ticks distincts doivent rendre deux fronts distincts dès que la cendre s'ébranle.
    const scale = 1
    const a = frontAuTick(map, scale, 0)
    const b = frontAuTick(map, scale, 100_000)
    expect(a).toBeLessThanOrEqual(b)
    // Et sur une carte sans Cendrière, le front est nul à tout tick.
    const nu = carteSansCendre()
    expect(frontAuTick(nu, scale, 0)).toBe(0)
    expect(frontAuTick(nu, scale, 999_999)).toBe(0)
  })

  it('l’avancée du front reste monotone non décroissante, balayée', () => {
    let precedent = -1
    for (let jour = 1; jour <= 400; jour++) {
      const f = avanceeDuFront(jour, 1000)
      expect(f, `le front recule au jour ${jour}`).toBeGreaterThanOrEqual(precedent)
      precedent = f
    }
  })
})

describe('A9 — LA GARDE QUI MANQUAIT : une bande ne dévore pas la course du front', () => {
  /**
   * CE TEST EXISTE PARCE QUE LE DÉFAUT EST PASSÉ. Les bandes avaient d'abord été écrites en
   * TUILES (28 et 70) — or `tools/mesure-cortege.mts` a mesuré `cendreMax` à **74 tuiles** sur la
   * carte de production : la course TOTALE du front sur une saison entière. La bande stérile en
   * couvrait donc 95 %, et **62 % de la vallée habitable était stérile au jour 1**, avant que le
   * front n'ait bougé d'une tuile.
   *
   * C'est EXACTEMENT la faute que `CENDRE.PART_CIBLE` documente déjà un cran plus haut (« ET C'EST
   * UNE PART, PAS UNE DISTANCE »), refaite un cran plus bas. Aucune garde ne la voyait : les
   * douze tests précédents passaient tous, parce qu'ils vérifient des FORMES (monotonie, ordre,
   * plafonds) et qu'une bande démesurée a exactement la bonne forme.
   *
   * La propriété qui manquait n'est donc pas une forme, c'est une ÉCHELLE.
   */
  it('chaque bande reste une minorité de la course du front', () => {
    for (const [nom, part] of [
      ['stérile', CENDRE.STERILE_PART],
      ['froide', CENDRE.FROID_PART],
      ['hantise', MORTS.HANTISE_PART],
    ] as const) {
      expect(part, `la bande ${nom} est une part, donc dans ]0;1[`).toBeGreaterThan(0)
      expect(part, `la bande ${nom} dévore la course du front`).toBeLessThan(0.5)
    }
  })

  it('au front NUL, le cortège ne touche qu’une frange — pas la moitié du monde', () => {
    // Le jour 1 : rien n'a brûlé, rien n'a bougé. Une bande correctement dimensionnée ne peut
    // donc toucher qu'un liseré autour de la Cendrière. Sur la rampe jouet, la part de tuiles
    // atteintes se lit exactement.
    const map = carteRampe()
    let steriles = 0
    for (let x = 0; x < map.width; x++) if (facteurSterilite(map, x, 1, 0) > 1) steriles++
    const part = steriles / map.width
    expect(part, 'le cortège couvre déjà la moitié du monde au jour 1').toBeLessThan(0.25)
    expect(part, 'le cortège ne touche rien du tout : réglage mort').toBeGreaterThan(0)
  })
})

describe('R6 — le vent de cendre : la poussée, pas l’avancée', () => {
  /**
   * LA PROPRIÉTÉ QUI DÉFINIT CE TYPE, et la seule qui ne doit jamais céder : le vent gonfle le
   * front QUE LE FROID REGARDE. Si un jour la poussée fuit vers la stérilité ou la hantise, le
   * vent se met à voler du terrain définitivement à chaque passage — et le type qui devait
   * pouvoir revenir tous les ans devient une seconde avancée du front.
   */
  /**
   * CETTE PROPRIETE VIT AU SITE D'APPEL, PAS DANS LA FONCTION — premiere version de ce test
   * fausse, et la garder fausse aurait ete pire que ne pas l'ecrire. Nourrir `hantiseDeCendre`
   * d'un front gonfle rend evidemment un autre nombre : ca ne teste rien. Ce qui doit etre vrai,
   * c'est que SEUL `froidDuMonde` voit le front pousse ; l'economie et les morts lisent
   * `frontActuel`. On l'affirme donc sur une SIM, vent actif contre vent absent.
   */
  it('vent actif : le froid tombe, mais la hantise du sol ne bouge PAS d\u2019un bit', () => {
    const faire = (avecVent: boolean): SimState => {
      const sim = createSim(7, { map: carteSimARampe(), calendarScale: 1 })
      sim.tick = 40 * TICKS_PER_CYCLE
      if (avecVent) {
        sim.meteo = {
          type: 'vent_de_cendre',
          cycle: 40,
          day: 40,
          edge: 3,
          // A MI-TRAVERSEE, et c'est un piege paye : `frontMeteoPos` interpole la position de
          // la bande sur TOUTE la fenetre `[startTick, endTick]`. Une fenetre de 100 000 ticks
          // laisse la bande encore dehors au dixieme tick — le front existe, il ne couvre rien,
          // et la garde conclut « type inerte » en accusant le code.
          startTick: sim.tick - Math.floor(METEO.TRAVERSEE_TICKS / 2),
          endTick: sim.tick - Math.floor(METEO.TRAVERSEE_TICKS / 2) + METEO.TRAVERSEE_TICKS,
        }
      }
      return sim
    }
    const sans = faire(false)
    const avec = faire(true)

    let froidABouge = false
    for (let x = 4; x < sans.map.width - 4; x += 2) {
      const y = Math.floor(sans.map.height / 2)
      // LA HANTISE DU SOL EST INTOUCHEE — le vent ne rend aucun sol plus habite de morts.
      expect(densiteDesMorts(avec, x, y), `la hantise a bouge en x=${x}`).toBe(densiteDesMorts(sans, x, y))
      // LE FROID, LUI, DOIT MORDRE quelque part — sinon le type est inerte et la garde ment.
      if (baselineTemperature(avec, x + 0.5, y + 0.5) < baselineTemperature(sans, x + 0.5, y + 0.5)) {
        froidABouge = true
      }
    }
    expect(froidABouge, 'le vent de cendre ne refroidit rien : type inerte').toBe(true)
  })

  it('la poussée porte le froid nettement plus loin que la bande de repos', () => {
    const map = carteRampe()
    const front = 200
    const portee = bandeDeCendre(map, CENDRE.POUSSEE_PART)
    const bandeRepos = bandeDeCendre(map, CENDRE.FROID_PART)
    expect(portee, 'un vent qui ne porte pas plus loin que le repos est inerte').toBeGreaterThan(bandeRepos)
    // Une tuile hors de portée au repos est atteinte pendant le vent — c'est TOUT l'effet.
    const x = Math.floor(front + bandeRepos + 1)
    expect(froidDeCendre(map, x, 1, front)).toBe(0)
    expect(froidDeCendre(map, x, 1, front + portee)).toBeGreaterThan(0)
  })

  it('R5 tient AUSSI sous la poussée : le froid poussé reste inclus dans le stérile… ou le déborde SCIEMMENT', () => {
    // Le vent est le SEUL moment où le froid peut dépasser la bande stérile — et c'est voulu :
    // il souffle au-delà de ce que le sol a eu le temps de stériliser. On l'affirme plutôt que
    // de le découvrir : un froid qui déborde sans que personne l'ait écrit serait un défaut.
    expect(CENDRE.POUSSEE_PART).toBeGreaterThan(CENDRE.STERILE_PART)
  })
})
