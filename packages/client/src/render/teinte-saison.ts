/**
 * LA TEINTE DE LA SAISON (spec `saisons.md` S17, décision d'Alexis 2026-08-23).
 *
 * Trois choses seulement changeaient à l'écran avec le froid — le manteau de neige, la glace,
 * les feuillus dénudés. Sous quatre saisons nommées, l'Éclosion et l'Ardeur se seraient donc
 * ressemblées trait pour trait : même herbe, même feuillage, même lumière. La palette des
 * terrains **vivants** glisse maintenant sur la même courbe que la température —
 *
 *     l'Éclosion   vert tendre, un peu pâle : la sève monte
 *     l'Ardeur     vert profond, puis jauni : l'herbe cuit
 *     les Pluies   roux : la feuille tourne
 *     le Grand Froid  gris-brun : il ne reste que la structure
 *
 * ═══ UN FONDU VERS UNE COULEUR, PAS UNE MULTIPLICATION ═══
 *
 * On ne redessine rien et on ne quadruple aucun asset (la refonte du sol — organique + pavés
 * autotile — vient d'être posée). La saison rend une COULEUR CIBLE et une FORCE, et la teinte
 * fond la couleur de l'art vers elle.
 *
 * ⚠ **La première version MULTIPLIAIT, et la planche l'a réfutée en une image.** Un
 * multiplicateur ne peut pas inventer une couleur que l'art n'a pas : appliqué à un sol vert
 * (#3e7d3a) et à une forêt verte (#2c5a2e), il ne rend jamais qu'un vert plus sombre ou plus
 * jaune — l'automne sortait OLIVE, pas roux, et l'hiver ressemblait au printemps. Un fondu, lui,
 * amène la couleur là où la saison la veut tout en gardant les ÉCARTS de l'art (une forêt reste
 * plus sombre que son pré, à toute saison) : c'est ce que fait la force, qui n'est jamais 1.
 * *C'est la règle maison — une question de DA se tranche à l'œil, sur une planche rendue.*
 *
 * ═══ CONTINUE, COMME TOUT LE RESTE DE L'ANNÉE ═══
 *
 * Quatre cardinaux au cœur des saisons, interpolation linéaire cyclique : l'automne roussit
 * **progressivement** au lieu de basculer un matin. C'est la même forme que la courbe du socle,
 * et c'est voulu — le monde ne doit pas changer de couleur à une frontière que le calendrier
 * seul connaît.
 *
 * ⚠ **ELLE NE S'APPLIQUE QU'AU VIVANT.** La roche, l'eau, le mur, la route ne tournent pas avec
 * la saison ; seuls l'herbe, le feuillage, le sous-bois et la lande la portent. C'est la raison
 * pour laquelle la teinte n'est PAS un voile posé sur toute la couche : un voile roux sur un
 * lac en automne dirait n'importe quoi.
 */

/** Une couleur CIBLE et la part du chemin qu'on fait vers elle (0 = l'art intact). */
export interface TeinteSaison {
  cible: number
  force: number
}

export interface Cardinal {
  jour: number
  teinte: TeinteSaison
}

/**
 * Les quatre cardinaux, au cœur de chaque saison — l'équinoxe vaut la moyenne de ses voisins.
 *
 * EXPORTÉS le 2026-08-24 pour les bandes du ruban de saison (barre haute) : la bande d'une
 * saison porte la couleur que le SOL portera, pas un accent de HUD choisi à côté. Quatre
 * teintes recopiées ailleurs auraient dérivé au premier réglage — c'est l'histoire que
 * `palette.ts` raconte déjà.
 */
export const CARDINAUX: readonly Cardinal[] = [
  // mi-Éclosion : vert tendre, presque acide — la sève monte, tout est neuf.
  { jour: 15, teinte: { cible: 0x8ac54a, force: 0.3 } },
  // mi-Ardeur : l'or de l'herbe qui cuit — le vert tient encore dessous.
  { jour: 45, teinte: { cible: 0xc2a52e, force: 0.34 } },
  // mi-Pluies : LE ROUX. La force est la plus haute de l'année : c'est la saison qui se voit.
  { jour: 75, teinte: { cible: 0xb2591c, force: 0.55 } },
  // mi-Grand Froid : gris-bleu éteint — il ne reste que la structure.
  { jour: 105, teinte: { cible: 0x74788c, force: 0.55 } },
]

const ANNEE = 120

