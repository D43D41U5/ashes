/**
 * LE MANTEAU — la neige au sol et la glace, cuites EN PAVÉS (spec `sol-dessine.md` R16).
 *
 * La neige était une trame de cellules de 4 px, à 91 % d'opacité : on voyait le sol au
 * travers, et elle n'avait pas d'ÉPAISSEUR — un voile, pas une couche. Alexis (2026-08-22) :
 * « la neige devrait être complètement opaque » et « on devrait avoir un peu de hauteur sur
 * la neige, le même type d'effet qu'entre prairie et flower_meadow (liseré + ombre) ».
 *
 * La neige est donc un PAVÉ de `paves.ts`, comme l'herbe sur la litière : frange irrégulière
 * de 2-5 px qui déborde sur le sol nu, liseré sombre sur ses bords bas et latéraux, arête
 * haute claire, ombre portée sur ce qu'elle domine. Opaque par construction. Et la glace est
 * une SURFACE (R13 : pas d'épaisseur), opaque elle aussi, sur laquelle la neige déborde.
 *
 * ═══ UNE TUILE EST NUE, POUDREUSE OU JUSQU'AUX GENOUX (gel.md G9) ═══
 *
 * `neigeAuSol` rend une couverture continue dans [0, 1] ; un pavé n'a pas de demi-mesure. Le
 * NIVEAU d'une tuile est une loi de la sim (`niveauPourCouverture` : un seuil positionnel par
 * tuile, des plaques à l'échelle de quelques tuiles, la profonde au cœur des plaques) — la même
 * qui ralentit le pas. Ici on ne fait que la peindre : la poudreuse est un pavé sur le sol nu,
 * la profonde un pavé sur la poudreuse, avec la même frontière (frange, liseré, ombre).
 *
 * ═══ LA NEIGE NE COUVRE PAS LA GLACE ═══
 *
 * G5 (`gel.md`) : « on ne s'engage jamais sur la glace par surprise », et dans les deux sens —
 * la glace doit se VOIR. La trame plafonnait la neige à la moitié d'une tuile de glace ; le
 * pavé tranche : la glace ne porte pas de neige, le manteau s'arrête à la berge et déborde
 * sur la glace d'une frange avec son ombre — le lac gelé reste une forme lisible, bordée.
 *
 * ═══ CE QUI SE DESSINE OÙ ═══
 *
 * `cuireChunk` rend deux images. Le SOL de la couche : les corps de neige (opaques) et la
 * glace (opaque). Le SURPLOMB : ce que la neige pose SUR une tuile qui n'est pas à elle —
 * sa frange (opaque) et son ombre (un voile noir) sur le sol nu ou sur la glace. Le sol de la
 * couche se pose SOUS le surplomb de la berge (`pave-layer.ts`, +0,29) pour que la berge
 * garde sa frange, son liseré et son ombre sur la glace ; le surplomb du manteau se pose
 * AU-DESSUS, parce que la neige est sur la terre qui est sur l'eau.
 *
 * ═══ ET LE NIVEAU D'EAU, PAR LA MÊME PORTE (spec `saisons.md` S10, 2026-08-24) ═══
 *
 * La neige, la glace et l'eau qui monte sont le MÊME genre de chose : un état de tuile DÉRIVÉ
 * d'une loi de la sim, jamais une tuile qui bouge. Ils partagent donc la couche, la signature
 * par chunk et la cuisson — un seul balayage, une seule image. Trois états de plus (`ASSEC`,
 * `GUE_FERME`, `CRUE`), et ils sont MUTUELLEMENT EXCLUSIFS avec la neige dans les faits : la
 * crue ne se tire qu'à l'Éclosion et la sécheresse ne mord qu'à l'Ardeur.
 *
 * Pur : testé en Node (`manteau.test.ts`).
 */
import { NEIGE_GENOUX, NEIGE_POUDREUSE, fbm2, hash2, type NiveauDeNeige } from '@ashes/sim'
import { moduler } from './zone-ambiance'
import { GRAIN_CELLS } from './grain-sol'
import { ASSEC, CRUE, cuireChunk, soleilDuPavement, DESSOUS, DESSOUS_EAU, GLACE_GUE, GLACE_LAC, GUE_FERME, MANTEAU, MANTEAU_PROFOND, type ChunkCuit } from './paves'

