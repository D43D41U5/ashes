/**
 * ═══ LE SOCLE — le Creux devenu monde (spec `stratigraphie.md`, couche I) ═══
 *
 * Le micro-relief muet de `racine-relief.ts` cessait au rectangle de la Racine : 11 zones sur 12
 * n'avaient AUCUNE variable d'ordre — le « patchwork sans logique » que le grief du 2026-07-29 a
 * fait réparer… dans 1/12 de la carte. Le socle étend le champ à la carte entière, et il ne se
 * contente pas d'un bruit : il donne au pays un PASSÉ PHYSIQUE.
 *
 *   uplift (le squelette de zones devient une carte de soulèvement : Racine basse, ceinture
 *   moyenne, marges hautes, massifs inter-régions) → érosion fluviale (stream power, solveur
 *   implicite à la Braun & Willett, m = ½, n = 1 — la mise à jour se réduit à `+ * /` et
 *   `Math.sqrt`) → drainage (D8, dépressions résolues par Priority-Flood+ε, accumulation de
 *   flux) → des VALLÉES DENDRITIQUES, des bassins versants, des cols réels — ce que le bruit
 *   ne sait pas fabriquer, parce que le bruit n'a pas d'histoire.
 *
 * ═══ LA RACINE EST LE NIVEAU DE BASE, ET ELLE GARDE SON CHAMP ═══
 *
 * Les cellules de la Racine gardent le champ HISTORIQUE (`ondulation`/`grain` de
 * `racine-relief.ts`, mêmes sels, mêmes valeurs par tuile) et sont ÉPINGLÉES pendant l'érosion :
 * le T0 réglé à l'œil en juillet — cuvettes, rivière, végétation ordonnée — garde sa géographie.
 * Deux tirages INDEXÉS SUR LA GRILLE glissent, et c'est assumé : la lame des lacs
 * (`hash2(graine, …)` dans `placerLacs`) et l'ancrage des carrés de crête changent d'alignement
 * avec la grille devenue globale — mêmes cuvettes, lame re-tirée ; les invariants (R45, A14)
 * tiennent par construction. Pour la physique, ces cellules sont le fond de la vallée : tout le
 * reste du monde s'érode VERS elles. « L'eau descend vers le feu » devient un fait de terrain.
 *
 * ═══ MUET, LOCAL, DÉTERMINISTE ═══
 *
 * Comme le Creux qu'il généralise : jamais rendu, jamais dans `WorldMap` ni `SimState`, il ne
 * vit que le temps de la génération. Tous les ex æquo (tas de Priority-Flood, choix du récepteur
 * D8) se départagent PAR INDEX DE CELLULE — jamais par ordre d'insertion. Opérations : `+ - * /`,
 * `Math.sqrt`, comparaisons. Sels dédiés ('UPLF') — aucun flux partagé (la leçon RNG).
 */
import { fbm2 } from './noise'
import type { GrapheZones } from './zonegraph'
import { CREUX, type Creux, seuilParQuantile } from './racine-relief'

export const SOCLE = {
  /** L'altitude de base par TIER de zone — le squelette devient une carte d'uplift. */
  ALT_TIER: [0.16, 0.48, 0.74] as const,
  /** Les massifs inter-régions (le « vide » de roche) : le haut pays entre les pièces. */
  ALT_VIDE: 0.92,
  /** Le rebord du monde — plus haut que tout, pour que rien ne draine vers le dehors. */
  ALT_BORD: 1.0,
  /** Portée du fondu vers le rebord, en cellules de motif. */
  BORD_PORTEE: 16,
  /** Amplitude du bruit d'uplift (±) — la variance DANS un tier, avant érosion. */
  RELIEF_AMP: 0.2,
  /** Échelle de ce bruit, en tuiles. Large : c'est de la tectonique, pas du grain. */
  RELIEF_ECHELLE: 420,
  /** Le plancher et l'amplitude du champ de la Racine — l'affine qui cale le champ HISTORIQUE
   *  (`ondulation`, valeurs inchangées) dans l'étage le plus bas de la physique. */
  RACINE_BASE: 0.06,
  RACINE_AMP: 0.2,
  /** Itérations d'érosion. Chacune : Priority-Flood + récepteurs + accumulation + solveur. */
  ITERATIONS: 60,
  /** K·dt du stream power — la vitesse à laquelle les vallées se creusent. */
  EROSION: 0.05,
  /** Ré-uplift par itération, en part de l'uplift initial : maintient les crêtes pendant que
   *  les vallées se creusent (sans lui, tout relaxe vers le niveau de base). */
  UPLIFT: 0.005,
  /** L'ε du Priority-Flood — la pente infime qui garantit que TOUT draine. */
  EPSILON: 1e-6,

  // ══ LA MOUILLE — l'humidité physique que `solDe` lit (couche II) ═══════════════════════════
  /** Poids du BAS (1 − altitude) : l'eau stagne en fond de vallée, même sans drainage fort. */
  MOUILLE_POIDS_BAS: 0.55,
  /** Poids de l'indice de drainage (√flux / pente) : les axes d'écoulement sont humides. */
  MOUILLE_POIDS_TWI: 0.45,
  /** L'ε de la pente du TWI — évite la division par zéro sur un plat. */
  MOUILLE_PENTE_EPS: 0.02,
  /** Amplitude du grain (± la moitié) — c'est lui qui empêche la BANDE, comme dans le Creux :
   *  l'ordre vient du champ, la texture vient du bruit. */
  MOUILLE_BRUIT: 0.34,
} as const

