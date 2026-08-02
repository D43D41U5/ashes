/**
 * L'EMPREINTE DE LA SIM — le filet sous le refactor.
 *
 * Il joue le VRAI monde (worldgen zonal, faune, villages PNJ, événements) puis écrit une
 * empreinte : l'état ET le flux d'événements, condensés. **Un changement qui ne change pas
 * le JEU rend une empreinte identique au caractère près.** C'est la question qu'on se pose
 * avant de toucher `/sim` — et la seule réponse qui vaille est une comparaison AVANT/APRÈS.
 *
 *   node --import tsx tools/empreinte-sim.mts /tmp/avant.json
 *   … le refactor …
 *   node --import tsx tools/empreinte-sim.mts /tmp/apres.json
 *   diff /tmp/avant.json /tmp/apres.json   # vide = le jeu n'a pas bougé
 *
 * ═══ POURQUOI `pnpm test` NE SUFFIT PAS ═══
 * `sim.test.ts`/`replay.test.ts` vérifient le déterminisme À L'INTÉRIEUR d'un run (même
 * graine deux fois → même état). Ils ne comparent RIEN à un avant. Or le risque propre au
 * refactor de `/sim`, c'est de décaler le FLUX du PRNG seedé : le jeu reste déterministe,
 * mais ce n'est plus le même jeu — et les tests qui cassent alors sont des tests sans
 * rapport, ce qui envoie chercher le défaut au mauvais endroit.
 *
 * ═══ POURQUOI DES SCÉNARIOS, ET NON UN LONG RUN ═══
 * Un cycle complet fait 57 600 ticks (48 min @ 20 Hz), le jour 36 000. Un run de 3 000 ticks
 * depuis l'aube ne voit JAMAIS la nuit — MESURÉ : il ne couvrait aucun événement de combat,
 * ni la chasse nocturne, ni les prédateurs. On attaque donc chaque RÉGIME par sa phase (via
 * `cycleOffset`) en runs courts, et l'avatar frappe sans répit dans les scénarios `combat` :
 * c'est le seul moyen de traverser `resolveStrike`/`applyDamage`/`die`, qu'aucune promenade
 * n'atteint. Le rapport porte sa COUVERTURE (événements par type) — un chemin jamais emprunté
 * passerait sinon pour « inchangé » alors qu'il n'a simplement jamais été joué.
 *
 * ═══ VÉRIFIER QUE LE FILET MORD ═══
 * Un filet qu'on n'a pas vu mordre ne vaut rien. Éprouvé le 2026-08-02 : `applyDamage` passé à
 * `damage * 1.02` → 5 scénarios sur 12 divergent. (Et une première tentative sur `weaponDamage`
 * n'a RIEN donné : cette fonction est morte côté sim, exportée pour le seul client. Choisir un
 * point de perturbation VIVANT, sinon on conclut « ça mord » sur un test qui ne teste rien.)
 *
 * ═══ COMPARER DEUX COMMITS : LE MÊME INSTRUMENT DES DEUX CÔTÉS ═══
 * Pour juger un refactor déjà commité, deux `git worktree` détachés (l'avant et l'après) — jamais
 * l'arbre de travail, qui peut porter le chantier non commité d'une autre session : mesuré, il
 * faisait diverger 3 scénarios sur 12 pour rien. Et COPIER le même fichier d'instrument dans les
 * deux worktrees : un worktree créé sur un commit ancien y ramène la version d'ALORS, et on
 * compare alors deux instruments au lieu de deux codes (12/12 divergents, tous faux).
 *
 * ═══ ⚠ CE FICHIER N'EST PAS TYPECHECKÉ PAR `pnpm check` ═══
 * `pnpm check` est `pnpm -r run check` : il ne visite que les PAQUETS du workspace, et `tools/`
 * n'en est pas un. `tsx` exécute sans typechecker. Écrit ainsi, ce fichier est né FAUX —
 * `addItems(inv, 'spear', 1)` (la fonction prend un SAC) ne posait rien, et l'avatar frappait au
 * poing dans les scénarios de combat ; `recipeId: 'plank'` ne nommait aucune recette. Le filet
 * mordait quand même, mais couvrait moins que son en-tête ne le prétendait.
 *
 * Après TOUTE modification de ce fichier — ou du jour où une API de `/sim` bouge — le passer à
 * `tsc` à la main, sinon il pourrit en silence :
 *
 *   npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
 *     --exactOptionalPropertyTypes --noUncheckedIndexedAccess --skipLibCheck \
 *     --lib ES2022,DOM tools/empreinte-sim.mts
 */
