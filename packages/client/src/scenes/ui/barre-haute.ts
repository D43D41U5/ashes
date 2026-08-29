/**
 * LA BARRE HAUTE — où je suis, où en est l'année, quel temps il fait.
 *
 * Elle remplace le coin haut-gauche du HUD (`hud-core`), qui écrivait tout le temps la même
 * ligne : « JOUR 51 — ACTE II — 14H ». Trois défauts d'un coup, et c'est ce qui l'a motivée :
 * la ligne disait l'acte en CHIFFRES ROMAINS alors que les saisons ont des noms depuis la
 * refonte du calendrier ; elle ne disait rien du DÉFILÉ (on savait le jour, jamais combien il
 * restait avant l'hiver) ; et sa ligne de lieu mélangeait la région et le lieu.
 *
 * ═══ LES TROIS BLOCS ═══
 *
 * À GAUCHE, OÙ JE SUIS — le toponyme, le lieu qu'on foule, l'air qu'il fait ici en °C. Le
 * médaillon d'en bas dit la température du CORPS ; celui-ci dit celle du MONDE, et c'est
 * l'information qui manquait : on ne savait jamais si l'endroit où l'on va est tenable.
 *
 * AU CENTRE, LE RUBAN DE L'ANNÉE — une fenêtre de 30 jours (une saison pile) à 23 px/jour, la
 * tête de lecture AU TIERS : dix jours derrière, vingt devant. La saison qui vient entre par
 * la droite et grossit, sans qu'aucun chiffre ne l'annonce (« le monde le dit, l'interface
 * non » — `saisons.md` S18/Q16). La barre nomme le PRÉSENT, elle ne prédit pas.
 *
 * À DROITE, LE CIEL ET L'HEURE — le dégradé n'est pas décoratif : c'est la loi d'ambiance du
 * jeu (`lighting.ts`), donc le ruban porte la teinte que le monde AURA à cette heure-là, et
 * l'aube y a la vraie pente. L'icône dit le temps qu'il fait AU POINT DU JOUEUR.
 *
 * ═══ CE QU'ELLE NE FAIT PAS ═══
 *
 * Aucune règle : tout arrive résolu par `UIScene`. Aucune couleur inventée non plus — les
 * quatre teintes de saison viennent de `teinte-saison.ts` (celles que le SOL portera) et le
 * ciel de `lighting.ts`. Les recopier ici, c'est la dérive que `palette.ts` raconte déjà
 * (« trois rouges pour un seul accent »).
 */
import { BALANCE, GEL, TEMPERATURE, VENT, type GameTime, type MeteoAspect } from '@ashes/sim'
import { ASTRES } from './astres'
import { CARDINAUX as CARDINAUX_SAISON } from '../../render/teinte-saison'
import { ambientTint, heureSolaire } from '../../render/lighting'
import { INK_OUTLINE, INK_OUTLINE_STRONG } from './hud-dom'
import { HEX } from './palette'

/** Hauteur de la barre. Le bandeau CONSEIL vit dessous (`bandeaux.ts`). */
export const BARRE_H = 72

/** Le ruban : une fenêtre d'une saison pile, tête de lecture au tiers. */
const PX_PAR_JOUR = 23
const FENETRE = PX_PAR_JOUR * BALANCE.ACT_DAYS
const TETE = Math.round(FENETRE / 3)
/** Le ruban de l'heure : ±5 h autour de la tête, elle aussi au tiers. */
const PX_PAR_HEURE = 22
const FENETRE_H = 216
const TETE_H = Math.round(FENETRE_H / 3)

/**
 * LA GRÂCE DE SORTIE D'UN LIEU (décision d'Alexis, 2026-08-24) — 500 ms, DÉRIVÉE.
 *
 * `lieuAt` est un test de rectangle : longer le bord d'une empreinte fait entrer et sortir à
 * chaque pas, et la barre clignoterait. On garde donc le lieu affiché un moment après la
 * sortie. La durée ne se choisit pas, elle est encadrée — patron de `GEL.HYSTERESIS` :
 *
 *   PLANCHER 440 ms — deux fois l'animation (220 ms). En dessous, la sortie s'amorce et se
 *   fait rattraper en plein vol : c'est un anti-rebond, pas une grâce.
 *   PLAFOND 500 ms — le temps de TRAVERSER LA PLUS PETITE EMPREINTE EN SPRINT (3 tuiles à
 *   6 t/s). Au-delà, un joueur qui court aurait franchi un lieu entier en lisant encore le
 *   précédent — juste au moment où ça compte, en passant devant une Tanière.
 *
 * Les deux bornes se rejoignent. Elle vit CÔTÉ CLIENT : c'est de l'affichage, la mettre dans
 * la sim changerait l'état et le replay. Comparée en ÂGE dans `update`, sur l'horloge Phaser,
 * jamais un `delayedCall` — l'horloge headless saute et enjamberait le front.
 */
export const LIEU_GRACE_MS = 500

/** Le mouvement d'entrée et de sortie d'un lieu (voir le CSS). */
const ANIM_MS = 220

/**
 * ═══ LES TROIS RANGS DE GAUCHE, ET LEUR RYTHME ═══
 *
 * Trois informations empilées ne se lisent que si leurs POIDS sont francs. Le premier jet les
 * avait trop proches — 11 / 14 / 12 px — et l'œil ne savait plus laquelle était le sujet.
 * Elles se répartissent donc en trois rôles, avec une interligne écrite plutôt que subie :
 *
 *   LE CONTEXTE — la région, en surtitre : petit, espacé, éteint.
 *   LE SUJET — le lieu qu'on foule : le plus gros de la barre, gras, encre vive. C'est lui
 *     qu'on cherche du regard, et c'est lui qu'Alexis a demandé d'agrandir (2026-08-24).
 *   LA DONNÉE — l'air qu'il fait, en degrés : la taille du corps de texte, pas plus.
 *
 * `LIEU_RANG_H` est la hauteur OUVERTE du rang du lieu : elle sert au CSS et à l'animation,
 * et c'est la seule façon d'animer une hauteur (`auto` ne s'interpole pas).
 */
