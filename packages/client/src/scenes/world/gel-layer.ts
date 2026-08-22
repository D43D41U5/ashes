/**
 * LE PAYSAGE GELÉ — la neige au sol (G7) et la glace (G5), peintes EN PAVÉS.
 *
 * La spec `gel.md` a été livrée côté sim et **rien ne se voyait** : un monde qui change
 * d'état sans qu'on le voie ne change pas d'état. Voici ce qui se voit.
 *
 * ═══ LE CLIENT NE DÉCIDE RIEN — IL RELIT ═══
 *
 * `neigeAuSol(state, tx, ty)` et `estGele(state, tx, ty)` sont les fonctions de `/sim`,
 * appelées telles quelles. Il n'y a PAS de seconde loi ici : pas de « et si la température
 * est basse alors », pas de mémoire client d'état de jeu. Ce que la glace autorise (marcher
 * dessus) et ce que cette couche peint sont **le même appel**. Le `SimState` que les fonctions
 * attendent est reconstitué par `etat-gel.ts`, qui nomme aussi les champs que le snapshot ne
 * porte pas (`brume` — un trou déclaré, pas un oubli).
 *
 * ═══ DES PAVÉS, PLUS UNE TRAME (2026-08-22) ═══
 *
 * La première écriture tramait la neige en cellules de 4 px à 91 % d'opacité — on voyait le
 * sol au travers, et elle n'avait pas d'épaisseur. Alexis : « complètement opaque », « un peu
 * de hauteur, comme entre prairie et flower_meadow ». La neige est donc un PAVÉ de
 * `render/paves.ts` (frange, liseré, arête, ombre portée), cuit par `render/manteau.ts` à la
 * même maille et dans les mêmes chunks de 16 tuiles que le sol (`pave-layer.ts`). La
 * continuité de `neigeAuSol` devient un seuil positionnel par tuile : des plaques à la tuile,
 * qui se ferment quand la neige monte et s'ouvrent quand elle fond.
 *
 * ═══ DEUX IMAGES PAR CHUNK, DE PART ET D'AUTRE DE LA BERGE ═══
 *
 * Le SOL du manteau (corps de neige, glace) se pose à +0,285 : au-dessus de l'eau (+0,25), des
 * poissons (+0,27) et des reflets (+0,28) — la glace cache ce qui passe dessous —, mais SOUS
 * le surplomb de la berge (+0,29) : la terre garde sa frange, son liseré, son ombre et son
 * ressac sur la glace — la côte et le lac gelé ont leur frontière (grief d'Alexis). Le
 * SURPLOMB du manteau (la frange de neige et son ombre sur le sol nu ou sur la glace) se pose
 * à +0,30, au-dessus de la berge : la neige est sur la terre, qui est sur l'eau.
 *
 * ═══ CE QUE ÇA COÛTE, ET COMMENT ON LE SAIT ═══
 *
 * `estGele` appelle `baselineTemperature`, qui appelle `isSheltered`, qui BALAIE
 * `state.structures` — O(structures) par tuile. Et `neigeAuSol` rembobine trois cycles. On
 * ne relit donc pas le monde à chaque image : chaque chunk porte une SIGNATURE (l'état de ses
 * 18 × 18 tuiles, marge comprise) relevée à sa naissance, puis re-relevée quand `PAS_TICKS`
 * ont passé (un chunk par image, le plus ancien d'abord) ou quand la phase du cycle saute
 * (`debug_set_hour`) ; il ne se RECUIT que si la signature a changé. Une marche ne recuit que
 * les chunks neufs ; le temps qui passe ne recuit que ce qui a vraiment fondu ou pris. Les
 * chronomètres sont DANS la couche (`sonde.msRecuisson`, `msSignature`) : sur cette machine
 * le compte d'images ne mesure pas le rendu, seul le temps passé ici est lisible sous charge.
 *
 * `gelPossible(state)` est la porte d'entrée bon marché : fausse (tout l'acte I, l'essentiel de
 * l'acte II), pas une tuile d'eau n'est interrogée. Mais elle ne garde QUE la glace : la neige
 * au sol, elle, peut survivre à un redoux, donc `neigeAuSol` est interrogée même quand plus
 * rien ne gèle.
 *
 * ═══ LE GEL DE LA FLORE, RELEVÉ AU PASSAGE ═══
 *
 * Le fouillis (brins, fleurs) et les nœuds gélifs disparaissent quand il gèle (spec
 * `flore-froid.md` F8, révisée) ; le prédicat est `floreGelee`, par tuile, aussi coûteux que
 * le reste. La couche le relève dans la même signature et l'expose (`floreGeleeAt`) : un seul
 * balayage, un seul rythme, et le fouillis ne paie rien de plus qu'une lecture de tableau.
 */
