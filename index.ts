import "dotenv/config";

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  ModalBuilder,
  RESTJSONErrorCodes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type Role,
  type TextBasedChannel,
} from "discord.js";

const token = mustGetEnv("DISCORD_BOT_TOKEN");
const staffChannelId = mustGetEnv("DISCORD_STAFF_CHANNEL_ID");
const fallbackResultsChannelId = mustGetEnv("DISCORD_RESULTS_CHANNEL_ID");
const botSecret = mustGetEnv("DISCORD_BOT_SECRET");
const apiBaseUrl = (process.env.LOUNGE_API_BASE_URL || "https://rr-lounge.com").replace(/\/+$/, "");
const publicSiteUrl = (process.env.PUBLIC_SITE_URL || process.env.LOUNGE_PUBLIC_SITE_URL || "https://rr-lounge.com").replace(/\/+$/, "");
const guildId = process.env.DISCORD_GUILD_ID;
const staffRoleId = process.env.DISCORD_STAFF_ROLE_ID;
const reporterRoleId = process.env.DISCORD_REPORTER_ROLE_ID || "1523691691804983306";
const rankEmojiMap = parseRankEmojiMap(process.env.DISCORD_RANK_EMOJIS);

const resultChannelIds = {
  fallback: fallbackResultsChannelId,
  rrAll: process.env.DISCORD_RESULTS_RR_ALL_CHANNEL_ID,
  rrTier1: process.env.DISCORD_RESULTS_RR_TIER_1_CHANNEL_ID,
  rrTier2: process.env.DISCORD_RESULTS_RR_TIER_2_CHANNEL_ID,
  rrAll32: process.env.DISCORD_RESULTS_RR_ALL_32_TRACKS_CHANNEL_ID,
  rrLegend: process.env.DISCORD_RESULTS_RR_LEGEND_CHANNEL_ID,
  rrMaster: process.env.DISCORD_RESULTS_RR_MASTER_CHANNEL_ID,
  rrSquadQueue: process.env.DISCORD_RESULTS_RR_SQ_CHANNEL_ID,
  ctAll: process.env.DISCORD_RESULTS_CT_ALL_CHANNEL_ID,
  ttAll: process.env.DISCORD_RESULTS_TT_ALL_CHANNEL_ID,
};

const SUBMIT_COMMAND_NAME = "submit_mogi";
const ADJUST_COMMAND_NAME = "adjust_mmr";
const SUBMIT_MODAL_PREFIX = "submit_mogi_modal:";
const APPROVE_PREFIX = "approve_mogi:";
const REJECT_PREFIX = "reject_mogi:";
const REJECT_MODAL_PREFIX = "reject_mogi_modal:";
const PENALTY_PREFIX = "penalty_mogi:";
const PENALTY_MODAL_PREFIX = "penalty_mogi_modal:";
const PENALTIES_FIELD_NAME = "Penalties";

type Ladder = "RR" | "CT" | "TT";

type TierChoice = { name: string; value: string };

const RR_TIER_CHOICES = [
  { name: "All", value: "All" },
  { name: "1", value: "1" },
  { name: "2", value: "2" },
  { name: "All 32-Tracks", value: "All 32-Tracks" },
  { name: "Legend", value: "Legend" },
  { name: "Master", value: "Master" },
  { name: "Squad Queue", value: "Squad Queue" },
] as const satisfies readonly TierChoice[];

const CT_TIER_CHOICES = [
  { name: "All", value: "All" },
] as const satisfies readonly TierChoice[];

const TT_TIER_CHOICES = [
  { name: "All", value: "All" },
] as const satisfies readonly TierChoice[];

type SubmissionResponse = {
  error?: string;
  eventNumber?: number;
  format?: string;
  raceCount?: number;
  roomNumber?: number | null;
  submissionId?: string;
  tableImageBase64?: string;
  tier?: string | null;
};

type RankChange = {
  direction?: "promoted" | "demoted" | null;
  discordId?: string | null;
  playerName?: string;
  previousRankName?: string | null;
  rankName?: string | null;
};

type ApproveResponse = {
  error?: string;
  eventNumber?: number;
  format?: string;
  mmrImageBase64?: string;
  mogiId?: string;
  mogiUrl?: string;
  raceCount?: number;
  roomNumber?: number | null;
  rankChanges?: RankChange[];
  tableImageBase64?: string;
  tier?: string | null;
};

type MogiPenalty = {
  name: string;
  penalty: number;
};

type AdjustmentResponse = {
  adjustmentId?: string;
  amount?: number;
  error?: string;
  mmrAfter?: number;
  mmrBefore?: number;
  playerName?: string;
  playerUrl?: string;
  seasonCategory?: string;
  seasonName?: string;
};

type SendableTextChannel = TextBasedChannel & {
  send(options: string | MessageCreateOptions): Promise<unknown>;
};

const rankRoleMaps: Record<Ladder, Map<string, string>> = {
  RR: parseRankRoleMap(process.env.DISCORD_RR_RANK_ROLES),
  CT: parseRankRoleMap(process.env.DISCORD_CT_RANK_ROLES),
  TT: parseRankRoleMap(process.env.DISCORD_TT_RANK_ROLES),
};

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeLadder(value: string | null | undefined): Ladder {
  const normalized = value?.toUpperCase();
  if (normalized === "CT") return "CT";
  if (normalized === "TT") return "TT";
  return "RR";
}

