import { describe, expect, it } from 'vitest'
import {
  alphaDOmbre,
  cleOmbreSocle,
  courseDeCisaillement,
  cranDeDerive,
  CRANS,
  longueurDeCoulee,
  OMBRE_SOCLE,
  rangsDeCourse,
  TEX_H,
  TEX_W,
  visibleDeCoulee,
} from './ombre-socle'
import { CHANFREIN, EMERGENCE } from './socle-mineral'

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
 *
 * ⚠ **ET DEPUIS LG-R15, TOUT SE BALAIE SUR LES TROIS TAILLES** *(LG-A16, seuils posés sur la
 * planche 20 avant tout code)*. La longueur suit la hauteur de la pierre : ce qui n'était qu'une
 * constante est devenu une famille, et une garde qui n'éprouverait que la taille du milieu
 * laisserait passer précisément ce que la règle a changé.
 */

/** Le barycentre en X des texels opaques d'une rangée, ou `null` si la rangée est vide. */
function centreDeRangee(cran: number, j: number, taille: number): number | null {
  let somme = 0
  let poids = 0
  for (let i = 0; i < TEX_W; i++) {
    const a = alphaDOmbre('coulee', cran, i, j, taille)
    somme += i * a
    poids += a
  }
  return poids > 0 ? somme / poids : null
}

/** La largeur de l'ombre PLEINE d'une rangée — les texels à 1, pas ceux qui sont touchés. */
function largeurPleine(cran: number, j: number, taille: number): number {
  let n = 0
  for (let i = 0; i < TEX_W; i++) if (alphaDOmbre('coulee', cran, i, j, taille) === 1) n++
  return n
}

const TAILLES = OMBRE_SOCLE.VISIBLE.map((_, t) => t)
const CRANS_TOUS = Array.from({ length: 2 * CRANS + 1 }, (_, k) => k - CRANS)

