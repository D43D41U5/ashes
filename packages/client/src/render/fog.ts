/**
 * LE BROUILLARD DE GUERRE — « la carte se découvre EN MARCHANT » (spec worldgen R19).
 *
 * Décision d'Alexis du 2026-07-14, inscrite en spec et restée non implémentée : *« la carte se
 * découvrira selon l'exploration du joueur, pour pousser à chercher »*. Jusqu'ici le client ne
 * masquait que les PASTILLES de lieux (`knownPois`) ; le sol, lui, était montré en entier — donc
 * la forme de la vallée était acquise dès la première seconde, et il ne restait rien à découvrir.
 *
 * CE QUI REND LA RÈGLE JOUABLE, et c'est la spec qui le dit (`lieux.md` R2bis) : les FALAISES.
 * L'objection d'origine — « un brouillard punirait l'orientation » — supposait un terrain sans
 * arêtes, où l'on erre. Une falaise a un bord : on la longe, on tombe sur la brèche. **On ne
 * trouve pas une porte, on suit un mur.** Les falaises existent (`cliff-layer`), donc la
 * condition est remplie.
 *
 * ═══ CE MODULE EST PUR ═══
 * Aucun Phaser, aucun DOM : une grille d'octets, des entiers, et rien d'autre. Le rendu et la
 * persistance sont l'affaire de ses consommateurs.
 *
 * ═══ PORTÉE ASSUMÉE ═══
 * Le brouillard vit CÔTÉ CLIENT, pas dans `/sim`. Raison : il ne commande aucune règle de jeu
 * (rien ne dépend de « ai-je vu cette tuile ») — c'est de l'affichage de savoir, et le mettre
 * dans l'état de sim ferait enfler CHAQUE snapshot de ~40 000 cellules par joueur, pour une
 * information qui ne change qu'en marchant. R20 (« le brouillard se PARTAGE dans le village »,
 * le savoir géographique comme bien qu'on troque) exigera, lui, de le remonter dans `/sim` :
 * c'est un chantier d'alignement/multi, pas de la Veillée solo. À faire quand le multi le
 * demandera, pas avant.
 */

/** Côté d'une cellule de brouillard, en tuiles. 8 → une maille fine sans exploser la mémoire
 *  (une carte de production fait ~162 × 243 cellules, soit ~40 ko). Le rendu l'agrandit en
 *  NEAREST : des carrés francs, comme tout le reste du jeu. */
export const FOG_PAS = 8

export interface Brouillard {
  /** 1 = vu, 0 = ignoré. Une cellule vue le reste : on n'oublie pas un pays traversé. */
  vu: Uint8Array
  cols: number
  rows: number
  pas: number
}

/** Un brouillard neuf, entièrement fermé, aux dimensions d'une carte en TUILES. */
export function creerBrouillard(largeurTuiles: number, hauteurTuiles: number, pas = FOG_PAS): Brouillard {
  const cols = Math.max(1, Math.ceil(largeurTuiles / pas))
  const rows = Math.max(1, Math.ceil(hauteurTuiles / pas))
  return { vu: new Uint8Array(cols * rows), cols, rows, pas }
}

/**
 * DÉVOILE un disque autour d'une position en tuiles. Rend `true` si quelque chose de neuf est
 * apparu — le consommateur s'en sert pour ne repeindre le calque QUE quand la carte a changé,
 * au lieu de le refaire à chaque frame.
 *
 * Disque et non carré : on voit à la ronde. Comparaison au carré des distances, donc aucune
 * racine et aucun flottant — même esprit d'arithmétique franche que `/sim`.
 */
export function revele(b: Brouillard, tuileX: number, tuileY: number, rayonTuiles: number): boolean {
  const r = Math.max(0, Math.ceil(rayonTuiles / b.pas))
  const cx = Math.floor(tuileX / b.pas)
  const cy = Math.floor(tuileY / b.pas)
  const r2 = r * r
  let neuf = false
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy
    if (y < 0 || y >= b.rows) continue
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx
      if (x < 0 || x >= b.cols) continue
      if (dx * dx + dy * dy > r2) continue
      const i = y * b.cols + x
      if (b.vu[i]) continue
      b.vu[i] = 1
      neuf = true
    }
  }
  return neuf
}

