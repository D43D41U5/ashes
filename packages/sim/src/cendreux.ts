/**
 * La levée des Cendreux (spec 2026-07-08). Critère de mort, réveil, IA. Pur/déterministe.
 */
import { BALANCE, CENDREUX, COMBAT, MONSTER_DEFS, MORTS, NIGHT_HUNT, SLOTS } from './balance'
import { startAttack } from './combat'
import { distSq } from './geometry'
import { emitEvent } from './events'
import { fireActive, fireState } from './fire'
import { baselineTemperature, eveilPourTemperature } from './temperature'
import { isEmpty, pourInto } from './items'
import {
  attackBlockingStructure,
  champDesFeux,
  descendreLeChamp,
  hordeStep,
  moveToward,
  nearestPrey,
  placeSousPlafondGlobal,
  spawnMonster,
  type CacheFlux,
  type Monster,
} from './monsters'
import { densiteDesMorts, siteDansLaCouronne } from './morts'
import { isPrey, stimulusPourLesMorts } from './faune'
import { hash2 } from './noise'
import { lisserLeChemin, pathToward } from './pathfinding'
import { jourDeSaison, seasonRamp } from './time'
import type { Entity, SimState } from './sim'
import { spillOnGround } from './village'

/**
 * Combien de Cendreux NÉS D'UN CADAVRE marchent encore (le plafond de R8 se lit là-dessus).
 *
 * On ne compte ni les résidents des Repaires ni les hordes ni les gardes de convoi : le
 * plafond borne la CONTAGION, et ces populations-là sont déjà bornées par leurs propres
 * systèmes (`cap` du POI, `HORDE_SIZE`, dissipation à l'aube). Les compter aussi revenait à
 * fermer la levée avec des morts qu'elle n'avait pas faits — MESURÉ : 24 vivants (le plafond
 * pile) dès le jour 21, rien qu'avec les Repaires et les convois.
 */
export function risenAlive(state: SimState): number {
  let n = 0
  for (const m of state.monsters) {
    if (m.type !== 'cendreux' || m.risen !== true) continue
    const e = state.entities.find((en) => en.id === m.entityId)
    if (e && e.hp > 0) n += 1
  }
  return n
}


/**
 * Vrai si cette mort donnera un Cendreux : sous le plafond, SEUL, et LOIN D'UN FEU.
 *
 * La cause ne compte plus (spec R6, décision 2026-07-31). Elle a longtemps été `cold` seul,
 * et c'était un goulot, pas une règle : mesuré sur une saison Veillée entière, le froid n'a
 * tué qu'UNE fois (il ne mord la plaine qu'en acte III) — la levée ne se déclenchait donc
 * jamais. Toute mort compte désormais, y compris celle qu'un Cendreux inflige : c'est la
 * CONTAGION (R7), le lore pris au mot.
 */
export function willRiseAsCendreux(state: SimState, entity: Entity): boolean {
  // BORNÉE (R8) : au-delà du plafond, la vallée ne relève plus personne. Sans lui, la
  // contagion n'aurait aucun point fixe — une nuit qui tourne mal fermerait la porte au lieu
  // de faire une histoire (T15 de `tension.md`). Abattre un Cendreux rouvre une place.
  if (risenAlive(state) >= CENDREUX.MAX_ALIVE) return false
  // …ET LE PLAFOND GLOBAL PAR-DESSUS (2026-08-21) : la réserve commune de toutes les sources
  // de pression. R8 borne la contagion entre elle ; le global borne la SOMME que le joueur subit.
  if (!placeSousPlafondGlobal(state)) return false
  // Loin d'un feu : aucune structure feu dans HEARTH_WARD_RADIUS.
  const hearthWardR = CENDREUX.HEARTH_WARD_RADIUS
  const nearFire = state.structures.some(
    (s) => s.type === 'fire' && fireActive(state, s) && distSq(s.tx + 0.5, s.ty + 0.5, entity.x, entity.y) <= hearthWardR * hearthWardR,
  )
  if (nearFire) return false
  // Seul : aucun allié vivant (même village) dans WITNESS_RADIUS.
  const witnessR = CENDREUX.WITNESS_RADIUS
  const village = state.villages.find((v) => v.memberIds.includes(entity.id))
  if (village) {
    const hasAlly = state.entities.some(
      (e) => e.id !== entity.id && e.hp > 0 && village.memberIds.includes(e.id) &&
        distSq(e.x, e.y, entity.x, entity.y) <= witnessR * witnessR,
    )
    if (hasAlly) return false
  }
  return true
}

