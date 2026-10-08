//! Conservative cache roots and ordinary-content blockers. No deletion or ownership here.
use super::*;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactCandidate {
    pub path: String,
    pub kind: String,
    pub evidence: String,
    pub estimated_bytes: Option<u64>,
    pub estimated_entries: Option<u64>,
    pub deletes_entire_directory: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupBlocker {
    pub path: String,
    pub reason: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Classification {
    pub candidates: Vec<ArtifactCandidate>,
    pub preserved: Vec<CleanupBlocker>,
    pub provenance_notice: String,
}

fn safe_candidate_root(ctx: &Context, path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors().take_while(|p| *p != ctx.target) {
        let meta =
            fs::symlink_metadata(ancestor).map_err(|e| format!("finish_metadata_failed: {e}"))?;
        if receipt::unsafe_link(&meta) {
            return Err("finish_artifact_root_link".into());
        }
    }
    receipt::root_identity(path)?;
    Ok(())
}
fn text(path: &Path) -> Result<String, String> {
    let m = fs::symlink_metadata(path)
        .map_err(|e| format!("finish_manifest_read_failed: {}: {e}", path.display()))?;
    if receipt::unsafe_link(&m) || !m.is_file() || m.len() > 1024 * 1024 {
        return Err("finish_package_metadata_invalid".into());
    }
    fs::read_to_string(path).map_err(|e| format!("finish_manifest_read_failed: {e}"))
}
// Installation markers alone are not evidence. Require a declared dependency,
// matching installed package metadata and the manager's corresponding record.
fn installed(package: &Path, root: &Path) -> Result<bool, String> {
    let declaration: serde_json::Value =
        serde_json::from_str(&text(&package.join("package.json"))?)
            .map_err(|_| "finish_package_metadata_invalid")?;
    let npm = root.join(".package-lock.json");
    let npm: Option<serde_json::Value> = if npm.is_file() {
        Some(serde_json::from_str(&text(&npm)?).map_err(|_| "finish_package_metadata_invalid")?)
    } else {
        None
    };
    let pnpm = root.join(".modules.yaml");
    let yarn = root.join(".yarn-state.yml");
    let pnpm = if pnpm.is_file() {
        Some(text(&pnpm)?)
    } else {
        None
    };
    let yarn = if yarn.is_file() {
        Some(text(&yarn)?)
    } else {
        None
    };
    for group in ["dependencies", "devDependencies", "optionalDependencies"] {
        let Some(deps) = declaration.get(group).and_then(|v| v.as_object()) else {
            continue;
        };
        for (name, spec) in deps {
            if name.contains("..")
                || name.contains(char::from(92))
                || name.starts_with('/')
                || name.split('/').count() > 2
                || !spec.is_string()
            {
                continue;
            }
            let dir = root.join(name);
            // Workspace links, external links and unsupported installs are not evidence.
            let Ok(meta) = fs::symlink_metadata(&dir) else {
                continue;
            };
            if receipt::unsafe_link(&meta) {
                if pnpm.is_none() {
                    continue;
                }
                let actual = dir.canonicalize().map_err(|e| e.to_string())?;
                let virtual_store = root
                    .join(".pnpm")
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                if !actual.starts_with(virtual_store) {
                    continue;
                }
            } else if !meta.is_dir() {
                continue;
            }
            let path = dir.join("package.json");
            if !path.is_file() {
                continue;
            }
            let value: serde_json::Value = serde_json::from_str(&text(&path)?)
                .map_err(|_| "finish_package_metadata_invalid")?;
            let Some(version) = value.get("version").and_then(|v| v.as_str()) else {
                continue;
            };
            if value.get("name").and_then(|v| v.as_str()) != Some(name) || version.is_empty() {
                continue;
            }
            if let Some(lock) = &npm {
                if lock
                    .get("lockfileVersion")
                    .and_then(|v| v.as_u64())
                    .is_some_and(|v| v == 2 || v == 3)
                    && lock
                        .get("packages")
                        .and_then(|v| v.get(format!("node_modules/{name}")))
                        .and_then(|v| v.get("version"))
                        .and_then(|v| v.as_str())
                        == Some(version)
                {
                    return Ok(true);
                }
            }
            if let Some(modules) = &pnpm {
                let virtual_dir = root.join(".pnpm");
                let lock = virtual_dir.join("lock.yaml");
                let virtual_package = virtual_dir
                    .join(format!("{}@{version}", name.replace('/', "+")))
                    .join("node_modules")
                    .join(name)
                    .join("package.json");
                if modules
                    .lines()
                    .any(|l| l.trim().starts_with("layoutVersion: "))
                    && modules
                        .lines()
                        .any(|l| l.trim().starts_with("packageManager: pnpm@"))
                    && modules
                        .lines()
                        .any(|l| l.trim() == "virtualStoreDir: .pnpm")
                    && lock.is_file()
                    && virtual_package.is_file()
                {
                    let lock = text(&lock)?;
                    let virtual_value: serde_json::Value =
                        serde_json::from_str(&text(&virtual_package)?)
                            .map_err(|_| "finish_package_metadata_invalid")?;
                    if lock
                        .lines()
                        .any(|l| l.trim().starts_with("lockfileVersion:"))
                        && lock.lines().any(|l| {
                            l.trim()
                                .trim_matches(char::from(39))
                                .trim_end_matches(':')
                                .trim_matches(char::from(39))
                                == format!("{name}@{version}")
                        })
                        && virtual_value == value
                    {
                        return Ok(true);
                    }
                }
            }
            if let Some(state) = &yarn {
                let locator = format!("\"{name}@npm:{version}\":");
                let location = format!("- \"node_modules/{name}\"");
                let mut record = false;
                let mut metadata = false;
                for line in state.lines() {
                    if line == "__metadata:" {
                        metadata = true;
                    }
                    if !line.starts_with(' ') && !line.is_empty() {
                        record = line == locator;
                    }
                    if metadata && record && line.trim() == location {
                        return Ok(true);
                    }
                }
            }
        }
    }
    Ok(false)
}
fn cargo_structure(
    dir: &Path,
    target: &Path,
    tracked: &BTreeSet<String>,
    ctx: &Context,
) -> Result<bool, String> {
    let manifest: toml::Value = toml::from_str(&text(&dir.join("Cargo.toml"))?)
        .map_err(|_| "finish_cargo_metadata_invalid")?;
    let mut names = Vec::new();
    if let Some(name) = manifest
        .get("package")
        .and_then(|v| v.get("name"))
        .and_then(|v| v.as_str())
    {
        names.push(name.replace('-', "_"));
    }
    if let Some(members) = manifest
        .get("workspace")
        .and_then(|v| v.get("members"))
        .and_then(|v| v.as_array())
    {
        for path in tracked.iter().filter(|p| p.ends_with("/Cargo.toml")) {
            let package = ctx.target.join(path);
            let Some(parent) = package.parent() else {
                continue;
            };
            let Ok(relative) = parent.strip_prefix(dir) else {
                continue;
            };
            let relative = relative.to_string_lossy().replace(char::from(92), "/");
            if !members
                .iter()
                .filter_map(|v| v.as_str())
                .any(|p| declared(p, &relative))
            {
                continue;
            }
            let value: toml::Value =
                toml::from_str(&text(&package)?).map_err(|_| "finish_cargo_metadata_invalid")?;
            if let Some(name) = value
                .get("package")
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str())
            {
                names.push(name.replace('-', "_"));
            }
        }
    }
    if names.is_empty() {
        return Ok(false);
    }

    let info = target.join(".rustc_info.json");
    if !info.is_file() {
        return Ok(false);
    }
    let info: serde_json::Value =
        serde_json::from_str(&text(&info)?).map_err(|_| "finish_cargo_metadata_invalid")?;
    if info
        .get("rustc_fingerprint")
        .and_then(|v| v.as_u64())
        .is_none()
        || info
            .get("outputs")
            .and_then(|v| v.as_object())
            .is_none_or(|v| v.is_empty())
    {
        return Ok(false);
    }
    for profile in ["debug", "release"] {
        let dir = target.join(profile);
        let fingerprints = dir.join(".fingerprint");
        if !dir.join("deps").is_dir() || !fingerprints.is_dir() {
            continue;
        }
        safe_candidate_root(ctx, &dir.join("deps"))?;
        safe_candidate_root(ctx, &fingerprints)?;
        let has_output = fs::read_dir(dir.join("deps"))
            .map_err(|e| e.to_string())?
            .take(8192)
            .any(|v| {
                v.is_ok_and(|v| {
                    let path = v.path();
                    path.file_stem().and_then(|v| v.to_str()).is_some_and(|v| {
                        names.iter().any(|name| {
                            v.starts_with(&format!("lib{name}-"))
                                || v.starts_with(&format!("{name}-"))
                        })
                    }) && path
                        .extension()
                        .is_some_and(|e| e == "rlib" || e == "rmeta" || e == "d")
                })
            });
        if !has_output {
            continue;
        }
        for item in fs::read_dir(&fingerprints)
            .map_err(|e| e.to_string())?
            .take(8192)
        {
            let path = item.map_err(|e| e.to_string())?.path();
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if receipt::unsafe_link(&meta) || !meta.is_dir() {
                continue;
            }
            for item in fs::read_dir(path).map_err(|e| e.to_string())?.take(8192) {
                let path = item.map_err(|e| e.to_string())?.path();
                let corresponding = path.file_stem().and_then(|v| v.to_str()).is_some_and(|v| {
                    names
                        .iter()
                        .any(|name| v == format!("lib-{name}") || v == format!("bin-{name}"))
                });
                if corresponding && path.extension().is_some_and(|v| v == "json") {
                    let v: serde_json::Value = serde_json::from_str(&text(&path)?)
                        .map_err(|_| "finish_cargo_metadata_invalid")?;
                    if v.get("rustc").and_then(|v| v.as_u64()).is_some()
                        && v.get("deps").and_then(|v| v.as_array()).is_some()
                        && v.get("target").and_then(|v| v.as_u64()).is_some()
                    {
                        return Ok(true);
                    }
                }
            }
        }
    }
    Ok(false)
}
fn declared(pattern: &str, relative: &str) -> bool {
    if pattern.starts_with('/') || pattern.split('/').any(|p| p == "..") {
        return false;
    }
    let mut expression = String::from("^");
    let mut chars = pattern.trim_end_matches('/').chars().peekable();
    while let Some(c) = chars.next() {
        if c == '*' {
            if chars.peek() == Some(&'*') {
                chars.next();
                expression.push_str(".*");
            } else {
                expression.push_str("[^/]*");
            }
        } else {
            expression.push_str(&regex::escape(&c.to_string()));
        }
    }
    expression.push('$');
    regex::Regex::new(&expression).is_ok_and(|r| r.is_match(relative))
}
fn node_packages(ctx: &Context, tracked: &BTreeSet<String>) -> Result<Vec<PathBuf>, String> {
    let root = ctx.target.join("package.json");
    if !root.exists() {
        return Ok(vec![]);
    }
    let value: serde_json::Value =
        serde_json::from_str(&text(&root)?).map_err(|_| "finish_package_metadata_invalid")?;
    let mut result = vec![ctx.target.clone()];
    let patterns = value.get("workspaces").and_then(|v| {
        v.as_array()
            .or_else(|| v.get("packages").and_then(|p| p.as_array()))
    });
    if let Some(patterns) = patterns {
        for p in tracked.iter().filter(|p| p.ends_with("/package.json")) {
            let rel = p.trim_end_matches("/package.json");
            safe_candidate_root(ctx, &ctx.target.join(rel))?;
            if patterns
                .iter()
                .filter_map(|v| v.as_str())
                .any(|p| declared(p, rel))
            {
                let package = ctx.target.join(rel);
                let _: serde_json::Value =
                    serde_json::from_str(&text(&package.join("package.json"))?)
                        .map_err(|_| "finish_package_metadata_invalid")?;
                result.push(package);
            }
        }
    }
    let pnpm = ctx.target.join("pnpm-workspace.yaml");
    if pnpm.exists() {
        let mut in_packages = false;
        let mut patterns = Vec::new();
        for line in text(&pnpm)?.lines() {
            let value = line.trim();
            if value == "packages:" {
                in_packages = true;
                continue;
            }
            if in_packages && value.starts_with("- ") {
                let value = value[2..].trim().trim_matches('\'').trim_matches('"');
                if value.starts_with('!') || value.contains('#') || value.contains('[') {
                    return Err("finish_workspace_syntax_unsupported".into());
                }
                patterns.push(value.to_string());
            } else if in_packages && !value.is_empty() && !value.starts_with('#') {
                break;
            }
        }
        for p in tracked.iter().filter(|p| p.ends_with("/package.json")) {
            let rel = p.trim_end_matches("/package.json");
            safe_candidate_root(ctx, &ctx.target.join(rel))?;
            if patterns.iter().any(|p| declared(p, rel)) {
                let package = ctx.target.join(rel);
                let _: serde_json::Value =
                    serde_json::from_str(&text(&package.join("package.json"))?)
                        .map_err(|_| "finish_package_metadata_invalid")?;
                if !result.contains(&package) {
                    result.push(package);
                }
            }
        }
    }
    Ok(result)
}
fn cargo_default(dir: &Path) -> Result<bool, String> {
    let path = dir.join("Cargo.toml");
    if !path.exists() {
        return Ok(false);
    }
    let value: toml::Value =
        toml::from_str(&text(&path)?).map_err(|_| "finish_cargo_metadata_invalid")?;
    if value.get("package").is_none() && value.get("workspace").is_none() {
        return Ok(false);
    }
    if value
        .get("package")
        .and_then(|p| p.get("workspace"))
        .is_some()
    {
        return Ok(false);
    }
    if std::env::var_os("CARGO_TARGET_DIR").is_some()
        || std::env::var_os("CARGO_BUILD_TARGET_DIR").is_some()
    {
        return Ok(false);
    }
    // Any ancestor workspace or target-dir config makes output ownership ambiguous.
    let package_dir = dir;
    for dir in package_dir.ancestors() {
        if dir != package_dir && dir.join("Cargo.toml").exists() {
            return Ok(false);
        }
        for name in [".cargo/config", ".cargo/config.toml"] {
            if dir.join(name).exists() {
                let config: toml::Value = toml::from_str(&text(&dir.join(name))?)
                    .map_err(|_| "finish_cargo_config_invalid")?;
                if config
                    .get("build")
                    .and_then(|b| b.get("target-dir"))
                    .is_some()
                {
                    return Ok(false);
                }
            }
        }
    }
    // Cargo's global configuration can redirect output too; use only a verified home path.
    let home = std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(|p| PathBuf::from(p).join(".cargo"))
        });
    if let Some(home) = home {
        for name in ["config", "config.toml"] {
            if home.join(name).exists() {
                let config: toml::Value = toml::from_str(&text(&home.join(name))?)
                    .map_err(|_| "finish_cargo_config_invalid")?;
                if config
                    .get("build")
                    .and_then(|b| b.get("target-dir"))
                    .is_some()
                {
                    return Ok(false);
                }
            }
        }
    }
    Ok(true)
}
fn estimate(
    path: &Path,
    depth: usize,
    entries: &mut u64,
    bytes: &mut u64,
    started: std::time::Instant,
) -> Result<(), String> {
    if depth > 128 {
        return Err("finish_artifact_depth_limit".into());
    }
    *entries += 1;
    if *entries > 500_000 || started.elapsed() > std::time::Duration::from_secs(600) {
        return Err("finish_artifact_preflight_budget".into());
    }
    if path.file_name().is_some_and(|n| n == ".git") {
        return Err(format!("finish_artifact_nested_git: {}", path.display()));
    }
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("finish_artifact_preflight_io: {}: {e}", path.display()))?;
    if receipt::unsafe_link(&meta) {
        fs::read_link(path).map_err(|e| format!("finish_artifact_link_unreadable: {e}"))?;
        return Ok(());
    }
    if meta.is_file() {
        *bytes = bytes
            .checked_add(meta.len())
            .ok_or("finish_artifact_preflight_budget")?;
    } else if meta.is_dir() {
        for item in fs::read_dir(path).map_err(|e| format!("finish_artifact_preflight_io: {e}"))? {
            estimate(
                &item.map_err(|e| e.to_string())?.path(),
                depth + 1,
                entries,
                bytes,
                started,
            )?;
        }
    } else {
        return Err("finish_artifact_unsupported_entry".into());
    }
    Ok(())
}
pub(super) fn classify(ctx: &Context) -> Result<Classification, String> {
    classify_owned(ctx, &[])
}
pub(super) fn classify_owned(ctx: &Context, owned: &[String]) -> Result<Classification, String> {
    let tracked: BTreeSet<String> = run_git_checked(&ctx.target, ["ls-files", "-z"])?
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    let mut possibilities = Vec::new();
    for package in node_packages(ctx, &tracked)? {
        let root = package.join("node_modules");
        if !root.exists() {
            continue;
        }
        safe_candidate_root(ctx, &root)?;
        if installed(&package, &root)? {
            possibilities.push((root, "node_dependencies",
                "declared dependency + matching installed package/manager record + ignored + no tracked descendants".into()));
        }
    }
    let cargo_dirs: Vec<PathBuf> = tracked
        .iter()
        .filter(|p| *p == "Cargo.toml" || p.ends_with("/Cargo.toml"))
        .filter_map(|p| ctx.target.join(p).parent().map(Path::to_path_buf))
        .collect();
    for dir in cargo_dirs {
        let target = dir.join("target");
        if target.exists() {
            safe_candidate_root(ctx, &target)?;
        }
        if target.exists()
            && cargo_default(&dir)?
            && cargo_structure(&dir, &target, &tracked, ctx)?
            && target.join("CACHEDIR.TAG").is_file()
            && text(&target.join("CACHEDIR.TAG"))?
                .starts_with("Signature: 8a477f597d28d172789f06886806bc55")
        {
            possibilities.push((target, "cargo_default_target", "Cargo package/workspace default target + CACHEDIR.TAG + ignored + no tracked descendants".into()));
        }
    }
    let mut candidates = Vec::new();
    for path in owned {
        if worktree_root_metadata(&local_path_from_input(path))?.is_some() {
            candidates.push(ArtifactCandidate {
                path: path.clone(),
                kind: "authorized_artifact_residual".into(),
                evidence: "durable original cleanup manifest; unchanged residual subset only"
                    .into(),
                estimated_bytes: None,
                estimated_entries: None,
                deletes_entire_directory: true,
            });
        }
    }
    for (path, kind, evidence) in possibilities {
        let rel = path
            .strip_prefix(&ctx.target)
            .map_err(|_| "finish_artifact_path")?
            .to_str()
            .ok_or("finish_non_utf8_path")?
            .replace('\\', "/");
        if tracked
            .iter()
            .any(|p| p == &rel || p.starts_with(&(rel.clone() + "/")))
        {
            continue;
        }
        if !run_git_raw(&ctx.target, ["check-ignore", "--quiet", "--", &rel])?.success {
            continue;
        }
        for ancestor in path.ancestors().take_while(|p| *p != ctx.target) {
            if receipt::unsafe_link(
                &fs::symlink_metadata(ancestor)
                    .map_err(|e| format!("finish_metadata_failed: {e}"))?,
            ) {
                return Err("finish_artifact_root_link".into());
            }
        }
        receipt::root_identity(&path)?;
        if candidates.iter().any(|c| {
            normalize_path_for_compare(&local_path_from_input(&c.path))
                == normalize_path_for_compare(&path)
        }) {
            continue;
        }
        candidates.push(ArtifactCandidate {
            path: path_to_git_arg(&path),
            kind: kind.into(),
            evidence,
            estimated_bytes: None,
            estimated_entries: None,
            deletes_entire_directory: true,
        });
    }
    let started = std::time::Instant::now();
    for candidate in &mut candidates {
        let mut entries = 0;
        let mut bytes = 0;
        estimate(
            &local_path_from_input(&candidate.path),
            0,
            &mut entries,
            &mut bytes,
            started,
        )?;
        candidate.estimated_bytes = Some(bytes);
        candidate.estimated_entries = Some(entries);
    }
    candidates.sort_by(|a, b| a.path.cmp(&b.path));
    // Exclude complete authorized roots before traversing ordinary contents. Unknown ignored
    // files are not silently swept into the ordinary ownership snapshot.
    let mut preserved = Vec::new();
    let mut pending = vec![ctx.target.clone()];
    let mut count = 0usize;
    while let Some(dir) = pending.pop() {
        for item in fs::read_dir(&dir).map_err(|e| format!("finish_preflight_failed: {e}"))? {
            let path = item
                .map_err(|e| format!("finish_preflight_failed: {e}"))?
                .path();
            if candidates.iter().any(|c| {
                normalize_path_for_compare(&local_path_from_input(&c.path))
                    == normalize_path_for_compare(&path)
            }) {
                continue;
            }
            let rel = path
                .strip_prefix(&ctx.target)
                .map_err(|_| "finish_artifact_path")?
                .to_str()
                .ok_or("finish_non_utf8_path")?
                .replace('\\', "/");
            if rel == ".git" {
                continue;
            }
            count += 1;
            if count > 20000 {
                return Err(format!("finish_preflight_entry_limit: {}", path.display()));
            }
            let meta =
                fs::symlink_metadata(&path).map_err(|e| format!("finish_preflight_failed: {e}"))?;
            let tracked_entry = tracked.contains(&rel);
            let tracked_directory = tracked.iter().any(|p| p.starts_with(&(rel.clone() + "/")));
            if receipt::unsafe_link(&meta)
                || (!tracked_entry && !tracked_directory)
                || path.file_name().is_some_and(|n| n == ".git")
            {
                preserved.push(CleanupBlocker {
                    path: path_to_git_arg(&path),
                    reason: "finish_unknown_content_preserved".into(),
                });
            } else if meta.is_dir() {
                pending.push(path);
            }
        }
    }
    preserved.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Classification {
        candidates,
        preserved,
        provenance_notice: "finish_self_temp_provenance_missing".into(),
    })
}
