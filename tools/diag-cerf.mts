/**
 * DIAGNOSTIC DU CERF — « ils bougent allongés, parfois ils tremblent » (Alexis, 2026-08-01).
 *
 * Deux plaintes, deux mesures. L'outil joue la VRAIE sim (aucune imitation de faune ici) et
 * demande la silhouette au module de la VUE (`beast-posture`), pour que ce qu'on compte soit
 * exactement ce que l'écran montre — recopier la règle à la main l'aurait fait dériver au
 * premier correctif.
 *
 * Ce qu'il compte, et ce que chaque colonne tranche :
 *   • COUCHÉ&BOUGE — part des ticks où la bête est DESSINÉE couchée alors qu'elle se
 *     déplace. C'est la première plainte, chiffrée. Doit tomber à 0.
 *   • POSTURES/s   — changements de silhouette par seconde et par bête. Au-delà de ~1, ça
 *     bat : le cerf clignote entre deux dessins (1,8 tuile ↔ 1,4).
 *   • SEUIL/s      — bascules du « elle vous a repéré » par seconde. C'est la teinte qui
 *     clignote, ET le gel qui s'allume et s'éteint — donc le pas qui repart et s'arrête.
 *   • PAS/s        — bascules bouge/immobile par seconde (fait de sim). Un brouteur alterne
 *     (il flâne) ; au-delà de ~4, c'est un tremblement.
 *   • MIROIRS/s    — retournements du sprite (règle exacte de la vue : seuil 0,25 sur
 *     facing.x, verrou sinon). Un miroir qui claque se lit comme un tremblement.
 *   • SINUOSITÉ    — chemin parcouru ÷ déplacement net. 1 = ligne droite ; 20 = piétinement.
 *
 * Les colonnes « av » lisent les RÈGLES DE VUE d'avant le correctif (recopiées plus bas, et
 * nulle part ailleurs) ; les colonnes « ap » lisent le module de la vue. Les faits de SIM
 * (PAS/s, MIROIRS/s, SINUOSITÉ) n'ont qu'une colonne : pour ceux-là, on compare deux
 * exécutions de l'outil, avant et après le correctif de `/sim`.
 *
 *   node --import tsx tools/diag-cerf.mts [secondes]
 */
import { BALANCE, FAUNA, HUNT, TERRAIN_FOREST, TERRAIN_GRASS } from '../packages/sim/src/balance'
import { activityAt, sentinelOf } from '../packages/sim/src/faune'
import { createEmptyMap, type WorldMap } from '../packages/sim/src/map'
import { createSim, spawnEntity, step, type SimState } from '../packages/sim/src/sim'
import { spawnMonster, type Monster } from '../packages/sim/src/monsters'
import { cycleOffsetForStartHour, getGameTime } from '../packages/sim/src/time'
import { beastTexture, majMiroir, majRepos, nouveauMiroir, nouveauRepos } from '../packages/client/src/scenes/world/beast-posture'

const secondes = Number(process.argv[2] ?? 60)
const TICKS = Math.round(secondes * BALANCE.TICK_RATE_HZ)

/**
 * L'ANCIENNE RÈGLE DE POSTURE, recopiée ICI et nulle part ailleurs — elle n'existe plus dans
 * la vue. Elle ne sert qu'aux colonnes « av » : sans elle, on ne saurait pas de combien on a
 * amélioré. (Elle couchait la bête sur L'HEURE seule, et la dressait sur la jauge NUE.)
 */
function postureAvant(m: Monster, sentinel: boolean, hour: number): string {
  if (m.type !== 'deer') return `spr-${m.type}`
  if (m.fleeSince >= 0) return 'spr-deer-flee'
  if (m.bedded) return 'spr-deer-bed'
  if (m.baitUntil === undefined && (sentinel || m.suspicion >= HUNT.SUSPICION_CURIOUS)) return 'spr-deer'
  if (activityAt('deer', hour) < FAUNA.REST_BELOW) return 'spr-deer-bed'
  return 'spr-deer-graze'
}

