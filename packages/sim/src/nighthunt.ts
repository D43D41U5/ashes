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
import { BALANCE, NIGHT_HUNT } from './balance'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { spawnMonster } from './monsters'
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

    // BORNÉ : on compte les rôdeurs déjà lancés sur CETTE proie. On peut perdre ;
    // on ne doit pas être submergé — une meute infinie n'est pas de la tension,
    // c'est une porte fermée.
    const rodeurs = state.monsters.filter(
      (m) => m.type === 'wolf' && m.ambient === true && m.targetId === prey.id,
    ).length
    if (rodeurs >= NIGHT_HUNT.MAX_ALIVE) continue

    if (roll(state) >= chance) continue

    // Ils naissent HORS DE VUE, autour de la proie — le tirage donne le quadrant.
    // On doit pouvoir les voir VENIR : jamais collés dans le dos.
    const ox = (roll(state) < 0.5 ? -1 : 1) * NIGHT_HUNT.SPAWN_DIST
    const oy = (roll(state) < 0.5 ? -1 : 1) * NIGHT_HUNT.SPAWN_DIST
    const x = Math.max(1, Math.min(state.map.width - 2, prey.x + ox))
    const y = Math.max(1, Math.min(state.map.height - 2, prey.y + oy))

    const id = spawnMonster(state, 'wolf', x, y)
    const monster = state.monsters.find((m) => m.entityId === id)
    if (monster) {
      monster.ambient = true // il se dissipera comme la faune : pas d'accumulation
      monster.targetId = prey.id
    }

    // ÇA S'ANNONCE. Le hurlement est le seul avertissement, et il suffit : le
    // joueur sait ce qu'il doit faire — un feu, ou courir (GDD §9bis).
    emitEvent(state, {
      type: 'wolf_howl',
      tick: state.tick,
      targetEntityId: prey.id,
      packSize: rodeurs + 1,
      x,
      y,
    })
  }
}

/** La distance à laquelle un rôdeur est « sur nous » — pour l'UI, pas pour la sim. */
export function prowlerNear(state: SimState, x: number, y: number, radius: number): boolean {
  for (const m of state.monsters) {
    if (m.type !== 'wolf') continue
    const e = state.entities.find((en) => en.id === m.entityId)
    if (e && distSq(e.x, e.y, x, y) <= radius * radius) return true
  }
  return false
}
