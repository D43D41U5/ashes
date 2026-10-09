/**
 * ═══ LA NUIT — LE CADRAN DE LA LUNE, ET LA CLARTÉ SUR SOI ═══
 *
 * Jusqu'ici la lune était un fait de RENDU : `client/render/lighting.ts` en tirait le voile,
 * et `/sim` ne savait pas qu'elle existait. Le monde était donc aussi dangereux sous la pleine
 * lune que sous la neuve — alors que le joueur, lui, VOIT la différence à l'écran. Un cadran
 * qu'on regarde et qui ne commande rien est un décor ; celui-ci commande, maintenant.
 *
 * Ce module ne fait qu'une chose : dire **combien il fait clair, ici, à ce tick**. Les règles
 * qui s'en servent vivent ailleurs (le corps dans `sim.ts`, la chasse dans `nighthunt.ts`) —
 * lui ne juge de rien.
 *
 * ═══ TROIS SOURCES, UNE SEULE LECTURE ═══
 *
 * La clarté sur soi est le MAX de trois choses, et jamais leur somme (deux torches n'éclairent
 * pas deux fois) :
 *   · **le ciel** — le jour à plein, la nuit ce que la lune en laisse ;
 *   · **le feu** — sa bulle, celle-là même qui réchauffe (`bulleDuFeu`, rayon `T.FIRE_RANGE`,
 *     depuis le centre de sa tuile) : ce qui chauffe éclaire, un seul rayon à calibrer, et il
 *     vaut déjà 6 tuiles côté client (la clairière d'un Feu) — × LA PART VISIBLE de sa source :
 *     **la sim apprend l'ombre** (spec `lumiere-globale.md`, LG-R11, LG-R12 ; `lumiere.ts`).
 *     Derrière un mur, en nuit aveugle, on ne pare plus ;
 *   · **la torche en main** — à bout de bras, donc à plein sur son porteur ; et **les torches
 *     des autres avatars** (LG-R18), à la portée de l'écran, comme un feu qu'on porte ;
 *   · **la braise qu'on PORTE** (B-R13c, étape 7, 2026-10-05) — un cône dont la CHARGE est le
 *     sommet et le rayon (`bulleDeBraise`), donc une source qui s'éteint en se vidant : la
 *     barre de crans est aussi une barre de vision. Et la braise des autres, au même titre.
 *     ⚠ C'est elle qui a fait tomber le `if (torche) return 1` qui ouvrait `clarteSurSoiAt` :
 *     une EXCEPTION ne peut pas coexister avec un profil, sinon la torche gardait un privilège
 *     que la braise n'a pas. Le remplacement est inerte au bit pour la torche — tout profil
 *     linéaire vaut 1 au contact.
 *
 * ⚠ CE N'EST PAS UN WARD (bible `I3`, et les trois interdits de `torche.md`). La torche ne
 * repousse RIEN et ne chauffe RIEN : les monstres se comportent à l'identique qu'on la porte
 * ou non. Ce que le noir prend, c'est une capacité de BASE du corps ; la lumière la rend. Le
 * jour, la pleine lune et le coin du feu sont au même niveau — c'est le noir qui est l'écart.
 *
 * ═══ PUR, ET SANS UNE FONCTION MATH APPROXIMÉE (invariant §2) ═══
 *
 * `Math.cos` est interdit ici. La part éclairée du disque — la vraie formule est
 * `(1 − cos 2πφ) / 2` — est donc TABULÉE sur une demi-lunaison et interpolée linéairement,
 * le patron des `COS_*` de `balance.ts`. Écart maximal mesuré contre le cosinus exact :
 * **0,0042** (0,42 %), atteint au voisinage de la pleine lune — et les deux bouts qui portent
 * le sens du cadran sont EXACTS : 0 à la nouvelle lune, 1 à la pleine.
 *
 * ⚠ IL Y A DONC DEUX COURBES, ET C'EST DÉLIBÉRÉ : le client garde son cosinus EXACT pour
 * PEINDRE (`render/lighting.ts`) — on ne glisse pas une approximation sous un voile de nuit
 * calibré à l'œil la veille. Ce qu'il importe d'ici, ce sont la PÉRIODE, l'ANCRAGE et la
 * PHASE : deux ancrages qui dériveraient feraient mordre la règle sur une lune peinte pleine.
 *
 * Ce qui tient les deux courbes ensemble n'est pas leur égalité, c'est un ORDRE, et il a été
 * mesuré heure par heure : **la règle est toujours la plus GÉNÉREUSE des deux.** Elle ignore
 * l'altitude de l'astre (une lune couchée éclaire quand même, pour elle), donc
 * `clarté_sim ≥ lueur_écran` à toute heure — **le noir ne mord jamais sur un écran clair.**
 * C'est CET invariant qu'un changement de l'une ou l'autre courbe doit préserver ; leur écart
 * numérique (0,0042 au pire) n'en est qu'une conséquence.
 */
import { LUMIERE, TEMPERATURE } from './balance'
import { bulleDuFeu, isSheltered } from './temperature'
import { estFoyer } from './pieces'
import { auMemeEtage, connecteurAt, marchableAEtage, niveauDeLaTuile, niveauDuCorps, palierDuSol } from './etages'
import { heldSlot } from './inventory-actions'
import { lumiereDesBraises, lumiereDesTorches, partVisible } from './lumiere'
import { bulleDeBraise, type Braise } from './braise'
import { estTorcheVive } from './torche'
import { dayTicksAt, gameTimeAt, NIGHT_RAMP_TICKS, partDeNuit, TICKS_PER_CYCLE } from './time'
import type { Entity, SimState } from './sim'

