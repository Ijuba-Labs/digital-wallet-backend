exports.up = async knex => {
  if (await knex.schema.hasTable('loyalty_cards')) {
    if (!await knex.schema.hasTable('loyalty_programs') || !await knex.schema.hasTable('loyalty_card_identifiers'))
      throw new Error('Incomplete loyalty schema');
    return;
  }
  await knex.schema.createTable('loyalty_programs', t => {
    t.text('id').primary(); t.text('name').notNullable(); t.boolean('requires_custom_name').notNullable().defaultTo(false);
  });
  await knex('loyalty_programs').insert([
    { id: 'xtra-savings', name: 'Xtra Savings' },
    { id: 'clicks-clubcard', name: 'Clicks ClubCard' },
    { id: 'smart-shopper', name: 'Smart Shopper' },
    { id: 'other', name: 'Other', requires_custom_name: true },
  ]);
  await knex.schema.createTable('loyalty_cards', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('program_id').notNullable().references('id').inTable('loyalty_programs');
    t.text('custom_program_name'); t.text('nickname');
    t.text('membership_number_enc'); t.text('membership_number_mask');
    t.text('barcode_payload_enc'); t.text('barcode_payload_mask'); t.text('barcode_format');
    t.text('image_enc'); t.text('image_mime'); t.text('image_detection'); t.text('image_detection_value_enc');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at']);
  });
  await knex.raw(`ALTER TABLE loyalty_cards ADD CONSTRAINT loyalty_cards_content_check CHECK
    (membership_number_enc IS NOT NULL OR barcode_payload_enc IS NOT NULL OR image_enc IS NOT NULL)`);
  await knex.raw(`ALTER TABLE loyalty_cards ADD CONSTRAINT loyalty_cards_barcode_check CHECK
    ((barcode_payload_enc IS NULL) = (barcode_format IS NULL))`);
  await knex.raw(`ALTER TABLE loyalty_cards ADD CONSTRAINT loyalty_cards_image_check CHECK
    ((image_enc IS NULL) = (image_mime IS NULL))`);
  await knex.raw(`ALTER TABLE loyalty_cards ADD CONSTRAINT loyalty_cards_custom_name_check CHECK
    ((program_id = 'other' AND nullif(trim(custom_program_name), '') IS NOT NULL)
      OR (program_id <> 'other' AND custom_program_name IS NULL))`);
  await knex.schema.createTable('loyalty_card_identifiers', t => {
    t.uuid('card_id').notNullable().references('id').inTable('loyalty_cards').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('program_id').notNullable().references('id').inTable('loyalty_programs');
    t.specificType('fingerprint', 'CHAR(64)').notNullable();
    t.primary(['card_id', 'fingerprint']); t.unique(['user_id', 'program_id', 'fingerprint']);
  });
};
exports.down = async knex => {
  await knex.schema.dropTable('loyalty_card_identifiers');
  await knex.schema.dropTable('loyalty_cards');
  await knex.schema.dropTable('loyalty_programs');
};
