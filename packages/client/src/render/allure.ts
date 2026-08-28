/**
 * L'ALLURE DU CERF — quelle frame et quelle hauteur, à cet instant (spec faune R26,
 * « Et ça se VOIT », décision d'Alexis 2026-08-28).
 *
 * ═══ TOUT SE DÉRIVE DE LA DISTANCE PARCOURUE, JAMAIS DU TEMPS ═══
 *
 * Un cycle de pattes cadencé sur l'horloge PATINE : la bête ralentit, les jambes
 * continuent de battre — c'est le défaut que tout le monde voit et que personne ne
 * nomme. Ici, un ODOMÈTRE cumule la distance RENDUE (les positions interpolées,
 * `interp.ts`, à l'instant `target`) : les pattes alternent tous les X tuiles, le
 * bond couvre N tuiles — une bête arrêtée est une bête arrêtée, à l'image près.
 *
 * ═══ POURQUOI UN MODULE PUR, ET PAS TRENTE LIGNES DANS `snapshot-view` ═══
 *
 * La même raison que `beast-posture` et `porte-anim` : la POSTURE (fuite, broutage,
 * couché) reste la vérité headless de `beastTexture` — l'instrument `diag-cerf.mts`
 * la lit telle quelle. La PHASE d'animation (quelle jambe, quelle hauteur de bond)
 * est de la présentation PAR FRAME : elle se prouve ici, en Node, aux bornes exactes
 * — pas à l'œil sur une capture.
 *
 * ═══ LE TEMPS, QUAND IL SERT, EST UN NIVEAU ═══
 *
 * La transition lever/coucher (une frame tenue quelques centaines de ms) se déduit
 * de l'horloge à chaque image, patron `porte-anim` : l'horloge headless saute des
 * secondes entières — un front programmé se ferait enjamber, un niveau jamais.
 *
 * Zéro import Phaser. `hash2` vient de /sim : pur, déterministe, déjà l'usage client
 * (`flore-gel`, `arbre-peuplement`).
 */
import { hash2 } from '@ashes/sim'

// ── L'ODOMÈTRE ──────────────────────────────────────────────────────────────

/**
 * Au-delà de ce pas PAR IMAGE (tuiles), ce n'est plus une marche, c'est une
 * téléportation (respawn, resync) : on ne l'ajoute pas au compteur — une seule
 * image aurait sinon avalé des cycles entiers de pattes et posé la phase du bond
 * n'importe où. Large devant le vrai jeu : 4,6 tuiles/s en pleine fuite font
 * 0,08 tuile par image à 60 Hz, et ~4,6 sur la pire seconde headless.
 */
export const ODO_SAUT_MAX_TUILES = 6

/** L'état d'allure d'UN cerf, tenu par la vue (un par sprite, comme `ReposLatch`). */
export interface AllureCerf {
  /** Tuiles parcourues cumulées (positions RENDUES). Ne recule jamais. */
  odometre: number
  /** Dernière position rendue consommée. */
  x: number
  y: number
  /** Là où l'odomètre en était quand la FUITE a commencé : le premier bond part du sol. */
  origineBond: number
  /** Il était en fuite à la dernière résolution (pour détecter l'entrée en fuite). */
  enFuite: boolean
  /** Le verrou de la transition lever/coucher (voir `etatLeverCoucher`). */
  lever: LeverLatch
  /** Le verrou anti-clignotement de la tête au broutage (patron `MiroirLatch`). */
  tete: TenueTete
  /** PREMIÈRE VUE : on adopte la position observée, on ne compte pas le trajet depuis (0,0). */
  neuf: boolean
}

export function nouvelleAllure(): AllureCerf {
  return {
    odometre: 0,
    x: 0,
    y: 0,
    origineBond: 0,
    enFuite: false,
    lever: { couche: false, debut: -1, neuf: true },
    tete: { levee: false, candidat: false, depuis: 0, neuf: true },
    neuf: true,
  }
}

/**
 * Cumule la distance rendue depuis le dernier appel. MONOTONE : un aller-retour
 * compte double, jamais zéro — c'est une distance, pas un déplacement. Rend le
 * pas ajouté (0 à la première vue et sur un saut de téléportation).
 */
