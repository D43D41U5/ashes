/**
 * Lumière & ambiance — fonctions PURES de l'heure murale et du terrain.
 * Aucune dépendance Phaser : testé en unitaire (lighting.test.ts), comme
 * framing.ts. Le rendu (couches, blend) vit dans les scènes ; ici, uniquement
 * les courbes. Côté client, Math.sin/floor/round sont autorisés (l'interdit des
 * approximations est sim-only).
 */

import { TICKS_PER_CYCLE } from '@ashes/sim'

/** Alpha maximal de la teinte de nuit — plafonné pour que la nuit reste tout juste lisible. */
export const NIGHT_ALPHA_MAX = 0.72

const GLOW_MAX_ALPHA = 0.9
const GLOW_MIN_RADIUS_TILES = 3
const GLOW_SPAN_TILES = 5

function lerp(a: number, c: number, t: number): number {
  return a + (c - a) * t
}

export function lerpColor(c1: number, c2: number, t: number): number {
  const rr = Math.round(lerp((c1 >> 16) & 0xff, (c2 >> 16) & 0xff, t))
  const gg = Math.round(lerp((c1 >> 8) & 0xff, (c2 >> 8) & 0xff, t))
  const bb = Math.round(lerp(c1 & 0xff, c2 & 0xff, t))
  return (rr << 16) | (gg << 8) | bb
}

/** Le PRODUIT de deux teintes plates, canal par canal — ce que fait une lumière colorée qui
 *  traverse un filtre (la lumière de l'heure, puis la nuit du plateau). */
export function produitCouleurs(c1: number, c2: number): number {
  const rr = Math.round((((c1 >> 16) & 0xff) * ((c2 >> 16) & 0xff)) / 255)
  const gg = Math.round((((c1 >> 8) & 0xff) * ((c2 >> 8) & 0xff)) / 255)
  const bb = Math.round(((c1 & 0xff) * (c2 & 0xff)) / 255)
  return (rr << 16) | (gg << 8) | bb
}

/** Paire de keyframes encadrant `hour` (horloge murale) + facteur d'interpolation. */
function bracket<T extends { hour: number }>(keys: T[], hour: number): { lo: T; hi: T; t: number } {
  const h = ((hour % 24) + 24) % 24
  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i]
    const hi = keys[i + 1]
    if (lo && hi && h >= lo.hour && h <= hi.hour) {
      const span = hi.hour - lo.hour
      return { lo, hi, t: span === 0 ? 0 : (h - lo.hour) / span }
    }
  }
  const last = keys[keys.length - 1]
  if (!last) throw new Error('bracket: keys must be non-empty')
  return { lo: last, hi: last, t: 0 }
}

/**
 * Couleur du Feu selon l'alignement — MÊME formule que snapshot-view (DRY) :
 * warmth > 0 → bleu (Foyer), warmth < 0 → rouge (Meute), 0 → blanc.
 */
export function warmthColor(warmth: number): number {
  const t = Math.max(-1, Math.min(1, warmth / 100))
  const red = t > 0 ? Math.floor(255 - 130 * t) : 255
  const green = Math.floor(255 - 90 * Math.abs(t))
  const blue = t < 0 ? Math.floor(255 + 140 * t) : 255
  return (red << 16) | (green << 8) | blue
}

/** Le soleil se lève et se couche AUX BORNES DE `DAYLIGHT_KEYS`, pas trois heures avant. */
const SUN_RISE = 5
const SUN_SET = 21

/**
 * ═══ L'HEURE SOLAIRE — l'horloge que lit TOUTE la chaîne d'éclairage (2026-08-26) ═══
 *
 * LE DÉFAUT CORRIGÉ. `/sim` fait varier la longueur du jour avec la saison depuis le
 * 2026-08-23 (`BALANCE.PART_DE_JOUR`, spec `saisons.md` S6) : le crépuscule tombe à **22 h 04**
 * à l'ouverture des Pluies, à **17 h 31** au cœur du Grand Froid, à **23 h 17** au cœur de
 * l'Ardeur. Le rendu, lui, allumait à 5 h et éteignait à 21 h — les mêmes keyframes tous les
 * jours de l'année. Deux conséquences VISIBLES, et c'est ce qu'Alexis a vu :
 *   · au cœur de l'hiver, la barre haute affichait la LUNE à 17 h 31 (`time.isNight`, qui vient
 *     de la sim) au-dessus d'une vallée en plein jour — les loups chassaient, le froid tombait,
 *     et l'écran disait midi. Quatre minutes réelles de nuit peinte en jour.
 *   · à l'Ardeur, l'inverse : l'écran était noir **2 h 17** avant que la sim passe en nuit.
 * Et la fiche de saison de l'encyclopédie affiche la part de jour de chaque saison (62 / 72 /
 * 62 / 48 %) : elle promettait une chose que le rendu ne tenait pas.
 *
 * LA FORME. Le cycle de la sim commence au LEVER (`cycleTick` 0) et bascule en nuit à
 * `dayTicks`. Les DEUX bornes suivent la saison depuis que le soleil est celui de la France
 * (`BALANCE.LEVER_DU_JOUR` + `PART_DE_JOUR` : 06h46→18h56 aux équinoxes, 04h45→20h56 en été,
 * 08h43→16h58 en hiver). On garde l'horloge murale uniforme (décision d'Alexis, 2026-08-26 :
 * « la nuit tombe à cinq heures en hiver » doit se LIRE sur l'horloge) et on ne déforme que
 * l'heure donnée aux courbes : une affine par morceaux qui envoie le JOUR réel
 * `[lever, coucher]` sur le jour canonique `[6 h, 21 h]`, et la NUIT réelle sur `[21 h, 6 h]`.
 *
 * `lever` et `dayTicks` viennent tous deux du snapshot (`GameTime`) : le rendu ne recalcule
 * NI l'un NI l'autre — c'est ce qui garantit qu'il est à la même heure que la sim, au tick.
 *
 * ⚠ **À `lever = 6 h` ET `p = 0,625` C'EST L'IDENTITÉ**, et c'est tout le filet de sécurité :
 * ce sont les valeurs pour lesquelles CHAQUE keyframe de ce fichier a été calibrée (l'or de
 * 20 h, la brume de 5 h 30, l'arc du soleil, le lever de lune). Sur ce jour-là le rendu est
 * bit-exact avec celui d'hier ; ailleurs il glisse et se contracte, mais l'ORDRE des
 * événements du ciel ne change jamais. Affirmé par balayage, pas commenté (`lighting.test.ts`).
 *
 * ⚠ **UNE SEULE HORLOGE TRAVERSE LA CHAÎNE.** Le post-mortem de `sunDirection` (juste en
 * dessous) est celui de ce défaut-là exactement : deux chaînes d'éclairage pas à la même
 * heure, un cosinus à ±1 sur une borne d'arc, et le soleil qui saute de 2 200 px à pleine
 * puissance. C'est pourquoi `HeureSolaire` est une marque de type et non un `number` : passer
 * un `hourOfCycle` nu à `daylight`, `ambientTint`, `sunDirection` ou `moonDirection` ne
 * compile pas. Le compilateur énumère les appelants — pas un grep.
 */
