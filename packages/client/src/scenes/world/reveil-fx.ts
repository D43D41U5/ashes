/**
 * LE SOL QUI TRAVAILLE, ET LE MORT QUI S'EN EXTRAIT (spec `cendreux.md` R14/R21/R22).
 *
 * ═══ CE QUI MANQUAIT ═══
 *
 * La sim livrait déjà tout : `nighthunt.ts` plante un `Reveil` (`x, y, at, preyId`), il
 * travaille `MORTS.REVEIL_TICKS` (4 s), un feu à `HEARTH_WARD_RADIUS` l'ÉTOUFFE, puis
 * `advanceReveils` fait sortir le Cendreux. `state.reveils` part dans le snapshot
 * (`protocol.ts`), le worker solo et le serveur LAN l'y mettent tous les deux — et le client
 * le JETAIT. Aucune lecture de `reveils` nulle part dans `packages/client`.
 *
 * La conséquence n'était pas cosmétique. R22 rapproche le mort à SEPT tuiles (le loup garde
 * ses quinze) et paie ce rapprochement avec les 4 s de préavis : *« naître à sept tuiles
 * serait injuste SANS PRÉAVIS — c'est exactement ce que R21 achète »*. Le préavis étant
 * invisible, le jeu encaissait le rapprochement et ne rendait pas la contrepartie : le
 * Cendreux POPPAIT à sept tuiles, de nuit. Cette couche est la contrepartie.
 *
 * ═══ DEUX TEMPS, DEUX SOURCES ═══
 *
 *   1. LE SOL CREUSE VERS LE HAUT (4 s) — dessiné depuis `state.reveils`. Pendant ce
 *      temps il n'y a AUCUNE entité : rien à cropper, rien à orienter. C'est une couche au
 *      sol, voisine exacte des terriers (`renderBurrows`) : un monticule qui enfle et se
 *      fend, et de la terre projetée à chaque fois qu'il se rompt d'un cran.
 *
 *   2. IL S'EXTRAIT (~1 s) — dessiné sur le sprite du Cendreux, par la MÊME géométrie que
 *      l'immersion dans l'eau (`syncActor`, spec eau-vivante R4) : `setCrop` garde le haut
 *      du sprite, le décalage en Y remet le bas du fragment visible pile sur la ligne de
 *      sol. Un corps qui entre dans l'eau et un corps qui sort de terre, c'est la même
 *      découpe — on ne lui apprend pas une deuxième règle.
 *
 * ═══ AUCUN ÉTAT NEUF DE SIM, ET AUCUNE TOUCHE À /sim ═══
 *
 * L'avancement du sol est une fonction du snapshot : `1 − (at − tick) / REVEIL_TICKS`. Rien
 * n'est stocké côté sim, dans l'esprit de R15 (*« le champ des morts est DÉRIVÉ, jamais
 * rangé »*). Ce module ne tient que du transitoire de rendu, en millisecondes client.
 *
 * ═══ POURQUOI LE SITE, ET PAS L'ÉVÉNEMENT SEUL ═══
 *
 * `cendreux_risen` a DEUX émetteurs : `advanceCendreux` (un cadavre qui se lève — il est
 * déjà couché SUR le sol, il ne creuse rien) et `advanceReveils` (le sol qui s'ouvre). Les
 * distinguer dans la sim aurait demandé un second événement pour un seul fait, ce que
 * `morts.ts` refuse explicitement — et toucher au décompte d'entités de `/sim` pour une
 * question de rendu est le plus court chemin vers un flux RNG décalé.
 *
 * On les distingue donc ICI, sans rien demander : `spawnMonster(state, 'cendreux', r.x, r.y)`
 * naît aux coordonnées EXACTES du réveil. Un `cendreux_risen` dont le site est un réveil vu
 * récemment est une émergence ; tout autre est une levée de cadavre, et ne reçoit rien
 * (décision d'Alexis, 2026-07-31 : on ne livre que le réveil du sol).
 *
 * La reconnaissance se fait sur l'ÂGE du site (`SITE_OUBLI_MS`), jamais sur « il est encore
 * dans le snapshot » : `advanceReveils` retire le réveil de l'état AU TICK MÊME où il émet
 * l'événement, donc le message qui porte le fait ne porte plus le site. Une garde par
 * présence n'aurait jamais reconnu une seule émergence.
 *
 * ═══ LA TERRE EST CELLE DU SOL ═══
 *
 * Les monticules sont peints en VALEURS (des gris), et teintés par la couleur du terrain de
 * leur tuile. Un réveil dans la neige soulève de la neige, un réveil sur l'éboulis soulève
 * du gravier — sans une seule table de couleurs de plus. C'est la règle de la maison
 * (`recolte-fx` lit ses tons sur le sprite du nœud ; `clutter-teinte` prend la gamme du
 * biome) : la couleur se lit sur la chose, elle ne se tabule jamais.
 */
