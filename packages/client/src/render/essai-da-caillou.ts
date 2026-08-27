/**
 * ESSAI DA — LE CAILLOU ET LE BUISSON À LA GRAMMAIRE DE LA RÉFÉRENCE (`rock and bush.png`).
 *
 * Demande d'Alexis (2026-08-26) : « la même DA pour nos nodes de pierre et nos buissons »,
 * option (a) — ALBÉDO SEUL, la lumière reste dynamique. Ce module est un ESSAI : il ajoute des
 * clés `essai-*_lit` À CÔTÉ de l'art en place, ne touche à aucune silhouette existante, et se
 * retire d'un `git rm` + une ligne de BootScene si la reco n'est pas retenue.
 *
 * ⚠ LA RÉFÉRENCE N'EST PAS DU PIXEL ART. Mesurée : 174×110, 5798 couleurs distinctes,
 * longueur de run dominante = 1 px. C'est une image générée, pas une grille copiable — il n'y a
 * RIEN à transcrire. Ce qu'on relève, c'est la GRAMMAIRE, en trois traits :
 *   ① la roche est un AMAS de blocs empilés à sommets décalés, pas un bloc unique ;
 *   ② chaque bloc porte un CONTOUR sombre, y compris entre deux blocs (c'est ce qui les sépare) ;
 *   ③ le buisson a une silhouette LOBÉE (crantée au pixel) et un intérieur partitionné en touffes.
 *
 * ET SURTOUT PAS LES COULEURS. La capture est éclairée de NUIT : son herbe tombe à L≈43 quand la
 * nôtre est à L≈98 (0x3e7d3a). Prendre ses hex tels quels en albédo, c'est cuire la nuit dans la
 * matière et se retrouver avec un buisson noir dès que notre lumière passe dessus. Les valeurs
 * ci-dessous sont les siennes RENORMALISÉES par le rapport d'herbe (×2,29) — et le résultat tombe
 * sur notre palette existante (masse du buisson : elle vise 53-66, `cl-bush` est à 60).
 *
 * CE QUI RESTE DYNAMIQUE (c'est tout l'objet de l'option (a)) : le dessus clair des blocs et le
 * creux entre deux touffes ne sont PAS peints. Ils viennent du `relief` passé à `normalFromCanvas`
 * — un champ de hauteur par bloc/touffe qui remplace le plateau plein binaire. La référence les
 * peint ; nous les faisons calculer. C'est la seule façon de ne pas double-ombrer.
 */
import type Phaser from 'phaser'
import type { Crack } from './normal-map'
import { newCanvas, registerLitPaire } from './normal-map'

type Rect = readonly [number, number, number, number]
/** Un bloc/une touffe : son cadre, sa hauteur de relief (0..1) et son ton de MATIÈRE. */
interface Masse { rect: Rect; h: number; ton: string }

/* ══════════════════════════════════════════════════════════════════════════════════════════
   LA ROCHE — un AMAS, à sommets décalés.

   Notre `nd-rock` est UN rect (`fillRect(3,6,11,8)`) : une pastille. La référence en empile
   trois ou quatre, chacun sa base et son sommet, si bien que la silhouette monte en marches.
   C'est ce qui la fait lire « rocher » et non « galet ».

   Les tons sont trois gris À 10 % L'UN DE L'AUTRE : c'est de la MATIÈRE (deux pierres ne sont
   pas de la même pierre), pas un dégradé de lumière. Le dégradé, la normale s'en charge.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** L'amas de 3 blocs qui tient dans UNE tuile (16×16). Base à y14, la rangée 15 reste au sol. */
const AMAS_16: readonly Masse[] = [
  { rect: [8, 3, 6, 10], h: 1.0, ton: '#6f6f78' }, // arrière-droit — le plus haut
  { rect: [2, 6, 6, 9], h: 0.74, ton: '#63636b' }, //  gauche
  { rect: [6, 10, 8, 5], h: 0.52, ton: '#6a6a72' }, // dalle avant (elle chevauche les deux)
]

