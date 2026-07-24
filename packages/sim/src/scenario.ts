/**
 * Le banc de test permanent (GDD §10, roadmap V10) : joue des saisons entières headless et
 * produit un rapport — l'outil de calibrage de `balance.ts`, pour les humains comme pour les
 * agents.
 *
 * ═══ IL MESURE LE MONDE QU'ON JOUE ═══
 *
 * Il ne l'a pas toujours fait, et c'était grave. Jusqu'au 2026-07-24 il bâtissait son monde avec
 * `generateValley` + `generateNodes` + trois sites de village écrits en dur : une géométrie que
 * plus personne ne jouait depuis le pivot en graphe de zones. **Trois divergences, dont la
 * troisième décidait de tout** : le terrain n'était pas celui du jeu ; les nœuds venaient d'un
 * semis circulaire au lieu d'une distribution PAR ZONE ; et surtout **aucun coin de chasse
 * n'était posé**, donc le banc mesurait la FAIM dans un monde où l'on ne pouvait pas chasser —
 * alors que la chasse est une source majeure de nourriture. Tous les seuils de famine du jeu ont
 * été calibrés contre ça.
 *
 * La recette est désormais celle de la production, à l'appel près — le même enchaînement que
 * `worker/veillee.ts` (Veillée solo) et `server/scenario.ts` (zone LAN) :
 *
 *     generateZonedTerrain → placeZoneNodes → emplacementsDeVillage
 *                          → placeHuntingGrounds → spawnPoiMonsters
 *
 * ═══ LA TAILLE EST UN BOUTON, PAS UNE AUTRE CARTE ═══
 *
 * Une saison de production (50 joueurs, 3,75 M de tuiles) ne tient pas dans une CI. On réduit
 * donc `joueurs` — et c'est légitime **parce que le générateur est le même** : mesuré, la vallée
 * porte ses **13 zones à toutes les échelles**, avec le même graphe, les mêmes falaises entre
 * zones et la même distribution de nœuds par zone. On mesure un monde plus PETIT, pas un monde
 * DIFFÉRENT. C'est exactement ce que l'ancien banc ne pouvait pas dire.
 *
 * Le rapport porte la taille et le nombre de coins de chasse : un rapport qui ne dit pas quel
 * monde il a mesuré est ce qui a permis à la dérive de durer.
 */