/**
 * LA LUNAISON SE COMPTE EN JOURS DE SAISON — 23, un nombre PREMIER (choix d'Alexis,
 * 2026-08-25), donc premier avec la saison comme avec l'année : la pleine lune glisse de sept
 * jours par saison et le calendrier ne se resynchronise avec elle qu'au bout de 690 jours.
 */
export const LUNAISON_JOURS = 23

/**
 * Le jour de saison où la lune est PLEINE — et c'est LE JOUR D'OUVERTURE du monde
 * (`saisons.md` S2, `BALANCE.JOUR_DE_DEPART`). L'ancrage est un choix, pas une dérivation :
 * la première nuit est la plus clémente des vingt-trois, et le noir n'arrive qu'une fois
 * qu'on est installé — vers le jour 72.
 */
export const LUNE_PLEINE_JOUR = 61

/**
 * La part éclairée du disque, tabulée sur une DEMI-lunaison (la courbe est symétrique autour
 * de la pleine lune) : 13 nombres au lieu de 25, et la symétrie devient une propriété de la
 * lecture au lieu d'un vœu.
 */
const CLARTE_DEMI: readonly number[] = [
  0, 0.017037, 0.066987, 0.146447, 0.25, 0.37059, 0.5, 0.62941, 0.75, 0.853553, 0.933013,
  0.982963, 1,
]

/** Le nombre d'intervalles de la lunaison ENTIÈRE dans la table (le double de sa demie). */
const PAS_TABLE = (CLARTE_DEMI.length - 1) * 2

/**
 * La phase, dans [0, 1) : 0 = nouvelle lune, ½ = pleine lune. `jour` porte ses décimales
 * (`seasonDay + jourFrac`) pour que la lune COULE au lieu de sauter une fois par jour.
 * Exacte — que des `+ − × ÷` et un modulo.
 */
export function phaseDeLune(jour: number): number {
  const t = (jour - LUNE_PLEINE_JOUR) / LUNAISON_JOURS + 0.5 // +½ : l'ancrage est la PLEINE lune
  return ((t % 1) + 1) % 1
}

/** La part du disque éclairée, dans [0, 1] — 0 à la nouvelle lune, 1 à la pleine. */
export function clarteDeLune(jour: number): number {
  let p = phaseDeLune(jour)
  if (p > 0.5) p = 1 - p // la symétrie, lue plutôt que tabulée deux fois
  const x = p * PAS_TABLE
  const i = Math.floor(x)
  const a = CLARTE_DEMI[i] ?? 1
  const b = CLARTE_DEMI[i + 1] ?? a
  return a + (b - a) * (x - i)
}

