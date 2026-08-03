import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BALANCE, COMBAT, MONSTER_DEFS, SLOTS, TERRAIN_GRASS, TERRAIN_ROCK, WEAPON_DAMAGE, WEAPON_PROFILES } from './balance'
import { drainEvents } from './events'
import { countOf, inventoryOf, makeInventory, stackSize, type Inventory, type ItemBag, type ItemId } from './items'
import { die, weaponDamage } from './combat'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { foundNpcVillage } from './worldgen'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { TICKS_PER_CYCLE } from './time'
import { grantItems } from './village'

function makeSim(): SimState {
  return createSim(5, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
}

const entity = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!

/**
 * Donne l'objet ET LE MET EN MAIN. L'arme TENUE fait foi (spec inventaire R9) :
 * une lance au fond du sac ne frappe pas plus fort qu'un poing.
 */
function grantHeld(sim: SimState, entityId: number, item: ItemId, others: ItemBag = {}): void {
  grantItems(sim, entityId, { [item]: 1, ...others })
  const e = entity(sim, entityId)
  e.activeSlot = e.inventory.findIndex((s) => s !== null && s.item === item)
}

function tick(sim: SimState, inputs: MoveInput[] = []): void {
  step(sim, inputs)
}

/** Attaque et laisse le wind-up se résoudre. */
function strike(sim: SimState, attackerId: number, dx: number, dy: number, targetInputs: MoveInput[] = []): void {
  tick(sim, [{ entityId: attackerId, dx: 0, dy: 0, action: { type: 'attack', dx, dy } }, ...targetInputs])
  for (let t = 0; t < COMBAT.WINDUP_TICKS; t++) tick(sim, targetInputs)
  // Cooldown avant la prochaine attaque.
  for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(sim, [])
}

/**
 * MAINTIENT LE CLIC `holdTicks` ticks, puis relâche — et laisse le coup se résoudre.
 * C'est le VRAI geste du joueur (`attack_charge` … `attack_release`) : la sim compte
 * le maintien, et c'est elle seule qui décide si le coup sort simple ou lourd.
 */
function chargedStrike(sim: SimState, attackerId: number, dx: number, dy: number, holdTicks: number): void {
  tick(sim, [{ entityId: attackerId, dx: 0, dy: 0, action: { type: 'attack_charge', dx, dy } }])
  for (let t = 0; t < holdTicks; t++) tick(sim)
  tick(sim, [{ entityId: attackerId, dx: 0, dy: 0, action: { type: 'attack_release', dx, dy } }])
  for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
}

describe('l’endurance (A1)', () => {
  it('attaquer coûte, à 0 c’est refusé ; la régén dépend de la faim', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    drainEvents(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    // Le coût est celui de L'ARME TENUE (WEAPON_PROFILES), pas d'une constante globale :
    // un poing (8) ne coûte pas ce que coûte un coup de hache (18).
    expect(entity(sim, a).stamina).toBeLessThanOrEqual(100 - WEAPON_PROFILES.unarmed.light.stamina)

    entity(sim, a).stamina = 5
    delete entity(sim, a).windup
    entity(sim, a).cooldownUntil = 0
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    const reasons = drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))
    expect(reasons).toContain('à bout de souffle')

    // Régén : repu (>70) vs affamé (0), à l'arrêt.
    const fed = spawnEntity(sim, 20, 20)
    const starved = spawnEntity(sim, 25, 25)
    entity(sim, fed).stamina = 50
    entity(sim, starved).stamina = 50
    entity(sim, starved).hunger = 0
    tick(sim)
    const fedGain = entity(sim, fed).stamina - 50
    const starvedGain = entity(sim, starved).stamina - 50
    expect(fedGain / starvedGain).toBeCloseTo(COMBAT.FED_REGEN_BONUS / COMBAT.STARVED_REGEN_MALUS, 2)
  })

  it('le sprint accélère ×1.5 et draine', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    tick(sim, [{ entityId: a, dx: 1, dy: 0 }])
    const normal = entity(sim, a).x - 10
    const before = entity(sim, a).stamina
    tick(sim, [{ entityId: a, dx: 1, dy: 0, sprint: true }])
    const sprinted = entity(sim, a).x - 10 - normal
    expect(sprinted / normal).toBeCloseTo(COMBAT.SPRINT_FACTOR, 2)
    expect(entity(sim, a).stamina).toBeLessThan(before)
  })

  /**
   * LE SOUFFLE NE REVIENT PAS EN COURANT (A1bis, 2026-08-01). La ponction du sprint
   * et la régén vivaient dans le MÊME tick, à deux phases de distance : `step` drainait
   * 8/s dans la boucle de mouvement, puis `advanceCombat` recréditait 5/s (×1.25 repu)
   * — jamais gardé contre le sprint, seulement contre le wind-up, la parade et la charge.
   * Net : 1,75/s repu, soit **57 s** de course au lieu des 12,5 s sur lesquels
   * `PURSUIT_RANGE` calibre le loup. La meute était insemable sur le papier seul.
   *
   * D'où le test sur `step()` entier : chaque phase prise à part était juste, le défaut
   * ne vivait que dans l'espace entre les deux.
   */
  it('sprinter ne régénère pas : la barre pleine dure ce que la ponction dit', () => {
    // 12,5 s à 6 t/s = 75 tuiles parcourues : il faut de la place, sinon le mur
    // arrête l'avatar et c'est l'autre moitié du défaut qu'on mesurerait.
    const sim = createSim(5, { map: createEmptyMap(200, 200, TERRAIN_GRASS) })
    const a = spawnEntity(sim, 10, 100)
    entity(sim, a).hunger = 100 // le cas le PLUS favorable (régén ×1.25 si elle s'appliquait)
    let ticks = 0
    while (entity(sim, a).stamina > 0 && ticks < 60 * BALANCE.TICK_RATE_HZ) {
      tick(sim, [{ entityId: a, dx: 1, dy: 0, sprint: true }])
      ticks++
    }
    const attendu = (100 / COMBAT.SPRINT_STAMINA_PER_S) * BALANCE.TICK_RATE_HZ
    expect(ticks).toBeGreaterThanOrEqual(attendu - 2)
    expect(ticks).toBeLessThanOrEqual(attendu + 2)
  })

  it('sprinter contre un mur ne fait pas MONTER l’endurance', () => {
    // `entity.moved` reste faux quand la collision annule le pas — la régén repassait
    // alors au taux REPOS (10/s), plus haut que la ponction : on reprenait son souffle
    // en s'usant sur un mur.
    const sim = makeSim()
    const a = spawnEntity(sim, 1, 10)
    entity(sim, a).hunger = 100
    const ouest: MoveInput[] = [{ entityId: a, dx: -1, dy: 0, sprint: true }]
    for (let t = 0; t < 20; t++) tick(sim, ouest) // plein ouest, jusqu'à se tasser dans le bord
    const xPinne = entity(sim, a).x
    const souffle = entity(sim, a).stamina
    for (let t = 0; t < 20; t++) tick(sim, ouest)
    expect(entity(sim, a).x).toBe(xPinne) // il est bien bloqué : c'est CE cas-là qu'on mesure
    expect(entity(sim, a).stamina).toBeLessThan(souffle)
  })

  /**
   * À BOUT DE SOUFFLE, ON MARCHE — ET ON N'OSCILLE PAS (A1quater, 2026-08-01).
   *
   * Le défaut que la garde `gait === 'sprint'` a CRÉÉ, et qui rendait tout le correctif
   * vain : à 0 d'endurance, `speedScaleFor` refuse la course (il exige `stamina > 0`),
   * donc l'allure retombe à `walk`, donc la régén crédite — et au tick suivant il reste
   * assez pour repartir en sprint, qui reponctionne à 0. **Un cycle de deux ticks à
   * 10 Hz**, touche SHIFT jamais relâchée : une tuile sur deux courue, soit 5 t/s en
   * moyenne, indéfiniment. Le loup court à 4,8 — le joueur le semait ENCORE, à endurance
   * nulle, ce qui est très exactement la plainte d'origine.
   *
   * C'est la quatrième fois que ce dépôt l'apprend (cohésion et séparation dans
   * `faune.ts`, le verrou `wary`) : **un seuil qui commande un mouvement veut son
   * hystérésis**. On sort d'épuisement à `SPRINT_RECOVER_STAMINA`, pas au premier point
   * regagné.
   */
  it('à 0 d’endurance, SHIFT tenu ne fait plus que MARCHER — aucune oscillation', () => {
    const sim = createSim(5, { map: createEmptyMap(200, 200, TERRAIN_GRASS) })
    const a = spawnEntity(sim, 10, 100)
    entity(sim, a).stamina = 0
    entity(sim, a).hunger = 100 // le cas le plus favorable à la régén, donc à l'oscillation
    const est: MoveInput[] = [{ entityId: a, dx: 1, dy: 0, sprint: true }]

    // LES RAFALES DE COURSE, pas leur nombre. Ce qui définissait le défaut, ce n'est pas
    // « il court trop » — c'est qu'il courait UN TICK SUR DEUX. On relève donc la longueur
    // de chaque salve d'allure `sprint` : la version cassée n'en produisait QUE des salves
    // de 1 tick. Compter les ticks totaux ne l'aurait pas distingué d'une vraie reprise.
    const salves: number[] = []
    let courante = 0
    const TICKS = 400 // 20 s : bien au-delà des 4 s qu'il faut pour ressortir d'épuisement
    for (let t = 0; t < TICKS; t++) {
      tick(sim, est)
      if (entity(sim, a).gait === 'sprint') courante++
      else if (courante > 0) { salves.push(courante); courante = 0 }
    }
    if (courante > 0) salves.push(courante)

    // L'ÉPUISÉ RESSORT : passé `SPRINT_RECOVER_STAMINA` il recourt — sans quoi ce test
    // passerait au vert sur un sprint définitivement mort, ce qui n'est pas la règle.
    expect(salves.length).toBeGreaterThan(0)
    // ET C'EST LA PROPRIÉTÉ : aucune salve ne dure un battement. La plus courte doit tenir
    // au moins une seconde — l'oscillation en produisait de 1 tick, soit 50 ms.
    expect(Math.min(...salves)).toBeGreaterThanOrEqual(BALANCE.TICK_RATE_HZ)

    // ET LA CONSÉQUENCE DE JEU, mesurée contre un TÉMOIN plutôt qu'un nombre écrit à la
    // main : les deux premières secondes à 0 d'endurance sont STRICTEMENT celles d'un
    // marcheur. L'oscillation en rendait 1,25× — c'est ce facteur-là qui semait la meute.
    const marcheur = (sprint: boolean): number => {
      const s = createSim(5, { map: createEmptyMap(200, 200, TERRAIN_GRASS) })
      const id = spawnEntity(s, 10, 100)
      entity(s, id).stamina = 0
      entity(s, id).hunger = 100
      const x0 = entity(s, id).x
      for (let t = 0; t < 40; t++) tick(s, [{ entityId: id, dx: 1, dy: 0, ...(sprint ? { sprint: true } : {}) }])
      return entity(s, id).x - x0
    }
    expect(marcheur(true)).toBeCloseTo(marcheur(false), 6)
  })

  /**
   * LE SOUFFLE SE PAIE EN VENTRE (R2, décision Alexis 2026-08-01). Deux avatars dans
   * la MÊME sim, sur les MÊMES ticks : l'un a une barre à refaire, l'autre l'a pleine.
   * L'écart de faim entre eux est donc EXACTEMENT le prix de la récupération — la faim
   * passive, elle, les frappe pareil et s'annule dans la soustraction.
   */
  it('récupérer de l’endurance coûte de la faim — et seulement ce qui est crédité', () => {
    const sim = makeSim()
    const vide = spawnEntity(sim, 10, 10)
    const plein = spawnEntity(sim, 30, 30)
    entity(sim, vide).stamina = 0
    entity(sim, plein).stamina = 100
    entity(sim, vide).hunger = 100
    entity(sim, plein).hunger = 100
    // Le temps qu'il faut pour refaire la barre à l'arrêt, et un peu plus : la fin du
    // test se joue barre pleine, où le clamp ne crédite plus rien.
    for (let t = 0; t < 15 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    expect(entity(sim, vide).stamina).toBe(100)
    const prix = entity(sim, plein).hunger - entity(sim, vide).hunger
    expect(prix).toBeCloseTo(100 * COMBAT.STAMINA_REGEN_HUNGER_COST, 5)
    // …et la barre pleine, elle, n'a rien payé de plus que sa faim passive : c'est ce
    // que garantit la facturation sur les points RÉELLEMENT crédités (après le clamp).
    const passive = (BALANCE.HUNGER_PER_CYCLE_HOUR / (TICKS_PER_CYCLE / 24)) * 15 * BALANCE.TICK_RATE_HZ
    expect(100 - entity(sim, plein).hunger).toBeCloseTo(passive, 5)
  })
})