function parseOptionalInteger(value: string, fallback: number | null): number | null {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function formatLabel(format?: string): string {
  if (!format) return "-";
  if (format === "FFA") return "FFA";
  const match = format.match(/TEAMS_(\d+)/);
  return match ? `${match[1]}v${match[1]}` : format;
}

function displayTier(tier: string | null | undefined): string {
  const trimmed = tier?.trim() || "All";
  const withoutRepeatedLabel = trimmed.replace(/\btier\b/gi, " ").replace(/\s+/g, " ").trim();
  return withoutRepeatedLabel || "All";
}

function tierChoicesForLadder(ladder: Ladder): readonly TierChoice[] {
  if (ladder === "CT") return CT_TIER_CHOICES;
  if (ladder === "TT") return TT_TIER_CHOICES;
  return RR_TIER_CHOICES;
}

function tierMatchesChoice(ladder: Ladder, tier: string): boolean {
  const normalized = tier.toLowerCase().trim();
  return tierChoicesForLadder(ladder).some(
    (choice) => choice.value.toLowerCase() === normalized
  );
}

function tierChoicesForAutocomplete(ladder: Ladder, query: string): TierChoice[] {
  const normalizedQuery = query.toLowerCase().trim();
  return tierChoicesForLadder(ladder)
    .filter((choice) => choice.name.toLowerCase().includes(normalizedQuery))
    .slice(0, 25);
}

function parseSignedAmount(value: string | null | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 100000) return null;
  return amount;
}

function signedAmountLabel(amount: number): string {
  return `${amount > 0 ? "+" : ""}${amount}`;
}

function roomLabel(roomNumber: number | null | undefined): string {
  return Number.isInteger(roomNumber) ? `Room ${roomNumber}` : "-";
}

function parsePenaltyText(value: string | null | undefined): { penalties: MogiPenalty[] } | { error: string } {
  const raw = value?.trim() ?? "";
  if (!raw || raw === "-") return { penalties: [] };

  const penaltiesByName = new Map<string, MogiPenalty>();
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(.+?)(?:\s*[:=,]\s*|\s+)([+-]?\d+)$/);
    if (!match) {
      return {
        error: `Couldn't read penalty line "${line}". Use one per line, like: haunted doll -100`,
      };
    }

    const name = match[1]?.trim();
    const amount = parseSignedAmount(match[2]);
    if (!name) return { error: "Each penalty needs a player name." };
    if (!amount) {
      return { error: `Penalty for "${name}" must look like 100 or -100, and cannot be 0.` };
    }

    const key = compactName(name) || name.toLowerCase();
    const existing = penaltiesByName.get(key);
    if (existing) {
      existing.penalty += Math.abs(amount);
    } else {
      penaltiesByName.set(key, { name, penalty: Math.abs(amount) });
    }
  }

  return { penalties: Array.from(penaltiesByName.values()) };
}

function formatPenalties(penalties: MogiPenalty[]): string {
  if (penalties.length === 0) return "-";
  return penalties.map((penalty) => `${penalty.name} -${penalty.penalty}`).join("\n");
}

function penaltyFieldValue(interaction: ButtonInteraction): string {
  return embedField(interaction, PENALTIES_FIELD_NAME);
}

function encodeCustomIdPart(value: string): string {
  return encodeURIComponent(value);
}

function decodeCustomIdPart(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function eventIdLabel(value: number | string | null | undefined): string {
  if (value == null || value === "") return "-";
  return String(value);
}

function publicUrl(value: string): string {
  try {
    const url = new URL(value);
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) {
      return `${publicSiteUrl}${url.pathname}${url.search}${url.hash}`;
    }
    return value;
  } catch {
    return value;
  }
}

function compactName(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function rankEmojiCandidates(rankName: string | null | undefined): string[] {
  const normalized = compactName(rankName);
  const withoutTrailingNumber = normalized.replace(/\d+$/, "");
  return Array.from(new Set([normalized, withoutTrailingNumber].filter(Boolean)));
}

function playerSearchQueries(playerName: string): string[] {
  const words = playerName
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .sort((a, b) => b.length - a.length);

  return Array.from(new Set([playerName, ...words].filter((query) => query.trim())));
}

function parseRankEmojiMap(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!value) return map;

  for (const entry of value.split(",")) {
    const [rawRankName, ...rawEmojiParts] = entry.split("=");
    const emoji = rawEmojiParts.join("=").trim();
    if (!rawRankName?.trim() || !emoji) continue;

    for (const key of rankEmojiCandidates(rawRankName)) {
      map.set(key, emoji);
    }
  }

  return map;
}

function roleIdFrom(value: string): string | null {
  return value.match(/\d{15,25}/)?.[0] ?? null;
}

