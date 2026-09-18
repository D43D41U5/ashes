/**
 * ═══ LES CORPS — CE QU'UN SPRITE PREND DU CHAMP (spec `lumiere-globale.md` LG-R7, LG-R16) ═══
 *
 * *« UN CORPS A LE RELIEF DE LA GI : LA LUMIÈRE DU SOL, LUE SOUS CHACUN DE SES PIXELS, RÉPARTIE
 * ENTRE SES SOURCES, CHAQUE PART DIRECTIONNELLE PASSÉE PAR SA NORMAL MAP. »* — LG-R7, forme finale.
 *
 * Ce module est l'ORACLE de la RÉPARTITION, et rien d'autre : en un point du sol, il dit comment M se
 * coupe en trois parts. Il ne connaît ni sprite, ni normale, ni pixel. Le shader des corps s'en sert
 * pour composer ; la garde s'en sert pour juger. Pur, sans Phaser ni navigateur, comme `champ-ref`.
 *
 * ═══ POURQUOI TROIS PARTS, ET PAS UN FACTEUR ═══
 * Un corps multiplié par M tout entier serait un aplat : c'est ce que la planche 8 appelait C, et il
 * perdait le relief sur presque toutes les familles. Le relief vient de ce qu'une part DIRECTIONNELLE
 * passe par la normal map (elle frappe une face plus ou moins selon son orientation) tandis que la part
 * PLATE ne le fait pas. Il faut donc séparer ce qui a une direction — le ciel de l'astre, le direct du
 * feu — de ce qui n'en a pas — le plancher, et le rebond, qui vient de partout.
 *
 * ═══ φ NE SE DIVISE JAMAIS ═══
 * LG-R7 écrit « φ sa part directe (gi-ref `directFace`) » et compose avec `L × φ` et `L × (1 − φ)`.
 * φ n'apparaît donc JAMAIS seul : on n'a besoin que de `directFace` et de `light`, pas de leur quotient.
 * C'est ce qui évite une division par zéro quand le feu est éteint (L = 0), et c'est aussi ce qui fait
 * tomber la distinction « sol libre / occludeur » : dans `champ-ref`, `directFace` part en COPIE de
 * `direct` et n'est réécrit que là où `occ === 1`. Les deux tableaux sont donc toujours la même paire —
 * au texel sur du sol libre, sur la face la mieux exposée sur un occludeur. Une seule lecture, sans branche.
 * ⚠ Le corollaire : il faut lire `light`, JAMAIS `direct`, sinon la paire se désaccorde sur les occludeurs.
 *
 * ═══ LA SOMME EST LA GARDE ═══
 *   astre + feu + plat = σ × (Mn·a·(1−S) + P + L) = σ × (Mn − Mn·a·S + L) = σ × (X + L) = M
 * par construction, avec σ = M/(X + L). La seule chose qui rompt cette égalité est le rabat de P sur
 * l'ambiante de l'heure — et c'est VOULU (J, planche 11 : « au soleil bas, un corps a MOINS que le sol »).
 * Un test qui verrait la somme DÉPASSER M verrait un vrai défaut ; la voir tomber dessous est la règle.
 */
import { ambientTint, heureCanonique, lerpColor, multiplicateurDuVoile, voileDeNuit } from '../lighting'

/** Un triplet de lumière linéaire, par canal — la forme de `Emetteur.rgb` et des tableaux de `Champ`. */
export type Rgb = readonly [number, number, number]

/**
 * LA COURBE DE L'AMBIANTE DE L'HEURE — LG-R7 : *« L'ambiante de l'heure est la courbe de l'ambiante
 * Light2D d'aujourd'hui (`dynamic-lighting.ts`, `ambientColor` par heure) […] elle devient une courbe
 * de la spec, à relever à l'implémentation. »*
 *
 * Elle est REDÉCLARÉE ici, pas importée : `dynamic-lighting.ts` tire Phaser, or l'oracle doit rester
 * jouable en test pur. Ses INGRÉDIENTS, eux, sont importés de `render/lighting.ts`, qui n'importe que
 * `@ashes/sim` — donc rien n'est recopié de la chaîne du voile, seuls ces trois nombres le sont, et
 * la garde « la courbe de l'ambiante est celle du jeu » de `corps-ref.test.ts` tient les deux égales.
 * C'est le motif de `GI.ASTRE.HAUTEUR_MUR_PX` (`reglages.ts:47`), gardé par `champ-ref.test.ts:298`.
 */
