import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@braises/sim'
import { soundForEvent } from './sound'

/** Fabrique un événement synthétique (les champs superflus sont ignorés par le routage). */
const ev = (type: string, extra: Record<string, unknown> = {}): SimEvent =>
  ({ type, tick: 0, ...extra }) as unknown as SimEvent

/**
 * QUI A UNE VOIX, ET QUI N'EN A PAS — la table exhaustive, tenue par le compilateur.
 *
 * `Record<SimEvent['type'], …>` : ajouter une variante à `SimEvent` rend ce fichier ROUGE
 * tant que personne ne dit ce qu'elle fait entendre. C'est tout l'objet de cette table.
 *
 * Le monde émet **61 faits de domaine** ; **10 sonnent**. Les 51 autres étaient muets parce
 * que personne ne les avait regardés — pas parce qu'on avait décidé qu'ils se taisent. La
 * nuance compte : `sound.ts` dit lui-même en en-tête « ESTHÉTIQUE À VALIDER — je ne peux pas
 * ENTENDRE le résultat », et l'audit de GATE 1 classe le son « oreilles d'Alexis ». Un
 * silence choisi est un choix de design ; un silence par omission est un trou.
 *
 * Cette table ne tranche donc RIEN d'esthétique — elle rend l'inventaire exact et le rend
 * impossible à laisser dériver. La liste des `muet` est ce sur quoi Alexis a à se prononcer,
 * casque sur les oreilles, en une passe.
 */
const VOIX: Record<SimEvent['type'], 'voix' | 'muet'> = {
  // ── LES DIX QUI SONNENT (l'échafaudage actuel) ────────────────────────────────
  resource_harvested: 'voix',
  entity_damaged: 'voix',
  monster_slain: 'voix',
  wolf_howl: 'voix',
  night_started: 'voix',
  entity_died: 'voix',
  entity_bandaged: 'voix',
  refugees_arrived: 'voix',
  alarm_raised: 'voix',
  evacuation_opened: 'voix',

  // ── HAUTE FRÉQUENCE ou pure interface : le silence est ici un vrai choix ───────
  action_rejected: 'muet',
  entity_spawned: 'muet',
  entity_despawned: 'muet',
  entity_respawned: 'muet',
  node_depleted: 'muet',
  item_dropped: 'muet',
  corpse_looted: 'muet',
  wound_inflicted: 'muet',
  prey_escaped: 'muet',
  craft_queued: 'muet',
  craft_cancelled: 'muet',
  access_changed: 'muet',
  function_changed: 'muet',
  poi_discovered: 'muet',

  // ── LE FEU, LE BÂTI, L'ATELIER — des gestes qu'on FAIT, et qui ne s'entendent pas ─
  fire_fed: 'muet',
  fire_relit: 'muet',
  fire_starved: 'muet',
  fire_extinguished: 'muet',
  fire_upgraded: 'muet',
  structure_built: 'muet',
  structure_upgraded: 'muet',
  structure_repaired: 'muet',
  structure_removed: 'muet',
  structure_destroyed: 'muet',
  item_crafted: 'muet',
  meat_cooked: 'muet',
  meal_eaten: 'muet',
  crop_planted: 'muet',
  crop_harvested: 'muet',
  skill_level_up: 'muet',

  // ── LE SOCIAL ET LE VILLAGE — le cœur de l'alignement, entièrement silencieux ──
  gift_given: 'muet',
  village_founded: 'muet',
  village_fell: 'muet',
  village_archetype_changed: 'muet',
  member_joined: 'muet',
  member_banished: 'muet',
  refugees_fed: 'muet',
  refugees_recruited: 'muet',
  refugees_robbed: 'muet',
  refugees_left: 'muet',

  // ── LE TEMPS ET LA MENACE — les battements de la saison, sans un son ──────────
  day_started: 'muet',
  season_day_started: 'muet',
  act_started: 'muet',
  season_ended: 'muet',
  cendre_avance: 'muet',
  cendreux_risen: 'muet',
  horde_spawned: 'muet',
  horde_dispersed: 'muet',
  convoy_spawned: 'muet',
  ark_departed: 'muet',
  poi_first_visit: 'muet',
}

