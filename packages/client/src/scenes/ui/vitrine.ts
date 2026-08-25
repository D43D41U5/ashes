/**
 * LA VITRINE — les images du jeu qui défilent à droite du menu principal (demande d'Alexis,
 * 2026-07-28 ; élargie le 2026-08-20 « plus de variétés et d'epicness », puis le 2026-08-24
 * « des paysages dramatiques, une météo de ouf, des hordes de cendreux, des biomes variés »).
 *
 * CE SONT DE VRAIES CAPTURES DU JEU, PAS DES ILLUSTRATIONS. Elles sortent du scénario smoke
 * `vitrine` (`pnpm smoke --scenario vitrine --dev`), qui téléporte l'avatar de lieu en lieu,
 * pose le jour de saison et l'heure, arme un ciel, masque le HUD et les noms de lieux, et
 * déclenche. C'est important pour deux raisons : ① l'accueil ne peut donc pas promettre un jeu
 * qui n'existe pas ; ② le jour où l'art bouge, on RELANCE l'atelier et on remplace ces
 * fichiers — la fraîcheur des images est à une commande, pas à une séance de photo.
 *
 * ET C'EST ARRIVÉ CINQ FOIS : le 2026-07-28 quand les arbres ont changé de taille, le
 * 2026-07-29 quand ils sont passés de deux sprites à dix, le 2026-08-01 quand le worldgen a
 * cessé de poser les tentes du campement, le 2026-08-20 pour la série des scènes, et le
 * 2026-08-24 pour celle-ci.
 *
 * ═══ CINQUIÈME SÉRIE — LE MONDE N'EST PLUS LE MÊME, ET LA PLANCHE NON PLUS ═══
 *
 * Trois choses ont changé sous la série précédente, et chacune l'invalidait :
 *
 *   · LE MONDE JOUÉ N'A PLUS QU'UNE ZONE. `MONDE_JOUE = 'racine'` : les Prés Bas, seuls
 *     (2026-08-24). La Cendrière-ZONE a disparu — donc les quatre « biomes » de l'ancienne
 *     planche aussi. **La variété ne se prend plus au SOL, elle se prend au CIEL, à la SAISON
 *     et à l'ÉTAT DU MONDE.** C'est la contrainte qui a écrit cette planche.
 *   · LE MONDE S'OUVRE AU JOUR 61, pas au jour 1 (`saisons.md` S2) — en pleine saison des
 *     Pluies. L'ancienne planche visait les jours 1, 47, 51 : des sauts EN ARRIÈRE, que
 *     `debug_set_season_day` refuse en silence. Elle photographiait donc une lumière qu'elle
 *     croyait avoir choisie. L'atelier LIT désormais le jour d'ouverture.
 *   · LA CENDRE SOURD DES FOSSES (`cendre.md`, 2026-08-24) : un foyer par charnier, une tache
 *     qui s'étend en √t. C'est le sujet du jeu, il a enfin un BORD, et il se photographie.
 *
 * ═══ LES TROIS MESURES QUI ONT DÉCIDÉ DE LA SÉRIE ═══
 *
 * ① **L'HEURE EST UN LEVIER FAIBLE.** La même futaie tirée à 5,2 · 6 · 6,6 · 7,4 · 19 · 19,8 ·
 *    20,8 h (`SMOKE_ECHELLE`, l'échelle d'heures ajoutée pour ça) rend SEPT IMAGES QUASI
 *    IDENTIQUES : l'alpha d'`AMBIENT_KEYS` plafonne à 0,34, et sur un cadre de vingt tuiles un
 *    voile à 0,34 ne fait pas une lumière, il fait une teinte. Une prise n'a donc le droit
 *    d'exister sur sa seule heure que si elle a déjà autre chose à montrer. C'est ce qui a
 *    sorti trois paysages de la planche et fait entrer quatre ciels.
 * ② **LA NEIGE NE SUPPORTE PAS QU'ON ÉLARGISSE LE CADRE.** Son grain est quantifié sur la
 *    grille de l'art (4 px, `GRAIN_PX` — les FX de ce jeu ne sont jamais lissés) : au cadrage
 *    du jeu elle fait des flocons, à vingt-quatre tuiles elle fait des BLOCS BLANCS gros comme
 *    un tronc. La pluie, elle, est un trait fin (`grainPx: 1`) et tient à tous les cadrages.
 *    D'où `orage-ruine` à vingt-deux tuiles et le blizzard retiré.
 * ③ **LA HORDE NE S'ARME PAS SI L'ON RECULE.** Mesuré : à douze tuiles du paquet, **0 coup
 *    armé, 0 goule sur 10 retournée sur le photographe**. Voir ci-dessous.
 *
 * ═══ LA HORDE — TROIS SÉRIES QU'ELLE A MANQUÉES, ET POURQUOI ═══
 *
 * Alexis la demande depuis le 2026-08-20 ; la prise ABOUTISSAIT à tous les coups et l'image
 * était inregardable. Le journal accusait le décor (« pleine Cendrière, des dalles sombres sur
 * une plaine brune ») — c'était la moitié de la cause, et elle a disparu avec la Cendrière.
 * L'autre moitié était GÉOMÉTRIQUE, et personne ne l'avait nommée : le photographe se plantait
 * à SIX tuiles du paquet, donc DANS son `aggroRange` (5). Les goules lâchaient la descente de
 * gradient, se retournaient sur lui, et leurs coups peignaient des télégraphes rouges et des
 * cônes BLANCS pleine image — du HUD, sur une photo d'accueil.
 *
 * Reculer ne suffisait pas : la caméra CENTRE l'avatar, donc reculer de douze tuiles POUSSE le
 * paquet à douze tuiles du centre — collé au bord haut, à moitié coupé (mesuré, deux fois).
 * Les deux contraintes se battaient. **On a donc décroché la caméra du joueur** (`viseSujet`) :
 * elle se pose entre les deux, biaisée vers le sujet. La horde tient le tiers haut, le
 * photographe le bas du cadre, personne ne s'arme — et c'est la première fois que la vitrine
 * la porte.
 *
 * ═══ CE QUI A ÉTÉ ESSAYÉ ET ÉCARTÉ, pour que personne ne le retente à l'aveugle ═══
 *
 *   · LE GUÉ, deux fois (jour 61 ET jour 75). Depuis que le niveau d'eau se peint, la rivière
 *     de cette carte rend un chenal de vase ocre et une nappe gris-noir : ni en sortie
 *     d'Ardeur (aridité haute) ni en pleine saison des pluies elle n'a rendu l'eau dorée de la
 *     série précédente. C'est un fait de rendu, pas un mauvais réglage d'heure.
 *   · LE BROUILLARD SUR LES MENHIRS. Il DÉSATURE. Les pierres levées valent par l'ambre du
 *     couchant et leurs ombres longues ; un voile gris les rend au gris.
 *   · L'ORAGE SUR LA HORDE. Figée, l'averse rend des rectangles pâles gros comme une goule, et
 *     le trait de foudre gelé barre l'image d'une règle blanche d'un bord à l'autre. Ce qui se
 *     photographie bien en mouvement ne se photographie pas à l'arrêt.
 *   · LA CHASSE SOUS LA NEIGE. Deux obstacles indépendants : au jour 105 — le cardinal du
 *     Grand Froid, le point le plus froid de l'année — les SIX tanières visitées ont rendu
 *     « neige au sol 0,00 » (le manteau de cette carte est une mosaïque) ; et la neige qui
 *     TOMBE bloque en carrés (mesure ②) sur le sol gris d'une tanière.
 *   · LE VENT DE CENDRE. **La seule vraie perte de la série**, et elle mérite d'être sue : le
 *     front qui porte le nom du jeu existe, il s'arme, il traverse — et il se rend en
 *     rectangles gris pâle épars, pour la même raison que la neige (`grainPx: 4`). À vingt-deux
 *     tuiles il ne ressemble pas à de la cendre chassée, il ressemble à du bruit. Il faudra le
 *     photographier au cadrage du jeu, ou pas du tout.
 *   · LES FUMEROLLES. Tirées, réussies (le panache sort, une fois `fumerolleFx` chauffé à la
 *     main) — mais c'est le MÊME sujet que `front-cendre`, moins contrasté. Deux franges de
 *     cendre sur neuf vues, c'en était une de trop.
 *
 * ═══ L'ORDRE — UNE COURSE DU SOLEIL, ET LE FEU EN TÊTE ═══
 *
 * On ouvre sur le feu dans le noir : c'est ce que le jeu a de plus fort à montrer, et c'est
 * ainsi depuis la première série. Puis le jour se lève (la futaie, la brume), le soleil tourne
 * (l'orage de plein jour, la cendre de fin d'après-midi, les menhirs au couchant), la nuit
 * tombe sur le bourg et sur la horde, et l'hiver ferme la marche. Le carrousel BOUCLE : la
 * dernière image, un lac gelé au petit jour, revient sur un feu dans la nuit sans heurt.
 *
 * ⚠ UNE FAUSSE PISTE, NOTÉE POUR QU'ELLE NE SE REJOUE PAS. Le 2026-08-20, la capture
 * `accueil-principal.png` a fait croire que le voile `.bm-vitrine-bord` écrasait les vues de
 * nuit. C'était FAUX deux fois : ce voile est un dégradé HORIZONTAL qui ne mord que les 90
 * premiers pixels contre le rail, et la capture était prise PENDANT le fondu d'entrée (relevé :
 * à t+0 les vues sont à 0,000 d'opacité, à t+3,7 s la première est à 1,000). L'instrument a été
 * corrigé — `smoke --scenario accueil` attend désormais l'opacité pleine. Une image de menu se
 * juge à opacité pleine, jamais au moment où l'on arrive.
 *
 * IMPORTÉES ET NON CODÉES EN DUR : Vite les empreinte (hash) et les copie au build ; une URL
 * écrite à la main dans le HTML casserait au premier `pnpm build`.
 */
