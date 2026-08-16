/**
 * LE COMBAT SE VOIT (spec `client.md`, GDD §7 : wind-ups de 300-500 ms).
 *
 * Il ne se voyait PAS. On frappait, la sim résolvait, et l'écran ne disait rien :
 * ni le geste, ni l'impact, ni le coup reçu. Un système de combat entier, invisible.
 * Un joueur qui ne voit pas ses coups ne joue pas — il clique en espérant.
 *
 * Trois signes, et trois seulement :
 *
 *   1. LE TÉLÉGRAPHE — LA ZONE QUI VA ÊTRE FRAPPÉE, posée au sol. C'est le cœur du
 *      combat du GDD (« un combat de coût, pas de skill pur ») : on doit VOIR venir
 *      le coup, le sien comme celui d'en face. Il vient du `windup` du SNAPSHOT,
 *      jamais du clic (invariant §3).
 *
 *      PREMIÈRE VERSION JETÉE, et la leçon vaut d'être écrite : j'avais dessiné une
 *      LIGNE qui s'allongeait depuis le corps vers le curseur. Sur un avatar
 *      placeholder — un rectangle sans bras — ça n'a pas donné une lame : ça a donné
 *      une obscénité. Mais le vrai défaut était plus profond, et il aurait survécu à
 *      n'importe quelle correction de couleur : **cette ligne ne disait rien de VRAI**.
 *      La sim frappe TOUT ce qui tient dans un ARC DE 90° à 1,4 tuile
 *      (`ATTACK_ARC_COS`, `ATTACK_RANGE`) — pas ce qui touche un trait.
 *
 *      Un télégraphe décoratif est pire qu'absent : il apprend au joueur une règle
 *      qui n'existe pas. Celui-ci dessine l'arc RÉEL, et la lame le BALAIE pendant
 *      l'armement : on lit d'un coup d'œil qui va être touché, et dans combien de
 *      temps.
 *   2. L'IMPACT — la cible encaisse : elle blanchit et recule d'un cheveu.
 *   3. LE COUP REÇU — l'écran saigne. C'est le seul retour qui doit être ressenti
 *      AVANT d'être lu : quand on perd des PV, on ne regarde pas une jauge.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA RÈGLE DU JUS, ET ELLE N'EST PAS NÉGOCIABLE — CE SERA DU MULTI :
 *
 *   TOUT LE JUS NAÎT D'UN ÉVÉNEMENT DE LA SIM, JAMAIS DU CLIC.
 *
 * L'étincelle, le chiffre, la secousse, le sang à l'écran : tout est déclenché par
 * `entity_damaged` (qui porte le montant) et par le `windup` du snapshot. RIEN n'est
 * anticipé au geste. Deux raisons, et la seconde est la vraie :
 *   1. un coup qui « part » à l'écran mais que le serveur refuse est un MENSONGE —
 *      et c'est le genre de mensonge qui rend un multi indébogable (recolte.md G9) ;
 *   2. en multi, le jus des AUTRES joueurs doit marcher aussi — et d'eux, on ne
 *      reçoit que des événements. Un effet branché sur « mon clic » n'existerait que
 *      pour moi : le monde serait muet dès qu'un autre frappe.
 *
 * Corollaire : AUCUN effet ne touche la simulation. Pas de hit-stop qui gèle le tick,
 * pas de recul qui déplace VRAIMENT un corps — la position est autoritative. On peint
 * par-dessus la vérité ; on ne la bouscule pas.
 *
 * (LE RECUL, 2026-08-02, est le cas d'école de cette frontière. La RÈGLE existe dans
 * la sim — spec combat R4sexies — mais elle est livrée à ZÉRO : mesurée, elle défait
 * l'encerclement de la meute sur toutes les graines. Le coup doit pourtant se sentir,
 * alors il est PEINT ici : trois pixels d'écart qui reviennent en 160 ms, sur un sprite
 * dont la position vraie n'a pas bougé d'un cheveu. Un effet tant que ce n'est pas une
 * règle — c'est exactement ce que ce fichier a le droit de faire.)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Phaser from 'phaser'
import { FONT } from '../ui/typography'
import { eclatAt } from './bande'

const Vector2 = Phaser.Math.Vector2

/** Durées, en ms. Courtes : un retour de frappe qui traîne devient de la soupe. */
const IMPACT_MS = 160
const BLEED_MS = 260
const SPARK_MS = 220
const NUMBER_MS = 620

const BLADE = 0xf0e6d2
const IMPACT_TINT = 0xff8877
const BLEED = 0xc0503e
/** LE CENDREUX S'EFFRITE — il n'a pas de sang à donner (la sim ne le fait jamais
 *  saigner au sol : pas d'`habitat`, pas de plaie de chasse). Sa gerbe est sa
 *  matière, lue sur son sprite : la cendre claire, son ombre, la braise morte. */
export const BRISURES_CENDRE: readonly number[] = [0xb8b0a4, 0x8a8378, 0x6b3a20]
const SPARK = 0xffe9b0
/** L'arc d'un ENNEMI : rouge. Celui qui vient vers vous ne se lit pas comme le vôtre. */
const THREAT = 0xe0553f
/** LA GARDE : un acier froid, ni la lame crème ni la menace rouge — un bouclier se
 *  lit d'un autre registre. Le cône protégé est FRONTAL, comme la sim l'applique. */
const GUARD = 0x9db4c8
/** Rayon du bouclier au sol, en px : court (la garde protège de près). */
const GUARD_R = 30