/** Réglages du manteau — ce qui se règle en REGARDANT (da-feeling), pas en jouant. Le SEUIL
 *  d'une tuile et sa distribution, eux, commandent le pas : ils vivent dans `GEL` (`balance.ts`,
 *  `niveauPourCouverture`) — une seule loi pour ce qu'on voit et ce qui ralentit. */
export const NEIGE_PAVE = {
  /** Les teintes, 0xRRGGBB. La poudreuse : blanche à peine bleutée. La profonde : un rien plus
   *  claire et plus froide — c'est son liseré et son ombre qui disent la marche, pas sa teinte.
   *  Le gué gelé : bleu clair, nettement plus bleu que la neige à côté. Le lac gelé : plus
   *  sombre et plus bleu — de la glace sur du noir, celle qui vaut une décision (elle rend
   *  praticable ce qui bloquait). */
  NEIGE: 0xe9eff9,
  NEIGE_PROFONDE: 0xf1f5fd,
  GLACE_GUE: 0xa8cde4,
  GLACE_LAC: 0x7098be,
  /** Le givre de la glace : une cellule de 4 px sur cinq, plus claire — sans lui un aplat lit
   *  « trou dans le rendu » plutôt que « surface gelée ». */
  GIVRE: 1.3,
  GIVRE_PART: 0.2,
} as const

/**
 * LES TROIS RÉGIMES D'EAU (spec `saisons.md` S10) — ce qui se règle en REGARDANT.
 *
 * Le principe de lecture : **le sec est chaud et clair, l'eau est froide, et plus c'est
 * profond plus c'est sombre.** Une mare partie doit se lire « on passe » d'un coup d'œil ;
 * un gué fermé doit se lire « on ne passe plus », et se distinguer FRANCHEMENT du haut-fond
 * clair qu'on traversait la veille — c'est le contrat G5, celui-là même qui a fait de la
 * glace une surface qui se voit.
 */
