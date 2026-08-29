/**
 * LA FOUDRE — le télégraphe au sol, le trait, la secousse et la gerbe (spec `meteo.md` R8).
 *
 * R8 promet un danger TÉLÉGRAPHIÉ : « sous l'orage on lit le sol et on se décale ». Ce n'est
 * pas de l'ambiance, c'est une INFORMATION DE GAMEPLAY — 35 points de dégâts dans 1,5 tuile,
 * annoncés 30 ticks (1,5 s) avant la frappe. Si la lueur n'est pas évidente, la règle est
 * injuste ; si elle ment sur son rayon, elle est pire qu'absente.
 *
 * La GÉOMÉTRIE (trait, salve, rampe de secousse, gerbe) vit dans `foudre-geometrie.ts`, pure
 * et prouvée headless. Ici, on ne fait que la peindre, la secouer et la chronométrer.
 *
 * ═══ RIEN NE TRANSITE — le client ÉLIT le même impact que la sim ═══
 *
 * Ni position d'éclair ni compte à rebours ne voyagent : `foudreTelegrapheAt` et
 * `foudreImpactAt` sont des fonctions PURES du front et du tick, les mêmes que `foudre.ts`
 * interroge pour encaisser les dégâts. Le cercle qu'on dessine est, au flottant près, celui
 * qui va frapper.
 *
 * ═══ CE QUI BOUGE EST L'ALPHA, JAMAIS LA GÉOMÉTRIE ═══
 *
 * Règle de maison sur les FX de lumière, et ici elle a une seconde raison : un cercle qui se
 * RESSERRE dirait un rayon qui rétrécit, or le rayon de dégâts est CONSTANT (`FOUDRE_RAYON`).
 * Le disque est donc figé à sa taille vraie et c'est son alpha qui monte — en PENTE CONTINUE
 * sur toute la fenêtre, aux bornes exactes (0 à `ticksLeft = FOUDRE_TELEGRAPHE_TICKS`, plein à
 * `ticksLeft = 1`), jamais un ease ni des paliers. Tout est PIXELLISÉ au grain de 4 px
 * (NEAREST) — la DA des halos, le trait de foudre compris.
 *
 * ═══ LE TÉLÉGRAPHE DOIT GAGNER CONTRE LE RIDEAU DE PLUIE ═══
 *
 * C'est la couture entre deux tranches, et elle se mesure. La couche météo peint ~543
 * gouttes PÂLES par image, à une profondeur (1 120 500) très au-dessus du télégraphe (4,5) :
 * elle passe DEVANT lui et relève la luminance de tout ce qui l'entoure. Or le télégraphe est
 * en `ADD` — il ne peut qu'ajouter de la lumière, donc il ne peut pas se défendre en montant
 * encore : il pousserait dans le même sens que ce qui le noie.
 *
 * TROIS FAUSSES SOLUTIONS, ÉCARTÉES : monter sa profondeur (il passerait aussi devant les
 * acteurs, alors qu'on doit le lire SOUS ses pieds) ; élargir l'anneau (il mentirait sur le
 * rayon de dégâts, ce qui est pire qu'absent) ; éclaircir la pluie (c'est le calibrage MESURÉ
 * d'une autre tranche, et il n'a pas à payer pour celle-ci).
 *
 * CE QUI EST MESURÉ (`smoke --scenario foudre --dev`, 2026-08-19, cinq prises sur LA MÊME
 * image gelée, alpha 0,9, aucun éclair en cours, 584 gouttes sous averse contre 0 au témoin
 * sec) : sur la bande de l'anneau (rayon 1,3-1,7 tuile, le rayon de dégâts), **la lueur
 * ajoute +5,5 de luminance sans rideau et +3,7 sous l'averse la plus dense — l'annonce garde
 * donc 67 % de son signal.** Elle passe, mais de peu : +5,5 sur un fond à 73,6, c'est +7,5 %
 * en relatif. Le télégraphe est SUBTIL, et ce nombre est celui qu'il faudra remonter si un
 * playtest dit qu'on ne le voit pas.
 *
 * COMMENT ON L'A MESURÉ, ET POURQUOI IL FALLAIT QUATRE ÉTALONS : comparer l'anneau à ce qui
 * l'entoure mesure le télégraphe PLUS le décor sous lui. Une première planche est tombée en
 * forêt dense et a rendu +3,6 sans pluie contre −3,4 avec — du bruit de houppiers, et aucune
 * réponse à la question posée. On ÉTEINT donc le télégraphe (`telegrapheActif`) sur la même
 * image : le décor se soustrait exactement.
 *
 * LE LISERÉ SOMBRE, LUI, N'EST PAS PROUVÉ — et il faut le dire. L'idée : contre un masque
 * pâle, le contraste vient d'un voisin FONCÉ, pas d'un blanc de plus (l'anneau est en `ADD`,
 * il ne peut pas se défendre en montant encore, il pousserait dans le sens de ce qui le
 * noie). Il est composé en NOIR ALPHA NORMAL et non en `MULTIPLY` — patron de l'ombre de
 * contact (`contact-shadow.ts`), qui a mesuré les ratés WebGL du multiply sur des pixels de
 * sol déjà ombrés. MAIS sa contribution relevée, décor éliminé (même image, `liserFacteur`
 * 0,45 contre 0), vaut **0,0 de luminance** : il ne fait rien de mesurable, et on n'a pas
 * élucidé pourquoi. **Il est donc LIVRÉ À ZÉRO** (`liserFacteur = 0`) : on ne rend pas une
 * couche dont on ne sait pas prouver qu'elle peint. La lecture sous averse tient toute seule
 * sur l'anneau — les +3,7 / +5,5 ci-dessus ne lui doivent rien. À trancher : l'expliquer et
 * le rallumer, ou retirer le mécanisme.
 *
 * ═══ LE TRAIT BAT, LE CIEL NON — ET C'EST UNE DÉCISION D'ACCESSIBILITÉ ═══
 *
 * Un vrai éclair est une SALVE : l'arc principal puis deux ou trois arcs de retour dans le
 * même canal, à quelques dizaines de ms. À l'œil, ça stroboscope, et c'est ce qui manquait.
 *
 * Mais trois éclats en 172 ms font ~17 Hz, en plein dans la bande à risque photosensible, et
 * le seuil WCAG (« trois flashs dans une seconde ») ne vaut QUE pour une grande surface. On
 * partage donc les rôles, et c'est aussi la bonne physique : **le TRAIT bat** (quelques
 * centaines de pixels, largement sous le seuil de surface) et **le CIEL ne bat pas** — il
 * garde sa décroissance lisse, comme une lueur de nuage qui intègre les arcs. Sous
 * `prefers-reduced-motion`, la salve elle-même se réduit à son premier coup.
 *
 * Et l'embrasement du ciel est désormais l'ACCOMPAGNEMENT du trait, plus le fait principal :
 * son amplitude est ramenée par `FLASH_PART`. Il n'est pas quantifié (un cadrage au grain
 * baverait en bandes — l'exception assumée de la DA) et vit dans le shader de `meteo-layer`.
 *
 * ═══ LA SECOUSSE : « UN PEU », ET SEULEMENT SI C'EST PRÈS ═══
 *
 * `cameras.main.shake` sur une rampe de distance (`secousseA`, prouvée aux bornes exactes).
 * Il n'existe AUCUN réglage de confort en jeu — l'écran Options ne porte que le son et les
 * touches — mais `prefers-reduced-motion` est DÉJÀ honoré en CSS par `menu-dom`, `hud-core`
 * et `season-veil`. On étend cette convention plutôt que d'inventer un réglage : sous
 * `reduce`, la secousse est ANNULÉE (et la salve réduite à un coup).
 *
 * ═══ L'ABRI : LE TOIT ENCAISSE — CONSÉQUENCE DE JEU, À TRANCHER PAR ALEXIS ═══
 *
 * Un impact dont la tuile est abritée est SUPPRIMÉ côté sim (`foudre.ts` : ni dégâts au point,
 * ni dégâts alentour, pas de report). Le client refaisait la lueur et la brûlure quand même.
 * Choix posé ici : **le trait tombe (on voit le ciel frapper le toit), la GERBE et la BRÛLURE
 * n'ont pas lieu (rien n'a déchiré le sol), la SECOUSSE reste (le coup a bien eu lieu, et
 * c'est l'information « ça a frappé là »).** Le client peut le SAVOIR sans rien inventer : il
 * porte `view.structures` (le tableau complet du snapshot) et `map.zones`, donc il rejoue la
 * loi de `isSheltered` mot pour mot — une maison sur la tuile, ou un POI de type `grotte`.
 *
 * ═══ LE BUDGET DE PARTICULES EST PARTAGÉ, PAS EMPILÉ ═══
 *
 * La gerbe s'IMPUTE sur `BUDGET_PARTICULES` (650) : `WorldScene` passe ses vivants à
 * `meteo-layer`, qui retranche d'autant la cible du rideau. Conséquence NOMMÉE : sous une
 * frappe, le rideau s'éclaircit d'au plus 48 gouttes (~7 %) pendant trois dixièmes de seconde.
 *
 * ═══ LES HORLOGES ═══
 *
 * Toute la décroissance suit l'horloge de la SCÈNE (le `time` de frame), jamais un
 * `window.setTimeout` — l'horloge headless galope, et un FX accroché à l'horloge murale
 * serait invisible au smoke comme au joueur qui change d'onglet. Le RNG est LOCAL au client
 * (`creerRng`), jamais celui de la sim : un tirage de plus décalerait tout le flux seedé.
 */