describe('le télégraphe (A2)', () => {
  it('le coup ne porte qu’à la fin du wind-up ; sortir de l’arc esquive', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11, 10)
    // Coup qui touche : b immobile.
    strike(sim, a, 1, 0)
    expect(entity(sim, b).hp).toBeCloseTo(100 - COMBAT.UNARMED_DAMAGE, 1)

    // b s'écarte PENDANT le wind-up : le coup fend l'air.
    entity(sim, b).hp = 100
    entity(sim, b).x = 11
    entity(sim, b).y = 10
    const avantX = entity(sim, a).x
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < COMBAT.WINDUP_TICKS; t++) {
      tick(sim, [{ entityId: b, dx: 0, dy: 1, sprint: true }]) // fuit vers le sud
    }
    expect(entity(sim, b).hp).toBe(100)
    // ON AVANCE EN FRAPPANT (spec R4bis) : le coup de poing porte le corps d'un pas —
    // c'est le déplacement de la SIM (la position est autoritative), pas une animation.
    // Le pas est BORNÉ par le `lunge` du profil : frapper n'est pas une téléportation.
    const pas = entity(sim, a).x - avantX
    expect(pas).toBeGreaterThan(0)
    expect(pas).toBeLessThanOrEqual(WEAPON_PROFILES.unarmed.light.lunge + 0.001)
  })

  it('le pas des poings ZIGZAGUE : gauche, droite, gauche (spec R4bis)', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const me = entity(sim, a)

    // Deux coups de poing d'affilée, vers l'est. La visée est la MÊME ; le PIED, non.
    strike(sim, a, 1, 0)
    const apres1 = me.y
    strike(sim, a, 1, 0)
    const apres2 = me.y

    // Le premier pas dévie d'un côté, le second de l'autre : les écarts sont de signes
    // opposés. Sans ça, les coups successifs traceraient une ligne droite — et le
    // combat à mains nues n'aurait aucun corps.
    expect(apres1 - 10).not.toBeCloseTo(0, 2)
    expect((apres1 - 10) * (apres2 - apres1)).toBeLessThan(0)
    // Et on a bien AVANCÉ, malgré le zigzag.
    expect(me.x).toBeGreaterThan(10 + WEAPON_PROFILES.unarmed.light.lunge)
  })
})