export type HeureSolaire = number & { readonly __heureSolaire: unique symbol }

/**
 * LE CADRAN CANONIQUE — le jour de convention sur lequel CHAQUE keyframe de ce fichier est
 * écrite : lever à 6 h, coucher à 21 h. Ce n'est plus l'heure d'aucun jour du monde (le lever
 * suit la saison depuis le 2026-08-26, de 04h45 à 08h43) : c'est le REPÈRE vers lequel
 * `heureSolaire` ramène toutes les heures, pour que les courbes n'aient pas à bouger.
 */
const AUBE_CANONIQUE = 6
const JOUR_CANONIQUE = SUN_SET - AUBE_CANONIQUE // 21 − 6 = 15 h
const NUIT_CANONIQUE = 24 - JOUR_CANONIQUE // 9 h

/**
 * L'heure à donner aux courbes, depuis l'heure murale de la sim et la longueur du jour DE CE
 * CYCLE (`GameTime.dayTicks`, constante sur tout le cycle — voir `dayTicksAt`).
 *
 * `dayTicks` est sur le fil : `SnapshotMsg.time` EST le `GameTime` de la sim. Rien à ajouter au
 * protocole, rien à toucher dans `/sim` — le défaut était entièrement de ce côté-ci.
 */
/**
 * LA PORTE DU CADRAN CANONIQUE — une heure nommée sur le cadran d'équinoxe, pas une heure du
 * monde. Trois usages LÉGITIMES, et rien d'autre : une constante de calibrage (`AMBIENT_SANS_LUNE`,
 * minuit), l'Atelier des plans (son curseur d'heure EST le cadran, il n'a pas de saison), et
 * les tests qui éprouvent les courbes elles-mêmes. Un site de RENDU qui l'appelle rate la
 * saison — c'est le défaut qu'`heureSolaire` corrige. La marque reste donc explicite : elle
 * se cherche au grep, et elle se justifie en une ligne.
 */
export function heureCanonique(hour: number): HeureSolaire {
  return (((hour % 24) + 24) % 24) as HeureSolaire
}

export function heureSolaire(hourOfCycle: number, dayTicks: number, lever: number): HeureSolaire {
  const p = Math.max(0.01, Math.min(0.99, dayTicks / TICKS_PER_CYCLE))
  // Heures écoulées depuis le LEVER — la coordonnée où le cycle de la sim commence à 0.
  const u = (((hourOfCycle - lever) % 24) + 24) % 24
  const jourReel = 24 * p
  const v =
    u < jourReel
      ? (u * JOUR_CANONIQUE) / jourReel
      : JOUR_CANONIQUE + ((u - jourReel) * NUIT_CANONIQUE) / (24 - jourReel)
  return (((v + AUBE_CANONIQUE) % 24) + 24) % 24 as HeureSolaire
}

/**
 * ═══ LA COURSE D'UN ASTRE — la brique commune du soleil et de la lune (2026-08-25) ═══
 *
 * Rend, pour une heure d'arc donnée, la position sur la voûte : `x` = la composante est/ouest
 * (+1 au lever, 0 au transit, −1 au coucher) et `alt` = l'ALTITUDE, de 0 à l'horizon à 1 au
 * zénith. Les deux astres partagent cette course : seule l'HEURE qu'on lui donne diffère — le
 * soleil la lit telle quelle, la lune la lit décalée de sa phase (voir `moonDirection`).
 *
 * ⚠ `alt` EST CONTINUE À SES DEUX BORNES (`sin 0 = sin π = 0`), là où `x` ne l'est pas
 * (`cos` vaut ±1). C'est la raison pour laquelle tout ce qui doit s'ÉTEINDRE proprement au
 * lever et au coucher — la lueur de la lune, sa part de voile — se dérive de `alt` et jamais
 * de `x`. Le défaut de 18 h corrigé plus haut est exactement ce qu'on évite ici par forme.
 */
function courseDuCiel(h: number): { x: number; alt: number } {
  const hh = ((h % 24) + 24) % 24
  if (hh <= SUN_RISE || hh >= SUN_SET) return { x: 0, alt: 0 } // sous l'horizon
  const az = (Math.PI * (hh - SUN_RISE)) / (SUN_SET - SUN_RISE)
  return { x: Math.cos(az), alt: Math.sin(az) }
}

/**
 * ═══ L'ARC DU SOLEIL EST CALÉ SUR LA COURBE DE JOUR (2026-08-25) ═══
 *
 * Direction VERS le soleil en espace-tuile (x est+, y sud+), de norme = FORCE directionnelle
 * de l'ombre portée : 0 = soleil au zénith (pas d'ombre), 1 = soleil rasant. Balaie est→ouest
 * sur la journée — ombres vers l'ouest le matin, vers l'est le soir, quasi nulles à midi.
 * Client (pas /sim) → sin/cos autorisés.
 *
 * LE DÉFAUT CORRIGÉ — deux chaînes d'éclairage qui n'étaient pas à la même heure, exactement
 * le travers que `MOON_DAWN` documente un étage plus bas, mais sur le soleil. L'arc courait de
 * 6 h à 18 h et se coupait par une garde `h >= 18` ; or `DAYLIGHT_KEYS` dit encore **0,70** à
 * 18 h et ne s'éteint qu'à 21 h. Et comme le balayage est un cosinus, la magnitude est à son
 * MAXIMUM (|cos π| = 1) pile là où la garde l'annulait : le soleil se téléportait de 2 200 px
 * à l'aplomb de la caméra en une image, À PLEINE PUISSANCE. MESURÉ, saut de `dirX` pondéré par
 * l'intensité (`day × 1.2`) : **0,8385 à 18 h 00**. L'eau prenait le même choc — son vecteur
 * spéculaire passait de (−1,00, −0,30, 0,30) à (0,00, −0,09, 1,15) d'un coup (`sunVector`).
 *
 * On cale donc les bornes de l'arc là où la courbe de jour s'éteint VRAIMENT — et rien d'autre
 * ne change : le balayage est→ouest, le rasant d'aube et de couchant sont conservés (choix
 * d'Alexis, 2026-08-25 : « uniforme » = sans rupture, pas figé). Le saut résiduel de fin d'arc
 * subsiste par construction (un cosinus vaut ±1 à ses bornes) mais il tombe désormais où
 * `daylight` vaut 0,05 : **0,0599**, quatorze fois plus faible, et l'autre borne (5 h) tombe où
 * `daylight` vaut 0 tout rond — invisible. C'est la garde `sunDirection continue` qui le tient.
 *
 * CE QUE ÇA DÉPLACE, mesuré avant d'écrire (même méthode que la table de `ecorce.ts`, la
 * formule du shader sur la géométrie réelle `SUN_FAR`/`SUN_NORTH`/`SUN_Z`) :
 *
 *   facette                        8 h            midi           17 h
 *   plate           (0,0,1)     0,242 → 0,247   0,361 → 0,351   0,227 → **0,268**
 *   inclinée en X   (.7,0,.71)  0,692 → 0,686   0,257 → **0,419**  0,000 → 0,000
 *   inclinée en HAUT (0,−.5,.87) 0,522 → 0,534  0,781 → 0,757   0,490 → **0,578**
 *
 * Aucune inversion : le grain en Y (règle `ecorce.ts`) paie MIEUX à 17 h qu'avant (0,578 contre
 * 0,490), et le zénith se déplaçant de 12 h à 13 h, les facettes verticales cessent d'être
 * inertes à midi (0,419 contre 0,257) — dans le bon sens, l'écorce se lit davantage.
 *
 * PIÈGE VÉRIFIÉ — `water-layer.cheminDeLAstre` écrit `sunDirection(hour).x || (aube ? 1 : −1)` :
 * ce repli avait été posé PARCE QUE la garde rendait 0 en pleine fenêtre d'aube (5,6 h ≤ 6 h).
 * Il se tait maintenant. Balayage des deux fenêtres au pas de 0,1 h : le signe est STABLE
 * (aube +0,993→+0,797, couchant −0,649→−0,962) — le couloir de l'astre ne change pas de bord.
 */
