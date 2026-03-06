# Cloud Run Deploy Guide

Use this setup when you want Firebase Hosting for the frontend and Google Cloud Run for the Python backend.

## 1. What goes where

- Frontend: Firebase Hosting
- Backend API: Cloud Run
- Data/Auth: Firebase project `credonai`

## 2. Backend deploy to Cloud Run

The backend container is defined in [backend/Dockerfile](backend/Dockerfile).

### Option A: Google Cloud Console

1. Open Google Cloud Run.
2. Click `Create service`.
3. Choose `Continuously deploy from a repository` or `Deploy one revision from an existing container image`.
4. Connect the GitHub repo if asked.
5. Point the build to the `backend` directory.
6. Set the container port to `8080`.
7. Allow unauthenticated access.
8. Add environment variables from [backend/.env.cloudrun.example](backend/.env.cloudrun.example).

### Option B: gcloud CLI

```powershell
gcloud run deploy credon-ai-backend ^
  --source backend ^
  --region asia-south1 ^
  --allow-unauthenticated ^
  --set-env-vars MODEL_RUNTIME_MODE=cloud,USE_LOCAL_MODEL=false,USE_MODEL_GENERATION=true,USE_WEB_SEARCH=true,ENABLE_PAGE_EXTRACTION=false
```

Then add the remaining secret env vars in the Cloud Run service settings.

## 3. Frontend deploy to Firebase Hosting

1. Create `frontend/.env.production` from [frontend/.env.production.example](frontend/.env.production.example).
2. Set `NEXT_PUBLIC_API_BASE` to your Cloud Run service URL.
3. Build the frontend:

```powershell
cd frontend
npm install
npm run build
```

4. Deploy Hosting from repo root:

```powershell
firebase deploy --only hosting
```

## 4. Required backend env vars

- `DEEPSEEK_API_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `CORS_ALLOW_ORIGINS`

## 5. Important notes

- Cloud Run has a free tier, but it is not an unlimited free server.
- If traffic grows, usage can become paid.
- Start with one region close to your users.
- After deploy, test `/health` and `/docs` on the Cloud Run URL before deploying the frontend.