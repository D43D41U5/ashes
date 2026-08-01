/**
 * LA VITRINE — les images du jeu qui défilent à droite du menu principal (demande d'Alexis,
 * 2026-07-28).
 *
 * CE SONT DE VRAIES CAPTURES DU JEU, PAS DES ILLUSTRATIONS. Elles sortent du scénario smoke
 * `vitrine` (`pnpm smoke --scenario vitrine --dev`), qui téléporte l'avatar de lieu en lieu,
 * pose l'heure, masque le HUD et les noms de lieux, et déclenche. C'est important pour deux
 * raisons : ① l'accueil ne peut donc pas promettre un jeu qui n'existe pas ; ② le jour où l'art
 * bouge, on RELANCE l'atelier et on remplace ces cinq fichiers — la fraîcheur des images est à
 * une commande, pas à une séance de photo.
 *
 * ET C'EST ARRIVÉ TROIS FOIS : le 2026-07-28 quand les arbres ont changé de taille, le
 * 2026-07-29 quand ils sont passés de deux sprites à dix (conifères et feuillus,
 * `arbre-peuplement.ts`), le 2026-08-01 quand le worldgen a cessé de poser les tentes du
 * campement (villages-PNJ, `village-plan.ts`) — à la minute 1 d'une partie neuve, le feu est
 * nu. La prise du feu vient depuis du HAMEAU TAMPONNÉ (`feu-village-hameau` : le feu du
 * village, palier 2 posé par `debug_village_stage`) — un état que le vrai chantier atteint
 * en cours de saison, donc que l'accueil peut promettre. Les cinq images sont de la
 * troisième série.
 *
 * POURQUOI PAS SIX. L'atelier tire désormais une prise du BOIS SEC des crêtes — et elle n'est
 * pas retenue. Vu de l'INTÉRIEUR d'un bois, le disque de découvert (`crownAlpha`) efface les
 * cimes autour du joueur : on photographie des troncs. Un conifère se lit à sa SILHOUETTE, donc
 * de l'extérieur — et le Cercle de pierres en montre justement une lisière entière, opaque, au
 * couchant. Allonger le carrousel d'une vue plus faible ne le renforce pas.
 *
 * L'ORDRE EST UNE DRAMATURGIE, pas un tri de dossier : on ouvre sur le feu dans le noir (ce que
 * le jeu a de plus fort à montrer), puis la futaie, les menhirs, la rivière, et le Grand Chêne.
 * Le carrousel boucle, donc la dernière image doit pouvoir revenir sur la première sans heurt.
 *
 * IMPORTÉES ET NON CODÉES EN DUR : Vite les empreinte (hash) et les copie au build ; une URL
 * écrite à la main dans le HTML casserait au premier `pnpm build`. ~344 Ko pour les cinq.
 */
import feuHameau from '../../assets/vitrine/feu-hameau.jpg'
import sylveMatin from '../../assets/vitrine/sylve-matin.jpg'
import cercle from '../../assets/vitrine/cercle.jpg'
import gueOr from '../../assets/vitrine/gue-or.jpg'
import chene from '../../assets/vitrine/chene.jpg'

export interface Vue {
  src: string
  /** Décrit l'image pour qui ne la voit pas — et sert de repère quand on rejoue l'atelier. */
  alt: string
}

export const VITRINE: Vue[] = [
  { src: feuHameau, alt: 'Un hameau de bois endormi autour de son feu, sa palissade close, avant le jour' },
  { src: sylveMatin, alt: 'Une futaie dense au soleil levant, champignons et sous-bois' },
  { src: cercle, alt: 'Un cercle de menhirs dans une prairie fleurie, une lisière de conifères au loin' },
  { src: gueOr, alt: 'Un gué de galets sur une rivière, à la lumière du soir' },
  { src: chene, alt: 'Le Grand Chêne, immense, au petit matin, entouré d’arbres plus jeunes et d’un bouleau au fût pâle' },
]
