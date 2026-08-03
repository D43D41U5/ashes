/**
 * POURQUOI LE COUP NE CONNECTE PAS — l'instrument qui sépare les trois suspects.
 *
 *   node --import tsx tools/mesure-touche.mts
 *
 * Plainte d'Alexis (2026-08-02) : « le télégraphe est sur la cible mais le coup ne
 * connecte pas ». Trois causes possibles, et elles ont des SIGNATURES DIFFÉRENTES —
 * c'est ce qui permet de les distinguer sans deviner :
 *
 *   1. LA VISÉE EST PROJETÉE AU SOL, LE JOUEUR VISE UN CORPS DEBOUT. Le curseur se
 *      convertit en point de SOL (`pointerToWorld` → warp identité → x/16, y/16) ;
 *      or l'art est un billboard ancré aux PIEDS (`actorPlacement` : origine 0,5/1,
 *      pieds à `y + AVATAR_HITBOX_DEPTH_TILES/2`). Viser le torse d'un zombie
 *      (emprise 1,5 tuile de haut) désigne donc un point de sol ~0,56 tuile AU NORD
 *      de sa position logique. Signature : erreur MAXIMALE sur les cibles à l'EST/
 *      OUEST (le décalage est perpendiculaire à la visée), faible au nord/sud.
 *   2. LE TÉLÉGRAPHE EST ÉCRASÉ EN Y (`GROUND_SQUASH = 0.55`, attack-fx.ts), la zone
 *      de la sim est un vrai secteur circulaire. Signature : la zone dessinée est trop
 *      LARGE en angle sur les visées nord/sud (une cible de flanc paraît dedans sans
 *      y être) et trop COURTE en portée dans le même axe.
 *   3. LA CIBLE EST UN POINT (`inStrikeZone` teste `target.x/target.y`), pas un corps.
 *      Signature : indépendante de la direction, concentrée sur le BORD de la zone.
 *
 * MÉTHODE — la géométrie est modélisée ici (pas d'accès à `inStrikeZone`, privé), mais
 * elle est CONTRÔLÉE contre la vraie sim en fin de rapport : on rejoue 864 coups dans
 * `step()` et l'on compare verdict à verdict. Le premier jet de cet instrument a échoué
 * ce contrôle — il ignorait le PAS D'ARMEMENT (`lunge`), qui allonge la portée utile des
 * poings de 1,1 à ~1,45 tuile. Un modèle non contrôlé aurait chiffré la mauvaise chose.
 *
 * La cible est IMMOBILE : on isole la géométrie du mouvement pendant le wind-up
 * (l'esquive par positionnement, elle, est VOULUE — spec combat R4).
 */
import {
  BALANCE,
  COMBAT,
  TERRAIN_GRASS,
  WEAPON_PROFILES,
  createEmptyMap,
  createSim,
  drainEvents,
  spawnEntity,
  step,
  type SimState,
  type Strike,
} from '../packages/sim/src/index'

/** L'écrasement du télégraphe au sol (attack-fx.ts). C'est la valeur qu'on juge. */
const GROUND_SQUASH = 0.55

/**
 * L'EMPRISE D'ART des cibles qu'on mesure (snapshot-view.ts `ACTOR_FOOTPRINTS`), en
 * tuiles. C'est elle qui décide de la hauteur du billboard, donc du décalage de visée.
 */
const CIBLES = [
  { nom: 'zombie/cendreux', w: 0.75, h: 1.5 },
  { nom: 'loup', w: 1.5, h: 1.15 },
  { nom: 'sanglier', w: 1.5, h: 1.0 },
] as const

const ARMES = ['unarmed', 'crude_spear', 'spear', 'iron_axe'] as const

/** Le RAYON du corps d'une cible, côté sim : `AVATAR_HITBOX_DEPTH_TILES` est la mesure
 *  nord-sud, la plus PETITE des deux — la garde la plus prudente pour « les corps se
 *  touchent ». (La largeur est-ouest, 0,75, donnerait un chiffre deux fois plus gros.) */
const RAYON_CORPS = BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2

/** Le côté du pas d'armement d'une entité fraîche (`startAttack` : `swingSide`
 *  indéfini → −1). L'instrument joue toujours le premier coup. */
const SIDE: 1 | -1 = -1

/**
 * LA ZONE RÉELLE, PAS D'ARMEMENT COMPRIS. `advanceLunge` déplace le corps de
 * `lunge` tuiles pendant le wind-up, en déviant de ±25° si l'arme tresse (les
 * poings) ; `resolveStrike` part ensuite de la position d'ARRIVÉE, mais suivant la
 * direction VISÉE (jamais celle du pas). C'est ce qui donne aux poings 1,45 tuile de
 * portée utile là où leur `range` en dit 1,1 — et c'est exactement ce que le premier
 * jet de cet instrument avait raté.
 */
