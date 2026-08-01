/**
 * LE SPRINT SE VOIT — la foulée, le souffle qui manque, et le mur.
 *
 * Demande d'Alexis (2026-08-01) : « on voit juste le sprint aller plus vite, c'est un
 * peu léger ». C'était exact, et ça l'était doublement depuis que la course dure ce
 * qu'elle doit durer (12,5 s au lieu de 57 — voir la garde `gait === 'sprint'` dans
 * `combat.ts`) : le joueur a maintenant un COMPTE À REBOURS sur le dos, et rien à
 * l'écran ne le lui dit. Une jauge le dit, mais on ne regarde pas une jauge quand une
 * meute vous suit.
 *
 * TROIS TEMPS, et ils ne se confondent pas :
 *
 *   1. LA FOULÉE — une bouffée de poussière par PAS, sous les pieds, projetée à
 *      l'OPPOSÉ de la course. C'est ce qui distingue « courir » de « se déplacer plus
 *      vite » : on voit le sol répondre. La cadence se compte en DISTANCE PARCOURUE et
 *      non en millisecondes — c'est la foulée du coureur, pas un métronome ; elle
 *      ralentit avec lui quand il rase un mur, et une frame qui saute ne fait pas
 *      cracher dix bouffées d'un coup.
 *
 *   2. LE SOUFFLE QUI MANQUE — une PENTE CONTINUE sur toute la barre d'endurance, pas
 *      un palier. À mesure qu'elle se vide : la foulée se RACCOURCIT (on traîne les
 *      pieds), la bouffée s'ÉPAISSIT (on laboure au lieu d'effleurer), et la silhouette
 *      se TASSE. Aucun de ces trois n'a de seuil : à 80 d'endurance c'est déjà là, un
 *      peu — ce qui est précisément ce qu'on veut pouvoir lire AVANT le mur.
 *
 *   3. LE MUR — l'endurance touche 0 en pleine course. C'est le nouvel événement de
 *      jeu, et c'est celui qu'il faut sentir sans lever les yeux : le coureur BRONCHE
 *      (la silhouette plonge et se relève sur une rampe bornée) et le sol part d'un
 *      coup sous lui, plus large et plus bas que les bouffées de la foulée.
 *
 * La poussière naît des PIEDS du sprite tel que la frame vient de le poser (relief du
 * warp compris) — jamais d'une position recalculée, qui dériverait au premier décalage.
 * Et tout se branche sur `gait === 'sprint'`, que le snapshot transporte déjà : le jour
 * où l'on voudra voir COURIR les autres joueurs, il n'y a rien à réécrire ici.
 */
import Phaser from 'phaser'
import { TILE_PX, TIE_ACTOR, ySortDepth } from '../../render/framing'
import { nuance, semis, TON_DE_REPLI, VALEURS } from './recolte-fx'

/** La barre d'endurance de la sim (`Entity.stamina`, 0-100). */
const SOUFFLE_PLEIN = 100

/**
 * L'ESSOUFFLEMENT : 0 le souffle plein, 1 à bout. C'est LA variable continue de tout ce
 * module — les trois signaux de la foulée en dérivent, aucun ne pose son propre seuil.
 */
export function essoufflement(stamina: number): number {
  return Math.max(0, Math.min(1, 1 - stamina / SOUFFLE_PLEIN))
}

/**
 * LA LONGUEUR DE FOULÉE, en px de monde parcourus entre deux bouffées. Elle se
 * RACCOURCIT à mesure qu'on s'essouffle : un coureur frais projette son pas loin, un
 * coureur à bout hache le sien. Les deux bornes sont exactes, et la pente entre elles
 * est droite — c'est la lecture qu'on veut, pas un palier qui claquerait à mi-barre.
 *
 * L'ordre de grandeur se lit contre la tuile (16 px) : ~1,4 tuile de foulée à plein
 * souffle, ~0,8 à bout. À 6 tuiles/s, ça fait ~4 bouffées par seconde au départ et ~7,5
 * à l'arrivée — assez pour lire un rythme, pas assez pour faire un nuage.
 */
export function longueurFoulee(essouffle: number): number {
  return FOULEE_FRAICHE_PX + (FOULEE_A_BOUT_PX - FOULEE_FRAICHE_PX) * essouffle
}
const FOULEE_FRAICHE_PX = 22
const FOULEE_A_BOUT_PX = 13