/**
 * CHAQUE ARME A SA GÉOMÉTRIE (spec combat R4bis, décision 2026-07-13). C'est ELLE qui
 * porte l'identité d'une arme — pas son chiffre de dégâts. Ces tests prouvent les
 * trois vérités qui rendent le choix d'arme réel ; s'ils tombent, le joueur n'a plus
 * qu'une échelle de puissance à monter, et le combat n'est plus un choix.
 */
describe('la géométrie des armes (A13)', () => {
  it('L’ALLONGE : la lance touche à 2 tuiles, le poing n’y arrive pas', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 12, 10) // 2 tuiles : hors de portée d'un bras

    // Mains nues (portée 1,1 + le pas) : on frappe dans le vide.
    strike(sim, a, 1, 0)
    expect(entity(sim, b).hp).toBe(100)

    // La lance en main : elle atteint. C'est TOUTE sa raison d'être — tenir le loup
    // à distance, frapper avant d'être mordu.
    entity(sim, a).x = 10
    entity(sim, a).y = 10
    grantHeld(sim, a, 'spear')
    strike(sim, a, 1, 0)
    expect(entity(sim, b).hp).toBeLessThan(100)
  })

  it('LE BALAYAGE : la hache prend DEUX corps d’un coup, la lance un seul', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    // Deux cibles écartées de part et d'autre de la visée (est), à ±40° environ.
    const gauche = spawnEntity(sim, 10.9, 9.3)
    const droite = spawnEntity(sim, 10.9, 10.7)

    grantHeld(sim, a, 'spear')
    strike(sim, a, 1, 0)
    const touchesLance = [gauche, droite].filter((id) => entity(sim, id).hp < 100).length
    expect(touchesLance).toBe(0) // le pic passe ENTRE les deux

    grantHeld(sim, a, 'iron_axe')
    entity(sim, a).x = 10
    entity(sim, a).y = 10
    strike(sim, a, 1, 0)
    // L'arc large de la hache attrape les DEUX. C'est sa réponse à la horde — et le
    // prix, c'est la portée courte et le coup lent.
    expect(entity(sim, gauche).hp).toBeLessThan(100)
    expect(entity(sim, droite).hp).toBeLessThan(100)
  })

  it('LE TOURBILLON : la hache chargée frappe DERRIÈRE soi (cône de 360°)', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const devant = spawnEntity(sim, 11.2, 10)
    const derriere = spawnEntity(sim, 8.8, 10) // dans le DOS : aucun coup normal ne l'atteint
    grantHeld(sim, a, 'iron_axe')

    // Coup simple vers l'est : celui de derrière est intact.
    strike(sim, a, 1, 0)
    expect(entity(sim, devant).hp).toBeLessThan(100)
    expect(entity(sim, derriere).hp).toBe(100)

    // Chargé (maintien mûr) : le tour complet. Personne n'est à l'abri.
    const avant = entity(sim, derriere).hp
    chargedStrike(sim, a, 1, 0, WEAPON_PROFILES.iron_axe.chargeTicks + 2)
    expect(entity(sim, derriere).hp).toBeLessThan(avant)
  })

  it('LE TOURBILLON est LARGE — et ne se confond pas avec le disque des poings', () => {
    // Deux coups chargés, deux lectures au sol. S'ils couvrent la même surface au même
    // endroit, le joueur ne les distingue plus : ce qui sépare deux coups, c'est ce
    // qu'on VOIT, pas leur nom (décision utilisateur 2026-07-13).
    const poing = WEAPON_PROFILES.unarmed.charged
    const hache = WEAPON_PROFILES.iron_axe.charged

    // Le poing : un DISQUE posé DEVANT (il ne touche rien dans le dos).
    expect(poing.shape).toBe('disc')
    // La hache : un cône de 360° — donc centré sur le CORPS, et bien plus large que le
    // disque du poing. C'est ça, « une zone assez large autour du joueur ».
    expect(hache.shape).toBe('cone')
    expect(hache.arcCos).toBeLessThanOrEqual(-1)
    expect(hache.range).toBeGreaterThan(poing.radius * 2)
  })

  it('LA CHARGE : le pic chargé emmène le CORPS — une vraie course en avant', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, 'spear')
    const me = entity(sim, a)

    // Coup SIMPLE : à peine un pas.
    strike(sim, a, 1, 0)
    const pasSimple = me.x - 10

    // Coup CHARGÉ : le corps traverse le terrain. C'est un ENGAGEMENT, pas un pas —
    // on ferme la distance sur ce qui est LOIN. (Et il TRAVERSE ce qui est trop
    // proche : le coup se résout à l'arrivée, donc une cible collée finit dans le dos.
    // Décision utilisateur : « la lance passe au travers, tant pis ».)
    const depart = me.x
    chargedStrike(sim, a, 1, 0, WEAPON_PROFILES.spear.chargeTicks + 2)
    const bond = me.x - depart

    expect(bond).toBeCloseTo(WEAPON_PROFILES.spear.charged.lunge, 1)
    expect(bond).toBeGreaterThan(pasSimple * 5)
    // Plus vite que la marche : c'est ce qui en fait une charge et non un déplacement.
    const tuilesParSeconde = bond / (WEAPON_PROFILES.spear.charged.windupTicks / BALANCE.TICK_RATE_HZ)
    expect(tuilesParSeconde).toBeGreaterThan(BALANCE.WALK_SPEED_TILES_PER_S)
  })
})

/**
 * LES DEUX COUPS DE CHAQUE ARME (décision utilisateur 2026-07-13) : un clic bref, un
 * clic MAINTENU. La sim compte le maintien — le client ne fait que dire « j'appuie ».
 */