function apexAprèsPas(s: Strike, ax: number, ay: number, dx: number, dy: number): { x: number; y: number } {
  if (s.lunge <= 0) return { x: ax, y: ay }
  let px = dx
  let py = dy
  if (s.weave) {
    const sn = SIDE * COMBAT.WEAVE_SIN
    const cs = COMBAT.WEAVE_COS
    px = dx * cs - dy * sn
    py = dx * sn + dy * cs
  }
  return { x: ax + px * s.lunge, y: ay + py * s.lunge }
}

/** La zone de la sim, telle que `inStrikeZone` la teste (apex = position d'arrivée). */
function dansZone(s: Strike, ax: number, ay: number, dx: number, dy: number, tx: number, ty: number): boolean {
  const a = apexAprèsPas(s, ax, ay, dx, dy)
  if (s.shape === 'disc') {
    const ox = tx - (a.x + dx * s.range)
    const oy = ty - (a.y + dy * s.range)
    return ox * ox + oy * oy <= s.radius * s.radius
  }
  const rx = tx - a.x
  const ry = ty - a.y
  const d2 = rx * rx + ry * ry
  if (d2 > s.range * s.range || d2 === 0) return false
  if (s.arcCos <= -1) return true
  return (rx * dx + ry * dy) / Math.sqrt(d2) >= s.arcCos
}

/**
 * LA ZONE TELLE QU'ELLE EST DESSINÉE — même math qu'`attack-fx.paintZone`. Le
 * télégraphe est peint aux pieds du sprite, donc à la position COURANTE : il porte le
 * pas d'armement à mesure qu'il se fait, ce qu'on reproduit en prenant le même apex.
 * L'écrasement s'applique en pixels, mais px = tuile × 16 dans les DEUX axes (carte
 * plate, `warp.unproject` identité) : le facteur vaut donc tel quel en tuiles.
 *
 * Un point est dans le polygone écrasé ssi le point DÉ-écrasé est dans le vrai cône.
 */
function dansZoneDessinée(s: Strike, ax: number, ay: number, dx: number, dy: number, tx: number, ty: number): boolean {
  const a = apexAprèsPas(s, ax, ay, dx, dy)
  const rx = tx - a.x
  const ry = (ty - a.y) / GROUND_SQUASH
  if (s.shape === 'disc') {
    const ox = rx - dx * s.range
    const oy = ry - dy * s.range
    return ox * ox + oy * oy <= s.radius * s.radius
  }
  const d2 = rx * rx + ry * ry
  if (d2 > s.range * s.range || d2 === 0) return false
  if (s.arcCos <= -1) return true
  return (rx * dx + ry * dy) / Math.sqrt(d2) >= s.arcCos
}

/** Le CORPS de la cible chevauche-t-il la zone (et non son seul centre) ? Échantillonné
 *  sur le disque de rayon `RAYON_CORPS` — l'instrument n'a pas à être analytique. */
function corpsChevauche(s: Strike, ax: number, ay: number, dx: number, dy: number, tx: number, ty: number): boolean {
  if (dansZone(s, ax, ay, dx, dy, tx, ty)) return true
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    if (dansZone(s, ax, ay, dx, dy, tx + Math.cos(a) * RAYON_CORPS, ty + Math.sin(a) * RAYON_CORPS)) return true
  }
  return false
}

/**
 * LE POINT DE SOL QUE DÉSIGNE UN CURSEUR POSÉ SUR LE TORSE. Reproduit la chaîne du
 * client : `actorPlacement` pose les pieds à `y + depth/2`, le sprite monte de `h`
 * tuiles au-dessus, et `pointerToWorld` (warp identité) relit le pixel comme un
 * point de SOL. Le joueur vise le corps ; la sim reçoit une direction vers le sol.
 */
function pointVisé(cx: number, cy: number, h: number, fraction: number): { x: number; y: number } {
  return { x: cx, y: cy + BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2 - h * fraction }
}

function norm(x: number, y: number): { x: number; y: number } {
  const l = Math.sqrt(x * x + y * y) || 1
  return { x: x / l, y: y / l }
}

/** Un banc NEUF par coup : le pas d'armement déplace l'attaquant. */
function banc(arme: (typeof ARMES)[number]): SimState {
  const sim = createSim(5, { map: createEmptyMap(40, 40, TERRAIN_GRASS) })
  const a = spawnEntity(sim, 20, 20)
  const c = spawnEntity(sim, 22, 20)
  const att = sim.entities.find((e) => e.id === a)!
  att.stamina = 100
  if (arme !== 'unarmed') {
    att.inventory[0] = { item: arme as never, count: 1 }
    att.activeSlot = 0
  }
  sim.entities.find((e) => e.id === c)!.hp = 1000
  drainEvents(sim)
  return sim
}