const ZONE_PX_SEUL = 14
const ZONE_PX_SURTITRE = 11
const LIEU_PX = 21
/** L'interligne du surtitre — il compte dans la hauteur du bloc, donc dans la garde du sol. */
const ZONE_LH = 15
export const LIEU_RANG_H = 30
/**
 * La largeur des deux colonnes de bord. ÉGALES : la colonne du milieu est un `flex-grow`
 * centré sur ce qui RESTE, donc deux bords inégaux la décalent. 340 px laissent au nom du lieu
 * de quoi grandir (« LE REPAIRE DE CENDRÉS », le plus long du catalogue, tient à 21 px) sans
 * rien voler au ruban : la barre avait 240 px de mou.
 *
 * ⚠ Cela centre le GROUPE du milieu, pas la fenêtre du ruban : le groupe est
 * `[AN][fenêtre][caractère]`, et ses deux flancs ne font pas la même largeur — mesuré, la
 * fenêtre reste 44 px à gauche du centre de la barre. Les égaliser coûterait soit du vide à
 * gauche, soit un nom de caractère tronqué à droite ; et la tête de lecture, elle, est au
 * TIERS de la fenêtre par décision — le centre exact n'est de toute façon pas le repère.
 */
const COL_BORD = 340

/**
 * LE SOL DE LA BARRE — et sa garde.
 *
 * La barre pose du texte sur le monde, comme le coin haut-gauche avant elle : elle a donc
 * besoin du même sol, et de la même preuve. `hud-plaque.test` mesurait le contraste composite
 * du HUD sur les pires fonds relevés au banc (le sol de midi, une tache de soleil) ; la barre
 * introduit un fond DIFFÉRENT — un dégradé vertical, pas un voile radial — et y met le texte
 * le plus important de l'écran. Sans extension de la garde, ce texte serait passé sur un fond
 * que personne n'a mesuré, et le test serait resté vert en ne gardant plus rien.
 *
 * Les trois arrêts sont ceux du CSS, PARTAGÉS avec lui : le dégradé se construit à partir
 * d'eux (`solDeLaBarre`), donc une retouche « pour faire moins lourd » déplace la garde avec.
 */
export const BARRE_SOL_ENCRE = '12,9,7'
/**
 * `[position dans la hauteur, opacité]` — du haut de la barre à son bas.
 *
 * PRESQUE PLAT, et c'est voulu (2026-08-24) : la barre est sombre d'un bord à l'autre et de
 * haut en bas. La première version tombait à 0,62 sur son dernier cinquième — le rang du bas
 * y perdait son sol. Ce qui doit fondre, c'est ce qui vient APRÈS la barre : l'ombre sous le
 * filet s'en charge.
 */
export const BARRE_SOL_ARRETS: readonly (readonly [number, number])[] = [
  [0, 0.96],
  [1, 0.92],
]
/**
 * Le bas du rang de texte le plus bas de la barre, en part de la hauteur : c'est là que le sol
 * est le plus mince sous une lettre.
 *
 * C'est la LIGNE DE LA TEMPÉRATURE, en bas du coin du ciel : 20 px d'heure + 3 de gouttière +
 * 16 de température font 39 px, centrés dans les 72 de la barre. La colonne de gauche descend
 * un peu plus bas depuis que le nom du lieu a grandi (15 + 30 = 45 px centrés, soit 58,5), et
 * c'est donc ELLE qu'on prend. La plaque « JOUR N » ne compte pas — elle porte son propre fond.
 */
const BAS_DU_TEXTE = ((BARRE_H + (ZONE_LH + LIEU_RANG_H)) / 2) / BARRE_H

/** L'opacité du sol à une hauteur donnée — l'interpolation même du dégradé CSS. */
export function opaciteDuSol(part: number): number {
  const arrets = BARRE_SOL_ARRETS
  for (let i = 1; i < arrets.length; i += 1) {
    const [p0, a0] = arrets[i - 1]!
    const [p1, a1] = arrets[i]!
    if (part <= p1) return a0 + ((a1 - a0) * (part - p0)) / (p1 - p0)
  }
  return arrets[arrets.length - 1]![1]
}

/** LA PIRE OPACITÉ SOUS UNE LETTRE de la barre — dérivée, jamais écrite. C'est elle que la
 *  garde de contraste éprouve. */
export const BARRE_ALPHA_MIN = opaciteDuSol(BAS_DU_TEXTE)

function solDeLaBarre(): string {
  const stops = BARRE_SOL_ARRETS.map(
    ([p, a]) => `rgba(${BARRE_SOL_ENCRE},${a}) ${(p * 100).toFixed(0)}%`,
  )
  return `linear-gradient(180deg,${stops.join(',')})`
}

/** `0xrrggbb` (Phaser) → `#rrggbb` (CSS). */
function hex(col: number): string {
  return '#' + col.toString(16).padStart(6, '0')
}

/**
 * LE CIEL DU RUBAN — la loi d'ambiance du jeu, composée sur un sol de plein jour.
 *
 * `ambientTint` donne, heure par heure, la teinte et l'opacité du voile que le monde porte.
 * Ce voile se pose en MULTIPLY sur le rendu : on refait ici le même mélange sur une couleur de
 * sol unique, et le ruban devient un échantillon honnête de la journée. L'aube et le
 * crépuscule y ont donc les vraies pentes — la chute de 20 h à 21 h est raide parce que
 * l'opacité y passe de 0,34 à 0,60 en une heure, pas parce qu'on l'a dessinée ainsi.
 *
 * `SOL_ETALON` est le seul nombre choisi à l'œil de tout le bloc : à pleine clarté, le ruban
 * était la chose la plus lumineuse de la barre et volait le regard.
 */
const SOL_ETALON = [0xa6, 0x9e, 0x8a] as const

const PAS_CIEL = 0.5

