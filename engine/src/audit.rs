use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::net::IpAddr;

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;

use crate::cdp::ChromeSession;

const AXE: &str = include_str!("../assets/axe.min.js");
const AXE_VERSION: &str = "4.10.2";
const MAX_SNAPSHOT_BYTES: usize = 900_000;
const MAX_PAGE_HEIGHT: f64 = 5200.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proposal {
    pub kind: String,
    pub op: String,
    pub name: String,
    pub value: String,
    #[serde(rename = "needsHuman")]
    pub needs_human: bool,
    pub rationale: String,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub id: String,
    #[serde(rename = "ruleId")]
    pub rule_id: String,
    pub impact: String,
    pub help: String,
    pub description: String,
    #[serde(rename = "helpUrl")]
    pub help_url: String,
    pub tags: Vec<String>,
    pub selector: String,
    pub snippet: String,
    #[serde(rename = "failureSummary")]
    pub failure_summary: String,
    pub rect: Option<Rect>,
    pub text: String,
    pub tag: String,
    pub attrs: BTreeMap<String, String>,
    pub data: Value,
    pub proposal: Option<Proposal>,
    pub page_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cluster {
    pub id: String,
    #[serde(rename = "ruleId")]
    pub rule_id: String,
    pub title: String,
    pub description: String,
    pub impact: String,
    pub count: usize,
    #[serde(rename = "issueIds")]
    pub issue_ids: Vec<String>,
    #[serde(rename = "pageUrls")]
    pub page_urls: Vec<String>,
    #[serde(rename = "fixKind")]
    pub fix_kind: Option<String>,
    #[serde(rename = "needsHuman")]
    pub needs_human: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageResult {
    pub url: String,
    pub title: String,
    pub height: f64,
    pub html: String,
    pub issues: Vec<Issue>,
    pub clusters: Vec<Cluster>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Totals {
    pub issues: usize,
    pub clusters: usize,
    pub pages: usize,
    pub critical: usize,
    pub serious: usize,
    pub moderate: usize,
    pub minor: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditResult {
    #[serde(rename = "startUrl")]
    pub start_url: String,
    #[serde(rename = "finalUrl")]
    pub final_url: String,
    #[serde(rename = "axeVersion")]
    pub axe_version: String,
    #[serde(rename = "viewportWidth")]
    pub viewport_width: f64,
    pub pages: Vec<PageResult>,
    pub clusters: Vec<Cluster>,
    pub totals: Totals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Patch {
    pub id: String,
    pub selector: String,
    pub op: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub value: String,
    #[serde(default, rename = "ruleId")]
    pub rule_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchOutcome {
    pub id: String,
    pub applied: bool,
    pub verified: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RescanPage {
    pub url: String,
    pub title: String,
    pub height: f64,
    pub html: String,
    pub issues: Vec<Issue>,
    pub clusters: Vec<Cluster>,
    pub patches: Vec<PatchOutcome>,
}

pub async fn validate_public_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| anyhow::anyhow!("Enter a full http(s) URL."))?;
    if !matches!(url.scheme(), "http" | "https") {
        bail!("Only http and https URLs can be audited.");
    }
    if !url.username().is_empty() || url.password().is_some() {
        bail!("URLs with embedded credentials are not allowed.");
    }
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("That URL has no hostname."))?
        .to_ascii_lowercase();
    if std::env::var("ALLOW_PRIVATE_URLS").ok().as_deref() == Some("1") {
        return Ok(url);
    }
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host == "metadata.google.internal"
    {
        bail!("Local and internal hostnames cannot be audited.");
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !is_public_ip(ip) {
            bail!("Private and loopback addresses cannot be audited.");
        }
        return Ok(url);
    }
    let port = url.port_or_known_default().unwrap_or(80);
    let addrs = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| anyhow::anyhow!("That hostname could not be resolved."))?;
    let mut any = false;
    for addr in addrs {
        any = true;
        if !is_public_ip(addr.ip()) {
            bail!("That hostname resolves to a private address, which cannot be audited.");
        }
    }
    if !any {
        bail!("That hostname did not resolve to an address.");
    }
    Ok(url)
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(o[0] == 0
                || o[0] == 10
                || o[0] == 127
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] == 169 && o[1] == 254)
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
                || o[0] >= 224)
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || (s[0] & 0xfe00) == 0xfc00
                || (s[0] & 0xffc0) == 0xfe80
                || (s[0] & 0xff00) == 0xff00)
        }
    }
}