const SONORES = Object.entries(VOIX)
  .filter(([, v]) => v === 'voix')
  .map(([t]) => t)

describe('la table de routage audio (soundForEvent)', () => {
  it('sonne les faits qui comptent (récolte, coup, mort, hurlement, nuit)', () => {
    expect(soundForEvent(ev('resource_harvested', { entityId: 1 }), true)).not.toBeNull()
    expect(soundForEvent(ev('monster_slain'), false)).not.toBeNull()
    expect(soundForEvent(ev('wolf_howl', { targetEntityId: 1 }), true)).not.toBeNull()
    expect(soundForEvent(ev('night_started'), false)).not.toBeNull()
    expect(soundForEvent(ev('entity_died', { entityId: 1 }), true)).not.toBeNull()
  })

  it('reste MUET sur les faits non sonores (haute fréquence ou hors registre)', () => {
    expect(soundForEvent(ev('action_rejected', { entityId: 1 }), true)).toBeNull()
    expect(soundForEvent(ev('gift_given'), false)).toBeNull()
    expect(soundForEvent(ev('season_day_started', { day: 3 }), false)).toBeNull()
  })

  it('« sur moi » vs « sur un autre » : encaisser diffère de toucher', () => {
    const onMe = soundForEvent(ev('entity_damaged', { entityId: 1 }), true)!
    const onOther = soundForEvent(ev('entity_damaged', { entityId: 2 }), false)!
    expect(onMe.wave).not.toBe(onOther.wave) // choc mat (bruit filtré) ≠ « tac » clair
  })

  it('la récolte ne sonne QUE pour moi (pas les PNJ, sinon un vacarme de fond)', () => {
    expect(soundForEvent(ev('resource_harvested', { entityId: 1 }), false)).toBeNull()
  })

  it("CHAQUE fait de domaine a une voix ou un silence DÉCIDÉ — aucun par omission", () => {
    // La table est exhaustive par le compilateur ; ce test vérifie qu'elle dit la VÉRITÉ sur
    // le routage réel. Les deux moitiés comptent : un `voix` qui ne sonne pas est une promesse
    // non tenue, un `muet` qui sonne est un son que personne n'a voulu.
    const desaccords: string[] = []
    for (const [type, attendu] of Object.entries(VOIX)) {
      // On essaie les deux points de vue : plusieurs sons ne se déclenchent que « sur moi ».
      const sonne =
        soundForEvent(ev(type, { entityId: 1 }), true) !== null ||
        soundForEvent(ev(type, { entityId: 2 }), false) !== null
      const vu = sonne ? 'voix' : 'muet'
      if (vu !== attendu) desaccords.push(`${type} : table dit « ${attendu} », routage fait « ${vu} »`)
    }
    expect(desaccords).toEqual([])
  })

  it("l'inventaire est celui que GATE 1 doit trancher : 61 faits, 10 voix", () => {
    // Un compte, pas un jugement. S'il bouge, c'est qu'un fait de domaine est né ou qu'une
    // voix a changé — dans les deux cas, quelqu'un doit le savoir.
    const total = Object.keys(VOIX).length
    const voix = SONORES.length
    expect(total).toBe(61)
    expect(voix).toBe(10)
  })

  it('tous les gains restent BAS et les durées positives (décor sonore, pas arcade)', () => {
    for (const type of SONORES) {
      const s = soundForEvent(ev(type, { entityId: 1 }), true)
      expect(s).not.toBeNull()
      expect(s!.gain).toBeGreaterThan(0)
      expect(s!.gain).toBeLessThanOrEqual(0.15)
      expect(s!.dur).toBeGreaterThan(0)
    }
  })
})
