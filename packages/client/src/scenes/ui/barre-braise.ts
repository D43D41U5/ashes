/**
 * ═══ LA BARRE DE CRANS DE LA BRAISE — le bord droit du HUD (`braise.md` § 5.12) ═══
 *
 * La braise existe dans la sim depuis le 2026-10-03 et ne se voyait NULLE PART : on mourait de
 * froid sans qu'un pixel ne l'annonce, et la laisse d'altitude — « jusqu'où je peux monter » —
 * était une donnée invisible. Forme choisie par Alexis le 2026-10-04 : **le tube**, « une barre à
 * droite dans le HUB qui prend la hauteur dispo ».
 *
 * ⚠ **L'ÉCHELLE EST CELLE DU BOUT DE L'ARBRE, ET LE CRAN NE BOUGE JAMAIS** (décision d'Alexis,
 * 2026-10-04 : *« elle doit prendre toute la hauteur quand elle est full upgrade, tu masques les
 * niveaux qui n'ont pas été débloqué »*). Le tube se divise toujours en `BRAISE.CRANS_MAX` cases
 * — quatre, ce que la montagne sait demander au plus (palier 3 au Grand Froid, B-R4b) — et les
 * cases au-delà de `cransMax(niveau)` se peignent en **verrou**.
 *
 * ⚠ **Ma première version faisait l'inverse, et c'était un défaut** : elle dimensionnait le tube
 * sur l'échelle COURANTE, donc gagner un cran redessinait toute la barre et déplaçait tout ce que
 * l'œil avait appris à lire. À cran fixe, la colonne devient une **mémoire de progression** : on
 * voit ce qu'on n'a pas encore. Le `flex: 1` reste — c'est le NOMBRE de cases qui ne bouge plus.
 *
 * ⚠ **Et ça déplace le message du repère, en mieux.** Quand le lieu exige plus que l'échelle
 * débloquée, le repère ne s'épingle plus hors du tube : il tombe **sur un cran verrouillé**, et
 * dit « ce palier existe, il te manque l'arbre » au lieu de « il n'y a plus de place ». Il montre
 * la serrure. Le repère épinglé (`.bb-hors`) reste comme FILET, pour le seul cas qui le mérite
 * encore : une demande qui dépasserait `CRANS_MAX` lui-même — que la carte actuelle ne sait pas
 * produire, mais qu'un palier de plus produirait.
 *
 * ═══ TROIS CHOSES SE PEIGNENT, ET LA TROISIÈME EST CELLE QUI FAIT LE JEU ═══
 *
 * ① **Ce qui est PLEIN** — `cransCouverts`, en braise. C'est ce que la braise tient vraiment.
 *
 * ② **Le cran qui FUIT** — la part du cran du haut, en cadre chaud et **jamais en braise**. Sous
 *    `floor` il ne compte pas (B-R7b : « un cran ne vaut que plein, et ça doit se voir sans
 *    texte ») : la spec réclamait nommément cette dette de lisibilité, elle est payée par la
 *    COULEUR — on ne peut pas confondre un cran qu'on a avec un cran qui s'en va.
 *
 * ③ **Ce que le LIEU EXIGE** — `cransExiges`, un repère d'alerte en travers, qui déborde du tube.
 *    C'est lui qui transforme une jauge en décision : le repère au-dessus du plein dit « il me
 *    manque un cran, je redescends » sans un chiffre. Le cadre passe à l'alerte avec lui.
 *    ⚠ Et il a **trois** états, pas un : sur un cran OUVERT (la case `demande − 1`) ; sur un cran
 *    VERROUILLÉ — c'est la braise de départ face au palier 2 d'hiver, qui demande 3 crans quand
 *    l'arbre n'en a ouvert que 2, et c'est le message central de la barre : « ce palier existe,
 *    il te manque l'arbre » ; et absent quand la demande est nulle (l'été en bas, la grotte, le
 *    pied d'une balise — B-R8). Le quatrième, épinglé HORS du tube, n'est qu'un filet : il
 *    demanderait une exigence au-delà de `CRANS_MAX`, que la carte actuelle ne sait pas produire.
 *
 * ═══ PUREMENT DE L'AFFICHAGE ═══
 *
 * Aucune règle : `cransCouverts` et `cransMax` viennent de `/sim`, qui les exporte justement
 * « pour le CLIENT, qui doit peindre `cransCouverts` », et la demande arrive du registry
 * (`WorldScene` la lit sur la façade du gel, à côté de l'ambiant et à la même cadence). Rien
 * n'est re-dérivé ici — la seule arithmétique de ce fichier est la FRACTION du cran qui fuit,
 * que `/sim` n'expose pas parce qu'elle n'a aucun sens pour la règle.
 */