import Phaser from 'phaser'
import { BALANCE, MORTS, type Reveil } from '@ashes/sim'
import { TILE_PX, TIE_ACTOR, ySortDepth } from '../../render/framing'
import { TERRAIN_COLORS } from '../../render/terrain-colors'
import { familleDe, type Famille as GrainFamille } from '../../render/grain-sol'
import { nuance, semis, VALEURS } from './recolte-fx'

/** Combien de stades de monticule. L'art du jeu est QUANTIFIÉ (règle des FX pixellisés) :
 *  le sol se rompt par crans francs, il ne se dilate pas en continu. */
export const REVEIL_STADES = 4

/** Durée de l'extraction du corps, en ms. Un peu moins d'une seconde : c'est un effort, pas
 *  une cinématique — le Cendreux est déjà en retard sur sa proie quand il sort. */
export const EXTRACTION_MS = 900

/**
 * DE QUELLE PART DE SA HAUTEUR IL EST ENFOUI AU PREMIER INSTANT.
 *
 * Pas 1 : à 1, il n'y a RIEN à l'écran, et une émergence qui commence par une frame vide se
 * lit comme un raté d'affichage. À 0,95, le sommet du crâne perce déjà le monticule — on
 * voit ce qui sort avant que ça sorte. Les deux bornes sont exactes : 0,95 → 0.
 */
export const ENFOUISSEMENT_MAX = 0.95

/** Combien de temps le monticule reste après la sortie, avant de s'effacer (ms). La terre
 *  remuée ne se referme pas derrière le mort : le trou est la preuve d'où il est venu. */
export const MONTICULE_APRES_MS = 2600

/** L'AFFAISSEMENT quand un feu étouffe le réveil (ms) — `reveil_etouffe`. Plus court que la
 *  survivance d'une sortie : ici rien n'est arrivé, et c'est tout le propos. */
export const ETOUFFEMENT_MS = 700

/** L'ÉCHELLE DU TERTRE AU PREMIER INSTANT. Pas 0 : le premier cran n'est pas « rien », c'est
 *  un sol qui frémit — et il doit être VU, sans quoi le préavis commence une seconde trop
 *  tard. Pas gros non plus : ce qui monte doit avoir de la place pour monter. */
export const MONTICULE_ECHELLE_MIN = 0.45

/**
 * COMBIEN DE TEMPS ON SE SOUVIENT D'UN SITE APRÈS L'AVOIR VU DANS UN SNAPSHOT (ms).
 *
 * C'est la fenêtre de reconnaissance d'un `cendreux_risen` (voir l'en-tête). Elle est large
 * devant l'intervalle des snapshots (50 ms en solo, ~100 ms en LAN) pour survivre à une
 * frame lente ou à un hoquet réseau, et courte devant le temps qui sépare deux réveils sur
 * la même tuile — un site oublié ne peut plus faire creuser un cadavre qui se lève.
 */
export const SITE_OUBLI_MS = 1500

/** Durée du réveil en ms client — la rampe des 4 s de sim, dans l'horloge du rendu. */
export const REVEIL_MS = (MORTS.REVEIL_TICKS * 1000) / BALANCE.TICK_RATE_HZ

/**
 * LA TERRE PROJETÉE. Une loi de vol proche de `pierre` (`recolte-fx`) et surtout PAS de
 * `poussiere` : une motte arque et RETOMBE — c'est ce qui la fait lire comme de la matière
 * arrachée. La poussière, elle, monte et se dissipe (g = 10), ce qui aurait donné une fumée.
 * Un peu plus lourde et plus basse que l'éclat de roche : on creuse par en dessous, la terre
 * ne fuse pas, elle est POUSSÉE.
 */