/** Réveil : les cadavres marqués se lèvent en Cendreux (ou sont annulés par un feu). */
export function advanceCendreux(state: SimState): void {
  const ward = CENDREUX.HEARTH_WARD_RADIUS
  for (const corpse of [...state.corpses]) {
    if (corpse.risesAt === undefined || state.tick < corpse.risesAt) continue
    // Veillé par un feu à portée → annulation.
    const warded = state.structures.some(
      (s) => s.type === 'fire' && fireActive(state, s) && distSq(s.tx + 0.5, s.ty + 0.5, corpse.x, corpse.y) <= ward * ward,
    )
    if (warded) {
      delete corpse.risesAt
      corpse.decayAt = state.tick + COMBAT.CORPSE_TICKS
      continue
    }
    // ═══ LE PLAFOND SE LIT AUSSI ICI, ET C'EST TOUT LE POINT (R8) ═══
    //
    // Il n'était consulté qu'à la MORT (`willRiseAsCendreux`), or un cadavre ne se lève
    // que `RISE_DELAY` plus tard : entre les deux, une nuit qui tourne mal marque des
    // CENTAINES de cadavres alors que pas un seul ne marche encore. Le plafond ne bornait
    // donc rien du tout — MESURÉ le 2026-08-02 : **460 Cendreux vivants pour un
    // MAX_ALIVE de 24**, dans un banc où un joueur sans village remeurt sur place.
    //
    // Ça ne se voyait pas, et voici pourquoi : le nouveau-né naît EXACTEMENT sur le
    // cadavre, donc sous ce qui vient d'y tuer — un loup, le meurtrier — et se faisait
    // abattre dans le tick de sa levée. C'était un ACCIDENT qui tenait lieu de règle
    // (`docs/mesure-contagion.md` avait déjà attrapé sa version cendreux-contre-cendreux).
    // Le recul du 2026-08-02 écarte les corps d'un quart de tuile : l'exécution à la
    // naissance a cessé, et la contagion est partie à 460. Le recul n'a rien cassé — il a
    // retiré la béquille qui masquait un plafond mort.
    //
    // Plein, la vallée « ne relève plus personne » (le mot de R8) : le cadavre redevient
    // un cadavre et se décompose. Il ne fait pas la queue — une file de quatre cents morts
    // qui se videraient à mesure qu'on abat rendrait le plafond à son inutilité.
    if (risenAlive(state) >= CENDREUX.MAX_ALIVE || !placeSousPlafondGlobal(state)) {
      delete corpse.risesAt
      corpse.decayAt = state.tick + COMBAT.CORPSE_TICKS
      continue
    }
    // Levée : le cadavre devient le Cendreux, portant son loot.
    // LES 40 CASES SE DEMANDENT ICI, et nulle part ailleurs. C'est le seul Cendreux qui
    // hérite d'un cadavre entier ; ceux des hordes et des convois naissent les mains vides
    // (sac d'espèce à 0) et n'ont pas à traîner un inventaire vide dans chaque snapshot.
    const id = spawnMonster(state, 'cendreux', corpse.x, corpse.y, SLOTS.NPC)
    const ent = state.entities.find((e) => e.id === id)!
    state.monsters.find((m) => m.entityId === id)!.risen = true // il compte dans le plafond (R8)
    // Les CASES passent au Cendreux (spec inventaire R6) : la levée n'est pas un
    // atelier de réparation — une hache usée se relève usée. `pourInto` conserve
    // l'usure (il ne reconstruit pas de case neuve), sinon mourir de froid
    // réparerait tout l'outillage porté et le Cendreux serait une lessiveuse.
    // Ce qui NE TIENT PAS dans les 40 cases du Cendreux (un cadavre gavé au-delà
    // pendant la fenêtre de levée) ne s'évapore pas : il tombe au sol (A21).
    pourInto(corpse.inventory, ent.inventory)
    state.corpses = state.corpses.filter((c) => c.id !== corpse.id)
    if (!isEmpty(corpse.inventory)) spillOnGround(state, corpse.x, corpse.y, {}, corpse.inventory)
    emitEvent(state, { type: 'cendreux_risen', tick: state.tick, entityId: id, x: corpse.x, y: corpse.y })
  }
}