function parseRankRoleMap(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!value) return map;

  for (const entry of value.split(",")) {
    const [rawRankName, ...rawRoleParts] = entry.split("=");
    const roleId = roleIdFrom(rawRoleParts.join("=").trim());
    if (!rawRankName?.trim() || !roleId) continue;

    for (const key of rankEmojiCandidates(rawRankName)) {
      map.set(key, roleId);
    }
  }

  return map;
}

function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a[0] === b[0] ? 0.25 : 0;

  const counts = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index++) {
    const pair = a.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }

  let matches = 0;
  for (let index = 0; index < b.length - 1; index++) {
    const pair = b.slice(index, index + 2);
    const count = counts.get(pair) ?? 0;
    if (count <= 0) continue;
    counts.set(pair, count - 1);
    matches++;
  }

  return (2 * matches) / (a.length + b.length - 2);
}

function memberNames(member: GuildMember): string[] {
  return [
    member.displayName,
    member.nickname,
    member.user.globalName,
    member.user.username,
    member.user.tag,
  ].filter((value): value is string => Boolean(value));
}

function memberMatchScore(playerName: string, member: GuildMember): number {
  const query = compactName(playerName);
  if (!query) return 0;

  return Math.max(
    ...memberNames(member).map((name) => {
      const candidate = compactName(name);
      if (!candidate) return 0;
      if (candidate === query) return 100;
      if (candidate.startsWith(query) || query.startsWith(candidate)) return 90 - Math.abs(candidate.length - query.length);
      if (candidate.includes(query) || query.includes(candidate)) return 80 - Math.abs(candidate.length - query.length) / 2;
      return Math.round(diceCoefficient(query, candidate) * 70);
    })
  );
}

async function findClosestMemberByPlayerName(
  guild: Guild | null,
  playerName: string | null | undefined
): Promise<GuildMember | null> {
  const trimmedName = playerName?.trim();
  if (!guild || !trimmedName) return null;

  const candidates = new Map<string, GuildMember>();
  for (const member of guild.members.cache.values()) {
    if (memberMatchScore(trimmedName, member) >= 45) candidates.set(member.id, member);
  }

  for (const query of playerSearchQueries(trimmedName)) {
    const results = await guild.members.search({ query, limit: 25 }).catch(() => null);
    results?.forEach((member) => candidates.set(member.id, member));
  }

  let best: { member: GuildMember; score: number } | null = null;
  for (const member of candidates.values()) {
    const score = memberMatchScore(trimmedName, member);
    if (!best || score > best.score) best = { member, score };
  }

  return best?.member ?? null;
}

async function rankEmojiFor(rankName: string | null | undefined, guild: Guild | null): Promise<string> {
  const keys = rankEmojiCandidates(rankName);
  if (keys.length === 0) return "";

  for (const key of keys) {
    const configuredEmoji = rankEmojiMap.get(key);
    if (configuredEmoji) return configuredEmoji;
  }

  if (!guild) return "";
  const emojis = await guild.emojis.fetch().catch(() => guild.emojis.cache);
  const emoji = emojis.find((candidate) => {
    const emojiKey = rankEmojiCandidates(candidate.name)[0];
    return keys.includes(emojiKey);
  });

  return emoji?.toString() ?? "";
}

function configuredRankRoleId(ladder: Ladder, rankName: string | null | undefined): string | null {
  for (const key of rankEmojiCandidates(rankName)) {
    const roleId = rankRoleMaps[ladder].get(key);
    if (roleId) return roleId;
  }
  return null;
}

function automaticRankRoleScore(ladder: Ladder, rankName: string, role: Role): number {
  if (role.managed) return 0;
  const roleName = compactName(role.name);
  const ladderName = compactName(ladder);
  const rankKeys = rankEmojiCandidates(rankName);
  if (!roleName || rankKeys.length === 0) return 0;

  for (const rankKey of rankKeys) {
    if (roleName === `${ladderName}${rankKey}` || roleName === `${rankKey}${ladderName}`) return 100;
    if (roleName === `${ladderName}rank${rankKey}` || roleName === `${rankKey}${ladderName}rank`) return 95;
    if (roleName.includes(ladderName) && roleName.includes(rankKey)) return 80;
  }

  return 0;
}

async function rankRoleFor(ladder: Ladder, rankName: string | null | undefined, guild: Guild | null): Promise<Role | null> {
  const trimmedRank = rankName?.trim();
  if (!guild || !trimmedRank) return null;

  const configuredRoleId = configuredRankRoleId(ladder, trimmedRank);
  if (configuredRoleId) {
    const configuredRole = await guild.roles.fetch(configuredRoleId).catch(() => null);
    if (configuredRole) return configuredRole;
  }

  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  let best: { role: Role; score: number } | null = null;
  for (const role of roles.values()) {
    const score = automaticRankRoleScore(ladder, trimmedRank, role);
    if (!best || score > best.score) best = { role, score };
  }

  return best && best.score > 0 ? best.role : null;
}

