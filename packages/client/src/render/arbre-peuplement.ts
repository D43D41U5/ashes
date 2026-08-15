/**
 * ═══ QUEL ARBRE POUSSE ICI — le peuplement, par zone et par sol ═══
 *
 * *Demande d'Alexis, 2026-07-29 : « implémente toutes les variations en prenant en compte une
 * densité logique de tel ou tel arbre par zone ».*
 *
 * LE PROBLÈME QU'ON RÈGLE. `snapshot-view` choisissait le sprite d'un arbre sur le TYPE DE NŒUD
 * (`tree` / `old_tree`) et rien d'autre. Un seul sprite pour tous les arbres ordinaires de la
 * carte : douze exemplaires par écran, identiques au pixel près — ça ne fait pas un bois, ça
 * fait une grille. Et les bosquets de crête, posés la veille sur du pin et du mélèze, portaient
 * la canopée des feuillus : de loin, un bois sec et une ripisylve avaient la même silhouette.
 *
 * ═══ DEUX ENTRÉES, DANS CET ORDRE ═══
 *
 *   1. **LE SOL décide de la FAMILLE.** Une tuile de pin ou de mélèze porte un conifère, où
 *      qu'elle soit. C'est le worldgen qui a déjà tranché où pousse quoi (`solDe` sème le
 *      `HAUT_BOIS` dans les zones hautes, `peindreLesBosquetsDeCrete` coiffe les dos secs de la
 *      Racine) — on ne le redécide pas ici, on le LIT.
 *   2. **LA ZONE décide du MÉLANGE de feuillus.** Chaque pays a sa table, tirée de son thème
 *      (GDD §8bis, `worldgen.md` §3) et non d'un goût : le bouleau est un PIONNIER, il colonise
 *      ce qu'on a abandonné et ce qui a brûlé ; le hêtre fait les futaies fermées ; le saule et
 *      le bouleau tiennent les tourbières ; le calcaire du Karst ne nourrit que du conifère.
 *
 * ═══ PUR, DÉTERMINISTE, SANS ÉTAT ═══
 *
 * Le tirage est un `hash2(tx, ty, seed)` : le même arbre est TOUJOURS le même, rien ne transite,
 * rien ne se mémorise. `/sim` ignore que ces variantes existent — ce sont des PEAUX du nœud
 * `tree`, pas des nœuds : aucun `NODE_DEFS`, aucun protocole, aucun flux RNG touché. C'est ce
 * qui rend le changement gratuit côté simulation, et réversible côté client.
 */
import { hash2, zoneSlugAt, TERRAIN_GRASS, TERRAIN_LARCH, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_WILLOW, type WorldMap } from '@ashes/sim'
import { CIMES_PAR_ARBRE, VARIANTES, type VarianteArbre } from './arbre-art'

/** Un mélange : des slugs de variante et leurs poids RELATIFS (ils n'ont pas à sommer à 1). */
type Melange = readonly (readonly [string, number])[]

/**
 * ═══ LES MÉLANGES DE FEUILLUS, PAR ZONE ═══
 *
 * Chaque ligne se justifie par le THÈME de sa zone, jamais par un équilibre abstrait. Une zone
 * absente de la table prend `DEFAUT` — et une zone où rien ne pousse (les Alpages, « zéro
 * arbre » ; le Névé ; le Glacier) n'a de toute façon aucun terrain qui admette l'arbre : la
 * table n'a pas à l'interdire, le sol le fait déjà.
 */