import Phaser from 'phaser'
import {
  TERRAIN_DEEP_WATER,
  TERRAIN_SHALLOW_WATER,
  estGele,
  floreGelee,
  gelPossible,
  neigeAuSol,
  niveauPourCouverture,
  terrainAt,
  type SimState,
  type WorldMap,
} from '@ashes/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'
import { GRAIN_CELLS, grainFacteur } from '../../render/grain-sol'
import {
  TUILE_GLACE_GUE, TUILE_GLACE_LAC, TUILE_NEIGE, TUILE_NEIGE_PROFONDE, TUILE_NUE, TUILE_STRUCTURELLE,
  cuireManteau, trameDeGlace, tuileDeNiveau, type EtatTuile,
} from '../../render/manteau'
import { PAVE, PAVE_PX, estStructurel } from '../../render/paves'
import { poserChunk } from './pave-layer'

/** Le sol du manteau : sous le surplomb de la berge (+0,29), au-dessus des reflets (+0,28). */
export const GEL_SOL_DEPTH = GROUND_MAP_DEPTH + 0.285
/** Le surplomb du manteau : au-dessus de la berge, sous la falaise et les feuilles (+0,32). */
export const GEL_DEPTH = GROUND_MAP_DEPTH + 0.3

/**
 * AU BOUT DE COMBIEN DE TICKS UN CHUNK RELIT LE MONDE. La neige fond et la glace prend AVEC
 * LE TEMPS, caméra immobile. `FONTE_CYCLES` vaut 3 cycles (172 800 ticks) pour passer de 1 à
 * 0 : 400 ticks font au pire 0,23 % de couverture, très en dessous de l'écart entre deux
 * seuils de tuiles voisines. On ne peut pas voir la neige sauter, et on relit vingt fois par
 * minute de jeu au lieu de soixante fois par seconde.
 */
const PAS_TICKS = 400
/** Combien de chunks RELISENT leur signature par image (le plus ancien d'abord). */
const SIGNATURES_PAR_FRAME = 1
/** Combien de chunks de COURONNE se cuisent par image. Le visible n'est pas borné. */
const CUISSONS_COURONNE_PAR_FRAME = 1
const COURONNE = 1
const MARGE_VISIBLE_PX = (PAVE.CHUNK * PAVE_PX) / 2
const OUBLI_FRAMES = 120
const MAX_VIVANTS = 96

/** Un chunk de 16 tuiles, marge d'une tuile comprise : 18 × 18 états. */
const L = PAVE.CHUNK + 2

interface ChunkGel {
  sol: { image: Phaser.GameObjects.Image; cle: string } | null
  surplomb: { image: Phaser.GameObjects.Image; cle: string } | null
  /** La signature : l'état de chaque tuile locale (marge comprise). */
  etats: Int8Array
  /** Le gel de la flore, tuile par tuile (marge comprise) : 1 gelé, 0 non. */
  flore: Uint8Array
  /** Le tick de la dernière relecture, et l'offset de cycle qu'elle a vu. */
  tickSigne: number
  offsetSigne: number
  /** Ce que le chunk compte sur ses 16 × 16 tuiles propres (pour la sonde). */
  neige: number
  glace: number
  glaceProfonde: number
  sommeCouverture: number
  couvertureMax: number
  vu: number
}

