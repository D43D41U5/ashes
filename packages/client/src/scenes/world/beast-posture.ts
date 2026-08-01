/**
 * CE QU'UNE BÊTE MONTRE : sa POSTURE et sa TEINTE.
 *
 * Extrait de `snapshot-view` pour une raison d'instrument, la même que celle qui
 * avait fait exporter `BEAST_TINTS` : ce que l'écran montre doit être LISIBLE
 * SANS ÉCRAN. Le diagnostic `tools/diag-cerf.mts` joue la vraie sim et demande à
 * CE module la silhouette de chaque bête, tick après tick — une copie à la main
 * aurait dérivé de l'écran au premier correctif, et c'est exactement le genre de
 * mesure qui ment.
 *
 * Zéro import Phaser : c'est la condition pour que l'instrument existe.
 */
import { activityAt, FAUNA, HUNT, type Monster, type MonsterType } from '@ashes/sim'

/** Chaque type de monstre a sa texture — exhaustif, donc un nouveau type ne
 * peut pas se glisser dans le monde déguisé en sanglier. */
export const MONSTER_TEXTURES: Record<MonsterType, string> = {
  cendreux: 'spr-cendreux',
  boar: 'spr-boar',
  deer: 'spr-deer',
  rabbit: 'spr-rabbit',
  wolf: 'spr-wolf',
}

/**
 * La palette des ÉTATS de bête — exportée pour que le smoke test (`--scenario
 * chasse`) lise la même vérité que l'écran, au lieu de recopier des hexas.
 */
export const BEAST_TINTS = {
  bleeding: 0xc4523f, // ELLE SAIGNE (chasse C8) : suivez le sang — elle est à vous
  menace: 0xff6a4a, // il MENACE : reculez — dernière seconde
  winded: 0x9aa8b4, // il souffle : frappez
  rooting: 0x8a7a5a, // il fouge, groin au sol : approchez
  eating: 0x8a7a5a, // il mange, tête dans la carcasse (ou l'appât) : la fenêtre
  stalking: 0x7a8290, // le loup rampe : il ne vous a pas encore choisi
  alert: 0xff9d54, // ALERTÉE : tendue, prête à partir — plus de coup propre (C6)
  curious: 0xffe9a0, // CURIEUSE : tête levée, elle vous regarde — figez-vous
  grazing: 0xdddddd,
} as const

/**
 * LA COULEUR DIT L'INTENTION. Les règles les plus intéressantes de la faune sont
 * des ÉTATS — le sanglier qui fouge est approchable, celui qui menace est sur le
 * point de charger, le loup qui rampe ne vous a pas encore vu. Sans un signal
 * visible, ces règles n'existent pas pour le joueur : il se fait encorner sans
 * comprendre, et le jeu passe pour injuste.
 *
 * L'art est provisoire (tout est généré au boot), donc le signal l'est aussi :
 * une teinte. Quand la direction artistique arrivera, ce sera une posture — tête
 * baissée, échine hérissée, ventre au sol — et cette fonction disparaîtra.
 */
export function beastTint(monster: Monster | undefined, windup: boolean, isNpc: boolean, tick: number): number {
  if (!monster) return windup ? 0xff8866 : isNpc ? 0xe8d9a0 : 0xffffff

  // LE SANG PRIME SUR TOUT (spec chasse C8). Une bête qui saigne est une bête
  // qu'on TRAQUE : c'est l'information la plus chère de l'écran, elle passe
  // devant l'humeur. (Et la posture, elle, dit déjà si elle fuit ou si elle est
  // tapie — les deux signaux ne se marchent pas dessus.)
  if (monster.bleedMortal || (monster.bleedUntil !== undefined && tick < monster.bleedUntil)) {
    return BEAST_TINTS.bleeding
  }

  // Le sanglier (spec faune R14) — les trois secondes qui décident de tout.
  if (monster.threatSince !== undefined) return BEAST_TINTS.menace
  if (monster.windedUntil !== undefined) return BEAST_TINTS.winded
  if (monster.rootUntil !== undefined) return BEAST_TINTS.rooting

  // Le repas (R15/C18) : tête dans la carcasse — ou dans l'appât qu'on vient de
  // lui poser. Depuis la mise à mort propre (C6), c'est une fenêtre qui se paie.
  if (monster.eatingUntil !== undefined || monster.baitUntil !== undefined) return BEAST_TINTS.eating

  // Le loup en traque (R11) : tapi, il se fond dans le sous-bois. On le distingue
  // mal — c'est le propos, et c'est loyal : il est là, à qui sait regarder.
  if (monster.stalking) return BEAST_TINTS.stalking

  // LA MÉFIANCE (spec chasse C1/C19) : la bête EST la jauge. Pas de barre
  // flottante — trois teintes, dérivées des seuils de BALANCE. CURIEUSE dit
  // « figez-vous » (la jauge redescendra) ; ALERTÉE dit « trop tard pour le
  // coup propre » — c'est l'information que le chasseur paie de son approche.
  //
  // ET ELLE SE LIT SUR LE MÊME VERROU QUE LA SIM (`monster.wary`) : comparer la
  // jauge nue à `SUSPICION_CURIOUS` faisait clignoter la teinte à 20 Hz quand
  // elle rôdait autour du seuil — voir `beastTexture`, même leçon.
  if (monster.suspicion >= HUNT.SUSPICION_ALERT) return BEAST_TINTS.alert
  if (monster.wary) return BEAST_TINTS.curious

  return windup ? 0xffffff : BEAST_TINTS.grazing
}

