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
import { activityAt, enVol, FAUNA, HUNT, MONSTER_DEFS, type Monster, type MonsterType } from '@ashes/sim'
import { cleCouchee } from '../../render/corps-couche'

/** Chaque type de monstre a sa texture — exhaustif, donc un nouveau type ne
 * peut pas se glisser dans le monde déguisé en sanglier. */
export const MONSTER_TEXTURES: Record<MonsterType, string> = {
  cendreux: 'spr-cendreux',
  boar: 'spr-boar',
  deer: 'spr-deer',
  rabbit: 'spr-rabbit',
  wolf: 'spr-wolf',
  tetras: 'spr-tetras',
}

/**
 * LES BÊTES QUI ONT DES POSTURES DE GIBIER — et le préfixe de leurs sprites.
 *
 * C'est une TABLE et non un `type === 'deer' || type === 'rabbit'`, et la
 * différence n'est pas cosmétique : la paire en dur était une garde qui ne peut
 * pas échouer. Une sixième espèce de gibier y tombait à travers et retombait sur
 * sa texture de base — jamais de broutage, jamais de fuite, et AUCUN test rouge
 * pour le dire. Ici, l'oubli se voit : l'espèce n'est pas dans la table.
 */
export const POSTURES_GIBIER: Partial<Record<MonsterType, string>> = {
  deer: 'spr-deer',
  rabbit: 'spr-rabbit',
  tetras: 'spr-tetras',
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
 * ELLE SAIGNE — la réplique client de `isBleeding` (faune.ts) : ce module n'importe
 * de @ashes/sim que types et constantes (jouable headless), la logique est donc
 * recopiée à l'identique. Partagée entre la TEINTE (ci-dessous) et le GOUTTE-À-GOUTTE
 * (`snapshot-view` → `sang-fx`) : deux lecteurs, une seule vérité client.
 */
export function saigneBete(monster: Monster, tick: number): boolean {
  return monster.bleedMortal === true || (monster.bleedUntil !== undefined && tick < monster.bleedUntil)
}

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
  if (saigneBete(monster, tick)) {
    return BEAST_TINTS.bleeding
  }

  // LE BOND DU LOUP (R19) — et cette teinte n'est pas une décoration : c'est la
  // règle rendue visible. Le bond part cap VERROUILLÉ, donc il s'esquive d'un pas
  // de côté — mais on n'esquive que ce qu'on voit venir. Un loup qui double sa
  // vitesse et fonce en ligne droite est déjà un signal ; la teinte de MENACE le
  // rend franc, et c'est la même qu'un sanglier lancé : « ça vient sur toi. »
  if (monster.leapUntil !== undefined) return BEAST_TINTS.menace
  // LA DÉTENTE (2026-08-28) : le ressort se bande — même teinte, et elle arrive
  // AVANT le vol : c'est elle qui donne au joueur le temps de lire l'attaque.
  if (monster.bondPrepUntil !== undefined) return BEAST_TINTS.menace

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
 * LE CAP D'UN CORPS COUCHÉ NE CLAQUE PAS NON PLUS — le même verrou que le miroir, sur un CRAN
 * au lieu d'un booléen. Huit caps veulent dire huit frontières de secteur, et un corps qui
 * longe l'une d'elles pivoterait de 45° à chaque image sans ce délai. (Le miroir avait payé
 * exactement ça en 2026-08-01 ; on ne le rachète pas.)
 */
export interface CranLatch {
  cran: number
  candidat: number
  depuis: number
  neuf: boolean
}

export function nouveauCran(cran: number, now: number): CranLatch {
  return { cran, candidat: cran, depuis: now, neuf: true }
}

/** Rend le cran à DESSINER. `MIROIR_DELAI_MS` : un vrai virage le tient, un frisson jamais. */
export function majCran(latch: CranLatch, cran: number, now: number): number {
  if (latch.neuf) {
    latch.neuf = false
    latch.cran = cran
    latch.candidat = cran
    latch.depuis = now
    return latch.cran
  }
  if (cran !== latch.candidat) {
    latch.candidat = cran
    latch.depuis = now
  }
  if (cran !== latch.cran && now - latch.depuis >= MIROIR_DELAI_MS) latch.cran = cran
  return latch.cran
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
  /** LE CAP du RAMPANT — l'index de sa variante couchée (`corps-couche.ts`), verrouillé par
   *  l'appelant : un corps couché ne doit pas pivoter sur un frisson de cap. */
  orientCouche = 0,
  /** LE TICK DU SNAPSHOT — l'envol (R21) est un état BORNÉ DANS LE TEMPS, il ne se lit pas
   *  sans horloge. `-1` = « je n'en ai pas » : aucune bête n'est alors en vol, ce qui est le
   *  repli sûr (une silhouette d'oiseau posé est fausse une seconde ; une silhouette d'oiseau
   *  en vol qui ne se pose jamais est un bug qu'on regarde longtemps). */
  tick = -1,
): string {
  if (monster.type === 'boar') {
    if (monster.chargeUntil !== undefined) return 'spr-boar-charge'
    if (monster.rootUntil !== undefined) return 'spr-boar-root'
    return 'spr-boar'
  }
  if (monster.type === 'wolf') {
    if (monster.petit) return 'spr-wolf-petit' // le petit (loup.md L15) : il ne se bat pas, ça se voit
    if (monster.alpha) return 'spr-wolf-alpha' // sa silhouette EST son identité : on n'y touche pas
    // LA DÉTENTE (Alexis, 2026-08-28) : tassé avant le bond — la silhouette tapie
    // EST le télégraphe (avec la teinte de menace, voir `beastTint`). Avant
    // `eatingUntil` et `stalking` : un ressort qui se bande passe devant tout.
    if (monster.bondPrepUntil !== undefined) return 'spr-wolf-stalk'
    if (monster.eatingUntil !== undefined) return 'spr-wolf-eat'
    if (monster.stalking) return 'spr-wolf-stalk'
    return 'spr-wolf'
  }
  const base = POSTURES_GIBIER[monster.type]
  if (base !== undefined) {
    // L'ENVOL (spec faune R21) — TESTÉ EN PREMIER, avant la fuite et le broutage :
    // en l'air, la bête n'est plus rien d'autre. C'est la même priorité que dans
    // la sim (`volStep` est la garde de tête de `faunaStep`) et ce n'est pas une
    // coïncidence : deux ordres différents auraient fait clignoter l'oiseau.
    if (tick >= 0 && MONSTER_DEFS[monster.type].vol === true && enVol(monster, tick)) return `${base}-vol`
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
  // LE RAMPANT (spec `cendreux.md` R26ter) : sorti du sol sans ses jambes, il se dessine
  // COUCHÉ — le drapeau voyage dans le snapshot, la posture dit la vitesse.
  // Sa LONGUEUR suit sa marche, en HUIT CAPS (Alexis, 2026-08-25). Le miroir ne sait que
  // retourner — il ne sait pas coucher ; et deux axes ne savent pas dire une diagonale.
  if (monster.type === 'cendreux' && monster.rampant === true) {
    return cleCouchee('spr-cendreux-rampant', orientCouche)
  }
  return MONSTER_TEXTURES[monster.type]
}
