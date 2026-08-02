/**
 * DIAGNOSTIC DE LA MEUTE — les promesses de R11-R13, confrontées à ce qui se passe.
 *
 * La spec promet six choses ; cet outil les MESURE, une par banc, sur la vraie sim et sur
 * quatre graines (une meute est chaotique — un banc lu sur une seule graine est du bruit) :
 *
 *   LA POURSUITE (R13) — « un sprint ne creuse que ~15 tuiles : on ne sème pas des loups ».
 *     Un homme qui MARCHE se fait-il rattraper ? En combien de temps ? Colonne `1ʳᵉ MORSURE`.
 *   L'ENCERCLEMENT (R11) — « trois loups partis du même point se répartissent sur au moins
 *     deux côtés ». Colonne `CÔTÉS` : combien de relèvements distincts sont tenus au moment
 *     où la meute se rue.
 *   LA TRAQUE (R11) — « la lenteur EST la manœuvre ». Colonne `RAMPE` : la part du temps
 *     passée à ramper. 100 % veut dire que la ruée n'arrive jamais.
 *   LE COURAGE (R11) — un loup SEUL rôde et ne mord pas ; une meute mord.
 *   LA ROMPUE (R11) — blessé, il décroche « et rien ne le ramène tant qu'il n'est pas loin ».
 *     Colonne `RETOURS` : combien de fois un loup rompu se remet à chasser.
 *   LE TREMBLEMENT — mêmes mesures que pour le cerf (`diag-cerf.mts`), en PIRE SECONDE :
 *     bascules de posture (rampe/court : deux silhouettes de hauteur différente), demi-tours
 *     du pas, retournements du sprite.
 *
 *   node --import tsx tools/diag-loup.mts [secondes]
 */
import { BALANCE, COMBAT, FAUNA, MONSTER_DEFS, TERRAIN_FOREST, TERRAIN_GRASS } from '../packages/sim/src/balance'
import { createEmptyMap, type WorldMap } from '../packages/sim/src/map'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from '../packages/sim/src/sim'
import { spawnMonster, type Monster } from '../packages/sim/src/monsters'
import { cycleOffsetForStartHour } from '../packages/sim/src/time'
import { drainEvents } from '../packages/sim/src/events'

const secondes = Number(process.argv[2] ?? 45)
const TICKS = Math.round(secondes * BALANCE.TICK_RATE_HZ)
const GRAINES = [1234, 77, 2026, 909]

/**
 * LA MOLETTE D'EXPÉRIENCE — pour mesurer une hypothèse AVANT de toucher au jeu.
 *
 *   DIAG_LOUP_SET="PURSUIT_RANGE=100000,wolf.speed=5.4" node --import tsx tools/diag-loup.mts
 *
 * On surcharge les constantes EN MÉMOIRE, le temps du banc : rien n'est écrit dans `/sim`,
 * donc aucune suite ne bouge et aucun flux déterministe n'est décalé pour les autres.
 * `FAUNA.X` et `MONSTER_DEFS.wolf.X` sont lus à chaque tick par la sim — surcharger l'objet
 * suffit, et c'est le SEUL moyen honnête de répondre à « et si… ? » sans commit d'abord.
 */
const surcharge = process.env.DIAG_LOUP_SET
if (surcharge) {
  for (const paire of surcharge.split(',')) {
    const [cle, valeur] = paire.split('=')
    if (cle === undefined || valeur === undefined) continue
    const v = Number(valeur)
    if (cle.startsWith('wolf.')) (MONSTER_DEFS.wolf as unknown as Record<string, number>)[cle.slice(5)] = v
    else (FAUNA as unknown as Record<string, number>)[cle] = v
    console.log(`⚙ surcharge : ${cle} = ${v}`)
  }
}

/**
 * LA CARTE DOIT ÊTRE PLUS LONGUE QUE LA FUITE — sinon ce banc mesure un MUR.
 *
 * Elle faisait 200×200. Un homme qui part de y=112 et marche à 4 t/s touche le bord
 * en 22 secondes ; celui qui sprinte, en 15. Or les bancs courent 45 s. Tout ce que
 * la table appelait « morsure » après ce moment-là était une meute qui rattrapait un
 * homme PLAQUÉ CONTRE LE BORD DU MONDE — pas une poursuite. La colonne « 1ʳᵉ morsure
 * 22,2 s » de l'homme qui marche valait exactement le temps qu'il mettait à s'écraser
 * dessus. Sur une carte assez longue, elle vaut JAMAIS.
 *
 * 1400 de haut = 320 tuiles de course à 4 t/s pendant 80 s, et le garde `auBord`
 * ci-dessous crie si une seule graine touche encore le bord.
 */
