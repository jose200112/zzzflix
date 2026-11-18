# zzzflix 💤

**Movies and series to fall asleep to.** A small catalog of famously slow, long and meditative films, each one rated by how likely it is to knock you out.

🔗 **Live demo: https://zzzflix.josemunozmunoz.dev**

A personal portfolio project: a React single-page app deployed on AWS as a static site, with the whole infrastructure defined in Terraform.

## Features

- Catalog of films and series loaded from the [TMDB API](https://www.themoviedb.org/) (posters, synopsis in Spanish, runtime).
- A curated **sleep score** (1–5 💤) for every title.
- **"Más soporíferas"** ranking, sorted by sleep score and then by runtime.
- Detail page per title (`/titulo/:id`) with deep links that survive a page refresh.
- **Favorites** persisted in the browser (`localStorage`).
- Responsive grid, dark theme.

## Tech stack

| Area | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, React Router |
| Data | TMDB API (`fetch`, `Promise.allSettled`) |
| Hosting | Amazon S3 (private) + Amazon CloudFront |
| TLS | AWS Certificate Manager |
| DNS | Cloudflare |
| Infrastructure as code | Terraform (AWS + Cloudflare providers) |

## Architecture

```mermaid
flowchart LR
  U([Browser])
  DNS[Cloudflare DNS<br/>zzzflix.josemunozmunoz.dev]
  CF[CloudFront<br/>HTTPS, HTTP/2, gzip]
  S3[(S3 bucket<br/>private, eu-north-1)]
  ACM[ACM certificate<br/>us-east-1]
  TMDB[TMDB API]

  U -->|1. resolves| DNS
  DNS -->|CNAME| CF
  U -->|2. HTTPS| CF
  CF -->|OAC, SigV4| S3
  ACM -.->|attached to| CF
  U -->|3. catalog data| TMDB
```

The site is 100% static: there is no server to run or patch. The browser downloads the compiled app from CloudFront and then calls TMDB directly for the catalog data.

### Design decisions

- **Private bucket + Origin Access Control (OAC).** The S3 bucket blocks all public access. Only this specific CloudFront distribution can read it (bucket policy conditioned on the distribution ARN), so the content can only be reached through the CDN.
- **Certificate in `us-east-1`.** CloudFront only accepts ACM certificates from that region, so the project uses a second, aliased AWS provider for it while the bucket lives in `eu-north-1`. The certificate is validated through DNS records created by Terraform in Cloudflare.
- **SPA routing.** React Router routes such as `/soporiferas` or `/titulo/1398` do not exist as files in S3. CloudFront custom error responses turn 403/404 into `index.html` (status 200), so deep links and refreshes work. Trade-off: genuinely missing files also return the app shell, and the router decides what to show.
- **`PriceClass_100`.** Only the cheapest edge locations (North America and Europe), which is enough for this audience.
- **No secrets in the repository.** The Cloudflare token comes from `CLOUDFLARE_API_TOKEN`, the TMDB token from a git-ignored `.env.local`, and Terraform state and `*.tfvars` are ignored too.
- **Optimized assets.** The hero logo is a 20 KB WebP (it started as a 1.3 MB PNG).

### Cost

Serving the site costs cents per month (S3 storage, CloudFront transfer; ACM is free).

## Run it locally

```bash
npm install
echo "VITE_TMDB_TOKEN=your_tmdb_read_access_token" > .env.local
npm run dev
```

You need a free TMDB API key (use the *API Read Access Token*). `.env.local` is git-ignored.

## Deploy

Infrastructure (requires AWS credentials and `CLOUDFLARE_API_TOKEN` in the environment):

```bash
cd infra
# set your Cloudflare zone id in infra/terraform.tfvars (git-ignored):
#   cloudflare_zone_id = "..."
terraform init
terraform plan
terraform apply
```

Site:

```bash
npm run build
aws s3 sync dist/ "s3://$(terraform -chdir=infra output -raw bucket_name)" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform -chdir=infra output -raw distribution_id)" --paths "/*"
```

## Known limitations

- The TMDB token is bundled into the frontend, so anyone can read it from the browser. It is a free, read-only token for public data, which is acceptable for a demo; a small proxy (for example an AWS Lambda) would be the proper fix.
- Favorites live in the browser only, so they are not shared across devices.

## Roadmap

- [ ] AWS WAF in front of CloudFront (managed rules, rate limiting and a CAPTCHA challenge).
- [ ] CI/CD with GitHub Actions authenticating to AWS through OIDC (no long-lived keys).
- [ ] Reviews and comments with an API behind it, moderated with Amazon Bedrock Guardrails.
- [ ] Lambda proxy for the TMDB token.

## Credits

This product uses the TMDB API but is not endorsed or certified by [TMDB](https://www.themoviedb.org/).

## License

MIT © Jose Muñoz Muñoz