const MELANGE_PAR_ZONE: Record<string, Melange> = {
  // LA RACINE — un fond de vallée vivant : le chêne domine, tout le reste l'accompagne. Le
  // baliveau est nombreux parce qu'un pré reboisé est jeune.
  pres_bas: [['tree', 38], ['hetre', 18], ['saule', 12], ['bouleau', 12], ['baliveau', 20]],

  // LA VIEILLE SYLVE — « futaie ancienne, canopée fermée, pénombre à midi ». Le hêtre EST
  // l'arbre de la futaie fermée. Pas de bouleau : un pionnier ne pousse pas sous un couvert
  // qui ne laisse pas passer la lumière — son absence dit l'âge du bois mieux qu'un ton sombre.
  //
  // ⚠ CE MÉLANGE NE COUVRE QUE 41 % DE LA SYLVE (MESURÉ, seed 2026) : ses 59 % restants sont du
  // PIN et du MÉLÈZE, parce que `solDe` peint le `HAUT_BOIS` sur les taches de toute zone de
  // palier > 0 — le sol de la Sylve DIT DÉJÀ le conifère depuis toujours, seuls ses arbres
  // disaient le feuillu. Ce n'est donc pas une dérive introduite ici, c'est une incohérence
  // ancienne que la lecture du sol met au jour. À trancher par Alexis, pas par ce fichier.
  sylve: [['hetre', 46], ['tree', 34], ['baliveau', 20]],

  // LE VERSANT BRÛLÉ — « la forêt qui a brûlé. C'est là que ça a commencé. » Ce qui repousse
  // après un feu, ce sont les PIONNIERS : bouleau et jeunes tiges. Aucun grand arbre — il n'a
  // pas eu le temps. (Son sol est du calciné, qui admet l'arbre : la ligne TIRE bel et bien.)
  brule: [['bouleau', 52], ['baliveau', 48]],

  // LA CENDRIÈRE — même sol calciné, mêmes rescapés, mais rien n'y repart vraiment : que des
  // tiges. C'est la seule zone T2 qui porte des arbres, et ils sont maigres.
  cendriere: [['baliveau', 70], ['bouleau', 30]],

  // ═══ CE QUI N'EST PAS ICI, ET POURQUOI — la leçon d'A19, payée ailleurs ═══
  //
  // La première écriture de cette table donnait aussi une ligne au KARST, à la TOURBIÈRE, à la
  // COMBE AUX RUINES et au LAC MORT — les deux plus belles, d'ailleurs : le bouleau pionnier
  // reprenant la terre qu'on a quittée, le saule et le bouleau tenant l'eau acide.
  //
  // ELLES ÉTAIENT MORTES. MESURÉ sur la seed 2026 : ces quatre zones portent **zéro arbre**.
  // Leurs palettes ne posent aucun sol que `terrainAdmet('tree', …)` accepte — scree, boulders,
  // rock pour le Karst ; peat_bog, reed_marsh, shallow_water pour la Tourbière ; heath, grass,
  // boulders pour les Ruines. (L'herbe ne porte des arbres que dans la RACINE, par la passe
  // dédiée `arbresDeLaRacine`.)
  //
  // `worldgen.md` A19 existe pour exactement ça — *« la table des zones ne ment pas : trois
  // lignes de la table étaient mortes dans l'ancienne carte »* — et `EAU` le redit à sa façon :
  // *« un bouton mort finit toujours par être tourné »*. Une ligne qui décrit un arbre qui ne
  // peut pas exister est un mensonge qui a l'air d'une intention. Elles sont donc RETIRÉES, et
  // une garde (V13) échoue si l'une d'elles revient sans que le worldgen ait changé d'avis.
  //
  // POUR LES RESSUSCITER, il faut d'abord que ces zones admettent l'arbre — c'est une décision
  // de WORLDGEN (une palette qui pose de la forêt, ou une passe comme les bosquets de crête),
  // pas de rendu.
}

/** Faute de ligne dédiée : le mélange du fond de vallée, qui est le plus neutre. */
const DEFAUT: Melange = [['tree', 50], ['hetre', 26], ['baliveau', 24]]

/**
 * LES CONIFÈRES, PAR SOL. Un peuplement de pins n'est pas une monoculture, et un peuplement de
 * mélèzes non plus : chaque sol donne sa dominante et laisse un tiers aux autres.
 */
/**
 * LA FUTAIE FERMÉE — sur `old_growth`, quelle que soit la zone.
 *
 * VU DANS LE JEU, et c'est une contradiction que j'avais écrite moi-même deux fichiers plus
 * haut : le Bois Noir (« une mini-sylve — sol `old_growth`, futaie dense, sombre ») se
 * couvrait de BOULEAUX, parce qu'il est un set-piece DANS la Racine et héritait donc du
 * mélange de la Racine. Or j'exclus le bouleau de la Sylve pour une raison qui vaut ici mot
 * pour mot : *un pionnier ne pousse pas sous un couvert qui ne laisse pas passer la lumière.*
 *
 * Le SOL refine donc le mélange, il ne fait pas que choisir la famille. `old_growth` EST la
 * déclaration « ici, le couvert est fermé » — la lire est plus juste que d'énumérer les
 * set-pieces, et ça vaudra pour ceux qu'on ajoutera.
 */