import Phaser from 'phaser'
import {
  METEO,
  foudreImpactAt,
  foudreTelegrapheAt,
  poisAt,
  type MeteoFront,
  type Structure,
  type WorldMap,
} from '@ashes/sim'
import { TILE_PX } from '../../render/framing'
import {
  BUDGET_GERBE,
  GERBE_CRANS,
  GerbeFoudre,
  SECOUSSE_MS,
  battementA,
  cranDage,
  secousseA,
  traceEnRuns,
  tracerEclair,
  type Run,
  type Trace,
} from './foudre-geometrie'

/** Le grain de l'art pour les FX de lumière (le même que la flaque du Feu). */
const LIGHT_PX = 4

/** Le disque du télégraphe couvre le rayon de DÉGÂTS et une marge de lecture. `FOUDRE_RAYON`
 *  vaut 1,5 tuile ; on dessine jusqu'à 2,5 pour que la lueur ait un dehors — mais l'ANNEAU,
 *  lui, tombe exactement sur 1,5 : c'est lui qui dit « ici on prend ». */
const HALO_TILES = 2.5
const HALO_CELLS = Math.round((HALO_TILES * TILE_PX) / LIGHT_PX)
const HALO_SIDE = HALO_CELLS * 2 + 1
const TELEGRAPHE_KEY = 'fx-foudre-telegraphe'
const LISERE_KEY = 'fx-foudre-lisere'