function makeMap(): WorldMap {
  const map = createEmptyMap(200, 1400, TERRAIN_GRASS)
  for (let ty = 10; ty < 50; ty++) for (let tx = 10; tx < 50; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
  return map
}

/**
 * L'ORIGINE DES BANCS, posée au MILIEU de la carte haute. Les bancs sont écrits autour
 * de y≈100 (l'homme part à 112, la meute à 100) ; sans ce décalage, celui qui MARCHE VERS
 * la meute et la dépasse sort par le bas — et c'est reparti pour un mur.
 */
const Y0 = 600

/** 3 h du matin : l'heure du loup (R10bis), sa pleine vigueur. */
function makeSim(seed: number, hour = 3): SimState {
  const sim = createSim(seed, { map: makeMap(), faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(hour) })
  sim.wind = { x: 0, y: 0 }
  return sim
}

/** Une meute posée à la main : n loups, même herdId, le premier ALPHA (R12). */
function makePack(sim: SimState, n: number, x: number, y: number, ecart = 1.5): Monster[] {
  const herdId = n > 1 ? sim.nextHerdId++ : undefined
  const out: Monster[] = []
  for (let i = 0; i < n; i++) {
    const id = spawnMonster(sim, 'wolf', x + i * ecart, y)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    if (herdId !== undefined) m.herdId = herdId
    m.groundX = x
    m.groundY = y
    out.push(m)
  }
  if (out[0]) {
    out[0].alpha = true
    const e = sim.entities.find((q) => q.id === out[0]!.entityId)!
    e.hp = Math.round(MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP)
    for (const w of out) w.alphaId = out[0]!.entityId
  }
  return out
}

interface Compte {
  ticks: number
  /** Distance la plus COURTE atteinte entre un loup et l'homme. */
  auPlusPres: number
  /** Tick de la première morsure encaissée (−1 : jamais). */
  premiereMorsure: number
  morsures: number
  /** Ticks passés à ramper, sur ticks de loup. */
  rampe: number
  loupTicks: number
  /** Le plus grand nombre de relèvements distincts tenus autour de l'homme. */
  cotes: number
  /** Bascules rampe↔court, demi-tours, miroirs : PIRE SECONDE, par loup. */
  pirePostures: number
  pireDemiTours: number
  pireMiroirs: number
  /** Combien de fois un loup rompu (sous le seuil de PV) reprend une cible. */
  retours: number
  /** Il a perdu l'homme de vue (plus de cible) alors qu'il l'avait. */
  abandons: number
  hurlements: number
  /** Distance finale de l'homme aux loups. */
  finale: number
  /**
   * Les coups ARMÉS (wind-ups commencés). Sans cette colonne, `MORSURES` à zéro se lit
   * « la meute n'a pas engagé » — alors qu'elle peut avoir armé trois cents coups et
   * fendu l'air à chaque fois. Ce sont deux pannes opposées, et elles ne se réparent pas
   * au même endroit : l'une est un problème d'APPROCHE, l'autre de MORSURE.
   */
  armes: number
  /** L'homme a touché le bord du monde : le banc ne mesure plus une poursuite. */
  auBord: boolean
}

/** Le relèvement (huitième) d'un loup autour de l'homme — pour compter les CÔTÉS tenus. */
function cote(dx: number, dy: number): number {
  const l = Math.sqrt(dx * dx + dy * dy)
  if (l < 0.001) return -1
  const x = dx / l
  const y = dy / l
  const qx = x > 0.3827 ? 1 : x < -0.3827 ? -1 : 0
  const qy = y > 0.3827 ? 1 : y < -0.3827 ? -1 : 0
  return (qx + 1) * 3 + (qy + 1)
}

function releve(sim: SimState, pack: Monster[], avatarId: number, ticks: number, input: (t: number) => MoveInput): Compte {
  const c: Compte = {
    ticks: 0, auPlusPres: Infinity, premiereMorsure: -1, morsures: 0, rampe: 0, loupTicks: 0,
    cotes: 0, pirePostures: 0, pireDemiTours: 0, pireMiroirs: 0, retours: 0, abandons: 0,
    hurlements: 0, finale: 0, armes: 0, auBord: false,
  }
  const bord = 6
  const ent = (id: number) => sim.entities.find((e) => e.id === id)
  const avatar = ent(avatarId)!
  let hpAvant = avatar.hp
  const suivi = new Map(pack.map((w) => {
    const e = ent(w.entityId)!
    return [w.entityId, {
      stalk: w.stalking === true, avaitCible: false, etaitRompu: false, flip: false,
      x: e.x, y: e.y, capX: 0, capY: 0,
      fenetre: 0, fPost: 0, fDemi: 0, fMir: 0, armait: false,
    }]
  }))

  for (let t = 0; t < ticks; t++) {
    step(sim, [input(t)])
    for (const ev of drainEvents(sim)) if (ev.type === 'wolf_howl') c.hurlements++
    c.ticks++
    const a = ent(avatarId)
    if (!a || a.hp <= 0) {
      if (c.premiereMorsure < 0) c.premiereMorsure = t
      break
    }
    if (a.hp < hpAvant) {
      c.morsures++
      if (c.premiereMorsure < 0) c.premiereMorsure = t
      hpAvant = a.hp
    }
    // LE BORD DU MONDE. Une fois dedans, l'homme ne fuit plus : il est tenu par la carte,
    // et tout ce qu'on mesure après est le mur, pas la meute.
    if (a.x < bord || a.y < bord || a.x > sim.map.width - bord || a.y > sim.map.height - bord) c.auBord = true
    const cotesTenus = new Set<number>()
    const fenetre = Math.floor(t / BALANCE.TICK_RATE_HZ)
    for (const w of pack) {
      const e = ent(w.entityId)
      const s = suivi.get(w.entityId)!
      if (!e || e.hp <= 0) continue
      c.loupTicks++
      if (w.stalking) c.rampe++
      const d = Math.sqrt((e.x - a.x) * (e.x - a.x) + (e.y - a.y) * (e.y - a.y))
      c.auPlusPres = Math.min(c.auPlusPres, d)
      // Un loup « autour » de l'homme : à portée de cercle, il tient un côté.
      if (d <= FAUNA.ENCIRCLE_RADIUS + FAUNA.POST_TOLERANCE + 1) {
        const k = cote(e.x - a.x, e.y - a.y)
        if (k >= 0) cotesTenus.add(k)
      }
      // LA ROMPUE : il repasse sous le seuil, puis reprend une cible = un RETOUR.
      const rompu = e.hp < MONSTER_DEFS.wolf.hp * (w.alpha ? FAUNA.ALPHA_HP : 1) * FAUNA.PACK_BREAK_HP
      if (s.etaitRompu && w.targetId !== null && !rompu) c.retours++
      if (s.etaitRompu && w.targetId !== null && rompu) c.retours++
      s.etaitRompu = rompu
      // Il avait l'homme et ne l'a plus : un abandon.
      const aCible = w.targetId === avatarId
      if (s.avaitCible && !aCible) c.abandons++
      s.avaitCible = aCible
      // PIRE SECONDE : postures (rampe/court), demi-tours, miroirs (règle de la vue).
      if (fenetre !== s.fenetre) {
        c.pirePostures = Math.max(c.pirePostures, s.fPost)
        c.pireDemiTours = Math.max(c.pireDemiTours, s.fDemi)
        c.pireMiroirs = Math.max(c.pireMiroirs, s.fMir)
        s.fenetre = fenetre
        s.fPost = 0
        s.fDemi = 0
        s.fMir = 0
      }
      // UN COUP ARMÉ : le front du wind-up. Le loup se fige pendant 0,45 s pour l'armer
      // (monsters.ts, « en train de frapper : immobile ») — c'est là que la proie prend
      // ses 1,8 tuile d'avance, pour une morsure qui n'en porte que 1,2.
      const arme = e.windup !== undefined
      if (arme && !s.armait) c.armes++
      s.armait = arme
      if ((w.stalking === true) !== s.stalk) s.fPost++
      s.stalk = w.stalking === true
      const dx = e.x - s.x
      const dy = e.y - s.y
      if (dx * dx + dy * dy > 1e-9) {
        if (dx * s.capX + dy * s.capY < 0) s.fDemi++
        s.capX = dx
        s.capY = dy
      }
      if (Math.abs(e.facing.x) > 0.25) {
        const f = e.facing.x < 0
        if (f !== s.flip) s.fMir++
        s.flip = f
      }
      s.x = e.x
      s.y = e.y
    }
    c.cotes = Math.max(c.cotes, cotesTenus.size)
  }
  for (const s of suivi.values()) {
    c.pirePostures = Math.max(c.pirePostures, s.fPost)
    c.pireDemiTours = Math.max(c.pireDemiTours, s.fDemi)
    c.pireMiroirs = Math.max(c.pireMiroirs, s.fMir)
  }
  const a = ent(avatarId)
  const vivants = pack.map((w) => ent(w.entityId)).filter((e) => e && e.hp > 0)
  c.finale = a && vivants.length ? Math.min(...vivants.map((e) => Math.sqrt((e!.x - a.x) ** 2 + (e!.y - a.y) ** 2))) : Infinity
  return c
}

const lignes: string[] = []
function moy(cs: Compte[], f: (c: Compte) => number): number {
  let t = 0
  for (const c of cs) t += f(c)
  return t / cs.length
}
function rapporte(nom: string, cs: Compte[]): void {
  const morsure = cs.map((c) => c.premiereMorsure)
  const jamais = morsure.filter((m) => m < 0).length
  const quand = morsure.filter((m) => m >= 0)
  lignes.push(
    [
      nom.padEnd(30),
      (jamais === cs.length ? 'JAMAIS' : `${(quand.reduce((a, b) => a + b, 0) / quand.length / BALANCE.TICK_RATE_HZ).toFixed(1)}s${jamais ? `(${jamais}✗)` : ''}`).padStart(10),
      moy(cs, (c) => c.auPlusPres).toFixed(1).padStart(7),
      moy(cs, (c) => c.finale === Infinity ? 99 : c.finale).toFixed(1).padStart(7),
      `${(100 * moy(cs, (c) => (c.loupTicks ? c.rampe / c.loupTicks : 0))).toFixed(0)}%`.padStart(6),
      moy(cs, (c) => c.cotes).toFixed(1).padStart(6),
      moy(cs, (c) => c.armes).toFixed(0).padStart(6),
      moy(cs, (c) => c.morsures).toFixed(1).padStart(8),
      moy(cs, (c) => c.hurlements).toFixed(1).padStart(6),
      moy(cs, (c) => c.retours).toFixed(0).padStart(8),
      `${moy(cs, (c) => c.pirePostures).toFixed(1)}/${moy(cs, (c) => c.pireDemiTours).toFixed(1)}/${moy(cs, (c) => c.pireMiroirs).toFixed(1)}`.padStart(15),
      cs.some((c) => c.auBord) ? '  ⚠ BORD' : '',
    ].join(' '),
  )
}

/** L'homme, ses PV, sa lance : un banc de POURSUITE ne mesure rien si l'homme meurt en 3 s. */
function poseHomme(sim: SimState, x: number, y: number, pv = 100): number {
  const id = spawnEntity(sim, x, y)
  const e = sim.entities.find((q) => q.id === id)!
  e.hp = pv
  return id
}

const IMMOBILE = (id: number) => () => ({ entityId: id, dx: 0 as const, dy: 0 as const })
const MARCHE = (id: number) => () => ({ entityId: id, dx: 0 as const, dy: 1 as const })
const SPRINT = (id: number) => () => ({ entityId: id, dx: 0 as const, dy: 1 as const, sprint: true })

/* ── Les bancs ────────────────────────────────────────────────────────────── */

// 1. LA POURSUITE (R13). L'homme part à 12 tuiles et s'en va — en marchant, puis en
//    sprintant. La spec promet qu'on ne sème pas des loups.
for (const [nom, faire, n] of [
  ['meute de 4 · homme immobile', IMMOBILE, 4],
  ['meute de 4 · homme qui MARCHE', MARCHE, 4],
  ['meute de 4 · homme qui SPRINTE', SPRINT, 4],
  ['loup SEUL · homme immobile', IMMOBILE, 1],
  ['loup SEUL · homme qui MARCHE', MARCHE, 1],
] as const) {
  rapporte(
    nom,
    GRAINES.map((g) => {
      const sim = makeSim(g)
      const pack = makePack(sim, n, 100.5, Y0 + 100.5)
      const homme = poseHomme(sim, 100.5, Y0 + 112.5)
      return releve(sim, pack, homme, TICKS, faire(homme))
    }),
  )
}

// 2. LE TRAÎNARD. Une bête loin du cercle — la meute attend-elle pour toujours ? (L'homme
//    MARCHE : figé, il ne serait même pas repéré, et le banc ne mesurerait rien.)
rapporte(
  'meute de 4 · traînard à 40t',
  GRAINES.map((g) => {
    const sim = makeSim(g)
    const pack = makePack(sim, 4, 100.5, Y0 + 100.5)
    const retard = sim.entities.find((q) => q.id === pack[3]!.entityId)!
    retard.x = 140.5
    retard.y = Y0 + 100.5
    const homme = poseHomme(sim, 100.5, Y0 + 112.5)
    return releve(sim, pack, homme, TICKS, MARCHE(homme))
  }),
)

// 3. L'HOMME QUI VIENT À ELLE. Il ne fuit pas : la meute doit le TRAQUER — ramper vers ses
//    postes et boucler le cercle avant de se ruer. C'est le moment de jeu que la traque
//    existe pour produire, et la colonne RAMPE doit être franchement non nulle.
rapporte(
  'meute de 4 · homme qui VIENT',
  GRAINES.map((g) => {
    const sim = makeSim(g)
    const pack = makePack(sim, 4, 100.5, Y0 + 100.5)
    const homme = poseHomme(sim, 100.5, Y0 + 118.5)
    return releve(sim, pack, homme, TICKS, () => ({ entityId: homme, dx: 0, dy: -1 }))
  }),
)

// 3. LA ROMPUE (R11). Tous les loups déjà sous le seuil de PV : ils doivent décrocher
//    et NE PAS revenir. `RETOURS` compte les reprises de cible.
rapporte(
  'meute de 4 · tous BLESSÉS (35 %)',
  GRAINES.map((g) => {
    const sim = makeSim(g)
    const pack = makePack(sim, 4, 100.5, Y0 + 100.5)
    for (const w of pack) {
      const e = sim.entities.find((q) => q.id === w.entityId)!
      e.hp = Math.max(1, Math.floor(MONSTER_DEFS.wolf.hp * FAUNA.PACK_BREAK_HP) - 1)
    }
    const homme = poseHomme(sim, 100.5, Y0 + 108.5)
    return releve(sim, pack, homme, TICKS, IMMOBILE(homme))
  }),
)

/* ── L'ACQUISITION : à quelle distance une meute vous REPÈRE-T-elle, selon l'allure ? ── */

console.log(`\n${secondes} s par banc · ${GRAINES.length} graines · 3 h du matin (pleine vigueur)`)
console.log(`portée d'aggro déclarée : ${MONSTER_DEFS.wolf.aggroRange} tuiles · poursuite ${FAUNA.PURSUIT_RANGE}\n`)
console.log("À QUELLE DISTANCE LA MEUTE VOUS REPÈRE (10 s d'observation, la plus grande distance où au moins une graine acquiert)")
for (const [nom, faire] of [['immobile', IMMOBILE], ['qui marche', MARCHE], ['qui sprinte', SPRINT]] as const) {
  let derniere = 0
  for (let d = 2; d <= 26; d += 1) {
    let pris = 0
    for (const g of GRAINES) {
      const sim = makeSim(g)
      const pack = makePack(sim, 4, 100.5, Y0 + 100.5)
      const homme = poseHomme(sim, 100.5, Y0 + 100.5 + d)
      const faireInput = faire(homme)
      let acquis = false
      for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ && !acquis; t++) {
        step(sim, [faireInput(t)])
        if (pack.some((w) => w.targetId === homme)) acquis = true
      }
      if (acquis) pris++
    }
    if (pris > 0) derniere = d
  }
  console.log(`  un homme ${nom.padEnd(12)} : repéré jusqu'à ${derniere} tuiles`)
}