/** Prairie, avec un bois au nord-ouest — le même monde que `faune.test`. */
function makeMap(): WorldMap {
  const map = createEmptyMap(160, 160, TERRAIN_GRASS)
  for (let ty = 10; ty < 50; ty++) for (let tx = 10; tx < 50; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
  return map
}

function makeSim(hour: number, seed: number): SimState {
  return createSim(seed, { map: makeMap(), faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(hour) })
}

/**
 * QUATRE GRAINES, PAS UNE. Une harde est un système chaotique : changer un seuil change tout
 * le flux de tirages, donc la trajectoire entière. Un « pire seconde » lu sur une seule graine
 * se balade de 6 à 20 sans que rien de structurel n'ait bougé — on comparerait du bruit. On
 * moyenne donc la pire seconde sur quatre mondes, et c'est CETTE moyenne qui décide.
 */
const GRAINES = [1234, 77, 2026, 909]

/**
 * Une harde posée à la main : n cerfs, même herdId, en ligne (montage de `faune.test`), et
 * DOTÉS D'UN CANTON (R17) comme le fait le peuplement — sans quoi la branche « regagner son
 * territoire », qui est l'une de celles qui font marcher une bête à l'heure du repos, ne se
 * déclencherait jamais et le banc mentirait par omission.
 */
function makeHerd(sim: SimState, n: number, x: number, y: number, ecart = 2.5): number[] {
  const herdId = sim.nextHerdId++
  const ids: number[] = []
  for (let i = 0; i < n; i++) {
    const id = spawnMonster(sim, 'deer', x + i * ecart, y)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.herdId = herdId
    m.groundX = x
    m.groundY = y
    ids.push(id)
  }
  return ids
}

interface Compte {
  ticks: number
  bouge: number
  coucheAv: number
  coucheAp: number
  postAv: number
  postAp: number
  seuilAv: number
  seuilAp: number
  pas: number
  miroirs: number
  chemin: number
  net: number
  /** LA PIRE SECONDE : « parfois ils tremblent » est une plainte de POINTE, pas de moyenne.
   *  Une bête qui claque huit miroirs en une seconde puis se tient tranquille une minute rend
   *  une moyenne rassurante et un écran qui vibre. */
  pireMiroirs: number
  pirePostures: number
  pirePas: number
  pireDemiTours: number
}

function releve(sim: SimState, ids: number[], ticks: number, avance: () => void): Compte {
  const c: Compte = {
    ticks: 0, bouge: 0, coucheAv: 0, coucheAp: 0, postAv: 0, postAp: 0,
    seuilAv: 0, seuilAp: 0, pas: 0, miroirs: 0, chemin: 0, net: 0,
    pireMiroirs: 0, pirePostures: 0, pirePas: 0, pireDemiTours: 0,
  }
  const suivi = new Map<number, {
    repos: ReturnType<typeof nouveauRepos>
    postAv: string; postAp: string
    seuilAv: boolean; seuilAp: boolean
    bouge: boolean
    miroir: ReturnType<typeof nouveauMiroir>
    x: number; y: number; x0: number; y0: number
    /** Le dernier cap de déplacement NON NUL — un demi-tour, c'est son renversement. */
    capX: number; capY: number
    fenetre: number
    fMiroirs: number; fPostures: number; fPas: number; fDemiTours: number
  }>()
  const ent = (id: number) => sim.entities.find((e) => e.id === id)
  for (const id of ids) {
    const e = ent(id)!
    suivi.set(id, {
      repos: nouveauRepos(0), postAv: '', postAp: '', seuilAv: false, seuilAp: false,
      bouge: false, miroir: nouveauMiroir(false, 0), x: e.x, y: e.y, x0: e.x, y0: e.y,
      capX: 0, capY: 0, fenetre: 0, fMiroirs: 0, fPostures: 0, fPas: 0, fDemiTours: 0,
    })
  }

  for (let t = 0; t < ticks; t++) {
    avance()
    const now = t * (1000 / BALANCE.TICK_RATE_HZ)
    const hour = getGameTime(sim).hourOfCycle
    const hardes = new Map<number, Monster[]>()
    for (const m of sim.monsters) {
      if (m.herdId === undefined) continue
      const l = hardes.get(m.herdId)
      if (l) l.push(m)
      else hardes.set(m.herdId, [m])
    }
    const gardes = new Set<number>()
    for (const l of hardes.values()) {
      const g = sentinelOf(l, sim.tick)
      if (g >= 0) gardes.add(g)
    }
    for (const id of ids) {
      const e = ent(id)
      const m = sim.monsters.find((mm) => mm.entityId === id)
      const s = suivi.get(id)!
      if (!e || !m || e.hp <= 0) continue
      c.ticks++
      if (e.moved) c.bouge++
      // La fenêtre d'une seconde se ferme : on retient la pire, puis on repart de zéro.
      const fenetre = Math.floor(t / BALANCE.TICK_RATE_HZ)
      if (fenetre !== s.fenetre) {
        c.pireMiroirs = Math.max(c.pireMiroirs, s.fMiroirs)
        c.pirePostures = Math.max(c.pirePostures, s.fPostures)
        c.pirePas = Math.max(c.pirePas, s.fPas)
        c.pireDemiTours = Math.max(c.pireDemiTours, s.fDemiTours)
        s.fenetre = fenetre
        s.fMiroirs = 0
        s.fPostures = 0
        s.fPas = 0
        s.fDemiTours = 0
      }
      const posee = majRepos(s.repos, e.moved, now)
      const postAp = beastTexture(m, gardes.has(id), hour, posee)
      const postAv = postureAvant(m, gardes.has(id), hour)
      if (s.postAp && postAp !== s.postAp) {
        c.postAp++
        s.fPostures++
      }
      if (s.postAv && postAv !== s.postAv) c.postAv++
      if (postAp === 'spr-deer-bed' && e.moved) c.coucheAp++
      if (postAv === 'spr-deer-bed' && e.moved) c.coucheAv++
      const seuilAv = m.suspicion >= HUNT.SUSPICION_CURIOUS
      const seuilAp = m.wary === true
      if (seuilAv !== s.seuilAv) c.seuilAv++
      if (seuilAp !== s.seuilAp) c.seuilAp++
      if (e.moved !== s.bouge) {
        c.pas++
        s.fPas++
      }
      // La règle EXACTE de la vue : seuil de 0,25 sur le regard, puis le verrou de temps.
      const avantMiroir = s.miroir.face
      const flip = Math.abs(e.facing.x) > 0.25 ? majMiroir(s.miroir, e.facing.x < 0, now) : s.miroir.face
      if (flip !== avantMiroir) {
        c.miroirs++
        s.fMiroirs++
      }
      // LE DEMI-TOUR : le pas de ce tick renverse-t-il le cap précédent ? (produit scalaire
      // négatif). C'est le tremblement dans sa forme la plus littérale — un pas en avant,
      // un pas en arrière.
      const px = e.x - s.x
      const py = e.y - s.y
      if (px * px + py * py > 1e-9) {
        if (px * s.capX + py * s.capY < 0) s.fDemiTours++
        s.capX = px
        s.capY = py
      }
      c.chemin += Math.sqrt(px * px + py * py)
      s.postAp = postAp
      s.postAv = postAv
      s.seuilAv = seuilAv
      s.seuilAp = seuilAp
      s.bouge = e.moved
      s.x = e.x
      s.y = e.y
    }
  }
  for (const id of ids) {
    const e = ent(id)
    const s = suivi.get(id)!
    if (e) c.net += Math.sqrt((e.x - s.x0) * (e.x - s.x0) + (e.y - s.y0) * (e.y - s.y0))
    c.pireMiroirs = Math.max(c.pireMiroirs, s.fMiroirs)
    c.pirePostures = Math.max(c.pirePostures, s.fPostures)
    c.pirePas = Math.max(c.pirePas, s.fPas)
    c.pireDemiTours = Math.max(c.pireDemiTours, s.fDemiTours)
  }
  return c
}

const lignes: string[] = []
/** La moyenne d'un champ sur les graines — c'est elle qui décide, jamais une exécution seule. */
function moy(cs: Compte[], f: (c: Compte) => number): number {
  let t = 0
  for (const c of cs) t += f(c)
  return t / cs.length
}

function rapporte(nom: string, cs: Compte[]): void {
  const parSeconde = (f: (c: Compte) => number) => moy(cs, (c) => (c.ticks === 0 ? 0 : (f(c) * BALANCE.TICK_RATE_HZ) / c.ticks))
  // COUCHÉ&BOUGE se rapporte aux ticks où la bête BOUGE, pas au temps total : « quand un cerf
  // se déplace, dans quelle part des cas est-il dessiné couché ? » — c'est la plainte, exacte.
  const pctBouge = (f: (c: Compte) => number) => moy(cs, (c) => (c.bouge === 0 ? 0 : (100 * f(c)) / c.bouge))
  lignes.push(
    [
      nom.padEnd(26),
      `${pctBouge((c) => c.coucheAv).toFixed(0)}%`.padStart(7),
      `${pctBouge((c) => c.coucheAp).toFixed(0)}%`.padStart(6),
      parSeconde((c) => c.postAv).toFixed(2).padStart(7),
      parSeconde((c) => c.postAp).toFixed(2).padStart(6),
      parSeconde((c) => c.seuilAv).toFixed(2).padStart(7),
      parSeconde((c) => c.seuilAp).toFixed(2).padStart(6),
      parSeconde((c) => c.pas).toFixed(2).padStart(7),
      parSeconde((c) => c.miroirs).toFixed(2).padStart(8),
      moy(cs, (c) => (c.net > 0.5 ? c.chemin / c.net : 30)).toFixed(1).padStart(8),
      [
        moy(cs, (c) => c.pirePostures).toFixed(1),
        moy(cs, (c) => c.pireMiroirs).toFixed(1),
        moy(cs, (c) => c.pirePas).toFixed(1),
        moy(cs, (c) => c.pireDemiTours).toFixed(1),
      ].join('/').padStart(19),
    ].join(' '),
  )
}

/* ── Les bancs ────────────────────────────────────────────────────────────── */

// 1. LA HARDE AU PRÉ, à midi : personne, rien que le grégarisme et la dérive. Le régime de
//    référence — ce qu'on mesure ici est le bruit de fond du broutage.
for (const [nom, ecart] of [['groupée', 2.5], ['éparse', 6]] as const) {
  rapporte(
    `harde · midi · ${nom}`,
    GRAINES.map((g) => {
      const sim = makeSim(12, g)
      const ids = makeHerd(sim, 5, 80.5, 80.5, ecart)
      return releve(sim, ids, TICKS, () => step(sim, []))
    }),
  )
}

// 2. LA HARDE HORS DE SES HEURES (20 h 30 et 3 h) : elle se couche — mais elle recolle à la
//    harde, elle rentre, elle regagne son canton. C'est LÀ que la première plainte se voit,
//    et l'écart de départ décide de combien elle a à marcher couchée.
for (const [h, ecart] of [[20.5, 2.5], [20.5, 6], [3, 6]] as const) {
  rapporte(
    `harde · ${h}h · écart ${ecart}`,
    GRAINES.map((g) => {
      const sim = makeSim(h, g)
      const ids = makeHerd(sim, 5, 80.5, 80.5, ecart)
      return releve(sim, ids, TICKS, () => step(sim, []))
    }),
  )
}

// 3. LA HARDE LEVÉE PUIS LÂCHÉE, de nuit : le joueur les fait détaler, puis ne bouge plus.
//    Elles fuient trente tuiles, puis RENTRENT — et c'est le trajet du retour qu'on regarde.
rapporte(
  'harde · 21h · levée, lâchée',
  GRAINES.map((g) => {
    const sim = makeSim(21, g)
    const ids = makeHerd(sim, 5, 80.5, 80.5)
    const a = spawnEntity(sim, 80.5, 86)
    return releve(sim, ids, TICKS, () => step(sim, [{ entityId: a, dx: 0, dy: 0 }]))
  }),
)

// 4. L'APPROCHE, à midi : le joueur MARCHE sur la harde. C'est le geste réel du chasseur, et
//    c'est lui qui promène la jauge de méfiance à travers ses seuils.
rapporte(
  'approche · midi · marche',
  GRAINES.map((g) => {
    const sim = makeSim(12, g)
    const ids = makeHerd(sim, 3, 80.5, 80.5)
    const a = spawnEntity(sim, 82.5, 104.5)
    return releve(sim, ids, TICKS, () => step(sim, [{ entityId: a, dx: 0, dy: -1 }]))
  }),
)

// 5. LE STOP-AND-GO (chasse C1) : deux secondes de pas, trois de gel — l'approche que le jeu
//    ENSEIGNE. La jauge monte, retombe, remonte : elle vit sur ses seuils, et c'est le régime
//    où un seuil sans hystérésis se met à battre.
for (const d of [10, 14, 18] as const) {
  rapporte(
    `stop-and-go · midi · ${d} tuiles`,
    GRAINES.map((g) => {
      const sim = makeSim(12, g)
      const ids = makeHerd(sim, 3, 80.5, 80.5)
      const a = spawnEntity(sim, 82.5, 80.5 + d)
      return releve(sim, ids, TICKS, () => {
        const phase = sim.tick % 100
        step(sim, [{ entityId: a, dx: 0, dy: phase < 40 ? -1 : 0 }])
      })
    }),
  )
}

// 6. LE GUET : un joueur PLANTÉ à distance, de jour puis de nuit. Un chasseur figé redevient
//    presque invisible (C1) — c'est le banc du régime CALME, celui qui doit rester lisse.
for (const [h, d] of [[12, 10], [12, 14], [21, 10], [21, 14]] as const) {
  rapporte(
    `guet · ${h}h · joueur à ${d}`,
    GRAINES.map((g) => {
      const sim = makeSim(h, g)
      const ids = makeHerd(sim, 3, 80.5, 80.5)
      const a = spawnEntity(sim, 82.5, 80.5 + d)
      return releve(sim, ids, TICKS, () => step(sim, [{ entityId: a, dx: 0, dy: 0 }]))
    }),
  )
}

const enTete = [
  'banc'.padEnd(26),
  'COUCHÉ&BOUGE'.slice(0, 7).padStart(7),
  'ap'.padStart(6),
  'POSTUR/s'.slice(0, 7).padStart(7),
  'ap'.padStart(6),
  'SEUIL/s'.padStart(7),
  'ap'.padStart(6),
  'PAS/s'.padStart(7),
  'MIROIR/s'.padStart(8),
  'SINUOS.'.padStart(8),
  'PIRE SEC. post/mir/pas/½t'.slice(0, 19).padStart(19),
].join(' ')
console.log(`\n${secondes} s de jeu par banc · ${BALANCE.TICK_RATE_HZ} Hz · av = règle de vue d'avant, ap = module de vue\n`)
console.log(enTete)
console.log('-'.repeat(enTete.length))
for (const l of lignes) console.log(l)
