/**
 * LE FORMAT `.plan` — un fichier texte par lieu bâti (spec `atelier-plans.md`, décision
 * d'Alexis du 2026-08-10).
 *
 * Le fichier porte SES commentaires (lignes `#`) : la prose narrative d'un lieu vit avec sa
 * grille, et l'éditeur la préserve (sauvegarde chirurgicale — seules les lignes de données
 * changent). Le nom du fichier est le kind ; ce module ne connaît QUE le texte : parser et
 * sérialiser sont purs (zéro fs, zéro Node — `/sim` tourne au navigateur, et l'Atelier
 * s'appuie dessus).
 *
 * La grammaire, volontairement petite :
 *   - `#` en tête de ligne = commentaire ; ligne vide = rien ;
 *   - `cle: valeur` — `usure` (nombre, requis), `breches`/`seuils`/`passages` (triplets
 *     `x,y,D` séparés d'espaces), `fixe` (`oui`) ;
 *   - `grille:` en DERNIER : toutes les lignes non vides / non-`#` qui suivent sont les
 *     rangées, verbatim.
 */

export interface Plan {
  /**
   * LE PLAN NE DÉCRIT QUE DES RÉGIONS ET LEUR CONTENU — les murs se DÉRIVENT du pourtour.
   *
   * C'est la conséquence directe du modèle d'arête : un mur n'est plus une tuile qu'on pose,
   * c'est une propriété du contour d'une salle. Une salle de 6×4 s'écrit donc 6×4, et ses
   * vingt-quatre tuiles sont TOUTES praticables — là où l'ancien plan en réclamait 8×6 pour en
   * rendre quinze.
   */
  readonly grille: readonly string[]
  /**
   * L'USURE — la fraction de PV que gardent les murs. Elle n'est pas cosmétique : le client
   * assombrit à mesure, et bascule sol et toit sur leurs textures ruinées. 1 = neuf.
   */
  readonly usure: number
  /**
   * LES BRÈCHES — des arêtes du pourtour SANS mur (`"x,y,D"`). **C'est ici que vit la ruine.**
   * Elle ne se dit plus en tuiles retirées mais en contour percé : le pan est écroulé, et c'est
   * par là qu'on entre.
   */
  readonly breches?: readonly string[]
  /** LES SEUILS — les arêtes qui portent un encadrement (l'entrée du bâtiment). */
  readonly seuils?: readonly string[]
  /** LES PASSAGES — les arêtes de clôture laissées nues : on entre dans la cour sans porte. */
  readonly passages?: readonly string[]
  /**
   * L'ORIENTATION FIXE — le lieu se pose TEL QU'IL EST ÉCRIT, sans quart de tour.
   *
   * Par défaut un bâti tourne (`hash2` sur sa position) : deux fermes ne se ressemblent pas, et
   * on ne lit pas le monde comme un catalogue. Mais quand la LECTURE d'un plan dépend de son
   * orientation à l'écran, la variété coûte plus qu'elle ne rapporte — le plan le déclare ici,
   * et il est alors écrit dans le sens où on le verra.
   */
  readonly fixe?: boolean
}

/** Les clés de métadonnées connues — tout le reste est une faute, jamais un silence. */
const CLES = new Set(['usure', 'breches', 'seuils', 'passages', 'fixe', 'grille'])

/** Une ligne de MÉTADONNÉE connue (`usure: …`) — et jamais une rangée de grille : les
 *  caractères de légende ne forment pas `motminuscule:`. */
const LIGNE_CLE = /^([a-z]+):\s*(.*)$/

const TRIPLET = /^\d+,\d+,[NESO]$/

function triplets(valeur: string, cle: string): readonly string[] {
  const liste = valeur.split(/\s+/).filter(Boolean)
  for (const t of liste) {
    if (!TRIPLET.test(t)) throw new Error(`« ${cle} » : triplet invalide « ${t} » (attendu x,y,D avec D ∈ NESO)`)
  }
  return liste
}

/**
 * TEXTE → PLAN. Toute entrée douteuse ÉCHOUE avec un message en français — un plan qui se
 * parse à moitié bâtirait un lieu à moitié, et personne ne verrait lequel.
 * (La géométrie fine — carré, empreinte, caractères connus — reste le travail de
 * `verifierPlans` : une seule loi, pas deux.)
 */