/**
 * LA NUIT POUR L'ŒIL — la rampe de `partDeNuit`, dont CHAQUE LISIÈRE est décalée séparément.
 *
 * `partDeNuit` est la rampe du FROID : elle vaut 1 à l'aube pile et ne relâche qu'ensuite,
 * parce que le fond du froid est à l'aube (c'est écrit dans `time.ts`, et c'est juste). La
 * LUMIÈRE, elle, est SYMÉTRIQUE autour de l'horizon : le ciel pâlit AVANT que le soleil ne
 * perce, et il reste clair APRÈS qu'il s'est couché. Un seul réglage (`NIGHT_RAMP_HOURS`), deux
 * lectures, et pas une seconde courbe à calibrer — l'intention d'origine, tenue.
 *
 * ⚠ CE DÉCALAGE N'EST PAS COSMÉTIQUE, il a été MESURÉ contre l'écran (le voile du client,
 * `render/lighting.ts`, nuit du jour 72) : sans lui, à 6 h — l'heure de l'aube —, la règle
 * lisait **0,009** (nuit noire) quand l'écran, lui, était déjà à **0,556** (une aube claire).
 * Une heure entière où le jeu aurait refusé de courir à un joueur qui VOIT le jour se lever.
 * Avec, la sim rend 0,505 contre 0,556 à l'écran. **Ce gain-là est intact.**
 *
 * ⚠ **MAIS LA PHRASE QUI SUIVAIT ÉTAIT FAUSSE, ET ELLE A COÛTÉ UN CRÉPUSCULE** (corrigé le
 * 2026-10-09). Elle disait « les vingt-trois autres heures ne bougent pas d'un cheveu ». La
 * forme d'alors translatait le `cycleTick`, donc avançait les DEUX lisières : au jour 75 la nuit
 * PLEINE tombait à **18,18 h pour un coucher à 18,93 h — 45 min trop tôt** —, et la fenêtre
 * 17,0 → 18,93 h portait l'écart. ⚠ **ET SON AMPLITUDE, J'AVAIS ÉCRIT « +0,5000, le maximum que
 * cette rampe puisse porter » — DEUX FOIS FAUX** : 0,5000 est l'écart AU COUCHER PILE, pas le pire,
 * et le maximum d'une rampe bornée à [0, 1] est 1. MESURÉ par l'audit : le pire écart de `nuit`
 * vaut **1,0000 à 18,177 h** (la nuit pleine d'un côté, le plein jour de l'autre), celui de
 * `clarteDuCiel` **0,8838** dans la fenêtre du jour 75 et jusqu'à **0,9913** sur l'année — c'est la
 * lune qui borne le second, pas la rampe. *Un extremum annoncé se mesure sur le balayage, pas sur
 * le point qu'on avait sous la main.*
 *
 * ⚠⚠ **ET L'IMAGE QUE JE DONNAIS EN PREUVE N'EST PAS DE CETTE CHAÎNE : J'AVAIS ATTRIBUÉ À R5 UN
 * LOOK QU'IL NE TOUCHE PAS** (relevé par `determinisme-sim`, audit de fusion du 2026-10-09). Les
 * **4,2/255** de `futaie-couchant` à 18,3 h (contre 59,8 à midi) sortent de
 * `voileDeNuit(ambientTint(heureSolaire(…)), lueurDeLune(…))` — des fonctions **purement CLIENT**,
 * de l'heure solaire et de la lune, dont **aucune ne lit `clarteDuCiel` ni `nuitPourLOeil`**. Tous
 * les consommateurs du champ `ciel` du client sont la chaîne **SOUTERRAINE** (nappe de cave,
 * lumière de gueule, étages), derrière la porte `if (souterrain || etages.lumiere === null)`.
 * **Donc corriger la lisière ne rendra pas un lumen à `futaie-couchant`** : cette image reste à
 * réparer ailleurs, et elle n'est pas une justification de R5. *Une image n'est une preuve que
 * pour la chaîne qui l'a produite.*
 *
 * **CE QUE R5 CHANGE VRAIMENT, MESURÉ.** `clarteDuCiel` nourrit `clarteSurSoiAt`, qui commande
 * **la PARADE** (`sim.ts:1052`, et `sim.ts:914` pour la vitesse du corps qui pare) sous
 * `NUIT.SEUIL_NOIR` ; à l'écran, la chaîne souterraine et le plancher porté de B-R13d. MESURÉ à
 * découvert, braise vide, jour 75 : le refus de parer tombait 64 min AVANT le coucher (17,865 h),
 * il tombe 26 min APRÈS (19,366 h) — **90 min de parade par soirée**, exactement la rampe
 * (2 250 ticks au tick près). ⚠ Et au jour 105 il n'arrive JAMAIS : la lune y laisse 0,074 de
 * diviseur, donc le ciel ne descend pas sous 0,926 — la porte ne se ferme pas, et R5 n'y déplace
 * rien.
 *
 * ⚠ **DEUX AUTRES CONSOMMATEURS QUE J'AVAIS ÉCRITS FAUX ICI MÊME.**
 *   · « l'éveil des Cendreux » — faux, hérité d'une vieille fiche : `eveilCendreuxAt` vient de
 *     `temperature.ts`, l'éveil est **thermique** et ne lit aucune clarté.
 *   · « **et le SPRINT** (`sim.ts:910`) », **et la conséquence était INVERSÉE**. `sim.ts:910` pose
 *     bien `voitClair`, mais son seul lecteur est `blocking` : `canSprint = tier === 'light' ||
 *     tier === 'medium'` ne porte aucun terme de clarté depuis que les jambes sont sorties de la
 *     règle du noir (2026-09-02, trois lignes au-dessus dans `sim.ts`). Et pire — `if (blocking)
 *     scale *= BLOCK_MOVE_FACTOR; else if (sprinting) …` : la parade **EXCLUT** le sprint. Donc
 *     pour un corps qui tient sa garde, les 90 min rendues sont 90 min où il marche à ×0,3 au lieu
 *     de courir à ×1,5 — **le mouvement y PERD, par ricochet** (MESURÉ : `gait` passe de `sprint` à
 *     `walk` sur 1 887 ticks, `scale` 1,46670 → 0,29334). Les deux énoncés sont corrigés, non rayés.
 */
function nuitPourLOeil(state: SimState, tick: number): number {
  const cycleTick = (tick + state.cycleOffset) % TICKS_PER_CYCLE
  const decale = (cycleTick + NIGHT_RAMP_TICKS / 2) % TICKS_PER_CYCLE
  // ⚠ **ET LE JOUR EST ALLONGÉ D'UNE RAMPE ENTIÈRE POUR L'ŒIL** (2026-10-09). La translation
  // seule avançait les DEUX lisières : avec elle, la nuit PLEINE tombait 45 min AVANT le coucher
  // du soleil. Allonger `dayTicks` de `NIGHT_RAMP_TICKS` rend au crépuscule les 45 min que la
  // translation lui avait prises, SANS toucher l'aube — la translation garde son gain, et le
  // terme du crépuscule comme la borne de nuit pleine reculent tous deux d'une demi-rampe.
  //
  // ⚠ Et ce n'est PAS « +R/2 » : la translation a déjà mangé R/2 du côté du crépuscule, il faut
  // donc R pour le ramener d'une demi-rampe APRÈS le coucher. Au jour 75 : 0,5 pile au coucher,
  // nuit pleine 45 min plus tard. Les deux lisières deviennent symétriques autour de l'horizon,
  // ce qu'elles n'avaient jamais été.
  return partDeNuit(decale, dayTicksAt(state, tick) + NIGHT_RAMP_TICKS)
}

/**
 * LA CLARTÉ DU CIEL À UN TICK — 1 en plein jour, `clarteDeLune` au cœur de la nuit, et la
 * pente du crépuscule entre les deux.
 *
 * Elle se lit sur une RAMPE et NON sur `isNight` : le noir doit TOMBER, pas claquer. Un
 * joueur surpris par un mur à la seconde près n'a rien vu venir — « annoncés, pas surprises »
 * (GDD §9bis) —, alors qu'une pente lui laisse le crépuscule entier pour rentrer ou allumer.
 */
export function clarteDuCiel(state: SimState, tick: number = state.tick): number {
  const t = gameTimeAt(state, tick)
  const lune = clarteDeLune(t.seasonDay + t.jourFrac)
  return 1 - nuitPourLOeil(state, tick) * (1 - lune)
}