/** Le jour de l'année, dans [1, 120] — la même arithmétique que `jourDeLAnnee` de `/sim`,
 *  recopiée ici pour que la couche de rendu n'ait pas à connaître le calendrier entier. */
function dansLAnnee(jour: number): number {
  const j = Math.floor(jour) - 1
  return (((j % ANNEE) + ANNEE) % ANNEE) + 1
}

/**
 * LA TEINTE DU JOUR — interpolation linéaire cyclique entre les quatre cardinaux. Pure, sans
 * allocation cachée, et sûre pour tout jour (négatif, énorme, fractionnaire).
 */
export function teinteSaisonniere(jour: number): TeinteSaison {
  const j = dansLAnnee(jour)
  const n = CARDINAUX.length
  let i = n - 1 // le segment qui enjambe le tour de l'an, et celui d'avant le premier cardinal
  for (let k = 0; k < n - 1; k++) {
    if (j >= CARDINAUX[k]!.jour && j < CARDINAUX[k + 1]!.jour) i = k
  }
  const a = CARDINAUX[i]!
  const b = CARDINAUX[(i + 1) % n]!
  const borneA = a.jour
  const borneB = i === n - 1 ? CARDINAUX[0]!.jour + ANNEE : b.jour
  const jj = j < borneA ? j + ANNEE : j
  const u = (jj - borneA) / (borneB - borneA)
  // La CIBLE se fond canal par canal (deux couleurs interpolées restent une couleur), la FORCE
  // linéairement : entre deux saisons, le sol passe de l'une à l'autre sans jamais repasser par
  // l'art nu — ce qui ferait un « clignotement » de saturation à chaque équinoxe.
  const melange = (c1: number, c2: number, t: number): number => {
    const r = Math.round(((c1 >> 16) & 0xff) + (((c2 >> 16) & 0xff) - ((c1 >> 16) & 0xff)) * t)
    const g = Math.round(((c1 >> 8) & 0xff) + (((c2 >> 8) & 0xff) - ((c1 >> 8) & 0xff)) * t)
    const b = Math.round((c1 & 0xff) + ((c2 & 0xff) - (c1 & 0xff)) * t)
    return (r << 16) | (g << 8) | b
  }
  return {
    cible: melange(a.teinte.cible, b.teinte.cible, u),
    force: a.teinte.force + (b.teinte.force - a.teinte.force) * u,
  }
}

/**
 * La teinte appliquée à une couleur 0xRRGGBB — le seul point d'application.
 *
 * Un FONDU vers la cible, jamais un remplacement : à force 0,55 il reste 45 % de l'art, donc
 * l'écart entre une forêt et son pré survit à toutes les saisons. C'est ce qui distingue une
 * saison d'un filtre posé sur l'écran.
 */
export function teinter(couleur: number, teinte: TeinteSaison): number {
  const f = teinte.force
  const r = Math.round(((couleur >> 16) & 0xff) * (1 - f) + ((teinte.cible >> 16) & 0xff) * f)
  const g = Math.round(((couleur >> 8) & 0xff) * (1 - f) + ((teinte.cible >> 8) & 0xff) * f)
  const b = Math.round((couleur & 0xff) * (1 - f) + (teinte.cible & 0xff) * f)
  return (r << 16) | (g << 8) | b
}

/**
 * ═══ LA TEINTE D'UNE FAMILLE DE TONS — et pourquoi ce n'est PAS `teinter` cinq fois ═══
 *
 * *(Décision d'Alexis, 2026-08-25, sur planche rendue : loi ③, « base + panachage ».)*
 *
 * Un houppier n'est pas un aplat : c'est une famille de cinq tons (masse, corps, lumière,
 * éclat, ombre) dont les ÉCARTS font le relief des pavés — et dont l'écart d'une famille à
 * l'autre fait la LISIÈRE entre deux cimes qui se touchent. Fondre les cinq tons
 * indépendamment les rapproche tous de la cible : au cœur des Pluies (force 0,55), l'écart
 * entre le hêtre et le bouleau tombe de **50 à 23** — MESURÉ, et c'est exactement la NAPPE que
 * la séparation des trois pins avait corrigée le 2026-07-29. La lumière du jeu ne la rattrape
 * pas : deux cimes voisines reçoivent le MÊME éclairage, donc une frontière absente de
 * l'albédo n'existe nulle part.
 *
 * On fond donc le seul ton `corps` et on TRANSLATE les quatre autres du même delta : la
 * famille change de couleur, ses écarts internes survivent intacts.
 *
 * ⚠ **LE DELTA SE BORNE, il ne se clampe pas ton par ton.** Un canal qui sature sur l'`éclat`
 * pendant que les autres passent ROUVRE le problème qu'on vient de fermer — il écrase l'écart
 * de ce ton-là, en silence. On cherche donc le plus grand `k ≤ 1` tel qu'AUCUN des cinq tons
 * ne sorte de [0, 255], et on applique `k · delta` à tout le monde : la direction du virage
 * est gardée, l'amplitude cède, et les écarts sont exacts par construction.
 */
