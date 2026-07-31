/**
 * DIAGNOSTIC DE LA CONTAGION — « qui meurt, qui se lève, et qui retire les levés ? »
 *
 * Il répond à l'anomalie du 2026-07-31 (`decisions.md`) : **273 levées en une nuit** contre un
 * `CENDREUX.MAX_ALIVE` de 24, `risenAlive` **à 0 en permanence**, et **662 morts** dans une
 * vallée qui compte quinze vivants à l'aube. La note s'arrête sur un raisonnement (« ce n'est
 * pas la dissipation d'ambiant… mais je ne l'ai pas observé ») — cet outil OBSERVE.
 *
 * ═══ CE QU'IL MESURE, ET POURQUOI CHAQUE COLONNE EXISTE ═══
 *
 *   morts         — par `entity_died`, classées par le champ `wasMonster` DE L'ÉVÉNEMENT.
 *                   L'instrument précédent classait sur un instantané des monstres pris AU
 *                   DÉBUT DU TICK : une bête née ET tuée dans le même tick lui était invisible,
 *                   et c'est probablement ce qui a produit les 662 « non classées ». `die()`
 *                   lit `state.monsters` à l'instant de la mort — on lui fait confiance à lui.
 *   levées        — `cendreux_risen`, et le SORT de chaque levé à la FIN du tick où il naît :
 *                   vivant / mort (encore dans `entities`, hp ≤ 0) / ABSENT (retiré). Les trois
 *                   cas ont trois coupables différents ; les confondre est ce qui bloque.
 *   tueur         — `byEntityId` de la mort d'un levé : la contagion se mord-elle la queue ?
 *   marqués       — cadavres portant `risesAt` : la levée PROMISE. 120 promesses simultanées
 *                   contre un plafond de 24 est l'arbitrage ouvert (compter la promesse ou la
 *                   consommation) ; on veut la courbe, pas un pic isolé.
 *
 * ═══ LE MONTAGE EST CELUI DE L'ANOMALIE, ET IL EST SUSPECT ═══
 *
 * L'avatar-témoin du recensement est IMMOBILE, LOIN DES FEUX et SEUL — c'est-à-dire qu'il coche
 * exactement les trois conditions de `willRiseAsCendreux`. Et le banc lui rend ses PV à chaque
 * tick sans lui rendre sa TEMPÉRATURE : il peut donc mourir de froid en boucle, et chaque mort
 * sème un cadavre qui se lèvera. `--témoin=` permet de retirer le témoin ou de le rendre
 * vraiment invulnérable (`debug_god`, qui rend AUSSI la température) : si l'anomalie s'éteint,
 * elle était dans l'instrument, pas dans le jeu.
 *
 * Il vit dans `tools/` et non dans `/sim` : le lint y interdit `performance`.
 *
 *   node --import tsx tools/diag-contagion.mts [joueurs] [seed] [--témoin=pv|dieu|aucun] [--jour=N] [--ticks=N]
 *
 *   joueurs   taille du monde (6 = celle du banc ; 50 = la carte solo de production)
 *   seed      défaut 2026 (celui de l'anomalie)
 *   --témoin  `pv` (défaut) reproduit le banc : hp=100 chaque tick, température non rendue.
 *             `dieu` = `debug_god` (hp ET température gelées) — le témoin ne meurt plus.
 *             `aucun` = pas d'avatar : la nuit ne chasse plus (`preys()`), mais les PNJ vivent.
 *             `mortel` = on ne le soigne PAS. Il meurt de froid, RESPAWNE chez lui, et
 *             recommence — et chaque mort SEULE ET LOIN D'UN FEU sème un cadavre marqué.
 *             C'est le seul montage qui puisse produire des centaines de levées en une nuit.
 *   --jour    jour de saison visé (défaut 45 : acte III installé)
 *   --lieu    `loin` (défaut, montage du recensement) ou `maison` (celui de la note : près du Feu)
 *   --ticks   plafond de ticks après la tombée de la nuit (défaut : une nuit entière)
 */
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { drainEvents } from '../packages/sim/src/events'
import { spawnEntity, step, type MoveInput } from '../packages/sim/src/sim'
import { calendarScaleForSeasonCycles, getGameTime, seasonDayAtTick, TICKS_PER_CYCLE } from '../packages/sim/src/time'
import { walkableSpawn } from '../packages/sim/src/connectivity'
import { risenAlive } from '../packages/sim/src/cendreux'
import { CENDREUX } from '../packages/sim/src/balance'

const joueurs = Number(process.argv[2] ?? 6)
const seed = Number(process.argv[3] ?? 2026)
const arg = (nom: string, defaut: string): string =>
  process.argv.find((a) => a.startsWith(`--${nom}=`))?.split('=')[1] ?? defaut