/**
 * LA CLARTÉ DU **SOLEIL** SEUL — `clarteDuCiel` dont on a retiré la lune (décision d'Alexis du
 * 2026-10-08, `braise.md` § 5.28 issue ⓒ).
 *
 * ⚠ ELLE N'EST PAS UNE SECONDE NOTION DE CIEL, et ce n'est pas elle qui dit ce qu'on VOIT :
 * `clarteDuCiel` reste l'autorité de la vision (la parade, le voile, la gueule des caves), et la
 * pleine lune y compte à juste titre — on voit, la nuit, sous une pleine lune. Celle-ci sert à
 * UNE seule question : *une lumière qu'on PORTE a-t-elle encore quelque chose à ajouter ?*
 *
 * **Pourquoi la lune n'a pas sa place dans cette réponse, et c'est MESURÉ.** Le plancher de
 * B-R13d (« un porteur est éclairé par sa braise ») est gaté par `soi − clarteDuCiel ×
 * partDuCiel`, dérivé du `max` de `clarteSurSoi` — une dérivation juste, qui a rendu le plancher
 * correct sous un toit à midi. Mais ce `max` additionne le soleil ET la lune, si bien que la
 * porte se lisait, à découvert, sur la LUNE seule : `clarteDuCiel` à minuit vaut **0,9997** au
 * jour 61 (pleine lune) contre **0,0086** au jour 72 (nouvelle). Le plancher ne rendait donc
 * rien **13 nuits sur 30**, et la plainte qui l'a fait naître — *« le personnage est sombre comme
 * s'il n'était pas éclairé »* — revenait la moitié du mois, PAR LA LOI. La raison du fossé est
 * le résidu des deux notions de ciel déjà noté en B-R13d : la sim déclare le ciel plein sous la
 * pleine lune, alors que l'ÉCRAN d'une nuit de pleine lune est très loin d'un midi — le pixel du
 * corps y reste sombre là où la porte le croyait déjà éclairé. MESURÉ EN PAGE le 2026-10-08
 * (`da-rendu`, chaîne PAR DÉFAUT relue sur les objets, jamais `gi=0` ; graine 2026, jour 61,
 * minuit reposé avant chaque image, ABBA, 288 px de silhouette) : le corps passe de **44,06 à
 * 113,61** de luminance, ΔL **+70,00** pour un bruit de 1,0 à 1,9 — **36 fois le bruit** —, teinte
 * 54°, l'ordre de canaux de `TEINTE_FEU`, et le SOL ne bouge pas (tous les anneaux sous le bruit,
 * `soiParCorps` n'ayant qu'un lecteur de production). ⚠ Et l'ancienne porte ne rendait pas
 * EXACTEMENT rien : `soi` y valait **0,0016 à 0,0035**, soit 0,2 à 0,4 % du plancher livré — donc
 * remettre `clarteDuCiel` ici n'est **pas** le « fil coupé », et qui veut rejouer le régime d'avant
 * par ce levier mesure autre chose. L'inertie de midi, elle, est prouvée sur l'ÉTAT et non sur le
 * pixel : les deux portes se ferment, le sac GPU vaut 0,000000 au bit, donc il n'y a pas deux
 * rendus à comparer à midi — il y en a un seul (contrôle de sensibilité : forcer le plancher là
 * met le corps à +42,39 ΔL, 25 fois le bruit, donc la sonde verrait une vraie régression).
 *
 * **Ce que la forme conserve, et c'est tout l'intérêt** : à midi, à découvert, elle vaut 1 comme
 * `clarteDuCiel`, donc le plancher reste **inerte** là où `partsDuCorps` sature (le modelé du
 * soleil ne s'efface pas) ; sous un toit ou dans une cave, `partDuCiel` vaut 0 et le plancher
 * porte en entier. Seules les nuits CLAIRES changent, et le plancher y reste borné par `soi` —
 * l'écran ne passe donc jamais devant l'autorité (N2bis, LG-R13).
 */
export function clarteDuSoleil(state: SimState, tick: number = state.tick): number {
  return 1 - nuitPourLOeil(state, tick)
}

/**
 * LA LUMIÈRE D'UN FEU, dans [0, 1] — sa bulle de chaleur, relue en lumière, × LA PART VISIBLE
 * de sa source étendue (spec `lumiere-globale.md`, LG-R11 et LG-R12 : la sim apprend l'ombre).
 * Un feu éteint n'éclaire pas, des braises éclairent atténué : `bulleDuFeu` porte cette loi
 * (facteur d'état × décroissance linéaire jusqu'à `TEMPERATURE.FIRE_RANGE`, depuis le CENTRE de la
 * tuile — LG-R17), et son rayon de 6 tuiles est celui de la clairière du client. Ce qui chauffe
 * éclaire, au même rayon ; mais la lumière demande en plus une ligne de vue : derrière un mur,
 * dans l'axe d'un fût ou d'une roche, elle s'arrête — la pénombre étant celle de la GI, seize
 * rayons vers un disque de 1,5 texel (`lumiere.ts`). La chaleur, elle, ne change pas. Un feu d'un
 * autre palier compte (LG-R14) : c'est la marche, jugée en hauteur, qui dit s'il descend jusqu'ici.
 */
