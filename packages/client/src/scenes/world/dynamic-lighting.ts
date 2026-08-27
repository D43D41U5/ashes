/**
 * ÉCLAIRAGE DYNAMIQUE — le rendu PAR DÉFAUT du jeu (DA actée, docs/decisions.md 2026-07-20
 * puis promu par défaut 2026-07-24) — pilotage du LightsManager de Phaser 4.
 *
 * TROIS sources, toutes tirées de l'état sim (jamais inventées ici) :
 *   • LE SOLEIL — une lumière directionnelle SIMULÉE par un point lointain, posé dans
 *     `sunDirection(heure)` (module pur, testé) loin du centre caméra, rayon énorme :
 *     à midi il est quasi au zénith (dôme éclairé à plat), à l'aube/couchant il RASE
 *     (une tranche du houppier s'allume). Intensité ∝ `daylight` : nul la nuit.
 *   • LA LUNE — un voile FROID venu d'en haut, BIEN plus faible que le soleil, actif ∝ 1-day :
 *     la nuit, les houppiers gardent un léger relief bleuté au lieu d'un aplat noir.
 *   • LES FEUX — un point light chaud par structure `fire`, couleur/rayon/intensité de
 *     `fireGlow` (le MÊME module que le halo cosmétique). La nuit, c'est la source qui
 *     DOMINE : la canopée s'allume autour des braises. C'est tout l'argument.
 *
 * N'affecte QUE les objets en `setLighting(true)` (arbres, nœuds, décor volumique). Actif par
 * défaut ; le panneau debug (DEV) peut le couper (`update(active=false)`) pour retomber sur
 * l'ancien rendu à plat — utile pour comparer, jamais le mode nominal.
 */
import type Phaser from 'phaser'
import { fireStateAt } from '@ashes/sim'
import type { SnapshotMessage, Structure } from '@ashes/sim'
import { fireGlow, sunDirection, moonDirection, heureCanonique, lerpColor, ambientTint, multiplicateurDuVoile, voileDeNuit, LUNE_PLEINE_JOUR } from '../../render/lighting'
import type { HeureSolaire } from '../../render/lighting'
import { axesFeu } from '../../render/feu-variante'
import { TORCHE_LIGHT_TILES, forceDeTorche } from '../../render/torche'
import type { PorteurDeTorche } from './torche-ground-glow'
import { TILE_PX } from '../../render/framing'

const SUN_FAR = 2200 // distance du soleil au centre caméra (px monde) : grand = quasi directionnel
const SUN_RADIUS = 9000 // rayon >> distance → atténuation douce, éclairage ~uniforme à l'écran
/** Hauteur du soleil : règle l'angle (rasant à l'aube quand l'offset horizontal domine).
 *  EXPORTÉ avec `SUN_NORTH` parce que le SOCLE MINÉRAL en dépend : ses deux pentes sont calées
 *  de part et d'autre de l'élévation `atan(SUN_Z / SUN_NORTH)`, et une garde le vérifie. */
export const SUN_Z = 620
// LE SOLEIL EST EN HAUT et passe de DROITE à GAUCHE sur la journée (demande d'Alexis) : un biais
// NORD fixe (vers le haut de l'écran) → la lumière tombe d'en haut ; le balayage horizontal (est→
// ouest via `sunDirection`) fait glisser le côté éclairé de la droite vers la gauche au fil des heures.
export const SUN_NORTH = 1600 // décalage vers le haut de l'écran (nord) : la source est « en haut »
const GOLDEN = 0xffb060 // soleil rasant, chaud
const WHITE = 0xfff2e6 // plein midi
const MOON_COLOR = 0xaec2e6 // clair de lune : bleu pâle et froid
const SUN_INTENSITY = 1.2 // le plein midi
const MOON_INTENSITY = 0.32 // un voile froid, pas un projecteur
/**
 * LA LUNE NE SE LÈVE QU'UNE FOIS LE SOLEIL COUCHÉ — et cette borne a manqué longtemps.
 *
 * Le commentaire d'origine disait la lune « BEAUCOUP plus faible que le soleil (~1.2) ». Il
 * comparait `MOON_INTENSITY` au COEFFICIENT du soleil, pas à sa VALEUR : le soleil vaut
 * `day × 1.2` et décroît vers zéro, la lune valait `(1 − day) × 0.32` et CROISSAIT. Les deux
 * se croisaient donc fatalement — à `daylight = 0,2105`, c'est-à-dire de 19 h 56 à 6 h 22.
 *
 * Ce que ça faisait au joueur, mesuré sur les captures : à 20 h, sa propre silhouette tombait
 * SOUS son sol (contraste avatar/sol 1,20:1, contre 2,60:1 à midi et 1,54:1 à minuit), et la
 * polarité s'inversait — l'avatar passait de plus clair que le sol à plus sombre. À l'heure
 * exacte où le jeu dit « la nuit approche, rentre au feu », on se perdait soi-même dans le
 * décor. La cause : deux chaînes d'éclairage qui n'étaient pas à la même heure, et deux
 * teintes opposées (ambre rasant contre bleu lunaire) qui s'annulaient en gris neutre.
 *
 * On donne donc à la lune la fenêtre de nuit que le voile du sol a déjà : elle reste ÉTEINTE
 * tant qu'il fait encore jour, puis monte à pleine force quand le jour est parti.
 * (Audit UX 2026-08-20, P1 / L8.)
 */