import feuHameau from '../../assets/vitrine/feu-hameau.jpg'
import sylveAube from '../../assets/vitrine/sylve-aube.jpg'
import brumeFutaie from '../../assets/vitrine/brume-futaie.jpg'
import orageRuine from '../../assets/vitrine/orage-ruine.jpg'
import frontCendre from '../../assets/vitrine/front-cendre.jpg'
import cercle from '../../assets/vitrine/cercle.jpg'
import bourgPluie from '../../assets/vitrine/bourg-pluie.jpg'
import hordeVillage from '../../assets/vitrine/horde-village.jpg'
import lacGele from '../../assets/vitrine/lac-gele.jpg'

export interface Vue {
  src: string
  /** Décrit l'image pour qui ne la voit pas — et sert de repère quand on rejoue l'atelier. */
  alt: string
}

export const VITRINE: Vue[] = [
  { src: feuHameau, alt: 'Un hameau de bois endormi autour de son feu, sa palissade close, avant le jour' },
  { src: sylveAube, alt: 'Une futaie fermée de bouleaux et de hêtres au soleil levant, la canopée en étages' },
  { src: brumeFutaie, alt: "Le brouillard du matin roule dans un bois de bouleaux, à la lisière d'une lande" },
  { src: orageRuine, alt: "Une tour de guet effondrée sous l'averse, le rideau de pluie en travers de la vallée" },
  { src: frontCendre, alt: 'La frange de cendre mange le pré : le vert cède aux troncs morts et à la poussière grise' },
  { src: cercle, alt: 'Un cercle de menhirs dans une prairie fleurie, au couchant, les pierres portant leur ombre' },
  { src: bourgPluie, alt: 'Un bourg de PNJ au crépuscule, son feu brûlant au milieu des logis, sous les premiers flocons' },
  { src: hordeVillage, alt: 'Dix Cendreux descendent le pré vers un feu de village ; un seul homme leur fait face' },
  { src: lacGele, alt: 'Un lac pris par la glace au petit jour, la grève givrée et les arbres nus du Grand Froid' },
]