import { BALANCE } from './balance'
import { chronicleFromEvents, formatChronicleLine } from './chronicle'
import { drainEvents, type SimEvent } from './events'
import { placeHuntingGrounds } from './faune'
import { countOf } from './items'
import { spawnPoiMonsters } from './poi'
import { createSim, step, type SimState } from './sim'
import { TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { FAUNA } from './balance'
import { foundNpcVillage } from './worldgen'
import { emplacementsDeVillage, placeZoneNodes, pointsDeSpawn, type Emplacement } from './zone-content'
import { MONDE } from './zonegraph'
import { generateZonedTerrain } from './zonegen'

/**
 * Joueurs cibles du banc — le SEUL bouton de taille, et il ne change rien d'autre que la taille.
 *
 * **6 → 548×822, ~450 k tuiles. CHOISI PAR LE BALAYAGE, pas par confort** (`tools/profil-banc.mts`,
 * mesuré le 2026-07-24) :
 *
 * | joueurs | tuiles | nœuds  | coins de chasse | marge de ciblage | ms/tick | 6 jours |
 * |---------|--------|--------|-----------------|------------------|---------|---------|
 * |       4 | 0,30 M |  7 949 |               1 |          **4,4 %** ✗ |    1,10 |   380 s |
 * |   **6** | 0,45 M | 12 106 |           **3** |       **68,1 %** |    1,56 | **539 s** |
 * |       8 | 0,60 M | 16 137 |               3 |           62,3 % |    1,80 | 622 s ✗ |
 * |      12 | 0,90 M | 24 568 |               1 |           38,5 % |    1,88 | 650 s ✗ |
 *
 * Six gagne sur les trois critères à la fois : il porte TROIS coins de chasse (à quatre il n'y en
 * a qu'un — le banc retomberait dans un monde où l'on ne chasse presque pas), il offre la
 * MEILLEURE marge de ciblage du balayage, et il est le seul, avec quatre, à tenir sous le plafond.
 *
 * Deux surprises que ce tableau garde en mémoire : le nombre de coins de chasse n'est PAS
 * monotone en taille (1 à douze joueurs contre 3 à six — la faune veut de l'eau, pas de la
 * surface), et le coût par tick sature vite (+50 % de tuiles entre 8 et 12 ne coûte que +4 %).
 * Le baisser encore rendrait la nourriture plus facile qu'en jeu ; le monter n'achète rien.
 */
export const BANC_JOUEURS = 6

export interface ScenarioReport {
  days: number
  ticks: number
  /** Le monde MESURÉ, inscrit dans le rapport — pour qu'aucune dérive ne puisse plus être muette. */
  monde: {
    joueurs: number
    width: number
    height: number
    nodes: number
    /** Coins de chasse posés. À zéro, le rapport parle de la faim dans un monde sans gibier. */
    huntingGrounds: number
    /** Écart minimal entre deux villages, en tuiles. Informatif. */
    ecartMinVillages: number
    /**
     * De combien, en %, la cible la plus proche de la Meute bat l'autre. C'EST LE NOMBRE QUI
     * COMPTE : l'IA de raid vise le village le plus proche à vol d'oiseau, donc à quasi-égalité
     * elle raide le même chaque nuit jusqu'à destruction mutuelle — et le banc mesure une guerre
     * au lieu d'une économie. Sur l'ancienne carte, la marge était de **0,4 %** et il avait fallu
     * déplacer un site À LA MAIN.
     */
    margeDeCible: number
  }
  villages: {
    name: string
    archetype: string
    membersAlive: number
    granaryFood: number
    granaryWood: number
  }[]
  starvationSamples: number
  deaths: number
  hordesSpawned: number
  chronicle: string[]
}

/** Distance au carré entre deux emplacements. */
function d2(a: { tx: number; ty: number }, b: { tx: number; ty: number }): number {
  return (a.tx - b.tx) * (a.tx - b.tx) + (a.ty - b.ty) * (a.ty - b.ty)
}

/**
 * Trois emplacements MUTUELLEMENT les plus écartés (échantillonnage au point le plus lointain).
 *
 * Ce n'est pas de l'esthétique, c'est une leçon payée : sur la vallée, l'IA de raid de la Meute
 * cible le village le plus proche **à vol d'oiseau** (`nearestOtherVillage`, distance euclidienne
 * pure). Quand deux villages sont à quasi-égalité, la Meute raide le même chaque nuit jusqu'à
 * destruction mutuelle — et le banc mesure alors une guerre, pas une économie. L'ancien banc s'en
 * tirait en déplaçant un site À LA MAIN ; ici on ne touche à aucune coordonnée, on maximise
 * l'écart — et surtout **on MESURE la marge obtenue** (`margeDeCible`), que le banc assied par une
 * assertion. Maximiser ne suffit pas : sur une vallée à quatre joueurs, la marge tombe à 4,4 % et
 * le cas dégénéré revient. C'est ce garde-fou, et non l'intuition, qui a écarté cette taille.
 */
function troisVillages(emplacements: Emplacement[], premier: Emplacement | undefined): Emplacement[] {
  if (!premier) return []
  const choisis = [premier]
  while (choisis.length < 3) {
    let meilleur: Emplacement | undefined
    let meilleureDist = -1
    for (const e of emplacements) {
      if (choisis.some((c) => c.tx === e.tx && c.ty === e.ty)) continue
      // Distance au plus proche des DÉJÀ choisis : on maximise le minimum.
      const proche = Math.min(...choisis.map((c) => d2(c, e)))
      if (proche > meilleureDist) {
        meilleureDist = proche
        meilleur = e
      }
    }
    if (!meilleur) break
    choisis.push(meilleur)
  }
  return choisis
}

/** Le monde du banc, et de quoi le décrire — voir `construireMondeDuBanc`. */
export interface MondeDuBanc {
  sim: SimState
  monde: ScenarioReport['monde']
}

/**
 * LA RECETTE, en un seul endroit — pour que le banc et son PROFILEUR mesurent le même monde.
 *
 * Elle est exportée exprès : `tools/profil-banc.mts` l'appelle telle quelle. Deux recettes
 * jumelles auraient divergé, et c'est très exactement le genre de divergence silencieuse qui a
 * laissé ce banc calibrer la faim sur une carte sans gibier.
 */
export function construireMondeDuBanc(seed: number, joueurs: number = BANC_JOUEURS): MondeDuBanc {
  const carte = generateZonedTerrain(seed, joueurs)
  const map = carte.map
  const nodes = placeZoneNodes(carte)
  const emplacements = emplacementsDeVillage(carte, nodes)
  // LE PREMIER SITE VIENT DE `pointsDeSpawn`, comme en production — pas du premier emplacement
  // venu. C'est LUI qui vise les Prés Bas, la zone nourricière où le jeu fait naître les joueurs
  // (spec R18) ; les deux autres s'en éloignent, exactement comme `worker/veillee.ts` pose ses
  // voisins PNJ. Prendre trois extrêmes de carte, comme on le faisait, plantait les trois villages
  // dans des zones qui peuvent n'avoir aucun buisson — et un village PNJ n'a QU'UNE source de
  // nourriture (les baies : il ne chasse pas). On mesurait alors une famine de placement.
  const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
  const sites = troisVillages(emplacements, spawns[0] ?? emplacements[0])
  const base = sites[0]
  if (!base) throw new Error('scenario: la vallée ne porte aucun emplacement viable — carte dégénérée')

  const grounds = placeHuntingGrounds(map, seed)
  const sim = createSim(seed, {
    map,
    nodes,
    calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE,
    faunaCap: FAUNA.CAP,
    grounds,
    home: { x: base.tx + 0.5, y: base.ty + 0.5 },
  })
  spawnPoiMonsters(sim, seed)

  // Trois villages, comme avant — mais posés sur les emplacements que le générateur PROPOSE,
  // jamais sur des coordonnées écrites à la main.
  const archetypes = ['foyer', 'meute', 'neutre'] as const
  const effectifs = [4, 3, 3]
  sites.forEach((s, i) => {
    const a = archetypes[i]
    if (a) foundNpcVillage(sim, s.tx, s.ty, effectifs[i] ?? 3, a)
  })
  let ecartMinVillages = Infinity
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      ecartMinVillages = Math.min(ecartMinVillages, Math.sqrt(d2(sites[i]!, sites[j]!)))
    }
  }
  // La marge de ciblage de la Meute (index 1) entre ses deux cibles possibles — le Foyer (0) et
  // le neutre (2). C'est la quantité qui décide si le banc mesure une économie ou une guerre.
  const [foyerSite, meuteSite, neutreSite] = sites
  let margeDeCible = 100
  if (foyerSite && meuteSite && neutreSite) {
    const dFoyer = Math.sqrt(d2(meuteSite, foyerSite))
    const dNeutre = Math.sqrt(d2(meuteSite, neutreSite))
    margeDeCible = (Math.abs(dFoyer - dNeutre) / Math.min(dFoyer, dNeutre)) * 100
  }

  return {
    sim,
    monde: {
      joueurs,
      width: map.width,
      height: map.height,
      nodes: nodes.length,
      huntingGrounds: grounds.length,
      ecartMinVillages: Math.round(ecartMinVillages),
      margeDeCible: Math.round(margeDeCible * 10) / 10,
    },
  }
}