export function cielDuJour(dayTicks: number, lever: number): string {
  const stops: string[] = []
  // ═══ ON ÉCHANTILLONNE À HEURES MURALES, ON NE DÉPLACE PAS LES KEYFRAMES (2026-08-26) ═══
  //
  // La règle du ruban est en heures MURALES ; les keyframes, elles, vivent sur le cadran
  // solaire — et depuis que le jour suit la saison (`saisons.md` S6), les deux ne coïncident
  // qu'à l'équinoxe : l'or de « 20 h » tombe bien plus tôt au Grand Froid. On demande donc à
  // l'ambiance ce qu'elle vaut À CHAQUE HEURE MURALE, au lieu de convertir chaque keyframe.
  //
  // ⚠ C'EST LE SENS DE LA CONVERSION QUI COMPTE, et l'autre ne marchait pas. Poser les
  // keyframes à leur heure murale rend une liste NON CROISSANTE dès que la journée est courte
  // (mesuré au jour 105 : 90,3 % · 19,2 % · 25,0 % …) — or CSS comme SVG rabattent tout stop
  // sur le plus grand qui précède, si bien que le ruban s'effondrait en une bande de nuit
  // plate, sans un mot. Échantillonner en avant est croissant PAR CONSTRUCTION.
  for (let h = 0; h <= 24; h += PAS_CIEL) {
    const k = ambientTint(heureSolaire(h, dayTicks, lever))
    const t = [(k.color >> 16) & 255, (k.color >> 8) & 255, k.color & 255]
    const canal = (i: number): number =>
      Math.round(SOL_ETALON[i]! * (1 - k.alpha) + ((SOL_ETALON[i]! * t[i]!) / 255) * k.alpha)
    stops.push(`rgb(${canal(0)},${canal(1)},${canal(2)}) ${((h / 24) * 100).toFixed(2)}%`)
  }
  return `linear-gradient(90deg,${stops.join(',')})`
}

/**
 * LA TEINTE D'UNE SAISON — celle que le SOL portera, pas un accent de HUD.
 *
 * Les quatre cardinaux de `teinte-saison.ts` sont les couleurs vers lesquelles le décor se
 * fond au cœur de chaque saison. Le ruban les reprend telles quelles : sa bande a donc la
 * couleur de la vallée ce jour-là, et l'année se lit en un coup d'œil — vert tendre, or,
 * roux, gris-bleu. C'est la même idée que la couleur du Feu d'un village : diégétique.
 */
function teinteDeSaison(phase: number): string {
  return hex(CARDINAUX_SAISON[(phase - 1) % CARDINAUX_SAISON.length]!.teinte.cible)
}