export const EAU_PAVE = {
  /** LA VASE du fond mis à nu : un limon brun, plus sombre et plus terne que le sable de la
   *  berge (qui vaut ~0xc8b48c) — sinon la mare partie se lit « plage », pas « à sec ».
   *
   *  ⚠ C'EST UNE RÉFÉRENCE, PLUS UN APLAT (2026-08-25). Elle passe par `couleurVase` avant
   *  d'être peinte : la teinte du PAYS la module, le damier et les taches macro la font
   *  respirer. Elle a été rabaissée de 0x8a7c62 d'un peu moins d'un cinquième en même temps —
   *  la modulation de zone RELÈVE la valeur (+7 % mesuré sur la rivière de la seed 2026), et
   *  un lit de rivière est un CREUX qui vient de perdre son eau : il ne doit pas devenir la
   *  zone la plus claire du cadre. Composite mesuré (planche-vase, seed 2026) : luminance
   *  moyenne 109 contre 118 pour l'aplat d'avant, sur une herbe à 88. */
  ASSEC: 0x71664f,
  /** LE GUÉ FERMÉ : une eau trouble et sombre. Nettement plus sombre que le haut-fond du
   *  shader — c'est l'écart qui dit « c'est devenu profond », pas la teinte seule. */
  GUE_FERME: 0x3d5561,
  /** LA CRUE sur la terre : la même eau, mais peu profonde — plus claire, plus verte (elle
   *  charrie ce qu'elle a noyé). Elle et le gué fermé sont la MÊME nappe : deux profondeurs. */
  CRUE: 0x6b8377,
  /**
   * ═══ LA CRAQUELURE — un RÉSEAU, pas un moucheté (Alexis, 2026-08-25) ═══
   *
   * *« Améliore le rendu de la vase lorsque la rivière s'assèche. Ça n'a rien à voir avec le
   * reste du sol et ça rend très mal. »*
   *
   * Elle était une cellule sur trois tirée au hasard, indépendamment de ses voisines, à 84 %
   * de luminance — le remède du givre, recopié. Or **une fente est CONNEXE** : des cellules
   * tirées une à une ne peuvent pas en faire une, quelle que soit leur part. À 4 px sur un
   * ruban de rivière qui traverse la carte, ça ne se lisait pas comme un fond de mare séché,
   * ça se lisait comme du bruit de tramage sur un aplat — la moitié de « ça rend très mal ».
   * (C'est la leçon déjà écrite pour la cendre, un cran plus loin : une même recette ne veut
   * pas dire la même chose selon ce qu'elle doit RE-PRÉSENTER.)
   *
   * La craquelure est donc CELLULAIRE : des germes sur un treillis qui BOUCLE sur les 64
   * cellules de la trame (donc aucune couture au pavage), une plaque par germe, et la fente
   * là où les deux germes les plus proches sont à égale distance — l'arête de Voronoï. Ce
   * sont de vraies plaques polygonales, comme une vasière qui a séché.
   *
   * Trois choses réglées en REGARDANT (planches `trame-essai`, 2026-08-25) :
   *   • `PLAQUE_PAS` — le côté d'une plaque, EN CELLULES de 4 px. À 4 (une tuile) la fente
   *     fait le quart de la plaque : le réseau redevient une mouture, on a retrouvé le
   *     tramage. 8 (deux tuiles) est le seul pas qui tienne à cette quantification.
   *   • `PLAQUE_VARIA` — le seuil de fente varie PAR PLAQUE : deux plaques dont la fente ne
   *     prend pas se lisent comme une seule, plus grande. Sans lui, les plaques sont toutes
   *     de la même taille et le fond de mare se lit comme un PAVAGE de pierres.
   *     ⚠ Ne PAS chercher cette irrégularité en rompant la fente cellule par cellule (essayé,
   *     regardé, jeté) : une fente pointillée à 4 px, c'est le moucheté d'avant.
   *   • `FISSURE` / `PLAQUE_*` — la fente est plus sombre, et chaque plaque garde sa valeur
   *     propre (elle a séché à sa façon).
   */
  PLAQUE_PAS: 8,
  PLAQUE_SEUIL: 0.9,
  PLAQUE_VARIA: 0.5,
  FISSURE: 0.78,
  PLAQUE_MIN: 0.95,
  PLAQUE_AMPLITUDE: 0.06,
  /** LA LÈVRE — la cellule SOUS une fente, éclaircie : le bord d'une plaque qui sèche
   *  rebrousse et prend la lumière. Ombre en haut, lumière en bas : la lecture pixel-art
   *  d'un creux, la même bascule que l'arête haute des pavés — sans elle la fente est un
   *  trait posé SUR la vase, avec elle c'est la vase qui s'ouvre. */
  LEVRE: 1.06,
  /**
   * LE GRAIN DES PLAQUES — la matière sous-tuile du standard (`grain-sol`), dans la vase.
   *
   * La craquelure avait remplacé le grain au lieu de s'y ajouter : l'intérieur d'une plaque
   * était UNI (sa valeur propre, et rien), quand chaque sol du jeu porte un bruit-valeur
   * postérisé en crans francs à la maille 4 px. À l'écran, la seule variation restante était
   * le damier par tuile — la vase se lisait en CARRÉS de 16 px, pas en matière. La recette
   * est celle de `grainFacteur` (fbm2 → trois crans), gamme entre `herbe` et `humide` : un
   * limon sec est plus sourd qu'un marais, et la craquelure occupe déjà la surface.
   *
   * ⚠ LES CRANS NE DESCENDENT JAMAIS DANS LA FENTE : l'intérieur le plus sombre vaut
   * `PLAQUE_MIN × GRAIN_CRANS[2]`, strictement au-dessus de `FISSURE` — c'est ce qui garde la
   * fente et le grain SÉPARABLES en valeur (les gardes de `manteau.test.ts` classent par
   * seuil), et ce qui empêche le grain de refabriquer le moucheté qu'on a jeté.
   *
   * Renforcé le 2026-08-28 (« ça manque encore de textures ») : échelle 2,7 → 2,4 et crans
   * creusés vers la gamme `mineral` — un fond de lit séché est un limon cassant, pas un pré.
   */
  GRAIN_ECHELLE: 2.4,
  GRAIN_CRANS: [1, 0.94, 0.885],
  GRAIN_SEUILS: [0.38, 0.58],
  /**
   * LA VASE RESPIRE COMME LE SOL — le damier par tuile et les taches macro, la loi du bake
   * (`WorldScene.bakeMapTexture`). C'est l'autre moitié de « ça n'a rien à voir avec le reste
   * du sol » : chaque tuile de terre porte une teinte de PAYS, un damier de famille et une
   * seconde échelle de bruit à ~10 tuiles ; la vase, elle, était UN entier, le même d'un bout
   * à l'autre de la carte. Un chenal de trois cents tuiles en une seule couleur.
   *
   * 0,05 → 0,035 le 2026-08-28, en même temps que le grain : la leçon de la neige
   * (`grain-sol`, profil `neige`) vaut ici aussi — sur une surface claire, le damier par
   * tuile se lit comme une GRILLE ; c'est le grain qui porte la matière, la tuile se calme.
   */
  DAMIER: 0.035,
  TACHES: 0.12,
  TACHES_ECHELLE: 10,
  /** LE CLAPOT de la crue : une cellule sur quatre, plus claire — la nappe bouge un peu. */
  CLAPOT: 1.16,
  CLAPOT_PART: 0.25,
} as const

