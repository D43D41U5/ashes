/**
 * LE COMBAT SE VOIT (spec `client.md`, GDD §7 : wind-ups de 300-500 ms).
 *
 * Il ne se voyait PAS. On frappait, la sim résolvait, et l'écran ne disait rien :
 * ni le geste, ni l'impact, ni le coup reçu. Un système de combat entier, invisible.
 * Un joueur qui ne voit pas ses coups ne joue pas — il clique en espérant.
 *
 * Trois signes, et trois seulement :
 *
 *   1. LE TÉLÉGRAPHE — l'arme s'arme. C'est le cœur du combat du GDD (« un combat
 *      de coût, pas de skill pur ») : on doit VOIR venir le coup, le sien comme
 *      celui d'en face. Il vient du `windup` du SNAPSHOT, jamais du clic : le
 *      client ne devine pas, il montre ce que la sim a décidé (invariant §3).
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
import type Phaser from 'phaser'
import { FONT } from '../ui/typography'

/** Durées, en ms. Courtes : un retour de frappe qui traîne devient de la soupe. */
const IMPACT_MS = 160
const BLEED_MS = 260
const SPARK_MS = 220
const NUMBER_MS = 620

const BLADE = 0xf0e6d2
const IMPACT_TINT = 0xff8877
const BLEED = 0xc0503e
const SPARK = 0xffe9b0
/** Le chiffre : blanc quand je frappe, rouge quand j'encaisse. On lit l'issue d'un
 *  combat à la COULEUR, avant même d'avoir lu le nombre. */
const HIT_MINE = '#ffffff'
const HIT_THEIRS = '#ff6b5a'

export interface AttackFx {
  /** L'ÉTINCELLE et le CHIFFRE, au point d'impact (événement `entity_damaged`). */
  spark(x: number, y: number, amount: number, onMe: boolean, now: number): void
  /** Le télégraphe d'UNE entité qui arme son coup (lu du snapshot). */
  telegraph(x: number, y: number, dx: number, dy: number, progress: number): void
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
    telegraph(x, y, dx, dy, progress) {
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.0001) return
      const ux = dx / len
      const uy = dy / len
      const reach = 14 + 30 * progress // px écran : le bras se déplie
      blade.lineStyle(3 + 2 * progress, BLADE, 0.35 + 0.55 * progress)
      blade.beginPath()
      blade.moveTo(x + ux * 8, y + uy * 8 - 14)
      blade.lineTo(x + ux * reach, y + uy * reach - 14)
      blade.strokePath()
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