export function sunDirection(hour: HeureSolaire): { x: number; y: number } {
  return { x: courseDuCiel(hour).x, y: 0 } // |cos| = force : 1 au ras, 0 au zénith (13 h)
}

/**
 * ═══ LA LUNE TRAVERSE LE CIEL, ET SA PHASE COMMANDE SON HEURE ═══
 * *(demande d'Alexis, 2026-08-25 : « il faut que la lune traverse le ciel comme le soleil.
 * Mais en plus elle doit avoir des phases comme en vrai »)*
 *
 * UN SEUL PARAMÈTRE PILOTE TOUT, et c'est ce qui rend la chose juste au lieu de décorative :
 * en astronomie, la phase EST le décalage angulaire entre la lune et le soleil, donc elle
 * commande à la fois la forme du croissant ET l'heure à laquelle la lune passe au méridien.
 *
 *   · PLEINE (phase ½) — à l'opposé du soleil : elle se lève au couchant, transite à 1 h,
 *     se couche à l'aube. La nuit entière est éclairée.
 *   · NOUVELLE (phase 0) — avec le soleil : elle traverse le ciel EN PLEIN JOUR, invisible,
 *     et la nuit n'a littéralement aucune lune. C'est la nuit noire, et elle est gratuite.
 *   · PREMIER QUARTIER (phase ¼) — transit à 19 h, coucher vers 3 h : la première moitié de
 *     la nuit est claire, la seconde ne l'est plus. Le joueur apprend à rentrer avant.
 *
 * On n'écrit donc PAS une table de phases à côté d'une table d'horaires, qui pourraient
 * dériver l'une de l'autre : `moonTransit = transit solaire + 24 × phase`, et le reste suit.
 *
 * ═══ LA LUNAISON SE COMPTE EN JOURS DE SAISON — et cette prémisse se prouve ═══
 *
 * 23 jours (choix d'Alexis, 2026-08-25). C'est un NOMBRE PREMIER, donc premier avec la saison
 * (`ACT_DAYS` = 30) comme avec l'année (120) : la pleine lune glisse de sept jours par saison
 * et le calendrier ne se resynchronise avec la lune qu'au bout de 690 jours — cinq ans et
 * demi de jeu. Là où 30 l'aurait figée au même jour de chaque saison, pour toujours. Plus
 * court que le vrai mois synodique (29,53) : la lune tourne vite, on la voit vivre.
 *
 * ⚠ « 29 jours » ne vaut « 29 NUITS » que sous le couplage **un jour = un cycle** posé le
 * 2026-08-23 (`VEILLEE_SEASON_CYCLES = SEASON_DAYS`, donc `calendarScale` = 48). Les deux
 * horloges du jeu sont faites pour être découplées ; sous une autre échelle, une lunaison
 * entière tiendrait dans une seule nuit et la lune changerait de forme entre le crépuscule
 * et l'aube. La garde `la lunaison se compte en nuits` affirme ce couplage à part, plutôt
 * que de le supposer.
 *
 * L'ANCRAGE EST UN CHOIX, PAS UNE DÉRIVATION : le monde ouvre au jour 61 (`saisons.md` S2)
 * SUR UNE PLEINE LUNE — la première nuit est la plus clémente, et l'obscurité arrive une fois
 * qu'on est installé.
 */
/**
 * ⚠ LA PÉRIODE ET L'ANCRAGE VIENNENT DE `/sim` DEPUIS LE 2026-08-26 (`nuit.ts`), et la phase
 * avec eux : la RÈGLE du noir (« ni course ni parade sous `NUIT.SEUIL_NOIR` ») les lit aussi,
 * et deux ancrages qui dériveraient l'un de l'autre feraient mordre la règle sur une lune que
 * l'écran peindrait pleine. On les RÉEXPORTE ici pour que les appelants de ce module (voile,
 * eau, éclairage dynamique) n'aient pas à savoir d'où ils viennent.
 *
 * ⚠ CE QUI RESTE ICI, ET QUI NE DOIT PAS PARTIR : `clarteDeLune` ci-dessous, le cosinus EXACT.
 * `/sim` en tient sa propre version TABULÉE (`Math.cos` y est interdit, invariant §2) — deux
 * courbes, donc, et c'est délibéré : on ne glisse pas une approximation sous un voile de nuit
 * calibré à l'œil. Elles s'accordent à **0,0042** près (mesuré), et surtout la règle est
 * toujours la plus GÉNÉREUSE des deux — elle ignore l'altitude de l'astre, donc
 * `clarté_sim ≥ lueur_écran` À TOUTE HEURE : **le noir ne mord jamais sur un écran clair.**
 * C'est CET invariant-là qu'un changement de l'une des deux courbes doit préserver.
 */
export { LUNAISON_JOURS, LUNE_PLEINE_JOUR, phaseDeLune } from '@ashes/sim'
import { phaseDeLune } from '@ashes/sim' // la phase sert ici (clarté, course de l'astre)

/** La part du disque éclairée, dans [0, 1] — 0 à la nouvelle lune, 1 à la pleine. La vraie
 *  formule : la fraction illuminée d'une sphère vue sous un angle de phase. */
export function clarteDeLune(jour: number): number {
  return (1 - Math.cos(2 * Math.PI * phaseDeLune(jour))) / 2
}

/** Direction VERS la lune, MÊME convention que `sunDirection` — la course du ciel, lue à
 *  l'heure décalée de la phase. À la nouvelle lune le décalage est nul : la lune est
 *  exactement où est le soleil, donc absente de la nuit. */
