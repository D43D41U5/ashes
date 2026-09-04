import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BALANCE, COMBAT, FAUNA, MONSTER_DEFS, SLOTS, TEMPERATURE, TERRAIN_GRASS, TERRAIN_ROCK, WEAPON_DAMAGE, WEAPON_PROFILES, type MonsterType } from './balance'
import { drainEvents, type SimEvent } from './events'
import { countOf, inventoryOf, makeInventory, stackSize, type Inventory, type ItemBag, type ItemId } from './items'
import { applyDamage, die, respawn, staminaCapFor, startAttack, weaponDamage } from './combat'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { foundNpcVillage } from './worldgen'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { ambientTemperature } from './temperature'
import { cycleOffsetForStartHour, dayTicksAt, gameTimeAt, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { grantItems } from './village'

function makeSim(): SimState {
  return createSim(5, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
}

/** Le cœur d'une saison, en jour de l'année — DÉRIVÉ d'`ACT_DAYS` (`saisons.md` S1 : quatre
 *  saisons de trente jours), jamais écrit. Un montage se pose sur une saison, pas sur un jour. */
const coeurDeSaison = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2

const entity = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!

/**
 * TOURNE `qui` VERS `vers`. Indispensable depuis le coup à revers (R6ter, 2026-08-27) :
 * une entité fraîche regarde l'EST, et la moitié des montages de ce fichier plantent leur
 * cible à l'est du frappeur — qui la prenait donc dans le dos, et encaissait
 * `BACK_DAMAGE_FACTOR` fois trop. Un duel se joue face à face ; on le dit maintenant.
 */
function faceA(sim: SimState, qui: number, vers: number): void {
  const a = entity(sim, qui)
  const b = entity(sim, vers)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.sqrt(dx * dx + dy * dy)
  a.facing = { x: dx / l, y: dy / l }
}

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

    // Régén : repu (>70) vs normal vs affamé (0), à l'arrêt. L'AFFAMÉ N'A PLUS DE MALUS
    // DE TAUX depuis le 2026-08-29 : sa punition est le PLAFOND (`staminaCapFor`, R2ter) —
    // il recharge à pleine vitesse une jauge raccourcie. On le mesure donc LOIN de son
    // plafond (20 < 40), sinon le clamp mangerait le gain et on comparerait deux règles.
    const fed = spawnEntity(sim, 20, 20)
    const normal = spawnEntity(sim, 30, 30)
    const starved = spawnEntity(sim, 25, 25)
    entity(sim, fed).stamina = 50
    entity(sim, normal).stamina = 20
    entity(sim, normal).hunger = 60 // ni bonus (≤70) ni plafond mordant (≥50)
    entity(sim, starved).stamina = 20
    entity(sim, starved).hunger = 0
    tick(sim)
    const fedGain = entity(sim, fed).stamina - 50
    const normalGain = entity(sim, normal).stamina - 20
    const starvedGain = entity(sim, starved).stamina - 20
    expect(fedGain / starvedGain).toBeCloseTo(COMBAT.FED_REGEN_BONUS, 2)
    // Précision 3, pas 6 : les deux corps dérivent d'un rien de température en des points
    // différents du même monde — c'est le TAUX qu'on affirme égal, pas le bit.
    expect(starvedGain).toBeCloseTo(normalGain, 3) // même taux : la faim plafonne, elle ne freine plus
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
   * hystérésis**. On sort d'épuisement au quart du plafond (`SPRINT_RECOVER_FRACTION`),
   * pas au premier point regagné.
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

    // L'ÉPUISÉ RESSORT : passé le quart du plafond il recourt — sans quoi ce test
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
    // MIDI AU CŒUR DE L'ARDEUR, et c'est la prémisse du témoin : depuis la thermogenèse
    // (2026-08-29), un air sous `AMBIANT_DOUX` facture la faim de TOUT LE MONDE — au jour 1
    // à l'aube (makeSim), la « faim passive » de la barre pleine portait ~1,4 point de froid
    // et la garde comparait un prix à un climat. L'air doux rend la formule exacte.
    const sim = createSim(5, { map: createEmptyMap(40, 40, TERRAIN_GRASS), cycleOffset: cycleOffsetForStartHour(12, 1) })
    sim.tick = (coeurDeSaison(2) - 1) * TICKS_PER_SEASON_DAY
    expect(
      ambientTemperature(sim, 30, 30),
      'la prémisse : cet air-là est doux',
    ).toBeGreaterThanOrEqual(TEMPERATURE.AMBIANT_DOUX)
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

describe('le plafond du souffle — la faim plafonne le MAX (R2ter, décision d’Alexis 2026-08-29)', () => {
  it('la courbe : 100 au-dessus du genou, pente continue, plancher à faim 0 — et un affamé frappe encore', () => {
    expect(staminaCapFor(100)).toBe(100)
    expect(staminaCapFor(COMBAT.STAMINA_CAP_HUNGER)).toBe(100)
    expect(staminaCapFor(0)).toBe(COMBAT.STARVED_STAMINA_CAP)
    // Monotone et continue, balayée sur tout le domaine — pas trois cas choisis.
    let prev = staminaCapFor(0)
    for (let h = 1; h <= 100; h++) {
      const cap = staminaCapFor(h)
      expect(cap).toBeGreaterThanOrEqual(prev)
      expect(cap - prev).toBeLessThanOrEqual(2) // pas de marche : ~1,2/point au plus raide
      prev = cap
    }
    // LA GARDE EXHAUSTIVE : le plancher paie le coup LÉGER de TOUTES les armes de la table
    // (et le coût par défaut des bêtes) — balayée sur la vraie table, jamais trois armes
    // choisies. Sous l'une d'elles, un affamé chassé ne pourrait plus se défendre du
    // tout : la spirale de mort que la décision interdit explicitement.
    expect(COMBAT.STARVED_STAMINA_CAP).toBeGreaterThanOrEqual(COMBAT.ATTACK_STAMINA)
    for (const [nom, p] of Object.entries(WEAPON_PROFILES)) {
      expect(p.light.stamina, `l'arme « ${nom} »`).toBeLessThanOrEqual(COMBAT.STARVED_STAMINA_CAP)
    }
  })

  it('le ventre vide ROGNE la jauge au tick même — et manger la rouvre', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    entity(sim, a).stamina = 100
    entity(sim, a).hunger = 0
    tick(sim)
    expect(entity(sim, a).stamina).toBe(COMBAT.STARVED_STAMINA_CAP)
    // Nourri de nouveau : le plafond remonte, la régén repeuple AU-DELÀ de l'ancien mur —
    // le plafond est un état de la faim, jamais une amputation définitive.
    entity(sim, a).hunger = 100
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(entity(sim, a).stamina).toBeGreaterThan(COMBAT.STARVED_STAMINA_CAP)
  })

  it('l’affamé RESSORT d’épuisement — au quart de SON plafond, pas à l’ancien 25 absolu', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    entity(sim, a).stamina = 0
    entity(sim, a).hunger = 0
    tick(sim)
    expect(entity(sim, a).exhausted).toBe(true)
    // On le laisse souffler : le verrou doit se lever STRICTEMENT sous 25 — la preuve que
    // le seuil DÉRIVE du plafond (¼ × 40 = 10) au lieu d'un compte absolu qui, le jour où
    // un réglage passerait le plafond dessous, deviendrait inatteignable et clouerait
    // l'affamé au sol pour toujours (le piège relevé au brainstorm).
    let levee: number | undefined
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ && levee === undefined; t++) {
      tick(sim)
      if (entity(sim, a).exhausted !== true) levee = entity(sim, a).stamina
    }
    expect(levee).toBeDefined()
    expect(levee!).toBeGreaterThanOrEqual(COMBAT.SPRINT_RECOVER_FRACTION * COMBAT.STARVED_STAMINA_CAP)
    expect(levee!).toBeLessThan(25) // l'ancien seuil absolu — la dérivation se lit ici
  })
})