/**
 * ═══ L'ARC EST ROND, ET IL DOIT L'ÊTRE (mesuré le 2026-08-02) ═══
 *
 * Il était ÉCRASÉ de 0,55 en Y — un réflexe d'iso (« un arc rond se lirait comme une
 * bulle plantée dans le dos de l'avatar »). Mais la carte est PLATE depuis le pivot
 * RimWorld : `warp.unproject` est l'identité et un pixel vaut une tuile dans les DEUX
 * axes. Un cercle au sol se dessine donc rond — c'est déjà ce que fait la lueur du Feu
 * (`fire-ground-glow`, origine 0,5/0,5, sans écrasement). Seul le télégraphe écrasait,
 * et il était donc seul à mentir. (L'ombre de contact, elle, aplatit — mais elle est
 * collée à la BASE d'un billboard : ce n'est pas une zone de sol, c'est une flaque.)
 *
 * MESURÉ (`tools/mesure-touche.mts`), à 0,55 et visée figée vers le nord : le
 * télégraphe peignait comme frappé **27 à 43 % de ce qu'il dessinait et qui était en
 * fait épargné**, et **cachait 60 à 69 % de ce qu'il frappait vraiment**. Le cône
 * dessiné vers le nord s'ouvrait à 36° là où la lance en frappe 22 : viser un loup de
 * flanc le montrait DANS l'arc sans qu'il y fût. C'est très exactement la plainte
 * d'Alexis — « le télégraphe est sur la cible mais le coup ne connecte pas ».
 *
 * La règle de ce fichier ne souffrait pas d'exception : « un télégraphe décoratif est
 * pire qu'absent, il apprend au joueur une règle qui n'existe pas ». L'écrasement est
 * parti ; ce qui est peint au sol est ce qui sera frappé, dans tous les azimuts.
 */
const SLASH_MS = 130
/**
 * LE VOL PEINT D'UNE FLÈCHE (spec `tir.md` T3). 200 ms pour toute la portée — assez
 * lent pour que l'œil SUIVE le trait (c'est ce qui dit d'où venait le coup, à onze
 * tuiles où l'on ne voit pas toujours le tireur), assez rapide pour qu'on ne se croie
 * jamais capable de l'esquiver : la sim a déjà tranché, et un vol traînant mentirait
 * sur ce qu'on peut encore faire.
 */
const TRAIT_MS = 200
/** La longueur du trait dessiné, en px — une flèche, pas un laser. */
const TRAIT_PX = 13

/** En deçà, un cône n'est plus un balayage : c'est un PIC. Il s'allonge, il ne tourne pas. */
const THRUST_HALF_ARC = 0.35 // rad, ≈ 20°

/**
 * LA ZONE D'UN COUP, en PIXELS — la traduction exacte du `Strike` de la sim (voir
 * `balance.ts`). Le client ne décide RIEN de sa forme : il lit celle que le snapshot
 * transporte. C'est toute la différence entre un télégraphe et une décoration.
 */
export interface Zone {
  shape: 'cone' | 'disc'
  /** Cône : portée en px. Disque : distance de son CENTRE, devant le corps. */
  range: number
  arcCos: number
  /** Disque : son rayon, en px. */
  radius: number
}
/** Le chiffre : blanc quand je frappe, rouge quand j'encaisse. On lit l'issue d'un
 *  combat à la COULEUR, avant même d'avoir lu le nombre. */
const HIT_MINE = '#ffffff'
const HIT_THEIRS = '#ff6b5a'