import { BRAISE, cransCouverts, cransMax, type Braise } from '@ashes/sim'
import { HEX } from './palette'

/**
 * LA LARGEUR QUE LA COLONNE PREND AU BORD DROIT, en px de planche (1920 × 1080).
 *
 * ⚠ **Elle est exportée parce qu'elle est PARTAGÉE** : la pile d'artisanat (`craft-queue.ts`)
 * était seule au bord droit et s'y ancrait à 26 px ; elle se décale maintenant de cette largeur,
 * et le rapport entre les deux est ÉCRIT au lieu d'être recopié de part et d'autre.
 */
export const BARRE_BRAISE_W = 26

/** La marge entre la colonne et ce qui se range à sa gauche. */
export const BARRE_BRAISE_GAP = 12

/**
 * ═══ LA GÉOMÉTRIE INTERNE DU TUBE, en px de planche ═══
 *
 * ⚠ **Elles sont ÉCRITES ICI parce que la hauteur du cadre se CALCULE dessus** (décision
 * d'Alexis, 2026-10-04 : « n'affiche le cadre que pour les niveaux débloqués pas le reste »).
 * Le cadre n'entoure plus tout le tube : il ne tient que les crans ouverts, donc il GRANDIT avec
 * l'arbre et n'atteint toute la hauteur qu'au bout — ce qui est très exactement « elle doit
 * prendre toute la hauteur quand elle est full upgrade », pris au mot.
 *
 * Les recopier dans le CSS et dans la formule aurait laissé les deux dériver en silence : un
 * `gap` changé à la main aurait décalé le cadre d'un pixel par cran sans qu'aucun `tsc` ni aucun
 * test ne le voie. `hauteurDuCadre` les relit, et une garde affirme le résultat au pixel.
 */
export const BARRE_BRAISE_PAD = 3
export const BARRE_BRAISE_ECART = 3
export const BARRE_BRAISE_BORD = 2

/**
 * LA HAUTEUR DU CADRE, en CSS, pour `m` crans ouverts sur `n` cases — exprimée en `calc()` pour
 * que le navigateur fasse l'arithmétique sur la hauteur réelle, quelle que soit l'échelle de la
 * planche (le board est transformé : un px écrit ici n'est pas un px à l'écran).
 *
 * Posée sur un enfant absolu débordant de la bordure (`left/right/bottom: −BORD`), dont les `%`
 * se résolvent donc sur la **boîte de padding** du tube — d'où le `+ 2·BORD` qui rend la boîte
 * de bordure. En notant `h` la hauteur d'un cran :
 *
 *     contenu   = 100% + 2·BORD − 2·BORD − 2·PAD = 100% − 2·PAD
 *     h         = (contenu − (n−1)·ÉCART) / n
 *     cadre     = m·h + (m−1)·ÉCART + 2·PAD + 2·BORD
 */
export function hauteurDuCadre(m: number, n: number): string {
  const P = BARRE_BRAISE_PAD
  const E = BARRE_BRAISE_ECART
  const B = BARRE_BRAISE_BORD
  const retrait = 2 * P + (n - 1) * E
  const ajout = (m - 1) * E + 2 * P + 2 * B
  return `calc(${m} * (100% - ${retrait}px) / ${n} + ${ajout}px)`
}

/** Ce que la barre doit MONTRER — pur, pour être éprouvé sans monter un DOM ni un Phaser
 *  (patron d'`etatVital`, `hud-core.ts`). */
