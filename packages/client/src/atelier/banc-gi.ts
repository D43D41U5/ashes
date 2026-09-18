/**
 * ═══ LE BANC DE LA GI — l'onglet `#gi` de l'Atelier (spec `lumiere-globale.md`) ═══
 *
 * Trois critères d'acceptation n'avaient pas d'instrument DURABLE :
 *   · LG-A1 — « chaque passe a sa garde de pixels … étant donné une scène fixe dont l'oracle connaît le
 *     champ, quand la passe rend, les texels relus par `readPixels` valent ceux qu'on attend » ;
 *   · LG-A3 — la pureté À L'ÉCRAN : 100 % des pixels valent l'un des texels, aucun interpolé, et ça
 *     tient six images plus tard (le T4 du spike du 14/09) ;
 *   · LG-A14 — le coût d'une image, « sur le banc, par `readPixels` d'un texel, en médiane de 3 »,
 *     avec la gate de la CLASSE du GPU qui l'ouvre (2 ms intégré, 4 ms dédié — LG-Q7, Alexis).
 *
 * Le smoke `gi` juge la chaîne sur le MONDE JOUÉ (LG-A2, une grappe de murs élue au hasard du
 * worldgen) : c'est une garde de scène, pas une garde de passe — `gi-faces`, `gi-drapeau`, `gi-rebond`,
 * `gi-lumiere` et `gi-face-directe` n'y sont relues par personne, et un défaut dans l'une d'elles ne
 * s'y voit qu'à travers la somme. Ici, la SCÈNE EST FIXE (`banc-gi-loi.ts` : le coin du feu et la
 * lisière, les planches 1 à 3), l'oracle en connaît chaque cible intermédiaire, et CHAQUE passe est relue
 * contre la sienne : direct (et l'ombre pleine dans son alpha), faces (au double du grain, case par case,
 * contre `facesDuChamp`), drapeau (le crible ET l'ombre étendue), rebond (avant le genou), somme (nue,
 * puis composée sous un Mn de nuit), lumière et face directe (opaques compris — c'est là que les corps
 * lisent). Les seuils sont ceux de LG-A2, posés dans la spec avant toute mesure.
 *
 * Le banc PUBLIÉ (« Banc des passes GI », l'artefact du 14/09) reste la copie durable des onze
 * vérifications du SPIKE — des passes génériques (écriture, copie, MULTIPLY, ADD, jump flooding). Il
 * ne peut pas porter la chaîne réelle : elle est du TypeScript du dépôt, et sa page n'importe que des
 * scripts de CDN. La chaîne réelle se mesure donc ICI, où le jeu se sert lui-même ; c'est l'Atelier,
 * dev seulement — la machine qui ouvre ce banc est celle où l'on joue en dev. Le résultat s'affiche,
 * se copie en JSON, et s'expose à `window.__BANC_GI__` pour le smoke `gi-banc`.
 *
 * SOUS SWIFTSHADER (la VM de dev, pas de GPU) les gardes valent — la chaîne y est exacte — mais le coût
 * est INDICATIF et n'est jamais une gate (LG-A14) : tant qu'aucun GPU d'une classe n'a ouvert ce banc,
 * la gate de cette classe est NON MESURÉE, pas passée.
 *
 * Monté à la demande par le portail (`portail.ts`), comme les autres outils : ouvrir `#plans` ou `#son`
 * ne charge ni ce module ni la chaîne. Le jeu Phaser ne se crée qu'au clic, à la taille de la vue du jeu
 * (1280 × 720 : le champ a la fenêtre qu'il aurait en jouant, donc le coût aussi).
 */
import Phaser from 'phaser'
import { ChampGpu, PASSES_GI, type VerdictGi } from '../render/gi/champ-gpu'
import { composerM, facesDuChamp } from '../render/gi/champ-ref'
import {
  ASTRE_DU_BANC, MN_DU_BANC, SCENE, cartesDuBanc, classeDuGpu, direLEcart, ecartDe, gateDe, mediane, mondeDuBanc,
  nomDeClasse, sourcesDuBanc, tient, type ClasseGpu, type Ecart,
} from './banc-gi-loi'

// ═══ CE QUE LE BANC RAPPORTE ═══

export interface VerdictDuBanc {
  readonly id: string
  readonly nom: string
  readonly juste: boolean
  readonly detail: string
}

export interface CoutDuBanc {
  /** Le coût d'une image, en ms : `update` (les sept passes soumises) puis la synchronisation — médiane de trois lots. */
  readonly msParImage: number
  /** Les images par lot (doublées jusqu'à 60 ms de lot, au plus 64). */
  readonly imagesParLot: number
  readonly lots: readonly number[]
  /** Le coût d'une synchronisation à vide (retiré de chaque lot). */
  readonly videMs: number
  /** La part CPU de la dernière image : la soumission des passes, et la rastérisation des cartes. */
  readonly soumissionMs: number
  readonly cartesMs: number
}