export const AMBIANTE = {
  /** `AMBIENT_DAY` (`dynamic-lighting.ts:177`) : l'ambiante multiplicative de jour, un gris chaud. */
  JOUR: 0xb6ad9c,
  /** `AMBIENT_NIGHT` (`dynamic-lighting.ts:178`) : l'ambiante de nuit bleutée, relevée. */
  NUIT: 0x33415f,
  /** `MOON_DAWN` (`dynamic-lighting.ts:64`) : au-dessus de ce `daylight`, la lune est éteinte. */
  AUBE_DE_LUNE: 0.15,
} as const

/** `AMBIENT_SANS_LUNE` (`dynamic-lighting.ts:207`) — DÉRIVÉE, pas posée : la nuit noire a son étalon. */
const SANS_LUNE = multiplicateurDuVoile(voileDeNuit(ambientTint(heureCanonique(0)), 0))

/**
 * L'ambiante du ciel à cette heure, en 0xRRGGBB — `ambianteDuCiel(day, lueur)`, terme pour terme.
 * `day` est la part de jour dans [0, 1] ; `lueur` la clarté de la lune, 1 à la pleine lune.
 */
export function ambianteDeLHeure(day: number, lueur = 1): number {
  const d = Math.max(0, Math.min(1, day))
  const part = Math.max(0, (AMBIANTE.AUBE_DE_LUNE - d) / AMBIANTE.AUBE_DE_LUNE) // 0 tant qu'il fait jour
  const manque = 1 - Math.max(0, Math.min(1, lueur)) // ce que la lune NE donne pas
  return lerpColor(lerpColor(AMBIANTE.NUIT, SANS_LUNE, manque * part), AMBIANTE.JOUR, d)
}

/**
 * La luminance d'un triplet, en Rec. 601 — CELLE DU VOILE (`cave-veil.ts:131`), et non la Rec. 709 que
 * `cave-art.ts` emploie pour la roche. Le dépôt porte les deux ; LG-R7 dit « en luminance, à la couleur
 * du voile », donc c'est la sienne qu'on prend. Un nombre dit toujours d'où il vient.
 */
export function luminanceDuVoile(rgb: Rgb): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
}

/** Un 0xRRGGBB en triplet [0, 1] — l'ambiante arrive en couleur, le champ travaille en linéaire. */
export function rgbDeCouleur(c: number): Rgb {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]
}

/**
 * LE `f` DE JOUR (LG-R5) — *« La fraction suit le voile »* (Alexis, 2026-09-16) :
 *
 *   f = ½ + ½ × (1 − Mn) / (1 − Mn_nuit), en luminance
 *
 * ½ en plein jour, environ ⅔ à 19 h, 1 la nuit. Continue, et sans paramètre de plus : le feu grandit
 * avec la pénombre. `mn` est le plancher du voile à l'heure, `mnNuit` celui de la NUIT EN COURS (sa
 * phase de lune comprise, LG-R8) — deux triplets, comparés en luminance.
 *
 * ⚠ La nuit, Mn = Mn_nuit et f vaut exactement 1 : le feu est à pleine force, au bit près, sans que la
 * formule ait à connaître l'heure. C'est la borne qui rend le raccord invisible (LG-R5 : « le noir
 * tombe, il ne claque pas »). Si la nuit est déjà noire (Mn_nuit = 1, impossible en pratique), f = ½.
 */
export function fractionDuFeu(mn: Rgb, mnNuit: Rgb): number {
  // ⚠ LA LUMINANCE DU DÉFICIT, ET NON LE DÉFICIT DE LA LUMINANCE. Les deux sont la même algèbre quand
  // les coefficients somment à 1 — mais en float64 les coefficients de la Rec. 601 somment à
  // 0,9999999999999999, et `1 − luminance([1,1,1])` rend 1,1 × 10⁻¹⁶ au lieu de 0. Écrit dans l'autre
  // sens, « f = ½ en plein jour » n'était exact qu'à un ulp près ; ici il l'est au bit, aux DEUX bornes.
  const ecartDeLaNuit = luminanceDuVoile([1 - mnNuit[0], 1 - mnNuit[1], 1 - mnNuit[2]])
  if (!(ecartDeLaNuit > 0)) return 0.5
  const f = 0.5 + (0.5 * luminanceDuVoile([1 - mn[0], 1 - mn[1], 1 - mn[2]])) / ecartDeLaNuit
  return Math.max(0.5, Math.min(1, f))
}

/**
 * Les trois parts d'un corps en un point du sol (LG-R7), par canal. Elles SOMMENT à M — sauf sous le
 * rabat de l'ambiante, où la somme tombe dessous (J). Chacune multiplie ensuite le texel du sprite :
 * les deux directionnelles à travers la normal map, la plate telle quelle (LG-R7, « La normale »).
 */