export function lumiereDuFeu(state: SimState, x: number, y: number, etage?: number): number {
  const niveau = etage ?? palierDuSol(state.map, Math.floor(x), Math.floor(y))
  let best = 0
  for (const s of state.structures) {
    // Le FEU et la BALISE (B-R10 : elle hérite de la lumière comme du reste — un phare qu'on
    // monte d'un étage doit se voir de l'étage du dessous).
    if (!estFoyer(s.type) || !auMemeEtage(s, etage)) continue
    const bulle = bulleDuFeu(state, s, x, y)
    if (bulle <= best) continue // ne peut plus faire mieux, même vue en entier
    const v = bulle * partVisible(state, niveau, x, y, s.tx + 0.5, s.ty + 0.5, niveauDeLaTuile(state.map, s))
    if (v > best) best = v
  }
  return best
}

/**
 * LA SOURCE D'UNE PORTE, vue de la salle (LG-R20) : le disque de `partVisible` (rayon
 * `SOURCE_RAYON_TEXELS`) posé CONTRE LA FENTE, du côté de la salle — tangent au bord de la tuile de
 * la porte qui touche la salle, entièrement dans la première rangée. Au centre de la tuile, le disque
 * serait à mi-épaisseur de la paroi, et la roche de part et d'autre de la gueule mangerait les rayons
 * rasants : une salle ouverte ne rendrait plus ses anneaux. Le côté de la salle, c'est le voisin
 * marchable à l'étage qui n'est pas lui-même une porte ; sans voisin, le centre de la tuile.
 */
function sourceDUnePorte(map: SimState['map'], etage: number, cx: number, cy: number): readonly [number, number] {
  const r = LUMIERE.SOURCE_RAYON_TEXELS / LUMIERE.TEXELS_PAR_TUILE
  for (const [dx, dy] of COTES_DE_PORTE) {
    const vx = cx + dx
    const vy = cy + dy
    if (marchableAEtage(map, etage, vx, vy) && connecteurAt(map, vx, vy) === undefined) return [cx + 0.5 + dx * (0.5 + r), cy + 0.5 + dy * (0.5 + r)]
  }
  return [cx + 0.5, cy + 0.5]
}
/** Nord, sud, ouest, est — la gueule d'une mesa ouvre au nord (la salle est sous le chapeau), les autres portes diront la leur. */
const COTES_DE_PORTE: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0]]

/**
 * ═══ E-R13 — LA PART DU CIEL QUI ATTEINT CE POINT, dans [0, 1] ═══
 *
 * *Décision d'Alexis du 2026-09-02 (`etages.md` §10, branche **B1**).* C'est LA loi que ce choix
 * engage, et le préalable de tout ce qui est souterrain : ni cave, ni galerie, ni gueule de
 * grotte ne se bâtit avant elle.
 *
 * **1 à l'air libre** — donc partout dans le jeu d'aujourd'hui, et le monde d'avant est inchangé
 * au bit près. Sous un couvert, elle DÉCROÎT avec la distance à la première tuile ouverte : à la
 * gueule on y voit presque comme dehors, quatre tuiles plus loin il fait noir à midi.
 *
 * ⚠ **UNE DISTANCE, PAS UN BOOLÉEN — et c'est tout B1.** `isSheltered` répond oui/non (il a été
 * écrit pour le FROID, où c'est la bonne question : on est à l'abri ou on ne l'est pas). La
 * lumière, elle, n'a jamais de front : *la profondeur se gagne*. Un couvert binaire donnerait un
 * mur noir dès le pas de la porte — exactement la branche B3, qu'Alexis a écartée.
 *
 * ⚠ **ELLE NE CONNAÎT NI LE SOLEIL NI L'HEURE**, et c'est ce qui la rend composable : elle dit
 * quelle PART du ciel arrive, `clarteDuCiel` dit ce que le ciel vaut à cette heure-là. La nuit,
 * une gueule est noire sans qu'on ait à l'écrire — le produit s'en charge.
 *
 * ⚠ **CHEBYSHEV, pas la distance euclidienne** : on cherche le premier anneau ouvert autour du
 * point, et un anneau de Chebyshev est un carré — c'est la forme que le balayage parcourt, donc
 * la seule qui ne mente pas sur ce qu'il a vu. Et le balayage est BORNÉ par `TEMPERATURE.CIEL_PENETRATION` :
 * au-delà, il fait noir, il n'y a plus rien à mesurer.
 *
 * COÛT : sortie immédiate à l'air libre (un `isSheltered`, ce que l'appelant paierait de toute
 * façon). Sous un couvert seulement, jusqu'à `(2·P+1)²` sondes — 81 à P = 4 — et un intérieur est
 * par nature petit. Aucun appelant par PNJ ni par monstre : le même périmètre que `clarteSurSoi`.
 */