/** Le noyau blanc de la brûlure, au point d'impact. */
const IMPACT_TILES = 1.5
const IMPACT_CELLS = Math.round((IMPACT_TILES * TILE_PX) / LIGHT_PX)
const IMPACT_SIDE = IMPACT_CELLS * 2 + 1
const IMPACT_KEY = 'fx-foudre-impact'

/** Combien de temps la lueur du ciel tient, en ms d'horloge de scène. Court : un éclair qui
 *  s'attarde devient une lampe. Le TRAIT, lui, ne dure que `TRAIT_MS` (172). */
const ECLAIR_MS = 340

/**
 * DE QUELLE HAUTEUR LE TRAIT TOMBE, en tuiles — BORNÉ DES DEUX CÔTÉS, et le plafond est un
 * correctif MESURÉ.
 *
 * Le trait partait du haut du CADRE. Quand la frappe tombe hors champ (et c'est le cas
 * courant : `foudreImpactAt` tire la transverse sur toute la carte, ~1 600 tuiles, quand
 * l'écran en montre 20), « le haut du cadre » peut être à des centaines de tuiles du point
 * d'impact. MESURÉ au smoke : **1 326 rectangles pour un seul éclair**, soit une chute de
 * ~450 tuiles — deux fois et demie le rideau de pluie entier, pour un trait dont l'écran ne
 * montre qu'une fraction. Le plafond le ramène à ~170 quoi qu'il arrive.
 *
 * Le plancher, lui, garde une chute crédible quand la frappe est près du bord haut : un
 * trait de deux tuiles lirait « étincelle », pas « éclair ».
 */
const CHUTE_MIN_TUILES = 8
const CHUTE_MAX_TUILES = 26

/**
 * CE QU'IL RESTE DE L'EMBRASEMENT DU CIEL — il ACCOMPAGNE le trait, il n'est plus le fait.
 *
 * À 1, une prise d'orage pendant un flash rendait µ = 205 et σ/µ = 0,057 : un écran BLANC ET
 * PLAT (MESURÉ, scénario `meteo`). Le trait ne pouvait pas s'y lire.
 *
 * BAISSÉ UNE SECONDE FOIS, DE 0,55 À 0,22, ET POUR UNE RAISON QU'ON NE VOIT QU'EN
 * REGARDANT : le voile météo est AU-DESSUS du sol (profondeur 1 120 000 contre 4,5), et le
 * fragment le pousse vers le blanc de `min(1, f×1,6)` en lui ajoutant jusqu'à `f×0,72`
 * d'opacité. À 0,55, le voile montait à ~0,67 d'alpha d'un blanc à 88 % : le sol passait
 * sous une feuille de papier. La GERBE — qui est au sol, en teintes de terre, et qui ne vit
 * que 300 ms, donc entièrement PENDANT le flash — en devenait invisible, et les captures le
 * montrent (planche du 2026-08-19 : le cadre entier délavé, la gerbe introuvable). À 0,22,
 * le voile ne gagne que ~0,09 d'alpha et 35 % de blanchiment : le ciel s'allume, le sol
 * reste lisible. C'est la définition même d'un accompagnement.
 */
const FLASH_PART = 0.22

/**
 * L'ÉPAISSEUR DU TRAIT en CELLULES de 4 px : [gaine, cœur], pour le tronc puis les branches.
 *
 * ELLE A ÉTÉ AMINCIE (constaté à l'écran) : à [5, 2] la gaine faisait 20 px monde, soit
 * 45 px d'écran au zoom 2,25 — PLUS LARGE QU'UNE TUILE. Un coude de 5 px noyé dans un trait
 * de 20 en devient invisible, et les ramifications (26 à 56 px de long) disparaissaient
 * entièrement dans l'empreinte du tronc. Le trait lisait « faisceau ». Deux symptômes, une
 * cause : c'est la largeur qui mangeait la forme.
 */
const EP_TRONC: readonly [number, number] = [3, 1]
const EP_BRANCHE: readonly [number, number] = [2, 1]

/** La gaine bleutée et le cœur blanc — hors palette d'encre, parce que c'est le CIEL qui
 *  parle et non l'UI (le monde emploie librement ses teintes : airs de zone, couleurs d'heure). */
const COULEUR_GAINE = 0x6f86c8
const COULEUR_COEUR = 0xf2f6ff
/** L'opacité de la gaine, par rapport au cœur. Deux passes : un éclair a une gaine. */
const ALPHA_GAINE = 0.42

/**
 * LA GERBE, PAR CRAN D'ÂGE : une braise, puis de la terre, puis de la poussière qui retombe.
 * Trois TEINTES et non une seule — la première version était d'un beige unique, trop proche
 * du ton de l'avatar pour se distinguer sur une capture, et un jet monochrome ne raconte pas
 * qu'une motte se refroidit en tombant.
 */