describe('la coulée du socle — une empreinte qui se cisaille', () => {
  it('LE PIED NE BOUGE PAS — quel que soit l’astre ET la pierre, la rangée de contact est à la même place', () => {
    // La propriété ①, affirmée sur TOUS les crans et TOUTES les tailles : la rangée 0 (sous la
    // pierre) doit avoir exactement le même centre partout. Si elle glissait, la pierre se
    // décollerait de son ombre — et une pierre plus haute la décollerait plus, ce qui serait pire
    // que le défaut d'origine puisque ça se lirait comme un bug de taille.
    const centres = TAILLES.flatMap((t) => CRANS_TOUS.map((c) => centreDeRangee(c, 0, t)))
    expect(centres.every((c) => c !== null)).toBe(true)
    for (const c of centres) expect(c).toBeCloseTo(centres[0]!, 9)
  })

  it('et la POINTE, elle, part à l’opposé — le décalage croît avec la distance au pied', () => {
    // La propriété ②. On balaie les crans NON NULS et on exige que le centre de chaque rangée
    // s'éloigne MONOTONEMENT du pied, dans le sens du cran. Un signe inversé ferait pencher
    // l'ombre DU CÔTÉ de l'astre — la faute que la demande d'Alexis vise en premier.
    const fautes: string[] = []
    for (const taille of TAILLES) {
      for (const cran of CRANS_TOUS) {
        if (cran === 0) continue
        const pied = centreDeRangee(cran, 0, taille)!
        let precedent = pied
        for (let j = 1; j < TEX_H; j++) {
          const c = centreDeRangee(cran, j, taille)
          if (c === null) continue
          const avance = (c - precedent) * Math.sign(cran)
          if (avance < -1e-9) fautes.push(`taille ${taille}, cran ${cran}, rangée ${j} : recule de ${(-avance).toFixed(3)}`)
          precedent = c
        }
      }
    }
    expect(fautes.slice(0, 5)).toEqual([])
  })

  it('LA COURSE EST UN TAUX, PAS UNE CONSTANTE — 8/7 px par rang, donc la haute pierre va plus loin', () => {
    // ⚠ LG-R15, le cœur de la règle. `cran` reste la course de la taille 1 (celle d'aujourd'hui) ;
    // une pierre de 24 px a neuf rangs au lieu de sept, donc sa pointe part de 9/7 fois plus loin
    // au MÊME astre. C'est ce que dit une élévation fixe — et c'est la loi pure, lue sans passer
    // par le barycentre, qui la quantifie.
    for (const cran of CRANS_TOUS) {
      expect(courseDeCisaillement(cran, 1), `cran ${cran}, taille 1`).toBe(cran)
      expect(courseDeCisaillement(cran, 0)).toBeCloseTo((cran * 5) / 7, 9)
      expect(courseDeCisaillement(cran, 2)).toBeCloseTo((cran * 9) / 7, 9)
    }
    // Et les rangs de course sont bien 5 / 7 / 9 : le dénominateur de `t`, et l'étalon du taux.
    expect(TAILLES.map(rangsDeCourse)).toEqual([5, 7, 9])
  })

  it('au cisaillement MAXIMAL, rien ne déborde de la texture — pour AUCUNE taille', () => {
    // La propriété ③, et elle a PAYÉ : la première écriture posait `TEX_W = LARGEUR + 2 ×
    // CISAILLE`, et cette garde a rougi — au cisaillement maximal la bande tombait FLUSH sur le
    // bord, sa colonne extrême sortant à 0,67 d'alpha au lieu de s'éteindre. D'où `MARGE`.
    // ⚠ Depuis LG-R15 c'est la TAILLE 2 qui tend le cadre : sa pointe court 9/7 fois plus loin,
    // et `COURSE_MAX` est taillé sur elle. Balayer les trois tailles, c'est vérifier que le cadre
    // a été taillé sur la plus exigeante et non sur celle qu'on avait sous les yeux.
    for (const taille of TAILLES) {
      for (const cran of [-CRANS, CRANS]) {
        for (let j = 0; j < TEX_H; j++) {
          expect(alphaDOmbre('coulee', cran, 0, j, taille), `taille ${taille} cran ${cran} rangée ${j} ouest`).toBe(0)
          expect(alphaDOmbre('coulee', cran, TEX_W - 1, j, taille), `taille ${taille} cran ${cran} rangée ${j} est`).toBe(0)
        }
      }
      // La dernière RANGÉE est éteinte aussi : la pointe s'achève dans la texture, jamais au bord.
      for (let i = 0; i < TEX_W; i++) {
        expect(alphaDOmbre('coulee', 0, i, TEX_H - 1, taille), `taille ${taille} rangée du bas`).toBe(0)
      }
    }
  })

  it('LA LONGUEUR SUIT LA HAUTEUR — 6 / 8 / 10 px pour 16 / 20 / 24 px de pierre', () => {
    // ⚠ LG-R9 et LG-R15 (Alexis, planche 20 : « Au pixel, longueur LG-R9 »). C'est LA règle neuve.
    // On la lit sur la COLONNE CENTRALE, en comptant les rangées pleines sous la ligne de pied :
    // c'est ce que le joueur voit, le reste étant caché par la pierre.
    const centre = Math.round(centreDeRangee(0, 0, 1)!)
    for (const taille of TAILLES) {
      let visibles = 0
      for (let j = OMBRE_SOCLE.REMONTE; j < TEX_H; j++) {
        if (alphaDOmbre('coulee', 0, centre, j, taille) === 1) visibles++
      }
      expect(visibles, `taille ${taille}`).toBe(OMBRE_SOCLE.VISIBLE[taille])
    }
    // Et elle vaut 0,4 × H arrondi au pixel — la loi de LG-R9, pas trois nombres choisis.
    for (const taille of TAILLES) {
      expect(visibleDeCoulee(taille), `0,4 × ${EMERGENCE[taille]}`).toBe(Math.round(0.4 * EMERGENCE[taille]!))
    }
  })

  it('LA TAILLE 1 EST LA COULÉE D’AUJOURD’HUI — la bascule se lit, elle ne se devine pas', () => {
    // ⚠ LG-A16 : « la taille 1 rend, au bit près, la texture d'aujourd'hui ». Si le milieu bougeait
    // aussi, on ne saurait plus démêler la RÈGLE d'une retouche de look — et le run 50 qui l'a
    // mesurée (102/102 de luminance, 9,8/9,8 px de profondeur) n'aurait plus d'étalon.
    expect(visibleDeCoulee(1)).toBe(8)
    expect(longueurDeCoulee(1)).toBe(12)
    expect(rangsDeCourse(1)).toBe(7)
    // Le profil de la ligne de pied est celui d'avant, à la translation près du cadre élargi :
    // deux texels de pénombre montante, seize pleins, deux descendants.
    const profil: number[] = []
    for (let i = 0; i < TEX_W; i++) {
      const a = alphaDOmbre('coulee', 0, i, OMBRE_SOCLE.REMONTE, 1)
      if (a > 0) profil.push(a)
    }
    expect(profil).toEqual([1 / 3, 2 / 3, ...Array(OMBRE_SOCLE.LARGEUR).fill(1), 2 / 3, 1 / 3])
    // …et les rangées que la taille 2 a en plus sont VIDES pour la taille 1 : le cadre s'est
    // agrandi, la coulée non.
    for (let j = longueurDeCoulee(1) + OMBRE_SOCLE.DOUX; j < TEX_H; j++) {
      for (let i = 0; i < TEX_W; i++) expect(alphaDOmbre('coulee', 0, i, j, 1), `rangée ${j}`).toBe(0)
    }
  })

  it('le contact est PLEIN, la pointe s’éteint — c’est ce qui pose la pierre', () => {
    // Une coulée d'alpha uniforme serait un autocollant ; une coulée fondue partout ne poserait
    // rien. On exige la PENTE : plein sous la pierre, éteint au bout.
    const centre = Math.round(centreDeRangee(0, 0, 1)!)
    for (const taille of TAILLES) {
      expect(alphaDOmbre('coulee', 0, centre, 0, taille), `taille ${taille} contact`).toBe(1)
      expect(alphaDOmbre('coulee', 0, centre, longueurDeCoulee(taille) - 1, taille), `taille ${taille} pointe`).toBe(1)
      expect(alphaDOmbre('coulee', 0, centre, TEX_H - 1, taille), `taille ${taille} bas`).toBe(0)
      expect(alphaDOmbre('coulee', 0, centre, TEX_H, taille), `taille ${taille} hors cadre`).toBe(0)
    }
  })

  it('DEUX texels d’alpha partiel cernent la coulée — aucun bord franc', () => {
    // ⚠ LA DEMANDE D'ALEXIS, ÉNONCÉE COMME UNE PROPRIÉTÉ : « pas de sharp edge, on fait 2 pixel
    // de couche alpha ». On compte, sur la rangée de CONTACT (celle qui est pleine, donc celle
    // où un bord franc se verrait le plus), les texels dont l'alpha n'est ni 0 ni 1 : il en faut
    // exactement DOUX de chaque côté. La première écriture n'en avait qu'UN, à 0,67 — un cran
    // si près du plein que le bord se lisait net.
    const centre = Math.round(centreDeRangee(0, 0, 1)!)
    for (const taille of TAILLES) {
      const partiels: number[] = []
      for (let i = 0; i < TEX_W; i++) {
        const a = alphaDOmbre('coulee', 0, i, OMBRE_SOCLE.REMONTE, taille)
        if (a > 0 && a < 1) partiels.push(a)
      }
      expect(partiels.length, `taille ${taille}`).toBe(2 * OMBRE_SOCLE.DOUX)
      // Et ils MONTENT : ⅓ puis ⅔ en entrant, l'inverse en sortant — pas deux fois la même valeur.
      expect(partiels.slice(0, OMBRE_SOCLE.DOUX), `taille ${taille}`).toEqual([1 / 3, 2 / 3])
      // LA POINTE PORTE LE MÊME COMPTE : deux rangées partielles au bout de la coulée, quelle que
      // soit sa longueur — c'est ce qui fait que la pénombre ne grandit PAS avec la pierre (le
      // reproche qui a écarté le masque d'astre pour les socles, LG-R15).
      const colonne: number[] = []
      for (let j = 0; j < TEX_H; j++) {
        const a = alphaDOmbre('coulee', 0, centre, j, taille)
        if (a > 0 && a < 1) colonne.push(a)
      }
      expect(colonne, `taille ${taille}, la pointe`).toEqual([2 / 3, 1 / 3])
    }
  })

  it('l’alpha est QUANTIFIÉ — du pixel art, pas un dégradé', () => {
    // Même règle que les halos du Feu (mémoire du projet : « FX de lumière pixellisés »).
    const vus = new Set<number>()
    for (const taille of TAILLES) {
      for (const cran of CRANS_TOUS) {
        for (let j = 0; j < TEX_H; j++) for (let i = 0; i < TEX_W; i++) vus.add(alphaDOmbre('coulee', cran, i, j, taille))
      }
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
    // ⚠ Et la LARGEUR ne suit PAS la taille : seule la longueur le fait (LG-R15). Une empreinte
    // plus large que la tuile serait l'auréole que la coulée a été faite pour effacer.
    for (const taille of TAILLES) {
      let touche = 0
      for (let i = 0; i < TEX_W; i++) if (alphaDOmbre('coulee', 0, i, OMBRE_SOCLE.REMONTE, taille) > 0) touche++
      expect(largeurPleine(0, OMBRE_SOCLE.REMONTE, taille), `taille ${taille}`).toBe(OMBRE_SOCLE.LARGEUR)
      expect(touche, `taille ${taille}`).toBe(OMBRE_SOCLE.LARGEUR + 2 * OMBRE_SOCLE.DOUX)
    }
  })

  it('LE CISAILLEMENT PART DE LA LIGNE DE PIED — pas du haut caché de la texture', () => {
    // ⚠ Le défaut vu par Alexis (« l'ombre est très mal alignée vu la position du soleil ») :
    // les `REMONTE` premières rangées passent DERRIÈRE la pierre. Faire partir la course de là,
    // c'est arriver à la première rangée VISIBLE déjà décalée — un liseré de sol éclairé
    // s'ouvrait sous un coin du bloc. On exige donc que TOUT ce qui est caché, ligne de pied
    // comprise, soit rigoureusement à sa place, et que le décalage ne commence qu'après.
    for (const taille of TAILLES) {
      for (const cran of [-CRANS, -3, 3, CRANS]) {
        const ref = centreDeRangee(0, 0, taille)!
        for (let j = 0; j <= OMBRE_SOCLE.REMONTE; j++) {
          expect(centreDeRangee(cran, j, taille), `taille ${taille}, cran ${cran}, rangée cachée ${j}`).toBeCloseTo(ref, 9)
        }
        // Et PLUS BAS, ça bouge : sinon la garde serait satisfaite par une ombre qui ne dérive
        // jamais (« une sonde qui ne peut pas échouer »). On lit la pointe, pas la rangée
        // suivante : à petit cran, un pas de course vaut moins d'un tiers de texel et la
        // quantification l'avale — ce serait mesurer l'arrondi, pas la loi.
        // ⚠ **À UN DEMI-TEXEL PRÈS, ET C'EST LA QUANTIFICATION, PAS UN JEU** : depuis LG-R15 la
        // course d'arrivée est fractionnaire pour les tailles 0 et 2 (5/7 et 9/7 du cran), or le
        // champ d'alpha est quantifié en trois crans. Le barycentre suit la loi, il ne peut pas
        // la rendre au neuvième près. La loi EXACTE, elle, est éprouvée à part sur
        // `courseDeCisaillement` — c'est là qu'une dérive se verrait.
        const pointe = centreDeRangee(cran, longueurDeCoulee(taille) - 1, taille)!
        const attendu = Math.abs(courseDeCisaillement(cran, taille))
        expect(Math.abs(pointe - ref), `taille ${taille}, cran ${cran}`).toBeCloseTo(attendu, 0)
      }
    }
  })

  it('LA POINTE PORTE LE BISEAU DE LA PIERRE — un trapèze, pas un rectangle', () => {
    // ⚠ La demande d'Alexis : « le haut de la pierre est légèrement biseauté. Ça doit se voir
    // dans l'ombre ». La pointe de la coulée EST la projection du dessus du bloc, donc elle doit
    // être aussi étroite que lui — et pas d'un nombre recopié : `CHANFREIN` est LA donnée de la
    // silhouette (`socle-mineral.formeDeSocle` s'en sert pour ses rangées hautes).
    // ⚠ ON COMPTE L'OMBRE **PLEINE**, pas « ce qui n'est pas nul ». La pénombre déborde de
    // l'empreinte des deux côtés (`DOUX`) : compter à `> 0` mesurerait le fondu, pas l'ombre.
    for (const taille of TAILLES) {
      const L = longueurDeCoulee(taille)
      const large = (j: number): number => largeurPleine(0, j, taille)
      expect(large(0), `taille ${taille}, le contact`).toBe(OMBRE_SOCLE.LARGEUR)
      expect(large(L - 1), `taille ${taille}, la pointe`).toBe(OMBRE_SOCLE.LARGEUR - 2 * CHANFREIN)
      // ET ELLE SE RESSERRE MONOTONEMENT — jamais un renflement en cours de route.
      for (let j = 1; j < L; j++) expect(large(j), `taille ${taille}, rangée ${j}`).toBeLessThanOrEqual(large(j - 1))
      // ⚠ **ET SEULEMENT EN BAS** (Alexis : « le biseauté ne devait concerner que la partie la
      // plus basse de l'ombre »). Tout ce qui est au-dessus des `BISEAU_RANGS` dernières rangées
      // est PLEINE TUILE : le corps du bloc n'est pas biseauté, son ombre ne doit pas l'être.
      // Le biseau mord les 4 derniers rangs QUELLE QUE SOIT la longueur (LG-R15).
      for (let j = 0; j < L - OMBRE_SOCLE.BISEAU_RANGS; j++) {
        expect(large(j), `taille ${taille}, rangée ${j} (hors biseau)`).toBe(OMBRE_SOCLE.LARGEUR)
      }
      // ⚠ **LE RETRAIT EST UN ENTIER DE TEXELS** (LG-A16). Un retrait fractionnaire décale la
      // bande d'un DEMI-texel : la quantification devient asymétrique et la coulée se met à
      // boiter d'une rangée à l'autre. La largeur pleine perd donc toujours un nombre PAIR.
      for (let j = 0; j < L; j++) {
        expect((OMBRE_SOCLE.LARGEUR - large(j)) % 2, `taille ${taille}, rangée ${j}`).toBe(0)
      }
    }
  })

  it('le trapèze se resserre des DEUX côtés — il ne penche pas tout seul', () => {
    // Sans cisaillement, la coulée doit rester symétrique : si le rétrécissement ne mordait que
    // d'un bord, l'ombre pencherait même à l'astre au zénith, et on ne saurait plus démêler le
    // biseau de la dérive.
    for (const taille of TAILLES) {
      const pied = centreDeRangee(0, 0, taille)!
      for (let j = 0; j < TEX_H; j++) {
        const c = centreDeRangee(0, j, taille)
        if (c !== null) expect(c, `taille ${taille}, rangée ${j}`).toBeCloseTo(pied, 9)
      }
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

  it('une clé par cran ET PAR TAILLE, et deux n’en partagent jamais une', () => {
    // ⚠ Depuis LG-R15 il y a trois champs d'alpha par cran : sans la taille dans la clé, la
    // première pierre rencontrée cuirait SA longueur pour toutes les autres — et le défaut serait
    // invisible en test unitaire, puisque la géométrie pure, elle, resterait juste.
    const cles = new Set(TAILLES.flatMap((t) => CRANS_TOUS.map((c) => cleOmbreSocle(c, t))))
    expect(cles.size).toBe(TAILLES.length * (2 * CRANS + 1))
  })
})