/** L'état d'une tuile vu du manteau. Les niveaux de neige sont ceux de la sim (gel.md G9),
 *  les trois régimes d'eau ceux de `saisons.md` S10. */
export const TUILE_NUE = 0
export const TUILE_NEIGE = 1 // = NEIGE_POUDREUSE
export const TUILE_NEIGE_PROFONDE = 2 // = NEIGE_GENOUX
export const TUILE_GLACE_GUE = 3
export const TUILE_GLACE_LAC = 4
/** L'eau peu profonde à SEC — la mare partie, le gué en poussière (`estAsseche`). */
export const TUILE_ASSEC = 5
/** L'eau peu profonde INFRANCHISSABLE sous la crue (`estGueBloque`) — le seul régime d'eau qui
 *  BLOQUE, donc le seul que G5 rend obligatoire à peindre. */
export const TUILE_GUE_FERME = 6
/** La TERRE passée sous l'eau (`estInonde`) — la crue étalée depuis les rives. */
export const TUILE_CRUE = 7
/** Falaise, mur, vide : le manteau ne s'y dessine pas et ne déborde pas dessus (R10). */
export const TUILE_STRUCTURELLE = -1
/**
 * L'EAU LIBRE — une tuile d'eau à la carte que rien n'a couverte : ni glace, ni vase, ni gué
 * fermé. Le manteau n'y peint RIEN (le shader est dessous), mais elle ne se confond pas avec le
 * sol nu : c'est le rang 0 de la couche, ce sur quoi la vase et la glace débordent (`paves.ts`,
 * `SURFACES`). Sans elle, la mare partie et l'eau profonde étaient à égalité — couture nue.
 *
 * ⚠ SA VALEUR EST ≤ `TUILE_NUE`, et il le faut : le portillon de cuisson (`gel-layer.ts`) tient
 * un chunk pour VIDE tant que tous ses états y sont — l'eau libre ne se peint pas plus que le sol
 * nu, un lac entier ne doit pas coûter une texture. Elle est aussi < `TUILE_GLACE_GUE`, sur quoi
 * l'immersion des acteurs se décide (`WorldScene`, `glaceAt`) : sur l'eau libre, on ne marche pas.
 */
export const TUILE_EAU_LIBRE = -2
export type EtatTuile = -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

/** L'état d'une tuile de terre depuis son niveau de neige (la sim). */
export function tuileDeNiveau(niveau: NiveauDeNeige): EtatTuile {
  return niveau === NEIGE_GENOUX ? TUILE_NEIGE_PROFONDE : niveau === NEIGE_POUDREUSE ? TUILE_NEIGE : TUILE_NUE
}

/** Sous la neige, poudreuse ou profonde. */
export function estNeige(etat: EtatTuile): boolean {
  return etat === TUILE_NEIGE || etat === TUILE_NEIGE_PROFONDE
}