const GERBE_TEINTES = [0xffe2b4, 0xa98a5f, 0x6b5a42] as const

/** Le télégraphe est AU SOL — on le lit sous ses pieds, sous les acteurs qui s'en écartent.
 *  Même bande que la flaque du Feu (4) et le sol (FLOOR_DEPTH 6). */
const TELEGRAPHE_DEPTH = 4.5
/** Le liseré sombre juste SOUS l'anneau clair : ils ne se recouvrent pas, mais si un pixel
 *  était disputé, c'est la lumière qui doit gagner. */
const LISERE_DEPTH = TELEGRAPHE_DEPTH - 0.01
/** La gerbe est de la TERRE : elle reste au sol, sous les acteurs, juste au-dessus du
 *  télégraphe qu'elle vient conclure. */
const GERBE_DEPTH = TELEGRAPHE_DEPTH + 0.02
/** L'éclair, lui, est devant tout — le ciel qui tombe (juste sous la couche météo). */
const ECLAIR_DEPTH = 1_119_000

/**
 * LA LOI DE `isSheltered`, REJOUÉE CÔTÉ CLIENT — mot pour mot (`temperature.ts`) : une
 * maison sur la tuile, ou un POI de type `grotte`. Deux écrivains pour une règle est une
 * dette ; elle est ici, NOMMÉE, et elle ne décide que d'un rendu (jamais de dégâts).
 * `structures` est le tableau COMPLET du snapshot, pas une liste culled — sinon la réponse
 * dépendrait du cadrage.
 */
function abriteAuClient(structures: readonly Structure[], map: WorldMap, tx: number, ty: number): boolean {
  if (structures.some((s) => s.tx === tx && s.ty === ty && s.type === 'house')) return true
  return poisAt(map, tx, ty).some((id) => map.zones[id]?.kind === 'grotte')
}

/**
 * LE DISQUE DU TÉLÉGRAPHE — un texel par cellule de 4 px, NEAREST : des carrés durs.
 * Deux registres dans la MÊME texture, et c'est voulu :
 *   • un halo doux qui décroît du centre au bord (on le repère du coin de l'œil) ;
 *   • un ANNEAU FRANC pile sur `FOUDRE_RAYON` (on lit où finit le danger).
 * Un anneau seul serait invisible sous la pluie ; un halo seul mentirait sur le rayon.
 */
function ensureTelegrapheTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TELEGRAPHE_KEY)) return
  const tex = scene.textures.createCanvas(TELEGRAPHE_KEY, HALO_SIDE, HALO_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(HALO_SIDE, HALO_SIDE)
  // Le rayon de dégâts, exprimé en cellules de la texture — l'anneau tombe DESSUS.
  const rDegats = (METEO.FOUDRE_RAYON * TILE_PX) / LIGHT_PX
  for (let j = 0; j < HALO_SIDE; j++) {
    for (let i = 0; i < HALO_SIDE; i++) {
      const dx = i - HALO_CELLS
      const dy = j - HALO_CELLS
      const r = Math.sqrt(dx * dx + dy * dy)
      const t = Math.min(1, r / HALO_CELLS)
      const s = 1 - t
      let a = s * s * (3 - 2 * s) * 0.55 // le halo, doux
      // L'ANNEAU : une couronne d'une cellule et demie autour du rayon de dégâts exact.
      const surAnneau = Math.abs(r - rDegats) <= 1.5
      if (surAnneau) a = Math.max(a, 0.95)
      // Blanc-bleu électrique : la couleur de ce qui va tomber, hors palette d'encre parce
      // que c'est le CIEL qui parle, pas l'UI (le monde emploie librement ses teintes).
      const k = (j * HALO_SIDE + i) * 4
      img.data[k] = surAnneau ? 236 : 150
      img.data[k + 1] = surAnneau ? 242 : 176
      img.data[k + 2] = 255
      img.data[k + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(TELEGRAPHE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/**
 * LE LISERÉ SOMBRE — la seule chose qui puisse défendre l'anneau contre le rideau de pluie
 * (voir l'en-tête : contre un masque PÂLE, le contraste vient d'un voisin FONCÉ).
 *
 * Il se pose JUSTE EN DEHORS du rayon de dégâts, sur deux cellules et demie, et il décroît
 * vers son bord extérieur — sans quoi il dessinerait un second anneau franc et l'œil lirait
 * DEUX rayons. Noir en alpha NORMAL, jamais `MULTIPLY` (patron `contact-shadow`). Même
 * grille de 4 px, même NEAREST.
 */
function ensureLisereTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(LISERE_KEY)) return
  const tex = scene.textures.createCanvas(LISERE_KEY, HALO_SIDE, HALO_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(HALO_SIDE, HALO_SIDE)
  const rDegats = (METEO.FOUDRE_RAYON * TILE_PX) / LIGHT_PX
  const LARGEUR = 2.5 // cellules
  for (let j = 0; j < HALO_SIDE; j++) {
    for (let i = 0; i < HALO_SIDE; i++) {
      const dx = i - HALO_CELLS
      const dy = j - HALO_CELLS
      const r = Math.sqrt(dx * dx + dy * dy)
      // Dehors du rayon de dégâts seulement : à l'intérieur, l'anneau clair règne seul.
      const d = r - (rDegats + 1.5)
      const a = d < 0 || d > LARGEUR ? 0 : 1 - d / LARGEUR
      const k = (j * HALO_SIDE + i) * 4
      img.data[k] = 6
      img.data[k + 1] = 8
      img.data[k + 2] = 14
      img.data[k + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(LISERE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** LA BRÛLURE — un noyau plein au point de frappe, même grille, même NEAREST. */
function ensureImpactTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(IMPACT_KEY)) return
  const tex = scene.textures.createCanvas(IMPACT_KEY, IMPACT_SIDE, IMPACT_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(IMPACT_SIDE, IMPACT_SIDE)
  for (let j = 0; j < IMPACT_SIDE; j++) {
    for (let i = 0; i < IMPACT_SIDE; i++) {
      const dx = i - IMPACT_CELLS
      const dy = j - IMPACT_CELLS
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / IMPACT_CELLS)
      const s = 1 - t
      const k = (j * IMPACT_SIDE + i) * 4
      img.data[k] = 255
      img.data[k + 1] = 253
      img.data[k + 2] = 245
      img.data[k + 3] = Math.round(s * s * (3 - 2 * s) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(IMPACT_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** Ce que la scène doit fournir pour que la foudre sache où frapper et qui regarde. */
export interface ContexteFoudre {
  readonly front: MeteoFront | null
  readonly tick: number
  readonly map: WorldMap
  readonly structures: readonly Structure[]
  /** La position du joueur, en TUILES — c'est d'elle que dépend la secousse. */
  readonly joueur: { x: number; y: number }
}

export class FoudreFx {
  private halo: Phaser.GameObjects.Image
  private lisere: Phaser.GameObjects.Image
  private brulure: Phaser.GameObjects.Image
  private trait: Phaser.GameObjects.Graphics
  private gerbeG: Phaser.GameObjects.Graphics
  private readonly gerbe = new GerbeFoudre()
  private readonly runs: Run[] = []
  /** Dernier tick balayé — on ne saute aucun impact même si une frame en enjambe plusieurs. */
  private dernierTick = -1
  private eclairDebut = -1
  private eclairPoint = { x: 0, y: 0 }
  private eclairAbrite = false
  private trace: Trace | null = null
  private lastMs: number | null = null
  /** La requête de confort, lue une fois et relue à chaque frappe (elle peut changer). */
  private readonly reduitMouvement: MediaQueryList | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null

  /**
   * LE POIDS DU LISERÉ SOMBRE — réglé ICI, mesuré par le smoke, et par personne d'autre.
   *
   * C'est le seul réglage de cette couche que le harnais BAISSE (patron `grainActif` de
   * `meteo-layer`) : `smoke --scenario foudre` le balaie de 0 à 1 sur UNE MÊME image de
   * télégraphe gelée, et relève la MARCHE anneau/liseré sous averse pleine à chaque cran.
   * On garde le plus PETIT qui gagne encore, pas le plus gros qui gagne le mieux — un noir
   * épais juste dehors du rayon de dégâts finirait par se lire comme faisant PARTIE de la
   * zone marquée, et c'est la seule chose que l'anneau n'a pas le droit de faire.
   *
   * ÉTAT MESURÉ : à 0,45 sa contribution vaut 0,0 (voir l'en-tête). **Il est donc LIVRÉ À
   * ZÉRO** — on ne rend pas une couche dont on ne sait pas prouver qu'elle peint quelque
   * chose. Le mécanisme, la texture et ce bouton restent là pour qui saura l'expliquer ; en
   * attendant, ce qui s'affiche est exactement ce qui a été mesuré, et le « 67 % conservés »
   * de l'en-tête ne doit rien au liseré.
   */
  liserFacteur = 0

  /**
   * L'INTERRUPTEUR DU TÉLÉGRAPHE — toujours vrai en jeu, BAISSÉ PAR LE SMOKE et par rien
   * d'autre. C'est le quatrième étalon, et il a fallu une planche ratée pour comprendre
   * qu'il manquait.
   *
   * Comparer « anneau » à « ce qui l'entoure » ne mesure PAS le télégraphe : ça mesure le
   * télégraphe PLUS le décor sous lui. MESURÉ le 2026-08-19 — une annonce tombée en forêt
   * dense a rendu Δ(anneau/dehors) = +3,6 SANS pluie et −3,4 AVEC, c'est-à-dire du bruit de
   * houppiers dans les deux cas : la question posée (« le rideau noie-t-il l'annonce ? »)
   * était sans réponse parce que le SITE dominait le signal. En éteignant le télégraphe sur
   * la MÊME image gelée, le décor se soustrait exactement et il ne reste que ce que la lueur
   * ajoute. C'est le patron `grainActif` de `meteo-layer`, pour la même raison.
   */
  telegrapheActif = true

  /** LU PAR LE SMOKE, et par rien d'autre : le rendu se juge sur des pixels. */
  readonly sonde = {
    eclairs: 0,
    telegraphes: 0,
    ticksLeft: 0,
    x: 0,
    y: 0,
    alpha: 0,
    /**
     * OÙ LA FOUDRE A FRAPPÉ — distinct de `x`/`y`, qui sont le TÉLÉGRAPHE.
     *
     * Ils manquaient, et ça a coûté une planche : le smoke cadrait ses gros plans sur
     * `x`/`y` en croyant viser l'impact, alors que ce sont les coordonnées de l'annonce
     * EN COURS — celle du créneau SUIVANT, ailleurs. Les photos de la gerbe montraient de
     * l'herbe vide. Deux choses différentes méritent deux noms.
     */
    eclairX: 0,
    eclairY: 0,
    /** L'embrasement du ciel rendu ce frame — une prise pendant un flash ne mesure rien. */
    flash: 0,
    /** Où en est la salve : l'index du battement, ou −1. Une capture doit pouvoir se situer. */
    battement: -1,
    traitVisible: false,
    /** Les rectangles du trait — le coût de peinture, en clair. */
    runs: 0,
    /** La gerbe : vivants à l'instant, et le CUMUL (une gerbe de 300 ms ne se photographie pas). */
    gerbeVivantes: 0,
    gerbeTotal: 0,
    /** La dernière secousse demandée, et sur quoi elle s'est décidée. */
    secousse: 0,
    secousseDist: 0,
    /** Vrai quand `prefers-reduced-motion` a annulé la secousse. */
    mouvementReduit: false,
    /** Vrai quand le dernier impact tombait sur une tuile ABRITÉE (la sim l'a supprimé). */
    abrite: false,
    /** CE QUE LA FOUDRE PREND SUR LE FIL PRINCIPAL, en ms par image — et seulement sur les
     *  images où elle DESSINE quelque chose. Une moyenne sur toutes les images noierait
     *  340 ms de frappe dans vingt secondes de créneau, et rendrait 0,00 pour toujours. */
    msDessin: 0,
    imagesDessin: 0,
  }

  constructor(private scene: Phaser.Scene) {
    ensureTelegrapheTexture(scene)
    ensureLisereTexture(scene)
    ensureImpactTexture(scene)
    this.lisere = scene.add
      .image(0, 0, LISERE_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(LISERE_DEPTH)
      .setDisplaySize(HALO_SIDE * LIGHT_PX, HALO_SIDE * LIGHT_PX)
      .setVisible(false)
    this.halo = scene.add
      .image(0, 0, TELEGRAPHE_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(TELEGRAPHE_DEPTH)
      .setBlendMode('ADD')
      .setDisplaySize(HALO_SIDE * LIGHT_PX, HALO_SIDE * LIGHT_PX)
      .setVisible(false)
    this.brulure = scene.add
      .image(0, 0, IMPACT_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(ECLAIR_DEPTH)
      .setBlendMode('ADD')
      .setDisplaySize(IMPACT_SIDE * LIGHT_PX, IMPACT_SIDE * LIGHT_PX)
      .setVisible(false)
    this.trait = scene.add.graphics().setDepth(ECLAIR_DEPTH).setBlendMode('ADD').setVisible(false)
    this.gerbeG = scene.add.graphics().setDepth(GERBE_DEPTH).setVisible(false)
  }

  /**
   * Chaque frame. Rend l'EMBRASEMENT du ciel (0..1) que `meteo-layer` consomme.
   *
   * `now` est l'horloge de la SCÈNE (le `time` de `update`) : toute la décroissance s'y
   * accroche. `ctx.tick` est celui du dernier snapshot — on balaie tous les ticks depuis le
   * précédent appel, sans quoi une frame qui en enjambe deux perdrait un éclair.
   */
  update(now: number, ctx: ContexteFoudre): number {
    const t0 = performance.now()
    const dtMs = this.lastMs === null ? 0 : Math.min(250, Math.max(0, now - this.lastMs))
    this.lastMs = now
    const { front, tick, map } = ctx

    // ── LA GERBE VIEILLIT **AVANT** QU'ON FRAPPE, et l'ordre est un correctif MESURÉ.
    //
    // Elle vieillissait après, donc les éclats nés CETTE image prenaient tout de suite le
    // `dt` de l'image — plafonné à 250 ms sur une vie de 300. Sur une image lente (et sous
    // swiftshader une image dure parfois 900 ms) la gerbe naissait DÉJÀ MOURANTE : tassée
    // sur son point de départ, au dernier cran d'opacité, invisible. Elle n'a jamais été
    // photographiée pour cette seule raison. Un nouveau-né ne prend pas le temps d'avant sa
    // naissance ; on avance donc les vivants d'abord, on fait naître ensuite.
    if (this.gerbe.vivants > 0) this.gerbe.update(dtMs)

    if (!front || front.type !== 'orage') {
      this.halo.setVisible(false)
      this.lisere.setVisible(false)
      this.sonde.ticksLeft = 0
      this.sonde.alpha = 0
      this.dernierTick = tick
      return this.rendreEclair(now, t0)
    }

    // ── LES FRAPPES : on balaie chaque tick écoulé (borné — un saut de calendrier ne doit
    // pas faire tourner mille itérations). `foudreImpactAt` n'est vraie qu'à UN tick. ──
    const depart = this.dernierTick < 0 ? tick : Math.max(this.dernierTick + 1, tick - 600)
    for (let t = depart; t <= tick; t++) {
      const impact = foudreImpactAt(front, t, map.width, map.height)
      if (!impact) continue
      this.frapper(now, t, impact, ctx)
    }
    this.dernierTick = tick

    // ── LE TÉLÉGRAPHE : une PENTE CONTINUE sur toute la fenêtre, aux bornes exactes. ──
    const tel = foudreTelegrapheAt(front, tick, map.width, map.height)
    if (tel) {
      // `ticksLeft` ∈ [1, FOUDRE_TELEGRAPHE_TICKS] : 0 quand l'annonce commence, 1 au tick
      // qui précède la frappe. Linéaire — ni ease, ni palier (règle « feel = pente »).
      const u = 1 - (tel.ticksLeft - 1) / Math.max(1, METEO.FOUDRE_TELEGRAPHE_TICKS - 1)
      const px = tel.x * TILE_PX
      const py = tel.y * TILE_PX
      this.halo.setPosition(px, py).setAlpha(u).setVisible(this.telegrapheActif)
      // Le liseré monte sur LA MÊME rampe : il est le dehors de l'anneau, pas un second
      // événement. Un peu moins fort — il défend la lecture, il ne la remplace pas.
      // À FACTEUR NUL (l'état livré), on ne soumet pas une image invisible au rasteriseur :
      // `setVisible(true)` à alpha 0 se paie quand même. Le smoke qui balaie le facteur la
      // rallume au premier cran non nul.
      this.lisere.setPosition(px, py).setAlpha(u * this.liserFacteur).setVisible(this.telegrapheActif && this.liserFacteur > 0)
      this.sonde.telegraphes += 1
      this.sonde.ticksLeft = tel.ticksLeft
      this.sonde.x = tel.x
      this.sonde.y = tel.y
      this.sonde.alpha = u
    } else {
      this.halo.setVisible(false)
      this.lisere.setVisible(false)
      this.sonde.ticksLeft = 0
      this.sonde.alpha = 0
    }

    return this.rendreEclair(now, t0)
  }

  /** LA FRAPPE — le trait naît, la terre part, l'écran encaisse. */
  /** LE TONNERRE ÉCOUTE LA FRAPPE — posé par `WorldScene`, consommé par `meteo-audio.ts`.
   *  C'est ICI que la loi d'abri se résout côté client : le son la lit d'où elle s'écrit,
   *  il ne la recopie pas (un impact abrité garde son tonnerre — l'éclair a déchiré le
   *  ciel, il n'a juste rien touché). */
  onFrappe: ((x: number, y: number, abrite: boolean) => void) | null = null

  private frapper(now: number, tickImpact: number, impact: { x: number; y: number }, ctx: ContexteFoudre): void {
    const abrite = abriteAuClient(ctx.structures, ctx.map, Math.floor(impact.x), Math.floor(impact.y))
    this.onFrappe?.(impact.x, impact.y, abrite)
    this.eclairDebut = now
    this.eclairPoint = { x: impact.x, y: impact.y }
    this.eclairAbrite = abrite
    this.sonde.eclairs += 1
    this.sonde.abrite = abrite
    this.sonde.eclairX = impact.x
    this.sonde.eclairY = impact.y

    // Le trait se trace UNE FOIS, du plafond du cadre au point d'impact : il est FIGÉ le
    // temps qu'il dure (un éclair ne se tortille pas) et sa forme est tirée du TICK.
    const plafondCadre = this.scene.cameras.main.worldView.y / TILE_PX - 1
    const hautY = Math.min(
      impact.y - CHUTE_MIN_TUILES,
      Math.max(plafondCadre, impact.y - CHUTE_MAX_TUILES),
    )
    this.trace = tracerEclair(tickImpact, impact, hautY)

    // LA GERBE : le sol arraché. Pas sous un toit — rien n'a déchiré le sol.
    if (!abrite) this.gerbe.frapper(impact.x, impact.y)

    // LA SECOUSSE : la rampe de distance, plafonnée, annulée sous `prefers-reduced-motion`.
    // Elle a lieu MÊME sous un toit : le coup est tombé, et c'est l'information.
    const dx = ctx.joueur.x - impact.x
    const dy = ctx.joueur.y - impact.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const reduit = this.reduitMouvement?.matches === true
    const force = reduit ? 0 : secousseA(dist)
    this.sonde.secousseDist = dist
    this.sonde.secousse = force
    this.sonde.mouvementReduit = reduit
    if (force > 0) this.scene.cameras.main.shake(SECOUSSE_MS, force)
  }

  /** Le trait, la brûlure, la gerbe et la rémanence du ciel — sur l'horloge de la scène. */
  private rendreEclair(now: number, t0: number): number {
    // ── LA GERBE vit sa vie indépendamment du trait (300 ms contre 172). Elle a DÉJÀ été
    //    avancée en tête d'`update` (voir là-bas) : ici on ne fait que la peindre. ──
    if (this.gerbe.vivants > 0) this.peindreGerbe()
    else if (this.gerbeG.visible) this.gerbeG.clear().setVisible(false)
    this.sonde.gerbeVivantes = this.gerbe.vivants
    this.sonde.gerbeTotal = this.gerbe.total

    if (this.eclairDebut < 0) {
      this.sonde.flash = 0
      this.sonde.battement = -1
      this.sonde.traitVisible = false
      this.chronometrer(t0)
      return 0
    }
    const age = now - this.eclairDebut
    if (age > ECLAIR_MS) {
      this.eclairDebut = -1
      this.trait.clear().setVisible(false)
      this.brulure.setVisible(false)
      this.sonde.flash = 0
      this.sonde.battement = -1
      this.sonde.traitVisible = false
      this.chronometrer(t0)
      return 0
    }

    // ── LE CIEL NE BAT PAS : une décroissance LISSE, franche au départ, longue traîne.
    //    C'est la décision d'accessibilité de l'en-tête (grande surface ⇒ pas de stroboscope)
    //    et c'est aussi la bonne physique — la lueur du nuage intègre les arcs. ──
    const k = 1 - age / ECLAIR_MS
    const flash = k * k * FLASH_PART
    this.sonde.flash = flash

    // La brûlure est un phénomène de SOL : sous un toit, elle n'a pas lieu.
    if (this.eclairAbrite) this.brulure.setVisible(false)
    else {
      this.brulure
        .setPosition(this.eclairPoint.x * TILE_PX, this.eclairPoint.y * TILE_PX)
        .setAlpha(Math.min(1, flash * 2.2))
        .setVisible(true)
    }

    // ── LE TRAIT, LUI, BAT : la table des crans, indexée par les ms écoulées. ──
    const reduit = this.reduitMouvement?.matches === true
    // Sous `prefers-reduced-motion`, la salve se réduit à son PREMIER coup : le trait existe
    // (c'est de l'information), il ne stroboscope pas.
    const bat = reduit
      ? { index: age < 42 ? 0 : -1, cran: age < 42 ? 1 : 0 }
      : battementA(age)
    this.sonde.battement = bat.index
    this.sonde.traitVisible = bat.cran > 0
    if (bat.cran > 0 && this.trace) this.peindreTrait(this.trace, bat.cran)
    else if (this.trait.visible) this.trait.clear().setVisible(false)

    this.chronometrer(t0)
    return flash
  }

  /**
   * PEINDRE LE TRAIT — des rectangles à bords francs sur la grille de 4 px MONDE, jamais un
   * `strokePath` (qui lisserait les diagonales : la leçon que le rideau de pluie a payée).
   * Deux passes, deux `fillStyle` : la gaine large et pâle, puis le cœur blanc.
   */
  private peindreTrait(trace: Trace, cran: number): void {
    const g = this.trait.clear().setVisible(true)
    const parTuile = TILE_PX / LIGHT_PX
    let rects = 0
    for (const [passe, couleur, alpha] of [
      [0, COULEUR_GAINE, ALPHA_GAINE],
      [1, COULEUR_COEUR, 1],
    ] as const) {
      // LA LARGEUR EST FIXE, C'EST L'ALPHA QUI BAT — règle de maison sur les FX de lumière :
      // un trait qui MAIGRIT est un trait qui bouge, et l'œil lit un mouvement là où il n'y
      // a qu'une extinction.
      const ep: readonly [number, number] = [EP_TRONC[passe]!, EP_BRANCHE[passe]!]
      g.fillStyle(couleur, alpha * cran)
      const n = traceEnRuns(trace, parTuile, ep, this.runs)
      for (let i = 0; i < n; i++) {
        const r = this.runs[i]!
        g.fillRect(r.cx * LIGHT_PX, r.cy * LIGHT_PX, r.w * LIGHT_PX, r.h * LIGHT_PX)
      }
      rects += n
    }
    this.sonde.runs = rects
  }

  /** LA GERBE — un carré par éclat, quantifié, groupé par cran d'âge (trois `fillStyle`). */
  private peindreGerbe(): void {
    const g = this.gerbeG.clear().setVisible(true)
    const parTuile = TILE_PX / LIGHT_PX
    for (let cran = 0; cran < GERBE_CRANS.length; cran++) {
      g.fillStyle(GERBE_TEINTES[cran]!, GERBE_CRANS[cran]!)
      // Le jeune éclat est GROS (2 cellules), le vieux menu (1) : la motte se désagrège.
      const cote = cran === 0 ? 2 : 1
      for (const e of this.gerbe.eclats) {
        if (!e.vive || cranDage(e.age) !== cran) continue
        const cx = Math.floor(e.x * parTuile)
        const cy = Math.floor(e.y * parTuile)
        g.fillRect(cx * LIGHT_PX, cy * LIGHT_PX, cote * LIGHT_PX, cote * LIGHT_PX)
      }
    }
  }

  /** Le chronomètre — SEULEMENT sur les images où quelque chose est dessiné (voir la sonde). */
  private chronoMs = 0
  private chronoImages = 0
  private chronometrer(t0: number): void {
    if (!this.sonde.traitVisible && this.sonde.gerbeVivantes === 0 && this.sonde.flash <= 0) return
    this.chronoMs += performance.now() - t0
    this.chronoImages += 1
    this.sonde.msDessin = this.chronoMs / this.chronoImages
    this.sonde.imagesDessin = this.chronoImages
  }

  /** Ce que la gerbe occupe du budget de particules — `meteo-layer` le retranche de sa cible. */
  get particulesReservees(): number {
    return Math.min(BUDGET_GERBE, this.gerbe.vivants)
  }

  destroy(): void {
    this.gerbe.vider()
    this.halo.destroy()
    this.lisere.destroy()
    this.brulure.destroy()
    this.trait.destroy()
    this.gerbeG.destroy()
  }
}