describe('à bout de souffle, on traîne (A1quinquies, R1 — l’écart soldé)', () => {
  it('SHIFT tenu, la MOYENNE reste sous la vitesse du loup', () => {
    // ═══ L'ARBITRAGE QUE R1ter LAISSAIT OUVERT ═══
    //
    // « Même corrigé, un joueur qui garde SHIFT enfoncé alterne récupération et rafales
    // avec un rapport cyclique de régén/(régén+ponction) — 44 % bien nourri, soit ~4,9 t/s
    // de moyenne, encore au-dessus des 4,8 du loup. » MESURÉ ici avant/après :
    // **4,88 → 4,42 t/s**. Le levier n'est pas le rapport (il se simplifie, la spec le dit)
    // mais la vitesse de la moitié BASSE du cycle — la promesse de R1 qu'on ne tenait pas.
    //
    // La garde se lit contre `MONSTER_DEFS.wolf.speed` et non contre un nombre écrit :
    // c'est la règle « on ne distance pas des loups » qui est affirmée, pas un réglage.
    const sim = createSim(5, { map: createEmptyMap(400, 40, TERRAIN_GRASS) })
    const id = spawnEntity(sim, 5, 20)
    entity(sim, id).hunger = 100
    const x0 = entity(sim, id).x
    const secondes = 30
    for (let t = 0; t < secondes * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim, [{ entityId: id, dx: 1, dy: 0, sprint: true }])
    }
    const moyenne = (entity(sim, id).x - x0) / secondes
    expect(moyenne).toBeLessThan(MONSTER_DEFS.wolf.speed)
    // …et l'on n'est pas cloué non plus : essoufflé on TRAÎNE, on ne s'arrête pas.
    expect(moyenne).toBeGreaterThan(MONSTER_DEFS.wolf.speed * 0.5)
  })

  it('LE VERROU COMMANDE LE PAS, et à 1 la règle est rigoureusement inerte', () => {
    // La garde ARME la constante : à `WINDED_SPEED = 1` on doit retrouver EXACTEMENT le
    // pas d'avant. Sans cette contre-épreuve, un ralentissement venu d'ailleurs (le froid,
    // la charge, une plaie) ferait passer le test du dessus pour de mauvaises raisons.
    const pas = (winded: number): number => {
      const repos = COMBAT.WINDED_SPEED
      ;(COMBAT as { WINDED_SPEED: number }).WINDED_SPEED = winded
      try {
        const sim = makeSim()
        const id = spawnEntity(sim, 5, 20)
        entity(sim, id).stamina = 0
        // ON POSE LE VERROU À LA MAIN, et c'est une correction payée d'un rouge : laissé
        // à `advanceCombat`, il ne se pose qu'APRÈS le pas du premier tick — ce tick-là
        // courait donc à pleine vitesse dans les deux montages, et l'écart mesuré valait
        // « neuf pas ralentis sur dix ». On mesure la règle, pas le tick où elle s'arme.
        entity(sim, id).exhausted = true
        const x0 = entity(sim, id).x
        for (let t = 0; t < 10; t++) tick(sim, [{ entityId: id, dx: 1, dy: 0 }])
        return entity(sim, id).x - x0
      } finally {
        ;(COMBAT as { WINDED_SPEED: number }).WINDED_SPEED = repos
      }
    }
    const inerte = pas(1)
    expect(pas(COMBAT.WINDED_SPEED)).toBeCloseTo(inerte * COMBAT.WINDED_SPEED, 5)
  })
})

describe('le télégraphe (A2)', () => {
  it('le coup ne porte qu’à la fin du wind-up ; sortir de l’arc esquive', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11, 10)
    faceA(sim, b, a) // un duel, pas une exécution : sinon c'est le coup à revers qu'on mesure
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
    faceA(sim, b, a) // face à face : le coup à revers (R6ter) n'a rien à faire ici

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
    faceA(sim, b, a)
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
    // ⚠ LA GARDE EST POSÉE AVANT, ET SA FENÊTRE A EXPIRÉ (R6bis, 2026-08-27). Une garde
    // levée EN RÉACTION au télégraphe est désormais gratuite : c'est tout l'objet de la
    // fenêtre de parade. Ce que A3 éprouve, lui, est le coût de la garde ORDINAIRE — celle
    // de qui campe derrière son bras. Sans ce préambule, le test mesurait une parade
    // parfaite et l'appelait « le blocage ».
    tick(sim, [{ entityId: b, dx: 0, dy: 0, block: true }])
    for (let t = 0; t <= COMBAT.PARRY_WINDOW_TICKS; t++) tick(sim, [{ entityId: b, dx: 0, dy: 0, block: true }])
    const staminaBefore = entity(sim, b).stamina
    strike(sim, a, 1, 0, [{ entityId: b, dx: 0, dy: 0, block: true }])
    const blocked = 100 - entity(sim, b).hp
    expect(blocked).toBeCloseTo(COMBAT.UNARMED_DAMAGE * (1 - COMBAT.BLOCK_REDUCTION), 1)
    expect(entity(sim, b).stamina).toBeLessThan(staminaBefore)

    // Même coup dans le dos (b regarde à l'est, a frappe depuis l'ouest) : hors de l'arc
    // frontal, le blocage ne protège pas — et depuis R6ter le dos coûte MÊME PLUS que le
    // plein pot. C'est le pendant exact de la parade : ce qu'on regarde, on l'encaisse
    // mieux ; ce qu'on ne voit pas venir, on le prend de plein fouet.
    entity(sim, b).hp = 100
    entity(sim, b).facing = { x: 1, y: 0 }
    strike(sim, a, 1, 0, [{ entityId: b, dx: 0, dy: 0, block: true }])
    expect(100 - entity(sim, b).hp).toBeCloseTo(COMBAT.UNARMED_DAMAGE * COMBAT.BACK_DAMAGE_FACTOR, 1)
  })
})

/**
 * Frappe avec `a` sur `b`, `garde(i)` décidant tick par tick si la touche de parade de `b`
 * est enfoncée (`i` compte depuis le départ du wind-up). Rend les événements du tick de
 * RÉSOLUTION — repéré à la disparition du wind-up, jamais calculé : l'armement d'un avatar
 * vient de `WEAPON_PROFILES` (4 ticks à mains nues) et non de `COMBAT.WINDUP_TICKS`, qui
 * est celui des bêtes. Compter à la main sur la mauvaise constante a produit une garde
 * verte pour de mauvaises raisons.
 */
function frapperContreGarde(
  sim: SimState,
  a: number,
  b: number,
  dx: number,
  dy: number,
  garde: (i: number) => boolean,
): SimEvent[] {
  drainEvents(sim)
  tick(sim, [
    { entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx, dy } },
    { entityId: b, dx: 0, dy: 0, block: garde(0) },
  ])
  if (entity(sim, a).windup === undefined) return drainEvents(sim)
  for (let i = 1; i < 60; i++) {
    drainEvents(sim)
    tick(sim, [{ entityId: b, dx: 0, dy: 0, block: garde(i) }])
    if (entity(sim, a).windup === undefined) return drainEvents(sim)
  }
  throw new Error('le wind-up ne s’est jamais résolu')
}

/** Tient (ou relâche) la garde de `b` pendant `n` ticks, sans que rien d'autre ne bouge. */
function attendre(sim: SimState, b: number, n: number, garde = false): void {
  for (let t = 0; t < n; t++) tick(sim, [{ entityId: b, dx: 0, dy: 0, block: garde }])
}