// 4. LE GESTE QUE LA TRAQUE EXISTE POUR PRODUIRE : il marche (donc il est repéré), puis il
//    SE FIGE. Il n'est plus fuyard : la meute doit ramper, se placer, et n'en finir qu'une
//    fois le cercle bouclé. C'est ici que `RAMPE` et `CÔTÉS` doivent être hauts.
rapporte(
  'meute de 4 · marche puis SE FIGE',
  GRAINES.map((g) => {
    const sim = makeSim(g)
    const pack = makePack(sim, 4, 100.5, Y0 + 100.5)
    const homme = poseHomme(sim, 100.5, Y0 + 112.5)
    return releve(sim, pack, homme, TICKS, (t) => ({
      entityId: homme,
      dx: 0,
      dy: t < 3 * BALANCE.TICK_RATE_HZ ? 1 : 0,
    }))
  }),
)

// 5. L'HOMME QUI ZIGZAGUE — le régime que les bancs en ligne droite ne voient pas. Le
//    « il fuit » est un SEUIL (produit scalaire > FLEEING_DOT) et il commande DEUX choses :
//    l'allure (2,0 ↔ 4,8 t/s) et la silhouette (rampe 0,8 tuile de haut ↔ court 1,15). Un
//    homme qui tourne met chaque loup d'un côté différent du seuil, et le fait retraverser :
//    c'est là, et nulle part ailleurs, qu'un battement se verrait.
for (const [nom, periode] of [['zigzag 0,75 s', 15], ['zigzag 2 s', 40]] as const) {
  rapporte(
    `meute de 4 · ${nom}`,
    GRAINES.map((g) => {
      const sim = makeSim(g)
      const pack = makePack(sim, 4, 100.5, Y0 + 100.5)
      const homme = poseHomme(sim, 100.5, Y0 + 112.5)
      return releve(sim, pack, homme, TICKS, (t) => ({
        entityId: homme,
        dx: (Math.floor(t / periode) % 2 === 0 ? 1 : -1) as -1 | 1,
        dy: 1,
      }))
    }),
  )
}

