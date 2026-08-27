/**
 * LA VITRINE — les images du jeu qui défilent à droite du menu principal (demande d'Alexis,
 * 2026-07-28 ; élargie le 2026-08-20 « plus de variétés et d'epicness », puis le 2026-08-24
 * « des paysages dramatiques, une météo de ouf, des hordes de cendreux, des biomes variés »,
 * puis le 2026-08-26 « epicness et beauté n'oublie pas »).
 *
 * CE SONT DE VRAIES CAPTURES DU JEU, PAS DES ILLUSTRATIONS. Elles sortent du scénario smoke
 * `vitrine` (`pnpm smoke --scenario vitrine --dev`), qui téléporte l'avatar de lieu en lieu,
 * pose le jour de saison et l'heure, arme un ciel, masque le HUD et les noms de lieux, et
 * déclenche. C'est important pour deux raisons : ① l'accueil ne peut donc pas promettre un jeu
 * qui n'existe pas ; ② le jour où l'art bouge, on RELANCE l'atelier et on remplace ces
 * fichiers — la fraîcheur des images est à une commande, pas à une séance de photo.
 *
 * ET C'EST ARRIVÉ SIX FOIS : le 2026-07-28 quand les arbres ont changé de taille, le 2026-07-29
 * quand ils sont passés de deux sprites à dix, le 2026-08-01 quand le worldgen a cessé de poser
 * les tentes du campement, le 2026-08-20 pour la série des scènes, le 2026-08-24 pour celle des
 * ciels, et le 2026-08-26 pour celle-ci.
 *
 * ═══ SIXIÈME SÉRIE — LA NUIT A UN CADRAN, ET LE SOL A QUATRE COULEURS ═══
 *
 * Trois chantiers de rendu ont atterri entre les deux séries, et chacun invalidait la
 * précédente — non pas parce qu'elle avait vieilli, mais parce que les LEVIERS ont changé :
 *
 *   · **LE VOILE DE NUIT SUIT LA LUNE** (`lighting.ts`, 2026-08-25 — « la lumière naturelle
 *     actuelle à minuit doit être notre PLEINE LUNE »). La nuit n'a plus une luminosité, elle
 *     en a vingt-trois : `NIGHT_ALPHA_MAX` (0,72) est le voile de la pleine lune,
 *     `VOILE_NOUVELLE_LUNE` (0,97) celui de la nouvelle.
 *   · **LE SOL TOURNE AVEC L'ANNÉE** (`teinte-saison.ts`, 2026-08-23). Vert tendre à
 *     l'Éclosion, or à l'Ardeur, roux aux Pluies, gris-bleu au Grand Froid — sur le VIVANT
 *     seulement (ni la roche, ni l'eau, ni le mur).
 *   · **LA BRUME EST UNE NAPPE D'ÉPAISSEUR** (`mist-layer.ts`, 2026-08-25), et le FLOCON a
 *     été divisé par deux (`GRAIN_FLOCON`, 2026-08-26).
 *
 * ═══ CE QUE LA SÉRIE A MESURÉ, ET QUI DÉCIDE DE TOUT ═══
 *
 * ① **LA LUNE EST LE LEVIER FORT DE LA NUIT — l'heure ne l'a jamais été.** `SMOKE_LUNE`
 *    (l'échelle de phases, ajoutée pour ça) a tiré SIX FOIS le même hameau, à la même heure,
 *    sans bouger d'un pouce : au jour 62 (pleine lune) c'est un pré OLIVE en plein jour où le
 *    feu ne se voit pas ; au jour 70 (lune au dixième) c'est une VRAIE nuit, les toits prennent
 *    l'orange du foyer et les lucioles de la clairière existent ; au jour 72 (lune neuve) le
 *    voile SATURE — rien de plus à gagner à viser le noir exact.
 *    ⚠ **ET LE JOUR D'OUVERTURE EST LE PIRE DES VINGT-TROIS** : `LUNE_PLEINE_JOUR = 61`, et le
 *    monde ouvre au 61. Une prise de nuit qui ne DIT pas son jour tombe donc, par défaut, sur
 *    la nuit la plus plate de la lunaison. C'est ce qui rendait les nuits de la série
 *    précédente si pâles — personne n'avait choisi cette lumière.
 * ② **LA VARIÉTÉ EST REVENUE AU SOL.** La cinquième série s'était écrite sur un constat — « le
 *    monde joué n'a plus qu'une zone, la variété se prend au ciel, plus au sol ». La teinte de
 *    saison a rouvert cette porte : le MÊME bois n'est plus le même bois d'un cardinal à
 *    l'autre. Cette planche traverse donc l'année au lieu de traverser la carte — un chêne
 *    d'Éclosion en vert acide, une futaie de Pluies en roux, un lac de Grand Froid en
 *    gris-bleu, une frange de cendre sur un pré d'or.
 * ③ **LA HORDE AVAIT BESOIN D'UNE LAMPE, PAS D'UNE GÉOMÉTRIE.** La série précédente avait
 *    résolu le cadrage (reculer de douze tuiles pour que personne ne s'arme) et rapportait
 *    quand même dix rectangles gris sur un pré plat : le feu du village qu'elles visent est à
 *    cent tuiles, il n'entre pas dans le cadre, et rien d'autre n'éclairait la scène. La
 *    `torche_vive` est la seule lumière qu'un joueur PORTE (spec `torche.md`) — elle vient
 *    avec le photographe, donc elle est toujours à l'image. Un homme, une flamme, dix
 *    silhouettes qui descendent le pré.
 *
 * ═══ LA PÊCHE (ajoutée le 2026-08-26, à la demande d'Alexis) ═══
 *
 * Elle a QUATRE éléments rendus (`peche-fx.ts`) — le lancer en arc, le fil de Verlet qui pend, le
 * flotteur qui clapote puis plonge, et le FERRAGE. Trois d'entre eux sont une ligne molle posée sur
 * de l'eau : jolis en mouvement, muets sur une photo. Le seul instant qui raconte quelque chose,
 * c'est **le poisson qui sort de l'eau** — et il dure 460 ms, soit moins d'une frame sur cette
 * machine. L'atelier reprend donc, à la lettre, la recette déjà payée par le scénario `peche` :
 * un `host.onMessage` qui ferre à la cadence des SNAPSHOTS (20 Hz) et non des frames, et un
 * accrochage de `pecheFx.caught` qui endort la boucle puis pose la frame à la main
 * (`game.step`, 160 ms — au milieu de l'arc du poisson, pas à son départ).
 *
 * DEUX RÉGLAGES ONT ÉTÉ MESURÉS, ET AUCUN N'ÉTAIT DEVINABLE :
 *   · **L'HEURE, PAR L'EAU.** À 19,8 h — l'heure « couchant » du reste de la planche — la nappe
 *     profonde ne reçoit plus rien : elle rend un vide gris-brun sur la moitié du cadre. À 18,6 h
 *     la même eau porte encore le bleu du ciel ET la bande ocre du haut-fond, et les MONTÉES de
 *     poissons (`poissons-ombres`) s'y lisent en pastilles chaudes. On ne gagne pas une teinte, on
 *     gagne un sujet.
 *   · **UN PIED SEC N'EST PAS UN PIED NU.** Le premier tirage prenait le premier coin de lac venu
 *     et la première tuile sèche à portée : il a planté l'avatar sous la CANOPÉE d'une berge
 *     boisée, et la canne cambrée sortait d'un tas de houppiers. Le choix du coin note désormais
 *     ce que le cadre contiendrait — l'eau devant, et zéro arbre autour du pêcheur.
 *
 * ═══ LA TRAQUE EST THERMIQUE — et c'est ce qui manquait à la horde (2026-08-26) ═══
 *
 * Alexis, sur la première horde de cette série : *« les cendreux ne traquent pas le joueur… pas
 * de tension sur l'image »*. C'était exact, et la prise le mesurait elle-même : « 0/10 goules
 * retournées sur le photographe ». Trois explications ont été essayées et RÉFUTÉES avant la
 * bonne — la distance (12 tuiles, puis 4,2, puis 1,4 : rien n'a changé), l'invulnérabilité
 * (`debug_god` ne touche QUE les dégâts, `nearestPrey` l'ignore), et la sonde elle-même
 * (`view.monsters` porte bien les `Monster` bruts du snapshot, `targetId` compris).
 *
 * LA CAUSE EST LE FROID. L'éveil d'un Cendreux suit la température (`CENDREUX.TORPEUR` : éveil 0
 * à +6 °C, éveil 1 à −14 °C) et sa vue vaut `aggroRange × éveil × LE STIMULUS DE LA PROIE`. Un
 * soir des Pluies, l'éveil est au plancher : sa vue tombe à `aggroRange × 0,2` = **une tuile**.
 * Le relevé qui a tranché : photographe à 1,4 tuile de dix goules, `targetId: null`,
 * `suspicion: 0` — elles ne le snobaient pas, elles ne le VOYAIENT pas. La horde est donc passée
 * à une NUIT DU GRAND FROID (jour 101, lune à mi-course), où l'éveil est plein.
 *
 * ET IL FAUT QU'IL MARCHE. Le second facteur est le stimulus : `HUNT.VIS_STILL` vaut 0,25 —
 * « l'œil du gibier accroche le MOUVEMENT ; une silhouette plantée redevient un rocher ». Un
 * photographe immobile n'est jamais traqué, il est piétiné. L'atelier le fait donc AVANCER sur
 * elles pendant qu'il guette la bascule (marche, pas sprint : à 6 t/s il traverse le cadre entre
 * deux relevés).
 *
 * ⚠ ET LE GEL SE VÉRIFIE. `pause` est un message au Worker : il met deux à trois cents
 * millisecondes à prendre. Or elles repensent leur cible à chaque pensée, et l'homme qui vient
 * de s'arrêter redevient invisible — MESURÉ : « 3/13 retournées » au déclenchement, « 0/13 » au
 * relevé suivant. On fige, on attend que l'horloge de la sim s'ARRÊTE, et on RE-COMPTE : c'est
 * l'état gelé qui décide. Résultat livré : **7 goules sur 15 retournées, zéro coup armé**.
 *
 * (Le coup ARMÉ, lui, reste proscrit : essayé à 1,5 tuile, il peint un losange filaire rouge en
 * plein sur l'homme — un gizmo d'interface, ce que la cinquième série avait déjà jeté. La
 * tension vient de la meute qui se RETOURNE — les traqueuses portent un liseré rouge — jamais du
 * coup qui part. L'atelier s'arrête donc à trois tuiles et refuse tout armement.)
 *
 * ═══ CE QUI A ÉTÉ TIRÉ ET ÉCARTÉ, pour que personne ne le retente à l'aveugle ═══
 *
 *   · **SE POSTER SUR L'AXE DE MARCHE DE LA HORDE** (plutôt que plein sud du paquet), pour
 *     qu'elle vienne de face au lieu de défiler de flanc. Bonne idée, jetée sur mesure : le feu
 *     qu'elle vise peut être à QUATRE CENTS tuiles, et sa géométrie à la levée n'a rien à voir
 *     avec cette direction — le placement est parti à 14,3 tuiles et le relevé est retombé à
 *     0/15. Le sud est arbitraire mais STABLE, et c'est lui qui rend 7/15.
 *   · **LA CHASSE SOUS LA NEIGE.** Tirée, réussie au sens de l'atelier (une bête, de la neige
 *     qui tombe) et illisible au sens de l'image : le chasseur est un rectangle beige de vingt
 *     pixels, le sanglier une tache brune, et l'arc bandé ne se voit pas à ce cadrage. Ce n'est
 *     pas un réglage à trouver, c'est un sujet trop petit pour une vitrine.
 *   · **LES FUMEROLLES** (jour 290). Le panache sort — c'est un carré blanc de trente pixels
 *     sur une plaine grise. Même verdict qu'à la cinquième série, et pour la même raison.
 *   · **LE VENT DE CENDRE** (jour 240). Toujours des rectangles gris pâle épars : il a gardé
 *     les 4 px des FX de lumière (`GRAIN_PX`) quand le flocon descendait à 2 (`GRAIN_FLOCON`).
 *     Il faudra le photographier au cadrage du jeu, ou pas du tout.
 *   · **L'ORAGE SUR LES MENHIRS** (essayé sur l'idée que neuf pierres font neuf silhouettes).
 *     Il marche — et il fait doublon avec `cercle`, en moins chaud : l'averse mange l'ambre du
 *     couchant, qui est très exactement ce qui porte cette prise-là.
 *   · **L'ORAGE, TOUT COURT.** `ferme-pluie` s'appelait `orage-ruine` : depuis que le rideau
 *     GRÉSILLE sur la lisière (2026-08-25), un orage figé peint des BARRES BLANCHES grosses
 *     comme une caisse en travers du cadre — mesuré à 18 tuiles ET à 22, donc ce n'est pas un
 *     défaut de zoom. L'averse simple garde le rideau et le ciel bouché, sans les barres.
 *   · **LA TOUR DE GUET** comme sujet d'orage. Elle fait trois tuiles : à tout cadrage elle est
 *     un moignon gris au bord du cadre. La Ferme muette, elle, fait une dizaine de tuiles et
 *     s'ouvre sur son dedans — un toit crevé, un établi effondré, la pluie qui tombe DEDANS.
 *
 * ═══ L'ORDRE — UNE COURSE DU SOLEIL, ET LE FEU EN TÊTE ═══
 *
 * On ouvre sur le feu dans le noir : c'est ce que le jeu a de plus fort à montrer, et c'est
 * ainsi depuis la première série. Puis le jour se lève (le chêne, la futaie, la brume), le
 * soleil tourne (l'averse de plein jour, la cendre de fin d'après-midi, les menhirs au
 * couchant), la nuit tombe sur le bourg et sur la horde, et l'hiver ferme la marche. Le
 * carrousel BOUCLE : la dernière image, un lac gelé au petit jour, revient sur un feu dans la
 * nuit sans heurt.
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
import cheneEclosion from '../../assets/vitrine/chene-eclosion.jpg'
import sylveAube from '../../assets/vitrine/sylve-aube.jpg'
import brumeFutaie from '../../assets/vitrine/brume-futaie.jpg'
import fermePluie from '../../assets/vitrine/ferme-pluie.jpg'
import frontCendre from '../../assets/vitrine/front-cendre.jpg'
import peche from '../../assets/vitrine/peche.jpg'
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
  { src: feuHameau, alt: 'Un hameau de bois endormi autour de son feu, palissade close, dans une nuit sans lune' },
  { src: cheneEclosion, alt: "Le Grand Chêne dans un bois de l'Éclosion, au petit jour, la feuille tout juste revenue" },
  { src: sylveAube, alt: 'Une futaie rousse des Pluies au soleil levant, la canopée en étages' },
  { src: brumeFutaie, alt: 'Le brouillard du matin noie une futaie : une mer de nappe où les cimes émergent' },
  { src: fermePluie, alt: "Une ferme en ruine sous l'averse, le toit crevé, la pluie tombant sur son établi effondré" },
  { src: frontCendre, alt: 'La frange de cendre mange le pré : le vert cède aux troncs morts et à la poussière grise' },
  { src: peche, alt: "Un pêcheur ferre sur la berge d'un lac au couchant : la canne cambrée, le poisson qui sort de l'eau" },
  { src: cercle, alt: 'Un cercle de menhirs dans une prairie dorée, au couchant, les pierres portant leur ombre' },
  { src: bourgPluie, alt: 'Un bourg de PNJ au crépuscule, son feu brûlant au milieu des logis, sous les premiers flocons' },
  { src: hordeVillage, alt: "Une nuit du Grand Froid : sept Cendreux, cernés de rouge, ont pris en chasse l'homme à la torche" },
  { src: lacGele, alt: 'Un lac pris par la glace au petit jour, la grève givrée et les arbres nus du Grand Froid' },
]