pub async fn render_page(url: &Url) -> Result<PageResult> {
    let session = ChromeSession::launch().await?;
    let result = render_in_session(&session, url.as_str()).await;
    session.close().await;
    result
}

async fn render_in_session(session: &ChromeSession, url: &str) -> Result<PageResult> {
    session.goto(url).await?;
    let final_url = session.url().await?;
    let final_parsed = Url::parse(&final_url)
        .map_err(|_| anyhow::anyhow!("Page landed on an invalid URL."))?;
    validate_public_url(final_parsed.as_str()).await?;

    session.eval(AXE).await?;
    let raw = session.eval(AXE_RUN).await?;
    let raw = raw
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("axe returned no data"))?;
    let parsed: Value = serde_json::from_str(raw)?;

    let title = parsed
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let height = parsed
        .get("height")
        .and_then(|v| v.as_f64())
        .unwrap_or(900.0)
        .clamp(600.0, MAX_PAGE_HEIGHT);

    let issues = issues_from_axe(&parsed, &final_url);
    let clusters = cluster_issues(&issues);

    let html_raw = session
        .eval("document.documentElement.outerHTML")
        .await?
        .as_str()
        .unwrap_or_default()
        .to_string();
    let html = sanitize_snapshot(&html_raw, &final_url, height);

    Ok(PageResult {
        url: final_url,
        title,
        height,
        html,
        issues,
        clusters,
    })
}

fn issues_from_axe(parsed: &Value, page_url: &str) -> Vec<Issue> {
    let mut issues = Vec::new();
    let Some(violations) = parsed.get("violations").and_then(|v| v.as_array()) else {
        return issues;
    };
    let mut index = 0usize;
    for violation in violations {
        let rule_id = violation
            .get("ruleId")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let impact = violation
            .get("impact")
            .and_then(|v| v.as_str())
            .unwrap_or("minor");
        let help = violation.get("help").and_then(|v| v.as_str()).unwrap_or("");
        let description = violation
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let help_url = violation
            .get("helpUrl")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let tags: Vec<String> = violation
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let Some(nodes) = violation.get("nodes").and_then(|v| v.as_array()) else {
            continue;
        };
        for node in nodes {
            index += 1;
            let selector = node
                .get("selector")
                .and_then(|v| v.as_str())
                .unwrap_or("html")
                .to_string();
            let rect = node
                .get("rect")
                .and_then(|r| serde_json::from_value::<Rect>(r.clone()).ok());
            let attrs = node
                .get("attrs")
                .and_then(|v| serde_json::from_value::<BTreeMap<String, String>>(v.clone()).ok())
                .unwrap_or_default();
            let data = node
                .get("any")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|first| first.get("data"))
                .cloned()
                .unwrap_or(Value::Null);
            let mut issue = Issue {
                id: format!("{}-{}", rule_id, index),
                rule_id: rule_id.to_string(),
                impact: impact.to_string(),
                help: help.to_string(),
                description: description.to_string(),
                help_url: help_url.to_string(),
                tags: tags.clone(),
                selector,
                snippet: node
                    .get("snippet")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                failure_summary: node
                    .get("failureSummary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                rect,
                text: node
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                tag: node
                    .get("tag")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                attrs,
                data,
                proposal: None,
                page_url: page_url.to_string(),
            };
            issue.proposal = propose_fix(&issue, parsed);
            issues.push(issue);
        }
    }
    issues
}