/**
 * Le socle EST un Creux (même interface, grille pleine carte, origine 0) — tout le code de la
 * Racine (lacs, rivière, humidité, végétation, crêtes) le lit tel quel — PLUS les champs que
 * la couche II lira : le drainage.
 */
export interface Socle extends Creux {
  /** L'accumulation de flux : combien de cellules amont drainent par ici (soi comprise). */
  flux: Float64Array
  /** Le récepteur D8 de chaque cellule (index), −1 au niveau de base. */
  recepteur: Int32Array
  /** La pente vers le récepteur (Δh / distance), 0 au niveau de base. */
  pente: Float64Array
  /** L'id de zone de chaque cellule (échantillon au centre du motif). */
  zoneCell: Int32Array
  /** La cellule est-elle dans le vide inter-régions ? */
  videCell: Uint8Array
  /**
   * LA MOUILLE — l'humidité PHYSIQUE, avant toute eau peinte : le bas du pays plus l'indice
   * topographique d'humidité (flux/pente — le TWI sans logarithme, monotone-équivalent), plus
   * le grain qui empêche la bande. C'est elle que `solDe` lit pour placer taches et accents
   * « selon l'humide » — l'eau réelle (couche II) ira ensuite exactement là où la mouille
   * l'annonce, et le sol l'aura précédée : deux lectures du même champ, jamais deux hasards.
   */
  mouille: Float64Array
}

/** Les champs historiques de la Racine — mêmes sels que `racine-relief.ts`, mêmes valeurs. */
function ondulation(x: number, y: number, seed: number): number {
  return fbm2(x, y, CREUX.ECHELLE_LARGE, (seed ^ 0x43524555) | 0 /* 'CREU' */)
}
function grainFin(x: number, y: number, seed: number): number {
  return fbm2(x, y, CREUX.ECHELLE_FINE, (seed ^ 0x66696e65) | 0 /* 'fine' */)
}
/** Le bruit d'uplift — sel dédié 'UPLF', jamais partagé. */
function bruitUplift(x: number, y: number, seed: number): number {
  return fbm2(x, y, SOCLE.RELIEF_ECHELLE, (seed ^ 0x55504c46) | 0 /* 'UPLF' */)
}

/** Les 8 voisins D8, ordre FIXE (le départage des ex æquo est l'ordre de ce tableau, puis
 *  l'index) : N, S, O, E d'abord (distance 1), diagonales ensuite (distance √2). */
const SQRT2 = Math.sqrt(2)

/**
 * ═══ LE TAS BINAIRE DU PRIORITY-FLOOD — (hauteur, index), ordre TOTAL ═══
 *
 * Le comparateur départage les hauteurs égales par l'index de cellule : deux exécutions, deux
 * moteurs JS, un seul ordre possible. C'est la condition de l'invariant n°2 sur un algorithme
 * à file de priorité — un tas départagé par ordre d'insertion serait un générateur de
 * divergences silencieuses.
 */