export function avanceAllure(a: AllureCerf, x: number, y: number): number {
  if (a.neuf) {
    a.neuf = false
    a.x = x
    a.y = y
    return 0
  }
  const d = Math.hypot(x - a.x, y - a.y)
  a.x = x
  a.y = y
  if (d > ODO_SAUT_MAX_TUILES) return 0
  a.odometre += d
  return d
}

// ── LA MARCHE : deux frames, une alternance tous les X tuiles ───────────────

/**
 * UN PAS (une alternance de jambes) tous les 0,32 tuile. Au broutage-déplacement
 * (0,35 × 4,6 ≈ 1,6 tuile/s : `GRAZE_SPEED` × l'allure de l'espèce), ça fait
 * ~5 pas/s — la cadence pixel-art d'une marche tranquille, et elle RALENTIT
 * avec la bête au lieu de battre dans le vide.
 */
export const MARCHE_DEMI_PAS_TUILES = 0.32

/**
 * En deçà de cette VITESSE récente (tuiles/s), il est à l'arrêt : posture pleine
 * (broutage, tête levée), pas de frame de marche figée en plein pas. Le seuil est
 * bien sous l'allure de pâture (1,6 t/s) et bien au-dessus du bruit d'interpolation.
 */
export const MARCHE_SEUIL_TUILES_S = 0.35

/**
 * La fenêtre de mesure de la vitesse récente (ms), servie à `deplacementRecent`
 * par l'appelant : assez courte pour qu'un arrêt se voie vite (le bond retombe,
 * la marche s'arrête), assez longue pour lisser le pas des snapshots à 20 Hz.
 */
export const ALLURE_FENETRE_MS = 300

/** La jambe en avant, 0 ou 1 — bascule tous les `MARCHE_DEMI_PAS_TUILES`. */
export function frameDeMarche(odometre: number): 0 | 1 {
  return (Math.floor(odometre / MARCHE_DEMI_PAS_TUILES) % 2) as 0 | 1
}

// ── LE BOND DE FUITE : la parabole sur la distance ──────────────────────────

/** UN BOND couvre 2 tuiles. À 4,6 tuiles/s de fuite : ~2,3 bonds/s — le rythme du cerf. */
export const BOND_PERIODE_TUILES = 2

/** Le sommet du bond, en tuiles. Bien sous l'envol du tétras (1,6) : il bondit, il ne vole pas. */
export const BOND_HAUTEUR_TUILES = 0.5

/**
 * La part de la période passée AU SOL (l'appui : il se reçoit, se ramasse et
 * repousse), à cheval sur les bornes — moitié à la retombée, moitié à l'élan.
 * Dans cette fenêtre la hauteur est EXACTEMENT 0 et la silhouette se groupe.
 */
export const BOND_APPUI_PART = 0.22

/**
 * À cette vitesse récente (tuiles/s) et au-delà, le bond est PLEIN. En deçà, sa
 * hauteur suit la vitesse : la fuite est en à-coups (`BURST_PAUSE_TICKS`, spec
 * faune A6) et un odomètre arrêté fige sa phase — sans cette part, une bête qui
 * souffle entre deux sprints resterait PENDUE en l'air, à mi-bond. Dérivée du
 * mouvement (jamais d'un ease temporel) : la vitesse mesurée sur une fenêtre ne
 * tombe pas d'un coup, la descente est donc continue. 60 % de l'allure de fuite.
 */
export const BOND_V_PLEIN_TUILES_S = 2.8

/** Sous cette hauteur effective (tuiles), il est à l'appui : silhouette groupée. */
export const BOND_SOL_SEUIL_TUILES = 0.045

/** La phase de bond dans [0, 1) — repart de zéro là où la fuite a commencé. */
export function phaseDeBond(odometre: number, origineBond: number): number {
  const d = Math.max(0, odometre - origineBond)
  return (d % BOND_PERIODE_TUILES) / BOND_PERIODE_TUILES
}

/**
 * LA HAUTEUR pour une phase de bond dans [0, 1] : 0 sur tout l'appui, et la
 * parabole nue — `4h·f·(1−f)`, la même loi que `vol.ts` — sur la part aérienne.
 * Continue sur tout le domaine, 0 aux deux bouts (règle maison : une directive
 * de feel se lit en géométrie continue, aux bornes exactes).
 */
export function hauteurDeBondCerf(phase: number): number {
  const a = BOND_APPUI_PART / 2
  if (phase <= a || phase >= 1 - a) return 0
  const f = (phase - a) / (1 - 2 * a)
  return 4 * BOND_HAUTEUR_TUILES * f * (1 - f)
}

