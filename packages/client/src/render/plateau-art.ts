/**
 * ═══ LE PLATEAU — le dessus d'une mesa, et la rampe qui l'ouvre (spec `etages.md` §5) ═══
 *
 * L'étage +1 existe dans `/sim` depuis le 2026-08-31 : on y monte, on s'y déplace, le loup en
 * tient compte. **Et l'on ne voyait rien** — CONSTATÉ à la capture (`smoke --scenario mesa`,
 * 2026-09-01) : la butte rendait une masse d'ardoise SOMBRE, plus sombre que le pré autour, avec
 * un mur au sud et aucune ouverture. Elle se lisait comme un trou, pas comme une hauteur, et rien
 * ne disait qu'on pouvait y monter.
 *
 * Deux dessins suffisent à retourner ça, et ils disent la même chose de deux façons :
 *
 * ① **LE SOL DU PLATEAU EST PLUS CLAIR QUE SA PAROI.** C'est LA règle qui fait qu'une masse se
 *    lit comme une hauteur : le dessus prend le ciel, le flanc ne l'a pas. L'ardoise de
 *    `cliff-art` reste ce qu'elle est — le SQUELETTE, la roche brute — et le plateau pose
 *    par-dessus un éboulis clair, de la famille du pierrier qui l'entoure déjà au sol
 *    (`TERRAIN_COLORS[9]`). *Ce qui est en haut est ce qu'on foule ; ce qui est sombre est ce
 *    qu'on longe.*
 *
 * ② **LA RAMPE EST UNE ENTAILLE DANS LE MUR, pas un tapis posé devant.** Elle mange les
 *    `PAROI_RANGEES` rangées de paroi au-dessus d'elle, encadrée par les JOUES de la coupe (deux
 *    pixels de roche restée debout de chaque côté). Sans les joues, une bande claire sur un mur
 *    se lit comme une tache ; avec elles, elle se lit comme un passage.
 *
 * ⚠ **LA VALEUR TOMBE CONTINÛMENT du haut de la rampe à son pied**, sur les trois rangées d'un
 * coup — c'est la leçon que la paroi a déjà payée sur planche (`cliff-art`, « deux rangées à tons
 * plats font une assise de grosses briques ») : dès qu'un motif se referme sur la tuile, la limite
 * de tuile devient un joint de maçonnerie. Ici la pente EST la chute de valeur ; si elle se
 * répétait par rangée, la rampe rendrait un escalier de trois marches identiques, c'est-à-dire
 * rien du tout.
 *
 * ⚠ **LE DESSIN EST PUR, LE RENDU NE L'EST PAS** — même partition que `cliff-art` : chaque figure
 * rend une `RectArt[]`, testable sans navigateur ; `makePlateauTextures` ne fait que la rejouer
 * dans un `Graphics`. Deux dessins d'un même objet dérivent ; il n'y en a qu'un ici.
 */
import type Phaser from 'phaser'
import { TERRAIN_BOULDERS, TERRAIN_JUNIPER_HEATH, TERRAIN_ROCK, TERRAIN_SCREE } from '@ashes/sim'
import { CLIFF_TILE_PX, type RectArt } from './cliff-art'
import { LIFT_TUILES } from './framing'
import { TERRAIN_COLORS } from './terrain-colors'

