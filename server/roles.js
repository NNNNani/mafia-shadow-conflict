// Role catalogue and role distribution (Loup-Garou).
import crypto from "node:crypto";
import { TEAMS } from "../shared/constants.js";

/**
 * nightAction values:
 *  - "kill"        the werewolves choose a victim together
 *  - "investigate" the detective learns if a player is a werewolf
 *  - "heal"        the doctor protects a player from the werewolves
 *  - null          no night action (villager)
 */
export const ROLES = Object.freeze({
  werewolf: {
    id: "werewolf",
    name: "مستذئب",
    team: TEAMS.WOLVES,
    emoji: "🐺",
    nightAction: "kill",
    description:
      "في الليل، اختر مع باقي الذئاب ضحية. في النهار، اخفِ هويتك وأقنع القرية ببراءتك. تفوزون عندما يتساوى عددكم مع القرويين أو يفوقه.",
  },
  detective: {
    id: "detective",
    name: "المحقق",
    team: TEAMS.VILLAGE,
    emoji: "🔍",
    nightAction: "investigate",
    description: "كل ليلة، تحقّق من هوية لاعب واحد لتعرف هل هو مستذئب أم لا. استعمل المعلومة بذكاء في النقاش.",
  },
  doctor: {
    id: "doctor",
    name: "الطبيب",
    team: TEAMS.VILLAGE,
    emoji: "💉",
    nightAction: "heal",
    description: "كل ليلة، احمِ لاعباً واحداً (يمكنك حماية نفسك) من هجوم الذئاب. لا يمكنك حماية الشخص نفسه ليلتين متتاليتين.",
  },
  villager: {
    id: "villager",
    name: "قروي",
    team: TEAMS.VILLAGE,
    emoji: "🧑‍🌾",
    nightAction: null,
    description: "ليست لديك قدرة خاصة. في النهار، ناقش واتّهم وصوّت لإقصاء المستذئبين.",
  },
});

export function isWolf(player) {
  return ROLES[player.role]?.team === TEAMS.WOLVES;
}

/**
 * Builds the list of roles for a given number of players:
 * 1 werewolf per 4 players (at least 1), one Detective, one Doctor, the rest Villagers.
 * Example for 10 players: 2 werewolves, Detective, Doctor, 6 villagers.
 */
export function buildRoleDeck(playerCount) {
  const wolfCount = Math.max(1, Math.floor(playerCount / 4));
  const deck = Array(wolfCount).fill("werewolf");
  deck.push("detective", "doctor");
  while (deck.length < playerCount) deck.push("villager");
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