fn propose_fix(issue: &Issue, page: &Value) -> Option<Proposal> {
    match issue.rule_id.as_str() {
        "color-contrast" => {
            let fg = issue
                .data
                .get("fgColor")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let bg = issue
                .data
                .get("bgColor")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let expected = issue
                .data
                .get("expectedContrastRatio")
                .and_then(|v| v.as_str())
                .and_then(|s| s.trim_end_matches(':').trim().parse::<f64>().ok())
                .unwrap_or(4.5);
            let before = issue
                .data
                .get("contrastRatio")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            if fg.is_empty() || bg.is_empty() {
                return None;
            }
            let candidate = propose_contrast(fg, bg, expected)?;
            let after = contrast_ratio(&candidate, bg).unwrap_or(expected);
            Some(Proposal {
                kind: "contrast".into(),
                op: "set-style".into(),
                name: "color".into(),
                value: candidate.clone(),
                needs_human: false,
                rationale: format!(
                    "{fg} on {bg} measures {before:.2}:1. {candidate} measures {after:.2}:1 against the {expected:.1}:1 requirement."
                ),
                before: fg.to_string(),
                after: candidate,
            })
        }
        "image-alt" | "input-image-alt" | "area-alt" => Some(Proposal {
            kind: "alt".into(),
            op: "set-attr".into(),
            name: "alt".into(),
            value: String::new(),
            needs_human: true,
            rationale: "Automation cannot know what an image communicates. Write the alternative it needs, or leave it empty only if the image is purely decorative.".into(),
            before: issue.attrs.get("alt").cloned().unwrap_or_default(),
            after: String::new(),
        }),
        "label" | "select-name" => {
            let guess = issue
                .attrs
                .get("placeholder")
                .or_else(|| issue.attrs.get("name"))
                .or_else(|| issue.attrs.get("id"))
                .or_else(|| issue.attrs.get("title"))
                .cloned()
                .unwrap_or_default();
            let guess = humanize(&guess);
            Some(Proposal {
                kind: "label".into(),
                op: "set-attr".into(),
                name: "aria-label".into(),
                value: guess.clone(),
                needs_human: true,
                rationale: "A programmatic label is required. Confirm the wording matches what the field asks for.".into(),
                before: issue.attrs.get("aria-label").cloned().unwrap_or_default(),
                after: guess,
            })
        }
        "link-name" => {
            let guess = if !issue.text.trim().is_empty() {
                issue.text.trim().to_string()
            } else {
                humanize(
                    issue
                        .attrs
                        .get("title")
                        .or_else(|| issue.attrs.get("href"))
                        .map(|s| s.as_str())
                        .unwrap_or(""),
                )
            };
            Some(Proposal {
                kind: "link-name".into(),
                op: "set-attr".into(),
                name: "aria-label".into(),
                value: guess.clone(),
                needs_human: true,
                rationale: "The link needs a name a screen reader can announce. Confirm it describes the destination.".into(),
                before: issue.attrs.get("aria-label").cloned().unwrap_or_default(),
                after: guess,
            })
        }
        "button-name" => {
            let guess = if issue.text.trim().is_empty() {
                "Button".to_string()
            } else {
                issue.text.trim().to_string()
            };
            Some(Proposal {
                kind: "button-name".into(),
                op: "set-attr".into(),
                name: "aria-label".into(),
                value: guess.clone(),
                needs_human: true,
                rationale: "The button needs a name a screen reader can announce.".into(),
                before: issue.attrs.get("aria-label").cloned().unwrap_or_default(),
                after: guess,
            })
        }
        "html-has-lang" => Some(Proposal {
            kind: "lang".into(),
            op: "set-attr".into(),
            name: "lang".into(),
            value: "en".into(),
            needs_human: true,
            rationale: "Declare the page language so screen readers pronounce content correctly. Change this if the page is not English.".into(),
            before: issue.attrs.get("lang").cloned().unwrap_or_default(),
            after: "en".into(),
        }),
        "document-title" => {
            let h1 = page
                .get("h1")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            Some(Proposal {
                kind: "title".into(),
                op: "set-text".into(),
                name: String::new(),
                value: h1.clone(),
                needs_human: true,
                rationale: "Every page needs a title that names it. Confirm the wording.".into(),
                before: String::new(),
                after: h1,
            })
        }
        _ => None,
    }
}

