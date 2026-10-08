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
import { composerM } from './champ-ref'
import { GI } from './reglages'
import { avecFeuDeLaFace, composerLeCorps, partsDuCorps, sansFeuDirect, type PartsCorps, type Rgb } from './corps-ref'
import {
  colonneAuPalierDuCorps,
  facteurDeNormale,
  lectureDuFeu,
  ligneDuPied,
  ordonneeLogique,
  pointAuSol,
  type CorpsPose,
  type GrainDuChamp,
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
  /**
   * `M`, le multiplicateur COMPOSÉ en ce point — `gi-champ`, ce que le quad de sol multiplie — quand
   * l'appelant l'a lu tel quel (la garde LG-A8, sur l'octet même que le shader lit) ; absent, il se
   * recompose des trois autres (`composerM`, la loi de LG-R5). Seul un SOL (`CorpsPose.sol`) le lit.
   */
  readonly m?: Rgb
}

/**
 * ═══ L'ORACLE DU CHAMP — DEUX SAMPLERS, UNE PRISE CHACUN ═══
 *
 * `lire(x, y)` est le champ lui-même : `texture2D(uGiL/uGiF/uGiS, …)` en un point, quatre valeurs.
 * `lire.palier(x, y)` est le CINQUIÈME sampler, `texture2D(uGiPaliers, …)` — le palier de la tuile
 * (LG-R14), au même grain, un octet. Deux fonctions parce que le shader a deux textures : l'en-tête
 * de ce module tient à ce que la référence garde la FORME d'un shader, pour que LG-A8 compare deux
 * chemins et non deux architectures.
 *
 * ⚠ **ET `grain` EST OBLIGATOIRE.** La garde de palier marche de texel en texel ; sans l'origine et
 * le pas du raster, elle ne saurait pas de combien avancer. L'oublier est une erreur de compilation —
 * un défaut par défaut serait ici la pire des issues : la garde se tairait et le corps resterait rayé.
 */
export interface OracleDuChamp {
  (x: number, y: number): LectureDuChamp
  readonly palier: (x: number, y: number) => number
  readonly grain: GrainDuChamp
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
  /** La branche prise par la part directe du feu (LG-R16, O) — `nul` sur un dessus ; `sol` pour une
   *  image de sol (LG-R14), qui n'a ni feu au pied ni normale : `texel × M`, et rien d'autre. */
  readonly ou: 'nul' | 'auPied' | 'sousLePixel' | 'sol'
}

const NUL: Rgb = [0, 0, 0]

/** Le champ tel que le voit un corps sous le ciel seul (`CorpsPose.ciel`) : rien, et pas d'ombre. */
const SANS_CHAMP: LectureDuChamp = { light: NUL, directFace: NUL, ombre: 0 }

/**
 * ═══ LE PLANCHER DE CE QU'UN CORPS PORTE (B-R13d) ═══
 *
 * *« Oui il doit être éclairé par sa torche ou une braise qu'il porte lui-même »* (Alexis,
 * 2026-10-05). Le corps d'un porteur lisait le champ sous ses pieds **et rien d'autre** — or le
 * champ plafonne au pic d'effacement du voile (`profilFeu(0)` = `HOLE_ERASE_PEAK` = 0,62), et une
 * lumière PORTÉE n'y pèse que sa force (0,5) : MESURÉ sur l'oracle, à minuit, un porteur de braise
 * pleine comme de torche vive composait **57,38,22** sur un texel de corps `0,62/0,52/0,42` —
 * 36 % de son albédo, pendant que le sol sous ses pieds était lavé par le trou du voile ET par la
 * flaque additive. *Un bonhomme sombre debout dans une tache claire*, et c'est ce qu'Alexis a vu.
 *
 * Le plancher est la clarté que **l'autorité** donne (`clarteDeCeQuOnPorte`, `/sim`), posée à la
 * teinte de la flamme — donc :
 *   · **une seule loi** : le nombre vient de `/sim`, le rendu ne le recalcule pas ;
 *   · **N2bis par construction** : un minorant pris sur l'autorité ne peut pas la dépasser ;
 *   · **ça ne touche QUE le corps** : ni le trou du voile, ni la flaque au sol, ni le champ — les
 *     trois gardent exactement la géométrie et l'amplitude calibrées cet après-midi ;
 *   · **ça se vide avec la charge, tout seul** : `clarteDeCeQuOnPorte` rend le profil en d = 0,
 *     c'est-à-dire la charge, et 0 pour une braise vide.
 *
 * ⚠ **`max` PAR CANAL, PAS UNE SOMME** — N1 vaut ici comme dans `/sim` : un corps au pied d'un Feu
 * ET porteur d'une torche ne cumule pas, il prend le plus fort.
 *
 * ⚠ **ET IL N'EST PAS LOCAL À LA BRANCHE E — j'avais écrit l'inverse, la garde ⑱ l'a démenti.**
 * Il se pose en ②bis, sur la lecture du champ, donc AVANT le choix de la branche du feu direct :
 * une face dressée à qui on poserait un `soi` monterait elle aussi, et un corps sous le ciel seul
 * (`ciel: true`) également, son champ fût-il nul. Ce qui restreint la loi aux ACTEURS est
 * l'ALIMENTATION, pas la passe : seul `snapshot-view.ts` écrit un `soi`, et seulement sur la pose
 * d'un acteur — qui est en branche E par ailleurs, mais ce n'est pas ça qui l'y confine.
 */
