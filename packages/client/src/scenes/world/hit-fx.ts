/**
 * LE TRESSAILLEMENT DU NŒUD FRAPPÉ (spec recolte.md G10).
 *
 * Le coup qui porte se voit à DEUX endroits, et deux seulement : ici, le nœud
 * tressaille ; et dans le HUD, le butin s'inscrit (`ui/pickup-toasts.ts`).
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

export class HitFx {
  /** Dernier coup reçu PAR NŒUD (id → instant). `snapshot-view` y lit le tressaillement. */
  private readonly hits = new Map<number, number>()

  hit(nodeId: number, now: number): void {
    this.hits.set(nodeId, now)
  }

  hitAt(nodeId: number): number | undefined {
    return this.hits.get(nodeId)
  }

  /** À chaque frame : la mémoire des coups s'oublie (elle ne sert qu'au tressaillement). */
  update(now: number): void {
    for (const [nodeId, at] of this.hits) {
      if (now - at > HIT_MEMORY_MS) this.hits.delete(nodeId)
    }
  }
}
