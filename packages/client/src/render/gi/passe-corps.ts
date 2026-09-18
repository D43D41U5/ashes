/**
 * ═══ LA PASSE DES CORPS, EN RÉFÉRENCE (spec `lumiere-globale.md` LG-R7, LG-R16, LG-A8) ═══
 *
 * *« UN CORPS A LE RELIEF DE LA GI : LA LUMIÈRE DU SOL, LUE SOUS CHACUN DE SES PIXELS, RÉPARTIE
 * ENTRE SES SOURCES, CHAQUE PART DIRECTIONNELLE PASSÉE PAR SA NORMAL MAP. »*
 *
 * Ce module ASSEMBLE, il n'invente rien. Les trois lois qu'il enchaîne vivent ailleurs et sont
 * éprouvées chez elles :
 *   · `sol-du-corps` — OÙ lire (le point au sol, la lecture du feu, le facteur de normale) ;
 *   · `corps-ref`    — COMMENT répartir (les trois parts) et COMPOSER (le pixel) ;
 *   · `champ-ref`    — CE QU'ON LIT (le champ, déjà cuit : sur un texel opaque, `light` et
 *                      `directFace` portent DÉJÀ la valeur de sa face éclairée, `champ-ref.ts:78`).
 *
 * ═══ POURQUOI IL EST ÉCRIT EN FORME DE SHADER ═══
 * `lire` est un CALLBACK d'un seul point — c'est une prise de texel, rien de plus. Le shader fera
 * `texture2D(uChamp, …)` au même endroit. Aucune boucle, aucun état, aucun tableau : tout ce que
 * cette fonction fait, une ligne de GLSL peut le faire. C'est la condition pour que la garde LG-A8
 * compare deux chemins et non deux architectures.
 *
 * ═══ CE QUE CETTE RÉFÉRENCE N'EST PAS ═══
 * ⚠ **Elle ne se compare PAS à l'oracle `dOr` des planches.** Celui-ci est composé de sprites DÉJÀ
 * éclairés par Light2D (`planche9.mjs` : `corpsE += clip(ba × pa × gA)`, où `ba = astreBrut − nul`
 * PORTE le n·ℓ de Light2D). Ici on calcule `texel × part × max(0, n·d)/z` soi-même. Obtenir « 0 canal
 * d'écart » entre les deux voudrait dire qu'on a rebâti Light2D, pas la spec. La cible de la passe
 * est CE module, et la garde est LG-A8 : le shader contre lui, sur le même champ, le même sprite,
 * la même normale — le motif de `champ-ref` / `ChampGpu.verifier()`.
 *
 * ⚠ **Et elle se joue dans le SMOKE, pas en test unitaire.** Mesuré : sous vitest,
 * `typeof document === 'undefined'` et `typeof OffscreenCanvas === 'undefined'` — `newCanvas`
 * (`normal-map.ts:37`) lève, donc le texel et la normale d'un vrai sprite de `bati-art` ne sont pas
 * fabricables hors navigateur. Ici on éprouve la LOI sur des entrées posées ; le PIXEL se juge sous
 * SwiftShader (LG-A1, LG-A2), comme l'en-tête de `corps-ref.test.ts` le dit déjà.
 */
import { avecFeuDeLaFace, composerLeCorps, partsDuCorps, sansFeuDirect, type PartsCorps, type Rgb } from './corps-ref'
import {
  facteurDeNormale,
  lectureDuFeu,
  ordonneeLogique,
  pointAuSol,
  type CorpsPose,
  type Normale,
  type Source3,
} from './sol-du-corps'

/** Ce qu'une prise de texel rend du champ, en un point du sol. Une seule lecture, quatre valeurs. */
export interface LectureDuChamp {
  /** `Champ.light` — la lumière totale du feu (direct + rebond) ; sur un opaque, celle de sa face. */
  readonly light: Rgb
  /** `Champ.directFace` — sa part DIRECTE. Jamais divisée par `light` (LG-R7 : φ ne se divise pas). */
  readonly directFace: Rgb
  /** `S`, le masque d'ombre d'astre en ce point, dans [0, 1] (LG-R8). */
  readonly ombre: number
}