async function syncMemberRankRole(
  member: GuildMember,
  ladder: Ladder,
  previousRankName: string | null | undefined,
  nextRankName: string | null | undefined
): Promise<void> {
  try {
    const nextRole = await rankRoleFor(ladder, nextRankName, member.guild);
    const previousRole = await rankRoleFor(ladder, previousRankName, member.guild);
    const roleIdsToRemove = new Set<string>();

    if (previousRole && previousRole.id !== nextRole?.id && member.roles.cache.has(previousRole.id)) {
      roleIdsToRemove.add(previousRole.id);
    }

    for (const roleId of rankRoleMaps[ladder].values()) {
      if (roleId !== nextRole?.id && member.roles.cache.has(roleId)) roleIdsToRemove.add(roleId);
    }

    if (roleIdsToRemove.size > 0) {
      await member.roles.remove(Array.from(roleIdsToRemove), `Retro Rewind ${ladder} rank update`);
    }

    if (nextRole && !member.roles.cache.has(nextRole.id)) {
      await member.roles.add(nextRole, `Retro Rewind ${ladder} rank update`);
    }
  } catch (error) {
    console.warn(
      `Could not update ${ladder} rank role for ${member.user.tag} (${member.id})`,
      error instanceof Error ? error.message : error
    );
  }
}

async function buildRankChangeNotice(
  changes: RankChange[] | undefined,
  guild: Guild | null,
  ladder: Ladder
): Promise<MessageCreateOptions | null> {
  const lines: string[] = [];
  const users = new Set<string>();

  for (const change of changes ?? []) {
    if (!change.direction || !change.rankName || !change.playerName) continue;
    const member = await findClosestMemberByPlayerName(guild, change.playerName);
    if (member) await syncMemberRankRole(member, ladder, change.previousRankName, change.rankName);
    const emoji = await rankEmojiFor(change.rankName, guild);
    const playerLabel = member ? `<@${member.id}>` : `@${change.playerName}`;
    const fallbackRank = emoji ? "" : ` ${change.rankName}`;
    lines.push(`${playerLabel}${emoji ? ` ${emoji}` : fallbackRank}`);
    if (member) users.add(member.id);
  }

  if (lines.length === 0) return null;
  return {
    content: lines.join("\n"),
    allowedMentions: { users: Array.from(users) },
  };
}

function normalizeTierKey(tier: string | null | undefined): "all" | "1" | "2" | "all32" | "legend" | "master" | "squad" {
  const normalized = (tier || "").toLowerCase().trim();
  if (/32/.test(normalized)) return "all32";
  if (/\blegend\b/.test(normalized)) return "legend";
  if (/\bmaster\b/.test(normalized)) return "master";
  if (/\bsquad\s*queue\b/.test(normalized)) return "squad";
  if (!normalized || /\ball\b/.test(normalized)) return "all";
  if (/(^|\D)1(\D|$)|\bt1\b|\btier\s*1\b/.test(normalized)) return "1";
  if (/(^|\D)2(\D|$)|\bt2\b|\btier\s*2\b/.test(normalized)) return "2";
  return "all";
}

function resultChannelIdFor(ladder: Ladder, tier: string | null | undefined): string {
  const tierKey = normalizeTierKey(tier);

  if (ladder === "TT") {
    return resultChannelIds.ttAll || resultChannelIds.fallback;
  }

  if (ladder === "CT") {
    return resultChannelIds.ctAll || resultChannelIds.fallback;
  }

  if (tierKey === "1") return resultChannelIds.rrTier1 || resultChannelIds.rrAll || resultChannelIds.fallback;
  if (tierKey === "2") return resultChannelIds.rrTier2 || resultChannelIds.rrAll || resultChannelIds.fallback;
  if (tierKey === "all32") return resultChannelIds.rrAll32 || resultChannelIds.rrAll || resultChannelIds.fallback;
  if (tierKey === "legend") return resultChannelIds.rrLegend || resultChannelIds.rrAll || resultChannelIds.fallback;
  if (tierKey === "master") return resultChannelIds.rrMaster || resultChannelIds.rrAll || resultChannelIds.fallback;
  if (tierKey === "squad") return resultChannelIds.rrSquadQueue || resultChannelIds.rrAll || resultChannelIds.fallback;
  return resultChannelIds.rrAll || resultChannelIds.fallback;
}

function hasStaffPermission(
  interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction
): boolean {
  if (!staffRoleId) return true;
  const member = interaction.member as GuildMember | null;
  return Boolean(member?.roles.cache.has(staffRoleId));
}

function hasSubmitPermission(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member as GuildMember | null;
  if (!member) return false;
  if (reporterRoleId && member.roles.cache.has(reporterRoleId)) return true;
  if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;
  return !reporterRoleId && !staffRoleId;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-discord-bot-secret": botSecret,
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `API request failed (${response.status}).`);
  }
  return data;
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `API request failed (${response.status}).`);
  }
  return data;
}

async function playerAutocompleteChoices(query: string): Promise<TierChoice[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  const data = await apiGet<{ players?: { id: string; name: string }[] }>(
    `/api/stats/players${params.size ? `?${params}` : ""}`
  );

  return (data.players ?? []).slice(0, 25).map((player) => ({
    name: player.name.slice(0, 100),
    value: player.name.slice(0, 100),
  }));
}

async function getTextChannel(client: Client, channelId: string): Promise<SendableTextChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error(`Channel ${channelId} is not a sendable text channel.`);
  }
  return channel as SendableTextChannel;
}

