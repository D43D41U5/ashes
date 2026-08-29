import { describe, expect, it } from 'vitest'
import { alphaDOmbre, cleOmbreSocle, cranDeDerive, CRANS, OMBRE_SOCLE, TEX_H, TEX_W } from './ombre-socle'
import { CHANFREIN } from './socle-mineral'

/**
 * ═══ LA COULÉE DU SOCLE — ce qui la rendrait ROUGE ═══
 *
 * Le champ d'alpha est PUR, donc il s'éprouve sans canvas et sans Phaser : ce que la texture
 * cuite portera, ces bancs le disent d'avance. Trois propriétés à tenir, et elles sont
 * DIRECTIONNELLES — un balayage de forme, pas trois texels choisis (« garde exhaustive plutôt
 * que cas choisis ») :
 *
 *   ① LE CONTACT NE BOUGE PAS. Le haut de la coulée est sous la pierre : c'est ce qui la POSE.
 *      Une ombre dont le pied glisse fait flotter le bloc — c'est très exactement le défaut que
 *      la `dalle` (l'empreinte entière translatée) montrait sur la planche.
 *   ② LA POINTE PART À L'OPPOSÉ, ET SEULE ELLE. Le décalage doit croître avec la distance au
 *      pied, jamais l'inverse.
 *   ③ ELLE RESTE DANS SA TEXTURE. Un cisaillement au maximum ne doit rien faire déborder — un
 *      texel coupé au bord se verrait comme une ombre tranchée net.
 */

/** Le barycentre en X des texels opaques d'une rangée, ou `null` si la rangée est vide. */
function centreDeRangee(cran: number, j: number): number | null {
  let somme = 0
  let poids = 0
  for (let i = 0; i < TEX_W; i++) {
    const a = alphaDOmbre('coulee', cran, i, j)
    somme += i * a
    poids += a
  }
  return poids > 0 ? somme / poids : null
}