/** La BÊTE de gibier vivante la plus proche dans `range` (décision ⑩ — la chair est chaude). */
function nearestGibier(state: SimState, entity: Entity, range: number): Entity | undefined {
  let best: Entity | undefined
  let bestD = range * range
  for (const m of state.monsters) {
    if (!isPrey(m.type)) continue
    const e = state.entities.find((en) => en.id === m.entityId)
    if (!e || e.hp <= 0) continue
    const d = distSq(entity.x, entity.y, e.x, e.y)
    if (d < bestD || (d === bestD && best && e.id < best.id)) {
      best = e
      bestD = d
    }
  }
  return best
}

/** La source de chaleur la plus proche dans `range` : un feu OU un vivant. */
export function nearestWarmth(
  state: SimState,
  entity: Entity,
  range: number,
): { x: number; y: number; prey?: Entity } | undefined {
  const r2 = range * range
  let best: { x: number; y: number; prey?: Entity } | undefined
  let bestD = r2
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    if (fireState(state, s) !== 'lit') continue // seul un feu ALLUMÉ est un phare (spec feu-station S5)
    const d = distSq(s.tx + 0.5, s.ty + 0.5, entity.x, entity.y)
    if (d < bestD) {
      bestD = d
      best = { x: s.tx + 0.5, y: s.ty + 0.5 }
    }
  }
  const prey = nearestPrey(state, entity, range)
  if (prey) {
    const d = distSq(prey.x, prey.y, entity.x, entity.y)
    if (d < bestD) {
      bestD = d
      best = { x: prey.x, y: prey.y, prey }
    }
  }
  return best
}

/**
 * IA du Cendreux : amorphe quand il fait chaud (le cadran de température), rampe vers une
 * proie en vue, cherche la chaleur quand le froid mord, coule vers le Feu ciblé quand il
 * marche en horde — et frappe ce qui lui barre la route.
 */
/** `byId` est l'INDEX DU TICK, construit une fois par `advanceMonsters` : l'écart de la horde
 *  y lit ses voisines en O(1) au lieu de balayer `state.entities` pour chacune. */