export const LOI_TERRE = {
  n: 8,
  vitesse: [12, 34] as const,
  envol: [26, 52] as const,
  g: 330,
  vie: 640,
  taille: 2,
}

/** LA TERRE NUE — le sous-sol, celui qui est le même presque partout. */
export const TON_TERRE = 0x6b5642

/** Combien la terre remuée est plus SOMBRE que ce dont elle sort. Ce qu'on déterre n'a pas
 *  vu le jour — sans cet assombrissement, le monticule disparaît dans son propre sol. */
export const TERRE_FRAICHE = 0.62

/**
 * QUELLE PART DE LA SURFACE SE RETROUVE DANS LE TAS — par famille de sol.
 *
 * ═══ LA PREMIÈRE VERSION SE CONTENTAIT D'ASSOMBRIR LE TERRAIN, ET ELLE ÉTAIT FAUSSE ═══
 *
 * Elle appliquait « la couleur se lit sur la chose » à la lettre : tas = `TERRAIN_COLORS`
 * assombri. CONSTATÉ à l'écran, sur une capture de nuit en forêt : le tertre sortait **vert**
 * et se lisait comme un buisson de plus — au milieu d'un décor qui en est plein. La règle
 * était bonne, la source ne l'était pas : `TERRAIN_COLORS` donne la couleur de ce qu'on
 * FOULE, pas de ce qu'il y a DESSOUS. Sous l'herbe et sous la litière il y a de la terre.
 *
 * Mais pas partout, et c'est ce qui interdit de tout peindre en brun : sous la neige il y a
 * de la neige, sous l'éboulis du gravier. Ce qu'on déterre est la surface elle-même.
 *
 * La distinction existe DÉJÀ, et elle est même testée exhaustivement contre le registre de
 * la sim : les familles de `grain-sol` (*« chaque famille dit ce qu'on FOULE »*). On ne
 * fabrique donc aucune table de plus — on répond à une question de matière avec la
 * classification de matière que le projet a déjà.
 */
export const PART_DU_SOL: Record<GrainFamille, number> = {
  // Ce qu'on déterre EST la surface : elle passe presque entière.
  neige: 0.9,
  mineral: 0.8,
  // Sous l'herbe, la litière et la tourbe, il y a de la terre. La surface ne fait que teinter.
  herbe: 0.2,
  litiere: 0.25,
  humide: 0.3,
}

/** Un terrain sans famille déclarée (eau, falaise, mur, void) : terre nue. */
const PART_PAR_DEFAUT = 0

/** Plafond de grains vivants : le plafond de l'acte borne les réveils, celui-ci borne ce
 *  qu'ils peuvent coûter à l'écran même si tout se déclenche ensemble. */
const MAX_GRAINS = 160

/** Un site de réveil suivi entre deux snapshots. Transitoire CLIENT pur. */
interface Site {
  x: number
  y: number
  /** Instant (ms client) où le sol s'ouvrira — resynchronisé à chaque snapshot. */
  finAt: number
  /** Dernière fois qu'il a été vu dans un snapshot : c'est lui qui fait l'oubli. */
  vuA: number
  /** Le dernier cran de rupture déjà joué — la terre ne part qu'UNE fois par cran. */
  stadeJoue: number
  /** L'avancement ne recule jamais (voir `suivre`). */
  avancement: number
}

/** Un monticule qui SURVIT à son réveil : après la sortie, ou après l'étouffement. */
interface Residu {
  x: number
  y: number
  ne: number
  vie: number
  /** Le stade figé — plein pour une sortie, il redescend pour un étouffement. */
  stade: number
  /** Vrai si un feu l'a étouffé : le tas s'AFFAISSE au lieu de rester ouvert. */
  etouffe: boolean
}

interface Grain {
  img: Phaser.GameObjects.Rectangle
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  ne: number
}