/**
 * ═══ LA PALETTE DU PLATEAU — L'ARDOISE ÉCLAIRÉE, ET SURTOUT PAS L'ÉBOULIS ═══
 *
 * ⚠ **PREMIER REFUS À L'ŒIL (2026-09-01).** La première écriture ancrait le sol du plateau sur
 * l'éboulis du terrain (`TERRAIN_COLORS[9]` = `0x96928a`) — de la famille du pierrier, ce qui
 * semblait juste sur le papier. À l'écran, la mesa ne se soulevait pas d'un pouce : **une butte
 * nue est CEINTE de ce même éboulis** (la jupe de pierrier que la passe des affleurements pose
 * autour du chapeau), et un dessus à `0x8e8a81` posé au milieu d'une jupe à `0x96928a` n'est pas
 * une hauteur, c'est la même nappe. Il n'y avait plus que la paroi pour dire la marche.
 *
 * La règle qui manquait tient en une phrase : **le dessus d'une butte est la chose la plus CLAIRE
 * du cadre, parce que c'est la seule surface qui regarde le ciel sans rien au-dessus d'elle.** On
 * garde donc la famille de l'ardoise — froide, violette : c'est la MÊME roche que la paroi, et le
 * joueur doit le lire — mais deux fois plus claire que la jupe n'est chaude. Trois valeurs et deux
 * teintes, qu'aucun œil ne peut confondre :
 *
 * | | valeur | teinte |
 * |---|---|---|
 * | la paroi (`cliff-art`) | sombre | froide |
 * | la jupe d'éboulis (le sol) | moyenne | **chaude** |
 * | **le dessus du plateau** | **claire** | froide |
 */
/**
 * ⚠ **DÉRIVÉ DE LA PIERRE depuis le 2026-09-01**, comme la falaise (Alexis : *« une couleur
 * logique — pierre par défaut »*). Il était `0xa7a1ba`, l'ardoise violette inventée : cohérent
 * tant que la paroi l'était aussi, faux dès qu'elle est devenue de la roche. Le dessus d'un
 * plateau et le flanc qui le porte sont LA MÊME PIERRE — l'un regarde le ciel, l'autre non, et
 * c'est tout ce qui les sépare. Le rapport `1,5` est ce que vaut « en plein jour, sans rien
 * au-dessus » : il place le plateau au-dessus de la jupe d'éboulis (147) qui le ceint, ce qui
 * reste la condition n° 1 pour qu'une masse se lise comme une hauteur.
 */
const SOL_BASE = ((): number => {
  const pierre = TERRAIN_COLORS[TERRAIN_ROCK] ?? 0x6d6d70
  const c = (d: number): number => Math.min(255, Math.round(((pierre >> d) & 255) * 1.5))
  return (c(16) << 16) | (c(8) << 8) | c(0)
})()
/**
 * ⚠ **LE GRAIN SE MESURE EN RELATIF, PAS EN ABSOLU — deuxième refus à l'œil (2026-09-01).**
 * Alexis : *« pourquoi la butte semble métallique ? »*. MESURÉ sur le dessin : le plateau rendait
 * un écart-type de **4,8 sur une luminance de 167 — soit 2,9 % de contraste relatif**, quand
 * l'ardoise qu'il remplace en fait **5,3 %** (3,9 sur 73) et la paroi **23 %**. En montant la
 * valeur de 73 à 167 sans monter le grain, j'avais divisé par deux la texture PERÇUE : un aplat
 * clair, lisse et neutre, bordé d'un liseré net, c'est la signature d'une tôle. Les tons de grain
 * s'écartent donc du fond de ±13 % (et non ±6), et ils couvrent trois fois plus de pixels.
 */
const GRAIN_CLAIR = 1.19
const GRAIN_SOMBRE = 0.79
/**
 * ═══ LE SOCLE — CE QU'ON VOIT VRAIMENT PAR LA TRANSPARENCE (Alexis, 2026-09-01) ═══
 *
 * *« Le socle de l'étage doit être noir lorsque je suis en transparence. »* Et c'est une faute de
 * MONDE, pas de goût : le découvert rendait le plateau translucide, donc il laissait voir **le pré
 * qui est DERRIÈRE la mesa** — de l'herbe et des fleurs à l'intérieur d'une masse de roche. Il n'y
 * a pas de pré là ; il y a le dessous du socle, et un dessous de roche ne reçoit aucun ciel.
 *
 * C'est une TEINTE MULTIPLICATIVE posée sur le dessin du sol lui-même, et non un aplat noir : la
 * masse garde donc un souffle de son propre grain, comme une paroi dans l'ombre. Elle se dérive de
 * la pierre au même titre que `SOL_BASE` — repeindre la roche repeint son ombre.
 *
 * `0,10` : à 10 % de la valeur du plateau (163) on tombe vers 16, c'est-à-dire noir à l'œil, mais
 * pas le zéro absolu — un noir pur ferait un TROU découpé, et une masse n'est pas un trou.
 */