fn cluster_issues(issues: &[Issue]) -> Vec<Cluster> {
    let mut by_rule: HashMap<&str, Vec<&Issue>> = HashMap::new();
    for issue in issues {
        by_rule.entry(issue.rule_id.as_str()).or_default().push(issue);
    }
    let mut clusters: Vec<Cluster> = by_rule
        .into_iter()
        .map(|(rule_id, members)| {
            let first = members[0];
            let (title, fix_kind, needs_human) = cluster_meta(rule_id);
            let mut pages: BTreeSet<String> = BTreeSet::new();
            for member in &members {
                pages.insert(member.page_url.clone());
            }
            Cluster {
                id: rule_id.to_string(),
                rule_id: rule_id.to_string(),
                title: title.to_string(),
                description: first.description.clone(),
                impact: first.impact.clone(),
                count: members.len(),
                issue_ids: members.iter().map(|i| i.id.clone()).collect(),
                page_urls: pages.into_iter().collect(),
                fix_kind: fix_kind.map(String::from),
                needs_human,
            }
        })
        .collect();
    clusters.sort_by(|a, b| {
        impact_rank(&b.impact)
            .cmp(&impact_rank(&a.impact))
            .then(b.count.cmp(&a.count))
    });
    clusters
}

fn cluster_meta(rule_id: &str) -> (&'static str, Option<&'static str>, bool) {
    match rule_id {
        "color-contrast" => ("Low contrast text", Some("contrast"), false),
        "image-alt" | "input-image-alt" | "area-alt" => {
            ("Images without text alternatives", Some("alt"), true)
        }
        "label" => ("Form fields without labels", Some("label"), true),
        "select-name" => ("Select fields without names", Some("label"), true),
        "link-name" => ("Links without a discernible name", Some("link-name"), true),
        "button-name" => ("Buttons without a discernible name", Some("button-name"), true),
        "html-has-lang" => ("Page language not declared", Some("lang"), true),
        "document-title" => ("Page has no title", Some("title"), true),
        "heading-order" => ("Heading levels skip", None, true),
        "landmark-one-main" => ("No main landmark", None, true),
        "region" => ("Content outside landmarks", None, true),
        "duplicate-id" | "duplicate-id-aria" => ("Duplicate element IDs", None, true),
        "frame-title" => ("Frames without titles", Some("label"), true),
        "link-in-text-block" => ("Links indistinguishable without color", None, true),
        "target-size" => ("Touch targets too small", None, true),
        _ => ("Accessibility violations", None, true),
    }
}

fn impact_rank(impact: &str) -> u8 {
    match impact {
        "critical" => 4,
        "serious" => 3,
        "moderate" => 2,
        _ => 1,
    }
}

pub async fn run_audit(
    start: &Url,
    max_pages: usize,
    progress: &(dyn Fn(usize, usize, String) + Sync),
) -> Result<AuditResult> {
    let max_pages = max_pages.clamp(1, 6);
    let session = ChromeSession::launch().await?;
    let mut pages: Vec<PageResult> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut queue: Vec<Url> = vec![start.clone()];

    while !queue.is_empty() && pages.len() < max_pages {
        let next = queue.remove(0);
        let key = canonical_key(&next);
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        progress(pages.len(), max_pages, next.to_string());

        match render_in_session(&session, next.as_str()).await {
            Ok(page) => {
                if pages.is_empty() {
                    if let Ok(Some(links)) = session
                        .eval(
                            "JSON.stringify(Array.from(document.querySelectorAll('a[href]')).map(a => a.href))",
                        )
                        .await
                        .map(|v| v.as_str().map(String::from))
                    {
                        if let Ok(list) = serde_json::from_str::<Vec<String>>(&links) {
                            let origin = Url::parse(&page.url).ok();
                            for link in list {
                                if queue.len() + pages.len() + 1 > max_pages {
                                    break;
                                }
                                let Ok(candidate) = Url::parse(&link) else {
                                    continue;
                                };
                                let Some(origin) = origin.as_ref() else {
                                    continue;
                                };
                                if candidate.host_str() == origin.host_str()
                                    && matches!(candidate.scheme(), "http" | "https")
                                    && !has_asset_extension(candidate.path())
                                    && !candidate.path().contains("/login")
                                    && !candidate.path().contains("/logout")
                                    && !seen.contains(&canonical_key(&candidate))
                                {
                                    queue.push(candidate);
                                }
                            }
                        }
                    }
                }
                pages.push(page);
            }
            Err(_) if pages.is_empty() => {
                session.close().await;
                return Err(anyhow::anyhow!("The page could not be rendered."));
            }
            Err(_) => {}
        }
    }

    if pages.is_empty() {
        session.close().await;
        bail!("No pages could be audited.");
    }
    session.close().await;

    let clusters = merge_clusters(&pages);
    let totals = totals_for(&pages, &clusters);
    let final_url = pages[0].url.clone();
    Ok(AuditResult {
        start_url: start.to_string(),
        final_url,
        axe_version: AXE_VERSION.to_string(),
        viewport_width: 1280.0,
        pages,
        clusters,
        totals,
    })
}