export interface AttackFx {
  /**
   * L'ÉTINCELLE, LE CHIFFRE et LA GERBE, au point d'impact (événement `entity_damaged`).
   *
   * `fromX/fromY` : d'où le coup est venu. La gerbe part à l'OPPOSÉ du frappeur —
   * projetée vers lui, elle se tasserait sur son sprite et l'on ne verrait rien
   * (leçon déjà payée sur les éclats de récolte). Sans elle, pas de gerbe : un coup
   * dont on ignore l'origine n'a pas de sens de projection à inventer.
   *
   * `brisures` : LA MATIÈRE de la cible. Absent = le rouge sombre historique ;
   * une palette = ses éclats (le Cendreux s'effrite en cendre et braise morte,
   * `BRISURES_CENDRE`) ; `null` = PAS de brisures — la chair, elle, SAIGNE, et son
   * jet balistique vit dans `sang-fx` (deux gerbes superposées liraient double).
   */
  spark(x: number, y: number, amount: number, onMe: boolean, now: number, fromX?: number, fromY?: number, brisures?: readonly number[] | null): void
  /**
   * LA ZONE qu'une entité s'apprête à frapper (lue du snapshot, `windup.strike`).
   * `mine` : la MIENNE se peint en crème, celle d'un ENNEMI en ROUGE. Ce n'est pas
   * une coquetterie — c'est l'information la plus chère du combat : on doit voir OÙ
   * LE LOUP VA MORDRE, et savoir en un coup d'œil si la zone au sol est une menace
   * ou sa propre portée. `side` : le sens du balayage (le pied qui part).
   */
  telegraph(
    x: number,
    y: number,
    dx: number,
    dy: number,
    progress: number,
    zone: Zone,
    mine: boolean,
    side: 1 | -1,
    charged: boolean,
    /** L'arme est un ARC : le télégraphe est une LIGNE, pas un cône (voir `paintLigne`). */
    ranged?: boolean,
  ): void
  /**
   * LA CHARGE : le clic est enfoncé, le coup MÛRIT. On dessine la zone qui partirait
   * SI ON RELÂCHAIT MAINTENANT — donc elle CHANGE au moment où la charge est mûre
   * (le cône devient tourbillon, le poing devient disque). Ce basculement EST le
   * signal « c'est prêt » : aucune jauge à lire, la forme le dit.
   */
  charge(
    x: number,
    y: number,
    dx: number,
    dy: number,
    ratio: number,
    zone: Zone,
    mine: boolean,
    now: number,
    /** L'arme est un ARC : la bande se lit par des ÉCLATS qui s'accélèrent (voir plus bas). */
    ranged?: boolean,
    /** Le corps qui arme — c'est LUI qui clignote (décision d'Alexis, 2026-08-02). */
    sprite?: Phaser.GameObjects.Image | null,
  ): void
  /** LE COUP PART : la zone claque, une fois. Déclenché quand le wind-up s'achève. */
  slash(x: number, y: number, dx: number, dy: number, zone: Zone, now: number, charged: boolean): void
  /**
   * LE TRAIT PART (spec `tir.md` T3). La flèche traverse la distance en ~200 ms —
   * PEINTE, et rien d'autre : la sim a déjà tout résolu au terme de l'armement, aucune
   * position n'en dépend, personne ne peut s'interposer. Le précédent est le recul de
   * R4sexies, peint ici même sans qu'un seul corps ne bouge.
   *
   * C'est le seul retour qui dise « ça y est » à onze tuiles. Sans lui, un tir manqué
   * serait un clic sans conséquence visible — et un tir manqué coûte une flèche, de
   * l'endurance et 1,1 s de récupération : il doit se VOIR partir.
   *
   * `portee` en TUILES : la longueur que le trait parcourt s'il ne rencontre rien.
   */
  trait(x: number, y: number, dx: number, dy: number, portee: number, now: number, charged: boolean): void
  /**
   * LA GARDE LEVÉE (parade) : un arc d'acier devant qui pare, épousant EXACTEMENT
   * le cône protégé de la sim — 120° frontaux (BLOCK_ARC_COS = cos 60°). Dessiné
   * chaque frame tant que l'entité bloque ; son SURGISSEMENT est le seul retour dont
   * le joueur ait besoin (« je pare »), aucune jauge. Rend enfin visible la moitié
   * défensive du combat de coût, longtemps câblée à `false` et donc muette.
   */
  guard(x: number, y: number, dx: number, dy: number): void
  /** À appeler une fois par frame AVANT les télégraphes : efface l'ardoise. */
  beginFrame(): void
  /**
   * Un coup a porté sur une cible (événement `entity_damaged`) : elle BLANCHIT et
   * RECULE d'un cheveu. `fromX/fromY` : d'où le coup venait — le recul part à l'opposé.
   */
  impact(sprite: Phaser.GameObjects.Image, now: number, fromX?: number, fromY?: number): void
  /**
   * LE RECUL PEINT, à appeler APRÈS que `SnapshotView.interpolate` a replacé les sprites
   * — c'est elle qui fait autorité sur la position, et elle repasse chaque frame.
   *
   * Le recul de combat existe dans la SIM (spec combat R4sexies) mais il est livré à
   * ZÉRO : mesuré, il défait l'encerclement de la meute (voir `COMBAT.KNOCKBACK_TILES`).
   * Le coup doit pourtant se SENTIR. On le peint donc ici, et ici seulement : quelques
   * pixels d'écart qui reviennent en 160 ms, sans qu'aucune position de sim ne bouge.
   * C'est la règle du fichier prise au mot — on peint par-dessus la vérité, on ne la
   * bouscule pas — et c'est ce qui permet au recul d'être un EFFET tant qu'il n'est pas
   * une RÈGLE.
   */
  peindreRecul(now: number): void
  /**
   * LE CORPS QUI CLIGNOTE, à appeler APRÈS `SnapshotView.interpolate`/`syncActor` — comme
   * `peindreRecul`, et pour la même raison : la vue REPOSE la teinte de chaque acteur à
   * chaque frame (l'espèce, le wind-up, le sommeil). Un flash appliqué plus tôt dans la
   * frame est effacé dans la même frame — MESURÉ au banc, ΔL de 0 sur le torse.
   */
  peindreBande(): void
  /** C'est MOI qui ai pris : l'écran saigne. */
  hurt(now: number): void
  /**
   * COMBIEN DE TRAITS SONT EN VOL — la seule fenêtre du harnais sur un FX éphémère.
   *
   * Un vol peint dure 200 ms ; le rendu logiciel de la machine de test tourne à quelques
   * images par seconde. Le trait naît et meurt donc ENTRE deux captures, et « je n'ai rien
   * vu » ne distingue pas « il n'y en a pas » de « j'ai regardé trop tard ». Le smoke LIT
   * cet état pour savoir quand figer la boucle — il ne le fabrique pas.
   */
  enVol(): number
  /**
   * L'ÉTAT DE LA BANDE À LA DERNIÈRE FRAME — `eclat` de 0 à 1 (l'éclat blanc en cours),
   * `pleine` quand la corde est à fond.
   *
   * Même raison d'être qu'`enVol` : un éclat dure quelques dizaines de millisecondes, donc
   * « je ne l'ai pas vu » ne distinguerait pas « il n'y en a pas » de « j'ai regardé entre
   * deux ». C'est ce qui permet de MESURER la cadence au lieu de l'affirmer — on compte les
   * fronts sur une seconde de bande à deux maturités différentes, et l'on vérifie qu'elle
   * accélère vraiment. Le smoke LIT cet état ; il ne le fabrique pas.
   */
  enBande(): { eclat: number; pleine: boolean }
  /** Entretient les fondus. */
  update(now: number): void
}

