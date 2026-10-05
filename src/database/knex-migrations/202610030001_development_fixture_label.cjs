// Fixture links have no ownership timestamp or attestation. The flag is exposed
// only by the explicitly enabled development stack; payment paths require proof.
exports.up = async knex => {
  if (await knex.schema.hasColumn('wallets', 'development_fixture')) return;
  await knex.schema.alterTable('wallets', table => table.boolean('development_fixture').notNullable().defaultTo(false));
};
exports.down = async knex => { await knex.schema.alterTable('wallets', table => table.dropColumn('development_fixture')); };
