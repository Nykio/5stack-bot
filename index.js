const t = process.env.TOKEN;
console.log('Longueur :', t?.length);
console.log('Nb de points :', (t?.match(/\./g) || []).length);
console.log('Début :', t?.slice(0, 10));

require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const MAX_PLAYERS = 5;
const DURATION_MS = 3 * 60 * 60 * 1000; // 3 heures

// ─────────────────────────────────────────────
//  STOCKAGE : une stack par salon
//  Map<channelId, { ownerId, players: string[], createdAt, expiresAt, timeout, messageUrl }>
// ─────────────────────────────────────────────
const stacks = new Map();

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function getStack(channelId) {
  const stack = stacks.get(channelId);
  if (!stack) return null;

  // Sécurité : expiration passive si le timer a échoué
  if (Date.now() >= stack.expiresAt) {
    clearStack(channelId);
    return null;
  }
  return stack;
}

function clearStack(channelId) {
  const stack = stacks.get(channelId);
  if (stack?.timeout) clearTimeout(stack.timeout);
  stacks.delete(channelId);
}

function buildStackEmbed(stack, { closed = false, expired = false } = {}) {
  const list = stack.players
    .map((id, i) => `\`${i + 1}.\` <@${id}>`)
    .join('\n');

  const emptySlots = Array.from(
    { length: MAX_PLAYERS - stack.players.length },
    (_, i) => `\`${stack.players.length + i + 1}.\` *— libre —*`
  ).join('\n');

  const isFull = stack.players.length >= MAX_PLAYERS;

  let color = 0xff4655; // rouge Valorant
  if (isFull) color = 0x00d26a;
  if (closed || expired) color = 0x5c5c5c;

  let title = '🎯 5 Stack Valorant';
  if (expired) title = '⌛ 5 Stack expirée';
  else if (closed) title = '🔒 5 Stack fermée';
  else if (isFull) title = '✅ 5 Stack COMPLÈTE !';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      `**Joueurs — ${stack.players.length}/${MAX_PLAYERS}**\n${list}${emptySlots ? '\n' + emptySlots : ''}`
    )
    .setFooter({ text: `Créée par ${stack.ownerTag}` });

  if (!closed && !expired) {
    embed.addFields({
      name: 'Expiration',
      value: `<t:${Math.floor(stack.expiresAt / 1000)}:R> (<t:${Math.floor(stack.expiresAt / 1000)}:t>)`,
    });
    embed.addFields({
      name: 'Commandes',
      value: '`/5stack join` • `/5stack leave` • `/5stack` • `/5stack close`',
    });
  }

  return embed;
}

function buildButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('5stack_join')
      .setLabel('Rejoindre')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('5stack_leave')
      .setLabel('Quitter')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function scheduleExpiration(channelId) {
  const stack = stacks.get(channelId);
  if (!stack) return;

  stack.timeout = setTimeout(async () => {
    const current = stacks.get(channelId);
    if (!current) return;
    stacks.delete(channelId);

    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        await channel.send({
          embeds: [buildStackEmbed(current, { expired: true })],
          content: '⌛ La 5 stack de ce salon a expiré (3h écoulées).',
        });
      }
    } catch (err) {
      console.error('Erreur lors de la notification d\'expiration :', err);
    }
  }, DURATION_MS);

  // Évite de garder le process en vie inutilement
  if (stack.timeout.unref) stack.timeout.unref();
}

// ─────────────────────────────────────────────
//  LOGIQUE PARTAGÉE (commandes + boutons)
// ─────────────────────────────────────────────
function joinStack(channelId, user) {
  const stack = getStack(channelId);

  if (!stack) {
    return { ok: false, msg: '❌ Aucune 5 stack active dans ce salon. Lance `/5stack lobby` pour en créer une.' };
  }
  if (stack.players.includes(user.id)) {
    return { ok: false, msg: '⚠️ Tu es déjà dans la 5 stack de ce salon.' };
  }
  if (stack.players.length >= MAX_PLAYERS) {
    return { ok: false, msg: '❌ La 5 stack est déjà complète (5/5).' };
  }

  stack.players.push(user.id);
  return { ok: true, stack, full: stack.players.length === MAX_PLAYERS };
}

function leaveStack(channelId, user) {
  const stack = getStack(channelId);

  if (!stack) {
    return { ok: false, msg: '❌ Aucune 5 stack active dans ce salon.' };
  }

  const index = stack.players.indexOf(user.id);
  if (index === -1) {
    return { ok: false, msg: '⚠️ Tu ne fais pas partie de cette 5 stack.' };
  }

  stack.players.splice(index, 1);

  // Si plus personne, on supprime la stack
  if (stack.players.length === 0) {
    clearStack(channelId);
    return { ok: true, deleted: true };
  }

  // Si le créateur part, on transfère la "propriété"
  if (stack.ownerId === user.id) {
    stack.ownerId = stack.players[0];
    stack.ownerTag = stack.ownerTags?.[stack.players[0]] ?? 'un joueur';
  }

  return { ok: true, stack };
}

// ─────────────────────────────────────────────
//  EVENTS
// ─────────────────────────────────────────────
client.once('ready', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: 'Valorant', type: ActivityType.Playing }],
    status: 'online',
  });
});