/** Le terrain virtuel de `paves.ts` pour un état de tuile. */
export function terrainDuManteau(etat: EtatTuile): number {
  switch (etat) {
    case TUILE_NEIGE: return MANTEAU
    case TUILE_NEIGE_PROFONDE: return MANTEAU_PROFOND
    case TUILE_GLACE_GUE: return GLACE_GUE
    case TUILE_GLACE_LAC: return GLACE_LAC
    case TUILE_ASSEC: return ASSEC
    case TUILE_GUE_FERME: return GUE_FERME
    case TUILE_CRUE: return CRUE
    case TUILE_EAU_LIBRE: return DESSOUS_EAU
    case TUILE_STRUCTURELLE: return 0 // void : structurel
    default: return DESSOUS
  }
}

/** La couleur d'un terrain virtuel du manteau (le dessous n'en a pas : il est transparent). */
export function couleurDuManteau(t: number): number {
  if (t === MANTEAU) return NEIGE_PAVE.NEIGE
  if (t === MANTEAU_PROFOND) return NEIGE_PAVE.NEIGE_PROFONDE
  if (t === GLACE_GUE) return NEIGE_PAVE.GLACE_GUE
  if (t === GLACE_LAC) return NEIGE_PAVE.GLACE_LAC
  if (t === ASSEC) return EAU_PAVE.ASSEC
  if (t === GUE_FERME) return EAU_PAVE.GUE_FERME
  if (t === CRUE) return EAU_PAVE.CRUE
  return 0
}

/** La trame de la glace : le givre, une cellule sur cinq, positionnel. `GRAIN_CELLS²` facteurs. */
export function trameDeGlace(): Float32Array {
  return trameMouchetee(0x61e, NEIGE_PAVE.GIVRE_PART, NEIGE_PAVE.GIVRE)
}

/**
 * La trame de la VASE : la craquelure — le fond de mare qui a séché en PLAQUES.
 *
 * Un Voronoï à un germe par maille de `PLAQUE_PAS` cellules, le treillis pris MODULO la
 * largeur de la trame : les germes du bord droit sont ceux du bord gauche, donc le motif se
 * pave sans couture (`cuireChunk` l'indexe en `& (GRAIN_CELLS − 1)`). La fente vit là où les
 * deux germes les plus proches sont à égale distance, à `PLAQUE_SEUIL` près — un seuil qui
 * varie par plaque, sinon toutes les plaques ont la même taille et la vase se lit en pavage.
 */