/** Cette tuile a-t-elle été vue ? (Hors carte = non vue : on ne dévoile pas le néant.) */
export function estVu(b: Brouillard, tuileX: number, tuileY: number): boolean {
  const x = Math.floor(tuileX / b.pas)
  const y = Math.floor(tuileY / b.pas)
  if (x < 0 || y < 0 || x >= b.cols || y >= b.rows) return false
  return b.vu[y * b.cols + x] === 1
}

/** La part de carte découverte, entre 0 et 1 — de quoi la DIRE au joueur (« 12 % arpentés »). */
export function partDecouverte(b: Brouillard): number {
  let n = 0
  for (let i = 0; i < b.vu.length; i++) n += b.vu[i]!
  return b.vu.length === 0 ? 0 : n / b.vu.length
}

// ── PERSISTANCE ──────────────────────────────────────────────────────────────────────────
// Un brouillard de ~40 000 cellules sérialisé en tableau JSON pèserait ~80 ko de chiffres.
// On le tasse à un BIT par cellule (~5 ko) puis en base64 : la sauvegarde reste légère, et
// le format est du texte, donc transportable partout (IndexedDB, réseau, journal).

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Là où le savoir géographique du joueur dort entre deux sessions. */
const FOG_KEY = 'braises.fog'

/** Relit le brouillard rangé, ou `null` s'il n'y en a pas (première Veillée, stockage refusé). */
export function loadFog(): string | null {
  try {
    return localStorage.getItem(FOG_KEY)
  } catch {
    return null // stockage refusé : on jouera sans mémoire, plutôt que de casser
  }
}

/** Range le brouillard. Silencieux en cas de refus : perdre la carte ne doit pas perdre la partie. */
export function saveFog(texte: string): void {
  try {
    localStorage.setItem(FOG_KEY, texte)
  } catch {
    /* stockage plein ou refusé : le savoir vaut pour la session */
  }
}

/** Efface le savoir géographique — appelé quand on repart sur une Veillée NEUVE. */
export function clearFog(): void {
  try {
    localStorage.removeItem(FOG_KEY)
  } catch {
    /* rien à faire : au pire on rouvre avec l'ancienne carte */
  }
}

/** Tasse le brouillard en base64, un bit par cellule. */
export function packBrouillard(b: Brouillard): string {
  const octets = new Uint8Array(Math.ceil(b.vu.length / 8))
  for (let i = 0; i < b.vu.length; i++) {
    if (b.vu[i]) octets[i >> 3]! |= 1 << (i & 7)
  }
  let out = ''
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i] ?? 0
    const c = octets[i + 1] ?? 0
    const d = octets[i + 2] ?? 0
    const n = (a << 16) | (c << 8) | d
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  return out
}

/**
 * Relit un brouillard tassé. Les DIMENSIONS ne sont pas dans la chaîne : elles viennent de la
 * carte courante. Si elles ne correspondent plus (carte régénérée, taille changée), on rend un
 * brouillard NEUF plutôt qu'un décalage silencieux — mieux vaut tout redécouvrir qu'afficher
 * un savoir faux.
 */
export function depackBrouillard(texte: string, largeurTuiles: number, hauteurTuiles: number, pas = FOG_PAS): Brouillard {
  const b = creerBrouillard(largeurTuiles, hauteurTuiles, pas)
  const attendus = Math.ceil(Math.ceil(b.vu.length / 8) / 3) * 4
  if (texte.length !== attendus) return b
  const octets = new Uint8Array(Math.ceil(b.vu.length / 8))
  let o = 0
  for (let i = 0; i < texte.length; i += 4) {
    const n =
      (B64.indexOf(texte[i]!) << 18) |
      (B64.indexOf(texte[i + 1]!) << 12) |
      (B64.indexOf(texte[i + 2]!) << 6) |
      B64.indexOf(texte[i + 3]!)
    if (o < octets.length) octets[o++] = (n >> 16) & 0xff
    if (o < octets.length) octets[o++] = (n >> 8) & 0xff
    if (o < octets.length) octets[o++] = n & 0xff
  }
  for (let i = 0; i < b.vu.length; i++) {
    b.vu[i] = (octets[i >> 3]! >> (i & 7)) & 1
  }
  return b
}

/**
 * PORTÉE DE DÉVOILEMENT, en tuiles. La caméra montre ~35 tuiles de haut : révéler ~22 tuiles
 * à la ronde correspond honnêtement à « je l'ai vu de mes yeux », sans offrir la carte à qui
 * reste assis. Calibration — à régler à l'œil sur la vraie carte.
 */
export const FOG_RAYON_TUILES = 22