export function moonDirection(hour: HeureSolaire, jour: number): { x: number; y: number } {
  return { x: courseDuCiel(hour - 24 * phaseDeLune(jour)).x, y: 0 }
}

/**
 * LA LUEUR DE LA LUNE, dans [0, 1] — le seul nombre que le rendu ait besoin de connaître :
 * **son altitude × la part de son disque éclairée**. Une lune couchée n'éclaire pas ; une
 * lune neuve non plus ; une pleine lune au zénith éclaire à plein.
 *
 * Elle S'ÉTEINT PAR CONSTRUCTION à son lever et à son coucher (`alt` y vaut 0, continûment) :
 * aucune garde de nuit à écrire, aucun saut possible.
 */
export function lueurDeLune(hour: HeureSolaire, jour: number): number {
  return courseDuCiel(hour - 24 * phaseDeLune(jour)).alt * clarteDeLune(jour)
}

/**
 * ═══ LE VOILE DE NUIT SUIT LA LUNE (décision d'Alexis, 2026-08-25) ═══
 *
 * *« Le rendu actuel de la lumière la nuit fonctionne bien ; la lumière naturelle actuelle à
 * minuit doit être notre PLEINE LUNE. »* Donc `NIGHT_ALPHA_MAX` (0,72, le plafond « tout juste
 * lisible » déjà calibré) devient la valeur de la PLEINE lune : rien ne s'éclaircit jamais
 * au-dessus d'aujourd'hui, tout se soustrait en descendant vers la nouvelle lune.
 *
 * CE QUE ÇA NE CASSE PAS, et c'est ce qui rend le geste sûr : le voile est en **MULTIPLY**
 * (voir `night-veil.ts`), et un multiply CONSERVE EXACTEMENT le rapport entre deux teintes.
 * Monter l'alpha baisse la luminance absolue SANS toucher au contraste de Weber de l'avatar
 * sur son sol — le défaut mesuré de l'audit 2026-08-20 (1,20:1 à 20 h) venait du MÉLANGE de
 * deux lumières de teintes opposées, pas du voile, et n'est donc pas rouvert ici.
 *
 * Le Feu, lui, creuse toujours son trou de 6 tuiles (`fireHoleRadius`) : on n'est jamais
 * aveugle CHEZ SOI, seulement dehors. C'est très exactement le rôle que le jeu lui promet.
 */
/**
 * ═══ MONTER L'OPACITÉ NE SUFFIT PAS — LE BLEU DE LA NUIT *EST* LA LUNE ═══
 *
 * *« En nouvelle lune, on ne devrait quasiment rien voir, très dangereux »* (Alexis,
 * 2026-08-26). Premier essai : ne pousser que l'alpha, à 0,90. MESURÉ sur un sol gris moyen,
 * ça ne descend qu'à **(16, 19, 54)** — et c'est un PLANCHER, pas un réglage trop timide.
 *
 * La raison est dans le multiplicateur lui-même. `NIGHT_COLOR` porte un bleu de 92/255, donc
 * `M_b ≥ 0,36` QUELLE QUE SOIT L'OPACITÉ : même à alpha 1, un gris moyen ressort à 46 de bleu.
 * La nuit ne peut structurellement pas devenir noire tant qu'on ne touche qu'à l'opacité.
 *
 * Ce plancher n'est pas un défaut — c'est le froid de la nuit, délibérément mis dans la couleur
 * le 2026-07-24 quand le voile est passé en MULTIPLY (voir l'en-tête de `NIGHT_COLOR` : « on
 * refroidit le multiplicateur lui-même », le froid maximal disponible). Mais ce froid-là, en
 * vrai, c'est du CLAIR DE LUNE : l'œil scotopique vire au bleu parce qu'il reste une source.
 * Sans lune, il ne reste rien à virer — la nuit n'est pas bleue, elle est noire.
 *
 * On fait donc glisser la TEINTE en même temps que l'opacité, sur la même rampe. Résultat
 * mesuré au même endroit : **(9, 9, 15)**. Un noir à peine bleuté, où seul le Feu voit encore.
 */
/**
 * ═══ LE RÉGLAGE A ÉTÉ POUSSÉ UNE SECONDE FOIS, ET SUR MESURE (2026-08-26) ═══
 *
 * *« Il faut que la nouvelle lune soit vraiment très sombre, proche du noir »* — Alexis, après
 * le premier essai. MESURÉ dans le vrai jeu à ce réglage-là (avatar au torse crème, à 744
 * tuiles de tout Feu, jour 72 à minuit) : **(16, 16, 24)**. Sombre, mais on se voit encore.
 *
 * La cause est arithmétique et pas esthétique : à α = 0,94, six pour cent de la source passent
 * SANS ÊTRE MULTIPLIÉS (le `1−α` du mélange), donc un blanc crème ne peut pas descendre sous
 * ~15 quoi qu'on fasse à la teinte. On ferme donc l'opacité à 0,97 ET on descend la teinte —
 * les deux termes, parce qu'ils bornent chacun leur moitié du résultat.
 */
/**
 * Le voile d'une nuit SANS lune — presque noir, à peine bleu.
 *
 * ⚠ QUATRIÈME PASSE (2026-08-26, « encore plus sombre ») : 0x01020A → **0x000105**. C'est le
 * TROISIÈME et dernier terme du résultat, après le `1 − α` et le plancher — celui qui décide
 * de ce que le sol garde de sa propre couleur. Le rouge tombe à zéro : sous la nouvelle lune,
 * il ne reste plus rien de chaud dans ce qu'on foule, et c'est voulu — l'œil scotopique ne
 * voit pas le rouge.
 */
const NUIT_SANS_LUNE = 0x000105

/**
 * ═══ …ET UN PLANCHER, PARCE QU'UNE NUIT NOIRE N'EST PAS UNE NUIT (2026-08-26) ═══
 *
 * *« la nuit de nouvelle lune ne doit pas être noire #000 mais un bleu très foncé, un peu
 * gris »* — Alexis. Le voile seul ne peut pas y arriver, et la raison est dans le blend :
 * il MULTIPLIE. Un multiplicateur, quelle que soit sa teinte, rend zéro sur du zéro — il
 * ne peut que ramener l'image vers le noir, jamais poser une couleur. C'est même
 * exactement ce qu'on lui a demandé de faire ce matin.
 *
 * On ajoute donc une couche qui ne sait faire QUE poser : un plancher en **ADD**. Sur le
 * noir, il rend sa propre couleur ; sur une braise à (120, 90, 60), il ajoute une vingtaine
 * de niveaux et n'y change presque rien. Un blend NORMAL aurait au contraire tiré les hautes
 * lumières vers lui — c'est le travers du vieil air de zone, qui « relevait les noirs et
 * lavait la couleur » et qu'on a éteint sans lune pour cette raison même.
 *
 * ⚠ IL SUIT LA LUNE, comme tout le reste : son opacité EST `partSansLune`. Sous la pleine
 * lune il n'existe pas (la lune fait le bleu elle-même, par `NIGHT_COLOR`) ; il ne remplit
 * que ce que la lune ne donne pas.
 *
 * ═══ SECOND RÉGLAGE, À LA LIMITE DU PERCEPTIBLE (2026-08-26, même jour) ═══
 *
 * *« il faudrait que la nouvelle lune soit encore plus sombre, à la limite du perceptible »*
 * — Alexis, sur la première valeur (0x0E141F). MESURÉ en jeu à ce réglage-là, sol nu, jour 72
 * à minuit, à sept cents tuiles du premier feu : **rvb(20, 26, 35)**, luminance 25,4. Or de ces
 * trois nombres, le plancher en portait à lui seul (14, 20, 31) — **le reste du monde ne pesait
 * que (6, 6, 4)**. Ce n'était plus un plancher, c'était la couleur de la nuit.
 *
 * On le descend donc au TIERS, teinte tenue. Et le rapport bleu/rouge MONTE en descendant
 * (2,2 → 4,7) : à ces valeurs-là l'œil ne lit presque plus la saturation, si bien qu'un bleu
 * qui reste « à peine bleu » en nombres devient franchement gris à l'écran. Garder la teinte
 * VISIBLE en descendant demande de la forcer.
 */