export interface ResultatDuBanc {
  readonly quand: string
  readonly gpu: string
  readonly webgl: string
  readonly glsl: string
  readonly navigateur: string
  readonly phaser: string
  readonly classeDetectee: ClasseGpu
  /** La classe retenue — la détectée, ou celle dite à la main. */
  readonly classe: ClasseGpu
  readonly gate: { readonly ms: number | null; readonly verdict: 'passe' | 'rompue' | 'indicatif' | 'a-trancher' }
  readonly fenetre: { readonly gw: number; readonly gh: number; readonly texels: number }
  readonly sources: number
  readonly bandes: number
  readonly cartes: number
  readonly verdicts: readonly VerdictDuBanc[]
  readonly justes: number
  readonly total: number
  readonly cout: CoutDuBanc
  /** La garde LG-A2 (`ChampGpu.verifier`) sur la même scène, pour référence : à Mn nul, puis sous le Mn de nuit. */
  readonly a2: VerdictGi | null
  readonly a2Nuit: VerdictGi | null
}

export interface EtatDuBanc {
  etat: 'pret' | 'cours' | 'fini' | 'echec'
  resultat: ResultatDuBanc | null
  erreur?: string
}

/** Les passes gardées, dans l'ordre de la chaîne — le libellé est ce que la garde ÉPROUVE. */
const GARDES: readonly { readonly id: string; readonly nom: string }[] = [
  { id: 'P0', nom: 'OCCLUDEURS — le raster 2× porte chaque cellule pleine de la grille, et les bandes' },
  { id: 'P1a', nom: 'DIRECT — la lumière directe des feux, par texel libre' },
  { id: 'P1b', nom: 'DIRECT — l’ombre PLEINE de l’astre, dans l’alpha' },
  { id: 'P2', nom: 'FACES — au double du grain, case par case : les faces de cellule et de bande, × leur albédo' },
  { id: 'P3a', nom: 'DRAPEAU — le crible du rebond : ce texel a-t-il une face qui émet' },
  { id: 'P3b', nom: 'DRAPEAU — l’ombre ÉTENDUE : la pleine plus deux texels de pénombre, jamais au nord' },
  { id: 'P4', nom: 'REBOND — la somme Lambert des faces à portée, avant le genou' },
  { id: 'P5a', nom: 'SOMME — le champ nu (Mn = 0) : direct + rebond sous le genou, la face éclairée des opaques' },
  { id: 'P5b', nom: 'SOMME — composée sous un Mn de nuit, là où l’ombre et la lumière se croisent (LG-R5)' },
  { id: 'P6', nom: 'LUMIÈRE — `L` nu pour la passe des corps, opaques compris' },
  { id: 'P7', nom: 'FACE DIRECTE — la part directe de la face éclairée, opaques compris' },
  { id: 'E', nom: 'À L’ÉCRAN — chaque pixel vaut son texel, aucun interpolé, et six images plus tard encore (LG-A3)' },
]

interface Rapport {
  env(e: { gpu: string; webgl: string; glsl: string }): void
  etape(texte: string): void
  cours(id: string): void
  verdict(v: VerdictDuBanc): void
  fin(r: FinDeScene): void
  echec(e: unknown): void
}

interface FinDeScene {
  readonly env: { gpu: string; webgl: string; glsl: string }
  readonly cout: CoutDuBanc
  readonly a2: VerdictGi | null
  readonly a2Nuit: VerdictGi | null
  readonly fenetre: { gw: number; gh: number }
  readonly sources: number
  readonly bandes: number
  readonly cartes: number
}

// ═══ LA SCÈNE DU BANC ═══

class BancGiScene extends Phaser.Scene {
  private gi: ChampGpu | null = null
  private readonly monde = mondeDuBanc()
  private readonly sources = sourcesDuBanc()
  private mn: readonly [number, number, number] | null = null
  /** Armée, la scène rend la chaîne à chaque image ; désarmée, le chronomètre la rend lui-même. */
  private armee = false

  constructor(private readonly rapport: Rapport) {
    super('banc-gi')
  }