/** L'amas de 4 blocs — 16×24, sur le PRÉCÉDENT de `nd-bloc-2` (« le cube déborde sur la tuile du
 *  nord, pas sur le sol »). C'est la colonne qui répond à la question d'échelle : la référence
 *  fait ~2,5 tuiles de large, et trois blocs sont le maximum lisible à 16×16. */
const AMAS_24: readonly Masse[] = [
  { rect: [8, 4, 6, 14], h: 1.0, ton: '#6f6f78' },
  { rect: [2, 9, 6, 12], h: 0.74, ton: '#63636b' },
  { rect: [6, 14, 8, 8], h: 0.52, ton: '#6a6a72' },
  { rect: [1, 17, 6, 5], h: 0.34, ton: '#5c5c64' }, // l'éclat détaché, devant à gauche
]

/**
 * ═══ SÉPARER DEUX BLOCS SANS PEINDRE DE CONTOUR (question d'Alexis, 2026-08-26) ═══
 *
 * Le premier témoin « sans liseré » ne prouvait qu'une chose : que NE RIEN METTRE ne marche pas.
 * Ce n'est pas la question. Il y a trois leviers non peints, et ils sont indépendants — chacun a
 * donc sa variante, pour qu'on sache lequel porte :
 *
 *   ① LE SILLON — `normalFromCanvas` sait graver un chemin dans le champ de hauteur (`cracks`).
 *     Une rainure à la jonction de deux blocs : la lumière y trouve un creux, et le creux dessine
 *     une ligne sombre qu'aucun pixel d'albédo ne porte. C'est le contour, mais CALCULÉ.
 *   ② LE LISSAGE — `passes` est un flou boîte sur le champ de hauteur. À `passes: 1`, une marche
 *     de 0,26 s'étale sur ~3 px et se noie ; à `passes: 0` elle reste franche. C'est l'hypothèse
 *     la plus simple sur l'échec du premier témoin, et elle ne coûte rien à tester.
 *   ③ LA MATIÈRE — deux pierres voisines n'ont aucune raison d'être du même gris. Écarter les
 *     tons de 20 % au lieu de 10 % sépare les blocs sans qu'un seul pixel soit un CONTOUR.
 *     (C'est de l'albédo, mais ce n'est pas de l'ombrage : ça ne se bat avec aucune lumière.)
 */
const SILLONS_ROCHE_24: readonly { path: readonly (readonly [number, number])[] }[] = [
  { path: [[8, 9], [8, 14]] },   // A | B
  { path: [[8, 14], [13, 14]] }, // A | C
  { path: [[7, 14], [7, 20]] },  // B | C
  { path: [[6, 17], [6, 21]] },  // C | D
]

/** Le même amas, tons ÉCARTÉS et hauteurs étagées franchement — le levier ③, seul. */
const AMAS_24_MATIERE: readonly Masse[] = [
  { rect: [8, 4, 6, 14], h: 1.00, ton: '#7c7c86' },
  { rect: [2, 9, 6, 12], h: 0.66, ton: '#5b5b65' },
  { rect: [6, 14, 8, 8], h: 0.40, ton: '#6d6d77' },
  { rect: [1, 17, 6, 5], h: 0.20, ton: '#4d4d57' },
]

/** Le CONTOUR de la référence, renormalisé : elle le pose à L≈2-6 sur une herbe à 43, soit ~5 %
 *  — du noir franc. On le monte à ~27 % du corps : un noir pur perd tout contraste la nuit
 *  (le corps descend le rejoindre), alors qu'un liseré tenu au-dessus du fond garde sa ligne. */
const LISERE = '#1d1d24'