const MELANGE_FUTAIE: Melange = [['hetre', 48], ['tree', 36], ['baliveau', 16]]

const MELANGE_PIN: Melange = [['pin', 44], ['vieux_pin', 30], ['sapin', 26]]
const MELANGE_MELEZE: Melange = [['meleze', 62], ['sapin', 22], ['pin', 16]]

/**
 * ═══ LE PRÉ — et c'est la CONCURRENCE qui parle, pas l'espèce ═══
 *
 * *Relevé photographique du 2026-07-29, confronté à l'espacement mesuré sur la carte.*
 *
 * Un hêtre de futaie est une colonne sans une branche sur les deux tiers de sa hauteur ; un
 * hêtre isolé a des branches qui touchent l'herbe. **Même espèce, deux ports** — et c'est le
 * voisin qui décide, pas la botanique. Cette table variait par espèce et par zone, jamais par
 * DENSITÉ.
 *
 * Or la densité, elle, est mesurée : distance médiane au plus proche voisin, seed 2026,
 * 34 479 arbres — `forest` (ubac) **1,00 tuile**, `pine`/`larch` 2,24, `old_growth` 3,00,
 * `grass` **4,12**. Dans l'ubac, à 16 px d'écart pour des cimes de 32, le couvert est déjà
 * saturé : il n'y a pas un pixel de marge, et `tree` n'y est pas touché. Sur l'herbe, à 66 px,
 * une cime large reste ISOLÉE — c'est le seul terrain du jeu qui autorise la forme de plein
 * champ.
 *
 * Le HÊTRE en est absent, et c'est le sens même de la règle : c'est l'arbre de la futaie fermée,
 * il n'a rien à faire seul au milieu d'un pré.
 *
 * (L'herbe ne porte des arbres que dans la RACINE, par la passe dédiée `arbresDeLaRacine` — cf.
 * la note d'A19 plus haut. Lire le SOL suffit donc à dire « le pré », sans énumérer les zones.)
 */
const MELANGE_PRE: Melange = [['chene_pre', 46], ['saule', 16], ['bouleau', 14], ['baliveau', 24]]

/**
 * LA SAULAIE (spec t0-exploration §2ter R34) — la galerie de berge : le saule DOMINE, c'est
 * lui qui dit « ici, l'eau coule ». Le bouleau l'accompagne (l'autre arbre des sols frais),
 * le baliveau fait la relève. Ni chêne ni hêtre : ce sont les arbres du sec et de la futaie.
 */
const MELANGE_SAULAIE: Melange = [['saule', 58], ['bouleau', 22], ['baliveau', 20]]

/** Tire dans un mélange, en fonction d'un hachage [0,1). Total pré-calculé à chaque appel :
 *  cinq additions, contre une table à maintenir en parallèle qui finirait par diverger. */
function tirer(m: Melange, h: number): string {
  let total = 0
  for (const [, p] of m) total += p
  let seuil = h * total
  for (const [slug, p] of m) {
    seuil -= p
    if (seuil < 0) return slug
  }
  return m[m.length - 1]![0]
}

/** La seed du monde — le sel des hachages de variante. Distinct de ceux du clutter (0x2000…). */
const SEL = 0x7a2b

/**
 * LA VARIANTE d'un arbre ordinaire posé en (tx, ty). Pure et déterministe.
 *
 * `vieux` court-circuite tout : le GROS BOIS n'a pas de variantes, et il ne doit pas en avoir —
 * sa silhouette est une information de JEU (il donne le gros bois, ressource structurante de la
 * Sylve), pas une texture. Le diluer en quatre versions brouillerait la seule chose qu'il dit.
 */
