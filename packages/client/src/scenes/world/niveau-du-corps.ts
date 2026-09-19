/**
 * ═══ LA HAUTEUR À LAQUELLE ON DESSINE UN CORPS POSÉ LÀ ═══
 *
 * Sorti d'`etage-layer.ts` pour une seule raison : cette loi-là DOIT avoir ses gardes, et la
 * couche qui l'hébergeait tient un pool de sprites Phaser. Ici il n'y a que la carte, le relief
 * et deux règles — un test la construit en dix lignes.
 *
 * ⚠ **ELLE SE DÉRIVE DE LA TUILE OÙ LE CORPS EST DESSINÉ, PAS DU SEUL ENTIER DE L'AUTORITÉ —
 * et c'est le second saut, celui qui ne se voit sur aucune image fixe** (*Alexis, 2026-09-01 :
 * « il y a un saut pendant le changement d'étage »*).
 *
 * Le client dessine à la position PRÉDITE et avec l'étage de l'AUTORITÉ : `etageJoueur` n'est
 * posé qu'à la réconciliation (« la prédiction ne le calcule pas, elle le LIT », `WorldScene`).
 * Il y a donc au moins un tick entre les deux. À l'image où la position prédite quitte la rampe
 * pour le chapeau, la pente n'a plus lieu d'être et l'étage vaut encore 0 : le corps retombait
 * de tout le lift, puis remontait quand l'autorité rattrapait. **MESURÉ : 25,6 px d'aller-retour
 * pour UN tick de retard**, au moment précis du changement d'étage.
 *
 * ⚠ **CE N'EST PAS PRÉDIRE L'ÉTAGE, et la distinction est celle de l'invariant n°3.** La
 * prédiction, elle, continue de LIRE l'autorité : sa collision, son pas, son `predictionWorld`
 * ne changent pas d'un bit. Ce qu'on répond ici est une question de RENDU — *« à quelle hauteur
 * dessine-t-on un corps qui est à CET endroit ? »* — et la carte y répond seule : un corps posé
 * sur le chapeau d'une mesa ne peut être qu'à +1, la roche ne porte personne à l'étage 0.
 *
 * La règle est celle d'`etageApresLePas` de /sim, mot pour mot : *on garde l'étage qu'on nous
 * donne tant que la tuile le PORTE ; sinon on prend celui qui porte.* Deux écritures d'une même
 * loi finissent toujours par diverger — celle-ci est la même phrase, appliquée au dessin.
 *
 * Depuis les terrasses, « celui qui porte » se lit du relief : le chapeau s'il y en a un, sinon
 * le palier du sol — la hauteur à laquelle la tuile se dessine, et rien d'autre.
 */
import { connecteurAt, marchableAEtage, rampeQuiMonte, type WorldMap } from '@ashes/sim'
import { niveauSurLaRampe, palierDUneSalle } from '../../render/framing'
import type { Relief } from '../../render/relief'

export function niveauDuCorpsDessine(map: WorldMap, relief: Relief, x: number, y: number, etageAutorite: number): number {
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  // ⚠ ON DÉLÈGUE À /sim, on ne recopie pas : la MÊME `rampeQuiMonte` décide de la pente qu'on
  // dessine et du pas qu'on ralentit (`BALANCE.RAMPE_VITESSE`, `moveAvatar`). Deux écritures de
  // cette géométrie, et le corps glisserait à côté de la pente qu'il gravit.
  const pente = rampeQuiMonte(map, tx, ty)
  if (pente !== undefined) return niveauSurLaRampe(y, pente.bas, pente.haut)
  // ⚠ **LA GUEULE EST DEHORS, DANS LES DEUX SENS** (Alexis, 2026-09-14 : « on a toujours un
  // palier qui dépasse vers le bas » — `grottes.md` §4sexies).
  //
  // Sa tuile porte la salle ET le palier : `marchableAEtage` dit oui aux deux, et rendait donc
  // l'étage qu'on apportait. Le corps qui SORTAIT s'y dessinait encore sous la roche : le regard
  // ne rebasculait dehors qu'une tuile plus au sud, et la cave peignait le seuil en sol de cave,
  // un palier clair sous la façade — là où, dehors, il y a l'herbe et la tache du seuil. Elle se
  // dessine donc au palier, qu'on entre ou qu'on sorte : le regard bascule sous l'arche, et là
  // seulement. Dans la strate du palier, le corps passe sous le voile de nuit comme tout corps du
  // dehors ; dans celle du souterrain — au-dessus de ce voile —, il s'allumait en blanc la nuit.
  if (connecteurAt(map, tx, ty)?.type === 'gueule') return relief.hauteur(tx, ty)
  if (marchableAEtage(map, etageAutorite, tx, ty)) return etageAutorite
  // ⚠ **LE SEUIL D'UNE GUEULE : LA TUILE DEVANT SOI EST LA SALLE, PAS LE TOIT DE LA MASSE.**
  //
  // *(Alexis, 2026-09-06 : « mon personnage fait un saut d'un étage lorsque je rentre dans une
  // grotte, ça dure quelques frames ».)* Le repli ci-dessous est né des rampes, où « celui qui
  // porte » est toujours au-dessus. Au seuil d'un karst il ment : la tuile que la prédiction
  // vient d'atteindre est sous la TERRASSE `p + 1` (`relief.hauteur` = p + 1), alors que le
  // corps y entre par le bas. MESURÉ sur les six grottes les plus proches du spawn (graine du
  // monde joué) : sur CHACUNE, aux trois rangées derrière le seuil, le repli rendait `p + 1`
  // là où la salle est à `−(p + 1)` — lift 4 au lieu de 2, soit **32 px vers le haut, exactement
  // un étage**, pendant les quelques images où `etageJoueur` vaut encore `p`.
  //
  // La salle porte le corps dès qu'elle est SOUS LUI : une salle de niveau `n` s'ouvre sur le
  // palier `−n − 1` (G-R1), et c'est de CE palier-là qu'on franchit son seuil. On exige en plus
  // que la surface soit PLUS HAUTE que le corps — sans quoi une roche de plain-pied avec lui,
  // sous laquelle court la salle, ferait basculer le regard sous la roche à côté d'elle. (La
  // tuile de la gueule, qui est du palier et porte la salle, est réglée plus haut.)
  const salle = relief.niveauDeSalle(tx, ty)
  if (salle !== 0 && palierDUneSalle(salle) === etageAutorite && relief.hauteur(tx, ty) > etageAutorite) return salle
  return relief.hauteur(tx, ty)
}
