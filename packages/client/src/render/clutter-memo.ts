/**
 * ═══ LA MÉMOIRE DU DÉCOR — `clutterAt` retenue à la tuile (FX-06/R1, audit du 2026-08-20) ═══
 *
 * `clutterAt` est une fonction PURE du terrain, et `carte-immuable.test.ts` affirme ce terrain
 * FIGÉ. Elle était pourtant rejouée par tuile ET par image : **0,756 ms/image et ~1 778
 * tableaux et objets alloués par image**, mesurés sur la carte réellement jouée, fenêtre la
 * plus fournie. On ne calcule pas soixante fois par seconde ce qui ne change pas.
 *
 * ⚠ CE QUI CHANGE QUAND MÊME, ET POURQUOI LA CLÉ PORTE LE TERRAIN ═══
 *
 * Le terrain de la CARTE ne bouge pas ; celui qu'on PASSE à `clutterAt`, si. La Cendre convertit
 * l'id à la volée (`terrainCendre`) quand le front atteint la tuile — ce qui pousse s'en va, ce
 * qui a brûlé reste. Un cache posé sur la seule tuile ne verrait jamais ce front arriver : il
 * servirait le pré d'avant l'incendie jusqu'à la fin de la partie, et personne ne le verrait
 * venir puisque rien n'appelle « invalide-moi ça ». On retient donc le terrain AVEC les props,
 * et un terrain différent est un calcul neuf. La tuile se rouvre d'elle-même.
 *
 * Le `PropInstance[]` rendu est PARTAGÉ entre les images : la boucle de rendu le LIT et ne
 * l'écrit jamais. Le rendre `readonly` le dit au compilateur plutôt qu'à un commentaire.
 */
import { clutterAt, type PropInstance, type SampleTerrain } from './clutter'
import type { ButteContexte } from './buttes'

/**
 * Combien de tuiles on garde avant de tout vider.
 *
 * La fenêtre visible fait ~40 × 26 tuiles (zoom 2,25 à 720p, `TILE_PX` = 16, marge de pop
 * comprise). 16 384 entrées, c'est une quinzaine de fenêtres : le joueur marche une centaine
 * de tuiles dans n'importe quelle direction avant la purge. Et la purge est un VIDAGE complet,
 * pas une éviction fine — elle coûte exactement une image à l'ancien prix, une fois, contre une
 * comptabilité d'ancienneté à tenir sur chaque tuile de chaque image.
 */
export const MAX_TUILES_MEMO = 16_384

export class MemoireDuDecor {
  private readonly parTuile = new Map<number, { terrain: number; props: readonly PropInstance[] }>()
  /** Combien de fois `clutterAt` a VRAIMENT tourné — le seul chiffre qui dise si la mémoire
   *  sert à quelque chose. Lu par les tests ; gratuit en jeu (un entier par calcul). */
  calculs = 0
  /** Combien de fois on a tout vidé (débordement). Un compteur qui grimpe en jeu voudrait dire
   *  que la borne est trop basse pour la façon dont on se déplace. */
  purges = 0

  constructor(
    private readonly seed: number,
    private readonly sample: SampleTerrain,
  ) {}

  /**
   * Le décor de cette tuile. `terrain` est le terrain EFFECTIF (cendre convertie comprise) :
   * c'est lui qui décide si la mémoire vaut encore.
   */
  props(idx: number, tx: number, ty: number, terrain: number, prof: number, butte?: ButteContexte): readonly PropInstance[] {
    const memo = this.parTuile.get(idx)
    if (memo !== undefined && memo.terrain === terrain) return memo.props
    if (this.parTuile.size >= MAX_TUILES_MEMO) {
      this.parTuile.clear()
      this.purges++
    }
    const props = clutterAt(tx, ty, terrain, this.seed, this.sample, prof, butte)
    this.calculs++
    this.parTuile.set(idx, { terrain, props })
    return props
  }

  get taille(): number {
    return this.parTuile.size
  }

  vider(): void {
    this.parTuile.clear()
  }
}