/** Ce qu'il faut pour peindre un monticule — la vue le poole, comme les terriers. */
export interface Monticule {
  /** En tuiles (monde), comme `Reveil`. */
  x: number
  y: number
  /** 0 → `REVEIL_STADES - 1` : quelle texture. */
  stade: number
  /** L'échelle CONTINUE du tertre — `MONTICULE_ECHELLE_MIN` → 1 sur toute la rampe. */
  echelle: number
  alpha: number
  teinte: number
}

function borne01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** La clé d'un site. Arrondie au centième de tuile : la sim recopie `r.x`/`r.y` tels quels
 *  dans l'événement, mais on ne fait jamais reposer une reconnaissance sur l'égalité de
 *  deux flottants qui ont voyagé par `postMessage` ou par le réseau. */
export function cleSite(x: number, y: number): string {
  return `${Math.round(x * 100)},${Math.round(y * 100)}`
}

/**
 * LE STADE DE RUPTURE à un avancement donné. Crans francs et bornes exactes : 0 dès le
 * premier instant (le sol frémit déjà), `REVEIL_STADES - 1` à l'avancement plein.
 */
export function stadeMonticule(avancement: number): number {
  const s = Math.floor(borne01(avancement) * REVEIL_STADES)
  return s >= REVEIL_STADES ? REVEIL_STADES - 1 : s
}

/**
 * L'ÉCHELLE DU TERTRE à un avancement donné. Bornes EXACTES : `MONTICULE_ECHELLE_MIN` au
 * premier instant, 1 à l'avancement plein.
 *
 * La texture est quantifiée en quatre crans (l'art l'est), mais l'échelle, elle, monte en
 * CONTINU sur toute la longueur de l'élément — jamais par stade. Rapportée au cran, elle
 * serait redescendue à chaque changement de texture : le tertre aurait pulsé quatre fois en
 * quatre secondes au lieu de pousser une seule fois, et une pulsation lit comme un défaut de
 * rendu. La matière est en pas francs, la géométrie est continue.
 */
export function echelleMonticule(avancement: number): number {
  return MONTICULE_ECHELLE_MIN + (1 - MONTICULE_ECHELLE_MIN) * borne01(avancement)
}

/**
 * DE QUELLE PART DE SA HAUTEUR LE CORPS EST ENCORE SOUS TERRE, `sortiA` ms après le début
 * de son extraction. Bornes exactes : `ENFOUISSEMENT_MAX` à t = 0, **0** à
 * `EXTRACTION_MS` et au-delà.
 *
 * La pente est un `smoothstep` : il décolle lentement (il POUSSE contre la terre), passe
 * vite au milieu, et se pose sans rebond sur la ligne de sol. Une rampe linéaire remontait
 * le corps comme un ascenseur — le seul moment où l'on voit un effort est celui où la
 * vitesse change.
 */
export function enfouissement(now: number, sortiA: number): number {
  const p = borne01((now - sortiA) / EXTRACTION_MS)
  const lisse = p * p * (3 - 2 * p)
  return ENFOUISSEMENT_MAX * (1 - lisse)
}

/**
 * LA COULEUR DE CE QUI SORT DU TROU, pour un terrain donné (`null` hors carte).
 *
 * Terre nue, teintée par la surface à la hauteur que sa famille autorise (`PART_DU_SOL`),
 * puis assombrie — ce qu'on déterre n'a pas vu le jour. Un réveil dans la neige soulève donc
 * de la neige, un réveil sur l'éboulis du gravier, et un réveil sous les arbres de la TERRE
 * plutôt qu'un buisson vert de plus.
 */
export function terreDe(terrain: number | null): number {
  if (terrain === null) return nuance(TON_TERRE, TERRE_FRAICHE)
  const surface = TERRAIN_COLORS[terrain] ?? TON_TERRE
  const famille = familleDe(terrain)
  const part = famille !== null ? PART_DU_SOL[famille] : PART_PAR_DEFAUT
  const canal = (decalage: number): number => {
    const t = (TON_TERRE >> decalage) & 0xff
    const s = (surface >> decalage) & 0xff
    return Math.round(t * (1 - part) + s * part)
  }
  return nuance((canal(16) << 16) | (canal(8) << 8) | canal(0), TERRE_FRAICHE)
}