describe('la charge (A14)', () => {
  it('bref = coup simple ; MAINTENU = coup lourd, qui coûte plus cher', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11, 10)

    // Relâché AVANT maturité : c'est le coup simple, au prix du coup simple.
    let staminaAvant = entity(sim, a).stamina
    chargedStrike(sim, a, 1, 0, 2)
    // Précision à l'unité : les PV REMONTENT lentement (HP_REGEN_PER_MIN) pendant les
    // deux secondes de résolution — exiger le dixième testerait la régén, pas le coup.
    const degatsLegers = 100 - entity(sim, b).hp
    expect(degatsLegers).toBeCloseTo(WEAPON_PROFILES.unarmed.light.damage, 0)

    // Relâché À MATURITÉ : l'overhead à deux mains. Il fait bien plus mal, et il se paie.
    entity(sim, b).hp = 100
    entity(sim, a).x = 10
    entity(sim, a).y = 10
    entity(sim, a).stamina = 100
    staminaAvant = entity(sim, a).stamina
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', dx: 1, dy: 0 } }])
    for (let t = 0; t < WEAPON_PROFILES.unarmed.chargeTicks + 2; t++) tick(sim)
    // Tenir la charge NE REGÉNÈRE PAS : c'est le seul frein à se promener « prêt à frapper ».
    expect(entity(sim, a).stamina).toBeLessThanOrEqual(staminaAvant)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_release', dx: 1, dy: 0 } }])
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    expect(100 - entity(sim, b).hp).toBeCloseTo(WEAPON_PROFILES.unarmed.charged.damage, 0)
    expect(100 - entity(sim, b).hp).toBeGreaterThan(degatsLegers)
  })

  it('LE WHIFF PUNIT, jamais la charge : rater cloue sur place, toucher rend la main', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const cible = spawnEntity(sim, 11, 10)
    const me = entity(sim, a)

    // (1) Le coup qui TOUCHE : récupération courte.
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < WEAPON_PROFILES.unarmed.light.windupTicks; t++) tick(sim)
    expect(entity(sim, cible).hp).toBeLessThan(100) // il a bien mordu
    const apresTouche = me.cooldownUntil - sim.tick

    // (2) Le même coup DANS LE VIDE : récupération longue. Le corps reste à découvert.
    entity(sim, cible).x = 30 // plus personne à portée
    me.cooldownUntil = 0
    me.stamina = 100
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < WEAPON_PROFILES.unarmed.light.windupTicks; t++) tick(sim)
    const apresVide = me.cooldownUntil - sim.tick

    // C'est là que le loup trouve sa fenêtre — et c'est ce qui interdit de frapper à
    // l'aveugle. La punition tombe sur le RATÉ, pas sur l'engagement.
    //
    // On compare l'ÉCART, pas les valeurs absolues : les deux coups sont mesurés au
    // même nombre de ticks après l'action, donc leur différence EST exactement celle
    // des deux récupérations du profil. Figer la valeur absolue testerait ma façon de
    // compter les ticks du test, pas la règle.
    expect(apresVide).toBeGreaterThan(apresTouche)
    expect(apresVide - apresTouche).toBe(
      WEAPON_PROFILES.unarmed.light.recoveryWhiff - WEAPON_PROFILES.unarmed.light.recoveryHit,
    )
  })

  it('une charge qu’on ne peut pas payer retombe sur le coup simple (elle ne bloque pas)', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11, 10)
    const me = entity(sim, a)
    // Assez pour un poing (8), pas pour l'overhead (26). On maintient quand même.
    me.stamina = WEAPON_PROFILES.unarmed.light.stamina + 1
    me.hunger = 0 // la régén d'endurance au plancher : elle ne remontera pas d'ici là

    chargedStrike(sim, a, 1, 0, WEAPON_PROFILES.unarmed.chargeTicks + 2)
    // Le coup PART quand même — simple. Un joueur à bout de souffle qui maintient son
    // clic ne doit pas se retrouver avec un bouton mort dans les mains.
    expect(100 - entity(sim, b).hp).toBeCloseTo(WEAPON_PROFILES.unarmed.light.damage, 0)
  })
})

describe('le blocage directionnel (A3)', () => {
  it('de face −70 %, de dos plein pot, et ça coûte de l’endurance', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11.2, 10)
    // b bloque face à a (facing ouest).
    entity(sim, b).facing = { x: -1, y: 0 }
    const staminaBefore = entity(sim, b).stamina
    strike(sim, a, 1, 0, [{ entityId: b, dx: 0, dy: 0, block: true }])
    const blocked = 100 - entity(sim, b).hp
    expect(blocked).toBeCloseTo(COMBAT.UNARMED_DAMAGE * (1 - COMBAT.BLOCK_REDUCTION), 1)
    expect(entity(sim, b).stamina).toBeLessThan(staminaBefore)

    // Même coup dans le dos (b regarde à l'est, a frappe depuis l'ouest) :
    // hors de l'arc frontal, le blocage ne protège pas — dégâts pleins.
    entity(sim, b).hp = 100
    entity(sim, b).facing = { x: 1, y: 0 }
    strike(sim, a, 1, 0, [{ entityId: b, dx: 0, dy: 0, block: true }])
    expect(100 - entity(sim, b).hp).toBeCloseTo(COMBAT.UNARMED_DAMAGE, 1)
  })
})

describe('le coût de mort croissant (V2-21)', () => {
  it('les morts RAPPROCHÉES coûtent plus cher, puis une longue survie les OUBLIE', () => {
    const sim = makeSim()
    const p = spawnEntity(sim, 10, 10)
    const kill = (): number => {
      const e = entity(sim, p)
      e.hp = 0
      die(sim, e, 0)
      return entity(sim, p).exhaustedUntil - sim.tick // durée d'épuisement infligée
    }
    const exh1 = kill() // 1re mort : épuisement de base
    const exh2 = kill() // 2e mort, même tick (rapprochée) : plus long
    expect(exh2).toBeGreaterThan(exh1)
    // Une longue survie remet le compteur à zéro → la mort suivante repart à la base.
    sim.tick += COMBAT.DEATH_FORGET_TICKS + 1
    const exh3 = kill()
    expect(exh3).toBe(exh1)
  })
})

describe('les blessures (A4)', () => {
  it('V1-14 : une plaie NON soignée freine fort la guérison ; sans plaie, elle est pleine (§6bis)', () => {
    const sim = makeSim()
    const hurt = spawnEntity(sim, 10, 10)
    const sain = spawnEntity(sim, 30, 30)
    for (const id of [hurt, sain]) {
      const e = entity(sim, id)
      e.hp = 50 // entamé (donc la régén opère)
      e.hunger = 80 // > 50, et > 70 → même bonus de satiété pour les deux
    }
    entity(sim, hurt).wounds = { leg: true } // une plaie NON drainante, mais non soignée
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ; t++) tick(sim) // 8 s de repos
    const gainBlesse = entity(sim, hurt).hp - 50
    const gainSain = entity(sim, sain).hp - 50
    expect(gainSain).toBeGreaterThan(0) // le sain guérit à plein
    expect(gainBlesse).toBeGreaterThan(0) // le blessé guérit AUSSI (résiduelle : pas de spirale)
    expect(gainBlesse).toBeLessThan(gainSain * 0.5) // …mais bien plus lentement (le médecin existe)
  })

  it('les paliers blessent, la jambe ralentit, le saignement se bande — sur un allié aussi', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11, 10)
    grantHeld(sim, a, 'spear', { fiber: 9 })
    drainEvents(sim)

    // Lance ×16 : 100 → 84 → 68 → 52 (palier 66) → 36 → 20 (palier 33).
    for (let i = 0; i < 5; i++) strike(sim, a, 1, 0)
    const wounds = entity(sim, b).wounds
    expect(Object.keys(wounds).length).toBeGreaterThanOrEqual(1)
    const woundEvents = drainEvents(sim).filter((e) => e.type === 'wound_inflicted')
    expect(woundEvents.length).toBe(2) // les deux paliers franchis

    // Effets mesurables : on force les trois blessures pour tester chacune.
    entity(sim, b).wounds = { leg: true, bleeding: true }
    const x0 = entity(sim, b).x
    tick(sim, [{ entityId: b, dx: 1, dy: 0 }])
    const legStep = entity(sim, b).x - x0
    const hpBefore = entity(sim, b).hp
    tick(sim)
    expect(entity(sim, b).hp).toBeLessThan(hpBefore) // ça saigne

    // a bande son allié : le saignement d'abord, puis la jambe.
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'bandage', targetEntityId: b } }])
    expect(entity(sim, b).wounds.bleeding).toBeUndefined()
    for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'bandage', targetEntityId: b } }])
    expect(entity(sim, b).wounds.leg).toBeUndefined()
    const x1 = entity(sim, b).x
    tick(sim, [{ entityId: b, dx: 1, dy: 0 }])
    expect(legStep / (entity(sim, b).x - x1)).toBeCloseTo(COMBAT.LEG_WOUND_SPEED, 2)
  })
})