export function createAttackFx(scene: Phaser.Scene, depth: number): AttackFx {
  const blade = scene.add.graphics().setDepth(depth)
  const bleed = scene.add
    .rectangle(0, 0, scene.scale.width, scene.scale.height, BLEED, 0)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(depth + 1)

  let bleedAt = -1e9
  /** Les coups qui viennent de PARTIR : la zone claque une fois, puis s'éteint. */
  const slashes: { x: number; y: number; dx: number; dy: number; zone: Zone; at: number; charged: boolean }[] = []
  /** Les corps dont NOUS avons pris la teinte (le clignotement de bande) — pour ne rendre
   *  que ce qu'on a emprunté : `snapshot-view` en pose une autre, qu'on ne doit pas voler. */
  const clignotants = new Set<Phaser.GameObjects.Image>()
  /** Ce que la frame courante demande comme clignotement : appliqué en toute fin (voir
   *  `peindreBande`), parce que la vue repose les teintes après le télégraphe. */
  let aClignoter: { sprite: Phaser.GameObjects.Image; blanc: boolean } | null = null
  /** L'état de la bande à la dernière frame — lu par le harnais (voir `enBande`). */
  let bande = { eclat: 0, pleine: false }
  /** Les TRAITS en vol — peints, jamais simulés (spec `tir.md` T3). */
  const traits: { x: number; y: number; dx: number; dy: number; portee: number; at: number; charged: boolean }[] = []

  /** Le demi-angle RÉEL du cône, depuis le cosinus que porte la sim. `Math.acos` est
   *  interdit dans /sim (déterminisme) — ici, on est dans le rendu : il est chez lui. */
  const halfArcOf = (zone: Zone): number => (zone.arcCos <= -1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, zone.arcCos))))

  /** Les points du cône, au sol : le centre, puis le bord, écrasé en Y. */
  const arcPoints = (x: number, y: number, radius: number, angle: number, half: number): Phaser.Math.Vector2[] => {
    const pts = [new Vector2(x, y)]
    const N = 20
    for (let i = 0; i <= N; i++) {
      const a = angle - half + (2 * half * i) / N
      pts.push(new Vector2(x + Math.cos(a) * radius, y + Math.sin(a) * radius))
    }
    return pts
  }

  /**
   * LA ZONE, PEINTE AU SOL. Une seule fonction pour les quatre gestes du jeu, parce
   * que la sim n'en connaît que deux formes : un cône (le poing, le pic de lance, le
   * tourbillon à 360°) et un disque posé devant (l'overhead à deux mains).
   */
  const paintZone = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    zone: Zone,
    teinte: number,
    fillAlpha: number,
    lineAlpha: number,
    lineWidth: number,
  ): void => {
    if (zone.shape === 'disc') {
      const cx = x + dx * zone.range
      const cy = y + dy * zone.range
      blade.fillStyle(teinte, fillAlpha)
      blade.fillCircle(cx, cy, zone.radius)
      blade.lineStyle(lineWidth, teinte, lineAlpha)
      blade.strokeCircle(cx, cy, zone.radius)
      return
    }
    // Le TOURBILLON (360°) : un disque autour de soi. Un polygone à 360° s'ouvrirait
    // sur une couture disgracieuse au dos de l'avatar — le cercle n'en a pas.
    if (zone.arcCos <= -1) {
      blade.fillStyle(teinte, fillAlpha)
      blade.fillCircle(x, y, zone.range)
      blade.lineStyle(lineWidth, teinte, lineAlpha)
      blade.strokeCircle(x, y, zone.range)
      return
    }
    const pts = arcPoints(x, y, zone.range, Math.atan2(dy, dx), halfArcOf(zone))
    blade.fillStyle(teinte, fillAlpha)
    blade.fillPoints(pts, true)
    blade.lineStyle(lineWidth, teinte, lineAlpha)
    blade.strokePoints(pts, true)
  }

  /**
   * ═══ LE TÉLÉGRAPHE D'UN TIR EST UNE LIGNE (décision d'Alexis, 2026-08-02) ═══
   *
   * Un cône marchait tant que l'arc portait à onze tuiles. À TRENTE-TROIS, le même cône
   * devient une nappe blanche de 530 px en travers de l'écran : elle recouvre le décor,
   * la cible, et jusqu'à la moitié des corps alentour. Elle dirait « je tire par là »
   * aussi mal que possible.
   *
   * Une LIGNE dit exactement la même chose et n'en cache rien : d'où part le trait, où
   * il retombe. On ajoute le seul détail que la ligne ne porte pas — un MARQUEUR au point
   * de chute, parce que c'est lui qu'on vise et qu'à trente tuiles il est hors de l'écran
   * aussi souvent qu'il y est.
   *
   * La règle du fichier tient : la ligne est la MÉDIANE exacte du cône que la sim frappe,
   * et le marqueur a le rayon que le cône couvre à cette distance (`range × sin θ`, la
   * demi-largeur réelle au point de chute). On ne dessine rien qu'on ne frappe pas.
   */
  const paintLigne = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    zone: Zone,
    teinte: number,
    alpha: number,
    width: number,
  ): void => {
    const bx = x + dx * zone.range
    const by = y + dy * zone.range
    blade.lineStyle(width, teinte, alpha)
    blade.beginPath()
    blade.moveTo(x, y)
    blade.lineTo(bx, by)
    blade.strokePath()
    // La demi-largeur RÉELLE au point de chute : sin θ depuis le cosinus que porte la sim.
    const sinTheta = Math.sqrt(Math.max(0, 1 - zone.arcCos * zone.arcCos))
    const r = Math.max(3, zone.range * sinTheta)
    blade.lineStyle(width, teinte, alpha * 0.85)
    blade.strokeCircle(bx, by, r)
  }

  /**
   * LE GESTE, par-dessus la zone. C'est lui qui dit « dans combien de temps », sans
   * qu'on ait à compter les frames — et il est DIFFÉRENT selon l'arme, parce que la
   * géométrie l'impose : un cône fin ne se balaie pas, il s'ENFONCE ; un cône large
   * se BALAIE ; un tour complet TOURNE ; un disque s'ÉCRASE.
   */
  const paintGesture = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    zone: Zone,
    progress: number,
    teinte: number,
    alpha: number,
    side: 1 | -1,
  ): void => {
    const angle = Math.atan2(dy, dx)
    if (zone.shape === 'disc') {
      // L'OVERHEAD : un cercle qui se REFERME sur le point d'impact. Les deux poings
      // tombent — le geste va vers le sol, pas vers les côtés.
      const cx = x + dx * zone.range
      const cy = y + dy * zone.range
      const r = zone.radius * (2.1 - 1.1 * progress)
      blade.lineStyle(2.5, teinte, alpha)
      blade.strokeCircle(cx, cy, r)
      return
    }
    const half = halfArcOf(zone)
    if (half < THRUST_HALF_ARC) {
      // LE PIC : il ne balaie rien, il S'ALLONGE. C'est ce qui rend la lance lisible
      // d'un coup d'œil — et ce qui fait sentir l'allonge avant même qu'elle serve.
      const len = zone.range * (0.35 + 0.65 * progress)
      blade.lineStyle(3, teinte, alpha)
      blade.beginPath()
      blade.moveTo(x, y)
      blade.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
      blade.strokePath()
      return
    }
    // LE BALAYAGE : la lame part d'un bord et arrive à l'autre à l'échéance. `side`
    // décide du sens — c'est le pied qui part, et deux coups d'affilée ne balaient
    // donc pas du même côté.
    const a = angle + side * (-half + 2 * half * progress)
    blade.lineStyle(2.5, teinte, alpha)
    blade.beginPath()
    blade.moveTo(x, y)
    blade.lineTo(x + Math.cos(a) * zone.range, y + Math.sin(a) * zone.range)
    blade.strokePath()
  }
  /** Les sprites qui encaissent : sprite → instant du coup et AXE du recul (px monde,
   *  unitaire, orienté à l'opposé du frappeur). L'axe est nul quand on ignore d'où le
   *  coup venait — on blanchit alors sans reculer, plutôt que de reculer au hasard. */
  const impacts = new Map<Phaser.GameObjects.Image, { at: number; rx: number; ry: number }>()
  /** Amplitude du recul peint, en px monde. Trois pixels sur une tuile de seize : on le
   *  SENT sans que le corps quitte sa case — un recul qui déplace vraiment est une règle,
   *  et les règles vivent dans /sim. */
  const RECUL_PX = 3

  /** Le banc d'étincelles et de chiffres — RÉUTILISÉS. Créer/détruire des objets
   *  Phaser à chaque coup, c'est le chemin le plus court vers un combat qui hoquette
   *  exactement quand il ne faut pas. */
  const POOL = 12
  const sparks = Array.from({ length: POOL }, () => ({
    star: scene.add.star(0, 0, 5, 3, 9, SPARK).setDepth(depth).setVisible(false),
    text: scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: HIT_MINE, stroke: '#14141a', strokeThickness: 4 })
      .setOrigin(0.5, 1)
      .setDepth(depth)
      .setVisible(false),
    at: -1e9,
    y0: 0,
  }))
  let next = 0

  /**
   * LA GERBE — une poignée de brisures qui jaillissent du point d'impact, À L'OPPOSÉ
   * du frappeur. C'est le signe le plus court du jeu : avant le chiffre, avant la
   * teinte, la gerbe dit « ça a porté » et dit d'OÙ. Poolée comme le reste : une
   * mêlée ne doit pas allouer.
   *
   * L'ouverture du cône (±35°) et la vitesse VARIENT d'un éclat à l'autre — une gerbe
   * dont tous les brins partent à la même vitesse lit comme un objet unique qui se
   * déplace, pas comme une matière qui éclate.
   */
  const GERBE_MS = 280
  const GERBE_POOL = 36
  /** Combien d'éclats pour un coup, du plus faible au plus lourd. Un coup de 6 (les
   *  poings) en projette 3, un tourbillon à 32 en projette 8 : la gerbe DIT le poids. */
  const gerbeCount = (amount: number): number => Math.max(3, Math.min(8, 2 + Math.round(amount / 5)))
  const shards = Array.from({ length: GERBE_POOL }, () => ({
    g: scene.add.rectangle(0, 0, 2, 2, BLEED).setDepth(depth).setVisible(false),
    at: -1e9,
    x0: 0,
    y0: 0,
    vx: 0,
    vy: 0,
  }))
  let nextShard = 0

  return {
    /**
     * L'IMPACT, au point où il a eu lieu : une étincelle brève, et LE CHIFFRE qui
     * monte. Le chiffre n'est pas du bruit — c'est la seule façon de savoir si son
     * épieu vaut mieux que ses poings, et si le loup est à trois coups ou à dix.
     */
    spark(x, y, amount, onMe, now, fromX, fromY, brisures) {
      // LA GERBE D'ABORD (elle part sous l'étincelle). Elle exige de savoir d'où vient
      // le coup : sans origine, on ne projette rien plutôt que de projeter au hasard.
      // `brisures === null` : la cible est de CHAIR — son sang gicle dans `sang-fx`,
      // les brisures de matière n'ont rien à faire là.
      if (brisures !== null && fromX !== undefined && fromY !== undefined) {
        const ex = x - fromX
        const ey = y - fromY
        const len = Math.sqrt(ex * ex + ey * ey)
        // Coup porté à bout touchant (frappeur et frappé confondus) : pas d'axe, pas de gerbe.
        if (len > 0.001) {
          const base = Math.atan2(ey / len, ex / len)
          const n = gerbeCount(amount)
          const palette = brisures ?? [BLEED]
          for (let i = 0; i < n; i++) {
            const sh = shards[nextShard]!
            nextShard = (nextShard + 1) % GERBE_POOL
            // Réparti dans le cône, plus un grain d'irrégularité : une gerbe régulière
            // lit comme un éventail dessiné, pas comme de la matière arrachée.
            const a = base + (-0.61 + (1.22 * (i + 0.5)) / n) + (Math.random() - 0.5) * 0.25
            const v = 34 + Math.random() * 46
            sh.at = now
            sh.x0 = x
            sh.y0 = y - 8
            sh.vx = Math.cos(a) * v
            sh.vy = Math.sin(a) * v
            sh.g.setFillStyle(palette[i % palette.length]!)
            sh.g.setPosition(sh.x0, sh.y0).setVisible(true).setAlpha(1)
          }
        }
      }
      const s = sparks[next]!
      next = (next + 1) % POOL
      s.at = now
      s.y0 = y - 18
      s.star.setPosition(x, y - 18).setVisible(true).setAlpha(1).setScale(1)
      // `amount = 0` = une mise à mort : l'étincelle claque, mais AUCUN chiffre.
      // Afficher « 0 » (ou pire, « 1 ») mentirait sur ce qui vient de se passer.
      const chiffre = Math.round(amount)
      s.text
        .setText(chiffre > 0 ? String(chiffre) : '')
        .setColor(onMe ? HIT_THEIRS : HIT_MINE)
        .setPosition(x, y - 22)
        .setVisible(chiffre > 0)
        .setAlpha(1)
    },

    beginFrame() {
      // La bande de la frame d'avant s'oublie ici, avec le reste de l'ardoise : sans ça,
      // relâcher l'arc laisserait le harnais croire qu'on bande encore.
      bande = { eclat: 0, pleine: false }
      blade.clear()
    },

    /**
     * LE COUP QUI S'ARME. La ZONE RÉELLE de la sim, posée au sol, écrasée en Y pour
     * qu'elle se lise à plat (c'est une vue de dessus, pas une coupe) — et par-dessus,
     * LE GESTE qui la parcourt : on lit la menace ET son échéance sans compter une
     * seule frame. Un coup CHARGÉ se peint plus fort : il ne se confond pas avec un
     * coup simple, sans quoi la charge serait un secret bien gardé.
     */
    telegraph(x, y, dx, dy, progress, zone, mine, side, charged, ranged) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      const teinte = mine ? BLADE : THREAT
      if (ranged === true) {
        // LE TRAIT EST PARTI DE L'ARC, il ne balaie rien : pas de geste, pas de zone —
        // une ligne qui se charge à mesure que l'armement s'achève, et c'est tout.
        paintLigne(x, y, dx, dy, zone, teinte, 0.45 + 0.5 * progress, 2)
        return
      }
      const lourd = charged ? 1.6 : 1
      paintZone(
        x,
        y,
        dx,
        dy,
        zone,
        teinte,
        ((mine ? 0.06 : 0.1) + 0.16 * progress) * lourd,
        Math.min(1, (0.25 + 0.5 * progress) * lourd),
        (mine ? 1.5 : 2) * lourd,
      )
      paintGesture(x, y, dx, dy, zone, progress, teinte, Math.min(1, (0.55 + 0.45 * progress) * lourd), side)
    },

    /**
     * LE COUP QUI MÛRIT. Tant que le clic tient, on peint la zone qui partirait MAINTENANT
     * — et elle change de forme à maturité. Le contour PULSE une fois mûr : c'est le
     * « c'est prêt » qu'on doit sentir sans quitter le loup des yeux.
     */
    charge(x, y, dx, dy, ratio, zone, mine, now, ranged, sprite) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      const teinte = mine ? BLADE : THREAT
      const mur = ratio >= 1

      if (ranged !== true) {
        // La mêlée, inchangée : la zone qui partirait MAINTENANT, et son battement à
        // maturité — un coup lourd qu'on retient, pas un clignotant.
        const pulse = mur ? 0.72 + 0.28 * Math.sin(now / 90) : 0
        paintZone(x, y, dx, dy, zone, teinte, mur ? 0.14 + 0.06 * pulse : 0.03 + 0.05 * ratio, mur ? 0.55 + 0.45 * pulse : 0.12 + 0.28 * ratio, mur ? 3 : 1.5)
        return
      }

      // ─── L'ARC ───
      // La LIGNE montre la portée ATTEINTE, qui s'allonge avec la bande (la sim
      // l'interpole ; on ne fait que dessiner ce qu'elle rend). C'est le seul retour qui
      // dise « jusqu'où, maintenant » — et il s'allonge sous les yeux du joueur.
      bande = { eclat: 0, pleine: mur }
      if (!mur) {
        // ═══ C'EST LE CORPS QUI CLIGNOTE (décision d'Alexis, 2026-08-02) ═══
        //
        // L'anneau au sol disait la même chose, mais AILLEURS que là où l'œil se pose :
        // on regarde sa cible et sa silhouette, pas le gazon sous ses pieds. Le corps
        // blanchit donc en entier — `setTintFill`, une silhouette pleine, impossible à
        // rater du coin de l'œil — à une cadence qui accélère avec la bande.
        const eclat = eclatAt(now, ratio)
        bande = { eclat, pleine: false }
        if (sprite) aClignoter = { sprite, blanc: eclat > 0.45 }
        paintLigne(x, y, dx, dy, zone, teinte, 0.25 + 0.35 * ratio + 0.25 * eclat, 1.5)
        return
      }

      // ─── À FOND : LE CORPS CESSE DE CLIGNOTER, LA LIGNE SE POSE ───
      //
      // Le signal change de NATURE, pas d'intensité — c'est ce qui le rend impossible à
      // confondre avec « presque prêt ». Le clignotement s'arrête net (on rend sa teinte
      // au corps) et la ligne de tir devient PLEINE, avec sa cible qui respire au point
      // de chute. Clignoter plus vite encore aurait dit « ça continue de monter ».
      if (sprite) aClignoter = { sprite, blanc: false }
      const souffle = 0.85 + 0.15 * Math.sin(now / 110)
      paintLigne(x, y, dx, dy, zone, 0xffffff, 0.95 * souffle, 2.5)
    },

    slash(x, y, dx, dy, zone, now, charged) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      slashes.push({ x, y, dx, dy, zone, at: now, charged })
      if (slashes.length > 8) slashes.shift() // borné : une mêlée n'est pas un feu d'artifice
    },

    trait(x, y, dx, dy, portee, now, charged) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      traits.push({ x, y, dx: dx / len, dy: dy / len, portee, at: now, charged })
      if (traits.length > 12) traits.shift()
    },

    impact(sprite, now, fromX, fromY) {
      let rx = 0
      let ry = 0
      if (fromX !== undefined && fromY !== undefined) {
        const ex = sprite.x - fromX
        const ey = sprite.y - fromY
        const len = Math.sqrt(ex * ex + ey * ey)
        if (len > 0.001) {
          rx = ex / len
          ry = ey / len
        }
      }
      impacts.set(sprite, { at: now, rx, ry })
      // `setTint` (et non `setTintFill`) : la bête garde sa silhouette et vire au
      // rouge — un aplat plein en ferait un carré de couleur, illisible.
      sprite.setTint(IMPACT_TINT)
    },

    /**
     * LE RECUL PEINT. Il part FORT et revient — course en (1−t)², donc l'écart est
     * maximal à l'instant du coup et se résorbe : c'est un ENCAISSEMENT, pas un
     * déplacement. Appelé après `interpolate`, qui vient de reposer la position vraie ;
     * on ne fait qu'ajouter un écart d'affichage que la frame suivante efface.
     */
    peindreBande() {
      const demande = aClignoter
      aClignoter = null
      if (demande?.blanc === true) {
        // PHASER 4 A RETIRÉ `setTintFill(couleur)` — il le dit en console, et c'est le
        // smoke qui l'a rapporté. La teinte et le MODE se posent séparément : `setTint`
        // pour la couleur, `setTintMode(FILL)` pour l'aplat qui remplace la silhouette.
        demande.sprite.setTint(0xffffff)
        demande.sprite.setTintMode(Phaser.TintModes.FILL)
        clignotants.add(demande.sprite)
        return
      }
      // On ne rend la teinte QUE si c'est nous qui l'avons prise : la vue en pose une
      // (l'espèce, le wind-up, le sommeil), et l'effacer à l'aveugle la volerait.
      //
      // ET ON REMET LE MODE : `clearTint` efface la COULEUR, pas le mode. Laisser FILL
      // derrière soi rendrait toutes les teintes suivantes de ce corps en aplat — l'espèce
      // d'une bête, la marque d'un wind-up — c'est-à-dire une silhouette pleine à la place
      // du sprite, indéfiniment.
      for (const sprite of clignotants) {
        sprite.clearTint()
        sprite.setTintMode(Phaser.TintModes.MULTIPLY)
      }
      clignotants.clear()
    },

    peindreRecul(now) {
      for (const [sprite, imp] of impacts) {
        const t = (now - imp.at) / IMPACT_MS
        if (t < 0 || t >= 1) continue
        const k = (1 - t) * (1 - t)
        sprite.setPosition(sprite.x + imp.rx * RECUL_PX * k, sprite.y + imp.ry * RECUL_PX * k)
      }
    },

    hurt(now) {
      bleedAt = now
    },

    enVol() {
      return traits.length
    },

    enBande() {
      return bande
    },

    guard(x, y, dx, dy) {
      const len = Math.sqrt(dx * dx + dy * dy)
      const angle = len < 0.0001 ? 0 : Math.atan2(dy, dx)
      const half = Math.PI / 3 // 60° de demi-arc → 120° frontaux, exactement BLOCK_ARC_COS
      // `arcPoints` rend [centre, ...bord], DÉJÀ écrasé au sol (même plan que les zones).
      const pts = arcPoints(x, y, GUARD_R, angle, half)
      blade.fillStyle(GUARD, 0.13)
      blade.fillPoints(pts, true)
      // Le BORD du bouclier, net et vif : c'est lui qu'on lit. `slice(1)` retire le
      // centre pour ne tracer que l'arc (un trait ouvert, jamais refermé en triangle).
      blade.lineStyle(2.5, GUARD, 0.85)
      blade.strokePoints(pts.slice(1), false)
    },

    update(now) {
      // LE COUP PARTI : la zone claque, blanche, et s'éteint en 130 ms. C'est le seul
      // retour qui dit « ça y est » — y compris quand on frappe dans le vide, ce que
      // le joueur DOIT sentir (un coup manqué coûte de l'endurance, et le RATÉ le cloue
      // sur place le temps d'une récupération punitive : il faut qu'il le voie venir).
      for (let i = slashes.length - 1; i >= 0; i--) {
        const s = slashes[i]!
        const k = 1 - (now - s.at) / (s.charged ? SLASH_MS * 1.6 : SLASH_MS)
        if (k <= 0) {
          slashes.splice(i, 1)
          continue
        }
        paintZone(s.x, s.y, s.dx, s.dy, s.zone, 0xffffff, (s.charged ? 0.55 : 0.35) * k, 0.5 * k, s.charged ? 3 : 2)
      }

      // ═══ LE TRAIT EN VOL (spec `tir.md` T3) ═══
      //
      // Il n'existe QUE là : aucune position de sim n'en dépend, la résolution a déjà eu
      // lieu au terme de l'armement. On ne peint donc pas une flèche « qui va toucher » —
      // on peint le SOUVENIR immédiat d'un coup déjà tranché. C'est exactement le statut
      // du recul de R4sexies, dans ce même fichier.
      //
      // UNE TÊTE ET UNE TRAÎNE, et c'est la traîne qui fait le travail : à onze tuiles on
      // ne voit pas toujours le tireur, et une flèche isolée ne dirait pas D'OÙ elle vient.
      // La traîne écrit la ligne de tir dans l'air pendant un cinquième de seconde — c'est
      // l'information qui permet de se mettre à couvert au tir SUIVANT.
      for (let i = traits.length - 1; i >= 0; i--) {
        const tr = traits[i]!
        const t = (now - tr.at) / TRAIT_MS
        if (t >= 1 || t < 0) {
          traits.splice(i, 1)
          continue
        }
        // La flèche ne DÉCÉLÈRE pas : un trait qui ralentit se lit comme un objet qu'on
        // pourrait rattraper, et on ne rattrape pas une flèche.
        const tete = tr.portee * t
        const hx = tr.x + tr.dx * tete
        const hy = tr.y + tr.dy * tete
        const corps = tr.charged ? TRAIT_PX : TRAIT_PX * 0.75
        const fondu = 1 - t * t // pleine vigueur au départ, éteinte à l'arrivée
        // LA TRAÎNE, de l'origine jusqu'à la queue du trait. Réglée À L'ŒIL sur capture
        // (0,10 était invisible sur l'herbe) : c'est elle qui écrit la LIGNE DE TIR dans
        // l'air, et donc la seule information exploitable quand on encaisse une flèche
        // venue d'un tireur qu'on ne voit pas — celle qui dit où se mettre à couvert.
        blade.lineStyle(tr.charged ? 2 : 1.5, BLADE, 0.24 * fondu)
        blade.beginPath()
        blade.moveTo(tr.x, tr.y)
        blade.lineTo(hx - tr.dx * corps, hy - tr.dy * corps)
        blade.strokePath()
        // La flèche elle-même — nette, courte, et plus vive si le tir était bandé.
        blade.lineStyle(tr.charged ? 3 : 2, BLADE, (tr.charged ? 1 : 0.8) * fondu)
        blade.beginPath()
        blade.moveTo(hx - tr.dx * corps, hy - tr.dy * corps)
        blade.lineTo(hx, hy)
        blade.strokePath()
        // L'ÉCLAT DE DÉPART : la corde qui claque, à l'arc, sur le premier tiers du vol.
        // C'est lui qui fait qu'un tir se SENT partir — sans quoi la flèche apparaît déjà
        // au loin, et le geste n'a pas d'instant. Il meurt vite : c'est un claquement.
        if (t < 0.34) {
          const eclat = 1 - t / 0.34
          blade.fillStyle(BLADE, 0.5 * eclat)
          blade.fillCircle(tr.x, tr.y, (tr.charged ? 5 : 3.5) * eclat)
        }
      }

      // LA GERBE RETOMBE. Elle DÉCÉLÈRE (course en 1−(1−t)²) et pique légèrement du
      // nez : de la matière arrachée part vite et meurt vite. À vitesse constante,
      // les brisures liraient comme des projectiles, pas comme un éclaboussement.
      for (const sh of shards) {
        const t = (now - sh.at) / GERBE_MS
        if (t >= 1 || t < 0) {
          if (sh.g.visible) sh.g.setVisible(false)
          continue
        }
        const k = 1 - (1 - t) * (1 - t)
        const s = GERBE_MS / 1000
        sh.g.setPosition(sh.x0 + sh.vx * k * s, sh.y0 + sh.vy * k * s + 9 * t * t)
        sh.g.setAlpha(1 - t)
      }

      // L'écran saigne, puis se calme. Ressenti avant d'être lu.
      const sang = 1 - (now - bleedAt) / BLEED_MS
      bleed.setAlpha(sang > 0 ? 0.35 * sang : 0)

      for (const s of sparks) {
        const dt = now - s.at
        if (dt > NUMBER_MS) {
          s.star.setVisible(false)
          s.text.setVisible(false)
          continue
        }
        // L'étincelle claque et meurt ; le chiffre, lui, MONTE et s'efface — il a
        // le temps d'être lu, elle a le temps d'être sentie.
        const kEtincelle = 1 - dt / SPARK_MS
        s.star.setVisible(kEtincelle > 0)
        if (kEtincelle > 0) s.star.setAlpha(kEtincelle).setScale(0.6 + 1.4 * (1 - kEtincelle))
        const k = 1 - dt / NUMBER_MS
        if (s.text.text !== '') s.text.setAlpha(Math.min(1, k * 1.6)).setY(s.y0 - 4 - 26 * (1 - k))
      }

      for (const [sprite, imp] of impacts) {
        if (now - imp.at < IMPACT_MS) continue
        // On rend la teinte au sprite : `snapshot-view` la repose de toute façon au
        // snapshot suivant (elle encode le wind-up et l'espèce) — on ne fait donc
        // que lever le voile rouge, sans lui voler son état.
        sprite.clearTint()
        impacts.delete(sprite)
      }
    },
  }
}