const MOON_DAWN = 0.15 // au-dessus de ce `daylight`, la lune est éteinte

/**
 * Les deux intensités du ciel à un facteur de jour donné — PUR, donc prouvé par un test.
 * Extrait de la classe exprès : c'est un rapport entre deux nombres, et un rapport se
 * vérifie sur tout son domaine, pas à trois heures choisies.
 */
export function intensitesDuCiel(day: number, lueur = 1): { soleil: number; lune: number } {
  const d = Math.max(0, Math.min(1, day))
  const nuit = Math.max(0, (MOON_DAWN - d) / MOON_DAWN) // 0 en plein jour, 1 à minuit
  // `lueur` (altitude × phase, cf. `lighting.lueurDeLune`) ne fait que RETRANCHER : elle vaut 1
  // à la pleine lune au zénith, où l'on retrouve donc exactement le rendu d'avant la lune —
  // c'est l'étalon posé par Alexis (« la lumière actuelle à minuit doit être notre pleine
  // lune »). La garde exhaustive « le soleil domine partout où il fait jour » reste donc VRAIE
  // par construction : on ne peut qu'affaiblir le terme qu'elle bornait déjà.
  return { soleil: d * SUN_INTENSITY, lune: nuit * MOON_INTENSITY * Math.max(0, Math.min(1, lueur)) }
}
const AMBIENT_DAY = 0xb6ad9c // ambiante multiplicative de jour (gris chaud)
const AMBIENT_NIGHT = 0x33415f // ambiante de nuit BLEUTÉE (relevée) : les arbres ne tombent plus au noir

/**
 * ═══ LE VOILE NE COUVRE PAS LES SPRITES — C'EST L'AMBIANTE QUI LEUR FAIT LA NUIT ═══
 * *(« il faut que la nouvelle lune soit vraiment très sombre, proche du noir » — Alexis,
 * 2026-08-26, après un premier assombrissement qui n'a porté que sur le sol.)*
 *
 * En rendu ÉCLAIRÉ — le mode nominal depuis le 2026-07-24 — le voile de nuit est posé à
 * `AMBIENT_DEPTH_LIT` (8), c'est-à-dire SOUS tous les sprites (≥ 1000) : il ne tinte que le
 * fond. Assombrir `voileDeNuit` ne pouvait donc, par construction, rien faire aux arbres, aux
 * bêtes ni à l'avatar — eux prenaient leur nuit d'ici, d'un `AMBIENT_NIGHT` FIXE qui ne
 * connaissait pas la lune. MESURÉ avant de toucher quoi que ce soit : à la nouvelle lune, le
 * sol descendait à (9, 9, 15) pendant qu'un sprite d'albédo moyen (140) restait à (28, 36, 52)
 * — trois fois plus clair que sa propre terre. On voyait le monde en négatif de ce qu'on
 * voulait : les objets brillaient sur une nuit noire.
 *
 * L'AMBIANTE SANS LUNE SE DÉRIVE, ELLE NE SE CHOISIT PAS. La nuit noire a déjà un étalon —
 * le facteur que le voile applique au sol quand la lune est absente. On le lui DEMANDE
 * (`multiplicateurDuVoile`) au lieu d'écrire un second nombre à côté du premier : sprite et
 * sol reçoivent alors le MÊME multiplicateur, donc l'image tombe d'un bloc, et le rapport
 * entre un corps et sa terre — le contraste de Weber que le multiply préserve — traverse la
 * nuit intact. Un réglage écrit à la main aurait dérivé du voile à la première retouche.
 *
 * CE QUE ÇA NE TOUCHE PAS, et c'est la garde qui compte : `part` s'annule dès qu'il fait jour
 * (même rampe que la lune, `MOON_DAWN`). Or à la NOUVELLE lune, la lune transite EN PLEIN
 * MIDI (sa phase EST son heure) : sans ce facteur, une nuit noire aurait assombri le plein
 * jour du jour 72. C'est exactement le rôle que `partNuit` tient dans `voileDeNuit`, et c'est
 * le contrôle « MIDI » de la sonde `ciel`.
 */