describe('la mort (A5)', () => {
  it('cadavre lootable, respawn au Feu épuisé, compétences intactes', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, 'spear', { wood: 10 })
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    const victim = entity(sim, a)
    victim.skills.woodcutting = 500
    victim.x = 20
    victim.y = 20
    victim.inventory = inventoryOf(SLOTS.PLAYER, { berries: 7 })
    victim.hp = 1
    drainEvents(sim)

    const killer = spawnEntity(sim, 21, 20)
    strike(sim, killer, -1, 0)

    // Respawn au Feu (10,10), épuisé, compétences gardées, mains vides.
    expect(victim.x).toBeCloseTo(10.5, 5)
    expect(victim.hp).toBe(COMBAT.RESPAWN_HP)
    expect(victim.exhaustedUntil).toBeGreaterThan(sim.tick)
    expect(victim.skills.woodcutting).toBe(500)
    expect(countOf(victim.inventory, 'berries')).toBe(0)

    // Le cadavre est là, lootable par n'importe qui.
    expect(sim.corpses).toHaveLength(1)
    const corpse = sim.corpses[0]!
    expect(countOf(corpse.inventory, 'berries')).toBe(7)
    tick(sim, [{ entityId: killer, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId: corpse.id } }])
    expect(countOf(entity(sim, killer).inventory, 'berries')).toBe(7)
    expect(sim.corpses).toHaveLength(0)
  })
})

describe('les monstres (A6)', () => {
  it('le Cendreux aggro, télégraphe, frappe — et meurt à la lance', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, 'spear')
    const z = spawnMonster(sim, 'cendreux', 14, 10)
    drainEvents(sim)

    // Il approche et frappe : le joueur immobile finit par prendre des dégâts.
    for (let t = 0; t < 400 * (BALANCE.TICK_RATE_HZ / 12) && entity(sim, a).hp === 100; t++) tick(sim)
    expect(entity(sim, a).hp).toBeLessThan(100)

    // On le tue : 2 coups de lance (20 PV / 16) — il est plus fragile que le zombie qu'il
    // remplace (40 PV), et c'est le profil voulu (spec R10 : glass cannon lent, le danger
    // est la densité). On laisse la même marge de sécurité qu'avant.
    const cendreux = entity(sim, z)
    for (let i = 0; i < 4 && sim.entities.some((e) => e.id === z); i++) {
      strike(sim, a, cendreux.x - entity(sim, a).x, cendreux.y - entity(sim, a).y)
    }
    expect(sim.entities.some((e) => e.id === z)).toBe(false)
    expect(drainEvents(sim).some((e) => e.type === 'monster_slain' && e.monsterType === 'cendreux')).toBe(true)
  })

  it('une attaque refusée (à bout de souffle) ne consomme pas le cooldown', () => {
    const sim = makeSim()
    spawnEntity(sim, 10.5, 10.5) // la proie, adjacente
    const z = spawnMonster(sim, 'cendreux', 11.5, 10.5)
    const bete = entity(sim, z)
    bete.stamina = 0 // startAttack refusera (ATTACK_STAMINA)
    tick(sim)
    // Le coup n'est pas parti : pas de wind-up — et le cooldown ne doit pas
    // être posé pour un coup qui n'a jamais eu lieu.
    expect(bete.windup).toBeUndefined()
    expect(bete.cooldownUntil).toBe(0)
  })

  it('la peau brute récompense le coup PROPRE, jamais le coup sale (V0-4)', () => {
    // On isole la RÈGLE (coup propre → peau), pas les nombres de dégâts : on épingle
    // les PV du gibier à 1 pour qu'un seul coup l'abatte, et c'est le VERDICT propre/sale
    // (l'embuscade vs la bête déjà alertée) qui décide de la peau, rien d'autre.

    // COUP PROPRE — le sanglier n'a pas eu le temps de percevoir le chasseur : embuscade.
    const clean = makeSim()
    const hunterA = spawnEntity(clean, 10, 10)
    grantHeld(clean, hunterA, 'spear')
    const boarA = spawnMonster(clean, 'boar', 11, 10)
    entity(clean, boarA).hp = 1
    entity(clean, hunterA).stamina = 100
    strike(clean, hunterA, 1, 0) // frappe IMMÉDIATE : `slainClean` reste vrai
    const cleanCorpse = clean.corpses[0]!
    expect(countOf(cleanCorpse.inventory, 'raw_hide')).toBe(1)
    expect(countOf(cleanCorpse.inventory, 'raw_meat')).toBe(3) // la viande vient AUSSI

    // COUP SALE — on laisse le sanglier PERCEVOIR le chasseur (il s'alerte ; flightRange 0,
    // il ne fuit pas) : la mise à mort n'est plus propre → viande seule, pas de peau.
    const messy = makeSim()
    const hunterB = spawnEntity(messy, 10, 10)
    grantHeld(messy, hunterB, 'spear')
    const boarB = spawnMonster(messy, 'boar', 11.2, 10)
    for (let t = 0; t < 10; t++) tick(messy) // il perçoit, sa suspicion monte, il s'alerte
    const target = entity(messy, boarB)
    entity(messy, hunterB).x = target.x - 1
    entity(messy, hunterB).y = target.y
    entity(messy, boarB).hp = 1
    entity(messy, hunterB).stamina = 100
    strike(messy, hunterB, 1, 0)
    const messyCorpse = messy.corpses[0]!
    expect(countOf(messyCorpse.inventory, 'raw_hide')).toBe(0)
    expect(countOf(messyCorpse.inventory, 'raw_meat')).toBe(3) // la viande, elle, reste
  })

  it('le sanglier fuit quand on le frappe, et sa viande se cuit', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, 'spear', { campfire: 1 })
    // Un FOYER sans PNJ. On pose un feu de camp à côté (il a un hitbox : jamais sous
    // les pieds) puis on le PROMEUT en village — `found_village` n'amène AUCUN PNJ.
    // On veut le modificateur de dégâts du VILLAGEOIS (base 18, le sanglier encaisse
    // et survit), mais SANS la milice de PNJ qui, le Feu bloquant, se posterait tout
    // près et l'achèverait avant qu'on l'observe. Le feu ne sert sinon qu'à cuire.
    const cf = entity(sim, a).inventory.findIndex((s) => s?.item === 'campfire')
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'set_active_slot', slot: cf } }])
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'place_campfire', tx: 9, ty: 10 } }])
    const foyer = sim.structures.find((s) => s.type === 'fire')!
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'found_village', structureId: foyer.id } }])
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'set_active_slot', slot: 0 } }]) // reprend la lance
    const b = spawnMonster(sim, 'boar', 11.2, 10)
    // Le sanglier doit être SUR SES GARDES avant le coup : sinon la « mise à mort
    // propre » (spec chasse C6) frappe ×fort une bête surprise et l'ONE-SHOT — on
    // n'observe alors jamais sa réaction. On le laisse donc PERCEVOIR le joueur
    // quelques ticks (sa suspicion monte, il s'alerte, et il ne bouge pas : sa portée
    // de fuite est nulle, « il laisse approcher ») — ce que faisait autrefois
    // l'agitation des PNJ d'accueil, retirés d'ici avec le village.
    for (let t = 0; t < 10; t++) tick(sim)

    strike(sim, a, 1, 0)
    const boar = entity(sim, b)
    expect(boar.hp).toBeLessThan(MONSTER_DEFS.boar.hp)
    const oux = boar.x
    const ouy = boar.y
    drainEvents(sim)
    let mordu = false
    for (let t = 0; t < 5 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      if (drainEvents(sim).some((e) => e.type === 'entity_damaged' && e.byEntityId === b)) mordu = true
    }

    // IL A RÉAGI — et la réaction a DEUX visages (spec faune R7 : le sanglier blessé
    // FUIT ou CHARGE). On teste la disjonction : il a DÉTALÉ, ou il a MORDU (et c'est
    // le flux d'événements qui le dit, pas sa position — un sanglier qui charge et se
    // colle à sa cible ne bouge plus une fois au contact).
    //
    // Le déplacement se mesure sur LES DEUX AXES. Il ne l'était que sur X, et c'était
    // un faux positif qui dormait : ce sanglier-ci détale plein SUD (neuf tuiles), son
    // X ne bouge pas d'un cheveu, et le test n'y voyait qu'une bête immobile.
    const dx = boar.x - oux
    const dy = boar.y - ouy
    const detale = dx * dx + dy * dy > 1
    expect(detale || mordu).toBe(true)

    // L'achever, looter, cuire, manger.
    while (sim.entities.some((e) => e.id === b)) {
      const target = entity(sim, b)
      entity(sim, a).x = target.x - 1
      entity(sim, a).y = target.y
      entity(sim, a).stamina = 100
      strike(sim, a, 1, 0)
    }
    const corpse = sim.corpses[0]!
    entity(sim, a).x = corpse.x
    entity(sim, a).y = corpse.y
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId: corpse.id } }])
    expect(countOf(entity(sim, a).inventory, 'raw_meat')).toBe(3)
    entity(sim, a).x = 10.5
    entity(sim, a).y = 10.5
    for (let t = 0; t < BALANCE.GATHER_COOLDOWN_TICKS; t++) tick(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'craft', recipeId: 'cooked_meat' } }])
    // La viande MIJOTE (spec craft-file) : on reste au Feu, et on attend.
    while (entity(sim, a).craftQueue.length > 0) tick(sim)
    expect(countOf(entity(sim, a).inventory, 'cooked_meat')).toBe(1)
  })
})