export const NUIT_PLANCHER = 0x010208

/** Le plancher de l'image, pour la couche ADD du voile — noir tant qu'il reste de la lune. */
export function plancherDeNuit(amb: { alpha: number }, lueur: number): { color: number; alpha: number } {
  return { color: NUIT_PLANCHER, alpha: partSansLune(amb, lueur) }
}
/**
 * …et son opacité. Au-delà du plafond « tout juste lisible » (0,72) DÉLIBÉRÉMENT : c'est le
 * sujet. La clairière du Feu (`fireHoleRadius`, 6 tuiles) reste creusée — on n'est jamais
 * aveugle CHEZ SOI, seulement dehors, et c'est très exactement le rôle que le jeu lui promet.
 *
 * ═══ TROISIÈME RÉGLAGE : 0,97 → 0,995, ET C'EST L'AUTRE MOITIÉ DU RÉSULTAT ═══
 *
 * *« ce n'est toujours pas assez sombre »* — Alexis, une fois le plancher descendu au tiers.
 * Et il avait raison de le dire au plancher : à ce stade, ce n'était plus lui qui tenait
 * l'image. MESURÉ, sol nu au jour 72 à minuit, luminance 12,9, dont **5,2 de plancher** et
 * **7,7 de reste du monde**. Le coupable n'était donc plus la couche qu'on descendait.
 *
 * Ce « reste », c'est le `1 − α` du mélange : à 0,97, **trois pour cent de la source passent
 * SANS ÊTRE MULTIPLIÉS**. Sur une herbe à (140, 150, 110), ça fait déjà (4,2 · 4,5 · 3,3) que
 * ni la teinte du voile ni le plancher ne peuvent reprendre — un multiplicateur n'atteint que
 * ce qu'il multiplie. Fermer à **0,995** ramène ce passage à un demi pour cent.
 *
 * ⚠ ON NE VA PAS À 1. À opacité pleine, le sol vaudrait exactement `base × teinte`, donc une
 * image qui ne dépend plus QUE du terrain : le grain de la nuit disparaîtrait avec lui. Le
 * deux-millièmes qu'on laisse est ce qui garde une trace de ce qu'on foule.
 *
 * ═══ QUATRIÈME PASSE : 0,995 → 0,998, LES TROIS TERMES ENSEMBLE ═══
 *
 * *« encore plus sombre »*. À 0,995 le sol nu rendait 9,9 de luminance, et il ne restait plus
 * de gros terme à couper : les trois — le passage (`1 − α`), la teinte (`NUIT_SANS_LUNE`) et
 * le plancher — pesaient chacun quelques niveaux. On les descend donc tous les trois d'un
 * coup, ce qui est la seule façon d'aller plus bas sans en écraser un seul.
 */
export const VOILE_NOUVELLE_LUNE = 0.998

/**
 * LA PART DE NUIT QUE LA LUNE NE TIENT PAS — le `k` commun à TOUT ce qui suit la lune.
 *
 * Il est extrait parce que trois couches en dépendent (le voile du sol, l'ambiante des sprites
 * via `dynamic-lighting`, et l'air de la zone) : trois façons de le recalculer, ce serait trois
 * nuits différentes sur la même image — le défaut « deux chaînes d'éclairage qui ne sont pas à
 * la même heure » qu'on a déjà corrigé deux fois dans ce fichier.
 *
 * `partNuit` vaut 0 en plein jour (le voile ne pèse rien, la lune n'a rien à y ajouter) et 1 au
 * cœur de la nuit : sans lui, une nouvelle lune — qui transite à MIDI — assombrirait le plein
 * jour. Il borne aussi l'heure dorée, où le voile est ambre et n'a que 17 % de son poids.
 */
export function partSansLune(amb: { alpha: number }, lueur: number): number {
  const partNuit = Math.min(1, Math.max(0, amb.alpha / NIGHT_ALPHA_MAX))
  return (1 - Math.min(1, Math.max(0, lueur))) * partNuit // ce que la lune NE donne pas
}

/**
 * L'AIR D'UNE ZONE, SANS LUNE — parce qu'une brume qu'on VOIT est une brume ÉCLAIRÉE.
 *
 * L'air de zone (`zone-ambiance.ts`) passe en blend NORMAL PAR-DESSUS le voile : il porte donc
 * un terme ADDITIF que le multiply ne peut pas rattraper — c'est un PLANCHER. MESURÉ au jour 72
 * à minuit, une fois le voile et l'ambiante déjà au noir : le sol des Prés Bas restait à
 * **(20, 17, 13)**, dont (15, 14, 12) venaient du seul air (0xfff2d0 à 6 %). La brume était
 * devenue l'unique source de lumière de la nuit, et une source CHAUDE : elle relevait les noirs
 * et lavait la couleur, très exactement ce que le voile venait d'aller chercher.
 *
 * On éteint donc la TEINTE et non l'opacité, sur le même `k` que le reste. Ce choix a une
 * conséquence qu'une extinction de l'alpha aurait perdue : les zones dont l'air est DÉJÀ noir
 * (le Gouffre, 0x05060a) continuent d'assombrir autant qu'avant — leur nuit ne s'éclaircit pas
 * sous prétexte qu'il n'y a plus de lune. Un air éteint OCCULTE encore ; il ne brille plus.
 */
export function airSansLune(air: { color: number; alpha: number }, k: number): { color: number; alpha: number } {
  return { color: lerpColor(air.color, 0x000000, Math.min(1, Math.max(0, k))), alpha: air.alpha }
}

export function voileDeNuit(amb: { color: number; alpha: number }, lueur: number): { color: number; alpha: number } {
  const k = partSansLune(amb, lueur)
  return {
    color: lerpColor(amb.color, NUIT_SANS_LUNE, k),
    alpha: amb.alpha + (VOILE_NOUVELLE_LUNE - NIGHT_ALPHA_MAX) * k,
  }
}