/**
 * UN CRAN QUI VIENT DE CÉDER — ce que `SolsAuTravail` a décidé, et que `ReveilFx` peint.
 * Le passage par une DONNÉE est ce qui rend toute la décision vérifiable sans navigateur.
 */
export interface Rupture {
  x: number
  y: number
  /** L'épaisseur de la gerbe : 0,4 au premier frémissement, 1,5 quand le sol cède. */
  force: number
  /** Le cran franchi — sert de graine, pour que deux crans ne rendent pas la même gerbe. */
  stade: number
}

/**
 * LA DÉCISION, SANS UN PIXEL. Elle tient les sites entre deux snapshots, fait monter les
 * rampes, reconnaît les émergences et distingue la levée d'un cadavre — c'est-à-dire tout ce
 * qui peut se tromper en silence.
 *
 * Séparée de la peinture EXPRÈS. La garde centrale de ce chantier (« un `cendreux_risen` qui
 * n'est pas un réveil ne fait creuser personne ») est une règle de décision : elle doit se
 * prouver en test headless, pas se constater sur une capture. Ce que ce découpage laisse au
 * navigateur est exactement ce qui s'y voit — que la terre vole et que le corps sorte.
 */
export class SolsAuTravail {
  private readonly sites = new Map<string, Site>()
  private readonly residus: Residu[] = []
  /** Les extractions en cours, par entité : `syncActor` y lit son enfouissement. */
  private readonly sorties = new Map<number, number>()

  /**
   * UN SNAPSHOT ARRIVE. On recale chaque site sur l'horloge CLIENT — `finAt` en ms — plutôt
   * que de repeindre à partir du tick : le tick avance par pas de 50 ms et le rendu tourne à
   * 60 im/s, donc une échelle tirée du tick monterait par marches de trois frames. La rampe
   * doit être continue sur toute sa longueur.
   *
   * L'avancement ne RECULE jamais : le recalage à chaque snapshot corrige une dérive de
   * quelques millisecondes, et un monticule qui rétrécit d'une frame lirait comme un défaut.
   */
  suivre(reveils: readonly Reveil[], tick: number, now: number): void {
    for (const r of reveils) {
      const cle = cleSite(r.x, r.y)
      const finAt = now + ((r.at - tick) * 1000) / BALANCE.TICK_RATE_HZ
      let site = this.sites.get(cle)
      if (!site) {
        site = { x: r.x, y: r.y, finAt, vuA: now, stadeJoue: -1, avancement: 0 }
        this.sites.set(cle, site)
      } else {
        site.finAt = finAt
      }
      site.vuA = now
    }
    // L'oubli est par ÂGE, jamais par absence : le snapshot qui porte `cendreux_risen` ne
    // porte plus le réveil (voir l'en-tête).
    for (const [cle, site] of this.sites) {
      if (now - site.vuA > SITE_OUBLI_MS) this.sites.delete(cle)
    }
  }

  /**
   * CHAQUE FRAME : la rampe avance, et un cran franchi rend une `Rupture`. Séparé de
   * `suivre` parce que le rendu tourne trois fois plus vite que les snapshots — c'est ici
   * que la pente est continue.
   *
   * Un cran ne cède qu'UNE fois (`stadeJoue`) : sans cette mémoire, la terre serait
   * reprojetée à chaque image et le tertre disparaîtrait sous sa propre gerbe.
   */
  avancer(now: number): Rupture[] {
    const ruptures: Rupture[] = []
    for (const site of this.sites.values()) {
      const reste = site.finAt - now
      const a = borne01(1 - reste / REVEIL_MS)
      if (a > site.avancement) site.avancement = a
      const stade = stadeMonticule(site.avancement)
      if (stade > site.stadeJoue) {
        // LE SOL SE ROMPT D'UN CRAN : la terre part. Le premier cran est le plus discret
        // (ça frémit), les suivants montent — c'est la seule montée d'intensité qu'on ait,
        // et c'est elle qui dit « ça arrive » avant qu'un corps ne soit visible.
        site.stadeJoue = stade
        ruptures.push({ x: site.x, y: site.y, force: 0.4 + 0.25 * stade, stade })
      }
    }
    return ruptures
  }