export function parserPlan(texte: string): Plan {
  const lignes = texte.split('\n')
  let usure: number | undefined
  let breches: readonly string[] | undefined
  let seuils: readonly string[] | undefined
  let passages: readonly string[] | undefined
  let fixe = false
  const grille: string[] = []
  let dansGrille = false
  for (const brute of lignes) {
    const ligne = brute.replace(/\r$/, '')
    if (ligne.trim() === '' || ligne.trimStart().startsWith('#')) continue
    const m = LIGNE_CLE.exec(ligne)
    if (m && CLES.has(m[1]!)) {
      const [, cle, valeur] = m as unknown as [string, string, string]
      dansGrille = false
      if (cle === 'grille') { dansGrille = true; continue }
      if (cle === 'usure') {
        usure = Number(valeur)
        if (!Number.isFinite(usure) || usure <= 0 || usure > 1) throw new Error(`« usure » : « ${valeur} » n'est pas une fraction dans ]0, 1]`)
      } else if (cle === 'fixe') {
        if (valeur !== 'oui') throw new Error(`« fixe » : « ${valeur} » (la seule valeur admise est « oui » — l'absence de la ligne dit « ça tourne »)`)
        fixe = true
      } else if (cle === 'breches') breches = triplets(valeur, cle)
      else if (cle === 'seuils') seuils = triplets(valeur, cle)
      else if (cle === 'passages') passages = triplets(valeur, cle)
      continue
    }
    if (m && !dansGrille) throw new Error(`clé inconnue « ${m[1]} » — les clés admises : ${[...CLES].join(', ')}`)
    if (!dansGrille) throw new Error(`ligne inattendue avant « grille: » : « ${ligne} »`)
    grille.push(ligne)
  }
  if (usure === undefined) throw new Error('« usure » manquante — un plan sans usure ne dit pas s’il est neuf ou ruiné')
  if (grille.length === 0) throw new Error('grille vide — un plan sans grille ne bâtit rien')
  const plan: { -readonly [K in keyof Plan]?: Plan[K] } = { usure, grille }
  if (breches?.length) plan.breches = breches
  if (seuils?.length) plan.seuils = seuils
  if (passages?.length) plan.passages = passages
  if (fixe) plan.fixe = true
  return plan as Plan
}

/**
 * PLAN → TEXTE, CHIRURGICAL : on repart du texte ORIGINAL et l'on ne touche que les lignes
 * de données — chaque ligne `#` (la prose du lieu) survit à l'éditeur, à sa place.
 *
 * Méthode : les lignes de métadonnées existantes sont réécrites (ou retirées si la donnée
 * est partie) ; les manquantes s'insèrent avant `grille:` ; le bloc de rangées est remplacé
 * d'un tenant. `grille:` reste en dernier — c'est la grammaire.
 */
export function serialiserPlan(texteOriginal: string, plan: Plan): string {
  const valeurs = new Map<string, string | undefined>([
    ['usure', String(plan.usure)],
    ['breches', plan.breches?.length ? plan.breches.join(' ') : undefined],
    ['seuils', plan.seuils?.length ? plan.seuils.join(' ') : undefined],
    ['passages', plan.passages?.length ? plan.passages.join(' ') : undefined],
    ['fixe', plan.fixe ? 'oui' : undefined],
  ])
  const sorties: string[] = []
  const vues = new Set<string>()
  let grilleEmise = false
  const emettreManquantes = (): void => {
    for (const [cle, valeur] of valeurs) {
      if (!vues.has(cle) && valeur !== undefined) sorties.push(`${cle}: ${valeur}`)
    }
  }
  for (const brute of texteOriginal.split('\n')) {
    const ligne = brute.replace(/\r$/, '')
    if (grilleEmise) {
      // Après le bloc de grille réémis, ne survivent que les commentaires de queue.
      if (ligne.trim() === '' || ligne.trimStart().startsWith('#')) sorties.push(ligne)
      continue
    }
    const m = LIGNE_CLE.exec(ligne)
    if (m && CLES.has(m[1]!)) {
      const cle = m[1]!
      if (cle === 'grille') {
        emettreManquantes()
        sorties.push('grille:')
        sorties.push(...plan.grille)
        grilleEmise = true
        continue
      }
      vues.add(cle)
      const valeur = valeurs.get(cle)
      if (valeur !== undefined) sorties.push(`${cle}: ${valeur}`)
      continue // donnée retirée : la ligne part avec elle
    }
    sorties.push(ligne)
  }
  if (!grilleEmise) {
    emettreManquantes()
    sorties.push('grille:')
    sorties.push(...plan.grille)
  }
  return sorties.join('\n')
}
