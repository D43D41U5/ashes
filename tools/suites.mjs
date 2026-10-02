/**
 * `pnpm test` — TOUTES les suites, et un compte-rendu qui ne ment pas.
 *
 * ── CE QUE ÇA REMPLACE, ET POURQUOI ─────────────────────────────────────────────
 *
 * `pnpm -r run test` s'arrête au PREMIER paquet qui échoue. Et comme `client` et `server`
 * dépendent de `@ashes/sim` en `workspace:*`, pnpm ordonne toujours /sim en tête : le
 * masquage n'était donc pas de la malchance, il était STRUCTUREL. Dès que /sim sortait en
 * 1, les 325 tests du client, les 37 du serveur et le banc de scénario ne tournaient
 * **pas du tout** — sans qu'une ligne de la sortie le dise.
 *
 * Or /sim sortait en 1 régulièrement, sur un flaky d'infrastructure de Vitest
 * (`Timeout calling "onTaskUpdate"`) qui ne fait échouer AUCUN test : c'est un délai de RPC
 * que Vitest n'obtient pas quand un test occupe longuement le fil (les nôtres bâtissent des
 * mondes de production, dix secondes de calcul synchrone d'affilée). Le dépôt vivait donc
 * avec une règle orale — « juge sur `Tests N passed`, pas sur le code de sortie » — qu'il
 * fallait connaître, et que la commande de garde ne connaissait pas elle-même.
 *
 * Et à l'intérieur de /sim, un `&&` faisait la même chose en plus petit : le banc de
 * scénario (`test:scenario`, le seul test qui pilote le VRAI worldgen) ne tournait jamais
 * quand la première moitié trébuchait.
 *
 * ── CE QUE ÇA FAIT ──────────────────────────────────────────────────────────────
 *
 * Chaque suite tourne, quoi qu'il arrive aux autres. On lit ensuite les COMPTES DE TESTS
 * dans la sortie de Vitest, et c'est sur eux qu'on juge :
 *
 *   • des tests échouent .................... ROUGE, et on nomme lesquels
 *   • aucun test n'échoue, sortie non nulle .. le flaky connu : on le DIT, on ne rougit pas
 *   • aucun compte lisible ................... ROUGE (un plantage avant les tests en est un)
 *
 * La règle orale devient donc la règle de l'outil. Séquentiel et non parallèle : le banc de
 * scénario mesure un coût par tick, et deux suites qui se disputent le CPU le fausseraient.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * L'ordre est celui de l'utilité : ce qui casse le plus souvent d'abord, le banc (lent) en
 * dernier — on veut le verdict des suites rapides sans attendre.
 */