  create(): void {
    this.cameras.main.setZoom(1).setScroll(SCENE.SCROLL_X, SCENE.SCROLL_Y)
    // La silhouette synthétique des fûts : une carte opaque, que `Silhouettes` relira par un canvas.
    const fut = this.textures.createCanvas(SCENE.CLE_FUT, SCENE.FUT_W, SCENE.FUT_H)
    if (fut) {
      const ctx = fut.getContext()
      // Seule l'opacité compte pour une carte d'ombre : la teinte n'est pas une couleur de palette.
      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, SCENE.FUT_W, SCENE.FUT_H)
      fut.refresh()
    }
    this.gi = ChampGpu.creer(this)
    if (!this.gi) {
      this.rapport.echec(new Error('WebGL requis : la chaîne de la GI ne vit pas en Canvas'))
      return
    }
    this.gi.poserLesCartes(cartesDuBanc())
    void this.courir().then(
      (r) => this.rapport.fin(r),
      (e: unknown) => this.rapport.echec(e),
    )
  }

  override update(): void {
    if (this.armee) this.rendre()
  }

  private rendre(): void {
    this.gi?.update(PASSES_GI, this.cameras.main, this.monde, 0, this.sources, SCENE.DEPTH, this.mn, ASTRE_DU_BANC)
  }

  /** `n` images rendues par la boucle du jeu. */
  private images(n: number): Promise<void> {
    return new Promise((res) => {
      let k = 0
      const f = (): void => {
        if (++k >= n) {
          this.game.events.off(Phaser.Core.Events.POST_RENDER, f)
          res()
        }
      }
      this.game.events.on(Phaser.Core.Events.POST_RENDER, f)
    })
  }

  /** La vue du jeu telle qu'elle est présentée, en RGBA — la cible relue de LG-A3. */
  private capture(): Promise<Uint8ClampedArray> {
    return new Promise((res, rej) => {
      this.game.renderer.snapshotArea(0, 0, SCENE.VUE_W, SCENE.VUE_H, (img) => {
        const image = img as HTMLImageElement
        const fini = (): void => {
          const c = document.createElement('canvas')
          c.width = SCENE.VUE_W
          c.height = SCENE.VUE_H
          const ctx = c.getContext('2d')
          if (!ctx) {
            rej(new Error('pas de contexte 2D pour relire la capture'))
            return
          }
          ctx.drawImage(image, 0, 0)
          res(ctx.getImageData(0, 0, SCENE.VUE_W, SCENE.VUE_H).data)
        }
        if (image.complete && image.naturalWidth) fini()
        else image.onload = fini
      })
    })
  }

  private async courir(): Promise<FinDeScene> {
    const gi = this.gi
    if (!gi) throw new Error('pas de chaîne')
    const r = this.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer
    const gl = r.gl
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const env = {
      gpu: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      webgl: String(gl.getParameter(gl.VERSION)),
      glsl: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
    }
    this.rapport.env(env)

    // ── L'IMAGE A : le champ NU (Mn nul). Deux images : la première bâtit, la seconde est relue. ──
    this.mn = null
    this.armee = true
    this.rapport.etape('La chaîne rend la scène — le champ nu…')
    await this.images(2)
    const g = gi.grilleDuChamp
    const o = gi.oracle()
    if (!g || !o) throw new Error('le champ n’a pas de grille après deux images')
    const n = g.gw * g.gh
    const libre = (k: number): boolean => g.occ[k] !== 1
    const lu = {
      direct: gi.lire('direct'),
      faces: gi.lire('gi-faces'),
      drapeau: gi.lire('gi-drapeau'),
      rebond: gi.lire('gi-rebond'),
      champ: gi.lire('champ'),
      lumiere: gi.lire('gi-lumiere'),
      faceDirecte: gi.lire('gi-face-directe'),
    }
    for (const [cle, t] of Object.entries(lu)) if (t.length === 0) throw new Error(`la cible « ${cle} » ne se relit pas`)
    const ombrePleine = gi.ombrePleine()
    const masque = gi.masque()
    if (!ombrePleine || !masque) throw new Error('la scène n’a pas d’astre')
    const a2 = gi.verifier()

    const dire = (id: string, e: Ecart, juste = tient(e), suite = ''): void => {
      this.rapport.verdict({ id, nom: GARDES.find((x) => x.id === id)?.nom ?? id, juste, detail: direLEcart(e) + suite })
    }

    // P0 — les occludeurs : chaque sous-texel d'une cellule pleine porte le code de cellule, aucun autre.
    this.rapport.cours('P0')
    {
      const occ2 = gi.lireOccludeurs()
      if (!occ2) throw new Error('le raster des occludeurs ne se relit pas')
      let fautes = 0
      let bandes = 0
      for (let j = 0; j < g.gh; j++)
        for (let i = 0; i < g.gw; i++) {
          const k = j * g.gw + i
          for (let sj = 0; sj < 2; sj++)
            for (let si = 0; si < 2; si++) {
              const code = Math.round(occ2.data[((j * 2 + sj) * occ2.w + i * 2 + si) * 4]! / 40)
              if ((code & 1) !== g.occ[k]) fautes++
              if (code >= 2) bandes++
            }
        }
      const juste = fautes === 0 && (g.murs.length === 0 || bandes > 0)
      this.rapport.verdict({
        id: 'P0', nom: GARDES[0]!.nom, juste,
        detail: `${fautes} sous-texel(s) en faute sur ${(4 * n).toLocaleString('fr-FR')} ; ${bandes} sous-texels de bande pour ${g.murs.length} bandes`,
      })
    }
    this.rapport.cours('P1a')
    dire('P1a', ecartDe(n, 3, (k, c) => lu.direct[k * 4 + c]!, (k, c) => o.direct[k * 3 + c]!, libre))
    this.rapport.cours('P1b')
    dire('P1b', ecartDe(n, 1, (k) => lu.direct[k * 4 + 3]!, (k) => ombrePleine[k]!, libre))

    // P2 — les faces, case par case : la liste de l'oracle posée sur le raster 2× (sous-texel k = est,
    // ouest, sud, nord — `dirDe`), sommée quand une cellule et une bande partagent la case.
    this.rapport.cours('P2')
    const aFace = new Uint8Array(n)
    {
      const faces = facesDuChamp(g, o.direct)
      const w2 = g.gw * 2
      const attendu = new Float32Array(4 * n * 3)
      let cellules = 0
      let bandes = 0
      for (const f of faces) {
        const X = Math.floor(f.x)
        const Y = Math.floor(f.y)
        const dx = f.vx - f.x
        const dy = f.vy - f.y
        const k = dx > 0.5 ? 0 : dx < -0.5 ? 1 : dy > 0.5 ? 2 : 3
        const q = (2 * Y + (k >= 2 ? 1 : 0)) * w2 + 2 * X + (k === 1 || k === 3 ? 1 : 0)
        for (let c = 0; c < 3; c++) attendu[q * 3 + c] = attendu[q * 3 + c]! + f.rgb[c]!
        aFace[Y * g.gw + X] = 1
        if (g.occ[Y * g.gw + X] === 1) cellules++
        else bandes++
      }
      const e = ecartDe(4 * n, 3, (q, c) => lu.faces[q * 4 + c]!, (q, c) => attendu[q * 3 + c]!)
      dire('P2', e, tient(e) && cellules > 0 && bandes > 0, ` — ${cellules} faces de cellule, ${bandes} de bande`)
    }
    this.rapport.cours('P3a')
    dire('P3a', ecartDe(n, 1, (k) => lu.drapeau[k * 4]!, (k) => aFace[k]!))
    this.rapport.cours('P3b')
    {
      let penombre = 0
      for (let k = 0; k < n; k++) if (libre(k) && masque[k]! > 0 && masque[k]! < 1) penombre++
      const e = ecartDe(n, 1, (k) => lu.drapeau[k * 4 + 1]!, (k) => masque[k]!, libre)
      dire('P3b', e, tient(e) && penombre > 0, ` — ${penombre} texels de pénombre`)
    }
    this.rapport.cours('P4')
    dire('P4', ecartDe(n, 3, (k, c) => lu.rebond[k * 4 + c]!, (k, c) => o.rebond[k * 3 + c]!, libre))
    this.rapport.cours('P5a')
    dire('P5a', ecartDe(n, 3, (k, c) => lu.champ[k * 4 + c]!, (k, c) => o.light[k * 3 + c]!))
    this.rapport.cours('P6')
    dire('P6', ecartDe(n, 3, (k, c) => lu.lumiere[k * 4 + c]!, (k, c) => o.light[k * 3 + c]!))
    this.rapport.cours('P7')
    dire('P7', ecartDe(n, 3, (k, c) => lu.faceDirecte[k * 4 + c]!, (k, c) => o.directFace[k * 3 + c]!))

    // E — l'écran : le quad du champ (ADD sur le noir) relu pixel par pixel contre `gi-champ`, chaque
    // pixel ramené à son texel (4 × 4 px monde, caméra au zoom 1). Pur = égal à son texel à l'arrondi
    // près ; « tenu » = pareil six images plus tard, la chaîne rendant entre-temps.
    this.rapport.cours('E')
    {
      const cadre = gi.cadre
      const ecran = (img: Uint8ClampedArray): { exacts: number; total: number } => {
        let exacts = 0
        let total = 0
        for (let sy = 0; sy < SCENE.VUE_H; sy++) {
          const j = Math.floor((sy + SCENE.SCROLL_Y - cadre.y) / cadre.pxParTexel)
          if (j < 0 || j >= cadre.gh) continue
          for (let sx = 0; sx < SCENE.VUE_W; sx++) {
            const i = Math.floor((sx + SCENE.SCROLL_X - cadre.x) / cadre.pxParTexel)
            if (i < 0 || i >= cadre.gw) continue
            total++
            const k = j * cadre.gw + i
            const p = (sy * SCENE.VUE_W + sx) * 4
            let pire = 0
            for (let c = 0; c < 3; c++) pire = Math.max(pire, Math.abs(img[p + c]! - lu.champ[k * 4 + c]!))
            if (pire <= 1) exacts++
          }
        }
        return { exacts, total }
      }
      const e1 = ecran(await this.capture())
      await this.images(6)
      const e2 = ecran(await this.capture())
      const pc = (x: { exacts: number; total: number }): string => `${((100 * x.exacts) / Math.max(1, x.total)).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} %`
      this.rapport.verdict({
        id: 'E', nom: GARDES.find((x) => x.id === 'E')!.nom,
        juste: e1.total > 0 && e1.exacts === e1.total && e2.exacts === e2.total,
        detail: `pixels égaux à leur texel (≤ 1 niveau) : ${pc(e1)} sur ${e1.total.toLocaleString('fr-FR')}, puis ${pc(e2)} six images plus tard`,
      })
    }

    // ── L'IMAGE B : le Mn de NUIT — la composition, là où l'ombre d'astre et la lumière se croisent. ──
    this.rapport.cours('P5b')
    this.mn = MN_DU_BANC
    this.rapport.etape('La chaîne rend la scène — sous le plancher de nuit…')
    await this.images(2)
    {
      const champNuit = gi.lire('champ')
      let croises = 0
      for (let k = 0; k < n; k++) {
        if (libre(k) && masque[k]! > 0 && (o.light[k * 3]! > 0 || o.light[k * 3 + 1]! > 0 || o.light[k * 3 + 2]! > 0)) croises++
      }
      const e = ecartDe(n, 3, (k, c) => champNuit[k * 4 + c]!, (k, c) => composerM(MN_DU_BANC[c]!, libre(k) ? masque[k]! : 0, ASTRE_DU_BANC.a, o.light[k * 3 + c]!))
      dire('P5b', e, tient(e) && croises > 0, ` — ${croises} texels où l’ombre et la lumière se croisent`)
    }
    const a2Nuit = gi.verifier()
    this.armee = false
    await this.images(1)

    // ── LE COÛT (LG-A14) ──
    this.rapport.etape('Le chronomètre — la page peut se figer un instant…')
    await this.images(1)
    const cout = this.chrono()
    return { env, cout, a2, a2Nuit, fenetre: { gw: g.gw, gh: g.gh }, sources: this.sources.length, bandes: g.murs.length, cartes: gi.cartesProjetees }
  }

  /**
   * Le chronomètre de LG-A14 : une image = `update` (les sept passes soumises, les cartes rastérisées)
   * puis `synchroniser` (un texel relu : le GPU a tout exécuté). Des lots doublés jusqu'à 60 ms, la
   * synchronisation à vide retirée, la médiane de trois lots. Jamais `gl.finish()`.
   */
  private chrono(): CoutDuBanc {
    const gi = this.gi
    if (!gi) throw new Error('pas de chaîne')
    const image = (): void => {
      this.rendre()
      gi.synchroniser()
    }
    image()
    const vides: number[] = []
    for (let k = 0; k < 5; k++) {
      const t = performance.now()
      gi.synchroniser()
      vides.push(performance.now() - t)
    }
    const vide = mediane(vides)
    let parLot = 1
    for (;;) {
      const t = performance.now()
      for (let i = 0; i < parLot; i++) image()
      if (performance.now() - t >= 60 || parLot >= 64) break
      parLot *= 2
    }
    const lots: number[] = []
    for (let k = 0; k < 3; k++) {
      const t = performance.now()
      for (let i = 0; i < parLot; i++) image()
      lots.push(Math.max(0, (performance.now() - t - vide) / parLot))
    }
    return { msParImage: mediane(lots), imagesParLot: parLot, lots, videMs: vide, soumissionMs: gi.temps.rendu, cartesMs: gi.temps.cartes }
  }
}