  /**
   * IL SORT — si ce site est bien un réveil. Rend la `Rupture` du sol qui cède, ou `null`
   * pour une levée de cadavre : celle-là est déjà couchée SUR le sol, elle ne creuse rien et
   * ne reçoit rien ici (décision d'Alexis, 2026-07-31 — on ne livre que le réveil du sol).
   */
  emerger(x: number, y: number, entityId: number, now: number): Rupture | null {
    const cle = cleSite(x, y)
    const site = this.sites.get(cle)
    if (!site) return null
    this.sites.delete(cle)
    this.sorties.set(entityId, now)
    // Le trou reste ouvert derrière lui : c'est la preuve d'où il est venu, et le seul
    // moyen de comprendre après coup ce qui s'est passé si on regardait ailleurs.
    this.residus.push({ x, y, ne: now, vie: MONTICULE_APRES_MS, stade: REVEIL_STADES - 1, etouffe: false })
    // La plus grosse des cinq gerbes : c'est le sol qui cède, pas qui se fend.
    return { x, y, force: 1.5, stade: REVEIL_STADES }
  }

  /**
   * LE FEU A GAGNÉ (`reveil_etouffe`). Le tas s'affaisse et se tait — et c'est un RETOUR
   * DE GESTE : le joueur qui a rallumé doit voir que ça a servi. Sans lui, la parade de R21
   * (« on veille ses morts au feu ») n'a aucune preuve à l'écran.
   */
  etouffer(x: number, y: number, now: number): void {
    const cle = cleSite(x, y)
    const site = this.sites.get(cle)
    // On accepte l'affaissement même sans site connu : l'étouffement peut tomber au tout
    // premier tick d'un réveil, avant que le moindre snapshot ne l'ait montré.
    const stade = site ? stadeMonticule(site.avancement) : 0
    this.sites.delete(cle)
    this.residus.push({ x, y, ne: now, vie: ETOUFFEMENT_MS, stade, etouffe: true })
  }

  /**
   * DE QUELLE PART DE SA HAUTEUR CETTE ENTITÉ EST ENCORE SOUS TERRE — 0 pour tout le monde,
   * sauf pendant l'extraction. C'est la seule chose que `syncActor` demande à ce module.
   */
  enfouissementDe(entityId: number, now: number): number {
    const sortiA = this.sorties.get(entityId)
    if (sortiA === undefined) return 0
    const e = enfouissement(now, sortiA)
    if (e <= 0) {
      this.sorties.delete(entityId) // sorti pour de bon : on cesse de le suivre
      return 0
    }
    return e
  }

  /** Une entité disparaît (mort, dissipation) : elle n'a plus d'extraction en cours. */
  oublier(entityId: number): void {
    this.sorties.delete(entityId)
  }

  /**
   * TOUT CE QU'IL Y A À PEINDRE AU SOL, cette frame — les sols qui travaillent, plus les
   * monticules qui leur survivent. La vue les poole et les trie ; on ne rend que la
   * géométrie (la couleur vient du terrain, et le terrain n'est pas d'ici).
   */
  monticules(now: number): Omit<Monticule, 'teinte'>[] {
    const out: Omit<Monticule, 'teinte'>[] = []
    for (const site of this.sites.values()) {
      out.push({
        x: site.x,
        y: site.y,
        stade: stadeMonticule(site.avancement),
        echelle: echelleMonticule(site.avancement),
        alpha: 1,
      })
    }
    for (let i = this.residus.length - 1; i >= 0; i--) {
      const r = this.residus[i]!
      const age = now - r.ne
      if (age >= r.vie) {
        this.residus.splice(i, 1)
        continue
      }
      const reste = 1 - age / r.vie
      out.push({
        x: r.x,
        y: r.y,
        stade: r.stade,
        // ÉTOUFFÉ, LE TAS REDESCEND — l'échelle repart vers son minimum, le sol se referme
        // sur ce qui n'est pas sorti. SORTI, il reste GRAND ouvert et ne fait que pâlir.
        // Les deux fins ne se ressemblent pas, et c'est tout ce qu'il y a à lire.
        echelle: r.etouffe ? echelleMonticule((reste * (r.stade + 1)) / REVEIL_STADES) : 1,
        alpha: r.etouffe ? reste : Math.min(1, reste * 2.5),
      })
    }
    return out
  }