fn has_asset_extension(path: &str) -> bool {
    let last = path
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    [
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico", ".css", ".js", ".mjs",
        ".json", ".xml", ".pdf", ".zip", ".woff", ".woff2", ".ttf", ".mp4", ".webm", ".mp3",
    ]
    .iter()
    .any(|ext| last.ends_with(ext))
}

fn canonical_key(url: &Url) -> String {
    let mut path = url.path().to_string();
    if path.ends_with("/index.html") {
        path.truncate(path.len() - "/index.html".len());
    }
    if path.is_empty() {
        path = "/".to_string();
    }
    format!(
        "{}://{}{}",
        url.scheme(),
        url.host_str().unwrap_or(""),
        path.trim_end_matches('/')
    )
}

fn merge_clusters(pages: &[PageResult]) -> Vec<Cluster> {
    let mut by_rule: HashMap<String, Cluster> = HashMap::new();
    for page in pages {
        for cluster in &page.clusters {
            let entry = by_rule
                .entry(cluster.rule_id.clone())
                .or_insert_with(|| Cluster {
                    id: cluster.rule_id.clone(),
                    rule_id: cluster.rule_id.clone(),
                    title: cluster.title.clone(),
                    description: cluster.description.clone(),
                    impact: cluster.impact.clone(),
                    count: 0,
                    issue_ids: Vec::new(),
                    page_urls: Vec::new(),
                    fix_kind: cluster.fix_kind.clone(),
                    needs_human: cluster.needs_human,
                });
            entry.count += cluster.count;
            entry.issue_ids.extend(cluster.issue_ids.iter().cloned());
            for url in &cluster.page_urls {
                if !entry.page_urls.contains(url) {
                    entry.page_urls.push(url.clone());
                }
            }
        }
    }
    let mut clusters: Vec<Cluster> = by_rule.into_values().collect();
    clusters.sort_by(|a, b| {
        impact_rank(&b.impact)
            .cmp(&impact_rank(&a.impact))
            .then(b.count.cmp(&a.count))
    });
    clusters
}

fn totals_for(pages: &[PageResult], clusters: &[Cluster]) -> Totals {
    let mut totals = Totals {
        issues: 0,
        clusters: clusters.len(),
        pages: pages.len(),
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0,
    };
    for page in pages {
        for issue in &page.issues {
            totals.issues += 1;
            match issue.impact.as_str() {
                "critical" => totals.critical += 1,
                "serious" => totals.serious += 1,
                "moderate" => totals.moderate += 1,
                _ => totals.minor += 1,
            }
        }
    }
    totals
}

pub async fn run_rescan(
    pages: &[(Url, Vec<Patch>)],
    progress: &(dyn Fn(usize, usize, String) + Sync),
) -> Result<Vec<RescanPage>> {
    let session = ChromeSession::launch().await?;
    let mut out = Vec::new();
    for (index, (url, patches)) in pages.iter().enumerate() {
        progress(index, pages.len(), url.to_string());
        match rescan_in_session(&session, url, patches).await {
            Ok(page) => out.push(page),
            Err(_) => out.push(RescanPage {
                url: url.to_string(),
                title: String::new(),
                height: 900.0,
                html: String::new(),
                issues: Vec::new(),
                clusters: Vec::new(),
                patches: patches
                    .iter()
                    .map(|p| PatchOutcome {
                        id: p.id.clone(),
                        applied: false,
                        verified: false,
                        reason: "The page could not be re-rendered.".into(),
                    })
                    .collect(),
            }),
        }
    }
    session.close().await;
    Ok(out)
}

