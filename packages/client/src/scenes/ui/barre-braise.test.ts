import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRAISE, braiseNeuve, cransMax } from '@ashes/sim'
import {
  BARRE_BRAISE_BORD, BARRE_BRAISE_ECART, BARRE_BRAISE_GAP, BARRE_BRAISE_PAD, BARRE_BRAISE_W,
  cssBarreBraise, etatBarreBraise, hauteurDuCadre,
} from './barre-braise'

const HEX_INK = '#14141a'

const T = BRAISE.DUREE_CRAN
const ici = (f: string): string => readFileSync(join(__dirname, f), 'utf8')

describe('la barre de crans peint la RÈGLE, pas une jauge (braise.md § 5.12)', () => {
  it('B-R7b — UN CRAN NE VAUT QUE PLEIN : à un tick du plein, le haut ne compte plus', () => {
    // ═══ LA GARDE QUI SÉPARE `floor` DE `ceil`, ET C'EST LA SEULE QUI COMPTE ═══
    //
    // C'est la dette de lisibilité que `braise.ts` réclame nommément : « la barre doit peindre
    // `cransCouverts`, le cran du haut se vidant visiblement HORS COMPTE ». À `2·T − 1`, `floor`
    // rend UN cran couvert et `ceil` en rendrait DEUX — ce test rougit donc si la barre se met
    // un jour à dériver les crans elle-même au lieu de les lire de `/sim`, et il rougirait aussi
    // si `/sim` changeait de variante (celle qu'Alexis a écartée le 2026-09-28).
    const e = etatBarreBraise({ niveau: 0, charge: 2 * T - 1 }, 0)!
    expect(e.pleins, 'floor : un cran entamé ne compte pas').toBe(1)
    expect(e.max).toBe(2)
    // …et le cran qui fuit est presque entier : la case du haut se peint quasi pleine, mais
    // dans l'autre couleur. C'est exactement l'ambiguïté que la spec voulait lever.
    expect(e.resteDuCran).toBeCloseTo((T - 1) / T, 10)
    expect(e.resteDuCran).toBeLessThan(1) // jamais 1 : à 1 ce serait un cran plein
  })

  it('À CHARGE PLEINE il n’y a AUCUN cran qui fuit — sinon la case du haut serait indexée deux fois', () => {
    // Le seul instant où `pleins === max`. Si `resteDuCran` sortait non nul ici, le rendu
    // chercherait la case d'indice `max` — qui n'existe pas — et peindrait dans le vide.
    const e = etatBarreBraise(braiseNeuve(0), 0)!
    expect(e.pleins).toBe(e.max)
    expect(e.resteDuCran).toBe(0)
  })

  it('L’ÉCHELLE SUIT LE NIVEAU DE L’ARBRE (B-R14) — la barre n’a aucun nombre à elle', () => {
    for (const niveau of [0, 1, 2, 3]) {
      const e = etatBarreBraise(braiseNeuve(niveau), 0)!
      expect(e.max, `niveau ${niveau}`).toBe(cransMax(niveau))
      expect(e.pleins).toBe(cransMax(niveau))
    }
  })

  it('LE TUBE NE BOUGE PAS — il a toujours la taille du BOUT de l’arbre, et les crans manquants sont des verrous', () => {
    // ═══ LA DÉCISION D'ALEXIS DU 2026-10-04 ═══
    // « elle doit prendre toute la hauteur quand elle est full upgrade, tu masques les niveaux
    // qui n'ont pas été débloqué ». Donc `cases` est CONSTANT et `max` est ce qui grandit :
    // l'inverse de ma première version, qui dimensionnait le tube sur l'échelle courante et
    // redessinait donc toute la barre à chaque cran gagné.
    for (const niveau of [0, 1, 2]) {
      const e = etatBarreBraise(braiseNeuve(niveau), 0)!
      expect(e.cases, `niveau ${niveau} : le tube`).toBe(BRAISE.CRANS_MAX)
      expect(e.max, 'et le débloqué, lui, monte').toBe(cransMax(niveau))
      expect(e.cases - e.max, 'les verrous').toBe(BRAISE.CRANS_MAX - cransMax(niveau))
    }
    // Au bout de l'arbre, plus un seul verrou : la colonne est pleine de sa propre échelle.
    const bout = etatBarreBraise(braiseNeuve(BRAISE.CRANS_MAX - BRAISE.CRANS_DEPART), 0)!
    expect(bout.max).toBe(BRAISE.CRANS_MAX)
    expect(bout.cases).toBe(bout.max)
  })

  it('UN ARBRE DÉRÉGLÉ SE PEINT EN ENTIER, il ne se fait pas rogner en silence', () => {
    // ⚠ POURQUOI CETTE GARDE EXISTE : `cransMax` n'est volontairement PAS borné dans `/sim` (voir
    // le commentaire de `BRAISE.CRANS_MAX`). Si une recette d'arbre dépassait un jour le sommet
    // déclaré, un tube figé à `CRANS_MAX` montrerait moins de crans que la braise n'en porte —
    // c'est-à-dire mentirait. Le `Math.max` rend le défaut VISIBLE au lieu de l'avaler.
    const trop = BRAISE.CRANS_MAX - BRAISE.CRANS_DEPART + 2 // deux crans au-delà du sommet
    const e = etatBarreBraise(braiseNeuve(trop), 0)!
    expect(e.max, 'la braise porte plus que le sommet déclaré').toBeGreaterThan(BRAISE.CRANS_MAX)
    expect(e.cases, 'et le tube la suit plutôt que de la rogner').toBe(e.max)
    expect(e.pleins, 'tout est peint').toBe(e.max)
  })
})

