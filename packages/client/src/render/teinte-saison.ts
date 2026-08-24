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
 * LES TERRAINS QUI TOURNENT AVEC LA SAISON — le VIVANT, et lui seul. Ids de `TERRAINS`
 * (`/sim/balance.ts`) : herbe, forêt, marais, lande, alpage, pin, mélèze, prairie humide,
 * roselière, tourbière, saulaie, vieille forêt. Ni roche, ni eau, ni route, ni mur, ni neige,
 * ni glacier : ceux-là sont hors du temps, ou déjà commandés par le gel.
 */
export const TERRAINS_VIVANTS: ReadonlySet<number> = new Set([1, 3, 8, 11, 12, 13, 14, 18, 19, 22, 24, 25])

/** La teinte à appliquer à CE terrain ce jour-là — l'identité sur ce qui ne vit pas. */
const NEUTRE: TeinteSaison = { cible: 0x000000, force: 0 }

export function teinteDuTerrain(terrain: number, jour: number): TeinteSaison {
  return TERRAINS_VIVANTS.has(terrain) ? teinteSaisonniere(jour) : NEUTRE
}