export class GelLayer {
  private chunks = new Map<number, ChunkGel>()
  private frame = 0
  private readonly trameNeige: Float32Array
  private readonly trameGlace = trameDeGlace()
  private etat: SimState | null = null
  private glacePossible = false

  /**
   * LA SONDE — lue par le smoke, par rien d'autre. `tuilesNeige` et `tuilesGlace` disent ce
   * que la couche a VRAIMENT peint : une capture qui ne montre rien et une couche qui n'a
   * rien à montrer sont deux pannes différentes, et il faut pouvoir les séparer.
   */
  readonly sonde = {
    actif: false,
    gelPossible: false,
    tuilesBalayees: 0,
    tuilesNeige: 0,
    tuilesGlace: 0,
    tuilesGlaceProfonde: 0,
    couvertureMax: 0,
    couvertureMoyenne: 0,
    /** Cuissons de chunks depuis la naissance. */
    recuissons: 0,
    /** La dernière cuisson d'un chunk (cuisson seule, sans la signature), en ms. */
    msRecuisson: 0,
    /** La dernière relecture de signature d'un chunk (les appels à la sim), en ms. */
    msSignature: 0,
    chunksVivants: 0,
  }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    private readonly suffixe = '',
    seed = 0,
  ) {
    this.trameNeige = new Float32Array(GRAIN_CELLS * GRAIN_CELLS)
    for (let cy = 0; cy < GRAIN_CELLS; cy++) {
      for (let cx = 0; cx < GRAIN_CELLS; cx++) this.trameNeige[cy * GRAIN_CELLS + cx] = grainFacteur(cx, cy, 'neige', seed)
    }
  }

  /** La flore de cette tuile est-elle gelée, d'après la dernière signature relevée ici ?
   *  `null` hors de tout chunk vivant : ON NE SAIT PAS ENCORE — et le fouillis ne doit pas
   *  prendre ce silence pour « libre » puis jouer un gel une image plus tard (au premier rendu,
   *  la couche du gel n'a pas encore cuit : elle passe APRÈS le fouillis dans la frame). */
  floreGeleeAt(tx: number, ty: number): boolean | null {
    const N = PAVE.CHUNK
    const c = this.chunks.get(Math.floor(ty / N) * 65536 + Math.floor(tx / N))
    if (!c) return null
    const lx = tx - Math.floor(tx / N) * N + 1
    const ly = ty - Math.floor(ty / N) * N + 1
    return c.flore[ly * L + lx] === 1
  }

  /** L'état d'une tuile d'après la dernière signature (neige, glace, nue) — pour les empreintes. */
  etatAt(tx: number, ty: number): EtatTuile {
    const N = PAVE.CHUNK
    const c = this.chunks.get(Math.floor(ty / N) * 65536 + Math.floor(tx / N))
    if (!c) return TUILE_NUE
    const lx = tx - Math.floor(tx / N) * N + 1
    const ly = ty - Math.floor(ty / N) * N + 1
    return c.etats[ly * L + lx] as EtatTuile
  }

  /**
   * L'ENFONCEMENT DANS LA NEIGE PROFONDE en un point (tuiles), dans [0, 1] — « la neige arrive
   * à hauteur de genou » (gel.md G9). CONTINU (« feel = pente continue ») : 0 pile au bord d'une
   * tuile profonde qui touche une tuile qui ne l'est pas, plein à `RAMPE` tuile à l'intérieur ;
   * au cœur d'une plaque, plein partout. Lu sur la signature — quatre voisins, pas la sim.
   */
  immersionNeige(x: number, y: number): number {
    const tx = Math.floor(x)
    const ty = Math.floor(y)
    if (this.etatAt(tx, ty) !== TUILE_NEIGE_PROFONDE) return 0
    const RAMPE = 0.35
    let d = 1
    if (this.etatAt(tx - 1, ty) !== TUILE_NEIGE_PROFONDE) d = Math.min(d, x - tx)
    if (this.etatAt(tx + 1, ty) !== TUILE_NEIGE_PROFONDE) d = Math.min(d, tx + 1 - x)
    if (this.etatAt(tx, ty - 1) !== TUILE_NEIGE_PROFONDE) d = Math.min(d, y - ty)
    if (this.etatAt(tx, ty + 1) !== TUILE_NEIGE_PROFONDE) d = Math.min(d, ty + 1 - y)
    return Math.min(1, d / RAMPE)
  }

  /**
   * Chaque frame. `etat` est la façade de `etat-gel.ts` ; `tick` en vient aussi, il est passé
   * à part pour que le seuil de relecture ne dépende pas d'un champ caché.
   */
  update(etat: SimState | null, tick: number, camera: Phaser.Cameras.Scene2D.Camera): void {
    this.etat = etat
    if (!etat) { this.eteindre(); return }
    this.frame++
    this.glacePossible = gelPossible(etat)
    const offset = (etat as unknown as { cycleOffset: number }).cycleOffset

    const cotePx = PAVE.CHUNK * PAVE_PX
    const v = camera.worldView
    const cx0 = Math.max(0, Math.floor(v.x / cotePx) - COURONNE)
    const cy0 = Math.max(0, Math.floor(v.y / cotePx) - COURONNE)
    const cxMax = Math.ceil((this.map.width * TILE_PX) / cotePx) - 1
    const cyMax = Math.ceil((this.map.height * TILE_PX) / cotePx) - 1
    const cx1 = Math.min(cxMax, Math.floor((v.x + v.width) / cotePx) + COURONNE)
    const cy1 = Math.min(cyMax, Math.floor((v.y + v.height) / cotePx) + COURONNE)
    const m = MARGE_VISIBLE_PX
    const visible = (cx: number, cy: number): boolean =>
      cx * cotePx < v.x + v.width + m && (cx + 1) * cotePx > v.x - m
      && cy * cotePx < v.y + v.height + m && (cy + 1) * cotePx > v.y - m

    // ① Les chunks qui MANQUENT : le visible tout de suite, la couronne au compte-gouttes.
    let budgetCouronne = CUISSONS_COURONNE_PAR_FRAME
    for (const passeVisible of [true, false]) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (visible(cx, cy) !== passeVisible) continue
          const k = cy * 65536 + cx
          const c = this.chunks.get(k)
          if (c) { c.vu = this.frame; continue }
          if (!passeVisible) {
            if (budgetCouronne <= 0) continue
            budgetCouronne--
          }
          this.naitre(cx, cy, k, tick, offset)
        }
      }
    }

    // ② La RELECTURE : le chunk VISIBLE le plus anciennement signé, s'il est périmé — ou
    //    tout chunk dont la phase du cycle a sauté (`debug_set_hour` déplace `cycleOffset`
    //    sans toucher au tick : c'est le passage de l'heure qui fait geler la vallée, et un
    //    seuil qui ne regarderait que le tick ne le verrait pas).
    for (let n = 0; n < SIGNATURES_PAR_FRAME; n++) {
      let candidat: [number, ChunkGel] | null = null
      for (const [k, c] of this.chunks) {
        if (c.offsetSigne !== offset) { candidat = [k, c]; break }
        if (Math.abs(tick - c.tickSigne) < PAS_TICKS) continue
        if (!visible(k % 65536, Math.floor(k / 65536))) continue
        if (!candidat || c.tickSigne < candidat[1].tickSigne) candidat = [k, c]
      }
      if (!candidat) break
      const [k, c] = candidat
      const cx = k % 65536
      const cy = Math.floor(k / 65536)
      // Aucun changement : la signature relue remplace l'ancienne, rien à redessiner.
      if (this.signer(c, cx, cy, tick, offset)) this.cuire(c, cx, cy)
    }

    // ③ L'oubli : ce qui n'a pas été vu depuis longtemps se rend ; trop de vivants, les plus
    //    anciens partent d'abord — jamais un chunk vu cette frame.
    for (const [k, c] of this.chunks) {
      if (this.frame - c.vu > OUBLI_FRAMES) this.rendre(k, c)
    }
    if (this.chunks.size > MAX_VIVANTS) {
      const parAge = [...this.chunks.entries()].sort((a, b) => a[1].vu - b[1].vu)
      for (const [k, c] of parAge) {
        if (this.chunks.size <= MAX_VIVANTS || c.vu === this.frame) break
        this.rendre(k, c)
      }
    }
    this.relever()
  }

  /** Un chunk neuf : signé, cuit, posé. */
  private naitre(cx: number, cy: number, k: number, tick: number, offset: number): void {
    const c: ChunkGel = {
      sol: null, surplomb: null,
      etats: new Int8Array(L * L), flore: new Uint8Array(L * L),
      tickSigne: tick, offsetSigne: offset,
      neige: 0, glace: 0, glaceProfonde: 0, sommeCouverture: 0, couvertureMax: 0,
      vu: this.frame,
    }
    this.chunks.set(k, c)
    this.signer(c, cx, cy, tick, offset)
    this.cuire(c, cx, cy)
  }

  /** Relit l'état des 18 × 18 tuiles du chunk (marge comprise). Rend vrai si le manteau a
   *  changé (la flore ne compte pas : elle ne se cuit pas). */
  private signer(c: ChunkGel, cx: number, cy: number, tick: number, offset: number): boolean {
    const t0 = performance.now()
    const etat = this.etat!
    const N = PAVE.CHUNK
    const tx0 = cx * N - 1
    const ty0 = cy * N - 1
    let change = false
    let neige = 0, glace = 0, glaceProfonde = 0, somme = 0, max = 0
    for (let ly = 0; ly < L; ly++) {
      for (let lx = 0; lx < L; lx++) {
        const tx = tx0 + lx
        const ty = ty0 + ly
        const i = ly * L + lx
        let e: EtatTuile = TUILE_STRUCTURELLE
        let gele = 0
        let couverture = 0
        if (tx >= 0 && ty >= 0 && tx < this.map.width && ty < this.map.height) {
          const terrain = terrainAt(this.map, tx, ty)
          const eau = terrain === TERRAIN_SHALLOW_WATER || terrain === TERRAIN_DEEP_WATER
          if (estStructurel(terrain)) e = TUILE_STRUCTURELLE
          else if (eau) {
            // LA GLACE : une eau gelée est de la glace, pas de l'eau enneigée — et la neige ne
            // la couvre jamais (G5 : la glace doit se VOIR, voir `render/manteau.ts`).
            e = this.glacePossible && estGele(etat, tx, ty)
              ? (terrain === TERRAIN_DEEP_WATER ? TUILE_GLACE_LAC : TUILE_GLACE_GUE)
              : TUILE_NUE
          } else {
            couverture = neigeAuSol(etat, tx, ty)
            // LE NIVEAU est la loi de la sim (gel.md G9) : ce qu'on peint est ce qui ralentit.
            e = tuileDeNiveau(niveauPourCouverture(couverture, tx, ty))
            gele = floreGelee(etat, tx, ty) ? 1 : 0
          }
        }
        if (c.etats[i] !== e) { c.etats[i] = e; change = true }
        c.flore[i] = gele
        // Les comptes, sur les tuiles PROPRES du chunk (pas la marge, que le voisin compte).
        if (lx >= 1 && ly >= 1 && lx <= N && ly <= N) {
          if (e === TUILE_NEIGE || e === TUILE_NEIGE_PROFONDE) neige++
          if (e === TUILE_GLACE_GUE || e === TUILE_GLACE_LAC) glace++
          if (e === TUILE_GLACE_LAC) glaceProfonde++
          somme += couverture
          if (couverture > max) max = couverture
        }
      }
    }
    c.neige = neige
    c.glace = glace
    c.glaceProfonde = glaceProfonde
    c.sommeCouverture = somme
    c.couvertureMax = max
    c.tickSigne = tick
    c.offsetSigne = offset
    this.sonde.msSignature = performance.now() - t0
    return change
  }

  /** Cuit le chunk depuis sa signature et pose (ou remplace) ses deux images. */
  private cuire(c: ChunkGel, cx: number, cy: number): void {
    const t0 = performance.now()
    const N = PAVE.CHUNK
    const S = N * PAVE_PX
    const tx0 = cx * N - 1
    const ty0 = cy * N - 1
    const etatAt = (tx: number, ty: number): EtatTuile => {
      const lx = tx - tx0
      const ly = ty - ty0
      if (lx < 0 || ly < 0 || lx >= L || ly >= L) return TUILE_STRUCTURELLE
      return c.etats[ly * L + lx] as EtatTuile
    }
    this.detruire(c)
    // Rien à peindre (ni neige ni glace, marge comprise) : pas une texture.
    let vide = true
    for (let i = 0; i < L * L && vide; i++) vide = c.etats[i]! <= TUILE_NUE
    if (vide) { this.sonde.recuissons++; this.sonde.msRecuisson = performance.now() - t0; return }
    const cuit = cuireManteau({ cx, cy, etatAt, trameNeige: this.trameNeige, trameGlace: this.trameGlace })
    const cle = `gel-${this.suffixe}-${cx}-${cy}`
    const sol = poserChunk(this.scene, cle, cuit.sol, cx * S, cy * S, GEL_SOL_DEPTH)
    if (sol) c.sol = { image: sol, cle }
    if (cuit.surplomb) {
      const cleSur = cle + '-surplomb'
      const sur = poserChunk(this.scene, cleSur, cuit.surplomb, cx * S, cy * S, GEL_DEPTH)
      if (sur) c.surplomb = { image: sur, cle: cleSur }
    }
    this.sonde.recuissons++
    this.sonde.msRecuisson = performance.now() - t0
  }

  private detruire(c: ChunkGel): void {
    if (c.sol) {
      c.sol.image.destroy()
      this.scene.textures.remove(c.sol.cle)
      c.sol = null
    }
    if (c.surplomb) {
      c.surplomb.image.destroy()
      this.scene.textures.remove(c.surplomb.cle)
      c.surplomb = null
    }
  }

  private rendre(k: number, c: ChunkGel): void {
    this.detruire(c)
    this.chunks.delete(k)
  }

  /** Les totaux de la sonde, sommés sur les chunks vivants. */
  private relever(): void {
    const N = PAVE.CHUNK
    let neige = 0, glace = 0, profonde = 0, somme = 0, max = 0
    for (const c of this.chunks.values()) {
      neige += c.neige
      glace += c.glace
      profonde += c.glaceProfonde
      somme += c.sommeCouverture
      if (c.couvertureMax > max) max = c.couvertureMax
    }
    const s = this.sonde
    s.actif = neige > 0 || glace > 0
    s.gelPossible = this.glacePossible
    s.tuilesBalayees = this.chunks.size * N * N
    s.tuilesNeige = neige
    s.tuilesGlace = glace
    s.tuilesGlaceProfonde = profonde
    s.couvertureMax = max
    s.couvertureMoyenne = somme / Math.max(1, s.tuilesBalayees)
    s.chunksVivants = this.chunks.size
  }

  private eteindre(): void {
    for (const [k, c] of this.chunks) this.rendre(k, c)
    this.sonde.actif = false
    this.sonde.tuilesNeige = 0
    this.sonde.tuilesGlace = 0
    this.sonde.tuilesGlaceProfonde = 0
    this.sonde.chunksVivants = 0
  }

  destroy(): void {
    for (const [k, c] of this.chunks) this.rendre(k, c)
  }
}