const SUITES = [
  // 2026-08-30 : les réfugiés quittent le jeu (refugees.test, prompt-gate.test retirés) — et
  // les suites ont malgré ça GROSSI (chantiers cendre + garde _lit) : planchers recalés dessus.
  // 2026-08-31 : +22 gardes avec les ÉTAGES (`etages.test.ts`, spec `etages.md`) — le plancher
  // suit, en gardant la marge de quelques pourcents que décrit le commentaire ci-dessous.
  // 2026-09-03 : +89 gardes avec les TERRASSES (`terrasses.test.ts`, spec `terrasses.md`) —
  //   suite à 2169, plancher relevé quelques pourcents dessous.
  // 2026-09-05 : +8 gardes avec L'EAU SUR L'ESCALIER (T-A11, `terrasses.test.ts`, N3) —
  //   suite à 2195, plancher recalé quelques pourcents dessous.
  // 2026-09-06 : +58 gardes avec LES GROTTES DE TERRASSE (`grottes.test.ts`, spec `grottes.md`) —
  //   suite à 2253, plancher relevé quelques pourcents dessous.
  // 2026-09-06 : +18 gardes avec LES VIGNETTES G-R6 et le gel sous la roche (G-A6/G-A8/G-A12,
  //   `grottes.test.ts`, `plans-batis.test.ts`) — suite à 2271, plancher relevé quelques pourcents dessous.
  // 2026-09-07 : +3 gardes E-A3 — le murmure ne traverse pas un plancher (`murmure.test.ts`, 2),
  //   et le feu n'écarte le loup que de SON étage (`etages-etancheite.test.ts`, 1)
  //   — suite à 2280, plancher relevé quelques pourcents dessous.
  // 2026-09-07 (lot ①, Q1..Q4) : +5 gardes E-A3 — les décisions d'Alexis sur le feu, la
  //   perception du Cendreux, le cri de la harde, le hurlement du clan et l'odorat
  //   (`etages-etancheite.test.ts`) — suite à 2285.
  // 2026-09-07 (lot ②, Q6) : +2 gardes E-A3 — on ne boit pas un feu qu'on ne peut pas toucher
  //   (feu libre et Foyer de village) — suite à 2287.
  // 2026-09-07 (lot ③, Q5) : +4 gardes E-A3 — l'interaction à portée (`near` et ses 25 appels,
  //   la ligne, le dépeçage, le coin de chasse appris, le bâti) — suite à 2291.
  // 2026-09-11 : +5 gardes E-R5 §23 — l'approche vise l'étage de sa cible (`etages-etancheite`),
  //   puis +4 gardes T-A13 — le bord de terrasse n'est plus la grille de 8 (`terrasses.test.ts`,
  //   spec T-R11) — suite à 2305, plancher relevé quelques pourcents dessous.
  // 2026-09-11 : +5 gardes avec LE PAS D'ÉTAGE DU VILLAGEOIS (`etages-etancheite.test.ts`, spec
  //   §24) — la paroi, le mur de la terrasse, la descente dans la salle, la remontée. Suite à 2310.
  // 2026-09-12 : +18 gardes avec LA QUALITÉ DE L'EAU (`qualite-eau.test.ts`, spec `qualite-eau.md`)
  //   — la suie au plafond, le sang qui descend le fil, le coude qui ne coud pas, l'eau dormante,
  //   les deux bornes, la glace qui protège, l'événement qui ne bégaie pas. Suite à 2328,
  //   plancher relevé quelques pourcents dessous.
  // 2026-09-12 : +3 gardes de REVUE sur le même lot — l'attache exhaustive sur le vrai monde joué
  //   (A2ter, avec le témoin de la borne d'avant), le corps qui MARCHE en saignant (A4bis : un
  //   événement par tuile, plafond et éviction par le vrai chemin) et la re-entrée (A8bis).
  //   Suite à 2331.
  // 2026-09-12 : +6 gardes de la revue `determinisme-sim` — l'éviction par le TICK (le gué qu'on
  //   saigne n'est plus jeté), la portée du booléen que lit la pêche (épinglée en dur), le marais
  //   qui se souille hors crue (décision d'Alexis) et son témoin, la sauvegarde d'avant le champ.
  //   Suite à 2337 ; +1 avec la roselière (décision d'Alexis, même jour) — suite à 2338.
  // 2026-09-12 : +3 gardes Q9 — LA HARDE RENONCE à boire une eau ensanglantée (A7, son témoin,
  //   le seuil ; `qualite-eau.test.ts`). Suite à 2341.
  // 2026-09-12 : +22 gardes avec LA PISTE DE SANG (`piste-de-sang.test.ts`, spec `piste-de-sang.md`)
  //   — il vient de loin et son témoin, en silence, le sens de la piste, elle guide sans réveiller
  //   (×4), le loup qui saigne et le frère qui saigne, le sang de l'HOMME seulement (×3 : le tag à
  //   la source, la piste de bête au sol, l'eau de bête), l'eau qui appelle vers l'amont (×5,
  //   méandre compris), elle se perd, le mur entre deux gouttes (revue), le Feu tient, la roche
  //   arrête. Suite à 2363 sur l'arbre (2358 sur l'arbre commité seul : 5 gardes d'étage de
  //   l'autre session en plus), plancher relevé à 2345.
  // 2026-09-12 : +8 gardes A11 — LA VOIE EXACTE DU RENDU (`qualite-eau.test.ts`, lot SANG 2c) : la
  //   table d'attache ≡ attacheAuFil (fleuve, méandre, bande du monde joué — attaches ET orphelines),
  //   l'empreinte ≡ qualiteDeLEau AU BIT PRÈS (neuf souillures mêlées sur toute la carte, le coude,
  //   huit traînées du monde joué), l'effacement de l'appel d'avant, les crans (une goutte par cran,
  //   cran ≥ 2 ⇔ eauSouillee). Suite à 2371 sur l'arbre (2366 sur l'arbre commité seul), plancher
  //   relevé à 2350.
  // 2026-09-12 : +7 gardes A2 — TOUS LES FLEUVES (reprise de l'eau ; décision d'Alexis : « tous les
  //   fils, partout »). `qualite-eau.test.ts` (6) : le fil global et ses fins, l'aval qui ne franchit
  //   jamais la fin d'un fleuve, le sang du bout du premier qui ne teint pas la source du second, le
  //   monde joué (chaque point d'un fleuve secondaire s'attache à SON fleuve et se pêche en rivière —
  //   avant : −1 et « lac »), un fleuve VIDE dans `fils` qui ne fait pas couler la suie d'un fleuve
  //   dans le suivant (revue déterminisme), la table et l'empreinte au bit près à deux fleuves (A11) ;
  //   `peche.test.ts` (1) : un second fleuve est une rivière, pas un lac. Suite à 2378 sur l'arbre
  //   (2373 sur l'arbre commité seul), plancher relevé à 2360.
  // 2026-09-12 : +1 garde A2bis — LE LIT PEINT (décision d'Alexis : la rivière de la pêche est le lit
  //   que le peintre a posé, plus une bande à 2 du fil). `peche.test.ts` : le lit à 3 et 4 du fil est
  //   rivière, le lac qu'un fil traverse reste lac, l'ordre du lit est indifférent, une tuile comblée
  //   n'est plus rien ; et sur le monde joué (dans la garde A1/A2) zéro tuile de `map.lacs` en
  //   rivière, ≥ 1 000 tuiles de rivière hors bande. Suite à 2379 sur l'arbre (2374 sur l'arbre
  //   commité seul) ; plancher inchangé (2360).
  // 2026-09-12 : +2 gardes A1 — LE DÉBIT PERSISTÉ (`hydro.test.ts` ; décision d'Alexis : `map.debit`,
  //   un rang 0-7 par tuile) — la loi du rang (l'inverse du rayon, 1..7, monotone, bornée) et le
  //   monde joué (terre et lacs à 0, tout point de fil hors lac > 0, le fleuve grossit vers sa
  //   bouche). `carte-immuable.test.ts` hache le champ. Suite à 2381 sur l'arbre (2376 sur l'arbre
  //   commité seul) ; plancher inchangé (2360).
  // 2026-09-12 : +1 garde (`eau-rendu.test.ts`) — la bande morte de l'assec est un verdict de vallée
  //   (`eauASec`), et la porte du client la lit ; l'entrée franche seule manquait 1 aube sur 240.
  //   Suite à 2382 sur l'arbre (2377 sur l'arbre commité seul) ; plancher inchangé (2360).
  // 2026-09-12 : +5 gardes D1 — LES ÉVÉNEMENTS D'EAU (`eau-evenements.test.ts`, spec `saisons.md`
  //   A25 ; décision d'Alexis : « la vallée, au jour, sans le gel ») — la mare qui part et revient,
  //   la saison jouée muette, la crue qui ferme les gués puis rend dans l'ordre, la sauvegarde
  //   d'avant, la chronique. Suite à 2387 sur l'arbre (2382 sur l'arbre commité seul) ; plancher
  //   inchangé (2360).
  // 2026-09-20 : +6 gardes — LA ROCHE EST ÉTANCHE (`etages.test.ts` 1 : un souterrain ne se rejoint
  //   jamais par sa gueule ; `etages-etancheite.test.ts` 1 : le sanglier ne sent ni n'encorne à
  //   travers un plancher) et LA PAROI TIENT UNE TUILE (`grottes.test.ts` G-A15, 4 graines). Suite à
  //   2458 sur l'arbre, 2 rouges PRÉEXISTANTS à HEAD dans `charniers.test.ts` (les 15 Sources du
  //   2026-09-13 jamais ré-épinglées : 172 lieux, et le Charnier XLVIII à 21 t d'une Source) ;
  //   plancher inchangé (2360).
  // 2026-09-20 : les deux rouges de `charniers.test.ts` soldés — 157 → 172 ré-épinglé (les 15 Sources
  //   sont un AJOUT pur : la loterie garde ses 134, gardés à part), et la Source sort de la règle
  //   d'écart des charniers (poussée APRÈS eux, `tropPres` ne l'a jamais vue ; le recouvrement reste
  //   gardé pour tous les lieux). Suite à 2460 ✓ sur l'arbre (2 sautés) ; plancher inchangé (2360).
  //   ⚠ A13 (`zonegen.test.ts`, < 20 s) tient à 17,7 s machine calme et rougit à 22 s sous les
  //   cinq workers à cache froid : une garde de temps se juge seule, pas dans la suite chargée.
  // 2026-09-21 : +4 gardes T-A14 — aucun pied de mur à plus d'un PLAFOND d'une montée, là où le
  //   terrain en offre une (`terrasses.test.ts`, spec `terrasses.md` §5, 4 graines). Suite à 2468 ✓
  //   sur l'arbre (2 sautés) ; plancher inchangé (2360).
  // 2026-09-22 : +1 garde A16 — un glanage ENCLAVÉ cesse d'être élu et le village prend celui
  //   qu'il PEUT atteindre (`glanage.test.ts`, spec `ascension.md` V-R12). Suite à 2469 ;
  //   plancher relevé d'autant.
  // 2026-09-25 : +29 gardes avec LE RÉSEAU DE SENTES (`zonegen-reseau.test.ts`, spec
  //   `ascension.md` V-A7 — aucune route ne traverse un mur, toute terrasse éligible est
  //   rejointe, la sente passe devant la porte, et l'EMPREINTE du terrain peint) — suite à
  //   2498 ✓, plancher relevé quelques pourcents dessous.
  // 2026-09-25 (même jour, plus tard) : +4 gardes « (d) le tracé est ORGANIQUE » — la rectitude
  //   du réseau se mesure enfin, l'empreinte ne disait rien de la FORME. Suite à 2502 ✓.
  // 2026-09-25 (soir) : +2 gardes V-A9bis — une corvée sans bois ne gèle plus le tableau, pour le
  //   Feu ET pour la réparation (`npc.test.ts`). Suite à 2504 ✓.
  // 2026-09-26 : +4 gardes P-A1, LA VIVACITÉ DU TABLEAU (`npc.test.ts`, spec `pnj.md` — la passe
  //   sur la machine du village). La loi ne nomme aucune corvée : un village qui a encore
  //   quelqu'un de vivant travaille, quoi qu'il lui manque. Quatre empêchements, ROUGES tous les
  //   quatre sur `7ea2121`. Suite à 2508 ✓.
  // 2026-09-26 : +1 garde P-A3 — le gardien du Feu ne brûle pas plus de bois que le Feu n'en
  //   absorbe (`npc.test.ts`), écrite en CONSERVATION parce que la forme instantanée était verte
  //   sur le code fautif (le clamp de `feedVillageFire` masquait le gaspillage). Rouge sur
  //   `152401a` : 40 bûches pour 7,5 absorbables. Suite à 2509 ✓, plancher relevé d'autant.
  // 2026-09-29 : −9 gardes — LA FIN DE SAISON EST RETIRÉE DU CODE (pivot de la braise, décision
  //   d'Alexis). Neuf `it` ont perdu leur SUJET, pas leur loi : `saison.test.ts` −6 (l'évacuation
  //   ×2, le verdict, et les trois de « la saison SANS fin » — une saison qui ne peut plus finir
  //   n'a pas de garde à poser), `saisons.test.ts` −1 (« la saison ne finit pas dix cycles après
  //   l'ouverture », devenu structurel), `chronicle.test.ts` −1 (la stèle), `etages-etancheite`
  //   −1 (E-R5 « on n'embarque pas depuis l'étage d'en dessous » — la LOI survit dans les autres
  //   sites du fichier). Suite à 2500 ✓ ; PLANCHER INCHANGÉ (2429), la marge l'absorbe.
  // 2026-09-29 : −14 gardes — L'ALIGNEMENT EST RETIRÉ DU CODE (suite du pivot). `alignment.test.ts`
  //   part en entier (−9) avec le système qu'il éprouvait ; `npc.test.ts` −2 (les deux gardes de
  //   raid), `depecage.test.ts` −1 (A14, la récolte pesée par l'archétype), `economy.test.ts` −1
  //   (la récolte de la Meute). ⚠ LA QUATORZIÈME EST GÉNÉRÉE, et c'est le piège : `lois-d-acte.test.ts`
  //   fabrique un `it` PAR LIGNE de sa table `LOIS`, dont `ALIGNMENT.ACT_FACTOR` — son compte de
  //   `it(` statiques ne bouge pas, la suite perd un test quand même. Un delta qui ne se recompte
  //   pas à la main dans ce fichier-là vient de là. Suite à 2486 ✓ ; PLANCHER INCHANGÉ (2429).
  // 2026-09-29 : −3 gardes — TRANCHE 1 DU RETRAIT DES VILLAGES PNJ (`village-growth.ts` supprimé).
  //   `village-plan.test.ts` perd ses trois describes qui éprouvaient `advanceVillageGrowth` : « la
  //   montée de palier au surplus (R6) », « la porte rituelle (R7) », « la prospérité attire (R9) ».
  //   Une de leurs lois devient STRUCTURELLE au lieu d'être gardée, et c'est écrit dans le fichier :
  //   R7 affirmait qu'un village à chef HUMAIN ne voit pas ses portes bouger seules — plus rien au
  //   monde ne bouge une porte sans un geste. PLANCHER INCHANGÉ (2429).
  // 2026-09-29 : −1 garde — TRANCHE 2a, `light_fire` s'aligne sur le jeu réel (`npcsArrived: true`).
  //   `npc.test.ts` perd « fonder en joueur attire 3 PNJ membres », et ce n'était pas une garde
  //   devenue fausse par accident : elle AFFIRMAIT COMME UNE PROMESSE l'écart entre le chemin de
  //   test (`light_fire`) et le chemin du jeu (`found_village`, « AUCUN PNJ d'accueil », décision
  //   d'Alexis). Aucun émetteur client n'envoie `light_fire` : la garde éprouvait un monde que
  //   personne ne peut jouer. Elle part avec l'écart qu'elle protégeait. Suite à 2482 ✓ (2 sautés) ;
  //   PLANCHER INCHANGÉ (2429).
  // 2026-09-29 : −69 gardes NETTES, ET LE PLANCHER CÈDE POUR DE BON — TRANCHE 2b, L'IA
  //   VILLAGEOISE QUITTE LE CODE. C'est la plus grosse coupe du pivot de la braise, et le
  //   plancher descend de 2429 à 2370 : il DOIT descendre, sinon il garderait un corpus dont le
  //   sujet n'existe plus. Le détail, fichier par fichier (−70 retirées, +1 recueillie) :
  //     npc.test.ts             44 → 0   le fichier entier — 42 gardes d'IA + 2 sautées
  //     village-plan.test.ts    18 → 12  le tableau build ×2, la paillasse-domicile, « les PNJ
  //                                      bâtissent », P0.3c, le débit du défrichement
  //     glanage.test.ts         17 → 12  G6 en entier (A10, A11, A11bis, A12, A16) : elles
  //                                      éprouvaient le TABLEAU, pas le glanage
  //     etages-etancheite.test  45 → 40  « le glanage élit ce que le CHEMIN rejoint » — ⚠ LA
  //                                      PERTE LA PLUS CHÈRE, voir le bandeau du fichier
  //     corvee-eau.test.ts       4 → 2   la course à l'eau ; `eauLaPlusProcheMarchable` reste
  //     flore-froid.test.ts     19 → 17  le livelock du buisson gelé (plus de corvée à figer)
  //     meteo.test.ts           87 → 85  R8 PNJ ×2 — ⚠ le REPLI à l'abri n'est plus mesuré
  //     worldevents.test.ts     14 → 12  A7(a) et A7(b), la milice contre la horde
  //     combat.test.ts          75 → 74  la milice (A7)
  //     balance.test.ts          8 → 7   la cible de portage croisée avec la taille de case
  //     lissage-chemin.test.ts   5 → 6   **+1 RECUEILLIE** : « l'A* contourne, se rejoue et sait
  //                                      dire non », qui vivait sous « la navigation (A4) » des
  //                                      PNJ sans jamais avoir eu besoin d'un PNJ
  //   ⚠ ET UN ROUGE QUI N'ÉTAIT PAS UNE COUPE : `worldevents` « elle NE SE RETASSE PAS en
  //   marchant » comptait 1 200 ticks alors que la horde ARRIVE au village au bout de 270-560 et
  //   tourne ensuite sur place. Le villageois d'accueil masquait le défaut (la horde le
  //   pourchassait, donc elle marchait encore). Fenêtre bornée à l'arrivée : 95,5 à 100 % sur
  //   douze graines, contre 54 % avant réparation. La garde était fausse, pas la horde.
  //   Suite à 2415 ✓ (plus aucun sauté : les deux vivaient dans `npc.test.ts`).
  // 2026-09-29 : TRANCHE 3 — `SimState.npcs` QUITTE L'ÉTAT, ET AUCUN COMPTE NE BOUGE. C'est la
  //   promesse de cette tranche et elle est tenue : sim 2415, client 1805, serveur 36, banc 1 ✓ —
  //   PLANCHERS INCHANGÉS. Le champ ne portait plus rien depuis 2b ; ce qui part ici est
  //   structurel (quatorze lecteurs, le snapshot `protocol.ts`, la clé de `SAVE_REQUIRED_KEYS`,
  //   `migrerSansChemin`, la façade du gel côté client). ⚠ Le seul chiffre qui bouge est celui des
  //   SAUTÉS du banc, 3 → 1 : les deux gardes gelées par `it.skipIf(!FEATURES.VILLAGES_PNJ)` qui
  //   lisaient `report.starvationSamples` sont supprimées, `braise.md` § 3 étape 11 tranchant leur
  //   sort (« se suppriment au lieu de repartir »). ⚠ ELLES ÉTAIENT LES SEULES À APPELER
  //   `runScenario` : **`pnpm scenario` ne joue plus un tick**, et la perte date du 26/09 (le
  //   drapeau), pas d'aujourd'hui — la doc qui promettait encore « des milliers de ticks » est
  //   corrigée (CLAUDE.md, en-tête de `scenario.test.ts`). Coût pour le rallumer, MESURÉ :
  //   runScenario 1 j = 132 s, 2 j = +315 s, et le banc n'a pas d'avatar.
  //   TROIS gardes RÉÉCRITES au lieu d'être supprimées, parce que la loi appariait TOUJOURS les
  //   PNJ aux MONSTRES dans une même expression et que les monstres vivent : `lumiere.test.ts` T3
  //   (N6 — la torche d'un figurant n'éclaire personne), `etat-gel-lumiere.test.ts` (la porte
  //   `npcs` devient `figurants`), `interest.test.ts` (les monstres portaient déjà la loi
  //   entière). ⚠ ET LA FAMINE N'EST PLUS MESURÉE PAR PERSONNE (`starvationSamples` part) —
  //   troisième loi sans mesureur après l'étanchéité sur un corps qui marche et le repli à l'abri.
  //   MESURÉ, zéro changement de comportement : `tools/empreinte-sim.mts` sur 12 régimes, flux
  //   d'événements identique 48/48 jalons, `rngState` et tous les compteurs identiques 12/12,
  //   couverture identique. Les hachages d'ÉTAT diffèrent 48/48 et c'est ATTENDU : `snapshot()`
  //   est `JSON.stringify(state)`, l'objet porte une clé de moins.
  // 2026-09-30 : +5 gardes `FROID_PAR_ETAGE` (étape 1 de `braise.md` § 3, `temperature.test.ts`)
  //   — suite à 2410, plancher laissé tel quel, la marge le couvrait.
  // 2026-10-02 : +5 gardes LES DEUX BORNES PAR PALIER (étape 2, `gel.test.ts`) — la prémisse du
  //   plafond affirmée sur l'arité, le plancher contre les froids locaux (dans les deux régimes de
  //   cendre), le balayage exhaustif qui prouve majorant ET équivalence d'un coup, la porte locale
  //   qui coupe avec sa monotonie, le plafond en altitude. Suite à 2415, plancher relevé à 2405 :
  //   40 de marge accumulés depuis le 09-12 ne détectaient plus un fichier évaporé.
  { nom: 'sim', dir: 'packages/sim', args: ['run', '--exclude', 'src/scenario.test.ts'], plancher: 2405 },
  // 2026-09-01 : +10 gardes avec le RENDU des étages (`plateau-art.test.ts`).
  // 2026-09-01 : +9 gardes avec le TRI DES ÉTAGES (strate, découvert — `framing.test.ts`),
  //   suite relevée à 1429 ✓, plancher recalé quelques pourcents dessous.
  // 2026-09-06 : +68 gardes avec les GROTTES (index à deux mondes, `index-noeuds.test.ts`…) —
  //   suite à 1497, plancher relevé quelques pourcents dessous.
  // 2026-09-07 : +12 gardes avec LE SEUIL D'UNE GUEULE (`niveau-du-corps.test.ts`, la loi sortie
  //   d'`etage-layer` pour être testable) — suite à 1524, plancher relevé quelques pourcents dessous.
  // 2026-09-07 : +7 gardes avec LA VISÉE D'UNE GUEULE (`deplier-etage.test.ts` : l'arche se
  //   déplie comme une rampe) — suite à 1531, plancher relevé quelques pourcents dessous.
  // 2026-09-07 : +16 gardes avec L'ACCESSEUR D'ÉTAGE DU RENDU (`strates.test.ts`, E-R28/29/30)
  //   — suite à 1547, plancher relevé quelques pourcents dessous.
  // 2026-09-08 : +18 gardes avec LES OISEAUX (`vol-des-oiseaux.test.ts` : l'heure du vol est
  //   celle du chant, l'aube n'appartient qu'aux passereaux, l'aile fait l'aller-retour)
  //   — suite à 1565, plancher relevé quelques pourcents dessous.
  // 2026-09-12 : trois ASSERTIONS modifiées (aucun test ajouté) — les compteurs de l'inventaire audio recalés sur `water_fouled`
  //   (99 faits, 42 silences décidés) : un fait muet est un fait COMPTÉ. Suite à 1565.
  // 2026-09-12 : +5 gardes avec LE CANAL B À TROIS CHIFFRES (`water-field.test.ts`, lot SANG 2c) —
  //   régime × cran de sang × palier : encodage/décodage exhaustif, aucun cran ne franchit un seuil
  //   de régime (un plafond à 9 crans rougissait : 5), les octets historiques 0/100/200 inchangés,
  //   `buildWaterField` pose les dizaines. Suite à 1570, plancher relevé à 1560.
  // 2026-09-12 : +19 gardes avec LES VOIX DE L'EAU (reprise de l'eau, B1 + B3) — la cascade a une
  //   voix (`cascade-audio.test.ts`, 12 : la loi de la cible — silence, une colonne « ici », √N,
  //   plafond, côté, voile, monotone ; la machine — pas de nappe sans colonne, cadence, sommeil,
  //   taire), le splash d'un autre et le clapotis se tiennent quelque part (`eau-audio.test.ts`, 6 :
  //   le point de rive par le gradient du SDF, ce que chaque voix tend au moteur), et la cascade
  //   seule a un panner (`engine.test.ts`, 1). Suite à 1589, plancher relevé à 1575.
  // 2026-09-12 : +2 gardes A2 (`flow-field.test.ts`) — un second fleuve a son courant (avant : une eau
  //   morte à l'écran), le fleuve principal ne bouge pas d'un vecteur loin de la confluence et la
  //   confluence prend le point de fil le plus proche. Suite à 1591 ; plancher inchangé (1575).
  // 2026-09-12 : +5 gardes C1 — LA CARTE MONTRE L'EAU DU JOUR (`carte-eau.test.ts`, spec `saisons.md`
  //   A26 ; trois décisions d'Alexis) — `null` les jours où la carte du jour est le bake, la
  //   dérivation par tuile, peindre « comme le bake » = copier le bake (octet pour octet), la vase
  //   de l'assec et son liseré, la crue aux deux eaux et la rive qui bouge. Suite à 1596 ;
  //   plancher inchangé (1575).
  // 2026-09-19 : la LUMIÈRE GLOBALE a apporté ses gardes au fil du chantier (176 tests GI, `render/gi/`,
  //   fusionnés sur main le 19/09) sans que le plancher bouge ; puis +6 avec LA PASSE DES CORPS EN
  //   ATTRIBUTS (`corps-gpu.test.ts` : les drapeaux empaquetés, la teinte, le GLSL sans uniforme par
  //   sprite). Suite à 1795, plancher relevé quelques pourcents dessous.
  // 2026-09-24 : +4 gardes V-R8 — LES PAROIS DE TERRASSE SUR LA CARTE (`carte-savoir.test.ts` :
  //   la crête porte le trait et le pied l'ombre, la rampe fait une trouée et LÀ SEULEMENT, une
  //   rampe de MESA n'ouvre rien — le piège du `vers` —, et sans `map.palier` rien ne bouge).
  //   Suite à 1802 ✓ sur l'arbre ; plancher inchangé (1740).
  // 2026-09-26 : −1 SAUTÉ, pas une perte — V-A2 (« la Veillée fonde ses voisins PNJ ») passe en
  //   `it.skipIf(!FEATURES.VILLAGES_PNJ)` avec l'extinction des villages PNJ (Alexis : « stop les
  //   villages […] idem pour les tests »). Suite à 1801 ✓ + 1 sauté ; plancher inchangé (1740), la
  //   marge l'absorbe. ⚠ Le plancher compare les PASSÉS : un sauté maigrit le compte pour de vrai,
  //   et si d'autres gardes rejoignent ce drapeau il faudra le dire ici plutôt que de le subir.
  // 2026-09-29 : −7 gardes — L'ALIGNEMENT EST RETIRÉ DU CODE, côté rendu. `lighting.test.ts` −5,
  //   dont QUATRE qui éprouvaient une ENTRÉE qui n'existe plus (« warmth positif → bleu (Foyer) »,
  //   « warmth négatif → rouge (Meute) », « couleur = alignement », « un Feu plus engagé rayonne
  //   plus loin ») ; « warmth nul → blanc » est REMPLACÉE une pour une par « un Feu allumé est
  //   blanc — la couleur du Feu est une constante ». ⚠ LA CINQUIÈME EST UN TROU ASSUMÉ, et il est
  //   écrit en tête de son `describe` : l'opposition halo↔clairière tenait par un TERME (le halo
  //   grandissait avec l'engagement) et la coupe le retire, donc sa moitié halo comparait deux
  //   rayons devenus égaux. Deux remplacements ont été écrits puis JETÉS parce qu'ils ne pouvaient
  //   pas rougir — dont une garde de signature au compilateur, ÉPROUVÉE : `(a, b, c = 0)` reste
  //   assignable à `(a, b)`, or un `warmth = 0` optionnel est la forme même d'un recouplage.
  //   `champ-ref.test.ts` −2 (la force du Feu modulée par l'engagement dans la chaîne GI ; la
  //   moitié SOUFFLE est gardée). Suite à 1805 ✓ ; plancher inchangé (1740).
  // 2026-09-29 (tranche 4) : sim 2415 → 2405 (−2 `debug.test.ts`, −8 `village-plan.test.ts` ;
  //   la garde rescapée de `peche.test.ts` ne change pas le compte) et le CLIENT PERD SON SEUL
  //   SAUTÉ — V-A2 était gelée par `it.skipIf`, elle est supprimée : 1805 ✓ tout net. Planchers
  //   sim et client inchangés (2370 et 1740) : ils gardent leur marge de quelques pourcents.
  { nom: 'client', dir: 'packages/client', args: ['run'], plancher: 1740 },
  { nom: 'serveur', dir: 'packages/server', args: ['run'], plancher: 36 },
  // Le banc pilote le vrai worldgen sur la carte de production : lent, et seul à porter le
  // drapeau qui ignore les erreurs non gérées (voir l'en-tête de `scenario.test.ts`).
  // 2026-09-26 : LE BANC TOMBE DE 4 À 1 — les villages PNJ sont ÉTEINTS (`FEATURES.VILLAGES_PNJ`,
  //   décision d'Alexis : finir le worldgen d'abord). Trois de ses quatre gardes ont perdu leur
  //   SUJET, pas leur loi, et sont gelées par `it.skipIf` : l'économie sur un jour, A8 (la météo
  //   qui ne tue aucun PNJ — celle-là passait au VERT sans villageois, ce qui est pire qu'un rouge)
  //   et V-A9 (elle cherche un Feu qui n'existe plus). ⚠ LA QUATRIÈME EST GARDÉE ENTIÈRE et c'est
  //   délibéré : « mesure le monde qu'on JOUE » est du WORLDGEN (gibier, nœuds, murs des lieux) et
  //   de l'ÉLECTION DE SITES (la marge du raideur) — que le drapeau ne touche pas —, seul son
  //   dernier bloc est gelé. Vider le banc de sa couverture worldgen pendant le chantier qui la
  //   travaille aurait été l'inverse du but. Plancher à 1 ; il remonte à 4 au rallumage.
  // 2026-09-29 : LE BANC REMONTE À 2, ET « IL REMONTE À 4 AU RALLUMAGE » N'A PLUS D'OBJET — il
  //   n'y a plus rien à rallumer (`FEATURES` est vide, tranche 4 du retrait des villages PNJ).
  //   Des trois gardes gelées le 26/09, deux sont SUPPRIMÉES avec leur sujet (l'économie sur un
  //   jour, A8 la météo — celle-là verdissait à vide) et **V-A9 est DÉGELÉE** : « mesure le monde
  //   qu'on JOUE » tourne, sa clause finale affirmant `villages.length === 0` pour qu'une
  //   fondation revenue par une autre porte ne passe pas en silence. Suite à 2 ✓, plancher à 2 —
  //   pas de marge ici : deux gardes, on les compte à l'unité.
  { nom: 'banc', dir: 'packages/sim', args: ['run', 'src/scenario.test.ts', '--dangerouslyIgnoreUnhandledErrors'], plancher: 2 },
]

