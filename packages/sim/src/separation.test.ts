import { describe, expect, it } from 'vitest'
import { BALANCE, COMBAT, MONSTER_DEFS, TERRAIN_GRASS, TERRAIN_ROCK, type MonsterType } from './balance'
import { createEmptyMap, setTile } from './map'
import { spawnMonster } from './monsters'
import { advanceSeparation } from './separation'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type MoveInput, type SimState } from './sim'

const CONTACT_X = BALANCE.AVATAR_HITBOX_TILES
const CONTACT_Y = BALANCE.AVATAR_HITBOX_DEPTH_TILES

function makeSim(): SimState {
  return createSim(5, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
}

const at = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!

/** Pose un corps à une position exacte (spawn puis replacement — le spawn cherche une case libre). */
function corpsA(sim: SimState, x: number, y: number): number {
  const id = spawnEntity(sim, x, y)
  const e = at(sim, id)
  e.x = x
  e.y = y
  return id
}

/** Le RECOUVREMENT normalisé de deux corps : < 1 ⇒ ils se traversent, ≥ 1 ⇒ ils se touchent au plus. */
function ecart(sim: SimState, a: number, b: number): number {
  const ea = at(sim, a)
  const eb = at(sim, b)
  const u = (eb.x - ea.x) / CONTACT_X
  const v = (eb.y - ea.y) / CONTACT_Y
  return Math.sqrt(u * u + v * v)
}

/**
 * CE QUI FERAIT ROUGIR, énoncé avant tout vert :
 *  · deux corps qui restent l'un dans l'autre après la passe (la plainte d'origine) ;
 *  · un corps poussé DANS un mur ou hors carte ;
 *  · une poussée non bornée (la mêlée catapulte) ;
 *  · un cerné qui ne peut plus sortir (l'emmurement — le vrai risque de cette règle) ;
 *  · un tirage consommé (le flux du PRNG décalerait tout le reste du jeu).
 */
describe('la séparation — les corps prennent de la place', () => {
  it('DEUX CORPS CONFONDUS SE DÉCOLLENT, et ils finissent par ne plus se recouvrir', () => {
    const sim = makeSim()
    const a = corpsA(sim, 20, 20)
    const b = corpsA(sim, 20, 20)
    expect(ecart(sim, a, b)).toBe(0)
    for (let t = 0; t < 20; t++) advanceSeparation(sim)
    expect(ecart(sim, a, b)).toBeGreaterThanOrEqual(1 - COMBAT.SEPARATION_DEADBAND)
  })

  it('BALAYAGE : d’où qu’il vienne, un corps qui en recouvre un autre cesse de le recouvrir', () => {
    // Tout le voisinage, au pas de 1/16 de tuile — pas trois positions choisies.
    for (let dx = -0.8; dx <= 0.8001; dx += 0.0625) {
      for (let dy = -0.5; dy <= 0.5001; dy += 0.0625) {
        const sim = makeSim()
        const a = corpsA(sim, 20, 20)
        const b = corpsA(sim, 20 + dx, 20 + dy)
        for (let t = 0; t < 30; t++) advanceSeparation(sim)
        // La ZONE MORTE est la borne : la règle repousse jusqu'au contact plein, et ne
        // remord pas tant qu'on n'y rentre pas franchement. C'est elle qu'on affirme —
        // écrire `1` ici serait affirmer un contact que l'hystérésis ne promet pas.
        expect(ecart(sim, a, b)).toBeGreaterThanOrEqual(1 - COMBAT.SEPARATION_DEADBAND)
      }
    }
  })

  it('LE CORPS EST UNE ELLIPSE : on s’écarte plus côte à côte que l’un derrière l’autre', () => {
    const cote = makeSim()
    const ca = corpsA(cote, 20, 20)
    const cb = corpsA(cote, 20.05, 20)
    for (let t = 0; t < 30; t++) advanceSeparation(cote)
    const largeur = Math.abs(at(cote, cb).x - at(cote, ca).x)

    const file = makeSim()
    const fa = corpsA(file, 20, 20)
    const fb = corpsA(file, 20, 20.05)
    for (let t = 0; t < 30; t++) advanceSeparation(file)
    const profondeur = Math.abs(at(file, fb).y - at(file, fa).y)

    expect(largeur).toBeCloseTo(CONTACT_X, 2)
    expect(profondeur).toBeCloseTo(CONTACT_Y, 2)
    // La forme du corps, pas un réglage : ce qui est derrière passe derrière.
    expect(profondeur).toBeLessThan(largeur)
  })

  it('UN MUR ARRÊTE LA POUSSÉE : personne n’est repoussé dans la roche', () => {
    const sim = makeSim()
    // Une colonne de roche à l'ouest du couple : la poussée y bute.
    for (let ty = 15; ty < 25; ty++) setTile(sim.map, 18, ty, TERRAIN_ROCK)
    const a = corpsA(sim, 19.5, 20)
    const b = corpsA(sim, 19.55, 20)
    for (let t = 0; t < 30; t++) advanceSeparation(sim)
    for (const id of [a, b]) {
      const e = at(sim, id)
      // Le bord est de la roche est à x = 19 ; un corps de demi-largeur 0,375 ne peut pas
      // avoir son centre en deçà de 19,375 sans être DANS le mur.
      expect(e.x).toBeGreaterThanOrEqual(19 + BALANCE.AVATAR_HITBOX_TILES / 2 - 1e-6)
    }
  })

  it('LA MÊLÉE NE CATAPULTE PAS : cerné de huit corps, on ne bouge pas de plus que le plafond en un tick', () => {
    const sim = makeSim()
    const moi = corpsA(sim, 20, 20)
    for (const [dx, dy] of [[-0.2, 0], [0.2, 0], [0, -0.1], [0, 0.1], [-0.15, -0.08], [0.15, -0.08], [-0.15, 0.08], [0.15, 0.08]]) {
      corpsA(sim, 20 + dx!, 20 + dy!)
    }
    const avant = { x: at(sim, moi).x, y: at(sim, moi).y }
    advanceSeparation(sim)
    const e = at(sim, moi)
    const d = Math.sqrt((e.x - avant.x) * (e.x - avant.x) + (e.y - avant.y) * (e.y - avant.y))
    expect(d).toBeLessThanOrEqual(COMBAT.SEPARATION_MAX_TILES + 1e-9)
  })

  it('ON S’EXTIRPE D’UN CERCLE — c’est la contrepartie de la règle, et elle se prouve', () => {
    // LE VRAI RISQUE de faire des corps des obstacles : la cage sans porte. Huit corps
    // serrés autour de l'avatar, et il marche plein est pendant deux secondes. S'il est
    // emmuré, il n'avance pas — et la règle est à jeter.
    const sim = makeSim()
    const moi = corpsA(sim, 20, 20)
    for (const [dx, dy] of [[-0.5, 0], [0.5, 0], [0, -0.3], [0, 0.3], [-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]]) {
      corpsA(sim, 20 + dx!, 20 + dy!)
    }
    const x0 = at(sim, moi).x
    const inputs: MoveInput[] = [{ entityId: moi, dx: 1, dy: 0 }]
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) step(sim, inputs)
    const parcouru = at(sim, moi).x - x0

    // LE TÉMOIN EST JOUÉ, jamais écrit : le même montage sans personne autour. Un nombre
    // en dur ici se périmerait au premier réglage de la vitesse de marche.
    const libre = makeSim()
    const seul = corpsA(libre, 20, 20)
    const l0 = at(libre, seul).x
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) step(libre, [{ entityId: seul, dx: 1, dy: 0 }])
    const temoin = at(libre, seul).x - l0

    // CE QU'ON AFFIRME : il SORT. Un corps emmuré ne quitterait pas le rayon de la cage
    // (moins d'une tuile) ; celui-ci en couvre près de la moitié du témoin — il pousse
    // devant lui les deux corps qui le gênent, et ça se sent : c'est voulu.
    // MESURÉ : 3,88 tuiles contre 8,0 au témoin, soit 48 %.
    expect(parcouru).toBeGreaterThan(temoin * 0.35)
    expect(parcouru).toBeGreaterThan(2)
  })

  it('LE REJEU TOMBE PILE, CORPS EMMÊLÉS (invariant §2)', () => {
    // Les gardes de replay existantes ne mettent aucun corps en contact : le déterminisme du
    // nouveau chemin y serait vrai par CONSTRUCTION, jamais par mesure. On le joue donc.
    const options = { map: createEmptyMap(40, 40, TERRAIN_GRASS) }
    const setup = (state: SimState): void => {
      // Trois corps confondus au même point : le cas dégénéré (aucun axe ne se dégage),
      // celui qui se sépare « par l'identité » — le seul endroit où un tirage aurait pu se
      // glisser, et le seul où l'ordre d'itération pourrait mordre.
      for (let i = 0; i < 3; i++) {
        const id = spawnEntity(state, 20, 20)
        const e = state.entities.find((x) => x.id === id)!
        e.x = 20
        e.y = 20
      }
    }
    const live = createSim(9, options)
    const log = createReplayLog(9, options)
    setup(live)
    const joueur = live.entities[live.entities.length - 1]!.id
    for (let t = 0; t < 400; t++) {
      recordAndStep(live, log, [{ entityId: joueur, dx: t % 3 === 0 ? 1 : -1, dy: t % 4 === 0 ? 1 : 0 }])
    }
    expect(snapshot(runReplay(log, setup))).toBe(snapshot(live))
  })

  it('AUCUN TIRAGE : le flux du PRNG est le même avec ou sans corps à séparer', () => {
    const sim = makeSim()
    corpsA(sim, 20, 20)
    corpsA(sim, 20.05, 20.02)
    const avant = sim.rngState
    advanceSeparation(sim)
    expect(sim.rngState).toBe(avant)
  })

  it('ÉTEINTE À ZÉRO : `SEPARATION_PUSH` est le seul interrupteur, et il ne laisse rien passer', () => {
    // La garde ARME la constante le temps du bloc — le jour où on l'éteint pour de bon,
    // on sait déjà que rien ne bouge.
    const vrai = COMBAT.SEPARATION_PUSH
    try {
      ;(COMBAT as { SEPARATION_PUSH: number }).SEPARATION_PUSH = 0
      const sim = makeSim()
      const a = corpsA(sim, 20, 20)
      const b = corpsA(sim, 20, 20)
      for (let t = 0; t < 20; t++) advanceSeparation(sim)
      expect(ecart(sim, a, b)).toBe(0)
    } finally {
      ;(COMBAT as { SEPARATION_PUSH: number }).SEPARATION_PUSH = vrai
    }
  })
})