describe('le repère du lieu a TROIS états, et le troisième est le message du jeu', () => {
  it('DEMANDE NULLE : aucun repère, aucun déficit (B-R8 — l’été en bas, la grotte, le pied d’une balise)', () => {
    const e = etatBarreBraise({ niveau: 0, charge: 0 }, 0)!
    expect(e.demande).toBe(0)
    expect(e.deficit, 'braise VIDE et pourtant aucun déficit : rien à couvrir').toBe(false)
    expect(e.horsEchelle).toBe(false)
  })

  it('DANS L’ÉCHELLE : le repère se pose, et le déficit se lit de l’écart au plein', () => {
    const pleine = braiseNeuve(0) // 2 crans
    // Exactement couvert : le palier se TOUCHE (B-R7b), et ce n'est pas un déficit.
    const juste = etatBarreBraise(pleine, 2)!
    expect(juste.deficit).toBe(false)
    expect(juste.horsEchelle).toBe(false)
    // Un tick plus tard la couverture tombe à 1 et le MÊME lieu passe en déficit — c'est
    // « le palier se touche, il ne s'habite pas », rendu visible sans un mot.
    const apresUnTick = etatBarreBraise({ niveau: 0, charge: 2 * T - 1 }, 2)!
    expect(apresUnTick.deficit).toBe(true)
    expect(apresUnTick.horsEchelle).toBe(false)
  })

  it('SUR UN VERROU : la braise de départ devant le palier 2 d’hiver (B-R4b) — « il te manque l’arbre »', () => {
    // La table de B-R4b, éprouvée au cran près dans `braise.test.ts` : en hiver le palier k
    // exige k+1 crans. Le palier 2 en demande donc 3, et la braise de départ en a deux.
    // ⚠ CE QUE LA DÉCISION DU 2026-10-04 A DÉPLACÉ : avant, le repère s'épinglait HORS du tube
    // (« il n'y a plus de place ») ; maintenant il tombe sur un cran VERROUILLÉ (« ce palier
    // existe, il te manque l'arbre »). Même information, montrée sur la serrure.
    const PALIER_2_HIVER = 3
    const depart = braiseNeuve(0)
    expect(cransMax(depart.niveau), 'la braise de départ : deux crans').toBe(2)
    const e = etatBarreBraise(depart, PALIER_2_HIVER)!
    expect(e.verrouille, 'le repère tombe sur un cran que l’arbre n’a pas ouvert').toBe(true)
    expect(e.horsEchelle, 'mais il reste DANS le tube : il a une case').toBe(false)
    expect(e.demande).toBeLessThanOrEqual(e.cases)
    expect(e.deficit).toBe(true)
    // Et au niveau 1 de l'arbre, l'échelle rattrape le palier : la case est déverrouillée.
    const monte = etatBarreBraise(braiseNeuve(1), PALIER_2_HIVER)!
    expect(monte.verrouille, 'trois crans : le palier 2 d’hiver se touche').toBe(false)
    expect(monte.horsEchelle).toBe(false)
    expect(monte.deficit).toBe(false)
  })

  it('LE TUBE COUVRE LA TABLE DE B-R4b — mais PAS la tempête : le repère épinglé est un état JOUÉ', () => {
    // ⚠ LE TITRE ET LE COMMENTAIRE DE CETTE GARDE ÉTAIENT FAUX, démentis par `determinisme-sim` le
    // 2026-10-04 et corrigés ici. J'avais écrit « donc sur la carte actuelle `horsEchelle` ne peut
    // JAMAIS être vrai » : c'est FAUX. MESURÉ sur le monde joué (graine 2026, les 56 couples
    // (palier, terrain) marchables, l'année entière) — sans météo le pire est bien 4, mais à
    // **4,0 °C près** (l'air descend à −102 et le 5ᵉ cran s'ouvre à −106) ; et **sous orage le
    // palier 3 exige 5**, sur 542 315 tuiles marchables (26,2 %) et 71 jours sur 120. Or la météo
    // est ARMÉE dans le vrai jeu (`veillee.ts`). Le repère épinglé n'est donc pas un filet dormant :
    // c'est l'état normal d'une tempête d'altitude. L'arbitrage est ouvert (`braise.md` § 5.20).
    //
    // ⚠ ET CETTE GARDE NE PEUT TOUJOURS ATTRAPER QU'UN SENS, il faut le dire : elle rougit si
    // quelqu'un BAISSE `CRANS_MAX` sous la table, jamais si le MONDE en demande plus — parce que
    // le 4 ci-dessous est un littéral, et qu'un test de client ne peut pas balayer la carte. La
    // garde qui le ferait vit dans `/sim`, et elle n'existe pas encore.
    const PIRE_DEMANDE_DE_LA_TABLE = 4 // palier 3, cœur du Grand Froid, SANS front (B-R4b)
    const PIRE_DEMANDE_DU_MONDE = PIRE_DEMANDE_DE_LA_TABLE
    expect(BRAISE.CRANS_MAX, 'le tube couvre tout ce que la montagne sait exiger').toBeGreaterThanOrEqual(PIRE_DEMANDE_DU_MONDE)
    for (let d = 0; d <= PIRE_DEMANDE_DU_MONDE; d++) {
      expect(etatBarreBraise(braiseNeuve(0), d)!.horsEchelle, `demande ${d}`).toBe(false)
    }
    // Et le repère s'épingle bien un cran au-dessus — ce que la tempête d'altitude atteint
    // RÉELLEMENT aujourd'hui (§ 5.20), et non « le jour où un palier de plus existera ».
    const auDela = etatBarreBraise(braiseNeuve(0), BRAISE.CRANS_MAX + 1)!
    expect(auDela.horsEchelle, 'au-delà du tube entier, le repère s’épingle').toBe(true)
    expect(auDela.verrouille, 'et les deux repères ne se montrent jamais ensemble').toBe(false)
  })

  it('PAS DE BARRE sans les DEUX moitiés — une sauvegarde d’avant la braise ne doit pas mentir un plein', () => {
    expect(etatBarreBraise(undefined, 2)).toBeNull()
    expect(etatBarreBraise(braiseNeuve(0), undefined)).toBeNull()
    expect(etatBarreBraise(undefined, undefined)).toBeNull()
  })
})