const AMBIENT_SANS_LUNE = multiplicateurDuVoile(voileDeNuit(ambientTint(heureCanonique(0)), 0))

/**
 * L'AMBIANTE DU CIEL — pure, donc prouvée par un test, comme `intensitesDuCiel`.
 * `lueur` = `lighting.lueurDeLune` (altitude × phase) : 1 à la pleine lune au zénith, où l'on
 * retrouve EXACTEMENT `AMBIENT_NIGHT`, l'étalon posé par Alexis (« la lumière actuelle à
 * minuit doit être notre pleine lune ») ; 0 sans lune, où la nuit rejoint le sol.
 */
/**
 * ═══ L'INTENSITÉ D'UNE SOURCE DE FEU — la formule COMPOSÉE, sortie du corps de `update` ═══
 *
 * Elle en sort pour une raison précise : c'est ici que deux propositions se rencontrent, et
 * leur rencontre a un plafond que le code se doit de PROUVER, pas de commenter. Un plafond
 * qu'on ne peut vérifier qu'en lisant une boucle de rendu n'est pas un plafond.
 *
 * Trois termes :
 *   · le SOCLE — ce que la source vaut de base : plus fort la nuit (∝ 1−jour), un peu plus
 *     fort si le village couve (∝ |warmth|). C'est l'étalon, inchangé depuis le calibrage
 *     « CALMER la flamme au-dessus des bûches ».
 *   · la RESPIRATION — le battement, amorti à 55 %. À pleine amplitude la canopée clignoterait.
 *   · le LISERÉ — le gain qui resserre et intensifie pour sculpter les volumes.
 *   · l'ÉTAT du feu (`facteur`) — plein allumé, atténué en braises, NUL éteint (spec
 *     feu-station S1/S3). Il entre ICI, après le plafond, et pas au point d'appel : la boucle
 *     de rendu n'a pas de banc, cette fonction en a un. Un feu éteint garde une source large
 *     et chaude tant que personne ne la multiplie par zéro — c'est très exactement le défaut
 *     qu'on corrige (l'appelant `continue` avant, donc `facteur` ne vaut jamais 0 en pratique ;
 *     il est là pour que le contrat de la fonction soit COMPLET, testable sans la boucle).
 *
 * ⚠ LE PLAFOND PORTE SUR LE PRODUIT. C'est le produit qui sature le sol, pas l'un ou l'autre
 * facteur : `socle × 3` est la valeur dont le calibrage d'origine dit, MESURÉ, qu'au-delà
 * « le sol pile autour saturait (rouge+vert au plafond → aplat orange) et les rondins étaient
 * écrasés par contraste ». Le liseré seul tenait sous ce plafond ; le liseré QUI RESPIRE le
 * franchirait aux pics. Le défaut serait revenu par la porte de la composition, sans qu'aucune
 * des deux propositions ne l'ait rouvert toute seule.
 */
export function intensiteDuFeu(
  day: number,
  engage: number,
  beat: number,
  ax: { respiration: boolean; coeurBlanc: boolean; lisere: boolean; compose: boolean },
  /** L'état du feu, en facteur : 1 allumé, `BRAISES_FACTEUR` en braises, 0 éteint. Il
   *  s'applique APRÈS le plafond — le plafond borne ce que la source vaut quand elle brûle. */
  facteur = 1,
): number {
  const socle = (0.6 + 1.2 * (1 - day)) * (0.8 + 0.2 * engage)
  const respire = ax.respiration || ax.coeurBlanc ? 1 + (beat - 1) * 0.55 : 1
  const gain = ax.lisere ? (ax.compose ? 2.35 : 2.8) : 1
  return Math.min(socle * PLAFOND_DU_FEU, socle * respire * gain) * facteur
}