/** La part de bond que la vitesse récente autorise : 0 arrêté, 1 en pleine fuite, affine entre. */
export function partDeBond(vitesseTuilesParS: number): number {
  return Math.max(0, Math.min(1, vitesseTuilesParS / BOND_V_PLEIN_TUILES_S))
}

// ── LA MICRO-VIE DU BROUTAGE : la tête se lève et mâche ─────────────────────

/**
 * Le cycle de tête d'une bête qui broute : ~5,5 s le mufle dans l'herbe, ~1,6 s
 * tête levée à mâcher en regardant autour. En TICKS de sim (20 Hz) : dérivé du
 * tick du snapshot + l'identité de la bête, style `sentinelOf` — zéro état, le
 * même calcul partout, et la harde ne mâche pas à l'unisson (chacune son décalage).
 */
export const TETE_CYCLE_TICKS = 142
export const TETE_LEVEE_TICKS = 32

/** Ce que le TICK dit de la tête de cette bête — la dérivation nue, sans verrou. */
export function teteLevee(entityId: number, tick: number): boolean {
  const decalage = Math.floor(hash2(entityId, 0, 0x54455445) * TETE_CYCLE_TICKS)
  return (tick + decalage) % TETE_CYCLE_TICKS < TETE_LEVEE_TICKS
}

/**
 * LE VERROU DE LA TÊTE (patron `MiroirLatch`, beast-posture.ts — recopié et non
 * importé : `render/` ne dépend jamais de `scenes/`). La dérivation par tick est
 * stable par construction, mais un tick qui saute (reconnexion, resync) ne doit
 * pas faire claquer l'encolure : le dessin ne suit que ce qui TIENT 180 ms.
 */
export const TETE_TENUE_MS = 180

export interface TenueTete {
  /** L'état DESSINÉ (true = tête levée). */
  levee: boolean
  /** Vers quoi la dérivation penche, et depuis quand. */
  candidat: boolean
  depuis: number
  /** PREMIÈRE VUE : on adopte l'état dérivé (même raison que `ReposLatch.neuf`). */
  neuf: boolean
}

export function tenirTete(latch: TenueTete, levee: boolean, nowMs: number): boolean {
  if (latch.neuf) {
    latch.neuf = false
    latch.levee = levee
    latch.candidat = levee
    latch.depuis = nowMs
    return latch.levee
  }
  if (levee !== latch.candidat) {
    latch.candidat = levee
    latch.depuis = nowMs
  }
  if (levee !== latch.levee && nowMs - latch.depuis >= TETE_TENUE_MS) latch.levee = levee
  return latch.levee
}

// ── LA TRANSITION LEVER/COUCHER : une frame tenue, en niveau ────────────────

/**
 * Combien de temps la frame intermédiaire (pattes pliées, tête levée) tient
 * entre couché et debout — dans les deux sens. Le geste du corps qui se
 * redresse, pas un fondu.
 */
export const LEVER_MS = 280

export interface LeverLatch {
  /** Couché (true) ou debout (false), tel que DESSINÉ en dernier lieu stable. */
  couche: boolean
  /** Début de la transition en cours (ms d'horloge de rendu), ou −1 : aucune. */
  debut: number
  /** PREMIÈRE VUE : on adopte — la harde chargée endormie se peint couchée, pas en train de se coucher. */
  neuf: boolean
}

export type EtatLever = 'couche' | 'transition' | 'debout'

/**
 * L'état à dessiner, en NIVEAU : on demande à chaque image, la réponse se déduit
 * de l'horloge (patron `porte-anim` — un `delayedCall` se ferait enjamber par
 * l'horloge headless). `urgent` (la fuite) saute la transition : le cerf levé au
 * premier sang est DEBOUT à l'image même, pas à genoux pendant 280 ms.
 */