/* ══════════════════════════════════════════════════════════════════════════════════════════
   LE BUISSON — lobé au bord, partitionné dedans.

   Notre `cl-bush` est un empilement de `fillCircle` : un dôme lisse à quatre bandes de valeur.
   La référence n'a AUCUN bord lisse — sa silhouette est crantée d'un pixel tous les deux ou
   trois, et son intérieur est une mosaïque de touffes séparées par des creux d'un pixel.

   Les touffes ne sont donc PAS peintes ici : ce sont neuf masses de relief. Le creux entre deux
   d'entre elles est une VALLÉE du champ de hauteur — la lumière la trouvera seule.
   ══════════════════════════════════════════════════════════════════════════════════════════ */
/**
 * PREMIER TOUR (mesuré, planche du 26/08) — ce qui a RATÉ, et pourquoi les variantes ci-dessous
 * existent. Neuf touffes bien rangées en dôme symétrique ont donné : ① une silhouette d'OCTOGONE,
 * pas un buisson (trop régulière pour cranter) ; ② un intérieur MUET — à 16 px, un creux entre
 * deux touffes ne pèse pas assez pour que la normale le voie, à cell 2 comme à cell 1 ; ③ et le
 * liseré posé autour de CHAQUE touffe a peint un TREILLIS (chaque anneau ressort à l'intérieur
 * de la masse) — un circuit imprimé vert, pas un feuillage.
 *
 * D'où trois corrections : masses IRRÉGULIÈRES (le sommet monte à droite, le cœur est décalé à
 * gauche), DEUX matières alternées d'un cran (deux touffes voisines ne sont pas la même touffe —
 * c'est de la matière, pas de la lumière), et la séparation interne essayée par TROIS voies
 * distinctes, une par variante : rien / sillons gravés dans la NORMALE / trois traits peints.
 */
const TOUFFES: readonly Masse[] = [
  { rect: [5, 2, 5, 3], h: 0.90, ton: '#33532a' },
  { rect: [9, 3, 5, 4], h: 0.86, ton: '#2a4722' }, // la droite monte plus haut — l'asymétrie
  { rect: [2, 4, 5, 4], h: 0.78, ton: '#2a4722' },
  // ⚠ CES DEUX-LÀ SONT DES PONTS, pas des touffes. Le premier tour a livré une silhouette
  // TROUÉE — deux poches de vide (7-8,5-6) et (2,8) qu'aucun rect ne couvrait, invisibles à
  // l'albédo mais criantes en ombre chinoise. Une masse ne se compose pas « à peu près » :
  // la couverture se VÉRIFIE (garde `couvertureTrouee` ci-dessous), elle ne se dessine pas à l'œil.
  { rect: [6, 5, 4, 3], h: 0.88, ton: '#33532a' },
  { rect: [1, 7, 3, 3], h: 0.68, ton: '#2a4722' },
  { rect: [3, 7, 6, 4], h: 1.00, ton: '#33532a' }, // le cœur, décalé à gauche
  { rect: [9, 7, 5, 5], h: 0.70, ton: '#33532a' },
  { rect: [1, 9, 4, 4], h: 0.55, ton: '#2a4722' },
  { rect: [5, 10, 5, 4], h: 0.62, ton: '#2a4722' },
  { rect: [10, 11, 4, 3], h: 0.45, ton: '#33532a' },
  { rect: [3, 12, 5, 3], h: 0.40, ton: '#2a4722' }, // le ventre
]

/** LE MÊME BUISSON SUR 16×24 — la question d'échelle, posée au feuillage.
 *
 *  Elle se pose plus fort ici que pour la roche : mesuré sur la référence, son buisson fait ~65 px
 *  de large là où sa roche en fait 40 — soit ~4 tuiles contre 2,5. Sa grammaire (des touffes de
 *  3-4 px, chacune avec sa crête) suppose une masse où l'on peut en loger douze. À 16×16 on en
 *  case neuf, et elles se recouvrent tant qu'il ne reste plus de creux entre elles. Cette colonne
 *  répond à : est-ce que le feuillage de la référence EXISTE à une tuile, ou pas ?
 */