describe('chaque espèce son emprise (A17bis, R4septies)', () => {
  /**
   * À quelle distance deux corps cessent-ils de se pousser ? On les pose côte à côte,
   * on approche jusqu'à ce que la règle morde, et on rend la distance de DÉCROCHAGE —
   * celle où la poussée devient nulle. C'est la mesure du CONTACT, et elle se lit sur le
   * comportement, jamais sur la constante qui le produit.
   */
  function contactMesure(espece: MonsterType | null): number {
    // On balaie de loin vers près, au soixante-quatrième de tuile : la première distance
    // qui POUSSE. Les corps sont posés à la main (`corpsA` / replacement) — un spawn
    // cherche une case libre et déplacerait le montage sous le pied de la mesure.
    for (let d = 1.6; d > 0.02; d -= 1 / 64) {
      const sim = makeSim()
      corpsA(sim, 20, 20)
      let b: number
      if (espece === null) b = corpsA(sim, 20 + d, 20)
      else {
        b = spawnMonster(sim, espece, 20 + d, 20)
        at(sim, b).x = 20 + d
        at(sim, b).y = 20
      }
      const avant = at(sim, b).x
      advanceSeparation(sim)
      if (Math.abs(at(sim, b).x - avant) > 1e-9) return d
    }
    return 0
  }

  it('un LAPIN ne bouscule pas un homme comme un homme le ferait', () => {
    // ═══ L'INJUSTICE QUI SE VOYAIT (spec R4septies, réserve du 2026-08-27) ═══
    //
    // « Un lapin a la même emprise qu'un homme. » Il fallait une donnée neuve ; la voici,
    // et on la mesure sur ce qu'elle produit : la distance à laquelle les corps se touchent.
    const entreHommes = contactMesure(null)
    const contreLapin = contactMesure('rabbit')
    expect(contreLapin).toBeGreaterThan(0) // il a un corps : il ne s'est pas évaporé…
    expect(contreLapin).toBeLessThan(entreHommes) // …mais il tient beaucoup moins de place
  })

  it('LE BESTIAIRE EST ORDONNÉ : ce qui est gros se touche de plus loin', () => {
    // Une garde qui n'éprouverait qu'une espèce serait vraie par accident. On affirme
    // l'ORDRE sur tout le bestiaire — c'est la propriété, et elle survit à un réglage.
    const especes = (Object.keys(MONSTER_DEFS) as MonsterType[])
      .map((e) => ({ e, corps: MONSTER_DEFS[e].corps ?? 1, contact: contactMesure(e) }))
      .sort((x, y) => x.corps - y.corps)
    expect(especes.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < especes.length; i++) {
      const petit = especes[i - 1]!
      const grand = especes[i]!
      if (petit.corps === grand.corps) expect(grand.contact).toBeCloseTo(petit.contact, 5)
      else expect(grand.contact).toBeGreaterThan(petit.contact)
    }
  })

  it('remettre TOUTES les emprises à 1 rend exactement le comportement d’avant', () => {
    // La garde de non-régression : la règle par espèce ne doit RIEN changer d'autre. Si
    // une emprise uniforme ne redonnait pas le contact entre hommes, c'est que la
    // per-espèce aurait déplacé la géométrie de tout le monde au passage.
    const repos = new Map<MonsterType, number | undefined>()
    for (const e of Object.keys(MONSTER_DEFS) as MonsterType[]) {
      repos.set(e, MONSTER_DEFS[e].corps)
      ;(MONSTER_DEFS[e] as { corps?: number }).corps = 1
    }
    try {
      const entreHommes = contactMesure(null)
      for (const e of Object.keys(MONSTER_DEFS) as MonsterType[]) {
        expect(contactMesure(e), e).toBeCloseTo(entreHommes, 5)
      }
    } finally {
      for (const [e, v] of repos) {
        const def = MONSTER_DEFS[e] as { corps?: number }
        if (v === undefined) delete def.corps
        else def.corps = v
      }
    }
  })
})