/** La part de matière qu'on garde au plus noir — un noir PUR ferait un trou découpé, et une
 *  masse n'est pas un trou. (La cave, elle, a sa propre matière depuis `cave-art.ts`.) */
export const SOCLE_PART = 0.1
export const SOCLE_TEINTE = ((): number => {
  const c = (d: number): number => Math.max(1, Math.round(255 * SOCLE_PART * (((SOL_BASE >> d) & 255) / 255)))
  return (c(16) << 16) | (c(8) << 8) | c(0)
})()
/**
 * LA FENTE : la roche du dessous, vue par l'ouverture. Franchement plus sombre que le grain —
 * c'est une OUVERTURE, pas une nuance ; à mi-ton elle ne ferait qu'une salissure. Elle n'a PAS de
 * lèvre claire : deux bords éclairés autour d'un trait sombre EMBOSSENT la ligne au lieu de la
 * creuser (troisième refus à l'œil).
 *
 * ⚠ Ce sont des FACTEURS, pas des couleurs, et c'est ce qui rend le grain juste sur les trois
 * terrains à la fois : depuis que le terrain commande la teinte, un ton absolu serait faux dès
 * qu'on quitte l'éboulis (un gravier violet sur du genévrier ocre). Ils sont d'ailleurs la forme
 * honnête de la leçon du métal — le grain se mesure en RELATIF.
 */
const GRAIN_FENTE = 0.65
/** Le liseré du bord ouvert : le soleil est au NORD-OUEST (convention de `cliff-art`). Le nord et
 *  l'ouest prennent le jour, l'est passe dans l'ombre. Facteurs, pour la même raison. */
const LISERE_N = 1.32
const LISERE_N2 = 1.16
const LISERE_W = 1.22
const LISERE_E = 0.58

/** La roche restée debout de part et d'autre de l'entaille — la JOUE. Froide : c'est la paroi. */
const JOUE = 0x46434d
const JOUE_LEVRE = 0x615d6a

const P = CLIFF_TILE_PX

/** Combien de rangées la rampe traverse : le LIFT d'un étage (la hauteur qu'elle doit gravir),
 *  plus son TABLIER posé sur le sol du bas. Elle en DÉRIVE — un jour où le lift changerait, une
 *  rampe écrite à part laisserait une marche dans le vide. */
export const RAMPE_RANGEES = LIFT_TUILES + 1
/** Largeur des joues, en pixels. Trois : à deux elles se noyaient dans la paroi voisine. */
const JOUE_PX = 3

const canal = (c: number, d: number, f: number): number => Math.min(255, Math.round(((c >> d) & 255) * f))
const teindre = (c: number, f: number): number =>
  (canal(c, 16, f) << 16) | (canal(c, 8, f) << 8) | canal(c, 0, f)
const lum = (c: number): number =>
  0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)

