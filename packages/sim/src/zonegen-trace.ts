/**
 * ═══ LE TRACÉ DE L'EAU VIVE — polylignes lissées, estampées au disque ═══
 *
 * *(Décision d'Alexis, 2026-08-30 : « je n'ai pas de soucis à dire qu'on arrête les angles
 * droits pour les lacs et rivières ». R32 — « toute forme de carte est rectiligne » — cesse de
 * gouverner l'EAU ; elle continue de gouverner les zones, les frontières, les falaises, les
 * seuils et le bâti. Consigné dans `docs/decisions.md` et amendé dans `worldgen.md`.)*
 *
 * Ce module ne connaît qu'une chose : **comment poser une bande d'eau le long d'un chemin**.
 * Trois gestes, dans cet ordre :
 *
 *   1. `lisserChaikin` — le corner-cutting de Chaikin : chaque coude devient deux points au
 *      quart et aux trois quarts du segment. Deux passes suffisent à changer un escalier de
 *      Manhattan en courbe ; c'est de l'arithmétique pure (aucune trigonométrie — la spec
 *      ECMAScript ne garantit ni `sin` ni `cos` d'un moteur à l'autre, invariant n°2).
 *   2. `rasteriser4` — la courbe redevient une chaîne de TUILES 4-adjacentes. C'est le contrat
 *      du `fil` : tout ce qui le lit (le champ de courant du client, les gués, `estUnCoude`)
 *      suppose deux tuiles consécutives voisines par un côté.
 *   3. `estamperDisque` — un disque de rayon `r` à chaque tuile du fil. L'union de disques le
 *      long d'une courbe donne une berge LISSE sans qu'on ait à raisonner sur les virages : le
 *      « coude équerré » (le carré plein posé sur le pivot, et sa garde A2ter) n'a plus de
 *      raison d'être — un disque n'a pas de coin extérieur à rater.
 *
 * Le rayon est une FONCTION du rang le long du fil : c'est par là que la rivière grossit vers
 * l'aval et que ses berges cessent d'être parallèles au cordeau.
 */
import { fbm2 } from './noise'

/** Un point du plan, en tuiles. Flottant : le lissage travaille entre les tuiles.
 *  `r` — le rayon du cours d'eau EN CE POINT (tuiles) — voyage avec lui : il est lissé et
 *  interpolé par les mêmes poids que la position, sinon la largeur sauterait aux jointures. */
export interface Point { x: number; y: number; r?: number | undefined }

/**
 * LE LISSAGE DE CHAIKIN — une passe remplace chaque segment [A,B] par [¾A+¼B, ¼A+¾B].
 * Les extrémités sont CONSERVÉES (une rivière doit naître et mourir où on l'a décidé).
 */
export function lisserChaikin(points: readonly Point[], passes: number): Point[] {
  let p = points.slice()
  for (let it = 0; it < passes && p.length >= 3; it++) {
    const q: Point[] = [p[0]!]
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i]!
      const b = p[i + 1]!
      const ra = a.r
      const rb = b.r
      const r1 = ra === undefined || rb === undefined ? ra : ra * 0.75 + rb * 0.25
      const r2 = ra === undefined || rb === undefined ? rb : ra * 0.25 + rb * 0.75
      q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, r: r1 })
      q.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, r: r2 })
    }
    q.push(p[p.length - 1]!)
    p = q
  }
  return p
}

/**
 * LE MÉANDRE — on écarte chaque point de la polyligne de sa NORMALE, d'une quantité tirée du
 * bruit le long du parcours. Deux octaves : la grande boucle, et le tremblement de berge.
 *
 * `amplitude` est en tuiles. Le bruit se lit sur l'abscisse curviligne (le rang du point), pas
 * sur la position : deux rivières parallèles ne se copieront donc pas l'une l'autre.
 */
export function meandrer(points: readonly Point[], amplitude: number, sel: number): Point[] {
  const n = points.length
  if (n < 3 || amplitude <= 0) return points.slice()
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const a = points[i > 0 ? i - 1 : 0]!
    const b = points[i + 1 < n ? i + 1 : n - 1]!
    let tx = b.x - a.x
    let ty = b.y - a.y
    const l = Math.sqrt(tx * tx + ty * ty)
    if (l === 0) { out.push({ ...points[i]! }); continue }
    const rayon = points[i]!.r
    tx /= l
    ty /= l
    // Les BOUTS restent en place, et l'écart croît en cloche vers le milieu : une rivière
    // n'entre pas dans son lac par un crochet, et sa source reste où le col l'a mise.
    const t = i / (n - 1)
    const fenetre = 4 * t * (1 - t)
    const u = fbm2(i, 0, 24, sel) - 0.5
    const v = fbm2(i, 137, 7, sel ^ 0x6d65616e /* 'mean' */) - 0.5
    const e = amplitude * fenetre * (u * 1.4 + v * 0.45)
    out.push({ x: points[i]!.x - ty * e, y: points[i]!.y + tx * e, r: rayon })
  }
  return out
}