// 6. L'HOMME QUI TOURNE AUTOUR de la meute — chaque loup voit un cap différent, et le
//    produit scalaire de chacun balaie tout l'intervalle. Le pire cas théorique du seuil.
rapporte(
  'meute de 4 · homme qui TOURNE',
  GRAINES.map((g) => {
    const sim = makeSim(g)
    const pack = makePack(sim, 4, 100.5, Y0 + 100.5)
    const homme = poseHomme(sim, 100.5, Y0 + 110.5)
    // Un carré de 3 s de côté autour de la meute : les quatre caps, tour à tour.
    const CAPS = [[1, 0], [0, -1], [-1, 0], [0, 1]] as const
    return releve(sim, pack, homme, TICKS, (t) => {
      const c = CAPS[Math.floor(t / (3 * BALANCE.TICK_RATE_HZ)) % 4]!
      return { entityId: homme, dx: c[0], dy: c[1] }
    })
  }),
)

const enTete = [
  'banc'.padEnd(30),
  '1ʳᵉ MORS.'.padStart(10),
  'AU PLUS'.padStart(7),
  'FINALE'.padStart(7),
  'RAMPE'.padStart(6),
  'CÔTÉS'.padStart(6),
  'ARMÉS'.padStart(6),
  'MORSURES'.padStart(8),
  'HURL.'.padStart(6),
  'RETOURS'.padStart(8),
  'post/½t/miroir'.padStart(15),
].join(' ')
console.log(`\n${secondes} s par banc · ${GRAINES.length} graines · 3 h du matin (pleine vigueur)`)
console.log(`portée de morsure ${COMBAT.MELEE_ENGAGE_RANGE} · cercle ${FAUNA.ENCIRCLE_RADIUS}+${FAUNA.POST_TOLERANCE} · rampe ${FAUNA.STALK_SPEED} × ${MONSTER_DEFS.wolf.speed} = ${(FAUNA.STALK_SPEED * MONSTER_DEFS.wolf.speed).toFixed(1)} t/s · marche ${BALANCE.WALK_SPEED_TILES_PER_S} t/s\n`)
console.log(enTete)
console.log('-'.repeat(enTete.length))
for (const l of lignes) console.log(l)