/**
 * ═══ LA COULEUR D'UN TERRAIN, VU DU DESSUS D'UNE BUTTE ═══
 *
 * *« on doit appliquer le terrain, les nodes, POI etc. comme le reste de la map — on construit une
 * map en terrasse »* (Alexis, 2026-09-01). L'étage porte donc un VRAI terrain (`terrainDeDessus`
 * dans `/sim` : éboulis, blocs, genévrier), et le dessin doit le montrer.
 *
 * ⚠ **ON PREND SA CHROMA, PAS SA COULEUR — et le premier essai a prouvé qu'il le fallait.** Mêler
 * la couleur du terrain à la lumière de la roche puis ramener la valeur rendait `#a8a2ab`,
 * `#aaa2a9`, `#a9a496` pour l'éboulis, les blocs et le genévrier : **trois gris qu'on ne distingue
 * pas**. Normaliser la valeur écrase la différence quand celle-ci EST une différence de valeur —
 * ce qui est le cas de deux roches. On ne peut pas non plus poser les couleurs de terrain telles
 * quelles : le genévrier est ocre, et un plateau ocre au milieu d'une jupe ocre cesse d'être une
 * hauteur (le refus n° 1 — on ne le repaie pas).
 *
 * La règle qui marche sépare les deux axes proprement :
 *
 * ① on ramène le terrain **à la luminance de l'éboulis** — il ne reste que sa CHROMA, la couleur
 *   qu'il aurait à valeur égale, c'est-à-dire ce que l'œil appelle « sa teinte » ;
 * ② on porte cet écart sur `SOL_BASE`, **amplifié** — sous un plein ciel, une terrasse montre ses
 *   matières plus franchement qu'un sous-bois ;
 * ③ on ramène la valeur à la bande du plateau, quel que soit le terrain. C'est elle, et elle
 *   seule, qui dit qu'on est en haut.
 *
 * L'éboulis est l'ÉTALON : il rend exactement `SOL_BASE`. La roche du plateau reste donc celle de
 * sa paroi, et les gardes anti-métal (grain relatif, saturation) portent sur lui.
 */
const ETALON = TERRAIN_SCREE
/** De combien l'écart de chroma est amplifié. À 1, les deux roches sont indiscernables ; au-delà
 *  de ~1,6 le genévrier vire au jaune et le plateau cesse d'être minéral. */
const AMPLI_CHROMA = 1.4

export function souLeCiel(terrainId: number): number {
  const brut = TERRAIN_COLORS[terrainId] ?? SOL_BASE
  const etalon = TERRAIN_COLORS[ETALON] ?? SOL_BASE
  const lb = lum(brut)
  const k = lb <= 0 ? 1 : lum(etalon) / lb
  const canalDe = (d: number): number => {
    const ecart = ((brut >> d) & 255) * k - ((etalon >> d) & 255)
    return Math.max(0, Math.min(255, Math.round(((SOL_BASE >> d) & 255) + ecart * AMPLI_CHROMA)))
  }
  const teinte = (canalDe(16) << 16) | (canalDe(8) << 8) | canalDe(0)
  const lt = lum(teinte)
  return lt <= 0 ? SOL_BASE : teindre(teinte, lum(SOL_BASE) / lt)
}

/**
 * ═══ LES FISSURES TRAVERSENT LES TUILES — sinon c'est un CARRELAGE ═══
 *
 * Le pendant exact des colonnes de `cliff-art` (« à 16 px, tout motif qui se referme sur la tuile
 * se lit comme un joint de maçonnerie »), et il a fallu la même leçon deux fois : un aplat répété
 * à l'identique sur les quatre-vingt-seize tuiles d'un chapeau ne fait pas un terrain, il fait une
 * PLAQUE. Les dalles vivent donc sur une période de `PERIODE_DALLE` tuiles ; la couche choisit la
 * phase par `tx % 4` et `ty % 4`, une fissure enjambe donc plusieurs tuiles et le regard ne trouve
 * plus de grille.
 *
 * Le réseau est décrit UNE FOIS dans l'espace de la période (64 × 64 px), et chaque tuile n'en
 * prend que son carré. C'est ce qui garantit qu'il se raccorde : deux tuiles voisines découpent
 * la même polyligne, elles ne peuvent pas diverger.
 */
export const PERIODE_DALLE = 4
const D = PERIODE_DALLE * P