describe('la fenêtre de parade (A18, R6bis)', () => {
  /** La cible, plantée à l'est du frappeur et tournée vers lui : dans l'arc frontal. */
  const duel = (): { sim: SimState; a: number; b: number } => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11.2, 10)
    entity(sim, b).facing = { x: -1, y: 0 }
    return { sim, a, b }
  }

  it('CAMPER DERRIÈRE SA GARDE N’EST JAMAIS GRATUIT', () => {
    // ═══ LA PROPRIÉTÉ QUI PORTE TOUTE LA RÈGLE ═══
    //
    // Mon premier garde affirmait « la fenêtre est plus courte que le plus court des
    // télégraphes ». Il était FAUX, et il l'a dit : à mains nues on arme en 4 ticks (et à
    // l'arc en 3), pas en 8 — `COMBAT.WINDUP_TICKS` est l'armement des BÊTES. Aucune
    // fenêtre utile ne tient là-dessous.
    //
    // Ce qu'il fallait affirmer est plus juste : la parade se donne à qui la pose EN
    // RÉACTION, et se paie à qui campe. On l'éprouve sur TOUS les armements du jeu — un
    // seul profil assez lent pour laisser la fenêtre expirer avant la pression, et la
    // règle serait vraie par accident.
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11.2, 10)
    entity(sim, b).facing = { x: -1, y: 0 }
    // La garde est posée, PUIS on laisse la fenêtre expirer, PUIS le coup part.
    tick(sim, [{ entityId: b, dx: 0, dy: 0, block: true }])
    attendre(sim, b, COMBAT.PARRY_WINDOW_TICKS + 1, true)
    const avant = entity(sim, b).stamina
    const events = frapperContreGarde(sim, a, b, 1, 0, () => true)
    expect(events.find((e) => e.type === 'attack_blocked')).toMatchObject({ parried: false })
    expect(entity(sim, b).stamina).toBeLessThan(avant)
  })

  it('posée EN RÉACTION : la garde tient ET ne coûte pas un point de souffle', () => {
    const { sim, a, b } = duel()
    const avant = entity(sim, b).stamina
    // La touche s'enfonce APRÈS le départ du télégraphe — le geste qu'on veut apprendre.
    const events = frapperContreGarde(sim, a, b, 1, 0, (i) => i >= 1)
    const bloque = events.find((e) => e.type === 'attack_blocked')
    expect(bloque).toBeDefined()
    expect(bloque).toMatchObject({ entityId: b, byEntityId: a, parried: true })
    // Les dégâts sont réduits comme toujours — le timing paie en SOUFFLE, pas en PV
    // (R4 tient : pas d'i-frame, pas d'annulation).
    expect(100 - entity(sim, b).hp).toBeCloseTo(COMBAT.UNARMED_DAMAGE * (1 - COMBAT.BLOCK_REDUCTION), 1)
    // ET LA BARRE N'A PAS PAYÉ. On compare à `avant` et non à un nombre écrit : la
    // régénération tourne, donc la barre a le droit de MONTER — ce qui est affirmé, c'est
    // qu'elle n'a rien perdu.
    expect(entity(sim, b).stamina).toBeGreaterThanOrEqual(avant)
  })

  it('la garde tient toujours, même payée — la parade n’est pas un tout-ou-rien', () => {
    const { sim, a, b } = duel()
    tick(sim, [{ entityId: b, dx: 0, dy: 0, block: true }])
    attendre(sim, b, COMBAT.PARRY_WINDOW_TICKS + 1, true)
    const events = frapperContreGarde(sim, a, b, 1, 0, () => true)
    expect(events.find((e) => e.type === 'attack_blocked')).toMatchObject({ parried: false })
    // −70 % quand même : R6 est intact, R6bis ne fait que rendre le SOUFFLE.
    expect(100 - entity(sim, b).hp).toBeCloseTo(COMBAT.UNARMED_DAMAGE * (1 - COMBAT.BLOCK_REDUCTION), 1)
  })

  it('TENIR LA TOUCHE NE ROUVRE RIEN : la deuxième parade d’affilée se paie', () => {
    // Le cœur de la règle, et ce qui la rend inattaquable même avec une fenêtre généreuse :
    // `parryUntil` est CONSOMMÉ par la parade qu'il offre. S'il se réarmait tant que la
    // touche est tenue, garder la garde enfoncée rendrait toute la défense gratuite et R6
    // (« bloquer coûte de l'endurance par coup encaissé ») mourrait sans un mot.
    const { sim, a, b } = duel()
    const premier = frapperContreGarde(sim, a, b, 1, 0, (i) => i >= 1)
    expect(premier.find((e) => e.type === 'attack_blocked')).toMatchObject({ parried: true })
    // On laisse passer la récupération SANS JAMAIS RELÂCHER la touche.
    attendre(sim, b, BALANCE.TICK_RATE_HZ, true)
    const avant = entity(sim, b).stamina
    const second = frapperContreGarde(sim, a, b, 1, 0, () => true)
    expect(second.find((e) => e.type === 'attack_blocked')).toMatchObject({ parried: false })
    expect(entity(sim, b).stamina).toBeLessThan(avant)
  })

  it('MARTELER LA TOUCHE NE DONNE PAS DES PARADES GRATUITES', () => {
    // ═══ LE TROU QUE LE FRONT MONTANT SEUL LAISSAIT OUVERT, ET IL ÉTAIT MESURÉ ═══
    //
    // Chaque pression rouvrait une fenêtre. En martelant une fois tous les trois ticks, on
    // obtenait la protection COMPLÈTE d'une garde tenue pour **zéro souffle** — sans aucun
    // timing, sans lire quoi que ce soit. La parade parfaite devenait la conduite
    // dominante, et R6 (« bloquer coûte de l'endurance ») mourait pour la deuxième fois.
    //
    // Le remède est une phrase : une parade est un GESTE, il faut avoir BAISSÉ la garde
    // pour la relever dessus (`guardDownSince`). La garde ci-dessous affirme la conséquence
    // qui compte pour le joueur : marteler ne peut pas coûter MOINS que tenir.
    const conduite = (garde: (t: number) => boolean, coups = 5): { souffle: number; pv: number } => {
      const sim = makeSim()
      const a = spawnEntity(sim, 10, 10)
      const b = spawnEntity(sim, 11, 10)
      entity(sim, b).facing = { x: -1, y: 0 }
      entity(sim, b).hp = 100000
      entity(sim, b).hunger = 0 // régén au plancher : on mesure la DÉPENSE, pas la reprise
      let t = 0
      let paye = 0
      for (let c = 0; c < coups; c++) {
        entity(sim, a).stamina = 100
        const av = entity(sim, b).stamina
        tick(sim, [
          { entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } },
          { entityId: b, dx: 0, dy: 0, block: garde(t) },
        ])
        t++
        while (entity(sim, a).windup !== undefined) {
          tick(sim, [{ entityId: b, dx: 0, dy: 0, block: garde(t) }])
          t++
        }
        paye += Math.max(0, av - entity(sim, b).stamina)
        for (let k = 0; k < BALANCE.TICK_RATE_HZ; k++) {
          tick(sim, [{ entityId: b, dx: 0, dy: 0, block: garde(t) }])
          t++
        }
      }
      return { souffle: paye, pv: 100000 - entity(sim, b).hp }
    }
    const tenue = conduite(() => true)
    expect(tenue.souffle).toBeGreaterThan(0) // tenir sa garde COÛTE : la prémisse de la garde
    // ═══ LA PROPRIÉTÉ EST UNE NON-DOMINATION, pas une comparaison de souffle ═══
    //
    // Premier jet : « marteler coûte plus de souffle que tenir ». FAUX, et le rouge l'a
    // dit — à une pression sur deux, on ne pare quasiment jamais, donc on ne paie rien…
    // et l'on encaisse TROIS FOIS plus de PV. Marteler y paie en SANG, pas en souffle.
    // Ce qu'il faut affirmer est donc : aucune cadence ne fait MIEUX sur les deux tableaux
    // à la fois. C'est ça, « la parade gratuite n'est pas farmable ».
    for (let periode = 2; periode <= COMBAT.PARRY_WINDOW_TICKS + 2; periode++) {
      const m = conduite((t) => t % periode === 0)
      const domine = m.souffle < tenue.souffle - 1e-9 && m.pv <= tenue.pv + 1e-9
      expect(domine, `période ${periode} : souffle ${m.souffle.toFixed(1)}/${tenue.souffle.toFixed(1)}, PV ${m.pv.toFixed(1)}/${tenue.pv.toFixed(1)}`).toBe(false)
    }
  })

  it('UN SCINTILLEMENT DE JAUGE NE VAUT PAS UNE PRESSION', () => {
    // ═══ LA RAISON D'ÊTRE DE `blockHeld` ═══
    //
    // `Entity.blocking` est DÉRIVÉ à chaque tick (souffle, clarté) : il retombe à zéro
    // d'endurance et remonte au premier point regagné, sans qu'un doigt bouge. Armer la
    // fenêtre sur LUI rendrait une parade gratuite à chaque remontée de barre — et comme
    // une parade gratuite ne coûte pas de souffle, la barre resterait haute : la boucle
    // se nourrirait elle-même et R6 mourrait en silence.
    //
    // Le montage reproduit exactement ce front-là : touche tenue SANS DISCONTINUER, mais
    // la jauge qui passe sous zéro puis repasse au-dessus pendant qu'elle l'est.
    const { sim, a, b } = duel()
    tick(sim, [{ entityId: b, dx: 0, dy: 0, block: true }]) // la vraie pression : une seule
    attendre(sim, b, COMBAT.PARRY_WINDOW_TICKS + 1, true) // et sa fenêtre expire
    entity(sim, b).stamina = 0 // le dérivé RETOMBE (blocking exige stamina > 0)
    attendre(sim, b, 1, true)
    expect(entity(sim, b).blocking).toBe(false)
    attendre(sim, b, 20, true) // la régén le fait REMONTER : front montant du dérivé
    expect(entity(sim, b).blocking).toBe(true)
    // Et malgré ce front, aucune fenêtre ne s'est rouverte : la garde se paie.
    const avant = entity(sim, b).stamina
    const events = frapperContreGarde(sim, a, b, 1, 0, () => true)
    expect(events.find((e) => e.type === 'attack_blocked')).toMatchObject({ parried: false })
    expect(entity(sim, b).stamina).toBeLessThan(avant)
  })
})