const temoin = arg('témoin', arg('temoin', 'pv')) as 'pv' | 'dieu' | 'aucun' | 'mortel'
const jourVise = Number(arg('jour', '45'))
const lieu = arg('lieu', 'loin') as 'loin' | 'maison'
/** Les six cycles de la Veillée : le calendrier RÉEL, celui du recensement. */
const ECHELLE = calendarScaleForSeasonCycles(6)
/** Une nuit entière, plus une marge : on s'arrête au retour du jour. */
const PLAFOND = Number(arg('ticks', String(TICKS_PER_CYCLE)))

console.log(
  `\n═══ Diagnostic de la contagion — ${joueurs} joueurs, seed ${seed}, jour ${jourVise},` +
    ` témoin « ${temoin} » ${lieu}, plafond ${PLAFOND} ticks ═══`,
)

const t0 = performance.now()
const { sim, monde } = construireMondeDuBanc(seed, joueurs)
sim.calendarScale = ECHELLE
sim.debug = true // les actions de debug (jour de saison, heure, invulnérabilité) passent par là

/** Le témoin : posé loin des Feux, comme dans le recensement (sinon la nuit ne chasse pas). */
let avatarId = -1
if (temoin !== 'aucun') {
  // DEUX LIEUX, DEUX JEUX DIFFÉRENTS. `loin` est le montage du recensement (le témoin est une
  // proie que rien ne protège) ; `maison` est celui de la note d'anomalie (« joueur immobile
  // chez lui ») — et près d'un Feu actif, `willRiseAsCendreux` refuse TOUTE levée dans le
  // rayon. Confondre les deux, c'est comparer deux mondes en croyant relire le même.
  const base = sim.villages[0]
  const spot = lieu === 'maison' && base ? { x: base.fireTx + 1.5, y: base.fireTy + 1.5 } : walkableSpawn(sim.map)
  avatarId = spawnEntity(sim, spot.x, spot.y)
  const ecart = Math.min(
    ...sim.villages.map((v) => Math.sqrt((v.fireTx - spot.x) ** 2 + (v.fireTy - spot.y) ** 2)),
  )
  console.log(`  témoin ${avatarId} posé en (${spot.x.toFixed(0)}, ${spot.y.toFixed(0)}), à ${ecart.toFixed(0)} tuiles du Feu le plus proche`)
}

/** Un tick « à vide » qui ne porte qu'une action de debug. */
const pousser = (action: MoveInput['action']): void => {
  if (avatarId < 0) return
  step(sim, [{ entityId: avatarId, dx: 0, dy: 0, action }])
}

// Acte III, puis la tombée de la nuit. `debug_set_season_day` se pose UN TICK AVANT le jour
// visé et laisse la sim franchir la bascule elle-même — on lui laisse donc quelques ticks.
pousser({ type: 'debug_set_season_day', day: jourVise })
for (let i = 0; i < 5; i++) step(sim, [])
pousser({ type: 'debug_set_hour', hour: 21.5 })
if (temoin === 'dieu') pousser({ type: 'debug_god', on: true })
drainEvents(sim) // on jette tout ce que le saut a produit : la nuit commence maintenant
console.log(
  `  départ : jour ${seasonDayAtTick(sim.tick, sim.calendarScale)}, ${getGameTime(sim).hourOfCycle.toFixed(1)} h,` +
    ` nuit ${getGameTime(sim).isNight}, ${sim.entities.length} entités dont ${sim.monsters.length} monstres`,
)

/* ── Les compteurs ────────────────────────────────────────────────────────── */
let ticks = 0
let mortsMonstres = 0
let mortsNonMonstres = 0
let mortsDuTemoin = 0
const mortsParCause = new Map<string, number>()
/** Qui meurt, quand ce n'est ni un monstre ni le témoin ? On garde les identités. */
const mortsNonMonstresIds = new Map<number, number>()
let levees = 0
let reveils = 0
const sortDesLeves = { vivant: 0, mort: 0, absent: 0, tueDansSonTick: 0 }
/** Le tueur d'un levé, par identité (0 = l'environnement : froid, saignement, faim). */
const tueursDeLeves = new Map<number, number>()
let picRisenAlive = 0
let picMarques = 0
let picCendreuxVivants = 0
/** Le levé meurt-il DANS son tick de naissance, ou plus tard ? */
const levesEncoreVivantsPlusTard = new Set<number>()
let levesMortsPlusTard = 0

