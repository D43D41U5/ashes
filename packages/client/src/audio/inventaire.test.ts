import { describe, expect, it } from 'vitest'
import { FAMILLES, INVENTAIRE, SONORES, faitsDeFamille, type FamilleId } from './inventaire'

/**
 * L'inventaire n'a de valeur que s'il est ENTIER et LISIBLE : un fait rangé dans une famille
 * qui n'existe pas disparaît du banc d'écoute, donc ne se tranche jamais — et c'est exactement
 * le trou que ce chantier vient boucher. Les gardes balaient tout l'espace (62 faits), elles
 * ne piochent pas des cas.
 */
describe('l’inventaire des 97 faits', () => {
  const ids = new Set<string>(FAMILLES.map((f) => f.id))

  it('AUCUN fait ne tombe dans une famille non déclarée (sinon il sort du banc en silence)', () => {
    expect(FAMILLES.length).toBeGreaterThan(0) // la prémisse : il y a bien des familles
    const orphelins = Object.entries(INVENTAIRE)
      .filter(([, f]) => !ids.has(f.famille))
      .map(([type, f]) => `${type} → « ${f.famille} »`)
    expect(orphelins).toEqual([])
  })

  it('les familles PARTITIONNENT les 97 faits — chacune en porte, aucune n’est vide', () => {
    const comptes = FAMILLES.map((f) => ({ id: f.id, n: faitsDeFamille(f.id).length }))
    expect(comptes.filter((c) => c.n === 0)).toEqual([]) // pas de section vide à l'écran
    const somme = comptes.reduce((t, c) => t + c.n, 0)
    expect(somme).toBe(Object.keys(INVENTAIRE).length)
    // 68 → 73 le 2026-08-18 : la Brume (5 faits, spec brume.md) ; 73 → 76 le 2026-08-19 :
    // les trois faits du blizzard (météo R9) ; 76 → 77 : `crop_frozen` (flore-froid F5) ;
    // 77 → 80 le 2026-08-21 : la pression croissante des Cendreux (`cendreux_cri`,
    // `presage_horde`, `charnier_brule` — spec 2026-08-21).
    // 80 → 81 le 2026-08-21 : `refugee_rumeur` (annales.md R12) — MUET décidé : il tombe sur
    // le même geste que `refugees_fed`, qui parle déjà. Le renseignement se LIT.
    // 81 → 82 le 2026-08-21 : `cendre_prend` (P5a) — muet aussi : souvent lointain, la perte
    // se lit et se voit.
    // 82 → 85 le 2026-08-22 : la pêche (`fish_bite`, `fish_caught`, `fish_escaped` — spec peche.md).
    // 85 → 86 le 2026-08-22 : `carcass_cut` (spec depecage.md) — la coupe, sœur du coup de récolte.
    // 86 → 90 le 2026-08-24 : la refonte de la pêche (`fish_nibble`, `fishing_cancelled`,
    // `fishing_junk`, `fish_record` — spec peche.md D9-D12).
    // 90 → 92 le 2026-08-26 : la TORCHE (spec `torche.md`) — `torche_allumee` naît MUETTE (geste
    // répété, et la lumière qui naît le dit déjà), `torche_eteinte` PARLE : c'est l'instant où la
    // nuit se referme, et le joueur ne regarde pas sa ceinture à ce moment-là.
    // 92 → 96 le 2026-08-28 : LE COIN VIVANT (faune R24/R27) — quatre faits de CARTE
    // (coin_eteint, coin_seme, coin_decouvert, coin_disparu), tous MUETS : la pastille
    // parle à l'écran, pas à l'oreille.
    // 96 → 98 au merge du même jour : les faits de l'ère loup (`loup.md`) s'y ajoutent —
    // les deux chantiers du 28 se sont croisés, l'inventaire les porte tous.
    // 98 → 99 le 2026-08-30 : `murmure_recueilli` (cendre.md R27) — silence PROVISOIRE déclaré,
    // la voix arrive avec le fantôme (R27d).
    // 99 → 100 le 2026-08-30 : `bete_cendreuse_levee` (cendre.md R30), muet décidé.
    // 100 → 103 le 2026-08-30 : la traction et le Bûcher (traction.md, cendre.md R31) —
    // `attelage_rompu` (voix : le claquement), `cadavre_rendu` (muet : ça se voit),
    // `bucher_rituel` (voix : le seul recul du monde, la seule montée).
    // 97 → 98 le 2026-08-31 : `attack_interrupted` (combat R4octies), famille `registre` —
    // il rejoint le raté et la parade, les gestes qui n'auront pas lieu.
    expect(somme).toBe(98)
  })

  it('chaque fait DIT ce qu’il raconte — pas son identifiant', () => {
    // On tranche des faits de jeu à l'oreille, pas des symboles : un `quoi` vide ou recopié
    // depuis le type (les identifiants portent des `_`, le français non) ne se lit pas.
    const muets = Object.entries(INVENTAIRE)
      .filter(([, f]) => f.quoi.trim().length < 8 || f.quoi.includes('_'))
      .map(([type]) => type)
    expect(muets).toEqual([])
  })

  it('l’état publié est bien l’état ACTUEL : 60 voix, 43 silences décidés', () => {
    // Un compte, pas un jugement. `sound.test.ts` vérifie séparément que ces 38 sonnent
    // VRAIMENT (et que les 26 se taisent vraiment) — ici on garde seulement la proportion.
    // 34 → 35 le 2026-07-29 : `node_depleted` sort du silence (l'arbre qui tombe craque).
    // 35 → 36 le 2026-07-30 : `door_toggled` naît sonore (spec construction R26) — c'est le seul
    // retour d'un geste dont l'écran ne montre presque rien.
    // 62 → 63 faits et 36 → 37 voix le 2026-07-31 : `cendreux_prowl` naît (spec cendreux R11bis).
    // 63 → 64 faits et 37 → 38 voix le 2026-07-31 : `reveil_etouffe` naît (spec cendreux R21) —
    // le feu qui étouffe un réveil est la PARADE, et une parade muette ne s'apprend pas.
    // La nuit bascule d'espèce avec les actes, et un Cendreux ne hurle pas : il lui fallait sa
    // propre voix, sinon l'acte III aurait sonné le cor du loup sur une chose qui traîne les pieds.
    // 64 → 66 faits et 38 → 39 voix le 2026-07-31 : `village_stage_up` (voix — le fait
    // saillant du chantier villages-PNJ, jumeau grave de `fire_upgraded`) et
    // `settler_arrived` (muet, comme le `member_joined` qu'il accompagne toujours).
    // 66 → 67 faits et 27 → 28 SILENCES le 2026-08-01 : `recipe_revealed` naît MUET (D2).
    // 67 → 68 faits et 39 → 40 voix le 2026-08-16 : `bird_flush` naît SONORE (forêts-vivantes §3) —
    // la nuée qui gicle est un signal de chasse, une dénonciation muette ne dénoncerait rien.
    // Une matière ramassée ouvre souvent plusieurs recettes d'un coup, et poser une station
    // en révèle une poignée dans le même tick : un son par ligne ferait une rafale. Si la
    // découverte doit s'entendre, ce sera d'UNE voix par salve — une décision à part.
    // 68 → 73 faits, 40 → 43 voix et 28 → 30 silences le 2026-08-18 : LA BRUME naît (spec
    // brume.md). L'annonce et la levée sonnent (le §9bis exige que tout se signale, et tant
    // que la nappe n'a pas de rendu l'oreille est le seul préavis), le filon a sa voix
    // (l'ouverture qui monte) ; le retrait de la nappe et celui du filon sont muets — une
    // menace qui s'en va ne sonne pas (le principe de `horde_dispersed`), et `filon_retire`
    // est un fait de plomberie client (dématérialiser le nœud), pas un moment.
    // 73 → 76 faits et 30 → 33 SILENCES le 2026-08-19 : le blizzard (météo R9) naît MUET trois
    // fois (`blizzard_annonce`/`_entre`/`_passe`) — le vent est une nappe du chantier audio
    // météo, pas un one-shot d'événement ; sa voix se décidera au banc, avec le rendu.
    // 76 → 77 faits et 43 → 44 voix le 2026-08-19 : `crop_frozen` naît SONORE (spec
    // `flore-froid.md` F5) — c'est la seule PERTE que le froid inflige, et une perte
    // silencieuse ne s'apprend pas : un joueur qui ne l'entend pas ne comprend pas
    // pourquoi sa parcelle est vide au matin. Triangle qui descend, bref et bas (une
    // rangée de parcelles gèle d'un coup).
    // 77 → 80 faits et 44 → 47 voix le 2026-08-21 : la pression croissante des Cendreux.
    // `cendreux_cri` SONNE (le seul moment où un mort a une voix — un appel muet
    // n'appellerait rien) ; `presage_horde` SONNE (le préavis de la veille est LE
    // télégraphiage, §9bis — patron de `brume_annonce`) ; `charnier_brule` SONNE (la
    // confirmation du geste — le principe de `reveil_etouffe`).
    // 82 → 85 faits et 47 → 49 voix le 2026-08-22 : LA PÊCHE (spec peche.md). `fish_bite` SONNE
    // (le télégraphe d'une fenêtre de quelques ticks — l'oreille devance l'œil), `fish_escaped`
    // SONNE (le raté qui se voit s'entend), `fish_caught` MUET (tombe sur `resource_harvested`).
    // 49 → 50 le 2026-08-22 : `carcass_cut` SONNE (depecage.md) — la coupe est la sœur du coup de
    // récolte, et le maintien n'a pas d'autre retour qu'elle.
    // 50 → 53 le 2026-08-24 : `fish_nibble`, `fishing_cancelled`, `fish_record` (peche.md
    // D9-D12) — le mordillage EST le retour d'information de D11, l'annulation dit pourquoi la
    // ligne rentre, et le record est le seul fait de pêche qui s'entend de loin.
    // 90 → 92 le 2026-08-26 : la TORCHE (spec `torche.md`) — `torche_allumee` naît MUETTE (geste
    // répété, et la lumière qui naît le dit déjà), `torche_eteinte` PARLE : c'est l'instant où la
    // nuit se referme, et le joueur ne regarde pas sa ceinture à ce moment-là.
    // 56 → 57 le 2026-08-28 : `blizzard_annonce` sort du silence (chantier audio météo) —
    // la veille est le seul télégraphe que le ciel lui-même ne peut pas donner.
    // 57 → 58 voix et 43 → 42 silences le 2026-08-30 : `murmure_recueilli` a pris sa voix
    // avec son fantôme (R27d) — le souffle qui retombe, gain plancher, à rejuger au banc.
    // 60 → 56 voix le 2026-08-30 : les réfugiés quittent le jeu (4 voix, 2 silences en moins).
    // 56 → 57 le 2026-08-31 : `attack_interrupted` — le coup brisé décide de l'échange,
    // il ne pouvait pas rester muet (voir `sound.test.ts`).
    expect(SONORES.length).toBe(57)
    // 33 → 34 le 2026-08-21 : `refugee_rumeur` naît MUET (annales.md R12) — le geste de
    // nourrir parle déjà, le renseignement se lit dans la chronique.
    // 34 → 35 le 2026-08-21 : `cendre_prend` naît MUET (P5a) — la perte se lit et se voit.
    // 35 → 36 le 2026-08-22 : `fish_caught` naît MUET (voir ci-dessus).
    // 36 → 37 le 2026-08-24 : `fishing_junk` naît MUET — il tombe sur `resource_harvested`
    // comme `fish_caught` ; deux sons pour un caillou remonté seraient un doublé.
    // 90 → 92 le 2026-08-26 : la TORCHE (spec `torche.md`) — `torche_allumee` naît MUETTE (geste
    // répété, et la lumière qui naît le dit déjà), `torche_eteinte` PARLE : c'est l'instant où la
    // nuit se referme, et le joueur ne regarde pas sa ceinture à ce moment-là.
    // 38 → 42 le 2026-08-28 : LE COIN VIVANT (faune R24/R27) — quatre faits de carte, tous
    // MUETS (coin_eteint, coin_seme, coin_decouvert, coin_disparu) : la pastille parle à
    // l'écran, pas à l'oreille.
    // 38 → 37 le même jour, autre chantier : `blizzard_annonce` a pris sa voix — `entre`/`passe`
    // restent des silences DÉCIDÉS (la nappe du vent les porte, un one-shot les doublerait).
    // Au merge des deux : 37 + 4 faits de carte muets = 41.
    // 41 → 42 le 2026-08-30 : `murmure_recueilli`, silence PROVISOIRE (sa voix arrive avec le
    // fantôme du chantier de rendu, cendre.md R27d).
    // 42 → 43 le 2026-08-30 : `bete_cendreuse_levee` (cendre.md R30), muet décidé — sa voix
    // viendra avec l'art du tertre, le lot visuel de la cendre.
    expect(Object.keys(INVENTAIRE).length - SONORES.length).toBe(41)
  })

  it('PLUS AUCUNE famille n’est entièrement muette, sauf celle qui l’est par décision', () => {
    // Le fait qui a ouvert le chantier : le social et la saison étaient des pans ENTIERS de
    // silence, et c'est le cœur du jeu. Cette garde interdit qu'on y retombe — si une famille
    // redevient muette d'un bout à l'autre, quelqu'un doit venir dire que c'est voulu.
    const muettes = FAMILLES.filter((f) => faitsDeFamille(f.id).every((x) => x.fait.voix === 'muet')).map((f) => f.id)
    expect(muettes).toEqual(['plomberie'])
  })

  it('chaque famille porte une question et une reco (le banc les affiche)', () => {
    const creuses = FAMILLES.filter((f) => !f.titre.trim() || !f.propos.trim() || !f.reco.trim()).map((f) => f.id)
    expect(creuses).toEqual([])
  })

  it('`faitsDeFamille` rend exactement les faits de la famille demandée', () => {
    for (const id of ids as Set<FamilleId>) {
      const rendus = faitsDeFamille(id)
      expect(rendus.length).toBeGreaterThan(0)
      expect(rendus.every((r) => r.fait.famille === id)).toBe(true)
    }
  })
})