/**
 * COMBIEN DE TEMPS UNE BÊTE DOIT ÊTRE IMMOBILE POUR SE COUCHER (ms d'horloge de
 * rendu). Se lever est INSTANTANÉ, se coucher demande ce délai : une bête qui
 * marche est debout à l'image même où elle bouge, et l'asymétrie évite le
 * battement d'une bête qui s'arrête un tick sur deux en broutant.
 */
export const COUCHER_DELAI_MS = 600

/** Le verrou « elle est posée » d'UNE bête, tenu par la vue (une par sprite). */
export interface ReposLatch {
  /** Elle est comptée couchée. */
  posee: boolean
  /** Date (horloge de rendu) du dernier tick où elle a BOUGÉ. */
  dernierPas: number
  /**
   * PREMIÈRE VUE : on ADOPTE ce qu'on voit, on ne l'attend pas. Un verrou qui
   * démarre « debout » impose son délai à toute bête qui APPARAÎT — au chargement
   * d'une partie de nuit, à la reconnexion, à l'entrée dans la zone d'intérêt : la
   * harde endormie se peindrait debout, puis se coucherait 600 ms plus tard. C'est
   * la plainte d'origine par une autre porte.
   */
  neuf: boolean
}

export function nouveauRepos(now: number): ReposLatch {
  return { posee: false, dernierPas: now, neuf: true }
}

/**
 * LE VERROU DU COUCHÉ. Rend `true` quand la bête peut être dessinée couchée.
 * Elle se lève au premier pas ; elle ne se recouche qu'après `COUCHER_DELAI_MS`
 * d'immobilité vraie. À la toute première vue, elle est ce qu'elle est.
 */
export function majRepos(latch: ReposLatch, bouge: boolean, now: number): boolean {
  if (latch.neuf) {
    latch.neuf = false
    latch.posee = !bouge
    latch.dernierPas = now
    return latch.posee
  }
  if (bouge) {
    latch.dernierPas = now
    latch.posee = false
  } else if (!latch.posee && now - latch.dernierPas >= COUCHER_DELAI_MS) {
    latch.posee = true
  }
  return latch.posee
}

/**
 * LE MIROIR NE CLAQUE PAS (ms d'horloge de rendu). Le regard d'une bête est rangé
 * en HUIT directions par la sim, et une visée qui rase une frontière de secteur
 * bascule d'un côté à l'autre pour presque rien. Retourner la silhouette entière
 * — bois, encolure, croupe — à cette cadence est le plus voyant des tremblements,
 * et c'est celui qui coûte le moins cher à éteindre : on ne retourne le sprite que
 * si la bête regarde du même côté depuis ce délai. Une VRAIE volte-face le tient
 * sans peine ; un frisson de géométrie, jamais.
 */
export const MIROIR_DELAI_MS = 180

export interface MiroirLatch {
  /** Le sens actuellement DESSINÉ (true = retourné). */
  face: boolean
  /** Le sens vers lequel elle penche, et depuis quand. */
  candidat: boolean
  depuis: number
  /** PREMIÈRE VUE : on adopte le sens observé (même raison que `ReposLatch.neuf` —
   *  et ici c'est aussi ce qui évite d'avoir à deviner `facesRight` à la création). */
  neuf: boolean
}