/**
 * ⚠ **TROISIÈME REFUS À L'ŒIL.** Premier essai de structure : un RÉSEAU de fissures longues, à
 * angles droits, chacune bordée d'une lèvre claire. Le métal avait disparu — remplacé par un
 * **labyrinthe**, ou un circuit imprimé. Trois fautes d'un coup, et elles se cumulent : (a) des
 * segments de 30 à 60 px se lisent comme des TRAITS TRACÉS, pas comme de la roche fendue ;
 * (b) une lèvre claire des deux côtés d'un trait sombre ne creuse pas, elle EMBOSSE — la ligne
 * ressort en relief ; (c) dix segments par période, ça fait une grille, et une grille se répète.
 *
 * La leçon générale : **la variation de grande échelle d'une SURFACE se fait en TACHES DE VALEUR,
 * pas en lignes.** Les lignes sont des objets ; elles attirent l'œil et il faut alors qu'elles
 * veuillent dire quelque chose. Une roche altérée, vue de dessus, c'est d'abord un damier mou de
 * plaques légèrement différentes — et quelques fentes courtes, discrètes, par-dessus.
 */
const FISSURES: readonly (readonly [number, number, number, number])[] = [
  [9, 19, 22, 19], [40, 41, 53, 41], [27, 6, 27, 17], [50, 20, 50, 29], [14, 47, 14, 58],
]

/**
 * LA TACHE DE VALEUR d'une tuile de la période — le damier mou qui remplace le réseau. Un écart
 * de quelques pour cent seulement : au-delà, les plaques se lisent comme des dalles POSÉES, et
 * l'on retombe sur le carrelage qu'on cherchait à fuir.
 */
function tacheDe(phase: number): number {
  let h = Math.imul(phase + 1, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b)
  // Cinq crans centrés : −4 % … +4 %.
  return 1 + (((h >>> 7) % 5) - 2) * 0.02
}

/** Le semis de gravier, dans l'espace de la période — trois fois plus dense qu'au premier jet. */
function gravier(semis: number): Array<[number, number, number, number]> {
  const g: Array<[number, number, number, number]> = []
  // Un hash entier, pur et stable : mêmes cailloux à chaque cuisson, sur tout moteur.
  let h = 0x9e3779b9 ^ Math.imul(semis + 1, 0x85ebca6b)
  for (let k = 0; k < 96; k++) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
    const x = (h >>> 8) % D
    const y = (h >>> 17) % D
    const w = 1 + ((h >>> 3) & 1)
    g.push([x, y, w, (h >>> 2) & 1]) // dernier champ : clair (1) ou sombre (0)
  }
  return g
}
const GRAVIERS = [gravier(0), gravier(1)]

/**
 * LE SOL DU PLATEAU. `mask` encode les bords OUVERTS, comme `dessinDuDessus` : bit 1 = nord,
 * 2 = est, 4 = ouest. C'est là que court le liseré — le trait qui dessine la SILHOUETTE du
 * plateau vu d'en bas, et sans lequel un aplat clair sur une masse sombre n'a pas de forme.
 *
 * `variant` porte DEUX choses, et c'est la recette de la paroi : les quatre bits bas donnent la
 * PHASE dans la période de dalle (`(tx % 4) + 4 * (ty % 4)`, imposée par la position — c'est elle
 * qui fait courir les fissures d'une tuile à l'autre), le bit du dessus le SEMIS de gravier, tiré
 * au hash. La structure marche, le grain ne s'aligne pas.
 */