// ═══ LE DOM ═══

const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
const ms = (v: number | null | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} ms`)

const STYLE = `
.bg { max-width: 980px; margin: 0 auto; padding: 22px 24px 60px; color: #d8d2c6; font-size: 13px; line-height: 1.55; display: grid; gap: 26px; }
.bg h1 { margin: 0; color: #fff; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
.bg h2 { margin: 0; color: #e8b34a; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.bg p { margin: 0; }
.bg .surtitre { color: #e8763a; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
.bg .chapeau { max-width: 74ch; color: #c0a074; }
.bg .commande { display: grid; gap: 12px; padding: 16px 18px; background: #16120d; border: 1px solid #6b5a3a; }
.bg .rangee { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; }
.bg button { font: inherit; font-weight: 700; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #14141a; background: #c98b3a; border: 1px solid #c98b3a; padding: 10px 16px; cursor: pointer; }
.bg button:hover:not(:disabled) { background: #e8c66a; border-color: #e8c66a; }
.bg button:disabled { cursor: default; color: #8b8474; background: #3a2f22; border-color: #2a2a34; }
.bg select { font: inherit; color: #d8d2c6; background: #0f0b08; border: 1px solid #3a3225; padding: 6px 8px; }
.bg .etat { color: #9a8f78; font-size: 12px; max-width: 80ch; }
.bg .etat[data-ton="ok"] { color: #f2ead0; }
.bg .etat[data-ton="ko"] { color: #e05a4a; }
.bg .gpu { color: #9a8f78; font-size: 12px; overflow-wrap: anywhere; }
.bg .gpu b { color: #d8d2c6; font-weight: 400; }
.bg section { display: grid; gap: 10px; }
.bg .entete { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; justify-content: space-between; }
.bg .compte { color: #8b8474; font-size: 12px; font-variant-numeric: tabular-nums; }
.bg .compte[data-ton="ok"] { color: #f2ead0; }
.bg .compte[data-ton="ko"] { color: #e05a4a; }
.bg .note { max-width: 78ch; color: #9a8f78; font-size: 12px; }
.bg ul.verdicts { list-style: none; margin: 0; padding: 0; border-top: 1px solid #2a2a34; }
.bg .verdict { display: grid; grid-template-columns: 9ch 4ch minmax(0, 1fr); gap: 2px 12px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid #2a2a34; }
.bg .puce { grid-row: span 2; align-self: start; text-align: center; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 0; border: 1px solid #2a2a34; color: #8b8474; }
.bg .puce[data-etat="cours"] { border-color: #c98b3a; color: #c98b3a; }
.bg .puce[data-etat="juste"] { background: #241d14; border-color: #6b5a3a; color: #f2ead0; }
.bg .puce[data-etat="faux"] { border-color: #e05a4a; color: #e05a4a; }
.bg .ident { color: #8b8474; font-size: 11px; }
.bg .nom { color: #d8d2c6; }
.bg .detail { grid-column: 3; color: #8b8474; font-size: 11.5px; overflow-wrap: anywhere; }
.bg table { border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 12.5px; }
.bg th { text-align: left; font-weight: 400; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #8b8474; padding: 6px 18px 6px 0; border-bottom: 1px solid #6b5a3a; }
.bg td { padding: 7px 18px 7px 0; border-bottom: 1px solid #2a2a34; vertical-align: baseline; }
.bg td.n { text-align: right; white-space: nowrap; }
.bg td.mesure { color: #c98b3a; font-weight: 700; }
.bg td.sous { color: #9a8f78; font-size: 11.5px; }
.bg .gate { font-size: 13px; color: #d8d2c6; }
.bg .gate[data-ton="ok"] { color: #f2ead0; }
.bg .gate[data-ton="ko"] { color: #e05a4a; }
.bg .gate[data-ton="nm"] { color: #9a8f78; }
.bg .banc { background: #000; border: 1px solid #6b5a3a; min-height: 80px; display: grid; place-items: center; overflow: hidden; }
.bg .banc canvas { display: block; width: 100% !important; height: auto !important; image-rendering: pixelated; }
.bg .banc-vide { color: #8b8474; font-size: 12px; padding: 24px; }
.bg details { border: 1px solid #2a2a34; background: #16120d; }
.bg summary { cursor: pointer; padding: 8px 12px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #c0a074; }
.bg textarea { display: block; width: 100%; min-height: 160px; box-sizing: border-box; margin: 0; resize: vertical; font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #d8d2c6; background: #0f0b08; border: 0; border-top: 1px solid #2a2a34; padding: 10px 12px; }
`

const racine = document.createElement('div')
racine.className = 'bg'
racine.innerHTML = `
<style>${STYLE}</style>
<header>
  <p class="surtitre">chantier air et lumière · GI 2D · LG-A1, LG-A3, LG-A14</p>
  <h1>Le banc de la GI</h1>
  <p class="chapeau">La chaîne de passes du jeu, rendue sur une scène fixe que l’oracle connaît — le coin du feu et la lisière — puis relue passe par passe au texel. Ensuite le coût d’une image sur ce GPU, et sa gate selon sa classe.</p>
</header>
<section class="commande" aria-label="Lancer la mesure">
  <div class="rangee">
    <button id="bg-lancer" type="button">Mesurer ce GPU</button>
    <label>Classe du GPU <select id="bg-classe" aria-label="Classe du GPU"><option value="">à trancher</option><option value="integre">intégré (gate 2 ms)</option><option value="dedie">dédié (gate 4 ms)</option></select></label>
  </div>
  <p id="bg-etat" class="etat" role="status">Une dizaine de secondes sur un GPU ; sous SwiftShader, jusqu’à une minute. Garde l’onglet au premier plan.</p>
  <p id="bg-gpu" class="gpu" hidden></p>
</section>
<section aria-labelledby="bg-t-verdicts">
  <div class="entete"><h2 id="bg-t-verdicts">Les passes, relues</h2><p id="bg-compte" class="compte">0 / ${GARDES.length} vérifiées</p></div>
  <p class="note">Les seuils sont ceux de LG-A2, posés dans la spec avant toute mesure : au plus un niveau d’écart en moyenne, moins de 1 % des texels à plus de trois niveaux — et chaque garde exige sa prémisse (des faces des deux sortes, de la pénombre, de l’ombre sur la lumière).</p>
  <ul id="bg-verdicts" class="verdicts"></ul>
</section>
<section aria-labelledby="bg-t-cout">
  <div class="entete"><h2 id="bg-t-cout">Le coût d’une image</h2></div>
  <p class="note">Sept passes soumises puis un texel relu — le GPU a tout exécuté. La médiane de trois lots. Sous un rendu logiciel le nombre est indicatif : la gate ne se juge que sur une machine de sa classe.</p>
  <table id="bg-cout"><thead><tr><th>Par image</th><th>Soumission (CPU)</th><th>Cartes (CPU)</th><th>Images par lot</th><th>Fenêtre</th></tr></thead><tbody><tr><td class="n mesure">—</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="sous">—</td></tr></tbody></table>
  <p id="bg-gate" class="gate" data-ton="nm">Gate : non mesurée.</p>
</section>
<section aria-labelledby="bg-t-banc">
  <div class="entete"><h2 id="bg-t-banc">Ce que le GPU dessine</h2></div>
  <p class="note">Le champ nu en ADD sur le noir, au grain de 4 px : les deux feux, les faces qui renvoient, l’ombre de l’astre qui tombe dans l’angle et sous les arbres.</p>
  <div id="bg-banc" class="banc"><p class="banc-vide">Le banc s’allume pendant la mesure.</p></div>
</section>
<details id="bg-brut" hidden><summary>Résultat brut (JSON) — à coller dans la spec ou à Claude</summary><textarea id="bg-brut-texte" readonly aria-label="Résultat brut en JSON"></textarea></details>
`
;(document.getElementById('outil-gi') ?? document.body).appendChild(racine)

const q = <T extends HTMLElement>(sel: string): T => {
  const el = racine.querySelector<T>(sel)
  if (!el) throw new Error(`banc-gi : élément absent « ${sel} »`)
  return el
}
const bouton = q<HTMLButtonElement>('#bg-lancer')
const selectClasse = q<HTMLSelectElement>('#bg-classe')
const etatEl = q<HTMLElement>('#bg-etat')
const dire = (texte: string, ton = ''): void => {
  etatEl.textContent = texte
  etatEl.dataset.ton = ton
}

const expose: EtatDuBanc = { etat: 'pret', resultat: null }
;(window as unknown as { __BANC_GI__: EtatDuBanc }).__BANC_GI__ = expose

function rendreVerdicts(etats: Record<string, { etat: 'attente' | 'cours' | 'juste' | 'faux'; detail?: string }>): void {
  q('#bg-verdicts').innerHTML = GARDES.map((g) => {
    const e = etats[g.id] ?? { etat: 'attente' }
    const libelle = { attente: 'attente', cours: 'en cours', juste: 'juste', faux: 'faux' }[e.etat]
    return `<li class="verdict"><span class="puce" data-etat="${e.etat}">${libelle}</span><span class="ident">${g.id}</span><span class="nom">${esc(g.nom)}</span><span class="detail">${e.detail ? esc(e.detail) : '&nbsp;'}</span></li>`
  }).join('')
  const justes = GARDES.filter((g) => etats[g.id]?.etat === 'juste').length
  const faux = GARDES.filter((g) => etats[g.id]?.etat === 'faux').length
  const compte = q('#bg-compte')
  compte.textContent = faux ? `${justes} justes · ${faux} faux` : `${justes} / ${GARDES.length} vérifiées`
  compte.dataset.ton = faux ? 'ko' : justes === GARDES.length ? 'ok' : ''
}

function rendreCout(c: CoutDuBanc | null, fenetre: { gw: number; gh: number } | null): void {
  const tbody = q<HTMLTableElement>('#bg-cout').tBodies[0]
  if (!tbody) return
  tbody.innerHTML = `<tr>
    <td class="n mesure">${ms(c?.msParImage)}</td>
    <td class="n">${ms(c?.soumissionMs)}</td>
    <td class="n">${ms(c?.cartesMs)}</td>
    <td class="n">${c ? c.imagesParLot : '—'}</td>
    <td class="sous">${fenetre ? `${fenetre.gw} × ${fenetre.gh} texels` : '—'}</td>
  </tr>`
}

/** La gate, d'après la classe retenue et le coût mesuré — et la ligne qui la dit. */
function jugerLaGate(classe: ClasseGpu, cout: number | null): ResultatDuBanc['gate'] {
  const gate = gateDe(classe)
  if (classe === 'logiciel') return { ms: null, verdict: 'indicatif' }
  if (gate === null || cout === null) return { ms: gate, verdict: 'a-trancher' }
  return { ms: gate, verdict: cout <= gate ? 'passe' : 'rompue' }
}

function rendreGate(classe: ClasseGpu, cout: number | null): void {
  const g = jugerLaGate(classe, cout)
  const el = q('#bg-gate')
  if (g.verdict === 'indicatif') {
    el.dataset.ton = 'nm'
    el.textContent = `Gate : aucune — ${nomDeClasse(classe)}. Le coût est indicatif ; les gates intégré (2 ms) et dédié (4 ms) restent NON MESURÉES tant qu’un GPU de leur classe n’a pas ouvert ce banc.`
  } else if (g.verdict === 'a-trancher') {
    el.dataset.ton = 'nm'
    el.textContent = cout === null ? 'Gate : non mesurée.' : 'Gate : la classe de ce GPU est à trancher — choisis intégré ou dédié ci-dessus.'
  } else {
    el.dataset.ton = g.verdict === 'passe' ? 'ok' : 'ko'
    el.textContent = `Gate ${nomDeClasse(classe)} : ${ms(cout)} par image pour ${ms(g.ms, 0)} au plus — ${g.verdict === 'passe' ? 'PASSE' : 'ROMPUE'}.`
  }
}

rendreVerdicts({})
rendreCout(null, null)

let jeu: Phaser.Game | null = null
let dernier: ResultatDuBanc | null = null

/** La classe retenue : le choix à la main s'il y en a un, la détectée sinon. */
const classeRetenue = (detectee: ClasseGpu): ClasseGpu => {
  const choix = selectClasse.value
  return choix === 'integre' || choix === 'dedie' ? choix : detectee
}

selectClasse.addEventListener('change', () => {
  if (!dernier) return
  const classe = classeRetenue(dernier.classeDetectee)
  dernier = { ...dernier, classe, gate: jugerLaGate(classe, dernier.cout.msParImage) }
  expose.resultat = dernier
  q<HTMLTextAreaElement>('#bg-brut-texte').value = JSON.stringify(dernier, null, 2)
  rendreGate(classe, dernier.cout.msParImage)
})

bouton.addEventListener('click', () => {
  bouton.disabled = true
  bouton.textContent = 'Mesure en cours…'
  q('#bg-brut').hidden = true
  const etats: Record<string, { etat: 'attente' | 'cours' | 'juste' | 'faux'; detail?: string }> = {}
  const verdicts: VerdictDuBanc[] = []
  let env: { gpu: string; webgl: string; glsl: string } | null = null
  let classeDetectee: ClasseGpu = 'inconnue'
  rendreVerdicts(etats)
  rendreCout(null, null)
  rendreGate('inconnue', null)
  expose.etat = 'cours'
  expose.resultat = null
  delete expose.erreur
  dire('Vérifications au texel…')
  if (jeu) {
    try {
      jeu.destroy(true)
    } catch {
      /* un banc précédent déjà éteint */
    }
    jeu = null
  }
  const terminer = (): void => {
    bouton.disabled = false
    bouton.textContent = 'Mesurer à nouveau'
  }
  const rapport: Rapport = {
    env(e) {
      env = e
      classeDetectee = classeDuGpu(e.gpu)
      const g = q('#bg-gpu')
      g.hidden = false
      g.innerHTML = `GPU : <b>${esc(e.gpu)}</b> · ${esc(e.webgl)} · ${esc(nomDeClasse(classeDetectee))}${classeDetectee === 'inconnue' ? ' — à trancher à la main' : ''}`
      if (classeDetectee === 'integre' || classeDetectee === 'dedie') selectClasse.value = classeDetectee
      selectClasse.disabled = classeDetectee === 'logiciel'
    },
    etape(texte) {
      dire(texte)
    },
    cours(id) {
      etats[id] = { etat: 'cours' }
      rendreVerdicts(etats)
    },
    verdict(v) {
      verdicts.push(v)
      etats[v.id] = { etat: v.juste ? 'juste' : 'faux', detail: v.detail }
      rendreVerdicts(etats)
    },
    fin(r) {
      const justes = verdicts.filter((v) => v.juste).length
      const classe = classeRetenue(classeDetectee)
      const resultat: ResultatDuBanc = {
        quand: new Date().toISOString(),
        gpu: env?.gpu ?? r.env.gpu,
        webgl: r.env.webgl,
        glsl: r.env.glsl,
        navigateur: navigator.userAgent,
        phaser: Phaser.VERSION,
        classeDetectee,
        classe,
        gate: jugerLaGate(classe, r.cout.msParImage),
        fenetre: { gw: r.fenetre.gw, gh: r.fenetre.gh, texels: r.fenetre.gw * r.fenetre.gh },
        sources: r.sources,
        bandes: r.bandes,
        cartes: r.cartes,
        verdicts: verdicts.slice(),
        justes,
        total: GARDES.length,
        cout: r.cout,
        a2: r.a2,
        a2Nuit: r.a2Nuit,
      }
      dernier = resultat
      expose.resultat = resultat
      expose.etat = 'fini'
      rendreCout(r.cout, r.fenetre)
      rendreGate(classe, r.cout.msParImage)
      q<HTMLTextAreaElement>('#bg-brut-texte').value = JSON.stringify(resultat, null, 2)
      q('#bg-brut').hidden = false
      const bilan = justes === GARDES.length ? `Les ${GARDES.length} gardes sont justes sur ce GPU.` : `${GARDES.length - justes} garde(s) fausse(s) sur ce GPU — la chaîne ne rend pas ce que l’oracle attend.`
      dire(`${bilan} Coût : ${ms(r.cout.msParImage)} par image.`, justes === GARDES.length ? 'ok' : 'ko')
      terminer()
    },
    echec(e) {
      const msg = e instanceof Error ? e.message : String(e)
      expose.etat = 'echec'
      expose.erreur = msg
      dire(`La mesure s’est arrêtée : ${msg}. Recharge la page et relance.`, 'ko')
      q<HTMLTextAreaElement>('#bg-brut-texte').value = JSON.stringify({ erreur: msg, env, verdicts }, null, 2)
      q('#bg-brut').hidden = false
      terminer()
    },
  }
  const parent = q('#bg-banc')
  parent.innerHTML = ''
  try {
    // La config du jeu (`main.ts`) : antialias ET roundPixels — la chaîne pose NEAREST sur ses cibles
    // sous cet antialias-là, et c'est ce que la garde E éprouve. La taille est celle de la vue jouée.
    jeu = new Phaser.Game({
      type: Phaser.WEBGL,
      width: SCENE.VUE_W,
      height: SCENE.VUE_H,
      parent,
      backgroundColor: 0x000000, // du noir, pas une teinte de la palette (la garde `palette.test.ts`)
      antialias: true,
      roundPixels: true,
      banner: false,
      audio: { noAudio: true },
      render: { maxLights: 40 },
      scale: { mode: Phaser.Scale.NONE },
      scene: [new BancGiScene(rapport)],
    })
  } catch (e) {
    rapport.echec(e)
  }
})