/** Combien de grains par bouffée, du souffle plein au dernier. Entier : on compte des
 *  grains, et une bouffée de « 2,7 grains » n'existe pas. */
export function grainsParFoulee(essouffle: number): number {
  return Math.round(GRAINS_FRAIS + (GRAINS_A_BOUT - GRAINS_FRAIS) * essouffle)
}
const GRAINS_FRAIS = 2
const GRAINS_A_BOUT = 5

/**
 * LE TASSEMENT DE LA SILHOUETTE — la fraction de hauteur que le coureur PERD. C'est une
 * fatigue, pas une posture : le plafond reste très en deçà de l'écrasement du rampeur
 * (`CROUCH_FACTOR` = 0,72, soit 28 %). 7 % au plus, atteints seulement à bout de
 * souffle ; on doit le sentir sans jamais pouvoir le confondre avec un accroupissement.
 *
 * `bronche` (0 → 1) est la part restante de la BRONCHÉE : elle s'ajoute par-dessus, et
 * c'est elle qui fait le coup de mou du mur. Le retour se fait sur une rampe droite —
 * on plonge d'un coup, on se relève progressivement.
 */
export function tassement(essouffle: number, bronche: number): number {
  return TASSEMENT_MAX * essouffle + TASSEMENT_BRONCHE * bronche
}
const TASSEMENT_MAX = 0.07
const TASSEMENT_BRONCHE = 0.12
/** Durée de la bronchée, en ms d'horloge Phaser. Assez longue pour se lire, assez courte
 *  pour ne pas se transformer en pénalité de contrôle : on trébuche, on ne tombe pas. */
export const BRONCHE_MS = 420

/** Plafond de grains vivants. Une course entière en crache des centaines : sans plafond,
 *  une traversée de carte finirait en tempête de sable. */
const MAX_GRAINS = 72

/**
 * LA POUSSIÈRE EST PLUS CLAIRE QUE LE SOL DONT ELLE SORT — sinon elle est INVISIBLE.
 *
 * Premier jet : le grain prenait la teinte nue du terrain, corrigée par la seule `nuance`
 * de la gerbe de récolte (±22 %). Sur capture agrandie ×5 (`--scenario sprint`), le
 * résultat est exactement ce qu'on pouvait prédire et qu'on n'avait pas prédit : des
 * grains de la couleur du sol, SUR ce sol — on ne voyait rien. Un éclat de récolte, lui,
 * peut se permettre la teinte de sa matière : il sort d'un tronc et retombe sur l'herbe,
 * donc il contraste par construction. La poussière d'un pas retombe sur ELLE-MÊME.
 *
 * Physiquement c'est aussi le bon geste : ce qu'une foulée soulève est de la matière fine
 * en suspension, elle prend la lumière de tous les côtés à la fois. On mélange donc vers
 * le blanc — assez pour se détacher franchement, pas assez pour perdre le terrain (une
 * tourbière lève du gris-brun, un alpage du sable pâle : ça reste lisible).
 */
export function teintePoussiere(sol: number): number {
  const r = (sol >> 16) & 0xff
  const g = (sol >> 8) & 0xff
  const b = sol & 0xff
  const vers = (c: number): number => Math.round(c + (0xff - c) * ECLAIRCIE)
  return (vers(r) << 16) | (vers(g) << 8) | vers(b)
}
/** Combien on tire vers le blanc. 0,5 : le grain reste de la famille du sol, mais aucune
 *  tuile du jeu n'a une valeur assez haute pour l'avaler. */
const ECLAIRCIE = 0.5

/** Le grain de poussière — même grammaire que la gerbe de récolte (loi `poussiere` :
 *  gravité presque nulle, gros grain, vie longue), mais il ne MONTE pas : une foulée
 *  soulève au ras du sol, elle ne projette pas en l'air. */
interface Grain {
  img: Phaser.GameObjects.Rectangle
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  ne: number
  vie: number
}

const GRAVITE = 26
const VIE_MS = 620
/** Le monde est vu de DESSUS : l'axe Y de l'écran est de la profondeur, il se parcourt
 *  moins vite que la largeur (même écrasement que la gerbe de récolte). */
const ECRASEMENT_Y = 0.6