/**
 * LE MULTIPLICATEUR QUE LE VOILE APPLIQUE VRAIMENT, rendu comme une couleur.
 *
 * `night-veil.ts` pose le voile en MULTIPLY : `sortie = source × ((1−α) + α·teinte)`. Ce
 * facteur-là — et pas le réglage écrit — est ce que l'œil voit, et c'est déjà sur LUI que les
 * gardes de `la nuit sans lune` jugent (elles l'appliquent à un gris moyen).
 *
 * Il est exporté parce que le voile ne couvre PAS tout : en rendu éclairé (le mode nominal),
 * il passe sous les sprites (`AMBIENT_DEPTH_LIT`) et n'assombrit que le fond. L'ambiante du
 * `LightsManager`, qui tient lieu de nuit aux sprites, DÉRIVE donc de ce nombre au lieu de
 * s'écrire à côté de lui (`dynamic-lighting.AMBIENT_SANS_LUNE`) — sans quoi les deux chaînes
 * cesseraient de parler de la même nuit à la première retouche du voile.
 */
export function multiplicateurDuVoile(v: { color: number; alpha: number }): number {
  let out = 0
  for (const d of [16, 8, 0]) {
    const canal = ((v.color >> d) & 0xff) / 255
    out |= Math.round(255 * (1 - v.alpha + v.alpha * canal)) << d
  }
  return out
}

interface DayKey {
  hour: number
  value: number
}
/** Facteur de lumière du jour : 0 = nuit noire … 1 = plein midi. */
const DAYLIGHT_KEYS: DayKey[] = [
  { hour: 0, value: 0 },
  { hour: 5, value: 0 },
  { hour: 6, value: 0.15 },
  { hour: 8, value: 0.7 },
  { hour: 10, value: 1 },
  { hour: 15, value: 1 },
  { hour: 18, value: 0.7 },
  { hour: 20, value: 0.2 },
  { hour: 21, value: 0.05 },
  { hour: 24, value: 0 },
]

export function daylight(hour: HeureSolaire): number {
  const { lo, hi, t } = bracket(DAYLIGHT_KEYS, hour)
  return lerp(lo.value, hi.value, t)
}

/**
 * LA BRUME DU MATIN (spec da-feeling R14) — un ÉVÉNEMENT de l'aube, pas un état.
 *
 * Elle se lève dans la nuit finissante (4h30), est pleine quand le jour point (6h), et le
 * soleil la dissout en pente CONTINUE jusqu'à 8h30 (règle maison « feel = pente continue » :
 * on interpole sur tout l'intervalle, bornes exactes, jamais un palier). Rend [0..1] — la
 * nappe (`world/morning-mist.ts`) y applique son plafond d'alpha. Fonction PURE de l'heure,
 * comme `daylight` : testable, et une seule vérité pour qui voudra s'y accorder (sons d'aube).
 */
const BRUME_KEYS: DayKey[] = [
  { hour: 0, value: 0 },
  { hour: 4.5, value: 0 },
  { hour: 5.5, value: 1 }, // elle se lève vite (l'air froid se condense d'un coup)
  { hour: 6.5, value: 1 }, // pleine à l'heure où le jour point
  { hour: 8.5, value: 0 }, // le soleil la mange, lentement
  { hour: 24, value: 0 },
]

export function brumeDuMatin(hour: HeureSolaire): number {
  const { lo, hi, t } = bracket(BRUME_KEYS, hour)
  return lerp(lo.value, hi.value, t)
}

/** Portée maximale de la marée de brume, en tuiles depuis l'eau. */
export const FRONT_BRUME_MAX_TILES = 9

/**
 * LA MARÉE DE L'AUBE (variante V1, choisie par Alexis le 2026-07-26) — le FRONT de brume,
 * en tuiles gagnées depuis l'eau : il monte de la berge vers l'intérieur des terres
 * (4h30 → 6h), reste étale (→ 6h48), puis le soleil le REPOUSSE vers l'eau (→ 8h30) —
 * l'ordre spatial de la dissolution est l'inverse de la naissance, les dernières flaques
 * flottent sur les mares. Fonction PURE de l'heure, pente continue, testée — le pendant
 * spatial de `brumeDuMatin` (qui reste l'enveloppe d'alpha) : les deux partagent la fenêtre,
 * la brume s'amincit donc en même temps qu'elle recule.
 */
const FRONT_KEYS: DayKey[] = [
  { hour: 0, value: 0 },
  { hour: 4.5, value: 0 },
  { hour: 6, value: 1 }, // la marée monte en 1h30 — on la VOIT venir
  { hour: 6.8, value: 1 }, // étale
  { hour: 8.5, value: 0 }, // le soleil la repousse, plus lentement qu'elle n'est montée
  { hour: 24, value: 0 },
]

export function frontDeBrume(hour: HeureSolaire): number {
  const { lo, hi, t } = bracket(FRONT_KEYS, hour)
  return FRONT_BRUME_MAX_TILES * lerp(lo.value, hi.value, t)
}

/**
 * ═══ LA BRUME DU MATIN EST CONDITIONNELLE (décision d'Alexis, 2026-08-25) ═══
 *
 * *« La condition d'apparition, c'est : il ne faut pas ou peu de vent, et il faut que la
 * température entre le jour et la nuit soit importante. »* C'est la brume de rayonnement, et
 * c'est exactement sa physique : la nuit claire rayonne, le sol se refroidit sous le point de
 * rosée, l'air se condense — mais il faut que l'air RESTE, or le vent le brasse et la dissout.
 *
 * Les deux termes existaient DÉJÀ dans le monde, on n'en invente aucun :
 *
 *   · L'ÉCART JOUR/NUIT est `TEMPERATURE.ECART_NUIT(jour, tour)` — la courbe annuelle de
 *     `saisons.md` S5, le nombre que le froid nocturne retranche. MESURÉ sur l'année : 6 °C au
 *     creux (jour 45), 14 °C au sommet (jour 105) ; sur LA SAISON JOUÉE (le monde ouvre au jour
 *     61, S2), il monte de 8,1 à 14 puis retombe à 12. La brume est donc une AFFAIRE D'ARRIÈRE-
 *     SAISON, et c'est ce que la courbe raconte d'elle-même.
 *   · LE CALME est `ventPartIci` — la part de souffle AU-DESSUS de l'ambiance, relue au point
 *     du JOUEUR (`ventForceAt`, spec `vent.md` V3), jamais le `windForce` du centre de la carte :
 *     la bande d'un front est spatiale, et une brume qui se disperserait parce qu'il souffle à
 *     trois cents tuiles de là serait un mensonge. Hors front, cette part vaut 0 au bit près ;
 *     sous une bande elle monte vers 1. **La sentinelle du calme plat (force 0) donne 0 aussi**
 *     — un monde sans vent est le monde le plus calme, pas le plus venté.
 *
 * DEUX RAMPES CONTINUES, jamais deux seuils (« feel = pente continue ») : la seconde EST la
 * dispersion. *« Si le vent gonfle d'un coup, on disperse proprement »* — il n'y a donc ni
 * minuterie ni front à guetter : la densité SUIT le souffle courant, et comme le souffle d'un
 * front arrive lui-même en rampe (`meteoIntensityAt`, bord → cœur) et PRÉCÈDE la pluie de
 * `VENT.AVANCE_TICKS`, la rampe du front EST la rampe de dispersion. Rien à piloter.
 */