async fn rescan_in_session(
    session: &ChromeSession,
    url: &Url,
    patches: &[Patch],
) -> Result<RescanPage> {
    session.goto(url.as_str()).await?;
    let final_url = session.url().await?;
    validate_public_url(&final_url).await?;

    session.eval(AXE).await?;

    let patch_json = serde_json::to_string(patches)?;
    let apply_script = format!(
        r#"(() => {{
          const patches = {patch_json};
          const out = [];
          for (const p of patches) {{
            let el = null;
            try {{ el = document.querySelector(p.selector); }} catch (e) {{}}
            if (!el) {{ out.push({{ id: p.id, applied: false, reason: 'The element was not found on the page.' }}); continue; }}
            try {{
              if (p.op === 'set-attr') el.setAttribute(p.name, p.value);
              else if (p.op === 'set-text') el.textContent = p.value;
              else if (p.op === 'set-style') el.style.setProperty(p.name, p.value, 'important');
              out.push({{ id: p.id, applied: true, reason: 'Applied.' }});
            }} catch (e) {{
              out.push({{ id: p.id, applied: false, reason: String(e) }});
            }}
          }}
          return JSON.stringify(out);
        }})()"#
    );
    let applied_raw = session.eval(&apply_script).await?;
    let applied: Vec<Value> = serde_json::from_str(applied_raw.as_str().unwrap_or("[]"))?;

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let after_raw = session.eval(AXE_RUN).await?;
    let after: Value = serde_json::from_str(after_raw.as_str().unwrap_or("{}"))?;
    let after_issues = issues_from_axe(&after, &final_url);
    let clusters = cluster_issues(&after_issues);

    let mut outcomes = Vec::new();
    for patch in patches {
        let was_applied = applied
            .iter()
            .find(|v| v.get("id").and_then(|x| x.as_str()) == Some(patch.id.as_str()));
        let applied_ok = was_applied
            .and_then(|v| v.get("applied"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !applied_ok {
            outcomes.push(PatchOutcome {
                id: patch.id.clone(),
                applied: false,
                verified: false,
                reason: was_applied
                    .and_then(|v| v.get("reason"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("The fix could not be applied.")
                    .to_string(),
            });
            continue;
        }
        let derived_rule;
        let rule_id = if patch.rule_id.is_empty() {
            derived_rule = patch.id.split('-').next().unwrap_or("").to_string();
            derived_rule.as_str()
        } else {
            patch.rule_id.as_str()
        };
        let still_failing = after_issues.iter().any(|issue| {
            issue.selector == patch.selector
                && (issue.rule_id == rule_id || related_rule(&issue.rule_id, rule_id))
        });
        outcomes.push(PatchOutcome {
            id: patch.id.clone(),
            applied: true,
            verified: !still_failing,
            reason: if still_failing {
                "Re-scan still reports this element. The fix may need a different value or a manual change.".into()
            } else {
                "Re-scan no longer reports this element.".into()
            },
        });
    }

    let title = after
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let height = after
        .get("height")
        .and_then(|v| v.as_f64())
        .unwrap_or(900.0)
        .clamp(600.0, MAX_PAGE_HEIGHT);
    let html_raw = session
        .eval("document.documentElement.outerHTML")
        .await?
        .as_str()
        .unwrap_or_default()
        .to_string();
    let html = sanitize_snapshot(&html_raw, &final_url, height);

    Ok(RescanPage {
        url: final_url,
        title,
        height,
        html,
        issues: after_issues,
        clusters,
        patches: outcomes,
    })
}

fn related_rule(found: &str, original: &str) -> bool {
    matches!(
        (found, original),
        ("image-alt", "input-image-alt")
            | ("input-image-alt", "image-alt")
            | ("label", "select-name")
            | ("select-name", "label")
    )
}

const AXE_RUN: &str = r#"(async () => {
  const result = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] },
    resultTypes: ['violations'],
    ancestry: false,
  });
  const h1 = (document.querySelector('h1') || {}).textContent || '';
  const violations = result.violations.map(v => ({
    ruleId: v.id,
    impact: v.impact,
    help: v.help,
    description: v.description,
    helpUrl: v.helpUrl,
    tags: v.tags,
    nodes: v.nodes.map(n => {
      const target = Array.isArray(n.target) ? n.target[n.target.length - 1] : n.target;
      let el = null;
      try { el = document.querySelector(target); } catch (e) {}
      let rect = null, snippet = n.html || '', text = '', tag = '', attrs = {};
      if (el) {
        const r = el.getBoundingClientRect();
        rect = { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
        snippet = (el.outerHTML || '').slice(0, 600);
        text = (el.innerText || el.textContent || '').trim().slice(0, 180);
        tag = el.tagName ? el.tagName.toLowerCase() : '';
        for (const a of ['placeholder','name','id','type','title','href','value','role','aria-label','alt','lang']) {
          if (el.hasAttribute && el.hasAttribute(a)) attrs[a] = el.getAttribute(a);
        }
      }
      return {
        selector: target,
        snippet,
        text,
        tag,
        attrs,
        rect,
        failureSummary: n.failureSummary || '',
        any: n.any || [],
        all: n.all || [],
      };
    }),
  }));
  return JSON.stringify({
    title: document.title,
    lang: document.documentElement.lang,
    url: location.href,
    h1: h1.trim().slice(0, 180),
    axeVersion: axe.version,
    height: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight, document.documentElement.offsetHeight),
    violations,
  });
})()"#;

