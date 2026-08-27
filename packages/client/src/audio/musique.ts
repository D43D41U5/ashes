/**
 * LE THÈME D'AMBIANCE — la seule MUSIQUE du jeu (décision d'Alexis, 2026-08-27).
 *
 * ⚠ C'EST LE PREMIER ASSET AUDIO DU PROJET. Tout le reste du son est synthétisé (`sound.ts`,
 * `aube.ts` : « zéro asset », da-feeling R16) et le reste. R16 gouverne l'AMBIANCE et les
 * BRUITS ; la musique est une autre couche — un morceau composé ne se synthétise pas au
 * fragment. L'écart est consigné au journal des décisions.
 *
 * CLIENT SEUL, et RIEN de `/sim` : le hasard de l'espacement est tiré ici, exactement comme
 * les oiseaux de l'aube. Aucun flux RNG seedé n'est touché, donc aucun risque de rejeu.
 *
 * LA FORME, telle qu'Alexis l'a demandée :
 *   — un PASSAGE, pas une boucle : le morceau se joue en entier, puis se tait longtemps.
 *     L'espacement (3 à 7 min) est plus long que le morceau (2 min 16 s) : le thème reste un
 *     ÉVÉNEMENT. Bouclé serré, il deviendrait un tapis, et un tapis agace.
 *   — DEUX fondus, pas un. L'entrée et la sortie sont longues (une nappe qui paraît) ;
 *     la COUPURE de danger est brève — au-delà d'une seconde elle ne se lit plus comme une
 *     réaction, mais comme la fin du morceau.
 *   — LE DANGER COUPE : un monstre qui m'a pour cible, ou un sol qui se soulève à portée.
 *
 * LE NIVEAU NE MASQUE RIEN (contrainte d'Alexis). Repères MESURÉS dans ce dépôt : le plafond
 * global est `MASTER_GAIN = 0,6` (« le son reste un DÉCOR, jamais au premier plan ») et le
 * SFX le plus fort du jeu culmine à `gain: 0,12`. Un thème à 0,75 sortirait à six fois le pic
 * du coup d'épée. `NIVEAU` ci-dessous est un point de départ à CALIBRER À L'OREILLE dans
 * l'Atelier (onglet SON, panneau « LE THÈME ») contre un impact — c'est la seule façon de
 * régler ça, la normalisation du fichier source étant elle-même inconnue.
 */
import { VISIBLE_TILES_TALL } from '../render/framing'

export const MUSIQUE = {
  /** Le gain du thème, sous le master. À caler à l'oreille — voir l'en-tête. */
  NIVEAU: 0.1,

  /** Fondu d'ENTRÉE, en secondes : une nappe qui paraît, pas un morceau qui démarre. */
  FONDU_ENTREE_S: 5,
  /** Fondu de SORTIE en fin de morceau — un peu plus long que l'entrée : on s'en va mieux
   *  qu'on n'arrive. Amorcé quand il reste ce temps-là de bande. */
  FONDU_SORTIE_S: 6,
  /** LA COUPURE DE DANGER. Brève : c'est une RÉACTION. Au-delà d'une seconde, l'oreille
   *  l'entend comme une fin de morceau et le lien de cause à effet se perd. */
  FONDU_COUPURE_S: 0.5,

  /** L'ESPACEMENT entre deux passages, en ms — tiré uniformément dans la fourchette.
   *  Le plancher est plus long que le morceau lui-même : jamais deux passages qui se
   *  touchent. */
  ECART_MIN_MS: 3 * 60_000,
  ECART_MAX_MS: 7 * 60_000,
  /**
   * LE THÈME OUVRE LA RUN — dès la première image jouable, sans attendre (Alexis, 2026-08-27 :
   * « je n'entends pas la musique au lancement de la run… il faudrait au moins ça avant le reste
   * des passages aléatoires »). Le premier passage n'est PAS espacé : c'est la seule occurrence
   * dont on soit sûr qu'elle sera entendue, et c'est elle qui donne le ton de la partie.
   *
   * ⚠ « Dès que possible » n'est pas « à l'instant zéro » : le navigateur n'accorde l'audio
   * qu'au premier geste du joueur DANS LE MONDE (`WorldScene` réveille le moteur sur le premier
   * clic ou la première touche — c'est vrai de tout le son du jeu, pas seulement de la musique).
   * La machine à états retente à chaque image tant que la piste ne s'ouvre pas : le thème part
   * donc au premier pas, pas au premier tick.
   */
  OUVERTURE_MS: 0,

  /**
   * L'APAISEMENT — le temps de calme EXIGÉ avant que le thème redevienne éligible.
   *
   * ⚠ IL SE LIT EN NIVEAU, PAS SUR UN FRONT. L'IA des monstres pense à 2 Hz (`Monster.thinkAt`)
   * et `targetId` clignote : sur un front, le thème repartirait entre deux pensées, au milieu
   * du combat. On coupe sur le front montant, mais on ne RE-AUTORISE qu'après ce silence-là,
   * mesuré depuis le dernier instant de danger — et l'espacement repart ensuite de zéro. Le
   * loup meurt ; la musique ne revient pas dans la seconde.
   */
  APAISEMENT_MS: 25_000,

  /**
   * LA PORTÉE DU SOL QUI SE SOULÈVE, en tuiles — DÉRIVÉE DU CADRE, pas posée. `VISIBLE_TILES_TALL`
   * est l'étalon de tout rayon qu'on veut voir se refermer dans l'image : aux trois quarts de la
   * hauteur visible, un réveil qui coupe la musique est un réveil qu'on peut VOIR (ou qui déborde
   * à peine du bord haut). Plus loin, la musique se tairait pour un fait invisible.
   */
  PORTEE_REVEIL: VISIBLE_TILES_TALL * 0.75,

  /**
   * LE GARDE-FOU DE L'AGGRO, en tuiles. La règle est `targetId === moi` — c'est ELLE qui dit
   * l'aggro. Ceci ne fait qu'empêcher un traqueur qui a perdu ma trace à l'autre bout de la
   * carte de tenir la musique en otage : une image et demie de distance, il ne me trouvera pas.
   */
  PORTEE_AGGRO: VISIBLE_TILES_TALL * 1.5,
} as const

