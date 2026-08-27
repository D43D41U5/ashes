/**
 * LES ARBRES ÉCLAIRABLES (DA actée, docs/decisions.md 2026-07-20 ; vague A du 25/07).
 *
 * Variantes `_lit` de l'arbre ordinaire ET du GROS BOIS — MÊME forme et MÊME famille de
 * couleur que l'art d'origine (demande d'Alexis), mais ALBÉDO UNIFORME (à plat) : on retire
 * l'ombrage PEINT pour ne pas le cumuler avec la lumière calculée. Tout le relief vient de la
 * carte de NORMALES + des lumières (dynamic-lighting).
 *
 * LE HOUPPIER passe par la recette commune (`normal-map.ts`) : masque lissé 7 passes,
 * facettes de 4 px (cell), gain 3,2 — les cadrans historiques de ce module, conservés à
 * l'identique (le smoke `cubique` en témoigne). LE TRONC reste ANALYTIQUE : un cylindre ne se
 * dérive pas d'une silhouette — la colonne du fût reçoit sa normale de section directement.
 *
 * Le vieux chêne (gros bois) : houppier 40×40 un cran PLUS SOMBRE (il ferme le ciel — son
 * identité), fût de 10 px (2,5× l'ordinaire), cœur clair en bout (il est VIEUX, ça se voit).
 * C'était le SEUL sprite du monde volontairement éteint — l'exception tombe (da-feeling R3).
 */
import type Phaser from 'phaser'
import { mirrorCanvas, mirrorRelief, newCanvas, normalFromCanvas, poserPaire, registerLitPaire } from './normal-map'
import {
  cleFut, cleHouppier, colonneX, estRamure, houppierLargeur, pariteDeCime, prendLaSaison, tonsMorts,
  CIMES_PAR_ARBRE, CHARGE_NEIGE, etatsDeCime,
  TOUTES_VARIANTES, TONS_HOUPPIER_VIEUX,
  type EtatCime, type MesuresArbre, type TonsFut, type VarianteArbre,
} from './arbre-art'
import { CRAN_SAISON, cranDeSaison, panachageDeFamille, teinteSaisonniere, teinterFamille } from './teinte-saison'
import { champDeHauteur, ecorceDe, facteurPied, type Ecorce, type GrainFut } from './ecorce'
import { FORME_PAR_VARIANTE, PORT_PAR_VARIANTE, cimeEnGrappes, cimeNue, type GrainHouppier } from './houppier-grappes'
import { hash2 } from '@ashes/sim'

/* LES COULEURS NE SONT PLUS RÉÉCRITES ICI NON PLUS. Elles étaient recopiées de l'art peint —
 * la garde de palette a fini par le voir (trois fichiers pour un même brun sans nom). C'est
 * l'arête CLAIRE de chaque famille qu'on aplatit : l'albédo se pose au niveau « éclairé », pour
 * que la lumière calculée SCULPTE vers le bas plutôt que de partir dans le noir. */

/** `#rrggbb` → triplet. Aucune dépendance à Phaser : ce module tourne aussi hors scène. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Albédo d'un houppier : ses TOUFFES, aux tons du champ de feuillage (`feuillage.ts`). La boîte
 *  n'est plus forcément carrée (le saule et le parasol du vieux pin sont plus larges que hauts).
 *
 *  Il remplissait la silhouette d'une seule couleur — MESURÉ, écart entre pixels voisins 0,00 sur
 *  les onze variantes : c'est pour ça qu'il n'y avait aucune texture à voir sur une cime. Le fût
 *  a reçu le même traitement le 2026-07-29, et pour la même raison. */
function crownAlbedo(W: number, S: number, grain: GrainHouppier): HTMLCanvasElement {
  const { c, ctx } = newCanvas(W, S)
  const d = ctx.createImageData(W, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < W; x++) {
      const t = grain.ton[y * W + x]
      if (t === null || t === undefined) continue
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(t)
      if (!m) continue
      const i = (y * W + x) * 4
      d.data[i] = Number(m[1]); d.data[i + 1] = Number(m[2]); d.data[i + 2] = Number(m[3]); d.data[i + 3] = 255
    }
  }
  ctx.putImageData(d, 0, 0)
  return c
}

/* LES SILHOUETTES NE SONT PLUS RÉÉCRITES ICI. Elles étaient déclarées une deuxième fois, à la
 * main, en face des rects de `BootScene` — deux écritures d'une même forme, qui finissent
 * toujours par différer d'un pixel. `houppierOpaque` les DÉDUIT du dessin peint (union de la
 * masse et du corps), donc elles ne peuvent plus s'écarter. */