/** L'écart jour/nuit sous lequel l'air ne se condense pas — la brume est absente, pas mince. */
export const BRUME_ECART_MUET = 8.5
/** …et celui à partir duquel la nuit rend toute sa brume. Entre les deux, une rampe : sur la
 *  saison jouée, ces deux bornes tombent vers les jours 65 et 80, si bien que l'arrière-saison
 *  se lève dans la brume et que l'ouverture des Pluies n'en a presque pas. */
export const BRUME_ECART_PLEIN = 11
/** La part de souffle (au-dessus de l'ambiance, au point du joueur) où la brume commence à se
 *  déchirer. Basse, DÉLIBÉRÉMENT : « il ne faut pas ou peu de vent » — le peu de vent porte la
 *  nappe (elle dérive), le vent qui gonfle l'emporte. */
export const BRUME_VENT_DECHIRE = 0.12
/** …et celle où il n'en reste rien. */
export const BRUME_VENT_DISPERSE = 0.45

function rampe(v: number, lo: number, hi: number): number {
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
}

/**
 * LA CONDITION DU MATIN, dans [0, 1] — le facteur que la nappe applique à son alpha FINAL.
 *
 * Fonction PURE de deux nombres, comme `daylight` et `frontDeBrume` à côté d'elle : elle ne
 * connaît ni `SimState` ni snapshot, donc elle se teste seule et l'appelant reste seul
 * responsable d'aller chercher l'écart du JOUR et le souffle d'ICI.
 */
export function partDeBrumeMatinale(ecartJourNuit: number, ventPart: number): number {
  const froidure = rampe(ecartJourNuit, BRUME_ECART_MUET, BRUME_ECART_PLEIN)
  const calme = 1 - rampe(ventPart, BRUME_VENT_DECHIRE, BRUME_VENT_DISPERSE)
  return froidure * calme
}

interface TintKey {
  hour: number
  color: number
  alpha: number
}

/**
 * Le bleu froid de la nuit — REHAUSSÉ de `0x0b1030` à `0x0b104e` le 2026-07-24, avec le passage
 * du voile de l'heure en `MULTIPLY` (cf. `night-veil.ts`).
 *
 * Ce n'est PAS un choix d'ambiance, c'est la conversion de l'ancien. En blend NORMAL, la moitié
 * de la froideur venait du terme ADDITIF (`teinte·α`) — le même terme qui relevait les noirs.
 * Le multiply le supprime : la couleur doit donc porter seule la teinte que le mélange offrait.
 *
 * Premier calcul : conserver le RAPPORT bleu/rouge du rendu précédent (1,61 sur un gris moyen)
 * → B = 78. Rendu, mesuré : INSUFFISANT. Un multiply conserve la teinte PROPRE de la surface,
 * donc un sol brun sous un multiplicateur à peine bleu reste brun — la nuit avait la lisibilité
 * qu'on cherchait mais elle avait perdu sa FROIDEUR, qui était portée par le terme additif.
 * On refroidit donc le multiplicateur lui-même : `M = (0,303 · 0,320 · 0,540)`, bleu 1,8× le
 * rouge. Le plancher de `M_r` est `1-α = 0,28` — aucune couleur ne refroidira davantage à cette
 * opacité, et monter l'opacité rendrait la nuit injouable. C'est le froid maximal disponible.
 *
 * À gris moyen le rendu passe de (44, 47, 70) à (39, 41, 69) — et surtout un noir qui redevient
 * NOIR au lieu de plafonner à (8, 11, 35).
 */
const NIGHT_COLOR = 0x080e5c // bleu froid
const GOLDEN_COLOR = 0xc8702a // ambre chaud (heure dorée)
const NEUTRAL_COLOR = 0x101018

/**
 * Keyframes de la teinte d'ambiance sur 24 h (bornes 0 h et 24 h identiques).
 *
 * EXPORTÉES le 2026-08-24 pour le ruban de l'heure de la barre haute : il compose ces mêmes
 * clefs sur un sol étalon pour montrer, heure par heure, la teinte que le monde PORTERA. Les
 * recopier là-bas aurait fait deux aubes — celle qu'on voit et celle qu'on lit.
 */
export const AMBIENT_KEYS: TintKey[] = [
  { hour: 0, color: NIGHT_COLOR, alpha: NIGHT_ALPHA_MAX },
  { hour: 5, color: NIGHT_COLOR, alpha: 0.62 },
  { hour: 6, color: GOLDEN_COLOR, alpha: 0.32 },
  { hour: 8, color: GOLDEN_COLOR, alpha: 0.1 },
  { hour: 10, color: NEUTRAL_COLOR, alpha: 0 },
  { hour: 15, color: NEUTRAL_COLOR, alpha: 0 },
  { hour: 18, color: GOLDEN_COLOR, alpha: 0.12 },
  { hour: 20, color: GOLDEN_COLOR, alpha: 0.34 },
  { hour: 21, color: NIGHT_COLOR, alpha: 0.6 },
  { hour: 24, color: NIGHT_COLOR, alpha: NIGHT_ALPHA_MAX },
]

export function ambientTint(hour: HeureSolaire): { color: number; alpha: number } {
  const { lo, hi, t } = bracket(AMBIENT_KEYS, hour)
  return { color: lerpColor(lo.color, hi.color, t), alpha: lerp(lo.alpha, hi.alpha, t) }
}

/**
 * Le scintillement d'une flamme : deux ondes incommensurables (√2 : leur rapport
 * est irrationnel, donc elles ne se rejoignent jamais) plus une troisième, rapide
 * et faible, pour le crépitement. Une seule sinusoïde donnerait un clignotant de
 * chantier — la flamme, elle, ne se répète pas.
 *
 * `seed` décale la phase par Feu : deux foyers voisins ne battent pas ensemble.
 */
export function flicker(timeMs: number, seed: number): number {
  const t = timeMs * 0.001 + seed
  const slow = Math.sin(t * 2.1)
  const fast = Math.sin(t * 3.7 * Math.SQRT2)
  const crackle = Math.sin(t * 11.3)
  return 1 + 0.09 * slow + 0.06 * fast + 0.025 * crackle
}