async function deleteStaffReviewMessage(client: Client, messageId: string | null | undefined): Promise<void> {
  if (!messageId) return;
  const channel = await client.channels.fetch(staffChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel)) return;
  await channel.messages.delete(messageId).catch(() => {});
}

async function fetchStaffReviewMessage(client: Client, messageId: string | null | undefined) {
  if (!messageId) return null;
  const channel = await client.channels.fetch(staffChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel)) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function registerCommands(client: Client): Promise<void> {
  const submitCommand = new SlashCommandBuilder()
    .setName(SUBMIT_COMMAND_NAME)
    .setDescription("Submit a mogi table for updater approval")
    .addStringOption((option) =>
      option
        .setName("ladder")
        .setDescription("Which ladder this table belongs to")
        .setRequired(true)
        .addChoices({ name: "RR", value: "RR" }, { name: "CT", value: "CT" }, { name: "TT", value: "TT" })
    )
    .addStringOption((option) =>
      option
        .setName("tier")
        .setDescription("Which tier this mogi belongs to")
        .setRequired(true)
        .setAutocomplete(true)
    );
  const adjustCommand = new SlashCommandBuilder()
    .setName(ADJUST_COMMAND_NAME)
    .setDescription("Give a player a manual MMR penalty or adjustment")
    .addStringOption((option) =>
      option
        .setName("ladder")
        .setDescription("Which ladder to adjust")
        .setRequired(true)
        .addChoices({ name: "RR", value: "RR" }, { name: "CT", value: "CT" }, { name: "TT", value: "TT" })
    )
    .addStringOption((option) =>
      option
        .setName("player")
        .setDescription("Leaderboard player name")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("amount")
        .setDescription("Use +100 for an adjustment or -100 for a penalty")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Optional reason shown on the player page")
        .setRequired(false)
    );
  const commands = [submitCommand, adjustCommand];

  if (guildId) {
    const guild = await client.guilds.fetch(guildId);
    await guild.commands.set(commands);
    console.log(`Registered updater commands in guild ${guildId}`);
    return;
  }

  if (!client.application) throw new Error("Discord application is not ready.");
  await client.application.commands.set(commands);
  console.log("Registered global updater commands");
}

function buildSubmitModal(ladder: Ladder, tier: string): ModalBuilder {
  const tableText = new TextInputBuilder()
    .setCustomId("tableText")
    .setLabel("Final table text")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000);

  const races = new TextInputBuilder()
    .setCustomId("raceCount")
    .setLabel("Race count")
    .setPlaceholder("12")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2);

  const room = new TextInputBuilder()
    .setCustomId("roomNumber")
    .setLabel("Room number")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  const notes = new TextInputBuilder()
    .setCustomId("notes")
    .setLabel("Notes")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  return new ModalBuilder()
    .setCustomId(`${SUBMIT_MODAL_PREFIX}${ladder}:${encodeCustomIdPart(tier)}`)
    .setTitle(`Submit ${ladder} ${displayTier(tier)}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(tableText),
      new ActionRowBuilder<TextInputBuilder>().addComponents(races),
      new ActionRowBuilder<TextInputBuilder>().addComponents(room),
      new ActionRowBuilder<TextInputBuilder>().addComponents(notes)
    );
}

function reviewButtons(submissionId: string, disabled = false) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${APPROVE_PREFIX}${submissionId}`)
        .setLabel("Approve")
        .setEmoji("\u2705")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${PENALTY_PREFIX}${submissionId}`)
        .setLabel("Add penalty")
        .setEmoji("\u26A0\uFE0F")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${REJECT_PREFIX}${submissionId}`)
        .setLabel("Reject")
        .setEmoji("\u274C")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    ),
  ];
}

function embedField(interaction: ButtonInteraction, name: string): string {
  const field = interaction.message.embeds[0]?.fields.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase()
  );
  return field?.value ?? "";
}

function embedWithUpdatedField(
  originalEmbed: ButtonInteraction["message"]["embeds"][number],
  name: string,
  value: string,
  inline = false
): EmbedBuilder {
  const embed = EmbedBuilder.from(originalEmbed.toJSON());
  const fields = originalEmbed.fields.map((field) => ({
    name: field.name,
    value: field.value,
    inline: field.inline,
  }));
  const existingIndex = fields.findIndex(
    (field) => field.name.toLowerCase() === name.toLowerCase()
  );

  if (existingIndex >= 0) {
    fields[existingIndex] = { name, value, inline };
  } else {
    fields.push({ name, value, inline });
  }

  embed.setFields(fields);
  return embed;
}

function parseSubmitModalCustomId(customId: string): { ladder: Ladder; tier: string } {
  const [ladderValue, tierValue] = customId.slice(SUBMIT_MODAL_PREFIX.length).split(":");
  return {
    ladder: normalizeLadder(ladderValue),
    tier: displayTier(decodeCustomIdPart(tierValue)),
  };
}