/** Ce que le thème sait faire d'une bande sonore. Le moteur en fournit l'implémentation
 *  WebAudio (`SoundEngine.piste`) ; les tests en fournissent une de papier. */
export interface Piste {
  /**
   * Démarre la lecture depuis le début ET monte au niveau en `fonduS` secondes.
   *
   * ⚠ LES DEUX SONT LE MÊME GESTE, et c'est un défaut MESURÉ au navigateur qui l'impose : une
   * bande qui n'a pas fini de se mettre en route reste à `currentTime = 0` pendant deux à trois
   * secondes. Un fondu lancé à côté se jouait donc sur du SILENCE, et la musique entrait d'un
   * bloc, à plein niveau, au moment où la lecture démarrait — c'est-à-dire tout le contraire
   * d'un fondu d'entrée, sur le seul passage que le joueur est sûr d'entendre (le premier).
   * L'implémentation attend que la lecture ait RÉELLEMENT commencé pour lancer la rampe.
   */
  jouer(niveau: number, fonduS: number): void
  /** Arrête et rembobine, gain remis à zéro. */
  arreter(): void
  /** Rampe le gain vers `v` en `secondes` — SUR L'HORLOGE WEBAUDIO, jamais un timer JS. */
  rampe(v: number, secondes: number): void
  /** Ce qu'il reste de bande, en secondes. `Infinity` tant que la durée est inconnue
   *  (métadonnées pas encore chargées) : on ne fond pas ce qu'on ne sait pas mesurer. */
  resteS(): number
}

/**
 * LE DANGER QUI COUPE — fonction PURE, donc éprouvable sans navigateur.
 *
 * Deux faits, et rien d'autre :
 *  ① un monstre dont la cible C'EST MOI (`targetId`, le champ que posent `faune.ts` et
 *    `cendreux.ts`), à portée de garde-fou ;
 *
 * `positionDe` est une RECHERCHE, pas une table : elle n'est appelée que pour les monstres qui
 * m'ont déjà pour cible — presque toujours aucun. Bâtir une `Map` de toutes les entités à chaque
 * image coûterait une allocation par frame pour un renseignement qu'on ne demande jamais.
 *  ② un SOL QUI TRAVAILLE à portée (`Reveil`) — décision d'Alexis : « la musique se coupe
 *    lorsqu'il y a un réveil à portée ». C'est le moment le plus tendu du jeu et il n'a pas
 *    de `targetId` : le monstre n'existe pas encore.
 */
export function dangerProche(
  moi: { x: number; y: number } | undefined,
  monId: number,
  monstres: readonly { entityId: number; targetId: number | null }[],
  positionDe: (entityId: number) => { x: number; y: number } | undefined,
  reveils: readonly { x: number; y: number }[],
): boolean {
  if (!moi) return false
  const aggro2 = MUSIQUE.PORTEE_AGGRO * MUSIQUE.PORTEE_AGGRO
  for (const m of monstres) {
    if (m.targetId !== monId) continue
    const p = positionDe(m.entityId)
    // Un traqueur dont on ignore la position est un traqueur qui vient : on ne l'excuse pas.
    if (!p) return true
    const dx = p.x - moi.x
    const dy = p.y - moi.y
    if (dx * dx + dy * dy <= aggro2) return true
  }
  const rev2 = MUSIQUE.PORTEE_REVEIL * MUSIQUE.PORTEE_REVEIL
  for (const r of reveils) {
    const dx = r.x - moi.x
    const dy = r.y - moi.y
    if (dx * dx + dy * dy <= rev2) return true
  }
  return false
}