describe('la colonne et ses voisins du bord droit', () => {
  it('LES TROIS SUPPORTS DU RENDU EXISTENT — plein, fuite, repère (et le repère hors échelle)', () => {
    const css = cssBarreBraise(92)
    // Le cran qui fuit ne doit JAMAIS porter la couleur de braise : c'est tout l'objet de B-R7b.
    const fuite = css.slice(css.indexOf('.bb-fuite'), css.indexOf('.bb-exige'))
    expect(fuite).toContain('--bb-reste')
    // ⚠ LA LOI PORTE SUR LA SURFACE, PAS SUR LE TRAIT — et ma première version ne le disait pas :
    // elle interdisait `c98b3a` dans toute la règle, et elle a rougi sur le LISERÉ de niveau, qui
    // est braise exprès. Ce qui ne doit jamais être braise, c'est l'APLAT : un cran qui fuit
    // rempli de braise serait indistinguable d'un cran plein, et B-R7b tomberait.
    // ⚠ ET LA DÉCOUPE S'AFFIRME AVANT DE SE LIRE : un `indexOf` manqué rend −1, et `slice(-1, -1)`
    // rend la chaîne VIDE — sur laquelle un `not.toContain` passe pour rien. Une garde qui ne peut
    // pas échouer donne le bon résultat par accident.
    expect(fuite, 'la règle du cran qui fuit existe et porte un aplat').toContain('background:')
    const aplat = fuite.slice(fuite.indexOf('background:'), fuite.indexOf(';', fuite.indexOf('background:')))
    expect(aplat.length, 'la découpe de l’aplat a bien mordu').toBeGreaterThan(11)
    expect(aplat, 'l’aplat du cran qui fuit n’est jamais la braise').not.toContain('c98b3a')
    expect(fuite, 'mais son LISERÉ l’est : c’est le niveau qui descend').toContain('border-top:2px solid #c98b3a')
    // Le repère a bien ses deux formes, et les deux débordent du tube (un trait de 26 px de
    // large à l'intérieur d'un cadre de 26 px ne se verrait pas).
    expect(css).toContain('.bb-exige::before')
    expect(css).toContain('.bb-hors')
    // ⓪ LE VERROU EST UN TROU, pas un gris de plus (décision d'Alexis, 2026-10-04 : « pas noir,
    // transparent par contre pour les niveaux supérieurs non débloqués »). Un aplat sombre se lit
    // comme un cran DÉPENSÉ ; le vide, lui, dit « ce cran n'existe pas encore ».
    const verrou = css.slice(css.indexOf('.bb-verrou'), css.indexOf('.bb-plein'))
    expect(verrou, 'la règle du verrou existe').toContain('background:')
    expect(verrou, 'et c’est un TROU — le monde passe au travers').toContain('background:transparent')
    expect(verrou, 'jamais la braise : un verrou n’est pas du feu').not.toContain('c98b3a')
    // ⚠ ET LE TUBE LUI-MÊME N'A PLUS DE FOND, sinon il boucherait le trou. C'est le couple qui
    // compte : rendre le verrou transparent sans ouvrir le tube ne montrerait que son noir.
    const regle = css.slice(css.indexOf('.bb{'), css.indexOf('}', css.indexOf('.bb{')))
    expect(regle, 'le tube est ouvert').toContain('background:transparent')
    // …mais les cases DÉBLOQUÉES gardent leur support opaque : c'est là que vit l'opacité que la
    // mesure du matin a imposée (le cran qui fuit à 1,12 de contraste sur le monde).
    const casePleine = css.slice(css.indexOf('.bb-c{'), css.indexOf('}', css.indexOf('.bb-c{')))
    expect(casePleine, 'la case débloquée garde son support').toContain('#1b1b22')
    // ⚠ ET LE VERROU NE PORTE AUCUNE MARQUE (décision d'Alexis, 2026-10-04 : « n'affiche le cadre
    // que pour les niveaux débloqués pas le reste »). Ma version intermédiaire cernait chaque
    // verrou pour qu'on puisse les compter ; c'est le CADRE qui porte cette lecture maintenant,
    // par sa hauteur. Rien ne se peint au-dessus de lui.
    expect(verrou, 'rien ne marque un verrou').toContain('box-shadow:none')
    // ═══ ET LE CADRE NE TIENT QUE LES CRANS OUVERTS — IL GRANDIT AVEC L'ARBRE ═══
    const cadre = css.slice(css.indexOf('.bb-cadre{'), css.indexOf('}', css.indexOf('.bb-cadre{')))
    expect(cadre, 'le cadre est un élément à lui, pas la bordure du tube').toContain(`border:${BARRE_BRAISE_BORD}px solid ${HEX_INK}`)
    expect(cadre, 'et il déborde pour redevenir la boîte de bordure').toContain(`bottom:-${BARRE_BRAISE_BORD}px`)
    // …tandis que le tube, lui, garde une bordure TRANSPARENTE : elle ne se voit plus mais tient
    // toujours la géométrie. La retirer élargirait chaque cran de 4 px sans que rien ne le dise.
    const tube = css.slice(css.indexOf('.bb{'), css.indexOf('}', css.indexOf('.bb{')))
    expect(tube, 'le tube ne porte plus de cadre visible').toContain('solid transparent')
    expect(css.match(/left:-7px;right:-7px/g)?.length, 'les deux repères débordent').toBe(2)
    // Et la hauteur vient des ANCRES du HUD, pas d'un nombre à elle.
    expect(css).toContain('top:92px')
    expect(css).toContain('bottom:24px')
  })

  it('LA HAUTEUR DU CADRE EST EXACTE AU PIXEL — et au bout de l’arbre elle vaut le tube entier', () => {
    // ═══ LA GARDE QUI REMPLACE LA RECOPIE ═══
    // `hauteurDuCadre` est de l'arithmétique écrite à la main sur la géométrie du flex. Si le
    // `gap` ou le `padding` du tube changeait sans qu'elle suive, le cadre se décalerait d'un
    // pixel par cran — invisible à l'œil sur un cran, net sur quatre. On rejoue donc le calcul
    // du navigateur à la main, pour une planche de hauteur connue.
    const H = 964 // le tube mesuré : top 92, bottom 24 sur une planche de 1080
    const P = BARRE_BRAISE_PAD, E = BARRE_BRAISE_ECART, B = BARRE_BRAISE_BORD
    // Ce que ferait le navigateur : `100%` d'un enfant absolu se résout sur la boîte de PADDING.
    const evalue = (css: string): number => {
      const m = /calc\((\d+) \* \(100% - (\d+)px\) \/ (\d+) \+ (\d+)px\)/.exec(css)
      expect(m, `forme attendue, reçu ${css}`).not.toBeNull()
      const [, a, retrait, n, ajout] = m!.map(Number)
      return (a! * (H - 2 * B - retrait!)) / n! + ajout!
    }
    for (const n of [2, 3, 4, 5]) {
      const contenu = H - 2 * B - 2 * P
      const h = (contenu - (n - 1) * E) / n
      for (let m = 1; m <= n; m++) {
        const attendu = m * h + (m - 1) * E + 2 * P + 2 * B
        expect(evalue(hauteurDuCadre(m, n)), `${m} crans ouverts sur ${n}`).toBeCloseTo(attendu, 9)
      }
      // ⚠ LA CLAUSE QUI PORTE LA PHRASE D'ALEXIS : « elle doit prendre toute la hauteur quand
      // elle est full upgrade ». Au bout de l'arbre, le cadre vaut le TUBE ENTIER, au pixel.
      expect(evalue(hauteurDuCadre(n, n)), `au bout de l’arbre (n = ${n})`).toBeCloseTo(H, 9)
    }
  })

  it('LA PILE D’ARTISANAT NE PEUT PLUS REVENIR SOUS LA COLONNE — elle lit sa largeur, elle ne la recopie pas', () => {
    // ⚠ CE QUE CETTE GARDE ATTRAPE : `craft-queue.ts` était SEULE au bord droit, ancrée à
    // `right:26px` sur 312 px de large, et la colonne de crans s'y serait posée dessous sans
    // qu'aucun `tsc` ni aucun test ne le voie (le CSS est une chaîne — c'est la leçon de
    // `hud-pointeur.test.ts`). Le rapport entre les deux est donc IMPORTÉ.
    const cq = ici('craft-queue.ts')
    expect(cq).toContain("from './barre-braise'")
    expect(cq).toContain('BARRE_BRAISE_W')
    expect(cq, 'la pile ne doit plus s’ancrer au bord nu').not.toContain('.cq{position:absolute;right:26px')
    // Et le décalage couvre vraiment la colonne, marge comprise.
    expect(26 + BARRE_BRAISE_W + BARRE_BRAISE_GAP).toBeGreaterThan(26 + BARRE_BRAISE_W)
  })

  it('LA COLONNE EST MONTÉE DANS `.hc` — sinon elle se verrait par-dessus l’écran de chargement', () => {
    // Elle n'a pas d'ancre à elle sur la planche : accrochée à la racine du HUD, elle hérite de
    // `setVisible` (chargement, voile de mort) et du garde `worldReady`.
    const hc = ici('hud-core.ts')
    expect(hc).toContain('createBarreBraise(root)')
    expect(hc).toContain('etatBarreBraise(s.braise, s.cransDemandes)')
  })

  it('ELLE SE CACHE SOUS UN MENU — le HUD devient opaque, elle s’en va (décision du 2026-10-04)', () => {
    // ⚠ CE QUE CETTE GARDE TIENT : le HUD ne DISPARAÎT pas sous l'écran personnage, il devient
    // OPAQUE (`--hud-alpha` passe à 1) — les vitales restent lisibles par dessein. La colonne,
    // elle, doit partir, et c'est le même geste que la ceinture et le coin haut-gauche qui
    // cèdent la place à la barre d'onglets. Un héritage ne suffisait donc pas : il faut le dire.
    const hc = ici('hud-core.ts')
    expect(hc, 'le drapeau du menu est PASSÉ à la colonne').toContain('s.characterMenuOpen)')
    expect(hc).toMatch(/barreBraise\.update\([^)]*\)\s*,\s*s\.characterMenuOpen\)/)
    // Et la colonne s'efface vraiment, au lieu de s'alléger : `display:none`, pas une opacité.
    const src = ici('barre-braise.ts')
    expect(src, 'le menu passe AVANT l’état, sinon une demande tardive la repeindrait').toContain(
      "if (menuOuvert || e === null) {",
    )
  })

  it('ELLE NE PREND PAS L’EFFACEMENT DU HUD, ET C’EST MESURÉ — pas un goût', () => {
    // ⚠ CE QUE CETTE GARDE TIENT : à `--hud-alpha` (0,85) le remplissage composite sur le MONDE,
    // et le cran qui FUIT tombe à **1,12** de contraste contre un sous-bois et 1,43 contre la
    // pierre, là où une forme pleine demande 3:1 — même la nuit il plafonne à 2,31. B-R7b exige
    // « visiblement hors compte » : à ce contraste-là le troisième état n'existe pas. Opaque, il
    // se lit sur le vide de sa case (2,57) et contre le plein (2,30), et c'est le cadre d'encre
    // qui détoure la colonne du monde (3,61 à midi). Remettre l'effacement reperdrait l'état.
    // ⚠ On lit LA RÈGLE `.bb`, pas la feuille entière : le commentaire qui explique la mesure
    // nomme `--hud-alpha`, et une garde qui cherche la chaîne partout rougit sur sa propre prose.
    const css = cssBarreBraise(92)
    expect(css, 'la règle existe — sinon la découpe qui suit lirait du vide').toContain('.bb{')
    const regle = css.slice(css.indexOf('.bb{'), css.indexOf('}', css.indexOf('.bb{')))
    expect(regle, 'la règle de la colonne elle-même').not.toContain('--hud-alpha')
    expect(regle, 'elle existe bien et porte son cadre').toContain('border:2px solid')
  })

  it('LES DEUX REPÈRES SONT CERNÉS D’ENCRE — l’alerte sur un cran plein ne fait que 1,26', () => {
    // ⚠ LE SECOND DÉFAUT QUE LA MESURE A TROUVÉ, et le plus coûteux : `#e05a4a` sur `#c98b3a`
    // donne **1,26**, or la demande porte presque toujours sur une case PLEINE — le trait le plus
    // important de la barre était quasi invisible dans son cas le plus fréquent. Cerné d'encre il
    // passe à 4,4 contre lui-même et 6,3 contre le plein (le `INK_OUTLINE` du HUD, sur une forme).
    const css = cssBarreBraise(92)
    // ⚠ CHAQUE RÈGLE SE LIT DANS SES PROPRES BORNES, et ma première version ne le faisait pas :
    // elle découpait de `.bb-exige::before` jusqu'à la FIN de la feuille, donc elle trouvait le
    // liseré de `.bb-hors` à la place du sien. FALSIFICATION JOUÉE (2026-10-04) : liseré retiré du
    // repère dans l'échelle → la garde restait VERTE. Deux affirmations sur deux tranches disjointes.
    expect(css.indexOf('.bb-exige::before')).toBeLessThan(css.indexOf('.bb-hors'))
    const repere = css.slice(css.indexOf('.bb-exige::before'), css.indexOf('.bb-hors'))
    expect(repere, 'le repère DANS l’échelle, cerné').toContain('box-shadow:0 0 0 1px')
    const hors = css.slice(css.indexOf('.bb-hors'))
    expect(hors, 'le repère ÉPINGLÉ au-dessus du tube, cerné').toContain('box-shadow:0 0 0 1px')
  })
})