export function partDuCiel(state: SimState, tx: number, ty: number, etage?: number): number {
  const P = TEMPERATURE.CIEL_PENETRATION
  // ═══ UN ÉTAGE SOUS LA ROCHE : LE JOUR N'ENTRE QUE PAR LA GUEULE ═══
  //
  // C'est la MÊME loi, lue sur l'autre ouverture. Au-dessus du sol on cherche la première tuile
  // que rien ne couvre ; sous la roche il n'y en a aucune — ce qui ouvre, c'est le connecteur.
  // *La profondeur se gagne*, ici littéralement : quatre tuiles après le seuil, il fait noir, et
  // c'est ce qui fait de la torche un outil au lieu d'un décor.
  //
  // ⚠ **UN ÉTAGE AU-DESSUS DU SOL REÇOIT LE CIEL ENTIER** : un dessus de mesa est à l'air libre,
  // rien ne le couvre. Sans cette ligne, `isSheltered` — qui ne lit que le sol — répondrait
  // pour le sol SOUS le plateau, c'est-à-dire pour une autre tuile que celle où l'on se tient.
  //
  // ⚠ « AU-DESSUS » ET « SOUS » SE COMPTENT DEPUIS LE PALIER DU SOL (spec `terrasses.md` T-R2),
  // pas depuis 0 : la cave d'une mesa posée au palier 2 vit au niveau 1, sous deux crans de
  // roche — et le niveau 1 est le sol, à l'air libre, une terrasse plus loin.
  const sol = palierDuSol(state.map, tx, ty)
  if (etage === undefined) etage = sol
  if (etage > sol) return 1
  if (etage < sol) {
    // ═══ LE JOUR D'UNE GUEULE APPREND L'OMBRE — comme le feu (LG-R20, LG-R11) ═══
    //
    // *Décision d'Alexis du 2026-09-19 (spec `lumiere-globale.md` LG-Q2, planche 28 : « Oui, comme
    // le feu »).* La loi garde ses anneaux et sa portée ; chaque ouverture y est MULTIPLIÉE par la
    // part de sa source étendue que la tuile VOIT à travers la roche de l'étage — `partVisible`, le
    // seul prédicat d'occultation, seize rayons vers un disque posé contre la fente (`sourceDUnePorte`).
    // Derrière un angle, deux pas après le seuil, il fait noir ; un pilier porte son ombre.
    //
    // LE MAX SUR TOUTES LES OUVERTURES À PORTÉE, plus « la première trouvée » : une gueule proche
    // mais cachée par l'angle ne vaut rien, une plus loin mais en vue éclaire. Les anneaux
    // décroissent avec `d` : dès qu'un anneau ne peut plus battre le meilleur, on s'arrête.
    // Sur la gueule même (`d` = 0), on voit comme dehors — sans rayon.
    let best = 0
    for (let d = 0; d <= P; d++) {
      const anneau = d === 0 ? 1 : 1 - d / (P + 1)
      if (anneau <= best) break
      for (let oy = -d; oy <= d; oy++) {
        for (let ox = -d; ox <= d; ox++) {
          if (d > 0 && !(ox === -d || ox === d || oy === -d || oy === d)) continue
          const c = connecteurAt(state.map, tx + ox, ty + oy)
          if (c === undefined) continue
          // Une porte de CET étage, qui ouvre vers le HAUT — le jour vient d'en haut. La rampe
          // de terrasse 0→1 qui passe à trois tuiles d'une cave au niveau 1 n'éclaire rien.
          const autre = c.de === etage ? c.vers : c.vers === etage ? c.de : undefined
          if (autre === undefined || autre <= etage) continue
          if (d === 0) return 1
          const src = sourceDUnePorte(state.map, etage, tx + ox, ty + oy)
          const v = anneau * partVisible(state, etage, tx + 0.5, ty + 0.5, src[0], src[1])
          if (v > best) best = v
        }
      }
    }
    return best
  }
  if (!isSheltered(state, tx, ty)) return 1
  for (let d = 1; d <= P; d++) {
    // L'ANNEAU de rayon `d`, et lui seul : les couronnes intérieures ont déjà répondu non.
    for (let oy = -d; oy <= d; oy++) {
      for (let ox = -d; ox <= d; ox++) {
        // Le bord du carré : l'un des deux écarts vaut exactement `d`.
        const bord = ox === -d || ox === d || oy === -d || oy === d
        if (!bord) continue
        if (!isSheltered(state, tx + ox, ty + oy)) {
          // À la distance `d` du ciel : plein à la gueule (`d` = 1 → presque 1), nul au-delà.
          return 1 - d / (P + 1)
        }
      }
    }
  }
  return 0
}

/**
 * LA CLARTÉ EN UN POINT, dans [0, 1] — LA fonction, et celle que LA PRÉDICTION DU CLIENT
 * APPELLE (le patron de `meteoSpeedFactorAt`, spec `meteo.md` R7).
 *
 * Le client ne recopie rien : il la rappelle sur la façade d'état qu'il reconstitue du
 * snapshot (`etat-gel.ts` — tick, heure, structures, calendrier : tout y est déjà). Sans
 * elle, il prédirait un sprint que l'autorité refuse, et l'avatar ferait de l'élastique à
 * chaque réconciliation, la nuit, exactement quand on ne peut pas se le permettre.
 */