const TOUFFES_24: readonly Masse[] = [
  { rect: [5, 4, 5, 3], h: 0.88, ton: '#33532a' },
  { rect: [9, 5, 5, 4], h: 0.92, ton: '#2a4722' },
  { rect: [2, 6, 5, 4], h: 0.80, ton: '#2a4722' },
  { rect: [6, 7, 5, 4], h: 1.00, ton: '#33532a' },
  { rect: [10, 9, 4, 4], h: 0.78, ton: '#33532a' },
  { rect: [1, 10, 5, 4], h: 0.70, ton: '#2a4722' },
  { rect: [4, 11, 6, 4], h: 0.85, ton: '#33532a' },
  { rect: [9, 13, 5, 4], h: 0.62, ton: '#2a4722' },
  { rect: [2, 14, 5, 4], h: 0.58, ton: '#33532a' },
  { rect: [6, 15, 6, 4], h: 0.66, ton: '#2a4722' },
  { rect: [10, 17, 4, 4], h: 0.48, ton: '#33532a' },
  { rect: [3, 18, 7, 4], h: 0.45, ton: '#2a4722' }, // 7 et non 6 : à 6, (9,19) restait une poche
  { rect: [6, 20, 6, 2], h: 0.38, ton: '#33532a' },
]

/** Les sillons du 16×24 — même rôle, à sa taille. */
const SILLONS_24: readonly { path: readonly (readonly [number, number])[] }[] = [
  { path: [[8, 6], [8, 11]] },
  { path: [[9, 12], [10, 17]] },
  { path: [[3, 13], [9, 13]] },
  { path: [[4, 18], [10, 18]] },
]

/** Les JONCTIONS entre touffes — le même tracé servi de deux façons opposées, c'est tout l'objet
 *  de l'essai : gravé dans la normale (la lumière trouve le creux) ou peint dans l'albédo. */
const JONCTIONS: readonly Rect[] = [
  [7, 4, 1, 4],
  [8, 8, 1, 4],
  [4, 10, 5, 1],
]
/** Le même, en chemins pour `carveCracks`. */
const SILLONS: readonly { path: readonly (readonly [number, number])[] }[] = [
  { path: [[7, 4], [7, 8]] },
  { path: [[8, 8], [9, 12]] },
  { path: [[3, 10], [8, 10]] },
]
/** L'ombre interne d'un feuillage est VERTE et sombre, jamais noire — un liseré de roche mis là
 *  ferait un grillage sur une plante. */
const CREUX_FEUILLE = '#1b3016'

/* ══════════════════════════════════════════════════════════════════════════════════════════
   LA FABRIQUE — albédo, relief, et rien d'autre.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** L'albédo : les masses dans l'ordre du peintre, chacune précédée de son liseré (inflaté d'un
 *  pixel) quand il est demandé — c'est cette inflation qui redonne la ligne ENTRE deux blocs. */
/**
 * `false` = rien · `'plein'` = le liseré de la référence (contour extérieur COMPRIS) ·
 * `'interieur'` = les seules JONCTIONS, sans contour extérieur.
 *
 * La distinction est celle qu'Alexis vise en demandant « et sans liseré ? » : ce qui donne son
 * air de dessin animé, c'est le trait qui CERNE la silhouette. Les coutures entre deux blocs,
 * elles, ne cernent rien — ce sont des joints de pierre. Et elles sont de l'ALBÉDO, donc elles
 * traversent la nuit intactes, là où un creux gravé dans la normale en perd la moitié.
 */
type ModeLisere = false | 'plein' | 'interieur'