describe('la mort n’est pas un atelier de réparation (A12, spec inventaire R6/R11-R12)', () => {
  it('le cadavre HÉRITE des cases : la hache usée reste usée, du sac au cadavre au pilleur', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const victim = entity(sim, a)
    victim.inventory[0] = { item: 'axe', count: 1, wear: 60 }
    victim.activeSlot = 0
    victim.hp = 1

    const killer = spawnEntity(sim, 11, 10)
    strike(sim, killer, -1, 0)

    // A12 : le sac est vide et la main rengainée.
    expect(victim.inventory.every((s) => s === null)).toBe(true)
    expect(victim.activeSlot).toBe(-1)

    const corpse = sim.corpses[0]!
    expect(corpse.inventory.find((s) => s?.item === 'axe')).toEqual({ item: 'axe', count: 1, wear: 60 })

    const looter = entity(sim, killer)
    looter.x = corpse.x
    looter.y = corpse.y
    tick(sim, [{ entityId: killer, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId: corpse.id } }])
    expect(looter.inventory.find((s) => s?.item === 'axe')).toEqual({ item: 'axe', count: 1, wear: 60 })
  })

  it('A12bis : le butin du monstre S’AJOUTE à ce qu’il portait — le cadavre ne tronque JAMAIS', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, 'spear')
    const b = spawnMonster(sim, 'boar', 11, 10)
    const boar = entity(sim, b)
    // Le pire cas : la bête porte DÉJÀ un sac saturé (un Cendreux levé d'un
    // cadavre chargé). Sa table de loot doit s'ajouter par-dessus, sans rien
    // perdre — d'où SLOTS.CORPSE > SLOTS.NPC.
    boar.inventory = inventoryOf(SLOTS.NPC, { stone: 20 * SLOTS.NPC })
    boar.hp = 1

    strike(sim, a, 1, 0)

    const corpse = sim.corpses[0]!
    expect(countOf(corpse.inventory, 'stone')).toBe(20 * SLOTS.NPC)
    for (const [item, count] of Object.entries(MONSTER_DEFS.boar.loot)) {
      expect(countOf(corpse.inventory, item as ItemId)).toBe(count)
    }
  })
})

/**
 * Le cadavre est un conteneur BORNÉ face à un sac BORNÉ (spec inventaire R11).
 * Tant que `loot_corpse` jetait le reliquat, looter avec un sac plein DÉTRUISAIT
 * le butin — et effaçait le cadavre par-dessus. On prend ce qui rentre, le
 * cadavre garde le reste, et il ne disparaît QUE vidé.
 */
describe('looter ne fait rien s’évaporer (A21, spec inventaire R11)', () => {
  /** Un cadavre planté sur place, chargé, qui ne décante pas de sitôt. */
  function dropCorpse(sim: SimState, x: number, y: number, inv: Inventory): number {
    const id = sim.nextCorpseId
    sim.corpses.push({ id, x, y, inventory: inv, decayAt: sim.tick + 100_000, diedAt: sim.tick })
    sim.nextCorpseId += 1
    return id
  }

  const rejects = (sim: SimState): string[] =>
    drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))

  it('sac plein : le cadavre GARDE tout, ne disparaît pas, et le refus est dit', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const looter = entity(sim, a)
    looter.inventory = [{ item: 'stone', count: stackSize('stone') }] // une case, pleine
    const corpseId = dropCorpse(sim, 10, 10, inventoryOf(SLOTS.CORPSE, { wood: 40 }))
    drainEvents(sim)

    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId } }])

    const corpse = sim.corpses.find((c) => c.id === corpseId)
    expect(corpse).toBeDefined() // il reste du butin : le cadavre reste
    expect(countOf(looter.inventory, 'wood') + countOf(corpse!.inventory, 'wood')).toBe(40)
    expect(countOf(looter.inventory, 'stone')).toBe(stackSize('stone')) // son sac est intact
    expect(rejects(sim)).toContain('sac plein')
  })

  it('sac presque plein : on prend ce qui rentre, le cadavre garde le reste', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const looter = entity(sim, a)
    looter.inventory = [{ item: 'wood', count: stackSize('wood') - 2 }] // 2 places, pas plus
    const corpseId = dropCorpse(sim, 10, 10, inventoryOf(SLOTS.CORPSE, { wood: 40 }))
    drainEvents(sim)

    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId } }])

    const corpse = sim.corpses.find((c) => c.id === corpseId)
    expect(corpse).toBeDefined()
    expect(countOf(looter.inventory, 'wood')).toBe(stackSize('wood'))
    expect(countOf(corpse!.inventory, 'wood')).toBe(40 - 2)
    expect(rejects(sim)).not.toContain('sac plein') // quelque chose a bougé : ce n'est pas un refus
  })

  it('le reliquat garde son USURE : le cadavre n’est pas une lessiveuse', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const looter = entity(sim, a)
    // Une seule case libre : la première hache passe, la seconde reste.
    looter.inventory = [{ item: 'stone', count: stackSize('stone') }, null]
    const corpseInv: Inventory = makeInventory(SLOTS.CORPSE)
    corpseInv[0] = { item: 'axe', count: 1, wear: 60 }
    corpseInv[1] = { item: 'pickaxe', count: 1, wear: 10 }
    const corpseId = dropCorpse(sim, 10, 10, corpseInv)

    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId } }])

    expect(looter.inventory[1]).toEqual({ item: 'axe', count: 1, wear: 60 })
    const corpse = sim.corpses.find((c) => c.id === corpseId)!
    expect(corpse.inventory.filter((s) => s !== null)).toEqual([{ item: 'pickaxe', count: 1, wear: 10 }])
  })

  it('cadavre vidé : il disparaît, et l’événement le dit', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const corpseId = dropCorpse(sim, 10, 10, inventoryOf(SLOTS.CORPSE, { wood: 5 }))
    drainEvents(sim)

    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId } }])

    expect(sim.corpses.find((c) => c.id === corpseId)).toBeUndefined()
    expect(drainEvents(sim).some((e) => e.type === 'corpse_looted' && e.corpseId === corpseId)).toBe(true)
    expect(countOf(entity(sim, a).inventory, 'wood')).toBe(5)
  })
})

