# Calibration de saison entière — banc long, passe 1 (2026-08-16)

> **Nature.** Premier relevé du « seul vrai reste de GATE 1 » (`gate1-finition.md` P4) : la
> saison ENTIÈRE jouée au banc, 60 jours × 4 graines, relevé par cycle. Instrument :
> `tools/banc-saison.mts` (même monde que `pnpm scenario` — `construireMondeDuBanc`, parité
> d'amorce comprise —, graine paramétrable, JSONL par cycle dans `scratchpad/banc-saison/`).
> Je rapporte le MESURÉ ; les nombres et les remèdes sont des décisions d'Alexis.

## Les deux limites de l'instrument (à lire avant les nombres)

1. **Le banc n'a pas de joueur.** Toute règle qui vise l'avatar mesure zéro : personne ne
   défend un voisin, ne commerce, ne recrute des réfugiés côté joueur. Le banc mesure la
   dynamique du monde PNJ *seul* — c'est le décor dans lequel le joueur jouera, pas sa partie.
2. **Deux horloges.** `calendarScale` ≈ 30 fait d'un cycle réel un jour de saison : tout ce
   qui se cadence en cycles réels (péremption, cadences de convois/réfugiés) tourne ~30× plus
   vite qu'en vrai jeu. Les COMPTES absolus de convois/réfugiés ci-dessous sont des artefacts
   d'horloge ; les MÉCANISMES (mort définitive, recrutement nul) ne dépendent pas de l'horloge.

## Le fait central — MESURÉ sur 4 graines sur 4

**Le monde PNJ entier meurt entre le jour 20 et le jour 36, sur toutes les graines.** Les
actes II et III, les convois, les réfugiés, l'évacuation et l'Arche se jouent dans une vallée
vide — 24 à 40 jours de simulation d'un monde mort.

| graine | coins de chasse | marge ciblage | 1ʳᵉ chute | monde mort | morts | hordes | relevés d'affamés |
|---|---|---|---|---|---|---|---|
| 2026 (celle du jeu) | 2 | 91 % | j20 | **j24** | 10 | 15 | 24 |
| 7 | 1 | 57 % | j22 | **j30** | 10 | 17 | 24 |
| 31 | 3 | 52 % | j18 | **j23** | 10 | 9 | 72 |
| 1234 | 2 | 27 % | j18 (Foyer : j6) | **j33-36** | 11 | 9 | 72 |

## Le mécanisme — l'attrition sans remplacement

**Ce n'est PAS l'économie.** Sur 2026 et 7, les villages meurent avec leurs greniers garnis
(nourriture 12-19) et leurs Feux nourris (fuel > 100) — la boucle récolte/nourrit/répare
fonctionne. La faim n'est déclencheur que sur 31 (zone du neutre pauvre en baies, famine au
j9) et n'est qu'un symptôme tardif ailleurs.

**C'est un cliquet démographique.** MESURÉ identique sur toutes les graines :
- `member_joined` = 10 — les dix fondateurs, puis plus jamais ;
- `settler_arrived` = 0 — aucun colon, jamais ;
- `refugees_arrived` = 10 groupes par saison qui passent sur les routes… `refugees_recruited`
  = **0** — les villages PNJ ne recrutent jamais (le verbe est joueur-seulement) ;
- pendant que 9 à 17 hordes par saison (+ 44 monstres ambiants sur 2026 dès le j5) prélèvent
  ~1 membre tous les 2-3 jours, définitivement.

