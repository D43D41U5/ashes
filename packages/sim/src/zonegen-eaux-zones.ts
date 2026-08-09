/**
 * ═══ LES EAUX DES ZONES — l'eau dérivée hors de la Racine (spec `stratigraphie.md` S-R6..S-R9) ═══
 *
 * Avant : la Tourbière et le Lac Mort POSAIENT leur eau par accent de palette — des confetti
 * tirés au bruit, sans cuvette, sans rive, sans exutoire (le Lac Mort n'avait pas de lac). La
 * couche II les dérive du SOCLE : une mare est une cuvette du champ d'altitude qu'on inonde,
 * un ru suit le drainage (les récepteurs D8), le lac du Lac Mort est LA grande cuvette de sa
 * zone. L'eau va où la physique la met — et comme `solDe` lit déjà la mouille, la roselière
 * l'ANNONCE : deux lectures du même champ, jamais deux hasards.
 *
 * QUI reçoit de l'eau — une décision de thème, consignée dans `EAUX_ZONES` :
 *   — la TOURBIÈRE : des mares-cuvettes et des rus (c'est une tourbière) ;
 *   — le LAC MORT : son lac, enfin — cœur profond (un mur, R5), rive de haut-fond, marais ;
 *   — la SYLVE : un ou deux ruisseaux de forêt (l'eau commande la faune : la Sylve gagne
 *     ses coins de chasse).
 *   Les HAUTEURS restent sèches (Alpages, Karst, Aiguilles, Gouffre — l'eau y est la promesse
 *   du Tarn et de la Cascade, pas un tapis) ; le Glacier et le Névé sont gelés ; le Brûlé et
 *   la Cendrière ont brûlé leur eau. La ligne « l'eau est le marqueur du bas et du vivant »
 *   tient — elle cesse juste d'être un privilège de la Racine.
 *
 * ═══ LES INVARIANTS TIENNENT PARTOUT ═══
 *
 *   — R45 : jamais de profond sans anneau de haut-fond marchable (point fixe, comme
 *     `assainirLeProfond`) ;
 *   — A16 : aucune eau aux abords d'un seuil — le masque couvre TOUS les seuils, pas
 *     seulement ceux de la Racine ;
 *   — R32 : tout est quantifié à la cellule de motif (8×8) — polygones rectilignes ;
 *   — l'eau ne traverse jamais une frontière de zone (le ru s'arrête au bord de son pays).
 *
 * Pur et déterministe : lectures du socle, hash positionnel, aucun flux partagé.
 */
import { TERRAINS, TERRAIN_DEEP_WATER, TERRAIN_MARSH, TERRAIN_SHALLOW_WATER } from './balance'
import { isWater } from './map'
import { CREUX } from './racine-relief'
import type { Socle } from './socle'
import type { GrapheZones } from './zonegraph'

/** Le réglage — calibré en REGARDANT une carte, comme les autres blocs du worldgen. */
export const EAUX_ZONES = {
  /** Ce que chaque zone reçoit. `mares` : nombre de cuvettes inondées visées ; `grandLac` :
   *  la zone reçoit SA grande cuvette (cœur profond) ; `rus` : nombre de fils de drainage
   *  peints depuis les cellules au plus fort flux. */
  PAR_ZONE: {
    tourbiere: { mares: 7, rus: 3 },
    // Le Lac Mort inonde plus large (partBassin propre) : son lac est SON identité — un fond
    // de vallée noyé serait une rivière de plus, pas le Lac Mort.
    lac_mort: { mares: 2, grandLac: true, rus: 2, partBassin: 0.2 },
    sylve: { rus: 2 },
  } as Record<string, { mares?: number; grandLac?: boolean; rus?: number; partBassin?: number }>,

  /**
   * LA PART DE BASSIN — la fraction des cellules de la zone assez basses pour porter l'eau
   * dormante. L'érosion du socle fait DRAINER le monde (les cuvettes fermées sont précisément
   * ce qu'elle supprime) : on ne peut plus inonder « sous une lame au-dessus d'un minimum » —
   * il n'y a presque plus de minimums. On revient donc au patron de la Racine : un QUANTILE
   * du champ réellement tiré (les fonds de vallée), dont les composantes connexes sont les
   * plans d'eau. La part est un contrat par zone, sur toute seed.
   */
  PART_BASSIN: 0.09,
  /** Plafond d'une mare, en cellules de motif (× 64 tuiles). 12 → ~30 tuiles de côté. */
  MARE_MAX_CELLULES: 12,
  /** Plafond du grand lac du Lac Mort, en cellules. 90 → ~5 800 tuiles, un vrai lac. */
  GRAND_LAC_MAX_CELLULES: 90,
  /** Un ru part d'une cellule du quantile de flux le plus fort de sa zone. */
  RU_PART_FLUX: 0.02,
  /** Longueur maximale d'un ru, en cellules — au-delà, il s'enfonce dans la tourbe. */
  RU_MAX_CELLULES: 60,
  /** Marge d'exclusion autour de TOUT seuil, en tuiles (Manhattan) — A16, généralisé. */
  MARGE_SEUIL: 84,
} as const