/** Un coup JOUÉ dans la vraie sim : rend `true` si la cible a encaissé. */
function coupJoué(arme: (typeof ARMES)[number], cx: number, cy: number, dx: number, dy: number): boolean {
  const sim = banc(arme)
  const attaquant = sim.entities[0]!
  const cible = sim.entities[1]!
  cible.x = cx
  cible.y = cy
  const hpAvant = cible.hp
  step(sim, [{ entityId: attaquant.id, dx: 0, dy: 0, action: { type: 'attack', dx, dy } }])
  for (let t = 0; t < WEAPON_PROFILES[arme].light.windupTicks + 2; t++) step(sim, [])
  const après = sim.entities.find((e) => e.id === cible.id)
  return après === undefined || après.hp < hpAvant
}

const PAS = 0.05
const RAYON_GRILLE = 4.0
const AX = 20
const AY = 20

const pct = (n: number, d: number) => (d === 0 ? '   — ' : `${((100 * n) / d).toFixed(1).padStart(5)}%`)

console.log('MESURE — pourquoi le coup ne connecte pas (cible IMMOBILE, géométrie contrôlée sur la vraie sim)\n')
console.log(`Rayon de corps : ${RAYON_CORPS} tuile · écrasement du télégraphe : ${GROUND_SQUASH} · grille ${PAS} tuile`)