const compter = (m: Map<number, number>, k: number): void => m.set(k, (m.get(k) ?? 0) + 1)
/** Qui EST le tueur — un id ne dit rien, son type dit tout. Relevé au moment du coup. */
const identiteDesTueurs = new Map<number, string>()
const identifier = (id: number): void => {
  if (identiteDesTueurs.has(id)) return
  if (id === 0) {
    identiteDesTueurs.set(id, "l'environnement")
    return
  }
  if (id === avatarId) {
    identiteDesTueurs.set(id, 'LE TÉMOIN')
    return
  }
  const m = sim.monsters.find((mo) => mo.entityId === id)
  if (m) {
    const marques = [
      m.risen === true ? 'risen' : '',
      m.ambient === true ? 'ambient' : '',
      m.homePoi !== undefined ? 'repaire' : '',
      m.expiresAt !== undefined ? 'convoi' : '',
      m.nightHunter === true ? 'nightHunter' : '',
    ]
      .filter(Boolean)
      .join('+')
    identiteDesTueurs.set(id, `monstre ${m.type}${marques ? ` (${marques})` : ''}`)
    return
  }
  if (sim.npcs.some((n) => n.entityId === id)) {
    identiteDesTueurs.set(id, 'PNJ')
    return
  }
  identiteDesTueurs.set(id, sim.entities.some((e) => e.id === id) ? 'entité sans rôle' : 'DÉJÀ RETIRÉ')
}
let nuitVue = false

while (ticks < PLAFOND) {
  // LES CADAVRES MARQUÉS D'AVANT LE TICK — c'est eux qui discriminent la levée du réveil.
  // On ne peut PAS discriminer sur la marque `risen` du monstre né : si quelque chose le
  // retire dans le tick (l'hypothèse même qu'on teste), il n'y a plus de monstre à interroger
  // et la levée se ferait passer pour un réveil. Le cadavre qui DISPARAÎT, lui, ne ment pas.
  const marquesAvant = new Map<string, number>()
  for (const c of sim.corpses) {
    if (c.risesAt !== undefined) marquesAvant.set(`${c.x},${c.y}`, c.id)
  }
  step(sim, [])
  ticks += 1

  // LE BANC REND LES PV SANS RENDRE LA TEMPÉRATURE — c'est le montage de l'anomalie, reproduit
  // tel quel pour le mode `pv`. En `dieu`, `refreshGodMode` a déjà tout rendu dans le tick.
  if (temoin === 'pv' && avatarId >= 0) {
    const a = sim.entities.find((e) => e.id === avatarId)
    if (a) a.hp = 100
  }

  const nesCeTick: { id: number; cle: string }[] = []
  /** Les identités mortes DANS ce tick : « absent » ne dit pas si on l'a tué ou retiré. */
  const mortsCeTick = new Map<number, number>()
  for (const e of drainEvents(sim)) {
    if (e.type === 'entity_died') {
      if (e.wasMonster) mortsMonstres += 1
      else {
        mortsNonMonstres += 1
        if (e.entityId === avatarId) mortsDuTemoin += 1
        else compter(mortsNonMonstresIds, e.entityId)
      }
      const cause = e.cause ?? 'coup'
      mortsParCause.set(cause, (mortsParCause.get(cause) ?? 0) + 1)
      mortsCeTick.set(e.entityId, e.byEntityId)
      if (levesEncoreVivantsPlusTard.has(e.entityId)) {
        levesEncoreVivantsPlusTard.delete(e.entityId)
        levesMortsPlusTard += 1
        compter(tueursDeLeves, e.byEntityId)
      }
    }
    if (e.type === 'cendreux_risen') nesCeTick.push({ id: e.entityId, cle: `${e.x},${e.y}` })
  }

  // LE SORT DU LEVÉ, À LA FIN DE SON TICK DE NAISSANCE. Trois cas, trois coupables :
  // vivant = rien ne l'a touché · mort = quelque chose l'a TUÉ (die l'aurait retiré s'il était
  // monstre… donc « mort et présent » signalerait un retrait manqué) · absent = retiré.
  for (const { id, cle } of nesCeTick) {
    // DEUX SOURCES SOUS UN SEUL ÉVÉNEMENT. `morts.ts` RÉUTILISE `cendreux_risen` pour le RÉVEIL
    // du sol : compter l'événement, c'est additionner deux mécanismes que le plafond de la
    // contagion traite différemment (seule la levée de cadavre porte `risen`, donc seule elle
    // entre dans `risenAlive`). Le cadavre marqué qui était là AVANT le tick, et qui n'y est
    // plus, est le discriminant — il survit au retrait du monstre.
    if (!marquesAvant.has(cle)) {
      reveils += 1
      continue // le réveil a son propre plafond (`UNDEAD_MAX_ALIVE`) : hors sujet ici
    }
    levees += 1
    const e = sim.entities.find((en) => en.id === id)
    if (!e) {
      // ABSENT NE DIT PAS POURQUOI. `die()` retire le monstre qu'il tue : « tué dans son tick »
      // et « retiré sans mourir » laissent la même trace dans `entities`, et ils n'ont ni le
      // même coupable ni le même correctif. L'événement de mort tranche.
      if (mortsCeTick.has(id)) {
        sortDesLeves.tueDansSonTick += 1
        compter(tueursDeLeves, mortsCeTick.get(id)!)
        identifier(mortsCeTick.get(id)!)
      } else sortDesLeves.absent += 1
    } else if (e.hp <= 0) sortDesLeves.mort += 1
    else {
      sortDesLeves.vivant += 1
      levesEncoreVivantsPlusTard.add(id)
    }
  }

  const vivant = risenAlive(sim)
  if (vivant > picRisenAlive) picRisenAlive = vivant
  const marques = sim.corpses.filter((c) => c.risesAt !== undefined).length
  if (marques > picMarques) picMarques = marques
  const cendreux = sim.monsters.filter((m) => m.type === 'cendreux').length
  if (cendreux > picCendreuxVivants) picCendreuxVivants = cendreux

  // Un battement : sur la carte de production une nuit dure des dizaines de minutes, et un
  // outil muet ne se distingue pas d'un outil bloqué.
  if (ticks % 2000 === 0) {
    console.log(
      `     … tick ${ticks} · ${getGameTime(sim).hourOfCycle.toFixed(1)} h · morts ${mortsMonstres + mortsNonMonstres}` +
        ` · levées ${levees} · réveils ${reveils} · marqués ${sim.corpses.filter((c) => c.risesAt !== undefined).length}` +
        ` · risenAlive ${risenAlive(sim)} · Cendreux ${sim.monsters.filter((m) => m.type === 'cendreux').length}`,
    )
  }
  // ON NE SORT QU'APRÈS AVOIR VU LA NUIT : partir avant qu'elle tombe rendrait un rapport vide
  // et le ferait passer pour un résultat (la première version l'a fait, à 20 h pile).
  if (getGameTime(sim).isNight) nuitVue = true
  if (nuitVue && !getGameTime(sim).isNight) break // le jour est revenu : la nuit est finie
}