export interface EtatBarreBraise {
  /** Les crans COUVERTS (`cransCouverts`, donc `floor`) : les cases pleines. */
  pleins: number
  /** L'échelle DÉBLOQUÉE (`cransMax(niveau)`) : au-delà, les cases sont des verrous.
   *  C'est elle qui borne `pleins`, et elle seule qui grandit avec l'arbre (B-R14). */
  max: number
  /** LE NOMBRE DE CASES DU TUBE, qui ne bouge jamais : `BRAISE.CRANS_MAX`, le bout de l'arbre.
   *  ⚠ Pris au MAX avec `max` — une braise qui dépasserait le sommet déclaré (un arbre réglé
   *  trop haut) se peint en entier plutôt que de se faire rogner en silence. */
  cases: number
  /** La part du cran qui fuit, dans `[0, 1[`. Zéro quand il n'y a PAS de cran qui fuit —
   *  c'est-à-dire à charge exactement pleine, le seul instant où `pleins === max`. */
  resteDuCran: number
  /** Ce que le lieu exige (`cransExiges`). **Non borné** : il peut dépasser `max`, et c'est
   *  précisément le cas intéressant. */
  demande: number
  /** La demande dépasse-t-elle ce qui est couvert ? C'est le déficit de B-R6 — le corps a
   *  commencé à se mettre à mourir. */
  deficit: boolean
  /** La demande dépasse-t-elle l'échelle DÉBLOQUÉE sans dépasser le tube ? Le repère tombe alors
   *  sur un cran VERROUILLÉ : « ce palier existe, il te manque l'arbre. » */
  verrouille: boolean
  /** La demande dépasse-t-elle le TUBE ENTIER (`cases`) ? Le repère n'a alors plus aucune case
   *  où se poser et s'épingle au-dessus. ⚠ Injouable sur la carte actuelle — le pire que la
   *  montagne demande est `CRANS_MAX` —, gardé comme filet pour un palier de plus. */
  horsEchelle: boolean
}

/**
 * L'état peint, de la braise portée et de la demande du lieu.
 *
 * `null` quand l'un des deux manque — une sauvegarde d'avant la braise, ou un premier tick où
 * `WorldScene` n'a pas encore relevé la demande : la barre ne se montre alors pas du tout,
 * plutôt que de mentir un plein ou un zéro.
 */
export function etatBarreBraise(braise: Braise | undefined, demande: number | undefined): EtatBarreBraise | null {
  if (braise === undefined || demande === undefined) return null
  const max = cransMax(braise.niveau)
  // LE TUBE A TOUJOURS LA TAILLE DU BOUT DE L'ARBRE. Le `max(…)` n'est pas de la prudence pour
  // rien : `cransMax` n'est volontairement PAS borné dans `/sim` (voir `BRAISE.CRANS_MAX`), donc
  // un arbre réglé au-delà du sommet déclaré se peindrait en entier au lieu d'être rogné sans un
  // mot — un défaut visible plutôt qu'un silence.
  const cases = Math.max(BRAISE.CRANS_MAX, max)
  const pleins = cransCouverts(braise) // la règle vient de /sim, borne comprise
  // La fraction du cran du haut. À charge pleine le modulo rend 0 ET `pleins === max` : il n'y a
  // pas de case au-dessus du plein, donc rien à peindre — les deux conditions coïncident, et on
  // garde quand même l'index (`pleins < max`) parce que c'est LUI qui indexe le DOM plus bas.
  // ⚠ C'est bien `max` (le DÉBLOQUÉ) et jamais `cases` : au plein d'une braise non finie, le
  // cran du dessus est un VERROU, et un verrou ne fuit pas.
  const resteDuCran = pleins < max ? (braise.charge % BRAISE.DUREE_CRAN) / BRAISE.DUREE_CRAN : 0
  return {
    pleins,
    max,
    cases,
    resteDuCran,
    demande,
    deficit: demande > pleins,
    verrouille: demande > max && demande <= cases,
    horsEchelle: demande > cases,
  }
}

export interface BarreBraise {
  /** `menuOuvert` cache la colonne entièrement — décision d'Alexis du 2026-10-04, et c'est le
   *  patron maison : la ceinture et le coin haut-gauche se retirent déjà du même geste quand
   *  l'écran personnage prend la place (`hud-core.ts`). Le HUD, lui, devient OPAQUE sous le sac
   *  au lieu de disparaître ; la colonne, elle, s'en va. */
  update(e: EtatBarreBraise | null, menuOuvert: boolean): void
}

/**
 * Monte la colonne DANS le parent qu'on lui donne — et c'est délibéré : accrochée à la racine
 * `.hc`, elle hérite d'un coup des trois choses qui la cachent quand il faut (`setVisible` pour
 * l'écran de chargement et le voile de mort, `--hud-alpha` pour l'effacement en jeu, le garde
 * `worldReady` qui commande le tout). Un ancrage à elle sur la planche aurait eu à les refaire,
 * et se serait affichée par-dessus l'écran de chargement.
 */
