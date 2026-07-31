/**
 * LA NUIT QUI CHASSE (spec `tension.md`).
 *
 * La nuit n'était qu'une couleur : plus sombre, un peu plus froide, et c'est tout.
 * On pouvait dormir dehors sans y penser. Or dans TOUS les jeux de survie qui
 * tiennent debout, la nuit est le moment où le monde vient te chercher — Don't
 * Starve en a fait son titre : rentre, ou meurs.
 *
 * La règle est donc simple et se dit en une phrase au joueur :
 *
 *     LA NUIT, LOIN D'UN FEU, ON EST CHASSÉ.
 *
 * Ce qui la rend JOUABLE plutôt qu'injuste :
 *   - elle s'ANNONCE (un hurlement, avant que les loups ne se placent — GDD §9bis :
 *     « annoncés, pas surprises ») ;
 *   - elle a une PARADE que le joueur possède déjà dès la minute 0 : un Feu, ou
 *     rentrer. Une punition sans parade n'est pas une punition, c'est un impôt ;
 *   - elle est BORNÉE (jamais plus de `MAX_ALIVE` rôdeurs) : on peut perdre, pas
 *     être submergé ;
 *   - les rôdeurs sont `ambient` : ils se dissipent quand plus personne ne les
 *     regarde (faune.ts), donc ils ne s'accumulent pas dans le monde à chaque nuit.
 *
 * Déterministe : un seul tirage par minute réelle, sur le PRNG de l'état.
 */
import { BALANCE, MORTS, NIGHT_HUNT } from './balance'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { spawnMonster } from './monsters'
import { densiteDesMorts, rodeursPortes, siteDansLaCouronne } from './morts'
import { rngRoll } from './rng'
import type { Entity, SimState } from './sim'
import { fireBubble } from './temperature'
import { actForDay, getGameTime, seasonDayAtTick } from './time'

/** Un tirage par minute réelle : la peur monte, elle ne mitraille pas. */
const ROLL_EVERY = BALANCE.TICK_RATE_HZ * 60

/** Un tirage sur le PRNG de l'état (même convention que worldevents.ts). */
function roll(state: SimState): number {
  const { value, next } = rngRoll(state.rngState)
  state.rngState = next
  return value
}

/**
 * Qui peut être chassé : les AVATARS — ni les monstres, ni les PNJ (leur défense
 * est un autre chantier ; le GDD veut d'abord un solo qui tienne).
 */
function preys(state: SimState): Entity[] {
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  const npcIds = new Set(state.npcs.map((n) => n.entityId))
  return state.entities.filter((e) => e.hp > 0 && !monsterIds.has(e.id) && !npcIds.has(e.id))
}

