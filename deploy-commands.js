require('dotenv').config();

console.log('CLIENT_ID :', process.env.CLIENT_ID);
console.log('GUILD_ID  :', process.env.GUILD_ID);
console.log('TOKEN len :', process.env.DISCORD_TOKEN?.length);

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('5stack')
    .setDescription('Gère les 5 stacks Valorant du salon')
    .addSubcommand(sub =>
      sub.setName('lobby')
        .setDescription('Crée une nouvelle 5 stack dans ce salon (durée : 3h)')
    )
    .addSubcommand(sub =>
      sub.setName('join')
        .setDescription('Rejoint la 5 stack en cours dans ce salon')
    )
    .addSubcommand(sub =>
      sub.setName('leave')
        .setDescription('Quitte la 5 stack en cours dans ce salon')
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Affiche la 5 stack en cours dans ce salon')
    )
    .addSubcommand(sub =>
      sub.setName('close')
        .setDescription('Ferme la 5 stack (créateur ou modérateur uniquement)')
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Déploiement des commandes...');

    // Déploiement sur un serveur précis (instantané)
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    // Pour un déploiement global (jusqu'à 1h de propagation), utilise :
    // await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

    console.log('✅ Commandes déployées avec succès !');
  } catch (error) {
    console.error(error);
  }
})();