/** Le remplissage d'une bande : sa teinte, très diluée — le nom doit rester lisible dessus. */
function fondDeSaison(phase: number): string {
  const c = CARDINAUX_SAISON[(phase - 1) % CARDINAUX_SAISON.length]!.teinte.cible
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},.20)`
}

/** L'encre d'une température d'air : ce qui brûle, ce qui va, ce qui mord. Les deux bascules
 *  basses sont DÉRIVÉES de la sim (le cadran dev lit les mêmes : `AMBIANT_DOUX` = l'air doux,
 *  `SEUIL_GUE` = le zéro du gel) — un réglage de `balance.ts` déplace l'encre avec la loi.
 *  Le seuil « brûlant » (18) reste un choix d'interface : aucune constante de jeu ne dit où
 *  la chaleur commence à se lire chaude. */
function encreDuFroid(c: number): string {
  if (c >= 18) return HEX.emberDeep
  if (c >= TEMPERATURE.AMBIANT_DOUX) return HEX.ember
  if (c >= GEL.SEUIL_GUE) return HEX.body
  return HEX.gel
}

export interface BarreHauteState {
  time: GameTime
  /** La région (`toponymeAt`) — undefined hors de toute zone nommée. */
  toponyme: string | undefined
  /** Le lieu qu'on foule (`lieuAt`) — undefined dehors. Son nom porte déjà son sort. */
  lieu: string | undefined
  /** L'air qu'il fait ici, en °C — undefined tant que le monde n'a rien dit. */
  ambiant: number | undefined
  /** Le ciel du FRONT DU JOUR au point du joueur — `null` quand aucun front n'est élu
   *  (→ soleil ou lune). Sans test d'empreinte : le mur qui approche a déjà son aspect. */
  ciel: MeteoAspect | null
  /** …et couvre-t-il ICI ? Faux : l'icône s'estompe — elle annonce, elle ne constate pas. */
  couvre: boolean
  /** Le caractère de la saison, déjà nommé — undefined deux saisons sur trois. */
  caractere: string | undefined
  /**
   * LE VENT (spec `vent.md` V10, décision d'Alexis 2026-08-24) — le cap et la force, LUS de la
   * sim (`state.wind` / `state.windForce`), jamais recomposés ici : `vent.ts` est l'écrivain
   * unique du cap, le HUD compris (A8).
   *
   * ⚠ CE CADRAN ROUVRE UN POINT DÉCIDÉ. `chasse.md` C19 disait : « le vent : lisible en
   * permanence, DIÉGÉTIQUE (herbes, particules) — pas une flèche d'UI ». Il avait raison tant
   * que le vent ne commandait qu'un canal de perception. Depuis l'unification, il commande
   * l'odorat ET annonce le front : c'est devenu une mécanique qu'on doit pouvoir lire sans
   * l'interpréter — comme la girouette de Wind Waker, qui ne dessine pourtant presque jamais
   * le vent. Les herbes restent la lecture PREMIÈRE ; le cadran est le recours.
   */
  vent: { x: number; y: number; force: number } | undefined
  /** L'horloge Phaser : c'est elle qui mesure la grâce de sortie. */
  now: number
}

export interface BarreHaute {
  update(s: BarreHauteState): void
  setVisible(v: boolean): void
  destroy(): void
}

/**
 * ═══ CE QUE LA BARRE MONTRE, EN NOMBRES — le cœur PUR ═══
 *
 * Tout ce que la barre décide se calcule ici, sans toucher au DOM : la grâce de sortie, les
 * deux bouts du mouvement, l'encre du froid, le glissement du tapis, l'icône du ciel. Le
 * module qui peint n'a plus qu'à poser des valeurs.
 *
 * Ce n'est pas un raffinement, c'est ce qui rend la barre TESTABLE. Le paquet client n'a pas
 * de DOM sous vitest — et surtout la transition de 220 ms appartient au navigateur : on ne la
 * photographie pas en vol. Ce qui se garde, ce sont les DEUX BOUTS qu'elle interpole, et ils
 * sont ici.
 */
export interface VueBarre {
  zone: string
  zoneTaille: string
  zoneLs: string
  zoneEncre: string
  lieuNom: string
  lieuH: string
  lieuOp: string
  lieuX: string
  airVisible: boolean
  airTxt: string
  airEncre: string
  an: string
  jour: string
  tapisX: number
  /** La largeur du voile du passé, en espace TAPIS — elle coule avec la tête. */
  passeW: number
  caractere: string | null
  caractereEncre: string
  heureTxt: string
  cielX: number
  ico: string
  /** L'icône météo s'ESTOMPE quand le front élu ne couvre pas encore ici (annonce, pas
   *  constat — patron de l'aiguille du vent, qui s'estompe par force faible). '1' pour les
   *  astres et sous la bande. */
  icoOp: string
  ventVisible: boolean
  /** L'angle de l'aiguille, DÉROULÉ (il peut dépasser ±360°) — voir `MemoireDuLieu.ventDeg`. */
  ventDeg: number
  ventOp: string
  ventEchelle: string
}

/**
 * Le dernier lieu traversé et quand — l'état minuscule que la grâce demande — PLUS l'angle
 * déroulé de l'aiguille du vent.
 *
 * POURQUOI L'ANGLE VIT ICI. La rotation est confiée à une transition CSS (le DOM la lisse
 * gratuitement, et l'horloge de la barre n'a pas à la porter). Mais une transition de 350° à
 * 10° prend le CHEMIN LONG : l'aiguille ferait un tour complet à l'envers. On garde donc
 * l'angle DÉROULÉ, en ajoutant à chaque frame le plus court écart signé — ce qui le fait
 * volontairement sortir de [0, 360). C'est du calcul, donc c'est ici, dans la moitié testable,
 * et pas dans le module qui peint.
 */
export interface MemoireDuLieu {
  nom: string | undefined
  vuA: number
  /** L'angle de l'aiguille tel qu'il a été rendu la fois d'avant — déroulé, jamais modulo. */
  ventDeg: number
}

export const MEMOIRE_VIERGE: MemoireDuLieu = { nom: undefined, vuA: -Infinity, ventDeg: 0 }

/** La vue, et la mémoire qui va avec — pure, sans effet de bord. */
export function vueDeLaBarre(
  s: BarreHauteState,
  avant: MemoireDuLieu,
): { vue: VueBarre; memoire: MemoireDuLieu } {
  const { time } = s
  // Le nom du dernier lieu SURVIT à la sortie : sans lui, le rang se viderait au premier tick
  // dehors et s'éteindrait d'un coup au lieu de repartir en glissant.
  const memoire: MemoireDuLieu = s.lieu !== undefined ? { nom: s.lieu, vuA: s.now, ventDeg: avant.ventDeg } : avant
  // LA GRÂCE : on tient le lieu un instant après en être sorti (voir LIEU_GRACE_MS).
  const tenu = s.lieu !== undefined || (memoire.nom !== undefined && s.now - memoire.vuA < LIEU_GRACE_MS)
  const c = s.ambiant === undefined ? 0 : Math.round(s.ambiant)
  // ═══ LE RUBAN COULE, IL NE CLAQUE PAS (Alexis, 2026-08-24) ═══
  // Accroché au jour ENTIER, le tapis sautait de 23 px une fois par jour de jeu — soit un cran
  // toutes les 45 min, et rien entre les deux : ce n'était pas un défilé, c'était une horloge à
  // aiguille sautante. Il suit désormais `jourFrac`, la part du jour écoulée, dérivée du tick
  // par la même division que le jour lui-même. La tête se pose donc au BORD GAUCHE du jour et
  // le traverse d'un bout à l'autre — et les graduations marquent les bornes des jours, pas
  // leur milieu, pour que « la tête est sur le trait » veuille dire « le jour bascule ».
  const centre = (time.seasonDay - 1 + time.jourFrac) * PX_PAR_JOUR
  const heure = Math.floor(time.hourOfCycle)
  // ═══ L'AIGUILLE DU VENT ═══
  // Elle pointe LÀ OÙ LE VENT VA — le même sens que les herbes couchées et la fumée, jamais la
  // convention météo « vent d'ouest » (d'où il vient) : deux conventions opposées côte à côte
  // se lisent à l'envers une fois sur deux. Le monde se rend en projection directe
  // (`x * TILE_PX, y * TILE_PX`), donc l'angle écran EST l'angle monde : rien à reprojeter.
  const v = s.vent
  const ventVisible = v !== undefined && (v.x !== 0 || v.y !== 0)
  let ventDeg = avant.ventDeg
  if (ventVisible) {
    const brut = (Math.atan2(v!.y, v!.x) * 180) / Math.PI
    // Le plus court écart signé vers la cible — c'est lui qui DÉROULE l'angle (voir la
    // mémoire) : sans ça, la transition CSS ferait le tour à l'envers en passant par 0.
    const ecart = (((brut - avant.ventDeg + 180) % 360) + 360) % 360 - 180
    ventDeg = avant.ventDeg + ecart
  }
  // LA FORCE se lit en INTENSITÉ, pas en longueur seule : l'aiguille s'affirme quand le front
  // approche. `u` la rapporte à sa plage utile — 0 à l'ambiance, 1 au cœur d'une bande — et la
  // sentinelle du calme plat (force 0) tombe naturellement à 0 par le clamp.
  const u = v === undefined ? 0 : Math.min(1, Math.max(0, (v.force - VENT.AMBIANT) / (1 - VENT.AMBIANT)))
  return {
    memoire: { ...memoire, ventDeg },
    vue: {
      zone: (s.toponyme ?? '').toUpperCase(),
      // La zone se RÉDUIT VERS LE HAUT quand un lieu s'ouvre sous elle : elle passe d'un titre
      // à une ligne de contexte, et remonte d'elle-même (le bloc est centré dans la barre).
      zoneTaille: tenu ? `${ZONE_PX_SURTITRE}px` : `${ZONE_PX_SEUL}px`,
      zoneLs: tenu ? '3px' : '2px',
      zoneEncre: tenu ? HEX.faint : HEX.dim,
      lieuNom: (memoire.nom ?? '').toUpperCase(),
      lieuH: tenu ? `${LIEU_RANG_H}px` : '0px',
      lieuOp: tenu ? '1' : '0',
      // Il ENTRE PAR LA GAUCHE en se déplaçant vers la droite, et repart par où il est venu.
      lieuX: tenu ? 'translateX(0)' : 'translateX(-16px)',
      airVisible: s.ambiant !== undefined,
      airTxt: `${c > 0 ? '+' : ''}${c} °C`,
      airEncre: encreDuFroid(c),
      an: `AN ${time.tour}`,
      jour: `JOUR ${time.seasonDay}`,
      // Le tapis glisse d'un jour à l'autre ; la tête, elle, ne bouge jamais.
      tapisX: Math.round(TETE - centre),
      passeW: Math.round(centre),
      caractere: s.caractere === undefined ? null : s.caractere.toUpperCase(),
      caractereEncre: teinteDeSaison(time.phase),
      heureTxt: `${String(heure).padStart(2, '0')}H`,
      // Le ciel est une TUILE de 24 h répétée : on ne fait que la faire glisser. `+24` garde
      // l'origine positive quand la fenêtre déborde avant minuit. Il coule à l'heure PLEINE
      // (décimales comprises) pour la même raison que le ruban de saison — sinon il sautait
      // de 22 px toutes les deux minutes réelles.
      cielX: Math.round(TETE_H - (time.hourOfCycle + 24) * PX_PAR_HEURE),
      ico: s.ciel ?? (time.isNight ? 'lune' : 'soleil'),
      icoOp: s.ciel !== null && !s.couvre ? '0.45' : '1',
      ventVisible,
      ventDeg,
      ventOp: (0.5 + 0.5 * u).toFixed(3),
      ventEchelle: (1 + 0.28 * u).toFixed(3),
    },
  }
}

export function createBarreHaute(board: HTMLElement): BarreHaute {
  const root = document.createElement('div')
  root.className = 'bh'
  root.innerHTML = markup()
  board.appendChild(root)

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!
  const zoneEl = $('.bh-zone')
  const lieuRang = $('.bh-lieu')
  const lieuNomEl = $('.bh-lieu-nom')
  const airTexteEl = $('.bh-air-txt')
  const anEl = $('.bh-an')
  const tapisEl = $('.bh-tapis')
  const jourEl = $('.bh-jour')
  const caractereEl = $('.bh-caractere')
  const caractereNomEl = $('.bh-caractere-nom')
  const caractereFiletEl = $('.bh-caractere-filet')
  const cielEl = $('.bh-ciel')
  const heureEl = $('.bh-heure')
  const ventEl = $('.bh-vent')
  const ventAigEl = $('.bh-vent-aig')
  const icones = new Map<string, HTMLElement>()
  for (const el of root.querySelectorAll<HTMLElement>('.bh-ico')) icones.set(el.dataset.ico!, el)


  let memoireLieu: MemoireDuLieu = MEMOIRE_VIERGE
  /** Le jour dont le tapis est peint — il ne se rebâtit qu'au changement de jour. */
  let jourPeint = -1

  return {
    setVisible(v) {
      root.style.display = v ? '' : 'none'
    },

    destroy() {
      root.remove()
    },

    update(s) {
      const { vue, memoire } = vueDeLaBarre(s, memoireLieu)
      memoireLieu = memoire

      zoneEl.textContent = vue.zone
      zoneEl.style.fontSize = vue.zoneTaille
      zoneEl.style.letterSpacing = vue.zoneLs
      zoneEl.style.color = vue.zoneEncre

      lieuNomEl.textContent = vue.lieuNom
      lieuRang.style.height = vue.lieuH
      lieuRang.style.opacity = vue.lieuOp
      lieuRang.style.transform = vue.lieuX

      airTexteEl.style.visibility = vue.airVisible ? '' : 'hidden'
      airTexteEl.textContent = vue.airTxt
      airTexteEl.style.color = vue.airEncre

      anEl.textContent = vue.an
      jourEl.textContent = vue.jour
      // Le tapis se REBÂTIT seulement quand le jour change — pas soixante fois par seconde
      // pour un ruban qui avance d'un pixel toutes les deux minutes.
      if (s.time.seasonDay !== jourPeint) {
        jourPeint = s.time.seasonDay
        tapisEl.innerHTML = tapis(s.time)
        // LE RUBAN DU CIEL SE REPEINT AVEC LE JOUR : la longueur du jour est saisonnière, donc
        // les stops du dégradé bougent d'un cycle à l'autre. `dayTicks` est constant sur tout le
        // cycle (voir `dayTicksAt`), une repeinte par jour suffit exactement.
        cielEl.style.backgroundImage = cielDuJour(s.time.dayTicks, s.time.lever)
      }
      tapisEl.style.transform = `translateX(${vue.tapisX}px)`
      // Le voile du passé passe par une VARIABLE portée par le tapis : il est reconstruit
      // avec lui au changement de jour, une poignée directe pointerait sur un élément mort.
      tapisEl.style.setProperty('--passe', `${vue.passeW}px`)

      caractereEl.style.visibility = vue.caractere === null ? 'hidden' : ''
      caractereNomEl.textContent = vue.caractere ?? ''
      caractereNomEl.style.color = vue.caractereEncre
      caractereFiletEl.style.background = vue.caractereEncre

      heureEl.textContent = vue.heureTxt
      ventEl.style.visibility = vue.ventVisible ? '' : 'hidden'
      // Une SEULE écriture porte la rotation ET l'échelle : deux transforms concurrents sur le
      // même nœud s'écrasent, et c'est l'échelle qui aurait gagné en silence.
      ventAigEl.style.transform = `rotate(${vue.ventDeg}deg) scale(${vue.ventEchelle})`
      ventAigEl.style.opacity = vue.ventOp
      cielEl.style.backgroundPosition = `${vue.cielX}px 3px`
      for (const [nom, el] of icones) {
        el.style.display = nom === vue.ico ? '' : 'none'
        if (nom === vue.ico) el.style.opacity = vue.icoOp
      }
    },
  }

  /** Les bandes de saison, les graduations et la couture de l'an — en HTML, d'un bloc. */
  function tapis(time: GameTime): string {
    const acte = Math.floor((time.seasonDay - 1) / BALANCE.ACT_DAYS) + 1
    const parts: string[] = []
    // Cinq saisons de part et d'autre : de quoi couvrir la fenêtre à tout moment.
    for (let a = Math.max(1, acte - 2); a <= acte + 3; a += 1) {
      const phase = ((a - 1) % BALANCE.ACTS_PER_YEAR) + 1
      const x = (a - 1) * BALANCE.ACT_DAYS * PX_PAR_JOUR
      const w = BALANCE.ACT_DAYS * PX_PAR_JOUR
      const teinte = teinteDeSaison(phase)
      parts.push(
        `<div class="bh-bande" style="left:${x}px;width:${w}px;background:${fondDeSaison(phase)};border-color:${teinte}"></div>`,
      )
      // Le nom se RÉPÈTE le long de sa bande — l'idiome du ruban imprimé : à toute position
      // du tapis, il y en a un dans la fenêtre.
      for (let k = 12; k < w - 130; k += 320) {
        parts.push(`<div class="bh-nom" style="left:${x + k}px;color:${teinte}">${SAISONS[phase - 1]}</div>`)
      }
      // La couture de l'an, au premier jour de la première saison.
      if (phase === 1) parts.push(`<i class="bh-couture" style="left:${x}px"></i>`)
    }
    // Un filet par jour, plus fort tous les dix — où se pose le numéro du jour de l'an.
    const d0 = Math.max(1, time.seasonDay - 22)
    // TOUS LES JOURS SE VALENT (Alexis, 2026-08-24). Un filet plus fort tous les dix jours et
    // son numéro faisaient une SECONDE graduation par-dessus la première : deux rythmes dans
    // un ruban qui n'en a qu'un — la saison. Le jour se lit sur la plaque de la tête ; la
    // règle, elle, ne fait que compter. Le filet marque le DÉBUT du jour, donc la tête qui
    // touche un filet est exactement le jour qui bascule.
    for (let d = d0; d <= time.seasonDay + 34; d += 1) {
      parts.push(`<i class="bh-tick" style="left:${(d - 1) * PX_PAR_JOUR}px"></i>`)
    }
    // CE QUI EST PASSÉ S'ÉTEINT : un voile du premier jour jusqu'à la tête.
    parts.push(`<div class="bh-passe"></div>`)
    return parts.join('')
  }
}

/** Les quatre noms, en capitales de HUD. L'ordre EST celui des phases (`nomDeSaison`). */
const SAISONS = ['ÉCLOSION', 'ARDEUR', 'PLUIES', 'GRAND FROID'] as const

/** Le fondu des deux bouts d'un ruban : pas de bord franc dans un jeu qui n'en a aucun. */
function masque(a: number, b: number): string {
  const g = `linear-gradient(90deg,rgba(0,0,0,0) 0,#000 ${a}%,#000 ${b}%,rgba(0,0,0,0) 100%)`
  return `-webkit-mask-image:${g};mask-image:${g};`
}

