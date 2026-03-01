
Node.js/Express API for transit route-finding and map search.

- **Route finding**: `GET /Find/bus/route` computes K diverse transit routes between two coordinates and uses a 3-tier cache strategy (personalised GEO cache + global rounded-coordinate cache + live computation).
- **Map utilities**: `GET /Map/get` and `GET /Map/autoComplete` proxy geocoding/autocomplete to the Goong Maps API (rate-limited).
- **Caching**: Redis is used for route caching; the service connects lazily on first cache operation.

## Run

Local:

```bash
npm install
npm run dev
```

Docker:

```bash
docker compose up --build
```

Default API port is `3001` (configurable via `PORT`).

## Environment

Environment variables are loaded from `.env`.

- `PORT` (default: `3001`)
- `REDIS_URL` (default: `redis://127.0.0.1:6379`)

Optional (only needed for specific features):

- Goong Maps (for `/Map/*`): `GOONG_API`
- Firebase Admin (optional auth for `/Find/*`):
	- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (use `\\n` for newlines)
	- or `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON

## API

- `GET /Find/bus/route`
	- Query params:
		- `start` (JSON): `{ "lat": number, "lng": number }`
		- `end` (JSON): `{ "lat": number, "lng": number }`

Example:

```text
/Find/bus/route?start={"lat":21.0285,"lng":105.8542}&end={"lat":21.03,"lng":105.85}
```

- `GET /Map/get?address=...`
- `GET /Map/autoComplete?input=...`

## CI/CD & Deployment

- Jenkins pipeline: see `Jenkinsfile`
	- Runs SonarQube scan using `sonar-project.properties`
	- Deploys via `docker compose up -d --build`
	- Updates Nginx config by copying `nginx.conf` into the default site and reloading Nginx
- Nginx reverse proxy: see `nginx.conf`
	- `/api/` → Node server on `127.0.0.1:3001`
	- `/jenkins/` → Jenkins on `127.0.0.1:8080/jenkins/`
	- `/sonar/` → SonarQube on `127.0.0.1:9000`