fn sanitize_snapshot(html: &str, base_url: &str, height: f64) -> String {
    let mut out = html.to_string();
    for tag in ["script", "iframe", "object", "embed", "noscript"] {
        out = strip_tags(&out, tag);
    }
    out = strip_event_handlers(&out);
    out = strip_csp_meta(&out);
    out = out.replace("javascript:", "#");

    let base = format!(
        r#"<base href="{}"><style>html{{scroll-behavior:auto!important}}*,*::before,*::after{{animation:none!important;transition:none!important;caret-color:transparent!important}}body{{min-height:{}px}}</style>"#,
        escape_attr(base_url),
        height as i64
    );
    if let Some(pos) = out.to_ascii_lowercase().find("<head") {
        if let Some(end) = out[pos..].find('>') {
            out.insert_str(pos + end + 1, &base);
        } else {
            out = format!("{base}{out}");
        }
    } else {
        out = format!("{base}{out}");
    }
    if out.len() > MAX_SNAPSHOT_BYTES {
        out.truncate(MAX_SNAPSHOT_BYTES);
    }
    out
}

fn strip_tags(html: &str, tag: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut cursor = 0usize;
    while let Some(start) = lower[cursor..].find(&open) {
        let start = cursor + start;
        out.push_str(&html[cursor..start]);
        if let Some(end_rel) = lower[start..].find(&close) {
            cursor = start + end_rel + close.len();
        } else if let Some(end_rel) = lower[start..].find('>') {
            cursor = start + end_rel + 1;
        } else {
            cursor = html.len();
        }
    }
    out.push_str(&html[cursor.min(html.len())..]);
    out
}

