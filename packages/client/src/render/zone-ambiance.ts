/**
 * L'AMBIANCE D'UNE ZONE — « d'un coup d'œil, savoir où l'on est ».
 *
 * C'est le principe n°3 du directeur de jeu, et il n'était PAS tenu : à l'écran, la Vieille Sylve
 * et le Versant Brûlé se ressemblaient. La cause était structurelle, pas cosmétique — **les
 * TERRAINS sont partagés** (de l'herbe pousse aux Prés Bas comme à la Combe aux Ruines), donc
 * aucune palette de terrain ne pourra JAMAIS distinguer deux zones. Il fallait que la ZONE
 * elle-même arrive jusqu'au rendu (`WorldMap.zoneGrid`).
 *
 * ═══ DEUX LEVIERS, ET C'EST TOUT ═══
 *
 * 1. **LE SOL PREND LA TEINTE DE SA ZONE** (`sol`). On ne repeint pas les terrains — on les
 *    *module*. L'herbe reste de l'herbe, mais celle de la Vieille Sylve est froide et sourde,
 *    celle des Prés Bas est chaude et haute. On reconnaît encore ce qu'on foule ; on sait juste
 *    où on le foule.
 *
 * 2. **LA LUMIÈRE DE L'ÉCRAN CHANGE QUAND ON FRANCHIT UN SEUIL** (`air`). C'est le geste de
 *    Valheim, et c'est le plus fort des deux : le monde ne change pas de couleur parce qu'on
 *    regarde ailleurs, il change parce qu'on est ENTRÉ. La bascule se produit dans le couloir du
 *    seuil — soit exactement au moment où le joueur doit comprendre qu'il vient de passer une
 *    porte.
 *
 * On ne touche NI à la géométrie, NI à la logique. C'est du rendu, et rien d'autre.
 */

/** Un facteur multiplicatif par canal — il MODULE le terrain, il ne le remplace pas. */
export interface Ambiance {
  /** Modulation du sol, par canal (R, G, B). 1 = intact. */
  sol: [number, number, number]
  /** La teinte de l'AIR de la zone : la couleur qui se pose sur tout l'écran, et son opacité.
   *  C'est elle qu'on ressent avant de la voir. */
  air: { color: number; alpha: number }
}

/**
 * LA TABLE. Chaque zone doit se reconnaître **en trois secondes**, et se distinguer de sa voisine
 * la plus proche — c'est le vrai test, pas « est-elle jolie ».
 *
 * Les valeurs sont des ORDRES DE GRANDEUR, à corriger à l'œil en jeu. Ce qui n'est PAS négociable,
 * c'est la logique : chaque zone tire vers une famille distincte (chaud/froid, clair/sourd,
 * saturé/gris), et deux zones voisines ne tirent jamais du même côté.
 */
export const ZONE_AMBIANCE: Record<string, Ambiance> = {
  // ── T0 — LA RACINE. Chaude, ouverte, HAUTE en lumière. C'est le jardin, et il doit se
  //    reconnaître à ce qu'on y respire mieux qu'ailleurs. C'est aussi ce qu'on va perdre.
  pres_bas: { sol: [1.14, 1.16, 0.98], air: { color: 0xfff2d0, alpha: 0.06 } },

  // ── T1 — LA CEINTURE. Six leçons, six lumières. ──

  // La futaie ancienne : SOURDE et FROIDE. Il fait pénombre à midi — c'est son thème.
  sylve: { sol: [0.68, 0.82, 0.76], air: { color: 0x0f2418, alpha: 0.3 } },
  // Le calcaire : PÂLE, minéral, sans une once de chaleur. Une lumière plate, de caverne ouverte.
  karst: { sol: [1.06, 1.04, 1.06], air: { color: 0xc9d2dc, alpha: 0.12 } },
  // Le marais : TROUBLE. Vert-brun, épais. L'air y est lourd — la brume s'y ajoutera.
  tourbiere: { sol: [0.84, 0.86, 0.68], air: { color: 0x3d4430, alpha: 0.26 } },
  // L'altitude : LAVÉE, bleue, éblouissante. Le ciel y pèse plus lourd que la terre.
  alpages: { sol: [1.08, 1.12, 1.2], air: { color: 0xd6e8ff, alpha: 0.14 } },
  // Le brûlis : GRIS-BRUN, désaturé, malade. Rien n'y est vert, même ce qui l'est.
  brule: { sol: [0.86, 0.74, 0.66], air: { color: 0x4a3c32, alpha: 0.24 } },
  // Les ruines : POUSSIÉREUSES. Un violet froid de pierre morte, et le silence.
  ruines: { sol: [0.94, 0.9, 1.02], air: { color: 0x5a5468, alpha: 0.2 } },

  // ── T2 — LES MARGES. Elles doivent faire PEUR avant d'être comprises. ──

  // LA CENDRIÈRE : orange et noir. La nuit ne finit jamais, et la braise couve dessous.
  //   C'est celle qu'on verra le plus, puisqu'elle vient nous chercher.
  cendriere: { sol: [1.12, 0.66, 0.5], air: { color: 0x2a0f08, alpha: 0.42 } },
  // Le glacier : BLEU, coupant, sans ombre. Une lumière qui ne réchauffe rien.
  glacier: { sol: [0.96, 1.06, 1.24], air: { color: 0xbcdcf5, alpha: 0.2 } },
  // Les aiguilles : la ROCHE NUE. Gris de plomb, ciel dur.
  aiguilles: { sol: [0.94, 0.94, 1.0], air: { color: 0x6b7280, alpha: 0.18 } },
  // LE GOUFFRE : le NOIR. C'est sa gate — et il faut qu'on le voie de l'entrée.
  gouffre: { sol: [0.5, 0.5, 0.58], air: { color: 0x05060a, alpha: 0.55 } },
  // Le Lac Mort : une eau TROP CLAIRE. Un cyan malade, immobile. Rien n'y vit, et ça se voit.
  lac_mort: { sol: [0.82, 1.04, 1.0], air: { color: 0x86d8cc, alpha: 0.16 } },
}

/** L'ambiance d'une zone — neutre si on ne la connaît pas (une carte sans zones). */
export function ambianceDe(slug: string | undefined): Ambiance {
  return (slug && ZONE_AMBIANCE[slug]) || NEUTRE
}

const NEUTRE: Ambiance = { sol: [1, 1, 1], air: { color: 0x000000, alpha: 0 } }

/** Applique la modulation d'une zone à une couleur de terrain. Borné à l'octet. */
export function moduler(color: number, sol: readonly [number, number, number]): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * sol[0]))
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * sol[1]))
  const b = Math.min(255, Math.round((color & 0xff) * sol[2]))
  return (r << 16) | (g << 8) | b
}
