# coleman-sagil-dev

Monorepo for the `coleman-sagil.dev` personal portfolio domain, deployed on
Cloudflare Workers using modern static-assets support (`[assets]` in
`wrangler.toml`), not the older/deprecated Workers Sites (KV-backed)
approach.

Live at https://coleman-sagil.dev

## Layout

Four independent static sites, each its own Cloudflare Worker, routed by
path under the apex domain (not subdomains):

```
sites/
  hub/            -> coleman-sagil.dev/          (landing page, catch-all route)
    public/
    wrangler.toml
  local-llm/      -> coleman-sagil.dev/LocalLLM
    public/LocalLLM/
    wrangler.toml
  intuimotion/    -> coleman-sagil.dev/IntuiMotion
    public/IntuiMotion/
    wrangler.toml
  oanda/          -> coleman-sagil.dev/OANDA
    public/OANDA/
    wrangler.toml
```

Sites are independent: each has its own `wrangler.toml` with an `[assets]`
block pointing at its own `public/` directory, and each is deployed with
its own `wrangler deploy` invocation. There is no shared build step or
shared Worker between them.

`shared/design-system.css` is the source of truth for color, type, spacing,
and motion tokens. It's copied (not symlinked) into each site's own
`public/` directory, since Workers assets only serve files inside a site's
own asset directory — there's no cross-site linking in the deployed bundle.
A token change has to be re-copied into all four sites by hand.

Routing is path-based: `hub`'s `wrangler.toml` owns the catch-all
`coleman-sagil.dev/*` route, while each project site owns two more specific
routes (an exact-match entry plus a `/*` wildcard) that win on Cloudflare's
most-specific-pattern precedence. The exact-match entry exists because a
wildcard-only route like `coleman-sagil.dev/OANDA/*` does not match a
request for `/OANDA` with no trailing slash — see the comments in each
project's `wrangler.toml` for the full reasoning. Because the static-assets
router doesn't strip a route's path prefix, each project's assets
physically live under a matching subdirectory (e.g.
`sites/oanda/public/OANDA/`) rather than at its `public/` root.

## Node.js toolchain

Wrangler requires Node >= 22. If your system Node is older, point `PATH`
at a Node 22 install for any `node`/`npm`/`npx`/`wrangler` command in this
repo, e.g.:

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
cd sites/hub && npx -y wrangler deploy
cd sites/local-llm && npx -y wrangler deploy
cd sites/intuimotion && npx -y wrangler deploy
cd sites/oanda && npx -y wrangler deploy
```

To validate a site locally without deploying or needing credentials
(no network calls to Cloudflare, no `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
needed):

```bash
cd sites/<site>
npx -y wrangler deploy --dry-run
```

## Status

Live and deployed. All four Workers are attached to the
`coleman-sagil.dev` zone as described above, and each is also reachable at
its own `*.workers.dev` subdomain.