fn strip_event_handlers(html: &str) -> String {
    let chars: Vec<char> = html.chars().collect();
    let mut out = String::with_capacity(html.len());
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i].is_whitespace()
            && i + 2 < chars.len()
            && chars[i + 1].eq_ignore_ascii_case(&'o')
            && chars[i + 2].eq_ignore_ascii_case(&'n')
        {
            let mut j = i + 3;
            while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '-') {
                j += 1;
            }
            let mut k = j;
            while k < chars.len() && chars[k].is_whitespace() {
                k += 1;
            }
            if k < chars.len() && chars[k] == '=' {
                k += 1;
                while k < chars.len() && chars[k].is_whitespace() {
                    k += 1;
                }
                if k < chars.len() && (chars[k] == '"' || chars[k] == '\'') {
                    let quote = chars[k];
                    k += 1;
                    while k < chars.len() && chars[k] != quote {
                        k += 1;
                    }
                    if k < chars.len() {
                        k += 1;
                    }
                } else {
                    while k < chars.len() && !chars[k].is_whitespace() && chars[k] != '>' {
                        k += 1;
                    }
                }
                i = k;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn strip_csp_meta(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find("<meta") {
        let start = cursor + rel;
        let Some(end_rel) = lower[start..].find('>') else {
            break;
        };
        let end = start + end_rel + 1;
        out.push_str(&html[cursor..start]);
        if !lower[start..end].contains("content-security-policy") {
            out.push_str(&html[start..end]);
        }
        cursor = end;
    }
    out.push_str(&html[cursor..]);
    out
}

fn escape_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn humanize(raw: &str) -> String {
    let base = raw
        .rsplit('/')
        .next()
        .unwrap_or(raw)
        .split(['?', '#'])
        .next()
        .unwrap_or(raw)
        .replace(['_', '-'], " ");
    let trimmed = base.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut chars = trimmed.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn parse_color(raw: &str) -> Option<(f64, f64, f64)> {
    let raw = raw.trim();
    if let Some(hex) = raw.strip_prefix('#') {
        let hex = hex.trim();
        let (r, g, b) = match hex.len() {
            3 => (
                u8::from_str_radix(&hex[0..1].repeat(2), 16).ok()?,
                u8::from_str_radix(&hex[1..2].repeat(2), 16).ok()?,
                u8::from_str_radix(&hex[2..3].repeat(2), 16).ok()?,
            ),
            6 => (
                u8::from_str_radix(&hex[0..2], 16).ok()?,
                u8::from_str_radix(&hex[2..4], 16).ok()?,
                u8::from_str_radix(&hex[4..6], 16).ok()?,
            ),
            _ => return None,
        };
        return Some((r as f64, g as f64, b as f64));
    }
    if let Some(inner) = raw.strip_prefix("rgb(").and_then(|s| s.strip_suffix(')')) {
        let parts: Vec<f64> = inner
            .split(',')
            .filter_map(|p| p.trim().parse::<f64>().ok())
            .collect();
        if parts.len() >= 3 {
            return Some((parts[0], parts[1], parts[2]));
        }
    }
    None
}

fn channel_luminance(value: f64) -> f64 {
    let c = value / 255.0;
    if c <= 0.03928 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn relative_luminance(rgb: (f64, f64, f64)) -> f64 {
    0.2126 * channel_luminance(rgb.0)
        + 0.7152 * channel_luminance(rgb.1)
        + 0.0722 * channel_luminance(rgb.2)
}

fn contrast_ratio(a: &str, b: &str) -> Option<f64> {
    let la = relative_luminance(parse_color(a)?);
    let lb = relative_luminance(parse_color(b)?);
    let (light, dark) = if la > lb { (la, lb) } else { (lb, la) };
    Some((light + 0.05) / (dark + 0.05))
}

fn to_hex(rgb: (f64, f64, f64)) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        rgb.0.round().clamp(0.0, 255.0) as u8,
        rgb.1.round().clamp(0.0, 255.0) as u8,
        rgb.2.round().clamp(0.0, 255.0) as u8
    )
}

fn mix(a: (f64, f64, f64), b: (f64, f64, f64), t: f64) -> (f64, f64, f64) {
    (
        a.0 + (b.0 - a.0) * t,
        a.1 + (b.1 - a.1) * t,
        a.2 + (b.2 - a.2) * t,
    )
}

fn propose_contrast(fg: &str, bg: &str, expected: f64) -> Option<String> {
    let fg_rgb = parse_color(fg)?;
    let bg_rgb = parse_color(bg)?;
    let _ = bg_rgb;
    let mut best: Option<((f64, f64, f64), f64)> = None;
    for target in [(0.0, 0.0, 0.0), (255.0, 255.0, 255.0)] {
        for step in 0..=100 {
            let candidate = mix(fg_rgb, target, step as f64 / 100.0);
            let hex = to_hex(candidate);
            if contrast_ratio(&hex, bg).unwrap_or(0.0) >= expected {
                let distance = (candidate.0 - fg_rgb.0).powi(2)
                    + (candidate.1 - fg_rgb.1).powi(2)
                    + (candidate.2 - fg_rgb.2).powi(2);
                if best.map(|(_, d)| distance < d).unwrap_or(true) {
                    best = Some((candidate, distance));
                }
                break;
            }
        }
    }
    best.map(|(rgb, _)| to_hex(rgb))
}

#[allow(dead_code)]
fn _unused(_: Value) -> Value {
    json!(null)
}
