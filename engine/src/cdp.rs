use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// A deliberately untyped CDP client.
///
/// Chrome's protocol gains fields every release; strongly typed bindings break
/// the websocket reader when they meet an unknown field (which is exactly what
/// happened with chromiumoxide against Chrome 149). Parsing every frame as
/// `serde_json::Value` keeps the transport stable across Chrome versions.
pub struct Cdp {
    tx: mpsc::UnboundedSender<Message>,
    pending: Pending,
    next_id: AtomicU64,
}

impl Cdp {
    pub async fn connect(ws_url: &str) -> Result<Self> {
        let (stream, _) = tokio_tungstenite::connect_async(ws_url)
            .await
            .context("connect to chrome devtools websocket")?;
        let (mut sink, mut source) = stream.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sink.send(msg).await.is_err() {
                    break;
                }
            }
        });

        let reader_pending = pending.clone();
        tokio::spawn(async move {
            while let Some(frame) = source.next().await {
                let Ok(frame) = frame else { break };
                let Message::Text(text) = frame else { continue };
                let Ok(value) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                let Some(id) = value.get("id").and_then(|v| v.as_u64()) else {
                    // Events are ignored: this client polls state instead of
                    // subscribing to a protocol surface that keeps changing.
                    continue;
                };
                if let Some(sender) = reader_pending.lock().await.remove(&id) {
                    if let Some(err) = value.get("error") {
                        let _ = sender.send(Err(err.to_string()));
                    } else {
                        let _ = sender.send(Ok(value.get("result").cloned().unwrap_or(Value::Null)));
                    }
                }
            }
        });

        Ok(Self {
            tx,
            pending,
            next_id: AtomicU64::new(1),
        })
    }

    pub async fn send(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        let payload = json!({ "id": id, "method": method, "params": params }).to_string();
        self.tx
            .send(Message::Text(payload.into()))
            .map_err(|_| anyhow!("chrome devtools socket closed"))?;
        match tokio::time::timeout(Duration::from_secs(45), rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(err))) => bail!("cdp {method} failed: {err}"),
            Ok(Err(_)) => bail!("cdp {method} response dropped"),
            Err(_) => bail!("cdp {method} timed out"),
        }
    }

    pub async fn eval(&self, expression: &str) -> Result<Value> {
        let result = self
            .send(
                "Runtime.evaluate",
                json!({
                    "expression": expression,
                    "awaitPromise": true,
                    "returnByValue": true,
                    "userGesture": true,
                }),
            )
            .await?;
        if let Some(exception) = result.get("exceptionDetails") {
            bail!("page script failed: {}", exception);
        }
        Ok(result
            .get("result")
            .and_then(|r| r.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }
}

pub struct ChromeSession {
    child: Child,
    cdp: Cdp,
    dir: PathBuf,
}

impl ChromeSession {
    pub async fn launch() -> Result<Self> {
        let chrome = std::env::var("CHROME_PATH")
            .unwrap_or_else(|_| "/usr/bin/chromium".to_string());
        let dir = std::env::temp_dir().join(format!("unbarred-chrome-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir)?;

        let mut child = Command::new(&chrome)
            .arg("--headless=new")
            .arg("--no-sandbox")
            .arg("--disable-gpu")
            .arg("--disable-dev-shm-usage")
            .arg("--hide-scrollbars")
            .arg("--mute-audio")
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--disable-background-networking")
            .arg("--disable-extensions")
            .arg("--disable-sync")
            .arg("--window-size=1280,900")
            .arg("--remote-debugging-port=0")
            .arg(format!("--user-data-dir={}", dir.display()))
            .arg("about:blank")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .with_context(|| format!("launch chrome at {chrome}"))?;

        let port_file = dir.join("DevToolsActivePort");
        let mut port = None;
        for _ in 0..100 {
            if let Ok(contents) = std::fs::read_to_string(&port_file) {
                if let Some(line) = contents.lines().next() {
                    if let Ok(value) = line.trim().parse::<u16>() {
                        port = Some(value);
                        break;
                    }
                }
            }
            if let Ok(Some(_)) = child.try_wait() {
                bail!("chrome exited before the devtools port opened");
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let port = port.ok_or_else(|| anyhow!("chrome devtools port never appeared"))?;

        let ws_url = wait_for_page_socket(port).await?;
        let cdp = Cdp::connect(&ws_url).await?;
        let session = Self { child, cdp, dir };
        session
            .cdp
            .send(
                "Emulation.setDeviceMetricsOverride",
                json!({ "width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": false }),
            )
            .await?;
        session.cdp.send("Page.enable", json!({})).await?;
        Ok(session)
    }

    pub async fn goto(&self, url: &str) -> Result<()> {
        self.cdp
            .send("Page.navigate", json!({ "url": url }))
            .await
            .context("navigate")?;

        // Wait for the document to actually be the requested one before trusting
        // readyState: a navigation leaves the old document "complete" for a beat.
        let target = url.to_string();
        let mut arrived = false;
        for _ in 0..120 {
            let current = self.cdp.eval("location.href").await.unwrap_or(Value::Null);
            let current = current.as_str().unwrap_or_default().to_string();
            if same_document(&current, &target) {
                arrived = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !arrived {
            // Client-side redirects may land on a different path; accept any
            // http(s) document rather than failing the whole audit.
            let current = self.cdp.eval("location.href").await.unwrap_or(Value::Null);
            if !current.as_str().unwrap_or_default().starts_with("http") {
                bail!("navigation did not reach an http document");
            }
        }

        for _ in 0..120 {
            let ready = self.cdp.eval("document.readyState").await.unwrap_or(Value::Null);
            if ready.as_str() == Some("complete") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        // Give hydration and late layout a moment to settle.
        tokio::time::sleep(Duration::from_millis(900)).await;
        Ok(())
    }

    pub async fn eval(&self, expression: &str) -> Result<Value> {
        self.cdp.eval(expression).await
    }

    pub async fn url(&self) -> Result<String> {
        Ok(self
            .cdp
            .eval("location.href")
            .await?
            .as_str()
            .unwrap_or_default()
            .to_string())
    }

    pub async fn close(mut self) {
        let _ = self.child.kill();
        let _ = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(Some(_)) = self.child.try_wait() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await;
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Drop for ChromeSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

async fn wait_for_page_socket(port: u16) -> Result<String> {
    let client = reqwest::Client::new();
    for _ in 0..100 {
        let response = client
            .get(format!("http://127.0.0.1:{port}/json/list"))
            .timeout(Duration::from_secs(2))
            .send()
            .await;
        if let Ok(response) = response {
            if let Ok(pages) = response.json::<Value>().await {
                if let Some(list) = pages.as_array() {
                    for page in list {
                        if page.get("type").and_then(|v| v.as_str()) == Some("page") {
                            if let Some(ws) = page.get("webSocketDebuggerUrl").and_then(|v| v.as_str()) {
                                return Ok(ws.to_string());
                            }
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!("no page target exposed by chrome")
}

fn same_document(current: &str, target: &str) -> bool {
    let strip = |s: &str| s.split('#').next().unwrap_or(s).trim_end_matches('/').to_string();
    strip(current) == strip(target)
}
