// Role catalogue and role distribution.
import crypto from "node:crypto";
import { TEAMS } from "../shared/constants.js";

/**
 * nightAction values:
 *  - "kill"        choose the Mafia's victim (the Parrain has the final word)
 *  - "heal"        save a player from the Mafia
 *  - "protect"     guard a player; the bodyguard dies in their place
 *  - "investigate" learn if a player is Mafia (the Parrain looks innocent)
 *  - "spy"         learn if a player is the Parrain
 *  - null          no night action
 */
export const ROLES = Object.freeze({
  boss: {
    id: "boss",
    name: "Parrain",
    team: TEAMS.MAFIA,
    emoji: "🎩",
    nightAction: "kill",
    description:
      "Tu diriges la Mafia. Ton choix de victime est final, et tu peux kidnapper un joueur qui ne pourra ni parler ni voter le lendemain. Le Détective te voit innocent.",
  },
  mafia: {
    id: "mafia",
    name: "Mafieux",
    team: TEAMS.MAFIA,
    emoji: "🔫",
    nightAction: "kill",
    description:
      "Tu proposes une victime au Parrain la nuit. Si le Parrain meurt, c'est ta voix qui décide.",
  },
  detective: {
    id: "detective",
    name: "Détective",
    team: TEAMS.CITY,
    emoji: "🔍",
    nightAction: "investigate",
    description:
      "Chaque nuit, enquête sur un joueur pour savoir s'il appartient à la Mafia. Attention : le Parrain paraît innocent.",
  },
  doctor: {
    id: "doctor",
    name: "Médecin",
    team: TEAMS.CITY,
    emoji: "💉",
    nightAction: "heal",
    description:
      "Chaque nuit, soigne un joueur (toi compris). Tu ne peux pas soigner la même personne deux nuits de suite.",
  },
  spy: {
    id: "spy",
    name: "Espion",
    team: TEAMS.CITY,
    emoji: "🕵️",
    nightAction: "spy",
    description: "Chaque nuit, observe un joueur pour savoir s'il est le Parrain.",
  },
  bodyguard: {
    id: "bodyguard",
    name: "Garde du corps",
    team: TEAMS.CITY,
    emoji: "🛡️",
    nightAction: "protect",
    description:
      "Chaque nuit, protège un autre joueur. Si la Mafia l'attaque, tu meurs à sa place.",
  },
  citizen: {
    id: "citizen",
    name: "Citoyen",
    team: TEAMS.CITY,
    emoji: "🏠",
    nightAction: null,
    description:
      "Tu n'as pas de pouvoir la nuit. Le jour, observe, débats et vote pour démasquer la Mafia.",
  },
});

export function isMafia(player) {
  return ROLES[player.role]?.team === TEAMS.MAFIA;
}

/**
 * Builds the list of roles for a given number of players.
 * 1 Mafia member per 4 players (the first is always the Parrain),
 * Détective and Médecin always, Espion from 7 players, Garde du corps from 8.
 * Example for 10 players: Parrain, Mafieux, Détective, Médecin, Espion, Garde, 4 Citoyens.
 */
export function buildRoleDeck(playerCount) {
  const mafiaCount = Math.max(1, Math.floor(playerCount / 4));
  const deck = ["boss"];
  for (let i = 1; i < mafiaCount; i++) deck.push("mafia");

  deck.push("detective", "doctor");
  if (playerCount >= 7) deck.push("spy");
  if (playerCount >= 8) deck.push("bodyguard");

  while (deck.length < playerCount) deck.push("citizen");
  return deck.slice(0, playerCount);
}

/** Fisher–Yates shuffle using a cryptographic random source (returns a new array). */
export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** The public description of a role (safe to send to the player who owns it). */
export function roleInfo(roleId) {
  const role = ROLES[roleId];
  if (!role) return null;
  const { id, name, team, emoji, description, nightAction } = role;
  return { id, name, team, emoji, description, nightAction };
}