function markup(): string {
  return `
  <style>
    .bh{position:absolute;left:0;right:0;top:0;height:${BARRE_H}px;pointer-events:none;}
    /* PLEIN D'UN BORD À L'AUTRE (2026-08-24, Alexis : « toute la barre doit avoir un fond
       sombre »). Le voile s'éteignait à 5 % et 95 % : le lieu à gauche et l'heure à droite
       reposaient sur un fond qui s'efface — les deux bouts de la barre étaient les moins
       lisibles. La retenue du HUD (un voile qui s'éteint, pas une dalle) vaut pour une plaque
       DE COIN, qui ferait un rectangle noir dans un angle ; une barre va d'un bord à l'autre,
       elle n'a pas d'angle à trahir. Ce qui fond, c'est ce qui vient APRÈS elle : l'ombre
       sous le filet. */
    .bh-fond{position:absolute;inset:0;background:${solDeLaBarre()};}
    .bh-filet{position:absolute;left:0;right:0;top:${BARRE_H}px;height:1px;background:rgba(107,90,58,.55);}
    .bh-ombre{position:absolute;left:0;right:0;top:${BARRE_H + 1}px;height:22px;
      background:linear-gradient(180deg,rgba(12,9,7,.42),rgba(12,9,7,0));}
    .bh-rang{position:absolute;inset:0;display:flex;align-items:center;gap:28px;padding:0 26px;}

    /* ── OÙ JE SUIS ── */
    .bh-ou{width:${COL_BORD}px;display:flex;flex-direction:column;justify-content:center;}
    /* Le passage d'un état à l'autre est une ANIMATION, pas une bascule : le lieu se déplace
       VERS LA DROITE en apparaissant et son rang s'ouvre ; la zone se RÉDUIT VERS LE HAUT.
       Les trois rangs restent MONTÉS en permanence — un rang démonté ne s'anime pas en
       partant, il disparaît. */
    .bh-zone{line-height:${ZONE_LH}px;${INK_OUTLINE}transition:font-size ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1),
      letter-spacing ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1),color ${ANIM_MS}ms ease;}
    .bh-lieu{overflow:hidden;display:flex;align-items:center;gap:8px;
      transition:height ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1),opacity 160ms ease,
      transform ${ANIM_MS}ms cubic-bezier(.2,.7,.3,1);}
    /* Un nom trop long s'ABRÈGE au lieu de déborder sur le ruban : la colonne est fixe, et
       le catalogue des lieux n'est pas clos (« la Cabane de berger », « le Repaire de
       Cendrés »… et ce qui s'ajoutera). */
    .bh-lieu-nom{font-size:${LIEU_PX}px;line-height:${LIEU_RANG_H - 5}px;font-weight:700;letter-spacing:1px;
      color:${HEX.bodyBright};white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;${INK_OUTLINE_STRONG}}
    /* Le losange est un TRAIT, pas une boîte tournée : un carré en rotation déborde sa propre
       boîte de deux pixels par coin, et le overflow:hidden du rang — indispensable à
       l'animation de hauteur — lui coupait la pointe gauche. Un SVG dessine DANS son cadre. */
    .bh-lieu-los{flex-shrink:0;}
    /* Un HUD ne s'impose pas à qui a demandé le calme : le changement reste, le mouvement part. */
    @media (prefers-reduced-motion: reduce){
      .bh-zone,.bh-lieu{transition:none;}
    }

    /* ── LE RUBAN DE L'ANNÉE ── */
    .bh-centre{flex-grow:1;display:flex;align-items:center;gap:14px;justify-content:center;}
    .bh-an{width:58px;flex-shrink:0;text-align:right;font-size:11px;letter-spacing:3px;color:${HEX.faint};${INK_OUTLINE}}
    .bh-fenetre{position:relative;width:${FENETRE}px;height:52px;overflow:hidden;flex-shrink:0;${masque(6, 94)}}
    /* AUCUNE TRANSITION sur le tapis ni sur le ciel : leur position change à chaque image
       depuis qu'elle suit la fraction du jour. Interpoler une valeur déjà continue ne la
       lisserait pas — elle la ferait TRAÎNER d'un tiers de seconde en permanence. */
    .bh-tapis{position:absolute;left:0;top:0;height:52px;width:12000px;}
    .bh-bande{position:absolute;top:6px;height:26px;border-top:2px solid;border-left:2px solid;}
    .bh-nom{position:absolute;top:12px;font-size:10px;letter-spacing:3px;opacity:.88;white-space:nowrap;
      text-shadow:0 0 4px rgba(12,9,7,.95),0 0 2px rgba(12,9,7,.95);}
    .bh-tick{position:absolute;top:25px;width:1px;height:9px;background:rgba(139,132,116,.42);}
    .bh-couture{position:absolute;top:4px;width:2px;height:30px;background:${HEX.borderWarm};}
    .bh-passe{position:absolute;left:0;top:6px;height:26px;width:var(--passe,0);background:rgba(10,8,6,.60);}
    /* LA TÊTE DE LECTURE, au tiers — elle ne bouge jamais, c'est le monde qui défile. */
    .bh-tete{position:absolute;left:${TETE - 1}px;top:2px;width:2px;height:34px;background:${HEX.emberBright};
      box-shadow:0 0 8px rgba(232,198,106,.6);}
    .bh-tete-los{position:absolute;left:${TETE - 5}px;top:3px;width:9px;height:9px;background:${HEX.emberBright};
      transform:rotate(45deg);}
    .bh-jour{position:absolute;left:${TETE}px;top:36px;transform:translateX(-50%);padding:1px 7px;
      background:${HEX.emberBright};color:${HEX.bgWarm};font-size:10px;font-weight:700;letter-spacing:2px;}
    .bh-caractere{width:146px;flex-shrink:0;display:flex;align-items:center;gap:9px;}
    .bh-caractere-filet{width:3px;height:26px;flex-shrink:0;}
    .bh-caractere-tag{font-size:9px;letter-spacing:2px;color:${HEX.faint};}
    .bh-caractere-nom{font-size:11px;font-weight:700;letter-spacing:1px;white-space:nowrap;${INK_OUTLINE}}

    /* ── LE CIEL ET L'HEURE ── */
    /* ═══ LE COIN DU CIEL — une icône, deux lignes (Alexis, 2026-08-24) ═══
       L'heure vivait seule à droite et la température à gauche, sous le lieu. Elles disent
       pourtant la même chose : ce qu'il fait DEHORS, maintenant. Réunies en deux lignes contre
       le pictogramme du temps, elles se lisent d'un seul regard — et la colonne de gauche
       redevient ce qu'elle est, un lieu et rien d'autre. */
    .bh-droite{width:${COL_BORD}px;display:flex;align-items:center;justify-content:flex-end;gap:12px;}
    .bh-meteo{display:flex;align-items:center;flex-shrink:0;}
    .bh-lecture{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:78px;}
    .bh-air-txt{font-size:14px;font-weight:700;letter-spacing:1px;line-height:16px;${INK_OUTLINE}}
    .bh-ciel-fen{position:relative;width:${FENETRE_H}px;height:34px;overflow:hidden;${masque(12, 88)}}
    .bh-ciel{position:absolute;inset:0;background-size:${24 * PX_PAR_HEURE}px 16px;background-repeat:repeat-x;}
    .bh-ciel-tete{position:absolute;left:${TETE_H - 1}px;top:1px;width:2px;height:20px;background:${HEX.emberBright};
      box-shadow:0 0 6px rgba(232,198,106,.55);}
    .bh-heure{font-size:18px;font-weight:700;letter-spacing:1px;line-height:20px;color:${HEX.title};${INK_OUTLINE_STRONG}}
    .bh-ico{flex-shrink:0;}
    /* ── LE CADRAN DU VENT (spec vent.md V10) ──
       Discret par construction : les HERBES restent la lecture première, l'aiguille est le
       recours quand on veut savoir SANS interpréter. Elle vit contre le pictogramme du ciel
       parce que le vent EST le front désormais — les séparer les ferait mentir l'un sur
       l'autre. La rotation est confiée à une transition : la donnée vient de la sim par crans
       de 45°, et c'est le DOM qui rend la pente continue (jamais un timer client). */
    .bh-vent{position:relative;width:26px;height:26px;flex-shrink:0;display:flex;
      align-items:center;justify-content:center;color:${HEX.title};}
    .bh-vent-cercle{position:absolute;inset:2px;border-radius:50%;
      border:1px solid ${HEX.faint};opacity:.45;}
    .bh-vent-aig{transition:transform 900ms cubic-bezier(.25,.9,.3,1),opacity 900ms linear;
      transform-origin:50% 50%;filter:drop-shadow(0 1px 0 rgba(0,0,0,.55));}
    @media (prefers-reduced-motion: reduce){ .bh-vent-aig{transition:none;} }
  </style>
  <div class="bh-fond"></div>
  <div class="bh-filet"></div>
  <div class="bh-ombre"></div>
  <div class="bh-rang">
    <div class="bh-ou">
      <div class="bh-zone"></div>
      <div class="bh-lieu">
        <svg class="bh-lieu-los" width="13" height="13" viewBox="0 0 12 12" fill="none"
          stroke="${HEX.bodyBright}" stroke-width="1.5"><path d="M6 1.4 10.6 6 6 10.6 1.4 6Z" stroke-linejoin="round"/></svg>
        <div class="bh-lieu-nom"></div>
      </div>
    </div>

    <div class="bh-centre">
      <div class="bh-an"></div>
      <div class="bh-fenetre">
        <div class="bh-tapis"></div>
        <i class="bh-tete"></i>
        <i class="bh-tete-los"></i>
        <div class="bh-jour"></div>
      </div>
      <div class="bh-caractere">
        <i class="bh-caractere-filet"></i>
        <div>
          <div class="bh-caractere-tag">CARACTÈRE</div>
          <div class="bh-caractere-nom"></div>
        </div>
      </div>
    </div>

    <div class="bh-droite">
      <div class="bh-ciel-fen"><div class="bh-ciel"></div><i class="bh-ciel-tete"></i></div>
      <div class="bh-meteo">${icones()}</div>
      <div class="bh-vent">
        <i class="bh-vent-cercle"></i>
        <svg class="bh-vent-aig" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path d="M4 11h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M14 7l4.5 4-4.5 4z" fill="currentColor"/>
        </svg>
      </div>
      <div class="bh-lecture">
        <div class="bh-heure"></div>
        <div class="bh-air-txt"></div>
      </div>
    </div>
  </div>`
}