class TasPF {
  private h: Float64Array
  private idx: Int32Array
  private n = 0
  constructor(capacite: number) {
    this.h = new Float64Array(capacite)
    this.idx = new Int32Array(capacite)
  }
  get taille(): number { return this.n }
  vide(): void { this.n = 0 }
  private avant(a: number, b: number): boolean {
    const ha = this.h[a]!
    const hb = this.h[b]!
    return ha < hb || (ha === hb && this.idx[a]! < this.idx[b]!)
  }
  private echange(a: number, b: number): void {
    const th = this.h[a]!; this.h[a] = this.h[b]!; this.h[b] = th
    const ti = this.idx[a]!; this.idx[a] = this.idx[b]!; this.idx[b] = ti
  }
  pousse(hauteur: number, index: number): void {
    let i = this.n++
    this.h[i] = hauteur
    this.idx[i] = index
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.avant(i, p)) break
      this.echange(i, p)
      i = p
    }
  }
  /** Retire le plus bas. Rend l'index de cellule ; la hauteur se relit dans `filled`. */
  tire(): number {
    const res = this.idx[0]!
    this.n--
    if (this.n > 0) {
      this.h[0] = this.h[this.n]!
      this.idx[0] = this.idx[this.n]!
      let i = 0
      for (;;) {
        const g2 = 2 * i + 1
        const d = 2 * i + 2
        let m = i
        if (g2 < this.n && this.avant(g2, m)) m = g2
        if (d < this.n && this.avant(d, m)) m = d
        if (m === i) break
        this.echange(i, m)
        i = m
      }
    }
    return res
  }
}

/**
 * BÂTIT LE SOCLE — remplace `releverLeCreux` à la passe 1.45 de `generateZonedTerrain`.
 *
 * `zone` doit être rempli (passe 1) ; `videAt` dit si une tuile est dans le vide inter-régions
 * (le socle ne connaît pas les Blocs — il reçoit la question, pas la structure).
 */