export function teinterFamille<T extends { corps: string }>(tons: T, teinte: TeinteSaison): T {
  const canal = (c: string, dec: number): number => (parseInt(c.slice(1), 16) >> dec) & 0xff
  const base = parseInt(tons.corps.slice(1), 16)
  const cible = teinter(base, teinte)
  const d = [16, 8, 0].map((dec) => ((cible >> dec) & 0xff) - ((base >> dec) & 0xff))

  // LE FACTEUR COMMUN : la plus petite part du delta qui laisse les cinq tons dans les bornes.
  let k = 1
  for (const c of Object.values(tons as Record<string, string>)) {
    for (let i = 0; i < 3; i++) {
      const v = canal(c, [16, 8, 0][i]!), delta = d[i]!
      if (delta > 0 && v + delta > 255) k = Math.min(k, (255 - v) / delta)
      else if (delta < 0 && v + delta < 0) k = Math.min(k, v / -delta)
    }
  }

  const out: Record<string, string> = {}
  for (const [nom, c] of Object.entries(tons as Record<string, string>)) {
    const v = [16, 8, 0].map((dec, i) => Math.round(canal(c, dec) + d[i]! * k))
    out[nom] = '#' + (((v[0]! << 16) | (v[1]! << 8) | v[2]!) >>> 0).toString(16).padStart(6, '0')
  }
  return out as T
}

/**
 * LE PANACHAGE — la force du virage GIGUE d'une grappe à l'autre (loi ③).
 *
 * Une cime qui tourne ne tourne pas d'un bloc : il reste des pavés verts pendant que d'autres
 * sont déjà roux. La gigue est PROPORTIONNELLE à la force de la saison, donc l'Ardeur reste
 * unie (force 0,34) et les Pluies se panachent franchement (0,55) — sans qu'aucun nombre ne
 * dise « en automne, panache » : c'est la même courbe continue que tout le reste de l'année.
 *
 * ⚠ **LE PANACHAGE EST CUIT PAR (variante, cime), pas par arbre** : cinq motifs par essence,
 * comme les cinq cimes dont il hérite la graine. Deux hêtres qui partagent un index de cime
 * portent le même panachage — c'est la contrainte que les cinq cimes portent déjà depuis le
 * 2026-07-30, et elle suffit à casser la grille d'une futaie pure.
 */
export const PANACHAGE = {
  /** La force d'une grappe vaut `force × (MIN + AMPLITUDE × u)`, `u` tiré sur son index. */
  MIN: 0.35,
  AMPLITUDE: 1.3,
  /** Plafond dur : au-delà, la grappe n'a plus rien de l'art et la famille se dissout. */
  MAX: 0.85,
} as const

export function panachageDeFamille<T extends { corps: string }>(
  tons: T, jour: number, tirage: (index: number) => number,
): (index: number) => T {
  const { cible, force } = teinteSaisonniere(jour)
  const cache = new Map<number, T>()
  return (index) => {
    let v = cache.get(index)
    if (v === undefined) {
      const f = Math.min(PANACHAGE.MAX, force * (PANACHAGE.MIN + PANACHAGE.AMPLITUDE * tirage(index)))
      v = teinterFamille(tons, { cible, force: f })
      cache.set(index, v)
    }
    return v
  }
}

