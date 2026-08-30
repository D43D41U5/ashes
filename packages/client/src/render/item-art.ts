/**
 * Les icônes d'items — dessinées EN CODE, comme tout l'art du projet
 * (cf. poi-art.ts). À 16 px, on lit une SILHOUETTE, jamais une texture : chaque
 * icône doit être reconnaissable en ombre chinoise. Lumière au nord-ouest,
 * face claire en haut-à-gauche. Palette alignée sur le monde (bois chaud,
 * pierre froide, fer bleuté).
 */
import type Phaser from 'phaser'
import { FISH_SPECIES, type FishId, type ItemId } from '@ashes/sim'
import { newCanvas, registerLitPaire } from './normal-map'
import { PeintreCanvas, type Peintre } from './peintre'

export const ITEM_ICON_PX = 16

export const ITEM_LABELS: Record<ItemId, string> = {
  wood: 'Bois',
  salt: 'Sel',
  stone: 'Pierre',
  fiber: 'Fibre',
  berries: 'Baies',
  champignons: 'Champignons',
  worms: 'Vers',
  legume: 'Légume',
  graine: 'Graine',
  // LES CULTURES DE SAISON (spec `saisons.md` S16) — une plante par saison, et sa graine.
  pousse_verte: 'Pousse verte',
  graine_verte: 'Graine de pousse',
  fruit_sec: 'Fruit sec',
  graine_fruit: 'Graine de fruit',
  tubercule: 'Tubercule',
  graine_tubercule: 'Graine de tubercule',
  stew: 'Ragoût',
  iron_ore: 'Minerai de fer',
  coal: 'Charbon',
  charcoal: 'Charbon de bois',
  iron_ingot: 'Lingot de fer',
  steel_ingot: "Lingot d'acier",
  rope: 'Corde',
  crude_axe: 'Hachereau de fortune',
  crude_pickaxe: 'Pic de fortune',
  crude_spear: 'Épieu taillé',
  torche: 'Torche',
  torche_vive: 'Torche allumée',
  axe: 'Hache',
  pickaxe: 'Pioche',
  iron_axe: 'Hache de fer',
  iron_pickaxe: 'Pioche de fer',
  steel_axe: "Hache d'acier",
  steel_pickaxe: "Pioche d'acier",
  spear: 'Lance',
  crude_bow: 'Arc de fortune',
  bow: 'Arc long',
  arrow: 'Flèche',
  hammer: 'Marteau de construction',
  raw_meat: 'Viande crue',
  // ── LA PÊCHE (peche.md D12) : dix-huit espèces, chacune son item cru ; le cuit et le séché
  //    se regroupent par CLASSE. Les libellés viennent de `FISH_SPECIES` — une espèce ajoutée
  //    à la sim se nomme toute seule ici, au lieu d'apparaître comme une case sans nom.
  ...libellesDesPrises(),
  cooked_fish_petit: 'Petit poisson grillé',
  cooked_fish_moyen: 'Poisson grillé',
  cooked_fish_gros: 'Gros poisson grillé',
  dried_fish_petit: 'Petit poisson séché',
  dried_fish_moyen: 'Poisson séché',
  dried_fish_gros: 'Gros poisson séché',
  dried_meat: 'Viande séchée',
  coeur_de_braise: 'Cœur de braise',
  braise_mere: 'Braise-mère',
  cuir_cendre: 'Cuir cendré',
  graine_de_braise: 'Graine de braise',
  orge_de_braise: 'Orge-de-braise',
  parcelle_de_suie: 'Parcelle de suie',
  salted_fish_petit: 'Petit poisson salé',
  salted_fish_moyen: 'Poisson salé',
  salted_fish_gros: 'Gros poisson salé',
  salted_meat: 'Viande salée',
  sechoir: 'Séchoir',
  crude_rod: 'Canne de fortune',
  crude_knife: 'Couteau de fortune',
  bone: 'Os',
  quartier: 'Quartier',
  cooked_meat: 'Viande cuite',
  raw_hide: 'Peau brute',
  leather: 'Cuir',
  tenue_hiver: "Tenue d'hiver",
  components: 'Composants',
  campfire: 'Feu de camp',
  // ── Les COMPOSANTS en objet (spec construction R20) : on les pose pour faire
  //    émerger une fonction (la Forge : enclume + four…).
  enclume: 'Enclume',
  furnace: 'Four',
  four_acier: "Four d'acier",
  workshop: 'Établi',
  tour_meca: 'Tour méca',
  atelier_lourd: 'Atelier lourd',
  silo: 'Silo',
  cave: 'Cave',
  reserve: 'Réserve stratégique',
  parcelle: 'Parcelle',
  serre: 'Serre',
  terroir: 'Terroir',
  chest: 'Coffre',
  // ── Les ressources STRUCTURANTES des zones (spec worldgen R9) : chacune n'existe
  //    QUE dans sa zone, et chacune est LOURDE. Le nom doit dire d'où elle vient.
  hardwood: 'Gros bois',
  peat: 'Tourbe',
  cut_stone: 'Pierre de taille',
  ash: 'Cendre',
}

export function itemIconKey(item: ItemId): string {
  return `it-${item}`
}

/** Un dessin d'icône, écrit contre `Peintre` : le même code se rejoue sur un `Graphics` Phaser
 *  (l'icône flat de BootScene) ET sur Canvas2D (l'albédo de la paire `_lit`) — voir peintre.ts. */
type ItemPaint = (g: Peintre) => void

/**
 * LA GRAMMAIRE D'UN POISSON (peche.md D12) — dos sombre, flanc, ventre clair, œil, queue ; la
 * CLASSE fait la taille. Un accent optionnel (deux points sur le flanc) distingue les espèces
 * tachetées. Rectiligne comme tout l'art de la maison : des marches, jamais des courbes.
 */
function poissonPeint(classe: 'petit' | 'moyen' | 'gros', dos: number, flanc: number, ventre: number, accent?: number): ItemPaint {
  const x0 = classe === 'petit' ? 3 : classe === 'moyen' ? 2 : 1
  const larg = classe === 'petit' ? 8 : classe === 'moyen' ? 10 : 12
  const haut = classe === 'petit' ? 3 : 4
  const y0 = classe === 'petit' ? 7 : 6
  return (g) => {
    g.fillStyle(dos).fillRect(x0, y0, larg, haut)
    g.fillStyle(flanc).fillRect(x0 + 1, y0 + 1, larg - 2, 1)
    g.fillStyle(ventre).fillRect(x0 + 1, y0 + haut - 1, larg - 2, 1)
    g.fillStyle(dos).fillRect(x0 + larg, y0 - 1, 2, haut + 2) // la queue
    if (accent !== undefined) {
      g.fillStyle(accent).fillRect(x0 + 2, y0 + 1, 1, 1).fillRect(x0 + Math.floor(larg / 2), y0 + 1, 1, 1)
    }
    g.fillStyle(0x1d1d1a).fillRect(x0, y0, 1, 1) // l'œil, tête à gauche
  }
}

/** UN POISSON QUI PEND (D13) : la ficelle, le corps sec et fendu. Il se lit vertical — le
 *  grillé est couché, le séché est suspendu : deux silhouettes, aucune confusion possible. */
function poissonSeche(x0: number, haut: number): ItemPaint {
  return (g) => {
    g.fillStyle(0x8a8272).fillRect(7, 1, 1, 3) // la ficelle
    g.fillStyle(0x7a6a4a).fillRect(x0, 4, 16 - 2 * x0, haut)
    g.fillStyle(0xa89870).fillRect(x0 + 1, 5, 16 - 2 * x0 - 2, 1)
    g.fillStyle(0x3a3020).fillRect(7, 6, 1, haut - 3) // la fente du séchage
    g.fillStyle(0x1d1d1a).fillRect(x0 + 1, 5, 1, 1)
  }
}

/** Le séché + la croûte de sel (S4bis) — même silhouette, des grains presque blancs. */
function poissonSale(x0: number, haut: number): ItemPaint {
  const seche = poissonSeche(x0, haut)
  return (g) => {
    seche(g)
    g.fillStyle(0xe4dfd0)
    g.fillRect(x0 + 1, 6, 1, 1).fillRect(16 - x0 - 2, 7, 1, 1).fillRect(6, 4 + haut - 2, 1, 1)
  }
}