/* LE CYLINDRE ANALYTIQUE A DISPARU (2026-07-29). `trunkNormal` calculait la normale du fût à la
 * main — `norm3(t * 0.9, 0, 0.7)`, un dégradé CONTINU en travers de la colonne, avec `dy` nul
 * partout. C'était la définition d'un tube, et le tronc était la seule surface du pipeline à ne
 * pas passer par la recette commune. Il y passe désormais, avec un champ de hauteur d'ÉCORCE :
 * voir `ecorce.ts`, qui explique pourquoi le grain se taille en Y et pas en X. */

/** Mélange deux teintes `#rrggbb`. Sert au pied sombre du pin et du bouleau. */
function melanger(a: [number, number, number], b: [number, number, number], k: number): string {
  const v = (i: number): number => Math.round(a[i]! * (1 - k) + b[i]! * k)
  return `rgb(${v(0)},${v(1)},${v(2)})`
}

/**
 * Albédo d'un fût : sa colonne, à plat, aux mesures déclarées — mais avec son ÉCORCE.
 *
 * Il remplissait un rectangle d'une seule couleur : c'est pour ça qu'il n'y avait aucune texture
 * à voir sur un tronc. Les tons restent de la MATIÈRE (creux du sillon, plaque claire, lenticelle,
 * pied sombre), donc ils survivent à l'aplatissement — comme le `coeur` du vieux bois, qui n'a
 * jamais été un ombrage.
 */
function futAlbedo(m: MesuresArbre, tons: TonsFut, e: Ecorce, grain: GrainFut): HTMLCanvasElement {
  const { c, ctx } = newCanvas(m.futW, m.futH)
  const x = colonneX(m)
  const creux = rgb(tons.sombre)
  for (let y = 0; y < m.futH; y++) {
    const k = facteurPied(e, y, m.futH)
    for (let px = x; px < x + m.colonneW; px++) {
      const t = grain.ton[y * m.futW + px]
      if (t === null || t === undefined) continue
      ctx.fillStyle = k > 0 ? melanger(rgb(t), creux, k) : t
      ctx.fillRect(px, y, 1, 1)
    }
  }
  if (tons.coeur !== undefined) {
    ctx.fillStyle = tons.coeur
    ctx.fillRect(x + 2, Math.round(m.futH * 0.125), m.colonneW - 4, Math.max(2, Math.round(m.futH * 0.08)))
  }
  return c
}

/**
 * ═══ LA GRAINE D'UNE CIME ═══ Cinq par variante, espacées d'un nombre premier (deux graines
 * voisines donneraient deux cimes cousines — on aurait payé cinq textures pour une variation).
 */
function graineDe(cime: number): number {
  return 11 + cime * 7919
}

/** Le cran de saison actuellement CUIT dans les textures — `null` tant que rien ne l'est. */
let cranCuit: number | null = null
/**
 * VRAI tant que le monde n'a pas dit son jour — c'est-à-dire tant que ce qui est cuit vient de
 * l'AMORCE (`generateLitTrees` sans calendrier : la teinte du jour 1, cf. `BootScene`).
 *
 * Il ne se déduit pas de `cranCuit === null`, et c'est le piège qu'on a laissé un moment : l'amorce
 * POSE `cranCuit` (0), donc « premier » n'était jamais vrai en jeu et le second emplacement de
 * parité gardait la teinte d'Éclosion jusqu'au deuxième changement de cran — le premier fondu de
 * saison partait alors d'une couleur que la saison n'avait jamais eue.
 */
let surAmorce = true

/**
 * ═══ LES NORMALES SE CACHENT, LES ALBÉDOS SE RECUISENT ═══
 *
 * La teinte de la saison ne touche QUE la couleur : `relief` — le champ de hauteur des pavés
 * que `normalFromCanvas` consomme — est identique en Éclosion et aux Pluies. Recuire la normale
 * à chaque cran serait donc payer deux fois le même résultat, et c'est la partie chère
 * (lissage + facettes + gradient, contre une boucle de pixels pour l'albédo).
 *
 * Le cache est indexé par la CLÉ DE TEXTURE, donc par (variante, cime, état) : deux états n'ont
 * jamais le même relief (une cime nue est faite de branches, une cime coiffée porte un dôme de
 * neige), et il n'y a pas de collision possible.
 */
const NORMALES = new Map<string, HTMLCanvasElement>()

/** La clé NUE d'un fût — `registerLitPaire` y ajoute lui-même `_lit` et `_lit_m`. Elle passe
 *  par `cleFut` pour que la cuisson et les deux poseurs ne puissent pas se désaccorder. */