/** L'atténuation des BRAISES, partagée avec `WorldScene.litFires` (le trou du voile, la flaque
 *  au sol et le reflet sur l'eau prennent le même cran) : une seule marche pour tout le feu. */
export const BRAISES_FACTEUR = 0.4

/**
 * L'ÉTAT D'UN FEU, EN FACTEUR — l'échelle unique de toutes ses lumières (spec feu-station S3,
 * « trois crans nets ») : 1 allumé, `BRAISES_FACTEUR` en braises, **0 éteint**.
 *
 * Elle existe pour que la marche soit à UN endroit. Cette même échelle était écrite deux fois
 * (ici en creux — elle manquait, c'est le défaut ; et à la main dans `WorldScene.litFires`),
 * or c'est le genre de duplication qui se désynchronise en silence : une couche du feu
 * s'éteindrait une marche avant l'autre, et le feu mourrait en deux temps.
 */
export function facteurDuFeu(tick: number, s: Structure): number {
  const st = fireStateAt(tick, s)
  return st === 'lit' ? 1 : st === 'ember' ? BRAISES_FACTEUR : 0
}

/** Le plafond, en multiples du socle — voir `intensiteDuFeu`. */
export const PLAFOND_DU_FEU = 3

export function ambianteDuCiel(day: number, lueur = 1): number {
  const d = Math.max(0, Math.min(1, day))
  const part = Math.max(0, (MOON_DAWN - d) / MOON_DAWN) // la nuit installée : 0 tant qu'il fait jour
  const manque = 1 - Math.max(0, Math.min(1, lueur)) // ce que la lune NE donne pas
  return lerpColor(lerpColor(AMBIENT_NIGHT, AMBIENT_SANS_LUNE, manque * part), AMBIENT_DAY, d)
}
const FEU_MAX = 24 // borne dure de lumières de Feu (le manager plafonne à maxLights=40)
/**
 * Borne dure des torches PORTÉES. Le budget du manager est de 40 (`main.ts`) : les Feux en
 * réservent 24, le soleil et la lune 2, les essaims de lucioles 3. Quatre torches suffisent —
 * le joueur, et les rares porteurs qui partagent son écran. Au-delà, la lumière de la cinquième
 * est simplement absente : sa flaque au sol et son trou dans le voile, eux, restent (ils ne
 * coûtent rien au `LightsManager`), donc elle continue de se voir. Une dégradation, pas un trou.
 */
const TORCHE_MAX = 4
/** À hauteur d'ÉPAULE (px) : une torche se porte, elle ne se pose pas. Le Feu, lui, est à
 *  `TILE_PX * 0.6` — une flamme qui RASE l'herbe. L'écart se voit sur les fûts alentour. */
const TORCHE_Z = TILE_PX * 1.1
/** Bien SOUS un Feu (0,6 + 1,2×nuit, soit ~1,8 à minuit) : un poing de flamme, pas un foyer.
 *  DIVISÉE PAR DEUX le 2026-08-26 (0,85 → 0,45) en échange d'un rayon doublé (`TORCHE_LIGHT_
 *  TILES` 5 → 10) : elle touche deux fois plus de fûts, chacun deux fois moins fort — le halo
 *  s'étale au lieu de brûler ce qui est à un pas (voir l'en-tête de `render/torche.ts`). */
const TORCHE_INTENSITE = 0.45
// LA FLAMME EST AU-DESSUS DES BÛCHES, PAS DESSUS. Le point-light du Feu était posé au CENTRE de
// la tuile du foyer — donc pile sur le sprite des rondins. Résultat : lumière de face, la normal
// map des bûches ne « réagissait » pas (dot(normale, lumière) ~uniforme → aplati). On décale la
// source vers le NORD (−y, cf. le soleil/lune « en haut ») d'UNE tuile : négligeable pour le halo
// alentour (rayon de dizaines de tuiles), mais décisif pour les rondins (16 px) — la lumière les
// RASE, un côté clair / un côté sombre, et le galbe cylindrique ressort. On NE monte PAS le z : le
// shader de Phaser rend `lightDir` plus VERTICAL (plus plat) quand z croît — l'inverse du but.
// Décalage FIN (~⅓ de tuile). Une tuile pleine rasait trop : la bûche (sprite 16 px) tombait
// presque entièrement dans l'ombre (dot ≤ 0) → bois bleu nuit. À ~⅓ de tuile, la lumière vient
// d'un peu au-dessus/nord : les sommets des rondins restent chauds, le dessous s'ombre à peine —
// un galbe cylindrique lisible, sans noyer le bois. Négligeable pour le halo alentour (rayon >>).
const FEU_LIFT = TILE_PX * 0.3