export function trameDeVase(): Float32Array {
  const pas = EAU_PAVE.PLAQUE_PAS
  const L = GRAIN_CELLS / pas // mailles par côté — la boucle du treillis
  const trame = new Float32Array(GRAIN_CELLS * GRAIN_CELLS)
  // Le grain des plaques (recette `grainFacteur` : fbm2 postérisé en trois crans), et sa
  // moyenne — la contrepartie du MULTIPLY, comme `moyenneFamille` : sans elle, donner de la
  // matière à la vase l'assombrirait en silence et déferait le calibrage de `couleurVase`.
  const [s0, s1] = EAU_PAVE.GRAIN_SEUILS
  const cran = (cx: number, cy: number): number => {
    const t = fbm2(cx, cy, EAU_PAVE.GRAIN_ECHELLE, 0x5e5)
    return t < s0 ? EAU_PAVE.GRAIN_CRANS[2]! : t < s1 ? EAU_PAVE.GRAIN_CRANS[1]! : EAU_PAVE.GRAIN_CRANS[0]!
  }
  // ── ① LE RÉSEAU : la fente, sur son masque — la lèvre a besoin de connaître sa voisine. ──
  const fente = new Uint8Array(GRAIN_CELLS * GRAIN_CELLS)
  for (let cy = 0; cy < GRAIN_CELLS; cy++) {
    for (let cx = 0; cx < GRAIN_CELLS; cx++) {
      const gx = Math.floor(cx / pas)
      const gy = Math.floor(cy / pas)
      // Les deux plus proches germes des neuf mailles alentour.
      let d1 = Infinity
      let d2 = Infinity
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const lx = (((gx + ox) % L) + L) % L
          const ly = (((gy + oy) % L) + L) % L
          const fx = (gx + ox + hash2(lx, ly, 0x5e1)) * pas - cx
          const fy = (gy + oy + hash2(lx, ly, 0x5e2)) * pas - cy
          const d = fx * fx + fy * fy
          if (d < d1) { d2 = d1; d1 = d } else if (d < d2) d2 = d
        }
      }
      const seuil = EAU_PAVE.PLAQUE_SEUIL * (1 - EAU_PAVE.PLAQUE_VARIA + 2 * EAU_PAVE.PLAQUE_VARIA * hash2(gx, gy, 0x5e4))
      if (Math.sqrt(d2) - Math.sqrt(d1) < seuil) fente[cy * GRAIN_CELLS + cx] = 1
    }
  }
  // ── ② LES INTÉRIEURS : valeur de plaque × grain × lèvre, la fente restant un aplat (une
  //    ombre n'a pas de grain). La lèvre suit la fente au NORD (le tore : la trame se pave). ──
  const facteur = (cx: number, cy: number): number => {
    const nord = fente[(((cy - 1) & (GRAIN_CELLS - 1)) * GRAIN_CELLS) + cx] ? EAU_PAVE.LEVRE : 1
    return cran(cx, cy) * nord
  }
  // La moyenne des facteurs sur les seuls intérieurs — la contrepartie exacte du MULTIPLY :
  // grain et lèvre compris, la plaque moyenne garde la valeur calibrée du 2026-08-25.
  let somme = 0
  let n = 0
  for (let cy = 0; cy < GRAIN_CELLS; cy++) {
    for (let cx = 0; cx < GRAIN_CELLS; cx++) {
      if (!fente[cy * GRAIN_CELLS + cx]) { somme += facteur(cx, cy); n++ }
    }
  }
  const moyenne = somme / n
  for (let cy = 0; cy < GRAIN_CELLS; cy++) {
    for (let cx = 0; cx < GRAIN_CELLS; cx++) {
      const i = cy * GRAIN_CELLS + cx
      const gx = Math.floor(cx / pas)
      const gy = Math.floor(cy / pas)
      trame[i] = fente[i]
        ? EAU_PAVE.FISSURE
        : (EAU_PAVE.PLAQUE_MIN + EAU_PAVE.PLAQUE_AMPLITUDE * hash2(gx, gy, 0x5e3)) * (facteur(cx, cy) / moyenne)
    }
  }
  return trame
}

/**
 * LA COULEUR D'UNE TUILE DE VASE — la référence, modulée par le PAYS, damée et tachée.
 *
 * C'est la loi du bake (`WorldScene.bakeMapTexture`), appliquée à la seule surface du manteau
 * qui soit un SOL : on y marche, on la voit sur des centaines de tuiles d'affilée. La glace,
 * le gué fermé et la crue restent des aplats — ce sont des nappes, et une nappe est unie.
 *
 * `sol` est la modulation du pays (`zone-ambiance`), ou `undefined` hors zone : la vase de la
 * Vieille Sylve n'est pas celle des Prés Bas, comme l'herbe de l'une n'est pas celle de
 * l'autre. Positionnelle de bout en bout (`hash2`/`fbm2` sur les coordonnées MONDE) : deux
 * cuissons du même chunk sont identiques, et le débord d'un pixel se recuit à l'identique
 * chez le voisin (`PAVE.BAVE`).
 */
export function couleurVase(tx: number, ty: number, sol?: readonly [number, number, number]): number {
  const base = sol ? moduler(EAU_PAVE.ASSEC, sol) : EAU_PAVE.ASSEC
  const d = EAU_PAVE.DAMIER
  let g = 1 - d / 2 + d * hash2(tx, ty, 0xa55)
  g *= 1 + (fbm2(tx, ty, EAU_PAVE.TACHES_ECHELLE, 0x7ac3) - 0.5) * EAU_PAVE.TACHES
  const r = Math.min(255, Math.round(((base >> 16) & 0xff) * g))
  const v = Math.min(255, Math.round(((base >> 8) & 0xff) * g))
  const b = Math.min(255, Math.round((base & 0xff) * g))
  return (r << 16) | (v << 8) | b
}

/** La trame de la CRUE : le clapot, plus clair — la nappe qui bouge un peu. */
export function trameDeCrue(): Float32Array {
  return trameMouchetee(0xc12, EAU_PAVE.CLAPOT_PART, EAU_PAVE.CLAPOT)
}

