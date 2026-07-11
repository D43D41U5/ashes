/**
 * La chronique — la Mémoire v1 (GDD §2, spec saison R6).
 *
 * Fonction PURE : le flux d'événements de domaine (posé en V0 précisément
 * pour cela) devient un récit daté. L'hôte accumule les événements drainés
 * et appelle ce formateur — la sim ne raconte pas, elle témoigne.
 */
import type { SimEvent } from './events'
import { POI_CHARGES } from './poi-discovery'
import { TICKS_PER_SEASON_DAY } from './time'

const ACT_NAMES = ['l’Éclosion', 'le Grand Froid', 'la Cendre'] as const

export function chronicleFromEvents(
  events: SimEvent[],
  calendarScale: number,
  villageNames: Record<number, string>,
): string[] {
  const day = (tick: number): number => Math.floor((tick * calendarScale) / TICKS_PER_SEASON_DAY) + 1
  const name = (villageId: number): string => villageNames[villageId] ?? `le village ${villageId}`
  const lines: string[] = []
  const giftPairs = new Set<string>()

  for (const e of events) {
    const d = `Jour ${day(e.tick)}`
    switch (e.type) {
      case 'village_founded':
        lines.push(`${d} — Un Feu s'est allumé : ${name(e.villageId)}.`)
        break
      case 'act_started':
        if (e.act > 1) lines.push(`${d} — ${ACT_NAMES[e.act - 1]} a commencé.`)
        break
      case 'village_archetype_changed':
        if (e.archetype === 'foyer') lines.push(`${d} — ${name(e.villageId)} a viré au bleu : un Foyer.`)
        else if (e.archetype === 'meute') lines.push(`${d} — ${name(e.villageId)} a viré au rouge : une Meute.`)
        else lines.push(`${d} — Le Feu de « ${name(e.villageId)} » est redevenu neutre.`)
        break
      case 'horde_spawned':
        if (e.size >= 12) lines.push(`${d} — La méga-horde a déferlé sur ${name(e.targetVillageId)} (${e.size} goules).`)
        else if (e.size >= 8) lines.push(`${d} — Une grande horde a marché sur ${name(e.targetVillageId)}.`)
        break
      case 'convoy_spawned':
        lines.push(`${d} — Une carcasse de convoi a été signalée sur la route.`)
        break
      case 'gift_given': {
        const key = `${e.byEntityId}:${e.toVillageId}`
        if (!giftPairs.has(key) && e.toVillageId !== 0) {
          giftPairs.add(key)
          lines.push(`${d} — Des vivres ont été offerts à ${name(e.toVillageId)}.`)
        }
        break
      }
      case 'entity_died':
        if (!e.wasMonster) lines.push(`${d} — Quelqu'un est tombé.`)
        break
      case 'evacuation_opened':
        lines.push(`${d} — Un point d'évacuation s'est ouvert sur la route. La fin approche.`)
        break
      case 'poi_first_visit':
        // Seuls les quatre lieux de devise `recit` entrent dans la chronique.
        // Le bus, lui, porte toutes les premières visites : c'est le FORMATEUR
        // qui choisit, jamais la logique qui filtre.
        if (POI_CHARGES[e.kind]?.devise === 'recit') {
          lines.push(`${d} — ${e.name} a été atteint pour la première fois.`)
        }
        break
      case 'season_ended':
        lines.push(`${d} — Le monde s'est éteint. Ce qu'on retiendra :`)
        for (const v of e.verdicts) {
          lines.push(`   ${v.name} ${v.outcome}.`)
        }
        break
    }
  }
  return lines
}