describe('le raté et la garde se DISENT (A19, R4quater/R6)', () => {
  it('un coup qui fend l’air émet `attack_whiffed` ; un coup qui touche, jamais', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    spawnEntity(sim, 11.2, 10)
    // À l'ouest : personne. Le coup part dans le vide.
    drainEvents(sim)
    strike(sim, a, -1, 0)
    const vide = drainEvents(sim)
    expect(vide.filter((e) => e.type === 'attack_whiffed')).toHaveLength(1)
    expect(vide.find((e) => e.type === 'attack_whiffed')).toMatchObject({ entityId: a, charged: false })
    // À l'est : la cible. Le coup porte — et le raté se tait.
    drainEvents(sim)
    strike(sim, a, 1, 0)
    const porte = drainEvents(sim)
    expect(porte.filter((e) => e.type === 'attack_whiffed')).toHaveLength(0)
    expect(porte.filter((e) => e.type === 'entity_damaged')).not.toHaveLength(0)
  })

  it('la garde qui tient dit CE QU’ELLE A MANGÉ (`prevented`)', () => {
    // Sans ce nombre, une parade et un coup faible sont indiscernables : `entity_damaged`
    // ne porte que le montant DÉJÀ réduit. C'est `prevented` qui fait la preuve du geste.
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11.2, 10)
    entity(sim, b).facing = { x: -1, y: 0 }
    const events = frapperContreGarde(sim, a, b, 1, 0, (i) => i >= 1)
    const bloque = events.find((e) => e.type === 'attack_blocked')!
    const subi = events.find((e) => e.type === 'entity_damaged')!
    expect(bloque.prevented).toBeCloseTo(COMBAT.UNARMED_DAMAGE * COMBAT.BLOCK_REDUCTION, 5)
    // Les deux moitiés du coup se recomposent : ce qui est passé + ce qui a été mangé.
    expect(subi.amount + bloque.prevented).toBeCloseTo(COMBAT.UNARMED_DAMAGE, 5)
  })
})

describe('le coût de mort croissant (V2-21)', () => {
  it('les morts RAPPROCHÉES coûtent plus cher, puis une longue survie les OUBLIE', () => {
    const sim = makeSim()
    const p = spawnEntity(sim, 10, 10)
    // TOMBER PUIS SE RELEVER — les deux moitiés (2026-08-31) : `die` tient le COMPTE,
    // `respawn` en tire la DURÉE. Lire `exhaustedUntil` juste après `die` ne dirait plus rien.
    const kill = (): number => {
      const e = entity(sim, p)
      e.hp = 0
      die(sim, e, 0)
      respawn(sim, e)
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
    faceA(sim, b, a) // face à face : les paliers se comptent sur les dégâts NOMINAUX
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

    // ⚠ ON RESTE À TERRE (décision d'Alexis, 2026-08-31) : la mort ne relève plus toute seule.
    expect(victim.hp).toBe(0)
    expect(victim.x).toBeCloseTo(20, 5) // là où il est tombé, pas au Feu
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'respawn' } }])

    // Réveil au Feu (10,10), épuisé, compétences gardées, mains vides.
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

/**
 * ═══ ON NE SE RELÈVE QU'EN LE DEMANDANT (décision d'Alexis, 2026-08-31) ═══
 *
 * `die` faisait la mort ET la résurrection dans le même tick. Le client ne pouvait donc que
 * MASQUER un saut déjà fait, et le bouton « SE RELEVER » du voile de mort ne commandait rien.
 * La seconde moitié de la mort appartient désormais au joueur : le corps reste où il tombe,
 * à `hp = 0`, jusqu'à l'action `respawn`.
 */
describe('la mort attend le geste (2026-08-31)', () => {
  /** Un avatar avec un Feu à lui en (10,10), tué net en (20,20). Rend son id. */
  function tombeLoinDeSonFeu(sim: ReturnType<typeof makeSim>): number {
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, 'spear', { wood: 10 })
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'light_fire' } }])
    const victim = entity(sim, a)
    victim.x = 20
    victim.y = 20
    victim.hp = 1
    const killer = spawnEntity(sim, 21, 20)
    strike(sim, killer, -1, 0)
    return a
  }

  it('la chute laisse le corps SUR PLACE, à zéro — et n’émet aucun réveil', () => {
    const sim = makeSim()
    drainEvents(sim)
    const a = tombeLoinDeSonFeu(sim)
    const evts = drainEvents(sim)
    expect(evts.some((e) => e.type === 'entity_died' && e.entityId === a)).toBe(true)
    expect(evts.some((e) => e.type === 'entity_respawned')).toBe(false)
    expect(entity(sim, a).hp).toBe(0)
    expect(entity(sim, a).x).toBeCloseTo(20, 5)
  })

  it('le mort ne bouge pas, ne frappe pas, ne se retourne pas — quoi qu’on lui envoie', () => {
    const sim = makeSim()
    const a = tombeLoinDeSonFeu(sim)
    const mort = entity(sim, a)
    const ou = { x: mort.x, y: mort.y }
    const cap = { ...mort.facing }
    // Dix ticks de course, de garde et de coups : la sim est autoritative, elle ne doit
    // rien accepter d'un corps à terre — pas même le `facing` ou la fenêtre de parade,
    // qui s'écrivent APRÈS l'aiguillage des actions.
    for (let i = 0; i < 10; i++) {
      tick(sim, [{ entityId: a, dx: -1, dy: -1, block: true, action: { type: 'attack', dx: -1, dy: 0 } }])
    }
    expect(entity(sim, a).x).toBeCloseTo(ou.x, 5)
    expect(entity(sim, a).y).toBeCloseTo(ou.y, 5)
    expect(entity(sim, a).facing).toEqual(cap)
    expect(entity(sim, a).windup).toBeUndefined()
    expect(entity(sim, a).parryUntil).toBeUndefined()
    expect(entity(sim, a).hp).toBe(0) // et il n'est toujours pas debout
  })

  it('`respawn` relève AU FEU, et se refuse à un vivant', () => {
    const sim = makeSim()
    const a = tombeLoinDeSonFeu(sim)
    drainEvents(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'respawn' } }])
    expect(entity(sim, a).hp).toBe(COMBAT.RESPAWN_HP)
    expect(entity(sim, a).x).toBeCloseTo(10.5, 5)
    expect(drainEvents(sim).some((e) => e.type === 'entity_respawned' && e.entityId === a)).toBe(true)
    // Une seconde demande, debout : refusée, et sans rien remettre à neuf.
    entity(sim, a).hp = 12
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'respawn' } }])
    const evts = drainEvents(sim)
    expect(evts.some((e) => e.type === 'entity_respawned')).toBe(false)
    expect(evts.some((e) => e.type === 'action_rejected' && e.reason === 'debout')).toBe(true)
    expect(entity(sim, a).hp).toBeLessThan(COMBAT.RESPAWN_HP)
  })

  it('un coup porté sur un corps à terre ne le RETUE pas : ni second `entity_died`, ni dépouille vide', () => {
    const sim = makeSim()
    const a = tombeLoinDeSonFeu(sim)
    const corpsesApresLaMort = sim.corpses.length
    drainEvents(sim)
    // Le tueur est toujours là, à côté : il frappe encore.
    const killer = sim.entities.find((e) => e.id !== a && e.hp > 0)!
    for (let i = 0; i < 3; i++) strike(sim, killer.id, -1, 0)
    const evts = drainEvents(sim)
    expect(evts.some((e) => e.type === 'entity_died' && e.entityId === a)).toBe(false)
    expect(sim.corpses).toHaveLength(corpsesApresLaMort)
  })

  /**
   * LES DEUX MOITIÉS DU COÛT DE MORT (V2-21), de part et d'autre du geste.
   *
   * Le COMPTE se tient à la CHUTE : il mesure le temps VÉCU entre deux morts, et le temps
   * passé à terre n'en est pas. L'ÉPUISEMENT part du RÉVEIL : sinon il se consumerait
   * pendant qu'on gît. Mettre les deux du même côté ouvre une faute dans un sens ou dans
   * l'autre — et rester mort deviendrait, au choix, gratuit ou reposant.
   */
  it('traîner devant le voile n’efface pas la dette, et n’use pas l’épuisement', () => {
    const sim = makeSim()
    const a = tombeLoinDeSonFeu(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'respawn' } }])
    const premier = entity(sim, a).exhaustedUntil - sim.tick
    expect(entity(sim, a).deathCount).toBe(1)
    // Deuxième mort, RAPPROCHÉE (on vient de se relever) — puis on laisse le voile levé
    // très longtemps, bien au-delà de la fenêtre d'oubli.
    entity(sim, a).x = 20
    entity(sim, a).y = 20
    entity(sim, a).hp = 1
    const killer = spawnEntity(sim, 21, 20)
    strike(sim, killer, -1, 0)
    expect(entity(sim, a).hp).toBe(0)
    expect(entity(sim, a).deathCount).toBe(2) // la dette est comptée dès la chute
    sim.tick += COMBAT.DEATH_FORGET_TICKS + 1
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'respawn' } }])
    // ① la dette tient : gésir n'est pas survivre.
    expect(entity(sim, a).deathCount).toBe(2)
    // ② …et elle se paie EN ENTIER au réveil : l'épuisement n'a pas coulé pendant ce temps.
    expect(entity(sim, a).exhaustedUntil - sim.tick).toBeGreaterThan(premier)
  })
})

