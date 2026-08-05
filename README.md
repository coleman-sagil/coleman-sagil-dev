# coleman-sagil-dev

Monorepo for the `coleman-sagil.dev` personal portfolio domain, deployed on
Cloudflare Workers using modern static-assets support (`[assets]` in
`wrangler.toml`), not the older/deprecated Workers Sites (KV-backed)
approach.

## Layout

Each subdomain is an independent static site, deployed as its own
Cloudflare Worker:

```
sites/
  local-llm/     -> local-llm.coleman-sagil.dev
    public/       (static assets: index.html, etc.)
    wrangler.toml
  intuimotion/    -> intuimotion.coleman-sagil.dev
    public/
    wrangler.toml
  oanda/          -> oanda.coleman-sagil.dev
    public/
    wrangler.toml
```

Sites are independent: each has its own `wrangler.toml` with an `[assets]`
block pointing at its own `public/` directory, and each is deployed with
its own `wrangler deploy` invocation. There is no shared build step or
shared Worker between them.

The custom hostnames above (`*.coleman-sagil.dev`) are **not** wired up
yet. That requires a live Cloudflare zone for `coleman-sagil.dev` plus
either a Custom Domain (dashboard) or a `routes` entry per
`wrangler.toml`, added in a later phase once the zone and API token are
active. Right now each `wrangler.toml` only defines the Worker `name` and
asset directory.

## Node.js toolchain

The system Node (`/usr/bin/node`, v12, EOL) cannot run Wrangler, which
requires Node >= 22. This repo reuses an existing Node 22 LTS install
rather than downloading a second copy:

```
/path/to/node22/bin/
```

Put that directory first on `PATH` for any `node`/`npm`/`npx`/`wrangler`
command in this repo, e.g.:

```bash
PATH=/path/to/node22/bin:$PATH npx -y wrangler --version
```

## Deploying a site

Deployment requires a valid Cloudflare API token and account ID, set as
environment variables (never committed to this repo, never hardcoded in
any file here):

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

With those set, deploy each site independently from its own directory:

```bash
# local-llm.coleman-sagil.dev
cd sites/local-llm
PATH=/path/to/node22/bin:$PATH npx -y wrangler deploy

# intuimotion.coleman-sagil.dev
cd sites/intuimotion
PATH=/path/to/node22/bin:$PATH npx -y wrangler deploy

# oanda.coleman-sagil.dev
cd sites/oanda
PATH=/path/to/node22/bin:$PATH npx -y wrangler deploy
```

To validate a site locally without deploying or needing credentials
(no network calls to Cloudflare, no `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
needed):

```bash
cd sites/<site>
PATH=/path/to/node22/bin:$PATH npx -y wrangler deploy --dry-run
```

## Status

All local scaffolding only. No Cloudflare deployment has happened yet
(the API token is currently invalid/pending). `wrangler.toml` for each
site has been validated with `wrangler deploy --dry-run`.