client.on('interactionCreate', async (interaction) => {
  // ── BOUTONS ──────────────────────────────
  if (interaction.isButton()) {
    const channelId = interaction.channelId;

    if (interaction.customId === '5stack_join') {
      const res = joinStack(channelId, interaction.user);
      if (!res.ok) {
        return interaction.reply({ content: res.msg, flags: MessageFlags.Ephemeral });
      }
      res.stack.ownerTags = res.stack.ownerTags || {};
      res.stack.ownerTags[interaction.user.id] = interaction.user.username;

      await interaction.update({
        embeds: [buildStackEmbed(res.stack)],
        components: [buildButtons(res.full)],
      });
      if (res.full) {
        await interaction.followUp({
          content: `🔥 **La 5 stack est complète !** ${res.stack.players.map(id => `<@${id}>`).join(' ')}`,
        });
      }
      return;
    }

    if (interaction.customId === '5stack_leave') {
      const res = leaveStack(channelId, interaction.user);
      if (!res.ok) {
        return interaction.reply({ content: res.msg, flags: MessageFlags.Ephemeral });
      }
      if (res.deleted) {
        return interaction.update({
          content: '🗑️ La 5 stack est vide, elle a été supprimée.',
          embeds: [],
          components: [],
        });
      }
      return interaction.update({
        embeds: [buildStackEmbed(res.stack)],
        components: [buildButtons(false)],
      });
    }
    return;
  }

  // ── SLASH COMMANDS ───────────────────────
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== '5stack') return;

  const sub = interaction.options.getSubcommand();
  const channelId = interaction.channelId;

  // ─── /5stack lobby ───
  if (sub === 'lobby') {
    const existing = getStack(channelId);
    if (existing) {
      return interaction.reply({
        content: '⚠️ Une 5 stack est déjà active dans ce salon. Utilise `/5stack join` pour la rejoindre ou `/5stack close` pour la fermer.',
        embeds: [buildStackEmbed(existing)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const now = Date.now();
    const stack = {
      ownerId: interaction.user.id,
      ownerTag: interaction.user.username,
      ownerTags: { [interaction.user.id]: interaction.user.username },
      players: [interaction.user.id], // le créateur est ajouté automatiquement
      createdAt: now,
      expiresAt: now + DURATION_MS,
      timeout: null,
    };

    stacks.set(channelId, stack);
    scheduleExpiration(channelId);

    return interaction.reply({
      content: '🎮 **Nouvelle 5 stack Valorant !**',
      embeds: [buildStackEmbed(stack)],
      components: [buildButtons(false)],
    });
  }

  // ─── /5stack join ───
  if (sub === 'join') {
    const res = joinStack(channelId, interaction.user);
    if (!res.ok) {
      return interaction.reply({ content: res.msg, flags: MessageFlags.Ephemeral });
    }
    res.stack.ownerTags[interaction.user.id] = interaction.user.username;

    await interaction.reply({
      content: `✅ <@${interaction.user.id}> a rejoint la 5 stack ! (${res.stack.players.length}/${MAX_PLAYERS})`,
      embeds: [buildStackEmbed(res.stack)],
      components: [buildButtons(res.full)],
    });

    if (res.full) {
      await interaction.followUp({
        content: `🔥 **La 5 stack est complète !** ${res.stack.players.map(id => `<@${id}>`).join(' ')}`,
      });
    }
    return;
  }

  // ─── /5stack leave ───
  if (sub === 'leave') {
    const res = leaveStack(channelId, interaction.user);
    if (!res.ok) {
      return interaction.reply({ content: res.msg, flags: MessageFlags.Ephemeral });
    }
    if (res.deleted) {
      return interaction.reply({ content: '🗑️ Tu étais le dernier joueur : la 5 stack a été supprimée.' });
    }
    return interaction.reply({
      content: `🚪 <@${interaction.user.id}> a quitté la 5 stack. (${res.stack.players.length}/${MAX_PLAYERS})`,
      embeds: [buildStackEmbed(res.stack)],
      components: [buildButtons(false)],
    });
  }

  // ─── /5stack list ───
  if (sub === 'list') {
    const stack = getStack(channelId);
    if (!stack) {
      return interaction.reply({
        content: '📭 Aucune 5 stack active dans ce salon. Lance `/5stack lobby` pour en créer une !',
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      embeds: [buildStackEmbed(stack)],
      components: [buildButtons(stack.players.length >= MAX_PLAYERS)],
    });
  }

  // ─── /5stack close ───
  if (sub === 'close') {
    const stack = getStack(channelId);
    if (!stack) {
      return interaction.reply({ content: '📭 Aucune 5 stack active dans ce salon.', flags: MessageFlags.Ephemeral });
    }

    const isOwner = stack.ownerId === interaction.user.id;
    const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);

    if (!isOwner && !isMod) {
      return interaction.reply({
        content: '⛔ Seul le créateur de la 5 stack ou un modérateur peut la fermer.',
        flags: MessageFlags.Ephemeral,
      });
    }

    clearStack(channelId);
    return interaction.reply({
      content: '🔒 La 5 stack de ce salon a été fermée.',
      embeds: [buildStackEmbed(stack, { closed: true })],
    });
  }
});

client.login(process.env.TOKEN);