function cleFutBase(slug: string, mort = false): string {
  return cleFut(slug, false, mort)
}

/** L'albédo d'un état de cime, ce jour-là. La saison ne mord que sur le feuillage CADUC. */
function grainDeCime(v: VarianteArbre, cime: number, etat: EtatCime, jour: number): GrainHouppier {
  const m = v.mesures
  const W = houppierLargeur(m)
  const forme = FORME_PAR_VARIANTE[v.slug] ?? 'rond'
  const graine = graineDe(cime)
  if (estRamure(etat)) {
    // LA RAMURE — dérivée de la feuillue, une branche par grappe, aux tons du BOIS. Elle ne
    // prend PAS la teinte de la saison : un tronc ne rousse pas.
    //   `nu`   la cime d'hiver d'un caduc (G6), aux tons du fût VIVANT
    //   `mort` le CHICOT d'un persistant que la cendre a tué (`cendre.md` R13, 2026-08-27),
    //          aux tons du bois mort — c'est la MÊME recette, et c'est voulu : un squelette
    //          d'arbre est un squelette d'arbre, ce qui change est la couleur et le port.
    const port = PORT_PAR_VARIANTE[v.slug] ?? { axe: 'sympodial' as const, tortueux: 0.18 }
    const bois = etat === 'mort' ? tonsMorts(v.fut) : v.fut
    return cimeNue(W, m.houppierS, forme, bois, port, m.recouvrementPx, m.colonneW, graine)
  }
  // LA TEINTE DE LA SAISON (S17, loi ③ « base + panachage », décision d'Alexis 2026-08-25) —
  // sur les variantes SAISONNIÈRES. Un pin roux romprait la promesse G6 (« la silhouette du
  // conifère dit qu'il tient »), et il porte déjà l'hiver autrement : sa coiffe de neige. Le
  // MÉLÈZE, lui, en est : un conifère qui dore, et qui garde sa cime (cf. `prendLaSaison`).
  const saisonnier = prendLaSaison(v.slug)
  const tons = saisonnier ? teinterFamille(v.tons, teinteSaisonniere(jour)) : v.tons
  const panache = saisonnier
    ? panachageDeFamille(v.tons, jour, (i) => hash2(i, 0, (graine ^ 0x5ea5) | 0))
    : undefined
  return cimeEnGrappes(W, m.houppierS, forme, tons, graine, panache, etat === 'feuillu' ? 0 : CHARGE_NEIGE[etat])
}

/** Cuit (ou recuit) UNE cime : albédo neuf, normale reprise du cache quand elle y est.
 *  `cran` commande DEUX choses à la fois, et c'est voulu : la teinte du jour qu'on cuit, et
 *  l'emplacement où on la range (`pariteDeCime`). Elles ne peuvent donc pas se désaccorder. */
function cuireCime(scene: Phaser.Scene, v: VarianteArbre, cime: number, etat: EtatCime, cran: number): void {
  const m = v.mesures
  const W = houppierLargeur(m)
  const jour = cran * CRAN_SAISON + 1 + CRAN_SAISON / 2 // le MILIEU du cran : sa couleur moyenne
  const parite = pariteDeCime(v.slug, etat, cran)
  const cles = (miroir: boolean): string => cleHouppier(v.slug, true, cime, etat, parite, miroir)
  const cle = cles(false)
  const grain = grainDeCime(v, cime, etat, jour)
  const alb = crownAlbedo(W, m.houppierS, grain)
  // Trois passes de lissage sur une cime de pavés (six les arrondissaient en coussins, une
  // seule facettait chaque pixel de frange) ; DEUX sur une RAMURE — une branche est fine, la
  // lisser six fois en ferait une masse molle (c'est le réglage du fût). Le chicot est une
  // ramure : il prend le cadran du bois, pas celui du feuillage.
  const passes = estRamure(etat) ? 2 : 3
  const k = estRamure(etat) ? 3.5 : 3.2
  let normale = NORMALES.get(cle)
  if (normale === undefined) {
    normale = normalFromCanvas(alb, passes, k, 4, false, [], grain.relief)
    NORMALES.set(cle, normale)
  }
  // LE HOUPPIER EST DRESSÉ : il a son retourné (2026-08-27). Sa normale se dérive DU CANVAS
  // RETOURNÉ — et elle est CACHÉE comme la droite, parce que le recuit saisonnier repasse ici
  // trente-cinq fois par cran : c'est l'albédo qui change avec le jour, jamais la normale.
  const cleM = cles(true)
  let normaleM = NORMALES.get(cleM)
  if (normaleM === undefined) {
    normaleM = normalFromCanvas(mirrorCanvas(alb), passes, k, 4, false, [], mirrorRelief(grain.relief, alb.width, alb.height))
    NORMALES.set(cleM, normaleM)
  }
  poserPaire(scene, cles, alb, normale, normaleM)
}