describe('l’arme TENUE (A9, spec inventaire R9)', () => {
  it('les dégâts viennent de l’arme en main, pas de la meilleure du sac', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const attacker = entity(sim, a)
    attacker.inventory[0] = { item: 'spear', count: 1 }

    attacker.activeSlot = 0
    expect(weaponDamage(attacker)).toBe(WEAPON_DAMAGE.spear)

    attacker.activeSlot = -1 // la lance est dans le sac : elle n'y frappe personne
    expect(weaponDamage(attacker)).toBe(COMBAT.UNARMED_DAMAGE)

    attacker.activeSlot = 1 // une case vide vaut mains nues
    expect(weaponDamage(attacker)).toBe(COMBAT.UNARMED_DAMAGE)
  })

  it('un OUTIL en main n’est pas une arme (spec combat R5)', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const attacker = entity(sim, a)
    attacker.inventory[0] = { item: 'axe', count: 1 } // hors de WEAPON_DAMAGE
    attacker.activeSlot = 0
    expect(weaponDamage(attacker)).toBe(COMBAT.UNARMED_DAMAGE)
  })

  it('l’arme s’use DANS SA CASE au contact, et casse à la durabilité', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11, 10)
    entity(sim, b).hp = 100000 // un mannequin : on teste l'usure, pas la mort
    const attacker = entity(sim, a)
    attacker.inventory[0] = { item: 'spear', count: 1, wear: BALANCE.TOOL_DURABILITY - 2 }
    attacker.activeSlot = 0

    strike(sim, a, 1, 0)
    expect(attacker.inventory[0]).toEqual({
      item: 'spear',
      count: 1,
      wear: BALANCE.TOOL_DURABILITY - 1,
    })

    attacker.stamina = 100
    strike(sim, a, 1, 0)
    expect(attacker.inventory[0]).toBeNull() // la lance a cassé DANS SA CASE
  })
})

describe('la milice (A7)', () => {
  it('trois Cendreux marchent sur le village : la milice tient, personne ne meurt', { timeout: 30_000 }, () => {
    const sim = createSim(9, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
    foundNpcVillage(sim, 20, 20, 4)
    spawnMonster(sim, 'cendreux', 27, 20)
    spawnMonster(sim, 'cendreux', 20, 27)
    spawnMonster(sim, 'cendreux', 14, 15)

    for (let t = 0; t < 300 * BALANCE.TICK_RATE_HZ && sim.monsters.length > 0; t++) tick(sim) // ~5 min de marge
    expect(sim.monsters).toHaveLength(0) // tous abattus
    expect(sim.npcs).toHaveLength(4) // aucun mort
  })
})

describe('le déterminisme (A8)', () => {
  it('replay exact avec combat, blessures et monstres', () => {
    const options = { map: createEmptyMap(40, 40, TERRAIN_GRASS) }
    const setup = (state: SimState) => {
      spawnEntity(state, 10, 10)
      grantItems(state, 1, { spear: 1, fiber: 6 })
      state.entities[0]!.activeSlot = 0 // la lance est EN MAIN (spec inventaire R9)
      spawnMonster(state, 'cendreux', 14, 10)
      spawnMonster(state, 'boar', 8, 12)
    }
    const live = createSim(33, options)
    const log = createReplayLog(33, options)
    setup(live)
    for (let t = 0; t < 2000; t++) {
      const action =
        t % 40 === 0 ? ({ type: 'attack', dx: 1, dy: 0.2 } as const) : t % 97 === 0 ? ({ type: 'bandage' } as const) : undefined
      recordAndStep(live, log, [
        {
          entityId: 1,
          dx: t % 3 === 0 ? 1 : -1,
          dy: t % 5 === 0 ? 1 : 0,
          sprint: t % 7 === 0,
          block: t % 11 === 0,
          ...(action ? { action } : {}),
        },
      ])
    }
    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(live))
  })
})

/**
 * A15 — LE CORPS COMPTE, PAS SON SEUL CENTRE (décision d'Alexis, 2026-08-02).
 *
 * La promesse tenue ici est celle du JOUEUR, pas celle de l'implémentation : « si le
 * corps de la bête baigne dans la zone que je vois, le coup porte ». On l'affirme donc
 * sur la géométrie du CORPS (un disque de `HIT_BODY_RADIUS`) confrontée au cône NOMINAL
 * de l'arme — jamais sur la formule d'élargissement, qu'on ne ferait que recopier.
 *
 * Balayée sur tout le tour : une garde de géométrie se balaie, elle ne se choisit pas.
 */
