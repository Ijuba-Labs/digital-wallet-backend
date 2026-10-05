const catalogue = require('../loyalty-catalogue.json');
const fallback = {
  retailerName: 'Independent program', category: 'OTHER', barcodeFormat: 'UNKNOWN',
  capabilities: { digitalCard: false, staticBarcode: false, manualEntry: true, barcodeScanning: true, rewardsInformation: true },
  verification: { barcodeFormatVerified: false, numberFormatVerified: false, digitalReproductionAllowed: false, templateVerified: false },
  status: 'CATALOGUE_ONLY', active: true,
};
const template = {
  aspectRatio: 85.60 / 53.98, background: { type: 'solid', colors: ['#F3F0E8'] },
  barcode: { x: 0.07, y: 0.52, width: 0.86, height: 0.33, backgroundColor: '#FFFFFF', foregroundColor: '#000000', showNumber: true },
  attribution: 'Independent loyalty wallet. No retailer affiliation is implied.',
};
exports.up = async knex => {
  // The baseline also includes these additive changes for fresh databases.
  if (await knex.schema.hasColumn('loyalty_programs', 'configuration')) {
    if (!await knex.schema.hasTable('loyalty_card_templates') || !await knex.schema.hasColumn('loyalty_cards', 'template_version'))
      throw new Error('Incomplete loyalty wallet schema');
    return;
  }
  await knex.schema.alterTable('loyalty_programs', t => {
    t.jsonb('configuration').notNullable().defaultTo(JSON.stringify(fallback));
    t.integer('current_template_version');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  for (const { id, name, requiresCustomName, ...metadata } of catalogue) {
    await knex('loyalty_programs').insert({ id, name, requires_custom_name: !!requiresCustomName })
      .onConflict('id').ignore();
    await knex('loyalty_programs').where({ id }).update({ configuration: JSON.stringify({ ...fallback, ...metadata }) });
  }
  await knex.schema.createTable('loyalty_card_templates', t => {
    t.text('program_id').notNullable().references('id').inTable('loyalty_programs');
    t.integer('version').notNullable(); t.jsonb('template_json').notNullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['program_id', 'version']); t.check('version > 0', [], 'loyalty_template_version_check');
    t.check("jsonb_typeof(template_json) = 'object'", [], "loyalty_template_json_check");
  });
  const programs = await knex('loyalty_programs').select('id');
  await knex('loyalty_card_templates').insert(programs.map(p => ({ program_id: p.id, version: 1, template_json: JSON.stringify(template) })));
  await knex('loyalty_programs').update({ current_template_version: 1 });
  await knex.schema.alterTable('loyalty_programs', t => {
    t.foreign(['id', 'current_template_version']).references(['program_id', 'version']).inTable('loyalty_card_templates');
    t.check("jsonb_typeof(configuration) = 'object'", [], "loyalty_program_configuration_check");
  });
  await knex.schema.alterTable('loyalty_cards', t => {
    // Existing cards remain unpinned; the current version is resolved at checkout.
    t.integer('template_version');
    t.foreign(['program_id', 'template_version']).references(['program_id', 'version']).inTable('loyalty_card_templates');
  });
};
exports.down = async () => { throw new Error('Loyalty wallet rollback would discard published configuration. Use a reviewed forward migration or restore a backup.'); };