/**
 * Enregistre les `_lit` de TOUTES les variantes : albédo + normale (houppier par la recette
 * commune, tronc par un champ de hauteur d'écorce).
 *
 * `jour` est le JOUR DE SAISON du monde à l'amorce — il commande la teinte du feuillage caduc.
 * Il a une valeur par défaut parce que l'Atelier et les bancs cuisent des arbres sans calendrier ;
 * le jeu, lui, passe celui de son snapshot (`WorldScene`).
 */
export function generateLitTrees(scene: Phaser.Scene, jour = 1): void {
  const cran = cranDeSaison(jour)
  cranCuit = cran
  surAmorce = true // ce qui va être cuit ici est une teinte d'attente : le monde n'a pas dit son jour
  file.length = 0
  for (const v of TOUTES_VARIANTES) {
    const m = v.mesures
    // LE HOUPPIER — la cime en grappes (décision d'Alexis 2026-08-22) : des pavés chanfreinés
    // empilés, la grammaire du sol dessiné. Le relief passé à la normale est celui des pavés,
    // donc la lumière du jeu sculpte chaque pavé comme elle sculpte un pavé du sol.
    // CINQ CIMES PAR VARIANTE (2026-07-30) : une futaie pure ne montre plus douze fois la même
    // cime au pixel près. Et TROIS ÉTATS au plus — feuillu, puis SOIT nu (le caduc, G6), SOIT
    // coiffé de neige en deux charges (le persistant, 2026-08-25). Les deux ne se croisent
    // jamais : `etatsDeCime` le dit, et le type `EtatCime` empêche d'en inventer un cinquième.
    // Les DEUX emplacements de parité sont cuits à l'amorce (le cran courant et le précédent) :
    // sans ça, le premier changement de cran fondrait DEPUIS une texture absente.
    for (let cime = 0; cime < CIMES_PAR_ARBRE; cime++) {
      for (const etat of etatsDeCime(v.slug)) {
        cuireCime(scene, v, cime, etat, cran)
        if (pariteDeCime(v.slug, etat, cran) !== pariteDeCime(v.slug, etat, cran + 1)) {
          cuireCime(scene, v, cime, etat, cran - 1)
        }
      }
    }

    // LE FÛT — même recette que tout le reste du pipeline, sur un champ de hauteur d'écorce.
    // Les cadrans sont ceux du « cube franc » du 24/07 : `passes:1`, `k:3,5`, facettes de 2 px.
    // À 6 px de colonne, `cell:2` donne trois pans — le budget exact d'un tronc d'arbre.
    // Il ne prend NI la saison NI la neige : un tronc ne rousse pas, et ce qui tombe dessus,
    // c'est le manteau au sol qui le dit (`coupeDeNeige` remonte le pied du sprite).
    const e = ecorceDe(v.slug)
    const x0 = colonneX(m)
    const grain = champDeHauteur(e, m.futW, m.futH, x0, x0 + m.colonneW, v.fut)
    const alb = futAlbedo(m, v.fut, e, grain)
    // LE FÛT EST DRESSÉ, et c'est même la partie ASYMÉTRIQUE de l'arbre : son écorce a un grain,
    // et la cuire une seule fois donnait douze fûts identiques dans une futaie.
    registerLitPaire(scene, cleFutBase(v.slug), {
      albedo: alb, dresse: true, passes: 1, k: 3.5, cell: 2, relief: grain.relief,
    })

    /**
     * ═══ LE FÛT MORT — IL ACCOMPAGNE LE CHICOT, ET CE N'EST PAS UN CHOIX DE GOÛT ═══
     *
     * `cimeNue` peint DÉJÀ le haut du tronc dans la boîte de la cime (elle prolonge le fût
     * jusqu'au bas de sa boîte, pour qu'une grappe basse s'accroche à du bois). Une cime morte
     * sur un fût vivant coupe donc le tronc EN DEUX à `ancrageHouppierPx` — gris au-dessus,
     * saumon ou brun en dessous, sur une horizontale nette. **Vu sur planche** (`planche-chicot`,
     * ligne 2) : ça ne se lit pas comme un arbre mort, ça se lit comme un raccord manqué.
     *
     * Le fût mort n'est donc pas un état de plus à décider, c'est la conséquence du premier.
     * Seuls les PERSISTANTS le cuisent — le caduc en agonie garde sa cime `nu`, peinte aux tons
     * de son fût VIVANT, et les deux moitiés de son tronc s'accordent déjà.
     *
     * Le RELIEF est celui du fût vivant, et c'est exact : la mort décolore l'écorce, elle ne la
     * rabote pas. La normale peut donc se reprendre telle quelle — un albédo de plus, pas une
     * normale de plus.
     */
    if (etatsDeCime(v.slug).includes('mort')) {
      const futMort = tonsMorts(v.fut)
      const grainMort = champDeHauteur(e, m.futW, m.futH, x0, x0 + m.colonneW, futMort)
      registerLitPaire(scene, cleFutBase(v.slug, true), {
        albedo: futAlbedo(m, futMort, e, grainMort), dresse: true,
        passes: 1, k: 3.5, cell: 2, relief: grainMort.relief,
      })
    }
  }
}

