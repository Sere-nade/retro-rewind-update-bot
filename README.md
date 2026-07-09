# Retro Rewind Lounge Discord Bot

This bot lets players submit mogi table text from Discord, sends it to a hidden updater/staff
channel, and lets staff approve or reject it with buttons.

Approved submissions are saved through the website's private Discord API, so MMR and table
generation use the same logic as the web admin tools.

## Required Discord setup

Create a Discord application/bot, invite it to the server, then copy `env.example` to `.env` and
fill these values:

```env
DISCORD_BOT_TOKEN="your bot token"
DISCORD_BOT_SECRET="a long random shared secret"
DISCORD_GUILD_ID="your server id"
DISCORD_STAFF_CHANNEL_ID="hidden updater channel id"
DISCORD_STAFF_ROLE_ID="role allowed to approve/reject"
DISCORD_REPORTER_ROLE_ID="1523691691804983306"
LOUNGE_API_BASE_URL="https://rr-lounge.com"
PUBLIC_SITE_URL="https://rr-lounge.com"

# Fallback channel if a more specific channel is blank.
DISCORD_RESULTS_CHANNEL_ID="public fallback results channel id"

# RR result channels
DISCORD_RESULTS_RR_ALL_CHANNEL_ID="rr tier all channel id"
DISCORD_RESULTS_RR_TIER_1_CHANNEL_ID="rr tier 1 channel id"
DISCORD_RESULTS_RR_TIER_2_CHANNEL_ID="rr tier 2 channel id"
DISCORD_RESULTS_RR_ALL_32_TRACKS_CHANNEL_ID="rr all tier 32-tracks channel id"
DISCORD_RESULTS_RR_LEGEND_CHANNEL_ID="rr legend tier channel id"
DISCORD_RESULTS_RR_MASTER_CHANNEL_ID="rr master tier channel id"

# CT result channels
DISCORD_RESULTS_CT_ALL_CHANNEL_ID="ct all tier channel id"

# TT result channel
DISCORD_RESULTS_TT_ALL_CHANNEL_ID="tt all tier channel id"

# Optional if Discord emoji names do not match rank names.
DISCORD_RANK_EMOJIS="Ruby=<:ruby:123>,Diamond=<:diamond:456>"

# Optional: exact Discord role IDs for rank role syncing.
DISCORD_RR_RANK_ROLES="Ruby=123456789,Diamond=234567890"
DISCORD_CT_RANK_ROLES="Ruby=345678901,Diamond=456789012"
DISCORD_TT_RANK_ROLES="Ruby=567890123,Diamond=678901234"
```

Generate the shared secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`DISCORD_BOT_SECRET` must be the same for the Next.js website service and the bot service. `PUBLIC_SITE_URL` is the public link the bot uses in Discord, so keep it as `https://rr-lounge.com`.

Members with `DISCORD_REPORTER_ROLE_ID` can use `/submit_mogi` from any channel. Staff role members
can also submit, approve, reject, and use `/adjust_mmr`.

When an approved mogi causes a player to rank up or down, the bot searches the server for the closest member matching their leaderboard name, pings that member, adds their new rank emoji, and updates their rank role. It removes the old rank role and adds the new one separately for `RR`, `CT`, or `TT`. By default it looks for server emojis named like the rank and roles named like `:ruby:`, `:emerald:`, `RR Ruby`, `RR Emerald`, `CT Diamond`, etc. If your emoji names or role names differ, set `DISCORD_RANK_EMOJIS`, `DISCORD_RR_RANK_ROLES`, `DISCORD_CT_RANK_ROLES`, and `DISCORD_TT_RANK_ROLES` with exact IDs.

## Channel routing

When someone runs `/submit_mogi`, they choose `RR`, `CT`, or `TT` and choose the tier from a
dropdown before entering the table.
After staff approves the submission, the bot posts the table/result message to the matching channel:

- `RR` + blank/All/unknown tier -> `DISCORD_RESULTS_RR_ALL_CHANNEL_ID`
- `RR` + Tier 1 -> `DISCORD_RESULTS_RR_TIER_1_CHANNEL_ID`
- `RR` + Tier 2 -> `DISCORD_RESULTS_RR_TIER_2_CHANNEL_ID`
- `RR` + All Tier 32-Tracks -> `DISCORD_RESULTS_RR_ALL_32_TRACKS_CHANNEL_ID`
- `RR` + Legend Tier -> `DISCORD_RESULTS_RR_LEGEND_CHANNEL_ID`
- `RR` + Master Tier -> `DISCORD_RESULTS_RR_MASTER_CHANNEL_ID`
- `CT` + blank/All/unknown tier -> `DISCORD_RESULTS_CT_ALL_CHANNEL_ID`
- `TT` + All Tier -> `DISCORD_RESULTS_TT_ALL_CHANNEL_ID`

If a specific tier channel is blank, the bot falls back to the matching All channel. If that is also
blank, it uses `DISCORD_RESULTS_CHANNEL_ID`.

## Install and run

```bash
npm install
npm run check
npm run bot
```

## Run server-side later

```bash
npm run bot
```

The bot registers `/submit_mogi` on startup. If `DISCORD_GUILD_ID` is set, the command appears in
that server quickly. Without it, Discord registers the command globally, which can take longer.

## Current workflow

1. User runs `/submit_mogi` and chooses RR/CT/TT plus the tier from dropdowns.
2. Bot opens a modal for table text, race count, room number, and notes.
3. Bot posts a preview in the hidden staff channel, including where it will post after approval.
4. Staff clicks approve or reject.
5. Approval creates the mogi on the website and posts the result table image plus website link in
   the correct RR/CT/tier results channel.
6. Approval deletes the staff preview message. Rejection deletes the staff preview message and
   posts a short rejection note in the staff channel.

## Manual MMR adjustments

Staff can run `/adjust_mmr` to add a manual MMR adjustment to the active season for a ladder.

Examples:

- `+100` adds 100 MMR
- `-100` removes 100 MMR as a penalty

The command updates the website through the private Discord API and recalculates that season.



