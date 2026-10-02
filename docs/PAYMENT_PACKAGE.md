# Payment primitives installation and releases

The MIT package `@ijuba-labs/payment-primitives` is published to GitHub Packages and linked to this public repository. Both services pin version `0.1.0` in their production manifests and lockfiles. Neither production build needs the other repository's source.

## Local development

Run `pnpm install:local` from either repository. In the public backend it uses `packages/open-payments-primitives`; in the private service it uses `../backend/packages/open-payments-primitives`. Override the path with `PAYMENT_PRIMITIVES_PATH` if your checkout layout differs.

The command builds the package, links its folder, and writes an ignored `.local/dependencies` lockfile seeded from the production lockfile. It does not change the committed manifest or lockfile. Rebuild the package after editing it, or run `pnpm exec tsc -p tsconfig.json --watch` inside its folder. The development Docker image also uses the folder; Compose Watch rebuilds when its source changes.

## Published-package installs

GitHub's npm registry requires authentication even for public npm packages. Provide a classic personal access token with `read:packages` through `NODE_AUTH_TOKEN`. Never commit the token. For a locally authenticated GitHub CLI:

```sh
NODE_AUTH_TOKEN="$(gh auth token --user n-sipho)" pnpm install:release
pnpm build
```

`install:release` uses the frozen production lockfile and a temporary user npm configuration containing an environment reference, then removes that configuration. It also switches an existing local-folder install back to the published artifact. CI uses `setup-node` registry authentication and its `GITHUB_TOKEN` with `packages: read`.

Production Docker builds use a BuildKit secret:

```sh
NODE_AUTH_TOKEN="$(gh auth token --user n-sipho)" docker build \
  --secret id=github_packages_token,env=NODE_AUTH_TOKEN -t wallet-backend .
```

Run the private Docker build from the private repository with the same secret flag. Compose production builds read this secret from `NODE_AUTH_TOKEN`; set it in the deployment process environment. It is a build credential and is not included in the runtime image.

## Releasing a new version

Update the version in `packages/open-payments-primitives/package.json`, build it, and run `node scripts/verify-payment-package.mjs`. Commit and push the source, then push a matching tag such as `payment-primitives-v0.1.1`. The tag workflow validates the version and package contents, then publishes using its scoped `GITHUB_TOKEN`.

Never reuse a published version or move its tag. After publishing, update the dependency in each consumer, regenerate its production lockfile using `install:release --no-frozen-lockfile`, and verify its build before committing. Local edits remain local until a new package version is published.