async function handleSubmitModal(
  interaction: ModalSubmitInteraction,
  ladder: Ladder,
  tier: string
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const sourceText = interaction.fields.getTextInputValue("tableText");
  const notes = interaction.fields.getTextInputValue("notes").trim();
  const raceCount = parseOptionalInteger(interaction.fields.getTextInputValue("raceCount"), 12);
  const roomNumber = parseOptionalInteger(interaction.fields.getTextInputValue("roomNumber"), null);

  if (!Number.isInteger(raceCount) || raceCount == null || raceCount < 1 || raceCount > 99) {
    await interaction.editReply("Race count must be a number between 1 and 99.");
    return;
  }
  if (Number.isNaN(roomNumber) || (roomNumber != null && (roomNumber < 1 || roomNumber > 99))) {
    await interaction.editReply("Room number must be blank or a whole number between 1 and 99.");
    return;
  }
  if (tier.toLowerCase() === "squad queue" && roomNumber == null) {
    await interaction.editReply("Squad Queue submissions need a room number.");
    return;
  }

  const submission = await apiPost<SubmissionResponse>("/api/discord/submissions", {
    sourceText,
    category: ladder,
    tier,
    notes: [notes, `Discord ladder: ${ladder}`].filter(Boolean).join("\n"),
    raceCount,
    roomNumber,
    submittedByDiscordId: interaction.user.id,
    submittedFromChannelId: interaction.channelId,
  });

  if (!submission.submissionId || !submission.tableImageBase64) {
    throw new Error(submission.error || "Submission API did not return a table image.");
  }

  const tierLabel = displayTier(submission.tier || tier);
  const eventId = eventIdLabel(submission.eventNumber);
  const destinationId = resultChannelIdFor(ladder, tierLabel);
  const image = new AttachmentBuilder(Buffer.from(submission.tableImageBase64, "base64"), {
    name: "mogi-table.png",
  });
  const embed = new EmbedBuilder()
    .setAuthor({ name: "Updater Automation" })
    .setTitle("Mogi Table")
    .setDescription("Check this update, then approve it if everything looks right.")
    .setColor(0xed4245)
    .addFields(
      { name: "Submission ID", value: eventId, inline: true },
      { name: "Ladder", value: ladder, inline: true },
      { name: "Tier", value: tierLabel, inline: true },
      { name: "Room", value: roomLabel(submission.roomNumber ?? roomNumber), inline: true },
      { name: "Races Played", value: String(submission.raceCount ?? raceCount), inline: true },
      { name: "Submitted by", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Posts to", value: `<#${destinationId}>`, inline: true },
      { name: PENALTIES_FIELD_NAME, value: "-", inline: false }
    )
    .setImage("attachment://mogi-table.png")
    .setTimestamp();

  const staffChannel = await getTextChannel(interaction.client, staffChannelId);
  await staffChannel.send({
    embeds: [embed],
    files: [image],
    components: reviewButtons(submission.submissionId),
  });

  await interaction.editReply("Submitted for updater review.");
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);

  if (interaction.commandName === SUBMIT_COMMAND_NAME && focused.name === "tier") {
    const ladder = normalizeLadder(interaction.options.getString("ladder"));
    await interaction.respond(
      tierChoicesForAutocomplete(ladder, String(focused.value)).map((choice) => ({
        name: choice.name,
        value: choice.value,
      }))
    );
    return;
  }

  if (interaction.commandName === ADJUST_COMMAND_NAME && focused.name === "player") {
    try {
      await interaction.respond(await playerAutocompleteChoices(String(focused.value)));
    } catch (error) {
      console.error("Player autocomplete failed", error);
      await interaction.respond([]);
    }
  }
}

async function handleAdjustmentCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!hasStaffPermission(interaction)) {
    await interaction.reply({
      content: "You do not have permission to adjust MMR.",
      ephemeral: true,
    });
    return;
  }

  const ladder = normalizeLadder(interaction.options.getString("ladder"));
  const playerName = interaction.options.getString("player", true).trim();
  const amountText = interaction.options.getString("amount", true);
  const amount = parseSignedAmount(amountText);
  const reason = interaction.options.getString("reason")?.trim() || undefined;

  if (!amount) {
    await interaction.reply({
      content: "Amount must look like `+100` or `-100` and cannot be 0.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await apiPost<AdjustmentResponse>("/api/discord/adjustments", {
    adjustedByDiscordId: interaction.user.id,
    amount,
    category: ladder,
    playerName,
    reason,
  });

  if (!result.playerName || result.mmrBefore == null || result.mmrAfter == null) {
    throw new Error(result.error || "Adjustment API did not return the updated MMR.");
  }

  const amountLabel = signedAmountLabel(amount);
  const playerLink = result.playerUrl
    ? `[${result.playerName}](${publicUrl(result.playerUrl)})`
    : result.playerName;
  const summary = `${ladder} ${amountLabel} adjustment added for ${playerLink}: ${result.mmrBefore} → ${result.mmrAfter}`;

  await interaction.editReply(summary);

  const staffChannel = await getTextChannel(interaction.client, staffChannelId);
  await staffChannel.send({
    content: [
      `Manual ${ladder} MMR ${amount > 0 ? "adjustment" : "penalty"} added.`,
      `Player: ${playerLink}`,
      `Amount: ${amountLabel}`,
      `MMR: ${result.mmrBefore} → ${result.mmrAfter}`,
      `Updated by: <@${interaction.user.id}>`,
      reason ? `Reason: ${reason}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    allowedMentions: { users: [interaction.user.id] },
  });
}

async function handlePenaltyButton(interaction: ButtonInteraction, submissionId: string): Promise<void> {
  if (!hasStaffPermission(interaction)) {
    await interaction.reply({ content: "You do not have permission to add mogi penalties.", ephemeral: true });
    return;
  }

  const currentPenalties = penaltyFieldValue(interaction);
  const penaltiesInput = new TextInputBuilder()
    .setCustomId("penalties")
    .setLabel("Penalties, one per line")
    .setPlaceholder("haunted doll -100\nZenny -50")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  if (currentPenalties && currentPenalties !== "-") {
    penaltiesInput.setValue(currentPenalties);
  }

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${PENALTY_MODAL_PREFIX}${submissionId}:${interaction.message.id}`)
      .setTitle("Add mogi penalties")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(penaltiesInput))
  );
}