export function batirLeSocle(
  g: GrapheZones,
  seed: number,
  zone: Int32Array,
  width: number,
  height: number,
  videAt: (x: number, y: number) => boolean,
): Socle | null {
  if (!g.zones[g.racine]?.rect) return null
  const M = CREUX.MOTIF
  const cols = Math.ceil(width / M)
  const rows = Math.ceil(height / M)
  const n = cols * rows

  // ── L'UPLIFT : le squelette devient une carte de soulèvement ──────────────
  const h = new Float64Array(n) //          la physique (la Racine y est l'affine de son champ)
  const uplift0 = new Float64Array(n) //    ce que le ré-uplift maintient
  const dedans = new Uint8Array(n) //       cellule de la Racine (le domaine des quantiles T0)
  const zoneCell = new Int32Array(n)
  const videCell = new Uint8Array(n)
  const racineRaw = new Float64Array(n) //  le champ HISTORIQUE de la Racine, brut (pour altLarge)

  for (let my = 0; my < rows; my++) {
    for (let mx = 0; mx < cols; mx++) {
      const k = my * cols + mx
      const tx = mx * M + M / 2
      const ty = my * M + M / 2
      const cx = Math.min(width - 1, tx)
      const cy = Math.min(height - 1, ty)
      const z = zone[cy * width + cx]!
      zoneCell[k] = z
      const vide = videAt(cx, cy)
      videCell[k] = vide ? 1 : 0

      const ond = ondulation(tx, ty, seed)
      racineRaw[k] = ond
      if (!vide && z === g.racine) {
        // LA RACINE : son champ de juillet, calé dans l'étage bas — et ÉPINGLÉ (niveau de base).
        dedans[k] = 1
        h[k] = SOCLE.RACINE_BASE + SOCLE.RACINE_AMP * ond
        uplift0[k] = 0
      } else if (vide) {
        h[k] = SOCLE.ALT_VIDE + (bruitUplift(tx, ty, seed) - 0.5) * SOCLE.RELIEF_AMP
        uplift0[k] = h[k]!
      } else {
        const tier = g.zones[z]?.def.tier ?? 2
        const base = SOCLE.ALT_TIER[Math.min(2, Math.max(0, tier))]!
        h[k] = base + (bruitUplift(tx, ty, seed) - 0.5) * 2 * SOCLE.RELIEF_AMP
        uplift0[k] = h[k]!
      }
      // Le rebord du monde se relève, pour que rien ne draine vers le dehors.
      const dBord = Math.min(mx, my, cols - 1 - mx, rows - 1 - my)
      if (dBord < SOCLE.BORD_PORTEE && dedans[k] === 0) {
        const t = 1 - dBord / SOCLE.BORD_PORTEE
        h[k] = h[k]! * (1 - t) + SOCLE.ALT_BORD * t
        uplift0[k] = h[k]!
      }
    }
  }

  // ── L'ÉROSION : Priority-Flood → récepteurs → accumulation → solveur implicite ──
  const filled = new Float64Array(n)
  const recepteur = new Int32Array(n)
  const flux = new Float64Array(n)
  const pente = new Float64Array(n)
  const ferme = new Uint8Array(n)
  const pile = new Int32Array(n) //     l'ordre de Braun-Willett : les bases d'abord, l'amont après
  const nDonneurs = new Int32Array(n)
  const debutDonneurs = new Int32Array(n + 1)
  const donneurs = new Int32Array(n)
  const curseur = new Int32Array(n)
  // Les 8 voisins, en tableaux PLATS (les boucles ci-dessous sont les plus chaudes de la
  // génération — la destructuration de tuples y coûtait la moitié du temps, mesuré).
  // Cardinaux d'abord — l'ordre du tableau EST le départage des ex æquo.
  const VDX = new Int32Array([0, 0, -1, 1, -1, 1, -1, 1])
  const VDY = new Int32Array([-1, 1, 0, 0, -1, -1, 1, 1])
  const VDIST = new Float64Array([1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2])
  const tas = new TasPF(n)

  const uneIteration = (eroder: boolean): void => {
    // 1. PRIORITY-FLOOD+ε depuis le niveau de base (les cellules de la Racine) : toute
    //    dépression se remplit à son col, toute cellule draine.
    ferme.fill(0)
    tas.vide()
    for (let k = 0; k < n; k++) {
      filled[k] = h[k]!
      if (dedans[k] === 1) {
        ferme[k] = 1
        tas.pousse(h[k]!, k)
      }
    }
    while (tas.taille > 0) {
      const k = tas.tire()
      const kx = k % cols
      const ky = (k - kx) / cols
      const fk = filled[k]! + SOCLE.EPSILON
      for (let d = 0; d < 8; d++) {
        const vx = kx + VDX[d]!
        const vy = ky + VDY[d]!
        if (vx < 0 || vy < 0 || vx >= cols || vy >= rows) continue
        const v = vy * cols + vx
        if (ferme[v] === 1) continue
        ferme[v] = 1
        const fv = h[v]! > fk ? h[v]! : fk
        filled[v] = fv
        tas.pousse(fv, v)
      }
    }

    // 2. LES RÉCEPTEURS D8, sur la surface remplie : le voisin de pente maximale. Strictement
    //    plus raide pour battre le tenant — à égalité, l'ordre du tableau puis l'index gagnent.
    for (let k = 0; k < n; k++) {
      recepteur[k] = -1
      pente[k] = 0
      if (dedans[k] === 1) continue // le niveau de base ne draine pas : il REÇOIT
      const kx = k % cols
      const ky = (k - kx) / cols
      const fk = filled[k]!
      let meilleure = 0
      for (let d = 0; d < 8; d++) {
        const vx = kx + VDX[d]!
        const vy = ky + VDY[d]!
        if (vx < 0 || vy < 0 || vx >= cols || vy >= rows) continue
        const v = vy * cols + vx
        const s = (fk - filled[v]!) / VDIST[d]!
        if (s > meilleure) {
          meilleure = s
          recepteur[k] = v
          pente[k] = s
        }
      }
    }

    // 3. LA PILE de Braun-Willett : les donneurs de chaque cellule, puis un parcours depuis les
    //    bases — l'aval TOUJOURS avant l'amont. Les donneurs se rangent par index croissant
    //    (une seule passe croissante), l'ordre est donc total.
    nDonneurs.fill(0)
    for (let k = 0; k < n; k++) if (recepteur[k]! >= 0) nDonneurs[recepteur[k]!]!++
    debutDonneurs[0] = 0
    for (let k = 0; k < n; k++) {
      debutDonneurs[k + 1] = debutDonneurs[k]! + nDonneurs[k]!
      curseur[k] = debutDonneurs[k]!
    }
    for (let k = 0; k < n; k++) {
      const r = recepteur[k]!
      if (r >= 0) donneurs[curseur[r]!++] = k
    }
    let sommet = 0
    for (let k = 0; k < n; k++) {
      if (recepteur[k]! === -1) pile[sommet++] = k
    }
    for (let t = 0; t < sommet && t < n; t++) {
      const k = pile[t]!
      for (let d = debutDonneurs[k]!; d < debutDonneurs[k]! + nDonneurs[k]!; d++) {
        pile[sommet++] = donneurs[d]!
      }
    }
    // TOUTE cellule est soit base, soit descendante d'une base (les chaînes de récepteurs
    // décroissent strictement en `filled`) : la pile DOIT être pleine. Un trou serait un
    // résultat faux mais reproductible — le pire genre de faux. On préfère tomber ici.
    if (sommet !== n) throw new Error(`socle : pile de drainage incomplète (${sommet}/${n})`)

    // 4. L'ACCUMULATION : chaque cellule apporte 1, l'amont se déverse dans l'aval.
    flux.fill(1)
    for (let t = n - 1; t >= 0; t--) {
      const k = pile[t]!
      const r = recepteur[k]!
      if (r >= 0) flux[r]! += flux[k]!
    }

    if (!eroder) return
    // 5. LE SOLVEUR IMPLICITE (Braun & Willett 2013, m = ½, n = 1) : l'aval d'abord — le
    //    récepteur a déjà sa hauteur NOUVELLE quand son donneur se résout. Inconditionnellement
    //    stable, et la mise à jour n'emploie que + * / et sqrt(flux).
    for (let t = 0; t < n; t++) {
      const k = pile[t]!
      const r = recepteur[k]!
      if (r < 0) continue
      const kx = k % cols
      const rx = r % cols
      const dist = (kx === rx || (k - kx) === (r - rx)) ? 1 : SQRT2
      const f = (SOCLE.EROSION * Math.sqrt(flux[k]!)) / dist
      h[k] = (h[k]! + uplift0[k]! * SOCLE.UPLIFT + f * h[r]!) / (1 + f)
    }
  }

  for (let it = 0; it < SOCLE.ITERATIONS; it++) uneIteration(true)
  uneIteration(false) // la passe finale : drainage et flux de la surface DÉFINITIVE

  // ── LES CHAMPS DU CREUX : la Racine garde ses valeurs de juillet AU BIT PRÈS ──
  let hMin = Infinity
  let hMax = -Infinity
  for (let k = 0; k < n; k++) {
    if (h[k]! < hMin) hMin = h[k]!
    if (h[k]! > hMax) hMax = h[k]!
  }
  const etendue = hMax - hMin || 1
  const alt = new Float64Array(n)
  const altLarge = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const kx = k % cols
    const ky = (k - kx) / cols
    const gr = grainFin(kx * M + M / 2, ky * M + M / 2, seed)
    if (dedans[k] === 1) {
      // Le contrat de compatibilité : mêmes valeurs que `releverLeCreux`, au bit près.
      altLarge[k] = racineRaw[k]!
      alt[k] = racineRaw[k]! * (1 - CREUX.POIDS_FINE) + gr * CREUX.POIDS_FINE
    } else {
      const norme = (h[k]! - hMin) / etendue
      altLarge[k] = norme
      alt[k] = norme * (1 - CREUX.POIDS_FINE) + gr * CREUX.POIDS_FINE
    }
  }

  const distEau = new Int32Array(n).fill(-1)
  const hum = new Float64Array(n)
  const seuilBassin = seuilParQuantile(altLarge, dedans, CREUX.PART_BASSIN, 0, 1)

  // ── LA MOUILLE : le bas + le drainage + le grain ──────────────────────────
  // `sqrt(flux)/(pente+ε)` est monotone en le TWI réel (`log(flux/pente)`) : même ordre, mêmes
  // quantiles, zéro logarithme (invariant n°2). Normalisé par bornes mesurées sur CE champ.
  const mouille = new Float64Array(n)
  let twiMax = 0
  for (let k = 0; k < n; k++) {
    const twi = Math.sqrt(flux[k]!) / (pente[k]! + SOCLE.MOUILLE_PENTE_EPS)
    mouille[k] = twi
    if (twi > twiMax) twiMax = twi
  }
  const twiEch = twiMax || 1
  for (let k = 0; k < n; k++) {
    const kx = k % cols
    const ky = (k - kx) / cols
    const gr = fbm2(kx * M + M / 2, ky * M + M / 2, CREUX.ECHELLE_BRUIT,
      (seed ^ 0x4d4f4941) | 0 /* 'MOIA' */) - 0.5
    const bas = 1 - altLarge[k]!
    mouille[k] = bas * SOCLE.MOUILLE_POIDS_BAS
      + Math.sqrt(mouille[k]! / twiEch) * SOCLE.MOUILLE_POIDS_TWI
      + gr * SOCLE.MOUILLE_BRUIT
  }

  return {
    mx0: 0, my0: 0, cols, rows, alt, altLarge, dedans, distEau, hum,
    // Seuils de végétation NEUTRES avant `composerLHumidite` : la prairie (≥ 2) et la lande
    // (< −1) sont inatteignables, le bosquet et la fleuraie comme avant.
    seuilBassin, seuilPrairie: 2, seuilBois: 1, seuilFleuraie: 0, seuilLande: -1, selGrain: 0,
    flux, recepteur, pente, zoneCell, videCell, mouille,
  }
}
