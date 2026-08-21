/**
 * LA VITRINE — les images du jeu qui défilent à droite du menu principal (demande d'Alexis,
 * 2026-07-28 ; élargie le 2026-08-20 : « plus de variétés et d'epicness »).
 *
 * CE SONT DE VRAIES CAPTURES DU JEU, PAS DES ILLUSTRATIONS. Elles sortent du scénario smoke
 * `vitrine` (`pnpm smoke --scenario vitrine --dev`), qui téléporte l'avatar de lieu en lieu,
 * pose l'heure, masque le HUD et les noms de lieux, et déclenche. C'est important pour deux
 * raisons : ① l'accueil ne peut donc pas promettre un jeu qui n'existe pas ; ② le jour où l'art
 * bouge, on RELANCE l'atelier et on remplace ces fichiers — la fraîcheur des images est à une
 * commande, pas à une séance de photo.
 *
 * ET C'EST ARRIVÉ QUATRE FOIS : le 2026-07-28 quand les arbres ont changé de taille, le
 * 2026-07-29 quand ils sont passés de deux sprites à dix (conifères et feuillus,
 * `arbre-peuplement.ts`), le 2026-08-01 quand le worldgen a cessé de poser les tentes du
 * campement (villages-PNJ, `village-plan.ts`), et le 2026-08-20 pour la série que voici.
 *
 * ═══ QUATRIÈME SÉRIE — DES SCÈNES, PAS SEULEMENT DES PAYSAGES ═══
 *
 * Les trois premières séries montraient des LIEUX : un endroit, une heure. Celle-ci garde les
 * meilleurs (le feu du hameau, la futaie, le Gué, les menhirs) et leur ajoute quatre ÉTATS DU
 * MONDE qu'aucune heure ne suffit à atteindre — il y faut un jour de saison, une météo, ou un
 * événement que la sim doit d'abord produire :
 *   · L'HIVER (`chasse-neige`, `lac-gele`) vient du front NEIGEUX du cycle 5 (jours 51-60,
 *     relu par `frontDuCycle`) : la neige au sol est celle que le monde aurait posée.
 *   · LE BOURG (`village-bourg`) est le palier 3 d'un village PNJ, l'état que son chantier
 *     atteint en cours de saison.
 *   · L'ORAGE (`orage-vallee`) est la SEULE variété de plein jour possible : entre 10 et 15 h
 *     l'alpha d'`ambientTint` est nul, aucune heure n'achète d'ambiance — seul un ciel le peut.
 *
 * CE QUI A ÉTÉ ESSAYÉ ET ÉCARTÉ, pour que personne ne le retente à l'aveugle :
 *   · LE LAC D'ÉTÉ. L'eau profonde se rend en aplat bleu-gris sans rive opposée : une nappe
 *     vide qui mange la moitié du cadre. L'eau de ce jeu marche en RUBAN (le Gué), pas en
 *     masse — et en hiver, où la grève givrée et les arbres nus lui donnent enfin un bord.
 *   · LA CENDRIÈRE SEULE. Le pays qui donne son nom au jeu est, photographié seul, une plaine
 *     brune de souches ; sa goule y tient vingt pixels.
 *   · LA FUTAIE D'HIVER. Défeuillaison d'acte III plus neige : la même fenêtre qui rendait un
 *     bois à trois essences revient en champ blanc quasi vide.
 *   · LA COMBE BRUMEUSE et LA TOUR DE GUET : des prés, avec une chose au milieu.
 *
 * ═══ CE QUI MANQUE ENCORE : LE COMBAT ═══
 *
 * Alexis a demandé « combattre une horde », et la prise EXISTE dans l'atelier
 * (`horde-village`) : `advanceWorldEvents` fait naître SANS TIRAGE, au premier crépuscule de
 * l'acte III, une méga-horde de seize Cendreux qui marche sur un village. L'atelier saute au
 * jour 47, LIT LE BERCEAU dans le fait `horde_spawned` (qui porte `tx`/`ty` depuis le
 * 2026-08-21) et s'y téléporte : 70 s, contre les 301 à 481 s d'attente au feu du village que
 * coûtaient les trois premières séries. La prise ABOUTIT désormais à tous les coups.
 *
 * CE QUI LA RETIENT ENCORE EST UNE AFFAIRE DE LISIBILITÉ, PAS D'OUTIL — et le BERCEAU EST
 * TIRÉ AU SORT, ce qui décide du décor : deux runs du 2026-08-21 l'ont posé à 507 tuiles de
 * sa cible (pleine Cendrière : des dalles sombres sur une plaine brune semée de souches
 * noires, illisible) et à 169 tuiles (un pré vert, où les mêmes goules se lisent enfin,
 * grises bordées de rouge). Le paquet est cadré à tous les coups ; c'est le FOND qui décide
 * s'il se voit. Trois pistes, à trancher : rejouer jusqu'à un berceau en terrain clair,
 * photographier plus tôt (l'ambre de 19 h plutôt que le bleu de 20,3 h), ou les laisser
 * arriver au feu du village qui les éclaire — ce qui rend l'attente qu'on vient de
 * supprimer. Et la photo emporte du COMBAT qu'on ne peut pas éteindre : se poser à six
 * tuiles du paquet met le photographe dans leur `aggroRange` (mesuré : 7 goules sur 16
 * retournées sur lui), leurs coups peignent des télégraphes rouges et des cônes BLANCS de
 * zone frappée. Tant qu'aucune prise n'a rendu une image qu'on peut REGARDER, la vitrine
 * n'en porte pas : l'accueil ne montre que ce qui tient.
 *
 * ═══ L'ORDRE — UNE COURSE DU SOLEIL, ET LE FEU EN TÊTE ═══
 *
 * On ouvre sur le feu dans le noir : c'est ce que le jeu a de plus fort à montrer, et c'est
 * ainsi depuis la première série. Puis le jour se lève (la futaie), le soleil tourne (le Gué,
 * l'orage, les menhirs), le village s'allume au crépuscule, et l'hiver ferme la marche (la
 * chasse, le lac gelé). Le carrousel BOUCLE : la dernière image, un lac gelé au petit jour,
 * revient sur un feu dans la nuit sans heurt.
 *
 * ⚠ UNE FAUSSE PISTE, NOTÉE POUR QU'ELLE NE SE REJOUE PAS. Le 2026-08-20, la capture
 * `accueil-principal.png` a fait croire que le voile `.bm-vitrine-bord` écrasait les vues de
 * nuit, et le feu a été rétrogradé pour cette raison. C'était FAUX deux fois : ce voile est un
 * dégradé HORIZONTAL qui ne mord que les 90 premiers pixels contre le rail, et la capture était
 * prise PENDANT le fondu d'entrée (relevé : à t+0 les huit vues sont à 0,000 d'opacité, à
 * t+3,7 s la première est à 1,000). L'instrument a été corrigé — `smoke --scenario accueil`
 * attend désormais l'opacité pleine. Une image de menu se juge à opacité pleine, jamais au
 * moment où l'on arrive.
 *
 * IMPORTÉES ET NON CODÉES EN DUR : Vite les empreinte (hash) et les copie au build ; une URL
 * écrite à la main dans le HTML casserait au premier `pnpm build`.
 */