export function varianteArbre(map: WorldMap, tx: number, ty: number, seed: number, vieux: boolean): VarianteArbre {
  if (vieux) return VARIANTES.old_tree!
  // BORNÉE. Hors carte, il n'y a ni sol ni zone à lire : on rend l'arbre ordinaire plutôt que de
  // laisser un `undefined` tomber dans le mélange de la zone — attrapé par sa propre garde, qui
  // interrogeait des tuiles hors du damier et recevait des feuillus sur du pin.
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return VARIANTES.tree!
  const i = ty * map.width + tx
  const sol = map.terrain[i]
  // ① LE SOL décide de la famille — le worldgen a déjà tranché où pousse le conifère.
  if (sol === TERRAIN_PINE || sol === TERRAIN_LARCH) {
    const m = sol === TERRAIN_LARCH ? MELANGE_MELEZE : MELANGE_PIN
    return VARIANTES[tirer(m, hash2(tx, ty, (seed ^ SEL) | 0))] ?? VARIANTES.tree!
  }
  // ② LA FUTAIE FERMÉE l'emporte sur la zone : sous `old_growth`, pas de pionnier.
  if (sol === TERRAIN_OLD_GROWTH) {
    return VARIANTES[tirer(MELANGE_FUTAIE, hash2(tx, ty, (seed ^ SEL) | 0))] ?? VARIANTES.tree!
  }
  // ②ter LA SAULAIE : le sol de berge a son mélange — le saule domine (spec §2ter R34).
  if (sol === TERRAIN_WILLOW) {
    return VARIANTES[tirer(MELANGE_SAULAIE, hash2(tx, ty, (seed ^ SEL) | 0))] ?? VARIANTES.tree!
  }
  // ②bis LE PRÉ : à 4,12 tuiles entre deux troncs, l'arbre pousse en PLEIN CHAMP — fût court,
  // cime large. C'est la même lecture du sol que pour le conifère et la futaie, appliquée à
  // l'autre bout de l'échelle de concurrence.
  if (sol === TERRAIN_GRASS) {
    return VARIANTES[tirer(MELANGE_PRE, hash2(tx, ty, (seed ^ SEL) | 0))] ?? VARIANTES.tree!
  }
  // ③ LA ZONE décide du mélange de feuillus.
  const zone = zoneSlugAt(map, tx, ty)
  const m = (zone !== undefined ? MELANGE_PAR_ZONE[zone] : undefined) ?? DEFAUT
  return VARIANTES[tirer(m, hash2(tx, ty, (seed ^ SEL) | 0))] ?? VARIANTES.tree!
}

/** Les zones que la table nomme — pour que la garde puisse confronter à `ZONES` de `/sim` et
 *  crier le jour où un slug est mal orthographié (une ligne muette ne se voit jamais). */
export const ZONES_PEUPLEES: readonly string[] = Object.keys(MELANGE_PAR_ZONE)

/** Les variantes qu'un mélange peut rendre — pour la garde d'exhaustivité des textures. */
export function variantesAtteignables(): readonly string[] {
  const out = new Set<string>(['old_tree'])
  for (const m of [...Object.values(MELANGE_PAR_ZONE), DEFAUT, MELANGE_FUTAIE, MELANGE_PRE, MELANGE_SAULAIE, MELANGE_PIN, MELANGE_MELEZE]) {
    for (const [slug] of m) out.add(slug)
  }
  return [...out].sort()
}

/**
 * LAQUELLE DES CINQ CIMES — même geste que le choix de variante, un cran plus fin.
 *
 * Les mélanges cassent la grille entre ESPÈCES ; celle-ci se voit encore dans une futaie PURE,
 * où douze hêtres portent la même cime au pixel près. On tire donc la cime au même endroit et
 * de la même façon : un `hash2` sur la tuile, avec son propre sel pour ne pas se corréler au
 * tirage de variante — sinon toutes les hêtraies prendraient la même cime, et on aurait déplacé
 * la grille sans la casser.
 *
 * Aussi PUR et aussi gratuit que le reste du module : rien ne transite, rien ne se mémorise, et
 * `/sim` ignore que ces cimes existent — aucun `NODE_DEFS`, aucun protocole, aucun flux RNG.
 */
const SEL_CIME = 0x3f5a1d7b

export function cimeDe(tx: number, ty: number, seed = 0): number {
  return Math.min(CIMES_PAR_ARBRE - 1, Math.floor(hash2(tx, ty, (seed ^ SEL_CIME) | 0) * CIMES_PAR_ARBRE))
}