/* ── Le rapport ───────────────────────────────────────────────────────────── */
const secondes = (performance.now() - t0) / 1000
console.log(
  `\n  ── ${ticks} ticks joués (${secondes.toFixed(0)} s) — monde ${monde.width}×${monde.height},` +
    ` fin à ${getGameTime(sim).hourOfCycle.toFixed(1)} h, jour ${seasonDayAtTick(sim.tick, sim.calendarScale)}`,
)
console.log(`\n  MORTS : ${mortsMonstres + mortsNonMonstres} au total`)
console.log(`     monstres (wasMonster=true) : ${mortsMonstres}`)
console.log(`     non-monstres              : ${mortsNonMonstres}  dont TÉMOIN ${mortsDuTemoin}`)
if (mortsNonMonstresIds.size > 0) {
  const top = [...mortsNonMonstresIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`     autres non-monstres       : ${top.map(([id, n]) => `#${id}×${n}`).join(' · ')}`)
}
console.log(`     par cause                 : ${[...mortsParCause].map(([c, n]) => `${c} ${n}`).join(' · ')}`)

console.log(
  `\n  LEVÉES DE CADAVRE : ${levees}  (plafond CENDREUX.MAX_ALIVE = ${CENDREUX.MAX_ALIVE})` +
    ` — et ${reveils} RÉVEILS du sol, qui partagent l'événement mais pas le plafond`,
)
console.log(
  `     sort à la fin du tick de naissance : vivant ${sortDesLeves.vivant} · mort et présent ${sortDesLeves.mort}` +
    ` · TUÉ dans son tick ${sortDesLeves.tueDansSonTick} · RETIRÉ sans mourir ${sortDesLeves.absent}`,
)
console.log(`     levés morts PLUS TARD : ${levesMortsPlusTard} · encore vivants à la fin : ${levesEncoreVivantsPlusTard.size}`)
if (tueursDeLeves.size > 0) {
  const top = [...tueursDeLeves.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`     tueurs de levés : ${top.map(([id, n]) => `#${id} ${identiteDesTueurs.get(id) ?? '?'} ×${n}`).join(' · ')}`)
}
console.log(`\n  PICS : risenAlive ${picRisenAlive} · cadavres MARQUÉS ${picMarques} · Cendreux vivants ${picCendreuxVivants}`)