import {
  MONDE, createSim, step, snapshot, drainEvents, placeZoneNodes, placeHuntingGrounds,
  spawnPoiMonsters, spawnEntity, emplacementsDeVillage, pointsDeSpawn, generateZonedTerrain,
  foundNpcVillage, FAUNA, SLOTS, DAY_TICKS_PER_CYCLE, addItems,
  type SimState, type MoveInput,
} from '../packages/sim/src/index'
import { writeFileSync } from 'fs'

/** Condensé stable d'une chaîne (FNV-1a 32 bits) — on compare des empreintes, pas des Mo. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}
function mix(n: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < 4; i++) { h ^= (n >>> (i * 8)) & 0xff; h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

/** Un monde JOUÉ : la recette de `tools/profil-tick.mts` (le monde réel, pas un banc nu). */
function mondeJoue(seed: number, cycleOffset: number): { sim: SimState; avatar: number } {
  const carte = generateZonedTerrain(seed, 8)
  const nodes = placeZoneNodes(carte)
  const emplacements = emplacementsDeVillage(carte, nodes)
  const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
  const premier = spawns[0] ?? emplacements[0]
  if (!premier) throw new Error(`carte dégénérée (seed ${seed})`)
  const sim = createSim(seed, {
    map: carte.map,
    nodes,
    faunaCap: FAUNA.CAP,
    grounds: placeHuntingGrounds(carte.map, seed),
    home: { x: premier.tx + 0.5, y: premier.ty + 0.5 },
    cycleOffset,
    debug: true, // arme les DebugAction : l'empreinte couvre CE chemin de routage aussi
  })
  spawnPoiMonsters(sim, seed)
  const d2 = (e: { tx: number; ty: number }) => (e.tx - premier.tx) * (e.tx - premier.tx) + (e.ty - premier.ty) * (e.ty - premier.ty)
  const voisins = emplacements.filter((e) => e.tx !== premier.tx || e.ty !== premier.ty).sort((a, b) => d2(b) - d2(a))
  if (voisins[0]) foundNpcVillage(sim, voisins[0].tx, voisins[0].ty, 4, 'foyer')
  if (voisins[1]) foundNpcVillage(sim, voisins[1].tx, voisins[1].ty, 3, 'meute')
  // UN AVATAR JOUEUR : le banc n'en a pas (mémoire « le banc n'a pas de joueur »), or c'est
  // lui qui emprunte le routage d'actions — le chemin qu'on s'apprête à refactorer.
  const avatar = spawnEntity(sim, premier.tx + 0.5, premier.ty + 0.5, SLOTS.PLAYER)
  const e = sim.entities.find((x) => x.id === avatar)!
  // De quoi EXERCER les chemins : une arme (combat), un marteau (bâti), de quoi manger.
  // `addItems` prend un SAC (`ItemBag`), pas (item, count) — écrit faux d'abord, et `tsx` ne
  // typecheckait pas : l'avatar partait les mains nues et frappait au poing. Voir l'en-tête.
  addItems(e.inventory, { spear: 1, hammer: 1, wood: 40, stone: 20, berries: 10 })
  return { sim, avatar }
}

/** Les inputs du joueur — déterministes (PRNG local, jamais celui de la sim). */
function inputsAuTick(tick: number, avatar: number, agressif: boolean): MoveInput[] {
  let h = mix(tick * 2654435761)
  const next = () => { h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0; return h / 4294967296 }
  const dirs: (-1 | 0 | 1)[] = [-1, 0, 1]
  const input: MoveInput = { entityId: avatar, dx: dirs[Math.floor(next() * 3)]!, dy: dirs[Math.floor(next() * 3)]! }
  if (next() < 0.15) input.sprint = true
  if (next() < 0.10) input.sneak = true
  if (next() < 0.05) input.block = true
  // EN MODE AGRESSIF on frappe SOUVENT et tout autour : c'est le seul moyen de traverser
  // `resolveStrike`/`applyDamage`/`die` — les chemins qu'aucune promenade n'atteint.
  if (agressif && tick % 3 === 0) {
    const a = next()
    const dx = a < 0.5 ? 1 : -1
    input.action = next() < 0.5 ? { type: 'attack', dx, dy: 0 } : { type: 'attack', dx: 0, dy: dx }
  } else if (tick % 12 === 0) {
    const r = next()
    if (r < 0.20) input.action = { type: 'attack', dx: 1, dy: 0 }
    else if (r < 0.30) input.action = { type: 'attack_charge', dx: 1, dy: 0 }
    else if (r < 0.38) input.action = { type: 'attack_release', dx: 1, dy: 0 }
    else if (r < 0.55) input.action = { type: 'harvest', nodeId: Math.floor(next() * 4000) }
    else if (r < 0.63) input.action = { type: 'harvest_charge_start', nodeId: Math.floor(next() * 4000) }
    else if (r < 0.67) input.action = { type: 'harvest_release' }
    else if (r < 0.72) input.action = { type: 'craft', recipeId: 'rope' }
    else if (r < 0.78) input.action = { type: 'set_active_slot', slot: Math.floor(next() * 6) }
    else if (r < 0.82) input.action = { type: 'drop_held' }
    else if (r < 0.86) input.action = { type: 'eat', item: 'berries' }
    else if (r < 0.90) input.action = { type: 'light_fire' }
    else if (r < 0.94) input.action = { type: 'build', structure: 'wall', tx: 0, ty: 0 }
    else if (r < 0.97) input.action = { type: 'move_slot', from: 0, to: 1 }
    else input.action = { type: 'debug_teleport', x: 100 + next() * 50, y: 100 + next() * 50 }
  }
  return [input]
}