/**
 * LA RASTÉRISATION 4-CONNEXE — la courbe redevient une chaîne de tuiles voisines par un côté.
 * Aucun doublon, aucun saut : c'est le contrat que `fil` doit tenir.
 */
export function rasteriser4(points: readonly Point[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  let cx = Math.round(points[0]?.x ?? 0)
  let cy = Math.round(points[0]?.y ?? 0)
  out.push({ x: cx, y: cy })
  for (const p of points) {
    const tx = Math.round(p.x)
    const ty = Math.round(p.y)
    // On rejoint la cible en pas de Manhattan, l'axe le plus en retard d'abord — la chaîne
    // reste 4-connexe et ne fait jamais de diagonale.
    let garde = 0
    while ((cx !== tx || cy !== ty) && garde < 4096) {
      garde++
      if (Math.abs(tx - cx) >= Math.abs(ty - cy)) cx += Math.sign(tx - cx)
      else cy += Math.sign(ty - cy)
      out.push({ x: cx, y: cy })
    }
  }
  return out
}

/**
 * L'ESTAMPAGE — un disque de rayon `r` (en tuiles) autour d'une tuile.
 *
 * `poser` reçoit chaque tuile du disque et décide ; c'est lui qui porte les refus du contexte
 * (hors carte, hors zone, mur, eau déjà là). Le test est EUCLIDIEN et fait au CENTRE des
 * tuiles — un disque, pas un losange ni un carré : c'est ce qui donne une berge courbe.
 */
export function estamperDisque(cx: number, cy: number, r: number, poser: (x: number, y: number) => void): void {
  if (r < 0) return
  const n = Math.floor(r)
  const r2 = r * r
  for (let dy = -n; dy <= n; dy++) {
    for (let dx = -n; dx <= n; dx++) {
      if (dx * dx + dy * dy > r2) continue
      poser(cx + dx, cy + dy)
    }
  }
}

/**
 * ═══ LE PEINTRE D'UN COURS D'EAU — la grammaire commune de tout ce qui coule ═══
 *
 * Une polyligne de points PORTANT LEUR RAYON → lissage de Chaikin → rastérisation 4-connexe
 * segment par segment → un disque estampé à chaque tuile, de rayon interpolé le long du
 * segment. C'est par ce chemin que passent la rivière, les rus du drainage et les chenaux entre
 * lacs : **une seule écriture de « l'eau qui coule »**, donc une seule chose à regarder quand
 * l'œil trouve que ça ne va pas.
 *
 * Le lissage a une conséquence qu'il faut nommer : la courbe COUPE les coins de la polyligne
 * d'entrée. Un chemin de drainage qui suivait exactement ses cellules passe désormais un peu à
 * côté — c'est voulu (l'eau ne suit pas une grille), et c'est sans danger : `poser` refuse tout
 * ce qui ne doit pas être noyé.
 */
export function peindreCoursDEau(points: readonly Point[], passes: number, poser: (x: number, y: number) => void): void {
  if (points.length === 0) return
  const lisse = lisserChaikin(points, passes)
  for (let i = 0; i + 1 < lisse.length; i++) {
    const a = lisse[i]!
    const b = lisse[i + 1]!
    const tuiles = rasteriser4([a, b])
    const n = Math.max(1, tuiles.length - 1)
    const ra = a.r ?? 1
    const rb = b.r ?? 1
    for (let t = 0; t < tuiles.length; t++) {
      estamperDisque(tuiles[t]!.x, tuiles[t]!.y, ra + (rb - ra) * (t / n), poser)
    }
  }
}

/**
 * LE RAYON LE LONG DU FIL — la loi de largeur d'un cours d'eau, en UN endroit.
 *
 * Deux termes, et ils disent deux choses différentes :
 *   — la PENTE amont→aval (`rSource` → `rBouche`) : une rivière grossit en descendant, elle
 *     recueille ses affluents. C'est la hiérarchie, et elle se voit sur la carte.
 *   — le BATTEMENT de berge (bruit lisse le long du parcours, amplitude `bruit`) : sans lui,
 *     deux berges parfaitement parallèles sur soixante tuiles — le défaut MESURÉ le 2026-08-30
 *     sur deux crops à l'échelle d'un écran, celui qui faisait lire « canal ».
 *
 * Exporté parce que la garde du lit s'écrit avec — et parce qu'un rayon calculé à deux endroits
 * finirait par diverger.
 */
export function rayonDuFil(k: number, n: number, rSource: number, rBouche: number, bruit: number, sel: number): number {
  const t = n > 1 ? k / (n - 1) : 0
  const base = rSource + (rBouche - rSource) * t
  return base + (fbm2(k, 0, 34, sel ^ 0x6c617267 /* 'larg' */) - 0.5) * 2 * bruit
}