import feuHameau from '../../assets/vitrine/feu-hameau.jpg'
import sylveMatin from '../../assets/vitrine/sylve-matin.jpg'
import gueOr from '../../assets/vitrine/gue-or.jpg'
import orageVallee from '../../assets/vitrine/orage-vallee.jpg'
import cercle from '../../assets/vitrine/cercle.jpg'
import villageBourg from '../../assets/vitrine/village-bourg.jpg'
import chasseNeige from '../../assets/vitrine/chasse-neige.jpg'
import lacGele from '../../assets/vitrine/lac-gele.jpg'

export interface Vue {
  src: string
  /** Décrit l'image pour qui ne la voit pas — et sert de repère quand on rejoue l'atelier. */
  alt: string
}

export const VITRINE: Vue[] = [
  { src: feuHameau, alt: 'Un hameau de bois endormi autour de son feu, sa palissade close, avant le jour' },
  { src: sylveMatin, alt: 'Une futaie mêlée de pins et de bouleaux, au soleil levant, les ombres longues sur la mousse' },
  { src: gueOr, alt: 'Un gué de galets sur une rivière encaissée entre deux bois, à la lumière du soir' },
  { src: orageVallee, alt: 'Un orage traverse la prairie fleurie, rideau de pluie en travers de la vallée' },
  { src: cercle, alt: 'Un cercle de menhirs dans une prairie fleurie, au couchant, les pierres portant leur ombre' },
  { src: villageBourg, alt: 'Un bourg de PNJ au crépuscule, son feu brûlant au milieu des logis, lucioles à la lisière' },
  { src: chasseNeige, alt: 'Un chasseur, arc bandé, dans un bois enneigé où un sanglier se tient entre les troncs nus' },
  { src: lacGele, alt: 'Un lac pris par la glace au petit jour, la grève givrée et les arbres nus de la fin de saison' },
]