export function cendreuxStep(state: SimState, monster: Monster, entity: Entity, flux: CacheFlux | null = null, byId: Map<number, Entity> = new Map()): void {
  const def = MONSTER_DEFS.cendreux
  if (entity.windup) return

  // LA CHALEUR BUE REFROIDIT (décision ⑰) : la satiété fond en continu — ~5 minutes réelles
  // pour redevenir affamé. Le champ disparaît à zéro : un monstre qui n'a jamais bu ne porte
  // pas un octet de ce chantier dans le snapshot.
  if (monster.satiete !== undefined) {
    monster.satiete -= CENDREUX.BOIRE.SATIETE_DECAY
    if (monster.satiete <= 0) delete monster.satiete
  }

  // ═══ LE CADRAN UNIQUE : LA TEMPÉRATURE LOCALE (décisions d'Alexis 2026-08-21) ═══
  //
  // UN SEUL relevé du froid par tick, et tout en découle : l'éveil (pente continue, voir
  // `eveilPourTemperature`) module la VUE, l'ALLURE et la cadence de décision par le même
  // nombre ; le gate de convergence (`CONVERGE_SOUS`) lit la même température. Il fait chaud
  // → presque amorphe (mais il mord toujours ce qui marche sur lui : la vue garde son
  // plancher, le nettoyage de jour reste un geste risqué). Le froid mord → la vallée
  // s'anime. La saison refroidissant la vallée, la pression MONTE sans qu'une table la
  // décrète. La SATIÉTÉ (chaleur bue, décision ⑰) se déduit comme des degrés portés.
  //
  // Le froid ne le rend JAMAIS plus rapide que ses 1,3 tuile/s nominaux : on le distance
  // toujours (R10) — l'éveil plafonne à 1, il n'est pas un multiplicateur de fureur.
  const T = baselineTemperature(state, entity.x, entity.y)
  const eveil = Math.max(0, eveilPourTemperature(T) - (monster.satiete ?? 0) / CENDREUX.BOIRE.SATIETE_MAX)
  // L'allure d'un cendreux QUI A UN BUT : jamais sous GAIT_MIN — « presque amorphe » n'est
  // pas « statue » (l'acte I garde ses marcheurs lents, décision ① : statu quo à 20 tuiles).
  const gait = Math.max(eveil, CENDREUX.TORPEUR.GAIT_MIN)
  // LE RAMPANT (spec R26) : sorti du sol sans ses jambes, à vie. Il PENSE au rythme de son
  // éveil (`gait`, comme les autres) mais AVANCE à `RAMPANT.ALLURE` de l'allure — et voit à ras
  // du sol (`RAMPANT.VUE` sur la vue, jamais sur le plancher de contact : il mord ce qui lui
  // marche dessus). Même morsure qu'un marcheur : « rien de spécial », sa lenteur est sa nature.
  const rampant = monster.rampant === true
  const allure = rampant ? gait * CENDREUX.RAMPANT.ALLURE : gait
  const vue = def.aggroRange * Math.max(eveil, CENDREUX.TORPEUR.VUE_PLANCHER) * (rampant ? CENDREUX.RAMPANT.VUE : 1)
  // Attiré par la chaleur quand le froid de BASE mord (`CONVERGE_SOUS` : toute nuit de
  // plaine, les biomes froids de jour, la plaine d'acte III à midi) — hors feu, sinon
  // oscillation à la lisière de la bulle (spec feu-station S5).
  const cold = T < CENDREUX.TORPEUR.CONVERGE_SOUS
  const inHorde = state.hordes.length > 0 && state.hordes.some((h) => h.memberEntityIds.includes(monster.entityId))

  // Cible du tick de décision.
  if (state.tick >= (monster.thinkAt ?? 0)) {
    // Un cendreux engourdi pense moins souvent — même pente que l'allure, et le CPU suit.
    monster.thinkAt = state.tick + Math.round(def.thinkEveryTicks / gait)
    let goal: { x: number; y: number; prey?: Entity } | undefined
    // UN VIVANT EN VUE PRIME SUR LE FOYER — dans les deux régimes. Le Cendreux cherche la
    // chaleur ; entre celle qui brûle et celle qui SAIGNE, il prend la seconde.
    //
    // Sans cette priorité, le feu était le meilleur bouclier du joueur. MESURÉ : un Cendreux
    // venu de l'ouest chemine vers le feu (S5), s'arrête à 1,4 tuile de son centre — et à
    // cette distance AUCUN humain ne peut plus le battre dans `nearestWarmth`. L'homme assis
    // de l'autre côté du feu, à 3,4 tuiles, n'était donc plus jamais ciblé : 0 coup, 0 dégât
    // en 4 000 ticks, quand le MÊME montage sans feu lui coûtait 2 652 PV. Le « phare qui
    // appelle les morts » (S5) livrait un monstre qui campe, là où S6 acte le Foyer ASSIÉGÉ.
    //
    // La portée du basculement est `aggroRange` — sa VUE, la même qui le réveille le jour :
    // on ne lui apprend pas une deuxième règle. Le feu reste ce qui l'amène de loin ; les
    // yeux font le reste. Aucun tirage RNG ajouté (le flux seedé est inchangé).
    //
    // UN MEMBRE DE HORDE NE CHERCHE PAS LA CHALEUR : il a déjà un Feu, celui qu'on lui a
    // donné pour cible. Sans cette exclusion, `nearestWarmth` lui trouvait un VIVANT jusqu'à
    // `WARMTH_SEEK_RANGE` (20) — or une horde marche justement sur un village, donc sur des
    // PNJ : chacun de ses 12 à 16 membres posait alors son propre A* (4 096 tuiles explorées,
    // deux fois par seconde) au lieu de couler dans le champ de flux PARTAGÉ. C'est
    // exactement le coût que R5 existe pour éviter. Ses YEUX marchent toujours : ce qui passe
    // à `aggroRange` se fait mordre, horde ou pas.
    //
    // SA VUE SUIT L'ÉVEIL — et elle est HONNÊTE (spec R24, 2026-08-21) : la portée se
    // multiplie par le STIMULUS que la proie offre (allure × couvert, vibration du pas —
    // `stimulusPourLesMorts`, le vocabulaire de la chasse entré UNE fois). L'accroupi longe
    // un champ de dormeurs, le sprinteur porte au-delà de la vue nominale (5 × 1,6 = 8). Le
    // plancher de CONTACT reste ABSOLU (R24bis) : marcher SUR une carcasse la réveille
    // toujours — désormais même sous la pluie, que le facteur météo laissait trouer.
    const seen = nearestPrey(state, entity, vue, {
      stimulusOf: (e, meteo) => stimulusPourLesMorts(state, e, meteo),
      plancher: CENDREUX.SENS.CONTACT,
    })
    if (seen) {
      goal = { x: seen.x, y: seen.y, prey: seen }
      // LE DERNIER LIEU, PAS LA PERSONNE (décision ⑨) : il retient OÙ il vous a vu. Rompre
      // le contact ne suffit plus — il viendra vérifier, puis reprendra sa marche.
      //
      // …ET LA DIRECTION (spec R28, 2026-08-21) : d'une pensée à la suivante, il retient aussi
      // votre DÉPLACEMENT (tuiles/tick). Ce n'est pas une traque : c'est ce qu'un regard
      // retient d'un corps qui passe, et il se trompe dès que vous tournez.
      // …de LA MÊME proie : `targetId` porte encore la cible de la pensée précédente — un
      // humain A puis un humain B ne font pas un déplacement, ils font deux corps.
      if (monster.lastSeenAt !== undefined && monster.lastSeenX !== undefined && monster.lastSeenY !== undefined && monster.targetId === seen.id) {
        const dt = state.tick - monster.lastSeenAt
        if (dt > 0) {
          monster.lastSeenVx = (seen.x - monster.lastSeenX) / dt
          monster.lastSeenVy = (seen.y - monster.lastSeenY) / dt
        }
      }
      monster.lastSeenX = seen.x
      monster.lastSeenY = seen.y
      monster.lastSeenAt = state.tick
    } else if (monster.lastSeenX !== undefined && monster.lastSeenY !== undefined) {
      // L'EXTRAPOLATION (R28) — à la PREMIÈRE pensée sans la proie, et une seule fois : le
      // lieu à vérifier devient « là où elle allait », dernier lieu + déplacement × quelques
      // secondes, borné (`MEMOIRE.EXTRAPOLATION_MAX`) et retenu dans la carte. Filer droit
      // derrière un bosquet ne suffit plus — il en ressort sur votre trajectoire ; tourner,
      // si. Zéro tirage, zéro A* de plus : c'est le même `pathToward`, sur un autre point.
      if (monster.lastSeenVx !== undefined && monster.lastSeenVy !== undefined) {
        let ex = monster.lastSeenVx * CENDREUX.MEMOIRE.EXTRAPOLATION_TICKS
        let ey = monster.lastSeenVy * CENDREUX.MEMOIRE.EXTRAPOLATION_TICKS
        const d = Math.sqrt(ex * ex + ey * ey)
        if (d > CENDREUX.MEMOIRE.EXTRAPOLATION_MAX) {
          ex *= CENDREUX.MEMOIRE.EXTRAPOLATION_MAX / d
          ey *= CENDREUX.MEMOIRE.EXTRAPOLATION_MAX / d
        }
        monster.lastSeenX = Math.min(state.map.width - 0.5, Math.max(0.5, monster.lastSeenX + ex))
        monster.lastSeenY = Math.min(state.map.height - 0.5, Math.max(0.5, monster.lastSeenY + ey))
      }
      delete monster.lastSeenVx
      delete monster.lastSeenVy
      delete monster.lastSeenAt
      if (distSq(entity.x, entity.y, monster.lastSeenX, monster.lastSeenY) <= 1) {
        // Arrivé sur le lieu : personne. Il oublie — aucune traque surnaturelle.
        delete monster.lastSeenX
        delete monster.lastSeenY
      } else {
        goal = { x: monster.lastSeenX, y: monster.lastSeenY }
      }
    }
    // ILS DÉVORENT LE GIBIER (décision ⑩) : sans humain en vue ni lieu à vérifier, la chair
    // chaude la plus proche fait l'affaire — la vallée se vide pour de bon. La bête tuée ne
    // se relève pas (le critère de levée exclut les monstres), et la chasse rassasie (⑰).
    if (!goal) {
      const gibier = nearestGibier(state, entity, vue)
      if (gibier) goal = { x: gibier.x, y: gibier.y, prey: gibier }
    }
    if (!goal && cold && !inHorde) goal = nearestWarmth(state, entity, CENDREUX.WARMTH_SEEK_RANGE)
    monster.targetId = goal?.prey?.id ?? null

    // ═══ LE CRI DE FUREUR (décisions d'Alexis ④⑤⑥, 2026-08-21) ═══
    //
    // Sous le froid EXTRÊME (`TORPEUR.FUREUR` — la plaine de nuit d'acte III, le Glacier, le
    // cœur du vieux brûlé), un cendreux qui VOIT une proie s'appelle — et l'appel réveille LE
    // SOL, pas les voisins : la salve plante des réveils VRAIS (tertres, préavis, feu qui
    // repousse) autour du lieu où il l'a vue. Le froid effectif déduit la satiété : un
    // buveur repu ne crie pas (la chaleur bue le tiédit sous le seuil de fureur).
    //
    // BORNÉ DEUX FOIS : le plafond du cri MONTE EN CONTINU avec le jour (décision ⑥ — round
    // (FIN × jour/60), zéro en tout début de saison), et chaque plantation comme chaque
    // émergence repasse sous le plafond GLOBAL. AUCUN pas de PRNG : les sites s'élisent sur
    // `hash2` du cri lui-même — crier ne déplace pas le flux seedé du monde (le patron A28).
    // Le cooldown expiré libère la proie : le crieur cesse de la TENIR (voir la garde ci-dessous).
    if (monster.criPreyId !== undefined && monster.criRestants === undefined && state.tick >= (monster.criAt ?? 0)) {
      delete monster.criPreyId
    }
    if (seen) {
      const froidEffectif = T + ((monster.satiete ?? 0) / CENDREUX.BOIRE.SATIETE_MAX) * (CENDREUX.TORPEUR.CHAUD - CENDREUX.TORPEUR.FROID)
      if (froidEffectif <= CENDREUX.TORPEUR.FUREUR && state.tick >= (monster.criAt ?? 0)) {
        const k = Math.round(seasonRamp(0, CENDREUX.CRI.PLAFOND_FIN, jourDeSaison(state)))
        // UN CRIEUR PAR PROIE À LA FOIS (décision d'Alexis sur mesure, 2026-08-21) : tant qu'un
        // autre cendreux TIENT cette proie (son cooldown de cri court encore, `criPreyId` porté
        // jusque-là), celui-ci ne crie pas — « celui qui m'a vu appelle, les autres viennent ».
        // Mesuré avant : des crieurs qui se superposaient par moments (46 cris en 18 min pour
        // un cooldown de 30 s). Aucun cooldown consommé par le silence : il criera s'il la
        // voit encore quand l'autre aura fini.
        const tenue = state.monsters.some(
          (o) => o !== monster && o.type === 'cendreux' && o.criPreyId === seen.id && state.tick < (o.criAt ?? 0),
        )
        if (k > 0 && !tenue && placeSousPlafondGlobal(state)) {
          monster.criAt = state.tick + CENDREUX.CRI.COOLDOWN
          monster.criRestants = k
          monster.criX = seen.x
          monster.criY = seen.y
          monster.criPreyId = seen.id
          emitEvent(state, { type: 'cendreux_cri', tick: state.tick, entityId: entity.id, x: seen.x, y: seen.y, count: k })
        }
      }
    }
    // LA SALVE : UN site par tick de décision, jamais K d'un coup — le pire cas mesuré d'un
    // site coûte 33 ms (proie murée, A22ter), on l'étale au fil des pensées du crieur.
    if ((monster.criRestants ?? 0) > 0 && monster.criX !== undefined && monster.criY !== undefined && monster.criPreyId !== undefined) {
      monster.criRestants = monster.criRestants! - 1
      if (placeSousPlafondGlobal(state)) {
        const site = siteDansLaCouronne(
          state, monster.criX, monster.criY,
          hash2(Math.floor(monster.criX) + monster.criRestants, Math.floor(monster.criY), entity.id),
          (tx, ty) => densiteDesMorts(state, tx, ty),
          { dist: NIGHT_HUNT.SPAWN_DIST_UNDEAD, ring: NIGHT_HUNT.SPAWN_RING_UNDEAD },
        )
        if (site) state.reveils.push({ x: site.x, y: site.y, at: state.tick + MORTS.REVEIL_TICKS, preyId: monster.criPreyId })
      }
      if (monster.criRestants === 0) {
        delete monster.criRestants
        delete monster.criX
        delete monster.criY
        // `criPreyId` reste porté jusqu'à la fin du cooldown : c'est la garde « un crieur par
        // proie » qui le lit. Il tombe au premier think après `criAt` (plus haut).
      }
    }
    if (goal) {
      const world = { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null, etat: state }
      // Le Feu bloque désormais sa tuile (hitbox) : viser À CÔTÉ, pas dessus —
      // sinon la dérive nocturne vers la chaleur ne trouve jamais de chemin.
      // LE CHEMIN EST LISSÉ AVANT D'ÊTRE SUIVI (Alexis, 2026-08-25 : « ils se déplacent quasi
      // exclusivement en X et Y toujours »). L'A* est 4-connexe et rend des **L** — dix tuiles
      // plein est, puis dix plein sud — et aucun réglage du PAS ne peut faire une diagonale d'un
      // chemin qui n'en contient pas. `lisserLeChemin` ne retire que les jalons joignables en
      // ligne droite : même corridor, mêmes tuiles (un sous-ensemble), mais le cap devient
      // oblique là où la grille l'interdisait. MESURÉ, branche `chemin` : 9,9 % de pas obliques
      // avant, `tools/diag-cendreux-cap.mts` le relève après.
      const brut = pathToward(world, entity.x, entity.y, Math.floor(goal.x), Math.floor(goal.y))
      monster.path = brut ? lisserLeChemin(world, entity.x, entity.y, brut) : []
    } else {
      monster.path = []
    }
  }

  // Attaque si une proie ciblée est au contact.
  const target = monster.targetId !== null ? state.entities.find((e) => e.id === monster.targetId) : undefined
  if (target && distSq(entity.x, entity.y, target.x, target.y) <= COMBAT.MELEE_ENGAGE_RANGE * COMBAT.MELEE_ENGAGE_RANGE) {
    if (
      state.tick >= entity.cooldownUntil &&
      startAttack(state, entity, target.x - entity.x, target.y - entity.y, {
        windupTicks: def.windupTicks,
        damage: def.damage,
      })
    ) {
      entity.cooldownUntil = state.tick + def.attackCooldownTicks
    }
    return
  }

  // LA HORDE COULE VERS LE FEU (spec R2/R5). Sans proie en vue, un membre de horde suit la
  // descente de gradient du champ de flux — partagé entre toutes les bêtes qui visent le même
  // Foyer — et frappe le franchissement qui le barre. C'est là que vit le SIÈGE de masse ;
  // élargir l'A* à la place coûterait un BFS par bête et par demi-seconde.
  if (!target && hordeStep(state, monster, entity, flux, byId, allure)) return

  // Un pas vers le prochain nœud du chemin (A*) — ou, faute de chemin, DROIT sur la cible.
  // Les deux cas convergent exprès : ce qui décide du siège n'est pas « ai-je un chemin ? »
  // mais « ai-je AVANCÉ ? ».
  const wp = monster.path?.[0]
  let goX: number
  let goY: number
  if (wp) {
    const dx = wp.tx + 0.5 - entity.x
    const dy = wp.ty + 0.5 - entity.y
    if (dx * dx + dy * dy < BALANCE.WAYPOINT_RADIUS * BALANCE.WAYPOINT_RADIUS) {
      monster.path!.shift()
      return
    }
    goX = wp.tx + 0.5
    goY = wp.ty + 0.5
  } else if (target) {
    goX = target.x
    goY = target.y
  } else {
    // ═══ LA LONGUE MARCHE (décision ① — « il marche, et de plus en plus loin ») ═══
    //
    // Ni proie, ni chemin, ni horde : si le froid mord, il rejoint le feu allumé le plus
    // proche PAR LE CHAMP DES FEUX (un BFS multi-sources partagé par toute l'espèce, borné
    // par la portée de l'acte — voir `champDesFeux`). Les 24 statues de la contagion se
    // mettent en marche : « les morts reviennent au feu » cesse d'être une ligne de lore.
    // À moins de `WARMTH_SEEK_RANGE`, l'A* précis de `nearestWarmth` a déjà pris la main
    // au think — le champ ne guide que le lointain.
    if (cold && !inHorde && eveil > 0) {
      const champ = champDesFeux(state)
      if (champ) {
        const d = champ[Math.floor(entity.y) * state.map.width + Math.floor(entity.x)]
        if (d !== undefined && d !== -1) descendreLeChamp(state, monster, entity, champ, byId, allure, null)
      }
    }
    return
  }
  moveToward(state, monster, entity, goX, goY, false, allure)

  // LE SIÈGE, SEUL (spec R3 ; S6 de `feu-station.md`, acté le 2026-07-25 et jamais livré).
  // Il a poussé et n'a pas bougé d'un pouce : quelque chose le barre. Il le frappe — porte,
  // mur plein, ou mur d'ARÊTE, que `crossingBlocker` sait lire des deux côtés (R23).
  //
  // Le test se fait sur `entity.moved` et NON sur « l'A* n'a rendu aucun chemin » : mesuré, le
  // cas courant est un chemin de longueur 1 vers un voisin muré — la bête pousse contre la
  // paroi sans jamais l'attaquer. Avant ce repli : cible tenue 4 000 ticks sur 4 000,
  // **0 mur touché, 0 tuile parcourue**. N'importe quelle enceinte rendait le joueur
  // intouchable, et le Cendreux ne venait même pas frapper à la porte.
  //
  // UN RAMPANT N'ASSIÈGE PAS (R26bis) : sans jambes, il ne frappe ni porte ni mur — il les
  // contourne, ou il attend. R3 lui échappe, et c'est la spec.
  if (!rampant && !entity.moved && !entity.windup && state.tick >= entity.cooldownUntil) {
    attackBlockingStructure(state, monster, entity, goX, goY)
  }
}