export function etatLeverCoucher(latch: LeverLatch, coucheVoulu: boolean, urgent: boolean, nowMs: number): EtatLever {
  if (latch.neuf) {
    latch.neuf = false
    latch.couche = coucheVoulu
    latch.debut = -1
    return latch.couche ? 'couche' : 'debout'
  }
  if (coucheVoulu === latch.couche) {
    latch.debut = -1 // l'état a rattrapé le dessin (ou s'est ravisé) : plus rien à jouer
  } else if (urgent) {
    latch.couche = coucheVoulu
    latch.debut = -1
  } else {
    if (latch.debut < 0) latch.debut = nowMs
    if (nowMs - latch.debut >= LEVER_MS) {
      latch.couche = coucheVoulu
      latch.debut = -1
    } else {
      return 'transition'
    }
  }
  return latch.couche ? 'couche' : 'debout'
}

// ── LA RÉSOLUTION : posture (vérité du snapshot) → frame + hauteur (présentation) ──

/** Ce que l'écran dessine cette image : la clé de texture, et la hauteur de bond (tuiles). */
export interface CerfAffiche {
  key: string
  hauteurBond: number
}

/**
 * TOUTES les clés que la résolution peut émettre EN PLUS des postures de
 * `beastTexture` — la table qui permet de BALAYER (garde d'emprise dans
 * `allure.test.ts`, même leçon que `POSTURES_GIBIER` : une clé sans emprise
 * dessine la bête à la taille par défaut, en silence).
 */
export const CLES_CERF_ALLURE = [
  'spr-deer-walk-0',
  'spr-deer-walk-1',
  'spr-deer-graze-tete',
  'spr-deer-flee-sol',
  'spr-deer-lever',
] as const

/**
 * Résout la frame du cerf pour cette image. `posture` est la clé rendue par
 * `beastTexture` (la vérité headless — jamais contredite, seulement DÉTAILLÉE) ;
 * tout le reste est la présentation que cette posture autorise :
 *
 *   • `spr-deer-flee`  → le BOND : parabole sur la phase d'odomètre, assise sur la
 *     vitesse récente ; à l'appui (hauteur ≈ 0), la silhouette se groupe (`-sol`).
 *   • `spr-deer-graze` → en marche, le cycle de pattes (`-walk-0/1`) ; à l'arrêt,
 *     l'alternance de tête (`-graze` / `-graze-tete`), sous verrou.
 *   • `spr-deer`       → même cycle de pattes en marche (la rentrée au dortoir, la
 *     file de l'aube passent par cette clé) ; IMMOBILE, la tête dressée reste ce
 *     qu'elle est — c'est le signal d'alerte/sentinelle (C19), on n'y touche pas.
 *   • `spr-deer-bed` ⇄ debout → la frame de transition (`-lever`), tenue `LEVER_MS`.
 *
 * Idempotente à l'image : la rappeler deux fois avec le même `nowMs` rend la même
 * chose (les verrous ne comptent pas les appels, ils comparent des horloges).
 */
export function afficheCerf(
  a: AllureCerf,
  posture: string,
  entityId: number,
  tick: number,
  nowMs: number,
  vitesseTuilesParS: number,
): CerfAffiche {
  const enFuite = posture === 'spr-deer-flee'
  if (enFuite && !a.enFuite) a.origineBond = a.odometre // le premier bond part du sol
  a.enFuite = enFuite

  // Le corps couché, et le geste pour en sortir (ou y entrer).
  const etat = etatLeverCoucher(a.lever, posture === 'spr-deer-bed', enFuite, nowMs)
  if (etat === 'transition') return { key: 'spr-deer-lever', hauteurBond: 0 }
  if (etat === 'couche') return { key: 'spr-deer-bed', hauteurBond: 0 }

  if (enFuite) {
    const h = hauteurDeBondCerf(phaseDeBond(a.odometre, a.origineBond)) * partDeBond(vitesseTuilesParS)
    return h <= BOND_SOL_SEUIL_TUILES
      ? { key: 'spr-deer-flee-sol', hauteurBond: 0 }
      : { key: 'spr-deer-flee', hauteurBond: h }
  }

  const enMarche = vitesseTuilesParS > MARCHE_SEUIL_TUILES_S
  if (enMarche && (posture === 'spr-deer-graze' || posture === 'spr-deer')) {
    return { key: `spr-deer-walk-${frameDeMarche(a.odometre)}`, hauteurBond: 0 }
  }
  if (posture === 'spr-deer-graze') {
    const levee = tenirTete(a.tete, teteLevee(entityId, tick), nowMs)
    return { key: levee ? 'spr-deer-graze-tete' : 'spr-deer-graze', hauteurBond: 0 }
  }
  return { key: posture, hauteurBond: 0 }
}