export function dessinDuSolDePlateau(phase: number, terrainId: number): RectArt[] {
  const base = souLeCiel(terrainId)
  const clair = teindre(base, GRAIN_CLAIR)
  const sombre = teindre(base, GRAIN_SOMBRE)
  const fente = teindre(base, GRAIN_FENTE)
  const px0 = (phase % PERIODE_DALLE) * P
  const py0 = Math.floor(phase / PERIODE_DALLE) * P
  // LA TACHE : le fond de CETTE tuile de la période, à quelques pour cent du ton général.
  const fond = teindre(base, tacheDe(phase))
  const r: RectArt[] = [{ x: 0, y: 0, w: P, h: P, c: fond }]

  /** Pose un rectangle de l'espace de la PÉRIODE, découpé au carré de cette tuile. */
  const poser = (x: number, y: number, w: number, h: number, c: number): void => {
    const x0 = Math.max(x, px0)
    const y0 = Math.max(y, py0)
    const x1 = Math.min(x + w, px0 + P)
    const y1 = Math.min(y + h, py0 + P)
    if (x1 > x0 && y1 > y0) r.push({ x: x0 - px0, y: y0 - py0, w: x1 - x0, h: y1 - y0, c })
  }

  // ── LE GRAVIER, d'abord : les fissures passent PAR-DESSUS (une fente traverse le gravier).
  for (const [x, y, w, estClair] of GRAVIERS[phase & 1]!) {
    poser(x, y, w, 1, estClair === 1 ? clair : sombre)
  }

  // ── LES FENTES : courtes, rares, sans lèvre. Elles ponctuent, elles ne quadrillent pas.
  for (const [ax, ay, bx, by] of FISSURES) {
    if (ay === by) poser(ax, ay, bx - ax, 1, fente)
    else poser(ax, ay, 1, by - ay, fente)
  }
  return r
}

/**
 * LE LISERÉ D'UN BORD OUVERT, en sprite À PART — et c'est une question de BUDGET, pas de goût.
 * Cuit dans la tuile, il multipliait les figures par huit (les combinaisons de bords) ; croisé
 * avec les seize phases de dalle ET les trois terrains, on montait à des centaines de textures
 * générées au boot pour un trait de deux pixels. Il vit donc seul, transparent ailleurs, et ne se
 * pose que sur le POURTOUR d'un plateau — quelques dizaines de sprites par mesa.
 *
 * `cote` : 1 = nord, 2 = est, 4 = ouest. Le soleil est au NORD-OUEST (convention de `cliff-art`) :
 * le nord et l'ouest prennent le jour, l'est passe dans l'ombre et ASSOMBRIT.
 */
export function dessinDuLisere(cote: number, terrainId: number): RectArt[] {
  const base = souLeCiel(terrainId)
  if (cote === 1) {
    return [
      { x: 0, y: 0, w: P, h: 1, c: teindre(base, LISERE_N) },
      { x: 0, y: 1, w: P, h: 1, c: teindre(base, LISERE_N2) },
    ]
  }
  if (cote === 4) return [{ x: 0, y: 0, w: 1, h: P, c: teindre(base, LISERE_W) }]
  return [{ x: P - 1, y: 0, w: 1, h: P, c: teindre(base, LISERE_E) }]
}

/**
 * LA RAMPE — une entaille dans la paroi.
 *
 * `rang` compte du HAUT (0 = la rangée qui débouche sur le plateau) jusqu'à `RAMPE_RANGEES - 1`
 * (le TABLIER, posé sur le sol au pied de la butte). `cotes` encode les JOUES à laisser debout :
 * bit 1 = ouest, bit 2 = est — la couche ne les met qu'aux extrémités de la rampe, jamais entre
 * deux de ses colonnes, sinon l'entaille rendrait trois meurtrières au lieu d'un passage.
 *
 * La valeur du tablier suit la CHUTE CONTINUE (voir l'en-tête) : elle est calculée sur la hauteur
 * TOTALE de la rampe, pas sur la tuile.
 */