describe('le corps de la cible, et non son centre (A15)', () => {
  /**
   * Le disque de la cible chevauche-t-il le cône NOMINAL de l'arme ?
   *
   * Échantillonné sur un TREILLIS CARRÉ inscrit dans le disque, et non sur un cercle de
   * points : `Math.cos`/`Math.sin` sont interdits jusque dans les tests de `/sim`
   * (invariant §2 — le garde-fou ESLint ne fait pas d'exception, et il a raison : un
   * helper de test finit toujours par migrer dans le code). L'échantillon est donc un
   * SOUS-ENSEMBLE du corps, ce qui tire l'affirmation du bon côté — on exige que la sim
   * touche moins de cellules que le corps n'en couvre vraiment, jamais plus.
   */
  function corpsDansLeCone(range: number, arcCos: number, ox: number, oy: number, dx: number, dy: number): boolean {
    const r = COMBAT.HIT_BODY_RADIUS
    const N = 4
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        const ex = (i / N) * r
        const ey = (j / N) * r
        if (ex * ex + ey * ey > r * r) continue
        const px = ox + ex
        const py = oy + ey
        const d2 = px * px + py * py
        if (d2 === 0 || d2 > range * range) continue
        if ((px * dx + py * dy) / Math.sqrt(d2) >= arcCos) return true
      }
    }
    return false
  }

  /**
   * Un coup de HACHE joué pour de vrai. La hache parce qu'elle ne TRESSE pas
   * (`weave: false`) : son pas d'armement va tout droit dans l'axe de la visée, donc
   * l'apex du cône résolu est simplement `lunge` devant le corps — un décalage qu'on
   * peut écrire en une ligne. Les poings, eux, dévient de 25° à chaque coup, et le
   * modèle de référence devrait alors recopier `advanceLunge` pour rien.
   */
  function porte(cx: number, cy: number, dx: number, dy: number): boolean {
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const c = spawnEntity(sim, cx, cy)
    entity(sim, a).stamina = 100
    entity(sim, c).hp = 1000
    grantHeld(sim, a, 'iron_axe')
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx, dy } }])
    for (let t = 0; t < WEAPON_PROFILES.iron_axe.light.windupTicks + 2; t++) tick(sim)
    return entity(sim, c).hp < 1000
  }

  it('un corps qui BAIGNE dans le cône prend le coup — tout autour du joueur', () => {
    const { range, arcCos, lunge } = WEAPON_PROFILES.iron_axe.light
    let manqués = 0
    let éprouvés = 0
    // TREILLIS CARRÉ plutôt qu'anneau de points : pas de trigonométrie dans `/sim`,
    // tests compris. Il balaie de toute façon TOUT le tour du frappeur, ce qui est la
    // propriété qu'on veut — une garde de géométrie se balaie, elle ne se choisit pas.
    for (let ox = -2; ox <= 2.0001; ox += 0.1) {
      for (let oy = -2; oy <= 2.0001; oy += 0.1) {
        // La visée est droite devant (l'est) ; le coup se résout depuis la position
        // d'ARRIVÉE, `lunge` plus loin — c'est de là que se juge le cône.
        if (!corpsDansLeCone(range, arcCos, ox - lunge, oy, 1, 0)) continue
        éprouvés += 1
        if (!porte(20 + ox, 20 + oy, 1, 0)) manqués += 1
      }
    }
    expect(éprouvés).toBeGreaterThan(50) // la garde a bien de quoi mordre
    expect(manqués).toBe(0)
  })

  it('…et un corps ENTIÈREMENT hors de la zone reste épargné', () => {
    const { range, lunge } = WEAPON_PROFILES.iron_axe.light
    // Deux fois le rayon du corps au-delà de la portée utile (pas d'armement compris) :
    // aucune indulgence ne doit atteindre là.
    expect(porte(20 + range + lunge + 2 * COMBAT.HIT_BODY_RADIUS + 0.01, 20, 1, 0)).toBe(false)
    // Et dans le DOS, à bout touchant : la portée n'est pas une excuse pour l'arc.
    expect(porte(20 - 0.9, 20, 1, 0)).toBe(false)
  })
})

/**
 * A16 — LE COUP REPOUSSE (demande d'Alexis, 2026-08-02).
 *
 * Le knockback est RADIAL (frappeur → frappé), il passe par la collision, et il
 * n'interrompt rien. On l'affirme sur la position, jamais sur la constante.
 */
describe('le coup repousse (A16)', () => {
  // LA RÈGLE EST LIVRÉE À ZÉRO (voir `COMBAT.KNOCKBACK_TILES` : le recul défait
  // l'encerclement de la meute, mesuré sur 6 graines — l'arbitrage revient à Alexis).
  // La garde, elle, reste VIVANTE : on ARME la constante le temps de ce bloc, pour que
  // le jour où l'on remonte le nombre, la règle qu'il commande soit déjà prouvée. Sans
  // ça on livrerait du code jamais éprouvé, qui se découvrirait cassé au playtest.
  const repos = COMBAT.KNOCKBACK_TILES
  beforeAll(() => {
    ;(COMBAT as { KNOCKBACK_TILES: number }).KNOCKBACK_TILES = 0.25
  })
  afterAll(() => {
    ;(COMBAT as { KNOCKBACK_TILES: number }).KNOCKBACK_TILES = repos
  })

  /**
   * Frappe une cible immobile à `dist` à l'est, et rend de combien elle a reculé —
   * la NORME du déplacement, pas sa composante en x. Le recul est radial depuis la
   * position d'ARRIVÉE du frappeur (qui a fait son pas d'armement, en zigzag pour les
   * poings) : l'axe frappeur→frappé n'est donc pas tout à fait l'est, et mesurer sur x
   * seul mesurerait le pas de l'attaquant plutôt que la poussée.
   */
  function recul(dist: number, held?: ItemId, holdTicks = 0): number {
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const c = spawnEntity(sim, 20 + dist, 20)
    entity(sim, a).stamina = 100
    entity(sim, c).hp = 1000
    if (held) grantHeld(sim, a, held)
    const avant = { x: entity(sim, c).x, y: entity(sim, c).y }
    if (holdTicks > 0) chargedStrike(sim, a, 1, 0, holdTicks)
    else {
      tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
      for (let t = 0; t < COMBAT.WINDUP_TICKS + 2; t++) tick(sim)
    }
    const après = entity(sim, c)
    const ex = après.x - avant.x
    const ey = après.y - avant.y
    return Math.sqrt(ex * ex + ey * ey)
  }

  it('la cible frappée RECULE, d’exactement la poussée du coup simple', () => {
    expect(recul(1)).toBeCloseTo(COMBAT.KNOCKBACK_TILES, 5)
  })

  it('elle recule EN S’ÉLOIGNANT du frappeur, jamais vers lui', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const c = spawnEntity(sim, 21, 20)
    entity(sim, a).stamina = 100
    entity(sim, c).hp = 1000
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 2; t++) tick(sim)
    const frappeur = entity(sim, a)
    const frappé = entity(sim, c)
    const ax = 21 - frappeur.x
    const ay = 20 - frappeur.y
    const bx = frappé.x - frappeur.x
    const by = frappé.y - frappeur.y
    const avant = Math.sqrt(ax * ax + ay * ay)
    const après = Math.sqrt(bx * bx + by * by)
    expect(après).toBeGreaterThan(avant)
  })

  it('le coup CHARGÉ repousse plus loin que le coup simple', () => {
    // La hache : son coup chargé est un tourbillon (360°), donc la cible est dans la
    // zone quelle que soit la finesse de la visée — on éprouve le POIDS, pas l'adresse.
    const simple = recul(1.2, 'iron_axe')
    const lourd = recul(1.2, 'iron_axe', WEAPON_PROFILES.iron_axe.chargeTicks + 2)
    expect(lourd).toBeGreaterThan(simple)
    expect(lourd).toBeCloseTo(simple * COMBAT.KNOCKBACK_CHARGED_FACTOR, 5)
  })

  it('un MUR arrête le recul — c’est un pas, pas une téléportation', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const c = spawnEntity(sim, 21, 20)
    entity(sim, a).stamina = 100
    entity(sim, c).hp = 1000
    // Le sol devient roche juste derrière la cible : le recul bute dessus.
    sim.map.terrain[20 * sim.map.width + 22] = TERRAIN_ROCK
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 2; t++) tick(sim)
    expect(entity(sim, c).x).toBeLessThan(21 + COMBAT.KNOCKBACK_TILES)
  })

  it('le recul n’INTERROMPT pas le coup de celui qui le prend', () => {
    // Deux corps qui s'arment en même temps : le premier résolu repousse le second,
    // et le second frappe QUAND MÊME. Sans cette retenue, marteler verrouillerait tout.
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const b = spawnEntity(sim, 20.9, 20)
    entity(sim, a).stamina = 100
    entity(sim, b).stamina = 100
    entity(sim, a).hp = 1000
    entity(sim, b).hp = 1000
    tick(sim, [
      { entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } },
      { entityId: b, dx: 0, dy: 0, action: { type: 'attack', dx: -1, dy: 0 } },
    ])
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 2; t++) tick(sim)
    expect(entity(sim, b).hp).toBeLessThan(1000) // b a bien encaissé…
    expect(entity(sim, a).hp).toBeLessThan(1000) // …et a rendu son coup malgré le recul
  })
})
