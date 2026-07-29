/**
 * LA MÉMOIRE DES COUPS PORTÉS — et le TRESSAILLEMENT du nœud frappé (spec recolte.md G10).
 *
 * Le coup qui porte se voit à TROIS endroits : ici, le nœud tressaille ; la matière
 * gicle (`recolte-fx.ts`, ajouté le 2026-07-29) ; et dans le HUD, le butin s'inscrit
 * (chaîne `hud-bridge.publishPickup` → `UIScene.drainPickups` → `hud-core.pushToast`).
 *
 * Le « +1 bois » a d'abord été affiché AU-DESSUS DU NŒUD, dans le monde. Ça
 * marchait, la donnée le prouvait — mais dans une forêt dense, un petit texte
 * blanc sur du feuillage vert sombre ne se lit pas. Le butin est parti dans le
 * HUD, à une place fixe que l'œil apprend ; il ne reste ici que le frisson.
 *
 * IL NAÎT DE L'ÉVÉNEMENT, PAS DU GESTE : rien ne bouge au clic, on attend le
 * `resource_harvested` du snapshot. Le client ne PRÉDIT pas un succès qu'il n'a
 * pas (invariant §3 : le serveur fait foi).
 *
 * Les sprites de nœuds sont POOLÉS et reconstruits chaque frame par
 * `snapshot-view` : elle seule peut appliquer le décalage. On ne tient donc ici
 * que la MÉMOIRE des coups.
 *
 * Cette mémoire porte AUSSI d'où le coup est venu (`fromX/fromY`, la position du
 * RÉCOLTEUR) et ce qu'il a rapporté (`count`, `clean`) : les éclats en tirent leur
 * direction de projection et leur épaisseur. C'est la position du récolteur, pas
 * « celle du joueur » — le jour où le multi ouvrira ce retour aux autres entités, il
 * n'y aura rien à changer ici.
 */

/** Durée du tressaillement (ms). Court : c'est un frisson, pas une danse. */
export const SHAKE_MS = 180
/** Amplitude, en pixels-monde. */
const SHAKE_PX = 1.6
/** Au-delà, la trace d'un coup ne sert plus à rien. */
const HIT_MEMORY_MS = SHAKE_MS + 40

/**
 * Le décalage à l'instant `now`, pour un nœud frappé à `hitAt`. Oscillation
 * AMORTIE : elle part fort et meurt. Un tremblement d'amplitude constante lirait
 * comme un bug de rendu, pas comme un impact.
 */
export function shakeOffset(now: number, hitAt: number): number {
  const t = now - hitAt
  if (t < 0 || t >= SHAKE_MS) return 0
  const decay = 1 - t / SHAKE_MS
  // `Math.sin` est ici parfaitement légitime : c'est du RENDU client, pas de la
  // sim — aucune contrainte de déterminisme inter-moteurs.
  return Math.sin((t / SHAKE_MS) * Math.PI * 5) * SHAKE_PX * decay * decay
}

/** UN COUP PORTÉ, tel que la sim l'a raconté — plus l'endroit d'où il partait. */
export interface Coup {
  /** Instant du coup (horloge Phaser, ms). */
  at: number
  /** Le RÉCOLTEUR, en px monde : la face frappée est celle qui lui fait face. */
  fromX: number
  fromY: number
  /** Ce que le coup a rapporté (`resource_harvested.count`). */
  count: number
  /** Frappe NETTE (spec recolte-maitrise) : le coup dans le vert. */
  clean: boolean
}

export class HitFx {
  /** Dernier coup reçu PAR NŒUD. `snapshot-view` y lit le tressaillement ET la gerbe. */
  private readonly hits = new Map<number, Coup>()

  hit(nodeId: number, now: number, fromX: number, fromY: number, count = 1, clean = false): void {
    this.hits.set(nodeId, { at: now, fromX, fromY, count, clean })
  }

  hitAt(nodeId: number): number | undefined {
    return this.hits.get(nodeId)?.at
  }

  /** Le coup entier — d'où il vient et ce qu'il a rapporté (lu par `recolte-fx`). */
  coup(nodeId: number): Coup | undefined {
    return this.hits.get(nodeId)
  }

  /** À chaque frame : la mémoire des coups s'oublie (elle ne sert qu'au retour de frappe). */
  update(now: number): void {
    for (const [nodeId, c] of this.hits) {
      if (now - c.at > HIT_MEMORY_MS) this.hits.delete(nodeId)
    }
  }
}
