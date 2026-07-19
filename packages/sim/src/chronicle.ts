/**
 * La chronique — la Mémoire v1 (GDD §2, spec saison R6).
 *
 * Fonction PURE : le flux d'événements de domaine (posé en V0 précisément
 * pour cela) devient un récit daté. L'hôte accumule les événements drainés
 * et appelle ce formateur — la sim ne raconte pas, elle témoigne.
 *
 * La sortie porte TROIS POIDS (décision d'Alexis, 2026-07-19) : le *battement*
 * du monde frappe fort (le Grand Froid, les hordes, la fin), le *récit* est le
 * corps courant (fondations, dons, virages d'alignement), l'*intime* chuchote
 * (« Quelqu'un est tombé. » — sa sobriété EST son poids). Le poids est du SENS,
 * pas de la déco : le rendu (maquette Turn 6A) s'appuie dessus. On expose donc
 * une entrée structurée `{ jour, texte, poids }` — le jour est SÉPARÉ du texte
 * (gouttière de dates de la maquette), et le mapping type→poids vit ici, pur.
 */
import type { SimEvent } from './events'
import { POI_CHARGES } from './poi-discovery'
import { TICKS_PER_SEASON_DAY } from './time'

const ACT_NAMES = ['l’Éclosion', 'le Grand Froid', 'la Cendre'] as const

/** Les trois registres de la chronique (voir en-tête). */
export type ChronicleWeight = 'battement' | 'recit' | 'intime'

/** Une ligne de chronique : le jour (1-based) à part, le texte sans préfixe, le poids. */
export interface ChronicleEntry {
  day: number
  text: string
  weight: ChronicleWeight
}

/** Rendu plat « Jour N — texte » (journal simple, en attendant le rendu à 3 poids). */
export function formatChronicleLine(e: ChronicleEntry): string {
  return `Jour ${e.day} — ${e.text}`
}

export function chronicleFromEvents(
  events: SimEvent[],
  calendarScale: number,
  villageNames: Record<number, string>,
): ChronicleEntry[] {
  const day = (tick: number): number => Math.floor((tick * calendarScale) / TICKS_PER_SEASON_DAY) + 1
  const name = (villageId: number): string => villageNames[villageId] ?? `le village ${villageId}`
  const entries: ChronicleEntry[] = []
  const giftPairs = new Set<string>()

  for (const e of events) {
    const d = day(e.tick)
    const push = (text: string, weight: ChronicleWeight): void => {
      entries.push({ day: d, text, weight })
    }
    switch (e.type) {
      case 'village_founded':
        push(`Un Feu s'est allumé : ${name(e.villageId)}.`, 'recit')
        break
      case 'act_started':
        if (e.act > 1) push(`${ACT_NAMES[e.act - 1]} a commencé.`, 'battement')
        break
      case 'village_archetype_changed':
        if (e.archetype === 'foyer') push(`${name(e.villageId)} a viré au bleu : un Foyer.`, 'recit')
        else if (e.archetype === 'meute') push(`${name(e.villageId)} a viré au rouge : une Meute.`, 'recit')
        else push(`Le Feu de « ${name(e.villageId)} » est redevenu neutre.`, 'recit')
        break
      case 'horde_spawned':
        if (e.size >= 12) push(`La méga-horde a déferlé sur ${name(e.targetVillageId)} (${e.size} goules).`, 'battement')
        else if (e.size >= 8) push(`Une grande horde a marché sur ${name(e.targetVillageId)}.`, 'battement')
        break
      case 'convoy_spawned':
        push(`Une carcasse de convoi a été signalée sur la route.`, 'recit')
        break
      case 'gift_given': {
        const key = `${e.byEntityId}:${e.toVillageId}`
        if (!giftPairs.has(key) && e.toVillageId !== 0) {
          giftPairs.add(key)
          push(`Des vivres ont été offerts à ${name(e.toVillageId)}.`, 'recit')
        }
        break
      }
      case 'entity_died':
        // L'intime : discret et grave. Sa sobriété est son poids.
        if (!e.wasMonster) push(`Quelqu'un est tombé.`, 'intime')
        break
      case 'evacuation_opened':
        push(`Un point d'évacuation s'est ouvert sur la route. La fin approche.`, 'battement')
        break
      case 'poi_first_visit':
        // Seuls les quatre lieux de devise `recit` entrent dans la chronique.
        // Le bus, lui, porte toutes les premières visites : c'est le FORMATEUR
        // qui choisit, jamais la logique qui filtre.
        if (POI_CHARGES[e.kind]?.devise === 'recit') {
          push(`${e.name} a été atteint pour la première fois.`, 'recit')
        }
        break
      case 'season_ended':
        // La finale : un battement, suivi des verdicts (le corps de la stèle).
        push(`Le monde s'est éteint. Ce qu'on retiendra :`, 'battement')
        for (const v of e.verdicts) push(`${v.name} ${v.outcome}.`, 'recit')
        break
    }
  }
  return entries
}