export function clarteSurSoiAt(
  state: SimState,
  tick: number,
  x: number,
  y: number,
  /** Ce corps tient-il une torche ALLUMÉE ? Le porteur est au centre de sa propre flamme. */
  torche: boolean,
  /** LE PLANCHER DU CORPS (spec `etages.md`). Absent ≡ le sol de la tuile (T-R3), donc tout
   *  l'existant. Sous la roche, le jour n'entre que par la gueule ; au-dessus, le ciel entier. */
  etage?: number,
  /** LA BRAISE QUE CE CORPS PORTE (B-R13c) — son halo au contact vaut sa charge. Absente ≡ un
   *  corps qui n'en porte pas : une sauvegarde d'avant l'étape 4, ou un POINT de la carte qu'on
   *  interroge sans corps (ce que font les gardes du couvert et de la cave). */
  braise?: Braise,
): number {
  // ═══ LE CIEL N'ENTRE PAS SOUS UN TOIT (E-R13, branche B1 — Alexis, 2026-09-02) ═══
  //
  // C'est le seul endroit où la loi s'applique, et c'est voulu : `clarteDuCiel` reste ce que le
  // CIEL vaut à cette heure — une grandeur du monde —, `partDuCiel` dit quelle PART en arrive
  // ici. Le produit se lit tout seul : dehors on multiplie par 1 (le monde d'avant, au bit
  // près) ; au fond d'un couvert, midi ne vaut pas mieux que minuit ; et la nuit, une gueule est
  // noire sans qu'on ait rien à écrire de plus.
  //
  // ⚠ **CE QUE ÇA CHANGE AU JEU, ET C'EST TOUT** : depuis qu'Alexis a coupé le sprint de la règle
  // du noir (même jour), la clarté ne commande plus AUCUNE vitesse — elle ne décide plus que de
  // la PARADE. Un intérieur sombre et sans feu refuse donc la garde en plein midi. C'est la
  // conséquence voulue de B1 (*la profondeur se gagne*), et elle se répare du geste qu'on a déjà :
  // une flamme. Un feu dans la pièce y suffit — `lumiereDuFeu` est prise au max juste en dessous.
  const ciel = clarteDuCiel(state, tick) * partDuCiel(state, Math.floor(x), Math.floor(y), etage)
  const feu = lumiereDuFeu(state, x, y, etage)
  // LES TORCHES DES AUTRES (LG-R18, Alexis, 2026-09-16) : en multi, la torche d'un autre avatar
  // éclaire à l'écran tout autour de lui — la sim la voit donc aussi, au max, jamais en somme.
  const torches = lumiereDesTorches(state, x, y, etage)
  // ═══ LE TERME SUR SOI — CE QU'ON PORTE, AU CONTACT (d = 0) ═══
  //
  // ⚠ C'était un `if (torche) return 1` en tête de fonction jusqu'au 2026-10-05 : une
  // EXCEPTION, et c'est elle que B-R13c remplace par un profil (la braise ne pouvait pas
  // entrer au `max` tant qu'une source sortait de la fonction avant lui).
  //
  // La valeur ne change pas d'un bit pour la torche : tout profil linéaire vaut **1 au
  // contact**, donc `1` n'était pas une valeur posée à la main mais le profil lu en d = 0.
  // ⚠ **ET CE N'EST INERTE QU'À UNE CONDITION, qu'il faut écrire parce qu'elle est implicite** :
  // que TOUS les autres termes du `max` restent ≤ 1 — `clarteDuCiel` × `partDuCiel`, les deux
  // balayages (`partVisible` ≤ 1), `bulleDuFeu` (`fireWarmthFactor` ∈ {0, EMBER, 1}) et
  // `BRAISE.CLARTE_PLEINE`. Porter ce dernier au-dessus de 1 ferait de l'ancien `return 1` et du
  // `max` deux fonctions différentes. ⚠ **ET LES TROIS GARDES QUE JE CITAIS ICI NE LE COUVRENT
  // PAS** (relevé par `determinisme-sim`, D4, MESURÉ par mutation `CLARTE_PLEINE: 1.5`) :
  // `nuit.test.ts` S1, `cave.test.ts:156` et `lumiere.test.ts` T1 restent **VERTES**, parce que
  // chacune vide la braise ou l'omet — aucune ne peut voir un sommet > 1. Le danger EST gardé,
  // mais par **⑨, ⑩ et « UN CÔNE DE PENTE FIXE »** (`braise.test.ts`), qui sont les seules à
  // faire porter la valeur par une braise chargée.
  // *(Ce commentaire créditait « B-A18 ① contrôle positif » : FAUX — ① ne tient aucune torche.
  // Corrigé à l'audit de fusion du 2026-10-05.)*
  //
  // ⚠ **ET CE TERME NE SE DÉLÈGUE PAS AUX DEUX BALAYAGES**, qui servent pourtant le porteur à
  // d = 0, pour DEUX raisons distinctes et toutes deux mesurées :
  //   · ils paient un `partVisible`, et le terme sur soi non (« il n'y a rien entre un corps et
  //     ce qu'il porte ») — or la part visible d'un corps sur sa PROPRE source tombe à 0,8125
  //     quand il colle un mur nord/sud, à 0,5 sous une pièce pleine, et les deux boucles
  //     écartent un corps à terre ou un figurant. À 32 % de charge, le seuil du noir passe
  //     ENTRE les deux : `lumiere.test.ts` ⑨ le garde, parade comprise ;
  //   · le CLIENT appelle avec sa position PRÉDITE alors que les entités de sa façade sont
  //     restées à celle du SNAPSHOT. En marche l'écart est non nul, et comme le rayon de la
  //     braise rétrécit avec la charge, le client prédirait **plus sombre que l'autorité**
  //     exactement au seuil — un refus de parade que l'autorité n'a pas prononcé (L4).
  // LA BRAISE DES AUTRES (B-R13c, le miroir exact de LG-R18) : en coop, la braise d'un camarade
  // éclaire autour de lui comme sa torche — la sim la voit donc aussi, au max, jamais en somme.
  const braises = lumiereDesBraises(state, x, y, etage)
  // ═══ LA BRAISE SUR SOI (B-R13c, étape 7 — tranché par Alexis le 2026-10-05, issue ⓐ) ═══
  //
  // Son profil en d = 0, c'est-à-dire `CLARTE_PLEINE × charge/plein` : c'est ici, et ici
  // seulement, que la barre de crans devient aussi une barre de VISION — une ressource, deux
  // lectures. Et c'est pour ça qu'elle n'est JAMAIS 1 par privilège, comme la torche l'était :
  // un corps à braise vide est aveugle, et la décroissance est VRAIE.
  //
  // ⚠ **CE QUE CETTE LIGNE CHANGE AU JEU, ET C'EST ASSUMÉ, PAS DÉCOUVERT** (`braise.md` § 5.21) :
  // au camp, une braise pleine rend TOUJOURS la parade — et c'est de l'arithmétique, pas une
  // mesure (au contact le profil vaut son sommet, donc `CLARTE_PLEINE ≥ SEUIL_NOIR` suffit).
  // Ce qui EST mesuré : la nuit noire pesait **24,7 %** des relevés du monde joué avant cette
  // ligne (4 144 sur 16 800). **La nuit noire ne disparaît pas,
  // elle CHANGE DE NATURE** : elle ne mord plus que là où la braise se vide, c'est-à-dire en
  // altitude et loin d'une balise. C'est la pression que l'Ascension veut, posée là où elle
  // veut — et c'est pourquoi les gardes de nuit aveugle disent désormais leur prémisse à voix
  // haute (« un corps SANS braise », « braise vide ») au lieu de la supposer.
  //
  // ⚠ **ET CE TERME N'EST PAS REDONDANT AVEC `lumiereDesBraises` — mon énoncé d'origine le
  // disait « prouvé redondant (B-A18 ⑧) », et la mesure le DÉMENT** (audit de fusion du
  // 2026-10-05). ⑧ ne vaut qu'en PLAINE NUE, où `partVisible(soi → soi)` = 1. Quatre états
  // MESURÉS où le balayage rend MOINS que le porteur, parce qu'il paie un `partVisible` que le
  // terme sur soi ne paie pas : contre un mur d'arête nord/sud (×0,8125, atteint EN MARCHANT —
  // le corps s'arrête à y = 48,3125), emmuré sous une pièce pleine (×0,5), un corps à terre
  // (`hp ≤ 0`, écarté de la boucle) et un corps inscrit comme figurant (idem). À 32 % de charge
  // le premier fait basculer la parade : gardé par `lumiere.test.ts` ⑨.
  let lumiere = feu > torches ? feu : torches
  if (braises > lumiere) lumiere = braises
  // ═══ LES DEUX TERMES SUR SOI, EN UN SEUL APPEL (B-R13d) ═══
  //
  // La torche et la braise sont les deux moitiés d'une MÊME grandeur — « ce que ce corps porte » —,
  // et depuis que le rendu s'en sert de plancher elle a deux lecteurs. Elle vit donc sous un nom,
  // et on l'APPELLE : le `max` en gardait une copie inline jusqu'au 2026-10-05, ce qui faisait
  // deux fonctions là où la loi est une. Un plancher d'écran tiré d'une copie dérive en silence,
  // et c'est N2bis qui en paierait le prix — gardé au bit par `lumiere.test.ts` ⑩.
  const porte = clarteDeCeQuOnPorte(torche, braise)
  if (porte > lumiere) lumiere = porte
  return lumiere > ciel ? lumiere : ciel
}

