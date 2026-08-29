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
 * persistance sont l'affaire de ses consommateurs. (Les helpers de cendre de `@ashes/sim` sont
 * eux-mêmes purs : l'import ne change rien à la règle.)
 *
 * ═══ LE SAVOIR-CENDRE (décision d'Alexis, 2026-08-28) ═══
 * La carte ne montre pas la cendre TELLE QU'ELLE EST, elle montre la cendre TELLE QU'ON L'A VUE.
 * Chaque cellule porte donc, en plus de « vu », l'AVANCÉE du foyer qui la revendiquait au moment
 * du dernier passage (`cendreVue`). L'état cendré d'une tuile se REDÉRIVE de ce seul nombre par
 * la loi de `estCendre` (`coût ≤ avancée·ORTHO·(1+grain)`) : rien d'autre à retenir, et le calque
 * de la carte reste une fonction pure de (carte statique, brouillard). Monotone comme `vu` — on
 * ne désapprend pas un front qu'on a regardé avancer.
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

import { foyerDe, type WorldMap } from '@ashes/sim'

/** Côté d'une cellule de brouillard, en tuiles. 8 → une maille fine sans exploser la mémoire
 *  (une carte de production fait ~162 × 243 cellules, soit ~40 ko). Le rendu l'agrandit en
 *  NEAREST : des carrés francs, comme tout le reste du jeu. */
export const FOG_PAS = 8

export interface Brouillard {
  /** 1 = vu, 0 = ignoré. Une cellule vue le reste : on n'oublie pas un pays traversé. */
  vu: Uint8Array
  /** L'AVANCÉE DE LA CENDRE telle qu'on l'a VUE ici — `0` = jamais estampillée, sinon
   *  `1 + round(avancée × 10)` (dixièmes d'unité de coût, plafonnés à l'Uint16). Monotone. */
  cendreVue: Uint16Array
  cols: number
  rows: number
  pas: number
}

/** Un brouillard neuf, entièrement fermé, aux dimensions d'une carte en TUILES. */
export function creerBrouillard(largeurTuiles: number, hauteurTuiles: number, pas = FOG_PAS): Brouillard {
  const cols = Math.max(1, Math.ceil(largeurTuiles / pas))
  const rows = Math.max(1, Math.ceil(hauteurTuiles / pas))
  return { vu: new Uint8Array(cols * rows), cendreVue: new Uint16Array(cols * rows), cols, rows, pas }
}

/** Décode une estampille `cendreVue` en avancée (unités de coût) — `-1` si jamais estampillée. */
export function avanceeVue(b: Brouillard, cellule: number): number {
  const v = b.cendreVue[cellule] ?? 0
  return v === 0 ? -1 : (v - 1) / 10
}

/**
 * ESTAMPILLE LE SAVOIR-CENDRE d'un disque : chaque cellule VUE du disque retient l'avancée
 * courante du foyer qui la revendique — jamais moins que ce qu'elle savait déjà (monotone,
 * comme `vu`). À appeler avec le même disque que `revele`, APRÈS lui : on n'estampille que ce
 * qu'on regarde. Rend `true` si un savoir a changé — le consommateur repeint alors la carte.
 */
export function estampilleCendre(
  b: Brouillard,
  map: WorldMap,
  tuileX: number,
  tuileY: number,
  rayonTuiles: number,
  avancees: readonly number[],
): boolean {
  const champ = map.cendreCout
  if (!champ || avancees.length === 0) return false
  const r = Math.max(0, Math.ceil(rayonTuiles / b.pas))
  const cx = Math.floor(tuileX / b.pas)
  const cy = Math.floor(tuileY / b.pas)
  const r2 = r * r
  let change = false
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy
    if (y < 0 || y >= b.rows) continue
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx
      if (x < 0 || x >= b.cols) continue
      if (dx * dx + dy * dy > r2) continue
      const i = y * b.cols + x
      if (!b.vu[i]) continue
      const f = foyerDeCellule(b, map, x, y)
      if (f < 0) continue // hors d'atteinte de toute fosse : rien à savoir ici, jamais
      const a = avancees[f]
      if (a === undefined) continue
      const code = Math.min(65535, 1 + Math.round(a * 10))
      if (code > (b.cendreVue[i] ?? 0)) {
        b.cendreVue[i] = code
        change = true
      }
    }
  }
  return change
}

/**
 * LA FOSSE QUI REVENDIQUE UNE CELLULE — le premier foyer trouvé parmi ses tuiles (`-1` si
 * aucune n'est atteignable). Les bassins des fosses sont larges de dizaines de tuiles : une
 * cellule de 8 est, en pratique, d'un seul tenant — la couture au partage des eaux perd au
 * pire un dixième de jour d'avancée sur UNE cellule, constat déjà fait par `SignatureCendre`.
 */