export function advanceNightHunt(state: SimState): void {
  if (state.tick % ROLL_EVERY !== 0) return
  if (!getGameTime(state).isNight) return

  const act = actForDay(seasonDayAtTick(state.tick, state.calendarScale))
  const chance = NIGHT_HUNT.CHANCE_PER_MIN[act - 1]!

  for (const prey of preys(state)) {
    // AU FEU, ON EST TRANQUILLE. C'est la parade, et elle doit être limpide : la
    // bulle de chaleur d'un feu est déjà ce que le joueur regarde pour ne pas
    // geler — on ne lui apprend pas une deuxième règle, on en réutilise une.
    if (fireBubble(state, prey.x, prey.y) > 0) continue

    if (roll(state) >= chance) continue

    // QUI VIENT, CETTE NUIT-LÀ (spec `cendreux.md` R11). C'est ici que vit la tension
    // croissante : acte I, la vallée est encore vivante et ce sont des loups ; acte III,
    // elle ne l'est plus et ce sont les morts. Le monde animal cède au monde mort, et le
    // joueur le SENT chaque nuit — là où la horde, tirée une seule fois par nuit sur une
    // saison de six nuits, ne pouvait produire que trois événements en tout.
    const undead = roll(state) < NIGHT_HUNT.UNDEAD_SHARE[act - 1]!
    const type = undead ? 'cendreux' : 'wolf'

    // BORNÉ, ET PAR ESPÈCE : on compte les rôdeurs déjà lancés sur CETTE proie. On peut
    // perdre ; on ne doit pas être submergé — une meute infinie n'est pas de la tension,
    // c'est une porte fermée. Les deux plafonds diffèrent parce que les deux dangers ne se
    // jouent pas pareil (voir `UNDEAD_MAX_ALIVE`). Le recensement passe par `huntTargetId`
    // et non `targetId` : l'IA du Cendreux réécrit la sienne deux fois par seconde.
    //
    // ET LE SOL A SON MOT (spec `cendreux.md` R16) : le plafond de l'acte reste le TOIT, mais
    // le champ des morts dit quelle part on en atteint ici. Deux rôdeurs sur le pré de son
    // village, cinq aux marges sous la cendre — le joueur ne lit pas un nombre, il lit un
    // LIEU. Le loup, lui, ne sort pas du sol : son plafond ne dépend pas de la géographie.
    const plafond = undead
      ? rodeursPortes(state, Math.floor(prey.x), Math.floor(prey.y), NIGHT_HUNT.UNDEAD_MAX_ALIVE[act - 1]!)
      : NIGHT_HUNT.MAX_ALIVE
    const rodeurs = state.monsters.filter(
      (m) => m.type === type && m.ambient === true && m.huntTargetId === prey.id,
    ).length
    // UN SOL QUI TRAVAILLE COMPTE DÉJÀ. Le tirage est à la minute et le réveil dure quatre
    // secondes, donc aujourd'hui il a toujours abouti avant le tirage suivant — mais le
    // plafond ne doit pas dépendre de ce rapport-là. Le jour où le réveil s'allonge, ou où
    // le tirage se resserre, un plafond aveugle aux réveils en cours les laisserait tous
    // sortir ensemble : « on peut perdre, on ne doit pas être submergé » (T15) cesserait de
    // tenir précisément la nuit où il compte.
    const enCours = undead ? state.reveils.filter((r) => r.preyId === prey.id).length : 0
    if (rodeurs + enCours >= plafond) continue

    // OÙ LE SOL SE RÉVEILLE (spec `cendreux.md` R18-R19). Ils naissent hors de vue, autour de
    // la proie — on doit pouvoir les voir VENIR, jamais collés dans le dos.
    //
    // Ce n'était PAS une couronne : `ox` et `oy` valaient tous deux ±`SPAWN_DIST`, donc quatre
    // points en diagonale à 21,2 tuiles — jamais 15, jamais de côté. Et le point n'était que
    // clampé aux bords : MESURÉ sur 1 600 naissances, **14,0 % tombaient dans la roche ou un
    // mur** et 4,2 % sur un sol libre sans aucun chemin vers la proie. Près d'une nuit sur
    // cinq ne se jouait pas, en silence.
    //
    // Le mort est PONDÉRÉ par le champ (il sort du sol, et tous les sols n'en sont pas aussi
    // pleins) ; le loup vient du bois, donc uniformément. La couronne et l'exigence d'un sol
    // qui mène à la proie leur sont communes : le bug de placement n'avait pas d'espèce.
    const site = siteDansLaCouronne(
      state, prey.x, prey.y, roll(state),
      undead ? (tx, ty) => densiteDesMorts(state, tx, ty) : undefined,
      undead ? { dist: NIGHT_HUNT.SPAWN_DIST_UNDEAD, ring: NIGHT_HUNT.SPAWN_RING_UNDEAD } : undefined,
    )
    if (!site) continue // aucun sol praticable tout autour : la nuit passe son tour
    const { x, y } = site

    // LE MORT NE NAÎT PAS, LE SOL SE RÉVEILLE (spec R14, R21 — décision d'Alexis 2026-07-31).
    // On plante un réveil : il travaille `MORTS.REVEIL_TICKS`, ça s'annonce, et un feu à
    // portée l'ÉTOUFFE. C'est ce préavis qui achète le droit de naître à SEPT tuiles au lieu
    // de quinze — à 1,3 tuile/s contre 4, c'est la seule chose qui rende ce monstre capable
    // d'atteindre quoi que ce soit, et la seule qui rende l'encerclement de l'acte III
    // possible alors que R10 fonde tout son danger sur le NOMBRE.
    //
    // Le loup, lui, arrive : il court, il n'a rien à faire sortir de terre, et ses 15 tuiles
    // sont déjà couvertes en trois secondes.
    if (undead) {
      state.reveils.push({ x, y, at: state.tick + MORTS.REVEIL_TICKS, preyId: prey.id })
    } else {
      const id = spawnMonster(state, type, x, y)
      const monster = state.monsters.find((m) => m.entityId === id)
      if (monster) {
        monster.ambient = true // il se dissipera comme la faune : pas d'accumulation
        monster.nightHunter = true // il MORD : exempté d'un courage qu'il ne pourrait jamais satisfaire
        monster.huntTargetId = prey.id // pour QUI il est venu — stable, contrairement à `targetId`
        monster.targetId = prey.id
      }
    }

    // ÇA S'ANNONCE — et pas de la même voix. Le hurlement est l'avertissement du loup ; un
    // Cendreux ne hurle pas, il se traîne. Deux dangers, deux signes : le joueur doit savoir
    // laquelle des deux parades il prépare (GDD §9bis, T16 de `tension.md`).
    emitEvent(
      state,
      undead
        ? { type: 'cendreux_prowl', tick: state.tick, targetEntityId: prey.id, count: rodeurs + 1, x, y }
        : { type: 'wolf_howl', tick: state.tick, targetEntityId: prey.id, packSize: rodeurs + 1, x, y },
    )
  }
}

/** La distance à laquelle un rôdeur est « sur nous » — pour l'UI, pas pour la sim. */
export function prowlerNear(state: SimState, x: number, y: number, radius: number): boolean {
  for (const m of state.monsters) {
    // Depuis le basculement d'espèce (R11), un rôdeur de nuit peut être un mort : ne compter
    // que les loups aurait rendu l'acte III muet à l'UI, exactement quand elle sert le plus.
    if (m.type !== 'wolf' && !(m.type === 'cendreux' && m.nightHunter === true)) continue
    const e = state.entities.find((en) => en.id === m.entityId)
    if (e && distSq(e.x, e.y, x, y) <= radius * radius) return true
  }
  return false
}