export function dessinDeRampe(rang: number, cotes: number): RectArt[] {
  const r: RectArt[] = []
  const hauteur = RAMPE_RANGEES * P
  const crans = Math.floor(hauteur / 7)
  for (let y = 0; y < P; y++) {
    const abs = rang * P + y
    // La hauteur ABSOLUE dans la rampe, de 0 (contre le plateau) à 1 (au pied).
    const t = abs / (hauteur - 1)
    // Elle s'assombrit en descendant : un plan qui bascule vers le bas de l'écran perd le ciel.
    let c = teindre(SOL_BASE, 1 - t * 0.38)
    // ── LES MARCHES, ET ELLES ONT UN NEZ. Une simple ligne sombre tous les sept pixels rendait
    //    un GRILLAGE (constaté à la capture) : à plat, une rayure n'a pas de sens de montée. Une
    //    marche se lit par une PAIRE — la contremarche dans l'ombre, et juste au-dessus le nez
    //    qui prend le jour. C'est ce couple, et lui seul, qui dit d'où vient la lumière, donc
    //    quel côté est le haut.
    if (crans > 0) {
      const dans = ((abs % crans) + crans) % crans
      if (dans === crans - 1) c = teindre(c, 0.62) // la contremarche
      else if (dans === crans - 2) c = teindre(c, 1.16) // le nez, éclairé
    }
    r.push({ x: 0, y, w: P, h: 1, c })
  }
  // ── LES JOUES : la roche que l'entaille n'a pas emportée. Trois pixels — à deux, elles
  //    disparaissaient contre la paroi voisine et la rampe rendait une dalle posée devant le mur.
  //    Une lèvre claire à l'ouest (le soleil est au nord-ouest), rien à l'est : c'est ce
  //    contraste-là qui CREUSE le passage au lieu de le poser.
  if ((cotes & 4) !== 0) {
    r.push({ x: 0, y: 0, w: JOUE_PX, h: P, c: JOUE })
    r.push({ x: JOUE_PX, y: 0, w: 1, h: P, c: JOUE_LEVRE })
  }
  if ((cotes & 2) !== 0) {
    r.push({ x: P - JOUE_PX, y: 0, w: JOUE_PX, h: P, c: JOUE })
    r.push({ x: P - JOUE_PX - 1, y: 0, w: 1, h: P, c: teindre(JOUE, 1.25) })
  }
  return r
}

/** Clé d'une texture de plateau. `sol` = le dessus marchable, `lisere` = son arête éclairée,
 *  `rampe` = l'entaille. */
export function plateauKey(family: 'sol' | 'lisere' | 'rampe', a: number, b: number): string {
  return `pl-${family}-${a}-${b}`
}

/** Les terrains qu'un dessus de butte peut porter (`terrainDeDessus`, /sim). Les textures sont
 *  cuites pour EUX SEULS : la liste est courte parce que la composition l'est. */
export const TERRAINS_DE_PLATEAU: readonly number[] = [TERRAIN_SCREE, TERRAIN_BOULDERS, TERRAIN_JUNIPER_HEATH]

/** Le nombre de figures du sol : une par phase de dalle. (Le semis de gravier a cessé d'être une
 *  variante à part : les seize phases portent déjà chacune le sien, et les trois terrains en
 *  ajoutent autant de jeux — doubler encore n'aurait acheté que des textures.) */
export const VARIANTES_SOL = PERIODE_DALLE * PERIODE_DALLE

/**
 * Génère les textures du plateau — appelé une fois au boot, à côté de `makeCliffTextures`.
 * Sol : 3 terrains × 16 phases de dalle. Liseré : 3 terrains × 3 côtés. Rampe : `RAMPE_RANGEES`
 * rangées × 4 joues. **69 images de 16×16** — moins que `makeCliffTextures` (81).
 */
export function makePlateauTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics()
  const rejouer = (rects: readonly RectArt[], key: string): void => {
    for (const r of rects) g.fillStyle(r.c).fillRect(r.x, r.y, r.w, r.h)
    g.generateTexture(key, P, P)
    g.clear()
  }
  for (const t of TERRAINS_DE_PLATEAU) {
    for (let phase = 0; phase < VARIANTES_SOL; phase++) {
      rejouer(dessinDuSolDePlateau(phase, t), plateauKey('sol', t, phase))
    }
    for (const cote of [1, 2, 4]) rejouer(dessinDuLisere(cote, t), plateauKey('lisere', t, cote))
  }
  for (let rang = 0; rang < RAMPE_RANGEES; rang++) {
    for (const cotes of [0, 2, 4, 6]) rejouer(dessinDeRampe(rang, cotes), plateauKey('rampe', cotes, rang))
  }
  g.destroy()
}