// ═══════════════════════════════════════════════════════════════════════════════
// CAUSE 1 — LA VISÉE. Combien de cibles ATTEIGNABLES (bien visées, elles seraient
// touchées) sont ratées parce que le curseur était sur le torse et non sur les pieds ?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\n╔══ CAUSE 1 — LE CURSEUR VISE LE TORSE, LA SIM REÇOIT UNE DIRECTION VERS LE SOL ══')
console.log('   « atteignable » = la visée droit sur le centre logique toucherait. On mesure la part')
console.log('   de ces cibles que la visée RÉELLE (curseur au milieu du billboard) fait RATER.\n')
for (const cible of CIBLES) {
  console.log(`  ${cible.nom} (billboard ${cible.w}×${cible.h} tuiles — décalage de visée ${(cible.h / 2 - BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2).toFixed(2)} tuile vers le nord)`)
  for (const arme of ARMES) {
    const s = WEAPON_PROFILES[arme].light
    let visés = 0
    let ratés = 0
    let visésEO = 0
    let ratésEO = 0
    let visésNS = 0
    let ratésNS = 0
    let écartMax = 0
    for (let ox = -RAYON_GRILLE; ox <= RAYON_GRILLE + 1e-9; ox += PAS) {
      for (let oy = -RAYON_GRILLE; oy <= RAYON_GRILLE + 1e-9; oy += PAS) {
        const d = Math.sqrt(ox * ox + oy * oy)
        if (d < 0.35 || d > RAYON_GRILLE) continue
        const cx = AX + ox
        const cy = AY + oy
        const idéal = norm(ox, oy)
        if (!dansZone(s, AX, AY, idéal.x, idéal.y, cx, cy)) continue
        visés += 1
        const eo = Math.abs(ox) >= Math.abs(oy)
        if (eo) visésEO += 1
        else visésNS += 1
        const p = pointVisé(cx, cy, cible.h, 0.5)
        const réel = norm(p.x - AX, p.y - AY)
        if (!dansZone(s, AX, AY, réel.x, réel.y, cx, cy)) {
          ratés += 1
          if (eo) ratésEO += 1
          else ratésNS += 1
          const cos = Math.max(-1, Math.min(1, idéal.x * réel.x + idéal.y * réel.y))
          écartMax = Math.max(écartMax, (Math.acos(cos) * 180) / Math.PI)
        }
      }
    }
    console.log(
      `      ${arme.padEnd(12)} ratés ${pct(ratés, visés)}   (est/ouest ${pct(ratésEO, visésEO)} · nord/sud ${pct(ratésNS, visésNS)})   dévoiement max ${écartMax.toFixed(0)}°`,
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAUSE 2 — LE TÉLÉGRAPHE. Pour une visée DONNÉE (l'arc est figé pendant le wind-up),
// quelle part du plan est dessinée comme frappée sans l'être — et l'inverse ?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\n╔══ CAUSE 2 — LE TÉLÉGRAPHE DESSINÉ N’EST PAS LA ZONE FRAPPÉE ══')
console.log('   Visée FIGÉE (comme pendant un wind-up), on balaie tout le plan autour du joueur.')
console.log('   « ment en trop » = dessiné frappé, mais épargné. « ment en moins » = frappé sans être dessiné.\n')
for (const arme of ARMES) {
  const s = WEAPON_PROFILES[arme].light
  console.log(`  ${arme} (portée ${s.range}, demi-arc ${((Math.acos(Math.max(-1, s.arcCos)) * 180) / Math.PI).toFixed(0)}°)`)
  for (const [nom, dir] of [
    ['vers l’est ', { x: 1, y: 0 }],
    ['vers le nord', { x: 0, y: -1 }],
    ['en diagonale', norm(1, -1)],
  ] as const) {
    let trop = 0
    let moins = 0
    let zone = 0
    let dessinée = 0
    for (let ox = -RAYON_GRILLE; ox <= RAYON_GRILLE + 1e-9; ox += PAS) {
      for (let oy = -RAYON_GRILLE; oy <= RAYON_GRILLE + 1e-9; oy += PAS) {
        const cx = AX + ox
        const cy = AY + oy
        const frappé = dansZone(s, AX, AY, dir.x, dir.y, cx, cy)
        const peint = dansZoneDessinée(s, AX, AY, dir.x, dir.y, cx, cy)
        if (frappé) zone += 1
        if (peint) dessinée += 1
        if (peint && !frappé) trop += 1
        if (frappé && !peint) moins += 1
      }
    }
    console.log(
      `      ${nom} : ment EN TROP sur ${pct(trop, dessinée)} de ce qu’il dessine · ment EN MOINS sur ${pct(moins, zone)} de ce qu’il frappe`,
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAUSE 3 — LE CORPS N'EST PAS UN POINT.
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\n╔══ CAUSE 3 — LA CIBLE EST TESTÉE COMME UN POINT, PAS COMME UN CORPS ══')
console.log(`   Part de l’anneau où un corps de rayon ${RAYON_CORPS} chevauche la zone sans que son centre y soit.\n`)
for (const arme of ARMES) {
  const s = WEAPON_PROFILES[arme].light
  let chevauche = 0
  let touche = 0
  let cellules = 0
  for (let ox = -RAYON_GRILLE; ox <= RAYON_GRILLE + 1e-9; ox += PAS) {
    for (let oy = -RAYON_GRILLE; oy <= RAYON_GRILLE + 1e-9; oy += PAS) {
      const d = Math.sqrt(ox * ox + oy * oy)
      if (d < 0.35 || d > RAYON_GRILLE) continue
      cellules += 1
      const cx = AX + ox
      const cy = AY + oy
      const n = norm(ox, oy)
      const t = dansZone(s, AX, AY, n.x, n.y, cx, cy)
      if (t) touche += 1
      else if (corpsChevauche(s, AX, AY, n.x, n.y, cx, cy)) chevauche += 1
    }
  }
  console.log(
    `      ${arme.padEnd(12)} ${pct(chevauche, cellules)} de l’anneau — soit ${pct(chevauche, touche)} de plus que ce qui touche aujourd’hui`,
  )
}

// ═══ CONTRÔLE : la géométrie modélisée dit-elle la même chose que la VRAIE sim ? ═══
// Un instrument qui remodélise la règle qu'il mesure doit prouver qu'il ne l'a pas
// trahie. Ce contrôle a MORDU au premier jet (16 désaccords : le pas d'armement).
console.log('\n\n╔══ CONTRÔLE — la géométrie modélisée contre la VRAIE sim (step) ══')
let accords = 0
let désaccords = 0
for (const arme of ARMES) {
  const s = WEAPON_PROFILES[arme].light
  for (let a = 0; a < 24; a++) {
    for (const d of [0.5, 0.9, 1.2, 1.45, 1.7, 2.05, 2.16, 2.45, 2.9]) {
      const ang = (a / 24) * Math.PI * 2
      const ox = Math.cos(ang) * d
      const oy = Math.sin(ang) * d
      const n = norm(ox, oy)
      const prédit = dansZone(s, AX, AY, n.x, n.y, AX + ox, AY + oy)
      const joué = coupJoué(arme, AX + ox, AY + oy, n.x, n.y)
      if (prédit === joué) accords += 1
      else {
        désaccords += 1
        if (désaccords <= 6) console.log(`     ✗ ${arme} d=${d} angle=${((ang * 180) / Math.PI).toFixed(0)}° : modèle ${prédit}, sim ${joué}`)
      }
    }
  }
}
console.log(
  `     ${accords} accords, ${désaccords} désaccords` +
    (désaccords === 0 ? ' — le modèle dit la vérité de la sim.' : ' — ATTENTION : le modèle diverge, les chiffres ci-dessus sont suspects.'),
)