/**
 * ═══ LA SAISON RECUIT LE FEUILLAGE — par CRAN de dix jours, ET ÉTALÉ SUR PLUSIEURS IMAGES ═══
 *
 * Sept variantes caduques × cinq cimes = 35 albédos, normales reprises du cache. La cime nue,
 * les coiffes de neige et les fûts ne dépendent pas du jour : jamais recuits.
 *
 * ⚠ **MESURÉ AU NAVIGATEUR (smoke `houppier-saison`, SwiftShader) : 82 ms pour les 35.** Dans
 * une seule image, c'est un à-coup qu'on voit — et il tomberait pile au moment où la forêt est
 * censée changer de couleur en douceur, ce qui est exactement le contraire du but. On les met
 * donc EN FILE et on en cuit `PAR_IMAGE` par frame : le cran met une poignée d'images à
 * s'installer, et le fondu de cime (`fondu-cime.ts`) couvre l'arrivée.
 *
 * `rafraichirCimes` s'appelle À CHAQUE IMAGE : il enfile au changement de cran, puis draine.
 */
const PAR_IMAGE = 4
/** La file de cuisson : ce qui reste à recuire pour le cran courant. */
const file: { v: VarianteArbre; cime: number; etat: EtatCime; cran: number }[] = []

export function rafraichirCimes(scene: Phaser.Scene, jour: number): boolean {
  const cran = cranDeSaison(jour)
  if (cran !== cranCuit) {
    const premier = surAmorce
    surAmorce = false
    cranCuit = cran
    file.length = 0
    for (const v of TOUTES_VARIANTES) {
      if (!prendLaSaison(v.slug)) continue
      for (let cime = 0; cime < CIMES_PAR_ARBRE; cime++) {
        // TOUS les états qui portent la saison — le feuillage, et les coiffes de neige du
        // mélèze (son feuillage se voit entre les plaques). Jamais une RAMURE : tons du bois,
        // et le chicot du mélèze virerait à l'or aux Pluies (il est `prendLaSaison`).
        for (const etat of etatsDeCime(v.slug)) {
          if (estRamure(etat)) continue
          file.push({ v, cime, etat, cran })
          // LE TOUT PREMIER cran cuit les DEUX emplacements : l'autre porterait sinon la teinte
          // du jour 1 posée à l'amorce, et le fondu partirait d'une couleur qui n'a jamais eu lieu.
          if (premier) file.push({ v, cime, etat, cran: cran - 1 })
        }
      }
    }
  }
  if (file.length === 0) return false
  for (let i = 0; i < PAR_IMAGE && file.length > 0; i++) {
    const t = file.shift()!
    cuireCime(scene, t.v, t.cime, t.etat, t.cran)
  }
  return true
}

/** Repart de zéro — pour les tests et pour un redémarrage de scène, qui recuit tout. */
export function oublierCimes(): void {
  NORMALES.clear()
  cranCuit = null
  surAmorce = true
  file.length = 0
}

/** Ce qui reste à cuire — pour les gardes, et pour qui voudrait attendre la fin d'un cran. */
export function cuissonEnCours(): number {
  return file.length
}

// (Le vert du gros bois est exporté pour d'éventuels consommateurs de cohérence — la pousse
// du vieux bois, si elle naît un jour, devra le reprendre : aucun pop de couleur à l'âge.
// Réexporté depuis `arbre-art`, qui le possède désormais.)
export const OLD_TREE_CROWN_GREEN = TONS_HOUPPIER_VIEUX.lumiere