export function avecCeQuOnPorte(light: Rgb, soi: number | undefined): Rgb {
  if (soi === undefined || !(soi > 0)) return light
  const r = GI.TEINTE_FEU[0] * soi
  const g = GI.TEINTE_FEU[1] * soi
  const b = GI.TEINTE_FEU[2] * soi
  return [Math.max(light[0], r), Math.max(light[1], g), Math.max(light[2], b)]
}

/**
 * LE MULTIPLICATEUR DU CHAMP en un point lu — `M` tel quel s'il a été lu (`LectureDuChamp.m`), sinon
 * recomposé par la loi de LG-R5 (`composerM`, celle de `FRAG_SOMME` et du quad de sol). Mutable :
 * l'appelant le divise.
 */
function multiplicateurLu(l: LectureDuChamp, ciel: CielDeLHeure): [number, number, number] {
  if (l.m !== undefined) return [l.m[0], l.m[1], l.m[2]]
  return [
    composerM(ciel.mn[0], l.ombre, ciel.a, l.light[0]),
    composerM(ciel.mn[1], l.ombre, ciel.a, l.light[1]),
    composerM(ciel.mn[2], l.ombre, ciel.a, l.light[2]),
  ]
}

/**
 * UN PIXEL DE SOL (LG-R14, `CorpsPose.sol`) — le décalque du quad `gi-champ` sur une image qu'il ne
 * couvre pas : le texel fois `M` en UN point, sans normale ni parts. Le point : sous le pixel à sa
 * place logique (`tuile`), ou la ligne du pied (`pied`) ; et sous le voile, divisé par ce que le quad
 * posera à la place DESSINÉE, pour que le produit soit `M(pied)`. Le miroir GLSL est le bloc `uGiSol`
 * de `corps-gpu.ts`.
 */
function pixelDeSol(
  c: CorpsPose,
  sol: NonNullable<CorpsPose['sol']>,
  xw: number,
  yw: number,
  yl: number,
  lire: OracleDuChamp,
  ciel: CielDeLHeure,
  texel: Rgb,
): PixelDuCorps {
  if (sol === 'lueur') {
    // UNE LUEUR (LG-R20) : le texel fois la luminance de la lumière du champ sous le pixel — les poids
    // sont ceux du shader (`lumPlat`), pas ceux de `luminanceDuVoile`. Jamais plus que le texel.
    const l = lire(xw, yl).light
    const k = Math.min(1, 0.299 * l[0] + 0.587 * l[1] + 0.114 * l[2])
    return { rgb: [texel[0] * k, texel[1] * k, texel[2] * k], fAstre: 1, fFeu: 1, ou: 'sol' }
  }
  const m = multiplicateurLu(sol === 'tuile' ? lire(xw, yl) : lire(xw, ligneDuPied(c)), ciel)
  if (sol === 'piedSousLeVoile') {
    // Le quad multipliera ce pixel par `M` à sa place dessinée — jamais nul quand on compose (Mn > 0),
    // et le plancher 1e-3 est celui du shader, pour que les deux chemins divisent la même chose.
    const d = multiplicateurLu(lire(xw, yw), ciel)
    m[0] /= Math.max(d[0], 1e-3)
    m[1] /= Math.max(d[1], 1e-3)
    m[2] /= Math.max(d[2], 1e-3)
  }
  return {
    rgb: [Math.min(1, texel[0] * m[0]), Math.min(1, texel[1] * m[1]), Math.min(1, texel[2] * m[2])],
    fAstre: 1,
    fFeu: 1,
    ou: 'sol',
  }
}