/**
 * LES HUIT TEMPS, au trait — les six aspects que `aspectAuPoint` rend au point du joueur
 * (`meteo.md` R11-R13 : la classe du front, plus la dérivation neige/blizzard au froid), plus
 * le soleil et la lune quand le ciel est dégagé. Dessinés en SVG et non en glyphes : le jeu
 * n'a pas d'émoji, et un trait se recolore.
 */
const NUAGE = `<path d="M4.5 10.5h7a2.5 2.5 0 0 0 0-5 3.5 3.5 0 0 0-6.8-.8 2.9 2.9 0 0 0-.2 5.8Z" stroke-linejoin="round"/>`
const NEIGEUX = '#9fbcc6'
/** Un trait PAR ASPECT, exhaustif PAR LE COMPILATEUR (`Record<MeteoAspect, …>`) : un aspect
 *  ajouté à la sim ne peut plus laisser l'icône du ciel VIDE en silence — le build casse ici.
 *  Exporté pour la garde de contraste du test (les encres du ciel se mesurent à la source). */
export const TRAITS_ASPECT: Record<MeteoAspect, { teinte: string; corps: string }> = {
  pluie: { teinte: HEX.gel, corps: `${NUAGE}<path d="M5.6 12.4v1.9M8 12.8v1.9M10.4 12.4v1.9" stroke-linecap="round"/>` },
  neige: { teinte: NEIGEUX, corps: `${NUAGE}<path d="M5.6 12.6v1.6M4.8 13.4h1.6M10.4 12.6v1.6M9.6 13.4h1.6" stroke-linecap="round"/>` },
  orage: { teinte: HEX.emberBright, corps: `${NUAGE}<path d="M8.8 12 6.9 14.6h1.6l-.6 1.8" stroke-linejoin="round" stroke-linecap="round"/>` },
  blizzard: {
    teinte: NEIGEUX,
    corps:
      `<path d="M4.5 10h7a2.5 2.5 0 0 0 0-5 3.5 3.5 0 0 0-6.8-.8 2.9 2.9 0 0 0-.2 5.8Z" stroke-linejoin="round"/>` +
      `<path d="M2.6 12.6h6.2M4.4 15h6.2M11.2 12.2v1.4M10.4 12.9h1.6" stroke-linecap="round"/>`,
  },
  brouillard: { teinte: HEX.dim, corps: `<path d="M2.6 4.6h10.2M1.8 7.5h11.6M3.4 10.4h9.4M2.6 13.3h8.2" stroke-linecap="round"/>` },
  vent_de_cendre: {
    teinte: HEX.emberDeep,
    corps:
      `<path d="M1.8 5.4h7.4a1.8 1.8 0 1 0-1.3-3.1" stroke-linecap="round"/>` +
      `<path d="M1.8 9h9a1.9 1.9 0 1 1-1.4 3.2" stroke-linecap="round"/>` +
      `<path d="M1.8 12.6h4.6" stroke-linecap="round"/>`,
  },
}
function icones(): string {
  const svg = (nom: string, teinte: string, corps: string): string =>
    `<svg class="bh-ico" data-ico="${nom}" width="24" height="24" viewBox="0 0 16 16" fill="none" ` +
    `stroke="${teinte}" stroke-width="1.4" style="display:none">${corps}</svg>`
  return [
    // LES DEUX ASTRES VIENNENT DE `astres.ts` — le cadran de l'encyclopédie tire du même trait
    // (2026-08-27). Ici ils gardent leurs teintes : la barre haute les pose sur un panneau
    // sombre, pas sur une bande de couleur.
    svg('soleil', HEX.emberBright, ASTRES.soleil),
    svg('lune', HEX.gel, ASTRES.lune),
    ...(Object.entries(TRAITS_ASPECT) as [string, { teinte: string; corps: string }][]).map(([nom, t]) => svg(nom, t.teinte, t.corps)),
  ].join('')
}