function parsePenaltyModalCustomId(customId: string): { submissionId: string; messageId: string } {
  const [submissionId = "", messageId = ""] = customId.slice(PENALTY_MODAL_PREFIX.length).split(":");
  return { submissionId, messageId };
}

async function handlePenaltyModal(
  interaction: ModalSubmitInteraction,
  submissionId: string,
  messageId: string
): Promise<void> {
  if (!hasStaffPermission(interaction)) {
    await interaction.reply({ content: "You do not have permission to add mogi penalties.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const parsed = parsePenaltyText(interaction.fields.getTextInputValue("penalties"));
  if ("error" in parsed) {
    await interaction.editReply(parsed.error);
    return;
  }

  const message = await fetchStaffReviewMessage(interaction.client, messageId);
  const embed = message?.embeds[0];
  if (!message || !embed) {
    await interaction.editReply("I couldn't find the pending submission message to update.");
    return;
  }

  await message.edit({
    embeds: [
      embedWithUpdatedField(
        embed,
        PENALTIES_FIELD_NAME,
        formatPenalties(parsed.penalties),
        false
      ),
    ],
    components: reviewButtons(submissionId),
  });

  await interaction.editReply(
    parsed.penalties.length
      ? `Saved ${parsed.penalties.length} penalty${parsed.penalties.length === 1 ? "" : "ies"}.`
      : "Penalties cleared."
  );
}

async function handleApprove(interaction: ButtonInteraction, submissionId: string): Promise<void> {
  if (!hasStaffPermission(interaction)) {
    await interaction.reply({ content: "You do not have permission to approve mogis.", ephemeral: true });
    return;
  }

  const ladder = normalizeLadder(embedField(interaction, "Ladder"));
  const tier = embedField(interaction, "Tier") || "All";
  const destinationId = resultChannelIdFor(ladder, tier);
  const parsedPenalties = parsePenaltyText(penaltyFieldValue(interaction));
  if ("error" in parsedPenalties) {
    await interaction.reply({ content: parsedPenalties.error, ephemeral: true });
    return;
  }
  const penalties = parsedPenalties.penalties;

  await interaction.deferReply({ ephemeral: true });
  const result = await apiPost<ApproveResponse>(`/api/discord/submissions/${submissionId}/approve`, {
    approvedByDiscordId: interaction.user.id,
    penalties,
  });

  if (!result.mogiId || !result.mogiUrl || !result.tableImageBase64 || !result.mmrImageBase64) {
    throw new Error(result.error || "Approval API did not return the result images.");
  }

  const approvedTier = displayTier(result.tier || tier);
  const approvedRoom =
    result.roomNumber == null
      ? embedField(interaction, "Room") || "-"
      : roomLabel(result.roomNumber);
  const approvedEventId = eventIdLabel(result.eventNumber ?? result.mogiId);
  const mogiUrl = publicUrl(result.mogiUrl);
  const tableImage = new AttachmentBuilder(Buffer.from(result.tableImageBase64, "base64"), {
    name: "result-table.png",
  });
  const mmrImage = new AttachmentBuilder(Buffer.from(result.mmrImageBase64, "base64"), {
    name: "mmr-table.png",
  });
  const resultFields = [
    { name: "Event ID", value: `[${approvedEventId}](${mogiUrl})`, inline: true },
    { name: "Tier", value: approvedTier, inline: true },
    { name: "Room", value: approvedRoom, inline: true },
    { name: "Races Played", value: String(result.raceCount ?? "-"), inline: true },
    { name: "Approved by", value: `<@${interaction.user.id}>`, inline: true },
    { name: "View on website", value: `[Message](${mogiUrl})`, inline: true },
  ];
  if (penalties.length > 0) {
    resultFields.push({ name: PENALTIES_FIELD_NAME, value: formatPenalties(penalties), inline: false });
  }
  const resultEmbed = new EmbedBuilder()
    .setAuthor({ name: "Updater Automation" })
    .setTitle("Result Table")
    .setColor(0xed4245)
    .addFields(resultFields)
    .setImage("attachment://result-table.png")
    .setTimestamp();

  const mmrEmbed = new EmbedBuilder()
    .setTitle("MMR Table")
    .setColor(0x2f80ed)
    .addFields(
      { name: "Event ID", value: `[${approvedEventId}](${mogiUrl})`, inline: true },
      { name: "Tier", value: approvedTier, inline: true },
      { name: "Updated by", value: `<@${interaction.user.id}>`, inline: true }
    )
    .setImage("attachment://mmr-table.png")
    .setTimestamp();

  const resultsChannel = await getTextChannel(interaction.client, destinationId);
  await resultsChannel.send({ embeds: [resultEmbed], files: [tableImage] });
  await resultsChannel.send({ embeds: [mmrEmbed], files: [mmrImage] });
  const rankNotice = await buildRankChangeNotice(result.rankChanges, interaction.guild, ladder);
  if (rankNotice) {
    await resultsChannel.send(rankNotice);
  }
  await interaction.message.delete().catch(() => {});
  await interaction.editReply(`Approved event ${approvedEventId} and posted in <#${destinationId}>: ${mogiUrl}`);
}

async function handleRejectButton(interaction: ButtonInteraction, submissionId: string): Promise<void> {
  if (!hasStaffPermission(interaction)) {
    await interaction.reply({ content: "You do not have permission to reject mogis.", ephemeral: true });
    return;
  }

  const reason = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Reject reason")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(
        `${REJECT_MODAL_PREFIX}${submissionId}:${interaction.message.id}:${encodeCustomIdPart(
          eventIdLabel(embedField(interaction, "Submission ID"))
        )}`
      )
      .setTitle("Reject mogi")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason))
  );
}

