exports.up = async knex => {
  await knex.raw('ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_status_check');
  await knex.raw(`ALTER TABLE transfers ADD CONSTRAINT transfers_status_check CHECK (status IN (
    'CREATING','AWAITING_AUTHORIZATION','FINALIZING','AUTHORIZED','SUBMITTING',
    'PENDING','COMPLETED','FAILED','EXPIRED','UNKNOWN','CANCELLED'
  ))`);
};
exports.down = async () => {
  throw new Error('Forward-only migration: preserve cancelled transfer history');
};