/**
 * ═══ LE CRAN DE SAISON — DEUX JOURS, ET C'EST UNE MESURE, PAS UN GOÛT ═══
 *
 * La teinte est CONTINUE, mais rien de ce qui se MÉMOÏSE ou se CUIT ne peut l'être : la couleur
 * d'un chunk de sol est dans son image, celle d'une cime est dans sa texture. Il faut donc un
 * PAS, et le pas décide de deux choses opposées — la taille du saut, et la fréquence des
 * recuissons.
 *
 * Il valait DIX JOURS (hérité de `clutter-layer`, où il ne commandait qu'une mémoïsation de
 * teinte : aucun saut, puisque le décor se repose à chaque image). Le jour où le SOL est entré
 * par la même porte, ce dix est devenu un saut de tout l'écran — MESURÉ sur la palette :
 *
 *     cran de 10 j → saut de 24 (herbe, forêt, lande, vieille forêt : 24-25)
 *     cran de  5 j → 13
 *     cran de  3 j → 8
 *     cran de  2 j → 6      ← la marche d'un jour vaut 4 : on est au grain de la courbe
 *
 * Et le coût va dans l'autre sens, mais il est petit : un jour de saison vaut **30 minutes
 * réelles** (`CYCLE_REAL_MINUTES`), donc un cran de deux jours est une heure de jeu. À chaque
 * heure : une douzaine de chunks de sol recuits au budget (5,5 à 10,9 ms pièce, deux par image)
 * et 35 albédos de cime, eux aussi étalés. Contre un saut de 24 toutes les cinq heures.
 *
 * ⚠ **CE N'EST PAS UN NOMBRE LIBRE** : `clutter-layer` mémoïse par `(terrain, cran)`, et sa clé
 * était empaquetée sur quatre bits (`terrain * 16 + cran`) — douze crans y tenaient, soixante
 * non. La clé a été élargie en même temps que ce nombre a bougé.
 */
export const CRAN_SAISON = 2

/** Le cran de ce jour-là, dans [0, 11]. */
export function cranDeSaison(jour: number): number {
  return Math.floor((dansLAnnee(jour) - 1) / CRAN_SAISON)
}

/**
 * ═══ LES TERRAINS QUI TOURNENT AVEC LA SAISON — le VIVANT, et lui seul ═══
 *
 * Ni roche, ni eau, ni route, ni mur, ni neige, ni glacier : ceux-là sont hors du temps, ou déjà
 * commandés par le gel. Ni la cendre : elle est morte, et son refroidissement est sa propre loi.
 *
 * ⚠ **TROIS TERRAINS VIVANTS Y MANQUAIENT, ET ON NE POUVAIT PAS LE VOIR** (corrigé le
 * 2026-08-25) : `flower_meadow`, `alpine_flowers` et `juniper_heath`. Tant que la teinte ne
 * servait qu'à la TOUFFE (`clutter-layer`), une omission ne faisait qu'une touffe non teintée
 * au milieu d'autres — invisible. Le jour où le SOL est entré par la même porte, elle est
 * devenue une **dalle verte en plein automne**, avec une frontière franche là où deux prés se
 * touchent. Vu sur capture, pas déduit.
 *
 * ⚠ **ET LA TABLE EST DÉSORMAIS UNE PARTITION TOTALE.** Une liste de « ceux qui tournent »
 * laisse tout terrain NOUVEAU tomber du côté mort, en silence — c'est ce qui vient d'arriver.
 * `TERRAINS_HORS_SAISON` nomme donc explicitement les autres, et une garde affirme que les deux
 * ensembles couvrent `TERRAIN_COLORS` sans se chevaucher : ajouter un terrain oblige à choisir.
 */
export const TERRAINS_VIVANTS: ReadonlySet<number> = new Set([
  1, // herbe
  3, // forêt
  8, // marais
  11, // lande
  12, // alpage
  13, // pin
  14, // mélèze
  17, // pré fleuri
  18, // tourbière
  19, // roselière
  20, // alpage fleuri
  22, // vieille forêt
  24, // saulaie
  25, // prairie humide
  26, // lande à genévriers — le dos SEC, mais c'est une lande : `heath` tourne, elle aussi
  30, // clairière
])

/** L'AUTRE MOITIÉ DE LA PARTITION — ce qui ne tourne pas, et pourquoi. Écrit, pas déduit. */
export const TERRAINS_HORS_SAISON: ReadonlySet<number> = new Set([
  0, // le vide
  2, // route — taillée, pas poussée
  4, 6, // eaux
  5, 9, 16, 23, // roche, éboulis, chaos, falaise — le minéral est hors du temps
  7, // mur
  10, 15, // neige, glacier — déjà commandés par le gel
  21, // forêt brûlée — morte
  27, 28, 29, // les cendres — mortes, et leur refroidissement est leur propre loi
])

/** La teinte à appliquer à CE terrain ce jour-là — l'identité sur ce qui ne vit pas. */
const NEUTRE: TeinteSaison = { cible: 0x000000, force: 0 }

export function teinteDuTerrain(terrain: number, jour: number): TeinteSaison {
  return TERRAINS_VIVANTS.has(terrain) ? teinteSaisonniere(jour) : NEUTRE
}