export class SprintFx {
  private readonly grains: Grain[] = []
  /** Distance parcourue depuis la dernière bouffée — c'est ELLE qui cadence la foulée. */
  private depuisLaFoulee = 0
  private dernierX: number | null = null
  private dernierY: number | null = null
  /** Instant de la bronchée en cours, ou null. */
  private broncheA: number | null = null
  /** L'épuisement de la frame précédente : le mur se lit sur le FRONT, pas sur l'état. */
  private epuise = false
  private graine = 1

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * LA FRAME DU COUREUR. `x/y` : les PIEDS du sprite tels qu'ils viennent d'être posés.
   * `dirX/dirY` : où il va (unitaire ; c'est le `facing` de la sim, qui suit le pas).
   * `stamina` : sa barre, telle que le snapshot la donne. `teinteSol` : la couleur du
   * terrain sous lui — la poussière est celle du SOL qu'on foule, pas une couleur
   * décidée ici (une steppe et une tourbière ne lèvent pas la même chose).
   *
   * Rend le TASSEMENT à appliquer à la silhouette : la vue le pose, ce module ne touche
   * jamais au sprite de l'avatar.
   */
  frame(o: {
    now: number
    dtMs: number
    x: number
    y: number
    dirX: number
    dirY: number
    sprinting: boolean
    stamina: number
    /**
     * LE VERROU D'ÉPUISEMENT de la sim (`Entity.exhausted`, spec combat R1ter) — et c'est
     * LUI qui dit le mur, pas la jauge. Premier jet : on bronchait sur `stamina <= 0`, ce
     * qui n'a jamais tiré une seule fois en jeu (mesuré au smoke). Raison : la jauge
     * arrive par snapshots, et quand celui qui annonce l'épuisement atteint le client, la
     * régén a déjà recrédité une fraction de point — la condition était donc fausse au
     * moment MÊME où l'événement se produisait. Le verrou, lui, TIENT jusqu'à 25 : son
     * front montant est l'événement, sans fenêtre à rater.
     */
    exhausted: true | undefined
    /** Absente (terrain inconnu hors carte) : on retombe sur le ton de poussière neutre. */
    teinteSol: number | undefined
  }): number {
    const essouffle = essoufflement(o.stamina)

    // LE MUR : le FRONT MONTANT du verrou, et rien d'autre. Relâcher la touche n'est pas
    // s'effondrer — broncher parce qu'on a CHOISI de s'arrêter serait une punition sans
    // faute ; et le verrou ne se pose qu'à sec.
    if (o.exhausted && !this.epuise) {
      this.broncheA = o.now
      this.bouffee(o.now, o.x, o.y, -o.dirX, -o.dirY, MUR_GRAINS, MUR_FORCE, o.teinteSol)
    }
    this.epuise = o.exhausted === true

    // LA FOULÉE se compte en distance RÉELLEMENT parcourue : celui qui rase un mur
    // n'avance pas, et son pas ne doit pas fumer.
    if (o.sprinting) {
      if (this.dernierX !== null && this.dernierY !== null) {
        const dx = o.x - this.dernierX
        const dy = o.y - this.dernierY
        this.depuisLaFoulee += Math.sqrt(dx * dx + dy * dy)
      }
      const pas = longueurFoulee(essouffle)
      if (this.depuisLaFoulee >= pas) {
        this.depuisLaFoulee = 0
        this.bouffee(o.now, o.x, o.y, -o.dirX, -o.dirY, grainsParFoulee(essouffle), 1, o.teinteSol)
      }
    } else {
      this.depuisLaFoulee = 0
    }
    this.dernierX = o.x
    this.dernierY = o.y

    this.avancer(o.now, o.dtMs)

    const bronche =
      this.broncheA === null ? 0 : Math.max(0, 1 - (o.now - this.broncheA) / BRONCHE_MS)
    if (bronche <= 0) this.broncheA = null
    return tassement(essouffle, bronche)
  }

  /**
   * UNE BOUFFÉE — projetée vers `dx/dy`, qui est déjà l'OPPOSÉ de la course (la règle de
   * la gerbe : la matière part à l'opposé de l'acteur, sinon elle se tasse sur son
   * sprite et masque à la fois le geste et le sol).
   */
  private bouffee(
    now: number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    combien: number,
    force: number,
    teinteSol?: number,
  ): void {
    const rnd = semis((this.graine = (this.graine * 1103515245 + 12345) & 0x7fffffff))
    const angle = Math.atan2(dy, dx)
    const base = teintePoussiere(teinteSol ?? TON_DE_REPLI.poussiere)
    for (let i = 0; i < combien; i++) {
      // L'éventail est ÉTALÉ, pas tiré au sort : un trou dans une bouffée de trois
      // grains se voit (même raison que la gerbe de récolte).
      const part = combien === 1 ? 0.5 : i / (combien - 1)
      const a = angle + (part - 0.5 + (rnd() - 0.5) * 0.4) * 2 * DEMI_EVENTAIL
      const v = (VITESSE[0] + rnd() * (VITESSE[1] - VITESSE[0])) * force
      this.pousser({
        // Le pied ARRIÈRE, pas le centre : la bouffée naît derrière le coureur.
        x: x + Math.cos(a) * RECUL_PX,
        y: y + Math.sin(a) * RECUL_PX * ECRASEMENT_Y,
        z: 0,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * ECRASEMENT_Y,
        // Elle EFFLEURE : un envol franc lit comme une explosion, pas comme un pas.
        vz: (ENVOL[0] + rnd() * (ENVOL[1] - ENVOL[0])) * force,
        ne: now,
        vie: VIE_MS,
        ton: nuance(base, VALEURS[Math.min(VALEURS.length - 1, Math.floor(rnd() * VALEURS.length))]!),
        cote: force > 1 ? 3 : 2,
      })
    }
  }

  private pousser(g: Omit<Grain, 'img'> & { ton: number; cote: number }): void {
    if (this.grains.length >= MAX_GRAINS) this.grains.shift()?.img.destroy()
    const img = this.scene.add
      .rectangle(Math.round(g.x), Math.round(g.y - g.z), g.cote, g.cote, g.ton)
      .setDepth(ySortDepth(g.y / TILE_PX, TILE_PX, TIE_ACTOR))
    this.grains.push({ img, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz, ne: g.ne, vie: g.vie })
  }

  /** `dt` est BORNÉ : l'horloge headless saute (règle maison), et une frame de 400 ms
   *  enverrait la poussière à trois tuiles au lieu de la laisser retomber. */
  private avancer(now: number, dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const g = this.grains[i]!
      const age = now - g.ne
      if (age >= g.vie) {
        g.img.destroy()
        this.grains.splice(i, 1)
        continue
      }
      g.x += g.vx * dt
      g.y += g.vy * dt
      g.z = Math.max(0, g.z + g.vz * dt)
      g.vz -= GRAVITE * dt
      // La poussière FREINE dans l'air — elle ne file pas tout droit comme un éclat.
      g.vx -= g.vx * FREIN * dt
      g.vy -= g.vy * FREIN * dt
      const k = age / g.vie
      // Elle s'éteint TÔT et longuement, à l'inverse de l'éclat : c'est de la
      // dissipation, pas une disparition.
      g.img.setAlpha((1 - k) * 0.75)
      // Position ARRONDIE : l'art est sur une grille de pixels (règle des FX pixellisés).
      g.img.setPosition(Math.round(g.x), Math.round(g.y - g.z))
      g.img.setDepth(ySortDepth(g.y / TILE_PX, TILE_PX, TIE_ACTOR))
    }
  }

  /** Sonde du smoke : combien de grains vivent à cette frame. */
  get vivants(): number {
    return this.grains.length
  }

  destroy(): void {
    for (const g of this.grains) g.img.destroy()
    this.grains.length = 0
  }
}

/** Demi-angle de la bouffée. Large : une foulée chasse le sol de tous côtés derrière soi. */
const DEMI_EVENTAIL = 0.9 // rad, ≈ 52°
const VITESSE: readonly [number, number] = [14, 30]
const ENVOL: readonly [number, number] = [4, 11]
const FREIN = 3.2
/** De combien la bouffée naît EN ARRIÈRE du pied — juste assez pour dégager la silhouette. */
const RECUL_PX = 3
/** LE MUR : plus large, plus lourd, plus bas que la foulée. C'est le seul moment où la
 *  poussière doit couper la lecture — il faut qu'on lève les yeux. */
const MUR_GRAINS = 10
const MUR_FORCE = 1.6