/**
 * ═══ CE QU'UN CORPS REÇOIT DE CE QU'IL PORTE (B-R13d) — UNE LOI, DEUX LECTEURS ═══
 *
 * *« Oui il doit être éclairé par sa torche ou une braise qu'il porte lui-même »* (Alexis,
 * 2026-10-05). C'est le terme SUR SOI du `max` de `clarteSurSoiAt`, extrait sous un nom parce
 * qu'il a désormais un second lecteur : **le rendu**, qui s'en sert de PLANCHER sur la lumière
 * que le corps d'un porteur lit dans le champ de la GI.
 *
 * ⚠ **POURQUOI CE N'EST PAS `clarteSurSoiAt` TOUT ENTIER, alors que c'était la formulation de la
 * décision.** La clarté entière prend aussi le CIEL et les feux ALENTOUR. En plancher de rendu,
 * son plus grand terme serait parfois le ciel — et le plancher se pose dans le champ, c'est-à-dire
 * **à la teinte d'une flamme** (`GI.TEINTE_FEU`) : un corps sous la lune prendrait un plancher
 * ORANGE venu du clair de lune. Le terme sur soi, lui, EST une flamme par nature — sa teinte est
 * légitime, et c'est exactement ce que la décision nomme (« sa torche », « une braise qu'il porte
 * lui-même »). Les autres termes n'ont pas besoin de plancher : le champ les porte déjà, puisqu'ils
 * sont dans `sourcesGi`.
 *
 * ⚠ **ET IL NE PAIE PAS DE `partVisible`, délibérément** : *« il n'y a rien entre un corps et ce
 * qu'il porte »* — c'est la raison même pour laquelle ce terme existe à côté des deux balayages
 * (voir le long commentaire ci-dessus, et `lumiere.test.ts` ⑨, qui MESURE les quatre états où le
 * balayage rend moins que le porteur).
 *
 * Une torche vive vaut **1** (tout profil linéaire vaut son sommet au contact) ; une braise vaut
 * **son profil en d = 0**, c'est-à-dire sa charge — jamais 1 par privilège, puisqu'un corps à
 * braise vide est aveugle.
 */
export function clarteDeCeQuOnPorte(torche: boolean, braise?: Braise): number {
  const t = torche ? 1 : 0
  const b = braise !== undefined ? bulleDeBraise(braise, 0) : 0
  return t > b ? t : b
}

/**
 * LA CLARTÉ SUR SOI, dans [0, 1] — ce que ce corps-là voit, là où il est.
 *
 * ⚠ Le coût : `fireBubble` balaie les structures. Cette fonction se lit sur les AVATARS
 * (boucle d'inputs, une poignée par tick), jamais par PNJ ni par monstre — le même périmètre
 * que la chasse nocturne, et pour la même raison (`nighthunt.preys`).
 */
export function clarteSurSoi(state: SimState, entity: Entity): number {
  return clarteSurSoiAt(state, state.tick, entity.x, entity.y, estTorcheVive(heldSlot(entity)), niveauDuCorps(state.map, entity), entity.braise)
}