function setLightColor(light: Phaser.GameObjects.Light, rgb: number, scale = 1): void {
  const r = ((rgb >> 16) & 0xff) / 255 * scale
  const g = ((rgb >> 8) & 0xff) / 255 * scale
  const b = (rgb & 0xff) / 255 * scale
  light.color.set(r, g, b)
}

export class DynamicLighting {
  private sun: Phaser.GameObjects.Light
  private moon: Phaser.GameObjects.Light
  private feux = new Map<number, Phaser.GameObjects.Light>()
  private torches = new Map<number, Phaser.GameObjects.Light>()
  private wasActive = false

  constructor(private scene: Phaser.Scene) {
    scene.lights.enable()
    this.sun = scene.lights.addLight(0, 0, SUN_RADIUS, WHITE, 0, SUN_Z)
    this.moon = scene.lights.addLight(0, 0, SUN_RADIUS, MOON_COLOR, 0, SUN_Z)
  }

  /**
   * @param active toggle debug armé ? Sinon on éteint tout (aucun objet n'est lit de
   *   toute façon) et on sort — la scène rend comme avant.
   */
  update(
    active: boolean,
    cam: Phaser.Cameras.Scene2D.Camera,
    /** LES FEUX de l'image — la sous-liste que `WorldScene` dérive UNE fois et sert aux trois
     *  couches de feu (PERF-08 : quatre balayages de `structures` par image cherchaient tous le
     *  même petit sous-ensemble). La garde `type !== 'fire'` ci-dessous RESTE : l'Atelier des
     *  plans, lui, passe encore tout le bâti, et une liste déjà filtrée la traverse sans frais. */
    structures: Structure[],
    villages: SnapshotMessage['villages'],
    hour: HeureSolaire,
    day: number,
    now: number,
    /** Le jour de saison AVEC ses décimales (`seasonDay + jourFrac`) — la phase de la lune.
     *  Par défaut la PLEINE lune : l'étalon (« la lumière actuelle à minuit »), donc ce que
     *  rendait ce module avant qu'elle existe. L'Atelier des plans s'en contente. */
    jourLune = LUNE_PLEINE_JOUR,
    /** `lighting.lueurDeLune(hour, jourLune)` — résolue par l'appelant, qui la partage avec le
     *  voile de nuit : les deux doivent parler de la MÊME lune. */
    lueur = 1,
    /** LES TORCHES PORTÉES (spec `torche.md`) — position INTERPOLÉE et part de flamme, résolues
     *  par l'appelant, qui les partage avec la flaque au sol et le trou du voile : les TROIS
     *  branchements d'une même source doivent battre en phase (le patron des Feux). */
    torches: PorteurDeTorche[] = [],
    /** LE TICK DU DERNIER SNAPSHOT — l'état d'un feu s'en dérive (`fireStateAt`), et c'est le
     *  MÊME tick que reçoivent `FireFx` et `FireGroundGlow` : les trois couches d'un feu doivent
     *  parler du même instant, sans quoi l'une s'éteint une image avant l'autre.
     *  Défaut 0 pour l'Atelier des plans, dont les feux naissent avec leur bois (`addStructure`)
     *  et valent donc « allumé » à tout tick. */
    tick = 0,
  ): void {
    if (!active) {
      if (this.wasActive) {
        this.sun.intensity = 0
        this.moon.intensity = 0
        for (const f of this.feux.values()) f.intensity = 0
        for (const t of this.torches.values()) t.intensity = 0
      }
      this.wasActive = false
      return
    }
    this.wasActive = true

    // Ambiante : lit les arbres même sans lumière directe ; sombre la nuit pour que les Feux
    // ressortent — et elle SUIT LA LUNE, sans quoi les sprites resteraient éclairés au-dessus
    // d'un sol devenu noir (cf. l'en-tête d'`AMBIENT_SANS_LUNE`).
    this.scene.lights.setAmbientColor(ambianteDuCiel(day, lueur))

    // LE SOLEIL — point lointain dans la direction du soleil, centré sur la vue.
    const v = cam.worldView
    const cx = v.x + v.width / 2, cy = v.y + v.height / 2
    const dir = sunDirection(hour) // x est+ (aube) → ouest (couchant) : le balayage droite→gauche
    this.sun.x = cx + dir.x * SUN_FAR
    this.sun.y = cy - SUN_NORTH // EN HAUT : la source reste au nord de la vue (haut de l'écran)
    this.sun.intensity = intensitesDuCiel(day).soleil
    setLightColor(this.sun, lerpColor(GOLDEN, WHITE, day))

    // LA LUNE — un voile FROID venu d'EN HAUT, bien plus faible que le soleil, qui ne vit que la
    // nuit (∝ 1-day). Elle donne aux houppiers un léger relief bleuté au lieu d'un aplat noir.
    //
    // ELLE TRAVERSE LE CIEL COMME LE SOLEIL depuis le 2026-08-25 (demande d'Alexis) : sa
    // position était FIXE au nord de la vue, ce qui donnait à toute nuit le même relief, au même
    // endroit. Son arc est celui du soleil, décalé de sa PHASE (`moonDirection`) — à la pleine
    // lune elle est à l'opposé du soleil et balaie la nuit entière ; à la nouvelle elle passe
    // avec lui, en plein jour, et la nuit n'a plus de lune du tout.
    const dirL = moonDirection(hour, jourLune)
    this.moon.x = cx + dirL.x * SUN_FAR
    this.moon.y = cy - SUN_NORTH // EN HAUT, comme le soleil : le biais nord est celui de la DA
    this.moon.intensity = intensitesDuCiel(day, lueur).lune

    // LES FEUX — un point light chaud par structure `fire` (réconcilié par id).
    const seen = new Set<number>()
    let count = 0
    for (const s of structures) {
      if (s.type !== 'fire' || count >= FEU_MAX) continue
      // ═══ UN FEU ÉTEINT N'ÉCLAIRE PLUS (spec feu-station S1 : « éteint … halo éteint ») ═══
      //
      // C'était le trou : la flaque au sol (`fire-ground-glow`), les particules (`FireFx`), le
      // trou du voile et le reflet sur l'eau consultent tous `fireStateAt` — cette source-ci,
      // la seule qui touche les VOLUMES, ne l'a jamais fait. Un feu qui vient de mourir laissait
      // les fûts autour éclairés d'ambre au-dessus de bûches froides : le sol s'éteignait, la
      // canopée non. On saute AVANT `count++`, comme `fire-ground-glow` : la réconciliation en
      // fin de boucle retire la lumière, et un feu mort ne mange plus un des `FEU_MAX` créneaux
      // (conséquence du garde, pas une réécriture de la règle du plafond — FX-03 reste ouvert).
      const facteur = facteurDuFeu(tick, s)
      if (facteur <= 0) continue // éteint
      count++
      seen.add(s.id)
      const warmth = villages.find((vg) => vg.id === s.villageId)?.warmth ?? 0
      const ax = axesFeu()
      const g = fireGlow(warmth, day, now, s.id * 1.7, ax.respiration)
      const engage = Math.min(1, Math.abs(warmth) / 100)
      let light = this.feux.get(s.id)
      if (!light) {
        light = this.scene.lights.addLight(0, 0, 0, 0xffffff, 0, TILE_PX * 0.6)
        this.feux.set(s.id, light)
      }
      light.x = s.tx * TILE_PX + TILE_PX / 2
      light.y = s.ty * TILE_PX + TILE_PX / 2 - FEU_LIFT // décalé au NORD : la flamme est au-dessus des rondins (voir FEU_LIFT)
      // ═══ LE LISERÉ CHAUD — la source qui sculpte ═══
      // La source du Feu est aujourd'hui LARGE et FAIBLE (rayon ×2,4, intensité calmée) : elle
      // baigne la canopée d'un ambre uniforme, donc elle ne SCULPTE rien — un volume éclairé de
      // partout n'a pas de côté sombre, et sans côté sombre il n'y a pas de relief. On resserre
      // (×1,35) et on monte l'intensité : le fût qui touche le feu prend un liseré franc, celui
      // d'à côté reste dans la nuit. C'est le seul levier de ce banc qui agisse sur les VOLUMES
      // et non sur le sol.
      light.radius = g.radius * TILE_PX * (ax.lisere ? 1.5 : 2.4)
      // LA COULEUR SUIT LA TEMPÉRATURE : au creux du battement elle vire au rouge profond, au
      // pic elle blanchit. C'est ce que fait un tison qu'on souffle, et qu'aucune couleur fixe
      // ne peut rendre.
      if (ax.coeurBlanc) {
        const chaud = Math.max(0, Math.min(1, (g.beat - 0.86) / 0.5)) // 0 au creux, 1 au pic
        light.color.set(1.0, 0.34 + 0.42 * chaud, 0.1 + 0.36 * chaud)
      } else {
        // Couleur CHAUDE (pas la couleur politique du Feu) — un peu plus rouge s'il couve fort.
        light.color.set(1.0, 0.5 - 0.14 * engage, 0.22 - 0.13 * engage)
      }
      // « CALMER la flamme au-dessus des bûches » (demande d'Alexis) : à ~3 la nuit, la source SATURAIT
      // le sol pile autour (rouge+vert au plafond → aplat orange) et écrasait les rondins par contraste.
      // On BAISSE l'intensité (brillance locale) SANS toucher au rayon (portée) — les deux leviers sont
      // distincts : la canopée s'allume toujours loin (radius ×2.4), mais le sol proche ne crame plus et
      // le galbe des bûches se lit. Valeur d'ordre de grandeur, à caler en playtest.
      // ═══ LE BATTEMENT ENTRE DANS LA LUMIÈRE (variantes 1, 2, 4) ═══
      // L'étalon ne fait PAS battre cette source : le sol vacille (la flaque), la canopée non.
      // C'est la moitié du « feu mort » — dans une clairière de nuit, le feu est la seule source,
      // donc c'est TOUT ce qu'on voit qui doit respirer avec lui, pas juste le rond au sol.
      // Amorti (le battement moins sa moyenne, ×0,55) : à pleine amplitude la canopée clignoterait.
      // COMPOSITION ② — la formule et son plafond vivent dans `intensiteDuFeu` (fonction pure,
      // sous test) : c'est là que le liseré et la respiration se rencontrent, et un plafond
      // qu'on ne peut vérifier qu'en lisant une boucle de rendu n'en est pas un.
      // …et les BRAISES prennent le même cran que le reste du feu (`BRAISES_FACTEUR`) : la
      // canopée baisse avec la flaque au sol, elle ne reste pas en plein jour ambré.
      light.intensity = intensiteDuFeu(day, engage, g.beat, ax, facteur)
    }
    for (const [id, light] of this.feux) {
      if (seen.has(id)) continue
      this.scene.lights.removeLight(light)
      this.feux.delete(id)
    }

    // LES TORCHES — une source chaude PAR PORTEUR, qui MARCHE. Même patron que les Feux, à
    // trois écarts près, et ils sont tout le sujet :
    //   • elle se pose sur la position INTERPOLÉE (px monde), pas sur une tuile ;
    //   • elle est HAUTE (`TORCHE_Z`) : une torche se tient à hauteur d'épaule, elle n'est pas
    //     posée dans l'herbe comme un foyer — les fûts autour s'allument à mi-hauteur ;
    //   • son intensité passe par `forceDeTorche`, donc elle AGONISE avec la flamme.
    const vus = new Set<number>()
    let nT = 0
    for (const p of torches) {
      if (nT >= TORCHE_MAX) break
      const force = forceDeTorche(p.part, day, now, p.id * 2.3)
      if (force <= 0) continue
      nT++
      vus.add(p.id)
      let light = this.torches.get(p.id)
      if (!light) {
        light = this.scene.lights.addLight(0, 0, 0, 0xffffff, 0, TORCHE_Z)
        this.torches.set(p.id, light)
      }
      light.x = p.x
      light.y = p.y
      light.radius = TORCHE_LIGHT_TILES * TILE_PX
      // Un ambre franc et pauvre en bleu — la MÊME logique que la flaque : le bleu délave.
      light.color.set(1.0, 0.62, 0.3)
      light.intensity = TORCHE_INTENSITE * force
    }
    for (const [id, light] of this.torches) {
      if (vus.has(id)) continue
      this.scene.lights.removeLight(light)
      this.torches.delete(id)
    }
  }

  destroy(): void {
    this.scene.lights.removeLight(this.sun)
    this.scene.lights.removeLight(this.moon)
    for (const f of this.feux.values()) this.scene.lights.removeLight(f)
    this.feux.clear()
    for (const t of this.torches.values()) this.scene.lights.removeLight(t)
    this.torches.clear()
  }
}