/** Les libellés des dix-huit espèces, DÉRIVÉS de `FISH_SPECIES` : une espèce ajoutée à la sim
 *  se nomme toute seule, au lieu d'apparaître dans un sac comme une case sans nom. */
function libellesDesPrises(): Record<FishId, string> {
  const out: Partial<Record<FishId, string>> = {}
  for (const sp of FISH_SPECIES) out[sp.id] = sp.label.charAt(0).toUpperCase() + sp.label.slice(1)
  // TOTAL par construction (le balayage couvre `FISH_SPECIES`) : sans cette conversion, la
  // table des libellés — un `Record<ItemId, string>` exhaustif — refuserait le spread.
  return out as Record<FishId, string>
}

/**
 * Un dessin PAR item — la clé `Record<ItemId, …>` est le garde-fou : ajouter un
 * item à la sim sans lui peindre d'icône ne compile plus (une case vide à
 * l'écran serait sinon silencieuse). `generateItemIcons` boucle là-dessus.
 */
export const ITEM_PAINTS: Record<ItemId, ItemPaint> = {
  // ── LES STRUCTURANTES ────────────────────────────────────────────────────
  // Chacune doit se distinguer EN OMBRE CHINOISE de sa cousine ordinaire : le gros
  // bois n'est pas du bois en plus foncé, c'est un FÛT (un seul, épais, avec ses
  // cernes) ; la pierre de taille n'est pas un galet, c'est un BLOC (des arêtes).
  // À 16 px, la silhouette est tout ce qu'on a.

  // UN fût debout, épais, cerné — pas deux bûches. On voit son cœur.
  hardwood: (g) => {
    g.fillStyle(0x5a3d22).fillRect(4, 2, 8, 12)
    g.fillStyle(0x6d4c2b).fillRect(4, 2, 8, 2)
    g.fillStyle(0x8a6238).fillRect(4, 2, 3, 12) // la face au NO
    g.fillStyle(0xc3a678).fillRect(6, 4, 4, 2) // les cernes, en bout
    g.fillStyle(0x3f2a17).fillRect(6, 7, 4, 1)
  },

  // Un BLOC taillé : des arêtes, une face claire, une ombre franche. Pas un galet.
  cut_stone: (g) => {
    g.fillStyle(0x6a6a72).fillRect(3, 4, 10, 9)
    g.fillStyle(0x86868f).fillRect(3, 4, 10, 3) // le dessus, éclairé
    g.fillStyle(0x9a9aa3).fillRect(3, 4, 4, 9) // la face au NO
    g.fillStyle(0x4a4a52).fillRect(3, 12, 10, 1) // l'ombre au pied
  },

  // Une brique de tourbe : sombre, fibreuse, gorgée d'eau. Elle SUINTE.
  /**
   * LE SEL — des cristaux, donc du BLANC CASSÉ et des angles. Le seul objet presque blanc de
   * l'inventaire : il doit se repérer dans une ceinture pleine de bruns et de gris, parce qu'on
   * l'a payé cher (il vient du cœur de la cendre).
   */
  salt: (g) => {
    g.fillStyle(0xd8d4c6).fillRect(4, 7, 8, 5)
    g.fillStyle(0xeeeade).fillRect(4, 7, 8, 2) // la face éclairée du tas
    g.fillStyle(0xffffff).fillRect(6, 5, 3, 3) // un gros cristal qui dépasse
    g.fillStyle(0xb6b2a4).fillRect(4, 11, 8, 1) // l'assise, à l'ombre
    g.fillStyle(0xffffff).fillRect(10, 8, 2, 2) // un second éclat, décalé
  },
  peat: (g) => {
    g.fillStyle(0x3a2f22).fillRect(3, 5, 10, 8)
    g.fillStyle(0x4c3d2b).fillRect(3, 5, 10, 2)
    g.fillStyle(0x5e4e38).fillRect(3, 5, 3, 8)
    g.fillStyle(0x2a2218).fillRect(5, 8, 6, 1) // la strate
    g.fillStyle(0x2a2218).fillRect(4, 11, 8, 1)
  },

  /**
   * LA TORCHE ÉTEINTE — une hampe et un fagot ligaturé. À 16 px, la silhouette est un
   * T lourd du haut : le manche mince descend, la tête est un BLOC. C'est ce bloc, et lui
   * seul, qui la distingue de la canne et de l'épieu (des hampes à tête pointue).
   */
  torche: (g) => {
    g.fillStyle(0x5a3d22).fillRect(7, 7, 2, 8) // la hampe
    g.fillStyle(0x7a5530).fillRect(7, 7, 1, 8) // sa face au NO
    g.fillStyle(0x6b5a3a).fillRect(4, 2, 8, 5) // le fagot de fibre, éteint : mat, terne
    g.fillStyle(0x8a7750).fillRect(4, 2, 8, 2) // le dessus, éclairé
    g.fillStyle(0x4a3d28).fillRect(4, 6, 8, 1) // l'ombre sous la tête
    g.fillStyle(0x3a2a18).fillRect(5, 6, 6, 1)
    g.fillStyle(0xa08a5a).fillRect(5, 4, 6, 1) // la ligature
  },

  /**
   * LA TORCHE ALLUMÉE — la MÊME hampe, et la tête devient une FLAMME. Deux icônes voisines
   * dont l'une brûle : le joueur doit pouvoir dire d'un coup d'œil, dans une ceinture pleine,
   * laquelle de ses deux torches est vive. D'où le jaune franc, la seule chose lumineuse de
   * l'inventaire avec le sel — et lui est blanc, pas chaud.
   */
  torche_vive: (g) => {
    g.fillStyle(0x5a3d22).fillRect(7, 8, 2, 7) // la hampe, plus courte : la tête mange le haut
    g.fillStyle(0x7a5530).fillRect(7, 8, 1, 7)
    g.fillStyle(0x8a3a10).fillRect(5, 6, 6, 3) // le fagot, incandescent à sa base
    g.fillStyle(0xd06a14).fillRect(5, 4, 6, 3) // le cœur orange
    g.fillStyle(0xf0a028).fillRect(6, 2, 4, 3) // la flamme
    g.fillStyle(0xffe07a).fillRect(7, 1, 2, 2) // la pointe, la plus claire
    g.fillStyle(0xffe07a).fillRect(6, 3, 1, 1) // une langue qui part de côté
  },

  // Un tas de cendre, gris pâle, et UNE braise dedans. C'est le jeu qui porte son nom.
  ash: (g) => {
    g.fillStyle(0x7e7a76).fillCircle(8, 11, 5)
    g.fillStyle(0x9b9691).fillCircle(6, 10, 3)
    g.fillStyle(0xb5b0aa).fillCircle(6, 9, 1)
    g.fillStyle(0xd9541f).fillRect(9, 11, 2, 2) // la braise — elle couve encore
  },

  // Deux bûches croisées, cœur clair en bout (au NO).
  wood: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(2, 9, 12, 4)
    g.fillStyle(0x7a5a34).fillRect(2, 5, 12, 4)
    g.fillStyle(0x8d6b40).fillRect(2, 5, 12, 1)
    g.fillStyle(0xc3a678).fillRect(2, 5, 2, 4) // le cœur du bois, en bout
  },

  // Le foyer en miniature : une flamme qui monte, deux bûches au pied. C'est l'objet
  // qu'on pose ; il porte le nom du jeu, il ne peut pas être une case vide.
  campfire: (g) => {
    g.fillStyle(0xd9541f).fillTriangle(4, 13, 12, 13, 8, 2) // la flamme, rouge-orangé
    g.fillStyle(0xf0a020).fillTriangle(6, 13, 10, 13, 8, 6) // son cœur orange
    g.fillStyle(0xffe37a).fillCircle(8, 10, 1) // le point chaud
    g.fillStyle(0x5a3d22).fillRect(2, 12, 12, 2) // la bûche du dessus
    g.fillStyle(0x6a4c2c).fillRect(3, 14, 10, 1) // celle du dessous
    g.fillStyle(0xc3a678).fillRect(2, 12, 2, 2) // cœur clair au bout (NO)
  },

  // Les COMPOSANTS EN OBJET (spec construction R20) : une silhouette qui dit la
  // fonction. L'enclume a sa corne ; le four, sa bouche ardente ; le four d'acier,
  // la même en plus haut et bleuté (l'acier).
  enclume: (g) => {
    g.fillStyle(0x3c3c44).fillRect(3, 8, 10, 4) // le corps
    g.fillStyle(0x2a2a30).fillRect(5, 12, 6, 2) // le socle
    g.fillStyle(0x54545e).fillRect(3, 8, 10, 1) // la table éclairée
    g.fillStyle(0x3c3c44).fillTriangle(11, 8, 15, 8, 11, 11) // la corne
  },
  furnace: (g) => {
    g.fillStyle(0x6a5030).fillRect(3, 3, 10, 11) // le fût de brique
    g.fillStyle(0x84673f).fillRect(3, 3, 10, 2)
    g.fillStyle(0x2a2018).fillRect(5, 7, 6, 6) // la gueule
    g.fillStyle(0xe8842c).fillRect(6, 9, 4, 3) // les braises
    g.fillStyle(0xffd070).fillRect(7, 10, 2, 1)
  },
  four_acier: (g) => {
    g.fillStyle(0x4a5560).fillRect(3, 2, 10, 12) // le fût d'acier
    g.fillStyle(0x66727e).fillRect(3, 2, 10, 2)
    g.fillStyle(0x1c2228).fillRect(5, 6, 6, 6) // la gueule
    g.fillStyle(0x7ac0ff).fillRect(6, 8, 4, 3) // la flamme d'acier, bleutée
    g.fillStyle(0xd8f0ff).fillRect(7, 9, 2, 1)
  },
  // Atelier : établi (un plan de travail sur tréteaux), tour méca (un volant/roue),
  // atelier lourd (l'établi + une masse sombre : la grosse machine).
  workshop: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(2, 6, 12, 3) // le plateau
    g.fillStyle(0x8a6234).fillRect(2, 6, 12, 1)
    g.fillStyle(0x4a3520).fillRect(3, 9, 2, 5) // les pieds
    g.fillStyle(0x4a3520).fillRect(11, 9, 2, 5)
    g.fillStyle(0x9a9aa3).fillRect(9, 3, 3, 3) // un outil posé dessus
  },
  tour_meca: (g) => {
    g.fillStyle(0x3c3c44).fillRect(3, 6, 10, 6) // le bâti
    g.fillStyle(0x54545e).fillRect(3, 6, 10, 1)
    g.fillStyle(0x8a6234).fillCircle(8, 9, 3) // le volant en bois
    g.fillStyle(0x2a2a30).fillCircle(8, 9, 1)
    g.fillStyle(0x2a2018).fillRect(2, 12, 12, 2) // le socle
  },
  atelier_lourd: (g) => {
    g.fillStyle(0x2e2e34).fillRect(2, 3, 12, 9) // la masse (grosse machine)
    g.fillStyle(0x44444c).fillRect(2, 3, 12, 2)
    g.fillStyle(0xe8842c).fillRect(5, 7, 3, 2) // un voyant chaud
    g.fillStyle(0x6a4c2c).fillRect(2, 12, 12, 2) // l'établi au pied
  },
  // Grenier : le silo (une jarre panse ronde), la cave (une trappe/voûte sombre),
  // la réserve (une jarre cerclée de fer — la conservation stratégique).
  silo: (g) => {
    g.fillStyle(0x8a6a3a).fillRect(4, 4, 8, 10) // la panse
    g.fillStyle(0xa8834a).fillRect(4, 4, 3, 10) // la face au NO
    g.fillStyle(0x6a4c2c).fillRect(5, 2, 6, 2) // le col
    g.fillStyle(0x4a3520).fillRect(4, 13, 8, 1)
  },
  cave: (g) => {
    g.fillStyle(0x4a4a52).fillRect(3, 6, 10, 8) // la voûte de pierre
    g.fillStyle(0x2a2a30).fillRect(6, 8, 4, 6) // la trappe sombre (le froid)
    g.fillStyle(0x66666e).fillRect(3, 6, 10, 2) // le linteau éclairé
  },
  reserve: (g) => {
    g.fillStyle(0x7a5a34).fillRect(4, 3, 8, 11) // la jarre
    g.fillStyle(0x9a9aa3).fillRect(4, 6, 8, 1) // les cercles de fer
    g.fillStyle(0x9a9aa3).fillRect(4, 10, 8, 1)
    g.fillStyle(0x9a7a44).fillRect(4, 3, 3, 11) // la face au NO
  },
  // Ferme : la parcelle (des sillons de terre + une pousse verte), la serre (un
  // cadre vitré, clair), le terroir (une terre riche + une gerbe — l'Ermitage).
  parcelle: (g) => {
    g.fillStyle(0x5a4028).fillRect(2, 8, 12, 6) // la terre labourée
    g.fillStyle(0x6a4c30).fillRect(2, 8, 12, 1)
    g.fillStyle(0x3a2a18).fillRect(4, 9, 1, 5) // les sillons
    g.fillStyle(0x3a2a18).fillRect(8, 9, 1, 5)
    g.fillStyle(0x5aa84a).fillRect(6, 3, 2, 5) // une pousse verte
  },
  serre: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(2, 12, 12, 2) // le socle
    g.fillStyle(0xbfe0d8).fillRect(3, 3, 10, 9) // le vitrage (clair, translucide)
    g.fillStyle(0x8ab0a8).fillRect(7, 3, 1, 9) // les montants
    g.fillStyle(0x8ab0a8).fillRect(3, 7, 10, 1)
  },
  terroir: (g) => {
    g.fillStyle(0x4a3420).fillRect(2, 9, 12, 5) // la terre riche, sombre
    g.fillStyle(0xd8b24a).fillTriangle(5, 9, 8, 2, 11, 9) // la gerbe dorée
    g.fillStyle(0xe8c66a).fillRect(7, 3, 1, 6)
  },
  // Le coffre : une malle de bois au couvercle doré (comme sa structure `st-chest`).
  chest: (g) => {
    g.fillStyle(0x4a3520).fillRect(2, 6, 12, 8) // le corps
    g.fillStyle(0x7a5a30).fillRect(3, 7, 10, 6)
    g.fillStyle(0x8a6234).fillRect(2, 6, 12, 2) // le couvercle éclairé
    g.fillStyle(0xc9a227).fillRect(6, 8, 4, 3) // la serrure dorée
  },

  // Trois galets gris empilés — froids, pas de teinte chaude.
  stone: (g) => {
    g.fillStyle(0x5a5a60).fillCircle(6, 11, 4)
    g.fillStyle(0x6a6a72).fillCircle(11, 11, 3)
    g.fillStyle(0x7c7c86).fillCircle(8, 6, 4)
    g.fillStyle(0x9a9aa4).fillCircle(6, 4, 1) // éclat NO
  },

  // Botte d'herbe nouée : brins verts, un lien plus clair au milieu.
  fiber: (g) => {
    g.fillStyle(0x6f9c3a).fillRect(4, 2, 2, 12)
    g.fillStyle(0x7fae44).fillRect(7, 1, 2, 13)
    g.fillStyle(0x6f9c3a).fillRect(10, 2, 2, 12)
    g.fillStyle(0xb89a52).fillRect(3, 8, 10, 2) // le lien
  },

  // Trois baies rouges sur tige.
  berries: (g) => {
    g.fillStyle(0x2f5e33).fillRect(7, 1, 2, 6) // tige
    g.fillStyle(0xc0392b).fillCircle(5, 9, 3)
    g.fillStyle(0xc0392b).fillCircle(11, 9, 3)
    g.fillStyle(0xd4564a).fillCircle(8, 12, 3)
    g.fillStyle(0xe88a80).fillCircle(4, 8, 1) // reflet NO
  },

  // Champignons : deux chapeaux bruns sur pieds clairs — la trouvaille de l'herboriste.
  champignons: (g) => {
    g.fillStyle(0xe8dcc0).fillRect(5, 8, 2, 6) // pied gauche
    g.fillStyle(0x8a5a34).fillEllipse(6, 8, 7, 4) // chapeau gauche
    g.fillStyle(0xe8dcc0).fillRect(10, 6, 2, 8) // pied droit (plus grand)
    g.fillStyle(0x9c6636).fillEllipse(11, 6, 8, 5) // chapeau droit
    g.fillStyle(0xb98a58).fillCircle(9, 5, 1) // reflet NO
  },

  // Vers : deux vers rosés qui se tordent sur un fond de terre — l'appât du sous-bois.
  worms: (g) => {
    g.fillStyle(0x4a3626).fillRect(3, 10, 10, 4) // la poignée de terre
    g.fillStyle(0xc98a7a).fillRect(4, 6, 2, 2).fillRect(5, 7, 2, 2).fillRect(6, 8, 2, 2) // ver gauche, en diagonale
    g.fillStyle(0xb87466).fillRect(9, 5, 2, 2).fillRect(10, 6, 2, 2).fillRect(10, 8, 2, 2).fillRect(11, 9, 2, 2) // ver droit, en S
    g.fillStyle(0xe0a898).fillRect(4, 6, 1, 1).fillRect(9, 5, 1, 1) // reflets NO
  },

  // Légume du potager : une racine ocre à fanes vertes (nourriture de base).
  legume: (g) => {
    g.fillStyle(0x3f7a33).fillRect(6, 1, 1, 4).fillRect(8, 0, 1, 5).fillRect(10, 1, 1, 4) // les fanes
    g.fillStyle(0xd89a34).fillEllipse(8, 10, 8, 10) // la racine
    g.fillStyle(0xefc060).fillCircle(6, 8, 1) // reflet NO
  },

  // Graines : quelques pépins clairs au creux d'une paume — l'amorçage du potager.
  graine: (g) => {
    g.fillStyle(0x7a5c34).fillEllipse(8, 12, 12, 5) // la paume
    g.fillStyle(0xd8c48a).fillCircle(6, 10, 1).fillCircle(9, 9, 1).fillCircle(11, 11, 1).fillCircle(8, 11, 1)
  },

  // ── LES CULTURES DE SAISON (S16) : chacune se reconnaît à sa SILHOUETTE, pas à sa teinte —
  // en case d'inventaire on ne lit qu'une forme. Feuille dressée, baie ronde, racine trapue.
  pousse_verte: (g) => {
    g.fillStyle(0x4f8f3a).fillEllipse(8, 8, 5, 13) // la feuille dressée
    g.fillStyle(0x8fd06a).fillRect(7, 3, 1, 10) // la nervure claire
  },
  graine_verte: (g) => {
    g.fillStyle(0x7a5c34).fillEllipse(8, 12, 12, 5)
    g.fillStyle(0xb8d98a).fillCircle(6, 10, 1).fillCircle(9, 9, 1).fillCircle(11, 11, 1)
  },
  fruit_sec: (g) => {
    g.fillStyle(0x8a4a22).fillCircle(6, 9, 3).fillCircle(10, 11, 3) // deux fruits ratatinés
    g.fillStyle(0xc07a3a).fillCircle(5, 8, 1).fillCircle(9, 10, 1)
  },
  graine_fruit: (g) => {
    g.fillStyle(0x7a5c34).fillEllipse(8, 12, 12, 5)
    g.fillStyle(0xd8a06a).fillCircle(6, 10, 1).fillCircle(9, 9, 1).fillCircle(11, 11, 1)
  },
  tubercule: (g) => {
    g.fillStyle(0x9a6a3a).fillEllipse(8, 9, 12, 9) // la racine trapue, celle qui passe l'hiver
    g.fillStyle(0x6a4526).fillCircle(5, 8, 1).fillCircle(10, 11, 1) // les yeux
  },
  graine_tubercule: (g) => {
    g.fillStyle(0x7a5c34).fillEllipse(8, 12, 12, 5)
    g.fillStyle(0xa88a5a).fillCircle(6, 10, 1).fillCircle(9, 9, 1).fillCircle(11, 11, 1)
  },

  // Bol fumant : coupe brune, ragoût, deux volutes.
  stew: (g) => {
    g.fillStyle(0xcac2b2).fillRect(6, 2, 1, 3).fillRect(9, 1, 1, 4) // vapeur
    g.fillStyle(0x5a3f28).fillEllipse(8, 11, 12, 7) // le bol
    g.fillStyle(0x8a5a30).fillEllipse(8, 9, 9, 4) // la surface du ragoût
    g.fillStyle(0xb07c40).fillCircle(6, 8, 1) // reflet NO
  },

  // Minerai de fer : roche grise à mouchetures ocre.
  iron_ore: (g) => {
    g.fillStyle(0x565660).fillCircle(8, 9, 6)
    g.fillStyle(0x6c6c76).fillCircle(6, 7, 3)
    g.fillStyle(0xb0632e).fillRect(9, 6, 2, 2).fillRect(6, 11, 2, 2).fillRect(11, 10, 1, 1)
  },

  // Charbon de bois : la BÛCHE de `wood`, mais carbonisée — même silhouette, même bout de
  // cœur clair. C'est ce qui le distingue à l'œil de la houille (`coal`, des éclats anguleux
  // sans forme d'origine) : l'un a été un arbre, l'autre est sorti de la roche. Le bout pâle
  // n'est pas du bois vif mais la CENDRE du bout, et une braise y couve — le même 0xd9541f
  // que la cendre et le feu de camp, la teinte qui veut dire « ça a brûlé » dans tout le jeu.
  charcoal: (g) => {
    g.fillStyle(0x2b2830).fillRect(2, 9, 12, 4)
    g.fillStyle(0x3a353f).fillRect(2, 5, 12, 4)
    g.fillStyle(0x565060).fillRect(2, 5, 12, 1) // l'arête qui prend la lumière
    g.fillStyle(0x9a9088).fillRect(2, 5, 2, 4) // le bout cendré
    g.fillStyle(0xd9541f).fillRect(9, 10, 2, 1) // une braise, dans la MASSE et non sur la cendre
  },

  // Charbon : éclats noirs anguleux.
  coal: (g) => {
    g.fillStyle(0x1c1c22).fillTriangle(3, 12, 8, 4, 11, 12)
    g.fillStyle(0x121216).fillTriangle(8, 13, 12, 6, 14, 13)
    g.fillStyle(0x3a3a42).fillTriangle(5, 6, 7, 5, 6, 9) // arête réfléchissante NO
  },

  // Lingot de fer : trapèze bleuté, dessus clair.
  iron_ingot: (g) => {
    g.fillStyle(0x53616e).fillTriangle(2, 12, 4, 6, 14, 12) // masse
    g.fillRect(4, 6, 8, 6)
    g.fillStyle(0x53616e).fillTriangle(12, 12, 12, 6, 14, 12)
    g.fillStyle(0x8996a2).fillRect(4, 6, 8, 2) // dessus éclairé
  },

  // Corde : un rouleau — trois anneaux de fibre tressée, brin qui dépasse.
  rope: (g) => {
    g.lineStyle(2, 0xb89a52).strokeCircle(8, 8, 6)
    g.lineStyle(2, 0x9c8244).strokeCircle(8, 8, 3)
    g.fillStyle(0xd0b468).fillRect(3, 3, 3, 2) // reflet NO sur le tour extérieur
    g.fillStyle(0xb89a52).fillRect(12, 9, 4, 2) // le brin libre
  },

  /*
   * Les trois objets de FORTUNE partagent une grammaire : tête de PIERRE (jamais
   * de métal), et un LIEN de fibre ocre bien visible au raccord. À 16 px c'est ce
   * lien qui les distingue de leurs versions forgées — on doit voir en ombre
   * chinoise qu'on tient un caillou ficelé, pas une lame.
   */

  // Hachereau : manche + éclat de pierre ligaturé, plus trapu qu'une hache.
  crude_axe: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(9, 3, 2, 11) // manche
    g.fillStyle(0x8d6b40).fillRect(9, 3, 1, 11)
    g.fillStyle(0x7c7c86).fillTriangle(5, 2, 11, 3, 10, 8) // éclat de pierre (irrégulier)
    g.fillStyle(0x9a9aa4).fillTriangle(5, 2, 8, 2, 7, 4) // arête claire NO
    g.fillStyle(0xb89a52).fillRect(8, 5, 4, 2) // la ligature
  },

  // Pic de fortune : une seule pointe de pierre, en biais, ligaturée.
  crude_pickaxe: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(7, 4, 2, 11) // manche
    g.fillStyle(0x8d6b40).fillRect(7, 4, 1, 11)
    g.fillStyle(0x7c7c86).fillTriangle(1, 6, 8, 2, 9, 5) // la pointe, oblique
    g.fillStyle(0x9a9aa4).fillTriangle(1, 6, 5, 4, 5, 5) // arête claire NO
    g.fillStyle(0xb89a52).fillRect(6, 4, 4, 2) // la ligature
  },

  // Épieu taillé : hampe + petit éclat pointu, ligaturé.
  crude_spear: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(6, 5, 2, 10) // hampe
    g.fillStyle(0x8d6b40).fillRect(6, 5, 1, 10)
    g.fillStyle(0x7c7c86).fillTriangle(4, 5, 10, 5, 7, 0) // pointe de pierre
    g.fillStyle(0x9a9aa4).fillTriangle(4, 5, 6, 5, 6, 2) // arête claire NO
    g.fillStyle(0xb89a52).fillRect(5, 5, 4, 2) // la ligature
  },

  // ── LE TIR ── En ombre chinoise, un arc est UN ARC : la courbe du bois et la corde
  // droite qui la ferme. C'est la seule silhouette du sac qui ne soit pas un bâton —
  // elle se distingue de la lance et de la hache sans qu'on lise la couleur.
  crude_bow: (g) => {
    // Le bois : trois segments qui font le galbe (pas de courbe à 16 px, des marches).
    g.fillStyle(0x6a4c2c)
    g.fillRect(5, 2, 2, 3)
    g.fillRect(4, 5, 2, 6)
    g.fillRect(5, 11, 2, 3)
    g.fillStyle(0x8d6b40).fillRect(4, 5, 1, 6) // la face claire, au nord-ouest
    g.fillStyle(0xcfc4a4).fillRect(6, 2, 1, 12) // la corde, tendue et droite
  },
  bow: (g) => {
    // L'ARC LONG : plus haut (il déborde de la case), plus galbé, corde plus claire.
    g.fillStyle(0x7a5a34)
    g.fillRect(6, 0, 2, 3)
    g.fillRect(4, 3, 2, 4)
    g.fillRect(3, 7, 2, 2)
    g.fillRect(4, 9, 2, 4)
    g.fillRect(6, 13, 2, 3)
    g.fillStyle(0x9d7a4c).fillRect(3, 7, 1, 2)
    g.fillStyle(0xb89a52).fillRect(4, 7, 3, 2) // la poignée, ligaturée
    g.fillStyle(0xe6dcc0).fillRect(7, 0, 1, 16) // la corde
  },
  arrow: (g) => {
    g.fillStyle(0x8d6b40).fillRect(7, 3, 2, 11) // la hampe
    g.fillStyle(0x6a4c2c).fillRect(8, 3, 1, 11)
    g.fillStyle(0x9a9aa4).fillTriangle(5, 4, 11, 4, 8, 0) // la pointe de pierre
    g.fillStyle(0xc4c4ce).fillTriangle(5, 4, 8, 4, 8, 1) // arête claire NO
    g.fillStyle(0xd8d2c0).fillTriangle(7, 14, 4, 16, 7, 11) // l'empenne
    g.fillStyle(0xb5ad98).fillTriangle(9, 14, 12, 16, 9, 11)
  },

  // Hache : manche bois + fer triangulaire.
  axe: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(9, 3, 2, 11) // manche
    g.fillStyle(0x8d6b40).fillRect(9, 3, 1, 11)
    g.fillStyle(0x8a8a92).fillTriangle(4, 2, 11, 2, 11, 8) // fer
    g.fillStyle(0xb4b4bc).fillTriangle(4, 2, 8, 2, 8, 4) // tranchant clair
  },

  // Pioche : manche + tête en T (deux pointes).
  pickaxe: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(7, 4, 2, 11) // manche
    g.fillStyle(0x8d6b40).fillRect(7, 4, 1, 11)
    g.fillStyle(0x8a8a92).fillRect(2, 4, 12, 2) // barre de tête
    g.fillStyle(0x8a8a92).fillTriangle(1, 5, 3, 3, 3, 7).fillTriangle(15, 5, 13, 3, 13, 7) // pointes
    g.fillStyle(0xb4b4bc).fillRect(2, 4, 12, 1) // arête claire
  },

  // Hache de fer : la hache, bleutée, avec un liseré clair.
  iron_axe: (g) => {
    g.fillStyle(0x53616e).fillRect(9, 3, 2, 11) // manche sombre bleuté
    g.fillStyle(0x6f7d8a).fillRect(9, 3, 1, 11)
    g.fillStyle(0x6f7d8a).fillTriangle(4, 2, 11, 2, 11, 8) // fer
    g.fillStyle(0xaeb9c4).fillTriangle(4, 2, 8, 2, 8, 4) // tranchant / liseré clair
  },

  // Pioche de fer : la pioche, bleutée, liseré clair.
  iron_pickaxe: (g) => {
    g.fillStyle(0x53616e).fillRect(7, 4, 2, 11)
    g.fillStyle(0x6f7d8a).fillRect(7, 4, 1, 11)
    g.fillStyle(0x6f7d8a).fillRect(2, 4, 12, 2)
    g.fillStyle(0x6f7d8a).fillTriangle(1, 5, 3, 3, 3, 7).fillTriangle(15, 5, 13, 3, 13, 7)
    g.fillStyle(0xaeb9c4).fillRect(2, 4, 12, 1)
  },

  // Lingot d'acier : le trapèze du fer, mais poli — argenté clair, reflet vif.
  steel_ingot: (g) => {
    g.fillStyle(0x707d86).fillTriangle(2, 12, 4, 6, 14, 12) // masse
    g.fillRect(4, 6, 8, 6)
    g.fillStyle(0x707d86).fillTriangle(12, 12, 12, 6, 14, 12)
    g.fillStyle(0xd8e0e6).fillRect(4, 6, 8, 2) // dessus éclairé, poli
  },

  // Hache d'acier : la hache de fer, argentée et polie (liseré vif) — le sommet.
  steel_axe: (g) => {
    g.fillStyle(0x5c6b74).fillRect(9, 3, 2, 11) // manche
    g.fillStyle(0x8a97a2).fillRect(9, 3, 1, 11)
    g.fillStyle(0x9aa6b0).fillTriangle(4, 2, 11, 2, 11, 8) // acier
    g.fillStyle(0xe4ecf1).fillTriangle(4, 2, 8, 2, 8, 4) // tranchant poli, vif
  },

  // Pioche d'acier : la pioche de fer, argentée et polie.
  steel_pickaxe: (g) => {
    g.fillStyle(0x5c6b74).fillRect(7, 4, 2, 11)
    g.fillStyle(0x8a97a2).fillRect(7, 4, 1, 11)
    g.fillStyle(0x9aa6b0).fillRect(2, 4, 12, 2)
    g.fillStyle(0x9aa6b0).fillTriangle(1, 5, 3, 3, 3, 7).fillTriangle(15, 5, 13, 3, 13, 7)
    g.fillStyle(0xe4ecf1).fillRect(2, 4, 12, 1)
  },

  // Lance : hampe en diagonale + pointe claire.
  spear: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(6, 5, 2, 10) // hampe
    g.fillStyle(0x8d6b40).fillRect(6, 5, 1, 10)
    g.fillStyle(0x8a8a92).fillTriangle(3, 5, 10, 5, 7, 0) // pointe
    g.fillStyle(0xb4b4bc).fillTriangle(3, 5, 6, 5, 6, 1) // arête claire NO
  },

  // Marteau de construction : manche bois, tête de fer massive en travers.
  // Silhouette volontairement TRAPUE — on doit le distinguer de la hache d'un
  // coup d'œil dans la ceinture (même famille de couleurs, tout autre masse).
  hammer: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(7, 6, 2, 9) // manche
    g.fillStyle(0x8d6b40).fillRect(7, 6, 1, 9)
    g.fillStyle(0x6c6c76).fillRect(3, 2, 10, 5) // la tête, en travers
    g.fillStyle(0x8996a2).fillRect(3, 2, 10, 2) // dessus éclairé (lumière au NO)
    g.fillStyle(0x53616e).fillRect(11, 2, 2, 5) // la panne, plus sombre
  },

  // Viande crue : pièce rouge avec os clair.
  raw_meat: (g) => {
    g.fillStyle(0xa8352e).fillEllipse(8, 9, 12, 9)
    g.fillStyle(0xc25a50).fillEllipse(6, 7, 6, 4) // gras / reflet NO
    g.fillStyle(0xe6ddc8).fillRect(11, 2, 2, 5) // l'os
    g.fillStyle(0xe6ddc8).fillCircle(12, 2, 2)
  },

  // ── LA PÊCHE (spec peche.md G8) — trois poissons, trois TAILLES, couchés tête à gauche. ──
  // Cru : le dos sombre, le ventre clair, l'œil ; grillé : le même corps bruni, sans l'œil, une
  // strie de grill. Rectiligne comme tout l'art (des marches, pas des courbes) ; la taille fait
  // l'espèce : le goujon tient dans 9 px, le brochet déborde presque de la case.
  gudgeon: (g) => {
    g.fillStyle(0x6f7f6a).fillRect(3, 7, 8, 3) // le corps, gris-vert
    g.fillStyle(0xd8d4bf).fillRect(4, 9, 6, 1) // le ventre
    g.fillStyle(0x6f7f6a).fillRect(11, 6, 2, 5) // la queue
    g.fillStyle(0x1d1d1a).fillRect(4, 7, 1, 1) // l'œil
  },
  // LA LAMPROIE DE SUIE (`cendre.md` R26b) — un SERPENT plus qu'un poisson : longue, fine,
  // grise comme l'eau qu'elle habite, la bouche-ventouse ronde à gauche, SANS œil — c'est
  // l'absence d'œil et la teinte de cendre qui la séparent de l'anguille au premier regard.
  lamproie: (g) => {
    g.fillStyle(0x5c5854).fillRect(2, 8, 11, 2) // le corps, gris de suie, d'un bord à l'autre
    g.fillStyle(0x7a7268).fillRect(3, 8, 9, 1) // le dos, à peine plus clair
    g.fillStyle(0x5c5854).fillRect(13, 7, 2, 4) // la queue
    g.fillStyle(0x2e2c2a).fillRect(1, 7, 2, 3) // la tête ronde
    g.fillStyle(0x0e0d0c).fillRect(1, 8, 1, 1) // la bouche-ventouse — pas d'œil
  },
  trout: (g) => {
    g.fillStyle(0x4f6a5a).fillRect(2, 6, 10, 4) // le dos, vert sombre
    g.fillStyle(0xc9a56a).fillRect(3, 9, 8, 1) // le flanc doré
    g.fillStyle(0xe3ddc8).fillRect(3, 10, 8, 1) // le ventre
    g.fillStyle(0x4f6a5a).fillRect(12, 5, 2, 6) // la queue
    g.fillStyle(0xa8352e).fillRect(5, 7, 1, 1).fillRect(8, 8, 1, 1) // deux points rouges — la truite
    g.fillStyle(0x1d1d1a).fillRect(3, 7, 1, 1) // l'œil
  },
  pike: (g) => {
    g.fillStyle(0x3f5a3a).fillRect(1, 6, 12, 4) // un corps LONG, olive
    g.fillStyle(0x8fa060).fillRect(2, 7, 10, 1) // la ligne claire du flanc
    g.fillStyle(0xd8d4bf).fillRect(2, 9, 10, 1) // le ventre
    g.fillStyle(0x3f5a3a).fillRect(0, 6, 2, 2) // le bec plat, tête à gauche
    g.fillStyle(0x3f5a3a).fillRect(13, 5, 3, 6) // la queue, large
    g.fillStyle(0x1d1d1a).fillRect(2, 6, 1, 1) // l'œil
  },
  // ── LES QUINZE ESPÈCES DU 2026-08-24 — peintes par un GÉNÉRATEUR, pas à la main.
  //
  //    Dix-huit poissons dessinés un par un auraient été dix-huit occasions d'oublier une
  //    espèce (la table est `Record<ItemId, …>`, elle l'aurait attrapé — mais en rendant une
  //    case vide plausible). Le générateur tient la GRAMMAIRE (dos sombre, flanc, ventre clair,
  //    œil, queue ; la CLASSE fait la taille) et chaque espèce n'apporte que sa palette et son
  //    accent. Les trois d'origine gardent leur dessin à la main, plus détaillé.
  vairon: poissonPeint('petit', 0x4f6a86, 0x9fb4c8, 0xe4e9ef),
  gardon: poissonPeint('petit', 0x6a6f5a, 0xb9b48c, 0xe6e2cf, 0xa8352e),
  loche: poissonPeint('petit', 0x6a5a3f, 0x9a8654, 0xd6cbae),
  ecrevisse: (g) => {
    // Pas un poisson : une carapace et deux pinces. La seule ligne de la table qui doit se
    // reconnaître au premier coup d'œil dans un sac — sinon elle passe pour un petit poisson.
    g.fillStyle(0x8a3a2a).fillRect(4, 6, 7, 4) // le corps
    g.fillStyle(0xb15a3c).fillRect(5, 7, 5, 1) // le dos éclairé
    g.fillStyle(0x8a3a2a).fillRect(2, 5, 2, 2).fillRect(2, 9, 2, 2) // les deux pinces
    g.fillStyle(0x8a3a2a).fillRect(11, 7, 3, 2) // la queue en éventail
    g.fillStyle(0x1d1d1a).fillRect(5, 6, 1, 1)
  },
  ombre: poissonPeint('moyen', 0x5a6a72, 0xa9b6bc, 0xe0e4e6, 0x6a4f86),
  chevesne: poissonPeint('moyen', 0x5f6a52, 0xb0b28c, 0xe4e0cd),
  tanche: poissonPeint('moyen', 0x4a5a30, 0x8a9a48, 0xc8ce92),
  perche: poissonPeint('moyen', 0x4f6a3a, 0x9aa85a, 0xdcdcb4, 0xc06a2a),
  anguille: (g) => {
    // Un SERPENT : pas de queue en éventail, un corps qui traverse toute la case. C'est la
    // silhouette qui la dit, pas la couleur — elle se pêche de nuit, on la reconnaît de loin.
    g.fillStyle(0x3a4034).fillRect(1, 6, 14, 2)
    g.fillStyle(0x3a4034).fillRect(2, 8, 12, 1)
    g.fillStyle(0xc8c4a8).fillRect(3, 8, 10, 1)
    g.fillStyle(0x1d1d1a).fillRect(2, 6, 1, 1)
  },
  coregone: poissonPeint('moyen', 0x6a7a86, 0xc0cbd4, 0xeef1f4),
  barbeau: poissonPeint('gros', 0x6a5f3a, 0xb09a5a, 0xdcd3b0),
  saumon: poissonPeint('gros', 0x7a4a4a, 0xc9705a, 0xe8d8cd, 0xc9705a),
  sandre: poissonPeint('gros', 0x4a5240, 0x93a06a, 0xd6d6b4, 0x2a2a24),
  carpe: poissonPeint('gros', 0x6a5a2a, 0xb99a48, 0xe0d09a),
  silure: (g) => {
    // LE MONSTRE : une masse noire qui déborde, deux barbillons. Deux mètres possibles.
    g.fillStyle(0x2a2a26).fillRect(0, 5, 14, 6)
    g.fillStyle(0x4a4a40).fillRect(1, 6, 12, 1)
    g.fillStyle(0x8a8a72).fillRect(1, 10, 12, 1)
    g.fillStyle(0x2a2a26).fillRect(14, 4, 2, 8)
    g.fillStyle(0x6a6a56).fillRect(0, 3, 1, 3).fillRect(2, 2, 1, 3) // les barbillons
    g.fillStyle(0xc9c07a).fillRect(1, 6, 1, 1) // l'œil, jaune
  },
  // ── LE CUIT, PAR CLASSE (D12) — le même corps bruni, la strie du grill, l'œil en moins. ──
  cooked_fish_petit: (g) => {
    g.fillStyle(0x7a4a26).fillRect(3, 7, 8, 3)
    g.fillStyle(0xa9743a).fillRect(4, 7, 6, 1) // la dorure
    g.fillStyle(0x7a4a26).fillRect(11, 6, 2, 5)
    g.fillStyle(0x3a2512).fillRect(6, 7, 1, 3) // la strie du grill
  },
  cooked_fish_moyen: (g) => {
    g.fillStyle(0x7a4a26).fillRect(2, 6, 10, 4)
    g.fillStyle(0xa9743a).fillRect(3, 6, 8, 1)
    g.fillStyle(0x7a4a26).fillRect(12, 5, 2, 6)
    g.fillStyle(0x3a2512).fillRect(5, 6, 1, 4).fillRect(8, 6, 1, 4)
  },
  cooked_fish_gros: (g) => {
    g.fillStyle(0x7a4a26).fillRect(1, 6, 12, 4)
    g.fillStyle(0xa9743a).fillRect(2, 6, 10, 1)
    g.fillStyle(0x7a4a26).fillRect(0, 6, 2, 2).fillRect(13, 5, 3, 6)
    g.fillStyle(0x3a2512).fillRect(4, 6, 1, 4).fillRect(7, 6, 1, 4).fillRect(10, 6, 1, 4)
  },
  // ── LE SÉCHÉ (D13) — il PEND, et c'est ce qui le distingue du grillé d'un coup d'œil : une
  //    ficelle en haut, un corps sec et fendu, plus mince que le même poisson frais. ──
  dried_fish_petit: poissonSeche(4, 8),
  dried_fish_moyen: poissonSeche(3, 10),
  dried_fish_gros: poissonSeche(2, 12),
  dried_meat: (g) => {
    g.fillStyle(0x8a8272).fillRect(7, 1, 1, 3) // la ficelle
    g.fillStyle(0x6a3a2a).fillRect(4, 4, 8, 9) // la lanière
    g.fillStyle(0x8a4a34).fillRect(5, 5, 6, 2)
    g.fillStyle(0x3a2018).fillRect(6, 8, 4, 1).fillRect(6, 11, 4, 1) // les fibres sèches
  },
  // ── LA SALAISON (S4bis) — le séché, PLUS LA CROÛTE : des grains presque blancs semés sur le
  //    corps (la valeur du sel des fumerolles, `#e4dfd0`) — c'est l'écart de valeur qui dit
  //    « salé » à la taille d'une case, jamais un changement de forme. ──
  salted_fish_petit: poissonSale(4, 8),
  salted_fish_moyen: poissonSale(3, 10),
  salted_fish_gros: poissonSale(2, 12),
  salted_meat: (g) => {
    g.fillStyle(0x8a8272).fillRect(7, 1, 1, 3) // la ficelle
    g.fillStyle(0x6a3a2a).fillRect(4, 4, 8, 9) // la lanière
    g.fillStyle(0x8a4a34).fillRect(5, 5, 6, 2)
    g.fillStyle(0x3a2018).fillRect(6, 8, 4, 1).fillRect(6, 11, 4, 1) // les fibres sèches
    g.fillStyle(0xe4dfd0).fillRect(5, 6, 1, 1).fillRect(9, 7, 1, 1).fillRect(7, 10, 1, 1).fillRect(6, 12, 1, 1) // la croûte
  },
  // LE CŒUR DE BRAISE (cendre.md R29) : une pierre noire FENDUE de braise — c'est l'écart de
  // valeur qui le dit vivant : les fentes orange sur le noir, l'éclat au centre.
  coeur_de_braise: (g) => {
    g.fillStyle(0x1d1a18).fillRect(4, 4, 8, 9) // la pierre, presque noire
    g.fillStyle(0x2e2825).fillRect(5, 4, 6, 2) // la face haute
    g.fillStyle(0xd0722a).fillRect(6, 7, 4, 1).fillRect(8, 8, 1, 3).fillRect(5, 10, 2, 1) // les fentes
    g.fillStyle(0xf0a850).fillRect(7, 7, 2, 1) // l'éclat au cœur
  },
  // LA BRAISE-MÈRE (cendre.md R28) : un brasero — socle de pierre, vasque de fer, la braise
  // qui affleure. La grammaire cubique des postes (silhouette franche, arêtes droites).
  braise_mere: (g) => {
    g.fillStyle(0x5c5854).fillRect(5, 12, 6, 2) // le socle de pierre
    g.fillStyle(0x3a3a40).fillRect(4, 6, 8, 6) // la vasque de fer
    g.fillStyle(0x54545c).fillRect(4, 6, 8, 1) // la lèvre
    g.fillStyle(0xd0722a).fillRect(5, 4, 6, 2) // la braise qui affleure
    g.fillStyle(0xf0a850).fillRect(7, 3, 2, 1).fillRect(6, 4, 1, 1) // les pointes chaudes
  },
  // LA GRAINE DE BRAISE (agriculture.md J3) : trois grains sombres, un point chaud sur
  // chacun — la braise dort dedans. Le don du murmure se reconnaît au sac.
  graine_de_braise: (g) => {
    g.fillStyle(0x2e2825).fillRect(4, 6, 3, 3).fillRect(9, 5, 3, 3).fillRect(6, 10, 3, 3)
    g.fillStyle(0xd0722a).fillRect(5, 7, 1, 1).fillRect(10, 6, 1, 1).fillRect(7, 11, 1, 1)
  },
  // LA PARCELLE DE SUIE (agriculture.md J1) : un cadre de bois plein de cendre — le carré
  // sombre au centre dit la terre, les quatre coins clairs disent le cadre (cultivé = taillé).
  parcelle_de_suie: (g) => {
    g.fillStyle(0x7a5c38).fillRect(3, 5, 10, 8) // le cadre de bois
    g.fillStyle(0x9a7848).fillRect(3, 5, 10, 1).fillRect(3, 5, 1, 8).fillRect(12, 5, 1, 8) // les chants clairs
    g.fillStyle(0x44403c).fillRect(5, 7, 6, 5) // la suie
    g.fillStyle(0x5c5854).fillRect(6, 8, 1, 1).fillRect(9, 10, 1, 1) // le grain de la cendre
  },
  // L'ORGE-DE-BRAISE (J2) : un épi GRIS aux grains qui rougeoient — la seule moisson que
  // l'hiver connaît. La tige droite (cultivé = taillé), les grains en quinconce.
  orge_de_braise: (g) => {
    g.fillStyle(0x6a6660).fillRect(7, 3, 2, 11) // la tige, gris de suie
    g.fillStyle(0x8e8c88).fillRect(5, 3, 2, 2).fillRect(9, 4, 2, 2).fillRect(5, 6, 2, 2).fillRect(9, 7, 2, 2) // les grains
    g.fillStyle(0xc96a24).fillRect(6, 4, 1, 1).fillRect(10, 5, 1, 1).fillRect(6, 7, 1, 1) // le rougeoiement
  },
  // LE CUIR CENDRÉ (cendre.md R30c) : la peau brute, en GRIS — même silhouette que raw_hide,
  // la teinte fait l'espèce (la corrompue se lit au sac comme à l'écran).
  cuir_cendre: (g) => {
    g.fillStyle(0x6a6660).fillRect(3, 4, 10, 9) // la dépouille, gris de suie
    g.fillStyle(0x827e78).fillRect(4, 5, 8, 2) // le dos, plus clair
    g.fillStyle(0x4a4744).fillRect(3, 4, 2, 2).fillRect(11, 4, 2, 2).fillRect(3, 11, 2, 2).fillRect(11, 11, 2, 2) // les pattes
    g.fillStyle(0x8e8c88).fillRect(6, 8, 4, 3) // l'usure du poil, au centre
  },
  // LE SÉCHOIR EN OBJET (S1) : une claie — deux montants, une traverse, deux prises pendues.
  sechoir: (g) => {
    g.fillStyle(0x6a5232).fillRect(2, 4, 1, 10).fillRect(13, 4, 1, 10) // les montants
    g.fillStyle(0x8a6a42).fillRect(2, 4, 12, 1) // la traverse
    g.fillStyle(0x9a8a6a).fillRect(5, 5, 1, 2).fillRect(10, 5, 1, 2) // les ficelles
    g.fillStyle(0x7a5a3a).fillRect(4, 7, 3, 5).fillRect(9, 7, 3, 5) // deux prises qui sèchent
  },
  // LA CANNE DE FORTUNE : une branche en diagonale (des marches), une corde qui pend de la
  // pointe, un crochet de deux pixels. Le bois de l'arc de fortune, la corde de la corde.
  crude_rod: (g) => {
    g.fillStyle(0x6a4c2c)
    g.fillRect(2, 12, 3, 2) // le manche, en bas à gauche
    g.fillRect(4, 10, 3, 2)
    g.fillRect(6, 8, 3, 2)
    g.fillRect(8, 6, 3, 2)
    g.fillRect(10, 4, 3, 2)
    g.fillRect(12, 2, 2, 2) // la pointe
    g.fillStyle(0x8d6b40).fillRect(2, 12, 1, 1).fillRect(6, 8, 1, 1).fillRect(10, 4, 1, 1) // la face claire
    g.fillStyle(0xcfc4a4).fillRect(13, 4, 1, 7) // la ligne, qui pend de la pointe
    g.fillStyle(0xb9b2a0).fillRect(12, 11, 2, 1).fillRect(12, 10, 1, 1) // l'hameçon
  },

  // LE COUTEAU DE FORTUNE (depecage.md D4) : un éclat de pierre grise emmanché sur un bout de
  // bois, en diagonale comme la canne — le manche en bas à gauche, la lame vers le haut à
  // droite, un fil clair sur le tranchant. Un outil, pas une arme : il n'a pas la garde de l'épieu.
  crude_knife: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(2, 11, 3, 3).fillRect(4, 9, 3, 3) // le manche en bois
    g.fillStyle(0x8d6b40).fillRect(2, 11, 1, 1).fillRect(4, 9, 1, 1) // sa face claire
    g.fillStyle(0xcfc4a4).fillRect(6, 8, 2, 2) // la ligature
    g.fillStyle(0x7d7f82).fillRect(7, 5, 3, 3).fillRect(9, 3, 3, 3).fillRect(11, 2, 2, 2) // l'éclat de pierre
    g.fillStyle(0xb4b7ba).fillRect(9, 3, 1, 1).fillRect(11, 2, 1, 1) // le fil du tranchant, clair
    g.fillStyle(0x4f5154).fillRect(8, 7, 2, 1).fillRect(10, 5, 2, 1) // le dos de la lame, dans l'ombre
  },

  // L'OS (depecage.md D5) : un long os blanc-crème, deux têtes, une ombre sur le dessous.
  bone: (g) => {
    g.fillStyle(0xe6ddc8).fillRect(4, 7, 8, 3) // le fût
    g.fillStyle(0xe6ddc8).fillCircle(3, 6, 2).fillCircle(3, 10, 2).fillCircle(13, 6, 2).fillCircle(13, 10, 2) // les têtes
    g.fillStyle(0xf4eee0).fillRect(4, 7, 8, 1) // le dessus éclairé
    g.fillStyle(0xb8ad95).fillRect(4, 9, 8, 1) // le dessous
  },

  // Quartier : un GROS morceau de viande sur l'os — plus imposant que la pièce crue.
  quartier: (g) => {
    g.fillStyle(0x8f2f28).fillEllipse(8, 9, 15, 12) // la masse de viande, rouge sombre
    g.fillStyle(0xb04a40).fillEllipse(6, 6, 8, 6) // le gras / reflet NO
    g.fillStyle(0xe6ddc8).fillRect(11, 1, 3, 7) // l'os, épais
    g.fillStyle(0xe6ddc8).fillCircle(12, 2, 3) // la tête de l'os
  },

  // Viande cuite : même pièce, brun doré.
  cooked_meat: (g) => {
    g.fillStyle(0x7a4a26).fillEllipse(8, 9, 12, 9)
    g.fillStyle(0xa9743a).fillEllipse(6, 7, 6, 4) // dorure / reflet NO
    g.fillStyle(0xe6ddc8).fillRect(11, 2, 2, 5) // l'os
    g.fillStyle(0xe6ddc8).fillCircle(12, 2, 2)
  },

  // Peau brute : une pièce de cuir pliée, fauve, avec un pli d'ombre et le côté chair clair.
  raw_hide: (g) => {
    g.fillStyle(0x9c6b3f).fillRect(2, 3, 12, 10) // la peau, fauve
    g.fillStyle(0xb98a56).fillRect(2, 3, 12, 3) // dessus éclairé (lumière au NO)
    g.fillStyle(0x6f4a29).fillRect(2, 8, 12, 2) // le pli d'ombre
    g.fillStyle(0xd8c3a0).fillRect(3, 11, 10, 2) // le côté chair (clair) qui dépasse
  },

  // Cuir : un rouleau tanné, brun chaud et régulier (fini, plus lisse que la peau brute).
  leather: (g) => {
    g.fillStyle(0x7a4a28).fillRect(3, 4, 10, 8) // le rouleau
    g.fillStyle(0x8f5c34).fillRect(3, 4, 10, 2) // dessus éclairé
    g.fillStyle(0x5a3520).fillRect(3, 7, 10, 1).fillRect(3, 10, 10, 1) // les enroulements
    g.fillStyle(0x4a2c1a).fillRect(11, 4, 2, 8) // le bord du rouleau, dans l'ombre
  },

  // Tenue d'hiver : un manteau de cuir doublé, col clair (fourrure) — la protection.
  tenue_hiver: (g) => {
    g.fillStyle(0x6b4326).fillRect(3, 5, 10, 10) // le corps du manteau
    g.fillStyle(0x7f5330).fillRect(3, 5, 10, 2) // épaules éclairées
    g.fillStyle(0xcabfa0).fillRect(5, 3, 6, 3) // le col (fourrure claire)
    g.fillStyle(0x4a2c18).fillRect(7, 7, 2, 8) // la fente centrale, ombre
  },

  // Composants : un engrenage de ferraille.
  components: (g) => {
    g.fillStyle(0x6c6c76).fillCircle(8, 8, 6)
    g.fillStyle(0x8996a2).fillRect(7, 0, 2, 3).fillRect(7, 13, 2, 3).fillRect(0, 7, 3, 2).fillRect(13, 7, 3, 2) // dents
    g.fillStyle(0x53616e).fillCircle(8, 8, 3)
    g.fillStyle(0x2b2b30).fillCircle(8, 8, 2) // moyeu
  },
}