/** Le ciel de l'heure — trois nombres par IMAGE, jamais par pixel : ce sont des uniformes. */
export interface CielDeLHeure {
  /** `Mn`, le plancher du voile par canal (LG-R5) — celui que `WorldScene` pousse déjà en `mnGi`. */
  readonly mn: Rgb
  /** `a` = `SHADOW_ALPHA` × `forceDeLOmbre` : ce que l'astre porte de directionnel (LG-R8). */
  readonly a: number
  /** La luminance de l'ambiante de l'heure — elle RABAT le plancher du corps, jamais ne le lève (J). */
  readonly ambiante: number
}

/**
 * LES DEUX SOURCES, EN 3D — LG-R7 : *« La géométrie des lumières du jeu (position, hauteur) reste
 * celle d'aujourd'hui. »* Elles viennent donc de `dynamic-lighting.ts` et de nulle part ailleurs :
 * `SUN_Z` = 620 pour l'astre, la hauteur du point-light du foyer pour le feu (`TILE_PX × 0,6` = 9,6
 * aujourd'hui). Une seconde table de hauteurs serait « une loi, deux lecteurs ».
 *
 * ⚠ **L'UNITÉ DOIT ÊTRE LA MÊME SUR LES TROIS AXES.** `g` est un RAPPORT, donc px monde ou texels,
 * peu importe — mais un `z` en px avec un `d` en texels donnerait un `g` quatre fois trop grand
 * (`PX_PAR_TEXEL` = 4), sans rien casser de visible. Ce module travaille en **px monde**, comme
 * `CorpsPose` et comme les sources relevées dans l'oracle.
 */
export interface SourcesDuPixel {
  readonly astre: Source3 | null
  readonly feu: Source3 | null
}

/** Ce qu'un pixel de corps a pris, et de quoi — pour que la garde puisse compter, pas seulement comparer. */
export interface PixelDuCorps {
  readonly rgb: Rgb
  /** Le facteur de normale de l'astre, et celui du feu — `1` exactement sur un dessus plat. */
  readonly fAstre: number
  readonly fFeu: number
  /** La branche prise par la part directe du feu (LG-R16, O) — `nul` sur un dessus. */
  readonly ou: 'nul' | 'auPied' | 'sousLePixel'
}

const NUL: Rgb = [0, 0, 0]

/**
 * UN PIXEL DE CORPS, DE BOUT EN BOUT.
 *
 * L'ORDRE EST LA RÈGLE, et chaque pas dit d'où il vient :
 *
 *  ⓪ `ordonneeLogique` — `(xw, yw)` est le pixel DESSINÉ (le fragment) ; la loi juge à sa place
 *     LOGIQUE, `lift` px plus bas (LG-R14). `c.x`, `c.y` et les sources sont déjà logiques.
 *  ① `pointAuSol` — le plat et l'astre se lisent SOUS LE PIXEL (E) : c'est là que les marches entre
 *     deux pans d'un mur s'effacent. Sur un dessus, c'est une hauteur de crête plus bas.
 *  ② `partsDuCorps` en ce point — la répartition, avec le `S` et le champ de CE point.
 *  ③ `lectureDuFeu` — la part directe du feu selon la branche : nulle sur un dessus (LG-R16), lue
 *     AU PIED fois l'exposition sur une face dressée (O), sous le pixel partout ailleurs (E).
 *  ④ les deux facteurs de normale, puis `composerLeCorps`.
 *
 * ⚠ **LE PIED DU FEU SE LIT À `c.x`, PAS À `xw`** (`planche9.mjs:153` : `texelLu(G, s.x, s.y + lift)`).
 * Une face dressée prend UN facteur par sprite et par source, pas un dégradé le long de sa longueur :
 * c'est la tension avec LG-R7 que la planche 8 avait déjà tranchée (« un facteur par SOURCE et par
 * sprite, lu sous le pied ; seule la normale module au pixel »).
 *
 * ⚠ **ET `g` SE PREND TOUJOURS AU POINT LU, MÊME QUAND LA PART VIENT DU PIED** (`planche9.mjs:177` :
 * `gF` se calcule en `p`). La géométrie de la normale et l'origine de la part ne viennent pas du même
 * endroit, et les confondre donnerait à toute une face le `g` de son pied — sur un feu à 9,6 px, où
 * `g` double en deux tuiles, cela se verrait.
 */