/**
 * LES RÉGIMES. Chacun vise une part du jeu qu'une simple promenade diurne n'atteint pas.
 * `offset` place le départ dans le cycle ; `agressif` fait frapper l'avatar sans répit.
 */
const REGIMES = [
  { nom: 'jour', offset: 0, ticks: 4000, agressif: false },
  // 300 ticks avant le crépuscule : le run FRANCHIT la nuit (night_started, chasse nocturne,
  // prédateurs, hordes) au lieu de mourir avant de l'atteindre.
  { nom: 'nuit', offset: DAY_TICKS_PER_CYCLE - 300, ticks: 4000, agressif: false },
  { nom: 'combat', offset: 0, ticks: 4000, agressif: true },
  { nom: 'combat-nuit', offset: DAY_TICKS_PER_CYCLE - 300, ticks: 4000, agressif: true },
]
const SEEDS = [2026, 7, 11]
const JALONS = [500, 1500, 2500, 4000]

const sortie = process.argv[2]
if (!sortie) throw new Error('usage: node --import tsx tools/empreinte-sim.mts <sortie.json>')

const rapport: Record<string, unknown> = {}
const couvertureGlobale: Record<string, number> = {}
for (const seed of SEEDS) {
  for (const reg of REGIMES) {
    const { sim, avatar } = mondeJoue(seed, reg.offset)
    const evenements: string[] = []
    const jalons: Record<number, { etat: string; evts: string; n: number }> = {}
    const parType: Record<string, number> = {}
    let n = 0
    for (let t = 1; t <= reg.ticks; t++) {
      step(sim, inputsAuTick(t, avatar, reg.agressif))
      for (const e of drainEvents(sim)) {
        evenements.push(JSON.stringify(e)); n++
        parType[e.type] = (parType[e.type] ?? 0) + 1
        couvertureGlobale[e.type] = (couvertureGlobale[e.type] ?? 0) + 1
      }
      if (JALONS.includes(t)) jalons[t] = { etat: fnv1a(snapshot(sim)), evts: fnv1a(evenements.join('\n')), n }
    }
    rapport[`${seed}/${reg.nom}`] = {
      jalons,
      final: {
        tick: sim.tick, rngState: sim.rngState,
        entites: sim.entities.length, monstres: sim.monsters.length, npcs: sim.npcs.length,
        structures: sim.structures.length, villages: sim.villages.length, corpses: sim.corpses.length,
        nodes: sim.nodes.length, hordes: sim.hordes.length, groundItems: sim.groundItems.length,
        blood: sim.blood.length, reveils: sim.reveils.length, evenements: n,
      },
      couverture: parType,
    }
    console.log(`  ${seed}/${reg.nom}: ${String(n).padStart(4)} évts — ${jalons[reg.ticks]!.etat}`)
  }
}
rapport['_couverture'] = couvertureGlobale
writeFileSync(sortie, JSON.stringify(rapport, null, 2))
console.log(`\nTypes d'événements couverts : ${Object.keys(couvertureGlobale).length}`)
console.log(Object.entries(couvertureGlobale).sort((a, b) => b[1] - a[1]).map(([t, c]) => `  ${String(c).padStart(5)} ${t}`).join('\n'))
console.log(`\n→ ${sortie}`)