/**
 * Joue `days` jours complets (1 cycle = 1 jour) sur le monde de production, réduit à `joueurs`.
 */
export function runScenario(seed: number, days: number, joueurs: number = BANC_JOUEURS): ScenarioReport {
  const { sim, monde } = construireMondeDuBanc(seed, joueurs)

  const events: SimEvent[] = [...drainEvents(sim)]
  let starvationSamples = 0
  let deaths = 0
  let hordesSpawned = 0
  const total = days * TICKS_PER_CYCLE
  // Cadence d'échantillonnage de la faim, en ticks — fixée en temps réel (pas
  // en nombre de ticks brut) pour rester comparable d'un TICK_RATE_HZ à l'autre.
  const sampleEveryTicks = Math.round(500 * (BALANCE.TICK_RATE_HZ / 12))
  for (let t = 0; t < total; t++) {
    step(sim, [])
    for (const e of drainEvents(sim)) {
      events.push(e)
      if (e.type === 'entity_died' && !e.wasMonster) deaths += 1
      if (e.type === 'horde_spawned') hordesSpawned += 1
    }
    if (t % sampleEveryTicks === 0) {
      for (const npc of sim.npcs) {
        const entity = sim.entities.find((en) => en.id === npc.entityId)
        if (entity && entity.hunger <= 0) starvationSamples += 1
      }
    }
  }

  const names = Object.fromEntries(sim.villages.map((v) => [v.id, v.name]))
  return {
    days,
    ticks: total,
    monde,
    villages: sim.villages.map((v) => {
      const granary = sim.structures.find(
        (s) => s.type === 'chest' && s.villageId === v.id && s.access === 'village',
      )
      return {
        name: v.name,
        archetype: v.archetype,
        membersAlive: sim.entities.filter((e) => v.memberIds.includes(e.id) && e.hp > 0).length,
        granaryFood:
          countOf(granary?.inventory ?? [], 'berries') + 3 * countOf(granary?.inventory ?? [], 'stew'),
        granaryWood: countOf(granary?.inventory ?? [], 'wood'),
      }
    }),
    starvationSamples,
    deaths,
    hordesSpawned,
    chronicle: chronicleFromEvents(events, sim.calendarScale, names).map(formatChronicleLine),
  }
}