export interface PartsCorps {
  /** σ × Mn × a × (1 − S) — le ciel qui a une direction : le soleil, ou la lune à sa phase (LG-R8). */
  readonly astre: Rgb
  /** σ × directFace — le direct du Feu, depuis le Feu. Nul sur un DESSUS (LG-R16, `sansFeuDirect`). */
  readonly feu: Rgb
  /** σ × (P + light − directFace) — le plancher et le rebond : ce qui vient de partout. */
  readonly plat: Rgb
}

const NUL: Rgb = [0, 0, 0]

/**
 * LA RÉPARTITION, AU POINT LU (LG-R7, « Les parts »).
 *
 *   X = Mn × (1 − a × S)          le ciel
 *   M = 1 − (1 − X)(1 − L)        la loi qui compose (LG-R5, `composerM` terme pour terme)
 *   σ = M / (X + L)               ce qui ramène la somme des parts à M
 *
 * `light` et `directFace` arrivent DÉJÀ à leur force de l'heure : c'est l'appelant qui les a multipliés
 * par `fractionDuFeu` (LG-R5, « sur le sol comme sur les corps »). L'oracle ne connaît pas l'heure.
 *
 * `ambiante` est la luminance de l'ambiante de l'heure ; elle ne sert qu'à RABATTRE le plancher du
 * corps, jamais à le lever (J, planche 11 : à midi et la nuit, elle est au-dessus et rien ne bouge).
 * Le rabat garde la COULEUR du voile et ne touche que sa luminance — un corps ne change pas de teinte
 * en passant sous le plancher, il s'assombrit.
 */
export function partsDuCorps(
  mn: Rgb,
  s: number,
  a: number,
  light: Rgb,
  directFace: Rgb,
  ambiante: number,
): PartsCorps {
  // Le plancher du ciel : Mn × (1 − a), la part du ciel qui n'a PAS de direction. C'est `a` tout court
  // et non `a × S` — ce que l'astre éclaire directionnellement est retiré du plat, où que tombe l'ombre.
  const platDuCiel: [number, number, number] = [mn[0] * (1 - a), mn[1] * (1 - a), mn[2] * (1 - a)]
  const lumPlat = luminanceDuVoile(platDuCiel)
  // LE RABAT SUR L'AMBIANTE — en luminance, à la couleur du voile (LG-R7).
  if (lumPlat > 0 && ambiante < lumPlat) {
    const k = ambiante / lumPlat
    platDuCiel[0] *= k
    platDuCiel[1] *= k
    platDuCiel[2] *= k
  }

  const astre: [number, number, number] = [0, 0, 0]
  const feu: [number, number, number] = [0, 0, 0]
  const plat: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const l = Math.max(0, Math.min(1, light[c]!))
    // `directFace` ne peut pas dépasser `light` : c'en est une PART. Au GPU les deux sont lus dans deux
    // cibles distinctes, donc l'arrondi peut les croiser d'un niveau — on le referme ici, pas plus loin.
    const df = Math.max(0, Math.min(l, directFace[c]!))
    const x = mn[c]! * (1 - a * s)
    const somme = x + l
    if (!(somme > 0)) continue // Mn = 0 et pas de feu : M = 0, les trois parts sont nulles.
    const m = Math.min(1, 1 - (1 - x) * (1 - l))
    const sigma = m / somme
    astre[c] = sigma * mn[c]! * a * (1 - s)
    feu[c] = sigma * df
    plat[c] = sigma * (platDuCiel[c]! + l - df)
  }
  return { astre, feu, plat }
}

/**
 * LE DESSUS (LG-R16) — *« LE DESSUS REGARDE LE CIEL : LA PART DES ASTRES SEULE, JAMAIS LA PART DIRECTE
 * DU FEU »* (Alexis, 2026-09-16, planche 22). La flamme est à 10 px au-dessus de son sol, toute crête
 * est à 32 : rien de direct ne monte d'un feu sur un dessus.
 *
 * ⚠ CE QUI RESTE, ET CE QUE LA GARDE DEVRA DIRE. La règle retire la part DIRECTE ; la part plate garde
 * le rebond du feu, puisque LG-R7 la définit comme σ × (P + L × (1 − φ)). Or LG-A17 exige qu'« un dessus
 * rendu feu allumé puis feu éteint soit la même image à 1 niveau près ». Les deux ne peuvent pas être
 * vrais ensemble près d'un foyer : σ change avec L, et le rebond survit. J'implémente LA RÈGLE TELLE
 * QU'ÉCRITE et je laisse la garde MESURER l'écart — c'est un constat à porter à Alexis avec une image,
 * pas un arbitrage à prendre en passant.
 */