/**
 * UN PIXEL DE CORPS, DE BOUT EN BOUT.
 *
 * L'ORDRE EST LA RÈGLE, et chaque pas dit d'où il vient :
 *
 *  ⓪ `ordonneeLogique` — `(xw, yw)` est le pixel DESSINÉ (le fragment) ; la loi juge à sa place
 *     LOGIQUE, `lift` px plus bas (LG-R14). `c.x`, `c.y` et les sources sont déjà logiques.
 *  ① `pointAuSol` — le plat et l'astre se lisent SOUS LE PIXEL (E) : c'est là que les marches entre
 *     deux pans d'un mur s'effacent. Sur un dessus, c'est une hauteur de crête plus bas.
 *  ①bis `colonneAuPalierDuCorps` — mais jamais AU-DELÀ D'UNE MARCHE (LG-R14) : une colonne qui
 *     déborde sur une voisine d'un autre palier lirait un sol dessiné une terrasse plus haut.
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
 * ⚠ **ET `g` SE PREND TOUJOURS AU POINT DU PIXEL, MÊME QUAND LA PART VIENT D'AILLEURS**
 * (`planche9.mjs:177` : `gF` se calcule en `p`). La géométrie de la normale et l'origine de la part
 * ne viennent pas du même endroit, et les confondre donnerait à toute une face le `g` de son pied —
 * sur un feu à 9,6 px, où `g` double en deux tuiles, cela se verrait. Cela vaut pour les DEUX
 * détournements de la lecture : le pied d'une face dressée (③) et le texel de la garde de palier
 * (①bis), qui déplacent ce qu'on LIT et jamais où l'on est.
 */
export function pixelDuCorps(
  c: CorpsPose,
  xw: number,
  /** L'ordonnée DESSINÉE du pixel — celle du fragment ; voir ⓪. */
  yw: number,
  lire: OracleDuChamp,
  ciel: CielDeLHeure,
  sources: SourcesDuPixel,
  texel: Rgb,
  normale: Normale,
): PixelDuCorps {
  // ⓪ — le pixel dessiné, remonté à sa place logique (identité au sol).
  const yl = ordonneeLogique(c, yw)

  // UN SOL (LG-R14) n'a ni parts ni normale : `texel × M`, et c'est tout — avant la règle des corps.
  if (c.sol !== undefined) return pixelDeSol(c, c.sol, xw, yw, yl, lire, ciel, texel)

  // ① et ② — le point lu, et la répartition qui s'y fait. Un corps qui ne voit que le CIEL (un
  // toit, `CorpsPose.ciel`) se répartit SANS CHAMP : ni lumière, ni ombre — le décalque exact du
  // shader (`corps-gpu.ts`, `uGiCiel`), qui ne lit alors aucune des trois textures.
  // ①bis LA GARDE DE PALIER (LG-R14, `colonneAuPalierDuCorps`) : une colonne qui déborde sur une
  // voisine d'un AUTRE palier retombe sur le texel le plus proche du côté de l'ancre. Elle ne
  // s'applique PAS à un corps sous le ciel seul — il ne lit rien, il n'y a rien à garder —, et le
  // point qu'elle rend sert ensuite à tout, `g` compris : un seul point lu, comme avant elle.
  const brut = pointAuSol(c, xw, yl)
  const p = c.ciel === true ? brut : colonneAuPalierDuCorps(c, brut, lire.grain, lire.palier)
  const sous = c.ciel === true ? SANS_CHAMP : lire(p.x, p.y)
  // ②bis LE PLANCHER DE CE QU'ON PORTE (B-R13d) — `max`, jamais une somme, comme `/sim`.
  let parts: PartsCorps = partsDuCorps(ciel.mn, sous.ombre, ciel.a, avecCeQuOnPorte(sous.light, c.soi), sous.directFace, ciel.ambiante)

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

  // ④ — la normale, AU POINT DU PIXEL (`brut`) pour les deux sources, puis la composition.
  //
  // ⚠ **`brut`, PAS `p` : la garde de palier déplace la LECTURE, jamais la géométrie.** Les deux
  // coïncidaient avant elle, et le commentaire d'alors disait « au point lu ». Ce qu'il voulait dire
  // est « pas au pied quand la part vient du pied » — c'est la géométrie DU PIXEL qui commande `g`,
  // et l'origine de la part est une autre question. Prendre `g` au texel gardé donnerait aux
  // colonnes débordantes un `g` GELÉ pendant que les autres gardent leur dégradé : un aplat au
  // milieu du sprite, exactement le palier que la directive de feel refuse. Invisible sous l'astre
  // (z = 620) ; près d'un Feu (z = 9,6), quelques pixels d'écart en x déplacent `g` sensiblement.
  const fAstre = sources.astre ? facteurDeNormale(normale, brut, sources.astre) : 0
  const fFeu = feu ? facteurDeNormale(normale, brut, feu) : 0
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