/** L'état du thème. `attente` = silence ; `sort`/`coupe` = un fondu descendant en cours. */
export type EtatTheme = 'attente' | 'joue' | 'sort' | 'coupe'

export class ThemeAmbiance {
  /** Passages ENTAMÉS depuis le boot — la sonde du smoke (le pendant de `chirps`, A7). */
  passages = 0
  /** Coupures dues au danger — la sonde de la deuxième moitié du contrat. */
  coupures = 0

  private etat: EtatTheme = 'attente'
  private piste: Piste | null = null
  /** L'instant du prochain passage possible (horloge du RENDU, ms). */
  private prochainA = 0
  /** L'instant où le fondu descendant en cours s'achève. */
  private finDuFonduA = 0
  /** Le DERNIER instant de danger vu — l'apaisement se mesure depuis lui, en NIVEAU. */
  private dernierDangerA = -Infinity
  private amorce = false

  /**
   * `ouvrir` rend une `Piste`, ou `null` tant que l'audio dort (le navigateur n'accorde le
   * son qu'après un geste). Elle n'est appelée qu'au moment du PREMIER passage, jamais au
   * boot : les 4,3 Mo se téléchargent quand on en a besoin, pas pendant le chargement du jeu.
   */
  constructor(
    private readonly ouvrir: () => Piste | null,
    private readonly alea: () => number = Math.random,
  ) {}

  /** L'état courant — pour le banc et le smoke. */
  get phase(): EtatTheme {
    return this.etat
  }

  /** Coupe tout, sur-le-champ (changement de scène, fin de partie). */
  taire(): void {
    this.piste?.arreter()
    this.etat = 'attente'
    this.prochainA = 0
    this.amorce = false
  }

  /**
   * À appeler chaque frame. `nowMs` est l'horloge du rendu ; `danger` est le verdict de
   * `dangerProche`. Toutes les décisions se prennent EN NIVEAU (comparaisons d'instants) —
   * aucun `delayedCall`, aucun `setTimeout` : en headless une image dure des secondes et un
   * front se ferait enjamber.
   */
  update(nowMs: number, danger: boolean): void {
    if (danger) this.dernierDangerA = nowMs
    if (!this.amorce) {
      this.amorce = true
      // LE PREMIER PASSAGE N'EST PAS TIRÉ : le thème ouvre la run (voir `OUVERTURE_MS`).
      // L'espacement aléatoire ne commande que les SUIVANTS.
      this.prochainA = nowMs + MUSIQUE.OUVERTURE_MS
    }

    switch (this.etat) {
      case 'attente': {
        if (nowMs < this.prochainA) return
        // L'APAISEMENT, en niveau : le calme doit DURER, il ne suffit pas qu'il commence.
        if (nowMs - this.dernierDangerA < MUSIQUE.APAISEMENT_MS) return
        this.piste ??= this.ouvrir()
        if (!this.piste) return // l'audio dort encore : on repassera à la frame suivante
        this.piste.jouer(MUSIQUE.NIVEAU, MUSIQUE.FONDU_ENTREE_S)
        this.passages += 1
        this.etat = 'joue'
        return
      }
      case 'joue': {
        if (danger) {
          this.coupures += 1
          this.descendre(nowMs, MUSIQUE.FONDU_COUPURE_S, 'coupe')
          return
        }
        // La fin du morceau s'ANTICIPE : on fond pendant qu'il reste de la bande, sinon
        // le fondu se joue sur du silence et le morceau s'arrête net.
        if (this.piste !== null && this.piste.resteS() <= MUSIQUE.FONDU_SORTIE_S) {
          this.descendre(nowMs, MUSIQUE.FONDU_SORTIE_S, 'sort')
        }
        return
      }
      case 'sort':
      case 'coupe': {
        if (nowMs < this.finDuFonduA) return
        this.piste?.arreter()
        this.etat = 'attente'
        // L'espacement repart de ZÉRO après une coupure comme après une fin : dans les deux
        // cas le thème vient de se taire, et c'est de là qu'on compte.
        this.prochainA = nowMs + this.tirage(MUSIQUE.ECART_MIN_MS, MUSIQUE.ECART_MAX_MS)
        return
      }
    }
  }

  private descendre(nowMs: number, secondes: number, vers: 'sort' | 'coupe'): void {
    this.piste?.rampe(0, secondes)
    this.finDuFonduA = nowMs + secondes * 1000
    this.etat = vers
  }

  private tirage(min: number, max: number): number {
    return min + this.alea() * (max - min)
  }
}