export function sansFeuDirect(p: PartsCorps): PartsCorps {
  return avecFeuDeLaFace(p, NUL)
}

/**
 * LA PART DU FEU D'UNE FACE DRESSÉE (LG-R7, O) — on SUBSTITUE le canal du feu, on ne recalcule rien.
 *
 * ⚠ POURQUOI ON NE PEUT PAS SE CONTENTER DE PASSER LE FEU DU PIED À `partsDuCorps`. Sous O, la part
 * directe se lit AU PIED fois l'exposition, tandis que `light` et le plat se lisent SOUS LE PIXEL :
 * les deux ne viennent plus du même point. Or `partsDuCorps` les suppose co-localisés — il écrête
 * `directFace` contre `light` (« c'en est une PART ») et compose `plat = σ × (P + light − directFace)`.
 * Nourri d'un feu venu d'ailleurs, il rognerait la face contre le total d'un AUTRE texel et retirerait
 * au plat un rebond que ce pixel possède vraiment.
 *
 * La forme juste est celle de la composition ratifiée (`planche9.mjs:151`) : le plat et l'astre
 * restent ceux du pixel, intacts ; seul le canal `feu` est remplacé par celui d'un SECOND appel à
 * `partsDuCorps` fait au pied, mis à l'échelle de l'exposition. Deux appels au même oracle, une
 * substitution — jamais une soustraction, qui est ce qui avait tourné les rubans au sarcelle.
 */
export function avecFeuDeLaFace(p: PartsCorps, feu: Rgb): PartsCorps {
  return { astre: p.astre, feu, plat: p.plat }
}

/**
 * ═══ LA COMPOSITION D'UN PIXEL DE CORPS (LG-R7, « La normale ») ═══
 *
 * *« la part plate multiplie le texel tel quel ; chaque part directionnelle multiplie le texel par
 * n·ℓ depuis sa source, portée par g = |pied → source|/z […] sans atténuation avec la distance
 * (la GI la porte déjà), écrêté à 1 par canal. »* — `lumiere-globale.md:168`, au mot.
 *
 *   texel × plat  +  min(1, texel × astre × fA)  +  min(1, texel × feu × fF),  le tout min(1, ·)
 *
 * `fA` et `fF` sont les facteurs de normale des deux sources, `facteurDeNormale` (`sol-du-corps.ts`) :
 * `max(0, n·d)/z`, qui vaut EXACTEMENT 1 sur un dessus plat — c'est ce que la phrase « de sorte
 * qu'un dessus plat reçoit exactement sa part » demande.
 *
 * ⚠ L'ÉCRÊTAGE EST AUX DEUX NIVEAUX, et c'est celui de la composition ratifiée, relevé et non
 * supposé : `planche9.mjs:115` pose `clip = (x) => (x > 255 ? 255 : x)` — HAUT SEULEMENT — et
 * l'applique à chaque terme directionnel (`:183-184`), puis réécrête le total (`:186`). La part
 * plate, elle, n'est pas écrêtée seule : elle ne peut pas dépasser M à elle toute seule.
 *
 * ⚠ RIEN ICI NE PEUT DEVENIR NÉGATIF, et c'est une PROPRIÉTÉ, pas une chance. Les parts sont ≥ 0,
 * le texel est ≥ 0, les facteurs de normale sont écrêtés à 0 : la somme est croissante. Le harnais
 * des planches, lui, comptait des `negatifs` (run 42 : 7 371 pixels au noir sur le mur sud) — ils
 * venaient tous de sa soustraction `base − corpsD`, celle qui retire à l'image d'aujourd'hui ce que
 * Light2D y avait mis. La vraie passe ne soustrait rien : elle REBÂTIT le pixel depuis ses parts,
 * comme un dessus l'était déjà (`dessusSansFeu`, `planche9.mjs:185`). Ce défaut-là ne peut pas
 * revenir, et aucune garde n'a à le guetter.
 */
export function composerLeCorps(texel: Rgb, p: PartsCorps, fAstre: number, fFeu: number): Rgb {
  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const t = texel[c]!
    const direct = Math.min(1, t * p.astre[c]! * fAstre) + Math.min(1, t * p.feu[c]! * fFeu)
    out[c] = Math.min(1, t * p.plat[c]! + direct)
  }
  return out
}
