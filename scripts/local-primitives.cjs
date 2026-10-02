module.exports = {
  hooks: {
    readPackage(pkg) {
      if (!process.env.PAYMENT_PRIMITIVES_LOCAL_PATH || !process.env.PAYMENT_PRIMITIVES_CONSUMER) {
        throw new Error('Use pnpm install:local to configure the local package source');
      }
      if (pkg.name === process.env.PAYMENT_PRIMITIVES_CONSUMER) {
        pkg.dependencies['@ijuba-labs/payment-primitives'] = `link:${process.env.PAYMENT_PRIMITIVES_LOCAL_PATH}`;
      }
      return pkg;
    }
  }
};