function foyerDeCellule(b: Brouillard, map: WorldMap, x: number, y: number): number {
  const x1 = Math.min(map.width, (x + 1) * b.pas)
  const y1 = Math.min(map.height, (y + 1) * b.pas)
  for (let ty = y * b.pas; ty < y1; ty++) {
    for (let tx = x * b.pas; tx < x1; tx++) {
      const f = foyerDe(map.cendreCout, ty * map.width + tx)
      if (f >= 0) return f
    }
  }
  return -1
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

/**
 * DE QUEL MONDE EST CE SAVOIR — l'estampille que porte tout brouillard rangé.
 *
 * La CASE ne suffit pas à nommer une vallée : on refonde dans la même case, et une sauvegarde
 * illisible (bosse de `SAVE_FORMAT_VERSION`, champ neuf dans `SimState`) fait naître un monde
 * NEUF dans la case qu'on croyait reprendre. La SEED ne suffit pas non plus, pour la même
 * raison : refonder la même seed donne une vallée identique mais une partie neuve, où l'on n'a
 * encore rien arpenté.
 *
 * Il faut donc les deux, plus la DATE DE FONDATION (`neA`, horloge murale d'hôte, unique à
 * chaque naissance de monde). C'est le même geste que `deserializePartie`, qui refuse une carte
 * dont la seed n'est pas celle de la partie : un savoir doit dire de quel monde il parle.
 */
export interface IdentiteMonde {
  /** La seed semée — deux vallées de seeds différentes ne partagent aucun savoir. */
  seed: number
  /** L'horloge murale de la FONDATION : ce qui sépare deux mondes de MÊME seed dans la MÊME case. */
  neA: number
}

/** Marque de format en tête du brouillard rangé : `f2|seed|neA|vu|masque|valeurs`. Le canal
 *  cendre est CREUX — un masque des cellules estampillées, puis leurs valeurs seules : tant
 *  qu'on n'a rien vu du front, les deux segments sont vides et la sauvegarde garde son poids
 *  d'origine (~5 ko). Le `f1` d'avant le savoir-cendre (quatre segments, `vu` seul) se relit
 *  encore : une sauvegarde existante garde sa carte, elle n'a juste encore rien vu du front. */
const EN_TETE = 'f2'
const EN_TETE_V1 = 'f1'

/**
 * Là où le savoir géographique du joueur dort entre deux sessions — UNE CLÉ PAR MONDE.
 *
 * Le brouillard vit dans `localStorage`, hors de la sauvegarde de sim (IndexedDB) : il a donc
 * fallu le numéroter à part quand la Veillée est passée à cinq cases (2026-07-28). Sans ça, la
 * vallée 2 s'ouvrait avec la carte explorée de la vallée 1 — un monde neuf sans rien à découvrir.
 *
 * La case 0 GARDE L'ANCIENNE CLÉ : les Veillées d'avant l'écran des mondes retrouvent leur
 * carte sans migration, comme leur sauvegarde retrouve la sienne (`slot0`).
 *
 * LA CLÉ NE FAIT PAS L'IDENTITÉ, et c'était le bug (2026-07-30) : ranger par case suppose que
 * la case ne contient qu'un monde dans sa vie. C'est l'estampille (`IdentiteMonde`), pas la clé,
 * qui dit de quelle vallée est le savoir — voir `depackBrouillard`.
 */
const FOG_KEY = 'braises.fog'
const cleFog = (slot: number): string => (slot === 0 ? FOG_KEY : `${FOG_KEY}.${slot}`)

/** Relit le brouillard rangé d'un monde, ou `null` (première Veillée, stockage refusé). */
export function loadFog(slot: number): string | null {
  try {
    return localStorage.getItem(cleFog(slot))
  } catch {
    return null // stockage refusé : on jouera sans mémoire, plutôt que de casser
  }
}

/** Range le brouillard. Silencieux en cas de refus : perdre la carte ne doit pas perdre la partie. */
export function saveFog(slot: number, texte: string): void {
  try {
    localStorage.setItem(cleFog(slot), texte)
  } catch {
    /* stockage plein ou refusé : le savoir vaut pour la session */
  }
}

/** Efface le savoir géographique d'un monde — Veillée NEUVE, ou case effacée. */
export function clearFog(slot: number): void {
  try {
    localStorage.removeItem(cleFog(slot))
  } catch {
    /* rien à faire : au pire on rouvre avec l'ancienne carte */
  }
}

/** Octets → base64 maison (l'alphabet `B64`, padding zéro). */
function tasse(octets: Uint8Array): string {
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

/** Base64 maison → octets, ou `null` si la longueur ne colle pas à `taille` octets attendus. */
function detasse(charge: string, taille: number): Uint8Array | null {
  if (charge.length !== Math.ceil(taille / 3) * 4) return null
  const octets = new Uint8Array(taille)
  let o = 0
  for (let i = 0; i < charge.length; i += 4) {
    const n =
      (B64.indexOf(charge[i]!) << 18) |
      (B64.indexOf(charge[i + 1]!) << 12) |
      (B64.indexOf(charge[i + 2]!) << 6) |
      B64.indexOf(charge[i + 3]!)
    if (o < taille) octets[o++] = (n >> 16) & 0xff
    if (o < taille) octets[o++] = (n >> 8) & 0xff
    if (o < taille) octets[o++] = n & 0xff
  }
  return octets
}

/** Tasse le brouillard en base64 — `vu` à un bit par cellule, le savoir-cendre en CREUX
 *  (masque un bit + deux octets par cellule estampillée) — ESTAMPILLÉ du monde qu'il décrit. */
export function packBrouillard(b: Brouillard, monde: IdentiteMonde): string {
  const octets = new Uint8Array(Math.ceil(b.vu.length / 8))
  for (let i = 0; i < b.vu.length; i++) {
    if (b.vu[i]) octets[i >> 3]! |= 1 << (i & 7)
  }
  const estampillees: number[] = []
  for (let i = 0; i < b.cendreVue.length; i++) {
    if (b.cendreVue[i]! > 0) estampillees.push(i)
  }
  let masque = ''
  let valeurs = ''
  if (estampillees.length > 0) {
    const bits = new Uint8Array(Math.ceil(b.cendreVue.length / 8))
    const deux = new Uint8Array(estampillees.length * 2)
    for (let k = 0; k < estampillees.length; k++) {
      const i = estampillees[k]!
      bits[i >> 3]! |= 1 << (i & 7)
      const v = b.cendreVue[i]!
      deux[k * 2] = (v >> 8) & 0xff
      deux[k * 2 + 1] = v & 0xff
    }
    masque = tasse(bits)
    valeurs = tasse(deux)
  }
  return `${EN_TETE}|${monde.seed}|${monde.neA}|${tasse(octets)}|${masque}|${valeurs}`
}

/**
 * Relit un brouillard tassé — et REFUSE tout ce qui ne vient pas EXACTEMENT de ce monde-ci.
 *
 * Deux gardes, et il en fallait deux :
 *  1. L'ESTAMPILLE (seed + date de fondation). Sans elle, une vallée refondée — ou régénérée
 *     parce que sa sauvegarde était devenue illisible — rouvrait avec la carte de la
 *     précédente : « une partie de la carte déjà découverte » dans une partie neuve.
 *  2. LES DIMENSIONS, qui ne sont pas dans la chaîne : elles viennent de la carte courante.
 *     Elle ne suffisait pas seule, et c'est le fond de l'affaire — `tailleCarte()` ne dépend
 *     que du nombre de joueurs cible, pas de la seed. Toutes les vallées font la même taille :
 *     cette garde ne pouvait donc RIEN refuser.
 *
 * Dans les deux cas on rend un brouillard NEUF plutôt qu'un décalage silencieux — mieux vaut
 * tout redécouvrir qu'afficher un savoir faux. Une chaîne d'AVANT l'estampille (sans en-tête)
 * tombe dans le même refus : elle ne dit pas de quel monde elle est, on ne la croit pas.
 */
export function depackBrouillard(
  texte: string,
  monde: IdentiteMonde,
  largeurTuiles: number,
  hauteurTuiles: number,
  pas = FOG_PAS,
): Brouillard {
  const b = creerBrouillard(largeurTuiles, hauteurTuiles, pas)
  const parts = texte.split('|')
  // Deux formats se relisent : `f2` (vu + savoir-cendre creux) et le `f1` d'avant lui.
  const v2 = parts.length === 6 && parts[0] === EN_TETE
  const v1 = parts.length === 4 && parts[0] === EN_TETE_V1
  if (!v2 && !v1) return b
  if (Number(parts[1]) !== monde.seed || Number(parts[2]) !== monde.neA) return b
  // LA GARDE DE LONGUEUR PORTE SUR LA CHARGE UTILE, pas sur la chaîne entière : la mesurer
  // en-tête compris refuserait tout brouillard estampillé, et la reprise perdrait sa carte.
  const octets = detasse(parts[3]!, Math.ceil(b.vu.length / 8))
  if (!octets) return b
  for (let i = 0; i < b.vu.length; i++) {
    b.vu[i] = (octets[i >> 3]! >> (i & 7)) & 1
  }
  // Un canal cendre illisible ne coûte que le savoir-cendre : la carte arpentée, elle, est
  // déjà relue — on ne jette pas le tout pour la moitié. Segments vides = rien vu du front.
  if (v2 && parts[4] !== '') {
    const bits = detasse(parts[4]!, Math.ceil(b.cendreVue.length / 8))
    if (bits) {
      const estampillees: number[] = []
      for (let i = 0; i < b.cendreVue.length; i++) {
        if ((bits[i >> 3]! >> (i & 7)) & 1) estampillees.push(i)
      }
      const deux = detasse(parts[5]!, estampillees.length * 2)
      if (deux) {
        for (let k = 0; k < estampillees.length; k++) {
          b.cendreVue[estampillees[k]!] = ((deux[k * 2]! << 8) | deux[k * 2 + 1]!) & 0xffff
        }
      }
    }
  }
  return b
}

/**
 * PORTÉE DE DÉVOILEMENT, en tuiles. La caméra montre ~35 tuiles de haut : révéler ~22 tuiles
 * à la ronde correspond honnêtement à « je l'ai vu de mes yeux », sans offrir la carte à qui
 * reste assis. Calibration — à régler à l'œil sur la vraie carte.
 */
export const FOG_RAYON_TUILES = 22