export function createBarreBraise(parent: HTMLElement): BarreBraise {
  const root = document.createElement('div')
  root.className = 'bb'
  // ⚠ LE CADRE EST PREMIER DANS LE DOM, donc il peint SOUS les crans : les deux sont positionnés,
  // et sans z-index c'est l'ordre du document qui tranche. Dessus, il barrerait le cran plein.
  root.innerHTML = `<div class="bb-cadre"></div><div class="bb-hors"></div>`
  parent.appendChild(root)
  const cadreEl = root.querySelector<HTMLElement>('.bb-cadre')!
  const horsEl = root.querySelector<HTMLElement>('.bb-hors')!

  /** Les cases, du BAS vers le haut (le tube est en `column-reverse`). Rebâties seulement
   *  quand l'échelle change — `update` tourne à chaque image, et refaire N éléments 60 fois
   *  par seconde pour des classes qui ne bougent pas serait du déchet pur. */
  let cases: HTMLElement[] = []
  let maxBati = -1
  /** La dernière forme peinte du cadre, pour n'écrire le style que quand elle change — `update`
   *  tourne à chaque image, et réécrire un `calc()` identique 60 fois par seconde salirait le
   *  recalcul de style pour rien. */
  let cadreBati = ''

  const batir = (max: number): void => {
    for (const c of cases) c.remove()
    cases = []
    for (let i = 0; i < max; i++) {
      const c = document.createElement('div')
      c.className = 'bb-c'
      root.appendChild(c)
      cases.push(c)
    }
    maxBati = max
  }

  return {
    update(e, menuOuvert) {
      // ⚠ LE MENU PASSE AVANT L'ÉTAT, et c'est voulu : un `e === null` sous un menu ouvert doit
      // cacher la colonne pour la MÊME raison, mais l'ordre inverse laisserait un menu ouvert
      // repeindre la colonne au premier tick où la demande arrive.
      if (menuOuvert || e === null) {
        root.style.display = 'none'
        return
      }
      root.style.display = ''
      // LE TUBE NE SE REBÂTIT QUE SI LE SOMMET BOUGE — c'est-à-dire plus jamais en pratique,
      // puisque `cases` vaut `CRANS_MAX` sauf arbre déréglé. C'était le cas FRÉQUENT avant
      // (chaque cran gagné redessinait tout) ; il devient l'exception.
      if (e.cases !== maxBati) batir(e.cases)
      // LE CADRE NE TIENT QUE LES CRANS OUVERTS — c'est lui, par sa hauteur, qui dit où en est
      // l'arbre. Il n'atteint le haut du tube qu'au bout (`e.max === e.cases`).
      const forme = hauteurDuCadre(e.max, e.cases)
      if (forme !== cadreBati) {
        cadreEl.style.height = forme
        cadreBati = forme
      }

      for (let i = 0; i < cases.length; i++) {
        const c = cases[i]!
        const verrou = i >= e.max
        const plein = i < e.pleins
        const fuite = i === e.pleins && e.resteDuCran > 0
        // ① LE VERROU : un cran que l'arbre n'a pas encore ouvert. Il n'est ni plein ni vide —
        // c'est une TROISIÈME nature, et c'est elle qui fait de la colonne une mémoire de
        // progression plutôt qu'une jauge.
        c.classList.toggle('bb-verrou', verrou)
        c.classList.toggle('bb-plein', plein)
        c.classList.toggle('bb-fuite', fuite)
        if (fuite) c.style.setProperty('--bb-reste', `${e.resteDuCran * 100}%`)
        // LE REPÈRE DU LIEU sur la case que la demande exige PLEINE — donc `demande − 1`, et
        // en pseudo-élément sur la case elle-même : posé en absolu sur le tube, il aurait fallu
        // refaire à la main le calcul du `gap` et du `padding` que le flex fait déjà.
        // ⚠ Il se pose AUSSI sur un verrou, et c'est tout l'intérêt : « ce palier existe, il te
        // manque l'arbre » se montre sur la serrure elle-même.
        c.classList.toggle('bb-exige', !e.horsEchelle && e.demande > 0 && i === e.demande - 1)
      }

      // AU-DELÀ DU TUBE ENTIER : le repère n'a plus aucune case où se poser, il s'épingle
      // au-dessus. ⚠ Injouable sur la carte actuelle (le pire que la montagne demande EST
      // `CRANS_MAX`) — c'est le filet pour le jour où un palier de plus existera.
      horsEl.style.display = e.horsEchelle ? '' : 'none'
      // Le déficit teinte le CADRE : il coexiste donc avec le repère, sur un autre support.
      root.classList.toggle('bb-manque', e.deficit)
    },
  }
}