/** Appelée UNE fois par BootScene : peuple le cache de textures — un dessin par ItemId. */
export function generateItemIcons(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 })
  for (const item of Object.keys(ITEM_PAINTS) as ItemId[]) {
    g.clear()
    ITEM_PAINTS[item](g)
    g.generateTexture(itemIconKey(item), ITEM_ICON_PX, ITEM_ICON_PX)
  }
  g.destroy()
}

/**
 * LES PAIRES `it-*_lit` — pour les PILES AU SOL et le poisson du ferrage : un item lâché vit
 * dans le monde, donc sous sa lumière (l'ambiante ne mord que les sprites `setLighting`, et le
 * voile de nuit passe SOUS les sprites — sans bascule, une pile brillait en pleine nuit comme
 * en plein jour). Le MÊME `ItemPaint` rejoué sur Canvas2D (peintre.ts) fait l'albédo ; la
 * normale est cubique (`passes:1`/`k:3.5` — un item est un objet taillé ou posé, pas un dôme),
 * `dresse:false` (posé à plat : le miroir n'apporterait rien).
 */
export function generateItemIconsLit(scene: Phaser.Scene): void {
  for (const item of Object.keys(ITEM_PAINTS) as ItemId[]) {
    const alb = newCanvas(ITEM_ICON_PX, ITEM_ICON_PX)
    ITEM_PAINTS[item](new PeintreCanvas(alb.ctx))
    registerLitPaire(scene, itemIconKey(item), { albedo: alb.c, dresse: false, passes: 1, k: 3.5 })
  }
}