Population fermée + pression ouverte = mort par arithmétique vers le j25, quelle que soit la
graine. Le signal de juillet (« la Meute s'auto-détruit avant J6 ») n'était pas un problème
de Meute : c'est la loi de TOUT village PNJ, que les correctifs de famine du 2026-07-24 ont
seulement retardée (l'économie tient désormais ; la démographie, non).

**Deux accélérateurs de PLACEMENT, secondaires mais réels** :
- graine 1234 : le Foyer naît sous la pression des monstres de POI — Feu affamé au j2, village
  mort au j6, sans une seule famine ;
- graine 31 : le neutre naît dans une zone sans baies — famine au j9 (le repli hors-zone du
  2026-07-24 nourrit mal un village LOIN de tout).

## Attrapé et déjà corrigé (commit `7072b00`)

**L'Arche repartait à chaque tick.** `evacuation = null` au départ re-remplissait la condition
d'ouverture : ouvre→part à chaque tick dès le j58 — 57 600 `evacuation_opened` + 57 600
`ark_departed` PAR JOUR (mesurés sur les 4 graines), embarqués recomptés en boucle au verdict
Foyer, un tirage RNG par réouverture, chronique inondée. Verrou `arkDeparted` posé (patron
`megaHordeSpawned`), test durci (215 départs sans le fix, 1 avec), revue `determinisme-sim`
au dossier. Au passage : `season_ended` tombe au jour 61 — un banc de 60 jours s'arrête une
journée trop tôt pour les verdicts ; les prochains runs vont à 62.

**Contre-vérifié in situ** (2026 rejoué à 62 jours avec le verrou) : `evacuation_opened` 1,
`ark_departed` 1, `season_ended` ×1 au jour 61 — et les cycles 1-57 sont **au bit près**
identiques au run pré-fix (hors temps mural) : le verrou est prouvé inerte avant le départ,
sur données réelles et pas seulement en revue.

## Ce qui MARCHE, mesuré au même banc

- L'économie de subsistance : greniers positifs, Feux nourris, `village_stage_up` ×5-6 par
  graine dans les premiers jours — tant qu'il y a des bras, le village vit.
- Le calendrier de saison : actes aux j21/j42, méga-horde, évacuation j55, départ j58 —
  toute la machinerie du finale se déclenche (elle joue juste devant une salle vide).
- Le coût : ~2 min/jour simulé à monde vivant (60 j ≈ 1 h 45 par graine) — les optimisations
  de horde de juillet-août tiennent sur la durée.

## Passe 1bis — l'effet du R12 (2026-08-17, décision ① tranchée et livrée)

Alexis a tranché la question ① : **les villages PNJ recrutent, plafonné à l'effectif de
fondation** (R12, commit `ddd4833`). Re-mesuré à 62 jours sur 2026 et 7 :

- **Le mécanisme marche** : 4 recrutements/saison (un par groupe survenu avant la fin du
  monde — la cadence de 6 jours est la borne), les villages tiennent à effectif PLEIN
  nettement plus longtemps (2026 : Foyer et Meute pleins au j12 contre une saignée dès le
  j5 ; 7 : Foyer plein jusqu'au j24 contre une chute au j22), la population se renouvelle
  (20 morts au lieu de 10 sur 2026 — deux générations).
- **L'issue ne change pas : effondrement vers j26-30 sur les deux graines.** L'arithmétique
  est chiffrée : réparation ~0,17 membre/jour (1 groupe de 3 tous les 6 jours, pour TROIS
  villages) contre ~0,4/jour de pertes aux hordes. **La contrainte liante est le taux
  d'échange milice/horde — la question ② devient décisive.**
- Le verrou de l'Arche tient in situ (1 ouverture, 1 départ, `season_ended` au j61, deux
  graines).

## Les décisions que ce relevé pose (à Alexis, une à la fois)

1. ~~**Les villages PNJ doivent-ils recruter les réfugiés ?**~~ **✅ TRANCHÉ ET LIVRÉ
   (2026-08-17, R12)** — voir la passe 1bis ci-dessus.
2. **La milice doit-elle pouvoir GAGNER contre une horde sans perte ?** Aujourd'hui chaque
   vague coûte ~1 membre définitif ; la question est le taux d'échange voulu.
3. **Un village qui naît sous un Repaire / dans une zone sans baies est-il un sort voulu**
   (« cette vallée était maudite ») **ou un défaut de placement** (écarter les sites à portée
   de POI hostile / exiger un minimum de baies en zone, comme `emplacementsDeVillage` sait
   déjà exiger d'autres choses) ?
4. **Un monde 100 % mort en acte III est-il un état acceptable de la Veillée ?** Le GDD veut
   des villages qui PEUVENT tomber — tous, toujours, avant la mi-saison est une autre chose.

*(Rappel : le chantier « IA-village » reste en pause et flaggé — ces questions sont des
décisions de design sur les règles, pas une réouverture de ce chantier-là.)*