/** Le CSS de la colonne, concaténé dans la feuille de `hud-core` (une seule feuille pour le HUD). */
export function cssBarreBraise(topPx: number): string {
  return `
    /* ═══ LA BARRE DE CRANS (braise.md § 5.12) ═══
       Elle prend la hauteur dispo entre la barre haute et le bas des médaillons : mêmes ancres
       que le reste du HUD (« .hc-tl » en haut, « .hc-bl » en bas), pas des nombres à elle.
       « column-reverse » : la case 0 est EN BAS — la barre se vide du haut (B-R3). */
    .bb{position:absolute;right:26px;top:${topPx}px;bottom:24px;width:${BARRE_BRAISE_W}px;
      box-sizing:border-box;display:flex;flex-direction:column-reverse;
      gap:${BARRE_BRAISE_ECART}px;padding:${BARRE_BRAISE_PAD}px;
      /* ⚠ LA BORDURE EST TRANSPARENTE ET C'EST VOULU : elle ne se voit plus, mais elle tient
         toujours la GÉOMÉTRIE (la largeur utile d'un cran, l'origine des pourcentages). Le
         cadre VISIBLE est « .bb-cadre », qui ne couvre que les crans ouverts. La retirer aurait
         élargi les crans de 4 px sans que rien ne le dise. */
      border:${BARRE_BRAISE_BORD}px solid transparent;background:transparent;
      z-index:10;pointer-events:none;}
    /* ═══ LE CADRE — IL NE TIENT QUE LES CRANS DÉBLOQUÉS (décision d'Alexis, 2026-10-04) ═══
       Donc il GRANDIT avec l'arbre, et n'atteint toute la hauteur qu'au bout : le cadre EST
       l'indicateur de progression, et la colonne n'a besoin d'aucune marque sur le vide
       au-dessus. Sa hauteur vient de « hauteurDuCadre », qui relit les constantes de géométrie
       au lieu de les recopier. Il déborde de la bordure (−BORD de trois côtés) pour redevenir
       la boîte de BORDURE du tube, et il est AVANT les crans dans le DOM, donc dessous. */
    .bb-cadre{position:absolute;left:-${BARRE_BRAISE_BORD}px;right:-${BARRE_BRAISE_BORD}px;
      bottom:-${BARRE_BRAISE_BORD}px;box-sizing:border-box;pointer-events:none;
      border:${BARRE_BRAISE_BORD}px solid ${HEX.ink};box-shadow:0 3px 0 rgba(0,0,0,.5);}
    /* Le déficit se dit par le CADRE, pour que le repère du lieu reste libre de son support. */
    .bb-manque .bb-cadre{border-color:${HEX.alert};}
    /* ⚠ LE FOND EST QUASI OPAQUE, ET C'EST UNE CORRECTION VUE À L'IMAGE (2026-10-04). À 55 %
       d'opacité et sous le « --hud-alpha » du HUD, le cran qui FUIT (#6b5a3a, un ambre éteint)
       se noyait dans une canopée verte : on ne voyait plus qu'une colonne olive, et B-R7b exige
       « visiblement hors compte ». Un fond à 92 % n'a pas suffi — le « --hud-alpha » du HUD
       (0,85) laisse passer le monde par-dessus. On prend donc la grammaire des MÉDAILLONS, qui
       est la réponse maison documentée à « posé à nu sur un monde qui change de couleur et
       d'heure » (hud-core.ts, décision d'Alexis du 2026-08-20) : fond opaque, cadre d'encre,
       ombre portée. Le liquide se lit sur une surface constante, jamais sur la vallée.
       ⚠ ET LA COLONNE NE PREND PAS « --hud-alpha », SEULE DU HUD — c'est MESURÉ, pas un goût.
       À 0,85 le remplissage composite sur le MONDE, et le cran qui fuit tombe à un contraste de
       1,12 (sous-bois) à 1,43 (pierre) contre lui, là où une forme pleine demande 3:1 ; même la
       nuit il plafonne à 2,31. Opaque, il se lit sur le vide de sa case à 2,57 et contre le cran
       plein à 2,30, et c'est le CADRE D'ENCRE qui détoure la colonne du monde (3,61 à midi, 4,15
       sur la pierre). Les médaillons, eux, survivent au 0,85 parce que leurs liquides sont
       SATURÉS (rouge, jaune, vert) ; un ambre éteint ne le peut pas. */
    .bb-c{position:relative;flex:1;background:${HEX.panel};}
    /* ⓪ VERROUILLÉ : un cran que l'arbre n'a pas encore ouvert — et il est TRANSPARENT, on voit
       le monde au travers (décision d'Alexis, 2026-10-04 : « pas noir, transparent par contre
       pour les niveaux supérieurs non débloqués »). C'est une troisième nature, ni pleine ni
       vide : un trou dans la colonne. ⚠ Ma première version le hachurait en sombre, et c'était
       moins juste — un aplat sombre se lit comme un cran DÉPENSÉ, alors qu'un trou se lit comme
       un cran qui n'existe pas encore. Le vide dit mieux l'absence que n'importe quel gris.
       ⚠ C'EST POURQUOI LE TUBE LUI-MÊME N'A PLUS DE FOND : son « bgWarm » opaque aurait bouché
       le trou. L'opacité qui compte, celle que la mesure du matin a imposée, vit sur les cases
       DÉBLOQUÉES (« .bb-c ») — c'est là que le cran qui fuit avait besoin d'un support constant,
       et il l'a toujours.
       ⚠ ET IL NE PORTE AUCUNE MARQUE : ni cerne, ni cadre (« n'affiche le cadre que pour les
       niveaux débloqués pas le reste »). Ma version intermédiaire cernait chaque verrou pour
       qu'on puisse les COMPTER ; c'est le cadre qui porte maintenant cette information, par sa
       HAUTEUR — il grandit à chaque cran ouvert, et le vide au-dessus se mesure à ce qu'il
       n'atteint pas encore. Une marque de moins pour la même lecture. */
    .bb-verrou{background:transparent;box-shadow:none;}
    /* ① PLEIN : ce que la braise tient. */
    .bb-plein::after{content:'';position:absolute;inset:0;background:${HEX.ember};}
    /* ② QUI FUIT : un ambre ÉTEINT, jamais la braise — sous « floor » ce cran ne compte pas (B-R7b).
       ⚠ ET IL PORTE UN LISERÉ, vu à l'image (2026-10-04) : en aplat nu, un #6b5a3a à 85 %
       d'opacité sur une canopée de midi rend un olive qui se confond avec l'ombre des arbres —
       c'est une couleur de BORD, que la palette nomme « cadre chaud », et elle ne sait pas porter
       une surface. Le patron maison est celui du liquide des médaillons (.hc-fill, qui pose un
       border-top de 2 px au niveau même du liquide) : le NIVEAU se dit par un trait net, et c'est
       lui qu'on voit descendre. La surface reste éteinte, le trait reste braise — « ce cran ne
       compte pas, et le voilà qui s'en va ». */
    .bb-fuite::after{content:'';position:absolute;left:0;right:0;bottom:0;
      height:var(--bb-reste,0%);background:${HEX.borderWarm};border-top:2px solid ${HEX.ember};}
    /* ③ CE QUE LE LIEU EXIGE : un repère en travers, au SOMMET de la case exigée, qui déborde
       de part et d'autre — la grammaire de « .hc-seuil » sur les médaillons, sortie du cadre pour
       se lire sur un tube de 26 px. */
    /* ⚠ LE REPÈRE PORTE UN LISERÉ D'ENCRE, et c'est une SECONDE chose que la mesure a trouvée :
       l'alerte #e05a4a sur un cran plein #c98b3a ne fait que **1,26** de contraste — le trait le
       plus important de la barre était quasi invisible sur le cas le plus fréquent (la demande
       porte presque toujours sur une case pleine). Cerné d'encre il monte à 4,4 contre lui-même
       et 6,3 contre le plein : c'est le INK_OUTLINE du HUD, appliqué à une forme. */
    .bb-exige::before{content:'';position:absolute;left:-7px;right:-7px;top:-3px;height:2px;
      background:${HEX.alert};box-shadow:0 0 0 1px ${HEX.ink};}
    /* …et quand il n'a plus de case : épinglé au-dessus du tube. */
    .bb-hors{position:absolute;left:-7px;right:-7px;top:-7px;height:2px;background:${HEX.alert};
      box-shadow:0 0 0 1px ${HEX.ink};display:none;}`
}