/**
 * ═══ LE PLANCHER : UN TEST QUI DISPARAÎT DOIT COÛTER AUSSI CHER QU'UN TEST QUI ÉCHOUE ═══
 *
 * Le total des tests était IMPRIMÉ et comparé à RIEN. On pouvait donc perdre des dizaines
 * de tests — un fichier vidé, supprimé, ou qui ne se charge plus — et lire un compte-rendu
 * parfaitement vert. C'est la panne la plus silencieuse qui soit : on croit garder 2 000
 * tests, on en garde 1 700, et rien ne le dit, ni en local ni sur une PR.
 *
 * Le plancher n'est PAS le compte exact : il est posé quelques pourcents en dessous, parce
 * qu'on doit pouvoir retirer un test devenu faux sans faire rougir le dépôt. Ce qu'il
 * attrape est l'EFFONDREMENT — un fichier entier qui s'évapore. Et il vieillit dans le bon
 * sens : une suite qui grandit le laisse simplement derrière elle, sans jamais mentir.
 * On le relève quand la suite a franchement grossi, pas à chaque test ajouté.
 */

/** Le flaky connu, nommé — pour le distinguer d'une vraie erreur non gérée. */
const FLAKY = /Timeout calling ["']onTaskUpdate["']/

function lance(suite) {
  return new Promise((ok) => {
    const p = spawn('pnpm', ['exec', 'vitest', ...suite.args], {
      cwd: resolve(ROOT, suite.dir),
      env: { ...process.env, CI: '1' },
    })
    let sortie = ''
    const voir = (buf) => {
      const s = String(buf)
      sortie += s
      process.stdout.write(s) // on ne cache rien : la sortie de Vitest passe telle quelle
    }
    p.stdout.on('data', voir)
    p.stderr.on('data', voir)
    p.on('exit', (code) => ok({ code: code ?? 1, sortie }))
  })
}

/**
 * Ce que Vitest dit de lui-même. Il imprime DEUX lignes de compte, et il faut les DEUX :
 *
 *   Test Files  79 passed (79)          ← les FICHIERS
 *   Tests  1339 passed | 2 skipped      ← les TESTS
 *
 * ⚠ LIRE « Tests » SEUL NE SUFFIT PAS, et c'est par là que la commande mentait. Un fichier
 * qui échoue à la COLLECTE — un import cassé, un export de barrel renommé, un cycle — ne
 * produit AUCUN test, donc `failed` y vaut 0 : la ligne « Tests » est parfaitement verte
 * pendant que « Test Files » dit `1 failed`. Reproduit avec le vitest du dépôt. Combiné au
 * flaky connu, ça sortait en 0 — et la CI aussi.
 *
 * On prend la DERNIÈRE occurrence de chaque ligne : Vitest les réécrit au fil de l'eau.
 * (`/Tests\s+/` ne peut pas capturer « Test Files » par erreur : pas de `s` après `Test`.)
 */
function compte(sortie) {
  const nombresDe = (etiquette) => {
    const lignes = [...sortie.matchAll(new RegExp(`${etiquette}\\s+(.+)$`, 'gm'))]
    const derniere = lignes[lignes.length - 1]
    if (!derniere) return null
    const texte = derniere[1]
    return (mot) => {
      const m = texte.match(new RegExp(`(\\d+)\\s+${mot}`))
      return m ? Number(m[1]) : 0
    }
  }
  const tests = nombresDe('Tests')
  if (!tests) return null
  const fichiers = nombresDe('Test Files')
  return {
    passes: tests('passed'),
    echecs: tests('failed'),
    sautes: tests('skipped'),
    // `null` quand la ligne manque : on ne fabrique pas un zéro rassurant à partir de rien.
    fichiersEchecs: fichiers ? fichiers('failed') : null,
  }
}

const resultats = []
for (const suite of SUITES) {
  console.log(`\n[1m── ${suite.nom} ──[0m`)
  const { code, sortie } = await lance(suite)
  const c = compte(sortie)
  resultats.push({ suite, code, compte: c, flaky: FLAKY.test(sortie) })
}

console.log(`\n[1m════ COMPTE-RENDU ════[0m`)
let rouge = false
for (const r of resultats) {
  const c = r.compte
  if (!c) {
    rouge = true
    console.log(`  [31m✗[0m ${r.nom ?? r.suite.nom} — AUCUN COMPTE DE TESTS (la suite n'a pas démarré ; sortie ${r.code})`)
    continue
  }
  const detail = `${c.passes} ✓${c.echecs ? ` · ${c.echecs} ✗` : ''}${c.sautes ? ` · ${c.sautes} sautés` : ''}`
  const nom = r.suite.nom.padEnd(8)
  const sousLePlancher = c.passes < r.suite.plancher
  if (c.echecs > 0) {
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}`)
  } else if (c.fichiersEchecs === null) {
    // La ligne « Test Files » manque alors que « Tests » est là : format inattendu. On ne
    // devine pas — un garde-fou qui suppose est un garde-fou qui finira par se tromper.
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}  (ligne « Test Files » illisible — format de Vitest inattendu)`)
  } else if (c.fichiersEchecs > 0) {
    // LE CAS QUE LA PORTE DU FLAKY AVALAIT : un fichier qui ne se CHARGE plus n'apporte aucun
    // test, donc aucun échec de test. Ce n'est pas un flake de RPC, c'est du code cassé.
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}  (${c.fichiersEchecs} FICHIER(S) EN ÉCHEC — collecte cassée, pas un flaky)`)
  } else if (sousLePlancher) {
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}  (SOUS LE PLANCHER de ${r.suite.plancher} — des tests ont DISPARU)`)
  } else if (r.code !== 0 && r.flaky) {
    // On le DIT à chaque fois : un bruit qu'on tolère en silence finit par cacher autre chose.
    // Et on n'arrive ici QU'APRÈS avoir écarté les trois cas ci-dessus : la question n'est pas
    // « le flaky apparaît-il ? » mais « est-il la SEULE explication de cette sortie non nulle ? ».
    console.log(`  [33m•[0m ${nom} ${detail}  (sortie ${r.code} — flaky Vitest « onTaskUpdate », aucun test ni fichier en échec)`)
  } else if (r.code !== 0) {
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}  (sortie ${r.code}, hors flaky connu — à regarder)`)
  } else {
    console.log(`  [32m✓[0m ${nom} ${detail}`)
  }
}

const total = resultats.reduce((n, r) => n + (r.compte?.passes ?? 0), 0)
const planchers = SUITES.reduce((n, s) => n + s.plancher, 0)
console.log(`\n  ${total} tests passés sur ${resultats.length} suites (plancher cumulé : ${planchers}).`)
process.exit(rouge ? 1 : 0)