describe('la coulée du socle — une empreinte qui se cisaille', () => {
  const CRANS_TOUS = Array.from({ length: 2 * CRANS + 1 }, (_, k) => k - CRANS)

  it('LE PIED NE BOUGE PAS — quel que soit l’astre, la rangée de contact est à la même place', () => {
    // La propriété ①, affirmée sur TOUS les crans : la rangée 0 (sous la pierre) doit avoir
    // exactement le même centre partout. Si elle glissait, la pierre se décollerait de son ombre.
    const centres = CRANS_TOUS.map((c) => centreDeRangee(c, 0))
    expect(centres.every((c) => c !== null)).toBe(true)
    for (const c of centres) expect(c).toBeCloseTo(centres[0]!, 9)
  })

  it('et la POINTE, elle, part à l’opposé — le décalage croît avec la distance au pied', () => {
    // La propriété ②. On balaie les crans NON NULS et on exige que le centre de chaque rangée
    // s'éloigne MONOTONEMENT du pied, dans le sens du cran. Un signe inversé ferait pencher
    // l'ombre DU CÔTÉ de l'astre — la faute que la demande d'Alexis vise en premier.
    const fautes: string[] = []
    for (const cran of CRANS_TOUS) {
      if (cran === 0) continue
      const pied = centreDeRangee(cran, 0)!
      let precedent = pied
      for (let j = 1; j < TEX_H; j++) {
        const c = centreDeRangee(cran, j)
        if (c === null) continue
        const avance = (c - precedent) * Math.sign(cran)
        if (avance < -1e-9) fautes.push(`cran ${cran}, rangée ${j} : recule de ${(-avance).toFixed(3)}`)
        precedent = c
      }
      // Et elle avance EXACTEMENT du cran : c'est la définition du cisaillement, pas « un peu ».
      const total = (precedent - pied) * Math.sign(cran)
      if (Math.abs(total - Math.abs(cran)) > 1e-9) {
        fautes.push(`cran ${cran} : la pointe a avancé de ${total.toFixed(3)}, attendu ${Math.abs(cran)}`)
      }
    }
    expect(fautes.slice(0, 5)).toEqual([])
  })

  it('au cisaillement MAXIMAL, rien ne déborde de la texture', () => {
    // La propriété ③, et elle a PAYÉ : la première écriture posait `TEX_W = LARGEUR + 2 ×
    // CISAILLE`, et cette garde a rougi — au cisaillement maximal la bande tombait FLUSH sur le
    // bord, sa colonne extrême sortant à 0,67 d'alpha au lieu de s'éteindre. D'où `MARGE`.
    for (const cran of [-CRANS, CRANS]) {
      for (let j = 0; j < TEX_H; j++) {
        expect(alphaDOmbre('coulee', cran, 0, j), `cran ${cran} rangée ${j} bord ouest`).toBe(0)
        expect(alphaDOmbre('coulee', cran, TEX_W - 1, j), `cran ${cran} rangée ${j} bord est`).toBe(0)
      }
    }
  })

  it('le contact est PLEIN, la pointe s’éteint — c’est ce qui pose la pierre', () => {
    // Une coulée d'alpha uniforme serait un autocollant ; une coulée fondue partout ne poserait
    // rien. On exige la PENTE : plein sous la pierre, éteint au bout.
    const centre = Math.round(centreDeRangee(0, 0)!)
    expect(alphaDOmbre('coulee', 0, centre, 0)).toBe(1)
    expect(alphaDOmbre('coulee', 0, centre, OMBRE_SOCLE.LONGUEUR - 1)).toBe(1) // la pointe pleine
    expect(alphaDOmbre('coulee', 0, centre, TEX_H - 1)).toBe(0) // la dernière rangée est éteinte
    expect(alphaDOmbre('coulee', 0, centre, TEX_H)).toBe(0) // hors de la texture
  })

  it('DEUX texels d’alpha partiel cernent la coulée — aucun bord franc', () => {
    // ⚠ LA DEMANDE D'ALEXIS, ÉNONCÉE COMME UNE PROPRIÉTÉ : « pas de sharp edge, on fait 2 pixel
    // de couche alpha ». On compte, sur la rangée de CONTACT (celle qui est pleine, donc celle
    // où un bord franc se verrait le plus), les texels dont l'alpha n'est ni 0 ni 1 : il en faut
    // exactement DOUX de chaque côté. La première écriture n'en avait qu'UN, à 0,67 — un cran
    // si près du plein que le bord se lisait net.
    const partiels: number[] = []
    for (let i = 0; i < TEX_W; i++) {
      const a = alphaDOmbre('coulee', 0, i, OMBRE_SOCLE.REMONTE)
      if (a > 0 && a < 1) partiels.push(a)
    }
    expect(partiels.length).toBe(2 * OMBRE_SOCLE.DOUX)
    // Et ils MONTENT : ⅓ puis ⅔ en entrant, l'inverse en sortant — pas deux fois la même valeur.
    expect(partiels.slice(0, OMBRE_SOCLE.DOUX)).toEqual([1 / 3, 2 / 3])
    // LA POINTE PORTE LE MÊME COMPTE : deux rangées partielles au bout de la coulée.
    const centre = Math.round(centreDeRangee(0, 0)!)
    const colonne: number[] = []
    for (let j = 0; j < TEX_H; j++) {
      const a = alphaDOmbre('coulee', 0, centre, j)
      if (a > 0 && a < 1) colonne.push(a)
    }
    expect(colonne).toEqual([2 / 3, 1 / 3])
  })

  it('l’alpha est QUANTIFIÉ — du pixel art, pas un dégradé', () => {
    // Même règle que les halos du Feu (mémoire du projet : « FX de lumière pixellisés »).
    const vus = new Set<number>()
    for (const cran of CRANS_TOUS) {
      for (let j = 0; j < TEX_H; j++) for (let i = 0; i < TEX_W; i++) vus.add(alphaDOmbre('coulee', cran, i, j))
    }
    expect(vus.size).toBeLessThanOrEqual(OMBRE_SOCLE.ALPHA_CRANS + 1)
    for (const a of vus) expect(Number.isInteger(a * OMBRE_SOCLE.ALPHA_CRANS)).toBe(true)
  })

  it('la LARGEUR de l’empreinte est celle de la tuile — ni auréole, ni liseré', () => {
    // Le reproche d'origine : la flaque générique fait 1,9 tuile et déborde en anneau. Ici la
    // rangée de contact doit couvrir EXACTEMENT les 16 texels du bloc.
    // ⚠ **À PLEINE OPACITÉ** — le reproche d'Alexis : « la base de l'ombre n'est pas aussi large
    // que la base du caillou non ? ». Elle ne l'était pas : les deux texels de fondu mordaient
    // DANS l'empreinte, laissant 12 texels pleins sur 16. La pénombre est maintenant DEHORS, et
    // c'est cette garde qui l'affirme. On la lit sur la LIGNE DE PIED (`REMONTE`), la première
    // rangée que le joueur voie — le reste est derrière la pierre.
    let plein = 0
    let touche = 0
    for (let i = 0; i < TEX_W; i++) {
      const a = alphaDOmbre('coulee', 0, i, OMBRE_SOCLE.REMONTE)
      if (a === 1) plein++
      if (a > 0) touche++
    }
    expect(plein).toBe(OMBRE_SOCLE.LARGEUR)
    // …et la pénombre s'ajoute AUTOUR, elle ne la ronge pas.
    expect(touche).toBe(OMBRE_SOCLE.LARGEUR + 2 * OMBRE_SOCLE.DOUX)
  })

  it('LE CISAILLEMENT PART DE LA LIGNE DE PIED — pas du haut caché de la texture', () => {
    // ⚠ Le défaut vu par Alexis (« l'ombre est très mal alignée vu la position du soleil ») :
    // les `REMONTE` premières rangées passent DERRIÈRE la pierre. Faire partir la course de là,
    // c'est arriver à la première rangée VISIBLE déjà décalée — un liseré de sol éclairé
    // s'ouvrait sous un coin du bloc. On exige donc que TOUT ce qui est caché, ligne de pied
    // comprise, soit rigoureusement à sa place, et que le décalage ne commence qu'après.
    for (const cran of [-CRANS, -3, 3, CRANS]) {
      const ref = centreDeRangee(0, 0)!
      for (let j = 0; j <= OMBRE_SOCLE.REMONTE; j++) {
        expect(centreDeRangee(cran, j), `cran ${cran}, rangée cachée ${j}`).toBeCloseTo(ref, 9)
      }
      // Et PLUS BAS, ça bouge : sinon la garde serait satisfaite par une ombre qui ne dérive
      // jamais (« une sonde qui ne peut pas échouer »). On lit la pointe, pas la rangée
      // suivante : à petit cran, un pas de course vaut moins d'un tiers de texel et la
      // quantification l'avale — ce serait mesurer l'arrondi, pas la loi.
      const pointe = centreDeRangee(cran, OMBRE_SOCLE.LONGUEUR - 1)!
      expect(Math.abs(pointe - ref), `cran ${cran}`).toBeCloseTo(Math.abs(cran), 9)
    }
  })

  it('LA POINTE PORTE LE BISEAU DE LA PIERRE — un trapèze, pas un rectangle', () => {
    // ⚠ La demande d'Alexis : « le haut de la pierre est légèrement biseauté. Ça doit se voir
    // dans l'ombre ». La pointe de la coulée EST la projection du dessus du bloc, donc elle doit
    // être aussi étroite que lui — et pas d'un nombre recopié : `CHANFREIN` est LA donnée de la
    // silhouette (`socle-mineral.formeDeSocle` s'en sert pour ses rangées hautes).
    // ⚠ ON COMPTE L'OMBRE **PLEINE**, pas « ce qui n'est pas nul ». La pénombre déborde de
    // l'empreinte des deux côtés (`DOUX`) : compter à `> 0` mesurerait le fondu, pas l'ombre.
    const large = (j: number): number => {
      let n = 0
      for (let i = 0; i < TEX_W; i++) if (alphaDOmbre('coulee', 0, i, j) === 1) n++
      return n
    }
    expect(large(0)).toBe(OMBRE_SOCLE.LARGEUR) // le contact : la tuile entière
    expect(large(OMBRE_SOCLE.LONGUEUR - 1)).toBe(OMBRE_SOCLE.LARGEUR - 2 * CHANFREIN) // la pointe : le dessus
    // ET ELLE SE RESSERRE MONOTONEMENT — jamais un renflement en cours de route.
    for (let j = 1; j < OMBRE_SOCLE.LONGUEUR; j++) expect(large(j), `rangée ${j}`).toBeLessThanOrEqual(large(j - 1))
    // ⚠ **ET SEULEMENT EN BAS** (Alexis : « le biseauté ne devait concerner que la partie la
    // plus basse de l'ombre »). Tout ce qui est au-dessus des `BISEAU_RANGS` dernières rangées
    // est PLEINE TUILE : le corps du bloc n'est pas biseauté, son ombre ne doit pas l'être.
    // Sans cette garde, un rétrécissement étalé sur toute la longueur passerait — c'était la
    // première écriture, et elle faisait de l'ombre un entonnoir dès le pied de la pierre.
    for (let j = 0; j < OMBRE_SOCLE.LONGUEUR - OMBRE_SOCLE.BISEAU_RANGS; j++) {
      expect(large(j), `rangée ${j} (hors biseau)`).toBe(OMBRE_SOCLE.LARGEUR)
    }
  })

  it('le trapèze se resserre des DEUX côtés — il ne penche pas tout seul', () => {
    // Sans cisaillement, la coulée doit rester symétrique : si le rétrécissement ne mordait que
    // d'un bord, l'ombre pencherait même à l'astre au zénith, et on ne saurait plus démêler le
    // biseau de la dérive.
    const pied = centreDeRangee(0, 0)!
    for (let j = 0; j < TEX_H; j++) {
      const c = centreDeRangee(0, j)
      if (c !== null) expect(c, `rangée ${j}`).toBeCloseTo(pied, 9)
    }
  })

  it('le cran s’arrondit SYMÉTRIQUEMENT — matin et soir vont aussi loin', () => {
    // `Math.round` arrondit les demis vers +∞ (`round(−3,5) = −3`), or la dérive est
    // antisymétrique autour du zénith : l'ombre irait « plus loin d'un côté ».
    for (let d = 0; d <= 1.0001; d += 0.01) {
      expect(cranDeDerive(-d), `dérive ${d.toFixed(2)}`).toBe(-cranDeDerive(d))
    }
    expect(cranDeDerive(1)).toBe(CRANS)
    expect(cranDeDerive(-1)).toBe(-CRANS)
    expect(cranDeDerive(0)).toBe(0)
    expect(cranDeDerive(2)).toBe(CRANS) // borné : une dérive hors domaine ne sort pas de la texture
  })

  it('une clé par cran, et deux crans n’en partagent jamais une', () => {
    const cles = new Set(CRANS_TOUS.map(cleOmbreSocle))
    expect(cles.size).toBe(2 * CRANS + 1)
  })
})