function peindre(ctx: CanvasRenderingContext2D, masses: readonly Masse[], lisere: ModeLisere, w: number, h: number): void {
  if (lisere === 'interieur') {
    // Le liseré INFLATÉ, puis RABOTÉ à l'union des masses nues : il ne subsiste que là où
    // l'inflation d'un bloc tombe SUR un autre bloc — c'est-à-dire aux jonctions, nulle part ailleurs.
    const union = new Uint8Array(w * h)
    for (const m of masses) {
      const [x, y, mw, mh] = m.rect
      for (let j = y; j < y + mh; j++) for (let i = x; i < x + mw; i++) if (i >= 0 && j >= 0 && i < w && j < h) union[j * w + i] = 1
    }
    for (const m of masses) {
      const [x, y, mw, mh] = m.rect
      ctx.fillStyle = LISERE
      for (let j = y - 1; j <= y + mh; j++) for (let i = x - 1; i <= x + mw; i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue
        if (i >= x && i < x + mw && j >= y && j < y + mh) continue // l'intérieur du bloc, pas son bord
        if (!union[j * w + i]) continue //  hors matière : ce serait le contour extérieur
        ctx.fillRect(i, j, 1, 1)
      }
      ctx.fillStyle = m.ton
      ctx.fillRect(x, y, mw, mh)
    }
    return
  }
  for (const m of masses) {
    const [x, y, mw, mh] = m.rect
    if (lisere === 'plein') { ctx.fillStyle = LISERE; ctx.fillRect(x - 1, y - 1, mw + 2, mh + 2) }
    ctx.fillStyle = m.ton
    ctx.fillRect(x, y, mw, mh)
  }
}

/** Les trois traits de jonction, peints APRÈS les masses — dosés, et JAMAIS un anneau par touffe
 *  (c'est ce qui avait fait le treillis au premier tour). */
function peindreJonctions(ctx: CanvasRenderingContext2D, jonctions: readonly Rect[]): void {
  ctx.fillStyle = CREUX_FEUILLE
  for (const [x, y, w, h] of jonctions) ctx.fillRect(x, y, w, h)
}

/** Le champ de hauteur : chaque masse est une BUTTE (son sommet au centre, retombant de 35 % au
 *  bord), et on garde le maximum. Un plateau franc par masse donnerait des blocs de béton ; la
 *  retombée est ce qui fait qu'un caillou est bombé et qu'une touffe est une touffe. */
function relief(w: number, h: number, masses: readonly Masse[], bombe: number): Float32Array {
  const f = new Float32Array(w * h)
  for (const m of masses) {
    const [rx, ry, rw, rh] = m.rect
    const cx = rx + (rw - 1) / 2, cy = ry + (rh - 1) / 2
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        // distance de Tchebychev normalisée : un cadran carré, pas un disque (on est cubique).
        const d = Math.max(Math.abs(x - cx) / Math.max(1, (rw - 1) / 2), Math.abs(y - cy) / Math.max(1, (rh - 1) / 2))
        const v = m.h * (1 - bombe * d)
        const i = y * w + x
        if (v > f[i]!) f[i] = v
      }
    }
  }
  // Le liseré déborde d'un pixel : sans hauteur il creuserait une rigole autour de chaque masse
  // et le contour compterait DEUX fois (peint + calculé). On lui donne celle de son voisin.
  const g = new Float32Array(f)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (g[i]! > 0) continue
      let best = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        if (f[yy * w + xx]! > best) best = f[yy * w + xx]!
      }
      g[i] = best
    }
  }
  return g
}

interface Essai {
  key: string
  w: number
  h: number
  masses: readonly Masse[]
  lisere: ModeLisere
  bombe: number
  passes: number
  k: number
  cell?: number
  plant?: boolean
  /** Miroir pré-retourné. La réserve que portait ce champ (« il devrait aussi retourner sillons
   *  et jonctions ») est LEVÉE depuis le 2026-08-27 : `registerLitPaire` retourne le relief ET
   *  les sillons, et les traits peints arrivent après la dérivation. Aucun essai ne le demande
   *  aujourd'hui — le champ reste pour le prochain. */
  miroir?: boolean
  /** séparation interne GRAVÉE (la lumière la trouve) */
  sillons?: readonly Crack[]
  /** séparation interne PEINTE (dosée : trois traits, pas un anneau par masse) */
  jonctions?: readonly Rect[]
  legende: string
}

