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

/** L'arc RÉEL de la sim : ±45° (COMBAT.ATTACK_ARC_COS = cos 45°). On ne l'invente
 *  pas — un télégraphe qui ment sur sa portée apprend une règle qui n'existe pas. */
const HALF_ARC = Math.PI / 4
/** Écrasement vertical : le jeu est vu de DESSUS. Un arc rond se lirait comme une
 *  bulle plantée dans le dos de l'avatar ; écrasé, il se pose au sol. */
const GROUND_SQUASH = 0.55
const SLASH_MS = 130
/** Le chiffre : blanc quand je frappe, rouge quand j'encaisse. On lit l'issue d'un
 *  combat à la COULEUR, avant même d'avoir lu le nombre. */
const HIT_MINE = '#ffffff'
const HIT_THEIRS = '#ff6b5a'

export interface AttackFx {
  /** L'ÉTINCELLE et le CHIFFRE, au point d'impact (événement `entity_damaged`). */
  spark(x: number, y: number, amount: number, onMe: boolean, now: number): void
  /**
   * L'ARC qu'une entité s'apprête à frapper (lu du snapshot). `radius` en px monde.
   * `mine` : le MIEN se peint en crème, celui d'un ENNEMI en ROUGE. Ce n'est pas
   * une coquetterie — c'est l'information la plus chère du combat : on doit voir OÙ
   * LE LOUP VA MORDRE, et savoir en un coup d'œil si l'arc au sol est une menace ou
   * sa propre portée.
   */
  telegraph(x: number, y: number, dx: number, dy: number, progress: number, radius: number, mine: boolean): void
  /** LE COUP PART : l'arc claque, une fois. Déclenché quand le wind-up s'achève. */
  slash(x: number, y: number, dx: number, dy: number, radius: number, now: number): void
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
  /** Les coups qui viennent de PARTIR : l'arc claque une fois, puis s'éteint. */
  const slashes: { x: number; y: number; angle: number; radius: number; at: number }[] = []

  /** Les points de l'arc, au sol : le centre, puis le bord, écrasé en Y. */
  const arcPoints = (x: number, y: number, radius: number, angle: number): Phaser.Math.Vector2[] => {
    const pts = [new Vector2(x, y)]
    const N = 14
    for (let i = 0; i <= N; i++) {
      const a = angle - HALF_ARC + (2 * HALF_ARC * i) / N
      pts.push(new Vector2(x + Math.cos(a) * radius, y + Math.sin(a) * radius * GROUND_SQUASH))
    }
    return pts
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
     * L'ARME QUI S'ARME. Un trait épais, du poing vers la cible, qui GRANDIT avec
     * le wind-up : à sa naissance il est court et pâle, à l'échéance il est long et
     * franc. On lit la MENACE dans sa longueur — c'est ce qui rend un télégraphe
     * lisible sans qu'on ait à compter les frames.
     */
    telegraph(x, y, dx, dy, progress, radius, mine) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      const angle = Math.atan2(dy, dx)
      const teinte = mine ? BLADE : THREAT

      // L'ARC RÉEL de la sim : ±45° autour de la visée, jusqu'à `radius`. On l'écrase
      // verticalement (GROUND_SQUASH) pour qu'il se lise POSÉ AU SOL et non planté
      // dans le dos de l'avatar — c'est une vue de dessus, pas une coupe.
      const pts = arcPoints(x, y, radius, angle)
      blade.fillStyle(teinte, (mine ? 0.06 : 0.1) + 0.16 * progress)
      blade.fillPoints(pts, true)
      blade.lineStyle(mine ? 1.5 : 2, teinte, 0.25 + 0.5 * progress)
      blade.strokePoints(pts, true)

      // LA LAME BALAIE l'arc pendant l'armement : elle part d'un bord et arrive à
      // l'autre à l'échéance. C'est ce qui dit « dans combien de temps », sans qu'on
      // ait à compter les frames — et c'est un GESTE, pas un trait qui pousse.
      const a = angle - HALF_ARC + 2 * HALF_ARC * progress
      blade.lineStyle(2.5, teinte, 0.55 + 0.45 * progress)
      blade.beginPath()
      blade.moveTo(x, y)
      blade.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius * GROUND_SQUASH)
      blade.strokePath()
    },

    slash(x, y, dx, dy, radius, now) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      slashes.push({ x, y, angle: Math.atan2(dy, dx), radius, at: now })
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
      // LE COUP PARTI : l'arc claque, blanc, et s'éteint en 130 ms. C'est le seul
      // retour qui dit « ça y est » — y compris quand on frappe dans le vide, ce que
      // le joueur DOIT sentir (un coup manqué coûte de l'endurance).
      for (let i = slashes.length - 1; i >= 0; i--) {
        const s = slashes[i]!
        const k = 1 - (now - s.at) / SLASH_MS
        if (k <= 0) {
          slashes.splice(i, 1)
          continue
        }
        const pts = arcPoints(s.x, s.y, s.radius, s.angle)
        blade.fillStyle(0xffffff, 0.35 * k)
        blade.fillPoints(pts, true)
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