describe('les monstres (A6)', () => {
  it('le Cendreux aggro, télégraphe, frappe — et meurt à la lance', () => {
    const sim = makeSim()
    // LA NUIT FROIDE, AU CŒUR DU GRAND FROID : depuis le cadran de température (2026-08-21),
    // un cendreux en plein jour tiède est presque amorphe (vue au plancher) — l'aggro se teste
    // au régime où il chasse. Ce régime se cherchait « au jour 55 » quand l'acte III était
    // l'hiver ; sous les quatre saisons qui tournent (`saisons.md` S4), le jour 55 est le plein
    // été à +20 °C et l'éveil y tombe à zéro. Le cycle démarre à l'aube : on ajoute la longueur
    // du JOUR — saisonnière depuis S6, donc LUE sur le cycle et non plus constante.
    sim.tick = (coeurDeSaison(4) - 1) * TICKS_PER_SEASON_DAY
    sim.tick -= sim.tick % TICKS_PER_CYCLE
    sim.tick += dayTicksAt(sim, sim.tick) + 1
    expect(gameTimeAt(sim, sim.tick).isNight).toBe(true) // le décalage est un calibrage : il se prouve
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
    // UNE BÊTE NE SE FOUILLE PAS, ELLE SE DÉPÈCE (spec `depecage.md` D1/D4) : le clic de coffre est
    // refusé, le couteau en main ouvre le réservoir, et on TIENT jusqu'à la dernière part.
    const corpse = sim.corpses[0]!
    expect(corpse.carcass?.species).toBe('boar')
    entity(sim, a).x = corpse.x
    entity(sim, a).y = corpse.y
    drainEvents(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId: corpse.id } }])
    expect(drainEvents(sim).some((e) => e.type === 'action_rejected' && e.reason === 'il faut le dépecer')).toBe(true)
    expect(countOf(entity(sim, a).inventory, 'raw_meat')).toBe(0)
    grantHeld(sim, a, 'crude_knife')
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ && sim.corpses.some((c) => c.id === corpse.id); t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'butcher_start', corpseId: corpse.id, hold: t > 0 } }])
    }
    // Niveau 0 : la viande sort, l'OS reste sur la bête (D5) — la carcasse demeure, avec lui seul.
    expect(countOf(entity(sim, a).inventory, 'raw_meat')).toBe(3)
    expect(countOf(entity(sim, a).inventory, 'bone')).toBe(0)
    expect(countOf(sim.corpses.find((c) => c.id === corpse.id)!.inventory, 'bone')).toBe(1)
    const lance = entity(sim, a).inventory.findIndex((s) => s?.item === 'spear')
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'set_active_slot', slot: lance } }])
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
describe('le dos coûte cher (A20, R6ter)', () => {
  /**
   * Frappe `b` depuis l'ouest, `b` regardant dans la direction donnée. Rend les dégâts ET
   * le cosinus RÉEL de l'axe cible→frappeur contre le regard.
   *
   * ⚠ LE COSINUS SE RELÈVE SUR LES POSITIONS D'ARRIVÉE, et c'est une correction payée d'un
   * rouge : les poings AVANCENT en frappant, et en zigzag (`weave`). Un modèle de
   * référence qui suppose l'axe plein ouest se trompe de plusieurs degrés — il accusait la
   * règle alors qu'il se trompait lui-même. On lit des POSITIONS (pas la règle qu'on
   * teste) : la garde reste indépendante de ce qu'elle éprouve.
   */
  function coup(regard: { x: number; y: number }): { degats: number; cos: number } {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    const b = spawnEntity(sim, 11, 10)
    entity(sim, b).facing = regard
    entity(sim, b).hp = 100
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    let cos = 1
    for (let t = 0; t < COMBAT.WINDUP_TICKS + 2; t++) {
      // Le tick où le wind-up disparaît EST celui de la résolution : on relève juste avant.
      const arme = entity(sim, a).windup !== undefined
      if (arme) {
        const tx = entity(sim, b).x - entity(sim, a).x
        const ty = entity(sim, b).y - entity(sim, a).y
        const d = Math.sqrt(tx * tx + ty * ty)
        cos = d > 0 ? (-tx * regard.x - ty * regard.y) / d : 1
      }
      tick(sim)
    }
    return { degats: 100 - entity(sim, b).hp, cos }
  }
  const degats = (regard: { x: number; y: number }): number => coup(regard).degats

  /**
   * La `n`-ième direction unitaire sur `total`, SANS trigonométrie : on marche le
   * périmètre du carré [−1, 1]² et l'on normalise. Couverture angulaire équivalente,
   * `+ − × ÷` et `sqrt` seulement — l'invariant §2 vaut aussi pour les tests.
   */
  function directionN(n: number, total: number): { x: number; y: number } {
    const t = (4 * n) / total // le périmètre en quatre côtés
    const c = Math.floor(t)
    const u = t - c
    const p = c === 0 ? { x: 1, y: -1 + 2 * u } : c === 1 ? { x: 1 - 2 * u, y: 1 } : c === 2 ? { x: -1, y: 1 - 2 * u } : { x: -1 + 2 * u, y: -1 }
    const l = Math.sqrt(p.x * p.x + p.y * p.y)
    return { x: p.x / l, y: p.y / l }
  }

  it('DE FACE le coup est nominal, DE DOS il coûte `BACK_DAMAGE_FACTOR` fois plus', () => {
    const face = degats({ x: -1, y: 0 }) // b regarde son agresseur
    const dos = degats({ x: 1, y: 0 }) // b lui tourne le dos
    expect(face).toBeCloseTo(COMBAT.UNARMED_DAMAGE, 1)
    expect(dos).toBeCloseTo(COMBAT.UNARMED_DAMAGE * COMBAT.BACK_DAMAGE_FACTOR, 1)
  })

  it('LES FLANCS NE PAIENT PAS : la prime est un ARC arrière, pas un demi-plan', () => {
    // Sans cette garde, « pas de face » vaudrait « dans le dos », et tourner la tête d'un
    // degré ferait basculer les dégâts. Le flanc est le régime NEUTRE entre la parade
    // (arc frontal de 120°) et le revers (arc arrière de 120°) — les deux se complètent
    // exactement, et c'est ce qui rend la règle lisible à l'œil.
    expect(degats({ x: 0, y: 1 })).toBeCloseTo(COMBAT.UNARMED_DAMAGE, 1)
    expect(degats({ x: 0, y: -1 })).toBeCloseTo(COMBAT.UNARMED_DAMAGE, 1)
  })

  it('BALAYAGE SUR LE TOUR COMPLET : la prime est monotone, et jamais entre les deux arcs', () => {
    // La règle affirmée sur TOUT le domaine, pas sur trois cas choisis (le patron
    // « garde exhaustive plutôt que cas choisis »). On tourne la cible degré par degré.
    const nominal = COMBAT.UNARMED_DAMAGE
    const prime = nominal * COMBAT.BACK_DAMAGE_FACTOR
    let dansLeDos = 0
    let neutres = 0
    // ⚠ LES DIRECTIONS SE FABRIQUENT SANS TRIGONOMÉTRIE. `Math.cos`/`Math.sin` sont
    // interdits dans /sim, tests compris (invariant §2 — le lint le fait respecter), et
    // c'est une bonne contrainte : on parcourt le PÉRIMÈTRE D'UN CARRÉ et l'on normalise.
    // La couverture angulaire est la même, et rien d'approximé n'entre dans le dépôt.
    for (let i = 0; i < 72; i++) {
      const regard = directionN(i, 72)
      const { degats: d, cos } = coup(regard)
      // JAMAIS une valeur intermédiaire : la prime est un PALIER, pas une rampe — c'est
      // ce qui la rend lisible, et c'est vrai partout sur le tour.
      expect(Math.min(Math.abs(d - prime), Math.abs(d - nominal)), `regard ${i}`).toBeLessThan(0.5)
      // Et le palier suit l'arc, sur le cosinus RÉEL. ⚠ UNE BANDE MORTE AUTOUR DE LA
      // FRONTIÈRE, et elle est HONNÊTE : le relevé se fait avant le dernier tick, donc
      // avant l'ultime pas du coup (`advanceLunge` tourne AVANT la résolution, dans le même
      // tick). Lire la position exacte de la résolution demanderait de recopier
      // `advanceLunge` dans le test — un modèle de référence qui réimplémente ce qu'il
      // teste. On préfère ne rien affirmer sur une bande de 0,1 de cosinus, et affirmer
      // fort partout ailleurs ; le PALIER, lui, est affirmé sur tout le tour sans exception.
      if (cos <= COMBAT.BACK_ARC_COS - 0.1) {
        expect(d, `regard ${i} (cos ${cos.toFixed(3)})`).toBeCloseTo(prime, 1)
        dansLeDos++
      } else if (cos >= COMBAT.BACK_ARC_COS + 0.1) {
        expect(d, `regard ${i} (cos ${cos.toFixed(3)})`).toBeCloseTo(nominal, 1)
        neutres++
      }
    }
    // La garde prouve sa prémisse : les deux régimes ont bien été VISITÉS.
    expect(dansLeDos).toBeGreaterThan(0)
    expect(neutres).toBeGreaterThan(0)
  })

  it('LA MEUTE Y GAGNE AUSSI — personne ne triche (R4quinquies)', () => {
    // La règle n'est pas une faveur au joueur : un loup qui prend un homme à revers mord
    // plus fort, exactement comme l'homme qui prend le loup à revers. C'est ce qui rend
    // l'encerclement de `faune.md` R11 vraiment dangereux, et c'est assumé.
    const sim = makeSim()
    const proie = spawnEntity(sim, 20, 20)
    entity(sim, proie).hp = 1000
    entity(sim, proie).facing = { x: 1, y: 0 } // il regarde à l'est…
    const loup = entity(sim, spawnMonster(sim, 'wolf', 19.1, 20)) // …le loup vient de l'ouest
    loup.stamina = 100
    const def = MONSTER_DEFS.wolf
    startAttack(sim, loup, 1, 0, { windupTicks: def.windupTicks, damage: def.damage })
    for (let t = 0; t < def.windupTicks + 2; t++) tick(sim)
    expect(1000 - entity(sim, proie).hp).toBeCloseTo(def.damage * COMBAT.BACK_DAMAGE_FACTOR, 1)
  })

  it('À 1, LA RÈGLE EST RIGOUREUSEMENT INERTE (la garde arme sa constante)', () => {
    const repos = COMBAT.BACK_DAMAGE_FACTOR
    ;(COMBAT as { BACK_DAMAGE_FACTOR: number }).BACK_DAMAGE_FACTOR = 1
    try {
      expect(degats({ x: 1, y: 0 })).toBeCloseTo(degats({ x: -1, y: 0 }), 5)
    } finally {
      ;(COMBAT as { BACK_DAMAGE_FACTOR: number }).BACK_DAMAGE_FACTOR = repos
    }
  })
})