export const ESSAIS: readonly Essai[] = [
  // ── LA ROCHE ────────────────────────────────────────────────────────────────────────────
  // `-a` est la variante TÉMOIN, gardée exprès : elle est la preuve que le liseré n'est pas une
  // coquetterie de style. Sans lui, les trois blocs se recollent en une bouillie grise — la
  // normale seule ne sépare pas deux masses qui SE TOUCHENT (leur marche de relief est noyée par
  // le lissage). C'est le seul endroit où l'option (a) doit céder, et il est mesuré.
  { key: 'essai-roche-a', w: 16, h: 16, masses: AMAS_16, lisere: false, bombe: 0.30, passes: 1, k: 3.5, plant: true, legende: 'amas 3 · SANS liseré (témoin)' },
  { key: 'essai-roche-b', w: 16, h: 16, masses: AMAS_16, lisere: 'plein', bombe: 0.30, passes: 1, k: 3.5, plant: true, legende: 'amas 3 · liseré peint' },
  { key: 'essai-roche-c', w: 16, h: 24, masses: AMAS_24, lisere: 'plein', bombe: 0.30, passes: 1, k: 3.5, plant: true, legende: '16×24 · amas 4 · liseré' },
  // ── LA ROCHE SANS LISERÉ — les trois leviers non peints, isolés puis cumulés ──────────────
  // Tous sur l'amas 16×24 (la taille recommandée) pour que la seule variable soit la SÉPARATION.
  { key: 'essai-roche-d', w: 16, h: 24, masses: AMAS_24, lisere: false, bombe: 0.30, passes: 1, k: 3.5, plant: true, sillons: SILLONS_ROCHE_24, legende: '① sillons GRAVÉS' },
  { key: 'essai-roche-e', w: 16, h: 24, masses: AMAS_24, lisere: false, bombe: 0.30, passes: 0, k: 3.5, cell: 1, plant: true, legende: '② aucun lissage (passes 0, cell 1)' },
  { key: 'essai-roche-f', w: 16, h: 24, masses: AMAS_24_MATIERE, lisere: false, bombe: 0.30, passes: 1, k: 3.5, plant: true, legende: '③ matières écartées' },
  { key: 'essai-roche-h', w: 16, h: 24, masses: AMAS_24_MATIERE, lisere: false, bombe: 0.30, passes: 0, k: 3.5, cell: 1, plant: true, sillons: SILLONS_ROCHE_24, legende: '①+②+③ cumulés' },
  // ── ④ LA TROISIÈME VOIE : le JOINT sans le CERNE ─────────────────────────────────────────
  // Ce qui fait « dessin animé » dans la référence, c'est le trait qui CERNE la silhouette. Le
  // joint entre deux pierres, lui, ne cerne rien. On garde donc l'albédo (qui traverse la nuit)
  // et on jette le contour extérieur (qui porte le style).
  { key: 'essai-roche-i', w: 16, h: 24, masses: AMAS_24, lisere: 'interieur', bombe: 0.30, passes: 1, k: 3.5, plant: true, legende: '④ joints seuls, sans cerne' },
  { key: 'essai-roche-j', w: 16, h: 24, masses: AMAS_24_MATIERE, lisere: 'interieur', bombe: 0.30, passes: 1, k: 3.5, plant: true, legende: '④+③ joints + matières' },
  // ── LE BUISSON ──────────────────────────────────────────────────────────────────────────
  // `-a` est le témoin du premier tour (dôme régulier, cell 2) : intérieur muet, silhouette
  // d'octogone. Les trois suivantes gardent la MÊME masse irrégulière et ne changent qu'une
  // chose — comment la séparation interne est produite. C'est la seule variable de l'essai.
  { key: 'essai-buisson-a', w: 16, h: 16, masses: TOUFFES, lisere: false, bombe: 0.45, passes: 2, k: 3.0, legende: 'touffes · cell 2 (témoin)' },
  { key: 'essai-buisson-d', w: 16, h: 16, masses: TOUFFES, lisere: false, bombe: 0.60, passes: 2, k: 3.0, cell: 1, legende: 'irrégulier · 2 matières · rien de plus' },
  { key: 'essai-buisson-e', w: 16, h: 16, masses: TOUFFES, lisere: false, bombe: 0.60, passes: 2, k: 3.0, cell: 1, sillons: SILLONS, legende: 'idem + sillons GRAVÉS (normale)' },
  { key: 'essai-buisson-f', w: 16, h: 16, masses: TOUFFES, lisere: false, bombe: 0.60, passes: 2, k: 3.0, cell: 1, jonctions: JONCTIONS, legende: 'idem + 3 traits PEINTS' },
  { key: 'essai-buisson-g', w: 16, h: 24, masses: TOUFFES_24, lisere: false, bombe: 0.60, passes: 2, k: 3.0, cell: 1, sillons: SILLONS_24, legende: '16×24 · 13 touffes · sillons' },
]