/** Une tuile que l'eau des zones a le droit de repeindre : marchable, sèche, du pays. */
function peignable(terrain: number[], zone: Int32Array, i: number, zid: number): boolean {
  if (zone[i] !== zid) return false
  const t = terrain[i]!
  if (isWater(t)) return false
  return TERRAINS[t]?.walkable === true
}

/**
 * PEINT LES EAUX DES ZONES — passe 1.52, après l'eau de la Racine, avant les seuils.
 * Ne touche JAMAIS la Racine (son eau a son propre chantier, réglé et gardé).
 */
export function peindreLesEauxDesZones(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  socle: Socle | null,
): void {
  if (!socle) return
  const M = CREUX.MOTIF
  const n = socle.cols * socle.rows

  // ── LE MASQUE DES SEUILS — tous les seuils, toutes les zones (A16 généralisé) ──
  const libre = new Uint8Array(n).fill(1)
  for (let ky = 0; ky < socle.rows; ky++) {
    for (let kx = 0; kx < socle.cols; kx++) {
      const tx = kx * M + M / 2
      const ty = ky * M + M / 2
      for (const s of g.seuils) {
        if (Math.abs(s.x - tx) + Math.abs(s.y - ty) < EAUX_ZONES.MARGE_SEUIL) {
          libre[ky * socle.cols + kx] = 0
          break
        }
      }
    }
  }

  /** Peint toutes les tuiles peignables d'une cellule. Rend le nombre de tuiles peintes. */
  const peindreCellule = (k: number, zid: number, t: number): number => {
    const kx = k % socle.cols
    const ky = (k - kx) / socle.cols
    let peintes = 0
    for (let dy = 0; dy < M; dy++) {
      const y = ky * M + dy
      if (y >= height) break
      for (let dx = 0; dx < M; dx++) {
        const x = kx * M + dx
        if (x >= width) break
        const i = y * width + x
        if (!peignable(terrain, zone, i, zid)) continue
        terrain[i] = t
        peintes++
      }
    }
    return peintes
  }

  for (const z of g.zones) {
    if (z.id === g.racine) continue
    const regime = EAUX_ZONES.PAR_ZONE[z.def.slug]
    if (!regime) continue

    // Les cellules du pays : dans la zone, hors vide, hors marge de seuil.
    const duPays = new Uint8Array(n)
    const cellules: number[] = []
    for (let k = 0; k < n; k++) {
      if (socle.zoneCell[k] === z.id && socle.videCell[k] === 0 && libre[k] === 1) {
        duPays[k] = 1
        cellules.push(k)
      }
    }
    if (cellules.length < 12) continue

    const pris = new Uint8Array(n)

    // ── LES MARES ET LE GRAND LAC : les fonds de vallée noyés (quantile de bassin) ──
    // Le seuil est un quantile PAR ZONE du champ réellement tiré (histogramme, patron
    // `seuilParQuantile` en version locale) ; les composantes connexes des cellules sous le
    // seuil sont les plans d'eau. La plus GRANDE composante du Lac Mort est LE lac.
    const actifs = new Uint8Array(n)
    for (const k of cellules) actifs[k] = 1
    const seuilBassin = ((): number => {
      const SEAUX = 1024
      const hist = new Int32Array(SEAUX)
      for (const k of cellules) {
        let b = Math.floor(socle.altLarge[k]! * SEAUX)
        if (b < 0) b = 0
        if (b >= SEAUX) b = SEAUX - 1
        hist[b]!++
      }
      const cible = Math.floor(cellules.length * (regime.partBassin ?? EAUX_ZONES.PART_BASSIN))
      let cum = 0
      for (let b = 0; b < SEAUX; b++) {
        cum += hist[b]!
        if (cum > cible) return (b + 1) / SEAUX
      }
      return 1
    })()

    // Les composantes des cellules basses, par BFS — graines balayées par index croissant.
    const bas = new Uint8Array(n)
    for (const k of cellules) if (socle.altLarge[k]! < seuilBassin) bas[k] = 1
    const composantes: number[][] = []
    const vuComp = new Uint8Array(n)
    for (const graine of cellules) {
      if (bas[graine] !== 1 || vuComp[graine] === 1) continue
      const comp: number[] = [graine]
      vuComp[graine] = 1
      for (let t = 0; t < comp.length; t++) {
        const k = comp[t]!
        const kx = k % socle.cols
        const ky = (k - kx) / socle.cols
        for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < socle.cols ? k + 1 : -1, ky > 0 ? k - socle.cols : -1, ky + 1 < socle.rows ? k + socle.cols : -1]) {
          if (v < 0 || vuComp[v] === 1 || bas[v] !== 1) continue
          vuComp[v] = 1
          comp.push(v)
        }
      }
      if (comp.length >= 2) composantes.push(comp) // une cellule seule est une flaque
    }
    // Les plus grandes d'abord (départage par index de première cellule — ordre total).
    composantes.sort((a, b) => (b.length - a.length) || (a[0]! - b[0]!))
    const nPlans = (regime.mares ?? 0) + (regime.grandLac ? 1 : 0)

    for (let m = 0; m < Math.min(nPlans, composantes.length); m++) {
      const comp = composantes[m]!
      // La PLUS GRANDE composante du Lac Mort est LE lac : plafond large, cœur profond.
      const grand = regime.grandLac === true && m === 0
      const plafond = grand ? EAUX_ZONES.GRAND_LAC_MAX_CELLULES : EAUX_ZONES.MARE_MAX_CELLULES
      // Le bassin retenu : une croissance CONNEXE depuis le point le plus bas de la composante
      // — la coupe brute au plafond aurait pu émietter le lac en flaques. Glouton : à chaque
      // pas, la cellule la plus basse au contact du bassin (altitude puis index — ordre total).
      let plusBas = comp[0]!
      for (const k of comp) {
        if (socle.altLarge[k]! < socle.altLarge[plusBas]! || (socle.altLarge[k] === socle.altLarge[plusBas] && k < plusBas)) plusBas = k
      }
      const dansComp = new Set(comp)
      const bassin: number[] = [plusBas]
      const dansBassin = new Set<number>([plusBas])
      while (bassin.length < plafond) {
        let meilleur = -1
        for (const k of bassin) {
          const kx = k % socle.cols
          const ky = (k - kx) / socle.cols
          for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < socle.cols ? k + 1 : -1, ky > 0 ? k - socle.cols : -1, ky + 1 < socle.rows ? k + socle.cols : -1]) {
            if (v < 0 || dansBassin.has(v) || !dansComp.has(v)) continue
            if (meilleur < 0 || socle.altLarge[v]! < socle.altLarge[meilleur]!
              || (socle.altLarge[v] === socle.altLarge[meilleur] && v < meilleur)) meilleur = v
          }
        }
        if (meilleur < 0) break // la composante est épuisée
        bassin.push(meilleur)
        dansBassin.add(meilleur)
      }
      // La peinture : le POURTOUR du bassin en haut-fond, l'INTÉRIEUR du grand lac en profond
      // (une mare n'a pas de cœur : trop petite pour porter un anneau honnête).
      const dedansBassin = new Set(bassin)
      for (const k of bassin) {
        pris[k] = 1
        const kx = k % socle.cols
        const ky = (k - kx) / socle.cols
        const interieur = grand
          && dedansBassin.has(k - 1) && dedansBassin.has(k + 1)
          && dedansBassin.has(k - socle.cols) && dedansBassin.has(k + socle.cols)
          && kx > 0 && ky > 0 && kx + 1 < socle.cols && ky + 1 < socle.rows
        peindreCellule(k, z.id, interieur ? TERRAIN_DEEP_WATER : TERRAIN_SHALLOW_WATER)
      }
      // La frange de marais : l'anneau de cellules autour du bassin.
      for (const k of bassin) {
        const kx = k % socle.cols
        for (const v of [k - 1, k + 1, k - socle.cols, k + socle.cols]) {
          const vx = v % socle.cols
          if (v < 0 || v >= n || Math.abs(vx - kx) > 1) continue
          if (dedansBassin.has(v) || duPays[v] !== 1 || pris[v] === 1) continue
          peindreCellule(v, z.id, TERRAIN_MARSH)
        }
      }
    }

    // ── LES RUS : le drainage rendu visible ────────────────────────────────
    // Un ru part d'une cellule à fort flux et SUIT les récepteurs D8 du socle — le chemin que
    // l'eau prend vraiment — jusqu'à une eau, au bord du pays, ou à bout de course. Il se
    // peint en POLYLIGNE Manhattan de demi-largeur 1 entre centres de cellules (la grammaire
    // des ruisseaux de la Racine — un ru n'est pas un canal de huit tuiles). Deux rus qui se
    // rejoignent partagent leur aval : la CONFLUENCE émerge, on ne la dessine pas.
    if (regime.rus !== undefined && regime.rus > 0) {
      /** Le tronçon Manhattan entre deux centres de cellules : x d'abord, y ensuite. */
      const peindreTroncon = (de: number, vers: number): void => {
        const dx0 = (de % socle.cols) * M + M / 2
        const dy0 = ((de - (de % socle.cols)) / socle.cols) * M + M / 2
        const vx0 = (vers % socle.cols) * M + M / 2
        const vy0 = ((vers - (vers % socle.cols)) / socle.cols) * M + M / 2
        const points: [number, number][] = []
        const pasX = dx0 <= vx0 ? 1 : -1
        for (let x = dx0; x !== vx0; x += pasX) points.push([x, dy0])
        const pasY = dy0 <= vy0 ? 1 : -1
        for (let y = dy0; y !== vy0 + pasY; y += pasY) points.push([vx0, y])
        for (const [cx, cy] of points) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = cx + dx
              const y = cy + dy
              if (x < 0 || y < 0 || x >= width || y >= height) continue
              const i = y * width + x
              if (peignable(terrain, zone, i, z.id)) terrain[i] = TERRAIN_SHALLOW_WATER
            }
          }
        }
      }
      const parFlux = cellules.slice().sort((a, b) => (socle.flux[b]! - socle.flux[a]!) || (a - b))
      const sources: number[] = []
      const nSources = Math.max(regime.rus, Math.floor(cellules.length * EAUX_ZONES.RU_PART_FLUX))
      for (const k of parFlux) {
        if (sources.length >= nSources) break
        if (pris[k] !== 1) sources.push(k)
      }
      const enEau = new Uint8Array(n)
      for (const source of sources) {
        let k = source
        for (let pas = 0; pas < EAUX_ZONES.RU_MAX_CELLULES; pas++) {
          const r = socle.recepteur[k]!
          if (r < 0) break
          if (duPays[r] !== 1) break //   le ru quitterait le pays : il s'enfonce avant
          peindreTroncon(k, r)
          enEau[k] = 1
          if (enEau[r] === 1) break //    la confluence : l'aval est déjà peint
          if (pris[r] === 1) break //     il se jette dans une mare
          k = r
        }
      }
    }
  }

  // ── R45, CONSTATÉ : aucun profond au contact d'une terre marchable sèche ──
  assainirLeProfondHorsRacine(terrain, zone, g.racine, width, height)
}

/**
 * L'ANNEAU DE R45, HORS RACINE — le même point fixe que `assainirLeProfond` : tout profond au
 * contact orthogonal d'une terre marchable sèche redevient haut-fond. Convertir produit de
 * l'eau, jamais de la terre — huit passes bornent le pire cas. `memeZone` est la variante
 * d'APRÈS murage (passe 3.5) : le déclencheur se limite aux voisins secs de la MÊME zone,
 * pour ne jamais rouvrir une frontière dont le profond est le mur légitime (R5).
 */
export function assainirLeProfondHorsRacine(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  memeZone = false,
): void {
  for (let passe = 0; passe < 8; passe++) {
    let corriges = 0
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        if (terrain[i] !== TERRAIN_DEEP_WATER || zone[i] === racineId) continue
        for (const j of [i - 1, i + 1, i - width, i + width]) {
          const t = terrain[j]!
          if (isWater(t)) continue
          if (TERRAINS[t]?.walkable !== true) continue
          if (memeZone && zone[j] !== zone[i]) continue
          terrain[i] = TERRAIN_SHALLOW_WATER
          corriges++
          break
        }
      }
    }
    if (corriges === 0) return
  }
}
