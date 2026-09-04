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
import { fbm2 } from './noise'
import { CREUX, lireLeChampGraine } from './racine-relief'
import { creuserLeCoeur } from './zonegen-water'
import { meandrer, peindreCoursDEau, type Point } from './zonegen-trace'
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
  /** Rayon d'un ru de zone, en tuiles (1,2 → 3 tuiles de large) : un ru n'est pas un canal. */
  RU_RAYON: 1.2,
  /** Son écart à la ligne de drainage, en tuiles : de quoi ne pas suivre la grille au cordeau. */
  RU_MEANDRE: 3.5,
  /** Marge d'exclusion autour de TOUT seuil, en tuiles (Manhattan) — A16, généralisé. */
  MARGE_SEUIL: 84,

  // ══ LA FORME DE L'EAU DORMANTE — plus des blocs de motif (2026-08-30) ═══════════════════
  //
  // Les mares se peignaient CELLULE PAR CELLULE : un « T » de carrés de 8×8, avec sa frange de
  // marais en carrés autour. Alexis l'a vu sur la carte rendue (« les mares sont toujours
  // carrées ou je me trompe ? ») — la Racine avait reçu la nouvelle grammaire, pas les zones.

  /** La part de l'emprise que la mare remplit vraiment : ce qui manque, ce sont les COINS. */
  REMPLISSAGE: 0.86,
  /** L'échelle du grain de rive, en tuiles — la taille des dentelures de la berge. */
  RIVE_ECHELLE: 26,
  /** L'amplitude de ce grain, en unités d'altitude : petit devant la profondeur des cuvettes,
   *  sinon il ferait des confettis au lieu d'une rive. */
  RIVE_GRAIN: 0.012,
  /** Rayon de la frange de marais autour de la mare, en tuiles. */
  MARAIS_RAYON: 4,
  /** L'échelle du bruit qui troue cette frange : elle respire, elle ne borde pas. */
  MARAIS_ECHELLE: 18,
  /** Sous cette valeur du bruit, la tuile devient marais. Bas = parcimonie. */
  MARAIS_COUVERTURE: 0.52,
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
): number[] {
  /** Les tuiles des MARES et du grand lac — l'eau plate des zones, rendue aux terrasses. */
  const lacs: number[] = []
  if (!socle) return lacs
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

  for (const z of g.zones) {
    if (z.id === g.racine) continue
    const regime = EAUX_ZONES.PAR_ZONE[z.def.slug]
    if (!regime) continue
    /** Le sel du grain de rive — propre à la zone : deux mares voisines ne se copient pas. */
    const selRive = (g.seed ^ (z.id * 0x9e3779b1) ^ 0x52495645) | 0 /* 'RIVE' */

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
      // ═══ LA PEINTURE — À LA TUILE, sur l'iso-contour du niveau (2026-08-30) ═══
      //
      // *(Décision d'Alexis : plus d'angles droits pour l'eau — et sa relance, « les mares sont
      // toujours carrées ou je me trompe ? ». Il ne se trompait pas : la Racine avait reçu la
      // nouvelle grammaire, les AUTRES ZONES non. Une mare de la Tourbière était un « T » de
      // blocs de 8×8, sa frange de marais un autre « T » de blocs autour.)*
      //
      // Même recette que les lacs de la Racine (`placerLacs`) : on trie les tuiles de l'emprise
      // par altitude lue en BILINÉAIRE plus un grain de bord, on garde les `REMPLISSAGE` plus
      // basses, et l'on inonde en 4-connexité depuis le point bas. Ce qui manque, ce sont les
      // COINS — la différence entre le polygone en escalier et la forme molle.
      for (const k of bassin) pris[k] = 1
      const champDe = (x: number, y: number): number => lireLeChampGraine(
        socle, socle.altLarge, x, y,
        (fbm2(x, y, EAUX_ZONES.RIVE_ECHELLE, selRive) - 0.5) * EAUX_ZONES.RIVE_GRAIN,
      )
      // Même élargissement d'un anneau que pour les lacs de la Racine : sans lui, l'iso-ligne
      // est clippée au bord des cellules et la rive garde les angles droits de la grille.
      const dansEmprise = new Set(bassin)
      const emprise = bassin.slice()
      for (const k of bassin) {
        const kx = k % socle.cols
        const ky = (k - kx) / socle.cols
        for (const v of [
          kx > 0 ? k - 1 : -1, kx + 1 < socle.cols ? k + 1 : -1,
          ky > 0 ? k - socle.cols : -1, ky + 1 < socle.rows ? k + socle.cols : -1,
        ]) {
          if (v < 0 || dansEmprise.has(v) || duPays[v] !== 1 || pris[v] === 1) continue
          dansEmprise.add(v)
          emprise.push(v)
        }
      }
      const tuilesEmprise: number[] = []
      for (const k of emprise) {
        const kx = k % socle.cols
        const ky = (k - kx) / socle.cols
        for (let dy = 0; dy < M; dy++) {
          const yy = ky * M + dy
          if (yy >= height) break
          for (let dx = 0; dx < M; dx++) {
            const xx = kx * M + dx
            if (xx >= width) break
            if (peignable(terrain, zone, yy * width + xx, z.id)) tuilesEmprise.push(yy * width + xx)
          }
        }
      }
      const valeurs = new Map<number, number>()
      for (const j of tuilesEmprise) valeurs.set(j, champDe(j % width, (j - (j % width)) / width))
      tuilesEmprise.sort((a, b) => (valeurs.get(a)! - valeurs.get(b)!) || (a - b))
      const eligible = new Set<number>()
      const cible = Math.round(bassin.length * M * M * EAUX_ZONES.REMPLISSAGE)
      for (let t = 0; t < cible && t < tuilesEmprise.length; t++) {
        eligible.add(tuilesEmprise[t]!)
      }
      const kx0 = plusBas % socle.cols
      const depart = (((plusBas - kx0) / socle.cols) * M + M / 2) * width + kx0 * M + M / 2
      const dansLEau = new Set<number>()
      if (eligible.size > 0) {
        eligible.add(depart) // le point bas est dans sa mare, quoi qu'en dise le quantile
        const file = [depart]
        dansLEau.add(depart)
        for (let t = 0; t < file.length; t++) {
          const i = file[t]!
          const ix = i % width
          const iy = (i - ix) / width
          terrain[i] = TERRAIN_SHALLOW_WATER
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = ix + dx
            const ny = iy + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const j = ny * width + nx
            if (dansLEau.has(j) || !eligible.has(j)) continue
            dansLEau.add(j)
            file.push(j)
          }
        }
      }
      for (const i of dansLEau) lacs.push(i)
      // LE CŒUR du grand lac : les tuiles à `BERGE` pas ou plus de la rive — l'anneau de R45
      // tient donc sur une forme quelconque, exactement comme pour les lacs de la Racine.
      if (grand && dansLEau.size > 0) creuserLeCoeur(terrain, [...dansLEau], dansLEau, width)
      // LA FRANGE DE MARAIS — dérivée de l'EAU, plus des cellules : l'anneau de tuiles à
      // `MARAIS_RAYON` de la mare, gaté par un bruit pour qu'il respire au lieu de border.
      for (const i of dansLEau) {
        const ix = i % width
        const iy = (i - ix) / width
        for (let dy = -EAUX_ZONES.MARAIS_RAYON; dy <= EAUX_ZONES.MARAIS_RAYON; dy++) {
          for (let dx = -EAUX_ZONES.MARAIS_RAYON; dx <= EAUX_ZONES.MARAIS_RAYON; dx++) {
            const nx = ix + dx
            const ny = iy + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const j = ny * width + nx
            if (dansLEau.has(j) || !peignable(terrain, zone, j, z.id)) continue
            if (fbm2(nx, ny, EAUX_ZONES.MARAIS_ECHELLE, selRive ^ 0x4d415241 /* 'MARA' */) > EAUX_ZONES.MARAIS_COUVERTURE) continue
            terrain[j] = TERRAIN_MARSH
          }
        }
      }
    }

    // ── LES RUS : le drainage rendu visible ────────────────────────────────
    //
    // Un ru part d'une cellule à fort flux et SUIT les récepteurs D8 du socle — le chemin que
    // l'eau prend vraiment — jusqu'à une eau, au bord du pays, ou à bout de course. Deux rus qui
    // se rejoignent partagent leur aval : la CONFLUENCE émerge, on ne la dessine pas.
    //
    // ⚠ LE TRACÉ EST UNE COURBE depuis le 2026-08-30 (R32 ne gouverne plus l'eau) : la ligne de
    // drainage est écartée d'un bruit, lissée par Chaikin, estampée au disque — la MÊME grammaire
    // que la rivière et que les rus de la Racine (`zonegen-trace.ts`). Avant, c'était une
    // polyligne de Manhattan de demi-largeur 1 : sur la carte rendue, la Tourbière portait une
    // barre verticale de largeur constante et des escaliers à angle droit, au milieu de mares
    // qui, elles, étaient déjà molles.
    if (regime.rus !== undefined && regime.rus > 0) {
      const poser = (x: number, y: number): void => {
        if (x < 0 || y < 0 || x >= width || y >= height) return
        const i = y * width + x
        if (peignable(terrain, zone, i, z.id)) terrain[i] = TERRAIN_SHALLOW_WATER
      }
      const centrePoint = (k: number): Point => {
        const kx = k % socle.cols
        return {
          x: kx * M + M / 2,
          y: ((k - kx) / socle.cols) * M + M / 2,
          r: EAUX_ZONES.RU_RAYON,
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
        const chemin: number[] = [source]
        let k = source
        for (let pas = 0; pas < EAUX_ZONES.RU_MAX_CELLULES; pas++) {
          const r = socle.recepteur[k]!
          if (r < 0) break
          if (duPays[r] !== 1) break //   le ru quitterait le pays : il s'enfonce avant
          chemin.push(r)
          enEau[k] = 1
          if (enEau[r] === 1) break //    la confluence : l'aval est déjà peint
          if (pris[r] === 1) break //     il se jette dans une mare
          k = r
        }
        if (chemin.length < 2) continue
        peindreCoursDEau(
          meandrer(chemin.map(centrePoint), EAUX_ZONES.RU_MEANDRE, (selRive ^ source) | 0),
          2, poser,
        )
      }
    }
  }

  // ── R45, CONSTATÉ : aucun profond au contact d'une terre marchable sèche ──
  assainirLeProfondHorsRacine(terrain, zone, g.racine, width, height)
  return lacs
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