/**
 * UNE TRAME MOUCHETÉE, positionnelle : une part des cellules de 4 px prend `facteur`, le reste
 * vaut 1. `GRAIN_CELLS²` facteurs, tuilés — c'est ce que le givre faisait déjà, extrait pour
 * que le clapot ne le recopie pas.
 *
 * ⚠ ELLE NE CONVIENT QU'À CE QUI EST VRAIMENT MOUCHETÉ : du givre sur la glace, un clapot sur
 * une nappe. La vase l'a portée jusqu'au 2026-08-25 et c'était une erreur de nature — une
 * craquelure est un RÉSEAU, et des cellules tirées indépendamment n'en font jamais un (voir
 * `trameDeVase`). Ne pas l'y ramener.
 */
function trameMouchetee(sel: number, part: number, facteur: number): Float32Array {
  const trame = new Float32Array(GRAIN_CELLS * GRAIN_CELLS)
  for (let cy = 0; cy < GRAIN_CELLS; cy++) {
    for (let cx = 0; cx < GRAIN_CELLS; cx++) {
      trame[cy * GRAIN_CELLS + cx] = hash2(cx + 7919, cy + 104_729, sel) < part ? facteur : 1
    }
  }
  return trame
}

export interface CuissonManteau {
  cx: number
  cy: number
  /** L'état d'une tuile (coordonnées carte) — hors carte : structurelle. */
  etatAt: (tx: number, ty: number) => EtatTuile
  /** La trame de la neige (famille `neige` de `grain-sol`) et celle de la glace. */
  trameNeige: Float32Array | null
  trameGlace: Float32Array
  /** La craquelure de la vase et le clapot de la crue (spec `saisons.md` S10). */
  trameVase: Float32Array
  trameCrue: Float32Array
  /**
   * LA TEINTE DU PAYS d'une tuile (`zone-ambiance`, `ambianceDe(...).sol`), ou `undefined`.
   *
   * Seule la VASE s'en sert (voir `couleurVase`) : c'est la seule surface du manteau qui soit
   * un sol, et le sol de ce jeu prend la teinte de son pays depuis le bake. Absente, la vase
   * garde sa référence — la cuisson pure des tests n'a pas de carte, et n'en a pas besoin.
   */
  solDeZone?: (tx: number, ty: number) => readonly [number, number, number] | undefined
}

/** Le manteau n'a pas de relief de pavement : un soleil quelconque suffit, et on le hoiste
 *  pour ne pas le rebâtir à chaque chunk. */
const SOLEIL_PLAT = soleilDuPavement(0)

/** Cuit un chunk du manteau : le sol (neige, glace) et le surplomb (frange et ombre de la
 *  neige sur le dessous et sur la glace). Même maille, mêmes chunks que le sol. */
export function cuireManteau(p: CuissonManteau): ChunkCuit {
  return cuireChunk({
    cx: p.cx,
    cy: p.cy,
    // Le manteau ne rend QUE ses propres terrains (neige, glace, vase) : le pavement du lapiaz
    // ne peut pas s'y déclencher, ni la graine ni le soleil n'ont rien à y décider.
    seed: 0,
    soleil: SOLEIL_PLAT,
    terrainAt: (tx, ty) => terrainDuManteau(p.etatAt(tx, ty)),
    couleurAt: (tx, ty) => {
      const t = terrainDuManteau(p.etatAt(tx, ty))
      // LA VASE SEULE VARIE À LA TUILE — les autres sont des nappes, et une nappe est unie.
      return t === ASSEC ? couleurVase(tx, ty, p.solDeZone?.(tx, ty)) : couleurDuManteau(t)
    },
    trameDe: (t) => {
      if (t === MANTEAU || t === MANTEAU_PROFOND) return p.trameNeige
      if (t === GLACE_GUE || t === GLACE_LAC) return p.trameGlace
      if (t === ASSEC) return p.trameVase
      // Le gué fermé et la crue sont la MÊME nappe : même clapot, deux profondeurs.
      if (t === GUE_FERME || t === CRUE) return p.trameCrue
      return null
    },
  })
}