function parseRejectModalCustomId(customId: string): {
  submissionId: string;
  messageId: string;
  eventId: string;
} {
  const [submissionId = "", messageId = "", eventId = ""] = customId
    .slice(REJECT_MODAL_PREFIX.length)
    .split(":");

  return {
    submissionId,
    messageId,
    eventId: decodeCustomIdPart(eventId),
  };
}

async function handleRejectModal(
  interaction: ModalSubmitInteraction,
  submissionId: string,
  messageId: string,
  eventId: string
): Promise<void> {
  if (!hasStaffPermission(interaction)) {
    await interaction.reply({ content: "You do not have permission to reject mogis.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue("reason").trim();
  await apiPost(`/api/discord/submissions/${submissionId}/reject`, {
    rejectedByDiscordId: interaction.user.id,
    reason,
  });

  await deleteStaffReviewMessage(interaction.client, messageId);
  const staffChannel = await getTextChannel(interaction.client, staffChannelId);
  await staffChannel.send({
    content: [
      `Rejected submission ${eventId || submissionId}.`,
      `Rejected by <@${interaction.user.id}>.`,
      reason ? `Reason: ${reason}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    allowedMentions: { users: [interaction.user.id] },
  });
  await interaction.editReply("Submission rejected.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await registerCommands(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === SUBMIT_COMMAND_NAME) {
      if (!hasSubmitPermission(interaction)) {
        await interaction.reply({
          content: "You need the Reporter role to submit mogis.",
          ephemeral: true,
        });
        return;
      }

      const ladder = normalizeLadder(interaction.options.getString("ladder"));
      const tier = displayTier(interaction.options.getString("tier"));
      if (!tierMatchesChoice(ladder, tier)) {
        await interaction.reply({
          content: `${ladder} only supports: ${tierChoicesForLadder(ladder)
            .map((choice) => choice.name)
            .join(", ")}.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.showModal(buildSubmitModal(ladder, tier));
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === ADJUST_COMMAND_NAME) {
      await handleAdjustmentCommand(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(SUBMIT_MODAL_PREFIX)) {
      const { ladder, tier } = parseSubmitModalCustomId(interaction.customId);
      await handleSubmitModal(interaction, ladder, tier);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(APPROVE_PREFIX)) {
      await handleApprove(interaction, interaction.customId.slice(APPROVE_PREFIX.length));
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(PENALTY_PREFIX)) {
      await handlePenaltyButton(interaction, interaction.customId.slice(PENALTY_PREFIX.length));
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(REJECT_PREFIX)) {
      await handleRejectButton(interaction, interaction.customId.slice(REJECT_PREFIX.length));
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(REJECT_MODAL_PREFIX)) {
      const { submissionId, messageId, eventId } = parseRejectModalCustomId(interaction.customId);
      await handleRejectModal(interaction, submissionId, messageId, eventId);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(PENALTY_MODAL_PREFIX)) {
      const { submissionId, messageId } = parsePenaltyModalCustomId(interaction.customId);
      await handlePenaltyModal(interaction, submissionId, messageId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    console.error("Discord interaction failed", error);
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch((replyError) => {
          if (
            typeof replyError === "object" &&
            replyError !== null &&
            "code" in replyError &&
            replyError.code === RESTJSONErrorCodes.UnknownInteraction
          ) {
            return;
          }
          console.error("Could not report interaction error", replyError);
        });
      }
    }
  }
});

client.login(token);