  /** Combien de sols travaillent — surface de LECTURE pour le smoke test, rien d'autre. */
  get solsAuTravail(): number {
    return this.sites.size
  }

  /** Combien de corps s'extraient — même usage. */
  get extractionsEnCours(): number {
    return this.sorties.size
  }

  /** QUI s'extrait. Le smoke doit pouvoir viser le bon sprite : à l'acte III il y a jusqu'à
   *  cinq Cendreux autour de la proie, et « le dernier de la boucle » n'est pas celui qui
   *  sort du sol. */
  get entitesQuiSortent(): number[] {
    return [...this.sorties.keys()]
  }

  /** Tout s'oublie (changement de scène, nouvelle partie). */
  vider(): void {
    this.sites.clear()
    this.residus.length = 0
    this.sorties.clear()
  }
}

/**
 * LA PEINTURE. Elle possède la scène, les grains de terre, et rien d'autre : toute la
 * décision est dans `SolsAuTravail`, qu'elle pilote. C'est la vue qui poole les tertres
 * (elle seule connaît le relief et la profondeur de tri, comme pour les terriers) ; ici, on
 * ne fait voler que la terre.
 */
export class ReveilFx {
  /** La décision — publique en lecture pour le smoke test, qui interroge l'état réel. */
  readonly sols = new SolsAuTravail()
  private readonly grains: Grain[] = []
  /** La couleur du sol sous une tuile — posée par la vue, qui seule porte la carte. */
  /** LE TERRAIN sous une tuile — posé par la vue, qui seule porte la carte. On prend l'ID du
   *  terrain et pas sa couleur : c'est sa FAMILLE qui décide de ce qui sort du trou, et la
   *  famille ne se retrouve pas dans une couleur. */
  private terrainSous: ((x: number, y: number) => number | null) | undefined

  constructor(private readonly scene: Phaser.Scene) {}

  /** La vue donne son accès au terrain : c'est elle qui porte la carte (`setPeuplement`). */
  setTerrainSous(f: (x: number, y: number) => number | null): void {
    this.terrainSous = f
  }

  private terre(x: number, y: number): number {
    return terreDe(this.terrainSous?.(x, y) ?? null)
  }

  /** Un snapshot arrive — voir `SolsAuTravail.suivre`. */
  suivre(reveils: readonly Reveil[], tick: number, now: number): void {
    this.sols.suivre(reveils, tick, now)
  }

  /**
   * IL SORT — si ce site est bien un réveil, et pas la levée d'un cadavre. Rend `true` quand
   * l'émergence a été reconnue : le sol cède, et la terre part avec.
   */
  emerger(x: number, y: number, entityId: number, now: number): boolean {
    const rupture = this.sols.emerger(x, y, entityId, now)
    if (!rupture) return false
    this.projeter(rupture, now)
    return true
  }

  /** LE FEU A GAGNÉ — voir `SolsAuTravail.etouffer`. Rien ne vole : il ne s'est rien passé. */
  etouffer(x: number, y: number, now: number): void {
    this.sols.etouffer(x, y, now)
  }

  enfouissementDe(entityId: number, now: number): number {
    return this.sols.enfouissementDe(entityId, now)
  }

  oublier(entityId: number): void {
    this.sols.oublier(entityId)
  }

  /** Combien de grains de terre volent — surface de LECTURE pour le smoke test. */
  get grainsVivants(): number {
    return this.grains.length
  }

  /**
   * TOUT CE QU'IL Y A À PEINDRE AU SOL, cette frame — et c'est aussi ici que les crans
   * cèdent, parce que c'est le seul passage qui repasse à chaque image. La teinte s'ajoute
   * ici : la terre remuée prend la couleur du sol dont elle sort.
   */
  monticules(now: number): Monticule[] {
    for (const rupture of this.sols.avancer(now)) this.projeter(rupture, now)
    return this.sols.monticules(now).map((m) => ({ ...m, teinte: this.terre(m.x, m.y) }))
  }

