mod audit;
mod cdp;

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{RwLock, Semaphore};
use tracing::{info, warn};
use url::Url;

#[derive(Clone)]
struct AppState {
    jobs: Arc<RwLock<HashMap<String, Job>>>,
    permits: Arc<Semaphore>,
    secret: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct Progress {
    phase: String,
    #[serde(rename = "pagesDone")]
    pages_done: usize,
    #[serde(rename = "pagesTotal")]
    pages_total: usize,
    #[serde(rename = "currentUrl")]
    current_url: String,
}

impl Default for Progress {
    fn default() -> Self {
        Self {
            phase: "queued".into(),
            pages_done: 0,
            pages_total: 0,
            current_url: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct Job {
    id: String,
    kind: String,
    status: String,
    progress: Progress,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct AuditRequest {
    url: String,
    #[serde(default = "default_pages")]
    #[serde(rename = "maxPages")]
    max_pages: usize,
}

fn default_pages() -> usize {
    4
}

#[derive(Deserialize)]
struct RescanPageRequest {
    url: String,
    #[serde(default)]
    patches: Vec<audit::Patch>,
}

#[derive(Deserialize)]
struct RescanRequest {
    pages: Vec<RescanPageRequest>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let secret = std::env::var("ENGINE_SECRET").ok().filter(|s| !s.is_empty());
    if secret.is_none() {
        warn!("ENGINE_SECRET is not set; the engine is accepting unauthenticated requests");
    }
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8787);

    let state = AppState {
        jobs: Arc::new(RwLock::new(HashMap::new())),
        permits: Arc::new(Semaphore::new(1)),
        secret,
    };

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/audits", post(start_audit))
        .route("/v1/audits/{id}", get(get_job))
        .route("/v1/rescans", post(start_rescan))
        .route("/v1/rescans/{id}", get(get_job))
        .layer(middleware::from_fn_with_state(state.clone(), auth))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("::", port)).await?;
    info!("unbarred engine listening on :{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn auth(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> impl IntoResponse {
    let Some(secret) = state.secret.as_ref() else {
        return next.run(request).await;
    };
    let provided = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if provided != secret {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response();
    }
    next.run(request).await
}

async fn healthz(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "ok": true,
        "service": "unbarred-engine",
        "chrome": std::env::var("CHROME_PATH").unwrap_or_else(|_| "/usr/bin/chromium".into()),
        "jobs": state.jobs.read().await.len(),
    }))
}

async fn start_audit(
    State(state): State<AppState>,
    Json(body): Json<AuditRequest>,
) -> impl IntoResponse {
    let url = match audit::validate_public_url(&body.url).await {
        Ok(url) => url,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };
    let id = uuid::Uuid::new_v4().to_string();
    {
        let mut jobs = state.jobs.write().await;
        jobs.insert(
            id.clone(),
            Job {
                id: id.clone(),
                kind: "audit".into(),
                status: "queued".into(),
                progress: Progress::default(),
                result: None,
                error: None,
            },
        );
    }
    let state_clone = state.clone();
    let job_id = id.clone();
    tokio::spawn(async move {
        let _permit = state_clone.permits.acquire().await.ok();
        update_job(&state_clone, &job_id, |job| {
            job.status = "running".into();
            job.progress.phase = "rendering".into();
        })
        .await;

        let progress_state = state_clone.clone();
        let progress_id = job_id.clone();
        let on_progress = move |done: usize, total: usize, current: String| {
            let state = progress_state.clone();
            let id = progress_id.clone();
            tokio::spawn(async move {
                update_job(&state, &id, |job| {
                    job.progress.pages_done = done;
                    job.progress.pages_total = total;
                    job.progress.current_url = current;
                })
                .await;
            });
        };

        let result = audit::run_audit(&url, body.max_pages, &on_progress).await;
        match result {
            Ok(result) => {
                let value = serde_json::to_value(&result).unwrap_or(Value::Null);
                update_job(&state_clone, &job_id, |job| {
                    job.status = "complete".into();
                    job.progress.phase = "complete".into();
                    job.progress.pages_done = result.totals.pages;
                    job.progress.pages_total = result.totals.pages;
                    job.progress.current_url = result.final_url.clone();
                    job.result = Some(value);
                })
                .await;
            }
            Err(error) => {
                update_job(&state_clone, &job_id, |job| {
                    job.status = "failed".into();
                    job.progress.phase = "failed".into();
                    job.error = Some(error.to_string());
                })
                .await;
            }
        }
    });

    (StatusCode::ACCEPTED, Json(json!({ "id": id }))).into_response()
}

async fn start_rescan(
    State(state): State<AppState>,
    Json(body): Json<RescanRequest>,
) -> impl IntoResponse {
    if body.pages.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "no pages to rescan" })),
        )
            .into_response();
    }
    let mut pages = Vec::new();
    for page in body.pages {
        match audit::validate_public_url(&page.url).await {
            Ok(url) => pages.push((url, page.patches)),
            Err(error) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": error.to_string() })),
                )
                    .into_response();
            }
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    {
        let mut jobs = state.jobs.write().await;
        jobs.insert(
            id.clone(),
            Job {
                id: id.clone(),
                kind: "rescan".into(),
                status: "queued".into(),
                progress: Progress::default(),
                result: None,
                error: None,
            },
        );
    }
    let state_clone = state.clone();
    let job_id = id.clone();
    tokio::spawn(async move {
        let _permit = state_clone.permits.acquire().await.ok();
        update_job(&state_clone, &job_id, |job| {
            job.status = "running".into();
            job.progress.phase = "verifying".into();
            job.progress.pages_total = pages.len();
        })
        .await;

        let progress_state = state_clone.clone();
        let progress_id = job_id.clone();
        let on_progress = move |done: usize, total: usize, current: String| {
            let state = progress_state.clone();
            let id = progress_id.clone();
            tokio::spawn(async move {
                update_job(&state, &id, |job| {
                    job.progress.pages_done = done;
                    job.progress.pages_total = total;
                    job.progress.current_url = current;
                })
                .await;
            });
        };

        let result = audit::run_rescan(&pages, &on_progress).await;
        match result {
            Ok(pages) => {
                let value = json!({ "pages": pages });
                update_job(&state_clone, &job_id, |job| {
                    job.status = "complete".into();
                    job.progress.phase = "complete".into();
                    job.progress.pages_done = job.progress.pages_total;
                    job.result = Some(value);
                })
                .await;
            }
            Err(error) => {
                update_job(&state_clone, &job_id, |job| {
                    job.status = "failed".into();
                    job.progress.phase = "failed".into();
                    job.error = Some(error.to_string());
                })
                .await;
            }
        }
    });

    (StatusCode::ACCEPTED, Json(json!({ "id": id }))).into_response()
}

async fn get_job(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let jobs = state.jobs.read().await;
    match jobs.get(&id) {
        Some(job) => (StatusCode::OK, Json(job.clone())).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "job not found" })),
        )
            .into_response(),
    }
}

async fn update_job<F>(state: &AppState, id: &str, change: F)
where
    F: FnOnce(&mut Job),
{
    let mut jobs = state.jobs.write().await;
    if let Some(job) = jobs.get_mut(id) {
        change(job);
    }
    // Keep memory bounded: the app persists results, the engine is a cache.
    if jobs.len() > 200 {
        let mut oldest: Vec<String> = jobs
            .iter()
            .filter(|(_, job)| job.status == "complete" || job.status == "failed")
            .map(|(id, _)| id.clone())
            .collect();
        oldest.truncate(jobs.len().saturating_sub(150));
        for id in oldest {
            jobs.remove(&id);
        }
    }
}