export function nouveauMiroir(face: boolean, now: number): MiroirLatch {
  return { face, candidat: face, depuis: now, neuf: true }
}

/** Rend le `flipX` à dessiner. `gauche` = la bête regarde vers la gauche de l'écran. */
export function majMiroir(latch: MiroirLatch, gauche: boolean, now: number): boolean {
  if (latch.neuf) {
    latch.neuf = false
    latch.face = gauche
    latch.candidat = gauche
    latch.depuis = now
    return latch.face
  }
  if (gauche !== latch.candidat) {
    latch.candidat = gauche
    latch.depuis = now
  }
  if (gauche !== latch.face && now - latch.depuis >= MIROIR_DELAI_MS) latch.face = gauche
  return latch.face
}

/**
 * LA POSTURE DIT L'ÉTAT (spec faune R9bis / chasse C19). Avant la teinte, avant
 * tout : la SILHOUETTE. Tête au sol = elle broute (approchez) ; tête dressée =
 * elle a vu quelque chose (figez-vous) — c'est aussi la posture de la
 * SENTINELLE ; corps tendu à l'horizontale = elle fuit ; couchée = elle dort
 * (réveillable, R10). Le sanglier fouge ou charge, le loup rampe ou mange.
 *
 * ═══ ET UNE BÊTE QUI MARCHE EST DEBOUT (constaté par Alexis le 2026-08-01) ═══
 *
 * « Les cerfs bougent allongés. » La silhouette couchée se choisissait sur
 * L'HEURE seule — or le repos (`faune.ts`) est la DERNIÈRE branche de la bête :
 * rentrer chez soi, regagner son canton, recoller à la harde passent avant, et
 * chacune la fait MARCHER. Le cerf qu'on lève au crépuscule traversait donc
 * trente tuiles couché sur le flanc. L'heure dit qu'elle DORMIRAIT ; c'est son
 * PAS qui dit si elle dort. Le repos est donc conditionné à `posee` — verrou de
 * la vue, dérivé d'`Entity.moved`, qui est déjà dans le snapshot.
 */
export function beastTexture(
  monster: Monster,
  sentinel: boolean,
  hour: number,
  /** Immobile depuis assez longtemps pour se poser (voir `majRepos`). */
  posee: boolean,
): string {
  if (monster.type === 'boar') {
    if (monster.chargeUntil !== undefined) return 'spr-boar-charge'
    if (monster.rootUntil !== undefined) return 'spr-boar-root'
    return 'spr-boar'
  }
  if (monster.type === 'wolf') {
    if (monster.alpha) return 'spr-wolf-alpha' // sa silhouette EST son identité : on n'y touche pas
    if (monster.eatingUntil !== undefined) return 'spr-wolf-eat'
    if (monster.stalking) return 'spr-wolf-stalk'
    return 'spr-wolf'
  }
  if (monster.type === 'deer' || monster.type === 'rabbit') {
    const base = monster.type === 'deer' ? 'spr-deer' : 'spr-rabbit'
    if (monster.fleeSince >= 0) return `${base}-flee`
    // LA BÊTE TAPIE (spec chasse C11) : à bout de sang, couchée dans un fourré.
    // Même posture que le sommeil — mais la teinte, elle, dira le sang. (Elle ne
    // se pose qu'ARRIVÉE au couvert : `bedded` ne se lève jamais en marchant.)
    if (monster.bedded && monster.type === 'deer') return 'spr-deer-bed'
    // Tête dressée : la garde, ou une bête qui a repéré quelque chose. Celle qui
    // MANGE un appât (C18), elle, a la tête dans l'herbe : posture de broutage.
    // On lit le VERROU de la sim (`wary`), pas la jauge nue : au ras du seuil,
    // la comparaison directe faisait battre la silhouette entre 1,8 et 1,4 tuile
    // à 20 Hz — le « tremblement » qu'Alexis voyait de près.
    if (monster.baitUntil === undefined && (sentinel || monster.wary)) return base
    // Hors de ses heures, le cerf se COUCHE (le lapin tassé broute pareil) —
    // mais seulement s'il est POSÉ : celui qui marche reste debout.
    if (monster.type === 'deer' && activityAt('deer', hour) < FAUNA.REST_BELOW) {
      return posee ? 'spr-deer-bed' : base
    }
    return `${base}-graze`
  }
  return MONSTER_TEXTURES[monster.type]
}