  /**
   * LA TERRE PART. Tour complet (`2π`) : le sol se rompt par en dessous, il n'y a pas de
   * direction à ce geste-là — l'éventail dirigé de `recolte-fx` traduit une hache qui entre
   * par une face, ce n'est pas la même chose.
   *
   * Ce module ne passe pas par `RecolteFx` : sa gerbe est indexée sur un NŒUD (`nodeId`,
   * `NodeType`) et sa couleur s'échantillonne sur le sprite du nœud frappé. Il n'y a ici ni
   * nœud ni sprite — la couleur vient du terrain. On lui emprunte en revanche ce qui est
   * réellement commun : le semis, la nuance en trois valeurs, et l'écrasement de l'axe Y.
   */
  private projeter({ x, y, force, stade }: Rupture, now: number): void {
    const rnd = semis(Math.round(x * 977) + Math.round(y * 3571) + stade * 7919 + 1)
    const ton = this.terre(x, y)
    const combien = Math.max(2, Math.round(LOI_TERRE.n * force))
    const px = x * TILE_PX
    const py = y * TILE_PX
    for (let i = 0; i < combien; i++) {
      // L'éventail est ÉTALÉ, pas tiré au sort (même raison que la gerbe de récolte : un
      // trou dans une poignée de grains se voit). Le désalignement seul est aléatoire.
      const a = ((i + 0.5) / combien + (rnd() - 0.5) * 0.3) * Math.PI * 2
      const v = LOI_TERRE.vitesse[0] + rnd() * (LOI_TERRE.vitesse[1] - LOI_TERRE.vitesse[0])
      const vz = LOI_TERRE.envol[0] + rnd() * (LOI_TERRE.envol[1] - LOI_TERRE.envol[0])
      const cote = LOI_TERRE.taille + (rnd() < 0.3 ? 1 : 0)
      const teinte = nuance(ton, VALEURS[Math.min(VALEURS.length - 1, Math.floor(rnd() * VALEURS.length))]!)
      if (this.grains.length >= MAX_GRAINS) this.grains.shift()?.img.destroy()
      const img = this.scene.add
        .rectangle(Math.round(px), Math.round(py), cote, cote, teinte)
        .setDepth(ySortDepth(y, TILE_PX, TIE_ACTOR))
      this.grains.push({
        img,
        x: px,
        y: py,
        z: 1,
        vx: Math.cos(a) * v,
        // Le monde est vu de DESSUS : l'axe Y de l'écran est de la profondeur, il se
        // parcourt moins vite que la largeur (même écrasement que la gerbe de récolte).
        vy: Math.sin(a) * v * 0.6,
        vz,
        ne: now,
      })
    }
  }

  /**
   * Chaque frame : la terre vole, retombe, se pose, s'efface. `dt` est BORNÉ — l'horloge
   * headless saute (règle maison), et une frame de 400 ms enverrait les mottes à trois
   * tuiles au lieu de les faire retomber.
   */
  update(now: number, dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const g = this.grains[i]!
      const age = now - g.ne
      if (age >= LOI_TERRE.vie) {
        g.img.destroy()
        this.grains.splice(i, 1)
        continue
      }
      g.x += g.vx * dt
      g.y += g.vy * dt
      g.z += g.vz * dt
      g.vz -= LOI_TERRE.g * dt
      if (g.z <= 0) {
        // AU SOL : ça s'arrête net et ça reste posé le temps qu'il reste. C'est cette pause
        // qui fait qu'on VOIT la terre remuée, au lieu d'une pluie qui s'évapore.
        g.z = 0
        g.vx = 0
        g.vy = 0
        g.vz = 0
      }
      g.img.setPosition(Math.round(g.x), Math.round(g.y - g.z))
      g.img.setDepth(ySortDepth(g.y / TILE_PX, TILE_PX, TIE_ACTOR))
      // Elle ne s'éteint que sur le dernier tiers : une motte qui pâlit dès son départ lit
      // comme de la fumée, pas comme de la terre.
      g.img.setAlpha(Math.min(1, (1 - age / LOI_TERRE.vie) * 3))
    }
  }

  /** Tout s'efface (changement de scène, nouvelle partie). */
  detruire(): void {
    for (const g of this.grains) g.img.destroy()
    this.grains.length = 0
    this.sols.vider()
  }
}
