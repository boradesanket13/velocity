# Velocity

paste a public GitHub repo URL and get a live HTTPS site.   
Velocity clones the repo, builds it in an isolated sandbox, and hosts the output on its own URL ('https://<id>.your-sites-domain.app').

I built it to learn what happens behind a "deploy from Git" button: build isolation, queues, static hosting, and the CI/CD around them.

## How it works

1. send a repo URL to the API
2. API saves a queued record in DynamoDB and puts a job on SQS.
3. worker picks up the job and starts a runner, a throwaway Fargate container that clones the repo, runs 'npm run build', and uploads the output.
4. the worker validates the output and copies it to S3.
5. cloudFront serves it at the deployment's own URL.


Browser ─► API (ECS Fargate) ─► SQS ─► Worker ─► Runner (sandboxed build)
              │                          │
           DynamoDB                      └─► S3 ─► CloudFront ─► Visitor


Key design choices:

- **Builds are untrusted.** The runner has no IAM role, no secrets and no inbound traffic. It can only upload one file.
- **The worker validates output** (no symlinks, no '..' paths, size limits) before publishing.
- **SQS with a dead-letter queue**, so jobs survive a worker crash.
- **Each deployment gets its own hostname**, on a separate domain from the dashboard.

## Tech stack

- **Backend:** TypeScript, Node 24, Express
- **Frontend:** React, Vite, Tailwind
- **AWS:** ECS Fargate, SQS, DynamoDB, S3, CloudFront, WAF, Secrets Manager, CloudWatch
- **Infra and CI/CD:** Terraform, Docker, GitHub Actions 

## Project structure


backend/     API, worker and local site server
runner/      sandbox image that builds the repo
frontend/    dashboard
infra/       Terraform and CloudFront function
.github/     CI and deploy workflows


## Run it locally

You need Docker (Compose v2) and Node 24.

bash
make install
docker compose up --build


Wait for 'worker started' in the logs, then start the dashboard:

bash
cd frontend
cp .env.example .env
npm run dev


Open http://localhost:5173 and sign in with the local key 'dev-token-change-me-0123456789'.

Or deploy from the command line:

bash
curl -X POST http://localhost:3000/v1/deployments \
  -H "Authorization: Bearer dev-token-change-me-0123456789" \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/<you>/<your-repo>"}'


When it says 'deployed', open 'http://<id>.localhost:3001'.

## Deploy to AWS

You need an AWS account, Terraform 1.10+, Docker, and a Route 53 domain.

bash
cd infra/terraform
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars   
terraform init -backend-config=backend.hcl

# create the image registries first, then push images
terraform apply -target=aws_ecr_repository.backend -target=aws_ecr_repository.runner
# (build and push the backend and runner images to ECR)

terraform apply


After that GitHub Actions handles deploys: every push to 'main' runs the tests, builds the images, rolls out to ECS with automatic rollback and publishes the dashboard. It authenticates through OIDC so no AWS keys are stored in GitHub.

## API

all '/v1' endpoints need 'Authorization: Bearer <key>'.

| Endpoint | Purpose |
|---|---|
| 'POST /v1/deployments' | Create a deployment |
| 'GET /v1/deployments' | List your recent deployments |
| 'GET /v1/deployments/:id' | Get one deployment |
| 'GET /v1/deployments/:id/logs' | Get its build logs |
| 'GET /healthz' | Health check |

Request body (only 'repoUrl' is required):

json
{ "repoUrl": "https://github.com/owner/repo", "branch": "main", "rootDir": "apps/web", "outputDir": "dist" }


## Known limitations

- build containers can reach the open internet: so egress filtering is still to do.
- auth is API keys, not user accounts.
- public repos only.
- No custom domains, env vars or webhooks yet.

## Cost

roughly $100/month on AWS with the defaults, mostly the NAT gateway, load balancer and Fargate. Turning off WAF and running a single API task brings it down.

## Tear down

empty the S3 buckets, then:

bash
terraform -chdir=infra/terraform apply -var deletion_protection=false
terraform -chdir=infra/terraform destroy