/**
 * LA GARDE DE COUVERTURE — une masse composée de rects PEUT être trouée, et le trou ne se voit
 * pas sur l'albédo (deux verts voisins), seulement en ombre chinoise. Le premier tour en a livré
 * deux. Ici on l'affirme en données : tout pixel de matière entouré de matière est matière.
 * Rendue publique pour que le test l'appelle plutôt que de recopier le balayage.
 */
export function trousDe(masses: readonly Masse[], w: number, h: number): (readonly [number, number])[] {
  const plein = new Uint8Array(w * h)
  for (const m of masses) {
    const [rx, ry, rw, rh] = m.rect
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) if (x >= 0 && y >= 0 && x < w && y < h) plein[y * w + x] = 1
  }
  const trous: [number, number][] = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (plein[y * w + x]) continue
      // entouré des QUATRE côtés (au sens large : il existe de la matière au-dessus ET dessous,
      // à gauche ET à droite sur la même ligne/colonne) → c'est une poche, pas une échancrure.
      let g = false, d = false, ht = false, bs = false
      for (let i = 0; i < x; i++) if (plein[y * w + i]) g = true
      for (let i = x + 1; i < w; i++) if (plein[y * w + i]) d = true
      for (let j = 0; j < y; j++) if (plein[j * w + x]) ht = true
      for (let j = y + 1; j < h; j++) if (plein[j * w + x]) bs = true
      if (g && d && ht && bs) trous.push([x, y])
    }
  }
  return trous
}

/** Enregistre les essais. Appelé au boot APRÈS `generateLitProps` — additif, il n'écrase rien. */
export function generateEssaiCaillou(scene: Phaser.Scene): void {
  for (const e of ESSAIS) {
    const alb = newCanvas(e.w, e.h)
    peindre(alb.ctx, e.masses, e.lisere, e.w, e.h)
    // TOUT PASSE PAR LA RECETTE (`registerLitPaire`) — l'essai comme le jeu. Les traits peints
    // en plus (`jonctions`) sont son `ombrer` : ils arrivent APRÈS la dérivation des normales,
    // ce qui était déjà la règle ici. Le relief et les sillons se retournent avec le canvas ;
    // c'est la recette qui le fait maintenant, et le miroir de l'essai gagne au passage ses
    // sillons retournés (il les perdait, faute d'un `mirrorCracks` sous la main).
    registerLitPaire(scene, e.key, {
      albedo: alb.c,
      dresse: e.miroir === true,
      passes: e.passes, k: e.k, cell: e.cell, plant: e.plant ?? false,
      sillons: e.sillons ?? [],
      relief: relief(e.w, e.h, e.masses, e.bombe),
      ombrer: e.jonctions ? (c): void => peindreJonctions(c, e.jonctions!) : undefined,
    })
  }
}