/**
 * ═══ LE BANC DES VARIANTES DE FEU (temporaire, 2026-08-26) ═══
 *
 * `flicker` ci-dessus est le battement ÉTALON, et il ne bouge pas : `torche.ts`, le trou du
 * voile et le reflet sur l'eau l'appellent, et il est sous test. Les propositions de rendu
 * passent donc par une fonction NEUVE, à laquelle on donne la variante en argument — un module
 * pur ne lit pas `window`, c'est l'appelant qui sait quelle variante il rend.
 *
 * VARIANTE 1 — LA RESPIRATION. Le battement étalon est une somme de sinusoïdes : il monte
 * exactement aussi vite qu'il descend, et c'est ce qui le fait entendre comme un RONFLEMENT
 * plutôt que comme un feu. Une flamme réelle est asymétrique — une reprise franche quand une
 * langue attrape de l'air, puis une longue retombée. On remplace donc la sinusoïde par une
 * somme d'IMPULSIONS : montée en 12 % du cycle, retombée cubique sur les 88 % restants, à deux
 * cadences incommensurables (√2) pour qu'elles ne se resynchronisent jamais.
 *
 * L'amplitude va de ~0,85 à ~1,37 (l'étalon : 0,83 à 1,18) et elle ne part QUE dans l'alpha —
 * jamais dans un rayon. C'est écrit noir sur blanc dans `fire-ground-glow` (« le vacillement
 * passe par l'ALPHA, jamais par la taille ») et dans `fireHoleRadius` (un trou qui respire de
 * ±2 tuiles efface la nuit) : une variante qui ferait respirer la géométrie rendrait le grain
 * grouillant et la clairière élastique — elle paraîtrait PIRE, et pour une raison qui n'a rien
 * à voir avec la question posée.
 */
/** Une impulsion sur une phase 0..1 : montée franche, retombée longue. Moyenne ≈ 0,28. */
function impulsion(phase: number): number {
  const ph = phase - Math.floor(phase)
  const MONTEE = 0.12
  if (ph < MONTEE) {
    const x = ph / MONTEE
    return x * x * (3 - 2 * x)
  }
  const y = (ph - MONTEE) / (1 - MONTEE)
  const r = 1 - y
  return r * r * r
}

/** Moyenne de `impulsion` sur un cycle — le socle qui ramène le battement autour de 1. */
const IMPULSION_MOY = 0.28
const RESPIRE_FORT = 0.34
const RESPIRE_FAIBLE = 0.18

/**
 * Le battement d'une flamme. `respire === false` rend, au bit près, le `flicker` étalon —
 * c'est le rendu d'avant, et l'étalon de comparaison de la planche.
 *
 * ⚠ IL PREND UN BOOLÉEN, PAS UN NUMÉRO DE VARIANTE. Il en prenait un, et c'était une erreur
 * de forme : dès que « tout » a existé, `variante !== 1` a cessé de vouloir dire « pas de
 * respiration » — le rendu livré porte le numéro 6 et respire. Un module pur ne doit pas avoir
 * à connaître la table des variantes ; il reçoit ce qu'on lui demande de faire.
 */
export function flickerV(timeMs: number, seed: number, respire: boolean): number {
  if (!respire) return flicker(timeMs, seed)
  const t = timeMs * 0.001 + seed
  const socle = 1 - IMPULSION_MOY * (RESPIRE_FORT + RESPIRE_FAIBLE)
  return (
    socle +
    RESPIRE_FORT * impulsion(t * 0.55) +
    RESPIRE_FAIBLE * impulsion(t * 0.83 * Math.SQRT2 + 0.37) +
    0.03 * Math.sin(t * 13.1)
  )
}

/**
 * Halo d'un Feu : couleur d'alignement, plus fort la nuit (∝ 1 - day) et pour un
 * village plus engagé (∝ |warmth|). `radius` en tuiles, `alpha` pour blend ADD.
 *
 * `timeMs`/`seed` font PALPITER le halo. Sans eux, la fonction est pure de
 * l'heure — et un feu parfaitement immobile est la chose la plus morte du monde.
 */
export function fireGlow(
  warmth: number,
  day: number,
  timeMs = 0,
  seed = 0,
  /** Le battement asymétrique est-il allumé ? (`axesFeu().respiration`). `false` = l'étalon,
   *  au bit près — les tests et les appelants qui ne s'en soucient pas l'omettent. */
  respire = false,
): { color: number; radius: number; alpha: number; beat: number } {
  const engage = Math.min(1, Math.abs(warmth) / 100)
  const dark = 1 - day
  // DEUX BATTEMENTS, et c'est délibéré : l'ALPHA prend celui de la variante (il peut plonger
  // et flamber sans rien casser), le RAYON garde l'étalon. Une géométrie qui respire fort fait
  // grouiller le grain de la flaque et rend la clairière élastique — les deux défauts sont déjà
  // documentés (`fire-ground-glow`, `fireHoleRadius`), et ils ne sont pas la question posée.
  const beat = flickerV(timeMs, seed, respire)
  const beatGeo = flicker(timeMs, seed)
  const alpha = Math.min(GLOW_MAX_ALPHA, GLOW_MAX_ALPHA * dark * (0.6 + 0.4 * engage) * beat)
  const radius = (GLOW_MIN_RADIUS_TILES + GLOW_SPAN_TILES * engage) * beatGeo
  return { color: warmthColor(warmth), radius, alpha, beat }
}

/**
 * LA CLAIRIÈRE — la portée, en tuiles, du trou que le Feu creuse dans le voile de nuit.
 *
 * ═══ POURQUOI CE N'EST PAS `fireGlow.radius` ═══
 *
 * Ça l'était, et c'était le défaut. `fireGlow.radius` va de 3 à 8 tuiles avec l'engagement du
 * village : c'est le rayon d'un halo COSMÉTIQUE, calibré pour une lueur qu'on additionne. Le
 * trou du voile, lui, ne colore rien — il RETIRE de la nuit. Le faire monter sur ce rayon-là
 * donnait, MESURÉ à minuit sur un Feu à warmth 100, un sol relevé de (17,15,18) à (30,23,24)
 * à VINGT-CINQ tuiles du foyer, et jusque dans les coins de l'écran : la nuit disparaissait de
 * la vallée dès qu'un village s'engageait.
 *
 * D'où la décision d'Alexis (2026-08-03, `docs/decisions.md`) : **portée CONSTANTE — l'engagement
 * se lit à la flamme**, où il se lit déjà (le sprite du Feu est teinté par `warmthColor` : bleu
 * Foyer, rouge Meute). Cette fonction ne prend donc PAS `warmth` en argument, et c'est le fond
 * de l'affaire : ce qui n'est pas paramétrable ne peut pas se recoupler par distraction.
 *
 * Elle PULSE, en revanche — même `flicker`, même graine que le halo et la flaque : les trois
 * battent en phase avec la flamme, sinon la clairière respirerait à contretemps du feu qui la
 * creuse. L'appelant module encore par l'ÉTAT du foyer (braises, éteint).
 */
const HOLE_RADIUS_TILES = 6

export function fireHoleRadius(timeMs = 0, seed = 0): number {
  return HOLE_RADIUS_TILES * flicker(timeMs, seed)
}