describe('le coup LOURD repousse (A16, R4sexies)', () => {
  // ═══ LA SÉPARATION EST ÉTEINTE ICI, ET C'EST UNE ISOLATION, PAS UNE COMMODITÉ ═══
  //
  // Deux corps qui se recouvrent se repoussent (A17, `separation.ts`) — une règle voisine
  // mais INDÉPENDANTE. Or un coup chargé rapproche (l'overhead des poings avance de 0,5
  // tuile) : la poussée mesurée serait alors « recul + séparation », et A16 se croirait
  // en train de mesurer le recul. Le défaut s'est vu à la lecture d'un rapport : les
  // poings, qui frappent à 18, repoussaient PLUS FORT que la hache à 24.
  const reposPush = COMBAT.SEPARATION_PUSH
  beforeAll(() => {
    ;(COMBAT as { SEPARATION_PUSH: number }).SEPARATION_PUSH = 0
  })
  afterAll(() => {
    ;(COMBAT as { SEPARATION_PUSH: number }).SEPARATION_PUSH = reposPush
  })

  /**
   * Frappe une cible immobile à `dist` à l'est, et rend de combien elle a reculé — la
   * NORME du déplacement, pas sa composante en x. Le recul est radial depuis la position
   * d'ARRIVÉE du frappeur (qui a fait son pas d'armement, en zigzag pour les poings) :
   * l'axe frappeur→frappé n'est donc pas tout à fait l'est, et mesurer sur x seul
   * mesurerait le pas de l'attaquant plutôt que la poussée.
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

  it('LE COUP SIMPLE NE REPOUSSE PAS — d’aucune arme, pas d’un cheveu', () => {
    // La moitié de la règle, et celle qui protège la meute. Balayé sur TOUT l'arsenal de
    // mêlée : un seul profil qui pousserait au clic bref rendrait la nuit inoffensive.
    for (const arme of Object.keys(WEAPON_PROFILES) as (keyof typeof WEAPON_PROFILES)[]) {
      if (WEAPON_PROFILES[arme].light.single === true) continue // les arcs : le trait ne pousse pas (T10)
      expect(recul(1.05, arme as ItemId)).toBeCloseTo(0, 6)
    }
    expect(recul(1)).toBeCloseTo(0, 6) // et les mains nues
  })

  it('AUCUNE BÊTE NE REPOUSSE JAMAIS — la garde qui tient l’encerclement', () => {
    // ═══ CE QUI REND L'ARBITRAGE SOLUBLE ═══
    //
    // La mesure du 2026-08-02 donnait 6/6 d'encerclement à recul nul et 0/6 dès 0,10 tuile.
    // Elle n'accusait pas le recul : elle accusait « TOUT coup recule », morsures comprises.
    // Ici la propriété est PROUVÉE et non échantillonnée — on balaie toutes les espèces qui
    // frappent, et aucune ne déplace sa proie d'un pouce. Une seule qui le ferait, et
    // `faune.md` R11 (l'encerclement) et R13 (« la mort doit être l'issue probable »)
    // retomberaient — sans qu'aucun test de combat ne rougisse.
    let espècesÉprouvées = 0
    for (const [type, def] of Object.entries(MONSTER_DEFS)) {
      if (def.damage <= 0) continue // les herbivores ne frappent pas
      const sim = makeSim()
      const proie = spawnEntity(sim, 20, 20)
      entity(sim, proie).hp = 1000
      // La bête à l'OUEST de sa proie, et elle frappe vers l'est : la première version la
      // plaçait à l'est en frappant vers l'est — le coup partait dans le dos de personne,
      // et les trois espèces passaient le test sans qu'aucun coup ne porte. La garde
      // affirme donc d'abord que le coup a PORTÉ.
      const bête = entity(sim, spawnMonster(sim, type as MonsterType, 19.1, 20))
      bête.stamina = 100
      const avant = { x: entity(sim, proie).x, y: entity(sim, proie).y }
      // La bête frappe par le MÊME chemin que dans le jeu (`startAttack`, dégâts imposés).
      startAttack(sim, bête, 1, 0, { windupTicks: def.windupTicks, damage: def.damage })
      for (let t = 0; t < def.windupTicks + 2; t++) tick(sim)
      const après = entity(sim, proie)
      expect(entity(sim, proie).hp).toBeLessThan(1000) // le coup a bien PORTÉ…
      const ex = après.x - avant.x
      const ey = après.y - avant.y
      expect(Math.sqrt(ex * ex + ey * ey)).toBeCloseTo(0, 6) // …et n'a rien déplacé
      espècesÉprouvées++
    }
    // La garde prouve sa prémisse : un balayage qui n'aurait éprouvé personne serait vert
    // pour rien (le défaut connu du domaine vide).
    expect(espècesÉprouvées).toBeGreaterThanOrEqual(3)
  })

  it('le coup CHARGÉ, lui, repousse — et en S’ÉLOIGNANT du frappeur', () => {
    // La hache : son coup chargé est un tourbillon (360°), donc la cible est dans la zone
    // quelle que soit la finesse de la visée — on éprouve le POIDS, pas l'adresse.
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const c = spawnEntity(sim, 21.2, 20)
    entity(sim, a).stamina = 100
    entity(sim, c).hp = 1000
    grantHeld(sim, a, 'iron_axe')
    chargedStrike(sim, a, 1, 0, WEAPON_PROFILES.iron_axe.chargeTicks + 2)
    const frappeur = entity(sim, a)
    const frappé = entity(sim, c)
    const ax = 21.2 - frappeur.x
    const ay = 20 - frappeur.y
    const bx = frappé.x - frappeur.x
    const by = frappé.y - frappeur.y
    expect(Math.sqrt(bx * bx + by * by)).toBeGreaterThan(Math.sqrt(ax * ax + ay * ay))
  })

  it('L’AMPLITUDE SUIT LES DÉGÂTS : le tourbillon dégage plus que l’overhead', () => {
    // Une arme se sent par son POIDS, pas par son seul chiffre — le même patron que le
    // recul PEINT du client (`encaissement.ts`, `amplitudeRecul`).
    const poings = recul(1.0, undefined, WEAPON_PROFILES.unarmed.chargeTicks + 2) // overhead, 18
    const hache = recul(1.2, 'iron_axe', WEAPON_PROFILES.iron_axe.chargeTicks + 2) // tourbillon, 24
    expect(poings).toBeGreaterThan(0)
    expect(hache).toBeGreaterThan(poings)
    // Le plein barème n'est pas dépassé : la rampe est plate au-delà.
    expect(hache).toBeLessThanOrEqual(COMBAT.KNOCKBACK_TILES + 1e-6)
    // Et le rapport des deux poussées EST celui de leurs dégâts (la rampe est linéaire).
    expect(hache / poings).toBeCloseTo(
      WEAPON_PROFILES.iron_axe.charged.damage / WEAPON_PROFILES.unarmed.charged.damage,
      2,
    )
  })

  it('un MUR arrête le recul — c’est un pas, pas une téléportation', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const c = spawnEntity(sim, 21.2, 20)
    entity(sim, a).stamina = 100
    entity(sim, c).hp = 1000
    grantHeld(sim, a, 'iron_axe')
    // Le sol devient roche juste derrière la cible : le recul bute dessus.
    sim.map.terrain[20 * sim.map.width + 22] = TERRAIN_ROCK
    chargedStrike(sim, a, 1, 0, WEAPON_PROFILES.iron_axe.chargeTicks + 2)
    expect(entity(sim, c).x).toBeLessThan(21.2 + COMBAT.KNOCKBACK_TILES)
  })

})

/**
 * ═══ A16bis (R4octies) — LE COUP QUI PORTE BRISE LE COUP D'EN FACE ═══
 *
 * ⚑ RENVERSEMENT DU 2026-08-31 (décision d'Alexis). A16 affirmait l'INVERSE jusqu'à cette
 * date — « le recul n'INTERROMPT pas le coup de celui qui le prend » — au motif que
 * marteler verrouillerait n'importe quoi. Ce n'est pas le recul qui interrompt (il ne l'a
 * jamais fait, et il ne le fait toujours pas) : c'est le COUP QUI PORTE, chargé ou non,
 * de mêlée ou de trait, et pour tout le monde.
 *
 * Le frein au martèlement n'est donc pas l'absence d'interruption, c'est l'ENDURANCE prise
 * à l'ARMEMENT (`startAttack`) et la CADENCE que les IA se posent au départ de leur coup :
 * les deux gardes ci-dessous les affirment, sans quoi le motif de R4sexies reviendrait
 * intact et cette section serait un aveu à moitié écrit.
 */
describe('le coup qui porte BRISE le coup d’en face (A16bis, R4octies)', () => {
  /** `b` s'arme d'un coup LONG (il ne se résoudra jamais tout seul dans la fenêtre). */
  const LONG = 40

  it('un corps touché en plein wind-up LÂCHE son geste — et le fait se dit', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const b = spawnEntity(sim, 20.9, 20)
    for (const id of [a, b]) {
      entity(sim, id).stamina = 100
      entity(sim, id).hp = 1000
    }
    // `b` arme un coup qui met deux secondes à venir ; `a` frappe simple, bien plus vite.
    startAttack(sim, entity(sim, b), -1, 0, { windupTicks: LONG, damage: 10 })
    drainEvents(sim)
    const dits: SimEvent[] = []
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    dits.push(...drainEvents(sim))
    for (let t = 0; t < LONG + 4; t++) {
      tick(sim)
      dits.push(...drainEvents(sim))
    }
    expect(entity(sim, b).hp).toBeLessThan(1000) // le coup de `a` a bien PORTÉ…
    expect(entity(sim, b).windup).toBeUndefined() // …le geste est LÂCHÉ, pas mis en attente…
    expect(entity(sim, a).hp).toBe(1000) // …et il ne se résout JAMAIS : `a` ne prend rien.
    // LE FAIT SE DIT — sinon le télégraphe s'éteindrait sans un son ni une image (le
    // défaut même qu'`attack_whiffed` avait corrigé sur le coup raté).
    const brisé = dits.filter((e) => e.type === 'attack_interrupted')
    expect(brisé).toHaveLength(1)
    expect(brisé[0]).toMatchObject({ entityId: b, byEntityId: a })
  })

  it('CAMP-AVEUGLE : la bête brise le coup du joueur exactement comme il brise le sien', () => {
    // « Personne ne triche » (invariant §7). En 1v3 on se fait donc briser trois fois plus
    // qu'on ne brise : la règle penche du côté du NOMBRE, ce que le GDD §7 demande.
    // Balayé sur toutes les espèces qui frappent — une seule qui ne briserait pas, et la
    // symétrie serait un vœu au lieu d'une propriété.
    let espècesÉprouvées = 0
    for (const [type, def] of Object.entries(MONSTER_DEFS)) {
      if (def.damage <= 0) continue // les herbivores ne frappent pas
      const sim = makeSim()
      const joueur = spawnEntity(sim, 20, 20)
      entity(sim, joueur).hp = 1000
      entity(sim, joueur).stamina = 100
      const bête = entity(sim, spawnMonster(sim, type as MonsterType, 19.1, 20))
      bête.stamina = 100
      // Le joueur s'arme d'un coup long, vers l'ouest (la bête est à l'ouest) ; la bête
      // frappe vers l'est et le touche avant que son geste à lui n'aboutisse.
      startAttack(sim, entity(sim, joueur), -1, 0, { windupTicks: LONG, damage: 10 })
      startAttack(sim, bête, 1, 0, { windupTicks: def.windupTicks, damage: def.damage })
      for (let t = 0; t < def.windupTicks + 2; t++) tick(sim)
      expect(entity(sim, joueur).hp).toBeLessThan(1000) // la morsure a PORTÉ…
      expect(entity(sim, joueur).windup).toBeUndefined() // …et elle a brisé le geste
      espècesÉprouvées++
    }
    expect(espècesÉprouvées).toBeGreaterThanOrEqual(3) // la garde prouve sa prémisse
  })

  it('un coup BRISÉ a coûté son endurance — le frein au martèlement, moitié une', () => {
    // `startAttack` prend l'endurance à l'ARMEMENT : un coup brisé est un coup PAYÉ, et se
    // faire briser en boucle essouffle. On l'affirme sur la BARRE, jamais sur la constante.
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const b = spawnEntity(sim, 20.9, 20)
    for (const id of [a, b]) {
      entity(sim, id).stamina = 100
      entity(sim, id).hp = 1000
    }
    startAttack(sim, entity(sim, b), -1, 0, { windupTicks: LONG, damage: 10 })
    const armé = entity(sim, b).stamina
    expect(armé).toBeLessThan(100) // l'armement a déjà pris
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < 3; t++) tick(sim)
    expect(entity(sim, b).windup).toBeUndefined() // brisé…
    expect(entity(sim, b).stamina).toBeLessThanOrEqual(armé + 100 / BALANCE.TICK_RATE_HZ) // …et rien n'est RENDU
  })

  it('la CADENCE d’une IA est posée à l’armement : la briser ne lui rend pas son coup', () => {
    // Le frein, moitié deux — et c'est lui qui répond au motif de R4sexies pour les bêtes.
    // Bêtes, Cendreux, PNJ et milice écrivent tous `cooldownUntil` juste APRÈS `startAttack` :
    // briser la morsure d'un loup ne la lui rend pas, il attend sa cadence quand même.
    const sim = makeSim()
    const proie = spawnEntity(sim, 20, 20)
    entity(sim, proie).hp = 1000
    entity(sim, proie).stamina = 100
    const def = MONSTER_DEFS.wolf
    const loup = entity(sim, spawnMonster(sim, 'wolf', 19.1, 20))
    loup.stamina = 100
    startAttack(sim, loup, 1, 0, { windupTicks: def.windupTicks, damage: def.damage })
    loup.cooldownUntil = sim.tick + def.attackCooldownTicks // ce que fait `faune.ts` au départ du coup
    tick(sim, [{ entityId: proie, dx: 0, dy: 0, action: { type: 'attack', dx: -1, dy: 0 } }])
    for (let t = 0; t < 3; t++) tick(sim)
    expect(loup.windup).toBeUndefined() // le coup est brisé…
    expect(loup.cooldownUntil).toBeGreaterThan(sim.tick) // …et la cadence court toujours
  })

  it('un corps brisé peut se réarmer AU TICK SUIVANT — et le repaie', () => {
    // La brisure supprime `windup` PENDANT `advanceCombat`, qui court APRÈS les actions du
    // tick. Il faut donc affirmer que le tick d'après voit une ardoise propre : sans ça, le
    // refus « déjà en train de frapper » (`checkCanAttack`) pourrait survivre à un geste qui
    // n'existe plus, et un corps brisé resterait muet sans que rien ne le dise. On l'éprouve
    // sur `step()` entier, jamais sur une phase seule — le défaut vit entre les deux.
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const b = spawnEntity(sim, 20.9, 20)
    for (const id of [a, b]) {
      entity(sim, id).stamina = 100
      entity(sim, id).hp = 1000
    }
    startAttack(sim, entity(sim, b), -1, 0, { windupTicks: LONG, damage: 10 })
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < 4; t++) tick(sim)
    expect(entity(sim, b).windup).toBeUndefined() // brisé…
    const avant = entity(sim, b).stamina
    tick(sim, [{ entityId: b, dx: 0, dy: 0, action: { type: 'attack', dx: -1, dy: 0 } }])
    expect(entity(sim, b).windup).toBeDefined() // …et il se réarme au tick suivant…
    expect(entity(sim, b).stamina).toBeLessThan(avant) // …en repayant son souffle.
  })

  it('UN COUP LOURD NE SE BRISE PAS — la borne, et elle est visible (R4nonies)', () => {
    // La borne que la règle nue n'avait pas. On l'affirme sur le CHAMP du coup, jamais sur
    // l'espèce ni sur le camp : `lourd` est une propriété du `Strike`, donc la même en PvE
    // et en PvP, et le télégraphe la lit dans le snapshot (aplat contre contour).
    const sim = makeSim()
    const a = spawnEntity(sim, 20, 20)
    const b = spawnEntity(sim, 20.9, 20)
    for (const id of [a, b]) {
      entity(sim, id).stamina = 100
      entity(sim, id).hp = 1000
    }
    // `b` arme un coup LOURD et long ; `a` le frappe pendant l'armement.
    startAttack(sim, entity(sim, b), -1, 0, {
      strike: { ...WEAPON_PROFILES.unarmed.light, windupTicks: LONG, lourd: true },
    })
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < 4; t++) tick(sim)
    expect(entity(sim, b).hp).toBeLessThan(1000) // le coup de `a` a bien PORTÉ…
    expect(entity(sim, b).windup).toBeDefined() // …et le geste lourd TIENT
    // …et il finit par se résoudre : `a` le prend.
    for (let t = 0; t < LONG + 4; t++) tick(sim)
    expect(entity(sim, a).hp).toBeLessThan(1000)
  })

  it('LE COUP CHARGÉ DE TOUTE ARME DE MÊLÉE EST LOURD, ET AUCUN COUP LÉGER NE L’EST', () => {
    // Balayage exhaustif sur `WEAPON_PROFILES` : la grammaire ne vaut que si elle est vraie
    // de TOUTE la table. Une arme dont le coup chargé serait annulable rendrait la règle
    // mensongère au moment précis où le joueur a le plus investi (34 d'endurance).
    // LES ARCS SONT L'EXCEPTION ASSUMÉE : une corde tendue n'est pas un coup lourd, et
    // couper la visée d'un archer est très exactement l'échange qu'on veut garder.
    let mêléeÉprouvée = 0
    for (const [nom, profil] of Object.entries(WEAPON_PROFILES)) {
      expect({ [nom]: profil.light.lourd }).toEqual({ [nom]: undefined }) // aucun coup léger n'est lourd
      if (profil.ranged === true) {
        expect({ [nom]: profil.charged.lourd }).toEqual({ [nom]: undefined })
        continue
      }
      expect({ [nom]: profil.charged.lourd }).toEqual({ [nom]: true })
      mêléeÉprouvée++
    }
    expect(mêléeÉprouvée).toBeGreaterThanOrEqual(4) // la garde prouve sa prémisse
  })

  it('L’ALPHA MORD ROUGE, LA MEUTE MORD JAUNE — le mélange qui fait la règle', () => {
    // Le cœur de la décision du 2026-08-31 : une espèce toute jaune rend le martèlement
    // invincible (2/6 morts en 24 s, mesuré), une espèce toute rouge retire au joueur
    // l'échange qu'on vient de lui donner. C'est le MÉLANGE au sein de l'espèce qui
    // enseigne — « je coupe les suivants, j'esquive le chef ».
    //
    // On l'affirme sur ce que le loup ARME PAR LE VRAI CHEMIN (la boucle de faune), et non
    // en rappelant `startAttack` à la main : c'est le câblage qu'on éprouve, pas le champ.
    // D'où le banc de `loup.test.ts` — NUIT et faune ambiante coupée, sans quoi le loup ne
    // chasse pas et la garde serait verte pour n'avoir rien mesuré.
    // LE BANC EST CELUI DE `diag-recul.mts` — une MEUTE (alpha + trois) sur une proie, la
    // nuit, faune ambiante coupée. C'est le seul montage dont on sache qu'il fait mordre :
    // un loup SEUL ne chasse pas, et la riposte de clan veut un clan. Un banc qui
    // n'arrache aucune morsure rendrait cette garde verte pour n'avoir rien mesuré.
    const map = createEmptyMap(160, 160, TERRAIN_GRASS)
    const sim = createSim(0, { map, faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(2, 1) })
    const herdId = sim.nextHerdId++
    const alphaId = spawnMonster(sim, 'wolf', 80.5, 80.5)
    const chef = sim.monsters.find((z) => z.entityId === alphaId)!
    chef.herdId = herdId
    chef.alpha = true
    entity(sim, alphaId).hp = MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP
    const suivants: number[] = []
    for (let k = 1; k <= 3; k++) {
      const id = spawnMonster(sim, 'wolf', 80.5 + k * 1.2, 80.5)
      const m = sim.monsters.find((z) => z.entityId === id)!
      m.herdId = herdId
      m.alphaId = alphaId
      suivants.push(id)
    }
    const proie = spawnEntity(sim, 84.5, 80.5)
    entity(sim, proie).hp = 100000 // il doit TENIR le temps que tout le monde ait mordu
    // On relève la couleur de CHAQUE morsure armée, par le vrai chemin de la faune.
    let chefRouge: boolean | undefined
    let suivantJaune: boolean | undefined
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim, [{ entityId: proie, dx: 0, dy: 0 }])
      const wc = entity(sim, alphaId).windup
      if (wc && chefRouge === undefined) chefRouge = wc.strike.lourd === true
      for (const id of suivants) {
        const w = entity(sim, id).windup
        if (w && suivantJaune === undefined) suivantJaune = w.strike.lourd === undefined
      }
      if (chefRouge !== undefined && suivantJaune !== undefined) break
    }
    // La prémisse, séparément : les deux ont bien ARMÉ. Sans ça, `undefined` vaudrait
    // « jaune » comme « n'a rien fait », et la moitié de la garde passerait par accident.
    expect(chefRouge, 'le chef a bien armé une morsure').toBeDefined()
    expect(suivantJaune, 'un suivant a bien armé une morsure').toBeDefined()
    expect(chefRouge).toBe(true) // le chef : ROUGE, inannulable
    expect(suivantJaune).toBe(true) // la meute : JAUNE, on peut la couper
  })

  it('un dégât qui ne vient d’AUCUN coup ne brise rien (le saignement, la foudre)', () => {
    // La règle vit dans `resolveStrike`, jamais dans `applyDamage` — qui est l'ÉVIER des
    // dégâts : la plaie de chasse, la foudre et le froid y passent aussi. Un wind-up brisé
    // par un tick de saignement serait une interruption que PERSONNE n'a portée.
    const sim = makeSim()
    const seul = spawnEntity(sim, 20, 20)
    entity(sim, seul).hp = 1000
    entity(sim, seul).stamina = 100
    startAttack(sim, entity(sim, seul), 1, 0, { windupTicks: LONG, damage: 10 })
    drainEvents(sim)
    applyDamage(sim, entity(sim, seul), 25, 0)
    expect(entity(sim, seul).hp).toBeLessThan(1000) // le dégât a bien eu lieu…
    expect(entity(sim, seul).windup).toBeDefined() // …et le geste TIENT
    expect(drainEvents(sim).filter((e) => e.type === 'attack_interrupted')).toHaveLength(0)
  })
})