export function pixelDuCorps(
  c: CorpsPose,
  xw: number,
  /** L'ordonnée DESSINÉE du pixel — celle du fragment ; voir ⓪. */
  yw: number,
  lire: (x: number, y: number) => LectureDuChamp,
  ciel: CielDeLHeure,
  sources: SourcesDuPixel,
  texel: Rgb,
  normale: Normale,
): PixelDuCorps {
  // ⓪ — le pixel dessiné, remonté à sa place logique (identité au sol).
  const yl = ordonneeLogique(c, yw)

  // ① et ② — le point lu, et la répartition qui s'y fait.
  const p = pointAuSol(c, xw, yl)
  const sous = lire(p.x, p.y)
  let parts: PartsCorps = partsDuCorps(ciel.mn, sous.ombre, ciel.a, sous.light, sous.directFace, ciel.ambiante)

  // ③ — la part directe du feu. Sans feu dans la scène, la branche ne change rien : il n'y a rien
  // à orienter ni à retirer, et `lectureDuFeu` lirait un angle depuis une source qui n'existe pas.
  const feu = sources.feu
  const l = feu ? lectureDuFeu(c, yl, feu) : ({ ou: 'sousLePixel' } as const)
  if (l.ou === 'nul') {
    parts = sansFeuDirect(parts)
  } else if (l.ou === 'auPied') {
    // DEUX APPELS AU MÊME ORACLE, UNE SUBSTITUTION — jamais une soustraction (`avecFeuDeLaFace`).
    const auPied = lire(c.x, l.y)
    const pied = partsDuCorps(ciel.mn, auPied.ombre, ciel.a, auPied.light, auPied.directFace, ciel.ambiante)
    parts = avecFeuDeLaFace(parts, [
      pied.feu[0] * l.facteur,
      pied.feu[1] * l.facteur,
      pied.feu[2] * l.facteur,
    ])
  }

  // ④ — la normale, au POINT LU pour les deux sources, puis la composition.
  const fAstre = sources.astre ? facteurDeNormale(normale, p, sources.astre) : 0
  const fFeu = feu ? facteurDeNormale(normale, p, feu) : 0
  return { rgb: composerLeCorps(texel, parts, fAstre, fFeu), ou: l.ou, fAstre, fFeu }
}

/**
 * LE COMPTEUR DE PRÉMISSE DE LA PASSE — et ce n'est PAS « pixels éclairés ».
 *
 * `EcartCible.eclaires` existe parce qu'un verdict vert sur une scène noire ne dit rien. Pour les
 * corps, le terme qui peut rester muet est LA NORMALE : sur un dessus plat, `facteurDeNormale` rend
 * EXACTEMENT 1, et le pixel se compose comme si elle n'existait pas. Une garde qui ne compare que des
 * dessus serait verte sans avoir éprouvé `g` une seule fois — et ce n'est pas théorique : sur la
 * capture de référence, 4 320 des 20 088 pixels peints de `wall-bois` sont des dessus.
 *
 * `estNonTrivial` élit donc le pixel qui MET LE TERME À L'ÉPREUVE, et le verdict doit en compter les
 * occurrences sans condition — comme la table des familles a dû s'imprimer sans condition avant de me
 * reprendre. Le seuil est en niveaux du canal, pas en flottant : un écart qu'un octet ne voit pas
 * n'éprouve rien.
 *
 * ⚠ **`texel` N'A PAS DE DÉFAUT, ET C'EST DÉLIBÉRÉ.** Je l'avais écrit `= [1, 1, 1]` — le plus
 * permissif : un appelant qui l'oublie compterait PLUS de pixels comme éprouvants qu'il n'y en a, et
 * la prémisse se sur-déclarerait toute seule. C'est le mauvais sens pour un compteur de prémisse, qui
 * doit sous-compter quand on le renseigne mal, jamais l'inverse. Sans défaut, l'oubli est une erreur
 * de compilation — plus bruyant encore qu'un zéro.
 */
export function estNonTrivial(px: PixelDuCorps, texel: Rgb): boolean {
  const pire = Math.max(texel[0], texel[1], texel[2])
  return Math.abs(px.fAstre - 1) * pire * 255 > 1 || Math.abs(px.fFeu - 1) * pire * 255 > 1
}

/** Un corps sans lumière du tout — la borne noire, utile aux gardes comme aux appelants. */
export const PIXEL_NOIR: PixelDuCorps = { rgb: NUL, fAstre: 0, fFeu: 0, ou: 'sousLePixel' }
