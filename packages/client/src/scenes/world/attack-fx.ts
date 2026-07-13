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
 * Corollaire : AUCUN effet ne touche la simulation. Pas de hit-stop qui gèle le
 * tick, pas de recul qui déplace l'avatar — la position est autoritative. On peint
 * par-dessus la vérité ; on ne la bouscule pas.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Phaser from 'phaser'
import { FONT } from '../ui/typography'

const Vector2 = Phaser.Math.Vector2

/** Durées, en ms. Courtes : un retour de frappe qui traîne devient de la soupe. */
const IMPACT_MS = 160
const BLEED_MS = 260
const SPARK_MS = 220
const NUMBER_MS = 620

const BLADE = 0xf0e6d2
const IMPACT_TINT = 0xff8877
const BLEED = 0xc0503e
const SPARK = 0xffe9b0
/** L'arc d'un ENNEMI : rouge. Celui qui vient vers vous ne se lit pas comme le vôtre. */
const THREAT = 0xe0553f

/** Écrasement vertical : le jeu est vu de DESSUS. Un arc rond se lirait comme une
 *  bulle plantée dans le dos de l'avatar ; écrasé, il se pose au sol. */
const GROUND_SQUASH = 0.55
const SLASH_MS = 130
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
  /** L'ÉTINCELLE et le CHIFFRE, au point d'impact (événement `entity_damaged`). */
  spark(x: number, y: number, amount: number, onMe: boolean, now: number): void
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
  ): void
  /**
   * LA CHARGE : le clic est enfoncé, le coup MÛRIT. On dessine la zone qui partirait
   * SI ON RELÂCHAIT MAINTENANT — donc elle CHANGE au moment où la charge est mûre
   * (le cône devient tourbillon, le poing devient disque). Ce basculement EST le
   * signal « c'est prêt » : aucune jauge à lire, la forme le dit.
   */
  charge(x: number, y: number, dx: number, dy: number, ratio: number, zone: Zone, mine: boolean, now: number): void
  /** LE COUP PART : la zone claque, une fois. Déclenché quand le wind-up s'achève. */
  slash(x: number, y: number, dx: number, dy: number, zone: Zone, now: number, charged: boolean): void
  /** À appeler une fois par frame AVANT les télégraphes : efface l'ardoise. */
  beginFrame(): void
  /** Un coup a porté sur une cible (événement `entity_damaged`). */
  impact(sprite: Phaser.GameObjects.Image, now: number): void
  /** C'est MOI qui ai pris : l'écran saigne. */
  hurt(now: number): void
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

  /** Le demi-angle RÉEL du cône, depuis le cosinus que porte la sim. `Math.acos` est
   *  interdit dans /sim (déterminisme) — ici, on est dans le rendu : il est chez lui. */
  const halfArcOf = (zone: Zone): number => (zone.arcCos <= -1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, zone.arcCos))))

  /** Les points du cône, au sol : le centre, puis le bord, écrasé en Y. */
  const arcPoints = (x: number, y: number, radius: number, angle: number, half: number): Phaser.Math.Vector2[] => {
    const pts = [new Vector2(x, y)]
    const N = 20
    for (let i = 0; i <= N; i++) {
      const a = angle - half + (2 * half * i) / N
      pts.push(new Vector2(x + Math.cos(a) * radius, y + Math.sin(a) * radius * GROUND_SQUASH))
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
      const cy = y + dy * zone.range * GROUND_SQUASH
      blade.fillStyle(teinte, fillAlpha)
      blade.fillEllipse(cx, cy, zone.radius * 2, zone.radius * 2 * GROUND_SQUASH)
      blade.lineStyle(lineWidth, teinte, lineAlpha)
      blade.strokeEllipse(cx, cy, zone.radius * 2, zone.radius * 2 * GROUND_SQUASH)
      return
    }
    // Le TOURBILLON (360°) : un disque autour de soi. Un polygone à 360° s'ouvrirait
    // sur une couture disgracieuse au dos de l'avatar — l'ellipse n'en a pas.
    if (zone.arcCos <= -1) {
      blade.fillStyle(teinte, fillAlpha)
      blade.fillEllipse(x, y, zone.range * 2, zone.range * 2 * GROUND_SQUASH)
      blade.lineStyle(lineWidth, teinte, lineAlpha)
      blade.strokeEllipse(x, y, zone.range * 2, zone.range * 2 * GROUND_SQUASH)
      return
    }
    const pts = arcPoints(x, y, zone.range, Math.atan2(dy, dx), halfArcOf(zone))
    blade.fillStyle(teinte, fillAlpha)
    blade.fillPoints(pts, true)
    blade.lineStyle(lineWidth, teinte, lineAlpha)
    blade.strokePoints(pts, true)
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
      const cy = y + dy * zone.range * GROUND_SQUASH
      const r = zone.radius * (2.1 - 1.1 * progress)
      blade.lineStyle(2.5, teinte, alpha)
      blade.strokeEllipse(cx, cy, r * 2, r * 2 * GROUND_SQUASH)
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
      blade.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len * GROUND_SQUASH)
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
    blade.lineTo(x + Math.cos(a) * zone.range, y + Math.sin(a) * zone.range * GROUND_SQUASH)
    blade.strokePath()
  }
  /** Les sprites qui encaissent : id Phaser → instant du coup. */
  const impacts = new Map<Phaser.GameObjects.Image, number>()

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

  return {
    /**
     * L'IMPACT, au point où il a eu lieu : une étincelle brève, et LE CHIFFRE qui
     * monte. Le chiffre n'est pas du bruit — c'est la seule façon de savoir si son
     * épieu vaut mieux que ses poings, et si le loup est à trois coups ou à dix.
     */
    spark(x, y, amount, onMe, now) {
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
      blade.clear()
    },

    /**
     * LE COUP QUI S'ARME. La ZONE RÉELLE de la sim, posée au sol, écrasée en Y pour
     * qu'elle se lise à plat (c'est une vue de dessus, pas une coupe) — et par-dessus,
     * LE GESTE qui la parcourt : on lit la menace ET son échéance sans compter une
     * seule frame. Un coup CHARGÉ se peint plus fort : il ne se confond pas avec un
     * coup simple, sans quoi la charge serait un secret bien gardé.
     */
    telegraph(x, y, dx, dy, progress, zone, mine, side, charged) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      const teinte = mine ? BLADE : THREAT
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
    charge(x, y, dx, dy, ratio, zone, mine, now) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      const teinte = mine ? BLADE : THREAT
      const mur = ratio >= 1
      // Le battement : lent, sourd — un coup lourd qu'on retient, pas un clignotant.
      const pulse = mur ? 0.72 + 0.28 * Math.sin(now / 90) : 0
      paintZone(x, y, dx, dy, zone, teinte, mur ? 0.14 + 0.06 * pulse : 0.03 + 0.05 * ratio, mur ? 0.55 + 0.45 * pulse : 0.12 + 0.28 * ratio, mur ? 3 : 1.5)
    },

    slash(x, y, dx, dy, zone, now, charged) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      slashes.push({ x, y, dx, dy, zone, at: now, charged })
      if (slashes.length > 8) slashes.shift() // borné : une mêlée n'est pas un feu d'artifice
    },

    impact(sprite, now) {
      impacts.set(sprite, now)
      // `setTint` (et non `setTintFill`) : la bête garde sa silhouette et vire au
      // rouge — un aplat plein en ferait un carré de couleur, illisible.
      sprite.setTint(IMPACT_TINT)
    },

    hurt(now) {
      bleedAt = now
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

      for (const [sprite, at] of impacts) {
        if (now - at < IMPACT_MS) continue
        // On rend la teinte au sprite : `snapshot-view` la repose de toute façon au
        // snapshot suivant (elle encode le wind-up et l'espèce) — on ne fait donc
        // que lever le voile rouge, sans lui voler son état.
        sprite.clearTint()
        impacts.delete(sprite)
      }
    },
  }
}
