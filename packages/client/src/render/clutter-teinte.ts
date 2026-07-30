/**
 * ═══ LA TOUFFE PREND LA GAMME DE SON BIOME ═══
 *
 * *(Demande d'Alexis, 2026-07-29 : « il faudrait que les touffes soient dans la gamme de couleur
 * du biome dans lesquels elles sont ».)*
 *
 * Le décor portait UNE teinte pour toute la carte (`CLUTTER_TINT`) : la même touffe olive poussait
 * sur le pré, dans le calciné du sud et sous les mélèzes. Ici elle prend la couleur du sol qui la
 * porte — sans devenir ce sol : une touffe reste une touffe, elle appartient juste à son pays.
 *
 * ── LA RÈGLE N'EST PAS POSÉE, ELLE EST MESURÉE ──
 *
 * On ne réécrit pas huit teintes à la main. On MESURE le rapport qui existe déjà entre le sol du
 * pré (`TERRAIN_COLORS[1]` = #3e7d3a) et la touffe telle qu'elle s'affiche aujourd'hui dessus
 * (art #5a6e33 × teinte 0xbfc4bd = #435526), puis on applique CE rapport à tous les biomes. En
 * TSV, l'écart tient en trois nombres :
 *
 *   • TEINTE — 116° → 82° : la touffe est plus JAUNE que son sol, de 61 % du chemin vers 60°
 *     (l'or). D'où `H' = 60 + F × (H − 60)`, qui vaut pour un sol vert comme pour un sol brun :
 *     partout la touffe tire vers la paille.
 *   • SATURATION — inchangée (0,536 → 0,553, à 3 % près) : la touffe est aussi franche que sa terre.
 *     Un sol délavé (l'alpage fleuri) donne une touffe délavée ; un sol franc, une touffe franche.
 *   • VALEUR — 0,33, CONSTANTE. C'est le seul terme qui ne suit PAS le sol, et c'est délibéré :
 *     la lisibilité du brin ne doit pas dépendre du biome. Une touffe qui suivrait la valeur de sa
 *     terre serait presque noire dans le calciné et blanche dans l'alpage. « Gamme de couleur » se
 *     lit comme la FAMILLE (ton + franchise), pas comme la clarté.
 *
 * Le pré est donc son propre point fixe : la règle lui rend #445527, à 1/255 près de ce qu'il
 * affichait avant ce chantier. Rien ne bouge là où 400 000 tuiles regardaient déjà juste.
 *
 * ── POURQUOI L'ART A GAGNÉ DU BLEU ──
 *
 * Une teinte Phaser MULTIPLIE : elle ne sait qu'assombrir. L'art de la touffe (#5a6e33) n'avait
 * que 51 de bleu — pas de quoi exprimer une touffe grise de marais (58) ni la paille du calciné
 * (64), qui se seraient écrasées à 51 et auraient viré au vert. Le bleu de l'art est donc passé à
 * 66 (#5a6e42), le maximum qu'un biome demande : plus aucun canal ne bute, et la teinte du pré
 * compense (son bleu tombe de 0xbd à 0x98). Le test tient cette borne — art trop sombre = clamp.
 */
import { BIOME_CLUTTER } from './clutter'

/** L'albédo de la touffe, tel que le peignent BootScene et lit-props (À GARDER EN PHASE). */
export const TUFT_ART: readonly [number, number, number] = [0x5a, 0x6e, 0x42]

/** Part du chemin vers l'or (60°) que la touffe garde par rapport à la teinte de son sol.
 *  Mesurée sur le couple historique pré/touffe : 116,4° → 82,0°. */
const VERS_OR = 0.3899
/** Franchise de la touffe rapportée à celle de son sol — mesurée à 1,032, soit « inchangée ».
 *  Elle vaut d'être écrite : c'est ce qui fait retomber le pré EXACTEMENT sur sa couleur d'avant. */
const SATURE = 1.0316
/** La valeur TSV de la touffe — constante, tous biomes confondus (celle de la touffe du pré). */
const VALEUR = 0.33156

function toHsv(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255
  const mx = Math.max(R, G, B)
  const d = mx - Math.min(R, G, B)
  let h = 0
  if (d > 0) {
    if (mx === R) h = 60 * (((G - B) / d) % 6)
    else if (mx === G) h = 60 * ((B - R) / d + 2)
    else h = 60 * ((R - G) / d + 4)
    if (h < 0) h += 360
  }
  return [h, mx === 0 ? 0 : d / mx, mx]
}

function fromHsv(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const p: [number, number, number] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(p[0] + m) * 255, (p[1] + m) * 255, (p[2] + m) * 255]
}

/** La COULEUR que doit avoir la touffe d'un biome — avant qu'on la traduise en teinte. */
export function couleurTouffe(solRgb: number): [number, number, number] {
  const [h, s] = toHsv((solRgb >> 16) & 0xff, (solRgb >> 8) & 0xff, solRgb & 0xff)
  return fromHsv(60 + VERS_OR * (h - 60), Math.min(1, s * SATURE), VALEUR)
}

/** La teinte Phaser qui, appliquée à l'art `TUFT_ART`, rend `couleurTouffe(sol)`.
 *  Les canaux sont bornés par construction si l'art est assez clair — le test le garde. */
export function teinteTouffe(solRgb: number): number {
  const c = couleurTouffe(solRgb)
  let out = 0
  for (let i = 0; i < 3; i++) {
    const v = Math.min(255, Math.max(0, Math.round((c[i]! / TUFT_ART[i]!) * 255)))
    out = (out << 8) | v
  }
  return out
}

/** Les terrains dont le décor comporte des touffes — la liste est DÉRIVÉE de la table de
 *  calibration, jamais recopiée : ajouter `grass_tuft` à un biome suffit à lui donner sa gamme. */
export function terrainsATouffes(): number[] {
  return Object.keys(BIOME_CLUTTER)
    .map(Number)
    .filter((t) => BIOME_CLUTTER[t]!.props.includes('grass_tuft'))
}
